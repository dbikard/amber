/* world.js — the headless simulation core (v0.2 "The Shadow March"). No DOM, no Date.
 * A mirrored site-graph map: units path over edges, outposts claim sites, fog of war is
 * computed here (render + snapshots + AI all consume the same vision truth).
 * world.events is write-only here — a queue the renderer/UI drains; the sim never reads it. */
(function (global) {
  'use strict';

  const C = global.CONST || (typeof require !== 'undefined' ? require('./const.js') : null);
  const RNG = global.RNG || (typeof require !== 'undefined' ? require('./rng.js') : null);
  const NAV = global.NAV || (typeof require !== 'undefined' ? require('./nav.js') : null);
  const WG = global.WorldGen || (typeof require !== 'undefined' ? require('./worldgen.js') : null);

  function emit(world, ev) {
    world.events.push(ev);
    if (world.events.length > C.EVENT_CAP) world.events.splice(0, world.events.length - C.EVENT_CAP);
  }
  const d2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };

  /* ---------------- a work with a length ----------------
   * A Curtain Wall is the only work that is a LINE rather than a point: one building record
   * carrying a second end. Everything else in the sim treats it as a work at its midpoint —
   * these two helpers are what the rest needs to know it is longer than that. */
  const isWall = (b) => b.bt === 'wall' && b.x2 != null;
  /* squared distance from a point to the segment, and where along it the foot falls */
  function segD2(b, px, py) {
    const ax = b.x2 != null ? b.x * 2 - b.x2 : b.x, ay = b.y2 != null ? b.y * 2 - b.y2 : b.y;
    const bx = b.x2 != null ? b.x2 : b.x, by = b.y2 != null ? b.y2 : b.y;
    const vx = bx - ax, vy = by - ay, len2 = vx * vx + vy * vy;
    if (len2 < 1e-6) return d2(px, py, ax, ay);
    let t = ((px - ax) * vx + (py - ay) * vy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return d2(px, py, ax + vx * t, ay + vy * t);
  }
  /* the two ends, from the stored midpoint and far end */
  const wallEnds = (b) => [b.x * 2 - b.x2, b.y * 2 - b.y2, b.x2, b.y2];
  /* the point ON the wall a man at (px,py) is standing against — what you aim at when the
   * stone itself is the target, so an Engine strikes the span in front of it and not the
   * middle of a run three hundred long */
  function segNear(b, px, py) {
    const e = wallEnds(b);
    const vx = e[2] - e[0], vy = e[3] - e[1], len2 = vx * vx + vy * vy;
    if (len2 < 1e-6) return { x: b.x, y: b.y };
    let t = ((px - e[0]) * vx + (py - e[1]) * vy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return { x: e[0] + vx * t, y: e[1] + vy * t };
  }
  /* do segments AB and CD cross? Straight orientation test — no divisions, no edge cases
   * that matter at the scale a wall and a line of fire meet on. */
  function crosses(ax, ay, bx, by, cx, cy, dx, dy) {
    const s = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
    const d1 = s(cx, cy, dx, dy, ax, ay), dd2 = s(cx, cy, dx, dy, bx, by);
    const d3 = s(ax, ay, bx, by, cx, cy), d4 = s(ax, ay, bx, by, dx, dy);
    return ((d1 > 0) !== (dd2 > 0)) && ((d3 > 0) !== (d4 > 0));
  }

  /* ---------------- the world ----------------
   * Generated fresh, every match, by js/worldgen.js. No template, no mirror, no corridors —
   * and therefore no way to know where the other Seat stands until somebody walks there. */
  function buildMap(seed, players) {
    const gen = WG.build(seed, RNG, players);
    if (!gen) return null;
    for (const s of gen.sites) { s.lastHurt = -99; }
    return { sites: gen.sites, cities: gen.cities, nodes: gen.nodes,
             gen, skew: gen.skew, apart: gen.apart };
  }

  /* `players` is 2..4. Two is a duel and behaves exactly as it always did; more is a
   * free-for-all, where toppling a Seat ELIMINATES that heir rather than ending the match,
   * and the last one left takes the throne. */
  function createWorld(seed, players) {
    const rng = RNG.make(seed >>> 0);
    const map = buildMap(seed >>> 0, players);
    const seats = map.cities;
    const world = {
      seed: seed >>> 0, rng,
      t: 0, tick: 0,
      winner: null, winReason: null,
      map,
      players: seats.map(() => ({
        essence: C.START_ESSENCE,
        castleHp: C.CASTLE_HP,
        out: false,             // toppled: still on the board as a ruin, but out of the match
        eco: 1,                 // income handicap: 1 = full strength (always 1 in a duel)
        /* COMPANIES. A standard is its own thing, not a property of a barracks: several halls
         * may muster into one company, which is what keeps the flag tray readable once you
         * hold a dozen of them. Company 0 is not a company — it means "follows the War
         * Banner". Ids never repeat, so a company's colour never shifts under the player. */
        companies: [],          // [{ id, rally }] — rally null = this company follows the Banner
        nextCo: 1,
        pattern: 0, walking: false, revealed: false, alertIdx: 0,
        buildings: [],          // free placement: every work knows where it stands
        powers: { storm: 0, trump: 0 },
        championId: 0,
        banner: -1,             // site id the army marches on; -1 = defend home
        musterPaused: false,    // the Seat can halt the muster to hoard essence
        explored: {},           // siteId -> last-known {kind, owner}
        seen: newSeenMask(),    // coarse grid of ground you have ever had eyes on
        ghosts: {}              // buildingId -> last-seen {bt, level, x, y, owner} (fog memory)
      })),
      units: [], storms: [], events: [],
      paused: null,               // a halt anyone at the table may call: { by: seat, at: t }
      nav: null, navVersion: 0,   // movement grid; the version counts changes to what blocks
      walls: [], anyWall: false,  // the standing curtains, rebuilt whenever one rises or falls
      nextId: 1,
      chaosNext: C.CHAOS.firstAt, chaosParity: 0, surged: false,
      vis: null                 // per-tick vision cache: [ [sources for p0], [for p1] ]
    };
    world.nav = NAV.build(world.map.gen);
    for (let pi = 0; pi < world.players.length; pi++) {
      world.players[pi].banner = aimAt(world, { site: world.map.cities[pi] });
      exploreAround(world, pi);   // you know your own surroundings from the start
    }
    return world;
  }

  const cityOf = (world, pi) => world.map.sites[world.map.cities[pi]];
  const bldOf = (world, pi, id) => world.players[pi].buildings.find((b) => b.id === id) || null;
  const nodeAt = (world, x, y) => {
    for (const s of world.map.sites)
      if (s.kind === 'node' && d2(x, y, s.x, s.y) < C.NODE.r * C.NODE.r) return s;
    return null;
  };
  /* which player, if any, already draws from this node */
  function nodeHolder(world, site) {
    for (let pi = 0; pi < world.players.length; pi++)
      for (const b of world.players[pi].buildings)
        if (b.bt === 'gate' && !b.raise && b.node === site.id) return pi;
    return -1;
  }

  /* ---------------- where a work may stand ----------------
   * Your writ runs from the Seat and from every Shadow Gate you hold. Inside it, on ground
   * that will bear a building, clear of other works — that is the whole rule for ordinary
   * works. A Gate is different in both directions: it may ONLY stand on a spring, because a
   * Gate draws Shadow up out of the ground and there is nothing to draw anywhere else — and
   * in exchange it may be raised on a spring BEYOND your writ, if your troops hold it and the
   * enemy's do not. That is how a claim grows in the first place. */
  function inClaim(world, pi, x, y) {
    const c = cityOf(world, pi);
    if (d2(x, y, c.x, c.y) < C.CLAIM.seat * C.CLAIM.seat) return true;
    for (const b of world.players[pi].buildings)
      if (!b.raise && C.BUILDINGS[b.bt].claim && d2(x, y, b.x, b.y) < C.CLAIM.gate * C.CLAIM.gate) return true;
    return false;
  }
  function groundBears(world, x, y) {
    if (x < 0 || y < 0 || x > C.MAP.W || y > C.MAP.H) return false;
    const nav = world.nav, c = NAV.cellOf(nav, x, y);
    if (c < 0) return false;
    /* plain, meadow and hill will bear a building; wood, marsh, water and crag will not */
    return !!WG.BUILDABLE[nav.terra[c]];
  }
  function clearOfWorks(world, x, y) {
    const need = C.BUILD.foot * 2 + C.BUILD.gap;
    for (let pi = 0; pi < world.players.length; pi++)
      for (const b of world.players[pi].buildings)
        if (d2(x, y, b.x, b.y) < need * need) return false;
    for (let pi = 0; pi < world.players.length; pi++) {   // and never inside the Seat itself
      const c = cityOf(world, pi);
      if (d2(x, y, c.x, c.y) < C.CITY.seatR * C.CITY.seatR) return false;
    }
    return true;
  }
  /* How many crews an heir can keep working, and how many are working. Hired out of the
   * ground you hold: every C.MASONS.per finished Gates buys another, so the map is what
   * lets you spend. A shell claims nothing and hires nobody. */
  function masons(world, pi) {
    let gates = 0;
    for (const b of world.players[pi].buildings)
      if (b.bt === 'gate' && !b.raise) gates++;
    return Math.min(C.MASONS.max, C.MASONS.base + Math.floor(gates / C.MASONS.per));
  }
  /* HOW MANY CREWS A WORK HAS ON IT. Everything but a wall takes one. A CURTAIN IS PAID FOR
   * BY THE FOOT: there is no longest run any more — there is only how many crews you can put
   * on one at once, so the length a heir can raise IS his mason count, and it grows with the
   * Gates he holds like everything else does. */
  const wallCrews = (len) => Math.max(1, Math.ceil(len / C.WALL.unit));
  const crewsOn = (b) => (b.crews || 1);
  function rising(world, pi) {
    let n = 0;
    for (const b of world.players[pi].buildings) if (b.raise > 0) n += crewsOn(b);
    return n;
  }
  /* the longest run this heir could START right now, given the crews standing idle */
  function wallReach(world, pi) {
    return Math.max(0, masons(world, pi) - rising(world, pi)) * C.WALL.unit;
  }
  /* ---------------- the stone between you and the field ----------------
   * MANNING. A wall stops shots crossing it, so troops behind one are safe — and a wall alone
   * kills nobody. Come within `man` of your OWN finished wall and you are on the parapet:
   * you shoot over it, and everything below can shoot back. That is the bargain, and it is
   * what keeps a wall from being a way to win by sitting. */
  function manning(world, u) {
    if (!world.anyWall || u.owner === C.CHAOS_ID) return null;
    const r2 = C.WALL.man * C.WALL.man;
    for (const w of world.walls)
      if (w.owner === u.owner && segD2(w.b, u.x, u.y) < r2) return w.b;
    return null;
  }
  /* IS THERE STONE BETWEEN THEM? Every finished wall the line crosses blocks it — with one
   * exception, and the whole design rests on it: a wall does not hide a man who is manning
   * IT. Come up to your own parapet and you can shoot out; the same stone that was covering
   * you stops covering you, and the field can shoot back. Standing off behind it, you are
   * safe and useless. `skip` is the wall being shot AT, which cannot block the shot at
   * itself. */
  function walled(world, ax, ay, bx, by, aOwner, bOwner, skip) {
    if (!world.anyWall) return false;
    const r2 = C.WALL.man * C.WALL.man;
    for (const w of world.walls) {
      if (w.b === skip) continue;
      if (!crosses(ax, ay, bx, by, w.ax, w.ay, w.bx, w.by)) continue;
      if (aOwner === w.owner && segD2(w.b, ax, ay) < r2) continue;   // on it, shooting over
      if (bOwner === w.owner && segD2(w.b, bx, by) < r2) continue;   // on it, being shot at
      return true;
    }
    return false;
  }
  /* NOTHING WALKS THROUGH STONE. The flow field already routes a rival column around a
   * curtain, but marching is not collision-checked — a soldier steering straight at a goal
   * he cannot reach would otherwise stroll through the wall as if it were paint. So after he
   * moves, anyone standing in another heir's stone is put back on the side he came from. The
   * owner passes freely: it is his wall, and it has a gate in it. */
  function shove(world, u) {
    const pad = C.WALL.thick + 6, p2 = pad * pad;
    for (const w of world.walls) {
      if (w.owner === u.owner) continue;
      if (segD2(w.b, u.x, u.y) >= p2) continue;
      const n = segNear(w.b, u.x, u.y);
      let dx = u.x - n.x, dy = u.y - n.y, L = Math.sqrt(dx * dx + dy * dy);
      if (L < 1e-3) { dx = -(w.by - w.ay); dy = w.bx - w.ax; L = Math.sqrt(dx * dx + dy * dy) || 1; }
      u.x = n.x + (dx / L) * pad; u.y = n.y + (dy / L) * pad;
    }
  }

  /* THE STANDING STONE, gathered once. Walls change only when one finishes or falls, so the
   * list the crossing test walks is rebuilt then and not per shot; `anyWall` lets a match
   * with no walls in it skip the whole question for nothing. */
  function noteWalls(world) {
    world.walls = [];
    for (let q = 0; q < world.players.length; q++)
      for (const b of world.players[q].buildings) {
        if (!isWall(b) || b.raise) continue;
        const e = wallEnds(b);
        world.walls.push({ b, owner: q, ax: e[0], ay: e[1], bx: e[2], by: e[3] });
      }
    world.anyWall = world.walls.length > 0;
  }

  /* A WALL IS TWO TAPS. The first says where it starts and can only be checked for what one
   * point can be checked for; the second is the real placement. `span` says the run is the
   * wrong length, `ground` that some of it will not stand, `crowded` that it fouls a work or
   * another wall. Both ends must be inside your writ — you fortify ground you hold. */
  function wallError(world, pi, ax, ay, bx, by) {
    const def = C.BUILDINGS.wall, pl = world.players[pi];
    const len = Math.sqrt(d2(ax, ay, bx, by));
    if (!isFinite(len) || len < def.span[0]) return 'short';
    if (!inClaim(world, pi, ax, ay) || !inClaim(world, pi, bx, by)) return 'claim';
    /* the ground has to bear the whole run, not just its ends */
    const steps = Math.max(2, Math.ceil(len / 20));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      if (!groundBears(world, x, y)) return 'ground';
      /* never through a Seat's own ground, anyone's */
      for (let q = 0; q < world.players.length; q++) {
        const c = cityOf(world, q);
        if (d2(x, y, c.x, c.y) < C.CITY.seatR * C.CITY.seatR) return 'crowded';
      }
    }
    const probe = { x: (ax + bx) / 2, y: (ay + by) / 2, x2: bx, y2: by };
    for (let q = 0; q < world.players.length; q++) {
      for (const o of world.players[q].buildings) {
        if (isWall(o)) {
          const e = wallEnds(o);
          if (crosses(ax, ay, bx, by, e[0], e[1], e[2], e[3])) return 'crowded';
          if (segD2(o, ax, ay) < 26 * 26 && segD2(o, bx, by) < 26 * 26) return 'crowded';
        } else if (segD2(probe, o.x, o.y) < C.BUILD.foot * C.BUILD.foot) return 'crowded';
      }
    }
    /* the crews are the only limit on a run's LENGTH. None free at all is 'busy' — the same
     * answer any other work gets; free but too few for a run this long is 'crews', which is a
     * different problem with a different fix (draw a shorter one, or hold more Gates). */
    const free = masons(world, pi) - rising(world, pi);
    if (free <= 0) return 'busy';
    return wallCrews(len) > free ? 'crews' : null;
  }

  /* the single answer the sim, the UI and the AI all ask. Returns null if legal. */
  function placementError(world, pi, x, y, bt) {
    const def = C.BUILDINGS[bt];
    if (!def) return 'type';
    const pl = world.players[pi];
    if (def.unique && pl.buildings.some((b) => b.bt === bt)) return 'unique';
    if (!groundBears(world, x, y)) return 'ground';
    /* a wall's FIRST tap: all a single point can be judged on. The run itself is checked when
     * the second tap lands, by wallError. */
    if (def.span) {
      if (!inClaim(world, pi, x, y)) return 'claim';
      return rising(world, pi) >= masons(world, pi) ? 'busy' : null;
    }
    if (!clearOfWorks(world, x, y)) return 'crowded';
    /* The masons are the last word, not the first: what is wrong with the GROUND is worth
     * knowing while you wait, and a card that can never be built here should say so rather
     * than blame the masons. */
    const busy = rising(world, pi) >= masons(world, pi) ? 'busy' : null;
    /* a Gate stands on a spring or it does not stand: inside your writ or out, that is first */
    if (def.claim) {
      const site = nodeAt(world, x, y);
      if (!site) return 'nospring';
      if (nodeHolder(world, site) !== -1) return 'taken';
      if (inClaim(world, pi, x, y)) return busy;
      /* beyond the writ it must be a spring your troops hold and the enemy's do not */
      if (!world.units.some((u) => u.owner === pi && d2(u.x, u.y, site.x, site.y) < 90 * 90)) return 'presence';
      if (world.units.some((u) => u.owner !== pi && u.owner !== C.CHAOS_ID && d2(u.x, u.y, site.x, site.y) < 90 * 90)) return 'contested';
      return busy;
    }
    if (inClaim(world, pi, x, y)) return busy;
    return 'claim';
  }

  /* ---------------- vision & exploration ---------------- */
  function visionSources(world, pi) {
    const src = [];
    const city = cityOf(world, pi);
    src.push([city.x, city.y, C.VISION.city]);
    for (const b of world.players[pi].buildings) {
      if (b.raise) continue;
      const r = C.BUILDINGS[b.bt].vision || C.VISION.build;
      src.push([b.x, b.y, r]);
      /* a wall watches from its whole length — a run three hundred long that saw only from
       * its middle left its own far end in fog */
      if (isWall(b)) { const e = wallEnds(b); src.push([e[0], e[1], r], [e[2], e[3], r]); }
    }
    for (const u of world.units)
      if (u.owner === pi) src.push([u.x, u.y, C.VISION.unit]);
    /* somebody else's walk lights their Shrine for you too — the Pattern is not walked in
     * the dark, and a rival reaching for the throne must be findable */
    for (let o = 0; o < world.players.length; o++) {
      const q = world.players[o];
      if (o === pi || q.out || !q.walking) continue;
      const sh = q.buildings.find((b) => b.bt === 'shrine' && !b.raise);
      if (sh) src.push([sh.x, sh.y, C.VISION.pattern]);
    }
    return src;
  }
  /* every Shrine currently burning, for the renderer and the HUD: [{ pi, x, y, pattern }] */
  function walkers(world) {
    const out = [];
    for (let pi = 0; pi < world.players.length; pi++) {
      const q = world.players[pi];
      if (q.out || !q.walking) continue;
      const sh = q.buildings.find((b) => b.bt === 'shrine' && !b.raise);
      out.push({ pi, x: sh ? sh.x : null, y: sh ? sh.y : null, pattern: q.pattern });
    }
    return out;
  }
  /* ---------------- remembered ground ----------------
   * `explored` remembers SITES; this remembers the LAND. One byte per cell, marked wherever
   * a vision source has ever reached, so the renderers can keep walked country on the map
   * under a lighter veil instead of letting it go black the moment the column leaves. */
  function newSeenMask() {
    const gw = Math.ceil(C.MAP.W / C.FOG.cell), gh = Math.ceil(C.MAP.H / C.FOG.cell);
    return { g: new Uint8Array(gw * gh), gw, gh, cell: C.FOG.cell, v: 0 };
  }
  function markSeen(mask, src) {
    const cw = mask.cell;
    for (let i = 0; i < src.length; i++) {
      const cx = src[i][0], cy = src[i][1], r = src[i][2], r2 = r * r;
      const gx0 = Math.max(0, ((cx - r) / cw) | 0), gx1 = Math.min(mask.gw - 1, ((cx + r) / cw) | 0);
      const gy0 = Math.max(0, ((cy - r) / cw) | 0), gy1 = Math.min(mask.gh - 1, ((cy + r) / cw) | 0);
      for (let gy = gy0; gy <= gy1; gy++) {
        const dy2 = (gy + 0.5) * cw - cy;
        for (let gx = gx0; gx <= gx1; gx++) {
          const k = gy * mask.gw + gx;
          if (mask.g[k]) continue;
          const dx2 = (gx + 0.5) * cw - cx;
          if (dx2 * dx2 + dy2 * dy2 <= r2) { mask.g[k] = 1; mask.v++; }
        }
      }
    }
    return mask;
  }

  function seen(src, x, y) {
    for (let i = 0; i < src.length; i++) {
      const s = src[i];
      if (d2(x, y, s[0], s[1]) < s[2] * s[2]) return true;
    }
    return false;
  }
  function refreshVision(world) {
    world.vis = world.players.map((q, pi) => visionSources(world, pi));
    for (let pi = 0; pi < world.players.length; pi++) exploreAround(world, pi);
  }
  function exploreAround(world, pi) {
    const src = world.vis ? world.vis[pi] : visionSources(world, pi);
    const pl = world.players[pi];
    /* A Seat is a site like any other: you know it is there once you have SEEN it, and not
     * before. Finding the rival's is the whole early game now. */
    for (const s of world.map.sites)
      if (seen(src, s.x, s.y)) pl.explored[s.id] = { kind: s.kind, name: s.name };
    markSeen(pl.seen, src);
    /* the new fog rule: a rival's work is visible only while you can SEE it, and remembered
     * as a ghost — last seen, where it stood — once you cannot. No more veiled-slot bookkeeping. */
    for (let o = 0; o < world.players.length; o++) {
      for (const b of world.players[o].buildings) {
        /* a wall is remembered as the LINE it was, ends and all — a curtain recalled as a
         * dot on the map is no use to the heir deciding where to break through */
        const g = { bt: b.bt, level: b.level, x: b.x, y: b.y, owner: o };
        if (b.x2 != null) { g.x2 = b.x2; g.y2 = b.y2; }
        if (o === pi) { pl.ghosts[b.id] = g; continue; }
        const e = b.x2 != null ? wallEnds(b) : null;
        if (seen(src, b.x, b.y) || (e && (seen(src, e[0], e[1]) || seen(src, e[2], e[3])))) pl.ghosts[b.id] = g;
      }
    }
  }
  /* public vision test for render/snapshots: can `pi` see point (x,y) right now? */
  function canSee(world, pi, x, y) {
    if (!world.vis) refreshVision(world);
    return seen(world.vis[pi], x, y);
  }

  /* ---------------- pathfinding: the nav grid does the walking ---------------- */

  /* ---------------- commands ---------------- */
  /* a tower's live stats: shared until the level-2 fork, per-branch after it */
  function towerStats(b) {
    const def = C.BUILDINGS.tower;
    const br = b.level >= def.fork && b.br ? C.TOWER_BRANCHES[b.br] : null;
    if (!br) return { dmg: def.dmg[b.level - 1], range: def.range[b.level - 1], atk: def.atk, splash: 0 };
    const i = b.level - def.fork;
    return { dmg: br.dmg[i], range: br.range[i], atk: br.atk[i],
             splash: br.splash[i], splashDmg: br.dmg[i] * (br.splashFrac || 0) };
  }
  /* `br` is the branch the tower is being upgraded INTO (or already holds) */
  function upgradeCost(bt, level, br) {
    if (bt === 'tower') {
      const b2 = C.TOWER_BRANCHES[br];
      if (!b2) return C.BUILDINGS.tower.up[level - 1];          // unforked fallback
      return level < C.BUILDINGS.tower.fork ? b2.cost : b2.up[level - C.BUILDINGS.tower.fork];
    }
    const up = C.BUILDINGS[bt].up;
    return up ? up[level - 1] : Infinity;   // no table = this work does not upgrade
  }

  function applyCommand(world, pi, cmd) {
    if (world.winner !== null) return { ok: false, err: 'over' };
    const pl = world.players[pi];
    if (!pl) return { ok: false, err: 'player' };

    /* ---------------- the halt ----------------
     * ANYONE AT THE TABLE MAY CALL ONE, AND ANYONE MAY LIFT IT. A halt is host-authoritative
     * like everything else — it is world state, so it rides the snapshot and every seat sees
     * the same thing — and it stops the world rather than merely hiding it: no clock, no
     * muster, no Chaos, and NO ORDERS. A pause you can build through is not a pause, it is a
     * planning phase, and in a duel it would be a way to buy thinking time the other heir
     * does not get. Lifting it is left open to everyone on purpose: whoever called the halt
     * may be the one who walked away from the phone. */
    if (cmd.c === 'pause') {
      const on = !!cmd.on;
      if (on === !!world.paused) return { ok: true };
      world.paused = on ? { by: pi, at: world.t } : null;
      emit(world, { e: 'pause', on, pi });
      return { ok: true };
    }
    if (world.paused) return { ok: false, err: 'paused' };

    if (cmd.c === 'build') {
      const def = C.BUILDINGS[cmd.bt];
      let x = +cmd.x, y = +cmd.y;
      if (!def || !isFinite(x) || !isFinite(y)) return { ok: false, err: 'type' };
      /* a wall carries a second end, and is stored by its MIDPOINT so every other part of the
       * sim — vision, fog, the renderer, the minimap — can go on treating a work as a place */
      let x2 = null, y2 = null, crews = 1;
      if (def.span) {
        x2 = +cmd.x2; y2 = +cmd.y2;
        if (!isFinite(x2) || !isFinite(y2)) return { ok: false, err: 'short' };
        const badw = wallError(world, pi, x, y, x2, y2);
        if (badw) return { ok: false, err: badw };
        crews = wallCrews(Math.sqrt(d2(x, y, x2, y2)));
        x = (x + x2) / 2; y = (y + y2) / 2;
      }
      const bad = def.span ? null : placementError(world, pi, x, y, cmd.bt);
      if (bad) return { ok: false, err: bad };
      /* A RUN IS PRICED BY THE FOOT. One crew's worth of wall costs what the card says; twice
       * the wall is twice the crews, twice the price and twice the stone to break. Anything
       * else and a long wall is simply cheaper per length than a short one, which is not a
       * choice — it is an answer. */
      const price = def.cost * crews;
      if (pl.essence < price) return { ok: false, err: 'essence' };
      pl.essence -= price;
      const site = def.claim ? nodeAt(world, x, y) : null;
      /* it goes up as a SHELL: paid for, standing, breakable — and good for nothing until
       * the masons are done with it */
      const b = { id: world.nextId++, bt: cmd.bt, level: 1, x, y,
                  cd: def.period ? def.period[0] * 0.5 : (def.atk || 0),
                  raise: def.raise || 0, raiseFor: def.raise || 0,
                  hp: def.hp * crews * C.RAISE.hpFrom, maxHp: def.hp * crews, lastHurt: -99,
                  node: site && nodeHolder(world, site) === -1 ? site.id : -1,
                  co: 0 };         // 0 = its muster marches under the royal War Banner
      if (x2 != null) { b.x2 = x2; b.y2 = y2; b.crews = crews; }
      if (!b.raise) b.hp = b.maxHp;
      if (def.spawns) b.co = joinCo(world, pi, cmd.co);
      pl.buildings.push(b);
      /* a finished wall bars the ground: the flow fields drawn against the old world are all
       * stale, and the version counter is what tells them so */
      if (x2 != null && !b.raise) { world.navVersion++; noteWalls(world); }
      emit(world, { e: 'build', pi, id: b.id, bt: cmd.bt, x, y, x2, y2, co: b.co });
      return { ok: true };
    }
    if (cmd.c === 'up') {
      const s = bldOf(world, pi, cmd.id);
      if (!s) return { ok: false, err: 'id' };
      if (s.raise > 0) return { ok: false, err: 'raising' };
      /* some works simply do not upgrade — the Shrine is one, and there is nothing to offer */
      if (s.bt !== 'tower' && !C.BUILDINGS[s.bt].up) return { ok: false, err: 'noup' };
      if (s.level >= C.MAX_LEVEL) return { ok: false, err: 'max' };
      /* the Watchtower fork: the level-2 upgrade must name a branch, and it is forever */
      let br = s.br;
      if (s.bt === 'tower' && s.level + 1 === C.BUILDINGS.tower.fork) {
        br = cmd.br;
        if (!C.TOWER_BRANCHES[br]) return { ok: false, err: 'branch' };
      }
      /* AN UPGRADE TAKES TIME, AND THE WORK GOES QUIET WHILE IT DOES. That is the whole cost:
       * the men or the shots you go without while the masons are in it, which is what makes
       * WHEN to upgrade a decision instead of a formality.
       * IT DOES NOT TAKE A MASON CREW. That was tried and measured and it was wrong. The
       * crews are what ration BUILDING, and charging upgrades against the same purse quietly
       * taxed whoever was expanding hardest — Brand, who runs four Gates and a pair of
       * expansion missions, fell from 48 wins to 34 on it. Two doctrines were rewritten
       * trying to fix him from his side (spires first: 29; barracks first: 27) before the
       * cause turned out to be here. A level is paid for in essence and in silence. */
      if (s.work > 0) return { ok: false, err: 'working' };
      const cost = upgradeCost(s.bt, s.level, br) * (s.crews || 1);
      if (pl.essence < cost) return { ok: false, err: 'essence' };
      pl.essence -= cost;
      s.level++;
      if (br) s.br = br;
      s.work = s.workFor = Math.max(1, (C.BUILDINGS[s.bt].raise || 10) * C.UP_WORK);
      /* a work whose level buys STONE rather than an effect — the Curtain Wall, which has no
       * effect to buy — grows its hit points, keeping the damage already done to it */
      if (C.BUILDINGS[s.bt].hpAt) {
        const was = s.maxHp;
        s.maxHp = C.BUILDINGS[s.bt].hpAt[s.level - 1] * (s.crews || 1);
        s.hp = Math.min(s.maxHp, s.hp + (s.maxHp - was));
      }
      emit(world, { e: 'up', pi, id: s.id, level: s.level, br: s.br || null, x: s.x, y: s.y });
      return { ok: true };
    }
    if (cmd.c === 'walk') {
      if (!pl.buildings.some((b) => b.bt === 'shrine')) return { ok: false, err: 'shrine' };
      pl.walking = !!cmd.on;
      if (pl.walking && !pl.revealed) { pl.revealed = true; emit(world, { e: 'walk', pi }); }
      return { ok: true };
    }
    if (cmd.c === 'muster') {
      pl.musterPaused = !!cmd.pause;
      emit(world, { e: 'muster', pi, pause: pl.musterPaused });
      return { ok: true };
    }
    if (cmd.c === 'rally') {
      /* a COMPANY's standard, not a building's: every hall mustering into it answers at once */
      const co = coOf(world, pi, cmd.co);
      if (!co) return { ok: false, err: 'co' };
      const p = aimAt(world, cmd);
      if (!p) { co.rally = null; emit(world, { e: 'rally', pi, co: co.id, site: -1 }); return { ok: true }; }
      co.rally = p;
      emit(world, { e: 'rally', pi, co: co.id, site: p.site, x: p.x, y: p.y });
      return { ok: true };
    }
    if (cmd.c === 'assign') {
      /* move a hall between companies — or out of all of them, back under the Banner */
      const b = bldOf(world, pi, cmd.id);
      if (!b || !C.BUILDINGS[b.bt].spawns) return { ok: false, err: 'id' };
      const was = b.co;
      b.co = joinCo(world, pi, cmd.co);
      if (was !== b.co) {
        /* the men already mustered stay with the hall that raised them */
        for (const u of world.units) if (u.owner === pi && u.from === b.id) u.co = b.co;
        pruneCos(world, pi);
      }
      emit(world, { e: 'assign', pi, id: b.id, co: b.co });
      return { ok: true };
    }
    if (cmd.c === 'banner') {
      const p = aimAt(world, cmd);
      if (!p) return { ok: false, err: 'where' };
      pl.banner = p;
      /* THE ROYAL WAR BANNER IS THE GENERAL MUSTER, and it outranks every company standard.
       * A company is a DETACHMENT from the army, not a rival army: raising the gold banner
       * strikes every standing detachment order and brings the whole force under it. Plant
       * that company's own standard again and it peels back off.
       * Before this the gold flag moved only whoever happened to be under no standard at
       * all, which once a few halls are up is a shrinking minority — and is exactly the
       * "the yellow flag doesn't move my army" it looked like from the outside. */
      for (const co of pl.companies)
        if (co.rally) { co.rally = null; emit(world, { e: 'rally', pi, co: co.id, site: -1 }); }
      emit(world, { e: 'banner', pi, site: p.site, x: p.x, y: p.y });
      return { ok: true };
    }
    if (cmd.c === 'power') {
      const def = C.POWERS[cmd.k];
      if (!def) return { ok: false, err: 'power' };
      if (pl.powers[cmd.k] > 0) return { ok: false, err: 'cd' };
      if (pl.essence < def.cost) return { ok: false, err: 'essence' };
      if (cmd.k === 'storm') {
        const x = Math.max(0, Math.min(C.MAP.W, +cmd.x || 0));
        const y = Math.max(0, Math.min(C.MAP.H, +cmd.y || 0));
        if (!canSee(world, pi, x, y)) return { ok: false, err: 'fog' };   // no storming the unseen
        pl.essence -= def.cost;
        world.storms.push({ owner: pi, x, y, delay: def.delay, tLeft: def.dur });
        pl.powers.storm = def.cd;
        emit(world, { e: 'storm', pi, x, y });
        return { ok: true };
      }
      if (cmd.k === 'trump') {
        if (world.units.find((u) => u.id === pl.championId)) return { ok: false, err: 'alive' };
        pl.essence -= def.cost;
        pl.championId = spawnUnit(world, pi, 'champion');
        pl.powers.trump = def.cd;
        emit(world, { e: 'trump', pi });
        return { ok: true };
      }
    }
    return { ok: false, err: 'cmd' };
  }

  /* ---------------- companies ---------------- */
  const coOf = (world, pi, id) => world.players[pi].companies.find((c) => c.id === id) || null;
  /* `want` is a company id, the string 'new', or 0/undefined for the royal War Banner */
  function joinCo(world, pi, want) {
    const pl = world.players[pi];
    if (want === 'new') {
      const co = { id: pl.nextCo++, rally: null };
      pl.companies.push(co);
      return co.id;
    }
    const n = +want || 0;
    return coOf(world, pi, n) ? n : 0;
  }
  /* a company with no hall mustering into it and no men left under it is not a company */
  function pruneCos(world, pi) {
    const pl = world.players[pi];
    pl.companies = pl.companies.filter((co) =>
      pl.buildings.some((b) => b.co === co.id) || world.units.some((u) => u.owner === pi && u.co === co.id));
  }

  /* A standard may be planted ANYWHERE — on a site, or on bare open ground. It is an order
   * to march, not a claim, so there is nothing to validate beyond "is it on the map": if the
   * ground turns out to be unreachable the column walks at it and gets as close as the land
   * allows. Returns {x, y, site} — site is the site id when one was named, else -1 — or null
   * for "no aim given", which means rejoin the War Banner. */
  function aimAt(world, cmd) {
    const s = cmd && cmd.site != null && cmd.site >= 0 ? world.map.sites[cmd.site] : null;
    if (s) return { x: s.x, y: s.y, site: s.id };
    if (!cmd || cmd.x == null || cmd.y == null) return null;
    return { x: Math.max(0, Math.min(C.MAP.W, +cmd.x || 0)),
             y: Math.max(0, Math.min(C.MAP.H, +cmd.y || 0)), site: -1 };
  }

  /* ---------------- units ---------------- */
  function spawnUnit(world, owner, kind, atX, atY, goal, co, from, tier) {
    /* per-owner, so a full army can never starve the muster of Chaos or of the other side */
    let mine = 0;
    for (const u of world.units) if (u.owner === owner) mine++;
    const cap = owner === C.CHAOS_ID ? C.CAP.chaos : C.CAP.player;
    if (cap > 0 && mine >= cap) return 0;
    const def = C.UNITS[kind];
    /* THE HALL'S LEVEL RIDES ON THE MAN. He carries it for life — a veteran mustered before
     * the hall fell is still a veteran — which is also what lets the renderer draw him as
     * one without asking where he came from. */
    const lv = Math.max(1, Math.min(C.TIER.length, tier || 1));
    const vet = owner === C.CHAOS_ID ? 1 : C.TIER[lv - 1];
    const scale = (owner === C.CHAOS_ID ? C.CHAOS.hpScale(world.t) : 1) * vet;
    const home = owner === C.CHAOS_ID ? null : cityOf(world, owner);
    const u = {
      id: world.nextId++, owner, kind,
      x: (atX != null ? atX : home.x) + world.rng.range(-26, 26),
      y: (atY != null ? atY : home.y + (owner === 0 ? -60 : 60)) + world.rng.range(-16, 16),
      ox: world.rng.range(-24, 24), oy: world.rng.range(-24, 24),   // personal formation offset
      hp: def.hp * scale, maxHp: def.hp * scale,
      dmg: def.dmg * (owner === C.CHAOS_ID ? C.CHAOS.dmgScale(world.t) : 1) * vet,
      tier: lv,
      cd: 0,
      goal: goal != null ? goal : (owner === C.CHAOS_ID ? aimAt(world, { site: world.map.cities[world.chaosParity++ % world.players.length] }) : world.players[owner].banner),
      co: co != null ? co : 0,   // the COMPANY it musters into; 0 = under the royal War Banner
      from: from != null ? from : -1   // the hall that raised it, so re-assigning one moves its men
    };
    world.units.push(u);
    return u.id;
  }

  const tierOf = (u) => Math.max(1, Math.min(C.TIER.length, u.tier || 1));
  function hurt(world, victim, dmg, byOwner) {
    victim.hp -= dmg;
    if (victim.hp <= 0 && !victim.dead) {
      victim.dead = true;
      /* the bounty goes to whoever struck the blow — ANY heir. `=== 0 || === 1` was a duel's
       * assumption, and it quietly paid seats 2 and 3 nothing for the whole war. */
      /* a veteran cost more to raise and is worth more to fell */
      if (byOwner >= 0 && world.players[byOwner])
        world.players[byOwner].essence += C.UNITS[victim.kind].bounty * C.TIER[tierOf(victim) - 1];
      /* `by` is what lets the chronicle say who took your men. Without it a report from play
       * cannot tell a rival's assault from the black road, and neither can the player. */
      emit(world, { e: 'die', x: victim.x, y: victim.y, kind: victim.kind, owner: victim.owner, by: byOwner });
    }
  }
  /* ---------------- who is near whom ----------------
   * Target acquisition used to walk EVERY unit for every unit, once a tick. That is fine at
   * a hundred men and quadratic at a thousand — and the muster cap was the only thing keeping
   * the number small. A uniform grid rebuilt once a tick turns it into a look at the nine
   * cells around you, which is what lets the cap go. The cell is the widest aggro on the
   * board, so the nine cells always cover the whole search radius. */
  const BIN = 280;
  function rebin(world) {
    const bins = world.bins || (world.bins = new Map());
    bins.clear();
    const head = world.host || (world.host = []);
    head.length = 0;
    for (let i = 0; i < world.players.length; i++) head.push(0);
    for (const v of world.units) {
      if (v.hp <= 0) continue;
      if (v.owner >= 0) head[v.owner]++;   // how many each heir has standing, counted once
      const k = ((v.y / BIN) | 0) * 100003 + ((v.x / BIN) | 0);
      const cell = bins.get(k);
      if (cell) cell.push(v); else bins.set(k, [v]);
    }
  }
  /* every live unit within `radius` of a point, through the same grid. The visitor may not
   * add or remove units — collect first, act after, as the splash does. */
  function forNear(world, x, y, radius, fn) {
    const gx = (x / BIN) | 0, gy = (y / BIN) | 0, reach = Math.max(1, Math.ceil(radius / BIN));
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const cell = world.bins.get((gy + dy) * 100003 + (gx + dx));
      if (!cell) continue;
      for (const v of cell) if (v.hp > 0) fn(v);
    }
  }
  /* nearest hostile target within radius: units, any standing work, and the Seat-tower at
   * a city. Works are just places now, so a barracks out on the map is besieged exactly
   * like one in the court. */
  function acquire(world, u, radius) {
    /* a fallen heir has nothing left to attack — and their Seat is a ruin, not a target */
    let best = null, bestD = radius, kind = null, bx = 0, by = 0;
    /* A WALL IS OPAQUE. Nothing is a target if stone stands in the way — the soldier looks
     * past it to whatever he CAN see, which is what makes men behind a curtain safe and what
     * sends an army that wants them to the wall itself. Costs nothing until a wall exists. */
    const seen = (x, y, owner, skip) => !world.anyWall
      || !walled(world, u.x, u.y, x, y, u.owner, owner, skip);
    const consider = (d, t2, k, x, y) => { if (d < bestD) { bestD = d; best = t2; kind = k; bx = x; by = y; } };
    const stone = [];   // curtains found on the way: a last resort, not a first choice
    const gx = (u.x / BIN) | 0, gy = (u.y / BIN) | 0;
    /* a radius wider than one cell (the Seat's own garrison sees further) needs a wider ring */
    const reach = Math.max(1, Math.ceil(radius / BIN));
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const cell = world.bins.get((gy + dy) * 100003 + (gx + dx));
      if (!cell) continue;
      for (const v of cell) {
        if (v.hp <= 0 || v.owner === u.owner) continue;
        const d = Math.sqrt(d2(u.x, u.y, v.x, v.y));
        if (d < bestD && seen(v.x, v.y, v.owner)) consider(d, v, 'unit', v.x, v.y);
      }
    }
    for (let ci = 0; ci < world.players.length; ci++) {
      if (ci === u.owner) continue;
      const tp = world.players[ci];
      if (tp.out) continue;
      const cs = world.map.sites[world.map.cities[ci]];
      const dc = Math.sqrt(d2(u.x, u.y, cs.x, cs.y));
      for (const b of tp.buildings) {
        /* the stone you strike is the span in front of you, not the middle of the run */
        const w = isWall(b) && !b.raise, aim = w ? segNear(b, u.x, u.y) : b;
        const d = w ? Math.sqrt(segD2(b, u.x, u.y)) : Math.sqrt(d2(u.x, u.y, b.x, b.y));
        /* YOU STRIKE THE STONE WHEN THERE IS NOTHING ALIVE TO STRIKE. A curtain is always
         * the nearest thing to a man standing at it, so judging walls by distance like any
         * other work meant an assault hacked at the masonry while the parapet above shot
         * down at it untouched — the exact opposite of the bargain. Walls are held back and
         * weighed only if nothing else was found. */
        if (w) { if (d < bestD && seen(aim.x, aim.y, ci, b)) stone.push([d, ci, b.id, aim.x, aim.y]); continue; }
        if (d < bestD && seen(aim.x, aim.y, ci))
          consider(d, { pi: ci, id: b.id }, 'work', aim.x, aim.y);
      }
      if (dc > C.CITY.r + radius) continue;
      if (dc < bestD && seen(cs.x, cs.y, ci)) consider(dc, { pi: ci }, 'tower', cs.x, cs.y);
    }
    if (!best && stone.length) {
      stone.sort((p, q) => p[0] - q[0]);
      const [d, ci, id, ax, ay] = stone[0];
      consider(d, { pi: ci, id }, 'work', ax, ay);
    }
    return best ? { t: best, kind, d: bestD, x: bx, y: by } : null;
  }

  function hurtBuilding(world, pi, id, dmg, by) {
    const pl = world.players[pi], i = pl.buildings.findIndex((b2) => b2.id === id);
    if (i < 0) return;
    const b = pl.buildings[i];
    b.hp -= dmg; b.lastHurt = world.t;
    if (b.hp <= 0) {
      emit(world, { e: 'raze', pi, id: b.id, bt: b.bt, x: b.x, y: b.y, by: by == null ? null : by });
      pl.buildings.splice(i, 1);
      if (isWall(b)) { world.navVersion++; noteWalls(world); }   // a breach is a hole
      if (b.bt === 'shrine') {
        /* throwing the Shrine down tears the walker off the Pattern and costs them ground
         * they have already paid for — the whole point of going after one */
        pl.walking = false;
        if (pl.pattern > 0) {
          pl.pattern = Math.max(0, pl.pattern - C.BUILDINGS.shrine.breakLoss);
          while (pl.alertIdx > 0 && pl.pattern < C.PATTERN_ALERTS[pl.alertIdx - 1].at) pl.alertIdx--;
          emit(world, { e: 'shrinefell', pi, x: b.x, y: b.y, pattern: pl.pattern });
        }
      }
      if (C.BUILDINGS[b.bt].spawns) pruneCos(world, pi);
      /* a fallen mustering hall is a fallen standard: its company rallies to the banner */
      for (const q of world.players) delete q.ghosts[b.id];
    } else if (world.t - (pl.slotAlert || -99) > 12) {
      pl.slotAlert = world.t;
      /* WHO is at the gate. This banner fired for anything that scratched a work, so a
       * rift chewing an outlying Gate read as "the enemy is inside your city" exactly like a
       * rival's assault — and a player watching for the rival never saw the black road
       * taking three quarters of their army. */
      emit(world, { e: 'hurtcity', pi, x: b.x, y: b.y, by: by == null ? null : by });
    }
  }

  /* ---------------- update ---------------- */
  function update(world, dt) {
    if (world.winner !== null || world.paused) return;
    world.t += dt; world.tick++;
    const t = world.t;
    if (world.tick % 6 === 0 || !world.vis) refreshVision(world);   // 5 Hz vision refresh
    /* one pass over the army, so every "what is near me" this tick is a look at nine cells
     * instead of a walk of the whole board. Men mustered DURING the tick are not in it and
     * are simply unseen for a thirtieth of a second, which nothing can tell. */
    rebin(world);

    /* players: income, city buildings, powers, the walk.
     * ROTATE which seat is served first — otherwise seat 0's towers always shoot before the
     * others' within a tick, and seat 0 wins every simultaneous finish. With four of them a
     * flip is not enough; the offset has to walk the whole ring. */
    const np = world.players.length, off = world.tick % np;
    for (let k = 0; k < np; k++) {
      const pi = (k + off) % np;
      const pl = world.players[pi];
      if (pl.out) continue;
      const city = cityOf(world, pi);
      let income = C.BASE_INCOME;
      let drain = 0;   // ACTUAL spend rate this tick — the HUD never lies again
      for (const b of pl.buildings) {
        const def = C.BUILDINGS[b.bt];
        const sp = b;
        /* under construction: the masons work, the shell fills out, and it does nothing else.
         * Damage does not stop the work — it just means there is less of it standing. */
        if (b.raise > 0) {
          b.raise = Math.max(0, b.raise - dt);
          const done = 1 - b.raise / b.raiseFor;
          b.hp = Math.max(b.hp, def.hp * (C.RAISE.hpFrom + (1 - C.RAISE.hpFrom) * done));
          if (b.raise <= 0) {
            /* the ground changes the moment the stone is finished, not when it was paid for */
            if (isWall(b)) { world.navVersion++; noteWalls(world); }
            emit(world, { e: 'raised', pi, id: b.id, bt: b.bt, x: b.x, y: b.y });
          }
          continue;
        }
        if (b.hp < b.maxHp && t - b.lastHurt > 10) b.hp = Math.min(b.maxHp, b.hp + C.STRUCT_REGEN * dt);
        /* THE MASONS ARE IN THE YARD. A work being raised a level is still a work — it stands,
         * it blocks, it sees, it holds its spring, and it can be broken — but it does not do
         * its JOB while they are on it: no muster, no shot, no income. That is what makes the
         * timing of an upgrade a decision rather than a formality. */
        if (b.work > 0) {
          b.work = Math.max(0, b.work - dt);
          if (b.work <= 0) emit(world, { e: 'upped', pi, id: b.id, bt: b.bt, level: b.level, x: b.x, y: b.y });
        }
        const working = b.work > 0;
        /* a Gate on a spring of Shadow draws far more than one that merely stands about */
        if (b.bt === 'gate') income += !working && b.node >= 0 ? def.nodeIncome[b.level - 1] : 0;
        else if (def.spawns) {
          if (pl.musterPaused) { b.cd = Math.max(b.cd, 0.5); continue; }
          /* A HALL BEING RAISED A LEVEL MUSTERS NOBODY. That is the price of the upgrade
           * beyond its essence, and the reason to think about WHEN rather than only whether:
           * the men you would have had while the masons were in the yard are the real cost. */
          if (b.work > 0) { b.cd = Math.max(b.cd, 0.5); continue; }
          const price = C.UNITS[def.spawns].cost * C.TIER[b.level - 1];
          const per = def.period[b.level - 1];
          b.paid = b.paid || 0;
          /* recruits are paid for CONTINUOUSLY: the treasury drains smoothly, and a poor
           * treasury slows the muster instead of silently skipping it */
          const pay = Math.min((price / per) * dt, Math.max(0, price - b.paid), pl.essence);
          if (pay > 0) { pl.essence -= pay; b.paid += pay; drain += pay / dt; }
          b.cd -= dt;
          if (b.cd <= 0) {
            if (b.paid >= price - 1e-6) {
              /* A RECRUIT REFUSED IS A RECRUIT UNPAID. spawnUnit turns men away at the cap,
               * and the price was being taken anyway — an army standing at its ceiling paid
               * a measured 6 essence a second for soldiers who never appeared. Take the
               * money only when a man actually walks out of the hall. */
              if (spawnUnit(world, pi, def.spawns, sp.x, sp.y, undefined, b.co, b.id, b.level)) {
                b.paid -= price;
                b.cd += per;
              } else b.cd = 0.5;   // full up: try again shortly, and keep the war chest
            } else b.cd = 0;   // timer ready; the recruit marches the moment he's paid
          }
        } else if (b.bt === 'tower') {
          if (working) continue;   // the gun deck is scaffolding while they are rebuilding it
          b.cd -= dt;
          if (b.cd <= 0) {
            const st = towerStats(b);
            let best = null, bd = st.range * st.range;
            /* A TOWER SHOOTS OVER STONE. Curtain walls stop arrows thrown by men on the
             * ground; they do not stop a gun standing higher than they are. So a tower is
             * worth having behind a wall, and a wall is no answer to a tower. */
            forNear(world, sp.x, sp.y, st.range, (u) => {
              if (u.owner === pi) return;
              const dd = d2(u.x, u.y, sp.x, sp.y);   // a tower guards ITS OWN ground
              if (dd < bd) { bd = dd; best = u; }
            });
            if (best) {
              hurt(world, best, st.dmg, pi);
              /* the cannon answers the column, not the man: the burst falls off away
               * from the ball, so a crowd bleeds but no single foe dies to the splash */
              if (st.splash > 0 && st.splashDmg > 0) {
                const r2 = st.splash * st.splash, hits = [];
                forNear(world, best.x, best.y, st.splash, (u) => {
                  if (u.owner === pi || u === best) return;
                  if (d2(u.x, u.y, best.x, best.y) < r2) hits.push(u);
                });
                for (const u of hits) hurt(world, u, st.splashDmg, pi);
              }
              emit(world, { e: 'shot', pi, id: b.id, x: b.x, y: b.y, to: { x: best.x, y: best.y }, br: b.br || null, splash: st.splash });
              b.cd = st.atk;
            } else b.cd = 0.15;
          }
        }
      }
      /* the solo handicap: an heir set to an easier footing simply draws less from the same
       * ground. It plays its own game exactly as it would otherwise — it is just poorer. */
      income *= pl.eco;
      pl.essence += income * dt;
      pl.incomeRate = income;
      pl.drainRate = drain;   // muster + walk upkeep — the HUD tells the truth
      if (pl.powers.storm > 0) pl.powers.storm -= dt;
      if (pl.powers.trump > 0) pl.powers.trump -= dt;

      const sdef = C.BUILDINGS.shrine;
      let channelled = false;
      if (pl.walking) {
        const shrine = pl.buildings.find((b) => b.bt === 'shrine');
        if (!shrine) pl.walking = false;
        else {
          const want = sdef.drain[shrine.level - 1] * dt;
          /* pay what you can and walk that far. All-or-nothing froze a poor walker at 1%
           * forever — income 4/s against a drain of 12/s meant the Pattern, the game's
           * absolute clock, simply stopped ticking. */
          const pay = Math.min(want, pl.essence);
          if (pay > 0) {
            channelled = true;
            pl.essence -= pay;
            pl.drainRate += pay / dt;   // actual, not theoretical
            /* THE CLOCK MUST TICK. Paying proportionally is right, but at income 5 against a
             * drain of 32 it advances a walk by a sixth of a percent a minute, and a clock
             * that slow is a stopped one — every match measured running to the 45-minute cap
             * had a walker broke for 90-95% of it. Below `minRate` the Pattern carries you
             * anyway. You still pay every penny you have; you simply cannot be frozen. */
            const share = Math.max(sdef.minRate, pay / want);
            pl.pattern += sdef.rate[shrine.level - 1] * dt * share;
            while (pl.alertIdx < C.PATTERN_ALERTS.length && pl.pattern >= C.PATTERN_ALERTS[pl.alertIdx].at) {
              emit(world, { e: 'pattern', pi, idx: pl.alertIdx }); pl.alertIdx++;
            }
            if (pl.pattern >= 100) { win(world, pi, 'pattern'); return; }
          }
        }
      }
      /* THE LINES FADE WHEN NOBODY WALKS THEM. A walk is a thing you hold, not a balance you
       * bank: stop channelling — by choice, by poverty, or because somebody threw your Shrine
       * down — and the Pattern lets go of you. Without this the Shrine was a savings account
       * and an assault on a walker bought the attacker nothing they could not simply rebuy. */
      if (!channelled && pl.pattern > 0) {
        pl.pattern = Math.max(0, pl.pattern - sdef.decay * dt);
        /* the alerts speak again if they climb back past the mark */
        while (pl.alertIdx > 0 && pl.pattern < C.PATTERN_ALERTS[pl.alertIdx - 1].at) pl.alertIdx--;
      }
    }

    /* chaos director: rifts at road sites (springs too, once surging) */
    if (t >= world.chaosNext) {
      /* There is no black road to tear along any more. Rifts open at the springs and the
       * high places — the ground worth holding — so forward country has a price. */
      const pool = world.map.sites.filter((s) => s.kind !== 'city').map((s) => s.id);
      const at = world.map.sites[pool[Math.floor(world.rng.next() * pool.length)]] ||
                 world.map.sites[world.map.cities[0]];
      const n = C.CHAOS.count(t);
      emit(world, { e: 'rift', x: at.x, y: at.y });
      for (let i = 0; i < n; i++) spawnUnit(world, C.CHAOS_ID, 'fiend', at.x, at.y);
      world.chaosNext = t + C.CHAOS.interval(t);
    }
    if (!world.surged && t > 600) { world.surged = true; emit(world, { e: 'surge' }); }

    /* storms */
    for (let i = world.storms.length - 1; i >= 0; i--) {
      const s = world.storms[i];
      if (s.delay > 0) { s.delay -= dt; continue; }
      s.tLeft -= dt;
      const def = C.POWERS.storm;
      for (const u of world.units) {
        if (u.hp <= 0 || u.owner === s.owner) continue;
        if (d2(u.x, u.y, s.x, s.y) < def.radius * def.radius) hurt(world, u, def.dps * dt, s.owner);
      }
      if (s.tLeft <= 0) world.storms.splice(i, 1);
    }

    /* units: fight what's near, else march the paths toward the banner/goal */
    const n = world.units.length, fwd = world.tick % 2 === 0;   // alternate order: no first-strike seat bias
    for (let ii = 0; ii < n; ii++) {
      const u = world.units[fwd ? ii : n - 1 - ii];
      if (u.hp <= 0) continue;
      const def = C.UNITS[u.kind];
      u.cd -= dt;
      /* the banner moves the army */
      if (u.owner !== C.CHAOS_ID) {
        const pl2 = world.players[u.owner];
        const co = u.co ? coOf(world, u.owner, u.co) : null;   // its company, if it still exists
        const want = co && co.rally ? co.rally : pl2.banner;
        if (u.goal !== want) u.goal = want;
      }
      /* garrisons of an open city still see farther out */
      const home = u.owner !== C.CHAOS_ID && d2(u.x, u.y, cityOf(world, u.owner).x, cityOf(world, u.owner).y) < C.CITY.r * C.CITY.r;
      /* ON THE PARAPET. A man up against his own curtain fights from the top of it: he
       * throws over the stone, `over` far, and is seen and shot at in return. That is the
       * only way a wall kills anything, and the price of it is that the men who make it kill
       * are the men who can be killed. */
      const par = manning(world, u);
      /* WHICH WALL HE IS STANDING ON, for everyone downstream. The parapet was a rule with
       * nothing to see: a man on the wall fought from the wall and was drawn in the grass
       * beside it, so the one bargain the whole design rests on was invisible. The renderer
       * lifts him onto the stone from this, and it rides the wire so a guest sees it too. */
      u.man = par ? par.id : 0;
      const foe = acquire(world, u, Math.max(def.aggro, par ? C.WALL.over : 0) + (home ? 140 : 0));
      if (foe) {
        const rng = par ? Math.max(def.range, C.WALL.over) : def.range;
        const reach = rng + (foe.kind === 'unit' ? C.UNITS[foe.t.kind].size
          : foe.kind === 'tower' ? 36 : C.BUILD.foot - 8);
        if (foe.d <= reach) {
          if (u.cd <= 0) {
            /* an Engine's blow is made for stone: `siege` multiplies it against a work or a
             * Seat and against nothing else, which is what makes the Works a siege train
             * rather than simply better soldiers */
            const wall = u.dmg * (def.siege || 1);
            if (foe.kind === 'unit') hurt(world, foe.t, u.dmg, u.owner);
            else if (foe.kind === 'work') hurtBuilding(world, foe.t.pi, foe.t.id, wall, u.owner);
            else if (foe.kind === 'tower') {
              const tp = world.players[foe.t.pi];
              tp.castleHp -= wall;
              emit(world, { e: 'siege', pi: foe.t.pi, x: u.x, y: u.y });
              if (tp.castleHp <= 0 && !tp.out) { if (topple(world, foe.t.pi, u.owner)) return; }
            }
            u.cd = def.atk;
            if (rng > 40) emit(world, { e: 'bolt', from: { x: u.x, y: u.y, owner: u.owner }, to: { x: foe.x, y: foe.y } });
          }
        } else {
          const mv = def.speed * dt / (foe.d || 1);
          u.x += (foe.x - u.x) * mv; u.y += (foe.y - u.y) * mv;
          if (world.anyWall) shove(world, u);
        }
        continue;
      }
      /* march: the flow field carries the column; within sight of the goal each soldier
       * peels off to his own place in the line, so an army arrives spread, not stacked */
      const gs = u.goal;
      if (gs) {
        let gx = gs.x + u.ox, gy = gs.y + u.oy;
        /* Troops ordered home muster in the COURT, not on the tower's own ground. The Seat
         * stands on that ground and an army standing with it simply vanishes under the
         * castle — which is what happened when the walls went and took the garrison's ring
         * with them. A stable per-soldier angle keeps the ring even instead of jostling. */
        let muster = 0;   // >0 once the goal is a place in the ring: how far the ground reaches
        if (u.owner !== C.CHAOS_ID) {
          const cs = cityOf(world, u.owner);
          if (d2(gs.x, gs.y, cs.x, cs.y) < C.CITY.seatR * C.CITY.seatR) {
            const ang = (u.id * 2.39996) % (Math.PI * 2);          // golden angle: no clumps
            /* AND THE MUSTER SPREADS WITH THE ARMY. Four fixed rings held a hundred and
             * thirty men in the same ground twenty stood in, which is a single storm's disc
             * over a quarter of your force — reported from play, and measured at 31 dead in
             * one cast. The ring count follows the host, so a bigger army is a wider one and
             * a blow that lands on it costs proportionally less. */
            const host = (world.host && world.host[u.owner]) || 1;
            const rings = Math.max(4, Math.min(14, Math.ceil(host / 22)));
            const rr = C.CITY.seatR + 24 + (u.id % rings) * 17;
            gx = cs.x + Math.cos(ang) * rr; gy = cs.y + Math.sin(ang) * rr;
            /* The whole ring is muster ground, not just the last few strides. Judging it by
             * NAV.arrive around the Seat CENTRE instead put every soldier in a 30 Hz loop:
             * step outward toward his own place, cross out of the field's arrival circle,
             * get dragged back to the middle, repeat — which is what the shivering ranks
             * under the tower were. Reach past the outermost place and the handover happens
             * once. */
            muster = rr + C.NAV.arrive;
          }
        }
        const dgoal = Math.sqrt(d2(u.x, u.y, gx, gy));
        /* the flow field is drawn to the ORDER's point; a soldier's own place in the line is
         * somewhere near it. Once he is on the muster ground, walk to his place directly —
         * the field cannot carry him there, and at the Seat it would even hold him in the
         * middle, since by the field's reckoning he has already arrived. */
        const dField = Math.sqrt(d2(u.x, u.y, gs.x, gs.y));
        let vx = 0, vy = 0;
        if (dgoal < C.NAV.arrive || dField < C.NAV.arrive || (muster && dField < muster)) {
          if (dgoal > 4) { vx = (gx - u.x) / dgoal; vy = (gy - u.y) / dgoal; }
        } else {
          const s3 = NAV.steer(world.nav, world, u.owner, gs.x, gs.y, u.x, u.y);
          if (s3) { vx = s3.x; vy = s3.y; }
          else {
            /* No route the grid will admit — the goal may be a crag, a lake, or simply
             * beyond a barrier. Head at it anyway and let the terrain decide how far you
             * get. A standard planted on impassable ground is an order to try, not an
             * error to refuse. */
            const db = Math.sqrt(d2(u.x, u.y, gx, gy)) || 1;
            vx = (gx - u.x) / db; vy = (gy - u.y) / db;
          }
        }
        u.x += vx * def.speed * dt; u.y += vy * def.speed * dt;
        if (world.anyWall) shove(world, u);
      }
    }

    /* bury the dead */
    for (let i = world.units.length - 1; i >= 0; i--) {
      if (world.units[i].hp <= 0) {
        const u = world.units[i];
        if (u.kind === 'champion') { const pl = world.players[u.owner]; if (pl && pl.championId === u.id) pl.championId = 0; }
        world.units.splice(i, 1);
      }
    }
  }

  /* A Seat falls. In a duel that ends it. In a free-for-all it puts one heir OUT — their
   * works and their men go with them, and the throne waits for whoever is left last. */
  function topple(world, pi, by) {
    const pl = world.players[pi];
    pl.out = true; pl.castleHp = 0;
    /* a fallen heir's stone falls with him. In a duel this never mattered — the match ends
     * on the same tick — but in a free-for-all his curtains would have gone on barring the
     * ground and stopping shots for the rest of the game, with no wall left standing to
     * explain why. */
    const hadWall = pl.buildings.some(isWall);
    pl.buildings.length = 0;
    if (hadWall) { world.navVersion++; noteWalls(world); }
    pl.walking = false;
    for (let i = world.units.length - 1; i >= 0; i--) if (world.units[i].owner === pi) world.units.splice(i, 1);
    for (const q of world.players) for (const id of Object.keys(q.ghosts)) if (q.ghosts[id].owner === pi) delete q.ghosts[id];
    emit(world, { e: 'fall', pi, by: by === C.CHAOS_ID ? -1 : by });
    const left = world.players.map((q, k) => (q.out ? -1 : k)).filter((k) => k >= 0);
    if (left.length <= 1) {
      /* the last heir standing takes it — and if Chaos took the last two, nobody does */
      win(world, left.length ? left[0] : (by === C.CHAOS_ID ? -1 : by), 'castle');
      return true;
    }
    return false;
  }

  function win(world, winner, reason) {
    world.winner = winner; world.winReason = reason;
    emit(world, { e: 'win', winner, reason });
  }

  global.World = { createWorld, applyCommand, update, upgradeCost, towerStats, canSee, cityOf,
                   visionSources, walkers, placementError, inClaim, nodeAt, nodeHolder, bldOf,
                   newSeenMask, markSeen, hurtBuilding, masons, rising, wallError, wallEnds,
                   wallCrews, wallReach };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.World;
})(typeof window !== 'undefined' ? window : globalThis);

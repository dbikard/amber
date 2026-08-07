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
  /* PROPER intersection: the two segments pass THROUGH each other. Touching does not count,
   * and the difference is a whole fortification. Written as `(d1 > 0) !== (dd2 > 0)` a zero
   * silently grouped with the negatives, so a run that merely began at the end of an existing
   * one read as crossing it — for about half of the directions it could leave in, which is
   * why it looked like bad luck rather than a rule. A curtain could not turn a corner: every
   * second stretch came back 'too close to another work' and the only way to build an angle
   * was two disconnected runs with a gap a man walks through. A shared endpoint is what a
   * corner IS. */
  function crosses(ax, ay, bx, by, cx, cy, dx, dy) {
    const s = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
    const opp = (u, v) => (u > 0 && v < 0) || (u < 0 && v > 0);
    return opp(s(cx, cy, dx, dy, ax, ay), s(cx, cy, dx, dy, bx, by)) &&
           opp(s(ax, ay, bx, by, cx, cy), s(ax, ay, bx, by, dx, dy));
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
      vis: null,                // per-viewer vision cache: [ {g,gw,gh,cell} mask per seat ]
      visSrc: null,             // ...and the raw source lists the masks were cast from
      sight: null               // what the land does to a sight line, baked per fog cell
    };
    world.nav = NAV.build(world.map.gen);
    bakeSight(world);
    /* EVERY HEIR OPENS WITH A GATE ON HIS OWN SPRING — finished, drawing, and standing where
     * worldgen proved a Gate could stand. It is the first mason too: crews are hired one per
     * Gate now, so an heir who began with none would begin unable to build at all. */
    const hg = (world.map.gen && world.map.gen.homeGates) || [];
    for (let pi = 0; pi < world.players.length; pi++) {
      const g = hg[pi];
      if (!g) continue;
      const def = C.BUILDINGS.gate;
      /* on the spring, not on its bank — the same rule the build command follows */
      const gs = world.map.sites[g.site];
      world.players[pi].buildings.push({
        id: world.nextId++, bt: 'gate', level: 1, x: gs ? gs.x : g.x, y: gs ? gs.y : g.y,
        cd: 0, raise: 0, raiseFor: def.raise, hp: def.hp, maxHp: def.hp, lastHurt: -99,
        node: g.site, co: 0
      });
    }
    /* AND WITH A HALL. A Seat with no muster is an heir who spends his first half-minute
     * raising the one work he was always going to raise first — the same opening every match,
     * chosen by nobody. The board hands it over and the choosing starts at the second work.
     * It flies its own standard, because `joinCo` never returns 0, so the flag tray has a chip
     * in it from the first frame rather than after the first hall finishes. */
    for (let pi = 0; pi < world.players.length; pi++) {
      const spot = openingHall(world, pi);
      if (!spot) continue;
      const def = C.BUILDINGS.barracks;
      const b = { id: world.nextId++, bt: 'barracks', level: 1, x: spot.x, y: spot.y,
                  cd: def.period[0] * 0.5, raise: 0, raiseFor: def.raise,
                  hp: def.hp, maxHp: def.hp, lastHurt: -99, node: -1, co: 0 };
      b.co = joinCo(world, pi, undefined);
      world.players[pi].buildings.push(b);
    }
    for (let pi = 0; pi < world.players.length; pi++)
      world.players[pi].banner = aimAt(world, { site: world.map.cities[pi] });
    refreshVision(world);   // you know your own surroundings from the start
    return world;
  }

  /* WHERE THE OPENING HALL STANDS. Searched rather than given, because the only ground that
   * will take it is whatever this seed left around the Seat — but searched in a FIXED order
   * from a fixed ring outward, so every seat on every machine puts it in the same place. It
   * asks the same questions the build command asks, minus the masons, who have not been hired
   * yet when this runs. */
  function openingHall(world, pi) {
    const c = cityOf(world, pi);
    const mid = { x: C.MAP.W / 2, y: C.MAP.H / 2 };
    /* facing the middle of the board: the hall belongs between the Seat and the war, not
     * tucked behind it where its muster has the length of the map to walk */
    const base = Math.atan2(mid.y - c.y, mid.x - c.x);
    for (let rad = C.CITY.seatR + C.BUILD.foot + 12; rad <= C.CLAIM.seat - C.BUILD.foot; rad += 22)
      for (let k = 0; k < 36; k++) {
        /* 0, +10°, -10°, +20°, -20° ... so the first spot that fits is the one nearest facing */
        const th = base + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * (Math.PI / 18);
        const x = c.x + Math.cos(th) * rad, y = c.y + Math.sin(th) * rad;
        if (!groundBears(world, x, y)) continue;
        if (!inClaim(world, pi, x, y)) continue;
        if (!clearOfWorks(world, x, y, null)) continue;
        if (nodeAt(world, x, y)) continue;      // a spring is a Gate's ground, not a hall's
        return { x, y };
      }
    return null;
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
  /* A TOWER MAY BE BUILT INTO YOUR OWN CURTAIN. Which wall, if any, a work at this point
   * would stand on — a tower raised astride a run is part of it, and that is what lets it
   * shoot over the stone instead of at the back of it. */
  function wallUnder(world, pi, x, y) {
    const r2 = C.WALL.join * C.WALL.join;
    let best = null, bd = r2;
    /* the heir's OWN stone, scaffolding included — `world.walls` holds only finished runs, and
     * going by that list meant a curtain could not be given its gatehouse until the masons
     * were out of it, which is precisely when you want to plan one. Rubble is not stone: a
     * ruin is ground waiting to be cleared, not a run to build into. */
    for (const b of world.players[pi].buildings) {
      if (!isWall(b) || b.breach) continue;
      const dd = segD2(b, x, y);
      if (dd < bd) { bd = dd; best = b; }
    }
    return best;
  }
  function clearOfWorks(world, x, y, pi) {
    const need = C.BUILD.foot * 2 + C.BUILD.gap;
    const on = pi != null ? wallUnder(world, pi, x, y) : null;
    const near = C.WALL.join * C.WALL.join;
    for (let q = 0; q < world.players.length; q++)
      for (const b of world.players[q].buildings) {
        /* A RUN CROWDS BY ITS LENGTH, NOT BY ITS MIDDLE. A wall is stored by its midpoint so
         * that every point-shaped consumer keeps working, but nothing about a two-hundred-foot
         * curtain is at its middle: measured as a point it left the whole length of a long run
         * free ground to build astride, and refused the one spot anybody actually wants a
         * tower. The radius is WALL.join, the same one the snap uses, so a tap too near the
         * stone to stand beside it is by definition a tap ON the stone. */
        if (isWall(b)) {
          /* the run you are joining does not crowd you out of it — and neither does any other
           * run of your own, or the corner where two curtains meet could hold no tower */
          if (on && q === pi) continue;
          if (segD2(b, x, y) < near) return false;
          continue;
        }
        /* a tower already up on the same run still needs its own room on it */
        if (d2(x, y, b.x, b.y) < need * need) return false;
      }
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
    /* the last crew never leaves: with no Gates there are no crews, and with no crews there is
     * no raising the Gate that hires one. See MASONS.floor — it bites at zero Gates and
     * nowhere else. */
    return Math.max(C.MASONS.floor,
                    Math.min(C.MASONS.max, C.MASONS.base + Math.floor(gates / C.MASONS.per)));
  }
  /* HOW MANY CREWS A WORK HAS ON IT. Everything but a wall takes one. A CURTAIN IS PAID FOR
   * BY THE FOOT: there is no longest run any more — there is only how many crews you can put
   * on one at once, so the length a heir can raise IS his mason count, and it grows with the
   * Gates he holds like everything else does. */
  /* TWO DIFFERENT QUESTIONS, and they used to share one answer. HOW MUCH WALL is continuous —
   * the price, the stone and the upgrade all go by the run's length, so a short stretch across
   * a gap costs what a short stretch is worth. HOW MANY CREWS is an integer, because you
   * cannot put two thirds of a crew on anything, and it is the integer that is rationed.
   * Rounding the first up to the second billed every run under WALL.unit as a full one. */
  const wallUnits = (len) => Math.max(0, len) / C.WALL.unit;
  const wallCrews = (len) => Math.max(1, Math.ceil(wallUnits(len)));
  const crewsOn = (b) => (b.crews || 1);
  /* how much STONE a work is, in run-lengths: 1 for everything that is not a wall */
  const sizeOf = (b) => (b.units != null ? b.units : (b.crews || 1));
  function rising(world, pi) {
    let n = 0;
    /* a work RISING takes crews, and so does a breach being MENDED — that is masonry putting
     * stone back. A level does not: see the note on the `up` command. */
    for (const b of world.players[pi].buildings) if (b.raise > 0 || b.work > 0) n += crewsOn(b);
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
  /* WHO IS ON THE WALL IS A ROSTER, NOT A DISTANCE. It used to be "anyone within `man` of his
   * own curtain", which meant a hundred men crowding one stretch were all on the parapet at
   * once — every one of them shooting over it, every one of them exposed, standing in each
   * other. A run holds one man per `berth` of length and no more; `u.man` is the wall he
   * holds a place on, set by postWalls, and everyone else is at the FOOT of it. */
  function manning(world, u) {
    if (!u.man || u.owner === C.CHAOS_ID) return null;
    for (const w of world.walls) if (w.b.id === u.man) return w.b;
    return null;
  }
  /* THE ROSTER, once a tick. Every man ordered to a curtain is ranked by id — a stable order,
   * so the line does not reshuffle itself every frame — and the first `berths` of them take
   * the parapet. The rest are not turned away: they stand at the foot, in rows behind the
   * stone, sheltered and waiting for a place. */
  /* STONE IS FOR SHOOTERS. A parapet is a shooting platform, and a swordsman standing on one
   * was only ever a man in the open with further to fall — he could not reach anything the
   * wall was keeping away from him, and he took the berth an archer needed. Only a unit the
   * table marks `mans` may hold a place on a wall or a room in a tower; everyone else still
   * gets a `post`, and still stations at the FOOT of the run in cover, which is where a
   * Shieldwall belongs. A flag rather than a reach threshold on purpose: an Engine throws 150
   * and a Bombard 365, and a siege train does not climb a curtain. */
  const mans = (u) => !!C.UNITS[u.kind].mans;
  /* ONE PASS OWNS THE POSTING, because two of them owning half of it each did not work: both
   * cleared `u.tow` at their own start, so whichever ran second wiped what the first had just
   * decided. Cleared once here, then the runs are dealt (bastions included), then the towers
   * standing on open ground take whoever is still free. */
  function postAll(world) {
    for (const u of world.units) { if (u.man) u.man = 0; if (u.tow) u.tow = 0; }
    if (world.anyWall) postWalls(world);
    postTowers(world);
    /* a man INSIDE holds his room only while the roster still deals him that tower — the flag
     * moves on, or a place is given away, and he steps out where he stood. `in` is never set
     * here; only crossing the threshold sets it (the march), and only losing the room or the
     * tower (here, and the spill) clears it. */
    for (const u of world.units) if (u.in && u.in !== u.tow) u.in = 0;
  }
  function postWalls(world) {
    const rosters = new Map();
    const reach = C.WALL.man * 1.5;
    for (const u of world.units) {
      if (u.hp <= 0 || u.owner === C.CHAOS_ID) continue;
      /* the order he is UNDER, worked out here rather than read off u.goal — the goal is
       * assigned in the march loop, which runs after this, so reading it would post the whole
       * army one tick late and leave a man mustered this tick with no station at all */
      const pl3 = world.players[u.owner];
      const co3 = u.co ? coOf(world, u.owner, u.co) : null;
      const gs = foldOrder(world, co3 && co3.rally ? co3.rally : pl3.banner);
      if (!gs) continue;
      let post = null, pd = reach;
      for (const w of world.walls) {
        if (w.owner !== u.owner) continue;
        const dd = Math.sqrt(segD2(w.b, gs.x, gs.y));
        if (dd < pd) { pd = dd; post = w; }
      }
      if (!post) { u.post = 0; continue; }
      u.post = post.b.id;
      let list = rosters.get(post.b.id);
      if (!list) { list = []; rosters.set(post.b.id, list); }
      list.push(u);
    }
    for (const [id, list] of rosters) {
      const w = world.walls.find((q) => q.b.id === id);
      if (!w) continue;
      /* SHOOTERS FIRST, then a stable line by id — not a nightly reshuffle. The sort is what
       * puts the archers on the parapet whatever their ids, and leaves the swordsmen behind
       * them in the rows at the foot rather than blocking berths they cannot use. */
      list.sort((p, q) => (mans(q) - mans(p)) || (p.id - q.id));
      const L = Math.hypot(w.bx - w.ax, w.by - w.ay) || 1;
      const berths = Math.max(2, Math.round(L / C.WALL.berth));
      /* A BASTION IS PART OF THE RUN. A tower built INTO a curtain used to be filled by its own
       * pass, on its own rule — how near the order fell to the TOWER — so a company told to
       * hold the wall lined the parapet, left the bastions on it empty, and the men who could
       * have been in the safest place on the board stood in the open beside it. The towers on
       * this run are places on this run: the roster is dealt round the parapet and every tower
       * standing in it together, so both fill at once rather than one filling first. Dealt in
       * that order — a place on the stone, then a room in each tower, and round again — because
       * a wall with nobody on it is a wall nobody shoots over. */
      const towers = world.players[w.owner].buildings.filter(
        (b) => b.bt === 'tower' && !b.raise && !b.work && b.onWall === id);
      const places = [];
      for (let i = 0; i < Math.max(berths, C.TOWER.berths); i++) {
        if (i < berths) places.push({ man: id });
        for (const t of towers) if (i < C.TOWER.berths) places.push({ tow: t.id });
      }
      /* `station` reads ONE number: a `berth` below `berths` is a place on the parapet, and
       * anything above it is a row at the foot. So the two are counted separately — a man given
       * a room in a tower is stationed by the tower and takes neither. Handing out the roster
       * index instead put the third man at the foot in the eighth row because five shooters had
       * gone up ahead of him. */
      let take = 0, parapet = 0, foot = 0;
      for (const u of list) {
        /* only a shooter may take a place, and the queue is only spent when one does: a
         * swordsman at the head of the roster must not consume a berth on his way to the foot */
        if (mans(u) && take < places.length) {
          const p = places[take++];
          if (p.man) { u.man = p.man; u.berth = parapet++; }
          else u.tow = p.tow;
          continue;
        }
        u.berth = berths + foot++;
      }
      w.berths = berths;
    }
  }
  /* where a man posted to this wall should stand — on the parapet if he has a berth, at the
   * foot in rows behind it if he does not */
  function station(world, u, w) {
    const L = Math.hypot(w.bx - w.ax, w.by - w.ay) || 1;
    const berths = w.berths || Math.max(2, Math.round(L / C.WALL.berth));
    const ux = (w.bx - w.ax) / L, uy = (w.by - w.ay) / L;
    const cs = cityOf(world, u.owner);
    let nx = -uy, ny = ux;
    if (nx * (cs.x - w.b.x) + ny * (cs.y - w.b.y) < 0) { nx = -nx; ny = -ny; }
    /* ...unless the heir has turned the run about. Facing home is the right guess for the one
     * curtain drawn across the road to your Seat and the wrong one for every other, so the
     * `flip` order overrules it — see the command. */
    if (w.b.flip) { nx = -nx; ny = -ny; }
    const i = u.berth || 0;
    if (i < berths) {
      const t = ((i % berths) + 0.5) / berths, off = C.WALL.man * 0.45;
      return { x: w.ax + (w.bx - w.ax) * t + nx * off, y: w.ay + (w.by - w.ay) * t + ny * off };
    }
    /* THE FOOT OF THE WALL. Rows behind it, filling outward — the reserve, in cover, where a
     * man who cannot get up is at least not standing in the field being shot. */
    const over = i - berths;
    const row = Math.floor(over / berths) % C.WALL.rows;
    const t = ((over % berths) + 0.5) / berths;
    const off = C.WALL.man * 0.45 + C.WALL.foot * (row + 1);
    return { x: w.ax + (w.bx - w.ax) * t + nx * off, y: w.ay + (w.by - w.ay) * t + ny * off };
  }
  /* ---------------- the tower garrison ----------------
   * A TOWER IS A ROOM, not a firing step. It shot on its own and men stood in the grass beneath
   * it, which made a Watchtower a thing you built INSTEAD of defending a spot rather than a
   * thing you defended it FROM. Shooters go INSIDE — `TOWER.berths` of them, and no more,
   * because it is a room — and from up there they throw `TOWER.over`, further than any of them
   * can on the ground. The tower's own gunnery is untouched: the garrison shoots AS WELL AS the
   * tower, which is what makes filling one worth the men.
   *
   * AND THE STONE IS THEIR SHIELD. Nothing can touch a man while he is inside (see `hurt`) —
   * the only way to them is to bring the tower down, and when it comes down they are in the
   * field again on that tick, where it stood, with whatever they had left. That is the whole
   * bargain: a tower full of archers is the safest and furthest-shooting place on the board and
   * it is also a single work with a single hit-point bar, so an assault that concentrates on it
   * gets all of them at once.
   *
   * Ordered by the same rule as a wall — the ORDER a man is under, not where he happens to be
   * — so filling a tower is something you decide rather than something that happens. A tower
   * standing IN a curtain is not this pass's business: it is a place on that run, dealt with
   * the parapet by `postWalls`, or a company told to hold the wall would line the stone and
   * leave the bastions on it empty. */
  function postTowers(world) {
    const rosters = new Map();
    for (const u of world.units) {
      if (u.hp <= 0 || u.owner === C.CHAOS_ID || !mans(u)) continue;
      if (u.man || u.tow) continue;             // already given a place by the run he was sent to
      const pl3 = world.players[u.owner];
      const co3 = u.co ? coOf(world, u.owner, u.co) : null;
      const gs = foldOrder(world, co3 && co3.rally ? co3.rally : pl3.banner);
      if (!gs) continue;
      let post = null, pd = C.TOWER.man;
      for (const b of pl3.buildings) {
        if (b.bt !== 'tower' || b.raise > 0 || b.work > 0 || b.onWall) continue;
        const dd = Math.sqrt(d2(b.x, b.y, gs.x, gs.y));
        if (dd < pd) { pd = dd; post = b; }
      }
      if (!post) continue;
      let list = rosters.get(post.id);
      if (!list) { list = []; rosters.set(post.id, list); }
      list.push(u);
    }
    for (const [id, list] of rosters) {
      list.sort((p, q) => p.id - q.id);      // a stable garrison: the same men hold it
      for (let i = 0; i < list.length && i < C.TOWER.berths; i++) list[i].tow = id;
    }
  }
  /* There is no towerStation and no per-man slot any more. It placed the garrison in a ring
   * around the crown, from the days when assignment WAS entry; since "the rim is the door"
   * (v0.9.11) an assigned man marches to the tower like anyone marches anywhere and stops
   * existing on the field the tick he crosses it — grepped the tree, nothing read the slot but
   * the ring geometry itself, so the slot came off the unit and off the wire with it. */
  const towerOf = (world, u) => {
    if (!u.tow) return null;
    return world.players[u.owner].buildings.find((b) => b.id === u.tow) || null;
  };
  /* IS THERE STONE BETWEEN THEM? Every finished wall the line crosses blocks it — with one
   * exception, and the whole design rests on it: a wall does not hide a man who is manning
   * IT. Come up to your own parapet and you can shoot out; the same stone that was covering
   * you stops covering you, and the field can shoot back. Standing off behind it, you are
   * safe and useless. `skip` is the wall being shot AT, which cannot block the shot at
   * itself. */
  /* IS THERE ROCK BETWEEN THEM? The terrain's answer to `walled`: a shot does not cross a
   * CLIFF cell. Judged on the NAV grid, not the fog grid — a shot deserves the finer 20-unit
   * cell, and the fog bake's majority rule exists to price whole cells for the EYE, which
   * would let an arrow slip through ground the archer can plainly see is stone. Sampled
   * every half nav-cell so no cliff a segment crosses can fall between samples. The
   * endpoints' own cells are skipped by construction (i runs 1..steps-1 and anything inside
   * touching range returns early): neither shooter nor mark stands ON rock, and a man shoved
   * against a cliff foot must not become unhittable. Water does NOT block a shot — an arrow
   * crosses a pool that a man cannot. */
  function rockBetween(world, ax, ay, bx, by) {
    const nav = world.nav, cw = nav.cw, W = nav.W, H = nav.H, terra = nav.terra;
    const len2 = d2(ax, ay, bx, by);
    if (len2 < cw * cw) return false;         // touching range crosses no ridge
    const steps = Math.ceil(Math.sqrt(len2) / (cw * 0.5)), CLIFF = WG.T.CLIFF;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const cx = ((ax + (bx - ax) * t) / cw) | 0, cy = ((ay + (by - ay) * t) / cw) | 0;
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
      if (terra[cy * W + cx] === CLIFF) return true;
    }
    return false;
  }
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
  /* A WORK IS SOMETHING YOU WALK ROUND. Men marched straight through their own halls, so an
   * army at home buried every building it passed — and a building under a crowd cannot be
   * tapped, which is how you raise it a level. Reported from play as exactly that.
   * A SHOVE rather than a hole in the movement grid: stamping footprints into the nav layer
   * would route columns around works properly, and it would also let a heir wall himself into
   * his own court by accident, since works stand seventy-eight apart and the gaps between them
   * are narrower than the grid can see. Pushed out at the rim, a column parts round a building
   * and closes up behind it, which is what it should look like anyway.
   * Walls are not in here: they have their own rule, with a gateway in it. */
  /* AND THE STONE HAS THE LAST WORD. This runs BEFORE `shove`, always: walking a man off a
   * hall can put him on the wrong side of a curtain — the stone is nineteen from its centre
   * line and a work pushes twenty-six — and a wall a man can be shoved through is not a wall.
   * Whichever of the two moves him, `shove` is the one that speaks last. */
  /* would this step carry him through stone he is barred by? A wall is nineteen thick and a
   * work pushes twenty-six, so walking a man off a hall can hop him clean over a curtain —
   * and `shove` then holds him on the wrong side, because all it knows is which side he is on
   * NOW. Cheaper to refuse the step than to unpick it. */
  function barred(world, u, nx, ny) {
    if (!world.anyWall) return false;
    for (const w of world.walls) {
      if (w.owner === u.owner && inGate(w, nx, ny)) continue;
      if (crosses(u.x, u.y, nx, ny, w.ax, w.ay, w.bx, w.by)) return true;
    }
    return false;
  }
  /* `lx, ly` — where he stood before this tick moved him, when the caller knows. A push that
   * only REPELS wedges him: point works are not in the nav masks (only runs are), so the flow
   * field routes him straight at a hall, the march walks him in, and this walks him back out
   * along the very same line. With his order dead behind the building the two cancel exactly
   * and he shivers against the wall of it for the rest of the match — reported from play as
   * troops stuck behind buildings.
   * So he SLIDES. The part of his step that went into the stone is dropped and the part that
   * went ACROSS it is kept, which is what walking round a corner is. Nothing else changes:
   * with no motion to slide, or with the motion already leading away, this is the old push. */
  function stand(world, u, lx, ly) {
    const pad = C.BUILD.pass, p2 = pad * pad;
    for (let q = 0; q < world.players.length; q++)
      for (const b of world.players[q].buildings) {
        if (b.x2 != null) continue;                       // a run is shoved by `shove`
        const dx = u.x - b.x, dy = u.y - b.y, dd = dx * dx + dy * dy;
        if (dd >= p2) continue;
        const L = Math.sqrt(dd);
        const ux = L < 1e-3 ? 1 : dx / L, uy = L < 1e-3 ? 0 : dy / L;   // outward from the work
        let nx = b.x + ux * pad, ny = b.y + uy * pad;
        /* the step he was making, minus the part of it that pointed into the stone */
        let slid = 0;
        if (lx != null) {
          const mx = u.x - lx, my = u.y - ly, into = mx * ux + my * uy;
          if (into < 0) {
            const tx = mx - into * ux, ty = my - into * uy;
            if (tx * tx + ty * ty > 1e-6 && !barred(world, u, nx + tx, ny + ty)) {
              nx += tx; ny += ty; slid = 1;
            }
          }
        }
        if (barred(world, u, nx, ny)) continue;           // rather in the hall than through the wall
        u.x = nx; u.y = ny;
        /* AND HE IS AS CLOSE TO HIS PLACE AS THE GROUND ALLOWS. The formation can hand a man
         * a place inside a hall; walked off it he heads back, is walked off again, and shivers
         * against the wall of it for the rest of the match. At the rim he has arrived —
         * and he is PINNED there, because stone has the last word and a man the crowd pushes
         * into a wall it cannot push him through is a man being shoved back and forth by two
         * rules that will never agree. The crowd goes round him instead.
         * THE PIN STAYS, sliding or not. Skipping it for a man who slid was tried and it
         * un-pins a SETTLED company too — they jostle by a fraction of a unit a tick, that
         * counts as sliding, and they shiver against the work for the rest of the match, which
         * is the exact thing the pin exists to stop. The slide is geometry; the pin is about
         * the crowd, and they do not need to know about each other. */
        u.set = 1; u.pin = world.tick;
      }
  }
  /* THE GROUND HAS THE LAST WORD. The nav grid has always known rock and water are
   * impassable — it is what the flow fields route around — but knowing it and being bound
   * by it are different things, and the first binding was three different things: an
   * axis-by-axis slide in `stand` (stair-stepping down a diagonal bank), a flat refusal of
   * crowd pushes near water in `jostle` (which could not slide at all), and an escape
   * hatch for a man already IN a lake, because a yes/no test has no opinion about the way
   * out. The signed distance field (NAV.ground) is one rule for all of it: how far to the
   * bad ground, and which way the good ground lies. Below the shore clearance he is walked
   * back up the gradient — which drops exactly the component of his motion that pointed
   * into the water and keeps the one along the bank, which is what sliding IS — and a man
   * deep in the wrong ground (spawned there, spilled there by a tower coming down) has a
   * gradient pointing home from anywhere, walked out at a stride a tick rather than
   * teleported to the bank.
   * FOREST IS NOT ROCK: the field is built from cost-0 cells only; a price on the ground
   * is the flow field's business, not this rule's.
   * HE IS NOT PINNED HERE, and that is the difference between ground and stone: a wall is
   * thin and few men press it, a shoreline can take a whole company, and pinned men are
   * skipped by the crowd pass, so they stack. Projected men keep giving way to each other
   * along the bank. */
  function grounded(world, u) {
    const clear = C.NAV.shore, cap = C.NAV.wade;
    for (let i = 0; i < 2; i++) {
      const g = NAV.ground(world.nav, u.x, u.y);
      if (g.d >= clear) break;
      const L = Math.sqrt(g.gx * g.gx + g.gy * g.gy) || 1;
      const step = Math.min(clear - g.d, cap);
      u.x += (g.gx / L) * step; u.y += (g.gy / L) * step;
      if (step === cap) return;         // wading out: no second pass, he is walking
    }
    /* AND THE CELL ITSELF IS THE LAW. The bilinear field is smooth, and smoothness cuts
     * corners — at the corner of a lone bad cell the blend of three good samples and one bad
     * reads well above zero, so a man can satisfy the shore clearance while standing on the
     * one kind of ground the doctrine flatly refuses. The field says HOW to leave; the cell
     * says WHETHER he must. A short walk up the gradient, cell-checked each step, settles
     * the argument the binary way the rest of the sim (standable, placeAt, the tests)
     * already speaks. */
    for (let i = 0; i < 4; i++) {
      const cc = NAV.cellOf(world.nav, u.x, u.y);
      if (cc >= 0 && world.nav.cost[cc] > 0) return;
      const g = NAV.ground(world.nav, u.x, u.y);
      const L = Math.sqrt(g.gx * g.gx + g.gy * g.gy) || 1;
      /* short steps: the corner zone this covers is shallow, and ejecting by half a cell
       * threw a man 10 for an incursion of 1 — the crowd nudged him over the line, the law
       * hurled him back, and the pair of them read as a 9.5-unit shiver */
      u.x += (g.gx / L) * 2; u.y += (g.gy / L) * 2;
    }
  }
  /* ---------------- THE RESOLVER: every projection, once, in one order ----------------
   * A man's tick is PREDICT then PROJECT. The march, the chase and the crowd only ever
   * propose motion; what the world permits is settled here, and the order is doctrine:
   * the works first (a hall's rim, collide-and-slide), then the standing stone (a wall is
   * absolute — `shove`), then the ground, which has the last word on everything including
   * where the first two put him. This used to be four call sites each remembering to make
   * two of the three calls in the right order; the ordering was load-bearing and nothing
   * said so. Now it is one word, and a pass that moves a man ends with it. */
  function project(world, u, lx, ly) {
    stand(world, u, lx, ly);
    if (world.anyWall) shove(world, u);
    grounded(world, u);
  }
  /* ---------------- ANTICIPATION: steer clear before you arrive ----------------
   * THE MODEL WAS THE BUG. `stand` is a POSITION projection — let a man walk into the stone,
   * then put him back out — and repulsion-after-contact is the one formulation that is
   * guaranteed to oscillate: with his order behind a hall, the march walks him in and the
   * projection walks him out along the same line, thirty times a second, forever. `u.set` and
   * `u.pin` were damping bolted on to hide it. Measured: 17 men across three matches standing
   * at exactly BUILD.pass from a work with an order 1300-1900 away, one for 307 seconds.
   *
   * The crowd literature settled this. Helbing's social-force model repels on SEPARATION and
   * has the same jitter; what Karamouzas, Skinner and Guy measured in real pedestrians (PRL
   * 2014) is that people react to projected TIME TO COLLISION, not to distance — they turn
   * early and never touch. ORCA makes it operational by choosing among VELOCITIES rather than
   * correcting positions: an obstacle forbids a set of velocities, and you take the permitted
   * one nearest what you wanted.
   *
   * For a single static disc that reduces to this: if holding your course would put you inside
   * the disc within `look` seconds, turn just enough to graze it — the tangent — on whichever
   * side is closer to where you were going. Nothing ever pushes back, so nothing can oscillate,
   * and `stand` is left as the safety net it should always have been (a recruit spawns INSIDE
   * his hall, and something has to put him out).
   *
   * Two guards earn their place. A man does not swerve round a work that stands BEYOND his
   * destination — the ground he is walking to may be the far side of it — and he does not
   * swerve round the thing he was sent to break, which is why this is not called on the chase. */
  function steerClear(world, u, vx, vy, reach, gx, gy) {
    const look = C.CROWD.look, speed = C.UNITS[u.kind].speed;
    const ahead = speed * look;
    let best = null, bestT = look;
    for (let q = 0; q < world.players.length; q++)
      for (const b of world.players[q].buildings) {
        if (b.x2 != null || b.raise > 0) continue;      // runs are `shove`'s; a shell bars nothing
        const rx = b.x - u.x, ry = b.y - u.y;
        const d = Math.sqrt(rx * rx + ry * ry);
        const R = C.BUILD.pass;
        if (d > ahead + R || d <= 1e-3) continue;
        if (d - R > reach) continue;                    // it stands past where he is going
        /* ...AND HE DOES NOT WALK ROUND WHAT HE IS WALKING TO. A muster ring sits in a court
         * full of works, so a man's own destination is very often within a stride of one. Left
         * out, this rule steers him off his own place, he re-aims, and he orbits his hall for
         * the rest of the match — measured as brand falling from nine wins to two and three
         * mirrors running to the cap. */
        if (gx != null && (gx - b.x) * (gx - b.x) + (gy - b.y) * (gy - b.y) < (R + C.CROWD.space) * (R + C.CROWD.space)) continue;
        /* time to the closest approach if he holds this course, and how near he would pass */
        const t = rx * vx + ry * vy;                    // v is a unit vector; t is in units
        if (t <= 0) continue;                           // it is behind him
        const miss = Math.abs(rx * vy - ry * vx);       // perpendicular distance at closest approach
        if (miss >= R) continue;                        // he already clears it
        const tt = t / speed;                           // ...in seconds
        if (tt < bestT) { bestT = tt; best = { rx, ry, d, R, id: b.id }; }
      }
    if (!best) { u.dg = 0; return null; }
    /* GRAZE IT. The two courses that just clear the disc are the bearing to its middle turned
     * by asin(R/d); take whichever is the smaller turn from the course he wanted. Standing
     * inside it already (a fresh recruit) there is no tangent — head straight out and let
     * `stand` finish the job. */
    if (best.d <= best.R) return { x: -best.rx / best.d, y: -best.ry / best.d };
    const to = Math.atan2(best.ry, best.rx);
    const off = Math.asin(Math.max(-1, Math.min(1, best.R / best.d)));
    const want = Math.atan2(vy, vx);
    const a1 = to + off, a2 = to - off;
    const wrap = (a) => Math.atan2(Math.sin(a - want), Math.cos(a - want));
    /* AND HE COMMITS TO A SIDE. Whether a course clears a disc is a yes/no question, and a man
     * walking the edge of it answers differently every tick: steer, clear, steer, clear — six
     * men in a hundred and thirty-nine reversing four times in two seconds, which is the
     * shivering the arrival rule already had to cure with hysteresis. It is also what people
     * do: you pick a side of the obstacle early and keep it rather than re-deciding at every
     * stride. `u.dg` is the work he is going round and `u.dgs` the hand he chose; both are
     * dropped the moment it is behind him. */
    const t1 = wrap(a1), t2 = wrap(a2);
    let side = u.dg === best.id ? u.dgs : (Math.abs(t1) <= Math.abs(t2) ? 1 : -1);
    u.dg = best.id; u.dgs = side;
    return { x: Math.cos(side > 0 ? a1 : a2), y: Math.sin(side > 0 ? a1 : a2) };
  }

  /* MEN HAVE WIDTH. Nothing kept one soldier off another, so a column arrived stacked and a
   * melee was a single point with a hundred sprites in it — an army of twenty and an army of
   * two hundred looked the same. This is the separation rule out of flocking.
   * ON ITS OWN GRID. The bins the sim already keeps are 280 wide, which is right for "who can
   * I shoot" and useless here: at melee density one bin holds hundreds and checking them all
   * is the quadratic trap again. A cell the width of the rule itself means the nine
   * cells around a man hold a handful, so the pass is linear in the army.
   * Each PAIR is resolved once — a half-neighbourhood, and by index within the shared cell —
   * and both men give way by half the overlap, which converges in two or three ticks without
   * the jitter a spring force produces.
   *
   * ...AND MEN HAVE FELLOWS. Separation on its own is half of a rule: it is the only thing in
   * here with an opinion about how far apart two men should stand, and every opinion it has is
   * "further". Nothing ever drew a company back together, so any man knocked out of his place —
   * by stone, by a chase, by the neighbour he was giving way to — stayed out of it, and a
   * company read as debris rather than as a body of men. Reported from play as exactly that,
   * and measured: 26% of the men standing at a flag had no fellow within two paces.
   * So the second of Reynolds' rules, kept deliberately weak and kept SHORT: only his own
   * company, only out to `pull`, and only the part of the distance past the room he is owed —
   * so two men at a berth apart pull on each other not at all and the equilibrium of the pair
   * is exactly `space`. Alignment is still the order's business and is not in here. */
  function jostle(world) {
    const R = C.CROWD.space, P = C.CROWD.pull, P2 = P * P, cw = P;
    const grid = new Map();
    for (const u of world.units) {
      if (u.hp <= 0 || u.man || u.in) continue;   // a berth on a parapet, or a room in a tower, is not a crowd — a man still WALKING to his tower is both
      const k = Math.floor(u.y / cw) * 100003 + Math.floor(u.x / cw);
      const cell = grid.get(k);
      if (cell) cell.push(u); else grid.set(k, [u]);
    }
    /* half the ring: (0,0) forward-only, then the four cells that have not seen us yet */
    const NB = [[1, 0], [-1, 1], [0, 1], [1, 1]];
    /* GATHERED, CLAMPED, THEN APPLIED. Three ways to do this and only one of them works.
     * Push each man the moment a neighbour is found and every push he is owed is summed, so a
     * man with six neighbours moves six times as far as he should and overshoots into somebody
     * else: a settled army shimmered at a hundred units a second and never came to rest.
     * Average the corrections instead and it converges beautifully and far too weakly — men
     * settled five apart against a target of twenty-two, because in a dense crowd the mean of
     * a dozen opposing pushes is nearly nothing.
     * So the sum is kept and the STEP is capped. A man cannot be shoved faster than he walks,
     * which bounds the overshoot to something smaller than the spacing and lets a packed
     * company open out over a second or so rather than exploding in one tick. */
    const part = (a, b) => {
      const dx = b.x - a.x, dy = b.y - a.y;
      let dd = dx * dx + dy * dy;
      if (dd >= P2) return;
      let nx, ny;
      if (dd < 1e-6) {                          // exactly together: part them along their ids
        const ang = ((a.id * 2654435761) % 6283) / 1000;
        nx = Math.cos(ang); ny = Math.sin(ang); dd = 0;
      } else { const L = Math.sqrt(dd); nx = dx / L; ny = dy / L; dd = L; }
      if (dd < R) {                             // SEPARATION: he is standing in me
        const give = (R - dd) * 0.5 * C.CROWD.push;
        a._cx -= nx * give; a._cy -= ny * give; a._cn++;
        b._cx += nx * give; b._cy += ny * give; b._cn++;
        a._pr++; b._pr++;                       // ...and each is one man of the other's press
      } else if (a.owner === b.owner && a.co === b.co) {   // COHESION: my own company, and no one else's
        const give = (dd - R) * 0.5 * C.CROWD.knit;
        a._cx += nx * give; a._cy += ny * give; a._cn++;
        b._cx -= nx * give; b._cy -= ny * give; b._cn++;
      }
    };
    for (const cell of grid.values()) for (const u of cell) { u._cx = 0; u._cy = 0; u._cn = 0; u._pr = 0; }
    for (const [k, cell] of grid) {
      for (let i = 0; i < cell.length; i++) {
        for (let j = i + 1; j < cell.length; j++) part(cell[i], cell[j]);
        for (const [dx, dy] of NB) {
          const other = grid.get(k + dy * 100003 + dx);
          if (!other) continue;
          for (let j = 0; j < other.length; j++) part(cell[i], other[j]);
        }
      }
    }
    const cap = C.CROWD.step;
    for (const cell of grid.values()) for (const u of cell) {
      if (!u._cn) continue;
      let dx = u._cx, dy = u._cy;
      const L = Math.sqrt(dx * dx + dy * dy);
      /* A CORRECTION TOO SMALL TO SEE IS NOT WORTH MAKING. Under a hair's breadth the pass is
       * only trading rounding error back and forth between neighbours, which is invisible as
       * distance and extremely visible as SHIVER — the ranks reversed direction four times a
       * second while standing still. Below the deadband a man is where he should be. */
      /* A MAN IN HIS PLACE IS NOT MOVED. Once he has arrived he is where the formation put
       * him, and the formation already spaces men a berth apart — so a push on him is the
       * pass arguing with the order, and the two of them trade him back and forth for the
       * rest of the match. The ranks reversed direction four times a second doing it. Men
       * still on the march give way around him, which is what a crowd does. */
      /* ...but SOMEBODY STANDING INSIDE HIM still moves him. A settled man ignoring every push
       * is stable and wrong: two men handed the same rim of the same hall, or a recruit
       * mustered on top of one, stay in the same square foot for ever because neither will
       * budge. He ignores the small corrections — which is all the shiver was — and gives way
       * to a real overlap like anyone else. */
      if (u.pin === world.tick) continue;               // held against stone: he cannot give way
      if (u.set && L < C.CROWD.space * 0.25) continue;
      if (L < C.CROWD.dead) continue;
      if (L > cap) { dx = dx / L * cap; dy = dy / L * cap; }
      if (barred(world, u, u.x + dx, u.y + dy)) continue;   // nor is a crowd a way through stone
      /* ...NOR A WAY TOWARD THE WATER — a REFUSAL, and deliberately not a projection. It was
       * a projection for one afternoon: let the push land and have the resolver walk the man
       * back up the gradient. Every end-of-tick position was clean, and a settled army's
       * drift measured FOUR TIMES its old value — the men at the waterline were cycling
       * push-in, eject-out, thirty times a second, invisible to any position sample and
       * plain in the motion. A refused push is a man standing still, which is what a settled
       * man is for. The asymmetry is the escape hatch it always was: a man already below the
       * clearance is free to be pushed anywhere, including out. The MARCH is the opposite
       * choice on purpose — a step is turned along the bank (see the guard at the stride),
       * because a marcher has somewhere to be. */
      const jx = u.x + dx, jy = u.y + dy;
      const jc = NAV.cellOf(world.nav, jx, jy);
      if ((jc < 0 || world.nav.cost[jc] === 0 || NAV.ground(world.nav, jx, jy).d < C.NAV.shore)
          && NAV.ground(world.nav, u.x, u.y).d >= C.NAV.shore) continue;
      u.x += dx; u.y += dy;
    }
    /* the press, published: how many neighbours stood closer than a berth this tick. Read
     * next tick by the march to slow a packed column — see CROWD.crush. */
    for (const cell of grid.values()) for (const u of cell) u.press = u._pr;
  }
  /* THE CRUSH: a packed man's stride. Exported pure so the referee's tests can read the
   * curve without staging a scrum. press is last tick's count of neighbours closer than a
   * berth (jostle publishes it); a marching column's ordinary shoulder-rubbing — a man
   * settled in a body sits a shade under a berth from two or three fellows — is free, and
   * past that each man in the press drags. Floored: a scrum still moves, it just pours.
   * Deliberately NOT applied to the chase — a man closing on something he means to kill
   * shoulders through; it is the ORDERED march that queues. */
  const crush = (press) => {
    const over = (press || 0) - C.CROWD.crushFree;
    if (over <= 0) return 1;
    return Math.max(C.CROWD.crushFloor, 1 / (1 + C.CROWD.crush * over));
  };
  function shove(world, u) {
    const pad = C.WALL.thick + 6, p2 = pad * pad;
    for (const w of world.walls) {
      if (segD2(w.b, u.x, u.y) >= p2) continue;
      /* THE OWNER PASSES AT HIS GATE, AND ONLY THERE. He used to pass anywhere along his own
       * run, which made a curtain a one-way wall — perfect cover that his own army ignored.
       * A rival is stopped everywhere, gateway included: the gate is shut to him, and the
       * only way through a wall he does not own is to break it. */
      if (w.owner === u.owner && inGate(w, u.x, u.y)) continue;
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
        /* A BREACHED WALL IS A RUIN, NOT A GAP IN THE RECORD. It stops nothing — that is what
         * breaking it was for — but it stays on the board, and the masons can raise it again
         * for half the stone. Removing it outright made every fight for a curtain final. */
        if (!isWall(b) || b.raise || b.breach) continue;
        const e = wallEnds(b);
        const mx = (e[0] + e[2]) / 2, my = (e[1] + e[3]) / 2;
        world.walls.push({ b, owner: q, ax: e[0], ay: e[1], bx: e[2], by: e[3], gx: mx, gy: my,
                           gate: !!b.gated });
      }
    world.anyWall = world.walls.length > 0;
    /* WHICH RUN A TOWER STANDS ON IS DERIVED, not stamped. The answer changes without the
     * tower being touched — the curtain under it is breached, mended, thrown down, or a new
     * one is drawn through it — and stamped at build time it went stale in both directions: a
     * tower whose wall was razed went on being drawn twenty-seven feet in the air on stone
     * that was no longer there, and a bastion a later run was drawn through never learned it
     * was on one. This is the only place the standing set changes, so it is the only place
     * the answer can. */
    const r2 = (C.WALL.thick + 16) * (C.WALL.thick + 16);
    for (let q = 0; q < world.players.length; q++)
      for (const b of world.players[q].buildings) {
        if (b.bt !== 'tower') continue;
        let on = 0;
        for (const w of world.walls)
          if (w.owner === q && segD2(w.b, b.x, b.y) < r2) { on = w.b.id; break; }
        if (on) b.onWall = on; else delete b.onWall;
      }
    /* the eye's copy of the standing set — rebuilt here because here is the ONLY place the
     * set changes, and it drops world.vis so no viewer keeps seeing through a finished run
     * or staying blind past a fresh breach */
    bakeWallSight(world);
  }
  /* is this point in the gateway of that wall? The gate is the middle of the run and it is
   * the ONLY way through — for the heir who raised it, and for nobody else. */
  const inGate = (w, x, y) => !!w.gate && d2(x, y, w.gx, w.gy) < C.WALL.gate * C.WALL.gate;

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
          if (segD2(o, ax, ay) < C.WALL.atop * C.WALL.atop && segD2(o, bx, by) < C.WALL.atop * C.WALL.atop) return 'crowded';
        } else if (o.bt === 'tower' && q === pi) {
          /* A TOWER OF YOURS IS A BASTION, not an obstacle. The game already lets you raise a
           * tower INTO your curtain; the reverse has to hold or a corner tower is a full stop
           * — the next stretch of wall cannot start at it, cannot end at it and cannot pass
           * it, so a curtain that turns has to be drawn in disconnected pieces with gaps a
           * man can walk through. Reported from play as 'too close to another work' on every
           * run begun at the tower one had just built into the wall. */
          continue;
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
    /* only a tower joins a curtain — a barracks astride a wall is a hole in it */
    if (!clearOfWorks(world, x, y, bt === 'tower' ? pi : null)) return 'crowded';
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
      if (!world.units.some((u) => u.owner === pi && d2(u.x, u.y, site.x, site.y) < C.NODE.hold * C.NODE.hold)) return 'presence';
      if (world.units.some((u) => u.owner !== pi && u.owner !== C.CHAOS_ID && d2(u.x, u.y, site.x, site.y) < C.NODE.hold * C.NODE.hold)) return 'contested';
      return busy;
    }
    if (inClaim(world, pi, x, y)) return busy;
    return 'claim';
  }

  /* ---------------- vision & exploration ---------------- */
  /* The ONE list of what seat `pi` sees from. The host reads it, the AI reads it, and a LAN
   * guest reads it too — against a snapshot dressed as a world — so it may only lean on
   * fields the wire carries: `map`, `players[*].buildings` / `.walking` / `.out`, `units`.
   * A rule written here reaches every fog in the game at once; a rule written anywhere
   * else reaches one screen and is a bug waiting for the other screens to find. */
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
    /* A WALK LIGHTS ITS SHRINE FOR EVERY VIEWER — the Pattern is not walked in the dark, and
     * a rival reaching for the throne must be findable. The 4th element marks the source as
     * the BEACON: the mask fills its whole disc unconditionally, through ridge and curtain
     * alike, because "a walk is public" is a pillar and occlusion must not quietly repeal it.
     * The walker's OWN heir gets the beacon too (he used to be skipped as already having
     * building-vision there) — his ordinary sources are occluded now, and rivals seeing MORE
     * of the ground around his own Shrine than he does would be absurd. */
    for (let o = 0; o < world.players.length; o++) {
      const q = world.players[o];
      if (q.out || !q.walking) continue;
      const sh = q.buildings.find((b) => b.bt === 'shrine' && !b.raise);
      if (sh) src.push([sh.x, sh.y, C.VISION.pattern, 1]);
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
  /* Marks ground as remembered. Takes either a raw source list (plain discs — a guest's
   * reconstruction, which has no opacity bake to consult) or a LIVE MASK from world.vis,
   * which is a straight OR because both grids are cut from C.FOG.cell. */
  function markSeen(mask, src) {
    if (src && src.g) {
      const g = mask.g, m = src.g;
      for (let i = 0; i < m.length; i++) if (m[i] && !g[i]) { g[i] = 1; mask.v++; }
      return mask;
    }
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

  /* ---------------- what the land does to a sight line ----------------
   * Baked ONCE per world, on the FOG grid (C.FOG.cell = 26; the nav grid's 20 is for feet,
   * not eyes). Two layers per cell:
   *   opq  — rock. A cell is OPAQUE when MORE THAN HALF of a 3x3 spread of terrain samples
   *          under it are CLIFF. Measured on the five test seeds: the land itself is
   *          4.6-8.6% cliff, "any sample" opaques 5.9-10.7% of fog cells — a quarter MORE
   *          stone than the land has, every diagonal saddle a column can walk through
   *          turned into a curtain the eye cannot follow it into — while majority lands on
   *          4.6-8.5%, tracking the terrain's own share to within a tenth of a point.
   *          Majority is what ships.
   *   cost — woods. The FOREST share of the same samples scales a cell's price toward
   *          C.VISION.forest: sight spends cells of its reach walking a line, and a wooded
   *          cell charges extra — see castFrom.
   * Walls are the third layer, rebuilt by noteWalls whenever the standing set changes,
   * because stone rises and falls mid-match and the terrain never does. */
  function bakeSight(world) {
    const gw = Math.ceil(C.MAP.W / C.FOG.cell), gh = Math.ceil(C.MAP.H / C.FOG.cell);
    const cw = C.FOG.cell, nav = world.nav, T = WG.T;
    const opq = new Uint8Array(gw * gh), cost = new Float32Array(gw * gh);
    const fw = C.VISION.forest - 1;
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      let cliff = 0, forest = 0, n = 0;
      for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
        const ci = NAV.cellOf(nav, (gx + (sx + 0.5) / 3) * cw, (gy + (sy + 0.5) / 3) * cw);
        if (ci < 0) continue;
        n++;
        const t = nav.terra[ci];
        if (t === T.CLIFF) cliff++;
        else if (t === T.FOREST) forest++;
      }
      const i = gy * gw + gx;
      opq[i] = n > 0 && cliff * 2 > n ? 1 : 0;
      cost[i] = 1 + (n ? forest / n : 0) * fw;
    }
    world.sight = { gw, gh, cell: cw, opq, cost, wall: new Uint8Array(gw * gh) };
    /* a RE-bake (tests paint terrain; a match never does) must not lose the standing stone
     * or leave masks cast against the old land */
    if (world.walls && world.walls.length) bakeWallSight(world);
    world.vis = null;
  }
  /* THE STANDING STONE, ON THE EYE'S GRID. Stamped from world.walls — the same standing set
   * `walled` reads, so a shell blocks no sight and a breach stops blocking the tick it is
   * made. Called by noteWalls and nowhere else: that is the ONE place the set changes, so it
   * is the one place this can go stale — and it also drops world.vis, so every viewer's mask
   * is recast against the new stone before the next question is answered (that drop is the
   * versioning: there is no counter to forget to bump).
   * The stamp is 4-CONNECTED (a diagonal sample step also stamps the orthogonal in-between
   * cell), because castFrom's corner test can only stop a ray squeezing through a corner if
   * the run has no diagonal-only links for it to squeeze through. */
  function bakeWallSight(world) {
    const s = world.sight;
    if (!s) return;
    s.wall.fill(0);
    const cw = s.cell, gw = s.gw, gh = s.gh;
    for (const w of world.walls) {
      const len = Math.hypot(w.bx - w.ax, w.by - w.ay);
      const steps = Math.max(1, Math.ceil(len / (cw * 0.5)));
      let px = -1, py = -1;
      for (let k = 0; k <= steps; k++) {
        const f = k / steps;
        const gx = ((w.ax + (w.bx - w.ax) * f) / cw) | 0, gy = ((w.ay + (w.by - w.ay) * f) / cw) | 0;
        if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) continue;
        if (px >= 0 && gx !== px && gy !== py) s.wall[py * gw + gx] = 1;   // no diagonal-only link
        s.wall[gy * gw + gx] = 1;
        px = gx; py = gy;
      }
    }
    world.vis = null;   // every mask was cast against stone that is no longer the stone
  }

  /* ---------------- the rays a sight disc is filled by ----------------
   * Precomputed per integer radius (in fog cells; the biggest on the board is the
   * Watchtower's 520/26 = 20) and shared by every source in every match. Built so that
   * EVERY cell of the disc lies on at least one ray: walk the disc's offsets from the rim
   * inward and give any cell no earlier ray covered its own Bresenham line from the origin.
   * Plain rim-rays alone leave pinholes — cells no rim line happens to pass through — and a
   * pinhole in fog is a spot on the map a unit flickers in. Measured at radius 10 (a unit's
   * 260): 64 rays cover all 317 cells in 540 steps a source. */
  const RAYS = new Map();
  const SQ2 = Math.SQRT2;
  function raysFor(R) {
    let bun = RAYS.get(R);
    if (bun) return bun;
    const side = 2 * R + 1, covered = new Uint8Array(side * side);
    const offs = [];
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      if (!dx && !dy) continue;
      const h = Math.sqrt(dx * dx + dy * dy);
      if (h <= R + 1e-9) offs.push([dx, dy, h]);
    }
    offs.sort((a, b) => b[2] - a[2]);   // rim first: long rays cover the most on their way out
    const dxs = [], dys = [], hs = [], sls = [], dgs = [], idx = [0];
    for (const [ox, oy] of offs) {
      if (covered[(oy + R) * side + (ox + R)]) continue;
      let x = 0, y = 0, err = Math.abs(ox) - Math.abs(oy);
      const ax = Math.abs(ox), ay = Math.abs(oy), sx = ox > 0 ? 1 : -1, sy = oy > 0 ? 1 : -1;
      while (x !== ox || y !== oy) {
        const e2 = 2 * err;
        let mx = 0, my = 0;
        if (e2 > -ay) { err -= ay; mx = sx; }
        if (e2 < ax) { err += ax; my = sy; }
        x += mx; y += my;
        dxs.push(x); dys.push(y);
        hs.push(Math.sqrt(x * x + y * y));
        sls.push(mx && my ? SQ2 : 1);
        dgs.push(mx && my ? 1 : 0);
        covered[(y + R) * side + (x + R)] = 1;
      }
      idx.push(dxs.length);
    }
    bun = { n: idx.length - 1, idx: Int32Array.from(idx), dx: Int8Array.from(dxs),
            dy: Int8Array.from(dys), h: Float32Array.from(hs), sl: Float32Array.from(sls),
            dg: Uint8Array.from(dgs) };
    RAYS.set(R, bun);
    return bun;
  }
  /* Fill one source's sight into a viewer's mask: march every ray of the disc, spending a
   * budget of B cells of reach. Distance itself is the base price (the precomputed hypot, so
   * open ground stays the same Euclidean circle the old source-list fog drew); a wooded cell
   * charges its extra ON ENTRY — the first rank of trees is seen, the country past it costs
   * more than it used to. An OPAQUE cell (rock, or a standing wall) is marked and STOPS the
   * ray: you see the ridge face, never past it. The source's own cell never blocks — a
   * berthed man at the parapet, or a man on the ridge top, sees out. On a diagonal step the
   * two corner cells are consulted: both opaque means the ray is squeezing through a corner
   * no eye fits through. */
  function castFrom(s, m, sx, sy, B) {
    const gw = s.gw, gh = s.gh, opq = s.opq, wall = s.wall, cost = s.cost;
    m[sy * gw + sx] = 1;
    const bun = raysFor(Math.ceil(B));
    for (let r = 0; r < bun.n; r++) {
      let pen = 0, pgx = sx, pgy = sy;
      for (let k = bun.idx[r], end = bun.idx[r + 1]; k < end; k++) {
        const gx = sx + bun.dx[k], gy = sy + bun.dy[k];
        if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) break;   // a straight line never comes back
        const i = gy * gw + gx;
        if (bun.dg[k]) {
          const c1 = pgy * gw + gx, c2 = gy * gw + pgx;
          if ((opq[c1] || wall[c1]) && (opq[c2] || wall[c2])) break;
        }
        const price = bun.h[k] + pen + (cost[i] - 1) * bun.sl[k];
        if (price > B) break;
        m[i] = 1;
        if (opq[i] || wall[i]) break;
        pen = price - bun.h[k];
        pgx = gx; pgy = gy;
      }
    }
  }
  /* the beacon's disc: unconditional, no rays, no stone — see visionSources on why */
  function fillDisc(s, m, cx, cy, r) {
    const cw = s.cell, r2 = r * r;
    const gx0 = Math.max(0, ((cx - r) / cw) | 0), gx1 = Math.min(s.gw - 1, ((cx + r) / cw) | 0);
    const gy0 = Math.max(0, ((cy - r) / cw) | 0), gy1 = Math.min(s.gh - 1, ((cy + r) / cw) | 0);
    for (let gy = gy0; gy <= gy1; gy++) {
      const dy = (gy + 0.5) * cw - cy;
      for (let gx = gx0; gx <= gx1; gx++) {
        const dx = (gx + 0.5) * cw - cx;
        if (dx * dx + dy * dy <= r2) m[gy * s.gw + gx] = 1;
      }
    }
  }
  /* One viewer's mask for this refresh. Sources are DEDUPED BY FOG CELL first — an army is
   * thirty men standing on a dozen cells, and casting a dozen discs instead of thirty is
   * what keeps the refresh inside its budget (measured on a clustered 300-man board: 75
   * sources cast as ~25 cells, and the whole 4-viewer refresh lands at 1.0-1.7ms against
   * the ~2ms budget). Ties keep the longest reach. */
  function visMask(world, pi, src) {
    const s = world.sight, cw = s.cell, n = s.gw * s.gh;
    const bufs = world._visBuf || (world._visBuf = []);
    let m = bufs[pi];
    if (!m || m.length !== n) m = bufs[pi] = new Uint8Array(n);
    else m.fill(0);
    const ded = new Map();
    for (let i = 0; i < src.length; i++) {
      const q = src[i];
      if (q[3]) { fillDisc(s, m, q[0], q[1], q[2]); continue; }   // A WALK IS PUBLIC
      let gx = (q[0] / cw) | 0, gy = (q[1] / cw) | 0;
      gx = gx < 0 ? 0 : gx >= s.gw ? s.gw - 1 : gx;
      gy = gy < 0 ? 0 : gy >= s.gh ? s.gh - 1 : gy;
      const key = gy * s.gw + gx, B = q[2] / cw;
      const held = ded.get(key);
      if (held === undefined || held < B) ded.set(key, B);
    }
    for (const [key, B] of ded) castFrom(s, m, key % s.gw, (key / s.gw) | 0, B);
    /* the same {g,gw,gh,cell} shape as pl.seen — the renderer's veil reads both */
    return { g: m, gw: s.gw, gh: s.gh, cell: cw };
  }
  const maskAt = (v, x, y) => {
    const gx = (x / v.cell) | 0, gy = (y / v.cell) | 0;
    if (gx < 0 || gy < 0 || gx >= v.gw || gy >= v.gh) return false;
    return v.g[gy * v.gw + gx] === 1;
  };

  /* The refresh: sources gathered, masks cast, memory updated — the 5 Hz heartbeat of every
   * fog in the game. world.vis[pi] is a CELL MASK now, not a source list: the snapshot
   * filter asks canSee per object per guest at 10 Hz, and each ask is one array read instead
   * of a walk of every source. The raw lists survive as world.visSrc because the renderer's
   * veil is still drawn from them. */
  function refreshVision(world) {
    world.visSrc = world.players.map((q, pi) => visionSources(world, pi));
    /* A FALLEN HEIR WATCHES THE WHOLE BOARD. His Seat is rubble and his men are gone — there
     * is no information left to protect from him and a free-for-all can run long after his
     * fall, so the fog lifts and he spectates. POSITIONAL fog only: the wire's private
     * fields (a rival's essence, branch, income) are withheld by ownership checks that never
     * consult this mask, so spectating is not auditing. The all-ones mask is built once and
     * shared — every downstream consumer (canSee, the snapshot filter, exploreAround, the
     * veil) follows it with no rule of its own. */
    world.vis = world.players.map((q, pi) => {
      if (q.out) {
        if (!world._allSeen) {
          const sgt = world.sight;
          world._allSeen = { g: new Uint8Array(sgt.gw * sgt.gh).fill(1), gw: sgt.gw, gh: sgt.gh, cell: sgt.cell };
        }
        return world._allSeen;
      }
      return visMask(world, pi, world.visSrc[pi]);
    });
    for (let pi = 0; pi < world.players.length; pi++) exploreAround(world, pi);
  }
  function exploreAround(world, pi) {
    const v = world.vis[pi];
    const see1 = (x, y) => maskAt(v, x, y);
    const pl = world.players[pi];
    /* A Seat is a site like any other: you know it is there once you have SEEN it, and not
     * before. Finding the rival's is the whole early game now. */
    for (const s of world.map.sites)
      if (see1(s.x, s.y)) pl.explored[s.id] = { kind: s.kind, name: s.name };
    markSeen(pl.seen, v);   // live mask and memory share C.FOG.cell: a straight OR
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
        if (see1(b.x, b.y) || (e && (see1(e[0], e[1]) || see1(e[2], e[3])))) pl.ghosts[b.id] = g;
      }
    }
  }
  /* public vision test for render/snapshots: can `pi` see point (x,y) right now? */
  function canSee(world, pi, x, y) {
    if (!world.vis) refreshVision(world);
    return maskAt(world.vis[pi], x, y);
  }
  /* ---------------- one fog gate, written once ----------------
   * The wire (Net.snapFor) and the host's own screen both have to answer "does this rival
   * work show?" and "what does the viewer remember of the rest?" — and for a while they
   * answered with two copies of the same expression. Two copies of a fog rule is one place
   * to fix a leak and one place to forget it, so both answers live HERE, beside canSee,
   * and everything else asks. `see` is passed in rather than derived because the callers
   * already hold one bound to the right viewer. */
  /* a work shows the moment ANY part of it is seen: its middle, or — when it is a run with
   * a length — either end, the far one carried on the row and the near one mirrored
   * through the midpoint. Judging a wall by its centre alone hid a run whose near end
   * stood in plain sight. */
  function workSeen(see, b) {
    if (see(b.x, b.y)) return true;
    return b.x2 != null && (see(b.x2, b.y2) || see(b.x * 2 - b.x2, b.y * 2 - b.y2));
  }
  /* the viewer's memory of seat `pi`'s works, projected the one way both consumers need:
   * only where the viewer cannot currently see — the standing work shows there instead —
   * and rounded, because the wire rounds, and a rounding the guest's screen has always
   * lived with is fine for the host's too. One projection, not a rounded and a raw one. */
  function ghostsFor(world, viewer, pi, see) {
    return Object.entries(world.players[viewer].ghosts)
      .filter(([, g]) => g.owner === pi && !see(g.x, g.y))
      .map(([id, g]) => ({ id: +id, bt: g.bt, level: g.level, x: Math.round(g.x), y: Math.round(g.y),
                           x2: g.x2 == null ? undefined : Math.round(g.x2),
                           y2: g.y2 == null ? undefined : Math.round(g.y2) }));
  }

  /* ---------------- pathfinding: the nav grid does the walking ---------------- */

  /* ---------------- commands ---------------- */
  /* ---------------- the fork ----------------
   * A WORK MAY BRANCH, AND THE CHOICE IS FOREVER. The Watchtower was the only thing that did
   * this for a long time and the rule was written into six places as the word 'tower'. It is a
   * property of the TABLE now: any work carrying `branches` forks at its `fork` level, and
   * every consumer — the price, the command, the sheet, the model key, the heirs — asks these
   * two functions instead of naming a building. A branch's effect arrays are indexed by
   * `level - fork`, so [L2, L3] for a fork at 2.
   *
   * The whole feature rests on this being generic: three troop halls fork now, and the reason
   * that cost a table entry rather than a rewrite is that the tower had already paid for the
   * mechanism. */
  const branchesOf = (bt) => (C.BUILDINGS[bt] && C.BUILDINGS[bt].branches) || null;
  const forkAt = (bt) => (C.BUILDINGS[bt] && C.BUILDINGS[bt].fork) || 0;
  /* the branch a work is actually RUNNING — it has one only once it has reached the fork */
  function branchOf(b) {
    if (!b || !b.br || b.level < forkAt(b.bt)) return null;
    const tb = branchesOf(b.bt);
    return (tb && tb[b.br]) || null;
  }
  /* WHAT A HALL MUSTERS, and how often. Before the fork it is the table's own recruit; after
   * it, the branch's — a Barracks that chose the Shieldwall stops raising soldiers and raises
   * shieldmen, which is the whole point of the branch and the reason a level and a branch are
   * different axes. Everything that needs to know — the muster loop, the upgrade card's rate
   * line, the heirs' sense of what a hall costs to run — asks this rather than reading
   * `def.spawns`, which is only ever the level-1 answer now.
   * Takes anything with `bt`, `level` and `br`, so a caller can ask about the level a hall is
   * ABOUT to reach as easily as the one it holds. */
  function mustersOf(b) {
    const def = b && C.BUILDINGS[b.bt];
    if (!def || !def.spawns) return null;
    const br = branchOf(b);
    return {
      kind: (br && br.spawns) || def.spawns,
      period: br && br.period ? br.period[b.level - forkAt(b.bt)] : def.period[b.level - 1]
    };
  }
  /* a tower's live stats: shared until the level-2 fork, per-branch after it. Gunnery is the
   * tower's own business, so this stays tower-shaped — it simply asks the table who the
   * branch is rather than naming the constant. */
  function towerStats(b) {
    const def = C.BUILDINGS.tower;
    const br = branchOf(b);
    if (!br) return { dmg: def.dmg[b.level - 1], range: def.range[b.level - 1], atk: def.atk, splash: 0 };
    const i = b.level - def.fork;
    return { dmg: br.dmg[i], range: br.range[i], atk: br.atk[i],
             splash: br.splash[i], splashDmg: br.dmg[i] * (br.splashFrac || 0) };
  }
  /* `br` is the branch the work is being upgraded INTO (or already holds) */
  function upgradeCost(bt, level, br) {
    const tb = branchesOf(bt);
    if (tb) {
      const b2 = tb[br];
      if (!b2) return C.BUILDINGS[bt].up ? C.BUILDINGS[bt].up[level - 1] : Infinity;   // unforked fallback
      return level < forkAt(bt) ? b2.cost : b2.up[level - forkAt(bt)];
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
      let x2 = null, y2 = null, crews = 1, units = 1;
      if (def.span) {
        x2 = +cmd.x2; y2 = +cmd.y2;
        if (!isFinite(x2) || !isFinite(y2)) return { ok: false, err: 'short' };
        const badw = wallError(world, pi, x, y, x2, y2);
        if (badw) return { ok: false, err: badw };
        const len = Math.sqrt(d2(x, y, x2, y2));
        crews = wallCrews(len); units = wallUnits(len);
        x = (x + x2) / 2; y = (y + y2) / 2;
      }
      /* A TOWER MEANT FOR THE WALL LANDS ON THE WALL. The stone is drawn thirty high and the
       * camera looks down it at an angle, so the ground under the parapet you tapped is
       * behind the run, not on it — and that gap fell straight into the band where a tower
       * is too far to join and too near to stand. Snap it, so pointing at your own curtain
       * means what it looks like it means. */
      if (cmd.bt === 'tower') {
        const near2 = wallUnder(world, pi, x, y);
        if (near2) { const q = segNear(near2, x, y); x = q.x; y = q.y; }
      }
      /* A GATE STANDS ON THE SPRING, not beside it. It may be raised anywhere within NODE.r of
       * one, and it was left wherever the finger landed — so the work that draws Shadow out of
       * the ground sat off on the bank of its own pool, up to ninety-six from the water, and
       * the picture said the two had nothing to do with each other. There is one right place
       * for it and the sim knows exactly where it is. */
      if (def.claim) {
        const s0 = nodeAt(world, x, y);
        if (s0) { x = s0.x; y = s0.y; }
      }
      const bad = def.span ? null : placementError(world, pi, x, y, cmd.bt);
      if (bad) return { ok: false, err: bad };
      /* A RUN IS PRICED BY THE FOOT. One crew's worth of wall costs what the card says; twice
       * the wall is twice the crews, twice the price and twice the stone to break. Anything
       * else and a long wall is simply cheaper per length than a short one, which is not a
       * choice — it is an answer. */
      const price = Math.max(1, Math.round(def.cost * units));
      if (pl.essence < price) return { ok: false, err: 'essence' };
      pl.essence -= price;
      const site = def.claim ? nodeAt(world, x, y) : null;
      /* it goes up as a SHELL: paid for, standing, breakable — and good for nothing until
       * the masons are done with it */
      const b = { id: world.nextId++, bt: cmd.bt, level: 1, x, y,
                  cd: def.period ? def.period[0] * 0.5 : (def.atk || 0),
                  raise: def.raise || 0, raiseFor: def.raise || 0,
                  hp: def.hp * units * C.RAISE.hpFrom, maxHp: def.hp * units, lastHurt: -99,
                  node: site && nodeHolder(world, site) === -1 ? site.id : -1,
                  co: 0 };         // 0 = its muster marches under the royal War Banner
      /* `units` is how much wall it is and `crews` is how many masons it takes — and `gated`
       * is settled here, once, because it is a fact about the run's length and never changes */
      if (x2 != null) {
        b.x2 = x2; b.y2 = y2; b.crews = crews; b.units = units;
        if (units * C.WALL.unit >= C.WALL.gateMin) b.gated = 1;
      }
      /* a tower raised astride your own curtain is PART of it: it shoots over that stone the
       * way a man on the parapet does, and the wall stops being something it fires into */
      if (cmd.bt === 'tower') {
        const on = wallUnder(world, pi, x, y);
        if (on) b.onWall = on.id;
      }
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
      /* some works simply do not upgrade — the Shrine is one, and there is nothing to offer.
       * A work that BRANCHES may have no `up` table of its own; its prices live per branch. */
      if (!C.BUILDINGS[s.bt].up && !branchesOf(s.bt)) return { ok: false, err: 'noup' };
      if (s.level >= C.MAX_LEVEL) return { ok: false, err: 'max' };
      /* THE FORK: the upgrade that reaches `fork` must name a branch, and it is forever. Read
       * `cmd.br` at that level and nowhere else — every later upgrade falls through to the
       * branch the work already holds, which is what makes the choice permanent rather than
       * something a second tap can quietly rewrite. */
      let br = s.br;
      const tb = branchesOf(s.bt);
      if (tb && s.level + 1 === forkAt(s.bt)) {
        br = cmd.br;
        if (!tb[br]) return { ok: false, err: 'branch' };
      }
      /* AN UPGRADE TAKES A CREW, TIME, AND SILENCE. The crew was taken OFF this once, because
       * against one mason per three Gates it taxed whoever expanded hardest out of the game.
       * The purse is a different size now — a crew per Gate, and a Gate standing from the
       * first second — so masonry can be masonry again, and the ration is what keeps a rich
       * heir from raising his whole realm a level at once. */
      if (s.work > 0) return { ok: false, err: 'working' };
      if (rising(world, pi) + (s.crews || 1) > masons(world, pi)) return { ok: false, err: 'busy' };
      const cost = Math.max(1, Math.round(upgradeCost(s.bt, s.level, br) * sizeOf(s)));
      if (pl.essence < cost) return { ok: false, err: 'essence' };
      pl.essence -= cost;
      s.level++;
      if (br) s.br = br;
      s.work = s.workFor = Math.max(1, (C.BUILDINGS[s.bt].raise || 10) * C.UP_WORK);
      /* A HALL THAT FORKS DOES NOT KEEP THE CHANGE. Recruits are paid for continuously into
       * `paid`, and the fork can change who is being paid for — a Spire part-way through a
       * sorcerer that becomes a Ram Shed would carry the surplus over and hand out several men
       * at once the moment the masons left. Clamp it to what the new recruit actually costs. */
      const mus2 = mustersOf(s);
      if (mus2 && s.paid > 0) s.paid = Math.min(s.paid, C.UNITS[mus2.kind].cost * C.TIER[s.level - 1]);
      /* a work whose level buys STONE rather than an effect — the Curtain Wall, which has no
       * effect to buy — grows its hit points, keeping the damage already done to it */
      if (C.BUILDINGS[s.bt].hpAt) {
        const was = s.maxHp;
        s.maxHp = C.BUILDINGS[s.bt].hpAt[s.level - 1] * sizeOf(s);
        s.hp = Math.min(s.maxHp, s.hp + (s.maxHp - was));
      }
      emit(world, { e: 'up', pi, id: s.id, level: s.level, br: s.br || null, x: s.x, y: s.y });
      return { ok: true };
    }
    /* ---------------- mend a breach ----------------
     * A crew, a while, and half what the run cost to raise. It is not standing again until
     * they are finished — a wall you are repairing shelters nobody, which is what makes
     * mending one under fire a real decision rather than a button. */
    if (cmd.c === 'fix') {
      const s2 = bldOf(world, pi, cmd.id);
      if (!s2) return { ok: false, err: 'id' };
      if (!s2.breach) return { ok: false, err: 'whole' };
      if (s2.work > 0) return { ok: false, err: 'working' };
      const crews = s2.crews || 1;
      if (rising(world, pi) + crews > masons(world, pi)) return { ok: false, err: 'busy' };
      const price = Math.max(1, Math.round(C.BUILDINGS.wall.cost * sizeOf(s2) * C.WALL.repair));
      if (pl.essence < price) return { ok: false, err: 'essence' };
      pl.essence -= price;
      s2.work = s2.workFor = Math.max(1, C.BUILDINGS.wall.raise * sizeOf(s2) * C.WALL.fixWork);
      s2.fixing = 1;
      emit(world, { e: 'mending', pi, id: s2.id, x: s2.x, y: s2.y });
      return { ok: true };
    }
    /* TURN A RUN ABOUT. `station` works out which face of a curtain is the sheltered one from
     * where the owner's Seat lies. For the curtain you draw across the approach to your own
     * Seat that is exactly right, and it is right for nothing else: a run thrown up around a
     * forward spring, or along a flank, or between two rivals in a free-for-all, faces home and
     * puts the whole reserve in the field on the wrong side of its own stone. Which way the war
     * is coming from is not a thing the sim can work out — it changes hour to hour, and in a
     * four-handed match there is no single answer — so it is the player's to say.
     *
     * It costs nothing, takes no crew and may be given while the run is still going up: it is
     * an ORDER about a wall, not work done to one. Like the halt it asks for a STATE rather
     * than a toggle, so two seats tapping it in the same tick cannot cancel each other out. */
    if (cmd.c === 'flip') {
      const s3 = bldOf(world, pi, cmd.id);
      if (!s3) return { ok: false, err: 'id' };
      if (!isWall(s3)) return { ok: false, err: 'nowall' };
      const on = cmd.on === undefined ? !s3.flip : !!cmd.on;
      if (on) s3.flip = 1; else delete s3.flip;
      return { ok: true };
    }
    if (cmd.c === 'walk') {
      if (!pl.buildings.some((b) => b.bt === 'shrine')) return { ok: false, err: 'shrine' };
      pl.walking = !!cmd.on;
      if (pl.walking && !pl.revealed) { pl.revealed = true; emit(world, { e: 'walk', pi }); }
      return { ok: true };
    }
    if (cmd.c === 'muster') {
      /* A COMPANY MAY GO QUIET WITHOUT THE REALM GOING QUIET. The valve was the Seat's alone,
       * so hoarding for a Gate meant stopping every hall you own — including the one holding
       * the line. Named with a company it silences that standard's halls and no others; named
       * with nothing it is the old realm-wide order, which is still what the Seat's sheet
       * sends. The two stack: a hall is quiet if either says so, and lifting one does not
       * countermand the other. */
      if (cmd.co != null) {
        const co = coOf(world, pi, cmd.co);
        if (!co) return { ok: false, err: 'co' };
        co.paused = !!cmd.pause;
        emit(world, { e: 'muster', pi, co: co.id, pause: co.paused });
        return { ok: true };
      }
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
      /* move a hall between companies, or on to a new one of its own. There is nowhere to
       * move it OUT to: a hall without a standard would be a hall you cannot give orders to. */
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
        /* THE TRUMP GETS A STANDARD OF ITS OWN. Everything that fights answers a flag now, and
         * the champion answered none — he was spawned under the old company 0, which meant
         * "follows the gold banner", and the gold banner is gone. He walked to wherever the
         * Recall last pointed and could not be ordered anywhere else. His company is marked,
         * so the tray can show it for what it is rather than as another numbered detachment. */
        const tco = { id: pl.nextCo++, rally: null, trump: true };
        pl.companies.push(tco);
        pl.championId = spawnUnit(world, pi, 'champion', undefined, undefined, undefined, tco.id);
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
  /* EVERY HALL FLIES A STANDARD. There is no company 0 any more — no "under the gold banner",
   * because there is no gold banner. A hall raised without a company named raises one of its
   * own, which is what makes the first Barracks simply work: you get a flag, and it is that
   * hall's flag. A new company starts with no rally, meaning it holds where the army holds,
   * until you pick its flag up and point it somewhere. */
  function joinCo(world, pi, want) {
    const pl = world.players[pi];
    const n = +want || 0;
    if (want !== 'new' && n && coOf(world, pi, n)) return n;
    const co = { id: pl.nextCo++, rally: null };
    pl.companies.push(co);
    return co.id;
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
    /* AND A HALL KEEPS ONLY SO MANY. This is the ceiling that is actually in force — `CAP.player`
     * is off — and it is per WORK rather than per realm, which is what makes it a decision
     * instead of a wall: a full hall stops drawing, the surplus accumulates, and the answer to
     * wanting a bigger army is another hall. See `HALL_KEEP`.
     *
     * The living only. A man killed frees his place on the tick he is cleared, so a company
     * ground down is a company the hall refills — which is what makes a hall a standing
     * SUPPORT rather than a lifetime quota, and what makes attrition recoverable.
     *
     * `from` is the hall's id and ids are never reused, so a man outlives the hall that raised
     * him without ever counting against a later one built on the same ground. */
    const keep = from > 0 ? C.UNITS[kind].keep : 0;
    if (keep > 0) {
      let held = 0;
      for (const u of world.units) if (u.from === from && u.hp > 0) held++;
      if (held >= keep) return 0;
    }
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
      /* he carries no place in the line: a place is dealt to him every tick from his RANK
       * among the men standing at the same flag — see musterAll and bodyPlace */
      rank: 0,
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

  /* ---------------- THE MUSTER IS A BODY OF MEN ----------------
   * A place in the line used to be PROPERTY: dealt to a man once, at muster, off a per-heir
   * counter that only ever went up — `r = space * 0.6 * sqrt(k)` on a phyllotaxis spiral,
   * capped at 300. Three faults, all of them reported from play and all of them the same fault.
   *   The RING. Past the 516th recruit of a match the cap binds and every further man is handed
   * r = 300 EXACTLY, so a late-match company stands on one circle six hundred units across.
   * (Measured: the counter reaches 433 by fifteen minutes of bot play, so the second half of a
   * long match is all ring.)
   *   The HOLES. The counter is never reused, so the men who fall leave their places empty for
   * the rest of the match and the survivors are a scatter of singles. Measured: 26% of the men
   * standing at a flag had no fellow within two paces of them.
   *   The SPREAD. Places are dealt per HEIR and men gather per FLAG, so an army split between
   * two standards gives each of them every other place of a disc sized for both — half density,
   * twice the ground, for nothing.
   *
   * So a place is not property. It is dealt afresh every tick from the man's RANK among the
   * living men standing at the same flag: rank 0 in the middle, and each shell out one berth
   * wider, holding as many men as fit round it a berth apart. The body is then sized to the
   * company that is actually there — it is a disc at every size and never a ring — and when a
   * man falls every man behind him steps up one place, which is what closing ranks IS.
   * Consecutive ranks are NEIGHBOURS on purpose. The spiral this replaces turns 137° per step,
   * so re-dealing its places after a death would have sent half the company marching across
   * the disc to swap ends; here a death moves a man one berth. */
  /* MEMOISED, because this is once per man per tick and the answer never changes: the place of
   * the k-th man of a body is a constant of the shape, not of the match. Two shapes are asked
   * for today (the field's, from a point, and the Seat's, from the tower's ground), so the
   * table is keyed by the pair that defines one. */
  const bodyTab = new Map();
  function bodyPlace(k, r0, berth) {
    const key = r0 * 4096 + berth;
    let tab = bodyTab.get(key);
    if (!tab) bodyTab.set(key, tab = []);
    let p = tab[k];
    if (p) return p;
    let i = 0, base = 0;
    for (;;) {
      const r = r0 + i * berth;
      const n = r < berth * 0.5 ? 1 : Math.max(1, Math.round(2 * Math.PI * r / berth));
      if (k < base + n) {
        /* half a berth of stagger between shells: without it the men line up in spokes and
         * the gaps between the spokes read as a hole in the body */
        const a = (k - base + (i % 2) * 0.5) * (Math.PI * 2 / n);
        return (tab[k] = { x: Math.cos(a) * r, y: Math.sin(a) * r, r });
      }
      base += n; i++;
    }
  }
  /* ...AND NOBODY IS SENT OFF THE BOARD. A place is an order's point plus an offset, and an
   * order given near the edge of the world hands the back ranks ground that does not exist:
   * nothing out there stops them, because the flow field only steers INSIDE its grid and within
   * `NAV.arrive` of his order a man walks at his place in a straight line regardless. Measured
   * before this: 0.74% of all places lay off the map, and men stood as much as 94 units beyond
   * the edge of the world, in the dark. Water does the same thing in the middle of the board.
   * Refused at the SOURCE rather than clamped after the fact — the man is never GIVEN a place he
   * has no business standing on. It is folded back toward the flag until it is ground. */
  function standable(world, x, y) {
    const m = C.CROWD.space;
    if (x < m || y < m || x > C.MAP.W - m || y > C.MAP.H - m) return false;
    const c = NAV.cellOf(world.nav, x, y);
    return c >= 0 && world.nav.cost[c] > 0;
  }
  /* AN UNREACHABLE ORDER IS FOLDED ONTO THE NEAREST STANDABLE GROUND — the other half of
   * `placeAt`, which folds a PLACE. A tap is clamped to the board by `applyCommand`, but the
   * board is not the ground: a banner planted in a lake, on a crag, or set past the edge by a
   * test or a doctrine is an order no man can carry out. While men could still walk onto bad
   * ground they simply went — which is the bug `stand` and `jostle` now refuse — and once they
   * refuse, a company sent at water pressed against the bank and stacked. Folded HERE, at the
   * order, the whole body gathers on the bank instead: the flow field, the muster ground and
   * every man's place all follow the folded point, so nothing downstream has to know.
   * Cached in a WeakMap keyed by the order object — NOT on the order itself, because a rally
   * rides the snapshot verbatim (net.js) and a cache written onto it would leak to every
   * guest. Terrain cost never changes within a match (walls live in the nav MASKS, not the
   * cost), so a fold is true for as long as the order stands, and a new order arrives as a
   * new object and falls out of the map with the old one. The scan is the whole grid, once
   * per bad order: exact, and cheaper than being clever about rings. */
  function foldOrder(world, p) {
    if (!p || standable(world, p.x, p.y)) return p;
    const folds = world._folds || (world._folds = new WeakMap());
    let f = folds.get(p);
    if (f) return f;
    const nav = world.nav, cw = nav.cw;
    let bx = p.x, by = p.y, bd = Infinity;
    for (let cy = 0; cy < nav.H; cy++) for (let cx = 0; cx < nav.W; cx++) {
      if (nav.cost[cy * nav.W + cx] === 0) continue;
      const x = (cx + 0.5) * cw, y = (cy + 0.5) * cw;
      if (!standable(world, x, y)) continue;   // the board's margin is part of "standable"
      const d = (x - p.x) * (x - p.x) + (y - p.y) * (y - p.y);
      if (d < bd) { bd = d; bx = x; by = y; }
    }
    f = { x: bx, y: by, site: p.site != null ? p.site : -1 };
    folds.set(p, f);
    return f;
  }
  function placeAt(world, cx, cy, off) {
    if (standable(world, cx + off.x, cy + off.y)) return { x: cx + off.x, y: cy + off.y };
    /* ALONG HIS OWN BEARING, and not onto the flag. Folding a bad place all the way back to the
     * order's point puts every man it happens to whose place is over water on the same foot of
     * ground: measured on a banner planted off the board, the whole company stacked at an
     * average of six units apart and never came to rest. He takes the nearest ground on the
     * line he was given, which keeps the men who fold apart from each other. */
    for (let i = 0; i < 3; i++) {
      const f = 0.75 - i * 0.25;
      if (standable(world, cx + off.x * f, cy + off.y * f)) return { x: cx + off.x * f, y: cy + off.y * f };
    }
    /* No ground anywhere on the bearing: the order is on a crag, in the sea, or hard against the
     * edge of the world. THE BOARD IS NOT NEGOTIABLE, though. An order may legally be given at
     * x=0 — `applyCommand` clamps a tap to the board and that IS the clamp — and a body a
     * hundred deep behind a flag on the shoreline was handing a third of its men ground beyond
     * the world's edge, where there is nothing to stop them: measured at 28 men of 96 standing
     * up to 88 units out in the dark. Each axis is held separately so he keeps the other one:
     * fold both together on a single scale and the whole flank lands on one foot of ground.
     * A berth of margin, and a company ordered to the very edge forms up just inland of its own
     * standard — which is the truth of it: there is nothing to stand on out there. The margin is
     * what the CROWD needs, too. Held exactly at the boundary instead, the men pressed against
     * it were still shoved over it by the separation pass, which knows nothing about the world's
     * edge: 8 of 96 a few units out in the dark.
     * There used to be a third case here — an order off the board ENTIRELY was left alone as
     * "an order to TRY", because men could still walk off the map and trying beat stacking on
     * the boundary. That walk is the bug `stand` now refuses, and the order itself is folded
     * onto standable ground before it reaches this function (see foldOrder), so the case
     * cannot arise from the march any more. */
    const m = C.CROWD.space;
    const hold = (p, hi) => Math.max(m, Math.min(hi - m, p));
    return { x: hold(cx + off.x, C.MAP.W), y: hold(cy + off.y, C.MAP.H) };
  }
  /* WHO IS STANDING AT WHICH FLAG, counted once a tick, before anyone moves. The key is the
   * ORDER'S POINT and not the company: every company without a rally of its own follows the War
   * Banner, so it is the point that gathers men and not the standard, and Chaos — which has no
   * companies at all — is dealt into the same line by the site it was sent to.
   * The goal is settled here too, because the rank cannot be counted until it is known. */
  function musterAll(world) {
    const at = world._muster || (world._muster = new Map());
    at.clear();
    for (const u of world.units) {
      if (u.hp <= 0) continue;
      if (u.owner !== C.CHAOS_ID) {
        const pl = world.players[u.owner];
        const co = u.co ? coOf(world, u.owner, u.co) : null;   // its company, if it still exists
        /* folded, so an order given on water gathers the company on the bank — see foldOrder */
        const want = foldOrder(world, co && co.rally ? co.rally : pl.banner);
        if (u.goal !== want) u.goal = want;
      }
      /* a berth on a parapet and a room in a tower are STATIONS, and a station is exact. Neither
       * takes a place in the body, and neither is counted for one — a tower's garrison holding
       * ranks 3 to 12 would leave ten empty places in the middle of the company outside. */
      if (u.man || u.tow || !u.goal) { u.rank = 0; continue; }
      /* a NUMBER for a key, not a string: this runs for every man every tick and building
       * "0:1234:567" thirty times a second for an army is a measurable share of the sim */
      const k = (u.owner + 2) * 33554432 + Math.round(u.goal.y) * 4096 + Math.round(u.goal.x);
      const n = at.get(k) || 0;
      at.set(k, n + 1);
      u.rank = n;
    }
  }
  const tierOf = (u) => Math.max(1, Math.min(C.TIER.length, u.tier || 1));
  function hurt(world, victim, dmg, byOwner) {
    /* THE TOWER IS THE SHIELD. A garrison used to stand on the crown and be shot like a man on
     * a parapet, which made filling a tower a way to lose archers slightly further from home:
     * a bombard's burst took the lot, and a tower's whole worth is that it is a ROOM. Inside,
     * the only way to the men is through the stone — the tower's own hit points are what an
     * attacker has to spend, and when it goes they are back in the field on the same tick with
     * whatever they had left. Guarded here rather than at each of the half-dozen places that
     * deal damage, because a splash pass added later would not have known to ask. */
    if (victim.in) return;
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
  /* KEEP THE MAN YOU ARE FIGHTING. Acquisition is a look at the nine grid cells around you,
   * which is cheap when the board is empty and quadratic when two armies are standing in each
   * other — every man scanning every other man, thirty times a second. Profiled with 1500 men
   * in contact: 94% of the tick, and 40% of a frame's whole budget before a pixel is drawn.
   * A man in a melee is fighting the same man for seconds at a time, so the answer is to stop
   * asking. The target is remembered and re-validated — alive, still hostile, still in reach,
   * still not behind stone — which is a handful of arithmetic against a scan of hundreds.
   * It is refreshed on a stagger anyway, `RETARGET` ticks apart and offset by id, so nobody
   * clings to a distant foe while a nearer one is at his elbow, and no two men re-scan on the
   * same tick. Only UNIT targets are cached: works and Seats are found by a walk of a short
   * list, they are chosen by rules that read the whole field, and they are not the hot path. */
  const RETARGET = 15;
  function cached(world, u, radius) {
    const v = u._t;
    if (!v || v.hp <= 0 || v.owner === u.owner) return null;
    const d = Math.sqrt(d2(u.x, u.y, v.x, v.y));
    if (d >= radius) return null;
    if (world.anyWall && walled(world, u.x, u.y, v.x, v.y, u.owner, v.owner)) return null;
    /* re-validated like the wall: a mark chased AROUND a ridge is a mark lost behind it */
    if (rockBetween(world, u.x, u.y, v.x, v.y)) return null;
    return { t: v, kind: 'unit', d, x: v.x, y: v.y };
  }
  function acquire(world, u, radius) {
    if ((world.tick + u.id) % RETARGET !== 0) {
      const held = cached(world, u, radius);
      if (held) return held;
    }
    /* a fallen heir has nothing left to attack — and their Seat is a ruin, not a target */
    let best = null, bestD = radius, kind = null, bx = 0, by = 0;
    /* A WALL IS OPAQUE — AND SO IS THE LAND'S OWN STONE. Nothing is a target if stone stands
     * in the way, raised or grown: the soldier looks past it to whatever he CAN see, which is
     * what makes men behind a curtain (or a ridge) safe and what sends an army that wants
     * them round it. The wall half still costs nothing until a wall exists; the rock half
     * always pays, because the ridge was always there. */
    const seen = (x, y, owner, skip) => !rockBetween(world, u.x, u.y, x, y)
      && (!world.anyWall || !walled(world, u.x, u.y, x, y, u.owner, owner, skip));
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
        /* a man inside a tower is not a target — the stone is. `hurt` refuses the blow anyway,
         * but a swordsman who aimed at him would stand at the foot of the tower swinging at
         * somebody he can never reach instead of going for the tower or moving on. */
        if (v.in) continue;
        if (d < bestD && seen(v.x, v.y, v.owner)) consider(d, v, 'unit', v.x, v.y);
      }
    }
    /* A SHOOTER DOES NOT TOUCH STONE. Archers, sorcerers, wardens and binders have no target
     * among works or Seats at ALL — not a reduced blow, no target — so a shooter who can find
     * nobody to shoot simply keeps marching past the wall. A zero siege multiplier would not
     * have done it: `acquire` would still have handed him the nearest curtain and he would have
     * stood in front of it swinging at nothing for the rest of the match. The consequence is
     * deliberate and it is the point: a host of shooters cannot end a match, so a siege needs
     * the Shieldwall, the Ram or the Bombard to go with it.
     *
     * THE SHRINE IS THE ONE EXCEPTION, and it is not a hack — pillar 3 requires it. "A walking
     * player must be attackable" is the rule the whole Pattern rests on, and without this a
     * walker was unattackable by half of every army on the board: measured, the Pattern decided
     * 92% of contested matches and matchups ran to the twenty-minute cap because nobody could
     * reach the man. What a shooter aims at here is not the stone, it is the WALKER standing in
     * the lines — which is why this one work, and no other, is a target for him. */
    const menOnly = !!C.UNITS[u.kind].menOnly;
    for (let ci = 0; ci < world.players.length; ci++) {
      if (ci === u.owner) continue;
      const tp = world.players[ci];
      if (tp.out) continue;
      const cs = world.map.sites[world.map.cities[ci]];
      const dc = Math.sqrt(d2(u.x, u.y, cs.x, cs.y));
      for (const b of tp.buildings) {
        /* a shooter looks past every work but the Shrine — see the note above the loop */
        if (menOnly && b.bt !== 'shrine') continue;
        /* the stone you strike is the span in front of you, not the middle of the run — and
         * that is true of a run the masons are still on. Judged by its MIDPOINT, a curtain
         * going up was untouchable along nearly its whole length: a man standing at the end
         * of a long shell measured half a run away from it, found nothing in reach and stood
         * there while it finished. A work is a work from the moment it is paid for. */
        const w = isWall(b), aim = w ? segNear(b, u.x, u.y) : b;
        const d = w ? Math.sqrt(segD2(b, u.x, u.y)) : Math.sqrt(d2(u.x, u.y, b.x, b.y));
        /* YOU STRIKE THE STONE WHEN THERE IS NOTHING ALIVE TO STRIKE. A curtain is always
         * the nearest thing to a man standing at it, so judging walls by distance like any
         * other work meant an assault hacked at the masonry while the parapet above shot
         * down at it untouched — the exact opposite of the bargain. Walls are held back and
         * weighed only if nothing else was found, scaffolding with the rest: a shell is worth
         * knocking over, but never while a living man is in reach. */
        if (w) { if (d < bestD && seen(aim.x, aim.y, ci, b)) stone.push([d, ci, b.id, aim.x, aim.y]); continue; }
        if (d < bestD && seen(aim.x, aim.y, ci))
          consider(d, { pi: ci, id: b.id }, 'work', aim.x, aim.y);
      }
      /* and a Seat is stone like any other — the Shrine exception is the SHRINE, not "any
       * work that matters". A shooter at a rival's gate still cannot take it. */
      if (menOnly || dc > C.CITY.r + radius) continue;
      if (dc < bestD && seen(cs.x, cs.y, ci)) consider(dc, { pi: ci }, 'tower', cs.x, cs.y);
    }
    if (!best && stone.length) {
      stone.sort((p, q) => p[0] - q[0]);
      const [d, ci, id, ax, ay] = stone[0];
      consider(d, { pi: ci, id }, 'work', ax, ay);
    }
    u._t = kind === 'unit' ? best : null;
    return best ? { t: best, kind, d: bestD, x: bx, y: by } : null;
  }

  /* ---------------- the Warden mends ----------------
   * NOTHING ELSE IN AMBER HEALS A WOUND. Works self-mend when nobody is hitting them; a man
   * who walks out of a fight on twenty hit points carries them to the end of the match. That
   * is what makes a Warden worth more than the soldier he saves, and it is also why he must
   * not be a wall against attrition: he mends ONE man at a time, the worst hurt within reach,
   * and never himself — two Wardens standing together would otherwise be unkillable by
   * anything that cannot out-damage them both at once.
   * He does not mend works: stone has `STRUCT_REGEN` and does not need a man. */
  function mendNear(world, u, def, dt) {
    /* the same stagger `acquire` uses: the worst-hurt man is re-chosen a few times a second
     * rather than every tick, and no two Wardens scan on the same one */
    if ((world.tick + u.id) % RETARGET === 0 || !u._m || u._m.hp <= 0 ||
        u._m.hp >= u._m.maxHp || d2(u.x, u.y, u._m.x, u._m.y) > def.mendR * def.mendR) {
      let worst = null, gap = 0;
      forNear(world, u.x, u.y, def.mendR, (v) => {
        if (v.owner !== u.owner || v === u || v.hp >= v.maxHp) return;
        if (d2(u.x, u.y, v.x, v.y) > def.mendR * def.mendR) return;
        const g = v.maxHp - v.hp;
        if (g > gap) { gap = g; worst = v; }
      });
      u._m = worst;
    }
    const m = u._m;
    if (!m || m.hp <= 0 || m.hp >= m.maxHp) return;
    m.hp = Math.min(m.maxHp, m.hp + def.mend * dt);
    /* a thread of light, for the renderer — and it carries a position, so the fog filter
     * hides it from anyone who cannot see it without another rule */
    if (world.tick % 6 === 0) emit(world, { e: 'mend', pi: u.owner, x: u.x, y: u.y, to: { x: m.x, y: m.y } });
  }
  /* ---------------- the Binding ----------------
   * ONLY CHAOS, AND ONLY WHEN IT IS ALREADY BEATEN. A binder turns a fiend that has been
   * fought down below `bindHp` — you pay for it in the fight first, so it is a reward for
   * holding the black road rather than a way of skipping it. It never takes a rival's troops:
   * the test is `owner === CHAOS_ID` and nothing looser, because "not mine" would quietly
   * become "anyone's" the first time somebody refactored it.
   *
   * AND SHADOW WILL NOT HOLD IT. `CAP.chaos` counts fiends by owner, so every one bound frees
   * a slot for the road to tear open another — left permanent, a binder host would farm Chaos
   * into a private army and the match would be about the weather again, which is the exact
   * failure capping the black road was meant to end. A bound fiend serves for `BIND_LIFE` and
   * then dissolves. */
  function bindNear(world, u, def) {
    let best = null, bd = def.bindR * def.bindR;
    forNear(world, u.x, u.y, def.bindR, (v) => {
      if (v.owner !== C.CHAOS_ID || v.hp > v.maxHp * def.bindHp) return;
      const d = d2(u.x, u.y, v.x, v.y);
      if (d < bd) { bd = d; best = v; }
    });
    if (!best) return false;
    const pl = world.players[u.owner];
    best.owner = u.owner;
    best.co = u.co;                  // it marches under the standard that took it
    best.from = -1;
    best.tier = 1;
    best.goal = pl.banner;
    best._t = null;                  // it was hunting everyone; it is not any more
    best.bound = world.t + C.BIND_LIFE;
    /* it takes its place in the line at the next muster, like any other man: the ranks are
     * dealt by who is standing at the flag, so joining the company IS joining the body */
    emit(world, { e: 'bind', pi: u.owner, x: best.x, y: best.y });
    return true;
  }

  function hurtBuilding(world, pi, id, dmg, by) {
    const pl = world.players[pi], i = pl.buildings.findIndex((b2) => b2.id === id);
    if (i < 0) return;
    const b = pl.buildings[i];
    b.hp -= dmg; b.lastHurt = world.t;
    /* A BREACHED CURTAIN IS A RUIN. Every other work is rubble and gone; a wall stays, broken
     * — it bars nothing and hides nobody, which is the whole point of having broken it, but
     * the masons can raise it again for half the stone. Otherwise winning a stretch of wall
     * once wins it forever, and a long run is a single hit-point bar you cannot mend. */
    /* ...but ONLY a run that actually stood. A shell knocked over is not a ruin to mend: it
     * is a hole in the ground and the essence is gone. Breaching one instead left a wall that
     * had never been a wall wearing a breach, with the masons still raising it — the raise
     * healed the rubble back up, the run reported itself 'raised' while barring nothing, and
     * `fix` then bought the whole curtain for half the stone, which is cheaper than finishing
     * the one you were already paying for. */
    if (b.hp <= 0 && isWall(b) && !b.breach && !b.raise) {
      /* THE RUBBLE HAS HIT POINTS OF ITS OWN. A ruin left at zero would be swept off the
       * board by the very next blow that touched it — the record gone and the mend with it.
       * It keeps a share of its stone: enough that clearing the ground is WORK, and it can
       * be cleared, which is the point of being allowed to hit it at all. */
      b.hp = Math.max(1, b.maxHp * C.WALL.rubble); b.breach = 1; b.work = 0; b.fixing = 0;
      world.navVersion++; noteWalls(world);
      emit(world, { e: 'breach', pi, id: b.id, x: b.x, y: b.y, by: by == null ? null : by });
      return;
    }
    if (b.hp <= 0) {
      emit(world, { e: 'raze', pi, id: b.id, bt: b.bt, x: b.x, y: b.y, by: by == null ? null : by });
      /* AND THE GARRISON IS IN THE FIELD AGAIN. They were sheltered by this stone and it is
       * gone, so they come out where it stood, on this tick and not on the next pass — a man
       * left carrying `tow` for a tower that no longer exists is a man nothing can hurt.
       * `postTowers` would clear it a tick later; a tick of invulnerability at the exact moment
       * the tower falls is a tick spent inside the assault that felled it. They keep the hit
       * points they went up with: taking the tower is what the attacker paid for, not the men.
       * Spread around the ruin rather than stacked on it, so the crowd rule has somewhere to
       * put them and the company reads as a company. */
      const spill = world.units.filter((u) => u.in === b.id);
      for (let k = 0; k < spill.length; k++) {
        const u = spill[k];
        const a = (k + 0.5) / spill.length * Math.PI * 2;
        u.tow = 0; u.in = 0;
        u.x = b.x + Math.cos(a) * C.TOWER.ring; u.y = b.y + Math.sin(a) * C.TOWER.ring;
      }
      /* a man still WALKING to it was never in it — he keeps his feet and loses the errand */
      for (const u of world.units) if (u.tow === b.id) u.tow = 0;
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
    } else if (world.t - (pl.alertAt || -99) > C.HURT_ALERT) {
      pl.alertAt = world.t;
      /* WHO is at the gate. This banner fired for anything that scratched a work, so a
       * rift chewing an outlying Gate read as "the enemy is inside your city" exactly like a
       * rival's assault — and a player watching for the rival never saw the black road
       * taking three quarters of their army. */
      emit(world, { e: 'hurtcity', pi, x: b.x, y: b.y, by: by == null ? null : by });
    }
  }

  /* ---------------- the Tower of the Seat shoots ----------------
   * The Seat is not in `pl.buildings` — it is the city site, with its hit points in
   * `pl.castleHp` — so its gunnery cannot live in the per-building loop and its cooldown has
   * nowhere to sit but the player. That is the only reason this is a pass of its own.
   *
   * AND ITS SHOT IS NOT STOPPED BY STONE. Every other gun on the board is: that is what makes a
   * curtain worth its price, and what makes raising a tower INTO one a decision rather than a
   * formality. The Seat is the deliberate exception, because the answer available to a
   * Watchtower is not available to it — a tower shut in by a wall can be rebuilt on the wall,
   * and the Seat stands where worldgen put it forever. Left blockable, the first thing any
   * besieger would raise is a curtain across the court, and the throne's own guns would be
   * switched off by the cheapest work in the game from outside their reach. It stands a hundred
   * feet over its own city; it shoots over everything, including its owner's walls. */
  function seatFire(world, pi, pl, city, dt) {
    /* a toppled heir's Seat is a ruin, and a ruin does not shoot — the update loop skips a
     * fallen heir already, but the rule belongs with the gun rather than with the caller */
    if (pl.out || !city) return;
    const g = C.SEAT_GUN;
    pl.seatCd = (pl.seatCd || 0) - dt;
    if (pl.seatCd > 0) return;
    /* hostile to its owner, exactly as a tower is: rivals AND the black road, and nobody of
     * his own. `forNear` walks the same spatial hash the towers do.
     * NO rockBetween HERE, DELIBERATELY — the Seat's gun is not stopped by the land's rock,
     * exactly as it is not stopped by walls (see SEAT_GUN): the Seat stands where worldgen
     * put it forever, and a throne a lucky ridge could shade would have its guns switched
     * off from outside their reach for the whole match — the same hole the walls exemption
     * closed, reopened by terrain nobody chose. */
    let best = null, bd = g.range * g.range;
    forNear(world, city.x, city.y, g.range, (u) => {
      if (u.owner === pi) return;
      const d = d2(u.x, u.y, city.x, city.y);
      if (d < bd) { bd = d; best = u; }
    });
    if (!best) { pl.seatCd = 0.15; return; }   // ready again shortly, so an arrival is answered
    hurt(world, best, g.dmg, pi);
    /* the burst is the cannon's, and it falls off the same way: a column bleeds, no single
     * foe dies to it */
    if (g.splash > 0 && g.splashDmg > 0) {
      const r2 = g.splash * g.splash, hits = [];
      forNear(world, best.x, best.y, g.splash, (u) => {
        if (u.owner === pi || u === best) return;
        if (d2(u.x, u.y, best.x, best.y) < r2) hits.push(u);
      });
      for (const u of hits) hurt(world, u, g.splashDmg, pi);
    }
    /* the renderer draws a shot from this event and nothing else, so it must have a tower's
     * shape. `id: 0` because work ids are handed out from 1: anything that goes looking for the
     * building that fired finds nothing, which is the truth. `br: 'cannon'` is not a branch —
     * the Seat has none — it is the colour a bursting shot is drawn in, and this one bursts. */
    emit(world, { e: 'shot', pi, id: 0, x: city.x, y: city.y,
                  to: { x: best.x, y: best.y }, br: 'cannon', splash: g.splash });
    pl.seatCd = g.atk;
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
          /* THE SHELL FILLS OUT BY ITS OWN STONE, AND KEEPS WHAT WAS TAKEN OUT OF IT. Two
           * things were wrong with reading the ramp off the card. It measured `def.hp` — one
           * crew's worth — so a run bought by the foot started ABOVE the ramp and sat frozen
           * at its opening hit points for the whole raise, then stood finished at a fraction
           * of the stone it had been paid for. And it SET hp rather than adding to it, so
           * every blow struck at a work under construction was handed back by the next tick
           * of masonry: a shell could be hammered all day and never fall. It grows by its
           * share of the work done, damage stays done, and a shell can be knocked over. */
          b.hp = Math.min(b.maxHp, b.hp + b.maxHp * (1 - C.RAISE.hpFrom) * dt / b.raiseFor);
          if (b.raise <= 0) {
            /* the ground changes the moment the stone is finished, not when it was paid for */
            if (isWall(b)) { world.navVersion++; noteWalls(world); }
            emit(world, { e: 'raised', pi, id: b.id, bt: b.bt, x: b.x, y: b.y });
          }
          continue;
        }
        /* A RUIN DOES NOT HEAL ITSELF. Works mend over time when nobody is hitting them, and
         * a breached wall inherited that — so rubble quietly climbed back toward a full wall's
         * hit points while staying breached: harder and harder to clear, and never any use to
         * anyone. A breach is closed by masons and by nothing else. */
        if (b.hp < b.maxHp && t - b.lastHurt > C.STRUCT_REGEN_WAIT && !b.breach)
          b.hp = Math.min(b.maxHp, b.hp + C.STRUCT_REGEN * dt);
        /* THE MASONS ARE IN THE YARD. A work being raised a level is still a work — it stands,
         * it blocks, it sees, it holds its spring, and it can be broken — but it does not do
         * its JOB while they are on it: no muster, no shot, no income. That is what makes the
         * timing of an upgrade a decision rather than a formality. */
        if (b.work > 0) {
          b.work = Math.max(0, b.work - dt);
          if (b.work <= 0) {
            if (b.fixing) {
              /* the stone is back: it bars the ground again, and every flow field drawn while
               * the gap was open is now wrong */
              b.fixing = 0; b.breach = 0; b.hp = b.maxHp;
              world.navVersion++; noteWalls(world);
              emit(world, { e: 'mended', pi, id: b.id, x: b.x, y: b.y });
            } else emit(world, { e: 'upped', pi, id: b.id, bt: b.bt, level: b.level, x: b.x, y: b.y });
          }
        }
        const working = b.work > 0;
        /* a Gate on a spring of Shadow draws far more than one that merely stands about */
        if (b.bt === 'gate') income += !working && b.node >= 0 ? def.nodeIncome[b.level - 1] : 0;
        else if (def.spawns) {
          const bco = b.co ? coOf(world, pi, b.co) : null;
          if (pl.musterPaused || (bco && bco.paused)) { b.cd = Math.max(b.cd, 0.5); continue; }
          /* A HALL BEING RAISED A LEVEL MUSTERS NOBODY. That is the price of the upgrade
           * beyond its essence, and the reason to think about WHEN rather than only whether:
           * the men you would have had while the masons were in the yard are the real cost. */
          if (b.work > 0) { b.cd = Math.max(b.cd, 0.5); continue; }
          /* WHICH MAN, and how often — the branch's answer once the hall has forked, the
           * table's before that. A Barracks that chose the Shieldwall stops raising soldiers. */
          const mus = mustersOf(b);
          const price = C.UNITS[mus.kind].cost * C.TIER[b.level - 1];
          const per = mus.period;
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
              if (spawnUnit(world, pi, mus.kind, sp.x, sp.y, undefined, b.co, b.id, b.level)) {
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
            /* A TOWER DOES NOT SHOOT THROUGH STONE — not even its own. It used to: the rule
             * was that a gun stands higher than a curtain, which made a wall no answer to a
             * tower and, worse, made the safest place for one the ground BEHIND a wall, where
             * it was untouchable and unobstructed. Now a tower is blocked like anything else,
             * and the way to give one a field of fire over a curtain is to build it INTO the
             * curtain — which is what `onWall` is. A tower behind the wall covers the ground
             * behind the wall, and that is a real choice rather than a free one. */
            const mine = b.onWall ? world.walls.find((q) => q.b.id === b.onWall) : null;
            forNear(world, sp.x, sp.y, st.range, (u) => {
              if (u.owner === pi) return;
              const dd = d2(u.x, u.y, sp.x, sp.y);   // a tower guards ITS OWN ground
              if (dd >= bd) return;
              if (world.anyWall && walled(world, sp.x, sp.y, u.x, u.y, pi, u.owner, mine && mine.b)) return;
              /* and a tower does not shoot through the land's rock either — the gun that
               * wants the far side of the ridge is built on the ridge */
              if (rockBetween(world, sp.x, sp.y, u.x, u.y)) return;
              bd = dd; best = u;
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
      /* and the Seat itself, which is a tower with no work to hang its gunnery on */
      seatFire(world, pi, pl, city, dt);
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
    if (!world.surged && t > C.CHAOS.surgeAt) { world.surged = true; emit(world, { e: 'surge' }); }

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

    /* the parapet roster, before anyone moves or shoots: who is ON the wall this tick decides
     * both where he walks and whether he can shoot over it */
    postAll(world);
    /* ...and then the ranks: whose order is where, and who is standing where in the body it
     * gathers. Both are settled before a man moves, so every place in a company is dealt
     * against the same picture of who is alive. */
    musterAll(world);
    /* WHERE EVERY MAN STOOD BEFORE THIS TICK TOUCHED HIM. The last `stand` of the tick runs
     * after the crowd pass, where there is no single step to slide along — and without one it
     * can only REPEL, which snapped a man back onto the rim of a work every tick and undid the
     * slide the march had just made. Measured: 23 men across three matches standing at exactly
     * BUILD.pass from a Gate with an order 1300-1900 away, one of them for 307 seconds. */
    for (const u of world.units) { u._px = u.x; u._py = u.y; }
    /* units: fight what's near, else march the paths toward the banner/goal */
    const n = world.units.length, fwd = world.tick % 2 === 0;   // alternate order: no first-strike seat bias
    for (let ii = 0; ii < n; ii++) {
      const u = world.units[fwd ? ii : n - 1 - ii];
      if (u.hp <= 0) continue;
      const def = C.UNITS[u.kind];
      /* SHADOW WILL NOT HOLD IT. A bound fiend serves its time and goes back to whatever it
       * came out of — see bindNear for why it cannot be allowed to stay. */
      if (u.bound && world.t >= u.bound) {
        u.hp = 0; u.dead = 1;
        emit(world, { e: 'unbind', pi: u.owner, x: u.x, y: u.y });
        continue;
      }
      u.cd -= dt;
      /* the banner moves the army — see musterAll, which set every goal before this loop */
      /* garrisons of an open city still see farther out */
      const home = u.owner !== C.CHAOS_ID && d2(u.x, u.y, cityOf(world, u.owner).x, cityOf(world, u.owner).y) < C.CITY.r * C.CITY.r;
      /* ON THE PARAPET. A man up against his own curtain fights from the top of it: he
       * throws over the stone, `over` far, and is seen and shot at in return. That is the
       * only way a wall kills anything, and the price of it is that the men who make it kill
       * are the men who can be killed. */
      const par = u.man ? manning(world, u) : null;
      /* WHICH WALL HE IS STANDING ON, for everyone downstream. The parapet was a rule with
       * nothing to see: a man on the wall fought from the wall and was drawn in the grass
       * beside it, so the one bargain the whole design rests on was invisible. The renderer
       * lifts him onto the stone from this, and it rides the wire so a guest sees it too. */
      /* ---------------- the Warden's art, and the Binding ----------------
       * Both run BEFORE the fight, and both run whether or not the man has a foe: a Warden who
       * stopped mending because something walked into his range would mend nobody in the only
       * place mending matters. Neither uses `u.cd` — that is his weapon's swing, and a Warden
       * who had to choose between shooting and mending would do neither well. */
      if (def.mend) mendNear(world, u, def, dt);
      if (def.bind && u.cd <= 0 && bindNear(world, u, def)) u.cd = def.atk;
      /* IN THE TOWER. The same bargain as the parapet, one storey higher: he throws further
       * than he ever could on the ground, and everything that can see the tower can see him. */
      const gar = u.in ? C.TOWER.over : 0;   // the long throw is the room's, not the errand's
      const foe = acquire(world, u, Math.max(def.aggro, par ? C.WALL.over : 0, gar) + (home ? C.CITY.homeAggro : 0));
      if (foe) {
        const rng = Math.max(par ? Math.max(def.range, C.WALL.over) : def.range, gar);
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
          const cx0 = u.x, cy0 = u.y;
          u.x += (foe.x - u.x) * mv; u.y += (foe.y - u.y) * mv;
          project(world, u, cx0, cy0);   // the chase is not slowed by the press, but it is projected like everything else
        }
        continue;
      }
      /* march: the flow field carries the column; within sight of the goal each soldier
       * peels off to his own place in the line, so an army arrives spread, not stacked */
      const gs = u.goal;
      if (gs) {
        let gx = gs.x, gy = gs.y;
        let muster = 0;   // >0 once the goal is a place in the body: how far the ground reaches
        /* A PARAPET IS A LINE, AND MEN ON IT SHOULD STAND ALONG IT. An order given at a wall
         * is one point, so every man sent to hold a curtain walked to the same stride of it
         * and the rest of the run stood empty — a hundred feet of stone defended by a scrum.
         * Each soldier takes his own STATION instead, exactly as he takes his own place in
         * the muster ring: a stable berth from his id, so the line is even and does not
         * jostle, and the whole run is manned rather than one yard of it. */
        /* A GARRISON GOES TO ITS TOWER and stays in it — the order put him there, and being
         * dragged back to the order's own point every tick would empty the tower he was sent
         * to fill. Checked before the parapet, because a tower built INTO a curtain would
         * otherwise post him to the run and leave the room above it empty. */
        if (u.tow) {
          const tb = towerOf(world, u);
          if (tb) {
            /* THE DOOR IS A PLACE, AND SHELTER STARTS AT IT — not at the order. Assignment
             * used to be the whole story: the tick the roster dealt a man a room he became
             * untouchable and invisible WHEREVER HE STOOD, so ten archers winked out of the
             * middle of a field and a badge lit on a tower they had never reached. Reported
             * from play as "show them entering". Assigned (`tow`) he is an ordinary marcher —
             * drawn, mortal, a target, walking to the tower like anyone walks anywhere — and
             * only crossing the threshold (`in`) trades the field for the room. The walk is
             * the show: men file toward the door and vanish one by one as the crown fills. */
            if (u.in === tb.id) continue;   // inside: he does not move, and nothing out here touches him
            const dc = Math.sqrt(d2(u.x, u.y, tb.x, tb.y));
            /* THE RIM IS THE DOOR. The first threshold was TOWER.ring + 8 — seventeen units in,
             * comfortably inside the BUILD.pass ring that `stand` defends — so the walk below
             * carried a man to the stone and `stand` set him back to twenty-six, thirty times a
             * second, and nobody ever entered: measured 0 of 12, every man parked at exactly
             * pass range. A man does not reach the middle of a tower before he is in it; he
             * reaches the wall of it, and the wall is where `stand`'s writ starts. One step
             * past the rim he steps THROUGH instead of off. */
            if (dc <= C.BUILD.pass + 4) { u.in = tb.id; continue; }
            const s5 = dc < C.NAV.arrive ? null : NAV.steer(world.nav, world, u.owner, tb.x, tb.y, u.x, u.y);
            const L3 = s5 ? 1 : dc;
            const vx3 = s5 ? s5.x : (tb.x - u.x) / L3, vy3 = s5 ? s5.y : (tb.y - u.y) / L3;
            const tx0 = u.x, ty0 = u.y;
            u.x += vx3 * def.speed * dt; u.y += vy3 * def.speed * dt;
            stand(world, u, tx0, ty0);
            continue;
          }
        }
        if (u.post) {
          const post = world.walls.find((q) => q.b.id === u.post);
          if (post) {
            const st2 = station(world, u, post);
            gx = st2.x; gy = st2.y;
            const dg = Math.sqrt(d2(u.x, u.y, gx, gy));
            /* the whole run is his ground once he is on it, or he would be dragged back to
             * the order's point every tick — the same handover the muster ring needs.
             *
             * ...UNLESS HIS PLACE IS ON THE OTHER SIDE OF IT. The shortcut walks a straight
             * line, and a straight line to the far face goes through the wall: the march put
             * him into the stone, the end-of-tick `stand` put him back out, and he spent the
             * match pressed against his own curtain a stride from where he was going. It is
             * what a heir sees the moment he turns a run about — the shooters cross and the
             * reserve does not — but it was there before the order existed, for any man whose
             * row happened to lie beyond the run. Crossing his own line means he wants the
             * GATEWAY, which is the nav layer's answer and not a beeline's.
             *
             * A MAN WITH A BERTH IS THE EXCEPTION, and it is the same exception `walled` makes:
             * he is not walking THROUGH the stone, he is climbing onto it. His place sits a
             * little to the sheltered side, so turning the run about moves it across the line —
             * send him round to the gateway for that and the parapet empties every time an heir
             * changes his mind. */
            if (dg < C.NAV.arrive && (u.man === post.b.id ||
                                      !crosses(u.x, u.y, gx, gy, post.ax, post.ay, post.bx, post.by))) {
              if (dg > 3) { u.x += (gx - u.x) / dg * def.speed * dt; u.y += (gy - u.y) / dg * def.speed * dt; }
              continue;   // a berth on a parapet is exact: he is not jostled off it
            }
            const s4 = NAV.steer(world.nav, world, u.owner, gx, gy, u.x, u.y);
            const L2 = s4 ? 1 : (Math.sqrt(d2(u.x, u.y, gx, gy)) || 1);
            const vx2 = s4 ? s4.x : (gx - u.x) / L2, vy2 = s4 ? s4.y : (gy - u.y) / L2;
            const wx0 = u.x, wy0 = u.y;
            const sp2 = def.speed * crush(u.press) * dt;   // a march to a wall queues like any other
            u.x += vx2 * sp2; u.y += vy2 * sp2;
            project(world, u, wx0, wy0);
            continue;
          }
        }
        /* HIS PLACE IN THE BODY — see bodyPlace and musterAll.
         * Troops ordered home muster in the COURT, not on the tower's own ground: the Seat
         * stands on that ground and an army standing with it simply vanishes under the castle,
         * which is what happened when the walls went and took the garrison's ring with them.
         * So at home the body opens out AROUND the tower's ground rather than starting at a
         * point, and it is the same rule everywhere else.
         * AND THE MUSTER SPREADS WITH THE ARMY. Four fixed rings held a hundred and thirty men
         * in the same ground twenty stood in, which is a single storm's disc over a quarter of
         * your force — reported from play, and measured at 31 dead in one cast. A body grows a
         * shell at a time as men join it, so a bigger army is a wider one for free. */
        {
          const cs = u.owner !== C.CHAOS_ID ? cityOf(world, u.owner) : null;
          const home = cs && d2(gs.x, gs.y, cs.x, cs.y) < C.CITY.seatR * C.CITY.seatR;
          /* THE BERTH IS THE ONE NUMBER A STORM CARES ABOUT, so it is worth writing down what it
           * buys. A body of n men at berth b is a disc of radius b·√(n/π), and a blast of radius
           * R takes about (R/b·√(n/π))² of it — which predicted every figure measured: the old
           * spiral's effective berth of 23.4 gave a 65% harvest on 64 men and a berth of 22
           * gives 73%. A body that stays a body through a war is the bigger change (the old one
           * dispersed as it fought: 44%). If the referee says the Jewel is too strong now, widen
           * this berth — nothing else in here needs to move. */
          const off = bodyPlace(u.rank || 0, home ? C.CITY.seatR + 24 : 0, C.CROWD.space);
          const pt = placeAt(world, home ? cs.x : gs.x, home ? cs.y : gs.y, off);
          gx = pt.x; gy = pt.y;
          /* THE WHOLE BODY IS MUSTER GROUND, not just the last few strides — and this is the
           * rule that actually drew the circle. The handover from the flow field to a man's own
           * place happened within `NAV.arrive` (72) of the ORDER, so a place further out than
           * that could not be reached at all: he steps outward toward it, crosses the arrival
           * circle, the field drags him back to the flag, repeat, thirty times a second. Every
           * man whose place lay past 72 therefore stood ON that circle, shoulder to shoulder
           * with everyone else in the same case — the C-shaped arc reported from play, measured
           * here at 32 men on a ring of radius 73 with a nearest-neighbour spacing of 15.
           * It was known and it was fixed for the Seat alone, where the ring was wide enough
           * that somebody noticed ("the shivering ranks under the tower"); in the field a
           * company only had to grow past thirty men to hit it. Reach past his own place and the
           * handover happens once, wherever the flag is. */
          muster = off.r + C.NAV.arrive;
        }
        const dgoal = Math.sqrt(d2(u.x, u.y, gx, gy));
        /* the flow field is drawn to the ORDER's point; a soldier's own place in the line is
         * somewhere near it. Once he is on the muster ground, walk to his place directly —
         * the field cannot carry him there, and at the Seat it would even hold him in the
         * middle, since by the field's reckoning he has already arrived. */
        const dField = Math.sqrt(d2(u.x, u.y, gs.x, gs.y));
        let vx = 0, vy = 0, inColumn = false;
        if (dgoal < C.NAV.arrive || dField < C.NAV.arrive || (muster && dField < muster)) {
          /* HE HAS ARRIVED WHEN HE IS STANDING WITH HIS FELLOWS, not when he is on a point.
           * The stop was four units, which is inside the room a man now keeps: separation
           * shoved him off his place and he walked back onto it, thirty times a second, and
           * a settled army shimmered. Anything within a berth of his place IS his place. */
          /* IN HIS PLACE, AND HE STAYS IN IT. A bare threshold flickers: a neighbour nudges him
           * a foot past it, he sets off again, arrives, is nudged again — eighteen reversals
           * in two seconds. Hysteresis. He arrives inside three quarters of a berth and does
           * not set off again until something has moved him half a berth further than that. */
          if (u.set && dgoal > C.CROWD.space * 1.5) u.set = 0;
          if (!u.set && dgoal > C.CROWD.space * 0.75) { vx = (gx - u.x) / dgoal; vy = (gy - u.y) / dgoal; }
          else u.set = 1;
        } else {
          inColumn = true;
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
        /* ANTICIPATE. The course is chosen to clear the stone BEFORE he reaches it, which is
         * what stops him wedging on it — see steerClear. Only on the march: a man on the chase
         * is closing on something he means to hit. */
        const clear = steerClear(world, u, vx, vy, Math.sqrt(d2(u.x, u.y, gx, gy)), gx, gy);
        if (clear) { vx = clear.x; vy = clear.y; }
        const mx0 = u.x, my0 = u.y;
        /* THE CRUSH: last tick's press drags at this tick's stride — see CROWD.crush. The
         * COLUMN only: a man riding the field in a press is a man in a queue, and the queue
         * pours. A man already on the muster ground stepping into his place is NOT crushed —
         * his stride is the formation settling, and dragging it left the whole body milling
         * below the crowd's own noise: the shiver detector read 33 of 63 men reversing, and
         * the ranks never closed in time when men fell. The chase above is exempt the same
         * way — a man closing on something he means to kill shoulders through. */
        const sp = def.speed * (inColumn ? crush(u.press) : 1) * dt;
        /* THE BANK TURNS THE STEP BEFORE THE GROUND REFUSES IT. `steerClear`'s own lesson:
         * a position projection alone is repulsion-after-contact, and with a place across a
         * water inlet the beeline steps in and the resolver steps out along the same line,
         * thirty times a second — measured as a man moving 7.75 in a tick that should have
         * been 1.77, and a settled body's drift riding just under its ceiling. One sample
         * ahead: if the stride lands below the shore clearance, drop the component that
         * points into the water and keep the one along the bank. The resolver stays, as the
         * safety net it should be. */
        const ax2 = u.x + vx * sp, ay2 = u.y + vy * sp;
        const ahead = NAV.ground(world.nav, ax2, ay2);
        const aCell = NAV.cellOf(world.nav, ax2, ay2);
        /* the CELL is asked as well as the field: the bilinear reads a bad cell's corner as
         * standable room (three good samples outvote one bad), so a beeline through a water
         * inlet's corner sailed past this guard, entered the cell, and the resolver's binary
         * law threw him back out — a 9.5-unit tick where his stride is 1.77 */
        if (ahead.d < C.NAV.shore || aCell < 0 || world.nav.cost[aCell] === 0) {
          const gl = Math.sqrt(ahead.gx * ahead.gx + ahead.gy * ahead.gy) || 1;
          const nnx = ahead.gx / gl, nny = ahead.gy / gl;
          const into = vx * nnx + vy * nny;
          if (into < 0) { vx -= into * nnx; vy -= into * nny; }
        }
        u.x += vx * sp; u.y += vy * sp;
        project(world, u, mx0, my0);
      }
    }

    /* AND THEN THEY MAKE ROOM FOR EACH OTHER. Once, after everyone has moved, so the pass is
     * symmetric — a man does not give way to a neighbour who has not taken his step yet. Then
     * the resolver runs over EVERYONE, mover or not — the crowd can push a man onto a hall's
     * rim or toward the water, and a settled man nudged into stone by a neighbour used to
     * stay there until his next march because only movers were re-projected. The tick is
     * predict-then-project all the way down: the march, the chase and the crowd PROPOSE,
     * `project` disposes, and it always has the last word of the tick. */
    jostle(world);
    for (const u of world.units) {
      /* a man holding a place on stone is not shoved off it — his station IS his position,
       * and a tower's garrison stands inside the ring `stand` would push him out of */
      if (u.hp <= 0 || u.man || u.in) continue;
      project(world, u, u._px, u._py);
    }

    /* bury the dead */
    let fellChampion = -1;
    for (let i = world.units.length - 1; i >= 0; i--) {
      if (world.units[i].hp <= 0) {
        const u = world.units[i];
        if (u.kind === 'champion') {
          const pl = world.players[u.owner];
          if (pl && pl.championId === u.id) pl.championId = 0;
          if (pl) fellChampion = u.owner;
        }
        world.units.splice(i, 1);
      }
    }
    /* AND HIS CARD GOES WITH HIM — after the burial, not during it. Companies are pruned
     * when a HALL is razed or moved, which never happens to the Trump's, since no hall
     * musters into it: a fallen Champion left a chip in the tray that pointed at nobody and
     * could still be planted. He is the only unit whose company hangs on him alone. Pruning
     * before the splice finds him still standing in world.units and keeps the card. */
    if (fellChampion >= 0) pruneCos(world, fellChampion);
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
    /* HIS MEN FALL WITH HIM — but they are BURIED, not spliced out from under the loop that
     * is running. topple() is reached from inside the per-unit pass, which walks a length it
     * captured before the tick began; removing units here left that walk reading past the end
     * of the array. Nothing caught it while a toppled heir had no men to remove, which was
     * true right up until every heir started the match with a hall. Marking them dead hands
     * them to the burial pass at the end of the tick, which is what it is for. */
    for (const u of world.units) if (u.owner === pi) { u.hp = 0; u.dead = 1; }
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
                   visionSources, workSeen, ghostsFor, walkers, placementError, inClaim, nodeAt, nodeHolder, bldOf, crosses,
                   newSeenMask, markSeen, hurtBuilding, masons, rising, wallError, wallEnds,
                   wallCrews, wallReach, branchesOf, forkAt, branchOf, mustersOf, foldOrder, crush,
                   /* the fog's working parts, exported for the tests, the probes and the
                    * GUEST: refresh on demand, re-bake after painting terrain, the shot's
                    * rock test — and the two a guest needs to cast its own occluded veil
                    * against its reference world (same seed, so the same sight bake):
                    * visMask(refWorld, seat, World.visionSources(snapshotAsWorld, seat))
                    * returns the {g,gw,gh,cell} mask; bakeWallSight(refWorld) re-stamps
                    * refWorld.walls ([{ax,ay,bx,by}] — build it from the snapshot's visible
                    * runs via wallEnds) into the bake first, since a guest knows only the
                    * stone it can see. */
                   refreshVision, bakeSight, rockBetween, visMask, bakeWallSight };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.World;
})(typeof window !== 'undefined' ? window : globalThis);

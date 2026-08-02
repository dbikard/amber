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
      nav: null, navVersion: 0,   // movement grid; the version counts changes to what blocks
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
  /* the single answer the sim, the UI and the AI all ask. Returns null if legal. */
  function placementError(world, pi, x, y, bt) {
    const def = C.BUILDINGS[bt];
    if (!def) return 'type';
    const pl = world.players[pi];
    if (def.unique && pl.buildings.some((b) => b.bt === bt)) return 'unique';
    if (!groundBears(world, x, y)) return 'ground';
    if (!clearOfWorks(world, x, y)) return 'crowded';
    /* The masons are the last word, not the first: what is wrong with the GROUND is worth
     * knowing while you wait, and a card that can never be built here should say so rather
     * than blame the masons. */
    const busy = pl.buildings.some((b) => b.raise > 0) ? 'busy' : null;
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
    for (const b of world.players[pi].buildings)
      if (!b.raise) src.push([b.x, b.y, C.BUILDINGS[b.bt].vision || C.VISION.build]);
    for (const u of world.units)
      if (u.owner === pi) src.push([u.x, u.y, C.VISION.unit]);
    return src;
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
        if (o === pi) { pl.ghosts[b.id] = { bt: b.bt, level: b.level, x: b.x, y: b.y, owner: o }; continue; }
        if (seen(src, b.x, b.y)) pl.ghosts[b.id] = { bt: b.bt, level: b.level, x: b.x, y: b.y, owner: o };
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

    if (cmd.c === 'build') {
      const def = C.BUILDINGS[cmd.bt];
      const x = +cmd.x, y = +cmd.y;
      if (!def || !isFinite(x) || !isFinite(y)) return { ok: false, err: 'type' };
      const bad = placementError(world, pi, x, y, cmd.bt);
      if (bad) return { ok: false, err: bad };
      if (pl.essence < def.cost) return { ok: false, err: 'essence' };
      pl.essence -= def.cost;
      const site = def.claim ? nodeAt(world, x, y) : null;
      /* it goes up as a SHELL: paid for, standing, breakable — and good for nothing until
       * the masons are done with it */
      const b = { id: world.nextId++, bt: cmd.bt, level: 1, x, y,
                  cd: def.period ? def.period[0] * 0.5 : (def.atk || 0),
                  raise: def.raise || 0, raiseFor: def.raise || 0,
                  hp: def.hp * C.RAISE.hpFrom, maxHp: def.hp, lastHurt: -99,
                  node: site && nodeHolder(world, site) === -1 ? site.id : -1,
                  co: 0 };         // 0 = its muster marches under the royal War Banner
      if (!b.raise) b.hp = def.hp;
      if (def.spawns) b.co = joinCo(world, pi, cmd.co);
      pl.buildings.push(b);
      emit(world, { e: 'build', pi, id: b.id, bt: cmd.bt, x, y, co: b.co });
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
      const cost = upgradeCost(s.bt, s.level, br);
      if (pl.essence < cost) return { ok: false, err: 'essence' };
      pl.essence -= cost;
      s.level++;
      if (br) s.br = br;
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
  function spawnUnit(world, owner, kind, atX, atY, goal, co, from) {
    /* per-owner, so a full army can never starve the muster of Chaos or of the other side */
    let mine = 0;
    for (const u of world.units) if (u.owner === owner) mine++;
    if (mine >= (owner === C.CHAOS_ID ? C.CAP.chaos : C.CAP.player)) return 0;
    const def = C.UNITS[kind];
    const scale = owner === C.CHAOS_ID ? C.CHAOS.hpScale(world.t) : 1;
    const home = owner === C.CHAOS_ID ? null : cityOf(world, owner);
    const u = {
      id: world.nextId++, owner, kind,
      x: (atX != null ? atX : home.x) + world.rng.range(-26, 26),
      y: (atY != null ? atY : home.y + (owner === 0 ? -60 : 60)) + world.rng.range(-16, 16),
      ox: world.rng.range(-24, 24), oy: world.rng.range(-24, 24),   // personal formation offset
      hp: def.hp * scale, maxHp: def.hp * scale,
      dmg: def.dmg * (owner === C.CHAOS_ID ? C.CHAOS.dmgScale(world.t) : 1),
      cd: 0,
      goal: goal != null ? goal : (owner === C.CHAOS_ID ? aimAt(world, { site: world.map.cities[world.chaosParity++ % world.players.length] }) : world.players[owner].banner),
      co: co != null ? co : 0,   // the COMPANY it musters into; 0 = under the royal War Banner
      from: from != null ? from : -1   // the hall that raised it, so re-assigning one moves its men
    };
    world.units.push(u);
    return u.id;
  }

  function hurt(world, victim, dmg, byOwner) {
    victim.hp -= dmg;
    if (victim.hp <= 0 && !victim.dead) {
      victim.dead = true;
      if (byOwner === 0 || byOwner === 1) world.players[byOwner].essence += C.UNITS[victim.kind].bounty;
      emit(world, { e: 'die', x: victim.x, y: victim.y, kind: victim.kind, owner: victim.owner });
    }
  }
  /* nearest hostile target within radius: units, any standing work, and the Seat-tower at
   * a city. Works are just places now, so a barracks out on the map is besieged exactly
   * like one in the court. */
  function acquire(world, u, radius) {
    /* a fallen heir has nothing left to attack — and their Seat is a ruin, not a target */
    let best = null, bestD = radius, kind = null, bx = 0, by = 0;
    const consider = (d, t2, k, x, y) => { if (d < bestD) { bestD = d; best = t2; kind = k; bx = x; by = y; } };
    for (const v of world.units) {
      if (v.hp <= 0 || v.owner === u.owner) continue;
      consider(Math.sqrt(d2(u.x, u.y, v.x, v.y)), v, 'unit', v.x, v.y);
    }
    for (let ci = 0; ci < world.players.length; ci++) {
      if (ci === u.owner) continue;
      const tp = world.players[ci];
      if (tp.out) continue;
      const cs = world.map.sites[world.map.cities[ci]];
      const dc = Math.sqrt(d2(u.x, u.y, cs.x, cs.y));
      for (const b of tp.buildings)
        consider(Math.sqrt(d2(u.x, u.y, b.x, b.y)), { pi: ci, id: b.id }, 'work', b.x, b.y);
      if (dc > C.CITY.r + radius) continue;
      consider(dc, { pi: ci }, 'tower', cs.x, cs.y);
    }
    return best ? { t: best, kind, d: bestD, x: bx, y: by } : null;
  }

  function hurtBuilding(world, pi, id, dmg) {
    const pl = world.players[pi], i = pl.buildings.findIndex((b2) => b2.id === id);
    if (i < 0) return;
    const b = pl.buildings[i];
    b.hp -= dmg; b.lastHurt = world.t;
    if (b.hp <= 0) {
      emit(world, { e: 'raze', pi, id: b.id, bt: b.bt, x: b.x, y: b.y });
      pl.buildings.splice(i, 1);
      if (b.bt === 'shrine') pl.walking = false;
      if (C.BUILDINGS[b.bt].spawns) pruneCos(world, pi);
      /* a fallen mustering hall is a fallen standard: its company rallies to the banner */
      for (const q of world.players) delete q.ghosts[b.id];
    } else if (world.t - (pl.slotAlert || -99) > 12) {
      pl.slotAlert = world.t;
      emit(world, { e: 'hurtcity', pi, x: b.x, y: b.y });
    }
  }

  /* ---------------- update ---------------- */
  function update(world, dt) {
    if (world.winner !== null) return;
    world.t += dt; world.tick++;
    const t = world.t;
    if (world.tick % 6 === 0 || !world.vis) refreshVision(world);   // 5 Hz vision refresh

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
          if (b.raise <= 0) emit(world, { e: 'raised', pi, id: b.id, bt: b.bt, x: b.x, y: b.y });
          continue;
        }
        if (b.hp < b.maxHp && t - b.lastHurt > 10) b.hp = Math.min(b.maxHp, b.hp + C.STRUCT_REGEN * dt);
        /* a Gate on a spring of Shadow draws far more than one that merely stands about */
        if (b.bt === 'gate') income += b.node >= 0 ? def.nodeIncome[b.level - 1] : 0;
        else if (def.spawns) {
          if (pl.musterPaused) { b.cd = Math.max(b.cd, 0.5); continue; }
          const price = C.UNITS[def.spawns].cost;
          const per = def.period[b.level - 1];
          b.paid = b.paid || 0;
          /* recruits are paid for CONTINUOUSLY: the treasury drains smoothly, and a poor
           * treasury slows the muster instead of silently skipping it */
          const pay = Math.min((price / per) * dt, Math.max(0, price - b.paid), pl.essence);
          if (pay > 0) { pl.essence -= pay; b.paid += pay; drain += pay / dt; }
          b.cd -= dt;
          if (b.cd <= 0) {
            if (b.paid >= price - 1e-6) {
              b.paid -= price;
              spawnUnit(world, pi, def.spawns, sp.x, sp.y, undefined, b.co, b.id);
              b.cd += per;
            } else b.cd = 0;   // timer ready; the recruit marches the moment he's paid
          }
        } else if (b.bt === 'tower') {
          b.cd -= dt;
          if (b.cd <= 0) {
            const st = towerStats(b);
            let best = null, bd = st.range * st.range;
            for (const u of world.units) {
              if (u.hp <= 0 || u.owner === pi) continue;
              const dd = d2(u.x, u.y, sp.x, sp.y);   // a tower guards ITS OWN ground
              if (dd < bd) { bd = dd; best = u; }
            }
            if (best) {
              hurt(world, best, st.dmg, pi);
              /* the cannon answers the column, not the man: the burst falls off away
               * from the ball, so a crowd bleeds but no single foe dies to the splash */
              if (st.splash > 0 && st.splashDmg > 0) {
                const r2 = st.splash * st.splash;
                for (const u of world.units) {
                  if (u.hp <= 0 || u.owner === pi || u === best) continue;
                  if (d2(u.x, u.y, best.x, best.y) < r2) hurt(world, u, st.splashDmg, pi);
                }
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

      if (pl.walking) {
        const shrine = pl.buildings.find((b) => b.bt === 'shrine');
        if (!shrine) pl.walking = false;
        else {
          const def = C.BUILDINGS.shrine;
          const want = def.drain[shrine.level - 1] * dt;
          /* pay what you can and walk that far. All-or-nothing froze a poor walker at 1%
           * forever — income 4/s against a drain of 12/s meant the Pattern, the game's
           * absolute clock, simply stopped ticking. */
          const pay = Math.min(want, pl.essence);
          if (pay > 0) {
            pl.essence -= pay;
            pl.drainRate += pay / dt;   // actual, not theoretical
            pl.pattern += def.rate[shrine.level - 1] * dt * (pay / want);
            while (pl.alertIdx < C.PATTERN_ALERTS.length && pl.pattern >= C.PATTERN_ALERTS[pl.alertIdx].at) {
              emit(world, { e: 'pattern', pi, idx: pl.alertIdx }); pl.alertIdx++;
            }
            if (pl.pattern >= 100) { win(world, pi, 'pattern'); return; }
          }
        }
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
      const foe = acquire(world, u, def.aggro + (home ? 140 : 0));
      if (foe) {
        const reach = def.range + (foe.kind === 'unit' ? C.UNITS[foe.t.kind].size
          : foe.kind === 'tower' ? 36 : C.BUILD.foot - 8);
        if (foe.d <= reach) {
          if (u.cd <= 0) {
            if (foe.kind === 'unit') hurt(world, foe.t, u.dmg, u.owner);
            else if (foe.kind === 'work') hurtBuilding(world, foe.t.pi, foe.t.id, u.dmg);
            else if (foe.kind === 'tower') {
              const tp = world.players[foe.t.pi];
              tp.castleHp -= u.dmg;
              emit(world, { e: 'siege', pi: foe.t.pi, x: u.x, y: u.y });
              if (tp.castleHp <= 0 && !tp.out) { if (topple(world, foe.t.pi, u.owner)) return; }
            }
            u.cd = def.atk;
            if (def.range > 40) emit(world, { e: 'bolt', from: { x: u.x, y: u.y, owner: u.owner }, to: { x: foe.x, y: foe.y } });
          }
        } else {
          const mv = def.speed * dt / (foe.d || 1);
          u.x += (foe.x - u.x) * mv; u.y += (foe.y - u.y) * mv;
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
        if (u.owner !== C.CHAOS_ID) {
          const cs = cityOf(world, u.owner);
          if (d2(gs.x, gs.y, cs.x, cs.y) < C.CITY.seatR * C.CITY.seatR) {
            const ang = (u.id * 2.39996) % (Math.PI * 2);          // golden angle: no clumps
            const rr = C.CITY.seatR + 24 + (u.id % 4) * 17;
            gx = cs.x + Math.cos(ang) * rr; gy = cs.y + Math.sin(ang) * rr;
          }
        }
        const dgoal = Math.sqrt(d2(u.x, u.y, gx, gy));
        /* the flow field is drawn to the ORDER's point; a soldier's own place in the line is
         * somewhere near it. Once he is on the muster ground, walk to his place directly —
         * the field cannot carry him there, and at the Seat it would even hold him in the
         * middle, since by the field's reckoning he has already arrived. */
        const dField = Math.sqrt(d2(u.x, u.y, gs.x, gs.y));
        let vx = 0, vy = 0;
        if (dgoal < C.NAV.arrive || dField < C.NAV.arrive) {
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
    pl.buildings.length = 0;
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
                   visionSources, placementError, inClaim, nodeAt, nodeHolder, bldOf,
                   newSeenMask, markSeen };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.World;
})(typeof window !== 'undefined' ? window : globalThis);

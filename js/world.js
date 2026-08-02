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
  function buildMap(seed) {
    const gen = WG.build(seed, RNG);
    if (!gen) return null;
    for (const s of gen.sites) { s.lastHurt = -99; }
    return { sites: gen.sites, cities: gen.cities, nodes: gen.nodes,
             gen, skew: gen.skew, apart: gen.apart };
  }

  function createWorld(seed) {
    const rng = RNG.make(seed >>> 0);
    const map = buildMap(seed >>> 0);
    const world = {
      seed: seed >>> 0, rng,
      t: 0, tick: 0,
      winner: null, winReason: null,
      map,
      players: [0, 1].map(() => ({
        essence: C.START_ESSENCE,
        castleHp: C.CASTLE_HP, wallHp: 0, wallLevel: 0, wallHurt: -99, wallAlert: -99,
        pattern: 0, walking: false, revealed: false, alertIdx: 0,
        buildings: [],          // free placement: every work knows where it stands
        powers: { storm: 0, trump: 0 },
        championId: 0,
        banner: -1,             // site id the army marches on; -1 = defend home
        musterPaused: false,    // the Seat can halt the muster to hoard essence
        explored: {},           // siteId -> last-known {kind, owner}
        ghosts: {}              // buildingId -> last-seen {bt, level, x, y, owner} (fog memory)
      })),
      units: [], storms: [], events: [],
      nav: null, navVersion: 0,   // movement grid; the version counts changes to what blocks
      nextId: 1,
      chaosNext: C.CHAOS.firstAt, chaosParity: 0, surged: false,
      vis: null                 // per-tick vision cache: [ [sources for p0], [for p1] ]
    };
    world.nav = NAV.build(world.map.gen);
    for (let pi = 0; pi < 2; pi++) {
      world.players[pi].banner = world.map.cities[pi];
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
    for (let pi = 0; pi < 2; pi++)
      for (const b of world.players[pi].buildings)
        if (b.bt === 'gate' && b.node === site.id) return pi;
    return -1;
  }

  /* ---------------- where a work may stand ----------------
   * Your writ runs from the Seat and from every Shadow Gate you hold. Inside it, on ground
   * that will bear a building, clear of other works — that is the whole rule. A Gate is the
   * exception: it may be raised at an unheld essence node you have troops standing on and
   * the enemy does not, which is how a claim grows in the first place. */
  function inClaim(world, pi, x, y) {
    const c = cityOf(world, pi);
    if (d2(x, y, c.x, c.y) < C.CLAIM.seat * C.CLAIM.seat) return true;
    for (const b of world.players[pi].buildings)
      if (C.BUILDINGS[b.bt].claim && d2(x, y, b.x, b.y) < C.CLAIM.gate * C.CLAIM.gate) return true;
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
    for (let pi = 0; pi < 2; pi++)
      for (const b of world.players[pi].buildings)
        if (d2(x, y, b.x, b.y) < need * need) return false;
    for (let pi = 0; pi < 2; pi++) {   // and never inside the Seat itself
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
    if (pl.buildings.length >= C.MAX_BUILDINGS) return 'full';
    if (def.unique && pl.buildings.some((b) => b.bt === bt)) return 'unique';
    if (!groundBears(world, x, y)) return 'ground';
    if (!clearOfWorks(world, x, y)) return 'crowded';
    if (inClaim(world, pi, x, y)) return null;
    /* outside the writ: only a Gate, only at a free node, only where your troops stand */
    if (!def.claim) return 'claim';
    const site = nodeAt(world, x, y);
    if (!site) return 'claim';
    if (nodeHolder(world, site) !== -1) return 'taken';
    if (!world.units.some((u) => u.owner === pi && d2(u.x, u.y, site.x, site.y) < 90 * 90)) return 'presence';
    if (world.units.some((u) => u.owner !== pi && u.owner !== 2 && d2(u.x, u.y, site.x, site.y) < 90 * 90)) return 'contested';
    return null;
  }

  /* ---------------- vision & exploration ---------------- */
  function visionSources(world, pi) {
    const src = [];
    const city = cityOf(world, pi);
    src.push([city.x, city.y, C.VISION.city]);
    for (const b of world.players[pi].buildings)
      src.push([b.x, b.y, C.BUILDINGS[b.bt].vision || C.VISION.build]);
    for (const u of world.units)
      if (u.owner === pi) src.push([u.x, u.y, C.VISION.unit]);
    return src;
  }
  function seen(src, x, y) {
    for (let i = 0; i < src.length; i++) {
      const s = src[i];
      if (d2(x, y, s[0], s[1]) < s[2] * s[2]) return true;
    }
    return false;
  }
  function refreshVision(world) {
    world.vis = [visionSources(world, 0), visionSources(world, 1)];
    for (let pi = 0; pi < 2; pi++) exploreAround(world, pi);
  }
  function exploreAround(world, pi) {
    const src = world.vis ? world.vis[pi] : visionSources(world, pi);
    const pl = world.players[pi];
    /* A Seat is a site like any other: you know it is there once you have SEEN it, and not
     * before. Finding the rival's is the whole early game now. */
    for (const s of world.map.sites)
      if (seen(src, s.x, s.y)) pl.explored[s.id] = { kind: s.kind, name: s.name };
    /* the new fog rule: a rival's work is visible only while you can SEE it, and remembered
     * as a ghost — last seen, where it stood — once you cannot. No more veiled-slot bookkeeping. */
    for (let o = 0; o < 2; o++) {
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
  /* the flow field said "no way through": find the wall that is in the way */
  function nearestBlocker(world, u) {
    let target = null, bd = Infinity;
    for (let pi = 0; pi < 2; pi++) {
      if (pi === u.owner) continue;
      for (const b of world.players[pi].buildings) {
        if (b.bt !== 'rampart') continue;
        const dd = d2(u.x, u.y, b.x, b.y);
        if (dd < bd) { bd = dd; target = b; }
      }
    }
    return target;
  }

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
    return C.BUILDINGS[bt].up[level - 1];
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
      const b = { id: world.nextId++, bt: cmd.bt, level: 1, x, y,
                  cd: def.period ? def.period[0] * 0.5 : (def.atk || 0),
                  hp: def.hp, maxHp: def.hp, lastHurt: -99,
                  node: site && nodeHolder(world, site) === -1 ? site.id : -1,
                  rally: -1 };   // -1 = the company follows the royal War Banner
      pl.buildings.push(b);
      if (cmd.bt === 'rampart') world.navVersion++;   // the ways through Shadow have changed
      emit(world, { e: 'build', pi, id: b.id, bt: cmd.bt, x, y });
      return { ok: true };
    }
    if (cmd.c === 'wall') {
      if (pl.wallLevel >= C.MAX_LEVEL) return { ok: false, err: 'max' };
      const cost = pl.wallLevel === 0 ? C.WALL.cost : C.WALL.up[pl.wallLevel - 1];
      if (pl.essence < cost) return { ok: false, err: 'essence' };
      pl.essence -= cost;
      pl.wallLevel++;
      pl.wallHp = C.WALL.hp[pl.wallLevel - 1];
      emit(world, { e: 'wallup', pi, level: pl.wallLevel });
      return { ok: true };
    }
    if (cmd.c === 'up') {
      const s = bldOf(world, pi, cmd.id);
      if (!s) return { ok: false, err: 'id' };
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
      if (s.bt === 'rampart') {
        s.maxHp = C.BUILDINGS.rampart.hpUp[s.level - 2];
        s.hp = s.maxHp;
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
      /* company orders: a mustering building's troops hold their own front */
      const b = bldOf(world, pi, cmd.id);
      if (!b || !C.BUILDINGS[b.bt].spawns) return { ok: false, err: 'id' };
      if (cmd.site >= 0 && !world.map.sites[cmd.site]) return { ok: false, err: 'site' };
      b.rally = cmd.site;
      emit(world, { e: 'rally', pi, id: b.id, site: cmd.site });
      return { ok: true };
    }
    if (cmd.c === 'banner') {
      const site = world.map.sites[cmd.site];
      if (!site) return { ok: false, err: 'site' };
      pl.banner = site.id;
      emit(world, { e: 'banner', pi, site: site.id });
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

  /* ---------------- units ---------------- */
  function spawnUnit(world, owner, kind, atX, atY, goal, co) {
    /* per-owner, so a full army can never starve the muster of Chaos or of the other side */
    let mine = 0;
    for (const u of world.units) if (u.owner === owner) mine++;
    if (mine >= (owner === 2 ? C.CAP.chaos : C.CAP.player)) return 0;
    const def = C.UNITS[kind];
    const scale = owner === 2 ? C.CHAOS.hpScale(world.t) : 1;
    const home = owner === 2 ? null : cityOf(world, owner);
    const u = {
      id: world.nextId++, owner, kind,
      x: (atX != null ? atX : home.x) + world.rng.range(-26, 26),
      y: (atY != null ? atY : home.y + (owner === 0 ? -60 : 60)) + world.rng.range(-16, 16),
      ox: world.rng.range(-24, 24), oy: world.rng.range(-24, 24),   // personal formation offset
      hp: def.hp * scale, maxHp: def.hp * scale,
      dmg: def.dmg * (owner === 2 ? C.CHAOS.dmgScale(world.t) : 1),
      cd: 0,
      goal: goal != null ? goal : (owner === 2 ? world.map.cities[world.chaosParity++ % 2] : world.players[owner].banner),
      co: co != null ? co : -1   // company = its mustering hall's id; -1 follows the royal banner
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
  /* nearest hostile target within radius: units, any standing work, and — at a city —
   * the wall (from outside), or the Seat-tower (once inside). Works are just places now,
   * so a barracks out on the map is besieged exactly like one in the court. */
  function acquire(world, u, radius) {
    let best = null, bestD = radius, kind = null, bx = 0, by = 0;
    const consider = (d, t2, k, x, y) => { if (d < bestD) { bestD = d; best = t2; kind = k; bx = x; by = y; } };
    for (const v of world.units) {
      if (v.hp <= 0 || v.owner === u.owner) continue;
      consider(Math.sqrt(d2(u.x, u.y, v.x, v.y)), v, 'unit', v.x, v.y);
    }
    for (let ci = 0; ci < 2; ci++) {
      if (ci === u.owner) continue;
      const tp = world.players[ci];
      const cs = world.map.sites[world.map.cities[ci]];
      const dc = Math.sqrt(d2(u.x, u.y, cs.x, cs.y));
      const walled = tp.wallHp > 0;
      for (const b of tp.buildings) {
        /* a work sheltering inside a standing wall cannot be reached from outside */
        if (walled && d2(b.x, b.y, cs.x, cs.y) < C.CITY.r * C.CITY.r) continue;
        consider(Math.sqrt(d2(u.x, u.y, b.x, b.y)), { pi: ci, id: b.id }, 'work', b.x, b.y);
      }
      if (dc > C.CITY.r + radius) continue;
      if (walled) {
        /* the wall bars the way — batter it where you stand */
        const k2 = C.CITY.r / (dc || 1);
        consider(Math.max(0, dc - C.CITY.r), { pi: ci }, 'wall', cs.x + (u.x - cs.x) * k2, cs.y + (u.y - cs.y) * k2);
      } else {
        consider(dc, { pi: ci }, 'tower', cs.x, cs.y);
      }
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
      if (b.bt === 'rampart') world.navVersion++;   // the road is open again
      /* a fallen mustering hall is a fallen standard: its company rallies to the banner */
      delete world.players[0].ghosts[b.id]; delete world.players[1].ghosts[b.id];
    } else if (world.t - (pl.slotAlert || -99) > 12) {
      pl.slotAlert = world.t;
      emit(world, { e: 'hurtcity', pi, x: b.x, y: b.y });
    }
  }
  function hurtWall(world, pi, dmg) {
    const pl = world.players[pi];
    pl.wallHp -= dmg; pl.wallHurt = world.t;
    if (pl.wallHp <= 0) { pl.wallHp = 0; emit(world, { e: 'breach', pi }); }
    else if (world.t - pl.wallAlert > 12) { pl.wallAlert = world.t; emit(world, { e: 'hurtwall', pi }); }
  }
  /* no hostile sets foot inside a walled city */
  function clampWalls(world, u) {
    for (let ci = 0; ci < 2; ci++) {
      if (ci === u.owner || world.players[ci].wallHp <= 0) continue;
      const cs = world.map.sites[world.map.cities[ci]];
      const dd = Math.sqrt(d2(u.x, u.y, cs.x, cs.y));
      if (dd < C.CITY.r + 3) {
        const k2 = (C.CITY.r + 3) / (dd || 1);
        u.x = cs.x + (u.x - cs.x) * k2; u.y = cs.y + (u.y - cs.y) * k2;
      }
    }
  }

  /* ---------------- update ---------------- */
  function update(world, dt) {
    if (world.winner !== null) return;
    world.t += dt; world.tick++;
    const t = world.t;
    if (world.tick % 6 === 0 || !world.vis) refreshVision(world);   // 5 Hz vision refresh

    /* players: income, city buildings, powers, walls, the walk.
     * Alternate which seat is served first — otherwise player 0's towers always shoot
     * before player 1's within a tick, and player 0 wins every simultaneous finish. The
     * unit loop below has always done this; the player loop should too. */
    const pFwd = world.tick % 2 === 0;
    for (let k = 0; k < 2; k++) {
      const pi = pFwd ? k : 1 - k;
      const pl = world.players[pi];
      const city = cityOf(world, pi);
      let income = C.BASE_INCOME;
      let drain = 0;   // ACTUAL spend rate this tick — the HUD never lies again
      for (const b of pl.buildings) {
        const def = C.BUILDINGS[b.bt];
        const sp = b;
        if (b.hp < b.maxHp && t - b.lastHurt > 10) b.hp = Math.min(b.maxHp, b.hp + C.STRUCT_REGEN * dt);
        /* a Gate on a spring of Shadow draws far more than one that merely stands about */
        if (b.bt === 'gate') income += (b.node >= 0 ? def.nodeIncome : def.income)[b.level - 1];
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
              spawnUnit(world, pi, def.spawns, sp.x, sp.y, undefined, b.id);
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
      pl.essence += income * dt;
      pl.incomeRate = income;
      pl.drainRate = drain;   // muster + walk upkeep — the HUD tells the truth
      if (pl.powers.storm > 0) pl.powers.storm -= dt;
      if (pl.powers.trump > 0) pl.powers.trump -= dt;

      /* walls self-mend when unbothered */
      if (pl.wallLevel > 0 && pl.wallHp > 0 && t - pl.wallHurt > 10)
        pl.wallHp = Math.min(C.WALL.hp[pl.wallLevel - 1], pl.wallHp + C.STRUCT_REGEN * dt);

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
      for (let i = 0; i < n; i++) spawnUnit(world, 2, 'fiend', at.x, at.y);
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
      if (u.owner !== 2) {
        const pl2 = world.players[u.owner];
        const cb = u.co >= 0 ? bldOf(world, u.owner, u.co) : null;   // its mustering hall, if it still stands
        const want = cb && cb.rally != null && cb.rally >= 0 ? cb.rally : pl2.banner;
        if (u.goal !== want) u.goal = want;
      }
      /* garrison duty: flag home + walls standing → man the ramparts. Take a post on the
       * ring, mass toward the threatened arc, hurl from the parapet — and NEVER step
       * outside. Sortying is a choice the player makes by moving the flag. */
      if (u.owner !== 2) {
        const plG = world.players[u.owner];
        if (plG.wallHp > 0 && u.goal === world.map.cities[u.owner]) {
          const cs = cityOf(world, u.owner);
          const foe = acquire(world, u, def.aggro + 160);
          if (foe && u.cd <= 0 && foe.kind === 'unit' &&
              foe.d <= Math.max(def.range, 85) + C.UNITS[foe.t.kind].size) {
            hurt(world, foe.t, u.dmg, u.owner);
            u.cd = def.atk;
            emit(world, { e: 'bolt', from: { x: u.x, y: u.y, owner: u.owner }, to: { x: foe.x, y: foe.y } });
          }
          const ang = foe ? Math.atan2(foe.y - cs.y, foe.x - cs.x) : Math.atan2(u.oy || 1, u.ox || 1);
          const px2 = cs.x + Math.cos(ang) * (C.CITY.r - 10), py2 = cs.y + Math.sin(ang) * (C.CITY.r - 10);
          const dd2 = Math.sqrt(d2(u.x, u.y, px2, py2));
          if (dd2 > 6) { const mv = def.speed * dt / dd2; u.x += (px2 - u.x) * mv; u.y += (py2 - u.y) * mv; }
          const dc = Math.sqrt(d2(u.x, u.y, cs.x, cs.y));
          if (dc > C.CITY.r - 4) { const k2 = (C.CITY.r - 4) / (dc || 1); u.x = cs.x + (u.x - cs.x) * k2; u.y = cs.y + (u.y - cs.y) * k2; }
          continue;
        }
      }
      /* garrisons of an open city still see farther out */
      const home = u.owner !== 2 && d2(u.x, u.y, cityOf(world, u.owner).x, cityOf(world, u.owner).y) < C.CITY.r * C.CITY.r;
      const foe = acquire(world, u, def.aggro + (home ? 140 : 0));
      if (foe) {
        const reach = def.range + (foe.kind === 'unit' ? C.UNITS[foe.t.kind].size
          : foe.kind === 'wall' ? 6 : foe.kind === 'tower' ? 36 : C.BUILD.foot - 8);
        if (foe.d <= reach) {
          if (u.cd <= 0) {
            if (foe.kind === 'unit') hurt(world, foe.t, u.dmg, u.owner);
            else if (foe.kind === 'work') hurtBuilding(world, foe.t.pi, foe.t.id, u.dmg);
            else if (foe.kind === 'wall') { hurtWall(world, foe.t.pi, u.dmg); emit(world, { e: 'siege', pi: foe.t.pi, x: u.x, y: u.y }); }
            else if (foe.kind === 'tower') {
              const tp = world.players[foe.t.pi];
              tp.castleHp -= u.dmg;
              emit(world, { e: 'siege', pi: foe.t.pi, x: u.x, y: u.y });
              if (tp.castleHp <= 0) {
                /* a player toppling the Seat wins; Chaos toppling it crowns the survivor */
                win(world, u.owner === 2 ? 1 - foe.t.pi : u.owner, 'castle');
                return;
              }
            }
            u.cd = def.atk;
            if (def.range > 40) emit(world, { e: 'bolt', from: { x: u.x, y: u.y, owner: u.owner }, to: { x: foe.x, y: foe.y } });
          }
        } else {
          const mv = def.speed * dt / (foe.d || 1);
          u.x += (foe.x - u.x) * mv; u.y += (foe.y - u.y) * mv;
          clampWalls(world, u);
        }
        continue;
      }
      /* march: the flow field carries the column; within sight of the goal each soldier
       * peels off to his own place in the line, so an army arrives spread, not stacked */
      const gs = world.map.sites[u.goal];
      if (gs) {
        const gx = gs.x + u.ox, gy = gs.y + u.oy;
        const dgoal = Math.sqrt(d2(u.x, u.y, gx, gy));
        let vx = 0, vy = 0;
        if (dgoal < C.NAV.arrive) {
          if (dgoal > 4) { vx = (gx - u.x) / dgoal; vy = (gy - u.y) / dgoal; }
        } else {
          const s3 = NAV.steer(world.nav, world, u.owner, gs.x, gs.y, u.x, u.y);
          if (s3) { vx = s3.x; vy = s3.y; }
          else {
            /* walled off — go break what bars the way (or push on if nothing does) */
            const bl = nearestBlocker(world, u);
            const bx = bl ? bl.x : gx, by = bl ? bl.y : gy;
            const db = Math.sqrt(d2(u.x, u.y, bx, by)) || 1;
            vx = (bx - u.x) / db; vy = (by - u.y) / db;
          }
        }
        u.x += vx * def.speed * dt; u.y += vy * def.speed * dt;
      }
      clampWalls(world, u);
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

  function win(world, winner, reason) {
    world.winner = winner; world.winReason = reason;
    emit(world, { e: 'win', winner, reason });
  }

  global.World = { createWorld, applyCommand, update, upgradeCost, towerStats, canSee, cityOf,
                   visionSources, placementError, inClaim, nodeAt, nodeHolder, bldOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.World;
})(typeof window !== 'undefined' ? window : globalThis);

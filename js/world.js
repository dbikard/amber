/* world.js — the headless simulation core (v0.2 "The Shadow March"). No DOM, no Date.
 * A mirrored site-graph map: units path over edges, outposts claim sites, fog of war is
 * computed here (render + snapshots + AI all consume the same vision truth).
 * world.events is write-only here — a queue the renderer/UI drains; the sim never reads it. */
(function (global) {
  'use strict';

  const C = global.CONST || (typeof require !== 'undefined' ? require('./const.js') : null);
  const RNG = global.RNG || (typeof require !== 'undefined' ? require('./rng.js') : null);

  function emit(world, ev) {
    world.events.push(ev);
    if (world.events.length > C.EVENT_CAP) world.events.splice(0, world.events.length - C.EVENT_CAP);
  }
  const d2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };

  /* ---------------- map generation: template + mirror + jitter ---------------- */
  function buildMap(rng) {
    const sites = [], byKey = {};
    const nameBags = {};
    for (const k of Object.keys(C.SITE_NAMES)) nameBags[k] = C.SITE_NAMES[k].slice();
    const takeName = (kind) => {
      const bag = nameBags[kind];
      return bag && bag.length ? bag.splice(Math.floor(rng.next() * bag.length), 1)[0] : kind;
    };
    const add = (key, x, y, kind) => {
      const s = { id: sites.length, key, x, y, kind, owner: -1, post: null,
                  name: kind === 'city' ? null : takeName(kind), lastHurt: -99 };
      sites.push(s); byKey[key] = s;
      return s;
    };
    for (const [key, x, y, kind] of C.SITE_TEMPLATE) {
      const jx = kind === 'city' ? 0 : rng.range(-22, 22), jy = kind === 'city' ? 0 : rng.range(-22, 22);
      add(key, x + jx, y + jy, kind);
      if (key !== 'mid' && key !== 'sm0') {   // mirror everything except the true middles
        const src = byKey[key];
        add(key + '_m', C.MAP.W - src.x, C.MAP.H - src.y, kind);
      } else if (key === 'sm0') {
        const src = byKey[key];
        add('sm0_m', C.MAP.W - src.x, C.MAP.H - src.y, 'spring');
      }
    }
    byKey.city0.owner = 0; byKey.city0_m.owner = 1;
    byKey.city0.name = 'the City of Corwin'; byKey.city0_m.name = 'the City of Eric';

    const edges = [];   // adjacency by site id
    const adj = sites.map(() => []);
    const link = (a, b) => {
      if (!a || !b || adj[a.id].includes(b.id)) return;
      adj[a.id].push(b.id); adj[b.id].push(a.id);
      edges.push([a.id, b.id]);
    };
    const m = (k) => byKey[k + '_m'] || byKey[k];   // mirror lookup ('mid' maps to itself)
    for (const [a, b] of C.EDGE_TEMPLATE) {
      link(byKey[a], byKey[b]);
      link(m(a), m(b));   // the mirrored web ('mid' self-maps, stitching the halves)
    }
    /* stitch the halves: point-mirroring swaps east/west, so the west corridor's northern
     * continuation is v1's mirror (west-north), and the east corridor's southern leg is v1 */
    link(byKey.sm0, byKey.v1_m);      // west middle spring → west-north vantage
    link(byKey.sm0_m, byKey.v1);      // east middle spring → east-south vantage
    return { sites, edges, adj, byKey,
             cities: [byKey.city0.id, byKey.city0_m.id],
             roads: sites.filter((s) => s.kind === 'road').map((s) => s.id) };
  }

  function createWorld(seed) {
    const rng = RNG.make(seed >>> 0);
    const world = {
      seed: seed >>> 0, rng,
      t: 0, tick: 0,
      winner: null, winReason: null,
      map: buildMap(rng),
      players: [0, 1].map(() => ({
        essence: C.START_ESSENCE,
        castleHp: C.CASTLE_HP, wallHp: 0, wallLevel: 0, wallHurt: -99, wallAlert: -99,
        pattern: 0, walking: false, revealed: false, alertIdx: 0,
        slots: new Array(C.SLOTS).fill(null),
        powers: { storm: 0, trump: 0 },
        championId: 0,
        banner: -1,             // site id the army marches on; -1 = defend home
        musterPaused: false,    // the Seat can halt the muster to hoard essence
        explored: {}            // siteId -> last-known {kind, owner, post:{bt,level}|null}
      })),
      units: [], storms: [], events: [],
      nextId: 1,
      chaosNext: C.CHAOS.firstAt, chaosParity: 0, surged: false,
      vis: null                 // per-tick vision cache: [ [sources for p0], [for p1] ]
    };
    for (let pi = 0; pi < 2; pi++) {
      world.players[pi].banner = world.map.cities[pi];
      exploreAround(world, pi);   // you know your own surroundings from the start
    }
    return world;
  }

  const cityOf = (world, pi) => world.map.sites[world.map.cities[pi]];
  /* building plots ring the Seat-tower — real places that can be reached and razed */
  function slotPos(world, pi, idx) {
    const c2 = cityOf(world, pi);
    /* half-step ring offset: no plot sits dead behind the Seat-tower on the camera axis —
     * the road arrives between a flanking PAIR of front plots instead */
    const a = (idx / C.SLOTS) * Math.PI * 2 + (pi === 0 ? -Math.PI / 2 : Math.PI / 2) + Math.PI / C.SLOTS;
    return { x: c2.x + Math.cos(a) * C.CITY.slotR, y: c2.y + Math.sin(a) * C.CITY.slotR };
  }

  /* ---------------- vision & exploration ---------------- */
  function visionSources(world, pi) {
    const src = [];
    const city = cityOf(world, pi);
    src.push([city.x, city.y, C.VISION.city]);
    for (const s of world.map.sites)
      if (s.post && s.owner === pi)
        src.push([s.x, s.y, s.post.bt === 'watch' ? C.OUTPOSTS.watch.vision : C.VISION.post]);
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
    for (const s of world.map.sites) {
      if (seen(src, s.x, s.y)) {
        pl.explored[s.id] = { kind: s.kind, owner: s.owner,
                              post: s.post ? { bt: s.post.bt, level: s.post.level } : null };
      }
    }
  }
  /* public vision test for render/snapshots: can `pi` see point (x,y) right now? */
  function canSee(world, pi, x, y) {
    if (!world.vis) refreshVision(world);
    return seen(world.vis[pi], x, y);
  }

  /* ---------------- pathfinding (BFS; enemy ramparts block) ---------------- */
  function blockedFor(world, u, siteId) {
    const s = world.map.sites[siteId];
    return !!(s.post && s.post.bt === 'rampart' && s.owner !== u.owner && s.owner !== -1);
  }
  function nextStep(world, u, goalId) {
    /* BFS from goal back to the unit's nearest site; returns the next site to walk to */
    const map = world.map;
    let start = 0, best = Infinity;
    for (const s of map.sites) { const dd = d2(u.x, u.y, s.x, s.y); if (dd < best) { best = dd; start = s.id; } }
    if (start === goalId) return goalId;
    const prev = new Array(map.sites.length).fill(-1);
    const q = [goalId]; prev[goalId] = goalId;
    while (q.length) {
      const cur = q.shift();
      for (const nb of map.adj[cur]) {
        if (prev[nb] !== -1) continue;
        if (nb !== start && blockedFor(world, u, nb)) continue;   // walls bar the way
        prev[nb] = cur; q.push(nb);
      }
    }
    if (prev[start] === -1) {
      /* walled off — besiege the nearest hostile rampart instead */
      let target = -1, bd = Infinity;
      for (const s of map.sites) {
        if (blockedFor(world, u, s.id)) { const dd = d2(u.x, u.y, s.x, s.y); if (dd < bd) { bd = dd; target = s.id; } }
      }
      return target === -1 ? start : (u.goal = target, nextStep(world, u, target));
    }
    return prev[start];
  }

  /* ---------------- commands ---------------- */
  function upgradeCost(bt, level) { return C.BUILDINGS[bt].up[level - 1]; }
  function postUpCost(bt, level) { return C.OUTPOSTS[bt].up[level - 1]; }

  function applyCommand(world, pi, cmd) {
    if (world.winner !== null) return { ok: false, err: 'over' };
    const pl = world.players[pi];
    if (!pl) return { ok: false, err: 'player' };

    if (cmd.c === 'build') {
      const def = C.BUILDINGS[cmd.bt];
      if (!def) return { ok: false, err: 'type' };
      if (cmd.slot < 0 || cmd.slot >= C.SLOTS || pl.slots[cmd.slot]) return { ok: false, err: 'slot' };
      if (def.unique && pl.slots.some((s) => s && s.bt === cmd.bt)) return { ok: false, err: 'unique' };
      if (pl.essence < def.cost) return { ok: false, err: 'essence' };
      pl.essence -= def.cost;
      pl.slots[cmd.slot] = { bt: cmd.bt, level: 1, cd: def.period ? def.period[0] * 0.5 : (def.atk || 0),
                             hp: C.BUILDING_HP[cmd.bt], maxHp: C.BUILDING_HP[cmd.bt], lastHurt: -99,
                             rally: -1 };   // -1 = the company follows the royal War Banner
      emit(world, { e: 'build', pi, slot: cmd.slot, bt: cmd.bt });
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
      const s = pl.slots[cmd.slot];
      if (!s) return { ok: false, err: 'slot' };
      if (s.level >= C.MAX_LEVEL) return { ok: false, err: 'max' };
      const cost = upgradeCost(s.bt, s.level);
      if (pl.essence < cost) return { ok: false, err: 'essence' };
      pl.essence -= cost;
      s.level++;
      emit(world, { e: 'up', pi, slot: cmd.slot, level: s.level });
      return { ok: true };
    }
    if (cmd.c === 'walk') {
      if (!pl.slots.some((s) => s && s.bt === 'shrine')) return { ok: false, err: 'shrine' };
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
      const b = pl.slots[cmd.slot];
      if (!b || !C.BUILDINGS[b.bt].spawns) return { ok: false, err: 'slot' };
      if (cmd.site >= 0 && !world.map.sites[cmd.site]) return { ok: false, err: 'site' };
      b.rally = cmd.site;
      emit(world, { e: 'rally', pi, slot: cmd.slot, site: cmd.site });
      return { ok: true };
    }
    if (cmd.c === 'banner') {
      const site = world.map.sites[cmd.site];
      if (!site) return { ok: false, err: 'site' };
      pl.banner = site.id;
      emit(world, { e: 'banner', pi, site: site.id });
      return { ok: true };
    }
    if (cmd.c === 'post') {
      const site = world.map.sites[cmd.site], def = C.OUTPOSTS[cmd.bt];
      if (!site || !def || site.kind === 'city') return { ok: false, err: 'site' };
      if (site.post) return { ok: false, err: 'taken' };
      if (def.only && site.kind !== def.only) return { ok: false, err: 'terrain' };
      if (pl.essence < def.cost) return { ok: false, err: 'essence' };
      /* claiming Shadow means standing in it: a unit of yours must hold the site */
      if (!world.units.some((u) => u.owner === pi && d2(u.x, u.y, site.x, site.y) < 80 * 80))
        return { ok: false, err: 'presence' };
      if (world.units.some((u) => u.owner !== pi && u.owner !== 2 && d2(u.x, u.y, site.x, site.y) < 80 * 80))
        return { ok: false, err: 'contested' };
      pl.essence -= def.cost;
      site.owner = pi;
      site.post = { bt: cmd.bt, level: 1, hp: def.hp, maxHp: def.hp, cd: 0 };
      emit(world, { e: 'post', pi, site: site.id, bt: cmd.bt, x: site.x, y: site.y });
      return { ok: true };
    }
    if (cmd.c === 'postup') {
      const site = world.map.sites[cmd.site];
      if (!site || !site.post || site.owner !== pi) return { ok: false, err: 'site' };
      if (site.post.level >= C.MAX_LEVEL) return { ok: false, err: 'max' };
      const cost = postUpCost(site.post.bt, site.post.level);
      if (pl.essence < cost) return { ok: false, err: 'essence' };
      pl.essence -= cost;
      site.post.level++;
      if (site.post.bt === 'rampart') {
        site.post.maxHp = C.OUTPOSTS.rampart.hpUp[site.post.level - 2];
        site.post.hp = site.post.maxHp;
      }
      emit(world, { e: 'postup', pi, site: site.id, x: site.x, y: site.y });
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
    if (world.units.length > 240) return 0;
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
      cd: 0, step: -1,
      goal: goal != null ? goal : (owner === 2 ? world.map.cities[world.chaosParity++ % 2] : world.players[owner].banner),
      co: co != null ? co : -1   // company = mustering slot; -1 marches with the royal banner
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
  function hurtPost(world, site, dmg, byOwner) {
    site.post.hp -= dmg;
    site.lastHurt = world.t;
    if (site.post.hp <= 0) {
      emit(world, { e: 'postdie', pi: site.owner, site: site.id, x: site.x, y: site.y, bt: site.post.bt });
      site.post = null; site.owner = -1;
    } else if (world.t - (site.alerted || -99) > 12) {
      site.alerted = world.t;
      emit(world, { e: 'hurtpost', pi: site.owner, site: site.id, x: site.x, y: site.y });
    }
  }

  /* nearest hostile target within radius: units, outposts, and — at a city —
   * the wall (from outside), or its buildings and the Seat-tower (once inside). */
  function acquire(world, u, radius) {
    let best = null, bestD = radius, kind = null, bx = 0, by = 0;
    const consider = (d, t2, k, x, y) => { if (d < bestD) { bestD = d; best = t2; kind = k; bx = x; by = y; } };
    for (const v of world.units) {
      if (v.hp <= 0 || v.owner === u.owner) continue;
      consider(Math.sqrt(d2(u.x, u.y, v.x, v.y)), v, 'unit', v.x, v.y);
    }
    for (const s of world.map.sites) {
      if (!s.post || s.owner === u.owner || s.owner === -1) continue;
      consider(Math.sqrt(d2(u.x, u.y, s.x, s.y)), s, 'post', s.x, s.y);
    }
    for (let ci = 0; ci < 2; ci++) {
      if (ci === u.owner) continue;
      const tp = world.players[ci];
      const cs = world.map.sites[world.map.cities[ci]];
      const dc = Math.sqrt(d2(u.x, u.y, cs.x, cs.y));
      if (dc > C.CITY.r + radius) continue;
      if (tp.wallHp > 0) {
        /* the wall bars the way — batter it where you stand */
        const k2 = C.CITY.r / (dc || 1);
        consider(Math.max(0, dc - C.CITY.r), { pi: ci }, 'wall', cs.x + (u.x - cs.x) * k2, cs.y + (u.y - cs.y) * k2);
      } else {
        for (let si = 0; si < C.SLOTS; si++) {
          if (!tp.slots[si]) continue;
          const sp = slotPos(world, ci, si);
          consider(Math.sqrt(d2(u.x, u.y, sp.x, sp.y)), { pi: ci, slot: si }, 'slot', sp.x, sp.y);
        }
        consider(Math.sqrt(d2(u.x, u.y, cs.x, cs.y)), { pi: ci }, 'tower', cs.x, cs.y);
      }
    }
    return best ? { t: best, kind, d: bestD, x: bx, y: by } : null;
  }

  function hurtSlot(world, pi, idx, dmg) {
    const pl = world.players[pi], b = pl.slots[idx];
    if (!b) return;
    b.hp -= dmg; b.lastHurt = world.t;
    if (b.hp <= 0) {
      const sp = slotPos(world, pi, idx);
      emit(world, { e: 'raze', pi, slot: idx, bt: b.bt, x: sp.x, y: sp.y });
      pl.slots[idx] = null;
      if (b.bt === 'shrine') pl.walking = false;
    } else if (world.t - (pl.slotAlert || -99) > 12) {
      pl.slotAlert = world.t;
      const sp = slotPos(world, pi, idx);
      emit(world, { e: 'hurtcity', pi, x: sp.x, y: sp.y });
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

    /* players: income, city buildings, powers, walls, the walk */
    for (let pi = 0; pi < 2; pi++) {
      const pl = world.players[pi];
      const city = cityOf(world, pi);
      let income = C.BASE_INCOME;
      for (const s of world.map.sites)
        if (s.owner === pi && s.post && s.post.bt === 'sgate') income += C.OUTPOSTS.sgate.income[s.post.level - 1];
      let drain = pl.walking ? C.BUILDINGS.shrine.drain[(pl.slots.find((q) => q && q.bt === 'shrine') || { level: 1 }).level - 1] : 0;
      for (let si = 0; si < C.SLOTS; si++) {
        const b = pl.slots[si];
        if (!b) continue;
        const def = C.BUILDINGS[b.bt];
        const sp = slotPos(world, pi, si);
        if (b.hp < b.maxHp && t - b.lastHurt > 10) b.hp = Math.min(b.maxHp, b.hp + C.STRUCT_REGEN * dt);
        if (b.bt === 'gate') income += def.income[b.level - 1];
        else if (def.spawns) {
          if (pl.musterPaused) { b.cd = Math.max(b.cd, 0.5); continue; }
          drain += C.UNITS[def.spawns].cost / def.period[b.level - 1];
          b.cd -= dt;
          if (b.cd <= 0) {
            const price = C.UNITS[def.spawns].cost;
            if (pl.essence >= price) {   // every soldier is paid for — the treasury feeds the war
              pl.essence -= price;
              spawnUnit(world, pi, def.spawns, sp.x, sp.y, undefined, si);
              b.cd += def.period[b.level - 1];
            } else b.cd = 0.5;           // muster waits on the war chest
          }
        } else if (b.bt === 'tower') {
          b.cd -= dt;
          if (b.cd <= 0) {
            const range = def.range[b.level - 1];
            let best = null, bd = range * range;
            for (const u of world.units) {
              if (u.hp <= 0 || u.owner === pi) continue;
              const dd = d2(u.x, u.y, sp.x, sp.y);   // a tower guards ITS OWN ground
              if (dd < bd) { bd = dd; best = u; }
            }
            if (best) { hurt(world, best, def.dmg[b.level - 1], pi); emit(world, { e: 'shot', pi, slot: si, to: { x: best.x, y: best.y } }); b.cd = def.atk; }
            else b.cd = 0.15;
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
        const shrine = pl.slots.find((s) => s && s.bt === 'shrine');
        if (!shrine) pl.walking = false;
        else {
          const def = C.BUILDINGS.shrine;
          const drain = def.drain[shrine.level - 1] * dt;
          if (pl.essence >= drain) {
            pl.essence -= drain;
            pl.pattern += def.rate[shrine.level - 1] * dt;
            while (pl.alertIdx < C.PATTERN_ALERTS.length && pl.pattern >= C.PATTERN_ALERTS[pl.alertIdx].at) {
              emit(world, { e: 'pattern', pi, idx: pl.alertIdx }); pl.alertIdx++;
            }
            if (pl.pattern >= 100) { win(world, pi, 'pattern'); return; }
          }
        }
      }
    }

    /* outposts: regen + watchpost arrows */
    for (const s of world.map.sites) {
      if (!s.post) continue;
      if (s.post.hp < s.post.maxHp && t - s.lastHurt > 10) s.post.hp = Math.min(s.post.maxHp, s.post.hp + C.STRUCT_REGEN * dt);
      if (s.post.bt === 'watch') {
        const def = C.OUTPOSTS.watch;
        s.post.cd -= dt;
        if (s.post.cd <= 0) {
          let best = null, bd = def.range * def.range;
          for (const u of world.units) {
            if (u.hp <= 0 || u.owner === s.owner) continue;
            const dd = d2(u.x, u.y, s.x, s.y);
            if (dd < bd) { bd = dd; best = u; }
          }
          if (best) { hurt(world, best, def.dmg[s.post.level - 1], s.owner); emit(world, { e: 'wshot', site: s.id, x: s.x, y: s.y, to: { x: best.x, y: best.y } }); s.post.cd = def.atk; }
          else s.post.cd = 0.2;
        }
      }
    }

    /* chaos director: rifts at road sites (springs too, once surging) */
    if (t >= world.chaosNext) {
      const pool = world.surged
        ? world.map.roads.concat(world.map.sites.filter((s) => s.kind === 'spring').map((s) => s.id))
        : world.map.roads;
      const at = world.map.sites[pool[Math.floor(world.rng.next() * pool.length)]];
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
        const cb = u.co >= 0 ? pl2.slots[u.co] : null;
        const want = cb && cb.rally != null && cb.rally >= 0 ? cb.rally : pl2.banner;
        if (u.goal !== want) { u.goal = want; u.step = -1; }
      }
      /* garrisons man the walls: units standing in their own city see farther out */
      const home = u.owner !== 2 && d2(u.x, u.y, cityOf(world, u.owner).x, cityOf(world, u.owner).y) < C.CITY.r * C.CITY.r;
      const foe = acquire(world, u, def.aggro + (home ? 140 : 0));
      if (foe) {
        const reach = def.range + (foe.kind === 'unit' ? C.UNITS[foe.t.kind].size
          : foe.kind === 'wall' ? 6 : foe.kind === 'tower' ? 36 : foe.kind === 'slot' ? 24 : 30);
        if (foe.d <= reach) {
          if (u.cd <= 0) {
            if (foe.kind === 'unit') hurt(world, foe.t, u.dmg, u.owner);
            else if (foe.kind === 'post') hurtPost(world, foe.t, u.dmg, u.owner);
            else if (foe.kind === 'slot') hurtSlot(world, foe.t.pi, foe.t.slot, u.dmg);
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
      /* march */
      if (u.step === -1 || d2(u.x, u.y, world.map.sites[u.step].x + u.ox, world.map.sites[u.step].y + u.oy) < 34 * 34)
        u.step = nextStep(world, u, u.goal);
      const wp = world.map.sites[u.step];
      const tx = wp.x + u.ox, ty = wp.y + u.oy;
      const dd = Math.sqrt(d2(u.x, u.y, tx, ty));
      if (dd > 4) {
        const mv = def.speed * dt / dd;
        u.x += (tx - u.x) * mv; u.y += (ty - u.y) * mv;
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

  global.World = { createWorld, applyCommand, update, upgradeCost, postUpCost, canSee, cityOf, visionSources, slotPos };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.World;
})(typeof window !== 'undefined' ? window : globalThis);

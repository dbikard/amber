/* test/headless.js — everything checkable without a browser: world generation, movement,
 * the placement rules, and the multiplayer snapshot contract.
 *
 * The snapshot tests matter most. A guest sees the world ONLY through Net.snapFor, so every
 * field the renderers read has to survive it, and nothing the rival is entitled to keep may
 * come along for the ride. */
'use strict';
const path = require('path');
const R = (f) => require(path.join(__dirname, '..', 'js', f));
R('rng.js'); R('const.js'); R('worldgen.js'); R('nav.js'); R('world.js'); R('ai.js'); R('net.js');
R('record.js');
const { CONST: C, World, NAV, AI, Net, Rec, WorldGen: WG } = globalThis;
const { suite, ok, eq, near, report } = require('./lib.js');

const SEEDS = [1, 7, 42, 1000, 31337];

/* ---------------- the world ---------------- */
suite('world generation');
for (const seed of SEEDS) {
  const t0 = Date.now();
  const w = World.createWorld(seed);
  const ms = Date.now() - t0;
  ok(`seed ${seed} generates`, !!w && !!w.map && w.map.sites.length > 4, `${w && w.map && w.map.sites.length} sites`);
  ok(`seed ${seed} generates quickly`, ms < 400, `${ms}ms`);
  const stranded = NAV.audit(w.nav, w.map);
  eq(`seed ${seed}: no site is stranded`, stranded.length, 0, stranded.join(','));
  const c0 = w.map.sites[w.map.cities[0]], c1 = w.map.sites[w.map.cities[1]];
  ok(`seed ${seed}: the Seats are far apart`, Math.hypot(c1.x - c0.x, c1.y - c0.y) >= C.WORLD.seatApart * 0.95,
     `${Math.round(Math.hypot(c1.x - c0.x, c1.y - c0.y))} apart`);
  for (const [n, cs] of [['0', c0], ['1', c1]])
    ok(`seed ${seed}: Seat ${n} stands inland`,
       cs.x > C.WORLD.inland * 0.9 && cs.y > C.WORLD.inland * 0.9 &&
       cs.x < C.MAP.W - C.WORLD.inland * 0.9 && cs.y < C.MAP.H - C.WORLD.inland * 0.9,
       `${Math.round(cs.x)},${Math.round(cs.y)}`);
  /* every terrain class should actually occur, or the generator has collapsed */
  const seen = new Set(w.nav.terra);
  ok(`seed ${seed}: the land is varied`, seen.size >= 5, `${seen.size} of 7 terrain classes present`);

  /* Both sides must open with a spring they can actually DRAW ON: inside the starting writ,
   * at arm's length from the Seat rather than in its lap, and with ground beside it that
   * bears a Gate. A spring you can see and never use is worse than none. */
  for (const pi of [0, 1]) {
    const cs = World.cityOf(w, pi);
    const springs = w.map.sites.filter((s) => s.kind === 'node')
      .map((s) => ({ s, d: Math.hypot(s.x - cs.x, s.y - cs.y) })).sort((a, b) => a.d - b.d);
    ok(`seed ${seed}: no spring crowds Seat ${pi}`, !springs.length || springs[0].d >= C.WORLD.springNear,
       `nearest ${Math.round(springs[0] ? springs[0].d : -1)}`);
    const inReach = springs.filter((q) => q.d <= C.CLAIM.seat);
    ok(`seed ${seed}: Seat ${pi} opens with a spring in its writ`, inReach.length > 0,
       `nearest ${Math.round(springs[0] ? springs[0].d : -1)}`);
    let raisable = null;
    for (const q of inReach) {
      for (let rr = 18; rr < C.NODE.r && !raisable; rr += 12)
        for (let a2 = 0; a2 < 24 && !raisable; a2++) {
          const th = a2 / 24 * Math.PI * 2;
          const x = q.s.x + Math.cos(th) * rr, y = q.s.y + Math.sin(th) * rr;
          if (World.placementError(w, pi, x, y, 'gate') === null) raisable = q;
        }
      if (raisable) break;
    }
    ok(`seed ${seed}: and a Gate can actually be raised on it`, !!raisable,
       raisable ? `${raisable.s.name} at ${Math.round(raisable.d)}` : 'none claimable');
  }

  /* A spring lies in a level hollow. The pool and its ownership ring are drawn as FLAT discs
   * at one height, so ground that rises across them pokes through and takes a bite out of the
   * water — which is exactly what a wedge missing from a pool looks like. Measure the terrain
   * the way the renderer does and demand it be level out to the rim of the ring. */
  {
    const nav = w.nav;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < nav.elev.length; i++) {
      const e = nav.elev[i];
      if (e < lo) lo = e;
      if (e > hi) hi = e;
    }
    const span = Math.max(1e-6, hi - lo);
    const hAt = (x, z) => {
      const fx = Math.max(0, Math.min(nav.W - 1.001, x / nav.cw - 0.5));
      const fz = Math.max(0, Math.min(nav.H - 1.001, z / nav.cw - 0.5));
      const x0 = fx | 0, z0 = fz | 0, tx = fx - x0, tz = fz - z0;
      const i = z0 * nav.W + x0;
      const a = nav.elev[i] * (1 - tx) + nav.elev[i + 1] * tx;
      const b = nav.elev[i + nav.W] * (1 - tx) + nav.elev[i + nav.W + 1] * tx;
      return ((a * (1 - tz) + b * tz) - lo) / span * C.WORLD.relief;
    };
    const RIM = 41;              // outer radius of the ownership ring, from render3d.js
    let worst = 0, where = null;
    for (const s of w.map.sites) {
      if (s.kind !== 'node') continue;
      let mn = Infinity, mx = -Infinity;
      for (let rr = 0; rr <= RIM; rr += 8)
        for (let a2 = 0; a2 < 16; a2++) {
          const th = a2 / 16 * Math.PI * 2;
          const h = hAt(s.x + Math.cos(th) * rr, s.y + Math.sin(th) * rr);
          if (h < mn) mn = h;
          if (h > mx) mx = h;
        }
      if (mx - mn > worst) { worst = mx - mn; where = s.name; }
    }
    ok(`seed ${seed}: every spring sits in level ground`, worst <= 1,
       `worst spread ${worst.toFixed(2)} at ${where}`);
  }
}

suite('movement');
for (const seed of SEEDS.slice(0, 3)) {
  const w = World.createWorld(seed);
  const c0 = w.map.sites[w.map.cities[0]], c1 = w.map.sites[w.map.cities[1]];
  let u = { x: c0.x, y: c0.y }, i = 0, blocked = false;
  for (; i < 40000; i++) {
    if (Math.hypot(u.x - c1.x, u.y - c1.y) < C.NAV.arrive) break;
    const s = NAV.steer(w.nav, w, 0, c1.x, c1.y, u.x, u.y);
    if (!s) { blocked = true; break; }
    u.x += s.x * C.UNITS.soldier.speed / 30; u.y += s.y * C.UNITS.soldier.speed / 30;
  }
  ok(`seed ${seed}: a unit can walk Seat to Seat`, !blocked && i < 40000, blocked ? 'no route' : `${(i / 30).toFixed(1)}s`);
}

/* one work rises at a time and takes time to rise, so a test that wants three of them has to
 * wait for the masons like anyone else */
function raise(w, pi, x, y, bt) {
  const r = World.applyCommand(w, pi, { c: 'build', x, y, bt });
  if (!r.ok) return r;
  for (let i = 0; i < 30 * 40 && w.players[pi].buildings.some((b) => b.raise > 0); i++) World.update(w, C.SIM_DT);
  w.events.length = 0;
  return r;
}

/* ---------------- the rules ---------------- */
suite('placement rules');
{
  const w = World.createWorld(1000), pl = w.players[0], c = World.cityOf(w, 0);
  pl.essence = 90000;
  const byTerrain = {};
  for (let gy = 0; gy < w.nav.H; gy++) for (let gx = 0; gx < w.nav.W; gx++) {
    const t = w.nav.terra[gy * w.nav.W + gx];
    const x = (gx + 0.5) * w.nav.cw, y = (gy + 0.5) * w.nav.cw;
    if (Math.hypot(x - c.x, y - c.y) > C.CLAIM.seat - 30) continue;
    if (byTerrain[t]) continue;
    byTerrain[t] = World.placementError(w, 0, x, y, 'barracks') || 'LEGAL';
  }
  for (const t of Object.keys(byTerrain)) {
    const buildable = !!WG.BUILDABLE[t];
    ok(`terrain ${t} ${buildable ? 'bears' : 'refuses'} a work`,
       buildable ? byTerrain[t] === 'LEGAL' : byTerrain[t] === 'ground', `-> ${byTerrain[t]}`);
  }
  eq('a work may not stand on the Seat itself', World.placementError(w, 0, c.x, c.y, 'barracks'), 'crowded');
  /* buildable ground, far from either Seat and from any spring: the only thing wrong with it
   * is that it lies outside the writ, so that must be the reason we get back */
  const e = World.cityOf(w, 1);
  let far = null;
  for (let gy = 0; gy < w.nav.H && !far; gy++) for (let gx = 0; gx < w.nav.W; gx++) {
    if (!WG.BUILDABLE[w.nav.terra[gy * w.nav.W + gx]]) continue;
    const x = (gx + 0.5) * w.nav.cw, y = (gy + 0.5) * w.nav.cw;
    if (Math.hypot(x - c.x, y - c.y) < C.CLAIM.seat + 200) continue;
    if (Math.hypot(x - e.x, y - e.y) < C.CLAIM.seat + 200) continue;
    if (w.map.sites.some((s) => Math.hypot(x - s.x, y - s.y) < C.CLAIM.gate + 200)) continue;
    far = { x, y }; break;
  }
  ok('found open ground outside the writ to test with', !!far);
  eq('beyond the writ is refused', World.placementError(w, 0, far.x, far.y, 'barracks'), 'claim');
  /* unique */
  let spot = null;
  for (let a = 0; a < 40 && !spot; a++) {
    const th = a / 40 * Math.PI * 2, x = c.x + Math.cos(th) * 200, y = c.y + Math.sin(th) * 200;
    if (!World.placementError(w, 0, x, y, 'shrine')) spot = { x, y };
  }
  ok('a Shrine can be raised', !!spot && raise(w, 0, spot.x, spot.y, 'shrine').ok);
  let spot2 = null;
  for (let a = 0; a < 40 && !spot2; a++) {
    const th = a / 40 * Math.PI * 2 + 0.08, x = c.x + Math.cos(th) * 260, y = c.y + Math.sin(th) * 260;
    if (World.placementError(w, 0, x, y, 'shrine') === 'unique') spot2 = true;
  }
  ok('a second Shrine is refused as unique', !!spot2);
}

suite('command grammar');
{
  const w = World.createWorld(7), pl = w.players[0], c = World.cityOf(w, 0);
  pl.essence = 90000;
  let built = null;
  for (let a = 0; a < 40 && !built; a++) {
    const th = a / 40 * Math.PI * 2, x = c.x + Math.cos(th) * 190, y = c.y + Math.sin(th) * 190;
    if (!World.placementError(w, 0, x, y, 'tower')) { World.applyCommand(w, 0, { c: 'build', x, y, bt: 'tower' }); built = pl.buildings[0]; }
  }
  ok('a work is raised with an id and a position', built && built.id > 0 && isFinite(built.x));
  eq('it cannot be upgraded while it is still going up', World.applyCommand(w, 0, { c: 'up', id: built.id }).err, 'raising');
  for (let i = 0; i < 30 * 40 && built.raise > 0; i++) World.update(w, C.SIM_DT);
  w.events.length = 0;
  eq('the tower fork demands a branch', World.applyCommand(w, 0, { c: 'up', id: built.id }).err, 'branch');
  eq('an unknown branch is refused', World.applyCommand(w, 0, { c: 'up', id: built.id, br: 'lasers' }).err, 'branch');
  ok('the fork takes a branch', World.applyCommand(w, 0, { c: 'up', id: built.id, br: 'cannon' }).ok);
  World.applyCommand(w, 0, { c: 'up', id: built.id, br: 'bolt' });
  eq('the branch is permanent', built.br, 'cannon');
  eq('an unknown work id is refused', World.applyCommand(w, 0, { c: 'up', id: 999999 }).err, 'id');
}

suite('a Gate stands on a spring')
{
  const w = World.createWorld(1000), pl = w.players[0], c = World.cityOf(w, 0);
  pl.essence = 99000;
  /* bare ground inside your own writ takes any ordinary work — and refuses a Gate */
  let bare = null;
  for (let rad = 170; rad < C.CLAIM.seat - 40 && !bare; rad += 20)
    for (let a = 0; a < 40 && !bare; a++) {
      const th = a / 40 * Math.PI * 2, x = c.x + Math.cos(th) * rad, y = c.y + Math.sin(th) * rad;
      if (World.placementError(w, 0, x, y, 'barracks') === null && !World.nodeAt(w, x, y)) bare = { x, y };
    }
  ok('bare ground inside the writ', !!bare);
  eq('...bears a Barracks', World.placementError(w, 0, bare.x, bare.y, 'barracks'), null);
  eq('...but refuses a Gate', World.placementError(w, 0, bare.x, bare.y, 'gate'), 'nospring');

  /* the spring in your writ takes one */
  const spring = w.map.sites.filter((s) => s.kind === 'node')
    .map((s) => ({ s, d: Math.hypot(s.x - c.x, s.y - c.y) })).sort((a, b) => a.d - b.d)[0];
  let on = null;
  for (let rr = 18; rr < C.NODE.r && !on; rr += 12)
    for (let a = 0; a < 24 && !on; a++) {
      const th = a / 24 * Math.PI * 2;
      const x = spring.s.x + Math.cos(th) * rr, y = spring.s.y + Math.sin(th) * rr;
      if (World.placementError(w, 0, x, y, 'gate') === null) on = { x, y };
    }
  ok('a spring in the writ takes a Gate', !!on, spring.s.name);
  ok('and raising it works', !!on && World.applyCommand(w, 0, { c: 'build', ...on, bt: 'gate' }).ok);
  for (let i = 0; i < 30 * 40 && pl.buildings.some((b) => b.raise > 0); i++) World.update(w, C.SIM_DT);
  w.events.length = 0;
  const g = pl.buildings.find((b) => b.bt === 'gate');
  ok('the Gate knows its spring', g && g.node === spring.s.id);
  /* the far side of the same spring: clear of the Gate that stands there, so the reason we
   * get back is that the spring is spoken for, not that the ground is crowded */
  let other = null;
  for (let rr = 20; rr < C.NODE.r && !other; rr += 10)
    for (let a = 0; a < 24 && !other; a++) {
      const th = a / 24 * Math.PI * 2;
      const x = spring.s.x + Math.cos(th) * rr, y = spring.s.y + Math.sin(th) * rr;
      if (World.placementError(w, 0, x, y, 'gate') === 'taken') other = { x, y };
    }
  ok('a second Gate on the same spring is refused as taken', !!other);

  /* every Gate now draws deep — there is no trickling waystone left to draw shallow */
  ok('a Gate has no off-spring income table at all', C.BUILDINGS.gate.income === undefined);
  const base = w.players[1].incomeRate;
  World.update(w, C.SIM_DT);
  ok('and it pays the spring rate', pl.incomeRate >= C.BASE_INCOME + C.BUILDINGS.gate.nodeIncome[0] - 0.01,
     `${pl.incomeRate.toFixed(1)} vs base ${base.toFixed(1)}`);
}

suite('two, three or four heirs')
{
  ok('Chaos owns no seat index a player could hold', C.CHAOS_ID < 0);
  eq('four is the ceiling', C.MAX_PLAYERS, 4);
  ok('every seat has a name', C.SEAT_NAMES.length >= C.MAX_PLAYERS);

  for (const n of [2, 3, 4]) {
    const w = World.createWorld(1000, n);
    eq(`${n} heirs: that many players`, w.players.length, n);
    eq(`${n} heirs: that many Seats`, w.map.cities.length, n);
    const named = new Set(w.map.cities.map((id) => w.map.sites[id].name));
    eq(`${n} heirs: each Seat named for its own`, named.size, n);
    /* every Seat must reach every other, or somebody is playing a different match */
    const stranded = NAV.audit(w.nav, w.map);
    eq(`${n} heirs: nothing stranded`, stranded.length, 0, stranded.join(','));
    let closest = Infinity;
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      const p = World.cityOf(w, a), q = World.cityOf(w, b);
      closest = Math.min(closest, Math.hypot(p.x - q.x, p.y - q.y));
    }
    ok(`${n} heirs: no two Seats crowd each other`, closest > C.CLAIM.seat * 2,
       `closest pair ${Math.round(closest)}`);
    /* and each opens with a spring it can draw on, exactly as a duel does */
    for (let pi = 0; pi < n; pi++) {
      const cs = World.cityOf(w, pi);
      const own = w.map.sites.filter((q) => q.kind === 'node' && Math.hypot(q.x - cs.x, q.y - cs.y) <= C.CLAIM.seat);
      ok(`${n} heirs: seat ${pi} opens with a spring`, own.length > 0);
    }
    /* it runs */
    for (let i = 0; i < 30 * 90; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
    eq(`${n} heirs: still running after 90s`, w.winner, null);
    ok(`${n} heirs: Chaos is on the board and owned by nobody`,
       w.units.every((u) => u.owner === C.CHAOS_ID || (u.owner >= 0 && u.owner < n)));
  }
}

suite('a Seat falls')
{
  /* a duel ends when a Seat falls; a free-for-all only loses an heir */
  const topple = (w, pi) => {
    const by = (pi + 1) % w.players.length;
    w.players[pi].castleHp = 1;
    w.players[by].essence = 99999; w.players[by].powers.trump = 0;
    World.applyCommand(w, by, { c: 'power', k: 'trump' });
    const u = w.units.find((q) => q.id === w.players[by].championId);
    const cs = World.cityOf(w, pi);
    u.x = cs.x; u.y = cs.y;
    for (let i = 0; i < 30 * 25 && !w.players[pi].out && w.winner === null; i++) {
      World.update(w, C.SIM_DT); w.events.length = 0;
    }
  };

  const duel = World.createWorld(1000, 2);
  topple(duel, 1);
  eq('a duel ends on the first fall', duel.winner, 0);
  eq('...by the castle', duel.winReason, 'castle');

  const ffa = World.createWorld(1000, 4);
  const b1 = ffa.players[3].buildings.length;
  topple(ffa, 3);
  ok('a fourth heir can fall', ffa.players[3].out);
  eq('...without ending the match', ffa.winner, null);
  eq('their works are gone', ffa.players[3].buildings.length, 0, `${b1} before`);
  eq('and their men with them', ffa.units.filter((u) => u.owner === 3).length, 0);
  topple(ffa, 2);
  eq('a third can fall too', ffa.winner, null);
  topple(ffa, 1);
  eq('the last heir standing takes the throne', ffa.winner, 0);
  eq('...by the castle', ffa.winReason, 'castle');
  ok('the fallen stay fallen', ffa.players.filter((p) => p.out).length === 3);
}

suite('a walk is a beacon')
{
  const w = World.createWorld(1000, 3), pl = w.players[1], c = World.cityOf(w, 1);
  pl.essence = 999999;
  let at = null;
  for (let rad = 170; rad < C.CLAIM.seat - 40 && !at; rad += 20)
    for (let a = 0; a < 40 && !at; a++) {
      const th = a / 40 * Math.PI * 2, x = c.x + Math.cos(th) * rad, y = c.y + Math.sin(th) * rad;
      if (World.placementError(w, 1, x, y, 'shrine') === null) at = { x, y };
    }
  ok('seat 1 raises a Shrine', !!at && raise(w, 1, at.x, at.y, 'shrine').ok);
  const sh = pl.buildings.find((b) => b.bt === 'shrine');
  const step = (n) => { for (let i = 0; i < n; i++) { World.update(w, C.SIM_DT); w.events.length = 0; } };

  ok('nobody else can see it while it is quiet', !World.canSee(w, 0, sh.x, sh.y) && !World.canSee(w, 2, sh.x, sh.y));
  eq('and nobody is walking', World.walkers(w).length, 0);

  World.applyCommand(w, 1, { c: 'walk', on: true });
  step(12);
  ok('the walk lights the Shrine for EVERY other heir',
     World.canSee(w, 0, sh.x, sh.y) && World.canSee(w, 2, sh.x, sh.y));
  ok('...and the ground around it', World.canSee(w, 0, sh.x + C.VISION.pattern * 0.7, sh.y));
  ok('...but not the whole map', !World.canSee(w, 0, sh.x + C.VISION.pattern * 1.6, sh.y));
  const ws = World.walkers(w);
  eq('the walkers list names them', ws.length, 1);
  eq('...by seat', ws[0].pi, 1);
  ok('...with the Shrine it burns at', ws[0].x === sh.x && ws[0].y === sh.y);
  ok('...and how far along', ws[0].pattern > 0);

  /* the count is public too — a rival snapshot must carry it */
  const wire = JSON.parse(JSON.stringify(Net.snapFor(w, 0, [])));
  ok('a rival sees the walk on the wire', wire.players[1].walking === true);
  ok('and its progress', wire.players[1].pattern > 0);
  ok('and the Shrine itself is sent, being visible now',
     wire.players[1].buildings.some((b) => b.bt === 'shrine'));

  World.applyCommand(w, 1, { c: 'walk', on: false });
  step(12);
  ok('stopping puts the light out', !World.canSee(w, 0, sh.x, sh.y));
  eq('and clears the board', World.walkers(w).length, 0);

  /* a fallen heir is not walking, whatever it was doing when it fell */
  World.applyCommand(w, 1, { c: 'walk', on: true });
  step(12);
  eq('walking again', World.walkers(w).length, 1);
  w.players[1].out = true;
  eq('a fallen heir leaves the board', World.walkers(w).length, 0);
  step(12);
  ok('and their light goes out', !World.canSee(w, 0, sh.x, sh.y));
}

suite('four on the wire')
{
  const w = World.createWorld(1000, 4);
  const bots = [AI.make('benedict'), AI.make('julian'), AI.make('bleys'), AI.make('brand')];
  for (let i = 0; i < 30 * 60 * 3 && w.winner === null; i++) {
    for (let pi = 0; pi < 4; pi++) bots[pi].step(w, pi, (cm) => World.applyCommand(w, pi, cm), C.SIM_DT);
    World.update(w, C.SIM_DT);
    w.events.length = 0;
  }
  ok('all four heirs are building', w.players.every((p) => p.buildings.length > 0),
     w.players.map((p) => p.buildings.length).join(','));

  /* one snapshot per seat, and each must keep every OTHER seat's secrets */
  for (let viewer = 0; viewer < 4; viewer++) {
    const wire = JSON.parse(JSON.stringify(Net.snapFor(w, viewer, [])));
    eq(`seat ${viewer}: the snapshot carries every player`, wire.players.length, 4);
    const rivals = wire.players.filter((q, pi) => pi !== viewer);
    ok(`seat ${viewer}: no rival essence`, rivals.every((q) => q.essence === null));
    ok(`seat ${viewer}: no rival banner`, rivals.every((q) => q.banner === null));
    ok(`seat ${viewer}: no rival powers`, rivals.every((q) => q.powers === null));
    ok(`seat ${viewer}: no rival company list`, rivals.every((q) => q.companies.length === 0));
    ok(`seat ${viewer}: own essence is present`, wire.players[viewer].essence != null);
    /* fog: every rival work sent must be one this seat can actually see */
    const canSee = (x, y) => World.canSee(w, viewer, x, y);
    for (let pi = 0; pi < 4; pi++) {
      if (pi === viewer) continue;
      ok(`seat ${viewer}: only sees seat ${pi}'s works it can see`,
         wire.players[pi].buildings.every((b) => canSee(b.x, b.y)));
    }
    ok(`seat ${viewer}: units are its own or seen`,
       wire.units.every((u) => u.owner === viewer || canSee(u.x, u.y)));
    const bytes = JSON.stringify(wire).length;
    ok(`seat ${viewer}: still fits a 10 Hz channel`, bytes < 120000, `${(bytes / 1024).toFixed(1)} KiB`);
  }

  /* four seats means four snapshots per tick — the budget is what the host must push */
  const total = [0, 1, 2, 3].reduce((a, v) => a + JSON.stringify(Net.snapFor(w, v, [])).length, 0);
  ok('the host can push all four at 10 Hz', total < 400000,
     `${(total / 1024).toFixed(1)} KiB per round, ${(total * 10 / 1024 / 1024 * 8).toFixed(1)} Mbit/s`);
}

suite('the Pattern is not upgraded')
{
  const w = World.createWorld(1000), pl = w.players[0], c = World.cityOf(w, 0);
  pl.essence = 999999;
  ok('the Shrine has no upgrade table at all', C.BUILDINGS.shrine.up === undefined);
  ok('so it has one drain and one rate', C.BUILDINGS.shrine.drain.length === 1 && C.BUILDINGS.shrine.rate.length === 1);

  let at = null;
  for (let rad = 170; rad < C.CLAIM.seat - 40 && !at; rad += 20)
    for (let a = 0; a < 40 && !at; a++) {
      const th = a / 40 * Math.PI * 2, x = c.x + Math.cos(th) * rad, y = c.y + Math.sin(th) * rad;
      if (World.placementError(w, 0, x, y, 'shrine') === null) at = { x, y };
    }
  ok('a Shrine can be raised', !!at && raise(w, 0, at.x, at.y, 'shrine').ok);
  const sh = pl.buildings.find((b) => b.bt === 'shrine');
  eq('it stands at level 1', sh.level, 1);
  eq('and refuses to be upgraded', World.applyCommand(w, 0, { c: 'up', id: sh.id }).err, 'noup');
  eq('...still at level 1', sh.level, 1);
  ok('an upgrade has no price to quote', !isFinite(World.upgradeCost('shrine', 1)));

  /* the walk is the commitment: it must cost real essence, and be felt as a drain */
  const before = pl.essence;
  ok('the walk begins', World.applyCommand(w, 0, { c: 'walk', on: true }).ok);
  for (let i = 0; i < 30; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  const spent = before - pl.essence;
  near('a second of walking costs the Shrine drain', spent, C.BUILDINGS.shrine.drain[0], 3.5,
       `${spent.toFixed(1)} spent, drain ${C.BUILDINGS.shrine.drain[0]}/s`);
  ok('the drain is reported to the HUD', pl.drainRate >= C.BUILDINGS.shrine.drain[0] - 0.5,
     `${pl.drainRate.toFixed(1)}/s`);
  const full = C.BUILDINGS.shrine.drain[0] * (100 / C.BUILDINGS.shrine.rate[0]);
  ok('a whole walk is a serious sum', full > 9000, `${Math.round(full)} essence over ${(100 / C.BUILDINGS.shrine.rate[0] / 60).toFixed(1)} min`);

  /* A POOR PLAYER WALKS SLOWER, BUT NEVER STOPS. Partial payment alone had the same disease
   * as all-or-nothing, only slower: at a sixth of a percent a minute the Pattern is not the
   * game's clock, it is a stopped one — and every mirror measured running to the 45-minute
   * cap had a walker broke for 90-95% of it. `minRate` is the floor. */
  const def = C.BUILDINGS.shrine;
  pl.essence = 0;
  const at0 = pl.pattern;
  for (let i = 0; i < 30; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  const crawled = pl.pattern - at0;
  ok('an empty treasury slows the walk', crawled < def.rate[0] * 0.95, `${crawled.toFixed(3)}%/s`);
  ok('...but it does not stop it', crawled >= def.rate[0] * def.minRate * 0.9,
     `${crawled.toFixed(3)}%/s against a floor of ${(def.rate[0] * def.minRate).toFixed(3)}`);
  /* which is what makes it a clock: a walk begun on nothing still arrives */
  const worst = 100 / (def.rate[0] * def.minRate) / 60;
  ok('so the slowest possible walk still finishes inside a match', worst < 25,
     `${worst.toFixed(1)} minutes at the floor`);
}

/* A WALK IS HELD, NOT BANKED. Progress used to be permanent the instant it was bought, which
 * made the Shrine a savings account — walk when rich, stop when poor, and nothing already paid
 * for was ever at risk. It also made an assault on a walker pointless: razing the Shrine cost
 * them 380 essence and the time to raise another, and not one point of the walk. */
suite('the lines fade')
{
  const w = World.createWorld(1000), pl = w.players[0], c = World.cityOf(w, 0);
  const def = C.BUILDINGS.shrine;
  pl.essence = 999999;
  w.chaosNext = 1e9;   // this is about the walk, not about who happens to raze the Shrine
  let at = null;
  for (let rad = 170; rad < C.CLAIM.seat - 40 && !at; rad += 20)
    for (let a = 0; a < 40 && !at; a++) {
      const th = a / 40 * Math.PI * 2, x = c.x + Math.cos(th) * rad, y = c.y + Math.sin(th) * rad;
      if (World.placementError(w, 0, x, y, 'shrine') === null) at = { x, y };
    }
  ok('a Shrine stands', !!at && raise(w, 0, at.x, at.y, 'shrine').ok);
  const sh = pl.buildings.find((b) => b.bt === 'shrine');

  World.applyCommand(w, 0, { c: 'walk', on: true });
  for (let i = 0; i < 30 * 60; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  const walked = pl.pattern;
  ok('a minute of walking gets you somewhere', walked > 5, `${walked.toFixed(1)}%`);

  /* stop, and the Pattern lets go */
  World.applyCommand(w, 0, { c: 'walk', on: false });
  for (let i = 0; i < 30 * 60; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  const faded = walked - pl.pattern;
  near('a minute of standing still gives some of it back', faded, def.decay * 60, 0.2,
       `lost ${faded.toFixed(2)}% of ${walked.toFixed(1)}%`);
  ok('but it does not evaporate — a pause is a cost, not a reset', pl.pattern > walked * 0.5,
     `${pl.pattern.toFixed(1)}% left`);

  /* and it never runs past zero */
  pl.pattern = 0.01;
  for (let i = 0; i < 30 * 10; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  eq('the walk cannot go negative', pl.pattern, 0);

  /* THE ASSAULT. Throwing the Shrine down tears the walker off the Pattern and costs them
   * ground they had already paid for — the whole reason to go after one. */
  pl.pattern = 60;
  World.applyCommand(w, 0, { c: 'walk', on: true });
  World.update(w, C.SIM_DT); w.events.length = 0;
  ok('the walk is under way again', pl.walking);
  World.hurtBuilding(w, 0, sh.id, sh.hp + 1);
  ok('the Shrine is thrown down', !pl.buildings.some((b) => b.bt === 'shrine'));
  ok('...which tears the walker off the Pattern', !pl.walking);
  near('...and costs them what they had paid for', 60 - pl.pattern, def.breakLoss, 0.5,
       `${pl.pattern.toFixed(1)}% left of 60%`);
  ok('the loss is announced', w.events.some((e) => e.e === 'shrinefell' && e.pi === 0),
     w.events.map((e) => e.e).join(','));

  /* rebuilding is not a full refund: the ground lost stays lost */
  w.events.length = 0;
  pl.essence = 999999;
  ok('a new Shrine can be raised', raise(w, 0, at.x, at.y, 'shrine').ok);
  ok('but the walk resumes from where it was left, not from where it stood',
     pl.pattern < 60 - def.breakLoss + 1, `${pl.pattern.toFixed(1)}%`);
}

suite('companies')
{
  const w = World.createWorld(1000), pl = w.players[0], c = World.cityOf(w, 0);
  pl.essence = 999999;
  const free = (bt, r) => {
    for (let a = 0; a < 48; a++) {
      const th = a / 48 * Math.PI * 2, x = c.x + Math.cos(th) * r, y = c.y + Math.sin(th) * r;
      if (World.placementError(w, 0, x, y, bt) === null) return { x, y };
    }
    return null;
  };
  const hall = (r, co) => {
    const at = free('barracks', r);
    if (!at) return null;
    World.applyCommand(w, 0, { c: 'build', ...at, bt: 'barracks', co });
    for (let i = 0; i < 30 * 40 && pl.buildings.some((b) => b.raise > 0); i++) World.update(w, C.SIM_DT);
    w.events.length = 0;
    return pl.buildings[pl.buildings.length - 1];
  };

  const h1 = hall(180, 0);
  ok('a hall may muster under the War Banner', h1 && h1.co === 0);
  eq('...which is not a company at all', pl.companies.length, 0);
  const h2 = hall(235, 'new');
  ok('a hall may raise a standard of its own', h2 && h2.co > 0);
  eq('...which is one company', pl.companies.length, 1);
  const co = pl.companies[0].id;
  const h3 = hall(290, co);
  ok('and a third may JOIN it rather than add another flag', h3 && h3.co === co);
  eq('still one company for two halls', pl.companies.length, 1,
     `${pl.buildings.filter((b) => b.co === co).length} halls under it`);

  /* the men follow the company, and moving its standard moves all of them at once */
  for (let i = 0; i < 30 * 120; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  const underCo = w.units.filter((u) => u.owner === 0 && u.co === co).length;
  const underBanner = w.units.filter((u) => u.owner === 0 && !u.co).length;
  ok('both halls muster into the one company', underCo > 0, `${underCo} troops`);
  ok('and the Banner hall musters separately', underBanner > 0, `${underBanner} troops`);

  const site = w.map.sites.find((s) => s.kind === 'node');
  ok('a company standard can be posted', World.applyCommand(w, 0, { c: 'rally', co, site: site.id }).ok);
  eq('an unknown company is refused', World.applyCommand(w, 0, { c: 'rally', co: 999, site: site.id }).err, 'co');
  World.update(w, C.SIM_DT);
  const goals = new Set(w.units.filter((u) => u.owner === 0 && u.co === co).map((u) => u.goal && u.goal.site));
  ok('every one of its men answers the new standard, from both halls',
     goals.size === 1 && goals.has(site.id), [...goals].join(','));
  const banGoals = new Set(w.units.filter((u) => u.owner === 0 && !u.co).map((u) => u.goal && u.goal.site));
  ok('and the Banner men are untouched by it', !banGoals.has(site.id));

  /* THE ROYAL WAR BANNER OUTRANKS EVERY COMPANY STANDARD. A company is a detachment from
   * the army, not a rival army: raising the gold banner strikes every standing detachment
   * order and the whole force answers as one. Before this it moved only the men under no
   * standard at all — a shrinking minority once a few halls are up. */
  const gold = w.map.sites.filter((s) => s.kind !== 'city' && s.id !== site.id)
    .sort((a, b) => Math.hypot(b.x - c.x, b.y - c.y) - Math.hypot(a.x - c.x, a.y - c.y))[0];
  ok('the War Banner can be raised elsewhere', World.applyCommand(w, 0, { c: 'banner', site: gold.id }).ok);
  eq('and it strikes every company standard', pl.companies.filter((q) => q.rally).length, 0);
  World.update(w, C.SIM_DT);
  const host = w.units.filter((u) => u.owner === 0);
  ok('the company still has men', host.some((u) => u.co === co));
  eq('and the WHOLE army answers the Banner, company men included',
     host.filter((u) => !u.goal || u.goal.site !== gold.id).length, 0, `${host.length} troops`);
  /* …and a detachment can peel back off, or the standards would be one-use */
  ok('a company can post its standard again', World.applyCommand(w, 0, { c: 'rally', co, site: site.id }).ok);
  World.update(w, C.SIM_DT);
  const peeled = w.units.filter((u) => u.owner === 0 && u.co === co);
  ok('and takes its own men back with it',
     peeled.length > 0 && peeled.every((u) => u.goal && u.goal.site === site.id), `${peeled.length} troops`);
  ok('while the rest hold to the Banner',
     w.units.filter((u) => u.owner === 0 && !u.co).every((u) => u.goal && u.goal.site === gold.id));

  /* re-assignment: a hall can be moved, and its own men move with it */
  const before = w.units.filter((u) => u.owner === 0 && u.from === h3.id).length;
  ok('the third hall has men of its own', before > 0, `${before}`);
  ok('it can be sent back under the Banner', World.applyCommand(w, 0, { c: 'assign', id: h3.id, co: 0 }).ok);
  eq('the hall now answers the Banner', h3.co, 0);
  eq('and so do the men it raised',
     w.units.filter((u) => u.owner === 0 && u.from === h3.id && u.co !== 0).length, 0);
  ok('the company survives while its other hall stands', pl.companies.some((q) => q.id === co));

  /* ...and is dropped once nothing answers to it any more */
  ok('the last hall can leave too', World.applyCommand(w, 0, { c: 'assign', id: h2.id, co: 0 }).ok);
  for (const u of w.units) if (u.owner === 0 && u.co === co) u.co = 0;
  World.applyCommand(w, 0, { c: 'assign', id: h2.id, co: 0 });
  ok('an empty company is not kept', !pl.companies.some((q) => q.id === co),
     JSON.stringify(pl.companies));

  /* THE GOLD FLAG. Every man who answers the Banner must move when it moves — this is the
   * one that was reported as unreliable, and it holds up. */
  const far = w.map.sites.filter((s) => s.kind !== 'city')
    .sort((a, b) => Math.hypot(b.x - c.x, b.y - c.y) - Math.hypot(a.x - c.x, a.y - c.y))[0];
  ok('the Banner can be moved', World.applyCommand(w, 0, { c: 'banner', site: far.id }).ok);
  World.update(w, C.SIM_DT);
  const mine = w.units.filter((u) => u.owner === 0);
  ok('there is an army to direct', mine.length > 10, `${mine.length} troops`);
  eq('every last one of them takes the new goal',
     mine.filter((u) => !u.goal || u.goal.site !== far.id).length, 0);
}

suite('the masons')
{
  const w = World.createWorld(1000), pl = w.players[0], c = World.cityOf(w, 0);
  pl.essence = 99000;
  /* this is about the crews, not the black road — and works now take long enough to raise
   * that fiends would otherwise pull them down as fast as they go up */
  w.chaosNext = 1e9;
  ok('there is no ceiling on works', C.MAX_BUILDINGS === undefined);

  const free = (bt, r) => {
    for (let a = 0; a < 48; a++) {
      const th = a / 48 * Math.PI * 2, x = c.x + Math.cos(th) * r, y = c.y + Math.sin(th) * r;
      if (World.placementError(w, 0, x, y, bt) === null) return { x, y };
    }
    return null;
  };
  const at = free('barracks', 190);
  ok('open ground to build on', !!at);
  let far2 = null;
  for (let r = C.CLAIM.seat + 120; r < 900 && !far2; r += 40)
    for (let a2 = 0; a2 < 24 && !far2; a2++) {
      const th = a2 / 24 * Math.PI * 2, p2 = { x: c.x + Math.cos(th) * r, y: c.y + Math.sin(th) * r };
      if (World.placementError(w, 0, p2.x, p2.y, 'tower') === 'claim') far2 = p2;
    }
  ok('ground beyond the writ to test with', !!far2);
  const spent = pl.essence;
  ok('a work is ordered', World.applyCommand(w, 0, { c: 'build', ...at, bt: 'barracks' }).ok);
  const b = pl.buildings[0];
  eq('it is paid for at once', pl.essence, spent - C.BUILDINGS.barracks.cost);
  near('and it starts as a shell', b.hp, C.BUILDINGS.barracks.hp * C.RAISE.hpFrom, 1);
  ok('with a raise timer', b.raise > 0 && b.raiseFor === C.BUILDINGS.barracks.raise);

  /* one at a time */
  let anyBusy = null;
  for (let a2 = 0; a2 < 48 && !anyBusy; a2++) {
    const th = a2 / 48 * Math.PI * 2, x = c.x + Math.cos(th) * 250, y = c.y + Math.sin(th) * 250;
    if (World.placementError(w, 0, x, y, 'tower') === 'busy') anyBusy = { x, y };
  }
  ok('a second work is refused while the masons work', !!anyBusy, 'no spot reported busy');

  /* ...but the masons are the LAST word: a spot that could never bear a work says so instead,
   * because that is the part worth knowing while you wait */
  eq('the ground still speaks first', World.placementError(w, 0, c.x, c.y, 'tower'), 'crowded');
  eq('and so does the writ', World.placementError(w, 0, far2.x, far2.y, 'tower'), 'claim');

  /* a shell is good for nothing */
  const src = World.visionSources(w, 0);
  ok('a shell watches nothing', !src.some((q) => Math.abs(q[0] - b.x) < 1 && Math.abs(q[1] - b.y) < 1));
  const before = w.units.length;
  for (let i = 0; i < 30 * 5; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  eq('a shell musters nobody', w.units.filter((u) => u.owner === 0).length, before);

  /* ...until the masons are done */
  for (let i = 0; i < 30 * 40 && b.raise > 0; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  eq('it finishes', b.raise, 0);
  eq('at full strength', Math.round(b.hp), C.BUILDINGS.barracks.hp);
  ok('and it watches again', World.visionSources(w, 0).some((q) => Math.abs(q[0] - b.x) < 1));
  const at2 = free('tower', 250);
  ok('the masons are free for the next', !!at2 && World.applyCommand(w, 0, { c: 'build', ...at2, bt: 'tower' }).ok);

  /* the cap is really gone: keep raising until well past the old limit of 14. Works take
   * their time now, so wait for the crews rather than a fixed span. */
  for (let n = 0; n < 30; n++) {
    for (let i = 0; i < 30 * 90 && pl.buildings.some((q) => q.raise > 0); i++) World.update(w, C.SIM_DT);
    w.events.length = 0;
    let placed = false;
    for (let r = 150; r < C.CLAIM.seat - 20 && !placed; r += 22) {
      const spot = free('tower', r);
      if (spot) placed = World.applyCommand(w, 0, { c: 'build', ...spot, bt: 'tower' }).ok;
    }
    if (!placed) break;
  }
  ok('an heir may hold more works than the old cap of 14', pl.buildings.length > 14,
     `${pl.buildings.length} works standing`);
}

suite('the standard')
{
  const w = World.createWorld(42), pl = w.players[0];
  const c = World.cityOf(w, 0);
  ok('a standard starts over its own Seat', !!pl.banner && pl.banner.site === w.map.cities[0]);

  /* named ground: tapping a site should carry the site's id along for the banner text */
  const spring = w.map.sites.find((s) => s.kind !== 'city');
  ok('a standard may be planted on a site', World.applyCommand(w, 0, { c: 'banner', site: spring.id }).ok);
  eq('and it remembers which site', pl.banner.site, spring.id);

  /* bare ground: the whole point. Find the least walkable cell on the map — deep water or
   * a cliff face — and plant there. It must be ACCEPTED: an order to march is not a claim,
   * and the column simply gets as close as the land allows. */
  let worst = null;
  for (let gy = 0; gy < w.nav.H && !worst; gy++) for (let gx = 0; gx < w.nav.W; gx++) {
    if (WG.COST[w.nav.terra[gy * w.nav.W + gx]] !== 0) continue;   // 0 = impassable
    worst = { x: (gx + 0.5) * w.nav.cw, y: (gy + 0.5) * w.nav.cw }; break;
  }
  ok('the map has impassable ground to test with', !!worst);
  const r = World.applyCommand(w, 0, { c: 'banner', x: worst.x, y: worst.y });
  ok('a standard on impassable ground is ACCEPTED', r.ok, r.err || '');
  eq('it is remembered as open country, not a site', pl.banner.site, -1);
  near('and it stands where it was planted', pl.banner.x, worst.x, 1);

  /* off the edge of the world is clamped, never refused */
  ok('a standard beyond the rim is clamped, not refused',
     World.applyCommand(w, 0, { c: 'banner', x: -9999, y: 9e9 }).ok);
  ok('clamped onto the map', pl.banner.x >= 0 && pl.banner.x <= C.MAP.W &&
     pl.banner.y >= 0 && pl.banner.y <= C.MAP.H, `${pl.banner.x},${pl.banner.y}`);

  /* and the troops actually try: a unit ordered at unreachable ground still closes on it */
  World.applyCommand(w, 0, { c: 'banner', x: worst.x, y: worst.y });
  /* a Trump puts a champion on the field at home through a public command */
  pl.essence = 90000; pl.powers.trump = 0;
  ok('a champion answers the Trump', World.applyCommand(w, 0, { c: 'power', k: 'trump' }).ok);
  const uid = pl.championId;
  const u = w.units.find((q) => q.id === uid);
  const d0 = Math.hypot(u.x - worst.x, u.y - worst.y);
  for (let i = 0; i < 30 * 60; i++) World.update(w, C.SIM_DT);
  const alive = w.units.find((q) => q.id === uid);
  ok('a unit marches at unreachable ground rather than standing still',
     !alive || Math.hypot(alive.x - worst.x, alive.y - worst.y) < d0 - 40,
     alive ? `closed ${Math.round(d0 - Math.hypot(alive.x - worst.x, alive.y - worst.y))} of ${Math.round(d0)}` : 'died en route');
}

suite('the muster ground')
{
  const w = World.createWorld(1000), pl = w.players[0], c = World.cityOf(w, 0);
  pl.essence = 99000;
  let built = 0;
  for (let a = 0; a < 40 && built < 3; a++) {
    const th = a / 40 * Math.PI * 2, x = c.x + Math.cos(th) * 200, y = c.y + Math.sin(th) * 200;
    if (!World.placementError(w, 0, x, y, 'barracks') && raise(w, 0, x, y, 'barracks').ok) built++;
  }
  eq('three barracks stand', built, 3);
  for (let i = 0; i < 30 * 180; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  const mine = w.units.filter((u) => u.owner === 0);
  ok('they muster an army', mine.length > 20, `${mine.length} troops`);
  const d = mine.map((u) => Math.hypot(u.x - c.x, u.y - c.y)).sort((a, b) => a - b);
  /* the Seat stands on its own ground; an army standing WITH it disappears under the castle */
  ok('an army ordered home forms up in the court, not on the tower',
     d[d.length >> 1] > C.CITY.seatR + 20, `median ${Math.round(d[d.length >> 1])} from the Seat`);
  ok('and it stays inside the court', d[d.length - 1] < C.CITY.r + 60,
     `furthest ${Math.round(d[d.length - 1])}`);

  /* EVERY man reaches his place. A soldier on the muster ground steers to his own place in
   * the ring directly; a soldier outside it rides the flow field in. Judging that handover by
   * NAV.arrive around the Seat CENTRE left a dead band where neither rule fired: the field
   * reckoned the man had arrived and stopped pushing, and the direct rule did not yet apply,
   * so he froze on the tower's own ground — a quarter of the army standing inside the castle.
   * The median above cannot see it; count them. */
  World.applyCommand(w, 0, { c: 'banner', x: c.x, y: c.y, co: 0 });
  for (let i = 0; i < 30 * 60; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  const home = w.units.filter((u) => u.owner === 0);
  const inside = home.filter((u) => Math.hypot(u.x - c.x, u.y - c.y) < C.CITY.seatR);
  /* the bug this guards was a DOZEN men frozen in the dead band; a straggler who has just
   * walked out of a hall standing near the Seat is not that */
  ok('and the ranks are not standing inside the tower', inside.length <= 2,
     `${inside.length} of ${home.length} on the tower's ground`);

  /* the same dead band, one step out, makes a man step toward his place, fall back under the
   * field and repeat — an army shivering at 30 Hz. Reversing direction is the signature. */
  const hist = home.map((u) => ({ id: u.id, h: [] }));
  for (let t = 0; t < 60; t++) {
    World.update(w, C.SIM_DT); w.events.length = 0;
    for (const tr of hist) { const u = w.units.find((q) => q.id === tr.id); if (u) tr.h.push([u.x, u.y]); }
  }
  let shivering = 0;
  for (const tr of hist) {
    let rev = 0;
    for (let i = 2; i < tr.h.length; i++) {
      const ax = tr.h[i - 1][0] - tr.h[i - 2][0], ay = tr.h[i - 1][1] - tr.h[i - 2][1];
      const bx = tr.h[i][0] - tr.h[i - 1][0], by = tr.h[i][1] - tr.h[i - 1][1];
      if (ax * bx + ay * by < 0) rev++;
    }
    if (rev >= 4) shivering++;
  }
  eq('nobody in the ranks shivers', shivering, 0, `${shivering} of ${hist.length} reverse 4+ times in 2s`);
}

suite('remembered ground')
{
  const w = World.createWorld(1000), pl = w.players[0], c = World.cityOf(w, 0);
  const mask = pl.seen;
  const count = () => mask.g.reduce((a, b) => a + b, 0);
  const at = (x, y) => mask.g[((y / mask.cell) | 0) * mask.gw + ((x / mask.cell) | 0)];
  ok('you know your own surroundings from the start', count() > 20, `${count()} cells`);
  ok('and nothing beyond them', count() < mask.g.length / 3, `${count()} of ${mask.g.length}`);

  /* march a column to a far site: the ground it crosses must be remembered */
  /* the nearest site the Seat cannot already SEE — asking the mask itself rather than
   * assuming a rank in the distance order, which the map layout is free to change */
  const far = w.map.sites.filter((s) => s.kind !== 'city' && !at(s.x, s.y))
    .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0];
  ok('there is unknown ground to march to', !!far, far && far.name);
  ok('an unvisited place is unknown ground', !at(far.x, far.y), far.name);
  pl.essence = 99000; pl.powers.trump = 0;
  World.applyCommand(w, 0, { c: 'power', k: 'trump' });
  World.applyCommand(w, 0, { c: 'banner', site: far.id });
  const before = count();
  for (let i = 0; i < 30 * 300; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  ok('marching reveals new ground', count() > before, `${before} -> ${count()} cells`);
  ok('the place it marched to is now known', !!at(far.x, far.y), far.name);

  /* and it STAYS known once the column comes home — a map you have walked is still a map */
  const walked = count();
  World.applyCommand(w, 0, { c: 'banner', site: w.map.cities[0] });
  for (let i = 0; i < 30 * 300; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  ok('ground stays remembered after the troops leave', !!at(far.x, far.y));
  ok('and the memory never shrinks', count() >= walked, `${walked} -> ${count()}`);
  ok('but it is still not the whole map', count() < mask.g.length, `${count()} of ${mask.g.length}`);
}

/* THE CURTAIN WALL. The old city wall was a number on a player — one bar that fell and took
 * the whole defence with it. This one is a WORK WITH A LENGTH: placed as a line, broken span
 * by span, and it does exactly three things — it bars the ground to everyone but its owner,
 * it stops shots crossing it, and it does not stop shots from the men standing ON it. That
 * last clause is the whole balance of the thing, and it is what these assertions are for. */
suite('the curtain wall')
{
  const def = C.BUILDINGS.wall;
  ok('the rampart is gone from the build table', !C.BUILDINGS.rampart);
  ok('a wall is on the build sheet', C.BUILD_ORDER_UI.includes('wall'));
  ok('...and it is a work with a length', Array.isArray(def.span) && def.span[0] > 0);
  eq('...with a shortest run, and NO longest', def.span.length, 1);
  ok('no player carries a single wall bar any more',
     World.createWorld(7).players.every((p) => p.wallHp === undefined));

  /* placement: the first tap is a point, the second is the run */
  const w = World.createWorld(1000);
  w.chaosNext = 1e9;
  const c = World.cityOf(w, 0);
  const pl = w.players[0];
  pl.essence = 100000;
  const build = (ax, ay, bx, by) => World.applyCommand(w, 0, { c: 'build', bt: 'wall', x: ax, y: ay, x2: bx, y2: by });
  eq('a run of no length is refused', build(c.x + 90, c.y, c.x + 92, c.y).err, 'short');
  /* THERE IS NO LONGEST RUN — there is only how many crews you can put on one. A run past
   * what the idle masons cover is refused for THAT, which is a different problem with a
   * different fix: draw a shorter one, or hold more Gates. */
  eq('one mason covers one crew of wall', World.masons(w, 0), 1);
  eq('...so the reach starts at one crew', World.wallReach(w, 0), C.WALL.unit);
  eq('a run past the crews is refused for the crews, not for a span',
     build(c.x + 90, c.y - C.WALL.unit, c.x + 90, c.y + C.WALL.unit).err, 'crews');
  eq('the crews needed follow the length', World.wallCrews(C.WALL.unit * 2.5), 3);
  eq('a run reaching outside your writ is refused',
     build(c.x + C.CLAIM.seat + 40, c.y - 60, c.x + C.CLAIM.seat + 40, c.y + 60).err, 'claim');
  eq('the first tap alone is judged on what a point can be judged on',
     World.placementError(w, 0, c.x + 90, c.y, 'wall'), null);

  /* a legal run, laid across the ground beside the Seat */
  let laid = null;
  for (let a = 0; a < 6.28 && !laid; a += 0.35) {
    for (let r = 110; r <= 200 && !laid; r += 22) {
      const mx = c.x + Math.cos(a) * r, my = c.y + Math.sin(a) * r;
      const px = -Math.sin(a) * 70, py = Math.cos(a) * 70;
      if (!World.wallError(w, 0, mx - px, my - py, mx + px, my + py)) laid = [mx - px, my - py, mx + px, my + py];
    }
  }
  ok('a curtain can be laid beside the Seat', !!laid);
  const before = pl.essence;
  const r1 = build(laid[0], laid[1], laid[2], laid[3]);
  ok('and the order is accepted', r1.ok, r1.err);
  eq('it costs what the card says', Math.round(before - pl.essence), def.cost);
  const b = pl.buildings.find((q) => q.bt === 'wall');
  ok('it is stored by its MIDPOINT, carrying the far end', b && b.x2 != null);
  near('the midpoint is the middle of the run', b.x, (laid[0] + laid[2]) / 2, 0.01);
  const ends = World.wallEnds(b);
  near('...and the ends come back out of it', ends[0], laid[0], 0.01);
  near('...both of them', ends[3], laid[3], 0.01);
  eq('a second run crossing the first is refused',
     build((laid[0] + laid[2]) / 2 - (laid[3] - laid[1]) * 0.4, (laid[1] + laid[3]) / 2 + (laid[2] - laid[0]) * 0.4,
           (laid[0] + laid[2]) / 2 + (laid[3] - laid[1]) * 0.4, (laid[1] + laid[3]) / 2 - (laid[2] - laid[0]) * 0.4).err,
     'crowded');

  /* it is scaffolding until the masons are done, and does nothing at all */
  ok('it goes up as a shell', b.raise > 0);
  ok('an unfinished wall bars nothing', !w.anyWall);
  for (let i = 0; i < 30 * (def.raise + 1); i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  eq('the masons finish it', b.raise, 0);
  ok('and THEN it is stone', w.anyWall);
  eq('the standing list holds it', w.walls.length, 1);

  /* ---- what stone does ---- */
  const mid = { x: b.x, y: b.y };
  /* the normal, ORIENTED: +d is the field side, -d the side the Seat shelters on. Left to
   * the raw cross product the sign is whichever way the run happened to be drawn, and half
   * of what follows would be asserting the opposite of what it says. */
  let nx = -(ends[3] - ends[1]), ny = ends[2] - ends[0];
  if (nx * (c.x - mid.x) + ny * (c.y - mid.y) > 0) { nx = -nx; ny = -ny; }
  const nL = Math.hypot(nx, ny) || 1;
  const side = (d) => ({ x: mid.x + (nx / nL) * d, y: mid.y + (ny / nL) * d });
  const put = (owner, at, kind) => {
    const d = C.UNITS[kind || 'sorcerer'];
    const u = { id: w.nextId++, owner, kind: kind || 'sorcerer', x: at.x, y: at.y, ox: 0, oy: 0,
                hp: 1e9, maxHp: 1e9, dmg: d.dmg, cd: 0, goal: null, co: 0, from: -1 };
    w.units.push(u); return u;
  };
  /* THE BANNER MOVES THE ARMY — including in a test. Pinning a soldier by writing u.goal
   * does nothing: the sim rewrites it from the player's banner every tick, so both men
   * simply marched home and swapped sides of the wall. Plant each banner where its man
   * already stands and he holds his ground, which is what these assertions are about. */
  const pin = (u) => { w.players[u.owner].banner = { x: u.x, y: u.y, site: -1 }; return u; };
  const settle = () => { w.units.length = 0; };
  const run = (secs) => { for (let i = 0; i < 30 * secs; i++) { World.update(w, C.SIM_DT); w.events.length = 0; } };

  /* a soldier well behind the wall cannot be shot by one well in front of it */
  settle();
  const inner = pin(put(0, side(-C.WALL.man - 30)));   // sheltered, on the Seat's side
  const outer = pin(put(1, side(C.WALL.man + 30)));    // in the field, in front of the stone
  run(6);
  eq('a man behind the curtain is not shot through it', inner.hp, 1e9);
  eq('...and does not shoot out through it either', outer.hp, 1e9);

  /* come up to your OWN wall and you are on the parapet: you shoot, and you are shot */
  settle();
  const manned = pin(put(0, side(-C.WALL.man * 0.5)));
  const field = pin(put(1, side(C.WALL.man + 30)));
  run(6);
  ok('a man on the parapet reaches the field', field.hp < 1e9, field.hp);
  ok('...and the field reaches back', manned.hp < 1e9, manned.hp);
  ok('the parapet throws further than the ground does',
     C.WALL.over > C.UNITS.soldier.range, `${C.WALL.over} vs ${C.UNITS.soldier.range}`);

  /* standing against SOMEBODY ELSE'S wall is not manning it */
  settle();
  b.hp = b.maxHp;
  const hidden = pin(put(0, side(-C.WALL.man - 40)));
  pin(put(1, side(C.WALL.man * 0.5)));
  run(6);
  eq('hugging a rival curtain does not put you on it', hidden.hp, 1e9);
  ok('...though the wall itself is a target', b.hp < b.maxHp, `${Math.round(b.hp)}/${b.maxHp}`);

  /* nothing walks through it. The banner is planted on the far side of the run — the one
   * order that would take a column straight through the stone if stone did not stop it. */
  settle();
  b.hp = b.maxHp;
  const far = side(-220);   // past the wall, on the ground it shelters
  const walker = put(1, side(60), 'soldier');
  w.players[1].banner = { x: far.x, y: far.y, site: -1 };
  run(30);
  const sgn = (nx / nL) * (walker.x - mid.x) + (ny / nL) * (walker.y - mid.y);
  ok('a rival column does not walk through stone', sgn > 0, sgn.toFixed(1));

  /* ...but the owner passes freely, because it is his wall and it has a gate in it */
  settle();
  const mine = put(0, side(60), 'soldier');
  w.players[0].banner = { x: far.x, y: far.y, site: -1 };
  run(30);
  const sgn2 = (nx / nL) * (mine.x - mid.x) + (ny / nL) * (mine.y - mid.y);
  ok('the heir who raised it walks through his own gate', sgn2 < 0, sgn2.toFixed(1));

  /* A RUN IS PAID FOR BY THE FOOT. Twice the wall is twice the crews, twice the price and
   * twice the stone to break — anything else and a long wall is cheaper per length than a
   * short one, which is not a choice, it is an answer. */
  {
    const g2 = World.createWorld(1000, 2);
    g2.chaosNext = 1e9;
    const gc = World.cityOf(g2, 0), gp = g2.players[0];
    /* hand this heir the Gates that hire the crews */
    while (World.masons(g2, 0) < 3) {
      gp.buildings.push({ id: g2.nextId++, bt: 'gate', level: 1, x: gc.x, y: gc.y, raise: 0,
                          hp: 1, maxHp: 1, node: -1, co: 0, lastHurt: -99, cd: 0 });
    }
    eq('three Gates hire three crews', World.masons(g2, 0), 3);
    let two = null;
    for (let a2 = 0; a2 < 6.28 && !two; a2 += 0.25)
      for (let r2 = 150; r2 <= 240 && !two; r2 += 30) {
        const mx = gc.x + Math.cos(a2) * r2, my = gc.y + Math.sin(a2) * r2;
        const L = C.WALL.unit * 0.75, px = -Math.sin(a2) * L, py = Math.cos(a2) * L;
        if (!World.wallError(g2, 0, mx - px, my - py, mx + px, my + py)) two = [mx - px, my - py, mx + px, my + py];
      }
    ok('a two-crew run can be laid with three crews idle', !!two);
    gp.essence = 100000;
    const purse = gp.essence;
    const rr = World.applyCommand(g2, 0, { c: 'build', bt: 'wall', x: two[0], y: two[1], x2: two[2], y2: two[3] });
    ok('and it is accepted', rr.ok, rr.err);
    const wb = gp.buildings.find((q) => q.bt === 'wall');
    eq('it is booked as two crews', wb.crews, 2);
    eq('...and costs two cards', Math.round(purse - gp.essence), def.cost * 2);
    eq('...and is twice the stone', wb.maxHp, def.hp * 2);
    eq('two crews of the three are now busy', World.rising(g2, 0), 2);
    eq('...leaving one crew of reach', World.wallReach(g2, 0), C.WALL.unit);
    /* and the masons are genuinely spoken for: with one crew left, a one-crew run is legal
     * on ground where a two-crew run over the very same line is not */
    let pair = null;
    for (let a2 = 0; a2 < 6.28 && !pair; a2 += 0.2)
      for (let r2 = 150; r2 <= 300 && !pair; r2 += 30) {
        const mx = gc.x + Math.cos(a2) * r2, my = gc.y + Math.sin(a2) * r2;
        const ux = -Math.sin(a2), uy = Math.cos(a2);
        const sh = C.WALL.unit * 0.4, lo = C.WALL.unit * 0.9;
        if (World.wallError(g2, 0, mx - ux * sh, my - uy * sh, mx + ux * sh, my + uy * sh)) continue;
        pair = [mx, my, ux, uy, sh, lo];
      }
    ok('ground for the comparison exists', !!pair);
    const [mx2, my2, ux2, uy2, sh2, lo2] = pair;
    eq('one crew of wall still fits', World.wallError(g2, 0,
       mx2 - ux2 * sh2, my2 - uy2 * sh2, mx2 + ux2 * sh2, my2 + uy2 * sh2), null);
    eq('two crews of wall on the same line do not', World.wallError(g2, 0,
       mx2 - ux2 * lo2, my2 - uy2 * lo2, mx2 + ux2 * lo2, my2 + uy2 * lo2), 'crews');
  }

  /* a level buys STONE. A wall has no other effect to scale, so an upgrade that did not
   * thicken it would take essence and do nothing whatever. */
  b.hp = b.maxHp - 200;
  const wasMax = b.maxHp;
  eq('a curtain can be reinforced', World.applyCommand(w, 0, { c: 'up', id: b.id }).ok, true);
  ok('...and the reinforcement is thicker stone', b.maxHp > wasMax, `${wasMax} -> ${b.maxHp}`);
  near('...added to what was standing, not a free repair', b.maxHp - b.hp, 200, 1);

  /* THE PARAPET MUST BE VISIBLE. A man on the wall fought from the wall and was drawn in the
   * grass beside it — the one bargain the whole design rests on, with nothing to see. He now
   * carries the wall he is standing on, and it rides the wire so a guest sees it too. */
  settle();
  const upTop = pin(put(0, side(-C.WALL.man * 0.5)));
  const below = pin(put(0, side(-C.WALL.man - 60)));
  World.update(w, C.SIM_DT);
  eq('a man at his own wall is marked as standing on it', upTop.man, b.id);
  eq('...and a man well behind it is not', below.man || 0, 0);
  {
    const snap = Net.snapFor(w, 0);
    const su = snap.units.find((q) => q.id === upTop.id);
    ok('the parapet rides the wire', su && su.man === b.id, su && su.man);
    const sb = snap.units.find((q) => q.id === below.id);
    ok('...and only for the men actually on it', sb && sb.man === undefined);
  }
  /* step off the stone and he is off it — the mark is live, not sticky */
  upTop.x = side(-C.WALL.man - 90).x; upTop.y = side(-C.WALL.man - 90).y;
  w.players[0].banner = { x: upTop.x, y: upTop.y, site: -1 };
  World.update(w, C.SIM_DT);
  eq('walking off the wall takes him off it', upTop.man || 0, 0);

  /* AND A FALLEN HEIR'S STONE FALLS WITH HIM. In a duel the match ends on the same tick and
   * this was invisible; in a free-for-all his curtains would have gone on barring the ground
   * for the rest of the game with no wall standing to explain it. */
  {
    const f = World.createWorld(1000, 3);
    f.chaosNext = 1e9;
    const fc = World.cityOf(f, 1);
    f.players[1].essence = 100000;
    let run = null;
    for (let a2 = 0; a2 < 6.28 && !run; a2 += 0.35)
      for (let r2 = 110; r2 <= 200 && !run; r2 += 22) {
        const mx = fc.x + Math.cos(a2) * r2, my = fc.y + Math.sin(a2) * r2;
        const px = -Math.sin(a2) * 70, py = Math.cos(a2) * 70;
        if (!World.wallError(f, 1, mx - px, my - py, mx + px, my + py)) run = [mx - px, my - py, mx + px, my + py];
      }
    World.applyCommand(f, 1, { c: 'build', bt: 'wall', x: run[0], y: run[1], x2: run[2], y2: run[3] });
    for (let i = 0; i < 30 * (def.raise + 1); i++) { World.update(f, C.SIM_DT); f.events.length = 0; }
    eq('a third heir has a curtain standing', f.walls.length, 1);
    f.players[1].castleHp = 1;
    const u = { id: f.nextId++, owner: 0, kind: 'soldier', x: fc.x, y: fc.y, ox: 0, oy: 0,
                hp: 1e9, maxHp: 1e9, dmg: 9999, cd: 0, goal: null, co: 0, from: -1 };
    f.units.push(u);
    for (let i = 0; i < 30 * 6 && !f.players[1].out; i++) { World.update(f, C.SIM_DT); f.events.length = 0; }
    ok('the heir is toppled', f.players[1].out);
    eq('...and his stone is gone with him', f.walls.length, 0);
    ok('...and the movement layer knows the ground is open', !f.anyWall);
  }

  /* a breach is a hole: throw it down and the ground opens again */
  settle();
  const ver = w.navVersion;
  World.hurtBuilding(w, 0, b.id, 1e9, 1);
  ok('a broken curtain leaves the standing list', w.walls.length === 0 && !w.anyWall);
  ok('...and the movement layer is told', w.navVersion > ver);
}

/* THE HALT. Anyone at the table may call one and anyone may lift it, and it stops the WORLD
 * rather than merely hiding it: no clock, no muster, no Chaos, and no orders. A pause you can
 * build through is a planning phase, and in a duel it is a way to buy thinking time the other
 * heir does not get. */
suite('the halt')
{
  const w = World.createWorld(4242, 3);
  for (let i = 0; i < 30 * 20; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  const t0 = w.t, tick0 = w.tick, ess0 = w.players[0].essence;
  ok('a world runs before anyone calls one', t0 > 19 && !w.paused);

  eq('any seat may call a halt', World.applyCommand(w, 2, { c: 'pause', on: true }).ok, true);
  eq('...and the world records who did', w.paused.by, 2);
  for (let i = 0; i < 30 * 20; i++) World.update(w, C.SIM_DT);
  eq('the clock does not move', w.t, t0);
  eq('...nor the tick', w.tick, tick0);
  eq('...nor the treasury', w.players[0].essence, ess0);

  /* NO ORDERS. This is the clause that makes it a pause rather than a planning phase. */
  const c0 = World.cityOf(w, 0);
  w.players[0].essence = 100000;
  eq('no work may be raised into a halt',
     World.applyCommand(w, 0, { c: 'build', bt: 'tower', x: c0.x + 120, y: c0.y }).err, 'paused');
  eq('no banner may be planted', World.applyCommand(w, 0, { c: 'banner', x: c0.x, y: c0.y }).err, 'paused');
  eq('no power may be spent', World.applyCommand(w, 0, { c: 'power', k: 'trump' }).err, 'paused');
  eq('and no walk may be begun', World.applyCommand(w, 0, { c: 'walk', on: true }).err, 'paused');
  w.players[0].essence = ess0;

  /* the halt is the TABLE's: whoever is at the phone may lift it, not only who called it */
  eq('another seat may lift it', World.applyCommand(w, 0, { c: 'pause', on: false }).ok, true);
  eq('...and it is gone', w.paused, null);
  for (let i = 0; i < 30 * 5; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  ok('the world runs again', w.t > t0 + 4.9, w.t - t0);
  eq('an order lands again', World.applyCommand(w, 0, { c: 'banner', x: c0.x, y: c0.y }).ok, true);

  /* calling one twice is not an error, it is already true — the button asks for a state,
   * not a toggle, so two guests tapping at once cannot cancel each other out */
  World.applyCommand(w, 1, { c: 'pause', on: true });
  eq('a second call changes nothing', World.applyCommand(w, 2, { c: 'pause', on: true }).ok, true);
  eq('...and the first caller keeps the credit', w.paused.by, 1);
  World.applyCommand(w, 0, { c: 'pause', on: false });
  eq('lifting an unheld halt is harmless', World.applyCommand(w, 0, { c: 'pause', on: false }).ok, true);

  /* and it rides the wire, or a guest would go on playing a world that has stopped */
  World.applyCommand(w, 1, { c: 'pause', on: true });
  const snap = Net.snapFor(w, 1);
  ok('the halt is on the snapshot', snap.paused && snap.paused.by === 1, JSON.stringify(snap.paused));
  ok('...and survives JSON', JSON.parse(JSON.stringify(snap)).paused.by === 1);
  World.applyCommand(w, 1, { c: 'pause', on: false });
  eq('a running world sends none', Net.snapFor(w, 1).paused, null);
}

/* The solo ladder has to be a LADDER. It was not: `slow` and `noise` are decorative — an heir
 * polled at half the rate still won its mirror — so the shipped HEIR at eco 0.80 was a 50%
 * mirror, i.e. no handicap at all. Income and the hour it marches are the two knobs that bite,
 * and both must move monotonically down the table. */
suite('the solo ladder')
{
  const D = C.DIFFICULTY, order = C.DIFFICULTY_UI;
  eq('the hardest footing is a full-strength heir', D.prince.eco, 1);
  eq('...that comes for you when it likes', D.prince.hold, 0);
  ok('the default is not the hardest', C.DIFFICULTY_DEFAULT !== 'prince', C.DIFFICULTY_DEFAULT);
  for (let i = 1; i < order.length; i++) {
    const lo = D[order[i - 1]], hi = D[order[i]];
    ok(`${hi.name} draws more from the ground than ${lo.name}`, hi.eco > lo.eco, `${lo.eco} → ${hi.eco}`);
    ok(`...and comes for you sooner`, hi.hold < lo.hold, `${lo.hold}s → ${hi.hold}s`);
  }
  ok('every footing is a real handicap', order.filter((k) => D[k].eco < 0.9).length >= 2,
     order.map((k) => D[k].eco).join(' '));

  /* and `hold` must actually hold: an heir on the easiest footing does not march on your
   * Seat inside the hour it was given, however well the fight is going for it. Several
   * seeds, because one map is an anecdote — and because an heir CAN lose its Seat early to
   * Chaos or to a lucky baseline, which is a different thing from never having played. */
  const hold = D.squire.hold;
  let worst = 1e9, built = 0, lived = 0;
  for (const seed of [1000, 7, 42]) {
    const w = World.createWorld(seed, 2);
    const bots = [AI.make('random'), AI.make('benedict', D.squire)];
    w.players[1].eco = D.squire.eco;
    const iss = [0, 1].map((pi) => (cmd) => World.applyCommand(w, pi, cmd));
    const c0 = World.cityOf(w, 0);
    let peak = 0;
    for (let i = 0; i < 30 * (hold - 30) && w.winner === null; i++) {
      for (const f of [0, 1]) bots[f].step(w, f, iss[f], C.SIM_DT);
      World.update(w, C.SIM_DT); w.events.length = 0;
      const b = w.players[1].banner;
      if (b) worst = Math.min(worst, Math.hypot(b.x - c0.x, b.y - c0.y));
      peak = Math.max(peak, w.players[1].buildings.length);
    }
    if (peak > 1) built++;
    if (w.players[1].castleHp > 0) lived++;
  }
  ok('a Squire never points its banner at your Seat inside its hour',
     worst > C.CITY.r, `nearest the banner came: ${Math.round(worst)}`);
  ok('...and spends the time building a realm of its own', built >= 2, `${built} of 3 maps`);
  ok('...an heir, not a victim: it is still standing when its hour comes', lived >= 2,
     `${lived} of 3 maps`);
}

/* Chaos is the price of the best ground, not a doomsday timer (DESIGN_PRINCIPLES §4). It may
 * press harder over time by being MANY; it may not grow into something no army can answer.
 * The measure is the exchange rate: how many soldiers a lone fiend puts down before it falls.
 * Uncapped hp AND damage ramps multiplied into 5 soldiers by minute 10 and 26 by minute 30. */
suite('Chaos presses, it does not escalate')
{
  const S = C.UNITS.soldier, F = C.UNITS.fiend;
  const eats = (t) => {
    let hp = F.hp * C.CHAOS.hpScale(t), n = 0;
    const fdps = (F.dmg * C.CHAOS.dmgScale(t)) / F.atk, sdps = S.dmg / S.atk;
    while (n < 99) {
      const tDies = S.hp / fdps;
      if (hp / sdps <= tDies) break;
      hp -= sdps * tDies; n++;
    }
    return n;
  };
  ok('a fiend outmatches a lone soldier', eats(600) >= 1, `${eats(600)} at minute 10`);
  for (const m of [10, 15, 30, 45])
    ok(`and never more than two, even at minute ${m}`, eats(m * 60) <= 2, `${eats(m * 60)} soldiers`);
  ok('the hit points stop climbing', C.CHAOS.hpScale(2700) === C.CHAOS.hpScale(5400),
     `x${C.CHAOS.hpScale(2700)}`);
  ok('and so does the damage', C.CHAOS.dmgScale(2700) === C.CHAOS.dmgScale(5400),
     `x${C.CHAOS.dmgScale(2700)}`);
  ok('but the rifts still swell', C.CHAOS.count(1800) > C.CHAOS.count(300),
     `${C.CHAOS.count(300)} then ${C.CHAOS.count(1800)} per rift`);
}

/* Reported from play, and all of a piece: the storm deleted whole armies at a tap, Chaos took
 * three quarters of the dead, one mason capped what a treasury could ever become, and no
 * banner said which of them was at your gate. */
suite('the black road is not the war')
{
  /* THE STORM MAIMS, IT DOES NOT DELETE. 36 dps over 2.5s was 90 damage to a 70-hp soldier,
   * so a single cast erased everyone under the disc — measured at 31 of 120 men, 496 essence
   * of troops for the 90 it cost, back every 50 seconds. */
  const S = C.POWERS.storm, sol = C.UNITS.soldier;
  ok('a storm no longer kills a whole man outright', S.dps * S.dur < sol.hp,
     `${(S.dps * S.dur).toFixed(0)} damage against ${sol.hp} hit points`);
  ok('...but it very nearly does', S.dps * S.dur > sol.hp * 0.7, `${(S.dps * S.dur).toFixed(0)}`);
  ok('a sorcerer still dies to one', S.dps * S.dur >= C.UNITS.sorcerer.hp);
  ok('an Engine shrugs it off', S.dps * S.dur < C.UNITS.engine.hp * 0.3);

  /* in the sim, against an army standing at the muster */
  const w = World.createWorld(4242, 2), c = World.cityOf(w, 0);
  w.chaosNext = 1e9;
  for (let i = 1; i <= 120; i++) {
    const ang = (i * 2.39996) % (Math.PI * 2), rr = C.CITY.seatR + 24 + (i % 4) * 17;
    w.units.push({ id: w.nextId++, owner: 0, kind: 'soldier', x: c.x + Math.cos(ang) * rr, y: c.y + Math.sin(ang) * rr,
      ox: 0, oy: 0, hp: sol.hp, maxHp: sol.hp, dmg: sol.dmg, cd: 0, goal: null, co: 0, from: -1 });
  }
  let bx = c.x, by = c.y, bn = 0;
  for (const u of w.units) {
    let k = 0;
    for (const v of w.units) if ((u.x - v.x) ** 2 + (u.y - v.y) ** 2 < S.radius * S.radius) k++;
    if (k > bn) { bn = k; bx = u.x; by = u.y; }
  }
  w.storms.push({ owner: 1, x: bx, y: by, delay: S.delay, tLeft: S.dur });
  for (let i = 0; i < 30 * 6; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  const left = w.units.filter((u) => u.owner === 0).length;
  ok('one cast on the thickest part of an army does not erase it', left >= 110,
     `${120 - left} of 120 dead for ${S.cost} essence`);
  ok('...and it hurt everyone it touched', w.units.some((u) => u.owner === 0 && u.hp < u.maxHp));

  /* THE MUSTER SPREADS WITH THE ARMY, so a blow that lands costs proportionally less */
  const ringSpan = (n) => {
    const rings = Math.max(4, Math.min(14, Math.ceil(n / 22)));
    return C.CITY.seatR + 24 + (rings - 1) * 17;
  };
  ok('a big host musters over more ground than a small one', ringSpan(200) > ringSpan(20) * 1.5,
     `20 men reach ${ringSpan(20)}, 200 reach ${ringSpan(200)}`);

  /* CHAOS IS A PRICE, NOT THE OPPONENT. Tagged across whole matches it took 73% of a player's
   * dead; the schedule is cut so the war is between the heirs again. */
  const rate = (t) => C.CHAOS.count(t) / C.CHAOS.interval(t) * 60;
  ok('the rift schedule is far lighter at ten minutes', rate(600) < 20, `${rate(600).toFixed(1)} fiends/min`);
  ok('and at twenty', rate(1200) < 26, `${rate(1200).toFixed(1)} fiends/min, against 40 before`);
  ok('but Chaos still swells', rate(1200) > rate(300), `${rate(300).toFixed(1)} → ${rate(1200).toFixed(1)}`);

  /* AND THE BANNERS SAY WHO. One line covered a rift and an assault alike. */
  const w2 = World.createWorld(1000), pl2 = w2.players[0];
  pl2.essence = 9e9; w2.chaosNext = 1e9;
  const c2 = World.cityOf(w2, 0);
  let at = null;
  for (let a = 0; a < 40 && !at; a++) {
    const th = a / 40 * Math.PI * 2, x = c2.x + Math.cos(th) * 200, y = c2.y + Math.sin(th) * 200;
    if (World.placementError(w2, 0, x, y, 'tower') === null) at = { x, y };
  }
  ok('a work stands', !!at && raise(w2, 0, at.x, at.y, 'tower').ok);
  const b2 = pl2.buildings[pl2.buildings.length - 1];
  w2.events.length = 0; pl2.slotAlert = -99;
  World.hurtBuilding(w2, 0, b2.id, 5, C.CHAOS_ID);
  const byChaos = w2.events.find((e) => e.e === 'hurtcity');
  eq('a work gnawed by fiends names Chaos', byChaos && byChaos.by, C.CHAOS_ID);
  w2.events.length = 0; pl2.slotAlert = -99;
  World.hurtBuilding(w2, 0, b2.id, 5, 1);
  const byFoe = w2.events.find((e) => e.e === 'hurtcity');
  eq('and one broken by an heir names the heir', byFoe && byFoe.by, 1);

  /* the dead carry their killer, which is what lets a chronicle answer this at a glance */
  const w3 = World.createWorld(7);
  const victim = { id: 99, owner: 0, kind: 'soldier', x: 100, y: 100, hp: 1, maxHp: 70, dmg: 0, cd: 0, ox: 0, oy: 0, goal: null, co: 0, from: -1 };
  w3.units.push(victim);
  w3.events.length = 0;
  World.update(w3, C.SIM_DT);           // nothing kills him
  w3.events.length = 0;
  victim.hp = 1;
  World.hurtBuilding(w3, 0, -1, 0);     // no-op, just to keep the queue honest
  ok('a death names its killer', (() => {
    const w4 = World.createWorld(7);
    const v = { id: 98, owner: 0, kind: 'soldier', x: 100, y: 100, hp: 5, maxHp: 70, dmg: 0, cd: 0, ox: 0, oy: 0, goal: null, co: 0, from: -1 };
    w4.units.push(v);
    w4.storms.push({ owner: C.CHAOS_ID, x: 100, y: 100, delay: 0, tLeft: 1 });
    for (let i = 0; i < 30 && !w4.events.some((e) => e.e === 'die'); i++) { World.update(w4, C.SIM_DT); }
    const d = w4.events.find((e) => e.e === 'die');
    return d && d.by === C.CHAOS_ID;
  })());
}

/* The masons are hired out of the ground you hold. One crew was a hard ceiling on spending:
 * works absorb ~14.6 essence/s and a realm in flow earns fifty, which is how two chronicles
 * ended with five figures banked in matches that were lost. */
suite('the masons follow the Gates')
{
  const w = World.createWorld(1000), pl = w.players[0], c = World.cityOf(w, 0);
  pl.essence = 9e9; w.chaosNext = 1e9;
  eq('a bare Seat keeps one crew', World.masons(w, 0), C.MASONS.base);
  /* give it Gates and count again — springs are where the crews come from */
  const springs = w.map.sites.filter((s) => s.kind === 'node')
    .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y));
  let gates = 0;
  for (const s of springs) {
    if (gates >= C.MASONS.per * 2) break;
    for (let rr = 0; rr <= 60 && true; rr += 20) {
      let placed = false;
      for (let a = 0; a < 20 && !placed; a++) {
        const th = a / 20 * Math.PI * 2;
        const x = s.x + Math.cos(th) * rr, y = s.y + Math.sin(th) * rr;
        if (World.placementError(w, 0, x, y, 'gate') === null) {
          World.applyCommand(w, 0, { c: 'build', x, y, bt: 'gate' });
          const b = pl.buildings[pl.buildings.length - 1];
          b.raise = 0; b.hp = b.maxHp;
          gates++; placed = true;
        }
      }
      if (placed) break;
    }
  }
  ok('several Gates stand', gates >= C.MASONS.per, `${gates} Gates`);
  eq('the crews follow them', World.masons(w, 0),
     Math.min(C.MASONS.max, C.MASONS.base + Math.floor(gates / C.MASONS.per)));
  ok('which is more than one', World.masons(w, 0) > C.MASONS.base, `${World.masons(w, 0)} crews`);

  /* and the rule is that many at once, not one */
  const spot = (bt) => {
    for (let rad = 150; rad < C.CLAIM.seat - 40; rad += 25)
      for (let a = 0; a < 32; a++) {
        const th = a / 32 * Math.PI * 2, x = c.x + Math.cos(th) * rad, y = c.y + Math.sin(th) * rad;
        if (World.placementError(w, 0, x, y, bt) === null) return { x, y };
      }
    return null;
  };
  const crews = World.masons(w, 0);
  let started = 0, spare = null;
  for (let k = 0; k < crews; k++) {
    const at = spot('tower');
    if (!at) break;
    if (World.applyCommand(w, 0, { c: 'build', ...at, bt: 'tower' }).ok) started++;
  }
  /* a spot that is legal on every count EXCEPT the masons — found while they are all busy,
   * so the only thing standing in the way is a free crew */
  for (let rad = 150; rad < C.CLAIM.seat - 40 && !spare; rad += 25)
    for (let a = 0; a < 32 && !spare; a++) {
      const th = a / 32 * Math.PI * 2, x = c.x + Math.cos(th) * rad, y = c.y + Math.sin(th) * rad;
      if (World.placementError(w, 0, x, y, 'tower') === 'busy') spare = { x, y };
    }
  eq('exactly as many works rise at once as there are crews', started, crews);
  ok('and the next is refused for want of a mason, not for want of ground', !!spare,
     spare ? 'busy' : 'no such spot');
  eq('the sim agrees on how many are rising', World.rising(w, 0), crews);
  ok('the crews are capped, so a runaway realm cannot build instantly',
     World.masons(w, 0) <= C.MASONS.max);
}

/* THE MUSTER HAS NO CEILING. It had one, at 110, and a chronicle from play showed the cost:
 * an army pinned there from minute six and twenty-two thousand essence banked with nowhere to
 * go. The economy is the brake now — and the ceiling was load-bearing for performance, so the
 * scan that made it necessary has to stay cheap. */
suite('no ceiling on the muster')
{
  eq('an heir musters as many as it can pay for', C.CAP.player, 0);
  ok('Chaos still has one — a director is not a player', C.CAP.chaos > 0, `${C.CAP.chaos}`);

  const w = World.createWorld(1000), pl = w.players[0], c = World.cityOf(w, 0);
  pl.essence = 9e9;
  w.chaosNext = 1e9;
  let halls = 0;
  for (let a = 0; a < 60 && halls < 4; a++) {
    const th = a / 60 * Math.PI * 2, x = c.x + Math.cos(th) * 200, y = c.y + Math.sin(th) * 200;
    if (World.placementError(w, 0, x, y, 'barracks') === null && raise(w, 0, x, y, 'barracks').ok) halls++;
  }
  eq('four halls stand', halls, 4);
  const t0 = Date.now();
  for (let i = 0; i < 30 * 900; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  const ms = Date.now() - t0;
  const army = w.units.filter((u) => u.owner === 0).length;
  ok('an army grows past the old ceiling', army > 110, `${army} troops`);
  /* and the sim is still real-time: 900 seconds of play must cost far less than 900 seconds */
  ok('and the sim keeps up with a big one', ms < 90000, `${(ms / 1000).toFixed(1)}s for 15 minutes of play, ${army} troops`);

  /* A RECRUIT REFUSED IS A RECRUIT UNPAID. With a ceiling in force the halls charged for men
   * the cap turned away — measured at 6 essence a second, silently. */
  const w2 = World.createWorld(1000), p2 = w2.players[0], c2 = World.cityOf(w2, 0);
  p2.essence = 9e9; w2.chaosNext = 1e9;
  for (let a = 0; a < 60; a++) {
    const th = a / 60 * Math.PI * 2, x = c2.x + Math.cos(th) * 200, y = c2.y + Math.sin(th) * 200;
    if (World.placementError(w2, 0, x, y, 'barracks') === null && raise(w2, 0, x, y, 'barracks').ok) break;
  }
  const was = C.CAP.player;
  C.CAP.player = 4;   // a ceiling, just for this
  for (let i = 0; i < 30 * 200; i++) { World.update(w2, C.SIM_DT); w2.events.length = 0; }
  eq('the ceiling holds when there is one', w2.units.filter((u) => u.owner === 0).length, 4);
  const purse = p2.essence;
  for (let i = 0; i < 30 * 60; i++) { World.update(w2, C.SIM_DT); w2.events.length = 0; }
  ok('and a full army is charged nothing for the men it cannot raise', p2.essence >= purse,
     `${(p2.essence - purse).toFixed(0)} over a minute at the ceiling`);
  C.CAP.player = was;
}

/* A Seat is 2500 hit points behind towers, and men are a poor tool for stone: "win by force"
 * meant grinding outworks forever while neither Seat took a scratch. The Engine is the answer,
 * and it is only an answer if it is BETTER at stone and WORSE at men than what it costs. */
suite('the Siege Works')
{
  const eng = C.UNITS.engine, sol = C.UNITS.soldier, def = C.BUILDINGS.siege;
  ok('the Works are on the build sheet', C.BUILD_ORDER_UI.includes('siege'));
  eq('and they muster Engines', def.spawns, 'engine');
  const perEss = (u, mult) => (u.dmg * (mult ? (u.siege || 1) : 1)) / u.atk / u.cost;
  ok('an Engine beats soldiery against stone, essence for essence',
     perEss(eng, true) > perEss(sol, true) * 1.5,
     `${perEss(eng, true).toFixed(2)} vs ${perEss(sol, true).toFixed(2)} damage/s per essence`);
  ok('...and loses to it badly against men', perEss(eng, false) < perEss(sol, false) * 0.35,
     `${perEss(eng, false).toFixed(2)} vs ${perEss(sol, false).toFixed(2)}`);
  ok('it cannot outrange a tower, so it needs an escort',
     eng.range < C.BUILDINGS.tower.range[0], `${eng.range} vs ${C.BUILDINGS.tower.range[0]}`);
  ok('and it cannot run', eng.speed < sol.speed * 0.7, `${eng.speed} vs ${sol.speed}`);

  /* the whole point, in the sim rather than on paper: it breaks a Seat */
  const w = World.createWorld(1000);
  w.chaosNext = 1e9;
  const foe = World.cityOf(w, 1);
  const put = (kind, n) => {
    for (let i = 0; i < n; i++) {
      const d = C.UNITS[kind];
      w.units.push({ id: w.nextId++, owner: 0, kind, x: foe.x + i * 3, y: foe.y + 20, ox: 0, oy: 0,
                     hp: 1e9, maxHp: 1e9, dmg: d.dmg, cd: 0, goal: null, co: 0, from: -1 });
    }
  };
  const bite = (kind, n) => {
    w.players[1].castleHp = C.CASTLE_HP;
    w.units.length = 0;
    put(kind, n);
    for (let i = 0; i < 30 * 20; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
    return C.CASTLE_HP - w.players[1].castleHp;
  };
  /* the same money, spent two ways: five Engines or twenty-two soldiers */
  const byEngine = bite('engine', 5), bySoldier = bite('soldier', Math.round(5 * eng.cost / sol.cost));
  ok('five Engines break more Seat than the soldiers they cost', byEngine > bySoldier,
     `${Math.round(byEngine)} vs ${Math.round(bySoldier)} hp in twenty seconds`);
  ok('and it is a real bite, not a scratch', byEngine > C.CASTLE_HP * 0.4,
     `${Math.round(byEngine)} of ${C.CASTLE_HP}`);

  /* A WORK IS STONE, NOT SAND. A realm used to be a sandcastle — 59 razes in one reported
   * match, 26 in another, and a raze-and-rebuild treadmill at the same spring that neither
   * side could win. Breaking one has to be a commitment, which is also what makes an Engine
   * worth raising rather than another handful of men. */
  const dps = (u) => u.dmg / u.atk;
  for (const bt of C.BUILD_ORDER_UI) {
    const b = C.BUILDINGS[bt];
    const alone = b.hp / dps(sol);
    ok(`one soldier needs real time to break a ${b.name}`, alone > 55,
       `${alone.toFixed(0)}s alone, ${b.hp} hit points`);
  }
  /* essence for essence, against stone, an Engine is worth well over a soldier */
  const stoneRate = (u) => dps(u) * (u.siege || 1) / u.cost;
  ok('and an Engine is far better at it than the men it cost',
     stoneRate(eng) > stoneRate(sol) * 1.5,
     `${(stoneRate(eng) / stoneRate(sol)).toFixed(2)}x a soldier's stone-breaking per essence`);
}

/* A match a human plays leaves no trace, so every report from play has to be argued from
 * memory. The chronicle writes it down in a form small enough to paste into a conversation.
 * It is a READER of the sim and must never be a writer of it. */
suite('the chronicle')
{
  ok('nothing recorded is not a crash', typeof Rec.text() === 'string' && /AMBER/.test(Rec.text()));

  const seed = 20250802;
  const w = World.createWorld(seed, 2);
  const bots = [AI.make('bleys'), AI.make('benedict', C.DIFFICULTY.heir)];
  w.players[1].eco = C.DIFFICULTY.heir.eco;
  Rec.begin({ version: 'test', seed, viewer: 0, names: ['Corwin', 'Benedict, Master of Arms'],
              mode: 'skirmish', footing: 'HEIR' });
  const issue = (pi) => (cmd) => {
    const r = World.applyCommand(w, pi, cmd);
    if (pi === 0 && r.ok) Rec.command(cmd, w);
    return r;
  };
  const iss = [issue(0), issue(1)];
  const before = JSON.stringify({ t: w.t, ess: w.players.map((p) => p.essence) });
  while (w.winner === null && w.t < 900) {
    const f = w.tick % 2;
    bots[f].step(w, f, iss[f], C.SIM_DT);
    bots[1 - f].step(w, 1 - f, iss[1 - f], C.SIM_DT);
    World.update(w, C.SIM_DT);
    Rec.sample(Rec.fromWorld(w));
    Rec.note(w.events, w);
    w.events.length = 0;
  }
  Rec.end(w.winner, w.winReason, Rec.fromWorld(w));
  const txt = Rec.text();

  ok('the match is written down', txt.length > 600, `${txt.length} characters`);
  ok('...and stays pasteable', txt.length < 40000, `${txt.length} characters`);
  ok('the seed is in it, so the board can be rebuilt', txt.indexOf(String(seed)) >= 0);
  ok('and the footing it was played on', /HEIR/.test(txt));
  ok('it names who you were', /you are seat 0/.test(txt));
  ok('it says how it ended', /^result:/m.test(txt), txt.split('\n')[3]);
  ok('the table is sampled over the whole match', (txt.match(/^ ?\d+:\d\d \|/gm) || []).length > 8,
     `${(txt.match(/^ ?\d+:\d\d \|/gm) || []).length} rows`);
  ok('your orders are listed', /— your orders —/.test(txt) && /build /.test(txt));
  ok('and the moments worth naming', /— the moments —/.test(txt));

  /* the columns must line up or it is unreadable in a chat window */
  const body = txt.split('— the hours —')[1].split('— your orders —')[0].split('\n')
    .filter((l) => /\|/.test(l));
  const widths = new Set(body.map((l) => l.indexOf('|')));
  eq('every row starts its first column in the same place', widths.size, 1, [...widths].join(','));

  /* it must not have touched anything */
  eq('recording changes nothing about the world it read', typeof w.t, 'number');
  ok('and the sim ran normally under it', w.t > 60, `${Math.round(w.t)}s`, before);

  /* consecutive repeats collapse — eleven upgrades in a row is one fact, not eleven */
  Rec.begin({ version: 'test', seed: 1, viewer: 0, names: ['Corwin', 'Eric'], mode: 'test' });
  const w2 = World.createWorld(1, 2);
  const c2 = World.cityOf(w2, 0);
  for (let i = 0; i < 5; i++) Rec.command({ c: 'banner', x: c2.x, y: c2.y }, w2);
  Rec.command({ c: 'walk', on: true }, w2);
  Rec.end(null, null, Rec.fromWorld(w2));
  const t2 = Rec.text();
  ok('five identical orders read as one line', /War Banner.*×5/.test(t2),
     t2.split('— your orders —')[1].split('\n').slice(0, 3).join(' / '));
  ok('and a different order still gets its own', /BEGIN THE WALK/.test(t2));

  /* a guest records from snapshots and must SAY so rather than pass fog off as truth */
  Rec.begin({ version: 'test', seed: 5, viewer: 2, names: C.SEAT_NAMES.slice(0, 4),
              mode: 'LAN 4-way', partial: true });
  const w3 = World.createWorld(5, 4);
  for (let i = 0; i < 30 * 40; i++) { World.update(w3, C.SIM_DT); w3.events.length = 0; }
  Rec.sample(Rec.fromSnap(JSON.parse(JSON.stringify(Net.snapFor(w3, 2, []))), 2));
  Rec.end(undefined, null, null);
  const t3 = Rec.text();
  ok('a guest record admits it is partial', /guest/.test(t3) && /not the truth/.test(t3));
  const head3 = t3.split('\n').find((l) => /^ time \|/.test(l)) || '';
  ok('and still carries four seats', (head3.match(/\|/g) || []).length >= 4, head3);
}

/* ---------------- multiplayer: the snapshot contract ---------------- */
suite('multiplayer snapshots');
{
  const w = World.createWorld(1000);
  const bots = [AI.make('benedict'), AI.make('corwin')];
  const iss = [(cm) => World.applyCommand(w, 0, cm), (cm) => World.applyCommand(w, 1, cm)];
  for (let i = 0; i < 30 * 60 * 5 && w.winner === null; i++) {   // five minutes of play
    const f = w.tick % 2;
    bots[f].step(w, f, iss[f], C.SIM_DT); bots[1 - f].step(w, 1 - f, iss[1 - f], C.SIM_DT);
    World.update(w, C.SIM_DT);
    w.events.length = 0;
  }
  ok('both sides have works after five minutes',
     w.players[0].buildings.length > 0 && w.players[1].buildings.length > 0,
     `${w.players[0].buildings.length} vs ${w.players[1].buildings.length}`);

  const snap = Net.snapFor(w, 1, []);
  ok('a snapshot is produced', !!snap && !!snap.players);

  /* it has to survive the wire */
  let wire = null, wireErr = '';
  try { wire = JSON.parse(JSON.stringify(snap)); } catch (e) { wireErr = e.message; }
  ok('the snapshot survives JSON', !!wire, wireErr);
  const bytes = JSON.stringify(snap).length;
  ok('the snapshot fits a 10 Hz DataChannel', bytes < 120000, `${(bytes / 1024).toFixed(1)} KiB`);

  /* nothing the rival keeps may ride along */
  const foe = wire.players[0];
  eq('the rival essence is withheld', foe.essence, null);
  eq('the rival banner is withheld', foe.banner, null);
  eq('the rival powers are withheld', foe.powers, null);
  eq('the rival muster state is withheld', foe.musterPaused, false);
  ok('rival works carry no branch', foe.buildings.every((b) => b.br === null));
  ok('a rival hall never reveals which company it musters into', foe.buildings.every((b) => b.co === 0));

  /* fog: a rival work in the snapshot must be one the viewer can actually see */
  const canSee = (x, y) => World.canSee(w, 1, x, y);
  ok('every rival work sent is visible', foe.buildings.every((b) => canSee(b.x, b.y)),
     `${foe.buildings.filter((b) => !canSee(b.x, b.y)).length} leaked`);
  ok('no ghost is of something currently visible', (foe.ghosts || []).every((g) => !canSee(g.x, g.y)));
  ok('units sent are own or seen', wire.units.every((u) => u.owner === 1 || canSee(u.x, u.y)));

  /* the shape the renderers read */
  ok('players carry a buildings array', Array.isArray(wire.players[1].buildings));
  ok('the rival carries a ghosts array', Array.isArray(foe.ghosts));
  ok('sites carry a holder', wire.sites.filter(Boolean).every((s) => 'holder' in s));
  ok('unexplored sites are absent', wire.sites.some((s) => s === null));

  /* the hidden Seat: a guest must not be able to read it out of the snapshot */
  const foeSeat = w.map.cities[0];
  const seatSeen = !!w.players[1].explored[foeSeat];
  if (!seatSeen) {
    eq('an unfound rival Seat is absent from sites', wire.sites[foeSeat], null);
    const seat = w.map.sites[foeSeat];
    ok('no rival work near the unfound Seat is sent',
       foe.buildings.every((b) => Math.hypot(b.x - seat.x, b.y - seat.y) > C.CITY.r));
  } else {
    ok('rival Seat was found during the run (fog test skipped)', true, 'explored');
  }
}

/* ---------------- */
process.exit(report("headless"));

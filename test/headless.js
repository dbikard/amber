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
    /* EXACTLY ONE, AND IT IS ALREADY DRAWN UPON. A Seat that opened with two usable springs
     * began with twice the economy and — since crews are hired one per Gate — twice the
     * masons, and the fairness score could only ever narrow that gap. One each, gated from
     * the first second, and the second spring is something you go and take. */
    const inReach = springs.filter((q) => q.d <= C.CLAIM.seat);
    eq(`seed ${seed}: Seat ${pi} opens with exactly one spring in its writ`, inReach.length, 1);
    const gate = w.players[pi].buildings.find((b) => b.bt === 'gate');
    ok(`seed ${seed}: and a Gate already stands on it`,
       !!gate && !gate.raise && gate.node === inReach[0].s.id,
       gate ? `node ${gate.node}, want ${inReach[0].s.id}` : 'no Gate at all');
    ok(`seed ${seed}: which is drawing, not scaffolding`, !!gate && gate.hp === C.BUILDINGS.gate.hp);
    /* and the ground it stands on is the ground worldgen promised was buildable */
    ok(`seed ${seed}: it stands clear of the castle`,
       !!gate && Math.hypot(gate.x - cs.x, gate.y - cs.y) > C.CITY.seatR,
       gate ? String(Math.round(Math.hypot(gate.x - cs.x, gate.y - cs.y))) : '');
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
  /* long enough for the SLOWEST work — masonry times went up by half and a Shrine is 54
   * seconds now, so a flat 40 left it forever scaffolded and every assertion after it wrong */
  const wait = 30 * ((C.BUILDINGS[bt] && C.BUILDINGS[bt].raise ? C.BUILDINGS[bt].raise : 30) + 20);
  for (let i = 0; i < wait && w.players[pi].buildings.some((b) => b.raise > 0); i++) World.update(w, C.SIM_DT);
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
    /* keep looking past a CROWDED sample: the first cell of a terrain may happen to fall
     * beside the Gate every heir now opens with, and that says nothing about the ground */
    if (byTerrain[t] === 'LEGAL') continue;
    const verdict = World.placementError(w, 0, x, y, 'barracks') || 'LEGAL';
    if (!byTerrain[t] || verdict === 'LEGAL') byTerrain[t] = verdict;
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
    /* the LAST work raised, not the first — buildings[0] is the Gate every heir opens with */
    if (!World.placementError(w, 0, x, y, 'tower')) { World.applyCommand(w, 0, { c: 'build', x, y, bt: 'tower' }); built = pl.buildings[pl.buildings.length - 1]; }
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

  /* THE STARTING POSITION HAS EXACTLY ONE SPRING, AND IT IS ALREADY GATED. An heir opens
   * drawing, and that first Gate is also his first mason — crews are hired one per Gate, so
   * one who began with none would begin unable to build at all. */
  const spring = w.map.sites.filter((s) => s.kind === 'node')
    .map((s) => ({ s, d: Math.hypot(s.x - c.x, s.y - c.y) })).sort((a, b) => a.d - b.d)[0];
  const g = pl.buildings.find((b) => b.bt === 'gate');
  ok('an heir opens with a Gate standing', !!g && !g.raise);
  ok('...on the one spring in his writ', g && g.node === spring.s.id, `${g && g.node} vs ${spring.s.id}`);
  eq('...which is his first mason', World.masons(w, 0), 1);
  /* and it really is ONE spring: no second usable one inside the writ he starts with */
  const inWrit = w.map.sites.filter((s) => s.kind === 'node' && World.inClaim(w, 0, s.x, s.y));
  eq('exactly one spring lies in the starting writ', inWrit.length, 1);
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
  World.update(w, C.SIM_DT);
  const base = w.players[1].incomeRate;
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
      /* A CURTAIN IS LONGER THAN ITS MIDDLE, and the snapshot sends one the moment any part
       * of it is seen — so judging a work by its midpoint alone calls a legitimately visible
       * wall a fog leak. It only ever failed when a run happened to fall with a visible end
       * and a hidden centre, which is exactly the kind of test that passes until it matters. */
      ok(`seat ${viewer}: only sees seat ${pi}'s works it can see`,
         wire.players[pi].buildings.every((b) => canSee(b.x, b.y)
           || (b.x2 != null && (canSee(b.x2, b.y2) || canSee(b.x * 2 - b.x2, b.y * 2 - b.y2)))));
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
  /* NET of income: an heir opens with a Gate drawing on his own spring, so the treasury is
   * filling while the walk empties it. The drain is what the Shrine takes, not what the purse
   * loses. */
  const spent = before - pl.essence + (pl.incomeRate || 0);
  near('a second of walking costs the Shrine drain', spent, C.BUILDINGS.shrine.drain[0], 3.5,
       `${spent.toFixed(1)} spent, drain ${C.BUILDINGS.shrine.drain[0]}/s`);
  ok('the drain is reported to the HUD', pl.drainRate >= C.BUILDINGS.shrine.drain[0] - 0.5,
     `${pl.drainRate.toFixed(1)}/s`);
  /* A WALK IS A COMMITMENT, NOT A PURCHASE — and the number that says so is what a REALM can
   * carry, not an absolute. It has to be beyond what a small holding earns and inside what a
   * real one does, or it is either a decoration or a formality. Five Gates is the line the
   * design draws: a walk must cost more than the base income can ever cover, and it must be
   * something five Gates and a hall can pay for. */
  const shr = C.BUILDINGS.shrine, secs = 100 / shr.rate[0];
  const full = shr.drain[0] * secs;
  const fiveGates = C.BASE_INCOME + 5 * C.BUILDINGS.gate.nodeIncome[0];
  ok('a whole walk is a serious sum', full > C.BASE_INCOME * secs * 4,
     `${Math.round(full)} essence over ${(secs / 60).toFixed(1)} min`);
  ok('...and five Gates can carry it with a little to spare',
     fiveGates > shr.drain[0] && fiveGates < shr.drain[0] * 1.4,
     `five Gates draw ${fiveGates.toFixed(1)}/s against a ${shr.drain[0]}/s walk`);
  ok('...over a walk the rival has time to come and stop', secs > 240 && secs < 480,
     `${(secs / 60).toFixed(1)} min in plain sight`);
  ok('...and the lines fade slower than they are drawn', shr.decay < shr.rate[0],
     `${shr.decay}%/s fade against ${shr.rate[0]}%/s drawn`);

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

  /* EVERY HALL FLIES A STANDARD. There is no company 0 and no gold banner for it to mean:
   * the first hall raises a standard of its own without being asked, which is what makes the
   * first Barracks simply work. */
  /* the board hands every heir an opening hall, and it flies a standard of its own — so what
   * this suite counts is the companies IT adds, not the companies on the board */
  const was = pl.companies.length;
  eq('the opening hall already flies one', was, 1);
  const h1 = hall(180, 0);
  ok('the first hall raised in play raises a standard of its own', h1 && h1.co > 0, `co ${h1 && h1.co}`);
  eq('...which is one more company', pl.companies.length - was, 1);
  const co = pl.companies[was].id;
  const h2 = hall(235, 'new');
  ok('a second may raise another', h2 && h2.co > 0 && h2.co !== co);
  eq('...which is two more', pl.companies.length - was, 2);
  const h3 = hall(290, co);
  ok('or JOIN one rather than add another flag', h3 && h3.co === co);
  eq('still two more for three halls', pl.companies.length - was, 2,
     `${pl.buildings.filter((b) => b.co === co).length} halls under the first`);
  const other = pl.companies.filter((q) => q.id !== co && q.id !== pl.buildings[1].co)[0].id;

  /* the men follow the company, and moving its standard moves all of them at once */
  for (let i = 0; i < 30 * 120; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  const underCo = w.units.filter((u) => u.owner === 0 && u.co === co).length;
  const underOther = w.units.filter((u) => u.owner === 0 && u.co === other).length;
  ok('both halls muster into the one company', underCo > 0, `${underCo} troops`);
  ok('and the other standard musters separately', underOther > 0, `${underOther} troops`);
  eq('no man answers no standard at all', w.units.filter((u) => u.owner === 0 && !u.co).length, 0);

  const site = w.map.sites.find((s) => s.kind === 'node');
  ok('a company standard can be posted', World.applyCommand(w, 0, { c: 'rally', co, site: site.id }).ok);
  eq('an unknown company is refused', World.applyCommand(w, 0, { c: 'rally', co: 999, site: site.id }).err, 'co');
  World.update(w, C.SIM_DT);
  const goals = new Set(w.units.filter((u) => u.owner === 0 && u.co === co).map((u) => u.goal && u.goal.site));
  ok('every one of its men answers the new standard, from both halls',
     goals.size === 1 && goals.has(site.id), [...goals].join(','));
  const otherGoals = new Set(w.units.filter((u) => u.owner === 0 && u.co === other).map((u) => u.goal && u.goal.site));
  ok('and the other company is untouched by it', !otherGoals.has(site.id));

  /* THE RECALL. The gold flag is gone from the tray — every hall flies its own standard and
   * nothing quietly overrules them — but the ORDER it carried survives as a button: one
   * command that strikes every standing standard and turns the whole army for home. */
  const gold = w.map.sites.filter((s) => s.kind !== 'city' && s.id !== site.id)
    .sort((a, b) => Math.hypot(b.x - c.x, b.y - c.y) - Math.hypot(a.x - c.x, a.y - c.y))[0];
  ok('the Recall can be sounded', World.applyCommand(w, 0, { c: 'banner', site: gold.id }).ok);
  eq('and it strikes every company standard', pl.companies.filter((q) => q.rally).length, 0);
  World.update(w, C.SIM_DT);
  const host = w.units.filter((u) => u.owner === 0);
  ok('the company still has men', host.some((u) => u.co === co));
  eq('and the WHOLE army answers it, every company included',
     host.filter((u) => !u.goal || u.goal.site !== gold.id).length, 0, `${host.length} troops`);
  /* …and a detachment can peel back off, or the standards would be one-use */
  ok('a company can post its standard again', World.applyCommand(w, 0, { c: 'rally', co, site: site.id }).ok);
  World.update(w, C.SIM_DT);
  const peeled = w.units.filter((u) => u.owner === 0 && u.co === co);
  ok('and takes its own men back with it',
     peeled.length > 0 && peeled.every((u) => u.goal && u.goal.site === site.id), `${peeled.length} troops`);
  ok('while the other company holds where the Recall left it',
     w.units.filter((u) => u.owner === 0 && u.co === other).every((u) => u.goal && u.goal.site === gold.id));

  /* re-assignment: a hall can be moved, and its own men move with it. There is nowhere to
   * move it OUT to — a hall with no standard is a hall you cannot give orders to — so it
   * moves to ANOTHER company, or raises one of its own. */
  const before = w.units.filter((u) => u.owner === 0 && u.from === h3.id).length;
  ok('the third hall has men of its own', before > 0, `${before}`);
  ok('it can be moved to the other standard', World.applyCommand(w, 0, { c: 'assign', id: h3.id, co: other }).ok);
  eq('the hall now answers that one', h3.co, other);
  eq('and so do the men it raised',
     w.units.filter((u) => u.owner === 0 && u.from === h3.id && u.co !== other).length, 0);
  ok('the company survives while its other hall stands', pl.companies.some((q) => q.id === co));

  /* asking for no company at all raises a NEW one rather than leaving the hall mute */
  const r5 = World.applyCommand(w, 0, { c: 'assign', id: h3.id, co: 0 });
  ok('a hall asked for no standard raises one instead', r5.ok && h3.co > 0 && h3.co !== other,
     `co ${h3.co}`);

  /* ...and a company is dropped once nothing answers to it any more */
  const doomed = h3.co;
  World.applyCommand(w, 0, { c: 'assign', id: h3.id, co: other });
  for (const u of w.units) if (u.owner === 0 && u.co === doomed) u.co = other;
  World.applyCommand(w, 0, { c: 'assign', id: h3.id, co: other });
  ok('an empty company is not kept', !pl.companies.some((q) => q.id === doomed),
     JSON.stringify(pl.companies));

  /* THE RECALL AGAIN: every man of yours must move when it sounds, whatever standard he flies */
  const far = w.map.sites.filter((s) => s.kind !== 'city')
    .sort((a, b) => Math.hypot(b.x - c.x, b.y - c.y) - Math.hypot(a.x - c.x, a.y - c.y))[0];
  ok('the Recall can be sounded again', World.applyCommand(w, 0, { c: 'banner', site: far.id }).ok);
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
  /* the work just raised, not buildings[0] — that is the Gate every heir opens with */
  const b = pl.buildings[pl.buildings.length - 1];
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
  /* ...and the rim is the court's plus a man's berth off a work: nobody stands IN a hall any
   * more, so a man at the edge of the muster is pushed BUILD.pass beyond whatever he formed
   * up against. That is the rule working, not the army wandering. */
  ok('and it stays inside the court', d[d.length - 1] < C.CITY.r + 60 + C.BUILD.pass,
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
    /* WELL CLEAR OF THE COURT. A run at r=110 leaves no ground to stand "behind" it on: the
     * band between not-manning it (WALL.man*1.5) and not-standing-in-the-Seat (CITY.seatR)
     * is empty at that radius, so a man posted behind the wall is on the Seat's own ground
     * and the muster ring walks him out of the wall's shadow. Everything this suite asserts
     * about being sheltered needs a run with room behind it. */
    for (let r = 210; r <= 320 && !laid; r += 22) {
      const mx = c.x + Math.cos(a) * r, my = c.y + Math.sin(a) * r;
      const px = -Math.sin(a) * 70, py = Math.cos(a) * 70;
      if (!World.wallError(w, 0, mx - px, my - py, mx + px, my + py)) laid = [mx - px, my - py, mx + px, my + py];
    }
  }
  ok('a curtain can be laid beside the Seat', !!laid);
  const before = pl.essence;
  const r1 = build(laid[0], laid[1], laid[2], laid[3]);
  ok('and the order is accepted', r1.ok, r1.err);
  /* A RUN IS PRICED BY THE FOOT. The card's cost buys WALL.unit of wall; this run is
   * whatever length the ground would take, and it is billed for exactly that. */
  {
    const laidLen = Math.hypot(laid[2] - laid[0], laid[3] - laid[1]);
    eq('it costs what the card says, by the foot', Math.round(before - pl.essence),
       Math.max(1, Math.round(def.cost * laidLen / C.WALL.unit)));
  }
  const b = pl.buildings.find((q) => q.bt === 'wall');
  ok('it is stored by its MIDPOINT, carrying the far end', b && b.x2 != null);
  near('the midpoint is the middle of the run', b.x, (laid[0] + laid[2]) / 2, 0.01);
  const ends = World.wallEnds(b);
  near('...and the ends come back out of it', ends[0], laid[0], 0.01);
  near('...both of them', ends[3], laid[3], 0.01);
  /* A RUN ACROSS THE FIRST IS REFUSED FOR CROSSING IT — but the ground is judged before the
   * crossing is, so a probe laid over a lake comes back 'ground' and proves nothing about
   * walls. Try crossings until one stands on ground that would otherwise bear a wall. */
  let crossErr = null, tried = 0;
  {
    /* THE SAME RUN, TURNED. A probe struck out perpendicular from the wall walks onto ground
     * nobody promised was buildable — twenty of them drowned. Rotating the first run about
     * its own midpoint keeps the probe over ground the first wall already proved will bear a
     * wall, and two chords through one midpoint cross by construction. */
    const cx = (laid[0] + laid[2]) / 2, cy = (laid[1] + laid[3]) / 2;
    const hx = (laid[2] - laid[0]) / 2, hy = (laid[3] - laid[1]) / 2;
    for (const deg of [30, 45, 60, 90, 120, 150, 20, 75]) {
      const th = deg * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th);
      const rx = hx * cs - hy * sn, ry = hx * sn + hy * cs;
      const e = build(cx - rx, cy - ry, cx + rx, cy + ry).err;
      tried++;
      if (e === 'ground' || e === 'short') continue;
      crossErr = e; break;
    }
  }
  ok('ground was found to lay a crossing run on', !!crossErr, `${tried} probes, all drowned or short`);
  eq('a second run crossing the first is refused', crossErr, 'crowded');

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
  /* WELL behind and WELL in front: an order given at the wall now posts a man to a berth on
   * it, so these two have to be plainly out of that reach or the test is about manning */
  const inner = pin(put(0, side(-C.WALL.man - 70)));   // sheltered, on the Seat's side
  const outer = pin(put(1, side(C.WALL.man + 70)));    // in the field, in front of the stone
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
  const hidden = pin(put(0, side(-C.WALL.man - 70)));
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
    /* two CREWS, but a length of one and a half — and it is the LENGTH that is billed. Priced
     * by the crew, this run cost the same as one twice as long, which is why nobody drew a
     * short one. */
    const twoLen = Math.hypot(two[2] - two[0], two[3] - two[1]);
    near('...and is booked as one and a half runs of stone', wb.units, twoLen / C.WALL.unit, 1e-6);
    eq('...and costs by the foot, not by the crew', Math.round(purse - gp.essence),
       Math.max(1, Math.round(def.cost * twoLen / C.WALL.unit)));
    near('...and its stone goes with its length', wb.maxHp, def.hp * twoLen / C.WALL.unit, 1e-6);
    ok('...which is less than the two crews would have charged', purse - gp.essence < def.cost * 2,
       `${Math.round(purse - gp.essence)} vs ${def.cost * 2}`);
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
  /* A LEVEL IS MASONRY AND TAKES A CREW — so nothing else can be raised until they are out
   * of it. Everything below needs the yard free, and with one crew that means waiting. */
  ok('...and it takes the crew while they are at it', World.rising(w, 0) > 0);
  run(Math.ceil(b.work) + 1);
  eq('the masons come out of it', b.work, 0);

  /* AND THEY SPREAD ALONG IT. An order at a wall is one point, so every man sent to hold a
   * curtain used to walk to the same stride of it — a hundred feet of stone defended by a
   * scrum, with the rest of the run empty. Each takes his own berth now. */
  settle();
  {
    const men = [];
    for (let i = 0; i < 14; i++) men.push(put(0, side(-C.WALL.man * 0.6)));
    /* the order is given AT the wall's middle: one point, fourteen men */
    w.players[0].banner = { x: mid.x, y: mid.y, site: -1 };
    run(14);
    /* A PARAPET HOLDS WHAT IT HOLDS — one berth per stride of stone, and no more. The rest
     * of the company is not turned away: it stands at the FOOT, in cover behind the wall. */
    const on = men.filter((m) => m.man === b.id);
    const runLen = Math.sqrt((ends[2] - ends[0]) ** 2 + (ends[3] - ends[1]) ** 2);
    const berths = Math.max(2, Math.round(runLen / C.WALL.berth));
    ok('the run holds only as many men as it has berths', on.length === Math.min(berths, men.length),
       `${on.length} on a run of ${Math.round(runLen)} (${berths} berths), ${men.length} sent`);
    ok('...and the rest are not on it', men.length - on.length === Math.max(0, men.length - berths));
    /* how far apart they are ALONG the run, which is the thing that was broken */
    const along = on.map((m) => (m.x - ends[0]) * (ends[2] - ends[0]) + (m.y - ends[1]) * (ends[3] - ends[1]));
    const L2 = (ends[2] - ends[0]) ** 2 + (ends[3] - ends[1]) ** 2;
    const ts = along.map((v) => v / L2).sort((p, q) => p - q);
    ok('they are spread along the run, not stacked on one stride',
       ts[ts.length - 1] - ts[0] > 0.6, `they cover ${((ts[ts.length - 1] - ts[0]) * 100).toFixed(0)}% of it`);
    /* and evenly: no two men in the same berth while stretches stand empty */
    let worst = 0;
    for (let i = 1; i < ts.length; i++) worst = Math.max(worst, ts[i] - ts[i - 1]);
    ok('with no long empty stretch between them', worst < 0.25,
       `the widest gap is ${(worst * 100).toFixed(0)}% of the run`);
    ok('every one of them is on his OWN wall', on.every((m) => m.man === b.id));
  }

  /* THE PARAPET MUST BE VISIBLE. A man on the wall fought from the wall and was drawn in the
   * grass beside it — the one bargain the whole design rests on, with nothing to see. He now
   * carries the wall he is standing on, and it rides the wire so a guest sees it too. */
  settle();
  /* ONE BANNER PER HEIR, so two men of the same seat cannot be given two different orders by
   * pinning twice — the second pin simply moved the first man's order. The reserve gets its
   * own COMPANY and its own rally, which is how a player would do it too. */
  const upTop = pin(put(0, side(-C.WALL.man * 0.5)));
  const below = put(0, side(-C.WALL.man - 60));
  w.players[0].companies.push({ id: 41, rally: { x: below.x, y: below.y, site: -1 } });
  below.co = 41;
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

  /* ---- A TOWER IN THE WALL ----
   * The old rule was that a gun stands higher than a curtain and shoots over it. That made a
   * wall no answer to a tower, and — worse — made the safest place for a tower the ground
   * BEHIND a wall, where it was untouchable and unobstructed. A tower is blocked by stone
   * like anything else now, and the way to buy it a field of fire is to build it INTO the
   * run. Behind the wall it covers the ground behind the wall, which is a real choice. */
  settle();
  {
    const pl2 = w.players[0];
    pl2.essence = 100000;
    /* on the run itself */
    const at = { x: b.x + (ends[2] - ends[0]) * 0.22, y: b.y + (ends[3] - ends[1]) * 0.22 };
    const r3 = World.applyCommand(w, 0, { c: 'build', bt: 'tower', x: at.x, y: at.y });
    ok('a tower may be raised into your own curtain', r3.ok, r3.err);
    const tw = pl2.buildings.filter((q) => q.bt === 'tower').pop();
    eq('...and it knows which run it stands on', tw.onWall, b.id);

    /* A TAP NEAR THE RUN IS A TAP ON IT. The stone is drawn thirty high and the camera looks
     * down it at an angle, so the ground under the parapet you tapped lies BEHIND the wall —
     * which fell straight into the band where a tower was too far to join (WALL.thick+16) and
     * too near to stand (BUILD.foot*2+gap). Reported from play as "towers don't join walls, I
     * get error messages", and it was not the rule: it was that you could not point at it. */
    {
      const off = (d, along) => ({ x: b.x + (nx / nL) * d + (ends[2] - ends[0]) * along,
                                   y: b.y + (ny / nL) * d + (ends[3] - ends[1]) * along });
      const dead = C.BUILD.foot * 2 + C.BUILD.gap;
      ok('the old dead band was real', C.WALL.thick + 16 < dead,
         `join at ${C.WALL.thick + 16}, crowded out to ${dead}`);
      ok('...and the snap reaches past it', C.WALL.join > dead * 0.7, `${C.WALL.join} vs ${dead}`);
      /* the tower already standing in the run would crowd these out — a short run leaves
       * little room along it — so lift it for the probes and put it back after */
      const keep = pl2.buildings.indexOf(tw);
      pl2.buildings.splice(keep, 1);
      for (const d of [22, 40, 58]) {
        const p5 = off(d, -0.3);
        const r5 = World.applyCommand(w, 0, { c: 'build', bt: 'tower', x: p5.x, y: p5.y });
        const t5 = pl2.buildings.filter((q) => q.bt === 'tower').pop();
        ok(`a tap ${d} off the run still joins it`, r5.ok && t5.onWall === b.id,
           r5.ok ? `onWall ${t5.onWall}` : r5.err);
        if (r5.ok) pl2.buildings.splice(pl2.buildings.indexOf(t5), 1);
      }
      /* ...but a tower genuinely away from the wall is still its own work */
      const far5 = off(C.WALL.join + 40, -0.3);
      const r6 = World.applyCommand(w, 0, { c: 'build', bt: 'tower', x: far5.x, y: far5.y });
      if (r6.ok) {
        const t6 = pl2.buildings.filter((q) => q.bt === 'tower').pop();
        ok('and one well clear of it is not snapped in', !t6.onWall, `onWall ${t6.onWall}`);
        pl2.buildings.splice(pl2.buildings.indexOf(t6), 1);
      } else ok('and one well clear of it is not snapped in', true, 'no ground for it');
      pl2.buildings.splice(keep, 0, tw);
    }
    tw.raise = 0; tw.cd = 0;
    /* A SECOND TOWER, BEHIND THE WALL. Searched for rather than computed: a spot far enough
     * inward to be sheltered lands on the Seat's own ground, and one far enough along the run
     * crowds the tower already in the wall — hand-picking a point here silently returned the
     * SAME tower twice and made the whole comparison meaningless. */
    /* ...and it has to be beyond the SNAP, not merely beyond the old join radius: a tower
     * dropped within WALL.join of your own run is pulled onto it, which is the whole point. */
    let back = null;
    for (let along = -0.55; along <= 0.55 && !back; along += 0.1) {
      for (let inward = C.WALL.join + 20; inward <= 150 && !back; inward += 10) {
        const p4 = { x: b.x + (ends[2] - ends[0]) * along - (nx / nL) * inward,
                     y: b.y + (ends[3] - ends[1]) * along - (ny / nL) * inward };
        if (World.placementError(w, 0, p4.x, p4.y, 'tower')) continue;
        if ((p4.x - tw.x) ** 2 + (p4.y - tw.y) ** 2 < 90 * 90) continue;   // clear of the wall tower
        back = p4;
      }
    }
    ok('there is ground behind the wall for a second tower', !!back);
    const r4 = back ? World.applyCommand(w, 0, { c: 'build', bt: 'tower', x: back.x, y: back.y })
                    : { ok: false, err: 'nospot' };
    ok('and one behind it is just a tower', r4.ok, r4.err);
    const tb = pl2.buildings.filter((q) => q.bt === 'tower').pop();
    ok('...which is a different work from the one in the wall', tb.id !== tw.id);
    ok('...standing on no wall at all', !tb.onWall);
    tb.raise = 0; tb.cd = 0;

    /* a foe in the field, in reach of both */
    const foe = put(1, side(70));
    foe.hp = foe.maxHp = 4000;
    w.players[1].banner = { x: foe.x, y: foe.y, site: -1 };
    const hp0 = foe.hp;
    run(8);
    ok('the tower ON the wall shoots over it', foe.hp < hp0, `${Math.round(hp0 - foe.hp)} damage taken`);

    /* now prove the one BEHIND cannot: take the wall tower away and the shooting stops */
    World.hurtBuilding(w, 0, tw.id, 1e9, 1);
    const hp1 = foe.hp;
    run(8);
    eq('the tower BEHIND the wall cannot shoot past it', foe.hp, hp1);
    /* ...and it is not simply broken: breach the wall and it opens fire */
    World.hurtBuilding(w, 0, b.id, 1e9, 1);
    run(8);
    ok('through a breach, it can', foe.hp < hp1, `${Math.round(hp1 - foe.hp)} damage taken`);
    /* put the stone back for what follows — through the real mend, since poking the fields
     * by hand leaves the standing list stale and the next suite reading a wall that is not
     * there */
    const fx = World.applyCommand(w, 0, { c: 'fix', id: b.id });
    ok('the breach can be mended again afterwards', fx.ok, fx.err);
    run(Math.ceil(b.work) + 1);
    ok('...and the run is standing once more', w.walls.length === 1 && !b.breach);
  }

  /* ---- the gate, and only the gate ---- */
  settle();
  {
    const wl = w.walls[0];
    ok('the run has a gateway at its middle', wl.gx === b.x && wl.gy === b.y);
    /* the owner crosses AT the gate... */
    const far = side(-260);
    const thru = put(0, { x: wl.gx + (b.x - far.x) * 0.0 + 0, y: wl.gy }, 'soldier');
    thru.x = side(70).x; thru.y = side(70).y;
    /* aim him squarely at the gateway from the field side */
    w.players[0].banner = { x: far.x, y: far.y, site: -1 };
    run(30);
    const sIn = (nx / nL) * (thru.x - mid.x) + (ny / nL) * (thru.y - mid.y);
    ok('the heir passes through his own gate', sIn < 0, sIn.toFixed(1));
    /* ...and a rival at the very same gateway does not */
    settle();
    const foe = put(1, side(70), 'soldier');
    w.players[1].banner = { x: far.x, y: far.y, site: -1 };
    run(30);
    const sOut = (nx / nL) * (foe.x - mid.x) + (ny / nL) * (foe.y - mid.y);
    ok('a rival finds the gate shut and cannot cross', sOut > 0, sOut.toFixed(1));
  }

  /* ---- a breach is a ruin, and a ruin can be mended ---- */
  settle();
  const ver = w.navVersion;
  World.hurtBuilding(w, 0, b.id, 1e9, 1);
  ok('a broken curtain stops barring the ground', w.walls.length === 0 && !w.anyWall);
  ok('...and the movement layer is told', w.navVersion > ver);
  ok('...but it is still THERE, as a ruin', w.players[0].buildings.some((q) => q.id === b.id));
  eq('...breached', b.breach, 1);
  near('...with only rubble left of it', b.hp, b.maxHp * C.WALL.rubble, 1);
  /* AND THE RUBBLE CAN BE CLEARED — that is how you get the ground back for something of
   * your own. It is not swept away by one stray blow, and it is never worth a soldier's
   * attention while anything alive is in reach: a wall is a last-resort target, breached or
   * whole. */
  {
    const g3 = World.createWorld(1000, 2);
    g3.chaosNext = 1e9;
    const p3 = g3.players[0], c3 = World.cityOf(g3, 0);
    p3.essence = 100000;
    let ln = null;
    for (let a2 = 0; a2 < 6.28 && !ln; a2 += 0.35)
      for (let r2 = 110; r2 <= 200 && !ln; r2 += 22) {
        const mx = c3.x + Math.cos(a2) * r2, my = c3.y + Math.sin(a2) * r2;
        const px = -Math.sin(a2) * 60, py = Math.cos(a2) * 60;
        if (!World.wallError(g3, 0, mx - px, my - py, mx + px, my + py)) ln = [mx - px, my - py, mx + px, my + py];
      }
    World.applyCommand(g3, 0, { c: 'build', bt: 'wall', x: ln[0], y: ln[1], x2: ln[2], y2: ln[3] });
    for (let i = 0; i < 30 * (def.raise + 1); i++) { World.update(g3, C.SIM_DT); g3.events.length = 0; }
    const wb = p3.buildings.find((q) => q.bt === 'wall');
    World.hurtBuilding(g3, 0, wb.id, 1e9, 1);
    ok('a ruin is left standing on the ground', wb.hp > 0 && wb.breach);
    /* a soldier with a live foe beside him goes for the FOE, not the rubble */
    const foeU = { id: g3.nextId++, owner: 0, kind: 'soldier', x: wb.x + 20, y: wb.y + 20, ox: 0, oy: 0,
                   hp: 500, maxHp: 500, dmg: 9, cd: 0, goal: null, co: 0, from: -1 };
    const hitter = { id: g3.nextId++, owner: 1, kind: 'soldier', x: wb.x + 24, y: wb.y + 24, ox: 0, oy: 0,
                     hp: 1e9, maxHp: 1e9, dmg: 9, cd: 0, goal: null, co: 0, from: -1 };
    g3.units.push(foeU, hitter);
    g3.players[1].banner = { x: hitter.x, y: hitter.y, site: -1 };
    const rub0 = wb.hp;
    for (let i = 0; i < 30 * 6; i++) { World.update(g3, C.SIM_DT); g3.events.length = 0; }
    ok('a soldier strikes the living man, not the ruin', foeU.hp < 500, `foe at ${Math.round(foeU.hp)}`);
    eq('...and leaves the rubble alone while he does', Math.round(wb.hp), Math.round(rub0));
    /* AND THE GROUND CAN BE TAKEN BACK. Knocking the rubble down removes it for good — which
     * is the whole reason for letting anyone hit a ruin — and the ground it stood on is free
     * for something of your own. (A soldier standing here would go for the SEAT first, which
     * is in reach and outranks rubble; the point being tested is the mechanic, not his
     * priorities, and his priorities are asserted just above.) */
    const where = { x: wb.x, y: wb.y };
    eq('a work cannot stand on a ruin', World.placementError(g3, 0, where.x, where.y, 'tower'), 'crowded');
    World.hurtBuilding(g3, 0, wb.id, wb.hp + 1, 1);
    ok('knocking the rubble down clears it away', !p3.buildings.some((q) => q.id === wb.id));
    eq('...and the ground it stood on is free again',
       World.placementError(g3, 0, where.x, where.y, 'tower'), null);
  }

  w.players[0].essence = 100000;
  const purse2 = w.players[0].essence;
  eq('a whole wall cannot be mended', World.applyCommand(w, 0, { c: 'fix', id: b.id }).err || 'ok',
     'ok');   // it IS breached here, so this must succeed
  ok('mending takes masonry', b.work > 0, b.work);
  eq('...and a crew, unlike a level', World.rising(w, 0), b.crews || 1);
  eq('...and half the stone, by the foot', Math.round(purse2 - w.players[0].essence),
     Math.max(1, Math.round(C.BUILDINGS.wall.cost * b.units * C.WALL.repair)));
  ok('a wall being mended still bars nothing', !w.anyWall);
  run(Math.ceil(b.work) + 1);
  eq('the masons close the breach', b.breach, 0);
  eq('...and the stone is whole again', Math.round(b.hp), Math.round(b.maxHp));
  ok('...and it bars the ground once more', w.anyWall && w.walls.length === 1);
  eq('a whole wall has nothing to mend', World.applyCommand(w, 0, { c: 'fix', id: b.id }).err, 'whole');
}

/* A WORK IS A WORK FROM THE MOMENT IT IS PAID FOR — it stands on the ground, it can be seen,
 * and it can be knocked over. That was one rule written in three places, and all three of them
 * quietly excused a shell from the war:
 *   — `acquire` judged a curtain by its MIDPOINT unless it was finished, so a man standing at
 *     the END of a run still going up measured half a run away from it, found nothing in reach
 *     and stood there watching the masons work. A rising run was untouchable along nearly its
 *     whole length: raise a long enough wall and nobody could reach any of it but the middle.
 *   — the raise HANDED BACK every blow. The shell's hit points were SET from the fraction of
 *     the work done, so damage was undone by the next tick of masonry — a work under
 *     construction could be hammered all day and never fall. Worse, the fraction was read off
 *     the CARD, so a run bought by the foot started above its own ramp, sat frozen at its
 *     opening hit points for the whole raise, and stood finished on one crew's worth of stone
 *     out of the several it had been paid for.
 *   — and a run knocked down while it was still going up was BREACHED like one that had stood:
 *     a wall that had never been a wall wearing a ruin, masons still raising it, the rubble
 *     healing back up under them, a 'raised' event for a run that barred nothing — and `fix`
 *     standing by to buy the whole curtain for half the stone, which is cheaper than finishing
 *     the one you were already paying for.
 * A shell is not a ruin. There is nothing to mend, because nothing ever stood. */
suite('a shell can be knocked over');
{
  const step = (w, secs) => { for (let i = 0; i < Math.round(30 * secs); i++) { World.update(w, C.SIM_DT); w.events.length = 0; } };
  const put = (w, owner, x, y, kind, dmg) => {
    const d = C.UNITS[kind];
    const u = { id: w.nextId++, owner, kind, x, y, ox: 0, oy: 0, hp: 1e9, maxHp: 1e9,
                dmg: dmg == null ? d.dmg : dmg, cd: 0, goal: null, co: 0, from: -1 };
    w.units.push(u);
    w.players[owner].banner = { x, y, site: -1 };   // the banner moves the army: pin him where he stands
    return u;
  };
  const gates = (w, pi, n) => {   // crews are hired one per Gate, and a long run wants several
    const c = World.cityOf(w, pi);
    while (World.masons(w, pi) < n)
      w.players[pi].buildings.push({ id: w.nextId++, bt: 'gate', level: 1, x: c.x, y: c.y, raise: 0,
                                     hp: 1, maxHp: 1, node: -1, co: 0, lastHurt: -99, cd: 0 });
  };

  /* ---- a point work: the masons do not undo what a blow did ---- */
  {
    const w = World.createWorld(1000, 2);
    w.chaosNext = 1e9;
    const pl = w.players[0], c = World.cityOf(w, 0);
    pl.essence = 1e6;
    let spot = null;
    for (let a = 0; a < 6.28 && !spot; a += 0.3)
      for (let r = 150; r <= 280 && !spot; r += 20) {
        const p = { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
        if (!World.placementError(w, 0, p.x, p.y, 'tower')) spot = p;
      }
    ok('there is ground beside the Seat for a tower', !!spot);
    const r0 = World.applyCommand(w, 0, { c: 'build', bt: 'tower', x: spot.x, y: spot.y });
    ok('and the order is accepted', r0.ok, r0.err);
    const t = pl.buildings[pl.buildings.length - 1];
    ok('it goes up as a shell', t.raise > 0, t.raise);
    near('a shell stands on its share of the stone', t.hp, t.maxHp * C.RAISE.hpFrom, 1);
    const perSec = t.maxHp * (1 - C.RAISE.hpFrom) / t.raiseFor;   // what a second of masonry adds
    step(w, 2);
    near('...and the masons fill it out as they work', t.hp, t.maxHp * C.RAISE.hpFrom + perSec * 2, 2);
    const before = t.hp;
    World.hurtBuilding(w, 0, t.id, perSec * 6, 1);
    ok('a work under construction can be struck', t.hp < before, `${Math.round(t.hp)} of ${Math.round(before)}`);
    const struck = t.hp;
    step(w, 2);
    ok('...and the masons do not hand the blow back', t.hp < before,
       `struck to ${Math.round(struck)}, two seconds of masonry later ${Math.round(t.hp)} — it was ${Math.round(before)}`);
    near('...they only carry on from where it left it', t.hp, struck + perSec * 2, 2);
    eq('the crew is on it while it goes up', World.rising(w, 0), 1);
    World.hurtBuilding(w, 0, t.id, 1e9, 1);
    ok('a shell knocked to nothing is gone from the board', !pl.buildings.some((q) => q.id === t.id));
    eq('...and the crew comes off it', World.rising(w, 0), 0);
    eq('...and the ground it stood on is free again',
       World.placementError(w, 0, spot.x, spot.y, 'tower'), null);
  }

  /* ---- a curtain still rising: struck where you STAND, not at its middle ---- */
  const lay = (w, pi, len) => {   // a legal run of about `len`, laid on ground beside the Seat
    const c = World.cityOf(w, pi);
    for (let a = 0; a < 6.28; a += 0.2)
      for (let r = 200; r <= 340; r += 22) {
        const mx = c.x + Math.cos(a) * r, my = c.y + Math.sin(a) * r;
        const px = -Math.sin(a) * len / 2, py = Math.cos(a) * len / 2;
        if (!World.wallError(w, pi, mx - px, my - py, mx + px, my + py)) return [mx - px, my - py, mx + px, my + py];
      }
    return null;
  };
  {
    const w = World.createWorld(1000, 2);
    w.chaosNext = 1e9;
    const pl = w.players[0];
    pl.essence = 1e6;
    gates(w, 0, 3);
    const line = lay(w, 0, C.WALL.unit * 2.4);
    ok('a long run can be laid beside the Seat', !!line);
    const rb = World.applyCommand(w, 0, { c: 'build', bt: 'wall', x: line[0], y: line[1], x2: line[2], y2: line[3] });
    ok('and the order is accepted', rb.ok, rb.err);
    const b = pl.buildings.find((q) => q.bt === 'wall');
    const ends = World.wallEnds(b);
    const dMid = Math.hypot(ends[0] - b.x, ends[1] - b.y);
    /* THIS IS THE GEOMETRY THE BUG LIVED IN. Judged from the midpoint, a man at the end of
     * this run is further from the wall than he can see — so he found no target at all. */
    ok('the end of the run is further from its middle than a man can see',
       dMid > C.UNITS.soldier.aggro, `${Math.round(dMid)} from the middle, aggro ${C.UNITS.soldier.aggro}`);
    ok('a run bought by the foot carries more stone than the card', b.maxHp > C.BUILDINGS.wall.hp,
       `${Math.round(b.maxHp)} vs ${C.BUILDINGS.wall.hp}`);
    const perSec = b.maxHp * (1 - C.RAISE.hpFrom) / b.raiseFor;
    /* a pair of Engines at the far end of the shell — the siege train, whose whole purpose is
     * stone, and which between them out-hit the masons */
    const hp0 = b.hp;
    put(w, 1, ends[0], ends[1], 'engine');
    put(w, 1, ends[0] + 12, ends[1] + 12, 'engine');
    step(w, 2);
    ok('an Engine at the END of a rising run can reach it',
       b.hp < hp0 + perSec * 2 - 1, `${Math.round(b.hp)}, and masonry alone would have made it ${Math.round(hp0 + perSec * 2)}`);
    let secs = 2;
    while (secs < 20 && pl.buildings.some((q) => q.id === b.id)) { step(w, 1); secs++; }
    ok('and knock it over while the masons are still on it', !pl.buildings.some((q) => q.id === b.id),
       `still standing at ${Math.round(b.hp)} after ${secs}s`);
    /* A SHELL LEAVES NO RUIN. Nothing stood, so there is nothing to mend, and no rubble to
     * hold the ground: the essence bought a hole in the ground and that is the whole loss. */
    ok('a curtain that never stood leaves no ruin', !b.breach, b.breach);
    eq('...nothing to mend', World.applyCommand(w, 0, { c: 'fix', id: b.id }).err, 'id');
    ok('...and no stone barring anything', w.walls.length === 0 && !w.anyWall);
    eq('...and the crews are free for another run', World.rising(w, 0), 0);
    eq('...and the ground is clear for one', World.wallError(w, 0, line[0], line[1], line[2], line[3]), null);
  }

  /* ---- and the other side of the rule: a run that DID stand still leaves its ruin ---- */
  {
    const w = World.createWorld(1000, 2);
    w.chaosNext = 1e9;
    const pl = w.players[0];
    pl.essence = 1e6;
    gates(w, 0, 3);
    const line = lay(w, 0, C.WALL.unit * 2.4);
    World.applyCommand(w, 0, { c: 'build', bt: 'wall', x: line[0], y: line[1], x2: line[2], y2: line[3] });
    const b = pl.buildings.find((q) => q.bt === 'wall');
    step(w, C.BUILDINGS.wall.raise + 1);
    eq('the masons finish the run', b.raise, 0);
    /* AND IT STANDS ON EVERY STONE IT WAS BILLED FOR. Filled out from the card rather than
     * from its own hit points, a two-and-a-half-crew run finished on the hit points of one. */
    eq('...standing on all the stone it was paid for', Math.round(b.hp), Math.round(b.maxHp));
    World.hurtBuilding(w, 0, b.id, 1e9, 1);
    eq('a run that stood is breached, not razed', b.breach, 1);
    ok('...and is still there to be mended', pl.buildings.some((q) => q.id === b.id));
    ok('...for a crew and half the stone', World.applyCommand(w, 0, { c: 'fix', id: b.id }).ok);
  }

  /* ---- scaffolding is still the LAST thing a man strikes ---- */
  {
    const w = World.createWorld(1000, 2);
    w.chaosNext = 1e9;
    const pl = w.players[0];
    pl.essence = 1e6;
    gates(w, 0, 3);
    const line = lay(w, 0, C.WALL.unit * 2.4);
    World.applyCommand(w, 0, { c: 'build', bt: 'wall', x: line[0], y: line[1], x2: line[2], y2: line[3] });
    const b = pl.buildings.find((q) => q.bt === 'wall');
    const ends = World.wallEnds(b);
    const perSec = b.maxHp * (1 - C.RAISE.hpFrom) / b.raiseFor;
    const hp0 = b.hp;
    /* a defender at the end of the shell, and a rival right on top of him */
    const held = put(w, 0, ends[0], ends[1], 'soldier');
    held.hp = held.maxHp = 4000;
    put(w, 1, ends[0] + 16, ends[1] + 16, 'soldier');
    step(w, 4);
    ok('a soldier strikes the living man, not the scaffolding', held.hp < 4000, `the defender is at ${Math.round(held.hp)}`);
    near('...and the masons are left to their work', b.hp, Math.min(b.maxHp, hp0 + perSec * 4), 2);
  }
}

/* A TOWER JOINS THE CURTAIN OR IT STANDS CLEAR OF IT — there is no third answer, and there
 * must be no OFFSET that gives one. The bug this suite exists for: the snap reached WALL.join
 * from the run while the crowding test measured BUILD.foot*2+gap from the wall's MIDPOINT, so
 * two different radii from two different points drew a band where a tower could neither join
 * the stone nor stand beside it. Every tap in the band came back 'too close to another work'
 * and there was no spot that would take it. One radius now, measured from the RUN, used by
 * both — which is a thing a test can state rather than sample. */
suite('a tower and a curtain leave no dead band');
{
  const w = World.createWorld(20260804, 2);
  const pl = w.players[0];
  pl.essence = 1e6;
  const c = w.map.sites[w.map.cities[0]];
  /* crews, hired well away from the ground under test so nothing but the wall can crowd it */
  const gd = C.BUILDINGS.gate;
  for (let i = 0; i < 4; i++)
    pl.buildings.push({ id: w.nextId++, bt: 'gate', level: 1, x: c.x - 520 - i * 12, y: c.y - 520,
                        cd: 0, raise: 0, raiseFor: gd.raise, hp: gd.hp, maxHp: gd.hp,
                        lastHurt: -99, node: -1, co: 0 });
  /* a run, wherever the map will take one */
  let run = null;
  for (let rad = 190; rad < 430 && !run; rad += 20)
    for (let a = 0; a < 48 && !run; a++) {
      const th = a / 48 * Math.PI * 2;
      const x = c.x + Math.cos(th) * rad, y = c.y + Math.sin(th) * rad;
      const x2 = x + 160, y2 = y;
      if (World.applyCommand(w, 0, { c: 'build', bt: 'wall', x, y, x2, y2 }).ok) run = { x, y, x2, y2 };
    }
  ok('a curtain goes up to test against', !!run);
  const wall = pl.buildings.filter((q) => q.bt === 'wall').pop();

  /* THE SCAFFOLDING COUNTS. A curtain is at its most interesting while the masons are still
   * in it — that is when you are planning its gatehouse — and going by `world.walls`, which
   * holds only finished runs, meant the answer was 'too close to another work' until it was
   * done and 'on the wall' a minute later, for the same tap. */
  {
    const p = { x: wall.x, y: wall.y + 30 };
    const r = World.applyCommand(w, 0, { c: 'build', bt: 'tower', x: p.x, y: p.y });
    const t = pl.buildings.filter((q) => q.bt === 'tower').pop();
    ok('a tower joins a run the masons are still raising', r.ok && t && t.onWall === wall.id,
       r.ok ? `onWall ${t && t.onWall}` : r.err);
    if (r.ok) pl.buildings.splice(pl.buildings.indexOf(t), 1);
  }

  for (let i = 0; i < 60 * 30; i++) World.update(w, 1 / 30);
  ok('...and it finishes', !wall.raise && w.anyWall, `raise ${wall.raise}`);

  /* the sweep: straight out from the run, at three places ALONG it — the middle, where the
   * midpoint measurement was tightest, and either end, where it was no measurement at all */
  const bad = [];
  const joined = [], stood = [];
  for (const along of [0, 0.4, -0.4]) {
    for (let d = 0; d <= C.WALL.join + 60; d += 4) {
      const x = wall.x + (wall.x2 - wall.x) * along, y = wall.y + d;
      const r = World.applyCommand(w, 0, { c: 'build', bt: 'tower', x, y });
      if (!r.ok) { if (r.err === 'crowded') bad.push(`${along}@${d}`); continue; }
      const t = pl.buildings.pop();
      (t.onWall ? joined : stood).push(d);
    }
  }
  eq('no tap near your own curtain is ever refused as crowded', bad.length, 0, bad.join(' '));
  ok('...taps on the stone join it', joined.length > 0 && Math.max(...joined) >= C.WALL.join - 4,
     `joined out to ${joined.length ? Math.max(...joined) : 'none'}`);
  ok('...and taps past the snap stand on their own', stood.length > 0 && Math.min(...stood) > C.WALL.join,
     `stood from ${stood.length ? Math.min(...stood) : 'none'}`);
  ok('every offset gave one answer or the other', joined.length + stood.length > 0 &&
     Math.max(...joined) < Math.min(...stood), `join <= ${Math.max(...joined)} < stand ${Math.min(...stood)}`);

  /* and the rule the whole thing rests on: ONE radius, so a band cannot be reintroduced by
   * tuning one of the two numbers and forgetting the other */
  {
    const t = pl.buildings.filter((q) => q.bt === 'tower');
    ok('a run crowds by its length, not by its middle',
       World.placementError(w, 0, wall.x2, wall.y2 + 20, 'barracks') === 'crowded' &&
       World.placementError(w, 0, wall.x2, wall.y2 + C.WALL.join + 30, 'barracks') !== 'crowded',
       `end+20 ${World.placementError(w, 0, wall.x2, wall.y2 + 20, 'barracks')}`);
    eq('and nothing was left standing by the sweep', t.length, 0);
  }
}

/* AND WITH A HALL. A Seat with no muster is an heir who spends his first half-minute raising
 * the one work he was always going to raise first — the same opening every match, chosen by
 * nobody. The board hands it over and the choosing starts at the second work. */
suite('every heir opens with a hall as well as a Gate');
for (const n of [2, 3, 4]) {
  for (const seed of [1, 1000, 31337]) {
    const w = World.createWorld(seed, n);
    for (let pi = 0; pi < n; pi++) {
      const pl = w.players[pi], c = World.cityOf(w, pi);
      const gates = pl.buildings.filter((b) => b.bt === 'gate');
      const halls = pl.buildings.filter((b) => b.bt === 'barracks');
      eq(`${n}p seed ${seed} seat ${pi}: one Gate`, gates.length, 1);
      eq(`${n}p seed ${seed} seat ${pi}: and one hall`, halls.length, 1);
      const h = halls[0];
      ok(`${n}p seed ${seed} seat ${pi}: the hall is finished`, !h.raise && h.hp === h.maxHp);
      ok(`${n}p seed ${seed} seat ${pi}: ...standing inside the writ`,
         World.inClaim(w, pi, h.x, h.y), `${Math.round(Math.hypot(h.x - c.x, h.y - c.y))} from the Seat`);
      ok(`${n}p seed ${seed} seat ${pi}: ...clear of the Seat's own ground`,
         Math.hypot(h.x - c.x, h.y - c.y) > C.CITY.seatR, String(Math.round(Math.hypot(h.x - c.x, h.y - c.y))));
      ok(`${n}p seed ${seed} seat ${pi}: ...and off the spring, which is the Gate's`,
         !World.nodeAt(w, h.x, h.y));
      /* it raises its OWN standard: the tray has a chip in it from the first frame */
      ok(`${n}p seed ${seed} seat ${pi}: it flies a standard`, h.co > 0, String(h.co));
      eq(`${n}p seed ${seed} seat ${pi}: ...and the company exists`,
         pl.companies.filter((q) => q.id === h.co).length, 1);
    }
  }
}
{
  /* the same board twice must place it the same way, or a guest and a host disagree about
   * where the opening hall is before a single command has been given */
  const a = World.createWorld(4242, 2), b = World.createWorld(4242, 2);
  const at = (w, pi) => w.players[pi].buildings.filter((q) => q.bt === 'barracks')[0];
  for (let pi = 0; pi < 2; pi++)
    ok(`the same seed puts seat ${pi}'s hall in the same place`,
       at(a, pi).x === at(b, pi).x && at(a, pi).y === at(b, pi).y,
       `${at(a, pi).x},${at(a, pi).y} vs ${at(b, pi).x},${at(b, pi).y}`);
  /* and it musters: an heir with a hall from the first second has men before he builds */
  const w = World.createWorld(4242, 2);
  w.chaosNext = 1e9;
  w.players[0].essence = 1e5; w.players[1].essence = 1e5;
  for (let i = 0; i < 30 * 30; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  ok('an heir who has built nothing still has an army at half a minute',
     w.units.filter((u) => u.owner === 0).length > 0,
     `${w.units.filter((u) => u.owner === 0).length} men`);
}

/* MEN HAVE WIDTH. Nothing kept one soldier off another, so a column arrived stacked and a
 * melee was a single point with a hundred sprites in it — an army of twenty and an army of two
 * hundred looked the same. Two rules together: a FORMATION that hands each man a place a berth
 * from his neighbours, and a SEPARATION pass for the transient crowding a march produces. */
suite('men have width');
{
  const w = World.createWorld(1000, 2), pl = w.players[0], c = World.cityOf(w, 0);
  w.chaosNext = 1e9;
  pl.essence = 1e6;
  for (let a = 0; a < 40; a++) {
    const th = a / 40 * Math.PI * 2;
    World.applyCommand(w, 0, { c: 'build', x: c.x + Math.cos(th) * 210, y: c.y + Math.sin(th) * 210, bt: 'barracks' });
  }
  for (let i = 0; i < 30 * 240; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  const mine = () => w.units.filter((u) => u.owner === 0);
  const spacing = () => {
    const us = mine();
    let sum = 0, worst = 1e9;
    for (const a of us) {
      let m = 1e9;
      for (const b of us) { if (a === b) continue; const d = Math.hypot(a.x - b.x, a.y - b.y); if (d < m) m = d; }
      sum += m; worst = Math.min(worst, m);
    }
    return { n: us.length, avg: sum / us.length, worst };
  };
  const home = spacing();
  ok('an army was mustered', home.n > 30, `${home.n} men`);
  ok('a man at home stands about a berth from his nearest neighbour',
     home.avg > C.CROWD.space * 0.7, `${home.avg.toFixed(1)} against a berth of ${C.CROWD.space}`);
  /* IN THE OPEN. A man held against the wall of a hall cannot give way — stone has the last
   * word, and two men handed the same bearing off the same building stand on the same foot of
   * ground until one of them is ordered elsewhere. That is the geometry, not a failure of the
   * crowd rule, so the claim is made where the rule actually governs. */
  const open = () => {
    const us = mine().filter((u) => !pl.buildings.some((b) => b.x2 == null &&
      Math.hypot(u.x - b.x, u.y - b.y) < C.BUILD.pass + 2));
    let worst = 1e9;
    for (const a of us) for (const b of us) {
      if (a === b) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < worst) worst = d;
    }
    return { n: us.length, worst };
  };
  const clear = open();
  ok('...and in the open nobody is standing inside anybody',
     clear.n > 10 && clear.worst > C.CROWD.space * 0.35,
     `${clear.n} men clear of a work, closest pair ${clear.worst.toFixed(1)}`);

  /* ...AND STILL SPREAD AFTER A MARCH, which is where a formation usually collapses */
  pl.banner = { x: c.x + 700, y: c.y + 300, site: -1 };
  for (let i = 0; i < 30 * 40; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  const far = spacing();
  ok('an army that has marched is still spread', far.avg > C.CROWD.space * 0.7,
     `${far.avg.toFixed(1)} after a march`);

  /* AND IT COMES TO REST. A separation rule that over-corrects looks fine in a snapshot and
   * shivers in motion — men trading a rounding error back and forth thirty times a second. */
  const us = mine();
  let moved = 0, n = 0;
  for (let i = 0; i < 30; i++) {
    const was = us.map((u) => ({ x: u.x, y: u.y }));
    World.update(w, C.SIM_DT); w.events.length = 0;
    us.forEach((u, k) => { moved += Math.hypot(u.x - was[k].x, u.y - was[k].y); n++; });
  }
  const drift = moved / n;
  ok('a settled army stands still', drift < C.UNITS.soldier.speed * C.SIM_DT * 0.15,
     `${drift.toFixed(3)} a tick against a stride of ${(C.UNITS.soldier.speed * C.SIM_DT).toFixed(2)}`);

  /* the formation is what does the work, and it is deterministic: the same board twice puts
   * the same man in the same place, or a guest and a host disagree about where the army is */
  const a = World.createWorld(4242, 2), b = World.createWorld(4242, 2);
  for (const q of [a, b]) { q.chaosNext = 1e9; for (let i = 0; i < 30 * 90; i++) { World.update(q, C.SIM_DT); q.events.length = 0; } }
  const pa = a.units.filter((u) => u.owner === 0), pb = b.units.filter((u) => u.owner === 0);
  eq('the same board musters the same army', pa.length, pb.length);
  ok('...and puts every man in the same place',
     pa.every((u, i) => Math.abs(u.x - pb[i].x) < 1e-6 && Math.abs(u.y - pb[i].y) < 1e-6));
}

/* A COMPANY MAY GO QUIET WITHOUT THE REALM GOING QUIET. The muster valve was the Seat's alone,
 * so hoarding for a Gate meant stopping every hall you own — the one holding the line
 * included. Named with a company it silences that standard's halls and no others. */
suite('the muster is halted by standard, not only by realm');
{
  const w = World.createWorld(1000, 2), pl = w.players[0];
  w.chaosNext = 1e9;
  pl.essence = 1e6;
  const c = World.cityOf(w, 0);
  /* a second hall under a standard of its own, so there are two companies to tell apart */
  let put = 0;
  for (let a = 0; a < 40 && put < 1; a++) {
    const th = a / 40 * Math.PI * 2, x = c.x + Math.cos(th) * 210, y = c.y + Math.sin(th) * 210;
    if (World.applyCommand(w, 0, { c: 'build', x, y, bt: 'barracks' }).ok) put++;
  }
  eq('a second hall stands', put, 1);
  for (let i = 0; i < 30 * 40; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  const halls = pl.buildings.filter((b) => b.bt === 'barracks' && !b.raise);
  eq('two halls, under two standards', new Set(halls.map((b) => b.co)).size, 2);
  const quiet = halls[0].co, loud = halls[1].co;

  const count = (co) => w.units.filter((u) => u.owner === 0 && u.co === co).length;
  ok('one standard is halted', World.applyCommand(w, 0, { c: 'muster', co: quiet, pause: true }).ok);
  const q0 = count(quiet), l0 = count(loud);
  for (let i = 0; i < 30 * 60; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  eq('...and it musters nobody', count(quiet), q0);
  ok('...while the rest of the realm carries on', count(loud) > l0, `${l0} → ${count(loud)}`);
  eq('...and the realm-wide valve was never touched', pl.musterPaused, false);

  /* it lifts, and it rides the wire, and it is nobody else's business */
  ok('the standard resumes', World.applyCommand(w, 0, { c: 'muster', co: quiet, pause: false }).ok);
  const q1 = count(quiet);
  for (let i = 0; i < 30 * 60; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  ok('...and musters again', count(quiet) > q1, `${q1} → ${count(quiet)}`);
  World.applyCommand(w, 0, { c: 'muster', co: quiet, pause: true });
  const snap = Net.snapFor(w, 0);
  eq('a halted standard rides the wire', (snap.players[0].companies.find((q) => q.id === quiet) || {}).paused, 1);
  eq('...and a rival is told nothing of your companies', Net.snapFor(w, 1).players[0].companies.length, 0);
  eq('a standard that is not yours is refused',
     World.applyCommand(w, 0, { c: 'muster', co: 999, pause: true }).err, 'co');

  /* AND THE REALM-WIDE ORDER STILL WORKS, and the two stack rather than countermanding */
  World.applyCommand(w, 0, { c: 'muster', pause: true });
  const both = count(loud);
  for (let i = 0; i < 30 * 60; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  eq('the Seat can still silence everything', count(loud), both);
  World.applyCommand(w, 0, { c: 'muster', pause: false });
  const after = count(quiet);
  for (let i = 0; i < 30 * 60; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  eq('...and lifting it does not lift a standard you halted yourself', count(quiet), after);
}

/* A WORK IS SOMETHING YOU WALK ROUND. Men marched straight through their own halls, so an
 * army at home buried every building it passed — and a building under a crowd cannot be
 * tapped, which is how you raise it a level. Reported from play as exactly that. */
suite('men walk round a work, not through it');
{
  const w = World.createWorld(1000, 2), pl = w.players[0];
  w.chaosNext = 1e9;
  const hall = pl.buildings.find((b) => b.bt === 'barracks');
  ok('the opening hall is there to walk round', !!hall);
  const d = C.UNITS.soldier;
  /* a company put down ON the hall, which is what a muster at home looks like */
  const men = [];
  for (let i = 0; i < 24; i++) {
    const a = i * 2.399;
    const u = { id: w.nextId++, owner: 0, kind: 'soldier', tier: 1,
                x: hall.x + Math.cos(a) * (i % 5), y: hall.y + Math.sin(a) * (i % 5),
                ox: 0, oy: 0, hp: 90, maxHp: 90, dmg: d.dmg, cd: 0, goal: null, co: 0, from: -1 };
    w.units.push(u); men.push(u);
  }
  const inside = () => men.filter((u) => Math.hypot(u.x - hall.x, u.y - hall.y) < C.BUILD.pass - 0.5).length;
  eq('they start standing in it', inside(), men.length);
  for (let i = 0; i < 30; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  eq('...and one second later not one of them is', inside(), 0);

  /* AND THEY GO ROUND IT RATHER THAN STOPPING AT IT: a column ordered past a work still
   * arrives, or 'walk round' would be 'walk into'. */
  const far = { x: hall.x + 600, y: hall.y };
  pl.banner = { x: far.x, y: far.y, site: -1 };
  const near0 = men.map((u) => Math.hypot(u.x - far.x, u.y - far.y));
  for (let i = 0; i < 30 * 25; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  const near1 = men.filter((u) => u.hp > 0).map((u) => Math.hypot(u.x - far.x, u.y - far.y));
  const closed = near1.filter((q, i) => q < near0[i] - 100).length;
  ok('a column ordered past a work still gets there', closed >= near1.length * 0.6,
     `${closed} of ${near1.length} closed 100+ on the order`);
  eq('...and none of them ended up inside the hall', inside(), 0);

  /* a work at the very centre of a man is still a work: he is put out, not left in */
  const stuck = men[0];
  stuck.x = hall.x; stuck.y = hall.y;
  World.update(w, C.SIM_DT); w.events.length = 0;
  ok('a man exactly on a work is put out of it',
     Math.hypot(stuck.x - hall.x, stuck.y - hall.y) >= C.BUILD.pass - 0.5,
     `${Math.hypot(stuck.x - hall.x, stuck.y - hall.y).toFixed(1)} from its middle`);
}

/* A WALK YOU CANNOT PAY FOR IS A LOSS YOU CHOSE. Every doctrine gated the Pattern on a
 * SNAPSHOT of the treasury — "essence > 200" — which says nothing about whether the realm can
 * carry the Shrine's drain for the nine and a half minutes a walk takes. From a played match
 * at PRINCE: Benedict set foot on the Pattern at 4:03 with seven works, ran his treasury to
 * zero and held it there, could not pay his muster, watched his army fall from thirty-nine to
 * three, and spent six minutes being dismantled — reaching 21% and then DECAYING back to 16%.
 * He did not lose the race. He lost the game to have entered it. */
suite('an heir does not walk himself broke');
{
  const shrineDrain = C.BUILDINGS.shrine.drain[0];
  const w = World.createWorld(1000, 2), pl = w.players[0];
  w.chaosNext = 1e9;
  const bot = AI.make('benedict');
  const iss = (cmd) => World.applyCommand(w, 0, cmd);
  /* hand him a Shrine and a purse, and NOT the ground to pay for a walk */
  const c = World.cityOf(w, 0);
  const sd = C.BUILDINGS.shrine;
  pl.buildings.push({ id: w.nextId++, bt: 'shrine', level: 1, x: c.x + 200, y: c.y, cd: 0,
                      raise: 0, raiseFor: sd.raise, hp: sd.hp, maxHp: sd.hp, lastHurt: -99,
                      node: -1, co: 0 });
  pl.essence = 4000;
  let sawWalk = false, brokeWhileWalking = 0;
  for (let i = 0; i < 30 * 600 && w.winner === null; i++) {
    bot.step(w, 0, iss, C.SIM_DT);
    World.update(w, C.SIM_DT); w.events.length = 0;
    if (pl.walking) { sawWalk = true; if (pl.essence < 1) brokeWhileWalking++; }
  }
  ok('the heir raised a realm and at some point walked', sawWalk || pl.pattern > 0,
     `pattern ${pl.pattern.toFixed(1)}%`);
  /* the whole point: he may walk, he may stop, but he must never sit on the Pattern with an
   * empty treasury while his muster goes unpaid */
  ok('...and never held the Pattern with an empty treasury', brokeWhileWalking < 30,
     `${(brokeWhileWalking / 30).toFixed(1)}s walking at zero`);

  /* and the rule stated directly: the two conditions the shared gate applies */
  ok('a walk needs a realm that earns most of the drain', shrineDrain > 0);
  const poor = World.createWorld(1000, 2), pp = poor.players[0];
  poor.chaosNext = 1e9;
  pp.buildings.push({ id: poor.nextId++, bt: 'shrine', level: 1, x: c.x + 200, y: c.y, cd: 0,
                      raise: 0, raiseFor: sd.raise, hp: sd.hp, maxHp: sd.hp, lastHurt: -99,
                      node: -1, co: 0 });
  pp.essence = 100000;                 // rich for a moment, and earning almost nothing
  const bot2 = AI.make('benedict');
  const iss2 = (cmd) => World.applyCommand(poor, 0, cmd);
  for (let i = 0; i < 30 * 60; i++) {
    bot2.step(poor, 0, iss2, C.SIM_DT);
    World.update(poor, C.SIM_DT); poor.events.length = 0;
    pp.essence = 100000;               // a purse that never empties, so only INCOME can decide
  }
  ok('a full purse is not a reason to walk — the ground has to earn it',
     !pp.walking || pp.incomeRate >= shrineDrain * 0.85,
     `walking=${pp.walking} on ${(pp.incomeRate || 0).toFixed(1)}/s against a ${shrineDrain}/s drain`);
}

/* A GATE STANDS ON THE SPRING. It may be raised anywhere within NODE.r of one and it used to
 * be left wherever the finger landed, so the work that draws Shadow out of the ground sat on
 * the bank of its own pool — up to ninety-six from the water — and the picture said the two
 * had nothing to do with each other. Reported from play with a screenshot of the Weeping Well.
 * There is one right place for a Gate and the sim knows exactly where it is. */
suite('a Gate stands on its spring, not beside it');
for (const seed of SEEDS) {
  const w = World.createWorld(seed, 2), pl = w.players[0];
  pl.essence = 1e6;
  w.chaosNext = 1e9;
  const home = pl.buildings.find((b) => b.bt === 'gate');
  const hs = w.map.sites[home.node];
  ok(`seed ${seed}: the opening Gate has a spring under it`, !!hs && hs.kind === 'node');
  near(`seed ${seed}: ...and stands on its middle`, Math.hypot(home.x - hs.x, home.y - hs.y), 0, 0.01);

  /* and one raised in play, aimed deliberately off to the side of the pool */
  const free = w.map.sites.find((q) => q.kind === 'node' && World.nodeHolder(w, q) === -1);
  ok(`seed ${seed}: there is a spring left to take`, !!free);
  const d = C.UNITS.soldier;
  w.units.push({ id: w.nextId++, owner: 0, kind: 'soldier', tier: 1, x: free.x, y: free.y,
                 ox: 0, oy: 0, hp: 90, maxHp: 90, dmg: d.dmg, cd: 0, goal: null, co: 0, from: -1 });
  const off = C.NODE.r * 0.7;
  const r = World.applyCommand(w, 0, { c: 'build', bt: 'gate', x: free.x + off, y: free.y });
  ok(`seed ${seed}: a Gate aimed at the bank is accepted`, r.ok, r.err);
  if (r.ok) {
    const b = pl.buildings.filter((q) => q.bt === 'gate').pop();
    near(`seed ${seed}: ...and lands on the spring's middle, not where it was aimed`,
         Math.hypot(b.x - free.x, b.y - free.y), 0, 0.01);
    eq(`seed ${seed}: ...and draws on that spring`, b.node, free.id);
  }
}

/* PRICED BY THE FOOT, AND SHORT RUNS ARE ALLOWED — with one thing given up for it. Rounding a
 * run's length up to a whole crew meant a short stretch across a gap was billed as the long
 * wall it was not, so there was never a reason to draw one; and a minimum length on top of
 * that meant the gap simply could not be closed. Both are gone. What a short run does NOT get
 * is a gateway: the gate is cut out of the middle of the run, so on a stretch barely wider
 * than the hole there is no wall left either side of it. Under WALL.gateMin the stone is
 * solid, and it stops the heir who raised it as surely as anyone else. */
suite('a run is bought by the foot');
{
  const def = C.BUILDINGS.wall;
  ok('there is no longest run — only how many crews you can put on one', !def.span[1]);
  ok('...and the shortest is a token, not a wall-length', def.span[0] < C.WALL.unit / 4,
     `${def.span[0]} against a run of ${C.WALL.unit}`);
  ok('a gateway needs more stone than the gate is wide', C.WALL.gateMin > C.WALL.gate * 2,
     `${C.WALL.gateMin} vs a ${C.WALL.gate * 2}-wide hole`);

  const w = World.createWorld(777, 2), pl = w.players[0];
  pl.essence = 1e6;
  w.chaosNext = 1e9;
  const c = w.map.sites[w.map.cities[0]], gd = C.BUILDINGS.gate;
  for (let i = 0; i < 4; i++)
    pl.buildings.push({ id: w.nextId++, bt: 'gate', level: 1, x: c.x - 520 - i * 12, y: c.y - 520,
                        cd: 0, raise: 0, raiseFor: gd.raise, hp: gd.hp, maxHp: gd.hp,
                        lastHurt: -99, node: -1, co: 0 });
  /* one direction, four lengths on it: the price has to be a straight line through them */
  let base = null;
  for (let rad = 190; rad < 430 && !base; rad += 20)
    for (let a = 0; a < 48 && !base; a++) {
      const th = a / 48 * Math.PI * 2;
      const x = c.x + Math.cos(th) * rad, y = c.y + Math.sin(th) * rad;
      const ux = -Math.sin(th), uy = Math.cos(th);
      if (World.wallError(w, 0, x, y, x + ux * 300, y + uy * 300)) continue;
      if (World.wallError(w, 0, x, y, x + ux * 40, y + uy * 40)) continue;
      base = { x, y, ux, uy };
    }
  ok('a line the ground will take at any length was found', !!base);

  const priced = [];
  for (const len of [40, 90, 150, 300]) {
    const before = pl.essence;
    const r = World.applyCommand(w, 0, { c: 'build', bt: 'wall', x: base.x, y: base.y,
                                         x2: base.x + base.ux * len, y2: base.y + base.uy * len });
    ok(`a run of ${len} is raised`, r.ok, r.err);
    if (!r.ok) continue;
    const b = pl.buildings.filter((q) => q.bt === 'wall').pop();
    priced.push({ len, paid: before - pl.essence, hp: b.maxHp, crews: b.crews, gated: !!b.gated });
    pl.buildings.splice(pl.buildings.indexOf(b), 1);
  }
  eq('every length went up, the short ones included', priced.length, 4);
  for (const q of priced) {
    near(`a run of ${q.len} costs its length`, q.paid, def.cost * q.len / C.WALL.unit, 1);
    near(`...and is worth its length in stone`, q.hp, def.hp * q.len / C.WALL.unit, 1e-6);
  }
  /* the whole point, stated as the ratio: twice the wall is twice the price, and a run of a
   * third of a crew is a third of the price rather than the whole card */
  near('twice the wall is twice the price', priced[3].paid, priced[2].paid * 2, 1);
  near('...and a quarter of it a quarter', priced[0].paid, priced[2].paid * (40 / 150), 1);
  ok('...which is a fraction of what a crew-rounded run charged', priced[0].paid < def.cost * 0.4,
     `${Math.round(priced[0].paid)} against the ${def.cost} it used to be`);
  /* the CREWS still round up, because you cannot put two thirds of a crew on anything */
  eq('a run under one crew still takes a whole one', priced[0].crews, 1);
  eq('...and so does a run of exactly one', priced[2].crews, 1);
  eq('...while a double run takes two', priced[3].crews, 2);

  /* and the gateway, which is what a short run pays with */
  eq('a short run has no gateway', priced[0].gated, false);
  eq('...nor one barely wider than the hole', priced[1].gated, false);
  eq('a run with stone to spare has one', priced[3].gated, true);

  /* the gate is not decoration: it is the hole the owner's own columns walk through, so a
   * run without one has to bar its owner along its WHOLE length */
  const solid = World.applyCommand(w, 0, { c: 'build', bt: 'wall', x: base.x, y: base.y,
                                           x2: base.x + base.ux * 60, y2: base.y + base.uy * 60 });
  ok('a solid stretch goes up', solid.ok, solid.err);
  const sb = pl.buildings.filter((q) => q.bt === 'wall').pop();
  for (let i = 0; i < 60 * 30; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  ok('...and it stands', !sb.raise && w.walls.length === 1);
  eq('...ungated', w.walls[0].gate, false);
  /* the gate is not decoration: it is the hole the owner's own columns walk through. A run
   * without one has to bar its owner along its WHOLE length, or 'no gate' is just a missing
   * ornament and the short run costs nothing at all. Measured the way the gated run is
   * measured, by marching a man at the middle of it. */
  {
    const ends = World.wallEnds(sb);
    const nx = -(ends[3] - ends[1]), ny = ends[2] - ends[0];
    const nL = Math.hypot(nx, ny) || 1;
    const sideOf = (d) => ({ x: sb.x + (nx / nL) * d, y: sb.y + (ny / nL) * d });
    const near2 = sideOf(70), far = sideOf(-260);
    const u = { id: w.nextId++, owner: 0, kind: 'soldier', tier: 1, x: near2.x, y: near2.y,
                ox: 0, oy: 0, hp: 90, maxHp: 90, dmg: C.UNITS.soldier.dmg, cd: 0,
                goal: null, co: 0, from: -1 };
    w.units.push(u);
    pl.banner = { x: far.x, y: far.y, site: -1 };
    /* THROUGH, NOT PAST. Sixty feet of stone is something a man walks ROUND, and he should —
     * the rule is that he may not walk THROUGH it. Asserting he never reaches the far side
     * tested the length of the run, not the rule, and it only ever passed because nothing
     * pushed him sideways; the moment a crowd could jostle him he strolled round the end and
     * the assertion failed for a thing that is entirely correct. Watch the stone itself. */
    let crossed = 0;
    for (let i = 0; i < 30 * 30; i++) {
      const px = u.x, py = u.y;
      World.update(w, C.SIM_DT); w.events.length = 0;
      if (u.hp > 0 && World.crosses(px, py, u.x, u.y, ends[0], ends[1], ends[2], ends[3])) crossed++;
    }
    eq('a heir cannot walk through his own ungated run', crossed, 0,
       `stepped through the stone ${crossed} times`);
  }
}

/* A CURTAIN THAT TURNS A CORNER. A tower of your own is a BASTION, not an obstacle: the game
 * already lets you raise one into your wall, and if the next stretch cannot then start at it,
 * end at it or pass it, a curtain that turns has to be drawn in disconnected pieces with gaps
 * a man walks through. Reported from play as 'too close to another work' on every run begun at
 * the tower one had just built into the wall. */
suite('a curtain turns at its bastion');
{
  const w = World.createWorld(4321, 2), pl = w.players[0];
  pl.essence = 1e6;
  w.chaosNext = 1e9;
  const c = w.map.sites[w.map.cities[0]], gd = C.BUILDINGS.gate;
  for (let i = 0; i < 4; i++)
    pl.buildings.push({ id: w.nextId++, bt: 'gate', level: 1, x: c.x - 520 - i * 12, y: c.y - 520,
                        cd: 0, raise: 0, raiseFor: gd.raise, hp: gd.hp, maxHp: gd.hp,
                        lastHurt: -99, node: -1, co: 0 });
  /* a first run, and a second one leaving its far end that the GROUND will take — found
   * before the tower goes up, so that what the tower does to the answer is the only thing
   * this measures */
  let first = null, turn = null;
  for (let rad = 190; rad < 430 && !turn; rad += 20)
    for (let a = 0; a < 48 && !turn; a++) {
      const th = a / 48 * Math.PI * 2;
      const x = c.x + Math.cos(th) * rad, y = c.y + Math.sin(th) * rad;
      if (World.wallError(w, 0, x, y, x + 160, y)) continue;
      for (let b = 0; b < 48 && !turn; b++) {
        const ph = b / 48 * Math.PI * 2;
        if (Math.abs(Math.sin(ph)) < 0.5) continue;   // a real turn, not a continuation
        const ex = x + 160 + Math.cos(ph) * 150, ey = y + Math.sin(ph) * 150;
        if (World.wallError(w, 0, x + 160, y, ex, ey)) continue;
        first = { x, y, x2: x + 160, y2: y }; turn = { ex, ey };
      }
    }
  ok('a run and a turn off its end were both found on open ground', !!turn);
  ok('the first run goes up', World.applyCommand(w, 0, { c: 'build', bt: 'wall', ...first }).ok);
  const wallA = pl.buildings.filter((q) => q.bt === 'wall').pop();
  for (let i = 0; i < 60 * 30; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  const e = World.wallEnds(wallA);
  eq('...and stands', wallA.raise, 0);

  /* the bastion, on the corner */
  const rt = World.applyCommand(w, 0, { c: 'build', bt: 'tower', x: e[2], y: e[3] });
  ok('a bastion is raised on its end', rt.ok, rt.err);
  const tw = pl.buildings.filter((q) => q.bt === 'tower').pop();
  eq('...standing on the run', tw.onWall, wallA.id);
  for (let i = 0; i < 60 * 30; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }

  eq('and the curtain still turns at it', World.wallError(w, 0, e[2], e[3], turn.ex, turn.ey), null);
  const rb = World.applyCommand(w, 0, { c: 'build', bt: 'wall', x: e[2], y: e[3], x2: turn.ex, y2: turn.ey });
  ok('...so the next stretch can be drawn from it', rb.ok, rb.err);
  /* but a run drawn back along stone that is already there is still refused — that is a wall
   * on a wall, which is the refusal doing its job */
  eq('a run drawn back over the old one is still refused',
     World.wallError(w, 0, e[2], e[3], e[0], e[1]), 'crowded');

  /* WHICH RUN A TOWER STANDS ON IS DERIVED. Stamped at build time it went stale both ways:
   * throw the curtain down and the tower was still drawn twenty-seven feet up on stone that
   * was gone; draw a new run through a tower and it never learned it was on one. */
  const wallB = pl.buildings.filter((q) => q.bt === 'wall').pop();
  for (let i = 0; i < 60 * 30; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  ok('the second run stands too', !wallB.raise && wallB.id !== wallA.id);
  ok('the bastion is on one of them', tw.onWall === wallA.id || tw.onWall === wallB.id, `${tw.onWall}`);
  World.hurtBuilding(w, 0, wallA.id, 1e9, 1);
  World.hurtBuilding(w, 0, wallB.id, 1e9, 1);
  ok('both runs are broken', wallA.breach === 1 && wallB.breach === 1);
  eq('and the bastion stands on rubble, which is to say on nothing', tw.onWall, undefined);
  const fx = World.applyCommand(w, 0, { c: 'fix', id: wallA.id });
  ok('the masons can put one back', fx.ok, fx.err);
  for (let i = 0; i < 90 * 30; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  eq('...and the bastion is on the curtain again', tw.onWall, wallA.id);
}

/* A LEVEL MAKES BETTER MEN, NOT MORE OF THEM. Halls used to buy THROUGHPUT — the same
 * soldier arriving faster — so an upgraded realm fought with bigger crowds of identical men
 * and there was nothing to see. The muster interval is flat now and the level rides on the
 * recruit, who keeps it for life. The numbers are the old rate ratios exactly, on the price
 * as well as the stats, so the essence buys the same total hit points and the same total
 * damage per minute as before: what changed is the PACKAGING. */
suite('veterans, not crowds')
{
  const b = C.BUILDINGS.barracks;
  eq('a hall musters at one rate, whatever its level', new Set(b.period).size, 1);
  eq('...and so does the Spire', new Set(C.BUILDINGS.spire.period).size, 1);
  eq('...and the Works', new Set(C.BUILDINGS.siege.period).size, 1);
  eq('there is a rank for every level', C.TIER.length, C.MAX_LEVEL);
  eq('rank 1 is exactly the man we always had', C.TIER[0], 1);
  ok('and every rank after is better', C.TIER[1] > C.TIER[0] && C.TIER[2] > C.TIER[1], C.TIER.join('/'));

  /* THE ECONOMY IS UNCHANGED. Same drain, same hit points and same damage per minute at
   * every level as the throughput upgrade bought — this is the assertion that says the swap
   * was a repackaging and not a buff. */
  const u = C.UNITS.soldier, OLD = [8, 6.4, 5.0];
  for (let L = 1; L <= 3; L++) {
    const m = C.TIER[L - 1], per = b.period[L - 1];
    near(`level ${L} drains what it always did`, (u.cost * m) / per, u.cost / OLD[L - 1], 0.05);
    near(`level ${L} delivers the hit points it always did`, (60 / per) * u.hp * m, (60 / OLD[L - 1]) * u.hp, 2);
    near(`level ${L} delivers the damage it always did`, (60 / per) * u.dmg * m, (60 / OLD[L - 1]) * u.dmg, 0.4);
  }

  /* and in the sim: a level-2 hall musters a heavier man, not a faster one */
  const w = World.createWorld(1000);
  w.chaosNext = 1e9;
  const c = World.cityOf(w, 0), pl = w.players[0];
  pl.essence = 100000;
  World.applyCommand(w, 0, { c: 'build', bt: 'barracks', x: c.x + 130, y: c.y });
  const run = (secs) => { for (let i = 0; i < 30 * secs; i++) { World.update(w, C.SIM_DT); w.events.length = 0; } };
  run(C.BUILDINGS.barracks.raise + 1);
  const hall = pl.buildings.find((q) => q.bt === 'barracks');
  run(30);
  const recruits = w.units.filter((q) => q.owner === 0);
  ok('a level-1 hall musters men', recruits.length > 0, recruits.length);
  eq('...of the rank it is', recruits[0].tier, 1);
  eq('...with the stats we have always had', recruits[0].maxHp, C.UNITS.soldier.hp);

  /* THE MASONS TAKE TIME, AND THE HALL GOES QUIET. That is the real cost of a level. */
  const before = w.units.filter((q) => q.owner === 0).length;
  const fromHall = w.units.filter((q) => q.owner === 0 && q.from === hall.id).length;
  const up = World.applyCommand(w, 0, { c: 'up', id: hall.id });
  ok('the hall can be raised a level', up.ok, up.err);
  ok('...and it takes masonry, not a moment', hall.work > 0, hall.work);
  /* AND IT TAKES A CREW. The crew was taken off this once, because against one mason per
   * three Gates it taxed whoever expanded hardest out of the game — measured, and reverted.
   * The purse is a different size now: a crew per Gate, and a Gate standing from the first
   * second, so masonry can be masonry again and the ration is what stops a rich heir raising
   * his whole realm a level at once. */
  eq('...and it takes a crew, because masonry is masonry', World.rising(w, 0), 1);
  eq('...so the yard is spoken for while they are in it', World.masons(w, 0) - World.rising(w, 0), 0);
  run(Math.ceil(hall.work) - 1);
  /* THIS hall musters nobody. Counting the whole army would count the opening hall's muster
   * too, which never stopped — the assertion is about the work the masons are in. */
  eq('the hall musters nobody while they are in it',
     w.units.filter((q) => q.owner === 0 && q.from === hall.id).length, fromHall);
  ok('...but it still stands, and can still be broken', hall.hp > 0 && hall.maxHp > 0);
  run(3);
  eq('the masons finish', hall.work, 0);
  eq('...at the level that was paid for', hall.level, 2);

  /* and now the men are different men */
  run(30);
  const vets = w.units.filter((q) => q.owner === 0 && q.tier === 2);
  ok('the hall musters veterans', vets.length > 0, vets.length);
  near('...who are tougher', vets[0].maxHp, C.UNITS.soldier.hp * C.TIER[1], 0.01);
  near('...and hit harder', vets[0].dmg, C.UNITS.soldier.dmg * C.TIER[1], 0.01);
  ok('a veteran keeps his rank after the hall falls',
     (() => { World.hurtBuilding(w, 0, hall.id, 1e9, 1); return w.units.some((q) => q.tier === 2); })());
}

/* THE HALT. Anyone at the table may call one and anyone may lift it, and it stops the WORLD
 * rather than merely hiding it: no clock, no muster, no Chaos, and no orders. A pause you can
 * build through is a planning phase, and in a duel it is a way to buy thinking time the other
 * heir does not get. */
/* THE TRUMP ANSWERS ITS OWN CARD. Everything that fights answers a flag now, and the champion
 * answered none: he was spawned under the old company 0 — "follows the gold banner" — and the
 * gold banner is gone, so he walked wherever the Recall last pointed and could be ordered
 * nowhere else. His company is MARKED, so the tray can draw it as a card rather than as
 * another numbered detachment, and the hall chooser never offers it. */
suite('the Trump has its own standard')
{
  const w = World.createWorld(1000, 2);
  w.chaosNext = 1e9;
  const pl = w.players[0];
  pl.essence = 100000;
  /* the opening hall's standard is already flying: no Trump's is */
  const was = pl.companies.length;
  eq('no TRUMP standard flies before he is called', pl.companies.filter((q) => q.trump).length, 0);
  ok('the Trump can be played', World.applyCommand(w, 0, { c: 'power', k: 'trump' }).ok);
  const ch = w.units.find((u) => u.kind === 'champion');
  ok('a Champion answers it', !!ch);
  ok('...under a standard of his own', ch.co > 0, `co ${ch.co}`);
  eq('...which is one more company', pl.companies.length - was, 1);
  const tc = pl.companies.filter((q) => q.trump)[0];
  ok('...and it is the only one so marked', pl.companies.filter((q) => q.trump).length === 1);
  ok('...marked as the Trump\'s', !!tc.trump);
  eq('...and it is his', tc.id, ch.co);

  /* it is a real standard: he goes where it is planted, like any other company */
  const site = w.map.sites.find((s) => s.kind === 'node');
  ok('the card can be planted', World.applyCommand(w, 0, { c: 'rally', co: tc.id, site: site.id }).ok);
  World.update(w, C.SIM_DT);
  ok('and the Champion answers it', ch.goal && ch.goal.site === site.id,
     JSON.stringify(ch.goal));

  /* a hall must never be able to muster into it — one summoned Amberite is not a company */
  const c = World.cityOf(w, 0);
  let at = null;
  for (let rad = 170; rad < 400 && !at; rad += 20)
    for (let a = 0; a < 40 && !at; a++) {
      const th = a / 40 * Math.PI * 2, x = c.x + Math.cos(th) * rad, y = c.y + Math.sin(th) * rad;
      if (World.placementError(w, 0, x, y, 'barracks') === null) at = { x, y };
    }
  ok('there is ground for a hall', !!at);
  World.applyCommand(w, 0, { c: 'build', ...at, bt: 'barracks' });
  const hall = pl.buildings.filter((b) => b.bt === 'barracks').pop();
  ok('a hall raised beside it takes a standard of its OWN', hall.co !== tc.id, `co ${hall.co}`);

  /* and when he falls, his card goes with him */
  ch.hp = 0;
  for (let i = 0; i < 30 * 2; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  ok('a fallen Champion takes his card off the tray', !pl.companies.some((q) => q.trump),
     JSON.stringify(pl.companies));
}

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
  /* The top rung used to BE the unhandicapped heir — eco 1, hold 0 — and it is not any more:
   * every footing was eased. What must still hold is that the top is nearly that heir and
   * gives you almost no grace, or the ladder has no top. The unhandicapped reference lives in
   * `node sim.js`, where the heirs fight each other, not here. */
  ok('the hardest footing is very nearly a full-strength heir', D.prince.eco >= 0.85 && D.prince.eco <= 1,
     String(D.prince.eco));
  ok('...that comes for you almost at once', D.prince.hold <= 150, `${D.prince.hold}s`);
  ok('the default is not the hardest', C.DIFFICULTY_DEFAULT !== 'prince', C.DIFFICULTY_DEFAULT);
  /* and every rung is easier than it was — the whole point of the change */
  ok('every footing leaves more room than the old table did',
     D.squire.eco < 0.55 && D.heir.eco < 0.72 && D.prince.eco < 1.0,
     order.map((k) => D[k].eco).join(' '));
  ok('...and every one of them holds off longer',
     D.squire.hold > 720 && D.heir.hold > 360 && D.prince.hold > 0,
     order.map((k) => D[k].hold).join(' '));
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
  /* EIGHT MAPS, NOT THREE. The survival bar was `2 of 3`, on a thing that happens about half
   * the time — a 57% chance of passing on a healthy build, which is a coin toss wearing an
   * assertion's clothes. It flipped on a change that provably had nothing to do with it
   * (measured at 6/10 before and 5/10 after). More maps, and a bar low enough to mean
   * something: what this must catch is a Squire that is ERASED, not one that loses a close
   * one. The rate is printed so a real slide is visible even while the test passes.
   * The rate itself, ~55% against the random ghost, is not good and is not this suite's to
   * fix — see the skill-gradient target in DESIGN_PRINCIPLES. */
  const hold = D.squire.hold;
  let worst = 1e9, built = 0, lived = 0, maps = 0;
  for (const seed of [1000, 7, 42, 1, 31337, 777, 4242, 99]) {
    maps++;
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
  ok('...and spends the time building a realm of its own', built >= maps * 0.6,
     `${built} of ${maps} maps`);
  ok('...an heir, not a victim: it is not simply erased', lived >= 3,
     `still standing on ${lived} of ${maps} maps`);
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
  ok('the rifts swell early', C.CHAOS.count(600) > C.CHAOS.count(300),
     `${C.CHAOS.count(300)} then ${C.CHAOS.count(600)} per rift`);
  /* ...AND THEN THEY STOP. This was the one dial with no ceiling on it, and it was the one
   * that mattered: fiends per rift climbed forever, so at half an hour the black road sent
   * eleven at a time every twenty seconds and a long match stopped being decidable by the
   * heirs at all. Reported from play. A director presses; it does not escalate without end. */
  const rate = (t) => C.CHAOS.count(t) * 60 / C.CHAOS.interval(t);
  eq('but they stop swelling', C.CHAOS.count(1800), C.CHAOS.count(5400));
  eq('...and so does the rate they arrive at', C.CHAOS.interval(1800), C.CHAOS.interval(5400));
  ok('so the black road plateaus inside ten minutes',
     Math.abs(rate(600) - rate(5400)) < rate(5400) * 0.3,
     `${rate(600).toFixed(1)}/min at 10m, ${rate(5400).toFixed(1)}/min forever after`);
  ok('...and the plateau is a tax, not an opponent', rate(5400) < 14,
     `${rate(5400).toFixed(1)} fiends a minute`);
  /* the shape of the whole schedule: it rises, and every part of it has a top */
  for (const f of ['count', 'interval', 'hpScale', 'dmgScale'])
    eq(`${f} has a ceiling`, C.CHAOS[f](3600), C.CHAOS[f](36000));
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
  /* ONE CREW PER GATE, and none from the Seat itself — the yard grows with the ground you
   * hold. Every heir opens with a Gate on his own spring, so that first Gate is his first
   * crew and nobody starts unable to build. */
  eq('the crews come from the ground, not the Seat', C.MASONS.base, 0);
  eq('and a crew is hired for every Gate', C.MASONS.per, 1);
  eq('an heir opens with exactly one crew', World.masons(w, 0), 1);
  eq('...which is the Gate he opens with', pl.buildings.filter((b) => b.bt === 'gate').length, 1);
  /* give it Gates and count again — springs are where the crews come from */
  const springs = w.map.sites.filter((s) => s.kind === 'node')
    .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y));
  /* A SPRING BEYOND THE WRIT NEEDS TROOPS ON IT — and with exactly one spring inside the
   * writ, already gated from the first second, every further Gate is a spring you go and
   * take. That is the whole shape of expansion now, so the test has to expand too. */
  let gates = 0;
  for (const s of springs) {
    if (gates >= 3) break;
    if (!w.units.some((u) => u.owner === 0 && Math.hypot(u.x - s.x, u.y - s.y) < 80)) {
      const d = C.UNITS.soldier;
      w.units.push({ id: w.nextId++, owner: 0, kind: 'soldier', x: s.x, y: s.y, ox: 0, oy: 0,
                     hp: d.hp, maxHp: d.hp, dmg: d.dmg, cd: 0, goal: null, co: 0, from: -1 });
    }
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
  ok('several Gates stand', gates >= 2, `${gates} raised on top of the one he opened with`);
  const held = pl.buildings.filter((b) => b.bt === 'gate' && !b.raise).length;
  eq('the crews follow them', World.masons(w, 0),
     Math.min(C.MASONS.max, C.MASONS.base + Math.floor(held / C.MASONS.per)));
  ok('which is more than he opened with', World.masons(w, 0) > 1, `${World.masons(w, 0)} crews`);

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

/* AND THE LAST CREW NEVER LEAVES. Crews come from Gates and a Gate takes a crew to raise, so
 * an heir whose last Gate is thrown down had none of either and no way to get either: not
 * beaten, just stopped, with a Seat still standing and a purse still filling and nothing on
 * the board he was allowed to do about it. A floor of one is the way back — and because one
 * Gate already buys one crew it changes nothing for anybody still holding ground. */
suite('a razed realm can still build');
{
  eq('the floor is one crew', C.MASONS.floor, 1);
  /* it must not lift the yard for anyone who still holds a Gate: same numbers as before */
  const chk = World.createWorld(1000, 2), cp = chk.players[0];
  for (let held = 1; held <= C.MASONS.max + 1; held++) {
    while (cp.buildings.filter((b) => b.bt === 'gate' && !b.raise).length < held)
      cp.buildings.push({ id: chk.nextId++, bt: 'gate', level: 1, x: -900 - held * 20, y: -900,
                          cd: 0, raise: 0, raiseFor: 1, hp: 10, maxHp: 10, lastHurt: -99,
                          node: -1, co: 0 });
    eq(`${held} Gates still hire ${Math.min(C.MASONS.max, held)}`, World.masons(chk, 0),
       Math.min(C.MASONS.max, C.MASONS.base + Math.floor(held / C.MASONS.per)));
  }

  for (const seed of SEEDS) {
    const w2 = World.createWorld(seed, 2), pl2 = w2.players[0];
    pl2.essence = 1e5;
    w2.chaosNext = 1e9;
    const gates = pl2.buildings.filter((b) => b.bt === 'gate');
    ok(`seed ${seed}: the heir opens with a Gate to lose`, gates.length > 0);
    const spring = { x: gates[0].x, y: gates[0].y };
    for (const g of gates) pl2.buildings.splice(pl2.buildings.indexOf(g), 1);
    for (let i = 0; i < 60; i++) { World.update(w2, C.SIM_DT); w2.events.length = 0; }
    eq(`seed ${seed}: every Gate is down`, pl2.buildings.filter((b) => b.bt === 'gate').length, 0);
    eq(`seed ${seed}: one crew remains`, World.masons(w2, 0), 1);
    /* and the crew can actually do the one thing that matters — put a Gate back on the home
     * spring, which is inside the writ and so needs no troops standing on it */
    const r = World.applyCommand(w2, 0, { c: 'build', bt: 'gate', x: spring.x, y: spring.y });
    ok(`seed ${seed}: and it can raise a Gate again`, r.ok, r.err);
  }
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
  /* FOUR halls is what this suite means, and the board now opens with one — take it down, or
   * the timing budget below is measuring five and the number in the assertion is a lie */
  for (let i = pl.buildings.length - 1; i >= 0; i--)
    if (pl.buildings[i].bt === 'barracks') pl.buildings.splice(i, 1);
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
  ok('five identical orders read as one line', /Recall.*×5/.test(t2),
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

  /* fog: a rival work in the snapshot must be one the viewer can actually see — and a
   * CURTAIN is seen if any part of it is, which its midpoint alone cannot answer for */
  const canSee = (x, y) => World.canSee(w, 1, x, y);
  const workSeen = (b) => canSee(b.x, b.y)
    || (b.x2 != null && (canSee(b.x2, b.y2) || canSee(b.x * 2 - b.x2, b.y * 2 - b.y2)));
  ok('every rival work sent is visible', foe.buildings.every(workSeen),
     `${foe.buildings.filter((b) => !workSeen(b)).length} leaked`);
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

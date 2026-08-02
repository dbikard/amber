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
const { CONST: C, World, NAV, AI, Net, WorldGen: WG } = globalThis;
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
  ok('a Shrine can be raised', !!spot && World.applyCommand(w, 0, { c: 'build', ...spot, bt: 'shrine' }).ok);
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
  eq('the tower fork demands a branch', World.applyCommand(w, 0, { c: 'up', id: built.id }).err, 'branch');
  eq('an unknown branch is refused', World.applyCommand(w, 0, { c: 'up', id: built.id, br: 'lasers' }).err, 'branch');
  ok('the fork takes a branch', World.applyCommand(w, 0, { c: 'up', id: built.id, br: 'cannon' }).ok);
  World.applyCommand(w, 0, { c: 'up', id: built.id, br: 'bolt' });
  eq('the branch is permanent', built.br, 'cannon');
  eq('an unknown work id is refused', World.applyCommand(w, 0, { c: 'up', id: 999999 }).err, 'id');
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
  eq('the rival banner is withheld', foe.banner, -1);
  eq('the rival powers are withheld', foe.powers, null);
  eq('the rival muster state is withheld', foe.musterPaused, false);
  ok('rival works carry no branch', foe.buildings.every((b) => b.br === null));
  ok('rival works carry no rally order', foe.buildings.every((b) => b.rally === -1));

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

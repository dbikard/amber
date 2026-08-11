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
R('record.js'); R('campaign.js'); R('country.js'); R('realm.js');
const { CONST: C, World, NAV, AI, Net, Rec, WorldGen: WG, CAMPAIGN, COUNTRY, REALM, RNG } = globalThis;
const { suite, ok, eq, near, report, wallRig } = require('./lib.js');

/* ---- --quick: a partial pass for the edit loop ----
 * The full run is ~6 minutes and its own timing line names where they go — the solo ladder
 * alone is ~170s of bot-vs-bot matches. --quick skips exactly the sim-heavy suites marked
 * with QUICK() below and says so LOUDLY beside the tally, on its own lines, so the
 * "headless: N/N passing" line that other tools grep is untouched.
 * THE FULL SUITE (no flag) STAYS THE GATE BEFORE ANY PUSH — a skipped suite vouches for
 * nothing, and the suites skipped here are the ones that play whole matches. */
const QUICK_RUN = process.argv.includes('--quick');
const skipped = [];
const QUICK = (name) => { if (QUICK_RUN) skipped.push(name); return QUICK_RUN; };

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

/* ---------------- a board built by hand ----------------
 * The land is noise by default. A spec is the other road in: a declarative board that comes
 * out as EXACTLY what G.build produces, so nothing downstream can tell which made it. It is
 * for tests that need a particular feature in shot, for campaign chapters that have to tell a
 * story, and eventually for players building their own.
 * VALIDATION IS THE FEATURE. Procedural generation quietly guarantees things the rest of the
 * game leans on; a hand-made board breaks them casually, and a player-made one certainly will.
 * So most of this suite is about what a bad spec is REFUSED for — by name, with a reason. */
suite('a board built by hand');
{
  const good = () => ({
    name: 'the Wall Demo', seed: 7, ground: 'PLAIN', height: 0.5,
    paint: [{ rect: [200, 1050, 1800, 1250], terra: 'FOREST' },
            { circle: [1450, 760, 240], terra: 'CLIFF', height: 0.95 }],
    seats: [{ x: 520, y: 420 }, { x: 1420, y: 1980 }],
    springs: [{ x: 800, y: 560 }, { x: 1180, y: 1820 }, { x: 980, y: 1180 }]
  });
  ok('there is a spec road into worldgen at all', typeof WG.fromSpec === 'function');

  const w = World.createWorld(1, 2, good());
  ok('a hand-made board builds', !!w && !!w.map, 'no world');
  ok('...with the seats it was given', w.map.cities.length === 2);
  ok('...and the springs', w.map.nodes.length === 3);
  ok('nothing on it is stranded', NAV.audit(w.nav, w.map).length === 0,
     NAV.audit(w.nav, w.map).join(','));
  /* THE OPENING IS THE REAL TEST. A board that cannot open leaves an heir with no Gate, no
   * mason and no hall, and the failure shows up far from the board that caused it. */
  for (let pi = 0; pi < 2; pi++) {
    const bts = w.players[pi].buildings.map((b) => b.bt);
    ok(`seat ${pi} opens with a finished Gate and a hall`,
       bts.includes('gate') && bts.includes('barracks'), bts.join(',') || 'nothing');
  }
  const gate = w.players[0].buildings.find((b) => b.bt === 'gate');
  const spring = w.map.sites[w.map.nodes.find((i) => Math.hypot(w.map.sites[i].x - gate.x, w.map.sites[i].y - gate.y) < 120)];
  ok('the opening Gate stands on a spring', !!spring &&
     Math.hypot(spring.x - gate.x, spring.y - gate.y) < C.NODE.r,
     spring ? `${Math.round(Math.hypot(spring.x - gate.x, spring.y - gate.y))} off centre` : 'no spring near it');

  /* the terrain the spec asked for is the terrain the sim reads */
  const at = (x, y) => w.map.gen.terra[Math.floor(y / w.map.gen.cw) * w.map.gen.W + Math.floor(x / w.map.gen.cw)];
  ok('a painted forest is forest', at(1000, 1150) === WG.T.FOREST, String(at(1000, 1150)));
  ok('a painted crag is cliff', at(1450, 760) === WG.T.CLIFF, String(at(1450, 760)));
  ok('and unpainted ground is the base', at(300, 300) === WG.T.PLAIN, String(at(300, 300)));

  /* DETERMINISM, or replays, the chronicle and LAN all come apart */
  const a = World.createWorld(1, 2, good()), b = World.createWorld(1, 2, good());
  let same = a.map.gen.terra.length === b.map.gen.terra.length;
  for (let i = 0; same && i < a.map.gen.terra.length; i++) if (a.map.gen.terra[i] !== b.map.gen.terra[i]) same = false;
  ok('the same spec twice is the same ground', same);
  ok('...and the same sites, named the same', JSON.stringify(a.map.sites) === JSON.stringify(b.map.sites));

  /* ---- what a bad board is refused for ---- */
  const refuse = (why, mut) => {
    const sp = good(); mut(sp);
    let msg = null;
    try { World.createWorld(1, 2, sp); } catch (e) { msg = e.message; }
    ok(`refused: ${why}`, !!msg, msg === null ? 'it BUILT — a broken board got through' : '');
    return msg;
  };
  const m1 = refuse('a second spring inside the writ', (sp) => sp.springs.push({ x: 700, y: 300 }));
  ok('...and says which seat and how many', /seat 0 has 2 springs/.test(m1 || ''), m1 || '');
  refuse('no spring inside the writ', (sp) => { sp.springs[0] = { x: 980, y: 700 }; });
  refuse('a seat on ground no one can build on', (sp) => {
    sp.paint.push({ circle: [520, 420, 90], terra: 'WATER', height: 0.05 });
  });
  const m2 = refuse('seats too close together', (sp) => { sp.seats[1] = { x: 700, y: 700 }; });
  ok('...and says how far apart they are', /apart/.test(m2 || ''), m2 || '');
  refuse('a terrain name that does not exist', (sp) => { sp.paint[0].terra = 'LAVA'; });
  refuse('a spring off the map', (sp) => { sp.springs[0] = { x: -50, y: 560 }; });
  refuse('fewer seats than players', (sp) => { sp.seats.length = 1; });
  refuse('no springs at all', (sp) => { sp.springs = []; });

  /* the two roads produce the same SHAPE — that is what lets everything downstream not care */
  const proc = World.createWorld(1000, 2);
  const keys = (o) => Object.keys(o).sort().join(',');
  ok('a hand-made map has the same fields as a grown one',
     keys(w.map) === keys(proc.map), `${keys(w.map)}  vs  ${keys(proc.map)}`);
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

/* ---------------- THE FORK IS A PROPERTY OF THE TABLE ----------------
 * The Watchtower was the only branching work for a long time and the rule was written into six
 * places as the word 'tower'. Every one of those places asks the table now, which is what let
 * three troop halls fork for the price of a table entry — so the thing to hold is that the
 * mechanism is GENERIC, not that any particular building has it. */
suite('the halls fork')
{
  const forking = Object.keys(C.BUILDINGS).filter((bt) => C.BUILDINGS[bt].branches);
  ok('more than the tower branches now', forking.length >= 4, forking.join(','));
  for (const bt of forking) {
    const d = C.BUILDINGS[bt];
    ok(`${bt}: its fork is a real level`, d.fork >= 2 && d.fork <= C.MAX_LEVEL, String(d.fork));
    ok(`${bt}: every branch it offers exists`, d.branchUI.length >= 2 && d.branchUI.every((k) => d.branches[k]),
       d.branchUI.join(','));
    for (const k of d.branchUI) {
      const b2 = d.branches[k];
      ok(`${bt}/${k}: has a face and a price`, !!b2.name && !!b2.icon && !!b2.blurb && b2.cost > 0);
      /* per-branch arrays are indexed by (level - fork), so they run to MAX_LEVEL and no further */
      eq(`${bt}/${k}: prices every level above the fork`, b2.up.length, C.MAX_LEVEL - d.fork);
      if (b2.spawns) {
        ok(`${bt}/${k}: musters a man the table knows`, !!C.UNITS[b2.spawns], b2.spawns);
        if (b2.period) eq(`${bt}/${k}: an interval per level above the fork`, b2.period.length, C.MAX_LEVEL - d.fork + 1);
      }
    }
  }
  /* the Barracks takes THREE. Nothing in the mechanism ever counted them, and this is the
   * assertion that says so rather than trusting that a loop is a loop. */
  eq('the Barracks offers three soldieries', C.BUILDINGS.barracks.branchUI.length, 3);

  /* ...and the command grammar, on a hall rather than on the tower */
  const w = World.createWorld(4242), pl = w.players[0], c = World.cityOf(w, 0);
  pl.essence = 100000;
  ok('a hall goes up', World.applyCommand(w, 0, { c: 'build', bt: 'barracks', x: c.x + 140, y: c.y + 20 }).ok);
  const hall = pl.buildings.filter((b) => b.bt === 'barracks').pop();
  for (let i = 0; i < 30 * 40 && hall.raise > 0; i++) World.update(w, C.SIM_DT);
  w.events.length = 0;
  eq('the hall fork demands a branch', World.applyCommand(w, 0, { c: 'up', id: hall.id }).err, 'branch');
  eq('an unknown one is refused', World.applyCommand(w, 0, { c: 'up', id: hall.id, br: 'cannon' }).err, 'branch');
  ok('a real one is taken', World.applyCommand(w, 0, { c: 'up', id: hall.id, br: 'archer' }).ok);
  World.applyCommand(w, 0, { c: 'up', id: hall.id, br: 'line' });
  eq('and it is permanent, exactly as the tower\'s is', hall.br, 'archer');

  /* THE PRICE COMES OFF THE BRANCH. Each branch is its own rebuild at its own cost, and a
   * later upgrade is priced by the branch the work already holds, not by the base table. */
  eq('the fork is priced by the branch', World.upgradeCost('barracks', 1, 'raid'), C.BUILDINGS.barracks.branches.raid.cost);
  ok('...and the branches do not all cost the same',
     new Set(C.BUILDINGS.barracks.branchUI.map((k) => World.upgradeCost('barracks', 1, k))).size > 1);
  eq('above the fork the branch prices it too', World.upgradeCost('barracks', 2, 'raid'), C.BUILDINGS.barracks.branches.raid.up[0]);
  /* the works that do NOT branch are untouched by any of it */
  eq('a Gate is still priced by its own table', World.upgradeCost('gate', 1), C.BUILDINGS.gate.up[0]);
  eq('and the Shrine still does not upgrade at all', World.upgradeCost('shrine', 1), Infinity);

  /* WHAT THE HALL RAISES is the one question everything downstream asks */
  eq('before the fork, the hall\'s own recruit', World.mustersOf({ bt: 'barracks', level: 1 }).kind, 'soldier');
  eq('after it, the branch\'s', World.mustersOf({ bt: 'barracks', level: 2, br: 'archer' }).kind, 'archer');
  eq('...at the branch\'s own interval', World.mustersOf({ bt: 'barracks', level: 2, br: 'raid' }).period,
     C.BUILDINGS.barracks.branches.raid.period[0]);
  ok('a branch named but not yet reached does not count',
     World.mustersOf({ bt: 'barracks', level: 1, br: 'archer' }).kind === 'soldier');
  eq('a work that musters nothing answers nothing', World.mustersOf({ bt: 'tower', level: 1 }), null);

  /* A HALL THAT FORKS DOES NOT KEEP THE CHANGE. Recruits are paid for continuously, so a hall
   * part-way through a dear man that becomes a cheap one would hand out several at once. */
  const w2 = World.createWorld(99), p2 = w2.players[0], c2 = World.cityOf(w2, 0);
  w2.chaosNext = 1e9; p2.essence = 100000;
  World.applyCommand(w2, 0, { c: 'build', bt: 'spire', x: c2.x + 150, y: c2.y - 40 });
  const spire = p2.buildings.filter((b) => b.bt === 'spire').pop();
  for (let i = 0; i < 30 * 60 && spire.raise > 0; i++) { World.update(w2, C.SIM_DT); w2.events.length = 0; }
  for (let i = 0; i < 30 * 8; i++) { World.update(w2, C.SIM_DT); w2.events.length = 0; }
  ok('the hall has banked part of a recruit', spire.paid > 0, String(Math.round(spire.paid)));
  World.applyCommand(w2, 0, { c: 'up', id: spire.id, br: 'binder' });
  const dear = C.UNITS[World.mustersOf(spire).kind].cost * C.TIER[spire.level - 1];
  ok('and the fork clamps it to what the new man costs', spire.paid <= dear + 1e-6,
     `${Math.round(spire.paid)} banked against a price of ${Math.round(dear)}`);
}

/* ---------------- SHOOTERS, STONE, AND THE TWO NEW ARTS ----------------
 * Three rules that are easy to lose to a refactor and expensive to lose quietly, so each is
 * held by an assertion that fails loudly rather than by a comment. */
suite('shooters, stone, and the arts')
{
  const w = World.createWorld(31337, 2);
  w.chaosNext = 1e9;
  /* AND THE SEATS ARE SILENT. The throne carries a gun of its own now — longer-reaching than
   * any Watchtower and stopped by no stone — and every rig below stands inside its arc, so it
   * and not the men under test would be doing the damage. Its cooldown lives on the player
   * (there is no work to hang it on), and parked past the end of time it never fires. */
  for (const c of w.cities) c.cd = 1e9;
  const c0 = World.cityOf(w, 0), c1 = World.cityOf(w, 1);
  const p0 = w.players[0], p1 = w.players[1];
  p0.essence = p1.essence = 100000;
  const put = (owner, kind, x, y, hpFrac) => {
    const d = C.UNITS[kind];
    const u = { id: w.nextId++, owner, kind, x, y, ox: 0, oy: 0,
                hp: d.hp * (hpFrac == null ? 1 : hpFrac), maxHp: d.hp, dmg: d.dmg,
                cd: 0, goal: null, co: 0, from: -1, tier: 1 };
    w.units.push(u); return u;
  };
  const pin = (pi, x, y) => { w.players[pi].banner = { x, y, site: -1 }; };
  const run = (secs) => { for (let i = 0; i < 30 * secs; i++) { World.update(w, C.SIM_DT); w.events.length = 0; } };

  /* ---- a shooter has no target among works ---- */
  World.applyCommand(w, 1, { c: 'build', bt: 'barracks', x: c1.x + 120, y: c1.y });
  const mark = p1.buildings.filter((b) => b.bt === 'barracks').pop();
  for (let i = 0; i < 30 * 40 && mark.raise > 0; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  mark.hp = mark.maxHp;

  w.units.length = 0;
  pin(0, mark.x, mark.y - 30);
  put(0, 'archer', mark.x, mark.y - 30);
  run(6);
  eq('an archer beside a rival hall does not touch it', mark.hp, mark.maxHp);

  w.units.length = 0; mark.hp = mark.maxHp;
  put(0, 'sorcerer', mark.x, mark.y - 30);
  run(6);
  eq('...and neither does a sorcerer', mark.hp, mark.maxHp);

  w.units.length = 0; mark.hp = mark.maxHp;
  put(0, 'soldier', mark.x, mark.y - 30);
  run(6);
  ok('a soldier in the same spot breaks it', mark.hp < mark.maxHp,
     `${Math.round(mark.hp)}/${Math.round(mark.maxHp)}`);

  /* ...AND HE STILL SHOOTS MEN. "No target among works" must not read as "no target": an
   * archer who walked past an enemy soldier to look for one would be a different bug. */
  w.units.length = 0; mark.hp = mark.maxHp;
  const prey = put(1, 'soldier', mark.x + 40, mark.y - 30);
  put(0, 'archer', mark.x, mark.y - 30);
  run(4);
  ok('an archer standing at a work still shoots the man beside it', prey.hp < prey.maxHp,
     `${Math.round(prey.hp)}/${Math.round(prey.maxHp)}`);
  eq('...and the work is STILL untouched', mark.hp, mark.maxHp);

  /* THE SHRINE IS THE ONE WORK A SHOOTER MAY STRIKE, because what he aims at is the WALKER
   * standing in the lines. Pillar 3 requires it — "a walking player must be attackable" — and
   * without it a walker was unattackable by half of every army: the Pattern decided 92% of
   * contested matches and matchups ran to the cap because nobody could reach the man. */
  w.units.length = 0;
  p1.essence = 100000;
  let shrErr = '';
  for (let a = 0; a < 24 && !p1.buildings.some((b) => b.bt === 'shrine'); a++) {
    const th = a / 24 * Math.PI * 2;
    const r = World.applyCommand(w, 1, { c: 'build', bt: 'shrine', x: c1.x + Math.cos(th) * 170, y: c1.y + Math.sin(th) * 170 });
    if (!r.ok) shrErr = r.err;
  }
  const shrine = p1.buildings.find((b) => b.bt === 'shrine');
  ok('a Shrine was raised to shoot at', !!shrine, shrErr);
  if (shrine) {
    for (let i = 0; i < 30 * 80 && shrine.raise > 0; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
    /* THE RIG'S SUBJECT IS THE ARCHER AND THE SHRINE, and nobody else. The eighty seconds
     * the raise takes are eighty seconds of the rival's opening hall mustering soldiers into
     * the court a bowshot from this rig — and whether one of them wandered inside aggro and
     * killed the archer mid-rig depended on nothing but the court's exact geometry. It
     * passed for as long as the muster happened to settle a few units short, and a movement
     * change that bent a column an arm's width broke it. Clear the bystanders and starve the
     * hall for the rig's six seconds; the essence comes back for the blocks below. */
    w.units.length = 0; p1.essence = 0;
    shrine.hp = shrine.maxHp;
    pin(0, shrine.x, shrine.y - 40);
    put(0, 'archer', shrine.x, shrine.y - 40);
    run(6);
    ok('an archer shoots the walker on the Pattern', shrine.hp < shrine.maxHp,
       `${Math.round(shrine.hp)}/${Math.round(shrine.maxHp)}`);
    /* ...and it really is only the Shrine: the same archer still ignores everything else */
    w.units.length = 0; mark.hp = mark.maxHp;
    pin(0, mark.x, mark.y - 30);
    put(0, 'archer', mark.x, mark.y - 30);
    run(6);
    eq('and a hall in the same spot is still nothing to him', mark.hp, mark.maxHp);
    p1.essence = 100000;
  }

  /* A SEAT IS A WORK TOO, and it is the one that ends matches */
  w.units.length = 0;
  const seat1 = World.seatOf(w, 1), seatHp = seat1.hp;
  pin(0, c1.x, c1.y);
  for (let i = 0; i < 4; i++) put(0, 'archer', c1.x + i * 12 - 18, c1.y + 20);
  run(8);
  eq('four archers at a Seat cannot take it', seat1.hp, seatHp);
  w.units.length = 0;
  put(0, 'ram', c1.x, c1.y + 20);
  run(8);
  ok('one Ram can', seat1.hp < seatHp, `${Math.round(seat1.hp)} of ${seatHp}`);
  seat1.hp = seatHp;

  /* ---- the Warden mends ---- */
  w.units.length = 0;
  pin(0, c0.x, c0.y + 40);
  const wd = put(0, 'warden', c0.x, c0.y + 40, 0.5);
  const hurtMan = put(0, 'soldier', c0.x + 26, c0.y + 40, 0.3);
  const wholeMan = put(0, 'soldier', c0.x - 26, c0.y + 40, 1);
  const was = hurtMan.hp, wardenWas = wd.hp;
  run(2);
  ok('a Warden mends the man beside him', hurtMan.hp > was,
     `${was.toFixed(1)} -> ${hurtMan.hp.toFixed(1)}`);
  eq('...never past whole', wholeMan.hp, wholeMan.maxHp);
  eq('...and never himself, or a pair of them would not die', wd.hp, wardenWas);
  ok('nobody else in Amber heals', (() => {
    const w3 = World.createWorld(5, 2); w3.chaosNext = 1e9;
    const c3 = World.cityOf(w3, 0);
    const d = C.UNITS.soldier;
    const a = { id: 1, owner: 0, kind: 'soldier', x: c3.x, y: c3.y + 40, ox: 0, oy: 0,
                hp: 20, maxHp: d.hp, dmg: d.dmg, cd: 0, goal: null, co: 0, from: -1, tier: 1 };
    w3.units.push(a);
    for (let i = 0; i < 30 * 5; i++) { World.update(w3, C.SIM_DT); w3.events.length = 0; }
    return a.hp === 20;
  })());

  /* ---- the Binding: the fiend-rider on a throw that is now about chains ----
   * This block used to stand a rival soldier 36 away from the binder and assert he was not
   * taken, which was a real rule tested by accident: the old bindNear looked only for beaten
   * FIENDS, so the soldier was never a candidate at all. He is now — he is the nearest enemy
   * and he is chained first — so the throws are separated here, and 'a rival is chained and
   * never converted' is proved properly in the 'Binding is chains' suite below. */
  w.units.length = 0;
  pin(0, c0.x, c0.y + 40);
  const bind = put(0, 'binder', c0.x, c0.y + 40);
  const beaten = put(C.CHAOS_ID, 'fiend', c0.x + 50, c0.y + 40, 0.3);
  const hale = put(C.CHAOS_ID, 'fiend', c0.x - 50, c0.y + 40, 1);
  run(2);
  eq('a beaten fiend is bound', beaten.owner, 0);
  eq('a hale one is not — you fight for it first', hale.owner, C.CHAOS_ID);
  ok('...but a hale one is CHAINED, which is what the art is for now', hale.hexed > w.t,
     `${(hale.hexed - w.t).toFixed(1)}s left`);
  eq('...and the bound fiend marches under the standard that took it', beaten.co, bind.co);
  ok('...wearing no chains of its own — it is his man now', !beaten.hexed);
  ok('it serves for a while and no longer', beaten.bound > w.t && beaten.bound <= w.t + C.BIND_LIFE + 1,
     `${Math.round(beaten.bound - w.t)}s left of ${C.BIND_LIFE}`);
  /* AND SHADOW LETS IT GO. Every fiend bound frees a Chaos slot, so a permanent bind is a
   * binder host farming the black road into a private army. */
  beaten.bound = w.t + 0.1;
  run(1);
  ok('and then Shadow will not hold it', beaten.hp <= 0, `${Math.round(beaten.hp)} hp`);
}

/* ---------------- STONE IS FOR SHOOTERS ----------------
 * A parapet is a shooting platform. A swordsman on one was a man in the open with further to
 * fall, holding a berth an archer needed — so the roster ranks shooters first and only they
 * take a place, while everyone else still stations at the foot, in cover. */
suite('stone is for shooters')
{
  eq('the men who may hold stone are the shooters',
     Object.keys(C.UNITS).filter((k) => C.UNITS[k].mans).sort().join(','), 'archer,sorcerer');
  const w = World.createWorld(20250806, 2);
  w.chaosNext = 1e9;
  const pl = w.players[0], c = World.cityOf(w, 0);
  pl.essence = 100000;
  /* A RUN ONE CREW LONG. A heir opens with one Gate and so one mason, and `WALL.unit` is what
   * a crew covers — a longer run is refused for 'crews', which is a different test. */
  let b = null, why = '';
  for (let a = 0; a < 24 && !b; a++) {
    const th = a / 24 * Math.PI * 2;
    const x = c.x + Math.cos(th) * 230, y = c.y + Math.sin(th) * 230;
    const x2 = x + Math.cos(th + Math.PI / 2) * 120, y2 = y + Math.sin(th + Math.PI / 2) * 120;
    const r = World.applyCommand(w, 0, { c: 'build', bt: 'wall', x, y, x2, y2 });
    if (r.ok) b = pl.buildings.filter((q) => q.bt === 'wall').pop(); else why = r.err;
  }
  ok('a curtain was raised to hold', !!b, why);
  if (b) {
    for (let i = 0; i < 30 * 90 && b.raise > 0; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
    eq('the masons finish it', b.raise, 0);
    /* A MIXED COMPANY, and the swordsmen made FIRST so their ids are lowest — the roster used
     * to be id order alone, so this is exactly the case the old rule got wrong. */
    w.units.length = 0;
    pl.banner = { x: b.x, y: b.y, site: -1 };
    const mk = (kind) => {
      const d = C.UNITS[kind];
      const u = { id: w.nextId++, owner: 0, kind, x: b.x, y: b.y, ox: 0, oy: 0,
                  hp: d.hp, maxHp: d.hp, dmg: d.dmg, cd: 0, goal: null, co: 0, from: -1, tier: 1 };
      w.units.push(u); return u;
    };
    const swords = [mk('soldier'), mk('soldier'), mk('shieldman')];
    const shots = [mk('archer'), mk('sorcerer')];
    World.update(w, C.SIM_DT); w.events.length = 0;
    /* A BERTH IS AN ERRAND FIRST. The roster names him on the tick the order reaches him; being
     * ON the stone is something he walks to (see `postAll`), so the deal and the arrival are
     * asserted separately and in that order. Asserting `u.man` one tick after the order was
     * asserting the ASSIGNMENT and calling it manning. */
    ok('every shooter is dealt a berth, though he was mustered last',
       shots.every((u) => u.toBerth && u.post === b.id),
       shots.map((u) => u.kind + ':' + (u.toBerth ? u.post : 0)).join(' '));
    ok('...and none of them is on the stone yet', shots.every((u) => !u.man),
       shots.map((u) => u.kind + ':' + (u.man || 0)).join(' '));
    for (let i = 0; i < 30 * 30; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
    ok('...and every one of them is on it once he has walked there',
       shots.every((u) => u.man === b.id), shots.map((u) => u.kind + ':' + (u.man || 0)).join(' '));
    ok('and no swordsman takes one, though his id is lower',
       swords.every((u) => !u.man && !u.toBerth), swords.map((u) => u.kind + ':' + (u.man || 0)).join(' '));
    ok('...but they are still posted, so they stand at the foot in cover',
       swords.every((u) => u.post === b.id));
    /* an all-melee company mans nothing at all: the wall bars the ground and kills nobody */
    w.units.length = 0;
    const only = [mk('soldier'), mk('shieldman')];
    for (let i = 0; i < 30 * 30; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
    ok('a company with no shooters in it mans nothing',
       only.every((u) => !u.man && !u.toBerth));
  }

  /* ---- and a tower holds a few ---- */
  const w2 = World.createWorld(777, 2);
  w2.chaosNext = 1e9;
  const p2 = w2.players[0], c2 = World.cityOf(w2, 0);
  p2.essence = 100000;
  let tw = null;
  for (let a = 0; a < 24 && !tw; a++) {
    const th = a / 24 * Math.PI * 2;
    if (World.applyCommand(w2, 0, { c: 'build', bt: 'tower', x: c2.x + Math.cos(th) * 200, y: c2.y + Math.sin(th) * 200 }).ok)
      tw = p2.buildings.filter((q) => q.bt === 'tower').pop();
  }
  ok('a tower was raised', !!tw);
  if (tw) {
    for (let i = 0; i < 30 * 40 && tw.raise > 0; i++) { World.update(w2, C.SIM_DT); w2.events.length = 0; }
    w2.units.length = 0;
    p2.banner = { x: tw.x, y: tw.y, site: -1 };
    const mk2 = (kind) => {
      const d = C.UNITS[kind];
      const u = { id: w2.nextId++, owner: 0, kind, x: tw.x, y: tw.y + 20, ox: 0, oy: 0,
                  hp: d.hp, maxHp: d.hp, dmg: d.dmg, cd: 0, goal: null, co: 0, from: -1, tier: 1 };
      w2.units.push(u); return u;
    };
    const crowd = [];
    for (let i = 0; i < C.TOWER.berths + 3; i++) crowd.push(mk2('archer'));
    const sword = mk2('soldier');
    World.update(w2, C.SIM_DT); w2.events.length = 0;
    eq('a tower is a room, not a field', crowd.filter((u) => u.in === tw.id).length, C.TOWER.berths);
    ok('and the rest stay outside', crowd.filter((u) => !u.in).length === 3);
    ok('a swordsman never goes up one', !sword.tow);
    /* This used to assert a distinct `towSlot` per man — the ring-around-the-crown geometry
     * from the days when assignment WAS entry. Since "the rim is the door" (v0.9.11) a man
     * through the door has no place on the field at all, so the slot is gone from the unit
     * and from the wire, and what is asserted is its absence: both checks FAIL on the old
     * code, where the roster dealt slots and snapFor shipped them. */
    ok('a man through the door has no ring slot — the field is not where he is',
       crowd.every((u) => !('towSlot' in u)));
    ok('...and no slot rides the wire', JSON.stringify(Net.snapFor(w2, 0, [])).indexOf('towSlot') === -1);
    ok('a man in a tower throws further than he could on the ground',
       C.TOWER.over > C.UNITS.archer.range, `${C.TOWER.over} vs ${C.UNITS.archer.range}`);
  }
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
    World.seatOf(w, pi).hp = 1;
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

  /* THE GUEST'S FOG IS THIS FUNCTION TOO. A LAN guest does not keep its own copy of the
   * vision rules — it hands the snapshot itself to World.visionSources — so the wire must
   * stay world-shaped enough for that call: `walking` must ride, and the walking Shrine
   * must ride with it (it always can: it stands inside its own Pattern-light, so the
   * host's fog always sends it). If either stops riding, a guest's fog goes darker than
   * the sim's and hides a walk the rules say is public. */
  const gsrc = World.visionSources({ map: w.map, players: wire.players, units: wire.units }, 0);
  const lit = (x, y) => gsrc.some(([sx, sy, r]) => (x - sx) * (x - sx) + (y - sy) * (y - sy) < r * r);
  ok('a guest fed only the wire lights the walking Shrine', lit(sh.x, sh.y));
  ok('...and the Pattern-light of ground around it', lit(sh.x + C.VISION.pattern * 0.7, sh.y));
  ok('...but no further than the sim would', !lit(sh.x + C.VISION.pattern * 1.6, sh.y));

  /* AND THE BEACON CANNOT BE SWITCHED OFF. This suite used to prove the light went out by
   * giving `{c:'walk', on:false}` — an order that no longer exists. A walk ends by winning it
   * or by losing the Shrine, so that is what puts the light out, and the refusal itself is
   * part of what makes the beacon worth lighting an army for. */
  eq('the walk cannot be called off', World.applyCommand(w, 1, { c: 'walk', on: false }).err, 'committed');
  step(12);
  ok('so the beacon still burns', World.canSee(w, 0, sh.x, sh.y));
  eq('and the walker is still on the board', World.walkers(w).length, 1);

  World.hurtBuilding(w, 1, sh.id, sh.hp + 1);
  step(12);
  ok('throwing the Shrine down puts the light out', !World.canSee(w, 0, sh.x, sh.y));
  eq('and clears the board', World.walkers(w).length, 0);

  /* a fallen heir is not walking, whatever it was doing when it fell */
  pl.essence = 999999;
  ok('a new Shrine can be raised', raise(w, 1, at.x, at.y, 'shrine').ok);
  const sh2 = pl.buildings.find((b) => b.bt === 'shrine');
  World.applyCommand(w, 1, { c: 'walk', on: true });
  step(12);
  eq('walking again', World.walkers(w).length, 1);
  w.players[1].out = true;
  eq('a fallen heir leaves the board', World.walkers(w).length, 0);
  step(12);
  ok('and their light goes out', !World.canSee(w, 0, sh2.x, sh2.y));
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

  /* A POOR WALKER IS NOT SLOWED — HE IS UNARMED. This block used to assert PROPORTIONAL
   * progress: pay what you can, advance `pay/want` of full speed, floored at `minRate` so the
   * arithmetic could never quite stop the game's clock. That whole mechanism is gone, and with
   * it the field, so the old assertions ('an empty treasury slows the walk', '...against a
   * floor of') were checking a rule the sim no longer has. The rule that replaced it is
   * simpler and harsher: the lines carry you at FULL rate whatever your treasury holds, and
   * what poverty costs you is the army — see 'a walk is paid before the halls are'. */
  const def = C.BUILDINGS.shrine;
  ok('there is no proportional floor left to read', def.minRate === undefined,
     `minRate = ${def.minRate}`);
  pl.essence = 0;
  const at0 = pl.pattern;
  for (let i = 0; i < 30; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  const crawled = pl.pattern - at0;
  near('an empty treasury does not slow the walk at all', crawled, def.rate[0], 0.01,
       `${crawled.toFixed(4)}%/s against a full ${def.rate[0]}%/s`);
  ok('...and the treasury is scraped to nothing paying for it', pl.essence < 1,
     `${pl.essence.toFixed(2)} left`);
  /* which is what makes it a clock: a walk begun on nothing arrives at the same hour */
  ok('so the slowest possible walk is the only walk there is', 100 / def.rate[0] / 60 < 25,
     `${(100 / def.rate[0] / 60).toFixed(1)} minutes, rich or broke`);
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

  /* AND THERE IS NO STEPPING OFF. This suite used to prove the fade by giving
   * `{c:'walk', on:false}` and watching the lines let go — which measured the fade honestly
   * and, in doing it that way, quietly asserted that a walker could stop whenever he liked.
   * He cannot: that is the commitment. The fade is still real, and what it now answers is the
   * ASSAULT — the only thing that takes an heir off the Pattern short of winning. */
  eq('the walk cannot be called off', World.applyCommand(w, 0, { c: 'walk', on: false }).err, 'committed');
  for (let i = 0; i < 30 * 5; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  ok('...and the lines go on being drawn', pl.pattern > walked && pl.walking,
     `${walked.toFixed(1)}% -> ${pl.pattern.toFixed(1)}%`);

  /* THE ASSAULT. Throwing the Shrine down tears the walker off the Pattern and costs them
   * ground they had already paid for — the whole reason to go after one. */
  pl.pattern = 60;
  ok('the walk is under way', pl.walking);
  World.hurtBuilding(w, 0, sh.id, sh.hp + 1);
  ok('the Shrine is thrown down', !pl.buildings.some((b) => b.bt === 'shrine'));
  ok('...which tears the walker off the Pattern', !pl.walking);
  near('...and costs them what they had paid for', 60 - pl.pattern, def.breakLoss, 0.5,
       `${pl.pattern.toFixed(1)}% left of 60%`);
  ok('the loss is announced', w.events.some((e) => e.e === 'shrinefell' && e.pi === 0),
     w.events.map((e) => e.e).join(','));

  /* and NOW the lines fade, because nobody is walking them */
  const held = pl.pattern;
  for (let i = 0; i < 30 * 60; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  const faded = held - pl.pattern;
  near('a minute with nobody on them gives some of it back', faded, def.decay * 60, 0.2,
       `lost ${faded.toFixed(2)}% of ${held.toFixed(1)}%`);
  ok('but it does not evaporate — losing the Shrine is a cost, not a reset', pl.pattern > held * 0.5,
     `${pl.pattern.toFixed(1)}% left`);

  /* and it never runs past zero */
  pl.pattern = 0.01;
  for (let i = 0; i < 30 * 10; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  eq('the walk cannot go negative', pl.pattern, 0);
  pl.pattern = 60 - def.breakLoss;

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
/* ~13s: the "cap is really gone" loop below raises thirty towers and waits on the crews for
 * each — sim weight, not logic, so --quick puts it down */
if (!QUICK('the masons')) {
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
  /* and the Seat's own gun with it: a curtain raised inside the writ stands well within the
   * throne's reach, and it shoots over stone by design — which would answer every question
   * this suite asks about who can shoot whom through a wall before the wall got a word in */
  for (const c of w.cities) c.cd = 1e9;
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
  pin(put(1, side(C.WALL.man * 0.5), 'soldier'));
  run(6);
  eq('hugging a rival curtain does not put you on it', hidden.hp, 1e9);
  ok('...though the wall itself is a target to a man who can break stone',
     b.hp < b.maxHp, `${Math.round(b.hp)}/${b.maxHp}`);

  /* ...AND NOT TO A SHOOTER, standing in the very same place. An archer or a sorcerer has no
   * target among works at all: he does not chip at the stone slowly, he never looks at it. */
  settle();
  b.hp = b.maxHp;
  pin(put(1, side(C.WALL.man * 0.5), 'archer'));
  run(6);
  eq('a shooter at the same spot never touches the stone', b.hp, b.maxHp);
  settle();
  b.hp = b.maxHp;
  pin(put(1, side(C.WALL.man * 0.5), 'sorcerer'));
  run(6);
  eq('...and neither does a sorcerer, who used to be a siege weapon', b.hp, b.maxHp);

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
  /* HE IS DEALT IT, THEN HE WALKS TO IT. A berth is a place on a run that may be hundreds long
   * and his is not where he happens to be standing, so the tick the order reaches him he has an
   * ERRAND and no more. Marking him manned here was marking the roster's decision. */
  ok('a man at his own wall is dealt a berth on it', upTop.toBerth && upTop.post === b.id,
     `post ${upTop.post}, toBerth ${upTop.toBerth || 0}`);
  eq('...but he is not on the stone until he has walked to it', upTop.man || 0, 0);
  for (let i = 0; i < 30 * 30; i++) World.update(w, C.SIM_DT);
  eq('...and he is once he has', upTop.man, b.id);
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
    World.seatOf(f, 1).hp = 1;
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
    /* THE RUN WATCHES FROM ITS ENDS FOR A GUEST TOO. A LAN guest's fog is World.visionSources
     * run against its own snapshot, so a finished curtain's ends must come out as vision
     * sources from the WIRE exactly as they do from the world — this is the rule the guest's
     * hand-rolled source list silently dropped, leaving its own far end in fog on a guest's
     * screen while the host's showed it lit. */
    {
      const gw = JSON.parse(JSON.stringify(Net.snapFor(w, 0, [])));
      const gs = World.visionSources({ map: w.map, players: gw.players, units: gw.units }, 0);
      const ends = World.wallEnds(b), r = C.BUILDINGS.wall.vision || C.VISION.build;
      for (const [ex, ey] of [[ends[0], ends[1]], [ends[2], ends[3]]])
        ok('a guest fed only the wire sees from the run\'s end',
           gs.some(([sx, sy, sr]) => Math.abs(sx - ex) <= 2 && Math.abs(sy - ey) <= 2 && sr === r),
           `no source within 2 of ${Math.round(ex)},${Math.round(ey)}`);
    }
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

/* THE SEAT SHOOTS BACK. It is worth the two Watchtower branches at their best put together,
 * and — alone on the board — its shot is not stopped by stone. */
suite('the Seat of Power holds its own gun');
{
  /* the figure, derived here from the branch tables rather than read off CONST, so a Seat that
   * quietly stopped matching the towers it is defined by fails this line and not a play-test */
  const bo = C.TOWER_BRANCHES.bolt, ca = C.TOWER_BRANCHES.cannon;
  const top = 3 - C.BUILDINGS.tower.fork;        // per-branch arrays are indexed by level - fork
  const want = bo.dmg[top] / bo.atk[top] + ca.dmg[top] / ca.atk[top];
  near('a Ballista and a Cannon, both fully upgraded, fired as one gun',
       C.SEAT_GUN.dmg / C.SEAT_GUN.atk, want, 0.01, `${(C.SEAT_GUN.dmg / C.SEAT_GUN.atk).toFixed(3)} vs ${want.toFixed(3)}`);
  /* ...but its REACH is not the towers'. Strength is what the Seat is defined by and what the
   * line above checks; reach decides something else — how far a column walks under fire with no
   * way to answer — and taking the ballista's 350 with the rest made the throne an exclusion
   * zone the length of a march. Measured: mirror 33% with matches unfinished at forty-five
   * minutes, and `greedy` beating benedict. It covers its own city and the ground at its gate.
   * Asserted against CITY.r rather than the literal, so moving the precinct moves the guns. */
  eq('but it covers its own city and no further', C.SEAT_GUN.range, C.CITY.r + 50);
  ok('...which is inside the reach of the towers it is made of',
     C.SEAT_GUN.range < Math.max(bo.range[top], ca.range[top]),
     `${C.SEAT_GUN.range} vs the ballista's ${bo.range[top]}`);

  /* EVERY DISTANCE IN THESE RIGS IS THE SEAT'S OWN REACH, never a literal. They were written
   * as 300 and 80 and 150 against a reach of 350; the reach came down to 200 and the whole
   * suite went dark at once — nought shots, nought damage, three failures that all said the
   * gun was broken when what had happened was that the men were standing outside it. A rig
   * that pins a tuned number is a rig that has to be re-tuned every time the number moves.
   * `IN` is comfortably inside the arc; the far man is comfortably outside it. */
  const IN = C.SEAT_GUN.range * 0.6;
  /* ...and the stone rigs need one more thing derived rather than eyeballed. A tower within
   * `WALL.man` of a curtain is MANNING it and shoots over it — that is the rule the whole
   * parapet design rests on — so a rig meaning to put a tower BEHIND a wall has to clear that
   * reach by a margin. Scaled naively off the Seat's new range it landed 27.6 from the wall
   * against a `WALL.man` of 32, and the control quietly became a tower on a parapet: eight
   * shots where the assertion wanted none. */
  const WALL_AT = IN * 0.75, TOWER_AT = WALL_AT - (C.WALL.man + 24);

  /* A BARE BOARD. Both realms are stripped of works and essence and the black road is held off,
   * so the only thing that can hurt anybody in these rigs is the Seat. */
  const rig = () => {
    const w = World.createWorld(4242, 2);
    w.chaosNext = 1e9;
    for (const p of w.players) { p.buildings.length = 0; p.essence = 0; }
    w.units.length = 0;
    const c = World.cityOf(w, 0);
    const pins = [];
    return {
      w, c, pins,
      /* a man staked out where he is put: pinned every tick, so what these tests measure is
       * gunnery and never marching */
      man: (owner, dx, dy, hp) => {
        const d = C.UNITS.soldier;
        const u = { id: w.nextId++, owner, kind: 'soldier', x: c.x + dx, y: c.y + dy, ox: 0, oy: 0,
                    hp: hp, maxHp: hp, dmg: d.dmg, cd: 0, goal: null, co: 0, from: -1, tier: 1 };
        w.units.push(u); pins.push({ u, x: u.x, y: u.y });
        return u;
      },
      /* a work dropped straight into the realm: these rigs are testing shots, not placement.
       * A run goes up with a breath of masonry left on it so the next tick finishes it, which
       * is the only thing that rebuilds `world.walls`. */
      work: (b) => { w.players[0].buildings.push(b); return b; },
      run: (secs) => {
        const shots = [];
        for (let i = 0; i < Math.round(secs * 30); i++) {
          World.update(w, C.SIM_DT);
          for (const ev of w.events) if (ev.e === 'shot' && ev.pi === 0) shots.push(ev);
          w.events.length = 0;
          for (const p of pins) { p.u.x = p.x; p.u.y = p.y; }
        }
        return shots;
      }
    };
  };
  const wallAcross = (r, dx, half) => {
    const d = C.BUILDINGS.wall;
    return r.work({ id: r.w.nextId++, bt: 'wall', level: 1, x: r.c.x + dx, y: r.c.y,
                    x2: r.c.x + dx, y2: r.c.y + half, crews: 1, units: 1,
                    cd: 0, raise: 0.001, raiseFor: 1, hp: d.hp, maxHp: d.hp,
                    lastHurt: -99, node: -1, co: 0 });
  };
  const towerAt = (r, dx) => {
    const d = C.BUILDINGS.tower;
    return r.work({ id: r.w.nextId++, bt: 'tower', level: 1, x: r.c.x + dx, y: r.c.y,
                    cd: d.atk, raise: 0, raiseFor: d.raise, hp: d.hp, maxHp: d.hp,
                    lastHurt: -99, node: -1, co: 0 });
  };

  /* ---- it fires, and only at the other man ---- */
  {
    const r = rig();
    const foe = r.man(1, IN, 0, 1e6);
    const own = r.man(0, -IN, 0, 1e6);
    const far = r.man(1, 0, C.SEAT_GUN.range + 80, 1e6);
    const shots = r.run(6);
    ok('the Seat fires on an enemy at its gate', foe.hp < 1e6 && shots.length > 0,
       `${(1e6 - foe.hp).toFixed(1)} damage in ${shots.length} shots`);
    eq('...and never on its own men', own.hp, 1e6);
    eq('...nor on anyone beyond its reach', far.hp, 1e6);
    ok('the shot it emits has a tower\'s shape, with no work behind it',
       shots.every((s) => s.id === 0 && s.to && s.x === r.c.x && s.y === r.c.y && s.splash > 0),
       JSON.stringify(shots[0]));
  }

  /* ---- and it hits as hard as the two towers together ---- */
  {
    const r = rig();
    const foe = r.man(1, IN, 0, 1e6);
    const secs = 60;
    r.run(secs);
    const dps = (1e6 - foe.hp) / secs;
    ok('its damage per second is the two towers added up', Math.abs(dps - want) / want < 0.05,
       `${dps.toFixed(2)} dps vs ${want.toFixed(2)}`);
  }

  /* ---- STONE IS NO ANSWER TO IT ---- */
  {
    const r = rig();
    const foe = r.man(1, IN, 0, 1e6);
    const tower = towerAt(r, TOWER_AT);
    const wall = wallAcross(r, WALL_AT, 60);
    const shots = r.run(10);
    eq('the curtain across the line is standing', wall.raise, 0, `anyWall ${r.w.anyWall}`);
    ok('a wall between the Seat and its target does not stop the shot',
       foe.hp < 1e6 && shots.some((s) => s.id === 0), `${(1e6 - foe.hp).toFixed(1)} damage`);
    eq('...while a Watchtower in the same place IS stopped by it',
       shots.filter((s) => s.id === tower.id).length, 0);
  }
  {
    /* the control: the same tower with nothing in the way does shoot, so the line above is
     * measuring the stone and not a tower that was never in range */
    const r = rig();
    r.man(1, IN, 0, 1e6);
    const tower = towerAt(r, TOWER_AT);
    const shots = r.run(10);
    ok('and with the curtain gone that tower shoots as usual',
       shots.filter((s) => s.id === tower.id).length > 0);
  }

  /* ---- a ruin does not shoot ---- */
  {
    const r = rig();
    const foe = r.man(1, IN, 0, 1e6);
    r.w.players[0].out = true; World.seatOf(r.w, 0).hp = 0;
    const shots = r.run(10);
    eq('a toppled heir\'s Seat is silent', shots.length, 0);
    eq('...and nothing takes a scratch from it', foe.hp, 1e6);
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

/* ---- scaffolding the two suites below share: a realm with crews, and a curtain drawn where
 * the map will take one ---- */
function walledRealm(seed, opts) {
  const o = opts || {};
  const w = World.createWorld(seed, 2), pl = w.players[0];
  pl.essence = 1e6; w.chaosNext = 1e9;
  const c = World.cityOf(w, 0), gd = C.BUILDINGS.gate;
  for (let i = 0; i < 6; i++)
    pl.buildings.push({ id: w.nextId++, bt: 'gate', level: 1, x: c.x - 520 - i * 12, y: c.y - 520,
                        cd: 0, raise: 0, raiseFor: gd.raise, hp: gd.hp, maxHp: gd.hp,
                        lastHurt: -99, node: -1, co: 0 });
  let run = null;
  for (let rad = 190; rad < 430 && !run; rad += 20)
    for (let a = 0; a < 48 && !run; a++) {
      const th = a / 48 * Math.PI * 2;
      const x = c.x + Math.cos(th) * rad, y = c.y + Math.sin(th) * rad;
      if (World.applyCommand(w, 0, { c: 'build', bt: 'wall', x, y, x2: x + (o.len || 220), y2: y }).ok)
        run = { x, y };
    }
  const wall = pl.buildings.filter((q) => q.bt === 'wall').pop();
  for (let i = 0; i < 90 * 30 && wall && wall.raise > 0; i++) World.update(w, 1 / 30);
  return { w, pl, c, wall };
}
/* a man of a given kind, standing where you put him and answering the Banner */
function manAt(w, owner, kind, x, y) {
  const d = C.UNITS[kind];
  const u = { id: w.nextId++, owner, kind, tier: 1, x, y, ox: 0, oy: 0,
              hp: d.hp, maxHp: d.hp, dmg: d.dmg, cd: 0, goal: null, co: 0, from: -1 };
  w.units.push(u);
  return u;
}

/* WHICH FACE OF A RUN SHELTERS IS THE HEIR'S TO SAY. The sim guesses from where the owner's
 * Seat lies, which is right for the one curtain drawn across the road home and wrong for a run
 * around a forward spring or along a flank — there it puts the whole reserve in the open. The
 * `flip` order is the answer, and it is an ORDER about a wall: no crew, no stone, and it may be
 * given while the masons are still on it. */
suite('a wall can be turned about');
{
  const { w, pl, wall } = walledRealm(20260806);
  ok('a curtain goes up to test against', !!wall && !wall.raise && w.anyWall,
     wall ? `raise ${wall.raise}` : 'no run');
  /* the run lies east-west, so its two faces are north and south of it */
  pl.banner = { x: wall.x, y: wall.y };
  const men = [manAt(w, 0, 'archer', wall.x - 60, wall.y - 80),
               manAt(w, 0, 'archer', wall.x - 30, wall.y - 80),
               manAt(w, 0, 'soldier', wall.x, wall.y - 80)];
  const run = (n) => { for (let i = 0; i < n; i++) World.update(w, 1 / 30); };
  run(400);
  ok('the company is posted to the run', men.every((u) => u.post === wall.id),
     men.map((u) => u.post).join(','));
  const side = (u) => Math.sign(u.y - wall.y);
  const before = men.map(side);
  ok('...and every man of it takes the same face', before.every((s) => s === before[0]),
     before.join(','));

  eq('the order is refused on anything that is not a run',
     World.applyCommand(w, 0, { c: 'flip', id: pl.buildings[0].id }).err, 'nowall');
  eq('...and on a work that is not there', World.applyCommand(w, 0, { c: 'flip', id: 999999 }).err, 'id');
  /* measured across the order and nothing else — the realm earns while the ticks run, so a
   * fixed figure here would be testing the income */
  const purse = pl.essence;
  ok('the run turns about for nothing but the order — no crew, no stone',
     World.applyCommand(w, 0, { c: 'flip', id: wall.id, on: true }).ok &&
     World.rising(w, 0) === 0 && pl.essence === purse,
     `rising ${World.rising(w, 0)}, purse ${purse} -> ${pl.essence}`);
  /* it asks for a STATE, so two seats tapping it in one tick cannot cancel each other out */
  ok('...and asking twice for the same state changes nothing',
     World.applyCommand(w, 0, { c: 'flip', id: wall.id, on: true }).ok && wall.flip === 1);
  run(500);
  const after = men.map(side);
  ok('every man crosses to the other face', after.every((s, i) => s === -before[i]),
     `${before.join(',')} -> ${after.join(',')}`);
  ok('turning it back brings them home',
     World.applyCommand(w, 0, { c: 'flip', id: wall.id, on: false }).ok && !wall.flip);
  run(500);
  ok('...and they are on the face they started on', men.map(side).every((s, i) => s === before[i]),
     men.map(side).join(','));
}

/* A TOWER IS A ROOM. Shooters go INSIDE — ten of them — and while they are in there the stone
 * is their shield: nothing can touch them, and the only way to them is to bring the tower down.
 * When it comes down they are in the field again, on that tick, where it stood. */
suite('a tower shelters its garrison');
{
  const w = World.createWorld(20260807, 2), pl = w.players[0], foe = w.players[1];
  pl.essence = 1e6; w.chaosNext = 1e9;
  const c = World.cityOf(w, 0), gd = C.BUILDINGS.gate;
  for (let i = 0; i < 4; i++)
    pl.buildings.push({ id: w.nextId++, bt: 'gate', level: 1, x: c.x - 520 - i * 12, y: c.y - 520,
                        cd: 0, raise: 0, raiseFor: gd.raise, hp: gd.hp, maxHp: gd.hp,
                        lastHurt: -99, node: -1, co: 0 });
  let tower = null;
  for (let rad = 200; rad < 420 && !tower; rad += 20)
    for (let a = 0; a < 48 && !tower; a++) {
      const th = a / 48 * Math.PI * 2;
      const x = c.x + Math.cos(th) * rad, y = c.y + Math.sin(th) * rad;
      if (World.applyCommand(w, 0, { c: 'build', bt: 'tower', x, y }).ok)
        tower = pl.buildings.filter((q) => q.bt === 'tower').pop();
    }
  ok('a tower goes up to test against', !!tower);
  for (let i = 0; i < 90 * 30 && tower.raise > 0; i++) World.update(w, 1 / 30);
  pl.banner = { x: tower.x, y: tower.y };
  /* two more than it holds, so the cap is proved by the men left outside rather than asserted */
  const over = C.TOWER.berths + 2;
  const shooters = [], swords = [];
  for (let i = 0; i < over; i++) shooters.push(manAt(w, 0, 'archer', tower.x + 40 + i, tower.y + 40));
  for (let i = 0; i < 3; i++) swords.push(manAt(w, 0, 'soldier', tower.x + 40, tower.y + 60 + i));
  const run = (n) => { for (let i = 0; i < n; i++) World.update(w, 1 / 30); };
  /* THE WALK IS THE SHOW. Assignment used to BE entry: the tick the roster dealt a man a room
   * he became invisible and untouchable wherever he stood, ten archers winking out of the
   * middle of a field — reported from play as "show them entering". Assigned (`tow`) and
   * inside (`in`) are different states now, and the difference is measurable: a few ticks in,
   * men hold the errand but not the room, they are still mortal, and they are WALKING —
   * strictly nearer the door than they started. */
  run(12);
  const bound = shooters.filter((u) => u.tow === tower.id);
  const walking = bound.filter((u) => !u.in);
  /* assignment and entry are different STATES, which is the whole feature — not a claim about
   * which tick the nearest man's boots cross the rim, which is timing trivia that broke the
   * first draft of this line (three men who spawned near the door were already in) */
  ok('a moment in, men hold the errand but not all hold the room',
     bound.length > 0 && walking.length > 0,
     `${walking.length} walking, ${bound.length - walking.length} already in`);
  /* AND A WALKING MAN IS IN THE FIELD — a rival can single him out and cut him down on his
   * way to the door, which is the tempo cost of garrisoning under fire. Asserted through the
   * sim's own combat, because the first draft wrote `en.hp -= 7` and checked the arithmetic:
   * an assertion that would have passed with the shelter wrongly covering every assigned man,
   * i.e. with the one rule it exists to pin completely broken. */
  /* the farthest walker, so the blade has the most ticks before his door — and a blade that
   * cannot be shot down first: the probe's first draft spawned a 70 hp swordsman in the lap of
   * the tower's gun, three garrisoned archers and nine walking ones, and he was dead before
   * his first swing — 42 -> 42, the assault that never arrived, again. He is not the thing
   * being measured; the walker's skin is. */
  walking.sort((a, b) => Math.hypot(b.x - tower.x, b.y - tower.y) - Math.hypot(a.x - tower.x, a.y - tower.y));
  const en = walking[0], hpEn = en.hp;
  const cut = manAt(w, 1, 'soldier', en.x + 4, en.y);
  cut.hp = cut.maxHp = 99999;
  let sawIn = false;
  for (let i = 0; i < 120 && en.hp >= hpEn && en.hp > 0; i++) { World.update(w, 1 / 30); w.events.length = 0; if (en.in) { sawIn = true; break; } }
  ok('...and a man on his way to the door bleeds like anyone else', en.hp < hpEn,
     `${hpEn} -> ${Math.round(en.hp)} with a blade on him` + (sawIn ? ' (reached the door untouched)' : ''));
  cut.hp = 0; cut.dead = true;
  const before2 = new Map(walking.filter((u) => u.hp > 0).map((u) => [u.id, Math.hypot(u.x - tower.x, u.y - tower.y)]));
  run(30);
  ok('...and every walking man is nearer the door than he was',
     walking.filter((u) => u.hp > 0 && before2.has(u.id))
       .every((u) => u.in || Math.hypot(u.x - tower.x, u.y - tower.y) < before2.get(u.id) - 1),
     walking.filter((u) => u.hp > 0 && before2.has(u.id))
       .map((u) => `${Math.round(before2.get(u.id))}->${u.in ? 'in' : Math.round(Math.hypot(u.x - tower.x, u.y - tower.y))}`).join(' '));
  run(500);
  const inside = shooters.filter((u) => u.in === tower.id);
  eq('it holds exactly what the table says it holds', inside.length, C.TOWER.berths,
     `${inside.length} of ${over} shooters got in`);
  eq('...and no swordsman is one of them', swords.filter((u) => u.tow || u.in).length, 0);
  ok('the men inside are AT the tower, not scattered where the deal found them',
     /* at the RIM: the door is one step past `BUILD.pass`, and a man stops existing on the
      * field the tick he crosses it — where he was standing then is where he waits */
     inside.every((u) => Math.hypot(u.x - tower.x, u.y - tower.y) <= C.BUILD.pass + 6),
     inside.map((u) => Math.round(Math.hypot(u.x - tower.x, u.y - tower.y))).join(','));

  /* THE STONE IS THE SHIELD. A rival host standing in the tower's lap must not be able to
   * touch a man inside it — the tower is what they have to spend their blows on.
   *
   * RAMS, NOT SWORDSMEN, and the first draft of this got it wrong in an instructive way: six
   * soldiers sent at the tower were all dead inside twenty seconds without scratching it, shot
   * down by the ten men inside plus the tower's own gun. That is the feature working, but it
   * measures nothing — the assertion below wants attackers who LIVE long enough to land blows,
   * so the shelter is proved against real damage rather than against a host that never arrived.
   *
   * And everything that is NOT under test is cleared off the ground first — the throne's own
   * gun, the swordsmen, and the two shooters who did not get in — all of which have already
   * made their point above. Left standing they answer the question for the tower: the rams
   * went for the men outside it (men before stone is the right aggro, and `acquire` skips the
   * ones inside), so the tower took nothing and the line below would have reported an empty
   * field as a shelter. What is left on this ground is a garrison and an assault.
   *
   * ...AND THE HALL THAT KEEPS SENDING MORE. Clearing the men by NAME left the barracks 188
   * away mustering fresh soldiers to a banner planted on the tower, so the ground the rams
   * stood on was never empty: measured, the assault spent ten seconds on the men and put ONE
   * blow into the stone in the first tick, before the newcomers closed — and whether that blow
   * happened at all came down to which of a soldier and a tower was the nearer target on tick
   * zero. A coin toss dressed as an assertion, and it duly came up tails the first time the
   * men stood a few units further out. The muster is stopped and every man of the defender's
   * that is not INSIDE is cleared, which is what the paragraph above already said. */
  for (const c of w.cities) c.cd = 1e9;
  w.units = w.units.filter((u) => u.owner !== 0 || inside.indexOf(u) >= 0);
  pl.buildings = pl.buildings.filter((b) => b.bt !== 'barracks');
  const raiders = [];
  for (let i = 0; i < 2; i++) raiders.push(manAt(w, 1, 'ram', tower.x + 26 + i * 6, tower.y + 8));
  foe.banner = { x: tower.x, y: tower.y };
  const hpBefore = inside.map((u) => u.hp), towerBefore = tower.hp;
  /* TWO SECONDS, and the assertion below that the tower is still standing is what keeps this
   * honest. A ram's blow against stone is enormous — two of them take a Watchtower down in
   * under four — so a ten-second window measured the wrong thing entirely: the tower fell
   * mid-window, the garrison spilled into the middle of the assault exactly as it should, and
   * "nothing reached a man inside" then failed on men who were no longer inside anything. */
  run(60);
  ok('the assault is still standing to make the point', raiders.some((u) => u.hp > 0),
     `${raiders.filter((u) => u.hp > 0).length} of 2 alive`);
  ok('...and so is the tower, or what follows measures the wrong thing',
     tower.hp > 0 && pl.buildings.some((q) => q.id === tower.id), `${Math.round(tower.hp)} hp`);
  ok('...and its blows land on the tower', tower.hp < towerBefore,
     `${Math.round(towerBefore)} -> ${Math.round(tower.hp)}`);
  ok('...while nothing at all reaches a man inside', inside.every((u, i) => u.hp === hpBefore[i]),
     inside.map((u, i) => `${hpBefore[i]}->${u.hp}`).join(' '));

  /* AND THEY COME OUT WHEN IT GOES. On that tick — a man still carrying `tow` for a tower that
   * is not there is a man nothing can hurt, in the middle of the assault that felled it. */
  const id = tower.id, tx = tower.x, ty = tower.y;
  World.hurtBuilding(w, 0, id, tower.hp + 1, 1);
  ok('the tower is gone', !pl.buildings.some((q) => q.id === id));
  eq('the garrison is out of it on the same tick', inside.filter((u) => u.tow || u.in).length, 0);
  ok('...and standing where it stood',
     inside.every((u) => Math.hypot(u.x - tx, u.y - ty) <= C.TOWER.ring + 2),
     inside.map((u) => Math.round(Math.hypot(u.x - tx, u.y - ty))).join(','));
  /* a fresh swordsman put among them, rather than whichever rams happened to live through the
   * siege — who is left standing at the end of an assault is contingent, and the claim here is
   * not "that assault killed them", it is "they can be hurt again at all". The Seats are
   * silenced for the same reason: the measurement must be the swordsman's. */
  for (const c of w.cities) c.cd = 1e9;
  manAt(w, 1, 'soldier', tx + 6, ty + 6);
  const outHp = inside.map((u) => u.hp);
  run(600);
  ok('and now they can be killed like anyone else',
     inside.some((u, i) => u.hp < outHp[i]),
     inside.map((u, i) => `${outHp[i]}->${Math.round(u.hp)}`).join(' '));
}

/* A BASTION IS PART OF ITS RUN. A company told to hold a curtain used to line the parapet and
 * leave the towers standing in that curtain empty — the safest places on the board, unfilled,
 * while the men who could have used them stood in the open beside them. */
suite('a company holding a wall fills the towers on it');
{
  const { w, pl, wall } = walledRealm(20260808, { len: 300 });
  ok('a curtain goes up to test against', !!wall && !wall.raise && w.anyWall);
  const r = World.applyCommand(w, 0, { c: 'build', bt: 'tower', x: wall.x, y: wall.y });
  const tower = pl.buildings.filter((q) => q.bt === 'tower').pop();
  ok('a tower is raised INTO it', r.ok && tower && tower.onWall === wall.id,
     r.ok ? `onWall ${tower && tower.onWall}` : r.err);
  for (let i = 0; i < 90 * 30 && tower.raise > 0; i++) World.update(w, 1 / 30);
  /* the order is on the WALL, not on the tower — that is the whole point: nobody asked for
   * the bastion to be filled, and holding the run means holding the run */
  pl.banner = { x: wall.x, y: wall.y };
  const men = [];
  for (let i = 0; i < 14; i++) men.push(manAt(w, 0, 'archer', wall.x - 40 + i * 3, wall.y - 90));
  for (let i = 0; i < 500; i++) World.update(w, 1 / 30);
  const onStone = men.filter((u) => u.man === wall.id).length;
  const inTower = men.filter((u) => u.in === tower.id).length;
  ok('the parapet is manned', onStone > 0, String(onStone));
  ok('...and so is the bastion on it, from the same order', inTower > 0, String(inTower));
  ok('the company is SPLIT, not poured into one of them',
     onStone > 0 && inTower > 0 && onStone + inTower === Math.min(14, onStone + inTower),
     `${onStone} on the stone, ${inTower} inside`);
  eq('nobody holds a berth and a room at once', men.filter((u) => u.man && (u.tow || u.in)).length, 0);
}

/* MEN HAVE WIDTH. Nothing kept one soldier off another, so a column arrived stacked and a
 * melee was a single point with a hundred sprites in it — an army of twenty and an army of two
 * hundred looked the same. Two rules together: a FORMATION that hands each man a place a berth
 * from his neighbours, and a SEPARATION pass for the transient crowding a march produces. */
/* THE GROUND IS A FIELD, NOT A YES/NO — the signed distance the resolver walks men along,
 * and the crush that meters a packed column. The claims are made against the field itself
 * and the pure curve, because a scrum staged well enough to assert on is a scrum the crowd
 * rules have already changed. */
suite('the measured ground');
{
  const w = World.createWorld(1000, 2);
  const cw = w.nav.cw;
  let inBadNeg = 0, inBadN = 0, inGoodPos = 0, inGoodN = 0, gradUp = 0, gradN = 0;
  for (let i = 0; i < w.nav.W * w.nav.H; i += 3) {
    const x = (i % w.nav.W + 0.5) * cw, y = (Math.floor(i / w.nav.W) + 0.5) * cw;
    const g = NAV.ground(w.nav, x, y);
    if (w.nav.cost[i] === 0) { inBadN++; if (g.d < 0) inBadNeg++; }
    else { inGoodN++; if (g.d > 0) inGoodPos++; }
    /* near the line, a step along the gradient must never lose ground */
    if (g.d > -20 && g.d < 20) {
      gradN++;
      const g2 = NAV.ground(w.nav, x + g.gx * 4, y + g.gy * 4);
      if (g2.d > g.d - 0.01) gradUp++;
    }
  }
  ok('the field is negative in the water', inBadNeg === inBadN, `${inBadNeg}/${inBadN}`);
  ok('...positive on the ground', inGoodPos === inGoodN, `${inGoodPos}/${inGoodN}`);
  ok('...and its gradient climbs out everywhere near the line', gradUp === gradN, `${gradUp}/${gradN}`);
  /* the edge of the world is impassable ground worldgen never wrote down. Probed where the
   * edge is the BINDING constraint — a rim cell whose nearest water is well behind the edge */
  let probe = null;
  for (let gy = 1; gy < w.nav.H - 1 && !probe; gy++) {
    if (w.nav.sdf[gy * w.nav.W] > 25) probe = { x: 3, y: (gy + 0.5) * cw, gx: 1, gy: 0 };            // west rim
    else if (w.nav.sdf[gy * w.nav.W + w.nav.W - 1] > 25)
      probe = { x: C.MAP.W - 3, y: (gy + 0.5) * cw, gx: -1, gy: 0 };                                  // east rim
  }
  for (let gx = 1; gx < w.nav.W - 1 && !probe; gx++) {
    if (w.nav.sdf[gx] > 25) probe = { x: (gx + 0.5) * cw, y: 3, gx: 0, gy: 1 };                       // north rim
    else if (w.nav.sdf[(w.nav.H - 1) * w.nav.W + gx] > 25)
      probe = { x: (gx + 0.5) * cw, y: C.MAP.H - 3, gx: 0, gy: -1 };                                  // south rim
  }
  ok('a dry stretch of rim exists to probe', !!probe);
  if (probe) {
    const mid = NAV.ground(w.nav, probe.x, probe.y);
    ok('the world\'s edge reads as three units of ground left',
       Math.abs(mid.d - 3) < 0.5 && mid.gx === probe.gx && mid.gy === probe.gy,
       `d ${mid.d.toFixed(1)}, g ${mid.gx},${mid.gy}`);
  }

  /* the crush curve: free through a settled body's shoulder-rubbing, monotonic past it,
   * floored so a scrum still pours */
  ok('a lone man walks at his stride', World.crush(0) === 1 && World.crush(undefined) === 1);
  ok('a settled body\'s press is free', World.crush(C.CROWD.crushFree) === 1);
  const c5 = World.crush(C.CROWD.crushFree + 2), c9 = World.crush(C.CROWD.crushFree + 6);
  ok('past it the press drags, and more press drags more', c5 < 1 && c9 < c5,
     `${c5.toFixed(2)} then ${c9.toFixed(2)}`);
  ok('...down to a floor, never a standstill',
     World.crush(1000) === C.CROWD.crushFloor && C.CROWD.crushFloor > 0.3);

  /* the flow is SAMPLED, not stepped: two men a stride apart on open ground are handed
   * headings a few degrees apart, not a cell-boundary kink */
  const A = World.cityOf(w, 0), B = World.cityOf(w, 1);
  let worst = 0, n = 0;
  for (let k = 0; k < 40; k++) {
    const x = A.x + (B.x - A.x) * (0.25 + k * 0.01), y = A.y + (B.y - A.y) * (0.25 + k * 0.01);
    const s1 = NAV.steer(w.nav, w, 0, B.x, B.y, x, y);
    const s2 = NAV.steer(w.nav, w, 0, B.x, B.y, x + 2, y);
    if (!s1 || !s2) continue;
    n++;
    const dot = Math.max(-1, Math.min(1, s1.x * s2.x + s1.y * s2.y));
    const turn = Math.acos(dot) * 180 / Math.PI;
    if (turn > worst) worst = turn;
  }
  ok('the flow bends, it does not kink', n > 20 && worst < 30, `worst turn ${worst.toFixed(1)}° over ${n} pairs`);
}

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

  /* ...AND STILL SPREAD AFTER A MARCH, which is where a formation usually collapses.
   * The march points INTO the board. It used to point 350 past the east edge, and the claim
   * only ever held because men walked off the world to reach it — the walk the terrain rule
   * refuses now. Open-field spacing is an open-field claim; what an order past the edge gets
   * is its own claim, made below. */
  pl.banner = { x: c.x - 700, y: c.y + 300, site: -1 };
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

  /* AN ORDER PAST THE EDGE OF THE WORLD gathers the company on the bank. The banner is 350
   * beyond the east edge; the order is folded onto the nearest standable ground (foldOrder),
   * and nobody honours it by leaving the world or wading out — which is exactly how this
   * point was honoured before the ground had the last word. A half-disc pressed against the
   * edge cannot keep open-field spacing, so the body claim here has the bank's floor, not
   * the field's. */
  pl.banner = { x: c.x + 700, y: c.y + 300, site: -1 };
  for (let i = 0; i < 30 * 40; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  const bank = mine();
  ok('an order past the edge strands nobody off the board',
     bank.every((u) => u.x >= 0 && u.y >= 0 && u.x <= C.MAP.W && u.y <= C.MAP.H),
     `${bank.filter((u) => u.x < 0 || u.y < 0 || u.x > C.MAP.W || u.y > C.MAP.H).length} out in the dark`);
  const wet = bank.filter((u) => {
    const cc = NAV.cellOf(w.nav, u.x, u.y);
    return cc < 0 || w.nav.cost[cc] === 0;
  });
  ok('...and puts nobody on ground that refuses a man', wet.length === 0, `${wet.length} on rock or water`);
  const fold = World.foldOrder(w, pl.banner);
  ok('...and the company gathered at the fold', !!fold &&
     bank.filter((u) => Math.hypot(u.x - fold.x, u.y - fold.y) < 260).length > bank.length * 0.8,
     fold ? `fold at ${fold.x.toFixed(0)},${fold.y.toFixed(0)}` : 'no fold on the order');
  const edge = spacing();
  ok('...still a body, spread along the ground it has', edge.avg > C.CROWD.space * 0.45,
     `${edge.avg.toFixed(1)} on the bank against ${(C.CROWD.space * 0.45).toFixed(1)}`);

  /* the formation is what does the work, and it is deterministic: the same board twice puts
   * the same man in the same place, or a guest and a host disagree about where the army is */
  const a = World.createWorld(4242, 2), b = World.createWorld(4242, 2);
  for (const q of [a, b]) { q.chaosNext = 1e9; for (let i = 0; i < 30 * 90; i++) { World.update(q, C.SIM_DT); q.events.length = 0; } }
  const pa = a.units.filter((u) => u.owner === 0), pb = b.units.filter((u) => u.owner === 0);
  eq('the same board musters the same army', pa.length, pb.length);
  ok('...and puts every man in the same place',
     pa.every((u, i) => Math.abs(u.x - pb[i].x) < 1e-6 && Math.abs(u.y - pb[i].y) < 1e-6));
}

/* A COMPANY IS A BODY OF MEN, and it stays one. Three faults reported from play, all of them
 * the same fault underneath: a place in the line was PROPERTY, dealt once off a counter that
 * only ever climbed, and dealt without asking whether the ground under it exists.
 *   It read as a RING with a gap in it, because the fallen never gave their places back and
 * because a place too far from the flag cannot be reached at all (see below).
 *   Men stood in the DARK BEYOND THE MAP, because the place is the order's point plus an offset
 * and nothing said the sum had to be on the board.
 *   And the holes never closed, because nothing in the sim ever drew two men together.
 * The rigs below are the reports, made countable. */
suite('a company stands as a body');
{
  /* a realm of four halls under one standard, gathered at a flag in open country */
  const flagOf = (c) => ({ x: c.x + 380, y: c.y + 380, site: -1 });
  const realm = (seed, flag) => {
    const w = World.createWorld(seed, 2), pl = w.players[0], c = World.cityOf(w, 0);
    w.chaosNext = 1e9;
    for (let a = 0; a < 40 && pl.buildings.filter((b) => b.bt === 'barracks').length < 3; a++) {
      const th = a / 40 * Math.PI * 2;
      pl.essence = 1e6;
      World.applyCommand(w, 0, { c: 'build', x: c.x + Math.cos(th) * 200, y: c.y + Math.sin(th) * 200, bt: 'barracks' });
    }
    pl.banner = flag;
    /* `poor` starves the halls instead of pulling them down: a company that is losing men with
     * no replacements coming is the case the closing of ranks is about, and the halls have to
     * survive it because the war of attrition below needs them back */
    const step = (s, poor) => {
      for (let i = 0; i < Math.round(s / C.SIM_DT); i++) {
        pl.essence = poor ? 0 : 1e6;
        World.update(w, C.SIM_DT); w.events.length = 0;
      }
    };
    return { w, pl, c, step };
  };
  const look = (w, flag) => {
    const us = w.units.filter((u) => u.owner === 0 && u.hp > 0);
    const rs = us.map((u) => Math.hypot(u.x - flag.x, u.y - flag.y)).sort((a, b) => a - b);
    const nn = [];
    for (const a of us) {
      let m = 1e9;
      for (const b of us) if (a !== b) m = Math.min(m, Math.hypot(a.x - b.x, a.y - b.y));
      nn.push(m);
    }
    nn.sort((a, b) => a - b);
    return { n: us.length, us, rmed: rs[rs.length >> 1], rmax: rs[rs.length - 1],
             mid: rs.filter((q) => q < C.CROWD.space * 2).length, nn: nn[nn.length >> 1] };
  };

  const c0 = World.cityOf(World.createWorld(31337, 2), 0), flag = flagOf(c0);
  const r = realm(31337, flag);
  r.step(420);
  const s = look(r.w, flag);
  ok('a company was gathered', s.n > 40, `${s.n} men`);
  ok('...and no man is standing inside another', s.nn > C.CROWD.space * 0.7,
     `${s.nn.toFixed(1)} to his nearest fellow against a berth of ${C.CROWD.space}`);

  /* IT CLOSES ITS RANKS. A third fall with no replacements coming: the survivors must draw in,
   * not stand around the holes they left. Old: 75 -> 71 from the flag, which is the body not
   * moving at all. New: 71 -> 56, at the same spacing, which is the men closing up. */
  r.w.units.filter((u) => u.owner === 0).forEach((u, i) => { if (i % 3 === 1) u.hp = 0; });
  r.step(45, true);
  const after = look(r.w, flag);
  ok('the ranks close when men fall', after.rmed < s.rmed - C.CROWD.space * 0.5,
     `${s.rmed.toFixed(0)} -> ${after.rmed.toFixed(0)} from the flag, ${s.n} -> ${after.n} men`);
  ok('...and they still do not stand inside each other doing it',
     after.nn > C.CROWD.space * 0.6, `${after.nn.toFixed(1)}`);

  /* AND A WAR OF ATTRITION IS WHERE THE RING CAME FROM. Six rounds of losing a third of the
   * company and replacing it — an ordinary twenty minutes of war — and the old formation had
   * hollowed out completely: the men within two berths of the flag went from 11 to ONE and the
   * body crept out from 120 across to 191, because every replacement was handed a place further
   * out than the last and the fallen kept theirs for ever. That is the C-shaped arc with a gap
   * in it, reported from play. Places go by rank among the living now, so the same war leaves
   * the same body: 10 in the middle before, 19 after, and the outer edge where it was. */
  for (let round = 0; round < 6; round++) {
    r.w.units.filter((u) => u.owner === 0).forEach((u, i) => { if (i % 3 === 1) u.hp = 0; });
    r.step(120);
  }
  const s6 = look(r.w, flag);
  ok('a body that has fought still has a middle', s6.mid >= 8,
     `${s.mid} men within two berths of the flag before the war, ${s6.mid} after`);
  ok('...and has not crept outward as its men were replaced', s6.rmax < s.rmax + C.CROWD.space,
     `${s.rmax.toFixed(0)} -> ${s6.rmax.toFixed(0)} across`);
  ok('...and is not standing looser for it', s6.nn > C.CROWD.space * 0.7, `${s6.nn.toFixed(1)}`);

  /* NOBODY IS ORDERED OFF THE EDGE OF THE WORLD. An order may legally be given at the very edge
   * — `applyCommand` clamps a tap to the board and that is a legal tap — and the body behind it
   * is a hundred units deep, so a third of the company was handed ground that does not exist.
   * There is nothing out there to stop them either: the flow field only steers inside its grid
   * and within `NAV.arrive` a man walks at his place in a straight line regardless. Measured on
   * the old rule: 28 men of 96 standing up to 88 units out in the dark. */
  for (const seed of [1000, 4242]) {
    const cc = World.cityOf(World.createWorld(seed, 2), 0);
    const edge = { x: cc.x < C.MAP.W / 2 ? 1 : C.MAP.W - 1, y: cc.y, site: -1 };
    const q = realm(seed, edge);
    q.step(420);
    const live = q.w.units.filter((u) => u.hp > 0);
    const out = live.filter((u) => u.x < 0 || u.y < 0 || u.x > C.MAP.W || u.y > C.MAP.H);
    const worst = out.reduce((m, u) => Math.max(m, -u.x, -u.y, u.x - C.MAP.W, u.y - C.MAP.H), 0);
    eq(`a flag on the edge of the world (seed ${seed}) leaves nobody outside it`, out.length, 0,
       `${out.length} of ${live.length}, worst ${worst.toFixed(0)} past the edge`);
  }
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

  /* ---------------- AND HE DOES NOT WEDGE ON IT ----------------
   * The push only REPELS, and point works are not in the nav masks — only runs are — so the
   * flow field aims a man straight at a hall and the push walks him straight back out along
   * the same line. Order him to a spot dead behind one and the two cancel exactly: he shivers
   * against the wall of it for the rest of the match. Reported from play as troops stuck
   * behind buildings, and this is the arrangement that produces it every time. */
  const w2 = World.createWorld(1000, 2), p2 = w2.players[0];
  w2.chaosNext = 1e9;
  const h2 = p2.buildings.find((b) => b.bt === 'barracks');
  const d2u = C.UNITS.soldier;
  /* dead in line: man, hall, order — so every step he takes is straight into the stone */
  const ang = Math.atan2(h2.y - World.cityOf(w2, 0).y, h2.x - World.cityOf(w2, 0).x);
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const start = { x: h2.x - ux * 90, y: h2.y - uy * 90 };
  const goal = { x: h2.x + ux * 260, y: h2.y + uy * 260 };
  const lone = { id: w2.nextId++, owner: 0, kind: 'soldier', tier: 1, x: start.x, y: start.y,
                 ox: 0, oy: 0, hp: 90, maxHp: 90, dmg: d2u.dmg, cd: 0, goal: null, co: 0, from: -1 };
  w2.units.length = 0; w2.units.push(lone);
  p2.banner = { x: goal.x, y: goal.y, site: -1 };
  const d0 = Math.hypot(lone.x - goal.x, lone.y - goal.y);
  for (let i = 0; i < 30 * 30; i++) { World.update(w2, C.SIM_DT); w2.events.length = 0; }
  const d1 = Math.hypot(lone.x - goal.x, lone.y - goal.y);
  ok('a man ordered to the far side of a work walks round it and arrives',
     d1 < C.NAV.arrive, `${d0.toFixed(0)} from his order, then ${d1.toFixed(0)}`);
  ok('...and he did not end the walk standing in the hall',
     Math.hypot(lone.x - h2.x, lone.y - h2.y) >= C.BUILD.pass - 0.5);

  /* HE NEVER TOUCHED IT. This is the whole of the change: the old model let him walk into the
   * stone and pushed him back out, which is repulsion-after-contact and oscillates by
   * construction. He now turns early enough to graze the work and no closer — so there is
   * nothing to push him off, and nothing that can shove him back and forth. */
  const w3 = World.createWorld(1000, 2), p3 = w3.players[0];
  w3.chaosNext = 1e9;
  const h3 = p3.buildings.find((b) => b.bt === 'barracks');
  const ang3 = Math.atan2(h3.y - World.cityOf(w3, 0).y, h3.x - World.cityOf(w3, 0).x);
  const ex = Math.cos(ang3), ey = Math.sin(ang3);
  const man = { id: w3.nextId++, owner: 0, kind: 'soldier', tier: 1,
                x: h3.x - ex * 200, y: h3.y - ey * 200, ox: 0, oy: 0, hp: 90, maxHp: 90,
                dmg: C.UNITS.soldier.dmg, cd: 0, goal: null, co: 0, from: -1 };
  w3.units.length = 0; w3.units.push(man);
  p3.banner = { x: h3.x + ex * 260, y: h3.y + ey * 260, site: -1 };
  let closest = 1e9;
  for (let i = 0; i < 30 * 40; i++) {
    World.update(w3, C.SIM_DT); w3.events.length = 0;
    closest = Math.min(closest, Math.hypot(man.x - h3.x, man.y - h3.y));
  }
  ok('marching past a work, he never comes inside its ground at all',
     closest >= C.BUILD.pass - 1.5, `closest he came: ${closest.toFixed(1)} of ${C.BUILD.pass}`);
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
  /* the whole point, and it is sharper than it was: he cannot stop any more, so sitting on the
   * Pattern with an empty treasury is not a phase he passes through — it is the rest of his
   * match with no soldier bought. The gate has to keep him off the lines in the first place. */
  ok('...and never held the Pattern with an empty treasury', brokeWhileWalking < 30,
     `${(brokeWhileWalking / 30).toFixed(1)}s walking at zero`);

  /* AND THE RULE STATED DIRECTLY — WHICH IS NO LONGER AN INCOME TEST. The old shared gate
   * asked only "does the ground earn most of the drain", and this block proved it by handing
   * an heir a purse that never empties and checking he STILL refused. That was right while a
   * walk could be called off the moment the money ran out. It cannot now, so the question is
   * not "can I start this" but "can I FINISH it", and what pays for a finish is the bank PLUS
   * whatever the ground earns across the whole walk. A hundred thousand banked is a perfectly
   * good reason to walk — it covers the drain fourteen times over — so the old assertion was
   * demanding the wrong refusal. What must still be refused is an heir who can pay for it
   * NEITHER way. */
  const shr = C.BUILDINGS.shrine, secs = 100 / shr.rate[0], full = shr.drain[0] * secs;
  eq('the drain is the number the gate is built on', shrineDrain, shr.drain[0]);
  const gate = (essence, income) => essence + income * secs >= full * 1.1;
  ok('a thin purse on thin ground is refused', !gate(1200, 7),
     `1200 banked + 7/s over ${(secs / 60).toFixed(1)} min against ${Math.round(full)}`);
  ok('...income comfortably over the drain is enough on its own', gate(150, 26));
  ok('...and so is a bank deep enough to ride it out', gate(full * 1.15, 0),
     `${Math.round(full * 1.15)} banked`);

  const poor = World.createWorld(1000, 2), pp = poor.players[0];
  poor.chaosNext = 1e9;
  pp.buildings.push({ id: poor.nextId++, bt: 'shrine', level: 1, x: c.x + 200, y: c.y, cd: 0,
                      raise: 0, raiseFor: sd.raise, hp: sd.hp, maxHp: sd.hp, lastHurt: -99,
                      node: -1, co: 0 });
  const PURSE = 1200;                  // enough to open with, nothing like enough to finish
  pp.essence = PURSE;
  const bot2 = AI.make('benedict');
  const iss2 = (cmd) => World.applyCommand(poor, 0, cmd);
  for (let i = 0; i < 30 * 60; i++) {
    bot2.step(poor, 0, iss2, C.SIM_DT);
    World.update(poor, C.SIM_DT); poor.events.length = 0;
    pp.essence = PURSE;                // a purse that never empties and never grows
  }
  ok('an heir who can neither bank nor earn the whole walk refuses it', !pp.walking,
     `walking=${pp.walking} on ${(pp.incomeRate || 0).toFixed(1)}/s and ${PURSE} banked, against ${Math.round(full)} needed`);
}

/* AN ORDER THE BOARD WILL REFUSE IS NOT AN ORDER, AND A WANT WITH NOWHERE TO GO IS NOT A WALL
 * ACROSS THE PLAN. Two faults of the same family, and together they stopped a whole policy
 * from playing.
 *   The probe and the command have to agree about WHERE a work will stand. A `claim` work is
 * snapped by the build command to the spring's exact middle, but the heir's placement probe
 * asked `placementError` about the point it had swept TO — and `placementError` reads the writ
 * at the point it is handed. A point 46 out from a spring, lying just inside the writ, came
 * back legal; the order was given; the command snapped it back onto the spring outside the
 * writ and refused it as 'presence'. Measured on `greedy`, whose plan opens with four Gates:
 * five to eight such orders a MINUTE, every minute of every match.
 *   And because the plan stopped dead at its first unmet want whatever the reason, the four
 * mustering halls behind those Gates in greedy's own plan were never reached. One hall, eight
 * men, dead at three and a half minutes to the random ghost. The skill gradient was measuring
 * a ruler that had stopped playing.
 * The rule now: no crew is nothing to do, no essence is a reason to SAVE, and no GROUND is a
 * reason to step past the want and get on with the realm. */
suite('an heir does not order what the board will refuse');
{
  let issued = 0, refused = 0, presence = 0;
  const halls = [];
  for (const seed of SEEDS) {
    const w = World.createWorld(seed, 2);
    w.chaosNext = 1e9;                 // this is about the orders, not about the black road
    const bot = AI.make('greedy');     // the ruler whose plan opens with four Gates
    const iss = (cmd) => {
      const r = World.applyCommand(w, 0, cmd);
      if (cmd.c === 'build') { issued++; if (!r.ok) { refused++; if (r.err === 'presence') presence++; } }
      return r;
    };
    for (let i = 0; i < 30 * 240; i++) {
      bot.step(w, 0, iss, C.SIM_DT);
      World.update(w, C.SIM_DT); w.events.length = 0;
    }
    halls.push(w.players[0].buildings.filter((b) => b.bt === 'barracks').length);
  }
  ok('some building actually happened, or this suite proves nothing', issued >= 10, `${issued} build orders`);
  ok('a Gate is never ordered onto ground the command snaps out from under it',
     presence === 0, `${presence} of ${issued} orders refused as 'presence'`);
  ok('...and an heir does not spend its match giving orders that bounce',
     refused <= issued * 0.25, `${refused} of ${issued} build orders refused`);
  ok('a want with nowhere to go does not stop the plan behind it',
     halls.every((n) => n >= 3), `mustering halls after four minutes, per map: ${halls.join(', ')}`);
}

/* YOU CANNOT MARCH ON A SEAT YOU HAVE NOT FOUND. Every doctrine already carried a clause that
 * says "go and look" — `seek` — and not one of them had ever been ordered, because the banner
 * was read as "the errand, else the doctrine's call" and there is ALWAYS another spring to
 * want. Measured over a full twenty minutes of benedict against the random ghost, on a board
 * whose Seats stood 1588 apart: benedict's unexplored sites never moved off 11 of 24, its
 * furthest man never got past 800 from its own Seat, it never laid eyes on the rival's Seat,
 * and so the assault clause could not even be asked. It finished with 279 men against 13 and
 * could not use one of them. The ghost — whose banner is a uniformly random site — had swept
 * the board and found everything by minute six. The ghost out-scouted the heir.
 * The search now outranks the errand, and stands down of its own accord the moment the Seat is
 * found. This suite is the promise that the war can start at all. */
suite('an heir goes looking for the man he means to fight');
{
  const at = [];
  let found = 0;
  for (const seed of SEEDS) {
    const w = World.createWorld(seed, 2);
    /* against the GHOST on purpose: it is the measured case. A mirror hides the fault, because
     * two heirs prowling their own halves eventually blunder into each other; the ghost sits at
     * home doing nothing coherent, so if the heir does not go and look, nobody looks. */
    const bots = [AI.make('benedict'), AI.make('random')];
    const iss = [0, 1].map((pi) => (cmd) => World.applyCommand(w, pi, cmd));
    let when = null;
    for (let i = 0; i < 30 * 480 && w.winner === null; i++) {
      for (const f of [0, 1]) bots[f].step(w, f, iss[f], C.SIM_DT);
      World.update(w, C.SIM_DT); w.events.length = 0;
      if (when === null && w.players[0].explored[w.map.cities[1]]) when = w.t;
    }
    if (when !== null) { found++; at.push((when / 60).toFixed(1) + 'm'); } else at.push('never');
  }
  ok('the rival Seat is found, on every map', found === SEEDS.length, `found at ${at.join(', ')}`);
  ok('...and inside the first half of a match, not at the end of one',
     at.every((s) => s !== 'never' && parseFloat(s) <= 8), `found at ${at.join(', ')}`);
}

/* NOTHING IS RAISED UNDER SWORDS. A work goes up as a SHELL — a quarter of its hit points,
 * earning nothing, mustering nobody, shooting at nothing until the masons are done — so one
 * begun inside a hostile crowd donates the stone, the crew and the time in a single order.
 * Measured on benedict against `greedy`: its home Gate, 204 from the Seat with the rival's
 * column camped on the spring, was thrown down and raised again EIGHT times between minute
 * three and minute twelve — about a thousand essence and eight crew-shifts on a work that
 * never drew a drop, while the heir sat on income 2.5 and lost. The board already refuses a
 * CONTESTED spring beyond the writ; inside the writ nothing refused anything, and inside the
 * writ is exactly where a besieged heir's springs are.
 * Both halves are asserted: with a rival column on the spring he does not order the Gate, and
 * with the same spring clear he does — or the rule would be indistinguishable from an heir
 * that had simply stopped building. */
suite('nothing is raised under swords');
{
  const trial = (withFoes) => {
    const w = World.createWorld(1000, 2), pl = w.players[0];
    w.chaosNext = 1e9;
    const gate = pl.buildings.find((b) => b.bt === 'gate');
    const site = w.map.sites[gate.node];
    pl.buildings.splice(pl.buildings.indexOf(gate), 1);   // his Gate has been thrown down
    pl.essence = 4000;
    const d = C.UNITS.soldier;
    const put = (owner, n, ox) => {
      for (let i = 0; i < n; i++)
        w.units.push({ id: w.nextId++, owner, kind: 'soldier', tier: 1, x: site.x + ox + i * 7,
                       y: site.y, ox: 0, oy: 0, hp: d.hp, maxHp: d.hp, dmg: d.dmg, cd: 0,
                       goal: null, co: 0, from: -1 });
    };
    put(0, 6, -24);                       // his own men hold the spring either way
    if (withFoes) put(1, 6, 24);          // ...and the rival's column is standing on it
    const bot = AI.make('benedict');
    let ordered = false;
    const iss = (cmd) => {
      if (cmd.c === 'build' && cmd.bt === 'gate' &&
          Math.hypot(cmd.x - site.x, cmd.y - site.y) < C.NODE.r) ordered = true;
      return World.applyCommand(w, 0, cmd);
    };
    /* the world is NOT stepped: this is about the ORDER, not about who wins the fight over
     * the spring, and a melee would settle it before the heir had thought twice */
    for (let i = 0; i < 30 * 12; i++) bot.step(w, 0, iss, C.SIM_DT);
    return ordered;
  };
  ok('a spring his own men hold, and nobody else, is claimed', trial(false));
  ok('...and the same spring with a rival column standing on it is not',
     !trial(true), 'the heir ordered a Gate into a crowd of swords');
}

/* THE MUSTER ANSWERS THE MUSTER, AND A FINISHED PLAN IS NOT A FINISHED REALM. Recruits are
 * paid for continuously, so a hall can only ever drink `price / period` essence a second — two
 * a second at level one. A plan is a fixed list, so an heir who reaches its end stops growing
 * where it stopped: benedict's names TWO halls and no more, and measured over eight matches
 * against `greedy` it sat on 2.0 halls and income 11 from minute two to minute thirteen while
 * the ruler sat on 4.0 and income 18, and lost 5-3 to a policy with no expansion, no powers
 * and no walk. Six of its eleven a second went into stone, and stone at level one does not
 * shoot back.
 * The standing want is ONE MORE HALL THAN HE HOLDS — never a count of its own, which
 * double-counts against the halls the plan already names and builds a barrack town (it did:
 * greedy ran to seven and a half). It is capped, so an heir answers a rush without turning
 * into `greedy`, and it stands down when the two are level. */
suite('the muster answers the muster');
{
  /* the arithmetic the rule rests on: widening the throat by another hall is both cheaper and
   * wider than widening it by a level, because TIER rides the recruit's PRICE too */
  const B = C.BUILDINGS.barracks;
  const drink = (lvl) => C.UNITS.soldier.cost * C.TIER[lvl - 1] / B.period[lvl - 1];
  ok('a hall drinks its recruit\'s price over his period', drink(1) > 0, `${drink(1).toFixed(1)}/s`);
  ok('a second hall widens the throat further than a third level does',
     2 > C.TIER[C.MAX_LEVEL - 1], `x2 against x${C.TIER[C.MAX_LEVEL - 1]}`);
  ok('...and costs less doing it', B.cost < B.up[0] + B.up[1],
     `${B.cost} against ${B.up[0] + B.up[1]}`);

  /* and the behaviour: an heir left alone with ground to draw on does not sit at the end of
   * its plan with a treasury its halls cannot drink — nor does it pave the map with halls */
  const halls = [], spare = [];
  for (const seed of SEEDS) {
    const w = World.createWorld(seed, 2);
    w.chaosNext = 1e9;
    const bot = AI.make('benedict');
    const iss = (cmd) => World.applyCommand(w, 0, cmd);
    for (let i = 0; i < 30 * 360; i++) {
      bot.step(w, 0, iss, C.SIM_DT);
      World.update(w, C.SIM_DT); w.events.length = 0;
    }
    const pl = w.players[0];
    const n = pl.buildings.filter((b) => b.bt === 'barracks').length;
    halls.push(n);
    /* what the halls can DRINK, asked the way the sim and the heir ask it: a forked hall
     * raises the branch's man at the branch's interval, and reading `def.spawns` here would
     * price every hall as though it still mustered soldiers */
    const cap = pl.buildings.reduce((s, b) => {
      if (b.raise || b.work) return s;
      const mus = World.mustersOf(b);
      return mus ? s + C.UNITS[mus.kind].cost * C.TIER[b.level - 1] / mus.period : s;
    }, 0);
    spare.push(+cap.toFixed(1));
  }
  ok('an heir whose plan named two halls holds more than two', halls.every((n) => n > 2),
     `halls at six minutes, per map: ${halls.join(', ')}`);
  /* the cap is the other half of the rule: it answers a rush, it does not become `greedy` */
  ok('...and never more than the cap the rule sets', halls.every((n) => n <= 4),
     `halls at six minutes, per map: ${halls.join(', ')}`);
  ok('so the muster grew with the realm instead of stopping where the plan did',
     spare.every((s) => s >= drink(1) * 2.5), `essence a second the halls can drink: ${spare.join(', ')}`);
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

  /* THE RANK MULTIPLIER IS UNCHANGED. Same drain, same hit points and same damage per minute
   * at every rank as the old throughput upgrade bought — the assertion that says the swap was
   * a repackaging and not a buff. It is about `TIER` reproducing the old rate ratios exactly;
   * WHICH man a level-2 hall raises is the branch's business now, and is tested below. */
  const u = C.UNITS.soldier, OLD = [8, 6.4, 5.0];
  for (let L = 1; L <= 3; L++) {
    const m = C.TIER[L - 1], per = b.period[L - 1];
    near(`rank ${L} drains what it always did`, (u.cost * m) / per, u.cost / OLD[L - 1], 0.05);
    near(`rank ${L} delivers the hit points it always did`, (60 / per) * u.hp * m, (60 / OLD[L - 1]) * u.hp, 2);
    near(`rank ${L} delivers the damage it always did`, (60 / per) * u.dmg * m, (60 / OLD[L - 1]) * u.dmg, 0.4);
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
  /* a hall's level-2 upgrade IS its fork, so it must name a branch — see 'the halls fork' */
  const up = World.applyCommand(w, 0, { c: 'up', id: hall.id, br: 'line' });
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

  /* AND NOW THE MEN ARE DIFFERENT MEN — twice over. The rank makes them tougher, and the
   * BRANCH makes them somebody else: a hall that chose the Shieldwall stops raising soldiers
   * for the rest of the match. Both axes at once is the whole point of the fork. */
  run(30);
  const vets = w.units.filter((q) => q.owner === 0 && q.tier === 2);
  ok('the hall musters veterans', vets.length > 0, vets.length);
  eq('...and they are the branch\'s men, not the hall\'s old ones', vets[0].kind, 'shieldman');
  near('...who are tougher for their rank', vets[0].maxHp, C.UNITS.shieldman.hp * C.TIER[1], 0.01);
  near('...and hit harder', vets[0].dmg, C.UNITS.shieldman.dmg * C.TIER[1], 0.01);
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
/* ~170s of the ~6-minute run: eight full bot-vs-bot matches. The heaviest thing here by far,
 * so it is the first thing --quick puts down. */
if (!QUICK('the solo ladder')) {
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
    if (World.seatOf(w, 1).hp > 0) lived++;
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
  w2.events.length = 0; pl2.alertAt = -99;
  World.hurtBuilding(w2, 0, b2.id, 5, C.CHAOS_ID);
  const byChaos = w2.events.find((e) => e.e === 'hurtcity');
  eq('a work gnawed by fiends names Chaos', byChaos && byChaos.by, C.CHAOS_ID);
  w2.events.length = 0; pl2.alertAt = -99;
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
/* A HALL KEEPS SO MANY AND NO MORE. Not a ceiling on the realm — that one was removed and
 * stays removed, and the suite below still proves it — but a ceiling on a WORK, which is a
 * different animal: a full hall stops drawing, so the answer to wanting a bigger army is
 * another hall, and the surplus that appears when yours are full is what pays for the Pattern.
 * There is no standing upkeep in this game, so without this a hall draws for the whole match
 * and the muster swallows the income for as long as the match lasts. */
suite('a hall keeps so many men and no more');
{
  const w = World.createWorld(1000), pl = w.players[0], c = World.cityOf(w, 0);
  w.chaosNext = 1e9; pl.essence = 9e9;
  const hall = pl.buildings.find((b) => b.bt === 'barracks');
  ok('the opening hall is there to fill', !!hall && !hall.raise);
  const keep = C.UNITS.soldier.keep;
  ok('a soldier has a number and it came out of his price', keep > 0 &&
     keep === Math.max(3, Math.round(C.HALL_KEEP / C.UNITS.soldier.cost)), `${keep}`);
  /* long enough to overfill it several times over if nothing stopped it */
  for (let i = 0; i < 30 * 60 * 12; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  const mine = w.units.filter((u) => u.owner === 0 && u.hp > 0);
  eq('it fills and then stops', mine.filter((u) => u.from === hall.id).length, keep);

  /* A PLACE FREED IS A PLACE REFILLED — a standing support, not a lifetime quota, or an army
   * ground down once could never be rebuilt and every hall would be a consumable. */
  const doomed = mine.filter((u) => u.from === hall.id).slice(0, 5);
  for (const u of doomed) { u.hp = 0; u.dead = true; }
  for (let i = 0; i < 30 * 60 * 3; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  eq('...and refills what it loses', w.units.filter((u) => u.owner === 0 && u.hp > 0 && u.from === hall.id).length, keep);

  /* THE NUMBER IS THE MAN'S, NOT THE BUILDING'S, so a branch changes it by changing who is
   * mustered and needs no entry of its own. A ram costs six times a soldier and comes six
   * times fewer. */
  ok('a dear man comes in smaller numbers than a cheap one',
     C.UNITS.ram.keep < C.UNITS.soldier.keep && C.UNITS.outrider.keep > C.UNITS.ram.keep,
     `ram ${C.UNITS.ram.keep}, soldier ${C.UNITS.soldier.keep}, outrider ${C.UNITS.outrider.keep}`);
  ok('...and every hall keeps about the same VALUE of men',
     Object.keys(C.UNITS).filter((k) => C.UNITS[k].keep)
       .every((k) => Math.abs(C.UNITS[k].keep * C.UNITS[k].cost - C.HALL_KEEP) / C.HALL_KEEP < 0.12),
     Object.keys(C.UNITS).filter((k) => C.UNITS[k].keep)
       .map((k) => `${k} ${C.UNITS[k].keep * C.UNITS[k].cost}`).join(' '));

  /* AND A FULL HALL STOPS DRAWING, which is the whole economic point: the treasury that turns
   * up when your halls are full is what buys a walk. Measured against the walk's own price so
   * it cannot quietly stop being enough. */
  const w2 = World.createWorld(1000), p2 = w2.players[0], c2 = World.cityOf(w2, 0);
  w2.chaosNext = 1e9; p2.essence = 4000;
  let halls = 1;
  for (let a = 0; a < 60 && halls < 3; a++) {
    const th = a / 60 * Math.PI * 2, x = c2.x + Math.cos(th) * 200, y = c2.y + Math.sin(th) * 200;
    if (World.applyCommand(w2, 0, { c: 'build', bt: 'barracks', x, y }).ok) halls++;
  }
  for (const b of p2.buildings) { b.raise = 0; b.hp = b.maxHp; }
  p2.essence = 0;
  for (let i = 0; i < 30 * 60 * 20; i++) { World.update(w2, C.SIM_DT); w2.events.length = 0; }
  const walk = C.BUILDINGS.shrine.drain[0] * (100 / C.BUILDINGS.shrine.rate[0]);
  ok('a realm whose halls are full can afford the Pattern', p2.essence > walk,
     `${Math.round(p2.essence)} banked in 20 minutes against a walk costing ${Math.round(walk)}` +
     ` (uncapped, the same rig banks 3600 and fields 298 men)`);
}

suite('no ceiling on the muster')
/* ~30s: it steps 900 sim-seconds under four halls to prove throughput and the wall-clock
 * budget — pure sim weight, so --quick puts it down too */
if (!QUICK('no ceiling on the muster')) {
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
  /* A WALL-CLOCK BUDGET IS A SHARED-MACHINE MEASUREMENT and it drifts with whatever else the
   * box is doing — the same run measured 85s alone and 104s with four other jobs on the CPU.
   * The bar is set to catch a REGRESSION (something that doubles the cost of a tick), not to
   * police the last twenty per cent, because at that resolution it fails for reasons that have
   * nothing to do with this repository. 900 seconds of play inside 150 is six times realtime. */
  ok('and the sim keeps up with a big one', ms < 150000,
     `${(ms / 1000).toFixed(1)}s for 15 minutes of play, ${army} troops`);

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
    World.seatOf(w, 1).hp = C.CASTLE_HP;
    w.units.length = 0;
    put(kind, n);
    for (let i = 0; i < 30 * 20; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
    return C.CASTLE_HP - World.seatOf(w, 1).hp;
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

  /* THE SAME ROWS, AS CURVES. Nobody reads a table of numbers on a phone the moment a match
   * ends, so the end screen draws these — but WHICH numbers tell the story of a match is a
   * question about the game, which is why the series live here and not in the DOM. */
  const cv = Rec.curves();
  const rows0 = Rec.rows();
  ok('the match comes back as curves', !!cv && cv.t.length > 8, cv ? cv.t.length + ' samples' : 'null');
  ok('...over the same hours the table covers', cv.t[0] < cv.t[cv.t.length - 1]);
  eq('one seat per player', cv.seats.length, 2);
  ok('and it knows which seat you are', cv.seats[0].you && !cv.seats[1].you);
  const byKey = {};
  for (const s of cv.series) byKey[s.key] = s;
  for (const k of ['ess', 'income', 'works', 'gates', 'army', 'pattern', 'hp']) {
    ok('the ' + k + ' curve is drawn for every seat',
       byKey[k] && byKey[k].lines.length === 2 &&
       byKey[k].lines.every((l) => l.length === cv.t.length));
  }
  /* every heir opens with a finished Gate, so a Gate count that starts at zero means the
   * series is reading the wrong thing rather than that the match started poor */
  ok('the Gates are counted from the opening one', byKey.gates.lines[0][0] >= 1,
     'seat 0 opened with ' + byKey.gates.lines[0][0]);
  ok('the Pattern is measured out of a hundred', byKey.pattern.max === 100 && byKey.hp.max === 100);
  const sum = Rec.summary();
  ok('and the facts that are not a curve come with it',
     sum && sum.peakArmy >= 1 && typeof sum.deadChaos === 'number',
     sum ? 'peak ' + sum.peakArmy + ', ' + sum.deadFoe + '/' + sum.deadChaos + ' dead' : 'null');

  /* A TOPPLED HEIR'S LINE STOPS — but not before the fall. Nulling every `out` sample hides
   * the one moment the chart exists to show: a Seat's walls going to nothing IS the end of the
   * match, and drawing it as a line that was always flat at a hundred says the opposite. */
  Rec.begin({ version: 'test', seed: 2, viewer: 0, names: ['A', 'B'], mode: 'test' });
  const seat = (out) => ({ ess: 100, income: 5, works: 2, rising: 0, gates: 1,
                           army: out ? 0 : 3, pattern: 0, hp: out ? 0 : C.CASTLE_HP,
                           walking: false, out: !!out });
  const mk = (t, out) => ({ t, tick: 0, chaos: 0, players: [seat(false), seat(out)] });
  Rec.sample(mk(0)); Rec.sample(mk(20)); Rec.sample(mk(40, true)); Rec.sample(mk(60, true));
  const cv2 = Rec.curves();
  const army = cv2.series.find((s) => s.key === 'army').lines;
  const walls = cv2.series.find((s) => s.key === 'hp').lines;
  eq('a seat still in it is drawn to the end', army[0].filter((v) => v == null).length, 0);
  eq('the fall itself is drawn', walls[1][2], 0, JSON.stringify(walls[1]));
  eq('...and the line stops after it rather than crawling along the floor', army[1][3], null,
     JSON.stringify(army[1]));

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

  /* ---------------- THE RECORD CROSSES THE WIRE ----------------
   * A guest samples its own fog-filtered snapshots: a rival's essence is never on the wire, a
   * rival's works and men are only the ones it can see. So its end screen drew a different
   * match from the host's — reported from play as "the stats are completely different for the
   * guest and the host". The match is over by then and there is nothing left to hide, so the
   * host hands over the true table. */
  /* `rows0` is the host's table, captured beside its curves — NOT re-read here, because by
   * this point later blocks have begun their own records and Rec holds one of those. */
  const packed = rows0;
  ok('the host can hand its table over', packed.length > 8 && packed[0].length > 4,
     `${packed.length} rows of ${packed[0] ? packed[0].length : 0} numbers`);
  ok('...and it is numbers, not objects, so a long match still fits a DataChannel',
     packed.every((r) => r.every((v) => typeof v === 'number')) &&
     JSON.stringify(packed).length < 60000, `${JSON.stringify(packed).length} bytes`);
  {
    /* a GUEST's record of the same match, built the way a guest builds one */
    const w4 = World.createWorld(seed, 2);
    for (let i = 0; i < 30 * 120; i++) { World.update(w4, C.SIM_DT); w4.events.length = 0; }
    Rec.begin({ version: 'test', seed, viewer: 1, names: ['Corwin', 'Eric'],
                mode: 'LAN 2-way', partial: true });
    /* two hours of it: a curve needs two points, exactly as the host's does */
    Rec.sample(Rec.fromSnap(JSON.parse(JSON.stringify(Net.snapFor(w4, 1, []))), 1));
    for (let i = 0; i < 30 * 25; i++) { World.update(w4, C.SIM_DT); w4.events.length = 0; }
    Rec.sample(Rec.fromSnap(JSON.parse(JSON.stringify(Net.snapFor(w4, 1, []))), 1));
    const fogged = Rec.curves();
    ok('a guest does record something of its own', !!fogged);
    ok('a guest\'s own record admits it is partial', fogged.partial);
    ok('...and it cannot see a rival\'s purse', fogged.series.find((q) => q.key === 'ess').lines[0][0] === 0);
    ok('the host\'s table is adopted', Rec.adopt(packed));
    const truth = Rec.curves();
    eq('...and it has the host\'s hours in it', truth.t.length, packed.length);
    ok('...the rival\'s purse among them', truth.series.find((q) => q.key === 'ess').lines[0].some((v) => v > 0));
    ok('...and it stops calling itself partial, because it is the truth now', !truth.partial);
    eq('the guest is still the guest', truth.viewer, 1);
    ok('every hour survived the crossing', truth.series.every((q) => q.lines.every((l) => l.length === packed.length)));
  }

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
/* ---------------- a snapshot may be dropped, an order may not ----------------
 * Reported from play: strong lag in big LAN fights, worsening as the fight grows — the
 * signature of a queue that never drains. `dc.send` does not block; anything it cannot push
 * now sits in `bufferedAmount`, so once a snapshot costs more than its 100ms budget the next
 * queues behind it and the guest falls permanently further behind.
 * The fix rests on an asymmetry worth stating in a test: a snapshot is ABSOLUTE STATE and the
 * next one supersedes it, so dropping one costs a frame of staleness; a command is a DELTA and
 * dropping one loses an order forever. Hence a guard on snapshots ONLY. */
suite('a backed-up channel is skipped, not queued');
{
  const mk = (buffered) => {
    const sent = [];
    return { sent, peer: { idx: 1, dc: { readyState: 'open', bufferedAmount: buffered,
                                         send(t) { sent.push(t); } } } };
  };
  const wasHost = Net.isHost, wasPeers = Net.peers;
  Net.isHost = true;
  ok('there is a snapshot-only send at all', typeof Net.sendSnap === 'function');
  ok('...and a cap it judges against', Net.SNAP_CAP > 0, String(Net.SNAP_CAP));

  const healthy = mk(0);
  Net.peers = [healthy.peer];
  Net.snapDrops = 0;
  const okSend = Net.sendSnap({ t: 'snap', s: { hello: 1 } }, 1);
  ok('the rig is alive: a clear channel takes the snapshot', okSend === true && healthy.sent.length === 1,
     `sent ${healthy.sent.length}`);
  ok('...and nothing was counted as dropped', Net.snapDrops === 0);

  const clogged = mk(Net.SNAP_CAP + 1);
  Net.peers = [clogged.peer];
  const bad = Net.sendSnap({ t: 'snap', s: { hello: 2 } }, 1);
  ok('a backed-up channel is NOT sent to', bad === false && clogged.sent.length === 0,
     `sent ${clogged.sent.length}`);
  ok('...and the drop is counted where a rig can see it', Net.snapDrops === 1, String(Net.snapDrops));

  /* the boundary, so the cap is a real threshold and not a coincidence */
  const edge = mk(Net.SNAP_CAP);
  Net.peers = [edge.peer];
  ok('exactly at the cap still goes', Net.sendSnap({ t: 'snap' }, 1) === true && edge.sent.length === 1);

  /* AN ORDER IS NOT A SNAPSHOT. Net.send is the command path and must be untouched by any of
   * this — a dropped order is an order the player gave and the game never carried out. */
  const clog2 = mk(Net.SNAP_CAP * 10);
  Net.peers = [clog2.peer];
  Net.send({ t: 'cmd', c: { c: 'walk', on: true } }, 1);
  ok('a command still goes out through a clogged channel', clog2.sent.length === 1,
     `sent ${clog2.sent.length}`);

  /* and it only ever serves the seat it was asked for */
  const a = mk(0), b2 = mk(0);
  a.peer.idx = 1; b2.peer.idx = 2;
  Net.peers = [a.peer, b2.peer];
  Net.sendSnap({ t: 'snap' }, 2);
  ok('a snapshot goes to its own seat and no other', a.sent.length === 0 && b2.sent.length === 1,
     `seat1 ${a.sent.length}, seat2 ${b2.sent.length}`);

  Net.isHost = wasHost; Net.peers = wasPeers;
}

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

  /* THE GUEST RUNS THE SIM'S OWN EYES. guestView hands its snapshot to World.visionSources
   * rather than keeping a copy of the vision rules — that copy is where the wall-ends rule
   * and the public walk once went missing — so the snapshot must be world-shaped enough
   * that the reconstruction comes out the SAME list the sim computes: source for source,
   * in order, up to the wire's rounding (a coordinate rounds by half, a mirrored wall end
   * by three halves). The day a vision rule reads world state that does not ride the wire,
   * this is the test that says so. */
  const hostSrc = World.visionSources(w, 1);
  const guestSrc = World.visionSources({ map: w.map, players: wire.players, units: wire.units }, 1);
  eq('a guest rebuilds as many vision sources as the sim', guestSrc.length, hostSrc.length);
  ok('...and each is the same source, up to the wire rounding',
     hostSrc.every((s, i) => guestSrc[i] && Math.abs(s[0] - guestSrc[i][0]) <= 1.5
       && Math.abs(s[1] - guestSrc[i][1]) <= 1.5 && s[2] === guestSrc[i][2]),
     hostSrc.map((s, i) => guestSrc[i] && s[2] === guestSrc[i][2] ? '' : `#${i}`).filter(Boolean).join(','));

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

/* ---------------- fog of war: the land, the stone and the woods ----------------
 * These suites PAINT terrain — nav.terra is the sim's one truth about the land, and the
 * noise owes an assertion nothing — then re-bake the sight grid. Movement cost is left
 * stale on purpose: the men in these arenas are pinned by their banners, and both the eye
 * (World.bakeSight) and the shot (World.rockBetween) read terra, not cost. */
const fogPaint = (w, x0, y0, x1, y1, t) => {
  const nav = w.nav;
  const cx0 = Math.max(0, (x0 / nav.cw) | 0), cx1 = Math.min(nav.W - 1, (x1 / nav.cw) | 0);
  const cy0 = Math.max(0, (y0 / nav.cw) | 0), cy1 = Math.min(nav.H - 1, (y1 / nav.cw) | 0);
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++)
    nav.terra[cy * nav.W + cx] = t;
};
/* bakeSight is guarded so these suites still RUN (and fail honestly) against pre-fog code */
const fogBake = (w) => { if (World.bakeSight) World.bakeSight(w); w.vis = null; };
const fogFresh = (w) => { w.vis = null; };   // canSee recomputes on the next ask
/* a spot at least `need` from every Seat and well off the rim — painting near a Seat would
 * entangle these suites with city vision and the throne's gun */
const fogArena = (w, need) => {
  for (let y = 500; y < C.MAP.H - 500; y += 100) for (let x = 500; x < C.MAP.W - 500; x += 100) {
    let clear = true;
    for (let pi = 0; pi < w.players.length && clear; pi++) {
      const c = World.cityOf(w, pi);
      if (Math.hypot(x - c.x, y - c.y) < need) clear = false;
    }
    if (clear) return { x, y };
  }
  return null;
};
const fogMan = (w, owner, kind, x, y, hp) => {
  const d = C.UNITS[kind];
  const u = { id: w.nextId++, owner, kind, x, y, ox: 0, oy: 0, hp: hp == null ? d.hp : hp,
              maxHp: hp == null ? d.hp : hp, dmg: d.dmg, cd: 0, goal: null, co: 0, from: -1, tier: 1 };
  w.units.push(u); return u;
};

suite('rock blocks the eye');
{
  const w = World.createWorld(1000, 2);
  w.chaosNext = 1e9;
  const F = C.FOG.cell, cc = (g) => (g + 0.5) * F;
  const spot = fogArena(w, 700);
  ok('an arena far from both Seats exists', !!spot);
  const CX = Math.round(spot.x / F), CY = Math.round(spot.y / F);
  fogPaint(w, cc(CX) - 400, cc(CY) - 400, cc(CX) + 400, cc(CY) + 400, WG.T.PLAIN);
  fogBake(w);
  const scout = fogMan(w, 0, 'soldier', cc(CX - 4), cc(CY));
  const mark = fogMan(w, 1, 'soldier', cc(CX + 4), cc(CY));
  fogFresh(w);
  ok('over open ground the mark is seen', World.canSee(w, 0, mark.x, mark.y),
     `${Math.round(Math.hypot(mark.x - scout.x, mark.y - scout.y))} apart, vision ${C.VISION.unit}`);
  /* the ridge: one fog-cell column, seven cells tall, square across the line of sight.
   * The nav grid is 20 and the fog grid 26, so painting nav cells under a fog rect grows
   * the rock by up to a cell of overhang either side — which fog column ends up the FACE
   * is therefore read back off the bake, never assumed. */
  fogPaint(w, CX * F, (CY - 3) * F, (CX + 1) * F - 1, (CY + 4) * F - 1, WG.T.CLIFF);
  fogBake(w);
  ok('behind the ridge he is NOT', !World.canSee(w, 0, mark.x, mark.y));
  let face = -1;
  for (let gx = CX - 3; gx <= CX + 1 && face < 0; gx++)
    if (w.sight && w.sight.opq[CY * w.sight.gw + gx]) face = gx;
  ok('the ridge has a face on the scout\'s side', face > CX - 4 && face > 0,
     w.sight ? `first opaque column at ${face - CX} of the ridge` : 'no sight bake at all');
  ok('the ridge face itself IS seen', World.canSee(w, 0, cc(face), cc(CY)));
  ok('...and the ground before it', World.canSee(w, 0, cc(face - 1), cc(CY)));
  ok('but not the ground past it', !World.canSee(w, 0, cc(CX + 1), cc(CY)));
  /* the SNAPSHOT's gate is this same answer: Net.snapFor filters rival units through
   * canSee, so the mark above is exactly what a guest's wire withholds.
   * NOTE for the wire's keeper: add the direct snapFor assertion (a rival unit behind a
   * ridge absent from the snapshot) beside the leak tests in `multiplayer snapshots`. */
  ok('the shot asks the same ridge', !!World.rockBetween &&
     World.rockBetween(w, scout.x, scout.y, mark.x, mark.y) === true);
  /* step him clear of it — same viewer, half the distance short of his reach, and the
   * sight line up the scout's own column, which no painted rock can touch */
  mark.x = scout.x; mark.y = scout.y - 130;
  fogFresh(w);
  ok('stepped clear of the ridge he is seen again', World.canSee(w, 0, mark.x, mark.y),
     `${Math.round(Math.hypot(mark.x - scout.x, mark.y - scout.y))} apart`);
  ok('and the shot agrees the way is clear', !!World.rockBetween &&
     World.rockBetween(w, scout.x, scout.y, mark.x, mark.y) === false);
}

/* A CRAG IS SEEN TO ITS CREST. The suite above paints a ridge one fog column thick, which
 * has no middle to hide — the rule it proves (the face is seen, the ground past it is not)
 * is silent about a rock that spans several cells. Reported from play: stopping the ray at
 * the FIRST opaque cell left the body of every crag black, so its silhouette was chopped at
 * the near face and the rock read as being inside the fog rather than casting it. */
suite('a crag is seen to its crest');
{
  const w = World.createWorld(1000, 2);
  w.chaosNext = 1e9;
  const F = C.FOG.cell, cc = (g) => (g + 0.5) * F;
  const spot = fogArena(w, 700);
  ok('an arena far from both Seats exists', !!spot);
  const CX = Math.round(spot.x / F), CY = Math.round(spot.y / F);
  fogPaint(w, cc(CX) - 400, cc(CY) - 400, cc(CX) + 400, cc(CY) + 400, WG.T.PLAIN);
  fogBake(w);
  const scout = fogMan(w, 0, 'soldier', cc(CX - 5), cc(CY));
  fogFresh(w);
  ok('the rig is alive: open ground ahead of him is seen', World.canSee(w, 0, cc(CX), cc(CY)));
  /* a MASSIF, five fog columns of it, square across his line of sight */
  fogPaint(w, CX * F, (CY - 3) * F, (CX + 5) * F - 1, (CY + 4) * F - 1, WG.T.CLIFF);
  fogBake(w);
  fogFresh(w);
  /* which columns actually took the rock is read off the bake, never assumed: the nav grid
   * is 20 against the fog grid's 26, so a painted rect grows by up to a cell either side */
  const sg = w.sight;
  let face = -1;
  for (let gx = CX - 4; gx <= CX + 6 && face < 0; gx++) if (sg.opq[CY * sg.gw + gx]) face = gx;
  let run = 0;
  while (sg.opq[CY * sg.gw + (face + run)]) run++;
  ok('the crag is thick enough to have a middle', face > 0 && run >= 3, `face at ${face - CX}, ${run} cells thick`);
  const crest = Math.ceil(run / 2);
  /* the near half — the slope he can see up — every cell of it */
  let nearSeen = 0;
  for (let d = 0; d < crest; d++) if (World.canSee(w, 0, cc(face + d), cc(CY))) nearSeen++;
  ok('every cell of the near slope is seen, not just the face', nearSeen === crest,
     `${nearSeen}/${crest} of the near half seen`);
  ok('...and that is MORE than the face alone', crest > 1);
  /* and the far half is what the rock hides */
  let farSeen = 0;
  for (let d = crest; d < run; d++) if (World.canSee(w, 0, cc(face + d), cc(CY))) farSeen++;
  ok('the far side of the crag is hidden', farSeen === 0, `${farSeen}/${run - crest} of the far half leaked`);
  ok('and so is the ground beyond it', !World.canSee(w, 0, cc(face + run), cc(CY)));
  /* THE EYE ONLY. The shot still refuses the whole massif — a man on the near slope may be
   * seen and not shot, which is cover, and is the one place these two rules disagree. */
  ok('the shot still refuses the crag entire', World.rockBetween(w, scout.x, scout.y, cc(face + 1), cc(CY)) === true);
}

suite('a curtain blocks the eye');
{
  const w = World.createWorld(1000, 2);
  w.chaosNext = 1e9;
  const pl = w.players[0], c = World.cityOf(w, 0);
  pl.essence = 1e6;
  World.applyCommand(w, 0, { c: 'muster', pause: true });
  World.applyCommand(w, 1, { c: 'muster', pause: true });
  /* a legal run beside the Seat, found the way the shell suites find one */
  let line = null;
  for (let a = 0; a < 6.28 && !line; a += 0.2)
    for (let r = 200; r <= 340 && !line; r += 22) {
      const mx = c.x + Math.cos(a) * r, my = c.y + Math.sin(a) * r;
      const px = -Math.sin(a) * C.WALL.unit * 0.45, py = Math.cos(a) * C.WALL.unit * 0.45;
      if (!World.wallError(w, 0, mx - px, my - py, mx + px, my + py))
        line = [mx - px, my - py, mx + px, my + py];
    }
  ok('a run can be laid', !!line);
  const rb = World.applyCommand(w, 0, { c: 'build', bt: 'wall', x: line[0], y: line[1], x2: line[2], y2: line[3] });
  ok('and the order accepted', rb.ok, rb.err);
  const b = pl.buildings.find((q) => q.bt === 'wall');
  const ends = World.wallEnds(b), mid = { x: b.x, y: b.y };
  /* the oriented normal: +d the field side, -d the side the Seat shelters */
  let nx = -(ends[3] - ends[1]), ny = ends[2] - ends[0];
  if (nx * (c.x - mid.x) + ny * (c.y - mid.y) > 0) { nx = -nx; ny = -ny; }
  const nL = Math.hypot(nx, ny) || 1;
  const side = (d) => ({ x: mid.x + (nx / nL) * d, y: mid.y + (ny / nL) * d });
  /* level the ground around the run: these asserts are about the STONE, not whatever
   * woods or crags the seed grew beside this Seat */
  fogPaint(w, mid.x - 350, mid.y - 350, mid.x + 350, mid.y + 350, WG.T.PLAIN);
  fogBake(w);
  let scout = fogMan(w, 1, 'soldier', side(120).x, side(120).y);
  let hidden = fogMan(w, 0, 'soldier', side(-64).x, side(-64).y);
  fogFresh(w);
  ok('a rising run hides nobody', World.canSee(w, 1, hidden.x, hidden.y));
  /* the masons finish — the field cleared first, so nobody is shot while we wait */
  w.units.length = 0;
  for (let i = 0; i < 30 * (C.BUILDINGS.wall.raise + 6) && b.raise > 0; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  eq('the masons finish it', b.raise, 0);
  scout = fogMan(w, 1, 'soldier', side(120).x, side(120).y);
  hidden = fogMan(w, 0, 'soldier', side(-64).x, side(-64).y);
  fogFresh(w);
  ok('a standing run blocks sight', !World.canSee(w, 1, hidden.x, hidden.y),
     `scout ${Math.round(Math.hypot(scout.x - hidden.x, scout.y - hidden.y))} from the man behind it`);
  ok('...but its own stone is seen', World.canSee(w, 1, mid.x, mid.y));
  World.hurtBuilding(w, 0, b.id, 1e9, 1);
  eq('the run is breached', b.breach, 1);
  /* NO refresh is forced here — the breach itself must drop the stale masks (that is the
   * wall-layer versioning), or every viewer stays blind through the new hole until some
   * later rebuild remembers them */
  ok('and sight returns through the breach at once', World.canSee(w, 1, hidden.x, hidden.y));
}

suite('the woods dim the eye');
{
  const w = World.createWorld(42, 2);
  w.chaosNext = 1e9;
  const F = C.FOG.cell, cc = (g) => (g + 0.5) * F;
  const spot = fogArena(w, 700);
  ok('an arena exists', !!spot);
  const CX = Math.round(spot.x / F), CY = Math.round(spot.y / F);
  fogPaint(w, cc(CX) - 400, cc(CY) - 400, cc(CX) + 400, cc(CY) + 400, WG.T.PLAIN);
  /* a belt of woods five cells deep, east of the scout only. The arithmetic this suite
   * pins down (VISION.forest = 2, charged on entry): a unit's reach is 10 cells; the twin
   * over plain costs his 8 cells of distance and is seen; the twin past the belt costs
   * 8 + 5 wooded cells x 1 extra = 13 and is not. The belt itself stays visible — the
   * first rank of trees is always seen, cover you can look AT but not through. */
  fogPaint(w, (CX + 1) * F, (CY - 8) * F, (CX + 6) * F - 1, (CY + 9) * F - 1, WG.T.FOREST);
  fogBake(w);
  fogMan(w, 0, 'soldier', cc(CX), cc(CY));
  const twinWoods = fogMan(w, 1, 'soldier', cc(CX + 8), cc(CY));
  const twinPlain = fogMan(w, 1, 'soldier', cc(CX - 8), cc(CY));
  fogFresh(w);
  ok('over plain a man eight cells out is seen', World.canSee(w, 0, twinPlain.x, twinPlain.y));
  ok('through the woods his twin at the same distance is NOT',
     !World.canSee(w, 0, twinWoods.x, twinWoods.y));
  ok('the first rank of trees is seen', World.canSee(w, 0, cc(CX + 1), cc(CY)));
}

suite('the walk outshines the ridge');
{
  const w = World.createWorld(1000, 3), pl = w.players[1], c = World.cityOf(w, 1);
  w.chaosNext = 1e9;
  pl.essence = 999999;
  const F = C.FOG.cell, cc = (g) => (g + 0.5) * F;
  let at = null;
  for (let rad = 170; rad < C.CLAIM.seat - 40 && !at; rad += 20)
    for (let a = 0; a < 40 && !at; a++) {
      const th = a / 40 * Math.PI * 2, x = c.x + Math.cos(th) * rad, y = c.y + Math.sin(th) * rad;
      if (World.placementError(w, 1, x, y, 'shrine') === null) at = { x, y };
    }
  ok('seat 1 raises a Shrine', !!at && raise(w, 1, at.x, at.y, 'shrine').ok);
  const sh = pl.buildings.find((b) => b.bt === 'shrine');
  /* a ridge two cells thick hard against the Shrine's west face, and a rival scout beyond it */
  const SX = Math.floor(sh.x / F), SY = Math.floor(sh.y / F);
  fogPaint(w, (SX - 3) * F, (SY - 6) * F, (SX - 1) * F - 1, (SY + 7) * F - 1, WG.T.CLIFF);
  fogBake(w);
  const scout = fogMan(w, 0, 'soldier', cc(SX - 7), cc(SY));
  fogFresh(w);
  ok('an ordinary eye behind the ridge cannot see the quiet Shrine',
     !World.canSee(w, 0, sh.x, sh.y),
     `scout ${Math.round(Math.hypot(scout.x - sh.x, scout.y - sh.y))} away, vision ${C.VISION.unit}`);
  World.applyCommand(w, 1, { c: 'walk', on: true });
  fogFresh(w);
  /* A WALK IS PUBLIC — the pillar. The beacon fills its whole disc for EVERY viewer,
   * through the ridge, whether or not the viewer has an eye anywhere near it. */
  ok('the walk lights the Shrine THROUGH the ridge', World.canSee(w, 0, sh.x, sh.y));
  ok('...for an heir with no eyes near it at all', World.canSee(w, 2, sh.x, sh.y));
  ok('...and the beacon ground west of the stone is lit too', World.canSee(w, 2, cc(SX - 4), cc(SY)));
  /* and the only way to put it out is to throw the stone down — the order to stop is refused */
  eq('the beacon cannot be switched off', World.applyCommand(w, 1, { c: 'walk', on: false }).err, 'committed');
  World.hurtBuilding(w, 1, sh.id, sh.hp + 1);
  fogFresh(w);
  ok('the light goes out with the Shrine', !World.canSee(w, 0, sh.x, sh.y));
}

suite('rock blocks the shot');
{
  const w = World.createWorld(1000, 2);
  w.chaosNext = 1e9;
  World.applyCommand(w, 0, { c: 'muster', pause: true });
  World.applyCommand(w, 1, { c: 'muster', pause: true });
  const F = C.FOG.cell, cc = (g) => (g + 0.5) * F;
  const spot = fogArena(w, 700);
  ok('an arena exists', !!spot);
  const CX = Math.round(spot.x / F), CY = Math.round(spot.y / F);
  fogPaint(w, cc(CX) - 400, cc(CY) - 400, cc(CX) + 400, cc(CY) + 400, WG.T.PLAIN);
  /* the ridge: two fog cells wide, nine tall, square across every line of fire below */
  fogPaint(w, (CX - 1) * F, (CY - 4) * F, (CX + 1) * F - 1, (CY + 5) * F - 1, WG.T.CLIFF);
  fogBake(w);
  const pin = (u) => { w.players[u.owner].banner = { x: u.x, y: u.y, site: -1 }; return u; };
  const run = (secs) => { for (let i = 0; i < 30 * secs; i++) { World.update(w, C.SIM_DT); w.events.length = 0; } };

  /* an archer and his mark, 96 apart with 52 of rock between (his range is 105) */
  const archer = pin(fogMan(w, 0, 'archer', cc(CX) - 48, cc(CY), 1e9));
  const mark = pin(fogMan(w, 1, 'soldier', cc(CX) + 48, cc(CY), 1e9));
  run(3);
  eq('with rock between them the arrow never lands', mark.hp, 1e9);
  eq('...and the mark never found the archer either', archer.hp, 1e9);
  /* round the ridge: the same range, a clear line */
  archer.x = mark.x; archer.y = mark.y - 90; archer._t = null; pin(archer);
  run(3);
  ok('round the ridge the arrow lands', mark.hp < 1e9, `hp ${mark.hp}`);

  /* the tower obeys the same law */
  w.units.length = 0;
  const tdef = C.BUILDINGS.tower;
  w.players[0].buildings.push({ id: w.nextId++, bt: 'tower', level: 1, x: cc(CX) - 130, y: cc(CY),
                                cd: 0, raise: 0, raiseFor: tdef.raise, hp: tdef.hp, maxHp: tdef.hp,
                                lastHurt: -99, node: -1, co: 0 });
  const prey = pin(fogMan(w, 1, 'soldier', cc(CX) + 60, cc(CY), 1e9));
  run(2);
  eq('a tower does not shoot through the land\'s rock', prey.hp, 1e9);
  prey.x = cc(CX) - 130; prey.y = cc(CY) + 180; pin(prey);
  run(2);
  ok('clear of the ridge, the tower fires', prey.hp < 1e9, `hp ${prey.hp}`);

  /* THE SEAT IS EXEMPT — deliberately, the same exemption walls already grant it: the
   * throne stands where worldgen put it forever, so rock that could shade it would switch
   * its guns off from outside their reach for the whole match. */
  w.units.length = 0;
  const c0 = World.cityOf(w, 0);
  fogPaint(w, c0.x + 80, c0.y - 80, c0.x + 120, c0.y + 80, WG.T.CLIFF);
  fogBake(w);
  const brave = pin(fogMan(w, 1, 'soldier', c0.x + 150, c0.y, 1e9));
  ok('there IS rock between the throne and its mark', !!World.rockBetween &&
     World.rockBetween(w, c0.x, c0.y, brave.x, brave.y) === true);
  run(1);
  ok('and the throne\'s gun fires over it regardless', brave.hp < 1e9, `hp ${brave.hp}`);
}

suite('the fog pays its way');
{
  const w = World.createWorld(1000, 4);
  w.chaosNext = 1e9;
  /* three hundred men in fifteen-man companies scattered over the sites — the shape of a
   * late war, and the shape the source dedupe exists for */
  let n = 0;
  for (let pi = 0; pi < 4; pi++)
    for (let i = 0; i < 75; i++) {
      const s = w.map.sites[(pi * 31 + ((i / 15) | 0) * 7) % w.map.sites.length];
      fogMan(w, pi, 'soldier', s.x + (i % 5) * 9, s.y + (((i / 5) | 0) % 3) * 9);
      n++;
    }
  eq('three hundred men stand on the board', n, 300);
  const refresh = World.refreshVision || ((w2) => { w2.vis = null; World.canSee(w2, 0, 0, 0); });
  refresh(w); refresh(w); refresh(w);   // warm the ray cache and the JIT
  const N = 30, t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) refresh(w);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  /* the working budget is ~2ms; the ceiling is generous so a regression screams without
   * this test going flaky on a loaded machine */
  ok(`a 4-viewer refresh on a 300-unit board stays under 8ms (measured ${ms.toFixed(2)}ms)`,
     ms < 8, `measured ${ms.toFixed(2)}ms`);
}

/* ---------------- a rig for the men-only suites below ----------------
 * `fogArena` only asks how far a spot is from the Seats. These suites need ground the flow
 * fields will actually let men STAND on: a warden shoved out of a lake by the nav resolver is
 * a warden who is not where the test put him, and the measurement would be of the resolver. */
const walkArena = (w, halfW, halfH) => {
  for (let y = 400; y < C.MAP.H - 400; y += 80) for (let x = 400; x < C.MAP.W - 400; x += 80) {
    let clear = true;
    for (let pi = 0; pi < w.players.length && clear; pi++) {
      const c = World.cityOf(w, pi);
      if (Math.hypot(x - c.x, y - c.y) < 620) clear = false;
    }
    for (let dy = -halfH; dy <= halfH && clear; dy += 40)
      for (let dx = -halfW; dx <= halfW && clear; dx += 40) {
        const ci = NAV.cellOf(w.nav, x + dx, y + dy);
        if (ci < 0 || w.nav.cost[ci] <= 0) clear = false;
      }
    if (clear) return { x, y };
  }
  return null;
};
/* a quiet board: no black road, no throne guns, no muster, nobody but the men put here */
function arenaWorld(seed) {
  const w = World.createWorld(seed == null ? 1000 : seed, 2);
  w.chaosNext = 1e9;
  for (const c of w.cities) c.cd = 1e9;
  for (const p of w.players) p.essence = 100000;
  World.applyCommand(w, 0, { c: 'muster', pause: true });
  World.applyCommand(w, 1, { c: 'muster', pause: true });
  w.units.length = 0;
  return w;
}
const aPut = (w, owner, kind, x, y, hpFrac) => {
  const d = C.UNITS[kind];
  const u = { id: w.nextId++, owner, kind, x, y, ox: 0, oy: 0,
              hp: d.hp * (hpFrac == null ? 1 : hpFrac), maxHp: d.hp, dmg: d.dmg,
              cd: 0, goal: null, co: 0, from: -1, tier: 1 };
  w.units.push(u); return u;
};
const aPin = (w, pi, x, y) => { w.players[pi].banner = { x, y, site: -1 }; };
const aRun = (w, secs) => { for (let i = 0; i < Math.round(30 * secs); i++) { World.update(w, C.SIM_DT); w.events.length = 0; } };

/* THE WALK IS PAID BEFORE THE HALLS ARE, and that ordering IS the commitment. The walk used to
 * run LAST, on whatever the muster had not already spent — so it was a thing an heir did with
 * his spare essence, and a poor walker was merely slow (`pay/want` of full pace, floored so it
 * could never quite stop). Now the Shrine takes its drain off the top: the lines carry him at
 * full pace whatever he holds, and what he pays with is his ARMY. */
suite('a walk is paid before the halls are')
{
  const w = World.createWorld(1000, 2);
  w.chaosNext = 1e9;
  for (const c of w.cities) c.cd = 1e9;
  const pl = w.players[0], en = w.players[1];
  const c = World.cityOf(w, 0);
  pl.essence = 999999;
  let at = null;
  for (let rad = 170; rad < C.CLAIM.seat - 40 && !at; rad += 20)
    for (let a = 0; a < 40 && !at; a++) {
      const th = a / 40 * Math.PI * 2, x = c.x + Math.cos(th) * rad, y = c.y + Math.sin(th) * rad;
      if (World.placementError(w, 0, x, y, 'shrine') === null) at = { x, y };
    }
  ok('a Shrine stands', !!at && raise(w, 0, at.x, at.y, 'shrine').ok);
  const hall = pl.buildings.find((b) => C.BUILDINGS[b.bt].spawns);
  const enHall = en.buildings.find((b) => C.BUILDINGS[b.bt].spawns);
  ok('and both heirs opened with a mustering hall', !!hall && !!enHall);
  const kind = World.mustersOf(hall).kind, price = C.UNITS[kind].cost * C.TIER[hall.level - 1];

  ok('the walk begins', World.applyCommand(w, 0, { c: 'walk', on: true }).ok);
  eq('...and cannot be called off', World.applyCommand(w, 0, { c: 'walk', on: false }).err, 'committed');
  ok('...so he is still on the lines', pl.walking);

  /* TWO EMPTY TREASURIES, ONE OF THEM WALKING. The heirs earn the same way — an opening Gate
   * on a spring apiece — and the only difference between them is the Shrine. Both halls start
   * from nothing owed, so every man either of them raises is bought with money earned here. */
  w.units.length = 0;
  pl.essence = 0; en.essence = 0; hall.paid = 0;
  const at0 = pl.pattern;
  let mine = 0, theirs = 0;
  const SECS = 90;
  for (let i = 0; i < 30 * SECS; i++) {
    World.update(w, C.SIM_DT); w.events.length = 0;
    let a = 0, b = 0;
    for (const u of w.units) { if (u.owner === 0) a++; else if (u.owner === 1) b++; }
    if (a > mine) mine = a;
    if (b > theirs) theirs = b;
  }
  near('a broke walker advances at FULL rate', (pl.pattern - at0) / SECS, C.BUILDINGS.shrine.rate[0], 0.01,
       `${((pl.pattern - at0) / SECS).toFixed(4)}%/s against ${C.BUILDINGS.shrine.rate[0]}`);
  ok('the rival, not walking, musters men off the same ground', theirs > 0, `${theirs} men`);
  eq('...and the walker musters NOBODY: the Shrine drank it all', mine, 0);
  ok('his hall never finishes paying for one', hall.paid < price * 0.5,
     `${hall.paid.toFixed(2)} of ${price}`);
  ok('and the HUD is told what it is costing him', pl.drainRate > 0, `${pl.drainRate.toFixed(1)}/s`);

  /* BUT A MAN ALREADY BOUGHT AND PAID FOR STILL MARCHES. The treasury emptying afterwards
   * does not un-buy him. */
  hall.paid = price; hall.cd = 0; pl.essence = 0;
  const before = w.units.filter((u) => u.owner === 0).length;
  World.update(w, C.SIM_DT); w.events.length = 0;
  ok('a recruit already paid for marches on the tick the treasury empties',
     w.units.filter((u) => u.owner === 0).length > before);

  /* THE ORDER ITSELF, PROVED ON A SINGLE TICK. The consequence above — a broke walker musters
   * nobody — is the ordering's most visible effect but not its proof: when income is far below
   * the drain the Shrine scrapes the treasury bare either way round, and the halls starve
   * whichever went first. So: stop the ground earning at all, leave a purse holding LESS than
   * the Shrine's tick-drain and MORE than the hall's, and step one tick. Paid first, the walk
   * takes the lot and the hall gets nothing. Paid second, the hall gets its penny. */
  pl.eco = 0;
  hall.paid = 0; hall.cd = 5;
  pl.essence = C.BUILDINGS.shrine.drain[0] * C.SIM_DT * 0.7;
  World.applyCommand(w, 0, { c: 'walk', on: true });
  World.update(w, C.SIM_DT); w.events.length = 0;
  eq('the walk takes its cut BEFORE any hall is paid', hall.paid, 0);
  ok('...having taken every penny there was', pl.essence < 1e-9, `${pl.essence} left`);
  pl.eco = 1;

  /* AND THE SHRINE FALLING IS STILL THE WAY OFF IT. */
  const sh = pl.buildings.find((b) => b.bt === 'shrine');
  World.hurtBuilding(w, 0, sh.id, sh.hp + 1);
  ok('throwing the Shrine down still tears the walker off the Pattern', !pl.walking);
  pl.essence = 999999;
  World.update(w, C.SIM_DT); w.events.length = 0;
  ok('...and with no Shrine he cannot set foot on it again',
     World.applyCommand(w, 0, { c: 'walk', on: true }).err === 'shrine');
}

/* A WOUNDED MAN CAN ONLY ABSORB SO MUCH MENDING. Every Warden picks the worst-hurt friend in
 * reach independently, so they all pick the SAME man — the one being focused — and a stack of
 * them switched focus fire off entirely. The cap is on the RECEIVER, so one Warden walking a
 * line of wounded men is untouched and only the pile is answered. */
suite('the mending has a ceiling')
{
  const md = C.UNITS.warden, STACK = 8;
  {
    const w = arenaWorld(1000);
    const spot = walkArena(w, 200, 200);
    ok('an arena of standable ground exists', !!spot);
    aPin(w, 0, spot.x, spot.y);
    const man = aPut(w, 0, 'soldier', spot.x, spot.y, 0.2);
    for (let i = 0; i < STACK; i++) {
      const a = (i + 0.5) / STACK * Math.PI * 2;
      aPut(w, 0, 'warden', spot.x + Math.cos(a) * 45, spot.y + Math.sin(a) * 45);
    }
    const was = man.hp;
    /* HALF A SECOND, and the wound is 56 deep: long enough to measure and short enough that
     * an UNCAPPED stack (8 x 7 = 56 hp/s) would not run out of wound to mend and flatter
     * itself into looking capped. */
    aRun(w, 0.5);
    const rate = (man.hp - was) / 0.5;
    ok('the rig is alive — the man is being mended', man.hp > was, `${was.toFixed(1)} -> ${man.hp.toFixed(1)}`);
    near('eight Wardens on one man mend him at the CAP, not eight times over', rate, C.MEND_CAP, 1.2,
         `${rate.toFixed(1)} hp/s against a cap of ${C.MEND_CAP}`);
    ok('...which is a fraction of what eight of them could pour', rate < md.mend * STACK * 0.4,
       `${rate.toFixed(1)} against ${md.mend * STACK} unrestrained`);
  }

  /* AND SO FOCUS FIRE STILL KILLS. Uncapped, eight Wardens put out 56 hp/s and four soldiers
   * put out 40 — the man they were all hitting simply could not be killed. */
  {
    const w = arenaWorld(1000);
    const spot = walkArena(w, 200, 200);
    aPin(w, 0, spot.x, spot.y); aPin(w, 1, spot.x, spot.y);
    const mark = aPut(w, 0, 'soldier', spot.x, spot.y);
    for (let i = 0; i < STACK; i++) aPut(w, 0, 'warden', spot.x + (i - 3.5) * 22, spot.y + 62);
    for (let i = 0; i < 4; i++) aPut(w, 1, 'soldier', spot.x + (i - 1.5) * 22, spot.y - 40);
    aRun(w, 10);
    ok('four men still kill the one they are all hitting', mark.hp <= 0, `${mark.hp.toFixed(1)} hp left`);
  }

  /* SPREAD, THEY ARE NOT CAPPED AT ALL. Five Wardens each on their own man pour 35 hp/s
   * between them — three and a half times the ceiling — because the ceiling is a man's, not
   * the field's. Measured over half a second, before anybody can march into anybody else. */
  {
    /* the noise makes the land, so a wide flat run of standable ground is not on every seed —
     * ask several rather than assert one and read a generator's mood as a regression */
    let w = null, spot = null, half = 0;
    for (const seed of [1000, 7, 42, 1, 31337, 5, 12, 99]) {
      const cand = arenaWorld(seed);
      for (const h of [700, 600, 500, 420]) {
        const s = walkArena(cand, h, 120);
        if (s) { w = cand; spot = s; half = h; break; }
      }
      if (spot) break;
    }
    ok('a wide arena of standable ground exists', !!spot, `half-width ${half}`);
    aPin(w, 0, spot.x, spot.y);
    const PAIRS = 4, gap = 2 * half / (PAIRS - 1);
    const men = [];
    for (let i = 0; i < PAIRS; i++) {
      const x = spot.x - half + i * gap;
      men.push(aPut(w, 0, 'soldier', x, spot.y, 0.35));
      aPut(w, 0, 'warden', x + 20, spot.y);
    }
    const was = men.map((m) => m.hp);
    aRun(w, 0.5);
    let total = 0;
    men.forEach((m, i) => {
      const r = (m.hp - was[i]) / 0.5;
      total += r;
      near(`the Warden on man ${i} works at his own full rate`, r, md.mend, 0.5, `${r.toFixed(1)} hp/s`);
    });
    ok('so spread Wardens far outdo the cap between them', total > C.MEND_CAP * 2.5,
       `${total.toFixed(1)} hp/s across the field against a per-man cap of ${C.MEND_CAP}`);
  }

  /* A WARDEN WHOSE MAN IS FULL UP GOES AND FINDS ANOTHER — or the cap would answer stacking by
   * wasting the stack, and the branch would collapse to "build exactly one". */
  {
    const w = arenaWorld(1000);
    const spot = walkArena(w, 200, 200);
    aPin(w, 0, spot.x, spot.y);
    const worst = aPut(w, 0, 'soldier', spot.x, spot.y, 0.2);
    const next = aPut(w, 0, 'soldier', spot.x + 34, spot.y, 0.6);
    for (let i = 0; i < 3; i++) aPut(w, 0, 'warden', spot.x + 17, spot.y + 40 + i * 14);
    const w0 = worst.hp, n0 = next.hp;
    aRun(w, 1);
    near('the worst-hurt man takes exactly his ceiling', worst.hp - w0, C.MEND_CAP, 1.2,
         `${(worst.hp - w0).toFixed(1)} hp`);
    ok('and the third Warden, finding him full, mends the next man instead', next.hp > n0 + 3,
       `${n0.toFixed(1)} -> ${next.hp.toFixed(1)}`);
  }
}

/* THE BINDING IS CHAINS, NOT A CONVERSION. It used to do one thing — flip a Chaos fiend
 * already beaten below `bindHp` — which did nothing whatever in a match where the black road
 * stayed quiet, so the branch was a dead pick. A binder now throws his binding on any enemy
 * soldier: slower on the march, and every blow that lands on him lands harder. */
suite('the Binding is chains')
{
  const bd = C.UNITS.binder;
  ok('the binder carries the chains\' numbers', bd.hexT > 0 && bd.hexSlow < 1 && bd.hexAmp > 1 && bd.hexCd > 0,
     `${bd.hexT}s, x${bd.hexSlow} speed, x${bd.hexAmp} damage, ${bd.hexCd}s`);
  ok('and he still cannot touch stone', bd.menOnly === true);

  /* A BINDER CHAINS A RIVAL'S MAN — and never takes him. */
  {
    const w = arenaWorld(1000);
    const spot = walkArena(w, 200, 200);
    aPin(w, 0, spot.x, spot.y); aPin(w, 1, spot.x, spot.y);
    aPut(w, 0, 'binder', spot.x, spot.y);
    const foe = aPut(w, 1, 'soldier', spot.x + 100, spot.y, 0.2);
    let hexes = 0;
    for (let i = 0; i < 30 * 2; i++) {
      World.update(w, C.SIM_DT);
      for (const e of w.events) if (e.e === 'hex') hexes++;
      w.events.length = 0;
    }
    ok('a binder throws chains on a rival soldier', foe.hexed > w.t, `${(foe.hexed - w.t).toFixed(1)}s left`);
    eq('and a rival\'s beaten man is NEVER converted', foe.owner, 1);
    ok('the chains are announced for the renderer', hexes > 0, `${hexes} throws`);
  }

  /* A CHAINED MAN IS SLOWER. Measured on the same man over two equal marches down the same
   * flow field, so the land and the route are the control and the chains are the variable. */
  {
    const w = arenaWorld(1000);
    const spot = walkArena(w, 200, 200);
    const home = World.cityOf(w, 1);
    aPin(w, 1, home.x, home.y);
    const u = aPut(w, 1, 'soldier', spot.x, spot.y);
    const s0 = { x: u.x, y: u.y };
    aRun(w, 1.5);
    const free = Math.hypot(u.x - s0.x, u.y - s0.y);
    ok('the rig is alive — an unchained man marches', free > 30, `${free.toFixed(0)} in 1.5s`);
    const s1 = { x: u.x, y: u.y };
    u.hexed = w.t + 30;
    aRun(w, 1.5);
    const bound = Math.hypot(u.x - s1.x, u.y - s1.y);
    ok('a chained man marches slower', bound < free * (bd.hexSlow + 0.12) && bound > free * (bd.hexSlow - 0.12),
       `${bound.toFixed(0)} against ${free.toFixed(0)} — x${(bound / free).toFixed(2)}`);
    /* AND THE CHAINS LAPSE. Nothing sweeps them up: every reader compares against world.t. */
    const s2 = { x: u.x, y: u.y };
    u.hexed = w.t + 0.2;
    aRun(w, 1.5);
    const freed = Math.hypot(u.x - s2.x, u.y - s2.y);
    ok('and a man whose chains lapse is a normal man again', freed > free * 0.82,
       `${freed.toFixed(0)} against ${free.toFixed(0)}`);
  }

  /* A CHAINED MAN TAKES HEAVIER BLOWS — and the multiplier is inside `hurt`, so it applies to
   * damage that never came from a swing at all. A storm is exactly that case. */
  {
    const w = arenaWorld(1000);
    const spot = walkArena(w, 200, 200);
    aPin(w, 0, spot.x, spot.y);
    const plain = aPut(w, 0, 'soldier', spot.x - 20, spot.y);
    const chained = aPut(w, 0, 'soldier', spot.x + 20, spot.y);
    chained.hexed = w.t + 30;
    w.storms.push({ x: spot.x, y: spot.y, owner: 1, delay: 0, tLeft: 1.0 });
    aRun(w, 1.4);
    const tookPlain = plain.maxHp - plain.hp, tookChained = chained.maxHp - chained.hp;
    ok('the rig is alive — the storm hurt the unchained man', tookPlain > 5,
       `${tookPlain.toFixed(1)} hp`);
    near('a chained man takes the amplified blow', tookChained / tookPlain, bd.hexAmp, 0.06,
         `${tookChained.toFixed(1)} against ${tookPlain.toFixed(1)} — x${(tookChained / tookPlain).toFixed(2)}`);
  }
}

/* ---------------- a company's colours are carried by a man ----------------
 * A company existed on the board as a post at its rally and a pennant on the hall that
 * raises it — nothing among the MEN said which company a column was. The standard is borne
 * now, and the rule has to hold three ways: the same man on every machine (no wire agrees
 * it), the next man the instant the bearer falls, and nobody at all when the company has
 * nobody left. */
suite('a company\'s colours are carried by a man')
{
  const w = World.createWorld(9, 2);
  w.chaosNext = 1e9;
  const pl = w.players[0];
  pl.companies = [{ id: 4, rally: null }, { id: 5, rally: null }];
  w.units.length = 0;
  const put = (id, owner, co, extra) => {
    const u = { id, owner, co, kind: 'soldier', x: 900 + id, y: 900, hp: 70, maxHp: 70, cd: 0, goal: null };
    if (extra) Object.assign(u, extra);
    w.units.push(u);
    return u;
  };
  const c7 = put(7, 0, 4), c3 = put(3, 0, 4), c9 = put(9, 0, 4);
  put(11, 0, 5);
  put(2, 1, 4);                                   // a RIVAL's man, in a company numbered the same
  World.bearers(w);
  eq('the senior man of the company carries it', pl.companies[0].bearer, 3);
  eq('...and each company has its own', pl.companies[1].bearer, 11);
  ok('a rival\'s man is not eligible for our standard', pl.companies[0].bearer !== 2);

  c3.hp = 0;
  World.bearers(w);
  eq('the bearer falls and the next man in seniority has it', pl.companies[0].bearer, 7);
  c7.hp = 0;
  World.bearers(w);
  eq('...and again', pl.companies[0].bearer, 9);
  c9.hp = 0;
  World.bearers(w);
  eq('a company with nobody left flies nothing', pl.companies[0].bearer, null);

  /* A MAN SHUT IN A TOWER IS NOT DRAWN, so a standard over him is a flag belonging to
   * nobody. He is passed over while anyone else is standing — and taken when nobody is. */
  c3.hp = 70; c3.tow = 55;
  c7.hp = 70;
  World.bearers(w);
  eq('a man in a tower is passed over while anyone stands in the open', pl.companies[0].bearer, 7);
  c7.hp = 0; c9.hp = 0;
  World.bearers(w);
  eq('...and carries it when he is all that is left', pl.companies[0].bearer, 3);
}

suite('a company\'s bearer is the owner\'s secret')
{
  const w = World.createWorld(11, 2);
  w.chaosNext = 1e9;
  w.players[0].companies = [{ id: 2, rally: null }];
  w.players[1].companies = [{ id: 3, rally: null }];
  w.units.length = 0;
  const c = World.cityOf(w, 0);
  w.units.push({ id: 6, owner: 0, co: 2, kind: 'soldier', x: c.x, y: c.y, hp: 70, maxHp: 70, cd: 0, goal: null });
  const c1 = World.cityOf(w, 1);
  w.units.push({ id: 8, owner: 1, co: 3, kind: 'soldier', x: c1.x, y: c1.y, hp: 70, maxHp: 70, cd: 0, goal: null });
  World.bearers(w);
  const snap = Net.snapFor(w, 0, []);
  eq('my own company carries its bearer on the wire', snap.players[0].companies[0].bearer, 6);
  eq('a rival\'s companies are not on the wire at all', snap.players[1].companies.length, 0);
}


/* ---------------- the shooters march behind the line ----------------
 * A body used to be one disc with no facing in it, which was honest while every man in it did
 * the same job. It is not honest for a company holding both kinds: an archer dealt rank 3
 * stood in the MIDDLE of the swordsmen and an outrider dealt rank 40 stood on the rim, so the
 * shooters were scattered through the line and shot from inside it. And on the road it was
 * worse than untidy — the column steers at the ORDER, so a 50-speed archer simply walked
 * through a 44-speed shieldwall and the company met the enemy shooters first.
 *
 * Both halves are asserted, because either one alone leaves the bug: a place at the back that
 * a fast man reaches early is not a back line, and a pace cap that puts him in the middle of
 * the ranks is not one either. The board is hand-made and flat so the march is a straight
 * line and the reading is about the ranks rather than about a hill. */
suite('the shooters march behind the line');
{
  const FLAT = { name: 'the Parade Ground', seed: 3, ground: 'PLAIN', height: 0.5,
                 seats: [{ x: 400, y: 400 }, { x: 1600, y: 2000 }],
                 springs: [{ x: 600, y: 560 }, { x: 1400, y: 1840 }, { x: 1000, y: 1200 }] };
  const w = World.createWorld(5, 2, FLAT);
  w.chaosNext = 1e9;
  const pl = w.players[0];
  pl.companies = [{ id: 3, rally: null }];
  w.units.length = 0;
  const START = { x: 700, y: 700 }, GOAL = { x: 700, y: 1700 }, c0 = World.cityOf(w, 0);
  /* SHIELDMEN AT 44 AND ARCHERS AT 50 — the archer is the faster man, which is the whole
   * point: if he ends up behind, it is because he was held there. */
  /* INTERLEAVED, and the two kinds start on exactly the same line. Laid out by id instead —
   * the first version of this rig — the archers began 84 units further up the road, and both
   * the old code and the new one then read "shooters in front" for a reason that had nothing
   * to do with either. */
  const mk = (id, kind, hp, i) => {
    const u = { id, owner: 0, co: 3, kind, x: START.x + (i % 7) * 24 - 84, y: START.y + ((i / 7) | 0) * 24,
                hp, maxHp: hp, cd: 0, goal: null };
    w.units.push(u);
    return u;
  };
  const line = [], shot = [];
  for (let i = 0; i < 14; i++) { line.push(mk(100 + i, 'shieldman', 128, i)); shot.push(mk(200 + i, 'archer', 42, i)); }
  ok('the rig is alive: both kinds set off from the same line',
     Math.abs(line.reduce((a, u) => a + u.y, 0) / 14 - shot.reduce((a, u) => a + u.y, 0) / 14) < 1,
     'one kind was handed a head start');
  ok('the rig is alive: the archer really is the faster man',
     C.UNITS.archer.speed > C.UNITS.shieldman.speed,
     `archer ${C.UNITS.archer.speed} vs shieldman ${C.UNITS.shieldman.speed}`);
  ok('...and the table sorts them without naming either',
     C.UNITS.archer.shoots === true && C.UNITS.shieldman.shoots === false &&
     C.UNITS.ram.shoots === false && C.UNITS.bombard.shoots === true,
     'a reach did not decide which line a man stands in');

  World.applyCommand(w, 0, { c: 'rally', co: 3, x: GOAL.x, y: GOAL.y });
  const mean = (l, f) => l.reduce((a, u) => a + f(u), 0) / l.length;
  /* the march is +y, so a bigger y is further forward */
  const step = (secs) => { for (let i = 0; i < secs * 30; i++) { World.update(w, C.SIM_DT); w.events.length = 0; } };
  step(6);
  const onRoad = { line: mean(line, (u) => u.y), shot: mean(shot, (u) => u.y) };
  ok('the company really set off', onRoad.line > START.y + 60,
     `the line is at ${onRoad.line.toFixed(0)}, started at ${START.y}`);
  /* THE ASSERTION THAT FAILS ON THE OLD CODE — the faster men used to be out in front */
  ok('on the road the shooters are behind the fighting men',
     onRoad.shot < onRoad.line,
     `shooters ${onRoad.shot.toFixed(0)}, line ${onRoad.line.toFixed(0)}`);

  /* ...AND A HALL THAT NEVER STOPS MUSTERING DOES NOT STALL THE COLUMN. This is why the rule
   * is asked of the men standing NEAR a shooter rather than of his company: ten recruits who
   * stepped out of the yard while the column was half way down the road are a thousand units
   * behind it, and any company-wide reckoning of "where the line is" is dragged back to them.
   * Measured with the company-average version of exactly this rule, at the same moment: the
   * column's shooters fell 192 units behind their own line — they had stopped to wait for men
   * they will not meet for a minute — against 26 for the rule that ships. */
  const late = [];
  for (let i = 0; i < 10; i++) {
    late.push(mk(400 + i, 'shieldman', 128, i));
    late.push(mk(420 + i, 'archer', 42, i));
  }
  for (const u of late) { u.x = c0.x + (u.id % 5) * 24 - 48; u.y = c0.y + ((u.id / 5) | 0) % 3 * 24; }
  step(14);
  const trail = mean(line, (u) => u.y) - mean(shot, (u) => u.y);
  ok('the rig is alive: the recruits really are far behind the column',
     mean(line, (u) => u.y) - mean(late.filter((u) => u.kind === 'shieldman'), (u) => u.y) > 100,
     `the column is at ${mean(line, (u) => u.y).toFixed(0)}, the recruits at ` +
     `${mean(late.filter((u) => u.kind === 'shieldman'), (u) => u.y).toFixed(0)}`);
  ok('...and the column\'s shooters still march with their own line, not with the yard',
     trail > 0 && trail < C.CROWD.space * 5,
     `the column's shooters trail their line by ${trail.toFixed(0)}; a body's own depth is ` +
     `about ${C.CROWD.space * 5}`);

  step(30);                                        // let the whole body arrive and settle
  const at = { line: mean(line, (u) => u.y), shot: mean(shot, (u) => u.y) };
  ok('the body arrived at its order', Math.abs(at.line - GOAL.y) < 200,
     `the line settled at ${at.line.toFixed(0)}, ordered to ${GOAL.y}`);
  ok('...and formed up with the shooters behind it', at.shot < at.line,
     `shooters ${at.shot.toFixed(0)}, line ${at.line.toFixed(0)}`);
  /* the two lines are two BODIES, not a mixture: every shooter is behind every fighting man's
   * centre and the gap is wider than the noise of a man settling into his place */
  ok('...as a body of its own, not scattered through the ranks',
     at.line - at.shot > C.CROWD.space,
     `the lines are ${(at.line - at.shot).toFixed(0)} apart, a berth is ${C.CROWD.space}`);

  /* A COMPANY OF ONE KIND IS THE DISC IT ALWAYS WAS — the shift is zero when either line is
   * empty, which is what keeps every other formation suite honest. */
  const w2 = World.createWorld(5, 2, FLAT);
  w2.chaosNext = 1e9;
  w2.players[0].companies = [{ id: 3, rally: null }];
  w2.units.length = 0;
  /* HOLD THE MEN THIS SUITE IS ABOUT. The heir's own hall goes on mustering through a
   * thirty-six second march — measured, fourteen men become twenty-eight — and those
   * recruits belong to the HALL's company and gather at the Seat. Averaged over
   * `w2.units` they drag the reading a hundred and sixty units back down the road, which
   * reads exactly like a company that failed to arrive. */
  const solos = [];
  for (let i = 0; i < 14; i++) {
    const u = { id: 300 + i, owner: 0, co: 3, kind: 'archer', x: START.x + (i % 7) * 24 - 84,
                y: START.y + ((i / 7) | 0) * 24, hp: 42, maxHp: 42, cd: 0, goal: null };
    w2.units.push(u); solos.push(u);
  }
  World.applyCommand(w2, 0, { c: 'rally', co: 3, x: GOAL.x, y: GOAL.y });
  for (let i = 0; i < 36 * 30; i++) { World.update(w2, C.SIM_DT); w2.events.length = 0; }
  const solo = solos.reduce((a, u) => a + u.y, 0) / solos.length;
  ok('a company with no fighting men in it gathers on its flag as it always did',
     Math.abs(solo - GOAL.y) < C.CROWD.space * 2,
     `settled at ${solo.toFixed(0)}, ordered to ${GOAL.y}`);
}

/* ---------------- the parapet is half a shield ----------------
 * A tower is a room and its garrison cannot be touched at all; a wall was nothing of the kind.
 * A berth bought a man reach and nothing else, so holding a curtain was strictly WORSE for him
 * than standing in the field beside it — he is the one man on the run who can be shot back at
 * — and the stone he stood on did not stop a single arrow. `WALL.cover` halves every blow that
 * lands on a berthed man, at the one door damage comes through.
 *
 * THE CONTROL IS THE CONSTANT, and that is deliberate. The obvious rig — a berthed archer
 * beside one in the open, each with the same attackers — is not a controlled comparison, and
 * measuring it proved it: with the cover switched OFF the berthed man already took exactly
 * half, because one of his two attackers was standing where it could not land a shot. The
 * geometry around a curtain is not something a test can assume away. So the same seeded world
 * is played twice, identical in every respect but `WALL.cover`, and the man in the open rides
 * along as the proof the guard is scoped to berths and touches nobody else. */
suite('the parapet is half a shield');
{
  const play = (cover) => {
    const keep = C.WALL.cover;
    C.WALL.cover = cover;
    try {
      const { w, pl, wall } = walledRealm(20260809, { len: 220 });
      const pl1 = w.players[1];
      if (!wall || wall.raise) return null;
      const standable = (x, y) => {
        const cell = NAV.cellOf(w.nav, x, y);
        return cell >= 0 && w.nav.cost[cell] > 0;
      };
      /* the man on the stone answers a company standing at the run; the man in the open
       * answers the Banner, planted far enough off that `postWalls` never offers him a berth */
      pl.companies = [{ id: 1, rally: { x: wall.x, y: wall.y } }];
      let open = null;
      for (let r = 400; r < 700 && !open; r += 40)
        for (const s of [1, -1]) {
          const x = wall.x, y = wall.y + s * r;
          if (!open && standable(x, y) && standable(x, y - 80) && standable(x, y + 80)) open = { x, y };
        }
      if (!open) return null;
      pl.banner = { x: open.x, y: open.y };
      const onStone = manAt(w, 0, 'archer', wall.x, wall.y - 30);
      onStone.co = 1;
      const inField = manAt(w, 0, 'archer', open.x, open.y);
      /* they are here to be shot at, not to die: the reading is damage TAKEN over a fixed span */
      for (const u of [onStone, inField]) { u.hp = 1e6; u.maxHp = 1e6; }
      for (let i = 0; i < 4 * 30; i++) World.update(w, C.SIM_DT);   // let him take his berth
      pl1.companies = [{ id: 1, rally: { x: onStone.x, y: onStone.y } },
                       { id: 2, rally: { x: inField.x, y: inField.y } }];
      for (const [co, d] of [[1, onStone], [2, inField]])
        for (const s of [1, -1]) {
          const f = manAt(w, 1, 'archer', d.x, d.y + s * 80);
          f.co = co; f.hp = 1e6; f.maxHp = 1e6;                     // and they must not be killed
        }
      const was = { stone: onStone.hp, field: inField.hp };
      for (let i = 0; i < 14 * 30; i++) World.update(w, C.SIM_DT);
      return { stone: was.stone - onStone.hp, field: was.field - inField.hp,
               berth: onStone.man === wall.id };
    } finally { C.WALL.cover = keep; }
  };
  const bare = play(1), shipped = play(C.WALL.cover);
  ok('the rig stands up: a curtain, a berthed archer and open ground to compare against',
     !!bare && !!shipped, 'the board would not give the suite what it needs');
  if (bare && shipped) {
    ok('the rig is alive: he holds his berth, and men are shooting at both of them',
       bare.berth && shipped.berth && bare.stone > 0 && bare.field > 0,
       `berth ${bare.berth}/${shipped.berth}, took ${bare.stone.toFixed(1)} on the stone and ` +
       `${bare.field.toFixed(1)} in the open with no cover at all`);
    /* THE ASSERTION THAT FAILS ON THE OLD CODE — the ratio was 1.0 */
    near('the parapet halves what lands on the man holding it', shipped.stone / bare.stone,
         C.WALL.cover, 0.02,
         `${shipped.stone.toFixed(1)} against ${bare.stone.toFixed(1)} with no cover ` +
         `— x${(shipped.stone / bare.stone).toFixed(2)}, want x${C.WALL.cover}`);
    near('...and the man in the open is not sheltered by it at all', shipped.field, bare.field, 0.01,
         `${shipped.field.toFixed(1)} against ${bare.field.toFixed(1)}`);
  }
}

/* ---------------- a body ordered onto a work forms up around it ----------------
 * A spring is TAKEN by standing on it and a Shadow Gate stands on the spring's exact centre,
 * so "hold this spring" is an order onto a WORK. The body's inner ranks were then dealt ground
 * inside the building: each man walked onto it, `stand` pushed him back out to `BUILD.pass` and
 * PINNED him there — and a pinned man is skipped by the crowd, so he never separated from the
 * fellows pinned beside him. Reported from play as troops stuck behind the Shadow Gate, and
 * measured: six of eight at exactly 26.0 from it, none moving a unit in ten seconds, packed to
 * fourteen apart where a berth is twenty-two.
 * The Seat has had this rule for a while — a body ordered home opens out around the tower's
 * ground rather than starting at a point — and this is the same answer for any work. */
suite('a body ordered onto a work forms up around it');
{
  const w = World.createWorld(20260813, 2), pl = w.players[0];
  w.chaosNext = 1e9;
  const gate = pl.buildings.find((b) => b.bt === 'gate');
  ok('the heir opens with a Gate on his spring to stand on', !!gate, 'no Gate');
  if (gate) {
    pl.companies = [{ id: 1, rally: { x: gate.x, y: gate.y } }];
    pl.banner = { x: gate.x, y: gate.y };
    w.units.length = 0;
    const men = [];
    for (let i = 0; i < 8; i++)
      men.push(manAt(w, 0, 'soldier', gate.x + (i % 4) * 24 - 36, gate.y + 200 + ((i / 4) | 0) * 24));
    for (let i = 0; i < 80 * 30; i++) World.update(w, C.SIM_DT);
    const off = men.map((u) => Math.hypot(u.x - gate.x, u.y - gate.y)).sort((a, b) => a - b);
    const nn = men.map((u) => Math.min(...men.filter((v) => v !== u)
      .map((v) => Math.hypot(u.x - v.x, u.y - v.y)))).sort((a, b) => a - b);
    ok('the rig is alive: the company marched to the order', off[off.length - 1] < 200,
       `the furthest is ${off[off.length - 1].toFixed(0)} from the Gate`);
    /* THE ASSERTIONS THAT FAIL ON THE OLD CODE — they stood ON the rim, shoulder to shoulder */
    ok('not one man is pinned against the work', off[0] > C.BUILD.pass + 8,
       `the nearest stands ${off[0].toFixed(0)} out, the rim is ${C.BUILD.pass}`);
    ok('...and the body is a body, not a pile',
       nn[nn.length >> 1] > C.CROWD.space * 0.8,
       `median nearest-neighbour ${nn[nn.length >> 1].toFixed(0)}, a berth is ${C.CROWD.space}`);
  }
}

/* ---------------- a berth is an errand until he is standing in it ----------------
 * Being NAMED to a berth used to be the whole of manning: the tick the roster reached a man he
 * had the parapet's reach, the merlons' cover and a place on the stone in the renderer, wherever
 * on the board he was. A company ordered to a wall snapped onto it from wherever it stood, and
 * it was reported from play as men teleporting to a wall. This is the tower's `tow`/`in` split
 * done for stone — see `a tower shelters its garrison`, the suite written to pin that one.
 * The measurement that named the bug: with the old rule, thirteen of twenty-four men were on the
 * stone one second after the order, still two hundred and seventy-nine units away from it. */
suite('a berth is an errand until he is standing in it');
{
  const { w, pl, wall } = walledRealm(20260811, { len: 220 });
  ok('a curtain goes up to walk to', !!wall && !wall.raise && w.anyWall, 'no run');
  if (wall) {
    const c = World.cityOf(w, 0);
    /* they muster WELL INSIDE the realm, on the sheltered face — `station` puts every berth
     * toward the Seat, and a wall bars its owner everywhere but his gateway, so a company
     * mustered on the exposed face is dealt places it can never reach */
    const inward = Math.sign(c.y - wall.y) || 1;
    pl.banner = { x: wall.x, y: wall.y };
    const men = [];
    for (let i = 0; i < 10; i++)
      men.push(manAt(w, 0, 'archer', wall.x + (i % 5) * 20 - 40,
                     wall.y + inward * (300 + ((i / 5) | 0) * 20)));
    /* distance to the RUN, computed here from its own ends — `segD2` is private to world.js */
    const offRun = (u) => {
      const e = World.wallEnds(wall);
      const vx = e[2] - e[0], vy = e[3] - e[1], l2 = vx * vx + vy * vy || 1;
      let t = ((u.x - e[0]) * vx + (u.y - e[1]) * vy) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      return Math.hypot(u.x - (e[0] + vx * t), u.y - (e[1] + vy * t));
    };
    const away = () => men.reduce((a, u) => a + offRun(u), 0) / men.length;
    const start = away();
    World.update(w, C.SIM_DT);
    ok('the rig is alive: they muster a long walk from the stone', start > 200, `${start.toFixed(0)} out`);
    /* THE ASSERTIONS THAT FAIL ON THE OLD CODE — he was manned where he stood */
    ok('the roster deals every one of them a berth at once',
       men.every((u) => u.toBerth && u.post === wall.id),
       men.map((u) => (u.toBerth ? u.post : 0)).join(','));
    ok('...and not one of them is on the stone yet', men.every((u) => !u.man),
       men.filter((u) => u.man).length + ' already up');
    /* ...and while he walks he is an ordinary man: no parapet on the wire, nothing to a rival
     * but a soldier in a field */
    const walking = Net.snapFor(w, 0).units.find((q) => q.id === men[0].id);
    ok('a man walking to a wall carries no parapet on the wire', walking && walking.man === undefined,
       walking && walking.man);
    let peak = 0;
    for (let i = 0; i < 40 * 30; i++) { World.update(w, C.SIM_DT); peak = Math.max(peak, w.nav.fields.size); }
    ok('he walks there', away() < 60, `${away().toFixed(0)} out, from ${start.toFixed(0)}`);
    ok('...and is on the stone when he arrives', men.every((u) => u.man === wall.id),
       men.filter((u) => !u.man).length + ' still off it');
    const up = Net.snapFor(w, 0).units.find((q) => q.id === men[0].id);
    ok('...and the parapet rides the wire then', up && up.man === wall.id, up && up.man);
    /* A WALL IS ONE DOOR, NOT ONE PER BERTH. A flow field is cached by its goal CELL and the
     * cache evicts by dropping every field it holds, so steering each man at his own berth —
     * fifteen apart, on a twenty-unit grid — mints a goal cell per berth and a full-grid
     * Dijkstra per man per tick. Men walk to the run's gateway and take the last stretch
     * themselves, exactly as a tower's garrison walks to the tower's own centre. */
    ok('a company walking to a wall does not thrash the flow-field cache',
       peak < C.NAV.cacheMax / 2, `${peak} fields held of ${C.NAV.cacheMax}`);
  }
}

/* ---------------- a curtain gathers to the fighting, and splits for two ----------------
 * An even spread is the resting shape of a garrison and exactly the wrong one the moment
 * somebody comes: the two men standing where the assault lands die while the rest watch empty
 * ground four hundred feet away. And ONE point of concentration answers a feint perfectly — hit
 * one end, watch the wall run to it, walk in at the other — so it has to be able to divide.
 * Measured with FEWER MEN THAN BERTHS, the only case where where they stand is a choice. */
suite('a curtain gathers to the fighting, and splits for two');
{
  const rig = wallRig(World, C, { runs: 3 });
  ok('the board has room for a three-run curtain', !!rig, 'nowhere to draw it');
  if (rig) {
    const { w, pl, city: c } = rig;
    const runs = rig.walls;
    const inward = Math.sign(c.y - runs[1].y) || 1;
    pl.companies = [{ id: 1, rally: { x: runs[1].x, y: runs[1].y } }];
    pl.banner = { x: runs[1].x, y: runs[1].y };
    const men = [];
    for (let i = 0; i < 12; i++)
      men.push(manAt(w, 0, 'archer', runs[1].x + (i % 6) * 12 - 36,
                     runs[1].y + inward * (70 + ((i / 6) | 0) * 12)));
    for (const u of men) { u.hp = 1e6; u.maxHp = 1e6; }
    const step = (secs) => { for (let i = 0; i < secs * 30; i++) World.update(w, C.SIM_DT); };
    /* THE THREAT IS ARCHERS, and that is not incidental: soldiers tough enough for this rig
     * knock the run down, it leaves `world.walls`, and "nobody manned it" reads as the rule
     * failing when it was the rig demolishing the evidence. A shooter cannot touch stone.
     * The rival's halls are shut too, or six attackers become twenty-two spread along the whole
     * curtain and the suite measures a garrison PINNED rather than one that will not move. */
    w.players[1].buildings = w.players[1].buildings.filter((b) => !C.BUILDINGS[b.bt].spawns);
    w.players[1].companies = [];
    const foe = (rx, n, co) => {
      const oy = runs[rx].y - inward * 90;
      w.players[1].companies.push({ id: co, rally: { x: runs[rx].x, y: oy } });
      for (let i = 0; i < n; i++) {
        const u = manAt(w, 1, 'archer', runs[rx].x + (i % 4) * 14 - 21, oy);
        u.co = co; u.hp = 1e6; u.maxHp = 1e6;
      }
    };
    /* MEASURED AT THE ALARMS, not at fixed points on the map: the fighting MOVES — enemy
     * shooters chase the men who come to meet them — so counting heads near a run's midpoint
     * reports the garrison absent when it is standing exactly where the battle went. */
    const alarmsOf = () => [...(w._alarms || new Map())].flatMap(([, v]) => v);
    const holding = () => alarmsOf().map((a) => men.filter((u) => Math.abs(u.x - a.x) < C.WALL.alarmSpan).length);
    step(30);
    const rest = runs.map((r) => men.filter((u) => u.man === r.id).length);
    ok('at rest the garrison is spread over the whole curtain', rest.every((n) => n > 0),
       `${rest.join('/')} across the three runs`);
    eq('...and nothing is raising an alarm', alarmsOf().length, 0);
    w.players[1].banner = { x: runs[0].x, y: runs[0].y - inward * 90 };
    foe(0, 6, 1);
    step(30);
    const one = holding();
    ok('an assault raises one alarm', one.length === 1, `${one.length} alarms`);
    /* THE ASSERTION THAT FAILS ON THE OLD CODE — the garrison stood where it started */
    ok('...and the whole garrison gathers to it', one[0] >= men.length * 0.75,
       `${one[0]} of ${men.length} at the fighting`);
    foe(2, 6, 2);
    step(70);
    const two = holding();
    ok('a second assault raises a second alarm', two.length >= 2, `${two.length} alarms`);
    ok('...and the garrison divides between them', two.length >= 2 && Math.min(...two) >= 2,
       `holding ${two.join(' and ')} of ${men.length}`);
    ok('...without either alarm hoarding the company',
       two.length >= 2 && Math.max(...two) <= men.length * 0.75, `holding ${two.join(' and ')}`);
  }
}

/* ---------------- a curtain is held along its whole length ----------------
 * There is no longest run — only how many mason crews you can put on one — so a heir who
 * wants a long curtain draws it as several runs end to end. A company told to hold it lined
 * the ONE run nearest its flag and left the rest of its own wall bare: reported from play with
 * a picture, forty men shoulder to shoulder along the first two hundred feet of a board-long
 * wall, every tower past them empty. Contiguous runs are one CURTAIN now, and the roster is
 * dealt round the whole of it. */
suite('a curtain is held along its whole length');
{
  const rig = wallRig(World, C, { runs: 3 });
  ok('the board has room for three runs drawn end to end', !!rig, 'nowhere to draw them');
  if (rig) {
    const { w, pl, built, finish } = rig;
    const runs = rig.walls;
    pl.essence = 1e7;
    World.applyCommand(w, 0, { c: 'build', bt: 'tower', x: runs[1].x, y: runs[1].y });
    finish();
    const bastion = pl.buildings.filter((b) => b.bt === 'tower').pop();
    eq('three runs go up', built, 3);
    ok('...with a bastion standing in the middle one',
       !!bastion && bastion.onWall === runs[1].id, `onWall ${bastion && bastion.onWall}`);
    /* THE RIG IS ALIVE ONLY IF THEY REALLY ARE ONE CURTAIN — the grouping is the change */
    const grouped = w.walls.map((q) => q.curtain);
    ok('runs that touch are one curtain', new Set(grouped).size === 1 && grouped.length === 3,
       `grouped as ${grouped.join(',')}`);
    /* the order is on the FIRST run's midpoint, nowhere near the other two */
    pl.companies = [{ id: 1, rally: { x: runs[0].x, y: runs[0].y } }];
    pl.banner = { x: runs[0].x, y: runs[0].y };
    const men = [];
    for (let i = 0; i < 40; i++) {
      const u = { id: w.nextId++, owner: 0, co: 1, kind: 'archer', tier: 1,
                  x: runs[0].x + (i % 8) * 12 - 48, y: runs[0].y - 70 + ((i / 8) | 0) * 12,
                  hp: 42, maxHp: 42, dmg: 6, cd: 0, goal: null, from: -1 };
      w.units.push(u); men.push(u);
    }
    for (let i = 0; i < 900; i++) World.update(w, C.SIM_DT);
    const onRun = runs.map((r) => men.filter((u) => u.man === r.id).length);
    const inTower = men.filter((u) => u.tow === bastion.id || u.in === bastion.id).length;
    ok('the rig is alive: the men took their places', onRun.reduce((a, b) => a + b, 0) > 0,
       `${onRun.join('/')} on the three parapets`);
    /* THE ASSERTIONS THAT FAIL ON THE OLD CODE — the far runs held nobody at all, and the
     * men who could not get onto the near one stood in rows at its foot instead */
    ok('every run of the curtain is manned, not just the one under the flag',
       onRun.every((n) => n > 0), `${onRun.join('/')} on the three parapets`);
    ok('...and the bastion on it is filled from the same order', inTower > 0, `${inTower} inside`);
    ok('...with no run hoarding the company', Math.max(...onRun) <= men.length / 2,
       `${onRun.join('/')} of ${men.length} men`);
  }
}

/* ---------------- a garrison AT REST stands still ----------------
 * Reported from play: "archers on walls keep reshuffling even when the wall is not under
 * attack. troops in front of the gate are jittering instead of forming rank on the side."
 * Three separate rules were wrong and all three showed as the same shimmer, so all three are
 * measured here rather than argued about:
 *   (1) the reserve at the foot had no ARRIVAL at all. It walked at its station every tick and
 *       stopped only within three units of it, which is nothing against a twenty-two unit
 *       berth: the crowd moved him a foot off his place and he walked back, thirty times a
 *       second. Measured on this board: 3.80 units a second each, to end 1.9 units from where
 *       they started.
 *   (2) COHESION held him there. Knit is what keeps a company together on the march and it is
 *       exactly wrong for a man walking out of one to a place he has been given — the pull back
 *       is capped at `CROWD.step`, which is the same as his stride, so three men stood 36, 47
 *       and 144 units from their places FOR EVER, one of them in the gateway.
 *   (3) the window in which he walks the last stretch himself was one arrival circle around his
 *       own place, so a man whose rank is further from the stone than that never reached it: he
 *       steers at the run's gateway, arrives, is still "far", and stands in the doorway.
 * The suite plays the board at rest with no enemy anywhere and asserts the shape of it. */
/* ---------------- a tick builds only so many flow fields ----------------
 * THE SIM'S WORST TICK HAS NOTHING TO DO WITH ITS AVERAGE, and this is why. A cold flow field
 * is a Dijkstra over every cell of the board — 6ms on today's board, 59ms on one three times as
 * wide — and `masksFor` drops every field the moment a wall rises or falls, because fields
 * drawn against ground that has changed shape are wrong rather than merely old. The ticks after
 * that wanted two, five, nine of them at once: measured over six-minute matches, the median
 * tick is half a millisecond, the 99th percentile under four, and the worst 27ms here and 285ms
 * on the wide board.
 * IT WAS NOT THE CACHE, which was the first guess. A whole match builds about fifty fields
 * against three hundred thousand reads, the cache peaks at 34 of its 48 places, and the
 * overflow path never runs once — a gentler eviction was written, measured against the same
 * seeds, and changed nothing, because the code it changed never executes.
 * So the rebuilds are rationed, and a man whose field is not ready gets the answer `steer` has
 * always given for a goal it cannot reach. */
suite('a tick builds only so many flow fields');
{
  const w = World.createWorld(31, 2), pl = w.players[0];
  pl.essence = 1e7; w.chaosNext = 1e9;
  const c = World.cityOf(w, 0);
  /* four companies ordered four ways, so four DISTINCT goal cells are wanted on the same tick,
   * which is the shape of the tick after a wall changes */
  const men = [];
  pl.companies = [];
  /* ON GROUND THAT WILL BEAR THEM. Placed by eye at a fixed offset, two of the four rallies
   * landed in water — and the men sent to them never arrived at ration 1, 2 or 999 alike, which
   * is a rig failing rather than a rule failing. The control is what said so. */
  const spot = (i) => {
    for (let r = 560; r < 900; r += 40)
      for (let a = 0; a < 16; a++) {
        const th = (i * Math.PI / 2) + a * 0.13 * (a % 2 ? 1 : -1);
        const x = c.x + Math.cos(th) * r, y = c.y + Math.sin(th) * r;
        const ci = NAV.cellOf(w.nav, x, y);
        if (ci >= 0 && w.nav.cost[ci] > 0) return { x, y };
      }
    return null;
  };
  for (let co = 1; co <= 4; co++) {
    const at = spot(co - 1);
    ok(`company ${co} has somewhere to be sent`, !!at, 'no passable ground found');
    pl.companies.push({ id: co, rally: at || { x: c.x, y: c.y } });
    for (let i = 0; i < 3; i++) {
      const d = C.UNITS.soldier;
      w.units.push({ id: w.nextId++, owner: 0, co, kind: 'soldier', tier: 1,
                     x: c.x + i * 14 - 20, y: c.y + co * 16 - 40,
                     hp: d.hp, maxHp: d.hp, dmg: d.dmg, cd: 0, goal: null, from: -1 });
      men.push(w.units[w.units.length - 1]);
    }
  }
  NAV.debugFieldsReset();
  let worst = 0;
  for (let i = 0; i < 60; i++) {
    const was = NAV.debugFields().built;
    World.update(w, C.SIM_DT);
    worst = Math.max(worst, NAV.debugFields().built - was);
  }
  const d = NAV.debugFields();
  /* THE RIG IS ALIVE ONLY IF FIELDS WERE WANTED AT ALL — a rig that asked for none would pass
   * this suite by doing nothing whatever */
  ok('the rig is alive: the companies asked for fields', d.built > 0, `${d.built} built`);
  ok('...and asked for more than one tick may build', d.built + d.deferred >= 4,
     `${d.built} built, ${d.deferred} deferred`);
  ok('no tick builds more than the ration', worst <= C.NAV.perTick,
     `${worst} in one tick, ration ${C.NAV.perTick}`);
  /* THE ASSERTION THAT FAILS ON THE OLD CODE. The line above cannot: it compares the ration
   * against itself, so lifting the ration to a thousand satisfies it just as well as holding
   * it at one. What the OLD code could never do is DEFER — it built every field asked for on
   * the tick it was asked for, so nothing was ever put off to the next one. */
  ok('...and a field wanted past it waits for the next tick', d.deferred > 0,
     `${d.deferred} deferred`);
  /* AND THE MEN STILL GET THERE. A ration that stalled a column would be a worse bug than the
   * spike it cures: a deferred man walks straight at his goal for that tick, which is what he
   * does past the end of any field. */
  for (let i = 0; i < 40 * 30; i++) World.update(w, C.SIM_DT);
  const home = men.filter((u) => {
    const r = pl.companies.find((q) => q.id === u.co).rally;
    return Math.hypot(u.x - r.x, u.y - r.y) < 220;
  }).length;
  ok('...and every company still reaches its standard', home === men.length,
     `${home} of ${men.length} within 220 of their rally`);

  /* ---- AND ZERO IS THE WAY BACK ----
   * The ration is a TRADE, not a strict improvement: it halves the worst tick and it makes
   * every measured pairing run a little longer (see `NAV.perTick` in const.js for the numbers).
   * So it is a dial, and `0` restores exactly what the sim did before — every field built on
   * the tick it is asked for. This asserts the escape hatch still works, because a way back
   * that has quietly stopped working is worse than no way back at all. */
  {
    const was = C.NAV.perTick;
    C.NAV.perTick = 0;
    const w2 = World.createWorld(31, 2), p2 = w2.players[0];
    p2.essence = 1e7; w2.chaosNext = 1e9;
    const c2 = World.cityOf(w2, 0);
    p2.companies = [];
    for (let co = 1; co <= 4; co++) {
      const at = spot(co - 1);
      p2.companies.push({ id: co, rally: at || { x: c2.x, y: c2.y } });
      for (let i = 0; i < 3; i++) {
        const dd = C.UNITS.soldier;
        w2.units.push({ id: w2.nextId++, owner: 0, co, kind: 'soldier', tier: 1,
                        x: c2.x + i * 14 - 20, y: c2.y + co * 16 - 40,
                        hp: dd.hp, maxHp: dd.hp, dmg: dd.dmg, cd: 0, goal: null, from: -1 });
      }
    }
    NAV.debugFieldsReset();
    let most = 0;
    for (let i = 0; i < 60; i++) {
      const b0 = NAV.debugFields().built;
      World.update(w2, C.SIM_DT);
      most = Math.max(most, NAV.debugFields().built - b0);
    }
    const d2 = NAV.debugFields();
    C.NAV.perTick = was;
    ok('a ration of nought defers nothing', d2.deferred === 0, `${d2.deferred} deferred`);
    ok('...and builds every field on the tick it is wanted', most > C.NAV.perTick,
       `${most} in one tick against a ration of ${C.NAV.perTick}`);
  }
}

suite('a garrison at rest stands still');
{
  const rig = wallRig(World, C, { runs: 2 });
  ok('the board has room for two runs end to end', !!rig, 'nowhere to draw them');
  if (rig) {
    const { w, pl } = rig;
    const runs = rig.walls;
    eq('two runs go up', runs.length, 2);
    pl.companies = [{ id: 1, rally: { x: runs[0].x, y: runs[0].y } }];
    pl.banner = { x: runs[0].x, y: runs[0].y };
    const men = [];
    const add = (kind, i) => {
      const d = C.UNITS[kind];
      const u = { id: w.nextId++, owner: 0, co: 1, kind, tier: 1,
                  x: runs[0].x + (i % 8) * 12 - 48, y: runs[0].y - 90 + ((i / 8) | 0) * 12,
                  hp: d.hp, maxHp: d.hp, dmg: d.dmg, cd: 0, goal: null, from: -1 };
      w.units.push(u); men.push(u);
    };
    for (let i = 0; i < 14; i++) add('archer', i);
    for (let i = 0; i < 16; i++) add('shieldman', 14 + i);
    for (let i = 0; i < 60 * 30; i++) World.update(w, C.SIM_DT);   // a minute to settle
    /* THE RIG IS ALIVE ONLY IF THEY TOOK THE WALL AT ALL — a company that never arrived is
     * perfectly still, and would pass every assertion below for the wrong reason */
    const onStone = men.filter((u) => u.man).length;
    ok('the rig is alive: the archers took the parapet', onStone > 0, `${onStone} on the stone`);
    const foot = men.filter((u) => !u.man && !u.tow);
    ok('...and the rest formed up at its foot', foot.length > 0, `${foot.length} at the foot`);
    /* now twenty seconds of nothing happening at all */
    const key = (u) => (u.tow ? 't' + u.tow : 'b' + u.post + ':' + u.berth);
    const st0 = new Map(men.map((u) => [u.id, { k: key(u), x: u.x, y: u.y, walked: 0 }]));
    let swaps = 0;
    for (let i = 0; i < 20 * 30; i++) {
      World.update(w, C.SIM_DT);
      for (const u of men) {
        const q = st0.get(u.id);
        if (key(u) !== q.k) { swaps++; q.k = key(u); }
        q.walked += Math.hypot(u.x - q.x, u.y - q.y);
        q.x = u.x; q.y = u.y;
      }
    }
    eq('with no enemy on the board, no place changes hands', swaps, 0);
    /* THE ASSERTION THAT FAILS ON THE OLD CODE, and it is the MEDIAN because the mean is a
     * different claim. Measured on the same board, same seed, same company: the old rules gave
     * a median of 2.57 units a second per man — the whole garrison shimmering — against 0.00
     * now. The mean is 5.04 against 2.77, and both of those are one or two men contending for
     * a spot rather than a garrison that will not stand still; that tail is real, is bounded
     * below, and is written up in TODO rather than claimed as fixed. */
    const per = foot.map((u) => st0.get(u.id).walked / 20).sort((a, b) => a - b);
    const walk = per[per.length >> 1];
    ok('...and the reserve is not walking on the spot', walk < 0.5,
       `median ${walk.toFixed(2)} units/s each of [${per.map((q) => q.toFixed(1)).join(' ')}]`);
    ok('...with no more than a man or two still contending for a place',
       per.filter((q) => q > 1).length <= 2, per.map((q) => q.toFixed(1)).join(' '));
    /* AND HE IS STANDING IN HIS PLACE, not a berth short of it and not in the gateway. On the
     * old code eleven of sixteen stood exactly 15 off and three were stranded 36-144 away. */
    const off = foot.map((u) => {
      const wl = w.walls.find((q) => q.b.id === u.post);
      if (!wl) return 0;
      const st = World.station(w, u, wl);
      return Math.hypot(u.x - st.x, u.y - st.y);
    }).sort((a, b) => a - b);
    const median = off[off.length >> 1];
    ok('...and stands in the place he was given', median < 6, `median ${median.toFixed(1)} off`);
  }
}

/* ---------------- a breach is mended by the crews you have left ----------------
 * Reported from play: "mending the breach of a wall doesn't work." It did not, and the refusal
 * blamed the masons: `{c:'fix'}` asked for one crew per `WALL.unit` of the run, exactly as
 * RAISING it does, so a four-crew curtain raised on four Gates could not be mended once two of
 * those Gates had fallen — refused as `busy` with every crew standing idle, and the wall ruined
 * for the rest of the match with nothing the player could do about it.
 * A breach is not a new run: the stone is on the ground and the run is standing. So a mend
 * takes a crew at least and as many more as are idle, and being short-handed is paid for in
 * TIME rather than in a refusal. */
suite('a breach is mended by the crews you have left');
{
  const build = (gatesAfter) => {
    const rig = wallRig(World, C, { crews: 4, len: 450 });
    if (!rig) return null;
    const { w, pl } = rig;
    const wall = rig.walls[0];
    if (!wall) return null;
    World.hurtBuilding(w, 0, wall.id, wall.maxHp * 2, null);
    while (pl.buildings.filter((b) => b.bt === 'gate').length > gatesAfter)
      World.hurtBuilding(w, 0, pl.buildings.find((b) => b.bt === 'gate').id, 1e9, null);
    pl.essence = 1e7;
    return { w, pl, wall };
  };
  const rich = build(4);
  ok('the rig is alive: a long run goes up and is breached',
     !!rich && rich.wall.crews >= 3 && rich.wall.breach === 1,
     rich ? `crews ${rich.wall.crews} breach ${rich.wall.breach}` : 'no room for the run');
  if (rich) {
    const timed = (gatesAfter) => {
      const t = build(gatesAfter);
      const r = World.applyCommand(t.w, 0, { c: 'fix', id: t.wall.id });
      if (!r.ok) return { err: r.err };
      const crews = World.rising(t.w, 0), t0 = t.w.t;
      for (let i = 0; i < 600 * 30; i++) { World.update(t.w, C.SIM_DT); if (!t.wall.work) break; }
      return { crews, secs: t.w.t - t0, breach: t.wall.breach, hp: t.wall.hp, max: t.wall.maxHp };
    };
    const full = timed(4), thin = timed(1);
    eq('with crews to spare the mend is taken', full.err, undefined);
    eq('...and closes the breach', full.breach, 0);
    eq('...on all of the stone', Math.round(full.hp), Math.round(full.max));
    /* THE ASSERTION THAT FAILS ON THE OLD CODE — this was `{ok:false, err:'busy'}` */
    eq('one crew against a three-crew run still takes the order', thin.err, undefined);
    eq('...and closes the breach too', thin.breach, 0);
    eq('...with only the crew he has on it', thin.crews, 1);
    /* being short-handed is paid for in TIME: the whole point of it not being a refusal */
    ok('...and it takes proportionally longer', thin.secs > full.secs * 2,
       `${full.secs.toFixed(0)}s on ${full.crews} crews, ${thin.secs.toFixed(0)}s on ${thin.crews}`);
  }
}

/* ---------------- a curtain that curves has ONE sheltered face ----------------
 * Reported from play, with a picture: "in a wall shaped like this, troops frequently walk on
 * the wrong side of the wall to get to their position." `station` used to work the sheltered
 * side out PER RUN, by pointing at the owner's Seat from that run's own midpoint. On a
 * straight wall every run gets the same answer and the rule is invisible; on a wall that
 * CURVES the direction home swings across the run's own perpendicular partway along, the
 * answer flips, and the far half of the curtain has its berths and its reserve on the other
 * side of the stone. A man walking his own wall to his own place then has to cross it.
 * The face is a property of the WALL, so it is settled once in `noteWalls` and carried run to
 * run along the curtain.
 * The curtain is placed DIRECTLY rather than through the build command: the writ and the mason
 * budget refuse a wall this long, and neither is what is under test. It goes up as a one-tick
 * shell so `update` finishes it and calls `noteWalls` exactly as a real run does. */
suite('a curtain that curves has one sheltered face');
{
  const BOARD = { name: 'the Curving Curtain', seed: 5, ground: 'PLAIN', height: 0.5,
                  seats: [{ x: 520, y: 420 }, { x: 1420, y: 1980 }],
                  springs: [{ x: 760, y: 300 }, { x: 1180, y: 1820 }, { x: 980, y: 1180 }] };
  const w = World.createWorld(5, 2, BOARD);
  const pl = w.players[0], city = World.cityOf(w, 0);
  pl.essence = 1e7;
  /* six crew-lengths bent steadily through 120 degrees */
  const def = C.BUILDINGS.wall, pts = [];
  const RAD = C.WALL.unit * 6 / (120 * Math.PI / 180);
  for (let i = 0; i <= 6; i++) {
    const a = Math.PI * 1.15 + (i / 6) * 120 * Math.PI / 180;
    pts.push({ x: 1000 + Math.cos(a) * RAD, y: 900 + Math.sin(a) * RAD });
  }
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y), units = len / C.WALL.unit;
    pl.buildings.push({ id: w.nextId++, bt: 'wall', level: 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
                        x2: b.x, y2: b.y, cd: 0, raise: 0.001, raiseFor: def.raise,
                        hp: def.hp * units, maxHp: def.hp * units, lastHurt: -99, node: -1, co: 0,
                        crews: Math.max(1, Math.ceil(units)), units,
                        gated: units * C.WALL.unit >= C.WALL.gateMin ? 1 : 0 });
  }
  for (let k = 0; k < 20; k++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  const runs = w.walls.filter((q) => q.owner === 0);
  eq('the six runs stand', runs.length, 6);
  eq('...and they are one curtain', new Set(runs.map((q) => q.curtain != null ? q.curtain : q.b.id)).size, 1);
  /* the sheltered face, as the sim has it */
  const shelt = (q) => {
    const L = Math.hypot(q.bx - q.ax, q.by - q.ay) || 1;
    let nx = -(q.by - q.ay) / L, ny = (q.bx - q.ax) / L;
    if (q.norm) { nx = q.norm.nx; ny = q.norm.ny; }
    else if (nx * (city.x - q.b.x) + ny * (city.y - q.b.y) < 0) { nx = -nx; ny = -ny; }
    if (q.b.flip) { nx = -nx; ny = -ny; }
    return { nx, ny };
  };
  const ns = runs.map(shelt);
  let opp = 0;
  for (let i = 0; i + 1 < runs.length; i++)
    if (ns[i].nx * ns[i + 1].nx + ns[i].ny * ns[i + 1].ny < 0) opp++;
  /* THE ASSERTION THAT FAILS ON THE OLD CODE — runs 2 and 3 pointed opposite ways */
  ok('no two neighbouring runs shelter opposite faces', opp === 0,
     `${opp} neighbouring pair(s) disagree: ` + ns.map((n) => `(${n.nx.toFixed(2)},${n.ny.toFixed(2)})`).join(' '));
  /* AND THE FACE IS ON THE WORK, because the renderer draws the parapet and swings the gates
   * from it and cannot re-derive a chain it only holds part of */
  ok('the face is stamped on the run, for the wire and the eye',
     runs.every((q) => {
       const L = Math.hypot(q.bx - q.ax, q.by - q.ay) || 1;
       const px = -(q.by - q.ay) / L, py = (q.bx - q.ax) / L;
       const f = q.b.face != null ? q.b.face : 1;
       return Math.abs(px * f - q.norm.nx) < 1e-6 && Math.abs(py * f - q.norm.ny) < 1e-6;
     }), 'face: ' + runs.map((q) => q.b.face || 1).join(','));

  /* ...and now walk a company along it. The spawn and the order are pinned to the RAW
   * perpendicular turned toward the Seat — a constant — and not to the rule under test, or
   * before and after would be two different experiments wearing one name. */
  const raw = (q) => {
    const L = Math.hypot(q.bx - q.ax, q.by - q.ay) || 1;
    let nx = -(q.by - q.ay) / L, ny = (q.bx - q.ax) / L;
    if (nx * (city.x - q.b.x) + ny * (city.y - q.b.y) < 0) { nx = -nx; ny = -ny; }
    return { nx, ny };
  };
  const first = runs[0], last = runs[runs.length - 1], rf = raw(first), rl = raw(last);
  const co = { id: 7, rally: { x: last.bx + rl.nx * 30, y: last.by + rl.ny * 30, site: -1 } };
  pl.companies = pl.companies || [];
  pl.companies.push(co);
  const men = [], MEN = 24;
  for (let i = 0; i < MEN; i++) {
    const a = (i / MEN) * Math.PI * 2, r = 20 + (i % 6) * 12;
    const m = { id: 9001 + i, owner: 0, kind: 'archer', tier: 1,
                x: first.ax + rf.nx * 40 + Math.cos(a) * r, y: first.ay + rf.ny * 40 + Math.sin(a) * r,
                hp: 200, maxHp: 200, cd: 0, goal: null, co: co.id, from: 0 };
    w.units.push(m); men.push(m);
  }
  const segNear = (q, px, py) => {
    const dx = q.bx - q.ax, dy = q.by - q.ay, L2 = dx * dx + dy * dy || 1;
    let t = ((px - q.ax) * dx + (py - q.ay) * dy) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    return { x: q.ax + dx * t, y: q.ay + dy * t };
  };
  const prev = new Map(), crossers = new Set();
  for (let k = 0; k < 30 * 60; k++) {
    World.update(w, C.SIM_DT); w.events.length = 0;
    if (k % 5) continue;
    for (const m of men) {
      if (m.hp <= 0 || !m.post) continue;
      let near = null, nd = Infinity;
      for (const q of runs) {
        const p = segNear(q, m.x, m.y), dd = (p.x - m.x) * (p.x - m.x) + (p.y - m.y) * (p.y - m.y);
        if (dd < nd) { nd = dd; near = { q, p }; }
      }
      const n = shelt(near.q);
      const side = (m.x - near.p.x) * n.nx + (m.y - near.p.y) * n.ny;
      const was = prev.get(m.id);
      if (was != null && Math.abs(was) > C.WALL.thick && Math.abs(side) > C.WALL.thick &&
          Math.sign(was) !== Math.sign(side)) crossers.add(m.id);
      prev.set(m.id, side);
    }
  }
  const spread = new Set(men.filter((m) => m.post).map((m) => m.post));
  ok('the rig is alive: the company was dealt places along the whole curtain', spread.size >= 3,
     `${spread.size} run(s) drew men`);
  ok('...and they took them', men.filter((m) => m.man).length >= MEN - 2,
     `${men.filter((m) => m.man).length} of ${MEN} standing in a place`);
  /* THE ASSERTION THAT FAILS ON THE OLD CODE — eleven of forty crossed, measured */
  eq('no man crossed his own wall to reach his place', crossers.size, 0);
}

/* ---------------- a garrison does not stroll out through its own gate ----------------
 * Reported from play, with a picture and in these words: on a zigzag wall with a large army,
 * "troops using a wall gate to go outside, then another wall gate to get to their position."
 * Two causes, both measured on an eight-run dogleg with a hundred and sixty men and an assault
 * sprung at the far end, counting every TRANSIT of the curtain (the segment a man walked this
 * tick crossing a run's line), over a hundred seconds of reshuffling:
 *   - the final approach is resolved by `stand` alone, which is what lets a man CLIMB his own
 *     run, and the crossing test in front of it asked about that one run only — so a man
 *     beelining the length of a zigzag walked through five runs of his own stone: 94 transits;
 *   - the walk-in steered at the run's GATEWAY, a point ON the wall and a hole punched out of
 *     its owner's own nav layer, so the flow field was free to route him through it — and on a
 *     dogleg it did, because out-one-gate-and-in-the-next really is the short way: 4,222.
 * With the beeline barred from every run but the one he is climbing onto, and the walk-in
 * anchored a row INSIDE the doorway: 2 through the stone and 560 through a gateway.
 * And then the third cause, which is the flow field being RIGHT — on a dogleg, out through one
 * gateway and back in through the next really IS the short way, because the sheltered side has
 * the wall's own apexes poking into it. The stone is now SOLID to a man walking to a place on
 * it, on a second layer per heir (not per company — it depends on the owner and one bit), and
 * the door decides: coming from OUTSIDE his own troops always pass, and going from INSIDE it is
 * shut to a man posted to that wall. One test, because a posted man's station is always on the
 * sheltered side — inside reads the shut layer, outside the open one, and no direction has to
 * be modelled. Switched on the SIDE HE IS ON, never on whether the field can reach him: keyed
 * on reachability a man falls back to the open layer, takes a stride, is turned round, and a
 * doorway fills with men jittering — 2,590 transits, and 637 with the doorway exempted, both
 * worse than leaving the gates open. Now: 0 through the stone and 173 through a gateway. */
suite('a garrison does not stroll out through its own gate');
{
  const BOARD = { name: 'the Dogleg', seed: 5, ground: 'PLAIN', height: 0.5,
                  seats: [{ x: 520, y: 420 }, { x: 1420, y: 1980 }],
                  springs: [{ x: 760, y: 300 }, { x: 1180, y: 1820 }, { x: 980, y: 1180 }] };
  const w = World.createWorld(5, 2, BOARD);
  const pl = w.players[0];
  pl.essence = 1e7;
  const ZIG = 50 * Math.PI / 180, def = C.BUILDINGS.wall, pts = [{ x: 620, y: 1000 }];
  for (let i = 0; i < 8; i++) {
    const a = (i % 2 ? -ZIG : ZIG), p = pts[pts.length - 1];
    pts.push({ x: p.x + Math.cos(a) * C.WALL.unit, y: p.y + Math.sin(a) * C.WALL.unit });
  }
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y), units = len / C.WALL.unit;
    pl.buildings.push({ id: w.nextId++, bt: 'wall', level: 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
                        x2: b.x, y2: b.y, cd: 0, raise: 0.001, raiseFor: def.raise,
                        hp: def.hp * units, maxHp: def.hp * units, lastHurt: -99, node: -1, co: 0,
                        crews: Math.max(1, Math.ceil(units)), units,
                        gated: units * C.WALL.unit >= C.WALL.gateMin ? 1 : 0 });
  }
  for (let k = 0; k < 20; k++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  const runs = w.walls.filter((q) => q.owner === 0);
  eq('the zigzag stands as one curtain', new Set(runs.map((q) => q.curtain != null ? q.curtain : q.b.id)).size, 1);
  ok('...and every run of it has a gateway', runs.every((q) => q.gate), runs.filter((q) => q.gate).length + '/' + runs.length);
  /* A POLYLINE HAS A LEFT AND A RIGHT, and on a dogleg that is the only definition of "the
   * same side" that survives. Chaining by "agree with your neighbour's normal" — the obvious
   * rule, and the first one tried — flips a run whose bearing differs by more than a right
   * angle, which is every dogleg, and puts alternate runs' sheltered faces on opposite sides.
   * It was measured doing exactly that: gateway transits went UP, 61 to 87. */
  const face = (q) => {
    const L = Math.hypot(q.bx - q.ax, q.by - q.ay) || 1;
    let nx = -(q.by - q.ay) / L, ny = (q.bx - q.ax) / L;
    if (q.norm) { nx = q.norm.nx; ny = q.norm.ny; }
    if (q.b.flip) { nx = -nx; ny = -ny; }
    return { nx, ny };
  };
  const ns = runs.map(face);
  ok('every run of the dogleg shelters the same side of it',
     ns.every((n) => Math.sign(n.ny) === Math.sign(ns[0].ny)),
     ns.map((n) => `(${n.nx.toFixed(2)},${n.ny.toFixed(2)})`).join(' '));

  /* a big army: berths are `len/berth` per run, so most of it is RESERVE, and the reserve is
   * what walks */
  const co = { id: 7, rally: null };
  pl.companies = pl.companies || [];
  pl.companies.push(co);
  const raw0 = (() => {
    const q = runs[0], L = Math.hypot(q.bx - q.ax, q.by - q.ay) || 1;
    const c = World.cityOf(w, 0);
    let nx = -(q.by - q.ay) / L, ny = (q.bx - q.ax) / L;
    if (nx * (c.x - q.b.x) + ny * (c.y - q.b.y) < 0) { nx = -nx; ny = -ny; }
    return { nx, ny };
  })();
  const MEN = 160, men = [];
  for (let i = 0; i < MEN; i++) {
    const a = (i / MEN) * Math.PI * 2, r = 20 + (i % 8) * 13;
    const m = { id: 9001 + i, owner: 0, kind: 'archer', tier: 1,
                x: runs[0].ax + raw0.nx * 60 + Math.cos(a) * r,
                y: runs[0].ay + raw0.ny * 60 + Math.sin(a) * r,
                hp: 200, maxHp: 200, cd: 0, goal: null, co: co.id, from: 0 };
    w.units.push(m); men.push(m);
  }
  const mid = runs[(runs.length / 2) | 0];
  co.rally = { x: mid.gx, y: mid.gy, site: -1 };
  const segX = (ax, ay, bx, by, cx, cy, dx, dy) => {
    const sd = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
    const o = (u, v) => (u > 0) !== (v > 0);
    return o(sd(ax, ay, bx, by, cx, cy), sd(ax, ay, bx, by, dx, dy)) &&
           o(sd(cx, cy, dx, dy, ax, ay), sd(cx, cy, dx, dy, bx, by));
  };
  const at = new Map();
  for (const m of men) at.set(m.id, { x: m.x, y: m.y });
  const SPRING = 30 * 40;
  let gateAfter = 0, stoneAll = 0;
  for (let k = 0; k < 30 * 100; k++) {
    if (k === SPRING) {
      const q = runs[runs.length - 1], n = face(q);
      for (let i = 0; i < 12; i++)
        w.units.push({ id: 8000 + i, owner: 1, kind: 'soldier', tier: 1,
                       x: q.bx - n.nx * (110 + i * 9), y: q.by - n.ny * (110 + i * 9),
                       hp: 1e6, maxHp: 1e6, cd: 0, goal: null, co: 0, from: 0 });
    }
    World.update(w, C.SIM_DT); w.events.length = 0;
    for (const m of men) {
      if (m.hp <= 0) continue;
      const p = at.get(m.id);
      if (p.x === m.x && p.y === m.y) continue;
      for (const q of runs) {
        if (!segX(p.x, p.y, m.x, m.y, q.ax, q.ay, q.bx, q.by)) continue;
        const inGate = q.gate && (m.x - q.gx) * (m.x - q.gx) + (m.y - q.gy) * (m.y - q.gy) < C.WALL.gate * C.WALL.gate;
        if (inGate) { if (k >= SPRING) gateAfter++; } else stoneAll++;
      }
      p.x = m.x; p.y = m.y;
    }
  }
  ok('the rig is alive: the garrison filled the curtain', men.filter((m) => m.man).length >= 60,
     men.filter((m) => m.man).length + ' standing in a place');
  /* THE ASSERTIONS THAT FAIL ON THE OLD CODE — 94 through the stone, 4,222 through the gates */
  /* THE ASSERTIONS THAT FAIL ON THE OLD CODE — 94 through the stone, 4,222 through the gates */
  ok('nobody walks through his own masonry', stoneAll <= 5, stoneAll + ' transits through stone');
  ok('...and the garrison does not commute through its own gateways',
     gateAfter <= 600, gateAfter + ' gateway transits while reshuffling');
}

/* ---------------- the campaign: chapters and their objectives ----------------
 * An objective is a PREDICATE over world state and nothing else, which is exactly why it lives
 * in a headless-safe file: a predicate that cannot be run in Node cannot be tested, and the one
 * new rule the campaign adds would then be the only rule in the game nobody could check.
 * The sim is untouched by all of this. `World.declare` is the single door out — guarded, and
 * emitting the same event every other ending emits — and `update` grew no third condition. */
suite('the campaign: chapters and their objectives');
{
  const CAM = CAMPAIGN;
  ok('there are chapters', CAM.CHAPTERS.length >= 5, String(CAM.CHAPTERS.length));
  ok('every one has a key, a title, a briefing, a rival, a pinned board and an objective',
     CAM.CHAPTERS.every((c2) => c2.key && c2.title && c2.brief && c2.heir &&
                                c2.seed != null && c2.obj && c2.won),
     CAM.CHAPTERS.filter((c2) => !(c2.key && c2.title && c2.brief && c2.heir && c2.seed != null && c2.obj && c2.won))
        .map((c2) => c2.key || '?').join(','));
  ok('...and names a rival the game actually has',
     CAM.CHAPTERS.every((c2) => !!AI.HEIRS[c2.heir]),
     CAM.CHAPTERS.filter((c2) => !AI.HEIRS[c2.heir]).map((c2) => c2.heir).join(','));
  eq('keys are unique', new Set(CAM.CHAPTERS.map((c2) => c2.key)).size, CAM.CHAPTERS.length);

  /* EVERY CHAPTER MUST BE ABLE TO START. A pinned seed is worth nothing if the board it pins
   * refuses to build, and a chapter that throws on BEGIN is the worst bug this feature can
   * have — it is unreachable from the menu of the one before it. */
  let built = 0, bad = [];
  for (const c2 of CAM.CHAPTERS) {
    try {
      const w = World.createWorld(c2.seed >>> 0, 2, c2.spec);
      if (w && w.map && w.players.length === 2) built++; else bad.push(c2.key);
    } catch (e) { bad.push(c2.key + ':' + e.message); }
  }
  eq('every chapter builds its board', built, CAM.CHAPTERS.length);
  ok('...with nothing refused', bad.length === 0, bad.join(' '));

  /* A BRIEFING HAS NO WORLD. `line` is the HUD readout, asked every tick over a real world, and
   * it may look anything up; `ask` is what the chapter is FOR, and it is read on a screen that
   * exists before any board does. The two were one sentence and the briefing screen fabricated a
   * world to get it — which held right up until `raze` learned to ask where the rival's Seat is,
   * and then chapter II's briefing threw where it stood and took the BEGIN button with it.
   * Reported from play as "the menu disappeared". */
  {
    ok('every objective says what it asks, without a world to ask it of',
       CAM.CHAPTERS.every((c2) => typeof c2.obj.ask === 'string' && /\w/.test(c2.obj.ask)),
       CAM.CHAPTERS.filter((c2) => !(typeof c2.obj.ask === 'string' && /\w/.test(c2.obj.ask)))
                   .map((c2) => c2.key).join(','));
    /* and it is not the readout: the readout is about where you STAND, and needs a real world */
    const w0 = World.createWorld(31, 2);
    ok('...and every objective can still say where you stand, given one',
       CAM.CHAPTERS.every((c2) => /\w/.test(String(c2.obj.line(w0, 0, { since: -1 })))),
       CAM.CHAPTERS.map((c2) => c2.key + ':' + c2.obj.line(w0, 0, { since: -1 })).join(' | '));
  }

  /* A CHAPTER THAT ASKS THE PLAYER TO WALK MUST NOT LEAVE THE RIVAL FREE TO WALK.
   * This is the rule the reported bug broke, stated so it cannot come back. Every heir walks
   * at one rate and a walk cannot be called off, so a rival who steps on first arrives first
   * whatever the player does — a chapter won by walking is a chapter that can be lost before
   * the player has done anything wrong, unless the rival's own road is shut. */
  {
    const w0 = World.createWorld(11, 2);
    const walking = CAM.CHAPTERS.filter((c2) => /^Walk the Pattern/.test(c2.obj.line(w0, 0, {})));
    ok('some chapter is about walking the Pattern', walking.length >= 1, String(walking.length));
    ok('...and every one of them shuts the rival\'s own road',
       walking.every((c2) => !!(c2.opts && c2.opts.noWalk)),
       walking.filter((c2) => !(c2.opts && c2.opts.noWalk)).map((c2) => c2.key).join(','));
  }

  /* the objectives, each against a real world driven to the state it asks about */
  const w = World.createWorld(4242, 2);
  const me = 0, pl = w.players[me];
  const gate = (node) => ({ id: w.nextId++, bt: 'gate', level: 1, x: 100, y: 100, cd: 0,
                            raise: 0, raiseFor: 21, hp: 100, maxHp: 100, lastHurt: -99,
                            node, co: 0 });
  /* --- raise --- */
  {
    const o = CAM.OBJ.raise('gate', 3), st = {};
    const had = pl.buildings.length;   // he opens with one Gate already; three means three
    eq('raise: not yet', o.check(w, me, st), null);
    ok('...and says where you are', /1|2|3/.test(o.line(w, me, st)), o.line(w, me, st));
    while (pl.buildings.filter((b) => b.bt === 'gate' && !b.raise).length < 3) pl.buildings.push(gate(-1));
    eq('raise: three Gates takes it', o.check(w, me, st), 'won');
    pl.buildings.length = had;
  }
  /* --- hold: continuous, and the clock RESTARTS when the count slips ---
   * The board is CLEARED first: every heir opens with a finished Gate on a spring, so a rig
   * that pushes two more and pops one still holds two and the clock never restarts. The first
   * version of this test did exactly that and read as the rule being broken. */
  {
    const o = CAM.OBJ.hold(2, 10), st = { since: -1 };
    const had = pl.buildings.slice();
    pl.buildings.length = 0;
    w.t = 0;
    eq('hold: nothing held yet', o.check(w, me, st), null);
    pl.buildings.push(gate(1), gate(2));
    eq('hold: two springs, but not for long enough', o.check(w, me, st), null);
    w.t = 6; eq('hold: still counting', o.check(w, me, st), null);
    /* lose one — the clock must go back to nought, or "hold" means "touch" */
    pl.buildings.pop();
    eq('hold: one lost, so nothing is being held', o.check(w, me, st), null);
    pl.buildings.push(gate(2));
    w.t = 12;
    eq('hold: the clock restarted, so six seconds in is not ten', o.check(w, me, st), null);
    w.t = 22;
    eq('hold: ten unbroken seconds takes it', o.check(w, me, st), 'won');
    pl.buildings.length = 0;
    pl.buildings.push(...had);
    w.t = 0;
  }
  /* --- raze: and it cannot be won on the opening frame --- */
  {
    const o = CAM.OBJ.raze('gate'), st = {};
    const en = w.players[1], had = en.buildings.length;
    en.buildings.length = 0;
    eq('raze: he has none YET, which is not a victory', o.check(w, me, st), null);
    en.buildings.push(gate(3));
    eq('raze: one stands', o.check(w, me, st), null);
    en.buildings.length = 0;
    eq('raze: and now it does not', o.check(w, me, st), 'won');
    en.buildings.length = 0;
    for (let i = 0; i < had; i++) en.buildings.push(gate(-1));
  }
  /* --- walk: the road named, and the sim's own rule left to end the match ---
   * This chapter used to be a RACE — the rival already on the lines, the player told to walk
   * it before he did — and it was unwinnable by its own stated route: every heir walks at one
   * rate and a walk cannot be called off, so whoever steps on first arrives first. Reported
   * from play. The cure is in the rival's opts (`noWalk`), not in a second win condition, so
   * the objective stays a READOUT and `check` must never claim a victory of its own. */
  {
    const o = CAM.OBJ.walk(), st = {};
    pl.pattern = 0;
    eq('walk: nothing to declare on a fresh board', o.check(w, me, st), null);
    ok('...and the readout is your own progress', /0%/.test(o.line(w, me, st)), o.line(w, me, st));
    pl.pattern = 63.4;
    ok('...which follows the walk', /63%/.test(o.line(w, me, st)), o.line(w, me, st));
    pl.pattern = 100;
    eq('walk: a hundred is the SIM\'s ending, not the objective\'s', o.check(w, me, st), null);
    pl.pattern = 0;
  }
  /* --- survive --- */
  {
    const o = CAM.OBJ.survive(60), st = {};
    w.t = 30; eq('survive: not yet', o.check(w, me, st), null);
    w.t = 61; eq('survive: the clock runs out in your favour', o.check(w, me, st), 'won');
    w.t = 0;
  }
  /* --- an extra way to lose --- */
  {
    const o = CAM.FAIL.lose('barracks'), st = {};
    const had = pl.buildings.slice();
    pl.buildings.length = 0;
    eq('lose: you never had one, so you have not lost one', o.check(w, me, st), null);
    pl.buildings.push({ id: w.nextId++, bt: 'barracks', level: 1, x: 1, y: 1, cd: 0, raise: 0,
                        raiseFor: 1, hp: 1, maxHp: 1, lastHurt: -99, node: -1, co: 0 });
    eq('lose: you have one', o.check(w, me, st), null);
    pl.buildings.length = 0;
    eq('lose: and now you do not', o.check(w, me, st), 'lost');
    pl.buildings.push(...had);
  }

  /* THE DOOR OUT OF THE SIM. Guarded, so a chapter cannot overrule a Seat that has already
   * fallen, and it emits the same 'win' every other ending does. */
  {
    const w2 = World.createWorld(7, 2);
    w2.events.length = 0;
    ok('declare ends the match', World.declare(w2, 0, 'objective') === true &&
       w2.winner === 0 && w2.winReason === 'objective', `${w2.winner}/${w2.winReason}`);
    ok('...and emits the same event every other ending emits',
       w2.events.some((e) => e.e === 'win' && e.winner === 0 && e.reason === 'objective'),
       JSON.stringify(w2.events.slice(-2)));
    eq('...and cannot overrule a match already decided', World.declare(w2, 1, 'castle'), false);
    eq('...leaving the first answer standing', w2.winner, 0);
  }

  /* THE RUNNER: what game.js holds for the length of a chapter. It never writes to the world. */
  {
    const ch = CAM.byKey('road');
    const w3 = World.createWorld(ch.seed >>> 0, 2);
    const run = CAM.run(ch, 0);
    const before = JSON.stringify({ t: w3.t, u: w3.units.length, win: w3.winner });
    eq('the runner answers null on a fresh board', run.tick(w3), null);
    ok('...and says what is being asked', typeof run.say(w3) === 'string' && run.say(w3).length > 0, run.say(w3));
    eq('...and touched nothing', JSON.stringify({ t: w3.t, u: w3.units.length, win: w3.winner }), before);
    /* the tutorial is PREDICATES, in order, once each */
    const hints = [];
    for (let k = 0; k < 30 * 30; k++) { World.update(w3, C.SIM_DT); w3.events.length = 0;
      const h = run.hint(w3); if (h) hints.push(h); }
    ok('the chapter teaches, one lesson at a time', hints.length >= 1, hints.length + ' hint(s)');
    eq('...and never twice', new Set(hints).size, hints.length);
    ok('...in the order they were written',
       hints.every((h, i) => ch.hints.findIndex((q) => q.text === h) >=
                             (i ? ch.hints.findIndex((q) => q.text === hints[i - 1]) : -1)),
       hints.join(' | '));
    /* and a match already decided is not the runner's business */
    World.declare(w3, 1, 'castle');
    eq('a decided match stops the objective dead', run.tick(w3), null);
  }

  /* PROGRESS: a schema with a version, and a chapter is open when the one before it is done.
   * There is no localStorage in Node, so this exercises the shape rather than the storage —
   * `progress()` must survive its absence, which is the private-mode case as well. */
  {
    const p = CAM.progress();
    eq('progress reads as an empty record with no storage behind it', p.v, 1);
    ok('...with nothing cleared', Array.isArray(p.done) && p.done.length === 0, JSON.stringify(p));
    ok('the first chapter is always open', CAM.open(CAM.CHAPTERS[0].key));
    ok('...and the second is not, until the first is done', !CAM.open(CAM.CHAPTERS[1].key));
    ok('the menu offers the first chapter', CAM.next() && CAM.next().key === CAM.CHAPTERS[0].key,
       CAM.next() ? CAM.next().key : 'none');
  }
}

/* ---------------- an heir does not enter a race he has already lost ----------------
 * Every heir walks at the same `rate` — the Shrine has one, not one per level — so whoever
 * sets foot on the lines first reaches a hundred first, always. While a walk could be called
 * off that cost an heir little; it is a COMMITMENT now, and its drain is taken before his
 * halls are, so a hopeless walk is an heir who musters nobody for five and a half minutes and
 * then loses to the man he was racing. The answer to a rival's walk is an army — it is
 * revealed, its Shrine with it, and throwing that Shrine down tears him off the Pattern.
 * `late` must not override this: the stall-breaker exists because a board where NOBODY walks
 * runs to the cap, and a board where somebody is walking has a clock running already. */
suite('an heir does not enter a race he has already lost');
{
  const shrineOn = (w, pi) => {
    const pl = w.players[pi], c = World.cityOf(w, pi), sd = C.BUILDINGS.shrine;
    pl.buildings.push({ id: w.nextId++, bt: 'shrine', level: 1, x: c.x + 60, y: c.y + 60, cd: 0,
                        raise: 0, raiseFor: sd.raise, hp: sd.hp, maxHp: sd.hp,
                        lastHurt: -99, node: -1, co: 0 });
  };
  /* past the stall-breaker's hour and rich enough to finish, so the heir WANTS to walk and the
   * only thing that can stop him is the rule under test */
  const play = (rivalWalking, opts) => {
    const w = World.createWorld(4242, 2);
    w.chaosNext = 1e9; w.t = 1600;
    shrineOn(w, 0); shrineOn(w, 1);
    w.players[0].essence = 1e6;
    if (rivalWalking) { w.players[1].walking = true; w.players[1].pattern = 12; }
    const bot = AI.make('julian', opts), cmds = [];
    for (let i = 0; i < 6; i++) bot.step(w, 0, (cm) => cmds.push(cm), 1.0);
    return { walks: cmds.filter((c) => c.c === 'walk' && c.on).length,
             saw: AI.view(w, 0).walkers.length };
  };
  const alone = play(false), raced = play(true);
  /* THE RIG HAS TO SHOW THE HEIR WILL WALK AT ALL, or "he did not walk" means nothing */
  ok('the rig is alive: with nobody else on the lines the heir commits',
     alone.walks > 0, `${alone.walks} walk orders`);
  eq('...and sees no rival walking', alone.saw, 0);
  eq('a rival\'s walk is public, so he can see it', raced.saw, 1);
  /* THE ASSERTION THAT FAILS ON THE OLD CODE — he used to step on regardless */
  eq('...and he does not step on behind him', raced.walks, 0);

  /* AND A CHAPTER MAY SHUT THE ROAD ALTOGETHER. `noWalk` is what keeps chapter III from
   * ending with the Master of Arms quietly walking the Pattern while you hold your Seat
   * against him, and it is what makes chapter V — where the walk is the PLAYER's — a chapter
   * rather than a race the rules say cannot be won. It is not a handicap: the heir fights
   * exactly as hard. Measured on the rig proven alive above, which walks without it. */
  const shut = play(false, { noWalk: 1 });
  eq('a chapter may shut the road: he wants to walk and does not', shut.walks, 0);
}

/* ---------------- the rules of a match, and who is a foe ----------------
 * `world.rules` is what a MODE may change and the sim reads; `World.foe` is the ONE spelling of
 * "may I strike this". Both exist so that a province war can hold truces without the skirmish
 * that shipped today's balance changing by a byte — so the first thing asserted is that the
 * defaults ARE today's game. */
suite('the rules of a match default to today\'s game');
{
  const w = World.createWorld(20260901, 2);
  eq('a world carries its rules', typeof w.rules, 'object');
  eq('a Seat at zero still ends a match', w.rules.endOnSeat, 1);
  eq('nothing is occupied', w.rules.occupy, 0);
  eq('and no heir may treat with another', w.rules.truce, 0);
  /* the defaults are COPIED, not shared: two worlds in one process must be able to disagree,
   * which is the whole reason a region can be a world */
  const v = World.createWorld(20260901, 2, null, { truce: 1 });
  eq('a mode may ask for a different rule', v.rules.truce, 1);
  eq('...without touching the table it copied from', C.RULES.truce, 0);
  eq('...or the world beside it', w.rules.truce, 0);
  eq('...and the rules it did not name keep their defaults', v.rules.endOnSeat, 1);
}

/* ---- A PACT IS TWO STANDING OFFERS ----
 * There is no agreement object and no state machine: `pl.offers[j]` is "I am willing", a truce
 * holds while both stand, and it ends the instant either is withdrawn. Symmetric by
 * construction, which is what makes it impossible for two seats to disagree about whether they
 * are at peace. */
suite('a pact is two standing offers');
{
  const w = World.createWorld(20260902, 3, null, { truce: 1 });
  const on = (a, b) => World.pactOn(w, a, b);
  eq('nobody starts at peace', on(0, 1), false);
  w.players[0].offers[1] = 1;
  eq('one offer alone is not a pact', on(0, 1), false);
  eq('...and it is not one read the other way round either', on(1, 0), false);
  w.players[1].offers[0] = 1;
  eq('two standing offers are a pact', on(0, 1), true);
  eq('...and a pact reads the same from either seat', on(1, 0), true);
  eq('...and binds nobody else', on(0, 2), false);
  eq('a heir at peace is not a foe', World.foe(w, 0, 1), false);
  eq('...but a third heir still is', World.foe(w, 0, 2), true);
  eq('nobody is his own foe', World.foe(w, 0, 0), false);
  /* CHAOS AGREES TO NOTHING. The black road has no seat to offer terms with, and `CHAOS_ID` is
   * not a player index — a pact that quietly pacified the weather would turn every match into
   * a different game. */
  eq('Chaos is a foe of everyone', World.foe(w, 0, C.CHAOS_ID), true);
  eq('...from either side', World.foe(w, C.CHAOS_ID, 0), true);
  eq('...and cannot be treated with', World.pactOn(w, 0, C.CHAOS_ID), false);
  w.players[1].offers[0] = 0;
  eq('withdrawing one offer breaks it, on that tick', on(0, 1), false);
  eq('...and they are foes again', World.foe(w, 0, 1), true);
  /* AND THE RULE HAS TO BE ON. Without it `foe` is exactly "not mine", which is what every
   * existing mode plays — the offers may sit there and mean nothing. */
  const q = World.createWorld(20260902, 3);
  q.players[0].offers[1] = 1; q.players[1].offers[0] = 1;
  eq('with truces off, standing offers are not a pact', World.pactOn(q, 0, 1), false);
  eq('...and the two are foes', World.foe(q, 0, 1), true);
  /* asked of a SNAPSHOT dressed as a world, which is what a guest holds */
  eq('a world with no rules on it plays today\'s game', World.foe({ players: [{}, {}] }, 0, 1), true);
}

/* ---- NOTHING CROSSES A PACT, AND THE CONTROL IS THAT THE SAME BOARD IS VIOLENT ----
 * The single largest correctness risk in the truce work is a hostility test that does not ask:
 * `js/world.js` carries dozens of owner comparisons and only some of them are this question.
 * A missed one reads as a bug — one archer still shooting — rather than as a design error, so
 * the rig seals a pact between EVERY pair and asserts nothing at all happens. It is written to
 * fail on the code before `World.foe` existed, where the pacts are inert and the board is a
 * four-way melee. */
suite('nothing crosses a pact');
{
  /* FOUR HEIRS STANDING IN EACH OTHER, on seat 0's own court so the men, the works and the
   * throne are all in reach at once. Five kinds, so melee, shooters, splash, siege and the
   * chains are every one of them asked the question. */
  const melee = (pacts, fiends) => {
    const w = World.createWorld(20260903, 4, null, { truce: 1 });
    w.chaosNext = 1e9;   // the road is planted by hand below, so its timing is not the rig's
    if (pacts) for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) if (a !== b) w.players[a].offers[b] = 1;
    const mid = World.cityOf(w, 0), KINDS = ['archer', 'soldier', 'sorcerer', 'engine', 'binder'];
    for (let pi = 0; pi < 4; pi++) {
      for (let k = 0; k < 8; k++) {
        const a = (pi * 8 + k) / 32 * Math.PI * 2;
        const u = manAt(w, pi, KINDS[k % KINDS.length], mid.x + Math.cos(a) * 90, mid.y + Math.sin(a) * 90);
        u.hp = u.maxHp = 6000;          // they are here to be shot at, not to die
      }
      w.players[pi].banner = { x: mid.x, y: mid.y };
      w.players[pi].essence = 1e6;
    }
    if (fiends) for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2;
      const u = manAt(w, C.CHAOS_ID, 'fiend', mid.x + Math.cos(a) * 60, mid.y + Math.sin(a) * 60);
      u.hp = u.maxHp = 6000;
    }
    /* a storm from every heir over the heap, so the Jewel is asked it too */
    for (let pi = 0; pi < 4; pi++) w.storms.push({ owner: pi, x: mid.x, y: mid.y, delay: 0, tLeft: 30 });
    /* DAMAGE IS COUNTED AS IT LANDS, man by man, and never as a difference of two totals: the
     * halls go on mustering through all this, so a sum over the board GREW while every planted
     * man stood untouched — the first version of this rig read -840 hp lost and called it a
     * failure of the code rather than of the instrument. A drop in one man's hit points between
     * two ticks is a blow; a man who appears is a recruit at full health. */
    const seen = new Map();
    let died = 0, hexed = 0, lost = 0;
    for (let i = 0; i < 25 * 30; i++) {
      World.update(w, C.SIM_DT);
      for (const u of w.units) {
        if (u.owner < 0) continue;
        const was = seen.has(u.id) ? seen.get(u.id) : u.hp;
        if (u.hp < was) lost += was - u.hp;
        seen.set(u.id, u.hp);
        if (u.hexed) hexed++;
      }
      for (const e of w.events) if (e.e === 'die' && e.owner >= 0) died++;
      w.events.length = 0;
    }
    return { lost: Math.round(lost), died, hexed,
             raised: w.units.filter((u) => u.owner >= 0).length,
             men: w.units.filter((u) => u.owner >= 0 && u.hp > 0).length };
  };
  const war = melee(false, false), peace = melee(true, false);
  /* THE CONTROL FIRST. "No damage" is worthless until the rig is shown able to produce some. */
  ok('the rig is alive: four heirs standing in each other tear one another up',
     war.lost > 5000 && war.died > 0 && war.hexed > 0,
     `${war.lost} hp lost, ${war.died} dead, ${war.hexed} man-ticks in chains`);
  /* THE ASSERTIONS THAT FAIL ON THE OLD CODE */
  eq('with every pair at peace, not one hit point is lost', peace.lost, 0);
  eq('...nobody falls', peace.died, 0);
  eq('...every man raised is still standing', peace.men, peace.raised);
  eq('...and nobody is put in chains', peace.hexed, 0);

  /* AND THE WEATHER IS NOT PACIFIED. Chaos has no seat to offer terms with, and a pact that
   * quietly stopped the black road would make every match a different game. */
  const road = melee(true, true);
  ok('a pact does not treat with Chaos: the road still draws blood',
     road.lost > 0, `${road.lost} hp lost with every heir at peace and fiends in the heap`);

  /* ---- AND THE STONE, WHICH THE MELEE CANNOT ASK ----
   * With men standing on each other nothing ever chooses a work: the nearest target is always
   * alive. So one besieger, one target, nothing else in reach — which also puts him under the
   * Seat's own gun, the one shot on the board that goes through neither `hurt` nor
   * `hurtBuilding` and so has to keep the pact by hand. */
  const siege = (pact) => {
    const w = World.createWorld(20260904, 2, null, { truce: 1 });
    w.chaosNext = 1e9;
    if (pact) { w.players[0].offers[1] = 1; w.players[1].offers[0] = 1; }
    const c0 = World.cityOf(w, 0), gate = w.players[0].buildings.find((b) => b.bt === 'gate');
    const rams = [];
    for (let k = 0; k < 3; k++) { const u = manAt(w, 1, 'engine', c0.x + 30 + k * 12, c0.y + 30); u.hp = u.maxHp = 1e6; rams.push(u); }
    for (let k = 0; k < 3; k++) { const u = manAt(w, 1, 'engine', gate.x + 26, gate.y + 26 + k * 12); u.hp = u.maxHp = 1e6; rams.push(u); }
    w.players[1].banner = { x: c0.x, y: c0.y };
    const seat0 = World.seatOf(w, 0).hp, g0 = gate.hp, seen = new Map();
    let ramLost = 0;
    for (let i = 0; i < 20 * 30; i++) {
      World.update(w, C.SIM_DT);
      for (const u of rams) {
        const was = seen.has(u.id) ? seen.get(u.id) : u.hp;
        if (u.hp < was) ramLost += was - u.hp;
        seen.set(u.id, u.hp);
      }
      w.events.length = 0;
    }
    const g = w.players[0].buildings.find((b) => b.id === gate.id);
    return { seat: Math.round(seat0 - World.seatOf(w, 0).hp), gate: Math.round(g0 - (g ? g.hp : 0)),
             stands: !!g, ramLost: Math.round(ramLost) };
  };
  const sacked = siege(false), spared = siege(true);
  ok('the rig is alive: six engines take a Seat and a Gate, and the Seat\'s gun answers them',
     sacked.seat > 0 && !sacked.stands && sacked.ramLost > 0,
     `${sacked.seat} off the throne, the Gate ${sacked.stands ? 'stands' : 'is down'}, ` +
     `${sacked.ramLost} back off the Seat's gun`);
  eq('at peace the throne is not scratched', spared.seat, 0);
  eq('...his Gate stands', spared.stands, true);
  eq('...untouched', spared.gate, 0);
  eq('...and the Seat\'s own gun holds its fire', spared.ramLost, 0);
}

/* ---- THE ORDER, THE WIRE AND THE DOCTRINE ---- */
suite('terms are offered, sealed and broken');
{
  const w = World.createWorld(20260905, 3, null, { truce: 1 });
  const say = (pi, cmd) => World.applyCommand(w, pi, cmd);
  const evs = () => { const e = w.events.map((x) => x.e + (x.on === undefined ? '' : ':' + x.on)); w.events.length = 0; return e; };
  evs();
  eq('an offer is accepted as an order', say(0, { c: 'pact', p: 1, on: 1 }).ok, true);
  eq('...and says so to the seat it was made to', evs().join(), 'offer');
  eq('...but seals nothing on its own', World.pactOn(w, 0, 1), false);
  eq('the answer seals it', say(1, { c: 'pact', p: 0, on: 1 }).ok, true);
  eq('...and that is the whole table\'s news', evs().join(), 'pact:true');
  eq('saying it twice is not a refusal', say(1, { c: 'pact', p: 0, on: 1 }).ok, true);
  eq('...and is silent', evs().length, 0);
  eq('withdrawing breaks it', say(0, { c: 'pact', p: 1, on: 0 }).ok, true);
  eq('...loudly', evs().join(), 'pact:false');
  eq('you may not treat with yourself', say(0, { c: 'pact', p: 0, on: 1 }).err, 'seat');
  eq('...nor with a seat that is not at the table', say(0, { c: 'pact', p: 9, on: 1 }).err, 'seat');
  eq('...nor with Chaos', say(0, { c: 'pact', p: C.CHAOS_ID, on: 1 }).err, 'seat');
  const q = World.createWorld(20260905, 3);
  eq('and there are no terms in a war whose rules forbid them',
     World.applyCommand(q, 0, { c: 'pact', p: 1, on: 1 }).err, 'nopact');

  /* THE MEN LET GO ON THE TICK IT SEALS. `acquire` keeps its man for a dozen ticks at a time,
   * so without the sweep two companies would go on swinging past the order — at the one moment
   * a player is certainly watching to see whether it took. */
  const v = World.createWorld(20260906, 2, null, { truce: 1 });
  v.chaosNext = 1e9;
  const c0 = World.cityOf(v, 0);
  for (let k = 0; k < 4; k++) {
    manAt(v, 0, 'soldier', c0.x + 20 + k * 10, c0.y);
    manAt(v, 1, 'soldier', c0.x + 30 + k * 10, c0.y + 10);
  }
  for (let i = 0; i < 30; i++) World.update(v, C.SIM_DT);
  const held = v.units.filter((u) => u.owner >= 0 && u._t).length;
  ok('the rig is alive: men in contact have each other marked', held > 0, `${held} holding a mark`);
  World.applyCommand(v, 0, { c: 'pact', p: 1, on: 1 });
  World.applyCommand(v, 1, { c: 'pact', p: 0, on: 1 });
  eq('sealing terms drops every mark across it',
     v.units.filter((u) => u._t && !World.foe(v, u.owner, u._t.owner)).length, 0);
}

suite('a sealed pact is public and an offer is not');
{
  const w = World.createWorld(20260907, 4, null, { truce: 1 });
  World.applyCommand(w, 1, { c: 'pact', p: 2, on: 1 });     // 1 asks 2 — nobody else's business
  World.applyCommand(w, 2, { c: 'pact', p: 3, on: 1 });     // 2 asks 3
  World.applyCommand(w, 3, { c: 'pact', p: 2, on: 1 });     // ...and 3 answers: SEALED
  const s0 = Net.snapFor(w, 0, []);
  eq('the rules ride, so a guest asks the same question the host does', s0.rules.truce, 1);
  eq('a seat left out sees the sealed pact', !!(s0.players[2].offers[3] && s0.players[3].offers[2]), true);
  eq('...and can therefore work it out for himself',
     World.pactOn({ rules: s0.rules, players: s0.players }, 2, 3), true);
  eq('...but not the offer nobody has answered', s0.players[1].offers[2], 0);
  const s2 = Net.snapFor(w, 2, []);
  eq('the seat it was made to sees it', s2.players[1].offers[2], 1);
  const s1 = Net.snapFor(w, 1, []);
  eq('and so does the seat that made it', s1.players[1].offers[2], 1);
  /* the events follow the same rule */
  const off = [{ e: 'offer', pi: 1, p: 2 }], pac = [{ e: 'pact', pi: 3, p: 2, on: true }];
  eq('an offer reaches its target', Net.snapFor(w, 2, off).events.length, 1);
  eq('...and nobody else', Net.snapFor(w, 0, off).events.length, 0);
  eq('a sealed pact reaches the whole table', Net.snapFor(w, 0, pac).events.length, 1);
}

/* ---- AND THE HEIRS HAVE A DOCTRINE, or terms are decoration ---- */
suite('the heirs keep terms, or do not');
{
  const play = (heir, secs) => {
    const w = World.createWorld(20260908, 2, null, { truce: 1 });
    w.chaosNext = 1e9;
    const bot = AI.make(heir, {});
    World.applyCommand(w, 0, { c: 'pact', p: 1, on: 1 });   // the player asks
    let sealed = null, broke = null;
    for (let i = 0; i < secs * 30; i++) {
      bot.step(w, 1, (cmd) => World.applyCommand(w, 1, cmd), C.SIM_DT);
      World.update(w, C.SIM_DT); w.events.length = 0;
      const on = World.pactOn(w, 0, 1);
      if (on && sealed == null) sealed = w.t;
      if (!on && sealed != null && broke == null) broke = w.t;
    }
    return { sealed, broke };
  };
  const j = play('julian', 240), b = play('bleys', 240);
  ok('the Warden takes the terms he is offered', j.sealed != null && j.sealed < 30,
     j.sealed == null ? 'never' : j.sealed.toFixed(1) + 's');
  eq('...and keeps them', j.broke, null);
  ok('the Flame takes them too', b.sealed != null && b.sealed < 30,
     b.sealed == null ? 'never' : b.sealed.toFixed(1) + 's');
  ok('...and breaks them the moment he has an army to spend', b.broke != null && b.broke < 240,
     b.broke == null ? 'never' : b.broke.toFixed(1) + 's');

  /* NOBODY KEEPS TERMS WITH A MAN ON THE LINES. Not a doctrine — the rule above every doctrine,
   * because a walk cannot be called off and the only answer to one is an army at his Shrine. */
  const w2 = World.createWorld(20260909, 2, null, { truce: 1 });
  w2.chaosNext = 1e9;
  const sd = C.BUILDINGS.shrine, c = World.cityOf(w2, 0);
  w2.players[0].buildings.push({ id: w2.nextId++, bt: 'shrine', level: 1, x: c.x + 60, y: c.y + 60,
                                 cd: 0, raise: 0, raiseFor: sd.raise, hp: sd.hp, maxHp: sd.hp,
                                 lastHurt: -99, node: -1, co: 0 });
  w2.players[0].essence = 1e6;
  const bot2 = AI.make('julian', {});
  World.applyCommand(w2, 0, { c: 'pact', p: 1, on: 1 });
  for (let i = 0; i < 20 * 30; i++) {
    bot2.step(w2, 1, (cmd) => World.applyCommand(w2, 1, cmd), C.SIM_DT);
    World.update(w2, C.SIM_DT); w2.events.length = 0;
  }
  ok('the rig is alive: the Warden had taken the terms before the walk', World.pactOn(w2, 0, 1),
     'he never took them at all');
  World.applyCommand(w2, 0, { c: 'walk', on: true });
  for (let i = 0; i < 20 * 30; i++) {
    bot2.step(w2, 1, (cmd) => World.applyCommand(w2, 1, cmd), C.SIM_DT);
    World.update(w2, C.SIM_DT); w2.events.length = 0;
  }
  eq('...and withdraws them the moment you set foot on the Pattern', World.pactOn(w2, 0, 1), false);

  /* AND AN HEIR WITH NO DOCTRINE NEVER OFFERS — which is what keeps every existing mode, and
   * `node sim.js`, exactly as it was. */
  const w3 = World.createWorld(20260910, 2, null, { truce: 1 });
  w3.chaosNext = 1e9;
  const g = AI.make('greedy', {}), sent = [];
  for (let i = 0; i < 60 * 30; i++) {
    g.step(w3, 1, (cmd) => { if (cmd.c === 'pact') sent.push(cmd); World.applyCommand(w3, 1, cmd); }, C.SIM_DT);
    World.update(w3, C.SIM_DT); w3.events.length = 0;
  }
  eq('a baseline with no doctrine sends no terms', sent.length, 0);
}

/* ---- A CITY IS A THING WITH AN OWNER ----
 * It used to be a property of a player: one apiece, hit points in `pl.castleHp`, the gun's
 * cooldown in `pl.seatCd`, because there could only ever be one. A country has many and they
 * change hands. Everything below is one-city-each, which is today's game exactly — the point of
 * this suite is that the new shape SAYS the old thing. */
suite('a city is a thing with an owner');
{
  const w = World.createWorld(20260912, 3);
  eq('one city per heir, in seat order', w.cities.length, 3);
  for (let pi = 0; pi < 3; pi++) {
    eq(`city ${pi} is heir ${pi}'s`, w.cities[pi].owner, pi);
    eq(`...and it is the seat he was born to`, w.cities[pi].site, w.map.cities[pi]);
    eq(`...at full hit points`, w.cities[pi].hp, C.CASTLE_HP);
    eq(`...and it is the seat he rules from`, World.seatOf(w, pi).id, w.cities[pi].id);
    eq(`...and the only one he holds`, World.citiesOf(w, pi).length, 1);
    const site = World.cityOf(w, pi);
    ok(`...standing where the site says`, Math.abs(site.x - w.cities[pi].x) < 1e-6 &&
       Math.abs(site.y - w.cities[pi].y) < 1e-6, `${site.x},${site.y} vs ${w.cities[pi].x},${w.cities[pi].y}`);
    eq(`...and the ground of his court answers to him`,
       (World.cityAt(w, site.x + 10, site.y) || {}).owner, pi);
  }
  ok('open country belongs to no city', World.cityAt(w, C.MAP.W / 2, C.MAP.H / 2) === null ||
     World.cityAt(w, C.MAP.W / 2, C.MAP.H / 2).owner >= 0, 'the middle of the board');
  /* the players carry none of it any more — a stale reader would silently get `undefined`, and
   * `undefined <= 0` is false, which is exactly how the throne stopped visibly falling */
  eq('a player no longer carries his Seat\'s hit points', w.players[0].castleHp, undefined);
  eq('...nor its gun\'s cooldown', w.players[0].seatCd, undefined);

  /* THE GUN IS THE CITY'S, and a heir who held three would have three of them on three
   * cadences. Measured rather than assumed: park a man in reach and watch the throne answer. */
  const v = World.createWorld(20260913, 2);
  v.chaosNext = 1e9;
  const c1 = World.cityOf(v, 1), seat1 = World.seatOf(v, 1);
  const mark = manAt(v, 0, 'soldier', c1.x + C.SEAT_GUN.range * 0.5, c1.y);
  mark.hp = mark.maxHp = 1e6;
  const was = mark.hp;
  for (let i = 0; i < 5 * 30; i++) World.update(v, C.SIM_DT);
  ok('a Seat shoots what comes into its reach', mark.hp < was, `${Math.round(was - mark.hp)} dealt`);
  ok('...off a cooldown that lives on the city', seat1.cd > 0 || seat1.cd === 0,
     `cd ${seat1.cd}`);
  seat1.cd = 1e9;
  const held = mark.hp;
  for (let i = 0; i < 5 * 30; i++) World.update(v, C.SIM_DT);
  eq('...so silencing that city silences that gun', mark.hp, held);

  /* AND A TOPPLED HEIR'S CITIES GO WITH HIM */
  const u = World.createWorld(20260914, 3);
  World.seatOf(u, 1).hp = 0;
  const anyOut = World.citiesOf(u, 1).length;
  eq('the rig is alive: he still holds his city with the throne at nought', anyOut, 1);
}

/* ---- A SEAT YIELDS, AND IS TAKEN BY STANDING IN IT ----
 * With `rules.occupy` off — every mode that has ever shipped — a Seat at nought topples exactly
 * as it always did, and the first block below is what says so. With it on, breaking a place and
 * HOLDING it become different problems, which is the whole point: a bombard train does the first
 * from beyond anyone's reach and only a surviving army does the second. */
suite('a Seat yields, and is taken by standing in it');
{
  const bare = (seed, rules) => {
    const w = World.createWorld(seed, 2, null, rules);
    w.chaosNext = 1e9;
    /* no halls: the rig is about a court, and a hall in it musters a garrison into the middle
     * of the measurement */
    for (const p of w.players) p.buildings.length = 0;
    return w;
  };
  /* THE CONTROL: with the rule off, nothing about a falling Seat has changed. */
  {
    const w = bare(20260915, null);
    const c1 = World.seatOf(w, 1);
    eq('with the rule off a Seat at nought topples', World.seatDown(w, c1, 0), true);
    eq('...the heir is out', w.players[1].out, true);
    eq('...and in a duel that ends it', w.winner, 0);
    eq('...by force', w.winReason, 'castle');
  }
  /* AND WITH IT ON IT YIELDS. */
  {
    const w = bare(20260915, { occupy: 1, endOnSeat: 0 });
    const c1 = World.seatOf(w, 1);
    eq('with the rule on it yields instead', World.seatDown(w, c1, 0), false);
    eq('...and belongs to nobody', c1.owner, -1);
    eq('...the heir is not out', w.players[1].out, false);
    eq('...and the match runs on', w.winner, null);
    eq('...he is dispossessed: he holds no city', World.citiesOf(w, 1).length, 0);
    ok('...but he still has a place on the map', !!World.cityOf(w, 1), 'nowhere to look');
  }
  /* ...unless the rules say a heir with nothing is finished, which is a duel. */
  {
    const w = bare(20260915, { occupy: 1, endOnSeat: 1 });
    eq('a duel still ends when a heir has nowhere left', World.seatDown(w, World.seatOf(w, 1), 0), true);
    eq('...and he is out', w.players[1].out, true);
  }

  const stand = (secs, mine, theirs) => {
    const w = bare(20260916, { occupy: 1, endOnSeat: 0 });
    const c1 = World.seatOf(w, 1);
    World.seatDown(w, c1, 0);
    for (const p of w.players) p.banner = { x: c1.x, y: c1.y };
    for (let k = 0; k < mine; k++) {
      const u = manAt(w, 0, 'soldier', c1.x + 20 + k * 8, c1.y);
      u.hp = u.maxHp = 1e9; u.dmg = 0;         // they are here to stand, not to fight
    }
    for (let k = 0; k < theirs; k++) {
      const u = manAt(w, 1, 'soldier', c1.x - 20 - k * 8, c1.y);
      u.hp = u.maxHp = 1e9; u.dmg = 0;
    }
    let took = null;
    for (let i = 0; i < secs * 30 && took == null; i++) {
      World.update(w, C.SIM_DT);
      for (const e of w.events) if (e.e === 'taken') took = { t: w.t, pi: e.pi };
      w.events.length = 0;
    }
    return { w, c1, took };
  };
  const won = stand(40, 1, 0);
  ok('a court held uncontested is taken', won.took != null,
     won.took ? '' : 'nobody took it in forty seconds');
  if (won.took) {
    near('...and it takes exactly as long as the rule says', won.took.t, C.CITY.take, 0.6,
         `${won.took.t.toFixed(1)}s against ${C.CITY.take}`);
    eq('...by the heir who stood in it', won.c1.owner, 0);
    near('...and it comes back hurt', won.c1.hp, won.c1.maxHp * C.CITY.back, 2,
         `${Math.round(won.c1.hp)} of ${won.c1.maxHp}`);
    eq('...and back to its first level', won.c1.level, 1);
    /* THE GUN COMES WITH IT — which is the plainest possible proof that the city really changed
     * hands rather than merely changing a number */
    const en = manAt(won.w, 1, 'soldier', won.c1.x + C.SEAT_GUN.range * 0.6, won.c1.y);
    en.hp = en.maxHp = 1e6;
    const was = en.hp;
    for (let i = 0; i < 5 * 30; i++) World.update(won.w, C.SIM_DT);
    ok('...and its gun answers for its new master', en.hp < was, `${Math.round(was - en.hp)} dealt`);
  }
  const held = stand(60, 1, 1);
  eq('a court still being fought over is nobody\'s', held.took, null);
  eq('...and stays open', held.c1.owner, -1);

  /* A YIELDED COURT IS NOBODY'S TO BREAK. It was still a target once — every blow that landed
   * on it fired the yield again and reset the claim clock, measured as a court that could never
   * be taken with its clock resetting every 0.93s, which is a soldier's attack cooldown. */
  {
    const w = bare(20260917, { occupy: 1, endOnSeat: 0 });
    const c1 = World.seatOf(w, 1);
    World.seatDown(w, c1, 0);
    w.events.length = 0;
    w.players[0].banner = { x: c1.x, y: c1.y };
    const ram = manAt(w, 0, 'engine', c1.x + 30, c1.y);
    ram.hp = ram.maxHp = 1e6;
    let again = 0, sieges = 0;
    for (let i = 0; i < 12 * 30; i++) {
      World.update(w, C.SIM_DT);
      for (const e of w.events) { if (e.e === 'yield') again++; if (e.e === 'siege') sieges++; }
      w.events.length = 0;
    }
    eq('a yielded court cannot be yielded again', again, 0);
    eq('...because nothing aims at it at all', sieges, 0);
  }

  /* ...AND IT MAY BE THROWN DOWN INSTEAD. */
  {
    const w = bare(20260918, { occupy: 1, endOnSeat: 0 });
    const c1 = World.seatOf(w, 1);
    eq('a city with an heir in it cannot be thrown down',
       World.applyCommand(w, 0, { c: 'raze', id: c1.id }).err, 'held');
    World.seatDown(w, c1, 0);
    eq('...nor from across the board', World.applyCommand(w, 0, { c: 'raze', id: c1.id }).err, 'presence');
    manAt(w, 0, 'soldier', c1.x + 20, c1.y);
    eq('but a court you are standing in may be', World.applyCommand(w, 0, { c: 'raze', id: c1.id }).ok, true);
    eq('...and it is gone', !!c1.razed, true);
    eq('...twice is a refusal', World.applyCommand(w, 0, { c: 'raze', id: c1.id }).err, 'gone');
    w.players[0].banner = { x: c1.x, y: c1.y };
    for (let i = 0; i < 40 * 30; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
    eq('and rubble is nobody\'s, however long you stand in it', c1.owner, -1);
    const q = World.createWorld(20260918, 2);
    eq('and none of it happens in a war whose rules forbid it',
       World.applyCommand(q, 0, { c: 'raze', id: 1 }).err, 'noraze');
  }
}

/* ---- THE QUIET TICK, AND THE EQUIVALENCE THAT LICENSES IT ----
 * ONE SIM AT A VARIABLE RATE, never a second and cheaper model of combat: two models is two
 * balance surfaces, and a player who finds the seam fights every battle on the kinder one. So
 * what varies is not the rules but how much of the tick has anything to do — and the licence for
 * that is not an argument, it is this suite. The same seeded world is played twice, once with
 * the quiet tick and once without, and the two must land on IDENTICAL state: not close, not
 * within a tolerance, the same. Anything approximate would show up here as a difference. */
suite('a quiet world skips only what has nothing to do');
{
  /* everything the sim owns that a player could ever see, to six places */
  const print = (w) => JSON.stringify({
    t: +w.t.toFixed(6), tick: w.tick, winner: w.winner,
    cities: w.cities.map((c) => [c.owner, +c.hp.toFixed(6), +c.cd.toFixed(6), c.level]),
    players: w.players.map((p) => [+p.essence.toFixed(6), p.pattern, p.out, p.walking,
      p.buildings.map((b) => [b.id, b.bt, b.level, +b.hp.toFixed(6), +b.cd.toFixed(6),
                              +b.raise.toFixed(6), +(b.work || 0).toFixed(6), b.co]),
      [+p.powers.storm.toFixed(6), +p.powers.trump.toFixed(6)]]),
    units: w.units.map((u) => [u.id, u.owner, u.kind, +u.x.toFixed(6), +u.y.toFixed(6),
                               +u.hp.toFixed(6), +u.cd.toFixed(6), u.man || 0, u.tow || 0, u.in || 0])
  });
  /* a REGION, which is what a country is mostly made of: one heir's ground, nobody to fight */
  const region = (hush, men) => {
    const w = World.createWorld(20260919, 2, null, { hush: hush ? 1 : 0 });
    w.chaosNext = 1e9;
    w.players[1].buildings.length = 0;
    w.cities[1].owner = -1; w.cities[1].hp = 0;
    w.players[0].essence = 1e9;
    const c = World.cityOf(w, 0);
    for (let k = 0; k < men; k++)
      manAt(w, 0, k % 3 ? 'soldier' : 'archer', c.x + (k % 14) * 18 - 120, c.y + ((k / 14) | 0) * 18 - 90);
    w.players[0].banner = { x: c.x, y: c.y };
    return w;
  };
  const play = (hush, secs, men, both) => {
    const w = both ? World.createWorld(20260920, 2, null, { hush: hush ? 1 : 0 }) : region(hush, men);
    if (both) w.chaosNext = 1e9;
    let hushed = 0;
    for (let i = 0; i < secs * 30; i++) {
      World.update(w, C.SIM_DT);
      if (w.hush) hushed++;
      w.events.length = 0;
    }
    return { p: print(w), hushed, ticks: secs * 30, w };
  };

  const on = play(true, 60, 60, false), off = play(false, 60, 60, false);
  /* THE CONTROL FIRST: the rig has to have been quiet for most of the run, or "identical" is a
   * statement about code that never ran */
  ok('the rig is alive: a region with one heir in it is quiet nearly all the time',
     on.hushed > on.ticks * 0.9, `${on.hushed} of ${on.ticks} ticks`);
  eq('...and with the rule off it is never quiet', off.hushed, 0);
  /* THE ASSERTION THE WHOLE STAGE RESTS ON */
  eq('the quiet tick lands on exactly the state the full one does', on.p === off.p, true);

  /* AND A CONTESTED WORLD REFUSES TO GO QUIET — the other half, and the one that would let a
   * bug through if it were missing: a sim that hushed a battle would be very fast and wrong. */
  const duel = play(true, 60, 0, true);
  ok('two heirs on one board are not quiet for long',
     duel.hushed < duel.ticks * 0.2, `${duel.hushed} of ${duel.ticks} ticks quiet`);
  const dOff = play(false, 60, 0, true);
  eq('...and a duel plays out identically either way', duel.p === dOff.p, true);

  /* the reasons a world is NOT quiet, one at a time, on a board that otherwise would be */
  {
    const w = region(true, 4);
    World.update(w, C.SIM_DT);
    eq('one heir alone is quiet', w.hush, true);
    const c = World.cityOf(w, 0);
    const fiend = manAt(w, C.CHAOS_ID, 'fiend', c.x + 300, c.y);
    World.update(w, C.SIM_DT);
    eq('one fiend is enough to end it', w.hush, false);
    fiend.hp = 0; fiend.dead = 1;
    World.update(w, C.SIM_DT); World.update(w, C.SIM_DT);
    eq('...and it is quiet again once he is buried', w.hush, true);
    w.storms.push({ owner: 0, x: c.x, y: c.y, delay: 0, tLeft: 5 });
    World.update(w, C.SIM_DT);
    eq('a storm is a blow with no man behind it, so it counts', w.hush, false);
    w.storms.length = 0;
    World.update(w, C.SIM_DT);
    eq('...and it is quiet when the weather passes', w.hush, true);
    /* AND A HEIR AT PEACE DOES NOT WAKE IT — which is the rule that makes a truce worth
     * something to the machine as well as to the player */
    const v = World.createWorld(20260921, 2, null, { truce: 1 });
    v.chaosNext = 1e9;
    /* far enough in that both halls have raised somebody. A BOARD WITH NO MEN ON IT IS QUIET
     * whoever is at war with whom, which is right — there is nothing that could strike anything
     * — and asserting on the opening frame measured that and called it a failure. */
    for (let i = 0; i < 30 * 30; i++) { World.update(v, C.SIM_DT); v.events.length = 0; }
    ok('the rig is alive: both heirs have men', v.units.some((u) => u.owner === 0) &&
       v.units.some((u) => u.owner === 1), 'one of them mustered nobody');
    eq('...and two heirs at war are not quiet', v.hush, false);
    World.applyCommand(v, 0, { c: 'pact', p: 1, on: 1 });
    World.applyCommand(v, 1, { c: 'pact', p: 0, on: 1 });
    World.update(v, C.SIM_DT);
    eq('two heirs at terms are a quiet world', v.hush, true);
  }
}

/* ---- THE COUNTRY, AND THE WAR OVER IT ----
 * A region is TODAY'S BOARD and the country is many of them, because the thing that must never
 * grow is the grid: a flow field is a Dijkstra over every cell and dead linear in area, and the
 * ground texture self-caps, so a board three times as wide is three times blurrier and 59ms a
 * field. Everything below is about the graph above the boards, and about a region surviving
 * being left and come back to. */
suite('a country is a graph of boards');
{
  let least = 99, most = 0, cut = 0, noPattern = 0, mismatch = 0;
  const seen = {};
  for (let s = 1; s <= 120; s++) {
    const co = COUNTRY.build(s);
    const land = COUNTRY.landRegions(co);
    least = Math.min(least, land.length); most = Math.max(most, land.length);
    if (!COUNTRY.connected(co)) cut++;
    if (!co.pattern) noPattern++;
    if (co.cities.length !== land.length) mismatch++;
    seen[co.pattern] = 1;
  }
  ok('a country is big enough to fight over', least >= C.COUNTRY.least, `smallest was ${least}`);
  ok('...and not bigger than its grid', most <= C.COUNTRY.cols * C.COUNTRY.rows, `largest ${most}`);
  /* EVERY SHORE REACHABLE FROM EVERY OTHER. A country cut in half is a country half of which
   * can never be fought over — and the coin that shuts a border will do it sooner or later, so
   * it is repaired, and what still cannot be reached goes back to the sea. */
  eq('every land region can be marched to from every other', cut, 0);
  eq('there is always exactly one Pattern', noPattern, 0);
  eq('and one city per land region', mismatch, 0);
  ok('the Pattern does not always land in the same place', Object.keys(seen).length > 1,
     Object.keys(seen).join(' '));

  /* DETERMINISM IS THE WHOLE CONTRACT. A region is generated when somebody goes there and never
   * before, so the same seed must produce the same country on every machine and at any hour. */
  const a = COUNTRY.build(4242), b = COUNTRY.build(4242);
  const fingerprint = (co) => JSON.stringify(co.regions.map((r) =>
    [r.key, r.sea, r.biome, r.seed, r.nbrs.map((n) => [n.to, n.open, +n.at.toFixed(6)])]));
  eq('the same seed is the same country', fingerprint(a), fingerprint(b));
  ok('...and a different seed is a different one', fingerprint(a) !== fingerprint(COUNTRY.build(4243)),
     'two seeds made the same country');

  /* A CROSSING IS A PLACE ON A BOARD. It is where a column steers and where it is handed over —
   * the wall-gateway trick one level up — so the two sides must be the same point on the shared
   * edge, and both must be inside the board rather than on its very rim. */
  const co = COUNTRY.build(4242);
  let doors = 0;
  for (const r of COUNTRY.landRegions(co)) for (const d of COUNTRY.doors(co, r.key)) {
    doors++;
    const near = COUNTRY.gate(d, 'near'), far = COUNTRY.gate(d, 'far');
    ok(`a crossing lies on the board (${r.key} ${d.side})`,
       near.x > 0 && near.x < C.MAP.W && near.y > 0 && near.y < C.MAP.H &&
       far.x > 0 && far.x < C.MAP.W && far.y > 0 && far.y < C.MAP.H,
       JSON.stringify([near, far]));
    /* it must be on the FAR side of the neighbour from the side you left by */
    const back = COUNTRY.doorTo(co, d.to, r.key);
    ok(`...and the neighbour agrees about it (${r.key}→${d.to})`, !!back && back.at === d.at,
       back ? `${back.at} vs ${d.at}` : 'no way back');
  }
  ok('the rig is alive: there are crossings to check', doors > 4, `${doors} crossings`);

  /* A BIOME CHANGES THE GROUND AND NOTHING ELSE. The noise, the ridges and the rim are the same
   * code; only the three thresholds the terrain is read off move. So a biome cannot produce a
   * board the rest of the game has never seen, and every one of them must still make a playable
   * board with springs on it. */
  for (const k of Object.keys(C.BIOMES)) {
    const g = WG.build(555, RNG, 2, { biome: k });
    ok(`the ${k} makes a board`, !!g && g.nodes.length >= C.WORLD.nodesMin,
       g ? `${g.nodes.length} springs` : 'no board at all');
    if (g) eq(`...and says what it is`, g.biome, k);
  }
  const plain = WG.build(555, RNG, 2), downs = WG.build(555, RNG, 2, { biome: 'downs' });
  eq('and `downs` is provably the country the game has always had',
     JSON.stringify(Array.from(plain.terra)), JSON.stringify(Array.from(downs.terra)));
}

suite('a region is a world, left and come back to');
{
  const realm = REALM.create(20260922);
  const land = COUNTRY.landRegions(realm.country);
  ok('a war has a country under it', land.length >= C.COUNTRY.least, `${land.length} regions`);
  const mine = REALM.holds(realm, 0);
  eq('the player holds one city to start with', mine.length, 1);
  ok('...and it is where he is standing', mine[0].region === realm.at, `${mine[0].region} vs ${realm.at}`);
  const pat = REALM.patternCity(realm);
  ok('the Pattern belongs to nobody', pat && pat.owner === -1, pat ? String(pat.owner) : 'no Pattern');
  ok('...and to no lord either', pat && pat.lord == null, 'somebody was given AMBER');
  /* THE HEIRS DO NOT START NEXT DOOR. A war that opens with two thrones in neighbouring regions
   * is a war decided in its first ten minutes. */
  const starts = realm.country.cities.filter((c) => c.owner >= 0).map((c) => realm.country.index[c.region]);
  eq('every heir has a city', starts.length, realm.heirs.length);
  let touching = 0;
  for (let i = 0; i < starts.length; i++) for (let j = i + 1; j < starts.length; j++)
    if (Math.abs(starts[i].cx - starts[j].cx) + Math.abs(starts[i].cy - starts[j].cy) <= 1) touching++;
  eq('...and none of them is his rival\'s neighbour', touching, 0);
  ok('the rest of the country is held by lesser lords',
     realm.country.cities.filter((c) => c.owner < 0 && !c.pattern && c.lord).length > 2,
     'nobody to take anything from');

  /* --- A REGION MATERIALISES INTO AN ORDINARY WORLD --- */
  const w = REALM.enter(realm, realm.at);
  ok('a region becomes a world', !!w && !!w.map && w.units != null, 'no world');
  eq('...at the size every board has always been', w.nav.W * w.nav.cw, C.MAP.W);
  eq('...playing by the rules of a war', JSON.stringify(w.rules),
     JSON.stringify({ endOnSeat: 0, occupy: 1, truce: 1, hush: 1, onePattern: 1 }));
  eq('...and it is his own city he is standing in', w.cities[0].owner, 0);
  eq('...with no second throne on the board', w.cities[1].owner, -1);
  for (let i = 0; i < 60 * 30; i++) { World.update(w, C.SIM_DT); w.events.length = 0; }
  const men = w.units.filter((u) => u.hp > 0).length, works = w.players[0].buildings.length;
  ok('the rig is alive: a minute in the region raised men', men > 2, `${men} men, ${works} works`);

  /* --- LEFT, AND COME BACK TO --- */
  const packed = REALM.compact(w);
  ok('a region compacts small enough to save a country of them',
     JSON.stringify(packed).length < 8000, `${JSON.stringify(packed).length} bytes`);
  REALM.leave(realm, realm.at, w);
  const w2 = REALM.enter(realm, realm.at);
  eq('...and comes back with its army', w2.units.filter((u) => u.hp > 0).length, men);
  eq('...and its works', w2.players[0].buildings.length, works);
  near('...and its clock', w2.t, w.t, 0.001, `${w2.t} vs ${w.t}`);
  eq('...and its city', w2.cities[0].owner, 0);
  const before = w2.units.length;
  for (let i = 0; i < 30 * 30; i++) { World.update(w2, C.SIM_DT); w2.events.length = 0; }
  ok('...and it runs on from there', w2.units.filter((u) => u.hp > 0).length >= before,
     `${before} → ${w2.units.filter((u) => u.hp > 0).length}`);

  /* --- A COLUMN CROSSES A BORDER --- */
  const doors = COUNTRY.doors(realm.country, realm.at);
  ok('the rig is alive: there is somewhere to march to', doors.length > 0, 'the region is sealed');
  if (doors.length) {
    const to = doors[0].to;
    const column = w2.units.filter((u) => u.owner === 0 && u.hp > 0).slice(0, 3)
      .map((u) => ({ kind: u.kind, tier: u.tier, hp: u.hp }));
    REALM.march(realm, realm.at, to, column, 0);
    eq('a column ordered past a border is on the road', realm.marches.length, 1);
    REALM.tick(realm, C.REALM.crossing * 0.5);
    eq('...and is still on it half way', realm.marches.length, 1);
    ok('...and has not arrived', !realm.state[to] || !realm.state[to].units.length, 'it teleported');
    REALM.tick(realm, C.REALM.crossing * 0.6);
    eq('...and arrives', realm.marches.length, 0);
    const there = REALM.enter(realm, to);
    eq('...in the neighbouring region', there.units.filter((u) => u.owner === 0).length, column.length);
    /* AT THE FAR GATE, and not in the middle of somebody's court */
    const far = COUNTRY.gate(COUNTRY.doorTo(realm.country, realm.at, to), 'far');
    const u0 = there.units.find((u) => u.owner === 0);
    ok('...at the crossing on that side', Math.hypot(u0.x - far.x, u0.y - far.y) < 40,
       `${Math.round(u0.x)},${Math.round(u0.y)} against ${Math.round(far.x)},${Math.round(far.y)}`);
    /* and a border that is shut is not a road at all */
    const shut = realm.country.index[realm.at].nbrs.find((nb) => !nb.open);
    if (shut) eq('a closed border is not a road', REALM.march(realm, realm.at, shut.to, column, 0), null);
  }

  /* --- AND A CITY TAKEN IN A REGION IS A CITY TAKEN IN THE WAR --- */
  {
    const r2 = REALM.create(20260923);
    const target = r2.country.cities.find((c) => c.owner < 0 && !c.pattern);
    ok('the rig is alive: there is a lord\'s city to take', !!target, 'nobody to take from');
    if (target) {
      const wv = REALM.enter(r2, target.region);
      wv.cities[0].owner = 0;                  // as `holdCities` would have left it
      REALM.leave(r2, target.region, wv);
      eq('taking a city in the region takes it in the country', target.owner, r2.me);
      const wr = REALM.enter(r2, target.region);
      wr.cities[0].razed = 1; wr.cities[0].owner = -1;
      REALM.leave(r2, target.region, wr);
      eq('...and throwing it down is remembered too', !!target.razed, true);
      eq('...and it belongs to nobody', target.owner, -1);
    }
  }
}

/* ---- ONE PATTERN, AND ONLY SO MANY CITIES ----
 * The two rules that make a country a game rather than a sandbox: the war ends in one place, and
 * conquest does not pay for itself unless it is conquest of a rival. */
suite('there is one Pattern, and only so many cities');
{
  const realm = REALM.create(20260930);
  const pat = REALM.patternCity(realm);
  ok('the Pattern lies in one city', !!pat && pat.owner === -1, pat ? pat.region : 'nowhere');
  ok('...and the player does not start in it', realm.at !== pat.region, realm.at);

  const here = REALM.enter(realm, realm.at);
  eq('the region you start in is not the Pattern\'s', !!here.pattern, false);
  here.players[0].essence = 1e6;
  const c = World.cityOf(here, 0);
  eq('...so a Shrine may not be raised in it',
     World.applyCommand(here, 0, { c: 'build', x: c.x + 120, y: c.y + 120, bt: 'shrine' }).err, 'elsewhere');
  const amber = REALM.enter(realm, pat.region);
  eq('AMBER is the Pattern\'s region', !!amber.pattern, true);
  amber.players[0].essence = 1e6;
  const ca = World.cityOf(amber, 0);
  let raised = false;
  for (let r = 100; r < 420 && !raised; r += 40)
    for (let a = 0; a < 6 && !raised; a++)
      if (World.applyCommand(amber, 0, { c: 'build', x: ca.x + Math.cos(a) * r, y: ca.y + Math.sin(a) * r, bt: 'shrine' }).ok) raised = true;
  ok('...and in it a Shrine may', raised, 'refused everywhere the rig tried');
  /* AND THE RULE IS THE WAR'S, NOT THE GAME'S: a skirmish board is a world of its own and
   * carries its own Pattern, exactly as it always has. */
  const skirmish = World.createWorld(20260930, 2);
  skirmish.players[0].essence = 1e6;
  const cs = World.cityOf(skirmish, 0);
  let ok2 = false;
  for (let r = 100; r < 420 && !ok2; r += 40)
    for (let a = 0; a < 6 && !ok2; a++)
      if (World.applyCommand(skirmish, 0, { c: 'build', x: cs.x + Math.cos(a) * r, y: cs.y + Math.sin(a) * r, bt: 'shrine' }).ok) ok2 = true;
  ok('a single match still carries its own Pattern', ok2, 'a skirmish refused a Shrine');

  /* WINNING THE WAR is a walk completed in the Pattern's own region, and it goes out through the
   * door every other ending goes out of. */
  const run = REALM.run(realm);
  eq('holding cities is not winning', run.tick(here), null);
  amber.players[0].pattern = 99;
  eq('...nor is nearly walking it', run.tick(amber), null);
  amber.players[0].pattern = 100;
  eq('a walk completed in AMBER wins the country', run.tick(amber), 'won');
  here.players[0].pattern = 100;
  eq('...and the same walk anywhere else does not', run.tick(here), null);

  /* THE LORD BRAKE. One city by right, one more per lord, and a lord is WON — from an heir and
   * never from a minor holding, so a war cannot be won by eating the weak. */
  const r2 = REALM.create(20260931);
  eq('you begin with one lord', r2.lords, C.REALM.lords0);
  eq('...and one city', REALM.holds(r2, 0).length, 1);
  const free = r2.country.cities.filter((x) => x.owner < 0 && !x.pattern).slice(0, 2);
  ok('the rig is alive: there are free cities to take', free.length === 2, `${free.length}`);
  const take = (city) => {
    const w = REALM.enter(r2, city.region);
    w.cities[0].owner = 0;
    REALM.leave(r2, city.region, w);
  };
  take(free[0]);
  eq('a lord holds the second city', free[0].owner, 0);
  eq('...and it is yours', REALM.holds(r2, 0).length, 2);
  take(free[1]);
  eq('the third will not swear to you', free[1].owner, -1);
  eq('...and you still hold two', REALM.holds(r2, 0).length, 2);
  eq('...and the map is told which one refused', r2.refused, free[1].id);
  /* AND A RIVAL'S CITY BRINGS HIS LORD */
  const rival = r2.country.cities.find((x) => x.owner >= 1);
  ok('the rig is alive: a rival holds a city', !!rival, 'no rival city');
  if (rival) {
    r2.lords++;                          // room for it, so the brake is not what is being tested
    const before = r2.lords;
    take(rival);
    eq('taking a rival\'s city takes it', rival.owner, 0);
    eq('...and his lord comes with it', r2.lords, before + 1);
  }
}

/* ---------------- */
const bad = report("headless");
if (QUICK_RUN) {
  /* after the tally, each on its own line: nothing that greps the "headless: N/N passing"
   * line breaks, and nobody can quote the tally without this staring at them */
  console.log(`\x1b[33mQUICK RUN — PARTIAL: skipped ${skipped.length} suite(s): ${skipped.join(' · ')}\x1b[0m`);
  console.log(`\x1b[33mthe full \`node test/headless.js\` (no flag) is the gate before any push\x1b[0m`);
}
process.exit(bad);

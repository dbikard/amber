/* test/lib.js — the smallest test harness that says something useful when it fails. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const results = [];
/* ---- provenance: which code does this tally actually speak for? ----
 * Six runs in one session tested STALE files: node loads a test file at process start, edits
 * landed mid-run, and every stale tally looked authoritative. So the report names what the
 * process LOADED, each with a short content hash.
 * The semantics, chosen deliberately: a file is hashed the moment it is TRACKED — require()d
 * modules right here, as this harness itself is required (the same tick as the requires above
 * it in the entry file, so disk and memory are still the same bytes), and files a runner
 * serves over HTTP when it registers them, before the first navigation. report() then reads
 * the disk AGAIN: a file whose bytes moved in between prints `name@load!=disk@now` and a red
 * STALE line, because that mismatch is exactly what this line exists to expose — a tally is
 * evidence about the code the process loaded, never about edits that landed mid-run. */
const short = (f) => {
  try { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 4); }
  catch (e) { return '????'; }
};
const tracked = [];   // [basename, absolute path, hash at track time]
function track(file) {
  const f = path.resolve(file);
  if (!tracked.some((t) => t[1] === f)) tracked.push([path.basename(f), f, short(f)]);
}
if (require.main) track(require.main.filename);
for (const f of Object.keys(require.cache)) if (!f.includes('node_modules')) track(f);
let group = '';
/* wall time per suite: when a run gets slow it should be obvious WHICH part got slow,
 * without anyone having to bisect it by hand */
const timing = [];
let markAt = Date.now();
/* NOTHING IS ADDED AFTER THE TALLY IS TAKEN. `report()` prints the rows it has and returns
 * the failure count the runner exits on, so a suite written BELOW the report block runs, is
 * never printed, is never counted, and cannot fail the build — the file grows at the bottom
 * and the report was ninety lines above it. Three suites lived down there before this was
 * noticed, two of them shipped, none of them having ever asserted anything: they read as a
 * green run because a green run is exactly what they produced. It is the instrument doing
 * nothing while looking alive, which this project has paid for enough times. So it throws. */
let tallied = false;
function guard(what) {
  if (tallied) throw new Error(`${what} was registered AFTER report() — it would never be ` +
    'printed, counted, or able to fail the run. Move it above the report block.');
}
/* AMBER_TRACE=1 names each suite on stderr the moment it starts. The tally is buffered until
 * report(), so a run that HANGS looks exactly like a run that is slow — measured: two browser
 * runs sat idle for hours with nothing on the terminal — and this is how one names itself. */
const TRACE = !!process.env.AMBER_TRACE;
function suite(name) {
  guard(`suite('${name}')`);
  if (group) timing.push([group, Date.now() - markAt]);
  markAt = Date.now();
  group = name;
  if (TRACE) process.stderr.write(`  · ${name}\n`);
}
function ok(name, cond, detail) {
  guard(`ok('${name}')`);
  results.push({ group, name, pass: !!cond, detail: detail == null ? '' : String(detail) });
  return !!cond;
}
function eq(name, got, want, detail) {
  return ok(name, got === want, detail != null ? detail : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}
function near(name, got, want, tol, detail) {
  return ok(name, Math.abs(got - want) <= tol, detail != null ? detail : `got ${got}, want ${want} ±${tol}`);
}
function report(label) {
  if (group) timing.push([group, Date.now() - markAt]);
  const fails = results.filter((r) => !r.pass);
  let last = '';
  for (const r of results) {
    if (r.group !== last) { last = r.group; console.log('\n  ' + last); }
    console.log('    ' + (r.pass ? '\x1b[32m✓\x1b[0m ' : '\x1b[31m✗\x1b[0m ') + r.name + (r.detail && !r.pass ? '\n        ' + r.detail : ''));
  }
  const slow = timing.filter((t) => t[1] >= 1000).sort((a, b) => b[1] - a[1]);
  if (slow.length) {
    const total = timing.reduce((a, t) => a + t[1], 0);
    console.log(`\n  slowest: ` + slow.slice(0, 6).map((t) => `${t[0]} ${(t[1] / 1000).toFixed(1)}s`).join(' · ') +
                `   (${(total / 1000).toFixed(1)}s in suites)`);
  }
  /* one grep-friendly line naming the code this tally speaks for — see the note at `track` */
  const now = tracked.map(([n, f, h]) => [n, h, short(f)]);
  console.log('\n  loaded: ' + now.map(([n, h, d]) => (d === h ? `${n}@${h}` : `${n}@${h}!=disk@${d}`)).join(' '));
  const moved = now.filter(([n, h, d]) => d !== h);
  if (moved.length) console.log(`  \x1b[31mSTALE: ${moved.map(([n]) => n).join(', ')} changed on disk after this process loaded it — ` +
                                `the tally below does not cover that edit\x1b[0m`);
  console.log(`\n${label}: ${results.length - fails.length}/${results.length} passing` +
              (fails.length ? `  \x1b[31m${fails.length} FAILING\x1b[0m` : ''));
  tallied = true;
  return fails.length;
}
/* A parallel branch collects its own rows and timings and splices them in afterwards, so a
 * concurrent run still reports in a stable order instead of interleaving two renderers. */
function record(rows, times) {
  guard(`${rows.length} row(s) from a parallel branch`);
  for (const r of rows) results.push(r);
  for (const t of (times || [])) timing.push(t);
  markAt = Date.now();
}
/* ---- A BOARD WITH A CURTAIN ON IT, BUILT ONCE ----
 * Nine suites opened by pushing the same Shadow Gates at the same coordinates to hire crews,
 * and four of them then ran the same radius-and-angle search for somewhere the sim would let a
 * run be drawn. That is scaffolding, not a test, and copied nine times it is nine places to get
 * a board subtly different from the one the assertions were written against.
 * The construction is EXACTLY what those suites did by hand — same seed handling, same gate
 * coordinates, same search order — so a suite that moves onto this rig plays the same board it
 * always played. `World` and `CONST` come in as arguments because this harness knows nothing
 * about the game and should not start now.
 * Returns null when the board has no room for the run, which is a thing the caller must ASSERT
 * rather than skip past: a rig that quietly built nothing passes everything. */
function wallRig(World, C, { seed = 20260810, crews = 8, runs = 1, len = 200, players = 2 } = {}) {
  const w = World.createWorld(seed, players), pl = w.players[0];
  pl.essence = 1e7;
  w.chaosNext = 1e9;                                  // no weather: this is a rig about stone
  const c = World.cityOf(w, 0), gd = C.BUILDINGS.gate;
  for (let i = 0; i < crews; i++)                     // a crew per Gate — see MASONS
    pl.buildings.push({ id: w.nextId++, bt: 'gate', level: 1,
                        /* toward the middle of the board: the Seats stand in corners, and a
                         * Gate pushed 520 the other way stands off the map */
                        x: c.x + (c.x < C.MAP.W / 2 ? 1 : -1) * (520 + i * 12), y: c.y + (c.y < C.MAP.H / 2 ? 1 : -1) * 520,
                        cd: 0, raise: 0, raiseFor: gd.raise, hp: gd.hp, maxHp: gd.hp,
                        lastHurt: -99, node: -1, co: 0 });
  const finish = () => {
    for (let i = 0; i < 90 * 30; i++) {
      World.update(w, C.SIM_DT);
      if (!pl.buildings.some((b) => b.raise > 0 || b.work > 0)) return;
    }
  };
  let start = null;
  for (let rad = 190; rad < 460 && !start; rad += 20)
    for (let a = 0; a < 64 && !start; a++) {
      const th = a / 64 * Math.PI * 2;
      const x = c.x + Math.cos(th) * rad, y = c.y + Math.sin(th) * rad;
      /* well inside the world: a Seat stands in a corner now, and a curtain against the map's
       * edge has a face nobody can stand on */
      if (x < 140 || y < 140 || x + runs * len > C.MAP.W - 140 || y > C.MAP.H - 140) continue;
      let room = true;
      for (let k = 0; k < runs && room; k++)
        if (World.wallError(w, 0, x + k * len, y, x + (k + 1) * len, y)) room = false;
      if (room) start = { x, y };
    }
  if (!start) return null;
  let built = 0;
  for (let k = 0; k < runs; k++) {
    pl.essence = 1e7;
    if (World.applyCommand(w, 0, { c: 'build', bt: 'wall', x: start.x + k * len, y: start.y,
                                   x2: start.x + (k + 1) * len, y2: start.y }).ok) built++;
    finish();
  }
  return { w, pl, city: c, start, built, finish, walls: pl.buildings.filter((b) => b.bt === 'wall') };
}

module.exports = { suite, ok, eq, near, report, results, record, track, wallRig };

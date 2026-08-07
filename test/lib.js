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
function suite(name) {
  if (group) timing.push([group, Date.now() - markAt]);
  markAt = Date.now();
  group = name;
}
function ok(name, cond, detail) {
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
  return fails.length;
}
/* A parallel branch collects its own rows and timings and splices them in afterwards, so a
 * concurrent run still reports in a stable order instead of interleaving two renderers. */
function record(rows, times) {
  for (const r of rows) results.push(r);
  for (const t of (times || [])) timing.push(t);
  markAt = Date.now();
}
module.exports = { suite, ok, eq, near, report, results, record, track };

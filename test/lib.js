/* test/lib.js — the smallest test harness that says something useful when it fails. */
'use strict';
const results = [];
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
module.exports = { suite, ok, eq, near, report, results, record };

/* test/lib.js — the smallest test harness that says something useful when it fails. */
'use strict';
const results = [];
let group = '';

function suite(name) { group = name; }
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
  const fails = results.filter((r) => !r.pass);
  let last = '';
  for (const r of results) {
    if (r.group !== last) { last = r.group; console.log('\n  ' + last); }
    console.log('    ' + (r.pass ? '\x1b[32m✓\x1b[0m ' : '\x1b[31m✗\x1b[0m ') + r.name + (r.detail && !r.pass ? '\n        ' + r.detail : ''));
  }
  console.log(`\n${label}: ${results.length - fails.length}/${results.length} passing` +
              (fails.length ? `  \x1b[31m${fails.length} FAILING\x1b[0m` : ''));
  return fails.length;
}
module.exports = { suite, ok, eq, near, report, results };

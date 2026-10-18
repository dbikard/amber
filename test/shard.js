/* test/shard.js — one share of test/headless.js, so the headless half can use every core.
 * `node test/shard.js K N [--quick]` runs the K-th of N shares (0-based); `test/run.js` starts
 * all N at once. `node test/headless.js` alone is still the whole thing, unchanged.
 *
 * HOW A SHARE IS CUT, WITHOUT TOUCHING THE FILE. headless.js is one long script of top-level
 * `suite('...')` calls each followed by its block. A CHUNK is everything from one top-level
 * `suite(` line to the next. Every share keeps the preamble (the requires and the harness),
 * the tail (the report), and every top-level DECLARATION anywhere in the file — the helpers
 * written between suites that later suites call — and blanks the lines of every chunk it does
 * not own. Blanked, not deleted: a stack trace in a share names the same line as in the whole
 * file. The link-code suite defines `codecDone`, which the tail awaits; a share that does not
 * own it gets a resolved promise in its place.
 *
 * WHO OWNS WHAT is decided here, identically in every share, from test/suite-times.json (the
 * last full run's seconds per chunk; an unknown chunk counts as one second): longest first,
 * each to the share with the least work so far. The 150-second ladder gets a share to itself.
 *
 * THE CONTROL: the shares' tallies must add up to the whole file's — run.js prints the sum and
 * the count of shares, and a chunk that silently ran nowhere would show as a short total.
 * `AMBER_ONLY='muster ground' node test/shard.js 0 1` runs just the matching suites. */
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');

const FILE = path.join(__dirname, 'headless.js');
const TIMES = path.join(__dirname, 'suite-times.json');

/* the chunks, shared with run.js (which needs the names to record times) */
function chunksOf(lines) {
  const starts = [];
  lines.forEach((l, i) => { if (/^suite\(/.test(l)) starts.push(i); });
  const catchAt = lines.findIndex((l) => /^codecDone\.catch/.test(l));
  let tail = catchAt;
  while (tail > 0 && !/^\/\* -+ \*\/\s*$/.test(lines[tail])) tail--;
  if (tail <= 0) tail = catchAt;
  const out = [];
  for (let j = 0; j < starts.length; j++) {
    const a = starts[j], b = j + 1 < starts.length ? starts[j + 1] : tail;
    const body = lines.slice(a, b).join('\n');
    const names = [...body.matchAll(/\bsuite\(\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\'/g, "'"));
    out.push({ a, b, name: names[0], names, codec: /^const codecDone\b/m.test(body) });
  }
  return { starts, tail, chunks: out };
}

function plan(chunks, n) {
  /* AMBER_ONLY=<regex>: run only the chunks whose suite names match, all in share 0 — the way
   * to re-run one failing suite in seconds instead of the whole file */
  if (process.env.AMBER_ONLY) {
    const re = new RegExp(process.env.AMBER_ONLY, 'i'), owner = new Map();
    chunks.forEach((c, i) => owner.set(i, c.names.some((nm) => re.test(nm)) ? 0 : -1));
    return owner;
  }
  let times = {};
  try { times = JSON.parse(fs.readFileSync(TIMES, 'utf8')); } catch (e) { times = {}; }
  const load = new Array(n).fill(0), owner = new Map();
  const order = chunks.map((c, i) => ({ i, w: times[c.name] != null ? times[c.name] : 1 }))
                      .sort((x, y) => y.w - x.w || x.i - y.i);
  for (const { i, w } of order) {
    let k = 0;
    for (let q = 1; q < n; q++) if (load[q] < load[k]) k = q;
    owner.set(i, k); load[k] += w;
  }
  return owner;
}

/* the top-level declarations inside a chunk this share does NOT own: kept, whole, so a later
 * suite that calls `raise(...)` or `fogArena(...)` finds them wherever it runs */
function keepDecls(lines, a, b, keep) {
  for (let i = a; i < b; i++) {
    if (!/^(const|let|var|function|class|async function) /.test(lines[i])) continue;
    let bal = 0, j = i;
    for (; j < b; j++) {
      const code = lines[j].replace(/\/\/.*$/, '').replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '');
      for (const ch of code) { if ('{(['.includes(ch)) bal++; else if ('})]'.includes(ch)) bal--; }
      keep[j] = true;
      if (bal <= 0 && /[;}]\s*(\/\/.*|\/\*.*\*\/)?\s*$/.test(lines[j])) break;
    }
    i = j;
  }
}

function source(k, n) {
  const lines = fs.readFileSync(FILE, 'utf8').split('\n');
  const { starts, tail, chunks } = chunksOf(lines);
  const owner = plan(chunks, n);
  const keep = new Array(lines.length).fill(false);
  for (let i = 0; i < (starts[0] || 0); i++) keep[i] = true;          // preamble
  for (let i = tail; i < lines.length; i++) keep[i] = true;           // tail
  const stub = [];
  chunks.forEach((c, ci) => {
    if (owner.get(ci) === k) { for (let i = c.a; i < c.b; i++) keep[i] = true; return; }
    if (c.codec) stub.push(c.a);       // its one declaration IS the suite: a stub stands in
    else keepDecls(lines, c.a, c.b, keep);
  });
  const out = lines.map((l, i) => (keep[i] ? l : ''));
  for (const at of stub) out[at] = 'const codecDone = Promise.resolve();';
  return { text: out.join('\n'), chunks, owner };
}

module.exports = { chunksOf, FILE, TIMES };

if (require.main === module) {
  const k = +process.argv[2], n = +process.argv[3];
  if (!(n >= 1 && k >= 0 && k < n)) { console.error('usage: node test/shard.js K N [--quick]'); process.exitCode = 2; return; }
  const { text, chunks, owner } = source(k, n);
  /* what this share ran, by chunk, so run.js can record the next plan's times. lib.js is NOT
   * required before the compile: it tracks (hashes) whatever is in the require cache when it
   * loads, and headless.js loads the game's files first — the provenance line depends on it. */
  if (process.env.AMBER_TIMES_OUT) {
    process.on('exit', () => {
      const lib = require('./lib.js');
      const mine = {};
      const t = new Map(lib.timing || []);
      chunks.forEach((c, ci) => {
        if (owner.get(ci) !== k) return;
        mine[c.name] = c.names.reduce((s, nm) => s + (t.get(nm) || 0), 0) / 1000;
      });
      try { fs.writeFileSync(process.env.AMBER_TIMES_OUT, JSON.stringify(mine)); } catch (e) { /* the run still counts */ }
    });
  }
  const m = new Module(FILE, module);
  m.filename = FILE;
  m.paths = Module._nodeModulePaths(path.dirname(FILE));
  m._compile(text, FILE);
  require('./lib.js').track(FILE);   // the share speaks for headless.js, so it names it
}

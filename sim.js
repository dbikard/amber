#!/usr/bin/env node
/* sim.js — the referee. Headless bot-vs-bot matches over the SAME update() the browser runs.
 * Default: full suite (mirror / gradient / round-robin / durations).
 * One matchup:  node sim.js --a=brand --b=julian --n=40 [--seed=1] [--verbose]
 *
 * THE FULL SUITE IS ~470 MATCHES, and a match is up to 80,000 ticks of the real simulation —
 * something like ten million ticks in all, which took half an hour in one thread while three
 * cores sat idle. Each matchup is completely independent (its own world, its own seed), so
 * they are dealt out to a pool of workers and the wall clock falls to roughly the core count.
 * Results are unchanged: every series keeps the seed it always had, so a run is reproducible
 * and comparable with the runs before it — only the ORDER they are computed in changes, and
 * the output is re-ordered back before it is printed.
 *   node sim.js --jobs=1   forces the old serial behaviour.
 *   node sim.js --quick    half the games again, for iterating; the full run is the referee.
 *   node sim.js --rr=12    more games in the ladder section, when the order looks like a coin
 *                          toss rather than a field.
 *   node sim.js --cap=20   call a match a timeout after 20 minutes of play. --quick does it by
 *                          default, and it is the only reason the cheap run was ever slow.
 */
'use strict';
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
require('./js/rng.js');
require('./js/const.js');
require('./js/worldgen.js');
require('./js/nav.js');
require('./js/world.js');
require('./js/ai.js');

const { CONST: C, World, AI } = globalThis;
/* 45 min hard cap on a match. The band is 5-20, so anything near this is a match that never
 * resolved — and in --quick those are the whole cost: one matchup that will not converge runs
 * nine times longer than one that does, and the pool is only as fast as its slowest worker.
 * Quick mode caps at twenty and calls the rest a timeout, which is the same information for a
 * third of the price: a run of timeouts says "this does not converge", and if you want to know
 * how long they REALLY take, that is what the full run is for. */
const QUICK_T = 1200;
let MAX_T = (workerData && workerData.maxT) || 2700;   // the main thread sets it from --cap
const DT = C.SIM_DT;

function playMatch(aKind, bKind, seed, opts) {
  opts = opts || {};
  const world = World.createWorld(seed);
  const bots = [AI.make(aKind, opts.aOpts), AI.make(bKind, opts.bOpts)];
  const issue = (pi) => (cmd) => World.applyCommand(world, pi, cmd);
  const issuers = [issue(0), issue(1)];
  while (world.winner === null && world.t < MAX_T) {
    /* alternate which bot is polled first. With free placement, acting first means
     * claiming the ground first — stepping seat 0 ahead of seat 1 every tick is a bias
     * in the REFEREE, not in the game, and a mirror match will show it. */
    const first = world.tick % 2 === 0 ? 0 : 1;
    bots[first].step(world, first, issuers[first], DT);
    bots[1 - first].step(world, 1 - first, issuers[1 - first], DT);
    World.update(world, DT);
    world.events.length = 0;   // headless: nobody drains the render queue
  }
  return { winner: world.winner, t: world.t, reason: world.winReason || 'timeout' };
}

function series(aKind, bKind, n, baseSeed, opts) {
  const r = { a: 0, b: 0, draw: 0, times: [], reasons: {} };
  for (let i = 0; i < n; i++) {
    /* swap sides each game so any board bias cancels out */
    const swap = i % 2 === 1;
    const m = swap ? playMatch(bKind, aKind, baseSeed + i, opts)
                   : playMatch(aKind, bKind, baseSeed + i, opts);
    const w = m.winner === null || m.winner === -1 ? null : (swap ? 1 - m.winner : m.winner);
    if (w === 0) r.a++; else if (w === 1) r.b++; else r.draw++;
    r.times.push(m.t);
    r.reasons[m.reason] = (r.reasons[m.reason] || 0) + 1;
  }
  r.times.sort((x, y) => x - y);
  r.median = r.times[Math.floor(n / 2)];
  return r;
}

function fmt(aKind, bKind, r, n) {
  const med = (r.median / 60).toFixed(1);
  const reasons = Object.entries(r.reasons).map(([k, v]) => k + ':' + v).join(' ');
  return `${aKind.padEnd(9)} vs ${bKind.padEnd(9)}  ${String(r.a).padStart(3)}-${String(r.b).padEnd(3)}` +
         ` (draw ${r.draw})  ${(100 * r.a / n).toFixed(0).padStart(3)}%  med ${med}m  [${reasons}]`;
}

/* ---------------- a worker is one series ---------------- */
if (!isMainThread) {
  parentPort.postMessage(series(workerData.a, workerData.b, workerData.n, workerData.seed));
  return;
}

/* ---------------- CLI ---------------- */
const args = {};
for (const a of process.argv.slice(2)) { const m = /^--(\w+)(?:=(.*))?$/.exec(a); if (m) args[m[1]] = m[2] === undefined ? true : m[2]; }
/* THE HEIRS ARE NOT MEANT TO BE BALANCED. They were, for a long time, and the round-robin
 * that policed it was three hundred of this runner's four hundred and seventy matches — spent
 * proving a thing the game does not want. Heirs are meant to play DIFFERENTLY; a player who
 * meets five identical opponents in different coats has met one. What their strengths are for
 * is the ORDER OF THE LADDER: the campaign faces you with the weakest first. So the
 * round-robin stays, at a sixth of the games, and its job is to hand back that order rather
 * than to fail a target. Six games a matchup will not tell 45% from 55% and does not need to —
 * it needs to tell bleys from brand, and it does that easily.
 * What IS still a target: a mirror near 50% (that is seat fairness, not heir balance), the
 * skill gradient (that is the AI working at all), and convergence (matches must end). */
const QUICK = !!args.quick;
const N = +args.n || (QUICK ? 6 : 20), SEED = +args.seed || 1000;
const CONV = QUICK ? 3 : 8;
const RR = +args.rr || (QUICK ? 3 : 6);
/* AND THE CAP IS THE WHOLE COST. A matchup that will not converge runs to the 45-minute wall
 * and costs nine times what one that resolves in five costs — and the pool is only as fast as
 * its slowest worker, so ONE such matchup sets the length of the run. Quick mode calls a match
 * a timeout at twenty minutes, which is the same information for a third of the price: a row
 * of timeouts says "this does not converge", and how long they really take is what the full
 * run is for. */
const CAP = (+args.cap ? +args.cap * 60 : (QUICK ? QUICK_T : 2700));
MAX_T = CAP;   // --jobs=1 plays in THIS thread, and must obey the same cap the workers do

if (args.a && args.b) {
  const r = series(args.a, args.b, N, SEED);
  console.log(fmt(args.a, args.b, r, N));
  process.exit(0);
}

/* THE WHOLE SUITE, as a list of independent series. Building it up front is what lets them
 * be dealt out in any order and printed back in this one — `head` is the section banner a
 * job opens, if any. */
const heirs = Object.keys(AI.HEIRS);
const jobs = [];
jobs.push({ head: `Amber sim — ${N} games/matchup, seed ${SEED}\n\n— mirror symmetry (target ≈50%) —`,
            a: 'benedict', b: 'benedict', n: N, seed: SEED });
jobs.push({ a: 'bleys', b: 'bleys', n: N, seed: SEED });
jobs.push({ head: '\n— skill gradient (skilled > greedy > random) —',
            a: 'benedict', b: 'random', n: N, seed: SEED + 100 });
jobs.push({ a: 'benedict', b: 'greedy', n: N, seed: SEED + 200 });
jobs.push({ a: 'greedy', b: 'random', n: N, seed: SEED + 300 });
let first = true;
for (let i = 0; i < heirs.length; i++) for (let j = i + 1; j < heirs.length; j++) {
  jobs.push({ head: first ? '\n— the ladder (heirs need not be equal; the campaign faces the weakest first) —' : null,
              a: heirs[i], b: heirs[j], n: RR, seed: SEED + 1000 + i * 37 + j, rr: true });
  first = false;
}
const rrEnd = jobs.length;
jobs.push({ head: '\n— convergence (passive-vs-passive must still end) —',
            a: 'greedy', b: 'greedy', n: CONV, seed: SEED + 5000 });
jobs.push({ a: 'julian', b: 'julian', n: CONV, seed: SEED + 6000 });

/* The LONGEST jobs are handed out first. A pool is only as fast as its last worker, and the
 * julian mirror runs to the 45-minute cap where a bleys match is over in six — deal that one
 * last and three cores idle while it finishes alone. */
for (const j of jobs) j.maxT = CAP;   // ...and every worker is handed it with its job

const order = jobs.map((_, i) => i);
const WEIGHT = { julian: 3, brand: 2, corwin: 2, benedict: 2, random: 1, greedy: 1, bleys: 1 };
const cost = (j) => j.n * ((WEIGHT[j.a] || 2) + (WEIGHT[j.b] || 2));
order.sort((x, y) => cost(jobs[y]) - cost(jobs[x]));

const POOL = Math.max(1, Math.min(+args.jobs || os.cpus().length, jobs.length));
const done = new Array(jobs.length).fill(null);
let next = 0, printed = 0, live = 0;

/* print everything that is ready, in the ORIGINAL order — so a parallel run reads exactly
 * like a serial one, and can still be diffed against the run before it */
function flush() {
  while (printed < jobs.length && done[printed]) {
    const j = jobs[printed], r = done[printed];
    if (j.head) console.log(j.head);
    console.log(fmt(j.a, j.b, r, j.n));
    printed++;
    if (printed === rrEnd) {
      const table = {};
      for (let i = 0; i < rrEnd; i++) {
        if (!jobs[i].rr) continue;
        table[jobs[i].a] = (table[jobs[i].a] || 0) + done[i].a;
        table[jobs[i].b] = (table[jobs[i].b] || 0) + done[i].b;
      }
      const rank = Object.entries(table).sort((a, b) => b[1] - a[1]);
      console.log('\ntotal wins: ' + rank.map(([k, v]) => `${k}:${v}`).join('  '));
      /* and the answer this section exists for, ready to paste into game.js */
      console.log('LADDER = ' + JSON.stringify(rank.map(([k]) => k).reverse()) +
                  '   // weakest first');
    }
  }
}

function pump() {
  while (live < POOL && next < order.length) {
    const idx = order[next++];
    live++;
    const w = new Worker(__filename, { workerData: jobs[idx], argv: [] });
    w.on('message', (r) => { done[idx] = r; flush(); });
    w.on('error', (e) => { console.error('worker failed on ' + jobs[idx].a + ' vs ' + jobs[idx].b, e); process.exit(1); });
    w.on('exit', () => { live--; pump(); });
  }
}

if (POOL === 1) {                    // --jobs=1: the old serial path, for a like-for-like check
  for (let i = 0; i < jobs.length; i++) { done[i] = series(jobs[i].a, jobs[i].b, jobs[i].n, jobs[i].seed); flush(); }
} else pump();

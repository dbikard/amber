#!/usr/bin/env node
/* sim.js — the referee. Headless bot-vs-bot matches over the SAME update() the browser runs.
 * Default: full suite (mirror / gradient / round-robin / durations).
 * One matchup:  node sim.js --a=brand --b=julian --n=40 [--seed=1] [--verbose]
 */
'use strict';
require('./js/rng.js');
require('./js/const.js');
require('./js/world.js');
require('./js/ai.js');

const { CONST: C, World, AI } = globalThis;
const DT = C.SIM_DT, MAX_T = 2700;   // 45 min hard cap — the target band is 15-30 min

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

/* ---------------- CLI ---------------- */
const args = {};
for (const a of process.argv.slice(2)) { const m = /^--(\w+)(?:=(.*))?$/.exec(a); if (m) args[m[1]] = m[2] === undefined ? true : m[2]; }
const N = +args.n || 30, SEED = +args.seed || 1000;

if (args.a && args.b) {
  const r = series(args.a, args.b, N, SEED);
  console.log(fmt(args.a, args.b, r, N));
  process.exit(0);
}

console.log(`Amber sim — ${N} games/matchup, seed ${SEED}\n`);

console.log('— mirror symmetry (target ≈50%) —');
for (const k of ['benedict', 'bleys']) console.log(fmt(k, k, series(k, k, N, SEED), N));

console.log('\n— skill gradient (skilled > greedy > random) —');
console.log(fmt('benedict', 'random', series('benedict', 'random', N, SEED + 100), N));
console.log(fmt('benedict', 'greedy', series('benedict', 'greedy', N, SEED + 200), N));
console.log(fmt('greedy', 'random', series('greedy', 'random', N, SEED + 300), N));

console.log('\n— heir round-robin (no dominant strategy) —');
const heirs = Object.keys(AI.HEIRS);
const table = {};
for (let i = 0; i < heirs.length; i++) for (let j = i + 1; j < heirs.length; j++) {
  const r = series(heirs[i], heirs[j], N, SEED + 1000 + i * 37 + j);
  console.log(fmt(heirs[i], heirs[j], r, N));
  table[heirs[i]] = (table[heirs[i]] || 0) + r.a; table[heirs[j]] = (table[heirs[j]] || 0) + r.b;
}
console.log('\ntotal wins: ' + Object.entries(table).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  '));

console.log('\n— convergence (passive-vs-passive must still end) —');
console.log(fmt('greedy', 'greedy', series('greedy', 'greedy', 10, SEED + 5000), 10));
console.log(fmt('julian', 'julian', series('julian', 'julian', 10, SEED + 6000), 10));

#!/usr/bin/env node
/* search.js — REFEREE-DRIVEN PARAMETER SEARCH over the doctrine's tunables (AI.DEFAULTS).
 *
 * The designer's call (2026-08-22), choosing this over a learned policy: keep every rule
 * legible and let the machine do the fine-tuning. A (1+λ) evolution strategy: the incumbent
 * vector and λ gaussian perturbations are each played against BASELINES PINNED AT THE
 * DEFAULTS (sim.js's series carries `tuneA` to the candidate's side only), on a COMMON seed
 * battery per generation (common random numbers - candidates differ by skill, not by luck),
 * with THE PLAYER'S OPENINGS as constraints: every probe gate lost over the floor is paid
 * for out of the fitness. The incumbent is re-evaluated every generation on the fresh
 * battery, so a lucky ancestor cannot squat.
 *
 *   node search.js [--hours=9] [--lambda=8] [--n=8] [--out=search-out]
 *
 * State is written to <out>/state.json after every generation and the run RESUMES from it,
 * so an interrupted night loses one generation at most. <out>/log.txt is the chronicle.
 * Nothing here touches the game: a result is a PROPOSAL, judged by the full referee and the
 * designer before any default changes. */
'use strict';
const { Worker } = require('worker_threads');
const os = require('os');
const fs = require('fs');
const path = require('path');

const args = {};
for (const a of process.argv.slice(2)) { const m = /^--(\w+)(?:=(.*))?$/.exec(a); if (m) args[m[1]] = m[2] === undefined ? true : m[2]; }
const HOURS = +args.hours || 9;
const LAMBDA = +args.lambda || 8;
const N = +args.n || 8;                       // games per heir-series (seats swap inside)
const OUT = path.join(__dirname, args.out || 'search-out');
const CAP = 1500;                             // seconds of game time a search match may run
const GATE_FLOOR = 6;                         // the probes' raid floor
const PENALTY = 0.05;                         // fitness paid per gate lost over the floor
const WORKERS = Math.max(2, Math.min(16, os.cpus().length));
const HEIRS = ['julian', 'bleys', 'brand', 'corwin', 'benedict'];

/* the space: every key of AI.DEFAULTS the referee keeps re-judging, with bounds. `int`
 * keys are rounded after every perturbation. Bounds are wide but sane - the constraint
 * probes are what keep the search out of degenerate corners. */
const SPACE = {
  COMMIT:        { lo: 10,  hi: 34,  int: true },
  RAID_MEN:      { lo: 5,   hi: 14,  int: true },
  BREAKERS:      { lo: 2,   hi: 6,   int: true },
  HALL_CAP:      { lo: 3,   hi: 6,   int: true },
  OUTNUMBER:     { lo: 2,   hi: 10,  int: true },
  SPARE:         { lo: 1,   hi: 8,   int: true },
  WALK_ARMY:     { lo: 4,   hi: 16,  int: true },
  SHRINE_GUARD:  { lo: 250, hi: 800, int: true },
  FOE_R:         { lo: 80,  hi: 220, int: true },
  STAGE_BACK:    { lo: 300, hi: 600, int: true },
  STAGE_NEAR:    { lo: 220, hi: 450, int: true },
  STAGE_GATHER:  { lo: 120, hi: 300, int: true },
  STAGE_RETREAT: { lo: 0.25, hi: 0.7 }
};
const KEYS = Object.keys(SPACE);

/* seeded RNG so a resumed run replays the same perturbations for its generation number */
let rngS = 0x9e3779b9;
function srand(seed) { rngS = seed >>> 0 || 1; }
function rnd() { rngS ^= rngS << 13; rngS ^= rngS >>> 17; rngS ^= rngS << 5; rngS >>>= 0; return rngS / 4294967296; }
function gauss() { return Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd()); }

function clamp(vec) {
  const o = {};
  for (const k of KEYS) {
    const sp = SPACE[k];
    let x = Math.min(sp.hi, Math.max(sp.lo, vec[k]));
    if (sp.int) x = Math.round(x);
    o[k] = x;
  }
  return o;
}
function perturb(base, sigma) {
  const o = {};
  for (const k of KEYS) {
    const sp = SPACE[k];
    o[k] = base[k] + gauss() * sigma * (sp.hi - sp.lo);
  }
  return clamp(o);
}

/* ---------------- the worker pool: sim.js does the playing ---------------- */
const queue = [];
let running = 0;
function job(data) {
  return new Promise((res, rej) => { queue.push({ data, res, rej }); pump(); });
}
function pump() {
  while (running < WORKERS && queue.length) {
    const { data, res, rej } = queue.shift();
    running++;
    const wk = new Worker(path.join(__dirname, 'sim.js'), { workerData: data, argv: [] });
    wk.on('message', (m) => { running--; res(m); pump(); });
    wk.on('error', (e) => { running--; rej(e); pump(); });
  }
}

/* ---------------- fitness ---------------- */
async function evaluate(tune, heirs, seedBase) {
  const series = heirs.map((h, i) =>
    job({ a: h, b: 'greedy', n: N, seed: seedBase + i * 1000, tuneA: tune, cap: CAP, maxT: CAP }));
  const probes = HEIRS.map((h, i) =>
    job({ probe: h, seed: 1000 + 400 + HEIRS.indexOf(h), tune }));
  const sr = await Promise.all(series);
  const pr = await Promise.all(probes);
  const wins = sr.reduce((t, r) => t + r.a, 0);
  const games = heirs.length * N;
  const over = pr.reduce((t, r) => t + Math.max(0, r.razed - GATE_FLOOR), 0);
  return { fit: wins / games - PENALTY * over, winRate: wins / games, over,
           probes: pr.map((r, i) => `${HEIRS[i]}:${r.razed}`).join(' ') };
}

/* ---------------- the loop ---------------- */
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const stateFile = path.join(OUT, 'state.json'), logFile = path.join(OUT, 'log.txt');
  const log = (line) => { fs.appendFileSync(logFile, line + '\n'); console.log(line); };
  let state = null;
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (e) {}
  if (!state) {
    /* the incumbent starts at the shipped defaults - read off ai.js itself so the search
     * can never drift from what the game actually plays */
    require('./js/rng.js'); require('./js/const.js'); require('./js/worldgen.js');
    require('./js/nav.js'); require('./js/world.js'); require('./js/ai.js');
    const d = globalThis.AI.DEFAULTS;
    const best = {}; for (const k of KEYS) best[k] = d[k];
    state = { gen: 0, best: clamp(best), bestFit: null, sigma: 0.12, history: [] };
    log(`# fresh search from the shipped defaults: ${JSON.stringify(state.best)}`);
  } else log(`# resumed at generation ${state.gen}, best ${JSON.stringify(state.best)}`);

  const deadline = Date.now() + HOURS * 3600 * 1000;
  while (Date.now() < deadline) {
    const gen = state.gen;
    srand(0xA11CE + gen * 7919);
    /* three heirs a generation, rotating so every heir referees over the night */
    const heirs = [HEIRS[gen % 5], HEIRS[(gen + 1) % 5], HEIRS[(gen + 2) % 5]];
    const seedBase = 50000 + gen * 10000;     // fresh COMMON battery per generation
    const t0 = Date.now();
    const cands = [state.best];
    for (let i = 0; i < LAMBDA; i++) cands.push(perturb(state.best, state.sigma));
    const results = await Promise.all(cands.map((c) => evaluate(c, heirs, seedBase)));
    let bi = 0;
    for (let i = 1; i < results.length; i++) if (results[i].fit > results[bi].fit) bi = i;
    const took = ((Date.now() - t0) / 60000).toFixed(1);
    const inc = results[0], win = results[bi];
    const moved = bi !== 0;
    if (moved) state.best = cands[bi];
    state.bestFit = win.fit;
    /* sigma adapts a little: a generation that finds nothing narrows the net */
    state.sigma = Math.max(0.05, Math.min(0.2, state.sigma * (moved ? 1.1 : 0.93)));
    state.gen = gen + 1;
    state.history.push({ gen, heirs: heirs.join(','), fit: +win.fit.toFixed(3),
                         incFit: +inc.fit.toFixed(3), moved, best: state.best });
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 1));
    log(`gen ${String(gen).padStart(3)}  ${heirs.join('+').padEnd(24)} inc ${inc.fit.toFixed(3)} (wr ${inc.winRate.toFixed(2)} over ${inc.over})` +
        `  best ${win.fit.toFixed(3)} (wr ${win.winRate.toFixed(2)} over ${win.over})  ${moved ? 'MOVED' : 'held '}  σ${state.sigma.toFixed(3)}  ${took}m` +
        `  probes[${win.probes}]`);
  }
  log(`# deadline reached at generation ${state.gen}; best ${JSON.stringify(state.best)} fit ${state.bestFit}`);
  process.exit(0);
})().catch((e) => { console.error(e); fs.appendFileSync(path.join(OUT, 'log.txt'), 'CRASH ' + (e && e.stack || e) + '\n'); process.exit(1); });

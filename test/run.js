/* test/run.js — the whole suite. `node test/run.js` (there is no package.json, so no `npm test`).
 * Each file runs in its own process so a crash in one cannot hide the other's results.
 *
 * AND THE TWO RUN AT ONCE, because they contend for nothing. `headless.js` is pure Node and
 * `browser.js` drives Chromium over its own ephemeral HTTP port; neither reads the other's
 * files, no fixture is shared, and the wall clock was simply the sum of them — a headless run
 * and a browser run that each pin one core, taken one after the other. The cost of that is
 * output: each suite prints its whole tally in `report()` at the end, so two of them writing
 * to one terminal live would interleave two carefully grouped lists into nonsense. So each
 * child's output is BUFFERED and printed whole the moment that child exits, in whatever order
 * they finish — the tallies are what anybody reads, and they are unchanged to the character.
 * A heartbeat says which is still running, so a long browser run does not look like a hang.
 *
 * `--serial` puts it back, for a box where two Chromium-and-Node processes fight over one core
 * (and for bisecting a failure that only appears under load).
 *
 * AND THE HEADLESS HALF IS CUT INTO SHARES (test/shard.js): one process ran ~990 seconds of
 * suites on one core of fourteen. The shares are cut from the last full run's times
 * (test/suite-times.json, rewritten after every full parallel run), each prints its own
 * tally as `headless [k/N]`, and the sum is printed as the one `headless: X/Y passing` line —
 * which must equal what `node test/headless.js` alone counts, or a chunk ran nowhere. `--quick`
 * is passed through to every share. */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const fs = require('fs');
const FILES = ['headless.js', 'browser.js'];
const quick = process.argv.includes('--quick');
/* half the cores, at most seven: the largest chunk (the ladder) is a seventh of the whole, so
 * an eighth share would only wait on it — and Chromium needs cores of its own beside them */
const SHARES = Math.max(1, Math.min(7, Math.floor(os.cpus().length / 2)));
/* one core cannot run two suites faster than one, and on a single-core box the contention is
 * a real loss rather than a wash — so the parallel path is asked for rather than assumed */
const serial = process.argv.includes('--serial') || os.cpus().length < 2;

/* THE SHARES YIELD TO THE BROWSER. Seven busy Node processes beside Chromium starved it, and
 * fifteen of its timing-sensitive checks (a tap, then a fixed wait, then a read) failed that
 * pass alone 651/651 on the same code — measured 2026-10-18. A share runs at low priority, so
 * it takes only the cores Chromium is not using. */
function run(f, live, args, env, low) {
  return new Promise((res) => {
    const p = spawn(process.execPath, [path.join(__dirname, f)].concat(args || [], quick ? ['--quick'] : []),
                    { stdio: live ? 'inherit' : ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, env || {}) });
    if (low) { try { os.setPriority(p.pid, 15); } catch (e) { /* not permitted: run anyway */ } }
    let out = '';
    if (!live) {
      p.stdout.on('data', (d) => { out += d; });
      p.stderr.on('data', (d) => { out += d; });
    }
    p.on('close', (code) => res({ f, code, out }));
  });
}

(async () => {
  let bad = 0;
  if (serial) {
    for (const f of FILES) { const r = await run(f, true); if (r.code !== 0) bad++; }
  } else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-shards-'));
    const jobs = [{ name: 'browser.js', f: 'browser.js' }];
    for (let k = 0; k < SHARES; k++)
      jobs.push({ name: `headless[${k}/${SHARES}]`, f: 'shard.js', args: [String(k), String(SHARES)],
                  env: { AMBER_TIMES_OUT: path.join(tmp, `t${k}.json`) }, shard: k, low: true });
    const pending = new Set(jobs.map((j) => j.name));
    const t0 = Date.now();
    let pass = 0, total = 0, shardBad = 0, done = 0;
    /* only to a terminal: a redirected run collects the heartbeat as forty copies of itself
     * on one line, which is the sort of thing that makes a log unreadable in CI */
    const beat = process.stderr.isTTY ? setInterval(() => {
      process.stderr.write(`\r  running: ${[...pending].join(' + ')}  ` +
                           `${Math.round((Date.now() - t0) / 1000)}s   `);
    }, 5000) : null;
    /* printed as each finishes, so the first tally is readable while the other is still going */
    await Promise.all(jobs.map((j) => run(j.f, false, j.args, j.env, j.low).then((r) => {
      pending.delete(j.name);
      if (beat) process.stderr.write('\r' + ' '.repeat(90) + '\r');
      let out = r.out;
      if (j.shard != null) {
        const m = /^headless: (\d+)\/(\d+) passing/m.exec(out);
        if (m) { pass += +m[1]; total += +m[2]; done++; }
        out = out.replace(/^headless: /m, `headless [${j.shard}/${SHARES}]: `);
        if (r.code !== 0) shardBad++;
      } else if (r.code !== 0) bad++;
      process.stdout.write(out);
    })));
    if (beat) { clearInterval(beat); process.stderr.write('\r' + ' '.repeat(90) + '\r'); }
    /* THE SUM IS THE CONTROL: a share that crashed before its tally is a missing row here */
    const whole = done === SHARES;
    console.log(`\nheadless: ${pass}/${total} passing` + (pass < total ? `  \x1b[31m${total - pass} FAILING\x1b[0m` : '') +
                `   (${SHARES} shares in ${Math.round((Date.now() - t0) / 1000)}s` +
                (whole ? ')' : `, \x1b[31m${SHARES - done} share(s) reported NO tally\x1b[0m)`));
    if (shardBad || !whole) bad++;
    /* the next plan's times: only from a FULL run — a quick one skips the heavy chunks */
    if (!quick && whole) {
      let times = {};
      try { times = JSON.parse(fs.readFileSync(path.join(__dirname, 'suite-times.json'), 'utf8')); } catch (e) { times = {}; }
      /* REWRITTEN ONLY WHEN IT MATTERS: a new chunk, or one that moved by more than a third and
       * five seconds — otherwise every run would leave a diff in the tree for jitter */
      let moved = false;
      for (let k = 0; k < SHARES; k++) {
        let got = {};
        try { got = JSON.parse(fs.readFileSync(path.join(tmp, `t${k}.json`), 'utf8')); } catch (e) { continue; }
        for (const [nm, v] of Object.entries(got)) {
          const was = times[nm];
          if (was == null || (Math.abs(v - was) > 5 && Math.abs(v - was) > was / 3)) moved = true;
          times[nm] = Math.round(v * 10) / 10;
        }
      }
      if (moved) {
        const sorted = Object.fromEntries(Object.entries(times).sort((a, b) => b[1] - a[1]));
        try { fs.writeFileSync(path.join(__dirname, 'suite-times.json'), JSON.stringify(sorted, null, 1) + '\n'); } catch (e) { /* read-only tree */ }
      }
    }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* tmp is tmp */ }
  }
  console.log(bad ? `\n\x1b[31m${bad} suite(s) failing\x1b[0m\n` : '\n\x1b[32mall suites green\x1b[0m\n');
  /* NOT `process.exit`. Writing a captured suite's whole tally to stdout is ASYNCHRONOUS when
   * stdout is a pipe or a file, and `process.exit` drops whatever is still queued — so a
   * redirected run printed a fragment of one suite, none of the other, and the failure count
   * at the end, which reads exactly like a suite that crashed halfway. Setting the code and
   * letting the process end lets the queue drain. (The old runner never hit this: with
   * `stdio: 'inherit'` the children wrote to the terminal themselves.) */
  process.exitCode = bad ? 1 : 0;
})();

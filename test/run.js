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
 * (and for bisecting a failure that only appears under load). */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const FILES = ['headless.js', 'browser.js'];
/* one core cannot run two suites faster than one, and on a single-core box the contention is
 * a real loss rather than a wash — so the parallel path is asked for rather than assumed */
const serial = process.argv.includes('--serial') || os.cpus().length < 2;

function run(f, live) {
  return new Promise((res) => {
    const p = spawn(process.execPath, [path.join(__dirname, f)],
                    { stdio: live ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
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
    const pending = new Set(FILES);
    const t0 = Date.now();
    /* only to a terminal: a redirected run collects the heartbeat as forty copies of itself
     * on one line, which is the sort of thing that makes a log unreadable in CI */
    const beat = process.stderr.isTTY ? setInterval(() => {
      process.stderr.write(`\r  running: ${[...pending].join(' + ')}  ` +
                           `${Math.round((Date.now() - t0) / 1000)}s   `);
    }, 5000) : null;
    /* printed as each finishes, so the first tally is readable while the other is still going */
    await Promise.all(FILES.map((f) => run(f, false).then((r) => {
      pending.delete(f);
      if (beat) process.stderr.write('\r' + ' '.repeat(60) + '\r');
      process.stdout.write(r.out);
      if (r.code !== 0) bad++;
    })));
    if (beat) { clearInterval(beat); process.stderr.write('\r' + ' '.repeat(60) + '\r'); }
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

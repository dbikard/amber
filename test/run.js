/* test/run.js — the whole suite. `node test/run.js` (there is no package.json, so no `npm test`).
 * Each file runs in its own process so a crash in one cannot hide the other's results. */
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

let bad = 0;
for (const f of ['headless.js', 'browser.js']) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
  if (r.status !== 0) bad++;
}
console.log(bad ? `\n\x1b[31m${bad} suite(s) failing\x1b[0m\n` : '\n\x1b[32mall suites green\x1b[0m\n');
process.exit(bad ? 1 : 0);

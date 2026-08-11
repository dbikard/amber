/* test/browser.js — the half of the game that only exists in a browser: input routing,
 * the camera, the writ overlay, HUD layering, and the back button.
 *
 * Everything here drives REAL pointer/history events against a real page. Screen positions
 * are always asked of the renderer itself (R.project) so a test can never drift away from
 * the projection the player actually sees — that lesson cost several false alarms.
 *
 * Needs Playwright + Chromium. Without them it reports a skip and exits 0, so `node test/run.js`
 * still means something on a machine that has neither. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { suite, ok, report, record, track } = require('./lib.js');

const ROOT = path.join(__dirname, '..');
/* THE PAGE'S CODE IS WHAT THE SERVER SERVES — the js/ files are loaded over HTTP from disk on
 * every navigation, not require()d, so lib.js's require.cache sweep cannot see them. Track
 * each script index.html names (plus index.html itself) now, before the first navigation, so
 * the provenance line pins what the first page-load got and report() screams if an edit lands
 * on disk mid-run — later navigations would silently be testing a different game. */
for (const m of fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/<script src="([^"?]+)/g))
  track(path.join(ROOT, m[1]));
track(path.join(ROOT, 'index.html'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function loadPlaywright() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p); } catch (e) { /* keep looking */ }
  }
  return null;
}

function serve() {
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('no'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res(srv)));
}

/* Wait for the thing you actually care about instead of guessing at a duration. On success
 * this returns as soon as it is true; on failure it costs the timeout and the assertion that
 * follows still reports the real state, so nothing is hidden — it is only faster. */
async function until(pg, fn, ms = 2500) {
  try { await pg.waitForFunction(fn, null, { timeout: ms, polling: 40 }); } catch (e) { /* the assertion speaks */ }
}
const ready = (pg) => until(pg, () => window.Render && window.Render.ready && window.UI && window.Game);
const inMatchNow = (pg) => until(pg, () => !!(window.Game && window.Game.game.mode && window.Game.game.world));

/* ---------------- the board the veil is measured on ----------------
 * SHROUD is ground never seen, FOG is ground seen once and not seen now, SIGHT is ground
 * watched this instant — and a suite about the veil is worthless unless all three are on
 * the screen it reads. Grown worlds would not reliably give them: three suites each hunted
 * a random board for a window holding all three, and each intermittently could not find
 * one — 264 fog cells on one pass, 4 on the next, 0 on a third. That is the SEED deciding
 * whether a suite tests anything, which is not a test.
 *
 * So the board is written down, and so is the eye that lights it: a hand-made spec, an eye
 * that marches to y=1500 and falls back to y=1240, and the world frozen the instant the
 * vision is refreshed. What it saw on the way in is fog, where it stands is sight, past its
 * high-water mark is shroud — at the same coordinates, every run, on every machine. */
const VEIL_BOARD = {
  name: 'the Veil Range', seed: 11, ground: 'PLAIN', height: 0.5,
  paint: [{ rect: [900, 900, 2000, 2400], terra: 'MEADOW' }],
  seats: [{ x: 520, y: 420 }, { x: 1420, y: 1980 }],
  springs: [{ x: 800, y: 560 }, { x: 1180, y: 1820 }, { x: 1500, y: 1150 }]
};
async function veilPage(browser, base, opts) {
  const pg = await browser.newPage(opts);
  const errs = [];
  pg.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await ready(pg);
  await pg.evaluate((spec) => window.Game.startSP('julian', { spec, seed: 1 }), VEIL_BOARD);
  await inMatchNow(pg);
  await until(pg, () => window.Render.ready);
  const scene = await pg.evaluate(() => {
    const w = window.Game.game.world;
    const eye = (yy) => {
      w.units.length = 0;
      for (let i = 0; i < 10; i++)
        w.units.push({ id: 900 + i, owner: 0, kind: 'soldier', x: 1080 + i * 80, y: yy,
                       hp: 70, maxHp: 70, co: 0, cd: 0, goal: null });
      window.World.refreshVision(w, true);
    };
    eye(1500); eye(1240);
    /* freeze AFTER the vision refresh — and keep the real one, because `delete` would not
     * uncover it: `update` is an own property of the World module object, so overwriting it
     * is the only copy there ever was. */
    window.__realUpdate = window.World.update;
    window.World.update = () => {};
    window.Game.game.hints = [];
    const vi = window.Game.game.viewer, vis = w.vis[vi], seen = w.players[vi].seen;
    let s = 0, f = 0, d = 0;
    for (let i = 0; i < vis.g.length; i++) (vis.g[i] ? s++ : seen.g[i] ? f++ : d++);
    return { sight: s, fog: f, shroud: d };
  });
  return { pg, errs, scene };
}

/* open a page, walk the menu, and land in a skirmish against a fixed heir */
async function match(browser, base, renderer) {
  const pg = await browser.newPage({ viewport: { width: 420, height: 860 } });
  const errs = [];
  pg.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await ready(pg);
  await pg.click('#btn-skirmish'); await pg.waitForTimeout(120);
  await pg.evaluate(() => [...document.querySelectorAll('#rivals-body .rival')]
    .find((e) => /julian/i.test(e.textContent)).click());
  await inMatchNow(pg);
  await until(pg, () => window.Game.game.world.units.length >= 0 && window.Render.ready);
  /* One stepper for every suite that fast-forwards. Several of them run the sim minutes
   * ahead, which is long enough for somebody to WIN — and then every later suite is driving
   * the end screen instead of the game. Holding the win conditions open is not cheating: no
   * suite here is about who wins, and the alternative is a flake that surfaces somewhere
   * unrelated. `raising` waits for the masons instead of a fixed span. */
  await pg.evaluate(() => {
    const W = window.World, C = window.CONST;
    window.__step = (secs, opts) => {
      const g = window.Game.game, o = opts || {};
      const ticks = Math.round(secs * 30);
      for (let i = 0; i < ticks; i++) {
        if (o.raising && !g.world.players[0].buildings.some((q) => q.raise > 0)) break;
        if (i % 30 === 0 && !o.letWin) {
          for (const c of g.world.cities) c.hp = c.maxHp;
          for (const p of g.world.players) p.pattern = 0;
        }
        W.update(g.world, C.SIM_DT);
        g.world.events.length = 0;
      }
    };
  });
  return { pg, errs };
}

(async () => {
  const pw = loadPlaywright();
  if (!pw) { console.log('\n  browser suite SKIPPED — Playwright not installed\n'); process.exit(0); }
  let browser;
  try { browser = await pw.chromium.launch(); }
  catch (e) { console.log('\n  browser suite SKIPPED — no Chromium (' + e.message.split('\n')[0] + ')\n'); process.exit(0); }
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;

  /* ---------------- menus, before any match ---------------- */
  {
    suite('menu');
    const pg = await browser.newPage({ viewport: { width: 420, height: 860 } });
    await pg.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await ready(pg);
    const hidden = (id) => pg.evaluate((i) => document.getElementById(i).classList.contains('hidden'), id);
    /* ---- THREE KINDS OF THING, THREE SHAPES ----
     * Reported from play: "a lot of things that are very different in nature are represented
     * the same way, and it gets very cluttered when skirmish is selected." Every line was the
     * same gold pill — a setting, three modes, five rivals, a codex — and two of the modes
     * unfolded INLINE, so choosing one pushed the rest of the menu down the page. Anything
     * with a second step is a screen now. */
    const shape = await pg.evaluate(() => ({
      folds: document.querySelectorAll('#menu #skirmish-row, #menu #lan-panel').length,
      cards: document.querySelectorAll('#menu .mcard').length,
      primary: document.querySelectorAll('#menu .mcard.primary').length,
      links: document.querySelectorAll('#menu .mfoot .mlink').length,
      heirsOnMenu: document.querySelectorAll('#menu [data-heir]').length
    }));
    ok('nothing unfolds on the menu any more', shape.folds === 0, String(shape.folds));
    ok('...the ways to play are cards, one of them primary',
       shape.cards === 3 && shape.primary === 1, JSON.stringify(shape));
    ok('...the rivals are not on it at all', shape.heirsOnMenu === 0, String(shape.heirsOnMenu));
    ok('...and the codex is a link rather than a fourth way to play', shape.links >= 1, String(shape.links));

    await pg.click('#btn-skirmish'); await pg.waitForTimeout(200);
    ok('SKIRMISH opens a screen of rivals', !(await hidden('rivals')) && (await hidden('menu')));
    await pg.click('#rivals-close'); await pg.waitForTimeout(200);
    ok('...with a way back to the menu', (await hidden('rivals')) && !(await hidden('menu')));
    await pg.click('#btn-lan'); await pg.waitForTimeout(200);
    ok('LAN opens a screen of its own', !(await hidden('lan-screen')) && (await hidden('menu')));
    await pg.click('#lan-close'); await pg.waitForTimeout(200);
    ok('...and that comes back too', (await hidden('lan-screen')) && !(await hidden('menu')));

    /* THE FOOTING GOVERNS BOTH MODES. It used to live inside the skirmish fold-out, which
     * said — wrongly — that it had nothing to do with the campaign, and the ladder ran on a
     * private ramp no menu ever mentioned. */
    const diff = await pg.evaluate(() => {
      const C = window.CONST;
      const btns = [...document.querySelectorAll('#footing-row .diff')];
      const before = window.UI.difficulty();
      return { n: btns.length, before, dflt: C.DIFFICULTY_DEFAULT,
               marked: btns.filter((b) => b.classList.contains('on')).map((b) => b.dataset.key),
               keys: btns.map((b) => b.dataset.key),
               labelled: !!document.querySelector('#footing-row .set-label'),
               onMenu: !!document.querySelector('#menu #footing-row'),
               visible: !document.getElementById('footing-row').classList.contains('hidden') };
    });
    ok('every footing is offered', diff.n >= 3 && diff.n === diff.keys.length, diff.keys.join(','));
    /* it governs the campaign and a skirmish alike, so it is on the menu itself — and it is
     * LABELLED, or three unmarked pills between the title and the modes read as three more
     * ways to play, which is half of what made the old menu unreadable */
    ok('and offered on the menu, labelled as the setting it is',
       diff.onMenu && diff.visible && diff.labelled, JSON.stringify(diff));
    ok('one is marked, and it is the remembered choice', diff.marked.length === 1 && diff.marked[0] === diff.before,
       `marked ${diff.marked} vs ${diff.before}`);
    ok('which defaults to something short of full strength', diff.before === diff.dflt && diff.dflt !== 'prince',
       diff.before);

    /* it reaches a SKIRMISH... */
    await pg.evaluate(() => { window.UI.setDifficulty('squire'); });
    await pg.click('#btn-skirmish'); await pg.waitForTimeout(200);
    await pg.evaluate(() => [...document.querySelectorAll('#rivals-body .rival')]
      .find((e) => /julian/i.test(e.textContent)).click());
    await inMatchNow(pg);
    const applied = await pg.evaluate(() => {
      const C = window.CONST, g = window.Game.game;
      return { eco: g.world.players[1].eco, mine: g.world.players[0].eco, want: C.DIFFICULTY.squire.eco };
    });
    ok('the chosen handicap reaches the heir', applied.eco === applied.want, `eco ${applied.eco}`);
    ok('and never touches your own side', applied.mine === 1, `eco ${applied.mine}`);

    /* ...AND THE CAMPAIGN, which used to ignore the footing entirely. It is CHAPTERS now, so
     * the button opens a list and the list opens a briefing — the objective is stated before
     * the board is. The footing still has to reach the chapter's rival, which is the thing this
     * suite is actually about: a chapter merges its own `opts` OVER the player's footing, so it
     * may hold a rival back without taking the footing away. */
    await pg.evaluate(() => { window.Game.toMenu(); });
    await pg.waitForTimeout(300);
    const camp = await pg.evaluate(async () => {
      const C = window.CONST, CAM = window.CAMPAIGN;
      CAM.reset();
      window.UI.setDifficulty('prince');
      window.Game.toMenu();
      document.getElementById('btn-campaign').click();
      await new Promise((res) => setTimeout(res, 200));
      const listShown = !document.getElementById('chapters').classList.contains('hidden');
      /* the LAST chapter carries no eco of its own, so the footing reaches it untouched */
      const last = CAM.CHAPTERS[CAM.CHAPTERS.length - 1];
      window.Game.startChapter(last.key);
      await new Promise((res) => setTimeout(res, 500));
      const g = window.Game.game;
      return { listShown, eco: g.world.players[1].eco,
               want: (last.opts && last.opts.eco != null) ? last.opts.eco : C.DIFFICULTY.prince.eco,
               rival: g.names[1], wantRival: last.heir, campaign: g.campaign,
               chapter: g.chapter && g.chapter.key, wantChapter: last.key };
    });
    ok('the campaign button opens the chapters rather than a match', camp.listShown, String(camp.listShown));
    ok('a chapter runs on the footing, with its own overrides on top',
       camp.eco === camp.want && camp.campaign, `eco ${camp.eco}, wanted ${camp.want}`);
    ok('...against the rival that chapter names',
       new RegExp(camp.wantRival, 'i').test(camp.rival) && camp.chapter === camp.wantChapter,
       `${camp.rival} / ${camp.chapter}, wanted ${camp.wantRival} / ${camp.wantChapter}`);

    /* THE MENU NAMES THE CHAPTER, NOT THE HEIR — a rung had nothing to say about itself except
     * whom you would face, and the whole point of the change is that those are two questions. */
    const label = await pg.evaluate(async () => {
      const CAM = window.CAMPAIGN;
      CAM.reset();
      window.Game.toMenu();
      await new Promise((res) => setTimeout(res, 200));
      const fresh = { label: document.getElementById('campaign-chapter').textContent,
                      note: document.getElementById('campaign-note').textContent };
      for (const c2 of CAM.CHAPTERS) CAM.clear(c2.key);
      window.Game.toMenu();
      await new Promise((res) => setTimeout(res, 200));
      const done = { label: document.getElementById('campaign-chapter').textContent,
                     note: document.getElementById('campaign-note').textContent };
      CAM.reset();
      return { fresh, done, first: CAM.CHAPTERS[0].title };
    });
    /* THE CARD NAMES THE CHAPTER on a line of its own. It used to be the button's whole label —
     * "THE SUCCESSION — VI · THE THRONE", shouted across two wrapped lines — with the progress
     * as a stray row of ticks underneath. What it IS, which chapter is next, and how far along
     * you are are three different facts and they are three lines. */
    ok('the menu offers the first chapter by name',
       label.fresh.label.indexOf(label.first) >= 0, label.fresh.label);
    ok('...and counts how many are done', /0 of \d/.test(label.fresh.note), label.fresh.note);
    ok('a succession all cleared offers the walk again', /again/i.test(label.done.label), label.done.label);
    ok('...and says so in the count', /(\d+) of \1/.test(label.done.note), label.done.note);

    await pg.evaluate(() => {
      window.UI.setDifficulty(window.CONST.DIFFICULTY_DEFAULT);
      window.CAMPAIGN.reset();
      window.Game.toMenu();
    });
    await pg.waitForTimeout(400);

    /* ---------------- THE MUSTER ROLL ----------------
     * A fork is permanent, made mid-match, from a card the size of a thumb — so the place to
     * learn what the choice MEANS is a screen you read before the match. Its whole value is
     * that it comes out of CONST, so every count here is derived the same way: a codex with
     * its own copy of the numbers is worse than no codex. */
    suite('the muster roll');
    /* clicked through the DOM rather than by Playwright's pointer: the menu is a scrolling
     * column and by this point in the suite the button is below the fold, which is a fact
     * about the viewport rather than about the screen under test */
    const tapRoll = () => pg.evaluate(() => document.getElementById('btn-roll').click());
    await tapRoll();
    await until(pg, () => !document.getElementById('roll').classList.contains('hidden'));
    const roll = await pg.evaluate(() => {
      const C = window.CONST;
      const forking = Object.keys(C.BUILDINGS).filter((bt) => C.BUILDINGS[bt].branches);
      const body = document.getElementById('roll-body');
      const txt = body.textContent;
      const cards = [...body.querySelectorAll('.man')];
      const men = cards.filter((c2) => c2.dataset.kind).map((c2) => c2.dataset.kind);
      const seen = {}, twice = [];
      for (const k of men) { if (seen[k]) twice.push(k); seen[k] = 1; }
      /* a branch is IN the roll either as the man it musters or, when it musters nobody, as
       * the work itself — and every one of them has to be one or the other */
      const branchNames = [];
      for (const bt of forking)
        for (const k of C.BUILDINGS[bt].branchUI) branchNames.push(C.BUILDINGS[bt].branches[k].name);
      return {
        open: !document.getElementById('roll').classList.contains('hidden'),
        menuHidden: document.getElementById('menu').classList.contains('hidden'),
        halls: body.querySelectorAll('.roll-hall').length,
        wantHalls: forking.length + 1,                       // ...plus the men nobody musters
        cards: cards.length,
        men, twice,
        wantMen: Object.keys(C.UNITS).length,
        branchesNamed: branchNames.filter((n) => txt.indexOf(n) < 0),
        named: Object.keys(C.UNITS).every((k) => txt.indexOf(C.UNITS[k].name) >= 0),
        /* NOTHING IS OPEN UNTIL SOMETHING IS TAPPED: a codex you can look things up in is a
         * grid, and the prose belongs to the one card you asked about */
        opened: body.querySelectorAll('.man-open').length
      };
    });
    ok('the roll opens over the menu', roll.open && roll.menuHidden);
    ok('every forking work is in it, and nothing is hard-coded', roll.halls === roll.wantHalls,
       `${roll.halls} sections, wanted ${roll.wantHalls}`);
    /* ---- EVERY MAN ONCE, AND ONCE ONLY ----
     * Reported from play with a picture: nine of the eleven kinds had a full card under their
     * hall and a SECOND full card, same prose and all, under a catch-all that listed every man
     * in the game. A codex that repeats itself is a codex you scroll rather than read. */
    ok('every man in the table has a card', roll.men.length >= roll.wantMen,
       `${roll.men.length} cards for ${roll.wantMen} kinds`);
    ok('...and none of them has two', roll.twice.length === 0, roll.twice.join(','));
    ok('...and every branch is named, as its man or as the work itself',
       roll.branchesNamed.length === 0, roll.branchesNamed.join(','));
    ok('each one called what the table calls it', roll.named);
    ok('the roll opens as a grid, with nothing expanded', roll.opened === 0, String(roll.opened));

    /* ---- WHAT A CARD SAYS WHEN YOU OPEN IT ----
     * The old codex printed every field of every man on a wall of full-width cards, and this
     * is the assertion that kept it honest: every NUMBER a unit def carries must reach the
     * screen, because a codex with its own copy of the numbers is worse than no codex. It has
     * to open each man now, which also tests the thing the grid is for. */
    const fields = await pg.evaluate(async () => {
      const C = window.CONST;
      const base = new Set(['name', 'icon', 'blurb', 'hp', 'dmg', 'atk', 'range', 'speed',
                            'aggro', 'bounty', 'size', 'cost', 'keep']);
      const frame = () => new Promise((r) => requestAnimationFrame(r));
      const miss = [], noCard = [], noBlurb = [];
      let checked = 0, saysStone = false, saysWalls = false, saysMend = false;
      for (const k of Object.keys(C.UNITS)) {
        const card = document.querySelector(`#roll-body .man[data-kind="${k}"]`);
        if (!card) { noCard.push(k); continue; }
        card.click();
        await frame();
        const panel = document.querySelector('#roll-body .man-open');
        const txt = panel ? panel.textContent : '';
        if (C.UNITS[k].blurb && txt.indexOf(C.UNITS[k].blurb.slice(0, 24)) < 0) noBlurb.push(k);
        if (/besieges nothing/.test(txt) && /strikes a Shrine/.test(txt)) saysStone = true;
        if (/parapet/.test(txt) && /shelters inside a tower/.test(txt)) saysWalls = true;
        if (/mends/.test(txt)) saysMend = true;
        for (const f of Object.keys(C.UNITS[k])) {
          if (base.has(f)) continue;
          const v = C.UNITS[k][f];
          if (typeof v !== 'number' || !v) continue;
          checked++;
          if (txt.indexOf(String(v)) < 0 && txt.indexOf(String(Math.round(v * 100))) < 0)
            miss.push(k + '.' + f + '=' + v);
        }
        card.click();                       // shut it again: one open at a time is the rule
        await frame();
      }
      return { miss, noCard, noBlurb, checked, saysStone, saysWalls, saysMend,
               leftOpen: document.querySelectorAll('#roll-body .man-open').length };
    });
    ok('every man in the table has a card of his own', fields.noCard.length === 0, fields.noCard.join(','));
    ok('...which says his piece when it is opened', fields.noBlurb.length === 0, fields.noBlurb.join(','));
    ok('and every NUMBER his entry carries reaches that card',
       fields.miss.length === 0 && fields.checked > 0,
       `${fields.checked} checked; missing: ${fields.miss.join(', ') || 'none'}`);
    ok('and what a shooter cannot do is said in words',
       fields.saysStone && fields.saysWalls && fields.saysMend,
       `stone ${fields.saysStone} walls ${fields.saysWalls} mend ${fields.saysMend}`);
    ok('a second tap shuts the card again', fields.leftOpen === 0, String(fields.leftOpen));

    /* ---- LEVEL ONE ON THE LEFT, WHAT IT BECOMES ON THE RIGHT ----
     * A forking work is one decision with two sides, and the layout says so rather than
     * leaving the reading to the reader. */
    const cols = await pg.evaluate(() => {
      const C = window.CONST, bad = [];
      for (const hall of document.querySelectorAll('#roll-body .roll-hall')) {
        const cs = hall.querySelectorAll('.roll-col');
        if (cs.length !== 2) { bad.push('columns:' + cs.length); continue; }
        const head = hall.querySelector('.roll-head').textContent;
        const bt = Object.keys(C.BUILDINGS).find((k) => C.BUILDINGS[k].branches &&
                                                        head.indexOf(C.BUILDINGS[k].name) >= 0);
        if (!bt) continue;                                   // the section for what nobody musters
        const left = cs[0].querySelectorAll('.man').length;
        const right = [...cs[1].querySelectorAll('.man')];
        if (left !== 1) bad.push(bt + ' has ' + left + ' at level 1');
        if (right.length !== C.BUILDINGS[bt].branchUI.length)
          bad.push(bt + ' offers ' + right.length + ' of ' + C.BUILDINGS[bt].branchUI.length);
      }
      return bad;
    });
    ok('every hall shows its level 1 on the left and its upgrades on the right',
       cols.length === 0, cols.join(' · '));

    /* ---- AND EVERY LEVEL, WITH ITS NUMBERS ----
     * A LEVEL BUYS BETTER MEN, NOT MORE OF THEM: `CONST.TIER` multiplies hit points, blow and
     * price, and the codex used to print one man at tier one and leave the rest to a multiplier
     * written down nowhere a player can see. Which levels a man exists at falls out of the fork
     * — a hall is RE-RAISED around a branch, so its own recruit lives below it and the branch's
     * above — and it caught a real thing the moment it was drawn: the Archer's card quoted him
     * at 42 hp for a man the game musters at 53. The assertion recomputes every cell from
     * `CONST` rather than pinning a number, so a retune moves both together or fails here. */
    const levels = await pg.evaluate(async () => {
      const C = window.CONST;
      const frame = () => new Promise((r) => requestAnimationFrame(r));
      const bad = [], checked = [];
      for (const card of [...document.querySelectorAll('#roll-body .man[data-kind][data-bt]')]) {
        const kind = card.dataset.kind, bt = card.dataset.bt, key = card.dataset.br || null;
        const d = C.BUILDINGS[bt], u = C.UNITS[kind];
        const fork = d.fork || C.MAX_LEVEL + 1;
        const want = [];
        for (let L = key ? fork : 1; L <= (key ? C.MAX_LEVEL : Math.min(C.MAX_LEVEL, fork - 1)); L++)
          want.push(L);
        card.click();
        await frame();
        const rows = [...document.querySelectorAll('#roll-body .man-open .mo-levels tr')].slice(1);
        if (rows.length !== want.length) {
          bad.push(`${kind}: ${rows.length} rows for levels ${want.join(',')}`);
        } else {
          want.forEach((L, i) => {
            const cells = [...rows[i].querySelectorAll('td')].map((t) => t.textContent.trim());
            const m = C.TIER[L - 1];
            if (cells[0] !== String(L)) bad.push(`${kind} row ${i} says level ${cells[0]}`);
            if (cells[2] !== String(Math.round(u.hp * m))) bad.push(`${kind} lv${L} hp ${cells[2]} want ${Math.round(u.hp * m)}`);
            if (cells[3] !== String(+(u.dmg * m).toFixed(1))) bad.push(`${kind} lv${L} blow ${cells[3]} want ${+(u.dmg * m).toFixed(1)}`);
            if (cells[4].indexOf(String(Math.round(u.cost * m))) < 0) bad.push(`${kind} lv${L} price ${cells[4]} want ${Math.round(u.cost * m)}`);
          });
          checked.push(kind + ':' + want.length);
        }
        card.click();
        await frame();
      }
      return { bad, checked };
    });
    ok('every man\'s card carries a row for each level he exists at, computed from CONST.TIER',
       levels.bad.length === 0 && levels.checked.length > 0,
       `${levels.checked.join(' ')} — ${levels.bad.join(' · ') || 'all agree with CONST.TIER'}`);

    /* AND THE SMALL CARD QUOTES A LEVEL HE CAN ACTUALLY BE AT. A branch's recruit does not
     * exist below the fork, so tier one is a man the game never musters. */
    const quoted = await pg.evaluate(() => {
      const C = window.CONST, bad = [];
      for (const card of [...document.querySelectorAll('#roll-body .man[data-kind][data-bt]')]) {
        const d = C.BUILDINGS[card.dataset.bt], u = C.UNITS[card.dataset.kind];
        const first = card.dataset.br ? (d.fork || 1) : 1;
        const m = C.TIER[first - 1];
        const txt = card.querySelector('.m-nums').textContent;
        if (txt.indexOf(String(Math.round(u.hp * m))) < 0)
          bad.push(`${card.dataset.kind}: "${txt}" wants ${Math.round(u.hp * m)} hp at level ${first}`);
      }
      return bad;
    });
    ok('...and his small card quotes him at the lowest level he exists at',
       quoted.length === 0, quoted.join(' · '));

    /* ---------------- the figures ----------------
     * Each man in the round, turning. ONE WebGL context for the whole list — a canvas per row
     * would run a phone out of live contexts halfway down it — so what is asserted is the loop
     * (it runs, it draws, it tracks the rows as they scroll) and, hardest and most important,
     * that it STOPS: a leaked rAF behind a hidden panel looks exactly like a feature that
     * works. If the glass refuses, the roll keeps its glyphs and says nothing, and that path
     * is asserted too rather than assumed. */
    /* ONE FIGURE, IN THE CARD THAT IS OPEN. The whole list used to turn at once — eighteen men
     * in eighteen scissor rectangles every frame, on a phone, and seventeen of them in cards
     * nobody had asked about. The figure belongs to the opened card, so the loop should not be
     * running at all until one is. */
    const idle = await pg.evaluate(async () => {
      const R = window.Render;
      const a = R.debugRollLoop();
      for (let i = 0; i < 4; i++) await new Promise((res) => requestAnimationFrame(res));
      return { berths: document.querySelectorAll('#roll-body .c-fig').length,
               moved: R.debugRollLoop() - a };
    });
    ok('a closed grid has no berth and no loop', idle.berths === 0 && idle.moved === 0,
       `${idle.berths} berths, ${idle.moved} frames`);
    await pg.evaluate(() => document.querySelector('#roll-body .man[data-kind="soldier"]').click());
    await until(pg, () => window.Render && window.Render.debugRollLoop
                       && window.Render.debugRollLoop() > 2);
    const figs = await pg.evaluate(() => {
      const R = window.Render, C = window.CONST;
      const slots = [...document.querySelectorAll('#roll-body .c-fig')];
      return { live: document.getElementById('roll').classList.contains('figs'),
               canvas: !!document.getElementById('roll-figs'),
               slots: slots.length,
               named: slots.every((e) => !e.dataset.kind || !!C.UNITS[e.dataset.kind]),
               frames: R.debugRollLoop(), drew: R.debugRollDraws(),
               hasFigure: !!R.rollFigure && !!R.rollFigure('soldier') };
    });
    ok('the opened card carries exactly one berth for its figure', figs.slots === 1,
       `${figs.slots} berths`);
    ok('...naming a man the table has', figs.named);
    ok('the figure is the game\'s own model, not a second copy of it', figs.hasFigure);
    if (figs.live) {
      ok('the loop runs while the roll is open', figs.frames > 2, `${figs.frames} frames`);
      ok('...and puts a figure on the glass', figs.drew > 0, `${figs.drew} drawn`);
      /* ---- AND HE IS DRAWN IN HIS OWN CARD ----
       * Reported from play with a picture: one man half again too tall, straddling a card two
       * rows below his own. The mapping from a row's DOM rectangle to a GL viewport was made
       * against `window.innerWidth/innerHeight` while the canvas's box comes from CSS
       * (`position:fixed; inset:0`) — on a phone those are two different heights, because the
       * address bar is inside one of them and not the other. The buffer was then made SHORTER
       * than the box it is stretched into, which both magnifies every figure and slides it
       * down the page. A desktop viewport hides the whole thing: there the two agree exactly.
       * So the suite MAKES them disagree, which is the only way to test this at all. */
      const placed = await pg.evaluate(async () => {
        const cv = document.getElementById('roll-figs');
        const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const read = async () => {
          await frame();
          const cr = cv.getBoundingClientRect();
          const slots = [...document.querySelectorAll('#roll-body .c-fig')];
          const rects = window.Render.debugRollRects();
          let worst = -1, sample = '', n = 0, oldGap = 0;
          rects.forEach((vp, i) => {
            const el = slots[i];
            if (!vp || !el || el.dataset.kind !== vp.kind) return;
            const r = el.getBoundingClientRect();
            /* what the viewport MUST be, converted here from the DOM rather than handed over */
            const wantX = r.left - cr.left, wantYb = cr.bottom - r.bottom;
            const d = Math.max(Math.abs(vp.x - wantX), Math.abs(vp.yb - wantYb),
                               Math.abs(vp.w - r.width), Math.abs(vp.h - r.height));
            /* ...and what the window-based mapping would have said instead */
            oldGap = Math.max(oldGap, Math.abs((window.innerHeight - r.bottom) - wantYb));
            n++;
            if (d > worst) {
              worst = d;
              sample = `${vp.kind} drawn at ${vp.x},${vp.yb} ${vp.w}x${vp.h}; its card is at ` +
                       `${wantX.toFixed(0)},${wantYb.toFixed(0)} ${r.width.toFixed(0)}x${r.height.toFixed(0)}`;
            }
          });
          return { n, worst, sample, oldGap, canvasH: cr.height, innerH: window.innerHeight };
        };
        const level = await read();
        /* the canvas box and the window now disagree by a quarter of a screen, exactly as a
         * phone's address bar makes them disagree */
        cv.style.height = Math.round(window.innerHeight * 1.25) + 'px';
        const skewed = await read();
        cv.style.height = '';
        await frame();
        return { level, skewed };
      });
      ok('the rig is alive: figures are being placed, and the skew really does move the box',
         placed.level.n > 0 && placed.skewed.n > 0 && placed.skewed.oldGap > 20,
         `${placed.level.n} placed; the window-based mapping is off by ` +
         `${placed.skewed.oldGap.toFixed(0)}px once the canvas and the window disagree`);
      ok('each man is drawn in his own card, to the pixel', placed.level.worst <= 1,
         placed.level.sample);
      /* THE ASSERTION THAT FAILS ON THE OLD CODE */
      ok('...and still is when the canvas box and the window disagree, as they do on a phone',
         placed.skewed.worst <= 1,
         `canvas ${placed.skewed.canvasH.toFixed(0)} tall against a window of ` +
         `${placed.skewed.innerH} — ${placed.skewed.sample}`);
      /* HE TRACKS HIS CARD. The roll is a long scroll and the rectangle is asked for every
       * frame, so a figure must follow his own card up the page and stop being drawn when it
       * has gone — which is the same rule that used to be tested across eighteen rows. */
      const scrolled = await pg.evaluate(async () => {
        const el = document.getElementById('roll');
        const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        await frame();
        /* `debugRollDraws` is what the LAST FRAME drew, not a running total — it is zeroed at
         * the top of every tick — so these are readings, not deltas */
        const before = window.Render.debugRollDraws();
        el.scrollTop = el.scrollHeight;        // his card is now far above the fold
        await frame(); await frame();
        const away = window.Render.debugRollDraws();
        el.scrollTop = 0;
        await frame(); await frame();
        return { before, away, back: window.Render.debugRollDraws() };
      });
      ok('the rig is alive: he was on the glass before the scroll', scrolled.before > 0,
         `${scrolled.before} drawn`);
      ok('...and is not drawn once his card has scrolled away', scrolled.away === 0,
         `${scrolled.away} drawn with the card off screen`);
      ok('...and is drawn again when it comes back', scrolled.back > 0, `${scrolled.back} drawn`);
    } else {
      /* the documented fallback: no context, no `figs` class, and the glyph that was always
       * there is still there and still legible */
      const glyphs = await pg.evaluate(() =>
        [...document.querySelectorAll('#roll-body .c-fig')].every((e) => e.textContent.trim().length > 0));
      ok('with no figures the roll keeps its glyphs and says nothing about it', glyphs,
         'WebGL declined — the icon fallback stands');
    }

    /* it must be dismissable BOTH ways: the button, and the phone's back gesture — which at
     * the menu is a layer nothing had armed before this screen existed */
    await pg.evaluate(() => document.getElementById('roll-close').click());
    await until(pg, () => document.getElementById('roll').classList.contains('hidden'));
    ok('CLOSE puts the menu back', await hidden('roll') && !(await hidden('menu')));
    /* THE LOOP IS OFF, not merely out of sight. Measured as a frame counter that does not move
     * across four real animation frames of the page — the one thing a leaked rAF cannot fake. */
    const stopped = await pg.evaluate(async () => {
      const R = window.Render;
      const a = R.debugRollLoop();
      for (let i = 0; i < 4; i++) await new Promise((res) => requestAnimationFrame(res));
      await new Promise((res) => setTimeout(res, 200));
      return { a, b: R.debugRollLoop(), running: R.debugRollRunning() };
    });
    ok('closing the roll stops its loop dead', stopped.a === stopped.b && !stopped.running,
       `${stopped.a} -> ${stopped.b}`);
    await tapRoll();
    await until(pg, () => !document.getElementById('roll').classList.contains('hidden'));
    await pg.goBack(); await pg.waitForTimeout(300);
    ok('and so does the back button, without leaving the game',
       (await hidden('roll')) && !(await hidden('menu')) &&
       (await pg.evaluate(() => !!window.UI)), 'the page survived');

    await pg.close();
  }

  /* There is one renderer now. This still buffers its own rows and timings rather than
   * writing to the shared reporter — it costs nothing, and it is what a second renderer, or a
   * second viewport size, would need in order to run alongside it. */
  async function runRenderer(r) {
    const rows = [], times = [];
    let group = '', markAt = Date.now();
    const suite = (name) => {
      if (group) times.push([group, Date.now() - markAt]);
      markAt = Date.now(); group = name;
    };
    const ok = (name, cond, detail) => {
      rows.push({ group, name, pass: !!cond, detail: detail == null ? '' : String(detail) });
      return !!cond;
    };
    const { pg, errs } = await match(browser, base, r);
    const sheetOpen = () => pg.evaluate(() => window.UI.sheetOpen());
    const inMatch = () => pg.evaluate(() => !!window.Game.game.mode);
    /* Centre on the Seat, then hand back the screen point of a world offset from it — panned
     * clear of the sheet if one is up. A tap that lands ON the sheet never reaches the canvas,
     * which looks exactly like a broken input path and is not one. */
    const nearSeat = (ox, oy) => pg.evaluate(([a, b]) => {
      const R = window.Render, g = window.Game.game;
      const c = g.world.map.sites[g.world.map.cities[0]];
      g.world.players[0].essence = 9000;
      R.lookAt(c.x, c.y);
      const sh = document.getElementById('sheet');
      const lid = sh.classList.contains('hidden') ? window.innerHeight - 20 : sh.getBoundingClientRect().top - 40;
      let s = R.project(c.x + a, c.y + b);
      for (let i = 0; i < 90 && s.y > lid; i++) { R.pan(0, -20); s = R.project(c.x + a, c.y + b); }
      /* the offset is a starting guess: works and springs accumulate as a match runs, so walk
       * outward until the renderer agrees there is nothing but ground under the finger */
      const bare = (p) => R.hitBuilding(p.x, p.y) < 0 && R.hitSite(p.x, p.y, g.world, 0, false) < 0
        && R.hitUnit(p.x, p.y, 0) === 0;
      /* SWEEP ANGLES AS WELL AS DISTANCE, and say so if nothing bare was found. The old walk
       * only pushed straight outward and, when no candidate fitted on screen, returned the
       * last point it had whether it was bare or not — so a caller could be handed a spot on
       * a SITE and get a site sheet where it expected bare ground. It failed about one run in
       * three, which is worse than failing every time. */
      const fits = (q) => q.y < lid && q.y > 80 && q.x > 20 && q.x < window.innerWidth - 20;
      if (!bare(s)) {
        let found = null;
        const base = Math.atan2(b, a), rad0 = Math.hypot(a, b);
        for (let k = 0; k < 14 && !found; k++) {
          for (let t = 0; t < 12 && !found; t++) {
            const th = base + (t % 2 ? 1 : -1) * Math.ceil(t / 2) * 0.5;
            const rr = rad0 * (1 + k * 0.16);
            const q = R.project(c.x + Math.cos(th) * rr, c.y + Math.sin(th) * rr);
            if (fits(q) && bare(q)) found = q;
          }
        }
        if (found) s = found;
      }
      /* AND CLEAR IT OF YOUR OWN MEN. A tap on a soldier picks up his standard now, so a
       * point that was bare when it was chosen stops being bare the moment the army wanders
       * over it — which it does, between one tap and the next. */
      const w3 = R.toWorld(s.x, s.y, 0);
      for (let i = g.world.units.length - 1; i >= 0; i--) {
        const u = g.world.units[i];
        if (u.owner === 0 && Math.hypot(u.x - w3.x, u.y - w3.y) < 70) g.world.units.splice(i, 1);
      }
      return { x: s.x, y: s.y, lid: Math.round(lid), bare: bare(s) };
    }, [ox, oy]);

    /* ---------------- camera ---------------- */
    suite(`${r} · camera`);
    const corner = await pg.evaluate(() => {
      const R = window.Render;
      R.lookAt(60, 60);
      const s = R.project(60, 60);
      return { sx: Math.round(s.x), sy: Math.round(s.y) };
    });
    ok(`a Seat in the corner can be brought to the middle`,
       corner.sx > 60 && corner.sx < 360 && corner.sy > 80 && corner.sy < 780,
       `lookAt(60,60) -> screen ${corner.sx},${corner.sy}`);
    const far = await pg.evaluate(() => {
      const R = window.Render, C = window.CONST;
      R.lookAt(C.MAP.W - 60, C.MAP.H - 60);
      const s = R.project(C.MAP.W - 60, C.MAP.H - 60);
      return { sx: Math.round(s.x), sy: Math.round(s.y) };
    });
    ok('and so can the opposite corner', far.sx > 60 && far.sx < 360 && far.sy > 80 && far.sy < 780,
       `-> screen ${far.sx},${far.sy}`);

    /* measure how big a fixed stretch of ground looks — unambiguous under perspective,
     * unlike sampling a row of screen pixels */
    const z = await pg.evaluate(() => {
      const R = window.Render, C = window.CONST;
      const cx = C.MAP.W / 2, cy = C.MAP.H / 2;
      const span = () => { R.lookAt(cx, cy); return Math.abs(R.project(cx + 100, cy).x - R.project(cx - 100, cy).x); };
      R.setZoom(1); const at1 = span();
      R.setZoom(2.2); const zin = span();
      R.setZoom(C.VIEW.min); const zout = span();
      R.setZoom(1);
      return { at1: Math.round(at1), zin: Math.round(zin), zout: Math.round(zout) };
    });
    ok('zooming in magnifies the ground', z.zin > z.at1 * 1.4, `200 units span ${z.at1}px -> ${z.zin}px`);
    ok('zooming out shrinks it', z.zout < z.at1 * 0.92, `${z.at1}px -> ${z.zout}px at the floor`);

    /* The camera must put the point you asked for in the MIDDLE of the screen, at every
     * zoom. Under perspective this is not free: the rig aims at the y=0 plane while what you
     * see is the raised ground, and the error is constant in world units — so it barely shows
     * zoomed out and is enormous zoomed in. Measure it in world units, at a spot deliberately
     * chosen on high ground. */
    const centred = await pg.evaluate(() => {
      const R = window.Render, C = window.CONST, g = window.Game.game;
      /* The highest INTERIOR ground we can find — the worst case for the plane-vs-ground gap.
       * It has to be well inside the world: at the rim the camera clamps and no amount of
       * correction can bring the point to the middle, which is by design. */
      const nav = g.world.nav; let best = -1, bx = C.MAP.W / 2, by = C.MAP.H / 2;
      for (let i = 0; i < nav.elev.length; i++) {
        const x = ((i % nav.W) + 0.5) * nav.cw, y = ((i / nav.W | 0) + 0.5) * nav.cw;
        if (x < 700 || y < 700 || x > C.MAP.W - 700 || y > C.MAP.H - 700) continue;
        if (nav.elev[i] > best) { best = nav.elev[i]; bx = x; by = y; }
      }
      const out = [];
      for (const zm of [C.VIEW.min, 1, 2.2]) {
        R.setZoom(zm); R.lookAt(bx, by);
        const c = R.toWorld(window.innerWidth / 2, window.innerHeight / 2);
        const v = R.viewRect();
        out.push({ zm, off: c ? Math.round(Math.hypot(c.x - bx, c.y - by)) : -1,
                   w: Math.round(v.x1 - v.x0),
                   inside: !!c && bx >= v.x0 && bx <= v.x1 && by >= v.y0 && by <= v.y1 });
      }
      R.setZoom(1);
      return { out, elev: Math.round(best) };
    });
    for (const v of centred.out) {
      ok(`lookAt centres its target at zoom ${v.zm}`, v.off >= 0 && v.off < 60,
         `off by ${v.off} world units (on ground ${centred.elev} high)`);
      ok(`the viewfinder contains what is on screen at zoom ${v.zm}`, v.inside);
    }
    ok('the viewfinder narrows as you zoom in',
       centred.out[0].w > centred.out[1].w && centred.out[1].w > centred.out[2].w,
       centred.out.map((v) => v.w).join(' > '));

    const pinch = await pg.evaluate(() => {
      const cvs = document.getElementById('game'), R = window.Render;
      R.setZoom(1);
      const ev = (t, id, x, y) => cvs.dispatchEvent(new PointerEvent(t, { pointerId: id, clientX: x, clientY: y, bubbles: true }));
      ev('pointerdown', 1, 160, 400); ev('pointerdown', 2, 260, 400);
      ev('pointermove', 1, 100, 400); ev('pointermove', 2, 320, 400);
      const after = R.zoom;
      ev('pointerup', 1, 100, 400); ev('pointerup', 2, 320, 400);
      return after;
    });
    ok('a pinch drives the zoom end to end', pinch > 1.4, `zoom 1 -> ${pinch.toFixed(2)}`);

    /* ---------------- the writ ---------------- */
    suite(`${r} · the writ`);
    const agree = await pg.evaluate(() => {
      const T = window.Terrain, W = window.World, g = window.Game.game;
      const anchors = T.claimAnchors({ map: g.world.map, players: g.world.players }, 0);
      const segs = T.claimOutline(anchors);
      const seat = g.world.map.sites[g.world.map.cities[0]];
      let wrongIn = 0, wrongOut = 0;
      for (const [x1, y1] of segs) {
        const ang = Math.atan2(y1 - seat.y, x1 - seat.x);
        if (!W.inClaim(g.world, 0, x1 - Math.cos(ang) * 8, y1 - Math.sin(ang) * 8)) wrongIn++;
        if (W.inClaim(g.world, 0, x1 + Math.cos(ang) * 14, y1 + Math.sin(ang) * 14)) wrongOut++;
      }
      return { segs: segs.length, anchors: anchors.length, wrongIn, wrongOut };
    });
    ok('an outline is produced', agree.segs > 40, `${agree.segs} segments from ${agree.anchors} anchors`);
    ok("the drawn edge matches the sim's rule", agree.wrongIn === 0 && agree.wrongOut === 0,
       `${agree.wrongIn} inside-but-unclaimed, ${agree.wrongOut} outside-but-claimed`);
    const grew = await pg.evaluate(() => {
      const T = window.Terrain, W = window.World, g = window.Game.game;
      const outline = () => T.claimOutline(T.claimAnchors({ map: g.world.map, players: g.world.players }, 0)).length;
      const before = outline();
      g.world.players[0].essence = 9000;
      const seat = g.world.map.sites[g.world.map.cities[0]];
      /* a Gate stands on a SPRING and nowhere else, so aim at the one in the starting writ
       * rather than sweeping a circle and trusting that a spring happens to lie on it */
      /* THE ONE SPRING IN THE WRIT IS ALREADY GATED — every heir opens drawing on it — so the
       * writ only grows when you go and TAKE another, which means troops on the ground. Walk
       * outward until a spring accepts a Gate once a man of yours is standing on it. */
      const springs = g.world.map.sites.filter((q) => q.kind === 'node')
        .map((q) => ({ q, d: Math.hypot(q.x - seat.x, q.y - seat.y) }))
        .sort((m, n) => m.d - n.d);
      let placed = false, at = 0;
      for (const s of springs) {
        if (placed) break;
        if (W.nodeHolder(g.world, s.q) !== -1) continue;        // already drawn upon
        const d = window.CONST.UNITS.soldier;
        g.world.units.push({ id: g.world.nextId++, owner: 0, kind: 'soldier', x: s.q.x, y: s.q.y,
                             ox: 0, oy: 0, hp: d.hp, maxHp: d.hp, dmg: d.dmg, cd: 0,
                             goal: null, co: 0, from: -1 });
        for (let rr = 18; rr < window.CONST.NODE.r && !placed; rr += 12)
          for (let a = 0; a < 24 && !placed; a++) {
            const th = a / 24 * Math.PI * 2;
            const x = s.q.x + Math.cos(th) * rr, y = s.q.y + Math.sin(th) * rr;
            if (!W.placementError(g.world, 0, x, y, 'gate')) {
              W.applyCommand(g.world, 0, { c: 'build', x, y, bt: 'gate' });
              placed = true; at = Math.round(s.d);
            }
          }
      }
      const shell = outline();
      /* AND NOW LET THE MASONS FINISH. A shell claims nothing — World.inClaim has always
       * required !b.raise — so the line must not move until the Gate actually stands. */
      const gate = g.world.players[0].buildings.filter((b) => b.bt === 'gate').pop();
      const rising = gate ? gate.raise > 0 : false;
      if (gate) gate.raise = 0;
      return { placed, before, shell, rising, after: outline(), at };
    });
    ok('a Gate you go and take can be raised on its spring', grew.placed, `spring at ${grew.at}`);
    ok('...and it goes up as a shell first', grew.rising);
    /* THE LINE IS A PICTURE OF THE RULE. Drawn around a Gate still going up it promised ground
     * the sim would refuse to build on — the outline said the writ had grown and every tap out
     * there came back 'beyond your writ'. */
    ok('the writ does NOT reach round a Gate that is still going up',
       grew.shell === grew.before, `${grew.before} -> ${grew.shell} segments while a shell`);
    ok('...and DOES the moment the masons are off it', grew.after > grew.before,
       `${grew.before} -> ${grew.after} segments once it stands`);

    /* ---------------- the army is on screen ---------------- *
     * Troops went invisible in 3D: an InstancedMesh is culled against a bounding sphere built
     * from its instance matrices, computed ONCE on the first frustum test and cached. The
     * trees survive because their matrices are final by then; the army's are rewritten every
     * frame, so the sphere stayed pinned to the world's origin corner and the whole force was
     * culled the moment the camera looked anywhere else. */
    suite(`${r} · the army is drawn`);
    const army = await pg.evaluate(() => {
      const W = window.World, C = window.CONST, g = window.Game.game;
      const c = g.world.map.sites[g.world.map.cities[0]];
      g.world.players[0].essence = 99000;
      /* one work rises at a time now, so the masons have to finish each before the next —
       * including whatever an earlier suite left them holding */
      window.__step(40, { raising: true });
      let built = 0;
      for (let a = 0; a < 40 && built < 3; a++) {
        const th = a / 40 * Math.PI * 2, x = c.x + Math.cos(th) * 200, y = c.y + Math.sin(th) * 200;
        if (W.placementError(g.world, 0, x, y, 'barracks')) continue;
        if (!W.applyCommand(g.world, 0, { c: 'build', x, y, bt: 'barracks' }).ok) continue;
        built++;
        window.__step(40, { raising: true });
      }
      /* Hold the match open. This suite runs a couple of sim-minutes forward, which is long
       * enough for somebody to actually WIN — and every suite after this one would then be
       * driving the end screen instead of the game. */
      window.__step(150);
      window.Render.setZoom(1.35); window.Render.lookAt(c.x, c.y);
      const mine = g.world.units.filter((u) => u.owner === 0);
      const d = mine.map((u) => Math.hypot(u.x - c.x, u.y - c.y)).sort((a, b) => a - b);
      return { n: mine.length, median: Math.round(d[d.length >> 1] || 0), buried: d.filter((x) => x < C.CITY.seatR).length };
    });
    ok('a garrison musters', army.n > 10, `${army.n} troops`);
    /* remembered ground has to reach the renderer, or the fog has nothing to soften */
    const mem = await pg.evaluate(() => {
      const R = window.Render, g = window.Game.game;
      const v = g.world.players[0].seen;
      return { has: !!v, cells: v ? v.g.reduce((a, b) => a + b, 0) : 0, of: v ? v.g.length : 0 };
    });
    ok('the renderer is given the ground you have walked', mem.has && mem.cells > 20,
       `${mem.cells} of ${mem.of} cells remembered`);
    ok('and it is not simply the whole map', mem.cells < mem.of, `${mem.cells}/${mem.of}`);
    ok('the army stands in the court, not on the tower', army.median > 90,
       `median ${army.median} from the Seat, ${army.buried} of ${army.n} still on its own ground`);
    await pg.waitForTimeout(600);
    if (r === '3d') {
      const meshes = await pg.evaluate(() => {
        const im = window.Render.debugUnitMeshes();
        return Object.keys(im).map((k) => ({ k, count: im[k].count, culled: im[k].frustumCulled, vis: im[k].visible }));
      });
      /* buckets are kind#rank now — a veteran needs its own geometry, so it needs its own
       * mesh, and the recruits' bucket is the one that carries an early army */
      const sold = meshes.find((m) => m.k === 'soldier#1');
      ok('the soldiers are instanced', !!sold && sold.count > 10, JSON.stringify(sold));
      ok('and not frustum-culled against a stale sphere at the origin',
         meshes.every((m) => m.culled === false), JSON.stringify(meshes.filter((m) => m.culled)));
    }

    /* ---------------- HUD layering ---------------- *
     * The overlay canvas paints the full-screen fog veil. If it stacks above the HUD it
     * buries the essence readout, the flags and the power buttons. */
    suite(`${r} · HUD layering`);
    const layer = await pg.evaluate(() => {
      const zOf = (id) => {
        const v = getComputedStyle(document.getElementById(id)).zIndex;
        return v === 'auto' ? 0 : parseInt(v, 10);
      };
      const pw = document.getElementById('pw-storm').getBoundingClientRect();
      const hit = document.elementFromPoint(pw.left + pw.width / 2, pw.top + pw.height / 2);
      return { hud: zOf('hud'), overlay: zOf('overlay'), sheet: zOf('sheet'),
               hitId: hit && (hit.id || hit.className), hitInHud: !!(hit && hit.closest('#hud')) };
    });
    ok('the HUD stacks above the fog overlay', layer.hud > layer.overlay,
       `#hud z=${layer.hud}, #overlay z=${layer.overlay}`);
    ok('the sheet stacks above the HUD', layer.sheet > layer.hud, `#sheet z=${layer.sheet}`);
    ok('a power button is the topmost thing at its own centre', layer.hitInHud, `got ${layer.hitId}`);


    /* ---------------- input routing ---------------- */
    suite(`${r} · input`);
    /* BARE GROUND IS INERT NOW. Raising a work begins at the BUILD button, so the map is only
     * ever asked about things that are ON it — which is what stopped a tap on your own men
     * and a tap on the ground beside them meaning two different things. */
    let p = await nearSeat(110, 0);
    await pg.click('#btn-build'); await until(pg, () => window.UI.sheetOpen());
    ok('the BUILD button opens the sheet', await sheetOpen());
    p = await nearSeat(-110, 40);
    ok('the ground tapped is genuinely bare', p.bare, 'nearSeat found nothing clear on screen');
    await pg.mouse.click(p.x, p.y); await until(pg, () => !window.UI.sheetOpen());
    ok('tapping the map closes it rather than opening another', !(await sheetOpen()));
    await pg.mouse.click(p.x, p.y); await pg.waitForTimeout(200);
    const opened = await pg.evaluate(() => {
      const el = document.getElementById('sheet');
      if (el.classList.contains('hidden')) return null;
      const t = el.querySelector('.sheet-title');
      return t ? t.textContent.trim() : '(untitled)';
    });
    ok('...and bare ground opens nothing by itself', !opened, `it opened: ${opened}`);
    await pg.click('#btn-build'); await until(pg, () => window.UI.sheetOpen());
    ok('the button opens it again', await sheetOpen());

    /* an ARMED flag must still act through an open sheet, not merely dismiss it */
    await pg.evaluate(() => document.querySelector('#flag-tray .fbtn').click());
    await pg.waitForTimeout(200);
    const node = await pg.evaluate(() => {
      const R = window.Render, g = window.Game.game;
      const seat = g.world.map.sites[g.world.map.cities[0]];
      const sh = document.getElementById('sheet');
      const lid = sh.classList.contains('hidden') ? window.innerHeight - 20 : sh.getBoundingClientRect().top - 40;
      /* Try the nodes furthest from the Seat first — a node inside the court is ambiguous by
       * design, since a standard may be planted anywhere on it. Then CONFIRM with the
       * renderer's own hit test that the point we are about to tap really is that node: a node
       * near the map's rim cannot always be panned clear of the sheet, and a tap that misses
       * looks exactly like a broken input path. */
      const cands = g.world.map.sites.filter((x) => x.kind === 'node')
        .sort((p, q) => Math.hypot(q.x - seat.x, q.y - seat.y) - Math.hypot(p.x - seat.x, p.y - seat.y));
      R.setZoom(1);
      for (const s of cands) {
        R.lookAt(s.x, s.y);
        let q = R.project(s.x, s.y);
        for (let i = 0; i < 90 && q.y > lid; i++) { R.pan(0, -30); q = R.project(s.x, s.y); }
        if (q.y > lid || q.y < 60 || q.x < 20 || q.x > window.innerWidth - 20) continue;
        if (R.hitSite(q.x, q.y, g.world, 0, true) !== s.id) continue;
        return { id: s.id, x: q.x, y: q.y, before: g.world.players[0].banner && g.world.players[0].banner.site };
      }
      return null;
    });
    ok('a node can be brought somewhere tappable', !!node);
    await pg.mouse.click(node.x, node.y); await pg.waitForTimeout(300);
    /* THE TRAY IS COMPANIES NOW — there is no gold chip — so an armed flag posts that
     * company's STANDARD, not a royal banner. */
    const rallied = await pg.evaluate(() => {
      const cos = window.Game.game.world.players[0].companies;
      return cos.length ? cos[0].rally : null;
    });
    ok('an armed flag still plants through an open sheet', rallied && rallied.site === node.id,
       `rally ${JSON.stringify(rallied)}`);

    /* the standard must also take BARE GROUND — the sim has nothing to refuse, and the tap
     * path must not invent a refusal of its own */
    const open = await pg.evaluate(() => {
      const R = window.Render, C = window.CONST, g = window.Game.game;
      const c = g.world.map.sites[g.world.map.cities[0]];
      const sh = document.getElementById('sheet');
      const lid = sh.classList.contains('hidden') ? window.innerHeight - 20 : sh.getBoundingClientRect().top - 40;
      /* Sweep SCREEN points and ask the renderer's own hit test whether each lands on a site.
       * Guessing a "clear" world radius has to second-guess the Seat's flag radius and the
       * projection at once; hitSite is the very thing the tap will consult. Several camera
       * setups, because on some worlds the Seat's own surroundings are crowded with springs. */
      const setups = [[1, c.x, c.y], [C.VIEW.min, c.x, c.y], [1, C.MAP.W / 2, C.MAP.H / 2]];
      for (const [zm, lx, ly] of setups) {
        R.setZoom(zm); R.lookAt(lx, ly);
        for (let py = 110; py < lid; py += 12) for (let px = 30; px < window.innerWidth - 30; px += 12) {
          if (R.hitSite(px, py, g.world, 0, true) >= 0) continue;
          if (R.hitUnit(px, py, 0) > 0) continue;   // a man there means his standard, not ground
          const w2 = R.toWorld(px, py, 0);
          if (!w2 || w2.x < 30 || w2.y < 30 || w2.x > C.MAP.W - 30 || w2.y > C.MAP.H - 30) continue;
          return { x: px, y: py, wx: w2.x, wy: w2.y };
        }
      }
      return null;
    });
    ok('found open ground on screen to plant on', !!open);
    if (open) {
      await pg.evaluate(() => document.querySelector('#flag-tray .fbtn').click());
      await pg.waitForTimeout(150);
      await pg.mouse.click(open.x, open.y); await pg.waitForTimeout(300);
      const bare = await pg.evaluate(() => ({
        b: (window.Game.game.world.players[0].companies[0] || {}).rally,
        warn: [...document.querySelectorAll('#banner-wrap .banner')].map((e) => e.textContent).join(' | ')
      }));
      ok('a standard plants on bare ground', !!bare.b && bare.b.site === -1,
         `banner ${JSON.stringify(bare.b)}`);
      ok('it lands where the finger did', bare.b && Math.hypot(bare.b.x - open.wx, bare.b.y - open.wy) < 90,
         bare.b ? `off by ${Math.round(Math.hypot(bare.b.x - open.wx, bare.b.y - open.wy))}` : '');
      ok('and no refusal is shown', !/needs ground|cannot/i.test(bare.warn), bare.warn);
    }

    /* the bottom-right controls must stay on screen however many flags there are */
    const tray = await pg.evaluate(() => {
      /* stuff the tray with more chips than any real match produces, then put it back —
       * a long tray must scroll inside #hud-left, never shove the powers off screen */
      const el = document.getElementById('flag-tray');
      const one = el.querySelector('.fbtn');
      const added = [];
      /* clone-and-remove by reference: rewriting innerHTML would strip the listeners the
       * real chips carry, and every later flag test would silently do nothing */
      if (one) for (let i = 0; i < 14; i++) { const c = one.cloneNode(true); el.appendChild(c); added.push(c); }
      const pw = document.getElementById('powers').getBoundingClientRect();
      const r2 = { right: Math.round(pw.right), left: Math.round(pw.left), w: window.innerWidth, n: el.children.length };
      for (const c of added) c.remove();
      return r2;
    });
    ok('the power buttons stay on screen with a full flag tray',
       tray.right <= tray.w + 1 && tray.left >= 0,
       `${tray.n} chips, powers span ${tray.left}..${tray.right} of ${tray.w}`);

    /* ---------------- a level you can see ---------------- *
     * The point of moving the upgrade from throughput to rank is that rank is VISIBLE. If a
     * veteran draws with the recruits' geometry, or a raised hall keeps last level's stones,
     * the whole change is invisible and the player is paying for a number in a tooltip. */
    suite(`${r} · a level you can see`);
    await pg.evaluate(() => { window.UI.closeSheet(); window.Game.game.armedFlag = null; });
    await pg.waitForTimeout(120);
    const rank = await pg.evaluate(async () => {
      const R = window.Render, W = window.World, C2 = window.CONST, g = window.Game.game;
      const c = g.world.map.sites[g.world.map.cities[0]];
      g.world.players[0].essence = 99000;
      g.world.chaosNext = 1e9;
      for (const b of g.world.players[0].buildings) { b.raise = 0; b.work = 0; b.fixing = 0; }
      /* CREWS ARE ONE PER GATE and an upgrade takes one, so this suite must not depend on how
       * many Gates happen to be standing after everything before it — least of all after the
       * suite that deliberately fills the yard. Hand it its own. */
      const pl0 = g.world.players[0];
      while (window.World.masons(g.world, 0) < 3) {
        const d = window.CONST.BUILDINGS.gate;
        pl0.buildings.push({ id: g.world.nextId++, bt: 'gate', level: 1, x: c.x - 400, y: c.y - 400,
                             cd: 0, raise: 0, raiseFor: d.raise, hp: d.hp, maxHp: d.hp,
                             lastHurt: -99, node: -1, co: 0 });
      }
      const paint = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      /* a hall, finished */
      W.applyCommand(g.world, 0, { c: 'build', bt: 'barracks', x: c.x + 150, y: c.y + 30 });
      const hall = g.world.players[0].buildings.filter((b) => b.bt === 'barracks').pop();
      hall.raise = 0; hall.hp = hall.maxHp;
      await paint();
      const keyAt1 = [...R.debugWorks().values()].find((wk) => wk.id === hall.id);
      /* raise it, and catch it mid-masonry. A hall's level-2 upgrade IS its fork, so the
       * order must name a branch — and the branch is what the new model is keyed by. */
      const up = W.applyCommand(g.world, 0, { c: 'up', id: hall.id, br: 'line' });
      await paint();
      const mid = [...R.debugWorks().values()].find((wk) => wk.id === hall.id);
      /* let the masons out and muster a veteran */
      hall.work = 0;
      await paint();
      const keyAt2 = [...R.debugWorks().values()].find((wk) => wk.id === hall.id);
      const d = C2.UNITS.soldier;
      g.world.units.push({ id: g.world.nextId++, owner: 0, kind: 'soldier', tier: 2,
                           x: c.x + 60, y: c.y, ox: 0, oy: 0, hp: 90, maxHp: 90,
                           dmg: d.dmg * C2.TIER[1], cd: 0, goal: null, co: 0, from: -1 });
      await paint();
      /* and an elite, so all three ranks are proved distinct rather than just two */
      g.world.units.push({ id: g.world.nextId++, owner: 0, kind: 'soldier', tier: 3,
                           x: c.x + 30, y: c.y, ox: 0, oy: 0, hp: 112, maxHp: 112,
                           dmg: d.dmg * C2.TIER[2], cd: 0, goal: null, co: 0, from: -1 });
      await paint();
      const im = R.debugUnitMeshes();
      return { up: up.ok, upErr: up.err, masons: window.World.masons(g.world, 0),
               rising: window.World.rising(g.world, 0), level: hall.level,
               k1: keyAt1 && keyAt1.key, kMid: mid && mid.key, k2: keyAt2 && keyAt2.key,
               v1: keyAt1 && keyAt1.verts, v2: keyAt2 && keyAt2.verts,
               midOpacity: mid && mid.opacity,
               vetMesh: !!im['soldier#2'] && im['soldier#2'].count,
               vetVerts: im['soldier#2'] && im['soldier#2'].geometry.attributes.position.count,
               eliteVerts: im['soldier#3'] && im['soldier#3'].geometry.attributes.position.count,
               recVerts: im['soldier#1'] && im['soldier#1'].geometry.attributes.position.count };
    });
    ok('a hall can be raised a level in the live game', rank.up && rank.level === 2,
       rank.upErr ? `refused: ${rank.upErr} (${rank.rising}/${rank.masons} crews busy)` : JSON.stringify(rank));
    ok('the model is keyed by level', rank.k1 && rank.k2 && rank.k1 !== rank.k2, `${rank.k1} -> ${rank.k2}`);
    ok('...and wears scaffolding while the masons are in it',
       rank.kMid && rank.kMid !== rank.k2 && /#/.test(rank.kMid), rank.kMid);
    ok('a veteran gets his own instanced mesh', rank.vetMesh === 1, String(rank.vetMesh));
    ok('...with different geometry from a recruit', rank.vetVerts > rank.recVerts,
       `veteran ${rank.vetVerts} verts vs recruit ${rank.recVerts}`);
    ok('...and an elite is more again', rank.eliteVerts > rank.vetVerts,
       `elite ${rank.eliteVerts} verts vs veteran ${rank.vetVerts}`);
    ok('a raised hall is a BIGGER hall, not a repainted one', rank.v2 > rank.v1,
       `${rank.v1} -> ${rank.v2} verts`);
    /* the key alone could change without the paint changing — check the masons are actually
     * showing through the stone */
    ok('the scaffolding is see-through, so the pause in the muster is visible',
       rank.midOpacity < 1, `opacity ${rank.midOpacity}`);

    /* ---------------- a branch you can see ---------------- *
     * A LEVEL AND A BRANCH ARE DIFFERENT AXES, and the suite above only proved the level: it
     * forked a hall and watched it grow, which it would have done for any branch or none. The
     * frame asked for its model with a key that carried the branch only for a Watchtower, so
     * every hall's branch arm was unreachable and three Barracks that had chosen three
     * different soldieries were the same building on the board. This is the assertion that
     * was missing — same type, same level, different choice, different work — and it is made
     * against every forking building in CONST rather than a list, so a fork added later is
     * covered the day it is added. */
    suite(`${r} · a branch you can see`);
    const brs = await pg.evaluate(async () => {
      const R = window.Render, C2 = window.CONST;
      const out = [];
      for (const bt of Object.keys(C2.BUILDINGS)) {
        const d = C2.BUILDINGS[bt];
        if (!d.branches) continue;
        const lv = d.fork || 2;
        const seen = new Map();
        /* ...and the unforked work at the same level, which must differ from all of them */
        seen.set('—', R.model(R.modelKey({ bt, level: lv }, 0, 0)));
        for (const br of Object.keys(d.branches))
          seen.set(br, R.model(R.modelKey({ bt, br, level: lv }, 0, 0)));
        const verts = [];
        for (const [name, m] of seen) {
          let v = 0;
          m.traverse((o) => { if (o.geometry && o.geometry.attributes.position) v += o.geometry.attributes.position.count; });
          verts.push([name, v]);
        }
        out.push({ bt, verts, distinct: new Set(verts.map((q) => q[1])).size, n: verts.length });
      }
      return out;
    });
    ok('every building that forks actually forks on the board', brs.length >= 4,
       `${brs.length} forking buildings found`);
    for (const b of brs)
      ok(`...a ${b.bt} looks different for every branch it may take`, b.distinct === b.n,
         b.verts.map((q) => `${q[0]}:${q[1]}`).join('  '));
    /* the key the FRAME builds, not one written by hand in the test — a model that differs
     * only when asked directly is a model the player never sees */
    const brLive = await pg.evaluate(async () => {
      const R = window.Render, W = window.World, g = window.Game.game;
      const c = g.world.map.sites[g.world.map.cities[0]];
      const paint = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      g.world.players[0].essence = 99000;
      for (const b of g.world.players[0].buildings) { b.raise = 0; b.work = 0; b.fixing = 0; }
      /* THE BUILD MUST BE SEEN TO LAND. This rig wrote one spot and took `.pop()` on faith —
       * and when a suite running earlier left that spot crowded, the refused build made
       * `.pop()` hand back the FIRST hall, the fork order bounced off its existing branch with
       * ok:true, and the assertion compared a building with itself: both keys barracks:line@3,
       * failing red on a renderer that was right. Sweep for ground the board will take, and
       * prove the hall is NEW before asking anything about it. */
      const before = new Set(g.world.players[0].buildings.map((b) => b.id));
      for (let rad = 150; rad < 340; rad += 30) {
        let done = false;
        for (let a2 = 0; a2 < 6.283; a2 += 0.3)
          if (W.applyCommand(g.world, 0, { c: 'build', bt: 'barracks',
                x: c.x + Math.cos(a2) * rad, y: c.y + Math.sin(a2) * rad }).ok) { done = true; break; }
        if (done) break;
      }
      const two = g.world.players[0].buildings.filter((b) => b.bt === 'barracks').pop();
      if (before.has(two.id)) return { err: 'no ground for a second hall' };
      two.raise = 0; two.hp = two.maxHp;
      const up = W.applyCommand(g.world, 0, { c: 'up', id: two.id, br: 'raid' });
      two.work = 0;
      await paint();
      const first = g.world.players[0].buildings.filter((b) => b.bt === 'barracks' && b.br === 'line').pop();
      const a = R.debugWorks(first && first.id), b2 = R.debugWorks(two.id);
      return { up: up.ok, err: up.err, a: a && { k: a.key, v: a.verts }, b: b2 && { k: b2.key, v: b2.verts } };
    });
    ok('...and the frame asks for the branch, not just the level',
       brLive.a && brLive.b && brLive.a.k !== brLive.b.k && brLive.a.v !== brLive.b.v,
       JSON.stringify(brLive));

    /* ---------------- the yard ---------------- *
     * What this game rations is the MASONS, and until now the only way to discover you had
     * none free was to choose a spot, open the sheet and be refused. The readout has to be
     * live and it has to be right on a guest too, where there is no world to ask. */
    suite(`${r} · the yard`);
    await pg.evaluate(() => { window.UI.closeSheet(); window.Game.game.armedFlag = null; });
    await pg.waitForTimeout(120);
    const yard = await pg.evaluate(async () => {
      const { World: W, CONST: C2, Game } = window;
      const g = Game.game, pl = g.world.players[0];
      const c = g.world.map.sites[g.world.map.cities[0]];
      pl.essence = 99000;
      for (const b of pl.buildings) { b.raise = 0; b.work = 0; }
      const paint = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      await paint();
      const read = () => ({ free: document.getElementById('m-free').textContent,
                            of: document.getElementById('m-of').textContent,
                            busy: document.getElementById('masons').classList.contains('busy') });
      const idle = read();
      const want = W.masons(g.world, 0);
      /* put every crew to work and watch it fall to none */
      let started = 0;
      for (let rad = 150; rad < 380 && started < want; rad += 20)
        for (let a = 0; a < 24 && started < want; a++) {
          const th = a / 24 * Math.PI * 2;
          const x = c.x + Math.cos(th) * rad, y = c.y + Math.sin(th) * rad;
          if (W.placementError(g.world, 0, x, y, 'tower')) continue;
          if (W.applyCommand(g.world, 0, { c: 'build', x, y, bt: 'tower' }).ok) started++;
        }
      await paint();
      const working = read();
      return { idle, working, want, started, rising: W.rising(g.world, 0) };
    });
    ok('the yard reports every crew idle before anything is started',
       yard.idle.free === String(yard.want) && yard.idle.of === '/' + yard.want,
       `${yard.idle.free}${yard.idle.of}, expected ${yard.want}/${yard.want}`);
    ok('...and is not dimmed while crews are free', !yard.idle.busy);
    ok('every crew could be put to work', yard.started === yard.want, `${yard.started}/${yard.want}`);
    ok('the yard falls to none as they take it up', yard.working.free === '0',
       `${yard.working.free}${yard.working.of} with ${yard.rising} rising`);
    ok('...and dims, which is what explains a refusal before you hit one', yard.working.busy);

    /* ---------------- the sheet knows the yard is empty ---------------- *
     * The yard readout says how many crews are free; the SHEET is what you actually press,
     * and it used to offer every work at full brightness with nothing to build them. You
     * chose a card, armed it, aimed at the ground and were told 'your masons are all at work'
     * — three steps to learn a thing the button could have said. The lock has to run both
     * ways and it has to run LIVE: a sheet opened with the yard full clears itself the moment
     * a crew walks out of a finished work, without being closed and opened again. */
    suite(`${r} · the yard greys the sheet`);
    await pg.evaluate(() => { window.UI.closeSheet(); window.Game.game.armedFlag = null; });
    await pg.waitForTimeout(120);
    const grey = await pg.evaluate(async () => {
      const { World: W, Game } = window;
      const g = Game.game, pl = g.world.players[0];
      const c = g.world.map.sites[g.world.map.cities[0]];
      pl.essence = 99000;
      g.world.chaosNext = 1e9;
      for (const b of pl.buildings) { b.raise = 0; b.work = 0; b.fixing = 0; }
      const had = pl.buildings.length;   // this suite tidies up after itself: see the truncate below
      const paint = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      await paint();
      const cards = () => [...document.querySelectorAll('#sheet .card[data-cost]')];
      const read = () => ({
        n: cards().length,
        locked: cards().filter((k) => k.classList.contains('locked')).length,
        says: cards().some((k) => /masons are all at work/.test(k.textContent)),
        btn: document.getElementById('btn-build').classList.contains('nocrew'),
        open: !document.getElementById('sheet').classList.contains('hidden')
      });
      /* crews free: the sheet opens bright */
      document.getElementById('btn-build').click();
      await paint();
      const free = read();
      /* now fill the yard WITHOUT touching the sheet, the way a match does */
      const want = W.masons(g.world, 0);
      let started = 0;
      for (let rad = 150; rad < 420 && started < want; rad += 20)
        for (let a = 0; a < 24 && started < want; a++) {
          const th = a / 24 * Math.PI * 2;
          const x = c.x + Math.cos(th) * rad, y = c.y + Math.sin(th) * rad;
          if (W.applyCommand(g.world, 0, { c: 'build', x, y, bt: 'tower' }).ok) started++;
        }
      await paint();
      const full = read();
      /* and let them out again, still without closing it */
      for (const b of pl.buildings) { b.raise = 0; b.work = 0; b.fixing = 0; }
      await paint();
      const back = read();
      /* the towers were scaffolding for this suite, not works — leaving a ring of them round
       * the Seat is how a later suite finds no ground for the one IT needs */
      pl.buildings.length = had;
      await paint();
      return { free, full, back, want, started };
    });
    ok('the sheet opens with every work offered while a crew is free',
       grey.free.n > 0 && grey.free.locked === 0 && !grey.free.btn,
       `${grey.free.locked}/${grey.free.n} locked, button ${grey.free.btn ? 'grey' : 'lit'}`);
    ok('every crew could be put to work', grey.started === grey.want, `${grey.started}/${grey.want}`);
    ok('...and the open sheet greys itself when the last crew is taken',
       grey.full.open && grey.full.locked === grey.full.n && grey.full.n > 0,
       `${grey.full.locked}/${grey.full.n} locked`);
    ok('...saying it is the masons, not the money', grey.full.says);
    ok('...and the BUILD button greys with it', grey.full.btn);
    ok('a crew coming free clears the sheet without reopening it',
       grey.back.open && grey.back.locked === 0 && !grey.back.btn,
       `${grey.back.locked}/${grey.back.n} locked, button ${grey.back.btn ? 'grey' : 'lit'}`);
    await pg.evaluate(() => window.UI.closeSheet());
    await pg.waitForTimeout(120);

    /* ---------------- the knell ---------------- *
     * A rival on the Pattern is the one thing on this board that takes the throne without ever
     * coming near you, and it is nine and a half minutes long. Told once, in a banner sharing
     * its corner with rift warnings and storm calls, is not being told. Four marks — the foot
     * set, then halfway, three quarters and the final veil — thrown across the middle of the
     * screen and gone again. */
    suite(`${r} · the knell`);
    await pg.evaluate(() => { window.UI.closeSheet(); window.Game.game.armedFlag = null; });
    const knell = await pg.evaluate(async () => {
      const C = window.CONST, g = window.Game.game;
      const el = document.getElementById('knell');
      const shown = () => !el.classList.contains('hidden');
      const start = shown();
      /* the rival sets foot: the sim's own event, through the shipping path */
      g.world.players[1].walking = true;
      g.world.players[1].revealed = true;
      g.world.events.push({ e: 'walk', pi: 1 });
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const onFoot = { shown: shown(), text: el.textContent };
      /* ...and each mark after it */
      const marks = [];
      for (let i = 1; i < C.PATTERN_ALERTS.length; i++) {
        g.world.events.push({ e: 'pattern', pi: 1, idx: i });
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        marks.push({ at: C.PATTERN_ALERTS[i].at, text: el.textContent });
      }
      /* YOUR OWN walk is not a knell — you started it, and the count is on the board */
      el.classList.add('hidden');
      g.world.events.push({ e: 'walk', pi: 0 });
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const mine = shown();
      return { start, onFoot, marks, mine,
               ats: C.PATTERN_ALERTS.map((a) => a.at),
               banner: document.getElementById('banner-wrap').textContent };
    });
    ok('nothing tolls before anybody walks', !knell.start);
    ok('a rival setting foot on the Pattern tolls', knell.onFoot.shown, knell.onFoot.text);
    ok('...and names him', /\S/.test(knell.onFoot.text), knell.onFoot.text);
    ok('there are four marks: the foot set, and three quarters of the way',
       knell.ats.length === 4 && knell.ats[1] === 50 && knell.ats[2] === 75 && knell.ats[3] === 90,
       knell.ats.join(','));
    for (const m of knell.marks)
      ok(`...and ${m.at}% tolls with the number on it`, m.text.indexOf(Math.round(m.at) + '%') >= 0, m.text);
    ok('your OWN walk is not a knell', !knell.mine);
    ok('...it is a banner, as it was', /Pattern/.test(knell.banner), knell.banner.slice(0, 60));
    await pg.evaluate(() => document.getElementById('knell').classList.add('hidden'));

    /* ---------------- the halt ---------------- *
     * A pause has one job beyond stopping the clock: it must not BANK the time it stood
     * still for. An accumulator left filling would fast-forward the match the moment you
     * lifted it, which is the one thing a pause must never do. */
    suite(`${r} · the halt`);
    await pg.evaluate(() => { window.UI.closeSheet(); window.Game.game.armedFlag = null; });
    await pg.waitForTimeout(120);
    const before = await pg.evaluate(() => window.Game.game.world.t);
    await pg.click('#btn-pause');
    await pg.waitForTimeout(120);
    const held = await pg.evaluate(() => ({
      paused: !!window.Game.game.world.paused,
      by: window.Game.game.world.paused && window.Game.game.world.paused.by,
      panel: !document.getElementById('halt').classList.contains('hidden'),
      btn: document.getElementById('btn-pause').textContent,
      t: window.Game.game.world.t
    }));
    ok('the button calls a halt', held.paused);
    ok('...credited to the seat that tapped it', held.by === 0, held.by);
    ok('the panel says so', held.panel);
    ok('and the button offers to go on', held.btn === '▶', held.btn);
    /* stand still a while: the world must not move, and must not bank the standing still */
    await pg.waitForTimeout(900);
    const stood = await pg.evaluate(() => window.Game.game.world.t);
    ok('the clock does not move while halted', Math.abs(stood - held.t) < 1e-6, `${held.t} -> ${stood}`);
    /* an order given into a halt is refused rather than queued */
    const refused = await pg.evaluate(() => {
      const g = window.Game.game, c = g.world.map.sites[g.world.map.cities[0]];
      g.world.players[0].essence = 9000;
      return window.World.applyCommand(g.world, 0, { c: 'build', bt: 'tower', x: c.x + 130, y: c.y }).err;
    });
    ok('no work may be raised into a halt', refused === 'paused', refused);
    /* the whole panel is the button — tapping the middle of the screen goes on */
    const mid = await pg.evaluate(() => ({ x: Math.round(innerWidth / 2), y: Math.round(innerHeight / 2) }));
    await pg.mouse.click(mid.x, mid.y);
    await pg.waitForTimeout(200);
    const lifted = await pg.evaluate(() => ({
      paused: !!window.Game.game.world.paused,
      panel: !document.getElementById('halt').classList.contains('hidden'),
      btn: document.getElementById('btn-pause').textContent,
      t: window.Game.game.world.t
    }));
    ok('tapping the panel goes on again', !lifted.paused);
    ok('...and the panel gets out of the way', !lifted.panel);
    ok('...and the button offers a halt again', lifted.btn === '⏸', lifted.btn);
    ok('the halt banked no time', lifted.t - stood < 0.5, `jumped ${(lifted.t - stood).toFixed(2)}s on resume`);
    await pg.waitForTimeout(300);
    const ran = await pg.evaluate(() => window.Game.game.world.t);
    ok('and the world runs again', ran > lifted.t, `${lifted.t.toFixed(2)} -> ${ran.toFixed(2)}`);
    /* back must lift a halt before it leaves the match */
    await pg.click('#btn-pause'); await pg.waitForTimeout(150);
    await pg.goBack(); await pg.waitForTimeout(250);
    const backOut = await pg.evaluate(() => ({
      paused: !!(window.Game.game.world && window.Game.game.world.paused),
      mode: window.Game.game.mode
    }));
    ok('back lifts the halt', !backOut.paused);
    ok('...rather than leaving the match', backOut.mode !== null, backOut.mode);

    /* ---------------- a wall is two taps ---------------- *
     * Every other work goes up where the sheet was opened. A curtain needs a second point,
     * and the whole interface for it is: tap the card, tap the far end. If the second tap
     * ever routes somewhere else — a sheet, a site, a standard — the wall cannot be built at
     * all, and nothing else in the game would notice. */
    suite(`${r} · a wall is two taps`);
    await pg.evaluate(() => { window.UI.closeSheet(); window.Game.game.armedFlag = null; });
    await pg.waitForTimeout(150);
    /* clear the masons and find a run the sim will actually accept, on screen */
    const run = await pg.evaluate(() => {
      const R = window.Render, W = window.World, g = window.Game.game;
      const c = g.world.map.sites[g.world.map.cities[0]];
      g.world.players[0].essence = 99000;
      for (const b of g.world.players[0].buildings) b.raise = 0;
      R.setZoom(1); R.lookAt(c.x, c.y);
      const lid = window.innerHeight - 20;
      /* THE MASONS ARE THE LIMIT, so the run this test draws has to be one they can cover —
       * a length past the crews is refused for the crews, which is correct and would look
       * exactly like a broken tap path. */
      const half = Math.min(80, W.wallReach(g.world, 0) / 2 - 4);
      for (let a = 0; a < 6.283; a += 0.3) {
        for (let rr = 130; rr <= 230; rr += 25) {
          const mx = c.x + Math.cos(a) * rr, my = c.y + Math.sin(a) * rr;
          const px = -Math.sin(a) * half, py = Math.cos(a) * half;
          const A = { x: mx - px, y: my - py }, B = { x: mx + px, y: my + py };
          if (W.wallError(g.world, 0, A.x, A.y, B.x, B.y)) continue;
          const sa = R.project(A.x, A.y), sb = R.project(B.x, B.y);
          const onScreen = (q) => q.x > 30 && q.x < window.innerWidth - 30 && q.y > 90 && q.y < lid;
          if (!onScreen(sa) || !onScreen(sb)) continue;
          if (R.hitSite(sa.x, sa.y, g.world, 0, false) >= 0) continue;
          if (R.hitBuilding(sa.x, sa.y) >= 0) continue;
          /* ...and clear of your own men: a tap on a soldier picks up his standard now */
          if (R.hitUnit(sa.x, sa.y, 0) > 0 || R.hitUnit(sb.x, sb.y, 0) > 0) continue;
          return { ax: sa.x, ay: sa.y, bx: sb.x, by: sb.y, wax: A.x, way: A.y, wbx: B.x, wby: B.y };
        }
      }
      return null;
    });
    ok('a legal run can be found on screen', !!run);

    /* ---- AND A BAD ANCHOR IS REFUSED ON THE FIRST TAP ----
     * Nothing looked at the first tap at all: you set an anchor on ground that could never
     * take a wall, aimed the far end, and only THEN learned the run was refused — and the
     * refusal keeps the anchor, so the bad end was the one you were stuck with. Reported from
     * play. `placementError` has always answered exactly this for a work with a `span`. */
    const anchorBad = await pg.evaluate(async () => {
      const R = window.Render, W = window.World, g = window.Game.game;
      const c = g.world.map.sites[g.world.map.cities[0]];
      const lines = [];
      const real = window.UI.banner;
      window.UI.banner = (t) => lines.push(t);
      /* somewhere ON SCREEN that a wall may not start: past the writ is the reliable one */
      let bad = null;
      for (let a = 0; a < 6.283 && !bad; a += 0.2)
        for (let rr = window.CONST.CLAIM.seat + 60; rr < window.CONST.CLAIM.seat + 400; rr += 30) {
          const x = c.x + Math.cos(a) * rr, y = c.y + Math.sin(a) * rr;
          if (!W.placementError(g.world, 0, x, y, 'wall')) continue;   // legal: not what we want
          const p = R.project(x, y);
          if (p.x < 30 || p.x > window.innerWidth - 30 || p.y < 90 || p.y > window.innerHeight - 40) continue;
          bad = { x, y, sx: p.x, sy: p.y, why: W.placementError(g.world, 0, x, y, 'wall') };
          break;
        }
      if (!bad) { window.UI.banner = real; return { found: false }; }
      window.UI.armBuild(true);
      g.placing = { bt: 'wall', co: 0 };
      g.span = null;
      window.UI.banner = real;
      return { found: true, why: bad.why, at: bad, lines };
    });
    if (anchorBad.found) {
      /* the tap goes through the real pointer, like every other tap in this suite */
      await pg.evaluate(() => { window.__said = []; window.__realBanner = window.UI.banner;
                                window.UI.banner = (t) => window.__said.push(t); });
      await pg.mouse.click(anchorBad.at.sx, anchorBad.at.sy);
      await pg.waitForTimeout(220);
      anchorBad.afterBad = await pg.evaluate(() => {
        const g = window.Game.game;
        const out = { span: !!g.span, placing: !!g.placing, said: window.__said.slice() };
        window.UI.banner = window.__realBanner;
        return out;
      });
    }
    if (anchorBad.found) {
      /* THE ASSERTIONS THAT FAIL ON THE OLD CODE — the anchor was taken without a glance */
      ok('a wall refused at its anchor takes no anchor at all',
         anchorBad.afterBad.span === false, JSON.stringify(anchorBad.afterBad));
      ok('...and says why, in the words the command would have used',
         anchorBad.afterBad.said.length > 0, anchorBad.afterBad.said.join(' | '));
      ok('...leaving the work armed, so the next tap is another first tap',
         anchorBad.afterBad.placing === true, String(anchorBad.afterBad.placing));
    } else ok('a refusable anchor could be found on screen', false, 'none on screen');

    if (run) {
      /* CHOOSE FIRST, PLACE SECOND. The sheet belongs to the BUILD button now, not to a patch
       * of ground — tapping the map no longer opens it, which is what stopped the army and
       * the ground competing for the same gesture. */
      await pg.click('#btn-build'); await until(pg, () => window.UI.sheetOpen());
      const hasCard = await pg.evaluate(() =>
        !!document.querySelector('#sheet .card[data-bt="wall"]'));
      ok('the build menu offers a curtain wall', hasCard);
      const picked = await pg.evaluate(() => {
        const card = document.querySelector('#sheet .card[data-bt="wall"]');
        if (!card || card.classList.contains('locked')) return null;
        card.click();
        return window.Game.game.placing ? window.Game.game.placing.bt : null;
      });
      ok('the card arms the work rather than raising one', picked === 'wall', String(picked));
      ok('...and the sheet gets out of the way', !(await sheetOpen()));
      ok('...and the button shows it is armed',
         await pg.evaluate(() => document.getElementById('btn-build').classList.contains('armed')));
      /* the first tap on the map is the run's START */
      await pg.mouse.click(run.ax, run.ay); await pg.waitForTimeout(200);
      const armed = await pg.evaluate(() =>
        window.Game.game.span ? { x: window.Game.game.span.x, y: window.Game.game.span.y } : null);
      ok('the first tap anchors the run', !!armed);
      ok('the renderer is told where the run starts',
         await pg.evaluate(() => !!(window.Render.span)));
      const before = await pg.evaluate(() =>
        window.Game.game.world.players[0].buildings.filter((b) => b.bt === 'wall').length);
      /* the second tap: the far end. Move first, so the preview has a real point to draw to. */
      await pg.mouse.move(run.bx, run.by); await pg.waitForTimeout(60);
      await pg.mouse.click(run.bx, run.by); await pg.waitForTimeout(250);
      const after = await pg.evaluate(() => {
        const w = window.Game.game.world.players[0].buildings.filter((b) => b.bt === 'wall');
        const b = w[w.length - 1];
        return { n: w.length, x2: b && b.x2, x: b && b.x, y: b && b.y,
                 span: !!window.Game.game.span, rspan: !!window.Render.span,
                 sheet: window.UI.sheetOpen() };
      });
      ok('the second tap raises the wall', after.n === before + 1, `${before} -> ${after.n}`);
      ok('...and it is stored as a line, not a point', after.x2 != null);
      ok('the second tap opens no sheet of its own', !after.sheet);
      ok('and the arming is spent', !after.span && !after.rspan);
      ok('...including the button', !(await pg.evaluate(() =>
        document.getElementById('btn-build').classList.contains('armed'))));
      const mid = await pg.evaluate(([r2]) => {
        const w = window.Game.game.world.players[0].buildings.filter((b) => b.bt === 'wall');
        const b = w[w.length - 1];
        return Math.hypot(b.x - (r2.wax + r2.wbx) / 2, b.y - (r2.way + r2.wby) / 2);
      }, [run]);
      ok('the run lands where the two fingers did', mid < 60, `midpoint off by ${Math.round(mid)}`);
      /* it must also DRAW: a work the renderer has no case for is a black screen, not a
       * silent omission — so give it frames and check the page stayed quiet */
      await pg.evaluate(() => new Promise((res) => {
        let n = 0;
        const tick = () => (++n > 3 ? res() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }));
      ok('drawing a wall raises nothing', errs.length === 0, errs.slice(0, 3).join(' | '));
      /* THE MEN MUST BE ON THE STONE. This is the whole point of the parapet and it was
       * invisible: a soldier the sim had put on a wall was drawn in the grass beside it.
       * Put one at the wall and prove the renderer lifts him onto the walkway. */
      const climbed = await pg.evaluate(async () => {
        const R = window.Render, C2 = window.CONST, g = window.Game.game;
        const w = g.world.players[0].buildings.filter((b) => b.bt === 'wall');
        const b = w[w.length - 1];
        /* THE MASONS HAVE TO BE DONE FIRST. A wall still going up is scaffolding: it bars
         * nothing, hides nothing, and nobody mans it — so let the last sliver of the raise
         * tick away, which is also what puts it in the standing list. */
        b.raise = C2.SIM_DT * 0.5;
        window.World.update(g.world, C2.SIM_DT);
        const ax = b.x * 2 - b.x2, ay = b.y * 2 - b.y2;
        const nx = -(b.y2 - ay), ny = b.x2 - ax, nL = Math.hypot(nx, ny) || 1;
        /* AN EMPTY FIELD FIRST. A live match already has an army, and with the banner on the
         * wall every one of them joins the roster — ranked by id, so a man created last is
         * last in the queue and waits at the foot. That is the cap doing its job; it just
         * makes for a test about the wrong thing. */
        g.world.units.length = 0;
        /* one man right against the wall, one well behind it. ARCHERS: stone is for shooters
         * now, and a swordsman ordered to a curtain stations at its FOOT however close he
         * stands — which is a different test, one suite along. */
        const mk = (off) => {
          const d = C2.UNITS.archer;
          const u = { id: g.world.nextId++, owner: 0, kind: 'archer',
                      x: b.x + (nx / nL) * off, y: b.y + (ny / nL) * off, ox: 0, oy: 0,
                      hp: 100, maxHp: 100, dmg: d.dmg, cd: 0, goal: null, co: 0, from: -1 };
          g.world.units.push(u); return u;
        };
        const on = mk(C2.WALL.man * 0.4), off = mk(C2.WALL.man + 70);
        /* YOU MAN A WALL BY BEING ORDERED TO IT — manning is a roster now, not a matter of
         * standing close enough — so the man on the parapet needs the War Banner planted on
         * the run, and the reserve behind it needs a standard of its own to be held back by.
         * One banner per heir, so two men of one seat cannot be given two orders any other way. */
        g.world.players[0].banner = { x: b.x, y: b.y, site: -1 };
        g.world.players[0].companies.push({ id: 77, rally: { x: off.x, y: off.y, site: -1 } });
        off.co = 77;
        /* HE WALKS ONTO IT. A berth is an errand the roster hands him and being ON the stone is
         * something he arrives at (see `postAll`), so one tick puts him under orders and no more
         * — the run is hundreds long and his place is not where he happens to be standing.
         * Stepped until he gets there, and the renderer is asked afterwards. */
        for (let i = 0; i < 40 * 30; i++) window.World.update(g.world, C2.SIM_DT);
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        /* screen y RISES up the page, so a man standing on a wall projects HIGHER than the
         * ground he would otherwise stand on */
        /* the lift itself, read off the renderer's own instance matrices rather than
         * re-derived — and read in the SAME step, because the man is under his banner's
         * orders and walks off the wall a second later */
        const im = R.debugUnitMeshes()['archer#1'];
        const m = new window.THREE.Matrix4(), v3 = new window.THREE.Vector3();
        const heightNear = (u) => {
          const gy = R.groundH(u.x, u.y);
          let best = 0;
          for (let i = 0; i < im.count; i++) {
            im.getMatrixAt(i, m); v3.setFromMatrixPosition(m);
            if (Math.hypot(v3.x - u.x, v3.z - u.y) < 45) best = Math.max(best, v3.y - gy);
          }
          return best;
        };
        /* the heading the renderer gave him, against the wall's own outward normal */
        const ux = (b.x2 - ax) / (Math.hypot(b.x2 - ax, b.y2 - ay) || 1);
        const uy = (b.y2 - ay) / (Math.hypot(b.x2 - ax, b.y2 - ay) || 1);
        const c2 = g.world.map.sites[g.world.map.cities[0]];
        let ox = -uy, oy = ux;
        if (ox * (c2.x - b.x) + oy * (c2.y - b.y) > 0) { ox = -ox; oy = -oy; }
        const want = Math.atan2(ox, oy);
        let got = null;
        for (let i = 0; i < im.count; i++) {
          im.getMatrixAt(i, m); v3.setFromMatrixPosition(m);
          if (Math.hypot(v3.x - on.x, v3.z - on.y) < 45 && v3.y > R.groundH(on.x, on.y) + 10) {
            const e = new window.THREE.Euler().setFromRotationMatrix(m);
            got = Math.atan2(Math.sin(e.y - want), Math.cos(e.y - want));   // signed error
          }
        }
        return { man: on.man || 0, manOff: off.man || 0,
                 lift: heightNear(on), flat: heightNear(off), facing: got };
      });
      ok('the sim puts the man at the wall ON the wall', climbed.man > 0, climbed.man);
      /* `facing` is the SIGNED error between the heading the renderer gave him and the
       * wall's own outward normal — so this fails both when he is turned the wrong way and
       * when he is merely pointing along his last march. */
      ok('...and he faces out over it, not along his last march',
         climbed.facing != null && Math.abs(climbed.facing) < 0.2,
         climbed.facing == null ? 'no instance found' : `off by ${climbed.facing.toFixed(2)} rad`);
      ok('...and leaves the man behind it on the ground', climbed.manOff === 0, climbed.manOff);
      ok('and the renderer draws him up on the walkway', climbed.lift > 15,
         `on the wall ${climbed.lift.toFixed(1)} above ground, behind it ${climbed.flat.toFixed(1)}`);
      ok('...while the man behind it stays on the grass', climbed.flat < 8, climbed.flat.toFixed(1));

      /* A WALL FOLLOWS THE GROUND, AND IS NOT BURIED BY IT. Every course used to be placed
       * at the height of the run's MIDPOINT — the per-course ground height was computed and
       * then never used — so on any slope half the wall was underground and half hung in the
       * air, and the comment above it claimed otherwise. This walks the finished mesh against
       * the terrain the renderer itself reports, which is the only way to catch it. */
      const sit = await pg.evaluate(async () => {
        const R = window.Render, W = window.World, g = window.Game.game;
        const pl = g.world.players[0];
        pl.essence = 99000;
        for (const b of pl.buildings) { b.raise = 0; b.work = 0; }
        const c = g.world.map.sites[g.world.map.cities[0]];
        /* pick the LEGAL run with the most fall along it — a flat wall proves nothing */
        let best = null, drop = -1;
        for (let a2 = 0; a2 < 6.283; a2 += 0.2) {
          for (let rr = 130; rr <= 260; rr += 25) {
            const half = Math.min(70, W.wallReach(g.world, 0) / 2 - 4);
            const mx = c.x + Math.cos(a2) * rr, my = c.y + Math.sin(a2) * rr;
            const px = -Math.sin(a2) * half, py = Math.cos(a2) * half;
            const A = { x: mx - px, y: my - py }, B = { x: mx + px, y: my + py };
            if (W.wallError(g.world, 0, A.x, A.y, B.x, B.y)) continue;
            let lo = Infinity, hi = -Infinity;
            for (let k = 0; k <= 8; k++) {
              const h = R.groundH(A.x + (B.x - A.x) * k / 8, A.y + (B.y - A.y) * k / 8);
              lo = Math.min(lo, h); hi = Math.max(hi, h);
            }
            if (hi - lo > drop) { drop = hi - lo; best = [A, B]; }
          }
        }
        if (!best) return null;
        const r2 = W.applyCommand(g.world, 0, { c: 'build', bt: 'wall',
          x: best[0].x, y: best[0].y, x2: best[1].x, y2: best[1].y });
        if (!r2.ok) return { err: r2.err };
        const wall = pl.buildings.filter((b) => b.bt === 'wall').pop();
        wall.raise = 0;
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        /* walk the MESH: for each point along the run, find the stone above and below it */
        const grp = R.debugWorkGroup && R.debugWorkGroup(wall.id);
        if (!grp) return { err: 'no group' };
        const pos = grp.mesh.geometry.attributes.position;
        const m = grp.matrix;
        const v = new window.THREE.Vector3();
        const pts = [];
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m);
          pts.push([v.x, v.y, v.z]);
        }
        const ends = W.wallEnds(wall);
        let worstBury = -1e9, worstFloat = -1e9, n = 0;
        for (let k = 1; k < 12; k++) {
          const f = k / 12;
          const sx = ends[0] + (ends[2] - ends[0]) * f, sz = ends[1] + (ends[3] - ends[1]) * f;
          const gy = R.groundH(sx, sz);
          let top = -1e9, bot = 1e9;
          for (const [x, y, z] of pts) {
            if (Math.hypot(x - sx, z - sz) > 12) continue;
            if (y > top) top = y;
            if (y < bot) bot = y;
          }
          if (top === -1e9) continue;
          n++;
          worstBury = Math.max(worstBury, gy - top);    // ground above the stone = buried
          worstFloat = Math.max(worstFloat, bot - gy);  // stone above the ground = floating
        }
        return { drop, n, worstBury, worstFloat };
      });
      ok('a run with real fall along it was found to test', sit && sit.n > 6 && sit.drop > 3,
         JSON.stringify(sit));
      if (sit && sit.n) {
        ok('no part of the wall is buried by the ground it crosses', sit.worstBury < -14,
           `the ground comes within ${(-sit.worstBury).toFixed(1)} of the parapet at worst`);
        ok('...and no part of it floats above the ground', sit.worstFloat < 1,
           `stone hangs ${sit.worstFloat.toFixed(1)} above the ground at worst`);
      }

      /* THE GATEWAY AND THE RUIN, on screen. A gate you cannot see is a wall your columns
       * appear to walk through at one arbitrary spot; a ruin drawn as a wall is a lie about
       * where you are safe. Both are read off the model's own geometry. */
      const shapes = await pg.evaluate(async () => {
        const R = window.Render, W = window.World, g = window.Game.game;
        const wall = g.world.players[0].buildings.filter((b) => b.bt === 'wall').pop();
        wall.raise = 0; wall.breach = 0; wall.hp = wall.maxHp;
        const paint = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        await paint();
        const whole = R.debugWorkGroup(wall.id);
        const wholeV = whole && whole.mesh.geometry.attributes.position.count;
        const wholeKey = R.debugWorks(wall.id).key;
        /* the parapet must be LOWER over the gateway than beside it */
        const pos = whole.mesh.geometry.attributes.position, m = whole.matrix;
        const v = new window.THREE.Vector3();
        let atGate = -1e9, away = -1e9;
        const ends = W.wallEnds(wall);
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m);
          const d = Math.hypot(v.x - wall.x, v.z - wall.y);
          if (d < 12) atGate = Math.max(atGate, v.y);
          else if (d > 45) away = Math.max(away, v.y);
        }
        /* now break it */
        W.hurtBuilding(g.world, 0, wall.id, 1e9, 1);
        await paint();
        const ruin = R.debugWorkGroup(wall.id);
        return { wholeKey, ruinKey: R.debugWorks(wall.id) && R.debugWorks(wall.id).key,
                 wholeV, ruinV: ruin && ruin.mesh.geometry.attributes.position.count,
                 atGate, away, breach: !!wall.breach,
                 /* THIS wall's own standing, not the board's — a live match may have other
                  * curtains up, and anyWall would answer for them instead */
                 standing: g.world.walls.some((q) => q.b.id === wall.id) };
      });
      ok('the parapet breaks open over the gateway', shapes.atGate < shapes.away - 8,
         `gate top ${shapes.atGate.toFixed(1)} vs wall top ${shapes.away.toFixed(1)}`);
      ok('a breached wall is still on the board', shapes.breach && shapes.ruinKey != null);
      ok('...but bars nothing', shapes.standing === false, 'still in the standing list');
      ok('...and is drawn as a ruin, not a wall', shapes.ruinKey !== shapes.wholeKey,
         `${shapes.wholeKey} -> ${shapes.ruinKey}`);
      ok('...with the parapet gone off it', shapes.ruinV < shapes.wholeV,
         `${shapes.wholeV} -> ${shapes.ruinV} verts`);

      /* A TOWER IN THE WALL stands ON it — drawn on the parapet, not in the grass beside it,
       * and keyed apart from an ordinary tower so raising one rebuilds the model. */
      const inWall = await pg.evaluate(async () => {
        const R = window.Render, W = window.World, g = window.Game.game;
        const pl = g.world.players[0];
        pl.essence = 99000;
        const wall = pl.buildings.filter((b) => b.bt === 'wall').pop();
        /* the block above BREACHED this run. Clearing the flag by hand leaves the standing
         * list stale — and a tower cannot be built into a wall the sim does not think is
         * there — so mend it properly and let the masons finish. */
        for (const b of pl.buildings) { b.raise = 0; b.work = 0; b.fixing = 0; }
        if (wall.breach) {
          const f = W.applyCommand(g.world, 0, { c: 'fix', id: wall.id });
          if (!f.ok) return { err: 'fix:' + f.err };
          for (let i = 0; i < 30 * 60 && wall.work > 0; i++) window.World.update(g.world, window.CONST.SIM_DT);
        }
        if (wall.breach) return { err: 'still breached' };
        const ends = W.wallEnds(wall);
        /* SEARCHED ALONG THE RUN, not picked — and the yard is cleared of the towers earlier
         * suites left standing around the Seat first. A run may pass within a tower's own
         * clearance of one of them, which makes stretches of it legitimately crowded and reads
         * as 'a tower cannot join a wall' when the rule is working exactly as intended. */
        const segD2 = (b, px, py) => {
          const ax = b.x * 2 - b.x2, ay = b.y * 2 - b.y2;
          const vx = b.x2 - ax, vy = b.y2 - ay, L2 = vx * vx + vy * vy || 1;
          let t = ((px - ax) * vx + (py - ay) * vy) / L2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = ax + vx * t, qy = ay + vy * t;
          return (px - qx) * (px - qx) + (py - qy) * (py - qy);
        };
        /* every point-shaped work of ours near the run goes, not just the towers: the yard the
         * earlier suites leave behind is what makes stretches of the run legitimately crowded,
         * and this suite is about the tower/wall rule rather than about the clutter */
        for (let i = pl.buildings.length - 1; i >= 0; i--) {
          const b2 = pl.buildings[i];
          if (b2.x2 != null || b2 === wall) continue;
          if (segD2(wall, b2.x, b2.y) < 160 * 160) pl.buildings.splice(i, 1);
        }
        let r2 = { ok: false, err: 'nospot' };
        const frac = [];
        for (let k = 0; k <= 24; k++) frac.push((k % 2 ? -1 : 1) * (k / 48));
        for (const f of frac) {
          const at = { x: wall.x + (ends[2] - ends[0]) * f, y: wall.y + (ends[3] - ends[1]) * f };
          r2 = W.applyCommand(g.world, 0, { c: 'build', bt: 'tower', x: at.x, y: at.y });
          if (r2.ok) break;
        }
        if (!r2.ok) return { err: r2.err };
        const tw = pl.buildings.filter((b) => b.bt === 'tower').pop();
        tw.raise = 0;
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        const wk = R.debugWorks(tw.id);
        const grp = R.debugWorkGroup(tw.id);
        let lo = 1e9;
        const pos = grp.mesh.geometry.attributes.position, m = grp.matrix;
        const v = new window.THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m);
          lo = Math.min(lo, v.y);
        }
        return { onWall: tw.onWall === wall.id, key: wk && wk.key, foot: lo - R.groundH(tw.x, tw.y) };
      });
      ok('a tower can be raised into the wall', inWall.onWall, inWall.err || JSON.stringify(inWall));
      ok('...and is drawn standing on it', inWall.foot > 15, `its foot is ${(inWall.foot || 0).toFixed(1)} above the ground`);
      ok('...with a model of its own', /=/.test(inWall.key || ''), inWall.key);

      /* the minimap must carry the run: it is the only place on a phone where the SHAPE of
       * a defence can be read at all */
      const onMini = await pg.evaluate(() => {
        const R = window.Render, g = window.Game.game;
        const w = g.world.players[0].buildings.filter((b) => b.bt === 'wall');
        const b = w[w.length - 1];
        const m = R.miniBox(), C2 = window.CONST;
        const mp = (x, y) => ({ x: m.mx + (x / C2.MAP.W) * m.mw, y: m.my + (y / C2.MAP.H) * m.mh });
        const a2 = mp(b.x * 2 - b.x2, b.y * 2 - b.y2), b2 = mp(b.x2, b.y2);
        return Math.hypot(b2.x - a2.x, b2.y - a2.y);
      });
      ok('the run is long enough on the minimap to read as a line', onMini > 3, `${onMini.toFixed(1)}px`);

      /* and the back button must let go of a half-placed run */
      await pg.evaluate(() => {
        const c = window.Game.game.world.map.sites[window.Game.game.world.map.cities[0]];
        window.Game.game.span = { x: c.x + 120, y: c.y, bt: 'wall' };
        window.Render.span = { x: c.x + 120, y: c.y };
      });
      await pg.goBack(); await pg.waitForTimeout(250);
      const dropped = await pg.evaluate(() => ({ span: !!window.Game.game.span,
                                                 rspan: !!window.Render.span,
                                                 mode: window.Game.game.mode }));
      ok('back cancels a half-placed run before it leaves the match', !dropped.span && !dropped.rspan);
      ok('...and stays in the match to do it', dropped.mode !== null, dropped.mode);
    }

    /* ---------------- the sheet stays live, and a site is not a build tray ---------------- *
     * The tray used to belong to a patch of GROUND — you tapped a spring, and the cards could
     * say why that spring refused a Gate. Building is choose-then-place now: the button arms a
     * work and the next tap puts it down, so a site sheet carrying its own build tray was a
     * second, contradictory way to build that ignored whatever you were already holding.
     * A site says what it IS and who holds it. What still changes under an open sheet is the
     * PURSE and the YARD, and both must reach the card without it being reopened. */
    /* WHICH FACE OF A RUN SHELTERS IS THE HEIR'S TO SAY. The sim guesses it from where the
     * owner's Seat lies, which is right for the one curtain across the road home and wrong for
     * a run around a forward spring or along a flank — there it stations the whole reserve in
     * the open. The order that overrules it has to be reachable from the wall's own sheet,
     * including while the masons are still on the run: when a wall faces is exactly the thing
     * worth settling before it is finished. */
    suite(`${r} · a wall can be turned about`);
    await pg.evaluate(() => { window.UI.closeSheet(); window.Game.game.armedFlag = null; });
    const flip = await pg.evaluate(async () => {
      const W = window.World, g = window.Game.game, pl = g.world.players[0];
      const c = g.world.map.sites[g.world.map.cities[0]];
      pl.essence = 99000;
      for (const b of pl.buildings) { b.raise = 0; b.work = 0; b.fixing = 0; }
      const had = pl.buildings.length;         // this suite tidies up after itself
      let wall = null;
      for (let rad = 150; rad < 300 && !wall; rad += 20)
        for (let a2 = 0; a2 < 6.283 && !wall; a2 += 0.2) {
          const half = Math.min(70, W.wallReach(g.world, 0) / 2 - 4);
          const mx = c.x + Math.cos(a2) * rad, my = c.y + Math.sin(a2) * rad;
          const px = -Math.sin(a2) * half, py = Math.cos(a2) * half;
          if (W.applyCommand(g.world, 0, { c: 'build', bt: 'wall', x: mx - px, y: my - py,
                                           x2: mx + px, y2: my + py }).ok)
            wall = pl.buildings.filter((b) => b.bt === 'wall').pop();
        }
      if (!wall) return { err: 'no run' };
      const out = {};
      /* A SHEET IGNORES ITS FIRST THIRD OF A SECOND — the tap that opened it must not also
       * choose a card on a phone (ui.js swallows clicks inside 320ms of `_openedAt`). A test
       * that clicks in the same tick is testing nothing, silently: the event never reaches the
       * button, no error is raised, and the assertion below simply reports that the order did
       * not take. So the wait is part of the test, not padding around it. */
      const settle = () => new Promise((res) => setTimeout(res, 400));
      /* while the masons are still in it */
      window.UI.upSheet(wall, pl.essence, false, pl);
      out.onScaffold = !!document.getElementById('wall-flip');
      window.UI.closeSheet();
      wall.raise = 0; wall.hp = wall.maxHp;
      window.UI.upSheet(wall, pl.essence, false, pl);
      out.onFinished = !!document.getElementById('wall-flip');
      out.was = !!wall.flip;
      await settle();
      document.getElementById('wall-flip').click();
      out.now = !!wall.flip;
      /* ...and it is a state, not a toggle: the button asks for the opposite of what IS */
      window.UI.upSheet(wall, pl.essence, false, pl);
      await settle();
      document.getElementById('wall-flip').click();
      out.back = !!wall.flip;
      /* no other work offers it — it is an order about a RUN */
      const hall = pl.buildings.find((b) => b.bt === 'barracks');
      if (hall) { window.UI.upSheet(hall, pl.essence, false, pl); out.onHall = !!document.getElementById('wall-flip'); }
      window.UI.closeSheet();
      pl.buildings.length = had;
      return out;
    });
    ok('the wall sheet offers the order once the run stands', flip.onFinished, JSON.stringify(flip));
    ok('...and while the masons are still on it', flip.onScaffold, JSON.stringify(flip));
    ok('tapping it turns the run about', flip.was === false && flip.now === true, JSON.stringify(flip));
    ok('...and tapping it again turns it back', flip.back === false, JSON.stringify(flip));
    ok('nothing but a run is offered it', flip.onHall === false || flip.onHall === undefined,
       String(flip.onHall));

    /* ---- A HALL'S STANDARD READS FIRST, AND IT READS WHILE THE MASONS ARE ON IT ----
     * Reported from play. It was a line of small print near the bottom of the sheet, under the
     * upgrade card and the valve — and it was not there AT ALL while the hall was rising or
     * re-tooling, because that path returns early with nothing but the countdown. Which is
     * exactly when it is wanted: a hall under the masons is a hall you are deciding about. */
    const hf = await pg.evaluate(async () => {
      const g = window.Game.game, pl = g.world.players[0], W = window.World;
      const hall = pl.buildings.find((b) => b.bt === 'barracks');
      if (!hall) return { err: 'no hall' };
      const seen = (tag) => {
        const f = document.querySelector('#sheet .sheet-flag');
        if (!f) return { tag, has: false };
        const sheet = document.getElementById('sheet');
        const cards = [...sheet.querySelectorAll('.card')];
        const fy = f.getBoundingClientRect().top;
        const valve = document.getElementById('co-muster');
        return { tag, has: true, text: f.textContent,
                 colour: (f.querySelector('.sf-name') || {}).style ? f.querySelector('.sf-name').style.color : '',
                 aboveEveryCard: cards.every((c) => c.getBoundingClientRect().top >= fy),
                 valve: !!valve,
                 /* the ONE order on this sheet given in a hurry: it must be the first card */
                 valveFirst: !!valve && cards.length > 0 && cards[0] === valve };
      };
      window.UI.upSheet(hall, pl.essence, false, pl);
      const idle = seen('idle');
      /* now put the masons on it and open it again */
      const wasWork = hall.work, wasFor = hall.workFor;
      hall.work = 12; hall.workFor = 12;
      window.UI.upSheet(hall, pl.essence, false, pl);
      const busy = seen('under the masons');
      hall.work = wasWork; hall.workFor = wasFor;
      window.UI.closeSheet();
      return { idle, busy, co: hall.co };
    });
    ok('the hall sheet shows its standard', hf.idle && hf.idle.has, JSON.stringify(hf.idle));
    ok('...naming the company, in its own colour',
       !!(hf.idle && /Standard\s*\d/.test(hf.idle.text) && hf.idle.colour),
       JSON.stringify(hf.idle));
    ok('...above every card on the sheet, not under them',
       !!(hf.idle && hf.idle.aboveEveryCard), JSON.stringify(hf.idle));
    /* THE ASSERTION THAT FAILS ON THE OLD CODE — the masonry path returned before it */
    ok('and it is still there while the masons are on the hall',
       !!(hf.busy && hf.busy.has && /Standard\s*\d/.test(hf.busy.text)), JSON.stringify(hf.busy));
    ok('the muster valve rides with it, first card and present under the masons',
       !!(hf.idle && hf.idle.valveFirst && hf.busy && hf.busy.valve),
       `idle ${JSON.stringify(hf.idle && hf.idle.valveFirst)}, busy ${JSON.stringify(hf.busy && hf.busy.valve)}`);

    suite(`${r} · the sheet stays live`);
    await pg.evaluate(() => { window.UI.closeSheet(); window.Game.game.armedFlag = null; });
    const live = await pg.evaluate(async () => {
      const g = window.Game.game;
      const pl = g.world.players[0];
      for (const b of pl.buildings) { b.raise = 0; b.work = 0; b.fixing = 0; }
      const dear = Object.entries(window.CONST.BUILDINGS)
        .filter(([k]) => window.CONST.BUILD_ORDER_UI.includes(k))
        .sort((a, b) => b[1].cost - a[1].cost)[0];
      pl.essence = dear[1].cost - 20;              // one card out of reach, the rest in it
      window.UI.buildSheet(pl.essence, pl);
      const card = () => document.querySelector(`#sheet .card[data-bt="${dear[0]}"]`);
      const lockedPoor = card() && card().classList.contains('locked');
      /* the war chest catches up while you are looking at it */
      pl.essence = dear[1].cost + 50;
      window.UI.tick(pl.essence);
      await new Promise((res) => requestAnimationFrame(res));
      return { bt: dear[0], cost: dear[1].cost, lockedPoor,
               stillOpen: window.UI.sheetOpen(),
               freeNow: card() && !card().classList.contains('locked') };
    });
    /* WHAT A HALL COSTS TO KEEP. The stone price is once; the muster drain is for ever, and it
     * was nowhere on the card that sells the hall — reported from play. The assertion reads the
     * table's own numbers, so re-pricing a recruit cannot rot it. */
    const drain = await pg.evaluate(() => {
      const C = window.CONST, g = window.Game.game, pl = g.world.players[0];
      window.UI.buildSheet(9999, pl);
      const card = (bt) => document.querySelector(`#sheet .card[data-bt="${bt}"]`);
      const want = (C.UNITS[C.BUILDINGS.barracks.spawns].cost / C.BUILDINGS.barracks.period[0]).toFixed(1);
      const out = { want,
        hall: card('barracks') && card('barracks').textContent,
        gate: card('gate') && card('gate').textContent };
      window.UI.closeSheet();
      return out;
    });
    ok('a hall\'s card says what its muster drains', !!drain.hall && drain.hall.indexOf(`−${drain.want}◆/s`) >= 0,
       `wanted −${drain.want}◆/s in: ${drain.hall}`);
    ok('...and a Gate\'s says what it earns', !!drain.gate && /\+.*◆\/s/.test(drain.gate), drain.gate);

    ok('the dearest card is locked while the purse is short', live.lockedPoor,
       `${live.bt} at ${live.cost}`);
    ok('the sheet is still the one you opened', live.stillOpen);
    ok('and it goes live when the essence arrives, without reopening', live.freeNow);
    await pg.evaluate(() => window.UI.closeSheet());

    /* A SPRING IS NOT A BUILD MENU. Reported from play. */
    const springTap = await pg.evaluate(async () => {
      const R = window.Render, g = window.Game.game;
      const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      R.setZoom(1);
      const lid = window.innerHeight - 20;
      /* LOOK AT each spring in turn rather than hoping one is near the Seat: the tap has to
       * REACH the site, and game.js tries your men and your works first, so a spring with a
       * soldier on it answers with his standard and one beside a Gate answers with the Gate. */
      for (const s2 of g.world.map.sites) {
        if (s2.kind !== 'node') continue;
        R.lookAt(s2.x, s2.y);
        await frame();
        const p = R.project(s2.x, s2.y);
        if (!(p.x > 40 && p.x < window.innerWidth - 40 && p.y > 100 && p.y < lid)) continue;
        if (R.hitSite(p.x, p.y, g.world, 0, false) !== s2.id) continue;
        if (R.hitUnit(p.x, p.y, 0) > 0 || R.hitBuilding(p.x, p.y) >= 0) continue;
        return { ok: true, x: p.x, y: p.y, name: s2.name };
      }
      return { ok: false };
    });
    ok('a spring can be found on screen to tap', springTap.ok);
    if (springTap.ok) {
      await pg.evaluate(({ x, y }) => {
        const cvs = document.getElementById('game');
        for (const t of ['pointerdown', 'pointerup'])
          cvs.dispatchEvent(new PointerEvent(t, { pointerId: 9, clientX: x, clientY: y, bubbles: true }));
      }, { x: springTap.x, y: springTap.y });
      await pg.waitForTimeout(200);
      const sheet = await pg.evaluate(() => ({
        open: window.UI.sheetOpen(),
        title: (document.querySelector('#sheet .sheet-title') || {}).textContent || '',
        cards: document.querySelectorAll('#sheet .card[data-bt]').length,
        armed: !!window.Game.game.placing
      }));
      ok('tapping it tells you what it is', sheet.open && /\S/.test(sheet.title), sheet.title);
      ok('...and offers no works to raise', sheet.cards === 0, `${sheet.cards} build cards`);
      ok('...and arms nothing', !sheet.armed);
      await pg.evaluate(() => window.UI.closeSheet());
      await pg.waitForTimeout(120);
    }

    /* ---------------- the Shrine's sheet ---------------- */
    suite(`${r} · the Shrine`);
    await pg.evaluate(() => { window.UI.closeSheet(); window.Game.game.armedFlag = null; });
    const shrine = await pg.evaluate(() => {
      const W = window.World, C = window.CONST, g = window.Game.game;
      const c = g.world.map.sites[g.world.map.cities[0]];
      g.world.players[0].essence = 999999;
      window.__step(40, { raising: true });
      let sh = g.world.players[0].buildings.find((q) => q.bt === 'shrine');
      if (!sh) {
        let at = null;
        for (let rad = 170; rad < C.CLAIM.seat - 40 && !at; rad += 20)
          for (let a = 0; a < 40 && !at; a++) {
            const th = a / 40 * Math.PI * 2, x = c.x + Math.cos(th) * rad, y = c.y + Math.sin(th) * rad;
            if (W.placementError(g.world, 0, x, y, 'shrine') === null) at = { x, y };
          }
        if (!at) return { ok: false, why: 'nowhere to raise a Shrine' };
        W.applyCommand(g.world, 0, { c: 'build', ...at, bt: 'shrine' });
        window.__step(40, { raising: true });
        sh = g.world.players[0].buildings.find((q) => q.bt === 'shrine');
      }
      window.UI.upSheet(sh, g.world.players[0].essence, false, g.world.players[0]);
      const txt = document.getElementById('sheet').textContent;
      return { ok: true, upgrade: /Upgrade to level/i.test(txt), walk: /Walk the Pattern/i.test(txt) };
    });
    ok('a Shrine stands', shrine.ok, shrine.why || '');
    if (shrine.ok) {
      ok('its sheet offers no upgrade — there is none', !shrine.upgrade);
      ok('and still offers the walk', shrine.walk);
    }
    await pg.evaluate(() => window.UI.closeSheet());

    /* ---------------- the race board ---------------- *
     * A walk is public: the Shrine lights up for everyone, and every walker's count belongs
     * on screen where all of them can read it. */
    suite(`${r} · the race`);
    await pg.evaluate(() => { window.UI.closeSheet(); window.Game.game.armedFlag = null; });
    const race = await pg.evaluate(() => {
      const W = window.World, C = window.CONST, g = window.Game.game;
      g.world = W.createWorld(4242, 3);
      const shrines = [];
      for (const pi of [1, 2]) {
        const c = W.cityOf(g.world, pi);
        g.world.players[pi].essence = 999999;
        let at = null;
        for (let rad = 170; rad < C.CLAIM.seat - 40 && !at; rad += 20)
          for (let a = 0; a < 40 && !at; a++) {
            const th = a / 40 * Math.PI * 2, x = c.x + Math.cos(th) * rad, y = c.y + Math.sin(th) * rad;
            if (W.placementError(g.world, pi, x, y, 'shrine') === null) at = { x, y };
          }
        if (!at) return { ok: false, why: 'no room for a Shrine at seat ' + pi };
        W.applyCommand(g.world, pi, { c: 'build', ...at, bt: 'shrine' });
        for (let i = 0; i < 30 * 40 && g.world.players[pi].buildings.some((q) => q.raise > 0); i++) W.update(g.world, C.SIM_DT);
        W.applyCommand(g.world, pi, { c: 'walk', on: true });
        shrines.push(at);
      }
      for (let i = 0; i < 30 * 40; i++) {
        for (const p of g.world.players) p.essence = Math.max(p.essence, 50000);
        for (const c of g.world.cities) c.hp = c.maxHp;
        W.update(g.world, C.SIM_DT); g.world.events.length = 0;
      }
      return { ok: true, shrines,
               sees: shrines.map((s) => W.canSee(g.world, 0, s.x, s.y)),
               walking: g.world.players.map((p) => p.walking) };
    });
    ok('two rivals are walking', race.ok && race.walking && race.walking[1] && race.walking[2], race.why || '');
    if (race.ok) {
      ok('seat 0 can see BOTH burning Shrines', race.sees.every(Boolean), JSON.stringify(race.sees));
      await pg.waitForTimeout(400);
      const board = await pg.evaluate(() => {
        const rows = [...document.querySelectorAll('#walkers .walker')];
        const mini = window.Render.miniBox();
        const last = rows.length ? rows[rows.length - 1].getBoundingClientRect().bottom : 0;
        return { n: rows.length, texts: rows.map((e) => e.textContent),
                 colours: [...new Set(rows.map((e) => e.style.color))].length,
                 miniTop: mini.my, lastBottom: last };
      });
      ok('the board lists every walker', board.n === 2, board.texts.join(' | '));
      ok('each in a colour of their own', board.colours === 2, `${board.colours} colours`);
      ok('and each shows a percentage', board.texts.every((t) => /\d+%/.test(t)), board.texts.join(' | '));
      ok('the minimap makes room for it rather than overlapping',
         board.miniTop >= board.lastBottom, `map top ${board.miniTop}, board bottom ${Math.round(board.lastBottom)}`);

      /* ---- GROUND ALREADY PAID FOR STAYS ON THE BOARD ----
       * The one thing that turns `walking` off is a Shrine thrown down, and the panel filtered
       * on `walking` — so an heir who had banked most of a walk and just lost his Shrine
       * VANISHED from every board at the table, reading as though he had never set foot on it.
       * He keeps everything past `breakLoss` and carries on from there the moment he raises
       * another Shrine, so the count is still owed. Nothing new crosses the wire for it:
       * `pattern` already rides for a revealed heir walking or not, which is exactly why the
       * board could afford to be wrong about it in silence. */
      const fell = await pg.evaluate(async () => {
        const W = window.World, C = window.CONST, g = window.Game.game, pl = g.world.players[1];
        /* far enough along that `breakLoss` cannot sweep the whole count away — the assertion
         * below is about ground he KEEPS, so there has to be some */
        for (let i = 0; i < 30 * 400 && pl.pattern < C.BUILDINGS.shrine.breakLoss * 2.2; i++) {
          for (const p of g.world.players) p.essence = Math.max(p.essence, 50000);
        for (const c of g.world.cities) c.hp = c.maxHp;
          W.update(g.world, C.SIM_DT); g.world.events.length = 0;
        }
        const before = pl.pattern;
        const sh = pl.buildings.find((b) => b.bt === 'shrine');
        W.hurtBuilding(g.world, 1, sh.id, sh.hp + 1, 0);
        g.world.events.length = 0;
        await new Promise((res) => setTimeout(res, 450));
        const rows = [...document.querySelectorAll('#walkers .walker')];
        return { before, after: pl.pattern, walking: pl.walking, revealed: pl.revealed,
                 n: rows.length, texts: rows.map((e) => e.textContent),
                 dim: rows.filter((e) => e.classList.contains('stalled')).length };
      });
      ok('the rig is alive: the Shrine fell and tore him off the Pattern',
         fell.walking === false && fell.after > 0 && fell.after < fell.before,
         `walking=${fell.walking}, ${fell.before.toFixed(0)}% → ${fell.after.toFixed(0)}%`);
      /* THE ASSERTION THAT FAILS ON THE OLD CODE — the row disappeared entirely */
      ok('...and his banked ground is still on the board', fell.n === 2, fell.texts.join(' | '));
      ok('marked as off the lines, not as a walk in progress', fell.dim === 1,
         `${fell.dim} of ${fell.n} rows dimmed`);
      ok('and it reads his REDUCED count', fell.texts.some((t) => t.includes(fell.after.toFixed(0) + '%')),
         `${fell.after.toFixed(0)}% expected in ${fell.texts.join(' | ')}`);
    }

    /* ---------------- companies ---------------- *
     * A dozen halls used to mean a dozen flags. Raising one now asks which standard it
     * answers to, and the tray shows one chip per COMPANY — which is the difference between
     * three things to think about and twelve. */
    suite(`${r} · companies`);
    await pg.evaluate(() => { window.UI.closeSheet(); window.Game.game.armedFlag = null; });
    const co = await pg.evaluate(async () => {
      const W = window.World, C = window.CONST, g = window.Game.game;
      const c = g.world.map.sites[g.world.map.cities[0]];
      g.world.players[0].essence = 999999;
      window.__step(40, { raising: true });
      const free = (bt, rad) => {
        for (let a = 0; a < 48; a++) {
          const th = a / 48 * Math.PI * 2, x = c.x + Math.cos(th) * rad, y = c.y + Math.sin(th) * rad;
          if (W.placementError(g.world, 0, x, y, bt) === null) return { x, y };
        }
        return null;
      };
      const hall = (rad, want) => {
        const at = free('barracks', rad);
        if (!at) return null;
        W.applyCommand(g.world, 0, { c: 'build', ...at, bt: 'barracks', co: want });
        window.__step(40, { raising: true });
        g.world.events.length = 0;
        return g.world.players[0].buildings[g.world.players[0].buildings.length - 1];
      };
      /* EVERY HEIR OPENS WITH A HALL, and it flies a standard of its own — so this suite is
       * about the two halls IT raises, measured as a delta against whatever the board handed
       * out. Counting companies outright made the opening hall look like a bug. */
      const was = g.world.players[0].companies.length;
      const a1 = hall(190, 'new'), a2 = hall(245, null);
      if (!a1 || !a2) return { ok: false, why: 'no room for two halls' };
      const id = a1.co;
      W.applyCommand(g.world, 0, { c: 'assign', id: a2.id, co: id });
      W.update(g.world, C.SIM_DT);
      window.UI.flags({ players: g.world.players }, 0, null);
      await new Promise((res) => requestAnimationFrame(res));
      const chips = [...document.querySelectorAll('#flag-tray .fbtn')];
      const before = chips.length;
      /* post it, and see the gold chip admit that part of the army no longer answers it */
      const site = g.world.map.sites.find((q) => q.kind === 'node');
      W.applyCommand(g.world, 0, { c: 'rally', co: id, site: site.id });
      window.UI.flags({ players: g.world.players }, 0, null);
      await new Promise((res) => requestAnimationFrame(res));
      return { ok: true, halls: 2, was, companies: g.world.players[0].companies.length - was,
               chips: document.querySelectorAll('#flag-tray .fbtn').length,
               coChips: document.querySelectorAll('#flag-tray .fbtn.co').length,
               sameCo: a1.co === a2.co };
    });
    ok('the scenario set up', co.ok, co.why || '');
    if (co.ok) {
      ok('two halls can muster into ONE company', co.sameCo && co.companies === 1,
         `${co.companies} new companies for ${co.halls} halls (${co.was} already standing)`);
      ok('and the tray shows one chip for it, not one per hall', co.coChips === co.was + 1,
         `${co.coChips} company chips against ${co.was} + 1, ${co.chips} chips in all`);
      /* THE GOLD CHIP IS GONE. It moved everything and struck every standing standard the
       * moment you touched it; the tray is the army now, one flag per company. */
      ok('and there is no gold chip above them any more', co.chips === co.coChips,
         `${co.chips} chips, ${co.coChips} of them companies`);
    }

    /* ---------------- a work you can see breaking ---------------- *
     * A work's hit points were invisible until the instant it stopped existing. You could
     * watch a hall you had paid three hundred essence for be taken apart over a minute and
     * the only sign of it was the hole where it used to stand — so "pull the company back
     * before that one goes" and "that one is nearly gone, mend it" were not decisions anyone
     * could make. Damage is shown twice on purpose: in the STONE, which is what you read
     * while you are looking at the board, and on a small bar, which is what you read when you
     * want the number. Both have to be driven by hp/maxHp alone, since that is all the wire
     * carries — a guest gets no `lastHurt` and must still see the same work breaking. */
    suite(`${r} · a work you can see breaking`);
    await pg.evaluate(() => { window.UI.closeSheet(); window.Game.game.armedFlag = null; });
    const dmg = await pg.evaluate(async () => {
      const R = window.Render, C = window.CONST, g = window.Game.game, pl = g.world.players[0];
      g.world.chaosNext = 1e9;
      const paint = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      /* ITS OWN WORK, standing on the Seat's own ground. Reusing whatever happens to be left
       * over from an earlier suite meant measuring a work that might be under attack while
       * the assertions ran — and a work being hit re-arms the very flash this is timing. */
      const c = g.world.map.sites[g.world.map.cities[0]];
      const def = C.BUILDINGS.tower;
      const b = { id: g.world.nextId++, bt: 'tower', level: 1, x: c.x + 46, y: c.y + 46,
                  cd: 0, raise: 0, raiseFor: def.raise, hp: def.hp, maxHp: def.hp,
                  lastHurt: -99, node: -1, co: 0 };
      pl.buildings.push(b);
      R.lookAt(b.x, b.y);
      /* hold the masons' slow self-mending off: STRUCT_REGEN would walk the hp back over a
       * threshold mid-suite and the model would rebuild under the assertion */
      const hurtTo = (f) => { b.hp = b.maxHp * f; b.lastHurt = g.world.t; };
      const read = () => {
        const wk = R.debugWorks(b.id);
        return { key: wk && wk.key, verts: wk && wk.verts, bar: R.debugWorkBars(b.id),
                 hp: Math.round(b.hp * 100) / 100 };
      };
      b.hp = b.maxHp; b.lastHurt = g.world.t;
      await paint();
      const whole = read();
      hurtTo(0.5);
      await paint();
      const hurt = read();
      /* where the bar landed, against the projection the player actually sees */
      const ground = R.project(b.x, b.y);
      hurtTo(0.18);
      await paint();
      const ruin = read();
      /* and the flash burns down on its own. Waited on as a CONDITION: this page is running a
       * whole game under a headless GPU and a fixed sleep would be a race either way. */
      const t0 = performance.now();
      while (performance.now() - t0 < 6000) {
        await paint();
        const r2 = R.debugWorkBars(b.id);
        if (r2 && r2.flash === 0) break;
      }
      const cooled = read();
      cooled.after = Math.round(performance.now() - t0);
      /* mended: the bar goes away and the stone comes back */
      b.hp = b.maxHp; b.lastHurt = g.world.t;
      await paint();
      const mended = read();
      /* A CURTAIN IS A DIFFERENT MODEL ENTIRELY — a chain of courses built from the run's own
       * ends, not a model dropped on a spot — so it has to be shown breaking on its own terms
       * (it loses its teeth) and proved separately. */
      const W = window.World;
      pl.essence = 99000;
      for (const q of pl.buildings) { q.raise = 0; q.work = 0; q.fixing = 0; }
      const half = Math.min(70, W.wallReach(g.world, 0) / 2 - 4);
      let wl = null;
      for (let a = 0; a < 6.283 && !wl; a += 0.3) {
        for (let rr = 150; rr <= 250 && !wl; rr += 25) {
          const mx = c.x + Math.cos(a) * rr, my = c.y + Math.sin(a) * rr;
          const px = -Math.sin(a) * half, py = Math.cos(a) * half;
          if (W.wallError(g.world, 0, mx - px, my - py, mx + px, my + py)) continue;
          if (!W.applyCommand(g.world, 0, { c: 'build', bt: 'wall', x: mx - px, y: my - py,
                                            x2: mx + px, y2: my + py }).ok) continue;
          wl = pl.buildings[pl.buildings.length - 1];
          wl.raise = 0; wl.hp = wl.maxHp;
        }
      }
      let wall = null;
      if (wl) {
        R.lookAt(wl.x, wl.y);
        wl.hp = wl.maxHp; wl.lastHurt = g.world.t;
        await paint();
        const w0 = R.debugWorks(wl.id);
        wl.hp = wl.maxHp * 0.2; wl.lastHurt = g.world.t;
        await paint();
        const w1 = R.debugWorks(wl.id);
        wall = { k0: w0 && w0.key, k1: w1 && w1.key, bar: R.debugWorkBars(wl.id) };
      }
      return { ok: true, bt: b.bt, whole, hurt, ruin, cooled, mended, wall,
               wallWhy: wl ? '' : 'no legal run near the Seat, reach ' + Math.round(W.wallReach(g.world, 0)),
               ground: { x: ground.x, y: ground.y } };
    });
    ok('the scenario set up', dmg.ok, dmg.why || '');
    if (dmg.ok) {
      ok('a whole work carries no bar — the board is not a field of full bars',
         dmg.whole.bar === null, JSON.stringify(dmg.whole.bar));
      ok('a hurt work does', dmg.hurt.bar && Math.abs(dmg.hurt.bar.frac - 0.5) < 0.02,
         `frac ${dmg.hurt.bar && dmg.hurt.bar.frac}`);
      ok('and the bar rides over the stone rather than through the ground under it',
         dmg.hurt.bar && Math.abs(dmg.hurt.bar.x - dmg.ground.x) < 6 && dmg.hurt.bar.y < dmg.ground.y - 10,
         `bar at ${Math.round(dmg.hurt.bar.x)},${Math.round(dmg.hurt.bar.y)} for ground ` +
         `${Math.round(dmg.ground.x)},${Math.round(dmg.ground.y)}`);
      /* the bar alone would be a HUD element on a work you are not looking at. The stone has
       * to say it too, and it has to say it in the silhouette — rubble at the foot — not in
       * paint that vanishes at the zoom this is played at. */
      ok('the model itself is rebuilt as it is broken',
         dmg.whole.key !== dmg.hurt.key && dmg.hurt.key !== dmg.ruin.key,
         `${dmg.whole.key} -> ${dmg.hurt.key} -> ${dmg.ruin.key}`);
      ok('...and it sheds stone as it goes, so the damage is in the silhouette',
         dmg.hurt.verts > dmg.whole.verts && dmg.ruin.verts > dmg.hurt.verts,
         `${dmg.whole.verts} -> ${dmg.hurt.verts} -> ${dmg.ruin.verts} verts`);
      /* a fresh hit is a different fact from an old wound: one wants the company back NOW */
      ok('a fresh hit flashes the bar', dmg.ruin.bar && dmg.ruin.bar.flash > 0,
         `flash ${dmg.ruin.bar && dmg.ruin.bar.flash}`);
      ok('...and the flash burns down while the bar stays',
         dmg.cooled.bar && dmg.cooled.bar.flash === 0,
         `after ${dmg.cooled.after}ms: ${JSON.stringify(dmg.cooled.bar)}`);
      ok('a mended work drops its bar and its ruin', dmg.mended.bar === null &&
         dmg.mended.key === dmg.whole.key,
         `${dmg.ruin.key} -> ${dmg.mended.key}, hp ${dmg.mended.hp}/${dmg.whole.hp}, ` +
         `bar ${JSON.stringify(dmg.mended.bar)}`);
      ok('a curtain could be raised to test the run itself', !!dmg.wall, dmg.wallWhy || '');
      if (dmg.wall) {
        ok('a curtain shows it too — the run is rebuilt and carries a bar',
           dmg.wall.k0 !== dmg.wall.k1 && !!dmg.wall.bar,
           `${dmg.wall.k0} -> ${dmg.wall.k1}, bar ${JSON.stringify(dmg.wall.bar)}`);
      }
    }

    /* ---------------- the armed standard's men ---------------- *
     * Arming a standard lit a chip in the tray and changed NOTHING on the ground, so on a
     * field with three companies on it you tapped and hoped the right column moved. The men
     * of the armed company are marked instead — but the army is drawn as instanced meshes
     * bucketed `kind#tier`, and giving a subset its own geometry would split every bucket in
     * two. So the mark costs no bucket and no draw call per man: the men keep their bucket
     * and take their standard's colour per instance, and ONE more instanced mesh lays a ring
     * of that same colour on the ground under each of them. */
    suite(`${r} · the armed standard's men`);
    await pg.evaluate(() => { window.UI.closeSheet(); window.Game.game.armedFlag = null; });
    const halo = await pg.evaluate(async () => {
      const R = window.Render, C = window.CONST, g = window.Game.game;
      R.debugSlots = true;
      g.world.chaosNext = 1e9;
      const paint = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const c = g.world.map.sites[g.world.map.cities[0]];
      const pl = g.world.players[0];
      /* Two companies of KNOWN size, mustered past every id a hall has handed out — so the
       * count under test is exactly the men this suite put on the board and cannot be moved
       * by whatever the halls did while earlier suites ran. */
      const A = Math.max(0, ...pl.companies.map((q) => q.id)) + 1, B = A + 1;
      const d = C.UNITS.soldier;
      const put = (co, n, rad) => {
        const ids = [];
        for (let i = 0; i < n; i++) {
          const th = i / n * Math.PI * 2;
          const u = { id: g.world.nextId++, owner: 0, kind: 'soldier', x: c.x + Math.cos(th) * rad,
                      y: c.y + Math.sin(th) * rad, ox: 0, oy: 0, hp: d.hp, maxHp: d.hp,
                      dmg: d.dmg, cd: 0, goal: null, co, from: -1 };
          g.world.units.push(u); ids.push(u.id);
        }
        return ids;
      };
      const inA = put(A, 6, 70), inB = put(B, 4, 95);
      R.lookAt(c.x, c.y);
      g.armedFlag = null;
      await paint();
      const off = R.debugHalo();
      g.armedFlag = A;
      await paint();
      const onA = R.debugHalo();
      const litA = R.debugUnitSlot(inA[0]), unlit = R.debugUnitSlot(inB[0]);
      /* every ring has to stand on a man of that company — a mark in the wrong place is
       * worse than none. The men are still marching, so this is a nearness, not an equality. */
      let far = 0;
      for (const at of onA.at) {
        let best = 1e9;
        for (const id of inA) {
          const u = g.world.units.find((q) => q.id === id);
          if (u) best = Math.min(best, Math.hypot(at.x - u.x, at.z - u.y));
        }
        far = Math.max(far, best);
      }
      g.armedFlag = B;
      await paint();
      const onB = R.debugHalo();
      g.armedFlag = null;
      await paint();
      const off2 = R.debugHalo();
      R.debugSlots = false;
      return { nA: inA.length, nB: inB.length, far,
               off: off && off.count, offNull: off === null,
               onA: onA.count, onB: onB.count, off2: off2 && off2.count,
               colA: onA.color, colB: onB.color, coA: onA.co,
               litA, unlit, mine: g.world.units.filter((u) => u.owner === 0).length };
    });
    ok('nothing is ringed while no standard is armed', halo.offNull || halo.off === 0,
       `${halo.off} rings`);
    ok('arming a standard rings its men', halo.onA === halo.nA,
       `${halo.onA} rings for ${halo.nA} men of that company`);
    ok('...and only its men, out of a whole army on the board',
       halo.onB === halo.nB && halo.mine > halo.nA + halo.nB,
       `${halo.onB} rings for ${halo.nB} men, ${halo.mine} of yours standing`);
    ok('every ring stands on the man it marks', halo.far < 24,
       `worst ring is ${Math.round(halo.far)} from any of its men`);
    ok('the ring takes the COMPANY\'s colour, not one mark for all of them',
       halo.colA !== halo.colB, `${halo.colA.toString(16)} vs ${halo.colB.toString(16)}`);
    /* the ring is the mark you see across the board; the man's own tint is the one you see
     * when the camera is close enough to pick him out of a column */
    ok('the man himself is lit with it', halo.litA && halo.unlit &&
       (Math.abs(halo.litA.r - halo.unlit.r) + Math.abs(halo.litA.g - halo.unlit.g) +
        Math.abs(halo.litA.b - halo.unlit.b)) > 0.05,
       `armed ${JSON.stringify(halo.litA)} against unarmed ${JSON.stringify(halo.unlit)}`);
    ok('...in the same instanced bucket, so the mark costs no extra army draw call',
       halo.litA && halo.unlit && halo.litA.bucket === halo.unlit.bucket,
       `${halo.litA && halo.litA.bucket} / ${halo.unlit && halo.unlit.bucket}`);
    ok('disarming takes every ring off the board', halo.off2 === 0, `${halo.off2} rings`);

    /* ---------------- the back button ---------------- *
     * Start from a clean slate: the input suite deliberately leaves a sheet open, and a
     * tap on ground with a sheet already up DISMISSES rather than opens. */
    /* YOU GET WHAT YOU WERE POINTING AT. Men used to be asked first and won outright, so a
     * company standing on a hall made that hall unopenable — and the harder you pressed on the
     * building the more certainly you armed the men instead. */
    suite(`${r} · a work under the finger beats the men on it`);
    await pg.evaluate(() => { window.UI.closeSheet(); window.Game.game.armedFlag = null; });
    const onWork = await pg.evaluate(async () => {
      const R = window.Render, C = window.CONST, g = window.Game.game;
      const paint = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const pl = g.world.players[0];
      const hall = pl.buildings.find((b) => b.bt === 'barracks' && b.x2 == null)
                || pl.buildings.find((b) => b.x2 == null);
      if (!hall) return { skip: 'no work to stand on' };
      hall.raise = 0; hall.work = 0;
      R.lookAt(hall.x, hall.y); R.setZoom(1.6);
      await paint();
      /* A COMPANY AT THE HALL'S DOOR. Not on top of it — `stand()` pushes men off a work at
       * BUILD.pass, so nothing can occupy its centre — which is exactly the case that matters:
       * the men ring the building just outside the push, and a tap on the stone falls inside
       * BOTH their reach and the work's. */
      const co = Math.max(0, ...pl.companies.map((q) => q.id)) + 1;
      pl.companies.push({ id: co, rally: null });
      const d = C.UNITS.soldier;
      const ring = C.BUILD.pass + 2;
      const men = [];
      for (let i = 0; i < 8; i++) {
        const th = i / 8 * Math.PI * 2;
        const u = { id: g.world.nextId++, owner: 0, kind: 'soldier',
          x: hall.x + Math.cos(th) * ring, y: hall.y + Math.sin(th) * ring, ox: 0, oy: 0,
          hp: d.hp, maxHp: d.hp, dmg: d.dmg, cd: 0, goal: null, co, from: -1, tier: 1 };
        g.world.units.push(u); men.push(u);
      }
      await paint();
      /* aim between the work's centre and one of them, but NEARER the work — the finger is on
       * the stone with a man at its elbow, which is the tap that used to arm the standard */
      const m = men[0];
      const L = Math.hypot(m.x - hall.x, m.y - hall.y) || 1;
      const t = 0.42;
      const p = R.project(hall.x + (m.x - hall.x) / L * (L * t), hall.y + (m.y - hall.y) / L * (L * t), 0);
      if (!p) return { skip: 'the hall did not project' };
      const uAt = {}, bAt = {};
      const hitU = R.hitUnit(p.x, p.y, 0, uAt), hitB = R.hitBuilding(p.x, p.y, bAt);
      /* and now the tap itself, through the real handler */
      window.UI.closeSheet(); g.armedFlag = null;
      R.selected = -1;
      const ev = (type) => new PointerEvent(type, { clientX: p.x, clientY: p.y, pointerId: 1,
                                                    pointerType: 'touch', bubbles: true, isPrimary: true });
      const cv = document.getElementById('game');
      cv.dispatchEvent(ev('pointerdown')); cv.dispatchEvent(ev('pointerup'));
      await new Promise((res) => setTimeout(res, 120));
      return { hitU, hitB, hallId: hall.id, both: hitU > 0 && hitB >= 0,
               armed: g.armedFlag, selected: R.selected,
               sheet: !document.getElementById('sheet').classList.contains('hidden') };
    });
    if (onWork.skip) {
      ok('a work under the finger beats the men on it (skipped)', true, onWork.skip);
    } else {
      ok('the tap really did land on both a work and a company', onWork.both,
         `unit co ${onWork.hitU}, work ${onWork.hitB}`);
      ok('...and it is the WORK that answers', onWork.hitB === onWork.hallId && onWork.selected === onWork.hallId,
         `selected ${onWork.selected}, wanted ${onWork.hallId}`);
      ok('...its sheet opens', onWork.sheet);
      ok('...and no standard is armed by it', !onWork.armed, String(onWork.armed));
    }

    /* ---------------- a gateway that knows its own ----------------
     * A curtain's gate is the middle of the run, WALL.gate wide, punched out of the OWNER'S nav
     * layer alone — a rival reaching it finds it shut. On the board that was a hole in the
     * parapet and nothing else, which is a picture of a rule the sim does not play. Two leaves
     * hang in it now and they swing for his own men only, so what the board says about who may
     * walk through matches what the sim will let through. Read off `Render.debugGate`, because a
     * leaf is a child of a group merged into one mesh and there is nothing else to interrogate. */
    suite(`${r} · a gateway wears a gate`);
    const gate = await pg.evaluate(async () => {
      const R = window.Render, W = window.World, C = window.CONST, g = window.Game.game;
      window.UI.closeSheet(); g.armedFlag = null;
      const c = g.world.map.sites[g.world.map.cities[0]];
      g.world.players[0].essence = 99000;
      for (const b of g.world.players[0].buildings) b.raise = 0;
      R.setZoom(1); R.lookAt(c.x, c.y);
      /* LONG ENOUGH TO SPARE A GATEWAY. Below WALL.gateMin the sim leaves the run solid and
       * there is no gate to hang — a short run here would look exactly like a broken feature. */
      const half = C.WALL.gateMin / 2 + 12;
      let made = null;
      for (let a2 = 0; a2 < 6.283 && !made; a2 += 0.25) {
        for (let rr = 150; rr <= 280 && !made; rr += 25) {
          const mx = c.x + Math.cos(a2) * rr, my = c.y + Math.sin(a2) * rr;
          const px = -Math.sin(a2) * half, py = Math.cos(a2) * half;
          const A = { x: mx - px, y: my - py }, B = { x: mx + px, y: my + py };
          if (W.wallError(g.world, 0, A.x, A.y, B.x, B.y)) continue;
          const before = g.world.players[0].buildings.length;
          W.applyCommand(g.world, 0, { c: 'build', x: A.x, y: A.y, x2: B.x, y2: B.y, bt: 'wall' });
          if (g.world.players[0].buildings.length > before)
            made = g.world.players[0].buildings[g.world.players[0].buildings.length - 1];
        }
      }
      if (!made) return { err: 'no legal run long enough for a gateway' };
      /* the masons out of it: a rising run is a shell and hangs no doors */
      made.raise = 0; made.hp = made.maxHp;
      W.update(g.world, C.SIM_DT);
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      return { id: made.id, gated: !!made.gated, shut: R.debugGate(made.id), gates: R.debugGates().length };
    });
    ok('a run long enough to spare a gateway can be raised', !gate.err, gate.err || `wall ${gate.id}`);
    if (!gate.err) {
      ok('the sim says this run has a gateway', gate.gated);
      ok('...and the board hangs a gate in it', !!gate.shut, JSON.stringify(gate.shut));
      ok('...which starts shut', gate.shut && gate.shut.angle === 0 && !gate.shut.open,
         JSON.stringify(gate.shut));
      /* THE MEN ARE PARKED, so the answer is about the door and not about where the sim walked
       * them between two frames. The halt is world state and `update` returns early on it, but
       * game.js keeps rendering through it — which is exactly the rig this needs.
       *
       * THE OWNER GOES FIRST, deliberately. "A rival does not open it" is a measurement of
       * NOTHING HAPPENING, and nothing happening is what a dead rig looks like — so the door is
       * made to swing wide for its own man first, and only then is the rival walked into the
       * same doorway to watch it shut in his face. Waited on the leaf's own angle rather than a
       * fixed sleep: a headless page's frame clock is nobody's business here. */
      await pg.evaluate(([id]) => {
        const g = window.Game.game, R = window.Render;
        window.__gate = { id, keep: g.world.units.slice(), at: R.debugGate(id) };
        g.world.paused = { by: 0, at: g.world.t };
        window.__gateMan = (owner) => {
          const st = window.__gate.at;
          g.world.units.length = 0;
          if (owner < 0) return;
          g.world.units.push({ id: g.world.nextId++, owner, kind: 'soldier', x: st.x, y: st.y,
                               ox: 0, oy: 0, hp: 70, maxHp: 70, dmg: 9, cd: 0, goal: null, co: 0,
                               from: -1, tier: 1 });
        };
      }, [gate.id]);
      const leaf = () => pg.evaluate(() => window.Render.debugGate(window.__gate.id).angle);
      await pg.evaluate(() => window.__gateMan(0));
      await until(pg, () => window.Render.debugGate(window.__gate.id).angle > 1, 8000);
      const own = await leaf();
      ok('its owner\'s man swings it wide', own > 1, `leaf at ${own.toFixed(2)}`);
      /* the same doorway, the same frame loop, a different heir standing in it */
      await pg.evaluate(() => window.__gateMan(1));
      await until(pg, () => window.Render.debugGate(window.__gate.id).angle < 0.15, 12000);
      const shut = await leaf();
      ok('...and it shuts again behind him', shut < 0.15, `leaf at ${shut.toFixed(2)}`);
      await pg.waitForTimeout(400);
      const held = await pg.evaluate(() => {
        const R = window.Render, im = R.debugUnitMeshes()['soldier#1'];
        return { a: R.debugGate(window.__gate.id).angle,
                 open: R.debugGate(window.__gate.id).open,
                 foe: window.Game.game.world.units.filter((u) => u.owner === 1).length,
                 /* and he is REALLY THERE on the renderer's side of the fog: the only man on
                  * the board is the rival, so the army's own bucket must be drawing exactly
                  * him. Without this "the gate stayed shut" would also be what a rival nobody
                  * can see looks like, which is a different rule entirely. */
                 drawn: im ? im.count : 0 };
      });
      ok('the rival is on the board where the renderer can see him', held.foe === 1 && held.drawn === 1,
         `${held.foe} in the world, ${held.drawn} drawn`);
      ok('a rival pressed against it finds it shut, and keeps finding it shut',
         held.a < 0.15 && !held.open, `leaf at ${held.a.toFixed(2)}`);
      /* AND IT OPENS ONTO THE SHELTERED FACE — the one `{c:'flip'}` decides. The gate swings
       * inward, so a run its heir has turned about must swing its doors the other way, or a
       * column comes out through a leaf standing in the open. */
      const turned = await pg.evaluate(async ([id]) => {
        const R = window.Render, W = window.World, g = window.Game.game;
        window.__gateMan(0);
        const wait = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        await wait(); await wait();
        const was = R.debugGate(id).sign;
        /* the halt refuses every order but its own, so it is lifted for exactly one command
         * and put straight back — the men have not had a tick to walk anywhere */
        const halt = g.world.paused;
        g.world.paused = null;
        W.applyCommand(g.world, 0, { c: 'flip', id, on: true });
        g.world.paused = halt;
        await wait(); await wait();
        const now = R.debugGate(id);
        return { was, sign: now.sign, flipped: !!g.world.players[0].buildings.find((b) => b.id === id).flip,
                 leaf: now.la - now.ang, a: now.angle };
      }, [gate.id]);
      ok('turning the run about turns its gate with it',
         turned.flipped && turned.sign === -turned.was && Math.sign(turned.leaf) === turned.sign,
         `sign ${turned.was} -> ${turned.sign}, leaf offset ${turned.leaf.toFixed(2)}`);
      await pg.evaluate(([id]) => {
        const g = window.Game.game, halt = g.world.paused;
        g.world.paused = null;
        window.World.applyCommand(g.world, 0, { c: 'flip', id, on: false });
        g.world.paused = halt;
      }, [gate.id]);
      await pg.evaluate(() => {
        const g = window.Game.game;
        window.__gateMan(-1);
        g.world.units.push(...window.__gate.keep);
        g.world.paused = null;
      });
    }

    /* ---------------- arrows are things in the air ----------------
     * A shot was a line between two points for a fifth of a second, which is a laser. The
     * renderer owns the FLIGHT — the sim says only that the shot happened — so what is asserted
     * here is that an archer's shot enters the air, and that it LEAVES it again on arrival: a
     * pool that never retires is a leak that looks like a feature for the first ten seconds. */
    suite(`${r} · an arrow flies`);
    const flight = await pg.evaluate(async () => {
      const R = window.Render, g = window.Game.game;
      const c = g.world.map.sites[g.world.map.cities[0]];
      const shot = (extra) => R.addEvents([Object.assign(
        { e: 'bolt', from: { x: c.x, y: c.y, owner: 0 }, to: { x: c.x + 150, y: c.y + 90 } }, extra)],
        g.world, 0);
      const start = R.debugArrows();
      shot({ kind: 'archer' });
      const flying = R.debugArrows();
      /* FEATURE-DETECTED: an event with no kind, or another kind, keeps the old tracer — and
       * must not put a dart in the air */
      shot({});
      shot({ kind: 'sorcerer' });
      const stillOne = R.debugArrows();
      await new Promise((res) => setTimeout(res, 1200));
      return { start, flying, stillOne, landed: R.debugArrows() };
    });
    ok('nothing is in the air to begin with', flight.start === 0, String(flight.start));
    ok('an archer\'s shot puts a dart in the air', flight.flying === 1, String(flight.flying));
    ok('a shot with no kind, and an arcane one, keep the tracer they had',
       flight.stillOne === 1, String(flight.stillOne));
    ok('and the dart retires when it arrives', flight.landed === 0, String(flight.landed));

    /* ---------------- the chains ----------------
     * The Binding throws chains on a rival's men — a slow and an amplifier — and a hold nothing
     * marks is a rule played in secret. `u.hexed` is the expiry time and it rides the wire; the
     * renderer reads it and nothing else. Feature-detected on purpose: a man with no such field
     * wears nothing, which is what kept this quiet until the sim carried it. */
    suite(`${r} · a chained man is marked`);
    const chains = await pg.evaluate(async () => {
      const R = window.Render, g = window.Game.game;
      const paint = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const keep = g.world.units.slice();
      g.world.paused = { by: 0, at: g.world.t };
      const c = g.world.map.sites[g.world.map.cities[0]];
      const mk = (extra) => Object.assign({ id: g.world.nextId++, owner: 0, kind: 'soldier',
        x: c.x + 60, y: c.y + 60, ox: 0, oy: 0, hp: 70, maxHp: 70, dmg: 9, cd: 0, goal: null,
        co: 0, from: -1, tier: 1 }, extra);
      g.world.units.length = 0;
      g.world.units.push(mk({}));
      await paint();
      const free = R.debugHex();
      g.world.units.push(mk({ x: c.x + 90, y: c.y + 60, hexed: g.world.t + 30 }));
      await paint();
      const held = R.debugHex();
      /* an expiry the world has already passed is not a hold */
      g.world.units[1].hexed = g.world.t - 1;
      await paint();
      const expired = R.debugHex();
      /* and the throw itself draws, without a word to the console */
      R.addEvents([{ e: 'hex', pi: 0, x: c.x, y: c.y, to: { x: c.x + 90, y: c.y + 60 } }], g.world, 0);
      await paint();
      g.world.paused = null;
      g.world.units.length = 0;
      g.world.units.push(...keep);
      return { free, held, expired };
    });
    ok('a man nobody has chained wears nothing', chains.free === 0, String(chains.free));
    ok('a chained man is marked on the ground', chains.held === 1, String(chains.held));
    ok('and the mark goes when the chains do', chains.expired === 0, String(chains.expired));

    suite(`${r} · back button`);
    await pg.evaluate(() => { window.UI.closeSheet(); window.Game.game.armedFlag = null; });
    await pg.waitForTimeout(200);
    /* the sheet belongs to the BUILD button now — tapping the ground opens nothing */
    await pg.click('#btn-build'); await until(pg, () => window.UI.sheetOpen());
    ok('a build sheet is open', await sheetOpen());
    await pg.goBack(); await until(pg, () => !window.UI.sheetOpen());
    ok('back closes the sheet', !(await sheetOpen()));
    ok('back did not leave the match', await inMatch());
    await pg.evaluate(() => document.querySelector('#flag-tray .fbtn').click());
    await pg.waitForTimeout(200);
    ok('a flag is armed', await pg.evaluate(() => window.Game.game.armedFlag !== null));
    await pg.goBack(); await until(pg, () => window.Game.game.armedFlag === null);
    ok('back disarms the flag', await pg.evaluate(() => window.Game.game.armedFlag === null));
    ok('still in the match', await inMatch());
    await pg.click('#pw-storm'); await until(pg, () => !!window.Game.game.targeting);
    ok('the storm is arming', await pg.evaluate(() => !!window.Game.game.targeting));
    await pg.goBack(); await until(pg, () => !window.Game.game.targeting);
    ok('back cancels the storm aim', await pg.evaluate(() => !window.Game.game.targeting));

    /* THE SHADOW LIES ON THE GROUND. A flat disc on real terrain is half-buried by any slope —
     * reported from play as the Jewel being "only half visible" — so the disc conforms now,
     * vertex by vertex. Cast a real storm on the roughest ground near the Seat and measure the
     * drawn mesh against the renderer's own groundH: if the conform ever regresses to a plane,
     * the worst vertex error on a slope is the hill's full height and this line goes red. */
    const stormLie = await pg.evaluate(async () => {
      const R = window.Render, W = window.World, C = window.CONST, g = window.Game.game;
      const c = g.world.map.sites[g.world.map.cities[0]];
      const pl = g.world.players[0];
      pl.essence = 9999; pl.powers.storm = 0;
      /* the roughest castable spot in the Seat's country — flat ground proves nothing */
      let at = null, rough = -1;
      for (let a = 0; a < 6.283; a += 0.35) for (const r of [180, 260, 340]) {
        const x = c.x + Math.cos(a) * r, y = c.y + Math.sin(a) * r;
        let lo = 1e9, hi = -1e9;
        for (let dx = -60; dx <= 60; dx += 30) for (let dy = -60; dy <= 60; dy += 30) {
          const h = R.groundH(x + dx, y + dy); lo = Math.min(lo, h); hi = Math.max(hi, h);
        }
        if (hi - lo > rough) { rough = hi - lo; at = { x, y }; }
      }
      const r2 = W.applyCommand(g.world, 0, { c: 'power', k: 'storm', x: at.x, y: at.y });
      if (!r2.ok) return { err: r2.err };
      const paint = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      await paint();
      const ss = (R.debugStorms() || []).find((q) => q.disc && q.disc.visible);
      if (!ss) return { err: 'no disc drawn', rough };
      const pos = ss.disc.geometry.attributes.position;
      let worst = 0;
      for (let i = 0; i < pos.count; i++) {
        const wx = at.x + pos.getX(i), wz = at.y + pos.getZ(i);
        const err = Math.abs(pos.getY(i) - (R.groundH(wx, wz) + 2.5));
        if (err > worst) worst = err;
      }
      return { rough: +rough.toFixed(1), worst: +worst.toFixed(2), verts: pos.count };
    });
    ok('a storm cast on a slope lies ON the slope', !stormLie.err && stormLie.worst < 0.5,
       stormLie.err || `ground varies ${stormLie.rough} across the disc; worst vertex off by ${stormLie.worst} of ${stormLie.verts}`);
    await pg.goBack(); await until(pg, () => !window.Game.game.mode);
    ok('back with nothing open returns to the menu', !(await inMatch()));
    ok('and the game itself is still open',
       await pg.evaluate(() => !document.getElementById('menu').classList.contains('hidden')));

    /* ---------------- the scanner is not "away" ---------------- *
     * Pairing is the one place the player is blind: the camera covers the screen, and every
     * word about how it went — the status line, the diagnostics, the BEGIN button — is on the
     * LAN table behind it. That table used to be a FOLD-OUT on the menu, closed by a tap
     * anywhere else, and the scanner is a full-screen overlay outside it — so steadying the
     * phone against the glass shut the panel underneath, and the host came back from scanning
     * the reply to a bare title screen and called LAN broken, which from where they were
     * sitting it was.
     * The table is a SCREEN now, which is the structural version of the same fix: there is no
     * "away" to tap. This asserts the property rather than the old mechanism — nothing a tap
     * can do while pairing takes the table off the glass. */
    suite(`${r} · the scanner is not a tap away from the table`);
    const pair = await pg.evaluate(async () => {
      const $ = (id) => document.getElementById(id);
      window.UI.lan();                                 // as the menu's LAN card opens it
      const open = () => !$('lan-screen').classList.contains('hidden')
                      && !$('lan-panel').classList.contains('hidden');
      const opened = open();
      $('scanner').classList.remove('hidden');         // the camera comes up over everything
      const tap = (el) => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
      tap($('scan-video'));
      const afterVideo = open();
      tap($('scan-cancel'));
      const afterCancel = open();
      $('scanner').classList.add('hidden');
      tap($('lan-screen'));                            // ...and a tap on the table itself
      const afterOwn = open();
      window.UI.screensClose();
      const afterBack = open();
      $('menu').classList.add('hidden');
      return { opened, afterVideo, afterCancel, afterOwn, afterBack };
    });
    ok('the LAN table is up to start with', pair.opened);
    ok('steadying the phone on the scanner does not shut the table behind it', pair.afterVideo);
    ok("...nor does tapping the scanner's own close button", pair.afterCancel);
    ok('...nor a tap on the table itself', pair.afterOwn);
    ok('and only the way back puts it away', !pair.afterBack);

    /* ---------------- the network that will not carry it ---------------- *
     * A web page cannot switch on a phone's hotspot — there is no API for it on any platform.
     * So the most the game can do when a network blocks its own devices from talking to each
     * other is recognise the moment and say the one thing that fixes it. Shown only on a real
     * failure, because advice nobody needs is advice nobody reads. */
    suite(`${r} · when the network will not carry the link`);
    const help = await pg.evaluate(async () => {
      const $ = (id) => document.getElementById(id);
      $('menu').classList.remove('hidden');
      $('lan-panel').classList.remove('hidden');
      $('lan-help').classList.add('hidden');
      const hidden = $('lan-help').classList.contains('hidden');
      /* the sim of a dead link: exactly what a peer connection does when ICE gives up */
      /* the four verdicts, each from the evidence a real pairing would have left behind */
      const said = {};
      for (const [kind, cands] of [
        ['same', { host: ['192.168.1.5'] }],
        ['diff', { host: ['192.168.1.5'] }],
        ['cell', { host: ['100.70.1.2'] }]
      ]) {
        window.Net.isHost = true;
        window.Net._pending = { pc: { _cand: cands,
          _theirs: kind === 'same' ? { host: ['192.168.1.9'] }
                 : kind === 'diff' ? { host: ['10.0.0.9'] } : null } };
        window.Net.onFail(null);
        said[kind] = { verdict: window.Net.advice(),
                       title: $('lan-help-title').textContent };
      }
      window.Net.isHost = false; window.Net._pending = null;
      window.Net.onFail(null);
      const shown = !$('lan-help').classList.contains('hidden');
      const body = $('lan-help').textContent;
      /* and a fresh attempt puts it away again */
      $('qr-host').click();
      await new Promise((res) => setTimeout(res, 60));
      const cleared = $('lan-help').classList.contains('hidden');
      $('lan-help').classList.add('hidden');
      $('lan-panel').classList.add('hidden');
      $('menu').classList.add('hidden');
      return { hidden, shown, cleared, body, said,
               osLine: $('lan-help-os').textContent,
               btn: !$('lan-hotspot').classList.contains('hidden') };
    });
    ok('nothing is said while pairing has not failed', help.hidden);
    ok('a failed link says so', help.shown);
    /* THE FOUR PROBLEMS ARE FOUR PROBLEMS. 'It did not connect' is not advice. */
    ok('one network refusing to pass them is named as that',
       help.said.same.verdict === 'same' && /will not pass/i.test(help.said.same.title),
       `${help.said.same.verdict}: ${help.said.same.title}`);
    ok('...two different networks as that', help.said.diff.verdict === 'diff' &&
       /DIFFERENT/.test(help.said.diff.title), `${help.said.diff.verdict}: ${help.said.diff.title}`);
    ok('...and mobile data as that', help.said.cell.verdict === 'cell' &&
       /mobile data/i.test(help.said.cell.title), `${help.said.cell.verdict}: ${help.said.cell.title}`);
    ok('...and names the fix', /hotspot/i.test(help.body), help.body.slice(0, 80));
    ok('...with the route for this OS', /Settings/.test(help.osLine), help.osLine);
    ok('...and the settings button only where it can work',
       help.btn === /android/i.test(await pg.evaluate(() => navigator.userAgent)));
    ok('trying again puts the advice away', help.cleared);

    /* ---------------- LAN: the guest's half ---------------- *
     * A guest never touches the sim — it renders whatever arrives on the wire. Rather than
     * stand up WebRTC, drive the exact seam a real guest goes through (Net.onSnap) with real
     * snapshots from a real host world. Everything downstream is the shipping code path:
     * guestView, the fog rebuild, the interpolation, Render.frame, the HUD. */
    suite(`${r} · LAN guest`);
    const lan = await pg.evaluate(async () => {
      const { Game, Net, World, CONST: C, AI } = window;
      const seed = 4242;
      /* pretend we paired and the host said "start" */
      Net.isHost = false; Net.localIdx = 1; Net.active = true;
      const sent = [];
      Net.send = (o) => sent.push(o);
      Game.startMP(seed);
      /* the host's world, simulated right here */
      const hw = World.createWorld(seed);
      const bots = [AI.make('benedict'), AI.make('julian')];
      const run = (secs) => {
        for (let i = 0; i < secs * 30; i++) {
          for (const f of [0, 1]) bots[f].step(hw, f, (cm) => World.applyCommand(hw, f, cm), C.SIM_DT);
          World.update(hw, C.SIM_DT);
          hw.events.length = 0;
        }
      };
      const push = () => Net.onSnap(JSON.parse(JSON.stringify(Net.snapFor(hw, 1, hw.events.splice(0)))));
      run(90); push();
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const mode = Game.game.mode;
      run(4); push();
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      /* two snapshots in: the guest should be interpolating, not snapping */
      const drew = { mode, ess: document.getElementById('ess-n').textContent,
                     wantEss: Math.floor(hw.players[1].essence),
                     works: hw.players[1].buildings.length };
      /* a guest command must go out on the wire, not into a local sim */
      const before = hw.players[1].essence;
      Game.game.world = null;                      // a guest has no world of its own
      const seat = hw.map.sites[hw.map.cities[1]];
      window.Render.lookAt(seat.x, seat.y);
      const s = window.Render.project(seat.x + 150, seat.y);
      const cvs = document.getElementById('game');
      /* the tap still goes in — a guest's input path must survive it — but the sheet is the
       * BUILD button's now, so that is what opens it */
      for (const t of ['pointerdown', 'pointerup'])
        cvs.dispatchEvent(new PointerEvent(t, { pointerId: 7, clientX: s.x, clientY: s.y, bubbles: true }));
      await new Promise((res) => setTimeout(res, 200));
      const bare = window.UI.sheetOpen();
      document.getElementById('btn-build').click();
      await new Promise((res) => setTimeout(res, 200));
      return { ...drew, sheet: window.UI.sheetOpen(), bare,
               sent: sent.map((o) => o.t), hostEss: before };
    });
    ok('the guest enters the match from a start message', lan.mode === 'guest', `mode=${lan.mode}`);
    /* the readout ticks toward its target, so allow a little lag — but it must be tracking
     * the HOST's number, not a stale one left over from the single-player match before it */
    ok('the guest HUD shows the essence off the wire',
       Math.abs(parseInt(lan.ess, 10) - lan.wantEss) <= Math.max(20, lan.wantEss * 0.25),
       `ess-n = ${lan.ess}, host has ${lan.wantEss}`);
    ok('the guest renders a host world with works on it', lan.works > 0, `${lan.works} rival works`);
    ok('bare ground opens nothing for a guest either', !lan.bare);
    ok('a guest can open the build sheet from the button', lan.sheet);
    ok('the guest raised no errors rendering snapshots', errs.length === 0, errs.slice(0, 3).join(' | '));

    /* A HALT IS THE TABLE'S. A guest holds no world, so the only way it can learn the world
     * has stopped is the snapshot — and the only way it can call one is the wire. Neither
     * has anything in common with the solo path, so neither is covered by it. */
    const lanHalt = await pg.evaluate(async () => {
      const { Game, Net, World, CONST: C } = window;
      const hw = World.createWorld(4242);
      for (let i = 0; i < 30 * 30; i++) { World.update(hw, C.SIM_DT); hw.events.length = 0; }
      const sent = [];
      Net.send = (o) => sent.push(o);
      const push = () => Net.onSnap(JSON.parse(JSON.stringify(Net.snapFor(hw, 1, hw.events.splice(0)))));
      const paint = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      /* the HOST calls the halt: the guest must find out and say who */
      World.applyCommand(hw, 0, { c: 'pause', on: true });
      push(); await paint();
      const seen = { panel: !document.getElementById('halt').classList.contains('hidden'),
                     who: document.querySelector('#halt .halt-who').textContent,
                     btn: document.getElementById('btn-pause').textContent };
      /* and the GUEST lifts it — over the wire, since it has no world to change */
      sent.length = 0;
      document.getElementById('halt').click();
      const cmds = sent.filter((o) => o.t === 'cmd').map((o) => o.c);
      /* the host obeys, and the next snapshot carries the answer back */
      for (const c of cmds) World.applyCommand(hw, 1, c);
      push(); await paint();
      return { ...seen, cmds, stillPaused: !!hw.paused,
               gone: document.getElementById('halt').classList.contains('hidden') };
    });
    ok('a guest sees a halt the host called', lanHalt.panel);
    ok('...and is told whose it is, not that it is its own',
       /corwin|seat 1/i.test(lanHalt.who), lanHalt.who);
    ok('...and its button offers to go on', lanHalt.btn === '▶', lanHalt.btn);
    ok('a guest lifts a halt over the wire, not locally',
       lanHalt.cmds.length === 1 && lanHalt.cmds[0].c === 'pause' && lanHalt.cmds[0].on === false,
       JSON.stringify(lanHalt.cmds));
    ok('the host obeys a guest lifting it', !lanHalt.stillPaused);
    ok('...and the guest panel clears on the next snapshot', lanHalt.gone);

    /* ...and the same path at a seat that is neither host nor "the other one" */
    const lan4 = await pg.evaluate(async () => {
      const { Game, Net, World, CONST: C, AI } = window;
      const seed = 777, seats = 4, mine = 2;
      Net.isHost = false; Net.localIdx = mine; Net.active = true;
      Net.send = () => {};
      Game.startMP(seed, seats, mine);
      const hw = World.createWorld(seed, seats);
      const bots = [0, 1, 2, 3].map((i) => AI.make(['benedict', 'julian', 'bleys', 'brand'][i]));
      for (let i = 0; i < 30 * 100 && hw.winner === null; i++) {
        for (let pi = 0; pi < seats; pi++) bots[pi].step(hw, pi, (cm) => World.applyCommand(hw, pi, cm), C.SIM_DT);
        World.update(hw, C.SIM_DT); hw.events.length = 0;
      }
      const push = () => Net.onSnap(JSON.parse(JSON.stringify(Net.snapFor(hw, mine, hw.events.splice(0)))));
      push();
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      push();
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      return { viewer: Game.game.viewer, seats: Game.game.world ? -1 : hw.players.length,
               ess: document.getElementById('ess-n').textContent,
               want: Math.floor(hw.players[mine].essence),
               names: Game.game.names.length };
    });
    ok('a guest can hold a seat that is not seat 1', lan4.viewer === 2, `viewer ${lan4.viewer}`);
    ok('it knows all four names', lan4.names === 4, `${lan4.names}`);
    ok('and reads its OWN essence off the wire, not seat 1s',
       Math.abs(parseInt(lan4.ess, 10) - lan4.want) <= Math.max(30, lan4.want * 0.3),
       `ess-n ${lan4.ess}, seat 2 has ${lan4.want}`);
    ok('four-player guest rendering raised no errors', errs.length === 0, errs.slice(0, 3).join(' | '));

    /* A REMATCH KEEPS THE LINK, AND EITHER PHONE MAY CALL IT. Pairing by QR is the price of
     * getting into a LAN game; paying it again to play a second game against the person
     * sitting next to you is not. The dealing stays the host's — it is the only seat holding a
     * world — but the WANTING is everybody's, and it is the beaten heir who wants it most, so
     * a guest tapping ANOTHER MATCH sends `{t:'again'}` and the host deals on receipt exactly
     * as if its own button had been pressed. Everything below drives that seam (the lobby's
     * own start message, Net.onSnap, Net.onAgain) rather than standing up WebRTC: what is
     * being tested is the protocol and the two end screens, not the browser's ICE stack.
     * The guest goes first, since it is the half that used to have no button at all. */
    suite(`${r} · a rematch on the same link`);
    const again = await pg.evaluate(async () => {
      const { Game, Net, World } = window;
      const out = {};
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      /* the end of a match is raised by the LOOP, so wait on the thing itself rather than on a
       * guessed number of milliseconds — half a dozen matches begin and end in this one block,
       * and a guessed number is either slower than it needs to be or flaky */
      const till = async (fn, ms = 3000) => {
        const t0 = Date.now();
        while (!fn() && Date.now() - t0 < ms) await new Promise((res) => requestAnimationFrame(res));
        return fn();
      };
      /* a castle ending now HOLDS the end screen ~2.8s while the Seat is seen to fall, so the
       * wait is that hold plus the old margin — and the first `ends` doubles as the feature's
       * own assertion: the screen must NOT be up early, and the tower must be falling */
      const ends = () => till(() => Game.game.over, 6500);
      const begins = () => till(() => !Game.game.over && !!Game.game.mode);
      /* `to` is which seat a message was addressed to; -1 is "everyone I am linked to" */
      const log = (arr) => (o, to) => arr.push({ ...o, to: to == null ? -1 : to });
      const endLabel = () => document.getElementById('end-next').textContent;
      const endHidden = () => document.getElementById('end-next').classList.contains('hidden');

      /* --- the guest: a real button, whose tap is a CALL and not a start --- */
      const gsent = [];
      Net.isHost = false; Net.localIdx = 1; Net.active = true; Net.peerGone = false;
      Net.peers = [];
      Net.send = log(gsent);
      Game.startMP(9001, 2, 1);
      const hw = World.createWorld(9001, 2);
      hw.winner = 0; hw.winReason = 'castle';
      Net.onSnap(JSON.parse(JSON.stringify(Net.snapFor(hw, 1, []))));
      await ends();
      const nx = document.getElementById('end-next');
      out.guestEnded = !document.getElementById('end').classList.contains('hidden');
      out.guestLabel = endLabel();
      out.guestLive = !nx.disabled;              // the loser has something to press
      out.guestLinked = Net.active;              // ...and the link is NOT torn down
      nx.click();
      out.guestSent = gsent.slice();
      out.waitLabel = endLabel();
      out.waitDead = nx.disabled;                // the offer has become a status
      /* the host deals — and a guest that never tapped is dealt in by the same message */
      Net.onStart({ seed: 9002, seats: 2, idx: 1 });
      await begins();
      out.guestBack = document.getElementById('end').classList.contains('hidden')
                   && Game.game.mode === 'guest' && Game.game.over === false;

      /* --- a guest whose host has gone is offered nothing it cannot have --- */
      Game.startMP(9005, 2, 1);
      const hw5 = World.createWorld(9005, 2);
      hw5.winner = 1; hw5.winReason = 'pattern';
      Net.onSnap(JSON.parse(JSON.stringify(Net.snapFor(hw5, 1, []))));
      await ends();
      out.aloneBefore = endLabel();
      Net.peerGone = true;                       // the host's phone leaves, on the end screen
      Net.onClose(1);
      out.aloneHidden = endHidden();
      out.aloneLabel = endLabel();

      /* --- the host: its own button still deals --- */
      const sent = [];
      Net.isHost = true; Net.localIdx = 0; Net.active = true; Net.peerGone = false;
      Net.peers = [{ idx: 1, dc: { readyState: 'open', send: () => {} }, pc: null }];
      Net.send = log(sent);
      Game.startMP(9003, 2, 0);
      const w = Game.game.world;
      /* the loop ends the match off the sim's own win event, so raise one */
      w.events.push({ e: 'win', winner: 0, reason: 'pattern' });
      await ends();
      out.hostLabel = endLabel();
      document.getElementById('end-next').click();
      await begins();
      out.starts = sent.filter((o) => o.t === 'start');
      out.hostBack = document.getElementById('end').classList.contains('hidden')
                  && Game.game.mode === 'host' && Game.game.over === false;
      out.hostLinked = Net.active;
      out.newWorld = !!Game.game.world && Game.game.world !== w;

      /* --- ...and a GUEST's call deals it without the host touching anything --- */
      sent.length = 0;
      Game.startMP(9006, 2, 0);
      const w6 = Game.game.world;
      w6.events.push({ e: 'win', winner: 1, reason: 'castle' });
      await ends();
      Net.onAgain(1);
      await begins();
      out.calledStarts = sent.filter((o) => o.t === 'start');
      out.calledBack = document.getElementById('end').classList.contains('hidden')
                    && Game.game.mode === 'host' && Game.game.over === false
                    && Game.game.world !== w6;
      /* two heirs tapping at once must not deal two boards: the second call lands in a match
       * that has already begun, and a call is only ever answered between matches */
      Net.onAgain(1);
      await wait(60);
      out.doubleStarts = sent.filter((o) => o.t === 'start').length;

      /* --- four seats: one heir's call deals the whole table back in, each to its own --- */
      sent.length = 0;
      Net.peers = [1, 2, 3].map((i) => ({ idx: i, dc: { readyState: 'open', send: () => {} }, pc: null }));
      Game.startMP(9007, 4, 0);
      /* honest synthesis: the fall keys on a toppled seat, so topple one */
      window.World.seatOf(Game.game.world, 0).hp = 0;
      Game.game.world.events.push({ e: 'win', winner: 2, reason: 'castle' });
      /* the hold itself, measured once here rather than paid blind six times: a second after
       * the killing blow the match must still be SHOWING (not over), and the loser's tower
       * must be animating — then `ends` waits out the fall like every other block */
      await wait(1000);
      out.heldBack = !Game.game.over;
      out.falling = !!(window.Render.debugSeatFall && window.Render.debugSeatFall());
      await ends();
      Net.onAgain(3);                            // the heir at seat 3 asks for another
      await begins();
      out.fourStarts = sent.filter((o) => o.t === 'start');
      out.fourSeats = Game.game.seats;

      /* --- and NOT when somebody has left: the host's own button goes away, and the call it
             cannot honour is ANSWERED rather than swallowed. A guest cannot see that some
             OTHER guest has dropped, so silence would leave it waiting forever --- */
      sent.length = 0;
      Net.peers = [1, 2].map((i) => ({ idx: i, dc: { readyState: 'open', send: () => {} }, pc: null }));
      Game.startMP(9008, 3, 0);
      Net.peers.pop();                           // seat 2 walks out of the three-way
      Game.game.world.events.push({ e: 'win', winner: 0, reason: 'castle' });
      await ends();
      out.goneLabel = endLabel();
      out.goneHidden = endHidden();
      Net.onAgain(1);                            // seat 1 calls anyway — it cannot see seat 2 go
      await wait(60);
      out.refusal = sent.filter((o) => o.t === 'nomore' || o.t === 'start');
      out.refusedStanding = Game.game.over && Game.game.mode === 'host';

      /* --- and the guest end of that refusal: the button stops promising --- */
      Net.isHost = false; Net.localIdx = 1; Net.active = true; Net.peerGone = false; Net.peers = [];
      Net.send = () => {};
      Game.startMP(9009, 2, 1);
      const hw9 = World.createWorld(9009, 2);
      hw9.winner = 0; hw9.winReason = 'castle';
      Net.onSnap(JSON.parse(JSON.stringify(Net.snapFor(hw9, 1, []))));
      await ends();
      document.getElementById('end-next').click();
      out.refusedWaiting = endLabel();
      Net.onNoMore();
      out.refusedHidden = endHidden();
      out.refusedOver = Game.game.over;          // still on the end screen, not dumped out
      return out;
    });
    ok('the end screen waits while the Seat is seen to fall', again.heldBack === true && again.falling === true,
       `held ${again.heldBack}, falling ${again.falling}`);
    ok('a guest that loses is left on the end screen', again.guestEnded);
    ok('and is offered another match of its own', /ANOTHER MATCH/.test(again.guestLabel), again.guestLabel);
    ok('with a button it can actually press', again.guestLive);
    ok('and its link still up', again.guestLinked);
    ok('its tap is a CALL up the wire, not a start it dealt itself',
       again.guestSent.length === 1 && again.guestSent[0].t === 'again',
       JSON.stringify(again.guestSent));
    ok('...addressed to the host, which is the only link a guest has',
       again.guestSent.length === 1 && again.guestSent[0].to === -1, JSON.stringify(again.guestSent[0]));
    ok('...and the offer becomes a status while it waits',
       /AWAITING/.test(again.waitLabel) && again.waitDead, `"${again.waitLabel}" disabled=${again.waitDead}`);
    ok('a start message alone puts the guest back in a match', again.guestBack);
    ok('a guest whose host has gone is offered nothing',
       again.aloneBefore === 'ANOTHER MATCH' && again.aloneHidden,
       `before "${again.aloneBefore}", after "${again.aloneLabel}"`);
    ok('the host is offered a rematch', again.hostLabel === 'REMATCH', again.hostLabel);
    ok('tapping it re-sends the lobby start message', again.starts.length === 1,
       JSON.stringify(again.starts));
    ok('with a new seed and the same seats', again.starts.length === 1 && again.starts[0].seats === 2
       && again.starts[0].idx === 1 && again.starts[0].seed !== 9003, JSON.stringify(again.starts[0]));
    ok('the host is back in a match on a fresh world', again.hostBack && again.newWorld);
    ok('and nobody re-paired', again.hostLinked);
    ok('a guest calling for another deals it on the host too', again.calledStarts.length === 1
       && again.calledStarts[0].seats === 2 && again.calledStarts[0].seed !== 9006,
       JSON.stringify(again.calledStarts));
    ok('...with the host in the new match, untapped', again.calledBack);
    ok('a second call cannot deal a second board', again.doubleStarts === 1, `${again.doubleStarts} starts`);
    ok('one call at a four-way deals every seat back in', again.fourStarts.length === 3
       && again.fourStarts.every((s) => s.seats === 4), JSON.stringify(again.fourStarts));
    ok('...each guest told its OWN seat, down its own link',
       again.fourStarts.every((s) => s.idx === s.to) &&
       new Set(again.fourStarts.map((s) => s.idx)).size === 3, JSON.stringify(again.fourStarts));
    ok('...on one board, not three', new Set(again.fourStarts.map((s) => s.seed)).size === 1
       && again.fourStarts[0].seed !== 9007 && again.fourSeats === 4, JSON.stringify(again.fourStarts[0]));
    ok('but a host whose guest left is offered nothing', again.goneHidden, `label "${again.goneLabel}"`);
    ok('a call it cannot honour is refused out loud, not swallowed',
       again.refusal.length === 1 && again.refusal[0].t === 'nomore' && again.refusal[0].to === 1,
       JSON.stringify(again.refusal));
    ok('...and the host stays on its end screen', again.refusedStanding);
    ok('a refused guest stops being promised a match',
       again.refusedWaiting === 'AWAITING THE HOST' && again.refusedHidden,
       `waiting "${again.refusedWaiting}", hidden=${again.refusedHidden}`);
    ok('...without being thrown off the end screen', again.refusedOver);
    ok('the rematch path raised no errors', errs.length === 0, errs.slice(0, 3).join(' | '));

    /* The chronicle is only worth having if it comes OFF the phone. Clipboard first, because
     * pasting is the whole point; a selectable textarea when the browser refuses, because a
     * refusal must not be a dead end. */
    suite(`${r} · the chronicle comes off the phone`);
    const chron = await pg.evaluate(async () => {
      const { Game, Net, Rec } = window;
      const out = {};
      let clipped = null;
      /* pretend the clipboard works, and then pretend it does not */
      const realClip = navigator.clipboard;
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: (t) => { clipped = t; return Promise.resolve(); } }
      });
      Net.isHost = false; Net.active = false; Net.peers = [];
      window.Game.game.mode = null;
      document.getElementById('btn-skirmish').click();
      [...document.querySelectorAll('#rivals-body .rival')].find((e) => /julian/i.test(e.textContent)).click();
      await new Promise((res) => setTimeout(res, 200));
      out.recording = Rec.on;
      /* the table samples once a frame, so run the sim in chunks with frames between them —
       * a fast-forward inside ONE frame is one row however many minutes it covers */
      for (let i = 0; i < 8; i++) {
        window.__step(25);
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      }
      /* an HONEST castle ending: real play never wins by castle with every Seat standing, and
       * the fall presentation keys on the toppled seat — a fabricated win with nobody down
       * would hold the screen with no tower falling. Then wait out the HOLD (2.8s) the way a
       * player does, not a 200ms guess that the feature just made a lie. */
      window.World.seatOf(Game.game.world, 1).hp = 0;
      Game.game.world.events.push({ e: 'win', winner: 0, reason: 'castle' });
      { const t0 = Date.now();
        while (!Game.game.over && Date.now() - t0 < 6500)
          await new Promise((res) => requestAnimationFrame(res)); }
      await new Promise((res) => setTimeout(res, 120));
      out.ended = !document.getElementById('end').classList.contains('hidden');
      out.hasButtons = !!document.getElementById('end-copy') && !!document.getElementById('end-save');
      document.getElementById('end-copy').click();
      await new Promise((res) => setTimeout(res, 120));
      out.copied = clipped;
      out.label = document.getElementById('end-copy').textContent;
      /* now the refusal path */
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true, value: { writeText: () => Promise.reject(new Error('nope')) }
      });
      document.getElementById('end-copy').click();
      await new Promise((res) => setTimeout(res, 120));
      const ta = document.getElementById('record-text');
      out.fellBack = !document.getElementById('record-box').classList.contains('hidden') && ta.value.length > 200;
      document.getElementById('record-close').click();
      out.closed = document.getElementById('record-box').classList.contains('hidden');
      /* THE MATCH IN CURVES, read off the same end screen while it is still up. It shares this
       * match rather than playing its own: most of this suite's cost is FRAME time, and a
       * second eight-chunk match to look at an SVG would double it for nothing. */
      const box = document.getElementById('end-stats');
      const cards = [...box.querySelectorAll('.stat-card')];
      const pts = (el) => [...el.querySelectorAll('polyline')]
        .flatMap((p) => p.getAttribute('points').split(' ').map((s) => s.split(',').map(Number)));
      out.stats = {
        shown: !box.classList.contains('hidden') &&
               document.getElementById('end').classList.contains('with-stats'),
        cards: cards.length,
        keys: cards.map((c) => c.querySelector('svg').getAttribute('data-key')),
        seats: new Set(cards.flatMap((c) => [...c.querySelectorAll('[data-seat]')]
          .map((p) => p.getAttribute('data-seat')))).size,
        facts: box.querySelectorAll('.stat-facts div').length,
        legend: box.querySelectorAll('.stat-key span').length,
        /* the projection must land inside the viewBox — a curve drawn off the card is a curve
         * nobody sees, and it looks exactly like a curve that is flat along the top */
        outside: cards.flatMap(pts).filter(([x, y]) => !(x >= -0.01 && x <= 100.01 && y >= 0 && y <= 36)).length,
        /* every card drawn must SAY something: the all-zero ones are dropped, so a card whose
         * every point sits on the floor means the rule stopped working */
        flat: cards.filter((c) => !pts(c).some(([, y]) => y < 32.9)).length,
        labels: cards.map((c) => c.querySelector('.stat-head span').textContent)
      };
      /* and a match walked out of is still offered, because that is often the telling one */
      document.getElementById('end-menu').click();
      await new Promise((res) => setTimeout(res, 150));
      out.menuOffers = !document.getElementById('menu-record').classList.contains('hidden');
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: realClip });
      return out;
    });
    ok('a match records itself from the moment it starts', chron.recording);
    ok('the end screen offers the chronicle', chron.ended && chron.hasButtons);
    ok('tapping COPY puts the whole match on the clipboard',
       !!chron.copied && chron.copied.length > 400, `${(chron.copied || '').length} characters`);
    ok('...with the seed in it, so the board can be rebuilt', /seed \d+/.test(chron.copied || ''));
    ok('...and the table of hours', /— the hours —/.test(chron.copied || ''));
    ok('the button says it worked', /COPIED/.test(chron.label), chron.label);
    ok('a browser that refuses the clipboard gets a box to copy from by hand', chron.fellBack);
    ok('...which closes again', chron.closed);
    ok('and the menu still offers the last match', chron.menuOffers);
    ok('the chronicle raised no errors', errs.length === 0, errs.slice(0, 3).join(' | '));

    /* THE MATCH IN CURVES. The chronicle answers "what happened" to anyone who will read a
     * table of numbers; nobody does that on a phone the second a match ends. The shapes say
     * the same thing at a glance, so they have to actually be on the screen and in the box. */
    suite(`${r} · the match in curves`);
    const st = chron.stats || {};
    ok('the end screen shows the match as curves', st.shown);
    ok('...one chart per thing worth watching', st.cards >= 4, `${st.cards} charts: ${(st.labels || []).join(', ')}`);
    ok('...including the Shadow Gates', (st.keys || []).indexOf('gates') >= 0, (st.keys || []).join(','));
    ok('...and the army', (st.keys || []).indexOf('army') >= 0, (st.keys || []).join(','));
    ok('both heirs are drawn, in their own colours', st.seats === 2, `${st.seats} seats`);
    ok('the legend names them', st.legend === 2, `${st.legend} chips`);
    ok('the facts that are not a curve are there too', st.facts === 6, `${st.facts} facts`);
    ok('every curve lands inside its card', st.outside === 0, `${st.outside} points outside`);
    ok('a chart that would say nothing is not drawn', st.flat === 0, `${st.flat} flat charts`);

    suite(`${r} · console`);
    ok('the page raised no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await pg.close();
    if (group) times.push([group, Date.now() - markAt]);
    return { rows, times };
  }

  const done = await runRenderer('3d');
  record(done.rows, done.times);

  /* ---------------- the veil at a phone's pixel density ----------------
   * The remembered-ground mask is softened by drawing it SMALL and letting the bilinear
   * upscale smear its cell staircase (overlayPass). That softening once fell out of the
   * pipeline entirely — `memCtx` swallowed the shrink argument it was called with — and no
   * desktop run noticed, because on a desktop viewport a fog cell is a few pixels and its raw
   * edge hides; on a phone a cell is ~100 device pixels and the mask marched across the
   * screen as piano keys. So this drives the page as the phone that reported it (DPR 3),
   * finds the veil boundary in WORLD terms from the seen-mask, projects it with
   * Render.project, and reads the overlay's own pixels across the crossing: a raw cell edge
   * drops the whole veil step in a pixel or two, the softened edge spreads it over the cell.
   * Every candidate crossing is measured and the SOFTEST one judged: HUD ink (a site label, a
   * bar) can make a soft edge read hard, but nothing can make the mask's hard edge read soft,
   * so if even one crossing is gentle the mask is being softened. */
  {
    suite('the veil at a phone\'s pixel density');
    /* on the hand-made board: the crossing this looks for has to EXIST before its softness
     * can be judged, and on a grown world it intermittently did not. */
    const { pg, errs } = await veilPage(browser, base,
      { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3 });
    const veil = await pg.evaluate(async () => {
      const R = window.Render, C = window.CONST, g = window.Game.game;
      /* THE 2D VEIL IS NO LONGER WHAT THE GAME DRAWS. It is kept, and this suite is what keeps
       * it honest, so it asks for it by name rather than inheriting it from the default. */
      R.shaderFog = false;
      R.debugFog = { discs: false, rim: false };   // the mask alone, so the mask is what is measured
      /* the board fixes where the boundary is, so the camera can be aimed at it rather than
       * zoomed all the way out and hoped over — and at this zoom a fog cell is comfortably
       * more than the six device pixels the next assertion needs to see a raw edge at all. */
      R.setZoom(1.0);
      R.lookAt(880, 1300);                         // hard by the western edge of what was seen
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const sm = g.world.players[0].seen;
      const at = (x, y) => {
        const gx = x / sm.cell | 0, gy = y / sm.cell | 0;
        return gx >= 0 && gy >= 0 && gx < sm.gw && gy < sm.gh ? sm.g[gy * sm.gw + gx] : 0;
      };
      const overlay = document.getElementById('overlay');
      const dpr = overlay.width / window.innerWidth;
      const ctx = overlay.getContext('2d');
      const HALF = 44;                             // CSS px each side of the crossing
      /* ink that is not the veil, to steer around: the minimap, and every site label */
      const mb = R.miniBox();
      const rects = [[mb.mx - 4, mb.my - 4, mb.mx + mb.mw + 4, mb.my + mb.mh + 4]];
      for (const s of g.world.map.sites) {
        const q = R.project(s.x, s.y);
        rects.push([q.x - 140, q.y - 8, q.x + 140, q.y + 44]);
      }
      const clear = (x0, x1, y) => rects.every(([a, b, c, d]) => y < b || y > d || x1 < a || x0 > c);
      const tried = [];
      let best = null;
      for (let sy = 0.2; sy <= 0.8; sy += 0.05) {
        const wc = R.toWorld(window.innerWidth / 2, window.innerHeight * sy);
        if (!at(wc.x, wc.y)) continue;
        for (const dir of [-2, 2]) {
          for (let x = wc.x; x > 0 && x < C.MAP.W; x += dir) {
            if (at(x, wc.y)) continue;
            const q = R.project(x, wc.y);
            if (q.x > HALF + 8 && q.x < window.innerWidth - HALF - 8 &&
                q.y > 40 && q.y < window.innerHeight - 40 && clear(q.x - HALF, q.x + HALF, q.y)) {
              const py = Math.round(q.y * dpr);
              const x0 = Math.round((q.x - HALF) * dpr), x1 = Math.round((q.x + HALF) * dpr);
              const row = ctx.getImageData(x0, py, x1 - x0, 1).data;
              let maxJump = 0, lo = 255, hi = 0;
              for (let i = 7; i < row.length; i += 4) {
                maxJump = Math.max(maxJump, Math.abs(row[i] - row[i - 4]));
                lo = Math.min(lo, row[i]); hi = Math.max(hi, row[i]);
              }
              /* only a window that actually crosses the veil step says anything */
              if (hi - lo >= 60) {
                tried.push(maxJump);
                if (!best || maxJump < best.maxJump) best = { maxJump, range: hi - lo, px: q.x | 0, py: q.y | 0 };
              }
            }
            break;                                 // first crossing in this direction only
          }
        }
      }
      R.debugFog = null;
      if (!best) return { err: 'no clean crossing of the veil boundary found on screen' };
      /* how big a fog cell is on this screen, asked of the projection itself */
      const cw = R.toWorld(window.innerWidth / 2, window.innerHeight / 2);
      const cellPx = sm.cell * Math.abs(R.project(cw.x + 100, cw.y).x - R.project(cw.x, cw.y).x) / 100;
      return { best, crossings: tried.length, cellPx };
    });
    ok('the veil boundary crosses the screen where it can be read', !veil.err,
       veil.err || `${veil.crossings} crossings`);
    if (!veil.err) {
      ok('a fog cell is big enough there for a raw edge to show', veil.cellPx >= 6, `cell ≈ ${veil.cellPx.toFixed(1)} css px`);
      ok('and the veil steps down as a slope, not as the mask\'s raw cell edge', veil.best.maxJump <= 40,
         `sharpest alpha step ${veil.best.maxJump}/px over a ${veil.best.range} drop at ${veil.best.px},${veil.best.py}`);
    }
    ok('the DPR-3 page raised no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await pg.close();
  }

  /* ---------------- shroud, fog and sight are three different things ----------------
   * SHROUD is ground never seen. FOG is ground seen once and not seen now. SIGHT is ground
   * watched this instant. Fog used to be nothing but LESS SHROUD — the same near-black at a
   * fraction of its strength — which is three states along ONE axis, and it is why fog never
   * read as fog: reported from play as "explored ground looks lighter than ground in view".
   * Dimming does not say "remembered", it flattens contrast, and a flat mid-tone beside
   * high-contrast lit country reads as paler even when it is measurably darker.
   * So fog now carries its own cold HUE. This measures the overlay's own pixels, classified
   * by the sim's masks, and asserts BOTH axes: fog sits between its neighbours in strength,
   * and it is COOLER than the shroud rather than a weaker copy of it. The hue assertion is
   * the one that fails on the old code, where both came from the same fill. */
  {
    suite('shroud, fog and sight read differently');
    const { pg, errs } = await veilPage(browser, base, { viewport: { width: 420, height: 860 } });
    const m = await pg.evaluate(async () => {
      const w = window.Game.game.world;
      window.Render.shaderFog = false;      // this suite measures the KEPT 2D veil, not the shipped one
      /* FOG ONLY EXISTS WHERE SIGHT HAS BEEN AND GONE, and the board above builds it: the
         eye's march to y=1500 is what is remembered, its fall back to y=1240 is what is
         watched, and past its high-water mark nothing was ever seen. This used to run the
         match forward with the AI driving and then hunt the grid for a window holding all
         three, which measured a different world every pass — 264 fog cells one run, 4 the
         next, 0 on a third — so the sample count, not the veil, decided whether it passed. */
      /* the sight band sits BELOW the camera's mark on a pitched view, where the ground is
       * nearest and largest; aimed at the band itself it is squeezed toward the horizon and
       * barely a dozen of its cells reach the screen. */
      window.Render.setZoom(0.8);
      window.Render.lookAt(1420, 1150);
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const cv = document.getElementById('overlay');
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      const dpr = cv.width / cv.clientWidth, vi = window.Game.game.viewer;
      const vis = w.vis[vi], seen = w.players[vi].seen;
      const acc = { sight: [], fog: [], shroud: [] };
      /* WALK THE CELLS, DO NOT SPRAY THE SCREEN. Sampling screen points uniformly finds
         however much fog the camera happens to be pointed at — one run caught 264 fog pixels
         and the next 17, which turns the sample count itself into the thing that decides
         whether the suite passes. Every cell of the grid is classified from the sim's own
         masks and projected with Render.project, so each class is found deliberately. */
      for (let gy = 0; gy < vis.gh; gy++) for (let gx = 0; gx < vis.gw; gx++) {
        const k = gy * vis.gw + gx;
        const cls = vis.g[k] ? 'sight' : (seen.g[k] ? 'fog' : 'shroud');
        if (acc[cls].length > 400) continue;
        const q = window.Render.project((gx + 0.5) * vis.cell, (gy + 0.5) * vis.cell);
        if (!q.ok) continue;
        const sx = q.x, sy = q.y;
        if (sx < 6 || sy < 6 || sx > cv.clientWidth - 6 || sy > cv.clientHeight - 6) continue;
        const p = ctx.getImageData(Math.round(sx * dpr), Math.round(sy * dpr), 1, 1).data;
        /* HUD INK IS NOT THE VEIL. Site labels, bars and the writ line are drawn on this same
         * overlay in warm cream, and at (blue-red) about -87 a single sample in ten drags the
         * mean far enough to invert the answer — which is exactly how this suite first
         * reported the veil as WARMER than the shroud while the wash it was meant to be
         * measuring is rgb(12,16,30), i.e. +18. Every colour the veil paints is very dark, so
         * anything bright is somebody else's ink; drop it, and take the MEDIAN besides. */
        if (p[0] + p[1] + p[2] > 150) continue;
        acc[cls].push(p);
      }
      const med = (xs) => { xs.sort((u, v) => u - v); return xs[xs.length >> 1]; };
      const stat = (a) => {
        if (!a.length) return { n: 0 };
        let al = 0;
        for (const p of a) al += p[3] / 255;
        return { n: a.length, alpha: al / a.length, cool: med(a.map((p) => p[2] - p[0])) };
      };
      return { sight: stat(acc.sight), fog: stat(acc.fog), shroud: stat(acc.shroud) };
    });
    ok('the rig is alive: all three states are on screen', m.sight.n > 50 && m.fog.n > 20 && m.shroud.n > 50,
       `sight ${m.sight.n}, fog ${m.fog.n}, shroud ${m.shroud.n}`);
    if (m.fog.n > 20) {
      ok('ground in sight is clear of the veil', m.sight.alpha < 0.12, `alpha ${m.sight.alpha.toFixed(3)}`);
      ok('fog is plainly veiled, not merely tinted', m.fog.alpha > m.sight.alpha + 0.25,
         `sight ${m.sight.alpha.toFixed(3)} vs fog ${m.fog.alpha.toFixed(3)}`);
      ok('...and still plainly lighter than shroud', m.shroud.alpha > m.fog.alpha + 0.15,
         `fog ${m.fog.alpha.toFixed(3)} vs shroud ${m.shroud.alpha.toFixed(3)}`);
      /* the axis the old veil did not have: fog is COLD, the shroud is merely black */
      ok('fog is a colder colour than the shroud, not a weaker copy of it', m.fog.cool > m.shroud.cool + 4,
         `blue-over-red: fog ${m.fog.cool.toFixed(1)}, shroud ${m.shroud.cool.toFixed(1)}`);
    }
    ok('the page raised no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await pg.close();
  }

  /* ---------------- the shader veil: a ladder, and NO LINE ANYWHERE ----------------
   * The veil sampled in the materials (R.shaderFog) is judged on two things, and only the
   * second is hard. The ladder — sight bright, fog half-lit, shroud black — is easy to hit
   * by accident. What is NOT easy is having no EDGE: the first version drew a warm iso-band
   * where sight met its surroundings, and mixed the two darknesses independently off the
   * same base, which left the meeting of fog and shroud a value belonging to neither. Both
   * read as a drawn line across the ground and both are what this suite refuses.
   *
   * Measured as a RATIO, veiled over raw, from the SAME session with the world frozen and
   * the camera untouched: the shader is switched on and off between two reads of the very
   * same pixels, so the terrain's own colour, the lighting and the pitch all cancel and
   * what is left is the veil's transfer and nothing else. Comparing two runs and calling
   * them the same frame has misled this investigation more than once.
   *
   * And it is pinned to the HAND-MADE BOARD above, so the scenario exists by construction
   * rather than by luck of the seed. */
  {
    suite('the shader veil is a ladder with no edge in it');
    const { pg, errs, scene } = await veilPage(browser, base, { viewport: { width: 420, height: 860 } });
    await pg.evaluate(() => new Promise((r) => {
      window.Render.setZoom(0.8); window.Render.lookAt(1420, 1560);
      requestAnimationFrame(() => requestAnimationFrame(r));
    }));
    ok('the hand-made board really holds all three states', scene.sight > 200 && scene.fog > 100 && scene.shroud > 500,
       `sight ${scene.sight}, fog ${scene.fog}, shroud ${scene.shroud}`);
    /* the traverse runs outward from the men, through what they left behind, into the dark */
    const probe = await pg.evaluate(async () => {
      const w = window.Game.game.world, vi = window.Game.game.viewer;
      const vis = w.vis[vi], seen = w.players[vi].seen;
      const cv = document.querySelector('canvas');
      const gl = cv.getContext('webgl2') || cv.getContext('webgl');
      const dpr = cv.width / cv.clientWidth;
      const pts = [];
      /* THREE WORLD UNITS, not twenty. A rim is a THIN thing — an iso-band 0.44..0.58 of a
       * field that ramps over about thirty units is six units wide on the ground — and a
       * coarse traverse steps straight over it and reports a clean picture. Proven, not
       * assumed: with the rim put back this suite passed at a 20-unit step and failed at 3.
       * The whole framebuffer is read ONCE per pass and indexed, so the density is free —
       * a per-point readPixels is a pipeline stall and three hundred of them are not.
       * The GL canvas carries no HUD (the bars, the sheet and the veil's old 2D pass all
       * live on the #overlay canvas above it), so the only clip is the edge of the picture. */
      for (let wy = 1180; wy <= 2100; wy += 3) {
        const q = window.Render.project(1420, wy);
        if (!q.ok || q.y < 4 || q.y > cv.clientHeight - 4) continue;
        const gx = 1420 / vis.cell | 0, gy = wy / vis.cell | 0, k = gy * vis.gw + gx;
        pts.push({ wy, x: Math.round(q.x * dpr), y: Math.round(q.y * dpr),
                   cls: vis.g[k] ? 'sight' : seen.g[k] ? 'fog' : 'shroud' });
      }
      const wait = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const buf = new Uint8Array(cv.width * cv.height * 4);
      const read = () => {
        gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        return pts.map((p) => {
          const i = ((cv.height - p.y) * cv.width + p.x) * 4;
          return 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
        });
      };
      /* AND WHAT THE 2D CANVAS IS DOING WHILE THE SHADER HAS THE JOB. The GL buffer is only
       * half the picture — the veil canvas sits ON TOP of it, and reading one and calling it
       * the frame is how "the shader brightens sighted ground" survived a whole round of
       * screenshots. It did not: the masked rim was guarded by !shaderFog and the guard sent
       * the shader path into the ELSE, where the old disc-union rim washed every lit disc in
       * cream at about a=57. Composited, lit ground read (82,74,52) against the overlay's
       * (33,29,19). With the shader on the veil canvas must be BLANK over the ground. */
      const oc = document.getElementById('overlay');
      const octx = oc.getContext('2d', { willReadFrequently: true });
      const odpr = oc.width / oc.clientWidth, gdpr = cv.width / cv.clientWidth;
      /* MEN ARE NOT THE VEIL. Every man carries an hp sliver on this same canvas, drawn in
       * solid ink, and the traverse walks right through the company it started from — ten of
       * its points came back a=242 with the veil doing nothing at all. Skip the ground under
       * a soldier; what is left is ground, where only the veil has any business. */
      const men = w.units.map((u) => window.Render.project(u.x, u.y)).filter((q) => q.ok);
      const onMan = (p) => men.some((q) => Math.abs(q.x - p.x / gdpr) < 26 && Math.abs(q.y - p.y / gdpr) < 34);
      const inkOver = () => pts.map((p) => (onMan(p) ? 0 : octx.getImageData(
        Math.round(p.x / gdpr * odpr), Math.round(p.y / gdpr * odpr), 1, 1).data[3]));
      window.Render.shaderFog = false; await wait(); await wait(); const raw = read();
      window.Render.shaderFog = true; await wait(); await wait(); const veiled = read();
      const ink = inkOver();
      window.Render.shaderFog = true; await wait();
      return { ink, walk: pts.map((p, i) => ({ wy: p.wy, cls: p.cls, raw: raw[i], ink: ink[i],
                                  r: raw[i] > 12 ? veiled[i] / raw[i] : null })) };
    });
    const { ink, walk } = probe;
    const seen3 = (c) => walk.filter((p) => p.cls === c && p.r !== null).map((p) => p.r);
    const med = (a) => { const s = a.slice().sort((u, v) => u - v); return s.length ? s[s.length >> 1] : NaN; };
    const S = seen3('sight'), F = seen3('fog'), D = seen3('shroud');
    /* WITH THE SHADER ON, THE OLD VEIL MUST BE OFF — all of it, not the branch someone
     * remembered to guard. The disc-union rim lived in an `else` and so ran only when the
     * shader was on, which is the worst possible place for it. */
    const inked = walk.filter((p) => p.ink > 6);
    ok('the 2D veil paints nothing over the ground while the shader has the job',
       inked.length === 0,
       inked.length ? `${inked.length} of ${walk.length} points inked, worst a=${Math.max(...ink)} at y=${inked[0].wy}` : '');
    ok('the traverse is alive: it crosses all three states', S.length >= 3 && F.length >= 3 && D.length >= 3,
       `sight ${S.length}, fog ${F.length}, shroud ${D.length}`);
    if (S.length >= 3 && F.length >= 3 && D.length >= 3) {
      ok('sighted ground is handed back unveiled', med(S) > 0.9, `x${med(S).toFixed(2)}`);
      ok('fog is plainly darker than sight', med(F) < med(S) - 0.2, `sight x${med(S).toFixed(2)} vs fog x${med(F).toFixed(2)}`);
      ok('...and plainly lighter than shroud', med(D) < med(F) - 0.2, `fog x${med(F).toFixed(2)} vs shroud x${med(D).toFixed(2)}`);
      /* THE ASSERTION THAT FAILS ON THE OLD CODE. Walking outward the veil may only ever
       * take light away. A rim, an iso-band, or a seam where two darknesses meet all show
       * up here as the ratio going back UP, and there is nowhere else for them to hide. */
      const rises = [];
      for (let i = 1; i < walk.length; i++) {
        if (walk[i].r === null || walk[i - 1].r === null) continue;
        if (walk[i].r > walk[i - 1].r + 0.04) rises.push(`y=${walk[i].wy} x${walk[i - 1].r.toFixed(2)}->x${walk[i].r.toFixed(2)}`);
      }
      ok('the veil never brightens on the way out — no rim, no seam, no line',
         rises.length === 0, rises.slice(0, 3).join(', '));
      ok('shroud is black, not merely dim', med(D) < 0.18, `x${med(D).toFixed(2)}`);
    }
    ok('the page raised no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await pg.close();
  }

  /* ---------------- a hall's standard follows its company ----------------
   * `{c:'assign'}` moves a hall to another company and the sim does everything right: the
   * hall's `co` changes, the men it raised change with it, the flag tray re-chips. The one
   * thing that did NOT change was the FLAG OVER THE HALL, which is the only place on the
   * board a player actually reads it — the pennant is built into the work's group and the
   * group's cache key carried the branch, the level, the garrison, the damage, a wall's ends
   * and its breach, but not the company. So the hall went on flying its old colours until
   * something else happened to rebuild it.
   * This asserts the COLOUR, not the field. Asserting `b.co` would have passed throughout. */
  {
    suite('a hall\'s standard follows its company');
    const pg = await browser.newPage({ viewport: { width: 420, height: 860 } });
    const errs = [];
    pg.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
    pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await pg.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await ready(pg);
    await pg.evaluate((spec) => window.Game.startSP('julian', { spec, seed: 5 }), VEIL_BOARD);
    await inMatchNow(pg);
    await until(pg, () => window.Render.ready);
    const r = await pg.evaluate(async () => {
      const w = window.Game.game.world, C = window.CONST;
      const hall = w.players[0].buildings.find((b) => C.BUILDINGS[b.bt] && C.BUILDINGS[b.bt].spawns);
      if (!hall) return { err: 'the heir opens with no mustering hall' };
      const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      await frame();
      const was = { co: hall.co, flag: window.Render.debugStandard(hall.id) };
      /* joinCo makes a NEW company for an id nobody holds, so this is a real move */
      const res = window.World.applyCommand(w, 0, { c: 'assign', id: hall.id, co: 'new' });
      await frame();
      return { ok: res.ok, was, now: { co: hall.co, flag: window.Render.debugStandard(hall.id) },
               pen: C.PENNANT || null };
    });
    ok('the rig is alive: the heir has a hall flying a standard', !r.err && !!(r.was && r.was.flag),
       r.err || `flag ${r.was && r.was.flag}`);
    if (!r.err && r.was.flag) {
      ok('the order was taken and the hall really changed company', r.ok && r.now.co !== r.was.co,
         `co ${r.was.co} -> ${r.now.co}`);
      /* THE ASSERTION THAT FAILS ON THE OLD CODE */
      ok('...and the flag over it changed with it', r.now.flag && r.now.flag !== r.was.flag,
         `flag ${r.was.flag} -> ${r.now.flag}`);
    }
    ok('the page raised no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await pg.close();
  }

  /* ---------------- where the fighting is, and where it is NOT ----------------
   * Two reports from play, one chapter apart. The alert cried "Julian is inside your city!"
   * when a Gate four hundred out was being chewed — it fired for ANY work of yours and said
   * the same thing about all of them, though the event carried the coordinates the whole time.
   * And there was nowhere to LOOK: the board is 2000x2400, a phone shows a corner, and the
   * minimap carried springs, Seats, curtains and your own standards but nothing about where
   * blows were landing. */
  {
    suite('where the fighting is, and where it is not');
    const pg = await browser.newPage({ viewport: { width: 420, height: 860 } });
    const errs = [];
    pg.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
    pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await pg.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await ready(pg);
    await pg.evaluate((spec) => window.Game.startSP('julian', { spec, seed: 21 }), VEIL_BOARD);
    await inMatchNow(pg);
    await until(pg, () => window.Render.ready);

    /* ---- THE ALERT NAMES THE WORK, AND ONLY CRIES 'CITY' FOR THE CITY ---- */
    const said = await pg.evaluate(async () => {
      const g = window.Game.game, W = window.World, C = window.CONST;
      const c = W.cityOf(g.world, 0), pl = g.world.players[0];
      const lines = [];
      const real = window.UI.banner;
      window.UI.banner = (t) => lines.push(t);
      const hurt = (b) => {
        pl.alertAt = -99;                       // the alert has its own cooldown
        g.world.events.length = 0;
        W.hurtBuilding(g.world, 0, b.id, 3, 1);
        const evs = g.world.events.splice(0);
        window.Game.game._route ? 0 : 0;
        return evs.filter((e) => e.e === 'hurtcity');
      };
      /* a Gate out in Shadow, and then something standing on the court itself */
      const far = pl.buildings.find((b) => b.bt === 'gate' && Math.hypot(b.x - c.x, b.y - c.y) > C.CITY.r);
      const near = pl.buildings.find((b) => Math.hypot(b.x - c.x, b.y - c.y) < C.CITY.r);
      const out = { hasFar: !!far, hasNear: !!near, farEv: null, nearEv: null };
      if (far) out.farEv = hurt(far)[0] || null;
      if (near) out.nearEv = hurt(near)[0] || null;
      window.UI.banner = real;
      return out;
    });
    ok('the rig is alive: a Gate stands out in Shadow', said.hasFar && !!said.farEv,
       JSON.stringify({ hasFar: said.hasFar, ev: !!said.farEv }));
    /* THE ASSERTION THAT FAILS ON THE OLD CODE — the event carried no `bt` at all */
    ok('the alert now says WHAT is being hurt', said.farEv && said.farEv.bt === 'gate',
       JSON.stringify(said.farEv));
    ok('...and where it stands', said.farEv && said.farEv.x != null && said.farEv.y != null,
       JSON.stringify(said.farEv));

    /* the banner itself, routed the way the game routes it */
    const banner = await pg.evaluate(async () => {
      const g = window.Game.game, W = window.World, C = window.CONST;
      const c = W.cityOf(g.world, 0);
      const lines = [];
      const real = window.UI.banner;
      window.UI.banner = (t) => { lines.push(t); };
      /* the same shape of event the sim emits, both near and far */
      const view = { map: g.world.map, players: g.world.players, see: () => true, t: g.world.t };
      window.Game.game.names = ['Corwin', 'Julian'];
      const route = (ev) => { lines.length = 0; window.__routeEvents([ev], view); return lines.slice(); };
      const farLines = route({ e: 'hurtcity', pi: 0, bt: 'gate', x: c.x + 700, y: c.y + 500, by: 1 });
      const nearLines = route({ e: 'hurtcity', pi: 0, bt: 'barracks', x: c.x + 10, y: c.y + 10, by: 1 });
      const chaosFar = route({ e: 'hurtcity', pi: 0, bt: 'gate', x: c.x + 700, y: c.y + 500, by: -1 });
      window.UI.banner = real;
      return { farLines, nearLines, chaosFar };
    }).catch(() => null);
    if (banner) {
      ok('a work out in Shadow is named, not called your city',
         banner.farLines.some((t) => /Shadow Gate/i.test(t) && !/inside your city/i.test(t)),
         banner.farLines.join(' | '));
      ok('...and something on the court still gets the old cry',
         banner.nearLines.some((t) => /inside your city/i.test(t)), banner.nearLines.join(' | '));
      ok('...and the black road is named as the black road',
         banner.chaosFar.some((t) => /Chaos/i.test(t)), banner.chaosFar.join(' | '));
    }

    ok('the page raised no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await pg.close();
  }

  /* ---------------- and the minimap shows where ----------------
   * ITS OWN PAGE, deliberately. The section above hurts two works to test the alert, and the
   * game's own loop routes those events into the very store under test — a rig that shares a
   * board with an earlier experiment is not measuring what its name says. The first version
   * did, read one of its own footprints as a battle, and split six deaths across two marks. */
  {
    suite('and the minimap shows where the fighting is');
    const pg = await browser.newPage({ viewport: { width: 420, height: 860 } });
    const errs = [];
    pg.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
    pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await pg.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await ready(pg);
    await pg.evaluate((spec) => window.Game.startSP('julian', { spec, seed: 21 }), VEIL_BOARD);
    await inMatchNow(pg);
    await until(pg, () => window.Render.ready);
    const fl = await pg.evaluate(async () => {
      const R = window.Render, g = window.Game.game, W = window.World;
      const c = W.cityOf(g.world, 0);
      const view = { t: g.world.t, map: g.world.map };
      /* THE SECTION ABOVE ALREADY LIT SOME. It hurt two works to test the alert, and the
       * game's own loop routed those events into the very store under test — so a rig that
       * counts the TOTAL is counting its own earlier footprints. Both battles below are put
       * far from anything the alert touched and judged by what is near THEM. */
      const near = (list, x, y) => list.filter((f) => Math.hypot(f.x - x, f.y - y) < 260);
      const evs = [];
      /* a battle, spread over a hundred units — it must read as ONE place */
      for (let i = 0; i < 6; i++) evs.push({ e: 'die', x: c.x + 500 + i * 18, y: c.y + 300 + i * 12, owner: 0, kind: 'soldier' });
      /* and a second one, far away and his */
      for (let i = 0; i < 2; i++) evs.push({ e: 'die', x: c.x + 20, y: c.y + 900 + i * 20, owner: 1, kind: 'soldier' });
      const mineAt = { x: c.x + 545, y: c.y + 330 }, hisAt = { x: c.x + 20, y: c.y + 910 };
      const beforeMine = near(R.debugFlash(), mineAt.x, mineAt.y).length;
      const beforeHis = near(R.debugFlash(), hisAt.x, hisAt.y).length;
      R.addEvents(evs, view, 0);
      const all = R.debugFlash();
      const a1 = near(all, mineAt.x, mineAt.y), a2 = near(all, hisAt.x, hisAt.y);
      await new Promise((res) => setTimeout(res, 1400));
      const l1 = near(R.debugFlash(), mineAt.x, mineAt.y);
      return { beforeMine, beforeHis, a1, a2, l1 };
    });
    ok('the rig is alive: neither battleground was burning before',
       fl.beforeMine === 0 && fl.beforeHis === 0, `${fl.beforeMine}/${fl.beforeHis}`);
    /* THE ASSERTIONS THAT FAIL ON THE OLD CODE — there were no flashpoints at all */
    ok('six deaths spread over a hundred units are ONE mark, not six',
       fl.a1.length === 1, JSON.stringify(fl.a1));
    ok('...and a second battle elsewhere is its own', fl.a2.length === 1, JSON.stringify(fl.a2));
    ok('...weighted by how much is happening there',
       fl.a1[0] && fl.a1[0].n >= 5 && fl.a2[0] && fl.a2[0].n === 2,
       JSON.stringify([fl.a1[0] && fl.a1[0].n, fl.a2[0] && fl.a2[0].n]));
    ok('...and it knows whose blood it is',
       fl.a1[0] && fl.a1[0].mine === true && fl.a2[0] && fl.a2[0].mine === false,
       JSON.stringify([fl.a1[0] && fl.a1[0].mine, fl.a2[0] && fl.a2[0].mine]));
    ok('a flashpoint fades when the fighting stops',
       fl.l1[0] && fl.a1[0] && fl.l1[0].ttl < fl.a1[0].ttl,
       JSON.stringify([fl.a1[0] && fl.a1[0].ttl, fl.l1[0] && fl.l1[0].ttl]));
    ok('the page raised no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await pg.close();
  }

  /* ---------------- the campaign: a chapter is chosen, briefed, played and cleared ----------------
   * The objective is stated BEFORE the board is — that is the whole shape of the screen, and
   * the thing worth taking from how this was done before there were tutorials. Everything the
   * chapter adds is polled from game.js over the world it already holds; the sim grew no third
   * win condition, and `World.declare` is the one door out. */
  {
    suite('the campaign: a chapter is chosen, briefed, played and cleared');
    const pg = await browser.newPage({ viewport: { width: 420, height: 860 } });
    const errs = [];
    pg.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
    pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await pg.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await ready(pg);
    await pg.evaluate(() => { window.CAMPAIGN.reset(); window.UI.showMenu('x', 'y'); });

    /* the menu names the chapter, not the heir */
    const menu = await pg.evaluate(() => {
      window.location.reload;
      const CAM = window.CAMPAIGN;
      return { first: CAM.CHAPTERS[0].key, n: CAM.CHAPTERS.length,
               open1: CAM.open(CAM.CHAPTERS[0].key), open2: CAM.open(CAM.CHAPTERS[1].key) };
    });
    ok('the first chapter is open and the second is sealed',
       menu.open1 === true && menu.open2 === false, JSON.stringify(menu));

    await pg.click('#btn-campaign');
    const list = await pg.evaluate(() => {
      const cards = [...document.querySelectorAll('#chapters-body .card.chapter')];
      return { shown: !document.getElementById('chapters').classList.contains('hidden'),
               n: cards.length,
               locked: cards.filter((c2) => c2.classList.contains('locked')).length,
               first: cards.length ? cards[0].dataset.key : null };
    });
    ok('the campaign button opens the chapter list', list.shown && list.n === menu.n, JSON.stringify(list));
    ok('...with every chapter but the first sealed', list.locked === menu.n - 1, JSON.stringify(list));

    /* THE BRIEFING COMES BEFORE THE BOARD */
    await pg.evaluate(() => document.querySelector('#chapters-body .card.chapter').click());
    const brief = await pg.evaluate(() => ({
      prose: document.querySelectorAll('#chapters-body .brief p').length,
      obj: (document.querySelector('#chapters-body .brief-obj') || {}).textContent || '',
      begin: !!document.getElementById('chapter-begin'),
      back: !!document.getElementById('chapter-back'),
      inMatch: !document.getElementById('hud').classList.contains('hidden')
    }));
    ok('choosing a chapter shows its briefing', brief.prose >= 2 && brief.begin && brief.back,
       JSON.stringify(brief));
    /* ---- AND ITS BUTTONS ARE ONE COLUMN, NOT A RAGGED STACK ----
     * Reported with a picture. `.mbtn` carries a fixed `min(78vw,340px)` and `.mbtn.small`
     * carries `width:auto`, so a column of them came out three different widths — one flush
     * left, one sized to its own text, and the way out to the menu centred on its own because
     * it is not in the body at all. And two of the three meant "not this": on a briefing THE
     * OTHER CHAPTERS is already the way back, so BACK TO THE MENU is one button too many. */
    const shape = await pg.evaluate(() => {
      const body = document.getElementById('chapters-body');
      const btns = [...body.querySelectorAll('.mbtn')].map((b) => {
        const r = b.getBoundingClientRect();
        return { id: b.id, w: Math.round(r.width), x: Math.round(r.left) };
      });
      const close = document.getElementById('chapters-close');
      return { btns, closeShown: !close.classList.contains('hidden'),
               bodyW: Math.round(body.getBoundingClientRect().width) };
    });
    ok('every button on the briefing is the panel\'s own width',
       shape.btns.length >= 2 && shape.btns.every((b) => Math.abs(b.w - shape.bodyW) <= 2),
       JSON.stringify(shape));
    ok('...and they share one left edge',
       new Set(shape.btns.map((b) => b.x)).size === 1, JSON.stringify(shape.btns.map((b) => b.x)));
    ok('a briefing offers ONE way back, not two', shape.closeShown === false, String(shape.closeShown));

    /* out of a briefing is back to the LIST — the chapter you are reading about is not one you
     * have decided against */
    await pg.evaluate(() => document.getElementById('chapter-back').click());
    const backToList = await pg.evaluate(() => ({
      cards: document.querySelectorAll('#chapters-body .card.chapter').length,
      closeShown: !document.getElementById('chapters-close').classList.contains('hidden')
    }));
    ok('THE OTHER CHAPTERS goes back to the list', backToList.cards >= 5, JSON.stringify(backToList));
    ok('...where the way out to the menu is offered again', backToList.closeShown === true,
       String(backToList.closeShown));
    await pg.evaluate(() => document.querySelector('#chapters-body .card.chapter').click());
    ok('...which states the objective', /\w/.test(brief.obj), brief.obj);
    ok('...before any board exists', brief.inMatch === false, String(brief.inMatch));

    /* ---- AND EVERY CHAPTER'S BRIEFING, NOT MERELY THE FIRST ONE ----
     * Reported from play as "the menu disappeared": chapter II drew its title and its prose and
     * then nothing — no objective, no BEGIN, no way back. The screen used to get the objective's
     * sentence by calling the HUD readout over a FABRICATED world, and the day `raze` learned to
     * ask where the rival's Seat is, that readout threw where it stood and every element built
     * after it was never appended. This suite could not see it because it only ever opened the
     * first chapter, which happens not to look past a building list. Open all of them. */
    const all = await pg.evaluate(() => {
      const CAM = window.CAMPAIGN, out = [];
      for (const ch of CAM.CHAPTERS) {
        let err = null;
        try { window.UI.brief(CAM, ch.key); } catch (e) { err = String(e && e.message || e); }
        out.push({ key: ch.key, err,
                   obj: (document.querySelector('#chapters-body .brief-obj') || {}).textContent || '',
                   prose: document.querySelectorAll('#chapters-body .brief p').length,
                   begin: !!document.getElementById('chapter-begin'),
                   back: !!document.getElementById('chapter-back') });
      }
      return out;
    });
    ok('every chapter briefs without throwing', all.every((q) => !q.err),
       all.filter((q) => q.err).map((q) => q.key + ': ' + q.err).join(' | '));
    ok('...and every one of them can be begun',
       all.every((q) => q.begin && q.back && q.prose >= 2),
       all.filter((q) => !(q.begin && q.back && q.prose >= 2)).map((q) => q.key).join(','));
    ok('...and states what it is asking',
       all.every((q) => /\w/.test(q.obj.replace(/[^\w]/g, '') || '')),
       all.map((q) => q.key + ':' + JSON.stringify(q.obj)).join(' '));
    /* ...and put the screen back where the rest of this suite expects it: reading the first
     * chapter, with BEGIN under the thumb */
    await pg.evaluate(() => window.UI.brief(window.CAMPAIGN, window.CAMPAIGN.CHAPTERS[0].key));

    await pg.click('#chapter-begin');
    await inMatchNow(pg);
    await until(pg, () => window.Render.ready);
    const started = await pg.evaluate(() => {
      const g = window.Game.game;
      const ch = window.CAMPAIGN.CHAPTERS[0];
      return { chapter: g.chapter && g.chapter.key, run: !!g.run, heir: g.bot && g.bot.kind,
               wantHeir: ch.heir, wantSeed: ch.seed >>> 0, seed: g.world.seed,
               objText: (document.getElementById('objective') || {}).textContent || '',
               objShown: !document.getElementById('objective').classList.contains('hidden') };
    });
    ok('BEGIN starts that chapter, against its own rival on its own pinned board',
       started.chapter === 'road' && started.run &&
       started.heir === started.wantHeir && started.seed === started.wantSeed,
       JSON.stringify(started));
    ok('...and the board carries the objective for as long as it is true',
       started.objShown && /\w/.test(started.objText), JSON.stringify(started));

    /* ---- PLAY IT. The first chapter asks for three Gates; hand them over and the chapter
     * must END — through `World.declare`, so the end screen, the chronicle and the progress
     * record all behave exactly as they do for a fallen Seat. ---- */
    const won = await pg.evaluate(async () => {
      const g = window.Game.game, W = window.World, C = window.CONST;
      const pl = g.world.players[0];
      pl.essence = 1e7;
      /* raise Gates on springs the ordinary way — the objective counts finished ones */
      const nodes = g.world.map.sites.filter((s) => s.kind === 'node');
      for (const s of nodes) {
        if (pl.buildings.filter((b) => b.bt === 'gate' && !b.raise).length >= 3) break;
        if (W.placementError(g.world, 0, s.x, s.y, 'gate') !== null) {
          /* beyond the writ: a Gate needs troops standing on it, so put some there */
          for (let i = 0; i < 3; i++)
            g.world.units.push({ id: g.world.nextId++, owner: 0, kind: 'soldier', tier: 1,
                                 x: s.x + i * 6, y: s.y, hp: 200, maxHp: 200, cd: 0,
                                 goal: null, co: 0, from: 0 });
          for (let k = 0; k < 4; k++) W.update(g.world, C.SIM_DT);
        }
        pl.essence = 1e7;
        W.applyCommand(g.world, 0, { c: 'build', bt: 'gate', x: s.x, y: s.y });
        for (let k = 0; k < 30 * 120 && pl.buildings.some((b) => b.raise > 0); k++) {
          pl.essence = 1e7; W.update(g.world, C.SIM_DT);
        }
      }
      const gates = pl.buildings.filter((b) => b.bt === 'gate' && !b.raise).length;
      /* one more frame of the real loop is what runs the objective */
      await new Promise((res) => setTimeout(res, 900));
      return { gates, winner: g.world.winner, reason: g.world.winReason,
               over: g.over, cleared: window.CAMPAIGN.cleared('road'),
               endShown: !document.getElementById('end').classList.contains('hidden'),
               sub: (document.getElementById('end-sub') || {}).textContent || '',
               next: (document.getElementById('end-next') || {}).textContent || '' };
    });
    ok('the rig is alive: three Gates stand', won.gates >= 3, String(won.gates));
    /* THE ASSERTIONS THAT FAIL WITHOUT THE CAMPAIGN — the sim has no third win condition */
    ok('meeting the objective ends the chapter', won.winner === 0 && won.reason === 'objective',
       `${won.winner}/${won.reason}`);
    ok('...through the ordinary ending, so the end screen is up', won.over && won.endShown,
       JSON.stringify({ over: won.over, endShown: won.endShown }));
    ok('...with the chapter\'s own words rather than the sim\'s', /realm|road|spring|well/i.test(won.sub), won.sub);
    ok('...the chapter is recorded as cleared', won.cleared === true, String(won.cleared));
    ok('...and the button names the chapter that follows', /II|SUCCESSION/i.test(won.next), won.next);
    ok('the page raised no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await pg.close();
  }

  /* ---------------- a tower throws something, and it comes out of the gun ----------------
   * Reported from play: no arrows from the ballista, no cannonballs from the towers. The sim
   * has always emitted a shot and the renderer has always had a branch for it — but the branch
   * drew the old hairline tracer, the very thing the arrow rewrite replaced for men because a
   * straight line between two points for a fifth of a second is what a laser looks like. Worse,
   * it launched from `groundH + 16`, which is inside the tower's own masonry about forty units
   * BELOW the ballista arms. So a firing Watchtower looked like nothing at all. */
  {
    suite('a tower throws something, and it comes out of the gun');
    const pg = await browser.newPage({ viewport: { width: 420, height: 860 } });
    const errs = [];
    pg.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
    pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await pg.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await ready(pg);
    await pg.evaluate((spec) => window.Game.startSP('julian', { spec, seed: 31 }), VEIL_BOARD);
    await inMatchNow(pg);
    await until(pg, () => window.Render.ready);
    const r = await pg.evaluate(async () => {
      const w = window.Game.game.world, C = window.CONST, pl = w.players[0];
      const c = window.World.cityOf(w, 0);
      const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const finish = () => {
        for (let i = 0; i < 40000; i++) {
          window.World.update(w, C.SIM_DT); w.events.length = 0; w.winner = null;
          for (let k = w.units.length - 1; k >= 0; k--)
            if (w.units[k].owner === C.CHAOS_ID) w.units.splice(k, 1);
          if (!pl.buildings.some((z) => z.raise > 0 || z.work > 0)) return;
        }
      };
      const out = {};
      let turn = 0;
      for (const br of ['bolt', 'cannon']) {
        pl.essence = 1e7;
        let at = null;
        for (let rad = 150; rad < C.CLAIM.seat - 40 && !at; rad += 14)
          for (let a = 0; a < 48 && !at; a++) {
            const th = (a / 48 + turn * 0.5) * Math.PI * 2;
            const x = c.x + Math.cos(th) * rad, y = c.y + Math.sin(th) * rad;
            if (window.World.placementError(w, 0, x, y, 'tower') === null) at = { x, y };
          }
        turn++;
        if (!at) { out[br] = { err: 'nowhere to build' }; continue; }
        window.World.applyCommand(w, 0, { c: 'build', bt: 'tower', x: at.x, y: at.y });
        const t = pl.buildings[pl.buildings.length - 1];
        finish();
        pl.essence = 1e7;
        window.World.applyCommand(w, 0, { c: 'up', id: t.id, br });
        finish();
        await frame();
        const top = window.Render.debugWorkTop(t.id);   // 'stone-top N  ...' or 'top N — no flag'
        const stone = top && +(top.match(/(?:stone-)?top ([\d.]+)/) || [])[1];
        /* a victim just inside its reach, and the gun ready */
        const st = window.World.towerStats(t);
        w.units.push({ id: 9000 + turn, owner: 1, kind: 'soldier', x: t.x + st.range * 0.6,
                       y: t.y, hp: 1e6, maxHp: 1e6, cd: 0, goal: null, co: 0 });
        t.cd = 0;
        w.events.length = 0;
        for (let i = 0; i < 8; i++) window.World.update(w, C.SIM_DT);
        const shots = w.events.filter((e) => e.e === 'shot');
        window.Render.addEvents(shots, null, 0);
        const fl = window.Render.debugFlights().filter((f) => Math.hypot(f.x1 - t.x, f.z1 - t.y) < 30);
        /* the pools are built in the DRAW, not in `addEvents` — a ball has to be on screen
         * once before there is a mesh to ask about */
        await frame();
        out[br] = { shots: shots.length, flights: fl.length, ball: fl.length ? fl[0].ball : null,
                    y1: fl.length ? fl[0].y1 : null, stone, ballGeo: window.Render.debugBallGeo(),
                    ground: window.Render.groundH(t.x, t.y) };
        w.events.length = 0;
        window.Render.debugFlights().length;
      }
      return out;
    });
    const B = r.bolt || {}, K = r.cannon || {};
    ok('the rig is alive: both towers fired', B.shots > 0 && K.shots > 0,
       `ballista ${B.shots} shots, cannon ${K.shots}`);
    /* THE ASSERTIONS THAT FAIL ON THE OLD CODE — it drew a hairline and nothing else */
    ok('a ballista puts a dart in the air', B.flights > 0 && B.ball === false,
       `${B.flights} in flight, ball=${B.ball}`);
    ok('a cannon puts a ball in the air', K.flights > 0 && K.ball === true,
       `${K.flights} in flight, ball=${K.ball}`);
    /* ...and it leaves the GUN. The old tracer was born at ground + 16, inside the shaft. */
    ok('the shot leaves the tower\'s crown, not its foundations',
       B.y1 != null && B.stone && B.y1 > B.stone - 12,
       `launched at ${B.y1 && B.y1.toFixed(0)}, the stone tops out at ${B.stone}`);
    ok('...and the cannon likewise', K.y1 != null && K.stone && K.y1 > K.stone - 12,
       `launched at ${K.y1 && K.y1.toFixed(0)}, the stone tops out at ${K.stone}`);
    /* the ball's own geometry must carry vertex colours or the shared `vertexColors` material
     * multiplies its instance colour to black — invisible, with nothing thrown to say so */
    ok('the ball can carry a colour', K.ballGeo === true, `ballGeo=${K.ballGeo}`);
    ok('the page raised no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await pg.close();
  }

  /* ---------------- the Jewel's storm survives a second match ----------------
   * `buildWorld` empties and disposes everything in `worldG` and then nulls every cached handle
   * into it — the halo, the darts, the chains, the writ, the fx list — because a handle that
   * outlives its mesh is a frame written into a mesh that is no longer in the scene. The storm
   * pool was the one thing missed off that list, and its slots re-create lazily behind
   * `if (!ss.disc)`, which is FALSE for an orphan. So from the second match of a session onward
   * every cast set `visible = true` on a disc nobody would ever draw, and the only thing still
   * rendering was the point light — which is added to `scene`, not `worldG`. Reported from play
   * as the Jewel having no visual effect at all.
   * The existing storm suite checks `.visible` and would pass throughout; this one asks whether
   * the disc is IN THE SCENE, and it plays a second match to get there. */
  {
    suite('the Jewel\'s storm survives a second match');
    const pg = await browser.newPage({ viewport: { width: 420, height: 860 } });
    const errs = [];
    pg.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
    pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await pg.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await ready(pg);
    const cast = async () => pg.evaluate(async () => {
      const w = window.Game.game.world, C = window.CONST;
      const c = window.World.cityOf(w, 0);
      w.players[0].essence = 1e7;
      w.players[0].powers.storm = 0;
      const r = window.World.applyCommand(w, 0, { c: 'power', k: 'storm', x: c.x + 60, y: c.y });
      for (let i = 0; i < 6; i++) window.World.update(w, C.SIM_DT);
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const st = (window.Render.debugStorms() || []).filter((q) => q.disc);
      return { ok: r.ok, err: r.err, storms: w.storms.length,
               shown: st.filter((q) => q.disc.visible).length,
               inScene: st.filter((q) => q.disc.visible && q.disc.parent).length };
    });
    await pg.evaluate((spec) => window.Game.startSP('julian', { spec, seed: 3 }), VEIL_BOARD);
    await inMatchNow(pg); await until(pg, () => window.Render.ready);
    const first = await cast();
    ok('the rig is alive: the storm is cast and drawn in the first match',
       first.ok && first.storms > 0 && first.shown > 0,
       `ok=${first.ok} err=${first.err} storms=${first.storms} shown=${first.shown}`);
    /* a SECOND match on the same page: a new seed rebuilds the world and empties worldG */
    await pg.evaluate((spec) => window.Game.startSP('bleys', { spec, seed: 9 }), VEIL_BOARD);
    await inMatchNow(pg); await until(pg, () => window.Render.ready);
    const second = await cast();
    ok('the storm is cast in the second match too', second.ok && second.storms > 0,
       `ok=${second.ok} err=${second.err}`);
    /* THE ASSERTION THAT FAILS ON THE OLD CODE — the disc was visible and not in the scene */
    ok('...and its disc is IN THE SCENE, not an orphan of the last world',
       second.inScene > 0, `${second.shown} visible, ${second.inScene} actually in the scene`);
    ok('the page raised no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await pg.close();
  }

  /* ---------------- a standard flies clear of its own roof ----------------
   * Reported from play, with a picture: a tower's pennant buried in the tower's roof. The
   * height of a held work's standard was `62 + (level-1)*9` for a tower and two other
   * constants for everything else — a guess about one branch of one work at one moment. A
   * Watchtower's shaft grows with its level, each branch piles its own deck on the crown, a
   * garrison hangs shields off it, and a BASTION — a tower built into a curtain — is lifted
   * again by the stone underneath. That last term is the one the old expression could not
   * have known about, and it is the case in the photograph: measured, the bastion's pennant
   * sat 13.5 units INSIDE its own roof while every free-standing tower cleared.
   * So the suite builds the photographed case and asks the renderer where both are. */
  {
    suite('a standard flies clear of its own roof');
    const pg = await browser.newPage({ viewport: { width: 420, height: 860 } });
    const errs = [];
    pg.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
    pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await pg.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await ready(pg);
    await pg.evaluate((spec) => window.Game.startSP('julian', { spec, seed: 7 }), VEIL_BOARD);
    await inMatchNow(pg);
    await until(pg, () => window.Render.ready);
    const r = await pg.evaluate(async () => {
      const w = window.Game.game.world, C = window.CONST, pl = w.players[0];
      const c = window.World.cityOf(w, 0);
      const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      /* run the masons out rather than sleeping: a raise is essence and crews, not seconds */
      const finish = () => {
        for (let i = 0; i < 40000; i++) {
          window.World.update(w, C.SIM_DT);
          w.events.length = 0; w.winner = null; w.storms.length = 0;
          for (let k = w.units.length - 1; k >= 0; k--)
            if (w.units[k].owner === C.CHAOS_ID) w.units.splice(k, 1);
          if (!pl.buildings.some((z) => z.raise > 0 || z.work > 0)) return;
        }
      };
      const cases = [];
      /* a tall free-standing tower — the shape the old constant was fitted to */
      pl.essence = 1e7;
      let at = null;
      for (let rad = 150; rad < C.CLAIM.seat - 40 && !at; rad += 14)
        for (let a = 0; a < 48 && !at; a++) {
          const th = (a / 48) * Math.PI * 2;
          const x = c.x + Math.cos(th) * rad, y = c.y + Math.sin(th) * rad;
          if (window.World.placementError(w, 0, x, y, 'tower') === null) at = { x, y };
        }
      if (at && window.World.applyCommand(w, 0, { c: 'build', bt: 'tower', x: at.x, y: at.y }).ok) {
        const t = pl.buildings[pl.buildings.length - 1];
        finish();
        for (let k = 1; k < 3; k++) {
          pl.essence = 1e7;
          if (!window.World.applyCommand(w, 0, { c: 'up', id: t.id, br: 'cannon' }).ok) break;
          finish();
        }
        cases.push({ name: 'a cannon tower at its full height', t, onWall: 0 });
      }
      /* AND THE BASTION: a curtain, then a tower on its midpoint */
      pl.essence = 1e7;
      const L = C.WALL.unit;
      let run = null;
      for (let rad = 200; rad < C.CLAIM.seat - 60 && !run; rad += 16)
        for (let a = 0; a < 40 && !run; a++) {
          const th = (a / 40) * Math.PI * 2;
          const ax = c.x + Math.cos(th) * rad, ay = c.y + Math.sin(th) * rad;
          if (!window.World.wallError(w, 0, ax, ay, ax + L, ay)) run = { ax, ay, bx: ax + L, by: ay };
        }
      if (run && window.World.applyCommand(w, 0,
          { c: 'build', bt: 'wall', x: run.ax, y: run.ay, x2: run.bx, y2: run.by }).ok) {
        finish();
        pl.essence = 1e7;
        const mx = (run.ax + run.bx) / 2, my = (run.ay + run.by) / 2;
        if (window.World.applyCommand(w, 0, { c: 'build', bt: 'tower', x: mx, y: my }).ok) {
          const t = pl.buildings[pl.buildings.length - 1];
          finish();
          cases.push({ name: 'a bastion built into a curtain', t, onWall: 1 });
        }
      }
      /* THE MEN GO IN LAST. postAll() recomputes `man`/`tow` from orders at the top of every
       * tick, so a garrison placed by hand before another build's fast-forward is wiped by
       * it — an earlier rig read "no flag" for eleven of twelve cases and called it a
       * renderer bug. It was the rig. */
      w.units.length = 0;
      for (const cse of cases)
        for (let i = 0; i < 4; i++)
          w.units.push({ id: 8000 + w.units.length, owner: 0, co: 1, kind: 'archer',
                         x: cse.t.x, y: cse.t.y, hp: 40, maxHp: 40, cd: 0, goal: null,
                         tow: cse.t.id, in: cse.t.id });
      if (!pl.companies.length) pl.companies = [{ id: 1, rally: null }];
      window.World.bearers(w); window.World.refreshVision(w, true);
      window.World.update = () => {};
      await frame(); await frame();
      return cases.map((cse) => ({ name: cse.name, onWall: cse.onWall,
                                   read: window.Render.debugWorkTop(cse.t.id) }));
    });
    const num = (s, k) => { const m = s && s.match(new RegExp(k + ' (-?[\\d.]+)')); return m ? +m[1] : null; };
    ok('the rig is alive: it raised a tower and a bastion, both flying a standard',
       r.length === 2 && r.every((z) => z.read && /pennant/.test(z.read)),
       r.map((z) => `${z.name}: ${z.read}`).join(' | ') || 'nothing built');
    for (const z of r) {
      /* THE ASSERTION THAT FAILS ON THE OLD CODE (for the bastion) */
      ok(`${z.name} flies its standard above the stone`, num(z.read, 'clearance') > 0, z.read);
    }
    ok('the page raised no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await pg.close();
  }

  /* ---------------- a new match opens on a Seat that is standing ----------------
   * Reported from play, from a phone, thirty seconds into a LAN match: the Seat drawn as a
   * broken stump while the sim said it was at full health. The collapse animation is module
   * state in the renderer and nothing emptied it — it was spliced only when a seat had no
   * tower, and a world rebuild gives every seat a NEW tower. So the entry outlived its match,
   * its t0 was minutes stale, and the fresh throne opened at the END of a fall it had never
   * begun. Nothing to do with LAN: LAN is where you rematch without reloading the page.
   * The suite plays the fall, waits for it to finish, starts a SECOND match on the same page
   * and asks the renderer where the tower is. */
  {
    suite('a new match opens on a Seat that is standing');
    const pg = await browser.newPage({ viewport: { width: 420, height: 860 } });
    const errs = [];
    pg.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
    pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await pg.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await ready(pg);
    await pg.evaluate((spec) => window.Game.startSP('julian', { spec, seed: 1 }), VEIL_BOARD);
    await inMatchNow(pg);
    await until(pg, () => window.Render.ready);
    const fell = await pg.evaluate(async () => {
      window.Render.seatFall(0);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return window.Render.debugSeatTower(0);
    });
    /* THE RIG HAS TO SHOW IT CAN TOPPLE A TOWER before "the tower is upright" means anything */
    ok('the rig is alive: a called-for collapse really moves the Seat',
       !!fell && (fell.base - fell.y > 0.5 || fell.lean > 0.001),
       fell ? `y ${fell.y.toFixed(1)} of base ${fell.base.toFixed(1)}, lean ${fell.lean.toFixed(3)}` : 'no tower');
    await pg.waitForTimeout(2900);                    // let the fall finish and go stale
    await pg.evaluate((spec) => window.Game.startSP('bleys', { spec, seed: 2 }), VEIL_BOARD);
    await inMatchNow(pg);
    await until(pg, () => window.Render.ready);
    const now = await pg.evaluate(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { t: window.Render.debugSeatTower(0), falls: window.Render.debugSeatFall() };
    });
    ok('the second match has no collapse left over from the first', !now.falls, 'a fall is still in flight');
    if (now.t) {
      ok('...and its Seat stands at full height', Math.abs(now.t.y - now.t.base) < 0.5,
         `y ${now.t.y.toFixed(1)} of base ${now.t.base.toFixed(1)}`);
      ok('...upright', Math.abs(now.t.lean) < 0.001, `lean ${now.t.lean.toFixed(3)}`);
      ok('...and solid', now.t.opacity > 0.99, `opacity ${now.t.opacity.toFixed(2)}`);
    } else {
      ok('the new match has a Seat tower at all', false, 'no tower');
    }
    ok('the page raised no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await pg.close();
  }

  /* ---------------- nothing in the world escapes the veil ----------------
   * THE ONE HAZARD OF PUTTING THE VEIL IN THE MATERIALS. The 2D canvas covered the whole
   * screen and so covered everything on it by construction; the shader covers what it was
   * handed, and a mesh added later without `fogPatch` shines at full strength across black
   * shroud. That is not hypothetical — the writ was an unpatched LineBasicMaterial and read
   * as the writ and the sight disagreeing about where the ground was.
   * So: play a match out far enough that ghosts, standards, storms, hexes, event rings and
   * every kind of work exist, then ask the scene. The only things allowed to escape are the
   * two named AFFORDANCES — the selection ring and the armed-company halo — which answer the
   * player rather than describe the land, and veiling an answer to the player is a bug. */
  {
    suite('nothing in the world escapes the veil');
    const { pg, errs } = await veilPage(browser, base, { viewport: { width: 420, height: 860 } });
    const found = await pg.evaluate(async () => {
      const w = window.Game.game.world;
      /* veilPage freezes the sim; put it back, because half these meshes only exist once
       * somebody has shot at somebody. A guard that runs on an empty board guards nothing. */
      window.World.update = window.__realUpdate;
      const step = window.World.update;
      let ok2 = false;
      if (typeof step === 'function') {
        const t0 = w.tick;
        for (let i = 0; i < 9000; i++) { step(w, 1 / 30); w.winner = null; }
        ok2 = w.tick > t0;                          // the sim really ran, it was not a no-op
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { list: window.Render.debugUnpatched(), stepped: ok2,
               works: w.players.reduce((n, p) => n + p.buildings.length, 0), units: w.units.length };
    });
    ok('the rig is alive: the sim really ran and there is a world with things in it',
       found.stepped && found.works >= 2 && found.units >= 10,
       `stepped ${found.stepped}, works ${found.works}, units ${found.units}`);
    const tally = {};
    for (const k of found.list) tally[k] = (tally[k] || 0) + 1;
    ok('every material in the world is under the veil', found.list.length === 0,
       Object.entries(tally).map(([k, n]) => `${k} x${n}`).join(', '));
    ok('the page raised no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await pg.close();
  }

  /* ---------------- the terms tray ----------------
   * The chip IS the readout — that is what lets offering be silent, and it means the tray has
   * to say all four states and has to take a tap. Driven through the real page: the click goes
   * through the listener, the command through `applyCommand`, and the state comes back off the
   * DOM the way a player would read it. */
  {
    suite('terms are offered from the tray');
    const pg = await browser.newPage({ viewport: { width: 420, height: 860 } });
    const errs = [];
    pg.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
    pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await pg.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await ready(pg);

    /* THE CONTROL FIRST: an ordinary skirmish has no terms in it at all, and if the tray showed
     * up there the rest of this suite would be measuring nothing. */
    await pg.evaluate(() => window.Game.startSP('julian', { seed: 20260911 }, false));
    await pg.waitForTimeout(400);
    const plain = await pg.evaluate(() => {
      const t = document.getElementById('terms');
      return { hidden: t.classList.contains('hidden'), chips: t.querySelectorAll('.term').length };
    });
    ok('a skirmish has no terms to be had, and shows none',
       plain.hidden && plain.chips === 0, JSON.stringify(plain));

    await pg.evaluate(() => window.Game.startSP('julian', { seed: 20260911, rules: { truce: 1 } }, false));
    await pg.waitForTimeout(400);
    const read = () => pg.evaluate(() => {
      const t = document.getElementById('terms'), c = t.querySelector('.term');
      return { hidden: t.classList.contains('hidden'), chips: t.querySelectorAll('.term').length,
               cls: c ? c.className : null, text: c ? c.textContent : null,
               pact: window.World.pactOn(window.Game.game.world, 0, 1),
               /* it must clear the walkers' board rather than sit on top of it */
               below: (() => { const r = document.getElementById('walkers').getBoundingClientRect();
                               return t.getBoundingClientRect().top >= r.top - 1; })() };
    });
    const war = await read();
    ok('a war with terms in it shows one chip per rival',
       !war.hidden && war.chips === 1, JSON.stringify(war));
    ok('...saying they are at war, and what a tap would do', /at war/.test(war.text || ''), war.text);
    ok('...and it hangs below the walkers, not over them', war.below, 'the two boards overlap');
    ok('...and nothing is sealed yet', war.pact === false, String(war.pact));

    await pg.click('#terms .term');
    await pg.waitForTimeout(250);
    const asked = await read();
    ok('a tap offers terms', /offered/.test(asked.cls || ''), asked.cls + ' — ' + asked.text);
    ok('...which seals nothing on its own', asked.pact === false, String(asked.pact));

    /* the Warden takes them — let his own doctrine answer, which is the whole point of having
     * one, rather than reaching into the world and setting the bit */
    await pg.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    await pg.waitForFunction(() => window.World.pactOn(window.Game.game.world, 0, 1), { timeout: 15000 });
    await pg.waitForTimeout(300);
    const sealed = await read();
    ok('the Warden answers, and the chip says so',
       /sealed/.test(sealed.cls || '') && /at terms/.test(sealed.text || ''),
       sealed.cls + ' — ' + sealed.text);

    await pg.click('#terms .term');
    await pg.waitForTimeout(250);
    const broken = await read();
    ok('and a second tap breaks it', broken.pact === false, String(broken.pact));
    ok('the page raised no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await pg.close();
  }

  await browser.close();
  srv.close();
  process.exit(report('browser'));
})().catch((e) => { console.error(e); process.exit(1); });

/* test/browser.js — the half of the game that only exists in a browser: input routing,
 * the camera, the writ overlay, HUD layering, and the back button.
 *
 * Everything here drives REAL pointer/history events against a real page. Screen positions
 * are always asked of the renderer itself (R.project) so a test can never drift away from
 * the projection the player actually sees — that lesson cost several false alarms.
 *
 * Needs Playwright + Chromium. Without them it reports a skip and exits 0, so `npm test`
 * still means something on a machine that has neither. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { suite, ok, report, record } = require('./lib.js');

const ROOT = path.join(__dirname, '..');
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

/* open a page, walk the menu, and land in a skirmish against a fixed heir */
async function match(browser, base, renderer) {
  const pg = await browser.newPage({ viewport: { width: 420, height: 860 } });
  const errs = [];
  pg.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await ready(pg);
  await pg.click('#btn-skirmish'); await pg.waitForTimeout(120);
  await pg.evaluate(() => [...document.querySelectorAll('#skirmish-row button')]
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
          for (const p of g.world.players) { p.castleHp = C.CASTLE_HP; p.pattern = 0; }
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
    await pg.click('#btn-skirmish'); await pg.waitForTimeout(200);
    ok('the skirmish row opens', !(await hidden('skirmish-row')));
    await pg.mouse.click(60, 60); await pg.waitForTimeout(200);
    ok('tapping away closes the skirmish row', await hidden('skirmish-row'));
    await pg.click('#btn-lan'); await pg.waitForTimeout(200);
    ok('the LAN panel opens', !(await hidden('lan-panel')));
    await pg.mouse.click(60, 60); await pg.waitForTimeout(200);
    ok('tapping away closes the LAN panel', await hidden('lan-panel'));

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
               inFold: document.querySelectorAll('#skirmish-row .diff').length,
               visible: !document.getElementById('footing-row').classList.contains('hidden') };
    });
    ok('every footing is offered', diff.n >= 3 && diff.n === diff.keys.length, diff.keys.join(','));
    ok('and offered outside either fold-out, since it governs both', diff.inFold === 0 && diff.visible);
    ok('one is marked, and it is the remembered choice', diff.marked.length === 1 && diff.marked[0] === diff.before,
       `marked ${diff.marked} vs ${diff.before}`);
    ok('which defaults to something short of full strength', diff.before === diff.dflt && diff.dflt !== 'prince',
       diff.before);

    /* it reaches a SKIRMISH... */
    await pg.evaluate(() => { window.UI.setDifficulty('squire'); });
    await pg.click('#btn-skirmish'); await pg.waitForTimeout(200);
    await pg.evaluate(() => [...document.querySelectorAll('#skirmish-row button')]
      .find((e) => /julian/i.test(e.textContent)).click());
    await inMatchNow(pg);
    const applied = await pg.evaluate(() => {
      const C = window.CONST, g = window.Game.game;
      return { eco: g.world.players[1].eco, mine: g.world.players[0].eco, want: C.DIFFICULTY.squire.eco };
    });
    ok('the chosen handicap reaches the heir', applied.eco === applied.want, `eco ${applied.eco}`);
    ok('and never touches your own side', applied.mine === 1, `eco ${applied.mine}`);

    /* ...and the CAMPAIGN, which used to ignore it entirely */
    await pg.evaluate(() => { window.Game.toMenu(); });
    await pg.waitForTimeout(300);
    const camp = await pg.evaluate(async () => {
      const C = window.CONST;
      localStorage.setItem('amber_rung', '0');
      window.UI.setDifficulty('prince');
      window.Game.toMenu();
      document.getElementById('btn-campaign').click();
      await new Promise((res) => setTimeout(res, 400));
      const g = window.Game.game;
      return { eco: g.world.players[1].eco, want: C.DIFFICULTY.prince.eco,
               rival: g.names[1], campaign: g.campaign };
    });
    ok('the campaign runs on the same footing', camp.eco === camp.want && camp.campaign,
       `eco ${camp.eco}, wanted ${camp.want}`);
    ok('and the first rung is the first heir', /julian/i.test(camp.rival), camp.rival);

    /* A CLAIMED THRONE WALKS THE SUCCESSION AGAIN, FROM THE START. The index was clamped
     * rather than wrapped, so finishing dropped you straight back onto the hardest rung. */
    const again = await pg.evaluate(async () => {
      const L = 4;
      localStorage.setItem('amber_rung', String(L));   // the whole ladder claimed
      window.Game.toMenu();
      await new Promise((res) => setTimeout(res, 200));
      const label = document.getElementById('btn-campaign').textContent;
      const note = document.getElementById('campaign-note').textContent;
      document.getElementById('btn-campaign').click();
      await new Promise((res) => setTimeout(res, 400));
      return { label, note, rival: window.Game.game.names[1],
               rung: localStorage.getItem('amber_rung') };
    });
    ok('a claimed throne offers the walk again', /AGAIN/i.test(again.label), again.label);
    ok('and says where it starts', /julian/i.test(again.note), again.note);
    ok('which is the FIRST heir, not the last', /julian/i.test(again.rival), again.rival);
    ok('and the ladder is back at its first rung', again.rung === '0', again.rung);

    await pg.evaluate(() => {
      window.UI.setDifficulty(window.CONST.DIFFICULTY_DEFAULT);
      localStorage.setItem('amber_rung', '0');
      window.Game.toMenu();
    });
    await pg.waitForTimeout(400);
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
      const bare = (p) => R.hitBuilding(p.x, p.y) < 0 && R.hitSite(p.x, p.y, g.world, 0, false) < 0;
      for (let k = 1; k <= 12 && !bare(s); k++) {
        const q = R.project(c.x + a * (1 + k * 0.22), c.y + b * (1 + k * 0.22));
        if (q.y < lid && q.y > 80 && q.x > 20 && q.x < window.innerWidth - 20) s = q;
      }
      return { x: s.x, y: s.y, lid: Math.round(lid) };
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
      const spring = g.world.map.sites.filter((q) => q.kind === 'node')
        .map((q) => ({ q, d: Math.hypot(q.x - seat.x, q.y - seat.y) }))
        .sort((m, n) => m.d - n.d)[0];
      let placed = false;
      for (let rr = 18; rr < window.CONST.NODE.r && !placed; rr += 12)
        for (let a = 0; a < 24 && !placed; a++) {
          const th = a / 24 * Math.PI * 2;
          const x = spring.q.x + Math.cos(th) * rr, y = spring.q.y + Math.sin(th) * rr;
          if (!W.placementError(g.world, 0, x, y, 'gate')) { W.applyCommand(g.world, 0, { c: 'build', x, y, bt: 'gate' }); placed = true; }
        }
      return { placed, before, after: outline(), at: Math.round(spring.d) };
    });
    ok('raising a Gate on the nearest spring extends the writ', grew.placed && grew.after > grew.before,
       `spring at ${grew.at}: ${grew.before} -> ${grew.after} segments`);

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
    let p = await nearSeat(110, 0);
    await pg.mouse.click(p.x, p.y); await until(pg, () => window.UI.sheetOpen());
    ok('a build sheet opens on bare ground', await sheetOpen());
    p = await nearSeat(-110, 40);
    await pg.mouse.click(p.x, p.y); await until(pg, () => !window.UI.sheetOpen());
    ok('tapping outside closes it rather than opening another', !(await sheetOpen()));
    await pg.mouse.click(p.x, p.y); await until(pg, () => window.UI.sheetOpen());
    ok('a second tap then opens the sheet normally', await sheetOpen());

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
    const banner = await pg.evaluate(() => window.Game.game.world.players[0].banner);
    ok('an armed flag still plants through an open sheet', banner && banner.site === node.id,
       `banner site ${node.before} -> ${banner && banner.site}`);

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
        b: window.Game.game.world.players[0].banner,
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
      for (const b of g.world.players[0].buildings) { b.raise = 0; b.work = 0; }
      const paint = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      /* a hall, finished */
      W.applyCommand(g.world, 0, { c: 'build', bt: 'barracks', x: c.x + 150, y: c.y + 30 });
      const hall = g.world.players[0].buildings.filter((b) => b.bt === 'barracks').pop();
      hall.raise = 0; hall.hp = hall.maxHp;
      await paint();
      const keyAt1 = [...R.debugWorks().values()].find((wk) => wk.id === hall.id);
      /* raise it, and catch it mid-masonry */
      const up = W.applyCommand(g.world, 0, { c: 'up', id: hall.id });
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
      return { up: up.ok, level: hall.level,
               k1: keyAt1 && keyAt1.key, kMid: mid && mid.key, k2: keyAt2 && keyAt2.key,
               v1: keyAt1 && keyAt1.verts, v2: keyAt2 && keyAt2.verts,
               midOpacity: mid && mid.opacity,
               vetMesh: !!im['soldier#2'] && im['soldier#2'].count,
               vetVerts: im['soldier#2'] && im['soldier#2'].geometry.attributes.position.count,
               eliteVerts: im['soldier#3'] && im['soldier#3'].geometry.attributes.position.count,
               recVerts: im['soldier#1'] && im['soldier#1'].geometry.attributes.position.count };
    });
    ok('a hall can be raised a level in the live game', rank.up && rank.level === 2, JSON.stringify(rank));
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
          return { ax: sa.x, ay: sa.y, bx: sb.x, by: sb.y, wax: A.x, way: A.y, wbx: B.x, wby: B.y };
        }
      }
      return null;
    });
    ok('a legal run can be found on screen', !!run);
    if (run) {
      await pg.mouse.click(run.ax, run.ay); await until(pg, () => window.UI.sheetOpen());
      const hasCard = await pg.evaluate(() =>
        !!document.querySelector('#sheet .card[data-bt="wall"]'));
      ok('the build sheet offers a curtain wall', hasCard);
      const armed = await pg.evaluate(() => {
        const card = document.querySelector('#sheet .card[data-bt="wall"]');
        if (!card || card.classList.contains('locked')) return null;
        card.click();
        return window.Game.game.span ? { x: window.Game.game.span.x, y: window.Game.game.span.y } : null;
      });
      ok('the card arms the run rather than raising a work', !!armed);
      ok('...and the sheet gets out of the way', !(await sheetOpen()));
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
        /* one man right against the wall, one well behind it */
        const mk = (off) => {
          const d = C2.UNITS.soldier;
          const u = { id: g.world.nextId++, owner: 0, kind: 'soldier',
                      x: b.x + (nx / nL) * off, y: b.y + (ny / nL) * off, ox: 0, oy: 0,
                      hp: 100, maxHp: 100, dmg: d.dmg, cd: 0, goal: null, co: 0, from: -1 };
          g.world.units.push(u); return u;
        };
        const on = mk(C2.WALL.man * 0.4), off = mk(C2.WALL.man + 70);
        window.World.update(g.world, C2.SIM_DT);
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        /* screen y RISES up the page, so a man standing on a wall projects HIGHER than the
         * ground he would otherwise stand on */
        /* the lift itself, read off the renderer's own instance matrices rather than
         * re-derived — and read in the SAME step, because the man is under his banner's
         * orders and walks off the wall a second later */
        const im = R.debugUnitMeshes()['soldier#1'];
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
        return { man: on.man || 0, manOff: off.man || 0,
                 lift: heightNear(on), flat: heightNear(off) };
      });
      ok('the sim puts the man at the wall ON the wall', climbed.man > 0, climbed.man);
      ok('...and leaves the man behind it on the ground', climbed.manOff === 0, climbed.manOff);
      ok('and the renderer draws him up on the walkway', climbed.lift > 15,
         `on the wall ${climbed.lift.toFixed(1)} above ground, behind it ${climbed.flat.toFixed(1)}`);
      ok('...while the man behind it stays on the grass', climbed.flat < 8, climbed.flat.toFixed(1));

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

    /* ---------------- an open sheet keeps asking ---------------- *
     * A card refused for a reason that can CHANGE — the masons are busy, or no troops of yours
     * stand at the spring yet — has to go live in place. Closing and re-opening the menu to
     * discover the answer changed is not an interface. */
    suite(`${r} · the sheet stays live`);
    await pg.evaluate(() => { window.UI.closeSheet(); window.Game.game.armedFlag = null; });
    await pg.waitForTimeout(150);
    const live = await pg.evaluate(async () => {
      const W = window.World, C = window.CONST, g = window.Game.game;
      const c = g.world.map.sites[g.world.map.cities[0]];
      g.world.players[0].essence = 99000;
      /* finish anything standing, then start one work so the masons are demonstrably busy */
      window.__step(40, { raising: true });
      let at = null;
      for (let rad = 170; rad < 400 && !at; rad += 20)
        for (let a = 0; a < 40 && !at; a++) {
          const th = a / 40 * Math.PI * 2, x = c.x + Math.cos(th) * rad, y = c.y + Math.sin(th) * rad;
          if (W.placementError(g.world, 0, x, y, 'tower') === null) at = { x, y };
        }
      if (!at) return { ok: false, why: 'nowhere to build' };
      W.applyCommand(g.world, 0, { c: 'build', ...at, bt: 'tower' });
      const shell = g.world.players[0].buildings.find((q) => q.raise > 0);

      /* open the build sheet on some OTHER open ground while they are busy */
      let at2 = null;
      for (let rad = 200; rad < 420 && !at2; rad += 20)
        for (let a = 0; a < 40 && !at2; a++) {
          const th = a / 40 * Math.PI * 2 + 0.3, x = c.x + Math.cos(th) * rad, y = c.y + Math.sin(th) * rad;
          if (W.placementError(g.world, 0, x, y, 'tower') === 'busy') at2 = { x, y };
        }
      if (!at2) return { ok: false, why: 'no spot reported busy' };
      window.UI.buildSheet(at2, g.world.players[0].essence,
        (bt) => W.placementError(g.world, 0, at2.x, at2.y, bt));
      const card = () => document.querySelector('#sheet .card[data-bt="tower"]');
      const lockedWhileBusy = card() && card().classList.contains('locked');
      const saidBusy = card() && /masons/i.test(card().textContent);

      /* let the masons finish WITHOUT touching the sheet */
      window.__step(40, { raising: true });
      window.UI.tick(g.world.players[0].essence);
      await new Promise((res) => requestAnimationFrame(res));
      const stillOpen = window.UI.sheetOpen();
      const freeNow = card() && !card().classList.contains('locked');
      return { ok: true, lockedWhileBusy, saidBusy, stillOpen, freeNow,
               text: card() ? card().textContent.slice(0, 70) : 'no card' };
    });
    ok('the scenario set up', live.ok, live.why || '');
    if (live.ok) {
      ok('a card is locked while the masons are busy', live.lockedWhileBusy);
      ok('and says so', live.saidBusy, live.text);
      ok('the sheet is still the one you opened', live.stillOpen);
      ok('the card goes live when the masons finish, without reopening', live.freeNow, live.text);
    }

    /* the other reason that changes on its own: a spring beyond your writ needs your troops
     * standing on it, and they may arrive long after you opened the sheet */
    const arrive = await pg.evaluate(async () => {
      const W = window.World, C = window.CONST, g = window.Game.game;
      const c = g.world.map.sites[g.world.map.cities[0]];
      g.world.players[0].essence = 99000;
      window.__step(40, { raising: true });
      /* an unheld spring outside the writ, with nobody of ours near it */
      const spring = g.world.map.sites.filter((s) => s.kind === 'node')
        .find((s) => Math.hypot(s.x - c.x, s.y - c.y) > C.CLAIM.seat + 120 &&
                     W.placementError(g.world, 0, s.x + 40, s.y, 'gate') === 'presence');
      if (!spring) return { ok: false, why: 'no spring reported presence' };
      const at = { x: spring.x + 40, y: spring.y };
      window.UI.buildSheet(at, g.world.players[0].essence,
        (bt) => W.placementError(g.world, 0, at.x, at.y, bt));
      const card = () => document.querySelector('#sheet .card[data-bt="gate"]');
      const lockedAway = card() && card().classList.contains('locked');
      const saidTroops = card() && /troops/i.test(card().textContent);
      /* march someone there — a Trump champion is the quickest honest way */
      g.world.players[0].powers.trump = 0;
      W.applyCommand(g.world, 0, { c: 'power', k: 'trump' });
      const champ = g.world.units.find((u) => u.id === g.world.players[0].championId);
      if (!champ) return { ok: false, why: 'no champion' };
      champ.x = spring.x; champ.y = spring.y;
      W.update(g.world, C.SIM_DT);
      window.UI.tick(g.world.players[0].essence);
      await new Promise((res) => requestAnimationFrame(res));
      return { ok: true, lockedAway, saidTroops,
               freeNow: card() && !card().classList.contains('locked'),
               text: card() ? card().textContent.slice(0, 70) : 'no card' };
    });
    ok('a spring beyond the writ was found', arrive.ok, arrive.why || '');
    if (arrive.ok) {
      ok('its Gate is locked while no troops of yours stand there', arrive.lockedAway);
      ok('and says why', arrive.saidTroops, arrive.text);
      ok('it goes live the moment a soldier arrives, without reopening', arrive.freeNow, arrive.text);
    }
    await pg.evaluate(() => window.UI.closeSheet());

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
        for (const p of g.world.players) { p.essence = Math.max(p.essence, 50000); p.castleHp = C.CASTLE_HP; }
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
      const royal = document.querySelector('#flag-tray .fbtn');
      return { ok: true, halls: 2, companies: g.world.players[0].companies.length,
               chips: before, coChips: document.querySelectorAll('#flag-tray .fbtn.co').length,
               royalWarns: !!royal.querySelector('.fcount.away'),
               sameCo: a1.co === a2.co };
    });
    ok('the scenario set up', co.ok, co.why || '');
    if (co.ok) {
      ok('two halls can muster into ONE company', co.sameCo && co.companies === 1,
         `${co.companies} companies for ${co.halls} halls`);
      ok('and the tray shows one chip for it, not one per hall', co.coChips === 1,
         `${co.coChips} company chips, ${co.chips} chips in all`);
      ok('the gold flag says when part of the army no longer answers it', co.royalWarns);
    }

    /* ---------------- the back button ---------------- *
     * Start from a clean slate: the input suite deliberately leaves a sheet open, and a
     * tap on ground with a sheet already up DISMISSES rather than opens. */
    suite(`${r} · back button`);
    await pg.evaluate(() => { window.UI.closeSheet(); window.Game.game.armedFlag = null; });
    await pg.waitForTimeout(200);
    p = await nearSeat(110, 0);
    await pg.mouse.click(p.x, p.y); await until(pg, () => window.UI.sheetOpen());
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
    await pg.goBack(); await until(pg, () => !window.Game.game.mode);
    ok('back with nothing open returns to the menu', !(await inMatch()));
    ok('and the game itself is still open',
       await pg.evaluate(() => !document.getElementById('menu').classList.contains('hidden')));

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
      for (const t of ['pointerdown', 'pointerup'])
        cvs.dispatchEvent(new PointerEvent(t, { pointerId: 7, clientX: s.x, clientY: s.y, bubbles: true }));
      await new Promise((res) => setTimeout(res, 250));
      return { ...drew, sheet: window.UI.sheetOpen(), sent: sent.map((o) => o.t), hostEss: before };
    });
    ok('the guest enters the match from a start message', lan.mode === 'guest', `mode=${lan.mode}`);
    /* the readout ticks toward its target, so allow a little lag — but it must be tracking
     * the HOST's number, not a stale one left over from the single-player match before it */
    ok('the guest HUD shows the essence off the wire',
       Math.abs(parseInt(lan.ess, 10) - lan.wantEss) <= Math.max(20, lan.wantEss * 0.25),
       `ess-n = ${lan.ess}, host has ${lan.wantEss}`);
    ok('the guest renders a host world with works on it', lan.works > 0, `${lan.works} rival works`);
    ok('a guest can open a build sheet', lan.sheet);
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

    /* A REMATCH KEEPS THE LINK. Pairing by QR is the price of getting into a LAN game; paying
     * it again to play a second game against the person sitting next to you is not. The host
     * rolls a new seed and re-sends the lobby's own start message; the guest is already
     * listening for it. Both sides are checked here — the guest first, since it must come out
     * of the end screen with nothing more than a message arriving. */
    suite(`${r} · a rematch on the same link`);
    const again = await pg.evaluate(async () => {
      const { Game, Net, World } = window;
      const out = {};
      /* --- the guest --- */
      Net.isHost = false; Net.localIdx = 1; Net.active = true; Net.peerGone = false;
      Net.send = () => {};
      Game.startMP(9001, 2, 1);
      const hw = World.createWorld(9001, 2);
      hw.winner = 0; hw.winReason = 'castle';
      Net.onSnap(JSON.parse(JSON.stringify(Net.snapFor(hw, 1, []))));
      await new Promise((res) => setTimeout(res, 60));
      const nx = document.getElementById('end-next');
      out.guestEnded = !document.getElementById('end').classList.contains('hidden');
      out.guestLabel = nx.textContent;
      out.guestDead = nx.disabled;               // only the host may deal a new match
      out.guestLinked = Net.active;              // ...and the link is NOT torn down
      /* the host says "again" — the guest needs no tap at all */
      Net.onStart({ seed: 9002, seats: 2, idx: 1 });
      await new Promise((res) => setTimeout(res, 60));
      out.guestBack = document.getElementById('end').classList.contains('hidden')
                   && Game.game.mode === 'guest' && Game.game.over === false;

      /* --- the host --- */
      const sent = [];
      Net.isHost = true; Net.localIdx = 0; Net.active = true; Net.peerGone = false;
      Net.peers = [{ idx: 1, dc: { readyState: 'open', send: () => {} }, pc: null }];
      Net.send = (o) => sent.push(o);
      Game.startMP(9003, 2, 0);
      const w = Game.game.world;
      /* the loop ends the match off the sim's own win event, so raise one */
      w.events.push({ e: 'win', winner: 0, reason: 'pattern' });
      await new Promise((res) => setTimeout(res, 120));
      out.hostLabel = document.getElementById('end-next').textContent;
      document.getElementById('end-next').click();
      await new Promise((res) => setTimeout(res, 120));
      out.starts = sent.filter((o) => o.t === 'start');
      out.hostBack = document.getElementById('end').classList.contains('hidden')
                  && Game.game.mode === 'host' && Game.game.over === false;
      out.hostLinked = Net.active;
      out.newWorld = !!Game.game.world && Game.game.world !== w;

      /* --- and NOT when somebody has left --- */
      Game.startMP(9004, 2, 0);
      Net.peers = [];                            // the guest is gone
      Game.game.world.events.push({ e: 'win', winner: 0, reason: 'castle' });
      await new Promise((res) => setTimeout(res, 120));
      out.goneLabel = document.getElementById('end-next').textContent;
      out.goneHidden = document.getElementById('end-next').classList.contains('hidden');
      return out;
    });
    ok('a guest that loses is left on the end screen', again.guestEnded);
    ok('and told the host holds the next match', /AWAITING/.test(again.guestLabel), again.guestLabel);
    ok('with no button it can press', again.guestDead);
    ok('and its link still up', again.guestLinked);
    ok('a start message alone puts the guest back in a match', again.guestBack);
    ok('the host is offered a rematch', again.hostLabel === 'REMATCH', again.hostLabel);
    ok('tapping it re-sends the lobby start message', again.starts.length === 1,
       JSON.stringify(again.starts));
    ok('with a new seed and the same seats', again.starts.length === 1 && again.starts[0].seats === 2
       && again.starts[0].idx === 1 && again.starts[0].seed !== 9003, JSON.stringify(again.starts[0]));
    ok('the host is back in a match on a fresh world', again.hostBack && again.newWorld);
    ok('and nobody re-paired', again.hostLinked);
    ok('but a host whose guest left is offered nothing', again.goneHidden, `label "${again.goneLabel}"`);
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
      [...document.querySelectorAll('#skirmish-row button')].find((e) => /julian/i.test(e.textContent)).click();
      await new Promise((res) => setTimeout(res, 200));
      out.recording = Rec.on;
      /* the table samples once a frame, so run the sim in chunks with frames between them —
       * a fast-forward inside ONE frame is one row however many minutes it covers */
      for (let i = 0; i < 8; i++) {
        window.__step(25);
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      }
      Game.game.world.events.push({ e: 'win', winner: 0, reason: 'castle' });
      await new Promise((res) => setTimeout(res, 200));
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

    suite(`${r} · console`);
    ok('the page raised no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await pg.close();
    if (group) times.push([group, Date.now() - markAt]);
    return { rows, times };
  }

  const done = await runRenderer('3d');
  record(done.rows, done.times);

  await browser.close();
  srv.close();
  process.exit(report('browser'));
})().catch((e) => { console.error(e); process.exit(1); });

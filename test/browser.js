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
const { suite, ok, report } = require('./lib.js');

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

/* open a page, walk the menu, and land in a skirmish against a fixed heir */
async function match(browser, base, renderer) {
  const pg = await browser.newPage({ viewport: { width: 420, height: 860 } });
  const errs = [];
  pg.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto(`${base}/index.html${renderer === '2d' ? '?r=2d' : ''}`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(900);
  await pg.click('#btn-skirmish'); await pg.waitForTimeout(250);
  await pg.evaluate(() => [...document.querySelectorAll('#skirmish-row button')]
    .find((e) => /julian/i.test(e.textContent)).click());
  await pg.waitForTimeout(2200);
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
    await pg.goto(`${base}/index.html?r=2d`, { waitUntil: 'networkidle' });
    await pg.waitForTimeout(900);
    const hidden = (id) => pg.evaluate((i) => document.getElementById(i).classList.contains('hidden'), id);
    await pg.click('#btn-skirmish'); await pg.waitForTimeout(200);
    ok('the skirmish row opens', !(await hidden('skirmish-row')));
    await pg.mouse.click(60, 760); await pg.waitForTimeout(200);
    ok('tapping away closes the skirmish row', await hidden('skirmish-row'));
    await pg.click('#btn-lan'); await pg.waitForTimeout(200);
    ok('the LAN panel opens', !(await hidden('lan-panel')));
    await pg.mouse.click(60, 120); await pg.waitForTimeout(200);
    ok('tapping away closes the LAN panel', await hidden('lan-panel'));
    await pg.close();
  }

  for (const r of ['2d', '3d']) {
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
      let placed = false;
      for (let a = 0; a < 40 && !placed; a++) {
        const th = a / 40 * Math.PI * 2, x = seat.x + Math.cos(th) * 300, y = seat.y + Math.sin(th) * 300;
        if (!W.placementError(g.world, 0, x, y, 'gate')) { W.applyCommand(g.world, 0, { c: 'build', x, y, bt: 'gate' }); placed = true; }
      }
      return { placed, before, after: outline() };
    });
    ok('raising a Gate extends the writ', grew.placed && grew.after > grew.before,
       `${grew.before} -> ${grew.after} segments`);

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

    /* ---------------- art coverage ---------------- *
     * A missing sprite does not throw — render.js falls back to the Gate — so a work can
     * quietly wear the wrong art for months. That is exactly how the rampart lost its wall. */
    if (r === '2d') {
      suite('2d · art');
      const gaps = await pg.evaluate(() => {
        const S = window.SPRITES, C = window.CONST;
        return {
          works: Object.keys(C.BUILDINGS).filter((bt) => !S.b[bt]),
          units: Object.keys(C.UNITS).filter((ut) => !S.u || !S.u[ut])
        };
      });
      ok('every building type has its own sprite', gaps.works.length === 0, gaps.works.join(', '));
      ok('every unit type has its own sprite', gaps.units.length === 0, gaps.units.join(', '));
    }

    /* ---------------- input routing ---------------- */
    suite(`${r} · input`);
    let p = await nearSeat(110, 0);
    await pg.mouse.click(p.x, p.y); await pg.waitForTimeout(400);
    ok('a build sheet opens on bare ground', await sheetOpen());
    p = await nearSeat(-110, 40);
    await pg.mouse.click(p.x, p.y); await pg.waitForTimeout(400);
    ok('tapping outside closes it rather than opening another', !(await sheetOpen()));
    await pg.mouse.click(p.x, p.y); await pg.waitForTimeout(400);
    ok('a second tap then opens the sheet normally', await sheetOpen());

    /* an ARMED flag must still act through an open sheet, not merely dismiss it */
    await pg.evaluate(() => document.querySelector('#flag-tray .fbtn').click());
    await pg.waitForTimeout(200);
    const node = await pg.evaluate(() => {
      const R = window.Render, g = window.Game.game;
      const s = g.world.map.sites.find((x) => x.kind === 'node');
      const sheetTop = document.getElementById('sheet').getBoundingClientRect().top;
      R.lookAt(s.x, s.y);
      let q = R.project(s.x, s.y);
      /* the sheet covers the bottom of the screen — pan until the target sits above it */
      for (let i = 0; i < 90 && q.y > sheetTop - 40; i++) { R.pan(0, -30); q = R.project(s.x, s.y); }
      return { id: s.id, x: q.x, y: q.y, before: g.world.players[0].banner };
    });
    await pg.mouse.click(node.x, node.y); await pg.waitForTimeout(300);
    const banner = await pg.evaluate(() => window.Game.game.world.players[0].banner);
    ok('an armed flag still plants through an open sheet', banner === node.id,
       `banner ${node.before} -> ${banner}`);

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

    /* ---------------- the back button ---------------- *
     * Start from a clean slate: the input suite deliberately leaves a sheet open, and a
     * tap on ground with a sheet already up DISMISSES rather than opens. */
    suite(`${r} · back button`);
    await pg.evaluate(() => { window.UI.closeSheet(); window.Game.game.armedFlag = null; });
    await pg.waitForTimeout(200);
    p = await nearSeat(110, 0);
    await pg.mouse.click(p.x, p.y); await pg.waitForTimeout(400);
    ok('a build sheet is open', await sheetOpen());
    await pg.goBack(); await pg.waitForTimeout(400);
    ok('back closes the sheet', !(await sheetOpen()));
    ok('back did not leave the match', await inMatch());
    await pg.evaluate(() => document.querySelector('#flag-tray .fbtn').click());
    await pg.waitForTimeout(200);
    ok('a flag is armed', await pg.evaluate(() => window.Game.game.armedFlag !== null));
    await pg.goBack(); await pg.waitForTimeout(400);
    ok('back disarms the flag', await pg.evaluate(() => window.Game.game.armedFlag === null));
    ok('still in the match', await inMatch());
    await pg.click('#pw-storm'); await pg.waitForTimeout(200);
    ok('the storm is arming', await pg.evaluate(() => !!window.Game.game.targeting));
    await pg.goBack(); await pg.waitForTimeout(400);
    ok('back cancels the storm aim', await pg.evaluate(() => !window.Game.game.targeting));
    await pg.goBack(); await pg.waitForTimeout(500);
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

    suite(`${r} · console`);
    ok('the page raised no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await pg.close();
  }

  await browser.close();
  srv.close();
  process.exit(report('browser'));
})().catch((e) => { console.error(e); process.exit(1); });

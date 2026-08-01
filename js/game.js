/* game.js — orchestration (v0.2): modes, fixed-timestep loop, camera drag + tap routing,
 * campaign, and LAN duel wiring (QR pairing from Perils; host-authoritative fogged sync).
 * Builds the source-agnostic `view` render.js consumes: live world (sp/host) or
 * snapshot + seed-rebuilt map geometry (guest). */
(function (global) {
  'use strict';

  const C = global.CONST, World = global.World, AI = global.AI;
  const Render = global.Render, UI = global.UI, Net = global.Net, S = global.SPRITES;
  const $ = (id) => document.getElementById(id);

  const LADDER = ['julian', 'bleys', 'brand', 'benedict'];
  const RUNG_OPTS = [{ slow: 1.5, noise: 0.4 }, { slow: 1.3, noise: 0.28 }, { slow: 1.15, noise: 0.15 }, { slow: 1.0, noise: 0.05 }];
  const firstName = (kind) => AI.HEIRS[kind].title.split(',')[0].split(' ')[0];

  const game = {
    mode: null, world: null, viewer: 0, bot: null,
    names: ['', ''], campaign: false,
    targeting: false, over: false, lastRiftBanner: -99, armedFlag: null
  };
  let acc = 0, lastFrame = 0;
  let guestCmdQueue = [], pendingGuestEvents = [], snapTimer = 0;
  let snapPrev = null, snapCur = null, snapAt = 0, refWorld = null;

  /* ---------------- campaign ladder ---------------- */
  const rung = () => Math.min(+localStorage.getItem('amber_rung') || 0, LADDER.length);
  const campaignLabel = () =>
    rung() >= LADDER.length ? 'THRONE CLAIMED — WALK AGAIN'
                            : 'CAMPAIGN — FACE ' + firstName(LADDER[rung()]).toUpperCase();

  /* ---------------- match lifecycle ---------------- */
  function startSP(kind, opts, isCampaign) {
    game.mode = 'sp'; game.viewer = 0; game.campaign = isCampaign; game.over = false;
    game.world = World.createWorld((Math.random() * 0xffffffff) >>> 0);
    game.bot = AI.make(kind, opts);
    game.names = ['Corwin', AI.HEIRS[kind].title];
    game.targeting = false;
    /* first-matches onboarding: teach the banner, the springs, the assault */
    const seenHints = +localStorage.getItem('amber_hints') || 0;
    if (seenHints < 3) {
      localStorage.setItem('amber_hints', String(seenHints + 1));
      game.hints = [
        [6, '⚑ Arm the gold flag (bottom-left), then tap any site — the army marches there', 'alert'],
        [24, 'Hold springs: march troops to one, then tap the spring to raise a Shadow Gate', 'alert'],
        [45, '⚔ To win by force, plant the gold flag on the rival city itself', 'alert'],
        [70, '⚐ Every barracks adds a company flag to the tray — arm one to split your forces', 'alert']
      ];
    } else game.hints = [];
    Render.resize();
    UI.startMatch(AI.HEIRS[kind].title);
  }
  function startMP(seed) {
    game.mode = Net.isHost ? 'host' : 'guest';
    game.viewer = Net.isHost ? 0 : 1;
    game.campaign = false; game.over = false; game.targeting = false; game.armedFlag = null;
    game.names = ['Corwin', 'Eric'];
    guestCmdQueue = []; pendingGuestEvents = []; snapTimer = 0; snapPrev = snapCur = null;
    game.world = Net.isHost ? World.createWorld(seed) : null;
    refWorld = Net.isHost ? null : World.createWorld(seed);   // guest: map geometry only
    Render.resize();
    UI.startMatch(Net.isHost ? 'Eric' : 'Corwin');
  }
  function toMenu() {
    game.mode = null; game.world = null; game.over = false;
    if (Net.active) Net.close();
    if (game.updateReady) { applyUpdate(); return; }   // a new version waited politely for match end
    UI.showMenu(campaignLabel());
  }

  /* ---------------- PWA: install + live auto-update ----------------
   * The SW precaches each version under its own cache. When a new sw.js (new VERSION)
   * is found: at the menu we apply it instantly; mid-match we wait for the match to end.
   * 'controllerchange' after skipWaiting → reload into the new build. */
  let waitingSW = null, reloading = false;
  function applyUpdate() { if (waitingSW) waitingSW.postMessage({ t: 'skip' }); }
  function setupPWA() {
    if (!('serviceWorker' in navigator)) return;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !hadController) return;
      reloading = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' }).then((reg) => {
      const onWaiting = () => {
        if (!reg.waiting || !navigator.serviceWorker.controller) return;
        waitingSW = reg.waiting;
        if (!game.mode) applyUpdate();
        else { game.updateReady = true; UI.banner('A new shadow of Amber is drawn — it settles after this match', 'alert'); }
      };
      if (reg.waiting) onWaiting();
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (sw) sw.addEventListener('statechange', onWaiting);
      });
      /* look for updates when the app comes back to the foreground, and periodically */
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
      setInterval(() => reg.update().catch(() => {}), 15 * 60 * 1000);
    }).catch(() => {});
  }
  function endMatch(winner, reason) {
    if (game.over) return;
    game.over = true;
    const won = winner === game.viewer;
    const other = game.names[1 - game.viewer];
    const sub = reason === 'pattern'
      ? (won ? 'You have walked the Pattern to its blazing heart and spoken your name.'
             : other + ' has walked the Pattern to its heart. The universe rearranges.')
      : (won ? 'The rival Seat of Power lies in ruin along the black road.'
             : 'Your Seat of Power lies in ruin. The road took it.');
    let nextLabel = 'REMATCH';
    if (game.mode === 'sp' && game.campaign && won && rung() < LADDER.length) {
      localStorage.setItem('amber_rung', String(rung() + 1));
      nextLabel = rung() >= LADDER.length ? 'THE THRONE AWAITS' : 'FACE ' + firstName(LADDER[rung()]).toUpperCase();
    }
    UI.end(won, sub, nextLabel);
  }

  /* ---------------- commands ---------------- */
  function issue(cmd) {
    if (game.mode === 'guest') { Net.send({ t: 'cmd', c: cmd }); return { ok: true }; }
    const r = World.applyCommand(game.world, game.viewer, cmd);
    if (!r.ok) {
      if (r.err === 'essence') UI.banner('Not enough Essence', 'warn');
      else if (r.err === 'presence') UI.banner('A unit of yours must stand there — plant the banner first', 'warn');
      else if (r.err === 'contested') UI.banner('The ground is contested', 'warn');
      else if (r.err === 'fog') UI.banner('You cannot storm what you cannot see', 'warn');
    }
    return r;
  }

  /* ---------------- view assembly (render-ready, fog applied) ---------------- */
  function hostView() {
    const world = game.world, viewer = game.viewer;
    const see = (x, y) => World.canSee(world, viewer, x, y);
    const mem = world.players[viewer].explored;
    return {
      t: world.t, map: world.map, mapSeed: world.seed, players: world.players,
      sites: world.map.sites.map((s) => {
        if (see(s.x, s.y)) return { id: s.id, live: true, owner: s.owner,
                                    post: s.post ? { bt: s.post.bt, level: s.post.level, hp: s.post.hp, maxHp: s.post.maxHp } : null };
        const m = mem[s.id];
        return m ? { id: s.id, live: false, owner: m.owner, post: m.post } : null;
      }),
      units: world.units.filter((u) => u.owner === viewer || see(u.x, u.y)),
      storms: world.storms.filter((s) => see(s.x, s.y)),
      visSources: World.visionSources(world, viewer),
      see
    };
  }
  function guestView() {
    const snap = snapCur;
    /* vision sources rebuilt client-side from own visible assets */
    const src = [];
    const city = refWorld.map.sites[refWorld.map.cities[1]];
    src.push([city.x, city.y, C.VISION.city]);
    for (const s of refWorld.map.sites) {
      const st = snap.sites[s.id];
      if (st && st.live && st.owner === 1 && st.post)
        src.push([s.x, s.y, st.post.bt === 'watch' ? C.OUTPOSTS.watch.vision : C.VISION.post]);
    }
    /* interpolate own+visible units between the last two snapshots */
    const alpha = Math.min(1, (performance.now() - snapAt) / 100);
    let units = snap.units;
    if (snapPrev) {
      const prev = new Map(snapPrev.units.map((u) => [u.id, u]));
      units = snap.units.map((u) => {
        const q = prev.get(u.id);
        return q ? { ...u, x: q.x + (u.x - q.x) * alpha, y: q.y + (u.y - q.y) * alpha } : u;
      });
    }
    for (const u of units) if (u.owner === 1) src.push([u.x, u.y, C.VISION.unit]);
    const see = (x, y) => src.some(([sx2, sy2, r]) => (x - sx2) * (x - sx2) + (y - sy2) * (y - sy2) < r * r);
    return { t: snap.t, map: refWorld.map, mapSeed: refWorld.seed, players: snap.players,
             sites: snap.sites, units, storms: snap.storms, visSources: src, see };
  }

  /* ---------------- event routing (banners + canvas fx; fog respected) ---------------- */
  function routeEvents(evs, view) {
    const seen = evs.filter((ev) => ev.pi === game.viewer || ev.x == null || !view.see || view.see(ev.x, ev.y));
    Render.addEvents(seen, view, game.viewer);
    const siteName = (id) => view.map.sites[id] ? view.map.sites[id].name : 'a far place';
    for (const ev of seen) {
      if (ev.e === 'walk') UI.banner(game.names[ev.pi] + ' has set foot upon the Pattern!', 'alert');
      else if (ev.e === 'pattern' && ev.idx > 0) UI.banner(game.names[ev.pi] + C.PATTERN_ALERTS[ev.idx].msg, 'alert');
      else if (ev.e === 'rift' && view.t - game.lastRiftBanner > 30) { game.lastRiftBanner = view.t; UI.banner('Chaos tears open a rift in the black road', 'chaos'); }
      else if (ev.e === 'surge') UI.banner('The black road surges — Chaos redoubles!', 'chaos');
      else if (ev.e === 'storm' && ev.pi !== game.viewer) UI.banner(game.names[ev.pi] + ' calls down the storm!', 'warn');
      else if (ev.e === 'trump' && ev.pi !== game.viewer) UI.banner(game.names[ev.pi] + ' draws a Trump!', 'warn');
      else if (ev.e === 'hurtpost' && ev.pi === game.viewer) UI.banner('Your outpost at ' + siteName(ev.site) + ' is under attack!', 'warn');
      else if (ev.e === 'muster') { if (ev.pi === game.viewer) UI.banner(ev.pause ? '⏸ The muster is halted — essence gathers' : '▶ The muster resumes', ''); }
      else if (ev.e === 'rally') { if (ev.pi === game.viewer) UI.banner(ev.site >= 0 ? '⚐ The company posts its standard at ' + siteName(ev.site) : '⚑ The company rejoins the War Banner', ''); }
      else if (ev.e === 'raze') UI.banner(ev.pi === game.viewer ? 'Your ' + (C.BUILDINGS[ev.bt] ? C.BUILDINGS[ev.bt].name : 'building') + ' has been RAZED!' : 'You raze the rival’s works', ev.pi === game.viewer ? 'warn' : '');
      else if (ev.e === 'breach') UI.banner(ev.pi === game.viewer ? 'Your walls are BREACHED — they are inside!' : 'The walls of ' + game.names[1 - game.viewer] + '’s city are breached!', ev.pi === game.viewer ? 'warn' : 'alert');
      else if (ev.e === 'hurtwall') { if (ev.pi === game.viewer) UI.banner('Your walls are under attack', 'warn'); }
      else if (ev.e === 'hurtcity') { if (ev.pi === game.viewer) UI.banner('The enemy is inside your city!', 'warn'); }
      else if (ev.e === 'postdie') UI.banner(ev.pi === game.viewer ? 'Your outpost at ' + siteName(ev.site) + ' has fallen' : 'An outpost at ' + siteName(ev.site) + ' falls', ev.pi === game.viewer ? 'warn' : '');
      else if (ev.e === 'post' && ev.pi !== game.viewer) UI.banner(game.names[ev.pi] + ' raises works at ' + siteName(ev.site), '');
      else if (ev.e === 'win') endMatch(ev.winner, ev.reason);
    }
  }

  /* ---------------- the loop ---------------- */
  function frame(now) {
    requestAnimationFrame(frame);
    const dtReal = Math.min(0.1, (now - lastFrame) / 1000 || 0);
    lastFrame = now;
    Render.targeting = game.targeting;

    if (game.mode === 'sp' || game.mode === 'host') {
      acc += dtReal;
      let steps = 0;
      while (acc >= C.SIM_DT && steps++ < 6) {
        acc -= C.SIM_DT;
        if (!game.over) {
          if (game.mode === 'sp') game.bot.step(game.world, 1, (cmd) => World.applyCommand(game.world, 1, cmd), C.SIM_DT);
          if (game.mode === 'host') { for (const c of guestCmdQueue.splice(0)) World.applyCommand(game.world, 1, c); }
          World.update(game.world, C.SIM_DT);
        }
      }
      const view = hostView();
      const evs = game.world.events.splice(0);
      if (evs.length) { routeEvents(evs, view); if (game.mode === 'host') pendingGuestEvents.push(...evs); }
      if (game.hints && game.hints.length && game.world.t >= game.hints[0][0]) {
        const h = game.hints.shift();
        UI.banner(h[1], h[2]);
      }
      if (game.mode === 'host') {
        snapTimer -= dtReal;
        if (snapTimer <= 0) {
          snapTimer = 0.1;
          Net.send({ t: 'snap', s: Net.snapFor(game.world, 1, pendingGuestEvents.splice(0)) });
        }
      }
      Render.frame(view, game.viewer, dtReal);
      UI.hud(view, game.viewer, (game.world.players[game.viewer].incomeRate || 0) - (game.world.players[game.viewer].drainRate || 0), game.targeting);
      UI.tick(game.world.players[game.viewer].essence);
      UI.flags(view, game.viewer, game.armedFlag);
    } else if (game.mode === 'guest' && snapCur) {
      const view = guestView();
      Render.frame(view, 1, dtReal);
      UI.hud(view, 1, (snapCur.players[1].incomeRate || 0) - (snapCur.players[1].drainRate || 0), game.targeting);
      UI.tick(snapCur.players[1].essence || 0);
      UI.flags(view, 1, game.armedFlag);
    }
  }

  /* ---------------- input: drag pans, tap acts ---------------- */
  let pDown = null, dragging = false, miniScrub = false;
  function onDown(e) {
    if (!game.mode) return;
    pDown = { x: e.clientX, y: e.clientY };
    dragging = false;
    miniScrub = Render.hitMinimap(e.clientX);
    if (miniScrub) Render.minimapJump(e.clientY);
  }
  function onMove(e) {
    Render.pointer = { x: e.clientX, y: e.clientY };
    if (!pDown) return;
    if (miniScrub) { Render.minimapJump(e.clientY); return; }
    const dy2 = e.clientY - pDown.y;
    if (dragging || Math.abs(dy2) > 12) {
      dragging = true;
      Render.pan(e.clientY - (onMove._ly != null ? onMove._ly : pDown.y));
    }
    onMove._ly = e.clientY;
  }
  function onUp(e) {
    const wasTap = pDown && !dragging && !miniScrub;
    pDown = null; dragging = false; miniScrub = false; onMove._ly = null;
    if (!wasTap || !game.mode || game.over) return;
    const x = e.clientX, y = e.clientY;
    const view = game.mode === 'guest' ? (snapCur ? guestView() : null) : hostView();
    if (!view) return;
    if (game.armedFlag != null) {
      const id = game.armedFlag;
      game.armedFlag = null;
      const siteId = Render.hitSite(x, y, view, game.viewer, true);   // flags: whole court counts
      if (siteId < 0) UI.banner('The standard needs ground to stand on — tap a site', 'warn');
      else if (id === 'royal') issue({ c: 'banner', site: siteId });
      else issue({ c: 'rally', slot: id, site: siteId });
      return;
    }
    if (game.targeting) {
      game.targeting = false;
      const w = Render.toWorld(x, y, game.viewer);
      if (!view.see(w.x, w.y)) { UI.banner('You cannot storm what you cannot see', 'warn'); return; }
      issue({ c: 'power', k: 'storm', x: w.x, y: w.y });
      return;
    }
    /* own city grid first (it overlaps the map), then map sites */
    const slot = Render.hitSlot(x, y);
    if (slot >= 0) {
      const me = view.players[game.viewer];
      const s = me.slots[slot];
      Render.selected = slot;
      if (!s) UI.buildSheet(slot, me.essence, me.slots.some((q) => q && q.bt === 'shrine'));
      else UI.upSheet(slot, s, me.essence, me.walking);
      return;
    }
    const siteId = Render.hitSite(x, y, view, game.viewer);
    if (siteId >= 0) {
      /* every site opens a sheet — including the rival's city (the assault order) */
      const site = view.map.sites[siteId];
      const foeCity = view.map.cities[1 - game.viewer] === siteId;
      UI.siteSheet(site, view.sites[siteId], game.viewer, view.players[game.viewer].essence, foeCity,
                   view.players[game.viewer].wallLevel, view.players[game.viewer], view.players[1 - game.viewer]);
      return;
    }
    if (UI.sheetOpen()) UI.closeSheet();
  }

  /* ---------------- LAN pairing (QR flow ported from Perils) ---------------- */
  function setupLan() {
    const say = (t2) => { $('lan-status').textContent = t2; };
    Net.onDiag = (lines) => { const d = $('lan-diag'); d.textContent = lines.slice(-12).join('\n'); };
    $('lan-status').addEventListener('click', () => $('lan-diag').classList.toggle('hidden'));

    const qrDisplay = $('qr-display'), qrJoin = $('qr-join'), qrScanReply = $('qr-scan-reply');
    let pairStop = null;

    /* stream a payload as small cycling QR frames — dense single QRs defeat phone autofocus */
    function startPairStream(payload) {
      if (!global.QR) return false;
      const CHUNK = 80;
      const chunks = [];
      for (let i2 = 0; i2 < payload.length; i2 += CHUNK) chunks.push(payload.slice(i2, i2 + CHUNK));
      const id = Math.random().toString(36).slice(2, 6), n = chunks.length;
      let i = 0, timer = null;
      const drawFrame = () => {
        try { global.QR.render(qrDisplay, 'AQ|' + id + '|' + i + '|' + n + '|' + chunks[i], { size: 560, quiet: 4, dark: '#000000', light: '#ffffff' }); } catch (e) {}
        i = (i + 1) % n;
      };
      qrDisplay.classList.remove('hidden');
      drawFrame();
      if (n > 1) timer = setInterval(drawFrame, 420);
      pairStop = () => { if (timer) clearInterval(timer); qrDisplay.classList.add('hidden'); };
      return true;
    }

    /* open the camera, scan one (possibly streamed) QR, resolve its full text */
    function scanQR() {
      return new Promise(async (resolve, reject) => {
        const overlay = $('scanner'), video = $('scan-video'), cancel = $('scan-cancel'), hint = $('scan-hint');
        if (!('BarcodeDetector' in window)) { reject(new Error('this browser can’t scan QR codes')); return; }
        let supported = [];
        try { supported = await window.BarcodeDetector.getSupportedFormats(); } catch (e) {}
        if (supported.indexOf('qr_code') < 0) { reject(new Error('QR scanning unsupported here')); return; }
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } });
        } catch (e) { reject(new Error('camera blocked — allow camera access')); return; }
        try {
          const track = stream.getVideoTracks()[0];
          const caps = track.getCapabilities ? track.getCapabilities() : {};
          if (caps.focusMode && caps.focusMode.indexOf('continuous') >= 0) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
        } catch (e) {}
        video.srcObject = stream; try { await video.play(); } catch (e) {}
        overlay.classList.remove('hidden');
        hint.textContent = 'Point at your rival’s Trump';
        let done = false;
        const snap = document.createElement('canvas'), sctx = snap.getContext('2d');
        const cleanup = () => { done = true; overlay.classList.add('hidden'); stream.getTracks().forEach((t2) => t2.stop()); video.srcObject = null; };
        cancel.onclick = () => { cleanup(); reject(new Error('scan cancelled')); };
        const parts = {}; let pid = null, need = 0, have = 0;
        const tick = async () => {
          if (done) return;
          try {
            let src = video;
            if (video.videoWidth) { snap.width = video.videoWidth; snap.height = video.videoHeight; sctx.drawImage(video, 0, 0); src = snap; }
            const codes = await detector.detect(src);
            for (const code of codes || []) {
              const v = code.rawValue; if (!v) continue;
              if (v.slice(0, 3) !== 'AQ|') { cleanup(); resolve(v); return; }
              const p = v.split('|');
              if (p.length < 5) continue;
              const id = p[1], idx = +p[2], total = +p[3];
              if (pid !== id) { pid = id; need = total; have = 0; for (const k in parts) delete parts[k]; }
              if (parts[idx] == null) { parts[idx] = p.slice(4).join('|'); have++; hint.textContent = 'reading the Trump… ' + have + '/' + need; }
              if (need > 0 && have >= need) {
                let full = '', ok = true;
                for (let k = 0; k < need; k++) { if (parts[k] == null) { ok = false; break; } full += parts[k]; }
                if (ok) { cleanup(); resolve(full); return; }
              }
            }
          } catch (e) { /* transient detect error — keep scanning */ }
          if (!done) setTimeout(() => requestAnimationFrame(tick), 60);
        };
        requestAnimationFrame(tick);
      });
    }

    $('qr-host').addEventListener('click', async () => {
      Net.diagReset();
      say('drawing your Trump…');
      try {
        const offer = await Net.host();
        if (!startPairStream(offer)) { say('could not draw the QR'); return; }
        qrJoin.classList.add('hidden');
        qrScanReply.classList.remove('hidden');
        say('1) Eric scans this  2) tap SCAN REPLY');
      } catch (e) { say('failed: ' + (e.message || e)); }
    });
    qrScanReply.addEventListener('click', async () => {
      try {
        if (pairStop) { pairStop(); pairStop = null; }
        const answer = await scanQR();
        say('the Trumps touch…');
        await Net.acceptAnswer(answer);
      } catch (e) { say(e.message); }
    });
    qrJoin.addEventListener('click', async () => {
      Net.diagReset();
      try {
        const offer = await scanQR();
        say('drawing your reply…');
        const answer = await Net.join(offer);
        if (!startPairStream(answer)) { say('could not draw the reply QR'); return; }
        say('show this reply to Corwin — linking…');
      } catch (e) { say(e.message); }
    });

    Net.onOpen = () => {
      if (pairStop) { pairStop(); pairStop = null; }
      qrScanReply.classList.add('hidden'); qrJoin.classList.remove('hidden');
      if (Net.isHost) { $('lan-start').classList.remove('hidden'); say('LINKED — begin when ready'); }
      else say('LINKED — awaiting Corwin…');
    };
    $('lan-start').addEventListener('click', () => {
      const seed = (Math.random() * 0xffffffff) >>> 0;
      Net.send({ t: 'start', seed });
      $('lan-start').classList.add('hidden');
      startMP(seed);
    });
    Net.onStart = (m) => startMP(m.seed);
    Net.onCmd = (c) => guestCmdQueue.push(c);
    Net.onSnap = (s) => {
      snapPrev = snapCur; snapCur = s; snapAt = performance.now();
      if (s.events && s.events.length && refWorld) routeEvents(s.events, guestView());
      if (s.winner !== null && s.winner !== undefined) endMatch(s.winner, s.winReason);
    };
    Net.onClose = () => {
      if (game.mode === 'host' || game.mode === 'guest') {
        UI.banner('The Trump link is severed', 'warn');
        if (game.mode === 'guest' && !game.over) setTimeout(toMenu, 2500);
      } else say('link lost');
    };
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    S.init();
    await Render.init($('game'));   // PixiJS app init is async
    window.addEventListener('resize', Render.resize);
    UI.init({
      onCampaign: () => {
        const r = Math.min(rung(), LADDER.length - 1);
        startSP(LADDER[r], RUNG_OPTS[r], true);
      },
      onSkirmish: (kind) => startSP(kind, {}, false),
      onBuild: (slot, bt) => issue({ c: 'build', slot, bt }),
      onUp: (slot, br) => issue({ c: 'up', slot, br }),
      onWalk: (on) => issue({ c: 'walk', on }),
      onBanner: (site) => issue({ c: 'banner', site }),
      onPost: (site, bt) => issue({ c: 'post', site, bt }),
      onWall: () => issue({ c: 'wall' }),
      onFlagArm: (id) => {
        game.targeting = false;
        game.armedFlag = game.armedFlag === id ? null : id;
        if (game.armedFlag != null)
          UI.banner(id === 'royal' ? '⚑ Tap where the army should march' : '⚐ Tap where this company should stand', 'alert');
      },
      onRejoin: (slot) => { game.armedFlag = null; issue({ c: 'rally', slot, site: -1 }); },
      onRecall: () => {
        const view = game.mode === 'guest' ? (snapCur && guestView()) : hostView();
        if (!view) return;
        issue({ c: 'banner', site: view.map.cities[game.viewer] });
        const me = view.players[game.viewer];
        for (let i = 0; i < C.SLOTS; i++) {
          const s = me.slots[i];
          if (s && C.BUILDINGS[s.bt] && C.BUILDINGS[s.bt].spawns && s.rally != null && s.rally >= 0)
            issue({ c: 'rally', slot: i, site: -1 });
        }
        UI.banner('🛡 The Recall sounds — every blade turns for home', 'alert');
      },
      onMuster: (pause) => issue({ c: 'muster', pause }),
      onPostUp: (site) => issue({ c: 'postup', site }),
      onPower: (k) => {
        const view = game.mode === 'guest' ? snapCur : game.world;
        if (!view) return;
        const me = view.players[game.viewer];
        if (me.powers[k] > 0) return;
        if (me.essence < C.POWERS[k].cost) { UI.banner('Not enough Essence', 'warn'); return; }
        if (k === 'storm') { game.armedFlag = null; game.targeting = !game.targeting; }
        else issue({ c: 'power', k: 'trump' });
      },
      onEndNext: () => {
        if (game.mode === 'sp') {
          if (game.campaign) { const r = Math.min(rung(), LADDER.length - 1); startSP(LADDER[r], RUNG_OPTS[r], true); }
          else startSP(game.bot.kind, {}, false);
        } else toMenu();
      },
      onEndMenu: toMenu
    });
    const cvs = $('game');
    cvs.addEventListener('pointerdown', onDown);
    cvs.addEventListener('pointermove', onMove);
    cvs.addEventListener('pointerup', onUp);
    /* kill the synthetic mouse click that follows a touch — it lands on whatever
     * sheet just opened under the finger and 'chooses' a card the player never tapped */
    cvs.addEventListener('touchend', (e) => e.preventDefault(), { passive: false });
    setupLan();
    setupPWA();
    $('version').textContent = 'v' + (global.GAME_VERSION || '?');
    UI.showMenu(campaignLabel());
    requestAnimationFrame((t2) => { lastFrame = t2; requestAnimationFrame(frame); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  global.Game = { game, startSP, startMP, toMenu };
})(typeof window !== 'undefined' ? window : globalThis);

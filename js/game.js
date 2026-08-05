/* game.js — orchestration (v0.2): modes, fixed-timestep loop, camera drag + tap routing,
 * campaign, and LAN duel wiring (QR pairing from Perils; host-authoritative fogged sync).
 * Builds the source-agnostic `view` the renderer consumes: live world (sp/host) or
 * snapshot + seed-rebuilt map geometry (guest). */
(function (global) {
  'use strict';

  const C = global.CONST, World = global.World, AI = global.AI;
  const Render = global.Render, UI = global.UI, Net = global.Net, Rec = global.Rec;
  const $ = (id) => document.getElementById(id);

  /* The succession, in the order you face it. There used to be a private difficulty ramp here
   * as well — RUNG_OPTS — which meant the footing the menu offered governed a skirmish and
   * silently did nothing to the campaign. One knob: the LADDER says WHO, the footing says how
   * strong, and both are the player's to see. */
  /* WEAKEST FIRST, and MEASURED — `node sim.js` prints this line ready to paste. The heirs are
   * not balanced against each other on purpose (see DESIGN_PRINCIPLES); what their strengths
   * are FOR is this order. It used to be a guess with four names in it, and it had bleys —
   * who wins the field by a distance — on the second rung, while corwin was not on the ladder
   * at all. */
  const LADDER = ['benedict', 'julian', 'brand', 'corwin', 'bleys'];
  const firstName = (kind) => AI.HEIRS[kind].title.split(',')[0].split(' ')[0];

  const game = {
    mode: null, world: null, viewer: 0, bot: null,
    names: ['', ''], campaign: false,
    targeting: false, over: false, lastRiftBanner: -99, armedFlag: null,
    span: null,             // a wall half-placed: its anchor, waiting for the far end
    placing: null           // a work CHOSEN and waiting for the ground: { bt, co }
  };
  let acc = 0, lastFrame = 0;
  let guestCmdQueue = [], pendingGuestEvents = [], snapTimer = 0;
  let snapPrev = null, snapCur = null, snapAt = 0, refWorld = null, guestSeen = null;

  /* ---------------- campaign ladder ---------------- */
  const rung = () => Math.min(+localStorage.getItem('amber_rung') || 0, LADDER.length);
  const done = () => rung() >= LADDER.length;
  const campaignLabel = () =>
    done() ? 'THRONE CLAIMED — WALK IT AGAIN'
           : 'CAMPAIGN — FACE ' + firstName(LADDER[rung()]).toUpperCase();
  /* what the button will actually do, said out loud. Walking again started you against
   * BENEDICT — the last rung — because the index was clamped instead of wrapped, so the
   * reward for finishing the succession was to be dropped straight back at its hardest step. */
  const campaignNote = () =>
    done() ? 'the succession begins again, from ' + firstName(LADDER[0])
           : 'rung ' + (rung() + 1) + ' of ' + LADDER.length +
             ' · ' + LADDER.map((k, i) => (i < rung() ? '✔' : '·')).join(' ');

  /* ---------------- match lifecycle ---------------- */
  function startSP(kind, opts, isCampaign) {
    game.mode = 'sp'; game.viewer = 0; game.campaign = isCampaign; game.over = false;
    game.world = World.createWorld((Math.random() * 0xffffffff) >>> 0);
    game.bot = AI.make(kind, opts);
    /* the handicap is the heir's, not the board's: it plays its own game, only poorer */
    game.world.players[1].eco = (opts && opts.eco) || 1;
    game.names = ['Corwin', AI.HEIRS[kind].title];
    game.targeting = false; game.placing = null; game.span = null; Render.span = null;
    /* first-matches onboarding: teach the banner, the springs, the assault */
    const seenHints = +localStorage.getItem('amber_hints') || 0;
    if (seenHints < 3) {
      localStorage.setItem('amber_hints', String(seenHints + 1));
      game.hints = [
        [6, '⚐ Raise a Barracks — it raises a standard of its own, and its flag joins the tray', 'alert'],
        [22, 'TAP YOUR OWN TROOPS to pick up their standard, then tap where they should stand', 'alert'],
        [45, 'Essence is out on the map: march men to a spring, then TAP THE SPRING to raise a Gate', 'alert'],
        [75, '⚔ To win by force, plant a standard on the rival city itself', 'alert']
      ];
    } else game.hints = [];
    Render.resize();
    homeCamera();
    armBack();
    Rec.begin({ version: global.GAME_VERSION, seed: game.world.seed, viewer: 0, names: game.names,
                mode: isCampaign ? 'campaign' : 'skirmish',
                footing: (C.DIFFICULTY[UI.difficulty()] || {}).name });
    UI.startMatch(AI.HEIRS[kind].title);
  }
  /* `seats` is how many are playing (2..4) and `mySeat` which one you got — the host hands
   * both out with the start message, so a guest never has to guess its own index. */
  function startMP(seed, seats, mySeat) {
    const n = Math.max(2, Math.min(C.MAX_PLAYERS, seats || 2));
    game.seats = n;
    game.mode = Net.isHost ? 'host' : 'guest';
    game.viewer = Net.isHost ? 0 : (mySeat != null ? mySeat : Net.localIdx);
    Net.localIdx = game.viewer;
    game.campaign = false; game.over = false; game.targeting = false; game.armedFlag = null;
    game.span = null; game.placing = null; Render.span = null;
    game.names = C.SEAT_NAMES.slice(0, n);
    guestCmdQueue = []; pendingGuestEvents = []; snapTimer = 0; snapPrev = snapCur = null; guestSeen = null;
    game.world = Net.isHost ? World.createWorld(seed, n) : null;
    refWorld = Net.isHost ? null : World.createWorld(seed, n);   // guest: map geometry only
    Render.resize();
    homeCamera();
    armBack();
    /* a guest never holds the world, only its own fogged snapshots — say so in the header
     * rather than pretend the rival columns are the truth */
    Rec.begin({ version: global.GAME_VERSION, seed, viewer: game.viewer, names: game.names.slice(),
                mode: 'LAN ' + n + '-way', partial: !Net.isHost });
    /* with up to four seats there is no single "the rival" — name the table instead */
    UI.startMatch(n > 2 ? n + ' HEIRS CONTEND' : (Net.isHost ? 'Eric' : 'Corwin'));
  }
  /* ---------------- the phone's back button ----------------
   * Installed as a PWA, Android's back gesture leaves the app. It should dismiss whatever is
   * open first — a build sheet, an armed flag, a storm being aimed — and only then leave the
   * match, and only then the game. ONE history entry is held while a match runs; each back
   * consumes it, we handle a layer, and we re-arm for the next one. */
  let backArmed = false;
  function armBack() {
    if (backArmed || !game.mode) return;
    backArmed = true;
    try { history.pushState({ amber: 1 }, ''); } catch (e) { backArmed = false; }
  }
  function onPopState() {
    backArmed = false;
    if (!game.mode) return;                       // at the menu: let the browser have it
    if (UI.sheetOpen()) { UI.closeSheet(); armBack(); return; }
    const halted = game.mode === 'guest' ? !!(snapCur && snapCur.paused) : !!(game.world && game.world.paused);
    if (halted) { issue({ c: 'pause', on: false }); armBack(); return; }
    if (game.targeting || game.armedFlag != null || game.span || game.placing) {
      game.targeting = false; game.armedFlag = null;
      game.span = null; Render.span = null;
      clearPlacing();
      UI.banner('Cancelled', 'warn');
      armBack(); return;
    }
    toMenu();                                     // in a match: back leaves to the menu
  }

  /* Your Seat can be anywhere now, so the camera has to be told where home is. */
  function homeCamera() {
    const w = game.world || refWorld;
    if (!w || !Render.lookAt) return;
    const c = w.map.sites[w.map.cities[game.viewer]];
    Render.lookAt(c.x, c.y);
  }

  function toMenu() {
    /* a match walked out of never reaches the end screen, and it is often the one worth
     * sending — close the chronicle here so the menu can still offer it */
    if (Rec.on && !game.over) {
      Rec.end(undefined, null, game.world ? Rec.fromWorld(game.world)
                             : snapCur ? Rec.fromSnap(snapCur, game.viewer) : null);
    }
    game.mode = null; game.world = null; game.over = false;
    if (Render.lookAt) Render._homed = false;
    if (Net.active) Net.close();
    if (game.updateReady) { applyUpdate(); return; }   // a new version waited politely for match end
    UI.showMenu(campaignLabel(), campaignNote());
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
    Rec.end(winner, reason, game.world ? Rec.fromWorld(game.world)
                          : snapCur ? Rec.fromSnap(snapCur, game.viewer) : null);
    const won = winner === game.viewer;
    /* whoever it was, name them: with four seats "the other one" is not a person */
    const other = (winner >= 0 && game.names[winner]) || 'Another heir';
    game.endWon = won;
    game.endSub = reason === 'pattern'
      ? (won ? 'You have walked the Pattern to its blazing heart and spoken your name.'
             : other + ' has walked the Pattern to its heart. The universe rearranges.')
      : (won ? 'The rival Seat of Power lies in ruin along the black road.'
             : 'Your Seat of Power lies in ruin. The road took it.');
    game.endNext = null;
    if (game.mode === 'sp' && game.campaign && won && rung() < LADDER.length) {
      localStorage.setItem('amber_rung', String(rung() + 1));
      /* the last rung is not the end of the button: walking again starts the succession over */
      game.endNext = done() ? 'WALK IT AGAIN — FACE ' + firstName(LADDER[0]).toUpperCase()
                            : 'FACE ' + firstName(LADDER[rung()]).toUpperCase();
    }
    endScreen();
  }
  /* drawn separately from the ending itself, because what comes NEXT can change while the
   * screen is up — a guest dropping takes the host's rematch with it */
  function endScreen() {
    let nextLabel = game.endNext || 'REMATCH', ready = true;
    if (game.endNext) { /* the ladder already named the next rung */ }
    else if (game.mode === 'host') {
      /* the link is still up: a rematch costs a tap, not another QR */
      if (!canRematch()) nextLabel = '';
    } else if (game.mode === 'guest') {
      /* the host is the authority on when a match starts, this one included */
      nextLabel = Net.active && !Net.peerGone ? 'AWAITING THE HOST' : '';
      ready = false;
    }
    UI.end(game.endWon, game.endSub, nextLabel, ready);
  }

  /* ---------------- rematch on the same link ----------------
   * Two people in the same room should not scan a QR twice to play twice. The link is a LOBBY
   * that outlives the match: the host rolls a fresh seed and sends the very same start message
   * the lobby sends, and every guest is already listening for it, so nobody scans anything.
   * The seat each guest holds is its peer index, so replaying with the same count keeps
   * everyone where they were. If somebody has dropped, that is no longer true — a seat with
   * nobody behind it would stand in the new world and be walked over — so the rematch is
   * offered only while every heir who played is still linked. */
  function canRematch() {
    return Net.isHost && Net.active && !Net.peerGone && Net.seated() === game.seats;
  }
  function rematch() {
    if (!canRematch()) {
      UI.banner('An heir has left the link — pair again from the menu', 'warn');
      toMenu(); return;
    }
    const seed = (Math.random() * 0xffffffff) >>> 0, seats = game.seats;
    for (const p of Net.peers)
      if (p.dc && p.dc.readyState === 'open') Net.send({ t: 'start', seed, seats, idx: p.idx }, p.idx);
    startMP(seed, seats, 0);
  }

  /* ---------------- commands ---------------- */
  /* A WORK IS CHOSEN, THEN PLACED. The map used to be asked "what is here?" on every tap and
   * answered differently depending on what happened to be under the finger — and once a tap
   * on your own men picked up their standard, bare ground was competing with the army for the
   * same gesture. The BUILD button says what you are doing before the map has to. */
  function clearPlacing() {
    game.placing = null; game.span = null;
    if (Render.span !== undefined) Render.span = null;
    if (UI.armBuild) UI.armBuild(false);
  }
  function issue(cmd) {
    if (game.mode === 'guest') {
      Net.send({ t: 'cmd', c: cmd });
      Rec.command(cmd, refWorld && snapCur ? { t: snapCur.t, map: refWorld.map } : null);
      return { ok: true };
    }
    const r = World.applyCommand(game.world, game.viewer, cmd);
    if (r.ok) Rec.command(cmd, game.world);   // orders GIVEN, not orders refused
    if (!r.ok) {
      if (r.err === 'essence') UI.banner('Not enough Essence', 'warn');
      else if (r.err === 'presence') UI.banner('A unit of yours must stand there — plant the banner first', 'warn');
      else if (r.err === 'claim') UI.banner('Beyond your writ — your Gates carry it outward', 'warn');
      else if (r.err === 'ground') UI.banner('The ground will not bear it', 'warn');
      else if (r.err === 'crowded') UI.banner('Too close to another work', 'warn');
      else if (r.err === 'busy') UI.banner('Your masons are all at work — hold more Gates to hire another crew', 'warn');
      else if (r.err === 'raising') UI.banner('It is not finished yet', 'warn');
      else if (r.err === 'noup') UI.banner('The Pattern is what it is — there is nothing to raise', 'warn');
      else if (r.err === 'contested') UI.banner('The ground is contested', 'warn');
      else if (r.err === 'fog') UI.banner('You cannot storm what you cannot see', 'warn');
      /* the two refusals only a work with a LENGTH can earn */
      else if (r.err === 'short') UI.banner('Too short a run to be a wall', 'warn');
      else if (r.err === 'crews') UI.banner('Too long for the crews you have — hold more Gates, or draw a shorter run', 'warn');
      else if (r.err === 'paused') UI.banner('The world is halted — lift it to give orders', 'warn');
      else if (r.err === 'whole') UI.banner('There is nothing broken to mend', 'warn');
      else if (r.err === 'working') UI.banner('The masons are already in it', 'warn');
    }
    return r;
  }

  /* ---------------- view assembly (render-ready, fog applied) ---------------- */
  function hostView() {
    const world = game.world, viewer = game.viewer;
    const see = (x, y) => World.canSee(world, viewer, x, y);
    const mem = world.players[viewer].explored;
    return {
      t: world.t, map: world.map, nav: world.nav, mapSeed: world.seed,
      /* a rival's Seat is a rumour until you have seen it — one flag per seat now, since
       * with four heirs you may have found one court and not another */
      seatSeen: world.map.cities.map((id) => !!world.players[viewer].explored[id]),
      /* the SAME fog the wire applies: a rival's works only where you can see them, and
       * ghosts (id-keyed in the world, listed on the view) for the ones you cannot */
      players: world.players.map((pl, pi) => pi === viewer
        ? { ...pl, ghosts: [] }
        : { ...pl,
            /* a curtain shows the moment any part of it is seen, not only its middle */
            buildings: pl.buildings.filter((b) => see(b.x, b.y)
              || (b.x2 != null && (see(b.x2, b.y2) || see(b.x * 2 - b.x2, b.y * 2 - b.y2)))),
            ghosts: Object.entries(world.players[viewer].ghosts)
              .filter(([, g]) => g.owner === pi && !see(g.x, g.y))
              .map(([id, g]) => ({ id: +id, bt: g.bt, level: g.level, x: g.x, y: g.y, x2: g.x2, y2: g.y2 })) }),
      sites: world.map.sites.map((s) => {
        if (see(s.x, s.y)) return { id: s.id, live: true, holder: World.nodeHolder(world, s) };
        return mem[s.id] ? { id: s.id, live: false, holder: -1 } : null;
      }),
      units: world.units.filter((u) => u.owner === viewer || see(u.x, u.y)),
      storms: world.storms.filter((s) => see(s.x, s.y)),
      visSources: World.visionSources(world, viewer),
      seen: world.players[viewer].seen,   // ground you have ever had eyes on
      see
    };
  }
  function guestView() {
    const snap = snapCur;
    /* vision sources rebuilt client-side from own visible assets */
    const src = [];
    const me = game.viewer;
    const city = refWorld.map.sites[refWorld.map.cities[me]];
    src.push([city.x, city.y, C.VISION.city]);
    /* your own works see for you — the snapshot always carries them in full */
    for (const b of snap.players[me].buildings)
      src.push([b.x, b.y, (C.BUILDINGS[b.bt] && C.BUILDINGS[b.bt].vision) || C.VISION.build]);
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
    for (const u of units) if (u.owner === me) src.push([u.x, u.y, C.VISION.unit]);
    const see = (x, y) => src.some(([sx2, sy2, r]) => (x - sx2) * (x - sx2) + (y - sy2) * (y - sy2) < r * r);
    /* the guest builds the same world from the same seed, so terrain needs no wire at all */
    /* the guest remembers the land itself. Nothing about it needs to cross the wire — it is
     * built from the same sight the guest already computes for its own fog. */
    if (!guestSeen) guestSeen = World.newSeenMask();
    World.markSeen(guestSeen, src);
    return { t: snap.t, map: refWorld.map, nav: refWorld.nav, mapSeed: refWorld.seed, players: snap.players,
             seen: guestSeen,
             seatSeen: refWorld.map.cities.map((id, pi) => pi === Net.localIdx ||
               !!(snap.sites[id] && snap.sites[id].live !== undefined)),
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
      else if (ev.e === 'muster') { if (ev.pi === game.viewer) UI.banner(ev.pause ? '⏸ The muster is halted — essence gathers' : '▶ The muster resumes', ''); }
      else if (ev.e === 'rally') {
        /* site >= 0 names a place; a bare point still carries x, so only a rally with
         * neither is the order to come home */
        if (ev.pi === game.viewer) UI.banner(ev.site >= 0 ? '⚐ The company posts its standard at ' + siteName(ev.site)
          : ev.x != null ? '⚐ The company posts its standard in open country'
          : '⚐ The company holds at home', '');
      }
      else if (ev.e === 'raze') UI.banner(ev.pi === game.viewer ? 'Your ' + (C.BUILDINGS[ev.bt] ? C.BUILDINGS[ev.bt].name : 'building') + ' has been RAZED!' : 'You raze the rival’s works', ev.pi === game.viewer ? 'warn' : '');
      /* SAY WHO IS AT THE GATE. One banner covered both, so a rift gnawing an outlying Gate
       * read exactly like a rival's assault — and a player watching for the rival never saw
       * the black road taking three quarters of their army. */
      else if (ev.e === 'hurtcity') {
        if (ev.pi !== game.viewer) continue;
        if (ev.by === C.CHAOS_ID) UI.banner('Chaos is inside your city!', 'chaos');
        else if (ev.by != null && ev.by !== game.viewer) UI.banner((game.names[ev.by] || 'The enemy') + ' is inside your city!', 'warn');
        else UI.banner('Your works are under attack!', 'warn');
      }
      /* the Shrine falling is the single biggest thing an assault can do — say what it cost */
      else if (ev.e === 'shrinefell') UI.banner(ev.pi === game.viewer
        ? '✴ Your Shrine is thrown down — the Pattern lets go of you (' + Math.round(ev.pattern) + '%)'
        : '✴ ' + game.names[ev.pi] + ' is torn off the Pattern — ' + Math.round(ev.pattern) + '% left',
        ev.pi === game.viewer ? 'warn' : 'alert')
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
      /* A HALT BANKS NO TIME. Letting the accumulator fill while the world is stopped would
       * make lifting the pause fast-forward the match by however long you stood there —
       * which is the one thing a pause must never do. */
      if (game.world.paused) acc = 0; else acc += dtReal;
      let steps = 0;
      while (acc >= C.SIM_DT && steps++ < 6) {
        acc -= C.SIM_DT;
        if (!game.over) {
          if (game.mode === 'sp') game.bot.step(game.world, 1, (cmd) => World.applyCommand(game.world, 1, cmd), C.SIM_DT);
          /* every guest's commands are applied AS THAT GUEST — with four seats the sender
           * is the only thing that says whose order it was */
          if (game.mode === 'host')
            for (const q of guestCmdQueue.splice(0)) World.applyCommand(game.world, q.pi, q.c);
          World.update(game.world, C.SIM_DT);
        }
      }
      const view = hostView();
      const evs = game.world.events.splice(0);
      /* the chronicle sees the WORLD here, not the view — a record you read afterwards has no
       * business being fogged, and the sim is right there */
      if (!game.over) { Rec.sample(Rec.fromWorld(game.world)); Rec.note(evs, game.world); }
      if (evs.length) { routeEvents(evs, view); if (game.mode === 'host') pendingGuestEvents.push(...evs); }
      if (game.hints && game.hints.length && game.world.t >= game.hints[0][0]) {
        const h = game.hints.shift();
        UI.banner(h[1], h[2]);
      }
      if (game.mode === 'host') {
        snapTimer -= dtReal;
        if (snapTimer <= 0) {
          snapTimer = 0.1;
          /* one snapshot per guest: each is fog-filtered for THAT seat, so they cannot share */
          const evs2 = pendingGuestEvents.splice(0);
          for (const p of Net.peers)
            if (p.dc && p.dc.readyState === 'open')
              Net.send({ t: 'snap', s: Net.snapFor(game.world, p.idx, evs2) }, p.idx);
        }
      }
      Render.frame(view, game.viewer, dtReal);
      UI.paused(game.world.paused, game.viewer, game.names);
      UI.hud(view, game.viewer, (game.world.players[game.viewer].incomeRate || 0) - (game.world.players[game.viewer].drainRate || 0), game.targeting);
      UI.tick(game.world.players[game.viewer].essence);
      UI.flags(view, game.viewer, game.armedFlag);
    } else if (game.mode === 'guest' && snapCur) {
      const view = guestView();
      /* a guest may hold ANY seat but seat 0 — read its own, never seat 1's */
      const gv = game.viewer, gp = snapCur.players[gv] || {};
      Render.frame(view, gv, dtReal);
      UI.paused(snapCur.paused, gv, game.names);
      UI.hud(view, gv, (gp.incomeRate || 0) - (gp.drainRate || 0), game.targeting);
      UI.tick(gp.essence || 0);
      UI.flags(view, gv, game.armedFlag);
    }
  }

  /* ---------------- input: drag pans, pinch zooms, tap acts ---------------- */
  let pDown = null, dragging = false, miniScrub = false;
  const touches = new Map();          // active pointers, for the pinch
  let pinchFrom = 0, pinchZoom = 1;
  const spread = () => {
    const p = [...touches.values()];
    return p.length < 2 ? 0 : Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  };
  function onDown(e) {
    if (!game.mode) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {          // a second finger: this gesture is a pinch, not a tap
      pinchFrom = spread(); pinchZoom = Render.zoom || 1;
      dragging = true; pDown = null; miniScrub = false;
      return;
    }
    pDown = { x: e.clientX, y: e.clientY };
    dragging = false;
    miniScrub = Render.hitMinimap(e.clientX, e.clientY);
    if (miniScrub) Render.minimapJump(e.clientX, e.clientY);
  }
  function onMove(e) {
    Render.pointer = { x: e.clientX, y: e.clientY };
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size >= 2) {           // pinch: two fingers set the zoom
      const now = spread();
      if (pinchFrom > 8 && now > 8 && Render.setZoom) Render.setZoom(pinchZoom * (now / pinchFrom));
      return;
    }
    if (!pDown) return;
    /* DRAWING A RUN, THE CAMERA HOLDS STILL. The far end of a wall is aimed with the same
     * finger that pans the map, so any run longer than the twelve-pixel drag threshold moved
     * the board out from under itself — and worse, the drag set `dragging`, which meant the
     * lift was no longer a tap and the second end was never placed at all. While an anchor is
     * down the gesture belongs to the wall: the line follows the finger and nothing else does. */
    if (game.span) return;
    if (miniScrub) { Render.minimapJump(e.clientX, e.clientY); return; }
    /* the map is wider than the screen now — drag pans on BOTH axes */
    const dx2 = e.clientX - pDown.x, dy2 = e.clientY - pDown.y;
    if (dragging || Math.abs(dy2) > 12 || Math.abs(dx2) > 12) {
      dragging = true;
      Render.pan(e.clientX - (onMove._lx != null ? onMove._lx : pDown.x),
                 e.clientY - (onMove._ly != null ? onMove._ly : pDown.y));
    }
    onMove._lx = e.clientX; onMove._ly = e.clientY;
  }
  function onWheel(e) {
    if (!game.mode || !Render.setZoom) return;
    e.preventDefault();
    Render.setZoom((Render.zoom || 1) * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
  }
  function onUp(e) {
    touches.delete(e.pointerId);
    const wasTap = pDown && !dragging && !miniScrub && touches.size === 0;
    pDown = null; dragging = false; miniScrub = false; onMove._lx = onMove._ly = null;
    if (!wasTap || !game.mode || game.over) return;
    const x = e.clientX, y = e.clientY;
    const view = game.mode === 'guest' ? (snapCur ? guestView() : null) : hostView();
    if (!view) return;
    /* PLACING A CHOSEN WORK comes before everything — it is the thing the player is plainly
     * in the middle of doing, and nothing else on the map should steal the tap. */
    if (game.span) {
      const from = game.span;
      const w = Render.toWorld(x, y, game.viewer);
      const r = issue({ c: 'build', x: from.x, y: from.y, x2: w.x, y2: w.y, bt: from.bt, co: from.co });
      /* a refused run keeps the anchor, so you can try the far end again without starting over */
      if (!r || r.ok !== false) clearPlacing();
      return;
    }
    /* AN ARMED WORK OWNS THE MAP UNTIL IT IS PLACED. Cancelling it on a tap that landed on
     * your own men or your own works was tried and it was wrong in both halves: a Gate stands
     * on a spring and a spring must be HELD, so the ground you are aiming at is precisely the
     * ground your troops are standing on — and with an army at home there is barely a patch of
     * your own country that is not under somebody. Works are no better: a curtain may start at
     * one of your own bastions, which is the whole point of being allowed to build into stone.
     * What cancels an armed work is reaching for a DIFFERENT tool — a standard from the tray,
     * a power — and those clear it where they are handled. The map only ever places. */
    if (game.placing) {
      const w = Render.toWorld(x, y, game.viewer);
      const def = C.BUILDINGS[game.placing.bt];
      if (def.span) {   // a work with a LENGTH: this tap is the anchor, the next is the far end
        game.span = { x: w.x, y: w.y, bt: game.placing.bt, co: game.placing.co };
        /* `reach` is how long a run the idle masons can cover — the only limit on a wall's
         * length — so the preview can refuse a run for the real reason before the second tap
         * does. A guest holds no world; the host validates, and its preview does not judge. */
        const reach = game.world ? World.wallReach(game.world, game.viewer) : 0;
        Render.span = { x: w.x, y: w.y, from: Render.pointer, reach };
        UI.banner(reach ? 'Now tap where the wall should END — the masons reach ' + Math.round(reach)
                        : 'Now tap where the wall should END', 'alert');
        return;
      }
      const r = issue({ c: 'build', x: w.x, y: w.y, bt: game.placing.bt, co: game.placing.co });
      if (!r || r.ok !== false) clearPlacing();   // a refusal leaves it armed to try again
      return;
    }
    if (game.armedFlag != null) {
      const id = game.armedFlag;
      game.armedFlag = null;
      /* A standard goes wherever you point. Tapping a site names it — so the banner reads
       * "at the Drowned Bell" rather than a bare coordinate — but bare ground is just as
       * valid an order, and the column pathfinds toward it. There is nothing here to refuse. */
      const siteId = Render.hitSite(x, y, view, game.viewer, true);   // flags: whole court counts
      const w = Render.toWorld(x, y, game.viewer);
      const where = siteId >= 0 ? { site: siteId } : { x: w.x, y: w.y };
      issue({ c: 'rally', co: id, ...where });   // a COMPANY's standard, not a hall's
      return;
    }
    if (game.targeting) {
      game.targeting = false;
      const w = Render.toWorld(x, y, game.viewer);
      if (!view.see(w.x, w.y)) { UI.banner('You cannot storm what you cannot see', 'warn'); return; }
      issue({ c: 'power', k: 'storm', x: w.x, y: w.y });
      return;
    }
    /* A sheet is a modal: the first tap outside it just dismisses it. Armed flags and storm
     * targeting are handled above, so an explicit armed action still goes through. */
    if (UI.sheetOpen()) { UI.closeSheet(); return; }
    /* A TROOP OF YOURS IS HIS COMPANY'S FLAG. Finding the right chip in the tray means
     * remembering which colour you gave which hall; pointing at the men themselves does not.
     * Tapping one arms his standard, and the next tap is where they go. */
    const uco = Render.hitUnit ? Render.hitUnit(x, y, game.viewer) : 0;
    if (uco > 0) {
      game.armedFlag = game.armedFlag === uco ? null : uco;
      UI.banner(game.armedFlag ? '⚐ Standard ' + uco + ' — tap where they should stand' : 'Cancelled',
                game.armedFlag ? 'alert' : 'warn');
      return;
    }
    /* one of your own works first (they overlap everything), then sites, then bare ground */
    const bid = Render.hitBuilding(x, y);
    if (bid >= 0) {
      const me = view.players[game.viewer];
      const b = me.buildings.find((q) => q.id === bid);
      if (b) { Render.selected = bid; UI.upSheet(b, me.essence, me.walking, me); return; }
    }
    const siteId = Render.hitSite(x, y, view, game.viewer);
    if (siteId >= 0) {
      /* every site opens a sheet — including the rival's city (the assault order) */
      const site = view.map.sites[siteId];
      const foeCity = view.map.cities[1 - game.viewer] === siteId;
      UI.siteSheet(site, view.sites[siteId], game.viewer, view.players[game.viewer].essence, foeCity,
                   view.players[game.viewer], view.players[1 - game.viewer]);
      return;
    }
    /* bare ground does nothing now: raising a work begins at the BUILD button, so the map is
     * only ever asked about things that are ON it. */
    Render.selected = -1;
  }

  /* ---------------- LAN pairing (QR flow ported from Perils) ---------------- */
  function setupLan() {
    const say = (t2) => { $('lan-status').textContent = t2; };
    /* THE DIAGNOSTICS ARE NOT A SECRET. They were behind a tap on the status line, which is
     * fine when pairing works and useless when it does not — the one time anybody wants them
     * is the one time they are hard to find, and a photograph of the screen is how a bug like
     * this gets reported. While pairing they are ON, and they lead with the LIVE state of
     * every connection rather than a history of what has already happened. */
    let lanNote = '';
    const paintDiag = () => {
      const d = $('lan-diag');
      d.classList.remove('hidden');
      d.textContent = 'amber v' + (global.GAME_VERSION || '?') + '\n' + Net.state() +
                      (lanNote ? '\n' + lanNote : '') +
                      '\n---\n' + Net.diag.slice(-12).join('\n');
    };
    Net.onDiag = () => paintDiag();
    /* WHEN THE WI-FI WILL NOT CARRY IT. A web page cannot switch on a phone's hotspot — there
     * is no API for it on any platform, and there will not be one — so the most the game can
     * do is recognise the moment, say the one thing that fixes it, and on Android offer to
     * open the settings screen. Shown only on a real failure: advice nobody needs is advice
     * nobody reads. */
    const android = /android/i.test(navigator.userAgent || '');
    $('lan-help-os').textContent = android
      ? 'Android: Settings → Connections → Mobile Hotspot. The other phone joins it like any Wi-Fi.'
      : 'iPhone: Settings → Personal Hotspot → Allow Others to Join. The other phone joins it like any Wi-Fi.';
    $('lan-hotspot').classList.toggle('hidden', !android);
    $('lan-hotspot').addEventListener('click', () => {
      /* Android's Chrome will launch an activity from an intent: URL. If the OEM has moved the
       * screen it simply does nothing, which is why the written route is above it and not
       * behind it. */
      try { global.location.href = 'intent://#Intent;action=android.settings.TETHER_SETTINGS;end'; }
      catch (e) { /* the instructions are on screen either way */ }
    });
    /* FOUR DIFFERENT PROBLEMS, FOUR DIFFERENT SENTENCES. 'It did not connect' is not advice.
     * Net.advice() names which one it is from the evidence — this phone's own candidates and
     * the ones the other phone sent — and each name gets the thing that actually fixes it. */
    const ADVICE = {
      cell: ['This phone is on mobile data, not Wi-Fi',
             'Two phones can only find each other on one network. <b>Join a Wi-Fi network — or ' +
             'make THIS phone a hotspot and have the other join it.</b>'],
      nolan: ['This phone has no local network address',
              'It gathered no Wi-Fi address at all, so there is no network for the other phone ' +
              'to reach it on. <b>Join a Wi-Fi network, or make this phone a hotspot.</b>'],
      diff: ['The two phones are on DIFFERENT networks',
             'Their addresses have nothing in common — one may be on mobile data, or on a ' +
             'guest network. <b>Put both on the same Wi-Fi, or make this phone a hotspot and ' +
             'have the other join it.</b>'],
      same: ['This Wi-Fi will not pass the two phones to each other',
             'They are on the same network and it is refusing to carry traffic between its own ' +
             'devices — guest Wi-Fi and a good many home routers do this. Nothing on either ' +
             'phone can change it from here. <b>Make THIS phone a hotspot, join it from the ' +
             'other, and pair again.</b> A hotspot is a network of two with nothing in the way.'],
      unknown: ['The link could not be made',
                'The two phones completed the handshake and then could not reach each other. ' +
                '<b>Check both are on the same Wi-Fi — or make this phone a hotspot and have ' +
                'the other join it.</b>']
    };
    Net.onFail = () => {
      const [title, why] = ADVICE[Net.advice()] || ADVICE.unknown;
      $('lan-help-title').innerHTML = title;
      $('lan-help-why').innerHTML = why;
      $('lan-panel').classList.remove('hidden');
      $('lan-help').classList.remove('hidden');
      say('the link could not be made — see below');
      paintDiag();
    };
    /* AND SAY IT BEFORE THEY START, where the platform will tell us. Chrome on Android reports
     * the transport outright; an iPhone says nothing, so nothing is claimed. */
    const paintNet = () => {
      const el = $('lan-net'), k = Net.netKind({});
      if (k.told === 'cellular') {
        el.textContent = '⚠ This phone is on mobile data — join a Wi-Fi network, or make it a hotspot';
        el.className = 'warn';
      } else if (k.told === 'wifi') { el.textContent = '✓ This phone is on Wi-Fi'; el.className = ''; }
      else { el.classList.add('hidden'); return; }
      el.classList.remove('hidden');
    };
    $('btn-lan').addEventListener('click', paintNet);
    paintNet();
    $('lan-status').addEventListener('click', () => $('lan-diag').classList.toggle('hidden'));
    /* repainted on a timer as well as on events: ICE moves without telling us, and a stuck
     * pairing produces no events at all — which is exactly the case worth photographing */
    setInterval(() => { if (Net._pairing || Net.active) paintDiag(); }, 1000);

    const qrDisplay = $('qr-display'), qrJoin = $('qr-join'), qrScanReply = $('qr-scan-reply');
    let pairStop = null;

    /* stream a payload as small cycling QR frames — dense single QRs defeat phone autofocus */
    function startPairStream(payload) {
      if (!global.QR) return false;
      const CHUNK = 80;
      const chunks = [];
      for (let i2 = 0; i2 < payload.length; i2 += CHUNK) chunks.push(payload.slice(i2, i2 + CHUNK));
      const id = Math.random().toString(36).slice(2, 6), n = chunks.length;
      lanNote = 'showing ' + payload.length + ' chars as ' + n + ' QR frame' + (n === 1 ? '' : 's');
      paintDiag();
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
              if (parts[idx] == null) {
                parts[idx] = p.slice(4).join('|'); have++;
                hint.textContent = 'reading the Trump… ' + have + '/' + need;
                lanNote = 'scanned ' + have + '/' + need + ' frames';
              }
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
      $('lan-help').classList.add('hidden');
      say('drawing your Trump…');
      try {
          say('gathering routes — this takes a few seconds…');
        const offer = await Net.host();
        if (!startPairStream(offer)) { say('could not draw the QR'); return; }
        qrJoin.classList.add('hidden');
        qrScanReply.classList.remove('hidden');
        say(`1) ${C.SEAT_NAMES[Net.peers.length]} scans this  2) tap SCAN REPLY`);
      } catch (e) { say('failed: ' + (e.message || e)); }
    });
    /* PAIRING IS WHERE THE PLAYER IS BLIND. The camera covers the screen, and whatever the
     * answer turns out to be — linked, refused, unreadable — the only place it is ever said is
     * a status line inside a fold-out panel. Make sure that panel is open when the scanner
     * lets go of the screen, and say a failure out loud where it cannot be missed. */
    const backToLan = () => $('lan-panel').classList.remove('hidden');
    qrScanReply.addEventListener('click', async () => {
      try {
        if (pairStop) { pairStop(); pairStop = null; }
        const answer = await scanQR();
        backToLan();
        lanNote = 'read a reply of ' + answer.length + ' chars'; paintDiag();
        say('the Trumps touch…');
        await Net.acceptAnswer(answer);
        paintDiag();
        /* A LINK THAT NEVER OPENS SAYS NOTHING ON ITS OWN. Everything above this point can
         * succeed and the connection still never come up — the two phones cannot reach each
         * other — and the only symptom is a guest flashing its reply forever. Say so, and say
         * the two things that actually cause it. */
        setTimeout(() => {
          if (Net.active) return;
          say('no link after 20s — tap HOST THE TABLE to draw a fresh Trump and try again');
          UI.banner('No link — tap HOST THE TABLE to try again', 'warn');
          paintDiag();
        }, 20000);
      } catch (e) { backToLan(); say(e.message); UI.banner('Pairing failed — ' + e.message, 'warn'); }
    });
    qrJoin.addEventListener('click', async () => {
      Net.diagReset();
      $('lan-help').classList.add('hidden');
      try {
        const offer = await scanQR();
        backToLan();
        lanNote = 'read an offer of ' + offer.length + ' chars'; paintDiag();
        say('gathering routes — this takes a few seconds…');
        const answer = await Net.join(offer);
        if (!startPairStream(answer)) { say('could not draw the reply QR'); return; }
        say('show this reply to Corwin — linking…');
      } catch (e) { backToLan(); say(e.message); UI.banner('Pairing failed — ' + e.message, 'warn'); }
    });

    Net.onOpen = () => {
      if (pairStop) { pairStop(); pairStop = null; }
      qrScanReply.classList.add('hidden'); qrJoin.classList.remove('hidden');
      if (Net.isHost) {
        /* up to three guests, added one at a time; play with however many are in */
        const n = Net.seated();
        $('lan-start').classList.remove('hidden');
        $('lan-start').textContent = 'BEGIN — ' + n + ' HEIRS';
        $('qr-host').textContent = Net.canAdd() ? 'ADD ANOTHER HEIR' : 'FOUR IS THE LIMIT';
        $('qr-host').disabled = !Net.canAdd();
        $('qr-host').classList.remove('hidden');
        say(n + ' of ' + C.MAX_PLAYERS + ' seated — add another, or begin');
      } else say('LINKED — awaiting the host…');
    };
    $('lan-start').addEventListener('click', () => {
      const seed = (Math.random() * 0xffffffff) >>> 0;
      const seats = Net.seated();
      /* each guest is told the same seed and player count, and its OWN seat */
      for (const p of Net.peers)
        if (p.dc && p.dc.readyState === 'open') Net.send({ t: 'start', seed, seats, idx: p.idx }, p.idx);
      $('lan-start').classList.add('hidden');
      startMP(seed, seats, 0);
    });
    Net.onStart = (m) => startMP(m.seed, m.seats, m.idx);
    Net.onCmd = (c, from) => guestCmdQueue.push({ c, pi: from });
    Net.onSnap = (s) => {
      snapPrev = snapCur; snapCur = s; snapAt = performance.now();
      if (!game.over) {
        Rec.sample(Rec.fromSnap(s, game.viewer));
        if (s.events && s.events.length) Rec.note(s.events, refWorld ? { t: s.t, map: refWorld.map } : null);
      }
      if (s.events && s.events.length && refWorld) routeEvents(s.events, guestView());
      if (s.winner !== null && s.winner !== undefined) endMatch(s.winner, s.winReason);
    };
    Net.onClose = () => {
      if (game.mode === 'host' || game.mode === 'guest') {
        UI.banner('The Trump link is severed', 'warn');
        if (game.mode === 'guest' && !game.over) setTimeout(toMenu, 2500);
        /* on the end screen the link IS the offer of a rematch. Losing it there is not fatal
         * — nobody is mid-match — but the button must stop promising a game that can no
         * longer be dealt, so redraw the screen with what is actually left. */
        else if (game.over) endScreen();
      } else say('link lost');
    };
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    /* No WebGL, no game — and say so, instead of failing into a black screen */
    if (!Render) {
      const m = $('menu');
      if (m) m.innerHTML = '<h1 style="font-size:34px;letter-spacing:6px">AMBER</h1>' +
        '<p class="lore">This device has no working WebGL, which Amber needs to draw the world.' +
        '<br>Try another browser, or turn on hardware acceleration.</p>';
      return;
    }
    await Render.init($('game'));
    window.addEventListener('resize', Render.resize);
    UI.init({
      onCampaign: () => {
        /* a claimed throne starts the succession OVER, from the first rung */
        if (done()) { try { localStorage.setItem('amber_rung', '0'); } catch (e) {} }
        startSP(LADDER[Math.min(rung(), LADDER.length - 1)], C.DIFFICULTY[UI.difficulty()], true);
      },
      onSkirmish: (kind) => startSP(kind, C.DIFFICULTY[UI.difficulty()], false),
      /* the halt: anyone at the table may call one and anyone may lift it, so the button
       * simply asks for the opposite of what is showing. A guest sends it like any other
       * order and learns the answer from the next snapshot. */
      onPause: () => {
        if (game.over) return;
        const on = game.mode === 'guest' ? !!(snapCur && snapCur.paused) : !!(game.world && game.world.paused);
        if (!on) { game.targeting = false; game.armedFlag = null; game.span = null; Render.span = null; UI.closeSheet(); }
        issue({ c: 'pause', on: !on });
      },
      onFix: (id) => issue({ c: 'fix', id }),
      onBuild: (x, y, bt, co) => issue({ c: 'build', x, y, bt, co }),
      onBuildMenu: () => {
        if (game.over) return;
        if (game.placing) { clearPlacing(); UI.banner('Cancelled', 'warn'); return; }
        const view = game.mode === 'guest' ? (snapCur && guestView()) : hostView();
        if (!view) return;
        game.targeting = false; game.armedFlag = null;
        UI.buildSheet(view.players[game.viewer].essence, view.players[game.viewer]);
      },
      /* a card was chosen: hold it, and let the next tap on the map say where */
      onPick: (bt, co) => {
        game.placing = { bt, co };
        game.span = null; Render.span = null;
        UI.armBuild(true);
        const d = C.BUILDINGS[bt];
        UI.banner(d.span ? '🔨 ' + d.name + ' — tap where the run should START'
                         : '🔨 ' + d.name + ' — tap where it should stand', 'alert');
      },
      onUp: (id, br) => issue({ c: 'up', id, br }),
      onWalk: (on) => issue({ c: 'walk', on }),
      onBanner: (site) => issue({ c: 'banner', site }),
      onFlagArm: (id) => {
        game.targeting = false;
        clearPlacing();   // picking up a standard is not placing a work

        game.armedFlag = game.armedFlag === id ? null : id;
        if (game.armedFlag != null)
          UI.banner('⚐ Tap where this company should stand', 'alert');
      },
      onRejoin: (co) => { game.armedFlag = null; issue({ c: 'rally', co, site: -1 }); },
      onAssign: (id, co) => issue({ c: 'assign', id, co }),
      onRecall: () => {
        const view = game.mode === 'guest' ? (snapCur && guestView()) : hostView();
        if (!view) return;
        /* THE RECALL is the one thing the gold flag was genuinely good for, so it survives as
         * a button rather than a flag: one order that strikes every standing standard and
         * turns the whole army for home. `banner` is still that command — it simply has no
         * chip in the tray any more. */
        issue({ c: 'banner', site: view.map.cities[game.viewer] });
        UI.banner('🛡 The Recall sounds — every blade turns for home', 'alert');
      },
      onMuster: (pause) => issue({ c: 'muster', pause }),
      onPower: (k) => {
        const view = game.mode === 'guest' ? snapCur : game.world;
        if (!view) return;
        const me = view.players[game.viewer];
        if (me.powers[k] > 0) return;
        if (me.essence < C.POWERS[k].cost) { UI.banner('Not enough Essence', 'warn'); return; }
        clearPlacing();   // aiming a power is not placing a work either
        if (k === 'storm') { game.armedFlag = null; game.targeting = !game.targeting; }
        else issue({ c: 'power', k: 'trump' });
      },
      onEndNext: () => {
        if (game.mode === 'sp') {
          if (game.campaign) {
            if (done()) { try { localStorage.setItem('amber_rung', '0'); } catch (e) {} }
            startSP(LADDER[Math.min(rung(), LADDER.length - 1)], C.DIFFICULTY[UI.difficulty()], true);
          } else startSP(game.bot.kind, C.DIFFICULTY[UI.difficulty()], false);
        } else if (game.mode === 'host') rematch();
        else toMenu();
      },
      onEndMenu: toMenu
    });
    const cvs = $('game');
    cvs.addEventListener('pointerdown', onDown);
    cvs.addEventListener('pointermove', onMove);
    cvs.addEventListener('pointerup', onUp);
    cvs.addEventListener('pointercancel', onUp);
    cvs.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('popstate', onPopState);
    /* kill the synthetic mouse click that follows a touch — it lands on whatever
     * sheet just opened under the finger and 'chooses' a card the player never tapped */
    cvs.addEventListener('touchend', (e) => e.preventDefault(), { passive: false });
    setupLan();
    setupPWA();
    $('version').textContent = 'v' + (global.GAME_VERSION || '?');
    UI.showMenu(campaignLabel(), campaignNote());
    requestAnimationFrame((t2) => { lastFrame = t2; requestAnimationFrame(frame); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* LADDER is exported so the suite can ask which rung is FIRST rather than be told a name:
   * the order is measured, and it is expected to move when the heirs do. */
  global.Game = { game, startSP, startMP, toMenu, LADDER };
})(typeof window !== 'undefined' ? window : globalThis);

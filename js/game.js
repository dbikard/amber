/* game.js — orchestration (v0.2): modes, fixed-timestep loop, camera drag + tap routing,
 * campaign, and LAN duel wiring (QR pairing from Perils; host-authoritative fogged sync).
 * Builds the source-agnostic `view` the renderer consumes: live world (sp/host) or
 * snapshot + seed-rebuilt map geometry (guest). */
(function (global) {
  'use strict';

  const C = global.CONST, World = global.World, AI = global.AI;
  const Render = global.Render, UI = global.UI, Net = global.Net, Rec = global.Rec;
  const REALM = global.REALM;
  const $ = (id) => document.getElementById(id);

  /* The succession, in the order you face it. There used to be a private difficulty ramp here
   * as well — RUNG_OPTS — which meant the footing the menu offered governed a skirmish and
   * silently did nothing to the campaign. One knob: the LADDER says WHO, the footing says how
   * strong, and both are the player's to see. */
  /* WEAKEST FIRST, and MEASURED — `node sim.js` prints this line ready to paste. The heirs are
   * not balanced against each other on purpose (see DESIGN_PRINCIPLES); what their strengths
   * are FOR is this order. It used to be a guess with four names in it, and it had bleys —
   * who wins the field by a distance — on the second rung, while corwin was not on the ladder
   * at all. Re-read after the doctrine work of v0.9.44: the Warden fell to the bottom and the
   * Master of Arms rose to the top, which is what happens when a walk is answered — julian is
   * the heir who walks LAST, and the last walker in a field that now marches on Shrines is the
   * one who never gets there. Pasted from the run, not adjusted by hand. */
  const LADDER = ['julian', 'corwin', 'brand', 'bleys', 'benedict'];
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
  /* one event queue PER GUEST, and whose turn it is to be sent to. Both belong to the stagger
   * below: with a single shared queue the first guest served would splice away the events the
   * others had not been sent yet, and they would simply never see them. */
  let snapTurn = 0, evQ = Object.create(null);
  const EV_CAP = 400;   // a guest that is being skipped must not grow an unbounded backlog
  let snapGap = 100;   // observed ms between the last two snapshots — see the interpolation
  let snapPrev = null, snapCur = null, snapAt = 0, refWorld = null, guestSeen = null, guestWallKey = '';

  /* ---------------- campaign ladder ---------------- */
  const rung = () => Math.min(+localStorage.getItem('amber_rung') || 0, LADDER.length);
  const done = () => rung() >= LADDER.length;
  /* THE BUTTON NAMES THE CHAPTER, not the heir. A rung had nothing to say about itself except
   * whom you would face; a chapter has a title and an objective, and the whole point of the
   * change is that the two are not the same question. */
  const campaignLabel = () => {
    const CAM = global.CAMPAIGN;
    if (!CAM) return 'CAMPAIGN';
    const nx = CAM.next();
    return nx ? nx.title : 'Walk it again, from the first chapter';
  };
  /* what the button will actually do, said out loud. Walking again started you against
   * BENEDICT — the last rung — because the index was clamped instead of wrapped, so the
   * reward for finishing the succession was to be dropped straight back at its hardest step. */
  const campaignNote = () => {
    const CAM = global.CAMPAIGN;
    if (!CAM) return '';
    const n = CAM.CHAPTERS.length, cl = CAM.CHAPTERS.filter((c2) => CAM.cleared(c2.key)).length;
    return cl + ' of ' + n + ' · ' + CAM.CHAPTERS.map((c2) => (CAM.cleared(c2.key) ? '✔' : '·')).join(' ');
  };

  /* ---------------- match lifecycle ---------------- */
  /* ---------------- a chapter ----------------
   * The board is PINNED (a story wants its own country, not whatever the noise produced this
   * morning), the rival is named, and `opts` is merged OVER the player's footing so a chapter
   * may hold him back or let him off the leash without taking the footing away. Everything
   * downstream is the ordinary single-player match — what a chapter adds is one predicate,
   * polled below over the world game.js already holds. */
  function startChapter(key) {
    const ch = global.CAMPAIGN && global.CAMPAIGN.byKey(key);
    if (!ch) return false;
    const foot = C.DIFFICULTY[UI.difficulty()] || {};
    startSP(ch.heir, Object.assign({}, foot, ch.opts, { seed: ch.seed, spec: ch.spec }), ch);
    return true;
  }
  /* ---------------- going down into a region ----------------
   * A region of the country is played as an ordinary single-player match, on a world the realm
   * built rather than one this function generated: same loop, same HUD, same input, same
   * everything. What makes it a war rather than a skirmish is the RULES the realm stamped on it
   * (a Seat yields, terms may be made) and the fact that leaving compacts it back into the
   * country instead of throwing it away. That is the whole of the mode's machinery.
   * The rival is the region's holder, in seat 1, and he plays his own doctrine like any heir. */
  /* THE WAR IS ONE WORLD, entered whole. No map screen, no regions, no marches between
   * boards: the country IS the board, and putting the war down is saving that one world
   * (REALM.save) wherever the player walks away. The rival seats are the country's own
   * lords, one bot apiece, exactly as the ?reach rig seats them. */
  function startRealm(realm) {
    game.realm = realm;
    game.mode = 'sp'; game.viewer = 0; game.campaign = false; game.over = false;
    game.chapter = null;
    game.war = true;
    /* the war is polled where a chapter is polled — same shape, same door out */
    game.run = REALM.run(realm);
    if (Render.clearSeatFalls) Render.clearSeatFalls();
    game.world = realm.world;
    /* the lord if the merge has landed him, the marcher's plainer tongue if not */
    const kind = AI.BASELINES && AI.BASELINES.lord ? 'lord' : 'marcher';
    game.bot = AI.make(kind, {});
    game.bots = game.world.players.map((_, i) => (i === 0 ? null : AI.make(kind, {})));
    game.names = game.world.players.map((_, i) => i === 0 ? 'Corwin'
      : game.world.map.sites[game.world.cities[i].site].name);
    game.targeting = false; game.placing = null; game.span = null; Render.span = null;
    game.hints = [];
    Render.resize();
    homeCamera();
    armBack();
    Rec.begin({ version: global.GAME_VERSION, seed: game.world.seed, viewer: 0, names: game.names,
                mode: 'the reach war',
                footing: (C.DIFFICULTY[UI.difficulty()] || {}).name });
    UI.startMatch('the Reach War');
  }
  /* putting the war down — every door out of a war runs through here, because a war that
   * only saved on the polite exits would lose an evening to one swipe-up */
  function saveWar() {
    if (!game.war || !game.realm) return;
    REALM.save(game.realm);
  }

  function startSP(kind, opts, chapter) {
    const isCampaign = !!chapter;
    game.mode = 'sp'; game.viewer = 0; game.campaign = isCampaign; game.over = false;
    /* the chapter's runner holds the objective's own state for the length of the match, and
     * nothing else in the game knows it exists */
    game.chapter = chapter && chapter.obj ? chapter : null;
    game.run = game.chapter && global.CAMPAIGN ? global.CAMPAIGN.run(game.chapter, 0) : null;
    if (Render.clearSeatFalls) Render.clearSeatFalls();   // no throne is falling in a new match
    /* THE BOARD MAY BE CHOSEN RATHER THAN GROWN. `opts.spec` hands createWorld a hand-made
     * world (WorldGen.fromSpec) instead of leaving it to noise, and `opts.seed` pins the
     * match's own RNG so a board plays out the same way twice. This is the seam a campaign
     * chapter needs — a story wants its own ground, not whatever the noise produced — and it
     * is what lets a test put a wall, a crag or a wood exactly where the camera is looking.
     * Everything downstream reads the same world either way. */
    const seed = (opts && opts.seed != null) ? (opts.seed >>> 0) : ((Math.random() * 0xffffffff) >>> 0);
    /* `opts.rules` is how a MODE or a chapter changes the rules of the match — see CONST.RULES.
     * It rides in the same bag as the seed and the spec, because a chapter that opens at terms
     * is exactly as much "the board somebody chose" as a chapter that pins its ground. */
    game.world = World.createWorld(seed, opts && opts.players, opts && opts.spec, opts && opts.rules,
                                   opts && opts.country ? { country: opts.country } : null);
    /* AND A CHAPTER MAY OPEN WITH THE TERMS ALREADY STANDING. `opts.pact` is a list of seats
     * you begin at peace with — set as two OFFERS and never as a pact, so there is one spelling
     * of the state and the heir's own doctrine may withdraw his half whenever it likes. That is
     * what makes a scripted betrayal the RIVAL's doing rather than a trigger in the campaign:
     * `CAMPAIGN.run` never writes to the world, and this does not change that. */
    for (const p of (opts && opts.pact) || []) {
      if (p === 0 || !game.world.players[p]) continue;
      game.world.players[0].offers[p] = 1;
      game.world.players[p].offers[0] = 1;
    }
    game.bot = AI.make(kind, opts);
    /* A COUNTRY SEATS MANY: one bot per AI seat, each already out of phase with the others —
     * the seeded think-stagger is AI.make's own. `game.bot` stays what it always was for the
     * duel, and `game.bots` exists only while a country world does. */
    game.bots = null;
    if (opts && opts.country && game.world.players.length > 2)
      game.bots = game.world.players.map((_, i) => (i === 0 ? null : AI.make(kind, opts)));
    /* the handicap is the heir's, not the board's: it plays its own game, only poorer */
    game.world.players[1].eco = (opts && opts.eco) || 1;
    /* a kind may be an heir or a baseline (the reach rig runs marchers) — both carry a title */
    const kindTitle = (AI.HEIRS[kind] && AI.HEIRS[kind].title) ||
                      (AI.BASELINES && AI.BASELINES[kind] && AI.BASELINES[kind].title) || 'a lord';
    /* at a country's table every seat is named by ITS CITY — ten seats sharing one heir's
     * name would make every banner a riddle */
    game.names = game.bots
      ? game.world.players.map((_, i) => i === 0 ? 'Corwin'
          : game.world.map.sites[game.world.cities[i].site].name)
      : ['Corwin', kindTitle];
    game.targeting = false; game.placing = null; game.span = null; Render.span = null;
    /* A CHAPTER BRINGS ITS OWN TUTORIAL, and it is predicates rather than a clock — see
     * `CAMPAIGN.run().hint`. The timed onboarding below fires on `world.t` alone and says its
     * piece whether or not the player has done the thing, which is exactly wrong inside a
     * chapter that is already teaching one lesson at a time. */
    const seenHints = game.chapter ? 99 : (+localStorage.getItem('amber_hints') || 0);
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
                mode: game.chapter ? 'campaign · ' + game.chapter.key : isCampaign ? 'campaign' : 'skirmish',
                footing: (C.DIFFICULTY[UI.difficulty()] || {}).name });
    UI.startMatch(game.bots ? 'the Reach War' : kindTitle);
  }
  /* `seats` is how many are playing (2..4) and `mySeat` which one you got — the host hands
   * both out with the start message, so a guest never has to guess its own index. */
  /* `war` is `{seed}` when the host is dealing the table INTO HIS WAR: the country is never
   * sent — it regenerates from its seed on every machine exactly as a board does, and the
   * war's HISTORY rides the ordinary snapshots, because the host is authoritative and a
   * snapshot is absolute state. `savedRealm` is the host's own loaded war (guests get null).
   * Humans take the CONTENDER seats in join order — worldgen dealt seats 1 and 2 the thrones
   * furthest from AMBER, which is exactly where a rival heir belongs — and the host's lords
   * play every seat nobody human took. */
  function startMP(seed, seats, mySeat, war, savedRealm) {
    const n = Math.max(2, Math.min(C.MAX_PLAYERS, seats || 2));
    game.seats = n;
    game.mode = Net.isHost ? 'host' : 'guest';
    game.viewer = Net.isHost ? 0 : (mySeat != null ? mySeat : Net.localIdx);
    Net.localIdx = game.viewer;
    game.campaign = false; game.over = false; game.targeting = false; game.armedFlag = null;
    if (Render.clearSeatFalls) Render.clearSeatFalls();   // no throne is falling in a new match
    game.span = null; game.placing = null; Render.span = null;
    /* a call for another match belongs to the match that ended, not to this one */
    game.called = false; game.noMore = false;
    game.bots = null; game.war = false;
    game.realm = null; game.run = null;
    game.lanWar = war ? { seed: war.seed } : null;   // so a rematch can find the same war
    guestCmdQueue = []; pendingGuestEvents = []; snapTimer = 0; snapPrev = snapCur = null; guestSeen = null;
    snapTurn = 0; evQ = Object.create(null); snapGap = 100;
    if (war) {
      if (Net.isHost) {
        /* the host plays HIS OWN saved war, guests and all — putting it down still saves it */
        game.realm = savedRealm;
        game.war = true;
        game.run = REALM.run(savedRealm);
        game.world = savedRealm.world;
        const kind = AI.BASELINES && AI.BASELINES.lord ? 'lord' : 'marcher';
        game.bots = game.world.players.map((_, i) => (i >= n ? AI.make(kind, {}) : null));
      } else {
        /* a guest builds the same country from the seed alone — geometry, never history */
        game.world = null;
        refWorld = REALM.create(war.seed).world;
      }
      const geo = Net.isHost ? game.world : refWorld;
      game.names = geo.players.map((_, i) =>
        i < n ? (C.SEAT_NAMES[i] || 'an heir') : geo.map.sites[geo.cities[i].site].name);
    } else {
      game.names = C.SEAT_NAMES.slice(0, n);
      const build = () => World.createWorld(seed, n);
      game.world = Net.isHost ? build() : null;
      refWorld = Net.isHost ? null : build();   // guest: map geometry only
    }
    Render.resize();
    homeCamera();
    armBack();
    /* a guest never holds the world, only its own fogged snapshots — say so in the header
     * rather than pretend the rival columns are the truth */
    Rec.begin({ version: global.GAME_VERSION, seed, viewer: game.viewer, names: game.names.slice(),
                mode: war ? 'the reach war · LAN ' + n + '-way' : 'LAN ' + n + '-way',
                partial: !Net.isHost });
    /* with up to four seats there is no single "the rival" — name the table instead */
    UI.startMatch(war ? 'the Reach War' : n > 2 ? n + ' HEIRS CONTEND' : (Net.isHost ? 'Eric' : 'Corwin'));
  }
  /* ---------------- the phone's back button ----------------
   * Installed as a PWA, Android's back gesture leaves the app. It should dismiss whatever is
   * open first — a build sheet, an armed flag, a storm being aimed — and only then leave the
   * match, and only then the game. ONE history entry is held while a match runs; each back
   * consumes it, we handle a layer, and we re-arm for the next one. */
  let backArmed = false;
  /* `force` is for a layer that opens while there is no match — the Muster Roll sits over the
   * MENU, where `game.mode` is null and the ordinary arming deliberately does nothing. Without
   * it the first back press out of the codex leaves the site. */
  /* what to run when the LAN screen opens: set by the pairing block below, called by ui.js */
  let lanOpened = null;
  function armBack(force) {
    if (backArmed || (!game.mode && !force)) return;
    backArmed = true;
    try { history.pushState({ amber: 1 }, ''); } catch (e) { backArmed = false; }
  }
  function onPopState() {
    backArmed = false;
    /* the codex is a layer over the menu, so it is peeled before the menu's own answer */
    if (UI.rollOpen && UI.rollOpen()) { UI.rollClose(); return; }
    /* the chapter list and its briefing sit over the MENU, where `game.mode` is null — back
     * out of them the same way the codex does, and only then leave the site */
    if (UI.chaptersOpen && UI.chaptersOpen()) { UI.chaptersClose(); return; }
    /* the rivals and the LAN table sit over the menu the same way, and peel the same way */
    if (UI.screensOpen && UI.screensOpen()) { UI.screensClose(); return; }
    if (!game.mode) return;                       // at the menu: let the browser have it
    if (UI.sheetOpen()) { UI.closeSheet(); armBack(); return; }
    const halted = game.mode === 'guest' ? !!(snapCur && snapCur.paused) : !!(game.world && game.world.paused);
    if (halted) { issue({ c: 'pause', on: false }); armBack(); return; }
    if (game.targeting || game.armedFlag != null || game.span || game.placing) {
      game.targeting = false; game.armedFlag = null;
      game.span = null; Render.span = null;
      clearPlacing();
      /* NO 'CANCELLED'. The player pressed back to cancel; the armed ring, the lit BUILD
       * button and the run's preview all go out on this same line, which is the answer. A
       * 'warn' banner for a thing the player deliberately did also read as a refusal. */
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
    /* THE WAR IS PUT DOWN, NOT THROWN AWAY — walking out is how an evening ends, so the save
     * rides the same door as every other way out. */
    saveWar();
    game.war = false;
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
    /* THE SEAT IS SEEN TO FALL BEFORE THE SCREEN SAYS SO. A castle ending used to cut to the
     * end screen on the same frame as the killing blow, so the one image the whole match
     * builds toward — the throne coming down — was never seen. The sim is untouched (the
     * referee's clocks must not move); the HOLD is here, at the one choke point every mode
     * shares: host and guest each learn the winner their own way and each hold their own
     * screen behind the same collapse. Reentry-guarded: the timeout calls back into this
     * function with the fall already played. */
    if (reason === 'castle' && Render.seatFall) {
      if (!game._fellAt) {
        game._fellAt = performance.now();
        for (let pi = 0; pi < game.names.length; pi++) {
          /* WHOSE THRONE COMES DOWN. A guest reads the snapshot, which carries the hit points
           * of each heir's Seat as it always has; the host reads the CITY, because that is
           * where they live now — `world.players[pi].castleHp` no longer exists, and reading
           * it gave `undefined <= 0`, which is false, so no throne fell and the end screen
           * cut straight to the tally. */
          const pl2 = game.world && game.world.players[pi];
          const seat = game.world && World.seatOf(game.world, pi);
          const p2 = game.mode === 'guest'
            ? (snapCur && snapCur.players[pi])
            : (pl2 && { out: pl2.out, castleHp: seat ? seat.hp : 0 });
          if (p2 && (p2.out || p2.castleHp <= 0)) Render.seatFall(pi);
        }
        setTimeout(() => endMatch(winner, reason), 2800);
        return;
      }
      /* a guest re-enters from every snapshot while the winner rides it — the hold is a
       * TIMESTAMP, not a one-shot, or the second snapshot would cut past the fall */
      if (performance.now() - game._fellAt < 2700) return;
    }
    game.over = true;
    game._fellAt = 0;
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
    /* A CHAPTER SAYS ITS OWN PIECE. It is a told story and the sentence at the end of one is
     * half of what it was for; the two the sim knows how to say are about a throne and a
     * Pattern and are wrong for "you held four wells through the storm". A chapter WON by
     * breaking the Seat or walking the lines keeps the sim's own line, which is the true one. */
    if (game.chapter && reason === 'objective')
      game.endSub = won ? game.chapter.won
                        : 'The chapter is lost. ' + game.chapter.title.replace(/^[IVX]+ · /, '') + ' waits again.';
    game.endNext = null;
    /* THE RECORD IS THE HOST'S. A guest samples its own fog-filtered snapshots — a rival's
     * essence is never on the wire — so its end screen drew a different match from the host's.
     * The match is over and there is nothing left to hide, so hand the true table over and let
     * every seat read the same one. */
    if (game.mode === 'host' && Net.active) Net.send({ t: 'chron', rows: Rec.rows() });
    /* THE CHAPTER IS MARKED CLEARED, and the button offers the next one by NAME — the old
     * ladder's button said which heir you would face, which is the only thing a rung had to
     * say about itself. A chapter has a title. */
    if (game.chapter && won) {
      const CAM = global.CAMPAIGN;
      CAM.clear(game.chapter.key);
      const nx = CAM.next();
      game.endNext = nx ? nx.title.toUpperCase() : 'THE SUCCESSION IS YOURS';
      game.endNextKey = nx ? nx.key : null;
    } else if (game.chapter) {
      game.endNext = 'TRY THE CHAPTER AGAIN';
      game.endNextKey = game.chapter.key;
    } else if (game.mode === 'sp' && game.campaign && won && rung() < LADDER.length) {
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
      /* A GUEST MAY CALL FOR ANOTHER TOO. It used to be told, correctly, that the host is the
       * authority on when a match starts — and then handed a dead button saying so, which is a
       * true sentence and a useless screen: the loser is the one who wants the rematch, and on
       * the losing phone there was nothing to press. The host still deals; the guest's tap is
       * a CALL, and the wait after it is what the dead button used to be. A table with no host
       * left on it is offered nothing, because nothing is what it can have. */
      nextLabel = game.noMore || !Net.active || Net.peerGone ? ''
                : game.called ? 'AWAITING THE HOST' : 'ANOTHER MATCH';
      ready = !game.called;
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
   * offered only while every heir who played is still linked.
   *
   * ONE TAP, ON ANY PHONE. The dealing is the host's — it is the only seat that holds a world
   * — but the WANTING is everybody's, and it is the beaten heir who wants it most. So a guest
   * tapping ANOTHER MATCH sends `{t:'again'}` and the host deals on receipt exactly as if its
   * own button had been pressed. This is the halt's rule again: anyone at the table may call
   * one, because these people are in the same room and a rematch is not a negotiation. It is
   * deliberately not a vote — a vote means the slowest reader at a four-way table holds up
   * three others, and the cost of being dealt in when you had not asked is one board you
   * were going to play anyway, against the same three people, at the seat you already had.
   * Two heirs tapping at once cannot deal two matches: the host only answers a call while it
   * is still ON the end screen, and dealing the first one takes it off. */
  function canRematch() {
    return Net.isHost && Net.active && !Net.peerGone && Net.seated() === game.seats;
  }
  /* `asker` is the seat whose call this is, or nothing when the host tapped its own button.
   * A host that cannot deal answers the caller rather than going quiet: a guest cannot see
   * that some OTHER guest has dropped, so silence would leave it waiting on a match that is
   * never coming. */
  function rematch(asker) {
    if (!canRematch()) {
      if (asker != null) { Net.send({ t: 'nomore' }, asker); return; }
      UI.banner('An heir has left the link — pair again from the menu', 'warn');
      toMenu(); return;
    }
    const seed = (Math.random() * 0xffffffff) >>> 0, seats = game.seats;
    /* a war table's rematch is the SAME war, reloaded — the country has moved since the
     * deal and the save is the truth of it. A war decided since falls back to a board. */
    const saved = game.lanWar ? REALM.load() : null;
    const war = saved && !saved.done ? { seed: saved.seed } : null;
    for (const p of Net.peers)
      if (p.dc && p.dc.readyState === 'open') Net.send({ t: 'start', seed, seats, idx: p.idx, war }, p.idx);
    startMP(seed, seats, 0, war, war ? saved : null);
  }
  /* the guest half of the same button: a call up the wire, and then the wait it used to show
   * without ever having asked for anything */
  function callAgain() {
    if (!Net.active || Net.peerGone) {
      UI.banner('The Trump link is gone — pair again from the menu', 'warn');
      toMenu(); return;
    }
    game.called = true;
    Net.send({ t: 'again' });
    endScreen();
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
    if (!r.ok) sayErr(r.err);
    return r;
  }
  /* WHY AN ORDER WAS REFUSED, in one place, because two things ask: a command the sim turned
   * down, and a WALL'S ANCHOR, which is refused before there is a command at all.
   * A TABLE RATHER THAN A LADDER OF `else if`. Seventeen branches said the same thing
   * seventeen ways, and the shape hid a real hole: an `err` with no branch fell off the end in
   * silence, so a refusal the sim learns tomorrow is a tap that does nothing and says nothing.
   * Missing from the table now names itself, which is ugly exactly once — until somebody
   * writes the sentence. */
  const REFUSAL = {
    essence: 'Not enough Essence',
    presence: 'A unit of yours must stand there — plant the banner first',
    claim: 'Beyond your writ — your Gates carry it outward',
    ground: 'The ground will not bear it',
    crowded: 'Too close to another work',
    busy: 'Your masons are all at work — hold more Gates to hire another crew',
    raising: 'It is not finished yet',
    noup: 'The Pattern is what it is — there is nothing to raise',
    contested: 'The ground is contested',
    fog: 'You cannot storm what you cannot see',
    /* the two refusals only a work with a LENGTH can earn */
    short: 'Too short a run to be a wall',
    crews: 'Too long for the crews you have — hold more Gates, or draw a shorter run',
    paused: 'The world is halted — lift it to give orders',
    whole: 'There is nothing broken to mend',
    working: 'The masons are already in it',
    /* ---- AND THE ONES THE LADDER USED TO SWALLOW ----
     * Writing the branches as a table made the audit possible, and the audit found refusals the
     * sim raises that the player was never told about. `committed` is the worst of them: the
     * sim refuses to take an heir off the Pattern RATHER THAN IGNORING THE ORDER, and its own
     * comment says the seat that gave it is owed the answer — and then nothing was said. */
    committed: 'A walk cannot be called off — the Pattern has you until a hundred, or until the Shrine falls',
    shrine: 'Raise a Pattern Shrine first — there is nothing to walk from',
    max: 'It is already as high as it goes',
    nowall: 'Only a curtain has a sheltered side to turn about',
    cd: 'That power is not ready',
    alive: 'Your champion already walks the board',
    /* the orders a player cannot phrase wrongly by tapping — reached by a stale tap on a match
     * that has just ended, or by a guest whose snapshot is a moment behind */
    over: 'The match is decided',
    /* terms */
    nopact: 'There are no terms to be had in this war',
    seat: 'There is no such heir to treat with',
    /* a city taken, or thrown down */
    noraze: 'A Seat cannot be thrown down in this war',
    held: 'It still answers to an heir — break it first',
    gone: 'There is nothing left of it to throw down',
    elsewhere: 'There is one Pattern, and it is not here — take the city that holds it',
    /* ---- THE REACH WAR'S REFUSALS ----
     * The one rule the reach adds to an ORDER, and the one it adds to an oath. Both must
     * SPEAK: a company that will not march reads as a bug, not a border, unless the border
     * says its name — the prototype's own first finding. */
    reach: 'Beyond that company’s reach — take a city nearer to it',
    city: 'That hall stands outside the city’s reach — only overlapping reaches share halls',
    refused: 'The court will not swear to you — win a lord by taking a city from an heir'
  };
  /* WHOEVER SITS IN THAT SEAT. `game.names` is filled per mode — two in a duel, the seat names
   * at a LAN table — and a banner about a third heir must not read "undefined breaks the truce". */
  function seatName(pi) {
    return (game.names && game.names[pi]) || C.SEAT_NAMES[pi] || 'An heir';
  }
  function sayErr(err) {
    if (!err) return;
    UI.banner(REFUSAL[err] || ('The order was refused: ' + err), 'warn');
  }

  /* ---------------- view assembly (render-ready, fog applied) ---------------- */
  function hostView() {
    const world = game.world, viewer = game.viewer;
    const see = (x, y) => World.canSee(world, viewer, x, y);
    const mem = world.players[viewer].explored;
    return {
      t: world.t, map: world.map, nav: world.nav, mapSeed: world.seed,
      /* the rules of this match, so the HUD asks the world rather than the mode — the same
       * field the wire carries, so a host and a guest draw the same controls */
      rules: world.rules,
      /* a rival's Seat is a rumour until you have seen it — one flag per seat now, since
       * with four heirs you may have found one court and not another */
      seatSeen: world.map.cities.map((id) => !!world.players[viewer].explored[id]),
      /* the SAME fog the wire applies: a rival's works only where you can see them, and
       * ghosts (id-keyed in the world, listed on the view) for the ones you cannot */
      /* the cities of the world, exactly as the wire sends them — public, because a Seat's hit
       * points always were and in a country "whose is that" is the map itself */
      cities: world.cities,
      /* `castleHp` is DERIVED now: a city is a thing with an owner (`world.cities`) and no
       * longer a property of a player, so the view spells out the one number the HUD, the
       * minimap and the chronicle all want — the hit points of the Seat this heir rules from.
       * The wire says exactly the same thing under exactly the same name. */
      players: world.players.map((pl, pi) => pi === viewer
        ? { ...pl, castleHp: (World.seatOf(world, pi) || {}).hp || 0, ghosts: [] }
        : { ...pl, castleHp: (World.seatOf(world, pi) || {}).hp || 0,
            /* the SAME gate and the SAME ghost projection the wire uses — both written once
             * in world.js, so a fog rule cannot land on the host's screen and miss the wire
             * (or the other way round, which is how the wall-ends rule once forked) */
            buildings: pl.buildings.filter((b) => World.workSeen(see, b)),
            ghosts: World.ghostsFor(world, viewer, pi, see) }),
      sites: world.map.sites.map((s) => {
        if (see(s.x, s.y)) return { id: s.id, live: true, holder: World.nodeHolder(world, s) };
        return mem[s.id] ? { id: s.id, live: false, holder: -1 } : null;
      }),
      units: world.units.filter((u) => u.owner === viewer || see(u.x, u.y)),
      storms: world.storms.filter((s) => see(s.x, s.y)),
      visSources: World.visionSources(world, viewer),
      seen: world.players[viewer].seen,   // ground you have ever had eyes on
      /* CURRENT sight as a cell mask, when the sim computes one — the occlusion work makes a
       * sight region an arbitrary shape, and the renderer draws the veil's holes from this
       * when present, falling back to source ellipses when not. Tolerant of either shape the
       * sim might serve ({g,gw,gh,cell} directly, or wrapped as {mask}), because the two
       * halves of this feature land in separate changes and neither may break the other. */
      allSeen: !!world.players[viewer].out,   // a fallen heir spectates: no veil at all
      visMask: (() => {
        const v = world.vis && world.vis[viewer];
        if (!v) return null;
        if (v.g && v.gw) return v;
        if (v.mask && v.mask.g) return v.mask;
        return null;
      })(),
      see
    };
  }
  function guestView() {
    const snap = snapCur;
    const me = game.viewer;
    /* INTERPOLATE OVER THE GAP WE ARE ACTUALLY SEEING, not the one we hoped for. This was a
     * hardcoded 100 to match the host's 10Hz, which is fine while snapshots arrive on time and
     * awful when they do not: alpha saturates at 1 and the men FREEZE, then jump when the late
     * snapshot lands. That stutter is most of what "lag" looks like from the guest's seat, and
     * it bites hardest in exactly the big fights where snapshots are slowest. Tracking the
     * observed interval stretches the motion to fill the gap instead. Clamped so one hiccup
     * cannot put the whole match into slow motion, nor a burst into fast-forward. */
    const alpha = Math.min(1, (performance.now() - snapAt) / snapGap);
    let units = snap.units;
    if (snapPrev) {
      const prev = new Map(snapPrev.units.map((u) => [u.id, u]));
      units = snap.units.map((u) => {
        const q = prev.get(u.id);
        return q ? { ...u, x: q.x + (u.x - q.x) * alpha, y: q.y + (u.y - q.y) * alpha } : u;
      });
    }
    /* THE GUEST DOES NOT GET ITS OWN FOG RULES. This used to rebuild the source list by
     * hand — Seat, own works, own men — and hand-copying is exactly how two of the sim's
     * rules went missing here: a wall watches from its ENDS, and A WALK IS PUBLIC, so a
     * guest's own fog was hiding a walking rival's Shrine that the rules say everyone can
     * find. So the guest asks World.visionSources — the same answer the host and the AI
     * get — against the snapshot dressed as a world, which is already world-shaped enough:
     * own works ride in full, `walking` rides for every revealed walker, and a walking
     * rival's Shrine always rides too, because it stands inside its own Pattern-light and
     * the host's fog therefore always sends it. A fog rule added to the sim now reaches
     * this screen without anyone remembering to copy it. */
    const src = World.visionSources({ map: refWorld.map, players: snap.players, units }, me);
    /* OCCLUDED SIGHT, COMPUTED WHERE THE GUEST STANDS. No mask rides the wire: the guest holds
     * the same land from the same seed, so it bakes the same opacity and marches the same rays
     * over its own snapshot's sources. One honest asymmetry: the wall layer here is built from
     * the walls the guest can SEE — an undiscovered rival curtain does not shade the guest's
     * veil yet. Nothing leaks by it: the HOST's mask is what filters the snapshot, so what the
     * guest receives is already fogged by the true set; its own veil is merely a shade
     * optimistic until the wall is found, which is the moment it starts blocking. */
    let vism = null;
    const meOut = !!(snap.players[me] && snap.players[me].out);
    if (!meOut && World.bakeSight && World.visMask) {
      if (!refWorld.sight) World.bakeSight(refWorld);
      const wallList = [];
      for (const p of snap.players) for (const b of (p.buildings || [])) {
        if (b.x2 == null || b.breach || (b.raise > 0)) continue;
        const e = World.wallEnds(b);
        wallList.push({ ax: e[0], ay: e[1], bx: e[2], by: e[3] });
      }
      const wallKey = wallList.map((w) => `${w.ax | 0},${w.ay | 0},${w.bx | 0},${w.by | 0}`).join('|');
      if (wallKey !== guestWallKey) {
        guestWallKey = wallKey;
        World.bakeWallSight({ sight: refWorld.sight, walls: wallList });
      }
      vism = World.visMask({ sight: refWorld.sight }, 0, src);   // returns {g,gw,gh,cell}
    }
    const see = meOut ? (() => true) : vism
      ? (x, y) => {
          const gx = (x / vism.cell) | 0, gy = (y / vism.cell) | 0;
          return gx >= 0 && gy >= 0 && gx < vism.gw && gy < vism.gh && vism.g[gy * vism.gw + gx] === 1;
        }
      : (x, y) => src.some(([sx2, sy2, r]) => (x - sx2) * (x - sx2) + (y - sy2) * (y - sy2) < r * r);
    /* the guest builds the same world from the same seed, so terrain needs no wire at all */
    /* the guest remembers the land itself. Nothing about it needs to cross the wire — it is
     * built from the same sight the guest already computes for its own fog. */
    if (!guestSeen) guestSeen = World.newSeenMask();
    World.markSeen(guestSeen, vism || src);
    return { t: snap.t, map: refWorld.map, nav: refWorld.nav, mapSeed: refWorld.seed, players: snap.players,
             /* the same two the host's own view carries, off the wire rather than off a world:
              * the rules so the HUD draws the same controls, and the cities so it draws the
              * same board */
             rules: snap.rules, cities: snap.cities,
             seen: guestSeen,
             seatSeen: refWorld.map.cities.map((id, pi) => pi === Net.localIdx ||
               !!(snap.sites[id] && snap.sites[id].live !== undefined)),
             sites: snap.sites, units, storms: snap.storms, visSources: src, see,
             visMask: vism, allSeen: meOut };
  }

  /* ---------------- event routing (banners + canvas fx; fog respected) ---------------- */
  function routeEvents(evs, view) {
    const seen = evs.filter((ev) => ev.pi === game.viewer || ev.x == null || !view.see || view.see(ev.x, ev.y));
    Render.addEvents(seen, view, game.viewer);
    for (const ev of seen) {
      /* A RIVAL ON THE PATTERN GETS THE KNELL, not a banner. Your own walk stays a banner —
       * you know you started it, and you have the count on the board — but a rival's is the
       * one thing that takes the throne without ever coming near you, and being told once in
       * the same corner as the weather is not being told. */
      if (ev.e === 'walk' || (ev.e === 'pattern' && ev.idx > 0)) {
        const mine = ev.pi === game.viewer;
        const at = ev.e === 'walk' ? 0 : C.PATTERN_ALERTS[ev.idx].at;
        const msg = ev.e === 'walk' ? ' has set foot upon the Pattern!' : C.PATTERN_ALERTS[ev.idx].msg;
        if (mine) UI.banner('You' + msg.replace(' has ', ' have '), 'alert');
        else UI.knell(at ? Math.round(at) + '%' : '⟡', game.names[ev.pi] + msg);
      }
      /* ---- TERMS, AGAINST THE THREE TESTS ----
       * OFFERING IS SILENT: it is an echo of the tap the player has just made, and the tray's
       * own chip says "offered" for as long as it is true. An offer made TO him is a thing he
       * did not cause and would act differently for knowing, so it speaks. A rival ACCEPTING is
       * news. A rival BREAKING is the loudest line in the game — the whole point of an instant
       * break is that the first you know of it is your men dying, and one banner is the least
       * the stack owes him. Ours-vs-his decides the wording, never whether to speak. */
      /* ---- A CITY CHANGES HANDS ----
       * The loudest thing that can happen on a war map, and none of the three is an echo of
       * anything the player just did on his own board: a Seat yielding is the end of one problem
       * and the start of another (the court is open and anyone may walk into it), a city taken
       * is the map redrawn, and one thrown down is ground that will never be anybody's again.
       * All three are told from whose side of it the viewer is on. */
      else if (ev.e === 'yield') UI.banner(ev.pi === game.viewer
        ? 'YOUR Seat has yielded — its court is open to anyone who can hold it'
        : seatName(ev.pi) + '’s Seat yields — take the court and it is yours', ev.pi === game.viewer ? 'warn' : 'alert');
      else if (ev.e === 'taken') UI.banner(ev.pi === game.viewer
        ? 'The city is YOURS' : seatName(ev.pi) + ' takes the city', ev.pi === game.viewer ? 'alert' : 'warn');
      else if (ev.e === 'razed') UI.banner(ev.pi === game.viewer
        ? 'You throw the city down — it will be nobody’s now'
        : seatName(ev.pi) + ' throws the city down', ev.pi === game.viewer ? '' : 'warn');
      else if (ev.e === 'offer' && ev.pi !== game.viewer) UI.banner(seatName(ev.pi) + ' asks for terms', 'alert');
      else if (ev.e === 'pact' && ev.pi !== game.viewer) {
        /* a pact between two OTHER heirs is public and is the most important thing on the board
         * for the seat left out of it, so it is named rather than skipped */
        const third = ev.p !== game.viewer;
        if (ev.on) UI.banner(third ? seatName(ev.pi) + ' and ' + seatName(ev.p) + ' come to terms'
                                   : seatName(ev.pi) + ' agrees to terms', 'alert');
        else UI.banner(third ? seatName(ev.pi) + ' breaks with ' + seatName(ev.p)
                             : seatName(ev.pi) + ' BREAKS the truce!', 'warn');
      }
      else if (ev.e === 'rift' && view.t - game.lastRiftBanner > 30) { game.lastRiftBanner = view.t; UI.banner('Chaos tears open a rift in the black road', 'chaos'); }
      else if (ev.e === 'surge') UI.banner('The black road surges — Chaos redoubles!', 'chaos');
      else if (ev.e === 'storm' && ev.pi !== game.viewer) UI.banner(game.names[ev.pi] + ' calls down the storm!', 'warn');
      else if (ev.e === 'trump' && ev.pi !== game.viewer) UI.banner(game.names[ev.pi] + ' draws a Trump!', 'warn');
      /* NO BANNER FOR THE MUSTER VALVE EITHER. It is a STATE, and a state has a readout: the
       * essence rate carries ⏸ for as long as the realm is quiet, and a company's own chip
       * goes `quiet` for as long as that standard is. A banner says it once, for 3.4 seconds,
       * about a thing that is still true a minute later — and the per-company valve made it
       * four banners for one order. */
      /* NO MESSAGE FOR PLANTING A FLAG. It told the player only what he had just done, and
       * named the place he had just tapped — and there IS no failure to report: an order is
       * never refused for its ground. `aimAt` clamps a tap to the board and `foldOrder` folds
       * an unreachable point onto the nearest standing ground at the moment it is consumed, so
       * a company sent at a lake walks to the bank. The one refusal a flag can draw is the
       * halt, and that still speaks (see `issue`).
       * It was worse than redundant: the Recall clears EVERY company's rally, so a four-company
       * realm emitted four of these, and the corner stack holds three — the useful line was
       * shoved out by the echoes of its own order. */
      else if (ev.e === 'raze') UI.banner(ev.pi === game.viewer ? 'Your ' + (C.BUILDINGS[ev.bt] ? C.BUILDINGS[ev.bt].name : 'building') + ' has been RAZED!' : 'You raze the rival’s works', ev.pi === game.viewer ? 'warn' : '');
      /* SAY WHO IS AT THE GATE. One banner covered both, so a rift gnawing an outlying Gate
       * read exactly like a rival's assault — and a player watching for the rival never saw
       * the black road taking three quarters of their army. */
      /* ...AND WHERE, which it could not say either. The alert fires for ANY work of yours
       * being scratched, and it said "inside your city" for all of them — so a Gate on a
       * spring four hundred out, gnawed by one fiend, read exactly like a column at the
       * throne. Reported from play in the first chapter of the campaign, where the whole
       * board is a Gate on a spring. The event carried `x`/`y` the entire time and the banner
       * used neither: now it names the WORK when the trouble is out in Shadow, and keeps the
       * old cry for the one case that deserves it — something standing on your own court. */
      else if (ev.e === 'hurtcity') {
        if (ev.pi !== game.viewer) continue;
        const c = view.map.sites[view.map.cities[game.viewer]];
        const home = c && ev.x != null && Math.hypot(ev.x - c.x, ev.y - c.y) < C.CITY.r;
        const what = (C.BUILDINGS[ev.bt] || {}).name || 'works';
        const who = ev.by === C.CHAOS_ID ? 'Chaos'
                  : ev.by != null && ev.by !== game.viewer ? (game.names[ev.by] || 'The enemy') : null;
        const cls = ev.by === C.CHAOS_ID ? 'chaos' : 'warn';
        if (home) UI.banner(who ? who + ' is inside your city!' : 'Your works are under attack!', cls);
        else UI.banner(who ? who + ' is at your ' + what + '!' : 'Your ' + what + ' is under attack!', cls);
      }
      /* the Shrine falling is the single biggest thing an assault can do — say what it cost */
      else if (ev.e === 'shrinefell') UI.banner(ev.pi === game.viewer
        ? '✴ Your Shrine is thrown down — the Pattern lets go of you (' + Math.round(ev.pattern) + '%)'
        : '✴ ' + game.names[ev.pi] + ' is torn off the Pattern — ' + Math.round(ev.pattern) + '% left',
        ev.pi === game.viewer ? 'warn' : 'alert')
      else if (ev.e === 'fall' && Render.seatFall) Render.seatFall(ev.pi);
      else if (ev.e === 'win') endMatch(ev.winner, ev.reason);
    }
  }

  /* ---------------- the loop ---------------- */
  function frame(now) {
    requestAnimationFrame(frame);
    const dtReal = Math.min(0.1, (now - lastFrame) / 1000 || 0);
    lastFrame = now;
    Render.targeting = game.targeting;
    /* which standard is armed, one way, exactly as `selected` and `targeting` go — the
     * renderer rings that company's men so it is obvious whom the next tap will move */
    Render.armed = game.armedFlag;

    if (game.mode === 'sp' || game.mode === 'host') {
      /* A HALT BANKS NO TIME. Letting the accumulator fill while the world is stopped would
       * make lifting the pause fast-forward the match by however long you stood there —
       * which is the one thing a pause must never do. */
      if (game.world.paused) acc = 0; else acc += dtReal;
      let steps = 0;
      while (acc >= C.SIM_DT && steps++ < 6) {
        acc -= C.SIM_DT;
        if (!game.over) {
          /* the country's bots step wherever the country is — a solo war or a hosted table.
           * `game.bots[i]` is null on every seat a human holds, so nothing double-drives. */
          if (game.bots) {
            for (let bi = 1; bi < game.bots.length; bi++)
              if (game.bots[bi]) game.bots[bi].step(game.world, bi,
                (cmd) => World.applyCommand(game.world, bi, cmd), C.SIM_DT);
          } else if (game.mode === 'sp') {
            game.bot.step(game.world, 1, (cmd) => World.applyCommand(game.world, 1, cmd), C.SIM_DT);
          }
          /* every guest's commands are applied AS THAT GUEST — with four seats the sender
           * is the only thing that says whose order it was */
          if (game.mode === 'host')
            for (const q of guestCmdQueue.splice(0)) World.applyCommand(game.world, q.pi, q.c);
          World.update(game.world, C.SIM_DT);
          /* ---- THE CHAPTER'S OWN CONDITION ----
           * Polled here, over the world this loop already holds, and NOT grown into `update`:
           * the sim is headless-first and host-authoritative, and a scripted objective is a
           * single-player concern. When it is met the match ends through `World.declare`, which
           * is the same door `win` goes out of — so the end screen, the chronicle, the seat's
           * collapse and the event queue all behave exactly as they always have. A loss hands
           * the win to the rival, because "you lost" is a thing this game already knows how to
           * say and inventing a second word for it would mean teaching every screen. */
          if (game.run) {
            const r = game.run.tick(game.world);
            /* A WAR ENDS THROUGH THE SAME DOOR A CHAPTER DOES, and there is no second door: the
             * realm's run has the shape a chapter's has, so one branch serves both. What the
             * war remembers is set HERE and not in `tick`, which answers and never writes. */
            if (r && game.realm && game.war) { game.realm.done = r; REALM.save(game.realm); }
            if (r === 'won') World.declare(game.world, game.viewer, 'objective');
            else if (r === 'lost') World.declare(game.world, 1, 'objective');
          }
          /* THE WAR AUTOSAVES ON A HEARTBEAT — every thirty simulated seconds, beside the
           * saves on every door out — because the door the app actually dies through most
           * often is the one nobody's code sees: the OS swipe. An 80KB stringify twice a
           * minute is nothing. */
          if (game.war && game.realm && game.world.tick % 900 === 0) REALM.save(game.realm);
        }
      }
      const view = hostView();
      const evs = game.world.events.splice(0);
      /* the chronicle sees the WORLD here, not the view — a record you read afterwards has no
       * business being fogged, and the sim is right there */
      if (!game.over) { Rec.sample(Rec.fromWorld(game.world)); Rec.note(evs, game.world); }
      if (evs.length) {
        routeEvents(evs, view);
        if (game.mode === 'host') {
          for (const p of Net.peers) {
            if (!p.dc || p.dc.readyState !== 'open') continue;
            const q = evQ[p.idx] || (evQ[p.idx] = []);
            q.push(...evs);
            if (q.length > EV_CAP) q.splice(0, q.length - EV_CAP);
          }
        }
      }
      if (game.hints && game.hints.length && game.world.t >= game.hints[0][0]) {
        const h = game.hints.shift();
        UI.banner(h[1], h[2]);
      }
      /* the chapter's tutorial: one lesson at a time, and each waits for the BOARD to be true
       * rather than for the clock to reach a number */
      if (game.run && !game.over) {
        const h2 = game.run.hint(game.world);
        if (h2) UI.banner(h2, 'alert');
        UI.objective(game.run.say(game.world));
      }
      if (game.mode === 'host') {
        /* ONE GUEST PER SLOT, NOT ALL OF THEM AT ONCE. Each snapshot is fog-filtered for its
         * own seat so they can never be shared, and building all of them in the same tick put
         * the whole cost in one frame: measured 1.30ms to build and stringify at 91 visible
         * units, rising roughly linearly, so three guests in a big fight is a blown frame ten
         * times a second — on a host that is usually a phone. Serving one guest per slot at a
         * slot of period/n gives every guest the SAME ~10Hz for the same bandwidth, with a
         * third of the spike. */
        const open = [];
        for (const p of Net.peers) if (p.dc && p.dc.readyState === 'open') open.push(p);
        if (open.length) {
          snapTimer -= dtReal;
          if (snapTimer <= 0) {
            snapTimer = 0.1 / open.length;
            snapTurn = (snapTurn + 1) % open.length;
            const p = open[snapTurn];
            const q = evQ[p.idx] || (evQ[p.idx] = []);
            /* the events are only consumed if the snapshot actually GOES — a dropped snapshot
             * must not eat the shots and deaths the guest has still never been told about */
            if (Net.sendSnap({ t: 'snap', s: Net.snapFor(game.world, p.idx, q) }, p.idx)) q.length = 0;
          }
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
        /* ---- AND THE ANCHOR IS JUDGED NOW, NOT AFTER THE SECOND TAP ----
         * Nothing looked at the first tap at all: you set an anchor on ground that could never
         * take a wall, aimed the far end, and only THEN learned the run was refused — and the
         * refusal kept the anchor, so the bad end was the one you were stuck with. Reported
         * from play. `placementError` has always answered exactly this question for a work with
         * a `span` — the ground, the writ, and whether a crew is free — and is the same door
         * the command goes through, so the anchor cannot be refused for a reason the run would
         * not be. A refusal leaves the WORK armed and takes no anchor, so the next tap is a
         * fresh first tap. What still waits for the second is the length and the crews: a point
         * cannot be too short or too long, and saying so would be a lie about a run that does
         * not exist yet. A guest holds no world; the host judges, as it does for everything. */
        if (game.world) {
          const bad = World.placementError(game.world, game.viewer, w.x, w.y, game.placing.bt);
          if (bad) { sayErr(bad); return; }
        }
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
     * Tapping one arms his standard, and the next tap is where they go.
     *
     * YOU GET WHAT YOU WERE POINTING AT. Men were asked FIRST and won outright, so a company
     * standing on a hall made that hall unopenable — no upgrade, no fork, no way to see what it
     * was — and the harder you pressed on the building the more certainly you armed the men.
     * Both are asked now and the NEARER one answers, which is what `hitUnit` always claimed to
     * do. A man at the door still gets you his standard; a finger on the roof gets you the
     * work. */
    const uAt = {}, bAt = {};
    const uco = Render.hitUnit ? Render.hitUnit(x, y, game.viewer, uAt) : 0;
    const bid = Render.hitBuilding(x, y, bAt);
    if (uco > 0 && !(bid >= 0 && bAt.d <= uAt.d)) {
      game.armedFlag = game.armedFlag === uco ? null : uco;
      /* the ring the renderer draws round the armed company, and the lit chip in the tray,
       * already say this — and say it for as long as it is true rather than for 3.4 seconds */
      return;
    }
    /* one of your own works first (they overlap everything), then sites, then bare ground */
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
    /* the LAN table is a screen now — ui.js calls `onLanOpen` when it comes up, and that is
     * registered with every other handler in UI.init below rather than bolted on here */
    lanOpened = paintNet;
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
          say('finding a route to this phone…');
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
        say('finding a route to this phone…');
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
      /* IF THE HOST HAS A WAR OPEN, THE TABLE FIGHTS IN IT. The country is never sent — a
       * guest regenerates it from the seed exactly as a board — and the war's history rides
       * the ordinary snapshots, because the host is authoritative and a snapshot is absolute.
       * A decided war is not dealt: the table gets a plain board instead. */
      const saved = REALM.load();
      const war = saved && !saved.done ? { seed: saved.seed } : null;
      for (const p of Net.peers)
        if (p.dc && p.dc.readyState === 'open') Net.send({ t: 'start', seed, seats, idx: p.idx, war }, p.idx);
      $('lan-start').classList.add('hidden');
      startMP(seed, seats, 0, war, war ? saved : null);
    });
    Net.onStart = (m) => startMP(m.seed, m.seats, m.idx, m.war || null);
    Net.onCmd = (c, from) => guestCmdQueue.push({ c, pi: from });
    /* a call for another match is only ever answered BETWEEN matches, by the host. Mid-match
     * it is stale — a message that crossed with the winning blow — and once the host has
     * dealt, `game.over` is false again, which is what stops two callers dealing two boards. */
    Net.onAgain = (from) => { if (game.mode === 'host' && game.over) rematch(from); };
    /* the host's true table, which supersedes whatever the fog let this seat see. It can
     * arrive a moment after the end screen is already up, so the screen is redrawn. */
    Net.onChron = (rows) => {
      if (game.mode !== 'guest' || !Rec.adopt(rows)) return;
      if (game.over) endScreen();
    };
    Net.onNoMore = () => {
      if (game.mode !== 'guest' || !game.over) return;
      game.noMore = true;
      UI.banner('An heir has left the table — pair again from the menu', 'warn');
      endScreen();
    };
    Net.onSnap = (s) => {
      const now = performance.now();
      if (snapAt) snapGap = snapGap * 0.7 + Math.max(50, Math.min(400, now - snapAt)) * 0.3;
      snapPrev = snapCur; snapCur = s; snapAt = now;
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

  /* the chapter list, with `focus` naming the one to open a briefing for straight away (which
   * is what the end screen's button wants: it has just named the next chapter) */
  function toChapters(focus) {
    game.over = false;
    game.mode = null; game.chapter = null; game.run = null;
    if (game.world) game.world = null;
    UI.objective(null);
    UI.toMenuScreens();
    UI.chapters(global.CAMPAIGN, focus);
    armBack(true);
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
      /* THE CAMPAIGN IS CHAPTERS NOW, not a rung counter. The button opens the list; the list
       * opens a briefing; the briefing begins the match. The objective is stated BEFORE the
       * board is, which is what makes a varied objective legible rather than confusing. */
      onCampaign: () => toChapters(null),
      onChapter: (key) => { startChapter(key); },
      onLanOpen: () => { if (lanOpened) lanOpened(); },
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
      /* ---------------- THE LONG WAR ----------------
       * game.js holds a realm for the length of a war exactly as it holds a `CAMPAIGN.run` for
       * the length of a chapter: the layer above answers questions and never writes to a world,
       * and going down into a region is an ordinary single-player match with the region's rules.
       * Nothing below this line knows the country exists. */
      /* THE LONG WAR IS ONE TAP DEEP NOW. The card resumes the saved war or begins one — no
       * map screen between the menu and the ground, because the ground IS the map. A saved
       * war that would not load (an old version's, a torn record) begins anew and says so. */
      onRealm: () => {
        let realm = REALM.load();
        /* a DECIDED war is not resumed — the record kept `done` so this door can know */
        if (realm && realm.done) { REALM.forget(); realm = null; }
        if (!realm) {
          realm = REALM.create((Math.random() * 0xffffffff) >>> 0);
          if (REALM.lost) UI.banner('The old war is lost to a new age — a new one begins', 'warn');
        }
        startRealm(realm);
      },
      onRealmNew: () => {
        REALM.forget();
        startRealm(REALM.create((Math.random() * 0xffffffff) >>> 0));
      },
      /* TERMS. The chip sets MY offer and nothing else — a pact is the two of them standing, so
       * the order says what I want and the sim works out whether that seals or breaks anything.
       * Asking for a STATE rather than a toggle, like the halt and the flip: read the offer off
       * the picture the player is actually looking at, so a tap on a stale frame cannot invert
       * an order the other seat has already changed. */
      onTerms: (p) => {
        if (game.over) return;
        const view = game.mode === 'guest' ? snapCur : game.world;
        const me = view && view.players[game.viewer];
        issue({ c: 'pact', p, on: !(me && me.offers && me.offers[p]) });
      },
      /* the run's sheltered face, turned over. It asks for a STATE rather than a toggle for the
       * same reason the halt does: two seats tapping it at once must not cancel each other. */
      onFlip: (id) => {
        const view = game.mode === 'guest' ? snapCur : game.world;
        const b = view && (view.players[game.viewer].buildings || []).find((q) => q.id === id);
        issue({ c: 'flip', id, on: !(b && b.flip) });
      },
      onBuild: (x, y, bt, co) => issue({ c: 'build', x, y, bt, co }),
      onBuildMenu: () => {
        if (game.over) return;
        if (game.placing) { clearPlacing(); return; }   // the button un-arms; that is the answer
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

        game.armedFlag = game.armedFlag === id ? null : id;   // the chip lights; that is the caption
      },
      /* NO PER-COMPANY HOLD BUTTON. It sat beside the armed flag and was the only way to
       * un-post one company; taken out of the bar on the owner's call to keep the row for
       * the flag and its roster. The order it sent, if it is ever wanted again anywhere, is
       * `{ c: 'rally', co, site: -1 }` — a rally with nowhere to go clears the standard. */
      onAssign: (id, co) => issue({ c: 'assign', id, co }),
      onRecall: () => {
        const view = game.mode === 'guest' ? (snapCur && guestView()) : hostView();
        if (!view) return;
        /* THE RECALL is the one thing the gold flag was genuinely good for, so it survives as
         * a button rather than a flag: one order that strikes every standing standard and
         * turns the whole army for home. `banner` is still that command — it simply has no
         * chip in the tray any more. */
        issue({ c: 'banner', site: view.map.cities[game.viewer] });
      },
      onMuster: (pause) => issue({ c: 'muster', pause }),
      onMusterCo: (co, pause) => issue({ c: 'muster', co, pause }),
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
          /* a chapter names its own next thing — the one after it, or itself again */
          if (game.endNextKey) { const k = game.endNextKey; toChapters(k); return; }
          if (game.chapter) { toChapters(null); return; }
          /* a WAR decided is a war finished: another go is a new country, not a rematch on
           * the corpse of the old one */
          if (game.war) {
            game.war = false;
            REALM.forget();
            startRealm(REALM.create((Math.random() * 0xffffffff) >>> 0));
            return;
          }
          if (game.campaign) {
            if (done()) { try { localStorage.setItem('amber_rung', '0'); } catch (e) {} }
            startSP(LADDER[Math.min(rung(), LADDER.length - 1)], C.DIFFICULTY[UI.difficulty()], true);
          } else startSP(game.bot.kind, C.DIFFICULTY[UI.difficulty()], false);
        } else if (game.mode === 'host') rematch();
        else if (game.mode === 'guest') callAgain();
        else toMenu();
      },
      onEndMenu: toMenu,
      /* the chapter screen closing with nothing chosen: show the menu it sits over */
      onMenuAgain: () => UI.showMenu(campaignLabel(), campaignNote()),
      /* the codex opens over the menu, where nothing has armed the back button */
      onRollOpen: () => armBack(true)
    });
    const cvs = $('game');
    cvs.addEventListener('pointerdown', onDown);
    cvs.addEventListener('pointermove', onMove);
    cvs.addEventListener('pointerup', onUp);
    cvs.addEventListener('pointercancel', onUp);
    cvs.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('popstate', onPopState);
    /* the door the app actually dies through most often: the OS swipe. The war saves as the
     * page goes dark, beside the heartbeat save and the ones on every polite exit. */
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveWar(); });
    /* kill the synthetic mouse click that follows a touch — it lands on whatever
     * sheet just opened under the finger and 'chooses' a card the player never tapped */
    cvs.addEventListener('touchend', (e) => e.preventDefault(), { passive: false });
    setupLan();
    setupPWA();
    $('version').textContent = 'v' + (global.GAME_VERSION || '?');
    UI.showMenu(campaignLabel(), campaignNote());
    /* ---- THE REACH DEV BOOT (?reach=SEED) ----
     * Not a mode: a rig. One country, the viewer at seat 0, a marcher on every other seat,
     * the war's rules on. It exists so the reach can be FELT before the realm ships, and so
     * the browser suite can drive a country through the real renderer. It is reached only by
     * typing the query, exactly as the old 2D renderer's `?r=2d` was. */
    const dev = new URLSearchParams(location.search).get('reach');
    if (dev != null) startSP('marcher', {
      seed: (parseInt(dev, 10) || 1) >>> 0, country: true,
      rules: { reach: 1, occupy: 1, endOnSeat: 0, truce: 1 }
    });
    requestAnimationFrame((t2) => { lastFrame = t2; requestAnimationFrame(frame); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* LADDER is exported so the suite can ask which rung is FIRST rather than be told a name:
   * the order is measured, and it is expected to move when the heirs do. */
  /* test handle: the banner router. What an alert SAYS is a decision made here, out of an
   * event and the viewer's own map, and there is no other way to ask it — driving a real
   * assault to make one line appear takes a minute of match and proves less. */
  global.__routeEvents = routeEvents;
  global.Game = { game, startSP, startMP, startChapter, toChapters, toMenu, LADDER };
})(typeof window !== 'undefined' ? window : globalThis);

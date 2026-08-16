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
  /* ---- IS THE LINK STILL THERE? ----
   * A datachannel that CLOSES says so, and that case was always handled. A host whose tab is
   * killed, whose battery dies or whose Wi-Fi drops says nothing whatever: the close never
   * arrives, and the guest went on drawing the last snapshot — men sliding smoothly to the
   * ends of their velocities, HUD frozen at whatever it last read, taps going into a channel
   * nobody is listening on — indefinitely, with nothing on screen admitting it. Silence is
   * therefore read as what it is. QUIET is long enough that a bad moment on the Wi-Fi does not
   * cry wolf (snapshots come ten a second, so it is thirty missed); DEAD is long enough that a
   * host who backgrounds his phone to answer a message can still come back. */
  const LINK = { quiet: 3, dead: 10 };
  let linkLost = null, quietSaid = false, leaving = 0;
  let endArmed = 0;   // when the host was last warned that back ends the table — see onPopState
  /* THE ORDER JUST GIVEN, and the window in which repeating it means it literally. `px` is
   * generous because a thumb does not land twice on the same pixel and the two taps are meant
   * to be the SAME order, not two different ones; `ms` is long enough to be deliberate and
   * short enough that an unrelated second order a moment later is never mistaken for it. */
  const DOUBLE = { ms: 450, px: 48 };
  let twice = null;   // { co, where, sx, sy, at }

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
    /* THE HELM: the player's government of the war. `orders[lord]` is the standing
     * instruction each sworn lord runs under, and `hand` is which of his courts the player is
     * driving himself. Neither is sim state — an order only makes a lord issue the ordinary
     * commands a hand on the screen could have issued — so it lives here and rides the save. */
    realm.helm = realm.helm || { orders: {}, hand: 0 };
    realm.helm.orders = realm.helm.orders || {};
    if (realm.helm.hand == null) realm.helm.hand = 0;
    game.mode = 'sp'; game.viewer = 0; game.campaign = false; game.over = false;
    game.chapter = null;
    game.war = true;
    /* the war is polled where a chapter is polled — same shape, same door out */
    game.run = REALM.run(realm);
    if (Render.clearSeatFalls) Render.clearSeatFalls();
    game.world = realm.world;
    game.bot = warBot(game.world, 1);
    game.bots = game.world.players.map((_, i) => (i === 0 ? null : warBot(game.world, i)));
    warPurses(game.world, game.bots);
    game.names = game.world.players.map((_, i) => warName(game.world, i));
    UI.names = game.names;   // the HUD's chips and walkers wear the same names
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
  /* ---- EVERY SEAT IN A WAR IS AN HEIR ----
   * A country used to run one 181-line baseline on all sixteen seats whose whole vocabulary was
   * rally/build/walk, while five heirs with years of doctrine sat unused — because an heir moves
   * its army with `{c:'banner'}` and the reach law has no banner, so an heir in a country was
   * mute rather than wrong (see `warOrders` in ai.js, which translates the word).
   * Now: a CONTENDER (`world.heirs`) is a full-strength heir, and every other lord is the same
   * heir under `CONST.MINOR` — poorer, slower, noisier, and playing the same game. That is what
   * "a minor lord is a weaker heir" means, and it is the same mechanism the classical game's
   * footing already uses. The temperament is chosen by SEAT so the same court always fields the
   * same character, on every machine and across a save, without a byte of state saying so. */
  /* ---- AND THE FOOTING SCALES THE WHOLE COUNTRY ----
   * The picker says "how hard the heirs play" and a war did not read it: a contender got `{}` —
   * no handicap whatever, which is harder than PRINCE — and every other lord got a fixed
   * `CONST.MINOR`, so SQUIRE and PRINCE dealt the same opposition. Worse, `startRealm` stamped
   * the chosen footing into the CHRONICLE, so a war's record named a setting nothing in it had
   * read; that is the dead-control failure landing on the one instrument used to diagnose
   * reports from play.
   * A contender now plays at the player's footing, and a minor lord at that footing made worse
   * by `CONST.MINOR` — which is what "a minor lord is a weaker heir" already meant, now said
   * relative to the footing instead of instead of it. The composition is per field and each
   * follows what the field IS:
   *   `slow`  — a think-interval multiplier, so the two multiply;
   *   `noise` — the chance of skipping a think, so the WORSE of the two rather than both: they
   *             are the same penalty said twice, and stacking them double-charges one axis;
   *   `eco`   — an income fraction, so the two multiply;
   *   `hold`  — the footing's own, untouched. It is a promise to the PLAYER about his own
   *             ground and there is nothing for a minor lord to add to it.
   * THE TOP OF THE RANGE IS TODAY'S WAR, which is what makes the change auditable: at PRINCE a
   * contender is slow 1.0 / eco 0.96 against today's 1.0 / 1.0, and a minor lord is slow 1.5,
   * noise 0.20, eco 0.60 against today's 1.5, 0.20, 0.62. Everything softer scales down from a
   * war that has already been measured. */
  /* what a seat's footing IS, as plain numbers — one answer, because the BOT is made from it
   * and the purse is written from it and the two must not drift. `eco` is not an AI option at
   * all: it is `players[pi].eco`, read by the sim's income pass, so the caller writes it. */
  function warFooting(world, pi) {
    /* `hold` is a promise about the PLAYER's ground, and in a country a lord's nearest rival
     * court is usually another lord's — so it is aimed at the viewer's banner rather than at
     * whoever happens to be nearest. Without that an easy footing stops the whole country
     * making war on itself, which is a duller war and not an easier one. */
    const foot = Object.assign({ holdOn: World.realmOf(world, game.viewer) },
                               C.DIFFICULTY[UI.difficulty()] || {});
    if ((world.heirs || []).indexOf(pi) >= 0) return Object.assign({}, foot);
    const m = C.MINOR;
    return Object.assign({}, foot, {
      slow: (foot.slow || 1) * m.slow,
      noise: Math.max(foot.noise || 0, m.noise),
      eco: (foot.eco != null ? foot.eco : 1) * m.eco
    });
  }
  function warKind(pi) {
    const kinds = Object.keys(AI.HEIRS);
    return kinds[pi % kinds.length];
  }
  function warBot(world, pi) {
    return AI.make(warKind(pi), warFooting(world, pi));
  }
  /* ---- A LORD IS NAMED FOR HIS CITY; AN HEIR IS NAMED FOR HIMSELF ----
   * A country named every seat after its court, so a contender — the two rivals who can
   * actually win the war — was indistinguishable from the fifteen lords who cannot, and a
   * court's row read "KASHFA — KASHFA's". A minor lord IS his city, which is why that name
   * suits him; an heir is a person who happens to hold one, and his own name is the thing that
   * says "this one is playing for the throne". Seat 0 is the player.
   * The heir's name comes off the doctrine he is actually running (`warKind`), so it can never
   * disagree with the brain in the seat. */
  function warName(world, pi) {
    if (pi === 0) return 'Corwin';
    const city = world.cities && world.cities[pi] && world.map.sites[world.cities[pi].site].name;
    if ((world.heirs || []).indexOf(pi) < 0) return city || 'a lord of Shadow';
    const k = warKind(pi);
    return k.charAt(0).toUpperCase() + k.slice(1).toUpperCase();
  }
  /* THE PURSE IS PART OF THE FOOTING and it lives on the world, so it is dealt where the bots
   * are — every AI seat, and never the player's own. Written once at the start of a war and
   * again when a seat is adopted, which are the only two moments a seat gains a driver. */
  function warPurses(world, bots) {
    for (let i = 0; i < world.players.length; i++)
      world.players[i].eco = bots && bots[i] ? (warFooting(world, i).eco || 1) : 1;
  }

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
      /* A RIG THAT SEATS A DOCTRINE THE GAME DOES NOT USE MISLEADS THE PERSON USING IT. The
       * `?reach=` boot exists so a country can be watched through the real renderer, so it
       * seats the country exactly as a war does — contenders and minor lords — rather than the
       * marchers it was given before heirs could speak in a war at all. */
      game.bots = game.world.players.map((_, i) => (i === 0 ? null : warBot(game.world, i)));
    /* the handicap is the heir's, not the board's: it plays its own game, only poorer. A COUNTRY
     * deals every AI seat its own (`warPurses`), so the duel's single line would overwrite one
     * seat of sixteen with the wrong number. */
    if (game.bots) warPurses(game.world, game.bots);
    else game.world.players[1].eco = (opts && opts.eco) || 1;
    /* a kind may be an heir or a baseline (the reach rig runs marchers) — both carry a title */
    const kindTitle = (AI.HEIRS[kind] && AI.HEIRS[kind].title) ||
                      (AI.BASELINES && AI.BASELINES[kind] && AI.BASELINES[kind].title) || 'a lord';
    /* at a country's table every seat is named by ITS CITY — ten seats sharing one heir's
     * name would make every banner a riddle */
    game.names = game.bots
      ? game.world.players.map((_, i) => warName(game.world, i))
      : ['Corwin', kindTitle];
    UI.names = game.names;   // the HUD's chips and walkers wear the same names
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
      /* A GUEST IS IN THE WAR TOO. `game.war` was set inside the HOST arm only, so on a guest
       * every reader of it answered "this is an ordinary match": no ⚑ chip, no council, and
       * therefore — on 8000x9600, where a court cannot be found by dragging — no way to reach
       * his own capital at all. It is the CLIENT's word for "the match I am in is a war",
       * which is as true on a guest as on a host; the two things that are the host's alone
       * are `game.realm` and `game.run`, and every writer of state guards on those (saveWar,
       * hand, the REALM.save ticks), not on this. */
      game.war = true;
      if (Net.isHost) {
        /* the host plays HIS OWN saved war, guests and all — putting it down still saves it */
        game.realm = savedRealm;
        game.run = REALM.run(savedRealm);
        game.world = savedRealm.world;
        /* the seats nobody human took are played exactly as a solo war's are */
        game.bots = game.world.players.map((_, i) => (i >= n ? warBot(game.world, i) : null));
        warPurses(game.world, game.bots);   // a seat a human holds keeps a full purse
      } else {
        /* a guest builds the same country from the seed alone — geometry, never history */
        game.world = null;
        refWorld = REALM.create(war.seed).world;
      }
      const geo = Net.isHost ? game.world : refWorld;
      /* the humans at the table keep their own seat names; every seat the host plays is named
       * the way a solo war names it — a lord for his city, a contender for himself */
      game.names = geo.players.map((_, i) =>
        i < n ? (C.SEAT_NAMES[i] || 'an heir') : warName(geo, i));
    } else {
      game.names = C.SEAT_NAMES.slice(0, n);
      const build = () => World.createWorld(seed, n);
      game.world = Net.isHost ? build() : null;
      refWorld = Net.isHost ? null : build();   // guest: map geometry only
    }
    UI.names = game.names;   // the HUD's chips and walkers wear the same names
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
    /* THE COUNCIL IS A PLACE YOU GO, so back is the way out of it — and it is peeled FIRST
     * because it is a panel over everything else, including a sheet that may still be open
     * underneath it. It returns to the MATCH and not to the menu: the war is still running
     * behind it, and a back press that walked out of the war because the player had the
     * council open would be the worst possible reading of the gesture. */
    /* ...and the COURT opened from its map is one layer above the council, so it peels first.
     * Without this a back press meant for the pop-up shut the whole panel and took the map
     * with it, which is the gesture reading two steps at once. */
    if (UI.courtPopOpen && UI.courtPopOpen()) { UI.courtPopClose(); armBack(); return; }
    if (UI.councilOpen && UI.councilOpen()) { UI.councilClose(); armBack(); return; }
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
    /* LEAVING A LAN MATCH ENDS IT FOR TWO TO FOUR PEOPLE, and it cannot be undone — the host
     * is the only machine holding a world. Everywhere else back is free and instant and must
     * stay so, which rules out a modal: the phone's own idiom is the answer, where the first
     * press SAYS what the second one will do. Only the host, only mid-match, and only with
     * somebody actually seated — alone at the table there is nobody to end it for. */
    if (game.mode === 'host' && !game.over && Net.active && Net.seated() > 1) {
      const now = performance.now();
      if (now - endArmed > 3000) {
        endArmed = now;
        UI.banner('Leaving ends the table for everyone — press back again to end it', 'warn');
        armBack(); return;
      }
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

  /* ---------------- the table is over, and there is nothing to carry on with ----------------
   * HOST MIGRATION IS NOT ON THE TABLE, and that is a design answer rather than a missing
   * feature: only the host holds a world, a guest holds fog-filtered snapshots of it, so there
   * is genuinely nothing on this phone to continue from. Handing the match on would mean
   * shipping a whole world across a link that has just proved unreliable. So a guest whose
   * host has gone is told plainly and taken back to the menu with its chronicle intact. */
  function endTable(why) {
    if (game.mode !== 'guest' || leaving) return;
    UI.banner(why, 'warn');
    /* IN A WAR THE COUNTRY IS THE HOST'S SAVE. A guest rebuilds the ground from the seed and
     * holds no realm of his own, so the evening's conquests live on the host's phone — and
     * dropping him at a menu offering a brand new war, with no word about it, reads as the
     * whole war being gone. */
    if (game.war) UI.banner('The war is the host’s to keep — pair again and it stands where it stood', 'warn');
    /* on the end screen nobody is mid-match: the link was only ever the offer of a rematch */
    if (game.over) { endScreen(); return; }
    leaving = setTimeout(() => { leaving = 0; toMenu(); }, 2500);
  }

  /* THE SEAT AN HEIR WALKED OUT OF, HANDED TO A BRAIN. Only the host may do this — it is the
   * only machine holding a world to drive — and only mid-match. `game.bots[i]` is null on
   * every seat a HUMAN holds, which is exactly what makes this a one-line change: filling in
   * the departed index is the same statement the war already makes about the seats nobody
   * claimed. Returns whether it adopted, so the caller does not banner twice about one event. */
  function adoptSeat(seat) {
    const w = game.world;
    if (game.mode !== 'host' || game.over || !w) return false;
    if (seat == null || seat < 1 || seat >= game.seats) return false;
    if (game.bots && game.bots[seat]) return false;              // already driven
    /* a war's unclaimed seats are played by heirs, so a war's DESERTED one is played the same
     * way — `warBot` answers contender-or-minor for that seat. On a board it is a full heir,
     * chosen by the seat so the same seat always gets the same one. */
    const heirs = Object.keys(AI.HEIRS);
    if (!game.bots) game.bots = w.players.map(() => null);
    game.bots[seat] = game.war ? warBot(w, seat) : AI.make(heirs[seat % heirs.length], {});
    /* he was a human a moment ago and had a full purse; now he is a driver and takes its
     * footing, the same as every other AI seat at this table */
    if (game.war) warPurses(w, game.bots);
    UI.banner(seatName(seat) + ' has left the table — a shadow of him fights on', 'warn');
    return true;
  }

  /* SILENCE IS A STATE, AND THIS IS WHERE IT IS READ. The men freeze on their own once the gap
   * passes `snapGap` (the interpolation alpha saturates at 1), so what was missing was never
   * the stillness but the WORD for it. Said once, and taken back the instant a snapshot lands
   * — `onSnap` clears both flags, so a host who was merely in a tunnel comes back without the
   * player ever leaving the match.
   * It is a FUNCTION rather than a few lines in the frame because it is the one rule in the
   * client that reads a wall clock, and a rule that reads a wall clock cannot be tested by
   * pacing frames: on a loaded box two `requestAnimationFrame`s can take longer than
   * `LINK.quiet` all by themselves, so the rig raced the rule and lost — the control failed,
   * the table ended for no reason, and a stray `leaving` timer walked into the next suite.
   * Called once per frame; also called directly, with the clock set, by the suite. */
  function linkCheck() {
    if (game.mode !== 'guest' || !snapCur || game.over || linkLost === 'bye') return null;
    const quiet = (performance.now() - snapAt) / 1000;
    if (quiet > LINK.dead) {
      endTable('The link to the host is gone — the match is ended');
      return 'dead';
    }
    if (quiet > LINK.quiet) {
      if (!quietSaid) {
        quietSaid = true; linkLost = 'quiet';
        UI.banner('The link has gone quiet — waiting for the host', 'warn');
      }
      return 'quiet';
    }
    return null;
  }

  function toMenu() {
    /* THE WAR IS PUT DOWN, NOT THROWN AWAY — walking out is how an evening ends, so the save
     * rides the same door as every other way out. */
    saveWar();
    if (leaving) { clearTimeout(leaving); leaving = 0; }
    linkLost = null; quietSaid = false; endArmed = 0;
    game.war = false;
    /* a match walked out of never reaches the end screen, and it is often the one worth
     * sending — close the chronicle here so the menu can still offer it */
    if (Rec.on && !game.over) {
      Rec.end(undefined, null, game.world ? Rec.fromWorld(game.world)
                             : snapCur ? Rec.fromSnap(snapCur, game.viewer) : null);
    }
    game.mode = null; game.world = null; game.over = false;
    if (Render.lookAt) Render._homed = false;
    /* walking out of a LAN match ends it for everyone else at the table — say so on the way
     * out, so the other phones can tell a heir leaving from a link dying */
    if (Net.active) { Net.bye(); Net.close(); }
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
    /* ---- A DECIDED WAR IS REMEMBERED AS DECIDED, WHOEVER DECIDED IT ----
     * `realm.done` was written in one place only: where `run.tick` answers. But a war ends
     * through the SIM as often as through its run — a Seat toppling, or `holdCities` finding
     * one banner left holding ground — and neither of those ever asks `tick`. So a war won by
     * force was saved as an UNDECIDED one, `onRealm`'s "a decided war is not resumed" check
     * never fired, and the menu handed the player back the country he had already won: measured,
     * pressing the war button after a decided match resumed the same seed rather than dealing a
     * new one, and its run re-declared the ending on the spot. Reported from play as the end
     * screen of the previous game appearing instead of a new war.
     * Marked HERE because this is the one choke point every ending passes through, host and
     * guest and objective and throne alike — the same argument the seat-fall hold above makes.
     * It never overwrites an answer `tick` already gave, which is the more specific one. */
    if (game.war && game.realm) {
      if (!game.realm.done) game.realm.done = won ? 'won' : 'lost';
      REALM.save(game.realm);
    }
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
  /* ---------------- WHOSE HAND IS ON THE ORDER ----------------
   * `game.viewer` is the seat this client plays — its fog, its camera, its banner. `hand()` is
   * the LORD whose city the taps are currently driving, which in a war may be one of his sworn
   * lords instead: you govern a realm and you hand-play exactly one of its courts, and the
   * build sheet, the flag tray, the essence chip and every order below belong to that one.
   * It is never anybody else's lord — a stale `helm.hand` left over from a court that has
   * since been taken back falls straight home rather than issuing orders into thin air. */
  /* THE HELM IS THE CLIENT'S, AND A GUEST HAS ONE TOO. Which of his courts the player is
   * hand-playing is a choice about whose taps these are — it changes nothing in the world,
   * which is why it has never been a command. It rode on the realm because the realm is what
   * gets SAVED; a guest holds no realm and may still hold sworn lords (a conquest swears them,
   * and `issue` already carries the lord an order is FOR, which the host vets against the seat
   * it arrived on). So the helm lives here when there is nothing to save it in. `hand: null`
   * is "my own seat", which is what `hand()` has always made of a missing one. */
  function helm() {
    if (game.realm) return (game.realm.helm = game.realm.helm || { orders: {}, hand: 0 });
    return (game.helm = game.helm || { orders: {}, hand: null });
  }
  function hand() {
    const w = game.world || refWorld;
    const h = helm().hand;
    if (h == null || !w || !w.players || !w.players[h]) return game.viewer;
    return World.realmOf(w, h) === World.realmOf(w, game.viewer) ? h : game.viewer;
  }
  /* named for the reader as well as the caller: `game.handOf()` is the LORD, `helm.hand` is
   * the city index it was chosen from. Exported so a suite can ask whose hand is on the game. */
  game.handOf = hand;
  function issue(cmd) {
    if (game.mode === 'guest') {
      /* the lord this order is FOR rides with it: the host checks he is of the sender's realm
       * before applying it, exactly as it checks everything else a guest asks for */
      Net.send({ t: 'cmd', c: cmd, as: hand() });
      Rec.command(cmd, refWorld && snapCur ? { t: snapCur.t, map: refWorld.map } : null);
      return { ok: true };
    }
    const r = World.applyCommand(game.world, hand(), cmd);
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
     * The rules the reach adds to an ORDER, and they must SPEAK: a company that will not
     * march reads as a bug, not a border, unless the border says its name — the prototype's
     * own first finding. (There was a third, `refused`, for a court that would not swear past
     * the lord allowance. The allowance is gone: what you break and hold, you keep.) */
    reach: 'Beyond that company’s reach — take a city nearer to it',
    city: 'That hall stands outside the city’s reach — only overlapping reaches share halls'
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

  /* ---------------- ⚑ THE WAR COUNCIL ----------------
   * Everything about a war that is true for MINUTES rather than happening now: what your banner
   * holds, how each of its courts is faring, what its lord is under orders to do, and who you
   * are at terms with. It was being shouted from the corner of the map — a two-line status box
   * and a stack of chips, on a screen that already had nine things on it — and the two ran into
   * each other. This is the same state, given a screen.
   * `councilData` reads the VIEW, so it is fogged exactly as everything else is: a court you
   * have never laid eyes on is not in the list. */
  function warView() { return game.mode === 'guest' ? (snapCur && guestView()) : (game.world && hostView()); }
  /* the one question the chip's dot answers: is anything actually waiting on me. Four things
   * are, and none of them is "you are at war", which is the default state and therefore not
   * news — see the banner rule in CLAUDE.md. */
  function warWants(view) {
    if (!view || !view.cities) return false;
    const me = World.realmOf(view, game.viewer);
    const mine = view.cities.filter((c) => c.owner >= 0 && World.realmOf(view, c.owner) === me);
    /* a rival has asked terms and I have not answered */
    const myOffers = (view.players[me] || {}).offers || [];
    for (let pi = 0; pi < view.players.length; pi++) {
      if (World.realmOf(view, pi) !== pi || pi === me) continue;
      if (((view.players[pi].offers || [])[me]) && !myOffers[pi]) return true;
    }
    /* a court of mine is hurt, or one lies yielded for anyone to walk into */
    if (mine.some((c) => c.hp < c.maxHp * 0.98)) return true;
    if (view.cities.some((c) => c.owner < 0 && !c.razed)) return true;
    /* a lord of mine has no standing order — he is running on his own judgement */
    const orders = (game.realm && game.realm.helm && game.realm.helm.orders) || {};
    return mine.some((c) => c.owner !== hand() && !orders[c.owner]);
  }
  function warChip() {
    const view = warView();
    if (!view || !view.cities) return null;
    const me = World.realmOf(view, game.viewer);
    const held = view.cities.filter((c) => c.owner >= 0 && World.realmOf(view, c.owner) === me).length;
    return { held, all: view.cities.filter((c) => !c.razed).length, wants: warWants(view) };
  }
  const ORDERS = [{ mode: 'hold', label: 'HOLD' }, { mode: 'gates', label: 'GATES' },
                  { mode: 'walls', label: 'WALL UP' }];
  function councilData() {
    const view = warView();
    if (!view || !view.cities) return null;
    const me = World.realmOf(view, game.viewer);
    const ours = (pi) => pi >= 0 && World.realmOf(view, pi) === me;
    const hex = (n) => '#' + n.toString(16).padStart(6, '0');
    const tint = (pi) => hex(Render.tintOf ? Render.tintOf(pi, game.viewer) : C.SEAT_TINT[0]);
    const orders = (game.realm && game.realm.helm && game.realm.helm.orders) || {};
    /* ---- A COURT IS PUBLIC, AND THE COUNCIL MAY NOT INVENT A FOG THE SIM DOES NOT HAVE ----
     * `world.cities` — where every court stands, and WHOSE it is — rides to everyone, on the
     * host's own view and on the wire alike, because in a country "whose is that" IS the map
     * (see `Net.snapFor`). The council nonetheless hid every row behind having laid eyes on the
     * site, first through `players[viewer].explored` and then through `view.sites`. On a board
     * that was invisible; on 8000x9600 it is the whole feature: measured two minutes into a war,
     * fifteen standing banners all holding ground and the council offered terms to NONE of
     * them, because the heir had seen one court of sixteen and may never see another.
     * Reported from play as the council showing no enemies and terms being impossible to offer.
     * What is fogged is where the ARMIES are, and that has not changed. */
    let income = 0, men = 0, crews = 0, free = 0, pattern = null;
    for (let pi = 0; pi < view.players.length; pi++) {
      if (!ours(pi)) continue;
      const p = view.players[pi];
      income += (p.incomeRate || 0) - (p.drainRate || 0);
      /* the crews off the VIEW as well: `World.masons` counts a heir's own Gates, which ride
       * in full for everyone of your own banner, so a guest can answer this for himself */
      crews += World.masons(view, pi);
      free += Math.max(0, World.masons(view, pi) - World.rising(view, pi));
      if (p.pattern > 0) pattern = '✴ ' + Math.round(p.pattern) + '% of the Pattern is walked in your name';
    }
    for (const u of view.units) if (ours(u.owner)) men++;
    const cities = [];
    for (let ci = 0; ci < view.cities.length; ci++) {
      const c = view.cities[ci];
      /* every court of the country is on the roster: it is public, and a war you cannot see
       * the shape of is a war you cannot play */
      const mineC = ours(c.owner);
      const lordIdx = c.owner;
      const nm = view.map.sites[c.site].name || 'a Seat of Power';
      const sub = [];
      if (c.razed) sub.push('thrown down — nothing left of it');
      else if (c.owner < 0) sub.push('YIELDED — hold the court and it swears');
      else {
        const p = view.players[c.owner];
        if (mineC) {
          const rate = (p.incomeRate || 0) - (p.drainRate || 0);
          sub.push((rate >= 0 ? '+' : '') + rate.toFixed(1) + '/s');
          sub.push(view.units.filter((u) => u.owner === c.owner).length + ' men');
          const o = orders[c.owner];
          /* the court your own hand is on needs no order: your taps ARE the order, and telling
           * a player his own capital has "no standing order" is telling him off for playing */
          if (c.owner !== hand()) {
            sub.push(!o ? 'no standing order'
              : o.mode === 'attack' ? 'ordered against ' + ((view.cities[o.target] && view.map.sites[view.cities[o.target].site].name) || 'a court')
              : o.mode === 'support' ? 'ordered to support ' + ((view.cities[o.target] && view.map.sites[view.cities[o.target].site].name) || 'a court')
              : 'ordered to ' + o.mode);
          }
        } else {
          /* A COURT DOES NOT NEED TO SAY ITS OWN NAME BACK. In a country a lord is NAMED for his
           * city, so a rival court's row read "KASHFA — KASHFA's", and with the banner strip now
           * under it that was the same word three times. What is worth saying is the thing the
           * row cannot show on its own: whose banner he answers to, when it is not his own. */
          const rl = World.realmOf(view, c.owner);
          if (rl !== c.owner) sub.push('sworn to ' + seatName(rl));
        }
      }
      const nbrs = ((view.map.gen.nbrs && view.map.gen.nbrs[ci]) || [])
        .filter((i) => view.cities[i] && !ours(view.cities[i].owner) && !view.cities[i].razed)
        .slice(0, 2)
        .map((i) => ({ mode: 'attack', target: i, label: '⚔ ' + (view.map.sites[view.cities[i].site].name || 'a court'),
                       on: orders[lordIdx] && orders[lordIdx].mode === 'attack' && orders[lordIdx].target === i }));
      cities.push({
        idx: ci, lordIdx, name: nm, mine: mineC, hand: c.owner === hand(),
        /* WHOSE BANNER THIS COURT IS UNDER — the key the roster is grouped by. -1 is a court
         * with no lord at all (yielded, or thrown down), which belongs to nobody's banner. */
        realm: c.owner >= 0 ? World.realmOf(view, c.owner) : -1,
        tint: c.owner < 0 ? hex(C.NEUTRAL_TINT) : tint(c.owner),
        lord: c.owner < 0 ? 'no lord' : (mineC ? (c.owner === hand() ? 'your own hand' : 'sworn to you') : ''),
        sub: sub.join(' · '),
        hp: c.razed ? null : Math.max(0, c.hp / (c.maxHp || C.CASTLE_HP)),
        /* A STANDING ORDER IS THE HOST'S TO KEEP. It is a parameter to the lord's own doctrine
         * and the doctrines are STEPPED on the host, so an order set on a guest would sit in a
         * helm nothing ever reads — a row of buttons that promise a thing that cannot happen,
         * which is exactly what the end screen's dead ANOTHER MATCH button was. A guest's rows
         * still carry him to the court and still hand him the command of it; they simply do
         * not offer what only a host can honour. */
        orders: game.realm
          ? ORDERS.map((o) => ({ ...o, on: orders[lordIdx] && orders[lordIdx].mode === o.mode })).concat(nbrs)
          : []
      });
    }
    /* yours first, then the rest by name, so the list opens on what you are responsible for */
    cities.sort((a2, b2) => (b2.mine - a2.mine) || (b2.hand - a2.hand) || a2.name.localeCompare(b2.name));
    const terms = [];
    if (view.rules && view.rules.truce) {
      const myOffers = (view.players[me] || {}).offers || [];
      for (let pi = 0; pi < view.players.length; pi++) {
        if (World.realmOf(view, pi) !== pi || pi === me || view.players[pi].out) continue;
        const held2 = view.cities.filter((c) => c.owner >= 0 && World.realmOf(view, c.owner) === pi);
        const holds = held2.length;
        if (!holds) continue;
        const his = !!((view.players[pi].offers || [])[me]), mine2 = !!myOffers[pi];
        /* EVERY STANDING BANNER MAY BE TREATED WITH. Hiding one until you had laid eyes on a
         * court of his was meant to keep fifteen identical rows out of the panel; what it
         * actually did was make terms unreachable on a country you cannot walk across. The
         * noise is a PRESENTATION problem and it is solved by sorting and by the map, never by
         * withholding a thing the sim publishes. */
        terms.push({
          idx: pi, name: seatName(pi), tint: tint(pi), n: holds,
          holds: holds + (holds === 1 ? ' city' : ' cities'),
          state: mine2 && his ? 'sealed' : his ? 'asked' : mine2 ? 'offered' : 'war',
          say: mine2 && his ? '⚑ at terms — tap to break'
             : his ? 'asks for terms — tap to accept'
             : mine2 ? 'your offer stands — tap to withdraw' : 'at war — tap to offer',
          /* THE SAME THING AS A BUTTON. The roster is one list now and terms are a button under
           * a court, so the state needs a label in the imperative — "tap to offer" reads as an
           * instruction on a row and as a stutter on a button that is already tappable. */
          act: mine2 && his ? '⚑ BREAK TERMS' : his ? '⚑ ACCEPT TERMS'
             : mine2 ? '⚑ WITHDRAW OFFER' : '⚑ OFFER TERMS'
        });
      }
    }
    /* WHAT IS WAITING ON YOU, THEN WHAT IS BIGGEST. A country seats sixteen, so the panel is
     * long and the order is what makes it readable: a banner ASKING for terms is a thing
     * waiting on an answer and goes first, then one you are at terms with (the only row that
     * can be broken), then your own offer standing, then everyone else by how much of the
     * country they hold — which is the honest reading of who is worth treating with. */
    const RANK = { asked: 0, sealed: 1, offered: 2, war: 3 };
    terms.sort((a2, b2) => (RANK[a2.state] - RANK[b2.state]) || (b2.n - a2.n) ||
                           a2.name.localeCompare(b2.name));
    /* ---- ONE ROSTER: A COURT IS A ROW, AND TERMS ARE A BUTTON UNDER ONE ----
     * The courts and the terms were two lists about the same thing: a rival banner named once
     * with its holdings and its state, and again by every court it holds. Reported from play as
     * redundant, and it was — the same fifteen banners twice, on a panel already long enough
     * that the second list was below the fold.
     * THE FIX IS NOT A SECOND HEADING. Grouping the courts under banner header rows was tried
     * and measured first: it reads better, and it does not CONDENSE — sixteen headers plus
     * sixteen courts is 32 rows against the 31 it replaced, because at genesis every banner
     * holds exactly one court. So terms go where every other action on this panel already
     * lives: an inline strip under the row, exactly as COMMAND and the standing orders do for a
     * court of your own. One tap target per thing you can do, and no heading at all.
     * It is drawn under a banner's FIRST court and no others, because terms are sworn between
     * BANNERS — five identical buttons under five courts would be the redundancy again, one
     * level down. `cities` is therefore ordered so a banner's courts are adjacent.
     * Grouped off the CITIES rather than off `terms`, because the cities are the thing that is
     * certainly there: a banner that is `out`, or one the truce rules never built a terms row
     * for, still holds ground and still needs its courts on the roster. */
    const byRealm = new Map();
    for (const c of cities) {
      let g = byRealm.get(c.realm);
      if (!g) byRealm.set(c.realm, (g = { realm: c.realm, cities: [] }));
      g.cities.push(c);
    }
    const termOf = new Map(terms.map((t) => [t.idx, t]));
    const groups = [...byRealm.values()].map((g) => {
      const t = termOf.get(g.realm);
      return { realm: g.realm, cities: g.cities, mine: g.realm === me, t,
               n: g.cities.length,
               name: g.realm < 0 ? '' : seatName(g.realm) };
    });
    /* yours first, then whatever is waiting on you, then the biggest — the order the terms list
     * already used, now carrying its courts with it. Ground nobody holds is last: it is the
     * only group that is not a player. */
    groups.sort((a2, b2) => (b2.mine - a2.mine) || ((a2.realm < 0) - (b2.realm < 0)) ||
                            ((a2.t ? RANK[a2.t.state] : 9) - (b2.t ? RANK[b2.t.state] : 9)) ||
                            (b2.n - a2.n) || a2.name.localeCompare(b2.name));
    /* flattened back into ONE list of courts, each carrying the terms strip only if it is the
     * first court of a banner you may treat with */
    cities.length = 0;
    for (const g of groups) for (let k = 0; k < g.cities.length; k++) {
      const c = g.cities[k];
      /* THE TERMS RIDE ON EVERY COURT OF THE BANNER, and only the first DRAWS them. The roster
       * wants one strip per banner; the court pop-up is opened from the MAP, where the court
       * you tapped is whichever one you tapped, so it has to be able to offer terms from any of
       * them. One field, two readers, and no second copy of "what are we to each other". */
      c.terms = g.t ? { idx: g.realm, name: g.t.name, state: g.t.state, act: g.t.act,
                        holds: g.n + (g.n === 1 ? ' city' : ' cities') } : null;
      c.termsHere = k === 0 && !!g.t;
      cities.push(c);
    }
    /* ---- AND THE COUNTRY ITSELF, because a roster is a list and a war is a SHAPE ----
     * Sixteen courts on 8000x9600 cannot be found by dragging and cannot be held in the head
     * from a list of names. The map is the same `view.cities` the roster is built from — the
     * one place ownership is read — so the two screens cannot disagree about who holds what.
     * OWNERSHIP IS LIVE, on the owner's call: it is what the sim publishes to every seat, and
     * a remembered one would put the map and the row beside it at odds over the same court.
     * What is NOT here is where the men are. That is fogged everywhere else and this is not the
     * screen that undoes it: a court is public, an army is not. */
    const land = { w: view.nav.W * view.nav.cw, h: view.nav.H * view.nav.cw };
    const marks = view.cities.map((c, ci) => ({
      idx: ci, x: c.x, y: c.y, r: c.reach || 0,
      name: view.map.sites[c.site].name || 'a Seat of Power',
      tint: c.owner < 0 ? hex(C.NEUTRAL_TINT) : tint(c.owner),
      mine: ours(c.owner), hand: c.owner === hand(),
      razed: !!c.razed, yielded: c.owner >= 0 ? 0 : 1
    }));
    return { held: cities.filter((c) => c.mine).length,
             all: view.cities.filter((c) => !c.razed).length,
             income, crews, free, men, pattern, cities, terms,
             map: { land, marks } };
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
      /* which banners contend — the renderer colours by realm and needs the list, and the
       * wire carries the same field so a host and a guest paint the same country */
      heirs: world.heirs,
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
      /* "MINE" IS THE BANNER'S — a lord sworn to you is yours to command, so his works are on
       * your screen unfogged exactly as your own are. `Net.snapFor` says the same thing in the
       * same words; a board has one seat per realm and this is `pi === viewer` to the byte. */
      players: world.players.map((pl, pi) => World.realmOf(world, pi) === World.realmOf(world, viewer)
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
      units: world.units.filter((u) => (u.owner >= 0 &&
                                        World.realmOf(world, u.owner) === World.realmOf(world, viewer)) ||
                                       see(u.x, u.y)),
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
    /* CUT TO THE LAND HE IS ACTUALLY LOOKING AT. Asked for with no dimensions this is a
     * BOARD-sized grid — which is right for a duel and catastrophic for a war: a country is
     * 8000x9600, so the memory mask covered its top-left sixteenth, `markSeen` OR-ed a
     * country-sized live mask into it index-for-index across two different strides, and the
     * veil's own view window (`fogWin`, clamped to this grid) could not reach the ground the
     * camera was over. Every cell in sight therefore stayed SHROUD. That is the black world a
     * guest at a war table was photographed looking at, and it is the same shape as the other
     * country bugs in this codebase: a second path for the big case, silently sized for the
     * small one. The host has always cut it from the world's own extents (`createWorld`). */
    if (!guestSeen) guestSeen = World.newSeenMask(refWorld.mapW, refWorld.mapH);
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
    /* WHOSE SIDE THIS HAPPENED ON. Every line below used to ask `ev.pi === game.viewer`, which
     * in a war is the wrong question about half the events on the board: a court taken by a
     * lord sworn to you is taken by YOU, and one of his yielding is one of yours. `ours0` is
     * the seat itself, for the one line that has to tell your own hand from a vassal's. */
    const ours0 = (pi) => pi === game.viewer;
    const ours = (pi) => pi >= 0 && World.realmOf(view, pi) === World.realmOf(view, game.viewer);
    const seen = evs.filter((ev) => ours(ev.pi) || ev.x == null || !view.see || view.see(ev.x, ev.y));
    Render.addEvents(seen, view, game.viewer);
    for (const ev of seen) {
      /* A RIVAL ON THE PATTERN GETS THE KNELL, not a banner. Your own walk stays a banner —
       * you know you started it, and you have the count on the board — but a rival's is the
       * one thing that takes the throne without ever coming near you, and being told once in
       * the same corner as the weather is not being told. */
      if (ev.e === 'walk' || (ev.e === 'pattern' && ev.idx > 0)) {
        /* the walk is the BANNER'S: under `onePattern` the man on the lines is whichever lord
         * holds AMBER, and in a war that is usually one sworn to you */
        const mine = ours(ev.pi);
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
      /* MINE IS THE BANNER'S, on all three. A court taken by a lord sworn to you is taken by
       * YOU, and a court of his that yields is one of yours yielding — reading these off the
       * seat index called your own vassal's conquest an enemy's and cried about the wrong
       * throne. `ours` is the same question the city sheet and the minimap ask. */
      else if (ev.e === 'yield') UI.banner(ours(ev.pi)
        ? seatName(ev.pi) + '’s Seat has yielded — its court is open to anyone who can hold it'
        : seatName(ev.pi) + '’s Seat yields — take the court and it is yours', ours(ev.pi) ? 'warn' : 'alert');
      else if (ev.e === 'taken') UI.banner(ours(ev.pi)
        ? (ev.lord != null && !ours0(ev.lord) ? seatName(ev.lord) + ' swears to you — his city, his purse and his men are yours'
                                              : 'The city is YOURS')
        : seatName(ev.pi) + ' takes the city', ours(ev.pi) ? 'alert' : 'warn');
      else if (ev.e === 'razed') UI.banner(ours(ev.pi)
        ? 'You throw the city down — it will be nobody’s now'
        : seatName(ev.pi) + ' throws the city down', ours(ev.pi) ? '' : 'warn');
      /* ---- TERMS SPEAK ONLY WHEN THEY ARE YOURS ----
       * A duel has one rival, so "somebody came to terms" could only ever be about you. A war
       * seats sixteen and they treat with each other constantly: reported from play with a
       * screenshot of the whole stack — three lines, `AVERNUS and KASHFA`, `AVERNUS and TIR-NA`,
       * `AVERNUS and a City of Shadow`, none of them involving the player, and every one of them
       * shoving out something that did. The stack holds three lines for 3.4 seconds each, so
       * a country's diplomacy alone can fill it forever.
       * It fails the banner rule's third test — would he act differently for knowing? — and it
       * has a readout already: the council's roster names every banner and the terms it is
       * under, live, for as long as it is true. So the ANSWER to "who is allied with whom" is a
       * panel, and a banner is kept for the thing that is happening TO you.
       * Both events, because both were open: `offer` is emitted whenever an offer fails to seal,
       * including between two lords who have never heard of you. */
      else if (ev.e === 'offer' && !ours(ev.pi) && ours(ev.p))
        UI.banner(seatName(ev.pi) + ' asks for terms', 'alert');
      else if (ev.e === 'pact' && !ours(ev.pi) && ours(ev.p)) {
        if (ev.on) UI.banner(seatName(ev.pi) + ' agrees to terms', 'alert');
        else UI.banner(seatName(ev.pi) + ' BREAKS the truce!', 'warn');
      }
      else if (ev.e === 'rift' && view.t - game.lastRiftBanner > 30) { game.lastRiftBanner = view.t; UI.banner('Chaos tears open a rift in the black road', 'chaos'); }
      else if (ev.e === 'surge') UI.banner('The black road surges — Chaos redoubles!', 'chaos');
      else if (ev.e === 'storm' && !ours(ev.pi)) UI.banner(game.names[ev.pi] + ' calls down the storm!', 'warn');
      else if (ev.e === 'trump' && !ours(ev.pi)) UI.banner(game.names[ev.pi] + ' draws a Trump!', 'warn');
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
      else if (ev.e === 'raze') UI.banner(ours(ev.pi) ? 'Your ' + (C.BUILDINGS[ev.bt] ? C.BUILDINGS[ev.bt].name : 'building') + ' has been RAZED!' : 'You raze the rival’s works', ours(ev.pi) ? 'warn' : '');
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
        if (!ours(ev.pi)) continue;
        /* the court that is actually being scratched — his, which in a war may be a vassal's */
        const c = view.map.sites[view.map.cities[ev.pi]];
        const home = c && ev.x != null && Math.hypot(ev.x - c.x, ev.y - c.y) < C.CITY.r;
        const what = (C.BUILDINGS[ev.bt] || {}).name || 'works';
        const who = ev.by === C.CHAOS_ID ? 'Chaos'
                  : ev.by != null && ev.by !== game.viewer ? (game.names[ev.by] || 'The enemy') : null;
        const cls = ev.by === C.CHAOS_ID ? 'chaos' : 'warn';
        if (home) UI.banner(who ? who + ' is inside your city!' : 'Your works are under attack!', cls);
        else UI.banner(who ? who + ' is at your ' + what + '!' : 'Your ' + what + ' is under attack!', cls);
      }
      /* the Shrine falling is the single biggest thing an assault can do — say what it cost */
      else if (ev.e === 'shrinefell') UI.banner(ours(ev.pi)
        ? '✴ Your Shrine is thrown down — the Pattern lets go of you (' + Math.round(ev.pattern) + '%)'
        : '✴ ' + game.names[ev.pi] + ' is torn off the Pattern — ' + Math.round(ev.pattern) + '% left',
        ours(ev.pi) ? 'warn' : 'alert')
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
          /* ---- EVERY LORD RUNS HIS OWN CITY, INCLUDING THE ONES SWORN TO YOU ----
           * The country's bots step wherever the country is — a solo war or a hosted table.
           * `game.bots[i]` is null on every seat a HUMAN holds, so nothing double-drives, and
           * a lord who swears keeps his brain: he goes on paying for his own halls out of his
           * own purse and answering his own borders. What the player's oath buys is the right
           * to tell him which way to face (`helm.orders`), which is a parameter to that same
           * brain — and the lord the player is hand-playing right now is skipped, because the
           * taps ARE his orders. This is the whole of "a delegated city has a real economy":
           * there is no second, thinner steward brain to be worse than a rival's. */
          if (game.bots) {
            const orders = (game.realm && game.realm.helm && game.realm.helm.orders) || null;
            const driving = game.war ? hand() : -1;
            for (let bi = 1; bi < game.bots.length; bi++)
              if (game.bots[bi] && bi !== driving) game.bots[bi].step(game.world, bi,
                (cmd) => World.applyCommand(game.world, bi, cmd), C.SIM_DT,
                orders ? orders[bi] : null);
          } else if (game.mode === 'sp') {
            game.bot.step(game.world, 1, (cmd) => World.applyCommand(game.world, 1, cmd), C.SIM_DT);
          }
          /* every guest's commands are applied AS THAT GUEST — with four seats the sender
           * is the only thing that says whose order it was */
          if (game.mode === 'host')
            for (const q of guestCmdQueue.splice(0)) {
              const w2 = game.world;
              const as = q.as != null && w2.players[q.as] &&
                         World.realmOf(w2, q.as) === World.realmOf(w2, q.pi) ? q.as : q.pi;
              World.applyCommand(w2, as, q.c);
            }
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
        /* A WAR'S STATE IS A PLACE YOU GO, not a line in the corner. A chapter's objective is
         * still a line — it is one sentence and there is nothing else up there competing with
         * it — but a war's was two wrapped lines that ran sixty pixels under the terms chips
         * on a 420-wide phone, and a fourth banner would have pushed the chips into the
         * minimap. The count is the chip; everything behind it is the council. */
        if (game.war) UI.warChip(warChip()); else UI.objective(game.run.say(game.world));
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
      /* THE SCREEN BELONGS TO THE SEAT, THE READOUTS BELONG TO THE HAND. The veil, the
       * colours and the camera are the viewer's; the purse, the crews, the flag tray and the
       * income are the court he is driving — which in a war may be one of his sworn lords.
       * `Render.hand` is how the renderer is told the same thing (writ, reach ring, halo). */
      const hv = hand(), hp = game.world.players[hv];
      Render.hand = hv === game.viewer ? null : hv;
      Render.frame(view, game.viewer, dtReal);
      UI.paused(game.world.paused, game.viewer, game.names);
      UI.hud(view, game.viewer, (hp.incomeRate || 0) - (hp.drainRate || 0), game.targeting, hv);
      UI.tick(hp.essence);
      UI.flags(view, hv, game.armedFlag);
    } else if (game.mode === 'guest' && snapCur) {
      linkCheck();
      const view = guestView();
      /* the chip is the war's whole readout and it belongs to the SCREEN, not to the sim —
       * it was drawn from inside the `game.run` block, which only a host holds, so a guest
       * at a war table had no count of cities and no door to the council */
      if (game.war) UI.warChip(warChip());
      /* a guest may hold ANY seat but seat 0 — read its own, never seat 1's */
      const gv = game.viewer, gh = hand(), gp = snapCur.players[gh] || {};
      Render.hand = gh === gv ? null : gh;
      Render.frame(view, gv, dtReal);
      UI.paused(snapCur.paused, gv, game.names);
      UI.hud(view, gv, (gp.incomeRate || 0) - (gp.drainRate || 0), game.targeting, gh);
      UI.tick(gp.essence || 0);
      UI.flags(view, gh, game.armedFlag);
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
          const bad = World.placementError(game.world, hand(), w.x, w.y, game.placing.bt);
          if (bad) { sayErr(bad); return; }
        }
        game.span = { x: w.x, y: w.y, bt: game.placing.bt, co: game.placing.co };
        /* `reach` is how long a run the idle masons can cover — the only limit on a wall's
         * length — so the preview can refuse a run for the real reason before the second tap
         * does. A guest holds no world; the host validates, and its preview does not judge. */
        const reach = game.world ? World.wallReach(game.world, hand()) : 0;
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
      /* A STANDARD GOES WHERE YOU POINT, AND A CITY IS NOT A SPECIAL CASE. Tapping a site
       * still names it, so an order given ON a spring or a court is recorded as that place —
       * but by the site's OWN ground, the same question asked everywhere else. It used to take
       * the whole court, which meant an order placed anywhere inside a city circle jumped to
       * the middle of it. There is nothing here to refuse. */
      const siteId = Render.hitSite(x, y, view, game.viewer);
      const w = Render.toWorld(x, y, game.viewer);
      const where = siteId >= 0 ? { site: siteId } : { x: w.x, y: w.y };
      const r = issue({ c: 'rally', co: id, ...where });   // a COMPANY's standard, not a hall's
      /* remembered only if it was TAKEN: a refused order is not one to double down on */
      twice = (!r || r.ok !== false) ? { co: id, where, sx: x, sy: y, at: Date.now() } : null;
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
    /* ---- SAY IT TWICE AND IT IS MEANT LITERALLY ----
     * A second tap on the order just given makes it a FORCED one: march through whatever is in
     * the way, or — if the second tap lands on an enemy work — bring that down and answer
     * nothing else.
     * THE SECOND TAP UPGRADES THE ORDER RATHER THAN THE FIRST TAP WAITING FOR IT. Holding the
     * first tap for a double-tap window would put that delay on EVERY order given in the game
     * to buy a gesture used occasionally, and a rally that arrives 400ms late is a worse game
     * for the sake of a better one. So the ordinary order goes out instantly and is never made
     * worse; saying it again re-issues the same order with the bit set. It is also the honest
     * reading of the gesture: tap to send them, tap again to mean it.
     * IT SITS HERE, BELOW EVERY CLAIM THAT IS MORE URGENT THAN A SELECTION, and that placement
     * is the whole of getting it right. Above the armed flag it stole the second tap from a
     * DIFFERENT company you had just armed; above the sheet dismissal it left a modal standing
     * while it issued an order behind it; above the storm it swallowed the aim. All three are
     * explicit acts the player is plainly in the middle of, and an upgrade to the last order is
     * not. What it does outrank is ordinary selection, because "double tap an enemy work" means
     * the second tap lands ON something, and that is the order rather than a request to look at
     * it. Reported from play as tapping inside a city circle behaving differently — which is
     * exactly where works, men and standards are densest.
     * There is no banner. The standard on the ground grows a SECOND pennant for as long as the
     * order stands, which says it for as long as it is true — and a banner that echoed an order
     * the player had just given twice is the one thing the corner is forbidden. */
    if (twice && Date.now() - twice.at < DOUBLE.ms &&
        Math.hypot(x - twice.sx, y - twice.sy) < DOUBLE.px) {
      const foeW = Render.hitFoeWork ? Render.hitFoeWork(x, y, view, game.viewer) : null;
      issue(Object.assign({ c: 'rally', co: twice.co, hard: 1 },
                          foeW ? { x: foeW.x, y: foeW.y, tpi: foeW.pi, tid: foeW.id } : twice.where));
      twice = null;
      return;
    }
    /* ---- A WORK UNDER THE FINGER ALWAYS WINS ----
     * Men were asked first once, so a company standing on a hall made that hall unopenable;
     * then the NEARER of the two answered, which is better and still not right. A work is a
     * fixed point the size of a fingertip and men are many, they move, and they gather exactly
     * where the works are — so a hall with a company mustered round it had a ring of men
     * closer to almost every part of it than its own centre was, and the harder you pressed
     * the more certainly you armed the standard. Reported from play as buildings being very
     * hard to select.
     * The tie is broken by what each target COSTS to miss, not by which is nearer: the work's
     * sheet is the only way to reach the work at all — no upgrade, no fork, no mend, no way
     * even to see what it is — while a company has the flag tray, which names every one of
     * them and is always on screen. So a work hit at all answers, and men answer on the ground
     * around it. This is the same rule the wall/bastion tie already uses one level down in
     * `hitBuilding`, and it is one code path, so every mode is held to it.
     *
     * A TROOP OF YOURS IS HIS COMPANY'S FLAG: point at men on open ground and the next tap is
     * where they go. */
    const bid = Render.hitBuilding(x, y);
    if (bid >= 0) {
      /* a work belongs to the lord whose court it stands in, and the sheet spends his purse */
      const me = view.players[hand()];
      const b = me.buildings.find((q) => q.id === bid);
      if (b) { Render.selected = bid; UI.upSheet(b, me.essence, me.walking, me); return; }
    }
    const uco = Render.hitUnit ? Render.hitUnit(x, y, game.viewer) : 0;
    if (uco > 0) {
      game.armedFlag = game.armedFlag === uco ? null : uco;
      /* the ring the renderer draws round the armed company, and the lit chip in the tray,
       * already say this — and say it for as long as it is true rather than for 3.4 seconds */
      return;
    }
    const siteId = Render.hitSite(x, y, view, game.viewer);
    if (siteId >= 0) {
      /* every site opens a sheet — including the rival's city (the assault order) */
      const site = view.map.sites[siteId];
      const ci = view.cities ? view.cities.findIndex((c2) => c2.site === siteId) : -1;
      const cRec = ci >= 0 ? view.cities[ci] : null;
      /* MINE IS THE BANNER'S. A court held by a lord sworn to you is yours, and the sheet has
       * to say so — this asked `owner !== viewer`, which in a war called every one of your own
       * vassals' courts a rival's and offered you the assault order on them. */
      const ours = (c2) => c2 && c2.owner >= 0 &&
        World.realmOf(view, c2.owner) === World.realmOf(view, game.viewer);
      const foeCity = cRec ? !ours(cRec) : view.map.cities[1 - game.viewer] === siteId;
      /* THE WAR'S OWN CONTEXT for a city sheet: whether this court can be COMMANDED FROM, who
       * its neighbours are (an attack order wants names, not coordinates), and what standing
       * order its lord — if any — is already under. Nothing here for a board. */
      let war = null;
      if (view.rules && view.rules.reach && cRec && game.war) {
        const lord = cRec.owner;
        war = {
          idx: ci, id: cRec.id, mine: ours(cRec), lord,
          /* THIS court's own throne, so the sheet quotes the city it is about */
          hp: cRec.hp, maxHp: cRec.maxHp, owner: cRec.owner,
          /* the court you are hand-playing offers neither button: you ARE its steward */
          isSeat: lord >= 0 && lord === hand(),
          steward: (game.realm && game.realm.helm && game.realm.helm.orders &&
                    game.realm.helm.orders[lord]) || null,
          nbrs: ((view.map.gen.nbrs && view.map.gen.nbrs[ci]) || []).map((i) => ({
            idx: i, name: view.map.sites[view.cities[i].site].name, owner: view.cities[i].owner })),
          own: view.cities.map((c2, i) => ({ idx: i, name: view.map.sites[c2.site].name, owner: c2.owner }))
            .filter((e) => ours(view.cities[e.idx]) && e.idx !== ci)
        };
      }
      /* the sheet is read for the court's OWN lord — his throne, his purse, his muster — and
       * the rival info is the city's holder rather than `players[1 - viewer]`, which was duel
       * arithmetic and told you seat 1's business about every court in a sixteen-seat war */
      const mineIdx = hand();
      /* WHO HOLDS THIS SITE, answered here because only game.js has the world: a spring Gated
       * by a lord sworn to you is YOURS, and it read as the rival's until this asked the
       * banner. Named rather than "the rival's" — a country seats sixteen. */
      const st2 = view.sites[siteId];
      const hold = st2 && st2.holder != null && st2.holder >= 0 ? st2.holder : -1;
      const own = hold < 0 ? null
        : { mine: World.realmOf(view, hold) === World.realmOf(view, game.viewer),
            name: seatName(hold) };
      UI.siteSheet(site, st2, game.viewer, view.players[mineIdx].essence, foeCity,
                   view.players[mineIdx],
                   cRec && cRec.owner >= 0 ? view.players[cRec.owner] : view.players[1 - game.viewer],
                   war, own);
      return;
    }
    /* bare ground does nothing now: raising a work begins at the BUILD button, so the map is
     * only ever asked about things that are ON it. */
    Render.selected = -1;
  }

  /* THE COUNCIL'S FOUR VERBS. `data` is handed back so a row that changes the war can redraw
   * the panel from the same door it was built through — an order given and a panel that still
   * says "no standing order" is the sort of thing that reads as a dead button. */
  /* THE HANDLERS THE UI IS GIVEN, held so other panels can reach them. `councilHandlers`
   * delegated to `H` — which never existed: `UI.init` was handed an object LITERAL, so every
   * council action that forwarded to it (terms, COMMAND, a standing order) threw
   * `H is not defined` the instant it was tapped and died there. From the panel that is a row
   * that says "tap to offer" and does nothing at all, which is how it was reported. One name,
   * assigned where the object is built, and the delegation resolves. */
  let H = null;
  const councilHandlers = {
    data: councilData,
    /* LOOK: the reason the roster exists. On an 8000x9600 country you cannot find a court by
     * dragging the map, so the row IS the way there. */
    onLook: (ci) => {
      const w = game.world || refWorld;
      const c = w && w.cities && w.cities[ci];
      if (c && Render.lookAt) Render.lookAt(c.x, c.y);
    },
    onTake: (ci) => H.onTakeSeat(ci),
    onOrder: (lord, mode, target) => {
      const helm = game.realm && (game.realm.helm || (game.realm.helm = { orders: {}, hand: 0 }));
      if (!helm) return;
      const was = helm.orders[lord];
      /* the same order twice is the order LIFTED — a lord left to his own doctrine, which is
       * a thing the player should be able to say without a second control for it */
      const same = was && was.mode === mode && (target == null || was.target === target);
      H.onSteward(lord, same ? null : mode, target);
    },
    onTerms: (pi) => H.onTerms(pi)
  };

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
    /* ---- THE TABLE DRAWS ITSELF, FROM THE NET AND NOT FROM THE LAST EVENT ----
     * Everything on this screen — the status line, the host button's label, whether there is
     * any way to begin at all — used to be written by the ONE event that last changed it
     * (`Net.onOpen`, which fires once per channel opening and never again). So the table you
     * came back to was the table you left, however long ago and whatever had happened since:
     * a screen that had been dealt into a match still read "2 of 4 seated — add another, or
     * begin" with the ways to begin gone, because the deal had hidden them by hand.
     * `Net.seated()` is the honest measure — it counts OPEN channels, so a link that died
     * without an event still empties the table — and `game.mode` is the other half: a lobby
     * is the moment between pairing and playing, and there is nothing to offer outside it. */
    const paintTable = () => {
      const n = Net.seated();
      const lobby = Net.isHost && n > 1 && !game.mode;
      /* TWO MODES, ALWAYS BOTH, AND EACH SAYS WHICH GAME IT IS. The war button used to appear
       * only when a war happened to be sitting in the host's pocket, so a host who had never
       * played one was offered a single BEGIN and no choice — the same invisible state that
       * made one button mean two games in the first place. Offered together or not at all;
       * without a war to continue the war button GROWS one for the table. */
      const twoLine = (el, head, sub) => {
        el.innerHTML = '';
        const b = document.createElement('b'), s = document.createElement('small');
        b.textContent = head; s.textContent = sub;
        el.appendChild(b); el.appendChild(s);
      };
      for (const id of ['lan-start', 'lan-start-war']) $(id).classList.toggle('hidden', !lobby);
      if (lobby) {
        twoLine($('lan-start'), 'BEGIN — ' + n + ' HEIRS', 'a skirmish: one fresh board, first Seat to fall');
        /* `REALM.saved()` and not `REALM.load()`: load REGROWS the whole country from its seed,
         * which is seconds of work on a phone, and this runs every time the screen is opened.
         * The label is the only question here; the war itself is not wanted until the tap. */
        const has = !!(REALM && REALM.saved && REALM.saved());
        twoLine($('lan-start-war'),
                (has ? 'YOUR WAR — ' : 'A NEW WAR — ') + n + ' HEIRS',
                has ? 'the reach war in your pocket, dealt to this table'
                    : 'the reach war: a new country, sixteen thrones, one Pattern');
        $('qr-host').textContent = Net.canAdd() ? 'ADD ANOTHER HEIR' : 'FOUR IS THE LIMIT';
        $('qr-host').disabled = !Net.canAdd();
        $('qr-host').classList.remove('hidden');
        say(n + ' of ' + C.MAX_PLAYERS + ' seated — add another, or begin');
      } else if (!Net.active && !Net._pairing) {
        /* nothing in flight and nobody linked: the opening line, not whatever was true once */
        $('qr-host').textContent = 'HOST THE TABLE';
        $('qr-host').disabled = false;
        say('same Wi-Fi · no server · pair by QR · two to four heirs');
      }
    };
    /* ---- AND THE TABLE LEAVES THE GLASS WHEN THE MATCH BEGINS ----
     * THE BUG, and it was not the button. The host taps BEGIN, the match starts underneath —
     * world ticking, snapshots going out to the guest — and `#lan-screen` stays on top of it
     * all, covering the HUD, still reading "2 of 4 seated — add another, or begin" with the
     * BEGIN button gone because the deal had just hidden it. Reported from play as "the BEGIN
     * button is not on screen, so the game can never start", which from behind that screen is
     * exactly what it looks like. `UI.startMatch` clears `#menu`, `#end`, `#halt` and
     * `#knell`; the LAN panel used to live INSIDE `#menu` and went away with it, and the menu
     * refactor moved it out to a screen of its own that the one door into a match had never
     * been told about. It is closed at both doors a LAN match can come through — this seat
     * dealing, and the host's start message arriving — because those are the two places in
     * this file that call `startMP`. */
    const leaveTable = () => { $('lan-screen').classList.add('hidden'); paintTable(); };
    /* the LAN table is a screen now — ui.js calls `onLanOpen` when it comes up, and that is
     * registered with every other handler in UI.init below rather than bolted on here. It
     * repaints the WHOLE table, not just the Wi-Fi line: a screen you can walk away from and
     * come back to has to be able to draw itself. */
    lanOpened = () => { paintNet(); paintTable(); };
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
      /* up to three guests, added one at a time; play with however many are in. What the
       * table looks like is `paintTable`'s answer and nobody else's — this event only says
       * that something CHANGED. */
      if (Net.isHost) paintTable();
      else say('LINKED — awaiting the host…');
    };
    /* ---- DEALING THE TABLE ----
     * `inWar` picks the mode, and it is the BUTTON that picks it rather than a save nobody can
     * see. The country is never sent either way — a guest regenerates it from the seed exactly
     * as it does a board — and the war's history rides the ordinary snapshots, because the host
     * is authoritative and a snapshot is absolute.
     * EVERY SEND IS GUARDED. This looped over the peers sending the start message, and one
     * channel throwing took the whole handler down with it: no match, no message, and a BEGIN
     * that does nothing at all is indistinguishable from a button that is not wired up. The
     * host deals to whoever it can reach and says so when it can reach nobody. */
    const deal = (inWar) => {
      const seed = (Math.random() * 0xffffffff) >>> 0;
      const seats = Net.seated();
      /* THE WAR BUTTON MAKES A WAR WHEN THERE IS NONE. It used to be offered only while one
       * was already saved, so a host who had never played a reach war could not begin one at
       * a table at all — the choice existed but was invisible, which is the same fault the
       * two buttons were drawn to fix. `REALM.create` is exactly what the menu's own card
       * does; growing the country costs seconds on a phone, so it is done at the TAP and
       * never at the paint. It is saved as the host's war, because a rematch reloads the war
       * from the pocket (`rematch`) and would otherwise fall back to a board. */
      /* nobody to deal to is answered BEFORE the country is grown: a table nobody is sitting
       * at is not worth eight thousand units of land, and growing one would overwrite the war
       * in the host's pocket to play it with himself */
      const open = Net.peers.filter((p) => p.dc && p.dc.readyState === 'open');
      if (!open.length) { say('no seat could be dealt to — pair again'); paintTable(); return; }
      let saved = inWar ? REALM.load() : null;
      if (inWar && !(saved && !saved.done)) {
        say('growing the country — a moment…');
        saved = REALM.create(seed);
        REALM.save(saved);
      }
      const war = inWar && saved ? { seed: saved.seed } : null;
      let dealt = 0;
      for (const p of open) {
        try { Net.send({ t: 'start', seed, seats, idx: p.idx, war }, p.idx); dealt++; }
        catch (e) { lanNote = 'seat ' + p.idx + ' would not take the deal: ' + e.message; paintDiag(); }
      }
      if (!dealt) { say('no seat could be dealt to — pair again'); paintTable(); return; }
      /* THE BUTTONS ARE NOT PUT AWAY BY THE TAP — they are put away by the match. They used
       * to hide themselves here, before `startMP` had done anything, so any throw past this
       * line left a table that said "2 of 4 seated — add another, or begin" with nothing on
       * it to begin WITH, which is indistinguishable from a button that was never wired up.
       * `paintTable` hides them because `game.mode` is set; a failure leaves them standing
       * and says what went wrong. */
      try { startMP(seed, seats, 0, war, war ? saved : null); }
      catch (e) {
        say('the table could not be dealt: ' + (e.message || e));
        lanNote = 'deal failed: ' + (e.message || e); paintDiag(); paintTable(); return;
      }
      leaveTable();
    };
    $('lan-start').addEventListener('click', () => deal(false));
    $('lan-start-war').addEventListener('click', () => deal(true));
    Net.onStart = (m) => { startMP(m.seed, m.seats, m.idx, m.war || null); leaveTable(); };
    /* A GUEST MAY ORDER HIS OWN LORDS AND NOBODY ELSE'S, and the host is where that is
     * decided — the seat the message arrived on is the only thing that cannot be forged, so
     * the lord it names is checked against it and falls back to the sender himself. */
    Net.onCmd = (c, from, as) => guestCmdQueue.push({ c, pi: from, as });
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
    /* A HEIR SAYING GOODBYE. From the HOST it is the end of the table: there is no world
     * anywhere else, so there is nothing to carry on with. From a guest it is one seat
     * leaving, which the host survives — `onClose` follows it in a moment and does the rest. */
    Net.onBye = (from) => {
      if (game.mode !== 'guest' || from !== 0) return;
      linkLost = 'bye';
      endTable(seatName(0) + ' has left the table — the match is ended');
    };
    Net.onSnap = (s) => {
      const now = performance.now();
      if (snapAt) snapGap = snapGap * 0.7 + Math.max(50, Math.min(400, now - snapAt)) * 0.3;
      /* THE LINK IS ALIVE AGAIN, WHATEVER IT WAS DOING A MOMENT AGO — and that includes a
       * departure already scheduled. Clearing the two flags but leaving the eviction timer
       * armed meant a host who came back inside the grace still had his guest dropped to the
       * menu two seconds later, with the match running and snapshots arriving: the recovery
       * was noticed and then thrown away. A goodbye is different and is not taken back — no
       * snapshot follows it, and `linkLost === 'bye'` says the table is over on purpose. */
      if (leaving && linkLost !== 'bye') {
        clearTimeout(leaving); leaving = 0;
        UI.banner('The link is back', 'alert');
      }
      if (linkLost !== 'bye') { linkLost = null; quietSaid = false; }
      snapPrev = snapCur; snapCur = s; snapAt = now;
      if (!game.over) {
        Rec.sample(Rec.fromSnap(s, game.viewer));
        if (s.events && s.events.length) Rec.note(s.events, refWorld ? { t: s.t, map: refWorld.map } : null);
      }
      if (s.events && s.events.length && refWorld) routeEvents(s.events, guestView());
      if (s.winner !== null && s.winner !== undefined) endMatch(s.winner, s.winReason);
    };
    Net.onClose = (seat) => {
      if (game.mode === 'guest') {
        /* a goodbye has already said it better — do not talk over it */
        if (linkLost !== 'bye') endTable('The link to the host is severed — the match is ended');
      } else if (game.mode === 'host') {
        /* AN ABANDONED SEAT IS PLAYED BY SOMEBODY. The host plays on, and the seat that left
         * used to simply STAND there: its cities kept earning, its men held whatever ground
         * they were last ordered to, and nobody moved them again for the rest of the match. In
         * a war that is a dead contender the survivors have to walk over. It is handed the
         * same driver an unclaimed seat gets when the table is dealt, which is the plainest
         * true answer to "who is playing that heir now" — and it says so in ONE line, because
         * "the link is severed" and "a shadow fights on" are one piece of news, not two. */
        if (!adoptSeat(seat)) UI.banner('The Trump link is severed', 'warn');
        /* on the end screen the link IS the offer of a rematch. Losing it there is not fatal
         * — nobody is mid-match — but the button must stop promising a game that can no
         * longer be dealt, so redraw the screen with what is actually left. */
        if (game.over) endScreen();
      } else {
        /* AT THE TABLE: A SEAT THAT HAS GONE COMES OFF IT. `paintTable` counts the open
         * channels, so it speaks last — at a table of four, one phone leaving is 'link lost'
         * overwritten by the two that are still seated, which is the truth; at a table of two
         * there is nothing left to say and the loss stands. */
        say('link lost');
        paintTable();
      }
    };
  }

  /* the chapter list, with `focus` naming the one to open a briefing for straight away (which
   * is what the end screen's button wants: it has just named the next chapter) */
  function toChapters(focus) {
    game.over = false;
    game.mode = null; game.chapter = null; game.run = null;
    if (game.world) game.world = null;
    UI.objective(null); UI.warChip(null);
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
    H = {
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
        /* the offer lives on the BANNER's founder — the sim normalises the order either way,
         * but the state this tap inverts has to be read off the same place */
        const me = view && view.players[World.realmOf(view, game.viewer)];
        issue({ c: 'pact', p, on: !(me && me.offers && me.offers[p]) });
      },
      /* the run's sheltered face, turned over. It asks for a STATE rather than a toggle for the
       * same reason the halt does: two seats tapping it at once must not cancel each other. */
      onFlip: (id) => {
        const view = game.mode === 'guest' ? snapCur : game.world;
        const b = view && (view.players[hand()].buildings || []).find((q) => q.id === id);
        issue({ c: 'flip', id, on: !(b && b.flip) });
      },
      onBuild: (x, y, bt, co) => issue({ c: 'build', x, y, bt, co }),
      onBuildMenu: () => {
        if (game.over) return;
        if (game.placing) { clearPlacing(); return; }   // the button un-arms; that is the answer
        const view = game.mode === 'guest' ? (snapCur && guestView()) : hostView();
        if (!view) return;
        game.targeting = false; game.armedFlag = null;
        /* THE HAND'S PURSE, AND THE HAND'S FLAGS. This read the VIEWER's, so taking command
          * of a conquered court and opening the BUILD sheet offered your HOME city's essence
          * and its standards — a hall raised there would have flown a flag belonging to a city
          * on the other side of the country. Reported from play in exactly those words. */
        const hb = view.players[hand()];
        UI.buildSheet(hb.essence, hb);
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
        /* reaching for a standard is a new sentence: whatever order was waiting to be repeated
         * is not the one being given now, and the next tap belongs to this company */
        twice = null;
        game.armedFlag = game.armedFlag === id ? null : id;   // the chip lights; that is the caption
      },
      /* NO PER-COMPANY HOLD BUTTON. It sat beside the armed flag and was the only way to
       * un-post one company; taken out of the bar on the owner's call to keep the row for
       * the flag and its roster. The order it sent, if it is ever wanted again anywhere, is
       * `{ c: 'rally', co, site: -1 }` — a rally with nowhere to go clears the standard. */
      onAssign: (id, co) => issue({ c: 'assign', id, co }),
      /* TAKE COMMAND of a court of your realm: your taps drive THAT lord from now on — his
       * purse pays for what you build, his crews raise it, his companies answer your flags.
       * It is a client choice and not an order (nothing in the world changes), so it needs no
       * command and no wire: what it changes is whose hand is on the next tap. The lord you
       * step away from goes straight back to running himself under his standing order, which
       * is why leaving a court costs nothing but your attention. */
      /* asked of the VIEW, not the world: a guest holds no world and this is a client choice
       * about his own screen, so it must answer on his screen too */
      onTakeSeat: (cityIdx) => {
        const w = warView();
        if (!w || !game.war || !w.cities) return;
        const c = w.cities[cityIdx];
        if (!c || c.owner < 0 || World.realmOf(w, c.owner) !== World.realmOf(w, game.viewer)) {
          UI.banner(REFUSAL.held, 'warn'); return;
        }
        helm().hand = c.owner;
        game.armedFlag = null; clearPlacing();
        if (game.realm) REALM.save(game.realm);
        if (Render.lookAt) Render.lookAt(c.x, c.y);
        UI.banner('You command from ' + w.map.sites[c.site].name + ' — its purse is your purse',
                  'alert');
      },
      /* a lord's standing order, or its dismissal (mode null). Not a sim command — an order
       * only biases the brain that lord was already running — so it lives on the helm. */
      onSteward: (lord, mode, target) => {
        if (!game.realm) return;
        const helm = game.realm.helm || (game.realm.helm = { orders: {}, hand: 0 });
        if (!mode) delete helm.orders[lord];
        else helm.orders[lord] = Object.assign({ mode }, target != null ? { target } : null);
        REALM.save(game.realm);
      },
      /* ⚑ the door to the council, and the four things it can do from a row */
      onCouncil: () => {
        const d = councilData();
        if (!d) return;
        /* the land for the council's map: the renderer's own ground canvas, handed over rather
         * than baked again — see Render.groundImage. Null is fine; the marks draw on dark. */
        UI.mapGround = Render.groundImage ? Render.groundImage() : null;
        UI.council(d, councilHandlers);
      },
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
    };
    UI.init(H);
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
  /* test handle: how long the link has been silent. It winds back WHEN the last snapshot
   * landed — never what the rule makes of it — so a suite can drive the quiet and the dead
   * link through the shipping loop instead of sleeping through ten real seconds. */
  /* ...and what a guest REMEMBERS of the land. The mask is the guest's alone (a host's is in
   * its world, where a suite can already read it), and the veil's window is clamped to it, so
   * a mask cut to the wrong extents is a black screen with nothing else to measure. */
  global.Game = { game, startSP, startMP, startChapter, toChapters, toMenu, LADDER,
                  /* set the clock and ask the rule, in one synchronous call: the suite drives
                   * the RULE rather than the render loop, which is the only way to test a
                   * wall-clock rule on a machine slower than its own threshold */
                  debugQuiet: (secs) => { snapAt = performance.now() - secs * 1000; return linkCheck(); },
                  debugSeen: () => (guestSeen ? { gw: guestSeen.gw, gh: guestSeen.gh,
                                                  cell: guestSeen.cell, marks: guestSeen.v,
                                                  at: (x, y) => !!guestSeen.g[((y / guestSeen.cell) | 0)
                                                                * guestSeen.gw + ((x / guestSeen.cell) | 0)] }
                                             : null) };
})(typeof window !== 'undefined' ? window : globalThis);

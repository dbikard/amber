/* campaign.js — the succession told as chapters.
 *
 * WHAT THIS IS AND WHERE IT LIVES. A chapter is a hand-picked board, a named rival, a briefing
 * and an OBJECTIVE — and the objective is the only new machinery. `world.winner` is written in
 * one function in the sim with exactly two callers (the Pattern at a hundred, and the last Seat
 * standing); there is no third condition, no timer and no per-player goal state, and there must
 * not be. The sim is headless-first and the netcode is host-authoritative: a scripted chapter is
 * a single-player concern, so it is POLLED from game.js over the world it already holds, and it
 * ends a match through `World.declare` rather than by growing a rule inside `update`.
 *
 * IT IS HEADLESS-SAFE ANYWAY, and deliberately: an objective is a predicate over world state,
 * and a predicate that cannot be run in Node cannot be tested. Every one of them below is
 * exercised by `test/headless.js` against a real world with no browser in sight.
 *
 * HOW STARCRAFT DID IT, AND WHAT IS WORTH TAKING. Its missions were a fixed map plus a trigger
 * table — (conditions) → (actions) — and what made the campaign work was not the scale of that
 * table. Three things:
 *   (a) the first mission TAKES SYSTEMS AWAY rather than explaining them, and each later one
 *       hands one back, so the tutorial is the level design instead of a wall of tooltips;
 *   (b) the objective is stated BEFORE the board is, which is what makes a varied objective
 *       legible rather than confusing;
 *   (c) later missions change the WIN CONDITION, not the numbers.
 * Amber has three win conditions the genre does not: walk the Pattern before he does, hold the
 * springs through a surge of the black road, and break a Seat with an army that CANNOT BREAK
 * STONE — which is a lesson about `menOnly` taught by being made to feel it. */
(function (global) {
  'use strict';
  const C = global.CONST || (typeof require !== 'undefined' ? require('./const.js') : null);
  const CAMPAIGN = {};
  /* the words a player reads go through `tr` (i18n.js); a Node run without it reads English.
   * The CHAPTERS table stays English (its strings are the dictionary's keys); what this file
   * composes — the objective lines, the hints it hands out — it says in the page's tongue. */
  const tr = (s, v) => (global.tr ? global.tr(s, v)
    : (v ? String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? String(v[k]) : m)) : String(s)));
  /* a work's name, one or many: the plural is its own key ('Shadow Gates'), because French
   * does not make a plural by adding an s to the end of the phrase */
  const workName = (bt, n) => {
    const nm = (C.BUILDINGS[bt] || {}).name || bt;
    return n === 1 ? tr(nm) : tr(nm + 's');
  };

  /* ---------------- what a chapter can ask about the board ----------------
   * All of it is read off the world game.js already holds, unfogged, in single player. Nothing
   * here reaches into the sim or writes to it. */
  const World = () => global.World;
  /* springs an heir actually draws from: a FINISHED Gate standing on one */
  const springs = (w, me) =>
    w.players[me].buildings.filter((b) => b.node >= 0 && !b.raise).length;
  const works = (w, pi, bt) =>
    w.players[pi].buildings.filter((b) => b.bt === bt && !b.raise).length;
  const army = (w, me) => w.units.filter((u) => u.owner === me && u.hp > 0).length;
  /* everyone who is not you and not the weather */
  const rivals = (w, me) => w.players.map((q, i) => i).filter((i) => i !== me);

  /* ---------------- the objectives ----------------
   * Each is `{ line, check }`. `check(world, me, st)` returns 'won', 'lost' or null and may keep
   * anything it likes on `st`, which the caller hands back every tick and never inspects.
   * `line(world, me, st)` is the one sentence the HUD shows — it is asked every tick, so it says
   * where the player IS, not merely what was asked of him. */
  const OBJ = {};

  /* ---- WHAT IT ASKS, AND WHERE YOU STAND: TWO DIFFERENT SENTENCES ----
   * `line` is the HUD readout and is asked every tick OVER A REAL WORLD, so it may look
   * anything up — where the rival's Seat is, how many springs you draw from, how far along he
   * has walked. `ask` is the BRIEFING's sentence and there is no world yet: the chapter has not
   * started, and the screen is being drawn from the table alone.
   * They were one sentence, and the briefing screen fabricated a world to get it — an object
   * with two empty players and nothing else. That worked exactly as long as no objective looked
   * past a building list. The moment `raze` learned to ask which of his Gates stand out in
   * Shadow (`cityOf`), chapter II's briefing threw where it stood, and everything the screen
   * builds AFTER the objective line — the BEGIN button, the way back to the other chapters —
   * was never appended. Reported from play as "the menu disappeared": a chapter you could read
   * and could not start or leave. A briefing has no world, so it is not given one. */

  /* HOLD n SPRINGS, CONTINUOUSLY, FOR A WHILE. Taking one is a march; holding four while the
   * black road gnaws at them is a realm. `since` is cleared the moment the count slips, so this
   * cannot be satisfied by touching the number once. */
  OBJ.hold = (n, secs) => ({
    get ask() { return tr('Hold {n} springs of Shadow, and keep them for {secs} seconds', { n, secs }); },
    line: (w, me, st) => {
      const h = springs(w, me);
      if (h < n) return tr('Hold {n} springs — you draw from {h}', { n, h });
      const left = Math.max(0, secs - (w.t - st.since));
      return tr('Hold {n} springs — {s}s', { n, s: Math.ceil(left) });
    },
    check: (w, me, st) => {
      if (springs(w, me) < n) { st.since = -1; return null; }
      if (st.since < 0 || st.since == null) st.since = w.t;
      return w.t - st.since >= secs ? 'won' : null;
    }
  });

  /* RAISE SOMETHING. The plainest objective there is, and the right one for a first chapter:
   * it is satisfied by doing the thing the game is about and by nothing else. */
  OBJ.raise = (bt, n) => ({
    get ask() { return tr('Raise {n} {works}', { n, works: workName(bt, n) }); },
    line: (w, me) =>
      tr('Raise {n} {works} — you hold {h}', { n, works: workName(bt, n), h: works(w, me, bt) }),
    check: (w, me) => (works(w, me, bt) >= n ? 'won' : null)
  });

  /* THROW HIS WORKS DOWN — but only the ones he took OUT IN SHADOW.
   * Reported from play: chapter II was impossible, because one of his Gates stood so close to
   * his Seat that it could not be reached without fighting the throne. That is not the seed's
   * fault and no seed fixes it: EVERY heir opens with a finished Gate on a spring inside his
   * own writ (worldgen requires one usable spring within `CLAIM.seat`), so "every Gate" always
   * included one standing under his guns, and a chapter about taking an army out to break a
   * rival's wells always secretly demanded a Seat assault as well. Breaking a work on a heir's
   * own court IS breaking his Seat, and that is a different chapter.
   * So `beyond` — a work is his business out here only if it stands past the named distance
   * from his own Seat, and the writ is the honest line: a Gate beyond it is one he MARCHED for,
   * which is exactly what this chapter is about. */
  OBJ.raze = (bt, beyond) => {
    const far = beyond != null ? beyond : C.CLAIM.seat;
    const out = (w, me) => rivals(w, me).reduce((s, i) => {
      const c2 = World().cityOf(w, i);
      return s + w.players[i].buildings.filter((b) => b.bt === bt && !b.raise &&
        Math.hypot(b.x - c2.x, b.y - c2.y) >= far).length;
    }, 0);
    return {
      get ask() { return tr('Throw down every {work} he has taken out in Shadow', { work: workName(bt, 1) }); },
      line: (w, me) => {
        const left = out(w, me), wk = workName(bt, 2);
        return left === 1
          ? tr('Throw down his {works} out in Shadow — {left} still stands', { works: wk, left })
          : tr('Throw down his {works} out in Shadow — {left} still stand', { works: wk, left });
      },
      check: (w, me, st) => {
        if (out(w, me) > 0) { st.seen = true; return null; }
        /* he must have HAD one: a chapter cannot be won on the opening frame, before the rival
         * has marched out and taken anything */
        return st.seen ? 'won' : null;
      }
    };
  };

  /* STAND. The clock is the enemy's, not yours — losing your own Seat is a loss under the sim's
   * own rule and needs nothing here. */
  OBJ.survive = (secs) => ({
    get ask() { return tr('Hold your Seat of Power for {secs} seconds', { secs }); },
    line: (w, me, st) => tr('Hold your Seat — {s}s', { s: Math.max(0, Math.ceil(secs - w.t)) }),
    check: (w, me) => (w.t >= secs ? 'won' : null)
  });

  /* THE WALK — AND IT IS THE PLAYER'S, NOT A RACE.
   * "Walk the Pattern before he does" was the first version of this and it asked for something
   * the rules forbid. Every heir walks at the SAME rate — the Shrine has one, not one per level
   * — and a walk CANNOT be called off, so whoever steps on first arrives first, always. A rival
   * already on the lines when the chapter opens cannot be caught by any amount of play, and the
   * objective was unwinnable by its own stated route. Reported from play.
   * The cure is not a faster walk, it is a rival who is not walking: `noWalk` in his opts, which
   * the campaign already had. The chapter then teaches the road from the side the player can
   * actually steer — the drain that starves your muster, and a walk that tells the whole board
   * where your Shrine is while it runs. The sim ends a match at a hundred, so this only has to
   * name the road and say how far along you are. */
  OBJ.walk = () => ({
    get ask() { return tr('Walk the Pattern to its heart'); },
    line: (w, me) => tr('Walk the Pattern — {p}%', { p: w.players[me].pattern.toFixed(0) }),
    check: () => null
  });

  /* THE THRONE, which is the game's own condition and is here so a chapter can say so. */
  OBJ.seat = () => ({
    get ask() { return tr('Break his Seat of Power'); },
    line: () => tr('Break his Seat of Power'),
    check: () => null
  });

  /* BRING HIM DOWN. A chapter's champion (`bosses` in the table, raised by `World.spawnBoss`)
   * is known by name; the objective is won the tick he is gone, and not before he has come —
   * he may arrive at an hour of the chapter's choosing, and an empty board is no victory. */
  const bossesOf = (w, me, name) => w.units.filter((u) => u.boss === name && u.hp > 0 && u.owner !== me);
  OBJ.slay = (name) => ({
    get ask() { return tr('Bring down {who}', { who: tr(name) }); },
    line: (w, me, st) => {
      const b = bossesOf(w, me, name)[0];
      if (!b) return st.seen ? tr('{who} has fallen', { who: tr(name) })
                             : tr('{who} has not yet taken the field', { who: tr(name) });
      return tr('Bring down {who} — {p}% of his strength remains', { who: tr(name), p: Math.ceil(100 * b.hp / b.maxHp) });
    },
    check: (w, me, st) => {
      if (bossesOf(w, me, name).length) { st.seen = true; return null; }
      return st.seen ? 'won' : null;
    }
  });

  /* WRECK n OF HIS WORKS, ANY OF THEM. A TALLY, not a census: every rival work that was
   * standing and is now gone — or a run of his that now lies breached — counts once, wherever
   * it stood. Read by diffing the ids each tick, so nothing in the sim keeps score for it. */
  OBJ.wreck = (n) => {
    const standing = (w, me) => {
      const m = new Map();
      for (const i of rivals(w, me))
        for (const b of w.players[i].buildings) if (!b.raise && !b.breach) m.set(b.id, b);
      return m;
    };
    return {
      get ask() { return tr('Throw down {n} of his works — any of them, anywhere', { n }); },
      line: (w, me, st) => tr('Throw down {n} of his works — {k} so far', { n, k: Math.min(n, st.wrecked || 0) }),
      check: (w, me, st) => {
        const now = standing(w, me);
        if (st.prev) for (const id of st.prev.keys()) if (!now.has(id)) st.wrecked = (st.wrecked || 0) + 1;
        st.prev = now;
        return (st.wrecked || 0) >= n ? 'won' : null;
      }
    };
  };

  /* THE LAST HEIR STANDING — the sim's own ending on a table of three or four (a toppled heir
   * is out, the last Seat standing wins), here so the chapter can say how far along you are.
   * `pattern` names the other road as well, for a chapter where the rivals may walk it too. */
  OBJ.last = (pattern) => ({
    get ask() {
      return pattern ? tr('Win the succession — be the last heir standing, or walk the Pattern')
                     : tr('Be the last heir standing');
    },
    line: (w, me) => {
      const up = rivals(w, me).filter((i) => !w.players[i].out).length;
      return up === 1 ? tr('Be the last heir standing — one rival still stands')
                      : tr('Be the last heir standing — {k} rivals still stand', { k: up });
    },
    check: () => null
  });

  CAMPAIGN.OBJ = OBJ;

  /* ---------------- an extra way to lose ----------------
   * The sim's rule — your Seat falls — is always in force. A chapter may add one, and it is a
   * predicate of the same shape. */
  const FAIL = {};
  /* KEEP WHAT YOU WERE GIVEN. Reads "you had some of these and now you have none". */
  FAIL.lose = (bt) => ({
    line: (w, me) => tr('Do not lose your {work}', { work: workName(bt, 1) }),
    check: (w, me, st) => {
      const n = works(w, me, bt);
      if (n > 0) { st.had = true; return null; }
      return st.had ? 'lost' : null;
    }
  });
  CAMPAIGN.FAIL = FAIL;

  /* ---------------- the chapters ----------------
   * `seed` pins the ground so a chapter is the same board every time it is played — a story
   * wants its own country, not whatever the noise produced this morning. `opts` is merged OVER
   * the player's chosen footing, so a chapter may hold a rival back or let him off the leash
   * without taking the footing away from the player.
   * `hints` are the tutorial, and they are PREDICATES rather than timestamps: the onboarding
   * banners fire on `world.t` alone and say their piece whether or not the player has done the
   * thing. A hint with a `when` waits for the board to be true. */
  CAMPAIGN.CHAPTERS = [
    {
      key: 'road', title: 'I · The Shadow Road', heir: 'julian', seed: 0x5ade01,
      /* WHAT A CHAPTER HANDS YOU (`unlock`), cumulative down the table: everything the chapters
       * before it gave, and this. Building codes, branches as 'bt:br', powers by key — the same
       * words `rules.allow` takes (see `allowFor`). The opening Gate and hall are every heir's. */
      unlock: ['gate', 'barracks'],
      /* THE FIRST CHAPTER TAKES THINGS AWAY. The rival is rich enough to be alive and will not
       * march on your Seat inside the hour, so the board is quiet and the only question is the
       * one the game is actually about: the essence is out there, and you have to go and stand
       * on it. */
      opts: { eco: 0.45, hold: 3600, noWalk: 1 },
      brief: 'Oberon is gone and the black road is rising. You hold one spring and one hall, '
           + 'which is what any heir holds — and it is not a realm.\n\n'
           + 'Essence lies out in Shadow, at the springs. A Shadow Gate draws from one, and a '
           + 'Gate may only be raised where your own troops are standing.\n\n'
           + 'Take three springs. Julian will not trouble you yet.',
      obj: OBJ.raise('gate', 3),
      won: 'Three springs answer to you. A realm begins as a road between wells.',
      hints: [
        { when: (w) => w.t > 4, text: '⚐ TAP YOUR OWN TROOPS to pick up their standard, then tap where they should stand' },
        { when: (w, me) => w.units.some((u) => u.owner === me && u.co && (w.players[me].companies || []).some((c2) => c2.id === u.co && c2.rally)),
          text: 'Send them to a spring — the glowing pools out in Shadow' },
        { when: (w, me) => w.players[me].buildings.filter((b) => b.node >= 0).length >= 2,
          text: '🔨 A second Gate is a second income. Keep going — three of them takes the chapter' }
      ]
    },
    {
      key: 'muster', title: 'II · The Muster', heir: 'bleys', seed: 0x5ade02,
      unlock: ['barracks:raid'],
      opts: { eco: 0.75, hold: 420, noWalk: 1 },
      brief: 'Bleys of the Flame is taking Shadow while you count your wells. He raises his '
           + 'Gates in the open and trusts his host to keep them.\n\n'
           + 'A mustering hall flies a standard of its own, and the tray at your thumb is one '
           + 'chip per company. Raise halls, arm a standard, and send it.\n\n'
           + 'Throw down the Gates he has taken out in Shadow. The well under his own guns is '
           + 'a matter for another day.',
      obj: OBJ.raze('gate'),
      won: 'His wells are broken and his muster runs dry. An army is for taking things.',
      hints: [
        { when: (w, me) => (w.players[me].companies || []).length >= 2,
          text: '⚐ Two standards — one may take ground while the other fights' },
        { when: (w, me) => w.units.filter((u) => u.owner === me).length >= 12,
          text: '⚔ His Gates stand on springs. Find them, and plant a standard on one' },
        { when: (w, me) => w.players[me].buildings.some((b) => b.bt === 'barracks' && !b.raise && b.level === 1) && w.players[me].essence >= 140,
          text: '⚔ A Barracks at level 2 may become Outriders — quick, cheap, made for burning Gates' }
      ]
    },
    {
      key: 'curtain', title: 'III · The Curtain', heir: 'benedict', seed: 0x5ade03,
      unlock: ['wall', 'barracks:archer'],
      /* the Master of Arms, off the leash early: this chapter is the assault */
      opts: { eco: 1.0, hold: 90, noWalk: 1 },
      brief: 'Benedict is coming, and he is coming soon. You will not out-muster the Master of '
           + 'Arms in the open field.\n\n'
           + 'Stone is the answer. A Curtain Wall is drawn as a RUN — tap where it starts, then '
           + 'where it ends — and it bars the ground to everyone but you. Archers posted to it '
           + 'take the parapet and throw from cover; everyone else forms ranks at its foot.\n\n'
           + 'Hold your Seat for eight minutes.',
      obj: OBJ.survive(480),
      won: 'The Master of Arms broke on your stone. A wall is an army that never tires.',
      hints: [
        { when: (w) => w.t > 5, text: '🔨 BUILD → Curtain Wall. Tap where the run starts, then where it ends' },
        { when: (w, me) => w.players[me].buildings.some((b) => b.bt === 'wall' && !b.raise),
          text: '⚐ Send a company to the wall — archers climb it, the rest hold its foot' },
        { when: (w) => w.t > 40, text: '🏹 Archers: upgrade a Barracks to level 2 and choose the Butts' }
      ]
    },
    {
      /* ---- IV · THE WATCH ----
       * Towers, taught by being raided. Brand at the footing's own pace, but his doctrine RAIDS
       * — he goes for outlying Gates — so a Gate with nothing standing over it is a Gate he
       * takes. The objective counts springs held for a long while, so every Gate lost resets
       * the clock: the lesson is that forward wealth is bought with stone and a garrison. */
      key: 'watch', title: 'IV · The Watch', heir: 'brand', seed: 0x5ade08,
      unlock: ['tower', 'tower:bolt', 'tower:cannon', 'barracks:line'],
      opts: { eco: 0.85, hold: 240, noWalk: 1 },
      brief: 'Brand the Unmaker does not want your throne yet. He wants your WELLS — he sends '
           + 'small, fast companies at whatever Gate stands farthest from your guns, burns it, '
           + 'and is gone before your host arrives.\n\n'
           + 'A Watchtower sees far over Shadow and shoots what comes into reach. Archers and '
           + 'sorcerers sent to one go INSIDE it, where nothing can touch them until the stone '
           + 'falls. At level 2 it is rebuilt for good: a ballista for one great foe, a cannon '
           + 'for a column.\n\n'
           + 'Hold three springs, and keep all three for four minutes together.',
      obj: OBJ.hold(3, 240),
      won: 'Your wells stand under stone, and the Unmaker\'s raiders learned to count towers.',
      hints: [
        { when: (w) => w.t > 6, text: '♜ BUILD → Watchtower. Raise one beside a Gate out in Shadow' },
        { when: (w, me) => w.players[me].buildings.some((b) => b.bt === 'tower' && !b.raise),
          text: '⚐ Plant a company\'s standard on the tower — its archers climb inside' },
        { when: (w, me) => w.players[me].buildings.some((b) => b.bt === 'barracks' && !b.raise && b.level === 1) && w.t > 120,
          text: '🛡 A Shieldwall Barracks raises fewer men who survive the blow that kills a soldier' }
      ]
    },
    {
      key: 'blackroad', title: 'V · The Black Road', heir: 'brand', seed: 0x5ade04,
      unlock: ['storm'],
      opts: { eco: 0.9, hold: 300, noWalk: 1 },
      /* THE ROAD SENDS ITS OWN. A fiend grown huge comes out of the black road at four minutes
       * and walks at the nearest city like any fiend — Chaos's, so it hates Brand exactly as
       * much as it hates you, and where it walks is the whole question. */
      bosses: [{ name: 'The Hound of Chaos', owner: C.CHAOS_ID, kind: 'fiend', hp: 40, dmg: 5, big: 2.6, at: 240 }],
      brief: 'The black road is open and Chaos is spilling through it. Brand the Unmaker is '
           + 'content to let it come — every fiend that gnaws your Gates is one he need not '
           + 'pay for.\n\n'
           + 'Chaos is the weather. It cannot take your Seat, and it will take everything else '
           + 'if you let it: a forward Gate is exactly what it comes for, and the men who took '
           + 'the spring are its garrison.\n\n'
           + 'Draw from four springs, and keep all four for two minutes together.',
      obj: OBJ.hold(4, 120),
      won: 'Four wells held through the storm. The road gives nothing back that is guarded.',
      hints: [
        { when: (w) => w.t > 6, text: '🌀 A company left standing on a spring is what keeps its Gate' },
        { when: (w) => (w.storms || []).length > 0 || w.t > 150,
          text: '⚡ The Jewel calls down a storm — it is worth more on a rival than on the weather' },
        { when: (w) => w.t > 236, text: '☠ Something enormous is coming up the black road. Do not meet it alone' }
      ]
    },
    {
      /* ---- VI · THE SPIRE ----
       * Sorcery, and a boss to spend it on. Brand himself takes the field at three minutes —
       * one man, but a man the size of a tower who mows down soldiers. Sorcerers are made for
       * men (he IS one, so they can hit him); a Binder's chains slow him and make every blow on
       * him land harder; a Warden keeps the line in front of him standing. The chapter is won
       * the moment he falls, so it is a fight, not a siege. */
      key: 'spire', title: 'VI · The Spire', heir: 'brand', seed: 0x5ade09,
      unlock: ['spire', 'spire:warden', 'spire:binder'],
      opts: { eco: 0.9, hold: 200, noWalk: 1 },
      bosses: [{ name: 'Brand the Unmaker', owner: 1, kind: 'champion', hp: 9, dmg: 2.2, big: 1.9, at: 180 }],
      brief: 'Brand has tired of sending others. He is coming himself — and the Unmaker in '
           + 'his wrath is worth an army: no line of soldiers has stood against him for long.\n\n'
           + 'But he is a MAN, and men can be undone. A Sorcery Spire sends Sorcerers, fragile '
           + 'and deadly at range against anything of flesh. At level 2 it turns to one art: '
           + 'WARDENS mend the men beside them, and BINDERS chain a foe so he walks slower and '
           + 'every blow on him lands harder.\n\n'
           + 'Bring down Brand the Unmaker.',
      obj: OBJ.slay('Brand the Unmaker'),
      won: 'The Unmaker is unmade, at least for today. Sorcery has its uses.',
      hints: [
        { when: (w) => w.t > 6, text: '🜏 BUILD → Sorcery Spire. Its sorcerers shred men, and are useless against stone' },
        { when: (w, me) => w.players[me].buildings.some((b) => b.bt === 'spire' && !b.raise),
          text: '🌘 Upgrade the Spire: Binders chain him, Wardens keep your line alive' },
        { when: (w) => w.units.some((u) => u.boss === 'Brand the Unmaker'),
          text: '☠ Brand takes the field. Hold him with men in front and sorcery behind' }
      ]
    },
    {
      key: 'pattern', title: 'VII · The Pattern', heir: 'bleys', seed: 0x5ade05,
      /* HE DOES NOT WALK, AND THE CHAPTER SAYS SO. Written the other way round first — the
       * rival already on the lines, you told to walk it before he did — and it was unwinnable
       * by its own stated route, because every heir walks at one rate and a walk cannot be
       * called off. Reported from play. This is the same lesson from the side the player can
       * steer: the road is his to take, and what it costs is the whole difficulty.
       * IT IS CHAPTER II'S RIVAL AT CHAPTER II'S FOOTING, deliberately and to the number. The
       * chapter adds nothing to him because it does not need to — a walk is 22 essence a second
       * for five and a half minutes, taken before a single recruit is paid for, which is a
       * heavier handicap than any footing in this file. Measured on this board with a heir
       * standing in for the player: he steps on at 3.6m and is 85% along when his Seat falls at
       * 8.0m. A near miss for a bot who does not think to garrison his own Shrine. */
      unlock: ['shrine'],
      opts: { eco: 0.75, hold: 420, noWalk: 1 },
      brief: 'Bleys of the Flame again, with the same realm behind him as the day you burned '
           + 'his forward wells. Nothing about him has changed — and he has no patience for the '
           + 'lines, so he will not be walking anywhere. The other road is yours alone.\n\n'
           + 'What has changed is what you mean to do while he comes. A walk drains your '
           + 'essence BEFORE your halls are paid: step on early and you muster nobody for five '
           + 'and a half minutes. Take springs first — the Pattern is bought with Shadow Gates.\n\n'
           + 'And a walk is a public act. The moment you set foot on the lines your Shrine '
           + 'burns on every board in the game, so he will know exactly where to send his army; '
           + 'throw the Shrine down and the walker is torn off the Pattern. It cannot be called '
           + 'off, and there is no second attempt inside one match.\n\n'
           + 'Walk the Pattern to its heart.',
      obj: OBJ.walk(),
      won: 'You walked it to its blazing heart and spoke your name. The universe rearranges.',
      hints: [
        { when: (w, me) => w.players[me].buildings.filter((b) => b.bt === 'gate' && !b.raise).length >= 3
                           && !w.players[me].buildings.some((b) => b.bt === 'shrine'),
          text: '✴ Three springs will carry the drain — raise a Pattern Shrine and step on' },
        { when: (w, me) => w.players[me].walking,
          text: '⚔ He can see your Shrine now — keep an army on it. Break it and the walk stops, '
              + 'and you lose ground you have already paid for' }
      ]
    },
    {
      /* ---- VI · THE TRUCE ----
       * The one chapter that teaches a rule by giving it to you and then taking it away. It
       * opens with terms already standing — `rules.truce` on and `opts.pact` sealing them — so
       * the board begins quiet and the lesson is what quiet is FOR: an heir at peace is not a
       * foe, his men walk past yours, and every second of it is a second you are not paying for
       * an army. And it ends when Bleys decides it does. Nothing scripts that: it is his own
       * doctrine, which takes any terms offered while he is still mustering and withdraws them
       * the moment he has fourteen men to spend. `CAMPAIGN.run` never writes to the world and
       * this chapter does not make it start — the betrayal is the RIVAL's, on his own clock,
       * exactly as it would be in a skirmish.
       * The objective is springs and not a Seat, deliberately: what the truce buys is TIME, and
       * the chapter has to be won by having spent it on something. */
      key: 'truce', title: 'VIII · The Truce', heir: 'bleys', seed: 0x5ade07,
      unlock: ['trump'],
      opts: { eco: 0.9, hold: 200, rules: { truce: 1 }, pact: [1] },
      brief: 'Bleys again, and this time he sends a herald before he sends a column. Terms: '
           + 'neither of you lifts a hand against the other. They are already sworn — you will '
           + 'find them in the corner of your board, and while they stand his men will walk '
           + 'past yours without a blow struck.\n\n'
           + 'Understand what you have bought. Not safety — TIME. An heir at peace needs no '
           + 'army to hold what he has, so every drop of essence that would have gone into a '
           + 'hall can go into the ground instead. Take springs. Take all of them.\n\n'
           + 'And understand what you have sold. He is raising men with the same quiet you '
           + 'are, and the Flame has never yet kept a promise longer than it was useful to '
           + 'him. There is no notice and there is no grace: the first you will know of it is '
           + 'your men dying. Tap his name to break first, if you think you can read the hour.\n\n'
           + 'Hold four springs of Shadow, and keep them for two minutes.',
      obj: OBJ.hold(4, 120),
      won: 'The wells of Shadow answer to you, and Bleys of the Flame has learned what his '
         + 'word is worth to a brother who was counting.',
      hints: [
        { when: (w) => w.t > 8,
          text: '⚑ TERMS STAND, top right — while they do, neither of you may strike the other' },
        { when: (w, me) => w.players[me].buildings.filter((b) => b.bt === 'gate' && !b.raise).length >= 2,
          text: '◆ Peace is time. Spend it on the ground, not on halls you do not yet need' },
        { when: (w, me) => !World().pactOn(w, me, 1),
          text: '⚔ The truce is over — he has been mustering the whole time you were digging' },
        { when: (w) => w.t > 30, text: '🃏 The Trump of Benedict calls the family champion to your Seat — one at a time' }
      ]
    },
    {
      /* ---- IX · THE WORKS ----
       * Stone, and what breaks it. Julian builds: towers on his vantages, stone at his court,
       * and every Gate he loses brings a tower after it. Archers and sorcerers cannot scratch
       * any of it (`menOnly`) — the chapter is the lesson the throne will ask for in earnest,
       * given early and with a tally rather than a Seat. */
      key: 'works', title: 'IX · The Works', heir: 'julian', seed: 0x5ade0a,
      unlock: ['siege', 'siege:ram', 'siege:bombard'],
      opts: { eco: 1.0, hold: 300, noWalk: 1 },
      brief: 'Julian, Warden of Arden, does not come out to fight. He builds — Gates under '
           + 'towers, towers on every rise, stone wherever you have hurt him.\n\n'
           + 'Your archers and sorcerers can do nothing to any of it: a shooter has no target '
           + 'among works at all. A Siege Works builds Engines, slow and made for stone; at '
           + 'level 2 the yard is re-tooled for RAMS, which must reach the wall to swing, or '
           + 'BOMBARDS, guns on carts that must be escorted under the towers\' reach.\n\n'
           + 'Throw down six of his works, any of them, anywhere.',
      obj: OBJ.wreck(6),
      won: 'Arden\'s stone lies in the grass. Nothing Julian raises will stand for long now.',
      hints: [
        { when: (w) => w.t > 6, text: '⚒ BUILD → Siege Works. Its Engines are what stone fears' },
        { when: (w, me) => w.units.some((u) => u.owner === me && (u.kind === 'engine' || u.kind === 'ram' || u.kind === 'bombard')),
          text: '⚔ Send the engines WITH a company — alone they die before they swing' }
      ]
    },
    {
      /* ---- X · THE THREE ----
       * The first table of more than two: Bleys and Brand both, each the other's enemy as
       * much as yours. Nobody walks, so it is settled by Seats — and a rival who breaks the
       * other first comes out of it richer, so who you let fight whom is the chapter. */
      key: 'three', title: 'X · The Three', heir: 'bleys', rivals: ['brand'], seed: 0x5ade0b,
      opts: { players: 3, eco: 1.0, hold: 240, noWalk: 1 },
      brief: 'The family does not wait its turn. Bleys and Brand have both taken the field, '
           + 'and each would rather see the other broken than you — for now.\n\n'
           + 'Three heirs, three Seats, and every man is everyone\'s enemy. A Seat that falls '
           + 'puts its heir out of the succession for good. Let them bleed each other if you '
           + 'can; strike the weaker when you must.\n\n'
           + 'Be the last heir standing.',
      obj: OBJ.last(false),
      won: 'Two brothers broken, and the third road is yours. The family will remember it.',
      hints: [
        { when: (w) => w.t > 8, text: '⚐ Two rivals: they fight each other as gladly as they fight you' },
        { when: (w, me) => w.players.some((q, i) => i !== me && q.out),
          text: '⚔ One rival is out. The other has his ground now — strike before he holds it' }
      ]
    },
    {
      key: 'throne', title: 'XI · The Throne', heir: 'benedict', seed: 0x5ade06,
      /* no leash at all: the heir the other heirs face — and at seven minutes, the Master of
       * Arms himself, at the head of his host */
      opts: { eco: 1.0, hold: 60 },
      bosses: [{ name: 'Benedict, Master of Arms', owner: 1, kind: 'champion', hp: 11, dmg: 2.8, big: 2.0, at: 420 }],
      brief: 'Nothing is held back now. Benedict, Master of Arms, with a realm behind him and '
           + 'no reason to wait.\n\n'
           + 'A Seat is two and a half thousand hit points behind whatever he has raised around '
           + 'it, and a host of archers cannot scratch it — a shooter has no target among works '
           + 'at all. Bring something that breaks stone.\n\n'
           + 'Take the throne.',
      obj: OBJ.seat(),
      won: 'Amber is yours. The Pattern holds, and the black road answers to a name again.',
      hints: [
        { when: (w) => w.t > 10, text: '⚒ A Siege Works raises Rams and Bombards — they are what stone fears' },
        { when: (w) => w.t > 412, text: '☠ Benedict rides out himself. Chain him, storm him — do not trade swords with him' }
      ]
    },
    {
      /* ---- XII · THE SUCCESSION ----
       * Everything, at once: three heirs, every road open to everyone, and the black road's
       * own champion late in the day. Nothing here is new machinery — it is the whole game,
       * asked for in earnest. */
      key: 'succession', title: 'XII · The Succession', heir: 'benedict', rivals: ['bleys', 'brand'],
      seed: 0x5ade0c,
      opts: { players: 4, eco: 1.0, hold: 120 },
      bosses: [{ name: 'The Serpent of Chaos', owner: C.CHAOS_ID, kind: 'fiend', hp: 70, dmg: 7, big: 3.2, at: 600 }],
      brief: 'Benedict, Bleys and Brand. Every heir who still lives has come to the board, '
           + 'and nothing is held back from any of them: the halls, the stone, the engines, '
           + 'the Jewel — and the Pattern, which any of them may walk the moment he dares.\n\n'
           + 'Watch the board as much as the field. A rival on the lines burns on every map, '
           + 'and the others will turn on him; so will you, or he will be king. And late in '
           + 'the day the black road sends the Serpent, which serves nobody.\n\n'
           + 'Win the succession.',
      obj: OBJ.last(true),
      won: 'The last of them is broken. Amber has a king again, and the Pattern knows his name.',
      hints: [
        { when: (w) => w.t > 8, text: '✴ Every heir may walk the Pattern here — watch the board, top right' },
        { when: (w) => w.players.some((q) => q.walking),
          text: '⚔ Somebody is on the lines. Whoever is walking is everybody\'s enemy' },
        { when: (w) => w.t > 596, text: '☠ The Serpent of Chaos is loose. It serves nobody — let it find your rivals first' }
      ]
    }
  ];

  CAMPAIGN.byKey = (k) => CAMPAIGN.CHAPTERS.find((c2) => c2.key === k) || null;
  CAMPAIGN.indexOf = (k) => CAMPAIGN.CHAPTERS.findIndex((c2) => c2.key === k);

  /* ---------------- progress ----------------
   * One key with a schema and a version, because there was none: the old ladder was a bare
   * integer under `amber_rung` and had nowhere to put a second fact. Everything is wrapped —
   * a private-mode browser throws on `localStorage` and a menu that cannot be drawn is worse
   * than a campaign that cannot be remembered. */
  const KEY = 'amber_campaign';
  CAMPAIGN.progress = function () {
    try {
      const raw = global.localStorage && global.localStorage.getItem(KEY);
      const p = raw ? JSON.parse(raw) : null;
      if (p && p.v === 1 && Array.isArray(p.done)) return p;
    } catch (e) { /* unreadable or private: start clean rather than fail to open the menu */ }
    return { v: 1, done: [] };
  };
  CAMPAIGN.cleared = (k) => CAMPAIGN.progress().done.indexOf(k) >= 0;
  CAMPAIGN.clear = function (k) {
    const p = CAMPAIGN.progress();
    if (p.done.indexOf(k) < 0) p.done.push(k);
    try { global.localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {}
    return p;
  };
  /* A CHAPTER IS OPEN IF THE ONE BEFORE IT IS DONE. The first is always open, and a cleared
   * chapter stays open — a level you liked is a level you may play again. */
  /* ...AND A CLEARED CHAPTER IS OPEN WHATEVER WAS INSERTED BEFORE IT. Chapters were added
   * between old ones (2026-10): a player who had cleared the old fourth keeps it open even
   * though the new fourth, before it now, is not done. */
  CAMPAIGN.open = function (k) {
    const i = CAMPAIGN.indexOf(k);
    if (i <= 0) return true;
    return CAMPAIGN.cleared(k) || CAMPAIGN.cleared(CAMPAIGN.CHAPTERS[i - 1].key);
  };
  /* the first chapter not yet cleared — what the menu button offers */
  CAMPAIGN.next = function () {
    return CAMPAIGN.CHAPTERS.find((c2) => !CAMPAIGN.cleared(c2.key)) || null;
  };
  /* ---------------- what each chapter hands you ----------------
   * `unlock` is cumulative down the table: a chapter allows everything every chapter before it
   * unlocked, and its own. `allowFor` is that list as `rules.allow` takes it, or null once
   * nothing is held back any more — so the last chapters play the whole game by the same door
   * a skirmish does. */
  const everything = () => {
    const all = [];
    for (const bt of C.BUILD_ORDER_UI) {
      all.push(bt);
      for (const br of C.BUILDINGS[bt].branchUI || []) all.push(bt + ':' + br);
    }
    for (const k of Object.keys(C.POWERS)) all.push(k);
    return all;
  };
  CAMPAIGN.allowFor = function (chapter) {
    const i = CAMPAIGN.CHAPTERS.indexOf(chapter);
    const got = new Set();
    for (let k = 0; k <= (i < 0 ? CAMPAIGN.CHAPTERS.length - 1 : i); k++)
      for (const u of CAMPAIGN.CHAPTERS[k].unlock || []) got.add(u);
    const all = everything();
    return all.every((u) => got.has(u)) ? null : all.filter((u) => got.has(u));
  };
  CAMPAIGN.unlocksOf = (chapter) => (chapter.unlock || []).slice();
  /* the name a player reads for an unlock key: the work, the branch's own name, or the power */
  CAMPAIGN.unlockLabel = function (key) {
    const cut = key.indexOf(':');
    if (cut > 0) {
      const b2 = C.BUILDINGS[key.slice(0, cut)].branches[key.slice(cut + 1)];
      return b2.icon + ' ' + tr(b2.short || b2.name);
    }
    const d = C.BUILDINGS[key] || C.POWERS[key];
    return d ? d.icon + ' ' + tr(d.name) : key;
  };

  CAMPAIGN.reset = function () {
    try { global.localStorage.removeItem(KEY); } catch (e) {}
  };

  /* ---------------- the runner ----------------
   * Held by game.js for the length of a chapter. `tick` is called once per simulated frame with
   * the world it already has, and answers 'won', 'lost' or null. It never writes to the world:
   * ending the match is the caller's to do, through `World.declare`. */
  CAMPAIGN.run = function (chapter, me) {
    const st = { since: -1 }, fst = {}, fired = [];
    return {
      chapter,
      line: () => null,
      tick(world) {
        if (!world || world.winner !== null) return null;
        if (chapter.fail) {
          const f = chapter.fail.check(world, me, fst);
          if (f) return f;
        }
        return chapter.obj.check(world, me, st);
      },
      /* what the HUD shows, asked fresh every frame so it can count down */
      say(world) {
        return world ? chapter.obj.line(world, me, st) : null;
      },
      /* the tutorial: the first hint whose moment has come, once each, in order */
      hint(world) {
        if (!world || !chapter.hints) return null;
        for (let i = 0; i < chapter.hints.length; i++) {
          if (fired[i]) continue;
          const h = chapter.hints[i];
          if (!h.when(world, me)) continue;
          /* IN ORDER. A later hint whose moment arrives first waits for the ones before it —
           * they are a lesson, not a set of alarms, and a lesson read out of order is noise. */
          for (let k = 0; k < i; k++) if (!fired[k]) return null;
          fired[i] = 1;
          return tr(h.text);
        }
        return null;
      }
    };
  };

  global.CAMPAIGN = CAMPAIGN;
  if (typeof module !== 'undefined' && module.exports) module.exports = CAMPAIGN;
})(typeof window !== 'undefined' ? window : globalThis);

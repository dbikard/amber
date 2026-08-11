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
    ask: `Hold ${n} springs of Shadow, and keep them for ${secs} seconds`,
    line: (w, me, st) => {
      const h = springs(w, me);
      if (h < n) return `Hold ${n} springs — you draw from ${h}`;
      const left = Math.max(0, secs - (w.t - st.since));
      return `Hold ${n} springs — ${Math.ceil(left)}s`;
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
    ask: `Raise ${n} ${(C.BUILDINGS[bt] || {}).name || bt}${n === 1 ? '' : 's'}`,
    line: (w, me) => {
      const d = C.BUILDINGS[bt];
      return `Raise ${n} ${d ? d.name : bt}${n === 1 ? '' : 's'} — you hold ${works(w, me, bt)}`;
    },
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
      ask: `Throw down every ${(C.BUILDINGS[bt] || {}).name || bt} he has taken out in Shadow`,
      line: (w, me) => {
        const d = C.BUILDINGS[bt], left = out(w, me);
        return `Throw down his ${d ? d.name : bt}s out in Shadow — ${left} still stand${left === 1 ? 's' : ''}`;
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
    ask: `Hold your Seat of Power for ${secs} seconds`,
    line: (w, me, st) => `Hold your Seat — ${Math.max(0, Math.ceil(secs - w.t))}s`,
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
    ask: 'Walk the Pattern to its heart',
    line: (w, me) => `Walk the Pattern — ${w.players[me].pattern.toFixed(0)}%`,
    check: () => null
  });

  /* THE THRONE, which is the game's own condition and is here so a chapter can say so. */
  OBJ.seat = () => ({
    ask: 'Break his Seat of Power',
    line: () => 'Break his Seat of Power',
    check: () => null
  });

  CAMPAIGN.OBJ = OBJ;

  /* ---------------- an extra way to lose ----------------
   * The sim's rule — your Seat falls — is always in force. A chapter may add one, and it is a
   * predicate of the same shape. */
  const FAIL = {};
  /* KEEP WHAT YOU WERE GIVEN. Reads "you had some of these and now you have none". */
  FAIL.lose = (bt) => ({
    line: (w, me) => `Do not lose your ${(C.BUILDINGS[bt] || {}).name || bt}`,
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
          text: '⚔ His Gates stand on springs. Find them, and plant a standard on one' }
      ]
    },
    {
      key: 'curtain', title: 'III · The Curtain', heir: 'benedict', seed: 0x5ade03,
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
          text: '⚐ Send a company to the wall — archers climb it, the rest hold its foot' }
      ]
    },
    {
      key: 'blackroad', title: 'IV · The Black Road', heir: 'brand', seed: 0x5ade04,
      opts: { eco: 0.9, hold: 300, noWalk: 1 },
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
          text: '⚡ The Jewel calls down a storm — it is worth more on a rival than on the weather' }
      ]
    },
    {
      key: 'pattern', title: 'V · The Pattern', heir: 'bleys', seed: 0x5ade05,
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
      key: 'truce', title: 'VI · The Truce', heir: 'bleys', seed: 0x5ade07,
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
          text: '⚔ The truce is over — he has been mustering the whole time you were digging' }
      ]
    },
    {
      key: 'throne', title: 'VII · The Throne', heir: 'benedict', seed: 0x5ade06,
      /* no leash at all: the heir the other heirs face */
      opts: { eco: 1.0, hold: 60 },
      brief: 'Nothing is held back now. Benedict, Master of Arms, with a realm behind him and '
           + 'no reason to wait.\n\n'
           + 'A Seat is two and a half thousand hit points behind whatever he has raised around '
           + 'it, and a host of archers cannot scratch it — a shooter has no target among works '
           + 'at all. Bring something that breaks stone.\n\n'
           + 'Take the throne.',
      obj: OBJ.seat(),
      won: 'Amber is yours. The Pattern holds, and the black road answers to a name again.',
      hints: [
        { when: (w) => w.t > 10, text: '⚒ A Siege Works raises Rams and Bombards — they are what stone fears' }
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
  CAMPAIGN.open = function (k) {
    const i = CAMPAIGN.indexOf(k);
    if (i <= 0) return true;
    return CAMPAIGN.cleared(CAMPAIGN.CHAPTERS[i - 1].key);
  };
  /* the first chapter not yet cleared — what the menu button offers */
  CAMPAIGN.next = function () {
    return CAMPAIGN.CHAPTERS.find((c2) => !CAMPAIGN.cleared(c2.key)) || null;
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
          return h.text;
        }
        return null;
      }
    };
  };

  global.CAMPAIGN = CAMPAIGN;
  if (typeof module !== 'undefined' && module.exports) module.exports = CAMPAIGN;
})(typeof window !== 'undefined' ? window : globalThis);

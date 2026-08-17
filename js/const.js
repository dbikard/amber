/* const.js — content definition tables. Headless-safe. Balance lives here; sim.js is the referee. */
(function (global) {
  'use strict';

  const CONST = {};

  CONST.SIM_DT = 1 / 30;          // fixed timestep (browser + sim identical)
  /* the city is a real place: a walled disc with the Tower of the Seat at its heart */
  /* seatR is the Seat-tower's own ground: no work may stand inside it, and a tap inside it
   * opens the Seat's sheet. ONE number, so the two can never disagree — they did, and the
   * ring between them was buildable ground you could not tap. */
  CONST.CITY = { r: 150, seatR: 74,
                 homeAggro: 140,   // extra acquire reach inside your own city's r — an open city's garrison sees trouble coming
                 /* HOW A YIELDED CITY IS TAKEN (`rules.occupy`). `court` is the ground you must
                  * be standing on — the Seat's own, so it is the disc the game already draws and
                  * the player already reads. `take` is how long, uncontested, and it is
                  * deliberately long enough that a raid cannot do it in passing: BREAKING a place
                  * and HOLDING it are meant to be different problems, and that difference is the
                  * whole reason a Seat yields rather than falling. `back` is what the throne comes
                  * back at, which is what stops one conquest paying for the next. */
                 court: 150, take: 20, back: 0.35,
                 /* ---- A THRONE LEFT ALONE MENDS ITSELF ----
                  * Reported from play: a castle knocked down to a sliver stayed there for the
                  * rest of the match, so one early raid nobody could answer permanently halved
                  * a heir's last line — and in a WAR, where a Seat yields instead of ending the
                  * match, a court could sit at 5% forever with no way to make it defensible
                  * again. There is no other repair for it: `{c:'fix'}` mends a breached curtain
                  * and the Wardens mend men, but the Seat is not in `pl.buildings` at all and
                  * nothing in the game could touch its hp upward.
                  * `mend` is stated as the TIME a whole throne takes rather than a rate, because
                  * that is the sentence a player can hold in his head — five minutes of peace
                  * from nothing to whole, on a match whose median is about ten. Fast enough that
                  * surviving a raid means something, far too slow to out-heal an assault: the
                  * cheapest siege line in the game does more damage in a second than this
                  * returns in twenty.
                  * HOW LONG AFTER THE LAST BLOW is not a new number: it is `STRUCT_REGEN_WAIT`,
                  * the same wait every other work already observes. Only the RATE is the Seat's
                  * own, because `STRUCT_REGEN` is 2 hp/s and a throne is 2,500 — the shared
                  * constant would mend it in twenty-one minutes, which on a ten-minute median is
                  * a rule that exists and never bites. Without the wait the mend fights the
                  * assault directly and every siege becomes an arithmetic problem at the margin
                  * instead of a fight; with it, a throne under attack is simply under attack. */
                 mend: 300 };

  /* ---- Free placement (open world, stage 4) ----
   * You may raise a work anywhere your writ runs, on ground that will bear it. Your writ is
   * the Seat's own country plus the country around every Shadow Gate you hold — so expanding
   * what you can build IS taking the map, which is the anti-stall model in one rule. */
  /* There is no `sworn` radius any more. A conquered court used to be a second capital for
   * its taker, held on a thin skirt of writ so it stayed a liability; it has its own LORD
   * again — sworn, not annexed — and a lord is entitled to the whole of his own country. One
   * radius, and it is the one every seat has always had. */
  CONST.CLAIM = { seat: 430, gate: 300 };
  /* There is no ceiling on how many works an heir may hold — hold as much country as you can
   * defend. What is rationed is the MASONS: one work rises at a time, and it takes time to
   * rise. An unfinished work is a shell — it earns nothing, musters nobody, shoots at nothing
   * and claims no ground — but it can be broken, so an over-reach can be punished. */
  CONST.RAISE = { hpFrom: 0.25 };   // a shell starts at this fraction of its finished hp
  /* THE MASONS FOLLOW THE GATES. One work at a time was a clean rule and a hard ceiling on
   * spending: works absorb at most ~14.6 essence a second, and a realm in full flow earns
   * fifty. A treasury with nowhere to go is a treasury that has stopped being a decision —
   * which is exactly what two chronicles from play showed, twenty-two thousand and eleven
   * thousand essence banked in matches that were lost.
   * So the crews are hired out of the ground you hold: every `per` finished Shadow Gates buys
   * another. It is the same anti-stall model as the writ — taking the map is what lets you
   * build — and it cannot run away, because Gates are finite and contested.
   * Crews multiply TEMPO as well as spending, and only the second was ever the point: at four
   * crews on the old timings a mirror finished in 10.3m against a 15-30 target. So every work
   * takes about 40% longer to raise. Four crews at the slower pace still absorb 43 essence a
   * second against the single crew's 15 — the ceiling the chronicles kept hitting — while a
   * realm grows at something near the old rate. */
  /* ONE CREW PER GATE. The yard grows with the realm — and since every heir opens with a Gate
   * on his own spring, that first Gate is his first crew. `base` is zero on purpose: the crews
   * come from the ground you hold, all of them.
   * BUT NEVER NONE. An heir whose last Gate is thrown down has no crews, and with no crews he
   * cannot raise the Gate that would hire one — a dead end the board offers no way out of, so
   * he sits and watches. `floor` is the way back: the last crew never leaves. It bites only at
   * zero Gates, since one Gate already buys one crew, so the yard is unchanged for anyone
   * still holding ground. */
  CONST.MASONS = { base: 0, per: 1, max: 4, floor: 1 };

  /* ---- EVERYONE PLAYS THE SAME GAME, AND A FOOTING IS A QUALITY OF MIND ----
   * The designer's rule (2026-08-17): every seat at the table — bot or human, contender or
   * minor lord — earns by the same economy and lives under the same rules. Difficulty is not
   * a resource handicap; a lesser heir is one who makes POOR DECISIONS, and the top of the
   * ladder is the doctrine played straight — the same heir `node sim.js` referees.
   * The history matters, because it is why the lapses below have to be real behaviour and not
   * decoration: an income handicap (`eco`) used to be here, and it was MEASURED as the only
   * knob that bit — `slow` and `noise` alone left an heir at a 50% mirror, because his
   * decisions are "spend the essence on the next thing in the plan" and the essence is still
   * there a few seconds later. Take the purse away without giving the ladder real flaws and
   * it collapses onto `hold` alone. So each rung carries LAPSES — named flaws at the exact
   * decision points in ai.js, each one a mistake a human beginner actually makes. `gates`,
   * `up`, `siege` and `hoard` are SPELLS: the number is the FRACTION of the match he spends in
   * the flaw, held for a while at a time (a flaw rolled fresh every think measured as almost no
   * flaw — missions and errands are sticky, and a Gate put off one think is a Gate seconds
   * later). `aim` is a chance per NEW order; `trickle` is a fixed floor.
   *   `gates`   — overlooks expansion: no spring taken under his feet, no new gate errand
   *               picked up. A liege's direct order still cuts through it.
   *   `up`      — forgets the upgrade scan: halls sit at level 1, unforked.
   *   `aim`     — a new order sends the army somewhere known but wrong, and it sticks for
   *               half a minute. Never while his own Seat is under threat: even a beginner
   *               comes home; never onto a rival's court, so it is no way round `hold`.
   *   `trickle` — the grouping discipline collapses: the COMMIT floor (the 22 men an assault
   *               waits for) shrinks toward a handful, so his attacks arrive in dribs.
   *   `siege`   — he has not learned what breaks stone: marches on a Seat with nothing that
   *               can break it. The greenest mistake; SQUIRE only.
   *   `hoard`   — sits on his purse: for a spell he raises nothing at all, and the essence
   *               piles up unused until it lifts.
   * `hold` stays what it was — the hour before he will march on YOUR Seat, a promise about
   * the player's opening minutes rather than a flaw — and `slow`/`noise` stay as the tempo
   * half of a worse mind. PRINCE carries no lapses at all: the reference heir, almost at once.
   * MEASURED, head-to-head against the same heir played straight (benedict and bleys, five
   * seeds, both seats, 15-minute cap; the footing's slow + noise + lapses, hold 0): the control
   * mirror 9-9, SQUIRE 2-17 (his median assault sets out at NINE men), HEIR 4-14, a minor
   * lord at HEIR (CONST.MINOR on top) 4-14, PRINCE 6-12 — within noise of even, and its
   * benedict half is identical to the control match for match.
   * Single flaws in isolation: `hoard` at 1 is 0-20 and `aim` alone is 8-9 (it delays the march
   * and the bigger army compensates — a mirror bot does not punish wandering the way a human
   * will, so the mirror is a LOWER bound on the handicap). And what a footing does to a whole
   * COUNTRY at six minutes, men / works / Gates: SQUIRE 748 / 135 / 35 against 467 / 62 / 25
   * under the old purse, PRINCE 701 / 156 / 44 against 677 / 116 / 43 — livelier at every rung,
   * and the SQUIRE lords hold more MEN than PRINCE's, because what they hoard and never put into
   * stone their halls put into unforked recruits. Written down; judged by hand next (TODO). */
  CONST.DIFFICULTY = {
    squire:  { key: 'squire',  name: 'SQUIRE',  slow: 1.6,  noise: 0.30, hold: 780,
               lapses: { gates: 0.8, up: 0.8, aim: 0.5, trickle: 0.8, siege: 1, hoard: 0.6 },
               blurb: 'Green: hoards his essence, forgets his halls, and feeds you his army '
                    + 'a handful at a time — and will not march on your Seat for thirteen minutes.' },
    heir:    { key: 'heir',    name: 'HEIR',    slow: 1.2,  noise: 0.15, hold: 390,
               lapses: { gates: 0.45, up: 0.45, aim: 0.2, trickle: 0.5, hoard: 0.3 },
               blurb: 'Seasoned but fallible, and at your gate not long after you have a realm.' },
    prince:  { key: 'prince',  name: 'PRINCE',  slow: 1.0,  noise: 0.05, hold: 60,
               lapses: {},
               blurb: 'The heir the other heirs face — no lapses, and he comes almost at once.' }
  };
  /* ---- A MINOR LORD IS A WEAKER HEIR, NOT A DUMBER ONE ----
   * A country seats sixteen and only a few of them contend for the throne (`world.heirs`). The
   * rest are minor lords running the SAME doctrine as a contender — one brain in the whole of
   * Amber — only lazier at it: his lapses compose with the footing's by the WORSE of the two
   * per flaw (game.js warFooting), the same way `noise` already composes. His purse is nobody's
   * business but his own: a lord who falls behind now falls behind by his own hand, and can
   * always earn his way back (the death spiral the eco handicap used to make permanent). */
  CONST.MINOR = { slow: 1.5, noise: 0.20,
                  lapses: { gates: 0.6, up: 0.6, aim: 0.3, trickle: 0.6, hoard: 0.4 } };
  CONST.DIFFICULTY_UI = ['squire', 'heir', 'prince'];
  CONST.DIFFICULTY_DEFAULT = 'heir';

  /* `foot` is the footprint a work claims against other works; `pass` is how close a MAN may
   * come to one before he is walked round it. Smaller than the footprint on purpose — a
   * column should hug a hall, not give it a wide berth — and large enough that the building
   * is never buried under men, which is how you tap it to raise it a level. */
  CONST.BUILD = { foot: 34, gap: 10, pass: 26 };
  /* a Shadow Gate within this of an essence node draws from it (and claims it) */
  CONST.NODE = { r: 96,
                 hold: 90 };  // troops within this of a spring beyond the writ are what TAKES it (else 'presence'/'contested')
  CONST.CASTLE_HP = 2500;         // retune: a Seat must not fall in ninety seconds of contact
  CONST.START_ESSENCE = 180;
  CONST.BASE_INCOME = 2.5;        // essence/sec before any Shadow Gate
  CONST.CASTLE_ZONE = 46;         // units closer than this to a castle attack it
  /* CROWD SEPARATION. Men had no width at all with respect to each other: a column arrived
   * stacked, a melee was a single point with a hundred sprites in it, and you could not tell
   * an army of twenty from an army of two hundred by looking. `space` is how much room a man
   * keeps, `push` is how much of an overlap is resolved per tick — half of it, split between
   * the two of them, which converges in two or three ticks without the jitter a spring force
   * gives you. Men posted on a parapet are exempt: they have assigned berths WALL.berth apart
   * and a separation wider than the berth would fight the roster for the same stretch.
   *
   * `pull` and `knit` are the OTHER half of the rule — cohesion, the second of Reynolds'
   * three. Separation is the only thing in here with an opinion about how far apart two men
   * should stand and every opinion it has is "further", so a man knocked out of his place
   * stayed out of it and a company dispersed into debris. A man is drawn to his own company's
   * men out to `pull`, by `knit` of the distance PAST the room he is owed — so the equilibrium
   * of a pair is exactly `space`, and the body closes the holes the fallen leave rather than
   * standing round them. Keep `pull` near two berths: it is the crowd grid's cell as well, and
   * a wider one puts a hundred men in one cell and the pass back in the quadratic trap.
   * Alignment stays out — the order is the alignment.
   *
   * THE BODY DOES NOT BREAK SIEGES, though a wide muster looks exactly as though it must. A
   * host sent at a Seat forms up AROUND it, so it appears everyone is parked outside his own
   * aggro — and the symptom fits: bleys held his banner on brand's Seat for 62% of a match, not
   * one of his men came inside the enemy city ring, the closest got 367 from something you must
   * be within CASTLE_ZONE to strike, and it ended at full health. Measured against an UNDEFENDED
   * Seat instead: twenty men close to 18 and a hundred and twenty close to 7, and both take it
   * to zero inside four minutes. The geometry is fine. An assault that does nothing is being
   * stopped in the FIELD, which is turtle beating rush and is what pillar 2 asks for — do not
   * damp this. (There WAS a number here — `ring`, a 300-unit cap on how far a man's place could
   * fall from his order — and it was the thing that made a late-match company stand in a circle:
   * past the 516th recruit every place came out at exactly 300. Places are dealt by rank now and
   * a body is as wide as it has men. See World.bodyPlace.)
   *
   * `look` is how many seconds ahead a man watches for stone he would walk into. It is the one
   * number the anticipatory steering has: turn early enough and he never touches a work, so
   * nothing has to push him off one and nothing can oscillate. At a soldier's pace this is
   * about sixty units of warning — a couple of strides more than the work is wide. */
  CONST.CROWD = { space: 22, push: 1.0, step: 1.5, pull: 44, knit: 0.04, dead: 0.35, look: 1.2,
                  /* THE CRUSH: packed men walk slower. press counts the neighbours standing
                   * closer than a berth (the separation pass already finds every such pair for
                   * free); the first few are a marching column's ordinary shoulder-rubbing and
                   * cost nothing, past that each one drags, floored so a scrum still moves.
                   * This is what makes a gap between works or curtains meter an army through
                   * instead of teleporting the queue: the press at the mouth slows, the men
                   * behind pile into it, and the column pours. */
                  crush: 0.15, crushFree: 3, crushFloor: 0.45,
                  /* HOW FAR A SHOOTER LOOKS FOR THE LINE HE IS MARCHING WITH. Wide enough to
                   * see across a body of a hundred men, narrow enough that a company on the
                   * far side of a spring is somebody else's march. See the pacing rule in
                   * world.js: it is asked locally BECAUSE a hall never stops mustering, and
                   * anything company-wide is dragged about by whoever left the yard last. */
                  lead: 170 };

  /* ---- The Shadow map (v0.2): a mirrored site graph, 700×2400 world units ----
   * Player 0's city is at the bottom; the template lists player-0's half + the middle
   * and is mirrored through (350,1200) for fairness. jitter is applied per-seed. */
  /* The world is generated fresh every match — no template, no corridors, no mirror.
   * Squarer than before on purpose: a Seat must have world on every side to explore. */
  CONST.MAP = { W: 2000, H: 2400 };
  CONST.VIEW_W = 620;          // how much world fits across the screen at zoom 1 (closer in)
  CONST.VIEW = {
    /* zoom range. The floor is not arbitrary: further out than this the camera outruns its
     * own far plane and the world clips to black, and everything on screen is too small to
     * act on anyway. */
    min: 0.80, max: 2.6,
    overscroll: 0.42,          // how far past the world's edge the camera may run, as a
                               // fraction of the view — without it a corner Seat is stranded
                               // small at the top of the screen with nowhere left to scroll
    /* the 3D rig's height and set-back, in units of the view width. ~50° of pitch: more
     * overhead than the old 36°, so the ground you are acting on reads as a map. */
    camHigh: 1.62, camBack: 1.36
  };
  CONST.WORLD = {
    freq: 0.030,        // noise frequency in cells — lower makes broader country
    ridge: 0.40,        // how much folded (ridge) noise drives elevation: mountain CHAINS
    rim: 7,             // cells of soft falloff at the map edge
    sea: 0.33,          // below this elevation is water
    hill: 0.635,        // above this is high ground
    cliff: 0.755,       // …and above this, impassable crag
    minLand: 0.34,      // a world whose largest landmass is smaller than this is rerolled
    nodes: 14, nodesMin: 9, nodeGap: 300, springNear: 200, springFar: 400, seatApartMulti: 0.62, springLevel: 58,     // springs: how many, and how far apart
    vantages: 8, vantGap: 240,
    inland: 300,        // a Seat may not stand closer than this to the edge of the world
    seatRoom: 300,      // buildable cells required around a Seat
    seatApart: 1500,    // the two Seats must be at least this far apart
    maxSkew: 6,         // reject a pairing whose two sides differ by more than this
    relief: 150         // world units of height between the lowest water and the highest crag
  };
  /* whose Seat is whose, by index — up to four now */
  CONST.SEAT_NAMES = ['Corwin', 'Eric', 'Bleys', 'Fiona'];
  CONST.MAX_PLAYERS = 4;
  /* Chaos is not a player and never had a seat, but it owned unit index 2 — which was safe
   * only while there were exactly two players. It now sits somewhere no player index can
   * reach, so a four-way match cannot mistake the third heir for the black road. */
  CONST.CHAOS_ID = -1;
  /* ---------------- THE RULES OF THIS MATCH ----------------
   * Not tuning: the small set of rules that a MODE may change, defaulted here to the game as it
   * has always been played. `createWorld` stamps a copy onto the world and the sim reads it from
   * there, so a rule is asked of the world rather than of a global — which is what lets one
   * process hold a skirmish and a province war at once, and what lets a suite assert that the
   * defaults ARE today's game.
   *   endOnSeat  a Seat at zero hit points ends the match (a duel) or eliminates its heir (a
   *              free-for-all). Off, it yields instead and the ground must be taken.
   *   occupy     a yielded Seat may be occupied, relieved or thrown down. Needs endOnSeat off.
   *   truce      heirs may offer, seal and break pacts. Off, `World.foe` is exactly "not mine".
   *   onePattern THERE IS ONE PATTERN IN THE WORLD. A Shrine may be raised only where it
   *              stands. Off, every board has its own, which is what a single match is.
   *   hush       THE QUIET TICK: a world with no two hostile things in it skips the passes
   *              that provably have nothing to do — target acquisition above all, which the
   *              profiler put at 94% of a busy tick. Not an approximation and not a second
   *              model: the same rules, with the empty work not done. SET THIS TO 0 TO GO
   *              BACK, and the suite holds both halves.
   *   reach      A COMPANY BELONGS TO A CITY and may be ordered only inside that city's
   *              reach (`world.cities[].reach`, grown by `WG.buildCountry`). The company's
   *              standing order falls back to its own city, never the royal banner; the
   *              banner becomes the Recall and nothing else; a work must stand inside some
   *              owned city's reach; and every flow field is fenced by the owning city's
   *              disc — which is what keeps a whole country at board cost (see nav.js).
   *              ORDERS are bounded, violence is not: standing, pursuit and combat cross
   *              the rim freely, or defenders on it would be unhittable.
   *   walkMul    the walk's pace, as a fraction of a board's. In a COUNTRY the Pattern is a
   *              war-scale clock: a rival's walk must leave time for the ANSWERS the war
   *              actually has — conquer the chain of cities toward AMBER, and the lords'
   *              own rising against a walker (ai.js: a walker's city outranks every other
   *              neighbour) — or a walk begun three reaches away is a win nobody can touch,
   *              reported from play in exactly those words. 1 is a board's walk, untouched.
   * Everything here is off or today's behaviour, so every existing mode is untouched. */
  CONST.RULES = { endOnSeat: 1, occupy: 0, truce: 0, hush: 1, onePattern: 0, reach: 0,
                  walkMul: 1 };
  /* Seat colours. You are ALWAYS gold — a player should never have to remember which of four
   * colours is theirs — so these are read by seat index for everyone else, skipping gold. */
  CONST.SEAT_TINT = [0xffd98a, 0xff8a96, 0xc48eff, 0x64d8d8];
  CONST.CHAOS_TINT = 0x7dff9e;
  /* ---------------- A COUNTRY'S COLOURS ----------------
   * Four seat colours answer a table of four. A war seats SIXTEEN, and the fifth lord onward
   * fell off the end of that list into the same crimson as the first — so every banner on the
   * board looked like the same enemy, an ally at terms looked like the army about to storm
   * you, and a conquest changed nothing you could see.
   * What a glance at a war map actually asks is not "which of sixteen lords is that" — nobody
   * can hold sixteen colours — it is WHOSE SIDE, and there are only ever a handful of sides:
   * you, each rival CONTENDER (`world.heirs`), the minor lords sworn to nobody, and Chaos.
   * So the palette is by BANNER: gold is always yours, each contending heir keeps a colour of
   * his own for the whole war, and every unaligned lord shares the neutral. A city that swears
   * to a contender turns his colour on the map that tick, which is the only way the growth of
   * a realm can be READ. `NEUTRAL` is deliberately dull: an unaligned court is scenery until
   * somebody takes it, and the eye should go to the banners. */
  CONST.REALM_TINT = [0xffd98a, 0xff8a96, 0xc48eff, 0x64d8d8, 0xffb066, 0x9ad86a];
  CONST.NEUTRAL_TINT = 0x9a93a8;

  /* ---------------- THE BIOMES OF A COUNTRY ----------------
   * A country is many boards, and a country whose every board is drawn from one distribution is
   * a country with one kind of ground in it. A biome shifts the three thresholds the terrain is
   * READ off — where the water line is, where the high ground starts, where it stops being
   * passable — and nothing else. The noise, the ridge folding and the soft rim are the same code
   * for all of them, so a biome cannot produce a board the rest of the game has never seen: the
   * nav grid, the fog, the placement rules and the renderer all get exactly what they always do.
   * `null` is the country the game has always had, and `downs` is deliberately it, so the table
   * has a member that is provably the old behaviour.
   * `tint` is a hint for the ground bake and the realm map; nothing in the sim reads it. */
  CONST.BIOMES = {
    downs:  { name: 'the Downs',      world: {},                                        tint: 0x6f7a4a },
    fen:    { name: 'the Fens',       world: { sea: 0.40, hill: 0.70, cliff: 0.82 },    tint: 0x4a6a5c },
    forest: { name: 'the Deep Wood',  world: { sea: 0.30, hill: 0.68, cliff: 0.80 },    tint: 0x3f5a34 },
    hills:  { name: 'the High Country', world: { sea: 0.28, hill: 0.55, cliff: 0.74 },  tint: 0x7a6a4e },
    crags:  { name: 'the Spine',      world: { sea: 0.26, hill: 0.48, cliff: 0.66 },    tint: 0x6a6470 },
    coast:  { name: 'the Long Shore', world: { sea: 0.44, hill: 0.68, cliff: 0.80 },    tint: 0x4e6a78 }
  };

  /* ---------------- THE COUNTRY ----------------
   * A grid of regions, each of which is a BOARD of the size the game has always used. `sea` and
   * the two height marks read the coarse noise the same way the terrain reads the fine one, so a
   * country has shores, downs, high country and a spine without any of it being authored.
   * `shut` is how often a border between two pieces of land is closed anyway — few, narrow
   * crossings are what make a seam cheap (see js/country.js), and connectivity is repaired
   * afterwards rather than hoped for. `inset` is how far inside its own board a crossing sits:
   * a column steers at it and is handed over there, so it must be standable ground and not the
   * very edge of the world. */
  CONST.COUNTRY = { cols: 5, rows: 5, sea: 0.24, high: 0.64, crag: 0.80, rim: 0.72,
                    shut: 0.26, inset: 120, least: 10 };

  /* ---------------- THE WAR ----------------
   * `heirs` is who else is playing to win — the rest of the country is held by lesser lords,
   * which is where the early game lives: you grow by taking from people who are not contending
   * for the throne, and it is why a LAN opening is not "rush your friend before he has built
   * anything". `crossing` is how long a column spends between two regions; it is a real cost, so
   * committing an army to a border is a decision. `lords` are the names a minor holding wears. */
  CONST.REALM = {
    heirs: ['julian', 'bleys', 'benedict'],
    /* a minor lord is not an heir and has no doctrine of his own — he fights like the plainest
     * of them, which is the point: he holds ground and does not contend for the throne */
    holder: 'greedy',
    crossing: 45,
    /* THERE IS NO CEILING ON HOW MANY CITIES YOU MAY HOLD. There was: one by right and one
     * more per LORD, a lord won only by taking a court from a contender — so a court you had
     * broken, stood in and held for its full twenty seconds could simply refuse you. On the
     * designer's call: what you break and hold, you keep. The brake on a conquest is the army
     * it costs and the twenty seconds of holding the court uncontested, which is a brake you
     * can see and fight over rather than a number saying no. */
    lords: ['a Shadow-lord', 'a Marcher Baron', 'the Warden of the Ford', 'a Petty King',
            'the Keeper of the Pass', 'a Sworn Brother', 'an Old Duke']
  };

  /* ---------------- THE REACH WAR ----------------
   * The Long War's next shape: ONE continuous land instead of a graph of boards. Every city
   * owns a REACH — the disc its companies may be ordered inside (nav.js carries the bound) —
   * and to strike a city two hops away you must first hold the one between, not because a
   * rule forbids it but because that is how far your men can be ordered. Measured in
   * proto/reach: the same rule that bounds an order is what keeps a flow field at board cost
   * on any size of land. `dims` is the first shipped country — 2x the board's axes; the
   * renderer holds there and a later stage lifts it (tiled bake, windowed fog).
   * `reachMul` runs a reach out a bit past the nearest neighbour, so reaches OVERLAP — the
   * overlaps are where two companies can both be ordered, which is where the fighting lives.
   * A city whose reach can path to nobody grows it by `growReach` up to `growPasses` times:
   * a city on poor ground commands further, which reads as a real thing and not a repair. */
  CONST.REACHWAR = {
    /* THE TRUE COUNTRY: four times the board on each axis. What made this affordable was
     * never in question by now — fields are fenced (R1) and the tick is unit-bound — the
     * renderer was, and it is answered by a two-layer ground (a cheap flat base at any size,
     * painterly DETAIL TILES near the camera) and a fog veil eased only where the camera is
     * looking. Measured on this box's software GL, the pessimistic case throughout. */
    dims: { W: 8000, H: 9600 },
    cities: 16,
    spacing: 900,
    /* a city's reach is sized from ITS OWN nearest neighbour — the nominal spacing lied:
     * max-min placement actually seats neighbours 1300-2400 apart, so a reach cut from the
     * 900 put a rival's court barely inside and his springs safely out. At 1.6 times the
     * true distance the reach runs well past the nearest court and covers its writ springs,
     * so a company can raid the economy and not only knock on the throne — economic pressure
     * is the whole anti-turtle engine. Capped: an outlying city's reach must not buy a field
     * the size of several boards. */
    reachMul: 1.6,
    reachCap: 3000,
    /* SCATTERED springs per city, beside each city's own writ spring. Doubled from 2 on a
     * report from play that a war's ground was too thin: springs are what a Gate is raised on,
     * Gates are what buy mason crews, and crews are the whole of what a lord can spend — so
     * this one number is the war's economy and its rate of expansion at once.
     * Measured before shipping it, because a scatter worldgen cannot place is silently a
     * smaller number and would have read as the change not working: 16 cities carry 48 springs
     * at 2 and 80 at 4, identical on five seeds, every one placed. The TOTAL is 1.67x rather
     * than 2x — every city keeps its own opening spring either way — and it is the SCATTER,
     * the part you have to march out and take, that doubles. */
    perCity: 4,
    /* rivers run from the high ground to the sea and BAR a column exactly as a lake does —
     * except that a river crosses the whole country, which is what makes the bridges the
     * road carver builds over them worth their toll, and every bridge is a chokepoint */
    rivers: 8,
    growReach: 1.18, growPasses: 6,
    /* EVERY COURT IS NAMED, and there must be MORE names than courts. Twelve of these against
     * sixteen cities meant three fell back to 'a City of Shadow' — which is not a name, it is
     * the absence of one, and it read as a bug on the council's roster (several identical rows)
     * and in every banner that quoted it. A country names its courts from a bag, so the bag has
     * to outlast the draw: `cities` is 16, one of which is AMBER, so fifteen is the floor and
     * these are twenty. Add a city and add a name. */
    names: ['KOLVIR', 'ARDEN', 'REBMA', 'BEGMA', 'KASHFA', 'LORRAINE', 'GHENESH',
            'HELGRAM', 'AVERNUS', 'TIR-NA', 'JIDRASH', 'DOMARIS',
            'THELBANE', 'SAWALL', 'HENDRAKE', 'JESBY', 'CHANICUT', 'AMBLERASH',
            'DEIGA', 'BAYLE']
  };

  CONST.SITE_NAMES = {
    node: ['the Singing Spring', 'the Mirror Pool', 'the Weeping Well', 'the Silver Tarn',
           'the Deep Font', 'the Still Water', 'the Glass Rill', 'the Cold Cistern',
           'the Whispering Font', 'the Drowned Bell', 'the Green Well', 'the Salt Spring',
           'the Amber Rill', 'the Sunken Basin'],
    vantage: ['the Grey Crag', 'the Watcher’s Tor', 'the Broken Stair', 'the High Shoulder',
              'the Wind Scarp', 'the Old Barrow', 'the Black Tor', 'the Raven Steps']
  };

  /* ---- AN ORDER MEANT LITERALLY ----
   * An ordinary rally is a SUGGESTION: the acquire loop overrides it constantly, which is right
   * — men who walked past an enemy in arm's reach to stand on a flag would be absurd — and it is
   * exactly what makes a deliberate order impossible to give. So there is a second kind, asked
   * for by saying the same order twice: march THROUGH whatever is in the way, or bring down that
   * one work and nothing else.
   * It must LAPSE, and both ways matter. `span` is the ceiling: a company told to ignore the
   * enemy forever walks into a mill and dies to a rule the player set two minutes ago and has
   * forgotten. `arrive` is the ordinary ending — the order was to get THERE, and once the
   * company's own bearer is there it is obeyed, so the men go back to fighting like men rather
   * than standing on the spot they were sent to being shot. `arrive` is generously wide because
   * a company is a body a hundred units across, not a point. */
  CONST.HARD = { span: 25, arrive: 110 };
  CONST.STRUCT_REGEN = 2;         // hp/sec self-mending after STRUCT_REGEN_WAIT unharmed
  CONST.STRUCT_REGEN_WAIT = 10;   // s a work must go unhit before the mending starts
  /* HOW MUCH MENDING ONE MAN CAN TAKE, hp/sec, however many Wardens are attending him.
   * THE CAP IS ON THE RECEIVER, NOT ON THE HEALER, and that is the whole point. Every Warden
   * independently picks the worst-hurt friend in reach, so they all pick the SAME man — the
   * one being focused — and fifteen of them poured 105 hp/sec into him. Focus fire is the
   * only answer an army has to a single hard target, and a stack of Wardens simply switched it
   * off. Capping the Warden instead would have made him worse everywhere, including the case
   * that was never broken: one Warden walking a line of wounded men. Capping the RECEIVER
   * leaves that untouched and answers exactly the failure — stacking. At 10 the first Warden
   * (7 hp/s) is not clipped at all, the second is already deep into diminishing returns, and
   * the fifteenth is doing nothing, which is why a Warden whose target is capped goes and
   * finds another: the branch stays worth building in numbers, it just cannot be piled on one
   * man. Per-tick scratch (`_mendT`/`_mendGot`) — it is not state and does not ride the wire. */
  CONST.MEND_CAP = 10;
  /* HOW LONG SHADOW HOLDS A BOUND FIEND. It has to end: the Chaos cap counts fiends by owner,
   * so every one taken frees a slot for the road to tear open another, and a permanent bind
   * would let a binder host farm the black road into a private army — the very failure that
   * capping Chaos was meant to end. Ninety seconds is long enough to win a fight with and far
   * too short to build an army out of. */
  CONST.BIND_LIFE = 90;
  CONST.VISION = { city: 420, unit: 260, build: 240,
    /* A walk on the Pattern is a beacon. The blazing lines light the Shrine and the ground
     * around it for EVERYONE — you cannot reach for the throne in secret, and your rivals
     * are owed the chance to come and stop you. */
    pattern: 380,
    /* WOODS SWALLOW SIGHT. A fog cell of forest costs this many cells of a sight line's
     * budget instead of one, so looking through deep woods reaches about HALF as far as
     * looking over plain (each cell entered eats one extra cell of reach, on top of the
     * distance itself). 2 is the whole design: a forest is cover you can hide an army in
     * without being a wall you cannot see past at all — the first rank of trees is always
     * seen, and a thin belt of wood dims the country beyond rather than deleting it. */
    forest: 2 };

  /* Ground you have HAD eyes on stays on the map under a lighter veil once your troops move
   * on — a country you have walked should not go black again behind you. `keep` is how much
   * of the full veil remains over remembered ground; `cell` is the grain the memory is kept
   * at, coarse enough to cost nothing and fine enough that the edge reads as terrain. */
  /* `ease` is the veil's TIME constant, in seconds — how fast the drawn fog chases the mask.
   * Sight is recomputed 5x a second on a 26-unit grid, so an unsmoothed veil opens the ground
   * ahead of a marching column in visible lurches. The mask stays a hard 0/1 (the AI and the
   * snapshot read it); only the drawing eases. Long enough to hide the 200ms step, short
   * enough that the lit ground still keeps up with the men who are lighting it. */
  /* `soften` is how many [1,2,1] passes the shader-fog field takes before it is uploaded
   * — how wide the veil's edge is, in cells, and the one knob for how painterly it reads.
   * TWO, not four. A blur is a low-pass filter and the mask's OCCLUSION is its high
   * frequencies: the wedge behind a wall, the fingers of shadow a wood throws. At four
   * passes the kernel reaches four cells — a hundred units — and it filled those shadows in
   * from both sides, so the wall's shadow came out a quarter lit and the treeline's shape
   * came out a smooth blob. Two passes is a Gaussian of about a cell; the rest of the
   * softness is bought in the shader, on the TONE curve, which costs no reach at all. */
  CONST.FOG = { cell: 26, keep: 0.45, ease: 0.22, soften: 2 };

  /* ---- Navigation (open world, stage 2): units move continuously over a cost grid ----
   * The site web is baked in as corridors — free within freeR of a path or site, ramping
   * to maxCost, impassable past edgeR. Stage 3 replaces this with real terrain.
   * Corridor width is tuned to reproduce the old site-to-site march: units used to walk a
   * line with a ±24 formation offset, so ~26 of free ground either side is the same road. */
  CONST.NAV = {
    /* cell MUST divide both MAP.W and MAP.H (gcd 100 → 4,5,10,20,25,50). The map is
     * mirrored through its centre for fairness; a cell size that does not divide the map
     * puts the grid half a cell out of step with that mirror, which is a seat bias. */
    cell: 20,          // world units per grid cell (700×2400 → 35×120 cells)
    /* terrain costs live in WorldGen.COST; climbing is charged on top of them */
    slope: 26,         // extra move cost per unit of elevation climbed (descending is free)
    arrive: 72,        // within this of the goal a unit steers to its own place in the line
    cacheMax: 48,      // flow fields held before the cache is dropped
    /* HOW MANY COLD FLOW FIELDS ONE TICK MAY BUILD. A field is a Dijkstra over every cell of
     * the board — 6ms today, 59ms on a board three times as wide — and `masksFor` drops all of
     * them the moment a wall rises, so the ticks that follow wanted two, five, nine at once.
     * That is the whole of the sim's worst-frame problem: its median tick is half a millisecond
     * and its 99th percentile under four.
     * A man whose field is not ready this tick heads at his goal directly for one tick, which is
     * what `steer` already answers for a goal it cannot reach. It is a COUNT and not a time
     * budget on purpose: the sim is seeded and host-authoritative, and a rule that depended on
     * how fast the machine was would make two seats disagree about where an army went.
     * ONE, measured. A whole six-minute match builds about fifty fields against three hundred
     * thousand cache reads, so the ration almost never binds: at one a tick it bit on SEVEN
     * ticks of a 10,800-tick match on this board, and on twenty-two of a four-handed match on a
     * board three times as wide — a quarter of a second, total, of some men walking straight for
     * one tick. What it buys is the worst tick: 27ms to 13 here, 97 to 27 at twice the width,
     * 285 to 66 at three times. Two halves the win and buys nothing back.
     * AND IT COSTS PACING, which is the other half of the trade and the reason this is a dial
     * rather than a decision. Measured at forty games a matchup against the same code without
     * it: the outcomes do not move — greedy's mirror is 15-17 with eight timeouts either way,
     * bleys' 60% against 55%, both inside sampling error — but every pairing runs LONGER.
     * greedy's median 10.8m → 16.1m, bleys' 7.8 → 8.9m, bleys' timeouts 1 → 4 of 40. Still
     * inside the 5-20m band, and one-directional.
     * SET THIS TO 0 TO GO BACK. Nought means no ration at all rather than "build nothing":
     * every field is built on the tick it is asked for, which is exactly what the sim did
     * before. One edit, and the suite holds both halves. */
    perTick: 1,
    shore: 4,          // world units a man keeps from the waterline (the SDF isoline he is
                       // projected back to — see NAV.ground and `grounded` in world.js)
    wade: 6            // the most one tick's projection may move him: a man deep in the wrong
                       // ground WALKS out at ~180/s instead of teleporting to the bank
  };

  /* Buildings — ONE table now. Outposts and city works were always the same idea: a thing
   * you pay for, that stands somewhere, that can be broken. With free placement the
   * distinction had nothing left to mean. up = upgrade costs to L2/L3; effect arrays are
   * [L1,L2,L3]. `claim` marks a work whose country you may build in. */
  /* EVERY WORK IS TWICE AS HARD TO BREAK as it was. A realm was a sandcastle: 59 razes in one
   * reported match, 26 in another, and a treadmill of raze-and-rebuild at the same spring that
   * neither side could ever win. Doubling the stone means an assault on a work is a commitment
   * rather than a drive-by, which is what makes the Siege Works worth raising and what stops
   * the outworks churning. The Seat itself is untouched — a tougher Seat pulls the other way
   * from the clock, and the clock is what was broken. */
  CONST.BUILDINGS = {
    /* A Gate stands ON a spring and nowhere else. It is the only thing that draws Shadow out
     * of the ground, so the essence is out on the map and your writ can only follow it there.
     * That is the whole anti-stall model, and it holds because there is no home substitute. */
    gate:     { name: 'Shadow Gate',   icon: '🌀', cost: 120, up: [110, 190], claim: true, raise: 21,
                nodeIncome: [4.5, 7, 10.5], hp: 600, vision: 300, onNode: true,
                blurb: 'Raised ON a spring of Shadow, and only there. It draws deep, and your writ runs where your Gates stand.' },
    barracks: { name: 'Barracks',      icon: '⚔', cost: 150, up: [120, 200], hp: 720, raise: 27,
                spawns: 'soldier', period: [8, 8, 8],
                blurb: 'Musters Soldiers who march the black road. At level 2 the hall is RE-RAISED around one soldiery — shieldwall, outriders or bowmen — and there is no going back.' },
    /* A WALL IS A FIGHTING POSITION, NOT A SHELL. It bars the ground and it stops shots
     * crossing it — so men behind one are safe — but a wall alone kills nobody. Come UP to
     * it and you are MANNING it: you shoot over the parapet, and everything below can shoot
     * back. That is the whole bargain. A wall does not defend you; it lets you defend a line
     * with fewer men than the open field would need, which frees the rest of the army to be
     * somewhere else. Turtling behind one is not a way to win, it is a way to be besieged.
     * It is ONE work with a length, not a run of segments: it rides the same masons, the same
     * hit points, the same raze and the same snapshot as everything else. Close a pinch with
     * two or three, and a breach is a hole an army walks through. */
    /* THE ONE WORK WITH A LENGTH. `span` is how long a run may be; `hpAt` is what the level
     * buys — a wall has no other effect to scale, so reinforcing it has to mean thicker
     * stone or the upgrade would take essence and do nothing at all. */
    wall:     { name: 'Curtain Wall',  icon: '🧱', cost: 110, up: [90, 150], hp: 820, raise: 26,
                perCrew: true,   // cost/hp/upkeep of crews all multiply by the run's length
                /* A RUN IS PRICED BY THE FOOT, not by the crew. Rounding the length up to a
                 * whole crew made every run under WALL.unit cost the same as a full one, so a
                 * short stretch across a gap was billed as if it were the long wall it was
                 * not, and there was no reason ever to draw one. Price, stone and the upgrade
                 * all go by `len / WALL.unit` continuously; only the mason COUNT rounds up,
                 * because you cannot put two thirds of a crew on anything. */
                hpAt: [820, 1290, 1880], span: [26], vision: 200,
                blurb: 'A run of stone. Nothing crosses it and nothing shoots through it. Men who come up to man it can be shot back — but the merlons take half of every blow that finds them.' },
    /* THE ANSWER TO A CASTLE. Soldiers were the only siege there was, and a Seat has 2500
     * hit points behind towers — so "win by force" meant grinding a rival's outworks forever
     * while neither Seat took a scratch. An Engine is slow, fragile in a fight and useless at
     * holding ground; against a work or a Seat it is worth four of the men it costs. It has
     * to be escorted, which is the point: the Works turn a war chest into a threat. */
    siege:    { name: 'Siege Works',   icon: '⚒', cost: 300, up: [230, 360], hp: 760, raise: 42,
                spawns: 'engine', period: [24, 24, 24],
                blurb: 'Builds Engines — slow, and made for stone rather than men. At level 2 the yard is RE-TOOLED for rams or for bombards, and there is no going back.' },
    spire:    { name: 'Sorcery Spire', icon: '🜏', cost: 240, up: [180, 300], hp: 640, raise: 36,
                spawns: 'sorcerer', period: [11, 11, 11],
                blurb: 'Sends Sorcerers — fragile, deadly at range, and no use at all against stone. At level 2 the Spire turns to ONE art, mending or binding, and there is no going back.' },
    /* a ROOK, not the Tokyo Tower: 🗼 is a steel lattice mast and read as modern the moment it
     * sat beside a Seat. ♜ is the medieval silhouette, and being a glyph rather than a colour
     * emoji it sits with ⚔ ⚒ ✚ 🜏 in the dark-and-gold sheet instead of shouting over them. */
    tower:    { name: 'Watchtower',    icon: '♜', cost: 130, up: [100, 180], hp: 960, raise: 22,
                dmg: [10, 15, 20], range: [250, 275, 300], atk: 1.1, fork: 2, vision: 520,
                forkHint: 'Rebuild the tower.',
                blurb: 'Far sight over Shadow, and arrows for trespassers. At level 2 the tower is REBUILT — ballista or cannon, and there is no going back' },
    /* The Shrine does not upgrade. There is one Pattern and one way to walk it, and the walk
     * is meant to be a commitment you pay for in essence you are not spending on an army —
     * an upgrade path only made it cheaper AND faster, so it was never a commitment at all.
     *
     * A WALK MUST BE HELD, NOT SAVED UP. Progress used to be permanent the moment it was
     * bought, which made the Shrine a savings account: walk whenever you happen to be rich,
     * stop when you are not, and nothing you had already paid for was ever at risk. That is
     * why breaking a rival's Shrine felt pointless — it cost them 380 essence and the time to
     * raise another, and not one point of the walk. Now the lines FADE whenever nobody is
     * channelling (`decay`, %/sec), and throwing the Shrine down costs the walker `breakLoss`
     * points outright. An assault on a walker is now the answer it always looked like.
     *
     * AND THE WALK CANNOT BE PAUSED, NOR STARVED. Two rules that pulled against each other
     * are gone. The first was that `{c:'walk', on:false}` could be given at any moment, which
     * made the Shrine a tap: step on when rich, step off when the muster wants the money, and
     * the only cost of the whole flirtation was the fade. The second was PROPORTIONAL PAY —
     * a poor walker advanced at `pay/want` of full speed, floored at a `minRate` invented to
     * stop that arithmetic freezing the game's clock at a sixth of a percent a minute.
     *
     * What stands in their place is one rule with one price. Once an heir sets foot on the
     * Pattern he is ON it — the command to stop is REFUSED ('committed'), and the only ways
     * off are reaching 100 and losing the Shrine. And the lines carry him at FULL `rate`
     * whatever his treasury holds, so the clock always ticks: `minRate` had nothing left to
     * floor and was deleted rather than left lying about describing a mechanism that is gone.
     *
     * The cost did not go anywhere — it moved to the front of the queue. `drain` is taken
     * before any mustering hall is paid, so a walker who cannot carry it does not walk
     * slowly, he MUSTERS NOBODY: his halls find the treasury empty and his army stops growing
     * for as long as the walk lasts. That is the commitment, stated in the only currency that
     * matters. drain = essence/sec while walking, rate = %/sec: ~5.2 minutes and ~6.9k
     * essence, and every penny of it is a soldier who was never raised. */
    shrine:   { name: 'Pattern Shrine', icon: '✴', cost: 380, unique: true, hp: 900, raise: 54,
                /* WALKABLE ON FIVE GATES. At 32 a walk cost more than five Shadow Gates earn —
                 * five at level 1 draw 25 a second against the base 2.5, so the walker went
                 * seven a second into the red before a single soldier was paid for, and the
                 * Pattern was a thing you did after winning rather than a way of winning. At
                 * 22 the same five Gates leave three a second spare with the muster halted and
                 * one a second with a hall still running: a small income, which is the point.
                 * It is still 12,500 essence for a full walk, and it is still nine and a half
                 * minutes in plain sight of everyone at the table. */
                /* A RACE, NOT A LAST RESORT. At 0.175 a full walk was nine and a half minutes
                 * of drain in plain sight — longer than most matches have left by the time
                 * anyone can afford to start — so the Pattern decided about one skilled match
                 * in five and force decided the rest. It is meant to be one of two ways to
                 * take the throne, not the consolation for failing at the other. At 0.30 the
                 * walk is five and a half minutes: begun around minute seven, when a realm can
                 * carry the drain, it lands inside the 5-20 band and leaves the rival a real
                 * window to come and stop it. Swept against the referee at 0.175 / 0.26 / 0.36
                 * — the share of skilled matches decided by the Pattern went 19% / 23% / 38%.
                 * DECAY is the other half of the same question and the gentler lever. A walk
                 * that has to be paused — and the heirs pause now, rather than starving — bled
                 * back at 3% a minute, so an heir who stopped to defend his Seat lost most of
                 * what he had paid for. At 0.035 the lines fade slower than they are drawn, so
                 * committing and then defending is a plan rather than a waste. That rewards
                 * holding the ground you walk from, which is the shape the walk should have. */
                drain: [22], rate: [0.32], decay: 0.035, breakLoss: 22,
                blurb: 'Channel Essence to walk the Pattern. 100% claims the throne. The walk is REVEALED, it CANNOT be called off, and it is paid before your halls are — a walker who cannot carry the drain musters nobody.' }
  };
  CONST.BUILD_ORDER_UI = ['gate', 'wall', 'barracks', 'tower', 'spire', 'siege', 'shrine'];
  /* Manning a wall. `man` is how close you must come to be ON the parapet — inside it you can
   * shoot over and be shot at; outside it the stone is between you and the field. `over` is how
   * far a man on the wall can reach past it, so a parapet is a short weapon whatever the unit
   * usually carries. `thick` is what the nav grid bars either side of the line. */
  /* THE CURTAIN'S OWN RULES. `man` is how close you stand to your own wall to be ON it;
   * `over` is how far you throw from up there; `thick` is what the movement grid stamps.
   * `unit` is the length ONE MASON CREW covers — there is no longest run, only how many
   * crews you can put on one at once, so a heir's reach is his mason count and grows with
   * the Gates he holds. It is also what a run costs and what it is worth in stone: one
   * crew's length is one card price and one card's hit points. */
  /* ---------------- veterancy ----------------
   * A HALL'S LEVEL MAKES BETTER MEN, NOT MORE OF THEM. It used to buy throughput — the same
   * soldier, arriving faster — which meant an upgraded realm fought with bigger crowds of
   * identical men, and nothing you could see. The muster interval is flat now and the LEVEL
   * rides on the recruit: his hit points, his blow and his price all take this multiplier,
   * and he keeps it for life.
   *
   * The numbers are the old rate ratios exactly (8/8, 8/6.4, 8/5), and they are on the PRICE
   * as well as the stats on purpose: the essence buys precisely the same total hit points and
   * the same total damage per minute as the old upgrade did, at the same drain. What changes
   * is the PACKAGING — fewer, tougher men instead of more, weaker ones — and that is the
   * whole gain: a veteran company is harder to storm, harder to splash, and arrives as a
   * column rather than a crowd.
   *
   * UPKEEP is what an upgrade actually costs: `upWork` is how long the masons are on it, as a
   * fraction of what the work took to raise. While they are, it does its job for nobody. */
  CONST.TIER = [1, 1.25, 1.6];
  CONST.TIER_NAME = ['', 'Veteran ', 'Elite '];
  CONST.UP_WORK = 1.0;

  /* THE TOWER GARRISON. `man` is how near an ORDER must fall to a tower for its shooters to go
   * in; `berths` is how many fit, because a tower is a room and not a field; `over` is how far
   * a man throws from up there, further than any shooter reaches on the ground; `ring` is how
   * far from the tower's middle they stand, which is now INSIDE its footprint rather than in a
   * circle round its foot — they are sheltered by the stone, and standing outside it is exactly
   * what they are not doing.
   *
   * TEN, AND THEY ARE SAFE IN THERE. Three exposed men was a garrison worth neither the walk
   * nor the risk — a bombard's burst took all three, and a tower's entire worth is that it is a
   * ROOM. Ten of them, untouchable until the tower comes down, is a real decision with a real
   * answer: it is still ONE work with ONE hit-point bar, so a siege that concentrates on the
   * tower gets the whole garrison at once, and they come out into the middle of it. */
  CONST.TOWER = { man: 76, over: 150, berths: 10, ring: 9 };

  CONST.WALL = { man: 32, over: 105, thick: 13, unit: 150,
                 /* A PARAPET HOLDS WHAT IT HOLDS. One berth per `berth` of length, and the men
                  * who cannot get up stay at the FOOT of it — sheltered, useless, and waiting
                  * for a place. Without this a hundred men crowd twenty feet of stone and the
                  * whole run is defended by a scrum standing on each other. */
                 /* `rows` is gone: the ranks at the foot are NOT capped. Wrapping at three
                  * meant a curtain held `berths * 4` men and dealt every one after that a place
                  * somebody was already standing in — measured at twenty-one overlapping pairs
                  * of sixty men on a single run. A wall stops taking men on the PARAPET, not at
                  * its foot. */
                 /* how deep the corridor through a gateway is kept clear of the reserve, in
                  * rows: the door is no use if the ground behind it is a wall of your own men */
                 rowsClear: 5,
                 berth: 15, foot: 20,
                 /* HOW NEAR HIS BERTH HE MUST BE BEFORE HE IS STANDING IN IT. A berth is an
                  * errand the roster hands him and this is the threshold that turns it into a
                  * place: inside it he is a man on the parapet — the long reach, the merlons'
                  * cover, and drawn up on the stone — and outside it he is a man walking to a
                  * wall. A berth's own spacing, so a man who has reached his stride of the run
                  * is on it. The same bargain the tower's threshold makes, and for the same
                  * reason: before it, being NAMED to a place made a man a parapet man wherever
                  * he stood, and he snapped onto the stone from wherever the roster found him. */
                 step: 15,
                 /* HOW NEAR AN ENEMY COMES BEFORE THE CURTAIN GATHERS TO HIM. Generous on
                  * purpose: a Bombard out-ranges everything on the board and shells stone from
                  * 365 away, and men who only muster once the ram is at the foot arrive after
                  * the breach. Wide enough to cover the longest gun, tight enough that a column
                  * crossing the country beyond it is somebody else's problem.
                  * `alarms` is how many separate attacks one curtain can answer at once and
                  * `alarmSpan` how far apart two enemies must be ALONG THE STONE before they
                  * count as two attacks rather than one body — one alarm answers a feint
                  * perfectly, so a wall has to be able to divide. */
                 alarm: 420, alarms: 4, alarmSpan: 150,
                 /* WHAT THE STONE IS WORTH TO THE MAN ON IT. Every blow that lands on a
                  * berthed man is multiplied by this — see `hurt`, which is the one door
                  * damage comes through. Half, because a berth already costs him the shelter
                  * of the foot: he is the one man on the run who can be shot back at, and
                  * before this the only thing the parapet gave him was reach. */
                 cover: 0.5,
                 /* AND A WALL HAS A GATE. A curtain you can walk around the end of is a
                  * decoration; one nobody can pass is a wall around your own army. The gate is
                  * the middle of the run, it is `gate` wide, and it is YOURS — a rival reaching
                  * it finds it shut, and must break the wall instead. */
                 gate: 30,
                 /* HOW NEAR IS "ON IT" — and, the same number, how near any work that is NOT
                  * part of a run may come to it. A tower dropped this close to your own
                  * curtain is snapped onto it; anything else this close to a run is refused.
                  * ONE number on purpose: two of them left a dead band where a tower could
                  * neither join the wall nor stand beside it, and every tap in the band came
                  * back 'too close to another work' with no spot that would take it.
                  * Generous, because a wall stands thirty tall and the camera is pitched, so
                  * a tap on the stone you can SEE lands well behind it on the ground. */
                 join: 62,
                 /* a breach is repaired, not rebuilt: a crew, a while, and half the stone.
                  * `rubble` is what a ruin keeps standing — it bars nothing and shelters
                  * nobody, but the ground it sits on is not free until somebody clears it,
                  * and a single stray blow must not sweep the record away. */
                 /* A SHORT RUN HAS NO GATEWAY. The gate is `gate` wide out of the middle of
                  * the run, so on a stretch barely wider than the hole there is no wall left
                  * either side of it — the "wall" is a doorway with two stumps. Under
                  * `gateMin` the stone is solid: it stops your own men as surely as anyone
                  * else's, which is the price of a short blocking piece and a real reason to
                  * draw a longer one. */
                 gateMin: 120,
                 atop: 26,   // a new run with BOTH ends this near a standing one lies atop it — refused as 'crowded'
                 repair: 0.5, fixWork: 0.7, rubble: 0.3 };

  /* The Watchtower fork — chosen at the level-2 upgrade, permanent.
   * Per-branch arrays are indexed by (level - 2): [L2, L3].
   * cost = the 1→2 rebuild; up = [2→3].
   * Ballista trades rate of fire for reach and a bolt that kills anything big in three;
   * the cannon trades reach for a burst that answers a crowd. Neither is the safe pick. */
  CONST.TOWER_BRANCHES = {
    bolt:   { name: 'Ballista Tower', short: 'Ballista', icon: '🎯',
              cost: 120, up: [210],
              dmg: [22, 31], range: [310, 350], atk: [2.0, 1.9], splash: [0, 0],
              blurb: 'A giant crossbow: one bolt, far and heavy. Champions and fiends fall to it — a marching crowd walks straight past.' },
    /* splashFrac: what a foe caught in the burst takes, as a fraction of the direct hit.
     * At 1.0 the cannon simply deletes armies (sim-verified); the falloff is what makes it
     * a counter to a column rather than a wall against one. */
    cannon: { name: 'Cannon Tower',   short: 'Cannon',   icon: '💥',
              cost: 140, up: [230],
              dmg: [12, 18], range: [232, 252], atk: [2.2, 2.1], splash: [48, 58], splashFrac: 0.45,
              blurb: 'Corwin’s trick — shadow-rouge that burns where Amber’s powder will not. It bursts over a column; against one great foe it is a firework.' }
  };
  CONST.TOWER_BRANCH_UI = ['bolt', 'cannon'];
  /* A FORK IS A PROPERTY OF THE TABLE, not of the word 'tower'. The Watchtower paid for this
   * mechanism and was the only thing using it; hanging the tables off the building is what let
   * the three troop halls fork for the price of a table entry. Everything downstream —
   * `World.branchesOf`, the price, the `up` command, the sheet, the model key, the heirs —
   * reads these two keys and never names a building. */
  CONST.BUILDINGS.tower.branches = CONST.TOWER_BRANCHES;
  CONST.BUILDINGS.tower.branchUI = CONST.TOWER_BRANCH_UI;

  /* ---------------- the Seat's own gun ----------------
   * THE TALLEST TOWER AN HEIR OWNS DID NOT SHOOT. A Seat was a pile of hit points with a ring
   * of ground around it, so an assault that beat the field met nothing at the gate but arithmetic
   * — and a Watchtower raised in the court out-fought the throne it was guarding. The Seat now
   * answers for itself, and it answers as hard as the two Watchtower branches put together:
   * whatever you might have built beside it, it is already there.
   *
   * DERIVED, NOT WRITTEN DOWN. These are the two branches at their top level added together, so
   * retuning a branch retunes the Seat and the two can never drift apart. Per-branch arrays are
   * indexed by (level - fork), so the last entry is the fully-upgraded tower.
   *   ballista L3   31 dmg / 1.9s = 16.32 dps
   *   cannon   L3   18 dmg / 2.1s =  8.57 dps
   *                                 --------
   *                                 24.89 dps, fired on the quicker of the two cadences (1.9s),
   *                                 so one blow is 47.29, with the cannon's burst.
   * The burst is the CANNON'S burst and no more: its splash damage per second carried over onto
   * the Seat's cadence, rather than a fraction of the (much larger) combined blow, which would
   * have made the Seat better than the sum by a wide margin against a column.
   *
   * THE REACH IS NOT DERIVED, AND THAT IS THE POINT. Strength is what the Seat was asked for and
   * strength is what is added up above; REACH is a different quantity and it decides something
   * else entirely — how long a column walks under fire with no way to answer. Taking the
   * ballista's 350 as well turned the throne into a exclusion zone the length of a march: the
   * referee went red, and the ablation was unambiguous. At 350 with the burst, the benedict
   * mirror ran 33% with matches unfinished at forty-five minutes and `greedy` — four Gates, four
   * Barracks and march — beat benedict 11-7. The same tree with the Seat's gun switched off was
   * clean, and the same tree with the tower garrison reverted was IDENTICAL to the red one, line
   * for line, which is how we know it was this number and nothing else.
   *
   * 200 is the city's own ground (`CITY.r` is 150) and a bowshot past it. The throne covers its
   * precinct and the approach to its gate; it does not shell the country. Measured at 24 games a
   * side: mirror 58%, benedict over greedy 58%, medians 16.8m and 10.7m — a gradient the right
   * way up and inside the band. The two rejected alternatives are worth recording because both
   * sound reasonable: the cannon's 252 measured WORSE than doing nothing (greedy 17%), and
   * keeping 350 while deleting the burst left no gradient at all (50%). */
  CONST.SEAT_GUN = (function () {
    const b = CONST.TOWER_BRANCHES.bolt, c = CONST.TOWER_BRANCHES.cannon;
    const bi = b.dmg.length - 1, ci = c.dmg.length - 1;          // the fully-upgraded entry
    const dps = b.dmg[bi] / b.atk[bi] + c.dmg[ci] / c.atk[ci];
    const atk = Math.min(b.atk[bi], c.atk[ci]);
    return {
      atk,
      dmg: dps * atk,
      range: CONST.CITY.r + 50,
      splash: c.splash[ci],
      splashDmg: (c.dmg[ci] * (c.splashFrac || 0) / c.atk[ci]) * atk
    };
  })();

  /* ---------------- the halls fork ----------------
   * A LEVEL AND A BRANCH ARE DIFFERENT AXES, and the halls only had one of them. A level makes
   * the same man better armed (`TIER`), so a hall's whole build was decided by how much you
   * had spent and never by what you chose. The fork is the choice: at level 2 a hall is rebuilt
   * into one of its branches and raises THAT man for the rest of the match.
   *
   * `spawns` is the recruit, `period` is his interval indexed by (level - fork) — [L2, L3] —
   * `cost` is the 1→2 rebuild and `up` is [2→3], exactly as the Watchtower's branches work.
   * A branch that names no `period` keeps the hall's own. */
  CONST.BUILDINGS.barracks.fork = 2;
  CONST.BUILDINGS.barracks.forkHint = 'Re-raise the hall around one kind of soldiery.';
  CONST.BUILDINGS.barracks.branches = {
    line:   { name: 'The Shieldwall', short: 'Shieldwall', icon: '🛡',
              cost: 130, up: [210], spawns: 'shieldman', period: [11, 11],
              blurb: 'Fewer men and heavier ones. They hold ground and a gateway, and a storm does not sweep them off it.' },
    raid:   { name: 'The Outriders',  short: 'Outriders',  icon: '🐎',
              cost: 110, up: [180], spawns: 'outrider', period: [6, 6],
              blurb: 'Cheap, quick, and gone before the answer arrives. They take springs and hunt whatever shoots at you.' },
    archer: { name: 'The Butts',      short: 'Archers',    icon: '🏹',
              cost: 125, up: [200], spawns: 'archer', period: [8, 8],
              blurb: 'Bowmen — one of the two who can stand on your stone. Raise them if you own walls and towers to fill.' }
  };
  CONST.BUILDINGS.barracks.branchUI = ['line', 'raid', 'archer'];

  CONST.BUILDINGS.spire.fork = 2;
  CONST.BUILDINGS.spire.forkHint = 'Turn the Spire to one art.';
  CONST.BUILDINGS.spire.branches = {
    warden: { name: 'The Warden\'s Art', short: 'Wardens', icon: '✚',
              cost: 200, up: [320], spawns: 'warden', period: [16, 16],
              blurb: 'Sends Wardens, who MEND the men beside them. Nothing else in Amber heals a wound.' },
    binder: { name: 'The Binding',       short: 'Binders', icon: '🌘',
              cost: 190, up: [310], spawns: 'binder', period: [15, 15],
              blurb: 'Sends Shadow-binders, who chain a rival\'s men: chained men march slower and take heavier blows. A beaten fiend they chain turns instead.' }
  };
  CONST.BUILDINGS.spire.branchUI = ['warden', 'binder'];

  CONST.BUILDINGS.siege.fork = 2;
  CONST.BUILDINGS.siege.forkHint = 'Re-tool the yard.';
  CONST.BUILDINGS.siege.branches = {
    ram:     { name: 'The Ram Shed', short: 'Rams',     icon: '🪵',
               cost: 250, up: [380], spawns: 'ram', period: [30, 30],
               blurb: 'Builds Rams: twice an Engine\'s bite and twice its stone, and they must reach the wall to swing.' },
    bombard: { name: 'The Gun Pit',  short: 'Bombards', icon: '💣',
               cost: 240, up: [370], spawns: 'bombard', period: [28, 28],
               blurb: 'Builds Bombards: they out-range every tower on the board and burst where they land.' }
  };
  CONST.BUILDINGS.siege.branchUI = ['ram', 'bombard'];

  /* Units. Every mustered soldier is PAID FOR — essence is a war chest, never a high score.
   * speed in world-units/sec; aggro = acquire radius; bounty paid to the killer's player.
   *
   * `name`, `icon` and `blurb` are for the player, not the sim: the Muster Roll reads them, and
   * until there was a screen listing the host there was nowhere a unit's name could be written
   * down. Do not add a kind without them, or it appears in the codex as a capitalised key.
   *
   * THREE FLAGS DECIDE WHAT A MAN IS FOR:
   *   `menOnly` — he cannot attack works or Seats at all. Not a reduced multiplier: `acquire`
   *      never offers him one, so he walks past stone looking for somebody to shoot. Every
   *      shooter has it, which is why no host of archers and sorcerers can end a match — the
   *      Shieldwall, the Ram and the Bombard are the only road to a rival's Seat. ONE
   *      EXCEPTION, and pillar 3 requires it: a SHRINE is a target for him, because what he
   *      aims at there is not the stone but the walker standing in the lines.
   *   `mans` — he may take a berth on a parapet or a place in a tower. Shooters only: a wall is
   *      a shooting platform, and a swordsman on top of one was only ever a man in the open.
   *   `siege` — his blow against stone, multiplied. Below 1 it would make him bad at sieges;
   *      nothing uses it that way, because `menOnly` says the same thing honestly. */
  CONST.UNITS = {
    /* speeds scale with the board. On the 1400x3000 map a soldier at the old 39 took 58s to
     * cross, and armies died of old age before arriving — bleys/corwin drew 15 of 30 at the
     * cap. These are the old speeds x1.35, which puts a crossing back near the old 45s. */
    soldier:  { name: 'Soldier',   icon: '⚔', hp: 70,  dmg: 9,  atk: 0.9, range: 18,  speed: 53, aggro: 140, bounty: 6,  size: 10, cost: 16,
                blurb: 'Shadow-drawn infantry. He marches, he fights, and he will pull a wall down given long enough.' },
    /* THE SORCERER NO LONGER TOUCHES STONE. He was a siege weapon that also killed men, which
     * made the Spire a strictly better Barracks for anyone who could afford one. He is a
     * shooter now: he holds a parapet, he out-reaches everything else that can stand on one,
     * and he cannot help you take a Seat. */
    sorcerer: { name: 'Sorcerer',  icon: '🜏', hp: 40,  dmg: 15, atk: 1.4, range: 130, speed: 47, aggro: 170, bounty: 10, size: 9,  cost: 28,
                menOnly: true, mans: true,
                blurb: 'Fragile, deadly at range, and the longest reach that can stand on a wall. He does not touch stone.' },
    champion: { name: 'Champion',  icon: '🃏', hp: 420, dmg: 34, atk: 0.8, range: 22,  speed: 59, aggro: 160, bounty: 40, size: 14, cost: 0,
                blurb: 'The family champion, called through a Trump. One at a time, and worth an army while he stands.' },
    fiend:    { name: 'Chaos Fiend', icon: '👁', hp: 55, dmg: 11, atk: 1.0, range: 16, speed: 62, aggro: 260, bounty: 12, size: 10, cost: 0,
                blurb: 'It comes out of a rift and it hates everyone equally. It grows with the hour, and it can be BOUND.' },
    /* ---- the branches ---- */
    /* THE SHIELDWALL: fewer men, and each of them survives the blow that deletes a soldier.
     * The Jewel does sixty; a soldier is left standing on ten and a shieldman barely notices,
     * which is the whole bet — half the damage per essence for a line that a storm, a cannon
     * or a bombard cannot sweep away. */
    /* HE IS FEWER AND TOUGHER, NOT SIMPLY MORE. At 155 he was the most hit points per essence
     * on the board — above the line he is meant to trade against — and a defender who forked to
     * him could not be stormed at all: measured, brand stood on 227 shieldmen at twenty minutes
     * with his Seat untouched at full health, walked the Pattern behind them, and the referee
     * read 80% of contested matches going to the Pattern with matchups timing out. He buys the
     * same hit points per essence a soldier does now. What he still buys, and what the branch is
     * FOR, is that they come in fewer bodies: a storm does sixty and leaves him standing where
     * it deletes the man beside him. */
    shieldman:{ name: 'Shieldman', icon: '🛡', hp: 128, dmg: 13, atk: 1.0, range: 20,  speed: 44, aggro: 130, bounty: 11, size: 12, cost: 30,
                blurb: 'The house guard. Two soldiers out-fight him and neither of them lives through a storm.' },
    /* PRICED AS FAST, NOT AS BEST. At 13 he was the finest damage-per-essence buy on the
     * board — better than a soldier — AND half again as quick, which is not a trade, it is
     * simply a better soldier. He costs a soldier's price now and keeps the speed; what he
     * gives up for it is the hit points, which is the bargain the branch is meant to be. */
    outrider: { name: 'Outrider',  icon: '🐎', hp: 48,  dmg: 8,  atk: 0.75, range: 18, speed: 76, aggro: 150, bounty: 6,  size: 9,  cost: 16,
                blurb: 'Arden\'s rangers — half again as fast as anything on the board. They take springs and run down shooters.' },
    /* REACH IS THE EXPENSIVE THING, and at 19 he was not paying for it: 87 further than a
     * soldier throws, for three essence more, which meant an archer host killed melee for
     * free. Measured with the heirs actually forking, julian went to all-archers and became
     * the strongest heir on the ladder while being unable to end a match — the field was his
     * and the Seats were untouchable. He is priced against the SORCERER now, who does the same
     * job: cheaper and shorter-reaching than one, and no longer cheaper than the line. */
    archer:   { name: 'Archer',    icon: '🏹', hp: 42,  dmg: 6,  atk: 0.78, range: 105, speed: 50, aggro: 150, bounty: 8,  size: 9,  cost: 23,
                menOnly: true, mans: true,
                blurb: 'The garrison you can afford. He lines a curtain and fills a tower — and an arrow has never brought down a wall.' },
    warden:   { name: 'Warden',    icon: '✚', hp: 55,  dmg: 5,  atk: 1.5, range: 90,  speed: 47, aggro: 120, bounty: 12, size: 9,  cost: 34,
                menOnly: true, mend: 7, mendR: 110,
                blurb: 'The Warden\'s art: he mends the man beside him. Nothing else in Amber heals, which is what makes him worth the essence.' },
    /* THE BINDING IS CHAINS NOW, NOT A CONVERSION. It used to do one thing: flip a Chaos
     * fiend that had already been beaten below `bindHp`. There are not enough fiends on the
     * board for that to decide anything, it did nothing whatever in a match where the black
     * road stayed quiet, and the only way to make it matter would have been to put MORE Chaos
     * on the board — which is the opposite of what the black road is capped for. So the branch
     * was a dead pick, and an heir who took it had bought nothing.
     * A binding is now thrown on an ENEMY SOLDIER, any enemy soldier, and it is a SLOW and an
     * AMPLIFIER: `hexSlow` off his stride and `hexAmp` onto everything that hits him, for
     * `hexT` seconds. That makes the art a fighting choice in every match against every
     * opponent — a chained column arrives late and dies fast — rather than a niche one near a
     * rift. The numbers: 0.6 is a stride slower than an Engine's, which is enough to break a
     * charge without deleting it, and 1.35 is a third again on every blow, so a binder pays
     * for himself beside two soldiers and not beside one. `hexCd` is the throw's cadence and
     * it costs him his swing — he throws chains INSTEAD of shooting, which is what keeps him
     * from being simply a better sorcerer. Reach is a sorcerer's, so he stands in the line.
     * The fiend-binding survives as a RIDER on the same throw: chain a fiend already beaten
     * below `bindHp` and it flips for `BIND_LIFE` exactly as before. Flavour, not identity. */
    binder:   { name: 'Shadow-binder', icon: '🌘', hp: 50, dmg: 9, atk: 1.3, range: 110, speed: 47, aggro: 150, bounty: 12, size: 9, cost: 32,
                menOnly: true, bind: true, bindR: 130, bindHp: 0.5,
                hexT: 8, hexSlow: 0.6, hexAmp: 1.35, hexCd: 1.3,
                blurb: 'He throws chains of Shadow on a rival\'s men: they march slower and every blow lands harder while the chains hold. A Chaos fiend already beaten turns instead — Shadow will not hold it long.' },
    /* `siege` multiplies damage against a WORK or a Seat, and nothing else. An Engine swings
     * every 2.4s for 12 — five damage a second against men, which is half a soldier at four
     * times the price — and 168 against stone, which is seven soldiers' worth. It cannot
     * outrange a tower and it cannot run, so it arrives escorted or it does not arrive. */
    engine:   { name: 'Siege Engine', icon: '⚒', hp: 260, dmg: 12, atk: 2.4, range: 150, speed: 30, aggro: 190, bounty: 30, size: 14, cost: 70, siege: 14,
                blurb: 'Slow, fragile in a fight, and worth four soldiers against stone. It arrives escorted or it does not arrive.' },
    /* THE RAM has to TOUCH what it breaks, and that is the whole price of it: it cannot
     * outrange a tower, it cannot run, and it will stand in front of a Seat soaking everything
     * the defender has. What it buys is twice an Engine's bite on stone and twice its stone. */
    ram:      { name: 'Siege Ram',  icon: '🪵', hp: 480, dmg: 16, atk: 2.6, range: 26,  speed: 26, aggro: 120, bounty: 40, size: 15, cost: 95, siege: 22,
                blurb: 'A roofed ram on rollers. It must reach the wall to swing, and very little that reaches one survives it.' },
    /* THE BOMBARD is Corwin's trick on a cart — the same shadow-rouge that burns in a Cannon
     * Tower. It out-ranges every tower on the board, which is what a siege train is FOR; it
     * pays for that in stone bitten per shot, and in being unable to defend itself at all. */
    bombard:  { name: 'Bombard',    icon: '💣', hp: 190, dmg: 14, atk: 3.2, range: 365, speed: 26, aggro: 240, bounty: 34, size: 14, cost: 88, siege: 9,
                splash: 55, splashFrac: 0.4,
                blurb: 'It out-ranges every tower ever raised, and bursts where it lands. Nothing that gets close to it lives long enough to regret it.' }
  };

  CONST.POWERS = {
    /* THE STORM MAIMS, IT DOES NOT DELETE. At 36 dps for 2.5s it dealt 90 damage to a 70-hp
     * soldier, so every man under the disc simply vanished: measured against an army at the
     * muster, one cast killed 31 of 120 — 496 essence of troops for the 90 it cost, and it
     * comes back every 50 seconds. A power that returns five times its price on a single tap
     * is not a power, it is the game. Sixty damage leaves a full-strength soldier standing on
     * ten hit points, which is what a storm should be: the blow you open with, not the one
     * that ends it. Sorcerers still die outright; an Engine barely notices. */
    storm: { name: 'Jewel of Judgment', icon: '⛈', cd: 50, cost: 90, radius: 85, dps: 24, dur: 2.5, delay: 1.0,
             blurb: 'Call the storm upon any place you can see. It breaks an army; it does not erase one.' },
    trump: { name: 'Trump of Benedict', icon: '🃏', cd: 100, cost: 160,
             blurb: 'Summon the family champion at your gate (one at a time)' }
  };

  /* Chaos director: rifts tear open at black-road sites (and, late, at springs);
   * fiends march the paths toward the cities, sieging whatever stands in the way.
   *
   * CHAOS IS THE PRICE OF THE BEST GROUND, NOT A DOOMSDAY TIMER (DESIGN_PRINCIPLES §4).
   * Ramping hp and damage together without a ceiling multiplies into one: measured against
   * the stat block, a lone fiend ate 5 soldiers by minute 10, 9 by minute 15 and 26 by
   * minute 30, while the rift schedule climbed to 40 fiends a minute. Bots survived that by
   * massing 150 troops and fighting in a blob, where a dozen swords answer one fiend at
   * once; a human holding a road with six men met the arithmetic head-on. Both curves are
   * now capped: a fiend grows into a soldier's better — about two swords to put down — and
   * stays there. Late Chaos still presses, by being MANY, which is a fight you can win. */
  CONST.CHAOS = {
    /* in a REACH world a fiend's flow field is fenced by its target city's disc, widened by
     * this — wide enough to wander, narrow enough that the road never bills a country-wide
     * Dijkstra. If tuning fights back, the fallback is chaos off in reach worlds, not a
     * bigger disc. */
    boundMul: 1.7,
    /* AND IT IS NOT THE MAIN ENEMY EITHER. Capping a fiend's strength left the RATE alone,
     * which climbed to about 32 fiends a minute — and tagging every player death across four
     * whole matches found Chaos had taken 73% of them (rival 199, Chaos 572, towers 13). One
     * game it was 100%. That is not the price of the best ground, it is the opponent. The
     * schedule is cut to roughly a third: Chaos still swells, and forward country still costs
     * something to hold, but the war is between the heirs again. */
    /* AND IT PLATEAUS. Every dial had a ceiling except the one that mattered: the fiends PER
     * RIFT climbed forever, so at half an hour the black road was sending eleven at a time
     * every twenty seconds — thirty-three a minute — and a match that ran long stopped being
     * decidable by the heirs at all. Reported from play. A director presses; it does not
     * escalate without limit. Everything below reaches its ceiling inside ten minutes, and
     * from there Chaos is a constant tax on forward country rather than a rising tide:
     * 5 fiends every 26s, at twice the hit points and a third again the damage. */
    firstAt: 100,                      // s before the first rift
    surgeAt: 600,                      // s: the one-time "black road surges" knell (a banner — the ramp above is the teeth)
    interval: (t) => Math.max(26, 50 - t * 0.030),  // s between rifts, floored at 800s
    count: (t) => Math.min(5, 2 + Math.floor(t / 190)),   // fiends per rift, capped at 570s
    hpScale: (t) => Math.min(2.0, 1 + t / 480),
    dmgScale: (t) => Math.min(1.35, 1 + t / 1200)
  };

  /* THE KNELL. A rival's walk is the one thing on this board that wins without touching you,
   * and it is nine and a half minutes long — so being told about it once, in a banner that
   * shares its corner with rift warnings and storm calls, is not being told. Four marks: the
   * moment he sets foot, and then the three quarters of the way that mean something. They are
   * thrown across the middle of the screen and fade, because the one place a player is
   * certainly looking is where the fight is. */
  CONST.PATTERN_ALERTS = [
    { at: 0.001, msg: ' has set foot upon the Pattern!' },
    { at: 50,    msg: ' walks the Pattern — halfway to the throne' },
    { at: 75,    msg: ' is three quarters of the way round the Pattern' },
    { at: 90,    msg: ' nears the final veil of the Pattern!' }
  ];
  CONST.HURT_ALERT = 12;   // s between "your city is hurt" banners per heir — often enough to matter, quiet enough to read

  /* NO CEILING ON AN HEIR'S MUSTER. There was one, at 110, and a chronicle from play showed
   * exactly what it cost: an army pinned at 110 from minute six, twenty-two thousand essence
   * banked with nowhere to go, and a match that could not be won by force because the
   * treasury had stopped being a decision. THE ECONOMY IS THE BRAKE — every recruit is paid
   * for continuously, so the muster settles where income says it should. Measured over played
   * matches with the ceiling lifted, armies land at 125-239 a side rather than running away.
   *
   * The ceiling was also load-bearing for performance, so that had to go first: target
   * acquisition is a grid lookup instead of a walk of the whole board, and the renderer's
   * instance buffers grow instead of silently truncating at 260. At 1200 men the sim costs
   * 1.9 ms a tick (6% of realtime) and a fogged snapshot is 27 KB against a 120 KB budget.
   *
   * Chaos keeps its cap. That one is not a player's choice — it is a director that would
   * otherwise spawn without limit, which is what a doomsday timer looks like. */
  CONST.CAP = { player: 0, chaos: 70 };   // 0 = no ceiling

  /* ---------------- what one hall keeps in the field ----------------
   * A CEILING ON THE REALM AND A CEILING ON A HALL ARE DIFFERENT ANIMALS, and the paragraph
   * above is about the first. A per-PLAYER ceiling was removed because it left essence banked
   * with nowhere to go and a treasury that had stopped being a decision. A per-HALL one has the
   * opposite property: the surplus buys ANOTHER HALL, so it still has somewhere to go, and the
   * size of an army becomes a question of what you built rather than of how long you waited.
   *
   * IT IS NOT FOR PERFORMANCE — that was measured (1200 men cost 1.9 ms a tick, six per cent
   * of realtime) — AND, HONESTLY, IT IS NOT MUCH FOR THE ECONOMY EITHER. The paragraph that
   * stood here claimed a full hall stops drawing, a treasury accumulates, and the Pattern
   * opens. TRUE AT PEACE AND FALSE IN WAR, and war is the case that stalls: the ablation ran
   * the referee with the cap in force and got the same table to the digit, because in a real
   * match a hall sits at 3-9 of 32 REPLACING LOSSES, and a standing ceiling never binds on
   * replacement. What actually opened the Pattern economy was the heirs holding Gates (the
   * errand company): income, not thrift. What this cap genuinely buys: army size is bounded
   * by what you BUILT rather than how long you waited (the pathological long-match blowup is
   * gone), the per-type numbers give a branch its company size, and the number is now on the
   * build card and in the Muster Roll — so it had better be true.
   *
   * ONE NUMBER, NOT TWELVE. A hall keeps a fixed VALUE of men, so cheap men come in numbers and
   * dear ones do not: a Barracks keeps 32 soldiers, a Ram Shed 5 rams. That falls out of the
   * price rather than being written down per unit, so re-pricing a man re-sizes his company and
   * the two can never drift apart — and a branch changes the number by changing who is mustered,
   * with no entry of its own. The floor keeps the dearest engine a company rather than a pair. */
  CONST.HALL_KEEP = 512;
  /* WHO STANDS IN THE LINE AND WHO STANDS BEHIND IT. A man's reach already says which he is,
   * and the table is not close: everything that fights at arm's length reaches 16 to 26, and
   * everything that throws reaches 90 or better. So the answer is DERIVED from the reach
   * rather than written down twelve times — a new kind lands on the right side of the line by
   * having a reach, and nobody has to remember a flag. It is deliberately not `menOnly`: an
   * Engine and a Bombard shoot stone for a living and still belong at the back, and a Ram at
   * reach 26 belongs at the front however slowly it walks. */
  CONST.LINE_REACH = 60;
  for (const k of Object.keys(CONST.UNITS)) {
    const u = CONST.UNITS[k];
    u.shoots = u.range >= CONST.LINE_REACH;
    /* the Champion and the fiend are free and no hall musters them — a cap on them would be a
     * cap on a Trump and on the black road, which is `CAP.chaos`'s business and not this one */
    if (u.cost > 0) u.keep = Math.max(3, Math.round(CONST.HALL_KEEP / u.cost));
  }

  CONST.MAX_LEVEL = 3;
  CONST.EVENT_CAP = 160;   // renderer-queue safety cap

  global.CONST = CONST;
  if (typeof module !== 'undefined' && module.exports) module.exports = CONST;
})(typeof window !== 'undefined' ? window : globalThis);

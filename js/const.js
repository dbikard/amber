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
                 homeAggro: 140 };  // extra acquire reach inside your own city's r — an open city's garrison sees trouble coming

  /* ---- Free placement (open world, stage 4) ----
   * You may raise a work anywhere your writ runs, on ground that will bear it. Your writ is
   * the Seat's own country plus the country around every Shadow Gate you hold — so expanding
   * what you can build IS taking the map, which is the anti-stall model in one rule. */
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

  /* Solo difficulty, MEASURED rather than guessed. `slow` and `noise` turned out to be decorative: an heir polled at
   * half the rate, or skipping 45% of its turns outright, still won its mirror 42-50% of the
   * time, because its decisions are "spend the essence on the next thing in the plan" and the
   * essence is still there a few seconds later. `eco` is the only knob that bit — and the
   * shipped HEIR at 0.80 measured a 50% mirror, i.e. no handicap at all, while still putting
   * an army on the player's ground at 5.3 minutes. Worse, cutting income alone brings the
   * assault SOONER, since a poorer heir builds less realm and marches earlier. So the ladder
   * now runs on income AND on `hold`, the hour before the heir will march on your Seat. */
  /* EASED, ALL THREE OF THEM — and then put back a notch, because eased read as too easy once
   * the heirs started marching on Seats instead of escorting builders around their own half of
   * the board. The table sits between where it began and where the easing left it: still more
   * room than the original on every rung, and a good deal less than it had a version ago.
   * The shape is unchanged — income and the hour it marches, both moving monotonically down. Note what this costs: PRINCE is no longer the unhandicapped heir. The
   * heirs still fight each other at full strength in `node sim.js`, and that is where the
   * balance targets are measured; the top of the solo ladder is now a hard opponent rather
   * than the reference one. */
  CONST.DIFFICULTY = {
    squire:  { key: 'squire',  name: 'SQUIRE',  slow: 1.6,  noise: 0.30, eco: 0.52, hold: 780,
               blurb: 'Poor, and will not march on your Seat for thirteen minutes.' },
    heir:    { key: 'heir',    name: 'HEIR',    slow: 1.2,  noise: 0.15, eco: 0.70, hold: 390,
               blurb: 'A real opponent, and at your gate not long after you have a realm.' },
    prince:  { key: 'prince',  name: 'PRINCE',  slow: 1.0,  noise: 0.05, eco: 0.96, hold: 60,
               blurb: 'Very nearly the heir the other heirs face, and he comes almost at once.' }
  };
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
                  crush: 0.15, crushFree: 3, crushFloor: 0.45 };

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
  /* Seat colours. You are ALWAYS gold — a player should never have to remember which of four
   * colours is theirs — so these are read by seat index for everyone else, skipping gold. */
  CONST.SEAT_TINT = [0xffd98a, 0xff8a96, 0xc48eff, 0x64d8d8];
  CONST.CHAOS_TINT = 0x7dff9e;

  CONST.SITE_NAMES = {
    node: ['the Singing Spring', 'the Mirror Pool', 'the Weeping Well', 'the Silver Tarn',
           'the Deep Font', 'the Still Water', 'the Glass Rill', 'the Cold Cistern',
           'the Whispering Font', 'the Drowned Bell', 'the Green Well', 'the Salt Spring',
           'the Amber Rill', 'the Sunken Basin'],
    vantage: ['the Grey Crag', 'the Watcher’s Tor', 'the Broken Stair', 'the High Shoulder',
              'the Wind Scarp', 'the Old Barrow', 'the Black Tor', 'the Raven Steps']
  };

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
  CONST.FOG = { cell: 26, keep: 0.45, ease: 0.22 };

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
                blurb: 'A run of stone. Nothing crosses it and nothing shoots through it — but men who come up to man it can be shot back.' },
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
                 berth: 15, foot: 20, rows: 3,
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
  for (const k of Object.keys(CONST.UNITS)) {
    const u = CONST.UNITS[k];
    /* the Champion and the fiend are free and no hall musters them — a cap on them would be a
     * cap on a Trump and on the black road, which is `CAP.chaos`'s business and not this one */
    if (u.cost > 0) u.keep = Math.max(3, Math.round(CONST.HALL_KEEP / u.cost));
  }

  CONST.MAX_LEVEL = 3;
  CONST.EVENT_CAP = 160;   // renderer-queue safety cap

  global.CONST = CONST;
  if (typeof module !== 'undefined' && module.exports) module.exports = CONST;
})(typeof window !== 'undefined' ? window : globalThis);

/* const.js — content definition tables. Headless-safe. Balance lives here; sim.js is the referee. */
(function (global) {
  'use strict';

  const CONST = {};

  CONST.SIM_DT = 1 / 30;          // fixed timestep (browser + sim identical)
  /* the city is a real place: a walled disc with the Tower of the Seat at its heart */
  /* seatR is the Seat-tower's own ground: no work may stand inside it, and a tap inside it
   * opens the Seat's sheet. ONE number, so the two can never disagree — they did, and the
   * ring between them was buildable ground you could not tap. */
  CONST.CITY = { r: 150, seatR: 74 };

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
  CONST.MASONS = { base: 1, per: 3, max: 4 };

  /* Solo difficulty, MEASURED rather than guessed. `slow` and `noise` turned out to be decorative: an heir polled at
   * half the rate, or skipping 45% of its turns outright, still won its mirror 42-50% of the
   * time, because its decisions are "spend the essence on the next thing in the plan" and the
   * essence is still there a few seconds later. `eco` is the only knob that bit — and the
   * shipped HEIR at 0.80 measured a 50% mirror, i.e. no handicap at all, while still putting
   * an army on the player's ground at 5.3 minutes. Worse, cutting income alone brings the
   * assault SOONER, since a poorer heir builds less realm and marches earlier. So the ladder
   * now runs on income AND on `hold`, the hour before the heir will march on your Seat. */
  CONST.DIFFICULTY = {
    squire:  { key: 'squire',  name: 'SQUIRE',  slow: 1.6,  noise: 0.30, eco: 0.55, hold: 720,
               blurb: 'Poor, and will not march on your Seat for twelve minutes.' },
    heir:    { key: 'heir',    name: 'HEIR',    slow: 1.2,  noise: 0.15, eco: 0.72, hold: 360,
               blurb: 'A real opponent, but not at your gate before you have a realm.' },
    prince:  { key: 'prince',  name: 'PRINCE',  slow: 1.0,  noise: 0.05, eco: 1.00, hold: 0,
               blurb: 'The heir at full strength, as the heirs fight each other.' }
  };
  CONST.DIFFICULTY_UI = ['squire', 'heir', 'prince'];
  CONST.DIFFICULTY_DEFAULT = 'heir';

  CONST.BUILD = { foot: 34, gap: 10 };   // footprint radius, and clearance between works
  /* a Shadow Gate within this of an essence node draws from it (and claims it) */
  CONST.NODE = { r: 96 };
  CONST.CASTLE_HP = 2500;         // retune: a Seat must not fall in ninety seconds of contact
  CONST.START_ESSENCE = 180;
  CONST.BASE_INCOME = 2.5;        // essence/sec before any Shadow Gate
  CONST.CASTLE_ZONE = 46;         // units closer than this to a castle attack it

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

  CONST.STRUCT_REGEN = 2;         // hp/sec self-mending after 10s unharmed
  CONST.VISION = { city: 420, unit: 260, build: 240,
    /* A walk on the Pattern is a beacon. The blazing lines light the Shrine and the ground
     * around it for EVERYONE — you cannot reach for the throne in secret, and your rivals
     * are owed the chance to come and stop you. */
    pattern: 380 };

  /* Ground you have HAD eyes on stays on the map under a lighter veil once your troops move
   * on — a country you have walked should not go black again behind you. `keep` is how much
   * of the full veil remains over remembered ground; `cell` is the grain the memory is kept
   * at, coarse enough to cost nothing and fine enough that the edge reads as terrain. */
  CONST.FOG = { cell: 26, keep: 0.45 };

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
    cacheMax: 48       // flow fields held before the cache is dropped
  };

  /* Buildings — ONE table now. Outposts and city works were always the same idea: a thing
   * you pay for, that stands somewhere, that can be broken. With free placement the
   * distinction had nothing left to mean. up = upgrade costs to L2/L3; effect arrays are
   * [L1,L2,L3]. `claim` marks a work whose country you may build in. */
  CONST.BUILDINGS = {
    /* A Gate stands ON a spring and nowhere else. It is the only thing that draws Shadow out
     * of the ground, so the essence is out on the map and your writ can only follow it there.
     * That is the whole anti-stall model, and it holds because there is no home substitute. */
    gate:     { name: 'Shadow Gate',   icon: '🌀', cost: 120, up: [110, 190], claim: true, raise: 14,
                nodeIncome: [4.5, 7, 10.5], hp: 300, vision: 300, onNode: true,
                blurb: 'Raised ON a spring of Shadow, and only there. It draws deep, and your writ runs where your Gates stand.' },
    barracks: { name: 'Barracks',      icon: '⚔', cost: 150, up: [120, 200], hp: 360, raise: 18,
                spawns: 'soldier', period: [8, 6.4, 5.0],
                blurb: 'Musters Soldiers who march the black road' },
    /* THE ANSWER TO A CASTLE. Soldiers were the only siege there was, and a Seat has 2500
     * hit points behind towers — so "win by force" meant grinding a rival's outworks forever
     * while neither Seat took a scratch. An Engine is slow, fragile in a fight and useless at
     * holding ground; against a work or a Seat it is worth four of the men it costs. It has
     * to be escorted, which is the point: the Works turn a war chest into a threat. */
    siege:    { name: 'Siege Works',   icon: '⚒', cost: 300, up: [230, 360], hp: 380, raise: 28,
                spawns: 'engine', period: [24, 19, 15],
                blurb: 'Builds Engines: slow, and made for breaking works and Seats rather than men. They need an escort.' },
    spire:    { name: 'Sorcery Spire', icon: '🜏', cost: 240, up: [180, 300], hp: 320, raise: 24,
                spawns: 'sorcerer', period: [11, 8.8, 7.0],
                blurb: 'Sends Sorcerers — fragile, deadly at range' },
    tower:    { name: 'Watchtower',    icon: '🏹', cost: 130, up: [100, 180], hp: 480, raise: 15,
                dmg: [10, 15, 20], range: [250, 275, 300], atk: 1.1, fork: 2, vision: 520,
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
     * drain = essence/sec while walking, rate = %/sec: ~9.5 minutes and ~18k essence. */
    shrine:   { name: 'Pattern Shrine', icon: '✴', cost: 380, unique: true, hp: 450, raise: 36,
                drain: [32], rate: [0.175], decay: 0.05, breakLoss: 22,
                blurb: 'Channel Essence to walk the Pattern. 100% claims the throne. The walk is REVEALED, it is ruinously expensive, and the lines fade the moment you stop.' }
  };
  CONST.BUILD_ORDER_UI = ['gate', 'barracks', 'tower', 'spire', 'siege', 'shrine'];

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

  /* Units. Every mustered soldier is PAID FOR — essence is a war chest, never a high score.
   * speed in world-units/sec; aggro = acquire radius; bounty paid to the killer's player. */
  CONST.UNITS = {
    /* speeds scale with the board. On the 1400x3000 map a soldier at the old 39 took 58s to
     * cross, and armies died of old age before arriving — bleys/corwin drew 15 of 30 at the
     * cap. These are the old speeds x1.35, which puts a crossing back near the old 45s. */
    soldier:  { hp: 70,  dmg: 9,  atk: 0.9, range: 18,  speed: 53, aggro: 140, bounty: 6,  size: 10, cost: 16 },
    sorcerer: { hp: 40,  dmg: 15, atk: 1.4, range: 130, speed: 47, aggro: 170, bounty: 10, size: 9,  cost: 28 },
    champion: { hp: 420, dmg: 34, atk: 0.8, range: 22,  speed: 59, aggro: 160, bounty: 40, size: 14, cost: 0 },
    fiend:    { hp: 55,  dmg: 11, atk: 1.0, range: 16,  speed: 62, aggro: 260, bounty: 12, size: 10, cost: 0 },
    /* `siege` multiplies damage against a WORK or a Seat, and nothing else. An Engine swings
     * every 2.4s for 12 — five damage a second against men, which is half a soldier at four
     * times the price — and 168 against stone, which is seven soldiers' worth. It cannot
     * outrange a tower and it cannot run, so it arrives escorted or it does not arrive. */
    engine:   { hp: 260, dmg: 12, atk: 2.4, range: 150, speed: 30, aggro: 190, bounty: 30, size: 14, cost: 70, siege: 14 }
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
    firstAt: 100,                      // s before the first rift
    interval: (t) => Math.max(20, 50 - t * 0.030),  // s between rifts
    count: (t) => 2 + Math.floor(t / 190),          // fiends per rift
    hpScale: (t) => Math.min(2.0, 1 + t / 480),
    dmgScale: (t) => Math.min(1.35, 1 + t / 1200)
  };

  CONST.PATTERN_ALERTS = [
    { at: 0.001, msg: ' has set foot upon the Pattern!' },
    { at: 50,    msg: ' walks the Pattern — halfway to the throne' },
    { at: 90,    msg: ' nears the final veil of the Pattern!' }
  ];

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

  CONST.MAX_LEVEL = 3;
  CONST.EVENT_CAP = 160;   // renderer-queue safety cap

  global.CONST = CONST;
  if (typeof module !== 'undefined' && module.exports) module.exports = CONST;
})(typeof window !== 'undefined' ? window : globalThis);

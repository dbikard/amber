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

  /* Solo difficulty. `slow` and `noise` blunt how OFTEN an heir acts and how often it fumbles;
   * `eco` is what it draws from the same ground. Skirmish used to hand every heir full
   * strength — the only ramp was the campaign ladder — which is why solo played so hard. */
  CONST.DIFFICULTY = {
    squire:  { key: 'squire',  name: 'SQUIRE',  slow: 2.0,  noise: 0.45, eco: 0.60,
               blurb: 'The heir is slow to act and poor. Room to learn the board.' },
    heir:    { key: 'heir',    name: 'HEIR',    slow: 1.4,  noise: 0.24, eco: 0.80,
               blurb: 'A real opponent that still leaves you time to build.' },
    prince:  { key: 'prince',  name: 'PRINCE',  slow: 1.0,  noise: 0.05, eco: 1.00,
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
    nodes: 14, nodesMin: 9, nodeGap: 300, springNear: 200, springFar: 400, seatApartMulti: 0.62,     // springs: how many, and how far apart
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
    gate:     { name: 'Shadow Gate',   icon: '🌀', cost: 120, up: [110, 190], claim: true, raise: 10,
                nodeIncome: [4.5, 7, 10.5], hp: 300, vision: 300, onNode: true,
                blurb: 'Raised ON a spring of Shadow, and only there. It draws deep, and your writ runs where your Gates stand.' },
    barracks: { name: 'Barracks',      icon: '⚔', cost: 150, up: [120, 200], hp: 360, raise: 13,
                spawns: 'soldier', period: [8, 6.4, 5.0],
                blurb: 'Musters Soldiers who march the black road' },
    spire:    { name: 'Sorcery Spire', icon: '🜏', cost: 240, up: [180, 300], hp: 320, raise: 17,
                spawns: 'sorcerer', period: [11, 8.8, 7.0],
                blurb: 'Sends Sorcerers — fragile, deadly at range' },
    tower:    { name: 'Watchtower',    icon: '🏹', cost: 130, up: [100, 180], hp: 480, raise: 11,
                dmg: [10, 15, 20], range: [250, 275, 300], atk: 1.1, fork: 2, vision: 520,
                blurb: 'Far sight over Shadow, and arrows for trespassers. At level 2 the tower is REBUILT — ballista or cannon, and there is no going back' },
    /* The Shrine does not upgrade. There is one Pattern and one way to walk it, and the walk
     * is meant to be a commitment you pay for in essence you are not spending on an army —
     * an upgrade path only made it cheaper AND faster, so it was never a commitment at all.
     * drain = essence/sec while walking, rate = %/sec: ~7.6 minutes and ~10.9k essence. */
    shrine:   { name: 'Pattern Shrine', icon: '✴', cost: 380, unique: true, hp: 450, raise: 26,
                drain: [24], rate: [0.22],
                blurb: 'Channel Essence to walk the Pattern. 100% claims the throne. Walking is REVEALED, and it is expensive.' }
  };
  CONST.BUILD_ORDER_UI = ['gate', 'barracks', 'tower', 'spire', 'shrine'];

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
    fiend:    { hp: 55,  dmg: 11, atk: 1.0, range: 16,  speed: 62, aggro: 260, bounty: 12, size: 10, cost: 0 }
  };

  CONST.POWERS = {
    storm: { name: 'Jewel of Judgment', icon: '⛈', cd: 50, cost: 90, radius: 85, dps: 36, dur: 2.5, delay: 1.0,
             blurb: 'Call the storm upon any place you can see' },
    trump: { name: 'Trump of Benedict', icon: '🃏', cd: 100, cost: 160,
             blurb: 'Summon the family champion at your gate (one at a time)' }
  };

  /* Chaos director: rifts tear open at black-road sites (and, late, at springs);
   * fiends march the paths toward the cities, sieging whatever stands in the way. */
  CONST.CHAOS = {
    firstAt: 90,                       // s before the first rift
    interval: (t) => Math.max(15, 46 - t * 0.04),   // s between rifts
    count: (t) => 2 + Math.floor(t / 150) + (t > 480 ? 2 : 0),  // fiends per rift (surge at 8 min)
    hpScale: (t) => 1 + t / 300,
    dmgScale: (t) => 1 + t / 520
  };

  CONST.PATTERN_ALERTS = [
    { at: 0.001, msg: ' has set foot upon the Pattern!' },
    { at: 50,    msg: ' walks the Pattern — halfway to the throne' },
    { at: 90,    msg: ' nears the final veil of the Pattern!' }
  ];

  /* Unit caps are PER OWNER. A single global cap of 240 deadlocked the game: one player's
   * army filled it and then nobody could muster — including Chaos, which had 55,694 rift
   * spawns silently refused in a measured 45-minute stall. A cap that can starve the third
   * army is a cap that can freeze the board. */
  CONST.CAP = { player: 110, chaos: 70 };

  CONST.MAX_LEVEL = 3;
  CONST.EVENT_CAP = 160;   // renderer-queue safety cap

  global.CONST = CONST;
  if (typeof module !== 'undefined' && module.exports) module.exports = CONST;
})(typeof window !== 'undefined' ? window : globalThis);

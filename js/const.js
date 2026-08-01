/* const.js — content definition tables. Headless-safe. Balance lives here; sim.js is the referee. */
(function (global) {
  'use strict';

  const CONST = {};

  CONST.SIM_DT = 1 / 30;          // fixed timestep (browser + sim identical)
  CONST.SLOTS = 8;                // building plots ringing the Seat-tower
  /* the city is a real place: a walled disc with the Tower of the Seat at its heart */
  CONST.CITY = { r: 150, slotR: 104 };
  CONST.WALL = { cost: 150, up: [140, 230], hp: [900, 1500, 2200] };   // a wall is a WALL
  CONST.BUILDING_HP = { gate: 300, barracks: 360, tower: 480, spire: 320, shrine: 450 };
  CONST.CASTLE_HP = 1000;
  CONST.START_ESSENCE = 180;
  CONST.BASE_INCOME = 2.5;        // essence/sec before any Shadow Gate
  CONST.CASTLE_ZONE = 46;         // units closer than this to a castle attack it

  /* ---- The Shadow map (v0.2): a mirrored site graph, 700×2400 world units ----
   * Player 0's city is at the bottom; the template lists player-0's half + the middle
   * and is mirrored through (350,1200) for fairness. jitter is applied per-seed. */
  CONST.MAP = { W: 700, H: 2400 };
  CONST.SITE_TEMPLATE = [
    /* [key, x, y, kind] — mirrored keys get '™' → their mirror twin '_m' */
    ['city0', 350, 2110, 'city'],
    ['r0', 350, 1780, 'road'], ['mid', 350, 1200, 'road'],
    ['s0a', 110, 1850, 'spring'], ['s0b', 590, 1850, 'spring'],
    ['sm0', 90, 1200, 'spring'],
    ['v0', 170, 1520, 'vantage'], ['v1', 530, 1520, 'vantage']
  ];
  CONST.EDGE_TEMPLATE = [
    ['city0', 'r0'], ['r0', 'mid'],
    ['city0', 's0a'], ['city0', 's0b'],
    ['s0a', 'v0'], ['s0b', 'v1'],
    ['v0', 'sm0'], ['r0', 'v0'], ['r0', 'v1'],
    ['mid', 'sm0']
  ];
  CONST.SITE_NAMES = {
    spring: ['the Singing Spring', 'the Mirror Pool', 'the Weeping Well', 'the Silver Tarn', 'the Deep Font', 'the Still Water'],
    vantage: ['the Grey Crag', 'the Watcher’s Tor', 'the Broken Stair', 'the High Shoulder'],
    road: ['the First Milestone', 'the Mid-Reach', 'the Last Milestone']
  };

  /* Outposts — structures built on map sites (a friendly unit must stand there).
   * The essence sink and the reason to fight for the map. */
  CONST.OUTPOSTS = {
    sgate:   { name: 'Shadow Gate', icon: '🌀', only: 'spring', cost: 140, up: [130, 220],
               income: [5, 8, 12], hp: 300,
               blurb: 'Draw Essence from this spring of Shadow' },
    watch:   { name: 'Watchpost',   icon: '🏹', cost: 120, up: [100, 170],
               dmg: [9, 13, 18], range: 190, atk: 1.1, vision: 620, hp: 280,
               blurb: 'Far sight over Shadow, and arrows for trespassers' },
    rampart: { name: 'Rampart',     icon: '🛡', cost: 160, up: [140, 240],
               hp: 700, hpUp: [1050, 1500],
               blurb: 'Walls the path. Enemies must break it to pass' }
  };
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
    /* terrain: ROAD costs 1, OPEN 2, FOREST 4, ROCK/WATER are impassable. You may always
     * leave the road — it is simply slower and more exposed out there. */
    roadR: 20,         // within this of a path curve or site the ground is road/court
    wildR: 100,        // by this far from any way through, the country has closed entirely
    rockAt: 0.76,      // solidity above which the ground is rock or water
    forestAt: 0.46,    // …and above which it is wood
    noiseF: 0.15,      // noise frequency in cells (lower = broader masses)
    siteR: 32,         // a site is open ground of this radius
    rampartR: 104,     // an enemy rampart seals its site: must be broken, not walked around
    arrive: 72,        // within this of the goal a unit steers to its own place in the line
    cacheMax: 48       // flow fields held before the cache is dropped
  };

  CONST.STRUCT_REGEN = 2;         // hp/sec self-mending after 10s unharmed
  CONST.VISION = { city: 420, unit: 260, post: 300 };   // watchposts override via .vision


  /* Buildings. up = upgrade costs to L2/L3; per-level effect arrays are [L1,L2,L3]. */
  CONST.BUILDINGS = {
    gate:     { name: 'Shadow Gate',   icon: '🌀', cost: 100, up: [90, 160],
                income: [3, 4.5, 6.5],   // modest: the real economy is springs on the map
                blurb: '+Essence per second, drawn from Shadow' },
    barracks: { name: 'Barracks',      icon: '⚔', cost: 150, up: [120, 200],
                spawns: 'soldier', period: [8, 6.4, 5.0],
                blurb: 'Musters Soldiers who march the black road' },
    spire:    { name: 'Sorcery Spire', icon: '🜏', cost: 240, up: [180, 300],
                spawns: 'sorcerer', period: [11, 8.8, 7.0],
                blurb: 'Sends Sorcerers — fragile, deadly at range' },
    tower:    { name: 'Watchtower',    icon: '🏹', cost: 130, up: [100, 180],
                dmg: [10, 15, 20], range: [250, 275, 300], atk: 1.1, fork: 2,
                blurb: 'Rains arrows on foes nearing your castle. At level 2 the tower is REBUILT — ballista or cannon, and there is no going back' },
    shrine:   { name: 'Pattern Shrine', icon: '✴', cost: 340, up: [250, 400], unique: true,
                drain: [12, 14, 16], rate: [0.28, 0.37, 0.48],  // essence/sec → %/sec (L1 walk ≈ 6 min)
                blurb: 'Channel Essence to walk the Pattern. 100% claims the throne. Walking is REVEALED.' }
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
    soldier:  { hp: 70,  dmg: 9,  atk: 0.9, range: 18,  speed: 39, aggro: 140, bounty: 6,  size: 10, cost: 16 },
    sorcerer: { hp: 40,  dmg: 15, atk: 1.4, range: 130, speed: 35, aggro: 170, bounty: 10, size: 9,  cost: 28 },
    champion: { hp: 420, dmg: 34, atk: 0.8, range: 22,  speed: 44, aggro: 160, bounty: 40, size: 14, cost: 0 },
    fiend:    { hp: 55,  dmg: 11, atk: 1.0, range: 16,  speed: 46, aggro: 260, bounty: 12, size: 10, cost: 0 }
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

  CONST.MAX_LEVEL = 3;
  CONST.EVENT_CAP = 160;   // renderer-queue safety cap

  global.CONST = CONST;
  if (typeof module !== 'undefined' && module.exports) module.exports = CONST;
})(typeof window !== 'undefined' ? window : globalThis);

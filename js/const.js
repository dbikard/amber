/* const.js — content definition tables. Headless-safe. Balance lives here; sim.js is the referee. */
(function (global) {
  'use strict';

  const CONST = {};

  CONST.SIM_DT = 1 / 30;          // fixed timestep (browser + sim identical)
  CONST.LANE = 1000;              // lane coordinate: p0 castle at 0, p1 castle at 1000
  CONST.SLOTS = 9;                // 3x3 city grid per player
  CONST.CASTLE_HP = 1000;
  CONST.START_ESSENCE = 180;
  CONST.BASE_INCOME = 3;          // essence/sec before any Shadow Gate
  CONST.CASTLE_ZONE = 30;         // units closer than this to a castle attack it

  /* Buildings. up = upgrade costs to L2/L3; per-level effect arrays are [L1,L2,L3]. */
  CONST.BUILDINGS = {
    gate:     { name: 'Shadow Gate',   icon: '🌀', cost: 100, up: [90, 160],
                income: [4, 6.5, 10],
                blurb: '+Essence per second, drawn from Shadow' },
    barracks: { name: 'Barracks',      icon: '⚔', cost: 150, up: [120, 200],
                spawns: 'soldier', period: [8, 6.4, 5.0],
                blurb: 'Musters Soldiers who march the black road' },
    spire:    { name: 'Sorcery Spire', icon: '🜏', cost: 240, up: [180, 300],
                spawns: 'sorcerer', period: [11, 8.8, 7.0],
                blurb: 'Sends Sorcerers — fragile, deadly at range' },
    tower:    { name: 'Watchtower',    icon: '🏹', cost: 130, up: [100, 180],
                dmg: [10, 15, 20], range: [250, 275, 300], atk: 1.1,
                blurb: 'Rains arrows on foes nearing your castle' },
    shrine:   { name: 'Pattern Shrine', icon: '✴', cost: 340, up: [250, 400], unique: true,
                drain: [12, 14, 16], rate: [0.28, 0.37, 0.48],  // essence/sec → %/sec (L1 walk ≈ 6 min)
                blurb: 'Channel Essence to walk the Pattern. 100% claims the throne. Walking is REVEALED.' }
  };
  CONST.BUILD_ORDER_UI = ['gate', 'barracks', 'tower', 'spire', 'shrine'];

  /* Units. speed in p-units/sec; aggro = acquire radius; bounty paid to the killer's player. */
  CONST.UNITS = {
    soldier:  { hp: 70,  dmg: 9,  atk: 0.9, range: 18,  speed: 34, aggro: 140, bounty: 6,  size: 10 },
    sorcerer: { hp: 40,  dmg: 15, atk: 1.4, range: 130, speed: 30, aggro: 170, bounty: 10, size: 9 },
    champion: { hp: 420, dmg: 34, atk: 0.8, range: 22,  speed: 38, aggro: 160, bounty: 40, size: 14 },
    fiend:    { hp: 55,  dmg: 11, atk: 1.0, range: 16,  speed: 40, aggro: 260, bounty: 12, size: 10 }
  };

  CONST.POWERS = {
    storm: { name: 'Jewel of Judgment', icon: '⛈', cd: 50, radius: 85, dps: 36, dur: 2.5, delay: 1.0,
             blurb: 'Call the storm upon a point of the road' },
    trump: { name: 'Trump of Benedict', icon: '🃏', cd: 100,
             blurb: 'Summon the family champion at your gate (one at a time)' }
  };

  /* Chaos director: rifts along the road spawn fiends at both sides; escalates to force convergence. */
  CONST.CHAOS = {
    firstAt: 75,                       // s before the first rift
    interval: (t) => Math.max(16, 42 - t * 0.037),  // s between rifts
    count: (t) => 2 + Math.floor(t / 150) + (t > 600 ? 2 : 0),  // fiends per rift (surge after 10 min)
    hpScale: (t) => 1 + t / 280,
    dmgScale: (t) => 1 + t / 500,
    span: [370, 630]                   // rift p range
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

/* rng.js — seeded RNG (mulberry32). Headless-safe.
 * Determinism is for reproducible sim runs and replays; netcode does not rely on it. */
(function (global) {
  'use strict';

  function make(seed) {
    let a = seed >>> 0;
    const next = function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      next,
      range: (lo, hi) => lo + next() * (hi - lo),
      int: (lo, hi) => Math.floor(lo + next() * (hi - lo + 1)), // inclusive
      pick: (arr) => arr[Math.floor(next() * arr.length)],
      chance: (p) => next() < p
    };
  }

  global.RNG = { make };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.RNG;
})(typeof window !== 'undefined' ? window : globalThis);

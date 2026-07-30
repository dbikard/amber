/* ai.js — the rival heirs. Headless-safe. One system, three jobs: single-player opponent,
 * sim.js balance harness, (later) LAN seat-filler.
 * FAIR PLAY: bots read only AI.view() — own state + public road info + revealed Pattern
 * walks. Same prices, same cooldowns, same fog as a human. Difficulty = policy + reaction
 * speed + noise, never cheats. */
(function (global) {
  'use strict';

  const C = global.CONST || (typeof require !== 'undefined' ? require('./const.js') : null);

  /* what a player can legitimately know */
  function view(world, me) {
    const pl = world.players[me], en = world.players[1 - me];
    const myCastleP = me === 0 ? 0 : C.LANE;
    const have = {};
    let free = 0;
    for (const s of pl.slots) { if (s) have[s.bt] = (have[s.bt] || 0) + 1; else free++; }
    const threats = [];
    let push = 0, enemyArmy = 0;
    for (const u of world.units) {
      if (u.owner !== me && Math.abs(u.p - myCastleP) < 340) threats.push(u);
      if (u.owner === me && Math.abs(u.p - myCastleP) > C.LANE / 2) push++;
      if (u.owner === 1 - me) enemyArmy++;   // public: everything on the road is seen
    }
    return {
      t: world.t, me, pl, have, free,
      essence: pl.essence, myCastle: pl.castleHp, enemyCastle: en.castleHp,
      threats, push, enemyArmy, units: world.units,
      myPattern: pl.pattern, walking: pl.walking,
      enemyWalking: en.revealed && en.walking, enemyPattern: en.revealed ? en.pattern : 0,
      powers: pl.powers, myCastleP, enemyCastleP: C.LANE - myCastleP
    };
  }

  /* densest cluster of `units` for a storm: best p, or null if fewer than min in radius */
  function clusterP(units, min) {
    const R = C.POWERS.storm.radius;
    let bestP = null, bestN = min - 1;
    for (const u of units) {
      let n = 0;
      for (const v of units) if (Math.abs(v.p - u.p) < R) n++;
      if (n > bestN) { bestN = n; bestP = u.p; }
    }
    return bestP;
  }

  const SLOT_ORDER = [4, 1, 3, 5, 7, 0, 2, 6, 8];   // middle-out, for a lived-in city

  /* ---------------- the heirs ---------------- */
  const HEIRS = {
    julian: {   // the turtle of Arden — towers and patience
      title: 'Julian, Warden of Arden',
      interval: 2.2, noise: 0.30,
      plan: () => ['gate', 'tower', 'gate', 'barracks', 'tower', 'gate', 'barracks', 'tower', 'shrine'],
      upPref: ['tower', 'gate', 'barracks', 'shrine'],
      walk: (v) => v.have.shrine && v.threats.length === 0 && v.essence > 220,
      pauseWalk: (v) => v.threats.length >= 4,
      storm: (v) => clusterP(v.threats, 3),
      trump: (v) => v.threats.length >= 4 || v.myCastle < 500
    },
    bleys: {    // red-haired aggression — pressure from the first minute
      title: 'Bleys of the Flame',
      interval: 1.8, noise: 0.20,
      plan: () => ['gate', 'barracks', 'barracks', 'gate', 'barracks', 'spire', 'gate', 'spire', 'tower'],
      upPref: ['barracks', 'spire', 'gate', 'tower'],
      walk: () => false,
      pauseWalk: () => false,
      storm: (v) => {
        if (v.push >= 3) {   // storm their defenders while my push lands
          const defenders = v.units.filter((u) => u.owner !== v.me && Math.abs(u.p - v.enemyCastleP) < 320);
          const p = clusterP(defenders, 2); if (p != null) return p;
        }
        return clusterP(v.threats, 4);
      },
      trump: (v) => v.push >= 2 || v.threats.length >= 5
    },
    brand: {    // the mad prince — races the Pattern and dares you to stop him
      title: 'Brand the Unmaker',
      interval: 1.5, noise: 0.12,
      plan: () => ['gate', 'gate', 'gate', 'tower', 'shrine', 'barracks', 'tower', 'spire', 'gate'],
      upPref: ['gate', 'shrine', 'tower', 'barracks'],
      walk: (v) => v.have.shrine && v.essence > 150,
      pauseWalk: () => false,   // Brand commits
      storm: (v) => clusterP(v.threats, 2),
      trump: (v) => v.threats.length >= 3
    },
    corwin: {   // the exile — fights like Bleys, but keeps one eye on the Pattern
      title: 'Corwin of Amber',
      interval: 1.4, noise: 0.10,
      plan: () => ['gate', 'barracks', 'tower', 'gate', 'barracks', 'spire', 'gate', 'shrine', 'barracks'],
      upPref: ['barracks', 'gate', 'spire', 'tower', 'shrine'],
      walk: (v) => v.have.shrine && v.essence > 260 &&
                   (v.enemyCastle < v.myCastle || v.threats.length === 0),  // walks from strength
      pauseWalk: (v) => v.threats.length >= 4,
      storm: (v) => {
        if (v.push >= 3) {
          const defenders = v.units.filter((u) => u.owner !== v.me && Math.abs(u.p - v.enemyCastleP) < 320);
          const p = clusterP(defenders, 2); if (p != null) return p;
        }
        return clusterP(v.threats, 3);
      },
      trump: (v) => v.push >= 2 || v.threats.length >= 4
    },
    benedict: { // the master of arms — adapts, counters, wastes nothing
      title: 'Benedict, Master of Arms',
      interval: 1.1, noise: 0.05,
      plan: (v) => {
        const wants = ['gate', 'barracks'];
        wants.push(v.t > 150 ? 'gate' : 'tower');
        wants.push('tower');
        if (v.threats.length >= 3) wants.push('tower');
        wants.push('barracks', 'gate');
        /* a walker fielding an army is a defended turtle — race him; a naked walker gets broken */
        if (v.enemyWalking) wants.push(...(v.enemyArmy >= 2 ? ['shrine', 'barracks', 'spire']
                                                            : ['barracks', 'spire', 'barracks']));
        else { if (v.t > 200) wants.push('spire'); if (v.t > 210 && v.threats.length <= 1) wants.push('shrine'); }
        return wants.slice(0, C.SLOTS);
      },
      upPref: ['gate', 'shrine', 'barracks', 'tower', 'spire'],   // shrine upgrades win races
      walk: (v) => v.have.shrine && v.essence > 200 &&
                   (v.threats.length <= 1 || (v.enemyWalking && v.enemyPattern > v.myPattern)),
      pauseWalk: (v) => v.threats.length >= 3,
      storm: (v) => {
        if (v.enemyWalking && v.push >= 2) {
          const defenders = v.units.filter((u) => u.owner !== v.me && Math.abs(u.p - v.enemyCastleP) < 320);
          const p = clusterP(defenders, 2); if (p != null) return p;
        }
        return clusterP(v.threats, 3);
      },
      trump: (v) => v.threats.length >= 3 || v.enemyWalking || v.push >= 3
    }
  };

  /* ---------------- baseline bots (skill-gradient proof) ---------------- */
  const BASELINES = {
    random: {
      title: 'A Shadow-ghost', interval: 2.0, noise: 0,
      custom: (v, issue, rng) => {
        const r = rng.next();
        if (r < 0.4) {
          const types = Object.keys(C.BUILDINGS);
          issue({ c: 'build', slot: Math.floor(rng.next() * C.SLOTS), bt: types[Math.floor(rng.next() * types.length)] });
        } else if (r < 0.5) {
          issue({ c: 'power', k: rng.next() < 0.5 ? 'storm' : 'trump', p: rng.next() * C.LANE });
        } else if (r < 0.55) issue({ c: 'walk', on: rng.next() < 0.5 });
      }
    },
    greedy: {   // pure eco-then-spam; never defends, never walks
      title: 'A grasping shadow-lord', interval: 1.6, noise: 0,
      plan: () => ['gate', 'gate', 'gate', 'gate', 'barracks', 'barracks', 'barracks', 'barracks', 'barracks'],
      upPref: ['gate', 'barracks'],
      walk: () => false, pauseWalk: () => false,
      storm: () => null, trump: () => false
    }
  };

  function make(kind, opts) {
    opts = opts || {};
    const P = HEIRS[kind] || BASELINES[kind];
    if (!P) throw new Error('unknown bot: ' + kind);
    const interval = (P.interval || 1.5) * (opts.slow || 1);
    const noise = opts.noise != null ? opts.noise : (P.noise || 0);
    let timer = interval * 0.5, rng = null;

    function decide(world, me, issue) {
      const v = view(world, me);
      if (P.custom) { P.custom(v, issue, rng); return; }
      if (noise > 0 && rng.chance(noise)) return;   // hesitation — the difficulty dial

      /* powers */
      if (v.powers.storm <= 0) { const p = P.storm(v); if (p != null) issue({ c: 'power', k: 'storm', p }); }
      if (v.powers.trump <= 0 && P.trump(v)) issue({ c: 'power', k: 'trump' });

      /* the walk */
      if (!v.walking && P.walk(v)) issue({ c: 'walk', on: true });
      else if (v.walking && P.pauseWalk(v)) issue({ c: 'walk', on: false });

      /* build: first unmet want in the plan */
      const wants = P.plan(v);
      const seen = {};
      for (const bt of wants) {
        seen[bt] = (seen[bt] || 0) + 1;
        if ((v.have[bt] || 0) < seen[bt]) {
          if (v.free > 0 && v.essence >= C.BUILDINGS[bt].cost) {
            const slot = SLOT_ORDER.find((s2) => !v.pl.slots[s2]);
            issue({ c: 'build', slot, bt });
          }
          return;   // want exists but can't afford yet: save up (don't upgrade past it)
        }
      }
      /* plan satisfied → upgrade by preference, keeping a small war chest */
      for (const bt of P.upPref) {
        for (let s = 0; s < C.SLOTS; s++) {
          const b = v.pl.slots[s];
          if (b && b.bt === bt && b.level < C.MAX_LEVEL &&
              v.essence > global.World.upgradeCost(bt, b.level) + 120) {
            issue({ c: 'up', slot: s });
            return;
          }
        }
      }
    }

    return {
      kind, title: P.title,
      reset() { timer = interval * 0.5; },
      step(world, me, issue, dt) {
        if (!rng) rng = global.RNG.make((world.seed ^ (me * 0x9E37)) >>> 0);
        timer -= dt;
        if (timer <= 0) { timer += interval; decide(world, me, issue); }
      }
    };
  }

  global.AI = { make, view, HEIRS, BASELINES };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.AI;
})(typeof window !== 'undefined' ? window : globalThis);

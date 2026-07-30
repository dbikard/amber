/* ai.js — the rival heirs (v0.2: map play — expansion missions + the war banner).
 * FAIR PLAY: bots read only AI.view(), which applies the same fog a human gets: own state,
 * visible units, explored sites. Difficulty = policy + reaction speed + noise, never cheats. */
(function (global) {
  'use strict';

  const C = global.CONST || (typeof require !== 'undefined' ? require('./const.js') : null);
  const d2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };

  /* what a player can legitimately know */
  function view(world, me) {
    const World = global.World;
    const pl = world.players[me], en = world.players[1 - me];
    const myCity = World.cityOf(world, me), enCity = World.cityOf(world, 1 - me);
    const have = {};
    let free = 0;
    for (const s of pl.slots) { if (s) have[s.bt] = (have[s.bt] || 0) + 1; else free++; }

    const myUnits = [], visHostiles = [], threats = [];
    let push = 0;
    for (const u of world.units) {
      if (u.owner === me) {
        myUnits.push(u);
        if (d2(u.x, u.y, enCity.x, enCity.y) < 700 * 700) push++;
      } else if (World.canSee(world, me, u.x, u.y)) {
        visHostiles.push(u);
        if (d2(u.x, u.y, myCity.x, myCity.y) < 600 * 600) threats.push(u);
      }
    }
    /* site knowledge: live truth where owned/visible, memory elsewhere */
    const springs = { own: [], mid: [], enemy: [] };
    for (const s of world.map.sites) {
      if (s.kind !== 'spring') continue;
      const dMe = d2(s.x, s.y, myCity.x, myCity.y), dEn = d2(s.x, s.y, enCity.x, enCity.y);
      const bucket = Math.abs(Math.sqrt(dMe) - Math.sqrt(dEn)) < 260 ? 'mid' : (dMe < dEn ? 'own' : 'enemy');
      springs[bucket].push(s);
    }
    const enemyArmy = visHostiles.filter((u) => u.owner === 1 - me).length;
    return {
      t: world.t, me, pl, world, have, free,
      essence: pl.essence, myCastle: pl.castleHp, enemyCastle: en.castleHp,
      myCity, enCity, myUnits, army: myUnits.length,
      visHostiles, threats, push, enemyArmy,
      springs,
      myPattern: pl.pattern, walking: pl.walking,
      enemyWalking: en.revealed && en.walking, enemyPattern: en.revealed ? en.pattern : 0,
      powers: pl.powers, banner: pl.banner
    };
  }

  /* densest visible cluster for a storm (2D) */
  function clusterAt(units, min) {
    const R2 = C.POWERS.storm.radius * C.POWERS.storm.radius;
    let best = null, bestN = min - 1;
    for (const u of units) {
      let n = 0;
      for (const v of units) if (d2(u.x, u.y, v.x, v.y) < R2) n++;
      if (n > bestN) { bestN = n; best = u; }
    }
    return best ? { x: best.x, y: best.y } : null;
  }
  const stormDefend = (min) => (v) => clusterAt(v.threats, min);
  const stormPush = (defMin) => (v) => {
    if (v.push >= 3) {
      const defenders = v.visHostiles.filter((u) => d2(u.x, u.y, v.enCity.x, v.enCity.y) < 500 * 500);
      const p = clusterAt(defenders, 2);
      if (p) return p;
    }
    return clusterAt(v.threats, defMin);
  };

  /* map helpers: own-side chokes/vantages by distance to my city */
  const nearestOf = (v, sites) => sites.slice().sort((a, b) => d2(a.x, a.y, v.myCity.x, v.myCity.y) - d2(b.x, b.y, v.myCity.x, v.myCity.y));
  const ownChoke = (v) => nearestOf(v, v.world.map.roads.map((id) => v.world.map.sites[id]))[0];
  const ownVantages = (v) => nearestOf(v, v.world.map.sites.filter((s) => s.kind === 'vantage')).slice(0, 2);

  /* expansion mission wants, in priority order. Each: {bt, pick(v) → site|null} */
  const wantSgates = (bucket, n) => ({ bt: 'sgate', pick: (v) => nearestOf(v, v.springs[bucket]).filter((s) => !s.post).slice(0, n)[0] || null });
  const wantWatch = (n) => ({ bt: 'watch', pick: (v) => ownVantages(v).filter((s) => !s.post).slice(0, n)[0] || null });
  const wantRampart = () => ({ bt: 'rampart', pick: (v) => { const s = ownChoke(v); return s && !s.post ? s : null; } });

  const SLOT_ORDER = [4, 1, 3, 5, 7, 0, 2, 6, 8];

  /* ---------------- the heirs ---------------- */
  const HEIRS = {
    julian: {
      title: 'Julian, Warden of Arden',
      interval: 2.2, noise: 0.30,
      plan: () => ['gate', 'tower', 'gate', 'wall', 'barracks', 'tower', 'barracks', 'tower', 'shrine'],
      upPref: ['tower', 'gate', 'wall', 'barracks', 'shrine'],
      missions: (v) => [wantSgates('own', 2), wantWatch(2), wantRampart(), wantSgates('mid', 1)],
      banner: (v) => v.enemyWalking && v.army >= 7 ? v.enCity.id : v.myCity.id,
      walk: (v) => v.have.shrine && v.threats.length === 0 && v.essence > 220,
      pauseWalk: (v) => v.threats.length >= 4,
      storm: stormDefend(3),
      trump: (v) => v.threats.length >= 4 || v.myCastle < 500
    },
    bleys: {
      title: 'Bleys of the Flame',
      interval: 1.8, noise: 0.20,
      plan: () => ['gate', 'barracks', 'barracks', 'gate', 'barracks', 'spire', 'gate', 'spire', 'tower'],
      upPref: ['barracks', 'spire', 'gate', 'tower'],
      missions: (v) => v.t < 200 ? [wantSgates('own', 2)] : [],
      banner: (v) => v.army >= 6 ? v.enCity.id : ownChoke(v).id,   // stage, then storm the gates
      walk: () => false, pauseWalk: () => false,
      storm: stormPush(4),
      trump: (v) => v.push >= 2 || v.threats.length >= 5
    },
    brand: {
      title: 'Brand the Unmaker',
      interval: 1.5, noise: 0.12,
      plan: () => ['gate', 'tower', 'gate', 'wall', 'shrine', 'tower', 'barracks', 'spire', 'gate'],
      upPref: ['wall', 'tower', 'gate', 'shrine', 'barracks'],
      missions: (v) => [wantSgates('own', 2), wantRampart(), wantSgates('mid', 1)],
      banner: (v) => v.myCity.id,   // the army exists to buy him time
      walk: (v) => v.have.shrine && v.essence > 240,
      pauseWalk: () => false,
      storm: stormDefend(2),
      trump: (v) => v.threats.length >= 3
    },
    corwin: {
      title: 'Corwin of Amber',
      interval: 1.4, noise: 0.10,
      plan: () => ['gate', 'barracks', 'tower', 'gate', 'barracks', 'wall', 'spire', 'shrine', 'barracks'],
      upPref: ['barracks', 'gate', 'spire', 'tower', 'shrine'],
      missions: (v) => [wantSgates('own', 2), wantSgates('mid', 2), wantWatch(1)],
      banner: (v) => (v.army - v.enemyArmy >= 5 || v.enemyCastle < v.myCastle)
        ? v.enCity.id
        : (nearestOf(v, v.springs.mid)[0] || ownChoke(v)).id,   // contest the middle, assault from strength
      walk: (v) => v.have.shrine && v.essence > 260 && (v.enemyCastle < v.myCastle || v.threats.length === 0),
      pauseWalk: (v) => v.threats.length >= 4,
      storm: stormPush(3),
      trump: (v) => v.push >= 2 || v.threats.length >= 4
    },
    benedict: {
      title: 'Benedict, Master of Arms',
      interval: 1.1, noise: 0.05,
      plan: (v) => {
        const wants = ['gate', 'barracks'];
        wants.push(v.t > 150 ? 'gate' : 'tower');
        wants.push('tower', 'wall');
        if (v.threats.length >= 3) wants.push('tower');
        wants.push('barracks', 'gate');
        if (v.enemyWalking) wants.push(...(v.enemyArmy >= 2 ? ['shrine', 'barracks', 'spire'] : ['barracks', 'spire', 'barracks']));
        else { if (v.t > 210 && v.threats.length <= 1) wants.push('shrine'); if (v.t > 230) wants.push('spire'); }
        return wants.slice(0, C.SLOTS);
      },
      upPref: ['gate', 'shrine', 'barracks', 'tower', 'wall', 'spire'],
      missions: (v) => [wantSgates('own', 2), wantWatch(1),
                        ...(v.enemyArmy <= 3 ? [wantSgates('mid', 1)] : []),
                        ...(v.threats.length >= 2 ? [wantRampart()] : [])],
      banner: (v) => {
        if (v.enemyWalking && (v.enemyArmy < 2 || v.army >= 6)) return v.enCity.id;
        if (v.army >= 6) return v.enCity.id;
        return ownChoke(v).id;
      },
      walk: (v) => v.have.shrine && v.essence > 200 &&
                   (v.threats.length <= 1 || (v.enemyWalking && v.enemyPattern > v.myPattern)),
      pauseWalk: (v) => v.threats.length >= 3,
      storm: stormPush(3),
      trump: (v) => v.threats.length >= 3 || v.enemyWalking || v.push >= 3
    }
  };

  /* ---------------- baseline bots (skill-gradient proof) ---------------- */
  const BASELINES = {
    random: {
      title: 'A Shadow-ghost', interval: 2.0, noise: 0,
      custom: (v, issue, rng) => {
        const r = rng.next();
        if (r < 0.35) {
          const types = Object.keys(C.BUILDINGS);
          issue({ c: 'build', slot: Math.floor(rng.next() * C.SLOTS), bt: types[Math.floor(rng.next() * types.length)] });
        } else if (r < 0.45) {
          issue({ c: 'banner', site: Math.floor(rng.next() * v.world.map.sites.length) });
        } else if (r < 0.55) {
          issue({ c: 'power', k: rng.next() < 0.5 ? 'storm' : 'trump', x: rng.next() * C.MAP.W, y: rng.next() * C.MAP.H });
        } else if (r < 0.6) issue({ c: 'walk', on: rng.next() < 0.5 });
      }
    },
    greedy: {
      title: 'A grasping shadow-lord', interval: 1.6, noise: 0,
      plan: () => ['gate', 'gate', 'gate', 'gate', 'barracks', 'barracks', 'barracks', 'barracks', 'barracks'],
      upPref: ['gate', 'barracks'],
      missions: () => [], banner: (v) => v.enCity.id,
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
    let mission = null;   // {site, bt, since} — march there, build, move on

    function decide(world, me, issue) {
      const v = view(world, me);
      if (P.custom) { P.custom(v, issue, rng); return; }
      if (noise > 0 && rng.chance(noise)) return;

      /* powers */
      if (v.powers.storm <= 0) { const p = P.storm(v); if (p) issue({ c: 'power', k: 'storm', x: p.x, y: p.y }); }
      if (v.powers.trump <= 0 && P.trump(v)) issue({ c: 'power', k: 'trump' });

      /* the walk */
      if (!v.walking && P.walk(v)) issue({ c: 'walk', on: true });
      else if (v.walking && P.pauseWalk(v)) issue({ c: 'walk', on: false });

      /* city: first unmet want in the plan (save up for it) */
      let saving = false;
      const wants = P.plan(v), seenW = {};
      for (const bt of wants) {
        seenW[bt] = (seenW[bt] || 0) + 1;
        if ((v.have[bt] || 0) < seenW[bt]) {
          if (v.free > 0 && v.essence >= C.BUILDINGS[bt].cost) {
            const slot = SLOT_ORDER.find((s2) => !v.pl.slots[s2]);
            issue({ c: 'build', slot, bt });
          } else saving = v.free > 0;
          break;
        }
      }

      /* expansion missions: pick one, march the banner there, build on arrival */
      const homeThreat = v.threats.length >= 3;
      if (mission) {
        const s = world.map.sites[mission.site];
        if (!s || s.post || v.t - mission.since > 75) mission = null;   // done, lost, or stale
        else if (v.essence >= C.OUTPOSTS[mission.bt].cost) {
          const r = issue({ c: 'post', site: mission.site, bt: mission.bt });
          if (r && r.ok) mission = null;
        }
      }
      if (!mission && !homeThreat) {
        for (const w of P.missions(v)) {
          const site = w.pick(v);
          if (site) { mission = { site: site.id, bt: w.bt, since: v.t }; break; }
        }
      }

      /* the banner: defend home under threat > mission site > personality call */
      const want = homeThreat ? v.myCity.id : (mission ? mission.site : P.banner(v));
      if (want !== v.banner) issue({ c: 'banner', site: want });

      /* upgrades: city then outposts, keeping a war chest, never past an unmet city want */
      if (saving) return;
      for (const bt of P.upPref) {
        for (let s2 = 0; s2 < C.SLOTS; s2++) {
          const b = v.pl.slots[s2];
          if (b && b.bt === bt && b.level < C.MAX_LEVEL &&
              v.essence > global.World.upgradeCost(bt, b.level) + 130) {
            issue({ c: 'up', slot: s2 });
            return;
          }
        }
      }
      for (const s of world.map.sites) {
        if (s.owner === v.me && s.post && s.post.level < C.MAX_LEVEL &&
            v.essence > global.World.postUpCost(s.post.bt, s.post.level) + 160) {
          issue({ c: 'postup', site: s.id });
          return;
        }
      }
    }

    return {
      kind, title: P.title,
      reset() { timer = interval * 0.5; mission = null; },
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

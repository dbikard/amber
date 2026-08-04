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
    const pl = world.players[me];
    const myCity = World.cityOf(world, me);
    /* THE RIVAL'S SEAT IS NOT KNOWN until somebody has laid eyes on it. Everything that used
     * to orient off enCity — where to face the towers, where to send the banner, where to
     * storm — has to cope with not knowing, and go looking instead. */
    /* With more than two heirs there is no "the other one". THE rival is whichever living
     * heir this one should be worrying about: the one it has FOUND and whose Seat is nearest,
     * else the nearest it has not found — so an heir still orients on somebody, and a
     * four-way does not crash on `players[1 - me]`. */
    const others = world.players.map((q, pi) => pi).filter((pi) => pi !== me && !world.players[pi].out);
    const byNear = others.slice().sort((a, b) =>
      d2(World.cityOf(world, a).x, World.cityOf(world, a).y, myCity.x, myCity.y) -
      d2(World.cityOf(world, b).x, World.cityOf(world, b).y, myCity.x, myCity.y));
    const foundIdx = byNear.find((pi) => pl.explored[world.map.cities[pi]]);
    const enIdx = foundIdx != null ? foundIdx : (byNear[0] != null ? byNear[0] : me);
    const en = world.players[enIdx];
    const enCityId = world.map.cities[enIdx];
    const enCity = pl.explored[enCityId] ? World.cityOf(world, enIdx) : null;
    const have = {};
    for (const b of pl.buildings) have[b.bt] = (have[b.bt] || 0) + 1;
    /* no ceiling on works any more — what is rationed is the MASONS, and the crews are hired
     * out of the Gates you hold. `free` is how many are idle. */
    const raising = pl.buildings.find((b) => b.raise > 0) || null;
    const free = Math.max(0, global.World.masons(world, me) - global.World.rising(world, me));

    const myUnits = [], visHostiles = [], threats = [];
    let push = 0;
    for (const u of world.units) {
      if (u.owner === me) {
        myUnits.push(u);
        if (enCity && d2(u.x, u.y, enCity.x, enCity.y) < 700 * 700) push++;
      } else if (World.canSee(world, me, u.x, u.y)) {
        visHostiles.push(u);
        if (d2(u.x, u.y, myCity.x, myCity.y) < 600 * 600) threats.push(u);
      }
    }
    /* Springs, bucketed by how far out they are from MY Seat — the old near/contested/far
     * split needed both Seats' positions, and one of them is a secret now. */
    const allNodes = world.map.sites.filter((s) => s.kind === 'node')
      .sort((a, b) => d2(a.x, a.y, myCity.x, myCity.y) - d2(b.x, b.y, myCity.x, myCity.y));
    const nodes = { own: allNodes.slice(0, 3), mid: allNodes.slice(3, 7), enemy: allNodes.slice(7) };
    /* the nearest place we have never laid eyes on: where a scout should go */
    let frontier = null, fbd = Infinity;
    for (const s of world.map.sites) {
      if (pl.explored[s.id] || s.id === world.map.cities[me]) continue;
      const dd = d2(s.x, s.y, myCity.x, myCity.y);
      if (dd < fbd) { fbd = dd; frontier = s; }
    }
    const enemyArmy = visHostiles.filter((u) => u.owner !== me && u.owner !== C.CHAOS_ID).length;
    const mySprings = pl.buildings.filter((b) => b.node >= 0).length;
    return {
      t: world.t, me, pl, world, have, free, raising,
      essence: pl.essence, myCastle: pl.castleHp, enemyCastle: en.castleHp,
      myCity, enCity, myUnits, army: myUnits.length,
      visHostiles, threats, push, enemyArmy, mySprings,
      enCityId, frontier, unexplored: world.map.sites.filter((s) => !pl.explored[s.id]).length,
      nodes,
      myPattern: pl.pattern, walking: pl.walking,
      enemyWalking: en.revealed && en.walking, enemyPattern: en.revealed ? en.pattern : 0,
      powers: pl.powers, banner: pl.banner ? pl.banner.site : -1
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
    if (v.push >= 3 && v.enCity) {
      const defenders = v.visHostiles.filter((u) => d2(u.x, u.y, v.enCity.x, v.enCity.y) < 500 * 500);   // guarded by v.enCity above
      const p = clusterAt(defenders, 2);
      if (p) return p;
    }
    return clusterAt(v.threats, defMin);
  };

  /* map helpers: own-side chokes/vantages by distance to my city */
  const nearestOf = (v, sites) => sites.slice().sort((a, b) => d2(a.x, a.y, v.myCity.x, v.myCity.y) - d2(b.x, b.y, v.myCity.x, v.myCity.y));
  /* a forward place worth standing on: the nearest site that is not my own Seat. With no
   * road network left there are no named chokes — the land makes its own. */
  const ownChoke = (v) => nearestOf(v, v.world.map.sites.filter((s) => s.kind !== 'city'))[0] || v.myCity;
  const ownVantages = (v) => nearestOf(v, v.world.map.sites.filter((s) => s.kind === 'vantage')).slice(0, 2);

  const held = (v, site) => global.World.nodeHolder(v.world, site) !== -1;
  const worksNear = (v, x, y, bt, r) =>
    v.pl.buildings.some((b) => b.bt === bt && d2(b.x, b.y, x, y) < r * r);

  /* expansion mission wants, in priority order. Each: {bt, pick(v) → site|null} */
  const wantGates = (bucket, n) => ({ bt: 'gate', pick: (v) => nearestOf(v, v.nodes[bucket]).filter((s) => !held(v, s)).slice(0, n)[0] || null });
  const wantWatch = (n) => ({ bt: 'tower', pick: (v) => ownVantages(v).filter((s) => !worksNear(v, s.x, s.y, 'tower', 120)).slice(0, n)[0] || null });

  /* ---------------- placement doctrine ----------------
   * Free ground means an heir must choose WHERE, not just what. The doctrine is the old
   * ring doctrine made continuous: soldiery and towers face the road the enemy will come
   * down, the economy and the shrine shelter on the far side of the Seat. Candidates are
   * swept outward in widening arcs and the first legal one is taken. */
  function sweep(v, bt, cx, cy, base, r0, step, rings) {
    const W = global.World;
    for (let ring = 0; ring < rings; ring++) {
      const r = r0 + ring * step;
      for (let k = 0; k < 13; k++) {
        const a = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.40;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (!W.placementError(v.world, v.me, x, y, bt)) return { x, y };
      }
    }
    return null;
  }
  /* A CURTAIN IS A CHORD, not a spot. An heir walls the side it expects trouble from: a run
   * laid across the approach at arm's length from the Seat, swept outward and swung either
   * way until the ground and the writ will take one. Returns the two ends. */
  function spanFor(v, bt) {
    const W = global.World, c = v.myCity;
    const face = v.enCity || v.frontier || { x: C.MAP.W / 2, y: C.MAP.H / 2 };
    const toFoe = Math.atan2(face.y - c.y, face.x - c.x);
    const def = C.BUILDINGS[bt];
    /* as long a run as the idle crews will cover, and no longer — the mason budget is the
     * only ceiling there is now */
    const reach = W.wallReach(v.world, v.me);
    if (reach < def.span[0]) return null;
    const half = Math.min(reach, C.WALL.unit * 2) / 2;
    for (let ring = 0; ring < 4; ring++) {
      const r = 120 + ring * 34;
      for (let k = 0; k < 9; k++) {
        const a = toFoe + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.42;
        const mx = c.x + Math.cos(a) * r, my = c.y + Math.sin(a) * r;
        /* perpendicular to the approach: the wall stands ACROSS the road, not along it */
        const px = -Math.sin(a), py = Math.cos(a);
        for (const L of [half, half * 0.7, half * 0.5]) {
          const ax = mx - px * L, ay = my - py * L, bx = mx + px * L, by = my + py * L;
          if (!W.wallError(v.world, v.me, ax, ay, bx, by)) return { x: ax, y: ay, x2: bx, y2: by };
        }
      }
    }
    return null;
  }
  function spotFor(v, bt) {
    const c = v.myCity;
    if (C.BUILDINGS[bt].span) return spanFor(v, bt);
    /* the front is wherever trouble is expected: the found Seat, else the nearest unknown
     * ground, else the middle of the world */
    const face = v.enCity || v.frontier || { x: C.MAP.W / 2, y: C.MAP.H / 2 };
    const toFoe = Math.atan2(face.y - c.y, face.x - c.x);
    /* a Gate stands on a spring or nowhere — there is no waystone to settle for any more */
    if (bt === 'gate') {
      const free = nearestOf(v, v.nodes.own.concat(v.nodes.mid)).filter((s) => !held(v, s));
      for (const site of free) {
        const at = spotAt(v, site, 'gate');
        if (at) return at;
      }
      return null;
    }
    /* Works cluster. The old ring put every plot at r=104 and that tight knot is what made
     * a defence a defence — spread over 380 of ground, towers are eaten one at a time. */
    /* the Works are a yard, not a fighting position: put them behind the Seat with the rest
     * of the economy and let the Engines make the walk out */
    const rear = bt === 'gate' || bt === 'shrine' || bt === 'spire' || bt === 'siege';
    return sweep(v, bt, c.x, c.y, rear ? toFoe + Math.PI : toFoe, 86, 30, 5);
  }
  /* a work raised out on the map, at the site the mission marched to */
  function spotAt(v, site, bt) {
    const W = global.World;
    if (!W.placementError(v.world, v.me, site.x, site.y, bt)) return { x: site.x, y: site.y };
    return sweep(v, bt, site.x, site.y, Math.atan2(v.myCity.y - site.y, v.myCity.x - site.x), 46, 34, 3);
  }

  /* Where to march when you do not know where the enemy IS. Scout the nearest unseen place;
   * failing that, hold the nearest ground worth holding. */
  const seek = (v) => (v.frontier ? v.frontier.id : ownChoke(v).id);
  /* the assault, but only against a Seat that has been found */
  const strike = (v) => (v.enCity ? v.enCityId : seek(v));

  /* ---------------- the heirs ---------------- */
  const HEIRS = {
    julian: {
      title: 'Julian, Warden of Arden',
      interval: 2.2, noise: 0.30,
      /* The Warden walks only at the LAST. He was quietly out-walking Brand — a turtle that
       * reaches for the Pattern early is just a slower greed, and it collapsed the triangle:
       * every heir was winning the same way. Towers first, patience, the Pattern only after
       * the grind has failed to finish it. */
      /* THE WARDEN WALLS WHEN HE IS PRESSED, not on a schedule. Stone on a timer was measured
       * and it does not pay: masons are 1 + gates/3, so an early curtain occupies the only
       * crew he has and delays his second Gate — he spends 110 essence and a tempo of economy
       * against opponents who win by WALKING, which no wall touches. Scheduled at slot 3 he
       * fell 47%→27% against Brand; moved later he was still 40%, against 47% with no wall at
       * all. Gated on pressure, the stone only goes up when there is something for it to stop. */
      plan: (v) => {
        const wants = ['gate', 'tower', 'gate', 'barracks', 'tower'];
        if (v.threats.length >= 2 || v.enemyArmy >= 3) wants.push('wall');
        wants.push('barracks', 'tower', 'shrine');
        if (v.threats.length >= 3) wants.push('wall');
        wants.push('tower', 'barracks', 'siege', 'tower', 'gate');
        return wants;
      },
      upPref: ['tower', 'gate', 'barracks', 'siege'],
      towerBranch: () => 'cannon',   // the Warden holds a line; lines are broken by crowds
      missions: (v) => [wantGates('own', 2), wantGates('mid', 2), wantWatch(2)],
      /* a revealed walk MUST be answered — pillar 3 — and late, the hammer falls anyway */
      banner: (v) => (v.enemyWalking && v.army >= 5) || v.army >= 9 ? strike(v) : (v.unexplored > 2 && v.army >= 4 ? seek(v) : v.myCity.id),
      /* the LAST resort, and it has to be genuinely last: at eight minutes he was simply
       * out-walking Brand, which is greed's whole job. Matches run 14-20m now. */
      walk: (v) => v.have.shrine && v.t > 900 && v.threats.length <= 2 && v.essence > 240,
      pauseWalk: (v) => v.myPattern < 70 && v.threats.length >= 4,
      storm: stormDefend(3),
      trump: (v) => v.threats.length >= 4 || v.myCastle < 500
    },
    bleys: {
      title: 'Bleys of the Flame',
      interval: 1.8, noise: 0.20,
      plan: () => ['gate', 'barracks', 'barracks', 'gate', 'barracks', 'spire', 'gate', 'siege',
                   'spire', 'barracks', 'siege', 'spire', 'barracks', 'tower'],
      upPref: ['barracks', 'siege', 'spire', 'gate', 'tower'],
      towerBranch: () => 'bolt',     // Bleys keeps few towers; they must hit hard and far
      missions: (v) => [wantGates('own', 2), wantGates('mid', 1)],   // one forward spring, not the middle
      banner: (v) => v.army >= 6 ? strike(v) : seek(v),   // scout, stage, then storm the gates
      walk: () => false, pauseWalk: () => false,
      storm: stormPush(4),
      trump: (v) => v.push >= 2 || v.threats.length >= 5
    },
    brand: {
      title: 'Brand the Unmaker',
      interval: 1.5, noise: 0.12,
      /* GREED, not a shrine rush. Brand used to raise the Shrine fourth and start walking at
       * three minutes on two springs, drain 17 against income 12 — permanently broke, so his
       * economy never grew and he lost the race he had started. Mine first, then walk. */
      plan: () => ['gate', 'gate', 'tower', 'gate', 'shrine', 'tower', 'barracks', 'spire',
                   'tower', 'barracks', 'spire', 'tower'],
      upPref: ['tower', 'gate', 'barracks'],
      towerBranch: () => 'cannon',   // the walk is answered by an army, and an army is a crowd
      /* Greed must still MINE. Keeping Brand's army home to guard the walk was tried and
       * measured: it starves him (2 wins across the field) because the walk's drain has to
       * come from somewhere, and under the new economy that somewhere is the springs. */
      missions: (v) => [wantGates('own', 2), wantGates('mid', 2)],
      banner: (v) => (v.unexplored > 3 && v.army >= 5 ? seek(v) : v.myCity.id),   // the army buys him time, but must still find the springs
      walk: (v) => v.have.shrine && v.mySprings >= 3 && v.essence > 360,
      pauseWalk: () => false,
      storm: stormDefend(2),
      trump: (v) => v.threats.length >= 3
    },
    corwin: {
      title: 'Corwin of Amber',
      interval: 1.4, noise: 0.10,
      plan: () => ['gate', 'barracks', 'tower', 'gate', 'barracks', 'spire', 'shrine', 'barracks',
                   'siege', 'tower', 'barracks', 'spire', 'gate'],
      upPref: ['barracks', 'gate', 'siege', 'spire', 'tower'],
      towerBranch: () => 'bolt',
      missions: (v) => [wantGates('own', 2), wantGates('mid', 2), wantWatch(1)],
      banner: (v) => (v.enCity && (v.army - v.enemyArmy >= 5 || v.enemyCastle < v.myCastle))
        ? v.enCityId
        : (v.unexplored > 2 ? seek(v) : (nearestOf(v, v.nodes.mid)[0] || ownChoke(v)).id),
      walk: (v) => v.have.shrine && v.essence > 260 && (v.enemyCastle < v.myCastle || v.threats.length === 0),
      pauseWalk: (v) => v.myPattern < 70 && v.threats.length >= 4,
      storm: stormPush(3),
      trump: (v) => v.push >= 2 || v.threats.length >= 4
    },
    benedict: {
      title: 'Benedict, Master of Arms',
      interval: 1.1, noise: 0.05,
      plan: (v) => {
        const wants = ['gate', 'barracks'];
        wants.push(v.t > 150 ? 'gate' : 'tower');
        wants.push('tower');
        if (v.threats.length >= 3) wants.push('tower');
        wants.push('barracks', 'gate');
        /* the Master of Arms walls when he is being pressed, and not before — stone that is
         * not being tested is essence that should have been men */
        if (v.threats.length >= 2 || v.enemyArmy >= 4) wants.push('wall');
        if (v.enemyWalking) wants.push(...(v.enemyArmy >= 2 ? ['shrine', 'barracks', 'spire'] : ['barracks', 'spire', 'barracks']));
        else { if (v.t > 210 && v.threats.length <= 1) wants.push('shrine'); if (v.t > 230) wants.push('spire'); }
        /* a Seat is 2500 hit points behind towers, and men are a poor tool for stone. Once
         * the Master of Arms has a realm to pay for it he raises a train and means it. */
        if (v.t > 300 && v.army >= 8) wants.push('siege');
        if (v.t > 540) wants.push('siege');
        return wants;
      },
      upPref: ['gate', 'barracks', 'siege', 'tower', 'spire'],
      towerBranch: (v) => (v.enemyArmy >= 4 ? 'cannon' : 'bolt'),   // the master answers what he sees
      missions: (v) => [wantGates('own', 2), wantWatch(1),
                        ...(v.enemyArmy <= 3 ? [wantGates('mid', 1)] : [])],
      banner: (v) => {
        if (v.enCity && v.enemyWalking && (v.enemyArmy < 2 || v.army >= 6)) return v.enCityId;
        if (v.enCity && v.army >= 6) return v.enCityId;
        return v.unexplored > 2 && v.army >= 4 ? seek(v) : ownChoke(v).id;
      },
      walk: (v) => v.have.shrine && v.essence > 200 &&
                   (v.threats.length <= 1 || (v.enemyWalking && v.enemyPattern > v.myPattern)),
      pauseWalk: (v) => v.myPattern < 70 && v.threats.length >= 3,
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
          /* the random ghost flings works at Shadow and mostly misses legal ground */
          const c2 = v.myCity, a = rng.next() * Math.PI * 2, r = rng.range(80, 420);
          issue({ c: 'build', x: c2.x + Math.cos(a) * r, y: c2.y + Math.sin(a) * r, bt: types[Math.floor(rng.next() * types.length)] });
        } else if (r < 0.45) {
          issue({ c: 'banner', site: Math.floor(rng.next() * v.world.map.sites.length) });
        } else if (r < 0.55) {
          issue({ c: 'power', k: rng.next() < 0.5 ? 'storm' : 'trump', x: rng.next() * C.MAP.W, y: rng.next() * C.MAP.H });
        } else if (r < 0.6) issue({ c: 'walk', on: rng.next() < 0.5 });
      }
    },
    greedy: {
      title: 'A grasping shadow-lord', interval: 1.6, noise: 0,
      plan: () => ['gate', 'gate', 'gate', 'gate', 'barracks', 'barracks', 'barracks', 'barracks'],
      upPref: ['gate', 'barracks'],
      missions: () => [], banner: (v) => strike(v),
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
    const hold = opts.hold || 0;   // s before this heir will march on your Seat at all
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
      /* The hour grows late. The Pattern is the game's absolute clock, and it only ticks if
       * someone actually sets foot on it — two defensive lines with no shrine-walker between
       * them drew 15 of 30 at the cap. Past this hour, any heir holding a Shrine commits. */
      const late = v.t > 1500;
      if (!v.walking && (P.walk(v) || (late && v.have.shrine))) issue({ c: 'walk', on: true });
      else if (v.walking && !late && P.pauseWalk(v)) issue({ c: 'walk', on: false });

      /* city: first unmet want in the plan (save up for it) */
      let saving = false;
      const wants = P.plan(v), seenW = {};
      for (const bt of wants) {
        seenW[bt] = (seenW[bt] || 0) + 1;
        if ((v.have[bt] || 0) < seenW[bt]) {
          if (v.free > 0 && v.essence >= C.BUILDINGS[bt].cost) {
            const at = spotFor(v, bt);
            if (at) issue({ c: 'build', x: at.x, y: at.y, x2: at.x2, y2: at.y2, bt });
          } else saving = v.free > 0;
          break;
        }
      }

      /* expansion missions: pick one, march the banner there, build on arrival */
      const homeThreat = v.threats.length >= 3;
      if (mission) {
        const s = world.map.sites[mission.site];
        const done = !s || (mission.bt === 'gate' ? held(v, s) : worksNear(v, s.x, s.y, mission.bt, 130));
        /* Give the march time to actually GET there. A flat 75s was tuned for the old
         * site-graph board; on the open map the middle springs are a 90s walk, so every
         * mission to one expired before the troops arrived and the heir simply never
         * expanded — measured as Julian sitting on 2 gates at six minutes while Bleys
         * held four. The window now scales with the distance it is asking for. */
        const far = Math.sqrt(d2(v.myCity.x, v.myCity.y, s ? s.x : 0, s ? s.y : 0));
        if (done || v.t - mission.since > 70 + far / 30) mission = null;   // taken, lost, or stale
        else if (v.free > 0 && v.essence >= C.BUILDINGS[mission.bt].cost) {
          const at = spotAt(v, s, mission.bt);
          if (at) { const r = issue({ c: 'build', x: at.x, y: at.y, bt: mission.bt }); if (r && r.ok) mission = null; }
        }
      }
      if (!mission && !homeThreat) {
        for (const w of P.missions(v)) {
          const site = w.pick(v);
          if (site) { mission = { site: site.id, bt: w.bt, since: v.t }; break; }
        }
      }

      /* the banner: defend home under threat > mission site > personality call */
      let want = homeThreat ? v.myCity.id : (mission ? mission.site : P.banner(v));
      /* AN EASIER FOOTING IS ALSO A LATER ONE. Income alone could not do this job: measured
       * against the weakest baseline we ship, an heir at eco 0.8 still had an army on the
       * player's ground at 5.3 minutes, and cutting income further only made it come sooner,
       * because a poorer heir builds less realm and marches earlier. So the assault itself
       * is held: until the named hour the heir expands, garrisons and defends, but does not
       * march on your Seat. It is not weakened in the fight it eventually brings — it just
       * gives you the opening minutes to learn the board. */
      if (hold && v.t < hold && v.enCity && want === v.enCityId) want = v.myCity.id;
      if (want !== v.banner) issue({ c: 'banner', site: want });

      /* upgrades: by doctrine, keeping a war chest, never past an unmet want.
       * Gates drawing on a node come first — that is where the essence actually is. */
      if (saving) return;
      /* AN UPGRADE IS MASONRY NOW: it takes a crew and silences the work while they are on
       * it. So an heir with no crew free must not try (the order is simply refused), and one
       * with a single hall should not shut it down under threat — an upgrade in the middle of
       * an assault is a hall that musters nobody for the length of the fight. */
      if (v.free <= 0) return;
      const pressed = v.threats.length >= 3;
      for (const bt of P.upPref) {
        if (pressed && C.BUILDINGS[bt].spawns &&
            v.pl.buildings.filter((b) => b.bt === bt && !b.raise && !b.work).length < 2) continue;
        const cands = v.pl.buildings.filter((b) => b.bt === bt && b.level < C.MAX_LEVEL && !b.raise && !b.work)
                       .sort((a, b) => (b.node >= 0 ? 1 : 0) - (a.node >= 0 ? 1 : 0));
        for (const b of cands) {
          /* the Watchtower fork: an heir's doctrine picks the branch, and keeps it after */
          const br = bt === 'tower' ? (b.br || (P.towerBranch ? P.towerBranch(v) : 'bolt')) : undefined;
          if (v.essence > global.World.upgradeCost(bt, b.level, br) + 130) {
            issue({ c: 'up', id: b.id, br });
            return;
          }
        }
      }
    }

    return {
      kind, title: P.title,
      reset() { timer = interval * 0.5; mission = null; },
      step(world, me, issue, dt) {
        if (!rng) {
          rng = global.RNG.make((world.seed ^ (me * 0x9E37)) >>> 0);
          /* Independent phase per seat. Two identical heirs used to tick in lockstep, so
           * whichever seat the harness polled first always acted first — and with free
           * placement, acting first means taking the ground. Measured at +7 points to
           * seat 0 in a greedy mirror; a seeded phase removes it without favouring either. */
          timer = interval * rng.next();
        }
        timer -= dt;
        if (timer <= 0) { timer += interval; decide(world, me, issue); }
      }
    };
  }

  global.AI = { make, view, HEIRS, BASELINES };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.AI;
})(typeof window !== 'undefined' ? window : globalThis);

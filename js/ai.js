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
    /* SOMEBODY IS AT THE GATE. `threats` is a wide net — anything hostile within six hundred
     * of the Seat — and three of them is the bar for calling the army home, which is right for
     * a column massing to attack and wrong for the thing that actually kills you: one or two
     * strays already chewing the stone while your whole army is off across the board. Measured
     * the moment the heirs started marching: benedict fell from 87% against `random` to 30%,
     * because random never masses and so never tripped the wide net. This is the narrow one. */
    /* AT THE GATE means at the GATE. Measured from the Seat's own ground plus a little, not
     * from the wide six-hundred net `threats` uses: with the wide one, a single scout
     * loitering anywhere near the court pinned the whole army at home for the rest of the
     * match and the heir never attacked at all. */
    const gateR = C.CASTLE_ZONE + 70;
    const atGate = visHostiles.filter((u) => d2(u.x, u.y, myCity.x, myCity.y) < gateR * gateR).length;
    const mySprings = pl.buildings.filter((b) => b.node >= 0).length;
    return {
      t: world.t, me, pl, world, have, free, raising,
      essence: pl.essence, myCastle: pl.castleHp, enemyCastle: en.castleHp,
      myCity, enCity, myUnits, army: myUnits.length,
      visHostiles, threats, push, enemyArmy, mySprings, atGate,
      /* WHO CAN ACTUALLY BREAK A SEAT. Shooters have no target among works at all, so a host
       * of archers, sorcerers, wardens and binders can march to a rival's gate and stand there
       * for the rest of the match. An heir has to know the difference between an army and an
       * army that can finish, or the referee reads it as "matches stopped ending". */
      breakers: myUnits.filter((u) => !C.UNITS[u.kind].menOnly).length,
      /* CHAOS IS THE WEATHER, NOT THE OPPONENT (DESIGN_PRINCIPLES). `threats` is everything
       * hostile near the Seat and fiends are most of it, so a doctrine that calls off the walk
       * on `threats` calls it off for the weather — and the black road is capped precisely so
       * that it can never take a Seat. What a walker is risking is a RIVAL at the door while
       * his essence goes into the lines, so that is the number the walk is judged on. */
      rivals: threats.filter((u) => u.owner !== C.CHAOS_ID).length,
      enCityId, frontier, unexplored: world.map.sites.filter((s) => !pl.explored[s.id]).length,
      nodes,
      /* what the realm EARNS and what it is already committed to — the two numbers a walk has
       * to be judged against, and neither of them was in the view */
      income: pl.incomeRate || 0, drain: pl.drainRate || 0,
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

  /* NOTHING IS RAISED UNDER SWORDS. A work goes up as a SHELL — a quarter of its hit points,
   * earning nothing, mustering nobody, shooting at nothing until the masons are done — so one
   * begun inside a hostile crowd donates the stone, the crew and the time in one order.
   * Measured on benedict against `greedy`: its home Gate, 204 from the Seat with the rival's
   * column camped on the spring, was thrown down and raised again EIGHT times between minute
   * three and minute twelve. About a thousand essence and eight crew-shifts on a work that
   * never drew a drop, while the halls and men that would have lifted the siege went unbuilt —
   * and the heir sat on income 2.5 for most of a match it lost. The board already refuses a
   * CONTESTED spring beyond the writ; inside the writ nothing refused anything.
   * The radius is generous on purpose — a soldier acquires at 140 — and the sweep simply
   * swings round to the far side of the Seat, so being pressed changes WHERE an heir builds
   * rather than whether he can build at all. */
  const FOE_R = 130;
  const clearOfFoes = (v, x, y) => !v.visHostiles.some((u) => d2(u.x, u.y, x, y) < FOE_R * FOE_R);

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
        if (clearOfFoes(v, x, y) && !W.placementError(v.world, v.me, x, y, bt)) return { x, y };
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
    const W2 = global.World, c = v.myCity;
    if (C.BUILDINGS[bt].span) return spanFor(v, bt);
    /* A TOWER WANTS TO BE IN THE WALL. Stone stops a tower's shot like anything else now, so
     * one raised behind a curtain covers the ground behind the curtain — which is not where
     * the fighting is. An heir with a run standing tries the run first, and only falls back
     * to open ground when there is no room on it. */
    if (bt === 'tower' && v.world.anyWall) {
      for (const wl of v.world.walls) {
        if (wl.owner !== v.me) continue;
        for (const t of [0.22, 0.78, 0.35, 0.65]) {
          const x = wl.ax + (wl.bx - wl.ax) * t, y = wl.ay + (wl.by - wl.ay) * t;
          if (clearOfFoes(v, x, y) && !W2.placementError(v.world, v.me, x, y, 'tower')) return { x, y };
        }
      }
    }
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
  /* a work raised out on the map, at the site the mission marched to.
   * A GATE HAS EXACTLY ONE SPOT AND SWEEPING FOR IT IS A LIE. The build command snaps any
   * `claim` work to the spring's exact centre (CLAUDE.md: "A Gate always lands on the spring's
   * exact centre"), but this probe asked `placementError` about the point it had swept TO —
   * and `placementError` reads the writ at the point it is handed. So a point 46 out from a
   * spring that lay just inside the writ came back legal, the heir issued the order, and the
   * command snapped it back onto the spring outside the writ and refused it as 'presence'.
   * Measured on `greedy`, which wants four Gates: it issued that same doomed order five to
   * eight times a MINUTE for the whole match, and because an order that is issued counts as
   * the plan's business for this tick, the four halls behind the Gates in its own plan were
   * never reached. Probe where the work will actually stand, or do not probe at all. */
  function spotAt(v, site, bt) {
    const W = global.World;
    if (clearOfFoes(v, site.x, site.y) && !W.placementError(v.world, v.me, site.x, site.y, bt))
      return { x: site.x, y: site.y };
    if (C.BUILDINGS[bt].claim) return null;   // the spring's middle or nowhere
    return sweep(v, bt, site.x, site.y, Math.atan2(v.myCity.y - site.y, v.myCity.x - site.x), 46, 34, 3);
  }

  /* Where to march when you do not know where the enemy IS. Scout the nearest unseen place;
   * failing that, hold the nearest ground worth holding. */
  const seek = (v) => (v.frontier ? v.frontier.id : ownChoke(v).id);
  /* THE ASSAULT — against a Seat that has been found, and only with men who can break it.
   * Sending shooters at a Seat is not a weak attack, it is no attack: they will stand in front
   * of the walls with nothing to shoot until somebody comes out. An heir who cannot finish
   * holds his ground instead, and the want below raises him something that can. */
  const BREAKERS = 3;
  const strike = (v) => (v.enCity && v.breakers >= BREAKERS ? v.enCityId : seek(v));
  /* what an assault costs to be worth making: a real army, and more of it than he can see of
   * the other man's. Both are read fresh every time the heir thinks, so the march is a
   * standing decision rather than a one-way door. */
  /* A SEAT IS TWENTY-FIVE HUNDRED HIT POINTS, and the floor was set at fourteen men in an era
   * when this clause could not fire — every doctrine's assault was dead code, so the number
   * was never tested against a real march. It fires now, and fourteen turned out to be the
   * size of a column that can erase a Seat that has not had time to raise a tower: in the
   * four-way smoke, an heir's Seat fell at 2 minutes 40 on two of five maps, from full to
   * rubble in twenty-four seconds, before it had a realm to lose. Twenty-two is the smallest
   * column that is still an army when it arrives at a Seat with something standing round it,
   * and it costs the rusher nothing it was entitled to: `greedy` still takes `random` 40-2.
   * What it stops is winning a match before either side has played one. */
  const COMMIT = +(typeof process !== 'undefined' && process.env && process.env.AMBER_COMMIT) || 22;
  /* how far behind in men an heir must SEE himself before he answers with another hall, and
   * how many halls that answer may ever reach. See "the muster answers the muster" below. */
  const OUTNUMBER = +(typeof process !== 'undefined' && process.env && process.env.AMBER_OUTNUM) || 5;
  const HALL_CAP = +(typeof process !== 'undefined' && process.env && process.env.AMBER_HALLS) || 4;
  /* how much of the realm's earnings may sit past what the halls can drink before another
   * hall is the obvious answer — an allowance for the stone every doctrine also wants */
  const SPARE = +(typeof process !== 'undefined' && process.env && process.env.AMBER_SPARE) || 3;
  /* THE PURSE IS NOT THE TEST ANY MORE. Every doctrine's walk clause carried a cash threshold
   * of its own — 200, 240, 260, 360 — written when an heir with nothing left to buy simply
   * banked what it earned; they were standing in for "can my realm carry this". The shared
   * gate in `decide` answers that properly and by INCOME, and the heirs now spend what they
   * earn on halls and Gates, so a snapshot of the treasury refuses a walk the ground could
   * comfortably pay for. Measured over six skilled matches: of the moments an heir held a
   * Shrine and earned enough to walk, its own purse test refused five in seven, and the
   * Pattern decided 12% of skilled matches against a 25-75 target.
   * What is left is a WAR CHEST, and it is one number instead of four: do not set foot on the
   * Pattern holding less than the shared rule will abandon it for (`broke`, 140). */
  const CHEST = 150;

  /* WHICH WAY AN HEIR FORKS. A persona names its doctrine per building in `branch`; anything it
   * does not name — and the baselines name nothing — falls to the table's own first option, so
   * a branching work added later never lands an heir on `undefined` and gets its upgrade
   * refused for 'branch'. */
  function branchFor(P, bt, v) {
    const d = C.BUILDINGS[bt];
    const pick = P.branch && P.branch[bt] ? P.branch[bt](v) : null;
    return pick && d.branches[pick] ? pick : d.branchUI[0];
  }
  /* is there a work standing at the rung below its fork, and the essence to take it? Only
   * asked to let the fork jump the saving queue — see the note at the upgrade scan. */
  function canFork(v) {
    return v.pl.buildings.some((b) => {
      const d = C.BUILDINGS[b.bt];
      if (!d.branches || b.br || b.raise > 0 || b.work > 0) return false;
      if (b.level + 1 !== (d.fork || 0)) return false;
      return v.essence >= Math.min.apply(null, d.branchUI.map((k) => d.branches[k].cost));
    });
  }

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
      /* the Warden holds a line: crowds break lines, so the cannon; and he is the one heir
       * who raises the stone that archers are worth having — but ONLY once it is standing.
       * Forked to archers unconditionally he became a heir who won every field and could not
       * take a Seat: strongest on the ladder, and unable to end a match. */
      branch: { tower: () => 'cannon',
                barracks: (v) => (v.have.wall || (v.have.tower || 0) >= 2 ? 'archer' : 'line'),
                spire: () => 'warden', siege: () => 'bombard' },
      missions: (v) => [wantGates('own', 2), wantGates('mid', 2), wantWatch(2)],
      /* a revealed walk MUST be answered — pillar 3 — and late, the hammer falls anyway */
      banner: (v) => (v.enemyWalking && v.army >= 5) || v.army >= 9 ? strike(v) : (v.unexplored > 2 && v.army >= 4 ? seek(v) : v.myCity.id),
      /* the LAST resort, and it has to be genuinely last: at eight minutes he was simply
       * out-walking Brand, which is greed's whole job.
       * BUT "LAST" IS AN HOUR OF THE MATCH, NOT A NUMBER. Fifteen minutes was late when the
       * table ran 14-20; the heirs now find each other and fight, the medians are 6-16, and a
       * Warden who first considers the throne at fifteen never considers it at all. Nine
       * minutes is still after everyone else's opening move on it, which is the whole point of
       * the clause. */
      walk: (v) => v.have.shrine && v.t > 540 && v.rivals <= 2 && v.essence > CHEST,
      pauseWalk: (v) => v.myPattern < 70 && v.rivals >= 4,
      storm: stormDefend(3),
      trump: (v) => v.threats.length >= 4 || v.myCastle < 500
    },
    bleys: {
      title: 'Bleys of the Flame',
      interval: 1.8, noise: 0.20,
      plan: () => ['gate', 'barracks', 'barracks', 'gate', 'barracks', 'spire', 'gate', 'siege',
                   'spire', 'barracks', 'siege', 'spire', 'barracks', 'tower'],
      upPref: ['barracks', 'siege', 'spire', 'gate', 'tower'],
      /* Bleys keeps few towers; they must hit hard and far. Everything else is the assault:
       * outriders to arrive, a ram to get in, and Chaos turned on whoever is in the way.
       * THE SHIELDWALL WAS TRIED HERE AND MEASURED WORSE: a thirty-essence man on his tempo
       * cut his host from 76 to 21 and he lost every game of four. Bleys wins by arriving
       * first with more, not by arriving later with better. */
      branch: { tower: () => 'bolt', barracks: () => 'raid', spire: () => 'binder', siege: () => 'ram' },
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
      /* the walk is answered by an army, and an army is a crowd — and a walker must HOLD, so
       * shieldmen on the ground and a warden keeping them standing */
      branch: { tower: () => 'cannon', barracks: () => 'line', spire: () => 'warden', siege: () => 'bombard' },
      /* Greed must still MINE. Keeping Brand's army home to guard the walk was tried and
       * measured: it starves him (2 wins across the field) because the walk's drain has to
       * come from somewhere, and under the new economy that somewhere is the springs. */
      missions: (v) => [wantGates('own', 2), wantGates('mid', 2)],
      banner: (v) => (v.unexplored > 3 && v.army >= 5 ? seek(v) : v.myCity.id),   // the army buys him time, but must still find the springs
      walk: (v) => v.have.shrine && v.mySprings >= 3 && v.essence > CHEST,
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
      branch: { tower: () => 'bolt', barracks: () => 'raid', spire: () => 'binder', siege: () => 'ram' },
      missions: (v) => [wantGates('own', 2), wantGates('mid', 2), wantWatch(1)],
      banner: (v) => (v.enCity && (v.army - v.enemyArmy >= 5 || v.enemyCastle < v.myCastle))
        ? v.enCityId
        : (v.unexplored > 2 ? seek(v) : (nearestOf(v, v.nodes.mid)[0] || ownChoke(v)).id),
      /* "nobody at the door" was `rivals === 0`, and against an heir who now actually marches
       * that is a condition that occurs between engagements and nowhere else. A scout or two
       * in sight of the court is not a reason to give up the throne. */
      walk: (v) => v.have.shrine && v.essence > CHEST && (v.enemyCastle < v.myCastle || v.rivals <= 1),
      pauseWalk: (v) => v.myPattern < 70 && v.rivals >= 4,
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
        /* and the SHRINE is judged on rivals too — a fiend pack wandering past the court is
         * not a reason to give up on the throne */
        else { if (v.t > 210 && v.rivals <= 1) wants.push('shrine'); if (v.t > 230) wants.push('spire'); }
        /* a Seat is 2500 hit points behind towers, and men are a poor tool for stone. Once
         * the Master of Arms has a realm to pay for it he raises a train and means it. */
        if (v.t > 300 && v.army >= 8) wants.push('siege');
        if (v.t > 540) wants.push('siege');
        return wants;
      },
      upPref: ['gate', 'barracks', 'siege', 'tower', 'spire'],
      /* THE MASTER ANSWERS WHAT HE SEES, and that is his whole character — every fork is a
       * read of the board rather than a doctrine he brought with him. */
      branch: {
        tower: (v) => (v.enemyArmy >= 4 ? 'cannon' : 'bolt'),
        /* archers are only worth raising if he has stone to stand them on */
        barracks: (v) => (v.have.wall || v.have.tower >= 2 ? 'archer' : v.enemyArmy >= 6 ? 'line' : 'raid'),
        spire: (v) => (v.threats.length >= 2 ? 'warden' : 'binder'),
        siege: (v) => (v.enemyArmy >= 5 ? 'bombard' : 'ram')
      },
      missions: (v) => [wantGates('own', 2), wantWatch(1),
                        ...(v.enemyArmy <= 3 ? [wantGates('mid', 1)] : [])],
      banner: (v) => {
        if (v.enCity && v.enemyWalking && (v.enemyArmy < 2 || v.army >= 6)) return v.enCityId;
        if (v.enCity && v.army >= 6) return v.enCityId;
        return v.unexplored > 2 && v.army >= 4 ? seek(v) : ownChoke(v).id;
      },
      /* and the same loosening: one rival in sight was the bar, which in a war that is now
       * actually fought is almost never met */
      walk: (v) => v.have.shrine && v.essence > CHEST &&
                   (v.rivals <= 2 || (v.enemyWalking && v.enemyPattern > v.myPattern)),
      pauseWalk: (v) => v.myPattern < 70 && v.rivals >= 3,
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
       * them drew 15 of 30 at the cap. Past this hour, any heir holding a Shrine commits.
       * IT IS A STALL-BREAKER AND NOTHING ELSE, so it stays where it is. Pulled forward to ten
       * minutes to buy the Pattern a larger share of the decisions it measured WORSE: brand
       * against benedict went from 2-1 to three timeouts, because two heirs who both commit at
       * the same hour and both then defend are the stall this clause exists to end. */
      const late = v.t > 1500;
      /* A WALK YOU CANNOT PAY FOR IS A LOSS YOU CHOSE. Every doctrine gates the walk on a
       * SNAPSHOT of the treasury — 'essence > 200' — which says nothing about whether the
       * realm can carry the drain for the nine and a half minutes the walk takes. Reported
       * from play, at PRINCE: Benedict set foot on the Pattern at 4:03 with seven works, ran
       * his treasury to zero and held it there, could not pay his muster, watched his army
       * fall from thirty-nine to three, and spent the next six minutes being dismantled. He
       * reached 21% and then DECAYED back to 16%. He did not lose the race; he lost the game
       * to have entered it.
       * So the shared rule, under every doctrine: start only if the ground earns most of what
       * the Shrine will take, and STOP if the treasury runs dry. Stopping costs the lines
       * their progress, which is exactly the trade — a walk resumed from 16% beats a realm
       * that starved to reach 21%. */
      /* A WALK ALREADY PAID FOR AS ITS OWN REASON TO RESUME — "past 20% the shared rule alone
       * decides" — reads well and MEASURED BADLY: heirs cling to a walk they cannot finish
       * instead of fighting, and the timeouts trebled (julian and brand against benedict went
       * from one draw each to three). The doctrine's own clause stays the door back in. */
      const shrineDrain = C.BUILDINGS.shrine.drain[0];
      const canAfford = v.income >= shrineDrain * 0.85;
      const broke = v.essence < 140;
      if (!v.walking && (P.walk(v) || (late && v.have.shrine)) && (canAfford || late)) {
        issue({ c: 'walk', on: true });
      } else if (v.walking && (broke || (!late && P.pauseWalk(v)))) {
        issue({ c: 'walk', on: false });
      }

      /* THE CITY. Two standing wants that no plan lists come first — a spring under his feet
       * and, when the muster is behind, one more hall — and then the plan itself.
       *
       * THE MUSTER ANSWERS THE MUSTER, AND A FINISHED PLAN IS NOT A FINISHED REALM. A plan is
       * a fixed list, so an heir who reaches its end simply stops growing where it stopped.
       * Benedict's names TWO mustering halls and no more; measured over eight matches against
       * `greedy` — whose plan is four halls and a charge — benedict sat on 2.0 halls and income
       * 11 from minute two to minute thirteen while the ruler sat on 4.0 halls and income 18,
       * and lost 5-3 to a policy with no expansion, no powers, no walk and nothing to do with
       * its money (greedy banked 500-1300 essence it could not spend). At minute three the rush
       * arrived: greedy 26 men, benedict 11.
       * Being out-mustered is a thing an heir may honestly SEE — `enemyArmy` is what is in his
       * sight, nothing more — and the answer to it is another hall, not another tower. Three L1
       * towers put out 27 damage a second; the column walking into them puts out 260, and a
       * hall goes on paying in men for the rest of the match. So the standing want that no
       * plan lists goes to the FRONT of the plan while it holds, and stands down the moment
       * the muster is level again. `HALL_CAP` is what stops it becoming a doctrine of its own:
       * an heir answers a rush, he does not turn into `greedy`.
       *
       * AND THE OTHER HALF OF THE SAME RULE: A HALL YOU CANNOT AFFORD TO RUN IS THE ONLY ONE
       * YOU SHOULD NOT BUILD. Recruits are paid for continuously, so a hall can only absorb
       * `price / period` essence a second — two a second at level one. An heir earning eleven
       * with two halls is spending four of it on men and six of it on stone, and the stone
       * does not shoot back at level one. Worse, a LEVEL is throughput-neutral by design
       * (`CONST.TIER` multiplies the recruit's price by exactly what it multiplies his hit
       * points and his blow), so pouring that six a second into upgrading the halls he has
       * buys the same men in different packaging — which is what benedict was doing while
       * bleys, whose plan simply names three halls, held 3.0 of them by minute two, 55 men by
       * minute six and beat the same ruler 32-4. So: while the ground earns more than the
       * muster can drink, the answer is another hall. It is fog-honest — every term is the
       * heir's own realm — and it stands down by itself the moment the two are level. */
      let saving = false, handled = false;
      /* A SPRING UNDER HIS FEET IS A SPRING HE TAKES, whatever the plan says next. Every drop
       * of essence past the base 2.5 comes out of the ground through a Shadow Gate; one costs
       * 120, draws 4.5 a second, and has paid for itself before the masons are off the next
       * job. Measured over eight skilled matches, twenty minutes each: TWELVE of the board's
       * fourteen springs stood unclaimed for the whole of every one of them, both heirs sat on
       * one or two Gates and income 7-13 all match, and the Pattern — which cannot be walked at
       * a drain of 22 by a realm earning eleven — decided 12% of skilled matches against a
       * 25-75 target. The plans are why: they name two or three Gates and stop. And the errand
       * that would claim more cannot get the army, because the banner is at home or with the
       * war 64% of the time and the errand gets 7%.
       * So take what is already under the boots. This moves NOBODY: `spotFor('gate')` offers
       * only a spring his own troops are standing on, unheld and uncontested — ground he was
       * walking over on his way somewhere else. Expansion pays (DESIGN_PRINCIPLES §4); it was
       * simply never being attempted. */
      if (v.free > 0 && v.essence >= C.BUILDINGS.gate.cost) {
        const spring = spotFor(v, 'gate');
        if (spring) { issue({ c: 'build', x: spring.x, y: spring.y, bt: 'gate' }); handled = true; }
      }
      /* the second standing want is ONE MORE HALL THAN HE HOLDS — never a count of its own, or
       * it double-counts against the halls the plan already names and the heir builds a barrack
       * town. (It did: greedy, whose plan names four, ran to seven and a half.) */
      const musterCap = v.pl.buildings.reduce((s, b) => {
        if (b.raise > 0 || b.work > 0) return s;
        /* what this hall actually drinks — the BRANCH's recruit once it has forked, which can
         * be three times the price of the soldier it used to raise */
        const mus = global.World.mustersOf(b);
        if (!mus) return s;
        return s + C.UNITS[mus.kind].cost * C.TIER[b.level - 1] / mus.period;
      }, 0);
      const walkDrain = v.walking ? C.BUILDINGS.shrine.drain[0] : 0;
      const thirsty = v.income - walkDrain > musterCap + SPARE;
      const oneMore = (v.have.barracks || 0) < HALL_CAP &&
                      (v.enemyArmy >= v.army + OUTNUMBER || thirsty);
      if (!handled && oneMore) {
        handled = true;
        if (v.free > 0) {
          if (v.essence < C.BUILDINGS.barracks.cost) saving = true;
          else {
            const at = spotFor(v, 'barracks');
            if (at) issue({ c: 'build', x: at.x, y: at.y, bt: 'barracks' });
            else handled = false;   // nowhere to put it: the plan is still the plan
          }
        }
      }
      /* SOMETHING THAT BREAKS STONE. An heir who forked every hall to shooters has an army
       * that cannot end a match — it can win every field and never touch a Seat. A Works is
       * the answer he can always reach: its Rams and Bombards are made for stone, and unlike a
       * Barracks it does not have to be re-forked to get there. Standing want, above the plan,
       * because no plan can know which way its own forks went. */
      /* ...and ONE Works may not be enough: an Engine every twenty-four seconds is a siege
       * train that never forms if the first few die on the way. He wants a second before he
       * gives up on the road by force. */
      if (!handled && v.breakers < BREAKERS && v.army >= 5 && (v.have.siege || 0) < 2) {
        handled = true;
        if (v.free > 0) {
          if (v.essence < C.BUILDINGS.siege.cost) saving = true;
          else {
            const at = spotFor(v, 'siege');
            if (at) issue({ c: 'build', x: at.x, y: at.y, bt: 'siege' });
            else handled = false;
          }
        }
      }
      /* ...and then the plan: the first unmet want in it, saving up for it if that is all that
       * is missing.
       * A WANT WITH NOWHERE TO GO DOES NOT STOP THE PLAN BEHIND IT. The loop used to break on
       * the first unmet want whatever the reason, which is right when the reason is MONEY —
       * that is what saving up means — and ruinous when the reason is GROUND. A Gate stands on
       * a spring or nowhere, and a spring beyond the writ has to be taken by troops standing on
       * it, so `spotFor('gate')` legitimately returns null for minutes at a time. Measured on
       * `greedy`, whose plan opens with four Gates: it holds its one opening Gate, wants a
       * second, can never place it, and therefore never reaches the four halls behind it in its
       * own plan. One hall, eight men, dead at 3.4 minutes to a ghost that had blundered into
       * three halls and twenty-two men — the ruler was measuring itself against a policy that
       * had stopped playing.
       * So: no crew is nothing to do, no essence is a reason to SAVE, and no ground is a reason
       * to move on. The want keeps its place in the plan and is taken the moment the ground
       * allows it. */
      const wants = handled ? [] : P.plan(v), seenW = {};
      for (const bt of wants) {
        seenW[bt] = (seenW[bt] || 0) + 1;
        if ((v.have[bt] || 0) >= seenW[bt]) continue;
        if (v.free <= 0) break;                                           // no crew: nothing to raise
        if (v.essence < C.BUILDINGS[bt].cost) { saving = true; break; }   // a purse problem: save for it
        const at = spotFor(v, bt);
        if (at) { issue({ c: 'build', x: at.x, y: at.y, x2: at.x2, y2: at.y2, bt }); break; }
        /* nowhere on the board will take it today — step past it, do not stop the realm */
      }

      /* expansion missions: pick one, march the banner there, build on arrival */
      /* one hand on your own door outranks any errand and any assault */
      const homeThreat = v.threats.length >= 3 || v.atGate > 0;
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
      /* THE WAR OUTRANKS THE SHOPPING. Every heir's doctrine has a clause that says "now go
       * and break his Seat" — benedict's is `v.enCity && v.army >= 6` — and not one of them
       * had ever fired, because the banner was read as `mission ? mission.site : the call`
       * and there is ALWAYS another spring to want. Measured over full matches: the banner
       * stood on the enemy Seat 0% of the time, the army sat on its own quarter of the board
       * for twenty-six minutes at three hundred men a side, and neither castle took a single
       * point of damage in any game. Chaos hid it — a Seat the black road knocked down is
       * recorded as a castle win for whoever was left — so the sim read healthy while the
       * war had quietly stopped happening.
       * An heir who has decided to attack marches, and does not pick up a new errand while
       * he is doing it. Defending home still outranks both: a Seat under threat is not a
       * choice. */
      /* MARCH WHEN YOU CAN WIN. Every doctrine's assault clause was written in an era when it
       * could never fire, so none of them was ever tuned — benedict's says `v.army >= 6`, and
       * six men walking onto a defended Seat is a donation. Measured the moment the clauses
       * started firing: benedict marched sixty men at the ghost's Seat, lost all sixty, and
       * went from 87% against `random` to 30%. The heir advances, and because the decision is
       * remade every couple of seconds he re-reads the odds as he closes: the moment he can
       * SEE more of the enemy than he brought, he stops committing and falls back to his own
       * ground. That is the difference between an assault and a donation. */
      const call0 = P.banner(v);
      const wantsWar = v.enCity && call0 === v.enCityId;
      /* ONE test, and it is a floor rather than an edge. Requiring a quarter more men than he
       * can SEE reads well and measured badly: two heirs of the same mind never have it, so
       * neither ever moves and the mirror runs to the clock — the bleys mirror went from
       * ending at 8 minutes to timing out in half its games. A column big enough to be worth
       * marching is the whole rule; whether it wins is what the fight is for. */
      const ready = v.army >= COMMIT;
      const striking = !homeThreat && wantsWar && ready;
      /* THE SEARCH OUTRANKS THE ERRAND, because it is the war's first move. Every doctrine
       * already says "go and look" — that is what `seek` is — and not one of them had ever
       * ordered it, for exactly the reason the assault never fired: the errand owned the
       * banner and there is always another spring to want. `wantGates` yields a site while ANY
       * of the three nearest springs is unheld, which on a fourteen-spring board is forever.
       * Measured over a full twenty minutes of benedict against the ghost, on a board whose
       * Seats stand 1588 apart: benedict's unexplored sites never moved off 11 of 24, its
       * furthest man never got past 800 from its own Seat, it never laid eyes on the rival's
       * Seat and so `v.enCity` was null for the whole match and the assault clause could not
       * even be asked. It ended the match with 279 men against 13 and could not use one of
       * them. Meanwhile `random`, whose banner is a uniformly random site every couple of
       * seconds, swept the board down to 1 unexplored and had found everything by minute six.
       * The ghost out-scouted the heir, and that — not the fight — is what the gradient was
       * measuring.
       * So a heir whose own doctrine has told him to go looking goes, and the third spring
       * waits. It ends of its own accord: the moment the Seat is found `hunting` is false and
       * the errands have the banner back. Home still outranks it — a Seat under threat is not
       * a choice — and so does an assault, which cannot be running while the Seat is unfound. */
      const hunting = !homeThreat && !v.enCity && !!v.frontier && call0 === v.frontier.id;
      /* an assault he cannot afford is not an errand either — he holds his own choke */
      const call = wantsWar && !ready ? ownChoke(v).id : call0;
      if (!mission && !homeThreat) {
        for (const w of P.missions(v)) {
          const site = w.pick(v);
          if (site) { mission = { site: site.id, bt: w.bt, since: v.t }; break; }
        }
      }
      /* the errand loses the BANNER to the war, not the heir's attention: a realm that stops
       * growing the moment it attacks trades its economy for the assault, and against a foe
       * that never masses — `random` — that trade lost outright. It still cannot plant a Gate
       * with the army away, since a spring needs troops standing on it, and that is the honest
       * price of marching. */

      /* the banner: defend home > the assault > the search for the man > errand > the call */
      let want = homeThreat ? v.myCity.id
               : (striking || hunting ? call : (mission ? mission.site : call));
      /* AN EASIER FOOTING IS ALSO A LATER ONE. Income alone could not do this job: measured
       * against the weakest baseline we ship, an heir at eco 0.8 still had an army on the
       * player's ground at 5.3 minutes, and cutting income further only made it come sooner,
       * because a poorer heir builds less realm and marches earlier. So the assault itself
       * is held: until the named hour the heir expands, garrisons and defends, but does not
       * march on your Seat. It is not weakened in the fight it eventually brings — it just
       * gives you the opening minutes to learn the board. */
      /* AND THE HOLD IS ABOUT THE GROUND, NOT ABOUT WHAT HE KNOWS OF IT. The guard asked for
       * `v.enCity` — the rival's Seat EXPLORED — so an heir who had not found you yet could
       * still send his banner to your Seat as the nearest unseen place and arrive inside the
       * hour the footing promised you. It is the same square of ground either way; whether he
       * has been told what is on it is not the player's problem. */
      if (hold && v.t < hold && want === v.enCityId) want = v.myCity.id;
      if (want !== v.banner) issue({ c: 'banner', site: want });

      /* upgrades: by doctrine, keeping a war chest, never past an unmet want.
       * Gates drawing on a node come first — that is where the essence actually is.
       *
       * EXCEPT THE FORK, WHICH IS NOT AN EXPANSION. Measured over six matches: 22 halls stood
       * at level 1 against 5 forked, no Spire or Works ever forked at all, and the heirs
       * fielded 238 soldiers to 21 branch men — the whole tree was very nearly invisible in
       * AI play. The cause is this line. Plans are long, a heir is `saving` for the next want
       * almost always, and so the upgrade scan below is reached only once a plan runs out.
       * That is right for a LEVEL, which is a luxury bought after the realm. It is wrong for
       * the fork: choosing a hall's soldiery is a decision about the army you already have,
       * it costs less than the hall did, and putting it off means fighting the whole match
       * with the recruit you were given rather than the one your doctrine wants. */
      if (saving && !canFork(v)) return;
      /* AN UPGRADE IS MASONRY NOW: it takes a crew and silences the work while they are on
       * it. So an heir with no crew free must not try (the order is simply refused), and one
       * with a single hall should not shut it down under threat — an upgrade in the middle of
       * an assault is a hall that musters nobody for the length of the fight. */
      if (v.free <= 0) return;
      const pressed = v.threats.length >= 3;
      for (const bt of P.upPref) {
        if (pressed && C.BUILDINGS[bt].spawns &&
            v.pl.buildings.filter((b) => b.bt === bt && !b.raise && !b.work).length < 2) continue;
        /* ONE HALL OF A KIND RE-TOOLS AT A TIME. A hall with masons in it raises nobody, and
         * once the fork was allowed to jump the saving queue a heir with four crews forked its
         * whole barracks town at once and stood mustering nothing for half a minute — measured
         * as a muster throat of 2 essence a second on maps that had been managing eight. */
        if (C.BUILDINGS[bt].spawns && v.pl.buildings.some((b) => b.bt === bt && b.work > 0)) continue;
        const cands = v.pl.buildings.filter((b) => b.bt === bt && b.level < C.MAX_LEVEL && !b.raise && !b.work)
                       .sort((a, b) => (b.node >= 0 ? 1 : 0) - (a.node >= 0 ? 1 : 0));
        for (const b of cands) {
          /* ...and if the only reason we got past `saving` was the fork, then the fork is the
           * only thing to spend on. A heir saving for a Gate must not buy a tower a level with
           * the money on the way past. */
          const atFork = !!C.BUILDINGS[bt].branches && !b.br && b.level + 1 === C.BUILDINGS[bt].fork;
          if (saving && !atFork) continue;
          /* THE FORK: an heir's doctrine picks the branch, and keeps it after. Every branching
           * work asks the same question — a heir that has already forked a hall re-sends the
           * branch it holds so the PRICE comes off the branch table rather than the base one. */
          const br = C.BUILDINGS[bt].branches ? (b.br || branchFor(P, bt, v)) : undefined;
          /* the war chest a LEVEL is bought over and above. A fork keeps a thinner one: it is
           * the cheapest lasting decision on the board and every match spent putting it off is
           * a match fought with somebody else's army. */
          const chest = atFork ? 40 : 130;
          if (v.essence > global.World.upgradeCost(bt, b.level, br) + chest) {
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

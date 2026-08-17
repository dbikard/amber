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
    /* A HEIR AT PEACE IS NOT A RIVAL — and that is nearly the whole of teaching the heirs
     * diplomacy. `enIdx` below is what everything downstream orients on: where to face the
     * towers, where to send the banner, where to storm. Drop a pact partner out of the list and
     * every one of those decisions re-aims on its own, with no doctrine having to know.
     * Two lists, though, and not one: with every rival at peace `foes` is EMPTY, and a heir
     * with no `enIdx` at all falls back to `players[me]` and starts orienting on his own Seat.
     * So orientation keeps the full list and only aggression reads `foes`. */
    /* A LORD OF MY OWN BANNER IS NOT SOMEBODY TO ORIENT ON. `foes` already drops him — he is
     * not a foe — but `others` falls back to the full living list when every rival is at
     * peace, and with sworn lords on the board that fallback aimed a heir's towers, his banner
     * and his assaults at his own vassal's court. Dropped here, where "who else is out there"
     * is answered, so no doctrine downstream has to know about realms at all. */
    const living = world.players.map((q, pi) => pi).filter((pi) =>
      pi !== me && !world.players[pi].out && World.realmOf(world, pi) !== World.realmOf(world, me));
    const foes = living.filter((pi) => World.foe(world, me, pi));
    const others = foes.length ? foes : living;
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
      } else if (World.foe(world, me, u.owner) && World.canSee(world, me, u.x, u.y)) {
        /* ---- A HOSTILE IS SOMEBODY I MAY STRIKE, AND `World.foe` IS THE ONE SPELLING ----
         * This asked `owner !== me`, which is a different question and gets two answers wrong
         * in a war. A PACT PARTNER's men counted as hostiles, so an heir at terms with the
         * player read his army as a threat, came home to defend against it, trumped against it
         * and called the JEWEL down on it — reported from play in exactly those words. The
         * damage was correctly refused at `hurt`'s door, so it did nothing at all except spend
         * the Jewel and put a storm over the player's men, which from his chair is being
         * attacked by an ally. And a SWORN LORD's men are `owner !== me` too, so a liege read
         * his own vassal's army as an enemy massing on his border.
         * The sim is left permissive on purpose: a human may want to storm ground beside a
         * partner to catch Chaos in it, and `hurt` already refuses what must not land. What was
         * wrong was the CHOICE, and the choice is made here. */
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
      essence: pl.essence, myCastle: (World.seatOf(world, me) || {}).hp || 0,
      enemyCastle: (World.seatOf(world, enIdx) || {}).hp || 0,
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
      /* WHOSE court that is, as well as where. `hold` is a promise to the PLAYER about his own
       * ground, and in a country the nearest rival court is very often another bot's — so the
       * guard has to be able to ask whose banner it is answering for. */
      enCityId, enIdx, frontier, unexplored: world.map.sites.filter((s) => !pl.explored[s.id]).length,
      nodes,
      /* what the realm EARNS and what it is already committed to — the two numbers a walk has
       * to be judged against, and neither of them was in the view */
      income: pl.incomeRate || 0, drain: pl.drainRate || 0,
      myPattern: pl.pattern, walking: pl.walking,
      enemyWalking: en.revealed && en.walking, enemyPattern: en.revealed ? en.pattern : 0,
      /* WHO ELSE IS ON THE LINES — every one of them, not just the heir this view calls the
       * rival. A WALK IS PUBLIC (see the fog rules): `World.walkers` is what the top-right
       * board shows every player, so an heir reading it knows exactly what a human at the
       * table knows and no more. `enemyWalking` above is fog-limited and covers ONE opponent,
       * which is the wrong answer at a table of four. */
      walkers: World.walkers(world).filter((q) => q.pi !== me),
      /* ---- TERMS, and only what a human at this seat could see ----
       * `pacts[s]` — sealed, and a sealed pact is public because you cannot play against a
       * diplomacy you cannot see. `offers[s]` — HIS offer to ME, which is mine to know and
       * nobody else's. `castle[s]` — public, as it has always been, and the only honest way an
       * heir can tell who is winning without reading the fog. `atPeace` says every living rival
       * is at terms, which is the one board state where there is nobody to march on. */
      seats: living,
      foes,
      atPeace: living.length > 0 && foes.length === 0,
      pacts: world.players.map((q, pi) => pi !== me && World.pactOn(world, me, pi)),
      offers: world.players.map((q, pi) => pi !== me && !!(q.offers && q.offers[me])),
      mine: world.players.map((q, pi) => !!(pl.offers && pl.offers[pi])),
      castle: world.players.map((q, pi) => (World.seatOf(world, pi) || {}).hp || 0),
      powers: pl.powers, banner: pl.banner ? pl.banner.site : -1,
      /* is my champion on the board — his own, so no fog question arises */
      champion: !!(pl.championId != null && world.units.some((u) => u.id === pl.championId && u.hp > 0))
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
  /* THE JEWEL IS SPENT ON A RIVAL BEFORE IT IS SPENT ON THE WEATHER. Both clusters were drawn
   * from every hostile in sight, and most of what is hostile near a Seat is Chaos — so the one
   * power on a ninety-second cooldown went on fiends the black road was going to send again
   * anyway while the rival's column walked past. Chaos is capped so it can never take a Seat
   * (DESIGN_PRINCIPLES); a rival is not. So the rivals are asked FIRST at the same bar, and
   * the whole field only when there is no rival cluster to find — a heir being overrun by
   * fiends still calls the storm down, which is what makes this an ordering and not a ban. */
  const noChaos = (list) => list.filter((u) => u.owner !== C.CHAOS_ID);
  const onRivalsFirst = (list, min) => clusterAt(noChaos(list), min) || clusterAt(list, min);
  const stormDefend = (min) => (v) => onRivalsFirst(v.threats, min);
  const stormPush = (defMin) => (v) => {
    if (v.push >= 3 && v.enCity) {
      const defenders = v.visHostiles.filter((u) => d2(u.x, u.y, v.enCity.x, v.enCity.y) < 500 * 500);   // guarded by v.enCity above
      const p = onRivalsFirst(defenders, 2);
      if (p) return p;
    }
    return onRivalsFirst(v.threats, defMin);
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

  /* WHAT A STANDING ORDER MAKES THE CREW WANT — the works half of the five words, in the same
   * shape as a personality's own missions so the two simply concatenate and the order goes
   * first. Off entirely without `rules.reach`, so a board and `node sim.js` never see one.
   * `gates` wants the spring the MARCH was sent to take; `walls` wants a tower on the court's
   * own vantages, which is what "wall up" means in works. `hold`, `attack` and `support` are
   * orders about where the army stands and have nothing to add here. */
  const ordered = (world, me, order) => {
    if (!order || !world.rules || !world.rules.reach) return null;
    if (order.mode === 'gates') {
      const s = springTo(world, me, global.World.seatOf(world, me), true);
      return s ? [{ bt: 'gate', pick: () => s }] : null;
    }
    if (order.mode === 'walls') return [wantWatch(2)];
    return null;
  };

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
    const face = v.enCity || v.frontier || { x: v.world.mapW / 2, y: v.world.mapH / 2 };
    const toFoe = Math.atan2(face.y - c.y, face.x - c.x);
    const def = C.BUILDINGS[bt];
    /* as long a run as the idle crews will cover, and no longer — the mason budget is the
     * only ceiling there is now */
    const reach = W.wallReach(v.world, v.me);
    if (reach < def.span[0]) return null;
    /* AND NO LONGER A RUN THAN THE PURSE WILL PAY FOR. A wall is bought BY THE FOOT — the
     * command charges `cost * units`, so a two-crew run is 220 where the card says 110 — and
     * the plan's affordability test knows only the card. So the heir drew the longest run his
     * crews could cover, was refused for essence, and because a want that gets as far as an
     * ORDER counts as the plan's business for that tick, everything behind the wall in the
     * plan went unbuilt; then, `saving` being false, the upgrade scan spent the treasury back
     * below the wall price and it happened again. Measured on benedict against julian, seed
     * 1000: SEVENTEEN OF NINETEEN wall orders refused, every one a 300-length run priced at
     * 220 against an average purse of 139 — for minutes at a time, and the two heirs who ask
     * for stone are the only ones the curtain work could ever have shown up in.
     * Sizing the run to the purse fixes it at the root and leaves the plan's test correct as
     * written: `cost` IS the price of the shortest run there is, one crew's worth, so falling
     * under it is exactly when an heir should be saving. The 0.99 is for the arithmetic — a
     * run of exactly `unit` length can round to two crews on the far side of a hypot. */
    const purse = Math.floor(v.essence / def.cost) * C.WALL.unit;
    const half = Math.min(reach, C.WALL.unit * 2, purse) * 0.99 / 2;
    if (half * 2 < def.span[0]) return null;
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
    const face = v.enCity || v.frontier || { x: v.world.mapW / 2, y: v.world.mapH / 2 };
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
  /* `v.green` is the `siege` LAPSE (CONST.DIFFICULTY): an heir who has not learned what breaks
   * stone marches on the Seat with whatever he has — the beginner's assault, shooters standing
   * under the walls with nothing to shoot. Set on the view by `decide`, never by a doctrine.
   * It is ONLY this: a first cut also had him never raise the Works, and measured head-to-head
   * that was a BUFF (11-6 for the lapsed heir over twenty duels — the essence went into Gates),
   * which says something about the Works and nothing a footing may say. A lapse that makes an
   * heir stronger is not a lapse. It bites the shooter-heavy doctrines and is a no-op for one
   * whose recruits already break stone, which is written down in TODO rather than hidden. */
  const strike = (v) => (v.enCity && (v.green || v.breakers >= BREAKERS) ? v.enCityId : seek(v));
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
  /* how many men a detachment wants before it is worth sending out to hold ground. Below this
   * the smallest manned company still goes — one man on a spring is a Gate the black road has
   * not eaten yet — but the errand PREFERS a body that can stand there. */
  const ERRAND_MEN = +(typeof process !== 'undefined' && process.env && process.env.AMBER_ERRAND) || 4;
  /* WHEN A RIVAL'S WALK BECOMES THE ONLY THING ON THE BOARD. A full walk is a hundred points at
   * the Shrine's one `rate`, which is a little over five minutes — so a rival at ten points has
   * about five minutes left and the march across a 2000x2400 board is a minute of it. Answering
   * early is the whole value: a walk cannot be called off, so there is no feint to be drawn by
   * and nothing is wasted by setting out. `WALK_ARMY` is the floor that stops him sending four
   * men across the world — a Shrine is 900 hit points behind whatever its owner left at home. */
  const WALK_ANSWER = +(typeof process !== 'undefined' && process.env && process.env.AMBER_WALKANS) || 10;
  const WALK_ARMY = +(typeof process !== 'undefined' && process.env && process.env.AMBER_WALKARM) || 8;
  /* how near a RIVAL comes to a walker's own Shrine before the walker's army turns and stands
   * over it. A shooter throws 105 and a Bombard shells stone from 365, so anything inside this
   * is either already hitting it or one march from it. */
  const SHRINE_GUARD = +(typeof process !== 'undefined' && process.env && process.env.AMBER_SHGUARD) || 500;
  /* THE PURSE IS NOT THE TEST ANY MORE. Every doctrine's walk clause carried a cash threshold
   * of its own — 200, 240, 260, 360 — written when an heir with nothing left to buy simply
   * banked what it earned; they were standing in for "can my realm carry this". The shared
   * gate in `decide` answers that properly and by INCOME, and the heirs now spend what they
   * earn on halls and Gates, so a snapshot of the treasury refuses a walk the ground could
   * comfortably pay for. Measured over six skilled matches: of the moments an heir held a
   * Shrine and earned enough to walk, its own purse test refused five in seven, and the
   * Pattern decided 12% of skilled matches against a 25-75 target.
   * What is left is a WAR CHEST, and it is one number instead of four: a floor under the purse
   * before an heir sets foot on the lines at all. It used to be justified as "never start
   * holding less than the shared rule will abandon it for" — there is no abandoning any more,
   * a walk cannot be called off, so what it now buys is simply a little air between the first
   * tick of the drain and the first tick with no soldier bought. `canFinish` in `decide` is
   * the real gate; this is the doctrines' own, and it stays cheap on purpose. */
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

  /* ---------------- doctrines of terms ----------------
   * A `pact(v, seat)` answers one question — do I want my offer standing with THIS seat right
   * now — and the sim does the rest, because a pact is the AND of two offers and the order asks
   * for a state. So a doctrine never has to know whether it is proposing, accepting, keeping or
   * betraying: it only ever says what it wants to be true.
   * An heir with no entry never offers and never accepts, which is today's game exactly.
   * All four read public facts only: castle hit points, who is on the lines, and an offer made
   * to this heir, which is his own. */
  const leader = (v) => v.seats.reduce((best, s) => (best < 0 || v.castle[s] > v.castle[best] ? s : best), -1);
  /* RECIPROCATE: the plainest doctrine there is, and the one that makes a human's offer mean
   * something. Offered terms, he takes them; not offered, he asks for nothing. */
  const reciprocate = (v, s) => v.offers[s];

  /* ---------------- the heirs ---------------- */
  const HEIRS = {
    julian: {
      title: 'Julian, Warden of Arden',
      blurb: 'Stone and patience. Towers first, ground held rather than taken, and the Pattern '
           + 'only at the last — he is the slowest of them to reach for your throne.',
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
      /* THE WARDEN KEEPS HIS WORD. Offered terms he takes them and he does not break them —
       * which is exactly the heir a player wants to be able to trust, and exactly the heir who
       * loses to somebody who cannot be. He is stone and patience; treachery is not in it. */
      pact: reciprocate,
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
      storm: stormDefend(3),
      trump: (v) => v.threats.length >= 4 || v.myCastle < 500
    },
    bleys: {
      title: 'Bleys of the Flame',
      blurb: 'Arrives first, with more. Halls before anything else, outriders to get there and a '
           + 'ram to get in. He wins early or not at all.',
      interval: 1.8, noise: 0.20,
      plan: () => ['gate', 'barracks', 'barracks', 'gate', 'barracks', 'spire', 'gate', 'siege',
                   'spire', 'barracks', 'siege', 'spire', 'barracks', 'tower'],
      /* THE FLAME TAKES TERMS AND BREAKS THEM. He accepts anything offered while he is still
       * mustering — a truce he did not ask for is free time to raise halls in — and withdraws
       * the moment he has an army to spend, with no warning, because there is none to give.
       * He is the reason the offer is worth thinking about rather than worth taking. */
      pact: (v, s) => reciprocate(v, s) && v.army < 14,
      upPref: ['barracks', 'siege', 'spire', 'gate', 'tower'],
      /* Bleys keeps few towers; they must hit hard and far. Everything else is the assault:
       * outriders to arrive, a ram to get in, and Chaos turned on whoever is in the way.
       * THE SHIELDWALL WAS TRIED HERE AND MEASURED WORSE: a thirty-essence man on his tempo
       * cut his host from 76 to 21 and he lost every game of four. Bleys wins by arriving
       * first with more, not by arriving later with better. */
      branch: { tower: () => 'bolt', barracks: () => 'raid', spire: () => 'binder', siege: () => 'ram' },
      missions: (v) => [wantGates('own', 2), wantGates('mid', 1)],   // one forward spring, not the middle
      banner: (v) => v.army >= 6 ? strike(v) : seek(v),   // scout, stage, then storm the gates
      walk: () => false,
      storm: stormPush(4),
      trump: (v) => v.push >= 2 || v.threats.length >= 5
    },
    brand: {
      title: 'Brand the Unmaker',
      blurb: 'Mines Shadow before he fights: springs, Gates, then the Pattern once the ground '
           + 'will pay for the walk. Leave him alone and he simply wins.',
      interval: 1.5, noise: 0.12,
      /* GREED, not a shrine rush. Brand used to raise the Shrine fourth and start walking at
       * three minutes on two springs, drain 17 against income 12 — permanently broke, so his
       * economy never grew and he lost the race he had started. Mine first, then walk. */
      plan: () => ['gate', 'gate', 'tower', 'gate', 'shrine', 'tower', 'barracks', 'spire',
                   'tower', 'barracks', 'spire', 'tower'],
      /* THE SPIRE AND THE WORKS WERE IN THE PLAN AND NOT IN THE LIST, so brand's own doctrine
       * for them was unreachable code: a fork happens only inside this loop, brand's plan
       * raises two Spires and the standing want can raise a Works, and neither could ever
       * level — so the Unmaker fielded Sorcerers and Engines every match while `branch.spire`
       * said 'warden' and `branch.siege` said 'bombard'. A doctrine written and never run is
       * worse than none: it reads as a decision that was made. */
      /* THE UNMAKER BUYS QUIET FOR THE WALK. He offers terms to everyone the moment he means
       * to step on the lines, and the point of them is not friendship: the drain is taken
       * before his halls are paid, so a walking Brand musters nobody and needs the board to
       * leave him alone for five and a half minutes. Note the rule above this call outranks it
       * — nobody stays at terms with a walker — so what he is really buying is the quiet
       * BEFORE he steps on, and it is withdrawn from him the instant he does. */
      pact: (v, s) => (v.have.shrine ? true : reciprocate(v, s)),
      upPref: ['tower', 'gate', 'barracks', 'spire', 'siege'],
      /* the walk is answered by an army, and an army is a crowd — and a walker must HOLD, so
       * shieldmen on the ground and a warden keeping them standing */
      branch: { tower: () => 'cannon', barracks: () => 'line', spire: () => 'warden', siege: () => 'bombard' },
      /* Greed must still MINE. Keeping Brand's army home to guard the walk was tried and
       * measured: it starves him (2 wins across the field) because the walk's drain has to
       * come from somewhere, and under the new economy that somewhere is the springs. */
      missions: (v) => [wantGates('own', 2), wantGates('mid', 2)],
      banner: (v) => (v.unexplored > 3 && v.army >= 5 ? seek(v) : v.myCity.id),   // the army buys him time, but must still find the springs
      walk: (v) => v.have.shrine && v.mySprings >= 3 && v.essence > CHEST,
      storm: stormDefend(2),
      trump: (v) => v.threats.length >= 3
    },
    corwin: {
      title: 'Corwin of Amber',
      blurb: 'A balanced hand — halls, stone and a Shrine — and he will take whichever of the '
           + 'two roads you leave open.',
      interval: 1.4, noise: 0.10,
      plan: () => ['gate', 'barracks', 'tower', 'gate', 'barracks', 'spire', 'shrine', 'barracks',
                   'siege', 'tower', 'barracks', 'spire', 'gate'],
      /* A shadow-self takes terms and holds them until his own road is open. */
      pact: reciprocate,
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
      storm: stormPush(3),
      trump: (v) => v.push >= 2 || v.threats.length >= 4
    },
    benedict: {
      title: 'Benedict, Master of Arms',
      blurb: 'The Master of Arms: quickest to act, hardest to mislead, and the strongest heir '
           + 'the referee can find. Nothing about him is a handicap.',
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
      /* THE MASTER OF ARMS MAKES TERMS AGAINST WHOEVER IS WINNING. He offers to every seat
       * except the one with the most throne left, which is the only public measure of who is
       * ahead — so at a table of four he assembles a field against the leader, and in a duel he
       * offers to nobody at all, because there is nobody to make terms against. He is adaptive:
       * this is the same policy pointed at the diplomacy. */
      pact: (v, s) => v.seats.length > 1 && s !== leader(v),
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
      storm: stormPush(3),
      trump: (v) => v.threats.length >= 3 || v.enemyWalking || v.push >= 3
    }
  };

  /* ---- THE SPRING TO GO AND TAKE, INSIDE HIS OWN CITY'S REACH ----
   * One answer, because the march that goes and takes it and the works arm that then raises a
   * Gate on it must want the SAME spring — sending the company to one and spending the crew on
   * another is how a lord ends a war with a full purse and no ground. Reach-bounded on purpose:
   * that is the only ground a company may be ordered onto (`rules.reach`), so a spring outside
   * it is not a target, it is a refusal repeated every think.
   *
   * A SPRING A RIVAL HOLDS IS STILL A SPRING TO TAKE, and leaving it out is what made the
   * `gates` order silently dead a second time. It asked only for springs NOBODY holds, and a
   * lord whose reach is fully spoken for — which is every lord in the second half of a war, and
   * every INNER lord almost from the start — found none and struck his standards. Measured on
   * one seed: ten springs inside his reach, six of them a rival's, and under a standing order to
   * go and get gates he issued not one rally in forty thinks. Reported from play as a lord asked
   * to build gates never sending troops to look for any. Free ground is still preferred (walk on
   * and build, against break-then-build), so this only ever adds targets where there were none.
   * `freeOnly` is the WORKS arm's question — a crew cannot raise a Gate on a spring somebody
   * else's Gate is standing on — and `World.foe` is the one spelling of "may I strike this", so
   * a pact partner's spring is not a target either. */
  const springTo = (w, me, seat, freeOnly) => {
    const W = global.World;
    if (!seat || !w.map || !w.map.sites) return null;
    const rr = seat.reach ? seat.reach * seat.reach : Infinity;
    let free = null, fd = Infinity, held = null, hd = Infinity;
    for (const s of w.map.sites) {
      if (s.kind !== 'node') continue;
      const d = d2(s.x, s.y, seat.x, seat.y);
      if (d > rr) continue;
      const h = W.nodeHolder(w, s);
      if (h === -1) { if (d < fd) { fd = d; free = s; } }
      else if (!freeOnly && W.foe(w, me, h) && d < hd) { hd = d; held = s; }
    }
    return free || (freeOnly ? null : held);
  };
  const freeSpring = (v, seat) => springTo(v.world, v.me, seat, true);

  /* ---- A LORD BEHIND THE LINES IS A RESERVE, NOT A STATUE ----
   * The march only ever asked his own neighbours for a court of ANOTHER banner, which is right
   * on a frontier and leaves an interior lord with nothing whatever to do: take a cluster of
   * courts and every lord inside it is ringed by his own banner, finds no target, and stands at
   * home for the rest of the war while his halls go on mustering. Measured on a country with a
   * lord and all three of his neighbours sworn: 14 men in his company and ZERO commands in
   * eighty thinks. Reported from play as conquered lords never ordering any troop movement.
   * What a liege actually wants from a vassal behind the lines is REINFORCEMENT, so that is the
   * fall-through: the neighbouring court of his own banner that most needs him — one with
   * enemies at it first, then one that merely borders somebody else — and nothing at all when
   * every neighbour is as safe as he is, because then standing at his own court IS the job.
   * Bounded by his own reach like every other order he can give; neighbouring reaches overlap
   * by construction (`reachMul`), so this is nearly always a legal order, and asking first is
   * what keeps a refusal from being re-issued every think. */
  /* ---- HIS COUNTRY, NOT JUST HIS COURT ----
   * "Trouble at home" was hostiles within 500 of his SEAT and nothing else, so a Gate out on a
   * spring — the thing his whole economy rests on — could be gnawed down by Chaos while he
   * stood in his yard and never looked up. Reported from play: sworn lords do not defend gates
   * attacked by Chaos. A work of his under attack IS trouble at home, and the answer is to send
   * the company to the work rather than to strike the rally and hold the court.
   * Returns the point to answer, and null when nothing of his is being touched. The seat is
   * checked first and returned as itself, because a threat AT the court still means "come
   * home" — which is a different order from "march to that Gate". Reach-bounded like every
   * order he can give; his own works are inside his writ, so this is nearly always legal. */
  const troubleAt = (v, seat) => {
    const w = v.world;
    if (!v.visHostiles.length) return null;
    if (v.visHostiles.some((u) => d2(u.x, u.y, seat.x, seat.y) < 500 * 500)) return seat;
    const rr = seat.reach ? seat.reach * seat.reach : Infinity;
    let best = null, bd = Infinity;
    for (const b of v.pl.buildings) {
      if (b.raise > 0) continue;                       // a shell is not worth the whole company
      if (d2(b.x, b.y, seat.x, seat.y) > rr) continue; // he may not be ordered past his rim
      for (const u of v.visHostiles) {
        const d = d2(u.x, u.y, b.x, b.y);
        if (d < 260 * 260 && d < bd) { bd = d; best = b; }
      }
    }
    return best;
  };

  const reserveAt = (v, seat, seatIdx) => {
    const w = v.world, W = global.World;
    const nbrs = (w.map.gen.nbrs && w.map.gen.nbrs[seatIdx]) || [];
    const rr = seat.reach ? seat.reach * seat.reach : Infinity;
    const mine = W.realmOf(w, v.me);
    let best = null, bs = 0;
    for (const i of nbrs) {
      const c = w.cities[i];
      if (!c || c.razed || c.owner < 0) continue;
      if (W.realmOf(w, c.owner) !== mine) continue;
      if (d2(c.x, c.y, seat.x, seat.y) > rr) continue;
      const pressed = w.units.some((u) => u.hp > 0 && u.owner >= 0 && W.foe(w, v.me, u.owner) &&
                                          d2(u.x, u.y, c.x, c.y) < 650 * 650) ? 2 : 0;
      const exposed = ((w.map.gen.nbrs && w.map.gen.nbrs[i]) || []).some((j) => {
        const o = w.cities[j];
        return o && !o.razed && (o.owner < 0 || W.realmOf(w, o.owner) !== mine);
      }) ? 1 : 0;
      const s = pressed + exposed;
      if (s > bs) { bs = s; best = c; }
    }
    return best;
  };

  /* ---------------- baseline bots (skill-gradient proof) ---------------- */
  const BASELINES = {
    /* THE MARCHER — the Reach War's proof of life, not a doctrine. The heirs are MUTE in a
     * reach world: their whole order vocabulary is the banner (there, the Recall) plus one
     * errand rally, so nothing they know how to say moves an army forward. A marcher speaks
     * only rallies, and only the prototype's sentence: company full — march on the nearest
     * neighbouring court that is not ours; company spent — home. Lords with a real doctrine
     * are the next stage's business. */
    marcher: {
      title: 'A Marcher Captain', interval: 2.0, noise: 0,
      custom: (v, issue) => {
        const w = v.world, W = global.World;
        const seat = w.cities.indexOf(W.seatOf(w, v.me));
        if (seat < 0) return;
        const c = w.cities[seat];
        const co = v.pl.companies[0];
        if (!co) return;
        const nbrs = (w.map.gen.nbrs && w.map.gen.nbrs[seat]) || [];
        const men = v.myUnits.filter((u) => u.co === co.id).length;
        let tgt = null, bd = Infinity;
        for (const i of nbrs) {
          const o = w.cities[i];
          /* not of our BANNER — a marcher who read "not literally mine" walked on the court
           * of the lord standing beside him in the same war */
          if (!o || o.owner < 0 || W.realmOf(w, o.owner) === W.realmOf(w, v.me)) continue;
          const d = (o.x - c.x) ** 2 + (o.y - c.y) ** 2;
          if (d < bd) { bd = d; tgt = o; }
        }
        const at = co.rally;
        if (tgt && men >= 8) {
          /* the same order twice is noise, not resolve */
          if (!at || Math.hypot(at.x - tgt.x, at.y - tgt.y) > 40)
            issue({ c: 'rally', co: co.id, x: tgt.x, y: tgt.y });
        } else if (men < 4 && at) {
          issue({ c: 'rally', co: co.id });   // struck: the company holds at its own city
        }
      }
    },
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
          issue({ c: 'power', k: rng.next() < 0.5 ? 'storm' : 'trump', x: rng.next() * v.world.mapW, y: rng.next() * v.world.mapH });
        } else if (r < 0.6) issue({ c: 'walk', on: rng.next() < 0.5 });
      }
    },
    greedy: {
      title: 'A grasping shadow-lord', interval: 1.6, noise: 0,
      plan: () => ['gate', 'gate', 'gate', 'gate', 'barracks', 'barracks', 'barracks', 'barracks'],
      upPref: ['gate', 'barracks'],
      missions: () => [], banner: (v) => strike(v),
      /* A YARDSTICK NEEDS A DOCTRINE THE MOMENT FORKS ACTUALLY HAPPEN. `branchFor` falls back
       * to `branchUI[0]` for a building nobody named, and for a Barracks that is the
       * SHIELDWALL — a thirty-essence man, and the one branch this file already records as
       * measured worse for a heir who wins by numbers ("cut his host from 76 to 21", under
       * bleys). While no fork ever fired the default was invisible; the moment the fork stopped
       * queueing behind levels, greedy quietly stopped being greedy. Measured: greedy-vs-greedy
       * convergence went from 16.4m with one timeout to 24.8m with two, past the band, in a
       * matchup where nothing else in that change can even fire — greedy walls nothing, walks
       * never, and has no Spire to fork. Outriders are what its own character asks for: it
       * expands and it charges. */
      branch: { barracks: () => 'raid' },
      walk: () => false,
      storm: () => null, trump: () => false
    }
  };

  /* ---------------- AN HEIR'S ARMY ORDERS, TRANSLATED FOR A WAR ----------------
   * THE HEIRS WERE MUTE IN A COUNTRY, and it was one word that did it. Every heir moves its
   * whole army with `{c:'banner'}` — the royal War Banner — and under the reach law there is no
   * one banner an army answers: `standingOrder` falls back to a company's OWN CITY, so a
   * banner order changes nothing at all. Their doctrine was not wrong for a war, it was
   * SPEAKING A WORD THE WAR DOES NOT HAVE. That is why sixteen seats ran a 181-line baseline
   * whose whole vocabulary is rally/build/walk, while five heirs with years of doctrine sat
   * unused.
   * So the word is translated rather than the doctrine rewritten, in ONE place, so every heir
   * gains the war at once and none of them has to know the reach law exists:
   *   - a banner planted anywhere  → every company of his, rallied at that point;
   *   - the RECALL (`site: -1`)    → every company's standard struck, which is what it means;
   *   - any rally, his own or ours → clamped into that company's city disc.
   * CLAMPED, NOT REFUSED. The sim refuses an order past the rim on purpose — a player must be
   * told the truth rather than have his order silently moved — but a bot with no one to tell
   * wants the honest reading of the same intent: march as far toward it as I may. The refusal
   * stays exactly as it is for every human order; this only decides what the heir ASKS for.
   * Off entirely without `rules.reach`, so a board and `node sim.js` see the caller's own
   * `issue` untouched, byte for byte. */
  function warOrders(world, me, issue, order, st) {
    if (!world.rules || !world.rules.reach) return issue;
    const W = global.World;
    /* ---- AND THE LIEGE'S STANDING ORDER IS A BIAS ON THE SAME BRAIN ----
     * The five words were first implemented in a `lord` baseline's `custom`, and an heir has no
     * `custom` — so the moment heirs took the war's seats, every order the council can give
     * would have gone silently unread. That is the dead-button failure twice over, and worse
     * than before, because the council row asserts the order is standing. (The baseline is
     * deleted now: two implementations of one rule had already drifted once.)
     * They are applied HERE, at the same seam that translates the banner, because that is what
     * an order actually is: a claim on where the WAR BODY goes. Everything else the heir does —
     * its economy, its works, its powers, its errand company taking ground — goes on untouched
     * underneath, which is the whole meaning of "a bias on the same brain, not a second brain".
     * `hold`, `walls` and an unpressed `support` are all "keep your own court", which under the
     * reach law is a struck standard and nothing else. */
    const mode = order && order.mode;
    const orderAim = () => {
      const t = order && order.target != null ? world.cities[order.target] : null;
      if (mode === 'attack') return t || null;
      if (mode === 'support') {
        if (!t) return null;
        const pressed = world.units.some((u) => u.hp > 0 && u.owner >= 0 &&
          W.foe(world, me, u.owner) && d2(u.x, u.y, t.x, t.y) < 650 * 650);
        return pressed ? t : 'home';
      }
      if (mode === 'gates') {
        /* THE SPRING TO GO AND TAKE inside his own court's reach — the same one `springTo`
         * hands the works arm (`ordered`), because the march that wins the ground and the crew
         * that spends on it must want the same spring.
         * NULL, NOT 'home', WHEN HIS REACH HOLDS NOTHING TO TAKE. This returned `'home'`, which
         * under the reach law means "strike every standard": an order to go and get gates read
         * as an order to stand in the yard, and said so to nobody. Null is a claim withdrawn —
         * the heir's own aim passes through untouched — which is the right answer, because an
         * order that has run out of ground should leave the doctrine it is biasing alone. */
        return springTo(world, me, W.seatOf(world, me), false);
      }
      if (mode === 'hold' || mode === 'walls') return 'home';
      return null;
    };
    const cityOfCo = (co) => (co && co.city != null ? world.cities[co.city] : null) ||
                             W.seatOf(world, me);
    /* the point itself if it is inside the disc, else the nearest point on the rim toward it */
    const within = (c, x, y) => {
      if (!c || !c.reach) return { x, y };
      const dx = x - c.x, dy = y - c.y, d = Math.hypot(dx, dy);
      if (d <= c.reach - 1) return { x, y };
      const k = (c.reach - 2) / (d || 1);
      return { x: c.x + dx * k, y: c.y + dy * k };
    };
    const aimOf = (cmd) => {
      if (cmd.x != null) return { x: cmd.x, y: cmd.y };
      const s = cmd.site != null && world.map.sites[cmd.site];
      return s ? { x: s.x, y: s.y } : null;
    };
    return (cmd) => {
      if (!cmd) return issue(cmd);
      if (cmd.c === 'banner') {
        const cos = world.players[me].companies || [];
        const told = mode ? orderAim() : null;
        /* the Recall, and every order that means "keep your own court": standards struck */
        if (told === 'home' || (cmd.site === -1 && cmd.x == null && !told)) {
          if (st) st.aim = null;
          for (const co of cos) if (co.rally) issue({ c: 'rally', co: co.id });
          return { ok: true };
        }
        let at = told || aimOf(cmd);
        /* ---- A MINOR LORD HOLDS GROUND; HE DOES NOT CONQUER ----
         * Every seat in a war runs an heir's doctrine, and an heir's whole game is to find the
         * nearest rival court and take it. On the two CONTENDERS that is the war; on the other
         * thirteen it is fifteen little empires all trying to eat each other, which is not what
         * a minor lord is for — he holds a country, and the throne is contended by the heirs.
         * So his war body is turned away from a rival COURT and put on the nearest spring worth
         * taking instead: he still expands, still answers trouble, still defends, and still
         * marches wherever his LIEGE points him — an explicit `attack` or `support` is the
         * player's order and outranks his doctrine, which is why `told` is exempt. */
        if (at && !told && (world.heirs || []).indexOf(me) < 0) {
          const court = (world.cities || []).some((c) => c && !c.razed && c.owner >= 0 &&
            W.foe(world, me, c.owner) && d2(at.x, at.y, c.x, c.y) < C.CITY.r * C.CITY.r);
          if (court) {
            const s = springTo(world, me, W.seatOf(world, me), false);
            if (s) at = { x: s.x, y: s.y };
            else { if (st) st.aim = null;
                   for (const co of cos) if (co.rally) issue({ c: 'rally', co: co.id });
                   return { ok: true }; }
          }
        }
        /* ---- A LORD BEHIND THE LINES IS A RESERVE, NOT A STATUE ----
         * The lord baseline's default — what he did with NO standing order — had three holes,
         * all reported from play, and every seat runs an heir now, so the answers live here at
         * the one seam. `st.v` is the view this think was decided on (decide hands it over):
         * (1) TROUBLE ANYWHERE IN HIS COUNTRY. "Trouble at home" was hostiles near the SEAT, so
         *     Chaos could gnaw an outlying Gate — the thing his economy rests on — while he stood
         *     in his yard. A work of his under attack sends the war body to the WORK. A minor
         *     lord always answers it; a contender only when his own doctrine had him standing at
         *     home, because an assault is not turned back for one fiend at a Gate.
         * (2) THE NEIGHBOUR OF HIS BANNER WHO IS PRESSED OR EXPOSED. An interior lord — every
         *     court round him his own banner's — found no target and stood at home for the rest
         *     of the war (measured: fourteen men, zero commands in eighty thinks). When the
         *     doctrine's aim is his own court and nothing of his is touched, he goes to the
         *     neighbouring court of his banner that most needs him, and stands there.
         * Both are reach-bounded like every order he can give. */
        if (!told && st && st.v) {
          const seat = W.seatOf(world, me);
          const home = !at || (seat && d2(at.x, at.y, seat.x, seat.y) < C.CITY.r * C.CITY.r);
          const minor = (world.heirs || []).indexOf(me) < 0;
          const trouble = seat ? troubleAt(st.v, seat) : null;
          if (trouble && trouble !== seat && (minor || home)) at = { x: trouble.x, y: trouble.y };
          else if (!trouble && home && seat) {
            const r = reserveAt(st.v, seat, me);
            if (r) at = { x: r.x, y: r.y };
          }
        }
        if (!at) return { ok: true };
        /* ---- THE SAME ORDER TWICE IS NOISE, AND HERE IT WAS RUINOUS ----
         * Under `rules.reach` the sim's banner handler strikes the standards and sets NO aim,
         * so `pl.banner` stays null and an heir's own `want !== v.banner` latch can never
         * close: it re-issued its banner every think, and every one of those fanned out to a
         * rally per company. Measured over thirty simulated seconds of a sixteen-seat war:
         * 597 rallies, 68 flow fields built and 1,218 field requests DEFERRED — the ration
         * saturated on essentially every tick, which means men steering blind at the goal
         * instead of down a field, all over the country. That is the lag.
         * So the aim is remembered on the bot and the fan-out is skipped while it has not
         * moved. 40 units is the sim's own threshold for "this is the same order", so the
         * bot and the sim agree about what repeating an order means. */
        if (st && st.aim && d2(st.aim.x, st.aim.y, at.x, at.y) < 40 * 40) return { ok: true };
        if (st) st.aim = { x: at.x, y: at.y };
        let last = { ok: true };
        for (const co of cos) {
          const p = within(cityOfCo(co), at.x, at.y);
          last = issue({ c: 'rally', co: co.id, x: p.x, y: p.y });
        }
        return last;
      }
      if (cmd.c === 'rally' && cmd.x != null) {
        const co = (world.players[me].companies || []).find((q) => q.id === cmd.co);
        const p = within(cityOfCo(co), cmd.x, cmd.y);
        return issue(Object.assign({}, cmd, { x: p.x, y: p.y }));
      }
      return issue(cmd);
    };
  }

  function make(kind, opts) {
    opts = opts || {};
    const P = HEIRS[kind] || BASELINES[kind];
    if (!P) throw new Error('unknown bot: ' + kind);
    const interval = (P.interval || 1.5) * (opts.slow || 1);
    const noise = opts.noise != null ? opts.noise : (P.noise || 0);
    const hold = opts.hold || 0;   // s before this heir will march on your Seat at all
    /* ---- AND IT IS *YOUR* SEAT, WHICH A COUNTRY MADE INTO A REAL QUESTION ----
     * `hold` is checked against the heir's nearest rival court, which in a DUEL is the player's
     * and nothing else. A war seats sixteen, so for most lords the nearest rival court belongs
     * to another bot — and left ungated, an easy footing stopped the whole country making war on
     * itself for thirteen minutes. That is not an easier war, it is a war with nothing in it:
     * measured on today's country, men standing in a foreign court go 0 → 5 → 4 → 77 and three
     * thrones are under the hammer by minute eight, and SQUIRE would have suppressed all of it.
     * So the promise is kept to the banner it was made to. Seat 0 by default, which is the
     * player in every single-player mode and leaves a duel identical to the byte. */
    const holdOn = opts.holdOn != null ? opts.holdOn : 0;
    /* "am I still holding off THIS banner" — the one spelling, so the march and the answer to a
     * walk cannot come to different conclusions about the same promise */
    const heldOff = (v, pi) => hold > 0 && v.t < hold && pi != null &&
                               global.World.realmOf(v.world, pi) === holdOn;
    const noWalk = !!opts.noWalk;  // a chapter that is not about the Pattern shuts that road
    /* ---- A LESSER HEIR DECIDES WORSE; HE IS NOT POORER ----
     * The footing's LAPSES (CONST.DIFFICULTY, composed for a minor lord in game.js) are the
     * whole of the handicap now that the purse is everyone's own. Each is a named mistake at
     * the decision point where a beginner actually makes it — below, where each is spent — and
     * EVERY ROLL DRAWS FROM THE RNG ONLY WHEN THE FLAW IS SET, so an heir with no lapses keeps
     * a bit-identical stream: `node sim.js` seats heirs with no footing at all and must not be
     * able to tell this code was written (a suite plays twelve seeded duels both ways).
     *   `gates`, `up`, `siege` are SPELLS: the fraction of the match he spends in the flaw. A
     *   flaw rolled fresh every think was measured to be nearly no flaw at all — a Gate put off
     *   for one think is a Gate a few seconds later, because missions and errands are sticky —
     *   so a spell HOLDS for `SPELL` seconds once entered, and the entry chance per think is
     *   derived so the long-run fraction comes out at the number in the table.
     *   `aim` is rolled when the doctrine gives a NEW order, and the stray it starts holds for
     *   half a minute — see the banner block.
     *   `hoard` is a spell too: for as long as it holds he raises NOTHING — no plan, no Gate
     *   under his feet, no errand, no level — and the essence piles up while his halls drink
     *   what they can; when it lifts he spends. It was a LENS on the purse first (he read his
     *   treasury at 1/(1+hoard)), and that was measured to be a death spiral: a lord who had
     *   lost every Gate sat on 131 essence, income 2.5, wanting a 120 Gate he read as 93, for
     *   six minutes and forever — a habit had become a lock. A spell cannot lock anything.
     *   `trickle` is not rolled: it lowers the COMMIT floor for good, so his assaults set out
     *   at a handful of men and arrive in dribs (22 -> 6 at SQUIRE's 0.75). */
    const L = opts.lapses || {};
    const lapse = (k) => L[k] > 0 && rng.chance(Math.min(1, L[k]));
    const SPELL = 45, spells = {};
    const spell = (k, t) => {
      const f = L[k] || 0;
      if (f <= 0) return false;
      if (f >= 1) return true;
      if (spells[k] > t) return true;
      /* a spell of SPELL seconds entered with chance p per think, from thinks `interval` apart,
       * is in force SPELL / (SPELL + interval / p) of the time; solve that for p = f */
      if (rng.chance(Math.min(1, interval / (SPELL * (1 / f - 1))))) { spells[k] = t + SPELL; return true; }
      return false;
    };
    const commit = Math.max(4, Math.round(COMMIT * (1 - Math.min(0.9, L.trickle || 0))));
    let stray = null;      // {site, until} — an `aim` lapse: the army sent somewhere known and wrong
    let lastWant = null;   // where the doctrine last meant the banner, to notice a NEW order
    let timer = interval * 0.5, rng = null;
    let mission = null;    // {site, bt, since} — march there, build, move on
    let errandCo = null;   // which standard is out taking ground; kept so the flag does not wander
    let aimed = null;      // {x,y} of the last banner planted on GROUND rather than on a site
    /* WHERE THIS BOT'S ARMY WAS LAST SENT IN A WAR — see warOrders. It is remembered HERE, on
     * the bot, because the sim cannot remember it for us: under `rules.reach` a banner command
     * strikes the standards and sets no aim, so `v.banner` stays null forever and an heir's own
     * "have I already said this?" check can never latch. Without this the heir re-issues its
     * banner EVERY think and each one fans out to a rally per company. */
    const warSt = { aim: null };

    function decide(world, me, issue, order) {
      const v = view(world, me);
      warSt.v = v;   // the view this think is decided on, for warOrders' default (see there)
      if (P.custom) { P.custom(v, issue, rng, order); return; }
      if (noise > 0 && rng.chance(noise)) return;
      /* the lapses this think is played under — see the note at `L` in make() */
      const idle = spell('hoard', v.t);
      const lazyGates = idle || spell('gates', v.t);
      v.green = spell('siege', v.t);

      /* ---------------- terms ----------------
       * ONE OFFER PER RIVAL, SET TO WHAT THE DOCTRINE WANTS IT TO BE. `{c:'pact'}` asks for a
       * state, so the heir simply says what it wants standing and the sim works out whether
       * that seals or breaks anything. An heir with no `pact` doctrine never offers and never
       * accepts, which is exactly today's game — and the whole block is skipped when the rule
       * is off, so a skirmish and `node sim.js` never see one of these orders.
       * The heirs read only what a human at their seat reads: a sealed pact (public), an offer
       * made TO them (theirs), castle hit points (public) and who is on the lines (public,
       * pillar 3). Nothing here reaches past the veil — see DESIGN_PRINCIPLES, "AI plays fair". */
      if (world.rules && world.rules.truce && P.pact) {
        for (const s of v.seats) {
          /* AND NO HEIR KEEPS TERMS WITH A MAN ON THE LINES. This is not a doctrine, it is the
           * same rule that makes a walk public in the first place: a walk cannot be called off,
           * every heir walks at one rate, and the only answer to one is an army at his Shrine.
           * A pact with a walker is therefore a loss agreed to in advance, and no personality
           * gets to be foolish enough to sign it. Above every doctrine, so none can forget. */
          const want = !v.walkers.some((q) => q.pi === s) && !!P.pact(v, s);
          if (want !== v.mine[s]) issue({ c: 'pact', p: s, on: want });
        }
      }

      /* powers — asked only when the sim would not refuse them for the purse or a living
       * champion (measured: 166 'essence' and 24 'alive' refusals in one eleven-minute match,
       * every one a no-op the referee had to log; a refused order changes nothing, so this
       * cannot move the sim, it only stops asking questions whose answer is known) */
      if (v.powers.storm <= 0 && v.essence >= C.POWERS.storm.cost) {
        const p = P.storm(v); if (p) issue({ c: 'power', k: 'storm', x: p.x, y: p.y });
      }
      if (v.powers.trump <= 0 && v.essence >= C.POWERS.trump.cost && !v.champion && P.trump(v))
        issue({ c: 'power', k: 'trump' });

      /* the walk */
      /* The hour grows late. The Pattern is the game's absolute clock, and it only ticks if
       * someone actually sets foot on it — two defensive lines with no shrine-walker between
       * them drew 15 of 30 at the cap. Past this hour, any heir holding a Shrine commits.
       * IT IS A STALL-BREAKER AND NOTHING ELSE, so it stays where it is. Pulled forward to ten
       * minutes to buy the Pattern a larger share of the decisions it measured WORSE: brand
       * against benedict went from 2-1 to three timeouts, because two heirs who both commit at
       * the same hour and both then defend are the stall this clause exists to end. */
      const late = v.t > 1500;
      /* A WALK YOU CANNOT PAY FOR IS A LOSS YOU CHOSE — AND THERE IS NO LONGER A WAY OUT OF
       * ONE. The old shared rule was "start if the ground earns most of the drain, and STOP if
       * the treasury runs dry", with every doctrine carrying a `pauseWalk` clause of its own.
       * Both halves describe a game that no longer exists. `{c:'walk', on:false}` is REFUSED
       * now ('committed'): the only ways off the Pattern are reaching 100 and losing the
       * Shrine. And the Shrine's drain is taken BEFORE any hall is paid, so a walker who
       * cannot carry it does not walk slowly — he musters NOBODY for as long as he is on the
       * lines. Reported from play at PRINCE under the old rules, Benedict stepped on at 4:03,
       * ran his treasury to zero, watched his army fall from thirty-nine to three and was
       * dismantled; under these rules that heir also cannot step off.
       *
       * So the only question left is not "can I START this" but "can I FINISH it". The whole
       * walk costs `full` essence over `secs` seconds, and what pays for it is the bank plus
       * whatever the ground earns across that time. Require a margin on top, because a realm
       * that exactly covers the Shrine raises exactly no soldiers while it walks. One test,
       * and it subsumes both of the owner's numbers: income comfortably over the drain (~24/s
       * against 22 with an empty treasury) OR a bank deep enough to ride it out (~7.5k with no
       * income at all), and every mixture in between.
       *
       * `late` still overrides it. The Pattern is the game's absolute clock and it only ticks
       * if somebody walks: two defensive lines with no walker drew 15 of 30 at the cap. It is
       * a stall-breaker and nothing else, and past that hour a starved muster costs less than
       * a timeout. */
      const shr = C.BUILDINGS.shrine;
      const secs = 100 / shr.rate[0], full = shr.drain[0] * secs;
      const canFinish = v.essence + v.income * secs >= full * 1.1;
      /* AND A RACE YOU HAVE ALREADY LOST IS NOT WORTH ENTERING. Every heir walks at the same
       * `rate` — the Shrine has one, not one per level — so a rival who set foot on the lines
       * first reaches a hundred first, always. Before the walk became a commitment this cost
       * an heir nothing much: he could step off. Now he cannot, and the drain is taken BEFORE
       * his halls are, so a hopeless walk is a heir who musters nobody for five and a half
       * minutes and then loses to the man he was racing — the worst outcome on the board,
       * chosen deliberately.
       * The answer to a rival's walk is an ARMY: it is revealed, its Shrine is revealed with
       * it, and throwing that Shrine down tears him off the Pattern. Refusing the race is what
       * sends the heir to do that instead. `late` does not override this, and must not — the
       * stall-breaker exists because a board where NOBODY walks runs to the cap, and a board
       * where somebody is walking is a board with a clock already running. */
      const raced = v.walkers.length > 0;
      /* AND A CHAPTER MAY TAKE THE ROAD AWAY ENTIRELY. `noWalk` is a campaign's, not a
       * footing's: chapter III asks you to hold your Seat against the Master of Arms for eight
       * minutes, and a rival who quietly walks the Pattern instead ends it with a loss that has
       * nothing to do with what was asked. Reported from play. It is not a handicap — the heir
       * fights exactly as hard — it is the scenario saying which of the two roads this chapter
       * is about, which is the whole point of a chapter having a win condition of its own. */
      if (!v.walking && !noWalk && !raced && (P.walk(v) || (late && v.have.shrine)) && (canFinish || late)) {
        issue({ c: 'walk', on: true });
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
      if (!lazyGates && v.free > 0 && v.essence >= C.BUILDINGS.gate.cost) {
        const spring = spotFor(v, 'gate');
        if (spring) { issue({ c: 'build', x: spring.x, y: spring.y, bt: 'gate' }); handled = true; }
      }
      /* ---------------- A BREACH IS MENDED, NOT MOURNED ----------------
       * No heir had ever issued `{c:'fix'}`, in any doctrine — so every wall an heir lost was
       * lost for the rest of the match, and the two heirs who build stone at all built it once.
       * A mend is a crew, a while and HALF the stone, which is the cheapest defence on the
       * board by a distance: the alternative is 220 essence and a fresh run on ground the
       * rival is standing on.
       * IT IS A STANDING WANT AND IT HAS TO BE, which the first attempt got wrong. Written
       * after the plan it read `!handled` — and a heir almost always HAS handled something by
       * then, so over twelve matches four breaches opened and NOT ONE mend was ordered: a rule
       * that looked shipped, cost a paragraph, and never ran once. A hole in your own curtain
       * outranks the next work on a list, which is what "standing want" means. It still yields
       * to a spring under his feet — income is what pays for stone.
       * AND IT ASKS FOR THE PRICE AND NOTHING MORE. The first version wanted the price over and
       * above the war chest, which is the rule a LEVEL is bought under, and measured: over
       * twelve matches a breach stood open for 5,259 ticks and the purse test refused it on
       * every single one — never the crew, never a mend already running, the purse every time.
       * That is what a breach IS: a heir with a hole in his curtain is a heir who is being
       * attacked, and a heir who is being attacked is spending. A war chest is an allowance
       * kept for the next thing you want; there is no next thing while the wall is open. */
      if (!handled && v.free > 0) {
        for (const b of v.pl.buildings) {
          if (!b.breach || b.work > 0) continue;
          const crews = b.crews || 1;
          if (crews > v.free) continue;
          const price = Math.max(1, Math.round(C.BUILDINGS.wall.cost * (b.units != null ? b.units : crews) * C.WALL.repair));
          if (v.essence < price) continue;
          issue({ c: 'fix', id: b.id });
          handled = true;
          break;
        }
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
      if (!handled && oneMore && !idle) {
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
      if (!handled && !idle && v.breakers < BREAKERS && v.army >= 5 && (v.have.siege || 0) < 2) {
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
      const wants = handled || idle ? [] : P.plan(v), seenW = {};
      for (const bt of wants) {
        seenW[bt] = (seenW[bt] || 0) + 1;
        if ((v.have[bt] || 0) >= seenW[bt]) continue;
        if (lazyGates && C.BUILDINGS[bt].claim) continue;   // the `gates` lapse: he overlooks it this think
        if (v.free <= 0) break;                                           // no crew: nothing to raise
        if (v.essence < C.BUILDINGS[bt].cost) { saving = true; break; }   // a purse problem: save for it
        const at = spotFor(v, bt);
        /* `handled` marks the crew as spoken for: the mend below competes for the same one */
        if (at) { issue({ c: 'build', x: at.x, y: at.y, x2: at.x2, y2: at.y2, bt }); handled = true; break; }
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
        else if (!idle && v.free > 0 && v.essence >= C.BUILDINGS[mission.bt].cost) {
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
      const ready = v.army >= commit;
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
      /* ---- THE LIEGE'S ORDER BIASES THE CREW, NOT ONLY THE COLUMN ----
       * `warOrders` rewrites where the war BODY goes and nothing else, so an heir told to go and
       * get gates marched — and then his mason, who had never heard the order, went on wanting
       * whatever his personality wanted. Reported from play as an inner lord sending troops to
       * springs and never building on them, with a hundred men parked on one.
       * The cause is `wantGates`: it picks from `nodes.own` (the 3 springs nearest his seat) and
       * `nodes.mid` (4-7), capped at one or two, and filtered to springs NOBODY holds. For an
       * inner lord in a developed country every one of those is already gated, so every gate
       * mission returns null and he wants no Gate anywhere — wherever his army is standing.
       * So an order prepends its own want, recomputed every think: as soon as one spring is
       * taken the next free one inside his reach is wanted, which is the whole of "go and get
       * gates" and is not something a fixed `slice(0, 2)` can say.
       * FREE ONLY here, though the MARCH will happily go and take a rival's: a crew cannot raise
       * a Gate on ground another Gate is standing on, and the moment the march brings that one
       * down the spring is free and this picks it up. `springTo` is the same answer both halves
       * ask, which is what keeps the column and the mason wanting the same ground. */
      const led = ordered(world, me, order);
      /* ---- A LORD WHO CANNOT AFFORD HIS OWN PLANS STOPS BUYING MEN ----
       * The muster valve (`{c:'muster'}`) was a player-only control: no doctrine had ever
       * touched it, so a lord whose halls drank everything he earned went on buying soldiers
       * he did not need and never saved the 400 for the Gate that would have paid for them.
       * Reported from play, diagnosed by the player himself — *"he has a negative economy and
       * doesn't know how to stop the muster to get the funds to build."* Measured over six
       * simulated minutes of a country: a minor lord's purse is under 50 essence in 28-40% of
       * samples and his net rate is negative in 4-15%, at every footing.
       * WAR ONLY (`rules.reach`), like `warOrders`. The duel economy is tuned and its heirs are
       * measured against a referee; this answers a country, where a lord's income is a fraction
       * of a duel's and a hall costs the same. It asks for a STATE and only when that state
       * differs, so it is one command at each edge and not one a think.
       * The test is the WANT, not the wallet: he pauses only when there is something he means
       * to build and cannot, and resumes the moment he can, so a lord with nothing to buy
       * musters exactly as he always did.
       * AND IT IS JUDGED ON WHAT HIS HALLS WOULD DRINK, NOT ON WHAT THEY ARE DRINKING. Written
       * against the live `drainRate` it FLAPPED — measured, thirteen toggles in thirty seconds:
       * a shut muster drains nothing, so the same lord read as solvent on the very next think,
       * opened the valve, drained, and shut it again. `musterCap` is the halls' thirst at full
       * flow whatever the valve says, so the answer holds still while the purse fills. */
      if (world.rules && world.rules.reach) {
        const want = mission ? C.BUILDINGS[mission.bt] : null;
        const need = want ? want.cost : 0;
        const starved = need > 0 && v.essence < need && v.income - walkDrain - musterCap <= 0;
        if (!!v.pl.musterPaused !== starved) issue({ c: 'muster', pause: starved });
      }
      if (!mission && !homeThreat) {
        /* the `gates` lapse overlooks his OWN errands and never his liege's: a lazy lord still
         * goes where he is sent, which is what makes the order worth giving him */
        const own = lazyGates ? P.missions(v).filter((w) => !C.BUILDINGS[w.bt].claim) : P.missions(v);
        for (const w of (led ? led.concat(own) : own)) {
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
      if (want === v.enCityId && heldOff(v, v.enIdx)) want = v.myCity.id;
      /* ---------------- THE ANSWER TO A WALK IS AN ARMY AT THE SHRINE ----------------
       * The heirs already REFUSE a race they have lost — every walker moves at the same rate,
       * so whoever stepped on first arrives first, and a hopeless walk is five and a half
       * minutes of mustering nobody and then losing to the man you were racing. What none of
       * them did was the other half of that sentence. `v.walkers` has carried the walker's own
       * SHRINE COORDINATES since the day it was added — a walk is public, so this is exactly
       * what the board in the corner tells the player — and it was read at one place, to set
       * `raced`. Three heirs of five had no response to a rival's walk at all; the two that did
       * sent the army at his SEAT, gated behind having found it and (for julian) behind three
       * breakers. That gate is backwards here: a Shrine is one of the handful of works a
       * `menOnly` shooter may attack, so a host of archers that cannot scratch a Seat can
       * absolutely put a Shrine down — and throwing it down tears him off the Pattern and takes
       * `breakLoss` off what he had banked.
       * So he goes, by coordinate rather than by site — a Shrine stands wherever its owner put
       * it and no site names that ground. `aimed` is the memo the coordinate needs: `pl.banner`
       * remembers a site id and a coordinate banner has none, so without it this would re-issue
       * every think — and a banner STRIKES EVERY COMPANY'S RALLY, which would put the errand
       * on a permanent leash. Re-aimed only when the target really moves.
       * `hold` covers it like any other march on the player's ground: an easy footing gives you
       * the opening minutes, and that has to include the minutes you spend walking. */
      const race = v.walkers.filter((q) => q.x != null && q.pattern >= WALK_ANSWER)
                            .sort((a, b) => b.pattern - a.pattern)[0] || null;
      const answer = race && !homeThreat && !v.walking && v.army >= WALK_ARMY &&
                     !heldOff(v, race.pi) ? race : null;
      /* ...AND THE OTHER HALF OF IT: A WALKER GUARDS HIS OWN SHRINE. The answer above was
       * measured on its own first, and it was too good: the banner reached the burning Shrine
       * on 95% of samples against 62% before it, and brand — the one heir whose plan is dig,
       * raise a Shrine and walk — collapsed from eleven wins across the ladder to three, losing
       * 0-6 to corwin and 0-6 to benedict. That is a heir being correctly countered, but a
       * counter with no answer is not a game: the walk would simply stop being a road. And the
       * survey found the reason it has no answer — `v.walking` was read at exactly ONE place in
       * the whole file, in the arithmetic of whether he could afford another hall. Nothing an
       * heir did changed because he was on the Pattern.
       * Now the thing he defends changes. A Shrine is placed to the REAR — behind the Seat, out
       * of the war — so an army called home to the Seat stands between the enemy and the throne
       * and nowhere near the 900 hit points that actually decide the match.
       * AND IT IS KEYED ON THE SHRINE, NOT ON `homeThreat`. Written the obvious way — walking
       * plus a threat at the court — it was far too wide: `homeThreat` is three hostiles within
       * six hundred of the SEAT, most of what is hostile near a Seat is Chaos, and a walker
       * therefore parked his whole army on the Shrine for the weather. Measured: the contested
       * two-roads split went from 53% against a target of 50 straight back to 69%, a handful of
       * points off the tolerance, and the walk stopped being a race and became a turtle with a
       * clock. The honest trigger is a RIVAL coming for the Shrine — which is also strictly
       * earlier than the old one for the case that matters, since a column making for a
       * rear-placed Shrine need never come within six hundred of the throne at all. */
      const shrine = v.walking && !answer ? v.pl.buildings.find((b) => b.bt === 'shrine' && !b.raise) : null;
      const myShrine = shrine && v.visHostiles.some((u) => u.owner !== C.CHAOS_ID &&
        d2(u.x, u.y, shrine.x, shrine.y) < SHRINE_GUARD * SHRINE_GUARD) ? shrine : null;
      const aim = answer || myShrine;
      if (aim) {
        if (!aimed || d2(aimed.x, aimed.y, aim.x, aim.y) > 80 * 80) {
          aimed = { x: aim.x, y: aim.y };
          issue({ c: 'banner', x: aim.x, y: aim.y });
        }
      } else {
        aimed = null;
        /* ---- THE `aim` LAPSE: SOMEWHERE KNOWN, AND WRONG ----
         * Rolled only when the doctrine gives a NEW order (a want it did not have last think),
         * and it then STICKS for half a minute or so — a stray re-rolled every think would be a
         * flicker the column never had time to follow, and the flaw is that he follows it. He
         * strays only to ground he has explored (fog-honest: a beginner does not know the map
         * better for being a beginner), never onto a rival's own court (that is an attack, not
         * a stray, and it must not be a way round `hold`), and never while his own Seat is
         * threatened: even a beginner comes home. */
        const fresh = want !== lastWant; lastWant = want;
        if (stray && (v.t >= stray.until || homeThreat)) stray = null;
        if (!stray && fresh && !homeThreat && want !== v.myCity.id && lapse('aim')) {
          const courts = world.map.cities.map((ci) => world.map.sites[ci]);
          const known = world.map.sites.filter((s) => s.id !== want && s.kind !== 'city' &&
            v.pl.explored[s.id] && !courts.some((c) => c !== v.myCity &&
              d2(s.x, s.y, c.x, c.y) < C.CLAIM.seat * C.CLAIM.seat));
          if (known.length) stray = { site: rng.pick(known).id, until: v.t + 30 + 30 * rng.next() };
        }
        const dest = stray ? stray.site : want;
        if (dest !== v.banner) issue({ c: 'banner', site: dest });
      }

      /* ---------------- THE ERRAND GETS A COMPANY OF ITS OWN ----------------
       * THE HEIRS HAD NEVER ISSUED `rally` — not once, in any doctrine. Every man an heir owned
       * answered the one Banner, so the errand and the war wanted the same army and the line
       * above is the whole argument: home first, the assault second, the search third, the
       * errand last. It gets what is left, which is nothing.
       *
       * What that costs is not a missed errand, it is the economy. Measured over fifteen-minute
       * matches: an heir raises three to five Gates and finishes with ONE — twice as many are
       * eaten by the black road as by the rival — and fourteen of the board's fourteen springs
       * end the match unheld. Income sits at 7-16 against a Pattern walk that drains 22 and was
       * priced to be walkable on five Gates. So the Pattern is closed by arithmetic, matches
       * cannot end by the Pattern, and the stalemates follow. The heir is not too poor to
       * expand; it is too busy, because it has exactly one army.
       *
       * It has companies. Every mustering hall flies a standard of its own (`joinCo` never
       * returns 0), so an heir holding two halls already owns two, and one of them can be sent
       * to take ground while the rest fights. It goes to the nearest free spring in his own half
       * or the middle, and it does not need to build anything: standing there is enough, because
       * "a spring under his feet is a spring he takes" above will raise the Gate out of the
       * ordinary build budget on the next think.
       *
       * AN ORDER IS ONLY AN ORDER IF SOMEBODY IS UNDER THE FLAG. The errand used to be
       * `cos[cos.length - 1]`, the YOUNGEST standard — chosen for stability, since a company
       * picked afresh each tick would change identity constantly. But the youngest standard is
       * by definition the one belonging to the hall raised last, and a hall raised last has
       * mustered nobody yet. Measured over six matches, sampling every ten seconds of play:
       * **a third of all errands — 174 of 509 — were given to a standard with no men under it
       * at all**, the median company under the errand held ONE man, and it was the heir's
       * largest company 12% of the time. A Siege Works' standard drew it and sat empty; so did
       * a Spire's. The economy that was supposed to follow from this rule was being ordered
       * out of an empty barracks.
       * So: choose by CONTENT and cache the choice, which buys the same stability honestly.
       * The largest manned company is the war body and is never the errand; among the rest the
       * SMALLEST that can hold ground goes, so the detachment costs the war as little as it
       * can while still being able to stand on a spring against the black road. A choice once
       * made is kept while it still has men and is still not the war body, so the flag does not
       * wander. And when no second company has men, no order is given at all — that is the
       * honest answer, and the standing rally of a company that stops being the errand is
       * struck rather than left pointing at a spring nobody is walking to.
       *
       * AND IT STAYS. A Gate on a forward spring is exactly what Chaos comes for, and the men
       * who took it are the garrison — this is the answer to the losses above, not a second
       * rule about defending. When there is nothing left to TAKE it garrisons the nearest
       * spring he already holds rather than walking home: the comment above has claimed this
       * since the rule was written, and the code sent `site: -1` — the Recall — the moment the
       * last free spring was claimed, which is exactly when the forward Gates start being
       * eaten. Only the Seat itself calls it home: a realm about to lose its throne does not
       * need a fourth Gate. */
      const cos = v.pl.companies || [];
      if (cos.length >= 2) {
        const size = {};
        for (const u of v.myUnits) size[u.co] = (size[u.co] || 0) + 1;
        const manned = cos.filter((co) => size[co.id] > 0);
        let body = null;
        for (const co of manned) if (!body || size[co.id] > size[body.id]) body = co;
        const spare = manned.filter((co) => !body || co.id !== body.id);
        let errand = errandCo != null ? spare.find((co) => co.id === errandCo) : null;
        if (!errand) {
          errand = spare.filter((co) => size[co.id] >= ERRAND_MEN).sort((a, b) => size[a.id] - size[b.id])[0] ||
                   spare.sort((a, b) => size[b.id] - size[a.id])[0] || null;
        }
        /* a standard that has stopped being the errand does not keep marching on the old one */
        if (errandCo != null && (!errand || errand.id !== errandCo)) {
          const old = cos.find((co) => co.id === errandCo);
          if (old && old.rally) issue({ c: 'rally', co: errandCo, site: -1 });
        }
        errandCo = errand ? errand.id : null;
        if (errand) {
          const reach = nearestOf(v, v.nodes.own.concat(v.nodes.mid));
          const spring = homeThreat ? null
            : reach.filter((s) => !held(v, s))[0] ||
              reach.filter((s) => global.World.nodeHolder(v.world, s) === v.me)[0] || null;
          const wantAt = spring ? spring.id : -1;
          const at = errand.rally && errand.rally.site != null ? errand.rally.site : -1;
          if (at !== wantAt) issue({ c: 'rally', co: errand.id, site: wantAt });
        }
      }

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
      /* the `up` lapse: for a spell he forgets his halls — no level, no fork. And an idle spell
       * (`hoard`) buys nothing at all. */
      if (idle || spell('up', v.t)) return;
      /* AN UPGRADE IS MASONRY NOW: it takes a crew and silences the work while they are on
       * it. So an heir with no crew free must not try (the order is simply refused), and one
       * with a single hall should not shut it down under threat — an upgrade in the middle of
       * an assault is a hall that musters nobody for the length of the fight. */
      if (v.free <= 0) return;
      const pressed = v.threats.length >= 3;
      /* ---------------- A FORK IS NOT AN UPGRADE, AND MUST NOT QUEUE BEHIND ONE ----------------
       * `upPref` is a priority list and the scan RETURNS on the first order it issues, so a work
       * standing at its fork level in fourth place is only ever reached on a think where the
       * first three have nothing to buy — which, since a level is always buyable, is never.
       * Measured: brand's plan raises two Spires and its want can raise a Works, its doctrine
       * names a branch for both, and across twelve matches NEITHER EVER FORKED — the Unmaker
       * fielded Sorcerers and Engines every game while `branch.spire` said 'warden'. Adding the
       * types to its `upPref` changed nothing at all, because the list was not the obstacle; the
       * `return` was.
       * So the scan runs TWICE over the same list: once for works standing at a fork, and only
       * then for levels. It costs nothing when nobody is at a fork, it needs no heir's list
       * reordered — a reordering is a tuning decision and this is not one — and it says the
       * thing the code already believed: choosing what a hall raises is a decision about the
       * army you have, where a level is a luxury bought after the realm. */
      for (const forkPass of [true, false]) {
        for (const bt of P.upPref) {
          if (pressed && C.BUILDINGS[bt].spawns &&
              v.pl.buildings.filter((b) => b.bt === bt && !b.raise && !b.work).length < 2) continue;
          /* ONE HALL OF A KIND RE-TOOLS AT A TIME. A hall with masons in it raises nobody, and
           * once the fork was allowed to jump the saving queue a heir with four crews forked its
           * whole barracks town at once and stood mustering nothing for half a minute — measured
           * as a muster throat of 2 essence a second on maps that had been managing eight. */
          if (C.BUILDINGS[bt].spawns && v.pl.buildings.some((b) => b.bt === bt && b.work > 0)) continue;
          if (forkPass && !C.BUILDINGS[bt].branches) continue;
          const cands = v.pl.buildings.filter((b) => b.bt === bt && b.level < C.MAX_LEVEL && !b.raise && !b.work)
                         .sort((a, b) => (b.node >= 0 ? 1 : 0) - (a.node >= 0 ? 1 : 0));
          for (const b of cands) {
            /* ...and if the only reason we got past `saving` was the fork, then the fork is the
             * only thing to spend on. A heir saving for a Gate must not buy a tower a level with
             * the money on the way past. */
            const atFork = !!C.BUILDINGS[bt].branches && !b.br && b.level + 1 === C.BUILDINGS[bt].fork;
            if (forkPass !== atFork) continue;
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
    }

    return {
      kind, title: P.title,
      /* what footing actually reached this seat, READ-ONLY — the suites and a rig ask it, so a
       * dead control (a picker that reaches nobody) is something a test can see */
      lapses: L, hold,
      reset() { timer = interval * 0.5; mission = null; errandCo = null; aimed = null; warSt.aim = null;
                stray = null; lastWant = null; for (const k of Object.keys(spells)) delete spells[k]; },
      /* `order` is the standing instruction of whoever this lord answers to — the player, for
       * a lord sworn to him. It is a BIAS on the same brain, not a second brain: a sworn lord
       * goes on running his own city, his own purse and his own muster exactly as he did
       * before he knelt, and the order only says which way to face. That is the whole of what
       * "delegating a city" means here, and it is why there is no steward code any more. */
      step(world, me, issue, dt, order) {
        if (!rng) {
          rng = global.RNG.make((world.seed ^ (me * 0x9E37)) >>> 0);
          /* Independent phase per seat. Two identical heirs used to tick in lockstep, so
           * whichever seat the harness polled first always acted first — and with free
           * placement, acting first means taking the ground. Measured at +7 points to
           * seat 0 in a greedy mirror; a seeded phase removes it without favouring either. */
          timer = interval * rng.next();
        }
        timer -= dt;
        if (timer <= 0) { timer += interval; decide(world, me, warOrders(world, me, issue, order, warSt), order); }
      }
    };
  }

  /* THERE IS NO STEWARD ANY MORE. There used to be a second, thinner brain here — seventy
   * lines that spoke rallies and two build wishes — because a conquered city had no lord of
   * its own and the player had to be given something to run it with. A conquered city has a
   * lord again: he kept his purse, his halls and his crews when he knelt, and he is already
   * running them with the same doctrine he ran them with as an enemy. So the player's
   * instruction is a PARAMETER to that doctrine (`step(world, me, issue, dt, order)`), not a
   * second driver fighting it for the same company's standard — which is what two of them
   * issuing rallies at each other would have been. One brain, one economy, one lord. */
  global.AI = { make, view, HEIRS, BASELINES };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.AI;
})(typeof window !== 'undefined' ? window : globalThis);

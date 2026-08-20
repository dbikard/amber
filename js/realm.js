/* realm.js — the war, one step above a match. Headless-safe: no DOM, no Date.
 *
 * V2: THE COUNTRY IS ONE WORLD. v1 held a graph of regions and materialised each into a
 * little two-seat board when somebody went there — enter/compact/march, a seam, and the
 * war's two rules enforced AT the seam because only the realm could see across it. The
 * Reach War removed the seam: `createWorld(seed, 2, null, rules, {country: true})` grows
 * one continuous land with every city on it at once, so the take lives in the sim itself
 * (holdCities) and the one Pattern in its own placement rule (placementError),
 * both gated on the war's `world.rules`. What is left up here is exactly three things:
 * making a war, answering the HUD about it, and fitting it in a pocket.
 *
 * `REALM.run` keeps `CAMPAIGN.run`'s shape deliberately: game.js holds one for the length
 * of a war, polls it once per simulated frame, and it NEVER writes to a world — anything
 * that ends goes through `World.declare`, the one door out of the sim.
 *
 * THE SAVE writes down what was DONE and regenerates the rest from the seed: the ground,
 * the springs, the sight bake and the opening works all come back from `createWorld`, and
 * the record is the delta — owners, works, men, treasuries, remembered ground. That is why
 * a whole country's war fits under one localStorage key on a phone. */
(function (global) {
  'use strict';

  const C = global.CONST || (typeof require !== 'undefined' ? require('./const.js') : null);
  const REALM = {};
  const World = () => global.World;
  const WG = () => global.WorldGen;

  /* the rules of a war, all of them off in every other mode. The walk runs at two-fifths a
   * board's pace — a war-scale clock a rival can ANSWER with the war's own verbs: conquer
   * the chain of cities toward AMBER while the lords rise against the walker (a walker's
   * city outranks every other neighbour in their doctrine), and a Shrine besieged is a walk
   * stopped. Without the slower clock a walk begun three reaches away was a win nobody
   * could touch — reported from play in exactly those words. */
  const WAR = { endOnSeat: 0, occupy: 1, truce: 1, hush: 1, onePattern: 1, reach: 1,
                walkMul: 0.4 };
  /* WHO CONTENDS. Seat 0 is the player; worldgen dealt seats 1 and 2 the thrones furthest
   * from AMBER, so they are the rivals with room to grow into. Everyone else is a minor
   * lord — he holds ground and does not contend, which is where the early game lives.
   * `world.heirs` is the sim's copy: it decides who gets a colour of his own on the map and
   * who is scenery, and the sim cannot ask the realm. */
  const HEIRS = [0, 1, 2];
  /* ---- THE SIDES ----
   * A war is fought by two SIDES of contenders — two to four seats in all, seat 0 (the human at
   * the table) always on the first — and the rest of the country by minor lords. The default
   * is the designer's: you against three heirs, each of them contending for AMBER and the walk.
   * `REALM.setup(sides)` normalises whatever the setup screen or a LAN lobby hands over: two
   * lists of seat indices, seat 0 first on side A, no seat on both, contenders 0..k-1 — humans
   * take the low seats in join order at a LAN table and bots fill the rest. The sides are the
   * war's `heirs` (flattened) and its `sides` (createWorld makes each one banner from genesis),
   * and they ride the save and the wire, because a guest regenerates the country from the seed
   * and must deal the same banners. */
  REALM.SIDES_DEFAULT = [[0], [1, 2, 3]];
  /* TWO SIDES, OR AS MANY AS THERE ARE HEIRS. A side is a list of contender seats; the first is
   * the player's and seat 0 leads it. A FREE-FOR-ALL (the designer, 2026-08-19) is every
   * contender his own side — `[[0],[1],[2],[3]]` — and nothing downstream has to know the
   * difference: `World.lost`, `endMatch`'s verdict, `refound` and the coalition against a walker
   * all read `world.sides` as a list. Tidied: contenders are the country's four courts furthest
   * from AMBER — seats 0..3 by worldgen's order — so a side may only name those; a seat named
   * twice keeps its first side; empty sides are dropped; and a war needs an enemy, so a single
   * side is given one from the first contender seat it left free. */
  REALM.setup = function (sides) {
    const ok = (x) => x >= 0 && x < 4;
    const seen = new Set([0]);
    const out = [];
    (sides || []).forEach((side, k) => {
      const list = [];
      if (k === 0) list.push(0);
      for (const x0 of side || []) {
        const x = x0 | 0;
        if (!ok(x) || seen.has(x)) continue;
        seen.add(x); list.push(x);
      }
      if (list.length) out.push(list);
    });
    if (!out.length || out[0][0] !== 0) out.unshift([0]);
    if (out.length < 2) {   // a war needs an enemy: the first contender seat side A left free
      const free = [1, 2, 3].find((x) => !seen.has(x));
      if (free == null) { out[0] = out[0].slice(0, 3); out.push([3]); }
      else out.push([free]);
    }
    return out;
  };
  const heirsOf = (sides) => sides.reduce((acc, sd) => acc.concat(sd), []);
  /* `spec` is either explicit sides (a LAN lobby's, a record's) or COUNTS `{a, b}` from the
   * setup screen — heirs at your side and against you — in which case the ally seats are dealt
   * BY GEOGRAPHY once the country exists: of the contender courts, the ones nearest yours stand
   * with you, so a side reads as a side on the map and not as a lottery of seat numbers. */
  REALM.create = function (seed, spec) {
    /* `{ffa: n}` is a free-for-all against n heirs (one to three), each his own banner */
    if (spec && spec.ffa != null) {
      const n = Math.max(1, Math.min(3, spec.ffa | 0));
      spec = Array.from({ length: 1 + n }, (_, i) => [i]);
    }
    const counts = spec && spec.a != null;
    const s0 = counts ? null : REALM.setup(spec || REALM.SIDES_DEFAULT);
    const k = counts ? Math.max(2, Math.min(4, 1 + (spec.a | 0) + Math.max(1, spec.b | 0))) : heirsOf(s0).length;
    const heirs = counts ? Array.from({ length: k }, (_, i) => i) : heirsOf(s0);
    const world = World().createWorld(seed >>> 0, 2, null, WAR, { country: true, heirs, sides: s0 });
    let sides = s0;
    if (counts) {
      const c0 = world.cities[0];
      const others = heirs.slice(1).sort((p, q) =>
        ((world.cities[p].x - c0.x) ** 2 + (world.cities[p].y - c0.y) ** 2) -
        ((world.cities[q].x - c0.x) ** 2 + (world.cities[q].y - c0.y) ** 2));
      const a = Math.max(0, Math.min(k - 2, spec.a | 0));
      sides = REALM.setup([[0].concat(others.slice(0, a)), others.slice(a)]);
      for (const side of sides) for (const m of side) world.players[m].realm = side[0];
      world.sides = sides.map((x) => x.slice());
    }
    return { v: 2, seed: seed >>> 0, sides, world };
  };

  /* ---------------- who is winning ----------------
   * There is one Pattern, in one city: holding AMBER is not winning, it is being ALLOWED to
   * walk — the Shrine can rise nowhere else (rules.onePattern), so a hundred on the Pattern
   * cannot happen anywhere else either, and the tick needs no second question. */
  REALM.run = function (realm) {
    return {
      realm,
      /* asked once per simulated frame over the world game.js already holds; it ANSWERS and
       * never writes, exactly as a chapter's objective does, and ending anything goes
       * through `World.declare` */
      tick(world) {
        if (!world) return null;
        const W = World();
        /* A WAR IS LOST WHEN YOUR OWN COURT SWEARS TO THE OTHER SIDE, and that is asked FIRST.
         * "Your banner holds no city" was the loss when a taken court changed owner; under the
         * oath a broken lord KEEPS his court and answers to the banner that broke him — so a
         * conquered player was counted a member of his conqueror's banner, held all of its
         * cities, and was told he had WON the moment his conqueror walked the Pattern. The
         * side you were dealt at genesis (`world.sides[0]`, seat 0 alone when there are none)
         * is the one thing conquest cannot rewrite: your court under a banner outside it is
         * the loss. It stays "lost" if an ally later breaks the court back — the war ended for
         * this seat when it fell — and the ally fights on under the re-founded banner. */
        if (W.lost(world, 0)) return 'lost';
        /* THE WALK IS THE BANNER'S. Under `onePattern` the Shrine rises only in the Pattern's
         * own city, and in a war that city is usually held by a SWORN lord — so the hundred is
         * reached by him and won by his liege. Asked of the realm, never of seat 0 alone. */
        if (W.realmMembers(world, 0).some((pi) => world.players[pi].pattern >= 100)) return 'won';
        /* ...AND A REALM THAT HOLDS NO CITY has no lord, no purse and no muster — it is over,
         * and the end screen already knows how to say so. */
        if (!W.realmCities(world, 0).length) return 'lost';
        return null;
      },
      /* what the HUD says about the war, asked every frame so it can count */
      say() {
        const w = realm.world, me = w.players[0];
        const W = World();
        if (W.realmMembers(w, 0).some((pi) => w.players[pi].pattern >= 100))
          return 'The Pattern holds, and it answers to your name.';
        const mine = W.realmCities(w, 0).length;
        const all = w.cities.filter((c) => !c.razed).length;
        const pc = w.pattern != null ? w.cities[w.pattern] : null;
        const at = pc ? (w.map.sites[pc.site].name || 'AMBER') : 'the centre';
        /* OUT OF THE WHOLE COUNTRY, not out of an allowance. It used to read "1 of 2 cities
         * held" against an allowance ceiling, which is gone — and a ceiling of two was the
         * least interesting number on the screen anyway. What a war is about is how much of
         * the country flies your banner. */
        const held = `${mine} of ${all} ${all === 1 ? 'city' : 'cities'} held`;
        /* AMBER is "yours" when its lord flies your banner — you do not hold it yourself, you
         * hold his oath, which is the whole shape of the war */
        if (pc && pc.owner >= 0 && W.realmOf(w, pc.owner) === W.realmOf(w, 0))
          return `${held} — ${at} is yours: raise a Shrine and walk`;
        return `${held} — the Pattern lies in ${at}`;
      },
      /* a war has no tutorial; present so game.js holds a war exactly where it holds a
       * chapter, with no branch */
      hint() { return null; }
    };
  };

  /* ---------------- the record of a war ----------------
   * One key, versioned, every localStorage reach wrapped — a private-mode browser that
   * throws must still be able to open the menu. A v1 record was a graph of little region
   * boards; there is no honest way to pour those into one continuous country, so it loads
   * as null and `REALM.lost` says so, once, for the UI to break the news. */
  const KEY = 'amber_realm';
  REALM.lost = false;

  /* the seen mask, run-length coded: alternating run lengths, zeros first. A country's mask
   * is ~28k cells a seat and almost all of it is a few long runs. */
  function rle(g) {
    const out = [];
    let val = 0, run = 0;
    for (let i = 0; i < g.length; i++) {
      const b = g[i] ? 1 : 0;
      if (b === val) { run++; continue; }
      out.push(run); val = b; run = 1;
    }
    out.push(run);
    return out;
  }
  function unrle(runs, mask) {
    let at = 0, val = 0, marked = 0;
    mask.g.fill(0);
    for (const n of runs || []) {
      if (val) { mask.g.fill(1, at, at + n); marked += n; }
      at += n; val ^= 1;
    }
    mask.v = marked;
  }

  /* WHAT IS WRITTEN DOWN: what was DONE, never what the seed can rebuild. Works keep the
   * shape v1's compact used — 13 slots, walls carrying their far end, breach and crews —
   * plus `flip`, which is an ORDER about a run and so belongs in the record; a run's
   * `units`/`gated` are facts about its length and are re-derived. Fog memory (`ghosts`)
   * is the human seat's alone: a lord re-scouts, and it costs him nothing. */
  function pack(realm) {
    const w = realm.world;
    return {
      v: 2, gen: WG().COUNTRY_GEN, seed: realm.seed, t: w.t, tick: w.tick, nextId: w.nextId,
      chaosNext: w.chaosNext, chaosParity: w.chaosParity, heirs: w.heirs, sides: w.sides || null,
      cities: w.cities.map((c) => [c.owner, Math.round(c.hp), c.level, c.razed ? 1 : 0,
                                   c.fell != null ? c.fell : -1]),
      players: w.players.map((p) => ({
        e: Math.round(p.essence), out: p.out ? 1 : 0, pattern: p.pattern,
        /* WHOSE BANNER — the one fact a war is actually made of, and the one thing the seed
         * cannot rebuild. Without it a saved war reloads with every oath forgotten. */
        realm: p.realm != null ? p.realm : -1,
        walking: p.walking ? 1 : 0, revealed: p.revealed ? 1 : 0, nextCo: p.nextCo,
        musterPaused: p.musterPaused ? 1 : 0,
        offers: Array.from(p.offers || [], (o) => (o ? 1 : 0)),
        companies: p.companies.map((co) => [co.id, co.city != null ? co.city : -1,
          co.rally ? Math.round(co.rally.x) : null, co.rally ? Math.round(co.rally.y) : 0,
          co.rally ? co.rally.site : -1, co.paused ? 1 : 0, co.trump ? 1 : 0]),
        b: p.buildings.map((b) => [b.id, b.bt, b.level, Math.round(b.hp), b.br || 0, b.node,
                                   Math.round(b.x), Math.round(b.y),
                                   b.x2 == null ? null : Math.round(b.x2),
                                   b.y2 == null ? null : Math.round(b.y2),
                                   b.breach ? 1 : 0, b.crews || 1, b.co || 0, b.flip ? 1 : 0]),
        explored: Object.keys(p.explored).map(Number)
      })),
      units: w.units.filter((u) => u.hp > 0)
        .map((u) => [u.owner, u.kind, u.tier || 1, Math.round(u.x), Math.round(u.y),
                     Math.round(u.hp), u.co || 0, u.from != null ? u.from : -1]),
      ghosts: w.players[0].ghosts,
      seen: w.players.map((p) => rle(p.seen.g)),
      /* the HELM is the player's own arrangement of the war — which city commands, which
       * stewards keep the rest and under what orders. Not sim state (a steward only ISSUES
       * ordinary commands), but a war put down must come back with its government intact. */
      helm: realm.helm || null,
      /* ---- AND WHETHER IT IS OVER ----
       * `done` was set on the realm in memory and never written to the record, nor read back
       * out of one — so `REALM.load` always returned a war that looked undecided, and the
       * menu's "a decided war is not resumed" check could never fire once in the game's life.
       * Measured: finish a war, press the war button, and the SAME seed comes back with its
       * ending waiting to be re-declared. Reported from play as the end screen of the previous
       * game appearing instead of a new war. Two links in one chain — the other is that a war
       * decided by the SIM (a throne down, one banner left) never set `done` at all, because
       * only the run's `tick` wrote it; that is fixed at `endMatch`, the door every ending
       * passes through. */
      done: realm.done || null
    };
  }

  /* fresh ground from the seed, the record laid over it — v1's restore idiom, one level up */
  function unpack(rec) {
    const W = World();
    /* a record from before the sides carries `heirs` alone: every contender his own banner,
     * which is what those wars were */
    const sides = rec.sides ? REALM.setup(rec.sides) : null;
    const world = W.createWorld(rec.seed >>> 0, 2, null, WAR,
                                { country: true, heirs: sides ? heirsOf(sides) : (rec.heirs || HEIRS), sides });
    world.t = rec.t || 0; world.tick = rec.tick || 0;
    if (rec.chaosNext != null) world.chaosNext = rec.chaosNext;
    world.chaosParity = rec.chaosParity || 0;
    for (let i = 0; i < world.cities.length && i < rec.cities.length; i++) {
      const c = world.cities[i], r = rec.cities[i];
      c.owner = r[0]; c.hp = r[1]; c.level = r[2];
      if (r[3]) c.razed = 1;
      if (r[4] >= 0) c.fell = r[4];
      c.hold = null; c.cd = 0;
    }
    for (let pi = 0; pi < world.players.length && pi < rec.players.length; pi++) {
      const p = world.players[pi], r = rec.players[pi];
      p.essence = r.e; p.out = !!r.out; p.pattern = r.pattern || 0;
      if (r.realm != null && r.realm >= 0) p.realm = r.realm;
      p.walking = !!r.walking; p.revealed = !!r.revealed;
      p.nextCo = r.nextCo || 1; p.musterPaused = !!r.musterPaused;
      p.offers = (r.offers || []).map((o) => (o ? 1 : 0));
      p.companies = (r.companies || []).map((co) => {
        const out = { id: co[0], rally: co[2] == null ? null : { x: co[2], y: co[3], site: co[4] } };
        if (co[1] >= 0) out.city = co[1];
        if (co[5]) out.paused = true;
        if (co[6]) out.trump = true;
        return out;
      });
      p.buildings = (r.b || []).map((b) => {
        const def = C.BUILDINGS[b[1]] || {};
        const out = { id: b[0], bt: b[1], level: b[2], hp: b[3], maxHp: b[3],
                      br: b[4] || undefined, node: b[5], x: b[6], y: b[7],
                      cd: 0, raise: 0, raiseFor: def.raise || 1, work: 0, lastHurt: -99,
                      crews: b[11], co: b[12] };
        if (b[8] != null) {
          out.x2 = b[8]; out.y2 = b[9];
          /* a run is stored by its MIDPOINT, so its length is twice the reach to its far
           * end — and `units`/`gated` follow from the length exactly as the build did */
          const len = 2 * Math.hypot(out.x2 - out.x, out.y2 - out.y);
          out.units = len / C.WALL.unit;
          if (len >= C.WALL.gateMin) out.gated = 1;
        }
        if (b[10]) out.breach = 1;
        if (b[13]) out.flip = 1;
        return out;
      });
      /* a site once seen stays on the map; what it IS comes back from the map itself */
      p.explored = {};
      for (const id of r.explored || []) {
        const s = world.map.sites[id];
        if (s) p.explored[id] = { kind: s.kind, name: s.name };
      }
    }
    world.players[0].ghosts = rec.ghosts || {};
    world.units.length = 0;
    for (const u of rec.units || []) {
      const def = C.UNITS[u[1]];
      if (!def) continue;
      const chaos = u[0] === C.CHAOS_ID;
      const vet = chaos ? C.CHAOS.hpScale(world.t) : (C.TIER[u[2] - 1] || 1);
      const un = { id: world.nextId++, owner: u[0], kind: u[1], tier: u[2], x: u[3], y: u[4],
                   rank: 0, hp: u[5], maxHp: Math.max(u[5], def.hp * vet),
                   dmg: def.dmg * (chaos ? C.CHAOS.dmgScale(world.t) : (C.TIER[u[2] - 1] || 1)),
                   cd: 0, goal: null, co: u[6] || 0, from: u[7] != null ? u[7] : -1 };
      if (chaos) {
        /* a fiend is re-bound to the nearest city, as spawnUnit binds a fresh one — an
         * unbounded chaos field would cost a country-wide Dijkstra (see world.js) */
        let bi = -1, bd = Infinity;
        for (let i = 0; i < world.cities.length; i++) {
          const d = (un.x - world.cities[i].x) ** 2 + (un.y - world.cities[i].y) ** 2;
          if (d < bd) { bd = d; bi = i; }
        }
        if (bi >= 0) {
          un.bnd = bi;
          un.goal = { x: world.cities[bi].x, y: world.cities[bi].y, site: world.cities[bi].site };
        }
      }
      world.units.push(un);
    }
    /* the champion is found again by what he IS — his id was minted afresh just now, and a
     * dangling championId would let the Trump be played over a living champion */
    for (let pi = 0; pi < world.players.length; pi++) {
      const ch = world.units.find((u) => u.owner === pi && u.kind === 'champion');
      if (ch) world.players[pi].championId = ch.id;
    }
    world.nextId = Math.max(world.nextId, rec.nextId || 1);
    /* the ground changed under every cache: the flow fields, the standing wall set and the
     * fog are all stale against a fresh board with a war laid over it. The seen masks come
     * LAST, wholesale — refreshVision marks live sight into them, and the saved mask is
     * already its superset; overlaying after keeps the popcount exactly what was saved. */
    world.navVersion++;
    W.noteWalls(world);
    W.refreshVision(world);
    for (let pi = 0; pi < world.players.length; pi++)
      unrle(rec.seen && rec.seen[pi], world.players[pi].seen);
    return world;
  }

  REALM.save = function (realm) {
    try {
      global.localStorage.setItem(KEY, JSON.stringify(pack(realm)));
      return true;
    } catch (e) { return false; }
  };
  REALM.load = function () {
    let raw = null;
    try { raw = global.localStorage && global.localStorage.getItem(KEY); } catch (e) { return null; }
    if (!raw) return null;
    let p = null;
    try { p = JSON.parse(raw); } catch (e) { return null; }
    /* the old region war cannot be poured into a continuous country: lost, and said once */
    if (p && p.v === 1) { REALM.lost = true; return null; }
    if (!p || p.v !== 2 || p.seed == null) return null;
    /* a save from another GENERATION of the generator would be laid over a country its
     * record was never played on (the seed now deals different ground): lost, same idiom.
     * A record from before the stamp carries none and is read as generation 2, the last
     * one shipped without it. */
    if ((p.gen || 2) !== WG().COUNTRY_GEN) { REALM.lost = true; return null; }
    try {
      const world = unpack(p);
      return { v: 2, seed: p.seed >>> 0, sides: world.sides || null, world, helm: p.helm || null,
               done: p.done || null };
    }
    catch (e) { return null; }
  };
  REALM.forget = function () { try { global.localStorage.removeItem(KEY); } catch (e) {} };
  REALM.saved = function () {
    try {
      const raw = global.localStorage && global.localStorage.getItem(KEY);
      if (!raw) return false;
      const p = JSON.parse(raw);
      /* held to the same generation guard as load(), or the menu offers a resume that
       * loads as null — a dead button */
      return p.v === 2 && (p.gen || 2) === WG().COUNTRY_GEN;
    } catch (e) { return false; }
  };

  global.REALM = REALM;
  if (typeof module !== 'undefined' && module.exports) module.exports = REALM;
})(typeof window !== 'undefined' ? window : globalThis);

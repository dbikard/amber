/* realm.js — the war, one step above a match. Headless-safe: no DOM, no Date.
 *
 * WHAT IT HOLDS AND WHAT IT DOES NOT. The realm knows what the country IS (js/country.js), who
 * holds each city, where every army stands, and what has been done to each region. It holds NO
 * live world: a region is materialised into one when somebody goes there and compacted back to a
 * few kilobytes when they leave. That is the whole reason a country of a dozen boards fits in
 * `localStorage` and on a phone at once.
 *
 * A REGION IS A WORLD, and that is the load-bearing decision of the entire design. Same
 * `CONST.MAP`, same `NAV.cell`, same ground mesh, same fog, same `World.createWorld`. Everything
 * the game already knows how to do it goes on doing unchanged, `sim.js` stays a referee, and the
 * headless suite keeps meaning what it meant. The country is large because there are many
 * regions, never because a grid got bigger — see the measurements at the top of country.js.
 *
 * SEATS. A region's world is an ordinary two-seat board: seat 0 is the heir who is THERE, seat 1
 * is whoever holds the region against him. That is not a simplification of the design, it is the
 * design — a war is fought one region at a time, and the realm decides who seat 1 is before the
 * board is built.
 *
 * `REALM.run` mirrors `CAMPAIGN.run` deliberately: game.js holds one for the length of a war,
 * polls it once per simulated frame, and it NEVER writes to the world. Anything that ends goes
 * through `World.declare`, which is the one door out of the sim.
 */
(function (global) {
  'use strict';

  const C = global.CONST || (typeof require !== 'undefined' ? require('./const.js') : null);
  const COUNTRY = global.COUNTRY || (typeof require !== 'undefined' ? require('./country.js') : null);
  const REALM = {};
  const World = () => global.World;

  /* ---------------- making a war ---------------- */
  /* `heirs` is the AI personalities that hold a city each at the start; everything else is a
   * minor lord, which is where the early game lives — you grow by taking from people who are not
   * playing to win, and a LAN opening is not "rush your friend before he has built anything". */
  REALM.create = function (seed, opts) {
    opts = opts || {};
    const country = COUNTRY.build(seed, opts);
    const heirs = opts.heirs || C.REALM.heirs;
    const realm = {
      v: 1, seed: seed >>> 0, t: 0, country,
      me: 0,                       // which side of the war the player is
      heirs: ['you'].concat(heirs),
      /* HOW MANY LORDS YOU HAVE, and therefore how many cities beyond your own you may hold.
       * A lord is WON — taking a city from an HEIR brings his lord over with it — never bought
       * and never taken from a minor holding. So conquest pays for conquest only when it is
       * conquest of a rival, and a war cannot be won by eating the weak. */
      lords: C.REALM.lords0,
      /* per-region state: null until somebody has been there. A region generated and left
       * carries its works and its garrison; a region never visited carries nothing at all and
       * is rebuilt from its seed the first time it is entered. */
      state: {},
      marches: [],                 // columns between regions: {owner, from, to, at, arrive, men}
      at: null,                    // the region the player is standing in
      done: null                   // 'won' | 'lost' once the war is over
    };
    /* --- hand out the cities --- */
    /* THE PATTERN'S CITY BELONGS TO NOBODY. It is the centre of the map and the only way to
     * walk; starting anybody in it would decide the war before it began. */
    const land = COUNTRY.landRegions(country).slice();
    const spread = pickApart(country, land, realm.heirs.length);
    for (let i = 0; i < realm.heirs.length; i++) {
      const r = spread[i];
      if (!r) continue;
      const city = COUNTRY.cityIn(country, r.key);
      if (city) { city.owner = i; city.lord = i === 0 ? null : realm.heirs[i]; }
    }
    for (const c of country.cities) {
      if (c.owner >= 0 || c.pattern) continue;
      c.owner = -1;
      c.lord = C.REALM.lords[Math.floor(hashFrac(seed, c.id) * C.REALM.lords.length)];
    }
    realm.at = spread[0] ? spread[0].key : (land[0] && land[0].key) || null;
    return realm;
  };

  function hashFrac(a, b) {
    let h = Math.imul((a >>> 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (b >>> 0), 0xc2b2ae35) >>> 0;
    h ^= h >>> 15;
    return (h >>> 8) / 0x1000000;
  }
  /* THE HEIRS START AS FAR APART AS THE COUNTRY ALLOWS — and not in the Pattern's city. The same
   * rule the board itself uses for two Seats, one level up: a war that opens with two heirs in
   * neighbouring regions is a war decided in its first ten minutes. Greedy and deterministic:
   * the first is the land region furthest from the Pattern, and each after it is the one whose
   * nearest already-taken region is furthest away. */
  function pickApart(country, land, n) {
    const open = land.filter((r) => {
      const c = COUNTRY.cityIn(country, r.key);
      return c && !c.pattern;
    });
    if (!open.length) return [];
    const pat = country.index[country.pattern];
    const d2 = (a, b) => (a.cx - b.cx) * (a.cx - b.cx) + (a.cy - b.cy) * (a.cy - b.cy);
    const out = [];
    let first = open[0], fd = -1;
    for (const r of open) { const d = pat ? d2(r, pat) : 0; if (d > fd) { fd = d; first = r; } }
    out.push(first);
    while (out.length < n) {
      let best = null, bd = -1;
      for (const r of open) {
        if (out.indexOf(r) >= 0) continue;
        let near = Infinity;
        for (const q of out) near = Math.min(near, d2(r, q));
        if (near > bd) { bd = near; best = r; }
      }
      if (!best) break;
      out.push(best);
    }
    return out;
  }

  /* ---------------- a region becomes a world ---------------- */
  /* `foe` is the seat the region is held against — an heir index, or null for a minor lord's
   * city, which the war treats as an heir with no personality of his own. */
  REALM.enter = function (realm, key) {
    const W = World();
    const region = COUNTRY.regionOf(realm.country, key);
    if (!region || region.sea) return null;
    const city = COUNTRY.cityIn(realm.country, key);
    /* THE RULES OF A REGION ARE THE RULES OF THE WAR: a Seat yields rather than ending
     * anything, terms may be made, and the quiet tick is on. `endOnSeat` is OFF — losing a city
     * in a country is a loss and not a death, and the war ends at the Pattern or nowhere. */
    const world = W.createWorld(region.seed, 2, null,
                                { endOnSeat: 0, occupy: 1, truce: 1, hush: 1, onePattern: 1 });
    world.realmKey = key;
    world.biome = region.biome;
    /* THE ONE REGION A SHRINE MAY BE RAISED IN. Stamped here rather than asked of the country
     * from inside the sim: `world.js` is headless-first and knows nothing above a board, and it
     * must stay that way — see the note on `onePattern` in const.js. */
    world.pattern = !!(city && city.pattern);
    /* WHOSE CITY IS IT. Seat 0 is the heir who came here; seat 1 is whoever holds it. A region
     * whose city is the player's own is a region he is defending. */
    const mine = city && city.owner === realm.me;
    world.cities[0].owner = mine ? 0 : (city && city.owner === realm.me ? 0 : (city && city.owner >= 0 && city.owner !== realm.me ? 1 : -1));
    if (mine) world.cities[0].owner = 0;
    /* the second seat of the board is not a city of the country — a region has ONE — so it is
     * put beyond anyone's reach rather than left standing as a second throne nobody owns */
    world.cities[1].owner = -1; world.cities[1].hp = 0; world.cities[1].razed = 1;
    const saved = realm.state[key];
    if (saved) REALM.restore(world, saved);
    return world;
  };

  /* ---------------- ...and back again ----------------
   * Everything a region must remember and nothing it can rebuild: the ground comes from the
   * seed, so only what was DONE to it is written down. A few kilobytes a region, which is what
   * lets a whole country live in `localStorage`. */
  REALM.compact = function (world) {
    return {
      t: world.t,
      cities: world.cities.map((c) => [c.owner, Math.round(c.hp), c.level, c.razed ? 1 : 0]),
      players: world.players.map((p) => ({
        e: Math.round(p.essence),
        b: p.buildings.map((b) => [b.id, b.bt, b.level, Math.round(b.hp), b.br || 0, b.node,
                                   Math.round(b.x), Math.round(b.y),
                                   b.x2 == null ? null : Math.round(b.x2),
                                   b.y2 == null ? null : Math.round(b.y2),
                                   b.breach ? 1 : 0, b.crews || 1, b.co || 0]),
        u: p !== null ? null : null
      })),
      units: world.units.filter((u) => u.hp > 0 && u.owner >= 0)
        .map((u) => [u.owner, u.kind, u.tier || 1, Math.round(u.x), Math.round(u.y), Math.round(u.hp)]),
      next: world.nextId
    };
  };
  REALM.restore = function (world, s) {
    const W = World();
    world.t = s.t || 0;
    for (let i = 0; i < world.cities.length && i < s.cities.length; i++) {
      const c = world.cities[i], r = s.cities[i];
      c.owner = r[0]; c.hp = r[1]; c.level = r[2]; if (r[3]) c.razed = 1;
    }
    for (let pi = 0; pi < world.players.length && pi < s.players.length; pi++) {
      const p = world.players[pi], r = s.players[pi];
      p.essence = r.e;
      p.buildings = r.b.map((b) => {
        const def = C.BUILDINGS[b[1]] || {};
        return { id: b[0], bt: b[1], level: b[2], hp: b[3], maxHp: b[3], br: b[4] || undefined,
                 node: b[5], x: b[6], y: b[7],
                 ...(b[8] == null ? {} : { x2: b[8], y2: b[9] }),
                 ...(b[10] ? { breach: 1 } : {}), crews: b[11], co: b[12],
                 cd: 0, raise: 0, raiseFor: def.raise || 1, work: 0, lastHurt: -99 };
      });
    }
    world.units = s.units.map((u) => {
      const def = C.UNITS[u[1]];
      return { id: world.nextId++, owner: u[0], kind: u[1], tier: u[2], x: u[3], y: u[4],
               ox: 0, oy: 0, hp: u[5], maxHp: def.hp * (C.TIER[u[2] - 1] || 1),
               dmg: def.dmg * (C.TIER[u[2] - 1] || 1), cd: 0, goal: null, co: 0, from: -1 };
    });
    world.nextId = Math.max(world.nextId, s.next || 1);
    world.navVersion++;
    if (W.refreshVision) W.refreshVision(world);
  };
  /* leaving a region is compacting it and putting the record away */
  REALM.leave = function (realm, key, world) {
    if (!world) return;
    realm.state[key] = REALM.compact(world);
    /* AND THE COUNTRY LEARNS WHAT HAPPENED HERE. A city taken inside a region is a city taken
     * in the war — the two must not be able to disagree, so the region's world is the truth and
     * this is the one place it is copied up. */
    const city = COUNTRY.cityIn(realm.country, key);
    if (city) {
      const c0 = world.cities[0];
      if (c0.razed) { city.owner = -1; city.razed = 1; city.lord = null; }
      else if (c0.owner === 0 && city.owner !== realm.me) {
        /* A COURT WILL NOT SWEAR TO A HEIR WHO CANNOT HOLD IT. You keep one city by right and
         * one more for every lord you have; past that the city goes back to being free — a
         * refusal the player can SEE on the map, rather than a number quietly ignored. It is
         * checked here because here is the one place the country learns anything, and because
         * `world.js` must go on knowing nothing above a board. */
        if (REALM.holds(realm, realm.me).length >= 1 + realm.lords) {
          city.owner = -1;
          world.cities[0].owner = -1;
          realm.refused = city.id;                  // the map says why on the next draw
        } else {
          /* AND HIS LORD COMES OVER WITH HIS CITY — but only a rival's. Taking from a minor
           * holding wins ground and nothing else, which is what stops a war being won by
           * eating the weak. */
          const was = city.owner;
          city.owner = realm.me; city.lord = null;
          if (was >= 1) realm.lords++;
        }
      } else if (c0.owner === 0) { city.owner = realm.me; city.lord = null; }
      else if (c0.owner < 0) { city.owner = -1; }
    }
  };

  /* ---------------- marching between regions ----------------
   * A column ordered past a border steers at its CROSSING and is handed to the neighbour at the
   * matching point on its side — the wall-gateway trick one level up, and the same shape
   * `postWalls` already uses. Between the two it is a record on the realm and not a world, which
   * is what makes a march across a country cost nothing while nobody is watching it. */
  REALM.march = function (realm, from, to, men, owner) {
    const door = COUNTRY.doorTo(realm.country, from, to);
    if (!door) return null;
    const m = { owner: owner == null ? realm.me : owner, from, to, men: men.slice(),
                at: 0, arrive: C.REALM.crossing };
    realm.marches.push(m);
    return m;
  };
  REALM.tick = function (realm, dt) {
    realm.t += dt;
    for (let i = realm.marches.length - 1; i >= 0; i--) {
      const m = realm.marches[i];
      m.at += dt;
      if (m.at < m.arrive) continue;
      realm.marches.splice(i, 1);
      REALM.arrive(realm, m);
    }
  };
  /* A COLUMN ARRIVES AT THE FAR GATE — into the saved state of a region nobody is standing in,
   * or straight into the live world if somebody is. Both go through the same record, so a
   * region does not behave differently for being watched. */
  REALM.arrive = function (realm, m) {
    const door = COUNTRY.doorTo(realm.country, m.from, m.to);
    if (!door) return;
    const at = COUNTRY.gate(door, 'far');
    const st = realm.state[m.to] || (realm.state[m.to] = emptyState());
    for (const u of m.men)
      st.units.push([m.owner === realm.me ? 0 : 1, u.kind, u.tier || 1,
                     Math.round(at.x), Math.round(at.y), Math.round(u.hp)]);
  };
  function emptyState() {
    return { t: 0, cities: [], players: [{ e: C.START_ESSENCE, b: [] }, { e: C.START_ESSENCE, b: [] }],
             units: [], next: 1 };
  }

  /* ---------------- who is winning ----------------
   * ONE PATTERN, IN ONE CITY. Holding it is the only way to walk, so the country has a centre
   * without anybody declaring one and the endgame is a convergence rather than fifteen sieges.
   * `REALM.run().tick` NEVER writes to a world — it answers, and game.js ends things through
   * `World.declare`, exactly as a chapter does. */
  REALM.holds = (realm, pi) => realm.country.cities.filter((c) => c.owner === pi);
  REALM.patternCity = (realm) => realm.country.cities.find((c) => c.pattern) || null;
  REALM.lordsOf = (realm, pi) => REALM.holds(realm, pi).filter((c) => c.lord != null).length;
  /* AND YOU MAY HOLD ONLY AS MANY CITIES AS YOU HAVE LORDS TO HOLD THEM — the brake on the
   * snowball, and the reason a lord is a resource rather than a convenience. An unlorded city
   * beyond the first produces little and defends itself badly. */
  REALM.overheld = (realm, pi) => Math.max(0, REALM.holds(realm, pi).length - 1 - (realm.lords || 0));

  REALM.run = function (realm) {
    return {
      realm,
      /* asked once per simulated frame over the world game.js already holds; answers and does
       * not act, exactly as a chapter's objective does */
      /* THE WAR ENDS WHERE ONE MATCH DOES, and by the same rule. Asked once per simulated frame
       * over the world game.js already holds; it ANSWERS and never writes, exactly as a
       * chapter's objective does, and ending anything goes through `World.declare`.
       * There is one Pattern, in one city: holding that city is not winning, it is being ALLOWED
       * to walk. A walk completed in the Pattern's own region wins the country. */
      tick(world) {
        if (realm.done) return realm.done;
        if (!world || !world.pattern) return null;
        const me = world.players[0];
        if (me && me.pattern >= 100) return 'won';
        return null;
      },
      /* what the HUD says about the war, asked every frame so it can count */
      say() {
        const mine = REALM.holds(realm, realm.me).length;
        const room = 1 + realm.lords;
        const pat = REALM.patternCity(realm);
        const held = `${mine} of ${room} ${room === 1 ? 'city' : 'cities'} held`;
        if (realm.done === 'won') return 'The Pattern holds, and it answers to your name.';
        if (pat && pat.owner === realm.me) return held + ' — AMBER is yours: raise a Shrine and walk';
        return `${held} — the Pattern lies at ${pat ? pat.name : 'the centre'}`;
      },
      /* a war has no tutorial: it is not a chapter and it teaches by being played. Present so
       * game.js may hold a realm's run exactly where it holds a chapter's, with no branch. */
      hint() { return null; }
    };
  };

  /* ---------------- the record of a war ----------------
   * One key, versioned, and every `localStorage` reach wrapped — a private-mode browser that
   * throws must still be able to open the menu. Same shape as `CAMPAIGN.progress`, deliberately:
   * two persistence idioms in one game is one too many. */
  const KEY = 'amber_realm';
  REALM.save = function (realm) {
    try {
      global.localStorage.setItem(KEY, JSON.stringify({
        v: 1, seed: realm.seed, t: realm.t, me: realm.me, heirs: realm.heirs, at: realm.at,
        lords: realm.lords,
        cities: realm.country.cities.map((c) => [c.id, c.owner, c.lord, c.razed ? 1 : 0]),
        state: realm.state, marches: realm.marches, done: realm.done
      }));
      return true;
    } catch (e) { return false; }
  };
  REALM.load = function () {
    let raw = null;
    try { raw = global.localStorage && global.localStorage.getItem(KEY); } catch (e) { return null; }
    if (!raw) return null;
    let p = null;
    try { p = JSON.parse(raw); } catch (e) { return null; }
    if (!p || p.v !== 1 || p.seed == null) return null;
    const realm = REALM.create(p.seed, { heirs: (p.heirs || []).slice(1) });
    realm.t = p.t || 0; realm.me = p.me || 0; realm.at = p.at || realm.at;
    realm.state = p.state || {}; realm.marches = p.marches || []; realm.done = p.done || null;
    realm.lords = p.lords != null ? p.lords : C.REALM.lords0;
    for (const row of p.cities || []) {
      const c = COUNTRY.cityById(realm.country, row[0]);
      if (!c) continue;
      c.owner = row[1]; c.lord = row[2]; if (row[3]) c.razed = 1;
    }
    return realm;
  };
  REALM.forget = function () { try { global.localStorage.removeItem(KEY); } catch (e) {} };
  REALM.saved = function () {
    try { return !!(global.localStorage && global.localStorage.getItem(KEY)); } catch (e) { return false; }
  };

  global.REALM = REALM;
  if (typeof module !== 'undefined' && module.exports) module.exports = REALM;
})(typeof window !== 'undefined' ? window : globalThis);

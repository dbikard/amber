/* worldgen.js — the Shadow made new each match. Headless-safe: no DOM, no Date.
 *
 * There is no template any more. Elevation and moisture are noise; the land is read off
 * them; springs, high ground and both Seats are then PLACED on the land that came out.
 * Nothing is authored, so nothing is memorised — and there are no corridors except the ones
 * the mountains and the water happen to leave.
 *
 * FAIRNESS WITHOUT A MIRROR. Every earlier map was point-mirrored, which is the cheapest
 * fairness there is — and it also tells you exactly where your rival stands: opposite you.
 * A hidden Seat cannot survive a mirror. So the world is asymmetric and the two Seats are
 * instead CHOSEN: many candidate pairs are scored on what each side actually has within
 * reach — springs, buildable ground, room to expand — and the fairest pair wins. Per-seed
 * luck becomes small and, across a suite, averages out; `sim.js`'s mirror test still reads
 * seat bias, it just needs more games to see through the noise.
 */
(function (global) {
  'use strict';

  const C = global.CONST || (typeof require !== 'undefined' ? require('./const.js') : null);
  const G = {};

  /* ---------------- value noise ---------------- */
  function vnoise(seed, x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const at = (a, b) => {
      let h = (a * 374761393 + b * 668265263 + seed * 1274126177) | 0;
      h = (h ^ (h >>> 13)) * 1274126177 | 0;
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    const t = a + (b - a) * sx;
    return t + ((c + (d - c) * sx) - t) * sy;
  }
  function fbm(seed, x, y, oct, gain) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += amp * vnoise(seed + i * 131, x * freq, y * freq);
      norm += amp; amp *= gain; freq *= 2;
    }
    return sum / norm;
  }

  /* ---------------- the land ----------------
   * elevation and moisture decide everything; ridges come from a folded noise so mountains
   * run in chains rather than sitting in blobs. */
  G.T = { WATER: 1, MARSH: 2, PLAIN: 3, MEADOW: 4, FOREST: 5, HILL: 6, CLIFF: 7 };
  const T = G.T;
  /* movement cost by land; 0 is impassable. Slope is charged on top (see nav.js). */
  G.COST = { 1: 0, 2: 5, 3: 1, 4: 2, 5: 3, 6: 2, 7: 0 };
  /* what will bear a building */
  G.BUILDABLE = { 3: true, 4: true, 6: true };

  /* ---- A REGION HAS A CHARACTER, and it is three numbers ----
   * A country is many boards, and a country where every board is drawn from the same
   * distribution is a country with one kind of ground in it. A BIOME shifts the three
   * thresholds the terrain is read off — where the water line is, where the high ground
   * starts, where it stops being passable — and nothing else: the noise, the ridges and the
   * rim are the same code, so a biome cannot produce a board the rest of the game has never
   * seen. `CONST.BIOMES` is the table and `null` is the country the game has always had. */
  G.biomeOf = function (key) {
    return (key && C.BIOMES && C.BIOMES[key]) || null;
  };
  /* `dims` is the land's size in world units, `{W, H}`. Omitted, it is `CONST.MAP` — the
   * board every existing mode plays on. THE SIZE IS THE WORLD'S, NOT THE GAME'S: a country
   * and the duel that referees the balance tables must be able to disagree in one process,
   * which is the same reason `world.rules` is a copy and not a global. */
  G.generate = function (seed, biome, dims) {
    const b = G.biomeOf(biome);
    const N = b ? Object.assign({}, C.WORLD, b.world) : C.WORLD;
    const cw = C.NAV.cell;
    const D = dims || C.MAP;
    const W = Math.round(D.W / cw), H = Math.round(D.H / cw), n = W * H;
    const sd = (seed >>> 0) || 1;
    const elev = new Float32Array(n), terra = new Uint8Array(n);

    for (let gy = 0; gy < H; gy++) {
      for (let gx = 0; gx < W; gx++) {
        const i = gy * W + gx, fx = gx * N.freq, fy = gy * N.freq;
        const base = fbm(sd, fx, fy, 4, 0.5);
        /* folded noise → ridge lines, so high ground forms chains and passes */
        const ridge = 1 - Math.abs(fbm(sd + 977, fx * 1.4, fy * 1.4, 3, 0.55) * 2 - 1);
        let e = base * (1 - N.ridge) + ridge * N.ridge;
        /* a soft rim so the world fades into Shadow instead of ending in a wall of cliff */
        const edge = Math.min(gx, gy, W - 1 - gx, H - 1 - gy) / N.rim;
        e *= Math.min(1, 0.45 + 0.55 * Math.min(1, edge));
        elev[i] = e;
      }
    }
    for (let gy = 0; gy < H; gy++) {
      for (let gx = 0; gx < W; gx++) {
        const i = gy * W + gx, e = elev[i];
        const m = fbm(sd + 5150, gx * N.freq * 1.7, gy * N.freq * 1.7, 3, 0.5);
        terra[i] = e < N.sea ? T.WATER
          : e < N.sea + 0.035 ? (m > 0.5 ? T.MARSH : T.PLAIN)
          : e > N.cliff ? T.CLIFF
          : e > N.hill ? T.HILL
          : m > 0.62 ? T.FOREST
          : m > 0.46 ? T.MEADOW
          : T.PLAIN;
      }
    }
    return { W, H, cw, elev, terra };
  };

  /* ---------------- reachability over the land ---------------- */
  function floodFrom(land, start) {
    const { W, H, terra } = land, seen = new Uint8Array(W * H), q = [start];
    seen[start] = 1;
    let count = 1;
    while (q.length) {
      const cur = q.pop(), cx = cur % W, cy = (cur - cx) / W;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (seen[ni] || G.COST[terra[ni]] === 0) continue;
        seen[ni] = 1; count++; q.push(ni);
      }
    }
    return { seen, count };
  }
  /* the largest walkable landmass — everything worth placing goes on it.
   * ONE labelling pass over the grid, not a flood-and-copy per component: the old shape was
   * O(components × n) with an allocation per component, which is invisible on a board and the
   * first thing that bites on a country full of lakes. The labels ride out with the answer
   * because "which piece of ground is this" is exactly the question country generation asks
   * when it nudges a city onto the mainland. */
  function mainland(land) {
    const { W, H, terra } = land, n = W * H;
    const label = new Int32Array(n);
    const q = [];
    let next = 0, bestLabel = 0, bestCount = 0;
    for (let i = 0; i < n; i++) {
      if (label[i] || G.COST[terra[i]] === 0) continue;
      const L = ++next;
      let count = 1;
      label[i] = L; q.length = 0; q.push(i);
      while (q.length) {
        const cur = q.pop(), cx = cur % W, cy = (cur - cx) / W;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (label[ni] || G.COST[terra[ni]] === 0) continue;
          label[ni] = L; count++; q.push(ni);
        }
      }
      if (count > bestCount) { bestCount = count; bestLabel = L; }
    }
    const seen = new Uint8Array(n);
    if (bestLabel) for (let i = 0; i < n; i++) if (label[i] === bestLabel) seen[i] = 1;
    return { seen, count: bestCount, label, main: bestLabel };
  }

  /* a Seat or a spring stands on level, open ground whatever the noise said — one
   * implementation for the board and the country, or the two would drift */
  function flatten(land, p, radius) {
    const r = radius || (C.CITY.r + 40), rc = Math.ceil(r / land.cw);
    const gx = Math.floor(p.x / land.cw), gy = Math.floor(p.y / land.cw);
    let sum = 0, k = 0;
    for (let dy = -rc; dy <= rc; dy++) for (let dx = -rc; dx <= rc; dx++) {
      const nx = gx + dx, ny = gy + dy;
      if (nx < 0 || ny < 0 || nx >= land.W || ny >= land.H) continue;
      if (dx * dx + dy * dy > rc * rc) continue;
      sum += land.elev[ny * land.W + nx]; k++;
    }
    const lvl = k ? sum / k : 0.5;
    for (let dy = -rc; dy <= rc; dy++) for (let dx = -rc; dx <= rc; dx++) {
      const nx = gx + dx, ny = gy + dy;
      if (nx < 0 || ny < 0 || nx >= land.W || ny >= land.H) continue;
      if (dx * dx + dy * dy > rc * rc) continue;
      const i = ny * land.W + nx;
      land.elev[i] = lvl; land.terra[i] = T.PLAIN;
    }
  }

  /* ---------------- placing things on the land ---------------- */
  const cellXY = (land, i) => {
    const gx = i % land.W;
    return { x: (gx + 0.5) * land.cw, y: (((i - gx) / land.W) + 0.5) * land.cw };
  };
  /* room to build: how much buildable ground lies within r of a cell */
  function roomAt(land, i, r) {
    const { W, H, cw, terra } = land, gx = i % W, gy = (i - gx) / W, rc = Math.ceil(r / cw);
    let room = 0;
    for (let dy = -rc; dy <= rc; dy++) for (let dx = -rc; dx <= rc; dx++) {
      const nx = gx + dx, ny = gy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (dx * dx + dy * dy > rc * rc) continue;
      if (G.BUILDABLE[terra[ny * W + nx]]) room++;
    }
    return room;
  }

  /* Springs of Shadow, scattered over the whole landmass with a minimum separation so no
   * corner of the world is worth ignoring. */
  function placeNodes(land, reach, rng) {
    const { W, H, cw, terra } = land, n = W * H;
    const cand = [];
    for (let i = 0; i < n; i++)
      if (reach.seen[i] && G.BUILDABLE[terra[i]] && roomAt(land, i, 110) > 24) cand.push(i);
    /* shuffle, then take greedily with a separation rule */
    for (let i = cand.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const t = cand[i]; cand[i] = cand[j]; cand[j] = t;
    }
    const out = [], min2 = C.WORLD.nodeGap * C.WORLD.nodeGap;
    for (const i of cand) {
      if (out.length >= C.WORLD.nodes) break;
      const p = cellXY(land, i);
      let ok = true;
      for (const q of out) if ((p.x - q.x) ** 2 + (p.y - q.y) ** 2 < min2) { ok = false; break; }
      if (ok) out.push(p);
    }
    return out;
  }
  /* high ground worth standing on */
  function placeVantages(land, reach, nodes, rng) {
    const { W, H, terra } = land, n = W * H;
    const cand = [];
    for (let i = 0; i < n; i++) if (reach.seen[i] && terra[i] === T.HILL) cand.push(i);
    for (let i = cand.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const t = cand[i]; cand[i] = cand[j]; cand[j] = t;
    }
    const out = [], min2 = C.WORLD.vantGap * C.WORLD.vantGap;
    for (const i of cand) {
      if (out.length >= C.WORLD.vantages) break;
      const p = cellXY(land, i);
      let ok = true;
      for (const q of out.concat(nodes)) if ((p.x - q.x) ** 2 + (p.y - q.y) ** 2 < min2) { ok = false; break; }
      if (ok) out.push(p);
    }
    return out;
  }

  /* ---------------- choosing the two Seats ----------------
   * This is where fairness lives now. Score many far-apart pairs on what each side has in
   * reach and keep the pair whose two sides differ least. */
  /* ---------------- where a realm's opening Gate stands ----------------
   * Every heir starts with exactly one spring inside his writ and a FINISHED Shadow Gate on
   * it, so any board — noise-grown or hand-built — must be able to say where that Gate goes.
   * Procedural generation asks while it is scoring Seats; a spec asks once the ground is
   * already laid. One implementation for both. `buildableAt(x, y)` is the only part that
   * differs: it is the caller's own land test. */
  G.homeGateOn = function (p, nodes, buildableAt) {
    for (let qi = 0; qi < nodes.length; qi++) {
      const q = nodes[qi];
      const dq = Math.hypot(p.x - q.x, p.y - q.y);
      if (dq < C.WORLD.springNear || dq > C.WORLD.springFar) continue;
      for (let rr = 18; rr <= C.NODE.r - 8; rr += 22)
        for (let a = 0; a < 16; a++) {
          const th = a / 16 * Math.PI * 2;
          const gx = q.x + Math.cos(th) * rr, gy = q.y + Math.sin(th) * rr;
          const ds = Math.hypot(gx - p.x, gy - p.y);
          if (ds <= C.CITY.seatR + C.BUILD.foot || ds >= C.CLAIM.seat) continue;
          if (buildableAt(gx, gy)) return { x: gx, y: gy, node: qi };
        }
    }
    return null;
  };

  function placeCities(land, reach, nodes, rng, want) {
    const { W, H, cw, terra } = land, n = W * H;
    const seats = [];
    for (let i = 0; i < n; i++) {
      if (!reach.seen[i] || !G.BUILDABLE[terra[i]]) continue;
      const p = cellXY(land, i);
      /* inland: there must be world on every side to explore */
      if (p.x < C.WORLD.inland || p.y < C.WORLD.inland ||
          p.x > W * cw - C.WORLD.inland || p.y > H * cw - C.WORLD.inland) continue;
      if (roomAt(land, i, C.CITY.r + 60) < C.WORLD.seatRoom) continue;
      seats.push(i);
    }
    if (seats.length < want) return null;

    const near = (p, r) => {
      let k = 0, r2 = r * r;
      for (const q of nodes) if ((p.x - q.x) ** 2 + (p.y - q.y) ** 2 < r2) k++;
      return k;
    };
    /* A spring inside your writ is only worth having if you can actually RAISE A GATE on it:
     * the Gate must stand within reach of the spring, clear of the Seat's own ground, inside
     * the writ, and on land that bears a work. A spring lying in the castle's lap counts for
     * nothing — you can see it and never use it — so it must not count toward fairness either.
     * Cached per candidate cell: this runs inside the scoring loop. */
    const cellAt = (x, y) => {
      const gx = (x / cw) | 0, gy = (y / cw) | 0;
      if (gx < 0 || gy < 0 || gx >= W || gy >= H) return -1;
      return gy * W + gx;
    };
    const usableCache = new Map();
    const usable = (i, p) => {
      if (usableCache.has(i)) return usableCache.get(i);
      let k = 0;
      for (const q of nodes) {
        const dq = Math.hypot(p.x - q.x, p.y - q.y);
        /* Too close and it is no use: a spring in the castle's lap is cramped ground you can
         * look at and barely build on, and it crowds the court. Too far and it is outside the
         * writ you start with. It has to sit at arm's length. */
        if (dq < C.WORLD.springNear) return (usableCache.set(i, -1), -1);
        if (dq > C.WORLD.springFar) continue;
        let ok = false;
        for (let rr = 18; rr <= C.NODE.r - 8 && !ok; rr += 22)
          for (let a = 0; a < 16 && !ok; a++) {
            const th = a / 16 * Math.PI * 2;
            const gx = q.x + Math.cos(th) * rr, gy = q.y + Math.sin(th) * rr;
            const ds = Math.hypot(gx - p.x, gy - p.y);
            if (ds <= C.CITY.seatR + C.BUILD.foot || ds >= C.CLAIM.seat) continue;
            const ci = cellAt(gx, gy);
            if (ci >= 0 && G.BUILDABLE[terra[ci]]) ok = true;
          }
        if (ok) k++;
      }
      usableCache.set(i, k);
      return k;
    };
    /* Four Seats cannot stand as far apart as two can on the same ground, so what counts as
     * "far enough" scales with how many there are. */
    const apart = C.WORLD.seatApart * (want > 2 ? C.WORLD.seatApartMulti : 1);
    const apart2 = apart * apart;
    /* the three things a Seat is judged on, and the one that disqualifies it outright */
    /* EXACTLY ONE SPRING IN THE STARTING POSITION. Not "at least one": a Seat that opened
     * with two usable springs began the match with twice the economy and twice the masons of
     * one that opened with a single spring, and the fairness score could only ever narrow
     * that, never close it. One each, and the second spring is something you go and take. */
    const traits = (i, p) => {
      const u = usable(i, p);
      /* ONE SPRING IN THE WRIT, not merely one you could gate. A second spring sitting inside
       * your claim that you cannot raise on is not "one spring in the starting position" — it
       * is a spring, in your position, that the writ already covers and a rival cannot take
       * from you. Both counts have to be one. */
      if (u !== 1 || near(p, C.CLAIM.seat) !== 1) return null;
      return [u, near(p, 900), roomAt(land, i, 460)];
    };
    /* the spring that spring IS, and the spot on its ring a Gate can stand on — the same
     * search `usable` runs to count it, kept this time instead of thrown away.
     * The search itself lives at module level (G.homeGateOn) because a board built by HAND
     * has to answer the same question, and two copies of it would drift — with the drift
     * showing up only as a realm that cannot open. */
    placeCities.homeGate = (p) => G.homeGateOn(p, nodes, (x, y) => {
      const ci = cellAt(x, y);
      return ci >= 0 && !!G.BUILDABLE[terra[ci]];
    });
    const spread = (xs) => Math.max(...xs) - Math.min(...xs);
    let best = null;
    for (let tries = 0; tries < 900; tries++) {
      /* Grow a SET greedily from a random first Seat: each next one must stand clear of every
       * Seat already chosen. Scoring whole sets is what makes four of them fair to each other
       * rather than merely fair in pairs. */
      const picked = [], pts = [], fs = [];
      for (let guard = 0; picked.length < want && guard < 220; guard++) {
        const i = seats[Math.floor(rng.next() * seats.length)];
        if (picked.includes(i)) continue;
        const p = cellXY(land, i);
        if (pts.some((q) => (p.x - q.x) ** 2 + (p.y - q.y) ** 2 < apart2)) continue;
        const f = traits(i, p);
        if (!f) continue;
        picked.push(i); pts.push(p); fs.push(f);
      }
      if (picked.length < want) continue;
      /* fairness is the SPREAD across all of them, not the gap between two */
      const skew = spread(fs.map((f) => f[0])) * 3 + spread(fs.map((f) => f[1]))
                 + spread(fs.map((f) => f[2])) / 60;
      let far = Infinity;
      for (let a = 0; a < pts.length; a++)
        for (let b = a + 1; b < pts.length; b++)
          far = Math.min(far, Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y));
      const score = skew * 10 - far / 260;              // fair first, far second
      if (!best || score < best.score) best = { score, seats: picked, pts, skew, far };
    }
    return best;
  }

  /* ---------------- the whole world ---------------- */
  G.build = function (seed, RNG, players, opts) {
    const want = Math.max(2, Math.min(4, players || 2));
    const biome = opts && opts.biome ? opts.biome : null;
    const dims = opts && opts.dims ? opts.dims : null;
    for (let attempt = 0; attempt < 24; attempt++) {
      const s = (seed + attempt * 7919) >>> 0;
      const rng = RNG.make(s);
      const land = G.generate(s, biome, dims);
      const reach = mainland(land);
      if (reach.count < land.W * land.H * C.WORLD.minLand) continue;

      const nodes = placeNodes(land, reach, rng);
      if (nodes.length < C.WORLD.nodesMin) continue;
      const vants = placeVantages(land, reach, nodes, rng);
      const seats = placeCities(land, reach, nodes, rng, want);
      if (!seats || seats.skew > C.WORLD.maxSkew) continue;

      /* sites: the Seats, then springs, then high ground */
      const sites = [];
      const add = (x, y, kind) => {
        sites.push({ id: sites.length, x, y, kind, name: null, lastHurt: -99 });
        return sites.length - 1;
      };
      const nodeSite = [];
      for (const p of seats.pts) add(p.x, p.y, 'city');
      for (const p of nodes) nodeSite.push(add(p.x, p.y, 'node'));
      for (const p of vants) add(p.x, p.y, 'vantage');
      /* EVERY HEIR OPENS WITH A GATE ON HIS OWN SPRING. Worked out here, where the search
       * that proved the spring usable already lives, rather than re-derived in the sim. */
      const homeGates = seats.pts.map((p) => {
        const g = placeCities.homeGate(p);
        return g ? { x: g.x, y: g.y, site: nodeSite[g.node] } : null;
      });

      /* the Seats stand on level, open ground whatever the noise said */
      for (const p of seats.pts) flatten(land, p);
      /* A spring lies in a level hollow. Not decoration: the pool and its ring are drawn as
       * FLAT discs at one height, so on ground that rises 16 units across them the land pokes
       * through and takes a bite out of the water. Level the ground and they sit in it. */
      for (const p of nodes) {
        flatten(land, p, C.WORLD.springLevel);
        const i = Math.floor(p.y / land.cw) * land.W + Math.floor(p.x / land.cw);
        if (!G.BUILDABLE[land.terra[i]]) land.terra[i] = T.PLAIN;
      }

      /* the flattening may have joined or cut things: EVERY Seat must still reach the others */
      const cellOf = (p) => Math.floor(p.y / land.cw) * land.W + Math.floor(p.x / land.cw);
      const fin = floodFrom(land, cellOf(seats.pts[0]));
      if (seats.pts.some((p) => !fin.seen[cellOf(p)])) continue;
      const live = sites.filter((st) => fin.seen[cellOf(st)]);
      if (live.length < sites.length - 2) continue;      // too much stranded: try another world
      const kept = [];
      for (const st of sites) {
        if (st.kind !== 'city' && !fin.seen[cellOf(st)]) continue;
        st.id = kept.length; kept.push(st);
      }

      /* names, drawn without repeats */
      const bags = {};
      for (const k of Object.keys(C.SITE_NAMES)) bags[k] = C.SITE_NAMES[k].slice();
      for (const st of kept) {
        if (st.kind === 'city') continue;
        const bag = bags[st.kind];
        st.name = bag && bag.length
          ? bag.splice(Math.floor(rng.next() * bag.length), 1)[0]
          : (st.kind === 'node' ? 'a Spring of Shadow' : 'a High Place');
      }
      const cityIds = kept.filter((x) => x.kind === 'city').map((x) => x.id);
      cityIds.forEach((id, k) => { kept[id].name = 'the City of ' + C.SEAT_NAMES[k]; });

      return {
        sites: kept, cities: cityIds,
        /* the grid the sim walks on, flat on the object nav.js is handed */
        W: land.W, H: land.H, cw: land.cw, elev: land.elev, terra: land.terra,
        nodes: kept.filter((x) => x.kind === 'node').map((x) => x.id),
        homeGates,
        seed: s, skew: seats.skew, apart: Math.round(seats.far), attempt,
        /* the character of this ground, carried out with it so the renderer, the realm and the
         * chronicle can name a region rather than re-deriving what it was made from */
        biome: biome || null
      };
    }
    return null;
  };

  /* ================= a country is grown =================
   * ONE continuous land with many cities, each owning a REACH — the disc its companies may be
   * ordered inside (see CONST.REACHWAR and nav.js's bounded fields). Generation must answer
   * what a board never asked: which cities can actually GET AT each other. Distance is a lie
   * on a land full of lakes, so neighbourhood is a real bounded search, never geometry. */

  /* the prototype's linkUp question, asked of the raw cost grid (no walls exist at genesis):
   * "can men ordered only inside this disc stand over there?" 8-connected, with buildField's
   * own corner-cut rule, so genesis and the march never disagree about a route */
  function reachFlood(land, fromX, fromY, cx, cy, r2) {
    const { W, H, cw, terra } = land;
    const pass = (i) => G.COST[terra[i]] > 0;
    const inDisc = (gx, gy) => {
      const wx = (gx + 0.5) * cw - cx, wy = (gy + 0.5) * cw - cy;
      return wx * wx + wy * wy <= r2;
    };
    const sgx = Math.floor(fromX / cw), sgy = Math.floor(fromY / cw);
    if (sgx < 0 || sgy < 0 || sgx >= W || sgy >= H) return null;
    const start = sgy * W + sgx;
    if (!pass(start) || !inDisc(sgx, sgy)) return null;
    const seen = new Uint8Array(W * H), q = [start];
    seen[start] = 1;
    while (q.length) {
      const cur = q.pop(), gx = cur % W, gy = (cur - gx) / W;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = gx + dx, ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (seen[ni] || !pass(ni) || !inDisc(nx, ny)) continue;
        if (dx && dy && (!pass(gy * W + nx) || !pass(ny * W + gx))) continue;
        seen[ni] = 1; q.push(ni);
      }
    }
    return seen;
  }

  /* G.buildCountry(seed, RNG, opts) -> a gen in exactly G.build's shape, plus `reaches[]`,
   * `nbrs[][]` and `pattern` (a seat index). Seat order: the PLAYER first — his is the one
   * start held to the board's own fairness bar (one usable writ spring, room, two roads out),
   * far from the Pattern — then the rest far-from-the-Pattern first, the Pattern's own city
   * last. The realm deals contenders from the front of that line and decides who holds AMBER. */
  G.buildCountry = function (seed, RNG, opts) {
    const RW = Object.assign({}, C.REACHWAR, opts || null);
    /* WHY AN ATTEMPT DIED, counted — a generator that rerolls without saying what it was
     * rerolling against cannot be tuned, only guessed at. The suite reads this. */
    const why = G.buildCountry.why = { land: 0, cand: 0, apart: 0, spring: 0, mute: 0,
                                       cut: 0, player: 0, gate: 0, severed: 0, ok: 0 };
    for (let attempt = 0; attempt < 24; attempt++) {
      const s = (seed + attempt * 7919) >>> 0;
      const rng = RNG.make(s);
      const land = G.generate(s, RW.biome || null, RW.dims);
      const main = mainland(land);
      if (main.count < land.W * land.H * C.WORLD.minLand) { why.land++; continue; }
      const { W, H, cw } = land;

      /* ---- candidates by STRATIFIED SAMPLE, room by a summed-area table ----
       * A board could afford to ask every cell (and did); a country cannot — the candidate
       * pass was area-proportional twice over. Four reads answer "how much buildable ground
       * is near here", and a few samples per block keep the list flat in area. */
      const sat = new Int32Array((W + 1) * (H + 1));
      for (let gy = 0; gy < H; gy++) {
        let row = 0;
        for (let gx = 0; gx < W; gx++) {
          row += G.BUILDABLE[land.terra[gy * W + gx]] ? 1 : 0;
          sat[(gy + 1) * (W + 1) + gx + 1] = sat[gy * (W + 1) + gx + 1] + row;
        }
      }
      const boxRoom = (gx, gy, rc) => {
        const x0 = Math.max(0, gx - rc), y0 = Math.max(0, gy - rc);
        const x1 = Math.min(W - 1, gx + rc), y1 = Math.min(H - 1, gy + rc);
        return sat[(y1 + 1) * (W + 1) + x1 + 1] - sat[y0 * (W + 1) + x1 + 1]
             - sat[(y1 + 1) * (W + 1) + x0] + sat[y0 * (W + 1) + x0];
      };
      /* a disc holds pi/4 of its bounding box, so the box owes the disc's due scaled up */
      const seatRc = Math.ceil((C.CITY.r + 60) / cw);
      const needRoom = Math.floor(C.WORLD.seatRoom * 4 / Math.PI);
      const inland = C.WORLD.inland;
      const cand = [];
      const BLOCK = 10;
      for (let by = 0; by < H; by += BLOCK) for (let bx = 0; bx < W; bx += BLOCK) {
        for (let k = 0; k < 3; k++) {
          const gx = bx + Math.floor(rng.next() * Math.min(BLOCK, W - bx));
          const gy = by + Math.floor(rng.next() * Math.min(BLOCK, H - by));
          const i = gy * W + gx;
          if (!main.seen[i] || !G.BUILDABLE[land.terra[i]]) continue;
          const x = (gx + 0.5) * cw, y = (gy + 0.5) * cw;
          if (x < inland || y < inland || x > W * cw - inland || y > H * cw - inland) continue;
          if (boxRoom(gx, gy, seatRc) < needRoom) continue;
          cand.push({ i, x, y });
        }
      }
      if (cand.length < RW.cities * 4) { why.cand++; continue; }

      /* ---- city sites: far apart is a PREFERENCE, connected is a LAW ----
       * The first cut of this picked purely by max-min distance and measured 406 dead
       * attempts across thirty seeds, every one of them at the same gate: the reach graph
       * split into clusters that could not get at each other. So each next city must stand
       * where some already-picked city's reach can PATH to it — one bounded flood per picked
       * city, unioned into a zone — and only inside that zone is "farthest from everybody"
       * asked. Base reach is the yardstick; linkUp still referees the finished set. */
      const baseReach = RW.spacing * RW.reachMul;
      const zone = new Uint8Array(W * H);
      const admit = (p) => {
        const seen = reachFlood(land, p.x, p.y, p.x, p.y, baseReach * baseReach);
        if (seen) for (let i = 0; i < zone.length; i++) if (seen[i]) zone[i] = 1;
      };
      const picked = [];
      const min2 = RW.spacing * RW.spacing;
      picked.push(cand[Math.floor(rng.next() * cand.length)]);
      admit(picked[0]);
      while (picked.length < RW.cities) {
        let best = null, bd = -1;
        for (const q of cand) {
          if (!zone[q.i]) continue;              // nobody's reach can path here: not a city
          let near2 = Infinity;
          for (const p of picked) near2 = Math.min(near2, (q.x - p.x) ** 2 + (q.y - p.y) ** 2);
          if (near2 > bd) { bd = near2; best = q; }
        }
        /* crowding is tolerated before disconnection is: past the floor the land simply
         * holds fewer cities worth the name, and the attempt is rerolled */
        if (!best || bd < min2 * 0.3) break;
        picked.push(best);
        admit(best);
      }
      if (picked.length < RW.cities) { why.apart++; continue; }

      /* ---- springs: one deliberately at each city's arm's length, then a scatter ----
       * The writ spring is the OPENING — every lord's first Gate — placed on the ring
       * `homeGateOn` searches, clear of every other city's writ. The scatter is the map
       * economy the war is fought over. */
      const nodes = [];
      const nodeOk = (x, y) => {
        const gx = Math.floor(x / cw), gy = Math.floor(y / cw);
        if (gx < 0 || gy < 0 || gx >= W || gy >= H) return false;
        const i = gy * W + gx;
        if (!main.seen[i] || !G.BUILDABLE[land.terra[i]]) return false;
        for (const q of nodes)
          if ((x - q.x) ** 2 + (y - q.y) ** 2 < C.WORLD.nodeGap * C.WORLD.nodeGap) return false;
        return true;
      };
      let unsprung = false;
      for (const p of picked) {
        let put = false;
        for (let t = 0; t < 60 && !put; t++) {
          const a = rng.next() * Math.PI * 2;
          const r = C.WORLD.springNear + 40
                  + rng.next() * (C.WORLD.springFar - C.WORLD.springNear - 80);
          const x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
          if (picked.some((q) => q !== p &&
              (x - q.x) ** 2 + (y - q.y) ** 2 < C.CLAIM.seat * C.CLAIM.seat)) continue;
          if (nodeOk(x, y)) { nodes.push({ x, y }); put = true; }
        }
        if (!put) { unsprung = true; break; }
      }
      if (unsprung) { why.spring++; continue; }
      const wantScatter = RW.cities * RW.perCity;
      for (let t = 0; t < wantScatter * 30 && nodes.length < picked.length + wantScatter; t++) {
        const x = rng.next() * W * cw, y = rng.next() * H * cw;
        if (picked.some((q) => (x - q.x) ** 2 + (y - q.y) ** 2 < C.CLAIM.seat * C.CLAIM.seat)) continue;
        if (nodeOk(x, y)) nodes.push({ x, y });
      }
      const vants = placeVantages(land, main, nodes, rng);

      /* ---- courts and springs stand on level ground, the board's own rule ---- */
      for (const p of picked) flatten(land, p);
      for (const p of nodes) {
        flatten(land, p, C.WORLD.springLevel);
        const i = Math.floor(p.y / cw) * W + Math.floor(p.x / cw);
        if (!G.BUILDABLE[land.terra[i]]) land.terra[i] = T.PLAIN;
      }

      /* ---- reaches and the neighbour graph: a REAL search, after the flattening ----
       * Base reach a shade past the spacing; a city whose reach can path to nobody grows it
       * until it can. Run after flatten because levelling ground joins and cuts routes. */
      const reaches = picked.map(() => RW.spacing * RW.reachMul);
      const nbrs = picked.map(() => []);
      const linkUp = () => {
        for (let a = 0; a < picked.length; a++) {
          nbrs[a] = [];
          const seen = reachFlood(land, picked[a].x, picked[a].y,
                                  picked[a].x, picked[a].y, reaches[a] * reaches[a]);
          if (!seen) continue;
          for (let b = 0; b < picked.length; b++) {
            if (b === a) continue;
            const gb = Math.floor(picked[b].y / cw) * W + Math.floor(picked[b].x / cw);
            if ((picked[b].x - picked[a].x) ** 2 + (picked[b].y - picked[a].y) ** 2
                  <= reaches[a] * reaches[a] && seen[gb]) nbrs[a].push(b);
          }
        }
      };
      /* which cities hang together, reading the nbr edges as roads either way */
      const components = () => {
        const comp = new Int32Array(picked.length).fill(-1);
        let n = 0;
        for (let s = 0; s < picked.length; s++) {
          if (comp[s] >= 0) continue;
          const cId = n++;
          const q = [s];
          comp[s] = cId;
          while (q.length) {
            const a = q.pop();
            for (const b of nbrs[a]) if (comp[b] < 0) { comp[b] = cId; q.push(b); }
            for (let b = 0; b < picked.length; b++)
              if (comp[b] < 0 && nbrs[b].includes(a)) { comp[b] = cId; q.push(b); }
          }
        }
        return { comp, n };
      };
      linkUp();
      /* a city with nobody in reach — or a CLUSTER out of everyone else's — commands further
       * until the country is one. The flattening can still cut what placement joined, which
       * is why this backstop exists beside the placement law. */
      for (let pass = 0; pass < RW.growPasses; pass++) {
        const { comp, n } = components();
        if (n === 1 && !nbrs.some((l) => !l.length)) break;
        const size = new Array(n).fill(0);
        for (let a = 0; a < picked.length; a++) size[comp[a]]++;
        const biggest = size.indexOf(Math.max(...size));
        for (let a = 0; a < picked.length; a++)
          if (comp[a] !== biggest || !nbrs[a].length) reaches[a] *= RW.growReach;
        linkUp();
      }
      if (nbrs.some((l) => !l.length)) { why.mute++; continue; }   // a mute city cannot play
      if (components().n !== 1) { why.cut++; continue; }

      /* ---- the Pattern's city is the graph's centre: the endgame converges on it ---- */
      const hops = (from) => {
        const d = new Int32Array(picked.length).fill(-1);
        d[from] = 0;
        const q = [from];
        for (let h = 0; h < q.length; h++) {
          const a = q[h];
          for (const b of nbrs[a]) if (d[b] < 0) { d[b] = d[a] + 1; q.push(b); }
        }
        return d;
      };
      let pattern = 0, bestSum = Infinity;
      for (let a = 0; a < picked.length; a++) {
        const d = hops(a);
        let sum = 0;
        for (let b = 0; b < picked.length; b++) sum += d[b];
        if (sum < bestSum) { bestSum = sum; pattern = a; }
      }

      /* ---- the player's start: the strict bar, far from the Pattern ----
       * Fairness is the PLAYER'S start — lords may be uneven, that is what minors are. His
       * city holds the board's own opening rule (exactly one usable writ spring, a Gate spot
       * on it) and at least two roads out, or the war opens as a siege. */
      const cellAt = (x, y) => {
        const gx = (x / cw) | 0, gy = (y / cw) | 0;
        if (gx < 0 || gy < 0 || gx >= W || gy >= H) return -1;
        return gy * W + gx;
      };
      const buildableAt = (x, y) => {
        const ci = cellAt(x, y);
        return ci >= 0 && !!G.BUILDABLE[land.terra[ci]];
      };
      const patternHops = hops(pattern);
      const order = picked.map((p, i) => i).filter((i) => i !== pattern)
        .sort((a, b) => patternHops[b] - patternHops[a]);
      let player = -1;
      for (const i of order) {
        const p = picked[i];
        const writ = nodes.filter((q) => Math.hypot(p.x - q.x, p.y - q.y) < C.CLAIM.seat);
        if (writ.length !== 1) continue;
        if (nbrs[i].length < 2) continue;
        if (!G.homeGateOn(p, nodes, buildableAt)) continue;
        player = i;
        break;
      }
      if (player < 0) { why.player++; continue; }

      const seatOrder = [player].concat(order.filter((i) => i !== player), [pattern]);

      /* ---- sites in the board's own order: cities, springs, high ground ---- */
      const sites = [];
      const add = (x, y, kind) => {
        sites.push({ id: sites.length, x, y, kind, name: null, lastHurt: -99 });
        return sites.length - 1;
      };
      const nodeSite = [];
      for (const i of seatOrder) add(picked[i].x, picked[i].y, 'city');
      for (const p of nodes) nodeSite.push(add(p.x, p.y, 'node'));
      for (const p of vants) add(p.x, p.y, 'vantage');

      /* every city opens with a Gate on a spring of its own — a lord with no Gate has no
       * economy and no masons, which is a corpse wearing a crown */
      const homeGates = seatOrder.map((i) => {
        const g = G.homeGateOn(picked[i], nodes, buildableAt);
        return g ? { x: g.x, y: g.y, site: nodeSite[g.node] } : null;
      });
      if (homeGates.some((g) => !g)) { why.gate++; continue; }

      /* the post-flatten connectivity check, from the player's own seat */
      const fin = floodFrom(land, cellAt(picked[player].x, picked[player].y));
      let severed = false;
      for (const i of seatOrder) if (!fin.seen[cellAt(picked[i].x, picked[i].y)]) severed = true;
      if (severed) { why.severed++; continue; }
      const kept = [];
      for (const st of sites) {
        if (st.kind !== 'city' && !fin.seen[cellAt(st.x, st.y)]) continue;
        st.id = kept.length;
        kept.push(st);
      }

      /* names: the Pattern's city is AMBER; the rest draw from the war's own bag */
      const bags = {};
      for (const k of Object.keys(C.SITE_NAMES)) bags[k] = C.SITE_NAMES[k].slice();
      for (const st of kept) {
        if (st.kind === 'city') continue;
        const bag = bags[st.kind];
        st.name = bag && bag.length
          ? bag.splice(Math.floor(rng.next() * bag.length), 1)[0]
          : (st.kind === 'node' ? 'a Spring of Shadow' : 'a High Place');
      }
      const cityIds = kept.filter((x) => x.kind === 'city').map((x) => x.id);
      const cityBag = (RW.names || []).slice();
      cityIds.forEach((id, k) => {
        kept[id].name = seatOrder[k] === pattern ? 'AMBER'
          : cityBag.length ? cityBag.splice(Math.floor(rng.next() * cityBag.length), 1)[0]
          : 'a City of Shadow';
      });

      why.ok++;
      return {
        sites: kept, cities: cityIds,
        W, H, cw, elev: land.elev, terra: land.terra,
        nodes: kept.filter((x) => x.kind === 'node').map((x) => x.id),
        homeGates,
        reaches: seatOrder.map((i) => reaches[i]),
        nbrs: seatOrder.map((i) => nbrs[i].map((b) => seatOrder.indexOf(b))),
        pattern: seatOrder.indexOf(pattern),
        seed: s, skew: 0, apart: RW.spacing, attempt,
        biome: RW.biome || null, country: true
      };
    }
    return null;
  };

  /* ================= a board built by hand =================
   * The land is noise by default, and that is right for a duel: a mirrored world tells you
   * where the rival stands. But three things want a board somebody CHOSE — a test that needs
   * a wall in shot, a campaign chapter that has to tell a particular story, and eventually a
   * player who wants to build one. All three need the same thing: a declarative spec that
   * produces EXACTLY what G.build produces, so nothing downstream can tell the difference.
   *
   * VALIDATION IS THE FEATURE, NOT THE BUILDER. Procedural generation quietly guarantees
   * invariants the rest of the game leans on, and a hand-made board breaks them casually:
   * a Seat with no usable spring gives an heir no opening Gate and no mason, and the failure
   * surfaces a long way from its cause. A spec that cannot hold up is REFUSED, by name, with
   * the reason — never half-built.
   *
   * A spec is plain JSON so it can be saved, shared and sent over the wire:
   *   { name, seed, ground:'PLAIN', height:0.5,
   *     paint:[ {rect:[x0,y0,x1,y1], terra:'FOREST'},
   *             {circle:[x,y,r],     terra:'CLIFF', height:0.95} ],
   *     seats:[{x,y},…], springs:[{x,y},…], vantages:[{x,y},…] }
   * Terrain names are the keys of G.T. Paints apply in order, so later ones overwrite. */
  G.SPEC_VERSION = 1;

  G.fromSpec = function (spec, players) {
    const fail = (why) => { const e = new Error('world spec: ' + why); e.spec = true; throw e; };
    if (!spec || typeof spec !== 'object') fail('not an object');
    const want = players || (spec.seats && spec.seats.length) || 2;
    if (!Array.isArray(spec.seats) || spec.seats.length < want)
      fail(`needs ${want} seats, has ${(spec.seats || []).length}`);
    if (!Array.isArray(spec.springs) || !spec.springs.length) fail('needs at least one spring');

    const cw = C.NAV.cell;
    /* a spec may declare its own land size (`map: {W, H}`); without one it is a board */
    const D = (spec.map && spec.map.W && spec.map.H) ? spec.map : C.MAP;
    const W = Math.round(D.W / cw), H = Math.round(D.H / cw), n = W * H;
    const terraOf = (name) => {
      const v = T[String(name || '').toUpperCase()];
      if (v === undefined) fail(`unknown terrain "${name}" (want one of ${Object.keys(T).join(', ')})`);
      return v;
    };
    const base = terraOf(spec.ground || 'PLAIN');
    const elev = new Float32Array(n), terra = new Uint8Array(n);
    elev.fill(typeof spec.height === 'number' ? spec.height : 0.5);
    terra.fill(base);

    /* paints, in order: the later one wins, which is what makes a spec readable top to bottom */
    for (const q of (spec.paint || [])) {
      const t = terraOf(q.terra);
      const hh = typeof q.height === 'number' ? q.height : null;
      const put = (gx, gy) => {
        if (gx < 0 || gy < 0 || gx >= W || gy >= H) return;
        const i = gy * W + gx;
        terra[i] = t;
        if (hh !== null) elev[i] = hh;
      };
      if (q.rect) {
        const [x0, y0, x1, y1] = q.rect;
        for (let gy = Math.floor(Math.min(y0, y1) / cw); gy <= Math.floor(Math.max(y0, y1) / cw); gy++)
          for (let gx = Math.floor(Math.min(x0, x1) / cw); gx <= Math.floor(Math.max(x0, x1) / cw); gx++) put(gx, gy);
      } else if (q.circle) {
        const [cx, cy, r] = q.circle, r2 = r * r;
        for (let gy = Math.floor((cy - r) / cw); gy <= Math.floor((cy + r) / cw); gy++)
          for (let gx = Math.floor((cx - r) / cw); gx <= Math.floor((cx + r) / cw); gx++) {
            const wx = (gx + 0.5) * cw - cx, wy = (gy + 0.5) * cw - cy;
            if (wx * wx + wy * wy <= r2) put(gx, gy);
          }
      } else fail('a paint needs a rect or a circle');
    }

    const land = { W, H, cw, elev, terra };
    const idx = (x, y) => {
      const gx = Math.floor(x / cw), gy = Math.floor(y / cw);
      return (gx < 0 || gy < 0 || gx >= W || gy >= H) ? -1 : gy * W + gx;
    };
    const buildableAt = (x, y) => { const i = idx(x, y); return i >= 0 && !!G.BUILDABLE[terra[i]]; };

    /* the sites, springs first so their ids are stable and readable in a saved spec */
    const sites = [];
    const push = (kind, p) => {
      if (typeof p.x !== 'number' || typeof p.y !== 'number') fail(`a ${kind} has no x,y`);
      if (p.x < 0 || p.y < 0 || p.x > W * cw || p.y > H * cw) fail(`a ${kind} lies off the map at ${p.x | 0},${p.y | 0}`);
      sites.push({ id: sites.length, kind, x: p.x, y: p.y, lastHurt: -99 });
      return sites[sites.length - 1];
    };
    for (const q of spec.springs) push('node', q);
    for (const q of (spec.vantages || [])) push('vantage', q);
    const cityIds = [];
    for (let k = 0; k < want; k++) cityIds.push(push('city', spec.seats[k]).id);
    const nodeIds = sites.filter((x) => x.kind === 'node').map((x) => x.id);
    const nodes = nodeIds.map((i) => sites[i]);

    /* ---- the invariants a board has to hold up, each refused by name ---- */
    const reach = mainland(land);
    for (const st of sites) {
      const i = idx(st.x, st.y);
      if (i < 0) fail(`${st.kind} ${st.id} is off the grid`);
      if (st.kind === 'city' && !G.BUILDABLE[terra[i]])
        fail(`seat ${cityIds.indexOf(st.id)} stands on ground no one can build on`);
      if (reach && !reach.seen[i])
        fail(`${st.kind} ${st.id} at ${st.x | 0},${st.y | 0} is cut off from the mainland`);
    }
    const apart = C.WORLD.seatApart * (want > 2 ? C.WORLD.seatApartMulti : 1);
    for (let a = 0; a < cityIds.length; a++)
      for (let b = a + 1; b < cityIds.length; b++) {
        const p = sites[cityIds[a]], q = sites[cityIds[b]];
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < apart * 0.95) fail(`seats ${a} and ${b} are ${d | 0} apart, want ${apart | 0}`);
      }
    /* EXACTLY ONE SPRING IN THE WRIT — the rule the opening rests on. Not "at least one": two
     * springs inside a claim is twice the economy and twice the masons before a shot is fired,
     * and no amount of scoring elsewhere closes that. */
    const homeGates = [];
    for (let k = 0; k < cityIds.length; k++) {
      const p = sites[cityIds[k]];
      const inWrit = nodes.filter((q) => Math.hypot(p.x - q.x, p.y - q.y) < C.CLAIM.seat).length;
      if (inWrit !== 1) fail(`seat ${k} has ${inWrit} springs inside its writ, wants exactly 1`);
      const g = G.homeGateOn(p, nodes, buildableAt);
      if (!g) fail(`seat ${k} has no buildable spot for its opening Gate on its spring's ring`);
      homeGates.push(g);
    }

    /* names, so a hand-built board reads like the game rather than like a test fixture */
    const bags = {};
    for (const k of Object.keys(C.SITE_NAMES)) bags[k] = C.SITE_NAMES[k].slice();
    let nameSeed = (spec.seed >>> 0) || 1;
    const pick = (bag) => {
      nameSeed = (nameSeed * 1103515245 + 12345) >>> 0;   // named without an RNG in hand
      return bag.splice(nameSeed % bag.length, 1)[0];
    };
    for (const st of sites) {
      if (st.kind === 'city') continue;
      const bag = bags[st.kind];
      st.name = (bag && bag.length) ? pick(bag)
        : (st.kind === 'node' ? 'a Spring of Shadow' : 'a High Place');
    }
    cityIds.forEach((id, k) => { sites[id].name = 'the City of ' + C.SEAT_NAMES[k]; });

    return {
      sites, cities: cityIds, nodes: nodeIds,
      W, H, cw, elev, terra,
      homeGates,
      seed: (spec.seed >>> 0) || 1, skew: 0,
      apart: Math.round(cityIds.length > 1
        ? Math.hypot(sites[cityIds[0]].x - sites[cityIds[1]].x, sites[cityIds[0]].y - sites[cityIds[1]].y) : 0),
      attempt: 0, spec: spec.name || 'unnamed'
    };
  };

  global.WorldGen = G;
  if (typeof module !== 'undefined' && module.exports) module.exports = G;
})(typeof window !== 'undefined' ? window : globalThis);

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

  G.generate = function (seed) {
    const N = C.WORLD, cw = C.NAV.cell;
    const W = Math.round(C.MAP.W / cw), H = Math.round(C.MAP.H / cw), n = W * H;
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
  /* the largest walkable landmass — everything worth placing goes on it */
  function mainland(land) {
    const { W, H, terra } = land, n = W * H;
    let best = null;
    const done = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (done[i] || G.COST[terra[i]] === 0) continue;
      const r = floodFrom(land, i);
      for (let k = 0; k < n; k++) if (r.seen[k]) done[k] = 1;
      if (!best || r.count > best.count) best = r;
    }
    return best || { seen: new Uint8Array(n), count: 0 };
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
  function placeCities(land, reach, nodes, rng) {
    const { W, H, cw, terra } = land, n = W * H;
    const seats = [];
    for (let i = 0; i < n; i++) {
      if (!reach.seen[i] || !G.BUILDABLE[terra[i]]) continue;
      const p = cellXY(land, i);
      /* inland: there must be world on every side to explore */
      if (p.x < C.WORLD.inland || p.y < C.WORLD.inland ||
          p.x > C.MAP.W - C.WORLD.inland || p.y > C.MAP.H - C.WORLD.inland) continue;
      if (roomAt(land, i, C.CITY.r + 60) < C.WORLD.seatRoom) continue;
      seats.push(i);
    }
    if (seats.length < 2) return null;

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
    const want2 = C.WORLD.seatApart * C.WORLD.seatApart;
    let best = null;
    for (let tries = 0; tries < 900; tries++) {
      const a = seats[Math.floor(rng.next() * seats.length)];
      const b = seats[Math.floor(rng.next() * seats.length)];
      if (a === b) continue;
      const pa = cellXY(land, a), pb = cellXY(land, b);
      const d2 = (pa.x - pb.x) ** 2 + (pa.y - pb.y) ** 2;
      if (d2 < want2) continue;
      /* what each Seat actually has: springs close, springs at arm's length, room to build */
      const fa = [usable(a, pa), near(pa, 900), roomAt(land, a, 460)];
      const fb = [usable(b, pb), near(pb, 900), roomAt(land, b, 460)];
      /* a Seat with no spring it can actually DRAW ON is dead, however many it can see */
      /* -1 means a spring sits right on top of that Seat — reject the pair outright */
      if (fa[0] < 1 || fb[0] < 1) continue;
      const skew = Math.abs(fa[0] - fb[0]) * 3 + Math.abs(fa[1] - fb[1])
                 + Math.abs(fa[2] - fb[2]) / 60;
      const far = Math.sqrt(d2);
      const score = skew * 10 - far / 260;              // fair first, far second
      if (!best || score < best.score) best = { score, a, b, pa, pb, skew, far };
    }
    return best;
  }

  /* ---------------- the whole world ---------------- */
  G.build = function (seed, RNG) {
    for (let attempt = 0; attempt < 24; attempt++) {
      const s = (seed + attempt * 7919) >>> 0;
      const rng = RNG.make(s);
      const land = G.generate(s);
      const reach = mainland(land);
      if (reach.count < land.W * land.H * C.WORLD.minLand) continue;

      const nodes = placeNodes(land, reach, rng);
      if (nodes.length < C.WORLD.nodesMin) continue;
      const vants = placeVantages(land, reach, nodes, rng);
      const seats = placeCities(land, reach, nodes, rng);
      if (!seats || seats.skew > C.WORLD.maxSkew) continue;

      /* sites: the two Seats, then springs, then high ground */
      const sites = [];
      const add = (x, y, kind) => {
        sites.push({ id: sites.length, x, y, kind, name: null, lastHurt: -99 });
        return sites.length - 1;
      };
      const c0 = add(seats.pa.x, seats.pa.y, 'city');
      const c1 = add(seats.pb.x, seats.pb.y, 'city');
      for (const p of nodes) add(p.x, p.y, 'node');
      for (const p of vants) add(p.x, p.y, 'vantage');

      /* the Seats stand on level, open ground whatever the noise said */
      const flatten = (p) => {
        const r = C.CITY.r + 40, rc = Math.ceil(r / land.cw);
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
      };
      flatten(seats.pa); flatten(seats.pb);
      /* and a spring must be standable, not a rock */
      for (const p of nodes) {
        const i = Math.floor(p.y / land.cw) * land.W + Math.floor(p.x / land.cw);
        if (!G.BUILDABLE[land.terra[i]]) land.terra[i] = T.PLAIN;
      }

      /* the flattening may have joined or cut things: the Seats must still reach each other */
      const startA = Math.floor(seats.pa.y / land.cw) * land.W + Math.floor(seats.pa.x / land.cw);
      const fin = floodFrom(land, startA);
      const cellOf = (p) => Math.floor(p.y / land.cw) * land.W + Math.floor(p.x / land.cw);
      if (!fin.seen[cellOf(seats.pb)]) continue;
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
      kept[cityIds[0]].name = 'the City of Corwin';
      kept[cityIds[1]].name = 'the City of Eric';

      return {
        sites: kept, cities: cityIds,
        /* the grid the sim walks on, flat on the object nav.js is handed */
        W: land.W, H: land.H, cw: land.cw, elev: land.elev, terra: land.terra,
        nodes: kept.filter((x) => x.kind === 'node').map((x) => x.id),
        seed: s, skew: seats.skew, apart: Math.round(seats.far), attempt
      };
    }
    return null;
  };

  global.WorldGen = G;
  if (typeof module !== 'undefined' && module.exports) module.exports = G;
})(typeof window !== 'undefined' ? window : globalThis);

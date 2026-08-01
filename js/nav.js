/* nav.js — the movement layer (open world, stage 2). Headless-safe: no DOM, no Date.
 *
 * Units no longer hop from site to site. They move continuously over a cost grid, steered
 * by a flow field built per (goal, owner). The site web is still what shapes the world —
 * it is baked into the grid as CORRIDORS: cheap along the paths, expensive at their edges,
 * impassable beyond. Stage 3 swaps that synthetic cost for real terrain and nothing above
 * this layer has to change.
 *
 * Fields are Dijkstra distance maps from the goal cell outward; a unit steers at whichever
 * neighbouring cell is closer to the goal than the one it stands in. They are cached by
 * (owner, goal cell) and thrown away whenever the blocking picture changes — that is what
 * world.navVersion counts.
 */
(function (global) {
  'use strict';

  const C = global.CONST || (typeof require !== 'undefined' ? require('./const.js') : null);
  const NAV = {};

  /* squared distance from a point to a segment */
  function segD2(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay;
    const L = vx * vx + vy * vy;
    let t = L > 0 ? ((px - ax) * vx + (py - ay) * vy) / L : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = px - (ax + vx * t), dy = py - (ay + vy * t);
    return dx * dx + dy * dy;
  }

  /* ---------------- the world's shape ----------------
   * A path is a quadratic bend, and its control offset lives on the map so terrain, nav and
   * both renderers all sample the SAME curve. */
  NAV.curveOf = function (map, ei) {
    const [ai, bi] = map.edges[ei], A = map.sites[ai], B = map.sites[bi];
    const c = map.curves[ei];
    return { ax: A.x, ay: A.y, bx: B.x, by: B.y,
             mx: (A.x + B.x) / 2 + c.jx, my: (A.y + B.y) / 2 + c.jy };
  };
  NAV.curvePts = function (e, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      pts.push([u * u * e.ax + 2 * u * t * e.mx + t * t * e.bx,
                u * u * e.ay + 2 * u * t * e.my + t * t * e.by]);
    }
    return pts;
  };

  /* hash value-noise: deterministic, seedable, no allocation */
  function vnoise(seed, x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const at = (a, b) => {
      let h = (a * 374761393 + b * 668265263 + seed * 1274126177) | 0;
      h = (h ^ (h >>> 13)) * 1274126177 | 0;
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi), b = at(xi + 1, yi), c2 = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return (a + (b - a) * sx) + ((c2 + (d - c2) * sx) - (a + (b - a) * sx)) * sy;
  }
  function fbm(seed, x, y) {
    return vnoise(seed, x, y) * 0.6 + vnoise(seed + 101, x * 2.1, y * 2.1) * 0.3
         + vnoise(seed + 202, x * 4.3, y * 4.3) * 0.1;
  }

  /* terrain classes — the sim's truth AND what the renderers draw */
  NAV.T = { ROAD: 1, OPEN: 2, FOREST: 3, ROCK: 4, WATER: 5 };
  const T = NAV.T;
  const T_COST = { 1: 1, 2: 2, 3: 4, 4: 0, 5: 0 };

  /* ---------------- the terrain grid ----------------
   * Distance to the nearest path or site decides the character of the ground: the roads and
   * their shoulders are open, the near country is wood, and the far country closes to rock
   * and water. Corridors are not authored — they are what is left between the wilds.
   * Everything is built for one half of the board and point-mirrored onto the other, so the
   * two seats face an identical world. */
  NAV.build = function (map, seed) {
    const N = C.NAV, cw = N.cell;
    const W = Math.ceil(C.MAP.W / cw), H = Math.ceil(C.MAP.H / cw);
    const n = W * H;
    const terra = new Uint8Array(n), cost = new Uint8Array(n);
    const sd = (seed >>> 0) || 1;

    /* distance from every cell to the nearest path curve or site */
    const near = new Float32Array(n).fill(Infinity);
    const polys = [];
    for (let ei = 0; ei < map.edges.length; ei++) polys.push(NAV.curvePts(NAV.curveOf(map, ei), 24));
    for (let gy = 0; gy < H; gy++) {
      for (let gx = 0; gx < W; gx++) {
        const px = (gx + 0.5) * cw, py = (gy + 0.5) * cw;
        let best = Infinity;
        for (const pts of polys)
          for (let i = 1; i < pts.length; i++) {
            const d = segD2(px, py, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
            if (d < best) best = d;
          }
        best = Math.sqrt(best);
        for (const s of map.sites) {
          const r = s.kind === 'city' ? C.CITY.r + 24 : N.siteR;
          const dx = px - s.x, dy = py - s.y;
          const d = Math.max(0, Math.sqrt(dx * dx + dy * dy) - r);
          if (d < best) best = d;
        }
        near[gy * W + gx] = best;
      }
    }

    /* classify the first half; the second half is its mirror, cell for cell */
    for (let i = 0; i < n; i++) {
      const mi = n - 1 - i;               // point-mirror: (gx,gy) -> (W-1-gx, H-1-gy)
      if (mi < i) continue;               // done when its twin was classified
      const gx = i % W, gy = (i - gx) / W;
      const d = near[i];
      let t;
      if (d <= N.roadR) t = T.ROAD;
      else {
        const nz = fbm(sd, gx * N.noiseF, gy * N.noiseF);
        /* the further from any way through, the more the country closes */
        const wild = Math.min(1, Math.max(0, (d - N.roadR) / (N.wildR - N.roadR)));
        const solid = nz * 0.75 + wild * 0.85;
        if (solid > N.rockAt) t = fbm(sd + 909, gx * 0.21, gy * 0.21) > 0.55 ? T.ROCK : T.WATER;
        else if (solid > N.forestAt) t = T.FOREST;
        else t = T.OPEN;
      }
      terra[i] = t; terra[mi] = t;
    }

    /* the ground a city stands on is always its own */
    for (const ci of map.cities) {
      const cs = map.sites[ci], r = C.CITY.r + 30;
      for (let gy = Math.max(0, Math.floor((cs.y - r) / cw)); gy <= Math.min(H - 1, Math.floor((cs.y + r) / cw)); gy++)
        for (let gx = Math.max(0, Math.floor((cs.x - r) / cw)); gx <= Math.min(W - 1, Math.floor((cs.x + r) / cw)); gx++) {
          const dx = (gx + 0.5) * cw - cs.x, dy = (gy + 0.5) * cw - cs.y;
          if (dx * dx + dy * dy <= r * r) terra[gy * W + gx] = T.ROAD;
        }
    }
    for (let i = 0; i < n; i++) cost[i] = T_COST[terra[i]];
    return { cw, W, H, terra, cost, near, fields: new Map(), masks: null, maskVer: -1 };
  };

  /* every site must be standable and every site reachable from every other — asserted at
   * world creation, because a map that strands a spring is a map nobody can play */
  NAV.audit = function (nav, map) {
    const seen = new Uint8Array(nav.W * nav.H);
    const start = NAV.cellOf(nav, map.sites[map.cities[0]].x, map.sites[map.cities[0]].y);
    const q = [start]; seen[start] = 1;
    while (q.length) {
      const cur = q.pop(), cx = cur % nav.W, cy = (cur - cx) / nav.W;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= nav.W || ny >= nav.H) continue;
        const ni = ny * nav.W + nx;
        if (seen[ni] || nav.cost[ni] === 0) continue;
        seen[ni] = 1; q.push(ni);
      }
    }
    const stranded = [];
    for (const s of map.sites) {
      const c = NAV.cellOf(nav, s.x, s.y);
      if (c < 0 || !seen[c]) stranded.push(s.key);
    }
    return stranded;
  };

  NAV.cellOf = function (nav, x, y) {
    const cx = Math.floor(x / nav.cw), cy = Math.floor(y / nav.cw);
    if (cx < 0 || cy < 0 || cx >= nav.W || cy >= nav.H) return -1;
    return cy * nav.W + cx;
  };

  /* ---------------- blockers: an enemy rampart seals its site ---------------- */
  function masksFor(nav, world) {
    if (nav.maskVer === world.navVersion) return nav.masks;
    const n = nav.W * nav.H, cw = nav.cw;
    const m = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)];
    const r = C.NAV.rampartR, r2 = r * r;
    for (const s of world.map.sites) {
      if (!s.post || s.post.bt !== 'rampart' || s.owner < 0) continue;
      const gx0 = Math.max(0, Math.floor((s.x - r) / cw)), gx1 = Math.min(nav.W - 1, Math.floor((s.x + r) / cw));
      const gy0 = Math.max(0, Math.floor((s.y - r) / cw)), gy1 = Math.min(nav.H - 1, Math.floor((s.y + r) / cw));
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const dx = (gx + 0.5) * cw - s.x, dy = (gy + 0.5) * cw - s.y;
          if (dx * dx + dy * dy > r2) continue;
          for (let o = 0; o < 3; o++) if (o !== s.owner) m[o][gy * nav.W + gx] = 1;
        }
      }
    }
    nav.masks = m; nav.maskVer = world.navVersion;
    nav.fields.clear();   // every field was drawn against the old walls
    return m;
  }

  /* ---------------- flow fields (Dijkstra out from the goal) ---------------- */
  const SQ2 = Math.SQRT2;
  function buildField(nav, world, owner, goal) {
    const W = nav.W, H = nav.H, n = W * H, cost = nav.cost, mask = masksFor(nav, world)[owner];
    const dist = new Float32Array(n).fill(Infinity);
    /* binary heap of cell indices keyed by tentative distance */
    const hi = new Int32Array(n + 1), hd = new Float32Array(n + 1);
    let hn = 0;
    const push = (i, d) => {
      let k = ++hn; hi[k] = i; hd[k] = d;
      while (k > 1) { const p = k >> 1; if (hd[p] <= hd[k]) break;
        const ti = hi[p], td = hd[p]; hi[p] = hi[k]; hd[p] = hd[k]; hi[k] = ti; hd[k] = td; k = p; }
    };
    const pop = () => {
      const top = hi[1];
      hi[1] = hi[hn]; hd[1] = hd[hn]; hn--;
      let k = 1;
      for (;;) {
        const l = k << 1, r = l + 1; let s = k;
        if (l <= hn && hd[l] < hd[s]) s = l;
        if (r <= hn && hd[r] < hd[s]) s = r;
        if (s === k) break;
        const ti = hi[s], td = hd[s]; hi[s] = hi[k]; hd[s] = hd[k]; hi[k] = ti; hd[k] = td; k = s;
      }
      return top;
    };
    dist[goal] = 0; push(goal, 0);
    while (hn > 0) {
      const cur = pop(), cd = dist[cur];
      const cx = cur % W, cy = (cur - cx) / W;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = cy + dy;
        if (ny < 0 || ny >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx;
          if (nx < 0 || nx >= W) continue;
          const ni = ny * W + nx, cc = cost[ni];
          if (cc === 0 || mask[ni]) continue;                       // rock, or a wall not yours
          if (dx && dy) {                                           // no cutting a blocked corner
            if (cost[cy * W + nx] === 0 || cost[ny * W + cx] === 0) continue;
          }
          const nd = cd + cc * (dx && dy ? SQ2 : 1);
          if (nd < dist[ni]) { dist[ni] = nd; push(ni, nd); }
        }
      }
    }
    return dist;
  }

  function fieldFor(nav, world, owner, goal) {
    masksFor(nav, world);   // FIRST: a new wall drops every field drawn against the old ones
    const key = owner * 1e7 + goal;
    let f = nav.fields.get(key);
    if (f) return f;
    if (nav.fields.size >= C.NAV.cacheMax) nav.fields.clear();
    f = buildField(nav, world, owner, goal);
    nav.fields.set(key, f);
    return f;
  }

  /* ---------------- steering ----------------
   * Returns a unit vector toward the neighbouring cell nearest the goal, or null when the
   * goal cannot be reached from here (walled off — the caller decides what to besiege). */
  NAV.steer = function (nav, world, owner, gxw, gyw, x, y) {
    const goal = NAV.cellOf(nav, gxw, gyw);
    if (goal < 0) return null;
    const here = NAV.cellOf(nav, x, y);
    if (here < 0) return null;
    const W = nav.W, H = nav.H, f = fieldFor(nav, world, owner, goal);
    const cx = here % W, cy = (here - cx) / W;
    let bd = f[here], bi = -1;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = cy + dy;
      if (ny < 0 || ny >= H) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        if (nx < 0 || nx >= W) continue;
        const ni = ny * W + nx;
        if (f[ni] < bd) { bd = f[ni]; bi = ni; }
      }
    }
    if (bi < 0) return null;
    const bx = bi % W, by = (bi - bx) / W;
    const tx = (bx + 0.5) * nav.cw - x, ty = (by + 0.5) * nav.cw - y;
    const L = Math.sqrt(tx * tx + ty * ty) || 1;
    return { x: tx / L, y: ty / L };
  };

  global.NAV = NAV;
  if (typeof module !== 'undefined' && module.exports) module.exports = NAV;
})(typeof window !== 'undefined' ? window : globalThis);

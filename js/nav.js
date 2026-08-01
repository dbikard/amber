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

  const WG = global.WorldGen || (typeof require !== 'undefined' ? require('./worldgen.js') : null);
  NAV.T = WG.T;

  /* ---------------- the cost grid ----------------
   * Land decides the base cost; CLIMBING is charged on top, so a pass through the hills is
   * cheaper than the ridge beside it and armies find the saddle on their own. Descending is
   * free — you may always fall downhill. */
  NAV.build = function (gen) {
    const n = gen.W * gen.H, cost = new Uint8Array(n);
    for (let i = 0; i < n; i++) cost[i] = WG.COST[gen.terra[i]] || 0;
    return { cw: gen.cw, W: gen.W, H: gen.H, terra: gen.terra, elev: gen.elev, cost,
             fields: new Map(), masks: null, maskVer: -1 };
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
    for (let pi = 0; pi < 2; pi++) {
      for (const b of world.players[pi].buildings) {
        if (b.bt !== 'rampart') continue;
        const gx0 = Math.max(0, Math.floor((b.x - r) / cw)), gx1 = Math.min(nav.W - 1, Math.floor((b.x + r) / cw));
        const gy0 = Math.max(0, Math.floor((b.y - r) / cw)), gy1 = Math.min(nav.H - 1, Math.floor((b.y + r) / cw));
        for (let gy = gy0; gy <= gy1; gy++) {
          for (let gx = gx0; gx <= gx1; gx++) {
            const dx = (gx + 0.5) * cw - b.x, dy = (gy + 0.5) * cw - b.y;
            if (dx * dx + dy * dy > r2) continue;
            for (let o = 0; o < 3; o++) if (o !== pi) m[o][gy * nav.W + gx] = 1;
          }
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
    const elev = nav.elev;
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
          const climb = Math.max(0, elev[ni] - elev[cur]) * C.NAV.slope;
          const nd = cd + (cc + climb) * (dx && dy ? SQ2 : 1);
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

  /* every site must be standable and reachable from the Seat — asserted at world creation */
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
      if (c < 0 || !seen[c]) stranded.push(s.name || s.kind);
    }
    return stranded;
  };

  global.NAV = NAV;
  if (typeof module !== 'undefined' && module.exports) module.exports = NAV;
})(typeof window !== 'undefined' ? window : globalThis);

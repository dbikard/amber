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
             sdf: bakeSDF(gen.W, gen.H, gen.cw, cost),
             fields: new Map(), masks: null, maskVer: -1 };
  };

  /* ---------------- the ground as a FIELD, not a yes/no ----------------
   * `cost[cell] > 0` answers "may a man stand here" one cell at a time, and every consumer
   * of that answer had to invent its own geometry around it: the step rule slid along the
   * AXES (stair-stepping down a diagonal bank), the crowd flatly refused pushes near water,
   * and a man somehow IN a lake needed his own escape hatch because a binary test has no
   * opinion about which way out is shortest. A signed distance settles all of it with one
   * number and one direction: how far to the nearest impassable ground (negative when you
   * are standing in it), and which way it lies. Baked once — terrain never changes within a
   * match; walls are the MASKS' business, not the ground's.
   * Two chamfer transforms (forward+backward raster sweeps, orth cw / diag cw·√2): distance
   * to the nearest cost-0 cell from outside, distance to the nearest standable cell from
   * inside, and the signed field is the first minus the second. Center-to-center distances
   * put the zero isoline on the shared cell boundary, which is where the waterline is. */
  function chamfer(W, H, cw, isSrc) {
    const INF = 1e9, d = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) d[i] = isSrc(i) ? 0 : INF;
    const orth = cw, diag = cw * Math.SQRT2;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; let v = d[i];
      if (x > 0 && d[i - 1] + orth < v) v = d[i - 1] + orth;
      if (y > 0) {
        if (d[i - W] + orth < v) v = d[i - W] + orth;
        if (x > 0 && d[i - W - 1] + diag < v) v = d[i - W - 1] + diag;
        if (x < W - 1 && d[i - W + 1] + diag < v) v = d[i - W + 1] + diag;
      }
      d[i] = v;
    }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x; let v = d[i];
      if (x < W - 1 && d[i + 1] + orth < v) v = d[i + 1] + orth;
      if (y < H - 1) {
        if (d[i + W] + orth < v) v = d[i + W] + orth;
        if (x < W - 1 && d[i + W + 1] + diag < v) v = d[i + W + 1] + diag;
        if (x > 0 && d[i + W - 1] + diag < v) v = d[i + W - 1] + diag;
      }
      d[i] = v;
    }
    return d;
  }
  function bakeSDF(W, H, cw, cost) {
    const toBad = chamfer(W, H, cw, (i) => cost[i] === 0);
    const toGood = chamfer(W, H, cw, (i) => cost[i] > 0);
    const s = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) s[i] = cost[i] > 0 ? toBad[i] : -toGood[i];
    return s;
  }
  /* Signed distance to impassable ground at a POINT — bilinear over the baked field, so the
   * isolines are smooth and the gradient is continuous along a bank instead of jumping cell
   * to cell — plus the edge of the world, which is impassable ground worldgen never wrote
   * down. The edge term is analytic (its gradient is the inward axis), and whichever of the
   * two is nearer supplies both the distance and the way out. Returns {d, gx, gy} with
   * (gx,gy) pointing toward MORE ground, unnormalised (≈ unit length from the bilinear). */
  NAV.ground = function (nav, x, y) {
    const cw = nav.cw, W = nav.W, H = nav.H, s = nav.sdf;
    const fx = x / cw - 0.5, fy = y / cw - 0.5;
    let cx = Math.floor(fx), cy = Math.floor(fy);
    const tx = fx - cx, ty = fy - cy;
    const X0 = cx < 0 ? 0 : (cx >= W ? W - 1 : cx), X1 = cx + 1 < 0 ? 0 : (cx + 1 >= W ? W - 1 : cx + 1);
    const Y0 = cy < 0 ? 0 : (cy >= H ? H - 1 : cy), Y1 = cy + 1 < 0 ? 0 : (cy + 1 >= H ? H - 1 : cy + 1);
    const s00 = s[Y0 * W + X0], s10 = s[Y0 * W + X1], s01 = s[Y1 * W + X0], s11 = s[Y1 * W + X1];
    let d = s00 * (1 - tx) * (1 - ty) + s10 * tx * (1 - ty) + s01 * (1 - tx) * ty + s11 * tx * ty;
    let gx = ((s10 - s00) * (1 - ty) + (s11 - s01) * ty) / cw;
    let gy = ((s01 - s00) * (1 - tx) + (s11 - s10) * tx) / cw;
    /* the world's edge: nearer than any water, it is the wall that is always there */
    const bw = W * cw, bh = H * cw;
    const ex = Math.min(x, bw - x), ey = Math.min(y, bh - y);
    const e = Math.min(ex, ey);
    if (e < d) {
      d = e;
      if (ex <= ey) { gx = x < bw - x ? 1 : -1; gy = 0; }
      else { gx = 0; gy = y < bh - y ? 1 : -1; }
    }
    return { d, gx, gy };
  };

  NAV.cellOf = function (nav, x, y) {
    const cx = Math.floor(x / nav.cw), cy = Math.floor(y / nav.cw);
    if (cx < 0 || cy < 0 || cx >= nav.W || cy >= nav.H) return -1;
    return cy * nav.W + cx;
  };

  /* ---------------- blockers ----------------
   * Nothing a player builds bars a path today — walls come back with the piece-by-piece
   * implementation. The mask survives as an empty layer so the field cache, the version
   * counter and every caller keep their shape for that work.
   * One layer per player, plus one for Chaos, which has no seat and no index of its own. */
  function masksFor(nav, world) {
    if (nav.maskVer === world.navVersion) return nav.masks;
    const n = nav.W * nav.H;
    nav.masks = [];
    /* TWO LAYERS PER HEIR, NOT ONE PER COMPANY. A garrison walking its own curtain must not
     * treat its own gateways as a short cut (see `world.js`), and the mask that says so depends
     * on nothing but the OWNER and one bit — gates open, or gates solid. Every company and every
     * man of that heir shares the same two. So the table is doubled: `masks[i]` is the old
     * layer, `masks[i + span]` the same ground with the gateways stone. A layer is 12 KB, they
     * are rebuilt only when the standing set changes, and the second one costs almost no FIELDS
     * — the only cost measured in Dijkstras — because a posted man's doorsteps are goals nobody
     * else steers at. */
    const span = world.players.length + 1;
    for (let i = 0; i < span * 2; i++) nav.masks.push(new Uint8Array(n));
    nav.maskVer = world.navVersion;
    nav.fields.clear();
    /* A CURTAIN WALL BARS THE GROUND — to everyone but the heir who raised it. Each finished
     * wall is stamped into every OTHER layer, Chaos's included, so a rival army must break it
     * or go round while the owner's own columns pass freely. This is the layer the removal
     * commit kept empty for exactly this. */
    const W = nav.W, H = nav.H, cw = nav.cw;
    const t = C.WALL.thick, rc = Math.ceil(t / cw);
    /* A WALL BARS ITS OWNER TOO, EXCEPT AT HIS GATE. Leaving the owner's layer clear meant
     * his columns walked through their own curtain as though it were paint — and then the
     * shove pushed them back, so they ground against it forever. The run is stamped into
     * EVERY layer; the owner's alone gets a hole punched at the gateway, and his flow fields
     * find it on their own. */
    const gateR = C.WALL.gate;
    for (const w of world.walls || []) {
      const len = Math.hypot(w.bx - w.ax, w.by - w.ay);
      const steps = Math.max(2, Math.ceil(len / (cw * 0.5)));
      for (let s = 0; s <= steps; s++) {
        const f = s / steps, px = w.ax + (w.bx - w.ax) * f, py = w.ay + (w.by - w.ay) * f;
        /* a run too short to spare the stone has no gateway at all — solid to everyone,
         * its owner included. See WALL.gateMin. */
        const atGate = w.gate &&
          (px - w.gx) * (px - w.gx) + (py - w.gy) * (py - w.gy) < gateR * gateR;
        const gx = Math.floor(px / cw), gy = Math.floor(py / cw);
        for (let dy = -rc; dy <= rc; dy++) for (let dx = -rc; dx <= rc; dx++) {
          const cx = gx + dx, cy = gy + dy;
          if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
          const i = cy * W + cx;
          for (let q = 0; q < span; q++) {
            /* the SHUT twin takes the stone whatever the gateway says — the whole difference */
            nav.masks[q + span][i] = 1;
            if (q === w.owner && atGate) continue;   // his own gateway stays open to him
            nav.masks[q][i] = 1;
          }
        }
      }
    }
    /* ...and the gateway is cleared last, so a neighbouring course cannot stamp it shut */
    for (const w of world.walls || []) {
      if (!w.gate) continue;
      const gx0 = Math.floor((w.gx - gateR) / cw), gx1 = Math.floor((w.gx + gateR) / cw);
      const gy0 = Math.floor((w.gy - gateR) / cw), gy1 = Math.floor((w.gy + gateR) / cw);
      for (let cy = gy0; cy <= gy1; cy++) for (let cx = gx0; cx <= gx1; cx++) {
        if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
        const px = (cx + 0.5) * cw - w.gx, py = (cy + 0.5) * cw - w.gy;
        if (px * px + py * py < gateR * gateR) nav.masks[w.owner][cy * W + cx] = 0;
      }
    }
    return nav.masks;
  }
  /* Chaos rides the last layer; everyone else rides their own. `shut` picks the twin in which
   * this heir's own gateways are stone — for a garrison walking to a place on its own wall. */
  const layerOf = (world, owner, shut) =>
    (owner >= 0 ? owner : world.players.length) + (shut ? world.players.length + 1 : 0);
  const maskOf = (nav, world, owner, shut) => masksFor(nav, world)[layerOf(world, owner, shut)];

  /* ---------------- flow fields (Dijkstra out from the goal) ---------------- */
  const SQ2 = Math.SQRT2;
  function buildField(nav, world, owner, goal, shut) {
    const W = nav.W, H = nav.H, n = W * H, cost = nav.cost, mask = maskOf(nav, world, owner, shut);
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

  function fieldFor(nav, world, owner, goal, shut) {
    masksFor(nav, world);   // FIRST: a new wall drops every field drawn against the old ones
    /* the LAYER is the key, not the owner — two heirs' fields never collided and a heir's own
     * two must not either */
    const key = layerOf(world, owner, shut) * 1e7 + goal;
    let f = nav.fields.get(key);
    if (f) return f;
    if (nav.fields.size >= C.NAV.cacheMax) nav.fields.clear();
    f = buildField(nav, world, owner, goal, shut);
    nav.fields.set(key, f);
    return f;
  }

  /* ---------------- steering ----------------
   * Returns a unit vector down the flow field, or null when the goal cannot be reached from
   * here (walled off — the caller decides what to besiege).
   * SAMPLED, NOT STEPPED. The first version aimed each man at the centre of the one best
   * neighbouring cell, so a column marched in eight headings with a kink at every cell
   * boundary — visibly quantised at the stride level. Each cell's descent direction is a
   * sample of a smooth underlying field, so the direction a man takes is the BILINEAR BLEND
   * of the four cells around him: the same information the grid already held, read the way
   * a field should be read. The old single-cell answer is kept as the fallback for the
   * degenerate blends — corners where opposing samples cancel, and the first stride out of
   * an unreachable pocket, where only the escape matters. */
  NAV.steer = function (nav, world, owner, gxw, gyw, x, y, shut) {
    const goal = NAV.cellOf(nav, gxw, gyw);
    if (goal < 0) return null;
    const here = NAV.cellOf(nav, x, y);
    if (here < 0) return null;
    const W = nav.W, H = nav.H, cw = nav.cw, f = fieldFor(nav, world, owner, goal, shut);
    /* the descent direction OF one cell: centre toward its best neighbour's centre */
    const dirOf = (ci) => {
      const cx = ci % W, cy = (ci - cx) / W;
      let bd = f[ci], bi = -1;
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
      const dx = bx - cx, dy = by - cy, L = Math.sqrt(dx * dx + dy * dy) || 1;
      return { x: dx / L, y: dy / L };
    };
    /* the contract first: standing where the field has no downhill — the goal cell, or a
     * pocket the goal cannot be reached from — is still null, and a man on unreachable
     * ground still gets the single-cell answer that walks him out */
    const own = dirOf(here);
    if (!own) return null;
    if (f[here] === Infinity) return own;
    /* blend the four samples around him, skipping cells the field never reached */
    const fx = x / cw - 0.5, fy = y / cw - 0.5;
    const cx0 = Math.floor(fx), cy0 = Math.floor(fy);
    const tx = fx - cx0, ty = fy - cy0;
    let vx = 0, vy = 0, wsum = 0;
    for (let j = 0; j <= 1; j++) for (let i = 0; i <= 1; i++) {
      const cx = cx0 + i, cy = cy0 + j;
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
      const ci = cy * W + cx;
      if (f[ci] === Infinity) continue;
      const w = (i ? tx : 1 - tx) * (j ? ty : 1 - ty);
      if (w < 1e-6) continue;
      const dir = ci === here ? own : dirOf(ci);
      if (!dir) continue;               // a sample AT the goal has no direction to lend
      vx += dir.x * w; vy += dir.y * w; wsum += w;
    }
    const L = Math.sqrt(vx * vx + vy * vy);
    /* opposing samples cancelling (a ridge in the field) is not a heading — take the old
     * single-cell answer rather than a near-zero vector amplified to full stride */
    if (wsum < 1e-6 || L < 0.25 * wsum) return own;
    return { x: vx / L, y: vy / L };
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

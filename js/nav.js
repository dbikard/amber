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
    dbgDump++;
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

  /* ---------------- flow fields (Dijkstra out from the goal) ----------------
   * `bound` is THE REACH: `{id, x, y, r2}`, a disc the search may not leave. One test in the
   * neighbour loop, and it is the whole reason a continuous country is affordable — a field
   * bounded by a city's reach costs what a field costs on today's board, however large the
   * land grows (measured in proto/reach: 70ms/0.76MB unbounded over a country, 5.5ms/0.12MB
   * bounded). Cells outside the disc stay Infinity, which is the same answer as "walled off"
   * and every caller already handles. No bound is today's search exactly. */
  const SQ2 = Math.SQRT2;
  /* ---- A FIELD IS SPARSE TO ITS BOUND ----
   * A fenced field only ever fills the cells inside its city's disc — measured, 21% of a
   * country's grid — and used to allocate the whole grid anyway: 750KB a field, ~55MB for a
   * country's 74-field working set where ~12MB would do. So a field is a WINDOW: `{x0, y0, w,
   * h, d}` with `d` a Float32Array over the window alone, and everything outside it reads as
   * Infinity, which is exactly what the Dijkstra would have written there. One representation
   * for both — an unbounded field is the window that happens to be the whole grid — so there is
   * no second code path for the big case, and `NAV.fieldAt(f, i)` is the one way to read a cell
   * (`steer` and the suites both go through it). The Dijkstra visits the same cells in the same
   * order and writes the same numbers, so the fields are identical to the digit — held by
   * hashing every man's position every second over three simulated minutes of two seeded
   * countries, before and after. Measured on one of them: 80 fields resident, 14.6MB held
   * against 61.4MB, 4.2x. The heap is sized to the window too. */
  function windowOf(nav, bound) {
    const W = nav.W, H = nav.H;
    if (!bound) return { x0: 0, y0: 0, w: W, h: H };
    const cw = nav.cw, r = Math.sqrt(bound.r2);
    const x0 = Math.max(0, Math.floor((bound.x - r) / cw) - 1), y0 = Math.max(0, Math.floor((bound.y - r) / cw) - 1);
    const x1 = Math.min(W - 1, Math.ceil((bound.x + r) / cw) + 1), y1 = Math.min(H - 1, Math.ceil((bound.y + r) / cw) + 1);
    return { x0, y0, w: Math.max(0, x1 - x0 + 1), h: Math.max(0, y1 - y0 + 1) };
  }
  /* the value of grid cell `i` in field `f`: Infinity outside the window, as the search left it */
  NAV.fieldAt = function (f, i) {
    const W = f.W, cx = i % W, cy = (i - cx) / W;
    const lx = cx - f.x0, ly = cy - f.y0;
    if (lx < 0 || ly < 0 || lx >= f.w || ly >= f.h) return Infinity;
    return f.d[ly * f.w + lx];
  };
  function buildField(nav, world, owner, goal, shut, bound) {
    const W = nav.W, H = nav.H, cost = nav.cost, mask = maskOf(nav, world, owner, shut);
    const elev = nav.elev;
    const bx = bound ? bound.x : 0, by = bound ? bound.y : 0, br2 = bound ? bound.r2 : 0;
    const cw = nav.cw;
    const win = windowOf(nav, bound), fw = win.w, fx0 = win.x0, fy0 = win.y0;
    const n = win.w * win.h;
    const dist = new Float32Array(n).fill(Infinity);
    /* grid cell -> window cell; the goal may lie outside the window (a bound that does not
     * contain its own goal), which the old full-grid field answered with a field of Infinity
     * everywhere but the goal, and this answers with an empty window */
    const wi = (gi) => { const cx = gi % W, cy = (gi - cx) / W, lx = cx - fx0, ly = cy - fy0;
      return lx < 0 || ly < 0 || lx >= fw || ly >= win.h ? -1 : ly * fw + lx; };
    const field = { W, x0: fx0, y0: fy0, w: fw, h: win.h, d: dist };
    const gw = wi(goal);
    if (gw < 0) return field;
    /* binary heap of GRID cell indices keyed by tentative distance. It GROWS: with lazy
     * deletion a cell can sit in the heap more than once, and a typed-array write past the end
     * is a silent no-op — a fixed heap that overflowed would corrupt the field without a word */
    let hi = new Int32Array(n + 1), hd = new Float32Array(n + 1);
    let hn = 0;
    const push = (i, d) => {
      if (hn + 1 >= hi.length) {
        const hi2 = new Int32Array(hi.length * 2), hd2 = new Float32Array(hd.length * 2);
        hi2.set(hi); hd2.set(hd); hi = hi2; hd = hd2;
      }
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
    dist[gw] = 0; push(goal, 0);
    while (hn > 0) {
      const cur = pop(), cd = dist[wi(cur)];
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
          if (bound) {                                              // THE REACH, at cell centres
            const wx = (nx + 0.5) * cw - bx, wy = (ny + 0.5) * cw - by;
            if (wx * wx + wy * wy > br2) continue;
          }
          if (dx && dy) {                                           // no cutting a blocked corner
            if (cost[cy * W + nx] === 0 || cost[ny * W + cx] === 0) continue;
          }
          const climb = Math.max(0, elev[ni] - elev[cur]) * C.NAV.slope;
          const nd = cd + (cc + climb) * (dx && dy ? SQ2 : 1);
          const wn = wi(ni);
          if (wn >= 0 && nd < dist[wn]) { dist[wn] = nd; push(ni, nd); }
        }
      }
    }
    return field;
  }

  /* HOW MANY FIELDS WERE ACTUALLY BUILT, and how many reads found one waiting. A field build is
   * a Dijkstra over every cell of the board and a read is a Map lookup, so telling them apart is
   * the whole of any question about this cache — and from OUTSIDE they are indistinguishable:
   * a probe that wraps `fields.set` counts a read as a build the moment anything re-inserts on
   * a hit. Two probes in a row reported cache reads as builds before this existed, and the
   * conclusion drawn from them — that the cache was thrashing — was wrong. */
  let dbgBuilt = 0, dbgRead = 0, dbgDump = 0, dbgDeferred = 0;
  NAV.debugFields = () => ({ built: dbgBuilt, read: dbgRead, dumped: dbgDump, deferred: dbgDeferred });
  NAV.debugFieldsReset = () => { dbgBuilt = dbgRead = dbgDump = dbgDeferred = 0; };

  /* ---- A COLD FIELD IS A DIJKSTRA OVER THE WHOLE BOARD, SO ONLY SO MANY PER TICK ----
   * The sim's worst tick has nothing to do with its average. Measured over six-minute matches
   * with two heirs playing: the median is half a millisecond, the 99th percentile under four,
   * and the WORST is 26-53ms on today's board and 293ms on one three times as wide. Every one
   * of those spikes is a tick that built several fields at once.
   * IT IS NOT THE CACHE. That was the first guess and it was wrong, which the counters below
   * were added to settle: a whole match builds FIFTY fields against 387,000 reads, the cache
   * peaks at 34 of its 48 places and the overflow path never runs once. Evicting more gently
   * was implemented, measured against the same seeds, and changed nothing at all — because the
   * code it changed never executes. It was reverted.
   * What does fire is `masksFor`: a wall rises, every field drawn against the old ground is
   * genuinely WRONG, all of them go, and the next few ticks rebuild whichever are wanted —
   * two, five, nine of them in one tick, at up to 59ms each on a big board.
   * So the rebuilds are RATIONED. A tick builds `NAV.perTick` fields and no more; a man whose
   * field is not ready yet gets the same answer as a man whose goal is unreachable, which
   * `steer` already returns and every caller already handles by heading at the goal directly
   * for one tick. It is a COUNT and not a time budget, deliberately: the sim is seeded and
   * host-authoritative, and a rule that depended on how fast the machine was would make two
   * seats disagree about where an army went. */
  function fieldFor(nav, world, owner, goal, shut, bound) {
    masksFor(nav, world);   // FIRST: a new wall drops every field drawn against the old ones
    /* the LAYER is the key, not the owner — two heirs' fields never collided and a heir's own
     * two must not either. A BOUND is a key term too: the same goal searched inside two
     * different reaches is two different fields. No bound composes to nought, so an unbounded
     * key is today's arithmetic to the digit. Ceilings, asserted in the suite: a bound id
     * under 62, a layer under 64, a goal under 1e7 — the product stays an exact double. */
    const key = ((bound ? bound.id + 1 : 0) * 64 + layerOf(world, owner, shut)) * 1e7 + goal;
    const f = nav.fields.get(key);
    if (f) { dbgRead++; return f; }
    /* ZERO IS THE WAY BACK. A ration of nought would otherwise mean "build nothing", which is
     * not a thing anyone wants, so it is spelled to mean "no ration" — and that restores the
     * old behaviour exactly: every field asked for is built on the tick it is asked for, and
     * nothing below this line can defer. One constant, so a change of mind about the trade
     * (a rarer hitch against slightly longer matches — see const.js) is one edit and not a
     * revert. The suite holds both halves.
     * THE RATION IS THE WORLD'S FIRST: bounded fields are board-cheap wherever the land is
     * large, so a reach world may afford a higher ration without touching the game every
     * board plays (`world.navRation`; unset means the constant). */
    if (nav.buildTick !== world.tick) { nav.buildTick = world.tick; nav.builds = 0; }
    const ration = world.navRation != null ? world.navRation : C.NAV.perTick;
    if (ration && nav.builds >= ration) { dbgDeferred++; return null; }
    nav.builds++;
    dbgBuilt++;
    /* ---- THE CEILING IS THE WORLD'S, BECAUSE THE WORKING SET IS ----
     * `NAV.cacheMax` was sized for a duel: two seats, a handful of goals. A country has sixteen
     * economies with companies of their own, and its working set MEASURED 74 fields — which sat
     * just above the ceiling of 48, the worst possible place for it. The cache filled, dropped
     * EVERYTHING, and every field was built again: measured over twenty simulated seconds,
     * 1,098 field requests deferred and 41 rebuilt, which is the ration saturated on essentially
     * every tick — and a deferred field means a man steering straight at his goal instead of
     * down a field, all over the country. That is what a war felt like.
     * With room for the working set: 0 deferred, 15 builds, and the sim got FASTER (3.05 ->
     * 2.29ms a frame) because it stopped rebuilding what it had just thrown away.
     * A field used to be a Float32Array over the whole grid — 768KB on a country — which made
     * this a real memory decision; it is sparse to its bound now (see `windowOf`), so a fenced
     * field is a fifth of that and the ceiling is cheap. Still per-world, so a duel keeps its 48. */
    const cap = world.navCache != null ? world.navCache : C.NAV.cacheMax;
    if (nav.fields.size >= cap) nav.fields.clear();
    const built = buildField(nav, world, owner, goal, shut, bound);
    nav.fields.set(key, built);
    return built;
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
  NAV.steer = function (nav, world, owner, gxw, gyw, x, y, shut, bound) {
    const goal = NAV.cellOf(nav, gxw, gyw);
    if (goal < 0) return null;
    const here = NAV.cellOf(nav, x, y);
    if (here < 0) return null;
    const W = nav.W, H = nav.H, cw = nav.cw, f = fieldFor(nav, world, owner, goal, shut, bound);
    /* NO FIELD THIS TICK. Either it has not been built yet — the tick's ration is spent, see
     * `NAV.perTick` — or the goal is walled off. The answer is the same either way and it is
     * the one this function has always given for a goal it cannot reach: null, and the caller
     * heads at the goal directly. A man waits a tick or two after a wall changes and walks
     * straight meanwhile, which is what he does past the end of any field. */
    if (!f) return null;
    /* the descent direction OF one cell: centre toward its best neighbour's centre */
    const at = NAV.fieldAt;
    const dirOf = (ci) => {
      const cx = ci % W, cy = (ci - cx) / W;
      let bd = at(f, ci), bi = -1;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = cy + dy;
        if (ny < 0 || ny >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx;
          if (nx < 0 || nx >= W) continue;
          const ni = ny * W + nx, fv = at(f, ni);
          if (fv < bd) { bd = fv; bi = ni; }
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
    if (at(f, here) === Infinity) return own;
    /* blend the four samples around him, skipping cells the field never reached */
    const fx = x / cw - 0.5, fy = y / cw - 0.5;
    const cx0 = Math.floor(fx), cy0 = Math.floor(fy);
    const tx = fx - cx0, ty = fy - cy0;
    let vx = 0, vy = 0, wsum = 0;
    for (let j = 0; j <= 1; j++) for (let i = 0; i <= 1; i++) {
      const cx = cx0 + i, cy = cy0 + j;
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
      const ci = cy * W + cx;
      if (at(f, ci) === Infinity) continue;
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

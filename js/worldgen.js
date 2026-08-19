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
  G.T = { WATER: 1, MARSH: 2, PLAIN: 3, MEADOW: 4, FOREST: 5, HILL: 6, CLIFF: 7,
          ROAD: 8, BRIDGE: 9 };
  const T = G.T;
  /* movement cost by land; 0 is impassable. Slope is charged on top (see nav.js).
   * A ROAD is the cheapest ground there is and a BRIDGE is a road over water — which is the
   * whole reason to carve them: columns funnel onto them on their own, and a bridge is a
   * chokepoint nobody had to declare. Neither will bear a work (absent from BUILDABLE), so
   * the king's highway stays clear. */
  G.COST = { 1: 0, 2: 5, 3: 1, 4: 2, 5: 3, 6: 2, 7: 0, 8: 1, 9: 1 };
  /* what will bear a building */
  G.BUILDABLE = { 3: true, 4: true, 6: true };

  /* `dims` is the land's size in world units, `{W, H}`. Omitted, it is `CONST.MAP` — the
   * board every existing mode plays on. THE SIZE IS THE WORLD'S, NOT THE GAME'S: a country
   * and the duel that referees the balance tables must be able to disagree in one process,
   * which is the same reason `world.rules` is a copy and not a global. */
  G.generate = function (seed, dims) {
    const N = C.WORLD;
    const cw = C.NAV.cell;
    const D = dims || C.MAP;
    const W = Math.round(D.W / cw), H = Math.round(D.H / cw), n = W * H;
    const sd = (seed >>> 0) || 1;
    const elev = new Float32Array(n), terra = new Uint8Array(n);

    /* ---- THE EDGE OF THE WORLD IS A COAST OR A RANGE, never a line ----
     * (the designer, 2026-08-19, for boards and countries alike) Each of the four edges is
     * dealt SEA or a RANGE, by the seed (`rangeOdds`). A sea edge is a COAST: the water runs
     * inland by a depth that wanders along the edge (`coastDepth` cells, swung by noise), the
     * shore is a BEACH (a low band of marsh and sand) on some stretches and a CLIFF (crag
     * standing straight out of the water) on others, and here and there an ESTUARY cuts a
     * narrow inlet deeper inland. A range edge is foothills rising to crag over `rangeW`
     * cells, its foot swung along the edge too. A corner takes whichever is nearer. The last
     * cell of every edge is water or crag whatever the noise said, so the renderer's skirt
     * continues a sea or a range and never a meadow. */
    const edgeKind = [0, 1, 2, 3].map((k) => (vnoise(sd + 31, k * 7, 0) < N.rangeOdds ? 1 : 0));   // L, T, R, B: 1 = range (a lattice value: uniform)
    const rangeW = N.rangeW;
    for (let gy = 0; gy < H; gy++) {
      for (let gx = 0; gx < W; gx++) {
        const i = gy * W + gx, fx = gx * N.freq, fy = gy * N.freq;
        const base = fbm(sd, fx, fy, 4, 0.5);
        /* folded noise → ridge lines, so high ground forms chains and passes */
        const ridge = 1 - Math.abs(fbm(sd + 977, fx * 1.4, fy * 1.4, 3, 0.55) * 2 - 1);
        let e = base * (1 - N.ridge) + ridge * N.ridge;
        const d4 = [gx, gy, W - 1 - gx, H - 1 - gy];
        let dSea = Infinity, dRange = Infinity, alongR = 0, alongS = 0, kS = 0;
        for (let k = 0; k < 4; k++) {
          if (edgeKind[k]) { if (d4[k] < dRange) { dRange = d4[k]; alongR = (k & 1) ? gx : gy; } }
          else if (d4[k] < dSea) { dSea = d4[k]; alongS = (k & 1) ? gx : gy; kS = k; }
        }
        if (dRange <= dSea) {
          /* a range: its foot wanders along the edge, its crest is crag */
          const wob = 0.7 + 0.6 * vnoise(sd + 59, alongR * 0.11, dRange * 0.05);
          const t = 1 - dRange / (rangeW * wob);
          if (t > 0) {
            const tt = t * t * (3 - 2 * t);
            const target = N.hill - 0.04 + (N.cliff + 0.12 - (N.hill - 0.04)) * tt;
            e = Math.max(e, target);
          }
        } else {
          /* a coast: the water's depth inland wanders along the edge... */
          let depth = N.rim * (0.3 + 1.6 * vnoise(sd + 71, alongS * 0.05 + kS * 13.7, 0.3)
                                   + 0.5 * vnoise(sd + 73, alongS * 0.17 + kS * 5.1, 0.6));
          /* ...an estuary cuts a narrow inlet deeper, here and there... */
          const inlet = vnoise(sd + 97, alongS * 0.19 + kS * 41.1, 0.7);
          if (inlet > N.inletOdds) depth += N.inletDeep * ((inlet - N.inletOdds) / (1 - N.inletOdds));
          /* ...and the shore is a beach or a cliff, in long stretches */
          const cliffy = vnoise(sd + 83, alongS * 0.03 + kS * 29.3, 0.1) > N.cliffShore;
          if (dSea < depth) {
            e = Math.min(e, N.sea - 0.03 - 0.06 * (1 - dSea / depth));
          } else if (dSea < depth + N.shoreW) {
            const t = 1 - (dSea - depth) / N.shoreW;    // 1 at the water's edge, 0 inland
            if (cliffy) e = Math.max(e, N.hill + 0.02 + (N.cliff + 0.02 - (N.hill + 0.02)) * t * t);
            else e = Math.min(e, N.sea + 0.015 + 0.04 * (1 - t));
          }
        }
        elev[i] = e;
      }
    }
    /* what the edges were dealt, for the renderer's skirt and the suites */
    G.lastEdges = edgeKind.slice();
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
    return { W, H, cw, elev, terra, edges: edgeKind };
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
   * when it nudges a city onto the mainland.
   * `soft` marks cells IMPASSABLE ON THE GROUND but passable FOR PLANNING — a river, before
   * anybody has bridged it. Placement plans across rivers so two cities may face each other
   * over one, and the road carver then builds the bridge the plan was counting on. */
  function mainland(land, soft) {
    const { W, H, terra } = land, n = W * H;
    const label = new Int32Array(n);
    const q = [];
    let next = 0, bestLabel = 0, bestCount = 0;
    for (let i = 0; i < n; i++) {
      if (label[i] || (G.COST[terra[i]] === 0 && !(soft && soft[i]))) continue;
      const L = ++next;
      let count = 1;
      label[i] = L; q.length = 0; q.push(i);
      while (q.length) {
        const cur = q.pop(), cx = cur % W, cy = (cur - cx) / W;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (label[ni] || (G.COST[terra[ni]] === 0 && !(soft && soft[ni]))) continue;
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
      /* THE SHORE AND THE RANGE ARE NOT LEVELLED: the last two cells of the world stay what
       * the edge was dealt — a spring in a hollow beside the sea levelled the beach into plain
       * (measured: five border cells of PLAIN at 0.38 on a sea edge) */
      if (nx < 2 || ny < 2 || nx >= land.W - 2 || ny >= land.H - 2) continue;
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

  /* ---------------- THE BOARD IS FOUR QUARTERS ----------------
   * The designer's rule for a skirmish (2026-08-19): the Seats stand in the CORNERS, and the
   * springs are dealt EQUALLY — `C.WORLD.perQuarter` (two) in every quarter of the map, the
   * starting springs among them. Before this the springs were a scatter over the whole
   * landmass and the Seats a fairness search over candidate pairs; the scatter could stack
   * five springs on one side and the search could only narrow that. Symmetry by construction
   * instead of by scoring: every quarter holds the same ground, whoever opens in it. */
  const quarterOf = (land, x, y) => (x < land.W * land.cw / 2 ? 0 : 1) + (y < land.H * land.cw / 2 ? 0 : 2);
  const CORNERS = [[0, 0], [1, 0], [0, 1], [1, 1]];   // quarter k: corner (qx, qy), k = qx + 2*qy
  /* a spring wants level, open ground that will bear a Gate beside it */
  const springRoom = (land, i) => roomAt(land, i, 110) > 24;
  /* Springs of Shadow: two a quarter. A quarter with a Seat in it gets that Seat's HOME spring
   * first — at arm's length (springNear..springFar), with a Gate ring a crew can raise on
   * (`homeGateOn`), inside its own quarter — and the rest are dealt at random inside the
   * quarter with the separation rule, outside every Seat's writ (CLAIM.seat), so a Seat opens
   * with EXACTLY one spring it can draw on and the second is something it goes and takes. */
  function placeNodes(land, reach, rng, seats) {
    const { W, H, cw, terra } = land, n = W * H;
    const per = C.WORLD.perQuarter, min2 = C.WORLD.nodeGap * C.WORLD.nodeGap;
    const cellAt = (x, y) => {
      const gx = (x / cw) | 0, gy = (y / cw) | 0;
      if (gx < 0 || gy < 0 || gx >= W || gy >= H) return -1;
      return gy * W + gx;
    };
    const buildableAt = (x, y) => { const ci = cellAt(x, y); return ci >= 0 && !!G.BUILDABLE[terra[ci]]; };
    const out = [];
    const clear = (p) => out.every((q) => (p.x - q.x) ** 2 + (p.y - q.y) ** 2 >= min2) &&
      (seats || []).every((sp) => (p.x - sp.x) ** 2 + (p.y - sp.y) ** 2 > C.CLAIM.seat * C.CLAIM.seat);
    /* the home springs first, one per Seat */
    for (const sp of seats || []) {
      const k = quarterOf(land, sp.x, sp.y);
      let home = null;
      const a0 = rng.next() * Math.PI * 2;
      for (let rr = C.WORLD.springNear + 20; rr <= C.WORLD.springFar - 20 && !home; rr += 30)
        for (let ai = 0; ai < 24 && !home; ai++) {
          const th = a0 + ai / 24 * Math.PI * 2;
          const x = sp.x + Math.cos(th) * rr, y = sp.y + Math.sin(th) * rr;
          const ci = cellAt(x, y);
          if (ci < 0 || !reach.seen[ci] || !G.BUILDABLE[terra[ci]] || !springRoom(land, ci)) continue;
          const q = cellXY(land, ci);
          if (quarterOf(land, q.x, q.y) !== k) continue;
          if (out.some((o) => (q.x - o.x) ** 2 + (q.y - o.y) ** 2 < min2)) continue;
          /* no other Seat may have it in ITS writ either */
          if ((seats || []).some((o) => o !== sp && (q.x - o.x) ** 2 + (q.y - o.y) ** 2 <= C.CLAIM.seat * C.CLAIM.seat)) continue;
          if (!G.homeGateOn(sp, [q], buildableAt)) continue;
          home = q;
        }
      if (!home) return null;
      out.push(home);
    }
    /* then the rest of every quarter, at random with the separation rule */
    const cand = [[], [], [], []];
    for (let i = 0; i < n; i++) {
      if (!reach.seen[i] || !G.BUILDABLE[terra[i]]) continue;
      const p = cellXY(land, i);
      cand[quarterOf(land, p.x, p.y)].push(i);
    }
    for (let k = 0; k < 4; k++) {
      const list = cand[k];
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        const t = list[i]; list[i] = list[j]; list[j] = t;
      }
      let have = out.filter((q) => quarterOf(land, q.x, q.y) === k).length;
      for (const i of list) {
        if (have >= per) break;
        const p = cellXY(land, i);
        if (!clear(p) || !springRoom(land, i)) continue;
        out.push(p); have++;
      }
      if (have < per) return null;
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

  /* ---------------- the Seats stand in the corners ----------------
   * One per corner, inside `C.WORLD.cornerBox` of it and never nearer the edge than `inland`.
   * Two heirs take a DIAGONAL (the far pair; the adjacent pairs only if no diagonal will bear
   * two Seats), three take three corners, four take all four. Fairness is what is left to
   * choose: every quarter holds the same springs by construction, so the Seats are picked for
   * the ROOM around them — the set whose buildable ground differs least — and the pair or
   * triple of corners is the one that is fairest first and farthest second. `skew` keeps its
   * old reading (room spread over 60) so `maxSkew` still rejects a lopsided world. */
  function placeCities(land, reach, rng, want) {
    const { W, H, cw, terra } = land, n = W * H;
    const mw = W * cw, mh = H * cw, box = C.WORLD.cornerBox;
    const byCorner = [[], [], [], []];
    for (let i = 0; i < n; i++) {
      if (!reach.seen[i] || !G.BUILDABLE[terra[i]]) continue;
      const p = cellXY(land, i);
      if (p.x < C.WORLD.inland || p.y < C.WORLD.inland || p.x > mw - C.WORLD.inland || p.y > mh - C.WORLD.inland) continue;
      const qx = p.x < mw / 2 ? 0 : 1, qy = p.y < mh / 2 ? 0 : 1;
      const dx = qx ? mw - p.x : p.x, dy = qy ? mh - p.y : p.y;
      if (dx > box || dy > box) continue;
      if (roomAt(land, i, C.CITY.r + 60) < C.WORLD.seatRoom) continue;
      byCorner[qx + 2 * qy].push(i);
    }
    /* a few dozen candidates a corner, each with the room it would have */
    const sample = byCorner.map((list) => {
      const out = [];
      for (let t = 0; t < 48 && list.length; t++) {
        const i = list[Math.floor(rng.next() * list.length)];
        if (out.some((o) => o.i === i)) continue;
        out.push({ i, p: cellXY(land, i), room: roomAt(land, i, 460) });
      }
      return out;
    });
    /* TWO HEIRS TAKE A DIAGONAL, and nothing else: a world whose diagonals will not bear two
     * Seats is rerolled (the caller tries another seed) rather than seating them along one
     * edge — measured, a fallback to the adjacent pairs put two heirs 880 apart on six seeds
     * in a hundred and twenty. Three take three corners, four take all four. */
    const sets = want >= 4 ? [[0, 1, 2, 3]]
               : want === 3 ? [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]]
               : [[0, 3], [1, 2]];
    let best = null;
    for (const set of sets) {
      if (set.some((k) => !sample[k].length)) continue;
      /* the fairest pick per corner: aim every corner at one target room, try each
       * candidate's room of the first corner as the target, keep the narrowest spread */
      let pick = null;
      for (const t of sample[set[0]]) {
        const chosen = set.map((k) => sample[k].reduce((b2, o) => (!b2 || Math.abs(o.room - t.room) < Math.abs(b2.room - t.room) ? o : b2), null));
        const rooms = chosen.map((o) => o.room);
        const skew = (Math.max(...rooms) - Math.min(...rooms)) / 60;
        if (!pick || skew < pick.skew) pick = { chosen, skew };
      }
      if (!pick) continue;
      const pts = pick.chosen.map((o) => o.p);
      let far = Infinity;
      for (let a2 = 0; a2 < pts.length; a2++)
        for (let b2 = a2 + 1; b2 < pts.length; b2++)
          far = Math.min(far, Math.hypot(pts[a2].x - pts[b2].x, pts[a2].y - pts[b2].y));
      /* fair first, far second */
      const score = pick.skew * 10 - far / 260;
      if (!best || score < best.score) best = { score, seats: pick.chosen.map((o) => o.i), pts, skew: pick.skew, far, corners: set };
    }
    return best;
  }

  /* ---------------- the whole world ---------------- */
  G.build = function (seed, RNG, players, opts) {
    const want = Math.max(2, Math.min(4, players || 2));
    const dims = opts && opts.dims ? opts.dims : null;
    for (let attempt = 0; attempt < 24; attempt++) {
      const s = (seed + attempt * 7919) >>> 0;
      const rng = RNG.make(s);
      const land = G.generate(s, dims);
      const reach = mainland(land);
      if (reach.count < land.W * land.H * C.WORLD.minLand) continue;

      /* the Seats first — in the corners — then the springs dealt by quarter around them */
      const seats = placeCities(land, reach, rng, want);
      if (!seats || seats.skew > C.WORLD.maxSkew) continue;
      const nodes = placeNodes(land, reach, rng, seats.pts);
      if (!nodes) continue;
      const vants = placeVantages(land, reach, nodes, rng);

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
      const buildableAt = (x, y) => {
        const gx = (x / land.cw) | 0, gy = (y / land.cw) | 0;
        return gx >= 0 && gy >= 0 && gx < land.W && gy < land.H && !!G.BUILDABLE[land.terra[gy * land.W + gx]];
      };
      const homeGates = seats.pts.map((p) => {
        const g = G.homeGateOn(p, nodes, buildableAt);
        return g ? { x: g.x, y: g.y, site: nodeSite[g.node] } : null;
      });
      if (homeGates.some((g) => !g)) continue;

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
        edges: land.edges,   // what each edge was dealt — L, T, R, B; 1 = a range, 0 = a coast
        seed: s, skew: seats.skew, apart: Math.round(seats.far), attempt
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
  function reachFlood(land, fromX, fromY, cx, cy, r2, soft) {
    const { W, H, cw, terra } = land;
    const pass = (i) => G.COST[terra[i]] > 0 || !!(soft && soft[i]);
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

  /* ---------------- the rivers ----------------
   * A river RUNS: from a source on high ground, always downhill with a little momentum and
   * a seeded meander, until it meets standing water or the world's rim. Stamped as real
   * WATER one to two cells wide, so it bars a column exactly as a lake does — and unlike a
   * lake it CROSSES the country, which is what makes a bridge worth its toll. The cells are
   * remembered in a mask: placement plans across them (see `mainland`'s `soft`), and the
   * road carver is what turns the plan into planks. Momentum is what carries a young river
   * out of the little hollows the noise leaves everywhere — real rivers erode through;
   * a walk that only ever descended would end in the first dimple it met. */
  function carveRivers(land, rng, count) {
    const { W, H, cw, terra, elev } = land, n = W * H;
    const mask = new Uint8Array(n);
    /* measured, not guessed: how many sources took, how far each actually ran, and how it
     * ended — a river that stubs out in a hollow is invisible in the terra counts and the
     * first explanation for a country without bridges */
    const dbg = (G.debugRivers = { sources: 0, runs: [] });
    /* sources: high ground, inland, apart from each other */
    const springs = [];
    /* sources lean toward the interior: a river down the rim separates nobody, and what a
     * river is FOR here is standing between cities until a bridge is paid for */
    for (let t = 0; t < 6000 && springs.length < count; t++) {
      const inX = Math.floor(W / 6), inY = Math.floor(H / 6);
      const gx = inX + Math.floor(rng.next() * (W - 2 * inX)), gy = inY + Math.floor(rng.next() * (H - 2 * inY));
      const i = gy * W + gx;
      if (elev[i] < (t < 3000 ? 0.62 : 0.55) || terra[i] === T.WATER) continue;
      if (springs.some((s) => (s.gx - gx) ** 2 + (s.gy - gy) ** 2 < 40 * 40)) continue;
      springs.push({ gx, gy });
    }
    dbg.sources = springs.length;
    for (const s of springs) {
      let gx = s.gx, gy = s.gy, mx = 0, my = 0;
      let ran = 0, how = 'len';
      const maxLen = W + H;
      for (let step = 0; step < maxLen; step++) {
        ran = step;
        const i = gy * W + gx;
        if (terra[i] === T.WATER && !mask[i]) { how = 'sea'; break; }   // found the sea, or a lake
        if (terra[i] !== T.CLIFF) { terra[i] = T.WATER; mask[i] = 1; }
        /* widen downstream: a mature river is two cells, which reads as a river and still
         * bridges in one or two spans */
        if (step > maxLen * 0.25) {
          const wx = gx + (Math.abs(mx) > Math.abs(my) ? 0 : 1), wy = gy + (Math.abs(mx) > Math.abs(my) ? 1 : 0);
          if (wx < W && wy < H) {
            const wi = wy * W + wx;
            if (terra[wi] !== T.CLIFF && terra[wi] !== T.WATER) { terra[wi] = T.WATER; mask[wi] = 1; }
          }
        }
        /* the next cell: the lowest neighbour, leaned on by momentum and a small meander */
        let bi = -1, bs = Infinity;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = gx + dx, ny = gy + dy;
          if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) { bi = -2; continue; }  // the rim: done
          const ni = ny * W + nx;
          if (mask[ni]) continue;                          // never back up its own bed
          const lean = -(dx * mx + dy * my) * 0.006 + (rng.next() - 0.5) * 0.004;
          const score = elev[ni] + lean + (terra[ni] === T.CLIFF ? 0.05 : 0);
          if (score < bs) { bs = score; bi = ni; }
        }
        if (bi === -2 || bi < 0) { how = bi === -2 ? 'rim' : 'stuck'; break; }
        const nx2 = bi % W, ny2 = (bi - nx2) / W;
        mx = mx * 0.6 + (nx2 - gx) * 0.4; my = my * 0.6 + (ny2 - gy) * 0.4;
        /* erosion: the bed never rises, so the walk cannot climb back out of its own valley */
        elev[bi] = Math.min(elev[bi], elev[gy * W + gx]);
        gx = nx2; gy = ny2;
      }
      dbg.runs.push(ran + how[0]);
    }
    return mask;
  }

  /* ---------------- the king's highway ----------------
   * ROADS ARE FOUND, NOT DRAWN. A road between two cities is the least-cost path over the
   * land's own ground with the climb charged dearly — the same kind of question an army's
   * flow field answers, asked once at genesis — so a road goes around a wood because a wood
   * is dear, hugs a contour because a slope is dearer, and crosses water only where a BRIDGE
   * is worth its steep price: exactly where the water is narrow. An existing road is cheaper
   * than any raw ground, so later pairs merge onto earlier ones and the country grows trunk
   * roads nobody designed. Stamped as real terrain (ROAD/BRIDGE, cost 1), it is gameplay and
   * not decoration: columns funnel onto the highway on their own, and every bridge is a
   * chokepoint nobody had to declare. */
  function carveRoads(land, ends, pairs, nodes) {
    const { W, H, cw, terra, elev } = land, n = W * H;
    const SLOPE = 40;                 // dearer than the march's own 26: a road hates a climb
    /* a bridge's price per cell of water. Priced so a two-cell river span (~16) beats any
     * detour past thirty-odd cells of open ground, while a lake ten cells wide (80+) never
     * does — rivers get bridged, lakes get walked around, which is the difference the eye
     * expects between the two */
    const WATER_TOLL = 8;
    let toll = WATER_TOLL;            // per-carve: a surveyed crossing pays less, see below
    const stepCost = (i) => {
      const t = terra[i];
      if (t === T.CLIFF) return -1;   // a road does not tunnel
      if (t === T.WATER) return toll;
      if (t === T.ROAD || t === T.BRIDGE) return 0.51;   // reuse beats even open plain
      return G.COST[t];
    };
    const cellOf = (p) => Math.floor(p.y / cw) * W + Math.floor(p.x / cw);
    /* A*, octile heuristic against the cheapest possible step, binary heap in flat arrays */
    const dist = new Float32Array(n), from = new Int32Array(n), seen = new Uint8Array(n);
    const hi = new Int32Array(n + 1), hd = new Float32Array(n + 1);
    const carveOne = (A, B) => {
      dist.fill(Infinity); from.fill(-1); seen.fill(0);
      let hn = 0;
      const push = (i, d) => { let k = ++hn; hi[k] = i; hd[k] = d;
        while (k > 1) { const p = k >> 1; if (hd[p] <= hd[k]) break;
          const ti = hi[p], td = hd[p]; hi[p] = hi[k]; hd[p] = hd[k]; hi[k] = ti; hd[k] = td; k = p; } };
      const pop = () => { const top = hi[1]; hi[1] = hi[hn]; hd[1] = hd[hn]; hn--;
        let k = 1; for (;;) { const l = k << 1, r = l + 1; let s = k;
          if (l <= hn && hd[l] < hd[s]) s = l; if (r <= hn && hd[r] < hd[s]) s = r;
          if (s === k) break; const ti = hi[s], td = hd[s]; hi[s] = hi[k]; hd[s] = hd[k]; hi[k] = ti; hd[k] = td; k = s; } return top; };
      const a = cellOf(A), b = cellOf(B);
      const bx = b % W, by = (b - bx) / W;
      const hFn = (i) => { const x = i % W, y = (i - x) / W;
        const dx = Math.abs(x - bx), dy = Math.abs(y - by);
        return (Math.max(dx, dy) + 0.41 * Math.min(dx, dy)) * 0.5; };   // admissible vs road 0.51
      dist[a] = 0; push(a, hFn(a));
      while (hn > 0) {
        const cur = pop();
        if (cur === b) break;
        if (seen[cur]) continue;
        seen[cur] = 1;
        const cx = cur % W, cy = (cur - cx) / W;
        for (let dy = -1; dy <= 1; dy++) { const ny = cy + dy; if (ny < 0 || ny >= H) continue;
          for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue;
            const nx = cx + dx; if (nx < 0 || nx >= W) continue;
            const ni = ny * W + nx, cc = stepCost(ni);
            if (cc < 0) continue;
            /* the march's own corner rule (buildField): no diagonal past impassable ground.
             * Without it a road slipped BETWEEN two diagonal river cells and paid no toll —
             * measured as countries of long rivers and no bridges at all. It also means a
             * road enters water squarely, which is what a bridge is. */
            if (dx && dy) {
              const t1 = terra[cy * W + nx], t2 = terra[ny * W + cx];
              if (t1 === T.CLIFF || t2 === T.CLIFF || t1 === T.WATER || t2 === T.WATER) continue;
            }
            const climb = Math.abs(elev[ni] - elev[cur]) * SLOPE;
            const nd = dist[cur] + (cc + climb) * (dx && dy ? Math.SQRT2 : 1);
            if (nd < dist[ni]) { dist[ni] = nd; from[ni] = cur; push(ni, nd + hFn(ni)); }
          } }
      }
      if (!isFinite(dist[b])) return 0;
      /* walk it back and stamp it — but never inside a court, whose ground is the court's,
       * and never through a spring's hollow, where a Gate has to be able to stand */
      const clear = (i) => {
        const x = (i % W) * cw + cw / 2, y = ((i - i % W) / W) * cw + cw / 2;
        if ((x - A.x) ** 2 + (y - A.y) ** 2 < (C.CITY.r * 0.8) ** 2) return false;
        if ((x - B.x) ** 2 + (y - B.y) ** 2 < (C.CITY.r * 0.8) ** 2) return false;
        for (const q of nodes || [])
          if ((x - q.x) ** 2 + (y - q.y) ** 2 < 70 * 70) return false;
        return true;
      };
      let laid = 0;
      for (let i = b; i >= 0; i = from[i]) {
        if (clear(i)) {
          terra[i] = terra[i] === T.WATER ? T.BRIDGE : (terra[i] === T.BRIDGE ? T.BRIDGE : T.ROAD);
          laid++;
        }
        if (i === a) break;
      }
      return laid;
    };
    let total = 0;
    /* a pair marked as a CROSSING was chosen because a river runs between the two — its
     * surveyors mean to cross, so its water is half-toll and the A* fords at the river's
     * narrowest instead of fleeing around the head. Ordinary roads keep the full price. */
    for (const [ai, bi, cross2] of pairs) {
      toll = cross2 ? WATER_TOLL / 2 : WATER_TOLL;
      total += carveOne(ends[ai], ends[bi]);
    }
    /* a bridge stands at BANK height, not on the seabed: without this the relief mesh dips
     * the road into the water and every column marching it visibly wades */
    for (let i = 0; i < n; i++) {
      if (terra[i] !== T.BRIDGE) continue;
      const x = i % W, y = (i - x) / W;
      let sum = 0, k = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const t = terra[ny * W + nx];
        if (t !== T.WATER && t !== T.BRIDGE) { sum += elev[ny * W + nx]; k++; }
      }
      if (k) elev[i] = sum / k;
    }
    return total;
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
      const land = G.generate(s, RW.dims);
      /* the rivers run before anything is placed: placement PLANS across them (`soft`), and
       * the road carver builds the bridges the plan was counting on */
      const rivers = carveRivers(land, rng, RW.rivers != null ? RW.rivers : 4);
      const main = mainland(land, rivers);
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
        const seen = reachFlood(land, p.x, p.y, p.x, p.y, baseReach * baseReach, rivers);
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

      /* ---- the roads, found over the finished ground ----
       * Every city to its two nearest fellows, deduplicated — later pairs merge onto earlier
       * roads (reuse is cheaper than any raw ground), which is how trunks happen. Carved
       * BEFORE linkUp, because a bridge is a route and the neighbour graph should know it. */
      {
        const pairSet = new Set(), pairs = [];
        const put = (a2, b2) => {
          const key = Math.min(a2, b2) + ':' + Math.max(a2, b2);
          if (!pairSet.has(key)) { pairSet.add(key); pairs.push([a2, b2]); }
        };
        /* RIVERS ATTRACT CROSSINGS — that is what river towns are. Any two cities facing
         * each other over a NARROW water (a river's width of cells on the line between
         * them, at least one of them a riverbed — a wide count is a lake, and lakes are
         * walked around) get a road of their own, one per city, nearest first. Without
         * this the nearest-two pairing follows the banks, because cities cluster where
         * the ground is, and a country of long rivers grows no bridges at all — measured:
         * three bridges in twelve seeds, and the facing pairs sat at 2200-3900 apart,
         * past any single march. A crossing road is longer than a reach; that is fine —
         * a road is TERRAIN, and the city in the middle of tomorrow's war will use it. */
        const crossing = (A, B2) => {
          const d = Math.hypot(B2.x - A.x, B2.y - A.y);
          const steps = Math.ceil(d / (cw / 2));
          let water = 0, river = false;
          for (let st = 0; st <= steps; st++) {
            const x = A.x + (B2.x - A.x) * st / steps, y = A.y + (B2.y - A.y) * st / steps;
            const i2 = Math.floor(y / cw) * W + Math.floor(x / cw);
            if (i2 < 0 || i2 >= rivers.length) continue;
            if (land.terra[i2] === T.WATER) { water++; if (rivers[i2]) river = true; }
          }
          return river && water >= 1 && water <= 20;
        };
        /* CROSSINGS ARE CARVED FIRST, while there is no network to lean on: an existing
         * road is half-price to reuse, so a crossing carved last rides the trunks the long
         * way round the river's head and never pays for a single plank — measured, again,
         * as a country of rivers and no bridges. First, its straight economics hold and
         * the bridge wins; the nearest-two network then merges INTO the crossing roads. */
        for (let a2 = 0; a2 < picked.length; a2++) {
          const facing = picked.map((q, b2) => ({ b2, d: Math.hypot(q.x - picked[a2].x, q.y - picked[a2].y) }))
            .filter((e) => e.b2 !== a2 && e.d < 3200 && crossing(picked[a2], picked[e.b2]))
            .sort((u, v2) => u.d - v2.d);
          if (facing.length) { const key = Math.min(a2, facing[0].b2) + ':' + Math.max(a2, facing[0].b2);
            if (!pairSet.has(key)) { pairSet.add(key); pairs.push([a2, facing[0].b2, 1]); } }
        }
        for (let a2 = 0; a2 < picked.length; a2++) {
          const near2 = picked.map((q, b2) => ({ b2, d: (q.x - picked[a2].x) ** 2 + (q.y - picked[a2].y) ** 2 }))
            .filter((e) => e.b2 !== a2).sort((u, v2) => u.d - v2.d).slice(0, 2);
          for (const e of near2) put(a2, e.b2);
        }
        carveRoads(land, picked, pairs, nodes);
      }

      /* ---- reaches and the neighbour graph: a REAL search, after the flattening ----
       * A reach is sized from the city's OWN nearest neighbour, capped, and floored at the
       * nominal spacing — so every city reaches well past its nearest rival's court and into
       * its writ springs (raiding an economy is the anti-turtle engine), whatever distance
       * the max-min placement actually dealt it. A city whose reach can path to nobody still
       * grows it until it can. Run after flatten because levelling joins and cuts routes. */
      const reaches = picked.map((p, i2) => {
        let nd = Infinity;
        for (let j2 = 0; j2 < picked.length; j2++) {
          if (j2 === i2) continue;
          const d = Math.hypot(picked[j2].x - p.x, picked[j2].y - p.y);
          if (d < nd) nd = d;
        }
        return Math.min(RW.reachCap || 3000,
                        Math.max(RW.spacing * RW.reachMul, nd * RW.reachMul));
      });
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
        /* NO COURT IS NAMELESS. The bag is drawn without replacement and is sized to outlast
         * the draw (`REACHWAR.names`); the fallback is a numbered Shadow rather than a shared
         * 'a City of Shadow', because several courts wearing one name is worse than an ugly
         * name — it made the council's roster read as duplicated rows and every banner quoting
         * one ambiguous. If this ever fires, the bag is too small: add names, not a suffix. */
        kept[id].name = seatOrder[k] === pattern ? 'AMBER'
          : cityBag.length ? cityBag.splice(Math.floor(rng.next() * cityBag.length), 1)[0]
          : 'SHADOW ' + (k + 1);
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
        edges: land.edges,
        seed: s, skew: 0, apart: RW.spacing, attempt, country: true
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

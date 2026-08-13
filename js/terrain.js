/* terrain.js — the painterly bake for the one renderer (js/render3d.js drapes it over a
 * relief mesh built from the SAME elevation the sim walks on).
 *
 * There are no authored paths any more, so there is nothing here that invents geography:
 * every pixel is read off the world's own elevation and terrain grids. What you see is
 * what blocks you, what slows you, and what you can build on.
 *
 * TWO WAYS TO BAKE, because a country broke the one. The painterly bake is area-linear in
 * CPU (two fillRect passes over every cell, a gradient per water cell) and its pixel budget
 * (6MP) already binds on a single board — on a country it is both a multi-second freeze and
 * a colour wash. So `bake` learned a RECT (`opts.rect`): the same painterly pipeline over
 * one window of the land, at full resolution, cheap because the window is small — that is a
 * DETAIL TILE, and the renderer keeps a few of them alive around the camera. Under them
 * sits `bakeBase`: the whole land as one ImageData pass — a colour per cell, relief mixed
 * in arithmetically, no gradients, no props — which costs milliseconds at any size and is
 * all a far view can resolve anyway.
 *
 * Determinism inside a rect is the trap. Anything painted from the shared walk of the rng
 * would land differently in two tiles that both show it, so everything that can straddle a
 * seam draws from its OWN seed: a court's tracks and gravel from its site id, a water
 * cell's sparkle from its cell hash. The trees and crags never mattered here — the 3D
 * renderer takes their PLACEMENTS from the one full-land pass and raises real ones.
 *
 * opts.props=false skips painting trees and crags and returns their placements instead.
 * Returns { canvas, trees, rocks }. */
(function (global) {
  'use strict';

  const C = global.CONST;

  /* base colour per land type, at low and high elevation — lerped by the cell's height so
   * the relief reads even on the flat 2D map */
  const PAL = {
    1: ['#0d1a2a', '#16324c'],   // water: deep to shallow
    2: ['#20281c', '#2c3626'],   // marsh
    3: ['#2b2a1c', '#3d3a26'],   // plain
    4: ['#22301e', '#31432a'],   // meadow
    5: ['#141d18', '#1d2a22'],   // forest floor
    6: ['#39352e', '#544d42'],   // hill
    7: ['#3a3340', '#5b5266'],   // crag
    /* ROAD: laid stone. It was packed earth — a warm brown line — which is the right colour
     * for a track and the wrong one for the highway between two Seats of Power. The cobbles
     * themselves are painted on top (see the cobble pass); this is the mortar under them, kept
     * warm enough to read against forest, meadow and crag alike. */
    8: ['#4a4340', '#655c56'],
    9: ['#52402a', '#665237']    // bridge: timber over the water
  };
  const PAL_MAX = 9;
  const lerp = (a, b, t) => {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const r = ((pa >> 16) & 255) + (((pb >> 16) & 255) - ((pa >> 16) & 255)) * t;
    const g = ((pa >> 8) & 255) + (((pb >> 8) & 255) - ((pa >> 8) & 255)) * t;
    const bl = (pa & 255) + ((pb & 255) - (pa & 255)) * t;
    return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (bl | 0) + ')';
  };
  /* a small stateless hash, for the per-cell decisions that must not care which tile asked */
  const cellHash = (a, b, c) => {
    let h = (a * 374761393 + b * 668265263 + (c | 0) * 1274126177) | 0;
    h = (h ^ (h >>> 13)) * 1274126177 | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  function bake(view, viewer, opts) {
    opts = opts || {};
    const map = view.map, nav = view.nav, T = global.WorldGen.T;
    /* the land's own size — the nav grid the view carries is the truth of it, so a country
     * and a board bake at their own dimensions without asking a global */
    const MW = nav.W * nav.cw, MH = nav.H * nav.cw, cw = nav.cw;
    /* THE WINDOW. Without one this is the whole land (every board today); with one it is a
     * detail tile: the same paint, clipped. The tile is painted with a PAD of ground beyond
     * its edge and cropped back, so the blur never samples the void and two abutting tiles
     * meet on identical pixels. */
    const rect = opts.rect || null;
    const pad = rect ? cw * 2 : 0;
    const RX0 = rect ? Math.max(0, rect.x0 - pad) : 0, RY0 = rect ? Math.max(0, rect.y0 - pad) : 0;
    const RX1 = rect ? Math.min(MW, rect.x1 + pad) : MW, RY1 = rect ? Math.min(MH, rect.y1 + pad) : MH;
    const RW = RX1 - RX0, RH = RY1 - RY0;
    /* cap the longest edge (WebGL limits) and the total pixels, so a big board never asks
     * a phone for a thirty-megapixel canvas; a tile may name its own resolution */
    const px = opts.px || Math.min(1.4, 4000 / Math.max(RW, RH), Math.sqrt(6.0e6 / (RW * RH)));
    const cv2 = document.createElement('canvas');
    cv2.width = Math.ceil(RW * px); cv2.height = Math.ceil(RH * px);
    const g = cv2.getContext('2d');
    g.scale(px, px);
    g.translate(-RX0, -RY0);   // everything below paints in WORLD coordinates
    const seed = view.mapSeed || 7;
    const rng = global.RNG.make(seed);

    g.fillStyle = '#0a0810'; g.fillRect(RX0, RY0, RW, RH);

    /* ---- the land itself, cell by cell, shaded by height ---- */
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < nav.elev.length; i++) {
      const e = nav.elev[i];
      if (e < lo) lo = e;
      if (e > hi) hi = e;
    }
    const span = Math.max(1e-6, hi - lo);
    const gx0 = Math.max(0, Math.floor(RX0 / cw)), gx1 = Math.min(nav.W - 1, Math.floor((RX1 - 1) / cw));
    const gy0 = Math.max(0, Math.floor(RY0 / cw)), gy1 = Math.min(nav.H - 1, Math.floor((RY1 - 1) / cw));
    const trees = [], rocks = [], waters = [], roads = [];
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const i = gy * nav.W + gx, t = nav.terra[i];
        const h = (nav.elev[i] - lo) / span;
        const X = gx * cw, Y = gy * cw;
        g.fillStyle = lerp(PAL[t][0], PAL[t][1], Math.max(0, Math.min(1, h)));
        g.fillRect(X - 0.6, Y - 0.6, cw + 1.2, cw + 1.2);
        const cx = X + cw / 2, cy = Y + cw / 2;
        /* placements draw from the CELL, not the walk of a shared rng, so a tile and the
         * full land agree about every tree — and so did the old draw-count discipline, which
         * this replaces outright: a hash cannot fall out of step because it has no step */
        const h1 = cellHash(gx, gy, seed), h2 = cellHash(gy, gx, seed + 131), h3 = cellHash(gx + 7, gy + 3, seed + 977);
        if (t === T.WATER) waters.push([cx, cy, cw]);
        else if (t === T.ROAD) roads.push([gx, gy]);
        else if (t === T.FOREST) {
          if (h1 < 0.72) trees.push([cx + (h2 - 0.5) * 14, cy + (h3 - 0.5) * 14, 7 + h1 * 8.3, h2]);
        } else if (t === T.CLIFF) {
          /* A ROCK STAYS INSIDE ITS OWN CELL WHERE THE CELL HAS A PASSABLE NEIGHBOUR. The sim
           * refuses a CLIFF cell exactly at its edge; a mesh at centre ±5 with radius up to 18
           * reaches 23 from centre against a half-cell of 10 — thirteen units of stone hanging
           * over ground men may lawfully stand on, which is a whole man deep. Reported from
           * play as troops "entering the rock", and the sim was never wrong. Boundary cells
           * (36% of cliff on a measured board) get a rock that fits; the interior keeps the
           * big jumble, which is what a massif's silhouette is made of. */
          const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
            const nx = gx + dx, ny = gy + dy;
            return nx >= 0 && ny >= 0 && nx < nav.W && ny < nav.H && nav.cost[ny * nav.W + nx] > 0;
          });
          const j = (h1 - 0.5) * 10, j2 = (h2 - 0.5) * 10, r = 11 + h3 * 7;
          if (edge) {
            const fit = (cw / 2) / 23;   // scale centre-plus-radius 23 down to the half-cell
            rocks.push([cx + j * fit, cy + j2 * fit, r * fit, h3]);
          } else rocks.push([cx + j, cy + j2, r, h3]);
        }
      }
    }

    /* ---- relief: a soft shadow on every slope facing away from the light ---- */
    g.save();
    for (let gy = Math.max(1, gy0); gy <= gy1; gy++) {
      for (let gx = Math.max(1, gx0); gx <= gx1; gx++) {
        const i = gy * nav.W + gx;
        const slope = (nav.elev[i] - nav.elev[i - 1]) + (nav.elev[i] - nav.elev[i - nav.W]);
        if (Math.abs(slope) < 0.004) continue;
        g.globalAlpha = Math.min(0.5, Math.abs(slope) * 9);
        g.fillStyle = slope > 0 ? 'rgba(255,240,210,0.5)' : 'rgba(0,0,10,0.85)';
        g.fillRect(gx * cw - 0.6, gy * cw - 0.6, cw + 1.2, cw + 1.2);
      }
    }
    g.restore();

    /* ---- soften the grid: one blur over the land, before anything is placed on it ---- */
    if (typeof g.filter === 'string') {
      const tmp = document.createElement('canvas');
      tmp.width = cv2.width; tmp.height = cv2.height;
      tmp.getContext('2d').drawImage(cv2, 0, 0);
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.filter = 'blur(' + Math.max(2.5, cw * px * 0.5) + 'px)';
      g.clearRect(0, 0, cv2.width, cv2.height);
      g.drawImage(tmp, 0, 0);
      g.filter = 'none';
      g.restore();
    }

    /* ---- WATER IS ONE BODY, AND ITS DEPTH IS ITS WIDTH ----
     * This was a radial gradient PER CELL, each one drawn straight onto the finished land at
     * 0.95 in the middle. Two things followed and both are visible from orbit: the alphas
     * COMPOUND where discs overlap, so a river came out as a chain of beads with a bright core
     * in every cell and a scalloped bank; and the whole pass landed AFTER the blur that softens
     * the rest of the world, so a hard saturated blue cutout sat on top of a painterly
     * landscape. Reported from play as "that river looks very weird", and a baked tile shows it
     * plainly: a pile of stamped circles.
     * A body of water is ONE thing, so it is composited ONCE. The cells go into their own layer
     * at full alpha — no compounding possible — the layer is blurred, which is what turns a run
     * of squares into a channel with banks, and the result is laid down in a single draw.
     * AND THE DEPTH COMES FOR FREE. The same mask blurred HARDER keeps its alpha in the middle
     * of a lake and loses it in a one-cell river, because a narrow thing blurs away and a broad
     * one does not — so painting the deep colour through that second mask makes a lake dark at
     * the heart and pale at the shoal, and leaves a river light all the way across. That is the
     * right answer for both, from the geometry itself, with no rule about which is which. */
    if (waters.length && typeof g.filter === 'string') {
      /* ---- AND ONLY OVER ITS OWN EXTENT ----
       * Every pass here used to allocate two canvases the size of the whole TILE and clear one
       * of them three times over — 1320 square, five million pixel writes, paid in full for a
       * channel crossing one corner. Measured on this box's software canvas: the tile bake went
       * from 81ms to 199ms for the water alone, and the tile bake IS the hitch budget, one per
       * frame while the camera moves. It was never the blur; it was the paperwork.
       * So the scratch is the size of the WATER, not the size of the tile, and the transform
       * carries world coordinates into it. */
      const soft = Math.min(rect ? (pad * px) / (1.5 * 3.4) : Infinity,
                            Math.max(2.0, cw * px * 0.42));
      const M = soft * 3.4 * 1.6;      // the widest blur's reach, which bounds every layer
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [wx, wy, r] of waters) {
        const ax = (wx - RX0) * px, ay = (wy - RY0) * px, hw = (r / 2 + 1) * px;
        if (ax - hw < x0) x0 = ax - hw;
        if (ay - hw < y0) y0 = ay - hw;
        if (ax + hw > x1) x1 = ax + hw;
        if (ay + hw > y1) y1 = ay + hw;
      }
      const bx = Math.max(0, Math.floor(x0 - M)), by = Math.max(0, Math.floor(y0 - M));
      const bw = Math.min(cv2.width, Math.ceil(x1 + M)) - bx;
      const bh = Math.min(cv2.height, Math.ceil(y1 + M)) - by;
      if (bw > 0 && bh > 0) {
        const shape = document.createElement('canvas');
        shape.width = bw; shape.height = bh;
        const sg = shape.getContext('2d');
        /* world coordinates straight into the sub-canvas */
        sg.setTransform(px, 0, 0, px, -RX0 * px - bx, -RY0 * px - by);
        sg.fillStyle = '#fff';
        /* the cells, whole and opaque — the mask is a SHAPE, and a shape has no alpha to add */
        for (const [wx, wy, r] of waters) sg.fillRect(wx - r / 2 - 0.6, wy - r / 2 - 0.6, r + 1.2, r + 1.2);
        const wcv = document.createElement('canvas');
        wcv.width = bw; wcv.height = bh;
        const wg = wcv.getContext('2d');
        const layer = (blurPx, colour, alpha) => {
          wg.setTransform(1, 0, 0, 1, 0, 0);
          wg.clearRect(0, 0, bw, bh);
          /* blur the shape into the scratch: the bank, and the reason a channel is a channel */
          wg.filter = 'blur(' + blurPx + 'px)';
          wg.drawImage(shape, 0, 0);
          wg.filter = 'none';
          /* colour the shape through itself, so the alpha is the mask's and nothing else */
          wg.globalCompositeOperation = 'source-in';
          wg.fillStyle = colour;
          wg.fillRect(0, 0, bw, bh);
          wg.globalCompositeOperation = 'source-over';
          g.save();
          g.setTransform(1, 0, 0, 1, 0, 0);
          g.globalAlpha = alpha;
          g.drawImage(wcv, bx, by);
          g.restore();
        };
        /* THE BANK FIRST, so the water sits IN the ground rather than on it: a wide, weak wash
         * of wet earth reaching further than the water does. Without it the body has a soft
         * edge but the LAND has a hard one, and the eye reads a decal either way. */
        layer(soft * 3.4, 'rgb(46,40,30)', 0.34);
        layer(soft, 'rgb(26,58,84)', 0.90);          // the body, banks and all
        layer(soft * 2.6, 'rgb(9,20,36)', 0.85);     // the deep, which only broad water reaches
      }
      /* ---- and the light on it ----
       * A few long, faint crests, in the INTERIOR only: the old ones were struck on any water
       * cell including the bank, at an alpha that read as a scratch on a hard blue decal. On a
       * body with a soft edge they are the one thing that says the surface moves. */
      for (const [wx, wy, r] of waters) {
        const gx2 = (wx / cw) | 0, gy2 = (wy / cw) | 0;
        let deep = true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const i2 = (gy2 + dy) * nav.W + (gx2 + dx);
          if (i2 < 0 || i2 >= nav.terra.length || nav.terra[i2] !== T.WATER) { deep = false; break; }
        }
        if (!deep) continue;
        /* the crest is the CELL's, not the walk's — see the determinism note up top */
        const s1 = cellHash(gx2, gy2, seed + 5150);
        if (s1 > 0.14) continue;
        const s2 = cellHash(gy2, gx2, seed + 5151);
        g.strokeStyle = 'rgba(160,205,240,0.10)'; g.lineWidth = 1.1;
        g.beginPath();
        g.ellipse(wx + (s1 - 0.07) * 40, wy + (s2 - 0.5) * 8, r * 0.62, r * 0.13, 0, 0, 7);
        g.stroke();
      }
    }

    /* ---- A ROAD IS LAID, NOT WORN ----
     * The highway between two Seats is a built thing and should look built: cobbles, in
     * courses, with a dark bed showing between them as joints. Painted AFTER the blur, like
     * the bridge's planks and for the same reason — a paved surface has edges, and the blur is
     * what softens everything that does not.
     * IT IS ONE SURFACE, and the road learned that lesson from the water on the way. Drawn
     * first as discs per cell it came out as polka dots on earth; drawn as a paved SQUARE per
     * cell it came out as a staircase of blocks down every diagonal, which is the bead chain
     * again in another costume. So the cells go into a mask, the mask is blurred just enough
     * to take the corners off the staircase, the bed is composited through it ONCE, and the
     * stones are laid `source-atop` — clipped to that same soft shape, so a road frays at its
     * verge instead of ending on a corner.
     * DETERMINISTIC PER STONE, from the absolute (cell, stone) index rather than from a walk
     * of a shared rng: two tiles that share a road paint the same stones, which is the rule
     * every seam-crossing feature here keeps. */
    if (roads.length && typeof g.filter === 'string') {
      /* a road is DEFINED — it is not a river bank — so this is a fraction of the water's
       * blur: enough to round the staircase, not enough to lose the verge. Clamped to the pad
       * like everything else that blurs here, and the scratch is sized to the ROAD rather than
       * to the tile (see the water pass: that paperwork was the whole cost). */
      const rblur = Math.min(rect ? (pad * px) / 1.5 : Infinity, Math.max(1.5, cw * px * 0.3));
      const M = rblur * 1.6;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [gx, gy] of roads) {
        const ax = (gx * cw - RX0) * px, ay = (gy * cw - RY0) * px, aw = (cw + 1) * px;
        if (ax < x0) x0 = ax;
        if (ay < y0) y0 = ay;
        if (ax + aw > x1) x1 = ax + aw;
        if (ay + aw > y1) y1 = ay + aw;
      }
      const bx = Math.max(0, Math.floor(x0 - M)), by = Math.max(0, Math.floor(y0 - M));
      const bw = Math.min(cv2.width, Math.ceil(x1 + M)) - bx;
      const bh = Math.min(cv2.height, Math.ceil(y1 + M)) - by;
      if (bw > 0 && bh > 0) {
        const into = (ctx2) => ctx2.setTransform(px, 0, 0, px, -RX0 * px - bx, -RY0 * px - by);
        const rshape = document.createElement('canvas');
        rshape.width = bw; rshape.height = bh;
        const rs = rshape.getContext('2d');
        into(rs);
        rs.fillStyle = '#fff';
        /* overdrawn by half a unit so two neighbouring road cells leave no seam of bare ground
         * between them, and a road reads as one surface however it turns */
        for (const [gx, gy] of roads) rs.fillRect(gx * cw - 0.5, gy * cw - 0.5, cw + 1, cw + 1);
        const rcv = document.createElement('canvas');
        rcv.width = bw; rcv.height = bh;
        const rg = rcv.getContext('2d');
        rg.filter = 'blur(' + rblur + 'px)';
        rg.drawImage(rshape, 0, 0);
        rg.filter = 'none';
        /* the bed: what shows between the stones, and what the stones are laid on */
        rg.globalCompositeOperation = 'source-in';
        rg.fillStyle = 'rgb(14,12,18)';
        rg.fillRect(0, 0, bw, bh);
        /* ...and the stones, clipped to the road's own soft shape by `source-atop`, which is
         * what lets a road fray at its verge instead of ending on a corner */
        rg.globalCompositeOperation = 'source-atop';
        into(rg);
        const NST = 3, sst = cw / NST;
        const rrect = (x, y, w2, h2, r2) => {
          if (rg.roundRect) { rg.beginPath(); rg.roundRect(x, y, w2, h2, r2); rg.fill(); return; }
          rg.beginPath();
          rg.moveTo(x + r2, y); rg.arcTo(x + w2, y, x + w2, y + h2, r2);
          rg.arcTo(x + w2, y + h2, x, y + h2, r2); rg.arcTo(x, y + h2, x, y, r2);
          rg.arcTo(x, y, x + w2, y, r2); rg.closePath(); rg.fill();
        };
        for (const [gx, gy] of roads) {
          const X = gx * cw, Y = gy * cw;
          for (let j2 = 0; j2 < NST; j2++) for (let i2 = 0; i2 < NST; i2++) {
            const h1 = cellHash(gx * NST + i2, gy * NST + j2, seed + 3301);
            const h2 = cellHash(gy * NST + j2, gx * NST + i2, seed + 3302);
            /* half-stone offset on alternate courses — the one thing that stops a paved road
             * reading as the square grid it is actually drawn on */
            const cx2 = X + i2 * sst + (j2 % 2 ? sst * 0.5 : 0) + (h1 - 0.5) * sst * 0.14;
            const cy2 = Y + j2 * sst + (h2 - 0.5) * sst * 0.14;
            /* nearly the whole of their square: the gap IS the joint, and a joint is thin */
            const w3 = sst * (0.84 + h1 * 0.08), h3 = sst * (0.78 + h2 * 0.1);
            /* ONE FAMILY OF GREYS with a little spread — salt-and-pepper is not stonework, and
             * neither is a sweet shop: the three channels ran off two different hashes at
             * first, so a stone whose red came up high and blue low went yellow and its
             * neighbour went lilac. ONE hash, varying the VALUE only, with the warmth fixed. */
            const v = 92 + h2 * 40;
            rg.fillStyle = 'rgb(' + Math.round(v) + ',' + Math.round(v * 0.975) + ',' +
                                    Math.round(v * 0.93) + ')';
            rrect(cx2 + (sst - w3) / 2, cy2 + (sst - h3) / 2, w3, h3, sst * 0.22);
          }
        }
        rg.setTransform(1, 0, 0, 1, 0, 0);
        rg.globalCompositeOperation = 'source-over';
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        /* short of opaque, so the ground's own light and the relief still reach through the
         * paving — a road climbs a hill with the hill */
        g.globalAlpha = 0.86;
        g.drawImage(rcv, bx, by);
        g.restore();
      }
    }

    /* ---- a bridge is a BUILT thing: planks across the span, rails at the edges ----
     * The cells already wear timber colour; this is the carpentry the eye reads at detail
     * zoom. Deterministic per cell, so a span cut by a tile seam continues on the far side. */
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
      const i = gy * nav.W + gx;
      if (nav.terra[i] !== T.BRIDGE) continue;
      const X = gx * cw, Y = gy * cw;
      /* planks run across the water: perpendicular to the span, which runs the way the
       * neighbouring bridge/road cells do */
      const horiz = (gx > 0 && (nav.terra[i - 1] === T.BRIDGE || nav.terra[i - 1] === T.ROAD)) ||
                    (gx < nav.W - 1 && (nav.terra[i + 1] === T.BRIDGE || nav.terra[i + 1] === T.ROAD));
      g.strokeStyle = 'rgba(30,22,14,0.5)'; g.lineWidth = 1.4;
      for (let k = 1; k < 4; k++) {
        g.beginPath();
        if (horiz) { g.moveTo(X + (k / 4) * cw, Y + 1); g.lineTo(X + (k / 4) * cw, Y + cw - 1); }
        else { g.moveTo(X + 1, Y + (k / 4) * cw); g.lineTo(X + cw - 1, Y + (k / 4) * cw); }
        g.stroke();
      }
      g.strokeStyle = 'rgba(90,70,44,0.8)'; g.lineWidth = 2;
      g.beginPath();
      if (horiz) { g.moveTo(X, Y + 1.5); g.lineTo(X + cw, Y + 1.5); g.moveTo(X, Y + cw - 1.5); g.lineTo(X + cw, Y + cw - 1.5); }
      else { g.moveTo(X + 1.5, Y); g.lineTo(X + 1.5, Y + cw); g.moveTo(X + cw - 1.5, Y); g.lineTo(X + cw - 1.5, Y + cw); }
      g.stroke();
    }

    /* ---- crags and wood: painted flat for 2D, returned as placements for 3D ---- */
    if (opts.props !== false) {
      for (const [x, y, r, v] of rocks) {
        g.globalAlpha = 0.5; g.fillStyle = '#000';
        g.beginPath(); g.ellipse(x + r * 0.3, y + r * 0.5, r * 1.1, r * 0.42, 0, 0, 7); g.fill();
        g.globalAlpha = 1;
        g.fillStyle = '#39323f';
        g.beginPath(); g.moveTo(x - r, y + r * 0.5); g.lineTo(x - r * 0.35, y - r * 0.85);
        g.lineTo(x + r * 0.45, y - r * 0.6); g.lineTo(x + r, y + r * 0.5); g.closePath(); g.fill();
        g.fillStyle = v > 0.5 ? '#4e4657' : '#453d4e';
        g.beginPath(); g.moveTo(x - r * 0.35, y - r * 0.85); g.lineTo(x + r * 0.45, y - r * 0.6);
        g.lineTo(x + r * 0.1, y + r * 0.2); g.closePath(); g.fill();
        g.fillStyle = 'rgba(190,180,205,0.22)';
        g.beginPath(); g.moveTo(x - r * 0.35, y - r * 0.85); g.lineTo(x - r * 0.05, y - r * 0.3);
        g.lineTo(x - r * 0.5, y - r * 0.1); g.closePath(); g.fill();
      }
      trees.sort((a, b) => a[1] - b[1]);
      for (const [x, y, r, v] of trees) {
        const pal = v > 0.62 ? ['#232a10', '#3c4416', '#5f6626', '#8f9838']
          : v > 0.3 ? ['#131a12', '#22301c', '#33452a', '#4c6238']
          : ['#131624', '#232840', '#333a5c', '#4c5680'];
        g.globalAlpha = 0.5; g.fillStyle = '#000';
        g.beginPath(); g.ellipse(x + r * 0.3, y + r * 0.55, r * 1.05, r * 0.4, 0, 0, 7); g.fill();
        g.globalAlpha = 1;
        g.fillStyle = pal[1];
        g.beginPath(); g.arc(x, y, r, 0, 7); g.arc(x - r * 0.55, y + r * 0.25, r * 0.62, 0, 7); g.arc(x + r * 0.5, y + r * 0.28, r * 0.58, 0, 7); g.fill();
        g.fillStyle = pal[2];
        g.beginPath(); g.arc(x - r * 0.18, y - r * 0.22, r * 0.62, 0, 7); g.fill();
        g.fillStyle = pal[3]; g.globalAlpha = 0.8;
        g.beginPath(); g.arc(x - r * 0.32, y - r * 0.38, r * 0.3, 0, 7); g.fill();
        g.globalAlpha = 1;
      }
    }

    /* everything from here down is PLACED on the land — outside the window it is nothing */
    const inWin = (x, y, m) => x > RX0 - m && x < RX1 + m && y > RY0 - m && y < RY1 + m;

    /* ---- the places worth a name ---- */
    for (const s of map.sites) {
      if (!inWin(s.x, s.y, 120)) continue;
      const X = s.x, Y = s.y;
      if (s.kind === 'node') {
        /* THE GROUND ONLY HAS TO BE DAMP. A whole 2D spring used to be painted here — a black
         * drop-shadow ellipse, a blue gradient disc and two pale rings — from the days when
         * the bake WAS the spring. The pool is three-dimensional now and stands on top of all
         * of it, so the shadow read as a black moat round the water and the blue disc read as
         * nothing at all, being hidden. What a pool actually leaves on the ground it sits in
         * is wet earth, darker close in and fading out, and that is all this paints now. */
        const gr = g.createRadialGradient(X, Y, 16, X, Y, 58);
        gr.addColorStop(0, 'rgba(24,20,17,0.50)');
        gr.addColorStop(0.5, 'rgba(28,24,20,0.26)');
        gr.addColorStop(1, 'rgba(28,24,20,0)');
        g.fillStyle = gr; g.beginPath(); g.ellipse(X, Y, 58, 34, 0, 0, 7); g.fill();
      } else if (s.kind === 'vantage') {
        g.globalAlpha = 0.5; g.fillStyle = '#000';
        g.beginPath(); g.ellipse(X + 6, Y + 24, 50, 15, 0, 0, 7); g.fill(); g.globalAlpha = 1;
        const gr = g.createRadialGradient(X, Y, 6, X, Y, 62);
        gr.addColorStop(0, '#5a5264'); gr.addColorStop(0.7, '#37303f'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(X, Y, 62, 0, 7); g.fill();
        g.strokeStyle = 'rgba(200,190,220,0.32)'; g.lineWidth = 2;
        g.beginPath(); g.arc(X, Y - 4, 38, 1.1 * Math.PI, 1.9 * Math.PI); g.stroke();
      }
      if (s.kind !== 'city' && opts.labels !== false && s.name) {
        g.font = '600 13px Georgia, serif'; g.textAlign = 'center';
        g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 3; g.strokeText(s.name, X, Y + 44);
        g.fillStyle = 'rgba(222,204,164,0.85)'; g.fillText(s.name, X, Y + 44);
      }
    }

    /* ---- the courts of the Seats: ground worked bare by everyone who lives on it ----
     * EVERY Seat, not the first two. This loop was `pi < 2` from the duel days, so at a
     * three- or four-handed table the third and fourth heirs sat on untouched wilderness.
     * Painted into the bake it IS the land: it follows every slope for free, has no edge to
     * catch the eye, and costs no mesh, no transparency and no z-fighting. Each court paints
     * from ITS OWN seed — a court on a tile seam must be the same court on both sides. */
    for (let pi = 0; pi < map.cities.length; pi++) {
      const cs = map.sites[map.cities[pi]];
      if (!cs || !inWin(cs.x, cs.y, 400)) continue;
      const crng = global.RNG.make((seed ^ (map.cities[pi] * 2654435761)) >>> 0);
      /* THE GROUND UNDER A COURT IS ITS HOLDER'S, not its founder's. This was `pi === viewer`,
       * decided by the seat an heir was born to, so the country around a city you had taken
       * went on glowing in the enemy's colours until the end of the war. `courtOwn` is the one
       * answer, asked of the city list the sim actually keeps. */
      const X = cs.x, Y = cs.y, own = courtOwn(view, viewer, pi), R0 = C.CITY.r;
      /* the far glow — the realm's colour bleeding into the country around the Seat */
      const gr = g.createRadialGradient(X, Y, 20, X, Y, 330);
      gr.addColorStop(0, own ? 'rgba(120,96,44,0.34)' : 'rgba(110,44,54,0.26)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(X, Y, 330, 0, 7); g.fill();
      /* the court proper: earth beaten bare, faded out long before its edge so there is no
       * circle to see. The old disc's hard rim was half of why it read as a sticker. */
      const ct = g.createRadialGradient(X, Y, R0 * 0.15, X, Y, R0 * 1.12);
      ct.addColorStop(0, own ? 'rgba(74,58,30,0.55)' : 'rgba(70,34,36,0.50)');
      ct.addColorStop(0.62, own ? 'rgba(60,47,26,0.32)' : 'rgba(58,29,32,0.28)');
      ct.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = ct; g.beginPath(); g.arc(X, Y, R0 * 1.12, 0, 7); g.fill();
      /* tracks worn out of it by everything that has ever marched off this ground */
      g.lineCap = 'round';
      for (let k = 0; k < 7; k++) {
        const a = crng.next() * 6.283, x2 = X + Math.cos(a) * R0 * 1.06, y2 = Y + Math.sin(a) * R0 * 1.06;
        const tg = g.createLinearGradient(X, Y, x2, y2);
        tg.addColorStop(0, 'rgba(96,78,44,0.30)'); tg.addColorStop(1, 'rgba(96,78,44,0)');
        g.strokeStyle = tg; g.lineWidth = 9 + crng.next() * 13;
        g.beginPath(); g.moveTo(X, Y); g.lineTo(x2, y2); g.stroke();
      }
      /* gravel and broken flag, so there is something for the eye to land on up close */
      for (let k = 0; k < 260; k++) {
        const a = crng.next() * 6.283, r = Math.sqrt(crng.next()) * R0 * 1.05;
        const f = 1 - r / (R0 * 1.05);
        g.globalAlpha = (0.05 + crng.next() * 0.13) * f;
        g.fillStyle = crng.next() < 0.42 ? '#0d0a08' : (own ? '#b49a62' : '#a8737a');
        const s2 = 1.6 + crng.next() * 3.4;
        g.fillRect(X + Math.cos(a) * r, Y + Math.sin(a) * r, s2, s2 * (0.6 + crng.next() * 0.8));
      }
      g.globalAlpha = 1;
    }

    /* the world dissolves into Shadow at its rim — the LAND's rim, so only a window that
     * contains it paints it */
    for (const [x0, y0, x1, y1] of [[0, 0, 0, 70], [0, MH, 0, MH - 70], [0, 0, 70, 0], [MW, 0, MW - 70, 0]]) {
      const gr = (x0 === x1) ? g.createLinearGradient(0, y0, 0, y1) : g.createLinearGradient(x0, 0, x1, 0);
      gr.addColorStop(0, 'rgba(8,6,14,0.95)'); gr.addColorStop(1, 'rgba(8,6,14,0)');
      g.fillStyle = gr; g.fillRect(RX0, RY0, RW, RH);
    }
    /* speckle by area, wherever the window is — the full land keeps its six thousand */
    const nSpeck = Math.round(6000 * (RW * RH) / (MW * MH));
    for (let i = 0; i < nSpeck; i++) {
      g.globalAlpha = 0.04 + rng.next() * 0.06;
      g.fillStyle = rng.next() < 0.5 ? '#000' : '#c8b890';
      g.fillRect(RX0 + rng.next() * RW, RY0 + rng.next() * RH, 1.6, 1.6);
    }
    g.globalAlpha = 1;
    /* a tile is cropped back to its exact rect, so the blur's edge never shows and two
     * neighbours meet on identical ground */
    if (rect) {
      const out = document.createElement('canvas');
      out.width = Math.ceil((rect.x1 - rect.x0) * px);
      out.height = Math.ceil((rect.y1 - rect.y0) * px);
      out.getContext('2d').drawImage(cv2, (RX0 - rect.x0) * px, (RY0 - rect.y0) * px);
      return { canvas: out, trees, rocks };
    }
    return { canvas: cv2, trees, rocks };
  }

  /* WHOSE COURT. Warm for the ground your banner holds, cold for a rival's — and the ground
   * bake has no palette beyond those two, deliberately: it is a wash under everything else,
   * and sixteen tinted courts would fight the terrain it is painted into. The MARKS on the
   * map (the Seat itself, its bar, its dot on the minimap) carry the banner's own colour.
   * A yielded court reads as a rival's: it is not yours, and that is the whole of what this
   * wash has to say. Tolerant of a view with no city list — a board, a chronicle's
   * half-world — where a seat is its heir's forever. */
  function courtOwn(view, viewer, pi) {
    const c = view.cities && view.cities[pi];
    if (!c) return pi === viewer;
    if (c.owner < 0) return false;
    const W = global.World;
    return W && W.realmOf ? W.realmOf(view, c.owner) === W.realmOf(view, viewer) : c.owner === viewer;
  }

  /* ---------------- the whole land, cheaply ----------------
   * One ImageData pass: a colour per nav cell, the relief mixed in arithmetically, water
   * flat, the courts as a handful of gradients on top. No per-cell gradients, no props, no
   * rng walk — this is what sits UNDER the detail tiles on a country, and it costs
   * milliseconds at any size because it touches every cell exactly once. Returns the same
   * shape `bake` returns, with the placements from the same per-cell hashes, so the raised
   * forests and crags are identical whichever pass placed them. */
  function bakeBase(view, viewer) {
    const map = view.map, nav = view.nav, T = global.WorldGen.T;
    const MW = nav.W * nav.cw, MH = nav.H * nav.cw, cw = nav.cw;
    const seed = view.mapSeed || 7;
    const px = Math.min(1.4, 4000 / Math.max(MW, MH), Math.sqrt(6.0e6 / (MW * MH)));
    const cv2 = document.createElement('canvas');
    cv2.width = Math.ceil(MW * px); cv2.height = Math.ceil(MH * px);
    const g = cv2.getContext('2d');
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < nav.elev.length; i++) {
      const e = nav.elev[i];
      if (e < lo) lo = e;
      if (e > hi) hi = e;
    }
    const span = Math.max(1e-6, hi - lo);
    /* the palette, decoded once — parsing a hex string per cell would be the slow bake again */
    const palLo = [], palHi = [];
    for (let t = 1; t <= PAL_MAX; t++) {
      palLo[t] = parseInt(PAL[t][0].slice(1), 16);
      palHi[t] = parseInt(PAL[t][1].slice(1), 16);
    }
    const im = g.createImageData(nav.W, nav.H);
    const d = im.data;
    const trees = [], rocks = [];
    for (let gy = 0; gy < nav.H; gy++) {
      for (let gx = 0; gx < nav.W; gx++) {
        const i = gy * nav.W + gx, t = nav.terra[i];
        const h = Math.max(0, Math.min(1, (nav.elev[i] - lo) / span));
        const a = palLo[t], b = palHi[t];
        let r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * h);
        let gc = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * h);
        let bl = (a & 255) + (((b & 255) - (a & 255)) * h);
        /* the relief, folded straight into the colour */
        if (gx > 0 && gy > 0) {
          const slope = (nav.elev[i] - nav.elev[i - 1]) + (nav.elev[i] - nav.elev[i - nav.W]);
          const s = Math.max(-0.5, Math.min(0.5, slope * 9)) * (slope > 0 ? 60 : 90);
          r += s; gc += s; bl += s * 0.8;
        }
        const o = i * 4;
        d[o] = Math.max(0, Math.min(255, r));
        d[o + 1] = Math.max(0, Math.min(255, gc));
        d[o + 2] = Math.max(0, Math.min(255, bl));
        d[o + 3] = 255;
        /* the same placements the painterly pass would have made — same hashes, same trees */
        const cx = gx * cw + cw / 2, cy = gy * cw + cw / 2;
        const h1 = cellHash(gx, gy, seed), h2 = cellHash(gy, gx, seed + 131), h3 = cellHash(gx + 7, gy + 3, seed + 977);
        if (t === T.FOREST) {
          if (h1 < 0.72) trees.push([cx + (h2 - 0.5) * 14, cy + (h3 - 0.5) * 14, 7 + h1 * 8.3, h2]);
        } else if (t === T.CLIFF) {
          const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
            const nx = gx + dx, ny = gy + dy;
            return nx >= 0 && ny >= 0 && nx < nav.W && ny < nav.H && nav.cost[ny * nav.W + nx] > 0;
          });
          const j = (h1 - 0.5) * 10, j2 = (h2 - 0.5) * 10, rr = 11 + h3 * 7;
          if (edge) {
            const fit = (cw / 2) / 23;
            rocks.push([cx + j * fit, cy + j2 * fit, rr * fit, h3]);
          } else rocks.push([cx + j, cy + j2, rr, h3]);
        }
      }
    }
    /* one cell per pixel, stretched — the far view cannot resolve more anyway */
    const cellCv = document.createElement('canvas');
    cellCv.width = nav.W; cellCv.height = nav.H;
    cellCv.getContext('2d').putImageData(im, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(cellCv, 0, 0, cv2.width, cv2.height);
    /* the courts, so a far view still shows whose country it is */
    g.save();
    g.scale(px, px);
    for (let pi = 0; pi < map.cities.length; pi++) {
      const cs = map.sites[map.cities[pi]];
      if (!cs) continue;
      const own = courtOwn(view, viewer, pi);
      const gr = g.createRadialGradient(cs.x, cs.y, 20, cs.x, cs.y, 330);
      gr.addColorStop(0, own ? 'rgba(120,96,44,0.4)' : 'rgba(110,44,54,0.32)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(cs.x, cs.y, 330, 0, 7); g.fill();
    }
    g.restore();
    return { canvas: cv2, trees, rocks };
  }

  /* ---------------- the edge of your writ ----------------
   * The claim is a UNION of discs, and a union of discs has no closed-form outline — but it
   * does have an exact one if you walk each circle and keep only the arc that is not swallowed
   * by another disc. Returns line segments in world space, smooth rather than stair-stepped,
   * and cheap enough to redo whenever a Gate rises or falls.
   * Shared so both renderers draw the SAME boundary the sim enforces. */
  function claimOutline(anchors) {
    const segs = [], N = 96;
    for (const a of anchors) {
      /* only a disc that can actually overlap this one can bury any of its arc — pairs
       * further apart than the sum of their radii are skipped before the 96-point walk,
       * which is what keeps a country's worth of discs from costing anchors²×96 */
      const near = anchors.filter((b) => {
        if (b === a) return false;
        const dx = a.x - b.x, dy = a.y - b.y, rr = a.r + b.r;
        return dx * dx + dy * dy < rr * rr;
      });
      let prev = null;
      for (let i = 0; i <= N; i++) {
        const th = (i / N) * Math.PI * 2;
        const x = a.x + Math.cos(th) * a.r, y = a.y + Math.sin(th) * a.r;
        let buried = false;
        for (const b of near) {
          const dxb = x - b.x, dyb = y - b.y;
          if (dxb * dxb + dyb * dyb < b.r * b.r - 1) { buried = true; break; }
        }
        if (buried) { prev = null; continue; }
        if (prev) segs.push([prev[0], prev[1], x, y]);
        prev = [x, y];
      }
    }
    return segs;
  }
  /* The discs your writ is made of: the Seat, and every FINISHED work that carries a claim.
   * A shell claims nothing — `World.inClaim` has always required `!b.raise` — so drawing the
   * line around a Gate still going up promised ground the sim would refuse to build on. The
   * outline is a picture of the rule and has to be the same rule. */
  function claimAnchors(view, viewer) {
    const me = view.players[viewer], out = [];
    const seat = view.map.sites[view.map.cities[viewer]];
    out.push({ x: seat.x, y: seat.y, r: C.CLAIM.seat });
    for (const b of me.buildings)
      if (!b.raise && C.BUILDINGS[b.bt] && C.BUILDINGS[b.bt].claim) out.push({ x: b.x, y: b.y, r: C.CLAIM.gate });
    return out;
  }
  const claimKey = (anchors) => anchors.map((a) => (a.x | 0) + ',' + (a.y | 0) + ',' + a.r).join(';');

  global.Terrain = { bake, bakeBase, claimOutline, claimAnchors, claimKey };
})(typeof window !== 'undefined' ? window : globalThis);

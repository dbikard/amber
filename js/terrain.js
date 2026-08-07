/* terrain.js — the painterly bake for the one renderer (js/render3d.js drapes it over a
 * relief mesh built from the SAME elevation the sim walks on).
 *
 * There are no authored paths any more, so there is nothing here that invents geography:
 * every pixel is read off the world's own elevation and terrain grids. What you see is
 * what blocks you, what slows you, and what you can build on.
 *
 * opts.props=false skips painting trees and crags and returns their placements instead
 * (the 3D renderer raises real ones). Returns { canvas, trees, rocks }. */
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
    7: ['#3a3340', '#5b5266']    // crag
  };
  const lerp = (a, b, t) => {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const r = ((pa >> 16) & 255) + (((pb >> 16) & 255) - ((pa >> 16) & 255)) * t;
    const g = ((pa >> 8) & 255) + (((pb >> 8) & 255) - ((pa >> 8) & 255)) * t;
    const bl = (pa & 255) + ((pb & 255) - (pa & 255)) * t;
    return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (bl | 0) + ')';
  };

  function bake(view, viewer, opts) {
    opts = opts || {};
    const map = view.map, nav = view.nav, T = global.WorldGen.T;
    /* cap the longest edge (WebGL limits) and the total pixels, so a big board never asks
     * a phone for a thirty-megapixel canvas */
    const px = Math.min(1.4, 4000 / Math.max(C.MAP.W, C.MAP.H), Math.sqrt(6.0e6 / (C.MAP.W * C.MAP.H)));
    const cv2 = document.createElement('canvas');
    cv2.width = Math.ceil(C.MAP.W * px); cv2.height = Math.ceil(C.MAP.H * px);
    const g = cv2.getContext('2d');
    g.scale(px, px);
    const rng = global.RNG.make(view.mapSeed || 7);
    const MW = C.MAP.W, MH = C.MAP.H, cw = nav.cw;

    g.fillStyle = '#0a0810'; g.fillRect(0, 0, MW, MH);

    /* ---- the land itself, cell by cell, shaded by height ---- */
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < nav.elev.length; i++) {
      const e = nav.elev[i];
      if (e < lo) lo = e;
      if (e > hi) hi = e;
    }
    const span = Math.max(1e-6, hi - lo);
    const trees = [], rocks = [], waters = [];
    for (let gy = 0; gy < nav.H; gy++) {
      for (let gx = 0; gx < nav.W; gx++) {
        const i = gy * nav.W + gx, t = nav.terra[i];
        const h = (nav.elev[i] - lo) / span;
        const X = gx * cw, Y = gy * cw;
        g.fillStyle = lerp(PAL[t][0], PAL[t][1], Math.max(0, Math.min(1, h)));
        g.fillRect(X - 0.6, Y - 0.6, cw + 1.2, cw + 1.2);
        const cx = X + cw / 2, cy = Y + cw / 2;
        if (t === T.WATER) waters.push([cx, cy, cw]);
        else if (t === T.FOREST) { if (rng.next() < 0.72) trees.push([cx + rng.range(-7, 7), cy + rng.range(-7, 7), rng.range(7, 13), rng.next()]); }
        else if (t === T.CLIFF) {
          /* A ROCK STAYS INSIDE ITS OWN CELL WHERE THE CELL HAS A PASSABLE NEIGHBOUR. The sim
           * refuses a CLIFF cell exactly at its edge; a mesh at centre ±5 with radius up to 18
           * reaches 23 from centre against a half-cell of 10 — thirteen units of stone hanging
           * over ground men may lawfully stand on, which is a whole man deep. Reported from
           * play as troops "entering the rock", and the sim was never wrong. Boundary cells
           * (36% of cliff on a measured board) get a rock that fits; the interior keeps the
           * big jumble, which is what a massif's silhouette is made of. Same RNG DRAW COUNT on
           * both paths, or every tree and rock after the first ridge reshuffles. */
          const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
            const nx = gx + dx, ny = gy + dy;
            return nx >= 0 && ny >= 0 && nx < nav.W && ny < nav.H && nav.cost[ny * nav.W + nx] > 0;
          });
          const j = rng.range(-5, 5), j2 = rng.range(-5, 5), r = rng.range(11, 18);
          if (edge) {
            const fit = (cw / 2) / 23;   // scale centre-plus-radius 23 down to the half-cell
            rocks.push([cx + j * fit, cy + j2 * fit, r * fit, rng.next()]);
          } else rocks.push([cx + j, cy + j2, r, rng.next()]);
        }
      }
    }

    /* ---- relief: a soft shadow on every slope facing away from the light ---- */
    g.save();
    for (let gy = 1; gy < nav.H; gy++) {
      for (let gx = 1; gx < nav.W; gx++) {
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

    /* ---- water reads as one body, not a grid of squares ---- */
    for (const [x, y, r] of waters) {
      const gr = g.createRadialGradient(x, y, 0, x, y, r * 1.35);
      gr.addColorStop(0, 'rgba(20,44,70,0.95)'); gr.addColorStop(0.7, 'rgba(14,32,54,0.7)');
      gr.addColorStop(1, 'rgba(10,24,40,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r * 1.35, 0, 7); g.fill();
    }
    for (const [x, y, r] of waters) {
      if (rng.next() > 0.22) continue;
      g.strokeStyle = 'rgba(150,200,240,0.16)'; g.lineWidth = 1.2;
      g.beginPath(); g.ellipse(x + rng.range(-6, 6), y + rng.range(-5, 5), r * 0.5, r * 0.18, 0, 0, 7); g.stroke();
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

    /* ---- the places worth a name ---- */
    for (const s of map.sites) {
      const X = s.x, Y = s.y;
      if (s.kind === 'node') {
        g.globalAlpha = 0.5; g.fillStyle = '#000';
        g.beginPath(); g.ellipse(X + 3, Y + 8, 42, 16, 0, 0, 7); g.fill(); g.globalAlpha = 1;
        const gr = g.createRadialGradient(X, Y, 2, X, Y, 36);
        gr.addColorStop(0, '#4a86b0'); gr.addColorStop(0.55, '#1c3448'); gr.addColorStop(1, 'rgba(12,22,34,0)');
        g.fillStyle = gr; g.beginPath(); g.ellipse(X, Y, 35, 15, 0, 0, 7); g.fill();
        g.strokeStyle = 'rgba(150,200,240,0.4)'; g.lineWidth = 1.4;
        g.beginPath(); g.ellipse(X, Y, 34, 14, 0, 0, 7); g.stroke();
        g.beginPath(); g.ellipse(X, Y, 20, 8, 0, 0, 7); g.stroke();
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
     * And this is now the ONLY court. The renderer used to stamp a flat opaque CircleGeometry
     * over the top of this — reported from play as an ugly brown disc, and it was three wrongs
     * at once: a paint-bucket colour on a board that is painterly everywhere else, a PLANAR
     * circle on ground that is not planar (cutting into the hill on one side, floating on the
     * other), and a hard rim with no falloff. Painted into the bake instead it IS the land:
     * it follows every slope for free, it has no edge to catch the eye, and it costs no mesh,
     * no transparency and no z-fighting. */
    for (let pi = 0; pi < map.cities.length; pi++) {
      const cs = map.sites[map.cities[pi]];
      if (!cs) continue;
      const X = cs.x, Y = cs.y, own = pi === viewer, R0 = C.CITY.r;
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
        const a = rng.next() * 6.283, x2 = X + Math.cos(a) * R0 * 1.06, y2 = Y + Math.sin(a) * R0 * 1.06;
        const tg = g.createLinearGradient(X, Y, x2, y2);
        tg.addColorStop(0, 'rgba(96,78,44,0.30)'); tg.addColorStop(1, 'rgba(96,78,44,0)');
        g.strokeStyle = tg; g.lineWidth = 9 + rng.next() * 13;
        g.beginPath(); g.moveTo(X, Y); g.lineTo(x2, y2); g.stroke();
      }
      /* gravel and broken flag, so there is something for the eye to land on up close */
      for (let k = 0; k < 260; k++) {
        const a = rng.next() * 6.283, r = Math.sqrt(rng.next()) * R0 * 1.05;
        const f = 1 - r / (R0 * 1.05);
        g.globalAlpha = (0.05 + rng.next() * 0.13) * f;
        g.fillStyle = rng.next() < 0.42 ? '#0d0a08' : (own ? '#b49a62' : '#a8737a');
        const s2 = 1.6 + rng.next() * 3.4;
        g.fillRect(X + Math.cos(a) * r, Y + Math.sin(a) * r, s2, s2 * (0.6 + rng.next() * 0.8));
      }
      g.globalAlpha = 1;
    }

    /* the world dissolves into Shadow at its rim */
    for (const [x0, y0, x1, y1] of [[0, 0, 0, 70], [0, MH, 0, MH - 70], [0, 0, 70, 0], [MW, 0, MW - 70, 0]]) {
      const gr = (x0 === x1) ? g.createLinearGradient(0, y0, 0, y1) : g.createLinearGradient(x0, 0, x1, 0);
      gr.addColorStop(0, 'rgba(8,6,14,0.95)'); gr.addColorStop(1, 'rgba(8,6,14,0)');
      g.fillStyle = gr; g.fillRect(0, 0, MW, MH);
    }
    for (let i = 0; i < 6000; i++) {
      g.globalAlpha = 0.04 + rng.next() * 0.06;
      g.fillStyle = rng.next() < 0.5 ? '#000' : '#c8b890';
      g.fillRect(rng.next() * MW, rng.next() * MH, 1.6, 1.6);
    }
    g.globalAlpha = 1;
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
      let prev = null;
      for (let i = 0; i <= N; i++) {
        const th = (i / N) * Math.PI * 2;
        const x = a.x + Math.cos(th) * a.r, y = a.y + Math.sin(th) * a.r;
        let buried = false;
        for (const b of anchors) {
          if (b === a) continue;
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

  global.Terrain = { bake, claimOutline, claimAnchors, claimKey };
})(typeof window !== 'undefined' ? window : globalThis);

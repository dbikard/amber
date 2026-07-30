/* terrain.js — the painterly terrain bake, shared by BOTH renderers (Pixi 2D drapes it
 * flat; Three 3D drapes it over a rolling ground mesh). Bakes in DISPLAY space (viewer's
 * own city at the bottom): the 2D renderer uses it directly; the 3D renderer rotates the
 * texture 180° for the guest and converts returned points back to world coords.
 * opts.trees=false skips painting trees and instead returns their placements (3D grows
 * real ones). Returns { canvas, trees:[[x,y,r,v]...], pathPts:[[x,y]...] }. */
(function (global) {
  'use strict';

  const C = global.CONST;
  const dx = (x, viewer) => (viewer === 0 ? x : C.MAP.W - x);
  const dy = (y, viewer) => (viewer === 0 ? y : C.MAP.H - y);

  function edgeCurve(map, ei, viewer) {
    const [ai, bi] = map.edges[ei];
    const A = map.sites[ai], B2 = map.sites[bi];
    const rng = global.RNG.make(1000 + ei * 17);
    const jx = rng.range(-26, 26), jy = rng.range(-16, 16);
    const ax = dx(A.x, viewer), ay = dy(A.y, viewer), bx = dx(B2.x, viewer), by = dy(B2.y, viewer);
    return { ax, ay, bx, by, mx: (ax + bx) / 2 + (viewer === 0 ? jx : -jx), my: (ay + by) / 2 + (viewer === 0 ? jy : -jy) };
  }
  function sampleEdge(e, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t2 = i / n, u = 1 - t2;
      pts.push([u * u * e.ax + 2 * u * t2 * e.mx + t2 * t2 * e.bx,
                u * u * e.ay + 2 * u * t2 * e.my + t2 * t2 * e.by]);
    }
    return pts;
  }

  function bake(view, viewer, opts) {
    opts = opts || {};
    const S = global.SPRITES;
    const map = view.map;
    const px = Math.min(1.6, 4090 / C.MAP.H);
    const cv2 = document.createElement('canvas');
    cv2.width = Math.ceil(C.MAP.W * px); cv2.height = Math.ceil(C.MAP.H * px);
    const g = cv2.getContext('2d');
    g.scale(px, px);
    const rng = global.RNG.make(view.mapSeed || 7);
    const MW = C.MAP.W, MH = C.MAP.H;

    /* base ground: ashen north → shadow midlands → golden Arden south */
    const base = g.createLinearGradient(0, 0, 0, MH);
    base.addColorStop(0, '#2a1216'); base.addColorStop(0.28, '#1d141f');
    base.addColorStop(0.55, '#171320'); base.addColorStop(0.78, '#1d1a16');
    base.addColorStop(1, '#2a2414');
    g.fillStyle = base; g.fillRect(0, 0, MW, MH);

    for (let i = 0; i < 90; i++) {
      const y = rng.next() * MH, x = rng.next() * MW, r = rng.range(60, 190);
      const band = y < MH * 0.33 ? ['#38181c', '#301a24'] : y > MH * 0.66 ? ['#332c14', '#2c2a12'] : ['#201a2c', '#1a1626'];
      const col = band[Math.floor(rng.next() * band.length)];
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = 0.35; g.fillStyle = gr;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    g.globalAlpha = 1;

    /* corruption bleeding from the black road spine */
    const spine = new Set(map.roads.concat(map.cities));
    const pathPts = [];
    for (let ei = 0; ei < map.edges.length; ei++) {
      const [ai, bi] = map.edges[ei];
      const e = edgeCurve(map, ei, viewer);
      const pts = sampleEdge(e, 26);
      for (const p of pts) pathPts.push(p);
      if (spine.has(ai) && spine.has(bi)) {
        for (let i = 0; i < pts.length; i += 3) {
          const [x, y] = pts[i], r = rng.range(50, 110);
          const gr = g.createRadialGradient(x, y, 0, x, y, r);
          gr.addColorStop(0, 'rgba(10,22,12,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
        }
      }
    }

    /* forests (kept off paths, sites, cities): painted flat in 2D, grown as meshes in 3D */
    const cities = map.cities.map((id) => [dx(map.sites[id].x, viewer), dy(map.sites[id].y, viewer)]);
    const sitesD = map.sites.map((s) => [dx(s.x, viewer), dy(s.y, viewer)]);
    const clear = (x, y, rr) => {
      for (const [cx2, cy2] of cities) if ((x - cx2) ** 2 + (y - cy2) ** 2 < 260 ** 2) return false;
      for (const [sx2, sy2] of sitesD) if ((x - sx2) ** 2 + (y - sy2) ** 2 < 82 ** 2) return false;
      for (let i = 0; i < pathPts.length; i += 2) {
        const p = pathPts[i];
        if ((x - p[0]) ** 2 + (y - p[1]) ** 2 < rr * rr) return false;
      }
      return true;
    };
    const trees = [];
    for (let i = 0; i < 2200 && trees.length < 520; i++) {
      const x = rng.range(14, MW - 14), y = rng.range(60, MH - 300);
      if (clear(x, y, 52)) trees.push([x, y, rng.range(7, 13), rng.next()]);
    }
    trees.sort((a, b) => a[1] - b[1]);
    if (opts.trees !== false) {
      for (const [x, y, r, v] of trees) {
        const gold = y > MH * 0.62, ash = y < MH * 0.34;
        const pal = gold ? ['#232a10', '#3c4416', '#5f6626', '#8f9838']
          : ash ? ['#241014', '#3c2020', '#553030', '#6f4444']
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
        if (v > 0.6) { g.strokeStyle = pal[0]; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x, y + r * 0.5); g.lineTo(x, y + r * 0.95); g.stroke(); }
      }
    }

    /* the paths: worn dark bed + cobbles; the spine runs black with chaos veins */
    for (let ei = 0; ei < map.edges.length; ei++) {
      const [ai, bi] = map.edges[ei];
      const e = edgeCurve(map, ei, viewer);
      const isSpine = spine.has(ai) && spine.has(bi);
      g.beginPath(); g.moveTo(e.ax, e.ay); g.quadraticCurveTo(e.mx, e.my, e.bx, e.by);
      g.strokeStyle = isSpine ? 'rgba(16,12,20,0.92)' : 'rgba(30,25,38,0.8)';
      g.lineWidth = isSpine ? 30 : 17; g.lineCap = 'round'; g.stroke();
      g.strokeStyle = isSpine ? 'rgba(52,40,62,0.8)' : 'rgba(72,62,90,0.55)';
      g.lineWidth = isSpine ? 22 : 11; g.stroke();
      const pts = sampleEdge(e, isSpine ? 46 : 30);
      for (let i = 1; i < pts.length - 1; i += 2) {
        const [x, y] = pts[i];
        g.fillStyle = isSpine ? '#241a2e' : '#3c3450';
        g.beginPath(); g.ellipse(x + rng.range(-4, 4), y + rng.range(-3, 3), rng.range(2.5, 4.5), rng.range(1.6, 2.6), rng.next(), 0, 7); g.fill();
        g.fillStyle = 'rgba(160,140,190,0.16)';
        g.beginPath(); g.ellipse(x, y - 1.2, 2.6, 1.2, 0, 0, 7); g.fill();
      }
      if (isSpine) {
        for (let i = 2; i < pts.length - 2; i += 5) {
          const [x, y] = pts[i];
          g.strokeStyle = 'rgba(90,213,132,0.34)'; g.lineWidth = 1.4;
          g.beginPath(); g.moveTo(x - 8, y + rng.range(-4, 4));
          g.quadraticCurveTo(x, y + rng.range(-6, 6), x + 9, y + rng.range(-4, 4)); g.stroke();
        }
      }
    }

    /* site grounds: pools, crags with cliff shadows, milestones */
    for (const s of map.sites) {
      const X = dx(s.x, viewer), Y = dy(s.y, viewer);
      if (s.kind === 'vantage') {
        g.globalAlpha = 0.55; g.fillStyle = '#000';
        g.beginPath(); g.ellipse(X + 6, Y + 26, 52, 16, 0, 0, 7); g.fill(); g.globalAlpha = 1;
        const gr = g.createRadialGradient(X, Y, 6, X, Y, 66);
        gr.addColorStop(0, '#4c4458'); gr.addColorStop(0.7, '#332c40'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(X, Y, 66, 0, 7); g.fill();
        g.strokeStyle = '#181420'; g.lineWidth = 3;
        g.beginPath(); g.arc(X, Y + 8, 46, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
        g.strokeStyle = 'rgba(200,190,220,0.35)'; g.lineWidth = 2;
        g.beginPath(); g.arc(X, Y - 4, 40, 1.1 * Math.PI, 1.9 * Math.PI); g.stroke();
      }
      if (s.kind === 'spring') {
        g.globalAlpha = 0.5; g.fillStyle = '#000';
        g.beginPath(); g.ellipse(X + 3, Y + 8, 40, 15, 0, 0, 7); g.fill(); g.globalAlpha = 1;
        const gr = g.createRadialGradient(X, Y, 2, X, Y, 34);
        gr.addColorStop(0, '#3a6a8c'); gr.addColorStop(0.6, '#1c3448'); gr.addColorStop(1, '#0c1622');
        g.fillStyle = gr; g.beginPath(); g.ellipse(X, Y, 33, 14, 0, 0, 7); g.fill();
        g.strokeStyle = 'rgba(150,200,240,0.4)'; g.lineWidth = 1.4;
        g.beginPath(); g.ellipse(X, Y, 33, 14, 0, 0, 7); g.stroke();
        g.beginPath(); g.ellipse(X, Y, 20, 8, 0, 0, 7); g.stroke();
      }
      const spr = s.kind !== 'city' && S && S.site ? S.site[s.kind] : null;
      if (spr && s.kind !== 'spring' && opts.siteSprites !== false) g.drawImage(spr, X - 34, Y - 40, 68, 68);
      if (s.kind !== 'city' && opts.labels !== false) {
        g.font = '600 13px Georgia, serif'; g.textAlign = 'center';
        g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 3; g.strokeText(s.name, X, Y + 44);
        g.fillStyle = 'rgba(222,204,164,0.85)'; g.fillText(s.name, X, Y + 44);
      }
    }

    /* city grounds */
    for (let pi2 = 0; pi2 < 2; pi2++) {
      const cs = map.sites[map.cities[pi2]];
      const X = dx(cs.x, viewer), Y = dy(cs.y, viewer), own = Y > MH / 2;
      const gr = g.createRadialGradient(X, Y, 20, X, Y, 340);
      gr.addColorStop(0, own ? 'rgba(120,96,44,0.4)' : 'rgba(110,44,54,0.34)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(X, Y, 340, 0, 7); g.fill();
    }
    /* edge fade: the world dissolves into Shadow at the map border */
    for (const [x0, y0, x1, y1] of [[0, 0, 0, 60], [0, MH, 0, MH - 60], [0, 0, 60, 0], [MW, 0, MW - 60, 0]]) {
      const gr = (x0 === x1) ? g.createLinearGradient(0, y0, 0, y1) : g.createLinearGradient(x0, 0, x1, 0);
      gr.addColorStop(0, 'rgba(8,6,14,0.95)'); gr.addColorStop(1, 'rgba(8,6,14,0)');
      g.fillStyle = gr; g.fillRect(0, 0, MW, MH);
    }
    for (let i = 0; i < 5200; i++) {
      g.globalAlpha = 0.05 + rng.next() * 0.07;
      g.fillStyle = rng.next() < 0.5 ? '#000' : '#c8b890';
      g.fillRect(rng.next() * MW, rng.next() * MH, 1.6, 1.6);
    }
    g.globalAlpha = 1;
    return { canvas: cv2, trees, pathPts };
  }

  global.Terrain = { bake, edgeCurve, sampleEdge, dx, dy };
})(typeof window !== 'undefined' ? window : globalThis);

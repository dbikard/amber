/* sprites.js — procedural painterly sprites, painted once at boot onto offscreen canvases.
 * Layered gradients + rim light + noise speckle = a solo-dev-sustainable "painted" look.
 * Browser-only (no-ops headless). Palette law: gold = player, crimson = rival, green = Chaos. */
(function (global) {
  'use strict';

  const PAL = {
    gold:    { base: '#c9a44f', light: '#f2dc9b', dark: '#6e5322', glow: '#ffe9a8', line: '#3a2c10' },
    crimson: { base: '#a34452', light: '#e08a96', dark: '#521c26', glow: '#ff9aa8', line: '#2e0d13' },
    chaos:   { base: '#46543f', light: '#7fa471', dark: '#141a12', glow: '#7dff9e', line: '#0a0f09' },
    stone:   { base: '#8d8296', light: '#cfc6d8', dark: '#3f3849', glow: '#e8e0f2', line: '#221d2b' },
    pattern: { base: '#8fc2ff', light: '#dceaff', dark: '#27508a', glow: '#bcdcff', line: '#122a4d' }
  };
  const S = { b: {}, u: {}, castle: {}, PAL };

  function mk(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return { c, g: c.getContext('2d') };
  }
  function rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function speckle(g, w, h, rng, color, n, a) {
    g.save(); g.globalAlpha = a; g.fillStyle = color;
    for (let i = 0; i < n; i++) g.fillRect(rng.next() * w, rng.next() * h, 1.5, 1.5);
    g.restore();
  }
  function vgrad(g, x, y, h, top, bot) {
    const gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, top); gr.addColorStop(1, bot);
    return gr;
  }
  /* a stone mass with painterly rim light on the upper-left */
  function stone(g, p, x, y, w, h, r) {
    rr(g, x, y, w, h, r);
    g.fillStyle = vgrad(g, x, y, h, p.base, p.dark); g.fill();
    g.strokeStyle = p.line; g.lineWidth = 1.5; g.stroke();
    g.save(); g.beginPath(); g.moveTo(x + 2, y + h * 0.5); g.quadraticCurveTo(x + 2, y + 2, x + w * 0.55, y + 2);
    g.strokeStyle = p.light; g.globalAlpha = 0.7; g.lineWidth = 2; g.stroke(); g.restore();
  }
  function glowOrb(g, x, y, r, color) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }

  /* ---------------- buildings (68×68, gold-stone: only YOUR city shows detail) ---------------- */
  const B = 68;
  const painters = {
    rampart(g, rng) {   // a stretch of wall
      stone(g, PAL.stone, 4, 30, 60, 22, 4);
      for (let x = 6; x < 60; x += 9) { g.fillStyle = PAL.stone.dark; g.fillRect(x, 24, 6, 7); }
      g.strokeStyle = PAL.stone.line; g.lineWidth = 1;
      for (let y = 36; y < 50; y += 6) { g.beginPath(); g.moveTo(6, y); g.lineTo(62, y); g.stroke(); }
      g.beginPath(); g.arc(34, 52, 8, Math.PI, 0); g.lineTo(42, 52); g.lineTo(26, 52); g.closePath();
      g.fillStyle = '#0d0812'; g.fill();
      speckle(g, B, B, rng, PAL.stone.light, 20, 0.3);
    },
    gate(g, rng) {   // a stabilized arch into Shadow
      stone(g, PAL.stone, 8, 22, 52, 40, 6);
      g.beginPath(); g.arc(34, 46, 17, Math.PI, 0); g.lineTo(51, 62); g.lineTo(17, 62); g.closePath();
      g.fillStyle = '#0b0716'; g.fill();
      for (let i = 0; i < 3; i++) {   // the swirl of Shadow
        g.beginPath(); g.arc(34, 47, 12 - i * 4, 0.6 + i, 3.6 + i);
        g.strokeStyle = i % 2 ? '#7fb4ff' : '#b48eff'; g.globalAlpha = 0.8; g.lineWidth = 2.5; g.stroke();
      }
      g.globalAlpha = 1; glowOrb(g, 34, 47, 14, 'rgba(140,150,255,0.45)');
      speckle(g, B, B, rng, PAL.stone.light, 26, 0.25);
    },
    barracks(g, rng) {   // a soldiers' hall with a war banner
      stone(g, PAL.stone, 6, 30, 56, 32, 5);
      g.beginPath(); g.moveTo(3, 32); g.lineTo(34, 14); g.lineTo(65, 32); g.closePath();
      g.fillStyle = vgrad(g, 0, 14, 18, '#7a4a3a', '#4a2a20'); g.fill(); g.strokeStyle = PAL.stone.line; g.stroke();
      rr(g, 28, 44, 12, 18, 3); g.fillStyle = '#1a1210'; g.fill();
      g.fillStyle = PAL.gold.base; g.fillRect(50, 12, 3, 26);   // banner pole
      g.beginPath(); g.moveTo(53, 14); g.lineTo(66, 19); g.lineTo(53, 26); g.closePath();
      g.fillStyle = PAL.gold.glow; g.fill();
      speckle(g, B, B, rng, PAL.stone.light, 26, 0.25);
    },
    spire(g, rng) {   // Fiona's arts, taught for a price
      g.beginPath(); g.moveTo(24, 64); g.lineTo(30, 10); g.lineTo(38, 10); g.lineTo(44, 64); g.closePath();
      g.fillStyle = vgrad(g, 0, 10, 54, '#6a5a8a', '#2c2440'); g.fill();
      g.strokeStyle = PAL.stone.line; g.lineWidth = 1.5; g.stroke();
      g.beginPath(); g.moveTo(25.5, 50); g.quadraticCurveTo(28, 14, 31, 12);
      g.strokeStyle = PAL.stone.light; g.globalAlpha = 0.6; g.lineWidth = 2; g.stroke(); g.globalAlpha = 1;
      glowOrb(g, 34, 8, 10, 'rgba(200,140,255,0.9)');
      g.fillStyle = '#efdcff'; g.beginPath(); g.arc(34, 8, 3, 0, 7); g.fill();
      speckle(g, B, B, rng, '#cabbe8', 20, 0.25);
    },
    tower(g, rng) {   // Julian's vigil
      stone(g, PAL.stone, 22, 18, 24, 46, 4);
      for (let i = 0; i < 3; i++) { g.fillStyle = PAL.stone.dark; g.fillRect(22 + i * 9, 12, 6, 8); }
      g.fillStyle = PAL.stone.base; g.fillRect(20, 18, 28, 3);
      rr(g, 31, 30, 6, 14, 2); g.fillStyle = '#100c16'; g.fill();
      glowOrb(g, 34, 36, 5, 'rgba(255,220,150,0.5)');
      speckle(g, B, B, rng, PAL.stone.light, 22, 0.25);
    },
    shrine(g, rng) {   // a reflection of the Pattern
      g.beginPath(); g.ellipse(34, 50, 26, 12, 0, 0, 7);
      g.fillStyle = vgrad(g, 0, 38, 24, '#4a4258', '#221d2b'); g.fill();
      g.strokeStyle = PAL.stone.line; g.stroke();
      g.save(); g.translate(34, 48); g.scale(1, 0.45);   // the Pattern, in perspective
      g.beginPath();
      for (let a = 0; a < 6.0; a += 0.12) { const r = 2.5 + a * 3.1; g.lineTo(Math.cos(a * 2.1) * r, Math.sin(a * 2.1) * r); }
      g.strokeStyle = PAL.pattern.base; g.lineWidth = 2.2; g.shadowColor = PAL.pattern.glow; g.shadowBlur = 6; g.stroke();
      g.restore();
      glowOrb(g, 34, 46, 20, 'rgba(140,190,255,0.28)');
      speckle(g, B, B, rng, PAL.pattern.light, 16, 0.3);
    },
    veiled(g, rng) {   // the rival's works, shrouded in Shadow
      g.beginPath(); g.moveTo(10, 60); g.bezierCurveTo(8, 30, 24, 18, 34, 20);
      g.bezierCurveTo(46, 18, 60, 32, 58, 60); g.closePath();
      g.fillStyle = vgrad(g, 0, 18, 44, '#2a2030', '#0e0a12'); g.fill();
      g.strokeStyle = '#3a2a40'; g.lineWidth = 1.5; g.stroke();
      g.strokeStyle = PAL.crimson.base; g.globalAlpha = 0.5; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(28, 34); g.lineTo(40, 34); g.moveTo(34, 28); g.lineTo(34, 46); g.moveTo(28, 46); g.lineTo(40, 40);
      g.stroke(); g.globalAlpha = 1;   // a faint, unreadable rune
      speckle(g, B, B, rng, '#5a4468', 18, 0.3);
    }
  };

  /* ---------------- castles (128×86) ---------------- */
  function paintCastle(p, rng) {
    const { c, g } = mk(128, 86);
    glowOrb(g, 64, 52, 56, p === PAL.gold ? 'rgba(255,225,150,0.22)' : 'rgba(255,120,130,0.18)');
    stone(g, p, 14, 34, 100, 46, 6);                    // keep
    stone(g, p, 4, 22, 26, 58, 5); stone(g, p, 98, 22, 26, 58, 5);   // flank towers
    for (let x = 8; x < 122; x += 10) { g.fillStyle = p.dark; g.fillRect(x, 16, 6, 8); }
    g.beginPath(); g.arc(64, 72, 13, Math.PI, 0); g.lineTo(77, 84); g.lineTo(51, 84); g.closePath();
    g.fillStyle = '#0d0812'; g.fill();                  // the gate onto the road
    g.fillStyle = p.base; g.fillRect(62, 2, 3, 22);
    g.beginPath(); g.moveTo(65, 4); g.lineTo(80, 9); g.lineTo(65, 16); g.closePath();
    g.fillStyle = p.glow; g.fill();                     // the royal standard
    speckle(g, 128, 86, rng, p.light, 60, 0.22);
    return c;
  }

  /* ---------------- units (28×28 silhouettes, rim-lit) ---------------- */
  const UP = { soldier: paintSoldier, sorcerer: paintSorcerer, champion: paintChampion, fiend: paintFiend };
  function paintSoldier(g, p) {
    g.beginPath(); g.moveTo(10, 26); g.quadraticCurveTo(9, 12, 14, 10); g.quadraticCurveTo(19, 12, 18, 26); g.closePath();
    g.fillStyle = vgrad(g, 0, 10, 16, p.base, p.dark); g.fill(); g.strokeStyle = p.line; g.stroke();
    g.beginPath(); g.arc(14, 8, 3.6, 0, 7); g.fillStyle = p.light; g.fill(); g.strokeStyle = p.line; g.stroke();
    g.strokeStyle = p.light; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(20, 27); g.lineTo(23, 3); g.stroke();          // spear
    g.beginPath(); g.arc(8, 17, 4.4, 0, 7); g.fillStyle = p.base; g.fill(); g.strokeStyle = p.line; g.stroke(); // shield
  }
  function paintSorcerer(g, p) {
    g.beginPath(); g.moveTo(8, 26); g.quadraticCurveTo(10, 8, 14, 6); g.quadraticCurveTo(18, 8, 20, 26); g.closePath();
    g.fillStyle = vgrad(g, 0, 6, 20, p.base, p.dark); g.fill(); g.strokeStyle = p.line; g.stroke();
    g.beginPath(); g.arc(14, 6.5, 3, 3.4, 6.1); g.fillStyle = p.dark; g.fill();   // hood
    g.strokeStyle = p.light; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(21, 26); g.lineTo(23, 5); g.stroke();          // staff
    glowOrb(g, 23, 4, 4.5, p.glow); g.fillStyle = '#fff'; g.fillRect(22.4, 3.4, 1.4, 1.4);
  }
  function paintChampion(g, p) {
    g.beginPath(); g.moveTo(7, 27); g.quadraticCurveTo(5, 12, 10, 8); g.lineTo(18, 8); g.quadraticCurveTo(23, 12, 21, 27); g.closePath();
    g.fillStyle = vgrad(g, 0, 8, 19, p.light, p.dark); g.fill(); g.strokeStyle = p.line; g.lineWidth = 1.4; g.stroke();
    g.beginPath(); g.moveTo(7, 10); g.quadraticCurveTo(2, 18, 5, 27); g.lineTo(9, 26); g.closePath();
    g.fillStyle = p.base; g.fill();                                        // cape
    g.beginPath(); g.arc(14, 6, 4, 0, 7); g.fillStyle = p.light; g.fill(); g.strokeStyle = p.line; g.stroke();
    g.fillStyle = p.glow; g.fillRect(12.6, 0, 2.8, 3.4);                   // plume
    g.strokeStyle = '#e8ecff'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(22, 24); g.lineTo(26, 6); g.stroke();          // the blade
  }
  function paintFiend(g, p) {
    g.beginPath(); g.moveTo(5, 26); g.bezierCurveTo(2, 14, 10, 6, 15, 8); g.bezierCurveTo(24, 6, 27, 16, 23, 26); g.closePath();
    g.fillStyle = vgrad(g, 0, 6, 20, p.base, p.dark); g.fill(); g.strokeStyle = p.line; g.stroke();
    for (const [sx, sy] of [[8, 9], [13, 5], [19, 7]]) {                   // spines
      g.beginPath(); g.moveTo(sx, sy + 4); g.lineTo(sx + 2, sy - 3); g.lineTo(sx + 4, sy + 3); g.closePath();
      g.fillStyle = p.dark; g.fill();
    }
    g.fillStyle = p.glow;
    g.beginPath(); g.arc(11, 15, 1.7, 0, 7); g.arc(18, 15, 1.7, 0, 7); g.fill();   // eyes
  }

  /* ---------------- map sites & outposts (v0.2) ---------------- */
  const sitePainters = {
    spring(g, rng) {   // a pool of living Shadow
      g.beginPath(); g.ellipse(34, 40, 22, 11, 0, 0, 7);
      g.fillStyle = vgrad(g, 0, 30, 22, '#1e3444', '#0a1420'); g.fill();
      g.strokeStyle = '#3a5a70'; g.lineWidth = 1.5; g.stroke();
      for (let i = 0; i < 3; i++) {
        g.beginPath(); g.ellipse(34, 40, 16 - i * 5, 8 - i * 2.6, 0, 0, 7);
        g.strokeStyle = 'rgba(140,200,255,' + (0.25 + i * 0.15) + ')'; g.lineWidth = 1; g.stroke();
      }
      glowOrb(g, 34, 40, 16, 'rgba(120,190,255,0.30)');
      g.fillStyle = '#4a4034';
      g.beginPath(); g.ellipse(14, 48, 5, 3, 0.5, 0, 7); g.ellipse(55, 46, 4, 2.5, -0.4, 0, 7); g.fill();
      speckle(g, B, B, rng, '#8fc2ff', 12, 0.35);
    },
    vantage(g, rng) {   // high grey stone over Shadow
      g.beginPath(); g.moveTo(10, 56); g.lineTo(22, 26); g.lineTo(30, 38); g.lineTo(38, 16);
      g.lineTo(48, 34); g.lineTo(58, 56); g.closePath();
      g.fillStyle = vgrad(g, 0, 16, 40, '#6a6276', '#2c2836'); g.fill();
      g.strokeStyle = '#221d2b'; g.lineWidth = 1.5; g.stroke();
      g.beginPath(); g.moveTo(22, 27); g.lineTo(37, 17.5);
      g.strokeStyle = '#cfc6d8'; g.globalAlpha = 0.7; g.lineWidth = 1.6; g.stroke(); g.globalAlpha = 1;
      speckle(g, B, B, rng, '#9a90aa', 20, 0.3);
    },
    road(g, rng) {   // a black milestone of the road
      g.beginPath(); g.ellipse(34, 52, 20, 7, 0, 0, 7);
      g.fillStyle = '#141018'; g.fill();
      stone(g, { base: '#2c2433', light: '#5a4a68', dark: '#120e18', line: '#000' }, 26, 22, 16, 32, 3);
      g.strokeStyle = PAL.chaos.glow; g.globalAlpha = 0.45; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(30, 30); g.lineTo(38, 30); g.moveTo(34, 26); g.lineTo(34, 44); g.stroke();
      g.globalAlpha = 1;
      speckle(g, B, B, rng, '#5ad584', 8, 0.3);
    }
  };
  function paintFlag(p) {   // the war banner
    const { c, g } = mk(30, 40);
    g.strokeStyle = '#d8c8a8'; g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(8, 38); g.lineTo(8, 3); g.stroke();
    g.beginPath(); g.moveTo(9, 4); g.quadraticCurveTo(20, 8, 27, 5); g.lineTo(24, 14);
    g.quadraticCurveTo(18, 17, 9, 13); g.closePath();
    g.fillStyle = p.base; g.fill(); g.strokeStyle = p.line; g.lineWidth = 1.2; g.stroke();
    g.fillStyle = p.glow; g.fillRect(11, 6.5, 5, 5);
    return c;
  }

  S.init = function () {
    if (typeof document === 'undefined' || S._done) return;
    S._done = true;
    const rng = global.RNG.make(42);
    S.site = {};
    for (const k of Object.keys(sitePainters)) { const { c, g } = mk(B, B); sitePainters[k](g, rng); S.site[k] = c; }
    S.flag = paintFlag(PAL.gold);
    for (const bt of Object.keys(painters)) {
      const { c, g } = mk(B, B);
      painters[bt](g, rng);
      S.b[bt] = c;
    }
    S.castle[0] = paintCastle(PAL.gold, rng);
    S.castle[1] = paintCastle(PAL.crimson, rng);
    const tints = [PAL.gold, PAL.crimson, PAL.chaos];
    for (const kind of Object.keys(UP)) {
      S.u[kind] = tints.map((p) => { const { c, g } = mk(28, 28); UP[kind](g, p); return c; });
    }
  };

  global.SPRITES = S;
})(typeof window !== 'undefined' ? window : globalThis);

/* render.js — ALL canvas drawing, isolated (v0.2: scrollable Shadow map + fog of war).
 * Consumes a source-agnostic `view` built by game.js:
 *   { map, sites[], players[], units[], storms[], t, visSources[], explored{} }
 * The viewer's own city is ALWAYS at the bottom: viewer 1 sees the world rotated 180°.
 * Rule of the fog: geography is public (you know Shadow's shape), contents are not. */
(function (global) {
  'use strict';

  const C = global.CONST, S = global.SPRITES;
  const R = { targeting: false, selected: -1, pointer: null, camY: 0 };
  let cv = null, ctx = null, W = 0, H = 0, scale = 1, viewH = 0;
  let bg = null, fx = [], fogCv = null;

  R.init = function (canvas) { cv = canvas; ctx = cv.getContext('2d'); R.resize(); };
  R.resize = function () {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scale = W / C.MAP.W;
    viewH = H / scale;                       // world-units tall the screen shows
    bg = null; fogCv = null;
    R.camY = C.MAP.H - viewH;                // open on your own city
  };
  R.maxCamY = () => Math.max(0, C.MAP.H - viewH);

  /* display space = world space rotated 180° for viewer 1 (own city at bottom for both) */
  const dx = (x, viewer) => (viewer === 0 ? x : C.MAP.W - x);
  const dy = (y, viewer) => (viewer === 0 ? y : C.MAP.H - y);
  const sx = (x) => x * scale;
  const sy = (y) => (y - R.camY) * scale;
  R.toWorld = function (px, py, viewer) {   // screen tap → true world coords
    const wx = px / scale, wy = py / scale + R.camY;
    return { x: dx(wx, viewer), y: dy(wy, viewer) };
  };
  R.pan = function (dpx) { R.camY = Math.max(0, Math.min(R.maxCamY(), R.camY - dpx / scale)); };

  /* ---------------- own city grid (display space, below the castle) ---------------- */
  R.slotRect = function (idx) {
    const col = idx % 3, row = Math.floor(idx / 3);
    const gw = 460, cw = gw / 3, gh = 240 / 3;
    const gx = (C.MAP.W - gw) / 2, gy = C.MAP.H - 250;
    return { x: gx + col * cw + 4, y: gy + row * gh + 3, w: cw - 8, h: gh - 6 };   // display-world units
  };
  R.hitSlot = function (px, py) {
    for (let i = 0; i < C.SLOTS; i++) {
      const r = R.slotRect(i);
      const x = sx(r.x), y = sy(r.y), w = r.w * scale, h = r.h * scale;
      if (px >= x && px <= x + w && py >= y && py <= y + h) return i;
    }
    return -1;
  };
  R.hitSite = function (px, py, view, viewer) {
    let best = -1, bd = 44 * 44;   // 44px touch radius, screen space
    for (const s of view.map.sites) {
      const X = sx(dx(s.x, viewer)), Y = sy(dy(s.y, viewer));
      const dd = (px - X) * (px - X) + (py - Y) * (py - Y);
      if (dd < bd) { bd = dd; best = s.id; }
    }
    return best;
  };
  R.hitMinimap = (px) => px > W - 34;
  R.minimapJump = function (py) { R.camY = Math.max(0, Math.min(R.maxCamY(), (py / H) * C.MAP.H - viewH / 2)); };

  /* ---------------- the painted map (cached; display space, whole world) ---------------- */
  function paintBg(view, viewer) {
    bg = document.createElement('canvas');
    bg.width = Math.ceil(C.MAP.W * scale); bg.height = Math.ceil(C.MAP.H * scale);
    const g = bg.getContext('2d');
    g.scale(scale, scale);
    const sky = g.createLinearGradient(0, 0, 0, C.MAP.H);
    sky.addColorStop(0, '#150a12'); sky.addColorStop(0.5, '#0d0b16'); sky.addColorStop(1, '#141020');
    g.fillStyle = sky; g.fillRect(0, 0, C.MAP.W, C.MAP.H);
    const rng = global.RNG.make(7);
    for (let i = 0; i < 240; i++) {
      g.globalAlpha = 0.2 + rng.next() * 0.45;
      g.fillStyle = i % 7 ? '#cdd6ff' : '#ffe9c8';
      g.fillRect(rng.next() * C.MAP.W, rng.next() * C.MAP.H, 2, 2);
    }
    g.globalAlpha = 1;
    let a = g.createRadialGradient(C.MAP.W / 2, 0, 0, C.MAP.W / 2, 0, 600);
    a.addColorStop(0, 'rgba(190,70,90,0.20)'); a.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = a; g.fillRect(0, 0, C.MAP.W, 700);
    a = g.createRadialGradient(C.MAP.W / 2, C.MAP.H, 0, C.MAP.W / 2, C.MAP.H, 700);
    a.addColorStop(0, 'rgba(255,205,110,0.22)'); a.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = a; g.fillRect(0, C.MAP.H - 800, C.MAP.W, 800);
    /* the paths of Shadow; the spine is the black road */
    const spine = new Set(view.map.roads.concat(view.map.cities));
    for (const [ai, bi] of view.map.edges) {
      const A = view.map.sites[ai], B2 = view.map.sites[bi];
      const ax = dx(A.x, viewer), ay = dy(A.y, viewer), bx = dx(B2.x, viewer), by = dy(B2.y, viewer);
      const mx = (ax + bx) / 2 + rng.range(-26, 26), my = (ay + by) / 2 + rng.range(-16, 16);
      const isSpine = spine.has(ai) && spine.has(bi);
      for (const [w2, col] of isSpine
        ? [[26, 'rgba(44,32,54,0.95)'], [3, 'rgba(90,213,132,0.28)']]
        : [[14, 'rgba(58,48,72,0.7)'], [2, 'rgba(170,150,190,0.3)']]) {
        g.beginPath(); g.moveTo(ax, ay); g.quadraticCurveTo(mx, my, bx, by);
        g.strokeStyle = col; g.lineWidth = w2; g.lineCap = 'round'; g.stroke();
      }
    }
    /* site grounds */
    for (const s of view.map.sites) {
      if (s.kind === 'city') continue;
      const X = dx(s.x, viewer), Y = dy(s.y, viewer);
      const spr = S.site[s.kind];
      if (spr) g.drawImage(spr, X - 34, Y - 40, 68, 68);
      g.font = '13px Georgia, serif'; g.textAlign = 'center';
      g.fillStyle = 'rgba(210,190,150,0.72)';
      g.fillText(s.name, X, Y + 42);
    }
  }

  /* ---------------- event → effect conversion (display coords at add time) ---------------- */
  const TINT = { 0: '#ffd98a', 1: '#ff8a96', 2: '#7dff9e' };
  R.addEvents = function (events, view, viewer) {
    for (const ev of events) {
      const ex = ev.x != null ? dx(ev.x, viewer) : 0, ey = ev.y != null ? dy(ev.y, viewer) : 0;
      if (ev.e === 'shot' && ev.pi === viewer) {
        const r = R.slotRect(ev.slot);
        fx.push({ k: 'line', x: r.x + r.w / 2, y: r.y + r.h / 2, x2: dx(ev.to.x, viewer), y2: dy(ev.to.y, viewer), ttl: 0.22, max: 0.22, c: '#e8d8a8', w: 1.5 });
      } else if (ev.e === 'wshot') {
        fx.push({ k: 'line', x: ex, y: ey - 14, x2: dx(ev.to.x, viewer), y2: dy(ev.to.y, viewer), ttl: 0.22, max: 0.22, c: '#e8d8a8', w: 1.5 });
      } else if (ev.e === 'bolt') {
        fx.push({ k: 'line', x: dx(ev.from.x, viewer), y: dy(ev.from.y, viewer), x2: dx(ev.to.x, viewer), y2: dy(ev.to.y, viewer), ttl: 0.3, max: 0.3, c: TINT[ev.from.owner], w: 2.2, glow: true });
      } else if (ev.e === 'die') {
        fx.push({ k: 'burst', x: ex, y: ey, ttl: 0.55, max: 0.55, c: TINT[ev.owner] });
      } else if (ev.e === 'rift') {
        fx.push({ k: 'rift', x: ex, y: ey, ttl: 3.2, max: 3.2, ping: '#7dff9e' });
      } else if (ev.e === 'siege') {
        fx.push({ k: 'burst', x: ex, y: ey, ttl: 0.35, max: 0.35, c: '#ffb090', ping: ev.pi === viewer ? '#ff5a4a' : null });
      } else if (ev.e === 'hurtpost') {
        if (ev.pi === viewer) fx.push({ k: 'ring', x: ex, y: ey, ttl: 1.2, max: 1.2, c: '#ff8a5a', ping: '#ff8a5a' });
      } else if (ev.e === 'post' || ev.e === 'postup') {
        fx.push({ k: 'ring', x: ex, y: ey, ttl: 0.8, max: 0.8, c: '#ffe9a8' });
      } else if (ev.e === 'postdie') {
        fx.push({ k: 'burst', x: ex, y: ey, ttl: 0.8, max: 0.8, c: '#cfc6d8', ping: ev.pi === viewer ? '#ff5a4a' : null });
      } else if (ev.e === 'build' || ev.e === 'up') {
        if (ev.pi === viewer) { const r = R.slotRect(ev.slot); fx.push({ k: 'ring', x: r.x + r.w / 2, y: r.y + r.h / 2, ttl: 0.6, max: 0.6, c: '#ffe9a8' }); }
      } else if (ev.e === 'walk' || ev.e === 'pattern' || ev.e === 'trump') {
        const city = view.map.sites[view.map.cities[ev.pi]];
        fx.push({ k: 'ring', x: dx(city.x, viewer), y: dy(city.y, viewer), ttl: 1.3, max: 1.3, c: ev.e === 'trump' ? '#e8ecff' : '#9cc8ff' });
      }
    }
  };

  /* ---------------- per-frame draw ---------------- */
  R.frame = function (view, viewer, dt) {
    if (!bg) paintBg(view, viewer);
    ctx.fillStyle = '#0d0b16'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(bg, 0, -R.camY * scale);

    ctx.save();
    ctx.translate(0, -R.camY * scale);
    ctx.scale(scale, scale);
    /* everything below draws in display-world units */

    for (const f of fx) if (f.k === 'rift') drawRift(f);

    /* sites: dynamic state through the fog (explored memory or live truth) */
    for (const s of view.map.sites) {
      if (s.kind === 'city') continue;
      const st = view.sites[s.id];
      if (!st) continue;   // unexplored: geography only
      const X = dx(s.x, viewer), Y = dy(s.y, viewer);
      if (st.owner >= 0) {
        ctx.strokeStyle = st.owner === viewer ? 'rgba(255,217,138,0.6)' : 'rgba(255,138,150,0.6)';
        ctx.lineWidth = 2; ctx.setLineDash(st.live ? [] : [4, 5]);
        ctx.beginPath(); ctx.arc(X, Y, 40, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      }
      if (st.post) {
        const spr = S.post[st.post.bt];
        if (spr) { ctx.globalAlpha = st.live ? 1 : 0.55; ctx.drawImage(spr, X - 30, Y - 44, 60, 60); ctx.globalAlpha = 1; }
        for (let lv = 1; lv < st.post.level; lv++) {
          ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.arc(X - 12 + lv * 12, Y + 22, 3, 0, 7); ctx.fill();
        }
        if (st.live && st.post.hp != null && st.post.hp < st.post.maxHp) {
          ctx.fillStyle = '#000a'; ctx.fillRect(X - 24, Y - 50, 48, 4);
          ctx.fillStyle = st.owner === viewer ? '#ffd98a' : '#ff8a96';
          ctx.fillRect(X - 24, Y - 50, 48 * Math.max(0, st.post.hp / st.post.maxHp), 4);
        }
      }
    }

    /* the war banner */
    if (view.players[viewer].banner >= 0 && S.flag) {
      const b = view.map.sites[view.players[viewer].banner];
      const X = dx(b.x, viewer), Y = dy(b.y, viewer);
      const bob = Math.sin(performance.now() / 300) * 2;
      ctx.drawImage(S.flag, X + 22, Y - 52 + bob, 30, 40);
    }

    /* units (visible ones only — the view is pre-filtered) */
    const units = view.units.slice().sort((a, b) => dy(a.y, viewer) - dy(b.y, viewer));
    for (const u of units) {
      const X = dx(u.x, viewer), Y = dy(u.y, viewer);
      const def = C.UNITS[u.kind], sc = 1 + def.size * 0.045;
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(X, Y + 11 * sc, 9 * sc, 3.2 * sc, 0, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
      const spr = S.u[u.kind] && S.u[u.kind][u.owner === 2 ? 2 : (u.owner === viewer ? 0 : 1)];
      if (spr) ctx.drawImage(spr, X - 14 * sc, Y - 16 * sc, 28 * sc, 28 * sc);
      if (u.hp < u.maxHp) {
        ctx.fillStyle = '#000a'; ctx.fillRect(X - 11, Y - 21 * sc, 22, 3.5);
        ctx.fillStyle = u.owner === 2 ? '#7dff9e' : (u.owner === viewer ? '#ffd98a' : '#ff8a96');
        ctx.fillRect(X - 11, Y - 21 * sc, 22 * Math.max(0, u.hp / u.maxHp), 3.5);
      }
    }

    /* storms of the Jewel */
    for (const st of view.storms || []) {
      const X = dx(st.x, viewer), Y = dy(st.y, viewer), rr = C.POWERS.storm.radius;
      if (st.delay > 0) {
        ctx.save(); ctx.globalAlpha = 0.5 + 0.4 * Math.sin(st.delay * 18);
        ctx.strokeStyle = '#ff6a5a'; ctx.lineWidth = 2.5; ctx.setLineDash([7, 7]);
        ctx.beginPath(); ctx.arc(X, Y, rr, 0, 7); ctx.stroke(); ctx.restore();
      } else {
        ctx.save();
        const cg = ctx.createRadialGradient(X, Y, 0, X, Y, rr);
        cg.addColorStop(0, 'rgba(30,10,20,0.6)'); cg.addColorStop(1, 'rgba(30,10,20,0)');
        ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(X, Y, rr, 0, 7); ctx.fill();
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          let lx = X + (Math.random() - 0.5) * rr, ly = Y - rr;
          ctx.moveTo(lx, ly);
          for (let s2 = 0; s2 < 4; s2++) { lx += (Math.random() - 0.5) * 30; ly += rr / 2; ctx.lineTo(lx, ly); }
          ctx.strokeStyle = Math.random() < 0.5 ? '#ffdcdc' : '#ff5a4a';
          ctx.lineWidth = 2 + Math.random() * 2; ctx.globalAlpha = 0.5 + Math.random() * 0.5; ctx.stroke();
        }
        ctx.restore();
      }
    }

    drawCity(view, viewer, viewer);       // yours, gold, at the bottom
    drawCity(view, 1 - viewer, viewer);   // theirs, veiled, at the top

    /* transient effects */
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      f.ttl -= dt;
      if (f.ttl <= 0) { fx.splice(i, 1); continue; }
      if (f.k === 'rift') continue;
      const a = f.ttl / f.max;
      ctx.save(); ctx.globalAlpha = a;
      if (f.k === 'line') {
        if (f.glow) { ctx.shadowColor = f.c; ctx.shadowBlur = 8; }
        ctx.strokeStyle = f.c; ctx.lineWidth = f.w;
        ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x2, f.y2); ctx.stroke();
      } else if (f.k === 'burst') {
        ctx.strokeStyle = f.c; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(f.x, f.y, (1 - a) * 18 + 3, 0, 7); ctx.stroke();
      } else if (f.k === 'ring') {
        ctx.strokeStyle = f.c; ctx.lineWidth = 3; ctx.shadowColor = f.c; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(f.x, f.y, (1 - a) * 40 + 8, 0, 7); ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();

    drawFog(view, viewer);
    drawMinimap(view, viewer);

    if (R.targeting) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,90,74,0.06)'; ctx.fillRect(0, 0, W, H);
      if (R.pointer) {
        ctx.strokeStyle = '#ff6a5a'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]);
        ctx.beginPath(); ctx.arc(R.pointer.x, R.pointer.y, C.POWERS.storm.radius * scale, 0, 7); ctx.stroke();
      }
      ctx.restore();
    }
  };

  function drawRift(f) {
    const a = Math.min(1, f.ttl / 1.2);
    ctx.save(); ctx.globalAlpha = a;
    ctx.shadowColor = '#7dff9e'; ctx.shadowBlur = 12;
    ctx.strokeStyle = '#5ad584'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(f.x - 20, f.y + 6); ctx.quadraticCurveTo(f.x - 5, f.y - 11, f.x + 4, f.y + 2);
    ctx.quadraticCurveTo(f.x + 11, f.y + 11, f.x + 21, f.y - 5); ctx.stroke();
    ctx.restore();
  }

  function drawCity(view, pi, viewer) {
    const own = pi === viewer, pl = view.players[pi];
    const city = view.map.sites[view.map.cities[pi]];
    const CX = dx(city.x, viewer), CY = dy(city.y, viewer);

    if (own) {
      /* home: the full works — grid plots, buildings, walls, the Seat of Power */
      for (let i = 0; i < C.SLOTS; i++) {
        const r = R.slotRect(i), s = pl.slots[i];
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(r.x, r.y, r.w, r.h, 10) : ctx.rect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = 'rgba(70,56,40,0.5)'; ctx.fill();
        ctx.strokeStyle = 'rgba(220,180,110,0.4)'; ctx.lineWidth = 1.5; ctx.stroke();
        if (R.selected === i) {
          ctx.strokeStyle = '#ffe9a8'; ctx.lineWidth = 3;
          ctx.globalAlpha = 0.6 + 0.4 * Math.sin(performance.now() / 180); ctx.stroke(); ctx.globalAlpha = 1;
        }
        if (s) {
          const use = s.bt === 'wall' ? S.post.rampart : S.b[s.bt];
          const sz = Math.min(r.w, r.h) * 1.02;
          if (use) ctx.drawImage(use, r.x + (r.w - sz) / 2, r.y + (r.h - sz) / 2, sz, sz);
          for (let lv = 1; lv < s.level; lv++) {
            ctx.fillStyle = '#ffe9a8'; ctx.shadowColor = '#ffe9a8'; ctx.shadowBlur = 4;
            ctx.beginPath(); ctx.arc(r.x + r.w / 2 - 12 + lv * 12, r.y + r.h - 8, 3, 0, 7); ctx.fill();
            ctx.shadowBlur = 0;
          }
          if (s.bt === 'shrine' && pl.pattern > 0) {
            ctx.strokeStyle = '#9cc8ff'; ctx.shadowColor = '#9cc8ff'; ctx.shadowBlur = 8; ctx.lineWidth = 3.5;
            ctx.beginPath();
            ctx.arc(r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) * 0.5, -Math.PI / 2, -Math.PI / 2 + (pl.pattern / 100) * Math.PI * 2);
            ctx.stroke(); ctx.shadowBlur = 0;
          }
        }
      }
    } else {
      /* the rival's city: veiled mounds on their slots; a revealed shrine burns through */
      for (let i = 0; i < C.SLOTS; i++) {
        const s = pl.slots[i];
        if (!s) continue;
        const col = i % 3, row = Math.floor(i / 3);
        const X = CX - 150 + col * 150, Y = CY - 150 - row * 78;
        let bt = s.bt;
        if (!(bt === 'shrine' && pl.revealed)) bt = 'veiled';
        const spr = S.b[bt];
        if (spr) ctx.drawImage(spr, X - 30, Y - 30, 60, 60);
        if (bt === 'shrine' && pl.pattern > 0) {
          ctx.strokeStyle = '#9cc8ff'; ctx.shadowColor = '#9cc8ff'; ctx.shadowBlur = 8; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(X, Y, 34, -Math.PI / 2, -Math.PI / 2 + (pl.pattern / 100) * Math.PI * 2);
          ctx.stroke(); ctx.shadowBlur = 0;
        }
      }
    }

    /* wall ring, castle, bars */
    if (pl.wallHp > 0) {
      const wallMax = own ? wallMaxOf(pl) : pl.wallHp;
      ctx.strokeStyle = own ? 'rgba(220,190,130,0.85)' : 'rgba(220,140,150,0.8)';
      ctx.lineWidth = 7;
      ctx.beginPath(); ctx.arc(CX, CY + (own ? 6 : -6), 96, own ? Math.PI : 0, own ? 2 * Math.PI : Math.PI); ctx.stroke();
      ctx.lineWidth = 2.5; ctx.strokeStyle = '#3a2c10';
      ctx.beginPath(); ctx.arc(CX, CY + (own ? 6 : -6), 96, own ? Math.PI : 0, own ? Math.PI + Math.PI * Math.max(0, pl.wallHp / wallMax) : Math.PI * Math.max(0, pl.wallHp / wallMax)); ctx.stroke();
    }
    const cw = 190, ch = cw * 0.67;
    ctx.drawImage(S.castle[own ? 0 : 1], CX - cw / 2, CY - ch / 2, cw, ch);
    const hpw = cw * 0.8, hx = CX - hpw / 2, hy = own ? CY + ch / 2 + 6 : CY - ch / 2 - 12;
    ctx.fillStyle = '#000b'; ctx.fillRect(hx - 1, hy - 1, hpw + 2, 8);
    ctx.fillStyle = own ? '#ffd98a' : '#ff8a96';
    ctx.fillRect(hx, hy, hpw * Math.max(0, pl.castleHp / C.CASTLE_HP), 6);
  }
  function wallMaxOf(pl) {
    const w2 = pl.slots.find((s) => s && s.bt === 'wall');
    return w2 ? C.WALL_HP[w2.level - 1] : C.WALL_HP[0];
  }

  /* ---------------- fog of war ---------------- */
  function drawFog(view, viewer) {
    if (!fogCv) { fogCv = document.createElement('canvas'); }
    fogCv.width = W; fogCv.height = H;
    const g = fogCv.getContext('2d');
    g.fillStyle = 'rgba(6,4,12,0.62)';   // geography stays legible through the fog
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'destination-out';
    for (const [x, y, r] of view.visSources) {
      const X = sx(dx(x, viewer)), Y = sy(dy(y, viewer)), rr = r * scale;
      if (Y < -rr || Y > H + rr) continue;
      const hole = g.createRadialGradient(X, Y, rr * 0.55, X, Y, rr);
      hole.addColorStop(0, 'rgba(0,0,0,1)'); hole.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = hole;
      g.beginPath(); g.arc(X, Y, rr, 0, 7); g.fill();
    }
    ctx.drawImage(fogCv, 0, 0);
  }

  /* ---------------- minimap (right edge strip) ---------------- */
  function drawMinimap(view, viewer) {
    const mw = 26, mx = W - mw - 4, mh = Math.min(H * 0.6, 380), my = (H - mh) / 2;
    ctx.save();
    ctx.fillStyle = 'rgba(10,8,18,0.72)';
    ctx.strokeStyle = 'rgba(200,164,79,0.4)';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(mx, my, mw, mh, 6) : ctx.rect(mx, my, mw, mh);
    ctx.fill(); ctx.stroke();
    const px = (x) => mx + (x / C.MAP.W) * mw, py = (y) => my + (y / C.MAP.H) * mh;
    for (const s of view.map.sites) {
      const st = view.sites[s.id];
      const X = px(dx(s.x, viewer)), Y = py(dy(s.y, viewer));
      if (s.kind === 'city') {
        const pi = view.map.cities.indexOf(s.id);
        ctx.fillStyle = pi === viewer ? '#ffd98a' : '#ff8a96';
        ctx.fillRect(X - 3, Y - 3, 6, 6);
      } else {
        ctx.fillStyle = !st ? '#3a3444' : (st.owner === -1 || st.owner == null ? '#8a8098' : (st.owner === viewer ? '#ffd98a' : '#ff8a96'));
        ctx.beginPath(); ctx.arc(X, Y, st && st.post ? 2.6 : 1.6, 0, 7); ctx.fill();
      }
    }
    /* alert pings */
    for (const f of fx) if (f.ping) {
      ctx.globalAlpha = f.ttl / f.max;
      ctx.strokeStyle = f.ping; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(px(f.x), py(f.y), 5 + (1 - f.ttl / f.max) * 5, 0, 7); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    /* viewport bracket */
    ctx.strokeStyle = '#ffe9a8'; ctx.lineWidth = 1.5;
    const vy = my + (R.camY / C.MAP.H) * mh, vh = (viewH / C.MAP.H) * mh;
    ctx.strokeRect(mx + 1.5, vy, mw - 3, vh);
    ctx.restore();
  }

  global.Render = R;
})(typeof window !== 'undefined' ? window : globalThis);

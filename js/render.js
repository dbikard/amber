/* render.js — ALL canvas drawing, isolated. A pure consumer of a view object:
 * either the live world (single-player / MP host) or a fog-filtered snapshot proxy
 * (MP guest). Fog is applied here for world-sourced views; snapshots arrive pre-fogged.
 * The viewer always sees their own city at the BOTTOM (guest renders the lane flipped). */
(function (global) {
  'use strict';

  const C = global.CONST, S = global.SPRITES;
  const R = { targeting: false, selected: -1, pointer: null };
  let cv = null, ctx = null, W = 0, H = 0, bg = null, fx = [];

  R.init = function (canvas) { cv = canvas; ctx = cv.getContext('2d'); R.resize(); };
  R.resize = function () {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bg = null;   // repaint the backdrop at the new size
  };

  /* ---------------- layout (viewer-relative: own end is always the bottom) ---------------- */
  const roadTop = () => H * 0.175, roadBot = () => H * 0.685;
  const flip = (p, viewer) => (viewer === 0 ? p : C.LANE - p);
  function laneY(p, viewer) { const q = flip(p, viewer) / C.LANE; return roadBot() - q * (roadBot() - roadTop()); }
  function roadX(p, viewer) { const q = flip(p, viewer) / C.LANE; return W / 2 + Math.sin(q * 2.4 + 0.9) * W * 0.05; }
  function unitXY(p, x, viewer) { return { x: roadX(p, viewer) + x * W * 0.0026, y: laneY(p, viewer) }; }
  R.yToLane = function (py, viewer) {
    /* screen-space fraction from own (bottom) end of the road → lane p for this viewer */
    const q = Math.max(0, Math.min(1, (roadBot() - py) / (roadBot() - roadTop())));
    return viewer === 0 ? q * C.LANE : C.LANE - q * C.LANE;
  };

  /* city slot grids: own = big pads at the bottom; rival = shrouded mounds up top */
  R.slotRect = function (pi, idx, viewer) {
    const own = pi === viewer;
    const col = idx % 3, row = Math.floor(idx / 3);
    if (own) {
      const gw = Math.min(W * 0.9, 420), cw = gw / 3;
      const gx = (W - gw) / 2, gy = H * 0.755, gh = H * 0.235 / 3;
      return { x: gx + col * cw + 3, y: gy + row * gh + 2, w: cw - 6, h: gh - 5 };
    }
    const gw = Math.min(W * 0.72, 330), cw = gw / 3;
    const gx = (W - gw) / 2, gy = H * 0.032, gh = H * 0.112 / 3;
    /* mirror rows so each city's row 0 hugs its castle */
    return { x: gx + col * cw + 2, y: gy + (2 - row) * gh + 1, w: cw - 4, h: gh - 3 };
  };
  R.hitSlot = function (px, py, viewer) {
    for (let i = 0; i < C.SLOTS; i++) {
      const r = R.slotRect(viewer, i, viewer);
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return i;
    }
    return -1;
  };
  function castleXY(pi, viewer) {
    const own = pi === viewer;
    return { x: roadX(own ? (viewer === 0 ? 0 : C.LANE) : (viewer === 0 ? C.LANE : 0), viewer),
             y: own ? roadBot() + H * 0.028 : roadTop() - H * 0.026 };
  }

  /* ---------------- the painted backdrop (cached per resize) ---------------- */
  function paintBg() {
    bg = document.createElement('canvas');
    bg.width = W; bg.height = H;
    const g = bg.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#140a12'); sky.addColorStop(0.45, '#0d0b18'); sky.addColorStop(1, '#131020');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    const rng = global.RNG.make(7);
    for (let i = 0; i < 90; i++) {   // cold stars over the void
      g.globalAlpha = 0.25 + rng.next() * 0.5;
      g.fillStyle = i % 7 ? '#cdd6ff' : '#ffe9c8';
      g.fillRect(rng.next() * W, rng.next() * H * 0.6, 1.4, 1.4);
    }
    g.globalAlpha = 1;
    /* city auras: rival's cold fire above, Amber's gold below */
    let a = g.createRadialGradient(W / 2, 0, 0, W / 2, 0, H * 0.34);
    a.addColorStop(0, 'rgba(190,70,90,0.22)'); a.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = a; g.fillRect(0, 0, W, H * 0.4);
    a = g.createRadialGradient(W / 2, H, 0, W / 2, H, H * 0.42);
    a.addColorStop(0, 'rgba(255,205,110,0.24)'); a.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = a; g.fillRect(0, H * 0.55, W, H * 0.45);
    /* the black road: a winding band with chaos veins */
    const bw = W * 0.165;
    g.beginPath();
    for (let p = 0; p <= C.LANE; p += 40) g.lineTo(W / 2 + Math.sin(p / C.LANE * 2.4 + 0.9) * W * 0.05 - bw, roadBot() - p / C.LANE * (roadBot() - roadTop()));
    for (let p = C.LANE; p >= 0; p -= 40) g.lineTo(W / 2 + Math.sin(p / C.LANE * 2.4 + 0.9) * W * 0.05 + bw, roadBot() - p / C.LANE * (roadBot() - roadTop()));
    g.closePath();
    const road = g.createLinearGradient(0, roadTop(), 0, roadBot());
    road.addColorStop(0, '#1b1220'); road.addColorStop(0.5, '#161219'); road.addColorStop(1, '#1d1721');
    g.fillStyle = road; g.fill();
    g.strokeStyle = 'rgba(120,90,140,0.35)'; g.lineWidth = 2; g.stroke();
    for (let v = 0; v < 7; v++) {   // veins of Chaos in the stone
      g.beginPath();
      let px = W / 2 + rng.range(-bw * 0.8, bw * 0.8);
      g.moveTo(px, roadBot());
      for (let y = roadBot(); y > roadTop(); y -= 30) {
        px += rng.range(-14, 14);
        g.lineTo(W / 2 + Math.sin((roadBot() - y) / (roadBot() - roadTop()) * 2.4 + 0.9) * W * 0.05 + Math.max(-bw + 8, Math.min(bw - 8, px - W / 2)), y);
      }
      g.strokeStyle = v % 2 ? 'rgba(90,160,110,0.16)' : 'rgba(60,120,80,0.22)';
      g.lineWidth = 1 + rng.next() * 2; g.stroke();
    }
  }

  /* ---------------- event → effect conversion ---------------- */
  const TINT = { 0: '#ffd98a', 1: '#ff8a96', 2: '#7dff9e' };
  R.addEvents = function (events, view, viewer) {
    for (const ev of events) {
      if (ev.e === 'shot') {
        const r = R.slotRect(ev.pi, ev.slot, viewer), to = unitXY(ev.to.p, ev.to.x, viewer);
        fx.push({ k: 'line', x: r.x + r.w / 2, y: r.y + r.h / 2, x2: to.x, y2: to.y, ttl: 0.22, max: 0.22, c: '#e8d8a8', w: 1.5 });
      } else if (ev.e === 'bolt') {
        const f = unitXY(ev.from.p, ev.from.x, viewer), to = unitXY(ev.to.p, ev.to.x, viewer);
        fx.push({ k: 'line', x: f.x, y: f.y, x2: to.x, y2: to.y, ttl: 0.3, max: 0.3, c: TINT[ev.from.owner], w: 2.2, glow: true });
      } else if (ev.e === 'die') {
        const at = unitXY(ev.p, ev.x, viewer);
        fx.push({ k: 'burst', x: at.x, y: at.y, ttl: 0.55, max: 0.55, c: TINT[ev.owner] });
      } else if (ev.e === 'rift') {
        const at = unitXY(ev.p, 0, viewer);
        fx.push({ k: 'rift', x: at.x, y: at.y, ttl: 3.2, max: 3.2 });
      } else if (ev.e === 'siege') {
        const at = castleXY(ev.pi, viewer);
        fx.push({ k: 'burst', x: at.x + (Math.random() - 0.5) * 50, y: at.y - 8, ttl: 0.35, max: 0.35, c: '#ffb090' });
      } else if (ev.e === 'walk' || ev.e === 'pattern') {
        const at = castleXY(ev.pi, viewer);
        fx.push({ k: 'ring', x: at.x, y: at.y, ttl: 1.4, max: 1.4, c: '#9cc8ff' });
      } else if (ev.e === 'build' || ev.e === 'up') {
        const r = R.slotRect(ev.pi, ev.slot, viewer);
        fx.push({ k: 'ring', x: r.x + r.w / 2, y: r.y + r.h / 2, ttl: 0.6, max: 0.6, c: '#ffe9a8' });
      } else if (ev.e === 'trump') {
        const at = castleXY(ev.pi, viewer);
        fx.push({ k: 'ring', x: at.x, y: at.y, ttl: 1.0, max: 1.0, c: '#e8ecff' });
      }
    }
  };

  /* ---------------- per-frame draw ---------------- */
  R.frame = function (view, viewer, dt) {
    if (!bg) paintBg();
    ctx.drawImage(bg, 0, 0, W, H);

    /* rift scars first (they live on the road surface) */
    for (const f of fx) if (f.k === 'rift') drawRift(f);

    /* units, painter-sorted */
    const units = view.units.slice().sort((a, b) => laneY(a.p, viewer) - laneY(b.p, viewer));
    for (const u of units) {
      const { x, y } = unitXY(u.p, u.x, viewer);
      const def = C.UNITS[u.kind], sc = (0.85 + def.size * 0.035) * Math.max(0.8, Math.min(1.3, H / 760));
      ctx.save();
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(x, y + 11 * sc, 9 * sc, 3.2 * sc, 0, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
      const spr = S.u[u.kind] && S.u[u.kind][u.owner === 2 ? 2 : (u.owner === viewer ? 0 : 1)];
      if (spr) ctx.drawImage(spr, x - 14 * sc, y - 16 * sc, 28 * sc, 28 * sc);
      if (u.hp < u.maxHp) {
        ctx.fillStyle = '#000a'; ctx.fillRect(x - 10, y - 20 * sc, 20, 3);
        ctx.fillStyle = u.owner === 2 ? '#7dff9e' : (u.owner === viewer ? '#ffd98a' : '#ff8a96');
        ctx.fillRect(x - 10, y - 20 * sc, 20 * Math.max(0, u.hp / u.maxHp), 3);
      }
      ctx.restore();
    }

    /* storms of the Jewel */
    for (const st of view.storms || []) {
      const at = unitXY(st.p, 0, viewer);
      const rpx = C.POWERS.storm.radius / C.LANE * (roadBot() - roadTop()) * 2.1;
      if (st.delay > 0) {
        ctx.save();
        ctx.globalAlpha = 0.5 + 0.4 * Math.sin(st.delay * 18);
        ctx.strokeStyle = '#ff6a5a'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.arc(at.x, at.y, rpx, 0, 7); ctx.stroke();
        ctx.restore();
      } else {
        ctx.save();
        const cg = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, rpx);
        cg.addColorStop(0, 'rgba(30,10,20,0.55)'); cg.addColorStop(1, 'rgba(30,10,20,0)');
        ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(at.x, at.y, rpx, 0, 7); ctx.fill();
        for (let i = 0; i < 3; i++) {   // the red lightnings of the Jewel
          ctx.beginPath();
          let lx = at.x + (Math.random() - 0.5) * rpx, ly = at.y - rpx;
          ctx.moveTo(lx, ly);
          for (let s2 = 0; s2 < 4; s2++) { lx += (Math.random() - 0.5) * 22; ly += rpx / 2; ctx.lineTo(lx, ly); }
          ctx.strokeStyle = Math.random() < 0.5 ? '#ffdcdc' : '#ff5a4a';
          ctx.lineWidth = 1.5 + Math.random() * 1.5; ctx.globalAlpha = 0.5 + Math.random() * 0.5; ctx.stroke();
        }
        ctx.restore();
      }
    }

    drawCity(view, viewer, viewer);       // yours, in gold, below
    drawCity(view, 1 - viewer, viewer);   // theirs, veiled, above

    /* transient effects */
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      f.ttl -= dt;
      if (f.ttl <= 0) { fx.splice(i, 1); continue; }
      const a = f.ttl / f.max;
      ctx.save(); ctx.globalAlpha = a;
      if (f.k === 'line') {
        if (f.glow) { ctx.shadowColor = f.c; ctx.shadowBlur = 8; }
        ctx.strokeStyle = f.c; ctx.lineWidth = f.w;
        ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x2, f.y2); ctx.stroke();
      } else if (f.k === 'burst') {
        ctx.strokeStyle = f.c; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(f.x, f.y, (1 - a) * 16 + 3, 0, 7); ctx.stroke();
      } else if (f.k === 'ring') {
        ctx.strokeStyle = f.c; ctx.lineWidth = 2.5; ctx.shadowColor = f.c; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(f.x, f.y, (1 - a) * 34 + 6, 0, 7); ctx.stroke();
      }
      ctx.restore();
    }

    /* storm-targeting overlay */
    if (R.targeting) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,90,74,0.07)';
      ctx.fillRect(0, roadTop() - 10, W, roadBot() - roadTop() + 20);
      if (R.pointer) {
        ctx.strokeStyle = '#ff6a5a'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]);
        const rpx = C.POWERS.storm.radius / C.LANE * (roadBot() - roadTop()) * 2.1;
        ctx.beginPath(); ctx.arc(R.pointer.x, R.pointer.y, rpx, 0, 7); ctx.stroke();
      }
      ctx.restore();
    }
  };

  function drawRift(f) {
    const a = Math.min(1, f.ttl / 1.2);
    ctx.save(); ctx.globalAlpha = a;
    ctx.shadowColor = '#7dff9e'; ctx.shadowBlur = 12;
    ctx.strokeStyle = '#5ad584'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(f.x - 16, f.y + 5); ctx.quadraticCurveTo(f.x - 4, f.y - 9, f.x + 3, f.y + 2);
    ctx.quadraticCurveTo(f.x + 9, f.y + 9, f.x + 17, f.y - 4); ctx.stroke();
    ctx.restore();
  }

  function drawCity(view, pi, viewer) {
    const own = pi === viewer, pl = view.players[pi];
    for (let i = 0; i < C.SLOTS; i++) {
      const r = R.slotRect(pi, i, viewer), s = pl.slots[i];
      ctx.save();
      /* the plot */
      ctx.beginPath();
      const rad = 8;
      ctx.roundRect ? ctx.roundRect(r.x, r.y, r.w, r.h, rad) : ctx.rect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = own ? 'rgba(70,56,40,0.45)' : 'rgba(48,32,44,0.38)';
      ctx.fill();
      ctx.strokeStyle = own ? 'rgba(220,180,110,0.35)' : 'rgba(160,90,110,0.22)';
      ctx.lineWidth = 1; ctx.stroke();
      if (own && R.selected === i) {
        ctx.strokeStyle = '#ffe9a8'; ctx.lineWidth = 2.5;
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(performance.now() / 180); ctx.stroke(); ctx.globalAlpha = 1;
      }
      if (s) {
        /* fog: the rival's works are veiled unless the Pattern reveals them */
        let bt = s.bt;
        if (!own && !(bt === 'shrine' && pl.revealed)) bt = 'veiled';
        const spr = S.b[bt];
        const sz = Math.min(r.w, r.h) * (own ? 0.98 : 0.9);
        if (spr) ctx.drawImage(spr, r.x + (r.w - sz) / 2, r.y + (r.h - sz) / 2, sz, sz);
        if (own && s.level > 1) {
          for (let lv = 0; lv < s.level; lv++) {
            ctx.fillStyle = '#ffe9a8'; ctx.shadowColor = '#ffe9a8'; ctx.shadowBlur = 4;
            ctx.beginPath(); ctx.arc(r.x + r.w / 2 - 10 + lv * 10, r.y + r.h - 6, 2.5, 0, 7); ctx.fill();
          }
          ctx.shadowBlur = 0;
        }
        /* the Pattern's progress burns around a walking shrine */
        if (bt === 'shrine' && (own || pl.revealed) && pl.pattern > 0) {
          ctx.strokeStyle = '#9cc8ff'; ctx.shadowColor = '#9cc8ff'; ctx.shadowBlur = 8; ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) * 0.46, -Math.PI / 2, -Math.PI / 2 + (pl.pattern / 100) * Math.PI * 2);
          ctx.stroke(); ctx.shadowBlur = 0;
          if (pl.walking && Math.random() < 0.3) {
            ctx.fillStyle = '#dceaff';
            ctx.fillRect(r.x + r.w / 2 + (Math.random() - 0.5) * r.w * 0.5, r.y + r.h / 2 - Math.random() * r.h * 0.5, 1.6, 1.6);
          }
        }
      }
      ctx.restore();
    }
    /* the Seat of Power */
    const at = castleXY(pi, viewer);
    const cw = Math.min(W * 0.34, 150), ch = cw * 0.67;
    ctx.drawImage(S.castle[own ? 0 : 1], at.x - cw / 2, at.y - ch / 2, cw, ch);
    const hpw = cw * 0.86, hx = at.x - hpw / 2, hy = own ? at.y + ch / 2 + 3 : at.y - ch / 2 - 7;
    ctx.fillStyle = '#000b'; ctx.fillRect(hx - 1, hy - 1, hpw + 2, 6);
    ctx.fillStyle = own ? '#ffd98a' : '#ff8a96';
    ctx.fillRect(hx, hy, hpw * Math.max(0, pl.castleHp / C.CASTLE_HP), 4);
  }

  global.Render = R;
})(typeof window !== 'undefined' ? window : globalThis);

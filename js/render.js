/* render.js — the PixiJS (WebGL) renderer, isolated (v0.3 "The Painted World").
 * Same public surface as the Canvas2D renderer it replaces: game logic never changed.
 * Scene: baked painterly terrain (biomes, forests, corruption, cliffs, cobbled paths),
 * retained sprite pools, additive-blend glows, soft fog-of-war via erase-blend holes.
 * The viewer's own city is ALWAYS at the bottom (viewer 1 sees the world rotated 180°). */
(function (global) {
  'use strict';

  const C = global.CONST, S = global.SPRITES;
  const R = { targeting: false, selected: -1, pointer: null, camY: 0, ready: false };
  let app = null, W = 0, H = 0, scale = 1, viewH = 0;
  let stage = {};            // named layers
  let texCache = new Map();  // canvas -> PIXI.Texture
  let fx = [];               // transient effects (own display objects)
  let unitPool = new Map();  // unit id -> {c, spr, bar, lastHp, owner}
  let siteFx = new Map();    // site id -> retained per-site display state
  let cityFx = null, lastMapKey = '', curView = null, curViewer = 0;
  let fogRT = null, fogScene = null, holeTex = null, T = 0;

  const tex = (cv2) => {
    if (!texCache.has(cv2)) texCache.set(cv2, PIXI.Texture.from(cv2));
    return texCache.get(cv2);
  };

  /* ---------------- boot / resize ---------------- */
  R.init = async function (canvas) {
    app = new PIXI.Application();
    await app.init({
      canvas, antialias: true, backgroundColor: 0x0d0b16,
      resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true,
      width: window.innerWidth, height: window.innerHeight
    });
    app.ticker.stop();   // game.js owns the loop
    const mk2 = () => new PIXI.Container();
    stage.world = mk2();
    for (const k of ['terrain', 'rift', 'site', 'banner', 'unit', 'city', 'storm', 'fxw', 'glow']) {
      stage[k] = mk2(); stage.world.addChild(stage[k]);
    }
    stage.glow.blendMode = 'add';
    stage.fog = new PIXI.Sprite(); stage.fog.alpha = 1;
    stage.mini = new PIXI.Graphics();
    stage.target = new PIXI.Graphics();
    stage.vignette = new PIXI.Sprite();
    app.stage.addChild(stage.world, stage.fog, stage.vignette, stage.mini, stage.target);
    holeTex = makeRadialTex(256, [[0, 'rgba(255,255,255,1)'], [0.55, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]);
    R.resize();
    R.ready = true;
    app.renderer.render(app.stage);
  };

  R.resize = function () {
    if (!app) return;
    W = window.innerWidth; H = window.innerHeight;
    app.renderer.resize(W, H);
    scale = W / C.MAP.W;
    viewH = H / scale;
    R.camY = C.MAP.H - viewH;
    if (fogRT) { fogRT.destroy(true); fogRT = null; }
    makeVignette();
  };
  R.maxCamY = () => Math.max(0, C.MAP.H - viewH);

  /* display space = world rotated 180° for viewer 1 */
  const dx = (x, viewer) => (viewer === 0 ? x : C.MAP.W - x);
  const dy = (y, viewer) => (viewer === 0 ? y : C.MAP.H - y);
  R.toWorld = function (px, py, viewer) {
    const wx = px / scale, wy = py / scale + R.camY;
    return { x: dx(wx, viewer), y: dy(wy, viewer) };
  };
  R.pan = function (dpx) { R.camY = Math.max(0, Math.min(R.maxCamY(), R.camY - dpx / scale)); };

  /* ---------------- hit-testing (unchanged math) ---------------- */
  R.slotRect = function (idx) {
    const col = idx % 3, row = Math.floor(idx / 3);
    const gw = 460, cw = gw / 3, gh = 240 / 3;
    const gx = (C.MAP.W - gw) / 2, gy = C.MAP.H - 250;
    return { x: gx + col * cw + 4, y: gy + row * gh + 3, w: cw - 8, h: gh - 6 };
  };
  R.hitSlot = function (px, py) {
    for (let i = 0; i < C.SLOTS; i++) {
      const r = R.slotRect(i);
      const x = r.x * scale, y = (r.y - R.camY) * scale, w = r.w * scale, h = r.h * scale;
      if (px >= x && px <= x + w && py >= y && py <= y + h) return i;
    }
    return -1;
  };
  R.hitSite = function (px, py, view, viewer) {
    let best = -1, bd = 44 * 44;
    for (const s of view.map.sites) {
      const X = dx(s.x, viewer) * scale, Y = (dy(s.y, viewer) - R.camY) * scale;
      const dd = (px - X) * (px - X) + (py - Y) * (py - Y);
      if (dd < bd) { bd = dd; best = s.id; }
    }
    return best;
  };
  R.hitMinimap = (px) => px > W - 34;
  R.minimapJump = function (py) { R.camY = Math.max(0, Math.min(R.maxCamY(), (py / H) * C.MAP.H - viewH / 2)); };

  /* ---------------- small texture helpers ---------------- */
  function makeRadialTex(size, stops) {
    const cv2 = document.createElement('canvas');
    cv2.width = cv2.height = size;
    const g = cv2.getContext('2d');
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const [o, c2] of stops) gr.addColorStop(o, c2);
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
    return PIXI.Texture.from(cv2);
  }
  function makeVignette() {
    const cv2 = document.createElement('canvas');
    cv2.width = 512; cv2.height = 512;
    const g = cv2.getContext('2d');
    const gr = g.createRadialGradient(256, 256, 130, 256, 256, 360);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(5,3,10,0.55)');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
    stage.vignette.texture = PIXI.Texture.from(cv2);
    stage.vignette.width = W; stage.vignette.height = H;
  }

  /* ================= TERRAIN BAKE (painterly, display space, per map+viewer) ================= */
  function edgeCurve(map, ei, viewer) {
    /* deterministic curve per edge (independent of viewer flip direction) */
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

  function bakeTerrain(view, viewer) {
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

    /* large soft ground blobs for painted variance */
    for (let i = 0; i < 90; i++) {
      const y = rng.next() * MH, x = rng.next() * MW, r = rng.range(60, 190);
      const band = y < MH * 0.33 ? ['#38181c', '#301a24'] : y > MH * 0.66 ? ['#332c14', '#2c2a12'] : ['#201a2c', '#1a1626'];
      const col = band[Math.floor(rng.next() * band.length)];
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, col + ''); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = 0.35; g.fillStyle = gr;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    g.globalAlpha = 1;

    /* corruption bleeding from the black road spine */
    const spine = new Set(map.roads.concat(map.cities));
    const pathPts = [];   // all path samples, for tree rejection
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

    /* forests — the jungles of Shadow (kept off paths, sites, and cities) */
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

    /* site grounds: pools, crags with cliff shadows, milestones (+ baked name plates) */
    for (const s of map.sites) {
      const X = dx(s.x, viewer), Y = dy(s.y, viewer);
      if (s.kind === 'vantage') {   // rocky rise with a cliff edge
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
      if (s.kind === 'spring') {    // a mirror-pool of Shadow
        g.globalAlpha = 0.5; g.fillStyle = '#000';
        g.beginPath(); g.ellipse(X + 3, Y + 8, 40, 15, 0, 0, 7); g.fill(); g.globalAlpha = 1;
        const gr = g.createRadialGradient(X, Y, 2, X, Y, 34);
        gr.addColorStop(0, '#3a6a8c'); gr.addColorStop(0.6, '#1c3448'); gr.addColorStop(1, '#0c1622');
        g.fillStyle = gr; g.beginPath(); g.ellipse(X, Y, 33, 14, 0, 0, 7); g.fill();
        g.strokeStyle = 'rgba(150,200,240,0.4)'; g.lineWidth = 1.4;
        g.beginPath(); g.ellipse(X, Y, 33, 14, 0, 0, 7); g.stroke();
        g.beginPath(); g.ellipse(X, Y, 20, 8, 0, 0, 7); g.stroke();
      }
      const spr = s.kind !== 'city' ? S.site[s.kind] : null;
      if (spr && s.kind !== 'spring') g.drawImage(spr, X - 34, Y - 40, 68, 68);
      if (s.kind !== 'city') {
        g.font = '600 13px Georgia, serif'; g.textAlign = 'center';
        g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 3; g.strokeText(s.name, X, Y + 44);
        g.fillStyle = 'rgba(222,204,164,0.85)'; g.fillText(s.name, X, Y + 44);
      }
    }

    /* city grounds: warm worked earth below, cold court above */
    for (let pi2 = 0; pi2 < 2; pi2++) {
      const cs = map.sites[map.cities[pi2]];
      const X = dx(cs.x, viewer), Y = dy(cs.y, viewer), own = Y > MH / 2;
      const gr = g.createRadialGradient(X, Y, 20, X, Y, 340);
      gr.addColorStop(0, own ? 'rgba(120,96,44,0.4)' : 'rgba(110,44,54,0.34)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(X, Y, 340, 0, 7); g.fill();
    }
    /* fine grain over everything */
    for (let i = 0; i < 5200; i++) {
      g.globalAlpha = 0.05 + rng.next() * 0.07;
      g.fillStyle = rng.next() < 0.5 ? '#000' : '#c8b890';
      g.fillRect(rng.next() * MW, rng.next() * MH, 1.6, 1.6);
    }
    g.globalAlpha = 1;
    return cv2;
  }

  /* ---------------- scene (re)build per map/viewer ---------------- */
  function rebuildScene(view, viewer) {
    for (const k of ['terrain', 'rift', 'site', 'banner', 'unit', 'city', 'storm', 'fxw', 'glow'])
      stage[k].removeChildren();
    for (const f of fx) if (f.obj) f.obj.destroy();
    fx = []; unitPool.clear(); siteFx.clear(); cityFx = null;

    const terrain = new PIXI.Sprite(PIXI.Texture.from(bakeTerrain(view, viewer)));
    terrain.width = C.MAP.W; terrain.height = C.MAP.H;
    stage.terrain.addChild(terrain);

    /* springs shimmer forever */
    for (const s of view.map.sites) {
      if (s.kind !== 'spring') continue;
      const sh = new PIXI.Sprite(holeTex);
      sh.anchor.set(0.5); sh.tint = 0x5a9ac8; sh.blendMode = 'add';
      sh.position.set(dx(s.x, viewer), dy(s.y, viewer));
      sh.width = 90; sh.height = 44; sh.alpha = 0.12; sh._pulse = s.id * 1.7;
      stage.glow.addChild(sh);
    }
    /* the banner */
    const flag = new PIXI.Sprite(tex(S.flag));
    flag.anchor.set(0.15, 0.95); flag.scale.set(1.15);
    stage.banner.addChild(flag);

    /* per-site dynamic bits */
    for (const s of view.map.sites) {
      if (s.kind === 'city') continue;
      const c2 = new PIXI.Container();
      c2.position.set(dx(s.x, viewer), dy(s.y, viewer));
      const ring = new PIXI.Graphics();
      const post = new PIXI.Sprite(); post.anchor.set(0.5, 0.62); post.width = 60; post.height = 60;
      const bar = new PIXI.Graphics();
      const pips = new PIXI.Graphics();
      c2.addChild(ring, post, bar, pips);
      stage.site.addChild(c2);
      siteFx.set(s.id, { c: c2, ring, post, bar, pips, hash: '' });
    }

    /* cities */
    cityFx = { own: buildCityOwn(view, viewer), foe: buildCityFoe(view, viewer) };
    lastMapKey = mapKey(view, viewer);
  }
  const mapKey = (view, viewer) => (view.mapSeed || view.map.sites[3].x.toFixed(2)) + ':' + viewer;

  function buildCityOwn(view, viewer) {
    const g = {};
    g.plots = new PIXI.Graphics();
    stage.city.addChild(g.plots);
    for (let i = 0; i < C.SLOTS; i++) {
      const r = R.slotRect(i);
      g.plots.roundRect(r.x, r.y, r.w, r.h, 10).fill({ color: 0x46382a, alpha: 0.55 })
        .stroke({ width: 1.5, color: 0xdcb46e, alpha: 0.4 });
    }
    g.sel = new PIXI.Graphics(); stage.city.addChild(g.sel);
    g.bSprites = [];
    for (let i = 0; i < C.SLOTS; i++) {
      const sp = new PIXI.Sprite(); sp.anchor.set(0.5); sp.visible = false;
      stage.city.addChild(sp); g.bSprites.push(sp);
    }
    g.deco = new PIXI.Graphics(); stage.city.addChild(g.deco);
    const city = view.map.sites[view.map.cities[viewer]];
    g.cx = dx(city.x, viewer); g.cy = dy(city.y, viewer);
    g.castle = new PIXI.Sprite(tex(S.castle[0]));
    g.castle.anchor.set(0.5); g.castle.width = 200; g.castle.height = 134;
    g.castle.position.set(g.cx, g.cy);
    const aura = new PIXI.Sprite(holeTex);
    aura.anchor.set(0.5); aura.tint = 0xffd98a; aura.blendMode = 'add'; aura.alpha = 0.14;
    aura.width = 520; aura.height = 380; aura.position.set(g.cx, g.cy);
    stage.glow.addChild(aura);
    stage.city.addChild(g.castle);
    g.wall = new PIXI.Graphics(); g.bars = new PIXI.Graphics();
    stage.city.addChild(g.wall, g.bars);
    return g;
  }
  function buildCityFoe(view, viewer) {
    const g = {};
    const city = view.map.sites[view.map.cities[1 - viewer]];
    g.cx = dx(city.x, viewer); g.cy = dy(city.y, viewer);
    g.mounds = [];
    for (let i = 0; i < C.SLOTS; i++) {
      const sp = new PIXI.Sprite(); sp.anchor.set(0.5); sp.visible = false; sp.width = 62; sp.height = 62;
      stage.city.addChild(sp); g.mounds.push(sp);
    }
    const aura = new PIXI.Sprite(holeTex);
    aura.anchor.set(0.5); aura.tint = 0xc84856; aura.blendMode = 'add'; aura.alpha = 0.12;
    aura.width = 520; aura.height = 380; aura.position.set(g.cx, g.cy);
    stage.glow.addChild(aura);
    g.castle = new PIXI.Sprite(tex(S.castle[1]));
    g.castle.anchor.set(0.5); g.castle.width = 200; g.castle.height = 134;
    g.castle.position.set(g.cx, g.cy);
    g.shrineRing = new PIXI.Graphics();
    g.wall = new PIXI.Graphics(); g.bars = new PIXI.Graphics();
    stage.city.addChild(g.castle, g.shrineRing, g.wall, g.bars);
    return g;
  }

  /* ---------------- events → transient fx ---------------- */
  const TINT = { 0: 0xffd98a, 1: 0xff8a96, 2: 0x7dff9e };
  function addFx(f) {
    fx.push(f);
    if (f.obj) (f.add ? stage.glow : stage.fxw).addChild(f.obj);
  }
  function lineFx(x1, y1, x2, y2, color, w2, ttl) {
    const gg = new PIXI.Graphics();
    gg.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: w2, color, cap: 'round' });
    addFx({ k: 'line', obj: gg, ttl, max: ttl, x: x1, y: y1 });
  }
  function ringFx(x, y, color, ttl, big, ping) {
    const gg = new PIXI.Graphics();
    addFx({ k: 'ring', obj: gg, ttl, max: ttl, x, y, color, big: big || 40, ping });
  }
  R.addEvents = function (events, view, viewer) {
    if (!R.ready) return;
    for (const ev of events) {
      const ex = ev.x != null ? dx(ev.x, viewer) : 0, ey = ev.y != null ? dy(ev.y, viewer) : 0;
      if (ev.e === 'shot' && ev.pi === viewer) {
        const r = R.slotRect(ev.slot);
        lineFx(r.x + r.w / 2, r.y + r.h / 2, dx(ev.to.x, viewer), dy(ev.to.y, viewer), 0xe8d8a8, 1.5, 0.22);
      } else if (ev.e === 'wshot') {
        lineFx(ex, ey - 16, dx(ev.to.x, viewer), dy(ev.to.y, viewer), 0xe8d8a8, 1.5, 0.22);
      } else if (ev.e === 'bolt') {
        lineFx(dx(ev.from.x, viewer), dy(ev.from.y, viewer), dx(ev.to.x, viewer), dy(ev.to.y, viewer), TINT[ev.from.owner], 2.4, 0.3);
      } else if (ev.e === 'die') {
        const sp = new PIXI.Sprite(holeTex);
        sp.anchor.set(0.5); sp.tint = TINT[ev.owner]; sp.blendMode = 'add';
        sp.position.set(ex, ey); sp.width = sp.height = 10;
        addFx({ k: 'puff', obj: sp, ttl: 0.5, max: 0.5, x: ex, y: ey, add: true });
      } else if (ev.e === 'rift') {
        const gg = new PIXI.Graphics();
        gg.moveTo(ex - 20, ey + 6).quadraticCurveTo(ex - 5, ey - 11, ex + 4, ey + 2)
          .quadraticCurveTo(ex + 11, ey + 11, ex + 21, ey - 5)
          .stroke({ width: 3, color: 0x5ad584, cap: 'round' });
        stage.rift.addChild(gg);
        fx.push({ k: 'rift', obj: gg, ttl: 3.2, max: 3.2, x: ex, y: ey, ping: 0x7dff9e, keep: 'rift' });
      } else if (ev.e === 'siege') {
        ringFx(ex, ey, 0xffb090, 0.35, 22, ev.pi === viewer ? 0xff5a4a : null);
      } else if (ev.e === 'hurtpost') {
        if (ev.pi === viewer) ringFx(ex, ey, 0xff8a5a, 1.2, 44, 0xff8a5a);
      } else if (ev.e === 'post' || ev.e === 'postup') {
        ringFx(ex, ey, 0xffe9a8, 0.8, 44);
      } else if (ev.e === 'postdie') {
        ringFx(ex, ey, 0xcfc6d8, 0.8, 44, ev.pi === viewer ? 0xff5a4a : null);
      } else if (ev.e === 'build' || ev.e === 'up') {
        if (ev.pi === viewer) { const r = R.slotRect(ev.slot); ringFx(r.x + r.w / 2, r.y + r.h / 2, 0xffe9a8, 0.6, 34); }
      } else if (ev.e === 'walk' || ev.e === 'pattern' || ev.e === 'trump') {
        const city = view.map.sites[view.map.cities[ev.pi]];
        ringFx(dx(city.x, viewer), dy(city.y, viewer), ev.e === 'trump' ? 0xe8ecff : 0x9cc8ff, 1.3, 70);
      }
    }
  };

  /* ---------------- per-frame ---------------- */
  R.frame = function (view, viewer, dt) {
    if (!R.ready) return;
    T += dt;
    curView = view; curViewer = viewer;
    if (mapKey(view, viewer) !== lastMapKey) rebuildScene(view, viewer);

    stage.world.scale.set(scale);
    stage.world.position.set(0, -R.camY * scale);

    updateSites(view, viewer);
    updateBanner(view, viewer);
    updateUnits(view, viewer, dt);
    updateStorms(view, viewer);
    updateCities(view, viewer);
    updateFx(dt);
    for (const sh of stage.glow.children) if (sh._pulse != null) sh.alpha = 0.09 + 0.06 * Math.sin(T * 2 + sh._pulse);
    updateFog(view, viewer);
    updateMinimap(view, viewer);
    updateTargeting();

    app.renderer.render(app.stage);
  };

  function updateSites(view, viewer) {
    for (const s of view.map.sites) {
      const sf = siteFx.get(s.id);
      if (!sf) continue;
      const st = view.sites[s.id];
      const hash = st ? [st.owner, st.live, st.post && st.post.bt, st.post && st.post.level, st.post && st.post.hp | 0].join('|') : 'x';
      if (hash !== sf.hash) {
        sf.hash = hash;
        sf.ring.clear(); sf.bar.clear(); sf.pips.clear();
        sf.post.visible = false;
        if (st) {
          if (st.owner >= 0) {
            sf.ring.circle(0, 0, 40).stroke({ width: 2, color: st.owner === viewer ? 0xffd98a : 0xff8a96, alpha: st.live ? 0.65 : 0.35 });
          }
          if (st.post) {
            sf.post.visible = true;
            sf.post.texture = tex(S.post[st.post.bt]);
            sf.post.width = 60; sf.post.height = 60;
            sf.post.alpha = st.live ? 1 : 0.55;
            for (let lv = 1; lv < st.post.level; lv++)
              sf.pips.circle(-12 + lv * 12, 24, 3).fill(0xffe9a8);
            if (st.live && st.post.hp != null && st.post.hp < st.post.maxHp) {
              sf.bar.rect(-24, -52, 48, 4).fill({ color: 0x000000, alpha: 0.7 });
              sf.bar.rect(-24, -52, 48 * Math.max(0, st.post.hp / st.post.maxHp), 4)
                .fill(st.owner === viewer ? 0xffd98a : 0xff8a96);
            }
          }
        }
      }
    }
  }

  function updateBanner(view, viewer) {
    const flag = stage.banner.children[0];
    if (!flag) return;
    const b = view.players[viewer].banner;
    flag.visible = b >= 0;
    if (b >= 0) {
      const s = view.map.sites[b];
      flag.position.set(dx(s.x, viewer) + 20, dy(s.y, viewer) - 8);
      flag.rotation = Math.sin(T * 2.4) * 0.06;
    }
  }

  function updateUnits(view, viewer, dt) {
    const live = new Set();
    for (const u of view.units) {
      live.add(u.id);
      let p = unitPool.get(u.id);
      const tint = u.owner === 2 ? 2 : (u.owner === viewer ? 0 : 1);
      if (!p) {
        const c2 = new PIXI.Container();
        const sh = new PIXI.Graphics();
        sh.ellipse(0, 11, 9, 3.2).fill({ color: 0x000000, alpha: 0.4 });
        const spr = new PIXI.Sprite(tex(S.u[u.kind][tint]));
        spr.anchor.set(0.5, 0.58);
        const sc = 1 + C.UNITS[u.kind].size * 0.05;
        spr.scale.set(sc);
        const bar = new PIXI.Graphics();
        c2.addChild(sh, spr, bar);
        stage.unit.addChild(c2);
        p = { c: c2, spr, bar, lastHp: -1, sc };
        unitPool.set(u.id, p);
      }
      p.c.position.set(dx(u.x, viewer), dy(u.y, viewer));
      p.c.zIndex = dy(u.y, viewer);
      p.spr.y = Math.sin(T * 9 + u.id) * 1.3;   // march bob
      if (u.hp !== p.lastHp) {
        p.lastHp = u.hp;
        p.bar.clear();
        if (u.hp < u.maxHp) {
          p.bar.rect(-11, -22 * p.sc, 22, 3.5).fill({ color: 0x000000, alpha: 0.7 });
          p.bar.rect(-11, -22 * p.sc, 22 * Math.max(0, u.hp / u.maxHp), 3.5)
            .fill(u.owner === 2 ? 0x7dff9e : (u.owner === viewer ? 0xffd98a : 0xff8a96));
        }
      }
    }
    for (const [id, p] of unitPool) if (!live.has(id)) { p.c.destroy({ children: true }); unitPool.delete(id); }
    stage.unit.sortableChildren = true;
  }

  let stormG = null;
  function updateStorms(view, viewer) {
    if (!stormG) { stormG = new PIXI.Graphics(); stage.storm.addChild(stormG); }
    stormG.clear();
    for (const st of view.storms || []) {
      const X = dx(st.x, viewer), Y = dy(st.y, viewer), rr = C.POWERS.storm.radius;
      if (st.delay > 0) {
        stormG.circle(X, Y, rr).stroke({ width: 2.5, color: 0xff6a5a, alpha: 0.4 + 0.35 * Math.sin(st.delay * 18) });
      } else {
        stormG.circle(X, Y, rr).fill({ color: 0x1e0a14, alpha: 0.5 });
        for (let i = 0; i < 3; i++) {
          let lx = X + (Math.random() - 0.5) * rr, ly = Y - rr;
          stormG.moveTo(lx, ly);
          for (let s2 = 0; s2 < 4; s2++) { lx += (Math.random() - 0.5) * 30; ly += rr / 2; stormG.lineTo(lx, ly); }
          stormG.stroke({ width: 2 + Math.random() * 2, color: Math.random() < 0.5 ? 0xffdcdc : 0xff5a4a, alpha: 0.5 + Math.random() * 0.5 });
        }
      }
    }
  }

  function updateCities(view, viewer) {
    const own = cityFx.own, foe = cityFx.foe;
    const me = view.players[viewer], en = view.players[1 - viewer];
    /* selection pulse */
    own.sel.clear();
    if (R.selected >= 0) {
      const r = R.slotRect(R.selected);
      own.sel.roundRect(r.x, r.y, r.w, r.h, 10)
        .stroke({ width: 3, color: 0xffe9a8, alpha: 0.55 + 0.4 * Math.sin(T * 5.5) });
    }
    /* own buildings + shrine arc */
    own.deco.clear();
    for (let i = 0; i < C.SLOTS; i++) {
      const s = me.slots[i], sp = own.bSprites[i], r = R.slotRect(i);
      sp.visible = !!s;
      if (!s) continue;
      sp.texture = tex(s.bt === 'wall' ? S.post.rampart : S.b[s.bt]);
      const sz = Math.min(r.w, r.h) * 1.04;
      sp.width = sz; sp.height = sz;
      sp.position.set(r.x + r.w / 2, r.y + r.h / 2);
      for (let lv = 1; lv < s.level; lv++)
        own.deco.circle(r.x + r.w / 2 - 12 + lv * 12, r.y + r.h - 8, 3).fill(0xffe9a8);
      if (s.bt === 'shrine' && me.pattern > 0) {
        own.deco.arc(r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) * 0.52, -Math.PI / 2, -Math.PI / 2 + (me.pattern / 100) * Math.PI * 2)
          .stroke({ width: 3.5, color: 0x9cc8ff });
      }
    }
    drawWallsBars(own, me, viewer, true);
    /* rival mounds + revealed shrine */
    foe.shrineRing.clear();
    for (let i = 0; i < C.SLOTS; i++) {
      const s = en.slots[i], sp = foe.mounds[i];
      sp.visible = !!s;
      if (!s) continue;
      const col = i % 3, row = Math.floor(i / 3);
      const X = foe.cx - 150 + col * 150, Y = foe.cy - 152 - row * 78;
      const revealed = s.bt === 'shrine' && en.revealed;
      sp.texture = tex(revealed ? S.b.shrine : S.b.veiled);
      sp.width = sp.height = 62;
      sp.position.set(X, Y);
      if (revealed && en.pattern > 0) {
        foe.shrineRing.arc(X, Y, 36, -Math.PI / 2, -Math.PI / 2 + (en.pattern / 100) * Math.PI * 2)
          .stroke({ width: 3, color: 0x9cc8ff });
      }
    }
    drawWallsBars(foe, en, viewer, false);
  }
  function drawWallsBars(g, pl, viewer, own) {
    g.wall.clear(); g.bars.clear();
    if (pl.wallHp > 0) {
      const start = own ? Math.PI : 0, end = own ? 2 * Math.PI : Math.PI;
      g.wall.arc(g.cx, g.cy + (own ? 10 : -10), 104, start, end)
        .stroke({ width: 8, color: own ? 0xdcbe82 : 0xdc8c96, alpha: 0.85 });
    }
    const hpw = 160, hx = g.cx - hpw / 2, hy = own ? g.cy + 74 : g.cy - 82;
    g.bars.rect(hx - 1, hy - 1, hpw + 2, 8).fill({ color: 0x000000, alpha: 0.75 });
    g.bars.rect(hx, hy, hpw * Math.max(0, pl.castleHp / C.CASTLE_HP), 6).fill(own ? 0xffd98a : 0xff8a96);
  }

  function updateFx(dt) {
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      f.ttl -= dt;
      if (f.ttl <= 0) { if (f.obj) f.obj.destroy(); fx.splice(i, 1); continue; }
      const a = f.ttl / f.max;
      if (!f.obj) continue;
      if (f.k === 'rift') f.obj.alpha = Math.min(1, f.ttl / 1.2);
      else if (f.k === 'ring') {
        f.obj.clear();
        f.obj.circle(f.x, f.y, (1 - a) * f.big + 8).stroke({ width: 3, color: f.color, alpha: a });
      } else if (f.k === 'puff') {
        f.obj.width = f.obj.height = 10 + (1 - a) * 46;
        f.obj.alpha = a * 0.8;
      } else f.obj.alpha = a;
    }
  }

  /* ---------------- fog of war: soft erase-blend holes ---------------- */
  function updateFog(view, viewer) {
    if (!fogRT) {
      fogRT = PIXI.RenderTexture.create({ width: W, height: H, resolution: 1 });
      fogScene = new PIXI.Container();
      const black = new PIXI.Sprite(PIXI.Texture.WHITE);
      black.tint = 0x06040c; black.alpha = 0.62;
      fogScene.addChild(black);
      fogScene._black = black; fogScene._holes = [];
      stage.fog.texture = fogRT;
    }
    fogScene._black.width = W; fogScene._black.height = H;
    const need = view.visSources.length;
    while (fogScene._holes.length < need) {
      const hs = new PIXI.Sprite(holeTex);
      hs.anchor.set(0.5); hs.blendMode = 'erase';
      fogScene.addChild(hs); fogScene._holes.push(hs);
    }
    for (let i = 0; i < fogScene._holes.length; i++) {
      const hs = fogScene._holes[i];
      if (i >= need) { hs.visible = false; continue; }
      const [x, y, r] = view.visSources[i];
      const X = dx(x, viewer) * scale, Y = (dy(y, viewer) - R.camY) * scale, rr = r * scale;
      hs.visible = !(Y < -rr || Y > H + rr);
      hs.position.set(X, Y);
      hs.width = hs.height = rr * 2;
    }
    app.renderer.render({ container: fogScene, target: fogRT, clear: true });
  }

  /* ---------------- minimap + targeting (screen space) ---------------- */
  function updateMinimap(view, viewer) {
    const g = stage.mini;
    g.clear();
    const mw = 26, mx = W - mw - 4, mh = Math.min(H * 0.6, 380), my = (H - mh) / 2;
    g.roundRect(mx, my, mw, mh, 6).fill({ color: 0x0a0812, alpha: 0.72 }).stroke({ width: 1, color: 0xc8a44f, alpha: 0.4 });
    const px = (x) => mx + (x / C.MAP.W) * mw, py = (y) => my + (y / C.MAP.H) * mh;
    for (const s of view.map.sites) {
      const st = view.sites[s.id];
      const X = px(dx(s.x, viewer)), Y = py(dy(s.y, viewer));
      if (s.kind === 'city') {
        const pi2 = view.map.cities.indexOf(s.id);
        g.rect(X - 3, Y - 3, 6, 6).fill(pi2 === viewer ? 0xffd98a : 0xff8a96);
      } else {
        const col = !st ? 0x3a3444 : (st.owner === -1 || st.owner == null ? 0x8a8098 : (st.owner === viewer ? 0xffd98a : 0xff8a96));
        g.circle(X, Y, st && st.post ? 2.6 : 1.6).fill(col);
      }
    }
    for (const f of fx) if (f.ping) {
      g.circle(px(f.x), py(f.y), 5 + (1 - f.ttl / f.max) * 5)
        .stroke({ width: 1.5, color: f.ping, alpha: f.ttl / f.max });
    }
    const vy = my + (R.camY / C.MAP.H) * mh, vh = (viewH / C.MAP.H) * mh;
    g.rect(mx + 1.5, vy, mw - 3, vh).stroke({ width: 1.5, color: 0xffe9a8 });
  }
  function updateTargeting() {
    const g = stage.target;
    g.clear();
    if (!R.targeting) return;
    g.rect(0, 0, W, H).fill({ color: 0xff5a4a, alpha: 0.05 });
    if (R.pointer) g.circle(R.pointer.x, R.pointer.y, C.POWERS.storm.radius * scale)
      .stroke({ width: 1.5, color: 0xff6a5a, alpha: 0.8 });
  }

  global.Render = R;
})(typeof window !== 'undefined' ? window : globalThis);

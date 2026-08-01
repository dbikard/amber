/* render.js — the PixiJS (WebGL) renderer, isolated (v0.3 "The Painted World").
 * Same public surface as the Canvas2D renderer it replaces: game logic never changed.
 * Scene: baked painterly terrain (biomes, forests, corruption, cliffs, cobbled paths),
 * retained sprite pools, additive-blend glows, soft fog-of-war via erase-blend holes.
 * The viewer's own city is ALWAYS at the bottom (viewer 1 sees the world rotated 180°). */
(function (global) {
  'use strict';

  const C = global.CONST, S = global.SPRITES;
  const R = { targeting: false, selected: -1, pointer: null, camX: 0, camY: 0, ready: false };
  let app = null, W = 0, H = 0, scale = 1, viewW = 0, viewH = 0;
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
    /* the map is wider than one screenful now: this is a zoom, not a fit-to-width */
    scale = W / C.VIEW_W;
    viewW = W / scale; viewH = H / scale;
    R.camX = R.maxCamX() / 2;              // start centred on the road
    R.camY = R.maxCamY();                  // …and at your own gates
    if (fogRT) { fogRT.destroy(true); fogRT = null; }
    makeVignette();
  };
  R.maxCamX = () => Math.max(0, C.MAP.W - viewW);
  R.maxCamY = () => Math.max(0, C.MAP.H - viewH);

  /* display space = world rotated 180° for viewer 1 */
  const dx = (x, viewer) => (viewer === 0 ? x : C.MAP.W - x);
  const dy = (y, viewer) => (viewer === 0 ? y : C.MAP.H - y);
  R.toWorld = function (px, py, viewer) {
    const wx = px / scale + R.camX, wy = py / scale + R.camY;
    return { x: dx(wx, viewer), y: dy(wy, viewer) };
  };
  R.pan = function (dpx, dpy) {
    R.camX = Math.max(0, Math.min(R.maxCamX(), R.camX - (dpx || 0) / scale));
    R.camY = Math.max(0, Math.min(R.maxCamY(), R.camY - (dpy || 0) / scale));
  };

  /* ---------------- hit-testing (ring city) ---------------- */
  R.bldRect = function (b) {   // display-space box of a placed work
    const x = dx(b.x, curViewer), y = dy(b.y, curViewer);
    return { x: x - 26, y: y - 26, w: 52, h: 52 };
  };
  /* the id of the viewer's own work under the finger, or -1 */
  R.hitBuilding = function (px, py) {
    if (!curView) return -1;
    const wx = px / scale + R.camX, wy = py / scale + R.camY;
    let best = -1, bd = 34 * 34;
    for (const b of curView.players[curViewer].buildings) {
      const dd = (wx - dx(b.x, curViewer)) ** 2 + (wy - dy(b.y, curViewer)) ** 2;
      if (dd < bd) { bd = dd; best = b.id; }
    }
    return best;
  };
  R.hitSite = function (px, py, view, viewer, forFlag) {
    let best = -1, bd = Infinity;
    for (const s of view.map.sites) {
      const r2 = (s.kind === 'city' ? (forFlag ? C.CITY.r + 20 : 122) : 62) * scale;   // sheets stop at the wall; flags take the whole court
      const X = (dx(s.x, viewer) - R.camX) * scale, Y = (dy(s.y, viewer) - R.camY) * scale;
      const dd = (px - X) * (px - X) + (py - Y) * (py - Y);
      if (dd < r2 * r2 && dd < bd) { bd = dd; best = s.id; }
    }
    return best;
  };
  /* the minimap is a true rectangle of the world, and scrubbing it moves both axes */
  const MINI = () => {
    const mh = Math.min(H * 0.30, 240), mw = mh * (C.MAP.W / C.MAP.H);
    return { mw, mh, mx: W - mw - 6, my: (H - mh) / 2 };
  };
  R.miniBox = MINI;
  R.hitMinimap = (px, py) => {
    const m = MINI();
    return px >= m.mx - 4 && px <= m.mx + m.mw + 4 && py >= m.my - 4 && py <= m.my + m.mh + 4;
  };
  R.minimapJump = function (px, py) {
    const m = MINI();
    R.camX = Math.max(0, Math.min(R.maxCamX(), ((px - m.mx) / m.mw) * C.MAP.W - viewW / 2));
    R.camY = Math.max(0, Math.min(R.maxCamY(), ((py - m.my) / m.mh) * C.MAP.H - viewH / 2));
  };

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

  /* terrain bake lives in js/terrain.js (shared with the 3D renderer) */
  const bakeTerrain = (view, viewer) => global.Terrain.bake(view, viewer, {}).canvas;

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
      if (s.kind !== 'node') continue;
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
    g.claim = new PIXI.Graphics(); stage.city.addChild(g.claim);
    g.sel = new PIXI.Graphics(); stage.city.addChild(g.sel);
    g.pool = new Map();   // building id -> sprite, pooled across frames
    g.layer = new PIXI.Container(); stage.city.addChild(g.layer);
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
        const tx = dx(ev.to.x, viewer), ty = dy(ev.to.y, viewer);
        /* the ballista throws a heavier line; the cannon bursts where it lands */
        lineFx(ex, ey, tx, ty, 0xe8d8a8, ev.br === 'bolt' ? 2.6 : 1.5, 0.22);
        if (ev.splash > 0) ringFx(tx, ty, 0xffb070, 0.32, ev.splash * 0.9);
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
        if (ev.pi === viewer) ringFx(ex, ey, 0xffe9a8, 0.6, 34);
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
    stage.world.position.set(-R.camX * scale, -R.camY * scale);

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
    /* company pennants */
    const PENNANT = [0xe8ecff, 0x64d8d8, 0xc48eff, 0xff9ad8, 0x9adcff, 0xffc27a, 0xb0e8a0, 0xd8b0ff];
    let coG = stage.banner._coG;
    if (!coG || !coG.parent) { coG = new PIXI.Graphics(); stage.banner.addChild(coG); stage.banner._coG = coG; }
    coG.clear();
    const me = view.players[viewer];
    me.buildings.forEach((s2, i) => {
      if (s2.rally == null || s2.rally < 0) return;
      const site = view.map.sites[s2.rally];
      const a = (i / Math.max(1, me.buildings.length)) * Math.PI * 2;
      const X = dx(site.x, viewer) + Math.cos(a) * 32, Y = dy(site.y, viewer) + Math.sin(a) * 32;
      coG.moveTo(X, Y).lineTo(X, Y - 26).stroke({ width: 2, color: 0xd8c8a8 });
      coG.poly([X, Y - 26, X + 14, Y - 21, X, Y - 16]).fill(PENNANT[i % PENNANT.length]);
    });
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
    /* the writ: the ground you may raise a work on */
    own.claim.clear();
    if (R.placing) {
      own.claim.circle(own.cx, own.cy, C.CLAIM.seat).fill({ color: 0xffd98a, alpha: 0.05 });
      for (const b of me.buildings)
        if (C.BUILDINGS[b.bt] && C.BUILDINGS[b.bt].claim)
          own.claim.circle(dx(b.x, viewer), dy(b.y, viewer), C.CLAIM.gate).fill({ color: 0xffd98a, alpha: 0.05 });
    }
    /* every work of both sides, drawn where it actually stands */
    own.deco.clear();
    own.sel.clear();
    foe.shrineRing.clear();
    const live = new Set();
    const drawWork = (g, b, mine, ghost) => {
      live.add(b.id);
      let sp = g.pool.get(b.id);
      if (!sp) { sp = new PIXI.Sprite(); sp.anchor.set(0.5); g.layer.addChild(sp); g.pool.set(b.id, sp); }
      const X = dx(b.x, curViewer), Y = dy(b.y, curViewer);
      sp.visible = true;
      sp.texture = tex(S.b[b.bt] || S.b.gate);
      sp.width = sp.height = 54;
      sp.position.set(X, Y);
      sp.alpha = ghost ? 0.38 : 1;
      /* the 2D fallback has one tower sprite — the branch reads as its metal */
      sp.tint = mine ? (b.bt === 'tower' && b.br ? (b.br === 'cannon' ? 0xffb090 : 0xbcd8ff) : 0xffffff) : 0xd08a94;
      if (mine) {
        for (let lv = 1; lv < b.level; lv++) own.deco.circle(X - 12 + lv * 12, Y + 24, 3).fill(0xffe9a8);
        if (b.id === R.selected)
          own.sel.circle(X, Y, 30).stroke({ width: 3, color: 0xffe9a8, alpha: 0.55 + 0.4 * Math.sin(T * 5.5) });
        if (b.bt === 'shrine' && me.pattern > 0)
          own.deco.arc(X, Y, 30, -Math.PI / 2, -Math.PI / 2 + (me.pattern / 100) * Math.PI * 2)
            .stroke({ width: 3.5, color: 0x9cc8ff });
      } else if (b.bt === 'shrine' && en.revealed && en.pattern > 0) {
        foe.shrineRing.arc(X, Y, 30, -Math.PI / 2, -Math.PI / 2 + (en.pattern / 100) * Math.PI * 2)
          .stroke({ width: 3, color: 0x9cc8ff });
      }
    };
    for (const b of me.buildings) drawWork(own, b, true, false);
    for (const b of en.buildings) drawWork(own, b, false, false);
    for (const gh of (en.ghosts || [])) if (!live.has(gh.id)) drawWork(own, gh, false, true);
    for (const [id, sp] of own.pool) if (!live.has(id)) { sp.destroy(); own.pool.delete(id); }
    drawWallsBars(own, me, viewer, true);
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
      const X = (dx(x, viewer) - R.camX) * scale, Y = (dy(y, viewer) - R.camY) * scale, rr = r * scale;
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
    const m = R.miniBox(), mw = m.mw, mh = m.mh, mx = m.mx, my = m.my;
    g.roundRect(mx, my, mw, mh, 6).fill({ color: 0x0a0812, alpha: 0.72 }).stroke({ width: 1, color: 0xc8a44f, alpha: 0.4 });
    const px = (x) => mx + (x / C.MAP.W) * mw, py = (y) => my + (y / C.MAP.H) * mh;
    for (const s of view.map.sites) {
      const st = view.sites[s.id];
      const X = px(dx(s.x, viewer)), Y = py(dy(s.y, viewer));
      if (s.kind === 'city') {
        const pi2 = view.map.cities.indexOf(s.id);
        g.rect(X - 3, Y - 3, 6, 6).fill(pi2 === viewer ? 0xffd98a : 0xff8a96);
      } else {
        const col = !st ? 0x3a3444 : (st.holder == null || st.holder === -1 ? 0x8a8098 : (st.holder === viewer ? 0xffd98a : 0xff8a96));
        g.circle(X, Y, st && st.holder >= 0 ? 2.6 : 1.6).fill(col);
      }
    }
    for (const f of fx) if (f.ping) {
      g.circle(px(f.x), py(f.y), 5 + (1 - f.ttl / f.max) * 5)
        .stroke({ width: 1.5, color: f.ping, alpha: f.ttl / f.max });
    }
    const vx = mx + (R.camX / C.MAP.W) * mw, vw2 = (viewW / C.MAP.W) * mw;
    const vy = my + (R.camY / C.MAP.H) * mh, vh = (viewH / C.MAP.H) * mh;
    g.rect(vx, vy, vw2, vh).stroke({ width: 1.5, color: 0xffe9a8 });
  }
  function updateTargeting() {
    const g = stage.target;
    g.clear();
    if (!R.targeting) return;
    g.rect(0, 0, W, H).fill({ color: 0xff5a4a, alpha: 0.05 });
    if (R.pointer) g.circle(R.pointer.x, R.pointer.y, C.POWERS.storm.radius * scale)
      .stroke({ width: 1.5, color: 0xff6a5a, alpha: 0.8 });
  }

  global.Render2D = R;   // render_select.js picks 2D vs 3D
})(typeof window !== 'undefined' ? window : globalThis);

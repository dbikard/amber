/* render3d.js — the Three.js renderer (v0.4 "The Raised World"): an AoE2/DOTA-style
 * pitched-perspective 3D battlefield. Same public surface as Render2D — game logic,
 * AI, sim and netcode never change. The painterly terrain bake (js/terrain.js) drapes
 * over a rolling ground mesh; buildings and units are procedural low-poly models
 * (merged geometry, instanced units — phone-friendly draw calls). The guest doesn't
 * mirror the world: their camera simply stands on the other side of the table.
 * HP bars / nameplates / minimap / targeting live on a 2D overlay canvas. */
(function (global) {
  'use strict';

  const C = global.CONST;
  const R = { targeting: false, selected: -1, pointer: null, camX: 0, camY: 0, zoom: 1, ready: false };
  let renderer = null, scene, cam, rig, worldG;
  let overlay = null, octx = null;
  let W = 0, H = 0, scale = 1, viewW = 0, viewH = 0;
  let curViewer = 0, curView = null, lastKey = '', T = 0;
  let ground = null;
  let groundGrid = null, gridW = 0, gridH = 0;
  const GRES = 10;
  function groundH(x, z) {
    if (!groundGrid) return 0;
    const fx = Math.max(0, Math.min(gridW - 1.001, x / GRES)), fz = Math.max(0, Math.min(gridH - 1.001, z / GRES));
    const x0 = fx | 0, z0 = fz | 0, tx = fx - x0, tz = fz - z0;
    const i = z0 * gridW + x0;
    const a = groundGrid[i] * (1 - tx) + groundGrid[i + 1] * tx;
    const b = groundGrid[i + gridW] * (1 - tx) + groundGrid[i + gridW + 1] * tx;
    return a * (1 - tz) + b * tz;
  }
  R.groundH = (x, z) => groundH(x, z);
  let unitIM = {}, shadowIM = null, unitFace = new Map();
  let siteObjs = new Map(), cityObjs = null, bannerG = null, stormState = [];
  const PENNANT = [0xe8ecff, 0x64d8d8, 0xc48eff, 0xff9ad8, 0x9adcff, 0xffc27a, 0xb0e8a0, 0xd8b0ff];
  let coFlags = new Map();
  let fx = [];
  const dummy = () => new THREE.Object3D();
  const dum = typeof THREE !== 'undefined' ? new THREE.Object3D() : null;
  const colTmp = typeof THREE !== 'undefined' ? new THREE.Color() : null;
  /* no world flip: the map is asymmetric now, so both players read the same ground and
   * simply start their camera over their own Seat */
  const dx = (x) => x;
  const dy = (y) => y;

  /* ---------------- low-poly model kit: merged geometry with vertex colors ---------------- */
  function colorize(geo, hex) {
    const c2 = new THREE.Color(hex);
    const n = geo.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c2.r; arr[i * 3 + 1] = c2.g; arr[i * 3 + 2] = c2.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geo;
  }
  function part(geo, hex, x, y, z, ry) {
    geo = geo.toNonIndexed();
    if (ry) geo.rotateY(ry);
    geo.translate(x, y, z);
    return colorize(geo, hex);
  }
  function merge(parts) {
    let total = 0;
    for (const g of parts) total += g.attributes.position.count;
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
    let o = 0;
    for (const g of parts) {
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      col.set(g.attributes.color.array, o * 3);
      o += g.attributes.position.count;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
  }
  let MAT = null, MATB = null;
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (rt, rb, h, seg) => new THREE.CylinderGeometry(rt, rb, h, seg || 7);
  const cone = (r2, h, seg) => new THREE.ConeGeometry(r2, h, seg || 7);
  const sph = (r2) => new THREE.SphereGeometry(r2, 7, 5);
  function meshOf(parts) { return new THREE.Mesh(merge(parts), MAT); }

  /* models */
  function towerModel(gold) {
    const wall = gold ? 0xb99a4e : 0x9a4a56, light = gold ? 0xe6d391 : 0xd18a94,
      dark = gold ? 0x6e5322 : 0x521c26, roof = gold ? 0x8a6a2a : 0x6e2833;
    const p = [];
    p.push(part(cyl(30, 38, 26, 9), dark, 0, 13, 0));            // plinth
    p.push(part(cyl(22, 27, 96, 9), wall, 0, 74, 0));            // the great shaft
    p.push(part(cyl(26, 22, 10, 9), light, 0, 126, 0));          // corbelled crown
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      p.push(part(box(7, 9, 7), dark, Math.cos(a) * 24, 136, Math.sin(a) * 24));
    }
    p.push(part(cyl(12, 16, 26, 8), wall, 0, 148, 0));           // watch turret
    p.push(part(cone(15, 24, 8), roof, 0, 172, 0));
    for (const a of [0.4, 2.1, 3.8, 5.5])                         // arrow lights
      p.push(part(box(3, 8, 1.6), gold ? 0xffe9a8 : 0xff9aa8, Math.cos(a) * 25.5, 90, Math.sin(a) * 25.5, a));
    p.push(part(box(16, 22, 5), dark, 0, 11, 34));               // the tower gate
    p.push(part(cyl(0.9, 0.9, 26, 5), light, 0, 196, 0));
    p.push(part(box(15, 9, 0.8), gold ? 0xffe9a8 : 0xff9aa8, 8.5, 204, 0));
    return meshOf(p);
  }
  function castleModel(gold) {
    const wall = gold ? 0xb99a4e : 0x9a4a56, light = gold ? 0xe6d391 : 0xd18a94,
      dark = gold ? 0x6e5322 : 0x521c26, roof = gold ? 0x8a6a2a : 0x6e2833;
    const p = [];
    p.push(part(box(120, 44, 74), wall, 0, 22, 0));
    p.push(part(box(126, 8, 80), light, 0, 48, 0));
    p.push(part(box(56, 66, 46), wall, 0, 33, 0));
    p.push(part(box(60, 8, 50), light, 0, 68, 0));
    for (const sx of [-56, 56]) for (const sz of [-32, 32]) {
      p.push(part(cyl(11, 13, 62, 7), wall, sx, 31, sz));
      p.push(part(cone(14, 20, 7), roof, sx, 71, sz));
    }
    p.push(part(cone(16, 24, 7), roof, 0, 84, 0));
    p.push(part(box(20, 26, 6), dark, 0, 13, 38));               // the gate
    p.push(part(cyl(0.9, 0.9, 30, 5), light, 0, 100, 0));        // standard pole
    p.push(part(box(14, 8, 0.8), gold ? 0xffe9a8 : 0xff9aa8, 8, 110, 0));
    return meshOf(p);
  }
  /* key is 'bt' or, for a forked Watchtower, 'tower:bolt' / 'tower:cannon' */
  function buildingModel(key) {
    const cut = key.indexOf(':'), bt = cut < 0 ? key : key.slice(0, cut), br = cut < 0 ? '' : key.slice(cut + 1);
    const st = 0x8d8296, stD = 0x4a4258, stL = 0xcfc6d8, woodR = 0x6e4434;
    const p = [];
    if (bt === 'gate' || bt === 'sgate') {
      p.push(part(cyl(5, 6.5, 34, 6), st, -16, 17, 0));
      p.push(part(cyl(5, 6.5, 34, 6), st, 16, 17, 0));
      p.push(part(box(44, 8, 9), stL, 0, 38, 0));
      if (bt === 'sgate') { p.push(part(cyl(4, 5, 22, 5), stD, -30, 11, 10)); p.push(part(cyl(4, 5, 22, 5), stD, 30, 11, 10)); }
    } else if (bt === 'barracks') {
      p.push(part(box(48, 22, 34), st, 0, 11, 0));
      p.push(part(cyl(0.1, 26, 18, 4), woodR, 0, 31, 0, Math.PI / 4));
      p.push(part(box(10, 14, 2), stD, 0, 7, 17));
      p.push(part(cyl(0.7, 0.7, 26, 5), stL, 20, 30, 12));
      p.push(part(box(10, 6, 0.6), 0xffe9a8, 25, 38, 12));
    } else if (bt === 'tower' || bt === 'watch') {
      p.push(part(cyl(10, 13, 44, 8), st, 0, 22, 0));
      p.push(part(cyl(13, 11, 6, 8), stL, 0, 47, 0));
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2;
        p.push(part(box(4, 5, 4), stD, Math.cos(a) * 11, 53, Math.sin(a) * 11));
      }
      if (br === 'bolt') {
        /* the great crossbow: an open deck, twin arms, a bolt in the groove */
        p.push(part(box(4, 4, 30), woodR, 0, 59, 2));
        p.push(part(box(36, 3, 3.5), woodR, 0, 61, -6));
        p.push(part(box(2, 2, 22), stL, 0, 63, 8));
        p.push(part(box(3, 11, 3), stD, -8, 56, 0));
        p.push(part(box(3, 11, 3), stD, 8, 56, 0));
      } else if (br === 'cannon') {
        /* the gun deck: a dark barrel over the parapet, banded at the muzzle */
        p.push(part(cyl(12, 12, 5, 8), stD, 0, 55, 0));
        p.push(part(cyl(5.5, 5.5, 8, 6), 0x2e2a34, 0, 60, -5));
        p.push(part(box(7, 7, 26), 0x2e2a34, 0, 60, 10));
        p.push(part(box(9, 9, 4), stL, 0, 60, 22));
      } else {
        p.push(part(cone(12, 16, 8), 0x5a4a68, 0, 62, 0));
      }
    } else if (bt === 'spire') {
      p.push(part(cyl(4, 9, 58, 7), 0x6a5a8a, 0, 29, 0));
      p.push(part(sph(5), 0xc48eff, 0, 62, 0));
    } else if (bt === 'shrine') {
      p.push(part(cyl(24, 27, 6, 10), stD, 0, 3, 0));
      p.push(part(cyl(20, 22, 4, 10), st, 0, 8, 0));
    } else if (bt === 'veiled') {
      p.push(part(sph(16), 0x241a2e, 0, 9, 0));
      p.push(part(sph(10), 0x18101f, 10, 6, 6));
    }
    return meshOf(p);
  }
  function unitGeo(kind) {
    const p = [];
    if (kind === 'soldier') {
      p.push(part(cyl(3.2, 4.2, 12, 6), 0xbbbbbb, 0, 8, 0));
      p.push(part(sph(3.4), 0xdddddd, 0, 17, 0));
      p.push(part(cyl(0.7, 0.7, 20, 4), 0xeeeeee, 5, 12, 0));
      p.push(part(cyl(3.4, 3.4, 1.4, 7), 0x999999, -5.4, 10, 0, 0));
    } else if (kind === 'sorcerer') {
      p.push(part(cone(4.6, 15, 6), 0xaaaaaa, 0, 7.5, 0));
      p.push(part(sph(2.9), 0xcccccc, 0, 16, 0));
      p.push(part(cyl(0.7, 0.7, 22, 4), 0xdddddd, 5, 12, 0));
      p.push(part(sph(1.8), 0xffffff, 5, 23.5, 0));
    } else if (kind === 'champion') {
      p.push(part(cyl(4.4, 5.6, 16, 6), 0xcccccc, 0, 10, 0));
      p.push(part(sph(4.2), 0xeeeeee, 0, 21.5, 0));
      p.push(part(box(1.6, 16, 4), 0xffffff, 6.5, 14, 0));
      p.push(part(box(2, 4, 2), 0xff8888, 0, 27, 0));
    } else {   // fiend
      p.push(part(sph(5.5), 0x8899aa, 0, 6, 0));
      p.push(part(sph(3.4), 0x99aabb, 4.5, 10, 0));
      p.push(part(cone(1.6, 5, 4), 0x667788, -2, 12, 0));
      p.push(part(cone(1.4, 4.5, 4), 0x667788, 2, 12.5, 2));
    }
    return merge(p);
  }
  function treeGeo(pal) {
    const p = [];
    p.push(part(cyl(1.6, 2.4, 10, 5), 0x3a2c1a, 0, 5, 0));
    p.push(part(cone(10, 16, 6), pal[0], 0, 16, 0));
    p.push(part(cone(8, 13, 6), pal[1], 0, 25, 0));
    p.push(part(cone(5.5, 10, 6), pal[2], 0, 33, 0));
    return merge(p);
  }

  /* a crag: stacked, canted slabs — cheap, and unmistakably not walkable */
  function rockGeo() {
    const p = [];
    p.push(part(cyl(11, 14, 9, 5), 0x453d4e, 0, 4.5, 0));
    p.push(part(cyl(7.5, 10, 11, 5), 0x39323f, 1.5, 14, -1, 0.7));
    p.push(part(cone(6.5, 12, 5), 0x4e4657, -1, 24, 1.5));
    return merge(p);
  }

  /* Place the camera on its rig and pitch it at the rig's own origin.
   * NOT cam.lookAt(0,0,0): the camera is a CHILD of the rig, so that aims it at the world's
   * origin corner instead of at what the rig is over — which skewed the whole view and grew
   * worse with every zoom step, because applyZoom re-aimed it each time. Setting the pitch
   * directly has no parent-space ambiguity to get wrong. */
  function aimCam(vw) {
    const h = vw * C.VIEW.camHigh, d = vw * C.VIEW.camBack;
    cam.position.set(0, h, d);
    cam.rotation.set(-Math.atan2(h, d), 0, 0);
    cam.updateMatrixWorld(true);
  }

  /* ---------------- boot / resize / camera ---------------- */
  R.init = async function (canvas) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d0b16);
    scene.fog = new THREE.Fog(0x120d1a, 1150, 2600);
    scene.add(new THREE.HemisphereLight(0xa8a2d8, 0x5a4830, 1.5));
    const sun = new THREE.DirectionalLight(0xffe8c0, 1.75);
    sun.position.set(-420, 760, 380);
    scene.add(sun);
    /* far plane has to clear the whole board from the furthest zoom, or the world clips
     * to black at the edges when you pull out */
    cam = new THREE.PerspectiveCamera(55, 1, 10, 9000);
    rig = new THREE.Group();
    aimCam(C.VIEW_W);
    rig.add(cam);
    scene.add(rig);
    worldG = new THREE.Group();
    scene.add(worldG);
    const under = new THREE.Mesh(new THREE.PlaneGeometry(6000, 9000).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x0b0912 }));
    under.position.set(C.MAP.W / 2, -5, C.MAP.H / 2);
    scene.add(under);
    MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
    MATB = new THREE.MeshBasicMaterial({ vertexColors: true });
    overlay = document.getElementById('overlay');
    octx = overlay.getContext('2d');
    stormState = [0, 1].map(() => {
      const l = new THREE.PointLight(0xff6a5a, 0, 420);
      scene.add(l);
      return { light: l };
    });
    R.resize();
    R.ready = true;
  };

  R.resize = function () {
    if (!renderer) return;
    W = window.innerWidth; H = window.innerHeight;
    renderer.setSize(W, H);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    overlay.width = W * dpr; overlay.height = H * dpr;
    overlay.style.width = W + 'px'; overlay.style.height = H + 'px';
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cam.aspect = W / H;
    cam.updateProjectionMatrix();
    R.applyZoom();
    if (!R._homed) { R.camX = R.maxCamX() / 2; R.camY = R.maxCamY() / 2; }
  };
  /* zoom moves the camera in and out; the rig keeps the same pitch, so the view simply gets
   * closer to the ground rather than changing character */
  R.applyZoom = function () {
    R.zoom = Math.max(C.VIEW.min, Math.min(C.VIEW.max, R.zoom || 1));
    scale = W * R.zoom / C.VIEW_W;
    viewW = W / scale; viewH = H / scale;
    if (cam) aimCam(viewW);
    R.clampCam();
  };
  R.setZoom = function (z) { R.zoom = z; R.applyZoom(); };
  /* the camera may run PAST the world's edge by a margin, so a corner Seat can still be
   * brought to the middle of the screen instead of being stranded small at the top */
  const margX = () => viewW * C.VIEW.overscroll, margY = () => viewH * C.VIEW.overscroll;
  R.clampCam = function () {
    R.camX = Math.max(-margX(), Math.min(R.maxCamX() + margX(), R.camX));
    R.camY = Math.max(-margY(), Math.min(R.maxCamY() + margY(), R.camY));
    syncRig();
  };
  /* Move the rig the moment the camera moves. It used to be set only inside frame(), so a
   * lookAt followed by a project or a toWorld read a camera that was still one frame behind
   * — which is exactly the window a tap lands in. */
  function syncRig() {
    if (!rig || !cam) return;
    rig.position.set(R.camX + viewW / 2, 0, R.camY + viewH * 0.62);
    rig.rotation.y = 0;
    rig.updateMatrixWorld(true);
    cam.updateMatrixWorld(true);
  }
  R.lookAt = function (wx, wy) {
    /* the rig origin IS what the camera centres on, and the rig sits at camY + 0.62*viewH */
    R._homed = true;
    R.camX = wx - viewW / 2;
    R.camY = wy - viewH * 0.62;
    R.clampCam();
    /* ...but the rig origin sits on the y=0 PLANE, and what you actually SEE at the middle
     * of the screen is the GROUND, which stands above it. The centre ray therefore meets the
     * land short of the rig origin — a constant world-space offset that costs a fixed number
     * of world units at every zoom, so it grows to hundreds of pixels as you zoom in and the
     * Seat you asked for drifts off the middle. Correct against the real ground point; two
     * passes converge because the error shrinks by the ground's slope each time. */
    for (let i = 0; i < 2; i++) {
      const c = R.toWorld(W / 2, H / 2);
      if (!c) break;
      R.camX += wx - c.x; R.camY += wy - c.y;
      R.clampCam();
    }
  };
  R.maxCamX = () => Math.max(0, C.MAP.W - viewW);
  R.maxCamY = () => Math.max(0, C.MAP.H - viewH);
  R.pan = function (dpx, dpy) {
    R.camX -= (dpx || 0) / scale;
    R.camY -= (dpy || 0) / scale;
    R.clampCam();
  };
  /* the minimap is a true rectangle of the world, and scrubbing it moves both axes */
  /* A corner map, and a SMALL one. Sized off the map's aspect it grew to half the screen
   * width on a squarer world and started swallowing taps meant for the ground under it. */
  const MINI = () => {
    const mw = Math.min(W * 0.26, 120), mh = Math.min(H * 0.30, mw * (C.MAP.H / C.MAP.W));
    return { mw, mh, mx: W - mw - 6, my: 62 };
  };
  R.miniBox = MINI;
  /* What is ACTUALLY on screen, in world units. Under perspective the visible ground is a
   * trapezoid, and the old minimap box drew camX..camX+viewW — which is neither where the
   * camera is looking nor how much it sees, and the mismatch grew with every zoom step.
   * Sample the screen and take the bounding box of what really lands on the ground. */
  R.viewRect = function () {
    /* Sampled densely, because near the horizon the screen-to-ground mapping is violently
     * nonlinear and a coarse grid bounds nothing. Every sample is clamped to the world
     * first: the top of the screen genuinely sees thousands of units past the rim, and a
     * viewfinder should say WHICH PART OF THE WORLD is on screen, not how much void is. */
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, hits = 0;
    const N = 8;
    for (let iy = 0; iy <= N; iy++) {
      for (let ix = 0; ix <= N; ix++) {
        const w2 = R.toWorld((ix / N) * W, (iy / N) * H);
        if (!w2 || !isFinite(w2.x) || !isFinite(w2.y)) continue;
        const cx = Math.max(0, Math.min(C.MAP.W, w2.x)), cy = Math.max(0, Math.min(C.MAP.H, w2.y));
        hits++;
        if (cx < x0) x0 = cx;
        if (cy < y0) y0 = cy;
        if (cx > x1) x1 = cx;
        if (cy > y1) y1 = cy;
      }
    }
    if (hits < 4) { x0 = R.camX; y0 = R.camY; x1 = R.camX + viewW; y1 = R.camY + viewH; }
    return { x0: Math.max(0, x0), y0: Math.max(0, y0),
             x1: Math.min(C.MAP.W, x1), y1: Math.min(C.MAP.H, y1) };
  };
  R.hitMinimap = (px, py) => {
    const m = MINI();
    return px >= m.mx - 4 && px <= m.mx + m.mw + 4 && py >= m.my - 4 && py <= m.my + m.mh + 4;
  };
  R.minimapJump = function (px, py) {
    const m = MINI();
    R.camX = ((px - m.mx) / m.mw) * C.MAP.W - viewW / 2;
    R.camY = ((py - m.my) / m.mh) * C.MAP.H - viewH * 0.62;
    R.clampCam();
  };

  /* screen ↔ world via raycast to the ground plane */
  const rc = typeof THREE !== 'undefined' ? new THREE.Raycaster() : null;
  const ndc = typeof THREE !== 'undefined' ? new THREE.Vector2() : null;
  const groundPlane = typeof THREE !== 'undefined' ? new THREE.Plane(new THREE.Vector3(0, 1, 0), 0) : null;
  const hitV = typeof THREE !== 'undefined' ? new THREE.Vector3() : null;
  /* Raycast against the GROUND, not against y=0. The world has real relief now, and a ray
   * stopped at sea level lands well past the hill the finger was actually on — near a Seat,
   * far enough that a tap aimed at the courtyard came back as a tap on the tower. Three
   * iterations converge: guess a height, see what is really there, try again. */
  R.toWorld = function (px, py) {
    ndc.set((px / W) * 2 - 1, -(py / H) * 2 + 1);
    rc.setFromCamera(ndc, cam);
    let h = 0;
    for (let i = 0; i < 3; i++) {
      groundPlane.constant = -h;
      if (!rc.ray.intersectPlane(groundPlane, hitV)) break;
      const nh = groundH(hitV.x, hitV.z);
      if (Math.abs(nh - h) < 0.5) { h = nh; break; }
      h = nh;
    }
    groundPlane.constant = -h;
    if (rc.ray.intersectPlane(groundPlane, hitV)) return { x: hitV.x, y: hitV.z };
    groundPlane.constant = 0;
    return { x: C.MAP.W / 2, y: C.MAP.H / 2 };
  };
  /* the id of the viewer's own work under the finger, or -1 */
  R.hitBuilding = function (px, py) {
    if (!curView) return -1;
    const w2 = R.toWorld(px, py);
    let best = -1, bd = 38 * 38;
    for (const b of curView.players[curViewer].buildings) {
      const dd = (w2.x - b.x) * (w2.x - b.x) + (w2.y - b.y) * (w2.y - b.y);
      if (dd < bd) { bd = dd; best = b.id; }
    }
    return best;
  };
  R.hitSite = function (px, py, view, viewer, forFlag) {
    const w2 = R.toWorld(px, py);
    let best = -1, bd = Infinity;
    for (const s of view.map.sites) {
      /* a sheet-tap on a Seat covers only the tower's own ground; a FLAG takes the whole court */
      const r2 = s.kind === 'city' ? (forFlag ? C.CITY.r + 20 : C.CITY.seatR) : 62;
      const dd = (w2.x - s.x) * (w2.x - s.x) + (w2.y - s.y) * (w2.y - s.y);
      if (dd < r2 * r2 && dd < bd) { bd = dd; best = s.id; }
    }
    return best;
  };
  const pv = typeof THREE !== 'undefined' ? new THREE.Vector3() : null;
  function proj(x, y, z) {
    pv.set(x, y, z).project(cam);
    return { x: (pv.x * 0.5 + 0.5) * W, y: (-pv.y * 0.5 + 0.5) * H, ok: pv.z < 1 && pv.z > -1 };
  }
  /* world (ground) → screen: the inverse of toWorld, same 2-arg shape in both renderers */
  R.project = (x, y) => proj(x, groundH(x, y) + 2, y);

  /* ---------------- world (re)build ---------------- */
  const mapKey = (view, viewer) => (view.mapSeed || 0) + ':' + viewer;
  function buildWorld(view, viewer) {
    while (worldG.children.length) {
      const c2 = worldG.children.pop();
      c2.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      worldG.remove(c2);
    }
    siteObjs.clear(); unitIM = {}; unitFace.clear(); coFlags.clear();
    writG = null; writKey = '';
    for (const f of fx) if (f.obj) f.obj.removeFromParent();
    fx = [];

    const bake = global.Terrain.bake(view, viewer, { props: false, labels: false });
    /* REAL relief: the ground mesh is the sim's own elevation field, so a hill you see is a
     * hill units pay to climb and a crag you see is one they cannot cross at all. */
    const nav = view.nav;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < nav.elev.length; i++) {
      const e = nav.elev[i];
      if (e < lo) lo = e;
      if (e > hi) hi = e;
    }
    const span = Math.max(1e-6, hi - lo);
    const relief = C.WORLD.relief;
    /* bilinear sample of the elevation grid, in world units */
    const hFn = (x, z) => {
      const fx = Math.max(0, Math.min(nav.W - 1.001, x / nav.cw - 0.5));
      const fz = Math.max(0, Math.min(nav.H - 1.001, z / nav.cw - 0.5));
      const x0 = fx | 0, z0 = fz | 0, tx = fx - x0, tz = fz - z0;
      const i = z0 * nav.W + x0;
      const a = nav.elev[i] * (1 - tx) + nav.elev[i + 1] * tx;
      const b = nav.elev[i + nav.W] * (1 - tx) + nav.elev[i + nav.W + 1] * tx;
      return ((a * (1 - tz) + b * tz) - lo) / span * relief;
    };
    const seg = [Math.min(180, nav.W), Math.min(180, nav.H)];
    const geo = new THREE.PlaneGeometry(C.MAP.W, C.MAP.H, seg[0], seg[1]);
    geo.rotateX(-Math.PI / 2);
    geo.translate(C.MAP.W / 2, 0, C.MAP.H / 2);
    const pp = geo.attributes.position;
    for (let i = 0; i < pp.count; i++) pp.setY(i, hFn(pp.getX(i), pp.getZ(i)));
    geo.computeVertexNormals();
    /* sample into a grid for cheap per-frame lookups */
    gridW = Math.ceil(C.MAP.W / GRES) + 1; gridH = Math.ceil(C.MAP.H / GRES) + 1;
    groundGrid = new Float32Array(gridW * gridH);
    for (let gz = 0; gz < gridH; gz++)
      for (let gx = 0; gx < gridW; gx++)
        groundGrid[gz * gridW + gx] = hFn(gx * GRES, gz * GRES);
    const tex2 = new THREE.CanvasTexture(bake.canvas);
    tex2.colorSpace = THREE.SRGBColorSpace;
    ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex2 }));
    worldG.add(ground);

    /* forests: 3 instanced palettes (display-space bands → world positions) */
    const pals = { gold: [0x3c4416, 0x5f6626, 0x8f9838], mid: [0x232840, 0x333a5c, 0x4c5680], ash: [0x3c2020, 0x553030, 0x6f4444] };
    const buckets = { gold: [], mid: [], ash: [] };
    for (const [tx, ty, r2, v] of bake.trees) {
      const b = v > 0.62 ? 'gold' : v > 0.3 ? 'mid' : 'ash';
      buckets[b].push([tx, ty, r2, v]);
    }
    for (const k of Object.keys(buckets)) {
      const list = buckets[k];
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(treeGeo(pals[k]), MAT, list.length);
      list.forEach(([x, z, r2, v], i) => {
        dum.position.set(x, groundH(x, z) - 0.5, z);
        dum.rotation.set(0, v * Math.PI * 2, 0);
        const s2 = 0.7 + r2 * 0.06;
        dum.scale.set(s2, s2 * (0.9 + v * 0.35), s2);
        dum.updateMatrix();
        im.setMatrixAt(i, dum.matrix);
      });
      worldG.add(im);
    }
    /* crags: the impassable cells, raised so the eye reads the corridor the units path down */
    if (bake.rocks && bake.rocks.length) {
      const rim = new THREE.InstancedMesh(rockGeo(), MAT, bake.rocks.length);
      bake.rocks.forEach(([rx, ry, rr, rv], i) => {
        const x = rx, z = ry;
        dum.position.set(x, groundH(x, z) - 1, z);
        dum.rotation.set(0, rv * Math.PI * 2, 0);
        const s2 = 0.8 + rr * 0.075;
        dum.scale.set(s2, s2 * (0.7 + rv * 0.7), s2);
        dum.updateMatrix();
        rim.setMatrixAt(i, dum.matrix);
      });
      worldG.add(rim);
    }

    /* site props + dynamic holders */
    const ringGeo = new THREE.RingGeometry(36, 41, 24);
    ringGeo.rotateX(-Math.PI / 2);
    for (const s of view.map.sites) {
      if (s.kind === 'city') continue;
      const holder = new THREE.Group();
      holder.position.set(s.x, groundH(s.x, s.y) + 0.5, s.y);
      if (s.kind === 'node') {
        const water = new THREE.Mesh(new THREE.CircleGeometry(26, 18).rotateX(-Math.PI / 2),
          new THREE.MeshLambertMaterial({ color: 0x2c5a7c, emissive: 0x14283c }));
        water.position.y = 0.8; water._water = true;
        holder.add(water);
      } else if (s.kind === 'vantage') {
        holder.add(meshOf([part(sph(12), 0x5a5266, -10, 6, 2), part(sph(9), 0x6a6276, 8, 5, -6), part(sph(6), 0x4a4258, 2, 4, 10)]));
      } else {
        holder.add(meshOf([part(box(8, 30, 8), 0x2c2433, 0, 15, 0), part(box(10, 3, 10), 0x5ad584, 0, 31, 0)]));
      }
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
      ring.position.y = 1.2; ring.visible = false;
      holder.add(ring);
      worldG.add(holder);
      siteObjs.set(s.id, { holder, ring, hash: '' });
    }

    /* cities */
    cityObjs = { own: buildCity(view, viewer, viewer), foe: buildCity(view, viewer, 1 - viewer) };

    /* the war banner */
    bannerG = new THREE.Group();
    const pole = meshOf([part(cyl(0.9, 0.9, 42, 5), 0xd8c8a8, 0, 21, 0)]);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(20, 11).translate(10, 0, 0),
      new THREE.MeshBasicMaterial({ color: 0xd8b04e, side: THREE.DoubleSide }));
    flag.position.set(0, 36, 0);
    bannerG.add(pole, flag); bannerG._flag = flag;
    worldG.add(bannerG);

    lastKey = mapKey(view, viewer);
  }

  function buildCity(view, viewer, pi) {
    const own = pi === viewer;
    const city = view.map.sites[view.map.cities[pi]];
    const g = { cx: city.x, cy: city.y, own, group: new THREE.Group() };
    /* worked ground disc */
    const court = new THREE.Mesh(new THREE.CircleGeometry(C.CITY.r + 14, 30).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: own ? 0x2e2416 : 0x2a161a, transparent: true, opacity: 0.85 }));
    court.position.set(city.x, 0.6, city.y);
    g.group.add(court);
    g.tower = towerModel(own);
    g.tower.position.set(city.x, 0, city.y);
    g.group.add(g.tower);
    /* works are placed things now: their groups are made and destroyed as they rise and fall */
    g.works = new Map();   // building id -> { grp, key, pad }
    worldG.add(g.group);
    return g;
  }
  function curViewerRotOwn() { return 0; }

  /* ---------------- events → fx ---------------- */
  const TINT = { 0: 0xffd98a, 1: 0xff8a96, 2: 0x7dff9e };
  function ringFx(x, z, color, ttl, big, ping) {
    const m = new THREE.Mesh(new THREE.RingGeometry(6, 9, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    m.position.set(x, groundH(x, z) + 2, z);
    worldG.add(m);
    fx.push({ k: 'ring', obj: m, ttl, max: ttl, big: big || 40, x, z, ping });
  }
  function boltFx(x1, z1, x2, z2, color, ttl) {
    const gline = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x1, groundH(x1, z1) + 16, z1), new THREE.Vector3(x2, groundH(x2, z2) + 12, z2)]);
    const m = new THREE.Line(gline, new THREE.LineBasicMaterial({ color, transparent: true }));
    worldG.add(m);
    fx.push({ k: 'bolt', obj: m, ttl, max: ttl, x: x1, z: z1 });
  }

  R.addEvents = function (events, view, viewer) {
    if (!R.ready) return;
    for (const ev of events) {
      if (ev.e === 'shot' && ev.pi === viewer) {
        boltFx(ev.x, ev.y, ev.to.x, ev.to.y, ev.br === 'cannon' ? 0xffcf9a : 0xe8d8a8, 0.22);
        if (ev.splash > 0) ringFx(ev.to.x, ev.to.y, 0xffb070, 0.32, ev.splash * 0.9);   // the burst
      } else if (ev.e === 'wshot') boltFx(ev.x, ev.y, ev.to.x, ev.to.y, 0xe8d8a8, 0.22);
      else if (ev.e === 'bolt') boltFx(ev.from.x, ev.from.y, ev.to.x, ev.to.y, TINT[ev.from.owner], 0.3);
      else if (ev.e === 'die') ringFx(ev.x, ev.y, TINT[ev.owner], 0.5, 20);
      else if (ev.e === 'rift') ringFx(ev.x, ev.y, 0x5ad584, 3.0, 46, 0x7dff9e);
      else if (ev.e === 'siege') ringFx(ev.x, ev.y, 0xffb090, 0.35, 18, ev.pi === viewer ? 0xff5a4a : null);
      /* build/up carry the work's own position now — there is no slot ring to look it up in */
      else if (ev.e === 'build' || ev.e === 'up') {
        if (ev.pi === viewer && ev.x != null) ringFx(ev.x, ev.y, 0xffe9a8, 0.6, 30);
      } else if (ev.e === 'raze') ringFx(ev.x, ev.y, 0xff7a4a, 1.1, 52, ev.pi === viewer ? 0xff5a4a : null);
      else if (ev.e === 'hurtcity') {
        const city = view.map.sites[view.map.cities[ev.pi]];
        if (ev.pi === viewer) ringFx(ev.x != null ? ev.x : city.x, ev.y != null ? ev.y : city.y, 0xff8a5a, 1.0, 40, 0xff8a5a);
      } else if (ev.e === 'walk' || ev.e === 'pattern' || ev.e === 'trump') {
        const city = view.map.sites[view.map.cities[ev.pi]];
        ringFx(city.x, city.y, ev.e === 'trump' ? 0xe8ecff : 0x9cc8ff, 1.3, 90);
      }
    }
  };

  /* ---------------- per-frame ---------------- */
  R.frame = function (view, viewer, dt) {
    if (!R.ready) return;
    T += dt;
    curViewer = viewer; curView = view;
    if (mapKey(view, viewer) !== lastKey) buildWorld(view, viewer);

    /* camera: stand on your side of the table, look down the road.
     * camY ∈ [0, maxCamY] remaps to a focus track anchored so both ends frame a city:
     * camY = max → own city + build grid at the bottom; camY = 0 → the rival's gates. */
    /* the rig simply follows the camera over the world; there is no fixed enemy direction
     * to anchor a focus track to any more */
    syncRig();

    updateUnits(view, viewer, dt);
    updateSites(view, viewer);
    updateCities(view, viewer);
    updateWrit(view, viewer);
    updateBanner(view, viewer);
    updateStorms(view, viewer);
    updateFxs(dt);
    for (const so of siteObjs.values())
      for (const ch of so.holder.children) if (ch._water) ch.material.emissiveIntensity = 0.7 + 0.4 * Math.sin(T * 2 + so.holder.position.z);

    renderer.render(scene, cam);
    overlayPass(view, viewer);
  };

  function updateUnits(view, viewer, dt) {
    const byKind = { soldier: [], sorcerer: [], champion: [], fiend: [] };
    for (const u of view.units) byKind[u.kind].push(u);
    for (const kind of Object.keys(byKind)) {
      let im = unitIM[kind];
      if (!im) {
        im = unitIM[kind] = new THREE.InstancedMesh(unitGeo(kind), MAT, 260);
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        worldG.add(im);
      }
      const list = byKind[kind];
      for (let i = 0; i < list.length; i++) {
        const u = list[i];
        let f = unitFace.get(u.id);
        if (!f) { f = { x: u.x, y: u.y, a: viewer === 0 ? Math.PI : 0 }; unitFace.set(u.id, f); }
        const mvx = u.x - f.x, mvy = u.y - f.y;
        if (mvx * mvx + mvy * mvy > 0.5) f.a = Math.atan2(mvx, mvy);
        f.x = u.x; f.y = u.y;
        dum.position.set(u.x, groundH(u.x, u.y) + Math.abs(Math.sin(T * 8 + u.id)) * 1.6, u.y);
        dum.rotation.set(0, f.a, 0);
        const s2 = u.kind === 'champion' ? 1.25 : 1;
        dum.scale.set(s2, s2, s2);
        dum.updateMatrix();
        im.setMatrixAt(i, dum.matrix);
        im.setColorAt(i, colTmp.setHex(TINT[u.owner === 2 ? 2 : (u.owner === viewer ? 0 : 1)]));
      }
      im.count = list.length;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    for (const id of unitFace.keys()) if (!view.units.some((u) => u.id === id)) unitFace.delete(id);
  }

  function updateSites(view, viewer) {
    for (const s of view.map.sites) {
      const so = siteObjs.get(s.id);
      if (!so) continue;
      const st = view.sites[s.id];
      const hash = st ? [st.holder, st.live].join('|') : 'x';
      if (hash !== so.hash) {
        so.hash = hash;
        so.ring.visible = !!(st && st.holder != null && st.holder >= 0);
        if (so.ring.visible) {
          so.ring.material.color.setHex(st.holder === viewer ? 0xffd98a : 0xff8a96);
          so.ring.material.opacity = st.live ? 0.65 : 0.3;
        }
        /* nothing is built ON a site any more — a Gate is a work standing near one, and the
         * city group draws it. Only the ownership ring belongs to the site itself. */
      }
    }
  }

  function updateCities(view, viewer) {
    for (const g of [cityObjs.own, cityObjs.foe]) {
      const pi = g.own ? viewer : 1 - viewer;
      const pl = view.players[pi];
      /* the rival's court stays out of the world until somebody has seen it */
      if (!g.own) { g.group.visible = view.foeSeen !== false; if (!g.group.visible) continue; }
      /* works stand where they were placed. A rival's work you can no longer see is a
       * ghost — drawn faint, at the place you last saw it. */
      const want = new Map();
      for (const b of pl.buildings) want.set(b.id, { b, ghost: false });
      if (!g.own) for (const gh of (pl.ghosts || [])) if (!want.has(gh.id)) want.set(gh.id, { b: gh, ghost: true });

      for (const [id, { b, ghost }] of want) {
        const key = (b.bt === 'tower' && b.br ? 'tower:' + b.br : b.bt) + (ghost ? '~' : '');
        let w = g.works.get(id);
        if (!w || w.key !== key) {
          if (w) { w.grp.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); w.grp.removeFromParent(); }
          const grp = new THREE.Group();
          grp.rotation.y = curViewerRotOwn();
          const pad = new THREE.Mesh(new THREE.CircleGeometry(24, 12).rotateX(-Math.PI / 2),
            new THREE.MeshLambertMaterial({ color: g.own ? 0x46382a : 0x3a222a, transparent: true, opacity: 0.9 }));
          pad.position.y = -0.4;
          grp.add(pad, buildingModel(b.bt === 'tower' && b.br ? 'tower:' + b.br : b.bt));
          if (g.own && C.BUILDINGS[b.bt] && C.BUILDINGS[b.bt].spawns) {
            /* the company's pennant flies over its mustering hall */
            const idx = pl.buildings.indexOf(b);
            const pole = meshOf([part(cyl(0.6, 0.6, 22, 4), 0xd8c8a8, 14, 30, 8)]);
            const pf = new THREE.Mesh(new THREE.PlaneGeometry(10, 6).translate(5, 0, 0),
              new THREE.MeshBasicMaterial({ color: PENNANT[Math.max(0, idx) % PENNANT.length], side: THREE.DoubleSide }));
            pf.position.set(14, 38, 8);
            grp.add(pole, pf);
          }
          if (b.bt === 'shrine') {
            const spiral = new THREE.Mesh(new THREE.CircleGeometry(17, 18).rotateX(-Math.PI / 2),
              new THREE.MeshBasicMaterial({ color: 0x9cc8ff, transparent: true, opacity: 0.5 }));
            spiral.position.y = 11;
            grp.add(spiral);
          }
          if (ghost) grp.traverse((o) => {
            if (!o.material) return;
            o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.34;
          });
          worldG.add(grp);
          w = { grp, key, pad };
          g.works.set(id, w);
        }
        w.grp.position.set(b.x, groundH(b.x, b.y) + 1.5, b.y);
        w.seen = true;
        if (g.own) w.pad.material.color.setHex(R.selected === id ? 0x8a6c3c : 0x46382a);
      }
      for (const [id, w] of [...g.works]) {
        if (w.seen) { w.seen = false; continue; }
        w.grp.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
        w.grp.removeFromParent(); g.works.delete(id);
      }
    }
  }
  /* THE WRIT, in three dimensions: the union boundary of your claim discs, laid on the
   * ground it actually follows. Rebuilt only when a claiming work rises or falls. */
  let writG = null, writKey = '';
  function updateWrit(view, viewer) {
    const anchors = global.Terrain.claimAnchors(view, viewer);
    const key = global.Terrain.claimKey(anchors);
    if (key === writKey) return;
    writKey = key;
    if (writG) { writG.geometry.dispose(); writG.removeFromParent(); writG = null; }
    const segs = global.Terrain.claimOutline(anchors);
    if (!segs.length) return;
    const pts = [];
    for (const [x1, y1, x2, y2] of segs) {
      pts.push(new THREE.Vector3(x1, groundH(x1, y1) + 3, y1));
      pts.push(new THREE.Vector3(x2, groundH(x2, y2) + 3, y2));
    }
    writG = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.85 }));
    worldG.add(writG);
  }

  function updateBanner(view, viewer) {
    const b = view.players[viewer].banner;
    bannerG.visible = !!b;
    if (b) {
      bannerG.position.set(b.x + (viewer === 0 ? 26 : -26), groundH(b.x, b.y), b.y);
      bannerG.rotation.y = curViewerRotOwn();
      bannerG._flag.rotation.y = Math.sin(T * 2.6) * 0.25;
    }
    /* company standards: one pennant per detached company, ringed around its post */
    const me = view.players[viewer];
    const active = new Set();
    me.buildings.forEach((s, i) => {
      if (!s.rally) return;
      active.add(s.id);
      let f = coFlags.get(s.id);
      if (!f) {
        f = new THREE.Group();
        const pole = meshOf([part(cyl(0.7, 0.7, 30, 5), 0xd8c8a8, 0, 15, 0)]);
        const pf = new THREE.Mesh(new THREE.PlaneGeometry(13, 8).translate(6.5, 0, 0),
          new THREE.MeshBasicMaterial({ color: PENNANT[i % PENNANT.length], side: THREE.DoubleSide }));
        pf.position.set(0, 26, 0);
        f.add(pole, pf); f._flag = pf;
        worldG.add(f);
        coFlags.set(s.id, f);
      }
      const a2 = (i / Math.max(1, me.buildings.length)) * Math.PI * 2;
      const fx2 = s.rally.x + Math.cos(a2) * 32, fz2 = s.rally.y + Math.sin(a2) * 32;
      f.position.set(fx2, groundH(fx2, fz2), fz2);
      f.rotation.y = curViewerRotOwn();
      f._flag.rotation.y = Math.sin(T * 2.2 + i) * 0.3;
    });
    for (const [i, f] of [...coFlags]) if (!active.has(i)) { f.removeFromParent(); coFlags.delete(i); }
  }

  function updateStorms(view, viewer) {
    for (let i = 0; i < 2; i++) {
      const st = (view.storms || [])[i], ss = stormState[i];
      if (!st) {
        ss.light.intensity = 0;
        if (ss.disc) ss.disc.visible = false;
        if (ss.lines) ss.lines.visible = false;
        continue;
      }
      if (!ss.disc) {
        ss.disc = new THREE.Mesh(new THREE.CircleGeometry(C.POWERS.storm.radius, 26).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: 0x1e0a14, transparent: true, opacity: 0.45, depthWrite: false }));
        ss.disc.position.y = 3;
        worldG.add(ss.disc);
        ss.lines = new THREE.LineSegments(new THREE.BufferGeometry(),
          new THREE.LineBasicMaterial({ color: 0xffdcdc, transparent: true }));
        worldG.add(ss.lines);
      }
      ss.disc.visible = true;
      ss.disc.position.set(st.x, groundH(st.x, st.y) + 3, st.y);
      ss.light.position.set(st.x, 120, st.y);
      if (st.delay > 0) {
        ss.disc.material.opacity = 0.15 + 0.1 * Math.sin(st.delay * 18);
        ss.lines.visible = false;
        ss.light.intensity = 0;
      } else {
        ss.disc.material.opacity = 0.5;
        ss.lines.visible = true;
        const pts = [];
        for (let k = 0; k < 3; k++) {
          let lx = st.x + (Math.random() - 0.5) * 120, lz = st.y + (Math.random() - 0.5) * 120, ly = 160;
          for (let s2 = 0; s2 < 4; s2++) {
            const nx = lx + (Math.random() - 0.5) * 34, nz = lz + (Math.random() - 0.5) * 34, ny = ly - 40;
            pts.push(new THREE.Vector3(lx, ly, lz), new THREE.Vector3(nx, ny, nz));
            lx = nx; lz = nz; ly = ny;
          }
        }
        ss.lines.geometry.setFromPoints(pts);
        ss.light.intensity = Math.random() < 0.4 ? 900 : 120;
      }
    }
  }

  function updateFxs(dt) {
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      f.ttl -= dt;
      if (f.ttl <= 0) { f.obj.removeFromParent(); f.obj.geometry && f.obj.geometry.dispose(); fx.splice(i, 1); continue; }
      const a = f.ttl / f.max;
      if (f.k === 'ring') {
        const s2 = 1 + (1 - a) * (f.big / 8);
        f.obj.scale.set(s2, 1, s2);
        f.obj.material.opacity = a * 0.9;
      } else f.obj.material.opacity = a;
    }
  }

  /* ---------------- overlay: bars, labels, minimap, targeting ---------------- */
  function overlayPass(view, viewer) {
    const g = octx;
    g.clearRect(0, 0, W, H);
    /* fog of war, projected: dark veil with soft elliptical holes at each vision source */
    g.fillStyle = 'rgba(6,4,12,0.86)';
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'destination-out';
    for (const [x, y, r2] of view.visSources) {
      const c2 = proj(x, 2, y);
      if (!c2.ok) continue;
      const eH = proj(x + r2, 2, y), eV1 = proj(x, 2, y - r2), eV2 = proj(x, 2, y + r2);
      const rx = Math.abs(eH.x - c2.x), ry = Math.max(8, Math.abs(eV1.y - eV2.y) / 2);
      if (c2.y < -ry * 2 || c2.y > H + ry * 2 || rx < 2) continue;
      const cy2 = (eV1.y + eV2.y) / 2;
      g.save();
      g.translate(c2.x, cy2); g.scale(1, ry / rx);
      /* a tight falloff: the edge of sight should read as an edge, not a smear */
      const gr = g.createRadialGradient(0, 0, rx * 0.82, 0, 0, rx);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(0, 0, rx, 0, 7); g.fill();
      g.restore();
    }
    g.globalCompositeOperation = 'source-over';
    /* a warm rim on the edge of sight, so there is a LINE to plan against rather than a
     * gradient that fades off into nothing */
    g.strokeStyle = 'rgba(255,233,168,0.10)'; g.lineWidth = 1.5;
    for (const [x, y, r2] of view.visSources) {
      const c2 = proj(x, 2, y);
      if (!c2.ok) continue;
      const eH = proj(x + r2, 2, y), eV1 = proj(x, 2, y - r2), eV2 = proj(x, 2, y + r2);
      const rx = Math.abs(eH.x - c2.x), ry = Math.max(8, Math.abs(eV1.y - eV2.y) / 2);
      if (c2.y < -ry * 2 || c2.y > H + ry * 2 || rx < 2) continue;
      g.save();
      g.translate(c2.x, (eV1.y + eV2.y) / 2); g.scale(1, ry / rx);
      g.beginPath(); g.arc(0, 0, rx, 0, 7); g.stroke();
      g.restore();
    }
    /* unit hp slivers */
    for (const u of view.units) {
      if (u.hp >= u.maxHp) continue;
      const p = proj(u.x, groundH(u.x, u.y) + 26, u.y);
      if (!p.ok) continue;
      g.fillStyle = '#000a'; g.fillRect(p.x - 10, p.y, 20, 3);
      g.fillStyle = u.owner === 2 ? '#7dff9e' : (u.owner === viewer ? '#ffd98a' : '#ff8a96');
      g.fillRect(p.x - 10, p.y, 20 * Math.max(0, u.hp / u.maxHp), 3);
    }
    /* site labels + structure bars + pips */
    g.textAlign = 'center'; g.font = '600 11px Georgia, serif';
    for (const s of view.map.sites) {
      if (s.kind === 'city') continue;
      const st = view.sites[s.id];
      if (!st) continue;
      const p = proj(s.x, 2, s.y);
      if (!p.ok || p.y < -20 || p.y > H + 20) continue;
      g.strokeStyle = 'rgba(0,0,0,0.75)'; g.lineWidth = 3;
      g.strokeText(s.name, p.x, p.y + 30);
      g.fillStyle = 'rgba(222,204,164,0.85)';
      g.fillText(s.name, p.x, p.y + 30);
    }
    /* castle bars */
    for (const pi of [viewer, 1 - viewer]) {
      if (pi !== viewer && view.foeSeen === false) continue;   // no bar over a Seat you have not found
      const pl = view.players[pi];
      const cs = view.map.sites[view.map.cities[pi]];
      const p = proj(cs.x, 186, cs.y);
      if (!p.ok) continue;
      g.fillStyle = '#000b'; g.fillRect(p.x - 46, p.y - 4, 92, 8);
      g.fillStyle = pi === viewer ? '#ffd98a' : '#ff8a96';
      g.fillRect(p.x - 45, p.y - 3, 90 * Math.max(0, pl.castleHp / C.CASTLE_HP), 6);
    }
    /* minimap (same math as 2D, display space) */
    const mb = R.miniBox(), mw = mb.mw, mx = mb.mx, mh = mb.mh, my = mb.my;
    g.fillStyle = 'rgba(10,8,18,0.72)'; g.strokeStyle = 'rgba(200,164,79,0.4)'; g.lineWidth = 1;
    g.beginPath();
    g.roundRect ? g.roundRect(mx, my, mw, mh, 6) : g.rect(mx, my, mw, mh);
    g.fill(); g.stroke();
    const mpx = (x) => mx + (x / C.MAP.W) * mw, mpy = (y) => my + (y / C.MAP.H) * mh;
    for (const s of view.map.sites) {
      const st = view.sites[s.id];
      const X = mpx(dx(s.x, viewer)), Y = mpy(dy(s.y, viewer));
      if (s.kind === 'city') {
        const pi2 = view.map.cities.indexOf(s.id);
        if (pi2 !== viewer && view.foeSeen === false) continue;
        g.fillStyle = pi2 === viewer ? '#ffd98a' : '#ff8a96';
        g.fillRect(X - 3, Y - 3, 6, 6);
      } else {
        g.fillStyle = !st ? '#3a3444' : (st.holder == null || st.holder === -1 ? '#8a8098' : (st.holder === viewer ? '#ffd98a' : '#ff8a96'));
        g.beginPath(); g.arc(X, Y, st && st.holder >= 0 ? 2.6 : 1.6, 0, 7); g.fill();
      }
    }
    for (const f of fx) if (f.ping) {
      g.globalAlpha = f.ttl / f.max;
      g.strokeStyle = '#' + f.ping.toString(16).padStart(6, '0');
      g.beginPath(); g.arc(mpx(dx(f.x, viewer)), mpy(dy(f.z, viewer)), 5 + (1 - f.ttl / f.max) * 5, 0, 7); g.stroke();
      g.globalAlpha = 1;
    }
    g.strokeStyle = '#ffe9a8'; g.lineWidth = 1.5;
    const vr = R.viewRect();
    g.strokeRect(mx + (vr.x0 / C.MAP.W) * mw, my + (vr.y0 / C.MAP.H) * mh,
                 ((vr.x1 - vr.x0) / C.MAP.W) * mw, ((vr.y1 - vr.y0) / C.MAP.H) * mh);
    /* storm targeting */
    if (R.targeting) {
      g.fillStyle = 'rgba(255,90,74,0.06)'; g.fillRect(0, 0, W, H);
      if (R.pointer) {
        const w2 = R.toWorld(R.pointer.x, R.pointer.y);
        const c2 = proj(w2.x, 2, w2.y);
        const e2 = proj(w2.x + C.POWERS.storm.radius, 2, w2.y);
        const rr = Math.abs(e2.x - c2.x);
        g.strokeStyle = '#ff6a5a'; g.setLineDash([6, 6]);
        g.beginPath(); g.arc(c2.x, c2.y, rr, 0, 7); g.stroke();
        g.setLineDash([]);
      }
    }
  }

  global.Render3D = R;
})(typeof window !== 'undefined' ? window : globalThis);

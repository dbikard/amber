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
  const R = { targeting: false, selected: -1, pointer: null, camY: 0, ready: false };
  let renderer = null, scene, cam, rig, worldG;
  let overlay = null, octx = null;
  let W = 0, H = 0, scale = 1, viewH = 0;
  let curViewer = 0, curView = null, lastKey = '', T = 0;
  let ground = null;
  let unitIM = {}, shadowIM = null, unitFace = new Map();
  let siteObjs = new Map(), cityObjs = null, bannerG = null, stormState = [];
  let fx = [];
  const dummy = () => new THREE.Object3D();
  const dum = typeof THREE !== 'undefined' ? new THREE.Object3D() : null;
  const colTmp = typeof THREE !== 'undefined' ? new THREE.Color() : null;
  const dx = (x, viewer) => (viewer === 0 ? x : C.MAP.W - x);
  const dy = (y, viewer) => (viewer === 0 ? y : C.MAP.H - y);

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
  function buildingModel(bt) {
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
      p.push(part(cone(12, 16, 8), 0x5a4a68, 0, 62, 0));
    } else if (bt === 'spire') {
      p.push(part(cyl(4, 9, 58, 7), 0x6a5a8a, 0, 29, 0));
      p.push(part(sph(5), 0xc48eff, 0, 62, 0));
    } else if (bt === 'shrine') {
      p.push(part(cyl(24, 27, 6, 10), stD, 0, 3, 0));
      p.push(part(cyl(20, 22, 4, 10), st, 0, 8, 0));
    } else if (bt === 'wall' || bt === 'rampart') {
      p.push(part(box(52, 18, 10), st, 0, 9, 0));
      for (let i = -2; i <= 2; i++) p.push(part(box(6, 5, 10), stL, i * 11, 20, 0));
      if (bt === 'rampart') p.push(part(box(12, 12, 11), stD, 0, 6, 0));
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
    cam = new THREE.PerspectiveCamera(55, 1, 10, 3600);
    rig = new THREE.Group();
    cam.position.set(0, 850, 1185);   // pitch ~36°, full map width on portrait
    cam.lookAt(0, 0, 0);
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
    scale = W / C.MAP.W;
    viewH = H / scale;
    R.camY = R.maxCamY();
  };
  R.maxCamY = () => Math.max(0, C.MAP.H - viewH);
  R.pan = function (dpx) { R.camY = Math.max(0, Math.min(R.maxCamY(), R.camY - dpx / scale)); };
  R.hitMinimap = (px) => px > W - 34;
  R.minimapJump = function (py) { R.camY = Math.max(0, Math.min(R.maxCamY(), (py / H) * C.MAP.H - viewH / 2)); };

  /* screen ↔ world via raycast to the ground plane */
  const rc = typeof THREE !== 'undefined' ? new THREE.Raycaster() : null;
  const ndc = typeof THREE !== 'undefined' ? new THREE.Vector2() : null;
  const groundPlane = typeof THREE !== 'undefined' ? new THREE.Plane(new THREE.Vector3(0, 1, 0), 0) : null;
  const hitV = typeof THREE !== 'undefined' ? new THREE.Vector3() : null;
  R.toWorld = function (px, py) {
    ndc.set((px / W) * 2 - 1, -(py / H) * 2 + 1);
    rc.setFromCamera(ndc, cam);
    if (rc.ray.intersectPlane(groundPlane, hitV)) return { x: hitV.x, y: hitV.z };
    return { x: 350, y: 1200 };
  };
  R.hitSlot = function (px, py) {
    if (!curView) return -1;
    const w2 = R.toWorld(px, py);
    let best = -1, bd = 34 * 34;
    for (let i = 0; i < C.SLOTS; i++) {
      const sp = global.World.slotPos(curView, curViewer, i);
      const dd = (w2.x - sp.x) * (w2.x - sp.x) + (w2.y - sp.y) * (w2.y - sp.y);
      if (dd < bd) { bd = dd; best = i; }
    }
    return best;
  };
  R.hitSite = function (px, py, view) {
    const w2 = R.toWorld(px, py);
    let best = -1, bd = 62 * 62;
    for (const s of view.map.sites) {
      const dd = (w2.x - s.x) * (w2.x - s.x) + (w2.y - s.y) * (w2.y - s.y);
      if (dd < bd) { bd = dd; best = s.id; }
    }
    return best;
  };
  const pv = typeof THREE !== 'undefined' ? new THREE.Vector3() : null;
  function proj(x, y, z) {
    pv.set(x, y, z).project(cam);
    return { x: (pv.x * 0.5 + 0.5) * W, y: (-pv.y * 0.5 + 0.5) * H, ok: pv.z < 1 && pv.z > -1 };
  }
  R.project = (x, y, z) => proj(x, y, z);   // world → screen (tests + future UI anchoring)

  /* ---------------- world (re)build ---------------- */
  const mapKey = (view, viewer) => (view.mapSeed || 0) + ':' + viewer;
  function buildWorld(view, viewer) {
    while (worldG.children.length) {
      const c2 = worldG.children.pop();
      c2.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      worldG.remove(c2);
    }
    siteObjs.clear(); unitIM = {}; unitFace.clear();
    for (const f of fx) if (f.obj) f.obj.removeFromParent();
    fx = [];

    const bake = global.Terrain.bake(view, viewer, { trees: false, siteSprites: false, labels: false });
    /* rolling ground, flattened along paths and around sites */
    const seg = [56, 190];
    const geo = new THREE.PlaneGeometry(C.MAP.W, C.MAP.H, seg[0], seg[1]);
    geo.rotateX(-Math.PI / 2);
    geo.translate(C.MAP.W / 2, 0, C.MAP.H / 2);
    const pp = geo.attributes.position;
    const rngH = global.RNG.make((view.mapSeed || 7) ^ 0xbeef);
    const bumps = [];
    for (let i = 0; i < 70; i++) bumps.push([rngH.next() * C.MAP.W, rngH.next() * C.MAP.H, rngH.range(90, 220), rngH.range(6, 22)]);
    const flatPts = bake.pathPts.map((p) => [dx(p[0], viewer), dy(p[1], viewer)]);
    for (const s of view.map.sites) flatPts.push([s.x, s.y]);
    for (let i = 0; i < pp.count; i++) {
      const x = pp.getX(i), z = pp.getZ(i);
      let h = 0;
      for (const [bx2, bz, br, bh] of bumps) {
        const dd = (x - bx2) * (x - bx2) + (z - bz) * (z - bz);
        if (dd < br * br) h += bh * (1 - Math.sqrt(dd) / br);
      }
      let flat = 1;
      for (let j = 0; j < flatPts.length; j += 1) {
        const p = flatPts[j];
        const dd = (x - p[0]) * (x - p[0]) + (z - p[1]) * (z - p[1]);
        if (dd < 3600) { flat = 0; break; }
        if (dd < 12100) flat = Math.min(flat, (Math.sqrt(dd) - 60) / 50);
      }
      pp.setY(i, h * flat);
    }
    geo.computeVertexNormals();
    const tex2 = new THREE.CanvasTexture(bake.canvas);
    tex2.colorSpace = THREE.SRGBColorSpace;
    if (viewer === 1) { tex2.center.set(0.5, 0.5); tex2.rotation = Math.PI; }
    ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex2 }));
    worldG.add(ground);

    /* forests: 3 instanced palettes (display-space bands → world positions) */
    const pals = { gold: [0x3c4416, 0x5f6626, 0x8f9838], mid: [0x232840, 0x333a5c, 0x4c5680], ash: [0x3c2020, 0x553030, 0x6f4444] };
    const buckets = { gold: [], mid: [], ash: [] };
    for (const [tx, ty, r2, v] of bake.trees) {
      const b = ty > C.MAP.H * 0.62 ? 'gold' : ty < C.MAP.H * 0.34 ? 'ash' : 'mid';
      buckets[b].push([dx(tx, viewer), dy(ty, viewer), r2, v]);
    }
    for (const k of Object.keys(buckets)) {
      const list = buckets[k];
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(treeGeo(pals[k]), MAT, list.length);
      list.forEach(([x, z, r2, v], i) => {
        dum.position.set(x, 0, z);
        dum.rotation.set(0, v * Math.PI * 2, 0);
        const s2 = 0.7 + r2 * 0.06;
        dum.scale.set(s2, s2 * (0.9 + v * 0.35), s2);
        dum.updateMatrix();
        im.setMatrixAt(i, dum.matrix);
      });
      worldG.add(im);
    }

    /* site props + dynamic holders */
    const ringGeo = new THREE.RingGeometry(36, 41, 24);
    ringGeo.rotateX(-Math.PI / 2);
    for (const s of view.map.sites) {
      if (s.kind === 'city') continue;
      const holder = new THREE.Group();
      holder.position.set(s.x, 0.5, s.y);
      if (s.kind === 'spring') {
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
      const postG = new THREE.Group();
      holder.add(postG);
      worldG.add(holder);
      siteObjs.set(s.id, { holder, ring, postG, hash: '' });
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
    /* full wall ring with gate gaps toward the approaches */
    const wallParts = [];
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * Math.PI * 2;
      wallParts.push(part(box(46, 22, 10), own ? 0xcbb076 : 0xc88a94, 0, 11, 0, 0)
        .rotateY(-a).translate(Math.cos(a) * C.CITY.r, 0, Math.sin(a) * C.CITY.r));
      wallParts.push(part(box(10, 28, 14), own ? 0x8a6c3c : 0x7c3e4a, 0, 14, 0, 0)
        .rotateY(-(a + Math.PI / 18)).translate(Math.cos(a + Math.PI / 18) * C.CITY.r, 0, Math.sin(a + Math.PI / 18) * C.CITY.r));
    }
    g.wall = new THREE.Mesh(merge(wallParts), MAT);
    g.wall.position.set(city.x, 0, city.y);
    g.wall.visible = false;
    g.group.add(g.wall);
    /* eight plots on the ring; buildings rise (and fall) on them */
    g.pads = []; g.slotG = []; g.slotBt = [];
    for (let i = 0; i < C.SLOTS; i++) {
      const sp = global.World.slotPos(view, pi, i);
      const pad = new THREE.Mesh(new THREE.CircleGeometry(26, 12).rotateX(-Math.PI / 2),
        new THREE.MeshLambertMaterial({ color: own ? 0x46382a : 0x3a222a, transparent: true, opacity: 0.9 }));
      pad.position.set(sp.x, 1.1, sp.y);
      g.group.add(pad);
      g.pads.push(pad);
      const slotG = new THREE.Group();
      slotG.position.set(sp.x, 1.5, sp.y);
      slotG.rotation.y = curViewerRotOwn();
      g.group.add(slotG);
      g.slotG.push(slotG); g.slotBt.push('');
    }
    worldG.add(g.group);
    return g;
  }
  function curViewerRotOwn() { return curViewer === 0 ? 0 : Math.PI; }

  /* ---------------- events → fx ---------------- */
  const TINT = { 0: 0xffd98a, 1: 0xff8a96, 2: 0x7dff9e };
  function ringFx(x, z, color, ttl, big, ping) {
    const m = new THREE.Mesh(new THREE.RingGeometry(6, 9, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    m.position.set(x, 2, z);
    worldG.add(m);
    fx.push({ k: 'ring', obj: m, ttl, max: ttl, big: big || 40, x, z, ping });
  }
  function boltFx(x1, z1, x2, z2, color, ttl) {
    const gline = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x1, 16, z1), new THREE.Vector3(x2, 12, z2)]);
    const m = new THREE.Line(gline, new THREE.LineBasicMaterial({ color, transparent: true }));
    worldG.add(m);
    fx.push({ k: 'bolt', obj: m, ttl, max: ttl, x: x1, z: z1 });
  }
  function slotCenterWorld(idx) {
    const sp = global.World.slotPos(curView, curViewer, idx);
    return { x: sp.x, z: sp.y };
  }
  R.addEvents = function (events, view, viewer) {
    if (!R.ready) return;
    for (const ev of events) {
      if (ev.e === 'shot' && ev.pi === viewer) {
        const c2 = slotCenterWorld(ev.slot);
        boltFx(c2.x, c2.z, ev.to.x, ev.to.y, 0xe8d8a8, 0.22);
      } else if (ev.e === 'wshot') boltFx(ev.x, ev.y, ev.to.x, ev.to.y, 0xe8d8a8, 0.22);
      else if (ev.e === 'bolt') boltFx(ev.from.x, ev.from.y, ev.to.x, ev.to.y, TINT[ev.from.owner], 0.3);
      else if (ev.e === 'die') ringFx(ev.x, ev.y, TINT[ev.owner], 0.5, 20);
      else if (ev.e === 'rift') ringFx(ev.x, ev.y, 0x5ad584, 3.0, 46, 0x7dff9e);
      else if (ev.e === 'siege') ringFx(ev.x, ev.y, 0xffb090, 0.35, 18, ev.pi === viewer ? 0xff5a4a : null);
      else if (ev.e === 'hurtpost') { if (ev.pi === viewer) ringFx(ev.x, ev.y, 0xff8a5a, 1.2, 44, 0xff8a5a); }
      else if (ev.e === 'post' || ev.e === 'postup') ringFx(ev.x, ev.y, 0xffe9a8, 0.8, 44);
      else if (ev.e === 'postdie') ringFx(ev.x, ev.y, 0xcfc6d8, 0.8, 44, ev.pi === viewer ? 0xff5a4a : null);
      else if (ev.e === 'build' || ev.e === 'up') {
        if (ev.pi === viewer) { const c2 = slotCenterWorld(ev.slot); ringFx(c2.x, c2.z, 0xffe9a8, 0.6, 30); }
      } else if (ev.e === 'raze') ringFx(ev.x, ev.y, 0xff7a4a, 1.1, 52, ev.pi === viewer ? 0xff5a4a : null);
      else if (ev.e === 'hurtcity' || ev.e === 'hurtwall') {
        const city = view.map.sites[view.map.cities[ev.pi]];
        if (ev.pi === viewer) ringFx(ev.x != null ? ev.x : city.x, ev.y != null ? ev.y : city.y, 0xff8a5a, 1.0, 40, 0xff8a5a);
      } else if (ev.e === 'breach') {
        const city = view.map.sites[view.map.cities[ev.pi]];
        ringFx(city.x, city.y, 0xffb090, 1.6, 150, ev.pi === viewer ? 0xff5a4a : null);
      } else if (ev.e === 'wallup') {
        const city = view.map.sites[view.map.cities[ev.pi]];
        if (ev.pi === viewer) ringFx(city.x, city.y, 0xcbb076, 1.2, 150);
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
    const f0 = 480, f1 = 1780;
    const focus = f0 + (R.camY / Math.max(1, R.maxCamY())) * (f1 - f0);
    rig.position.set(C.MAP.W / 2, 0, viewer === 0 ? focus : C.MAP.H - focus);
    rig.rotation.y = viewer === 0 ? 0 : Math.PI;

    updateUnits(view, viewer, dt);
    updateSites(view, viewer);
    updateCities(view, viewer);
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
        dum.position.set(u.x, Math.abs(Math.sin(T * 8 + u.id)) * 1.6, u.y);
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
      const hash = st ? [st.owner, st.live, st.post && st.post.bt, st.post && st.post.level].join('|') : 'x';
      if (hash !== so.hash) {
        so.hash = hash;
        so.ring.visible = !!(st && st.owner >= 0);
        if (st && st.owner >= 0) {
          so.ring.material.color.setHex(st.owner === viewer ? 0xffd98a : 0xff8a96);
          so.ring.material.opacity = st.live ? 0.65 : 0.3;
        }
        while (so.postG.children.length) { const m = so.postG.children.pop(); m.geometry && m.geometry.dispose(); }
        if (st && st.post) {
          const m = buildingModel(st.post.bt);
          m.rotation.y = curViewerRotOwn();
          if (!st.live) m.material = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.55 });
          so.postG.add(m);
          if (st.post.bt === 'sgate') {
            const swirl = new THREE.Mesh(new THREE.CircleGeometry(9, 14),
              new THREE.MeshBasicMaterial({ color: 0x8fa8ff, transparent: true, opacity: 0.8 }));
            swirl.position.set(0, 20, curViewer === 0 ? 1 : -1);
            swirl.rotation.y = curViewerRotOwn();
            so.postG.add(swirl);
          }
        }
      }
    }
  }

  function updateCities(view, viewer) {
    for (const g of [cityObjs.own, cityObjs.foe]) {
      const pi = g.own ? viewer : 1 - viewer;
      const pl = view.players[pi];
      g.wall.visible = pl.wallHp > 0;
      for (let i = 0; i < C.SLOTS; i++) {
        const s = pl.slots[i], slotG = g.slotG[i];
        let want = s ? s.bt : '';
        if (!g.own && want && !(want === 'shrine' && pl.revealed)) want = 'veiled';
        if (g.slotBt[i] !== want) {
          g.slotBt[i] = want;
          while (slotG.children.length) { const m = slotG.children.pop(); m.geometry && m.geometry.dispose(); }
          if (want) {
            slotG.add(buildingModel(want));
            if (want === 'shrine') {
              const spiral = new THREE.Mesh(new THREE.CircleGeometry(17, 18).rotateX(-Math.PI / 2),
                new THREE.MeshBasicMaterial({ color: 0x9cc8ff, transparent: true, opacity: 0.5 }));
              spiral.position.y = 11;
              slotG.add(spiral);
            }
          }
        }
        if (g.own) g.pads[i].material.color.setHex(R.selected === i ? 0x8a6c3c : 0x46382a);
      }
    }
  }
  function updateBanner(view, viewer) {
    const b = view.players[viewer].banner;
    bannerG.visible = b >= 0;
    if (b >= 0) {
      const s = view.map.sites[b];
      bannerG.position.set(s.x + (viewer === 0 ? 26 : -26), 0, s.y);
      bannerG.rotation.y = curViewerRotOwn();
      bannerG._flag.rotation.y = Math.sin(T * 2.6) * 0.25;
    }
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
      ss.disc.position.set(st.x, 3, st.y);
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
    g.fillStyle = 'rgba(6,4,12,0.55)';
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
      const gr = g.createRadialGradient(0, 0, rx * 0.55, 0, 0, rx);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(0, 0, rx, 0, 7); g.fill();
      g.restore();
    }
    g.globalCompositeOperation = 'source-over';
    /* unit hp slivers */
    for (const u of view.units) {
      if (u.hp >= u.maxHp) continue;
      const p = proj(u.x, 26, u.y);
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
      if (st.post) {
        const top = proj(s.x, 52, s.y);
        for (let lv = 1; lv < st.post.level; lv++) {
          g.fillStyle = '#ffe9a8';
          g.beginPath(); g.arc(top.x - 12 + lv * 12, p.y + 16, 2.6, 0, 7); g.fill();
        }
        if (st.live && st.post.hp != null && st.post.hp < st.post.maxHp) {
          g.fillStyle = '#000a'; g.fillRect(top.x - 22, top.y - 6, 44, 4);
          g.fillStyle = st.owner === viewer ? '#ffd98a' : '#ff8a96';
          g.fillRect(top.x - 22, top.y - 6, 44 * Math.max(0, st.post.hp / st.post.maxHp), 4);
        }
      }
    }
    /* castle + wall bars */
    for (const pi of [viewer, 1 - viewer]) {
      const pl = view.players[pi];
      const cs = view.map.sites[view.map.cities[pi]];
      const p = proj(cs.x, 186, cs.y);
      if (!p.ok) continue;
      g.fillStyle = '#000b'; g.fillRect(p.x - 46, p.y - 4, 92, 8);
      g.fillStyle = pi === viewer ? '#ffd98a' : '#ff8a96';
      g.fillRect(p.x - 45, p.y - 3, 90 * Math.max(0, pl.castleHp / C.CASTLE_HP), 6);
      if (pl.wallHp > 0) {
        g.fillStyle = '#000b'; g.fillRect(p.x - 46, p.y + 6, 92, 5);
        g.fillStyle = '#cbb076';
        g.fillRect(p.x - 45, p.y + 7, 90 * Math.min(1, pl.wallHp / C.WALL.hp[2]), 3);
      }
    }
    /* minimap (same math as 2D, display space) */
    const mw = 26, mx = W - mw - 4, mh = Math.min(H * 0.6, 380), my = (H - mh) / 2;
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
        g.fillStyle = pi2 === viewer ? '#ffd98a' : '#ff8a96';
        g.fillRect(X - 3, Y - 3, 6, 6);
      } else {
        g.fillStyle = !st ? '#3a3444' : (st.owner === -1 || st.owner == null ? '#8a8098' : (st.owner === viewer ? '#ffd98a' : '#ff8a96'));
        g.beginPath(); g.arc(X, Y, st && st.post ? 2.6 : 1.6, 0, 7); g.fill();
      }
    }
    for (const f of fx) if (f.ping) {
      g.globalAlpha = f.ttl / f.max;
      g.strokeStyle = '#' + f.ping.toString(16).padStart(6, '0');
      g.beginPath(); g.arc(mpx(dx(f.x, viewer)), mpy(dy(f.z, viewer)), 5 + (1 - f.ttl / f.max) * 5, 0, 7); g.stroke();
      g.globalAlpha = 1;
    }
    g.strokeStyle = '#ffe9a8'; g.lineWidth = 1.5;
    const vy = my + (R.camY / C.MAP.H) * mh, vh2 = (viewH / C.MAP.H) * mh;
    g.strokeRect(mx + 1.5, vy, mw - 3, vh2);
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

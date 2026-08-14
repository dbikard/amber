/* render3d.js — the Three.js renderer (v0.4 "The Raised World"): an AoE2/DOTA-style
 * pitched-perspective 3D battlefield, and the game's ONE renderer (render_select.js
 * hands it to game.js, or null where WebGL is missing) — game logic, AI, sim and
 * netcode never draw. The painterly terrain bake (js/terrain.js) drapes
 * over a rolling ground mesh; buildings and units are procedural low-poly models
 * (merged geometry, instanced units — phone-friendly draw calls). The guest doesn't
 * mirror the world: their camera simply stands on the other side of the table.
 * HP bars / nameplates / minimap / targeting live on a 2D overlay canvas. */
(function (global) {
  'use strict';

  const C = global.CONST;
  const R = { targeting: false, span: null, selected: -1, pointer: null, armed: null,
              camX: 0, camY: 0, zoom: 1, ready: false,
              /* THE VEIL IS SAMPLED IN THE MATERIALS. See the note above `fogPatch` for what
               * that buys; the short of it is that the 2D path draws a WORLD-space field as
               * SCREEN-space polygons and every veil defect this year lived in that gap.
               * The 2D path is still here and still works — set this false and it draws —
               * because a look this central should be revertible in one field, not a git
               * archaeology exercise. It is the only switch: overlayPass reads it, and so do
               * the suites that still measure the old veil. */
              shaderFog: true };
  let renderer = null, scene, cam, rig, worldG;
  let overlay = null, octx = null;
  let W = 0, H = 0, scale = 1, viewW = 0, viewH = 0;
  let curViewer = 0, curView = null, lastKey = '', T = 0;
  /* ---- THE VIEWER AND THE HAND ARE TWO DIFFERENT PEOPLE NOW ----
   * `viewer` is the seat this screen belongs to: its fog, its colours, its camera. `R.hand`
   * is the LORD whose city the player is driving, which in a war may be one sworn to him — so
   * the writ outline, the reach ring, the armed-company halo and "did I just tap my own men"
   * all answer for the hand, while everything about what can be SEEN answers for the viewer.
   * A realm shares its sight, so the two never disagree about the veil. Null on a board and
   * everywhere else, which reads as "the viewer", so nothing outside a war changes. */
  R.hand = null;
  const handOf = (viewer) => (R.hand != null ? R.hand : viewer);
  let ground = null;
  let groundGrid = null, gridW = 0, gridH = 0, gridDX = 1, gridDZ = 1;
  /* THE LAND'S SIZE IS THE VIEW'S, NOT THE GAME'S — set from the world this renderer was
   * handed (buildWorld), so a country and a board draw at their own extents. `CONST.MAP` is
   * only the value before the first world arrives. */
  let mapW = C.MAP.W, mapH = C.MAP.H;
  let underM = null;
  /* the detail tiles over a country's cheap base — see buildWorld's two-grounds note */
  let tiled = false, tileMap = null, groundDirty = false;
  const tileQueue = [];
  const TILE = 1200;
  /* ---------------- THE GROUND YOU STAND ON IS THE GROUND YOU SEE ----------------
   * `groundH` is where EVERYTHING is put: every unit, every work, every pool, every ring, and
   * the detail tiles a country is painted with. So it has to answer for the surface that is
   * actually DRAWN, and for years it answered for a different one — it sampled the raw
   * elevation field on a 10-unit grid, while the ground mesh is a PlaneGeometry capped at 180
   * segments whose triangles are a coarser, flatter thing. Measured against the real geometry
   * by raycast: up to 8.75 units of disagreement on a board and 21.5 on a country, all of it
   * on the steep ground where it shows.
   * It never read as "things float", because the ONE thing that hid it is that a board has
   * nothing between the eye and the ground. A country has: the painterly detail tiles, which
   * are the same field sampled FINER, so they rise off the base mesh by exactly that error —
   * which is why they were lifted 3.0 units clear to stop the base poking through, and why
   * that lift then swallowed every spring in the country whole (a pool's water sits 1.5 up).
   * The fix is not a bigger lift. It is to make the two grounds the SAME surface: the lattice
   * here IS the drawn mesh's vertices, and the interpolation IS its triangulation — Three
   * splits each quad on the diagonal from (ix, iz+1) to (ix+1, iz), verified by raycasting the
   * mesh the renderer had actually built (0.0002 against 2.35 for the bilinear it used to do).
   * A tile built on this lands exactly on the base and needs no lift at all. */
  function groundH(x, z) {
    if (!groundGrid) return 0;
    const fx = Math.max(0, Math.min(gridW - 1.001, x / gridDX));
    const fz = Math.max(0, Math.min(gridH - 1.001, z / gridDZ));
    const x0 = fx | 0, z0 = fz | 0, tx = fx - x0, tz = fz - z0;
    const i = z0 * gridW + x0;
    const h00 = groundGrid[i], h10 = groundGrid[i + 1];
    const h01 = groundGrid[i + gridW], h11 = groundGrid[i + gridW + 1];
    /* the near triangle, then the far one — the diagonal is tx + tz = 1 */
    return (tx + tz <= 1) ? h00 + (h10 - h00) * tx + (h01 - h00) * tz
                          : h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  }
  R.groundH = (x, z) => groundH(x, z);
  /* test handle: the army's instanced meshes, so a suite can prove they are still drawn */
  R.debugUnitMeshes = () => unitIM;
  /* test handle: which slot of which instanced bucket a given man was drawn in, and the
   * colour that went with him — an InstancedMesh has no per-man object to interrogate, so
   * without this "the armed company's men are lit" is unprovable. Off unless a suite asks
   * for it: the bookkeeping is per man per frame and play should not pay for it. */
  R.debugSlots = false;
  const unitSlot = new Map();
  R.debugUnitSlot = (id) => {
    const s = unitSlot.get(id);
    if (!s) return null;
    const cut = s.indexOf('|'), im = unitIM[s.slice(0, cut)], i = +s.slice(cut + 1);
    if (!im || !im.instanceColor) return null;
    const a = im.instanceColor.array;
    return { bucket: s.slice(0, cut), i, r: a[i * 3], g: a[i * 3 + 1], b: a[i * 3 + 2] };
  };
  /* test handle: the works as the renderer currently holds them, so a suite can prove a
   * level (or a wall's run, or scaffolding) actually rebuilt the model rather than trusting
   * that it must have */
  R.debugWorks = (id) => {
    const shape = (wid, w) => {
      let verts = 0, opacity = 1;
      w.grp.traverse((o) => {
        if (o.geometry && o.geometry.attributes && o.geometry.attributes.position && o !== w.pad)
          verts += o.geometry.attributes.position.count;
        if (o.material && o !== w.pad && o.material.opacity < opacity) opacity = o.material.opacity;
      });
      return { id: wid, key: w.key, verts, opacity };
    };
    if (id != null) {
      for (const g of cityObjs) { const w = g.works.get(id); if (w) return shape(id, w); }
      return null;
    }
    const out = new Map();
    for (const g of cityObjs) for (const [wid, w] of g.works) out.set(wid, shape(wid, w));
    return out;
  };
  /* test handle: the damage bars the last overlay pass actually PAINTED, keyed by work id.
   * A bar lives on the 2D overlay, where there is no scene graph to interrogate — without
   * this a suite could only prove the hp changed, which was never in doubt. */
  R.debugWorkBars = (id) => (id != null ? barRec.get(id) || null
                                        : [...barRec].map(([wid, r2]) => ({ id: wid, ...r2 })));
  /* test handle: the ring drawn under the armed company's men — how many, whose, what colour,
   * and where each one landed (plain numbers: this crosses a page boundary in the suite) */
  R.debugHalo = () => {
    if (!haloIM) return null;
    const at = [];
    for (let i = 0; i < haloIM.count; i++) {
      haloIM.getMatrixAt(i, dum.matrix);
      const e = dum.matrix.elements;
      at.push({ x: e[12], y: e[13], z: e[14] });
    }
    return { co: haloCo, count: haloIM.count, room: haloIM._room,
             color: haloIM.material.color.getHex(), visible: haloIM.visible, at };
  };
  /* the work's own mesh and world matrix, so a suite can walk the STONE against the terrain
   * rather than trust that a model which claims to follow the ground does */
  R.debugWorkGroup = (id) => {
    for (const g of cityObjs) {
      const w = g.works.get(id);
      if (!w) continue;
      let mesh = null;
      w.grp.traverse((o) => { if (!mesh && o.geometry && o !== w.pad && o.isMesh) mesh = o; });
      if (!mesh) return null;
      w.grp.updateWorldMatrix(true, true);
      return { mesh, matrix: mesh.matrixWorld };
    }
    return null;
  };
  let unitIM = {}, shadowIM = null, unitFace = new Map();
  let haloIM = null, haloCo = null;
  /* what the last overlay pass painted over each hurt work, and what each work's hp was the
   * frame before — a drop is what makes a bar FLASH, and it is the one way to tell "this is
   * being broken right now" from "this was broken an hour ago". Kept here rather than read
   * off `b.lastHurt` because lastHurt does not ride the wire: a guest would have no flash. */
  const barRec = new Map(), hpMem = new Map(), flash = new Map();
  let lastDt = 0;
  /* the damage step a work's MODEL is currently built at, so the stone can be rebuilt when it
   * changes and left alone when it does not */
  const hurtMem = new Map();
  let siteObjs = new Map(), cityObjs = null, bannerG = null, stormState = [];
  let seatFalls = [];   // collapses in flight: { pi, t0 } — see R.seatFall
  /* have I found THIS seat? one flag per seat now; `foeSeen` is the old two-player spelling */
  const seatFound = (view, pi) => pi === curViewer ||
    (view.seatSeen ? view.seatSeen[pi] !== false : view.foeSeen !== false);
  const PENNANT = [0xe8ecff, 0x64d8d8, 0xc48eff, 0xff9ad8, 0x9adcff, 0xffc27a, 0xb0e8a0, 0xd8b0ff];
  let coFlags = new Map();
  let fx = [];
  const dummy = () => new THREE.Object3D();
  const dum = typeof THREE !== 'undefined' ? new THREE.Object3D() : null;
  const colTmp = typeof THREE !== 'undefined' ? new THREE.Color() : null;
  const penTmp = typeof THREE !== 'undefined' ? new THREE.Color() : null;

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

  /* A POOL IS NOT A CIRCLE. Three perfect concentric discs is the one thing that made a
   * spring read as machinery: nothing in a landscape is that round. The outline is a fan
   * whose radius wobbles on three harmonics, seeded by the SITE id — so every spring on the
   * board has its own shape, every machine at a LAN table draws the same one, and a rejoin
   * does not reshuffle it. Two-sided because a flat fan's winding is not worth reasoning
   * about and getting wrong once is a pool that vanishes when the camera swings. */
  function poolGeo(seed, r0) {
    const n = 34, pos = new Float32Array((n + 2) * 3), nor = new Float32Array((n + 2) * 3);
    const idx = [];
    nor[1] = 1;
    for (let i = 0; i <= n; i++) {
      const a2 = i / n * Math.PI * 2;
      /* HARMONICS 2 AND UP, NEVER 1. A first harmonic in r(theta) does not deform a circle,
       * it TRANSLATES it — one side comes in by 15% and the opposite side goes out by 15% —
       * so the pool drifted off the site it belongs to and the Gate standing at the site's
       * exact centre looked planted at the water's edge. Every higher harmonic pushes in and
       * out in pairs and leaves the centre exactly where it was. */
      const r = r0 * (1 + 0.13 * Math.sin(a2 * 2.0 + seed) + 0.09 * Math.sin(a2 * 3.0 - seed * 1.7)
                        + 0.055 * Math.sin(a2 * 5.0 + seed * 0.6));
      const j = (i + 1) * 3;
      pos[j] = Math.cos(a2) * r; pos[j + 2] = Math.sin(a2) * r; nor[j + 1] = 1;
      /* WINDING, and it is not cosmetic. Two-sided is not a licence to ignore it: for a BACK
       * face Three flips the normal in the fragment shader, so a fan wound the wrong way is
       * lit by the hemisphere's GROUND colour instead of its sky and comes out near-black —
       * which is exactly how the pool's stone bank read as a hole in the world. */
      if (i < n) idx.push(0, i + 2, i + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(idx);
    return g;
  }
  /* one lip material and one water material for every spring on the board — the SHAPE is per
   * site, the surface is not, so this is one program and two draw calls a pool */
  let poolLipMat = null, poolWaterMat = null;

  /* ---------------- damage ----------------
   * A WORK'S HP WAS INVISIBLE UNTIL IT FELL. You could watch a hall you had paid for be taken
   * apart and the only sign was the moment it stopped existing — so there was no such thing as
   * "get the men back before it goes" or "that one is nearly gone, mend it". Damage is shown
   * twice, deliberately: in the STONE, which is what you read while you are looking at the
   * board, and on a small bar, which is what you read when you need the number.
   *
   * The stone is stepped rather than continuous: the model is rebuilt from its key, and a key
   * that carried a percentage would rebuild the geometry every time a bolt landed. Three steps
   * — whole, hurt, ruinous — cost at most two rebuilds in a work's whole life. */
  const HURT_AT = [0.66, 0.33];
  function hurtOf(b) {
    /* a work still going up is BELOW full hp by design (RAISE.hpFrom) and already wears
     * scaffolding — calling that damage would be a lie about what is happening to it */
    if (!b.maxHp || b.hp == null || b.raise > 0) return 0;
    const f = b.hp / b.maxHp;
    let t = f > HURT_AT[0] ? 0 : f > HURT_AT[1] ? 1 : 2;
    /* HYSTERESIS. Stone regenerates (STRUCT_REGEN), so a work sitting on a threshold while it
     * mends would otherwise rebuild its geometry every few frames. Coming back up costs more
     * than going down did. */
    const was = hurtMem.get(b.id) || 0;
    if (t < was && f < HURT_AT[was - 1] + 0.06) t = was;
    hurtMem.set(b.id, t);
    return t;
  }
  /* char the vertex colours in place: cheaper than a second material, and it survives the
   * merge into one mesh, which is the only reason a work is one draw call at all */
  function soot(geo, amt) {
    const col = geo.attributes.color, c2 = new THREE.Color(0x2b2430);
    for (let i = 0; i < col.count; i++) {
      col.setXYZ(i, col.getX(i) + (c2.r - col.getX(i)) * amt,
                    col.getY(i) + (c2.g - col.getY(i)) * amt,
                    col.getZ(i) + (c2.b - col.getZ(i)) * amt);
    }
    return geo;
  }
  /* How high over the ground a work's bar rides. These are the heights the models above
   * actually reach, per level — the renderer is the only thing that knows them, and a single
   * flat number put the bar through the Spire's light and a storey over the Shrine. */
  const TOPS = { gate: [46, 8], sgate: [46, 8], barracks: [48, 6], tower: [62, 9], watch: [62, 9],
                 siege: [46, 5], spire: [70, 12], shrine: [22, 0], veiled: [30, 0], wall: [40, 4] };
  function barTop(b) {
    const t = TOPS[b.x2 != null ? 'wall' : b.bt] || [46, 6];
    return t[0] + (Math.max(1, Math.min(3, b.level || 1)) - 1) * t[1] + (b.onWall ? 27 : 0);
  }

  /* the stone that has come OFF it, lying where it fell. Fixed angles, not random: a model is
   * rebuilt whenever anything about it changes, and rubble that jumped on every rebuild would
   * read as a work shivering rather than a work in trouble. */
  function rubble(p, hurt, r2) {
    const n = hurt > 1 ? 7 : 4;
    for (let i = 0; i < n; i++) {
      const a = i * 2.399, d = r2 * (0.62 + (i % 3) * 0.16), s2 = 2.6 + (i % 4) * 1.3;
      p.push(part(box(s2 * 1.6, s2, s2 * 1.3), i % 2 ? 0x554c60 : 0x3d3648,
                  Math.cos(a) * d, s2 / 2, Math.sin(a) * d, a));
    }
  }

  /* models */
  /* A SEAT WEARS ITS BANNER'S COLOUR, and there are more than two banners. The four shades
   * were a pair of hand-picked palettes behind a `gold` boolean, which is exactly as many as a
   * duel has sides; a war has six and a court changes hands. Derived from the one tint the
   * rest of the game already colours that banner with, so a Seat, its men, its hp bar and its
   * mark on the minimap cannot disagree about whose it is. The multipliers are read off the
   * old gold palette, so the player's own castle is the same castle to within a shade. */
  const shade = (tint, k) => {
    const r = Math.round(((tint >> 16) & 255) * k), g = Math.round(((tint >> 8) & 255) * k);
    const b = Math.round((tint & 255) * k);
    return (Math.min(255, r) << 16) | (Math.min(255, g) << 8) | Math.min(255, b);
  };
  function towerModel(tint) {
    const wall = shade(tint, 0.72), light = shade(tint, 0.9),
      dark = shade(tint, 0.42), roof = shade(tint, 0.54);
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
    const lit = shade(tint, 1.0);                                 // the lights are the tint itself
    for (const a of [0.4, 2.1, 3.8, 5.5])                         // arrow lights
      p.push(part(box(3, 8, 1.6), lit, Math.cos(a) * 25.5, 90, Math.sin(a) * 25.5, a));
    p.push(part(box(16, 22, 5), dark, 0, 11, 34));               // the tower gate
    p.push(part(cyl(0.9, 0.9, 26, 5), light, 0, 196, 0));
    p.push(part(box(15, 9, 0.8), lit, 8.5, 204, 0));
    return meshOf(p);
  }
  function modelKey(b, gar, hurt) {
    return (b.br ? b.bt + ':' + b.br : b.bt)
      + '@' + (b.level || 1)
      + (gar ? '+' + gar : '')
      + (hurt ? '%' + hurt : '');
  }
  function buildingModel(key) {
    /* ...and a DAMAGE step after that: 'barracks@2%1'. It is part of the key so that a work
     * being broken rebuilds its stone, exactly as a level does. */
    const pc = key.indexOf('%');
    const hurt = pc < 0 ? 0 : Math.max(0, Math.min(2, +key.slice(pc + 1) || 0));
    key = pc < 0 ? key : key.slice(0, pc);
    /* ...and how many men are up it: 'tower@2+3'. A garrison does not rebuild the tower — it
     * hangs a mark per man on the crown, which is enough to tell a filled tower from an empty
     * one across the board without a second silhouette to learn. */
    const gp = key.indexOf('+');
    const gar = gp < 0 ? 0 : Math.max(0, Math.min(C.TOWER.berths, +key.slice(gp + 1) || 0));
    key = gp < 0 ? key : key.slice(0, gp);
    const at = key.indexOf('@');
    const lv = at < 0 ? 1 : Math.max(1, Math.min(3, +key.slice(at + 1) || 1));
    const head = at < 0 ? key : key.slice(0, at);
    const cut = head.indexOf(':'), bt = cut < 0 ? head : head.slice(0, cut), br = cut < 0 ? '' : head.slice(cut + 1);
    const st = 0x8d8296, stD = 0x4a4258, stL = 0xcfc6d8, woodR = 0x6e4434;
    const gild = lv > 2 ? 0xe6c877 : 0xc9bfa0;   // the banding a raised work earns
    const p = [];
    if (bt === 'gate' || bt === 'sgate') {
      /* a deeper draw is a taller arch, hung with more of the Shadow it is pulling up */
      const h = 34 + (lv - 1) * 7;
      p.push(part(cyl(5, 6.5, h, 6), st, -16, h / 2, 0));
      p.push(part(cyl(5, 6.5, h, 6), st, 16, h / 2, 0));
      p.push(part(box(44, 8, 9), stL, 0, h + 4, 0));
      if (bt === 'sgate') { p.push(part(cyl(4, 5, 22, 5), stD, -30, 11, 10)); p.push(part(cyl(4, 5, 22, 5), stD, 30, 11, 10)); }
      if (lv > 1) p.push(part(box(48, 4, 13), gild, 0, h + 10, 0));       // a lintel course
      if (lv > 2) {
        p.push(part(cyl(3, 3.6, 20, 5), st, -26, 10, 0));                 // outer piers
        p.push(part(cyl(3, 3.6, 20, 5), st, 26, 10, 0));
        /* NO ORB. A violet ball hanging over the lintel was the loudest thing on the board and
         * read as a power-up, not as a deep-drawn Gate. A third level still says so — it has
         * the lintel course and the outer piers — without a lamp on the roof. */
      }
    } else if (bt === 'barracks') {
      /* a hall that musters veterans is a bigger hall: it gains a drill yard wall at 2 and a
       * gatehouse and a second standard at 3 */
      p.push(part(box(48, 22 + (lv - 1) * 5, 34), st, 0, 11 + (lv - 1) * 2.5, 0));
      p.push(part(cyl(0.1, 26, 18, 4), woodR, 0, 31 + (lv - 1) * 5, 0, Math.PI / 4));
      p.push(part(box(10, 14, 2), stD, 0, 7, 17));
      p.push(part(cyl(0.7, 0.7, 26, 5), stL, 20, 30 + (lv - 1) * 5, 12));
      p.push(part(box(10, 6, 0.6), 0xffe9a8, 25, 38 + (lv - 1) * 5, 12));
      if (lv > 1) {
        p.push(part(box(52, 4, 38), gild, 0, 24 + (lv - 1) * 5, 0));       // a banded eave
        p.push(part(box(30, 9, 3), stD, 0, 4, 19));                        // the drill-yard wall
      }
      if (lv > 2) {
        p.push(part(box(14, 20, 12), st, 0, 10, 22));                      // a gatehouse
        p.push(part(cone(9, 10, 4), gild, 0, 25, 22));
        p.push(part(cyl(0.7, 0.7, 26, 5), stL, -20, 35, 12));
        p.push(part(box(10, 6, 0.6), 0xffe9a8, -25, 43, 12));              // a second standard
      }
      /* WHAT THE YARD IS FOR. A forked hall must be tellable from the other two across the
       * board without reading a label — the yard is where a Barracks says which soldiery it
       * raises, so each branch dresses the ground in front of the hall differently. */
      if (br === 'line') {                       // the Shieldwall: a shield rack and a drill wall
        p.push(part(box(34, 11, 3), stD, 0, 5.5, 24));
        for (let i = -1; i <= 1; i++) p.push(part(box(9, 12, 1.6), i ? 0x8a8f9c : gild, i * 12, 12, 24));
        p.push(part(box(3, 14, 3), woodR, -18, 7, 24));
        p.push(part(box(3, 14, 3), woodR, 18, 7, 24));
      } else if (br === 'raid') {                // the Outriders: a stable block and a rail
        p.push(part(box(30, 15, 14), woodR, 0, 7.5, 26));
        p.push(part(cyl(0.1, 18, 12, 4), stD, 0, 20, 26, Math.PI / 4));    // its low roof
        for (let i = -1; i <= 1; i += 2) p.push(part(box(2.4, 11, 2.4), woodR, i * 22, 5.5, 26));
        p.push(part(box(46, 2, 2), woodR, 0, 10, 26));                     // the tying rail
      } else if (br === 'archer') {              // the Butts: targets, and a fletcher's shed
        for (let i = -1; i <= 1; i += 2) {
          p.push(part(box(2.6, 16, 2.6), woodR, i * 15, 8, 27));
          p.push(part(cyl(6, 6, 1.4, 9), i > 0 ? gild : 0xd8d8dc, i * 15, 15, 27));   // a straw butt
          p.push(part(cyl(2.4, 2.4, 1.6, 7), 0xe0566a, i * 15, 15, 27.6));            // its mark
        }
        p.push(part(box(16, 10, 9), woodR, 0, 5, 28));                     // the fletcher's shed
      }
    } else if (bt === 'tower' || bt === 'watch') {
      /* a Watchtower GROWS with its level — the shaft lengthens and the crown widens, which
       * is what makes a level-3 gun read as one across the board */
      const sh = 44 + (lv - 1) * 9;
      p.push(part(cyl(10, 13, sh, 8), st, 0, sh / 2, 0));
      p.push(part(cyl(13, 11, 6, 8), stL, 0, sh + 3, 0));
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2;
        p.push(part(box(4, 5, 4), stD, Math.cos(a) * 11, sh + 9, Math.sin(a) * 11));
      }
      if (lv > 1) p.push(part(cyl(14, 14, 3, 8), gild, 0, sh - 8, 0));     // a corbel course
      if (lv > 2) {
        p.push(part(cyl(6, 7, 14, 6), st, 13, 10, 0));                     // a stair turret
        p.push(part(cone(7, 8, 6), gild, 13, 22, 0));
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
      /* THE GARRISON'S MARK. One shield hung on the crown per man inside — and since the men
       * themselves are not drawn while they are in there, this is the ONLY sign that ten
       * archers are in this tower rather than none. A filled tower shoots further and holds
       * ground the empty one beside it does not, and that has to be readable without tapping
       * it. Deliberately NOT a second tower model: the silhouette is the tower's identity, and
       * a garrison comes and goes.
       *
       * Hung round the crown at a fixed pitch rather than spread over the whole circle, so the
       * ring FILLS as the men arrive — spread evenly, three men and ten men both make a
       * complete ring and the count is the one thing the mark exists to show. Ten closes the
       * circle exactly at this shield width; the floor keeps a wider table from overlapping
       * them into an unreadable band. */
      for (let i = 0; i < gar; i++) {
        const a = i / Math.max(10, C.TOWER.berths) * Math.PI * 2;
        p.push(part(box(5, 6.5, 1.4), 0xffe9a8, Math.cos(a) * 13.5, sh + 2, Math.sin(a) * 13.5));
      }
    } else if (bt === 'siege') {
      if (lv > 1) p.push(part(box(50, 3, 36), gild, 0, 17, 0));           // a banded deck
      if (lv > 2) {
        p.push(part(box(8, 22, 8), 0x8a6c46, -20, 26, 8));                // a second gantry
        p.push(part(box(26, 3.5, 3.5), gild, -8, 38, 8));
      }
      /* a timber yard: a low shed, a stack of beams, and a half-built arm on trestles —
       * unmistakably a place where engines are made rather than another hall of men */
      p.push(part(box(44, 14, 30), woodR, 0, 7, 0));
      p.push(part(box(48, 3, 34), 0x4a3a26, 0, 15, 0));
      p.push(part(box(6, 20, 6), 0x8a6c46, -14, 25, -8));
      p.push(part(box(6, 20, 6), 0x8a6c46, 12, 25, -8));
      p.push(part(box(40, 4, 4), 0xa08050, -1, 36, -8));
      p.push(part(box(10, 10, 10), 0x6a6270, 16, 38, -8));
      for (let i = 0; i < 3; i++) p.push(part(cyl(2.4, 2.4, 26, 6), 0x7a5c3c, 16, 18 + i * 5, 12, Math.PI / 2));
      /* WHICH ENGINE THIS YARD BUILDS. A ram shed is a roofed cradle with a capped beam in it;
       * a gun pit is a bank of earth with a barrel over it and a rack of shot. */
      if (br === 'ram') {
        p.push(part(box(38, 5, 16), 0x4a3a26, -2, 20, 16));                // the cradle
        p.push(part(box(34, 6, 6), 0x8a6c46, -2, 26, 16));                 // a beam on it
        p.push(part(box(6, 8, 8), 0x9aa0aa, 17, 26, 16));                  // its iron cap
        p.push(part(box(40, 3, 20), woodR, -2, 33, 16));                   // the shed roof
      } else if (br === 'bombard') {
        p.push(part(box(34, 10, 16), 0x54452e, -2, 5, 18));                // the earth bank
        p.push(part(box(9, 7, 7), 0xb08a44, -12, 14, 18));                 // the breech
        p.push(part(box(9, 6.4, 6.4), 0x9a7a3a, -3, 17, 18));
        p.push(part(box(9, 5.8, 5.8), 0x9a7a3a, 6, 20, 18));               // the barrel, climbing
        for (let i = 0; i < 3; i++) p.push(part(sph(3.2), 0x3e3a44, 16 + (i % 2) * 6, 3, 12 + i * 5));  // shot
      }
    } else if (bt === 'spire') {
      /* the shaft rises and the light at its head swells — a Spire is read by its silhouette
       * against the sky more than any other work */
      const h = 58 + (lv - 1) * 12;
      p.push(part(cyl(4, 9, h, 7), 0x6a5a8a, 0, h / 2, 0));
      p.push(part(sph(5 + (lv - 1) * 1.6), 0xc48eff, 0, h + 4, 0));
      if (lv > 1) p.push(part(cyl(7, 7, 3, 7), gild, 0, h - 12, 0));      // a ring of workings
      if (lv > 2) {
        p.push(part(cyl(2.4, 3.4, 26, 6), 0x6a5a8a, 10, 13, 0));          // a lesser spire
        p.push(part(sph(3), 0xc48eff, 10, 28, 0));
      }
      /* WHICH ART THE SPIRE TURNED TO. The Warden's is pale and open — a ring of standing
       * lights around the foot; the Binding is hooked and dark, a cage of arms over a hollow.
       * The colours are the law's: the mending light is Chaos-green's kinder cousin, the
       * binding is the Trump's violet, and neither is gold or crimson, which are seats. */
      if (br === 'warden') {
        for (let i = 0; i < 5; i++) {
          const a = i / 5 * Math.PI * 2;
          p.push(part(cyl(1.4, 1.8, 16, 5), 0xd8d4e0, Math.cos(a) * 22, 8, Math.sin(a) * 22));
          p.push(part(sph(2.6), 0xa8f0c0, Math.cos(a) * 22, 18, Math.sin(a) * 22));
        }
        p.push(part(cyl(26, 26, 1.4, 12), 0xdcf0e0, 0, 1, 0));            // a pale floor-ring
      } else if (br === 'binder') {
        for (let i = 0; i < 4; i++) {
          const a = i / 4 * Math.PI * 2 + 0.4;
          p.push(part(cyl(1.6, 2.4, 26, 4), 0x2e2838, Math.cos(a) * 17, 13, Math.sin(a) * 17));
          p.push(part(box(7, 2.4, 2.4), 0x4a4258, Math.cos(a) * 12, 25, Math.sin(a) * 12));
        }
        p.push(part(cyl(15, 15, 1.2, 10), 0xc48eff, 0, 1, 0));            // the binding circle
        p.push(part(sph(4), 0x18101f, 0, 6, 0));                          // ...and its hollow
      }
    } else if (bt === 'shrine') {
      p.push(part(cyl(24, 27, 6, 10), stD, 0, 3, 0));
      p.push(part(cyl(20, 22, 4, 10), st, 0, 8, 0));
    } else if (bt === 'veiled') {
      p.push(part(sph(16), 0x241a2e, 0, 9, 0));
      p.push(part(sph(10), 0x18101f, 10, 6, 6));
    }
    /* a hurt work is scorched and shedding stone, and more of both as it goes — the fallen
     * courses lie at its foot, which is a change to the SILHOUETTE and so survives the zoom
     * this game is actually played at, where paint alone does not */
    if (hurt) rubble(p, hurt, bt === 'barracks' || bt === 'siege' ? 30 : 21);
    const m = meshOf(p);
    if (hurt) soot(m.geometry, hurt > 1 ? 0.44 : 0.2);
    return m;
  }
  /* A CURTAIN IS NOT A POINT. Every other work is a model dropped on a spot; a wall is a run
   * of stone between two ends, and it has to FOLLOW THE GROUND — a single long box laid over
   * a slope buries one end and floats the other. So it is built as a chain of short courses,
   * each set at its own ground height and turned along the line, and the whole chain merged
   * into one mesh. Offsets are relative to the stored midpoint, which is where the group
   * stands, so the group itself needs no rotation. */
  function wallModel(b, hurt) {
    const ax = b.x * 2 - b.x2, az = b.y * 2 - b.y2, bx = b.x2, bz = b.y2;
    const len = Math.hypot(bx - ax, bz - az) || 1;
    /* SHORT COURSES, so the run can bend with the hill under it. A course that spans more
     * ground than the ground is flat over cannot sit on it at both ends. */
    const n = Math.max(3, Math.round(len / 15));
    const ang = -Math.atan2(bz - az, bx - ax);
    /* a reinforced curtain is LITERALLY thicker: its level buys hit points and nothing else,
     * so the stone is the only place that can show */
    const lv = Math.max(1, Math.min(3, b.level || 1));
    const th = C.WALL.thick * (1.6 + (lv - 1) * 0.34);
    const base = groundH(b.x, b.y);
    const st = 0x877c90, stD = 0x4a4258, stL = 0xc6bdd0;
    const seg = len / n + 2;
    const wh = 26 + (lv - 1) * 3;
    /* the ground each course actually STANDS ON — not the point under its middle. A course is
     * a rigid box: put its foot at the height of its centre and the uphill half of it is
     * underground and the downhill half is in the air. So every course is measured across its
     * own footprint, in both directions, and then it is FOOTED at the lowest ground it covers
     * and CROWNED above the highest. That is also what a real curtain does on a slope: the
     * masonry steps, and the footing is buried, not the wall. */
    const ux = (bx - ax) / len, uz = (bz - az) / len;      // along the run
    const nx = -uz, nz = ux;                               // across it
    function ground(f0, f1) {
      let lo = Infinity, hi = -Infinity;
      for (let k = 0; k <= 4; k++) {
        const f = f0 + (f1 - f0) * (k / 4);
        const sx = ax + (bx - ax) * f, sz = az + (bz - az) * f;
        for (const o of [-th / 2, 0, th / 2]) {
          const g = groundH(sx + nx * o, sz + nz * o);
          if (g < lo) lo = g;
          if (g > hi) hi = g;
        }
      }
      return { lo, hi };
    }
    /* THE GATEWAY, at the middle of the run: the one way through, and the only reason an army
     * inside a curtain is not an army in a box. It is drawn as a break in the parapet with
     * piers either side, so you can see where your own columns will go.
     * A BREACHED wall is drawn as what it is — a broken line of stumps with the middle of it
     * gone — because a ruin that still looks like a wall is a lie about where you are safe. */
    /* ...but only on a run long enough to spare the stone for one. Below WALL.gateMin the
     * curtain is solid, and it has to LOOK solid or the player marches a column at a doorway
     * the sim does not have. */
    const gate = b.gated ? C.WALL.gate : 0;
    const broken = !!b.breach;
    const p = [];
    for (let i = 0; i < n; i++) {
      const f0 = i / n, f1 = (i + 1) / n, fc = (i + 0.5) / n;
      const px = ax + (bx - ax) * fc, pz = az + (bz - az) * fc;
      const ox = px - b.x, oz = pz - b.y;
      const atGate = Math.hypot(px - b.x, pz - b.y) < gate;
      const g = ground(f0, f1);
      /* footed below the lowest ground it spans, crowned a full wall above the highest */
      const foot = g.lo - base - 6;
      let top = g.hi - base + wh;
      if (atGate) top = g.hi - base + 5;                 // the gateway: a threshold, not a wall
      /* a ruin keeps its footing and loses its height, worst at the middle of the run */
      if (broken) top = g.hi - base + 4 + 6 * Math.abs(fc - 0.5) * 2;
      const hgt = Math.max(2, top - foot), mid2 = (top + foot) / 2;
      p.push(part(box(seg, hgt, th), broken ? stD : st, ox, mid2, oz, ang));
      if (atGate || broken) continue;                    // no parapet over a gate or a ruin
      p.push(part(box(seg, 3.5, th + 4), stL, ox, top + 1, oz, ang));       // the walkway coping
      /* merlons, every other course, so the top reads as a parapet and not a kerb.
       * A BATTERED CURTAIN LOSES ITS TEETH FIRST — a hurt run keeps half of them and a
       * ruinous one keeps none, which is the same line of stone read at a glance as a
       * gap-toothed one, and it is what tells you where the assault is landing. */
      const teeth = hurt > 1 ? 0 : hurt > 0 ? 4 : 2;
      if (teeth && i % teeth === 0) p.push(part(box(seg * 0.45, 7, th + 4), stD, ox, top + 6, oz, ang));
      /* ...and the fallen ones lie at the foot of it */
      if (hurt > 1 && i % 3 === 0)
        p.push(part(box(6, 4, 5), stD, ox + nx * (th * 0.9), foot + 4, oz + nz * (th * 0.9), ang + i));
    }
    /* the gate piers — two posts that say "through here", and a lintel when it is whole */
    if (!broken && gate) {
      const ux2 = (bx - ax) / len, uz2 = (bz - az) / len;
      for (const sgn of [-1, 1]) {
        const px = b.x + ux2 * gate * sgn, pz = b.y + uz2 * gate * sgn;
        const h = groundH(px, pz) - base;
        p.push(part(cyl(th * 0.5, th * 0.6, wh + 16, 6), stL, px - b.x, h + (wh + 16) / 2, pz - b.y));
      }
    }
    /* the ends are turned into short towers — that is what makes a run look built rather
     * than extruded, and it marks where the next wall may join. They are footed the same way:
     * a tower on a slope that is dropped at its centre height is half a tower. */
    for (const [ex, ez, f0, f1] of [[ax, az, 0, 1 / n], [bx, bz, 1 - 1 / n, 1]]) {
      const g = ground(f0, f1);
      const foot = Math.min(g.lo, groundH(ex, ez)) - base - 6;
      const top = Math.max(g.hi, groundH(ex, ez)) - base + 34;
      p.push(part(cyl(th * 0.62, th * 0.75, top - foot, 7), st, ex - b.x, (top + foot) / 2, ez - b.y));
      p.push(part(cyl(th * 0.75, th * 0.62, 5, 7), stL, ex - b.x, top + 2, ez - b.y));
    }
    const m = meshOf(p);
    if (hurt) soot(m.geometry, hurt > 1 ? 0.4 : 0.18);
    return m;
  }

  /* ---------------- THE DOORS IN THE GATEWAY ----------------
   * A curtain's gateway is the middle of the run, `WALL.gate` wide, punched out of the OWNER'S
   * nav layer alone — a rival reaching it finds it shut. On the board it was a hole: two piers
   * and a threshold, which reads as a wall somebody gave up on rather than as a gate that is
   * yours. Two timber leaves hang in it and they SWING — open while your own column is coming
   * through, shut the rest of the time. It is the only thing on the field that says out loud
   * whose door this is, and it says it without a label.
   *
   * THE ANGLE IS NOT IN THE MODEL KEY. `R.modelKey` is the only place that key is written and
   * the frame's cache key is built from it; a leaf angle in there would tear down and re-merge
   * every course of stone in the run on every frame the door moved. So the leaves are hung on
   * the finished group as children and driven from the wall's own row each frame, and the state
   * that has to outlive a rebuild (how far open it is, and the grace it is holding) lives out
   * here, keyed by the run's id.
   *
   * Only fields that CROSS THE WIRE are read — type, ends, owner, `gated`, `breach`, `raise`,
   * `flip` — so a guest hangs the same doors on the same runs the host does. */
  const gateState = new Map();       // wall id -> { a, open, hold, x, y }
  /* 1.25 rad, not a right angle: a leaf swung fully flat lies against the inner face of its own
   * curtain and is invisible from the side the camera is usually on, so "open" would read as
   * "the doors have vanished". At seventy degrees the gap is plainly clear and the leaves are
   * still angled where you can see them. */
  const GATE = { open: 1.25, speed: 4.2, grace: 0.8, near: C.WALL.gate + 18 };
  /* Which way they swing. `station` faces a run's parapet AWAY from the Seat it shelters and
   * `flip` is the heir's overrule of that guess; a gate opens onto the SHELTERED side, so it
   * swings against that normal. A leaf turned by +s swings toward -(-uz, ux) — see the
   * derivation at `gateLeaves` — so all this has to answer is which sign that is. */
  function gateSign(b, city) {
    const ax = b.x * 2 - b.x2, ay = b.y * 2 - b.y2;
    const ux = b.x2 - ax, uy = b.y2 - ay;
    /* THE FACE IS THE CURTAIN'S, not this run's. `b.face` is stamped by `noteWalls`, carried
     * run to run along a continuous wall so a curving curtain cannot flip its sheltered side
     * halfway along, and it rides the wire beside `flip`. The city test below is what this
     * used to do for every run and is now only the fallback — a run the sim has not stamped.
     * `face` +1 means (-uy, ux) is sheltered, which is exactly when this wanted to swing the
     * other way, so the two agree term for term. */
    let flipN = b.face != null ? b.face > 0
              : !!(city && (-uy) * (city.x - b.x) + ux * (city.y - b.y) > 0);
    if (b.flip) flipN = !flipN;
    return flipN ? -1 : 1;
  }
  /* The two leaves, hinged at the piers and meeting at the middle of the run. Each is a GROUP
   * whose origin is its hinge, so opening it is one `rotation.y` and no geometry moves.
   *
   * The group carrying the run has no rotation of its own (a course is turned by `part`), so a
   * leaf's closed angle is the run's own bearing: rotating local +X about Y by θ lands it on
   * world (cos θ, -sin θ), and the run's direction is (ux, uz), so θ = -atan2(uz, ux) = `ang`
   * — the same expression `wallModel` turns its courses by. The far leaf is that plus π. */
  function gateLeaves(b) {
    const ax = b.x * 2 - b.x2, az = b.y * 2 - b.y2, bx = b.x2, bz = b.y2;
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    const ang = -Math.atan2(bz - az, bx - ax);
    const lv = Math.max(1, Math.min(3, b.level || 1));
    const wh = 26 + (lv - 1) * 3;                       // the same wall height wallModel uses
    const th = C.WALL.thick * (1.6 + (lv - 1) * 0.34);
    const gate = C.WALL.gate;
    const base = groundH(b.x, b.y);
    const wood = 0x6b4a2e, woodD = 0x4a3220, iron = 0x8a8f9c;
    /* one leaf: hinge at the origin, boards running out along +X, standing on its own ground */
    const leaf = () => {
      const p = [];
      const h = wh + 4;
      for (let i = 0; i < 4; i++)                        // the boards
        p.push(part(box(gate * 0.24, h, th * 0.28), i % 2 ? wood : woodD,
                    gate * (0.13 + i * 0.25), h / 2, 0));
      p.push(part(box(gate, 2.6, th * 0.34), iron, gate / 2, h * 0.22, 0));    // two iron straps
      p.push(part(box(gate, 2.6, th * 0.34), iron, gate / 2, h * 0.78, 0));
      p.push(part(cyl(1.5, 1.8, h + 3, 5), iron, 0.6, (h + 3) / 2, 0));        // the hinge post
      p.push(part(sph(2.1), iron, gate * 0.94, h * 0.5, 0));                   // the ring
      return meshOf(p);
    };
    const grp = new THREE.Group();
    const mk = (sgn, rot) => {
      const px = b.x + ux * gate * sgn, pz = b.y + uz * gate * sgn;
      const g2 = new THREE.Group();
      g2.add(leaf());
      g2.position.set(px - b.x, groundH(px, pz) - base - 2, pz - b.y);
      g2.rotation.y = rot;
      grp.add(g2);
      return g2;
    };
    return { grp, la: mk(-1, ang), lb: mk(1, ang + Math.PI), ang, x: b.x, y: b.y };
  }
  /* THE SWING ITSELF, once a frame for every gateway on the board. The test is deliberately
   * cheap and deliberately renderer-side: the sim has no opinion about a door. Any man of the
   * run's OWN heir inside `GATE.near` of the gateway opens it; nobody for `GATE.grace` shuts it
   * again, so a column filing through does not make the doors flutter. A rival standing in the
   * gap is not his own heir and the doors stay shut in his face, which is exactly what the nav
   * layer already tells him. */
  function updateGates(view, dt) {
    const live = [];
    for (let pi = 0; pi < cityObjs.length; pi++)
      for (const [id, w] of cityObjs[pi].works) if (w.gate) live.push({ id, w, owner: pi });
    if (!live.length) { if (gateState.size) gateState.clear(); return; }
    const near2 = GATE.near * GATE.near;
    for (const L of live) {
      const gt = L.w.gate;
      let st = gateState.get(L.id);
      if (!st) { st = { a: 0, open: false, hold: 0 }; gateState.set(L.id, st); }
      st.x = gt.x; st.y = gt.y;
      let seen = false;
      for (const u of view.units) {
        /* A GARRISON DOES NOT HOLD THE DOOR OPEN. The gate swings for a man who is going
         * THROUGH it; the company posted to this very run is standing at its foot because the
         * wall is its post, and with them there the gate stood open for the whole match — which
         * is the opposite of what a guarded wall should look like. Reported from play. */
        if (u.owner !== L.owner || u.in || u.post === L.id) continue;
        const dx = u.x - gt.x, dy = u.y - gt.y;
        if (dx * dx + dy * dy <= near2) { seen = true; break; }
      }
      st.hold = seen ? GATE.grace : Math.max(0, st.hold - dt);
      st.open = seen || st.hold > 0;
      const want = st.open ? GATE.open : 0;
      st.a += (want - st.a) * Math.min(1, dt * GATE.speed);
      if (Math.abs(want - st.a) < 0.004) st.a = want;
      /* the sheltered face is re-asked every frame: `flip` is a command, and a run turned
       * about must not keep opening its doors into the assault */
      const sgn = gt.row ? gateSign(gt.row, gt.city) : 1;
      gt.la.rotation.y = gt.ang + sgn * st.a;
      gt.lb.rotation.y = gt.ang + Math.PI - sgn * st.a;
      st.ang = gt.ang; st.sign = sgn;
      st.la = gt.la.rotation.y; st.lb = gt.lb.rotation.y;
    }
    if (gateState.size > live.length) {
      const alive = new Set(live.map((L) => L.id));
      for (const id of [...gateState.keys()]) if (!alive.has(id)) gateState.delete(id);
    }
  }
  /* test handle: the gateway as the board currently has it — how far open its leaves are
   * swung, and whether anything is holding them. A leaf is a child of a merged group with no
   * object of its own to interrogate from outside, so without this "the door opens for its
   * own and not for a rival" is unprovable. */
  /* `sign`, `la` and `lb` are the WAY it swings — a gate opens onto the sheltered face, which
   * `{c:'flip'}` may turn about, and an angle alone cannot tell the two apart. */
  R.debugGate = (id) => {
    const s = gateState.get(id);
    return s ? { angle: s.a, open: !!s.open, x: s.x, y: s.y,
                 sign: s.sign, ang: s.ang, la: s.la, lb: s.lb } : null;
  };
  R.debugGates = () => [...gateState.keys()];

  /* A VETERAN LOOKS LIKE ONE. The hall's level rides on the man (u.tier), and it has to be
   * legible at the zoom this game is actually played at — where a soldier is a few pixels —
   * so rank is carried by SILHOUETTE and not by shading: a crest that breaks the head's
   * outline, a heavier build, and a standard on the elite. Tier 1 is exactly what it always
   * was, so nothing about the ordinary army moved. */
  function unitGeo(kind, tier) {
    const p = [];
    const t = Math.max(1, Math.min(3, tier || 1));
    /* the metal brightens with rank, but the brightening alone would be invisible at a
     * hundred paces — it is there to sell the silhouette, not to carry it */
    const crest = t === 3 ? 0xffe08a : 0xd8e0ff;
    if (kind === 'soldier') {
      const w = 1 + (t - 1) * 0.14;                       // a veteran is a heavier man
      p.push(part(cyl(3.2 * w, 4.2 * w, 12, 6), t > 1 ? 0xc9c9d2 : 0xbbbbbb, 0, 8, 0));
      p.push(part(sph(3.4), 0xdddddd, 0, 17, 0));
      p.push(part(cyl(0.7, 0.7, 20, 4), 0xeeeeee, 5, 12, 0));
      p.push(part(cyl(3.4 * w, 3.4 * w, 1.4, 7), 0x999999, -5.4, 10, 0, 0));
      /* the crest: a blade of colour across the helm, which is the one thing that still
       * reads when the man is four pixels tall */
      if (t > 1) p.push(part(box(1.6, 4.5, 7.5), crest, 0, 21, 0));
      if (t > 2) {
        p.push(part(cyl(0.5, 0.5, 16, 4), 0xd8c8a8, -5, 18, 0));    // a standard on his back
        p.push(part(box(6, 4, 0.5), crest, -8, 25, 0));
      }
    } else if (kind === 'sorcerer') {
      p.push(part(cone(4.6, 15, 6), t > 1 ? 0xb9b4c6 : 0xaaaaaa, 0, 7.5, 0));
      p.push(part(sph(2.9), 0xcccccc, 0, 16, 0));
      p.push(part(cyl(0.7, 0.7, 22, 4), 0xdddddd, 5, 12, 0));
      p.push(part(sph(1.8 + (t - 1) * 0.7), 0xffffff, 5, 23.5, 0));  // a fuller light
      if (t > 1) p.push(part(cone(1.6, 5, 5), crest, 0, 21, 0));     // a spike on the hood
      if (t > 2) {
        p.push(part(sph(1.3), crest, -4.5, 20, 0));
        p.push(part(sph(1.1), crest, 3.5, 27, 0));                   // motes at his shoulder
      }
    } else if (kind === 'shieldman') {
      /* A WALL OF MEN. He is read by his width and by the slab he carries: at the zoom this is
       * played at, a shieldman must be a different SHAPE from a soldier, not a soldier with a
       * bigger number. Squat, broad, and a shield taller than his head. */
      const w = 1.25 + (t - 1) * 0.12;
      p.push(part(cyl(4.0 * w, 5.0 * w, 12, 6), t > 1 ? 0xb8bcc8 : 0xa8acb4, 0, 8, 0));
      p.push(part(sph(3.6), 0xd8d8dc, 0, 17, 0));
      p.push(part(box(1.6, 17, 11), t > 2 ? 0xd8c078 : 0x8a8f9c, 6.5, 11, 0));   // the shield
      p.push(part(box(1.2, 3, 9), crest, 7.3, 11, 0));                            // its boss-line
      p.push(part(cyl(0.7, 0.7, 14, 4), 0xeeeeee, -5, 12, 0));                    // a short spear
      if (t > 1) p.push(part(box(1.6, 3.5, 8), crest, 0, 21, 0));
      if (t > 2) p.push(part(cyl(4.2 * w, 4.2 * w, 1.6, 7), 0xd8c078, 0, 10, 0));
    } else if (kind === 'outrider') {
      /* LEANING FORWARD. Everything about him says speed: a thin body pitched off vertical, a
       * long trailing cloak, and no shield at all. */
      p.push(part(cyl(2.4, 3.0, 13, 5), t > 1 ? 0xc4b898 : 0xb0a888, 0, 8, 0));
      p.push(part(sph(2.9), 0xd8d0b8, 1.5, 16.5, 0));
      p.push(part(cone(4.5, 12, 5), 0x6a5a3a, -3, 9, 0));            // the cloak, streaming back
      p.push(part(cyl(0.6, 0.6, 17, 4), 0xdddddd, 4.5, 11, 0));       // a light lance
      if (t > 1) p.push(part(cone(1.4, 4.5, 5), crest, 1.5, 20, 0));
      if (t > 2) p.push(part(box(5, 3, 0.5), crest, -6, 20, 0));
    } else if (kind === 'archer') {
      /* THE BOW IS THE WHOLE SILHOUETTE — a tall arc across the body, which nothing else on
       * the board has, plus the quiver behind the shoulder. */
      p.push(part(cyl(2.8, 3.6, 12, 5), t > 1 ? 0x9aa88c : 0x8a9880, 0, 8, 0));
      p.push(part(sph(3.0), 0xc8ccc0, 0, 16.5, 0));
      p.push(part(cyl(0.55, 0.55, 20, 4), 0xc8b088, 4.5, 12, 0.5));   // the bow stave
      p.push(part(cyl(0.3, 0.3, 19, 3), 0xeeeeee, 5.4, 12, 0.5));      // its string
      p.push(part(box(2, 8, 2), 0x6a5230, -4.5, 14, 0));               // the quiver
      if (t > 1) p.push(part(box(1.4, 4, 6.5), crest, 0, 20.5, 0));
      if (t > 2) p.push(part(cyl(0.5, 0.5, 7, 4), crest, -4.5, 20, 0));
    } else if (kind === 'warden') {
      /* PALE, AND CARRYING A LIGHT. The cross of light over the staff is the read: it is the
       * one unit on the board whose business is not killing, and it must not look like a
       * sorcerer with a different hat. */
      p.push(part(cone(4.2, 15, 6), 0xe8e4ee, 0, 7.5, 0));
      p.push(part(sph(2.9), 0xf0eef6, 0, 16, 0));
      p.push(part(cyl(0.7, 0.7, 24, 4), 0xd8d0c0, 5, 13, 0));          // the staff
      p.push(part(box(1.6, 7, 1.6), 0xdcf0e0, 5, 26, 0));              // ...and its cross,
      p.push(part(box(6, 1.6, 1.6), 0xdcf0e0, 5, 24.5, 0));            //    a pale green light
      if (t > 1) p.push(part(sph(1.5 + (t - 1) * 0.5), 0xa8f0c0, 5, 29, 0));
      if (t > 2) { p.push(part(sph(1.1), 0xa8f0c0, -4, 20, 0)); p.push(part(sph(1.0), 0xa8f0c0, 3, 28, 2)); }
    } else if (kind === 'binder') {
      /* HOOKED AND DARK, and carrying a ring rather than a blade — the thing he throws is a
       * loop of Shadow, so the loop is the silhouette. */
      p.push(part(cone(4.4, 14, 6), 0x4a4258, 0, 7, 0));
      p.push(part(sph(2.8), 0x6a6078, 0, 15.5, 0));
      p.push(part(cone(2.4, 7, 5), 0x2e2838, 0, 19, 0));               // a deep hood
      p.push(part(cyl(0.7, 0.7, 20, 4), 0x8a7ca8, 5, 12, 0));          // a crooked rod
      p.push(part(cyl(4.5, 4.5, 0.7, 9), 0xc48eff, 5, 23, 0));         // the binding ring
      if (t > 1) p.push(part(cyl(3.0, 3.0, 0.6, 8), 0xc48eff, 5, 26, 0));
      if (t > 2) p.push(part(sph(1.4), 0xc48eff, -4.5, 19, 0));
    } else if (kind === 'ram') {
      /* A SHED ON ROLLERS with a great capped beam slung under it. Low, long and roofed —
       * nothing else on the board has a roof, which is what tells it from an Engine. */
      p.push(part(box(20, 4, 11), 0x5a4630, 0, 3, 0));                 // the sledge
      p.push(part(cyl(3.4, 3.4, 3, 8), 0x3e3222, -6, 3, 0));
      p.push(part(cyl(3.4, 3.4, 3, 8), 0x3e3222, 6, 3, 0));
      /* the beam lies ALONG the sledge — `part` only yaws, so a long box is the horizontal
       * timber a cylinder cannot be here */
      p.push(part(box(24, 4.4, 4.4), 0x8a6c46, 0, 10, 0));             // the beam
      p.push(part(box(5, 5.6, 5.6), 0x9aa0aa, 13, 10, 0));             // its iron cap
      p.push(part(box(21, 2.4, 13), 0x6b5236, 0, 17, 0));              // the roof
      p.push(part(box(1.8, 8, 1.8), 0x4a3a26, -8, 13, 0));
      p.push(part(box(1.8, 8, 1.8), 0x4a3a26, 8, 13, 0));
      if (t > 1) p.push(part(box(21, 1.4, 13.6), crest, 0, 19, 0));    // banded, plated
      if (t > 2) { p.push(part(cyl(3.0, 3.0, 2.6, 8), 0x3e3222, 0, 3, 5)); p.push(part(box(5, 4, 0.5), crest, 0, 22, 0)); }
    } else if (kind === 'bombard') {
      /* THE BARREL IS THE UNIT. Pitched up at the sky on a squat carriage, which reads as
       * 'this shoots further than you' from any zoom — and it is the same shadow-rouge trick
       * the Cannon Tower runs, so it wears the same warm brass. */
      p.push(part(box(13, 5, 11), 0x5a4a3a, 0, 4, 0));
      p.push(part(cyl(3.4, 3.4, 3, 8), 0x3e3222, -3.5, 3, 0));
      p.push(part(cyl(3.4, 3.4, 3, 8), 0x3e3222, 3.5, 3, 0));
      p.push(part(box(7, 7, 7), 0x6b5236, -3, 9, 0));                  // the bed
      /* THE BARREL CLIMBS. `part` yaws and cannot pitch, so the elevation is built as three
       * stepped blocks rather than one tilted tube — at this zoom the staircase reads as a
       * gun pointed at the sky, which is the whole silhouette. */
      p.push(part(box(7, 5.5, 5.5), 0x9a7a3a, 0, 12, 0));
      p.push(part(box(7, 5.0, 5.0), 0x9a7a3a, 6, 15, 0));
      p.push(part(box(6, 4.5, 4.5), 0x9a7a3a, 11.5, 18, 0));           // the muzzle, highest
      p.push(part(box(5.5, 6.5, 6.5), 0xb08a44, -5, 11, 0));           // its breech
      if (t > 1) p.push(part(box(1.6, 5.4, 5.4), crest, 14, 18.5, 0)); // a heavier muzzle band
      if (t > 2) { p.push(part(box(9, 1.6, 9), crest, -3, 13, 0)); p.push(part(sph(2.2), 0xb08a44, -8, 12, 0)); }
    } else if (kind === 'champion') {
      /* AN AMBERITE, NOT A BIGGER SOLDIER. He was a recruit at 1.25 scale with a red comb,
       * which at the zoom this is played at is a soldier you squint at. He is built to be
       * told apart at a glance instead: a long cloak that breaks the upright silhouette every
       * other unit has, a two-handed blade held high, and the Trump's own violet — a colour
       * no company standard can take — burning over his head. */
      p.push(part(cyl(3.4, 4.6, 18, 6), 0xdcd4e8, 0, 11, 0));            // the man
      p.push(part(sph(4.0), 0xefeaf6, 0, 23, 0));
      p.push(part(cone(7.5, 20, 7), 0x6a4a9a, 0, 12, -2.5));             // the cloak, falling wide
      p.push(part(box(9, 3, 9), 0x8a6ac0, 0, 22, -2));                   // its clasp at the shoulder
      p.push(part(box(1.8, 26, 3.2), 0xf2f0ff, 7, 20, 0));               // a great blade, raised
      p.push(part(box(6, 2.4, 4), 0xc48eff, 7, 9, 0));                    // its guard
      p.push(part(sph(2.6), 0xc48eff, 0, 33, 0));                        // the Trump's light
      p.push(part(cyl(5.5, 5.5, 0.8, 8), 0xc48eff, 0, 35.5, 0));         // ...and its ring
    } else if (kind === 'engine') {
      /* a trebuchet on a cart: a low hull, rollers either side, a mast and a throwing arm
       * with the counterweight hauled back. Squat and wide, so a siege train reads as one
       * even at the far zoom, where a soldier is four pixels. */
      p.push(part(box(15, 5, 10), 0x6b5236, 0, 4, 0));
      p.push(part(cyl(3.6, 3.6, 3, 8), 0x4a3a26, -4, 3, 0));
      p.push(part(cyl(3.6, 3.6, 3, 8), 0x4a3a26, 4, 3, 0));
      p.push(part(box(2.2, 15, 2.2), 0x8a6c46, 0, 13, 0));
      p.push(part(box(13, 2, 2), 0xa08050, -2, 19, 0));
      p.push(part(box(5 + (t - 1) * 1.4, 5 + (t - 1) * 1.4, 5), 0xa8a8b0, -7.5, 17, 0));
      /* a heavier engine: a bigger stone, banded timbers, and a second pair of rollers */
      if (t > 1) {
        p.push(part(box(15, 1.6, 10.6), crest, 0, 7, 0));
        p.push(part(cyl(3.2, 3.2, 2.6, 8), 0x4a3a26, 0, 3, 4.5));
      }
      if (t > 2) {
        p.push(part(box(2.2, 11, 2.2), 0x8a6c46, 0, 13, 4.5));
        p.push(part(box(4, 4, 0.5), crest, 6, 22, 0));
      }
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
    /* THE DISTANCE FOG WAS TAXING THE PLAYABLE ZOOM RANGE, not just the horizon. Linear fog
     * is a function of camera distance, and at 1150 it started biting inside the range the
     * player actually uses: lit ground measured 20 at zoom 0.80 against 30 at 1.30 and 29 at
     * 2.60 — pulling out to see the board cost a THIRD of the light, which reads as the game
     * dimming when you need to look at it. Pushed out to 2000/4600 the world still dissolves
     * into Shadow at its true rim and the brightness stops depending on the zoom. */
    scene.fog = new THREE.Fog(0x120d1a, 2000, 4600);
    /* and the whole picture lifted about a quarter. Reported from play as simply too dark,
     * and the measurements agree: sighted ground sat at 29 of 255. 36 across every zoom. */
    const hemi = new THREE.HemisphereLight(0xa8a2d8, 0x5a4830, 2.15);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffe8c0, 2.5);
    sun.position.set(-420, 760, 380);
    scene.add(sun);
    /* test handle: the three things that decide how bright the world is. A rig asking "why is
     * it dark — the fog, the lights, or the palette?" has to be able to switch each off and
     * measure, and every other answer to that question is a guess. */
    R.debugScene = () => ({ scene, hemi, sun, renderer });
    /* far plane has to clear the whole board from the furthest zoom, or the world clips
     * to black at the edges when you pull out */
    cam = new THREE.PerspectiveCamera(55, 1, 10, 9000);
    rig = new THREE.Group();
    aimCam(C.VIEW_W);
    rig.add(cam);
    scene.add(rig);
    worldG = new THREE.Group();
    scene.add(worldG);
    underM = new THREE.Mesh(new THREE.PlaneGeometry(mapW * 3, mapH * 3.75).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x0b0912 }));
    underM.position.set(mapW / 2, -5, mapH / 2);
    scene.add(underM);
    MAT = fogPatch(new THREE.MeshLambertMaterial({ vertexColors: true }));
    MATB = fogPatch(new THREE.MeshBasicMaterial({ vertexColors: true }));
    overlay = document.getElementById('overlay');
    octx = overlay.getContext('2d');
    stormState = [];
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
    /* THE FLOOR SCALES WITH THE LAND. `VIEW.min` was set so the furthest zoom shows a
     * board's worth of ground; on a country that same floor shows a postage stamp of it, so
     * the floor drops with the world's width — exactly today's floor on a default board, and
     * a strategic pull-back on anything wider. The far plane already grew with the land
     * (buildWorld), and the distance fog stretches below only past today's deepest zoom, so
     * every duel frame is untouched to the pixel. */
    const zmin = C.VIEW.min * Math.min(1, C.MAP.W / mapW);
    R.zoom = Math.max(zmin, Math.min(C.VIEW.max, R.zoom || 1));
    scale = W * R.zoom / C.VIEW_W;
    viewW = W / scale; viewH = H / scale;
    if (cam) aimCam(viewW);
    if (scene && scene.fog) {
      const f = Math.max(1, viewW / (C.VIEW_W / C.VIEW.min));
      scene.fog.near = 2000 * f;
      scene.fog.far = 4600 * f;
    }
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
  /* THE CAMERA CANNOT BE AIMED AT A WORLD THE RENDERER HAS NOT BEEN GIVEN. `clampCam` holds
   * the view inside `mapW`/`mapH`, and those are learned in `buildWorld` — which runs on the
   * first FRAME, after game.js has already called `homeCamera()`. So every aim taken before
   * that first frame was clamped into the extents of the PREVIOUS world. Board to board this
   * is invisible (same rectangle); walking into a country it is the whole bug: measured, an
   * heir whose court stands at (7670, 9030) on an 8000x9600 land opened looking at (1950,
   * 2446) — the middle of a 2000x2400 BOARD, 8,721 units from anything of his. On the host
   * that reads as a war you have to go looking for your own capital in; on a LAN guest, who
   * has no council to fall back on, it reads as an empty blue world, which is how it was
   * reported. So the aim is REMEMBERED and replayed once the extents are real. */
  R.lookAt = function (wx, wy) {
    /* the rig origin IS what the camera centres on, and the rig sits at camY + 0.62*viewH */
    R._homed = true;
    R._aim = { x: wx, y: wy };
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
  R.maxCamX = () => Math.max(0, mapW - viewW);
  R.maxCamY = () => Math.max(0, mapH - viewH);
  R.pan = function (dpx, dpy) {
    R.camX -= (dpx || 0) / scale;
    R.camY -= (dpy || 0) / scale;
    R.clampCam();
  };
  /* the minimap is a true rectangle of the world, and scrubbing it moves both axes */
  /* A corner map, and a SMALL one. Sized off the map's aspect it grew to half the screen
   * width on a squarer world and started swallowing taps meant for the ground under it. */
  const MINI = () => {
    const mw = Math.min(W * 0.26, 120), mh = Math.min(H * 0.30, mw * (mapH / mapW));
    /* the walkers' board owns the top-right corner when anyone is on the Pattern; the map
     * slides under it rather than through it */
    return { mw, mh, mx: W - mw - 6, my: Math.max(62, R.miniTop || 0) };
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
        const cx = Math.max(0, Math.min(mapW, w2.x)), cy = Math.max(0, Math.min(mapH, w2.y));
        hits++;
        if (cx < x0) x0 = cx;
        if (cy < y0) y0 = cy;
        if (cx > x1) x1 = cx;
        if (cy > y1) y1 = cy;
      }
    }
    if (hits < 4) { x0 = R.camX; y0 = R.camY; x1 = R.camX + viewW; y1 = R.camY + viewH; }
    return { x0: Math.max(0, x0), y0: Math.max(0, y0),
             x1: Math.min(mapW, x1), y1: Math.min(mapH, y1) };
  };
  R.hitMinimap = (px, py) => {
    const m = MINI();
    return px >= m.mx - 4 && px <= m.mx + m.mw + 4 && py >= m.my - 4 && py <= m.my + m.mh + 4;
  };
  R.minimapJump = function (px, py) {
    const m = MINI();
    R.camX = ((px - m.mx) / m.mw) * mapW - viewW / 2;
    R.camY = ((py - m.my) / m.mh) * mapH - viewH * 0.62;
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
    return { x: mapW / 2, y: mapH / 2 };
  };
  /* the id of the viewer's own work under the finger, or -1 */
  /* `out`, if given, receives `d` — the squared distance from the finger to whatever was hit.
   * The caller needs it to arbitrate between a work and a man standing on the same spot; the
   * return value is unchanged, so everything that only asks "did I hit one" is untouched. */
  R.hitBuilding = function (px, py, out) {
    if (out) out.d = Infinity;
    if (!curView) return -1;
    const w2 = R.toWorld(px, py);
    /* A RUN IS THE LAST THING A TAP MEANS. A curtain answers along its WHOLE length — judging
     * it by its midpoint made a long wall untappable everywhere except the middle — but that
     * makes it the widest target on the board, and a tower built INTO it sits at distance
     * zero from it. Ranked together, the wall won every time and the bastion could not be
     * opened at all: no upgrade, no branch, no way to see what it was. So the two are ranked
     * SEPARATELY and a work with a place beats a work with a length, exactly as the army's
     * targeting does. */
    let best = -1, bd = 38 * 38, wall = -1, wdd = 38 * 38;
    /* THE HAND'S WORKS, not the viewer's — the sheet this opens spends the HAND's purse and
     * game.js looks the id up in the hand's own list, so asking the viewer here meant that
     * while driving a sworn lord every tap on one of his works returned an id his liege did
     * not own and fell through to bare ground, and every tap on the liege's own works returned
     * one the hand could not open. `hitUnit` has always asked the hand; this was the one place
     * in the renderer that did not. */
    for (const b of curView.players[handOf(curViewer)].buildings) {
      if (b.x2 != null) {
        const ax = b.x * 2 - b.x2, ay = b.y * 2 - b.y2;
        const vx = b.x2 - ax, vy = b.y2 - ay, L2 = vx * vx + vy * vy || 1;
        let t = ((w2.x - ax) * vx + (w2.y - ay) * vy) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = ax + vx * t, qy = ay + vy * t;
        const dd = (w2.x - qx) * (w2.x - qx) + (w2.y - qy) * (w2.y - qy);
        if (dd < wdd) { wdd = dd; wall = b.id; }
      } else {
        /* a tower on the parapet is DRAWN twenty-seven up, so the ground under the finger is
         * behind where it looks — the same pitched-camera offset the wall snap allows for */
        const r = b.onWall ? 52 * 52 : 38 * 38;
        const dd = (w2.x - b.x) * (w2.x - b.x) + (w2.y - b.y) * (w2.y - b.y);
        if (dd < r && dd < bd) { bd = dd; best = b.id; }
      }
    }
    if (out) out.d = best >= 0 ? bd : wdd;
    return best >= 0 ? best : wall;
  };
  /* the COMPANY of the viewer's own man under the finger, or 0. Men are small and they move,
   * so the reach is generous — but it only ever answers with your own, and only when the tap
   * is closer to a man than to anything else the caller will try next. */
  R.hitUnit = function (px, py, viewer, out) {
    if (out) out.d = Infinity;
    if (!curView) return 0;
    const w2 = R.toWorld(px, py);
    /* a tight reach on purpose: this competes with the tap that opens a BUILD SHEET on bare
     * ground, and a generous radius means an army standing in your court quietly stops you
     * building there. Point at a man and you get his standard; point beside him and you get
     * the ground. */
    let best = 0, bd = 24 * 24;
    const h = handOf(viewer);
    for (const u of curView.units) {
      /* the HAND'S men: tapping a company arms it, and a company you cannot order is not one
       * you can arm — a vassal's men answer only while you are driving that vassal */
      if (u.owner !== h || !u.co) continue;
      const dd = (w2.x - u.x) * (w2.x - u.x) + (w2.y - u.y) * (w2.y - u.y);
      if (dd < bd) { bd = dd; best = u.co; }
    }
    if (out && best) out.d = bd;
    return best;
  };
  /* A WORK OF SOMEBODY ELSE'S UNDER THE FINGER — for the order that names one. `hitBuilding`
   * answers for the HAND'S works and must go on doing so (it is what opens the sheet); this is
   * the other question, and it can only ever return something the veil has already handed over,
   * because it walks the VIEW. Ghosts are deliberately not offered: an order to bring down a
   * work you merely remember is an order to walk to where it used to be. */
  R.hitFoeWork = function (px, py, view, viewer) {
    if (!view || !view.players) return null;
    const w2 = R.toWorld(px, py);
    let best = null, bd = 44 * 44;
    for (let pi = 0; pi < view.players.length; pi++) {
      if (mineOf(view, viewer, pi)) continue;
      for (const b of (view.players[pi].buildings || [])) {
        /* a run answers along its whole length, exactly as your own does */
        let dd;
        if (b.x2 != null) {
          const ax = b.x * 2 - b.x2, ay = b.y * 2 - b.y2;
          const vx = b.x2 - ax, vy = b.y2 - ay, L2 = vx * vx + vy * vy || 1;
          let t2 = ((w2.x - ax) * vx + (w2.y - ay) * vy) / L2;
          t2 = t2 < 0 ? 0 : t2 > 1 ? 1 : t2;
          const qx = ax + vx * t2, qy = ay + vy * t2;
          dd = (w2.x - qx) * (w2.x - qx) + (w2.y - qy) * (w2.y - qy);
        } else dd = (w2.x - b.x) * (w2.x - b.x) + (w2.y - b.y) * (w2.y - b.y);
        if (dd < bd) { bd = dd; best = { pi, id: b.id, x: b.x, y: b.y }; }
      }
    }
    return best;
  };
  /* ONE ANSWER TO "WHAT SITE IS UNDER THIS TAP", and the same one for every caller. A flag
   * used to take the WHOLE COURT — `CITY.r + 20`, a circle 2.7 times the radius every other
   * site answers in — so a standard planted anywhere inside a city circle silently relocated
   * itself to the middle of the court instead of going where the finger was. Reported from
   * play as tapping inside a city circle behaving differently, and it is: a rule that moves
   * your order without saying so is worse than no rule, and the naming it bought fed a banner
   * that no longer exists (a rally is silent — see the banner rule). A site now answers for
   * its own ground, a Seat for the tower's, and a tap that is on neither is the ground it is
   * on, everywhere on the map alike. */
  R.hitSite = function (px, py, view, viewer) {
    const w2 = R.toWorld(px, py);
    let best = -1, bd = Infinity;
    for (const s of view.map.sites) {
      const r2 = s.kind === 'city' ? C.CITY.seatR : 62;
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

  /* ---------------- the veil's cell corners, projected ONCE a frame ----------------
   * THE BUG THIS REPLACED, because it is not obvious from the code that was here. Every veil
   * pass turned a cell mask into ground-hugging polygons, and a horizontal RUN of visible
   * cells was ONE quad with four corner height samples. A run is often thirty cells — near
   * eight hundred world units of rolling ground — so its far edge was a straight chord across
   * terrain that is not straight. The row beyond it drew its near edge as a DIFFERENT chord,
   * because its run began and ended at different cells, and two chords across the same curve
   * part in the middle. A lens of unpainted ground opened between every pair of rows: the
   * veil "lifted in steps" instead of continuously. Worse, the rim pass kept a byte-identical
   * copy of the same loop, so it outlined every one of those bars — laying gold lines across
   * open country and straight over the Seat.
   * The fix is to subdivide each run's long edges at EVERY cell boundary and read the corners
   * from one shared table, so neighbouring rows trace identical points and there is nothing
   * left to gap. Projecting once also keeps `proj`'s per-call object out of a loop that now
   * touches a couple of thousand corners a frame. */
  let cgx = new Float32Array(0), cgy = new Float32Array(0), cgok = new Uint8Array(0);
  const cgw = { x0: 0, y0: 0, x1: 0, y1: 0, nx: 0, ny: 0, cell: 0 };
  function cornerGrid(cw, gwMax, ghMax) {
    if (!(cw > 0) || gwMax < 1 || ghMax < 1) return null;
    const vr = R.viewRect();
    const x0 = Math.max(0, (vr.x0 / cw | 0) - 1), x1 = Math.min(gwMax - 1, (vr.x1 / cw | 0) + 1);
    const y0 = Math.max(0, (vr.y0 / cw | 0) - 1), y1 = Math.min(ghMax - 1, (vr.y1 / cw | 0) + 1);
    if (x1 < x0 || y1 < y0) return null;
    const nx = x1 - x0 + 2, ny = y1 - y0 + 2;   // one more corner than cell, each way
    const n = nx * ny;
    if (cgx.length < n) { cgx = new Float32Array(n); cgy = new Float32Array(n); cgok = new Uint8Array(n); }
    for (let j = 0; j < ny; j++) {
      const wy = (y0 + j) * cw;
      for (let i = 0; i < nx; i++) {
        const wx = (x0 + i) * cw, k = j * nx + i;
        pv.set(wx, groundH(wx, wy) + 1, wy).project(cam);
        cgx[k] = (pv.x * 0.5 + 0.5) * W;
        cgy[k] = (-pv.y * 0.5 + 0.5) * H;
        cgok[k] = (pv.z < 1 && pv.z > -1) ? 1 : 0;
      }
    }
    cgw.x0 = x0; cgw.y0 = y0; cgw.x1 = x1; cgw.y1 = y1; cgw.nx = nx; cgw.ny = ny; cgw.cell = cw;
    return cgw;
  }
  /* one subpath per run of cells above `thr`, both long edges walked cell by cell. Caller sets
   * the fill and calls fill() — ONE path and ONE fill for the whole mask, so where two rows
   * meet the shared edge is interior and composes once, not twice. */
  function maskPath(ctx, cg, gw, gh, bits, thr) {
    const nx = cg.nx, bx0 = cg.x0;
    ctx.beginPath();
    const gy1 = Math.min(cg.y1, gh - 1), gx1 = Math.min(cg.x1, gw - 1);
    for (let gy = cg.y0; gy <= gy1; gy++) {
      const jn = (gy - cg.y0) * nx, jf = jn + nx;   // near row of corners, far row
      let run = -1;
      for (let gx = cg.x0; gx <= gx1 + 1; gx++) {
        const on = gx <= gx1 && bits[gy * gw + gx] > thr;
        if (on && run < 0) run = gx;
        else if (!on && run >= 0) {
          let ok = true;
          for (let x = run; x <= gx && ok; x++) {
            const i = x - bx0;
            if (!cgok[jn + i] || !cgok[jf + i]) ok = false;
          }
          if (ok) {
            let k = jn + (run - bx0);
            ctx.moveTo(cgx[k], cgy[k]);
            for (let x = run + 1; x <= gx; x++) { k = jn + (x - bx0); ctx.lineTo(cgx[k], cgy[k]); }
            for (let x = gx; x >= run; x--) { k = jf + (x - bx0); ctx.lineTo(cgx[k], cgy[k]); }
            ctx.closePath();
          }
          run = -1;
        }
      }
    }
  }
  R.debugVeilPath = maskPath;

  /* ---------------- EXPERIMENT: the veil sampled in the shader (TODO #61) ----------------
   * Behind `R.shaderFog`, OFF by default, so the two can be judged from the same world.
   * The overlay draws a WORLD-SPACE field as SCREEN-SPACE polygons and every artifact this
   * session chased came from that gap. Here the same eased field — the very arrays the
   * overlay bands — is uploaded as a small texture (one texel per fog cell, about 77x93) and
   * sampled by world XZ in the materials that were being darkened anyway. No polygons, so no
   * chord divergence; bilinear filtering is the smoothing, done by hardware in a fetch it was
   * making regardless; and fog can be DRAINED of colour rather than merely tinted, which is
   * the thing a 2D canvas over a WebGL canvas simply cannot reach.
   * R = what the viewer sees now, G = what he has ever seen. fog = G - R, shroud = 1 - G. */
  /* uFogSpan must be a real Vector2 from the START: the uniform is uploaded whenever the
   * material compiles, long before the first fogUpload, and Three reads .x off it — a null
   * here throws on the very first frame whether the experiment is switched on or not. */
  const FOGU = { uFogTex: { value: null }, uFogSpan: { value: new THREE.Vector2(1, 1) }, uFogOn: { value: 0 },
    /* diagnostic output, switchable WITHOUT a rebuild: comparing two separate runs and
     * assuming they are the same frame has misled this investigation twice. 1 = show the
     * mask as (shroud, fog, sight) so the real colour and the reason for it can be read off
     * the SAME world in the SAME session. */
    uFogDbg: { value: 0 },
    /* the clock the water ripples on. One uniform, shared, advanced with T in the frame loop
     * — a pool that animates by rebuilding geometry would cost a draw call per ring. */
    uTime: { value: 0 } };
  let fogTex = null, fogPix = null, fogL = null, fogM = null, fogT = null;
  function fogUpload(gw, gh, cell, liveA, memA, win) {
    const n = gw * gh;
    if (!fogTex || fogPix.length !== n * 4) {
      fogPix = new Uint8Array(n * 4);
      fogTex = new THREE.DataTexture(fogPix, gw, gh, THREE.RGBAFormat);
      /* LINEAR is the whole point: the staircase the overlay spent three passes hiding is
       * dissolved here by the sampler, for free. flipY stays false so texel row 0 is world
       * y 0 — a flipped mask is a mirrored map and is not subtle. */
      fogTex.minFilter = fogTex.magFilter = THREE.LinearFilter;
      fogTex.wrapS = fogTex.wrapT = THREE.ClampToEdgeWrapping;
      fogTex.flipY = false;
      FOGU.uFogTex.value = fogTex;
      FOGU.uFogSpan.value.set(gw * cell, gh * cell);
    }
    /* SOFTEN THE FIELD, NOT THE PICTURE. Bilinear alone ramps across ONE texel — a single
     * 26-unit cell — which at any real zoom is a hard line, and the veil is meant to read as
     * a veil rather than a stencil. The overlay got its softness from drawing small and
     * blowing the result back up; here the same thing is done once, on the field itself,
     * before it is ever uploaded: a separable [1,2,1] pass in each axis, twice, which is a
     * Gaussian of about a cell. It costs a few thousand adds at the mask's 5Hz refresh, and
     * because it happens in WORLD space it softens equally at every zoom — the screen-space
     * blur had to be re-tuned against `cellPx` every frame to manage that. */
    if (!fogL || fogL.length !== n) { fogL = new Float32Array(n); fogM = new Float32Array(n); fogT = new Float32Array(n); }
    /* the window, padded so the blur's own reach never samples an unblurred edge in view */
    const wx0 = win ? Math.max(0, win.x0 - C.FOG.soften * 2) : 0;
    const wx1 = win ? Math.min(gw - 1, win.x1 + C.FOG.soften * 2) : gw - 1;
    const wy0 = win ? Math.max(0, win.y0 - C.FOG.soften * 2) : 0;
    const wy1 = win ? Math.min(gh - 1, win.y1 + C.FOG.soften * 2) : gh - 1;
    /* separable [1,2,1] in each axis. Safe to call with src === dst: the across pass lands in
     * the scratch first, so nothing is read after it has been overwritten. */
    const blur1 = (src, dst) => {
      for (let y = wy0; y <= wy1; y++) {
        const r = y * gw;
        for (let x = wx0; x <= wx1; x++) {
          const l = src[r + (x > 0 ? x - 1 : 0)], c = src[r + x], q = src[r + (x < gw - 1 ? x + 1 : gw - 1)];
          fogT[r + x] = (l + 2 * c + q) * 0.25;
        }
      }
      for (let y = wy0; y <= wy1; y++) {
        for (let x = wx0; x <= wx1; x++) {
          const u = fogT[(y > 0 ? y - 1 : 0) * gw + x], c = fogT[y * gw + x],
                d = fogT[(y < gh - 1 ? y + 1 : gh - 1) * gw + x];
          dst[y * gw + x] = (u + 2 * c + d) * 0.25;
        }
      }
    };
    /* FOUR passes, not two. Two is about a cell of softening, and against a near-black
     * shroud most of that ramp is already dark, so the edge still reads as a line. Four is
     * ~1.4 cells of Gaussian and matches the softness the overlay got from its upscale. */
    for (let k = 0; k < C.FOG.soften; k++) { blur1(k ? fogL : liveA, fogL); blur1(k ? fogM : memA, fogM); }
    for (let y = wy0; y <= wy1; y++) {
      for (let x = wx0, i = y * gw + wx0, j = i * 4; x <= wx1; x++, i++, j += 4) {
        fogPix[j] = fogL[i] * 255;
        fogPix[j + 1] = fogM[i] * 255;
      }
    }
    fogTex.needsUpdate = true;
  }
  /* THE GREY WASH BELOW A CRAG. The ground's colour is a TOP-DOWN bake, and a crag is not a
   * gentle hill: measured through one, the land goes from 0 to 150 units over twenty of
   * ground — an 82-degree face — so a twenty-unit strip of texture is stretched down a
   * hundred and fifty pixels of screen. Whatever is painted at the lip smears the whole way
   * down, which reads as a pale featureless skirt hanging under every rock.
   * There is no fixing that by painting: a top-down map has NOTHING to say about a vertical
   * face. So the face stops pretending to be ground and becomes what it is — rock in its own
   * shadow, keeping a quarter of the land's colour so a crag in a wood is not the same slate
   * as a crag on the meadow. `slope` is the geometry's own normal, so it costs one varying
   * and applies exactly where the stretch is. Only the ground asks for it. */
  function fogPatch(mat, mode) {
    if (!mat || mat._fogPatched) return mat;
    mat._fogPatched = true;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uFogTex = FOGU.uFogTex;
      sh.uniforms.uFogSpan = FOGU.uFogSpan;
      sh.uniforms.uFogOn = FOGU.uFogOn;
      sh.uniforms.uFogDbg = FOGU.uFogDbg;
      sh.uniforms.uTime = FOGU.uTime;
      sh.vertexShader = 'varying vec2 vFogXZ;\n' + sh.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 fogW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fogW = instanceMatrix * fogW;
        #endif
        vFogXZ = (modelMatrix * fogW).xz;`);
      sh.fragmentShader = 'uniform sampler2D uFogTex;\nuniform vec2 uFogSpan;\nuniform float uFogOn;\nuniform float uFogDbg;\nuniform float uTime;\nvarying vec2 vFogXZ;\n'
        + sh.fragmentShader.replace('#include <dithering_fragment>',
        `#include <dithering_fragment>
        if (uFogOn > 0.5) {
          vec2 m = texture2D(uFogTex, vFogXZ / uFogSpan).rg;
          /* THE FIELD IS BLURRED BEFORE IT IS UPLOADED, so a hard mask edge arrives as a
             ramp CENTRED on it and half that ramp lies on the unseen side. Read straight,
             ground the eye has never touched comes out a quarter lit — which is exactly
             what "the ground behind the wall is lighter than it should be" was: the wall's
             shadow is a narrow wedge and the blur was filling it from both sides. The lower
             smoothstep edge eats that tail: under 0.20 is unseen, full stop. */
          float lit = smoothstep(0.20, 0.90, m.r);
          float mem = smoothstep(0.20, 0.90, max(m.g, m.r));
          vec3 c = gl_FragColor.rgb;
          /* FOG IS DRAINED, NOT DIMMED — the thing the overlay could never do. Colour goes
             to luma, then a cold cast and half the light: you remember the land, you cannot
             see what stands on it. */
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          vec3 fogC = mix(c, vec3(l), 0.88) * vec3(0.72, 0.80, 1.06) * 0.62;
          /* ONE CHAIN, NOT TWO MIXES, and NO LINE ANYWHERE. shroud -> fog as memory comes
             in, fog -> the land as sight does. Mixing the two darknesses independently off
             the same base gave the meeting of fog and shroud a value that belonged to
             neither, and that seam was visible as a border between them. Chained, the three
             states are one ramp: there is nothing left to draw an edge ON. The warm iso-band
             that used to mark the edge of sight is gone with it — an edge is an edge. */
          vec3 o = mix(mix(vec3(0.021, 0.015, 0.043), fogC, mem), c, lit);
          gl_FragColor.rgb = (uFogDbg > 0.5) ? vec3(1.0 - mem, mem - lit, lit) : o;
        }`);
      /* AFTER the fog block is written, and therefore BEFORE it in the shader — both anchor on
       * the same include, so the last one injected ends up nearest it. Order matters: the
       * rock face is the ground's colour, and the veil has to darken what is finally there. */
      /* WATER IS NOT A COLOUR, IT IS A SURFACE. A spring was three concentric discs and a
       * glowing violet lozenge at the middle — perfect circles and an emissive core, which is
       * the visual grammar of a portal, not of a pool. Reported from play as looking like
       * something from the future. What makes water read as water is DEPTH (dark in the
       * middle, pale at the shoal) and MOVEMENT, and both are a few lines here rather than a
       * pile of geometry: three trains of rings drifting outward at different speeds, bent by
       * the angle so none of them is a perfect circle, with the crests catching the light.
       * The deep keeps a faint violet — Shadow is what a Gate draws out of a spring, and the
       * Gate's orb is that colour — but it is a cast in dark water now, not a lamp. */
      if (mode === 'water') {
        sh.vertexShader = 'varying vec2 vPoolXZ;\n' + sh.vertexShader.replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vPoolXZ = transformed.xz;`);
        sh.fragmentShader = 'varying vec2 vPoolXZ;\n' + sh.fragmentShader.replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
          {
            float r = length(vPoolXZ);
            float rn = clamp(r / 30.0, 0.0, 1.0);
            float ang = atan(vPoolXZ.y, vPoolXZ.x);
            float tt = uTime;
            float w = sin(r * 0.42 - tt * 1.35 + sin(ang * 3.0) * 0.9)
                    + 0.62 * sin(r * 0.78 + tt * 0.95 + cos(ang * 2.0 + 1.1) * 1.2)
                    + 0.38 * sin(r * 1.45 - tt * 2.10 + sin(ang * 5.0) * 0.5);
            w *= 0.45;
            vec3 deepC  = vec3(0.055, 0.070, 0.115);
            vec3 shoalC = vec3(0.150, 0.255, 0.275);
            vec3 c = mix(deepC, shoalC, smoothstep(0.12, 1.0, rn));
            c += vec3(0.110, 0.160, 0.180) * max(w, 0.0) * (0.30 + 0.70 * rn);
            c += vec3(0.42, 0.50, 0.52) * pow(max(w, 0.0), 7.0) * (0.25 + 0.75 * rn);
            gl_FragColor.rgb = c;
            gl_FragColor.a = (0.80 + 0.18 * (1.0 - rn)) * (1.0 - smoothstep(0.86, 1.0, rn));
          }`);
        mat.userData.waterFrag = sh.fragmentShader.indexOf('vPoolXZ') >= 0;
      }
      if (mode === 'slope') {
        sh.vertexShader = 'varying float vUpness;\nvarying float vWorldY;\n' + sh.vertexShader.replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vUpness = normalize(mat3(modelMatrix) * objectNormal).y;
          vWorldY = (modelMatrix * vec4(transformed, 1.0)).y;`);
        sh.fragmentShader = 'varying float vUpness;\nvarying float vWorldY;\n' + sh.fragmentShader.replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
          {
            float steep = smoothstep(0.30, 0.78, clamp(1.0 - vUpness, 0.0, 1.0));
            /* STRATA, or the face is still a smooth curtain — darker, but a curtain. A
               vertical wall has no detail of its own in a top-down bake, so it gets some:
               bands across the fall of the rock, jittered per column so a long scarp does
               not read as a barcode. Cheap, and only where the ground is nearly a wall. */
            float jitter = fract(sin(dot(floor(vFogXZ * 0.09), vec2(12.9898, 78.233))) * 43758.5);
            float band = 0.88 + 0.22 * fract(vWorldY * 0.035 + jitter * 0.6);
            vec3 rock = (vec3(0.055, 0.048, 0.070) + gl_FragColor.rgb * 0.26) * band;
            gl_FragColor.rgb = mix(gl_FragColor.rgb, rock, steep);
          }`);
        mat.userData.slopeFrag = sh.fragmentShader.indexOf('vUpness') >= 0;
      }
      /* PROVE THE INJECTION LANDED. A `.replace` whose needle is absent returns the string
       * unchanged and throws nothing — the patch then silently does nothing and the render
       * looks like a plausible result rather than a broken one. */
      mat.userData.fogVert = sh.vertexShader.indexOf('vFogXZ = ') >= 0;
      mat.userData.fogFrag = sh.fragmentShader.indexOf('uFogOn > 0.5') >= 0;
    };
    /* AND THE CACHE KEY MUST KNOW WHICH PATCH THIS IS. Three keys a patched program on
     * `onBeforeCompile.toString()` by default, and that string is IDENTICAL for both arms —
     * `slope` is a closed-over variable, not part of the source. Without this the ground and
     * every other patched material share one compiled program, and which one they all get
     * depends on nothing but which compiled first. */
    mat.customProgramCacheKey = () => 'amber-fog' + (mode ? '-' + mode : '');
    mat.needsUpdate = true;
    return mat;
  }
  R.fogPatch = fogPatch;
  R.debugFogU = FOGU;   // so a rig can force the shader off and measure the raw scene
  R.debugFogMats = () => [MAT, MATB, ground && ground.material, writG && writG.material].map((m) => m && ({
    type: m.type, patched: !!m._fogPatched, vert: !!m.userData.fogVert, frag: !!m.userData.fogFrag }));
  /* THE ONE HAZARD OF PUTTING THE VEIL IN THE MATERIALS: it only veils the materials it was
   * given. The 2D canvas covered everything by construction; this covers what it is told to,
   * and anything added later without `fogPatch` shines at full strength across black shroud.
   * That has already happened once — the writ was an unpatched LineBasicMaterial, and it read
   * as the writ and the sight disagreeing about where the ground was. So the scene can be
   * asked, and a suite asks it: every material under worldG, by name, that nothing darkens. */
  R.debugUnpatched = () => {
    const out = [];
    if (worldG) worldG.traverse((o) => {
      if (!o.material || o.name === 'affordance') return;
      for (const m of [].concat(o.material))
        if (m && !m._fogPatched)
          out.push((o.name || o.type) + ':' + m.type + ':' + ((o.geometry && o.geometry.type) || '?'));
    });
    return out;
  };


  /* ---------------- the veil lifts over TIME, not in jumps ----------------
   * Sight is recomputed five times a second on a 26-unit grid, so a cell goes from unseen to
   * seen in one step and the country ahead of a marching column opens in visible lurches. The
   * mask itself must stay a hard 0/1 — the AI, the snapshot and every fog rule read it — so
   * the easing lives HERE, in the drawing: a per-cell weight chasing the mask with a short
   * time constant. It is kept in WORLD space, on the mask's own grid, because the obvious
   * cheap version (blend last frame's veil buffer with this one) is in SCREEN space and smears
   * into a comet the moment the camera pans.
   * It is drawn as a few alpha BANDS rather than a fill per cell: band i is every cell at
   * least i/BANDS of the way in, and the incremental alphas compose source-over to exactly
   * that fraction of the layer's strength. Under the upscale's blur, four bands read as
   * continuous — the edge advances as a soft front instead of a rank of cells. */
  const VEIL_BANDS = 4;
  const veilT = {};
  let fogA = null;   // seen-minus-sight, rebuilt each frame into the same buffer
  /* `win` bounds the easing to the cells the camera can see (plus a margin): this runs every
   * frame, and a country's fog grid is sixteen boards' worth of cells the player is looking
   * at three percent of. Ground outside the window keeps its last eased value and catches up
   * in ~FOG.ease seconds when the camera arrives — which is exactly the fade the veil plays
   * everywhere anyway, so a pan cannot tell the difference. */
  function easeVeil(key, bits, n, dt, win) {
    let a = veilT[key];
    if (!a || a.length !== n) { a = veilT[key] = Float32Array.from(bits); return a; }
    const k = 1 - Math.exp(-Math.max(0, dt) / C.FOG.ease);
    if (win) {
      for (let y = win.y0; y <= win.y1; y++) {
        const r = y * win.gw;
        for (let x = win.x0; x <= win.x1; x++) {
          const i = r + x;
          a[i] += (bits[i] - a[i]) * k;
        }
      }
    } else {
      for (let i = 0; i < n; i++) a[i] += (bits[i] - a[i]) * k;
    }
    return a;
  }
  /* cumulative source-over to alpha*i/BANDS after the i'th band: inc = step / (1 - reached) */
  function bandFill(ctx, cg, gw, gh, a, alpha) {
    for (let i = 0; i < VEIL_BANDS; i++) {
      const lo = i / VEIL_BANDS, inc = (alpha / VEIL_BANDS) / (1 - alpha * lo);
      ctx.fillStyle = 'rgba(255,255,255,' + Math.max(0, Math.min(1, inc)) + ')';
      maskPath(ctx, cg, gw, gh, a, lo);
      ctx.fill();
    }
  }
  R.debugVeilEase = (k) => veilT[k] || null;
  /* what a work is drawn as, and how it is drawn — the suite's way of asking whether two works
   * look the same without reaching into the scene graph */
  R.modelKey = modelKey;
  /* test handle: the colour actually flying over a hall. Which company a hall belongs to is
   * in the snapshot and easy to assert; what the PLAYER reads is the flag, and that lives in
   * a material inside a cached group where nothing outside can see it. */
  /* test handle: how tall the renderer thinks a work is, where it put that work's standard,
   * and how far the pennant clears the stone. "Is the flag inside the roof" is not answerable
   * from outside without reaching into the scene graph, and it has been wrong once. */
  R.debugWorkTop = (id) => {
    for (const g of cityObjs || []) {
      const w = g.works.get(id);
      if (!w) continue;
      const f = coFlags.get('w' + id);
      const stone = w.grp.position.y + w.top * (w.grp.scale.y || 1);
      if (!f) return `top ${stone.toFixed(1)} — no flag`;
      const pen = f._flag.getWorldPosition(new THREE.Vector3()).y;
      return `stone-top ${stone.toFixed(1)}  pennant ${pen.toFixed(1)}  clearance ${(pen - stone).toFixed(1)}`;
    }
    return null;
  };
  R.debugStandard = (id) => {
    for (const g of cityObjs || []) {
      const w = g.works.get(id);
      if (!w) continue;
      let hex = null;
      w.grp.traverse((o) => { if (o.name === 'standard' && o.material) hex = o.material.color.getHexString(); });
      return hex;
    }
    return null;
  };
  R.model = buildingModel;
  /* THE SEAT IS SEEN TO FALL. The sim ends the match on the tick the last hit lands — the
   * referee's clocks must not move — so the fall is presentation: the tower sinks, tilts and
   * dims over about two and a half seconds while game.js holds the end screen back. Driven
   * per frame from the same list for every seat at the table, so a host and a guest watch the
   * same collapse. Idempotent per seat: the win and the fall both try to start it. */
  R.seatFall = function (pi) {
    if (!seatFalls.some((f) => f.pi === pi)) seatFalls.push({ pi, t0: performance.now() });
  };
  R.seatFallDone = (pi) => !seatFalls.some((f) => f.pi === pi && performance.now() - f.t0 < 2600);
  /* A COLLAPSE BELONGS TO THE MATCH IT HAPPENED IN. `seatFalls` is module state and nothing
   * emptied it: it was spliced only when a seat had no tower at all, and starting another
   * match gives every seat a NEW tower, so the entry survived. Its t0 was then minutes old,
   * k was 1 on the very first frame, and the fresh Seat opened SUNK ninety-six units, leaning
   * and dimmed — a throne drawn as rubble while the sim said full health. Reported from play,
   * from a phone, thirty seconds into a LAN match; nothing to do with LAN, which is simply
   * where you start another match without reloading the page.
   * Cleared from the two places a match BEGINS, which is the only moment that can say with
   * authority that nothing is falling. Deliberately NOT on a world rebuild: a rebuild also
   * happens when the viewer changes seats, and in a free-for-all a toppled Seat must STAY
   * down for the heirs still playing. */
  R.clearSeatFalls = function () { seatFalls.length = 0; };
  R.debugSeatFall = () => seatFalls.length > 0;   // is a collapse in flight — for the suite
  /* test handle: the Seat as the renderer is actually drawing it. "Is the throne standing?"
   * is not answerable from outside without reaching into the scene graph, and the one bug
   * this has had was a tower drawn toppled while the sim said it was at full health. */
  /* test handle: the colour a Seat is actually WEARING, so a suite can prove a court that
   * changes hands re-dresses rather than trusting that it was asked to */
  /* test handle: the colour a site's ownership ring is WEARING, so a suite can prove the ring
   * and `tintOf` cannot drift apart — which they did, and a spring held by a sworn lord came
   * out in the enemy's crimson */
  R.debugSiteRing = (id) => {
    const so = siteObjs && siteObjs.get(id);
    if (!so || !so.ring || !so.ring.visible) return null;
    return '#' + so.ring.material.color.getHex().toString(16).padStart(6, '0');
  };
  R.debugSeatTint = (pi) => {
    const g = cityObjs && cityObjs[pi];
    return g && g.tint != null ? '#' + g.tint.toString(16).padStart(6, '0') : null;
  };
  R.debugSeatTower = (pi) => {
    const g = cityObjs && cityObjs[pi];
    if (!g || !g.tower) return null;
    let op = 1;
    g.tower.traverse((o) => { if (o.material && o.material.opacity != null) op = o.material.opacity; });
    return { y: g.tower.position.y, base: g.tower._baseY == null ? g.tower.position.y : g.tower._baseY,
             lean: g.tower.rotation.z, opacity: op };
  };
  function driveSeatFalls() {
    for (let i = seatFalls.length - 1; i >= 0; i--) {
      const f = seatFalls[i], g = cityObjs && cityObjs[f.pi];
      if (!g || !g.tower) { seatFalls.splice(i, 1); continue; }
      /* and a fall drives the tower it STARTED on, never a later one — the belt to
       * clearSeatFalls' braces, for any path that builds a new world without saying so. */
      if (f.tower && f.tower !== g.tower) { seatFalls.splice(i, 1); continue; }
      f.tower = g.tower;
      const k = Math.min(1, (performance.now() - f.t0) / 2500);
      /* ease-in: stone hesitates, then goes. Sink most of the shaft, lean hard, dim. */
      const e = k * k;
      g.tower.position.y = (g.tower._baseY == null ? (g.tower._baseY = g.tower.position.y) : g.tower._baseY) - e * 96;
      g.tower.rotation.z = e * 0.38;
      g.tower.traverse((o) => { if (o.material && o.material.color) {
        /* A CLONE LOSES THE VEIL. `onBeforeCompile` is a prototype method and an assigned
         * one is not in the whitelist `Material.copy()` walks, so a cloned material falls
         * back to the no-op and renders at full strength — and a toppling tower, a ghost and
         * a scaffold are exactly the things most likely to be standing in fog. Re-patch. */
        if (!o._dimmed) { o._dimmed = true; o.material = fogPatch(o.material.clone()); }
        o.material.opacity = 1 - e * 0.55; o.material.transparent = true;
      } });
      /* dust: a ring every third of the way down, widening as it goes */
      if (!f.rings) f.rings = 0;
      if (e * 3 > f.rings && f.rings < 3) {
        f.rings++;
        const c = g.tower._baseXZ || (g.tower._baseXZ = { x: g.tower.position.x, z: g.tower.position.z });
        ringFx(c.x, c.z, 0xb8a890, 0.8, 40 + f.rings * 26);
      }
    }
  }
  /* the raging storms as drawn — the suite asks whether a disc lies ON the ground it covers,
   * which is not answerable from outside without reaching into the scene graph */
  R.debugStorms = () => stormState;

  /* ---------------- world (re)build ---------------- */
  const mapKey = (view, viewer) => (view.mapSeed || 0) + ':' + viewer;
  function buildWorld(view, viewer) {
    /* `remove` DOES THE SPLICING, so popping first was doing it twice and undoing the half
     * that matters: `pop()` takes the child out of the array, `remove()` then cannot find it
     * and returns without clearing `child.parent` — so every discarded mesh walked away still
     * pointing at the group it had been thrown out of. Nothing drew it, so nothing complained;
     * what it cost was the ability to ASK. `o.parent` is the natural probe for "is this handle
     * an orphan of the last world", a suite written against it passed on the broken code, and
     * that is how a whole class of stale-handle bug hides. Index 0 each time so the array is
     * walked once. */
    while (worldG.children.length) {
      const c2 = worldG.children[0];
      c2.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      worldG.remove(c2);
    }
    siteObjs.clear(); unitIM = {}; unitFace.clear(); coFlags.clear();
    /* the veil forgets what it was easing towards: a new board's first frame must open on
     * THIS match's fog, not fade out of the last one's */
    for (const k in veilT) delete veilT[k];
    /* the halo hangs in worldG, which was just emptied — forget the handle or the next frame
     * writes instances into a mesh that is no longer in the scene. The reach ring hangs
     * there too, and forgetting its key with it is what lets the next match rebuild it. */
    haloIM = null; haloCo = null;
    reachLine = null; reachKey = '';
    /* the darts and the chains hang in worldG too, and it was just emptied — their geometry is
     * disposed with everything else, so the handles must go with it or the next frame writes
     * instances into a mesh that is no longer in the scene */
    arrowIM = null; ballIM = null; hexIM = null; arrows.length = 0; gateState.clear();
    flash2 = [];   // last match's battles are not this one's
    /* ...AND SO DOES THE JEWEL'S STORM, which was the one thing missed off this list. Every
     * slot of `stormState` holds a disc and a bolt of lightning that hang in `worldG` and were
     * just disposed with it, and the pool re-creates them lazily behind `if (!ss.disc)` — which
     * is FALSE for an orphan. So from the second match of a session onward every cast set
     * `visible = true` on a mesh that is not in the scene and rewrote vertices nobody would
     * ever draw. The only thing still rendering was the point light, because that is added to
     * `scene` rather than `worldG` and `buildWorld` never touches it: a faint flicker over
     * dark ground and no storm at all. Reported from play as the Jewel having no effect. */
    stormState.length = 0;
    hurtMem.clear(); hpMem.clear(); flash.clear(); barRec.clear();
    writG = null; writKey = '';
    for (const f of fx) if (f.obj) f.obj.removeFromParent();
    fx = [];

    /* TWO GROUNDS PAST A BOARD'S SIZE. The painterly bake's pixel budget (6MP) binds at
     * exactly a board, so a country under it is a colour wash painted over several seconds
     * of freeze. Past the gate the whole land bakes CHEAPLY (bakeBase: one ImageData pass,
     * flat colour and arithmetic relief, milliseconds at any size) and the painterly pass is
     * spent where the camera is: detail TILES, a few at a time, baked one per frame and kept
     * on a small LRU — see updateTiles. A board keeps today's single bake to the byte. */
    tiled = view.nav.W * view.nav.cw > 6000;
    tileMap = new Map(); tileQueue.length = 0;
    const bake = tiled ? global.Terrain.bakeBase(view, viewer)
                       : global.Terrain.bake(view, viewer, { props: false, labels: false });
    /* REAL relief: the ground mesh is the sim's own elevation field, so a hill you see is a
     * hill units pay to climb and a crag you see is one they cannot cross at all. */
    const nav = view.nav;
    /* this world's own extents, and everything sized by them follows: the backdrop under the
     * board, and a far plane that must clear the whole land through the distance fog — both
     * work out to exactly their old constants on a default board */
    mapW = nav.W * nav.cw; mapH = nav.H * nav.cw;
    if (underM) {
      underM.geometry.dispose();
      underM.geometry = new THREE.PlaneGeometry(mapW * 3, mapH * 3.75).rotateX(-Math.PI / 2);
      underM.position.set(mapW / 2, -5, mapH / 2);
    }
    if (cam) {
      cam.far = Math.max(9000, Math.hypot(mapW, mapH) * 1.5);
      cam.updateProjectionMatrix();
    }
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
    const geo = new THREE.PlaneGeometry(mapW, mapH, seg[0], seg[1]);
    geo.rotateX(-Math.PI / 2);
    geo.translate(mapW / 2, 0, mapH / 2);
    const pp = geo.attributes.position;
    for (let i = 0; i < pp.count; i++) pp.setY(i, hFn(pp.getX(i), pp.getZ(i)));
    geo.computeVertexNormals();
    /* THE LATTICE IS THE MESH'S OWN VERTICES, not a resampling of the field — see groundH.
     * PlaneGeometry lays them out row-major from the near corner, which after the rotate and
     * the translate above is world (0,0), so the vertex buffer IS the grid. */
    gridW = seg[0] + 1; gridH = seg[1] + 1;
    gridDX = mapW / seg[0]; gridDZ = mapH / seg[1];
    groundGrid = new Float32Array(gridW * gridH);
    for (let i = 0; i < groundGrid.length; i++) groundGrid[i] = pp.getY(i);
    const tex2 = new THREE.CanvasTexture(bake.canvas);
    tex2.colorSpace = THREE.SRGBColorSpace;
    ground = new THREE.Mesh(geo, fogPatch(new THREE.MeshLambertMaterial({ map: tex2 }), 'slope'));
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
      /* A ROCK MAY NOT HANG OVER THE LIP. Every rock was seated at the height of its own
       * CENTRE, which is right in the middle of a crag and wrong at its edge: a crag's top is
       * a plateau and its side is an 82-degree face, so a rock whose centre is the last high
       * cell has half its width standing on air. A ring of them all round the rim reads as a
       * mushroom cap on a stalk — reported from play in exactly those words.
       * So each one is asked what the ground does across its own FOOTPRINT. Where that answer
       * is a cliff, the rock steps back uphill and gives up some size until it fits, which is
       * the same rule terrain.js already applies in 2D to boundary cells. It is not seated on
       * the lower ground instead: that would drop rim rocks down the scarp onto ground men can
       * walk, and a rock mesh standing where the sim says a man may stand is the bug this
       * renderer has already had once. */
      bake.rocks.forEach(([rx, ry, rr, rv], i) => {
        let x = rx, z = ry, s2 = 0.8 + rr * 0.075;
        const hC = groundH(x, z);
        for (let pass = 0; pass < 3; pass++) {
          const rad = 12 * s2;
          let lo = hC, ux = 0, uz = 0;
          for (let k = 0; k < 8; k++) {
            const a = k / 8 * Math.PI * 2, cx = Math.cos(a), cz = Math.sin(a);
            const h = groundH(x + cx * rad, z + cz * rad) - hC;
            if (hC + h < lo) lo = hC + h;
            ux += cx * h; uz += cz * h;      // sums to a vector pointing UPHILL
          }
          if (hC - lo < 8) break;            // the ground under it is level enough to stand on
          const n = Math.hypot(ux, uz) || 1;
          x += ux / n * rad * 0.5; z += uz / n * rad * 0.5;
          s2 *= 0.74;
        }
        dum.position.set(x, groundH(x, z) - 1, z);
        dum.rotation.set(0, rv * Math.PI * 2, 0);
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
        /* A SPRING IS THE ECONOMY — the most contested thing on the board — and it has now
         * been drawn wrong twice. First as a plain blue coin on the grass. Then as three
         * PERFECT CONCENTRIC DISCS with an emissive violet lozenge at the middle, which is
         * the visual grammar of a portal or a targeting reticle: reported from play as
         * looking like something from the future.
         * A pool reads as a pool on two things, and neither of them is detail. Its OUTLINE is
         * irregular (nothing in a landscape is that round — see poolGeo), and its surface
         * MOVES. Both are cheap: one wobbled fan per site, and a ripple written in the
         * fragment shader so the animation costs a uniform rather than a draw call. */
        const seed = (s.id % 17) * 0.7 + 0.3;
        if (!poolLipMat) poolLipMat = fogPatch(new THREE.MeshLambertMaterial(
          { color: 0x584c43, side: THREE.DoubleSide }));
        if (!poolWaterMat) poolWaterMat = fogPatch(new THREE.MeshBasicMaterial(
          { transparent: true, side: THREE.DoubleSide, depthWrite: false }), 'water');
        /* WET STONE FIRST, then the water inside it and a little short of it, so the pool has
         * a bank rather than an edge. The two outlines are the same wobble at two radii, which
         * is what makes the bank look worn by the water rather than drawn around it. */
        const lip = new THREE.Mesh(poolGeo(seed, 34), poolLipMat);
        lip.position.y = 0.45;
        const water = new THREE.Mesh(poolGeo(seed, 26), poolWaterMat);
        water.position.y = 1.0;
        /* NO STONES ROUND THE RIM. Six spheres in the kit's lavender ringed the pool and read
         * as purple orbs floating on the bank — jewellery, not landscape. The bank itself is
         * the detail now, and it is the right kind: it belongs to the water. */
        holder.add(lip, water);
      } else if (s.kind === 'vantage') {
        holder.add(meshOf([part(sph(12), 0x5a5266, -10, 6, 2), part(sph(9), 0x6a6276, 8, 5, -6), part(sph(6), 0x4a4258, 2, 4, 10)]));
      } else {
        holder.add(meshOf([part(box(8, 30, 8), 0x2c2433, 0, 15, 0), part(box(10, 3, 10), 0x5ad584, 0, 31, 0)]));
      }
      /* AN AFFORDANCE IS NOT THE WORLD. This ring says "you have this selected" and the halo
       * below says "these men are yours and armed" — both answer the player, not the land, and
       * a veil over an answer to the player is a bug, not fidelity. Named so the patched-scene
       * guard can allow exactly these two and nothing else. */
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
      ring.name = 'affordance';
      ring.position.y = 1.2; ring.visible = false;
      holder.add(ring);
      worldG.add(holder);
      siteObjs.set(s.id, { holder, ring, hash: '' });
    }

    /* cities */
    cityObjs = view.players.map((q, pi) => buildCity(view, viewer, pi));

    /* the war banner */
    bannerG = new THREE.Group();
    const pole = meshOf([part(cyl(0.9, 0.9, 42, 5), 0xd8c8a8, 0, 21, 0)]);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(20, 11).translate(10, 0, 0),
      fogPatch(new THREE.MeshBasicMaterial({ color: 0xd8b04e, side: THREE.DoubleSide })));
    flag.position.set(0, 36, 0);
    bannerG.add(pole, flag); bannerG._flag = flag;
    worldG.add(bannerG);

    lastKey = mapKey(view, viewer);
    /* AND NOW THE EXTENTS ARE REAL, so an aim taken before them can finally be honoured. The
     * zoom floor scales with the land too (applyZoom), so it is re-applied first — otherwise
     * the replay lands correctly at a zoom meant for a board. Cleared after one replay: this
     * answers the aim that was taken for THIS world, and a later drag or a council row is the
     * player's own and must not be undone by the next rebuild. */
    if (R._aim) {
      const a = R._aim;
      R.applyZoom();
      R.lookAt(a.x, a.y);
      R._aim = null;
    }
  }

  function buildCity(view, viewer, pi) {
    const own = pi === viewer;
    const city = view.map.sites[view.map.cities[pi]];
    const g = { cx: city.x, cy: city.y, own, ci: pi, tint: null, group: new THREE.Group() };
    /* THE COURT IS PAINTED, NOT STAMPED. There was a flat CircleGeometry here — one solid
     * colour at 0.85 opacity, laid at the Seat's own height. Reported from play as an ugly
     * brown disc, and it was three wrongs at once: a paint-bucket colour on a board that is
     * painterly everywhere else; a PLANAR circle on ground that is not planar, so it cut into
     * the hill on one side and floated on the other; and a hard rim with no falloff.
     * It was also redundant. `terrain.js` already paints a court into the ground bake — the
     * same ground every other feature is painted into — which blends, follows the land because
     * it IS the land, and costs no mesh, no transparency and no z-fighting. The disc was a
     * second court stamped on top of a better one. Deleted; the bake does the work. */
    const ch = groundH(city.x, city.y);
    g.tint = cityTint(view.cities && view.cities[pi], viewer);
    g.tower = towerModel(g.tint);
    g.tower.position.set(city.x, ch, city.y);
    g.group.add(g.tower);
    /* works are placed things now: their groups are made and destroyed as they rise and fall */
    g.works = new Map();   // building id -> { grp, key, pad }
    worldG.add(g.group);
    return g;
  }

  /* ---- AND IT RE-DRESSES WHEN THE COURT CHANGES HANDS ----
   * The city groups are built once, indexed by the seat their heir was BORN to, and `own` was
   * decided there and then. That was right for as long as a Seat could only ever fall — a city
   * that changes hands made the assumption a lie, and the tower you had just stormed and taken
   * went on flying the enemy's crimson for the rest of the war. It is the loudest thing on a
   * war map and it was the one thing that never changed. The tower is vertex-coloured and
   * merged, so a new banner means a new mesh; it is a rare event and the group already knows
   * how to hold one. Never mid-collapse: a falling Seat owns its own tower handle. */
  function redressCities(view, viewer) {
    if (!view.cities || !cityObjs) return;
    for (let pi = 0; pi < cityObjs.length && pi < view.cities.length; pi++) {
      const g = cityObjs[pi];
      if (!g || !g.tower) continue;
      const want = cityTint(view.cities[pi], viewer);
      if (want === g.tint) continue;
      if (seatFalls.some((f) => f.pi === pi)) continue;
      g.tower.removeFromParent();
      g.tower.geometry.dispose();
      const at = g.tower.position;
      g.tint = want;
      g.tower = towerModel(want);
      g.tower.position.copy(at);
      g.group.add(g.tower);
      /* ...AND SO DOES THE GROUND. `terrain.js` paints a warm or a cold wash into the bake
       * around every court — it IS the land, which is why it follows every slope for free —
       * and a bake is a picture taken once. A court that swears keeps the old picture until
       * somebody repaints it, so the two grounds are told: the cheap base is one ImageData
       * pass and is simply redone, and the painterly tiles within the wash's reach are
       * dropped for `updateTiles` to bake again one per frame. */
      groundDirty = true;
      if (tileMap) for (const [k, t] of [...tileMap]) {
        const ix = +k.split(':')[0], iy = +k.split(':')[1];
        const cx = (ix + 0.5) * TILE, cy = (iy + 0.5) * TILE;
        if (Math.hypot(cx - g.cx, cy - g.cy) > TILE + 400) continue;
        t.mesh.removeFromParent(); t.mesh.geometry.dispose();
        t.mesh.material.map.dispose(); t.mesh.material.dispose();
        tileMap.delete(k);
      }
    }
    if (groundDirty && ground) {
      groundDirty = false;
      const bk = tiled ? global.Terrain.bakeBase(view, viewer)
                       : global.Terrain.bake(view, viewer, { props: false, labels: false });
      const tex = new THREE.CanvasTexture(bk.canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      if (ground.material.map) ground.material.map.dispose();
      ground.material.map = tex;
      ground.material.needsUpdate = true;
    }
  }

  /* ---------------- events → fx ---------------- */
  /* ---- WHOSE, IN ONE COLOUR ----
   * You are ALWAYS gold — nobody should have to remember which of four colours is theirs — and
   * every rival keeps a colour of its own for the whole match. On a board that is seat order
   * with the viewer taken out of the line, exactly as it always was.
   * IN A WAR IT IS THE BANNER THAT IS COLOURED, not the lord. A country seats sixteen and the
   * palette has four, so from the fifth seat on every lord came out the same crimson: an ally,
   * a neutral and the army marching on you were one colour, and a court that swore to a rival
   * looked no different the tick after. `World.realmOf` collapses sixteen lords onto the few
   * sides that exist, `world.heirs` is the list of banners worth a colour of their own, and
   * everyone sworn to nobody shares the neutral. `curView`/`curViewer` are what the frame is
   * drawing; a view with no realms on it (a board, a chronicle's half-world) falls straight
   * through to the seat rule. */
  /* "IS THIS ONE OF MINE" — the banner's answer, with the seat rule as the fallback. The same
   * question `tintOf` asks below, spelled once so the works loop, the pad and the standard
   * cannot drift from the colour. */
  const mineOf = (view, viewer, pi) => {
    if (pi === viewer) return true;
    if (pi < 0 || !view || !view.players || !view.players[pi]) return false;
    if (view.players[pi].realm == null || !global.World) return false;
    const W = global.World;
    return W.realmOf(view, pi) === W.realmOf(view, viewer);
  };
  const tintOf = (owner, viewer) => {
    if (owner === C.CHAOS_ID) return C.CHAOS_TINT;
    if (owner === viewer) return C.SEAT_TINT[0];
    const v = curView;
    if (v && v.players && v.players[owner] && v.players[owner].realm != null && global.World) {
      const W = global.World, r = W.realmOf(v, owner);
      if (r === W.realmOf(v, viewer)) return C.REALM_TINT[0];
      const heirs = v.heirs || [];
      /* the contending banners, in their own order with yours removed — so the rival who is
       * crimson in the first minute is crimson in the last */
      const line = heirs.filter((h) => W.realmOf(v, h) !== W.realmOf(v, viewer));
      const at = line.indexOf(r);
      return at >= 0 ? (C.REALM_TINT[1 + at] || C.REALM_TINT[1]) : C.NEUTRAL_TINT;
    }
    return C.SEAT_TINT[1 + (owner < viewer ? owner : owner - 1)] || C.SEAT_TINT[1];
  };
  /* the same question for a CITY, which may be nobody's: a yielded court belongs to the war,
   * not to a heir, and drawing it in the last owner's colour is a lie about who holds it */
  const cityTint = (c, viewer) => (!c || c.owner < 0 ? C.NEUTRAL_TINT : tintOf(c.owner, viewer));
  /* THE ONE ANSWER TO "WHOSE COLOUR IS THIS", exported because the HUD asks it too — the
   * walkers' board, the terms chips and the claim bar are all statements about whose, and a
   * second palette in ui.js is a second chance to disagree with the board. */
  R.tintOf = (owner, viewer) => tintOf(owner, viewer);
  function ringFx(x, z, color, ttl, big, ping) {
    const m = new THREE.Mesh(new THREE.RingGeometry(6, 9, 20).rotateX(-Math.PI / 2),
      fogPatch(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })));
    m.position.set(x, groundH(x, z) + 2, z);
    worldG.add(m);
    fx.push({ k: 'ring', obj: m, ttl, max: ttl, big: big || 40, x, z, ping });
  }
  /* `h` is how high the shot LEAVES. Every gun on the board is a tower of some height and 16
   * was near enough for all of them until the Seat started shooting: the throne stands a
   * hundred feet over its own city, and a bolt leaving the middle of the city at knee height
   * read as a man in the streets rather than the castle answering. */
  function boltFx(x1, z1, x2, z2, color, ttl, h) {
    const gline = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x1, groundH(x1, z1) + (h || 16), z1), new THREE.Vector3(x2, groundH(x2, z2) + 12, z2)]);
    const m = new THREE.Line(gline, fogPatch(new THREE.LineBasicMaterial({ color, transparent: true })));
    worldG.add(m);
    fx.push({ k: 'bolt', obj: m, ttl, max: ttl, x: x1, z: z1 });
  }

  /* ---------------- ARROWS ARE THINGS IN THE AIR ----------------
   * A shot was a straight line drawn between two points for a fifth of a second, which is what
   * a laser looks like, and with a hundred archers on a curtain the board strobed. An arrow
   * LEAVES the bow, arcs, and ARRIVES — and that flight is the whole reason a volley reads as a
   * volley and not as a flicker. The sim only says the shot happened, on the tick it happened;
   * everything after that is the renderer's, so it costs the sim nothing and rides no wire.
   *
   * ONE geometry and ONE instanced mesh for every dart on the board. Dozens are in the air at
   * once, this runs on phones, and a Line per shot was an allocation, a BufferGeometry, a
   * material and a draw call EACH. The pool grows in doublings and never shrinks. */
  let arrowIM = null, ballIM = null;
  const arrows = [];
  const ARROW = { speed: 620, min: 0.13, max: 0.7, arc: 0.17, room0: 64 };
  /* the dart itself, built pointing along +Z so `Object3D.lookAt` can aim it down its own
   * velocity — for anything that is not a camera, lookAt turns local +Z at the target */
  function arrowGeo() {
    const shaft = colorize(cyl(0.7, 0.7, 19, 4).toNonIndexed().rotateX(Math.PI / 2), 0xe8dcb8);
    const head = colorize(cone(2.1, 6, 4).toNonIndexed().rotateX(Math.PI / 2).translate(0, 0, 12), 0xfff4e0);
    const fl1 = colorize(box(0.5, 4.4, 4.6).toNonIndexed().translate(0, 0, -8), 0xe6dcf0);
    const fl2 = colorize(box(4.6, 0.5, 4.6).toNonIndexed().translate(0, 0, -8), 0xe6dcf0);
    return merge([shaft, head, fl1, fl2]);
  }
  function arrowFx(x1, z1, x2, z2, color, o) {
    const d = Math.hypot(x2 - x1, z2 - z1);
    if (d < 1) return;                       // nowhere to fly; a degenerate lookAt has no answer
    /* `o` is the gunnery: a launch height for a shot that leaves a tower's deck rather than a
     * man's shoulder, a size for a ballista's dart against an archer's arrow, and a heavier
     * arc for a ball that is thrown rather than loosed. A man's shot passes none of it. */
    o = o || {};
    arrows.push({ x1, z1, x2, z2, t: 0,
                  dur: Math.max(ARROW.min, Math.min(ARROW.max, d / (o.speed || ARROW.speed))),
                  y1: groundH(x1, z1) + (o.y1 != null ? o.y1 : 16), y2: groundH(x2, z2) + 11,
                  rise: Math.min(o.rise || 52, d * (o.arc || ARROW.arc)),
                  s: o.s || 1, ball: o.ball ? 1 : 0, color });
  }
  /* the parabola, sampled twice: where the dart is, and where it will be a moment later, which
   * is the direction it points. Cheaper and shorter than differentiating the arc by hand, and
   * exact enough at a scale where the dart is a dozen units long. */
  const arcAt = (a, k) => ({ x: a.x1 + (a.x2 - a.x1) * k, z: a.z1 + (a.z2 - a.z1) * k,
                             y: a.y1 + (a.y2 - a.y1) * k + a.rise * 4 * k * (1 - k) });
  function updateArrows(dt) {
    for (let i = arrows.length - 1; i >= 0; i--) {
      arrows[i].t += dt;
      if (arrows[i].t >= arrows[i].dur) arrows.splice(i, 1);   // retired ON ARRIVAL
    }
    if (!arrows.length) { if (arrowIM) arrowIM.count = 0; return; }
    if (arrowIM && arrows.length > arrowIM._room) {
      arrowIM.removeFromParent(); arrowIM.geometry.dispose(); arrowIM.dispose(); arrowIM = null;
    }
    if (!arrowIM) {
      let room = ARROW.room0;
      while (room < arrows.length) room *= 2;
      /* UNLIT, like the tracer it replaces. A dart is a few pixels of gold against a night
       * board and a Lambert one loses half its brightness to the sun's angle — which would
       * make the new volley HARDER to read than the line it is meant to improve on. */
      arrowIM = new THREE.InstancedMesh(arrowGeo(), MATB, room);
      arrowIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      arrowIM.frustumCulled = false;         // rewritten every frame — see makeIM
      arrowIM._room = room;
      worldG.add(arrowIM);
    }
/* ONE LIST, TWO MESHES. A dart and a cannonball are different geometry and so cannot share
     * an instanced mesh, but they are the same flight: launched, arcing, arriving. The ball pool
     * is built exactly like the dart pool and only when something round is actually in the air,
     * so a match with no cannon in it never allocates one. */
    if (ballIM && arrows.length > ballIM._room) {
      ballIM.removeFromParent(); ballIM.geometry.dispose(); ballIM.dispose(); ballIM = null;
    }
    let na = 0, nb = 0;
    for (let i = 0; i < arrows.length; i++) {
      const a = arrows[i], k = a.t / a.dur;
      const p = arcAt(a, k), q = arcAt(a, Math.min(1, k + 0.06));
      dum.position.set(p.x, p.y, p.z);
      dum.scale.set(a.s, a.s, a.s);
      dum.lookAt(q.x, q.y, q.z);
      dum.updateMatrix();
      colTmp.setHex(a.color);
      if (a.ball) {
        if (!ballIM) {
          let room = ARROW.room0;
          while (room < arrows.length) room *= 2;
          /* WHITE, so the instance colour is the ball's colour. `MATB` is `vertexColors: true`
           * and a geometry with no `color` attribute reads as (0,0,0) in the shader — which
           * multiplies the instance colour away and lands every ball on pure black. The dart
           * pool never hit this because `arrowGeo` colorizes each of its four parts. */
          ballIM = new THREE.InstancedMesh(colorize(sph(3.4), 0xffffff), MATB, room);
          ballIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          ballIM.frustumCulled = false;
          ballIM._room = room;
          worldG.add(ballIM);
        }
        ballIM.setMatrixAt(nb, dum.matrix); ballIM.setColorAt(nb, colTmp); nb++;
      } else {
        arrowIM.setMatrixAt(na, dum.matrix); arrowIM.setColorAt(na, colTmp); na++;
      }
    }
    if (ballIM) {
      ballIM.count = nb;
      ballIM.instanceMatrix.needsUpdate = true;
      if (ballIM.instanceColor) ballIM.instanceColor.needsUpdate = true;
    }
    arrowIM.count = na;
    arrowIM.instanceMatrix.needsUpdate = true;
    if (arrowIM.instanceColor) arrowIM.instanceColor.needsUpdate = true;
  }
  /* test handle: how many darts are in the air. They live in ONE instanced mesh with no object
   * per shot, so a suite has nothing else to count. */
  R.debugArrows = () => arrows.length;
  /* ...and WHAT is in the air, which `debugArrows` cannot say: a tower's shot is a dart or a
   * ball, and it must leave the GUN and not the masonry around its foot. There is no object per
   * shot — they live in two instanced meshes — so a suite has nothing else to read. */
  R.debugFlights = () => arrows.map((a) => ({ y1: a.y1, ball: !!a.ball, s: a.s, x1: a.x1, z1: a.z1 }));
  /* ...and that the ball pool can carry a colour at all. `MATB` is `vertexColors: true`, so a
   * geometry with no `color` attribute reads (0,0,0) in the shader and multiplies the instance
   * colour to pure black — a bug with no exception, no warning and no shape to it on screen. */
  R.debugBallGeo = () => !!(ballIM && ballIM.geometry && ballIM.geometry.attributes.color);

  /* ---------------- THE CHAINS ----------------
   * FEATURE-DETECTED, and silent until the sim carries it. A man the Binding has caught wears
   * `hexed` — a world-time expiry — and while it holds he drags a ring of Shadow at his feet,
   * in the Trump's violet, which is the Binding's own colour on the Spire. If the field is not
   * on the wire yet, nothing is drawn and nothing complains. One instanced mesh, like the
   * armed company's halo, so a field full of chained men is still one draw call. */
  let hexIM = null;
  const hexGeo = () => new THREE.RingGeometry(6.5, 10.5, 14).rotateX(-Math.PI / 2);
  const hexedNow = (u, now) => u.hexed != null && u.hexed !== false &&
    !(typeof u.hexed === 'number' && now != null && u.hexed <= now);
  function updateHex(view) {
    const now = view.t;
    const on = [];
    for (const u of view.units) if (!u.in && hexedNow(u, now)) on.push(u);
    if (!on.length) { if (hexIM) hexIM.count = 0; return; }
    if (hexIM && on.length > hexIM._room) {
      hexIM.removeFromParent(); hexIM.geometry.dispose(); hexIM.material.dispose();
      hexIM.dispose(); hexIM = null;
    }
    if (!hexIM) {
      let room = 64;
      while (room < on.length) room *= 2;
      hexIM = new THREE.InstancedMesh(hexGeo(),
        fogPatch(new THREE.MeshBasicMaterial({ color: 0xc48eff, transparent: true, opacity: 0.55, depthWrite: false })),
        room);
      hexIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      hexIM.frustumCulled = false;
      hexIM.renderOrder = 1;
      hexIM._room = room;
      worldG.add(hexIM);
    }
    /* it turns the other way from the armed company's halo and it does not breathe: a hold is
     * a thing being done TO him, not a standard he answers to */
    hexIM.material.opacity = 0.4 + 0.2 * Math.sin(T * 6);
    for (let i = 0; i < on.length; i++) {
      const u = on[i];
      dum.position.set(u.x, groundH(u.x, u.y) + 1.2, u.y);
      dum.rotation.set(0, -T * 1.4, 0);
      dum.scale.set(1, 1, 1);
      dum.updateMatrix();
      hexIM.setMatrixAt(i, dum.matrix);
    }
    hexIM.count = on.length;
    hexIM.instanceMatrix.needsUpdate = true;
  }
  /* test handle: how many men are wearing chains this frame */
  R.debugHex = () => (hexIM ? hexIM.count : 0);

  /* ---------------- WHERE THE FIGHTING IS ----------------
   * The board is two thousand by two thousand four hundred and a phone shows a corner of it,
   * so the minimap is the only place the shape of a match is visible at all — and it showed
   * springs, Seats, curtains and your own standards, but nothing about where blows were
   * actually being struck. A player whose Gate is being eaten four hundred out learns it from
   * a banner that lasts three and a half seconds and then has nowhere to look.
   * A flashpoint is a PLACE, not an event: violence near an existing one bumps it rather than
   * making another, so a battle is one mark and not forty. It decays, so it says where the
   * fighting IS and not where it once was. And it is fed from the events the viewer was
   * already handed — `routeEvents` filters those by sight — so it cannot show what the veil
   * is hiding, for free and by construction. */
  const FLASH = { near: 190, life: 7, cap: 8, max: 6 };
  let flash2 = [];
  function flashAt(x, y, mine) {
    if (x == null || y == null) return;
    for (const f of flash2) {
      if ((f.x - x) * (f.x - x) + (f.y - y) * (f.y - y) > FLASH.near * FLASH.near) continue;
      /* the mark drifts toward the newest blow, so a running fight is one mark that MOVES */
      f.x += (x - f.x) * 0.25; f.y += (y - f.y) * 0.25;
      f.n = Math.min(FLASH.max, f.n + 1);
      f.ttl = FLASH.life;
      if (mine) f.mine = 1;
      return;
    }
    if (flash2.length >= FLASH.cap) {
      /* the quietest one gives up its place — a cap that dropped the NEWEST would go blind
       * exactly when a second front opened */
      let w = 0;
      for (let i = 1; i < flash2.length; i++) if (flash2[i].ttl < flash2[w].ttl) w = i;
      flash2.splice(w, 1);
    }
    flash2.push({ x, y, n: 1, ttl: FLASH.life, mine: mine ? 1 : 0 });
  }
  /* test handle: the flashpoints as the board currently has them. They are drawn straight to
   * the overlay canvas with no object per mark, so a suite has nothing else to read. */
  R.debugFlash = () => flash2.map((f) => ({ x: Math.round(f.x), y: Math.round(f.y), n: f.n,
                                            ttl: +f.ttl.toFixed(2), mine: !!f.mine }));

  R.addEvents = function (events, view, viewer) {
    if (!R.ready) return;
    for (const ev of events) {
      /* ---- WHAT COUNTS AS FIGHTING ----
       * A man falling, a work being struck, stone giving way. NOT a shot leaving a tower: a
       * gun firing at nothing in particular would light the map wherever a Watchtower stands,
       * and a Bombard shelling from beyond anyone's reach would mark ITS ground rather than
       * the stone it is breaking. What is HIT is where the fight is. */
      if (ev.e === 'die') flashAt(ev.x, ev.y, ev.owner === viewer);
      else if (ev.e === 'hurtcity' || ev.e === 'breach' || ev.e === 'raze' || ev.e === 'siege')
        flashAt(ev.x, ev.y, ev.pi === viewer);
      if (ev.e === 'shot' && ev.pi === viewer) {
        /* ---- A TOWER THROWS SOMETHING, AND IT COMES OUT OF THE GUN ----
         * This drew the old hairline tracer — the very thing the arrow rewrite replaced for
         * men, because a straight line between two points for a fifth of a second is what a
         * laser looks like — and it drew it from `groundH + 16`, which is INSIDE the tower's
         * own masonry about forty units below the ballista arms. So a Watchtower firing looked
         * like nothing at all. Reported from play as no arrows from the ballista and no
         * cannonballs from the towers.
         * The muzzle is the work's own measured crown (`w.top`, the same number the standard is
         * planted under), so a taller level and each branch's deck carry the shot up with them
         * and no constant can drift from the model. The Seat carries no work id — it is the
         * castle firing — and keeps its own height. */
        const wk = ev.id && cityObjs && cityObjs[ev.pi] && cityObjs[ev.pi].works.get(ev.id);
        const muzzle = wk ? wk.top * (wk.grp.scale.y || 1) + 1.5 + (wk.onWall || 0) - 4 : 74;
        /* a BALL from the cannon and the Seat, a DART from the ballista and the unforked
         * tower: one is thrown and bursts, the other is loosed and sticks. */
        if (ev.splash > 0)
          arrowFx(ev.x, ev.y, ev.to.x, ev.to.y, 0x2a2018,
                  { y1: muzzle, ball: 1, s: 1, speed: 430, arc: 0.30, rise: 90 });
        else
          arrowFx(ev.x, ev.y, ev.to.x, ev.to.y, 0xf0e2bc,
                  { y1: muzzle, s: 1.7, speed: 780, arc: 0.10, rise: 40 });
        if (ev.splash > 0) ringFx(ev.to.x, ev.to.y, 0xffb070, 0.32, ev.splash * 0.9);   // the burst
      } else if (ev.e === 'wshot') boltFx(ev.x, ev.y, ev.to.x, ev.to.y, 0xe8d8a8, 0.22);
      else if (ev.e === 'bolt') {
        /* WHO SHOT DECIDES WHAT IT LOOKS LIKE — and this is FEATURE-DETECTED, because the
         * shooter's kind is a field the sim only recently started putting on the event. An
         * archer's shot becomes a dart with a flight of its own; a sorcerer's, a warden's and
         * a binder's KEEP the arcane tracer they have always had, and so does an event that
         * carries no kind at all. */
        const tint = tintOf(ev.from.owner, viewer);
        if (ev.kind === 'archer') arrowFx(ev.from.x, ev.from.y, ev.to.x, ev.to.y, tint);
        else boltFx(ev.from.x, ev.from.y, ev.to.x, ev.to.y, tint, 0.3);
      } else if (ev.e === 'hex') {
        /* the chains, thrown. Feature-detected exactly like the field they leave behind: an
         * event shape the sim may not emit yet, drawn only when it arrives. */
        const to = ev.to || { x: ev.x, y: ev.y };
        if (ev.to) boltFx(ev.x, ev.y, to.x, to.y, 0xc48eff, 0.34);
        ringFx(to.x, to.y, 0xc48eff, 0.5, 16);
      } else if (ev.e === 'die') ringFx(ev.x, ev.y, tintOf(ev.owner, viewer), 0.5, 20);
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
    T += dt; lastDt = dt;
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
    redressCities(view, viewer);   // ...before the works: a court may have changed banners
    updateCities(view, viewer);
    updateGates(view, dt);        // ...after the works: a gate is hung on a run that exists
    updateWrit(view, viewer);
    updateBanner(view, viewer);
    updateStorms(view, viewer);
    updateArrows(dt);
    updateHex(view);
    updateFxs(dt);
    FOGU.uTime.value = T;      // the water ripples on this; see the `water` arm of fogPatch

    renderer.render(scene, cam);
    overlayPass(view, viewer);
  };

  /* every kind in the unit table gets a bucket, so adding one to const.js needs nothing here */
  /* ONE BUCKET PER KIND AND RANK. The army is drawn as instanced meshes, one per geometry —
   * so a veteran needs its own bucket or it would be drawn with the recruits' bodies. The
   * keys are `kind#tier`, and a kind with no rank still lands on `#1`, which is exactly the
   * bucket it always had. */
  const KINDS = [];
  for (const k of Object.keys(C.UNITS))
    for (let t = 1; t <= C.TIER.length; t++) KINDS.push(k + '#' + t);
  const rankOf = (u) => Math.max(1, Math.min(C.TIER.length, u.tier || 1));
  function makeIM(key, room) {
    const cut = key.indexOf('#');
    const im = new THREE.InstancedMesh(unitGeo(key.slice(0, cut), +key.slice(cut + 1)), MAT, room);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    /* An InstancedMesh is culled against a bounding sphere derived from its instance
     * matrices — computed ONCE, on the first frustum test, and cached. The trees get away
     * with it because their matrices are final before that test; these are written afresh
     * every frame, so the sphere was fixed forever around the world's origin corner and
     * the whole army was culled the moment the camera looked anywhere else. */
    im.frustumCulled = false;
    im._room = room;
    return im;
  }
  /* THE MEN ON THE STONE. A soldier the sim has put on a parapet (`u.man` = the wall's id)
   * is drawn ON it — squarely on the run, at the height of the walkway — and not in the grass
   * beside it. Without this the one bargain the whole wall design rests on is a rule with
   * nothing to see. The wall may belong to any heir whose works are in the view. */
  const wallById = (view, id) => {
    for (const pl of view.players) {
      for (const b of pl.buildings) if (b.id === id && b.x2 != null) return b;
      for (const g of (pl.ghosts || [])) if (g.id === id && g.x2 != null) return g;
    }
    return null;
  };
  function parapet(view, u) {
    if (!u.man) return null;
    const b = wallById(view, u.man);
    if (!b) return null;
    const ax = b.x * 2 - b.x2, ay = b.y * 2 - b.y2;
    const vx = b.x2 - ax, vy = b.y2 - ay, L2 = vx * vx + vy * vy || 1;
    let t = ((u.x - ax) * vx + (u.y - ay) * vy) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    /* AND HE FACES OUT. A man on a parapet turned whichever way he happened to be walking
     * when he got there, so a manned wall read as a queue rather than a line holding one.
     * The heading is the wall's outward normal — away from the Seat it shelters. */
    /* ...and OUT is the curtain's own answer, `b.face`, chained run to run in `noteWalls` and
     * carried on the wire — not this run's guess at the way home, which on a curving wall
     * turns the line round halfway along and faces half the garrison at the other half. The
     * city test is the fallback for a run the sim has not stamped. */
    let nx = -vy, ny = vx;
    if (b.face != null) { if (b.face > 0) { nx = -nx; ny = -ny; } }
    else {
      const cid = view.map.cities[u.owner];
      const c = cid != null ? view.map.sites[cid] : null;
      if (c && nx * (c.x - b.x) + ny * (c.y - b.y) > 0) { nx = -nx; ny = -ny; }
    }
    /* ...and a run its heir has TURNED ABOUT faces the other way, or the line on the parapet
     * would be facing its own reserve while the reserve took cover on the far side */
    if (b.flip) { nx = -nx; ny = -ny; }
    const nL = Math.hypot(nx, ny) || 1;
    return { x: ax + vx * t, y: ay + vy * t, h: 27, ang: Math.atan2(nx / nL, ny / nL) };
  }
  /* A GARRISON IS A BADGE, NOT A NEW TOWER. The men are INSIDE — nothing can touch them until
   * the stone comes down — so they are not drawn on the board at all (see the army pass, which
   * skips a man with `tow`); what the tower gains is a mark per man on its crown, so a filled
   * tower can be told from an empty one at a glance without rebuilding its silhouette. That is
   * the whole reason the badge has to be right: it is the ONLY sign of ten archers. Counted off
   * the units in the VIEW, so a rival's garrison shows only what you can actually see. */
  function garrisons(view) {
    let g = null;
    for (const u of view.units) {
      if (!u.in) continue;             // a shield on the crown means a man THROUGH the door
      if (!g) g = new Map();
      g.set(u.in, (g.get(u.in) || 0) + 1);
    }
    return g;
  }

  /* WHICH MEN THE NEXT TAP MOVES. Arming a standard is a question the board has to answer:
   * before this, a tray chip lit up and nothing on the ground did, so on a field with three
   * companies in it you tapped and hoped. game.js owns the answer (`game.armedFlag`) and the
   * renderer only READS it — the same one-way traffic as `R.selected` and `R.targeting`.
   * `R.armed` is the hook for game.js to hand it over directly; until it does, the flag is
   * read off Game.game, which is where it has always lived. */
  function armedCo() { return R.armed; }   // game.js hands it over, one way, like `selected`
  /* THE MARK ITSELF. The army is instanced by `kind#tier`, so a subset cannot have its own
   * geometry without splitting every bucket in two — instead the marked men keep their bucket
   * and are marked TWICE, both ways free of a draw call: their per-instance colour is pulled
   * toward the company's own pennant, and one extra instanced mesh lays a ring of that colour
   * on the ground under each of them. One mesh, one material, however many men. */
  /* its own geometry each time it is made, not one shared ring: buildWorld empties worldG by
   * disposing the geometry of everything in it, and a shared ring would be disposed out from
   * under the next match */
  const haloGeo = () => new THREE.RingGeometry(8.5, 11.5, 18).rotateX(-Math.PI / 2);
  function updateHalo(marked, co) {
    if (!marked.length) { if (haloIM) haloIM.count = 0; haloCo = null; return; }
    if (haloIM && marked.length > haloIM._room) {
      haloIM.removeFromParent(); haloIM.geometry.dispose(); haloIM.material.dispose();
      haloIM.dispose(); haloIM = null;
    }
    if (!haloIM) {
      let room = 256;
      while (room < marked.length) room *= 2;
      haloIM = new THREE.InstancedMesh(haloGeo(),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }),
        room);
      haloIM.name = 'affordance';
      haloIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      haloIM.frustumCulled = false;      // rewritten every frame — see makeIM
      haloIM.renderOrder = 1;
      haloIM._room = room;
      worldG.add(haloIM);
    }
    haloCo = co;
    haloIM.material.color.setHex(PENNANT[(co - 1) % PENNANT.length]);
    /* a slow breath, so the mark reads as live rather than as painted ground */
    haloIM.material.opacity = 0.45 + 0.22 * Math.sin(T * 4);
    const puff = 1 + 0.06 * Math.sin(T * 4);
    for (let i = 0; i < marked.length; i++) {
      const u = marked[i];
      dum.position.set(u.x, groundH(u.x, u.y) + 1.6, u.y);
      dum.rotation.set(0, 0, 0);
      dum.scale.set(puff, 1, puff);
      dum.updateMatrix();
      haloIM.setMatrixAt(i, dum.matrix);
    }
    haloIM.count = marked.length;
    haloIM.instanceMatrix.needsUpdate = true;
  }

  function updateUnits(view, viewer, dt) {
    const armed = armedCo();
    const marked = [];
    if (R.debugSlots) unitSlot.clear();
    const byKind = {};
    for (const k of KINDS) byKind[k] = [];
    for (const u of view.units) {
      /* A MAN INSIDE A TOWER IS INSIDE IT. Nothing can reach him and he is not standing in the
       * grass, so drawing him there would be a picture of a rule the sim no longer plays — the
       * tower wears one mark per man instead (see `garrisons`). He comes back the tick the
       * stone does, which is the moment the badge is worth having watched.
       * `in`, not `tow`: an ASSIGNED man is still walking to the door, and the walk is the
       * whole show — men file toward the tower and vanish one by one as the crown fills. */
      if (u.in) continue;
      const key = u.kind + '#' + rankOf(u);
      if (byKind[key]) byKind[key].push(u);
    }
    for (const kind of KINDS) {
      const list = byKind[kind];
      let im = unitIM[kind];
      /* the buffer was a fixed 260, which was the old muster cap plus Chaos. With no ceiling
       * on the muster that is a silent truncation — the men past 260 simply would not be
       * drawn — so it grows instead, in doublings, and never shrinks back. */
      if (im && list.length > im._room) { im.removeFromParent(); im.dispose(); im = null; }
      /* fifteen buckets now, and most of a match uses three of them — a rank nobody has
       * mustered yet should not cost a mesh */
      if (!im && !list.length) continue;
      if (!im) {
        let room = Math.max(256, (unitIM[kind] ? unitIM[kind]._room : 0) * 2);
        while (room < list.length) room *= 2;
        im = unitIM[kind] = makeIM(kind, room);
        worldG.add(im);
      }
      for (let i = 0; i < list.length; i++) {
        const u = list[i];
        let f = unitFace.get(u.id);
        if (!f) { f = { x: u.x, y: u.y, a: viewer === 0 ? Math.PI : 0 }; unitFace.set(u.id, f); }
        const mvx = u.x - f.x, mvy = u.y - f.y;
        if (mvx * mvx + mvy * mvy > 0.5) f.a = Math.atan2(mvx, mvy);
        f.x = u.x; f.y = u.y;
        /* the march bob belongs to marching. Ranks standing at the muster were hopping in
         * place two and a half times a second, which reads as a shiver rather than as men at
         * rest. Smooth the speed rather than test it — a guest gets positions at 10 Hz, so a
         * raw per-frame delta is zero five frames in six and would strobe. */
        const sp = Math.sqrt(mvx * mvx + mvy * mvy) / Math.max(1e-4, dt);
        f.sp = f.sp == null ? sp : f.sp + (sp - f.sp) * Math.min(1, dt * 6);
        const bob = Math.min(1, f.sp / 20) * 1.6;
        /* on the parapet: stand ON the run, at walkway height, facing out over it. Men do not
         * bob up there — they are holding a wall, not marching. */
        const par = u.man ? parapet(view, u) : null;
        if (par) {
          dum.position.set(par.x, groundH(par.x, par.y) + par.h, par.y);
          dum.rotation.set(0, par.ang, 0);
          f.a = par.ang;                        // and he keeps that facing when he steps down
        } else {
          dum.position.set(u.x, groundH(u.x, u.y) + Math.abs(Math.sin(T * 8 + u.id)) * bob, u.y);
          dum.rotation.set(0, f.a, 0);
        }
        const s2 = (u.kind === 'champion' ? 1.35 : 1) * (1 + (rankOf(u) - 1) * 0.06);
        dum.scale.set(s2, s2, s2);
        dum.updateMatrix();
        im.setMatrixAt(i, dum.matrix);
        colTmp.setHex(tintOf(u.owner, viewer));
        /* the armed company's own men, lit toward their standard's colour. Every seat is a
         * different tint and the pennants are a different set again, so this cannot be read
         * as a change of owner. */
        if (armed && u.owner === handOf(viewer) && u.co === armed) {
          colTmp.lerp(penTmp.setHex(PENNANT[(armed - 1) % PENNANT.length]), 0.6);
          marked.push(u);
        }
        im.setColorAt(i, colTmp);
        if (R.debugSlots) unitSlot.set(u.id, kind + '|' + i);
      }
      im.count = list.length;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    /* forget the dead. This asked `view.units.some(...)` per remembered id, which is a scan of
     * the whole army for every man in it — the one place the renderer went quadratic, and it
     * was invisible while a cap held the army to a hundred. */
    if (unitFace.size > view.units.length) {
      const live = new Set();
      for (const u of view.units) live.add(u.id);
      for (const id of unitFace.keys()) if (!live.has(id)) unitFace.delete(id);
    }
    updateHalo(marked, armed);
    updateReachRing(view, viewer, armed);
    updateTiles(view, viewer);
  }

  /* ---------------- the detail tiles ----------------
   * The painterly ground, spent where the camera is. A 3×3 neighbourhood of 1200-unit tiles
   * follows the view; a missing tile is baked ONE PER FRAME (a tile is a small painterly
   * bake — the hitch budget is one tile), stood a hair above the cheap base on the same
   * relief, and the stalest off-view tile is retired past twelve resident. Every mesh hangs
   * in worldG, so a new match's sweep disposes them wholesale — the manager only has to
   * forget its handles (buildWorld resets tileMap). */
  function updateTiles(view, viewer) {
    if (!tiled || !tileMap) return;
    const cx = R.camX + viewW / 2, cy = R.camY + viewH * 0.5;
    const tx = Math.floor(cx / TILE), ty = Math.floor(cy / TILE);
    const want = new Set();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const ix = tx + dx, iy = ty + dy;
      if (ix < 0 || iy < 0 || ix * TILE >= mapW || iy * TILE >= mapH) continue;
      want.add(ix + ':' + iy);
    }
    for (const key of want) {
      const t = tileMap.get(key);
      if (t) { t.at = T; continue; }
      if (!tileQueue.includes(key)) tileQueue.push(key);
    }
    /* one bake a frame, and only if it is still wanted by the time its turn comes */
    let key = null;
    while (tileQueue.length && key == null) {
      const k = tileQueue.shift();
      if (want.has(k) && !tileMap.has(k)) key = k;
    }
    if (key != null) {
      const ix = +key.split(':')[0], iy = +key.split(':')[1];
      const rect = { x0: ix * TILE, y0: iy * TILE,
                     x1: Math.min(mapW, (ix + 1) * TILE), y1: Math.min(mapH, (iy + 1) * TILE) };
      const bk = global.Terrain.bake(view, viewer, { props: false, labels: false, rect, px: 1.1 });
      const w = rect.x1 - rect.x0, h = rect.y1 - rect.y0;
      const geo = new THREE.PlaneGeometry(w, h,
        Math.min(96, Math.round(w / 25)), Math.min(96, Math.round(h / 25)));
      geo.rotateX(-Math.PI / 2);
      geo.translate(rect.x0 + w / 2, 0, rect.y0 + h / 2);
      const pp = geo.attributes.position;
      /* ON the base, not over it. This used to lift the tile 3.0 units clear, because the two
       * reliefs were the same field sampled at two densities and the finer one rose off the
       * coarser one by up to 21 units — so they crossed, and the lift was a compromise that
       * both failed to clear the worst of it AND buried everything standing on the ground
       * under it: a spring's pool sits 1.5 up and vanished, which is what a country's springs
       * looking like holes in the earth actually was. `groundH` answers for the base mesh's
       * own triangles now, so a tile's vertices lie exactly ON them and its triangles are
       * sub-triangles of theirs. Coplanar is what polygonOffset is for, and the tiny lift is
       * belt to its braces over a country-sized depth range. */
      for (let i = 0; i < pp.count; i++) pp.setY(i, groundH(pp.getX(i), pp.getZ(i)) + 0.15);
      geo.computeVertexNormals();
      const tex = new THREE.CanvasTexture(bk.canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(geo, fogPatch(new THREE.MeshLambertMaterial({
        map: tex, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2
      }), 'slope'));
      worldG.add(mesh);
      tileMap.set(key, { mesh, tex, at: T });
    }
    if (tileMap.size > 12) {
      let oldK = null, oldAt = Infinity;
      for (const [k, t] of tileMap) if (!want.has(k) && t.at < oldAt) { oldAt = t.at; oldK = k; }
      if (oldK) {
        const t = tileMap.get(oldK);
        t.mesh.removeFromParent();
        t.mesh.geometry.dispose();
        t.mesh.material.map.dispose();
        t.mesh.material.dispose();
        tileMap.delete(oldK);
      }
    }
  }

  /* THE REACH, DRAWN WHERE THE DECISION IS MADE. Arming a standard in a reach world is the
   * moment the border matters — the next tap is refused past it — so the armed company's
   * city wears its whole disc as a ground-following line, the writ outline's own idiom. An
   * `affordance` by name (the veil's one sanctioned exemption), rebuilt only when the armed
   * city or its reach changes, because the ground under the ring never moves mid-match. */
  let reachLine = null, reachKey = '';
  function updateReachRing(view, viewer, armed) {
    let key = '', c = null;
    const hv = handOf(viewer);
    if (armed != null && view.rules && view.rules.reach && view.players[hv]) {
      const co = (view.players[hv].companies || []).find((q) => q.id === armed);
      c = co && co.city != null && view.cities ? view.cities[co.city] : null;
      if (c && c.reach) key = co.city + ':' + Math.round(c.reach); else c = null;
    }
    if (key !== reachKey) {
      if (reachLine) {
        reachLine.removeFromParent(); reachLine.geometry.dispose(); reachLine.material.dispose();
        reachLine = null;
      }
      reachKey = key;
      if (c) {
        const pts = [];
        for (let i = 0; i <= 128; i++) {
          const a = (i / 128) * Math.PI * 2;
          const x = c.x + Math.cos(a) * c.reach, y = c.y + Math.sin(a) * c.reach;
          pts.push(new THREE.Vector3(x, groundH(x, y) + 2.5, y));
        }
        reachLine = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.5, depthWrite: false }));
        reachLine.name = 'affordance';
        worldG.add(reachLine);
      }
    }
    /* the same slow breath the halo takes, so the border reads as live rather than painted */
    if (reachLine) reachLine.material.opacity = 0.35 + 0.18 * Math.sin(T * 2.5);
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
          /* WHOSE SPRING, by BANNER. A Gate raised by a lord sworn to you was ringed in the
           * enemy's crimson — reported from play looking at a spring inside a city he had
           * just taken. `tintOf` is the one answer to "whose colour is this". */
          so.ring.material.color.setHex(tintOf(st.holder, viewer));
          so.ring.material.opacity = st.live ? 0.65 : 0.3;
        }
        /* nothing is built ON a site any more — a Gate is a work standing near one, and the
         * city group draws it. Only the ownership ring belongs to the site itself. */
      }
    }
  }

  function updateCities(view, viewer) {
    /* one pass for the whole board rather than one per tower: who is up which tower */
    const gar = garrisons(view);
    for (let pi = 0; pi < cityObjs.length; pi++) {
      const g = cityObjs[pi];
      const pl = view.players[pi];
      /* ---- "MINE" IS ASKED EVERY FRAME, AND IT IS THE BANNER'S ----
       * `g.own` was `pi === viewer`, decided once in `buildCity` and never revisited — the
       * same assumption `redressCities` was written to undo one level up, left standing here.
       * So a court taken from another lord kept every one of its works dressed as an enemy's:
       * the dark foe pad under them, no selection highlight, and — the reported symptom —
       * NO COMPANY STANDARD, because the pennant hangs behind this test. The halls went on
       * mustering into the company they were assigned to and the men came out under its
       * colours, while the hall over them flew nothing.
       * It is the realm's question, not the seat's: a sworn lord's works are my banner's, his
       * `co` rides to me in full (`Net.snapFor`'s `mine`), and a rival's company is a secret
       * that must stay one. `own` stays on the group for the city-level readers below.
       * A view with no realms on it (a board, a chronicle's half-world) falls through to the
       * seat rule, exactly as `tintOf` does — the renderer stays isolated and asks `global`. */
      g.own = mineOf(view, viewer, pi);
      const own = g.own;
      /* A RIVAL'S COURT STAYS OUT OF THE WORLD UNTIL SOMEBODY HAS SEEN THAT ONE — the court,
       * not the realm. `continue` here skipped the whole works loop for an unfound seat, and
       * since a work's group is only ever built by this loop, every OUTLYING work they owned
       * was invisible however plainly it stood in sight: a forward Gate on a contested spring
       * showed its hp bar (the overlay reads the snapshot directly) over bare ground.
       * Reported from play. The snapshot is already fog-filtered per WORK — what rides it is
       * what a man of yours can see — so the veil here has exactly one job: the city disc and
       * the Seat tower, which worldgen placed and fog has not yet confirmed. */
      if (!g.own) g.group.visible = seatFound(view, pi);
      /* works stand where they were placed. A rival's work you can no longer see is a
       * ghost — drawn faint, at the place you last saw it. */
      const want = new Map();
      for (const b of pl.buildings) want.set(b.id, { b, ghost: false });
      if (!g.own) for (const gh of (pl.ghosts || [])) if (!want.has(gh.id)) want.set(gh.id, { b: gh, ghost: true });

      for (const [id, { b, ghost }] of want) {
        /* a work still going up gets its own key, so finishing it rebuilds the group at full
         * colour rather than leaving the scaffolding materials behind */
        /* a wall's key carries its ENDS: two runs of the same type are not the same model */
        /* the key carries everything that changes the MODEL: the branch, a wall's ends, the
         * LEVEL, and whether it is scaffolded — so raising a level rebuilds the group at the
         * new shape instead of leaving last level's stones standing. */
        /* ...and its DAMAGE step, so a work being taken apart is taken apart on the board and
         * not only in a number. A ghost has no hp on the wire, so it is never hurt. */
        const hurt = ghost ? 0 : hurtOf(b);
        /* THE MODEL KEY IS PART OF THE CACHE KEY, not a second spelling of it. These were two
         * separate expressions and they drifted: the cache key learned the branch and the
         * garrison, the model key did not, so a Barracks that chose the Shieldwall was rebuilt
         * as the same plain hall as one that chose the Outriders and every branch arm in
         * `buildingModel` below the tower's was unreachable. Written this way the model asked
         * for is by construction the model the cache is keyed on. */
        const mkey = modelKey(b, gar && gar.get(id), hurt);
        const key = mkey
          + (b.x2 != null ? ':' + Math.round(b.x2) + ',' + Math.round(b.y2) + ',' + Math.round(b.x) + ',' + Math.round(b.y) : '')
          + (b.breach ? '!' : '') + (b.onWall ? '=' : '')
          /* ...AND THE COMPANY WHOSE STANDARD IT FLIES. A hall's pennant is built into its
           * group, so it is as much a part of what is drawn as a level or a breach — and it
           * was the one such thing missing from this key. `{c:'assign'}` moved a hall to
           * another company, the men changed colour, the tray chip changed, and the flag over
           * the hall went on being the old company's until something ELSE (a level, a wound,
           * a mason) happened to rebuild the group. */
          + (b.co ? '/' + b.co : '')
          /* ...AND WHETHER IT IS MINE, which is no longer decided once at the city's birth.
           * A court that changes hands re-dresses its works — the pad under them, and the
           * company standard, which only flies over a hall of my own banner — so "mine" is as
           * much a part of what is drawn as the level or the breach, and a group built before
           * the oath must not survive it. */
          + (own ? '&' : '')
          + (ghost ? '~' : '') + (b.raise > 0 ? '^' : '') + (b.work > 0 ? '#' : '');
        let w = g.works.get(id);
        if (!w || w.key !== key) {
          if (w) { w.grp.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); w.grp.removeFromParent(); }
          const grp = new THREE.Group();
          const isW = b.x2 != null;
          let w2gate = null;
          /* a tower BUILT INTO a curtain stands on the parapet, not on the grass beside it —
           * it is the one work whose height is not the ground's */
          const onWall = b.onWall ? 27 : 0;
          const pad = isW
            ? new THREE.Mesh(new THREE.PlaneGeometry(Math.hypot(b.x2 - b.x, b.y2 - b.y) * 2 + 26, 34)
                .rotateX(-Math.PI / 2).rotateY(-Math.atan2(b.y2 - b.y, b.x2 - b.x)),
                fogPatch(new THREE.MeshLambertMaterial({ color: own ? 0x46382a : 0x3a222a, transparent: true, opacity: 0.9 })))
            : new THREE.Mesh(new THREE.CircleGeometry(24, 12).rotateX(-Math.PI / 2),
                fogPatch(new THREE.MeshLambertMaterial({ color: own ? 0x46382a : 0x3a222a, transparent: true, opacity: 0.9 })));
          pad.position.y = -0.4;
          grp.add(pad, isW ? wallModel(b, hurt) : buildingModel(mkey));
          /* THE GATE HANGS ON THE FINISHED RUN. A breached run is rubble and has no gateway to
           * shut; a rising one is a shell, and the doors arrive with the stone. `gated` is the
           * sim's own answer to whether this run is long enough to spare a gateway, and it
           * rides the wire, so a guest hangs the same doors. */
          if (isW && !ghost && b.gated && !b.breach && !(b.raise > 0)) {
            w2gate = gateLeaves(b);
            grp.add(w2gate.grp);
          }
          /* a work about to go leans. It is a small angle on purpose — enough that a ruinous
           * hall reads as one out of the corner of the eye, not so much that the board looks
           * broken — and a curtain is spared it, since a whole run tipping together would
           * lift one end of it clear off the ground. */
          if (!isW && hurt > 1) grp.rotation.z = 0.05;
          if (own && C.BUILDINGS[b.bt] && C.BUILDINGS[b.bt].spawns) {
            /* the company's pennant flies over its mustering hall */
            /* the hall flies its COMPANY's colour, and every hall has one */
            const pole = meshOf([part(cyl(0.6, 0.6, 28, 4), 0xd8c8a8, 14, 33, 8)]);
            const pf = new THREE.Mesh(new THREE.PlaneGeometry(15, 9).translate(7.5, 0, 0),
              fogPatch(new THREE.MeshBasicMaterial({ color: b.co ? PENNANT[(b.co - 1) % PENNANT.length] : 0xffd98a,
                                            side: THREE.DoubleSide })));
            pf.position.set(14, 42, 8);
            pf.name = 'standard';
            grp.add(pole, pf);
          }
          if (b.bt === 'shrine') {
            const spiral = new THREE.Mesh(new THREE.CircleGeometry(17, 18).rotateX(-Math.PI / 2),
              fogPatch(new THREE.MeshBasicMaterial({ color: 0x9cc8ff, transparent: true, opacity: 0.5 })));
            spiral.position.y = 11;
            grp.add(spiral);
          }
          if (ghost) grp.traverse((o) => {
            if (!o.material) return;
            o.material = fogPatch(o.material.clone());   // a clone loses the veil — see the note in the fall
            o.material.transparent = true; o.material.opacity = 0.34;
          });
          /* scaffolding: pale and see-through, and it grows out of the ground as it rises.
           * A work having its LEVEL raised wears the same scaffolding — it is standing and
           * whole, but the masons are in it and it is doing its job for nobody, and that has
           * to be visible from across the board or the pause in the muster is a mystery. */
          else if (b.raise > 0 || b.work > 0) grp.traverse((o) => {
            if (!o.material) return;
            o.material = fogPatch(o.material.clone());   // a clone loses the veil — see the note in the fall
            o.material.transparent = true;
            o.material.opacity = b.raise > 0 ? 0.55 : 0.72;
            if (o.material.color) o.material.color.lerp(new THREE.Color(0x6a5f4a), b.raise > 0 ? 0.5 : 0.3);
          });
          worldG.add(grp);
          /* HOW TALL THIS WORK ACTUALLY IS, asked of the model rather than guessed from its
           * type. The standard over a held work was placed at `62 + (level-1)*9` for a tower,
           * which is one branch of one work at one moment: a Watchtower's shaft grows with its
           * level, each branch piles its own deck on top, a garrison hangs shields on the
           * crown, and a bastion is lifted again by the curtain under it. Reported from play
           * as a flag buried in the tower roof. Measured once, when the group is built and
           * before it is placed or scaled, so it costs nothing per frame and cannot drift from
           * the geometry — a new branch or a taller level carries its flag up with it. */
          const bb = new THREE.Box3().setFromObject(grp);
          w = { grp, key, pad, onWall, gate: w2gate, top: isFinite(bb.max.y) ? bb.max.y : 0 };
          g.works.set(id, w);
        }
        w.grp.position.set(b.x, groundH(b.x, b.y) + 1.5 + (w.onWall || 0), b.y);
        w.grp.scale.y = b.raise > 0 ? 0.3 + 0.7 * (1 - b.raise / (b.raiseFor || 1)) : 1;
        /* the door reads its run's CURRENT row every frame — `flip` is a command and a guest's
         * rows are rebuilt out of each snapshot, so a reference taken at build time would be a
         * reference to the wall as it stood one order ago */
        if (w.gate) { w.gate.row = b; w.gate.city = { x: g.cx, y: g.cy }; }
        w.seen = true;
        if (own) w.pad.material.color.setHex(R.selected === id ? 0x8a6c3c : 0x46382a);
      }
      for (const [id, w] of [...g.works]) {
        if (w.seen) { w.seen = false; continue; }
        w.grp.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
        w.grp.removeFromParent(); g.works.delete(id);
        /* a work that is gone takes its damage bookkeeping with it — these are keyed by id
         * and ids are never reused, so nothing would ever clear them otherwise */
        hurtMem.delete(id); hpMem.delete(id); flash.delete(id); barRec.delete(id);
      }
    }
  }
  /* THE WRIT, in three dimensions: the union boundary of your claim discs, laid on the
   * ground it actually follows. Rebuilt only when a claiming work rises or falls. */
  let writG = null, writKey = '';
  function updateWrit(view, viewer) {
    /* the writ you may BUILD in is the hand's, not the seat's */
    const anchors = global.Terrain.claimAnchors(view, handOf(viewer));
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
    /* THE WRIT GOES UNDER THE VEIL LIKE THE GROUND IT IS DRAWN ON. It is a line, not a mesh,
     * and a line's material was the one thing in the frame nothing darkened: the 2D overlay
     * paints across the whole canvas and dimmed it by accident, the shader only touches the
     * materials it is given, and the difference showed up as a bright gold arc lying across
     * black shroud — read, fairly, as the writ and the sight disagreeing about where the
     * ground is. They never disagreed; one of them was simply not being darkened. */
    writG = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts),
      fogPatch(new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.85 })));
    worldG.add(writG);
  }

  function updateBanner(view, viewer) {
    const b = view.players[viewer].banner;
    bannerG.visible = !!b;
    if (b) {
      bannerG.position.set(b.x + (viewer === 0 ? 26 : -26), groundH(b.x, b.y), b.y);
      bannerG._flag.rotation.y = Math.sin(T * 2.6) * 0.25;
    }
    /* THE COLOURS ARE CARRIED, and that is the one that matters. A post at the rally says
     * where you SENT a company; a standard over the column says which company you are looking
     * at, which is the question a board with three of them out actually asks. The sim names
     * the bearer (World.bearers) — the senior man in the open — so every machine at a LAN
     * table flies it over the same soldier without a byte agreeing it, and when he falls the
     * next man has it on the same tick.
     * Drawn BIG on purpose: this is read at a glance, across a fight, on a phone. The pole
     * stands well clear of a man's head and the flag is more than twice the rally post's. */
    const me = view.players[handOf(viewer)];
    const active = new Set();
    const byId = new Map();
    for (const u of view.units) if (u.owner === handOf(viewer)) byId.set(u.id, u);
    for (const co of (me.companies || [])) {
      const u = co.bearer != null && byId.get(co.bearer);
      /* a bearer inside a tower is not drawn and neither is his flag — the sim already passes
       * the standard over him while anyone is standing in the open, so this is only the case
       * where the WHOLE company is shut in */
      if (!u || u.tow) continue;
      const key = 'b' + co.id;
      active.add(key);
      let f = coFlags.get(key);
      if (!f) {
        f = new THREE.Group();
        const pole = meshOf([part(cyl(0.8, 0.8, 46, 5), 0xd8c8a8, 0, 23, 0)]);
        const pf = new THREE.Mesh(new THREE.PlaneGeometry(22, 13).translate(11, 0, 0),
          fogPatch(new THREE.MeshBasicMaterial({ color: PENNANT[(co.id - 1) % PENNANT.length],
                                                 side: THREE.DoubleSide })));
        pf.position.set(0, 39, 0);
        f.add(pole, pf); f._flag = pf;
        worldG.add(f);
        coFlags.set(key, f);
      }
      f.position.set(u.x, groundH(u.x, u.y), u.y);
      f._flag.rotation.y = Math.sin(T * 2.2 + co.id) * 0.3;
    }
    const cos = (me.companies || []).filter((co) => co.rally);
    cos.forEach((s, i) => {
      /* AN ORDER MEANT LITERALLY LOOKS LIKE ONE, and it is said the way the player said it:
       * TWO pennants on the pole, because the order was given twice. Without this the two
       * kinds are indistinguishable on the board — the men behave completely differently and
       * nothing on screen says which order they are under, which is the state the whole
       * feature would have shipped in. The hardness is part of the POOL KEY, so a marker
       * built for an ordinary rally cannot survive the order being repeated, and one built
       * for a forced order comes down the moment it lapses. */
      const hard = !!(s.hard && s.hard > (view.t || 0));
      const key = s.id + (hard ? '!' : '');
      active.add(key);
      let f = coFlags.get(key);
      if (!f) {
        f = new THREE.Group();
        const pole = meshOf([part(cyl(0.7, 0.7, 34, 5), 0xd8c8a8, 0, 17, 0)]);
        const tint = PENNANT[(s.id - 1) % PENNANT.length];
        const pennant = (y2) => {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(17, 10).translate(8.5, 0, 0),
            fogPatch(new THREE.MeshBasicMaterial({ color: tint, side: THREE.DoubleSide })));
          m.position.set(0, y2, 0);
          return m;
        };
        const pf = pennant(29);
        f.add(pole, pf); f._flag = pf;
        if (hard) { const pf2 = pennant(16); f.add(pf2); f._flag2 = pf2; }
        worldG.add(f);
        coFlags.set(key, f);
      }
      const a2 = (i / Math.max(1, cos.length)) * Math.PI * 2;
      const fx2 = s.rally.x + Math.cos(a2) * 32, fz2 = s.rally.y + Math.sin(a2) * 32;
      f.position.set(fx2, groundH(fx2, fz2), fz2);
      f._flag.rotation.y = Math.sin(T * 2.2 + i) * 0.3;
      if (f._flag2) f._flag2.rotation.y = Math.sin(T * 2.2 + i + 0.7) * 0.3;
    });
    /* AND THE STONE FLIES THE STANDARD OF WHOEVER HOLDS IT. A garrisoned tower shows shield
     * badges and a manned wall shows the men — but neither says WHOSE they are without
     * tapping, and on a board with three companies out that is the question. One pennant per
     * held work, the company's own colour, keyed into the same pool as the rally standards
     * (string keys, so a work id can never collide with a company id). Majority company wins
     * a mixed roster: the flag says who HOLDS the stone, not everyone visiting it. Own works
     * only — a rival's company identity is private on the wire, and the badge count is
     * already everything a rival is entitled to read. */
    const held = new Map();   // workId -> { counts: Map(co->n), b }
    const ownG = cityObjs && cityObjs[viewer];
    const ownWorks = new Map();
    for (const b of (view.players[viewer].buildings || [])) ownWorks.set(b.id, b);
    for (const u of view.units) {
      if (u.owner !== viewer || !u.co) continue;
      const wid = u.in || u.man || 0;
      if (!wid || !ownWorks.has(wid)) continue;
      let h = held.get(wid);
      if (!h) { h = { counts: new Map(), b: ownWorks.get(wid) }; held.set(wid, h); }
      h.counts.set(u.co, (h.counts.get(u.co) || 0) + 1);
    }
    for (const [wid, h] of held) {
      let co = 0, n = 0;
      for (const [c2, k] of h.counts) if (k > n) { n = k; co = c2; }
      if (!co) continue;
      const key = 'w' + wid;
      active.add(key);
      let f = coFlags.get(key);
      if (!f) {
        f = new THREE.Group();
        const pole = meshOf([part(cyl(0.7, 0.7, 26, 5), 0xd8c8a8, 0, 13, 0)]);
        const pf = new THREE.Mesh(new THREE.PlaneGeometry(12, 7).translate(6, 0, 0),
          fogPatch(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })));
        pf.position.set(0, 23, 0);
        f.add(pole, pf); f._flag = pf;
        worldG.add(f);
        coFlags.set(key, f);
      }
      f._flag.material.color.setHex(PENNANT[(co - 1) % PENNANT.length]);
      /* the flag is planted just under the work's own crown, whatever that work is: the pole
       * is 26 and the pennant sits at 23 of it, so it clears the roof by a good margin. The
       * height is the model's measured top (see `w.top` where the group is built), lifted by
       * whatever the group itself is lifted by — a bastion rides its curtain — and scaled with
       * it, so a work still going up flies its standard at the height it has reached. */
      const b = h.b;
      const wk = ownG && ownG.works.get(wid);
      const lift = wk ? wk.top * (wk.grp.scale.y || 1) + 1.5 + (wk.onWall || 0) - 6
                      : (b.bt === 'tower' ? 62 : b.x2 != null ? 30 : 24);
      f.position.set(b.x, groundH(b.x, b.y) + lift, b.y);
      f._flag.rotation.y = Math.sin(T * 2.2 + wid) * 0.3;
    }
    for (const [i, f] of [...coFlags]) if (!active.has(i)) { f.removeFromParent(); coFlags.delete(i); }
  }

  function updateStorms(view, viewer) {
    driveSeatFalls();
    /* AS MANY AS ARE RAGING. The pool was a hard [0, 1] — two lights, two discs — which was
     * every storm a duel can hold and one fewer than a four-handed table can: the third
     * Jewel cast simply did not draw, sim and snapshot both carrying a storm the board never
     * showed. The pool grows to what the view brings and idles the rest. */
    const list = view.storms || [];
    while (stormState.length < Math.max(2, list.length)) {
      const l = new THREE.PointLight(0xff6a5a, 0, 420);
      scene.add(l);
      stormState.push({ light: l });
    }
    for (let i = 0; i < stormState.length; i++) {
      const st = list[i], ss = stormState[i];
      if (!st) {
        ss.light.intensity = 0;
        if (ss.disc) ss.disc.visible = false;
        if (ss.lines) ss.lines.visible = false;
        continue;
      }
      if (!ss.disc) {
        ss.disc = new THREE.Mesh(new THREE.CircleGeometry(C.POWERS.storm.radius, 26).rotateX(-Math.PI / 2),
          fogPatch(new THREE.MeshBasicMaterial({ color: 0x1e0a14, transparent: true, opacity: 0.45, depthWrite: false })));
        worldG.add(ss.disc);
        ss.lines = new THREE.LineSegments(new THREE.BufferGeometry(),
          fogPatch(new THREE.LineBasicMaterial({ color: 0xffdcdc, transparent: true })));
        worldG.add(ss.lines);
      }
      ss.disc.visible = true;
      /* THE SHADOW LIES ON THE GROUND, NOT ON A PLANE THROUGH IT. A flat disc three units up
       * was fine while the world was flat; on real terrain the ground pokes through it and the
       * hill's own slope hides the rest — a storm on a hillside showed as half a storm, which
       * on a power you AIM is half the information. Same fault the spring pools had, and the
       * springs' cure (level the ground in worldgen) is not available to a storm cast anywhere
       * — so the disc conforms instead: each vertex is dropped onto the ground beneath it. Done
       * once per cast, keyed on the storm's spot; a storm does not move. */
      if (ss.at !== st.x * 1e5 + st.y) {
        ss.at = st.x * 1e5 + st.y;
        const pos = ss.disc.geometry.attributes.position;
        for (let vi = 0; vi < pos.count; vi++)
          pos.setY(vi, groundH(st.x + pos.getX(vi), st.y + pos.getZ(vi)) + 2.5);
        pos.needsUpdate = true;
        ss.disc.geometry.computeBoundingSphere();
      }
      ss.disc.position.set(st.x, 0, st.y);
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
    /* a flashpoint fades on its own; the fighting has to keep saying so to keep it lit */
    for (let i = flash2.length - 1; i >= 0; i--) {
      flash2[i].ttl -= dt;
      if (flash2[i].ttl <= 0) flash2.splice(i, 1);
    }
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
  /* scratches the size of the overlay: one for the edge-of-sight band, one for the mask of
   * remembered ground. Both are composited whole, so neither can seam against itself. */
  /* `shrink` draws the scratch at a FRACTION of the overlay's size. Everything drawn into it is
   * in overlay coordinates — the transform does the scaling — so a caller only has to say how
   * coarse it wants to be, and composite the result back over the full rectangle. */
  function scratch(store, shrink) {
    if (typeof document === 'undefined') return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) / (shrink || 1);
    if (!store.cv) { store.cv = document.createElement('canvas'); store.c2 = store.cv.getContext('2d'); }
    const w2 = Math.max(1, Math.round(W * dpr)), h2 = Math.max(1, Math.round(H * dpr));
    if (store.cv.width !== w2 || store.cv.height !== h2) {
      store.cv.width = w2; store.cv.height = h2;
    }
    /* the transform is reset by a resize and must be re-stated every frame anyway, since the
     * shrink can change with the zoom */
    store.c2.setTransform(w2 / W, 0, 0, h2 / H, 0, 0);
    return store.c2;
  }
  /* THE WRAPPER MUST FORWARD THE SHRINK. `memCtx` was `() => scratch(memStore)` — a zero-arg
   * wrapper — while the veil called `memCtx(shrink)`; the argument fell on the floor, the
   * scratch stayed full-size, and the "softening by upscale" was a 1:1 blit that softened
   * nothing. On a desktop window the fog cells are a few pixels and the staircase hides; on a
   * phone a cell is ~100 device pixels and the mask's raw grid marched across the screen —
   * which is why four SwiftShader reproductions came back clean and one Android photo did not. */
  const rimStore = {}, memStore = {}, midStore = {}, visStore = {}, fogStore = {}, fogMid = {};
  const rimCtx = () => scratch(rimStore);
  const visCtx = (k) => scratch(visStore, k);
  const memCtx = (shrink) => scratch(memStore, shrink);
  const midCtx = (shrink) => scratch(midStore, shrink);
  const fogCtx = (shrink) => scratch(fogStore, shrink);
  const fogMidCtx = (shrink) => scratch(fogMid, shrink);
  /* THE THREE STATES OF GROUND, AND WHY FOG NEEDS A COLOUR OF ITS OWN.
   *   SHROUD — never seen. Black.
   *   FOG    — seen once, not seen now. You remember the land; you do not know what stands
   *            on it. Drawn from the viewer's `seen` mask minus what he can see this instant.
   *   SIGHT  — watched right now. Clear.
   * Fog used to be nothing but LESS SHROUD: the same near-black at 45% of its strength. Three
   * states along one axis, which is why it never read as fog — reported from play as
   * "explored ground looks lighter than ground in view". Dimming does not say "remembered",
   * it just flattens contrast, and a flattened mid-tone beside high-contrast lit country
   * reads as paler even when it is measurably darker (measured: 0.024 sight, 0.367 fog,
   * 0.818 shroud — the ordering was right and it still looked wrong).
   * So fog gets its own HUE instead of a fraction of the shroud's: the explored region is
   * punched clear of the shroud entirely, and a cold slate wash is laid back over the part of
   * it nobody is watching. Warm and clear where you look, cold and drained where you only
   * remember, black where you have never been — three readings on two axes.
   * The wash is kept DARK on purpose. A mid-grey would lighten night terrain and reintroduce
   * exactly the complaint; this only ever darkens, and cools while it does.
   * (True desaturation is what most games use and would be better still. It is not available
   * here: the veil is a 2D canvas layered OVER the WebGL canvas, so no composite op of ours
   * can reach the pixels beneath, and CSS mix-blend-mode is all-or-nothing for the element.
   * Draining fog's colour properly wants the visibility mask sampled in the ground shader.) */
  /* dark enough that it can only ever DARKEN. A mid-tone slate would lighten night terrain
   * and bring back the very complaint this fixes, so the wash sits below the darkest ground
   * the board paints; the blue lead over the red is what carries the "cold" read. */
  const FOG_WASH = [12, 16, 30];

  /* about how many screen pixels a world unit spans at the middle of the view — enough to
   * size a blur by, not a projection */
  function scaleOf() {
    const a = proj(R.camX + viewW / 2, 0, R.camY + viewH * 0.62);
    const b = proj(R.camX + viewW / 2 + 100, 0, R.camY + viewH * 0.62);
    return a.ok && b.ok ? Math.abs(b.x - a.x) / 100 : 0.5;
  }

  function overlayPass(view, viewer) {
    const g = octx;
    g.clearRect(0, 0, W, H);
    /* fog of war, projected: dark veil with soft elliptical holes at each vision source */
    /* A FALLEN HEIR HAS NO VEIL — he spectates, and the cheapest fog is none: skip the dark
     * fill, the mask march, the discs and the rim in one test rather than asking each pass
     * to notice an all-ones mask. */
    if (!view.allSeen) {
    if (!R.shaderFog) {
      g.fillStyle = 'rgba(6,4,12,0.86)';
      g.fillRect(0, 0, W, H);
    }
    /* project every sight disc ONCE — the holes and the rim are both drawn from these */
    const discs = [];
    for (const [x, y, r2] of view.visSources) {
      const gh = groundH(x, y) + 2;
      const c2 = proj(x, gh, y);
      if (!c2.ok) continue;
      const eH = proj(x + r2, gh, y), eV1 = proj(x, gh, y - r2), eV2 = proj(x, gh, y + r2);
      const rx = Math.abs(eH.x - c2.x), ry = Math.max(8, Math.abs(eV1.y - eV2.y) / 2);
      const cy2 = (eV1.y + eV2.y) / 2;
      if (cy2 < -ry * 2 || cy2 > H + ry * 2 || rx < 2) continue;
      discs.push([c2.x, cy2, rx, ry]);
    }
    /* remembered ground: a lighter veil over country you have had eyes on, so a map you have
     * walked stays a map. Cut at partial strength FIRST; the sight holes below then clear
     * whatever you can actually see right now. Only the cells on screen are touched. */
    /* THE VEIL IS THREE PASSES AND A BUG IN IT LOOKS THE SAME WHICHEVER ONE IS AT FAULT — a
     * dark shape where lit ground should be. `R.debugFog` turns each off so the guilty one
     * names itself, the same way `debugWorks` answers questions about a work. Poking the world
     * from outside does NOT do this job: the view is rebuilt from the world every frame, so a
     * field nulled between frames is simply refilled, and the measurement comes back identical
     * and reads as "this pass is innocent" when it means "the switch was never thrown". */
    const dbg = R.debugFog || null;
    const sm = (dbg && dbg.mem === false) ? null : view.seen;
    const cut = (dbg && dbg.discs === false) ? [] : discs;
    /* the veil, the live sight and the rim all walk the same cell grid — corners once */
    const cgSrc = view.visMask || ((sm && sm.g) ? sm : null);
    const cg = cgSrc ? cornerGrid(cgSrc.cell,
      Math.max((sm && sm.gw) || 0, (view.visMask && view.visMask.gw) || 0),
      Math.max((sm && sm.gh) || 0, (view.visMask && view.visMask.gh) || 0)) : null;
    /* THE VEIL'S CPU IS WINDOWED TO THE VIEW. Easing and blurring run per frame, and on a
     * country the fog grid is sixteen boards of cells the camera sees three percent of. A
     * generous margin (twelve cells ≈ three hundred units) keeps the fastest pan inside
     * ground that was eased before it arrived. */
    let fogWin = null;
    if (sm && R.viewRect) {
      const vr = R.viewRect();
      if (vr) {
        const M = 12;
        fogWin = { gw: sm.gw,
                   x0: Math.max(0, Math.floor(vr.x0 / sm.cell) - M),
                   x1: Math.min(sm.gw - 1, Math.ceil(vr.x1 / sm.cell) + M),
                   y0: Math.max(0, Math.floor(vr.y0 / sm.cell) - M),
                   y1: Math.min(sm.gh - 1, Math.ceil(vr.y1 / sm.cell) + M) };
      }
    }
    /* eased ONCE a frame each — the rim reads the same weights the veil does, and easing them
     * twice would run the clock at double speed for whichever pass asked second */
    const liveA = (cg && view.visMask)
      ? easeVeil('live', view.visMask.g, view.visMask.gw * view.visMask.gh, lastDt, fogWin) : null;
    const memA = (cg && sm && sm.g) ? easeVeil('mem', sm.g, sm.gw * sm.gh, lastDt, fogWin) : null;
    /* EXPERIMENT (R.shaderFog): hand the same field to the materials and draw no veil here.
     * The 2D passes below are skipped wholesale — the dark fill, the bands, and the rim. */
    const shaderFog = !!R.shaderFog && !!(sm && liveA && memA);
    if (shaderFog) { fogUpload(sm.gw, sm.gh, sm.cell, liveA, memA, fogWin); FOGU.uFogOn.value = 1; }
    else if (FOGU.uFogOn.value) FOGU.uFogOn.value = 0;
    if ((sm || cut.length) && !shaderFog) {
      /* HOW COARSE THE MASK IS DRAWN is how soft its edge comes out, and that is the whole
       * softening now — see the note where it is composited. A cell of remembered ground should
       * land on about two pixels of the scratch, so the upscale smears exactly across the
       * staircase we are hiding and no further. */
      const cellPx = Math.max(1, C.FOG.cell * scaleOf());
      const shrink = Math.max(1, Math.min(16, cellPx / 2));
      const mc = memCtx(shrink);
      if (mc) {
        mc.clearRect(0, 0, W, H);
        /* ONE loop turns a cell mask into ground-hugging quads, because two masks need it
         * now: the REMEMBERED ground at partial strength, and — once the sim serves an
         * occlusion-aware live mask (`view.visMask`) — CURRENT sight at full strength. A run
         * of cells is one quad; under perspective its far edge is narrower than its near
         * one, so it is projected as a quad, not a rectangle. */
        /* the same cheap blur the rim takes, and for the same reason: the upscale alone leaves
         * a little cell structure in the ramp, and anything downstream that is non-linear will
         * find it and put the staircase back. Taken on the SMALL buffer, so it is nearly free. */
        const mcFilter = typeof mc.filter === 'string';
        if (mcFilter) mc.filter = 'blur(' + Math.max(1, Math.min(4, Math.round(Math.min(window.devicePixelRatio || 1, 2) * 1.2))) + 'px)';
        const quads = (a, mask, alpha) => {
          if (cg && a) bandFill(mc, cg, mask.gw, mask.gh, a, alpha);
        };
        /* the explored region is punched CLEAR of the shroud — fog's darkness is no longer a
         * leftover fraction of it, it is the slate wash laid back on below */
        if (sm) quads(memA, sm, 1);
        /* CURRENT SIGHT FROM THE MASK, WHEN THE SIM SERVES ONE. Occlusion makes a sight
         * region an arbitrary shape — a ridge's shadow is not an ellipse — so the ellipse
         * holes below cannot draw it. The mask can, through the exact pipeline the memory
         * already rides: same buffer, full strength, one composite. Ellipses remain as the
         * fallback so a view without a mask (an old guest, a mid-migration build) keeps its
         * fog rather than losing the veil's holes entirely. */
        if (view.visMask && !(dbg && dbg.discs === false)) quads(liveA, view.visMask, 1);
        /* the sight discs cut the SAME buffer at full strength — over the memory's partial
         * alpha, source-over composes to exactly what two destination-out passes left before
         * ((1-a)(1-m)), and it buys two things: where discs meet, the pointed cusp of the union
         * is rounded by the same upscale that hides the mask's staircase instead of staying a
         * razor corner; and the gradients fill a buffer a shrink² fraction of the screen
         * instead of the full overlay. */
        if (mcFilter) mc.filter = 'none';
        for (const [cx2, cy2, rx, ry] of (view.visMask ? [] : cut)) {
          mc.save();
          mc.translate(cx2, cy2); mc.scale(1, ry / rx);
          /* a tight falloff: the edge of sight should read as an edge, not a smear */
          const gr = mc.createRadialGradient(0, 0, rx * 0.82, 0, 0, rx);
          gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
          mc.fillStyle = gr;
          mc.beginPath(); mc.arc(0, 0, rx, 0, 7); mc.fill();
          mc.restore();
        }
        /* THE SOFTENING IS THE UPSCALE, NOT A BLUR. The memory is kept on a coarse grid and its
         * raw edge is a staircase of cells; what the eye should read is "you have been here",
         * not the resolution the sim files it at. That used to be `ctx.filter = 'blur(26px)'`
         * over the whole overlay — a fifty-device-pixel blur on a full-screen canvas, every
         * frame. Drawing the mask small and letting the bilinear upscale spread it gives the
         * same read with no filter, and it is far cheaper on a phone: the scratch is a
         * sixteenth of the pixels at most, and the driver does the smoothing in the blit it
         * was going to do anyway.
         * A single bilinear hop is only smooth up to about 4× — past that the ramps between
         * texels show as facets, which is its own staircase — so a coarse scratch takes an
         * intermediate hop and each stage stays within 4× (shrink caps at 16, and √16 = 4).
         * `imageSmoothingEnabled` is re-asserted at every hop because SETTING A CANVAS'S SIZE
         * RESETS ITS CONTEXT STATE, and the scratches resize with the zoom and the window. */
        let src = memStore.cv;
        if (shrink >= 4) {
          const midc = midCtx(Math.sqrt(shrink));
          if (midc) {
            midc.clearRect(0, 0, W, H);
            midc.imageSmoothingEnabled = true;
            midc.drawImage(src, 0, 0, W, H);
            src = midStore.cv;
          }
        }
        g.globalCompositeOperation = 'destination-out';
        g.imageSmoothingEnabled = true;
        g.drawImage(src, 0, 0, W, H);
        g.globalCompositeOperation = 'source-over';
        /* ---- and now FOG, in its own colour ----
         * fogOnly = what you have seen MINUS what you see now, on the same grid and from the
         * same eased weights, so the wash lifts and settles with the sight that made it and
         * never fights the veil it sits beside. */
        const fcx = (cg && memA && liveA) ? fogCtx(shrink) : null;
        if (fcx) {
          const n = Math.min(memA.length, liveA.length);
          if (!fogA || fogA.length !== n) fogA = new Float32Array(n);
          for (let i = 0; i < n; i++) { const d = memA[i] - liveA[i]; fogA[i] = d > 0 ? d : 0; }
          fcx.clearRect(0, 0, W, H);
          if (mcFilter) fcx.filter = mc.filter;
          bandFill(fcx, cg, sm.gw, sm.gh, fogA, 1);
          if (mcFilter) fcx.filter = 'none';
          /* shape the colour by the mask, then lay it down in one pass */
          fcx.globalCompositeOperation = 'source-in';
          fcx.fillStyle = 'rgb(' + FOG_WASH[0] + ',' + FOG_WASH[1] + ',' + FOG_WASH[2] + ')';
          fcx.fillRect(0, 0, W, H);
          fcx.globalCompositeOperation = 'source-over';
          let fsrc = fogStore.cv;
          if (shrink >= 4) {
            const fm = fogMidCtx(Math.sqrt(shrink));
            if (fm) {
              fm.clearRect(0, 0, W, H);
              fm.imageSmoothingEnabled = true;
              fm.drawImage(fsrc, 0, 0, W, H);
              fsrc = fogMid.cv;
            }
          }
          /* the wash has to clear BOTH neighbours: dark enough that fog never reads as sight
           * (the reported bug), light enough that fog never reads as shroud. Measured with
           * the overlay's own alpha: 0.02 sight / ~0.50 fog / 0.82 shroud leaves a gap either
           * side. And the surer signal is not tone at all — under fog you can still make out
           * the LAND, under shroud there is nothing to make out. */
          g.globalAlpha = Math.max(0, Math.min(1, C.FOG.keep + 0.05));
          g.imageSmoothingEnabled = true;
          g.drawImage(fsrc, 0, 0, W, H);
          g.globalAlpha = 1;
        }
      }
    }
    /* ONE warm line on the edge of sight — the OUTER limit of the lit ground, not a ring
     * around every lamp. A ring per source turned a well-watched city into a nest of circles,
     * and since units carry sight too, each soldier dragged his own ring across the map.
     * Fill the union of the discs into a scratch, cut a slightly smaller union back out, and
     * what survives is exactly the outer boundary — one pass, no outline geometry. */
    const rc = rimCtx();
    /* WITH A MASK, THE RIM IS A DILATION. An occluded sight region is an arbitrary shape, so
     * the ring is cut from the shape itself: stamp the live-vision scratch four times at a
     * pixel's offset (the dilated union), cut the un-offset stamp back out (the interior),
     * and what survives is the boundary — then tint it through source-in. Same warm line,
     * no geometry, and it hugs a ridge's shadow exactly where the ellipse union cannot. */
    if (rc && view.visMask && !R.shaderFog && !(dbg && dbg.rim === false)) {
      /* THE RIM IS DRAWN COARSE FOR THE SAME REASON THE VEIL IS. It used to be stamped at full
       * size from the raw mask — "one pixel wide and must stay one pixel" — which was right
       * while the boundary was a union of ELLIPSES, smooth at any resolution you traced it at.
       * Occlusion made sight an arbitrary CELL shape, and the same code turned into a pixel-art
       * cutout: the fill was softened by its downscale and the rim was not, so the one the eye
       * follows was the hard one. Now both come off the same coarse draw and the same bilinear
       * upscale, so the rim cannot disagree with the edge it is supposed to be tracing. */
      /* HOW MUCH SMOOTHING THE STAIRCASE ACTUALLY NEEDS. A step is one cell wide on screen —
       * `cellPx`, often thirty CSS pixels — and the upscale smears by about `shrink` pixels, so
       * the old cap of 16 could only ever soften half a step and the edge stayed a flight of
       * stairs. The rest comes from a real blur taken on the SMALL buffer, where it is nearly
       * free: a blur of p there is worth p*shrink/dpr on screen, so two pixels buys most of a
       * cell. (This is what the veil's own note warns against doing at FULL size — a
       * fifty-pixel blur across the whole overlay every frame — and the reason it is fine here
       * is the buffer is a shrink-th of the screen.) Feature-detected: a canvas without
       * `filter` keeps the upscale alone, which is exactly today's look, not a broken one. */
      const rimCell = C.FOG.cell * scaleOf();
      const rimShrink = Math.max(1, Math.min(16, rimCell / 2));
      const vc = visCtx(rimShrink);
      if (vc && cg && liveA && !R.shaderFog) {
        vc.clearRect(0, 0, W, H);
        const canFilter = typeof vc.filter === 'string';
        if (canFilter) vc.filter = 'blur(' + Math.max(1, Math.min(4, Math.round(Math.min(window.devicePixelRatio || 1, 2) * 1.2))) + 'px)';
        bandFill(vc, cg, view.visMask.gw, view.visMask.gh, liveA, 1);
        if (canFilter) vc.filter = 'none';
        /* the same two-stage hop the veil takes, and for the same reason: one bilinear stage
         * is only smooth to about 4x, past which the ramps between texels facet */
        let rsrc = visStore.cv;
        if (rimShrink >= 4) {
          const rmid = midCtx(Math.sqrt(rimShrink));
          if (rmid) {
            rmid.clearRect(0, 0, W, H);
            rmid.imageSmoothingEnabled = true;
            rmid.drawImage(rsrc, 0, 0, W, H);
            rsrc = midStore.cv;
          }
        }
        rc.clearRect(0, 0, W, H);
        rc.imageSmoothingEnabled = true;
        /* A DILATION IS A THIN LINE ONLY WHILE THE FIELD IS BINARY, and this one is no longer
         * binary. Stamping four offset copies source-over gives 1-(1-f)^4, which at f=0.2 is
         * 0.59 — so subtracting the un-offset copy leaves a third of the alpha standing across
         * the WHOLE ramp, not in a band beside it. Reported from play as "the fog is brighter
         * than the lit ground": the rim had stopped being a line and become a halo. Worse, that
         * curve maps mid-tones upward, so it RE-SHARPENED exactly the cell structure the blur
         * had just softened, and the steps came back inside the halo.
         * ONE offset, not four, keeps it linear-ish: what survives is the difference across a
         * single step of the ramp, which is the gradient — brightest where the edge is
         * steepest and gone where the field is flat. Kept small, and the tint dropped to match,
         * because the accent has to sit UNDER the lit ground it borders, never over it. */
        const ro = Math.max(1, Math.min(3, Math.round(rimCell * 0.06)));
        rc.drawImage(rsrc, ro, ro, W, H);
        rc.globalCompositeOperation = 'destination-out';
        rc.drawImage(rsrc, 0, 0, W, H);
        rc.globalCompositeOperation = 'source-in';
        rc.fillStyle = 'rgba(255,233,168,0.5)';
        rc.fillRect(0, 0, W, H);
        rc.globalCompositeOperation = 'source-over';
        g.drawImage(rimStore.cv, 0, 0, W, H);
      }
    /* AND THE FALLBACK MUST OBEY THE SWITCH TOO. The masked rim above is guarded by
     * `!R.shaderFog`, which sent the shader path straight into this ELSE — the old
     * disc-union rim, drawn from every sight source on the board. Sighted ground came back
     * wearing a warm cream wash at about a=57, and since the shader hands sight back
     * untouched by design, that wash was the entire difference between the two pictures:
     * lit ground read (82,74,52) under the shader against (33,29,19) under the overlay, and
     * it looked like the shader was brightening the world when the shader had not touched
     * it at all. A guard on the `if` alone is not a guard. */
    } else if (rc && discs.length && !R.shaderFog && !(dbg && dbg.rim === false)) {
      rc.clearRect(0, 0, W, H);
      rc.fillStyle = 'rgba(255,233,168,0.34)';
      rc.beginPath();
      /* moveTo before each: like arc(), ellipse() draws a line from the current point to where
       * it starts, so a path of many ellipses is stitched together by chords and fills as a
       * fan of black shards across the map. Each needs its own subpath. */
      for (const [cx2, cy2, rx, ry] of discs) { rc.moveTo(cx2 + rx, cy2); rc.ellipse(cx2, cy2, rx, ry, 0, 0, 7); }
      rc.fill();
      rc.globalCompositeOperation = 'destination-out';
      rc.beginPath();
      for (const [cx2, cy2, rx, ry] of discs) {
        const ix = Math.max(0.5, rx - 2), iy = Math.max(0.5, ry - 2 * (ry / rx));
        rc.moveTo(cx2 + ix, cy2); rc.ellipse(cx2, cy2, ix, iy, 0, 0, 7);
      }
      rc.fill();
      rc.globalCompositeOperation = 'source-over';
      g.drawImage(rimStore.cv, 0, 0, W, H);
    }
    }
    /* unit hp slivers */
    for (const u of view.units) {
      if (u.hp >= u.maxHp) continue;
      const p = proj(u.x, groundH(u.x, u.y) + 26, u.y);
      if (!p.ok) continue;
      g.fillStyle = '#000a'; g.fillRect(p.x - 10, p.y, 20, 3);
      g.fillStyle = '#' + tintOf(u.owner, viewer).toString(16).padStart(6, '0');
      g.fillRect(p.x - 10, p.y, 20 * Math.max(0, u.hp / u.maxHp), 3);
    }
    /* WHAT IS BEING BROKEN. A bar over every work would be a board covered in bars — most of
     * them full, none of them worth reading — so only a HURT work carries one, and it goes
     * away again when the masons or the slow regrowth of stone have put it right. The bar
     * takes the owner's tint, exactly as a unit's sliver does: what a glance has to answer is
     * "whose, and how far gone", and a bar in a third colour would answer neither.
     * It FLASHES on a fresh hit, which is what separates "this is under attack right now"
     * from "this took a beating an hour ago" — and the flash is driven by the hp the renderer
     * saw last frame rather than by `b.lastHurt`, because lastHurt does not ride the wire and
     * a guest would sit there watching a bar that never moved. */
    barRec.clear();
    for (let pi = 0; pi < view.players.length; pi++) {
      for (const b of view.players[pi].buildings) {
        if (!b.maxHp || b.hp == null) continue;
        const was = hpMem.get(b.id);
        hpMem.set(b.id, b.hp);
        /* a work still going up is under its full hp by design and wears scaffolding for it */
        if (b.raise > 0 || b.hp >= b.maxHp) continue;
        const frac = Math.max(0, Math.min(1, b.hp / b.maxHp));
        const p = proj(b.x, groundH(b.x, b.y) + barTop(b), b.y);
        if (!p.ok || p.y < -20 || p.y > H + 20) continue;
        const hit = was != null && b.hp < was - 0.01;
        if (hit) flash.set(b.id, 0.45);
        const fl = flash.get(b.id) || 0;
        const bw = 30, bh = 5, x0 = Math.round(p.x - bw / 2), y0 = Math.round(p.y);
        g.fillStyle = 'rgba(0,0,0,0.72)';
        g.fillRect(x0 - 1, y0 - 1, bw + 2, bh + 2);
        g.fillStyle = '#' + tintOf(pi, viewer).toString(16).padStart(6, '0');
        g.fillRect(x0, y0, bw * frac, bh);
        if (fl > 0) {
          g.strokeStyle = 'rgba(255,238,214,' + (fl / 0.45).toFixed(2) + ')';
          g.lineWidth = 1.5;
          g.strokeRect(x0 - 2.5, y0 - 2.5, bw + 5, bh + 5);
          g.lineWidth = 1;
        }
        barRec.set(b.id, { x: p.x, y: p.y, w: bw, h: bh, frac, flash: fl, owner: pi });
      }
    }
    /* the flash fades on the same clock the world turns on — one entry per work that was hit,
     * dropped the moment it has burned down */
    for (const [id, t] of [...flash]) {
      const n = t - lastDt;
      if (n <= 0) flash.delete(id); else flash.set(id, n);
    }
    /* site labels + structure bars + pips */
    g.textAlign = 'center'; g.font = '600 11px Georgia, serif';
    for (const s of view.map.sites) {
      if (s.kind === 'city') continue;
      const st = view.sites[s.id];
      if (!st) continue;
      const p = proj(s.x, groundH(s.x, s.y) + 2, s.y);
      if (!p.ok || p.y < -20 || p.y > H + 20) continue;
      g.strokeStyle = 'rgba(0,0,0,0.75)'; g.lineWidth = 3;
      g.strokeText(s.name, p.x, p.y + 30);
      g.fillStyle = 'rgba(222,204,164,0.85)';
      g.fillText(s.name, p.x, p.y + 30);
    }
    /* ---- CASTLE BARS: A BAR BELONGS TO A CITY ----
     * It used to hang over the seat an heir was BORN to and draw the hit points of the seat he
     * currently rules FROM — two different cities the moment either could change, so taking
     * command of a conquered court put your new capital's health on the bar above your old
     * one. `view.cities` is the list of the things that actually have hit points; each carries
     * its own, and its colour is its holder's banner. */
    const cityRows = view.cities ||
      view.map.cities.map((id, pi) => ({ x: view.map.sites[id].x, y: view.map.sites[id].y,
                                         owner: pi, hp: view.players[pi].castleHp,
                                         maxHp: C.CASTLE_HP }));
    for (let ci = 0; ci < cityRows.length; ci++) {
      const c = cityRows[ci];
      if (!seatFound(view, ci)) continue;   // no bar over a Seat you have not found
      if (c.razed) continue;                // a ruin has no throne left to measure
      const p = proj(c.x, groundH(c.x, c.y) + 186, c.y);
      if (!p.ok) continue;
      g.fillStyle = '#000b'; g.fillRect(p.x - 46, p.y - 4, 92, 8);
      g.fillStyle = '#' + cityTint(c, viewer).toString(16).padStart(6, '0');
      g.fillRect(p.x - 45, p.y - 3, 90 * Math.max(0, c.hp / (c.maxHp || C.CASTLE_HP)), 6);
    }
    /* ---- A YIELDED CITY SAYS WHAT IT WANTS ----
     * Break a city and... then what? The rule (stand in the court, uncontested, twenty
     * seconds) was invisible: no state on the ground, no progress while the claim ran, and
     * the whole verb read as a bug — 'I don't understand how to claim a city I conquered',
     * from play. A yielded court now wears its ask, and a running claim wears a filling bar
     * in the claimant's colour with the seconds left beside it. All of it is PUBLIC state
     * (cities ride the snapshot whole — a city changing hands is the loudest thing on a war
     * map), so a guest reads the same picture the host does. */
    if (view.cities) {
      for (const c of view.cities) {
        if (c.owner !== -1 || c.razed) continue;
        const p = proj(c.x, groundH(c.x, c.y) + 150, c.y);
        if (!p.ok) continue;
        g.textAlign = 'center';
        if (c.hold && view.t != null) {
          const f = Math.max(0, Math.min(1, (view.t - c.hold.since) / C.CITY.take));
          const left = Math.max(0, C.CITY.take - (view.t - c.hold.since));
          g.fillStyle = '#000b'; g.fillRect(p.x - 46, p.y - 4, 92, 8);
          g.fillStyle = UI && UI.seatColor ? UI.seatColor(c.hold.pi, viewer) : '#ffd98a';
          g.fillRect(p.x - 45, p.y - 3, 90 * f, 6);
          g.font = '600 11px Georgia, serif';
          g.strokeStyle = 'rgba(0,0,0,0.75)'; g.lineWidth = 3;
          const line = (c.hold.pi === viewer ? 'CLAIMING — ' : 'BEING CLAIMED — ') + Math.ceil(left) + 's';
          g.strokeText(line, p.x, p.y + 18);
          g.fillText(line, p.x, p.y + 18);
        } else {
          g.font = '600 11px Georgia, serif';
          g.strokeStyle = 'rgba(0,0,0,0.75)'; g.lineWidth = 3;
          g.strokeText('YIELDED — HOLD THE COURT TO CLAIM', p.x, p.y + 4);
          g.fillStyle = 'rgba(222,204,164,0.9)';
          g.fillText('YIELDED — HOLD THE COURT TO CLAIM', p.x, p.y + 4);
        }
      }
    }
    /* minimap (same math as 2D, display space) */
    const mb = R.miniBox(), mw = mb.mw, mx = mb.mx, mh = mb.mh, my = mb.my;
    g.fillStyle = 'rgba(10,8,18,0.72)'; g.strokeStyle = 'rgba(200,164,79,0.4)'; g.lineWidth = 1;
    g.beginPath();
    g.roundRect ? g.roundRect(mx, my, mw, mh, 6) : g.rect(mx, my, mw, mh);
    g.fill(); g.stroke();
    const mpx = (x) => mx + (x / mapW) * mw, mpy = (y) => my + (y / mapH) * mh;
    for (const s of view.map.sites) {
      const st = view.sites[s.id];
      const X = mpx(s.x), Y = mpy(s.y);
      if (s.kind === 'city') {
        const pi2 = view.map.cities.indexOf(s.id);
        if (!seatFound(view, pi2)) continue;
        /* WHOSE COURT IS THAT — the one question a glance at a war map asks, and the mark used
         * to answer a different one: it was coloured by the seat an heir was BORN to, so a
         * conquered city stayed the enemy's crimson and one taken from you stayed your gold,
         * for the whole war. It is the holder's banner now, and a yielded court is neutral. */
        const c2 = view.cities && view.cities[pi2];
        g.fillStyle = '#' + (c2 ? cityTint(c2, viewer) : tintOf(pi2, viewer)).toString(16).padStart(6, '0');
        g.fillRect(X - 3, Y - 3, 6, 6);
        /* a razed court is a ruin and says so: a hollow mark, so "gone" cannot be mistaken for
         * "nobody's yet" on the one screen where the difference decides where you march */
        if (c2 && c2.razed) { g.fillStyle = 'rgba(10,8,18,0.9)'; g.fillRect(X - 1.5, Y - 1.5, 3, 3); }
      } else {
        g.fillStyle = !st ? '#3a3444'
          : (st.holder == null || st.holder < 0 ? '#8a8098'
            : '#' + tintOf(st.holder, viewer).toString(16).padStart(6, '0'));
        g.beginPath(); g.arc(X, Y, st && st.holder >= 0 ? 2.6 : 1.6, 0, 7); g.fill();
      }
    }
    /* CURTAINS ON THE MINIMAP. Works do not go on it — a barracks is a dot and dots do not
     * help. A wall is different: it is a LINE, it is the shape of a defence, and on a phone
     * the minimap is the only place you can see the shape of one at all. Own walls gold,
     * everyone else's crimson, and only the ones the viewer can actually see. */
    g.lineWidth = 2;
    for (let pi = 0; pi < view.players.length; pi++) {
      const pl2 = view.players[pi];
      g.strokeStyle = pi === viewer ? '#ffd98a' : '#ff8a96';
      const runs = pl2.buildings.concat(pl2.ghosts || []);
      for (const b of runs) {
        if (b.x2 == null) continue;
        const ax = b.x * 2 - b.x2, ay = b.y * 2 - b.y2;
        g.beginPath();
        g.moveTo(mpx(ax), mpy(ay));
        g.lineTo(mpx(b.x2), mpy(b.y2));
        g.stroke();
      }
    }
    /* AND THE STANDARDS. The minimap is where you find your army on a phone — the board is
     * two thousand by two thousand four hundred and the screen shows a corner of it — and
     * until now it showed springs, Seats and curtains but nothing about where your own men
     * were. One mark per company, at its BEARER (where the men ARE), in that company's own
     * colour, drawn as a pennant on a staff so it reads as a flag at four pixels rather than
     * as another dot. Own companies only: whose men are where is the owner's alone — and in a
     * war "own" is the court you are hand-playing, whose standards are the ones in the tray. */
    const meCo = view.players[handOf(viewer)];
    if (meCo && meCo.companies && meCo.companies.length) {
      const own = new Map();
      for (const u of view.units) if (u.owner === handOf(viewer)) own.set(u.id, u);
      for (const co of meCo.companies) {
        const u = co.bearer != null && own.get(co.bearer);
        if (!u) continue;
        const X = mpx(u.x), Y = mpy(u.y);
        g.strokeStyle = 'rgba(0,0,0,0.85)'; g.lineWidth = 2.4;
        g.beginPath(); g.moveTo(X, Y); g.lineTo(X, Y - 9); g.stroke();
        g.strokeStyle = '#ffe9a8'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(X, Y); g.lineTo(X, Y - 9); g.stroke();
        g.fillStyle = '#' + PENNANT[(co.id - 1) % PENNANT.length].toString(16).padStart(6, '0');
        g.beginPath();
        g.moveTo(X + 0.5, Y - 9); g.lineTo(X + 7.5, Y - 6.5); g.lineTo(X + 0.5, Y - 4);
        g.closePath(); g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.6)'; g.stroke();
      }
    }
    /* ---- AND WHERE THE FIGHTING IS ----
     * Last, so it sits over the springs and the stone: it is the most perishable thing on the
     * map and the thing you are looking for. CRIMSON when it is your own men or your own
     * works taking the blows and GOLD when it is his, because "I am being attacked here" and
     * "I am attacking there" are the two different questions a glance at a minimap asks. The
     * ring grows with how much is happening and pulses so the eye catches it against a map of
     * still dots; the dot at its heart is what survives at four pixels. */
    for (const f of flash2) {
      const X = mpx(f.x), Y = mpy(f.y);
      const a = Math.min(1, f.ttl / 2);                       // fading out as it goes quiet
      const beat = 0.72 + 0.28 * Math.sin(view.t * 5.5 + f.x * 0.01);
      const r = (3.2 + f.n * 1.15) * beat;
      g.globalAlpha = a;
      g.strokeStyle = f.mine ? '#ff6a5a' : '#ffd98a';
      g.lineWidth = 1.6;
      g.beginPath(); g.arc(X, Y, r, 0, 7); g.stroke();
      g.fillStyle = f.mine ? '#ff8a96' : '#ffe9a8';
      g.beginPath(); g.arc(X, Y, 1.7, 0, 7); g.fill();
      g.globalAlpha = 1;
    }
    g.lineWidth = 1;
    for (const f of fx) if (f.ping) {
      g.globalAlpha = f.ttl / f.max;
      g.strokeStyle = '#' + f.ping.toString(16).padStart(6, '0');
      g.beginPath(); g.arc(mpx(f.x), mpy(f.z), 5 + (1 - f.ttl / f.max) * 5, 0, 7); g.stroke();
      g.globalAlpha = 1;
    }
    g.strokeStyle = '#ffe9a8'; g.lineWidth = 1.5;
    const vr = R.viewRect();
    g.strokeRect(mx + (vr.x0 / mapW) * mw, my + (vr.y0 / mapH) * mh,
                 ((vr.x1 - vr.x0) / mapW) * mw, ((vr.y1 - vr.y0) / mapH) * mh);
    /* A WALL IS TWO TAPS, and between them the run has to be VISIBLE — a length you cannot
     * see is a length you cannot judge, and the span limits would just read as refusals.
     * The line follows the ground from the anchor to wherever the finger is, and says how
     * long it is and whether that is a wall the masons will build. */
    if (R.span) {
      const def = C.BUILDINGS.wall;
      const a = R.project(R.span.x, R.span.y);
      const moved = R.pointer && R.pointer !== R.span.from;
      const w2 = moved ? R.toWorld(R.pointer.x, R.pointer.y) : R.span;
      const len = Math.hypot(w2.x - R.span.x, w2.y - R.span.y);
      /* THE PRICE IS THE LENGTH. A run is bought by the crew, and there is no longest run —
       * only how far the idle masons reach — so the preview says what THIS run will cost and
       * turns red on the one limit that actually exists. */
      const crews = Math.max(1, Math.ceil(len / C.WALL.unit));
      const price = Math.max(1, Math.round(def.cost * (len / C.WALL.unit)));
      const reach = R.span.reach || 0;
      const short = len < def.span[0], over = reach > 0 && len > reach;
      const ok = !moved || (!short && !over);
      const b2 = R.project(w2.x, w2.y);
      g.strokeStyle = ok ? '#ffe9a8' : '#ff6a5a';
      g.lineWidth = 4; g.setLineDash([10, 7]);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b2.x, b2.y); g.stroke();
      g.setLineDash([]); g.lineWidth = 2;
      g.beginPath(); g.arc(a.x, a.y, 7, 0, 7); g.stroke();
      /* how far the crews reach, drawn as the point the run stops being buildable */
      if (moved && reach > 0 && len > 4) {
        const f = reach / len;
        const cap = R.project(R.span.x + (w2.x - R.span.x) * f, R.span.y + (w2.y - R.span.y) * f);
        g.strokeStyle = '#ffe9a8'; g.globalAlpha = 0.55;
        g.beginPath(); g.arc(cap.x, cap.y, 5, 0, 7); g.stroke();
        g.globalAlpha = 1;
      }
      if (moved) {
        g.font = '600 13px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'bottom';
        g.fillStyle = ok ? '#ffe9a8' : '#ff6a5a';
        const say = short ? Math.round(len) + ' — too short'
          : over ? Math.round(len) + ' — the masons reach ' + Math.round(reach)
          : Math.round(len) + '  ◆ ' + price + '  ·  ' + crews + (crews > 1 ? ' crews' : ' crew') +
            (len >= C.WALL.gateMin ? '' : '  ·  no gate');
        g.fillText(say, (a.x + b2.x) / 2, (a.y + b2.y) / 2 - 8);
        g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      }
    }
    /* storm targeting */
    if (R.targeting) {
      g.fillStyle = 'rgba(255,90,74,0.06)'; g.fillRect(0, 0, W, H);
      if (R.pointer) {
        /* the ring the player aims by, projected the way the fog holes are: a world circle
         * under this camera is an ellipse, and drawing it round overstated the storm's reach
         * up-screen by the pitch — you aimed at men the blast could not touch */
        const w2 = R.toWorld(R.pointer.x, R.pointer.y);
        const r0 = C.POWERS.storm.radius, gh = groundH(w2.x, w2.y) + 2;
        const c2 = proj(w2.x, gh, w2.y);
        const eH = proj(w2.x + r0, gh, w2.y);
        const eV1 = proj(w2.x, gh, w2.y - r0), eV2 = proj(w2.x, gh, w2.y + r0);
        const rx = Math.abs(eH.x - c2.x), ry = Math.max(6, Math.abs(eV1.y - eV2.y) / 2);
        g.strokeStyle = '#ff6a5a'; g.setLineDash([6, 6]);
        g.beginPath(); g.ellipse(c2.x, (eV1.y + eV2.y) / 2, rx, ry, 0, 0, 7); g.stroke();
        g.setLineDash([]);
      }
    }
  }

  /* ---------------- THE MUSTER ROLL'S FIGURES ----------------
   * A codex of men described in numbers is a codex you have to imagine. Each row of the Roll
   * gets the man himself, turning — and it is the SAME model the board draws, off `unitGeo`,
   * so a kind whose geometry moves moves here too and the Roll can never show a soldier the
   * game does not have.
   *
   * ONE WEBGL CONTEXT FOR ALL OF THEM. A canvas per row is the obvious way and it is the wrong
   * one: browsers keep only eight to sixteen live contexts and the Roll lists eighteen men, so
   * the bottom of the list would come up blank — on a phone, which is where it is read. The
   * three.js "many elements, one renderer" pattern instead: one canvas laid over the screen and
   * one SCISSOR RECTANGLE per row. The alternative — draw each figure offscreen and blit it
   * into a per-row 2D canvas — is a GPU→CPU→GPU round trip per row per frame, which is exactly
   * what a phone cannot pay for.
   *
   * AND IT RUNS ONLY WHILE THE ROLL IS UP. `rollStart` arms the loop, `rollStop` cancels it,
   * and a closed Roll costs nothing at all — no frame, no context work, and the framebuffer
   * shrunk to a pixel so a menu is not holding a screen's worth of it.
   *
   * If the glass refuses — no THREE, no context, a dead canvas — `rollStart` returns false and
   * says nothing; ui.js leaves the icon glyph in the card, which is what it was showing before. */
  let rollR = null, rollScene = null, rollCam = null, rollCanvas = null;
  let rollRAF = 0, rollRows = [], rollFigs = new Map(), rollMat = null;
  let rollW = 0, rollH = 0, rollFrames = 0, rollDrawn = 0;
  /* the figure a row shows: the in-game model at tier 1, in the gold that is always YOURS.
   * `unitGeo` carries its own vertex colours (the metal, the leather, the crest) and Lambert
   * multiplies the material colour through them, so one shared material tints every man. */
  R.rollFigure = function (kind) {
    if (typeof THREE === 'undefined' || !C.UNITS[kind]) return null;
    if (!rollMat) rollMat = new THREE.MeshLambertMaterial({ vertexColors: true, color: C.SEAT_TINT[0] });
    const geo = unitGeo(kind, 1);
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const m = new THREE.Mesh(geo, rollMat);
    /* frame him off his own bounds rather than off a number chosen for the soldier: a Ram is
     * wide and low and a Champion is tall, and one distance flatters neither */
    m.userData.mid = (bb.min.y + bb.max.y) / 2;
    m.userData.rad = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) / 2 || 12;
    return m;
  };
  R.rollStart = function (canvas, rows) {
    R.rollStop();
    if (typeof THREE === 'undefined' || !canvas || typeof requestAnimationFrame !== 'function') return false;
    if (rollR && rollCanvas !== canvas) { try { rollR.dispose(); } catch (e) { /* going anyway */ } rollR = null; }
    if (!rollR) {
      try {
        rollR = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      } catch (e) { rollR = null; return false; }
      rollCanvas = canvas;
      rollR.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      rollR.outputColorSpace = THREE.SRGBColorSpace;
      rollR.autoClear = false;          // one clear a frame, ours, so scrolled-off rows leave nothing
      rollW = rollH = 0;
      if (!rollScene) {
        rollScene = new THREE.Scene();
        rollScene.add(new THREE.HemisphereLight(0xb8b0e0, 0x4a3a28, 2.4));
        const key = new THREE.DirectionalLight(0xffe8c0, 2.0);
        key.position.set(-50, 70, 90);
        rollScene.add(key);
        rollCam = new THREE.PerspectiveCamera(30, 1, 1, 500);
      }
    }
    rollRows = [];
    for (const r of rows || []) {
      if (!r || !r.el || !C.UNITS[r.kind]) continue;
      let fig = rollFigs.get(r.kind);
      if (!fig) {
        fig = R.rollFigure(r.kind);
        if (!fig) continue;
        fig.visible = false;
        rollScene.add(fig);
        rollFigs.set(r.kind, fig);
      }
      /* one figure per KIND, however many rows show it — a hall's own recruit is listed twice
       * and a second copy of his geometry would buy nothing. Each row turns him from its own
       * phase so the column does not read as one man reflected down the page. */
      rollRows.push({ el: r.el, fig, phase: rollRows.length * 0.7 });
    }
    if (!rollRows.length) return false;
    rollFrames = 0;
    const step = () => { rollRAF = requestAnimationFrame(step); rollTick(); };
    rollRAF = requestAnimationFrame(step);
    return true;
  };
  R.rollStop = function () {
    if (rollRAF) cancelAnimationFrame(rollRAF);
    rollRAF = 0;
    rollRows = [];
    rollDrawn = 0;
    /* a screen-sized framebuffer is several megabytes and the Roll is shut — give it back and
     * let the next open size it again */
    if (rollR && rollW) { try { rollR.setSize(1, 1, false); } catch (e) { /* nothing to give back */ } rollW = rollH = 0; }
  };
  function rollTick() {
    rollFrames++;
    const t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    /* THE CANVAS IS THE FRAME OF REFERENCE, NOT THE WINDOW. Both numbers here — the size of
     * the drawing buffer and the origin every row's rectangle is measured from — are asked of
     * the canvas's own box, so the mapping is self-consistent whatever the browser thinks its
     * viewport is. Taken from `window.innerWidth/innerHeight` they are not: on a phone the
     * layout viewport a `position:fixed; inset:0` canvas fills and the visual viewport
     * `innerHeight` reports differ by the height of the address bar, so the buffer was made
     * SHORTER than the box it was stretched into. Reported from play with a picture, and both
     * symptoms fall out of that one line: every man drawn a good half again too tall, and each
     * one displaced down the page by the difference. Nothing else can drift either — a canvas
     * that is inset, letterboxed, or given a border lands right for free. */
    const cr = rollCanvas.getBoundingClientRect();
    const w = Math.round(cr.width), h = Math.round(cr.height);
    if (w < 4 || h < 4) return;
    if (rollW !== w || rollH !== h) { rollW = w; rollH = h; rollR.setSize(w, h, false); }
    rollR.setScissorTest(false);
    rollR.clear(true, true, false);
    rollR.setScissorTest(true);
    rollDrawn = 0;
    for (const row of rollRows) {
      /* the rows MOVE — the Roll is a long scroll — so every rect is asked of the row itself
       * each frame rather than cached at open. Eighteen clean reads of a static layout is
       * nothing beside a figure drawn where its row used to be. */
      const r = row.el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      if (r.bottom <= cr.top || r.top >= cr.bottom || r.right <= cr.left || r.left >= cr.right) {
        row.vp = null; continue;                                                 // scrolled away
      }
      const x = Math.round(r.left - cr.left), yb = Math.round(cr.bottom - r.bottom);
      const rw = Math.round(r.width), rh = Math.round(r.height);
      row.vp = { x, yb, w: rw, h: rh };
      rollR.setViewport(x, yb, rw, rh);
      rollR.setScissor(x, yb, rw, rh);
      const f = row.fig;
      f.visible = true;
      f.rotation.y = t * 0.6 + row.phase;
      rollCam.aspect = rw / rh;
      /* a little above him and looking slightly down, which is the angle the board is played
       * at — and it is the only way a Ram or a Bombard reads as a machine rather than a plank */
      rollCam.position.set(0, f.userData.mid + f.userData.rad * 0.5,
                           f.userData.rad / Math.tan(15 * Math.PI / 180) * 1.06);
      rollCam.lookAt(0, f.userData.mid, 0);
      rollCam.updateProjectionMatrix();
      rollR.render(rollScene, rollCam);
      f.visible = false;
      rollDrawn++;
    }
    rollR.setScissorTest(false);
  }
  /* test handles: the loop's own frame counter — the one way to prove a closed Roll has really
   * stopped rather than merely gone invisible, which is what a leaked rAF looks like — and how
   * many figures the last frame actually put on the glass. */
  R.debugRollLoop = () => rollFrames;
  R.debugRollDraws = () => rollDrawn;
  R.debugRollRunning = () => !!rollRAF;
  /* ...and WHERE the last frame put each man: the GL viewport it was drawn into, in CSS pixels
   * with GL's bottom-left origin, relative to the canvas. A figure drawn in the wrong place is
   * the one defect of this screen a player will actually see, and until this handle existed
   * there was no way to ask about it from outside — the canvas is WebGL with no preserved
   * drawing buffer, so the pixels cannot be read back after the frame. The test converts an
   * element's rect itself and compares, rather than being handed the answer. */
  R.debugRollRects = () => rollRows.map((r) => (r.vp ? { kind: r.el.dataset.kind, ...r.vp } : null));

  global.Render3D = R;
})(typeof window !== 'undefined' ? window : globalThis);

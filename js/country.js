/* country.js — the country, one step above the board. Headless-safe: no DOM, no Date.
 *
 * WHY THERE IS A LAYER HERE AT ALL, and it is a measurement rather than a taste. One very large
 * grid does not work: a flow field is a Dijkstra over every cell and so is dead linear in AREA
 * — 6.3ms on today's board, 59ms at three times the width, and a 4.8MB `Float32Array` at ten —
 * and the ground texture self-caps around 22.9MB, so a board three times as wide is simply three
 * times blurrier. The steady-state tick, by contrast, is unit-bound and nearly flat.
 * So the thing that must never grow is the GRID, and the thing that may grow freely is the
 * NUMBER of grids. **A region is today's board**, at today's size, with today's `NAV.cell`, its
 * own ground mesh and its own fog. That is what keeps `sim.js` a referee and the headless suite
 * meaningful, and it is why this file makes a graph and not a bigger map.
 *
 * WHAT IT PRODUCES is a country from one seed: a grid of regions, a biome each, and for every
 * border either CLOSED (ocean, a wall of crag) or a small number of CROSSINGS. The crossings are
 * few and narrow on purpose — the cost of a seam is proportional to how much border there is, so
 * the geography is doing the engineering as well as the scenery. A region's own seed is derived
 * from the country's, so a region is reproducible and is generated when somebody goes there and
 * never before.
 *
 * NOTHING HERE BUILDS A WORLD. `js/realm.js` does that, on demand; this file only says what the
 * country IS. Keeping the two apart is what lets a country be saved in a few kilobytes.
 */
(function (global) {
  'use strict';

  const C = global.CONST || (typeof require !== 'undefined' ? require('./const.js') : null);
  const RNG = global.RNG || (typeof require !== 'undefined' ? require('./rng.js') : null);
  const COUNTRY = {};

  /* a stable hash, so every derived number in here is a pure function of the country's seed and
   * the thing it is about — no draw order to preserve, and two machines agree without a byte */
  function hash(a, b, c) {
    let h = (a >>> 0) ^ 0x9e3779b9;
    h = Math.imul(h ^ (b >>> 0), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (c >>> 0), 0xc2b2ae35) >>> 0;
    h ^= h >>> 15;
    return h >>> 0;
  }
  const frac = (h) => (h >>> 8) / 0x1000000;

  /* coarse value noise over the REGION grid — a country is a dozen numbers, not a million, so
   * there is nothing here worth an fbm */
  function field(seed, salt, cx, cy, cols, rows) {
    let v = 0, amp = 1, tot = 0;
    for (let o = 0; o < 3; o++) {
      const step = 1 << o;
      const gx = Math.floor(cx / (cols / (2 * step) || 1)), gy = Math.floor(cy / (rows / (2 * step) || 1));
      v += frac(hash(seed + salt + o * 7919, gx, gy)) * amp;
      tot += amp; amp *= 0.5;
    }
    return v / tot;
  }

  const KEY = (cx, cy) => cx + ',' + cy;
  const SIDES = [{ dx: 1, dy: 0, n: 'east' }, { dx: -1, dy: 0, n: 'west' },
                 { dx: 0, dy: 1, n: 'south' }, { dx: 0, dy: -1, n: 'north' }];

  /* ---------------- the country ---------------- */
  /* A COUNTRY TOO SMALL TO FIGHT OVER IS NOT A COUNTRY. The coarse noise will sometimes drown
   * nearly everything, and a war with one region in it is not a war — so a country that comes
   * back below `COUNTRY.least` land regions is rerolled with a salted seed, the same way
   * `WorldGen.build` rerolls a board whose landmass is too small. Bounded, and the last attempt
   * is taken whatever it looks like, because a menu that cannot open is worse than a poor map. */
  COUNTRY.build = function (seed, opts) {
    opts = opts || {};
    const least = (opts && opts.least != null) ? opts.least : C.COUNTRY.least;
    for (let attempt = 0; attempt < 16; attempt++) {
      const c = raise(((seed >>> 0) + attempt * 7919) >>> 0, opts);
      if (attempt === 15 || COUNTRY.landRegions(c).length >= least) { c.seed = seed >>> 0; return c; }
    }
    return null;
  };

  function raise(seed, opts) {
    opts = opts || {};
    const sd = (seed >>> 0) || 1;
    const cols = Math.max(2, Math.min(8, opts.cols || C.COUNTRY.cols));
    const rows = Math.max(2, Math.min(8, opts.rows || C.COUNTRY.rows));
    const rng = RNG.make(sd);

    /* --- what each region is made of --- */
    const regions = [], index = {};
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      const e = field(sd, 0, cx, cy, cols, rows);
      const m = field(sd, 5150, cx, cy, cols, rows);
      /* THE EDGE OF THE COUNTRY IS THE SEA, which is what makes it a country and not a plane.
       * A corner is further out than an edge, so the falloff is by the nearer axis. */
      const rim = Math.min(cx, cy, cols - 1 - cx, rows - 1 - cy);
      const open = rim === 0 ? e * C.COUNTRY.rim : e;
      const sea = open < C.COUNTRY.sea;
      const biome = sea ? null
        : open > C.COUNTRY.crag ? 'crags'
        : open > C.COUNTRY.high ? 'hills'
        : m > 0.66 ? 'forest'
        : m > 0.52 ? 'fen'
        : rim === 0 ? 'coast'
        : 'downs';
      const r = { key: KEY(cx, cy), cx, cy, sea, biome, elev: open, moist: m,
                  seed: hash(sd, cx + 1, cy + 1), nbrs: [] };
      regions.push(r); index[r.key] = r;
    }

    /* --- the borders --- */
    /* A BORDER IS CLOSED UNLESS THE GROUND SAYS OTHERWISE, and that is the whole affordability
     * argument in one rule: a seam costs what its border is long, so a country of few, narrow
     * crossings is a country whose seams are nearly free. The sea is closed absolutely; a wall
     * of crag against another wall of crag is closed; the rest is a coin the seed tosses.
     * `at` is where the crossing lies along the shared edge, in 0..1 of the board's own span —
     * a ford, a pass, a road — and it is the point a column steers at, exactly as a garrison
     * steers at its curtain's gateway one level down. */
    const link = (a, b, side, open, at) => {
      a.nbrs.push({ to: b.key, side: side.n, dx: side.dx, dy: side.dy, open: !!open, at });
    };
    for (const a of regions) for (const s of SIDES) {
      const b = index[KEY(a.cx + s.dx, a.cy + s.dy)];
      if (!b) continue;
      if (a.key > b.key) continue;                    // decide each pair once, from one side
      const mirror = SIDES.find((q) => q.dx === -s.dx && q.dy === -s.dy);
      let open = !a.sea && !b.sea;
      if (open && a.biome === 'crags' && b.biome === 'crags') open = false;
      const h = hash(sd + 31337, a.cx * 61 + a.cy, b.cx * 61 + b.cy);
      if (open && frac(h) < C.COUNTRY.shut) open = false;
      const at = 0.25 + frac(hash(sd + 4242, a.cx * 61 + a.cy, b.cx * 61 + b.cy)) * 0.5;
      link(a, b, s, open, at);
      link(b, a, mirror, open, at);
    }

    /* --- AND EVERY SHORE MUST BE REACHABLE FROM EVERY OTHER ---
     * A country cut in half by a closed border is a country half of which can never be fought
     * over, and the coin above will do it sooner or later. So the land is flooded and any piece
     * that did not come back has ONE of its borders forced open — the first in a fixed order, so
     * every machine opens the same one without a byte agreeing it. */
    let land = regions.filter((r) => !r.sea);
    if (land.length) {
      const reach = () => {
        const seen = {}, q = [land[0]];
        seen[land[0].key] = 1;
        while (q.length) {
          const r = q.pop();
          for (const nb of r.nbrs) {
            if (!nb.open) continue;
            const o = index[nb.to];
            if (o.sea || seen[o.key]) continue;
            seen[o.key] = 1; q.push(o);
          }
        }
        return seen;
      };
      /* Open one shut border per pass, always from a cut region back to the country, and
       * re-flood. It terminates because each pass either reaches at least one more region or
       * finds nothing to open. */
      for (let guard = 0; guard <= land.length; guard++) {
        const seen = reach();
        const cut = land.find((r) => !seen[r.key]);
        if (!cut) break;
        const door = cut.nbrs.find((nb) => !nb.open && !index[nb.to].sea && seen[nb.to]);
        if (!door) break;                              // no cut region touches the country
        door.open = true;
        const back = index[door.to].nbrs.find((nb) => nb.to === cut.key);
        if (back) back.open = true;
      }
      /* AND WHAT IS STILL UNREACHABLE IS NOT LAND. A piece cut off by SEA cannot be opened —
       * there is no border to open — and a city nobody can march to is a city nobody can ever
       * fight over: a promise on the map the game cannot keep. So it goes back to the water,
       * and `connected` is then true by construction rather than by hope. */
      const seen = reach();
      for (const r of land) if (!seen[r.key]) { r.sea = true; r.biome = null; }
      land = regions.filter((r) => !r.sea);
    }

    /* --- the cities --- */
    /* ONE PER LAND REGION, and none of them anybody's yet. The realm hands them out: the heirs
     * take a few, lesser lords hold the rest, and most of the early game is taking from people
     * who are not playing to win. */
    const cities = land.map((r, i) => ({
      id: i + 1, region: r.key, owner: -1, lord: null,
      name: (C.BIOMES[r.biome] ? C.BIOMES[r.biome].name : 'a country') + ' — ' + cityName(rng),
      pattern: false
    }));

    /* --- AND THERE IS ONE PATTERN ---
     * One Shrine site in the whole country, in one city, and everyone knows where. That gives
     * the map a centre without anybody declaring one and makes the endgame a convergence rather
     * than a grind through fifteen sieges. Placed at the land region nearest the middle, so it
     * is nobody's back yard: a Pattern in a corner is a Pattern that belongs to whoever starts
     * beside it. */
    const mid = { x: (cols - 1) / 2, y: (rows - 1) / 2 };
    let best = null, bd = Infinity;
    for (const c of cities) {
      const r = index[c.region];
      /* the seeded jitter is not decoration: on an even grid the four middle regions are exactly
       * equidistant, so without it the Pattern landed on the same one in every country ever
       * generated — measured over 200 seeds, all 200 put it at 1,1 */
      const d = (r.cx - mid.x) * (r.cx - mid.x) + (r.cy - mid.y) * (r.cy - mid.y)
              + frac(hash(sd + 909, r.cx + 1, r.cy + 1)) * 0.9;
      if (d < bd) { bd = d; best = c; }
    }
    if (best) { best.pattern = true; best.name = 'AMBER'; }

    return { seed: sd, cols, rows, regions, index, cities,
             pattern: best ? best.region : null };
  }

  const CITY_NAMES = ['Kolvir', 'Garnath', 'Arden', 'Rebma', 'Tir-na', 'Bayle', 'Avernus',
                      'Ygg', 'Cabra', 'Faiella', 'Oisen', 'Deiga', 'Sarn', 'Lorraine',
                      'Ghenesh', 'Antwerp', 'Begma', 'Kashfa', 'Eregnor', 'Jasra'];
  let nameBag = null;
  function cityName(rng) {
    if (!nameBag || !nameBag.length) nameBag = CITY_NAMES.slice();
    return nameBag.splice(Math.floor(rng.next() * nameBag.length), 1)[0];
  }

  /* ---------------- asking the country things ---------------- */
  COUNTRY.regionOf = (country, key) => country.index[key] || null;
  COUNTRY.cityIn = (country, key) => country.cities.find((c) => c.region === key) || null;
  COUNTRY.cityById = (country, id) => country.cities.find((c) => c.id === id) || null;
  COUNTRY.landRegions = (country) => country.regions.filter((r) => !r.sea);
  /* the crossings out of a region, in a fixed order */
  COUNTRY.doors = (country, key) => {
    const r = country.index[key];
    return r ? r.nbrs.filter((nb) => nb.open) : [];
  };
  COUNTRY.doorTo = (country, from, to) =>
    COUNTRY.doors(country, from).find((nb) => nb.to === to) || null;
  /* WHERE A CROSSING LIES ON THE BOARD. A region is `CONST.MAP` wide, and the crossing sits at
   * `at` along the shared edge — so a column ordered out of a region steers at THIS point and is
   * handed to the neighbour at the matching point on its side. It is the wall-gateway trick one
   * level up, and it is the only geometry the seam needs. */
  COUNTRY.gate = function (nb, side) {
    const W = C.MAP.W, H = C.MAP.H, inset = C.COUNTRY.inset;
    const near = side === 'far';
    if (nb.dx > 0) return { x: near ? inset : W - inset, y: H * nb.at };
    if (nb.dx < 0) return { x: near ? W - inset : inset, y: H * nb.at };
    if (nb.dy > 0) return { x: W * nb.at, y: near ? inset : H - inset };
    return { x: W * nb.at, y: near ? H - inset : inset };
  };
  /* is the country all of a piece? asked by the suite, and by nothing else — the generator
   * guarantees it, and a guarantee nobody checks is a comment */
  COUNTRY.connected = function (country) {
    const land = COUNTRY.landRegions(country);
    if (!land.length) return true;
    const seen = {}, q = [land[0]];
    seen[land[0].key] = 1;
    while (q.length) {
      const r = q.pop();
      for (const nb of r.nbrs) {
        if (!nb.open) continue;
        const o = country.index[nb.to];
        if (o.sea || seen[o.key]) continue;
        seen[o.key] = 1; q.push(o);
      }
    }
    return land.every((r) => seen[r.key]);
  };

  global.COUNTRY = COUNTRY;
  if (typeof module !== 'undefined' && module.exports) module.exports = COUNTRY;
})(typeof window !== 'undefined' ? window : globalThis);

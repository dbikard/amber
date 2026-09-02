/* lanlink-qr.js — the QR carrier for lanlink.js: a link code shown on one screen and read by
 * another phone's camera. Two verbs, and any carrier added later (sound, a shared link) keeps
 * their shape so the game picks one without knowing which:
 *   LanLink.qr.show(canvas, code, opts) → { frames, note, stop() } | null
 *   LanLink.qr.scan(els, opts)          → Promise<code>
 *
 * THE LIBRARY NEVER TOUCHES A CLASS OR AN ID. It draws into the canvas it is handed and reads
 * from the video it is handed; showing, hiding and wording the overlay are the game's
 * (`opts.open`, `opts.close`, `opts.words`), because every game dresses its scanner differently.
 *
 * ONE STILL FRAME WHEN THE CODE FITS. A P2 link code is ~200 characters — a QR of version 9
 * or 10, which a phone reads the moment its camera settles. Anything longer (a P1 fallback,
 * 700+ characters and a version-30 QR too dense for autofocus) is STREAMED: cut into
 * `opts.chunk` pieces and cycled every `opts.period` ms as `AQ|<id>|<i>|<n>|<piece>`, and the
 * scanner reassembles them in any order. `opts.still` is the boundary.
 *
 * The encoder below is the same QR generator Perils shipped (byte mode, level L, versions 1-40),
 * kept verbatim and reachable as `LanLink.qr.encoder`; it still attaches `global.QR`. */
(function (global) {
  'use strict';

  const MIN_VER = 1, MAX_VER = 40;
  // error-correction level L (max capacity, fine for on-screen scanning),
  // indexed by version (1..40):
  const ECC_PER_BLOCK = [-1,
     7, 10, 15, 20, 26, 18, 20, 24, 30, 18,
    20, 24, 26, 30, 22, 24, 28, 30, 28, 28,
    28, 28, 30, 30, 26, 28, 30, 30, 30, 30,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30];
  const NUM_BLOCKS = [-1,
     1,  1,  1,  1,  1,  2,  2,  2,  2,  4,
     4,  4,  4,  4,  6,  6,  6,  6,  7,  8,
     8,  9,  9, 10, 12, 12, 12, 13, 14, 15,
    16, 17, 18, 19, 19, 20, 21, 22, 24, 25];
  const FORMAT_BITS_ECL = 1; // 2-bit field value for level L

  /* ---- Galois field GF(256) arithmetic (Reed-Solomon, primitive poly 0x11D) ---- */
  function rsMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xFF;
  }
  function rsDivisor(degree) {
    const result = new Uint8Array(degree);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < result.length; j++) {
        result[j] = rsMul(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = rsMul(root, 0x02);
    }
    return result;
  }
  function rsRemainder(data, divisor) {
    const result = new Uint8Array(divisor.length);
    for (let k = 0; k < data.length; k++) {
      const factor = data[k] ^ result[0];
      result.copyWithin(0, 1);
      result[result.length - 1] = 0;
      for (let i = 0; i < result.length; i++) result[i] ^= rsMul(divisor[i], factor);
    }
    return result;
  }

  /* ---- module-count helpers ---- */
  function numRawDataModules(ver) {
    let result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }
  function numDataCodewords(ver) {
    return Math.floor(numRawDataModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];
  }

  /* ---- bit buffer ---- */
  function appendBits(bb, val, len) {
    for (let i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1);
  }

  /* ---- encode text → data codewords for the smallest fitting version ---- */
  function makeCodewords(text) {
    const bytes = new TextEncoder().encode(text);
    // pick smallest version whose data capacity holds the byte segment
    let ver = -1, ccBits = 8;
    for (let v = MIN_VER; v <= MAX_VER; v++) {
      ccBits = v <= 9 ? 8 : 16;
      const need = 4 + ccBits + 8 * bytes.length;
      if (need <= numDataCodewords(v) * 8) { ver = v; break; }
    }
    if (ver < 0) throw new Error('data too long for QR (max version ' + MAX_VER + ')');

    const bb = [];
    appendBits(bb, 0x4, 4);              // byte mode indicator
    appendBits(bb, bytes.length, ccBits); // character count
    for (let i = 0; i < bytes.length; i++) appendBits(bb, bytes[i], 8);

    const capacityBits = numDataCodewords(ver) * 8;
    appendBits(bb, 0, Math.min(4, capacityBits - bb.length)); // terminator
    appendBits(bb, 0, (8 - bb.length % 8) % 8);               // byte align
    for (let pad = 0xEC; bb.length < capacityBits; pad ^= 0xEC ^ 0x11) appendBits(bb, pad, 8);

    const dataCw = new Uint8Array(bb.length / 8);
    for (let i = 0; i < bb.length; i++) dataCw[i >>> 3] |= bb[i] << (7 - (i & 7));
    return { ver, dataCw };
  }

  /* ---- interleave data + Reed-Solomon ECC across blocks ---- */
  function addEcc(ver, data) {
    const numBlocks = NUM_BLOCKS[ver];
    const eccLen = ECC_PER_BLOCK[ver];
    const rawCw = Math.floor(numRawDataModules(ver) / 8);
    const numShort = numBlocks - rawCw % numBlocks;
    const shortLen = Math.floor(rawCw / numBlocks);
    const divisor = rsDivisor(eccLen);

    const blocks = [];
    for (let i = 0, k = 0; i < numBlocks; i++) {
      const datLen = shortLen - eccLen + (i < numShort ? 0 : 1);
      const dat = data.slice(k, k + datLen); k += datLen;
      const ecc = rsRemainder(dat, divisor);
      const block = new Uint8Array(datLen + eccLen);
      block.set(dat, 0); block.set(ecc, datLen);
      blocks.push(block);
    }

    const result = new Uint8Array(rawCw);
    let idx = 0;
    const maxDat = shortLen - eccLen + 1;
    for (let i = 0; i < maxDat; i++) {
      for (let b = 0; b < blocks.length; b++) {
        // the +1 longer blocks (data part) come last; short blocks skip the gap
        if (i < blocks[b].length - eccLen) result[idx++] = blocks[b][i];
      }
    }
    for (let i = 0; i < eccLen; i++) {
      for (let b = 0; b < blocks.length; b++) result[idx++] = blocks[b][blocks[b].length - eccLen + i];
    }
    return result;
  }

  /* ---- matrix assembly ---- */
  function alignPositions(ver) {
    if (ver === 1) return [];
    const numAlign = Math.floor(ver / 7) + 2;
    const size = ver * 4 + 17;
    const step = Math.ceil((size - 13) / (numAlign * 2 - 2)) * 2;
    const result = [6];
    for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  function buildMatrix(ver, codewords) {
    const size = ver * 4 + 17;
    const mod = []; const fn = [];
    for (let y = 0; y < size; y++) { mod.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    const set = (x, y, v) => { if (x >= 0 && x < size && y >= 0 && y < size) { mod[y][x] = v; fn[y][x] = true; } };

    // timing patterns
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }

    // finder patterns + separators
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);

    // alignment patterns
    const ap = alignPositions(ver);
    for (let i = 0; i < ap.length; i++) for (let j = 0; j < ap.length; j++) {
      const corner = (i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0);
      if (corner) continue; // overlaps finders
      const cx = ap[i], cy = ap[j];
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
        set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }

    // reserve format + version areas as function modules (filled later)
    const reserveFormat = () => {
      for (let i = 0; i < 9; i++) { set(8, i, false); set(i, 8, false); }
      for (let i = 0; i < 8; i++) { set(size - 1 - i, 8, false); set(8, size - 1 - i, false); }
      set(8, size - 8, true); // dark module
    };
    reserveFormat();
    if (ver >= 7) {
      for (let i = 0; i < 18; i++) {
        const a = size - 11 + i % 3, b = Math.floor(i / 3);
        set(a, b, false); set(b, a, false);
      }
    }

    // place data codewords in zig-zag, skipping function modules
    let bitIdx = 0;
    const totalBits = codewords.length * 8;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // skip vertical timing column
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!fn[y][x] && bitIdx < totalBits) {
            mod[y][x] = ((codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) !== 0;
            bitIdx++;
          }
        }
      }
    }

    return { size, mod, fn };
  }

  // mask condition for mask pattern `m`
  function maskFn(m, x, y) {
    switch (m) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return (x * y) % 2 + (x * y) % 3 === 0;
      case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
      case 7: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
    }
    return false;
  }

  function drawFormat(mat, mask) {
    const { size, mod, fn } = mat;
    // 5 data bits (2 ecl + 3 mask) → 15-bit BCH format code
    const data = (FORMAT_BITS_ECL << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const get = (i) => ((bits >>> i) & 1) !== 0;
    // place around top-left finder
    for (let i = 0; i <= 5; i++) mod[i][8] = get(i);
    mod[7][8] = get(6); mod[8][8] = get(7); mod[8][7] = get(8);
    for (let i = 9; i < 15; i++) mod[8][14 - i] = get(i);
    // duplicate copy along the right + bottom
    for (let i = 0; i < 8; i++) mod[8][size - 1 - i] = get(i);
    for (let i = 8; i < 15; i++) mod[size - 15 + i][8] = get(i);
    mod[size - 8][8] = true; // dark module
    fn; // (format cells already marked functional)
  }

  function drawVersion(mat, ver) {
    if (ver < 7) return;
    const { size, mod } = mat;
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) !== 0;
      const a = Math.floor(i / 3), b = i % 3;
      mod[size - 11 + b][a] = bit;
      mod[a][size - 11 + b] = bit;
    }
  }

  function penalty(mat) {
    const { size, mod } = mat; let p = 0;
    // rule 1: runs of 5+ same-color in rows/cols
    for (let y = 0; y < size; y++) {
      let runC = 1, runR = 1;
      for (let x = 1; x < size; x++) {
        if (mod[y][x] === mod[y][x - 1]) { if (++runC >= 5) p += runC === 5 ? 3 : 1; } else runC = 1;
        if (mod[x][y] === mod[x - 1][y]) { if (++runR >= 5) p += runR === 5 ? 3 : 1; } else runR = 1;
      }
    }
    // rule 2: 2x2 blocks
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++)
      if (mod[y][x] === mod[y][x + 1] && mod[y][x] === mod[y + 1][x] && mod[y][x] === mod[y + 1][x + 1]) p += 3;
    // rule 4: proportion of dark modules
    let dark = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (mod[y][x]) dark++;
    const ratio = dark / (size * size);
    p += Math.floor(Math.abs(ratio * 100 - 50) / 5) * 10;
    return p;
  }

  /* ---- public API: text → { size, mod[][] } picking the best mask ---- */
  function generate(text) {
    const { ver, dataCw } = makeCodewords(text);
    const codewords = addEcc(ver, dataCw);

    let best = null, bestPenalty = Infinity, bestMask = 0;
    for (let mask = 0; mask < 8; mask++) {
      const mat = buildMatrix(ver, codewords);
      // apply mask to non-function modules
      for (let y = 0; y < mat.size; y++) for (let x = 0; x < mat.size; x++)
        if (!mat.fn[y][x] && maskFn(mask, x, y)) mat.mod[y][x] = !mat.mod[y][x];
      drawFormat(mat, mask);
      drawVersion(mat, ver);
      const pen = penalty(mat);
      if (pen < bestPenalty) { bestPenalty = pen; best = mat; bestMask = mask; }
    }
    return { size: best.size, mod: best.mod, version: ver, mask: bestMask };
  }

  /* ---- render a QR result onto a canvas (crisp, with quiet zone) ---- */
  function render(canvas, text, opts) {
    opts = opts || {};
    const qr = generate(text);
    const quiet = opts.quiet == null ? 3 : opts.quiet;
    const dim = qr.size + quiet * 2;
    const px = Math.max(1, Math.floor((opts.size || 240) / dim));
    const wh = dim * px;
    canvas.width = wh; canvas.height = wh;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = opts.light || '#ffffff';
    ctx.fillRect(0, 0, wh, wh);
    ctx.fillStyle = opts.dark || '#05070d';
    for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++)
      if (qr.mod[y][x]) ctx.fillRect((x + quiet) * px, (y + quiet) * px, px, px);
    return qr;
  }

  global.QR = { generate, render };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.QR;
})(typeof window !== 'undefined' ? window : globalThis);

(function (global) {
  'use strict';
  const LanLink = global.LanLink;
  const qr = LanLink.qr = { encoder: global.QR };

  qr.show = function (canvas, code, opts) {
    opts = opts || {};
    const size = opts.size || 560, still = opts.still != null ? opts.still : 300;
    const CHUNK = opts.chunk || 80, period = opts.period || 420;
    const render = (text) => global.QR.render(canvas, text, { size, quiet: 4, dark: '#000000', light: '#ffffff' });
    if (code.length <= still) {
      try { render(code); return { frames: 1, note: 'showing ' + code.length + ' chars as one still QR', stop() {} }; }
      catch (e) { /* too long for one frame after all — stream it */ }
    }
    const chunks = [];
    for (let i2 = 0; i2 < code.length; i2 += CHUNK) chunks.push(code.slice(i2, i2 + CHUNK));
    const id = Math.random().toString(36).slice(2, 6), n = chunks.length;
    let i = 0;
    const drawFrame = () => { try { render('AQ|' + id + '|' + i + '|' + n + '|' + chunks[i]); } catch (e) {} i = (i + 1) % n; };
    drawFrame();
    const timer = n > 1 ? setInterval(drawFrame, period) : null;
    return { frames: n, note: 'showing ' + code.length + ' chars as ' + n + ' QR frames', stop() { if (timer) clearInterval(timer); } };
  };

  /* els: { video, hint?, cancel? }. opts: { open(), close(), words: { aim, reading(have, need) },
   * onProgress(have, need) }. Resolves the full code; rejects on no scanner, no camera, or cancel. */
  qr.scan = function (els, opts) {
    opts = opts || {};
    const words = opts.words || {};
    const say = (t) => { if (els.hint) els.hint.textContent = t; };
    return new Promise(async (resolve, reject) => {
      if (!('BarcodeDetector' in global)) { reject(new Error('this browser can’t scan QR codes')); return; }
      let supported = [];
      try { supported = await global.BarcodeDetector.getSupportedFormats(); } catch (e) {}
      if (supported.indexOf('qr_code') < 0) { reject(new Error('QR scanning unsupported here')); return; }
      const detector = new global.BarcodeDetector({ formats: ['qr_code'] });
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } });
      } catch (e) { reject(new Error('camera blocked — allow camera access')); return; }
      try {
        const track = stream.getVideoTracks()[0];
        const caps = track.getCapabilities ? track.getCapabilities() : {};
        if (caps.focusMode && caps.focusMode.indexOf('continuous') >= 0) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      } catch (e) {}
      const video = els.video;
      video.srcObject = stream; try { await video.play(); } catch (e) {}
      if (opts.open) opts.open();
      say(words.aim || 'Point at the other phone');
      let done = false;
      const snap = document.createElement('canvas'), sctx = snap.getContext('2d');
      const cleanup = () => { done = true; if (opts.close) opts.close(); stream.getTracks().forEach((t2) => t2.stop()); video.srcObject = null; };
      if (els.cancel) els.cancel.onclick = () => { cleanup(); reject(new Error('scan cancelled')); };
      const parts = {}; let pid = null, need = 0, have = 0;
      const tick = async () => {
        if (done) return;
        try {
          let src = video;
          if (video.videoWidth) { snap.width = video.videoWidth; snap.height = video.videoHeight; sctx.drawImage(video, 0, 0); src = snap; }
          const codes = await detector.detect(src);
          for (const code of codes || []) {
            const v = code.rawValue; if (!v) continue;
            if (v.slice(0, 3) !== 'AQ|') { cleanup(); resolve(v); return; }
            const p = v.split('|');
            if (p.length < 5) continue;
            const id = p[1], idx = +p[2], total = +p[3];
            if (pid !== id) { pid = id; need = total; have = 0; for (const k in parts) delete parts[k]; }
            if (parts[idx] == null) {
              parts[idx] = p.slice(4).join('|'); have++;
              say(words.reading ? words.reading(have, need) : 'reading… ' + have + '/' + need);
              if (opts.onProgress) opts.onProgress(have, need);
            }
            if (need > 0 && have >= need) {
              let full = '', ok = true;
              for (let k = 0; k < need; k++) { if (parts[k] == null) { ok = false; break; } full += parts[k]; }
              if (ok) { cleanup(); resolve(full); return; }
            }
          }
        } catch (e) { /* transient detect error — keep scanning */ }
        if (!done) setTimeout(() => requestAnimationFrame(tick), 60);
      };
      requestAnimationFrame(tick);
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);

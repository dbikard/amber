/* lanlink.js — serverless LAN pairing over WebRTC, for a page that has no backend.
 *
 * Two (or four) browsers on one Wi-Fi exchange LINK CODES — an offer and an answer, the SDP
 * of a DataChannel connection — over some channel outside the network (a QR code held up to a
 * camera; see lanlink-qr.js), and then talk directly. No signalling server, no TURN of ours;
 * deployable as static files. Born in Perils (lockstep co-op), grown in Amber (a host-
 * authoritative star of up to four seats), and kept here so the next game does not port it a
 * third time.
 *
 * THE LIBRARY STOPS AT THE CHANNEL. `LanLink.create(opts)` returns a TABLE: host it, join it,
 * accept the reply, send to a seat, and be told when a seat opens, closes, or a message lands
 * (`onMessage(m, from)`, `from` being the seat it arrived on — the one thing about a message a
 * peer cannot forge). What the messages MEAN is the game's protocol and lives in the game.
 * Everything a table needs is on the table object itself — its role, its seat, its peers, its
 * diagnostics — as plain mutable fields, because the games' own test rigs stand a fake table up
 * by setting them.
 *
 * `LanLink.code` is the link-code codec on its own: P2 packs the description by FIELD (about
 * 200 characters, one still QR frame); P1 is the deflated JSON it replaces and still the
 * fallback for any description P2 was not taught; P0 is uncompressed. Pure functions, no DOM,
 * so a Node suite can hold them.
 *
 * Browser-only at CALL time (RTCPeerConnection, wake lock, CompressionStream); safe to LOAD
 * anywhere, which is what lets a headless suite require it. No dependencies. Vendor it as one
 * file. */
(function (global) {
  'use strict';

  const LanLink = { VERSION: '0.1.0' };

  /* ---------------- link codes: compressed base64url SDP (ported) ---------------- */
  function b64encode(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64decode(str) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  /* ---------------- P2: the link code packed by FIELD ----------------
   * THE CODE ON SCREEN IS ALL THERE WILL EVER BE. There is no server to ask again, no second
   * message, no retry: one phone photographs the other, and whatever survived the photograph
   * is the whole of what the far side will ever know about this peer. A datachannel-only
   * offer is ~960 bytes of SDP, ~700 chars once deflated (P1), and at 80 chars a frame that is
   * nine cycling QR codes fighting a phone's autofocus — the slow part of pairing, measured on
   * the table. Almost all of it is boilerplate every browser writes the same way. What is
   * actually THIS peer's is the ICE ufrag and password, the DTLS fingerprint, the setup role
   * and the candidate list: ~150 bytes packed, ~200 chars, one still frame.
   *
   * So the danger of a codec here is not that it is big but that it is CONFIDENT. A field it
   * did not know about and quietly dropped is not a slightly worse link; it is a link with a
   * permanent hole that no diagnostic will ever name, because the far side reads a perfectly
   * well-formed SDP with the hole already in it. Two rules hold it:
   *   1. THE WHITELIST. `readSdp` accepts exactly the lines it was taught — the boilerplate it
   *      may drop, the fields it keeps, the candidate extensions it may drop (Chrome's
   *      `generation`/`network-cost`/... are bookkeeping about the gatherer's own interfaces)
   *      — and ANY other line, extension, fingerprint algorithm, second m-line or address it
   *      cannot normalise makes the whole description null. Refusal is cheap: P1 still stands.
   *   2. THE SELF ROUND TRIP. `packDesc` unpacks its own bytes, re-reads the SDP it rebuilt and
   *      compares field for field with what it read from the original, type included. A byte
   *      layout that loses anything — a leading zero, a case, a flag — refuses itself rather
   *      than shipping. A codec that checks itself on every code cannot rot silently.
   * P1 is the fallback for everything P2 refuses, and the diag says WHICH was used and, when it
   * was P1, WHY (`lastPackReason`), because a table where every code is nine frames is a table
   * where the whitelist has fallen behind a browser, and that is a bug report with a line in it.
   * Addresses are normalised at parse time — IPv4 re-joined from numbers, IPv6 to 32 hex chars,
   * mDNS to its uuid — and the round trip is judged on the normalised form, so the rebuilt
   * string may spell an address differently and still be the same address. Anything the
   * normaliser is not sure of (a scoped `%eth0`, an embedded `::ffff:1.2.3.4`) is refused. */
  let lastPackReason = '';
  const SETUPS = ['actpass', 'active', 'passive', 'holdconn'];
  const CTYPES = ['host', 'srflx', 'prflx', 'relay'];
  const MID_DEF = '0', SCTP_DEF = 5000, MAXMSG_DEF = 262144;
  /* candidate extensions: kept ride the wire, dropped are the gatherer's own bookkeeping */
  const EXT_KEEP = { raddr: 1, rport: 1, tcptype: 1 };
  const EXT_DROP = { generation: 1, 'network-cost': 1, 'network-id': 1, 'network-type': 1, ufrag: 1 };
  const refuse = (why) => { lastPackReason = why; return null; };

  /* IPv6 text → 32 lowercase hex chars, or null. Conservative on purpose: one `::` at most,
   * hex groups only — no zone (`%`), no embedded dotted quad. */
  function ip6hex(s) {
    s = s.toLowerCase();
    if (!/^[0-9a-f:]+$/.test(s)) return null;
    const halves = s.split('::');
    if (halves.length > 2) return null;
    const groups = (h) => {
      if (h === '') return [];
      const g = h.split(':');
      for (const x of g) if (!/^[0-9a-f]{1,4}$/.test(x)) return null;
      return g;
    };
    const L = groups(halves[0]), Rr = halves.length === 2 ? groups(halves[1]) : [];
    if (!L || !Rr) return null;
    let all;
    if (halves.length === 2) {
      if (L.length + Rr.length > 7) return null;
      all = L.concat(new Array(8 - L.length - Rr.length).fill('0'), Rr);
    } else {
      if (L.length !== 8) return null;
      all = L;
    }
    return all.map((g) => g.padStart(4, '0')).join('');
  }
  /* 32 hex chars → RFC 5952-ish text: leading zeros dropped, the first longest zero run of
   * two or more groups as `::` */
  function ip6str(hex) {
    const g = [];
    for (let i = 0; i < 8; i++) g.push(parseInt(hex.slice(i * 4, i * 4 + 4), 16));
    let bestAt = -1, bestLen = 1;
    for (let i = 0; i < 8; i++) {
      if (g[i] !== 0) continue;
      let j = i; while (j < 8 && g[j] === 0) j++;
      if (j - i > bestLen) { bestAt = i; bestLen = j - i; }
      i = j;
    }
    const hx = (n) => n.toString(16);
    if (bestAt < 0) return g.map(hx).join(':');
    return g.slice(0, bestAt).map(hx).join(':') + '::' + g.slice(bestAt + bestLen).map(hx).join(':');
  }
  /* an address as it appears in a candidate line → {t, v}, or null when unsure */
  function readAddr(s) {
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) {
      const p = s.split('.').map(Number);
      if (p.some((n) => n > 255)) return null;
      return { t: 0, v: p.join('.') };
    }
    const m = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i.exec(s);
    if (m) return { t: 2, v: (m[1] + m[2] + m[3] + m[4] + m[5]).toLowerCase() };
    if (s.indexOf(':') >= 0) { const v = ip6hex(s); return v ? { t: 1, v } : null; }
    /* anything else, raw: printable ASCII with no space (the line was split on spaces, so a
     * space could not have arrived here, and one must not leave here either) */
    if (!/^[\x21-\x7e]{1,255}$/.test(s)) return null;
    return { t: 3, v: s };
  }
  function addrStr(a) {
    if (a.t === 0) return a.v;
    if (a.t === 1) return ip6str(a.v);
    if (a.t === 2) return a.v.slice(0, 8) + '-' + a.v.slice(8, 12) + '-' + a.v.slice(12, 16) + '-' + a.v.slice(16, 20) + '-' + a.v.slice(20) + '.local';
    return a.v;
  }
  const isPort = (s) => /^\d{1,5}$/.test(s) && +s <= 65535;

  /* a=candidate:... → the candidate's fields, every key present so JSON.stringify is canonical */
  function readCand(line) {
    const tk = line.slice('a=candidate:'.length).split(' ');
    if (tk.length < 8 || tk[6] !== 'typ') return refuse('candidate shape: ' + line);
    const found = tk[0];
    if (!/^[\x21-\x7e]{1,255}$/.test(found)) return refuse('candidate foundation: ' + line);
    if (tk[1] !== '1' && tk[1] !== '2') return refuse('candidate component: ' + line);
    const transport = tk[2].toLowerCase();
    if (transport !== 'udp' && transport !== 'tcp') return refuse('candidate transport: ' + line);
    if (!/^\d{1,10}$/.test(tk[3]) || +tk[3] > 0xFFFFFFFF) return refuse('candidate priority: ' + line);
    const addr = readAddr(tk[4]);
    if (!addr) return refuse('candidate address: ' + line);
    if (!isPort(tk[5])) return refuse('candidate port: ' + line);
    const type = CTYPES.indexOf(tk[7]);
    if (type < 0) return refuse('candidate type: ' + line);
    let raddr = null, rport = null, tcptype = null;
    for (let i = 8; i < tk.length; i += 2) {
      const k = tk[i], v = tk[i + 1];
      if (v === undefined) return refuse('candidate extension without a value: ' + line);
      if (EXT_DROP[k]) continue;
      if (!EXT_KEEP[k]) return refuse('candidate extension "' + k + '": ' + line);
      if (k === 'raddr') {
        raddr = readAddr(v);
        if (!raddr || raddr.t > 1) return refuse('candidate raddr: ' + line);
      } else if (k === 'rport') {
        if (!isPort(v)) return refuse('candidate rport: ' + line);
        rport = +v;
      } else {
        if (!/^[\x21-\x7e]{1,255}$/.test(v)) return refuse('candidate tcptype: ' + line);
        tcptype = v;
      }
    }
    if ((raddr === null) !== (rport === null)) return refuse('candidate raddr without rport: ' + line);
    return { found, comp: +tk[1], transport, priority: +tk[3], addr, port: +tk[5],
             type: CTYPES[type], raddr, rport, tcptype };
  }

  /* the strict whitelist parser: fields, or null with `lastPackReason` naming the line */
  function readSdp(sdp) {
    if (typeof sdp !== 'string') return refuse('no sdp');
    const f = { ufrag: null, pwd: null, fp: null, setup: null, mid: null, sctpPort: SCTP_DEF,
                maxMsg: MAXMSG_DEF, trickle: false, eoc: false, cands: [] };
    let mLines = 0, bundle = null;
    /* one value per field: a repeat that agrees (Firefox says ufrag at both levels in some
     * versions) is fine; a repeat that disagrees is two peers in one description */
    const once = (k, v, line) => {
      if (f[k] !== null && f[k] !== v) return refuse('conflicting ' + k + ': ' + line);
      f[k] = v; return true;
    };
    for (const line of sdp.split(/\r?\n/)) {
      if (line === '') continue;
      let m;
      if (line === 'v=0' || /^o=/.test(line) || /^s=/.test(line) || /^t=/.test(line) || /^c=/.test(line) ||
          line === 'a=extmap-allow-mixed' || /^a=msid-semantic:/.test(line) || line === 'a=sendrecv') continue;
      if ((m = /^a=group:BUNDLE (\S+)$/.exec(line))) { if (bundle !== null && bundle !== m[1]) return refuse('two BUNDLE groups: ' + line); bundle = m[1]; continue; }
      if (line === 'a=ice-options:trickle') { f.trickle = true; continue; }
      if (line === 'a=end-of-candidates') { f.eoc = true; continue; }
      if (/^m=/.test(line)) {
        if (++mLines > 1) return refuse('a second m-line: ' + line);
        if (!/^m=application [09] UDP\/DTLS\/SCTP webrtc-datachannel$/.test(line)) return refuse('m-line: ' + line);
        continue;
      }
      if ((m = /^a=ice-ufrag:(\S{1,255})$/.exec(line))) { if (!once('ufrag', m[1], line)) return null; continue; }
      if ((m = /^a=ice-pwd:(\S{1,255})$/.exec(line))) { if (!once('pwd', m[1], line)) return null; continue; }
      if ((m = /^a=fingerprint:(\S+) (\S+)$/.exec(line))) {
        if (m[1].toLowerCase() !== 'sha-256') return refuse('fingerprint algorithm: ' + line);
        if (!/^([0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/.test(m[2])) return refuse('fingerprint shape: ' + line);
        if (!once('fp', m[2].replace(/:/g, '').toLowerCase(), line)) return null;
        continue;
      }
      if ((m = /^a=setup:(\S+)$/.exec(line))) { if (SETUPS.indexOf(m[1]) < 0) return refuse('setup: ' + line); if (!once('setup', m[1], line)) return null; continue; }
      if ((m = /^a=mid:(\S{1,255})$/.exec(line))) { if (!once('mid', m[1], line)) return null; continue; }
      if ((m = /^a=sctp-port:(\d{1,5})$/.exec(line))) { if (+m[1] > 65535) return refuse('sctp-port: ' + line); f.sctpPort = +m[1]; continue; }
      if ((m = /^a=max-message-size:(\d{1,15})$/.exec(line))) { f.maxMsg = +m[1]; continue; }
      if (/^a=candidate:/.test(line)) { const c = readCand(line); if (!c) return null; f.cands.push(c); continue; }
      return refuse('unknown line: ' + line);
    }
    if (mLines !== 1) return refuse('no m-line');
    for (const k of ['ufrag', 'pwd', 'fp', 'setup', 'mid']) if (f[k] === null) return refuse('missing ' + k);
    if (bundle !== null && bundle !== f.mid) return refuse('BUNDLE names a mid that is not here: ' + bundle);
    return f;
  }

  /* ---- the byte layout ---- */
  const utf8 = (s) => new TextEncoder().encode(s);
  function packDesc(jsonStr) {
    let d;
    try { d = JSON.parse(jsonStr); } catch (e) { return refuse('not JSON'); }
    if (!d || (d.type !== 'offer' && d.type !== 'answer')) return refuse('type: ' + (d && d.type));
    const f = readSdp(d.sdp);
    if (!f) return null;
    const out = [];
    const u8 = (n) => out.push(n & 255);
    const u16 = (n) => { u8(n >> 8); u8(n); };
    const u32 = (n) => { u8(n >>> 24); u8(n >>> 16); u8(n >>> 8); u8(n); };
    const varint = (n) => { while (n >= 128) { u8((n % 128) | 128); n = Math.floor(n / 128); } u8(n); };
    const bytes = (b) => { for (const x of b) u8(x); };
    const str8 = (s, what) => { const b = utf8(s); if (b.length > 255) return refuse(what + ' too long'); u8(b.length); bytes(b); return true; };
    const hex = (h) => { for (let i = 0; i < h.length; i += 2) u8(parseInt(h.slice(i, i + 2), 16)); };
    const addrBytes = (a) => {
      if (a.t === 0) { for (const n of a.v.split('.')) u8(+n); return true; }
      if (a.t === 1 || a.t === 2) { hex(a.v); return true; }
      return str8(a.v, 'address');
    };
    u8(1);
    u8((d.type === 'answer' ? 1 : 0) | (SETUPS.indexOf(f.setup) << 1) | (f.mid === MID_DEF ? 8 : 0) |
       (f.sctpPort === SCTP_DEF ? 16 : 0) | (f.maxMsg === MAXMSG_DEF ? 32 : 0) | (f.trickle ? 64 : 0) | (f.eoc ? 128 : 0));
    if (!str8(f.ufrag, 'ufrag') || !str8(f.pwd, 'pwd')) return null;
    hex(f.fp);
    if (f.mid !== MID_DEF) { const b = utf8(f.mid); varint(b.length); bytes(b); }
    if (f.sctpPort !== SCTP_DEF) varint(f.sctpPort);
    if (f.maxMsg !== MAXMSG_DEF) varint(f.maxMsg);
    varint(f.cands.length);
    for (const c of f.cands) {
      /* a numeric foundation with no leading zero rides as a number; anything else as text */
      const numF = /^(0|[1-9]\d{0,14})$/.test(c.found);
      u8(CTYPES.indexOf(c.type) | (c.transport === 'tcp' ? 4 : 0) | (c.addr.t << 3) |
         (c.raddr ? 32 : 0) | (c.tcptype !== null ? 64 : 0) | (c.comp === 2 ? 128 : 0));
      u8((numF ? 0 : 1) | (c.raddr && c.raddr.t === 1 ? 2 : 0));
      if (numF) varint(+c.found); else if (!str8(c.found, 'foundation')) return null;
      u32(c.priority);
      if (!addrBytes(c.addr)) return null;
      u16(c.port);
      if (c.raddr) { addrBytes(c.raddr); u16(c.rport); }
      if (c.tcptype !== null && !str8(c.tcptype, 'tcptype')) return null;
    }
    const packed = new Uint8Array(out);
    /* THE SELF ROUND TRIP: what the far side will read has to be what was read here */
    let back;
    try { back = JSON.parse(unpackDesc(packed)); } catch (e) { return refuse('self-check threw: ' + e.message); }
    const g = readSdp(back.sdp);
    if (!g) return refuse('self-check re-read: ' + lastPackReason);
    if (back.type !== d.type || JSON.stringify(g) !== JSON.stringify(f)) return refuse('self-check mismatch');
    return packed;
  }

  function unpackDesc(bytes) {
    let p = 0;
    const need = (n) => { if (p + n > bytes.length) throw new Error('link code truncated'); };
    const u8 = () => { need(1); return bytes[p++]; };
    const u16 = () => (u8() << 8) | u8();
    const u32 = () => ((u8() << 24) >>> 0) + (u8() << 16) + (u8() << 8) + u8();
    const varint = () => { let n = 0, mul = 1, b; do { b = u8(); n += (b & 127) * mul; mul *= 128; if (mul > 2 ** 56) throw new Error('link code: varint'); } while (b & 128); return n; };
    const take = (n) => { need(n); const s = bytes.subarray(p, p + n); p += n; return s; };
    const str = (n) => new TextDecoder().decode(take(n));
    const hex = (n) => Array.from(take(n), (x) => x.toString(16).padStart(2, '0')).join('');
    const addr = (t) => {
      if (t === 0) return Array.from(take(4)).join('.');
      if (t === 1) return ip6str(hex(16));
      if (t === 2) return addrStr({ t: 2, v: hex(16) });
      return str(u8());
    };
    if (u8() !== 1) throw new Error('link code: unknown P2 version');
    const fl = u8();
    const type = (fl & 1) ? 'answer' : 'offer', setup = SETUPS[(fl >> 1) & 3];
    const ufrag = str(u8()), pwd = str(u8()), fp = hex(32);
    const mid = (fl & 8) ? MID_DEF : str(varint());
    const sctpPort = (fl & 16) ? SCTP_DEF : varint();
    const maxMsg = (fl & 32) ? MAXMSG_DEF : varint();
    const cands = [];
    const n = varint();
    for (let i = 0; i < n; i++) {
      const f0 = u8(), f1 = u8();
      const found = (f1 & 1) ? str(u8()) : String(varint());
      const priority = u32();
      const a = addr((f0 >> 3) & 3);
      const port = u16();
      let line = 'a=candidate:' + found + ' ' + ((f0 & 128) ? 2 : 1) + ' ' + ((f0 & 4) ? 'tcp' : 'udp') + ' ' +
                 priority + ' ' + a + ' ' + port + ' typ ' + CTYPES[f0 & 3];
      if (f0 & 32) { const ra = addr((f1 & 2) ? 1 : 0); line += ' raddr ' + ra + ' rport ' + u16(); }
      if (f0 & 64) line += ' tcptype ' + str(u8());
      cands.push(line);
    }
    if (p !== bytes.length) throw new Error('link code: trailing bytes');
    const fpText = fp.toUpperCase().match(/../g).join(':');
    const lines = ['v=0', 'o=- 0 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE ' + mid,
                   'a=extmap-allow-mixed', 'a=msid-semantic: WMS',
                   'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
                   ...cands, 'a=ice-ufrag:' + ufrag, 'a=ice-pwd:' + pwd,
                   ...((fl & 64) ? ['a=ice-options:trickle'] : []),
                   'a=fingerprint:sha-256 ' + fpText, 'a=setup:' + setup, 'a=mid:' + mid,
                   'a=sctp-port:' + sctpPort, 'a=max-message-size:' + maxMsg,
                   ...((fl & 128) ? ['a=end-of-candidates'] : [])];
    return JSON.stringify({ type, sdp: lines.join('\r\n') + '\r\n' });
  }

  /* `opts.force` ('P1' | 'P0') is for the suite, which has to hold the legacy formats against
   * a code it made itself; play never passes it. */
  async function compress(str, opts) {
    const force = opts && opts.force;
    const say = (opts && opts.say) || (() => {});
    if (!force) {
      const packed = packDesc(str);
      if (packed) { const code = 'P2' + b64encode(packed); say('link code: P2 ' + code.length + ' chars'); return code; }
      say('link code: P1 (' + lastPackReason + ')');
    }
    const data = new TextEncoder().encode(str);
    if (force === 'P0' || typeof CompressionStream === 'undefined') return 'P0' + b64encode(data);
    const cs = new CompressionStream('deflate-raw');
    const buf = await new Response(new Blob([data]).stream().pipeThrough(cs)).arrayBuffer();
    return 'P1' + b64encode(new Uint8Array(buf));
  }
  async function decompress(code) {
    code = code.trim();
    const tag = code.slice(0, 2), body = b64decode(code.slice(2));
    if (tag === 'P2') return unpackDesc(body);
    if (tag === 'P0') return new TextDecoder().decode(body);
    const ds = new DecompressionStream('deflate-raw');
    const buf = await new Response(new Blob([body]).stream().pipeThrough(ds)).arrayBuffer();
    return new TextDecoder().decode(buf);
  }
  LanLink.code = { readSdp, packDesc, unpackDesc, compress, decompress };
  Object.defineProperty(LanLink.code, 'lastPackReason', { get: () => lastPackReason });

  /* ---------------- the table ----------------
   * `opts.maxPeers` — how many guests a host will seat (3 for a table of four).
   * `opts.ice` — RTC ice servers, if the defaults below are not wanted. */
  LanLink.create = function (opts) {
    opts = opts || {};
    const link = {
      active: false,      // a channel is open
      isHost: false,
      localIdx: 0,        // this seat: 0 for the host; a guest is told its seat by the host
      peerGone: false,    // the far side went away (host: the last guest did)
      pc: null, dc: null, // guest: its one link
      peers: [],          // host only: [{ pc, dc, idx }], one per guest, paired one at a time
      maxPeers: opts.maxPeers != null ? opts.maxPeers : 3,
      onOpen: null,       // (seat) a channel opened
      onClose: null,      // (seat) a channel closed — it says nothing about why
      onFail: null,       // (pc) a connection gave up: the network will not carry this link
      onMessage: null,    // (m, from) a message arrived on seat `from`
      diag: [], onDiag: null, _pairing: false, _pending: null
    };

    /* ---------------- handshake diagnostics (ported) ---------------- */
    function diag(msg) {
      const t = (typeof performance !== 'undefined' ? performance.now() / 1000 : 0).toFixed(1);
      link.diag.push(t + 's  ' + msg);
      if (link.diag.length > 50) link.diag.shift();
      if (link.onDiag) link.onDiag(link.diag);
    }
    link.diagReset = function () {
      link.diag = [];
      diag('secureContext=' + (typeof isSecureContext !== 'undefined' ? isSecureContext : '?') +
           '  RTC=' + (typeof RTCPeerConnection !== 'undefined') +
           '  compress=' + (typeof CompressionStream !== 'undefined'));
    };
    link.diagText = function () { return link.diag.join('\n'); };
    /* A LIVE PICTURE, not a log. The diagnostics were a history of things that had happened,
     * which is the wrong shape for the question actually being asked in a pairing that will not
     * finish: what state is it stuck IN. This is every connection's current standing, cheap
     * enough to repaint every second and short enough to photograph. */
    link.state = function () {
      const line = (pc, dc, tag) => {
        if (!pc) return tag + ': none';
        const c = pc._cand || {};
        const cands = summarise(c) || 'NONE';
        return tag + ': sig=' + pc.signalingState + ' gather=' + pc.iceGatheringState +
               ' ice=' + pc.iceConnectionState + ' conn=' + pc.connectionState +
               ' dc=' + (dc ? dc.readyState : 'none') + '\n      cand ' + cands;
      };
      const rows = ['role=' + (link.isHost ? 'HOST' : (link.pc ? 'GUEST' : '-')) +
                    ' seat=' + link.localIdx + ' pairing=' + (link._pairing ? 'yes' : 'no') +
                    ' active=' + (link.active ? 'yes' : 'no') + ' peers=' + link.peers.length];
      if (link.isHost) { for (const p of link.peers) rows.push(line(p.pc, p.dc, 'peer' + p.idx)); }
      else rows.push(line(link.pc, link.dc, 'link'));
      return rows.join('\n');
    };

    /* the table's own words on the codec: the same functions, with the diag told which
     * format went out and, when P2 could not, why */
    link.compress = (str, o) => compress(str, Object.assign({ say: diag }, o || {}));
    link.decompress = decompress;
    /* Keep the screen awake while pairing: a sleeping host never answers the offer (ported). */
    let wakeLock = null;
    async function acquireWake() {
      try {
        if (typeof navigator !== 'undefined' && navigator.wakeLock && !wakeLock) {
          wakeLock = await navigator.wakeLock.request('screen');
          wakeLock.addEventListener('release', () => { wakeLock = null; });
        }
      } catch (e) { /* best effort */ }
    }
    function releaseWake() { try { if (wakeLock) wakeLock.release(); } catch (e) {} wakeLock = null; }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && link._pairing) acquireWake();
      });
    }

    /* ---------------- connection (ported) ---------------- */
    /* STUN — WHICH IS NOT A SERVER OF OURS, AND IS NOT OPTIONAL. This gathered host candidates
     * only: 'LAN-only, smaller SDP, smaller QR'. That is a rule about the NETWORK dressed up as
     * a rule about the game, and it fails on networks people actually have. Reported from play
     * twice, with the diagnostics on screen both times: offer sent, answer read, sig=stable,
     * `cand host:4` — and then ice=checking, ice=disconnected, conn=failed. The second run had
     * both phones on the same Wi-Fi, so 'same network' was never the whole story: a host
     * candidate still needs the access point to route between its own clients, and plenty do
     * not. Worse, Chrome hides host candidates behind .local mDNS names until the page has
     * media permission, and the HOST creates its offer before it has ever opened the camera —
     * so the very candidates it publishes are the ones least likely to resolve.
     * A public STUN server runs nothing of ours and signals nothing: the QR is still the only
     * channel by which these two devices ever learn about each other, so the pairing is still
     * serverless in the sense that matters. It buys a reflexive candidate, which is a route that
     * does not depend on the access point's goodwill. If STUN cannot be reached — a LAN with no
     * internet — gathering falls back to exactly what it did before. */
    const ICE = opts.ice || [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
    /* '...typ host 192.168.1.23 54321 ...' → '192.168.1.23' */
    function addrOf(line) {
      const m = /candidate:\S+ \d+ \S+ \d+ (\S+) /.exec(line || '');
      return m ? m[1] : null;
    }
    function summarise(cand) {
      return Object.keys(cand).map((k) => {
        const uniq = [...new Set(cand[k])];
        return k + ' ' + uniq.slice(0, 3).join(',') + (uniq.length > 3 ? '…' : '');
      }).join('  ');
    }
    /* WHAT THE OTHER PHONE OFFERED. Its candidates ride in the SDP we were just handed, so one
     * screen can show both sides — and comparing the two sets of addresses is the whole
     * diagnosis: same subnet and no link means the access point is isolating its clients;
     * different subnets means they were never on the same network at all. */
    /* IS THIS PHONE ON A LAN AT ALL, AND IS IT THE SAME ONE?
     * Two sources, because neither is enough alone. navigator.connection.type says 'wifi' or
     * 'cellular' outright, and is the friendlier answer — but it is Chrome-on-Android only, so
     * on an iPhone it says nothing. The candidates say it everywhere: a phone on Wi-Fi gathers a
     * host candidate in a private range, and a phone on mobile data gathers a carrier one in
     * 100.64/10 (CGNAT) or none at all. The second source is also the only one that can answer
     * the question that actually matters, which is not "am I on Wi-Fi" but "are we on the SAME
     * Wi-Fi" — and that is a comparison of the two phones' addresses. */
    const isPrivate4 = (a) => /^10\./.test(a) || /^192\.168\./.test(a) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(a);
    const isCgnat4 = (a) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a);
    const net24 = (a) => (isPrivate4(a) ? a.split('.').slice(0, 3).join('.') : null);
    const addrsOf = (cand) => [].concat(cand.host || [], cand.mdns || []);
    link.netKind = function (cand) {
      const nav = typeof navigator !== 'undefined' ? navigator : null;
      const c = nav && (nav.connection || nav.mozConnection || nav.webkitConnection);
      const told = c && c.type ? c.type : null;         // 'wifi' | 'cellular' | … | undefined
      const addrs = addrsOf(cand || {});
      const lan = addrs.some(isPrivate4);
      const cell = !lan && addrs.some(isCgnat4);
      return { told, lan, cell };
    };
    /* the verdict, once both sides' candidates are known */
    link.sameNet = function (mine, theirs) {
      const a = new Set(addrsOf(mine).map(net24).filter(Boolean));
      const b = addrsOf(theirs).map(net24).filter(Boolean);
      if (!a.size || !b.length) return null;            // one side published nothing to compare
      return b.some((n) => a.has(n));
    };
    /* WHICH OF THE FOUR THINGS IS WRONG. Named rather than described, so the wording lives with
     * the screen that shows it and the reasoning lives here with the evidence. */
    link.advice = function () {
      const pc = link.isHost ? (link._pending && link._pending.pc) : link.pc;
      const mine = (pc && pc._cand) || {};
      const k = link.netKind(mine);
      if (k.told === 'cellular' || k.cell) return 'cell';       // this phone is on mobile data
      if (pc && !k.lan && Object.keys(mine).length) return 'nolan';   // gathered, and no LAN address
      const theirs = pc && pc._theirs;
      if (theirs) {
        const same = link.sameNet(mine, theirs);
        if (same === false) return 'diff';                      // two different networks
        if (same === true) return 'same';                       // one network that will not pass them
      }
      return 'unknown';
    };
    function sdpCands(sdp) {
      const cand = {};
      for (const line of (sdp || '').split(/\r?\n/)) {
        const m = /^a=candidate:(.*)$/.exec(line.trim());
        if (!m) continue;
        const ty = (/ typ (\w+)/.exec(m[1]) || [])[1] || '?';
        const a = addrOf('candidate:' + m[1]) || '?';
        const key = ty === 'host' && /\.local/.test(m[1]) ? 'mdns' : ty;
        (cand[key] = cand[key] || []).push(a);
      }
      return cand;
    }
    function reportRemote(pc, sdp) {
      const theirs = sdpCands(sdp);
      if (pc) pc._theirs = theirs;
      diag('THEIR candidates → ' + (summarise(theirs) || '(NONE in what they sent!)'));
      const same = link.sameNet(pc && pc._cand || {}, theirs);
      if (same === true) diag('SAME network — so the Wi-Fi itself is refusing to pass them');
      else if (same === false) diag('DIFFERENT networks — these two phones are not on one Wi-Fi');
    }
    function makePC() {
      const pc = new RTCPeerConnection({ iceServers: ICE });
      const cand = {};
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          const ty = e.candidate.type || (/ typ (\w+)/.exec(e.candidate.candidate) || [])[1] || '?';
          /* an mDNS candidate is a host candidate the browser has hidden behind a .local name;
           * it only resolves for someone on the same LAN, so it is worth counting apart */
          const key = ty === 'host' && /\.local/.test(e.candidate.candidate || '') ? 'mdns' : ty;
          /* THE ADDRESS, not just the tally. host:4 on both phones and no link is one of two
           * completely different problems — two DIFFERENT networks, or one network whose access
           * point refuses to pass traffic between its own clients — and the only thing that
           * tells them apart is the numbers. Kept per type, deduplicated, so the panel can be
           * read against the other phone's. */
          (cand[key] = cand[key] || []).push(addrOf(e.candidate.candidate) || '?');
        } else {
          const got = summarise(cand);
          diag('ICE candidates gathered → ' + (got || '(none!)'));
          /* the verdict, in the one place anybody will read it. It is not an error — it is what
           * this pairing IS — but it is the answer to "why did a stable handshake never link". */
          if (cand.srflx || cand.relay) diag('a public route was found — this should link');
          else if (got) diag('LOCAL ONLY — no public route. Same Wi-Fi, and an access point that '
                             + 'lets its clients talk to each other');
          else diag('no candidates at all — the browser gathered no route');
        }
      };
      pc._cand = cand;   // kept on the connection so link.state() can report it live
      pc.onicecandidateerror = (e) => diag('ICE candidate error ' + (e.errorCode || ''));
      pc.oniceconnectionstatechange = () => diag('ICE state: ' + pc.iceConnectionState);
      pc.onconnectionstatechange = () => {
        diag('peer connection: ' + pc.connectionState);
        /* a FAILED connection is the one moment advice is worth giving, and the only moment it
         * will be read — see link.onFail */
        if (pc.connectionState === 'failed' && link.onFail) link.onFail(pc);
      };
      return pc;
    }
    /* THE CODE ON SCREEN IS ALL THERE WILL EVER BE. A QR is a one-shot channel: whatever
     * candidates are in the SDP at the moment it is drawn are the only ones the other phone will
     * ever hear about, because there is no way to trickle a late one across. So giving up on
     * gathering after a few seconds does not mean "start without the stragglers" the way it does
     * with a signalling server — it means publishing a link with holes in it, permanently.
     * Caught from play: a guest whose ICE gathering did not complete until 45s had already drawn
     * its reply at 31s, and its reflexive and IPv6 candidates never left the phone. Wait for
     * `complete`, and treat the ceiling as the disaster case it is rather than the normal path. */
    function gathered(pc) {
      return new Promise((res) => {
        if (pc.iceGatheringState === 'complete') return res();
        let done = false;
        const finish = (why) => { if (done) return; done = true; if (why) diag(why); res(); };
        /* ENOUGH IS ENOUGH. Waiting for `complete` is correct and it is also the slowest thing
         * in the pairing — one phone took forty-five seconds, held up by a STUN probe that was
         * never going to answer (candidate error 701), long after it had everything it needed.
         * What the other phone needs is a way IN and a way ROUND: one local address and one
         * reflexive one. Once both are in hand the rest of gathering is a long tail of relay
         * probes and address families nobody is going to use, and the code can be drawn. The
         * ceiling stays as the disaster case and still says so. */
        const enough = () => {
          const c = pc._cand || {};
          const local = (c.host || c.mdns || []).length;
          return local > 0 && (c.srflx || []).length > 0;
        };
        const tick = () => {
          if (pc.iceGatheringState === 'complete') finish(null);
          else if (enough()) finish('a way in and a way round — drawing the code now');
        };
        pc.addEventListener('icegatheringstatechange', tick);
        pc.addEventListener('icecandidate', tick);
        /* AND A LAN WITH NO INTERNET NEVER GETS A REFLEXIVE ONE. Waiting for `enough` on a
         * network with no route out would hold the code for the full ceiling — the exact case
         * that used to be instant, and the one this pairing was built for. A local address on
         * its own is a complete answer there, so after a short grace we publish what we have. */
        setTimeout(() => {
          const c = pc._cand || {};
          if ((c.host || c.mdns || []).length) finish('no reflexive route — drawing the local code');
        }, 3000);
        setTimeout(() => finish('gathering did not finish in 15s — the code may be incomplete'), 15000);
      });
    }
    /* what is ACTUALLY in the code we are about to show: the ground truth of what the other
     * phone will receive, as against what this one has found since */
    function reportLocal(pc, tag) {
      diag((tag || 'MY') + ' published candidates → ' + (summarise(sdpCands(pc.localDescription &&
        pc.localDescription.sdp)) || '(NONE — this link cannot work)'));
    }
    /* ---------------- the star ----------------
     * A guest has exactly one link, to the host. The HOST may hold up to three, one per guest,
     * and every one is paired the same way the single link always was: an offer by QR, an
     * answer scanned back. Peer k is player k+1 — seats are handed out in the order people
     * join, and the host tells each guest which one it got. */
    link.peers = [];          // host only: [{ pc, dc, idx, open }]
    const openPeers = () => link.peers.filter((p) => p.dc && p.dc.readyState === 'open');
    link.seated = () => 1 + openPeers().length;          // how many are actually in the match

    function wireChannel(dc, peer) {
      if (peer) peer.dc = dc; else link.dc = dc;
      dc.onopen = () => {
        diag('datachannel OPEN — linked ✔' + (peer ? ' (seat ' + peer.idx + ')' : ''));
        link.active = true; link.peerGone = false; link._pairing = false;
        releaseWake();
        if (link.onOpen) link.onOpen(peer ? peer.idx : link.localIdx);
      };
      dc.onclose = () => {
        diag('datachannel closed' + (peer ? ' (seat ' + peer.idx + ')' : ''));
        /* a host with other guests still standing is not "gone" — only the one who left is */
        if (!peer || !openPeers().length) link.peerGone = true;
        if (link.onClose) link.onClose(peer ? peer.idx : link.localIdx);
      };
      dc.onerror = () => { diag('datachannel error'); if (!peer || !openPeers().length) link.peerGone = true; };
      dc.onmessage = (e) => { if (link.onMessage) link.onMessage(JSON.parse(e.data), peer ? peer.idx : 0); };
    }

    /* call once per guest you want to add; each returns that guest's offer */
    link.host = async function () {
      link.isHost = true; link.localIdx = 0;
      link._pairing = true; acquireWake();
      /* ONE OFFER IN FLIGHT AT A TIME. Tapping HOST twice made a SECOND half-open connection and
       * pointed `_pending` at it — while the QR on screen was still the first one's. The guest
       * scans that stale offer, sends back an answer for it, and the host hands the answer to
       * the wrong connection: no error anywhere, no link ever, and a guest flashing its reply at
       * a host that is listening on a different socket. Whatever was half-open is dropped first,
       * so the code on screen and the connection waiting for its answer are always the same one. */
      if (link._pending && !(link._pending.dc && link._pending.dc.readyState === 'open')) {
        diag('dropping the previous unanswered offer');
        try { link._pending.pc.close(); } catch (e) { /* already gone */ }
        const i = link.peers.indexOf(link._pending);
        if (i >= 0) link.peers.splice(i, 1);
        link._pending = null;
      }
      const pc = makePC();
      const peer = { pc, dc: null, idx: link.peers.length + 1 };
      link.peers.push(peer);
      link._pending = peer;
      wireChannel(pc.createDataChannel('amber', { ordered: true }), peer);
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      reportLocal(pc, 'MY OFFER');
      return link.compress(JSON.stringify(pc.localDescription));
    };
    link.canAdd = () => link.peers.length < link.maxPeers;
    link.join = async function (offerCode) {
      link.isHost = false;
      link.localIdx = 1;              // provisional: the host names the real seat at start
      link._pairing = true; acquireWake();
      const pc = link.pc = makePC();
      pc.ondatachannel = (e) => wireChannel(e.channel, null);
      await pc.setRemoteDescription(JSON.parse(await decompress(offerCode)));
      reportRemote(pc, pc.remoteDescription && pc.remoteDescription.sdp);
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered(pc);
      reportLocal(pc, 'MY REPLY');
      return link.compress(JSON.stringify(pc.localDescription));
    };
    link.acceptAnswer = async function (answerCode) {
      const pc = link.isHost ? (link._pending && link._pending.pc) : link.pc;
      /* SILENCE WAS THE WORST ANSWER. Returning here meant the host had scanned a reply, done
       * nothing with it, and said nothing about it — while the guest went on flashing its QR at
       * a link that was never going to open. If there is no half-open connection to give this
       * answer to, that is a thing the player needs told. */
      if (!pc) { diag('no offer is waiting for an answer'); throw new Error('no offer is waiting — tap HOST THE TABLE first'); }
      await pc.setRemoteDescription(JSON.parse(await decompress(answerCode)));
      reportRemote(pc, pc.remoteDescription && pc.remoteDescription.sdp);
      diag('answer accepted — waiting for the link to open');
    };

    /* ---------------- backpressure: a snapshot may be DROPPED, an order may not ----------------
     * Reported from play: "strong lags when fighting with big armies over LAN", and getting
     * WORSE the bigger the fight — the signature of a queue that never drains. `dc.send` does
     * not block: if a message cannot go out now it sits in `bufferedAmount`, so once a snapshot
     * takes longer to push than the 100ms budget the next one queues behind it and the guest
     * falls further behind on every tick, for the rest of the match.
     * THE ASYMMETRY IS THE WHOLE FIX. A snapshot is ABSOLUTE STATE — the next one supersedes it
     * entirely, so a dropped snapshot costs one frame of staleness and nothing else. A command
     * is a DELTA and may never be dropped. So the guard belongs on snapshots alone, and it turns
     * unbounded, permanent latency into an occasional skipped frame.
     * The cap is a few snapshots' worth: measured ~10 KB at 91 visible units and rising roughly
     * linearly, so 64 KB is about two of a big fight's and one of a very big one's. Past that
     * the channel is already behind and the freshest thing we can do for the guest is stop
     * adding to the pile. */
    link.SNAP_CAP = 64 * 1024;
    link.snapDrops = 0;   // observable: a rig can prove the guard actually fired
    link.sendSnap = function (o, to) {
      if (!link.isHost) return false;
      for (const p of link.peers) {
        if (p.idx !== to || !p.dc || p.dc.readyState !== 'open') continue;
        if (p.dc.bufferedAmount > link.SNAP_CAP) { link.snapDrops++; return false; }
        p.dc.send(JSON.stringify(o));
        return true;
      }
      return false;
    };

    /* `to` names a seat; without it this goes to everyone the sender is linked to */
    link.send = function (o, to) {
      const txt = JSON.stringify(o);
      if (link.isHost) {
        for (const p of link.peers)
          if (p.dc && p.dc.readyState === 'open' && (to == null || p.idx === to)) p.dc.send(txt);
      } else if (link.dc && link.dc.readyState === 'open') link.dc.send(txt);
    };
    /* THE WORD BEFORE THE DOOR. Sent to everyone still linked, then the link goes down — so a
     * guest learns from a sentence rather than from a silence. Each send is guarded on its own:
     * one dead channel throwing here would take the rest of the goodbyes down with it and leave
     * the other seats to time out for no reason. */
    link.bye = function () {
      if (!link.active) return;
      const txt = JSON.stringify({ t: 'bye' });
      const chans = link.isHost ? link.peers.map((p) => p.dc) : [link.dc];
      for (const dc of chans) {
        try { if (dc && dc.readyState === 'open') dc.send(txt); } catch (e) { /* it is already gone */ }
      }
    };
    link.close = function () {
      try {
        if (link.dc) link.dc.close();
        if (link.pc) link.pc.close();
        for (const p of link.peers) { if (p.dc) p.dc.close(); if (p.pc) p.pc.close(); }
      } catch (e) {}
      link.active = false; link.dc = null; link.pc = null; link.peers = []; link._pending = null;
      link._pairing = false; releaseWake();
    };

    /* `from` is the seat the message came from — the host must know WHOSE command it is */
    return link;
  };

  global.LanLink = LanLink;
  if (typeof module !== 'undefined' && module.exports) module.exports = LanLink;
})(typeof window !== 'undefined' ? window : globalThis);

/* net.js — LAN duel: WebRTC DataChannel, serverless QR pairing (ported from Perils),
 * HOST-AUTHORITATIVE state sync (NOT Perils' lockstep — competitive play needs fog of war
 * and must not trust cross-browser determinism).
 *
 * Pairing: the two browsers exchange compressed "link codes" (SDP offer/answer) as QR
 * codes, then talk directly over the LAN. No backend — deployable on GitHub Pages.
 *
 * In play: the guest sends commands; the host simulates everything and streams each side a
 * fog-filtered snapshot ~10 Hz (Net.snapFor). Host = player 0 (Corwin), guest = 1 (Eric). */
(function (global) {
  'use strict';

  const Net = {
    active: false,
    isHost: false,
    localIdx: 0,
    peerGone: false,
    pc: null, dc: null,
    onOpen: null, onStart: null, onClose: null,
    onCmd: null,    // host: guest command arrived
    onSnap: null,   // guest: snapshot arrived
    diag: [], onDiag: null, _pairing: false
  };

  /* ---------------- handshake diagnostics (ported) ---------------- */
  function diag(msg) {
    const t = (typeof performance !== 'undefined' ? performance.now() / 1000 : 0).toFixed(1);
    Net.diag.push(t + 's  ' + msg);
    if (Net.diag.length > 50) Net.diag.shift();
    if (Net.onDiag) Net.onDiag(Net.diag);
  }
  Net.diagReset = function () {
    Net.diag = [];
    diag('secureContext=' + (typeof isSecureContext !== 'undefined' ? isSecureContext : '?') +
         '  RTC=' + (typeof RTCPeerConnection !== 'undefined') +
         '  compress=' + (typeof CompressionStream !== 'undefined'));
  };
  Net.diagText = function () { return Net.diag.join('\n'); };

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
  async function compress(str) {
    const data = new TextEncoder().encode(str);
    if (typeof CompressionStream === 'undefined') return 'P0' + b64encode(data);
    const cs = new CompressionStream('deflate-raw');
    const buf = await new Response(new Blob([data]).stream().pipeThrough(cs)).arrayBuffer();
    return 'P1' + b64encode(new Uint8Array(buf));
  }
  async function decompress(code) {
    code = code.trim();
    const tag = code.slice(0, 2), body = b64decode(code.slice(2));
    if (tag === 'P0') return new TextDecoder().decode(body);
    const ds = new DecompressionStream('deflate-raw');
    const buf = await new Response(new Blob([body]).stream().pipeThrough(ds)).arrayBuffer();
    return new TextDecoder().decode(buf);
  }

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
      if (document.visibilityState === 'visible' && Net._pairing) acquireWake();
    });
  }

  /* ---------------- connection (ported) ---------------- */
  function makePC() {
    /* LAN-only: skip STUN so only host/mDNS candidates gather — smaller SDP, smaller QR */
    const pc = new RTCPeerConnection({});
    const cand = {};
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        const ty = e.candidate.type || (/ typ (\w+)/.exec(e.candidate.candidate) || [])[1] || '?';
        cand[ty] = (cand[ty] || 0) + 1;
      } else diag('ICE candidates gathered → ' + (Object.keys(cand).map((k) => k + ':' + cand[k]).join(' ') || '(none!)'));
    };
    pc.onicecandidateerror = (e) => diag('ICE candidate error ' + (e.errorCode || ''));
    pc.oniceconnectionstatechange = () => diag('ICE state: ' + pc.iceConnectionState);
    pc.onconnectionstatechange = () => diag('peer connection: ' + pc.connectionState);
    return pc;
  }
  function gathered(pc) {
    return new Promise((res) => {
      if (pc.iceGatheringState === 'complete') return res();
      const done = () => { if (pc.iceGatheringState === 'complete') res(); };
      pc.addEventListener('icegatheringstatechange', done);
      setTimeout(res, 2500);
    });
  }
  function wireChannel(dc) {
    Net.dc = dc;
    dc.onopen = () => { diag('datachannel OPEN — linked ✔'); Net.active = true; Net.peerGone = false; Net._pairing = false; releaseWake(); if (Net.onOpen) Net.onOpen(); };
    dc.onclose = () => { diag('datachannel closed'); Net.peerGone = true; if (Net.onClose) Net.onClose(); };
    dc.onerror = () => { diag('datachannel error'); Net.peerGone = true; };
    dc.onmessage = (e) => handle(JSON.parse(e.data));
  }

  Net.host = async function () {
    Net.isHost = true; Net.localIdx = 0;
    Net._pairing = true; acquireWake();
    const pc = Net.pc = makePC();
    wireChannel(pc.createDataChannel('amber', { ordered: true }));
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    return compress(JSON.stringify(pc.localDescription));
  };
  Net.join = async function (offerCode) {
    Net.isHost = false; Net.localIdx = 1;
    Net._pairing = true; acquireWake();
    const pc = Net.pc = makePC();
    pc.ondatachannel = (e) => wireChannel(e.channel);
    await pc.setRemoteDescription(JSON.parse(await decompress(offerCode)));
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    return compress(JSON.stringify(pc.localDescription));
  };
  Net.acceptAnswer = async function (answerCode) {
    await Net.pc.setRemoteDescription(JSON.parse(await decompress(answerCode)));
  };

  Net.send = function (o) {
    if (Net.dc && Net.dc.readyState === 'open') Net.dc.send(JSON.stringify(o));
  };
  Net.close = function () {
    try { if (Net.dc) Net.dc.close(); if (Net.pc) Net.pc.close(); } catch (e) {}
    Net.active = false; Net.dc = null; Net.pc = null;
    Net._pairing = false; releaseWake();
  };

  function handle(m) {
    if (m.t === 'cmd') { if (Net.onCmd) Net.onCmd(m.c); }
    else if (m.t === 'snap') { if (Net.onSnap) Net.onSnap(m.s); }
    else if (m.t === 'start') { if (Net.onStart) Net.onStart(m); }
  }

  /* ---------------- fog-filtered snapshots (host → each viewer) ----------------
   * Public: road units, storms, castle HP, slot OCCUPANCY. Private: enemy essence,
   * powers, building types/levels. A started Pattern walk reveals that shrine + progress. */
  Net.snapFor = function (world, viewer, events) {
    const players = world.players.map((pl, pi) => {
      const mine = pi === viewer;
      return {
        castleHp: Math.round(pl.castleHp),
        essence: mine ? pl.essence : null,
        pattern: mine || pl.revealed ? pl.pattern : 0,
        walking: mine || pl.revealed ? pl.walking : false,
        revealed: pl.revealed,
        powers: mine ? { storm: pl.powers.storm, trump: pl.powers.trump } : null,
        slots: pl.slots.map((s) => {
          if (!s) return null;
          if (mine) return { bt: s.bt, level: s.level };
          if (s.bt === 'shrine' && pl.revealed) return { bt: 'shrine', level: s.level };
          return { bt: 'veiled', level: 0 };
        })
      };
    });
    return {
      t: world.t, winner: world.winner, winReason: world.winReason,
      players,
      units: world.units.map((u) => ({ id: u.id, owner: u.owner, kind: u.kind, p: Math.round(u.p), x: Math.round(u.x), hp: Math.round(u.hp), maxHp: Math.round(u.maxHp) })),
      storms: world.storms.map((s) => ({ owner: s.owner, p: s.p, delay: s.delay, tLeft: s.tLeft })),
      /* events: drop the rival's private build/upgrade news; the road is public */
      events: (events || []).filter((ev) => !((ev.e === 'build' || ev.e === 'up') && ev.pi !== viewer))
    };
  };

  global.Net = Net;
  if (typeof module !== 'undefined' && module.exports) module.exports = Net;
})(typeof window !== 'undefined' ? window : globalThis);

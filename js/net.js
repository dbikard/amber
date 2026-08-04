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
  /* ---------------- the star ----------------
   * A guest has exactly one link, to the host. The HOST may hold up to three, one per guest,
   * and every one is paired the same way the single link always was: an offer by QR, an
   * answer scanned back. Peer k is player k+1 — seats are handed out in the order people
   * join, and the host tells each guest which one it got. */
  Net.peers = [];          // host only: [{ pc, dc, idx, open }]
  const openPeers = () => Net.peers.filter((p) => p.dc && p.dc.readyState === 'open');
  Net.seated = () => 1 + openPeers().length;          // how many are actually in the match

  function wireChannel(dc, peer) {
    if (peer) peer.dc = dc; else Net.dc = dc;
    dc.onopen = () => {
      diag('datachannel OPEN — linked ✔' + (peer ? ' (seat ' + peer.idx + ')' : ''));
      Net.active = true; Net.peerGone = false; Net._pairing = false;
      releaseWake();
      if (Net.onOpen) Net.onOpen(peer ? peer.idx : Net.localIdx);
    };
    dc.onclose = () => {
      diag('datachannel closed' + (peer ? ' (seat ' + peer.idx + ')' : ''));
      /* a host with other guests still standing is not "gone" — only the one who left is */
      if (!peer || !openPeers().length) Net.peerGone = true;
      if (Net.onClose) Net.onClose(peer ? peer.idx : Net.localIdx);
    };
    dc.onerror = () => { diag('datachannel error'); if (!peer || !openPeers().length) Net.peerGone = true; };
    dc.onmessage = (e) => handle(JSON.parse(e.data), peer ? peer.idx : 0);
  }

  /* call once per guest you want to add; each returns that guest's offer */
  Net.host = async function () {
    Net.isHost = true; Net.localIdx = 0;
    Net._pairing = true; acquireWake();
    const pc = makePC();
    const peer = { pc, dc: null, idx: Net.peers.length + 1 };
    Net.peers.push(peer);
    Net._pending = peer;
    wireChannel(pc.createDataChannel('amber', { ordered: true }), peer);
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    return compress(JSON.stringify(pc.localDescription));
  };
  Net.canAdd = () => Net.peers.length < (global.CONST.MAX_PLAYERS - 1);
  Net.join = async function (offerCode) {
    Net.isHost = false;
    Net.localIdx = 1;              // provisional: the host names the real seat at start
    Net._pairing = true; acquireWake();
    const pc = Net.pc = makePC();
    pc.ondatachannel = (e) => wireChannel(e.channel, null);
    await pc.setRemoteDescription(JSON.parse(await decompress(offerCode)));
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    return compress(JSON.stringify(pc.localDescription));
  };
  Net.acceptAnswer = async function (answerCode) {
    const pc = Net.isHost ? (Net._pending && Net._pending.pc) : Net.pc;
    if (!pc) return;
    await pc.setRemoteDescription(JSON.parse(await decompress(answerCode)));
  };

  /* `to` names a seat; without it this goes to everyone the sender is linked to */
  Net.send = function (o, to) {
    const txt = JSON.stringify(o);
    if (Net.isHost) {
      for (const p of Net.peers)
        if (p.dc && p.dc.readyState === 'open' && (to == null || p.idx === to)) p.dc.send(txt);
    } else if (Net.dc && Net.dc.readyState === 'open') Net.dc.send(txt);
  };
  Net.close = function () {
    try {
      if (Net.dc) Net.dc.close();
      if (Net.pc) Net.pc.close();
      for (const p of Net.peers) { if (p.dc) p.dc.close(); if (p.pc) p.pc.close(); }
    } catch (e) {}
    Net.active = false; Net.dc = null; Net.pc = null; Net.peers = []; Net._pending = null;
    Net._pairing = false; releaseWake();
  };

  /* `from` is the seat the message came from — the host must know WHOSE command it is */
  function handle(m, from) {
    if (m.t === 'cmd') { if (Net.onCmd) Net.onCmd(m.c, from); }
    else if (m.t === 'snap') { if (Net.onSnap) Net.onSnap(m.s); }
    else if (m.t === 'start') { if (Net.onStart) Net.onStart(m); }
  }

  /* ---------------- fog-filtered snapshots (host → each viewer) ----------------
   * TRUE fog of war. Units/storms only where the viewer has vision; enemy essence, powers
   * and banner never sent. Works follow the open-world rule: your own always, a rival's
   * only while you can SEE it — otherwise the ghost you last saw, at the place it stood.
   * A started Pattern walk reveals that shrine + progress. */
  Net.snapFor = function (world, viewer, events) {
    const World = global.World, C = global.CONST;
    const see = (x, y) => World.canSee(world, viewer, x, y);
    const players = world.players.map((pl, pi) => {
      const mine = pi === viewer;
      return {
        castleHp: Math.round(pl.castleHp),
        essence: mine ? pl.essence : null,
        incomeRate: mine ? pl.incomeRate : null,
        drainRate: mine ? pl.drainRate : null,
        pattern: mine || pl.revealed ? pl.pattern : 0,
        walking: mine || pl.revealed ? pl.walking : false,
        revealed: pl.revealed,
        powers: mine ? { storm: pl.powers.storm, trump: pl.powers.trump } : null,
        banner: mine ? pl.banner : null,   // the banner is a strategic secret
        musterPaused: mine ? pl.musterPaused : false,
        /* your own companies and where their standards stand; a rival's are a secret */
        companies: mine ? pl.companies.map((co) => ({ id: co.id, rally: co.rally })) : [],
        /* A CURTAIN IS LONGER THAN ITS MIDDLE. Judging a wall by its centre hid a run whose
         * near end stood in plain sight, so a wall shows the moment any part of it is seen —
         * and carries its far end, since a line drawn to one point is not a line. */
        buildings: pl.buildings.filter((b) => mine || see(b.x, b.y)
          || (b.x2 != null && (see(b.x2, b.y2) || see(b.x * 2 - b.x2, b.y * 2 - b.y2)))).map((b) => ({
          id: b.id, bt: b.bt, level: b.level, x: Math.round(b.x), y: Math.round(b.y),
          x2: b.x2 == null ? undefined : Math.round(b.x2),
          y2: b.y2 == null ? undefined : Math.round(b.y2),
          hp: Math.round(b.hp), maxHp: b.maxHp, node: b.node,
          /* an unfinished work reads as a shell to BOTH sides — it is plainly scaffolding */
          raise: b.raise > 0 ? Math.round(b.raise * 10) / 10 : 0, raiseFor: b.raiseFor || 0,
          /* the masons in the yard are as visible as the scaffolding on a new work: a hall
           * that has gone quiet must LOOK like one to a guest too */
          work: b.work > 0 ? Math.round(b.work * 10) / 10 : 0, workFor: b.workFor || 0,
          /* a breach is public: it is a hole in the world that everyone can walk up to */
          ...(b.breach ? { breach: 1 } : {}), ...(b.crews > 1 ? { crews: b.crews } : {}),
          /* a tower in the wall stands ON the wall — a guest must draw it up there too */
          ...(b.onWall ? { onWall: b.onWall } : {}),
          /* a long curtain occupies several crews — the yard readout has to know */
          ...(b.crews > 1 ? { crews: b.crews } : {}),
          /* the tower branch is yours to know and the rival's to guess */
          br: mine ? (b.br || null) : null,
          co: mine ? b.co : 0            // which company a hall musters into is yours to know
        })),
        /* what the viewer remembers of works they can no longer see */
        ghosts: mine ? [] : Object.entries(world.players[viewer].ghosts)
          .filter(([, g]) => g.owner === pi && !see(g.x, g.y))
          .map(([id, g]) => ({ id: +id, bt: g.bt, level: g.level, x: Math.round(g.x), y: Math.round(g.y),
                               x2: g.x2 == null ? undefined : Math.round(g.x2),
                               y2: g.y2 == null ? undefined : Math.round(g.y2) }))
      };
    });
    /* sites through the viewer's fog: live truth if visible, memory if explored, else absent */
    const mem = world.players[viewer].explored;
    const sites = world.map.sites.map((s) => {
      if (see(s.x, s.y)) return { id: s.id, live: true, holder: World.nodeHolder(world, s) };
      return mem[s.id] ? { id: s.id, live: false, holder: -1 } : null;
    });
    return {
      t: world.t, winner: world.winner, winReason: world.winReason,
      players, sites,
      units: world.units.filter((u) => u.owner === viewer || see(u.x, u.y))
        .map((u) => ({ id: u.id, owner: u.owner, kind: u.kind, x: Math.round(u.x), y: Math.round(u.y), hp: Math.round(u.hp), maxHp: Math.round(u.maxHp),
                       /* which wall he is standing on, so a guest draws him on the stone too */
                       ...(u.man ? { man: u.man } : {}),
                       /* rank changes what he LOOKS like, so it is not a secret worth keeping */
                       ...(u.tier > 1 ? { tier: u.tier } : {}),
                       ...(u.owner === viewer ? { co: u.co } : {}) })),
      /* the halt is the table's, not a seat's — every guest must see it and who called it */
      paused: world.paused ? { by: world.paused.by } : null,
      storms: world.storms.filter((s) => see(s.x, s.y))
        .map((s) => ({ owner: s.owner, x: s.x, y: s.y, delay: s.delay, tLeft: s.tLeft })),
      /* events: own always; global always; positional only where seen; rival city news never */
      events: (events || []).filter((ev) => {
        if (ev.pi === viewer) return true;
        if (ev.e === 'build' || ev.e === 'up' || ev.e === 'shot' || ev.e === 'banner' || ev.e === 'rally' || ev.e === 'muster') return false;
        if (ev.x != null) return see(ev.x, ev.y);
        return true;   // walk/pattern/surge/win/trump — power echoes through Shadow
      })
    };
  };

  global.Net = Net;
  if (typeof module !== 'undefined' && module.exports) module.exports = Net;
})(typeof window !== 'undefined' ? window : globalThis);

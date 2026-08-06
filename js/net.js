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
    /* THE REMATCH IS A LOBBY AFFAIR, and the lobby is still host-authoritative. A guest calls
     * for another ({t:'again'}, which carries nothing — the seat it arrived on is the whole
     * message) and the host answers with the ordinary start message, the same one the lobby
     * sends. It cannot answer with a world, because only the host holds one. {t:'nomore'} is
     * the refusal: the table cannot be dealt again, which only the host can know. */
    onAgain: null,  // host: a guest has called for another match
    onNoMore: null, // guest: the host cannot deal one
    /* THE RECORD IS THE HOST'S, BECAUSE ONLY THE HOST HAS ONE. A guest samples its own
     * fog-filtered snapshots, where a rival's essence never crosses the wire and a rival's
     * works and men are only the ones it can see — so its end screen drew a different match
     * from the host's, which is what "the stats are completely different" means. The match is
     * OVER by then and there is nothing left to hide, so the host sends the true table and
     * every seat reads the same match. {t:'chron'} carries it. */
    onChron: null,  // guest: the host's true record of the match just played
    onFail: null,   // a peer connection gave up: the network will not carry this link
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
  /* A LIVE PICTURE, not a log. The diagnostics were a history of things that had happened,
   * which is the wrong shape for the question actually being asked in a pairing that will not
   * finish: what state is it stuck IN. This is every connection's current standing, cheap
   * enough to repaint every second and short enough to photograph. */
  Net.state = function () {
    const line = (pc, dc, tag) => {
      if (!pc) return tag + ': none';
      const c = pc._cand || {};
      const cands = summarise(c) || 'NONE';
      return tag + ': sig=' + pc.signalingState + ' gather=' + pc.iceGatheringState +
             ' ice=' + pc.iceConnectionState + ' conn=' + pc.connectionState +
             ' dc=' + (dc ? dc.readyState : 'none') + '\n      cand ' + cands;
    };
    const rows = ['role=' + (Net.isHost ? 'HOST' : (Net.pc ? 'GUEST' : '-')) +
                  ' seat=' + Net.localIdx + ' pairing=' + (Net._pairing ? 'yes' : 'no') +
                  ' active=' + (Net.active ? 'yes' : 'no') + ' peers=' + Net.peers.length];
    if (Net.isHost) { for (const p of Net.peers) rows.push(line(p.pc, p.dc, 'peer' + p.idx)); }
    else rows.push(line(Net.pc, Net.dc, 'link'));
    return rows.join('\n');
  };

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
  const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
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
  Net.netKind = function (cand) {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    const c = nav && (nav.connection || nav.mozConnection || nav.webkitConnection);
    const told = c && c.type ? c.type : null;         // 'wifi' | 'cellular' | … | undefined
    const addrs = addrsOf(cand || {});
    const lan = addrs.some(isPrivate4);
    const cell = !lan && addrs.some(isCgnat4);
    return { told, lan, cell };
  };
  /* the verdict, once both sides' candidates are known */
  Net.sameNet = function (mine, theirs) {
    const a = new Set(addrsOf(mine).map(net24).filter(Boolean));
    const b = addrsOf(theirs).map(net24).filter(Boolean);
    if (!a.size || !b.length) return null;            // one side published nothing to compare
    return b.some((n) => a.has(n));
  };
  /* WHICH OF THE FOUR THINGS IS WRONG. Named rather than described, so the wording lives with
   * the screen that shows it and the reasoning lives here with the evidence. */
  Net.advice = function () {
    const pc = Net.isHost ? (Net._pending && Net._pending.pc) : Net.pc;
    const mine = (pc && pc._cand) || {};
    const k = Net.netKind(mine);
    if (k.told === 'cellular' || k.cell) return 'cell';       // this phone is on mobile data
    if (pc && !k.lan && Object.keys(mine).length) return 'nolan';   // gathered, and no LAN address
    const theirs = pc && pc._theirs;
    if (theirs) {
      const same = Net.sameNet(mine, theirs);
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
    const same = Net.sameNet(pc && pc._cand || {}, theirs);
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
    pc._cand = cand;   // kept on the connection so Net.state() can report it live
    pc.onicecandidateerror = (e) => diag('ICE candidate error ' + (e.errorCode || ''));
    pc.oniceconnectionstatechange = () => diag('ICE state: ' + pc.iceConnectionState);
    pc.onconnectionstatechange = () => {
      diag('peer connection: ' + pc.connectionState);
      /* a FAILED connection is the one moment advice is worth giving, and the only moment it
       * will be read — see Net.onFail */
      if (pc.connectionState === 'failed' && Net.onFail) Net.onFail(pc);
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
    /* ONE OFFER IN FLIGHT AT A TIME. Tapping HOST twice made a SECOND half-open connection and
     * pointed `_pending` at it — while the QR on screen was still the first one's. The guest
     * scans that stale offer, sends back an answer for it, and the host hands the answer to
     * the wrong connection: no error anywhere, no link ever, and a guest flashing its reply at
     * a host that is listening on a different socket. Whatever was half-open is dropped first,
     * so the code on screen and the connection waiting for its answer are always the same one. */
    if (Net._pending && !(Net._pending.dc && Net._pending.dc.readyState === 'open')) {
      diag('dropping the previous unanswered offer');
      try { Net._pending.pc.close(); } catch (e) { /* already gone */ }
      const i = Net.peers.indexOf(Net._pending);
      if (i >= 0) Net.peers.splice(i, 1);
      Net._pending = null;
    }
    const pc = makePC();
    const peer = { pc, dc: null, idx: Net.peers.length + 1 };
    Net.peers.push(peer);
    Net._pending = peer;
    wireChannel(pc.createDataChannel('amber', { ordered: true }), peer);
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    reportLocal(pc, 'MY OFFER');
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
    reportRemote(pc, pc.remoteDescription && pc.remoteDescription.sdp);
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    reportLocal(pc, 'MY REPLY');
    return compress(JSON.stringify(pc.localDescription));
  };
  Net.acceptAnswer = async function (answerCode) {
    const pc = Net.isHost ? (Net._pending && Net._pending.pc) : Net.pc;
    /* SILENCE WAS THE WORST ANSWER. Returning here meant the host had scanned a reply, done
     * nothing with it, and said nothing about it — while the guest went on flashing its QR at
     * a link that was never going to open. If there is no half-open connection to give this
     * answer to, that is a thing the player needs told. */
    if (!pc) { diag('no offer is waiting for an answer'); throw new Error('no offer is waiting — tap HOST THE TABLE first'); }
    await pc.setRemoteDescription(JSON.parse(await decompress(answerCode)));
    reportRemote(pc, pc.remoteDescription && pc.remoteDescription.sdp);
    diag('answer accepted — waiting for the link to open');
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
    else if (m.t === 'again') { if (Net.onAgain) Net.onAgain(from); }
    else if (m.t === 'nomore') { if (Net.onNoMore) Net.onNoMore(); }
    else if (m.t === 'chron') { if (Net.onChron) Net.onChron(m.rows); }
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
        /* the Trump's own standard is flagged, so a guest's tray can draw it as what it is */
        companies: mine ? pl.companies.map((co) => ({ id: co.id, rally: co.rally,
                                                     ...(co.paused ? { paused: 1 } : {}),
                                                     ...(co.trump ? { trump: 1 } : {}) })) : [],
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
          ...(b.breach ? { breach: 1 } : {}),
          /* a tower in the wall stands ON the wall — a guest must draw it up there too */
          ...(b.onWall ? { onWall: b.onWall } : {}),
          /* a long curtain occupies several crews — the yard readout has to know — and it is
           * `units` of stone, which is what its mend costs. A short run has NO gateway, so the
           * guest must not draw one or walk its columns at one that is not there. */
          ...(b.crews > 1 ? { crews: b.crews } : {}),
          ...(b.units != null ? { units: Math.round(b.units * 1000) / 1000 } : {}),
          ...(b.gated ? { gated: 1 } : {}),
          /* WHICH FACE OF THE RUN SHELTERS. It rides for everyone, not only its owner: the men
           * standing behind a rival's curtain are on the board where they are on the board, and
           * a guest whose renderer turned that line the other way would draw a rival's parapet
           * facing its own reserve. It gives nothing away that watching the men would not. */
          ...(b.flip ? { flip: 1 } : {}),
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
                       /* which wall he is standing on, and which tower he is up in, so a guest
                        * draws him on the stone too — both change where he IS, not only what
                        * he looks like, so neither is a secret worth keeping */
                       ...(u.man ? { man: u.man } : {}),
                       ...(u.tow ? { tow: u.tow, towSlot: u.towSlot || 0 } : {}),
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

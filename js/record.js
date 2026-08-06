/* record.js — the chronicle of a match, for reading afterwards. Headless-safe: no DOM.
 *
 * WHAT THIS IS FOR. Balance arguments are settled by `node sim.js`, which plays bots. A
 * HUMAN's match leaves no trace at all, so "the heir is too strong" or "I can never win by
 * force" has to be re-derived from first principles every time. This writes down what
 * actually happened in a form small enough to paste into a conversation: a header, a table
 * sampled every SAMPLE seconds, the commands you gave, and the moments worth naming.
 *
 * It records the TRUTH, not the fogged view, whenever the truth is at hand (single player and
 * host see the whole world). A guest only has its own snapshots and the header says so —
 * better an honest partial record than a confident wrong one.
 *
 * Nothing here may touch the sim. `fromWorld` reads and copies; it never writes. */
(function (global) {
  'use strict';

  const C = global.CONST || (typeof require !== 'undefined' ? require('./const.js') : null);
  const Rec = { on: false };

  const SAMPLE = 20;          // sim-seconds between rows of the table
  const RIFT_QUIET = 45;      // don't list every rift; one line per this many seconds
  const MAX_CMDS = 600;       // a runaway tapper should not produce a megabyte

  let head = null, rows = [], cmds = [], notes = [], tally = null, nextAt = 0, lastRift = -99;

  const clock = (t) => {
    const s = Math.max(0, Math.round(t));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };

  /* the nearest named place, so a command reads as somewhere rather than as a coordinate */
  function near(world, x, y) {
    if (!world || !world.map || x == null) return '';
    let best = null, bd = 260 * 260;
    for (const s of world.map.sites) {
      const d = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y);
      if (d < bd) { bd = d; best = s; }
    }
    return best ? best.name || best.kind : '';
  }

  /* ---------------- the reading ----------------
   * One row of the table, from whatever the caller actually has. `fromWorld` is the honest
   * one; a guest builds the same shape out of its snapshot and marks the record partial. */
  Rec.fromWorld = function (world) {
    return {
      t: world.t, tick: world.tick,
      chaos: world.units.reduce((n, u) => n + (u.owner === C.CHAOS_ID ? 1 : 0), 0),
      players: world.players.map((pl, pi) => ({
        ess: pl.essence, income: pl.incomeRate || 0, drain: pl.drainRate || 0,
        works: pl.buildings.filter((b) => !b.raise).length,
        rising: pl.buildings.filter((b) => b.raise > 0).length,
        gates: pl.buildings.filter((b) => b.bt === 'gate' && !b.raise).length,
        army: world.units.reduce((n, u) => n + (u.owner === pi ? 1 : 0), 0),
        pattern: pl.pattern, hp: pl.castleHp, walking: !!pl.walking, out: !!pl.out
      }))
    };
  };

  /* a guest has no world, only what the host chose to tell it. Same shape, honest gaps:
   * a rival's essence is never on the wire, so it reads as 0 and the header warns. */
  Rec.fromSnap = function (snap, viewer) {
    return {
      t: snap.t, tick: 0,
      chaos: snap.units.reduce((n, u) => n + (u.owner === C.CHAOS_ID ? 1 : 0), 0),
      players: snap.players.map((pl, pi) => ({
        ess: pl.essence || 0, income: pl.incomeRate || 0, drain: pl.drainRate || 0,
        works: pl.buildings.filter((b) => !b.raise).length,
        rising: pl.buildings.filter((b) => b.raise > 0).length,
        /* a rival's building TYPE is veiled, so a guest can only count the Gates it can name.
         * Undercounting a rival is the honest failure here; the header says the record is partial. */
        gates: pl.buildings.filter((b) => b.bt === 'gate' && !b.raise).length,
        army: snap.units.reduce((n, u) => n + (u.owner === pi ? 1 : 0), 0),
        pattern: pl.pattern || 0, hp: pl.castleHp, walking: !!pl.walking, out: false
      }))
    };
  };

  /* ---------------- lifecycle ---------------- */
  Rec.begin = function (meta) {
    head = Object.assign({ at: null }, meta);
    rows = []; cmds = []; notes = []; nextAt = 0; lastRift = -99;
    /* WHO TOOK YOUR MEN. Without this a report from play cannot tell a rival's assault from
     * the black road — and neither can the player, which is how Chaos came to be taking three
     * quarters of an army while everyone watched for the rival. */
    tally = { built: 0, lost: 0, razed: 0, peakArmy: 0, peakWorks: 0, walkStarted: null, torn: 0,
              deadFoe: 0, deadChaos: 0, sinceFoe: 0, sinceChaos: 0 };
    Rec.on = true;
  };
  Rec.abandon = function () { Rec.on = false; };
  /* is there anything worth offering? A match walked out of after ten seconds is not. */
  Rec.recorded = function () { return !!head && rows.length > 2; };

  Rec.sample = function (r) {
    if (!Rec.on || !r || r.t < nextAt) return;
    nextAt = r.t + SAMPLE;
    /* the dead since the last row, so the table shows WHEN an army went and to whom */
    r.lostFoe = tally.sinceFoe; r.lostChaos = tally.sinceChaos;
    tally.sinceFoe = tally.sinceChaos = 0;
    rows.push(r);
    const me = r.players[head.viewer] || r.players[0];
    if (me) {
      if (me.army > tally.peakArmy) tally.peakArmy = me.army;
      if (me.works > tally.peakWorks) tally.peakWorks = me.works;
    }
  };

  /* every command the player gave, with the hour they gave it — enough to replay by hand.
   * Consecutive repeats collapse: eleven upgrades in a row is one fact, not eleven. */
  Rec.command = function (cmd, world) {
    if (!Rec.on || !cmd || cmds.length >= MAX_CMDS) return;
    const t = world ? world.t : 0;
    const where = near(world, cmd.x, cmd.y);
    let line = cmd.c;
    if (cmd.c === 'build') line = 'build ' + cmd.bt;
    else if (cmd.c === 'up') {
      /* which work is being raised is the whole content of an upgrade order */
      const b = world && world.players ? (world.players[head.viewer].buildings || [])
        .find((q) => q.id === cmd.id) : null;
      /* called after the order took, so the level read here is the one just reached */
      line = 'upgrade ' + (b ? b.bt + ' → L' + b.level : '?') + (cmd.br ? ' (' + cmd.br + ')' : '');
    } else if (cmd.c === 'walk') line = cmd.on ? 'BEGIN THE WALK' : 'halt the walk';
    else if (cmd.c === 'power') line = 'power: ' + (C.POWERS[cmd.k] ? C.POWERS[cmd.k].name : cmd.k);
    else if (cmd.c === 'banner') line = 'the Recall — every standard struck';
    else if (cmd.c === 'rally') line = 'company ' + cmd.co + ' standard';
    else if (cmd.c === 'assign') line = 'hall → company ' + cmd.co;
    else if (cmd.c === 'muster') line = cmd.pause ? 'halt the muster' : 'resume the muster';
    const text = line + (where ? '  @ ' + where : '');
    const last = cmds[cmds.length - 1];
    if (last && last.text === text) { last.n++; last.to = t; return; }
    cmds.push({ at: t, to: t, text, n: 1 });
  };

  /* the moments worth naming. `events` is the sim's own queue, already drained by the caller */
  Rec.note = function (events, world) {
    if (!Rec.on || !events || !events.length) return;
    const t = world ? world.t : 0, me = head.viewer;
    for (const ev of events) {
      /* every man of yours who falls, and to what */
      if (ev.e === 'die' && ev.owner === me) {
        if (ev.by === C.CHAOS_ID) { tally.deadChaos++; tally.sinceChaos++; }
        else if (ev.by != null && ev.by !== me) { tally.deadFoe++; tally.sinceFoe++; }
        continue;
      }
      const mine = ev.pi === me;
      if (ev.e === 'raze') {
        if (mine) tally.lost++; else tally.razed++;
        const nm = C.BUILDINGS[ev.bt] ? C.BUILDINGS[ev.bt].name : ev.bt;
        /* by WHOM: a Gate gnawed off by fiends is a different fact from one a rival stormed */
        const hand = ev.by === C.CHAOS_ID ? ' — Chaos'
          : (ev.by != null && ev.by !== me && head.names[ev.by] ? ' — ' + head.names[ev.by] : '');
        notes.push([t, (mine ? 'YOUR ' + nm + ' is razed' + hand : 'you raze a rival ' + nm) +
                       (near(world, ev.x, ev.y) ? ' @ ' + near(world, ev.x, ev.y) : '')]);
      } else if (ev.e === 'walk') {
        if (mine && tally.walkStarted == null) tally.walkStarted = t;
        notes.push([t, (mine ? 'you set' : head.names[ev.pi] + ' sets') + ' foot upon the Pattern']);
      } else if (ev.e === 'pattern' && ev.idx > 0) {
        notes.push([t, (mine ? 'you' : head.names[ev.pi]) + C.PATTERN_ALERTS[ev.idx].msg.replace(/^ has| /, ' ')]);
      } else if (ev.e === 'shrinefell') {
        if (!mine) tally.torn++;
        notes.push([t, (mine ? 'YOUR Shrine is thrown down' : head.names[ev.pi] + ' is torn off the Pattern') +
                       ' — ' + Math.round(ev.pattern) + '% left']);
      } else if (ev.e === 'surge') notes.push([t, 'the black road SURGES']);
      else if (ev.e === 'rift') {
        if (t - lastRift < RIFT_QUIET) continue;
        lastRift = t;
        notes.push([t, 'Chaos tears a rift' + (near(world, ev.x, ev.y) ? ' @ ' + near(world, ev.x, ev.y) : '')]);
      } else if (ev.e === 'fall') notes.push([t, head.names[ev.pi] + ' is toppled']);
      else if (ev.e === 'hurtcity' && mine) notes.push([t, 'the enemy is inside your city']);
    }
  };

  /* `reading` is the last row: the table should end where the match ended, not at whatever
   * multiple of SAMPLE happened to fall before it */
  Rec.end = function (winner, reason, reading) {
    if (!Rec.on) return;
    if (reading) { nextAt = 0; Rec.sample(reading); }
    head.at = reading ? reading.t : (rows.length ? rows[rows.length - 1].t : 0);
    head.winner = winner; head.reason = reason;
  };

  /* ---------------- the match as curves ----------------
   * The same rows the table is printed from, handed over as series a chart can draw. This
   * lives HERE rather than in ui.js on purpose: which numbers tell the story of a match is a
   * question about the game, not about the DOM, and keeping it headless is what lets a test
   * assert the shape of the answer without a browser.
   *
   * `max` fixes a chart's ceiling where the number has a meaning at 100 (the Pattern, the
   * Seat's walls); the rest are scaled to what actually happened, because an army chart with a
   * ceiling of "whatever is possible" is a flat line along the bottom of every match. */
  Rec.SERIES = [
    { key: 'ess',     label: 'ESSENCE',      pick: (p) => p.ess },
    { key: 'income',  label: 'INCOME',       pick: (p) => p.income },
    { key: 'works',   label: 'WORKS',        pick: (p) => p.works },
    { key: 'gates',   label: 'SHADOW GATES', pick: (p) => p.gates || 0 },
    { key: 'army',    label: 'ARMY',         pick: (p) => p.army },
    { key: 'pattern', label: 'THE PATTERN',  pick: (p) => p.pattern, max: 100 },
    { key: 'hp',      label: 'THE SEAT',     pick: (p) => p.hp / C.CASTLE_HP * 100, max: 100 }
  ];

  Rec.curves = function () {
    if (!head || rows.length < 2) return null;
    const n = rows[0].players.length;
    const seats = [];
    for (let i = 0; i < n; i++) {
      seats.push({ i, name: head.names[i] || 'seat ' + i, you: i === head.viewer,
                   won: head.winner === i });
    }
    return {
      names: head.names.slice(), viewer: head.viewer, partial: !!head.partial,
      winner: head.winner, reason: head.reason || null, at: head.at || 0, seats,
      t: rows.map((r) => r.t),
      series: Rec.SERIES.map((s) => ({
        key: s.key, label: s.label, max: s.max || 0,
        /* A TOPPLED HEIR'S LINE STOPS — but not before the fall. Nulling every `out` sample
         * hides the one moment the chart exists to show: a Seat's walls plunging to nothing is
         * the end of the match, and the first version drew it as a line that had always been
         * flat at a hundred. So the sample he goes out on is drawn, and everything after it is
         * null — the curve dives and then ends, which is what happened. */
        lines: seats.map((st) => {
          let gone = false;
          return rows.map((r) => {
            const p = r.players[st.i];
            if (!p || gone) return null;
            if (p.out) gone = true;
            return s.pick(p);
          });
        })
      }))
    };
  };

  /* the facts that are not a curve: what the match cost you, and who took it */
  Rec.summary = function () {
    if (!head || !tally) return null;
    return { at: head.at || 0, winner: head.winner, reason: head.reason || null,
             viewer: head.viewer, names: head.names.slice(), partial: !!head.partial,
             peakArmy: tally.peakArmy, peakWorks: tally.peakWorks,
             lost: tally.lost, razed: tally.razed, torn: tally.torn,
             deadFoe: tally.deadFoe, deadChaos: tally.deadChaos,
             walkStarted: tally.walkStarted };
  };

  Rec.clock = clock;

  /* ---------------- handing the record across the wire ----------------
   * A GUEST CANNOT RECORD THE TRUTH and should not pretend to. It samples its own fog-filtered
   * snapshots: a rival's essence is never on the wire, a rival's works and men are only the
   * ones it can see. So the two end screens drew different matches — reported from play as
   * "the stats are completely different for the guest and the host".
   * The host has the world, and by the time this is sent the match is OVER and there is
   * nothing left to hide. `rows()` is what it hands over; `adopt()` is the guest taking it.
   *
   * Compact on purpose. A long four-way match is a hundred and thirty rows, and a row of
   * objects with named keys is most of a DataChannel message spent on the same eleven words
   * over and over. Numbers in a fixed order instead — see FIELDS. */
  const FIELDS = ['ess', 'income', 'works', 'rising', 'gates', 'army', 'pattern', 'hp'];
  Rec.rows = function () {
    return rows.map((r) => [Math.round(r.t), r.chaos, r.lostFoe || 0, r.lostChaos || 0].concat(
      ...r.players.map((p) => FIELDS.map((k) => Math.round((p[k] || 0) * 10) / 10)
        .concat(p.walking ? 1 : 0, p.out ? 1 : 0))));
  };
  Rec.adopt = function (packed) {
    if (!head || !packed || !packed.length) return false;
    const per = FIELDS.length + 2;
    const n = Math.floor((packed[0].length - 4) / per);
    if (n < 1) return false;
    rows = packed.map((a) => {
      const r = { t: a[0], tick: 0, chaos: a[1], lostFoe: a[2], lostChaos: a[3], players: [] };
      for (let i = 0; i < n; i++) {
        const o = 4 + i * per, p = {};
        FIELDS.forEach((k, j) => { p[k] = a[o + j]; });
        p.walking = !!a[o + FIELDS.length];
        p.out = !!a[o + FIELDS.length + 1];
        r.players.push(p);
      }
      return r;
    });
    /* it is the truth now, so the record stops calling itself partial */
    head.partial = false;
    head.adopted = true;
    return true;
  };

  /* ---------------- the artefact ---------------- */
  /* a column heading has to fit: "Benedict, Master of Arms" is a title, not a label */
  const tag = (i) => (i === head.viewer ? 'YOU'
    : String(head.names[i] || 'seat ' + i).split(',')[0].slice(0, 8));

  const W = 32;   // width of one seat's block — four of them still paste as a table
  function table() {
    if (!rows.length) return '(no rows)';
    const n = rows[0].players.length;
    const cols = [];
    for (let i = 0; i < n; i++) cols.push(i);
    let out = ' time |' + cols.map((i) => (' ' + tag(i)).padEnd(W)).join('|') + '  your dead\n';
    out += '      |' + cols.map(() => '  ess   in works army  pat  hp'.padEnd(W)).join('|') +
           ' chaos  foe|Chaos\n';
    for (const r of rows) {
      out += clock(r.t).padStart(5) + ' |';
      out += cols.map((i) => {
        const p = r.players[i];
        if (!p) return ''.padEnd(W);
        if (p.out) return '  (out)'.padEnd(W);
        return (String(Math.round(p.ess)).padStart(5) +
                p.income.toFixed(0).padStart(5) +
                (String(p.works) + (p.rising ? '+' + p.rising : '')).padStart(6) +
                String(p.army).padStart(5) +
                (p.pattern > 0 ? p.pattern.toFixed(0) + (p.walking ? '%*' : '% ') : '').padStart(6) +
                String(Math.round(p.hp / C.CASTLE_HP * 100)).padStart(4)).padEnd(W);
      }).join('|');
      out += String(r.chaos).padStart(6) + '  ' +
             (r.lostFoe || 0) + '|' + (r.lostChaos || 0) + '\n';
    }
    return out;
  }

  Rec.text = function () {
    if (!head) return 'AMBER — no match recorded.';
    const won = head.winner === head.viewer;
    const who = head.winner == null ? 'nobody (unfinished)'
      : head.winner < 0 ? 'Chaos'
      : (head.winner === head.viewer ? 'YOU' : head.names[head.winner] || ('seat ' + head.winner));
    const L = [];
    L.push('AMBER — THE SUCCESSION · chronicle of a match');
    L.push('build ' + head.version + '   seed ' + head.seed + '   ' + head.mode +
           (head.footing ? '   footing ' + head.footing : '') +
           (head.renderer ? '   ' + head.renderer : ''));
    L.push('seats: ' + head.names.map((nm, i) => (i === head.viewer ? '[' + nm + ']' : nm)).join(', ') +
           '   (you are seat ' + head.viewer + ')');
    if (head.partial) L.push('NOTE: recorded from a guest\'s own snapshots — rival numbers are what you could SEE, not the truth.');
    L.push(head.winner === undefined
      ? 'result: abandoned at ' + clock(head.at || 0)
      : 'result: ' + (won ? 'WON' : 'LOST') + ' at ' + clock(head.at || 0) + ' — by ' + (head.reason || '?') + ', to ' + who);
    const dead = tally.deadFoe + tally.deadChaos;
    L.push('YOUR DEAD: ' + dead + ' — ' + tally.deadFoe + ' to the heirs, ' + tally.deadChaos +
           ' to Chaos' + (dead ? '  (Chaos took ' + Math.round(tally.deadChaos / dead * 100) + '%)' : ''));
    L.push('your peak: ' + tally.peakArmy + ' troops, ' + tally.peakWorks + ' works · ' +
           'works lost ' + tally.lost + ', razed ' + tally.razed +
           (tally.walkStarted != null ? ' · began the walk at ' + clock(tally.walkStarted) : ' · never walked') +
           (tally.torn ? ' · tore a rival off the Pattern ' + tally.torn + 'x' : ''));
    L.push('');
    L.push('— the hours — ("+n" works rising, "*" walking, chaos = fiends alive)');
    L.push(table());
    L.push('— your orders —');
    L.push(cmds.length ? cmds.map((c) => '  ' + clock(c.at).padStart(5) +
      (c.n > 1 ? '-' + clock(c.to) : '     ') + '  ' + c.text +
      (c.n > 1 ? '  ×' + c.n : '')).join('\n') : '  (none)');
    if (cmds.length >= MAX_CMDS) L.push('  …(truncated at ' + MAX_CMDS + ')');
    L.push('');
    L.push('— the moments —');
    L.push(notes.length ? notes.map(([t, s]) => '  ' + clock(t).padStart(5) + '  ' + s).join('\n') : '  (none)');
    return L.join('\n');
  };

  global.Rec = Rec;
  if (typeof module !== 'undefined' && module.exports) module.exports = Rec;
})(typeof window !== 'undefined' ? window : globalThis);

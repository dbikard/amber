/* ui.js — DOM overlays: HUD, build/upgrade sheets, banners, menus, end screen.
 * Pure presentation + input surfaces; all game logic lives behind the handlers
 * game.js passes to UI.init(). Canvas never draws UI; UI never touches the world. */
(function (global) {
  'use strict';

  const C = global.CONST;
  const $ = (id) => document.getElementById(id);
  const UI = {};
  let H = {};   // handlers from game.js

  UI.init = function (handlers) {
    H = handlers;
    const sheet = $('sheet');
    sheet.addEventListener('click', (e) => {
      if (performance.now() - (sheet._openedAt || 0) < 320) { e.stopPropagation(); e.preventDefault(); }
    }, true);
    /* the menu's fold-out panels close when you tap away from them, like the sheets do */
    document.addEventListener('pointerdown', (e) => {
      /* A MODAL ABOVE THE MENU IS NOT "AWAY". The QR scanner is a full-screen overlay and it
       * lives OUTSIDE the fold-out, so steadying the phone against the glass — or tapping its
       * own ✕ — read as a tap elsewhere on the menu and quietly shut the LAN panel underneath.
       * The host came back from scanning the reply to a bare title screen, with the status
       * line, the diagnostics and the BEGIN button all hidden behind a panel it had no reason
       * to think had closed. Reported from play as "LAN is broken". */
      if (e.target && e.target.closest && e.target.closest('#scanner, #record-box, #sheet, #roll')) return;
      const closeIfAway = (panelId, btnId) => {
        const panel = $(panelId), btn = $(btnId);
        if (!panel || panel.classList.contains('hidden')) return;
        if (panel.contains(e.target) || (btn && btn.contains(e.target))) return;
        panel.classList.add('hidden');
      };
      closeIfAway('skirmish-row', 'btn-skirmish');
      closeIfAway('lan-panel', 'btn-lan');
    }, true);
    $('btn-campaign').addEventListener('click', () => H.onCampaign());
    $('btn-skirmish').addEventListener('click', () => $('skirmish-row').classList.toggle('hidden'));
    $('btn-lan').addEventListener('click', () => $('lan-panel').classList.toggle('hidden'));
    $('btn-build').addEventListener('click', () => H.onBuildMenu());
    $('btn-pause').addEventListener('click', () => H.onPause());
    $('halt').addEventListener('click', () => H.onPause());
    $('pw-storm').addEventListener('click', () => H.onPower('storm'));
    $('pw-trump').addEventListener('click', () => H.onPower('trump'));
    $('end-next').addEventListener('click', () => H.onEndNext());
    $('end-menu').addEventListener('click', () => H.onEndMenu());
    $('end-copy').addEventListener('click', () => UI.copyRecord($('end-copy')));
    $('end-save').addEventListener('click', () => UI.saveRecord());
    $('menu-record').addEventListener('click', () => UI.copyRecord($('menu-record')));
    $('btn-roll').addEventListener('click', () => UI.roll());
    $('roll-close').addEventListener('click', () => UI.rollClose());
    $('record-close').addEventListener('click', () => $('record-box').classList.add('hidden'));

    /* THE FOOTING GOVERNS BOTH. It used to live inside the skirmish fold-out, which said —
     * wrongly — that it had nothing to do with the campaign; the ladder had a private ramp of
     * its own that no menu ever mentioned. One choice now, above both, and it sticks between
     * matches because it is a preference and asking twice would be nagging. */
    const foot = $('footing-row');
    const diffRow = document.createElement('div');
    diffRow.className = 'diff-row';
    const note = document.createElement('div');
    note.className = 'diff-note';
    UI.paintFooting = () => {
      const cur = UI.difficulty();
      for (const b of diffRow.children) b.classList.toggle('on', b.dataset.key === cur);
      note.textContent = C.DIFFICULTY[cur].blurb;
    };
    for (const key of C.DIFFICULTY_UI) {
      const d = C.DIFFICULTY[key];
      const b = document.createElement('button');
      b.className = 'mbtn small diff';
      b.dataset.key = key;
      b.textContent = d.name;
      b.addEventListener('click', () => { UI.setDifficulty(key); UI.paintFooting(); });
      diffRow.appendChild(b);
    }
    foot.appendChild(diffRow);
    foot.appendChild(note);

    /* the heirs, one card each, in the order the ladder faces them */
    const row = $('skirmish-row');
    for (const kind of Object.keys(global.AI.HEIRS)) {
      const b = document.createElement('button');
      b.className = 'mbtn small';
      b.textContent = global.AI.HEIRS[kind].title.split(',')[0].toUpperCase();
      b.addEventListener('click', () => H.onSkirmish(kind));
      row.appendChild(b);
    }
    UI.paintFooting();
  };
  /* remembered across sessions; an unknown or missing value falls back to the default */
  UI.difficulty = function () {
    let k = null;
    try { k = localStorage.getItem('amber_difficulty'); } catch (e) { k = null; }
    return C.DIFFICULTY[k] ? k : C.DIFFICULTY_DEFAULT;
  };
  UI.setDifficulty = function (k) {
    if (!C.DIFFICULTY[k]) return;
    try { localStorage.setItem('amber_difficulty', k); } catch (e) { /* private mode: this match only */ }
  };

  /* ---------------- menu / match lifecycle ---------------- */
  UI.showMenu = function (campaignLabel, campaignNote) {
    haltShown = null;
    $('halt').classList.add('hidden');
    $('menu').classList.remove('hidden');
    $('hud').classList.add('hidden');
    $('end').classList.add('hidden');
    UI.closeSheet();
    $('btn-campaign').textContent = campaignLabel;
    $('campaign-note').textContent = campaignNote || '';
    if (UI.paintFooting) UI.paintFooting();
    /* the match you WALKED OUT OF is often the one worth sending — a game that went badly
     * enough to abandon never reaches the end screen, so the chronicle is offered here too */
    const has = !!(global.Rec && global.Rec.recorded && global.Rec.recorded());
    const btn = $('menu-record');
    btn.classList.toggle('hidden', !has);
    btn.textContent = '📜 CHRONICLE OF THE LAST MATCH';
    $('record-box').classList.add('hidden');
  };
  UI.startMatch = function (rivalName) {
    haltShown = null; masonHash = '';
    $('knell').classList.add('hidden');   // no warning carries over from the last match
    $('halt').classList.add('hidden');
    $('menu').classList.add('hidden');
    $('end').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('rival-name').textContent = rivalName;
    $('walkers').innerHTML = '';
  };

  /* ---------------- the halt ----------------
   * One panel, and the whole of it is the button — on a phone the thing you want most is the
   * biggest target on the screen. It says WHO called it, because in a four-way that is the
   * first question, and it does not pretend the halt is yours alone: anyone may lift it. */
  let haltShown = null;
  UI.paused = function (paused, viewer, names) {
    const el = $('halt'), on = !!paused;
    const key = on ? String(paused.by) : '';
    $('btn-pause').textContent = on ? '▶' : '⏸';
    $('btn-pause').title = on ? 'Go on' : 'Call a halt';
    if (key === haltShown) return;
    haltShown = key;
    el.classList.toggle('hidden', !on);
    if (!on) return;
    const who = paused.by === viewer ? 'you called it'
      : 'called by ' + ((names && names[paused.by]) || ('seat ' + (paused.by + 1)));
    el.querySelector('.halt-who').textContent = who;
  };

  /* ---------------- flag tray: the army's orders, always at thumb's reach ---------------- */
  const PENNANT_CSS = ['#e8ecff', '#64d8d8', '#c48eff', '#ff9ad8', '#9adcff', '#ffc27a', '#b0e8a0', '#d8b0ff'];
  let trayHash = '';
  /* a company's colour follows its ID, which never repeats — so a standard keeps its colour
   * for the whole match instead of shuffling every time some other hall is razed */
  UI.coColor = (id) => PENNANT_CSS[(id - 1) % PENNANT_CSS.length];
  /* the same seat colours the renderer uses: you are gold, rivals take the rest in seat order */
  UI.seatColor = (pi, viewer) => {
    const hex = pi === viewer ? C.SEAT_TINT[0]
      : (C.SEAT_TINT[1 + (pi < viewer ? pi : pi - 1)] || C.SEAT_TINT[1]);
    return '#' + hex.toString(16).padStart(6, '0');
  };
  /* a standard that has stopped mustering wears it: the tray is where you look to see what the
   * army is doing, and 'why is nobody arriving' should be answerable from there */
  UI.flags = function (view, viewer, armed) {
    const tray = $('flag-tray');
    const me = view.players[viewer];
    /* ONE chip per company, not per hall: a dozen barracks under three standards is three
     * flags to think about, which is the whole point of companies */
    const cos = me.companies || [];
    const halls = (id) => me.buildings.filter((b) => C.BUILDINGS[b.bt] && C.BUILDINGS[b.bt].spawns && b.co === id).length;
    const rows = cos.map((co) => [co.id, !!co.rally, halls(co.id), !!co.trump, !!co.paused]);
    const hash = armed + '|' + rows.map((r) => r.join(':')).join(',');
    if (hash === trayHash) return;
    trayHash = hash;
    tray.innerHTML = '';
    const mk = (id, glyph, cls, color) => {
      const b = document.createElement('button');
      b.className = 'fbtn ' + cls + (armed === id ? ' armed' : '');
      b.innerHTML = glyph;
      if (color) b.style.color = color;
      b.addEventListener('click', () => H.onFlagArm(id));
      tray.appendChild(b);
      return b;
    };
    /* NO GOLD FLAG. There was one chip that moved everything and a chip per company, and the
     * gold one was both redundant and a trap — it struck every standing detachment order the
     * moment you touched it. Every hall flies a standard of its own now, so the tray is the
     * army: one flag per company, and nothing that quietly overrules them. */
    for (const [id, afield, n, trump, quiet] of rows) {
      /* THE TRUMP IS NOT A DETACHMENT. It is one summoned Amberite who answers to nothing
       * else, so it gets the card rather than a pennant, and a colour no company can take. */
      const col = trump ? '#c48eff' : UI.coColor(id);
      const b = mk(id, trump ? '🃏' : '⚐', trump ? 'co trump' : 'co', col);
      b.title = trump ? 'the Champion you called through the Trump'
                      : n + (n === 1 ? ' hall' : ' halls') + (quiet ? ', mustering nobody' : '');
      /* A QUIET STANDARD SAYS SO. The tray is where you look to see what the army is doing,
       * so 'why is nobody arriving under this flag' has to be answerable from it. */
      if (quiet) b.classList.add('quiet');
      if (n > 1) {
        const c2 = document.createElement('span');
        c2.className = 'fcount';
        c2.textContent = n;
        b.appendChild(c2);
      }
      if (afield) {
        const d = document.createElement('span');
        d.className = 'dot';
        d.style.background = col;
        b.appendChild(d);
      }
    }
    if (typeof armed === 'number') {
      const rj = document.createElement('button');
      rj.id = 'flag-rejoin';
      rj.textContent = '⟲ HOLD';
      rj.addEventListener('click', () => H.onRejoin(armed));
      tray.appendChild(rj);
    }
  };

  /* ---------------- HUD ---------------- */
  const mmss = (t) => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
  /* THE YARD, on screen. What this game rations is the MASONS, and the only way to find out
   * you had none free was to be told so by a refusal — after you had already chosen a spot
   * and opened the sheet. Read straight off the view, so it is the same truth on a host and
   * on a guest: a crew per finished Gate group, minus the crews already on something. */
  let masonHash = '';
  /* THE OTHER PURSE, remembered. Essence is not the only thing a work costs — every one of
   * them takes a mason CREW — so the sheet has to grey out for want of a crew exactly the way
   * it greys out for want of coin, and clear again the moment one comes free even if the sheet
   * has been open the whole time. Read once a frame here, off the same view the yard reads, so
   * a guest with no world of its own is told the same truth. */
  let masonFree = 0;
  function paintMasons(view, viewer) {
    const me = view.players[viewer];
    let gates = 0, busy = 0;
    for (const b of me.buildings) {
      if (b.bt === 'gate' && !b.raise) gates++;
      /* A CREW IN A WORK IS A CREW. This counted only works going UP, so while a level was
       * being raised or a breach mended — both of which take a crew, and both of which the
       * sim counts — the yard read as idle and the next order came back 'busy'. The readout
       * has to mirror World.rising exactly or it is worse than not having one. */
      if (b.raise > 0 || b.work > 0) busy += (b.crews || 1);
    }
    const total = Math.max(C.MASONS.floor,   // the last crew never leaves — mirrors World.masons
                           Math.min(C.MASONS.max, C.MASONS.base + Math.floor(gates / C.MASONS.per)));
    const free = Math.max(0, total - busy);
    masonFree = free;
    const key = free + '/' + total;
    if (key === masonHash) return;
    masonHash = key;
    $('m-free').textContent = free;
    $('m-of').textContent = '/' + total;
    $('masons').classList.toggle('busy', free === 0);
    /* and the BUTTON goes with it. There is nothing behind it worth opening with no crew in
     * the yard, and finding that out by choosing a work and being refused at the tap is the
     * long way round. It still opens — the cards say WHY, which a dead button cannot. */
    $('btn-build').classList.toggle('nocrew', free === 0);
  }

  UI.hud = function (view, viewer, incomeRate, targeting) {
    const me = view.players[viewer];
    paintMasons(view, viewer);
    /* with four heirs there is no single "the rival": the top line reports whoever is
     * furthest along the Pattern among those who have revealed themselves */
    const rivals = view.players.filter((q, pi) => pi !== viewer && !q.out);
    const en = rivals.filter((q) => q.revealed).sort((a, b) => b.pattern - a.pattern)[0] || rivals[0] ||
               { revealed: false, pattern: 0 };
    $('ess-n').textContent = Math.floor(me.essence);
    const er = $('ess-rate');
    er.textContent = (incomeRate >= 0 ? '+' : '') + incomeRate.toFixed(1) + '/s' + (me.musterPaused ? ' ⏸' : '');
    er.style.color = incomeRate >= 0 ? '' : '#ff8a96';
    $('timer').textContent = mmss(view.t);
    /* THE RACE. Every heir on the Pattern, however far along, in their own colour — a walk
     * is a public act and the whole table is owed the count. Yours is marked. */
    const race = $('walkers');
    const on = view.players.map((q, pi) => ({ q, pi }))
      .filter(({ q, pi }) => !q.out && q.walking && (pi === viewer || q.revealed))
      .sort((a, b) => b.q.pattern - a.q.pattern);
    const key = on.map(({ q, pi }) => pi + ':' + q.pattern.toFixed(0)).join(',');
    if (key !== race._key) {
      race._key = key;
      race.innerHTML = '';
      for (const { q, pi } of on) {
        const d = document.createElement('div');
        d.className = 'walker' + (pi === viewer ? ' mine' : '');
        d.style.color = UI.seatColor(pi, viewer);
        d.textContent = '✴ ' + (pi === viewer ? 'YOU' : (C.SEAT_NAMES[pi] || 'a rival').toUpperCase()) +
                        ' ' + q.pattern.toFixed(0) + '%';
        race.appendChild(d);
      }
      /* tell the map how far down to start, so the two never overlap */
      if (global.Render) {
        const b = race.getBoundingClientRect();
        global.Render.miniTop = on.length ? Math.ceil(b.bottom) + 6 : 0;
      }
    }
    for (const k of ['storm', 'trump']) {
      const btn = $('pw-' + k), cd = me.powers ? me.powers[k] : 99;
      const ready = cd <= 0;
      btn.disabled = !ready;
      btn.classList.toggle('armed', k === 'storm' && targeting);
      btn.querySelector('.pw-cd').textContent = ready ? '' : Math.ceil(cd);
    }
    /* my pattern, small, over my own city */
    const mp = $('my-pattern');
    if (me.pattern > 0) { mp.classList.remove('hidden'); mp.textContent = '✴ ' + me.pattern.toFixed(1) + '%' + (me.walking ? ' — walking' : ' — paused'); }
    else mp.classList.add('hidden');
  };

  /* ---------------- build / upgrade sheets ---------------- */
  const trChip = (essence) => `<span class="tr-chip">◆ <b>${Math.floor(essence)}</b></span>`;
  /* what a building does to the essence flow, at a given level */
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  function rateTag(bt, level) {
    const d = C.BUILDINGS[bt];
    if (!d) return '';
    /* `nodeIncome`, not `income`: a Gate stands on a spring or nowhere since the open world,
     * and the old base-income field is gone from the table. Keyed on the dead field this
     * branch silently never fired, so a Gate's card — build sheet and upgrade sheet alike —
     * stopped saying what a Gate is FOR. Found by a test that asked the card to say it. */
    if (d.nodeIncome) return `<span class="c-rate up">+${d.nodeIncome[level - 1]}◆/s from its spring</span>`;
    /* A LEVEL BUYS BETTER MEN, NOT MORE OF THEM, so the card has to say what the men become
     * — the rate is the same at every level and quoting it would read as "no change". */
    if (d.spawns) return unitLine(d.spawns, d.period[level - 1], level);
    if (bt === 'shrine') return `<span class="c-rate dn">−${d.drain[level - 1]}◆/s while walking</span>`;
    return '';
  }
  /* why the ground refuses a work — said plainly, because free placement fails silently otherwise */
  const WHY = {
    ground: 'the ground will not bear it — wood, rock or water',
    whole: 'there is nothing broken to mend',
    working: 'the masons are already in it',
    crowded: 'too close to another work',
    claim: 'beyond your writ — hold a Gate nearer, or take a spring',
    nospring: 'a Gate draws Shadow out of the ground — it stands on a spring, and only there',
    taken: 'that spring is already drawn upon',
    presence: 'no troops of yours stand there to claim it',
    contested: 'the enemy stands there',
    busy: 'your masons are all at work — every Shadow Gate you hold hires another crew',
    unique: 'you have one already',
    /* a work with a length has two refusals of its own — both about the RUN, not the spot */
    short: 'too short a run to be a wall',
    crews: 'longer than your masons reach — hold more Gates, or draw a shorter run'
  };
  /* The standard chooser, used twice: once before raising a hall, once on the hall's own
   * sheet to move it later. Companies exist so that a dozen halls need not mean a dozen
   * flags — so choosing one has to be as easy as accepting the default. */
  function standardCards(el, me, current, pick) {
    const cos = me.companies || [];
    const row = (label, blurb, color, on, val) => {
      const b = document.createElement('button');
      b.className = 'card' + (on ? ' chosen' : '');
      b.dataset.co = val;
      b.innerHTML = `<span class="c-ico" style="color:${color}">${val === 0 ? '⚑' : '⚐'}</span>` +
                    `<span class="c-name">${label}</span><span class="c-cost">${on ? '✓' : ''}</span>` +
                    `<span class="c-blurb">${blurb}</span>`;
      b.addEventListener('click', () => pick(val));
      el.appendChild(b);
    };
    for (const co of cos) {
      const n = me.buildings.filter((q) => C.BUILDINGS[q.bt] && C.BUILDINGS[q.bt].spawns && q.co === co.id).length;
      if (co.trump) continue;   // the Champion answers his own card and nothing else
      row('Standard ' + co.id,
          (n ? n + (n === 1 ? ' hall musters' : ' halls muster') + ' under it' : 'no hall under it yet') +
          (co.rally ? ' · posted afield' : ' · holding at home'),
          UI.coColor(co.id), current === co.id, co.id);
    }
    row('A new standard', 'Raise a company of its own, with its own flag in the tray',
        '#b8a878', false, 'new');
    if (!cos.length) return;   // nothing to choose between: the caller should not have asked
  }

  /* ONE LINE PER WORK. The tray carried each work's blurb and its rate, which is two more rows
   * a card — seven works came to more than the sheet is tall, so choosing meant scrolling a
   * menu you are holding in one hand mid-match. What a choice needs is what it costs and how
   * long it takes; what a work DOES is on the work itself, where you tap it. The blurb span
   * stays, empty, because the crew lock still writes a refusal into it on the sheets that
   * have room for one — and an empty one collapses its row to nothing. */
  function cardBody(d, bt, bad) {
    /* WHAT IT COSTS TO KEEP, not only to raise. The stone price is paid once; a hall then
     * draws its recruit's price every muster period for the rest of the match, and that
     * standing drain — the number that actually decides whether a realm can carry another
     * hall — was nowhere on the card that sells it. `rateTag` is the same line the upgrade
     * sheet already shows: +◆/s on a Gate, −◆/s and the man on a hall, the walk's drain on
     * the Shrine. Reported from play as "the rate cost of mustering should be visible". */
    return `<span class="c-ico">${d.icon}</span><span class="c-name">${d.name}</span>` +
           `<span class="c-cost">◆ ${d.cost}${d.raise ? ' · 🔨' + d.raise + 's' : ''}</span>` +
           rateTag(bt, 1) +
           `<span class="c-blurb">${bad ? '<i>' + (WHY[bad] || bad) + '</i>' : ''}</span>`;
  }
  /* ONE caller now: the BUILD button's sheet. The `at`/`why` pair went with the site sheet —
   * a tray that belonged to a patch of ground could say why THAT ground refused a work, and
   * nothing belongs to a patch of ground any more. */
  function buildCards(el, essence) {
    for (const bt of C.BUILD_ORDER_UI) {
      const d = C.BUILDINGS[bt];
      const bad = null;   // the ground answers when you put it down, not here
      const card = document.createElement('button');
      card.className = 'card' + (essence >= d.cost && !bad ? '' : ' locked');
      card.dataset.cost = d.cost;      // live affordability: UI.tick unlocks it as income catches up
      card.dataset.bt = bt;            // ...and re-asks the sim why, so a card can unlock in place
      card.dataset.crew = '1';         // ...and every work takes a mason crew: see crewLock
      card.dataset.bad = bad || '';
      card.innerHTML = cardBody(d, bt, bad);
      card.addEventListener('click', () => {
        if (card.classList.contains('locked')) return;
        /* a hall that musters troops asks which standard it answers to — everything else
         * simply goes up */
        /* every card ARMS the work now; the map places it. A work with a LENGTH simply
         * needs two taps instead of one, which the placement flow already knows. */
        if (d.span) { H.onPick(bt, undefined); UI.closeSheet(); return; }
        /* THE FIRST HALL DOES NOT ASK. There is nothing to choose between, and a menu with
         * one option on it is a menu you resent — it simply raises its own standard. Every
         * hall after that gets the choice: join one of yours, or raise another. */
        if (d.spawns && el._me && (el._me.companies || []).length) {
          el.innerHTML = `<div class="sheet-title">${d.icon} ${d.name} — under which standard?</div>`;
          standardCards(el, el._me, 0, (co) => { H.onPick(bt, co); UI.closeSheet(); });
          addCancel(el);
          return;
        }
        H.onPick(bt, undefined);
        UI.closeSheet();
      });
      el.appendChild(card);
    }
    /* A card still goes live while you look at it — the masons finish, the purse catches up —
     * but what changes is the PURSE and the YARD, not the ground, so UI.tick reads those and
     * there is nothing here to remember. */
  }
  const freshSheet = () => { const el = $('sheet'); el._why = null; el._raising = null; return el; };
  /* CHOOSE FIRST, PLACE SECOND. The sheet no longer belongs to a spot on the map — it is what
   * the BUILD button opens — so the cards cannot say why a particular patch of ground refuses
   * them. They say what a work costs and whether you can afford it; the ground answers when
   * you put it down, which is also when you can see where it is going. */
  UI.buildSheet = function (essence, me) {
    const el = freshSheet();
    el._me = me || null;
    el.innerHTML = `<div class="sheet-title">Raise a work ${trChip(essence)}</div>` +
                   `<div class="sheet-blurb hidden" id="no-crew"><i>${WHY.busy}</i></div>`;
    buildCards(el, essence);
    addCancel(el);
    el._openedAt = performance.now();
    el.classList.remove('hidden');
    UI.tick(essence);   // grey it on the frame it opens, not on the one after
  };
  UI.armBuild = function (on) { $('btn-build').classList.toggle('armed', !!on); };

  /* a forked tower shows what it BECAME, not the generic name it was raised under */
  /* WHAT A WORK CALLS ITSELF. A forked work has stopped being the thing you raised — a
   * Ballista is not a Watchtower with an option ticked — so its sheet takes the branch's whole
   * identity. Generic across every branching work, not the tower alone. */
  function workFace(s) {
    const br = global.World.branchOf ? global.World.branchOf(s) : null;
    return br ? { icon: br.icon, name: br.name, blurb: br.blurb } : C.BUILDINGS[s.bt];
  }
  /* THE NUMBERS BEHIND THE BET. A branch is a permanent choice, so the card has to say what it
   * buys rather than only what it is called. Two shapes, because there are two kinds of branch:
   * a work that SHOOTS quotes its gunnery, a work that MUSTERS quotes the man it will raise. */
  function branchStatLine(bt, key, level) {
    const b2 = (C.BUILDINGS[bt].branches || {})[key];
    if (!b2) return '';
    const i = level - (C.BUILDINGS[bt].fork || 2);
    if (b2.dmg) {
      const dps = (b2.dmg[i] / b2.atk[i]).toFixed(1);
      return `<span class="c-rate wide">${b2.dmg[i]} dmg · ${dps}/s · ${b2.range[i]} range` +
             (b2.splash[i] ? ` · splash ${b2.splash[i]}` : ' · single target') + `</span>`;
    }
    if (b2.spawns) return unitLine(b2.spawns, b2.period ? b2.period[i] : C.BUILDINGS[bt].period[level - 1], level);
    return '';
  }
  /* one recruit, priced and described — the same two facts the upgrade card has always shown
   * for a hall, now that WHICH man it raises is a thing the branch decides */
  function unitLine(kind, period, level) {
    const u = C.UNITS[kind], m = C.TIER[level - 1];
    return `<span class="c-rate dn">−${(u.cost * m / period).toFixed(1)}◆/s muster</span>` +
           `<span class="c-rate up">${C.TIER_NAME[level - 1]}${u.name || cap(kind)}: ` +
           `${Math.round(u.hp * m)} hp · ${+(u.dmg * m).toFixed(1)} blow</span>`;
  }

  const raiseLine = (s) => (s.work > 0
    ? `<b>🔨 The masons are raising it to level ${s.level} — ` +
      `${Math.round((1 - s.work / (s.workFor || 1)) * 100)}%, about ${Math.ceil(s.work)}s more.</b><br>` +
      'It stands and it can be broken, but it does its job for nobody until they are out of it.'
    : `<b>🔨 Rising — ${Math.round((1 - s.raise / (s.raiseFor || 1)) * 100)}%, about ${Math.ceil(s.raise)}s more.</b><br>` +
      'Until it is finished it earns nothing and holds no ground, and your masons can start nothing else.');
  /* WHICH SIDE OF THE STONE IS THE SHELTERED ONE. A run works its own sheltered face out from
   * where the owner's Seat lies, which is right for a curtain drawn across the approach to it
   * and wrong for every other one — a wall thrown up around a forward spring, or along a flank,
   * put the whole reserve in the open on the far side and left the cover empty. The sim cannot
   * know which way the war is coming from; the player looking at the board can. So this is a
   * SWITCH and not a cleverer guess: one tap turns the run's shelter over and the men walk
   * round on the next tick.
   *
   * It is offered on a rising run as well, which is why it is a function and not a line at the
   * bottom of the sheet — the sheet returns early for scaffolding, and which way a wall faces
   * is exactly the thing worth settling before it is finished. A breach shelters nobody, so it
   * is the one state with nothing to turn about. */
  function flipCard(el, s) {
    if (s.x2 == null || s.breach) return;
    const b = document.createElement('button');
    b.className = 'card';
    b.id = 'wall-flip';
    b.innerHTML = '<span class="c-ico">⇄</span><span class="c-name">Turn the wall about</span>' +
                  '<span class="c-blurb">The far side becomes the sheltered one. Your men fall back ' +
                  'through it and take cover on the other face.</span>';
    b.addEventListener('click', () => { H.onFlip(s.id); UI.closeSheet(); });
    el.appendChild(b);
  }
  UI.upSheet = function (s, essence, walking, me) {
    const d = C.BUILDINGS[s.bt], face = workFace(s);
    const el = freshSheet();
    el._me = me || null;
    el.innerHTML = `<div class="sheet-title">${face.icon} ${face.name} — level ${s.level} ${trChip(essence)}</div>` +
                   `<div class="sheet-blurb">${face.blurb}</div>`;
    /* still scaffolding: it earns nothing, musters nobody and holds no ground yet, and there
     * is nothing to offer but the wait */
    if (s.raise > 0 || s.work > 0) {
      const w = document.createElement('div');
      w.className = 'sheet-blurb';
      w.id = 'raise-line';
      el._raising = s;   // counted down live by UI.tick, rather than frozen at the moment it opened
      w.innerHTML = raiseLine(s);
      el.appendChild(w);
      flipCard(el, s);
      addCancel(el);
      el._openedAt = performance.now();
      el.classList.remove('hidden');
      return;
    }
    /* A BREACHED CURTAIN offers one thing and it is not an upgrade: put the stone back. */
    if (s.breach) {
      const size = s.units != null ? s.units : (s.crews || 1);   // stone, not crews
      const price = Math.max(1, Math.round(C.BUILDINGS.wall.cost * size * C.WALL.repair));
      const b = document.createElement('button');
      b.className = 'card' + (essence >= price ? '' : ' locked');
      b.dataset.cost = price;
      b.dataset.crew = '1';
      b.innerHTML = '<span class="c-ico">🧱</span><span class="c-name">Mend the breach</span>' +
                    `<span class="c-cost">◆ ${price}</span>` +
                    '<span class="c-blurb">A crew and half the stone. It shelters nobody until they are done.</span>';
      b.addEventListener('click', () => { if (b.classList.contains('locked')) return; H.onFix(s.id); UI.closeSheet(); });
      el.appendChild(b);
      addCancel(el);
      el._openedAt = performance.now();
      el.classList.remove('hidden');
      UI.tick(essence);
      return;
    }
    /* THE FORK: the upgrade that reaches it is a CHOICE, offered as a card per branch. Every
     * branching work takes this path now, and the Barracks offers three where the tower offers
     * two — the loop never counted them. */
    const fork = C.BUILDINGS[s.bt].fork || 0;
    const forking = !!d.branches && !s.br && s.level + 1 === fork;
    if (forking) {
      const hint = document.createElement('div');
      hint.className = 'sheet-blurb';
      hint.textContent = (d.forkHint || 'Rebuild it.') + ' Choose once — the choice does not come again.';
      el.appendChild(hint);
      for (const key of d.branchUI) {
        const b2 = d.branches[key];
        const cost = global.World.upgradeCost(s.bt, s.level, key);
        const b = document.createElement('button');
        b.className = 'card' + (essence >= cost ? '' : ' locked');
        b.dataset.cost = cost;
        b.dataset.crew = '1';
        b.innerHTML = `<span class="c-ico">${b2.icon}</span><span class="c-name">${b2.name}</span>` +
                      `<span class="c-cost">◆ ${cost}</span><span class="c-blurb">${b2.blurb}</span>` +
                      branchStatLine(s.bt, key, fork);
        b.addEventListener('click', () => { if (b.classList.contains('locked')) return; H.onUp(s.id, key); UI.closeSheet(); });
        el.appendChild(b);
      }
    } else if (s.level < C.MAX_LEVEL && (d.up || d.branches)) {
      const cost = global.World.upgradeCost(s.bt, s.level, s.br);
      const can = essence >= cost;
      const b = document.createElement('button');
      b.className = 'card' + (can ? '' : ' locked');
      b.dataset.cost = cost;
      b.dataset.crew = '1';
      const forked = !!s.br;
      const rt = forked ? branchStatLine(s.bt, s.br, s.level + 1) : rateTag(s.bt, s.level + 1);
      /* AN UPGRADE IS MASONRY. It takes a crew and it takes time, and the work does its job
       * for nobody meanwhile — a hall musters nothing, a tower does not shoot, a Gate draws
       * nothing. Saying so on the card is the difference between a decision and a surprise. */
      const secs = Math.round(Math.max(1, (d.raise || 10) * C.UP_WORK));
      const quiet = d.spawns ? 'musters nobody' : s.bt === 'tower' ? 'does not shoot'
        : s.bt === 'gate' ? 'draws nothing' : 'stands idle';
      b.innerHTML = `<span class="c-name">Upgrade to level ${s.level + 1}</span><span class="c-cost">◆ ${cost}</span>` +
                    (rt ? (forked ? rt : rt.replace('c-rate', 'c-rate wide')) : '') +
                    `<span class="c-blurb">🔨 ${secs}s of masonry — it ${quiet} until they are done, ` +
                    'and a crew of yours is on it.</span>';
      b.addEventListener('click', () => { if (b.classList.contains('locked')) return; H.onUp(s.id, s.br); UI.closeSheet(); });
      el.appendChild(b);
    }
    if (d.spawns && me) {
      const co = (me.companies || []).find((q) => q.id === s.co) || null;
      const info = document.createElement('div');
      info.className = 'sheet-blurb';
      info.innerHTML = co
        ? `<b style="color:${UI.coColor(co.id)}">⚐ Standard ${co.id}</b>` +
          (co.rally ? ' — posted afield; its flag is in the tray' : ' — holding at home')
        : '⚐ Its muster answers no standard yet';
      el.appendChild(info);
      /* THE VALVE, PER STANDARD. Halting the muster used to be the Seat's order and the Seat's
       * alone, so saving for a Gate meant silencing every hall you own — the one holding the
       * line included. This one is the COMPANY's: it reaches every hall under that standard
       * and no others, and it is offered here because a hall is where you already are when
       * you are thinking about what it musters. */
      if (co) {
        const mu2 = document.createElement('button');
        mu2.className = 'card';
        mu2.id = 'co-muster';
        mu2.innerHTML = co.paused
          ? `<span class="c-ico">▶</span><span class="c-name">Resume Standard ${co.id}</span>` +
            '<span class="c-blurb">Its halls pay for troops again</span>'
          : `<span class="c-ico">⏸</span><span class="c-name">Halt Standard ${co.id}</span>` +
            '<span class="c-blurb">Every hall under this standard stops mustering — the rest of the realm carries on</span>';
        mu2.addEventListener('click', () => { H.onMusterCo(co.id, !co.paused); UI.closeSheet(); });
        el.appendChild(mu2);
      }
      const change = document.createElement('button');
      change.className = 'card';
      change.id = 'change-standard';
      change.innerHTML = '<span class="c-ico">⚐</span><span class="c-name">Change its standard</span>' +
                         '<span class="c-blurb">Move this hall to another company, or back under the Banner</span>';
      change.addEventListener('click', () => {
        el.innerHTML = `<div class="sheet-title">${face.icon} ${face.name} — under which standard?</div>`;
        standardCards(el, me, s.co || 0, (want) => { H.onAssign(s.id, want); UI.closeSheet(); });
        addCancel(el);
      });
      el.appendChild(change);
    }
    flipCard(el, s);
    if (s.bt === 'shrine') {
      const b = document.createElement('button');
      b.className = 'card walkbtn';
      b.innerHTML = `<span class="c-name">${walking ? '⏸ Pause the walk' : '✴ Walk the Pattern'}</span>` +
                    `<span class="c-blurb">${walking ? 'Hold your step upon the blazing lines' : 'Drains Essence. Your rival WILL know.'}</span>`;
      b.addEventListener('click', () => { H.onWalk(!walking); UI.closeSheet(); });
      el.appendChild(b);
    }
    addCancel(el);
    el._openedAt = performance.now();
    el.classList.remove('hidden');
    UI.tick(essence);
  };

  /* ---------------- map site sheet (v0.2) ---------------- */
  const KIND_BLURB = {
    node: 'A spring of living Shadow. Raise a Gate on it — your troops must be standing here — and it will pay for wars.',
    vantage: 'High ground over the paths. A Watchtower here sees far and shoots farther.',
    road: 'A milestone of the black road. Chaos favors this ground.',
    city: 'A Seat of Power.'
  };
  UI.siteSheet = function (site, st, viewer, essence, foeCity, pinfo, foeInfo) {
    freshSheet();
    const el = $('sheet');
    el._me = pinfo || null;
    const ownerTxt = !st ? 'unexplored' : st.holder == null || st.holder === -1 ? 'unclaimed'
      : st.holder === viewer ? 'yours' : 'the rival’s';
    el.innerHTML = `<div class="sheet-title">${site.name} ${trChip(essence)}</div>` +
                   `<div class="sheet-blurb">${KIND_BLURB[site.kind] || ''} <b>(${ownerTxt})</b></div>`;

    /* ---- the Seat of Power: city status + city-wide commands ---- */
    if (site.kind === 'city') {
      const p2 = foeCity ? foeInfo : pinfo;
      if (p2) {
        const stat = document.createElement('div');
        stat.className = 'sheet-blurb';
        stat.innerHTML = `🗼 Seat ${Math.round(p2.castleHp)}/${C.CASTLE_HP}`;
        el.appendChild(stat);
        /* A SEAT SHOOTS, AND NOBODY WOULD GUESS IT FROM A HIT-POINT BAR. It is the hardest gun
         * on the board and the only one no curtain shades — an heir planning an assault is
         * entitled to read that here rather than discover it under fire. Derived from the
         * table, so it can never quote a figure the sim has stopped using. */
        const gun = document.createElement('div');
        gun.className = 'sheet-blurb';
        gun.textContent = `🎯 The throne's own guns: ${Math.round(C.SEAT_GUN.dmg / C.SEAT_GUN.atk)}/s ` +
                          `out to ${C.SEAT_GUN.range}, and no wall shades them.`;
        el.appendChild(gun);
      }
      if (!foeCity && pinfo) {
        const shrine = (pinfo.buildings || []).find((q) => q.bt === 'shrine');
        const walkDrain = pinfo.walking && shrine ? C.BUILDINGS.shrine.drain[shrine.level - 1] : 0;
        const muster = Math.max(0, (pinfo.drainRate || 0) - walkDrain);
        const eco = document.createElement('div');
        eco.className = 'sheet-blurb';
        eco.textContent = `+${(pinfo.incomeRate || 0).toFixed(1)}/s income · −${muster.toFixed(1)}/s muster` +
                          (walkDrain ? ` · −${walkDrain.toFixed(1)}/s the walk` : '');
        el.appendChild(eco);
        /* Sound the Recall — every blade comes home */
        const rc = document.createElement('button');
        rc.className = 'card walkbtn';
        rc.innerHTML = '<span class="c-name">🛡 Sound the Recall</span>' +
                       '<span class="c-blurb">Every standard is struck and the whole army turns for home — defend the city</span>';
        rc.addEventListener('click', () => { H.onRecall(); UI.closeSheet(); });
        el.appendChild(rc);
        /* the muster valve */
        const mu = document.createElement('button');
        mu.className = 'card';
        mu.innerHTML = pinfo.musterPaused
          ? '<span class="c-name">▶ Resume the Muster</span><span class="c-blurb">Barracks and spires pay for troops again</span>'
          : '<span class="c-name">⏸ Halt the Muster</span><span class="c-blurb">Stop paying for new troops while the treasury gathers</span>';
        mu.addEventListener('click', () => { H.onMuster(!pinfo.musterPaused); UI.closeSheet(); });
        el.appendChild(mu);
      }
    }
    /* AND NOTHING TO BUILD. This sheet used to carry the whole build tray, because there was a
     * time when a tap on the ground was how you raised a work — but building is CHOOSE THEN
     * PLACE now: the 🔨 button arms a work and the next tap on the map puts it down. Leaving
     * the cards here left two contradictory ways to build, one of which ignored the armed
     * work you were already holding. A site says what it IS and who holds it; the button
     * raises things. */
    addCancel(el);
    el._openedAt = performance.now();
    el.classList.remove('hidden');
    UI.tick(essence);
  };

  function addCancel(el) {
    const c = document.createElement('button');
    c.className = 'card cancel'; c.textContent = 'Close';
    c.addEventListener('click', UI.closeSheet);
    el.appendChild(c);
  }
  /* A card marked `data-crew` is masonry — raising, raising a level, mending — and none of it
   * can start with the yard full. Grey it with the rest and say so where the blurb was, then
   * put the blurb back when a crew comes free. Toggled from UI.tick, so a sheet opened with no
   * crew in the yard clears itself the moment one walks out of a finished work. */
  function crewLock(card) {
    const want = !!card.dataset.crew && masonFree === 0;
    if (!!card._nocrew === want) return want;
    card._nocrew = want;
    const bl = card.querySelector('.c-blurb');
    if (bl) {
      if (want) { card._blurb = bl.innerHTML; bl.innerHTML = '<i>' + WHY.busy + '</i>'; }
      else if (card._blurb != null) bl.innerHTML = card._blurb;
    }
    return want;
  }
  /* live affordability: called every frame with the viewer's current essence —
   * a card locked when the sheet opened unlocks the moment the war chest reaches its cost */
  UI.tick = function (essence) {
    const el = $('sheet');
    if (el.classList.contains('hidden')) return;
    for (const card of el.querySelectorAll('.card[data-cost]')) {
      const bt = card.dataset.bt;
      let bad = card.dataset.bad || '';
      if (bt && el._why) {
        const now = el._why(bt) || '';
        if (now !== bad) {   // only touch the DOM when the answer actually changed
          bad = card.dataset.bad = now;
          card.innerHTML = cardBody(C.BUILDINGS[bt], bt, now || null);
          card._nocrew = false; card._blurb = null;   // a fresh body: the lock re-applies below
        }
      }
      const noCrew = crewLock(card);
      card.classList.toggle('locked', !!bad || noCrew || essence < +card.dataset.cost);
    }
    /* the yard's refusal is a property of the YARD, not of each card — said once, above them
     * all, so seven greyed works do not become seven copies of the same sentence */
    const nc = el.querySelector('#no-crew');
    if (nc) nc.classList.toggle('hidden', masonFree > 0);
    /* a work going up counts down in place; when it finishes the sheet is stale, so say so */
    if (el._raising) {
      const r = el._raising, busy = r.raise > 0 || r.work > 0;
      const line = el.querySelector('#raise-line');
      if (line) line.innerHTML = busy ? raiseLine(r)
        : '<b>✔ Finished.</b> Tap it again to see what it can do.';
      if (!busy) el._raising = null;
    }
    const chip = el.querySelector('.tr-chip b');
    if (chip) chip.textContent = Math.floor(essence);
  };

  UI.closeSheet = function () {
    const el = $('sheet');
    el.classList.add('hidden'); el._why = null; el._raising = null;
    if (global.Render) global.Render.selected = -1;
  };
  UI.sheetOpen = () => !$('sheet').classList.contains('hidden');

  /* ---------------- banners ---------------- */
  /* THE KNELL: a rival's progress on the Pattern, across the middle of the board and gone
   * again. It is not a banner — banners share a corner with rift warnings and storm calls,
   * and the one thing on this board that wins without touching you should not have to queue
   * behind the weather. `mark` is the number, which is what a player actually reads; the line
   * under it says whose walk it is. */
  let knellTimer = null;
  UI.knell = function (mark, line) {
    const el = $('knell');
    if (knellTimer) { clearTimeout(knellTimer.a); clearTimeout(knellTimer.b); }
    el.innerHTML = `<div class="knell-mark">${mark}</div><div class="knell-line">${line}</div>`;
    el.classList.remove('hidden', 'fade', 'ring');
    void el.offsetWidth;              // restart the animation even if it is already showing
    el.classList.add('ring');
    knellTimer = {
      a: setTimeout(() => el.classList.add('fade'), 2600),
      b: setTimeout(() => { el.classList.add('hidden'); el.classList.remove('fade', 'ring'); }, 3800)
    };
  };
  UI.banner = function (text, cls) {
    const wrap = $('banner-wrap');
    while (wrap.children.length >= 3) wrap.removeChild(wrap.firstChild);
    const b = document.createElement('div');
    b.className = 'banner ' + (cls || '');
    b.textContent = text;
    wrap.appendChild(b);
    setTimeout(() => { b.classList.add('fade'); setTimeout(() => b.remove(), 700); }, 3400);
  };

  /* ---------------- end screen ---------------- */
  /* `ready` false leaves the button showing but dead — a guest waiting on the host's rematch
   * needs to be told that is what is happening, not handed a button that does nothing. An
   * empty label means there is no next match to offer at all, so the button goes away. */
  UI.end = function (won, sub, nextLabel, ready) {
    /* a halt cannot survive the end of the match — it sits above the end screen */
    haltShown = null; $('halt').classList.add('hidden');
    $('hud').classList.add('hidden');
    UI.closeSheet();
    $('end').classList.remove('hidden');
    $('end-title').textContent = won ? 'THE THRONE IS YOURS' : 'THE SUCCESSION PASSES YOU BY';
    $('end-title').className = won ? 'won' : 'lost';
    $('end-sub').textContent = sub;
    const nx = $('end-next');
    nx.textContent = nextLabel || '';
    nx.classList.toggle('hidden', !nextLabel);
    nx.disabled = ready === false;
    $('end-copy').textContent = '📜 COPY THE CHRONICLE';
    $('end-save').textContent = 'SAVE';
    $('record-box').classList.add('hidden');
    const R = global.Rec;
    UI.stats(R && R.curves ? R.curves() : null, R && R.summary ? R.summary() : null);
  };

  /* ---------------- THE MUSTER ROLL ----------------
   * WHAT MAY BE RAISED, AND WHO IT RAISES. A fork is a permanent choice made mid-match, under
   * pressure, from a card the size of a thumb — so the place to learn what the choice MEANS is
   * not that card. This is the whole tree in one screen, read before the match rather than
   * during it.
   *
   * EVERY LINE OF IT COMES OUT OF `CONST`. The halls are whichever buildings carry a branch
   * table, the branches are whatever is in it, the men are `CONST.UNITS` entire — so a branch
   * added later appears here by itself, and one whose numbers move is never described wrongly.
   * A codex with its own copy of the numbers is worse than no codex. */
  const rollStat = (kind) => {
    const u = C.UNITS[kind];
    if (!u) return '';
    const dps = (u.dmg / u.atk).toFixed(1);
    const bits = [`${u.hp} hp`, `${u.dmg} blow · ${dps}/s`, `${u.range} reach`, `${u.speed} pace`];
    if (u.cost) bits.push(`◆ ${u.cost}`);
    /* the three flags decide what a man is FOR, so they are said in words rather than left
     * for a player to infer from a reach of 105 */
    const tags = [];
    if (u.siege) tags.push(`×${u.siege} vs stone`);
    if (u.menOnly) tags.push('besieges nothing · but strikes a Shrine');
    if (u.mans) tags.push(`holds a parapet, and shelters inside a tower (${C.TOWER.berths} to a tower)`);
    if (u.mend) tags.push(`mends ${u.mend}/s`);
    if (u.bind) tags.push('binds fiends');
    if (u.splash) tags.push(`splash ${u.splash}`);
    return `<span class="c-rate wide">${bits.join(' · ')}</span>` +
           (tags.length ? `<span class="c-rate up">${tags.join(' · ')}</span>` : '');
  };
  function unitRow(kind) {
    const u = C.UNITS[kind];
    return `<div class="card roll-unit"><span class="c-ico">${u.icon || '•'}</span>` +
           `<span class="c-name">${u.name || cap(kind)}</span>` +
           `<span class="c-cost">${u.cost ? '◆ ' + u.cost : ''}</span>` +
           `<span class="c-blurb">${u.blurb || ''}</span>${rollStat(kind)}</div>`;
  }
  UI.roll = function () {
    const body = $('roll-body');
    let h = '';
    /* the forking works, in the order the build sheet offers them */
    for (const bt of C.BUILD_ORDER_UI) {
      const d = C.BUILDINGS[bt];
      if (!d.branches) continue;
      h += `<div class="roll-hall"><div class="roll-head">${d.icon} ${d.name}` +
           `<b>◆ ${d.cost}</b></div><div class="roll-blurb">${d.blurb}</div>`;
      if (d.spawns) h += `<div class="roll-lv">Level 1 — ${C.UNITS[d.spawns].name}</div>` + unitRow(d.spawns);
      h += `<div class="roll-lv">Level ${d.fork} — choose once, and forever</div>`;
      for (const key of d.branchUI) {
        const b2 = d.branches[key];
        h += `<div class="card roll-branch"><span class="c-ico">${b2.icon}</span>` +
             `<span class="c-name">${b2.name}</span><span class="c-cost">◆ ${b2.cost}</span>` +
             `<span class="c-blurb">${b2.blurb}</span>` +
             (b2.spawns ? rollStat(b2.spawns) : branchStatLine(bt, key, d.fork)) + '</div>';
      }
      h += '</div>';
    }
    /* ...and everyone else you meet. The Champion comes off a Trump and the Fiend out of a
     * rift, so neither is under a hall — and a roll that left them out would be a roll of
     * what you can BUY rather than of what is on the board. */
    h += '<div class="roll-hall"><div class="roll-head">⚑ Every man in Amber</div>';
    for (const kind of Object.keys(C.UNITS)) h += unitRow(kind);
    h += '</div>';
    body.innerHTML = h;
    $('menu').classList.add('hidden');
    $('roll').classList.remove('hidden');
    body.scrollTop = 0;
    if (H.onRollOpen) H.onRollOpen();
  };
  UI.rollClose = function () {
    $('roll').classList.add('hidden');
    $('menu').classList.remove('hidden');
  };
  UI.rollOpen = () => !$('roll').classList.contains('hidden');

  /* ---------------- the match in curves ----------------
   * WHY THIS EXISTS. The chronicle answers "what happened" to anyone willing to read a table of
   * numbers; nobody reads a table of numbers on a phone the moment a match ends. The shapes do
   * the same work at a glance — an army that never recovered from one battle, an essence line
   * that flatlined at zero for four minutes, a rival's Gates outnumbering yours from 2:00 on.
   *
   * The SERIES are chosen in record.js because which numbers tell a match's story is a question
   * about the game. What is here is only the drawing: SVG rather than canvas because the end
   * screen is a DOM overlay, because it scales to any phone without a resize dance, and because
   * a test can then assert what was drawn instead of sampling pixels. */
  const SVGNS = 'http://www.w3.org/2000/svg';
  const svgEl = (n, at) => {
    const e = document.createElementNS(SVGNS, n);
    for (const k in at) e.setAttribute(k, at[k]);
    return e;
  };
  /* an axis label wants to read as a quantity, not as a float: 1247 → 1.2k */
  const brief = (v) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k'
    : v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10));

  const CH_W = 100, CH_H = 36, PAD_T = 3, PAD_B = 3;

  const peakOf = (s) => {
    let peak = 0;
    for (const line of s.lines) for (const v of line) if (v != null && v > peak) peak = v;
    return peak;
  };

  function chart(s, data, peak) {
    const card = document.createElement('div');
    card.className = 'stat-card';
    /* the ceiling of the chart, and it must be SHOWN: two charts of different heights side by
     * side are read as the same height unless the number says otherwise */
    const top = s.max || peak || 1;
    const head = document.createElement('div');
    head.className = 'stat-head';
    head.innerHTML = '<span>' + s.label + '</span><b>' + brief(top) + '</b>';
    card.appendChild(head);

    const svg = svgEl('svg', { viewBox: '0 0 ' + CH_W + ' ' + CH_H, preserveAspectRatio: 'none',
                               class: 'stat-svg', 'data-key': s.key });
    const n = data.t.length;
    const span = data.t[n - 1] - data.t[0] || 1;
    const X = (i) => (data.t[i] - data.t[0]) / span * CH_W;
    const Y = (v) => CH_H - PAD_B - Math.max(0, Math.min(1, v / top)) * (CH_H - PAD_T - PAD_B);
    svg.appendChild(svgEl('line', { x1: 0, y1: CH_H - PAD_B, x2: CH_W, y2: CH_H - PAD_B,
                                    class: 'stat-floor' }));
    data.seats.forEach((st, si) => {
      const line = s.lines[si];
      /* a toppled heir's values go null — draw each unbroken RUN as its own polyline so the
       * curve simply stops rather than diving to the floor and back */
      let run = [];
      const flush = () => {
        if (run.length > 1) {
          svg.appendChild(svgEl('polyline', {
            points: run.join(' '), fill: 'none', 'vector-effect': 'non-scaling-stroke',
            stroke: UI.seatColor(st.i, data.viewer), class: 'stat-line' + (st.you ? ' you' : ''),
            'data-seat': st.i
          }));
        } else if (run.length === 1) {   /* one lonely sample still deserves to be visible */
          const [x, y] = run[0].split(',');
          svg.appendChild(svgEl('circle', { cx: x, cy: y, r: 0.9, 'data-seat': st.i,
                                            fill: UI.seatColor(st.i, data.viewer) }));
        }
        run = [];
      };
      for (let i = 0; i < n; i++) {
        const v = line[i];
        if (v == null) { flush(); continue; }
        run.push(X(i).toFixed(2) + ',' + Y(v).toFixed(2));
      }
      flush();
    });
    card.appendChild(svg);
    return card;
  }

  UI.stats = function (data, sum) {
    const box = $('end-stats');
    box.textContent = '';
    box.classList.toggle('hidden', !data);
    $('end').classList.toggle('with-stats', !!data);
    if (!data) return;

    if (sum) {
      const dead = sum.deadFoe + sum.deadChaos;
      const facts = [
        ['LASTED', global.Rec.clock(sum.at)],
        ['PEAK ARMY', String(sum.peakArmy)],
        ['PEAK WORKS', String(sum.peakWorks)],
        ['YOUR DEAD', dead + (dead ? ' (' + Math.round(sum.deadChaos / dead * 100) + '% Chaos)' : '')],
        ['WORKS LOST', sum.lost + ' · razed ' + sum.razed],
        ['THE WALK', sum.walkStarted != null ? 'begun ' + global.Rec.clock(sum.walkStarted) : 'never']
      ];
      const strip = document.createElement('div');
      strip.className = 'stat-facts';
      strip.innerHTML = facts.map(([k, v]) => '<div><span>' + k + '</span><b>' + v + '</b></div>').join('');
      box.appendChild(strip);
    }

    const key = document.createElement('div');
    key.className = 'stat-key';
    for (const st of data.seats) {
      const chip = document.createElement('span');
      chip.style.color = UI.seatColor(st.i, data.viewer);
      chip.textContent = (st.won ? '♔ ' : '') + (st.you ? 'YOU' : String(st.name).split(',')[0]);
      key.appendChild(chip);
    }
    box.appendChild(key);

    const grid = document.createElement('div');
    grid.className = 'stat-grid';
    for (const s of data.series) {
      const peak = peakOf(s);
      /* a chart that is a flat zero for every seat is a chart about nothing — a match where
       * nobody walked should not spend a sixth of the panel saying so. And on a chart with a
       * FIXED ceiling the same is true a little above zero: an heir who brushed the Pattern
       * for three seconds draws a line indistinguishable from the floor, in a card the size of
       * the one showing the army. */
      if (peak <= 0 || (s.max && peak < s.max * 0.02)) continue;
      grid.appendChild(chart(s, data, peak));
    }
    box.appendChild(grid);

    /* every chart shares one x axis, so it is labelled once at the foot rather than seven
     * times — without it the shapes have no sense of WHEN, which is half of what they say */
    const span = document.createElement('div');
    span.className = 'stat-span';
    span.innerHTML = '<span>' + global.Rec.clock(data.t[0]) + '</span>' +
                     '<span>' + global.Rec.clock(data.t[data.t.length - 1]) + '</span>';
    box.appendChild(span);

    if (data.partial) {
      const note = document.createElement('p');
      note.className = 'stat-note';
      note.textContent = 'From your own snapshots: a rival\'s essence never crosses the wire, ' +
                         'and veiled works are not counted.';
      box.appendChild(note);
    }
  };

  /* ---------------- the chronicle ----------------
   * A match a human played leaves no trace, so every "the heir is too strong" has to be
   * argued from memory. These two buttons put the whole match somewhere it can be pasted
   * or attached. Clipboard first, because pasting is the point; a textarea if the browser
   * refuses (no secure context, no permission), because a refusal must not be a dead end. */
  const recordText = () => (global.Rec && global.Rec.text ? global.Rec.text() : 'AMBER — nothing recorded.');
  UI.copyRecord = function (btn) {
    const txt = recordText();
    btn = btn || $('end-copy');
    const fallback = () => {
      const ta = $('record-text');
      $('record-box').classList.remove('hidden');
      ta.value = txt;
      ta.focus(); ta.select();
      btn.textContent = 'SELECT IT ALL AND COPY';
    };
    if (!navigator.clipboard || !navigator.clipboard.writeText) return fallback();
    navigator.clipboard.writeText(txt)
      .then(() => { btn.textContent = '✓ COPIED — PASTE IT ANYWHERE'; })
      .catch(fallback);
  };
  UI.saveRecord = function () {
    const txt = recordText();
    const name = 'amber-' + (global.GAME_VERSION || 'x') + '-' + Date.now() + '.txt';
    try {
      const url = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }));
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      $('end-save').textContent = '✓ SAVED';
    } catch (e) { UI.copyRecord(); }
  };

  global.UI = UI;
})(typeof window !== 'undefined' ? window : globalThis);

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
  UI.flags = function (view, viewer, armed) {
    const tray = $('flag-tray');
    const me = view.players[viewer];
    /* ONE chip per company, not per hall: a dozen barracks under three standards is three
     * flags to think about, which is the whole point of companies */
    const cos = me.companies || [];
    const halls = (id) => me.buildings.filter((b) => C.BUILDINGS[b.bt] && C.BUILDINGS[b.bt].spawns && b.co === id).length;
    const rows = cos.map((co) => [co.id, !!co.rally, halls(co.id), !!co.trump]);
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
    for (const [id, afield, n, trump] of rows) {
      /* THE TRUMP IS NOT A DETACHMENT. It is one summoned Amberite who answers to nothing
       * else, so it gets the card rather than a pennant, and a colour no company can take. */
      const col = trump ? '#c48eff' : UI.coColor(id);
      const b = mk(id, trump ? '🃏' : '⚐', trump ? 'co trump' : 'co', col);
      b.title = trump ? 'the Champion you called through the Trump'
                      : n + (n === 1 ? ' hall' : ' halls');
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
    const total = Math.min(C.MASONS.max, C.MASONS.base + Math.floor(gates / C.MASONS.per));
    const free = Math.max(0, total - busy);
    const key = free + '/' + total;
    if (key === masonHash) return;
    masonHash = key;
    $('m-free').textContent = free;
    $('m-of').textContent = '/' + total;
    $('masons').classList.toggle('busy', free === 0);
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
    if (d.income) return `<span class="c-rate up">+${d.income[level - 1]}◆/s · +${d.nodeIncome[level - 1]}◆/s on a spring</span>`;
    /* A LEVEL BUYS BETTER MEN, NOT MORE OF THEM, so the card has to say what the men become
     * — the rate is the same at every level and quoting it would read as "no change". */
    if (d.spawns) {
      const u = C.UNITS[d.spawns], m = C.TIER[level - 1];
      const rank = C.TIER_NAME[level - 1];
      return `<span class="c-rate dn">−${(u.cost * m / d.period[level - 1]).toFixed(1)}◆/s muster</span>` +
             (level > 1 ? `<span class="c-rate up">${rank}${cap(d.spawns)}: ${Math.round(u.hp * m)} hp · ${+(u.dmg * m).toFixed(1)} blow</span>` : '');
    }
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

  function cardBody(d, bt, bad) {
    return `<span class="c-ico">${d.icon}</span><span class="c-name">${d.name}</span>` +
           `<span class="c-cost">◆ ${d.cost}</span>` +
           `<span class="c-blurb">${bad ? '<i>' + (WHY[bad] || bad) + '</i>' : d.blurb}` +
           `${bad || !d.raise ? '' : ' <b>· ' + d.raise + 's to raise</b>'}</span>${bad ? '' : rateTag(bt, 1)}`;
  }
  function buildCards(el, at, essence, why) {
    for (const bt of C.BUILD_ORDER_UI) {
      const d = C.BUILDINGS[bt];
      const bad = why ? why(bt) : null;
      const card = document.createElement('button');
      card.className = 'card' + (essence >= d.cost && !bad ? '' : ' locked');
      card.dataset.cost = d.cost;      // live affordability: UI.tick unlocks it as income catches up
      card.dataset.bt = bt;            // ...and re-asks the sim why, so a card can unlock in place
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
    /* the sheet remembers WHERE it was opened and HOW to ask, so the answer can change while
     * it is open: the masons finish, or a soldier finally reaches the spring, and the card
     * you are already looking at goes live without you closing and re-opening it */
    el._why = why || null;
  }
  const freshSheet = () => { const el = $('sheet'); el._why = null; el._raising = null; return el; };
  /* CHOOSE FIRST, PLACE SECOND. The sheet no longer belongs to a spot on the map — it is what
   * the BUILD button opens — so the cards cannot say why a particular patch of ground refuses
   * them. They say what a work costs and whether you can afford it; the ground answers when
   * you put it down, which is also when you can see where it is going. */
  UI.buildSheet = function (at, essence, why, me) {
    const el = freshSheet();
    el._me = me || null;
    el.innerHTML = `<div class="sheet-title">Raise a work ${trChip(essence)}</div>`;
    buildCards(el, at, essence, why);
    addCancel(el);
    el._openedAt = performance.now();
    el.classList.remove('hidden');
  };
  UI.armBuild = function (on) { $('btn-build').classList.toggle('armed', !!on); };

  /* a forked tower shows what it BECAME, not the generic name it was raised under */
  function towerFace(s) {
    const br = s.bt === 'tower' && s.br ? C.TOWER_BRANCHES[s.br] : null;
    return br ? { icon: br.icon, name: br.name, blurb: br.blurb } : C.BUILDINGS[s.bt];
  }
  /* what a level of a tower branch actually shoots — the numbers behind the bet */
  function towerStatLine(br, level) {
    const b2 = C.TOWER_BRANCHES[br], i = level - C.BUILDINGS.tower.fork;
    const dps = (b2.dmg[i] / b2.atk[i]).toFixed(1);
    return `<span class="c-rate wide">${b2.dmg[i]} dmg · ${dps}/s · ${b2.range[i]} range` +
           (b2.splash[i] ? ` · splash ${b2.splash[i]}` : ' · single target') + `</span>`;
  }

  const raiseLine = (s) => (s.work > 0
    ? `<b>🔨 The masons are raising it to level ${s.level} — ` +
      `${Math.round((1 - s.work / (s.workFor || 1)) * 100)}%, about ${Math.ceil(s.work)}s more.</b><br>` +
      'It stands and it can be broken, but it does its job for nobody until they are out of it.'
    : `<b>🔨 Rising — ${Math.round((1 - s.raise / (s.raiseFor || 1)) * 100)}%, about ${Math.ceil(s.raise)}s more.</b><br>` +
      'Until it is finished it earns nothing and holds no ground, and your masons can start nothing else.');
  UI.upSheet = function (s, essence, walking, me) {
    const d = C.BUILDINGS[s.bt], face = towerFace(s);
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
      addCancel(el);
      el._openedAt = performance.now();
      el.classList.remove('hidden');
      return;
    }
    /* A BREACHED CURTAIN offers one thing and it is not an upgrade: put the stone back. */
    if (s.breach) {
      const crews = s.crews || 1;
      const price = Math.round(C.BUILDINGS.wall.cost * crews * C.WALL.repair);
      const b = document.createElement('button');
      b.className = 'card' + (essence >= price ? '' : ' locked');
      b.dataset.cost = price;
      b.innerHTML = '<span class="c-ico">🧱</span><span class="c-name">Mend the breach</span>' +
                    `<span class="c-cost">◆ ${price}</span>` +
                    '<span class="c-blurb">A crew and half the stone. It shelters nobody until they are done.</span>';
      b.addEventListener('click', () => { if (b.classList.contains('locked')) return; H.onFix(s.id); UI.closeSheet(); });
      el.appendChild(b);
      addCancel(el);
      el._openedAt = performance.now();
      el.classList.remove('hidden');
      return;
    }
    /* the Watchtower fork: the level-2 upgrade is a CHOICE, offered as two cards */
    const forking = s.bt === 'tower' && !s.br && s.level + 1 === C.BUILDINGS.tower.fork;
    if (forking) {
      const hint = document.createElement('div');
      hint.className = 'sheet-blurb';
      hint.textContent = 'Rebuild the tower. Choose once — the choice does not come again.';
      el.appendChild(hint);
      for (const key of C.TOWER_BRANCH_UI) {
        const b2 = C.TOWER_BRANCHES[key];
        const cost = global.World.upgradeCost('tower', s.level, key);
        const b = document.createElement('button');
        b.className = 'card' + (essence >= cost ? '' : ' locked');
        b.dataset.cost = cost;
        b.innerHTML = `<span class="c-ico">${b2.icon}</span><span class="c-name">${b2.name}</span>` +
                      `<span class="c-cost">◆ ${cost}</span><span class="c-blurb">${b2.blurb}</span>` +
                      towerStatLine(key, C.BUILDINGS.tower.fork);
        b.addEventListener('click', () => { if (b.classList.contains('locked')) return; H.onUp(s.id, key); UI.closeSheet(); });
        el.appendChild(b);
      }
    } else if (s.level < C.MAX_LEVEL && (d.up || s.bt === 'tower')) {
      const cost = global.World.upgradeCost(s.bt, s.level, s.br);
      const can = essence >= cost;
      const b = document.createElement('button');
      b.className = 'card' + (can ? '' : ' locked');
      b.dataset.cost = cost;
      const forked = s.bt === 'tower' && !!s.br;
      const rt = forked ? towerStatLine(s.br, s.level + 1) : rateTag(s.bt, s.level + 1);
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
  };

  /* ---------------- map site sheet (v0.2) ---------------- */
  const KIND_BLURB = {
    node: 'A spring of living Shadow. Raise a Gate on it — your troops must be standing here — and it will pay for wars.',
    vantage: 'High ground over the paths. A Watchtower here sees far and shoots farther.',
    road: 'A milestone of the black road. Chaos favors this ground.',
    city: 'A Seat of Power.'
  };
  UI.siteSheet = function (site, st, viewer, essence, foeCity, pinfo, foeInfo, at, why) {
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
    /* raise a work right here — this is how a spring gets claimed */
    if (site.kind !== 'city' && at) {
      const hdr = document.createElement('div');
      hdr.className = 'sheet-blurb';
      hdr.innerHTML = '<b>Raise a work here</b>';
      el.appendChild(hdr);
      buildCards(el, at, essence, why);
    }
    addCancel(el);
    el._openedAt = performance.now();
    el.classList.remove('hidden');
  };

  function addCancel(el) {
    const c = document.createElement('button');
    c.className = 'card cancel'; c.textContent = 'Close';
    c.addEventListener('click', UI.closeSheet);
    el.appendChild(c);
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
        }
      }
      card.classList.toggle('locked', !!bad || essence < +card.dataset.cost);
    }
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

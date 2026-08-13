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
      /* NOTHING UNFOLDS ON THE MENU ANY MORE, so there is nothing left to close by tapping
       * away — the rivals and the LAN table are screens with a way back, like the chapters. */
    }, true);
    $('btn-campaign').addEventListener('click', () => H.onCampaign());
    $('btn-skirmish').addEventListener('click', () => UI.rivals());
    $('btn-lan').addEventListener('click', () => UI.lan());
    /* the Long War is one tap deep: the card resumes the saved war or begins one — the
     * ground IS the map now, so there is no screen between the menu and it */
    $('btn-realm').addEventListener('click', () => H.onRealm());
    /* ...and beginning ANEW is its own smaller act, shown only while a war is saved, armed
     * before it fires: a war played over many evenings must not die of one mistap */
    let newArm = 0;
    $('realm-new').addEventListener('click', () => {
      const b = $('realm-new');
      if (Date.now() - newArm < 3500) {
        newArm = 0;
        b.textContent = '⟲ Begin a new war';
        b.classList.remove('armed');
        H.onRealmNew();
        return;
      }
      newArm = Date.now();
      b.textContent = '⚠ The saved war will be LOST — tap again to begin anew';
      b.classList.add('armed');
      setTimeout(() => {
        if (Date.now() - newArm >= 3400) {
          b.textContent = '⟲ Begin a new war';
          b.classList.remove('armed');
        }
      }, 3600);
    });
    $('rivals-close').addEventListener('click', () => UI.screensClose());
    $('lan-close').addEventListener('click', () => UI.screensClose());
    $('btn-build').addEventListener('click', () => H.onBuildMenu());
    $('btn-pause').addEventListener('click', () => H.onPause());
    $('halt').addEventListener('click', () => H.onPause());
    /* the terms tray is rebuilt every time its picture changes, so the listener is on the TRAY
     * and not on the chips — a handler per chip would be a handler leaked per rebuild */
    $('terms').addEventListener('click', (e) => {
      const chip = e.target.closest ? e.target.closest('.term') : null;
      if (chip && chip.dataset.seat != null) H.onTerms(+chip.dataset.seat);
    });
    $('pw-storm').addEventListener('click', () => H.onPower('storm'));
    $('pw-trump').addEventListener('click', () => H.onPower('trump'));
    $('end-next').addEventListener('click', () => H.onEndNext());
    $('chapters-close').addEventListener('click', () => UI.chaptersClose());
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
    /* IT IS A SETTING AND IT SAYS SO. Three unlabelled pills between the title and the modes
     * read as three more ways to play — which is exactly the complaint the menu earned. */
    const lab = document.createElement('div');
    lab.className = 'set-label';
    lab.textContent = 'Your footing — how hard the heirs play';
    foot.appendChild(lab);
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
    $('rivals').classList.add('hidden');
    $('lan-screen').classList.add('hidden');
    /* THE CAMPAIGN CARD SAYS WHERE YOU ARE, in three lines rather than one long shouted one:
     * what it is, which chapter comes next, and how much of the succession is behind you. The
     * button used to carry the whole of that as its label — "THE SUCCESSION — VI · THE THRONE"
     * across two wrapped lines — with the progress as a stray row of ticks underneath it. */
    $('campaign-chapter').textContent = campaignLabel || '';
    $('campaign-note').textContent = campaignNote || '';
    /* the card RESUMES a saved war; abandoning one is a smaller act, offered only while
     * there is a war to abandon, and it says which act the card will take */
    const war = !!(global.REALM && global.REALM.saved && global.REALM.saved());
    $('realm-new').classList.toggle('hidden', !war);
    $('realm-new').textContent = '⟲ Begin a new war';
    $('realm-new').classList.remove('armed');
    $('realm-line').textContent = war
      ? 'Your war waits where you put it down — one tap resumes it.'
      : 'One land, sixteen thrones, one Pattern. Put it down and pick it up.';
    if (UI.paintFooting) UI.paintFooting();
    /* the match you WALKED OUT OF is often the one worth sending — a game that went badly
     * enough to abandon never reaches the end screen, so the chronicle is offered here too */
    const has = !!(global.Rec && global.Rec.recorded && global.Rec.recorded());
    const btn = $('menu-record');
    btn.classList.toggle('hidden', !has);
    btn.textContent = '📜 Chronicle of the last match';
    $('record-box').classList.add('hidden');
  };
  /* ---------------- the screens that sit over the menu ----------------
   * The chapters have had one since the campaign shipped, and the reason generalises: anything
   * with a SECOND STEP is a screen, not a fold-out. A fold-out pushes the rest of the menu down
   * the page, so choosing between five rivals buried the LAN table and the codex; and it gave
   * every one of those rivals the shape of a mode. */
  UI.rivals = function () {
    const body = $('rivals-body');
    const H2 = global.AI.HEIRS;
    /* WEAKEST FIRST, which is the campaign's own order (`Game.LADDER`, set by the referee) —
     * the one thing a menu of five names owes a player who has not met any of them. */
    const order = (global.Game && global.Game.LADDER || Object.keys(H2)).filter((k) => H2[k]);
    for (const k of Object.keys(H2)) if (order.indexOf(k) < 0) order.push(k);
    body.innerHTML = order.map((k, i) => {
      const h = H2[k];
      return `<button class="card rival" data-heir="${k}">` +
             `<span class="c-name">${h.title}</span>` +
             `<span class="c-rate">${i === 0 ? 'the gentlest' : i === order.length - 1 ? 'the hardest' : ''}</span>` +
             `<span class="c-blurb">${h.blurb || ''}</span></button>`;
    }).join('');
    for (const b of body.querySelectorAll('.rival'))
      b.addEventListener('click', () => { $('rivals').classList.add('hidden'); H.onSkirmish(b.dataset.heir); });
    UI.toMenuScreens();
    $('rivals').classList.remove('hidden');
    body.scrollTop = 0;
  };
  UI.lan = function () {
    UI.toMenuScreens();
    $('lan-screen').classList.remove('hidden');
    if (H.onLanOpen) H.onLanOpen();
  };
  UI.screensOpen = () => !$('rivals').classList.contains('hidden')
                      || !$('lan-screen').classList.contains('hidden');
  UI.screensClose = function () {
    $('rivals').classList.add('hidden');
    $('lan-screen').classList.add('hidden');
    $('menu').classList.remove('hidden');
  };
  /* ---------------- the campaign ----------------
   * A CHAPTER SCREEN AND A BRIEFING, in one panel, because they are one gesture: pick the
   * chapter, read what is being asked, begin. The objective is stated BEFORE the board is —
   * which is what makes a varied win condition legible instead of confusing, and is the thing
   * worth taking from how this was done before there were tutorials.
   * It reuses the Muster Roll's shape (a full-screen scrolling panel with a heading, a
   * generated body and a way out) and the build sheet's cards, so a chapter card is a `.card`
   * with `.locked` on it exactly as an unaffordable work is. */
  UI.toMenuScreens = function () {
    $('halt').classList.add('hidden');
    $('hud').classList.add('hidden');
    $('end').classList.add('hidden');
    $('menu').classList.add('hidden');
    UI.closeSheet();
  };
  UI.chaptersOpen = () => !$('chapters').classList.contains('hidden');
  /* which chapter's briefing is up, or null for the list. The phone's back gesture reads it:
   * out of a BRIEFING is back to the list, not out to the menu — the level you are reading
   * about is one you have not decided against yet. */
  let briefing = null;
  UI.chaptersClose = function () {
    if (briefing) { const CAM = global.CAMPAIGN; briefing = null; UI.chapters(CAM, null); return; }
    $('chapters').classList.add('hidden');
    if (UI.showMenu && H.onMenuAgain) H.onMenuAgain();
  };
  UI.chapters = function (CAM, focus) {
    const el = $('chapters'), body = $('chapters-body');
    el.classList.remove('hidden');
    if (focus) return UI.brief(CAM, focus);
    briefing = null;
    /* the LIST is the only place the way out to the menu is needed, and the only place it is
     * offered: on a briefing THE OTHER CHAPTERS is already the way back, and two buttons that
     * both mean "not this" is one button too many */
    $('chapters-close').classList.remove('hidden');
    $('chapters-title').textContent = 'THE SUCCESSION';
    body.innerHTML = '';
    for (const ch of CAM.CHAPTERS) {
      const open = CAM.open(ch.key), done = CAM.cleared(ch.key);
      const b = document.createElement('button');
      b.className = 'card chapter' + (open ? '' : ' locked') + (done ? ' cleared' : '');
      b.dataset.key = ch.key;
      b.innerHTML = `<span class="c-ico">${done ? '✔' : open ? '❖' : '🔒'}</span>` +
                    `<span class="c-name">${ch.title}</span>` +
                    `<span class="c-blurb">${open ? ch.brief.split('\n')[0]
                       : 'Sealed until the chapter before it is done.'}</span>`;
      if (open) b.addEventListener('click', () => UI.brief(CAM, ch.key));
      body.appendChild(b);
    }
  };
  /* THE BRIEFING. Prose, then the one sentence of what is being asked, then BEGIN. The chapter
   * list is one tap behind it, because a briefing you cannot back out of is a trap. */
  UI.brief = function (CAM, key) {
    const ch = CAM.byKey(key);
    if (!ch) return;
    const body = $('chapters-body');
    $('chapters').classList.remove('hidden');
    briefing = ch.key;
    $('chapters-close').classList.add('hidden');
    $('chapters-title').textContent = ch.title.toUpperCase();
    body.innerHTML = '';
    const p = document.createElement('div');
    p.className = 'brief';
    p.innerHTML = ch.brief.split('\n\n').map((q) => `<p>${q.replace(/\n/g, '<br>')}</p>`).join('');
    body.appendChild(p);
    const ob = document.createElement('div');
    ob.className = 'brief-obj';
    /* THE OBJECTIVE'S OWN SENTENCE, not its readout. This used to hand `line` a fabricated
     * world — two empty players and nothing else — and the day an objective looked past a
     * building list it threw where it stood, taking the BEGIN button and the way back with it.
     * A briefing has no world. See `ask` in campaign.js. */
    ob.textContent = '❖ ' + (ch.obj.ask || '');
    body.appendChild(ob);
    const go = document.createElement('button');
    go.className = 'mbtn';
    go.id = 'chapter-begin';
    go.textContent = 'BEGIN';
    go.addEventListener('click', () => {
      briefing = null;
      $('chapters').classList.add('hidden');
      $('chapters-close').classList.remove('hidden');
      H.onChapter(ch.key);
    });
    body.appendChild(go);
    const back = document.createElement('button');
    back.className = 'mbtn small';
    back.id = 'chapter-back';
    back.textContent = 'THE OTHER CHAPTERS';
    back.addEventListener('click', () => UI.chapters(CAM, null));
    body.appendChild(back);
  };
  /* WHAT THE CHAPTER IS ASKING, on the board, for as long as it is true. A briefing is read
   * once; an objective has to be answerable at a glance three minutes later. */
  let objShown = null;
  UI.objective = function (text) {
    const el = $('objective');
    if (!el) return;
    if (text === objShown) return;
    objShown = text;
    el.textContent = text || '';
    el.classList.toggle('hidden', !text);
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
    /* THE CHIPS AND THE ROSTER ARE REBUILT ON DIFFERENT CLOCKS. A chip changes when a company
     * is raised, posted or silenced — rarely. What is UNDER it changes every time a man falls,
     * which in a fight is several times a second, and rebuilding the buttons at that rate
     * throws away the browser's own touch tracking mid-tap. So the early-out guards the chips
     * only, and the roster below runs every frame it is asked to. */
    if (hash !== trayHash) {
    trayHash = hash;
    tray.innerHTML = '';
    /* ONE ROW PER COMPANY, STACKING UP THE LEFT EDGE. The chips used to be a wrapping row:
     * with three standards out the second line pushed the essence readout around, the HOLD
     * button landed wherever the wrap happened to leave it, and the roster sat after the last
     * chip rather than beside the one it described. A column answers all three — every
     * company keeps a fixed place, a new one appears ABOVE the old ones instead of moving
     * them, and the row is a natural home for the things that belong to the armed standard
     * and nothing else. `column-reverse` in the CSS is what puts the first company nearest
     * the thumb while the DOM stays in company order. */
    const mk = (id, glyph, cls, color) => {
      const row = document.createElement('div');
      row.className = 'frow' + (armed === id ? ' armed' : '');
      const b = document.createElement('button');
      b.className = 'fbtn ' + cls + (armed === id ? ' armed' : '');
      b.innerHTML = glyph;
      if (color) b.style.color = color;
      b.addEventListener('click', () => H.onFlagArm(id));
      row.appendChild(b);
      tray.appendChild(row);
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
    }
    /* WHAT IS ACTUALLY UNDER THE FLAG. A chip says a company exists and whether it is afield.
     * It says nothing about what is IN it — and "should I send this one" is a question about
     * archers or rams, never about a colour. So the armed standard shows its roster beside it:
     * one icon per kind with a count, the biggest first, read straight off the view. The icons
     * are the table's own (`CONST.UNITS[k].icon`), so a kind added later appears here with no
     * code at all — the same contract the Muster Roll runs on. */
    let roster = $('flag-roster');
    if (!roster) {
      roster = document.createElement('span');
      roster.id = 'flag-roster';
    }
    const row = tray.querySelector('.frow.armed');
    let rtxt = '';
    if (typeof armed === 'number' && row) {
      const n = new Map();
      for (const u of view.units) if (u.owner === viewer && u.co === armed) n.set(u.kind, (n.get(u.kind) || 0) + 1);
      rtxt = [...n].sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1))
        /* U+2060 between the icon and its count. The roster wraps, and a browser will break
         * between an emoji and a digit given the chance — "💣" at the end of one line and its
         * "1" at the start of the next reads as two different facts. A word joiner is the one
         * character that says these two are a word. */
        .map(([k, c]) => ((C.UNITS[k] && C.UNITS[k].icon) || '•') + '\u2060' + c).join(' ');
      /* a standard with nobody under it is worth saying out loud — it is the difference
       * between "they are on their way" and "there is nobody to send" */
      if (!rtxt) rtxt = '— no men';
    }
    if (roster.textContent !== rtxt) roster.textContent = rtxt;
    /* BESIDE THE FLAG IT DESCRIBES, not at the end of the tray. Re-parented rather than
     * rebuilt: the text changes every time a man falls and the node is the same node. */
    if (rtxt && row) { if (roster.parentNode !== row) row.appendChild(roster); }
    else if (roster.parentNode) roster.remove();
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
     * is a public act and the whole table is owed the count. Yours is marked.
     * GROUND ALREADY PAID FOR STAYS ON THE BOARD. This filtered on `q.walking`, and the one
     * thing that can turn that off is a Shrine thrown down — so the heir who had banked 60%
     * and just lost his Shrine to an assault DISAPPEARED from every board at the table,
     * reading as though he had never set foot on it. He has not: `breakLoss` takes its cut and
     * the rest is his, and the moment he raises another Shrine he carries on from there. So a
     * revealed heir is listed while he has ANY ground, and the ✴ goes dim when he is off the
     * lines. Nothing new crosses the wire for it — `pattern` already rides for a revealed
     * heir whether he is walking or not (`net.js`), which is precisely why the board could
     * afford to be wrong about it in silence. */
    const race = $('walkers');
    const on = view.players.map((q, pi) => ({ q, pi }))
      .filter(({ q, pi }) => !q.out && (q.walking || q.pattern > 0) && (pi === viewer || q.revealed))
      .sort((a, b) => b.q.pattern - a.q.pattern);
    const key = on.map(({ q, pi }) => pi + ':' + q.pattern.toFixed(0) + (q.walking ? 'w' : 's')).join(',');
    if (key !== race._key) {
      race._key = key;
      race.innerHTML = '';
      for (const { q, pi } of on) {
        const d = document.createElement('div');
        d.className = 'walker' + (pi === viewer ? ' mine' : '') + (q.walking ? '' : ' stalled');
        d.style.color = UI.seatColor(pi, viewer);
        d.textContent = (q.walking ? '✴ ' : '✧ ') +
                        (pi === viewer ? 'YOU'
                          : ((UI.names && UI.names[pi]) || C.SEAT_NAMES[pi] || 'a rival').toUpperCase()) +
                        ' ' + q.pattern.toFixed(0) + '%';
        race.appendChild(d);
      }
    }
    /* ---- TERMS ----
     * One chip per living rival, and each says exactly one of four things. The state is derived
     * from the two OFFERS and never stored, which is the same rule the sim keeps: a pact is the
     * AND of them, so there is nothing here that can disagree with `World.pactOn`.
     * Rebuilt only when the picture changes, like the board above it — this runs every frame. */
    const tray = $('terms');
    const truce = !!(view.rules && view.rules.truce);
    tray.classList.toggle('hidden', !truce);
    /* it hangs off the bottom of the walkers' board, which grows and shrinks as heirs step on
     * and off the lines — so the offset is measured rather than written down */
    if (truce) {
      const rb = race.getBoundingClientRect();
      tray.style.top = (race.children.length ? Math.ceil(rb.bottom) + 6 : Math.ceil(rb.top)) + 'px';
    }
    if (truce) {
      const mineOffers = (view.players[viewer] || {}).offers || [];
      let rows = view.players.map((q, pi) => ({ q, pi }))
        .filter(({ q, pi }) => pi !== viewer && !q.out);
      /* A COUNTRY'S TABLE SEATS SIXTEEN, and fifteen chips is a wall over half the map.
       * In a reach war the tray shows the rivals the war is actually AGAINST — anyone
       * across a border from a city of yours — plus every rival an offer or a pact stands
       * with, which must never be hidden behind a filter. A duel's tray is unchanged. */
      if (view.rules.reach && view.cities && view.map && view.map.gen && view.map.gen.nbrs) {
        const fronts = new Set();
        view.cities.forEach((c, ci) => {
          if (c.owner !== viewer) return;
          for (const b of view.map.gen.nbrs[ci] || []) {
            const o = view.cities[b] ? view.cities[b].owner : null;
            if (o != null && o >= 0 && o !== viewer) fronts.add(o);
          }
        });
        rows = rows.filter(({ q, pi }) => fronts.has(pi) || mineOffers[pi] || (q.offers || [])[viewer]);
      }
      const tkey = rows.map(({ q, pi }) => pi + (mineOffers[pi] ? 'm' : '') +
                                           ((q.offers || [])[viewer] ? 'h' : '')).join(',');
      if (tkey !== tray._key) {
        tray._key = tkey;
        tray.innerHTML = '';
        for (const { q, pi } of rows) {
          const mine2 = !!mineOffers[pi], his = !!(q.offers || [])[viewer];
          const d = document.createElement('div');
          d.className = 'term' + (mine2 && his ? ' sealed' : his ? ' asked' : mine2 ? ' offered' : '');
          d.dataset.seat = String(pi);
          const nm = document.createElement('b');
          nm.style.color = UI.seatColor(pi, viewer);
          /* the match's own names — at a country's table a seat IS a city, and 'A RIVAL'
           * fifteen times over said nothing about any of them */
          nm.textContent = ((UI.names && UI.names[pi]) || C.SEAT_NAMES[pi] || 'a rival').toUpperCase();
          const st = document.createElement('span');
          st.className = 't-state';
          /* what the NEXT tap does is what the chip has to make obvious, so each line is
           * written as the state and the tap reads as its opposite */
          st.textContent = mine2 && his ? '⚑ at terms — tap to break'
                         : his ? 'asks terms — tap to accept'
                         : mine2 ? 'terms offered' : 'at war — tap to offer';
          d.appendChild(nm); d.appendChild(st);
          tray.appendChild(d);
        }
      }
    } else if (tray._key !== null) { tray._key = null; tray.innerHTML = ''; }
    /* tell the map how far down to start, so it clears BOTH right-rail boards. Measured rather
     * than summed: the terms tray is laid out under the walkers by the stylesheet, and a guess
     * at its height is a guess that goes wrong the first time a fourth heir joins. */
    if (global.Render) {
      const rb = race.getBoundingClientRect(), tb = tray.getBoundingClientRect();
      const low = Math.max(race.children.length ? rb.bottom : 0, truce && tray.children.length ? tb.bottom : 0);
      global.Render.miniTop = low > 0 ? Math.ceil(low) + 6 : 0;
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
    crews: 'longer than your masons reach — hold more Gates, or draw a shorter run',
    /* the Reach War's own refusal: the outer bound every work answers to */
    reach: 'beyond your cities’ reach — take a city nearer to it'
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
  /* ---- A PRICED CARD, WRITTEN ONCE ----
   * Six places built the same button: `card` plus `locked` when the purse is short, the price
   * and crew count on the dataset so `UI.tick` can unlock it in place as income catches up, the
   * same four spans, and a click that must remember to refuse itself while locked. Six copies
   * of an affordability rule is five chances to forget the guard — and `dataset.cost` is not
   * decoration, it is what makes a card go live while you are looking at it.
   * `extra` is whatever the caller wants after the blurb — a stat line, a branch's numbers —
   * and `above` the same thing before it. Both exist because the card is a GRID that places by
   * DOM order, and the two cards that carry a rate tag have always disagreed about where it
   * goes: an upgrade shows its rate above the masonry blurb, a branch shows its numbers under
   * its own prose. Consolidating the builder is not a licence to restyle them. */
  function costCard(el, { icon, name, cost, blurb, extra, above, crew, essence, id }, onPick) {
    const b = document.createElement('button');
    b.className = 'card' + (essence >= cost ? '' : ' locked');
    if (id) b.id = id;
    b.dataset.cost = cost;
    b.dataset.crew = crew == null ? '1' : String(crew);
    b.innerHTML = (icon ? `<span class="c-ico">${icon}</span>` : '') +
                  `<span class="c-name">${name}</span>` +
                  `<span class="c-cost">◆ ${cost}</span>` + (above || '') +
                  (blurb ? `<span class="c-blurb">${blurb}</span>` : '') + (extra || '');
    b.addEventListener('click', () => { if (b.classList.contains('locked')) return; onPick(); });
    el.appendChild(b);
    return b;
  }
  /* every sheet ends the same way: a way out, the fat-finger stamp, and the panel shown */
  function showSheet(el, essence) {
    addCancel(el);
    el._openedAt = performance.now();
    el.classList.remove('hidden');
    if (essence != null) UI.tick(essence);   // grey it on the frame it opens, not the one after
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
    showSheet(el, essence);
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
    /* `keep` on the line, because the drain beside it STOPS when the hall is full — a hall's
     * standing cost is the muster rate only until its company stands complete, and a card
     * that quoted the drain without the ceiling read as a bill that never ends */
    return `<span class="c-rate dn">−${(u.cost * m / period).toFixed(1)}◆/s muster` +
           (u.keep ? ` · keeps ${u.keep}` : '') + `</span>` +
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
    /* ---- WHOSE STANDARD THIS HALL MUSTERS INTO, IN THE HEADER ----
     * It used to be a line of small print near the bottom of the sheet, under the upgrade card
     * and the valve — and it was not there AT ALL while the hall was being raised or re-tooled,
     * because that path returns early with nothing but the countdown. Which is exactly when you
     * want it: a hall under the masons is a hall you are deciding about, and "which company do
     * these men join" is the first question, not the last. So it goes at the top, in the
     * company's own colour with its pennant beside it, before anything can return. */
    if (d.spawns && me) {
      const co0 = (me.companies || []).find((q) => q.id === s.co) || null;
      const f = document.createElement('div');
      f.className = 'sheet-flag';
      f.innerHTML = co0
        ? `<span class="sf-pip" style="background:${UI.coColor(co0.id)}"></span>` +
          `<span class="sf-name" style="color:${UI.coColor(co0.id)}">⚐ Standard ${co0.id}</span>` +
          `<span class="sf-note">${co0.paused ? 'mustering nobody'
            : co0.rally ? 'posted afield' : 'holding at home'}</span>`
        : '<span class="sf-name">⚐ No standard yet</span>';
      el.appendChild(f);
      /* ---- AND THE VALVE RIDES WITH IT ----
       * Halting a standard's muster is the one order on this sheet you give in a hurry — the
       * treasury is draining into recruits you would rather bank — and it was the third card
       * down, under an upgrade you were not asking about, and MISSING ENTIRELY while the hall
       * was under the masons. It belongs beside the flag it acts on, above everything, and it
       * belongs there whatever the hall is doing: a company's other halls go on mustering
       * while this one is being re-tooled, which is exactly when you might want them quiet. */
      if (co0) {
        const mu = document.createElement('button');
        mu.className = 'card';
        mu.id = 'co-muster';
        mu.innerHTML = co0.paused
          ? `<span class="c-ico">▶</span><span class="c-name">Resume Standard ${co0.id}</span>` +
            '<span class="c-blurb">Its halls pay for troops again</span>'
          : `<span class="c-ico">⏸</span><span class="c-name">Halt Standard ${co0.id}</span>` +
            '<span class="c-blurb">Every hall under this standard stops mustering — the rest of the realm carries on</span>';
        mu.addEventListener('click', () => { H.onMusterCo(co0.id, !co0.paused); UI.closeSheet(); });
        el.appendChild(mu);
      }
    }
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
      showSheet(el);
      return;
    }
    /* A BREACHED CURTAIN offers one thing and it is not an upgrade: put the stone back. */
    if (s.breach) {
      const size = s.units != null ? s.units : (s.crews || 1);   // stone, not crews
      const price = Math.max(1, Math.round(C.BUILDINGS.wall.cost * size * C.WALL.repair));
      costCard(el, { icon: '🧱', name: 'Mend the breach', cost: price, essence,
                     blurb: 'Half the stone, and as many crews as you can spare — fewer crews, ' +
                            'longer work. It shelters nobody until they are done.' },
               () => { H.onFix(s.id); UI.closeSheet(); });
      showSheet(el, essence);
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
        costCard(el, { icon: b2.icon, name: b2.name, cost, essence, blurb: b2.blurb,
                       extra: branchStatLine(s.bt, key, fork) },
                 () => { H.onUp(s.id, key); UI.closeSheet(); });
      }
    } else if (s.level < C.MAX_LEVEL && (d.up || d.branches)) {
      const cost = global.World.upgradeCost(s.bt, s.level, s.br);
      const forked = !!s.br;
      const rt = forked ? branchStatLine(s.bt, s.br, s.level + 1) : rateTag(s.bt, s.level + 1);
      /* AN UPGRADE IS MASONRY. It takes a crew and it takes time, and the work does its job
       * for nobody meanwhile — a hall musters nothing, a tower does not shoot, a Gate draws
       * nothing. Saying so on the card is the difference between a decision and a surprise. */
      const secs = Math.round(Math.max(1, (d.raise || 10) * C.UP_WORK));
      const quiet = d.spawns ? 'musters nobody' : s.bt === 'tower' ? 'does not shoot'
        : s.bt === 'gate' ? 'draws nothing' : 'stands idle';
      costCard(el, { name: `Upgrade to level ${s.level + 1}`, cost, essence,
                     blurb: `🔨 ${secs}s of masonry — it ${quiet} until they are done, and a ` +
                            'crew of yours is on it.',
                     above: rt ? (forked ? rt : rt.replace('c-rate', 'c-rate wide')) : '' },
               () => { H.onUp(s.id, s.br); UI.closeSheet(); });
    }
    if (d.spawns && me) {
      const co = (me.companies || []).find((q) => q.id === s.co) || null;
      /* (the standard AND its muster valve are in the HEADER now — see the top of this
       * function. The valve was the one order here given in a hurry, and it was third card
       * down and absent while the masons were on the hall.) */
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
      /* A WALK CANNOT BE CALLED OFF. `{c:'walk',on:false}` is refused with 'committed', so the
       * old "⏸ Pause the walk" card was a button that issued an order the sim threw away — the
       * worst kind of control, one that looks live and does nothing. While walking this is a
       * READOUT, not a button: it says the thing the player most needs to know, which is that
       * the choice is already made and the only ways off the lines are winning or losing the
       * Shrine. Only the invitation to START is still something you can press. */
      const b = document.createElement('button');
      b.className = 'card walkbtn';
      if (walking) {
        b.disabled = true;
        b.innerHTML = '<span class="c-name">✴ Walking the Pattern</span>' +
                      '<span class="c-blurb">The lines will not let go. Only the Pattern finished — or this Shrine thrown down — ends the walk.</span>';
      } else {
        b.innerHTML = '<span class="c-name">✴ Walk the Pattern</span>' +
                      '<span class="c-blurb">Drains Essence, and the drain comes before your halls are paid. Your rival WILL know. There is no turning back.</span>';
        b.addEventListener('click', () => { H.onWalk(true); UI.closeSheet(); });
      }
      el.appendChild(b);
    }
    showSheet(el, essence);
  };

  /* ---------------- map site sheet (v0.2) ---------------- */
  const KIND_BLURB = {
    node: 'A spring of living Shadow. Raise a Gate on it — your troops must be standing here — and it will pay for wars.',
    vantage: 'High ground over the paths. A Watchtower here sees far and shoots farther.',
    road: 'A milestone of the black road. Chaos favors this ground.',
    city: 'A Seat of Power.'
  };
  UI.siteSheet = function (site, st, viewer, essence, foeCity, pinfo, foeInfo, war) {
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
      /* ---- THE WAR'S COMMAND OF A CITY ----
       * A held court that is not the seat of command offers two things: TAKE COMMAND (the
       * seat moves here; a steward is appointed over the one just left) and the STEWARD'S
       * ORDER — hold, raise Gates, wall up, attack a neighbour, support another city. The
       * seat itself offers neither: the player IS its steward. */
      if (war && war.mine && !war.isSeat) {
        const tk = document.createElement('button');
        tk.className = 'card walkbtn';
        tk.innerHTML = '<span class="c-name">👑 Take Command Here</span>' +
                       '<span class="c-blurb">Rule the war from this court — a steward keeps your former seat</span>';
        tk.addEventListener('click', () => { H.onTakeSeat(war.id); UI.closeSheet(); });
        el.appendChild(tk);

        const lbl = document.createElement('div');
        lbl.className = 'sheet-blurb';
        const sayOrder = (o) => !o ? 'no steward — the court waits on your own orders'
          : o.mode === 'attack' ? 'steward: march on ' + ((war.nbrs.find((n) => n.idx === o.target) || {}).name || 'a neighbour')
          : o.mode === 'support' ? 'steward: support ' + ((war.own.find((n) => n.idx === o.target) || {}).name || 'a city')
          : o.mode === 'gates' ? 'steward: raise Shadow Gates'
          : o.mode === 'walls' ? 'steward: fortify the court'
          : 'steward: hold the city';
        lbl.textContent = '⚑ ' + sayOrder(war.steward);
        el.appendChild(lbl);

        const row = document.createElement('div');
        row.className = 'lan-row';
        const btn = (txt, fn) => {
          const b = document.createElement('button');
          b.className = 'mbtn small';
          b.textContent = txt;
          b.addEventListener('click', fn);
          row.appendChild(b);
        };
        const set = (mode, target) => () => { H.onSteward(war.idx, mode, target); UI.closeSheet(); };
        btn('HOLD', set('hold'));
        btn('GATES', set('gates'));
        btn('WALL UP', set('walls'));
        el.appendChild(row);
        /* the orders that need a NAME get one row each — a picker inside a picker on a phone
         * is a maze, and there are only ever a handful of neighbours */
        const foes2 = war.nbrs.filter((n) => n.owner !== viewer);
        if (foes2.length) {
          const row2 = document.createElement('div');
          row2.className = 'lan-row';
          for (const n of foes2.slice(0, 3)) {
            const b = document.createElement('button');
            b.className = 'mbtn small';
            b.textContent = '⚔ ' + n.name;
            b.addEventListener('click', set('attack', n.idx));
            row2.appendChild(b);
          }
          el.appendChild(row2);
        }
        if (war.own.length) {
          const row3 = document.createElement('div');
          row3.className = 'lan-row';
          for (const n of war.own.slice(0, 3)) {
            const b = document.createElement('button');
            b.className = 'mbtn small';
            b.textContent = '🛡 ' + n.name;
            b.addEventListener('click', set('support', n.idx));
            row3.appendChild(b);
          }
          el.appendChild(row3);
        }
      } else if (war && war.mine && war.isSeat) {
        const here = document.createElement('div');
        here.className = 'sheet-blurb';
        here.textContent = '👑 You command the war from this court.';
        el.appendChild(here);
      }
    }
    /* AND NOTHING TO BUILD. This sheet used to carry the whole build tray, because there was a
     * time when a tap on the ground was how you raised a work — but building is CHOOSE THEN
     * PLACE now: the 🔨 button arms a work and the next tap on the map puts it down. Leaving
     * the cards here left two contradictory ways to build, one of which ignored the armed
     * work you were already holding. A site says what it IS and who holds it; the button
     * raises things. */
    showSheet(el, essence);
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
  /* THE FIELDS ARE THE SOURCE, NOT A LIST OF MECHANICS SOMEBODY REMEMBERED. This was six
   * hand-written `if (u.siege)` lines, which has the failure the whole codex exists to avoid in
   * both directions: a mechanic the sim drops keeps being advertised until somebody deletes the
   * line, and a mechanic the sim GAINS is silently missing from the Roll until somebody adds
   * one. So the line is driven off the unit def's OWN KEYS — everything that is not one of the
   * base numbers already said above becomes a tag. `SAY` gives the ones we have words for their
   * words; anything else is stated plainly as the field and its value, which is honest about a
   * number nobody has written prose for yet and, crucially, is never SILENT about it. */
  const BASE_KEYS = new Set(['name', 'icon', 'blurb', 'hp', 'dmg', 'atk', 'range',
                             'speed', 'aggro', 'bounty', 'size', 'cost', 'keep']);
  /* a key whose value is said as part of another key's phrase: it must not be said twice */
  const FOLDED = new Set(['mendR', 'bindR', 'splashFrac']);
  const SAY = {
    siege: (v) => `×${v} vs stone`,
    menOnly: () => 'besieges nothing · but strikes a Shrine',
    mans: () => `holds a parapet, and shelters inside a tower (${C.TOWER.berths} to a tower)`,
    mend: (v, u) => `mends ${v}/s` + (u.mendR ? ` out to ${u.mendR}` : ''),
    bind: (v, u) => 'throws chains' + (u.bindR ? ` out to ${u.bindR}` : ''),
    bindHp: (v) => `a fiend already under ${Math.round(v * 100)}% of its life turns instead`,
    /* the Binding's three numbers, each said by ITS OWN key: drop one from the table and its
     * sentence goes with it, and nothing else in the line has to be rewritten */
    hexT: (v) => `the chains hold ${v}s`,
    hexSlow: (v) => `a chained man marches at ${Math.round(v * 100)}% pace`,
    hexAmp: (v) => `…and takes ×${v} from every blow`,
    hexCd: (v) => `a throw every ${v}s, in place of his shot`,
    splash: (v, u) => `splash ${v}` + (u.splashFrac ? ` at ${Math.round(u.splashFrac * 100)}%` : '')
  };
  /* a field with no words yet, said as itself: 'hexSlow' 0.4 → "hex slow 0.4". Ugly on purpose
   * — it is a prompt to write the sentence, not a substitute for one — and never wrong. */
  const plainly = (k, v) => k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase() +
                            (v === true ? '' : ' ' + v);
  /* ---- WHAT A LEVEL CHANGES, AND WHAT IT DOES NOT ----
   * `CONST.TIER` scales exactly four things — hit points, blow, price and bounty — and leaves
   * reach, pace, the interval between blows and a hall's ceiling alone. So when a man has a
   * LEVEL TABLE above him, the scaled numbers belong to it and nowhere else: printed here as
   * well they are printed at tier one, which for a branch's recruit is a man the game never
   * musters. Reported from play, and it was as bad as it sounds — the Shieldman's table said
   * 160 hp · 16.3 blow · ◆38 and the line under it said 128 · 13 · ◆30, about the same man,
   * two lines apart. `scaled` is false for the men with no hall and no upgrades (the Champion
   * off a Trump, the Fiend out of a rift), who have one set of numbers and need them said. */
  const rollStat = (kind, scaled) => {
    const u = C.UNITS[kind];
    if (!u) return '';
    const bits = [];
    if (!scaled) {
      bits.push(`${u.hp} hp`, `${u.dmg} blow`);
      if (u.cost) bits.push(`◆ ${u.cost}`);
    }
    bits.push(`${u.range} reach`, `${u.speed} pace`, `a blow every ${u.atk}s`);
    /* the hall's ceiling belongs here rather than in the table: it is the same at every level,
     * and it is the number that says what a hall is worth */
    if (u.keep) bits.push(`${u.keep} to a hall`);
    const tags = [];
    for (const k of Object.keys(u)) {
      if (BASE_KEYS.has(k) || FOLDED.has(k)) continue;
      const v = u[k];
      if (v === false || v === 0 || v == null) continue;
      tags.push(SAY[k] ? SAY[k](v, u) : plainly(k, v));
    }
    return `<span class="c-rate wide">${bits.join(' · ')}</span>` +
           (tags.length ? `<span class="c-rate up">${tags.join(' · ')}</span>` : '');
  };
  /* ---------------- the Roll: small cards, one opened at a time ----------------
   * WHAT WAS WRONG WITH THE OLD SHAPE. Every man was a full-width card carrying his emblem,
   * his prose, his numbers and his tags, and then EVERY MAN WAS LISTED AGAIN under "every man
   * in Amber" — so nine of the eleven kinds appeared twice, with the same paragraph under each
   * copy, and the codex was a column you scrolled rather than a thing you looked things up in.
   * Reported from play with a picture.
   * A man belongs to ONE place: the hall that raises him, or, for the two nobody raises, to
   * the section for what you meet rather than muster. What a card has to do at a glance is say
   * WHICH MAN and roughly what he is worth; everything else — the prose, the full line, the
   * tags, and the turning figure — belongs to the one card you have actually asked about.
   * That is also why the figures got cheaper: eighteen men turning at once became one. */
  /* THE NUMBERS ON A SMALL CARD ARE THE ONES HE CAN ACTUALLY HAVE. A branch's recruit does not
   * exist below the fork — a hall is RE-RAISED around him at level 2 — so quoting him at tier
   * one is quoting a man the game never musters. The Archer read 42 hp · 6 blow · ◆23 on his
   * card and 53 · 7.5 · ◆29 in his own level table one tap later, which is the kind of thing a
   * codex exists to stop. `m` is the tier of the lowest level he exists at. */
  const KEY_NUMS = (u, m) => `${Math.round(u.hp * m)} hp · ${+(u.dmg * m).toFixed(1)} blow · ` +
                             `${u.range} reach`;

  /* ---- EVERY LEVEL, WITH ITS NUMBERS ----
   * A LEVEL BUYS BETTER MEN, NOT MORE OF THEM: `CONST.TIER` multiplies a recruit's hit points,
   * his blow and his price, and the muster's PERIOD is flat across levels. So "what does level
   * three get me" is a real question with a numeric answer, and the codex could not answer it —
   * it printed one man at tier one and left the rest to be worked out from a multiplier written
   * down nowhere the player can see.
   * WHICH LEVELS A MAN EXISTS AT falls out of the fork and is not a list anybody keeps: a hall
   * is RE-RAISED around a branch at `fork`, so the base recruit lives at levels 1..fork-1 and a
   * branch's recruit at fork..MAX_LEVEL. Nothing here names a building or a branch. */
  const levelsFor = (bt, key) => {
    const d = C.BUILDINGS[bt], fork = d.fork || C.MAX_LEVEL + 1, out = [];
    const lo = key ? fork : 1, hi = key ? C.MAX_LEVEL : Math.min(C.MAX_LEVEL, fork - 1);
    for (let L = lo; L <= hi; L++) out.push(L);
    return out;
  };
  /* what it costs to REACH a level: the work's own price at level 1, and the upgrade that
   * carries it from the level below at every level after */
  const priceTo = (bt, key, L) => (L === 1 ? C.BUILDINGS[bt].cost
    : key && L === (C.BUILDINGS[bt].fork || 0) ? C.BUILDINGS[bt].branches[key].cost
    : global.World.upgradeCost(bt, L - 1, key || null));
  function levelTable(bt, key, kind) {
    const d = C.BUILDINGS[bt], b2 = key ? d.branches[key] : null, levels = levelsFor(bt, key);
    if (!levels.length) return '';
    const u = kind ? C.UNITS[kind] : null;
    const head = u ? '<tr><th>lv</th><th>to raise</th><th>hp</th><th>blow</th><th>each</th><th>drain</th></tr>'
                   : '<tr><th>lv</th><th>to raise</th><th>blow</th><th>every</th><th>range</th></tr>';
    const rows = levels.map((L) => {
      const raise = `◆ ${Math.round(priceTo(bt, key, L))}`;
      if (u) {
        const m = C.TIER[L - 1];
        const per = (b2 && b2.period ? b2.period[L - d.fork] : d.period ? d.period[L - 1] : 0);
        return `<tr><td>${L}</td><td>${raise}</td><td>${Math.round(u.hp * m)}</td>` +
               `<td>${+(u.dmg * m).toFixed(1)}</td><td>◆ ${Math.round(u.cost * m)}</td>` +
               `<td>${per ? '−' + (u.cost * m / per).toFixed(1) + '/s' : '—'}</td></tr>`;
      }
      /* the work's own gunnery: a branch keeps its numbers in arrays indexed from the fork,
       * and before the fork they are the work's own */
      const i = b2 ? L - d.fork : L - 1;
      const src = b2 || d, at = (f) => (Array.isArray(src[f]) ? src[f][i] : src[f]);
      return `<tr><td>${L}</td><td>${raise}</td><td>${at('dmg')}</td>` +
             `<td>${at('atk')}s</td><td>${at('range')}</td></tr>`;
    }).join('');
    return `<table class="mo-levels">${head}${rows}</table>`;
  }

  /* a small card. `kind` names a man; `work` names a branch that changes a WORK rather than
   * mustering anybody (a Ballista Tower raises no one), and it opens the same way. */
  function manCard(kind, tag, bt, key) {
    const u = C.UNITS[kind];
    const first = bt ? (levelsFor(bt, key)[0] || 1) : 1;
    const m = C.TIER[first - 1] || 1;
    return `<button class="man" data-kind="${kind}"${bt ? ` data-bt="${bt}"` : ''}` +
           `${key ? ` data-br="${key}"` : ''}>` +
           `<span class="m-emblem">${u.icon || '•'}</span>` +
           `<span class="m-name">${u.name || cap(kind)}</span>` +
           (tag ? `<span class="m-tag">${tag}</span>` : '') +
           `<span class="m-cost">${u.cost ? '◆ ' + Math.round(u.cost * m) : ''}</span>` +
           `<span class="m-nums">${KEY_NUMS(u, m)}</span></button>`;
  }
  function workCard(bt, key) {
    const d = C.BUILDINGS[bt], b2 = key ? d.branches[key] : d;
    const i = key ? 0 : 0;
    const dmg = Array.isArray(b2.dmg) ? b2.dmg[i] : b2.dmg;
    const rng = Array.isArray(b2.range) ? b2.range[i] : b2.range;
    return `<button class="man work" data-bt="${bt}"${key ? ` data-br="${key}"` : ''}>` +
           `<span class="m-emblem">${b2.icon || d.icon || '•'}</span>` +
           `<span class="m-name">${key ? b2.name : d.name}</span>` +
           `<span class="m-tag">${key ? `${d.name} · level ${d.fork}` : 'level 1'}</span>` +
           `<span class="m-cost">◆ ${key ? b2.cost : d.cost}</span>` +
           `<span class="m-nums">${dmg != null ? `${dmg} blow · ${rng} range · musters nobody`
                                               : 'the work itself'}</span></button>`;
  }
  /* THE OPENED CARD. It sits under both columns, full width, so it reads as the small card
   * growing rather than as a panel somewhere else. The berth for the figure is `c-fig` exactly
   * as it always was — `data-kind` is still what tells the renderer which man goes in which
   * rectangle — and there is now only ever one of them. */
  function manOpen(kind, from, bt, key) {
    const u = C.UNITS[kind];
    const m = C.TIER[(bt ? (levelsFor(bt, key)[0] || 1) : 1) - 1] || 1;
    return '<div class="man-open">' +
           `<span class="c-fig" data-kind="${kind}">${u.icon || '•'}</span>` +
           '<div class="mo-text">' +
           `<div class="mo-name">${u.name || cap(kind)}` +
           `<span class="mo-cost">${u.cost ? '◆ ' + Math.round(u.cost * m) : ''}</span></div>` +
           (from ? `<div class="mo-from">${from}</div>` : '') +
           `<div class="mo-blurb">${u.blurb || ''}</div>` +
           (bt ? levelTable(bt, key, kind) : '') + rollStat(kind, !!bt) + '</div></div>';
  }
  function workOpen(bt, key) {
    const d = C.BUILDINGS[bt], b2 = key ? d.branches[key] : d;
    return '<div class="man-open">' +
           `<span class="c-fig no-fig">${b2.icon || d.icon || '•'}</span>` +
           '<div class="mo-text">' +
           `<div class="mo-name">${key ? b2.name : d.name}` +
           `<span class="mo-cost">◆ ${key ? b2.cost : d.cost}</span></div>` +
           `<div class="mo-from">${key ? `${d.name}, level ${d.fork} — chosen once, and forever`
                                       : `${d.name}, level 1`}</div>` +
           `<div class="mo-blurb">${(key ? b2.blurb : d.blurb) || ''}</div>` +
           levelTable(bt, key, null) + '</div></div>';
  }
  UI.roll = function () {
    const body = $('roll-body');
    const raised = new Set();     // every man some hall musters — see the last section
    let h = '';
    /* ---- LEVEL ONE ON THE LEFT, WHAT IT BECOMES ON THE RIGHT ----
     * The grid used to auto-fill, so a hall's own recruit and the three men he might become
     * landed wherever they fitted and the READING of the section was left to the reader. A
     * forking work is one decision with two sides — this is what you get, and these are the
     * things it can be re-raised into — so the columns say it. */
    for (const bt of C.BUILD_ORDER_UI) {
      const d = C.BUILDINGS[bt];
      if (!d.branches) continue;
      h += `<div class="roll-hall"><div class="roll-head">${d.icon} ${d.name}` +
           `<b>◆ ${d.cost}</b></div><div class="roll-blurb">${d.blurb}</div><div class="roll-cols">` +
           '<div class="roll-col"><div class="col-head">Level 1</div>';
      if (d.spawns) { h += manCard(d.spawns, 'level 1', bt); raised.add(d.spawns); }
      else h += workCard(bt, null);          // a work that musters nobody IS its level 1
      h += `</div><div class="roll-col"><div class="col-head">Level ${d.fork} — choose once</div>`;
      for (const key of d.branchUI) {
        const b2 = d.branches[key];
        if (b2.spawns) { h += manCard(b2.spawns, b2.name, bt, key); raised.add(b2.spawns); }
        else h += workCard(bt, key);
      }
      h += '</div></div><div class="roll-open"></div></div>';
    }
    /* ...and the two nobody musters. The Champion comes off a Trump and the Fiend out of a
     * rift, so neither is under a hall — and a roll that left them out would be a roll of what
     * you can BUY rather than of what is on the board. This section is the REMAINDER rather
     * than a second copy of the table, so a kind added to `UNITS` lands in one place or the
     * other and never in both, which is what the codex used to do to nine of eleven kinds. */
    const loose = Object.keys(C.UNITS).filter((k) => !raised.has(k));
    if (loose.length) {
      h += '<div class="roll-hall"><div class="roll-head">⚑ Out of Shadow</div>' +
           '<div class="roll-blurb">Raised by nobody: what you meet rather than what you muster.</div>' +
           '<div class="roll-cols"><div class="roll-col">' +
           loose.filter((k, i) => i % 2 === 0).map((k) => manCard(k)).join('') +
           '</div><div class="roll-col">' +
           loose.filter((k, i) => i % 2 === 1).map((k) => manCard(k)).join('') +
           '</div></div><div class="roll-open"></div></div>';
    }
    body.innerHTML = h;
    $('menu').classList.add('hidden');
    $('roll').classList.remove('hidden');
    body.scrollTop = 0;
    rollBind(body);
    rollFigures();          // nothing is open yet: this stops the loop
    if (H.onRollOpen) H.onRollOpen();
  };
  /* ONE CARD OPEN AT A TIME, and the figure follows it. A second tap on the same card shuts it,
   * which is the only way back to the grid without choosing something else. The panel goes in
   * its section's own `.roll-open`, under both columns — a card that grew INSIDE a column would
   * be half a screen wide with a figure in it. */
  function rollBind(body) {
    body.addEventListener('click', (e) => {
      const card = e.target.closest && e.target.closest('.man');
      if (!card || !body.contains(card)) return;
      const wasOpen = card.classList.contains('open');
      for (const p of body.querySelectorAll('.roll-open')) p.innerHTML = '';
      for (const c2 of body.querySelectorAll('.man.open')) c2.classList.remove('open');
      if (wasOpen) { rollFigures(); return; }
      card.classList.add('open');
      const slot = card.closest('.roll-hall').querySelector('.roll-open');
      slot.innerHTML = card.dataset.kind
        ? manOpen(card.dataset.kind, cardFrom(card), card.dataset.bt || null, card.dataset.br || null)
        : workOpen(card.dataset.bt, card.dataset.br || null);
      rollFigures();
    });
  }
  /* WHICH WORK RAISES HIM, said on the opened card — the small card has no room for it and it
   * is the first thing you want to know about a man you have just tapped. It comes off the
   * card's own `data-bt` and the table it names: NOTHING HERE NAMES A BUILDING, so a hall
   * added tomorrow describes its own men without a line of code here. */
  function cardFrom(card) {
    const d = C.BUILDINGS[card.dataset.bt];
    if (!d) return '';
    const tag = card.querySelector('.m-tag'), t = tag ? tag.textContent : '';
    if (!t || t === 'level 1') return `${d.name}, level 1 — mustered from the first`;
    return `${t} · ${d.name} at level ${d.fork}, chosen once and forever`;
  }
  /* THE FIGURES ARE THE RENDERER'S, AND THE TIMING IS OURS. ui.js owns one canvas and the two
   * moments that matter — the Roll opened, the Roll shut — and render3d.js owns every line
   * that is actually drawn into it (see R.rollStart: one context, one scissor per row). Nothing
   * here duplicates a unit's geometry, which is the whole reason the codex cannot drift.
   * The canvas is made once and kept: a WebGL context is expensive to raise and this screen is
   * opened and shut repeatedly. */
  let rollCv = null;
  function rollFigures() {
    const R3 = global.Render;
    const roll = $('roll');
    roll.classList.remove('figs');
    if (!R3 || !R3.rollStart) return false;
    if (!rollCv) {
      rollCv = document.createElement('canvas');
      rollCv.id = 'roll-figs';
      roll.appendChild(rollCv);
    }
    rollCv.classList.remove('hidden');
    /* ONE BERTH NOW, OR NONE. The whole list used to turn at once — eighteen men, eighteen
     * scissor rectangles, every frame, on a phone — and every one of them was a card you were
     * not looking at. The figure belongs to the card you have opened, so `rollStart` is handed
     * that one berth, or nothing at all when the grid is closed, which stops the loop. */
    const rows = [...$('roll-body').querySelectorAll('.man-open .c-fig')]
      .filter((el) => el.dataset.kind)
      .map((el) => ({ el, kind: el.dataset.kind }));
    if (!rows.length) { R3.rollStop(); rollCv.classList.add('hidden'); return false; }
    const live = !!R3.rollStart(rollCv, rows);
    /* AND IF IT REFUSES, THE ROLL IS STILL THE ROLL. `figs` is the only thing that fades the
     * glyph, so a page with no WebGL keeps the icons it always had and says nothing about it. */
    roll.classList.toggle('figs', live);
    if (!live) rollCv.classList.add('hidden');
    return live;
  }
  UI.rollClose = function () {
    /* the loop STOPS. A rAF left running behind a hidden panel is a phone drawing eighteen
     * men into a canvas nobody is looking at, for as long as the menu is up. */
    if (global.Render && global.Render.rollStop) global.Render.rollStop();
    if (rollCv) rollCv.classList.add('hidden');
    $('roll').classList.remove('figs');
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

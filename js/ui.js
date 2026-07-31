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
    $('btn-campaign').addEventListener('click', () => H.onCampaign());
    $('btn-skirmish').addEventListener('click', () => $('skirmish-row').classList.toggle('hidden'));
    $('btn-lan').addEventListener('click', () => $('lan-panel').classList.toggle('hidden'));
    $('pw-storm').addEventListener('click', () => H.onPower('storm'));
    $('pw-trump').addEventListener('click', () => H.onPower('trump'));
    $('end-next').addEventListener('click', () => H.onEndNext());
    $('end-menu').addEventListener('click', () => H.onEndMenu());

    /* skirmish: pick your rival heir */
    const row = $('skirmish-row');
    for (const kind of Object.keys(global.AI.HEIRS)) {
      const b = document.createElement('button');
      b.className = 'mbtn small';
      b.textContent = global.AI.HEIRS[kind].title.split(',')[0].toUpperCase();
      b.addEventListener('click', () => H.onSkirmish(kind));
      row.appendChild(b);
    }
  };

  /* ---------------- menu / match lifecycle ---------------- */
  UI.showMenu = function (campaignLabel) {
    $('menu').classList.remove('hidden');
    $('hud').classList.add('hidden');
    $('end').classList.add('hidden');
    UI.closeSheet();
    $('btn-campaign').textContent = campaignLabel;
  };
  UI.startMatch = function (rivalName) {
    $('menu').classList.add('hidden');
    $('end').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('rival-name').textContent = rivalName;
    $('rival-pattern').classList.add('hidden');
  };

  /* ---------------- flag tray: the army's orders, always at thumb's reach ---------------- */
  const PENNANT_CSS = ['#e8ecff', '#64d8d8', '#c48eff', '#ff9ad8', '#9adcff', '#ffc27a', '#b0e8a0', '#d8b0ff'];
  let trayHash = '';
  UI.flags = function (view, viewer, armed) {
    const tray = $('flag-tray');
    const me = view.players[viewer];
    const rows = [];
    for (let i = 0; i < C.SLOTS; i++) {
      const s = me.slots[i];
      if (s && C.BUILDINGS[s.bt] && C.BUILDINGS[s.bt].spawns) rows.push([i, s.rally != null && s.rally >= 0]);
    }
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
    mk('royal', '⚑', '', '#ffd98a');
    for (const [i, detached] of rows) {
      const b = mk(i, '⚐', 'co', PENNANT_CSS[i % PENNANT_CSS.length]);
      if (detached) {
        const d = document.createElement('span');
        d.className = 'dot';
        d.style.background = PENNANT_CSS[i % PENNANT_CSS.length];
        b.appendChild(d);
      }
    }
    if (typeof armed === 'number') {
      const rj = document.createElement('button');
      rj.id = 'flag-rejoin';
      rj.textContent = '⟲ REJOIN';
      rj.addEventListener('click', () => H.onRejoin(armed));
      tray.appendChild(rj);
    }
  };

  /* ---------------- HUD ---------------- */
  const mmss = (t) => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
  UI.hud = function (view, viewer, incomeRate, targeting) {
    const me = view.players[viewer], en = view.players[1 - viewer];
    $('ess-n').textContent = Math.floor(me.essence);
    const er = $('ess-rate');
    er.textContent = (incomeRate >= 0 ? '+' : '') + incomeRate.toFixed(1) + '/s' + (me.musterPaused ? ' ⏸' : '');
    er.style.color = incomeRate >= 0 ? '' : '#ff8a96';
    $('timer').textContent = mmss(view.t);
    const rp = $('rival-pattern');
    if (en.revealed) {
      rp.classList.remove('hidden');
      rp.textContent = '✴ ' + en.pattern.toFixed(0) + '%';
    } else rp.classList.add('hidden');
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
  function rateTag(bt, level) {
    const d = C.BUILDINGS[bt];
    if (!d) return '';
    if (d.income) return `<span class="c-rate up">+${d.income[level - 1]}◆/s</span>`;
    if (d.spawns) { const u = C.UNITS[d.spawns]; return `<span class="c-rate dn">−${(u.cost / d.period[level - 1]).toFixed(1)}◆/s muster</span>`; }
    if (bt === 'shrine') return `<span class="c-rate dn">−${d.drain[level - 1]}◆/s while walking</span>`;
    return '';
  }
  UI.buildSheet = function (slot, essence, hasShrine) {
    const el = $('sheet');
    el.innerHTML = `<div class="sheet-title">Raise a work of Amber ${trChip(essence)}</div>`;
    for (const bt of C.BUILD_ORDER_UI) {
      const d = C.BUILDINGS[bt];
      if (d.unique && hasShrine && bt === 'shrine') continue;
      const can = essence >= d.cost;
      const card = document.createElement('button');
      card.className = 'card' + (can ? '' : ' locked');
      card.dataset.cost = d.cost;   // live affordability: UI.tick unlocks it when income catches up
      card.innerHTML = `<span class="c-ico">${d.icon}</span><span class="c-name">${d.name}</span>` +
                       `<span class="c-cost">◆ ${d.cost}</span><span class="c-blurb">${d.blurb}</span>${rateTag(bt, 1)}`;
      card.addEventListener('click', () => { if (card.classList.contains('locked')) return; H.onBuild(slot, bt); UI.closeSheet(); });
      el.appendChild(card);
    }
    addCancel(el);
    el._openedAt = performance.now();
    el.classList.remove('hidden');
  };

  UI.upSheet = function (slot, s, essence, walking) {
    const d = C.BUILDINGS[s.bt];
    const el = $('sheet');
    el.innerHTML = `<div class="sheet-title">${d.icon} ${d.name} — level ${s.level} ${trChip(essence)}</div>` +
                   `<div class="sheet-blurb">${d.blurb}</div>`;
    if (s.level < C.MAX_LEVEL) {
      const cost = global.World.upgradeCost(s.bt, s.level);
      const can = essence >= cost;
      const b = document.createElement('button');
      b.className = 'card' + (can ? '' : ' locked');
      b.dataset.cost = cost;
      const rt = rateTag(s.bt, s.level + 1);
      b.innerHTML = `<span class="c-name">Upgrade to level ${s.level + 1}</span><span class="c-cost">◆ ${cost}</span>` +
                    (rt ? rt.replace('c-rate', 'c-rate wide') : '');
      b.addEventListener('click', () => { if (b.classList.contains('locked')) return; H.onUp(slot); UI.closeSheet(); });
      el.appendChild(b);
    }
    if (d.spawns) {
      const detached = s.rally != null && s.rally >= 0;
      const info = document.createElement('div');
      info.className = 'sheet-blurb';
      info.textContent = detached ? '⚐ Its company holds a standard afield — see the flag tray'
                                  : '⚑ Its company follows the War Banner — its flag waits in the tray';
      el.appendChild(info);
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
    spring: 'A spring of living Shadow. Hold it with a Shadow Gate and it will pay for wars.',
    vantage: 'High ground over the paths. A Watchpost here sees far and shoots farther.',
    road: 'A milestone of the black road. Chaos favors this ground — a Rampart can wall the way.',
    city: 'A Seat of Power.'
  };
  UI.siteSheet = function (site, st, viewer, essence, foeCity, wallLevel, pinfo, foeInfo) {
    const el = $('sheet');
    const ownerTxt = !st ? 'unexplored' : st.owner === -1 || st.owner == null ? 'unclaimed'
      : st.owner === viewer ? 'yours' : 'the rival’s';
    el.innerHTML = `<div class="sheet-title">${site.name} ${trChip(essence)}</div>` +
                   `<div class="sheet-blurb">${KIND_BLURB[site.kind] || ''} <b>(${ownerTxt})</b></div>`;

    /* ---- the Seat of Power: city status + city-wide commands ---- */
    if (site.kind === 'city') {
      const p2 = foeCity ? foeInfo : pinfo;
      if (p2) {
        const stat = document.createElement('div');
        stat.className = 'sheet-blurb';
        const wl = foeCity ? (p2.wallHp > 0 ? Math.round(p2.wallHp) + ' hp' : 'none')
          : (p2.wallLevel > 0 ? 'L' + p2.wallLevel + ' · ' + Math.round(p2.wallHp) + '/' + C.WALL.hp[p2.wallLevel - 1] : 'none');
        stat.innerHTML = `🗼 Seat ${Math.round(p2.castleHp)}/${C.CASTLE_HP} &nbsp; 🧱 Walls ${wl}`;
        el.appendChild(stat);
      }
      if (!foeCity && pinfo) {
        const shrine = (pinfo.slots || []).find((q) => q && q.bt === 'shrine');
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
                       '<span class="c-blurb">The War Banner returns home and every company folds back — defend the city</span>';
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
    /* your own city: raise or strengthen the walls */
    if (site.kind === 'city' && !foeCity && wallLevel != null && wallLevel < C.MAX_LEVEL) {
      const cost = wallLevel === 0 ? C.WALL.cost : C.WALL.up[wallLevel - 1];
      const can = essence >= cost;
      const wc = document.createElement('button');
      wc.className = 'card' + (can ? '' : ' locked');
      wc.dataset.cost = cost;
      wc.innerHTML = `<span class="c-ico">🧱</span><span class="c-name">${wallLevel === 0 ? 'Raise the City Walls' : 'Strengthen the Walls (level ' + (wallLevel + 1) + ')'}</span>` +
                     `<span class="c-cost">◆ ${cost}</span><span class="c-blurb">A ring no enemy passes while it stands. Self-mends.</span>`;
      wc.addEventListener('click', () => { if (wc.classList.contains('locked')) return; H.onWall(); UI.closeSheet(); });
      el.appendChild(wc);
    }
    /* build an outpost (a unit of yours must stand there — the host validates) */
    if (site.kind !== 'city' && (!st || !st.post)) {
      for (const bt of Object.keys(C.OUTPOSTS)) {
        const d = C.OUTPOSTS[bt];
        if (d.only && site.kind !== d.only) continue;
        const can = essence >= d.cost;
        const card = document.createElement('button');
        card.className = 'card' + (can ? '' : ' locked');
        card.dataset.cost = d.cost;
        const orate = d.income ? `<span class="c-rate up">+${d.income[0]}◆/s</span>` : '';
        card.innerHTML = `<span class="c-ico">${d.icon}</span><span class="c-name">${d.name}</span>` +
                         `<span class="c-cost">◆ ${d.cost}</span><span class="c-blurb">${d.blurb} — needs a unit standing here</span>${orate}`;
        card.addEventListener('click', () => { if (card.classList.contains('locked')) return; H.onPost(site.id, bt); UI.closeSheet(); });
        el.appendChild(card);
      }
    }
    /* upgrade your outpost */
    if (st && st.post && st.owner === viewer && st.post.level < C.MAX_LEVEL) {
      const cost = global.World.postUpCost(st.post.bt, st.post.level);
      const can = essence >= cost;
      const b = document.createElement('button');
      b.className = 'card' + (can ? '' : ' locked');
      b.dataset.cost = cost;
      const od = C.OUTPOSTS[st.post.bt];
      const orate2 = od.income ? `<span class="c-rate up wide">+${od.income[st.post.level]}◆/s</span>` : '';
      b.innerHTML = `<span class="c-name">Upgrade ${od.name} to level ${st.post.level + 1}</span><span class="c-cost">◆ ${cost}</span>${orate2}`;
      b.addEventListener('click', () => { if (b.classList.contains('locked')) return; H.onPostUp(site.id); UI.closeSheet(); });
      el.appendChild(b);
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
    for (const card of el.querySelectorAll('.card[data-cost]'))
      card.classList.toggle('locked', essence < +card.dataset.cost);
    const chip = el.querySelector('.tr-chip b');
    if (chip) chip.textContent = Math.floor(essence);
  };

  UI.closeSheet = function () { $('sheet').classList.add('hidden'); if (global.Render) global.Render.selected = -1; };
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
  UI.end = function (won, sub, nextLabel) {
    $('hud').classList.add('hidden');
    UI.closeSheet();
    $('end').classList.remove('hidden');
    $('end-title').textContent = won ? 'THE THRONE IS YOURS' : 'THE SUCCESSION PASSES YOU BY';
    $('end-title').className = won ? 'won' : 'lost';
    $('end-sub').textContent = sub;
    $('end-next').textContent = nextLabel;
  };

  global.UI = UI;
})(typeof window !== 'undefined' ? window : globalThis);

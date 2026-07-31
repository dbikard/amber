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

  /* ---------------- HUD ---------------- */
  const mmss = (t) => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
  UI.hud = function (view, viewer, incomeRate, targeting) {
    const me = view.players[viewer], en = view.players[1 - viewer];
    $('ess-n').textContent = Math.floor(me.essence);
    const er = $('ess-rate');
    er.textContent = (incomeRate >= 0 ? '+' : '') + incomeRate.toFixed(1) + '/s';
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
  UI.buildSheet = function (slot, essence, hasShrine) {
    const el = $('sheet');
    el.innerHTML = '<div class="sheet-title">Raise a work of Amber</div>';
    for (const bt of C.BUILD_ORDER_UI) {
      const d = C.BUILDINGS[bt];
      if (d.unique && hasShrine && bt === 'shrine') continue;
      const can = essence >= d.cost;
      const card = document.createElement('button');
      card.className = 'card' + (can ? '' : ' locked');
      card.dataset.cost = d.cost;   // live affordability: UI.tick unlocks it when income catches up
      card.innerHTML = `<span class="c-ico">${d.icon}</span><span class="c-name">${d.name}</span>` +
                       `<span class="c-cost">◆ ${d.cost}</span><span class="c-blurb">${d.blurb}</span>`;
      card.addEventListener('click', () => { if (card.classList.contains('locked')) return; H.onBuild(slot, bt); UI.closeSheet(); });
      el.appendChild(card);
    }
    addCancel(el);
    el.classList.remove('hidden');
  };

  UI.upSheet = function (slot, s, essence, walking) {
    const d = C.BUILDINGS[s.bt];
    const el = $('sheet');
    el.innerHTML = `<div class="sheet-title">${d.icon} ${d.name} — level ${s.level}</div>` +
                   `<div class="sheet-blurb">${d.blurb}</div>`;
    if (s.level < C.MAX_LEVEL) {
      const cost = global.World.upgradeCost(s.bt, s.level);
      const can = essence >= cost;
      const b = document.createElement('button');
      b.className = 'card' + (can ? '' : ' locked');
      b.dataset.cost = cost;
      b.innerHTML = `<span class="c-name">Upgrade to level ${s.level + 1}</span><span class="c-cost">◆ ${cost}</span>`;
      b.addEventListener('click', () => { if (b.classList.contains('locked')) return; H.onUp(slot); UI.closeSheet(); });
      el.appendChild(b);
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
    el.classList.remove('hidden');
  };

  /* ---------------- map site sheet (v0.2) ---------------- */
  const KIND_BLURB = {
    spring: 'A spring of living Shadow. Hold it with a Shadow Gate and it will pay for wars.',
    vantage: 'High ground over the paths. A Watchpost here sees far and shoots farther.',
    road: 'A milestone of the black road. Chaos favors this ground — a Rampart can wall the way.',
    city: 'A Seat of Power.'
  };
  UI.siteSheet = function (site, st, viewer, essence, foeCity, wallLevel) {
    const el = $('sheet');
    const ownerTxt = !st ? 'unexplored' : st.owner === -1 || st.owner == null ? 'unclaimed'
      : st.owner === viewer ? 'yours' : 'the rival’s';
    el.innerHTML = `<div class="sheet-title">${site.name}</div>` +
                   `<div class="sheet-blurb">${KIND_BLURB[site.kind] || ''} <b>(${ownerTxt})</b></div>`;
    /* plant the banner — the one army order; at the rival's gates it is the assault */
    const bb = document.createElement('button');
    bb.className = 'card walkbtn' + (foeCity ? ' assault' : '');
    bb.innerHTML = foeCity
      ? '<span class="c-name">⚔ Sound the Assault</span><span class="c-blurb">Plant the Banner at their gates — every blade marches on the Seat of Power</span>'
      : '<span class="c-name">⚑ Plant the War Banner</span><span class="c-blurb">Your whole army marches here</span>';
    bb.addEventListener('click', () => { H.onBanner(site.id); UI.closeSheet(); });
    el.appendChild(bb);
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
        card.innerHTML = `<span class="c-ico">${d.icon}</span><span class="c-name">${d.name}</span>` +
                         `<span class="c-cost">◆ ${d.cost}</span><span class="c-blurb">${d.blurb} — needs a unit standing here</span>`;
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
      b.innerHTML = `<span class="c-name">Upgrade ${C.OUTPOSTS[st.post.bt].name} to level ${st.post.level + 1}</span><span class="c-cost">◆ ${cost}</span>`;
      b.addEventListener('click', () => { if (b.classList.contains('locked')) return; H.onPostUp(site.id); UI.closeSheet(); });
      el.appendChild(b);
    }
    addCancel(el);
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

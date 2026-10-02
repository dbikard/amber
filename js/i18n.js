/* i18n.js — the game's words in more than one tongue (headless-safe).
 *
 * THE ENGLISH IS THE KEY. Every string a player reads is written in English where it is used,
 * wrapped in `tr('...')`, and looked up here; a missing entry falls back to the English, so a
 * word nobody has translated yet is English rather than blank. Placeholders are `{name}`,
 * filled from the second argument: `tr('{n} men', {n: 4})`. The tables in const.js stay
 * English — the UI wraps a name or a blurb at the moment it shows it.
 *
 * THE LANGUAGE IS CHOSEN ONCE PER PAGE. `I18N.set` stores the choice and the menu reloads the
 * page, so nothing already drawn has to be re-said: the static HTML is walked once at boot
 * (`I18N.dom`), exact text nodes and titles looked up the same way. `?lang=xx` first, then the
 * saved choice, then the browser's own language.
 *
 * Nothing in the SIM may ask this file anything: a refusal or an event carries a code, and the
 * code is put into words by whoever shows it. Two machines at a LAN table may speak two tongues.
 */
(function (global) {
  'use strict';

  const I18N = { langs: ['en', 'fr'], names: { en: 'English', fr: 'Français' }, FR: {} };
  const DICT = { fr: I18N.FR };

  function pick() {
    /* off a browser (Node: sim.js, the suites) the game speaks English whatever the box's
     * locale says — Node grew a `navigator` of its own, and a suite must not change tongue
     * with the machine it runs on */
    if (typeof global.document === 'undefined') return 'en';
    try {   // a link that names its tongue outranks the remembered one
      const q = global.location && /[?&]lang=([a-z]+)/.exec(global.location.search || '');
      if (q && (DICT[q[1]] || q[1] === 'en')) return q[1];
    } catch (e) { /* no location */ }
    let k = null;
    try { k = global.localStorage && global.localStorage.getItem('amber_lang'); } catch (e) { k = null; }
    if (k && (k === 'en' || DICT[k])) return k;
    const nav = global.navigator && (global.navigator.language || '');
    return /^fr\b/i.test(nav || '') ? 'fr' : 'en';
  }
  I18N.lang = pick();

  const fill = (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? String(v[k]) : m)) : s);

  /* the one lookup. `missing` gathers what a French page asked for and did not find, so a rig
   * can name the words nobody wrote down yet */
  I18N.missing = {};
  I18N.t = function (s, v) {
    if (s == null) return '';
    s = String(s);
    const d = DICT[I18N.lang];
    if (d) {
      const w = d[s];
      if (w != null) return fill(w, v);
      if (s.trim()) I18N.missing[s] = 1;
    }
    return fill(s, v);
  };
  /* the same lookup, for a run of text that may carry leading/trailing space or line breaks
   * (the static HTML): the key is the text with its whitespace collapsed */
  I18N.tText = function (raw) {
    const d = DICT[I18N.lang];
    if (!d) return null;
    const key = raw.replace(/\s+/g, ' ').trim();
    if (!key || d[key] == null) return null;
    const lead = /^\s*/.exec(raw)[0], trail = /\s*$/.exec(raw)[0];
    return lead + d[key] + trail;
  };

  /* a SITE's name as worldgen wrote it: the springs and crags are table words, a board's
   * cities are "the City of <heir>", a country's courts are proper names and stay */
  I18N.site = function (n) {
    let m = /^the City of (.+)$/.exec(n || '');
    if (m) return I18N.t('the City of {name}', { name: m[1] });
    if ((m = /^(.+)’s Seat$/.exec(n || ''))) return I18N.t('{name}’s Seat', { name: m[1] });
    if ((m = /^SHADOW (\d+)$/.exec(n || ''))) return I18N.t('SHADOW {n}', { n: m[1] });
    return I18N.t(n);
  };

  I18N.set = function (k) {
    if (k !== 'en' && !DICT[k]) return;
    try { global.localStorage.setItem('amber_lang', k); } catch (e) { /* private mode: this page only */ }
    I18N.lang = k;
  };

  /* walk a subtree and say every text node and every title in the page's tongue */
  I18N.dom = function (root) {
    if (!DICT[I18N.lang] || !root) return;
    const doc = root.ownerDocument || root;
    if (doc.documentElement) doc.documentElement.lang = I18N.lang;
    const walk = doc.createTreeWalker(root, 4 /* SHOW_TEXT */, null, false);
    const nodes = [];
    for (let n = walk.nextNode(); n; n = walk.nextNode()) nodes.push(n);
    for (const n of nodes) {
      const p = n.parentNode;
      if (p && (p.nodeName === 'SCRIPT' || p.nodeName === 'STYLE')) continue;
      const w = I18N.tText(n.nodeValue);
      if (w != null) n.nodeValue = w;
    }
    const els = root.querySelectorAll ? root.querySelectorAll('[title],[placeholder],[aria-label]') : [];
    for (const el of els) {
      for (const a of ['title', 'placeholder', 'aria-label']) {
        const v = el.getAttribute(a);
        if (v) { const w = I18N.tText(v); if (w != null) el.setAttribute(a, w); }
      }
    }
  };

  global.I18N = I18N;
  global.tr = I18N.t;
})(typeof window !== 'undefined' ? window : globalThis);

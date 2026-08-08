/* sw.js — installable PWA + offline play + AUTO-UPDATE (refined from perils).
 *
 * VERSION is stamped by the release flow (pre-commit hook / sed), so every push makes
 * this file byte-different → the browser installs a fresh SW → the page is told an
 * update is ready and applies it (immediately at the menu; after the match otherwise).
 *
 * Strategy:
 *  - install: precache the whole build under a VERSIONED cache (offline from first run)
 *  - activate: delete every older amber-* cache (no stale hoard, unlike perils v1)
 *  - navigations → network-first (online always gets the newest index + ?v refs),
 *    cached fallback offline
 *  - same-origin assets → cache-first (all are ?v-stamped, so stale hits are impossible)
 *  - cross-origin passes through untouched */
'use strict';

const VERSION = '0.9.23';
const CACHE = 'amber-' + VERSION;
const CORE = [
  './', './index.html', './styles.css', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  './js/vendor/three.min.js',
  './js/rng.js', './js/const.js', './js/worldgen.js', './js/nav.js', './js/world.js', './js/ai.js',
  './js/terrain.js', './js/render3d.js', './js/render_select.js',
  './js/qrcode.js', './js/net.js', './js/record.js', './js/ui.js', './js/game.js'
].map((u) => (u.endsWith('/') || u.endsWith('.html') ? u : u + '?v=' + VERSION));

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {}));
  /* no skipWaiting here: the PAGE decides when the new version takes over
   * (immediately at the menu, after the match otherwise) via the 'skip' message */
});

self.addEventListener('message', (m) => {
  if (m.data && m.data.t === 'skip') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  const isNav = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html');
  if (isNav) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }))
  );
});

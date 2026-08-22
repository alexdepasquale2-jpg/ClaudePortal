/**
 * sw.js — offline-first service worker.
 *
 * The game has no backend, so "offline" is the normal case and the network is
 * the exception. Strategy:
 *
 *   navigations   -> cache-first on the app shell, network only to refresh it
 *   static assets -> cache-first, revalidated in the background
 *   everything else -> network, cached opportunistically
 *
 * Build output is content-hashed, so a cached asset is never stale; the old
 * cache is dropped wholesale when VERSION changes.
 */

const VERSION = 'recurse-v1';
const SHELL = 'recurse-shell-' + VERSION;
const RUNTIME = 'recurse-runtime-' + VERSION;

const SHELL_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // addAll is all-or-nothing; a single 404 would leave the app uncached,
      // so each shell URL is fetched independently.
      .then((cache) =>
        Promise.all(
          SHELL_URLS.map((url) =>
            cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then(
        (cached) =>
          cached ??
          fetch(req)
            .then((res) => {
              const copy = res.clone();
              caches.open(SHELL).then((c) => c.put('./index.html', copy));
              return res;
            })
            .catch(() => caches.match('./')),
      ),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(RUNTIME).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      // Cache-first keeps the game instant; the background fetch picks up any
      // newer build for next launch.
      return cached ?? network;
    }),
  );
});

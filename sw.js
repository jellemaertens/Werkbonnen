// Offline support: network first (so updates arrive immediately), cached copy when offline.
const CACHE = 'werkbonnen-v4';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'icons/icon.svg',
  'css/app.css', 'js/config.js', 'js/db.js', 'js/sync.js', 'js/signature.js', 'js/print.js', 'js/app.js', 'data/seed.js',
  'assets/BP-Baseline-RGB-POS-NL.png', 'assets/logo_BOSS_wit.png', 'assets/logo_BOSS_NL_baseline_wit.png',
  'assets/fonts/MonaSans-Regular.otf', 'assets/fonts/MonaSans-Bold.otf',
  'assets/fonts/MonaSansCondensed-Regular.otf', 'assets/fonts/MonaSansCondensed-Bold.otf',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  // Never cache the central database API (also when it is served from this origin for testing)
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/rest/v1/')) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});

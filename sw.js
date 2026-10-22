/* Service worker de Bóveda Disney: guarda la app para abrirla sin conexión y los pósters ya vistos.
   Cuando cambies cualquier archivo de la app, subí el número de VERSION para que los celulares se actualicen. */
const VERSION = 'v2';
const SHELL = 'boveda-shell-' + VERSION;
const IMGS = 'boveda-posters';
const FONTS = 'boveda-fonts';
const FILES = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('boveda-shell-') && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trimCache(name, max){
  const c = await caches.open(name); const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // La API siempre va directo a la red (el catálogo ya queda guardado en la app)
  if (url.hostname === 'api.themoviedb.org') return;

  // Pósters: primero la copia guardada, si no, la red
  if (url.hostname === 'image.tmdb.org') {
    e.respondWith(caches.open(IMGS).then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); trimCache(IMGS, 600); }
      return res;
    }));
    return;
  }

  // Tipografías de Google: copia guardada y se refresca en segundo plano
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(res => { c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  // Archivos de la app: copia guardada primero; al navegar sin conexión, la página principal
  if (url.origin === self.location.origin) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).catch(() =>
      req.mode === 'navigate' ? caches.match('./index.html') : Response.error())));
  }
});

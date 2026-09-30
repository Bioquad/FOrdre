// ═══════════════════════════════════════════════════════════════
// FOrdre — service worker: l'app funciona sense connexió
// Estratègia: xarxa primer per als fitxers de l'app (per rebre les
// actualitzacions) i còpia local si no hi ha connexió.
// ═══════════════════════════════════════════════════════════════
const CACHE = 'fordre-v1.6.0';
const FITXERS = [
    './', './index.html', './muntatge.html', './manifest.webmanifest', './manifest-taller.webmanifest',
    './css/fordre.css', './css/muntatge.css',
    './js/fo-dades.js', './js/fo-calcul.js', './js/fo-stl.js', './js/fo-etiquetes.js', './js/fo-importa.js',
    './js/fo-compartir.js', './js/fo-progres.js', './js/fo-informe.js', './js/fo-vista3d.js', './js/fo-app.js', './js/fo-muntatge.js',
    './vendor/three.min.js', './vendor/qrcode.js', './vendor/xlsx.full.min.js', './vendor/jsQR.js',
    './icones/icona.svg', './icones/icona-192.png', './icones/icona-512.png',
    './exemples/dosificadora_DX-1.fordre.json'
];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(FITXERS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
    e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== CACHE).map(n => caches.delete(n)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
    const req = e.request;
    const u = new URL(req.url);
    if (req.method !== 'GET' || u.origin !== location.origin || u.pathname.includes('/api/')) return;
    e.respondWith(
        fetch(req).then(r => {
            if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
            return r;
        }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./muntatge.html')))
    );
});

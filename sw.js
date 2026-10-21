// Service worker: ใช้เครือข่ายก่อน (ได้โค้ดใหม่เสมอ) ถ้าออฟไลน์ใช้ของในแคช
const CACHE = 'pdf-form-easy-v3';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icon.svg',
  'js/main.js', 'js/store.js', 'js/icons.js', 'js/ui.js', 'js/textlayout.js', 'js/detect.js',
  'js/thai.js', 'js/merge.js', 'js/exporter.js', 'js/sigpad.js', 'js/auto.js', 'js/fonts.js', 'js/styles.js', 'js/formula.js',
  'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs', 'vendor/pdf-lib.min.js', 'vendor/fontkit.umd.min.js', 'vendor/fflate.umd.js',
  'fonts/Sarabun-Regular.ttf', 'fonts/Sarabun-Bold.ttf', 'fonts/Kanit-Regular.ttf', 'fonts/Kanit-Bold.ttf', 'fonts/Prompt-Regular.ttf', 'fonts/Prompt-Bold.ttf', 'fonts/ChakraPetch-Regular.ttf', 'fonts/ChakraPetch-Bold.ttf', 'fonts/Taviraj-Regular.ttf', 'fonts/Taviraj-Bold.ttf', 'fonts/Charmonman-Regular.ttf', 'fonts/Charmonman-Bold.ttf', 'fonts/Sriracha-Regular.ttf', 'fonts/Itim-Regular.ttf',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});

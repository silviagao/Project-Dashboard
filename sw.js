// 极简 Service Worker：缓存首页，支持离线/主屏 App 打开
const CACHE = "calabash-kanban-v1";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "index.html", "styles.css", "app.js", "config.js"])));
  self.skipWaiting();
});
self.addEventListener("fetch", (e) => {
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request).catch(() => caches.match("index.html")))
  );
});
self.addEventListener("activate", (e) => self.clients.claim());

// LodgeIQ app (installed on a phone or computer). On purpose this keeps NOTHING: every page, rate,
// quote and login comes fresh from the server, exactly as in the browser. The only thing it does is
// show a "You are offline" page when a LodgeIQ page cannot load. Guest pages (/i/...) are left alone.
const OFFLINE = "/offline.html";
const CACHE = "lodgeiq-offline-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add(new Request(OFFLINE, { cache: "reload" }))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.mode !== "navigate" || req.method !== "GET") return; // everything else: the browser as usual
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/i/")) return;
  e.respondWith(fetch(req).catch(() => caches.match(OFFLINE).then((r) => r || Response.error())));
});

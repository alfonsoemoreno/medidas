// Never cache Next.js build chunks here. Each deployment has its own chunk
// graph, so a stale chunk can prevent dynamic imports (such as ExcelJS) from
// loading after an update.
const CACHE_NAME = "escala-medicion-v3";
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/icon-144.png",
  "/icon-192.png",
  "/icon.png",
  "/apple-icon.png",
  "/favicon.ico",
  "/pwa-screenshot-wide.png",
  "/pwa-screenshot-mobile.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put("/", copy)));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || (await caches.match("/")) || Response.error();
        }),
    );
    return;
  }

  const isSameOrigin = url.origin === self.location.origin;
  const isStaticAsset =
    isSameOrigin &&
    (url.pathname === "/icon-144.png" ||
      url.pathname === "/icon-192.png" ||
      url.pathname === "/icon.png" ||
      url.pathname === "/apple-icon.png" ||
      url.pathname === "/favicon.ico" ||
      url.pathname === "/manifest.webmanifest" ||
      url.pathname === "/pwa-screenshot-wide.png" ||
      url.pathname === "/pwa-screenshot-mobile.png");

  if (!isStaticAsset) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
          }
          return response;
        })
        .catch(() => cached || Response.error());

      return cached || networkFetch;
    }),
  );
});

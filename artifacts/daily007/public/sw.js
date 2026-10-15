const CACHE_PREFIX = "daily007-pwa-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const APP_ROOT = new URL(self.registration.scope).pathname.replace(/\/?$/, "/");
const appPath = (path) => `${APP_ROOT}${path.replace(/^\/+/, "")}`;
const APP_SHELL = [
  APP_ROOT,
  appPath("manifest.json"),
  appPath("icons/icon-192.png"),
  appPath("icons/icon-512.png"),
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(APP_SHELL);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(APP_ROOT)) return;
  const appRelativePath = url.pathname.slice(APP_ROOT.length);
  if (appRelativePath === "api" || appRelativePath.startsWith("api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok && response.type === "basic") {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(APP_ROOT, response.clone());
          }
          return response;
        } catch {
          return (
            (await caches.match(request)) ||
            (await caches.match(APP_ROOT)) ||
            Response.error()
          );
        }
      })(),
    );
    return;
  }

  const isExpoAsset = appRelativePath.startsWith("_expo/static/");
  const isPwaIcon = appRelativePath.startsWith("icons/");
  const isFavicon = appRelativePath === "favicon.ico";
  if (!isExpoAsset && !isPwaIcon && !isFavicon) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      try {
        const response = await fetch(request);
        if (response.ok && response.type === "basic") {
          await cache.put(request, response.clone());
        }
        return response;
      } catch {
        return cached || Response.error();
      }
    })(),
  );
});

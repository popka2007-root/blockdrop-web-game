const CACHE_NAME = "blockdrop-cache-v20";
const ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/styles/pvp-enhancements.css",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/shared/protocol.js",
  "/shared/engine.js",
  "/shared/ai.js",
  "/shared/golden-replay.json",
  "/js/ai-client.js",
  "/js/ai-worker.js",
  "/js/analytics.js",
  "/js/audio.js",
  "/js/config.js",
  "/js/engine.js",
  "/js/game.js",
  "/js/input.js",
  "/js/i18n.js",
  "/js/modes.js",
  "/js/online-controller.js",
  "/js/online.js",
  "/js/progression.js",
  "/js/pvp-enhancements.js",
  "/js/runtime-loop.js",
  "/js/replay.js",
  "/js/save-load.js",
  "/js/scene-state.js",
  "/js/scoring.js",
  "/js/session-state.js",
  "/js/storage.js",
  "/js/ui.js",
  "/js/utils.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put("index.html", copy));
          return response;
        })
        .catch(() => caches.match("index.html")),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});

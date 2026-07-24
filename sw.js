const CACHE_NAME = "finca-cache-v16";
const ASSETS = ["./", "./index.html", "./app-logic.js", "./manifest.json", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first, falling back to the cache only when the network fetch fails
// (offline). A cache-first strategy would serve whatever got cached on first
// visit forever, since nothing else in this app ever prompts the farmer to
// update — a phone that's ever online again should always pick up the latest
// deployed version instead of getting stuck on a stale one indefinitely.
self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

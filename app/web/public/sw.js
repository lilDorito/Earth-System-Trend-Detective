// service worker: installable app shell that opens offline
// - pages: network first, cached shell when offline
// - hashed build assets, textures, region outlines, fonts: cache first
// - /api: always network (results must be fresh); never cached

const VERSION = "v1";
const SHELL = `shell-${VERSION}`;
const STATIC = `static-${VERSION}`;
const SHELL_FILES = ["/", "/manifest.webmanifest", "/favicon.svg", "/icons/icon-192.png", "/regions/index.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== STATIC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const cacheFirst = async (request) => {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(STATIC)).put(request, response.clone());
  return response;
};

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) caches.open(SHELL).then((cache) => cache.put("/", response.clone()));
          return response;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }

  if (/^\/(assets|textures|regions|icons)\//.test(url.pathname) || /\.(woff2?|png|jpg|svg)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});

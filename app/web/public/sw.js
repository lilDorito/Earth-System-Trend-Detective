// service worker: installable app shell that opens offline
// - /assets/: hashed build files, whose name changes with their content: cache first
// - everything else of ours (pages, region data, textures, icons): network first, the cache only when offline,
//   so a new version of a file that keeps its name (regions/index.json) always reaches the phone
// - /api: always network (results must be fresh); never cached
//
// v1 served region data and textures cache-first and kept stale copies forever; the new version name
// makes activate() delete those caches on every phone that has them

const VERSION = "v2";
const SHELL = `shell-${VERSION}`;
const STATIC = `static-${VERSION}`;
const SHELL_FILES = ["/", "/manifest.webmanifest", "/favicon.svg", "/icons/icon-192.png"];

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

const networkFirst = async (request, cacheName, key = request) => {
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(cacheName)).put(key, response.clone());
    return response;
  } catch (error) {
    const cached = await caches.match(key);
    if (cached) return cached;
    throw error;
  }
};

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api")) return;

  if (request.mode === "navigate") {
    // any page of the app is the same shell
    event.respondWith(networkFirst(request, SHELL, "/"));
  } else if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
  } else if (/^\/(textures|regions|icons)\//.test(url.pathname) || /\.(webmanifest|svg|png|jpg|json)$/.test(url.pathname)) {
    event.respondWith(networkFirst(request, STATIC));
  }
});

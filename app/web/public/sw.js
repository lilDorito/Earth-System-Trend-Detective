// service worker: installable app shell that opens offline
// - /assets/: hashed build files, whose name changes with their content: cache first
// - everything else of ours (pages, region data, textures, icons): network first, the cache only when offline
// - /api: always network (results must be fresh); never cached
// Only real files are cached: a host that answers a missing file with the HTML page (an SPA fallback) must
// not get that page stored as a stylesheet or script, or the app loads without styles and pages forever.
//
// v3: deletes every older cache on activate, including ones that stored such HTML stand-ins

const VERSION = "v3";
const SHELL = `shell-${VERSION}`;
const STATIC = `static-${VERSION}`;
const SHELL_FILES = ["/", "/manifest.webmanifest", "/favicon.svg", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  // one missing file must not stop the new worker from replacing a broken old one
  event.waitUntil(caches.open(SHELL).then((cache) => Promise.allSettled(SHELL_FILES.map((url) => cache.add(url)))));
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

// whether a response really is the kind of file that was asked for
function isGenuine(request, response) {
  if (!response || !response.ok || response.type === "opaque") return false;
  const type = response.headers.get("content-type") || "";
  const path = new URL(request.url).pathname;
  const html = type.includes("text/html");
  if (request.mode === "navigate") return html;
  if (/\.(js|mjs)$/.test(path)) return type.includes("javascript");
  if (/\.css$/.test(path)) return type.includes("text/css");
  return !html; // data, images, fonts: anything but the HTML page
}

const cacheFirst = async (request) => {
  const cached = await caches.match(request);
  if (cached && isGenuine(request, cached)) return cached;
  const response = await fetch(request);
  if (isGenuine(request, response)) (await caches.open(STATIC)).put(request, response.clone());
  return response;
};

const networkFirst = async (request, cacheName, key = request) => {
  try {
    const response = await fetch(request);
    if (isGenuine(request, response)) (await caches.open(cacheName)).put(key, response.clone());
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

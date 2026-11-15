// retired: the app no longer has an offline cache. Phones that installed an earlier worker keep checking this
// address for updates; this version replaces it, deletes every cache it left, removes itself and reloads the
// open app once, so it loads fresh from the server. It handles no requests.

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
      await self.registration.unregister();
      const windows = await self.clients.matchAll({ type: "window" });
      await Promise.all(windows.map((client) => client.navigate(client.url).catch(() => {})));
    })(),
  );
});

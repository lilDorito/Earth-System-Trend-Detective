// entry point

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./index.css";

// self-repair for a phone holding a mix of two versions (a new page with files from an old offline cache, or a
// host answering a file it no longer has with the HTML page): the styles or a page's code never arrive, leaving
// unstyled links and an endless spinner. Clear the offline cache, drop the service worker and reload, once per tab
async function repair(reason: string) {
  try {
    if (sessionStorage.getItem("repaired")) return; // tried already in this tab: do not loop
    sessionStorage.setItem("repaired", reason);
  } catch {
    // storage blocked: still repair, the reload loads fresh files without a worker in the way
  }
  try {
    await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
  } catch {
    // no cache storage
  }
  try {
    await Promise.all((await navigator.serviceWorker.getRegistrations()).map((r) => r.unregister()));
  } catch {
    // no service worker
  }
  window.location.reload();
}

if (import.meta.env.PROD) {
  // a page's code chunk (or the stylesheet it needs) failed to load
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    void repair("chunk");
  });
  // the stylesheet never applied: its theme variables are missing once everything has loaded
  window.addEventListener("load", () => {
    if (!getComputedStyle(document.documentElement).getPropertyValue("--globe-sky").trim()) void repair("styles");
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

// offline shell and home-screen install; dev builds skip it so hot reload is never served stale
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        // browsers look for a new worker on their own schedule, which can take a day; ask on every start and
        // whenever the app comes back to the foreground, so a phone picks up a new version right away
        void registration.update();
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") void registration.update();
        });
      })
      .catch(() => {});
  });
  // a new worker took over from an older one: reload once, so nothing from the old cache stays on screen
  const hadWorker = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadWorker || reloading) return;
    reloading = true;
    window.location.reload();
  });
}

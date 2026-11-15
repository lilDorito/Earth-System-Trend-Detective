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

// the app has no offline cache any more: a service worker left by an earlier version (with stale or broken copies
// of files) is removed here with its caches, and a page it was still serving reloads once, fresh from the server
async function clearOfflineCache(): Promise<boolean> {
  let found = false;
  try {
    const keys = await caches.keys();
    found ||= keys.length > 0;
    await Promise.all(keys.map((key) => caches.delete(key)));
  } catch {
    // no cache storage
  }
  try {
    const registrations = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    found ||= registrations.length > 0;
    await Promise.all(registrations.map((r) => r.unregister()));
  } catch {
    // no service worker support
  }
  return found;
}

function reloadOnce(reason: string) {
  try {
    if (sessionStorage.getItem("reloaded")) return; // tried already in this tab: do not loop
    sessionStorage.setItem("reloaded", reason);
  } catch {
    // storage blocked: reload anyway
  }
  window.location.reload();
}

if (import.meta.env.PROD) {
  const servedByWorker = !!navigator.serviceWorker?.controller;
  void clearOfflineCache().then((found) => found && servedByWorker && reloadOnce("old offline cache"));
  // a page's code (or its stylesheet) failed to load, e.g. this tab was opened before a new deploy
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    void clearOfflineCache().then(() => reloadOnce("chunk"));
  });
  // the stylesheet never applied: its colour variables are missing once everything has loaded
  window.addEventListener("load", () => {
    if (!getComputedStyle(document.documentElement).getPropertyValue("--background").trim()) {
      void clearOfflineCache().then(() => reloadOnce("styles"));
    }
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

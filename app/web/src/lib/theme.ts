// the marshmallow theme phones get (see index.css): whether it is on, and its colours for canvases CSS cannot reach

import { useSyncExternalStore } from "react";

export const PHONE_QUERY = "(max-width: 639px)";

const query = typeof window !== "undefined" ? window.matchMedia(PHONE_QUERY) : null;

const subscribe = (onChange: () => void) => {
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
};

export const isPhoneTheme = () => !!query?.matches;

// re-renders when the screen crosses the phone width (rotating a tablet, resizing a window)
export const usePhoneTheme = () => useSyncExternalStore(subscribe, isPhoneTheme, () => false);

// a colour custom property as the page currently resolves it
export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

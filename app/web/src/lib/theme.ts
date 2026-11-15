// the app's theme: dark by default, or marshmallow (soft pink and buttery yellow), picked with the header switch.
// Marshmallow is a phone theme for now: it applies below the phone width only (see index.css). The choice is
// kept in localStorage and set as data-theme on <html>; index.html applies it before the first paint.

import { useSyncExternalStore } from "react";

export type ThemeChoice = "dark" | "marshmallow";

export const PHONE_QUERY = "(max-width: 639px)";
const STORAGE_KEY = "theme";
const BAR_COLOR = { dark: "#11151d", marshmallow: "#fbe8ef" }; // the phone browser's address bar

const query = typeof window !== "undefined" ? window.matchMedia(PHONE_QUERY) : null;
const listeners = new Set<() => void>();

function readChoice(): ThemeChoice {
  try {
    return localStorage.getItem(STORAGE_KEY) === "marshmallow" ? "marshmallow" : "dark";
  } catch {
    return "dark"; // storage blocked (private mode): the default theme
  }
}

let choice: ThemeChoice = readChoice();

// whether marshmallow is on screen right now: chosen, and on a phone-sized screen
export const isPhoneTheme = () => choice === "marshmallow" && !!query?.matches;

function apply() {
  document.documentElement.dataset.theme = choice;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BAR_COLOR[isPhoneTheme() ? "marshmallow" : "dark"]);
}

function notify() {
  apply();
  listeners.forEach((listener) => listener());
}

if (typeof window !== "undefined") {
  apply();
  query?.addEventListener("change", notify);
}

export function setTheme(next: ThemeChoice) {
  choice = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // not remembered, but still applied for this visit
  }
  notify();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// the saved choice, for the switch
export const useThemeChoice = () => useSyncExternalStore(subscribe, () => choice, () => "dark" as ThemeChoice);

// re-renders when marshmallow comes on screen or leaves it (switch flipped, or the screen crossing the phone width)
export const usePhoneTheme = () => useSyncExternalStore(subscribe, isPhoneTheme, () => false);

// a colour custom property as the page currently resolves it
export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// whether a media query matches, updated when the window changes

import { useEffect, useState } from "react";

export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

// below this the selection panels become a bottom sheet and the side panels stop sharing the screen
export const NARROW = "(max-width: 1023px)";
// from this width the globe fits between both side columns without shrinking
export const ROOMY = "(min-width: 1280px)";
// phone width: the phone app shows the essentials and folds the details away
export const PHONE = "(max-width: 639px)";

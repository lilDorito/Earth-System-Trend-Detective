// which country a point on the globe falls in: bounding boxes narrow it down, the outline decides

import type { Boundary } from "@/api/types";
import { loadBoundaries, loadOutline, loadRegionLevel, type Ring } from "./boundaries";

const inBox = (b: Boundary, lat: number, lon: number) =>
  lat >= b.south && lat <= b.north && (b.west <= b.east ? lon >= b.west && lon <= b.east : lon >= b.west || lon <= b.east);

// even-odd over all rings, so holes (enclaves, lakes) count as outside
export function inside(rings: Ring[], lat: number, lon: number) {
  let hit = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const [x1, y1, x2, y2] = [ring[i], ring[i + 1], ring[j], ring[j + 1]];
      if (y1 > lat !== y2 > lat && lon < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1) hit = !hit;
    }
  }
  return hit;
}

export async function adminAt(country: Boundary, lat: number, lon: number): Promise<Boundary | null> {
  const all = await loadRegionLevel();
  const candidates = all
    .filter((b) => b.country === country.country && inBox(b, lat, lon))
    .sort((a, b) => a.areaKm2 - b.areaKm2);
  for (const region of candidates) {
    if (inside(await loadOutline(region), lat, lon)) return region;
  }
  return null;
}

export async function countryAt(lat: number, lon: number): Promise<Boundary | null> {
  const all = await loadBoundaries();
  // smallest first: a small country inside a big one's box is checked before the big one
  const candidates = all.filter((b) => b.kind === "country" && inBox(b, lat, lon)).sort((a, b) => a.areaKm2 - b.areaKm2);
  const outlines = await Promise.all(candidates.map((c) => loadOutline(c).catch(() => [])));
  return candidates.find((_, i) => inside(outlines[i], lat, lon)) ?? null;
}

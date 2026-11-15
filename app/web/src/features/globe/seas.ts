// seas and oceans (Natural Earth marine areas) for ocean-only variables, where picking a country makes
// no sense. public/regions/seas.json lists them like boundaries; their outlines are in outlines/sea.json,
// so they draw and fly like a country. The API reads the same files for the regional mean.

import type { Boundary } from "@/api/types";
import { loadOutline } from "./boundaries";
import { inside } from "./countryAt";

type Row = { id: string; name: string; south: number; north: number; west: number; east: number; lat: number; lon: number; area_km2: number };

let cached: Promise<Boundary[]> | null = null;

export function loadSeas(): Promise<Boundary[]> {
  cached ??= fetch(`${import.meta.env.BASE_URL}regions/seas.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`seas.json: ${r.status}`);
      return r.json() as Promise<{ rows: Row[] }>;
    })
    .then(({ rows }) =>
      rows
        .map(({ area_km2, ...row }) => ({ ...row, kind: "country" as const, country: "sea", countryName: "", type: "Sea", areaKm2: area_km2 }))
        // smallest first: a bay is found before the ocean it opens onto
        .sort((a, b) => a.areaKm2 - b.areaKm2),
    )
    .catch((e) => {
      cached = null;
      throw e;
    });
  return cached;
}

/** the sea or ocean at a point, null on land */
export async function seaAt(lat: number, lon: number): Promise<Boundary | null> {
  for (const sea of await loadSeas()) {
    if (inside(await loadOutline(sea), lat, lon)) return sea;
  }
  return null;
}

// region index, search and outlines, static files written by scripts/ingest/regions.py

import type { BBox, Boundary } from "@/api/types";

export type Ring = number[]; // lon, lat, lon, lat, ...

type Indexed = Boundary & { key: string; altKey: string; countryKey: string };

const url = (path: string) => `${import.meta.env.BASE_URL}regions/${path}`;

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(url(path));
  if (!res.ok) throw new Error(`Could not load region data (${res.status})`);
  return res.json() as Promise<T>;
}

// accents and case ignored, so "kyiv" finds "Kyïv" and "sao" finds "São Paulo"
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

let indexCached: Promise<Indexed[]> | null = null;

export function loadBoundaries(): Promise<Boundary[]> {
  indexCached ??= fetchJson<{ columns: string[]; rows: (string | number)[][] }>("index.json")
    .then(({ columns, rows }) => {
      const at = Object.fromEntries(columns.map((c, i) => [c, i]));
      const names = new Map(rows.filter((r) => r[at.kind] === "c").map((r) => [r[at.id], String(r[at.name])]));
      return rows.map((r) => {
        const country = String(r[at.country]);
        const countryName = names.get(country) ?? country.toUpperCase();
        return {
          id: String(r[at.id]),
          name: String(r[at.name]),
          kind: r[at.kind] === "c" ? "country" : "admin1",
          country,
          countryName,
          type: String(r[at.type] ?? ""),
          lat: +r[at.lat],
          lon: +r[at.lon],
          south: +r[at.south],
          north: +r[at.north],
          west: +r[at.west],
          east: +r[at.east],
          areaKm2: +r[at.area_km2],
          key: fold(String(r[at.name])),
          altKey: at.name_uk == null ? "" : fold(String(r[at.name_uk] ?? "")),
          countryKey: fold(countryName),
        } satisfies Indexed;
      });
    })
    .catch((e) => {
      indexCached = null;
      throw e;
    });
  return indexCached;
}

function score(b: Indexed, q: string): number {
  if (b.key === q || b.altKey === q) return 0;
  if (b.key.startsWith(q) || b.altKey.startsWith(q)) return 1;
  if (b.key.includes(` ${q}`) || b.key.includes(`-${q}`) || b.altKey.includes(` ${q}`)) return 2;
  if (b.key.includes(q)) return 3;
  // "ukraine" also lists Ukraine's regions, after the country itself
  if (b.kind === "admin1" && b.countryKey.startsWith(q)) return 4;
  return -1;
}

export function searchBoundaries(all: Boundary[], query: string, limit = 8): Boundary[] {
  const q = fold(query.trim());
  if (!q) return [];
  return (all as Indexed[])
    .map((b) => [score(b, q), b] as const)
    .filter(([s]) => s >= 0)
    .sort(([sa, a], [sb, b]) => sa - sb || (a.kind === b.kind ? b.areaKm2 - a.areaKm2 : a.kind === "country" ? -1 : 1))
    .slice(0, limit)
    .map(([, b]) => b);
}

export function boundaryLabel(b: Boundary): string {
  return b.kind === "country" ? b.name : `${b.name}, ${b.countryName}`;
}

const outlinesCached = new Map<string, Promise<Record<string, Ring[]>>>();

// one file per country holds the country and its admin-1 regions
export function loadOutline(boundary: Pick<Boundary, "id" | "country">): Promise<Ring[]> {
  let file = outlinesCached.get(boundary.country);
  if (!file) {
    file = fetchJson<Record<string, Ring[]>>(`outlines/${boundary.country}.json`);
    file.catch(() => outlinesCached.delete(boundary.country));
    outlinesCached.set(boundary.country, file);
  }
  return file.then((outlines) => outlines[boundary.id] ?? []);
}

export function boxRings(box: Pick<BBox, "south" | "north" | "west" | "east">): Ring[] {
  // unwrapped east, so a box across 180 degrees stays one ring
  const width = (box.east - box.west + 360) % 360 || 360;
  const { south: s, north: n, west: w } = box;
  // all the way round: two circles of latitude, no seam, nothing drawn at a pole
  if (width >= 360) return [s, n].filter((lat) => Math.abs(lat) < 90).map((lat) => [w, lat, w + 360, lat]);
  return [[w, s, w + width, s, w + width, n, w, n, w, s]];
}

// a camera distance that roughly fits the area on screen
export function fitDistance(box: Pick<BBox, "south" | "north" | "west" | "east">): number {
  const width = ((box.east - box.west + 360) % 360 || 360) * Math.cos((((box.south + box.north) / 2) * Math.PI) / 180);
  const span = Math.max(box.north - box.south, width);
  return Math.min(3.2, Math.max(1.35, 1 + span / 28));
}

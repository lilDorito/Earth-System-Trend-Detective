// Natural Earth populated places -> src/features/globe/cities.json, with a per-country quota
// usage: node scripts/build-cities.mjs [path or URL to ne_10m_populated_places_simple.geojson]

import { readFile, writeFile } from "node:fs/promises";
import { geoArea, geoBounds, geoContains } from "d3-geo";
import { feature, mergeArcs } from "topojson-client";

const SOURCE =
  process.argv[2] ??
  "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_10m_populated_places_simple.geojson";
const OUT = new URL("../src/features/globe/cities.json", import.meta.url);
const EARTH_RADIUS_KM2 = 6371 ** 2;

// kept regardless of the quota
const alwaysInclude = new Set(["Sevastopol"]);

const renamed = {
  Odessa: "Odesa",
  Zaporizhzhya: "Zaporizhzhia",
  "Kryvyy Rih": "Kryvyi Rih",
  Mykolayiv: "Mykolaiv",
  Khmelnytskyy: "Khmelnytskyi",
  Vinnytsya: "Vinnytsia",
  Kirovohrad: "Kropyvnytskyi",
  Yevpatoriya: "Yevpatoriia",
  Dzhankoy: "Dzhankoi",
  Shenyeng: "Shenyang",
};

async function loadPlaces() {
  const text = SOURCE.startsWith("http") ? await (await fetch(SOURCE)).text() : await readFile(SOURCE, "utf8");
  return JSON.parse(text).features.map((f) => f.properties);
}

async function loadCountries() {
  const topology = JSON.parse(await readFile(new URL("../node_modules/world-atlas/countries-50m.json", import.meta.url)));
  const geometries = topology.objects.countries.geometries;
  const byName = (name) => geometries.find((g) => g.properties.name === name);
  const russia = byName("Russia");
  const ukraine = byName("Ukraine");
  const index = russia.arcs.findIndex((arcs) => geoContains(feature(topology, { type: "Polygon", arcs }), [34.2, 45.3]));
  if (index >= 0) {
    const [crimea] = russia.arcs.splice(index, 1);
    Object.assign(ukraine, { type: "MultiPolygon", arcs: mergeArcs(topology, [ukraine, { type: "Polygon", arcs: crimea }]).arcs });
  }
  return feature(topology, topology.objects.countries).features.map((f) => ({
    name: f.properties.name,
    feature: f,
    bounds: geoBounds(f),
    km2: geoArea(f) * EARTH_RADIUS_KM2,
  }));
}

const inBounds = ([[w, s], [e, n]], [lon, lat]) => lat >= s && lat <= n && (w <= e ? lon >= w && lon <= e : lon >= w || lon <= e);

const containing = (countries, point) => countries.find((c) => inBounds(c.bounds, point) && geoContains(c.feature, point));

// coastal cities can sit just outside the simplified outlines, so probe the nearby land
function countryOf(countries, place) {
  const { longitude: lon, latitude: lat } = place;
  for (const r of [0, 0.05, 0.1, 0.2, 0.35]) {
    for (let a = 0; a < (r ? 16 : 1); a++) {
      const angle = (a / 16) * 2 * Math.PI;
      const hit = containing(countries, [lon + r * Math.cos(angle), lat + r * Math.sin(angle)]);
      if (hit) return hit;
    }
  }
  return countries.find((c) => c.name === place.adm0name || c.name === place.sov0name);
}

const places = await loadPlaces();
const countries = await loadCountries();
const groups = new Map();

for (const place of places) {
  const country = countryOf(countries, place);
  if (!country || !place.pop_max) continue;
  if (!groups.has(country)) groups.set(country, []);
  groups.get(country).push(place);
}

const cities = [];
for (const [country, list] of groups) {
  list.sort((a, b) => b.pop_max - a.pop_max);
  const millions = list.filter((p) => p.pop_max >= 1_000_000).length;
  const quota = Math.min(60, Math.max(1, Math.round(2 * (country.km2 / 1e5) ** 0.7), millions));
  const picked = new Set(list.slice(0, quota));
  const capital = list.find((p) => p.adm0cap === 1);
  if (capital) picked.add(capital);
  list.filter((p) => alwaysInclude.has(p.name)).forEach((p) => picked.add(p));
  for (const p of picked) {
    cities.push([
      renamed[p.name] ?? p.name.replace(/\s+/g, " "),
      Number(p.latitude.toFixed(3)),
      Number(p.longitude.toFixed(3)),
      p.pop_max,
      p.adm0cap === 1 ? 1 : 0,
    ]);
  }
}

cities.sort((a, b) => b[3] - a[3]);
await writeFile(OUT, JSON.stringify(cities));
console.log(`${cities.length} cities from ${groups.size} countries -> ${OUT.pathname}`);

// borders, coastlines, country label anchors and cities from Natural Earth

import { geoArea, geoCentroid, geoContains } from "d3-geo";
import type { MultiLineString, MultiPolygon, Polygon, Position } from "geojson";
import { feature, mergeArcs, mesh } from "topojson-client";
import type { GeometryCollection, MultiPolygon as TopoMultiPolygon, Topology } from "topojson-specification";
import { Vector3 } from "three";
import { latLonToVector } from "./geo";

export type CountryLabel = { name: string; position: Vector3; normal: Vector3; area: number };

export type City = {
  name: string;
  lat: number;
  lon: number;
  position: Vector3;
  normal: Vector3;
  population: number;
  capital: boolean;
};

export type Countries = {
  borders: Float32Array;
  coasts: Float32Array;
  labels: CountryLabel[];
};

const LINE_RADIUS = 1.0008;
const LABEL_RADIUS = 1.002;
const MAX_STEP_DEG = 1;

const CRIMEA: [number, number] = [34.2, 45.3];

const renamed: Record<string, string> = {
  "United States of America": "United States",
  "Dem. Rep. Congo": "DR Congo",
  "Bosnia and Herz.": "Bosnia",
};

function toSegments(lines: Position[][]): Float32Array {
  const out: number[] = [];
  const push = (lon: number, lat: number) => {
    const v = latLonToVector(lat, lon, LINE_RADIUS);
    out.push(v.x, v.y, v.z);
  };
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const [lon0, lat0] = line[i - 1];
      const [lon1, lat1] = line[i];
      if (Math.abs(lon1 - lon0) > 180) continue;
      // split long edges so they follow the sphere instead of cutting through it
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(lon1 - lon0), Math.abs(lat1 - lat0)) / MAX_STEP_DEG));
      for (let k = 0; k < steps; k++) {
        const a = k / steps;
        const b = (k + 1) / steps;
        push(lon0 + (lon1 - lon0) * a, lat0 + (lat1 - lat0) * a);
        push(lon0 + (lon1 - lon0) * b, lat0 + (lat1 - lat0) * b);
      }
    }
  }
  return new Float32Array(out);
}

function labelAnchor(geometry: Polygon | MultiPolygon): { lon: number; lat: number } {
  if (geometry.type === "Polygon") {
    const [lon, lat] = geoCentroid(geometry);
    return { lon, lat };
  }
  // biggest part only, so e.g. France sits in Europe and not between it and Guiana
  const largest = geometry.coordinates
    .map((coordinates) => ({ type: "Polygon" as const, coordinates }))
    .reduce((best, p) => (geoArea(p) > geoArea(best) ? p : best));
  const [lon, lat] = geoCentroid(largest);
  return { lon, lat };
}

type CountriesTopology = Topology<{ countries: GeometryCollection<{ name: string }> }>;

// Natural Earth draws Crimea as part of Russia; move it back into Ukraine
function returnCrimea(topology: CountriesTopology) {
  const geometries = topology.objects.countries.geometries;
  const byName = (name: string) => geometries.find((g) => (g.properties as { name?: string })?.name === name);
  const russia = byName("Russia");
  const ukraine = byName("Ukraine");
  if (russia?.type !== "MultiPolygon" || !ukraine || (ukraine.type !== "Polygon" && ukraine.type !== "MultiPolygon")) return;

  const index = russia.arcs.findIndex((arcs) => geoContains(feature(topology, { type: "Polygon", arcs }), CRIMEA));
  if (index < 0) return;
  const [crimea] = russia.arcs.splice(index, 1);
  const merged = mergeArcs(topology, [ukraine, { type: "Polygon", arcs: crimea }]) as TopoMultiPolygon;
  Object.assign(ukraine, { type: "MultiPolygon", arcs: merged.arcs });
}

async function build(): Promise<Countries> {
  const source = (await import("world-atlas/countries-50m.json")).default as unknown as CountriesTopology;
  const topology = structuredClone(source);
  returnCrimea(topology);
  const countries = topology.objects.countries;

  const borders = mesh(topology, countries, (a, b) => a !== b) as MultiLineString;
  const coasts = mesh(topology, countries, (a, b) => a === b) as MultiLineString;

  const labels: CountryLabel[] = [];
  for (const f of feature(topology, countries).features) {
    if (!f.geometry || (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon")) continue;
    const { lon, lat } = labelAnchor(f.geometry);
    const position = latLonToVector(lat, lon, LABEL_RADIUS);
    const name = f.properties?.name ?? "";
    labels.push({ name: renamed[name] ?? name, position, normal: position.clone().normalize(), area: geoArea(f) });
  }
  labels.sort((a, b) => b.area - a.area);

  return { borders: toSegments(borders.coordinates), coasts: toSegments(coasts.coordinates), labels };
}

let cached: Promise<Countries> | null = null;

export function loadCountries() {
  cached ??= build();
  return cached;
}

let citiesCached: Promise<City[]> | null = null;

// built by scripts/build-cities.mjs: [name, lat, lon, population, capital]
export function loadCities() {
  citiesCached ??= import("./cities.json").then(({ default: rows }) =>
    (rows as [string, number, number, number, number][]).map(([name, lat, lon, population, capital]) => {
      const position = latLonToVector(lat, lon, LABEL_RADIUS);
      return { name, lat, lon, position, normal: position.clone().normalize(), population, capital: capital === 1 };
    }),
  );
  return citiesCached;
}

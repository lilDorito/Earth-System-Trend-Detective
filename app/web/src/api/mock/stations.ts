// synthetic weather stations

import { createRandom } from "@/lib/random";
import { STATION_ELEMENTS } from "@/features/stations/elements";
import type { StationCompare, StationElementKey, StationList, StationTrend } from "../types";
import { linearFit, round, twoSidedP } from "./stats";

const YEARS = Array.from({ length: 26 }, (_, i) => 2000 + i);
const COUNT = { TAVG: 420, PRCP: 480, AWND: 90 } satisfies Record<StationElementKey, number>;
const BASE_SLOPE = { TAVG: 0.32, PRCP: 0.8, AWND: -0.03 } satisfies Record<StationElementKey, number>;
const NOISE = { TAVG: 0.35, PRCP: 9, AWND: 0.12 } satisfies Record<StationElementKey, number>;
const MIN_YEARS = 20;

type Mock = { list: StationList; series: Map<string, (number | null)[]> };
const cache = new Map<StationElementKey, Mock>();

function trend(values: (number | null)[]): StationTrend | null {
  const x: number[] = [];
  const y: number[] = [];
  values.forEach((v, i) => v !== null && (x.push(YEARS[i]), y.push(v)));
  if (x.length < MIN_YEARS) return null;
  const fit = linearFit(x, y);
  const p = twoSidedP(fit.slope / fit.se);
  return {
    slope_decade: round(fit.slope * 10, 4),
    p: round(p, 4),
    significant: p < 0.05,
    significant_fdr: p < 0.02,
    n_years: x.length,
    fitted: YEARS.map((year, i) => (values[i] === null ? null : round(fit.intercept + fit.slope * year))),
  };
}

function build(element: StationElementKey): Mock {
  const rng = createRandom(`stations-${element}`);
  const series = new Map<string, (number | null)[]>();
  const list: StationList = {
    element,
    name: STATION_ELEMENTS[element].name,
    units: STATION_ELEMENTS[element].units,
    years: [YEARS[0], YEARS[YEARS.length - 1]],
    min_years: MIN_YEARS,
    scale: element === "TAVG" ? 1 : element === "PRCP" ? 10 : 0.2,
    ids: [],
    names: [],
    lat: [],
    lon: [],
    slope: [],
    p: [],
    significant: [],
    n_years: [],
  };
  for (let k = 0; k < COUNT[element]; k++) {
    const lat = round(Math.min(75, Math.max(-55, (Math.asin(rng.next() * 2 - 1) * 180) / Math.PI)), 3);
    const lon = round(-180 + 360 * rng.next(), 3);
    const start = rng.next() < 0.2 ? 2000 + Math.floor(rng.next() * 15) : 2000;
    const slope = (BASE_SLOPE[element] * (1 + Math.max(0, lat) / 60) + rng.normal(NOISE[element] / 3)) / 10;
    const values = YEARS.map((year) => (year < start || rng.next() < 0.04 ? null : round(slope * (year - 2012) + rng.normal(NOISE[element]))));
    const id = `MOCK:${element}${String(k).padStart(4, "0")}`;
    const t = trend(values);
    series.set(id, values);
    list.ids.push(id);
    list.names.push(`Station ${k + 1}, XX`);
    list.lat.push(lat);
    list.lon.push(lon);
    list.slope.push(t ? t.slope_decade : null);
    list.p.push(t ? t.p : null);
    list.significant.push(!!t?.significant_fdr);
    list.n_years.push(values.filter((v) => v !== null).length);
  }
  return { list, series };
}

const get = (element: StationElementKey) => {
  let mock = cache.get(element);
  if (!mock) cache.set(element, (mock = build(element)));
  return mock;
};

export const stations = (element: StationElementKey): StationList => get(element).list;

export function stationCompare(id: string, variable: string | null, element: StationElementKey): StationCompare {
  const { list, series } = get(element);
  const k = list.ids.indexOf(id);
  if (k < 0) throw new Error(`Station ${id} not found`);
  const station = series.get(id)!;
  const rng = createRandom(id);
  const grid = station.map((v) => (v === null ? null : round(v * 0.8 + rng.normal(NOISE[element] * 0.4))));
  const both = station.flatMap((v, i) => (v !== null && grid[i] !== null ? [[v, grid[i]!]] : []));
  const fit = both.length >= 5 ? linearFit(both.map((b) => b[0]), both.map((b) => b[1])) : null;
  const stationTrend = trend(station);
  const gridTrend = trend(grid);
  const lat = list.lat[k];
  const lon = list.lon[k];
  return {
    id,
    name: list.names[k],
    country: "XX",
    lat,
    lon,
    elevation: 120,
    element,
    element_name: STATION_ELEMENTS[element].name,
    units: STATION_ELEMENTS[element].units,
    years: YEARS,
    min_years: MIN_YEARS,
    station,
    station_trend: stationTrend,
    grid: variable
      ? {
          variable,
          name: "Mock grid",
          lat: Math.floor(lat) + 0.5,
          lon: Math.floor(lon) + 0.5,
          distance_km: 40,
          values: grid,
          trend: gridTrend,
          r: fit ? round(fit.r, 3) : null,
          common_years: both.length,
          difference_decade: stationTrend && gridTrend ? stationTrend.slope_decade - gridTrend.slope_decade : undefined,
        }
      : null,
  };
}

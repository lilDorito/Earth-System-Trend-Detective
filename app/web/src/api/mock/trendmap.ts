// synthetic global trend field for /map

import { createRandom } from "@/lib/random";
import { REGIONS, type RegionName } from "../regions";
import type {
  GlobalMean,
  GridGeometry,
  TrendFrames,
  TrendGrid,
  TrendMeta,
  TrendPoint,
  TrendRegion,
  TrendRegionQuery,
  TrendVariable,
  FlowField,
  TrendFlow,
} from "../types";
import { linearFit, rollingMean, round, twoSidedP } from "./stats";

const STEP = 2.5;
const FIRST_YEAR = 2000;
const BASELINE_YEARS = 5;
const YEARS = Array.from({ length: 25 }, (_, i) => FIRST_YEAR + i);
const LATS = Array.from({ length: 180 / STEP + 1 }, (_, i) => -90 + i * STEP);
const LONS = Array.from({ length: 360 / STEP }, (_, i) => -180 + i * STEP);

const GEOMETRY: GridGeometry = { lat0: -90, lon0: -180, dlat: STEP, dlon: STEP };
const VARIABLE: TrendVariable = { key: "merra2_t2m", name: "Air temperature (2 m)", units: "°C", group: "atmosphere", domain: "global" };

const rad = (deg: number) => (deg * Math.PI) / 180;
const cosWeights = LATS.map((lat) => Math.cos(rad(lat)));
const bump = (lat: number, lon: number, lat0: number, lon0: number, dLat: number, dLon: number) =>
  Math.exp(-(((lat - lat0) / dLat) ** 2) - ((lon - lon0) / dLon) ** 2);

function trendPerDecade(lat: number, lon: number) {
  const arctic = 0.8 * Math.min(Math.max((lat - 45) / 40, 0), 1);
  const waves = 0.15 * Math.sin(rad(lon * 2)) * Math.cos(rad(lat * 3)) + 0.1 * Math.cos(rad(lon - 30));
  const warmingHole = -0.7 * bump(lat, lon, 55, -35, 9, 20);
  const coldTongue = -0.45 * bump(lat, lon, -2, -115, 8, 35);
  const southernOcean = -0.4 * bump(lat, lon, -62, 0, 9, 400);
  const europe = 0.35 * bump(lat, lon, 48, 20, 12, 28);
  const sahara = 0.3 * bump(lat, lon, 25, 10, 10, 30);
  return 0.12 + arctic + waves + warmingHole + coldTongue + southernOcean + europe + sahara;
}

type Field = {
  values: Float32Array;
  slope: number[];
  sig: number[];
  p: number[];
};

let field: Field | null = null;

function getField(): Field {
  if (field) return field;
  const rng = createRandom(42);
  const cells = LATS.length * LONS.length;
  const values = new Float32Array(cells * YEARS.length);
  const slope: number[] = [];
  const sig: number[] = [];
  const p: number[] = [];
  const x = YEARS.map((_, k) => k);

  LATS.forEach((lat, i) => {
    const base = 30 * Math.cos(rad(lat)) - 14;
    const sd = 0.1 + 0.25 * Math.abs(Math.sin(rad(lat)));
    LONS.forEach((lon, j) => {
      const cell = i * LONS.length + j;
      const trend = trendPerDecade(lat, lon) / 10;
      const series: number[] = [];
      let noise = 0;
      for (let k = 0; k < YEARS.length; k++) {
        noise = 0.3 * noise + rng.normal(sd);
        series.push(base + trend * k + noise);
        values[k * cells + cell] = series[k];
      }
      const fit = linearFit(x, series);
      const t = Math.abs(fit.slope / fit.se);
      slope.push(round(fit.slope * 10));
      p.push(twoSidedP(t));
      sig.push(t > 3 ? 1 : 0);
    });
  });

  field = { values, slope, sig, p };
  return field;
}

function seriesAt(i: number, j: number): number[] {
  const { values } = getField();
  const cells = LATS.length * LONS.length;
  const cell = i * LONS.length + j;
  return YEARS.map((_, k) => values[k * cells + cell]);
}

function summarize(values: number[]) {
  const fit = linearFit(YEARS.map((_, k) => k), values);
  const p = twoSidedP(fit.slope / fit.se);
  return {
    fitted: values.map((_, k) => round(fit.intercept + fit.slope * k)),
    trend: p >= 0.05 ? "no trend" : fit.slope > 0 ? "increasing" : "decreasing",
    p,
    slope_decade: fit.slope * 10,
  };
}

const nearest = (axis: number[], value: number) =>
  axis.reduce((best, v, i) => (Math.abs(v - value) < Math.abs(axis[best] - value) ? i : best), 0);

export function trendVariables(): TrendVariable[] {
  return [VARIABLE];
}

export function trendMeta(): TrendMeta {
  return {
    ...VARIABLE,
    demo: true,
    variable: VARIABLE.key,
    years: [YEARS[0], YEARS[YEARS.length - 1]],
    n_lat: LATS.length,
    n_lon: LONS.length,
    trend_scale: 0.6,
    anomaly_scale: 2,
    value_range: [-12, 16],
  };
}

export function trendGrid(): TrendGrid {
  const { slope, sig } = getField();
  return { ...GEOMETRY, n_lat: LATS.length, n_lon: LONS.length, slope, sig };
}

export function trendGlobalMean(): GlobalMean {
  const field = getField().values;
  const cells = LATS.length * LONS.length;
  const total = cosWeights.reduce((a, b) => a + b, 0) * LONS.length;
  const values = YEARS.map((_, k) => {
    let sum = 0;
    for (let cell = 0; cell < cells; cell++) sum += field[k * cells + cell] * cosWeights[Math.floor(cell / LONS.length)];
    return sum / total;
  });
  return { years: YEARS, values: values.map((v) => round(v)), ...summarize(values) };
}

export function trendPoint(lat: number, lon: number): TrendPoint {
  const i = nearest(LATS, lat);
  const j = nearest(LONS, ((lon + 540) % 360) - 180);
  const values = seriesAt(i, j);
  const summary = summarize(values);
  return {
    lat: LATS[i],
    lon: LONS[j],
    years: YEARS,
    values: values.map((v) => round(v)),
    rolling: rollingMean(values, 5).map((v) => (v === null ? null : round(v))),
    ...summary,
    significant_hr: summary.p < 0.05,
    significant_fdr: getField().sig[i * LONS.length + j] === 1,
  };
}

export function trendFrames(kind: "anomaly" | "values" = "anomaly"): TrendFrames {
  const { values } = getField();
  const cells = LATS.length * LONS.length;
  const baseline = new Float64Array(cells);
  for (let cell = 0; cell < cells; cell++) {
    for (let k = 0; k < BASELINE_YEARS; k++) baseline[cell] += values[k * cells + cell] / BASELINE_YEARS;
  }
  const total = cosWeights.reduce((a, b) => a + b, 0) * LONS.length;
  const frames: number[][] = [];
  const globalMean: number[] = [];
  YEARS.forEach((_, k) => {
    const frame: number[] = new Array(cells);
    let sum = 0;
    for (let cell = 0; cell < cells; cell++) {
      const anomaly = values[k * cells + cell] - (kind === "values" ? 0 : baseline[cell]);
      frame[cell] = round(anomaly, 2);
      sum += anomaly * cosWeights[Math.floor(cell / LONS.length)];
    }
    frames.push(frame);
    globalMean.push(round(sum / total));
  });
  return {
    kind,
    start: YEARS[0],
    end: YEARS[YEARS.length - 1],
    years: YEARS,
    baseline: [YEARS[0], YEARS[BASELINE_YEARS - 1]],
    ...GEOMETRY,
    n_lat: LATS.length,
    n_lon: LONS.length,
    frames,
    global_mean: globalMean,
  };
}

// presets by name, anything else (boundaries, drawn boxes) by its box; cells count by centre
export function trendRegion(query: TrendRegionQuery): TrendRegion {
  const preset = query.name && query.name in REGIONS ? REGIONS[query.name as RegionName] : null;
  if (!preset && !query.box) throw new Error(`Unknown region: ${query.name}`);
  const [south, north, west, east] = preset ? preset.bbox : [query.box!.south, query.box!.north, query.box!.west, query.box!.east];
  const label = preset?.label ?? query.label ?? "Custom area";
  const name = query.name ?? "box";
  const inLon = (lon: number) => (west <= east ? lon >= west && lon <= east : lon >= west || lon <= east);
  const { values, slope } = getField();
  const cells = LATS.length * LONS.length;

  const members: number[] = [];
  LATS.forEach((lat, i) =>
    LONS.forEach((lon, j) => {
      if (lat >= south && lat <= north && inLon(lon)) members.push(i * LONS.length + j);
    }),
  );
  if (!members.length) throw new Error("The mock grid (2.5 degrees) has no cell centre inside this area");

  const weight = (cell: number) => cosWeights[Math.floor(cell / LONS.length)];
  const weightSum = members.reduce((sum, cell) => sum + weight(cell), 0);
  const mean = YEARS.map((_, k) => members.reduce((sum, cell) => sum + values[k * cells + cell] * weight(cell), 0) / weightSum);
  const world = trendGlobalMean();
  const region = summarize(mean);
  const warming = members.reduce((sum, cell) => sum + (slope[cell] > 0 ? weight(cell) : 0), 0) / weightSum;

  return {
    name,
    label,
    bbox: [south, north, west, east],
    n_cells: members.length,
    start: YEARS[0],
    end: YEARS[YEARS.length - 1],
    years: YEARS,
    mean: mean.map((v) => round(v)),
    fitted: region.fitted,
    global_mean: world.values,
    trend: region.trend as TrendRegion["trend"],
    p: region.p,
    autocorr_corrected: false,
    slope_decade: region.slope_decade,
    total_change: region.slope_decade * ((YEARS.length - 1) / 10),
    global_slope_decade: world.slope_decade,
    ratio: Math.abs(world.slope_decade) < 0.02 ? null : region.slope_decade / world.slope_decade,
    share_warming: warming,
  };
}

export function trendFlow(field: FlowField): TrendFlow {
  const scale = field === "wind" ? 1 : 0.05;
  const u: number[] = [];
  const v: number[] = [];
  LATS.forEach((lat) =>
    LONS.forEach((lon) => {
      const phi = rad(lat);
      u.push(round(scale * (-6 * Math.cos(3 * phi) * Math.cos(phi) + 1.5 * Math.sin(rad(lon * 2))), 3));
      v.push(round(scale * (-2.5 * Math.sin(6 * phi) * Math.cos(phi) + Math.cos(rad(lon * 3 + lat))), 3));
    }),
  );
  return { ...GEOMETRY, field, start: YEARS[0], end: YEARS[YEARS.length - 1], n_lat: LATS.length, n_lon: LONS.length, u, v };
}

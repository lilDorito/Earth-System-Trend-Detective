// synthetic global trend field for /map

import { createRandom } from "@/lib/random";
import type { GlobalMean, TrendGrid, TrendMeta, TrendPoint } from "../types";
import { linearFit, rollingMean, round, twoSidedP } from "./stats";

const STEP = 2.5;
const FIRST_YEAR = 2000;
const YEARS = Array.from({ length: 25 }, (_, i) => FIRST_YEAR + i);
const LATS = Array.from({ length: 180 / STEP + 1 }, (_, i) => -90 + i * STEP);
const LONS = Array.from({ length: 360 / STEP }, (_, i) => -180 + i * STEP);

const rad = (deg: number) => (deg * Math.PI) / 180;
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

export function trendMeta(): TrendMeta {
  return { demo: true, variable: "T2M", units: "°C", years: [YEARS[0], YEARS[YEARS.length - 1]], n_lat: LATS.length, n_lon: LONS.length };
}

export function trendGrid(): TrendGrid {
  const { slope, sig } = getField();
  return { n_lat: LATS.length, n_lon: LONS.length, slope, sig };
}

export function trendGlobalMean(): GlobalMean {
  const field = getField().values;
  const cells = LATS.length * LONS.length;
  const weights = LATS.map((lat) => Math.cos(rad(lat)));
  const total = weights.reduce((a, b) => a + b, 0) * LONS.length;
  const values = YEARS.map((_, k) => {
    let sum = 0;
    for (let cell = 0; cell < cells; cell++) sum += field[k * cells + cell] * weights[Math.floor(cell / LONS.length)];
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

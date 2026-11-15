// fake /api/analyze: synthetic series and stats

import { formatDate, formatNumber, formatSigned, locationCenter } from "@/lib/format";
import { createRandom } from "@/lib/random";
import type { AnalyzeRequest, AnalyzeResponse, EventResult, SeriesPoint, TrendResult } from "../types";
import { variables } from "./catalog";
import { linearFit, mean, round, twoSidedP, variance } from "./stats";

type Profile = { base: number; amplitude: number; trend: number; noise: number; eventShift: number; floor?: number };

function profileFor(key: string, lat: number): Profile {
  const coslat = Math.cos((lat * Math.PI) / 180);
  switch (key) {
    case "air_temperature":
      return { base: 30 * coslat - 13, amplitude: 3 + 12 * (1 - coslat), trend: 0.35, noise: 1.1, eventShift: 0 };
    case "soil_moisture":
      return { base: 26, amplitude: 5, trend: -0.7, noise: 1.4, eventShift: 0, floor: 2 };
    case "precipitation":
      return { base: 55, amplitude: 18, trend: 0.8, noise: 14, eventShift: 0, floor: 0 };
    case "no2_column":
      return { base: 3e15, amplitude: 0.9e15, trend: -1.5e14, noise: 3.5e14, eventShift: -0.85e15, floor: 2e14 };
    case "sea_surface_temperature":
      return { base: 28 * coslat - 6, amplitude: 1 + 5 * (1 - coslat), trend: 0.2, noise: 0.4, eventShift: 0 };
    case "sea_level":
      return { base: 0, amplitude: 40, trend: 35, noise: 25, eventShift: 0 };
    default:
      return { base: 10, amplitude: 3, trend: 0.2, noise: 1, eventShift: 0 };
  }
}

function monthRange(start: string, end: string): number[] {
  const from = new Date(start);
  const to = Date.parse(end);
  const months: number[] = [];
  for (let d = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1); d <= to; ) {
    months.push(d);
    const next = new Date(d);
    d = Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 1);
  }
  return months;
}

const yearsBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (365.25 * 86_400_000);

export function analyze(req: AnalyzeRequest): AnalyzeResponse {
  const variable = variables.find((v) => v.key === req.variable);
  if (!variable) throw new Error(`Unknown variable '${req.variable}'`);

  // a region has no geometry here; any mid-latitude place gives a plausible series
  const { lat, lon } = locationCenter(req.location) ?? { lat: 45, lon: 0 };
  const place = req.location.type === "region" ? req.location.id : `${lat.toFixed(2)}|${lon.toFixed(2)}`;
  const rng = createRandom(`${variable.key}|${place}`);
  const profile = profileFor(variable.key, lat);
  const start = req.start > variable.coverage_start ? req.start : variable.coverage_start;
  const months = monthRange(start, req.end);
  if (months.length < 24) throw new Error(`Pick a period of at least two years. ${variable.name} starts in ${formatDate(variable.coverage_start)}.`);

  const trend = profile.trend * (1.5 * rng.next() - 0.2);
  const shift = profile.eventShift || rng.normal(profile.noise * 0.4);
  const eventTime = req.mode === "event" && req.event_date ? Date.parse(req.event_date) : null;
  const hemisphere = lat < 0 ? -1 : 1;

  let noise = 0;
  const values = months.map((time, i) => {
    noise = 0.35 * noise + rng.normal(profile.noise);
    const month = new Date(time).getUTCMonth();
    const season = profile.amplitude * Math.sin((2 * Math.PI * (month - 3)) / 12) * hemisphere;
    const step = eventTime !== null && time >= eventTime ? shift : 0;
    const value = profile.base + season + (trend * i) / 120 + step + noise;
    return profile.floor === undefined ? value : Math.max(profile.floor, value);
  });

  const byMonth = Array.from({ length: 12 }, (_, m) => mean(values.filter((_, i) => new Date(months[i]).getUTCMonth() === m)));
  const series: SeriesPoint[] = months.map((time, i) => {
    const climatology = byMonth[new Date(time).getUTCMonth()];
    return { time: new Date(time).toISOString(), value: values[i], climatology, anomaly: values[i] - climatology };
  });

  const deseasonalize = req.deseasonalize ?? true;
  const result =
    req.mode === "event" && req.event_date
      ? eventResult(series, variable.units, req.event_date, deseasonalize)
      : trendResult(series, variable.units, deseasonalize);

  return {
    meta: {
      variable_key: variable.key,
      variable_id: variable.variable_id,
      variable_name: variable.name,
      units_raw: variable.units_raw,
      units: variable.units,
      resolution: "monthly",
      location: req.location,
      grid_lat: req.location.type === "point" ? Math.round(lat * 2) / 2 : null,
      grid_lon: req.location.type === "point" ? Math.round(lon * 2) / 2 : null,
      region_name: req.region_name ?? null,
      source: "mock",
      from_cache: false,
      fetched_at: new Date().toISOString(),
    },
    series,
    result,
  };
}

function trendResult(series: SeriesPoint[], units: string, deseasonalize: boolean): TrendResult {
  const first = series[0].time;
  const last = series[series.length - 1].time;
  const x = series.map((p) => yearsBetween(first, p.time));
  const y = series.map((p) => (deseasonalize ? p.anomaly! : p.value!));
  const fit = linearFit(x, y);
  const offset = deseasonalize ? mean(series.map((p) => p.climatology!)) : 0;

  const slope = fit.slope * 10;
  const ciLow = slope - 1.96 * fit.se * 10;
  const ciHigh = slope + 1.96 * fit.se * 10;
  const p = twoSidedP(fit.slope / fit.se);
  const significant = p < 0.05;
  const span = x[x.length - 1];
  const year = new Date(first).getUTCFullYear();

  const verdict = significant
    ? `${slope > 0 ? "Rising" : "Falling"} by about ${formatNumber(Math.abs(slope))} ${units} per decade since ${year} (95% CI ${formatNumber(ciLow)} to ${formatNumber(ciHigh)}). A change this steady is very unlikely to be random noise.`
    : `No clear trend. The best estimate is ${formatSigned(slope)} ${units} per decade, but normal year-to-year variation could easily produce that.`;

  return {
    mode: "trend",
    n: series.length,
    start: first.slice(0, 10),
    end: last.slice(0, 10),
    units,
    alpha: 0.05,
    slope_per_decade: slope,
    ci_low: ciLow,
    ci_high: ciHigh,
    p_value: p,
    significant,
    mk_trend: significant ? (slope > 0 ? "increasing" : "decreasing") : "no trend",
    mk_tau: round((2 / Math.PI) * Math.asin(fit.r)),
    mk_p: p,
    sen_slope_per_decade: slope,
    total_change: fit.slope * span,
    deseasonalized: deseasonalize,
    autocorr_corrected: false,
    fit_line: [
      [first, fit.intercept + offset],
      [last, fit.intercept + fit.slope * span + offset],
    ],
    verdict,
  };
}

function eventResult(series: SeriesPoint[], units: string, eventDate: string, deseasonalize: boolean): EventResult {
  const cut = Date.parse(eventDate);
  const pick = (p: SeriesPoint) => (deseasonalize ? p.anomaly! : p.value!);
  const beforePoints = series.filter((p) => Date.parse(p.time) < cut);
  const afterPoints = series.filter((p) => Date.parse(p.time) >= cut);
  if (beforePoints.length < 6 || afterPoints.length < 6) throw new Error("Leave at least six months on each side of the event date.");

  const before = beforePoints.map(pick);
  const after = afterPoints.map(pick);
  const beforeMean = mean(before);
  const afterMean = mean(after);
  const diff = afterMean - beforeMean;
  const se = Math.sqrt(variance(before) / before.length + variance(after) / after.length);
  const t = diff / se;
  const p = twoSidedP(t);
  const significant = p < 0.05;
  const baseline = mean(beforePoints.map((point) => point.value!));
  const pct = baseline ? (diff / baseline) * 100 : null;
  const when = formatDate(eventDate);

  const verdict = significant
    ? `After ${when} the average went ${diff > 0 ? "up" : "down"} by ${formatNumber(Math.abs(diff))} ${units}${pct === null ? "" : ` (${formatSigned(pct, 0)}%)`}. That jump is bigger than normal month-to-month variation.`
    : `The average after ${when} differs by ${formatSigned(diff)} ${units}, which is within normal month-to-month variation.`;

  return {
    mode: "event",
    event_date: eventDate,
    n_before: before.length,
    n_after: after.length,
    units,
    alpha: 0.05,
    before_mean: beforeMean,
    after_mean: afterMean,
    diff,
    pct_change: pct,
    diff_ci_low: diff - 1.96 * se,
    diff_ci_high: diff + 1.96 * se,
    t_stat: t,
    p_value: p,
    significant,
    deseasonalized: deseasonalize,
    verdict,
  };
}

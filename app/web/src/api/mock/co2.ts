// synthetic Keeling curve: steady rise plus the seasonal cycle

import type { Co2Series } from "../types";

let cache: Co2Series | null = null;

export function trendCo2(): Co2Series {
  if (cache) return cache;
  const months: string[] = [];
  const monthly: number[] = [];
  const maunaLoa: number[] = [];
  for (let k = 0; k < 26 * 12; k++) {
    const year = 2000 + Math.floor(k / 12);
    const t = k / 12;
    const trend = 369.5 + 1.75 * t + 0.012 * t * t;
    const season = Math.sin((2 * Math.PI * (k % 12 - 1)) / 12);
    months.push(`${year}-${String((k % 12) + 1).padStart(2, "0")}`);
    monthly.push(+(trend + 1.6 * season).toFixed(2));
    maunaLoa.push(+(trend + 0.9 + 3.1 * season).toFixed(2));
  }
  const years = Array.from({ length: 26 }, (_, i) => 2000 + i);
  const ppm = years.map((_, i) => +(monthly.slice(i * 12, i * 12 + 12).reduce((a, b) => a + b, 0) / 12).toFixed(2));
  const slope = (ppm[ppm.length - 1] - ppm[0]) / (years.length - 1);
  cache = {
    source: "synthetic series",
    years,
    ppm,
    fitted: years.map((_, i) => +(ppm[0] + slope * i).toFixed(2)),
    growth: ppm.map((v, i) => (i === 0 ? null : +(v - ppm[i - 1]).toFixed(2))),
    slope_decade: slope * 10,
    months,
    monthly,
    mauna_loa: maunaLoa,
  };
  return cache;
}

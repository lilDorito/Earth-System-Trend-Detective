// one plain sentence for a trend, e.g. "Precipitation in Sahel rose by 3.1 mm/month per decade (2000-2025);
// the trend is significant at 95%."

import { formatNumber } from "./format";

type TrendFacts = {
  name: string; // variable name, e.g. "Precipitation (IMERG Final)"
  place: string; // "Sahel", "this grid cell"
  units: string;
  slopeDecade: number;
  significant: boolean;
  start: number;
  end: number;
};

// "Precipitation (IMERG Final)" -> "precipitation", keeping acronyms ("2 m air temperature (MERRA-2)" -> "2 m air temperature")
export function plainName(name: string): string {
  const base = name.split(" (")[0].split(",")[0];
  return /^[A-Z][a-z]/.test(base) ? base[0].toLowerCase() + base.slice(1) : base;
}

export function describeTrend(f: TrendFacts): string {
  const what = plainName(f.name);
  const subject = what[0].toUpperCase() + what.slice(1);
  const size = formatNumber(Math.abs(f.slopeDecade));
  const span = `${f.start}-${f.end}`;
  if (!Number.isFinite(f.slopeDecade) || Math.abs(f.slopeDecade) < 1e-9) {
    return `${subject} in ${f.place} shows no change (${span}).`;
  }
  const verb = f.slopeDecade > 0 ? "rose" : "fell";
  return f.significant
    ? `${subject} in ${f.place} ${verb} by ${size} ${f.units} per decade (${span}); the trend is significant at 95%.`
    : `${subject} in ${f.place} ${verb} by ${size} ${f.units} per decade (${span}), but that is within normal year-to-year variation.`;
}

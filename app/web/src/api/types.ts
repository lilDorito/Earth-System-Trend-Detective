// Mirror of src/contracts.py + app/api/schemas.py. Change both in the same PR.

export type Resolution = "hourly" | "3-hourly" | "daily" | "monthly";
export type SourceName = "giovanni_point" | "harmony_area" | "firms" | "appeears" | "mock";
export type Mode = "trend" | "event";

export type Point = { type: "point"; lat: number; lon: number };
export type BBox = { type: "bbox"; west: number; south: number; east: number; north: number };
export type Location = Point | BBox;

export type VariableInfo = {
  key: string;
  variable_id: string;
  source: SourceName;
  name: string;
  short_definition: string;
  units_raw: string;
  units: string;
  conversion: string;
  resolution: Resolution;
  coverage_start: string; // ISO date
  coverage_end: string | null;
  land_only: boolean;
  region_tags: string[];
};

export type Region = { name: string; location: Location };
export type RegionType = { label: string; hint: string; suggest: string[] };

export type Demo = {
  id: string;
  title: string;
  story: string;
  variable: string;
  region: string;
  compare_region?: string;
  start: string;
  end: string;
  mode: Mode;
  event_date?: string;
};

export type SeriesMeta = {
  variable_key: string;
  variable_id: string;
  variable_name: string;
  units_raw: string;
  units: string;
  resolution: Resolution;
  location: Location;
  grid_lat: number | null;
  grid_lon: number | null;
  region_name: string | null;
  source: SourceName;
  from_cache: boolean;
  fetched_at: string;
};

export type SeriesPoint = {
  time: string;
  value: number | null;
  climatology: number | null;
  anomaly: number | null;
};

export type TrendResult = {
  mode: "trend";
  n: number;
  start: string;
  end: string;
  units: string;
  alpha: number;
  slope_per_decade: number;
  ci_low: number;
  ci_high: number;
  p_value: number;
  significant: boolean;
  mk_trend: "increasing" | "decreasing" | "no trend";
  mk_tau: number;
  mk_p: number;
  sen_slope_per_decade: number;
  total_change: number;
  deseasonalized: boolean;
  autocorr_corrected: boolean;
  fit_line: [string, number][];
  verdict: string;
};

export type EventResult = {
  mode: "event";
  event_date: string;
  n_before: number;
  n_after: number;
  units: string;
  alpha: number;
  before_mean: number;
  after_mean: number;
  diff: number;
  pct_change: number | null;
  diff_ci_low: number;
  diff_ci_high: number;
  t_stat: number;
  p_value: number;
  significant: boolean;
  deseasonalized: boolean;
  verdict: string;
};

export type AnalysisResult = TrendResult | EventResult;

export type AnalyzeRequest = {
  variable: string;
  location: Location;
  start: string;
  end: string;
  mode?: Mode;
  event_date?: string | null;
  deseasonalize?: boolean;
  region_name?: string | null;
};

export type AnalyzeResponse = {
  meta: SeriesMeta;
  series: SeriesPoint[];
  result: AnalysisResult;
};

// Trend map (src/gridtrends.py, app/api/trendmap.py)

export type TrendMeta = {
  demo: boolean; // true = synthetic field, data/grid/annual.npz is missing
  variable: string;
  units: string;
  years: [number, number];
  n_lat: number;
  n_lon: number;
};

export type TrendGrid = {
  n_lat: number;
  n_lon: number;
  slope: (number | null)[]; // °C per decade, latitude ascending then longitude
  sig: number[]; // 1 = significant at FDR 5%
};

export type TrendPoint = {
  lat: number;
  lon: number;
  years: number[];
  values: (number | null)[];
  fitted: (number | null)[];
  rolling: (number | null)[];
  trend: string;
  p: number;
  slope_decade: number;
  significant_hr: boolean;
  significant_fdr: boolean;
};

export type GlobalMean = {
  years: number[];
  values: (number | null)[];
  fitted: (number | null)[];
  trend: string;
  p: number;
  slope_decade: number;
};

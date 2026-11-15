// API types, mirror src/contracts.py and app/api/schemas.py

export type Resolution = "hourly" | "3-hourly" | "daily" | "monthly";
export type SourceName = "giovanni_point" | "harmony_area" | "nasa_power" | "hf_grid" | "firms" | "appeears" | "mock";
export type Mode = "trend" | "event";

export type Point = { type: "point"; lat: number; lon: number };
export type BBox = { type: "bbox"; west: number; south: number; east: number; north: number };
export type RegionLocation = { type: "region"; id: string };
export type Location = Point | BBox | RegionLocation;

// a Natural Earth country or admin-1 region (public/regions/index.json, /api/boundaries)
export type Boundary = {
  id: string;
  name: string;
  kind: "country" | "admin1";
  country: string;
  countryName: string;
  type: string;
  lat: number;
  lon: number;
  south: number;
  north: number;
  west: number; // west > east: across 180 degrees
  east: number;
  areaKm2: number;
};

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
  group: "atmosphere" | "land" | "ocean"; // heading in the explorer's list
  typical_range: [number, number] | null; // 2nd-98th percentile in display units; shapes mock data
  coverage_start: string;
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
  cells?: number | null;
  coverage?: number | null;
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

export type TrendVariable = {
  key: string;
  name: string;
  units: string;
  group: "atmosphere" | "land" | "ocean";
  domain: "global" | "land" | "ocean";
  start?: string;
  end?: string;
};

export type TrendMeta = {
  demo: boolean;
  key: string;
  name: string;
  label?: string; // what the numbers are and where they come from (set by the API)
  group: TrendVariable["group"];
  domain: TrendVariable["domain"];
  variable: string;
  units: string;
  years: [number, number];
  n_lat: number;
  n_lon: number;
  trend_scale: number; // colour scale limit, units per decade
  anomaly_scale: number; // colour scale limit in the year-by-year view
  value_range: [number, number]; // 2nd and 98th percentile of the annual maps, for the values view
};

// first cell centre and spacing in degrees: pole-to-pole (-90, 2.5) or cell-centred (-89.5, 1) grids
export type GridGeometry = { lat0: number; lon0: number; dlat: number; dlon: number };

export type TrendGrid = GridGeometry & {
  n_lat: number;
  n_lon: number;
  // row-major, latitude ascending, units per decade; null where a cell has no data
  slope: (number | null)[];
  sig: number[];
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

export type TrendFrames = GridGeometry & {
  kind?: "anomaly" | "values";
  start: number;
  end: number;
  years: number[];
  baseline: [number, number]; // years whose mean is the reference
  n_lat: number;
  n_lon: number;
  // per year: anomaly vs the baseline (or the value itself), latitude ascending then longitude
  frames: (number | null)[][];
  // area-weighted global mean anomaly per year
  global_mean: (number | null)[];
};

// mean 10 m wind vector over the period, m/s
export type TrendWind = GridGeometry & {
  start: number;
  end: number;
  n_lat: number;
  n_lon: number;
  u: (number | null)[];
  v: (number | null)[];
};

// a preset or boundary name, or a box; the mock answers boundaries from their box and label
export type TrendRegionQuery = {
  name?: string;
  box?: Pick<BBox, "south" | "north" | "west" | "east">;
  label?: string;
};

export type TrendRegion = {
  name: string;
  label: string;
  bbox: [number, number, number, number];
  n_cells: number;
  coverage?: number;
  start: number;
  end: number;
  years: number[];
  mean: (number | null)[];
  fitted: (number | null)[];
  global_mean: (number | null)[];
  // deviation from the period mean, one stripe per year
  stripes: (number | null)[];
  trend: "increasing" | "decreasing" | "no trend";
  p: number;
  autocorr_corrected: boolean;
  slope_decade: number;
  total_change: number;
  global_slope_decade: number;
  // regional trend divided by the global trend, null when the global trend is near zero
  ratio: number | null;
  share_warming: number;
};

export type StationElementKey = "TAVG" | "PRCP" | "AWND";

export type StationList = {
  element: StationElementKey;
  name: string;
  units: string;
  years: number[];
  min_years: number;
  scale: number;
  ids: string[];
  names: string[];
  lat: number[];
  lon: number[];
  slope: (number | null)[];
  p: (number | null)[];
  significant: boolean[];
  n_years: number[];
};

export type StationTrend = {
  slope_decade: number;
  p: number;
  significant: boolean;
  significant_fdr?: boolean;
  n_years: number;
  fitted: (number | null)[];
};

export type StationCompare = {
  id: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
  elevation: number | null;
  element: StationElementKey;
  element_name: string;
  units: string;
  years: number[];
  min_years: number;
  station: (number | null)[];
  station_trend: StationTrend | null;
  grid: {
    variable: string;
    name: string;
    lat: number;
    lon: number;
    distance_km: number;
    values: (number | null)[];
    trend: StationTrend | null;
    r: number | null;
    common_years: number;
    difference_decade?: number;
  } | null;
};

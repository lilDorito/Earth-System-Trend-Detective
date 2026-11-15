// API types, mirror the responses of app/api

export type BBox = { type: "bbox"; west: number; south: number; east: number; north: number };
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
  global_mean: (number | null)[];
};

export type FlowField = "wind" | "current";
export type TrendFlow = GridGeometry & {
  field: FlowField;
  start: number;
  end: number;
  n_lat: number;
  n_lon: number;
  u: (number | null)[];
  v: (number | null)[];
};

export type TrendRegionQuery = {
  name?: string;
  names?: string[]; // several regions averaged as one area
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

export type InsightPlace =
  | { lat: number; lon: number }
  | { region: string }
  | { regions: string }
  | { south: number; north: number; west: number; east: number };

export type ScanRow = {
  key: string;
  name: string;
  units: string;
  group: TrendVariable["group"];
  slope_decade: number;
  p: number | null;
  q: number | null; // FDR across the variables scanned
  significant: boolean;
  sigma: number | null;
  effect: number | null; // change per decade in units of the year-to-year scatter
  jump: boolean;
  share_significant?: number; // boxes: share of cells with a significant trend
};

export type Scan = { kind: "point" | "region" | "box"; approximate: boolean; variables: ScanRow[] };

// interpretation checks on one variable at a place (app/api/insights.py /diagnose)
export type Diagnosis = {
  key: string;
  name: string;
  units: string;
  years: number[];
  significant: boolean;
  slope_decade: number;
  years_needed: number | null; // record length at which this slope would be significant
  growth: { end: number; p: number }[]; // p of the record ending each year
  jump: { year: number; shift: number; likely: boolean };
  robust: { stable: boolean; shifted: { start: number; slope: number; p: number }[] };
  enso: { explained: number; trend: number; trend_without_enso: number } | null;
  agreement: { key: string; name: string; slope_decade: number; own_slope_decade: number; agree: boolean } | null;
};

export type Co2Series = {
  source: string;
  years: number[];
  ppm: (number | null)[];
  fitted: (number | null)[];
  growth: (number | null)[]; // ppm added each year, null for the first
  slope_decade: number;
  months: string[]; // "YYYY-MM"
  monthly: (number | null)[];
  mauna_loa: (number | null)[];
};

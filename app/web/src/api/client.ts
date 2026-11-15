// HTTP client for the FastAPI backend

import type {
  AnalyzeRequest,
  AnalyzeResponse,
  Demo,
  GlobalMean,
  Region,
  RegionType,
  StationCompare,
  StationElementKey,
  StationList,
  TrendFrames,
  TrendGrid,
  TrendMeta,
  TrendPoint,
  TrendRegion,
  TrendRegionQuery,
  TrendVariable,
  TrendWind,
  VariableInfo,
  Diagnosis,
  Divergence,
  Hotspots,
  InsightPlace,
  Scan,
  Scenario,
  Co2Series,
} from "./types";

import { useServerStatus } from "./status";

// a JSON error with a detail field comes from the API itself
async function hasDetail(res: Response): Promise<boolean> {
  try {
    const body = await res.clone().json();
    return typeof body?.detail === "string";
  } catch {
    return false;
  }
}

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const query = (params: Record<string, string>) => new URLSearchParams(params).toString();
const placeQuery = (place: InsightPlace) =>
  query(Object.fromEntries(Object.entries(place).map(([k, v]) => [k, typeof v === "number" ? v.toFixed(3) : String(v)])));

// a sleeping server answers nothing (the browser says only "Failed to fetch") or a 502-504 from the proxy;
// reads are retried with growing pauses for about 90 s while the server starts
const WAKE_PAUSES_S = [2, 3, 5, 8, 10, 12, 15, 15, 20];
const asleep = (status: number) => status === 0 || status === 502 || status === 503 || status === 504;
const pause = (s: number) => new Promise((resolve) => setTimeout(resolve, s * 1000));

async function attempt(path: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  } catch {
    return null;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const retry = !init?.method || init.method === "GET";
  let res = await attempt(path, init);
  for (const s of retry ? WAKE_PAUSES_S : []) {
    // a 503 with a reason (a dataset revision without some products) is an answer, not a sleeping server
    if (res && !(asleep(res.status) && !(await hasDetail(res)))) break;
    useServerStatus.setState({ waking: true });
    await pause(s);
    res = await attempt(path, init);
  }
  if (res && !asleep(res.status)) useServerStatus.setState({ waking: false });
  if (!res) {
    useServerStatus.setState({ waking: false });
    throw new ApiError(0, "No answer from the server. It may still be starting; try again in a minute.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, typeof body.detail === "string" ? body.detail : res.statusText);
  }
  return res.json() as Promise<T>;
}

export const httpApi = {
  health: () => request<{ status: string; data_mode: string; variables: number }>("/api/health"),
  variables: () => request<VariableInfo[]>("/api/variables"),
  regions: () => request<Record<string, Region>>("/api/regions"),
  regionTypes: () => request<Record<string, RegionType>>("/api/region-types"),
  demos: () => request<Demo[]>("/api/demos"),
  trendVariables: () => request<TrendVariable[]>("/api/trendmap/variables"),
  trendMeta: (variable: string) => request<TrendMeta>(`/api/trendmap/meta?${query({ variable })}`),
  trendGrid: (variable: string) => request<TrendGrid>(`/api/trendmap/grid?${query({ variable })}`),
  trendGlobalMean: (variable: string) => request<GlobalMean>(`/api/trendmap/global-mean?${query({ variable })}`),
  trendFrames: (variable: string, kind: "anomaly" | "values" = "anomaly") =>
    request<TrendFrames>(`/api/trendmap/frames?${query({ variable, kind })}`),
  trendWind: () => request<TrendWind>("/api/trendmap/wind"),
  insightScan: (place: InsightPlace) => request<Scan>(`/api/insights/scan?${placeQuery(place)}`),
  insightDiagnose: (variable: string, place: InsightPlace) =>
    request<Diagnosis>(`/api/insights/diagnose?${query({ variable })}&${placeQuery(place)}`),
  trendCo2: () => request<Co2Series>("/api/trendmap/co2"),
  insightScenarios: () => request<Scenario[]>("/api/insights/scenarios"),
  insightHotspots: (scenario: string) => request<Hotspots>(`/api/insights/hotspots?${query({ scenario })}`),
  insightDivergence: (variable: string) => request<Divergence>(`/api/insights/divergence?${query({ variable })}`),
  trendRegion: (variable: string, region: TrendRegionQuery) => {
    const where: Record<string, string> = region.name
      ? { name: region.name }
      : {
          ...Object.fromEntries(
            Object.entries(region.box ?? {})
              .filter(([k]) => k !== "type")
              .map(([k, v]) => [k, String(v)]),
          ),
          ...(region.label ? { label: region.label } : {}),
        };
    return request<TrendRegion>(`/api/trendmap/region?${query({ variable, ...where })}`);
  },
  trendPoint: (variable: string, lat: number, lon: number) =>
    request<TrendPoint>(`/api/trendmap/point?${query({ variable, lat: lat.toFixed(3), lon: lon.toFixed(3) })}`),
  stations: (element: StationElementKey) => request<StationList>(`/api/stations?${query({ element })}`),
  stationCompare: (id: string, variable: string | null, element: StationElementKey) =>
    request<StationCompare>(`/api/stations/compare?${query(variable ? { id, element, variable } : { id, element })}`),
  analyze: (body: AnalyzeRequest) =>
    request<AnalyzeResponse>("/api/analyze", { method: "POST", body: JSON.stringify(body) }),
};

export type Api = typeof httpApi;

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
} from "./types";

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    // no response at all: the server is asleep, restarting or unreachable (the browser says only "Failed to fetch")
    throw new ApiError(0, "No answer from the server. It may be waking up or restarting; try again in a minute.");
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

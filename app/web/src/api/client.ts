import type {
  AnalyzeRequest,
  AnalyzeResponse,
  Demo,
  GlobalMean,
  Region,
  RegionType,
  TrendGrid,
  TrendMeta,
  TrendPoint,
  VariableInfo,
} from "./types";

const BASE = import.meta.env.VITE_API_URL ?? "";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = typeof body.detail === "string" ? body.detail : res.statusText;
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<{ status: string; data_mode: string; variables: number }>("/api/health"),
  variables: () => request<VariableInfo[]>("/api/variables"),
  regions: () => request<Record<string, Region>>("/api/regions"),
  regionTypes: () => request<Record<string, RegionType>>("/api/region-types"),
  demos: () => request<Demo[]>("/api/demos"),
  trendMeta: () => request<TrendMeta>("/api/trendmap/meta"),
  trendGrid: () => request<TrendGrid>("/api/trendmap/grid"),
  trendGlobalMean: () => request<GlobalMean>("/api/trendmap/global-mean"),
  trendPoint: (lat: number, lon: number) =>
    request<TrendPoint>(`/api/trendmap/point?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`),
  analyze: (body: AnalyzeRequest) =>
    request<AnalyzeResponse>("/api/analyze", { method: "POST", body: JSON.stringify(body) }),
};

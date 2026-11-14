// trend map state

import { create } from "zustand";
import { api } from "@/api";
import type { GlobalMean, TrendGrid, TrendMeta, TrendPoint } from "@/api/types";

type TrendMapState = {
  meta: TrendMeta | null;
  grid: TrendGrid | null;
  globalMean: GlobalMean | null;
  loading: boolean;
  error: string | null;

  showTrend: boolean;
  onlySignificant: boolean;

  picked: { lat: number; lon: number } | null;
  selected: TrendPoint | null;
  pointLoading: boolean;

  load: () => Promise<void>;
  setShowTrend: (on: boolean) => void;
  setOnlySignificant: (on: boolean) => void;
  selectPoint: (lat: number, lon: number) => Promise<void>;
  clearSelection: () => void;
};

let pointRequestId = 0;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useTrendMapStore = create<TrendMapState>((set, get) => ({
  meta: null,
  grid: null,
  globalMean: null,
  loading: false,
  error: null,

  showTrend: true,
  onlySignificant: false,

  picked: null,
  selected: null,
  pointLoading: false,

  async load() {
    if (get().loading || get().grid) return;
    set({ loading: true, error: null });
    try {
      const [meta, grid, globalMean] = await Promise.all([api.trendMeta(), api.trendGrid(), api.trendGlobalMean()]);
      set({ meta, grid, globalMean, loading: false });
    } catch (e) {
      set({ loading: false, error: message(e) });
    }
  },

  setShowTrend: (showTrend) => set({ showTrend }),
  setOnlySignificant: (onlySignificant) => set({ onlySignificant }),

  async selectPoint(lat, lon) {
    const id = ++pointRequestId;
    set({ picked: { lat, lon }, pointLoading: true });
    try {
      const point = await api.trendPoint(lat, lon);
      if (id === pointRequestId) set({ selected: point, pointLoading: false });
    } catch (e) {
      if (id === pointRequestId) set({ pointLoading: false, error: message(e) });
    }
  },

  clearSelection() {
    pointRequestId++;
    set({ picked: null, selected: null, pointLoading: false });
  },
}));

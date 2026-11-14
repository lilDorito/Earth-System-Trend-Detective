// trend map state

import { create } from "zustand";
import { api } from "@/api";
import type { GlobalMean, TrendFrames, TrendGrid, TrendMeta, TrendPoint, TrendRegion } from "@/api/types";

export type View = "trend" | "years"; // one map for the whole period | one map per year

type TrendMapState = {
  meta: TrendMeta | null;
  grid: TrendGrid | null;
  globalMean: GlobalMean | null;
  frames: TrendFrames | null;
  loading: boolean;
  error: string | null;

  showTrend: boolean;
  onlySignificant: boolean;
  view: View;
  frameYear: number;

  regionName: string | null;
  region: TrendRegion | null;

  picked: { lat: number; lon: number } | null;
  selected: TrendPoint | null;
  pointLoading: boolean;

  load: () => Promise<void>;
  setShowTrend: (on: boolean) => void;
  setOnlySignificant: (on: boolean) => void;
  setView: (view: View) => void;
  setFrameYear: (year: number) => void;
  setRegion: (name: string | null) => Promise<void>;
  selectPoint: (lat: number, lon: number) => Promise<void>;
  clearSelection: () => void;
};

let pointRequestId = 0;
let regionRequestId = 0;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useTrendMapStore = create<TrendMapState>((set, get) => ({
  meta: null,
  grid: null,
  globalMean: null,
  frames: null,
  loading: false,
  error: null,

  showTrend: true,
  onlySignificant: false,
  view: "trend",
  frameYear: 0,

  regionName: null,
  region: null,

  picked: null,
  selected: null,
  pointLoading: false,

  async load() {
    if (get().loading || get().grid) return;
    set({ loading: true, error: null });
    try {
      const [meta, grid, globalMean, frames] = await Promise.all([
        api.trendMeta(),
        api.trendGrid(),
        api.trendGlobalMean(),
        api.trendFrames(),
      ]);
      set({ meta, grid, globalMean, frames, frameYear: frames.years[frames.years.length - 1], loading: false });
    } catch (e) {
      set({ loading: false, error: message(e) });
    }
  },

  setShowTrend: (showTrend) => set({ showTrend }),
  setOnlySignificant: (onlySignificant) => set({ onlySignificant }),
  setView: (view) => set({ view }),
  setFrameYear: (frameYear) => set({ frameYear, view: "years" }),

  async setRegion(name) {
    const id = ++regionRequestId;
    if (!name) {
      set({ regionName: null, region: null });
      return;
    }
    set({ regionName: name });
    try {
      const region = await api.trendRegion(name);
      if (id === regionRequestId) set({ region });
    } catch (e) {
      if (id === regionRequestId) set({ error: message(e) });
    }
  },

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

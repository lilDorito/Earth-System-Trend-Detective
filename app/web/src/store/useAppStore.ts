// explorer state and analyze request

import { create } from "zustand";
import { api } from "@/api";
import type { AnalyzeResponse, Demo, Location, Mode, Region } from "@/api/types";
import { locationCenter } from "@/lib/format";

export type FocusTarget = { lat: number; lon: number; id: number };

type AppState = {
  variableKey: string | null;
  location: Location | null;
  regionName: string | null;
  regionType: string | null;
  start: string;
  end: string;
  mode: Mode;
  eventDate: string;
  deseasonalize: boolean;
  focus: FocusTarget | null;

  response: AnalyzeResponse | null;
  loading: boolean;
  error: string | null;

  setVariable: (key: string) => void;
  setLocation: (location: Location, regionName?: string | null) => void;
  pickRegion: (region: Region) => void;
  setRegionType: (type: string | null) => void;
  setPeriod: (start: string, end: string) => void;
  setMode: (mode: Mode) => void;
  setEventDate: (date: string) => void;
  setDeseasonalize: (on: boolean) => void;
  loadDemo: (demo: Demo, region: Region) => Promise<void>;
  run: () => Promise<void>;
};

const today = new Date().toISOString().slice(0, 10);
let runId = 0;

export const useAppStore = create<AppState>((set, get) => ({
  variableKey: null,
  location: null,
  regionName: null,
  regionType: null,
  start: "1980-01-01",
  end: today,
  mode: "trend",
  eventDate: "2022-02-24",
  deseasonalize: true,
  focus: null,

  response: null,
  loading: false,
  error: null,

  setVariable: (variableKey) => set({ variableKey, error: null }),
  setLocation: (location, regionName = null) => set({ location, regionName, error: null }),
  pickRegion: (region) =>
    set({
      location: region.location,
      regionName: region.name,
      focus: { ...locationCenter(region.location), id: Date.now() },
      error: null,
    }),
  setRegionType: (regionType) => set({ regionType }),
  setPeriod: (start, end) => set({ start, end, error: null }),
  setMode: (mode) => set({ mode, error: null }),
  setEventDate: (eventDate) => set({ eventDate, error: null }),
  setDeseasonalize: (deseasonalize) => set({ deseasonalize }),

  async loadDemo(demo, region) {
    get().pickRegion(region);
    set({
      variableKey: demo.variable,
      start: demo.start,
      end: demo.end,
      mode: demo.mode,
      eventDate: demo.event_date ?? get().eventDate,
      deseasonalize: true,
      response: null,
    });
    await get().run();
  },

  async run() {
    const s = get();
    if (!s.variableKey || !s.location) return;
    const id = ++runId;
    set({ loading: true, error: null });
    try {
      const response = await api.analyze({
        variable: s.variableKey,
        location: s.location,
        start: s.start,
        end: s.end,
        mode: s.mode,
        event_date: s.mode === "event" ? s.eventDate : null,
        deseasonalize: s.deseasonalize,
        region_name: s.regionName,
      });
      if (id === runId) set({ response, loading: false });
    } catch (e) {
      if (id === runId) set({ error: e instanceof Error ? e.message : String(e), loading: false });
    }
  },
}));

// explorer state and analyze request

import { create } from "zustand";
import { api } from "@/api";
import type { AnalyzeResponse, BBox, Boundary, Demo, Location, Mode, Region } from "@/api/types";
import { boundaryLabel, fitDistance } from "@/features/globe/boundaries";
import { locationCenter } from "@/lib/format";

export type FocusTarget = { lat: number; lon: number; id: number; distance?: number };

type AppState = {
  variableKey: string | null;
  location: Location | null;
  regionName: string | null;
  boundary: Boundary | null; // the picked region when location is one
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
  clearLocation: () => void;
  pickRegion: (region: Region) => void;
  pickBoundary: (boundary: Boundary) => void;
  setBox: (box: BBox) => void;
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
  boundary: null,
  regionType: null,
  start: "2000-01-01",
  end: today,
  mode: "trend",
  eventDate: "2022-02-24",
  deseasonalize: true,
  focus: null,

  response: null,
  loading: false,
  error: null,

  setVariable: (variableKey) => set({ variableKey, error: null }),
  setLocation: (location, regionName = null) => set({ location, regionName, boundary: null, error: null }),
  clearLocation() {
    runId++;
    set({ location: null, regionName: null, boundary: null, response: null, loading: false, error: null });
  },
  pickRegion(region) {
    const center = locationCenter(region.location);
    const distance = region.location.type === "bbox" ? fitDistance(region.location) : undefined;
    set({
      location: region.location,
      regionName: region.name,
      boundary: null,
      focus: center && { ...center, distance, id: Date.now() },
      error: null,
    });
  },
  pickBoundary: (boundary) =>
    set({
      location: { type: "region", id: boundary.id },
      regionName: boundaryLabel(boundary),
      boundary,
      focus: { lat: boundary.lat, lon: boundary.lon, distance: fitDistance(boundary), id: Date.now() },
      error: null,
    }),
  setBox: (box) => set({ location: box, regionName: null, boundary: null, error: null }),
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

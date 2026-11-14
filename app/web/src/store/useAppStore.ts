// Global UI state: what the user picked and the latest result

import { create } from "zustand";
import { api } from "@/api/client";
import type { AnalyzeResponse, Location, Mode } from "@/api/types";

type State = {
  variableKey: string | null;
  location: Location | null;
  regionName: string | null;
  start: string;
  end: string;
  mode: Mode;
  eventDate: string | null;
  deseasonalize: boolean;

  response: AnalyzeResponse | null;
  loading: boolean;
  error: string | null;

  setVariable: (key: string) => void;
  setLocation: (location: Location, regionName?: string | null) => void;
  setPeriod: (start: string, end: string) => void;
  setMode: (mode: Mode, eventDate?: string | null) => void;
  setDeseasonalize: (on: boolean) => void;
  run: () => Promise<void>;
};

export const useAppStore = create<State>((set, get) => ({
  variableKey: null,
  location: null,
  regionName: null,
  start: "1980-01-01",
  end: new Date().toISOString().slice(0, 10),
  mode: "trend",
  eventDate: null,
  deseasonalize: true,

  response: null,
  loading: false,
  error: null,

  setVariable: (variableKey) => set({ variableKey }),
  setLocation: (location, regionName = null) => set({ location, regionName }),
  setPeriod: (start, end) => set({ start, end }),
  setMode: (mode, eventDate = null) => set({ mode, eventDate }),
  setDeseasonalize: (deseasonalize) => set({ deseasonalize }),

  run: async () => {
    const s = get();
    if (!s.variableKey || !s.location) return;
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
      set({ response, loading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false });
    }
  },
}));

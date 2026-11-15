// atmospheric CO2, fetched once per session and shared by the side context and the CO2 panel

import { create } from "zustand";
import { api } from "@/api";
import type { Co2Series } from "@/api/types";

type Co2State = {
  series: Co2Series | null;
  error: string | null;
  open: boolean;
  load: () => void;
  setOpen: (open: boolean) => void;
};

let request: Promise<void> | null = null;

export const useCo2Store = create<Co2State>((set, get) => ({
  series: null,
  error: null,
  open: false,

  load() {
    if (get().series || request) return;
    request = api
      .trendCo2()
      .then((series) => set({ series, error: null }))
      .catch((e) => {
        set({ error: e instanceof Error ? e.message : String(e) });
        request = null;
      });
  },

  setOpen(open) {
    set({ open });
    if (open) get().load();
  },
}));

// variables, regions and demos

import { create } from "zustand";
import { api } from "@/api";
import type { Demo, Region, RegionType, VariableInfo } from "@/api/types";

type CatalogState = {
  variables: VariableInfo[];
  regions: Record<string, Region>;
  regionTypes: Record<string, RegionType>;
  demos: Demo[];
  status: "idle" | "loading" | "ready" | "error";
  load: () => Promise<void>;
};

export const useCatalogStore = create<CatalogState>((set, get) => ({
  variables: [],
  regions: {},
  regionTypes: {},
  demos: [],
  status: "idle",

  async load() {
    if (get().status === "loading" || get().status === "ready") return;
    set({ status: "loading" });
    try {
      const [variables, regions, regionTypes, demos] = await Promise.all([
        api.variables(),
        api.regions(),
        api.regionTypes(),
        api.demos(),
      ]);
      set({ variables, regions, regionTypes, demos, status: "ready" });
    } catch {
      set({ status: "error" });
    }
  },
}));

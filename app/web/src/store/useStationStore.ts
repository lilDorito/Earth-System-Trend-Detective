// weather station points, fetched once per element and shared by the explorer and the trend map

import { create } from "zustand";
import { api } from "@/api";
import type { StationElementKey, StationList } from "@/api/types";

type StationState = {
  lists: Partial<Record<StationElementKey, StationList>>;
  loading: Partial<Record<StationElementKey, boolean>>;
  errors: Partial<Record<StationElementKey, string | null>>;
  explorerOn: boolean;
  explorerElement: StationElementKey;
  load: (element: StationElementKey) => Promise<StationList | null>;
  setExplorerOn: (on: boolean) => void;
  setExplorerElement: (element: StationElementKey) => void;
};

const pending = new Map<StationElementKey, Promise<StationList | null>>();
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useStationStore = create<StationState>((set, get) => ({
  lists: {},
  loading: {},
  errors: {},
  explorerOn: false,
  explorerElement: "TAVG",

  load(element) {
    const done = get().lists[element];
    if (done) return Promise.resolve(done);
    let request = pending.get(element);
    if (!request) {
      set((s) => ({ loading: { ...s.loading, [element]: true }, errors: { ...s.errors, [element]: null } }));
      request = api
        .stations(element)
        .then((list) => {
          set((s) => ({ lists: { ...s.lists, [element]: list }, loading: { ...s.loading, [element]: false } }));
          return list;
        })
        .catch((e) => {
          set((s) => ({ loading: { ...s.loading, [element]: false }, errors: { ...s.errors, [element]: message(e) } }));
          return null;
        })
        .finally(() => pending.delete(element));
      pending.set(element, request);
    }
    return request;
  },

  setExplorerOn(explorerOn) {
    set({ explorerOn });
    if (explorerOn) void get().load(get().explorerElement);
  },

  setExplorerElement(explorerElement) {
    set({ explorerElement });
    if (get().explorerOn) void get().load(explorerElement);
  },
}));

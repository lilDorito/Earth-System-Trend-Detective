// trend map state

import { create } from "zustand";
import { api } from "@/api";
import { usingMockData } from "@/api";
import { REGIONS, type RegionName } from "@/api/regions";
import type {
  BBox,
  Boundary,
  GlobalMean,
  StationCompare,
  InsightPlace,
  TrendFrames,
  TrendGrid,
  TrendMeta,
  TrendPoint,
  TrendRegion,
  TrendVariable,
  TrendFlow,
} from "@/api/types";
import { styleFor } from "@/features/trendmap/styles";
import { elementFor } from "@/features/stations/elements";
import { useStationStore } from "@/store/useStationStore";
import { useCo2Store } from "@/store/useCo2Store";
import { boundaryLabel, fitDistance } from "@/features/globe/boundaries";
import { countryAt } from "@/features/globe/countryAt";
import { plainName } from "@/lib/summary";
import type { Area } from "@/features/globe/useOutline";

export type View = "trend" | "years"; // one map for the whole period | one map per year
export type Display = "trend" | "values"; // change (trend, anomalies) | the values themselves

export type RegionTarget =
  | { kind: "preset"; name: RegionName }
  | { kind: "boundary"; boundary: Boundary }
  | { kind: "box"; box: BBox; name?: string }
  | { kind: "boundaries"; boundaries: Boundary[] }; // several regions averaged as one area

// the box around several regions (west > east when they straddle 180 degrees is not handled: rare for a pick)
const around = (list: Boundary[]) => ({
  south: Math.min(...list.map((b) => b.south)),
  north: Math.max(...list.map((b) => b.north)),
  west: Math.min(...list.map((b) => b.west)),
  east: Math.max(...list.map((b) => b.east)),
});

export function targetArea(target: RegionTarget): Area {
  if (target.kind === "box") return { kind: "box", box: target.box };
  if (target.kind === "boundaries") return { kind: "regions", boundaries: target.boundaries };
  if (target.kind === "boundary") return { kind: "region", boundary: target.boundary };
  const preset = REGIONS[target.name];
  const [south, north, west, east] = preset.bbox;
  const boundary = "boundary" in preset && !usingMockData ? preset.boundary : null;
  if (boundary) return { kind: "region", boundary: { id: boundary, country: boundary, south, north, west, east } };
  return { kind: "box", box: { south, north, west, east } };
}

export function targetLabel(target: RegionTarget): string {
  if (target.kind === "boundary") return boundaryLabel(target.boundary);
  if (target.kind === "box") return target.name ?? "Custom area";
  if (target.kind === "boundaries") {
    const names = target.boundaries.map((b) => b.name);
    return names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
  }
  return REGIONS[target.name].label;
}

export function targetPlace(target: RegionTarget): InsightPlace {
  if (target.kind === "boundary") return { region: target.boundary.id };
  if (target.kind === "boundaries") return { regions: target.boundaries.map((b) => b.id).join(",") };
  if (target.kind === "box") return { south: target.box.south, north: target.box.north, west: target.box.west, east: target.box.east };
  const preset = REGIONS[target.name];
  if ("boundary" in preset && preset.boundary) return { region: preset.boundary };
  const [south, north, west, east] = preset.bbox;
  return { south, north, west, east };
}

const DEFAULT_VARIABLE = "merra2_t2m";

type TrendMapState = {
  variables: TrendVariable[];
  variable: string;
  meta: TrendMeta | null;
  grid: TrendGrid | null;
  globalMean: GlobalMean | null;
  frames: TrendFrames | null;
  valueFrames: TrendFrames | null;
  flow: TrendFlow | null;
  loading: boolean;
  error: string | null;

  showTrend: boolean;
  display: Display;
  stipple: boolean;
  opacity: number;
  onlySignificant: boolean;
  view: View;
  frameYear: number;

  regionTarget: RegionTarget | null;
  region: TrendRegion | null;
  regionLoading: boolean;
  focus: { lat: number; lon: number; distance: number; id: number } | null;
  regionError: string | null;

  picked: { lat: number; lon: number; name?: string } | null;
  selected: TrendPoint | null;

  pointLoading: boolean;
  pointError: string | null;

  showStations: boolean;
  stationId: string | null;
  station: StationCompare | null;
  stationLoading: boolean;
  stationError: string | null;

  load: () => Promise<void>;
  setVariable: (key: string) => Promise<void>;
  setShowTrend: (on: boolean) => void;
  setDisplay: (display: Display) => Promise<void>;
  setStipple: (on: boolean) => void;
  setOpacity: (opacity: number) => void;
  setOnlySignificant: (on: boolean) => void;
  setView: (view: View) => void;
  setFrameYear: (year: number) => void;
  setRegion: (target: RegionTarget | null) => Promise<void>;
  selectPoint: (lat: number, lon: number, name?: string) => Promise<void>;
  clearSelection: () => void;
  setShowStations: (on: boolean) => void;
  selectStation: (id: string) => Promise<void>;
  clearStation: () => void;
  focusOn: (lat: number, lon: number, distance: number) => void;
};

const boxOf = ([south, north, west, east]: readonly number[]) => ({ south, north, west, east });
const boxCenter = (b: { south: number; north: number; west: number; east: number }) => {
  const width = (b.east - b.west + 360) % 360 || 360;
  return { lat: (b.south + b.north) / 2, lon: ((b.west + width / 2 + 540) % 360) - 180 };
};

let variableRequestId = 0;
let pointRequestId = 0;
let regionRequestId = 0;
let stationRequestId = 0;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useTrendMapStore = create<TrendMapState>((set, get) => ({
  variables: [],
  variable: DEFAULT_VARIABLE,
  meta: null,
  grid: null,
  globalMean: null,
  frames: null,
  valueFrames: null,
  flow: null,
  loading: false,
  error: null,

  showTrend: false,
  display: "trend",
  stipple: true,
  opacity: 0.6,
  onlySignificant: false,
  view: "trend",
  frameYear: 0,

  regionTarget: null,
  region: null,
  regionLoading: false,
  focus: null,
  regionError: null,

  picked: null,
  selected: null,
  pointLoading: false,
  pointError: null,

  showStations: false,
  stationId: null,
  station: null,
  stationLoading: false,
  stationError: null,

  async load() {
    if (get().loading || get().grid) return;
    try {
      const variables = await api.trendVariables();
      const known = variables.some((v) => v.key === get().variable);
      set({ variables, variable: known ? get().variable : variables[0]?.key ?? DEFAULT_VARIABLE });
    } catch (e) {
      set({ error: message(e) });
      return;
    }
    await get().setVariable(get().variable);
  },

  async setVariable(variable) {
    const id = ++variableRequestId;
    set({ variable, loading: true, error: null });
    const values = get().display === "values";
    // one field for all wind variables and one for all current variables: fetched when the kind changes
    const field = styleFor(variable).flow;
    const kept = get().flow?.field === field ? get().flow : null;
    try {
      const [meta, grid, globalMean, frames, valueFrames, flow] = await Promise.all([
        api.trendMeta(variable),
        api.trendGrid(variable),
        api.trendGlobalMean(variable),
        api.trendFrames(variable),
        values ? api.trendFrames(variable, "values") : null,
        field && !kept ? api.trendFlow(field).catch(() => null) : kept,
      ]);
      if (id !== variableRequestId) return;
      const year = frames.years.includes(get().frameYear) ? get().frameYear : frames.years[frames.years.length - 1];
      set({ meta, grid, globalMean, frames, valueFrames, flow, frameYear: year, loading: false });
    } catch (e) {
      if (id === variableRequestId) set({ loading: false, error: message(e) });
      return;
    }
    const { regionTarget, picked, display, valueFrames: shown, stationId, station, showStations } = get();
    const element = elementFor(variable);
    if (showStations && element) void useStationStore.getState().load(element);
    if (stationId) {
      if (element && element === station?.element) void get().selectStation(stationId);
      else get().clearStation();
    }
    // the values view was switched on while this variable was loading
    if (display === "values" && !shown) void get().setDisplay("values");
    if (regionTarget) void get().setRegion(regionTarget);
    if (picked) void get().selectPoint(picked.lat, picked.lon, picked.name);
  },

  setShowTrend: (showTrend) => set({ showTrend }),
  setStipple: (stipple) => set({ stipple }),

  async setDisplay(display) {
    set({ display });
    const { variable, valueFrames, loading } = get();
    // while a variable loads, setVariable fetches the values itself when it is done
    if (display !== "values" || valueFrames || loading) return;
    const id = variableRequestId;
    set({ loading: true });
    try {
      const frames = await api.trendFrames(variable, "values");
      if (id === variableRequestId) set({ valueFrames: frames, loading: false });
    } catch (e) {
      if (id === variableRequestId) set({ loading: false, error: message(e) });
    }
  },
  setOpacity: (opacity) => set({ opacity }),
  setOnlySignificant: (onlySignificant) => set({ onlySignificant }),
  setView: (view) => set({ view }),
  setFrameYear: (frameYear) => set({ frameYear, view: "years" }),

  async setRegion(target) {
    const id = ++regionRequestId;
    if (!target) {
      set({ regionTarget: null, region: null, regionError: null, regionLoading: false });
      return;
    }
    // a new area takes the CO2 chart's place, as a point or a station does
    useCo2Store.getState().setOpen(false);
    const previous = get().regionTarget;
    // a picked region flies into view; drawn boxes and regions added to a selection are already in view
    if ((target.kind === "boundary" || target.kind === "preset") && target !== previous) {
      const bounds = target.kind === "boundary" ? target.boundary : boxOf(REGIONS[target.name].bbox);
      const center = target.kind === "boundary" ? target.boundary : boxCenter(bounds);
      set({ focus: { lat: center.lat, lon: center.lon, distance: fitDistance(bounds), id: Date.now() } });
    }
    set({ regionTarget: target, regionError: null, regionLoading: true });
    const query =
      target.kind === "preset"
        ? { name: target.name }
        : target.kind === "boundary"
          ? { name: target.boundary.id, box: target.boundary, label: boundaryLabel(target.boundary) }
          : target.kind === "boundaries"
            ? { names: target.boundaries.map((b) => b.id), box: around(target.boundaries), label: targetLabel(target) }
            : { box: target.box, label: target.name };
    try {
      const region = await api.trendRegion(get().variable, query);
      if (id === regionRequestId) set({ region, regionLoading: false });
    } catch (e) {
      if (id === regionRequestId) set({ region: null, regionError: message(e), regionLoading: false });
    }
  },

  async selectPoint(lat, lon, name) {
    const id = ++pointRequestId;
    get().clearStation();
    useCo2Store.getState().setOpen(false);
    set({ picked: { lat, lon, name }, pointLoading: true, pointError: null });
    // a sea variable clicked on land (or the reverse) says so, instead of quietly showing the nearest coast cell
    const meta = get().meta;
    if (meta && (meta.domain === "ocean" || meta.domain === "land")) {
      const onLand = !!(await countryAt(lat, lon).catch(() => null));
      if (id !== pointRequestId) return;
      if (onLand !== (meta.domain === "land")) {
        const sea = meta.domain === "ocean";
        const what = plainName(meta.name);
        set({
          selected: null,
          pointLoading: false,
          pointError: `${what[0].toUpperCase()}${what.slice(1)} is measured only ${sea ? "over the ocean" : "over land"}. Click a point ${sea ? "at sea" : "on land"}, or pick another variable.`,
        });
        return;
      }
    }
    try {
      const point = await api.trendPoint(get().variable, lat, lon);
      if (id === pointRequestId) set({ selected: point, pointLoading: false });
    } catch (e) {
      if (id === pointRequestId) set({ selected: null, pointLoading: false, pointError: message(e) });
    }
  },

  clearSelection() {
    pointRequestId++;
    set({ picked: null, selected: null, pointLoading: false, pointError: null });
    get().clearStation();
  },

  setShowStations(showStations) {
    set({ showStations });
    const element = elementFor(get().variable);
    if (showStations && element) void useStationStore.getState().load(element);
    if (!showStations) get().clearStation();
  },

  async selectStation(stationId) {
    const element = elementFor(get().variable);
    if (!element) return;
    const id = ++stationRequestId;
    pointRequestId++;
    useCo2Store.getState().setOpen(false);
    set({ stationId, stationLoading: true, stationError: null, picked: null, selected: null, pointLoading: false, pointError: null });
    try {
      const station = await api.stationCompare(stationId, get().variable, element);
      if (id === stationRequestId) set({ station, stationLoading: false });
    } catch (e) {
      if (id === stationRequestId) set({ station: null, stationLoading: false, stationError: message(e) });
    }
  },

  clearStation() {
    stationRequestId++;
    set({ stationId: null, station: null, stationLoading: false, stationError: null });
  },


  focusOn: (lat, lon, distance) => set({ focus: { lat, lon, distance, id: Date.now() } }),
}));

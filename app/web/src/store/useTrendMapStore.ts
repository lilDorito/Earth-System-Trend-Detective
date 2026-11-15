// trend map state

import { create } from "zustand";
import { api } from "@/api";
import { usingMockData } from "@/api";
import { REGIONS, type RegionName } from "@/api/regions";
import type {
  BBox,
  Boundary,
  Divergence,
  GlobalMean,
  StationCompare,
  Hotspots,
  InsightPlace,
  TrendFrames,
  TrendGrid,
  TrendMeta,
  TrendPoint,
  TrendRegion,
  TrendVariable,
  TrendWind,
} from "@/api/types";
import { styleFor } from "@/features/trendmap/styles";
import { elementFor } from "@/features/stations/elements";
import { useStationStore } from "@/store/useStationStore";
import { boundaryLabel, fitDistance } from "@/features/globe/boundaries";
import type { Area } from "@/features/globe/useOutline";

export type View = "trend" | "years"; // one map for the whole period | one map per year
export type Display = "trend" | "values"; // change (trend, anomalies) | the values themselves

export type RegionTarget =
  | { kind: "preset"; name: RegionName }
  | { kind: "boundary"; boundary: Boundary }
  | { kind: "box"; box: BBox; name?: string };

// what the globe outlines for a target; live data uses Ukraine's border instead of its box
export function targetArea(target: RegionTarget): Area {
  if (target.kind === "box") return { kind: "box", box: target.box };
  if (target.kind === "boundary") return { kind: "region", boundary: target.boundary };
  const preset = REGIONS[target.name];
  const [south, north, west, east] = preset.bbox;
  const boundary = "boundary" in preset && !usingMockData ? preset.boundary : null;
  if (boundary) return { kind: "region", boundary: { id: boundary, country: boundary, south, north, west, east } };
  return { kind: "box", box: { south, north, west, east } };
}

// the place a region target names for the insight endpoints: a Natural Earth id where there is one, else its box
export function targetPlace(target: RegionTarget): InsightPlace {
  if (target.kind === "boundary") return { region: target.boundary.id };
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
  wind: TrendWind | null;
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
  focus: { lat: number; lon: number; distance: number; id: number } | null;
  regionError: string | null;

  picked: { lat: number; lon: number; name?: string } | null;
  selected: TrendPoint | null;

  // process fingerprint shown instead of the variable, and the opposite-trend areas of the variable
  hotspot: Hotspots | null;
  hotspotLoading: string | null;
  divergence: Divergence | null;
  divergenceArea: number | null; // the area outlined on the globe
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
  setHotspot: (scenario: string | null) => Promise<void>;
  findDivergence: () => Promise<void>;
  showArea: (id: number | null) => void;
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
  wind: null,
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
  hotspot: null,
  hotspotLoading: null,
  divergence: null,
  divergenceArea: null,

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
    // opposite-trend areas belong to the variable they were found for
    set({ variable, loading: true, error: null, divergence: null, divergenceArea: null, hotspot: null, hotspotLoading: null });
    const values = get().display === "values";
    // the wind field is the same for every wind variable, so it is fetched once
    const wantWind = styleFor(variable).wind && !get().wind;
    try {
      const [meta, grid, globalMean, frames, valueFrames, wind] = await Promise.all([
        api.trendMeta(variable),
        api.trendGrid(variable),
        api.trendGlobalMean(variable),
        api.trendFrames(variable),
        values ? api.trendFrames(variable, "values") : null,
        wantWind ? api.trendWind().catch(() => null) : get().wind,
      ]);
      if (id !== variableRequestId) return;
      // keep the year being looked at when the new variable covers it
      const year = frames.years.includes(get().frameYear) ? get().frameYear : frames.years[frames.years.length - 1];
      set({ meta, grid, globalMean, frames, valueFrames, wind, frameYear: year, loading: false });
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
      set({ regionTarget: null, region: null, regionError: null });
      return;
    }
    // picked from the list: fly there; drawn boxes are already in view
    const previous = get().regionTarget;
    if (target.kind !== "box" && target !== previous) {
      const bounds = target.kind === "boundary" ? target.boundary : boxOf(REGIONS[target.name].bbox);
      const center = target.kind === "boundary" ? target.boundary : boxCenter(bounds);
      set({ focus: { lat: center.lat, lon: center.lon, distance: fitDistance(bounds), id: Date.now() } });
    }
    set({ regionTarget: target, regionError: null });
    const query =
      target.kind === "preset"
        ? { name: target.name }
        : target.kind === "boundary"
          ? { name: target.boundary.id, box: target.boundary, label: boundaryLabel(target.boundary) }
          : { box: target.box, label: target.name };
    try {
      const region = await api.trendRegion(get().variable, query);
      if (id === regionRequestId) set({ region });
    } catch (e) {
      if (id === regionRequestId) set({ region: null, regionError: message(e) });
    }
  },

  async selectPoint(lat, lon, name) {
    const id = ++pointRequestId;
    get().clearStation();
    set({ picked: { lat, lon, name }, pointLoading: true, pointError: null });
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

  async setHotspot(scenario) {
    if (!scenario) {
      set({ hotspot: null, hotspotLoading: null });
      return;
    }
    set({ hotspotLoading: scenario, showTrend: true, regionError: null });
    try {
      const hotspot = await api.insightHotspots(scenario);
      if (get().hotspotLoading === scenario) set({ hotspot, hotspotLoading: null });
    } catch (e) {
      if (get().hotspotLoading === scenario) set({ hotspotLoading: null, regionError: message(e) });
    }
  },

  async findDivergence() {
    const variable = get().variable;
    try {
      const divergence = await api.insightDivergence(variable);
      if (get().variable === variable) set({ divergence, divergenceArea: null });
    } catch (e) {
      set({ regionError: message(e) });
    }
  },

  showArea(id) {
    const area = get().divergence?.areas.find((a) => a.id === id);
    set({ divergenceArea: id });
    if (area) get().focusOn(area.lat, area.lon, Math.min(3.2, Math.max(1.6, 1 + Math.sqrt(area.area_km2) / 2500)));
  },

  focusOn: (lat, lon, distance) => set({ focus: { lat, lon, distance, id: Date.now() } }),
}));

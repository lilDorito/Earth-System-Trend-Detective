// ready-made trend map investigations for the Demos page; the numbers come live from the panels

import type { RegionName } from "@/api/regions";
import type { BBox } from "@/api/types";
import { fitDistance, loadBoundaries } from "@/features/globe/boundaries";
import { loadSeas } from "@/features/globe/seas";
import { useTrendMapStore, type Display } from "@/store/useTrendMapStore";

export type MapCase = {
  id: string;
  title: string;
  story: string; // what the case is about, one line
  look: string; // what to look at once it is open, one line
  variable: string;
  display?: Display;
  place: { preset: RegionName } | { region: string } | { box: BBox; name: string };
};

export const MAP_CASES: MapCase[] = [
  {
    id: "kyiv_warming",
    title: "Is Kyiv getting warmer?",
    story: "Air temperature over the Kyiv region since 2000.",
    look: "The panel says how much faster than the world average it warms.",
    variable: "merra2_t2m",
    place: { region: "ukr-321" },
  },
  {
    id: "kherson_soil",
    title: "Is the south of Ukraine drying out?",
    story: "Topsoil moisture in the Kherson region since 2000.",
    look: "Then click Volyn, in the north-west, to compare.",
    variable: "gldas_soilmoist_0_10",
    place: { region: "ukr-4827" },
  },
  {
    id: "arctic_ice_2007",
    title: "Did the Arctic ice come back after 2007?",
    story: "Sea ice hit a record low in September 2007. Did the Barents Sea recover?",
    look: "The chart shows whether the ice came back after 2007.",
    variable: "sea_ice_conc",
    place: { region: "sea-barents-sea" },
  },
  {
    id: "arctic_ice",
    title: "How fast is Arctic sea ice retreating?",
    story: "Sea ice around the North Pole, year by year.",
    look: "Press play: the white line is this year's ice edge, the dashed orange one the edge in 2000.",
    variable: "sea_ice_conc",
    display: "values",
    place: { preset: "arctic" },
  },
  {
    id: "arctic_warming",
    title: "Is the Arctic warming faster than the rest of the world?",
    story: "Air temperature north of the Arctic Circle.",
    look: "Read the ratio to the world average, then the quick analysis below it.",
    variable: "merra2_t2m",
    place: { preset: "arctic" },
  },
  {
    id: "sahel_rain",
    title: "Is the Sahel getting wetter again?",
    story: "Rainfall over the Sahel belt, south of the Sahara.",
    look: "Rain swings a lot from year to year, so a trend needs many years to stand out.",
    variable: "imerg_precip",
    place: { box: { type: "bbox", south: 10, north: 20, west: -17, east: 38 }, name: "Sahel" },
  },
  {
    id: "india_monsoon",
    title: "Is India's rainfall changing?",
    story: "Yearly rainfall over India, most of it from the summer monsoon.",
    look: "'What else is changing here' shows whether rain is even near the top.",
    variable: "imerg_precip",
    place: { region: "ind" },
  },
  {
    id: "ocean_acid",
    title: "Are the tropical oceans turning more acidic?",
    story: "Surface ocean pH between the tropics.",
    look: "pH falls almost everywhere: lower pH means more acidic water.",
    variable: "ph",
    place: { preset: "tropics" },
  },
];

export async function openCase(c: MapCase) {
  const store = useTrendMapStore.getState();
  useTrendMapStore.setState({ showTrend: true, view: "trend", picked: null, selected: null });
  if (c.display) void store.setDisplay(c.display);
  else void store.setDisplay("trend");
  if (store.grid) void store.setVariable(c.variable);
  else useTrendMapStore.setState({ variable: c.variable });
  if ("preset" in c.place) void store.setRegion({ kind: "preset", name: c.place.preset });
  else if ("box" in c.place) {
    const b = c.place.box;
    void store.setRegion({ kind: "box", box: b, name: c.place.name });
    const width = (b.east - b.west + 360) % 360 || 360;
    store.focusOn((b.south + b.north) / 2, ((b.west + width / 2 + 540) % 360) - 180, fitDistance(b));
  } else {
    const id = c.place.region;
    const list = id.startsWith("sea-") ? await loadSeas() : await loadBoundaries();
    const boundary = list.find((b) => b.id === id);
    if (boundary) void store.setRegion({ kind: "boundary", boundary });
  }
}

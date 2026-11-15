// ready-made trend map investigations for the Demos page; the numbers come live from the region panel

import type { RegionName } from "@/api/regions";
import type { BBox } from "@/api/types";
import { fitDistance, loadBoundaries } from "@/features/globe/boundaries";
import { useTrendMapStore, type Display } from "@/store/useTrendMapStore";

export type MapCase = {
  id: string;
  title: string;
  story: string; // what the case is about
  look: string; // what to look at once it is open
  variable: string;
  display?: Display;
  place: { preset: RegionName } | { region: string } | { box: BBox; name: string };
};

export const MAP_CASES: MapCase[] = [
  {
    id: "arctic_ice",
    title: "How fast is Arctic sea ice retreating?",
    story: "Sea ice concentration north of the Arctic Circle, year by year since 2000.",
    look: "Press play on the timeline: the white line is the 15% ice edge of the year shown, the dashed orange line the edge in 2000.",
    variable: "sea_ice_conc",
    display: "values",
    place: { preset: "arctic" },
  },
  {
    id: "arctic_warming",
    title: "Is the Arctic warming faster than the rest of the world?",
    story: "Air temperature trends north of 66.5°N, compared with the global mean.",
    look: "The region panel gives the ratio to the world average; 'Can we trust it?' checks it against GLDAS.",
    variable: "merra2_t2m",
    place: { preset: "arctic" },
  },
  {
    id: "sahel_rain",
    title: "Is the Sahel getting wetter again?",
    story: "After the droughts of the 1970s and 80s, rainfall over the Sahel belt since 2000 (IMERG satellite rainfall).",
    look: "Check 'When is it significant?': rainfall varies a lot from year to year, so a trend needs many years to stand out.",
    variable: "imerg_precip",
    place: { box: { type: "bbox", south: 10, north: 20, west: -17, east: 38 }, name: "Sahel" },
  },
  {
    id: "india_monsoon",
    title: "Is India's rainfall changing?",
    story: "Annual rainfall over India, most of it brought by the summer monsoon.",
    look: "'Everything changing here' ranks all variables for India: is rainfall even near the top?",
    variable: "imerg_precip",
    place: { region: "ind" },
  },
  {
    id: "amazon_soil",
    title: "Is the Amazon drying out?",
    story: "Topsoil moisture over the Amazon basin from the GLDAS land model.",
    look: "Look at the jump check: GLDAS changed its forcing data around 2010-2011, which can look like a trend.",
    variable: "gldas_soilmoist_0_10",
    place: { box: { type: "bbox", south: -15, north: 5, west: -75, east: -45 }, name: "Amazon basin" },
  },
  {
    id: "ocean_acid",
    title: "Are the tropical oceans acidifying?",
    story: "Surface ocean pH between the tropics, from the OceanSODA-ETHZ reconstruction.",
    look: "pH falls almost everywhere: compare the size of the change with the year-to-year scatter in the scan.",
    variable: "ph",
    place: { preset: "tropics" },
  },
];

export async function openCase(c: MapCase) {
  const store = useTrendMapStore.getState();
  useTrendMapStore.setState({ showTrend: true, view: "trend", hotspot: null, picked: null, selected: null });
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
    const boundary = (await loadBoundaries()).find((b) => b.id === id);
    if (boundary) void store.setRegion({ kind: "boundary", boundary });
  }
}

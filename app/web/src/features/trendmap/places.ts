// reads a plain English question ("droughts in America", "sea ice in the Arctic") into a variable and a place.
// Places match whole words only: "america" is the United States, never American Samoa

import type { BBox, Boundary, TrendVariable } from "@/api/types";

export type NamedBox = { name: string; box: BBox };

const box = (name: string, south: number, north: number, west: number, east: number): NamedBox => ({
  name,
  box: { type: "bbox", south, north, west, east },
});

// areas without a Natural Earth boundary: continents, basins, climate zones; the longest phrase in the
// question wins, so "south america" beats "america"
const AREAS: [string[], NamedBox][] = [
  [["north america"], box("North America", 15, 72, -168, -52)],
  [["south america", "latin america"], box("South America", -56, 13, -82, -34)],
  [["central america"], box("Central America", 7, 18.5, -92.5, -77)],
  [["southeast asia", "south east asia"], box("Southeast Asia", -11, 23, 92, 141)],
  [["middle east"], box("Middle East", 12, 42, 34, 63)],
  [["east africa"], box("East Africa", -12, 15, 29, 52)],
  [["west africa"], box("West Africa", 4, 25, -18, 16)],
  [["southern africa"], box("Southern Africa", -35, -15, 10, 41)],
  [["horn of africa"], box("Horn of Africa", -2, 18, 38, 52)],
  [["indian monsoon", "south asian monsoon", "monsoon"], box("South Asian monsoon", 5, 30, 65, 95)],
  [["africa"], box("Africa", -35, 37.5, -18, 52)],
  [["europe"], box("Europe", 35, 72, -10, 40)],
  [["asia"], box("Asia", 5, 75, 60, 150)],
  [["antarctica", "antarctic"], box("Antarctica", -90, -60, -180, 180)],
  [["arctic"], box("Arctic", 66.5, 90, -180, 180)],
  [["tropics", "tropical"], box("Tropics", -23.5, 23.5, -180, 180)],
  [["amazon", "amazonia"], box("Amazon basin", -15, 5, -75, -45)],
  [["sahel"], box("Sahel", 10, 20, -17, 38)],
  [["sahara"], box("Sahara", 18, 32, -15, 32)],
  [["mediterranean"], box("Mediterranean", 30, 46, -6, 36)],
  [["siberia"], box("Siberia", 50, 75, 60, 180)],
  [["himalaya", "himalayas", "tibet"], box("Himalaya and Tibet", 27, 38, 72, 102)],
];

// everyday names for countries, to Natural Earth ids
const ALIASES: Record<string, string> = {
  america: "usa",
  usa: "usa",
  us: "usa",
  "united states": "usa",
  "united states of america": "usa",
  "the states": "usa",
  uk: "gbr",
  britain: "gbr",
  "great britain": "gbr",
  england: "gbr",
  holland: "nld",
  "south korea": "kor",
  korea: "kor",
  "north korea": "prk",
  czechia: "cze",
  "czech republic": "cze",
  "ivory coast": "civ",
  congo: "cod",
  drc: "cod",
  uae: "are",
  emirates: "are",
};

// topics, in order: the first found wins; the last word of each phrase is a stem ("drought" finds "droughts")
const TOPICS: [string[], string[]][] = [
  [["drought", "dry", "drying", "arid"], ["gldas_soilmoist_0_10", "gldas_rootmoist", "imerg_precip"]],
  [["soil"], ["gldas_soilmoist_0_10", "gldas_rootmoist"]],
  [["sea level"], ["sla", "ocean_mass"]],
  [["sea ice", "ice"], ["sea_ice_conc"]],
  [["snow"], ["gldas_swe", "gldas_snowdepth"]],
  [["rain", "precip", "flood", "wet"], ["imerg_precip", "gldas_precip"]],
  [["fire", "wildfire", "burn"], ["burned_area"]],
  [["aerosol", "haze", "smog", "dust", "smoke", "pollution", "air quality"], ["aod"]],
  [["ozone"], ["to3"]],
  [["acidif", "acidity", "ph"], ["ph", "pco2"]],
  [["ocean heat", "heat content"], ["ohc_0_700", "ohc_0_2000"]],
  [["sea temperature", "ocean temperature", "sea surface", "sst", "marine heat"], ["sst"]],
  [["salt", "salin"], ["sss", "sal_0_700"]],
  [["chlorophyll", "algae", "plankton"], ["chlor_a"]],
  [["co2", "carbon"], ["pco2"]],
  [["wind"], ["merra2_wind10m", "gldas_wind"]],
  [["humid", "moisture", "vapour", "vapor"], ["merra2_tqv", "merra2_qv2m"]],
  [["evapor"], ["gldas_evap", "gldas_potevap"]],
  [["sunlight", "sunshine", "solar", "radiation"], ["gldas_swdown"]],
  [["pressure"], ["merra2_ps"]],
  [["vegetation", "greening", "greenness", "forest", "plant", "ndvi", "crop"], ["ndvi"]],
  [["temperature", "warm", "heat", "hot", "cold", "climate"], ["merra2_t2m", "gldas_tair"]],
];

// words that never name a place
const FILLER = new Set(
  "i want to know learn see about what whats how is are was were the a an in on of for over at around across and or show me tell happening changing change changes trend trends getting more less much many has have been do does there any".split(
    " ",
  ),
);

const words = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(" ")
    .filter(Boolean);

// index where the phrase starts in the question's words, -1 if absent; with stem, its last word may run on
function find(q: string[], phrase: string, stem: boolean): number {
  const p = words(phrase);
  for (let i = 0; i + p.length <= q.length; i++) {
    if (p.every((w, k) => (stem && k === p.length - 1 ? q[i + k].startsWith(w) : q[i + k] === w))) return i;
  }
  return -1;
}

export type Reading = {
  variable: string | null;
  place: { kind: "box"; named: NamedBox } | { kind: "boundary"; boundary: Boundary } | null;
  unknownPlace: string | null; // leftover words that looked like a place but matched nothing
};

export function readQuestion(text: string, variables: TrendVariable[], boundaries: Boundary[]): Reading {
  let q = words(text);
  const cut = (at: number, length: number) => (q = [...q.slice(0, at), ...q.slice(at + length)]);
  const available = new Set(variables.map((v) => v.key));

  let variable: string | null = null;
  topics: for (const [stems, keys] of TOPICS) {
    for (const stem of stems) {
      const at = find(q, stem, true);
      const key = keys.find((k) => available.has(k));
      if (at >= 0 && key) {
        variable = key;
        cut(at, words(stem).length);
        break topics;
      }
    }
  }

  let place: Reading["place"] = null;
  const areas = AREAS.flatMap(([names, named]) => names.map((n) => [n, named] as const)).sort(
    (a, b) => words(b[0]).length - words(a[0]).length,
  );
  for (const [name, named] of areas) {
    const at = find(q, name, false);
    if (at >= 0) {
      place = { kind: "box", named };
      cut(at, words(name).length);
      break;
    }
  }

  // countries and regions: a run of words must equal a whole name or an alias; countries beat regions
  const rest = q.filter((w) => !FILLER.has(w));
  if (!place && rest.length) {
    const byId = new Map(boundaries.map((b) => [b.id, b]));
    const byName = new Map<string, Boundary>();
    const ranked = [...boundaries].sort((a, b) => (a.kind === b.kind ? b.areaKm2 - a.areaKm2 : a.kind === "country" ? -1 : 1));
    for (const b of ranked) {
      const key = words(b.name).join(" ");
      if (!byName.has(key)) byName.set(key, b);
    }
    search: for (let n = Math.min(4, rest.length); n >= 1; n--) {
      for (let i = 0; i + n <= rest.length; i++) {
        const phrase = rest.slice(i, i + n).join(" ");
        const hit = byId.get(ALIASES[phrase] ?? "") ?? byName.get(phrase);
        if (hit) {
          place = { kind: "boundary", boundary: hit };
          break search;
        }
      }
    }
  }
  return { variable, place, unknownPlace: !place && rest.length ? rest.join(" ") : null };
}

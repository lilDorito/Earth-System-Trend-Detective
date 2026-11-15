// named areas without a Natural Earth boundary (continents, basins, climate zones), and reading a plain
// question ("drought in Africa", "посуха в Африці") into a variable and a place

import type { BBox, Boundary, TrendVariable } from "@/api/types";
import { searchBoundaries } from "@/features/globe/boundaries";

export type NamedBox = { name: string; box: BBox };

const box = (name: string, south: number, north: number, west: number, east: number): NamedBox => ({
  name,
  box: { type: "bbox", south, north, west, east },
});

// word stems (English and Ukrainian) -> area
const AREAS: [string[], NamedBox][] = [
  [["africa", "африк"], box("Africa", -35, 37.5, -18, 52)],
  [["europe", "європ", "европ"], box("Europe", 35, 72, -10, 40)],
  [["asia", "азі"], box("Asia", 5, 75, 60, 150)],
  [["north america", "північн америк"], box("North America", 15, 72, -168, -52)],
  [["south america", "південн америк", "латинськ америк"], box("South America", -56, 13, -82, -34)],
  [["australia", "австралі"], box("Australia", -44, -10, 112, 154)],
  [["antarctic", "антарктид", "антарктик"], box("Antarctica", -90, -60, -180, 180)],
  [["arctic", "арктик", "полярн"], box("Arctic", 66.5, 90, -180, 180)],
  [["tropic", "тропік"], box("Tropics", -23.5, 23.5, -180, 180)],
  [["amazon", "амазон"], box("Amazon basin", -15, 5, -75, -45)],
  [["sahel", "сахел"], box("Sahel", 10, 20, -17, 38)],
  [["sahara", "сахар"], box("Sahara", 18, 32, -15, 32)],
  [["mediterranean", "середземномор"], box("Mediterranean", 30, 46, -6, 36)],
  [["siberia", "сибір"], box("Siberia", 50, 75, 60, 180)],
  [["middle east", "близьк схід", "близького сходу"], box("Middle East", 12, 42, 34, 63)],
  [["monsoon", "мусон"], box("South Asian monsoon", 5, 30, 65, 95)],
];

// word stems -> dataset variables, in order of preference
const TOPICS: [string[], string[]][] = [
  [["drought", "dry", "drying", "посух", "засух", "сух"], ["gldas_soilmoist_0_10", "gldas_rootmoist", "imerg_precip"]],
  [["soil", "ґрунт", "грунт"], ["gldas_soilmoist_0_10", "gldas_rootmoist"]],
  [["rain", "precip", "monsoon", "flood", "дощ", "опад", "мусон", "повін"], ["imerg_precip", "gldas_precip"]],
  [["sea level", "рівень моря", "рівня моря"], ["sla", "ocean_mass"]],
  [["sea ice", "морськ лід", "ice", "лід", "льод"], ["sea_ice_conc"]],
  [["snow", "сніг", "снігу"], ["gldas_swe", "gldas_snowdepth"]],
  [["acid", "ph", "кисл"], ["ph", "pco2"]],
  [["ocean heat", "теплов", "heat content"], ["ohc_0_700", "ohc_0_2000"]],
  [["sea temperature", "ocean temperature", "sst", "температура моря", "температура океан"], ["sst"]],
  [["salt", "salin", "солон"], ["sss", "sal_0_700"]],
  [["chlorophyll", "algae", "plankton", "хлорофіл", "водорост", "планктон"], ["chlor_a"]],
  [["co2", "carbon", "вуглек"], ["pco2"]],
  [["wind", "вітер", "вітр"], ["merra2_wind10m", "gldas_wind"]],
  [["humid", "moisture", "vapour", "vapor", "волог", "пара"], ["merra2_tqv", "merra2_qv2m"]],
  [["evapor", "випаров"], ["gldas_evap", "gldas_potevap"]],
  [["sun", "solar", "radiation", "сонц", "радіац"], ["gldas_swdown"]],
  [["pressure", "тиск"], ["merra2_ps"]],
  [["temperature", "warm", "heat", "hot", "cold", "climate", "темпер", "тепл", "спек", "холод", "клімат"], ["merra2_t2m", "gldas_tair"]],
];

// words that carry no place
const FILLER = new Set(
  "i want to know learn about what how is are the a an in on of for over at and or show me tell happening changing change trend trends getting more less хочу дізнатися знати про що як в у на з та і або покажи зміни зміна тренд тренди".split(
    " ",
  ),
);

export type Reading = { variable: string | null; place: { kind: "box"; named: NamedBox } | { kind: "boundary"; boundary: Boundary } | null };

export function readQuestion(text: string, variables: TrendVariable[], boundaries: Boundary[]): Reading {
  let q = ` ${text.toLowerCase().replace(/[?!.,;:"«»]/g, " ").replace(/\s+/g, " ")} `;
  const has = (stem: string) => q.includes(` ${stem}`);
  const available = new Set(variables.map((v) => v.key));

  let variable: string | null = null;
  for (const [stems, keys] of TOPICS) {
    const stem = stems.find(has);
    if (!stem) continue;
    variable = keys.find((k) => available.has(k)) ?? null;
    if (variable) {
      q = q.replace(` ${stem}`, " ");
      break;
    }
  }

  let place: Reading["place"] = null;
  for (const [stems, named] of AREAS) {
    const stem = stems.find(has);
    if (stem) {
      place = { kind: "box", named };
      break;
    }
  }
  if (!place) {
    // the rest is a country or region name: try the longest run of leftover words first
    const words = q.trim().split(" ").filter((w) => w && !FILLER.has(w));
    for (let n = Math.min(3, words.length); n >= 1 && !place; n--) {
      for (let i = 0; i + n <= words.length && !place; i++) {
        const phrase = words.slice(i, i + n).join(" ");
        if (phrase.length < 3) continue;
        // Ukrainian case endings: "україні" -> "україн"
        const hit = searchBoundaries(boundaries, phrase, 1)[0] ?? searchBoundaries(boundaries, phrase.slice(0, -1), 1)[0];
        if (hit) place = { kind: "boundary", boundary: hit };
      }
    }
  }
  return { variable, place };
}

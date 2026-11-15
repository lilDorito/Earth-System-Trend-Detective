// how each variable is drawn: a palette for change (trends, anomalies) and one for values, plus scale and mode

export const BANDS = 24; // even, so zero falls on a band edge
// share of the change scale around zero that fades out, so the eye goes to where things change
export const FADE = 0.14;

export type Rgb = [number, number, number];
type Stops = Rgb[]; // evenly spaced from the low end to the high end

// diverging, low end = decrease. The middle is dark like the globe, so where change fades out nothing
// glares, and stronger change reads brighter; the two ends differ in hue. The inner stops are lifted so
// typical, modest changes are not lost in the dark
const CHANGE = {
  // blue to red through a dark middle: colder reads icier, warmer reads hotter
  heat: [[190, 230, 255], [80, 165, 235], [40, 100, 190], [34, 75, 146], [38, 38, 44], [146, 42, 34], [190, 50, 40], [240, 100, 50], [255, 200, 120]],
  // drier sand to wetter teal
  water: [[245, 210, 140], [205, 150, 70], [145, 95, 40], [106, 73, 34], [38, 38, 44], [22, 97, 95], [25, 130, 125], [60, 190, 175], [160, 240, 225]],
  // loss in rust and orange, gain in icy blue
  cryo: [[255, 185, 110], [235, 120, 45], [170, 70, 20], [126, 54, 17], [38, 38, 44], [51, 87, 136], [70, 120, 180], [140, 190, 235], [230, 245, 255]],
  // cooling blue to heating magma
  oceanHeat: [[150, 200, 250], [70, 140, 220], [40, 80, 170], [32, 58, 126], [38, 38, 44], [116, 29, 84], [160, 40, 100], [230, 80, 90], [255, 170, 110]],
  // falling teal to rising magenta (after cmocean curl)
  sea: [[170, 230, 220], [70, 170, 170], [30, 110, 120], [24, 82, 92], [38, 38, 44], [104, 32, 82], [140, 40, 110], [205, 80, 160], [245, 160, 215]],
  // pH indicator: acidifying turns red-orange, the other way green-blue
  ph: [[255, 190, 70], [240, 110, 40], [190, 50, 30], [140, 39, 27], [38, 38, 44], [34, 104, 78], [40, 140, 100], [70, 170, 200], [150, 140, 240]],
  // falling violet to rising amber
  pco2: [[210, 190, 250], [150, 120, 210], [95, 60, 150], [70, 44, 112], [38, 38, 44], [126, 70, 22], [170, 95, 25], [235, 150, 40], [255, 210, 120]],
  // browning to greening
  chlorophyll: [[235, 195, 120], [190, 135, 60], [130, 85, 35], [97, 63, 27], [38, 38, 44], [39, 97, 39], [50, 130, 50], [110, 190, 70], [200, 240, 120]],
  // fresher blue to saltier tan
  salinity: [[150, 215, 220], [60, 150, 190], [40, 85, 165], [34, 60, 126], [38, 38, 44], [119, 90, 32], [160, 120, 40], [220, 175, 70], [250, 225, 150]],
  // dimmer slate to brighter gold
  radiation: [[190, 190, 215], [125, 125, 155], [80, 80, 105], [61, 61, 80], [38, 38, 44], [131, 95, 22], [175, 125, 25], [235, 180, 40], [255, 235, 140]],
  // weaker violet to stronger green
  wind: [[225, 190, 250], [170, 110, 210], [115, 55, 150], [85, 41, 112], [38, 38, 44], [51, 97, 37], [70, 130, 45], [130, 190, 70], [210, 240, 140]],
  // lower lavender to higher orange
  pressure: [[200, 185, 245], [140, 120, 210], [85, 65, 150], [63, 48, 112], [38, 38, 44], [133, 75, 27], [180, 100, 30], [240, 155, 50], [255, 215, 140]],
} satisfies Record<string, Stops>;

// sequential, for the values view; cmocean-like, perceptually even
const VALUES = {
  thermal: [[4, 35, 51], [23, 51, 122], [85, 59, 157], [129, 79, 143], [175, 95, 130], [222, 112, 100], [249, 147, 65], [251, 199, 70], [232, 250, 91]],
  rain: [[238, 237, 243], [200, 210, 205], [140, 185, 170], [80, 155, 145], [35, 120, 130], [25, 85, 115], [30, 50, 90], [25, 25, 60]],
  soil: [[150, 85, 25], [205, 140, 45], [230, 200, 95], [165, 205, 95], [70, 175, 110], [25, 135, 135], [20, 80, 140]],
  ice: [[4, 6, 19], [29, 31, 67], [48, 62, 123], [56, 101, 160], [68, 140, 183], [103, 178, 200], [160, 212, 220], [234, 253, 253]],
  magma: [[0, 0, 4], [28, 16, 68], [79, 18, 123], [129, 37, 129], [181, 54, 122], [229, 80, 100], [251, 135, 97], [254, 194, 135], [252, 253, 191]],
  algae: [[20, 30, 80], [25, 60, 110], [20, 100, 115], [30, 140, 95], [80, 170, 70], [150, 195, 60], [215, 215, 70]],
  haline: [[41, 24, 107], [33, 73, 160], [19, 110, 140], [44, 142, 135], [84, 171, 117], [150, 195, 90], [224, 214, 96], [253, 238, 153]],
  solar: [[51, 20, 24], [110, 30, 30], [165, 55, 25], [210, 100, 20], [235, 150, 30], [245, 205, 70], [250, 250, 180]],
  indicator: [[200, 210, 60], [120, 190, 80], [60, 170, 120], [40, 140, 170], [50, 100, 190], [90, 60, 160]],
  plasma: [[13, 8, 135], [84, 2, 163], [139, 10, 165], [185, 50, 137], [219, 92, 104], [244, 136, 73], [254, 188, 43], [240, 249, 33]],
  speed: [[30, 30, 60], [40, 70, 110], [40, 115, 130], [60, 155, 120], [130, 190, 100], [210, 215, 110], [255, 245, 180]],
  pressure: [[60, 40, 110], [110, 90, 170], [170, 160, 210], [230, 225, 230], [250, 205, 150], [235, 150, 60], [170, 80, 10]],
} satisfies Record<string, Stops>;

export type VariableStyle = {
  change: Stops;
  values: Stops;
  signed?: boolean; // values centred on zero (anomalies, wind components): change palette, symmetric range
  log?: boolean; // values on a log scale
  isobars?: boolean; // contour lines with H and L instead of filled bands
  wind?: boolean; // particles drift along the mean 10 m wind
  edge?: number; // values view: a line at this value, first year against the year shown (sea ice edge)
  up: string; // what a rising cell does, for "x% of the region ..."
  stripes?: string; // name of the per-year stripes
};

const heat = { change: CHANGE.heat, values: VALUES.thermal, up: "warms", stripes: "Warming stripes" };
const rain = { change: CHANGE.water, values: VALUES.rain, up: "gets wetter" };
const soil = { change: CHANGE.water, values: VALUES.soil, up: "gets wetter" };
const evaporation = { change: CHANGE.water, values: VALUES.rain, up: "evaporates more" };
const humidity = { change: CHANGE.water, values: VALUES.rain, up: "gets more humid" };
const snow = { change: CHANGE.cryo, values: VALUES.ice, up: "gains snow" };
const oceanHeat = { change: CHANGE.oceanHeat, values: VALUES.magma, up: "gains heat" };
const salinity = { change: CHANGE.salinity, values: VALUES.haline, up: "gets saltier" };
const windSpeed = { change: CHANGE.wind, values: VALUES.speed, up: "gets windier" };

const STYLES: Record<string, VariableStyle> = {
  merra2_t2m: heat,
  merra2_ts: heat,
  gldas_tair: heat,
  gldas_skin_temp: heat,
  sst: heat,
  imerg_precip: rain,
  gldas_precip: rain,
  gldas_evap: evaporation,
  gldas_potevap: evaporation,
  gldas_soilmoist_0_10: soil,
  gldas_soilmoist_10_40: soil,
  gldas_rootmoist: soil,
  merra2_qv2m: humidity,
  merra2_tqv: humidity,
  gldas_swe: snow,
  gldas_snowdepth: snow,
  sea_ice_conc: { change: CHANGE.cryo, values: VALUES.ice, edge: 15, up: "gains ice" },
  ohc_0_700: oceanHeat,
  ohc_0_2000: oceanHeat,
  sla: { change: CHANGE.sea, values: CHANGE.sea, signed: true, up: "rises" },
  ocean_mass: { change: CHANGE.sea, values: CHANGE.sea, signed: true, up: "gains mass" },
  ph: { change: CHANGE.ph, values: VALUES.indicator, up: "turns less acidic" },
  pco2: { change: CHANGE.pco2, values: VALUES.plasma, up: "rises" },
  chlor_a: { change: CHANGE.chlorophyll, values: VALUES.algae, log: true, up: "greens" },
  sss: salinity,
  sal_0_700: salinity,
  gldas_swdown: { change: CHANGE.radiation, values: VALUES.solar, up: "gets sunnier" },
  merra2_u10m: { change: CHANGE.wind, values: CHANGE.wind, signed: true, wind: true, up: "turns more eastward" },
  merra2_v10m: { change: CHANGE.wind, values: CHANGE.wind, signed: true, wind: true, up: "turns more northward" },
  merra2_wind10m: { ...windSpeed, wind: true },
  gldas_wind: windSpeed,
  merra2_ps: { change: CHANGE.pressure, values: VALUES.pressure, isobars: true, up: "rises" },
};

const FALLBACK: VariableStyle = { change: CHANGE.heat, values: VALUES.thermal, up: "trends up" };

export const styleFor = (key: string | undefined): VariableStyle => (key && STYLES[key]) || FALLBACK;

// t from 0 (low end) to 1 (high end)
export function colorAt(stops: Stops, t: number): Rgb {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const k = Math.min(stops.length - 2, Math.floor(x));
  const f = x - k;
  const [a, b] = [stops[k], stops[k + 1]];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

// a value on a scale centred on zero
export const divergingColor = (stops: Stops, value: number, max: number) => colorAt(stops, (value / max + 1) / 2);

const bandCache = new WeakMap<Stops, Rgb[]>();

// one colour per band; the same array for the same palette, so layers can tell palettes apart cheaply
export function bandColors(stops: Stops): Rgb[] {
  let bands = bandCache.get(stops);
  if (!bands) bandCache.set(stops, (bands = Array.from({ length: BANDS }, (_, k) => colorAt(stops, (k + 0.5) / BANDS))));
  return bands;
}

export function bandGradient(stops: Stops): string {
  const colors = bandColors(stops).map((c) => `rgb(${c.map(Math.round).join(",")})`);
  const at = (k: number) => `${((k / BANDS) * 100).toFixed(2)}%`;
  return `linear-gradient(90deg, ${colors.map((c, k) => `${c} ${at(k)}, ${c} ${at(k + 1)}`).join(", ")})`;
}

// colour scale limits in the values view, in the units drawn (log10 for log variables)
// (an API older than value_range gets a placeholder scale instead of an error)
export function valueRange(style: VariableStyle, range: [number, number] | undefined): [number, number] {
  const [lo, hi] = range ?? [0, 1];
  if (style.signed) {
    const max = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    return [-max, max];
  }
  if (style.log) return [Math.log10(Math.max(lo, 1e-3)), Math.log10(Math.max(hi, lo * 10, 1e-2))];
  return hi > lo ? [lo, hi] : [lo, lo + 1];
}

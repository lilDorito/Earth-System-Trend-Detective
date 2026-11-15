// colour and emphasis of each station point

import type { StationList } from "@/api/types";
import { STATION_FAINT, STATION_HIDDEN, STATION_PLAIN, STATION_STRONG } from "@/features/globe/StationLayer";
import { divergingColor, type Rgb } from "@/features/trendmap/styles";
import { formatSigned } from "@/lib/format";

const NO_TREND: Rgb = [120, 126, 136];
const MIN_LIGHT = 0.42;

export type StationStyle = { colors: Float32Array; kinds: Float32Array };

function put(colors: Float32Array, k: number, [r, g, b]: Rgb) {
  const light = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
  const lift = Math.max(0, MIN_LIGHT - light);
  colors[k * 3] = Math.min(1, r / 255 + lift);
  colors[k * 3 + 1] = Math.min(1, g / 255 + lift);
  colors[k * 3 + 2] = Math.min(1, b / 255 + lift);
}

export function trendStyle(list: StationList, stops: Rgb[], scale: number, onlySignificant: boolean): StationStyle {
  const n = list.ids.length;
  const colors = new Float32Array(n * 3);
  const kinds = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const slope = list.slope[k];
    if (slope === null) {
      put(colors, k, NO_TREND);
      kinds[k] = onlySignificant ? STATION_HIDDEN : STATION_FAINT;
      continue;
    }
    put(colors, k, divergingColor(stops, slope, scale || 1));
    kinds[k] = list.significant[k] ? STATION_STRONG : onlySignificant ? STATION_HIDDEN : STATION_PLAIN;
  }
  return { colors, kinds };
}

export function stationLabel(list: StationList, k: number): [string, string] {
  const slope = list.slope[k];
  const trend = slope === null ? `under ${list.min_years} years, no trend` : `${formatSigned(slope)} ${list.units}/dec${list.significant[k] ? ", significant" : ""}`;
  return [list.names[k], `${list.n_years[k]} yrs · ${trend}`];
}

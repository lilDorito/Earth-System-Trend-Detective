// contour lines and highs/lows of a gridded field, on the smoothed dense grid the globe draws

import type { GridGeometry } from "@/api/types";
import type { Ring } from "./boundaries";
import { prepareField } from "./field";

type Dense = { values: Float32Array; coverage: Float32Array; width: number; height: number; lon0: number; lat0: number; dlon: number; dlat: number };

function dense(values: ArrayLike<number | null>, nlat: number, nlon: number, grid: GridGeometry): Dense {
  // the same cached field the globe draws (or will draw), so an edge costs only the marching squares
  const field = prepareField(values, null, null, nlat, nlon, grid, false);
  const n = field.width * field.height;
  const out = new Float32Array(n);
  const coverage = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    out[k] = field.data[4 * k];
    coverage[k] = field.data[4 * k + 2];
  }
  const [lon0, lat0] = field.origin;
  const [dlon, dlat] = field.step;
  return { values: out, coverage, width: field.width, height: field.height, lon0, lat0, dlon, dlat };
}

// marching squares; cells without data count as below the level (no ice where there is no ocean)
export function contourSegments(values: ArrayLike<number | null>, nlat: number, nlon: number, grid: GridGeometry, level: number): Ring[] {
  const d = dense(values, nlat, nlon, grid);
  const at = (i: number, j: number) => {
    const k = i * d.width + (j % d.width);
    return d.coverage[k] > 0.5 ? d.values[k] : -Infinity;
  };
  const segments: Ring[] = [];
  const point = (i: number, j: number, i2: number, j2: number, a: number, b: number) => {
    const f = a === -Infinity ? 0 : b === -Infinity ? 1 : (level - a) / (b - a);
    const lat = d.lat0 + (i + (i2 - i) * f) * d.dlat;
    const lon = d.lon0 + (j + (j2 - j) * f) * d.dlon;
    return [lon > 180 ? lon - 360 : lon, lat];
  };
  for (let i = 0; i < d.height - 1; i++) {
    for (let j = 0; j < d.width; j++) {
      const a = at(i, j), b = at(i, j + 1), c = at(i + 1, j + 1), e = at(i + 1, j);
      const code = (a >= level ? 8 : 0) | (b >= level ? 4 : 0) | (c >= level ? 2 : 0) | (e >= level ? 1 : 0);
      if (code === 0 || code === 15) continue;
      // crossing points on the four sides: bottom (a-b), right (b-c), top (e-c), left (a-e)
      const bottom = () => point(i, j, i, j + 1, a, b);
      const right = () => point(i, j + 1, i + 1, j + 1, b, c);
      const top = () => point(i + 1, j, i + 1, j + 1, e, c);
      const left = () => point(i, j, i + 1, j, a, e);
      const pairs: (() => number[])[][] = {
        1: [[left, top]], 2: [[top, right]], 3: [[left, right]], 4: [[bottom, right]], 5: [[left, bottom], [top, right]],
        6: [[bottom, top]], 7: [[left, bottom]], 8: [[left, bottom]], 9: [[bottom, top]], 10: [[left, top], [bottom, right]],
        11: [[bottom, right]], 12: [[left, right]], 13: [[top, right]], 14: [[left, top]],
      }[code]!;
      for (const [p, q] of pairs) {
        const [x0, y0] = p();
        const [x1, y1] = q();
        // the satellite pole hole is not an edge, and a crossing on a corner gives a zero-length segment
        const length = Math.hypot(x1 - x0, y1 - y0);
        if (length > 1e-6 && length < 180 && Math.abs(y0) < 86 && Math.abs(y1) < 86) segments.push([x0, y0, x1, y1]);
      }
    }
  }
  return segments;
}

export type Extremum = { lat: number; lon: number; high: boolean };

// cells that are the highest or lowest within `radius` degrees and stand out from their surroundings
export function extrema(values: ArrayLike<number | null>, nlat: number, nlon: number, grid: GridGeometry, radius = 12, limit = 14): Extremum[] {
  const d = dense(values, nlat, nlon, grid);
  const step = Math.max(1, Math.round(1 / d.dlat)); // test about one point per degree
  const ri = Math.round(radius / d.dlat);
  const found: (Extremum & { prominence: number })[] = [];
  for (let i = ri; i < d.height - ri; i += step) {
    const lat = d.lat0 + i * d.dlat;
    if (Math.abs(lat) > 75) continue;
    const rj = Math.round(radius / d.dlon / Math.max(Math.cos((lat * Math.PI) / 180), 0.3));
    for (let j = 0; j < d.width; j += step) {
      const k = i * d.width + j;
      if (d.coverage[k] < 0.5) continue;
      const v = d.values[k];
      let max = true, min = true, sum = 0, count = 0;
      for (let di = -ri; di <= ri && (max || min); di += step) {
        for (let dj = -rj; dj <= rj; dj += step) {
          if (!di && !dj) continue;
          const kk = (i + di) * d.width + ((j + dj + d.width) % d.width);
          if (d.coverage[kk] < 0.5) continue;
          const w = d.values[kk];
          if (w >= v) max = false;
          if (w <= v) min = false;
          sum += w;
          count++;
        }
      }
      if ((max || min) && count) {
        found.push({ lat, lon: d.lon0 + j * d.dlon, high: max, prominence: Math.abs(v - sum / count) });
      }
    }
  }
  return found.sort((a, b) => b.prominence - a.prominence).slice(0, limit);
}

// trend grid -> layered color overlay (contour bands like a relief map)

import type { TrendGrid } from "@/api/types";

/** Trend at which the color saturates (°C per decade) */
export const MAX_TREND = 0.6;

/** Value at which the color saturates in the year-by-year view (°C vs the baseline years) */
export const FRAME_MAX = 2;

type Rgb = [number, number, number];

// diverging palette, cold -> neutral -> hot (Spectral-like, readable on a dark globe)
const STOPS: [number, Rgb][] = [
  [-1.0, [52, 14, 112]], // violet
  [-0.75, [44, 66, 192]], // blue
  [-0.5, [26, 146, 230]], // azure
  [-0.25, [38, 206, 214]], // cyan
  [-0.06, [84, 222, 164]], // mint
  [0.06, [168, 228, 84]], // lime
  [0.25, [250, 214, 44]], // yellow
  [0.5, [255, 138, 28]], // orange
  [0.75, [230, 38, 42]], // red
  [1.0, [146, 0, 74]], // dark magenta
];

/** Number of color layers across [-max, max] (even, so zero is a layer edge) */
export const BANDS = 24;

/** Color of layer k (0..BANDS-1) */
function bandColor(k: number, max: number): Rgb {
  const t = ((k + 0.5) / BANDS) * 2 - 1;
  return trendColor(t * max, max);
}

/** Stepped CSS gradient, same layers as the map */
export const LEGEND_GRADIENT = `linear-gradient(90deg, ${Array.from({ length: BANDS }, (_, k) => {
  const c = bandColor(k, 1).map(Math.round).join(",");
  return `rgb(${c}) ${((k / BANDS) * 100).toFixed(2)}%, rgb(${c}) ${(((k + 1) / BANDS) * 100).toFixed(2)}%`;
}).join(", ")})`;

export function trendColor(value: number, max = MAX_TREND): Rgb {
  const t = Math.max(-1, Math.min(1, value / max));
  for (let k = 1; k < STOPS.length; k++) {
    const [t1, c1] = STOPS[k];
    if (t <= t1) {
      const [t0, c0] = STOPS[k - 1];
      const f = (t - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

/** Smooth the field (3x3 blur, wraps in longitude) and collapse the poles to one value per row */
function smoothField(grid: TrendGrid): Float32Array {
  const { n_lat: nlat, n_lon: nlon } = grid;
  let cur = Float32Array.from(grid.slope as ArrayLike<number>);
  const dlat = 180 / (nlat - 1);
  const passes = Math.max(2, Math.ceil(2.5 / dlat) + 1);
  for (let p = 0; p < passes; p++) {
    const nxt = new Float32Array(cur.length);
    for (let i = 0; i < nlat; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(nlat - 1, i + 1);
      for (let j = 0; j < nlon; j++) {
        const jl = (j + nlon - 1) % nlon, jr = (j + 1) % nlon;
        nxt[i * nlon + j] =
          (cur[i * nlon + j] * 4 +
            cur[i * nlon + jl] * 2 + cur[i * nlon + jr] * 2 +
            cur[i0 * nlon + j] * 2 + cur[i1 * nlon + j] * 2 +
            cur[i0 * nlon + jl] + cur[i0 * nlon + jr] + cur[i1 * nlon + jl] + cur[i1 * nlon + jr]) / 16;
      }
    }
    cur = nxt;
  }
  // poles: longitude circles shrink to a point, so blend each row toward its own mean
  for (let i = 0; i < nlat; i++) {
    const lat = Math.abs(-90 + i * dlat);
    if (lat < 60) continue;
    const w = Math.min(1, Math.pow((lat - 60) / 28, 1.5));
    let mean = 0;
    for (let j = 0; j < nlon; j++) mean += cur[i * nlon + j];
    mean /= nlon;
    for (let j = 0; j < nlon; j++) cur[i * nlon + j] = cur[i * nlon + j] * (1 - w) + mean * w;
  }
  return cur;
}

/**
 * Grid -> layered image (north at the top, longitude -180..180), like contour layers on a relief map:
 * the smoothed field is interpolated per pixel, cut into discrete color bands, and band edges get a thin line.
 */
export function buildTrendCanvas(grid: TrendGrid, onlySignificant: boolean, max = MAX_TREND): HTMLCanvasElement {
  const { n_lat: nlat, n_lon: nlon } = grid;
  const W = 2048;
  const H = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const field = smoothField(grid);
  const at = (i: number, j: number) => field[i * nlon + (((j % nlon) + nlon) % nlon)];
  const band = new Int16Array(W * H).fill(-1);
  const gray = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const fi = (1 - (y + 0.5) / H) * (nlat - 1);
    const i0 = Math.min(nlat - 2, Math.floor(fi));
    const ti = fi - i0;
    for (let x = 0; x < W; x++) {
      const fj = ((x + 0.5) / W) * nlon - 0.5;
      const j0 = Math.floor(fj);
      const tj = fj - j0;
      const value = (at(i0, j0) * (1 - tj) + at(i0, j0 + 1) * tj) * (1 - ti) + (at(i0 + 1, j0) * (1 - tj) + at(i0 + 1, j0 + 1) * tj) * ti;
      const t = Math.max(-1, Math.min(0.999999, value / max));
      band[y * W + x] = Math.floor(((t + 1) / 2) * BANDS);
      if (onlySignificant && grid.sig[Math.round(fi) * nlon + (((Math.round(fj) % nlon) + nlon) % nlon)] === 0) gray[y * W + x] = 1;
    }
  }

  const image = ctx.createImageData(W, H);
  const colors = Array.from({ length: BANDS }, (_, k) => bandColor(k, max));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      const k = band[idx];
      let c: Rgb = colors[k];
      let alpha = 0.88;
      if (gray[idx]) {
        c = [96, 102, 116];
        alpha = 0.3;
      }
      // contour line where the next pixel (right / below) belongs to a different layer
      const edge = (x + 1 < W && band[idx + 1] !== k) || (y + 1 < H && band[idx + W] !== k);
      if (edge && !gray[idx]) {
        c = [c[0] * 0.55, c[1] * 0.55, c[2] * 0.55];
        alpha = 0.95;
      }
      const px = idx * 4;
      image.data[px] = c[0];
      image.data[px + 1] = c[1];
      image.data[px + 2] = c[2];
      image.data[px + 3] = Math.round(alpha * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export const TREND_GRADIENT = LEGEND_GRADIENT;

// rendered year maps, kept so scrubbing back and forth is instant (oldest dropped past the limit)
const frameCache = new Map<string, HTMLCanvasElement>();
const FRAME_CACHE_LIMIT = 16;

export function buildFrameCanvas(key: string, grid: TrendGrid): HTMLCanvasElement {
  let canvas = frameCache.get(key);
  if (!canvas) {
    canvas = buildTrendCanvas(grid, false, FRAME_MAX);
    frameCache.set(key, canvas);
    if (frameCache.size > FRAME_CACHE_LIMIT) frameCache.delete(frameCache.keys().next().value as string);
  }
  return canvas;
}

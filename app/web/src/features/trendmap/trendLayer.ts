// trend grid -> colored overlay image

import type { TrendGrid } from "@/api/types";

export const MAX_TREND = 0.8;

type Rgb = [number, number, number];

const COOL: Rgb = [33, 102, 172];
const NEUTRAL: Rgb = [247, 247, 247];
const WARM: Rgb = [178, 24, 43];
const MUTED: Rgb = [60, 66, 80];

export const TREND_GRADIENT = `linear-gradient(90deg, rgb(${COOL}), rgb(${NEUTRAL}), rgb(${WARM}))`;

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export function trendColor(value: number): Rgb {
  const t = Math.max(-1, Math.min(1, value / MAX_TREND));
  return t < 0 ? mix(NEUTRAL, COOL, -t) : mix(NEUTRAL, WARM, t);
}

// north up, longitude -180..180
export function buildTrendCanvas(grid: TrendGrid, onlySignificant: boolean): HTMLCanvasElement {
  const { n_lat: rows, n_lon: cols } = grid;
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const image = ctx.createImageData(cols, rows);
  for (let row = 0; row < rows; row++) {
    const latIndex = rows - 1 - row;
    for (let col = 0; col < cols; col++) {
      const idx = latIndex * cols + col;
      const value = grid.slope[idx];
      if (value == null) continue;
      const muted = onlySignificant && grid.sig[idx] === 0;
      const [r, g, b] = muted ? MUTED : trendColor(value);
      image.data.set([r, g, b, muted ? 150 : 255], (row * cols + col) * 4);
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

// Trend layer for the globe: color scale + texture composition (earth map + semi-transparent trend canvas)

import * as THREE from "three";
import type { TrendGrid } from "@/api/types";

/** Trend at which the color saturates (°C per decade) */
export const MAX_TREND = 0.8;

type Rgb = [number, number, number];

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export function trendColor(value: number): Rgb {
  const t = Math.max(-1, Math.min(1, value / MAX_TREND));
  const mid: Rgb = [247, 247, 247];
  return t < 0 ? mix(mid, [33, 102, 172], -t) : mix(mid, [178, 24, 43], t);
}

/** Grid -> image (north at the top, longitude -180..180) */
export function buildTrendCanvas(grid: TrendGrid, onlySignificant: boolean): HTMLCanvasElement {
  const { n_lat: nlat, n_lon: nlon } = grid;
  const canvas = document.createElement("canvas");
  canvas.width = nlon;
  canvas.height = nlat;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const image = ctx.createImageData(nlon, nlat);
  for (let row = 0; row < nlat; row++) {
    const latIndex = nlat - 1 - row;
    for (let col = 0; col < nlon; col++) {
      const idx = latIndex * nlon + col;
      const value = grid.slope[idx];
      if (value === null || value === undefined) continue;
      let color = trendColor(value);
      let alpha = 255;
      if (onlySignificant && grid.sig[idx] === 0) {
        color = [60, 66, 80];
        alpha = 150;
      }
      const px = (row * nlon + col) * 4;
      image.data.set([color[0], color[1], color[2], alpha], px);
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function composeTexture(base: HTMLImageElement, trend: HTMLCanvasElement | null) {
  const canvas = document.createElement("canvas");
  canvas.width = base.width;
  canvas.height = base.height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.drawImage(base, 0, 0, canvas.width, canvas.height);
    if (trend) {
      ctx.globalAlpha = 0.6;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(trend, 0, 0, canvas.width, canvas.height);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

// grid field preparation for globe layers: smoothing and upsampling into a half-float texture

import { ClampToEdgeWrapping, DataTexture, DataUtils, HalfFloatType, LinearFilter, RGBAFormat, RepeatWrapping } from "three";
import type { GridGeometry } from "@/api/types";

export type Smoothed = { values: Float32Array; coverage: Float32Array };

function blur(src: Float32Array, nlat: number, nlon: number) {
  const out = new Float32Array(src.length);
  for (let i = 0; i < nlat; i++) {
    const up = Math.min(nlat - 1, i + 1) * nlon;
    const down = Math.max(0, i - 1) * nlon;
    const row = i * nlon;
    for (let j = 0; j < nlon; j++) {
      const l = (j + nlon - 1) % nlon;
      const r = (j + 1) % nlon;
      out[row + j] =
        (4 * src[row + j] +
          2 * (src[row + l] + src[row + r] + src[down + j] + src[up + j]) +
          src[down + l] + src[down + r] + src[up + l] + src[up + r]) / 16;
    }
  }
  return out;
}

function fillHoles(values: Float32Array, weight: Float32Array, nlat: number, nlon: number) {
  let filled = Uint8Array.from(weight, (w) => (w > 1e-6 ? 1 : 0));
  for (let pass = 0; pass < 12; pass++) {
    const next = Uint8Array.from(filled);
    let changed = false;
    for (let i = 0; i < nlat; i++) {
      for (let j = 0; j < nlon; j++) {
        const k = i * nlon + j;
        if (filled[k]) continue;
        let sum = 0;
        let count = 0;
        for (let di = -1; di <= 1; di++) {
          const r = i + di;
          if (r < 0 || r >= nlat) continue;
          for (let dj = -1; dj <= 1; dj++) {
            const n = r * nlon + ((j + dj + nlon) % nlon);
            if (!filled[n]) continue;
            sum += values[n];
            count++;
          }
        }
        if (!count) continue;
        values[k] = sum / count;
        next[k] = 1;
        changed = true;
      }
    }
    filled = next;
    if (!changed) break;
  }
}

// light blur that ignores cells without data (wraps in longitude), then each polar row is pulled toward
// its mean so the poles meet in one value
export function smoothField(
  values: ArrayLike<number | null>,
  nlat: number,
  nlon: number,
  grid: GridGeometry,
  extend = false,
): Smoothed {
  const coverage = Float32Array.from(values as ArrayLike<number | null>, (v) => (v == null ? 0 : 1));
  let weighted = Float32Array.from(values as ArrayLike<number | null>, (v) => v ?? 0);
  let weight = coverage;
  for (let p = 0; p < Math.max(2, Math.ceil(2.5 / grid.dlat)); p++) {
    weighted = blur(weighted, nlat, nlon);
    weight = blur(weight, nlat, nlon);
  }
  const smooth = weighted.map((v, k) => (weight[k] > 1e-6 ? v / weight[k] : 0));
  // ocean or land fields are cut by the real coastline in the shader, so the values have to reach
  // past the coarse cells: empty cells take the mean of their filled neighbours, ring by ring
  if (extend) fillHoles(smooth, weight, nlat, nlon);
  // poleward from 60 degrees in each hemisphere; a row without data (a satellite pole hole) takes the
  // mean of the last row with data, so values cannot fan out by longitude around the pole
  const rows = Array.from({ length: nlat }, (_, i) => i);
  for (const order of [rows.filter((i) => grid.lat0 + i * grid.dlat >= 0), rows.filter((i) => grid.lat0 + i * grid.dlat < 0).reverse()]) {
    let last: number | null = null;
    for (const i of order) {
      const lat = Math.abs(grid.lat0 + i * grid.dlat);
      const row = i * nlon;
      let sum = 0;
      let count = 0;
      for (let j = 0; j < nlon; j++) {
        if (!coverage[row + j]) continue;
        sum += smooth[row + j];
        count++;
      }
      const mean: number | null = count ? sum / count : last;
      if (count) last = mean;
      if (lat < 60 || mean == null) continue;
      const w = count ? Math.min(1, ((lat - 60) / 28) ** 1.5) : 1;
      for (let j = 0; j < nlon; j++) smooth[row + j] += (mean - smooth[row + j]) * w;
    }
  }
  // near the poles a row's coverage is its mean: a partly covered polar row would otherwise cut
  // wedges into the field, all meeting at the pole
  const shown = Float32Array.from(coverage);
  for (let i = 0; i < nlat; i++) {
    if (Math.abs(grid.lat0 + i * grid.dlat) < 80) continue;
    const row = shown.subarray(i * nlon, (i + 1) * nlon);
    row.fill(row.reduce((a, b) => a + b, 0) / nlon >= 0.5 ? 1 : 0);
  }
  return { values: smooth, coverage: shown };
}

// cubic B-spline weights for each sub-step, so contours stay smooth after linear filtering of the dense grid
function weightsFor(factor: number) {
  return Array.from({ length: factor }, (_, k) => {
    const t = k / factor;
    return [(1 - t) ** 3 / 6, (3 * t ** 3 - 6 * t ** 2 + 4) / 6, (-3 * t ** 3 + 3 * t ** 2 + 3 * t + 1) / 6, t ** 3 / 6];
  });
}

// rows: n -> (n - 1) * factor + 1, clamped at the poles; columns: n -> n * factor, wrapped
function upsample(src: Float32Array, nlat: number, nlon: number, factor: number) {
  const weights = weightsFor(factor);
  const width = nlon * factor;
  const height = (nlat - 1) * factor + 1;
  const rows = new Float32Array(nlat * width);
  for (let i = 0; i < nlat; i++) {
    for (let x = 0; x < width; x++) {
      const j = Math.floor(x / factor);
      const w = weights[x % factor];
      let sum = 0;
      for (let d = 0; d < 4; d++) sum += w[d] * src[i * nlon + ((j + d - 1 + nlon) % nlon)];
      rows[i * width + x] = sum;
    }
  }
  const out = new Float32Array(height * width);
  for (let y = 0; y < height; y++) {
    const i = Math.floor(y / factor);
    const w = weights[y % factor];
    for (let d = 0; d < 4; d++) {
      const r = Math.min(nlat - 1, Math.max(0, i + d - 1)) * width;
      const wd = w[d];
      for (let x = 0; x < width; x++) out[y * width + x] += wd * rows[r + x];
    }
  }
  return { out, width, height };
}

// texels: value, mask (1 shown in full, 0 muted), coverage (1 data, 0 none), significance (1 stippled)
export function fieldGrid(
  smoothed: Smoothed,
  mask: ArrayLike<number> | null,
  sig: ArrayLike<number> | null,
  nlat: number,
  nlon: number,
  grid: GridGeometry,
) {
  // about 720 texels around the globe: enough for smooth contours, small enough to rebuild per year
  const factor = Math.min(4, Math.max(2, Math.round(720 / nlon)));
  const { out: values, width, height } = upsample(smoothed.values, nlat, nlon, factor);
  const coverage = upsample(smoothed.coverage, nlat, nlon, factor).out;
  const shown = mask ? upsample(Float32Array.from(mask), nlat, nlon, factor).out : null;
  const stippled = sig ? upsample(Float32Array.from(sig), nlat, nlon, factor).out : null;
  const data = new Float32Array(width * height * 4);
  for (let k = 0; k < values.length; k++) {
    data[4 * k] = values[k];
    data[4 * k + 1] = shown ? shown[k] : 1;
    data[4 * k + 2] = coverage[k];
    data[4 * k + 3] = stippled ? stippled[k] : 0;
  }
  return {
    data,
    width,
    height,
    origin: [grid.lon0, grid.lat0] as const,
    step: [grid.dlon / factor, grid.dlat / factor] as const,
  };
}

export type FieldGrid = ReturnType<typeof fieldGrid>;

function toHalf(data: Float32Array) {
  const half = new Uint16Array(data.length);
  for (let k = 0; k < data.length; k++) half[k] = DataUtils.toHalfFloat(data[k]);
  return half;
}

export function createFieldTexture({ data, width, height }: FieldGrid) {
  const texture = new DataTexture(toHalf(data), width, height, RGBAFormat, HalfFloatType);
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

// refill in place, so stepping through years never reallocates GPU memory
export function updateFieldTexture(texture: DataTexture, data: Float32Array) {
  texture.image.data = toHalf(data);
  texture.needsUpdate = true;
}

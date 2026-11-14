// grid field preparation for globe layers: smoothing and upsampling into a half-float texture

import { ClampToEdgeWrapping, DataTexture, DataUtils, HalfFloatType, LinearFilter, RGFormat, RepeatWrapping } from "three";

export const UPSAMPLE = 4;

// light blur (wraps in longitude), then each polar row is pulled toward its mean so the poles meet in one value
export function smoothField(values: ArrayLike<number | null>, nlat: number, nlon: number): Float32Array {
  let cur = Float32Array.from(values as ArrayLike<number>, (v) => v ?? 0);
  const dlat = 180 / (nlat - 1);
  const passes = Math.max(2, Math.ceil(2.5 / dlat));
  for (let p = 0; p < passes; p++) {
    const next = new Float32Array(cur.length);
    for (let i = 0; i < nlat; i++) {
      const up = Math.min(nlat - 1, i + 1) * nlon;
      const down = Math.max(0, i - 1) * nlon;
      const row = i * nlon;
      for (let j = 0; j < nlon; j++) {
        const l = (j + nlon - 1) % nlon;
        const r = (j + 1) % nlon;
        next[row + j] =
          (4 * cur[row + j] +
            2 * (cur[row + l] + cur[row + r] + cur[down + j] + cur[up + j]) +
            cur[down + l] + cur[down + r] + cur[up + l] + cur[up + r]) / 16;
      }
    }
    cur = next;
  }
  for (let i = 0; i < nlat; i++) {
    const lat = Math.abs(-90 + i * dlat);
    if (lat < 60) continue;
    const w = Math.min(1, ((lat - 60) / 28) ** 1.5);
    const row = i * nlon;
    let mean = 0;
    for (let j = 0; j < nlon; j++) mean += cur[row + j];
    mean /= nlon;
    for (let j = 0; j < nlon; j++) cur[row + j] += (mean - cur[row + j]) * w;
  }
  return cur;
}

// cubic B-spline weights for each sub-step, so contours stay smooth after linear filtering of the dense grid
const WEIGHTS = Array.from({ length: UPSAMPLE }, (_, k) => {
  const t = k / UPSAMPLE;
  return [(1 - t) ** 3 / 6, (3 * t ** 3 - 6 * t ** 2 + 4) / 6, (-3 * t ** 3 + 3 * t ** 2 + 3 * t + 1) / 6, t ** 3 / 6];
});

// rows: n -> (n - 1) * UPSAMPLE + 1, clamped at the poles; columns: n -> n * UPSAMPLE, wrapped
function upsample(src: Float32Array, nlat: number, nlon: number) {
  const width = nlon * UPSAMPLE;
  const height = (nlat - 1) * UPSAMPLE + 1;
  const rows = new Float32Array(nlat * width);
  for (let i = 0; i < nlat; i++) {
    for (let x = 0; x < width; x++) {
      const j = Math.floor(x / UPSAMPLE);
      const w = WEIGHTS[x % UPSAMPLE];
      let sum = 0;
      for (let d = 0; d < 4; d++) sum += w[d] * src[i * nlon + ((j + d - 1 + nlon) % nlon)];
      rows[i * width + x] = sum;
    }
  }
  const out = new Float32Array(height * width);
  for (let y = 0; y < height; y++) {
    const i = Math.floor(y / UPSAMPLE);
    const w = WEIGHTS[y % UPSAMPLE];
    for (let d = 0; d < 4; d++) {
      const r = Math.min(nlat - 1, Math.max(0, i + d - 1)) * width;
      const wd = w[d];
      for (let x = 0; x < width; x++) out[y * width + x] += wd * rows[r + x];
    }
  }
  return { out, width, height };
}

// interleaved pairs: field value, then mask (1 = shown in full, 0 = muted)
export function fieldGrid(field: Float32Array, mask: ArrayLike<number> | null, nlat: number, nlon: number) {
  const { out: values, width, height } = upsample(field, nlat, nlon);
  const shown = mask ? upsample(Float32Array.from(mask), nlat, nlon).out : null;
  const data = new Float32Array(width * height * 2);
  for (let k = 0; k < values.length; k++) {
    data[2 * k] = values[k];
    data[2 * k + 1] = shown ? shown[k] : 1;
  }
  return { data, width, height };
}

export type FieldGrid = ReturnType<typeof fieldGrid>;

function toHalf(data: Float32Array) {
  const half = new Uint16Array(data.length);
  for (let k = 0; k < data.length; k++) half[k] = DataUtils.toHalfFloat(data[k]);
  return half;
}

export function createFieldTexture({ data, width, height }: FieldGrid) {
  const texture = new DataTexture(toHalf(data), width, height, RGFormat, HalfFloatType);
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

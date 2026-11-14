// trend palette, shared by the globe layer, the legend and the stripes

export const MAX_TREND = 0.6; // °C per decade where the color saturates
export const FRAME_MAX = 2; // °C vs the baseline in the year-by-year view
export const BANDS = 24; // even, so zero falls on a band edge

type Rgb = [number, number, number];

// diverging, cold to hot, readable on a dark globe
const STOPS: [number, Rgb][] = [
  [-1.0, [52, 14, 112]],
  [-0.75, [44, 66, 192]],
  [-0.5, [26, 146, 230]],
  [-0.25, [38, 206, 214]],
  [-0.06, [84, 222, 164]],
  [0.06, [168, 228, 84]],
  [0.25, [250, 214, 44]],
  [0.5, [255, 138, 28]],
  [0.75, [230, 38, 42]],
  [1.0, [146, 0, 74]],
];

export function trendColor(value: number, max = MAX_TREND): Rgb {
  const t = Math.max(-1, Math.min(1, value / max));
  for (let k = 1; k < STOPS.length; k++) {
    const [t1, c1] = STOPS[k];
    if (t > t1) continue;
    const [t0, c0] = STOPS[k - 1];
    const f = (t - t0) / (t1 - t0);
    return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
  }
  return STOPS[STOPS.length - 1][1];
}

export const bandColors: Rgb[] = Array.from({ length: BANDS }, (_, k) => trendColor(((k + 0.5) / BANDS) * 2 - 1, 1));

export const TREND_GRADIENT = `linear-gradient(90deg, ${bandColors
  .map((c, k) => {
    const rgb = `rgb(${c.map(Math.round).join(",")})`;
    return `${rgb} ${((k / BANDS) * 100).toFixed(2)}%, ${rgb} ${(((k + 1) / BANDS) * 100).toFixed(2)}%`;
  })
  .join(", ")})`;

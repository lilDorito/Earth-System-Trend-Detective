// what the globe draws for the current variable, display and year: the field, its look and the extras

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { TrendFrames } from "@/api/types";
import { contourSegments, extrema } from "@/features/globe/contours";
import type { FieldLook } from "@/features/globe/FieldLayer";
import { useTrendMapStore } from "@/store/useTrendMapStore";
import { FADE, bandColors, styleFor, valueRange } from "./styles";

// per-cell mean over the years, skipping missing values
function periodMean(frames: TrendFrames): (number | null)[] {
  const n = frames.frames[0]?.length ?? 0;
  const sum = new Float64Array(n);
  const count = new Uint16Array(n);
  for (const frame of frames.frames) {
    frame.forEach((v, k) => {
      if (v == null) return;
      sum[k] += v;
      count[k]++;
    });
  }
  return Array.from(sum, (v, k) => (count[k] ? v / count[k] : null));
}

export function useTrendLayer() {
  const s = useTrendMapStore(
    useShallow((s) => ({
      meta: s.meta,
      grid: s.grid,
      frames: s.frames,
      valueFrames: s.valueFrames,
      display: s.display,
      view: s.view,
      frameYear: s.frameYear,
      onlySignificant: s.onlySignificant,
      stipple: s.stipple,
    })),
  );
  const style = styleFor(s.meta?.key);
  const mean = useMemo(() => (s.valueFrames ? periodMean(s.valueFrames) : null), [s.valueFrames]);

  // built even while hidden, so switching the layer on can fade in at once
  const layer = useMemo(() => {
    const { meta } = s;
    if (!meta) return null;
    const isobars = !!style.isobars;
    if (s.display === "values") {
      const frames = s.valueFrames;
      if (!frames || !mean) return null;
      const index = s.view === "years" ? frames.years.indexOf(s.frameYear) : -1;
      if (s.view === "years" && index < 0) return null;
      const raw = index >= 0 ? frames.frames[index] : mean;
      const values = style.log ? raw.map((v) => (v != null && v > 0 ? Math.log10(v) : null)) : raw;
      const [lo, hi] = valueRange(style, meta.value_range);
      const look: FieldLook = { palette: bandColors(style.signed ? style.change : style.values), lo, hi, fade: 0, isobars, stipple: false };
      return { nlat: frames.n_lat, nlon: frames.n_lon, grid: frames, values, mask: null, sig: null, look, quantity: `${meta.key}:values` };
    }
    const palette = bandColors(style.change);
    if (s.view === "years" && s.frames) {
      const index = s.frames.years.indexOf(s.frameYear);
      if (index < 0) return null;
      const limit = meta.anomaly_scale;
      const look: FieldLook = { palette, lo: -limit, hi: limit, fade: FADE, isobars, stipple: false };
      const { n_lat, n_lon } = s.frames;
      return { nlat: n_lat, nlon: n_lon, grid: s.frames, values: s.frames.frames[index], mask: null, sig: null, look, quantity: `${meta.key}:years` };
    }
    if (!s.grid) return null;
    const { n_lat, n_lon, slope, sig } = s.grid;
    const limit = meta.trend_scale;
    const look: FieldLook = { palette, lo: -limit, hi: limit, fade: FADE, isobars, stipple: s.stipple };
    const mask = s.onlySignificant ? sig : null;
    return { nlat: n_lat, nlon: n_lon, grid: s.grid, values: slope, mask, sig, look, quantity: `${meta.key}:trend` };
  }, [s, style, mean]);

  // sea ice: the edge in the first year against the edge in the year shown (or the period mean)
  const edges = useMemo(() => {
    if (!layer || style.edge == null || s.display !== "values" || !s.valueFrames) return null;
    const { n_lat, n_lon } = s.valueFrames;
    return {
      first: contourSegments(s.valueFrames.frames[0], n_lat, n_lon, s.valueFrames, style.edge),
      shown: contourSegments(layer.values, n_lat, n_lon, s.valueFrames, style.edge),
      year: s.valueFrames.years[0],
    };
  }, [layer, style.edge, s.display, s.valueFrames]);

  const highsLows = useMemo(
    () => (layer && style.isobars ? extrema(layer.values, layer.nlat, layer.nlon, layer.grid) : []),
    [layer, style.isobars],
  );

  return { layer, style, edges, highsLows };
}

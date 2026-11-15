// what the globe draws for the current variable, display and year: the field, its look and the extras

import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { TrendFrames } from "@/api/types";
import { contourSegments, extrema } from "@/features/globe/contours";
import { halfOf, prepareField } from "@/features/globe/field";
import type { FieldLook } from "@/features/globe/FieldLayer";
import { useTrendMapStore } from "@/store/useTrendMapStore";
import { FADE, FINGERPRINT, bandColors, styleFor, valueRange } from "./styles";

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
      hotspot: s.hotspot,
    })),
  );
  const style = styleFor(s.meta?.key);
  // transformed once per data set, so each year keeps one array identity and its prepared field is reused
  const valueMaps = useMemo(() => {
    if (!s.valueFrames) return null;
    // zero (no fire) and anything below the floor take the floor's colour instead of looking like missing data
    const floor = style.logFloor ?? 1e-3;
    const log = (frame: (number | null)[]) => frame.map((v) => (v == null ? null : Math.log10(Math.max(v, floor))));
    const mean = periodMean(s.valueFrames);
    return style.log ? { years: s.valueFrames.frames.map(log), mean: log(mean) } : { years: s.valueFrames.frames, mean };
  }, [s.valueFrames, style.log, style.logFloor]);

  // built even while hidden, so switching the layer on can fade in at once
  const layer = useMemo(() => {
    const { meta } = s;
    // a process fingerprint replaces the variable while it is on
    if (s.hotspot) {
      const h = s.hotspot;
      const look: FieldLook = { palette: bandColors(FINGERPRINT), lo: 0, hi: 1, fade: 0, isobars: false, stipple: false };
      return { nlat: h.n_lat, nlon: h.n_lon, grid: h, values: h.score, mask: null, sig: null, look, quantity: `hotspot:${h.id}`, domain: h.domain };
    }
    if (!meta) return null;
    const isobars = !!style.isobars;
    if (s.display === "values") {
      const frames = s.valueFrames;
      if (!frames || !valueMaps) return null;
      const index = s.view === "years" ? frames.years.indexOf(s.frameYear) : -1;
      if (s.view === "years" && index < 0) return null;
      const values = index >= 0 ? valueMaps.years[index] : valueMaps.mean;
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
  }, [s, style, valueMaps]);

  // the next two years are prepared while the browser is idle, so stepping or playing through the
  // timeline only uploads a texture that is already built
  const extend = !!s.meta && s.meta.domain !== "global";
  useEffect(() => {
    const frames = s.display === "values" ? s.valueFrames : s.frames;
    const maps = s.display === "values" ? valueMaps?.years : s.frames?.frames;
    if (!frames || !maps) return;
    const at = frames.years.indexOf(s.frameYear);
    const next = [1, 2].map((d) => maps[(Math.max(at, 0) + d) % maps.length]);
    const idle = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 120));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    let handle = 0;
    const step = () => {
      const values = next.shift();
      if (!values) return;
      halfOf(prepareField(values, null, null, frames.n_lat, frames.n_lon, frames, extend));
      handle = idle(step);
    };
    handle = idle(step);
    return () => cancel(handle);
  }, [s.display, s.frames, s.valueFrames, valueMaps, s.frameYear, extend]);

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

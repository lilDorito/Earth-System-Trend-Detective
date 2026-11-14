// global trend map page

import { useEffect, useMemo } from "react";
import { AnimatePresence } from "framer-motion";
import { LoaderCircle } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import FieldLayer from "@/features/globe/FieldLayer";
import GlobeCanvas from "@/features/globe/GlobeCanvas";
import { useEarthTexture } from "@/features/globe/useEarthTexture";
import ControlPanel from "@/features/trendmap/ControlPanel";
import PointPanel from "@/features/trendmap/PointPanel";
import RegionPanel from "@/features/trendmap/RegionPanel";
import TimelineBar from "@/features/trendmap/TimelineBar";
import { bandColors, FRAME_MAX, MAX_TREND } from "@/features/trendmap/trendLayer";
import { useTrendMapStore } from "@/store/useTrendMapStore";

export default function TrendMapPage() {
  const s = useTrendMapStore(
    useShallow((s) => ({
      grid: s.grid,
      frames: s.frames,
      view: s.view,
      frameYear: s.frameYear,
      region: s.region,
      showTrend: s.showTrend,
      error: s.error,
      onlySignificant: s.onlySignificant,
      picked: s.picked,
      selected: s.selected,
      pointLoading: s.pointLoading,
      load: s.load,
      selectPoint: s.selectPoint,
      clearSelection: s.clearSelection,
    })),
  );

  useEffect(() => {
    void s.load();
  }, [s.load]);

  // built even while hidden, so switching the layer on can fade in at once
  const layer = useMemo(() => {
    if (s.view === "years" && s.frames) {
      const { n_lat, n_lon, years, frames } = s.frames;
      const index = years.indexOf(s.frameYear);
      if (index < 0) return null;
      return { nlat: n_lat, nlon: n_lon, values: frames[index], mask: null, max: FRAME_MAX };
    }
    if (!s.grid) return null;
    const { n_lat, n_lon, slope, sig } = s.grid;
    return { nlat: n_lat, nlon: n_lon, values: slope, mask: s.onlySignificant ? sig : null, max: MAX_TREND };
  }, [s.grid, s.frames, s.view, s.frameYear, s.onlySignificant]);
  const texture = useEarthTexture();

  return (
    <div className="relative h-full overflow-hidden">
      <GlobeCanvas
        texture={texture}
        marker={s.picked}
        autoRotate={!s.picked}
        hint="Click to inspect a grid cell, right-click to clear"
        detail={!s.showTrend}
        onPick={(lat, lon) => void s.selectPoint(lat, lon)}
        onClear={s.clearSelection}
        loading={s.showTrend && !layer && !s.error ? "Loading trend data" : null}
      >
        {layer && texture && (
          <FieldLayer earth={texture} colors={bandColors} transition={1.1} visible={s.showTrend} {...layer} />
        )}
      </GlobeCanvas>
      <ControlPanel />
      <AnimatePresence>
        {s.region && <RegionPanel key="region" region={s.region} shifted={s.selected !== null} />}
        {s.selected && <PointPanel key="point" point={s.selected} loading={s.pointLoading} />}
      </AnimatePresence>
      {s.showTrend && !(s.selected && window.matchMedia("(max-width: 639px)").matches) && <TimelineBar />}
      {s.pointLoading && !s.selected && (
        <div className="absolute bottom-3 right-4 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <LoaderCircle className="size-3 animate-spin" /> loading cell
        </div>
      )}
    </div>
  );
}

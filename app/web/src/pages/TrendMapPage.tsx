// global trend map page

import { useEffect, useMemo } from "react";
import { AnimatePresence } from "framer-motion";
import { LoaderCircle } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import GlobeCanvas from "@/features/globe/GlobeCanvas";
import { useEarthTexture } from "@/features/globe/useEarthTexture";
import ControlPanel from "@/features/trendmap/ControlPanel";
import PointPanel from "@/features/trendmap/PointPanel";
import RegionPanel from "@/features/trendmap/RegionPanel";
import TimelineBar from "@/features/trendmap/TimelineBar";
import { buildFrameCanvas, buildTrendCanvas } from "@/features/trendmap/trendLayer";
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
      onlySignificant: s.onlySignificant,
      picked: s.picked,
      selected: s.selected,
      pointLoading: s.pointLoading,
      load: s.load,
      selectPoint: s.selectPoint,
    })),
  );

  useEffect(() => {
    void s.load();
  }, [s.load]);

  const overlay = useMemo(() => {
    if (!s.showTrend) return null;
    if (s.view === "years" && s.frames) {
      const index = s.frames.years.indexOf(s.frameYear);
      if (index < 0) return null;
      const { n_lat, n_lon, frames } = s.frames;
      return buildFrameCanvas(`${s.frames.start}-${s.frames.end}-${index}`, { n_lat, n_lon, slope: frames[index], sig: [] });
    }
    return s.grid ? buildTrendCanvas(s.grid, s.onlySignificant) : null;
  }, [s.grid, s.frames, s.view, s.frameYear, s.showTrend, s.onlySignificant]);
  const texture = useEarthTexture(overlay);

  return (
    <div className="relative h-full overflow-hidden">
      <GlobeCanvas
        texture={texture}
        marker={s.picked}
        autoRotate={!s.picked}
        hint="Click the globe to inspect a grid cell"
        detail={!s.showTrend}
        onPick={(lat, lon) => void s.selectPoint(lat, lon)}
      />
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

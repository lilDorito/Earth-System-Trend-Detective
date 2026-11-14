// global trend map page

import { useEffect, useMemo } from "react";
import { AnimatePresence } from "framer-motion";
import { LoaderCircle } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import GlobeCanvas from "@/features/globe/GlobeCanvas";
import { useEarthTexture } from "@/features/globe/useEarthTexture";
import ControlPanel from "@/features/trendmap/ControlPanel";
import PointPanel from "@/features/trendmap/PointPanel";
import { buildTrendCanvas } from "@/features/trendmap/trendLayer";
import { useTrendMapStore } from "@/store/useTrendMapStore";

export default function TrendMapPage() {
  const s = useTrendMapStore(
    useShallow((s) => ({
      grid: s.grid,
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

  const overlay = useMemo(
    () => (s.grid && s.showTrend ? buildTrendCanvas(s.grid, s.onlySignificant) : null),
    [s.grid, s.showTrend, s.onlySignificant],
  );
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
        {s.selected && <PointPanel key="point" point={s.selected} loading={s.pointLoading} />}
      </AnimatePresence>
      {s.pointLoading && !s.selected && (
        <div className="absolute bottom-3 right-4 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <LoaderCircle className="size-3 animate-spin" /> loading cell
        </div>
      )}
    </div>
  );
}

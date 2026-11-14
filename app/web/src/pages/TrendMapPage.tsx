// Global temperature trend map: spinning globe, trend layer, click-to-chart

import { useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import ControlPanel from "@/features/trendmap/ControlPanel";
import PointPanel from "@/features/trendmap/PointPanel";
import TrendGlobe from "@/features/trendmap/TrendGlobe";
import { useTrendMapStore } from "@/store/useTrendMapStore";

export default function TrendMapPage() {
  const selected = useTrendMapStore((s) => s.selected);
  const loadAll = useTrendMapStore((s) => s.loadAll);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  return (
    <div className="relative h-full w-full">
      <TrendGlobe />
      <ControlPanel />
      <AnimatePresence>{selected && <PointPanel key="point" point={selected} />}</AnimatePresence>
    </div>
  );
}

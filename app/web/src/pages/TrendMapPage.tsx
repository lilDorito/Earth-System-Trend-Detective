// global trend map page

import { useEffect, useMemo } from "react";
import { AnimatePresence } from "framer-motion";
import { LoaderCircle } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import ExtremaLabels from "@/features/globe/ExtremaLabels";
import FieldLayer from "@/features/globe/FieldLayer";
import GlobeCanvas from "@/features/globe/GlobeCanvas";
import Outline from "@/features/globe/Outline";
import { useEarthTexture } from "@/features/globe/useEarthTexture";
import { useOutline } from "@/features/globe/useOutline";
import WindLayer from "@/features/globe/WindLayer";
import ControlPanel from "@/features/trendmap/ControlPanel";
import PointPanel from "@/features/trendmap/PointPanel";
import RegionPanel from "@/features/trendmap/RegionPanel";
import TimelineBar from "@/features/trendmap/TimelineBar";
import { useTrendLayer } from "@/features/trendmap/useTrendLayer";
import { targetArea, useTrendMapStore } from "@/store/useTrendMapStore";

export default function TrendMapPage() {
  const s = useTrendMapStore(
    useShallow((s) => ({
      meta: s.meta,
      variable: s.variable,
      variables: s.variables,
      wind: s.wind,
      loading: s.loading,
      region: s.region,
      regionTarget: s.regionTarget,
      setRegion: s.setRegion,
      focus: s.focus,
      showTrend: s.showTrend,
      opacity: s.opacity,
      error: s.error,
      picked: s.picked,
      selected: s.selected,
      pointLoading: s.pointLoading,
      pointError: s.pointError,
      load: s.load,
      selectPoint: s.selectPoint,
      clearSelection: s.clearSelection,
    })),
  );

  useEffect(() => {
    void s.load();
  }, [s.load]);

  const { layer, style, edges, highsLows } = useTrendLayer();
  // the variable being loaded, not the one still on screen
  const name = s.variables.find((v) => v.key === s.variable)?.name ?? s.meta?.name ?? "trend data";
  const texture = useEarthTexture();
  const area = useMemo(() => (s.regionTarget ? targetArea(s.regionTarget) : null), [s.regionTarget]);
  const outline = useOutline(area);

  return (
    <div className="relative h-full overflow-hidden">
      <GlobeCanvas
        texture={texture}
        marker={s.picked}
        outline={outline}
        focus={s.focus}
        autoRotate={!s.picked && !s.regionTarget}
        hint="Click to inspect a grid cell, shift-drag for a box, right-click to clear"
        detail={!s.showTrend}
        onPick={(lat, lon, city) => void s.selectPoint(lat, lon, city)}
        onClear={s.clearSelection}
        onBox={(box) => void s.setRegion({ kind: "box", box })}
        loading={s.showTrend && (s.loading || !layer) && !s.error ? `Loading ${name.toLowerCase()}` : null}
      >
        {layer && texture && <FieldLayer earth={texture} transition={1.1} visible={s.showTrend} opacity={s.opacity} {...layer} />}
        {style.wind && s.wind && (
          <WindLayer u={s.wind.u} v={s.wind.v} nlat={s.wind.n_lat} nlon={s.wind.n_lon} grid={s.wind} visible={s.showTrend} />
        )}
        <ExtremaLabels points={highsLows} visible={s.showTrend} />
        {s.showTrend && edges && (
          <>
            <Outline rings={edges.first} color={0xfd8d3c} width={1.5} dashed />
            <Outline rings={edges.shown} color={0xf4fbff} width={1.8} />
          </>
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
      {s.pointError && !s.pointLoading && (
        <div className="absolute bottom-3 right-4 font-mono text-[11px] text-warning">{s.pointError}</div>
      )}
    </div>
  );
}

// global trend map page

import { useEffect, useMemo } from "react";
import { AnimatePresence } from "framer-motion";
import { LoaderCircle } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import ExtremaLabels from "@/features/globe/ExtremaLabels";
import FieldLayer from "@/features/globe/FieldLayer";
import GlobeCanvas from "@/features/globe/GlobeCanvas";
import { countryAt } from "@/features/globe/countryAt";
import { seaAt } from "@/features/globe/seas";
import Outline from "@/features/globe/Outline";
import { useEarthTexture } from "@/features/globe/useEarthTexture";
import { useOutline } from "@/features/globe/useOutline";
import WindLayer from "@/features/globe/WindLayer";
import ControlPanel from "@/features/trendmap/ControlPanel";
import PointPanel from "@/features/trendmap/PointPanel";
import RegionPanel from "@/features/trendmap/RegionPanel";
import StationLayer from "@/features/globe/StationLayer";
import { elementFor } from "@/features/stations/elements";
import { stationLabel, trendStyle } from "@/features/stations/style";
import StationPanel from "@/features/trendmap/StationPanel";
import { styleFor } from "@/features/trendmap/styles";
import { useStationStore } from "@/store/useStationStore";
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
      onlySignificant: s.onlySignificant,
      showStations: s.showStations,
      stationId: s.stationId,
      station: s.station,
      stationLoading: s.stationLoading,
      stationError: s.stationError,
      selectStation: s.selectStation,
      clearStation: s.clearStation,
    })),
  );
  const element = elementFor(s.variable);
  const stations = useStationStore((st) => (element ? st.lists[element] : undefined));
  const stationStyle = useMemo(
    () => (stations && s.meta ? trendStyle(stations, styleFor(s.variable).change, s.meta.trend_scale, s.onlySignificant) : null),
    [stations, s.meta, s.variable, s.onlySignificant],
  );
  const stationIndex = stations && s.stationId ? stations.ids.indexOf(s.stationId) : -1;
  const showStations = s.showStations && !!stations && !!stationStyle;

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
        autoRotate={!s.picked && !s.regionTarget && !s.stationId}
        hint="Click to inspect a grid cell, shift-drag for a box, right-click to clear"
        touchHint="Tap a cell to inspect it, pinch to zoom"
        detail={!s.showTrend}
        onPick={(lat, lon, city) => {
          // one selection at a time: a new point replaces the open area
          void s.setRegion(null);
          void s.selectPoint(lat, lon, city);
        }}
        // clears the picked cell first, then the region
        onClear={() => (s.picked || s.stationId ? s.clearSelection() : void s.setRegion(null))}
        onBox={(box) => {
          s.clearSelection();
          void s.setRegion({ kind: "box", box });
        }}
        areaMode={s.meta?.domain === "ocean" ? "sea" : "country"}
        onCountry={(lat, lon) =>
          void (s.meta?.domain === "ocean" ? seaAt(lat, lon) : countryAt(lat, lon)).then((boundary) => {
            if (!boundary) return;
            // one selection at a time: a new area replaces the open point
            s.clearSelection();
            void s.setRegion({ kind: "boundary", boundary });
          })
        }
        rightInset={s.region || s.selected || s.station ? 396 : 0}
        loading={s.showTrend && (s.loading || !layer) && !s.error ? `Loading ${name.toLowerCase()}` : null}
      >
        {layer && texture && <FieldLayer earth={texture} domain={s.meta?.domain} transition={1.1} visible={s.showTrend} opacity={s.opacity} {...layer} />}
        {style.wind && s.wind && (
          <WindLayer u={s.wind.u} v={s.wind.v} nlat={s.wind.n_lat} nlon={s.wind.n_lon} grid={s.wind} visible={s.showTrend} />
        )}
        <ExtremaLabels points={highsLows} visible={s.showTrend} />
        {stations && stationStyle && (
          <StationLayer
            lat={stations.lat}
            lon={stations.lon}
            colors={stationStyle.colors}
            kinds={stationStyle.kinds}
            selected={stationIndex >= 0 ? stationIndex : null}
            visible={showStations}
            label={(k) => stationLabel(stations, k)}
            onPick={(k) => {
              void s.setRegion(null);
              void s.selectStation(stations.ids[k]);
            }}
          />
        )}
        {s.showTrend && edges && (
          <>
            <Outline rings={edges.first} color={0xfd8d3c} width={1.5} dashed />
            <Outline rings={edges.shown} color={0xf4fbff} width={1.8} />
          </>
        )}
      </GlobeCanvas>
      <ControlPanel />
      <AnimatePresence>
        {s.region && <RegionPanel key="region" region={s.region} shifted={s.selected !== null || s.station !== null} />}
        {s.selected && <PointPanel key="point" point={s.selected} loading={s.pointLoading} />}
        {s.station && <StationPanel key="station" station={s.station} loading={s.stationLoading} />}
      </AnimatePresence>
      {/* phones show one bottom sheet at a time: the timeline gives way to a point or region panel */}
      {s.showTrend && !((s.selected || s.station || s.region) && window.matchMedia("(max-width: 639px)").matches) && <TimelineBar />}
      {s.pointLoading && !s.selected && (
        <div className="absolute bottom-3 right-4 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <LoaderCircle className="size-3 animate-spin" /> loading cell
        </div>
      )}
      {s.stationLoading && !s.station && (
        <div className="absolute bottom-3 right-4 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <LoaderCircle className="size-3 animate-spin" /> loading station
        </div>
      )}
      {s.stationError && !s.stationLoading && (
        <div className="absolute bottom-3 right-4 font-mono text-[11px] text-warning">{s.stationError}</div>
      )}
      {s.pointError && !s.pointLoading && (
        <div className="absolute bottom-3 right-4 font-mono text-[11px] text-warning">{s.pointError}</div>
      )}
    </div>
  );
}

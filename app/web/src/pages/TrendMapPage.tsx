// global trend map page

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import ExtremaLabels from "@/features/globe/ExtremaLabels";
import FieldLayer from "@/features/globe/FieldLayer";
import GlobeCanvas from "@/features/globe/GlobeCanvas";
import { areaAt } from "@/features/globe/areaAt";
import Outline from "@/features/globe/Outline";
import { useEarthTexture } from "@/features/globe/useEarthTexture";
import { useOutline } from "@/features/globe/useOutline";
import FlowLayer from "@/features/globe/FlowLayer";
import ControlPanel from "@/features/trendmap/ControlPanel";
import PointPanel from "@/features/trendmap/PointPanel";
import RegionPanel from "@/features/trendmap/RegionPanel";
import StationLayer from "@/features/globe/StationLayer";
import { elementFor } from "@/features/stations/elements";
import { stationLabel, trendStyle } from "@/features/stations/style";
import StationPanel from "@/features/trendmap/StationPanel";
import Co2Panel from "@/features/trendmap/Co2Panel";
import { useCo2Store } from "@/store/useCo2Store";
import { styleFor } from "@/features/trendmap/styles";
import { useStationStore } from "@/store/useStationStore";
import TimelineBar from "@/features/trendmap/TimelineBar";
import { useTrendLayer } from "@/features/trendmap/useTrendLayer";
import { WAKING_MESSAGE, useServerStatus } from "@/api/status";
import { Panel } from "@/components/ui/panel";
import { NARROW, ROOMY, useMedia } from "@/lib/useMedia";
import { cn } from "@/lib/utils";
import { targetArea, targetLabel, useTrendMapStore } from "@/store/useTrendMapStore";

export default function TrendMapPage() {
  const s = useTrendMapStore(
    useShallow((s) => ({
      meta: s.meta,
      variable: s.variable,
      variables: s.variables,
      flow: s.flow,
      loading: s.loading,
      region: s.region,
      regionError: s.regionError,
      regionLoading: s.regionLoading,
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
  const extras = s.showTrend;
  const narrow = useMedia(NARROW);
  const waking = useServerStatus((st) => st.waking);
  const notes: readonly (readonly ["busy" | "warn", string])[] = [
    ...(s.pointLoading && !s.selected ? [["busy", "loading cell"] as const] : []),
    ...(s.stationLoading && !s.station ? [["busy", "loading station"] as const] : []),
    ...(s.regionLoading && !s.region && s.regionTarget ? [["busy", `loading ${targetLabel(s.regionTarget)}`] as const] : []),
    ...(s.pointError && !s.pointLoading ? [["warn", s.pointError] as const] : []),
    ...(s.stationError && !s.stationLoading ? [["warn", s.stationError] as const] : []),
    ...(s.regionError && !s.regionLoading ? [["warn", s.regionError] as const] : []),
  ];
  const co2Open = useCo2Store((st) => st.open);
  const stacked = !!(s.region || s.selected || s.station) || co2Open || notes.length > 0;
  const sheet = useRef<HTMLDivElement>(null);
  const [sheetHeight, setSheetHeight] = useState(0);
  useEffect(() => {
    const el = sheet.current;
    if (!el || !narrow) return setSheetHeight(0);
    const observer = new ResizeObserver(() => setSheetHeight(el.getBoundingClientRect().height));
    observer.observe(el);
    return () => observer.disconnect();
  }, [narrow, stacked]);
  // the globe never moves when a panel opens: wide screens keep the column's space free all the time, narrower
  // ones let the panel cover the globe's edge; the controls still keep clear of an open panel
  const roomy = useMedia(ROOMY);
  const rightInset = !narrow && (roomy || stacked) ? 396 : 0;
  const globeInset = !narrow && roomy ? 396 : 0;
  const viewShift = useMemo(
    () => (narrow ? { x: 0, y: stacked ? sheetHeight / 2 : 0 } : { x: (globeInset - 332) / 2, y: 0 }),
    [narrow, stacked, sheetHeight, globeInset],
  );

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
          void s.setRegion(null);
          void s.selectPoint(lat, lon, city);
        }}
        onClear={() => (s.picked || s.stationId ? s.clearSelection() : void s.setRegion(null))}
        onBox={(box) => {
          s.clearSelection();
          void s.setRegion({ kind: "box", box });
        }}
        multiSelect
        onCountry={(lat, lon, zoomed, multi) =>
          void areaAt(lat, lon, { zoomed, ocean: s.meta?.domain === "ocean" }).then((boundary) => {
            if (!boundary) return;
            s.clearSelection();
            if (!multi) return void s.setRegion({ kind: "boundary", boundary });
            // "Several": a click adds the region to the selection, or takes it out again
            const t = s.regionTarget;
            const now = t?.kind === "boundaries" ? t.boundaries : t?.kind === "boundary" ? [t.boundary] : [];
            const next = now.some((b) => b.id === boundary.id) ? now.filter((b) => b.id !== boundary.id) : [...now, boundary];
            void s.setRegion(next.length === 0 ? null : next.length === 1 ? { kind: "boundary", boundary: next[0] } : { kind: "boundaries", boundaries: next });
          })
        }
        hoverArea={(lat, lon, zoomed) => areaAt(lat, lon, { zoomed, ocean: s.meta?.domain === "ocean" })}
        rightInset={rightInset}
        leftInset={332}
        viewShift={viewShift}
        loading={waking ? WAKING_MESSAGE : s.showTrend && (s.loading || !layer) && !s.error ? `Loading ${name.toLowerCase()}` : null}
      >
        {layer && texture && <FieldLayer earth={texture} domain={s.meta?.domain} transition={1.1} visible={s.showTrend} opacity={s.opacity} {...layer} />}
        {style.flow && s.flow?.field === style.flow && (
          <FlowLayer key={s.flow.field} field={s.flow.field} u={s.flow.u} v={s.flow.v} nlat={s.flow.n_lat} nlon={s.flow.n_lon} grid={s.flow} visible={extras} />
        )}
        <ExtremaLabels points={highsLows} visible={extras} />
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
        {extras && edges && (
          <>
            <Outline rings={edges.first} color={0xfd8d3c} width={1.5} dashed />
            <Outline rings={edges.shown} color={0xf4fbff} width={1.8} />
          </>
        )}
      </GlobeCanvas>
      <ControlPanel />
      {stacked && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex max-h-[62%] flex-col justify-end lg:inset-x-auto lg:bottom-4 lg:right-4 lg:top-4 lg:max-h-none lg:w-[380px] lg:justify-start">
          <div ref={sheet} data-tour="panel" className="scrollbar-thin pointer-events-auto flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain rounded-lg">
            <AnimatePresence initial={false}>
              {s.selected && <PointPanel key="point" point={s.selected} loading={s.pointLoading} />}
              {s.station && <StationPanel key="station" station={s.station} loading={s.stationLoading} />}
              {co2Open && <Co2Panel key="co2" />}
              {s.region && <RegionPanel key="region" region={s.region} />}
            </AnimatePresence>
            {notes.map(([tone, text]) => (
              <Panel
                key={text}
                className={cn(
                  "flex items-start gap-2.5 px-4 py-3",
                  tone === "warn" ? "border-warning/40 text-sm leading-snug" : "items-center font-mono text-[11px] text-muted-foreground",
                )}
              >
                {tone === "busy" ? <LoaderCircle className="size-3 animate-spin" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />}
                <span>{text}</span>
              </Panel>
            ))}
          </div>
        </div>
      )}
      {s.showTrend && !(narrow && stacked) && <TimelineBar rightInset={rightInset} />}
    </div>
  );
}

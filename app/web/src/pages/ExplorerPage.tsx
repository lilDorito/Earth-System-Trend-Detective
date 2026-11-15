// explorer page: globe and sidebar

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import Results from "@/features/explorer/Results";
import Wizard from "@/features/explorer/Wizard";
import GlobeCanvas from "@/features/globe/GlobeCanvas";
import { countryAt } from "@/features/globe/countryAt";
import StationLayer from "@/features/globe/StationLayer";
import StationToggle from "@/features/stations/StationToggle";
import { plainStyle, stationLabel } from "@/features/stations/style";
import { useEarthTexture } from "@/features/globe/useEarthTexture";
import { useOutline, type Area } from "@/features/globe/useOutline";
import { useAppStore } from "@/store/useAppStore";
import { useStationStore } from "@/store/useStationStore";

const round = (v: number) => Math.round(v * 1000) / 1000;

export default function ExplorerPage() {
  const { location, boundary, focus, setLocation, setBox, pickBoundary, clearLocation } = useAppStore(
    useShallow((s) => ({
      location: s.location,
      boundary: s.boundary,
      focus: s.focus,
      setLocation: s.setLocation,
      setBox: s.setBox,
      pickBoundary: s.pickBoundary,
      clearLocation: s.clearLocation,
    })),
  );
  const texture = useEarthTexture();
  const area = useMemo<Area | null>(() => {
    if (location?.type === "bbox") return { kind: "box", box: location };
    if (location?.type === "region" && boundary) return { kind: "region", boundary };
    return null;
  }, [location, boundary]);
  const outline = useOutline(area);
  const stationsOn = useStationStore((s) => s.explorerOn);
  const stations = useStationStore((s) => s.lists[s.explorerElement]);
  const stationStyle = useMemo(() => (stations ? plainStyle(stations) : null), [stations]);
  const stationIndex = useMemo(() => {
    if (!stations || location?.type !== "point") return null;
    const k = stations.ids.findIndex((_, i) => stations.lat[i] === location.lat && stations.lon[i] === location.lon);
    return k >= 0 ? k : null;
  }, [stations, location]);

  return (
    <div className="scrollbar-thin h-full overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_420px] lg:overflow-hidden">
      <section className="relative h-[45vh] min-h-80 lg:h-full">
        <GlobeCanvas
          texture={texture}
          marker={location?.type === "point" ? location : null}
          outline={outline}
          focus={focus}
          autoRotate={!location}
          hint="Click to pick a place, shift-drag for a box, right-click to clear"
          touchHint="Tap to pick a place, pinch to zoom"
          onPick={(lat, lon, name) => setLocation({ type: "point", lat: round(lat), lon: round(lon) }, name ?? null)}
          onClear={clearLocation}
          onBox={setBox}
          onCountry={(lat, lon) => void countryAt(lat, lon).then((b) => b && pickBoundary(b))}
        >
          {stations && stationStyle && (
            <StationLayer
              lat={stations.lat}
              lon={stations.lon}
              colors={stationStyle.colors}
              kinds={stationStyle.kinds}
              selected={stationIndex}
              visible={stationsOn}
              label={(k) => stationLabel(stations, k)}
              onPick={(k) => setLocation({ type: "point", lat: stations.lat[k], lon: stations.lon[k] }, stations.names[k])}
            />
          )}
        </GlobeCanvas>
        <StationToggle />
      </section>

      <aside className="scrollbar-thin border-t bg-card lg:overflow-y-auto lg:border-l lg:border-t-0">
        <Wizard />
        <Results />
      </aside>
    </div>
  );
}

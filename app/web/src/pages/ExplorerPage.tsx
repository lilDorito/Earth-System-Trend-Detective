// explorer page: globe and sidebar

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import Results from "@/features/explorer/Results";
import Wizard from "@/features/explorer/Wizard";
import GlobeCanvas from "@/features/globe/GlobeCanvas";
import { useEarthTexture } from "@/features/globe/useEarthTexture";
import { useOutline, type Area } from "@/features/globe/useOutline";
import { useAppStore } from "@/store/useAppStore";

const round = (v: number) => Math.round(v * 1000) / 1000;

export default function ExplorerPage() {
  const { location, boundary, focus, setLocation, setBox, clearLocation } = useAppStore(
    useShallow((s) => ({
      location: s.location,
      boundary: s.boundary,
      focus: s.focus,
      setLocation: s.setLocation,
      setBox: s.setBox,
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
          onPick={(lat, lon, name) => setLocation({ type: "point", lat: round(lat), lon: round(lon) }, name ?? null)}
          onClear={clearLocation}
          onBox={setBox}
        />
      </section>

      <aside className="scrollbar-thin border-t bg-card lg:overflow-y-auto lg:border-l lg:border-t-0">
        <Wizard />
        <Results />
      </aside>
    </div>
  );
}

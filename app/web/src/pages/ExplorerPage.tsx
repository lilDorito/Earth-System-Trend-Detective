// explorer page: globe and sidebar

import { useShallow } from "zustand/react/shallow";
import Results from "@/features/explorer/Results";
import Wizard from "@/features/explorer/Wizard";
import GlobeCanvas from "@/features/globe/GlobeCanvas";
import { useEarthTexture } from "@/features/globe/useEarthTexture";
import { locationCenter } from "@/lib/format";
import { useAppStore } from "@/store/useAppStore";

const round = (v: number) => Math.round(v * 1000) / 1000;

export default function ExplorerPage() {
  const { location, focus, setLocation, clearLocation } = useAppStore(
    useShallow((s) => ({ location: s.location, focus: s.focus, setLocation: s.setLocation, clearLocation: s.clearLocation })),
  );
  const texture = useEarthTexture();

  return (
    <div className="scrollbar-thin h-full overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_420px] lg:overflow-hidden">
      <section className="relative h-[45vh] min-h-80 lg:h-full">
        <GlobeCanvas
          texture={texture}
          marker={location && locationCenter(location)}
          focus={focus}
          autoRotate={!location}
          hint="Drag to rotate, click to pick a place, right-click to clear"
          onPick={(lat, lon, name) => setLocation({ type: "point", lat: round(lat), lon: round(lon) }, name ?? null)}
          onClear={clearLocation}
        />
      </section>

      <aside className="scrollbar-thin border-t bg-card lg:overflow-y-auto lg:border-l lg:border-t-0">
        <Wizard />
        <Results />
      </aside>
    </div>
  );
}

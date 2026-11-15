// on-globe switch for weather station points and the measurement they show

import { LoaderCircle } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { useStationStore } from "@/store/useStationStore";
import { ELEMENT_KEYS, STATION_ELEMENTS } from "./elements";

const OPTIONS = ELEMENT_KEYS.map((key) => ({ value: key, label: STATION_ELEMENTS[key].short }));

export default function StationToggle() {
  const s = useStationStore(
    useShallow((s) => ({
      on: s.explorerOn,
      element: s.explorerElement,
      setOn: s.setExplorerOn,
      setElement: s.setExplorerElement,
      loading: !!s.loading[s.explorerElement],
      error: s.errors[s.explorerElement],
      count: s.lists[s.explorerElement]?.ids.length,
    })),
  );

  return (
    <div className="absolute left-3 top-3 z-10 space-y-1 sm:left-4 sm:top-4">
      <div className="flex items-center gap-2 rounded-md border bg-card/85 px-2.5 py-1.5 shadow-lg shadow-black/30 backdrop-blur">
        <label className="flex cursor-pointer items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <Switch checked={s.on} onCheckedChange={s.setOn} aria-label="Weather stations" />
          Stations
        </label>
        {s.on && <Segmented size="sm" value={s.element} options={OPTIONS} onChange={s.setElement} />}
        {s.on && s.loading && <LoaderCircle className="size-3 animate-spin text-muted-foreground" />}
        {s.on && !s.loading && s.count !== undefined && (
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{s.count}</span>
        )}
      </div>
      {s.on && s.error && <p className="max-w-64 font-mono text-[10px] text-warning">{s.error}</p>}
    </div>
  );
}

// control panel sections for finding things: process fingerprints, opposite trends

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { api, usingMockData } from "@/api";
import type { Scenario } from "@/api/types";
import { Label } from "@/components/ui/label";
import { PanelSection } from "@/components/ui/panel";
import { formatLatLon, formatSigned } from "@/lib/format";
import { plainName } from "@/lib/summary";
import { cn } from "@/lib/utils";
import { useTrendMapStore } from "@/store/useTrendMapStore";

const chip =
  "h-7 pointer-coarse:h-9 cursor-pointer rounded-sm border border-input px-2 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function Fingerprints() {
  const s = useTrendMapStore(useShallow((s) => ({ hotspot: s.hotspot, loading: s.hotspotLoading, setHotspot: s.setHotspot })));
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  useEffect(() => {
    void api.insightScenarios().then(setScenarios, () => setScenarios([]));
  }, []);
  if (usingMockData || !scenarios.length) return null;
  const active = scenarios.find((c) => c.id === (s.hotspot?.id ?? s.loading));
  return (
    <PanelSection className="space-y-2">
      <Label>Process fingerprints</Label>
      <div className="flex flex-wrap gap-1.5">
        {scenarios.map((c) => {
          const on = c.id === s.hotspot?.id || c.id === s.loading;
          return (
            <button key={c.id} type="button" aria-pressed={on} onClick={() => void s.setHotspot(on ? null : c.id)} className={cn(chip, on && "bg-accent text-foreground")}>
              {s.loading === c.id && <LoaderCircle className="mr-1 inline size-3 animate-spin" />}
              {c.name}
            </button>
          );
        })}
      </div>
      {active && (
        <div className="space-y-1.5 text-xs text-muted-foreground">
          <p>{active.story}</p>
          <ul className="font-mono text-[10px]">
            {active.variables.map((v) => (
              <li key={v.key}>
                {v.sign > 0 ? "▲" : "▼"} {plainName(v.name)}
              </li>
            ))}
          </ul>
          {s.hotspot && (
            <p>
              Colour: share of these with a significant trend in that direction. White line: all of them, over{" "}
              {(s.hotspot.full_area_km2 / 1e6).toFixed(2)} million km²
              {s.hotspot.full_with_jump_km2 > 0.1 * s.hotspot.full_area_km2 &&
                ` (a jump rather than a trend in ${Math.round((100 * s.hotspot.full_with_jump_km2) / s.hotspot.full_area_km2)}% of it)`}
              .
            </p>
          )}
        </div>
      )}
    </PanelSection>
  );
}

export function OppositeTrends() {
  const s = useTrendMapStore(
    useShallow((s) => ({ divergence: s.divergence, area: s.divergenceArea, find: s.findDivergence, showArea: s.showArea, units: s.meta?.units ?? "", hotspot: s.hotspot })),
  );
  const [busy, setBusy] = useState(false);
  if (usingMockData || s.hotspot) return null;
  const rising = s.divergence?.areas.filter((a) => a.sign > 0) ?? [];
  const falling = s.divergence?.areas.filter((a) => a.sign < 0) ?? [];
  const list = (areas: typeof rising, title: string) => (
    <div className="min-w-0">
      <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">{title}</p>
      {areas.length === 0 && <p className="text-xs text-muted-foreground">none large</p>}
      <ul className="space-y-0.5">
        {areas.slice(0, 4).map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => s.showArea(s.area === a.id ? null : a.id)}
              className={cn("w-full cursor-pointer rounded-sm px-1 py-0.5 text-left transition-colors hover:bg-accent", s.area === a.id && "bg-accent")}
              title={formatLatLon(a.lat, a.lon)}
            >
              <span className="block font-mono text-[11px] tabular-nums">
                {formatSigned(a.slope_decade)} {s.units}
              </span>
              <span className="block text-[10px] text-muted-foreground">{(a.area_km2 / 1e6).toFixed(2)} M km² near {formatLatLon(a.lat, a.lon)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <PanelSection className="space-y-2">
      <Label>Opposite trends</Label>
      {s.divergence ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            {list(rising, "Rising")}
            {list(falling, "Falling")}
          </div>
          <p className="text-[11px] text-muted-foreground">Largest connected areas with a significant trend (FDR 5%), per decade. Click to outline.</p>
        </>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void s.find().finally(() => setBusy(false));
          }}
          className={cn(chip, "w-full")}
        >
          {busy && <LoaderCircle className="mr-1 inline size-3 animate-spin" />}
          Find where it rises and where it falls
        </button>
      )}
    </PanelSection>
  );
}

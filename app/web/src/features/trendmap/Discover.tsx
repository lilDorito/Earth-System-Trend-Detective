// control panel sections for finding things: ask in plain words, process fingerprints, opposite trends

import { useEffect, useState } from "react";
import { ArrowRight, LoaderCircle, Sparkles } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { api, usingMockData } from "@/api";
import type { Scenario } from "@/api/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PanelSection } from "@/components/ui/panel";
import { boundaryLabel, fitDistance, loadBoundaries } from "@/features/globe/boundaries";
import { formatLatLon, formatSigned } from "@/lib/format";
import { plainName } from "@/lib/summary";
import { cn } from "@/lib/utils";
import { useTrendMapStore } from "@/store/useTrendMapStore";
import { readQuestion } from "./places";

const chip =
  "h-7 pointer-coarse:h-9 cursor-pointer rounded-sm border border-input px-2 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const EXAMPLES = ["droughts in America", "sea ice in the Arctic", "fires in Australia", "rain in India"];

export function AskBox() {
  const s = useTrendMapStore(
    useShallow((s) => ({ variables: s.variables, setVariable: s.setVariable, setRegion: s.setRegion, focusOn: s.focusOn, setShowTrend: s.setShowTrend, setHotspot: s.setHotspot })),
  );
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);

  const ask = async (question: string) => {
    if (!question.trim()) return;
    const { variable, place, unknownPlace } = readQuestion(question, s.variables, await loadBoundaries().catch(() => []));
    // a place that matched nothing is reported instead of guessed at
    if (unknownPlace && !place) {
      setAnswer(`No country or region called "${unknownPlace}". Try a country, a continent or an area such as the Sahel or the Arctic.`);
      return;
    }
    if (!variable && !place) {
      setAnswer("Did not catch a topic or a place. Try a word like rain, drought, ice, fire or warming, and a country or continent.");
      return;
    }
    const name = variable ? plainName(s.variables.find((v) => v.key === variable)?.name ?? variable) : null;
    void s.setHotspot(null);
    s.setShowTrend(true);
    if (variable) await s.setVariable(variable);
    if (place?.kind === "boundary") void s.setRegion({ kind: "boundary", boundary: place.boundary });
    if (place?.kind === "box") {
      void s.setRegion({ kind: "box", box: place.named.box, name: place.named.name });
      const b = place.named.box;
      const width = (b.east - b.west + 360) % 360 || 360;
      s.focusOn((b.south + b.north) / 2, ((b.west + width / 2 + 540) % 360) - 180, fitDistance(b));
    }
    const where = place ? (place.kind === "box" ? place.named.name : boundaryLabel(place.boundary)) : null;
    setAnswer(`Showing ${name ?? "the current variable"}${where ? ` in ${where}` : ""}.`);
  };

  return (
    <PanelSection className="space-y-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(text);
        }}
        className="relative"
      >
        <Sparkles className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask: drought in Africa"
          aria-label="Ask in plain words"
          className="pl-8 pr-8 font-sans text-sm"
        />
        <button type="submit" aria-label="Ask" className="absolute right-1.5 top-1/2 -translate-y-1/2 cursor-pointer p-1 text-muted-foreground hover:text-foreground">
          <ArrowRight className="size-3.5" />
        </button>
      </form>
      {answer ? (
        <p className="text-xs text-muted-foreground">{answer}</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {EXAMPLES.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => {
                setText(q);
                void ask(q);
              }}
              className="cursor-pointer rounded-sm px-1 font-mono text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </PanelSection>
  );
}

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

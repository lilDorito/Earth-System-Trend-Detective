// trend map layer controls and global mean

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import type { Co2Series, TrendVariable } from "@/api/types";
import { api, usingMockData } from "@/api";
import { NARROW } from "@/lib/useMedia";
import { useServerStatus } from "@/api/status";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { Panel, PanelSection } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Status } from "@/components/ui/status";
import { Switch } from "@/components/ui/switch";
import { digitsFor, formatSigned } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useTrendMapStore, type Display } from "@/store/useTrendMapStore";
import { useStationStore } from "@/store/useStationStore";
import { STATION_ELEMENTS, elementFor } from "@/features/stations/elements";
import { DESCRIPTIONS } from "./descriptions";
import { Fingerprints, OppositeTrends } from "./Discover";
import { FINGERPRINT, bandGradient, styleFor, valueRange } from "./styles";
import TrendChart from "./TrendChart";

const isPhone = () => window.matchMedia("(max-width: 639px)").matches;
const ticks = (lo: number, hi: number) => [0, 0.25, 0.5, 0.75, 1].map((f) => lo + (hi - lo) * f);
const DISPLAYS: { value: Display; label: string }[] = [
  { value: "trend", label: "Change" },
  { value: "values", label: "Values" },
];

// colour bar for what is on the globe, with notes for the variables drawn in their own way
// atmospheric CO2 beside the ocean carbon variables it drives
const CO2_CONTEXT = new Set(["pco2", "ph"]);

function Co2Context() {
  const [co2, setCo2] = useState<Co2Series | null>(null);
  useEffect(() => {
    void api.trendCo2().then(setCo2, () => setCo2(null));
  }, []);
  if (!co2) return null;
  const first = co2.ppm.find((v) => v != null);
  const last = [...co2.ppm].reverse().find((v) => v != null);
  return (
    <PanelSection className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <Label>Atmospheric CO₂</Label>
        <span className="font-mono text-[13px] tabular-nums">
          {formatSigned(co2.slope_decade, 1)} <span className="text-muted-foreground">ppm/dec</span>
        </span>
      </div>
      <TrendChart years={co2.years} values={co2.ppm} units="ppm" height={80} compact />
      <p className="text-[11px] leading-snug text-muted-foreground">
        {first?.toFixed(0)} to {last?.toFixed(0)} ppm ({co2.source}, NOAA GML). The ocean takes up part of it, which raises
        its pCO₂ and lowers its pH.
      </p>
    </PanelSection>
  );
}

function Legend() {
  const s = useTrendMapStore(
    useShallow((s) => ({ meta: s.meta, display: s.display, view: s.view, frames: s.frames, valueFrames: s.valueFrames, wind: s.wind, hotspot: s.hotspot })),
  );
  if (s.hotspot) {
    return (
      <PanelSection className="space-y-2">
        <Label>{s.hotspot.name}: variables matching</Label>
        <div className="h-1.5" style={{ background: bandGradient(FINGERPRINT) }} />
        <div className="flex justify-between font-mono text-[10px] tabular-nums text-muted-foreground">
          <span>none</span>
          <span>all {s.hotspot.n_vars}</span>
        </div>
      </PanelSection>
    );
  }
  if (!s.meta) return null;
  const style = styleFor(s.meta.key);
  const units = s.meta.units;
  const values = s.display === "values";
  let lo: number, hi: number, label: string;
  if (values) {
    [lo, hi] = valueRange(style, s.meta.value_range);
    label = style.log ? `${units}, log scale` : units;
  } else {
    hi = s.view === "years" ? s.meta.anomaly_scale : s.meta.trend_scale;
    lo = -hi;
    label = s.view === "years" && s.frames ? `${units} vs ${s.frames.baseline[0]}-${s.frames.baseline[1]}` : `${units} per decade`;
  }
  // change ticks show the scale exactly; value ticks round to the size of a step (9, 20, 30 ... not 19.705)
  const step = (hi - lo) / 4;
  const digits = values && !style.signed ? Math.max(0, Math.min(4, 1 - Math.floor(Math.log10(step || 1)))) : digitsFor(step);
  const format = (t: number) => {
    if (values && style.log) return String(+(10 ** t).toPrecision(2));
    if (!values || style.signed) return Math.abs(t) < 1e-9 ? "0" : formatSigned(t, digits);
    return t.toFixed(digits);
  };
  const stops = values && !style.signed ? style.values : style.change;

  return (
    <PanelSection className="space-y-2">
      <Label>{label}</Label>
      <div className="h-1.5" style={{ background: bandGradient(stops) }} />
      <div className="flex justify-between font-mono text-[10px] tabular-nums text-muted-foreground">
        {ticks(lo, hi).map((t, i) => (
          <span key={i}>{format(t)}</span>
        ))}
      </div>
      {values && style.edge != null && s.valueFrames && (
        <div className="space-y-0.5 font-mono text-[10px] text-muted-foreground">
          <p className="flex items-center gap-2">
            <span className="w-4 border-t-2 border-dashed border-[#fd8d3c]" /> {style.edge}% edge, {s.valueFrames.years[0]}
          </p>
          <p className="flex items-center gap-2">
            <span className="w-4 border-t-2 border-[#f4fbff]" /> {style.edge}% edge, year shown
          </p>
        </div>
      )}
      {style.isobars && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          {values
            ? "Lines of equal pressure. Surface pressure follows the terrain, so lows here mark mountains, not storms."
            : "Lines of equal change; H and L mark where pressure rose or fell most."}
        </p>
      )}
      {style.wind && s.wind && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          Streaks drift with the mean 10 m wind, {s.wind.start}-{s.wind.end}.
        </p>
      )}
      {!values && s.view === "trend" && (
        <p className="text-[11px] leading-snug text-muted-foreground">Colour fades where the change is near zero.</p>
      )}
    </PanelSection>
  );
}
// station toggle with what the points show; points are fetched only once switched on
function Stations() {
  const { variable, show, setShow, onlySignificant } = useTrendMapStore(
    useShallow((s) => ({ variable: s.variable, show: s.showStations, setShow: s.setShowStations, onlySignificant: s.onlySignificant })),
  );
  const element = elementFor(variable);
  const { list, loading, error } = useStationStore(
    useShallow((s) => ({
      list: element ? s.lists[element] : undefined,
      loading: element ? !!s.loading[element] : false,
      error: element ? s.errors[element] : null,
    })),
  );
  const withTrend = list ? list.slope.filter((v) => v !== null).length : 0;
  let note: string;
  if (!element) note = "No station measurement matches this variable.";
  else if (!show) note = `NCEI monthly ${STATION_ELEMENTS[element].name.toLowerCase()}, compared with the grid.`;
  else if (loading) note = "Loading stations";
  else if (error) note = error;
  else if (list) note = `${list.ids.length} stations, ${withTrend} with ${list.min_years}+ years of data.`;
  else note = "";

  return (
    <PanelSection className="space-y-2">
      <Toggle label="Weather stations" checked={show && !!element} disabled={!element} onChange={setShow} />
      <p className={cn("text-[11px] leading-snug", error && show ? "text-warning" : "text-muted-foreground")}>{note}</p>
      {show && list && (
        <div className="space-y-1 font-mono text-[10px] text-muted-foreground">
          <p className="flex items-center gap-2">
            <span className="size-2 rounded-full border-[1.5px] border-white bg-[#e05a3c]" /> trend, significant at FDR 5%
          </p>
          {!onlySignificant && (
            <>
              <p className="flex items-center gap-2">
                <span className="size-2 rounded-full border border-black bg-[#e05a3c]" /> trend, not significant
              </p>
              <p className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-[#787e88]" /> under {list.min_years} years, no trend
              </p>
            </>
          )}
          <p>Same colour scale as the change map. Click a station to compare it with its grid cell.</p>
        </div>
      )}
    </PanelSection>
  );
}

const GROUPS: [TrendVariable["group"], string][] = [
  ["atmosphere", "Atmosphere"],
  ["land", "Land"],
  ["ocean", "Ocean"],
];

function Toggle({ label, checked, disabled, onChange }: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className={cn("flex cursor-pointer items-center justify-between gap-3 text-sm", disabled && "cursor-default opacity-40")}>
      {label}
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </label>
  );
}

export default function ControlPanel() {
  const s = useTrendMapStore(
    useShallow((s) => ({
      meta: s.meta,
      variables: s.variables,
      variable: s.variable,
      setVariable: s.setVariable,
      globalMean: s.globalMean,
      loading: s.loading,
      error: s.error,
      showTrend: s.showTrend,
      display: s.display,
      setDisplay: s.setDisplay,
      stipple: s.stipple,
      setStipple: s.setStipple,
      opacity: s.opacity,
      setOpacity: s.setOpacity,
      onlySignificant: s.onlySignificant,
      view: s.view,
      regionError: s.regionError,
      // changes with every new selection, so each one folds the panel away on narrow screens
      selection: `${s.selected?.lat},${s.selected?.lon}|${s.station?.id ?? ""}|${s.region?.label ?? ""}`,
      hasSelection: s.selected !== null || s.station !== null || s.region !== null,
      setShowTrend: s.setShowTrend,
      setOnlySignificant: s.setOnlySignificant,
    })),
  );
  const [open, setOpen] = useState(() => !isPhone());
  const waking = useServerStatus((st) => st.waking);
  const change = s.display === "trend";
  const units = s.meta?.units ?? "";

  useEffect(() => {
    // below desktop width the panel and the selection sheet compete for the screen: the selection wins
    if (s.hasSelection && window.matchMedia(NARROW).matches) setOpen(false);
  }, [s.selection, s.hasSelection]);

  return (
    // on phones the open panel sits above the point and region sheets; collapsing it reveals them again
    <Panel
      className={cn(
        "scrollbar-thin absolute inset-x-3 top-3 max-h-[calc(100%-1.5rem)] overflow-y-auto overflow-x-hidden overscroll-contain sm:inset-x-auto sm:left-4 sm:top-4 sm:w-[300px]",
        open && "max-lg:z-30",
      )}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="min-w-0 flex-1 cursor-pointer sm:cursor-auto" onClick={() => isPhone() && setOpen(!open)}>
          <h2 className="text-sm font-semibold">{s.meta?.name ?? "Trend map"}</h2>
          <p className="text-xs text-muted-foreground">
            {s.meta ? `Annual means, ${s.meta.years[0]} to ${s.meta.years[1]}` : waking ? "Waking the server up" : "Loading"}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="-mr-1.5"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={open ? "Collapse panel" : "Expand panel"}
        >
          <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
        </Button>
      </div>

      {open && (
        <>
          {(s.error || s.meta?.demo) && (
            <PanelSection>
              {s.error ? (
                <Alert>
                  Could not load the trend map. {s.error}
                  <button
                    type="button"
                    onClick={() => void s.setVariable(s.variable)}
                    className="mt-2 block cursor-pointer font-mono text-[11px] uppercase tracking-[0.06em] underline-offset-2 hover:underline"
                  >
                    Retry
                  </button>
                </Alert>
              ) : (
                <Status tone="warning">synthetic field</Status>
              )}
            </PanelSection>
          )}


          {s.variables.length > 1 && (
            <PanelSection>
              <Dropdown
                value={s.variable}
                onChange={(key) => void s.setVariable(key)}
                items={GROUPS.flatMap(([group, label]) =>
                  s.variables.filter((v) => v.group === group).map((v) => ({ value: v.key, label: v.name, group: label })),
                )}
                aria-label="Variable"
              />
              {DESCRIPTIONS[s.variable] && <p className="mt-2 text-xs leading-snug text-muted-foreground">{DESCRIPTIONS[s.variable]}</p>}
            </PanelSection>
          )}

          <PanelSection className="space-y-2.5">
            <Toggle label="Trend layer" checked={s.showTrend} onChange={s.setShowTrend} />
            <Segmented
              size="sm"
              className={cn("flex w-full", !s.showTrend && "pointer-events-none opacity-40")}
              value={s.display}
              options={DISPLAYS}
              onChange={(display) => void s.setDisplay(display)}
            />
            <Toggle
              label="Dots on significant (FDR 5%)"
              checked={s.stipple}
              disabled={!s.showTrend || !change || s.view !== "trend"}
              onChange={s.setStipple}
            />
            <Toggle
              label="Significant only"
              checked={s.onlySignificant}
              disabled={!s.showTrend || !change || s.view !== "trend"}
              onChange={s.setOnlySignificant}
            />
            <label className={cn("flex items-center justify-between gap-3 text-sm", !s.showTrend && "opacity-40")}>
              Opacity
              <input
                type="range"
                min={0.2}
                max={1}
                step={0.05}
                value={s.opacity}
                disabled={!s.showTrend}
                onChange={(e) => s.setOpacity(+e.target.value)}
                className="h-1.5 w-32 cursor-pointer accent-primary disabled:cursor-default pointer-coarse:h-6"
              />
            </label>
          </PanelSection>

          {s.showTrend && <Legend />}

          <Stations />
          {!usingMockData && CO2_CONTEXT.has(s.variable) && <Co2Context />}

          <Fingerprints />
          <OppositeTrends />

          {s.regionError && (
            <PanelSection>
              <p className="text-xs text-warning">{s.regionError}</p>
            </PanelSection>
          )}

          <PanelSection>
            {s.loading || !s.globalMean ? (
              <div className="space-y-2">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : (
              <>
                <div className="flex items-baseline justify-between gap-2">
                  <Label>Global mean</Label>
                  <span className="font-mono text-[13px] tabular-nums">
                    {formatSigned(s.globalMean.slope_decade)} <span className="text-muted-foreground">{units}/dec</span>
                  </span>
                </div>
                <TrendChart
                  years={s.globalMean.years}
                  values={s.globalMean.values}
                  fitted={s.globalMean.fitted}
                  units={units}
                  height={100}
                  compact
                />
              </>
            )}
          </PanelSection>
        </>
      )}
    </Panel>
  );
}

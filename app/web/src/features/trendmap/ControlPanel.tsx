// trend map layer controls and global mean

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { REGION_NAMES, shortRegionLabel } from "@/api/regions";
import type { TrendVariable } from "@/api/types";
import RegionSearch from "@/components/RegionSearch";
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
import { bandGradient, styleFor, valueRange } from "./styles";
import TrendChart from "./TrendChart";

const isPhone = () => window.matchMedia("(max-width: 639px)").matches;
const ticks = (lo: number, hi: number) => [0, 0.25, 0.5, 0.75, 1].map((f) => lo + (hi - lo) * f);
const DISPLAYS: { value: Display; label: string }[] = [
  { value: "trend", label: "Change" },
  { value: "values", label: "Values" },
];

// colour bar for what is on the globe, with notes for the variables drawn in their own way
function Legend() {
  const s = useTrendMapStore(
    useShallow((s) => ({ meta: s.meta, display: s.display, view: s.view, frames: s.frames, valueFrames: s.valueFrames, wind: s.wind })),
  );
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
      regionTarget: s.regionTarget,
      regionError: s.regionError,
      setRegion: s.setRegion,
      hasSelection: s.selected !== null,
      setShowTrend: s.setShowTrend,
      setOnlySignificant: s.setOnlySignificant,
    })),
  );
  const [open, setOpen] = useState(() => !isPhone());
  const change = s.display === "trend";
  const units = s.meta?.units ?? "";

  useEffect(() => {
    if (s.hasSelection && isPhone()) setOpen(false);
  }, [s.hasSelection]);

  return (
    // on phones the open panel sits above the point and region sheets; collapsing it reveals them again
    <Panel
      className={cn(
        "scrollbar-thin absolute inset-x-3 top-3 max-h-[calc(100%-1.5rem)] overflow-y-auto overscroll-contain sm:inset-x-auto sm:left-4 sm:top-4 sm:w-[300px]",
        open && "max-sm:z-30",
      )}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="min-w-0 flex-1 cursor-pointer sm:cursor-auto" onClick={() => isPhone() && setOpen(!open)}>
          <h2 className="text-sm font-semibold">{s.meta?.name ?? "Trend map"}</h2>
          <p className="text-xs text-muted-foreground">
            {s.meta ? `Annual means, ${s.meta.years[0]} to ${s.meta.years[1]}` : "Loading"}
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

          <PanelSection>
            <Label className="mb-2">Region analytics</Label>
            <div className="flex flex-wrap gap-1.5">
              {REGION_NAMES.map((name) => {
                const on = s.regionTarget?.kind === "preset" && s.regionTarget.name === name;
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={on}
                    onClick={() => void s.setRegion(on ? null : { kind: "preset", name })}
                    className={cn(
                      "h-6 pointer-coarse:h-9 pointer-coarse:px-3 cursor-pointer rounded-sm border border-input px-2 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      on && "bg-accent text-foreground",
                    )}
                  >
                    {shortRegionLabel(name)}
                  </button>
                );
              })}
            </div>
            <RegionSearch onPick={(boundary) => void s.setRegion({ kind: "boundary", boundary })} className="mt-2" />
            <p className="mt-1.5 text-[11px] text-muted-foreground">or draw one with the Box tool on the globe</p>
            {s.regionError && <p className="mt-2 text-xs text-warning">{s.regionError}</p>}
          </PanelSection>

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

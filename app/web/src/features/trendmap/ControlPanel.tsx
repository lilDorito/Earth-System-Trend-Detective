// trend map layer controls and global mean

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import type { TrendVariable } from "@/api/types";
import { useCo2Store } from "@/store/useCo2Store";
import { NARROW } from "@/lib/useMedia";
import { useServerStatus } from "@/api/status";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { Panel, PanelSection } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { Label } from "@/components/ui/label";
import { InfoTip } from "@/components/ui/info-tip";
import ChartTitle from "@/features/charts/ChartTitle";
import { Skeleton } from "@/components/ui/skeleton";
import { Status } from "@/components/ui/status";
import { Switch } from "@/components/ui/switch";
import { digitsFor, formatSigned } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useTrendMapStore, type Display } from "@/store/useTrendMapStore";
import { useStationStore } from "@/store/useStationStore";
import { STATION_ELEMENTS, elementFor } from "@/features/stations/elements";
import { DESCRIPTIONS } from "./descriptions";
import { bandGradient, styleFor, valueRange } from "./styles";
import TrendChart from "./TrendChart";

const isPhone = () => window.matchMedia("(max-width: 639px)").matches;
const ticks = (lo: number, hi: number) => [0, 0.25, 0.5, 0.75, 1].map((f) => lo + (hi - lo) * f);
const DISPLAYS: { value: Display; label: string }[] = [
  { value: "trend", label: "Change" },
  { value: "values", label: "Values" },
];

const CO2_HEAT = "CO₂ traps heat; its rise is the main driver of the warming trend on the map.";
const CO2_CONTEXT: Record<string, string> = {
  merra2_t2m: CO2_HEAT,
  merra2_ts: CO2_HEAT,
  gldas_tair: CO2_HEAT,
  gldas_skin_temp: CO2_HEAT,
  sst: CO2_HEAT,
  ohc_0_700: "Most of the extra heat that CO₂ traps ends up in the ocean, which is why its heat content keeps climbing.",
  ohc_0_2000: "Most of the extra heat that CO₂ traps ends up in the ocean, which is why its heat content keeps climbing.",
  pco2: "The ocean takes up part of it, which raises its pCO₂.",
  ph: "The ocean takes up part of it, which lowers its pH (ocean acidification).",
  ndvi: "More CO₂ also feeds plant growth, one of the reasons for greening, next to warming and land use.",
};
const CO2_ITEM = "__co2";

// one panel at a time: the CO2 chart replaces whatever point, station or area is open
function openCo2Chart() {
  const map = useTrendMapStore.getState();
  map.clearSelection();
  void map.setRegion(null);
  useCo2Store.getState().setOpen(true);
}

function Co2Context({ note }: { note: string }) {
  const { co2, load } = useCo2Store(useShallow((s) => ({ co2: s.series, load: s.load })));
  useEffect(load, [load]);
  if (!co2) return null;
  const first = co2.ppm.find((v) => v != null);
  const last = [...co2.ppm].reverse().find((v) => v != null);
  return (
    <PanelSection className="space-y-1">
      <ChartTitle
        title="CO₂ in the air"
        tip="Carbon dioxide, the main gas behind global warming, in parts per million (ppm): how many CO₂ molecules there are in every million molecules of air. Measured by NOAA."
      >
        Worldwide yearly average: from {first?.toFixed(0)} to {last?.toFixed(0)} ppm, {formatSigned(co2.slope_decade, 1)} per decade.
      </ChartTitle>
      <TrendChart years={co2.years} values={co2.ppm} units="ppm" height={110} compact />
      <p className="text-[11px] leading-snug text-muted-foreground">{note}</p>
      <button type="button" onClick={openCo2Chart} className="cursor-pointer text-xs text-primary underline-offset-2 hover:underline">
        Open the full CO₂ chart
      </button>
    </PanelSection>
  );
}

function Legend() {
  const s = useTrendMapStore(
    useShallow((s) => ({ meta: s.meta, display: s.display, view: s.view, frames: s.frames, valueFrames: s.valueFrames, flow: s.flow })),
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
    <PanelSection className="space-y-2" data-tour="legend">
      <Label className="flex items-center gap-1.5">
        {label}
        <InfoTip>{values ? "The colour of each place is its yearly average." : "The colour of each place is how fast it changed. Grey middle: almost no change."}</InfoTip>
      </Label>
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
            ? "Lines of equal pressure. Lows here are mountains, not storms."
            : "H and L: where pressure rose or fell most."}
        </p>
      )}
      {style.flow && s.flow?.field === style.flow && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          Streaks drift with the mean {style.flow === "wind" ? "10 m wind" : "surface current"}, {s.flow.start}-{s.flow.end}.
        </p>
      )}
    </PanelSection>
  );
}
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
  if (!element) note = "Not measured by weather stations.";
  else if (!show) note = `Ground stations measuring ${STATION_ELEMENTS[element].name.toLowerCase()}.`;
  else if (loading) note = "Loading stations";
  else if (error) note = error;
  else if (list) note = `${list.ids.length} stations, ${withTrend} with ${list.min_years}+ years of data.`;
  else note = "";

  return (
    <PanelSection className="space-y-2">
      <Toggle
        label="Weather stations"
        tip="Real thermometers and rain gauges on the ground (NOAA). Click a station to compare it with the satellite data."
        checked={show && !!element}
        disabled={!element}
        onChange={setShow}
      />
      <p className={cn("text-[11px] leading-snug", error && show ? "text-warning" : "text-muted-foreground")}>{note}</p>
      {show && list && (
        <div className="space-y-1 font-mono text-[10px] text-muted-foreground">
          <p className="flex items-center gap-2">
            <span className="size-2 rounded-full border-[1.5px] border-white bg-[#e05a3c]" /> white ring: real change
          </p>
          {!onlySignificant && (
            <>
              <p className="flex items-center gap-2">
                <span className="size-2 rounded-full border border-black bg-[#e05a3c]" /> no ring: could be chance
              </p>
              <p className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-[#787e88]" /> grey: too few years
              </p>
            </>
          )}
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

function Toggle({ label, tip, checked, disabled, onChange, tour }: {
  label: string;
  tour?: string;
  tip?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div data-tour={tour} className={cn("flex items-center justify-between gap-3 text-sm", disabled && "opacity-40")}>
      <span className="flex items-center gap-1.5">
        {label}
        {tip && <InfoTip>{tip}</InfoTip>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label} />
    </div>
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
      selection: `${s.selected?.lat},${s.selected?.lon}|${s.station?.id ?? ""}|${s.region?.label ?? ""}`,
      hasSelection: s.selected !== null || s.station !== null || s.region !== null,
      setShowTrend: s.setShowTrend,
      setOnlySignificant: s.setOnlySignificant,
    })),
  );
  const [open, setOpen] = useState(() => !isPhone());
  const co2Open = useCo2Store((st) => st.open);
  const waking = useServerStatus((st) => st.waking);
  const change = s.display === "trend";
  const units = s.meta?.units ?? "";

  useEffect(() => {
    // below desktop width the panel and the selection sheet compete for the screen: the selection wins
    if ((s.hasSelection || co2Open) && window.matchMedia(NARROW).matches) setOpen(false);
  }, [s.selection, s.hasSelection, co2Open]);

  return (
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

          {s.variables.length > 0 && (
            <PanelSection data-tour="variable">
              <Dropdown
                value={s.variable}
                onChange={(key) => (key === CO2_ITEM ? openCo2Chart() : void s.setVariable(key))}
                items={GROUPS.flatMap(([group, label]) => [
                  ...s.variables.filter((v) => v.group === group).map((v) => ({ value: v.key, label: v.name, group: label })),
                  ...(group === "atmosphere" ? [{ value: CO2_ITEM, label: "Atmospheric CO₂ (chart)", group: label }] : []),
                ])}
                aria-label="Variable"
              />
              {DESCRIPTIONS[s.variable] && <p className="mt-2 text-xs leading-snug text-muted-foreground">{DESCRIPTIONS[s.variable]}</p>}
            </PanelSection>
          )}

          <PanelSection className="space-y-2.5">
            <Toggle label="Colour layer" tip="Colours the globe by this measurement. Turn it off to see the plain satellite image." checked={s.showTrend} onChange={s.setShowTrend} />
            <div className={cn("flex items-center gap-2", !s.showTrend && "pointer-events-none opacity-40")}>
              <Segmented size="sm" className="flex flex-1" value={s.display} options={DISPLAYS} onChange={(display) => void s.setDisplay(display)} />
              <InfoTip>Change: how fast it changed since 2000. Values: the actual yearly average.</InfoTip>
            </div>
            <Toggle
              tour="dots"
              label="Dots on real change"
              tip="A dot means the change is too steady to be chance, even after checking every place on Earth at once (FDR 5%)."
              checked={s.stipple}
              disabled={!s.showTrend || !change || s.view !== "trend"}
              onChange={s.setStipple}
            />
            <Toggle
              label="Hide uncertain places"
              tip="Greys out every place where the change could be chance."
              checked={s.onlySignificant}
              disabled={!s.showTrend || !change || s.view !== "trend"}
              onChange={s.setOnlySignificant}
            />
            <label className={cn("flex items-center justify-between gap-3 text-sm", !s.showTrend && "opacity-40")}>
              <span className="flex items-center gap-1.5">
                Strength <InfoTip>How strongly the colours cover the satellite image.</InfoTip>
              </span>
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
          {CO2_CONTEXT[s.variable] && <Co2Context note={CO2_CONTEXT[s.variable]} />}



          <PanelSection>
            {s.loading || !s.globalMean ? (
              <div className="space-y-2">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : (
              <>
                <ChartTitle
                  title="The whole planet"
                  tip="The average over every place on Earth with data, one value per year. The dashed line is its trend. Compare it with the place you click."
                >
                  World average per year ({units}). Dashed line: the trend, {formatSigned(s.globalMean.slope_decade)} per decade.
                </ChartTitle>
                <TrendChart
                  years={s.globalMean.years}
                  values={s.globalMean.values}
                  fitted={s.globalMean.fitted}
                  units={units}
                  height={120}
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

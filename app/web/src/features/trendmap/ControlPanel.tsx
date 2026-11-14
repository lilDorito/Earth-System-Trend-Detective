// trend map layer controls and global mean

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Panel, PanelSection } from "@/components/ui/panel";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Status } from "@/components/ui/status";
import { Switch } from "@/components/ui/switch";
import { formatSigned } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useTrendMapStore } from "@/store/useTrendMapStore";
import TrendChart from "./TrendChart";
import { REGION_NAMES, shortRegionLabel } from "@/api/regions";
import { FRAME_MAX, MAX_TREND, TREND_GRADIENT } from "./trendLayer";

const isPhone = () => window.matchMedia("(max-width: 639px)").matches;
const scale = (max: number) => [-max, -max / 2, 0, max / 2, max];

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
      globalMean: s.globalMean,
      loading: s.loading,
      error: s.error,
      showTrend: s.showTrend,
      onlySignificant: s.onlySignificant,
      view: s.view,
      frames: s.frames,
      regionName: s.regionName,
      setRegion: s.setRegion,
      hasSelection: s.selected !== null,
      setShowTrend: s.setShowTrend,
      setOnlySignificant: s.setOnlySignificant,
    })),
  );
  const [open, setOpen] = useState(() => !isPhone());

  useEffect(() => {
    if (s.hasSelection && isPhone()) setOpen(false);
  }, [s.hasSelection]);

  return (
    <Panel className="absolute left-3 top-3 w-[300px] max-w-[calc(100%-1.5rem)] sm:left-4 sm:top-4">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Temperature trend</h2>
          <p className="text-xs text-muted-foreground">
            {s.meta?.label ?? "MERRA-2 air temperature"}
            {s.meta && `, ${s.meta.years[0]} to ${s.meta.years[1]}`}
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
              {s.error ? <Alert>Could not load the trend map: {s.error}</Alert> : <Status tone="warning">synthetic field</Status>}
            </PanelSection>
          )}

          <PanelSection className="space-y-2.5">
            <Toggle label="Trend layer" checked={s.showTrend} onChange={s.setShowTrend} />
            <Toggle
              label="Significant only (FDR 5%)"
              checked={s.onlySignificant}
              disabled={!s.showTrend}
              onChange={s.setOnlySignificant}
            />
          </PanelSection>

          {s.showTrend && (
            <PanelSection>
              <Label className="mb-2">
                {s.view === "years" && s.frames ? `°C vs ${s.frames.baseline[0]}-${s.frames.baseline[1]}` : "°C per decade"}
              </Label>
              <div className="h-1.5" style={{ background: TREND_GRADIENT }} />
              <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-muted-foreground">
                {scale(s.view === "years" ? FRAME_MAX : MAX_TREND).map((t) => (
                  <span key={t}>{t === 0 ? "0" : formatSigned(t, 1)}</span>
                ))}
              </div>
            </PanelSection>
          )}

          <PanelSection>
            <Label className="mb-2">Region analytics</Label>
            <div className="flex flex-wrap gap-1.5">
              {REGION_NAMES.map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={s.regionName === name}
                  onClick={() => void s.setRegion(s.regionName === name ? null : name)}
                  className={cn(
                    "h-6 cursor-pointer rounded-sm border border-input px-2 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    s.regionName === name && "bg-accent text-foreground",
                  )}
                >
                  {shortRegionLabel(name)}
                </button>
              ))}
            </div>
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
                    {formatSigned(s.globalMean.slope_decade)} <span className="text-muted-foreground">°C/dec</span>
                  </span>
                </div>
                <TrendChart
                  years={s.globalMean.years}
                  values={s.globalMean.values}
                  fitted={s.globalMean.fitted}
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

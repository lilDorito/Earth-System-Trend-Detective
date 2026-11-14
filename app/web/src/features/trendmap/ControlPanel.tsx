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
import { MAX_TREND, TREND_GRADIENT } from "./trendLayer";

const isPhone = () => window.matchMedia("(max-width: 639px)").matches;
const ticks = [-MAX_TREND, -MAX_TREND / 2, 0, MAX_TREND / 2, MAX_TREND];

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
            MERRA-2 air temperature{s.meta && `, ${s.meta.years[0]} to ${s.meta.years[1]}`}
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
              <Label className="mb-2">°C per decade</Label>
              <div className="h-1.5" style={{ background: TREND_GRADIENT }} />
              <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-muted-foreground">
                {ticks.map((t) => (
                  <span key={t}>{t === 0 ? "0" : formatSigned(t, 1)}</span>
                ))}
              </div>
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

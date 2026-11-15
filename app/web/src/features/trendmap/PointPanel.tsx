// series and trend for the clicked point

import { useEffect } from "react";
import { motion } from "framer-motion";
import { LoaderCircle, X } from "lucide-react";
import type { TrendPoint } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Panel, PanelSection } from "@/components/ui/panel";
import { Label } from "@/components/ui/label";
import { InfoTip } from "@/components/ui/info-tip";
import { Status } from "@/components/ui/status";
import { formatLatLon, formatP } from "@/lib/format";
import { describeTrend, plainName } from "@/lib/summary";
import ChartTitle from "@/features/charts/ChartTitle";
import { usingMockData } from "@/api";
import { useTrendMapStore } from "@/store/useTrendMapStore";
import Insights from "./Insights";
import TrendChart from "./TrendChart";
import VerdictHeadline from "./VerdictHeadline";
import { verdict } from "./verdict";

const capital = (text: string) => text[0].toUpperCase() + text.slice(1);

export default function PointPanel({ point, loading }: { point: TrendPoint; loading: boolean }) {
  const clearSelection = useTrendMapStore((s) => s.clearSelection);
  const units = useTrendMapStore((s) => s.meta?.units ?? "");
  const city = useTrendMapStore((s) => s.picked?.name);
  const meta = useTrendMapStore((s) => s.meta);
  const live = !usingMockData;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && clearSelection();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearSelection]);

  return (
    <motion.aside
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="w-full"
    >
      <Panel>
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <div>
            {city ? (
              <>
                <p className="text-sm font-semibold">{city}</p>
                <p className="font-mono text-xs tabular-nums text-muted-foreground">cell {formatLatLon(point.lat, point.lon)}</p>
              </>
            ) : (
              <>
                <Label className="flex items-center gap-1.5">
                  Grid cell <InfoTip>The data come as a map of squares about 110 km across, one degree of latitude by one of longitude. Each square is a grid cell, with one value per year. Your click picks the square it falls in.</InfoTip>
                </Label>
                <p className="font-mono text-sm tabular-nums">{formatLatLon(point.lat, point.lon)}</p>
              </>
            )}
          </div>
          <div className="-mr-1.5 flex items-center gap-1">
            {loading && <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />}
            <Button variant="ghost" size="icon" onClick={clearSelection} aria-label="Close">
              <X />
            </Button>
          </div>
        </div>

        <PanelSection className="space-y-2">
          <VerdictHeadline v={verdict(meta?.key ?? "", point.slope_decade, point.significant_hr, units)}>
            <InfoTip>
              The answer to "Is Earth okay?" for this place. The number is how much it changed every 10 years, from the straight line through
              2000-{point.years[point.years.length - 1]}.
            </InfoTip>
          </VerdictHeadline>
          {point.significant_hr && (
            <div title={`Mann-Kendall p ${point.p < 0.001 ? "" : "= "}${formatP(point.p)}`}>
              <Status tone="success">statistically significant</Status>
            </div>
          )}
          {meta && (
            <p className="text-sm leading-relaxed">
              {describeTrend({
                name: meta.name,
                place: city ?? "this grid cell",
                units,
                slopeDecade: point.slope_decade,
                significant: point.significant_hr,
                start: point.years[0],
                end: point.years[point.years.length - 1],
              })}
            </p>
          )}
        </PanelSection>

        <PanelSection>
          {meta && (
            <ChartTitle title={`${capital(plainName(meta.name))}, year by year`}>
              Each dot is one year's average ({units}); the dashed line is the trend.
            </ChartTitle>
          )}
          <TrendChart years={point.years} values={point.values} fitted={point.fitted} rolling={point.rolling} units={units} height={window.matchMedia("(max-width: 639px)").matches ? 160 : 200} />
        </PanelSection>
        {live && meta && <Insights variable={meta.key} place={{ lat: point.lat, lon: point.lon }} />}
      </Panel>
    </motion.aside>
  );
}

// region vs the world: trend test, ratio, warming stripes

import { useEffect } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import type { EChartsOption } from "echarts";
import type { TrendRegion } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Panel, PanelSection } from "@/components/ui/panel";
import { Status } from "@/components/ui/status";
import Chart, { baseOption, palette, valueAxis } from "@/features/charts/Chart";
import { formatP, formatSigned } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useTrendMapStore } from "@/store/useTrendMapStore";
import { trendColor } from "./trendLayer";

const shortName = (region: TrendRegion) => region.label.split(" (")[0];
const rgb = (c: number[]) => `rgb(${c.map(Math.round).join(",")})`;

// one bar per year, colored by its deviation from the period mean
function Stripes({ region }: { region: TrendRegion }) {
  const peak = Math.max(0.1, ...region.stripes.map((v) => Math.abs(v ?? 0)));
  return (
    <div>
      <div className="flex h-14 overflow-hidden rounded-sm">
        {region.stripes.map((v, i) => (
          <div
            key={region.years[i]}
            className="flex-1"
            style={{ background: rgb(trendColor(v ?? 0, peak)) }}
            title={`${region.years[i]}: ${formatSigned(v ?? 0)} °C vs period mean`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>{region.years[0]}</span>
        <span>{region.years[region.years.length - 1]}</span>
      </div>
    </div>
  );
}

function VersusWorld({ region }: { region: TrendRegion }) {
  const sinceStart = (values: (number | null)[]) => {
    const first = values[0] ?? 0;
    return values.map((v) => (v == null ? null : +(v - first).toFixed(3)));
  };
  const option: EChartsOption = {
    ...baseOption,
    tooltip: {
      ...(baseOption.tooltip as object),
      valueFormatter: (v) => (typeof v === "number" ? `${formatSigned(v)} °C` : "–"),
    },
    legend: { top: 0, left: 0, textStyle: { color: palette.text }, itemWidth: 12, itemHeight: 2, icon: "rect" },
    grid: { left: 0, right: 4, top: 26, bottom: 0, containLabel: true },
    xAxis: {
      type: "category",
      data: region.years,
      boundaryGap: false,
      axisLine: { lineStyle: { color: palette.axis } },
      axisLabel: { color: palette.text, hideOverlap: true },
    },
    yAxis: { ...valueAxis, splitNumber: 3 },
    series: [
      {
        name: shortName(region),
        type: "line",
        data: sinceStart(region.mean),
        showSymbol: false,
        lineStyle: { width: 2, color: palette.trend },
        itemStyle: { color: palette.trend },
      },
      {
        name: "World",
        type: "line",
        data: sinceStart(region.global_mean),
        showSymbol: false,
        lineStyle: { width: 2, color: palette.series },
        itemStyle: { color: palette.series },
      },
    ],
  };
  return <Chart option={option} height={150} />;
}

export default function RegionPanel({ region, shifted }: { region: TrendRegion; shifted: boolean }) {
  const setRegion = useTrendMapStore((s) => s.setRegion);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && void setRegion(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setRegion]);

  const ratio = region.ratio;
  const faster = ratio != null && ratio > 1;

  return (
    <motion.aside
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn(
        "absolute inset-x-3 top-3 z-10 max-h-[calc(100%-1.5rem)] overflow-y-auto sm:inset-x-auto sm:right-4 sm:top-4 sm:w-[380px]",
        shifted && "sm:right-[412px]",
      )}
    >
      <Panel>
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <div>
            <Label>Region</Label>
            <p className="text-sm font-medium">{region.label}</p>
            <p className="font-mono text-[10px] text-muted-foreground">
              {region.start} to {region.end}, {region.n_cells} grid cells, area-weighted
            </p>
          </div>
          <Button variant="ghost" size="icon" className="-mr-1.5" onClick={() => void setRegion(null)} aria-label="Close">
            <X />
          </Button>
        </div>

        <PanelSection className="space-y-2">
          <p className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-medium tabular-nums">{formatSigned(region.total_change)} °C</span>
            <span className="text-sm text-muted-foreground">
              over the period, {formatSigned(region.slope_decade)} °C / decade
            </span>
          </p>
          <p className="text-sm">
            {ratio == null ? (
              <>The world trend is near zero ({formatSigned(region.global_slope_decade)} °C / decade), so a ratio is not meaningful.</>
            ) : ratio < 0 ? (
              <>
                {shortName(region)} moves <b>opposite</b> to the world average ({formatSigned(region.global_slope_decade)} °C / decade).
              </>
            ) : (
              <>
                {shortName(region)} changes <b className="font-mono">{ratio.toFixed(1)}x</b> {faster ? "faster" : "slower"} than the
                world average ({formatSigned(region.global_slope_decade)} °C / decade).
              </>
            )}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Status tone={region.trend === "no trend" ? "muted" : "success"}>
              {region.trend === "no trend" ? "no significant trend" : `${region.trend}, significant`}, p {region.p < 0.001 ? "" : "= "}
              {formatP(region.p)}
            </Status>
            <Status>{(region.share_warming * 100).toFixed(0)}% of the region warms</Status>
            {region.autocorr_corrected && <Status>autocorrelation-corrected</Status>}
          </div>
        </PanelSection>

        <PanelSection>
          <Label className="mb-1">Change since {region.start}, °C</Label>
          <VersusWorld region={region} />
        </PanelSection>

        <PanelSection>
          <Label className="mb-2">Warming stripes, one bar per year</Label>
          <Stripes region={region} />
        </PanelSection>
      </Panel>
    </motion.aside>
  );
}

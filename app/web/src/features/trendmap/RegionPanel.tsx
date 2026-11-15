// region vs the world: trend test, ratio, one stripe per year

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
import { divergingColor, styleFor } from "./styles";

const shortName = (region: TrendRegion) => region.label.split(" (")[0];
const rgb = (c: number[]) => `rgb(${c.map(Math.round).join(",")})`;

// one bar per year, colored by its deviation from the period mean
function Stripes({ region, units, stops }: { region: TrendRegion; units: string; stops: ReturnType<typeof styleFor>["change"] }) {
  const peak = Math.max(...region.stripes.map((v) => Math.abs(v ?? 0))) || 1;
  return (
    <div>
      <div className="flex h-14 overflow-hidden rounded-sm">
        {region.stripes.map((v, i) => (
          <div
            key={region.years[i]}
            className="flex-1"
            style={{ background: rgb(divergingColor(stops, v ?? 0, peak)) }}
            title={`${region.years[i]}: ${formatSigned(v ?? 0)} ${units} vs period mean`}
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

function VersusWorld({ region, units }: { region: TrendRegion; units: string }) {
  const sinceStart = (values: (number | null)[]) => {
    const first = values[0] ?? 0;
    return values.map((v) => (v == null ? null : +(v - first).toFixed(3)));
  };
  const option: EChartsOption = {
    ...baseOption,
    tooltip: {
      ...(baseOption.tooltip as object),
      valueFormatter: (v) => (typeof v === "number" ? `${formatSigned(v)} ${units}` : "–"),
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
  const units = useTrendMapStore((s) => s.meta?.units ?? "");
  const style = styleFor(useTrendMapStore((s) => s.meta?.key));

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
        // phones: a bottom sheet over the lower part of the globe; wider screens: a side panel
        "scrollbar-thin absolute inset-x-3 bottom-3 z-10 max-h-[65%] overflow-y-auto overscroll-contain sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:max-h-[calc(100%-2rem)] sm:w-[380px]",
        shifted && "sm:right-[412px]",
      )}
    >
      <Panel>
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <div>
            <Label>Region</Label>
            <p className="text-sm font-medium">{region.label}</p>
            <p className="font-mono text-[10px] text-muted-foreground">
              {region.start} to {region.end}, {region.n_cells} grid {region.n_cells === 1 ? "cell" : "cells"}, area-weighted
            </p>
            {region.coverage != null && region.coverage < 0.9 && (
              <p className="mt-1 text-xs text-warning">Data covers {Math.round(region.coverage * 100)}% of this area</p>
            )}
          </div>
          <Button variant="ghost" size="icon" className="-mr-1.5" onClick={() => void setRegion(null)} aria-label="Close">
            <X />
          </Button>
        </div>

        <PanelSection className="space-y-2">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="whitespace-nowrap font-mono text-2xl font-medium tabular-nums">{formatSigned(region.total_change)} {units}</span>
            <span className="text-sm text-muted-foreground">
              over the period, {formatSigned(region.slope_decade)} {units} / decade
            </span>
          </p>
          <p className="text-sm">
            {ratio == null ? (
              <>The world trend is near zero ({formatSigned(region.global_slope_decade)} {units} / decade), so a ratio is not meaningful.</>
            ) : ratio < 0 ? (
              <>
                {shortName(region)} moves <b>opposite</b> to the world average ({formatSigned(region.global_slope_decade)} {units} / decade).
              </>
            ) : (
              <>
                {shortName(region)} changes <b className="font-mono">{ratio.toFixed(1)}x</b> {faster ? "faster" : "slower"} than the
                world average ({formatSigned(region.global_slope_decade)} {units} / decade).
              </>
            )}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Status tone={region.trend === "no trend" ? "muted" : "success"}>
              {region.trend === "no trend" ? "no significant trend" : `${region.trend}, significant`}, p {region.p < 0.001 ? "" : "= "}
              {formatP(region.p)}
            </Status>
            <Status>
              {(region.share_warming * 100).toFixed(0)}% of the region {style.up}
            </Status>
            {region.autocorr_corrected && <Status>autocorrelation-corrected</Status>}
          </div>
        </PanelSection>

        <PanelSection>
          <Label className="mb-1">
            Change since {region.start}, {units}
          </Label>
          <VersusWorld region={region} units={units} />
        </PanelSection>

        <PanelSection>
          <Label className="mb-2">{style.stripes ?? "Stripes"}, one bar per year</Label>
          <Stripes region={region} units={units} stops={style.change} />
        </PanelSection>
      </Panel>
    </motion.aside>
  );
}

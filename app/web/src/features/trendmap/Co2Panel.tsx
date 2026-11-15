// atmospheric CO2 on its own: one well-mixed curve for the whole planet, so a chart instead of a globe layer

import { useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { LoaderCircle, X } from "lucide-react";
import type { EChartsOption } from "echarts";
import type { Co2Series } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Panel, PanelSection } from "@/components/ui/panel";
import Chart, { baseOption, palette, valueAxis } from "@/features/charts/Chart";
import ChartTitle from "@/features/charts/ChartTitle";
import { formatSigned } from "@/lib/format";
import { useCo2Store } from "@/store/useCo2Store";
import { useTrendMapStore } from "@/store/useTrendMapStore";

const MAUNA_LOA = "#d9b45a";
const LINKED: [string, string][] = [
  ["merra2_t2m", "Air temperature"],
  ["sst", "Sea surface temperature"],
  ["ohc_0_700", "Ocean heat"],
  ["pco2", "Ocean pCO₂"],
  ["ph", "Ocean pH"],
  ["ndvi", "Vegetation"],
];

const mean = (values: (number | null)[]) => {
  const ok = values.filter((v): v is number => v !== null);
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
};

function Stat({ label, value, units }: { label: string; value: string; units?: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <p className="font-mono text-[13px] tabular-nums">
        {value} {units && <span className="text-muted-foreground">{units}</span>}
      </p>
    </div>
  );
}

function Co2Chart({ co2, height }: { co2: Co2Series; height: number }) {
  const option = useMemo<EChartsOption>(
    () => ({
      ...baseOption,
      animation: false,
      tooltip: {
        ...(baseOption.tooltip as object),
        valueFormatter: (v) => (typeof v === "number" ? `${v.toFixed(1)} ppm` : "–"),
      },
      legend: { top: 0, left: 0, textStyle: { color: palette.text }, itemWidth: 12, itemHeight: 2, icon: "rect" },
      grid: { left: 0, right: 4, top: 40, bottom: 0, containLabel: true },
      xAxis: {
        type: "category",
        data: co2.months,
        boundaryGap: false,
        axisLine: { lineStyle: { color: palette.axis } },
        axisLabel: { color: palette.text, interval: (i: number) => i % 60 === 0, formatter: (m: string) => m.slice(0, 4) },
        axisTick: { show: false },
      },
      yAxis: { ...valueAxis, splitNumber: 4, name: "ppm" },
      series: [
        { name: "Mauna Loa", type: "line", data: co2.mauna_loa, showSymbol: false, lineStyle: { width: 1, color: MAUNA_LOA, opacity: 0.8 }, itemStyle: { color: MAUNA_LOA } },
        { name: "Global mean", type: "line", data: co2.monthly, showSymbol: false, lineStyle: { width: 1.6, color: palette.series }, itemStyle: { color: palette.series } },
      ],
    }),
    [co2],
  );
  return <Chart option={option} height={height} />;
}

export default function Co2Panel() {
  const { series: co2, error, setOpen } = useCo2Store(useShallow((s) => ({ series: s.series, error: s.error, setOpen: s.setOpen })));
  const { variables, setVariable } = useTrendMapStore(useShallow((s) => ({ variables: s.variables, setVariable: s.setVariable })));
  const close = () => setOpen(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const stats = useMemo(() => {
    if (!co2 || !co2.years.length) return null;
    const n = co2.years.length;
    const first = co2.ppm[0] ?? 0;
    const last = co2.ppm[n - 1] ?? 0;
    return {
      first,
      last,
      from: co2.years[0],
      to: co2.years[n - 1],
      early: mean(co2.growth.slice(1, 11)),
      late: mean(co2.growth.slice(-5)),
    };
  }, [co2]);

  const linked = LINKED.filter(([key]) => variables.some((v) => v.key === key));

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
          <div className="min-w-0">
            <Label>Whole planet · NOAA GML</Label>
            <p className="text-sm font-semibold">Atmospheric CO₂</p>
          </div>
          <div className="-mr-1.5 flex items-center gap-1">
            {!co2 && !error && <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />}
            <Button variant="ghost" size="icon" onClick={close} aria-label="Close">
              <X />
            </Button>
          </div>
        </div>

        {error && (
          <PanelSection>
            <p className="text-xs text-warning">Could not load the CO₂ series. {error}</p>
          </PanelSection>
        )}

        {co2 && stats && (
          <>
            <PanelSection className="space-y-1">
              <p className="flex items-baseline gap-2">
                <span className="font-mono text-2xl font-medium tabular-nums">{formatSigned(co2.slope_decade, 1)}</span>
                <span className="text-sm text-muted-foreground">ppm / decade</span>
              </p>
              <p className="text-xs leading-snug text-muted-foreground">
                From {stats.first.toFixed(0)} ppm in {stats.from} to {stats.last.toFixed(0)} ppm in {stats.to}, and the rise is
                speeding up.
              </p>
            </PanelSection>

            <PanelSection className="grid grid-cols-2 gap-x-4 gap-y-2">
              <Stat label={`Rise since ${stats.from}`} value={`+${(stats.last - stats.first).toFixed(0)}`} units="ppm" />
              <Stat label="Above the 2000 level" value={`+${((stats.last / stats.first - 1) * 100).toFixed(0)}`} units="%" />
              <Stat label="Added per year, 2000s" value={stats.early !== null ? stats.early.toFixed(1) : "–"} units="ppm" />
              <Stat label="Added per year, last 5" value={stats.late !== null ? stats.late.toFixed(1) : "–"} units="ppm" />
            </PanelSection>

            <PanelSection>
              <ChartTitle title="CO₂ in the air, month by month">Parts per million, worldwide and at Mauna Loa, Hawaii.</ChartTitle>
              <Co2Chart co2={co2} height={window.matchMedia("(max-width: 639px)").matches ? 160 : 200} />
              <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                CO₂ mixes through the whole atmosphere within a year or two, so every place sees nearly the same curve; that is
                why it is a chart, not a map. The yearly wave is plants in the Northern Hemisphere taking CO₂ up in summer and
                releasing it in winter, stronger at Mauna Loa than in the global mean.
              </p>
            </PanelSection>

            {linked.length > 0 && (
              <PanelSection className="space-y-1.5">
                <Label>Where it shows on the globe</Label>
                <div className="flex flex-wrap gap-1.5">
                  {linked.map(([key, label]) => (
                    <Button
                      key={key}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        close();
                        void setVariable(key);
                      }}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </PanelSection>
            )}
          </>
        )}
      </Panel>
    </motion.aside>
  );
}

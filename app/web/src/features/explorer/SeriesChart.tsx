// monthly series chart with trend or event lines

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { EChartsOption, LineSeriesOption } from "echarts";
import type { AnalyzeResponse } from "@/api/types";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import Chart, { baseOption, palette, valueAxis } from "@/features/charts/Chart";
import { formatNumber } from "@/lib/format";

type View = "values" | "anomaly";

const views: { value: View; label: string }[] = [
  { value: "values", label: "Values" },
  { value: "anomaly", label: "Anomalies" },
];

export default function SeriesChart({ response }: { response: AnalyzeResponse }) {
  const { series, result, meta } = response;
  const [view, setView] = useState<View>(result.deseasonalized ? "anomaly" : "values");
  const anomaly = view === "anomaly";

  const option = useMemo<EChartsOption>(() => {
    const climatology = series.filter((p) => p.climatology !== null).map((p) => p.climatology!);
    const offset = climatology.reduce((a, b) => a + b, 0) / climatology.length;
    const fromValues = (v: number) => (anomaly ? v - offset : v);
    const fromResult = (v: number) => (result.deseasonalized === anomaly ? v : anomaly ? v - offset : v + offset);
    const first = series[0].time;
    const last = series[series.length - 1].time;

    const lines: LineSeriesOption[] = [
      {
        name: meta.variable_name,
        type: "line",
        showSymbol: false,
        lineStyle: { width: 1, color: palette.series },
        itemStyle: { color: palette.series },
        data: series.map((p) => [p.time, anomaly ? p.anomaly : p.value]),
      },
    ];

    if (result.mode === "trend") {
      lines.push({
        name: "Trend",
        type: "line",
        showSymbol: false,
        lineStyle: { width: 2, color: palette.trend },
        itemStyle: { color: palette.trend },
        data: result.fit_line.map(([t, v]) => [t, fromValues(v)]),
      });
    } else {
      const before = fromResult(result.before_mean);
      const after = fromResult(result.after_mean);
      lines.push({
        name: "Mean before / after",
        type: "line",
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 2, color: palette.trend },
        itemStyle: { color: palette.trend },
        data: [[first, before], [result.event_date, before], [result.event_date, null], [result.event_date, after], [last, after]],
        markLine: {
          symbol: "none",
          silent: true,
          label: { formatter: "event", color: palette.event, position: "insideEndTop" },
          lineStyle: { color: palette.event, type: "dashed" },
          data: [{ xAxis: result.event_date }],
        },
      });
    }

    return {
      ...baseOption,
      tooltip: {
        ...(baseOption.tooltip as object),
        valueFormatter: (v) => (typeof v === "number" ? `${formatNumber(v)} ${meta.units}` : "–"),
      },
      legend: { top: 0, left: 0, textStyle: { color: palette.text }, itemWidth: 12, itemHeight: 2, icon: "rect" },
      grid: { left: 0, right: 8, top: 44, bottom: 0, containLabel: true },
      xAxis: { type: "time", axisLine: { lineStyle: { color: palette.axis } }, axisLabel: { color: palette.text } },
      yAxis: { ...valueAxis, name: anomaly ? `Δ ${meta.units}` : meta.units },
      dataZoom: [{ type: "inside" }],
      series: lines,
    };
  }, [series, result, meta, anomaly]);

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25, delay: 0.05 }}
      className="border-b px-5 py-4"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <Label>Monthly series</Label>
        <Segmented size="sm" value={view} options={views} onChange={setView} />
      </div>
      <Chart option={option} height={260} />
      <p className="mt-1 text-[11px] text-muted-foreground">Scroll to zoom, drag to pan.</p>
    </motion.section>
  );
}

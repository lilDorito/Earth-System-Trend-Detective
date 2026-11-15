// station and grid cell annual anomalies on one chart

import type { EChartsOption, LineSeriesOption } from "echarts";
import Chart, { baseOption, palette, valueAxis } from "@/features/charts/Chart";
import { formatNumber } from "@/lib/format";

type Line = { name: string; values: (number | null)[]; fitted?: (number | null)[]; color: string };

export default function StationChart({ years, lines, units, height = 200 }: { years: number[]; lines: Line[]; units: string; height?: number }) {
  const series: LineSeriesOption[] = lines.flatMap((line) => {
    const out: LineSeriesOption[] = [
      {
        name: line.name,
        type: "line",
        data: line.values,
        symbol: "circle",
        symbolSize: 3,
        connectNulls: false,
        lineStyle: { width: 1.5, color: line.color },
        itemStyle: { color: line.color },
      },
    ];
    if (line.fitted) {
      out.push({
        name: `${line.name} trend`,
        type: "line",
        data: line.fitted,
        showSymbol: false,
        connectNulls: true,
        lineStyle: { width: 1.5, type: "dashed", color: line.color, opacity: 0.8 },
        itemStyle: { color: line.color },
        tooltip: { show: false },
      });
    }
    return out;
  });

  const option: EChartsOption = {
    ...baseOption,
    tooltip: {
      ...(baseOption.tooltip as object),
      valueFormatter: (v) => (typeof v === "number" ? `${formatNumber(v)} ${units}` : "–"),
    },
    legend: {
      top: 0,
      left: 0,
      data: lines.map((l) => l.name),
      textStyle: { color: palette.text },
      itemWidth: 12,
      itemHeight: 2,
      icon: "rect",
    },
    grid: { left: 0, right: 4, top: 28, bottom: 0, containLabel: true },
    xAxis: {
      type: "category",
      data: years,
      boundaryGap: false,
      axisLine: { lineStyle: { color: palette.axis } },
      axisLabel: { color: palette.text, hideOverlap: true },
    },
    yAxis: { ...valueAxis, splitNumber: 4 },
    series,
  };

  return <Chart option={option} height={height} />;
}

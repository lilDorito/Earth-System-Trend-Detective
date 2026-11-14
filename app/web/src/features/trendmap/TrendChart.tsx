// annual series chart for the trend map

import type { EChartsOption, LineSeriesOption } from "echarts";
import Chart, { baseOption, palette, valueAxis } from "@/features/charts/Chart";

type TrendChartProps = {
  years: number[];
  values: (number | null)[];
  fitted?: (number | null)[];
  rolling?: (number | null)[];
  height?: number;
  compact?: boolean;
};

export default function TrendChart({ years, values, fitted, rolling, height = 220, compact = false }: TrendChartProps) {
  const series: LineSeriesOption[] = [
    {
      name: "Annual mean",
      type: "line",
      data: values,
      symbol: "circle",
      symbolSize: compact ? 0 : 3,
      showSymbol: !compact,
      lineStyle: { width: 1.25, color: palette.series },
      itemStyle: { color: palette.series },
    },
  ];
  if (rolling) {
    series.push({
      name: "5-year mean",
      type: "line",
      data: rolling,
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 2, color: palette.rolling },
      itemStyle: { color: palette.rolling },
    });
  }
  if (fitted) {
    series.push({
      name: "Trend",
      type: "line",
      data: fitted,
      showSymbol: false,
      lineStyle: { width: 2, type: "dashed", color: palette.trend },
      itemStyle: { color: palette.trend },
    });
  }

  const option: EChartsOption = {
    ...baseOption,
    tooltip: {
      ...(baseOption.tooltip as object),
      valueFormatter: (v) => (typeof v === "number" ? `${v.toFixed(2)} °C` : "–"),
    },
    legend: compact
      ? undefined
      : { top: 0, left: 0, textStyle: { color: palette.text }, itemWidth: 12, itemHeight: 2, icon: "rect" },
    grid: { left: 0, right: 4, top: compact ? 6 : 28, bottom: 0, containLabel: true },
    xAxis: {
      type: "category",
      data: years,
      boundaryGap: false,
      axisLine: { lineStyle: { color: palette.axis } },
      axisLabel: { color: palette.text, hideOverlap: true, interval: compact ? 7 : "auto" },
    },
    yAxis: { ...valueAxis, splitNumber: compact ? 2 : 4 },
    series,
  };

  return <Chart option={option} height={height} />;
}

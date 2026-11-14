// Annual series + 5-year rolling mean + Sen trend line

import ReactECharts from "echarts-for-react";
import type { EChartsOption, LineSeriesOption } from "echarts";

type Props = {
  years: number[];
  values: (number | null)[];
  fitted?: (number | null)[];
  rolling?: (number | null)[];
  height?: number;
  compact?: boolean;
};

export default function TrendChart({ years, values, fitted, rolling, height = 220, compact = false }: Props) {
  const series: LineSeriesOption[] = [
    {
      name: "Annual mean",
      type: "line",
      data: values,
      symbol: "circle",
      symbolSize: 5,
      lineStyle: { width: 1.5, color: "#7aa7ff" },
      itemStyle: { color: "#7aa7ff" },
    },
  ];
  if (rolling) {
    series.push({
      name: "5-year rolling",
      type: "line",
      data: rolling,
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 2, color: "#ffd34d" },
      itemStyle: { color: "#ffd34d" },
    });
  }
  if (fitted) {
    series.push({
      name: "Trend (Sen)",
      type: "line",
      data: fitted,
      showSymbol: false,
      lineStyle: { width: 2, type: "dashed", color: "#ff7a7a" },
      itemStyle: { color: "#ff7a7a" },
    });
  }

  const option: EChartsOption = {
    backgroundColor: "transparent",
    textStyle: { color: "#a9b4c7" },
    animationDuration: 400,
    tooltip: { trigger: "axis", valueFormatter: (v) => `${v} °C` },
    legend: compact ? undefined : { top: 0, textStyle: { color: "#a9b4c7" }, itemWidth: 14 },
    grid: { left: 44, right: 12, top: compact ? 10 : 34, bottom: 24 },
    xAxis: { type: "category", data: years, axisLine: { lineStyle: { color: "#3a465c" } } },
    yAxis: {
      type: "value",
      scale: true,
      name: "°C",
      nameTextStyle: { color: "#a9b4c7" },
      splitLine: { lineStyle: { color: "rgba(255,255,255,0.08)" } },
    },
    series,
  };

  return <ReactECharts option={option} style={{ height, width: "100%" }} notMerge />;
}

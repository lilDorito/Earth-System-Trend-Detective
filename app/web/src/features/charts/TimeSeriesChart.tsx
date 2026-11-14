// Values + trend line (owner: frontend)
// TODO: anomaly view toggle, CI band, event-date marker for event mode, dataZoom

import ReactECharts from "echarts-for-react";
import type { AnalyzeResponse } from "@/api/types";

export default function TimeSeriesChart({ response }: { response: AnalyzeResponse }) {
  const { series, result, meta } = response;

  const option = {
    backgroundColor: "transparent",
    tooltip: { trigger: "axis" },
    grid: { left: 50, right: 16, top: 24, bottom: 32 },
    xAxis: { type: "time" },
    yAxis: { type: "value", name: meta.units, scale: true },
    series: [
      {
        name: meta.variable_name,
        type: "line",
        showSymbol: false,
        lineStyle: { width: 1 },
        data: series.map((p) => [p.time, p.value]),
      },
      ...(result.mode === "trend"
        ? [{ name: "Trend", type: "line", showSymbol: false, lineStyle: { width: 2 }, data: result.fit_line }]
        : []),
    ],
  };

  return <ReactECharts option={option} theme="dark" style={{ height: 320 }} notMerge />;
}

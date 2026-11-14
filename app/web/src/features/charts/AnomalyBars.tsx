// Yearly anomaly bars: red above the seasonal norm, blue below. Shows at a glance how the period changed.

import ReactECharts from "echarts-for-react";
import type { AnalyzeResponse } from "@/api/types";

export default function AnomalyBars({ response }: { response: AnalyzeResponse }) {
  const { series, meta } = response;

  const byYear = new Map<number, number[]>();
  for (const p of series) {
    if (p.anomaly === null) continue;
    const year = new Date(p.time).getUTCFullYear();
    byYear.set(year, [...(byYear.get(year) ?? []), p.anomaly]);
  }
  const years = [...byYear.keys()].sort((a, b) => a - b);
  const values = years.map((y) => {
    const v = byYear.get(y)!;
    return +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3);
  });

  const option = {
    backgroundColor: "transparent",
    tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v > 0 ? "+" : ""}${v} ${meta.units}` },
    grid: { left: 50, right: 16, top: 24, bottom: 28 },
    xAxis: { type: "category", data: years, axisLabel: { color: "#a3a3a3" } },
    yAxis: { type: "value", name: `anomaly, ${meta.units}`, nameTextStyle: { color: "#a3a3a3" }, splitLine: { lineStyle: { color: "rgba(255,255,255,0.08)" } } },
    series: [
      {
        type: "bar",
        data: values.map((v) => ({ value: v, itemStyle: { color: v >= 0 ? "#dc4b4b" : "#4b7bdc" } })),
        barCategoryGap: "10%",
      },
    ],
  };

  return (
    <div>
      <div className="mb-1 text-xs text-neutral-500">Yearly anomaly vs the seasonal norm of this period</div>
      <ReactECharts option={option} theme="dark" style={{ height: 220 }} notMerge />
    </div>
  );
}

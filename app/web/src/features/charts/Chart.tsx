// ECharts wrapper and shared chart style

import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  DataZoomInsideComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";
import ReactEChartsCore from "echarts-for-react/esm/core";
import { formatAxis } from "@/lib/format";

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  MarkAreaComponent,
  DataZoomInsideComponent,
  CanvasRenderer,
]);

const MONO = '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace';

export const palette = {
  text: "#8d939c",
  axis: "#2c3036",
  split: "rgba(255,255,255,0.05)",
  series: "#8fb0cf",
  rolling: "#d9b45a",
  trend: "#ef7f5f",
  event: "#b99cf0",
};

export const baseOption: EChartsOption = {
  backgroundColor: "transparent",
  animationDuration: 400,
  textStyle: { color: palette.text, fontFamily: MONO, fontSize: 10 },
  tooltip: {
    trigger: "axis",
    backgroundColor: "#16181c",
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 3,
    padding: [6, 8],
    textStyle: { color: "#e6e8eb", fontSize: 11, fontFamily: MONO },
    axisPointer: { lineStyle: { color: "rgba(255,255,255,0.2)" } },
  },
};

export const valueAxis = {
  type: "value" as const,
  scale: true,
  nameTextStyle: { color: palette.text, align: "left" as const },
  axisLabel: { color: palette.text, formatter: formatAxis },
  splitLine: { lineStyle: { color: palette.split } },
};

// vertical swipes scroll the page instead of getting stuck on a chart; pinch and sideways drags still zoom and pan it
export default function Chart({ option, height }: { option: EChartsOption; height: number }) {
  return (
    <ReactEChartsCore
      echarts={echarts}
      option={option}
      notMerge
      lazyUpdate
      className="touch-pan-y [&_*]:touch-pan-y!"
      style={{ height, width: "100%" }}
    />
  );
}

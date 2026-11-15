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
import { isPhoneTheme } from "@/lib/theme";

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

// charts draw on a canvas, so they take the theme here: the dark desktop look, or marshmallow on phones
const marshmallow = isPhoneTheme();

export const palette = marshmallow
  ? {
      text: "#8a5a74",
      axis: "#e9c3d3",
      split: "rgba(150, 60, 105, 0.09)",
      series: "#e2689f",
      rolling: "#d9a400",
      trend: "#7a2e5c",
      event: "#8f6fd8",
    }
  : {
      text: "#8d939c",
      axis: "#2c3036",
      split: "rgba(255,255,255,0.05)",
      series: "#8fb0cf",
      rolling: "#d9b45a",
      trend: "#ef7f5f",
      event: "#b99cf0",
    };

const tooltipLook = marshmallow
  ? { background: "#fffaf0", border: "rgba(150, 60, 105, 0.22)", text: "#4a2340", pointer: "rgba(150, 60, 105, 0.3)" }
  : { background: "#16181c", border: "rgba(255,255,255,0.12)", text: "#e6e8eb", pointer: "rgba(255,255,255,0.2)" };

export const baseOption: EChartsOption = {
  backgroundColor: "transparent",
  animationDuration: 400,
  textStyle: { color: palette.text, fontFamily: MONO, fontSize: 10 },
  tooltip: {
    trigger: "axis",
    backgroundColor: tooltipLook.background,
    borderColor: tooltipLook.border,
    borderRadius: marshmallow ? 10 : 3,
    padding: [6, 8],
    textStyle: { color: tooltipLook.text, fontSize: 11, fontFamily: MONO },
    axisPointer: { lineStyle: { color: tooltipLook.pointer } },
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

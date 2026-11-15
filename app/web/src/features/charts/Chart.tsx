// ECharts wrapper and shared chart style

import { useMemo } from "react";
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
import { usePhoneTheme } from "@/lib/theme";

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

const tooltipLook = { background: "#16181c", border: "rgba(255,255,255,0.12)", text: "#e6e8eb", pointer: "rgba(255,255,255,0.2)" };

export const baseOption: EChartsOption = {
  backgroundColor: "transparent",
  animationDuration: 400,
  textStyle: { color: palette.text, fontFamily: MONO, fontSize: 10 },
  tooltip: {
    trigger: "axis",
    backgroundColor: tooltipLook.background,
    borderColor: tooltipLook.border,
    borderRadius: 3,
    padding: [6, 8],
    textStyle: { color: tooltipLook.text, fontSize: 11, fontFamily: MONO },
    axisPointer: { lineStyle: { color: tooltipLook.pointer } },
  },
};

// charts draw on a canvas, out of reach of the CSS theme: in marshmallow each dark colour above is swapped
// for its partner here, so every chart follows the theme switch without building its options twice
const MARSHMALLOW: Record<string, string> = {
  [palette.text]: "#8a5a74",
  [palette.axis]: "#e9c3d3",
  [palette.split]: "rgba(150, 60, 105, 0.09)",
  [palette.series]: "#e2689f",
  [palette.rolling]: "#d9a400",
  [palette.trend]: "#7a2e5c",
  [palette.event]: "#8f6fd8",
  [tooltipLook.background]: "#fffaf0",
  [tooltipLook.border]: "rgba(150, 60, 105, 0.22)",
  [tooltipLook.text]: "#4a2340",
  [tooltipLook.pointer]: "rgba(150, 60, 105, 0.3)",
};

// a copy of the option with the colours swapped; functions (formatters) and plain data pass through untouched
function recolor<T>(value: T): T {
  if (typeof value === "string") return (MARSHMALLOW[value] ?? value) as T;
  if (Array.isArray(value)) return value.map(recolor) as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, recolor(v)])) as T;
  }
  return value;
}

export const valueAxis = {
  type: "value" as const,
  scale: true,
  nameTextStyle: { color: palette.text, align: "left" as const },
  axisLabel: { color: palette.text, formatter: formatAxis },
  splitLine: { lineStyle: { color: palette.split } },
};

// vertical swipes scroll the page instead of getting stuck on a chart; pinch and sideways drags still zoom and pan it
export default function Chart({ option, height }: { option: EChartsOption; height: number }) {
  const marshmallow = usePhoneTheme();
  const shown = useMemo(
    () => (marshmallow ? recolor({ ...option, tooltip: { ...(option.tooltip as object), borderRadius: 10 } }) : option),
    [option, marshmallow],
  );
  return (
    <ReactEChartsCore
      echarts={echarts}
      option={shown}
      notMerge
      lazyUpdate
      className="touch-pan-y [&_*]:touch-pan-y!"
      style={{ height, width: "100%" }}
    />
  );
}

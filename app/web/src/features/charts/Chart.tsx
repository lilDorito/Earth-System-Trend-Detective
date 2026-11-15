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
import type { ECharts } from "echarts/core";
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
  textStyle: { color: palette.text, fontFamily: MONO, fontSize: 11 },
  tooltip: {
    trigger: "axis",
    confine: true,
    backgroundColor: tooltipLook.background,
    borderColor: tooltipLook.border,
    borderRadius: 3,
    padding: [6, 8],
    textStyle: { color: tooltipLook.text, fontSize: 12, fontFamily: MONO },
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
  nameTextStyle: { color: palette.text, align: "left" as const, fontSize: 11 },
  axisLabel: { color: palette.text, formatter: formatAxis, fontSize: 11 },
  splitLine: { lineStyle: { color: palette.split } },
};

// every chart with an x axis zooms with the mouse wheel (or a pinch) and pans with a drag
const ZOOM = { type: "inside" as const, xAxisIndex: 0, zoomOnMouseWheel: true, moveOnMouseMove: true, moveOnMouseWheel: false, minValueSpan: 3 };

// a legend stays on one line: long names are cut short (the full name shows on hover) and arrows page through
// the rest, so it never wraps onto the plot; the plot starts far enough below it for the unit label to fit
function tidyLegend(option: EChartsOption): EChartsOption {
  const legend = option.legend;
  if (!legend || Array.isArray(legend)) return option;
  const grid = option.grid && !Array.isArray(option.grid) ? option.grid : null;
  return {
    ...option,
    legend: {
      ...legend,
      type: "scroll",
      right: 0,
      pageIconColor: palette.text,
      pageIconInactiveColor: palette.axis,
      pageIconSize: 9,
      pageTextStyle: { color: palette.text },
      textStyle: { ...(legend.textStyle as object), width: 170, overflow: "truncate" },
      tooltip: { show: true },
    },
    grid: grid ? { ...grid, top: Math.max(Number(grid.top ?? 0), 46) } : grid ?? undefined,
  };
}

// double-click goes back to the whole period
function resetOnDoubleClick(chart: ECharts) {
  chart.getZr().on("dblclick", () => chart.dispatchAction({ type: "dataZoom", start: 0, end: 100 }));
}

// vertical swipes scroll the page instead of getting stuck on a chart; pinch and sideways drags still zoom and pan it
export default function Chart({ option, height, zoom = true }: { option: EChartsOption; height: number; zoom?: boolean }) {
  const marshmallow = usePhoneTheme();
  const shown = useMemo(() => {
    const withZoom = tidyLegend(zoom && option.xAxis && !option.dataZoom ? { ...option, dataZoom: [ZOOM] } : option);
    return marshmallow ? recolor({ ...withZoom, tooltip: { ...(withZoom.tooltip as object), borderRadius: 10 } }) : withZoom;
  }, [option, marshmallow, zoom]);
  return (
    <div title={zoom ? "Scroll to zoom, drag to move, double-click to see everything" : undefined}>
      <ReactEChartsCore
        echarts={echarts}
        option={shown}
        notMerge
        lazyUpdate
        onChartReady={zoom ? resetOnDoubleClick : undefined}
        className="touch-pan-y [&_*]:touch-pan-y!"
        style={{ height, width: "100%" }}
      />
    </div>
  );
}

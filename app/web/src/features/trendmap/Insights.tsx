// insight sections of the point and region panels: can the trend be trusted, when would it be significant,
// and what else changes at the same place

import { useEffect, useState } from "react";
import { ChevronDown, LoaderCircle } from "lucide-react";
import type { EChartsOption } from "echarts";
import { api } from "@/api";
import type { Diagnosis, InsightPlace, Scan } from "@/api/types";
import { Label } from "@/components/ui/label";
import { PanelSection } from "@/components/ui/panel";
import Chart, { baseOption, palette } from "@/features/charts/Chart";
import { formatNumber, formatP, formatSigned } from "@/lib/format";
import { plainName } from "@/lib/summary";
import { cn } from "@/lib/utils";
import { useTrendMapStore } from "@/store/useTrendMapStore";
import { divergingColor, styleFor } from "./styles";

type Loaded<T> = { data: T | null; error: string | null; loading: boolean };

// fetches again whenever the key changes; a late answer for an old key is dropped
function useLoad<T>(key: string | null, load: () => Promise<T>): Loaded<T> {
  const [state, setState] = useState<Loaded<T> & { key: string | null }>({ data: null, error: null, loading: false, key: null });
  useEffect(() => {
    if (!key) return;
    let active = true;
    setState({ data: null, error: null, loading: true, key });
    load().then(
      (data) => active && setState({ data, error: null, loading: false, key }),
      (e: Error) => active && setState({ data: null, error: e.message, loading: false, key }),
    );
    return () => {
      active = false;
    };
    // load closes over the same inputs the key is made from, so the key alone decides when to fetch
  }, [key]);
  return state.key === key ? state : { data: null, error: null, loading: !!key };
}

const placeKey = (place: InsightPlace) => JSON.stringify(place);

function Check({ tone, title, children }: { tone: "good" | "warn" | "neutral"; title: string; children: React.ReactNode }) {
  const mark = { good: "✓", warn: "!", neutral: "·" }[tone];
  return (
    <li className="flex gap-2.5">
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-semibold",
          tone === "good" && "bg-success/15 text-success",
          tone === "warn" && "bg-warning/15 text-warning",
          tone === "neutral" && "bg-muted text-muted-foreground",
        )}
      >
        {mark}
      </span>
      <div className="min-w-0">
        <p className="text-sm">{title}</p>
        <p className="text-xs leading-snug text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}

function TrustChecks({ d }: { d: Diagnosis }) {
  const shifted = d.robust.shifted;
  const range = shifted.length
    ? `${formatSigned(Math.min(...shifted.map((s) => s.slope)) * 10)} to ${formatSigned(Math.max(...shifted.map((s) => s.slope)) * 10)}`
    : "";
  return (
    <ul className="space-y-2.5">
      {d.agreement && (
        <Check tone={d.agreement.agree ? "good" : "warn"} title={d.agreement.agree ? "Independent product agrees" : "Independent product disagrees"}>
          {plainName(d.agreement.name)} ({d.agreement.name.match(/\(([^)]+)\)/)?.[1] ?? "other product"}): {formatSigned(d.agreement.slope_decade)}{" "}
          against {formatSigned(d.agreement.own_slope_decade)} {d.units} / decade over the same cells
          {d.agreement.ratio && !d.agreement.agree && Math.sign(d.agreement.ratio) > 0
            ? `, ${formatNumber(Math.max(d.agreement.ratio, 1 / d.agreement.ratio))}x apart`
            : ""}
          .
        </Check>
      )}
      <Check
        tone={d.jump.likely ? "warn" : "good"}
        title={d.jump.likely ? `Looks like a jump around ${d.jump.year}` : "A steady trend, not a jump"}
      >
        {d.jump.likely
          ? `One shift of ${formatSigned(d.jump.shift)} ${d.units} fits the years better than a straight line. A new instrument or model change can do that.`
          : "A straight line fits the years better than a single shift."}
      </Check>
      <Check tone={d.robust.stable ? "good" : "warn"} title={d.robust.stable ? "Holds when the start year moves" : "Depends on the start year"}>
        Starting 1-{shifted.length} years later gives {range} {d.units} / decade.
      </Check>
      {d.enso && (
        <Check tone={d.enso.explained > 0.2 ? "warn" : "neutral"} title={`El Niño explains ${Math.round(d.enso.explained * 100)}% of the ups and downs`}>
          With ENSO accounted for the trend is {formatSigned(d.enso.trend_without_enso)} instead of {formatSigned(d.enso.trend)} {d.units} / decade.
        </Check>
      )}
    </ul>
  );
}

// p-value of the record ending each year, on a log scale with the 0.05 line
function Growth({ d }: { d: Diagnosis }) {
  const option: EChartsOption = {
    ...baseOption,
    grid: { left: 0, right: 8, top: 8, bottom: 0, containLabel: true },
    tooltip: { ...(baseOption.tooltip as object), valueFormatter: (v) => (typeof v === "number" ? `p = ${formatP(v)}` : "–") },
    xAxis: { type: "category", data: d.growth.map((g) => g.end), axisLabel: { color: palette.text, hideOverlap: true }, axisLine: { lineStyle: { color: palette.axis } } },
    yAxis: {
      type: "log",
      min: 1e-4,
      max: 1,
      inverse: true,
      axisLabel: { color: palette.text, formatter: (v: number) => (v >= 0.01 ? String(v) : v.toExponential(0)) },
      splitLine: { lineStyle: { color: palette.split } },
    },
    series: [
      {
        type: "line",
        data: d.growth.map((g) => Math.max(g.p, 1e-4)),
        showSymbol: false,
        lineStyle: { width: 2, color: palette.series },
        itemStyle: { color: palette.series },
        markLine: { silent: true, symbol: "none", data: [{ yAxis: 0.05 }], lineStyle: { color: palette.trend, type: "dashed" }, label: { formatter: "p = 0.05", color: palette.trend } },
      },
    ],
  };
  return <Chart option={option} height={130} />;
}

// p for every start (rows) and end (columns) year: how much a chosen window changes the answer
function Windows({ d }: { d: Diagnosis }) {
  const n = d.years.length;
  const [hover, setHover] = useState<[number, number] | null>(null);
  const shade = (p: number | null, slope: number | null) => {
    if (p == null || slope == null) return "transparent";
    const strength = Math.min(1, -Math.log10(Math.max(p, 1e-4)) / 3); // p 0.001 and below: full colour
    const [r, g, b] = divergingColor(styleFor(d.key).change, Math.sign(slope) * (0.25 + 0.75 * strength), 1);
    return `rgba(${r | 0},${g | 0},${b | 0},${p < 0.05 ? 1 : 0.35})`;
  };
  const info = hover && d.windows.p[hover[0]][hover[1]] != null
    ? `${d.years[hover[0]]}-${d.years[hover[1]]}: ${formatSigned((d.windows.slope[hover[0]][hover[1]] ?? 0) * 10)} ${d.units} / decade, p = ${formatP(d.windows.p[hover[0]][hover[1]]!)}`
    : "Hover a square: start year down, end year across";
  return (
    <div>
      <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} onMouseLeave={() => setHover(null)}>
        {d.windows.p.map((row, a) =>
          row.map((p, b) => (
            <div
              key={`${a}-${b}`}
              className="aspect-square rounded-[1px]"
              style={{ background: shade(p, d.windows.slope[a][b]) }}
              onMouseEnter={() => setHover([a, b])}
            />
          )),
        )}
      </div>
      <p className="mt-1.5 font-mono text-[10px] tabular-nums text-muted-foreground">{info}</p>
    </div>
  );
}

function Significance({ d }: { d: Diagnosis }) {
  const [open, setOpen] = useState(false);
  const headline = d.significant
    ? `Significant since the record reached ${d.growth.find((_, i) => d.growth.slice(i).every((h) => h.p < 0.05))?.end ?? d.years[d.years.length - 1]}`
    : d.years_needed
      ? `Needs about ${d.years_needed - d.years.length} more ${d.years_needed - d.years.length === 1 ? "year" : "years"} at this rate`
      : "No steady trend to wait for";
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full cursor-pointer items-center justify-between gap-2 text-left">
        <span>
          <Label>When is it significant?</Label>
          <span className="mt-0.5 block text-sm">{headline}</span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">p-value as the record grows (below the line: significant)</p>
            <Growth d={d} />
          </div>
          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">Every start and end year: strong colour where the trend is significant</p>
            <Windows d={d} />
          </div>
        </div>
      )}
    </div>
  );
}

function ScanList({ scan, current }: { scan: Scan; current: string }) {
  const setVariable = useTrendMapStore((s) => s.setVariable);
  const [all, setAll] = useState(false);
  const rows = all ? scan.variables : scan.variables.slice(0, 6);
  const peak = Math.max(...scan.variables.map((r) => Math.abs(r.effect ?? 0)), 1);
  return (
    <div>
      <ul className="space-y-0.5">
        {rows.map((r) => {
          const [cr, cg, cb] = divergingColor(styleFor(r.key).change, Math.sign(r.slope_decade) * 0.85, 1);
          return (
            <li key={r.key}>
              <button
                type="button"
                onClick={() => void setVariable(r.key)}
                className={cn(
                  "grid w-full cursor-pointer grid-cols-[1fr_auto] items-center gap-x-3 rounded-sm px-1.5 py-1 text-left transition-colors hover:bg-accent",
                  r.key === current && "bg-accent/60",
                  !r.significant && "opacity-55",
                )}
                title={`${formatSigned(r.slope_decade)} ${r.units} / decade${r.q != null ? `, q = ${formatP(r.q)}` : ""}${r.jump ? ", looks like a jump" : ""}`}
              >
                <span className="truncate text-sm">
                  {plainName(r.name)} <span className="text-xs text-muted-foreground">{r.name.match(/\(([^)]+)\)/)?.[1]}</span>
                </span>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {formatSigned(r.slope_decade)} {r.units}
                </span>
                <span className="col-span-2 mt-0.5 h-1 rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${(100 * Math.abs(r.effect ?? 0)) / peak}%`, background: `rgb(${cr | 0},${cg | 0},${cb | 0})` }}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          Bar: change per decade over the usual year-to-year scatter{scan.approximate ? " (approximate for a box)" : ""}. Faded: not
          significant (FDR 5%).
        </span>
        {scan.variables.length > 6 && (
          <button type="button" onClick={() => setAll(!all)} className="shrink-0 cursor-pointer font-mono uppercase tracking-[0.06em] hover:text-foreground">
            {all ? "Less" : `All ${scan.variables.length}`}
          </button>
        )}
      </div>
    </div>
  );
}

function Pending({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <LoaderCircle className="size-3 animate-spin" /> working it out
      </p>
    );
  }
  return error ? <p className="text-xs text-warning">{error}</p> : null;
}

// the trust checks, significance and scan for the variable on the map at a place
export default function Insights({ variable, place }: { variable: string; place: InsightPlace }) {
  const key = placeKey(place);
  const diagnosis = useLoad(`${variable}|${key}`, () => api.insightDiagnose(variable, place));
  const scan = useLoad(key, () => api.insightScan(place));
  return (
    <>
      <PanelSection className="space-y-3">
        <Label>Can we trust it?</Label>
        {diagnosis.data ? <TrustChecks d={diagnosis.data} /> : <Pending loading={diagnosis.loading} error={diagnosis.error} />}
      </PanelSection>
      {diagnosis.data && (
        <PanelSection>
          <Significance d={diagnosis.data} />
        </PanelSection>
      )}
      <PanelSection className="space-y-2">
        <Label>Everything changing here</Label>
        {scan.data ? <ScanList scan={scan.data} current={variable} /> : <Pending loading={scan.loading} error={scan.error} />}
      </PanelSection>
    </>
  );
}

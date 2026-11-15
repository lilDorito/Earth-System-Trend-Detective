// the extra sections of the point and region panels: quick analysis and what else changes there

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { api } from "@/api";
import type { Diagnosis, InsightPlace, Scan } from "@/api/types";
import { InfoTip } from "@/components/ui/info-tip";
import { PanelSection } from "@/components/ui/panel";
import { formatP, formatSigned } from "@/lib/format";
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
          Faded: could be chance.{scan.approximate ? " Approximate for a drawn box or several regions." : ""}
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

const source = (name: string) => name.match(/\(([^)]+)\)/)?.[1] ?? "another product";

function Check({ good, title, line, tip }: { good: boolean | null; title: string; line: string; tip: string }) {
  return (
    <li className="flex gap-2.5">
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-semibold",
          good === true && "bg-success/15 text-success",
          good === false && "bg-warning/15 text-warning",
          good === null && "bg-muted text-muted-foreground",
        )}
      >
        {good === true ? "✓" : good === false ? "!" : "·"}
      </span>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm">
          {title} <InfoTip>{tip}</InfoTip>
        </p>
        <p className="text-xs leading-snug text-muted-foreground">{line}</p>
      </div>
    </li>
  );
}

function QuickAnalysis({ d }: { d: Diagnosis }) {
  const per = `${d.units} per decade`;
  const shifted = d.robust.shifted.map((x) => x.slope * 10);
  const since = d.significant ? d.growth.find((_, i) => d.growth.slice(i).every((h) => h.p < 0.05))?.end : null;
  const more = !d.significant && d.years_needed ? d.years_needed - d.years.length : null;
  return (
    <ul className="space-y-2.5">
      <Check
        good={d.significant ? true : more ? null : false}
        title={d.significant ? `Clear since ${since ?? d.years[d.years.length - 1]}` : more && more > 0 ? `Not clear yet: about ${more} more years needed` : "No steady direction"}
        line={d.significant ? "From then on the change is too steady to be chance." : more ? "At this pace the yearly ups and downs still hide it." : "The values go up and down without a clear direction."}
        tip="p is the chance that ordinary ups and downs alone would draw a trend this strong. Below 0.05 (1 in 20) we call the trend clear."
      />
      <Check
        good={!d.jump.likely}
        title={d.jump.likely ? `Looks like one jump around ${d.jump.year}` : "A steady change, not one jump"}
        line={d.jump.likely ? `The values step by ${formatSigned(d.jump.shift)} ${d.units} once. A new satellite or model can do that.` : "The values drift a little every year."}
        tip="We compare a straight line with a single step and keep whichever fits the years better."
      />
      {shifted.length > 0 && (
        <Check
          good={d.robust.stable}
          title={d.robust.stable ? "Same answer from any start year" : "Depends on the start year"}
          line={`Starting 1-${shifted.length} years later gives ${formatSigned(Math.min(...shifted))} to ${formatSigned(Math.max(...shifted))} ${per}.`}
          tip="A real trend should not vanish when the first few years are left out."
        />
      )}
      {d.agreement && (
        <Check
          good={d.agreement.agree}
          title={d.agreement.agree ? "A second dataset agrees" : "A second dataset disagrees"}
          line={`${source(d.agreement.name)}: ${formatSigned(d.agreement.slope_decade)} against ${formatSigned(d.agreement.own_slope_decade)} ${per}.`}
          tip="An independent measurement of the same thing, from a different satellite or model."
        />
      )}
      {d.enso && (
        <Check
          good={d.enso.explained <= 0.2 ? null : false}
          title={`El Niño explains ${Math.round(d.enso.explained * 100)}% of the ups and downs`}
          line={`Without it the trend is ${formatSigned(d.enso.trend_without_enso)} instead of ${formatSigned(d.enso.trend)} ${per}.`}
          tip="El Niño is a warm swing of the Pacific every few years that shifts weather around the world."
        />
      )}
    </ul>
  );
}

export default function Insights({ variable, place }: { variable: string; place: InsightPlace }) {
  const key = placeKey(place);
  const diagnosis = useLoad(`${variable}|${key}`, () => api.insightDiagnose(variable, place));
  const scan = useLoad(key, () => api.insightScan(place));
  return (
    <>
      <PanelSection className="space-y-2.5">
        <div>
          <h3 className="flex items-center gap-1.5 text-base font-semibold">
            Quick analysis <InfoTip>Automatic checks that help you interpret this trend: is it steady, is it clear, what might be behind it.</InfoTip>
          </h3>
          <p className="text-xs text-muted-foreground">How to interpret this trend</p>
        </div>
        {diagnosis.data ? <QuickAnalysis d={diagnosis.data} /> : <Pending loading={diagnosis.loading} error={diagnosis.error} />}
      </PanelSection>
      <PanelSection className="space-y-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-base font-semibold">
            What else is changing here{" "}
            <InfoTip>Every measurement at this place, strongest change first. The bar compares the change with the usual yearly ups and downs.</InfoTip>
          </h3>
          <p className="text-xs text-muted-foreground">Click one to show it on the map.</p>
        </div>
        {scan.data ? <ScanList scan={scan.data} current={variable} /> : <Pending loading={scan.loading} error={scan.error} />}
      </PanelSection>
    </>
  );
}

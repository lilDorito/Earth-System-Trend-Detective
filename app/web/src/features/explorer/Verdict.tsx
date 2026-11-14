// verdict and key numbers

import { Link } from "react-router";
import { motion } from "framer-motion";
import type { AnalysisResult, AnalyzeResponse } from "@/api/types";
import { Label } from "@/components/ui/label";
import { Status } from "@/components/ui/status";
import { formatMonth, formatNumber, formatP, formatSigned } from "@/lib/format";

function headline(result: AnalysisResult) {
  if (result.mode === "trend") return { value: formatSigned(result.slope_per_decade), unit: `${result.units} / decade` };
  if (result.pct_change !== null) return { value: `${formatSigned(result.pct_change, 0)}%`, unit: "after the event" };
  return { value: formatSigned(result.diff), unit: `${result.units} after the event` };
}

function figures(result: AnalysisResult): [string, string][] {
  const range = (lo: number, hi: number) => `${formatNumber(lo)} to ${formatNumber(hi)}`;
  if (result.mode === "trend") {
    return [
      ["95% range", range(result.ci_low, result.ci_high)],
      ["p-value", formatP(result.p_value)],
      ["Total change", `${formatSigned(result.total_change)} ${result.units}`],
      ["Kendall tau", `${result.mk_tau.toFixed(2)} (${result.mk_trend})`],
    ];
  }
  const suffix = result.deseasonalized ? " (anom.)" : "";
  return [
    [`Before${suffix}`, formatNumber(result.before_mean)],
    [`After${suffix}`, formatNumber(result.after_mean)],
    ["95% range of change", range(result.diff_ci_low, result.diff_ci_high)],
    ["p-value", formatP(result.p_value)],
  ];
}

export default function Verdict({ response }: { response: AnalyzeResponse }) {
  const { result, series } = response;
  const { value, unit } = headline(result);

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
      className="border-b px-5 py-5"
    >
      <div className="mb-2 flex items-center justify-between">
        <Label>Result</Label>
        <Status tone={result.significant ? "success" : "muted"}>
          {result.significant ? "significant" : "not significant"}
        </Status>
      </div>

      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-3xl font-medium tracking-tight tabular-nums">{value}</span>
        <span className="text-sm text-muted-foreground">{unit}</span>
      </p>
      <p className="mt-3 text-sm leading-relaxed">{result.verdict}</p>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t pt-4">
        {figures(result).map(([label, text]) => (
          <div key={label}>
            <dt className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 font-mono text-[13px] tabular-nums">{text}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {series.length} months, {formatMonth(series[0].time)} to {formatMonth(series[series.length - 1].time)}
        </span>
        <Link to="/learn#significance" className="underline-offset-2 hover:text-foreground hover:underline">
          What does significant mean?
        </Link>
      </div>
    </motion.section>
  );
}

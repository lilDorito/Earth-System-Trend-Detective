// verdict and key numbers

import { useState } from "react";
import { Link } from "react-router";
import { ChevronDown } from "lucide-react";
import { motion } from "framer-motion";
import type { AnalysisResult, AnalyzeResponse } from "@/api/types";
import { Label } from "@/components/ui/label";
import { Status } from "@/components/ui/status";
import { formatMonth, formatNumber, formatP, formatSigned } from "@/lib/format";
import { PHONE, useMedia } from "@/lib/useMedia";
import { cn } from "@/lib/utils";

// below this share of the area with data, the result describes only part of the place
const COVERAGE_WARNING = 0.9;

function headline(result: AnalysisResult) {
  if (result.mode === "trend")
    return {
      value: formatSigned(result.slope_per_decade),
      unit: `${result.units} / decade`,
    };
  if (result.pct_change !== null)
    return {
      value: `${formatSigned(result.pct_change, 0)}%`,
      unit: "after the event",
    };
  return {
    value: formatSigned(result.diff),
    unit: `${result.units} after the event`,
  };
}

function figures(result: AnalysisResult): [string, string][] {
  const range = (lo: number, hi: number) =>
    `${formatNumber(lo)} to ${formatNumber(hi)}`;
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

// one plain sentence with the size of the change, for the phone, where the statistics are folded away
function plainChange(result: AnalysisResult): string {
  if (result.mode === "trend")
    return `Changed by ${formatSigned(result.total_change)} ${result.units} over the whole period.`;
  const units = result.deseasonalized ? "" : ` ${result.units}`;
  return `On average ${formatNumber(result.before_mean)}${units} before, ${formatNumber(result.after_mean)}${units} after.`;
}

export default function Verdict({ response }: { response: AnalyzeResponse }) {
  const { result, series, meta } = response;
  const { value, unit } = headline(result);
  const phone = useMedia(PHONE);
  const [details, setDetails] = useState(false);

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
          {phone
            ? result.significant
              ? "real change"
              : "no clear change"
            : result.significant
              ? "significant"
              : "not significant"}
        </Status>
      </div>

      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-3xl font-medium tracking-tight tabular-nums">
          {value}
        </span>
        <span className="text-sm text-muted-foreground">{unit}</span>
      </p>
      <p className="mt-3 text-sm leading-relaxed">{phone ? result.verdict.replace(/\s*\(95% CI[^)]*\)/, "") : result.verdict}</p>

      {phone && (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {plainChange(result)}
        </p>
      )}

      {phone && (
        <button
          type="button"
          onClick={() => setDetails((d) => !d)}
          aria-expanded={details}
          className="mt-3 flex cursor-pointer items-center gap-1 text-xs text-muted-foreground"
        >
          {details ? "Hide the statistics" : "Show the statistics"}
          <ChevronDown
            className={cn(
              "size-3.5 transition-transform",
              details && "rotate-180",
            )}
          />
        </button>
      )}

      {(!phone || details) && (
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t pt-4">
          {figures(result).map(([label, text]) => (
            <div key={label}>
              <dt className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                {label}
              </dt>
              <dd className="mt-0.5 font-mono text-[13px] tabular-nums">
                {text}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {meta.coverage != null && meta.coverage < COVERAGE_WARNING && (
        <p className="mt-4 text-xs leading-relaxed text-warning">
          Only {Math.round(meta.coverage * 100)}% of this area has{" "}
          {meta.variable_name.toLowerCase()} data; the average covers that part
          only.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        {phone ? (
          <span>
            {formatMonth(series[0].time)} to{" "}
            {formatMonth(series[series.length - 1].time)}
          </span>
        ) : (
          <span>
            {series.length} months, {formatMonth(series[0].time)} to{" "}
            {formatMonth(series[series.length - 1].time)}
            {meta.cells != null &&
              `, ${meta.cells} grid ${meta.cells === 1 ? "cell" : "cells"}`}
          </span>
        )}
        <Link
          to="/learn#significance"
          className="underline-offset-2 hover:text-foreground hover:underline"
        >
          {phone ? "What does this mean?" : "What does significant mean?"}
        </Link>
      </div>
    </motion.section>
  );
}

// The answer in one glance: verdict, significance badge, key numbers (owner: frontend)
// TODO: framer-motion entrance, "what does significant mean?" popover linking to /learn

import type { AnalysisResult, SeriesMeta } from "@/api/types";
import { cn } from "@/lib/utils";

export default function VerdictCard({ result, meta }: { result: AnalysisResult; meta: SeriesMeta }) {
  return (
    <div className="space-y-2 rounded-lg border border-neutral-800 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{meta.variable_name}{meta.region_name ? `, ${meta.region_name}` : ""}</h3>
        <span
          className={cn(
            "rounded px-2 py-0.5 text-xs font-medium",
            result.significant ? "bg-emerald-900 text-emerald-200" : "bg-neutral-800 text-neutral-300",
          )}
        >
          {result.significant ? "Significant" : "Not significant"}
        </span>
      </div>
      <p className="text-sm">{result.verdict}</p>
      <p className="text-xs text-neutral-500">
        p = {result.p_value.toFixed(3)} · source: {meta.source}
      </p>
    </div>
  );
}

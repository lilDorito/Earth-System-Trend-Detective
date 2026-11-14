// Main screen: globe to pick a place, wizard to pick a variable, chart + verdict for the result

import Globe from "@/features/globe/Globe";
import Wizard from "@/features/wizard/Wizard";
import TimeSeriesChart from "@/features/charts/TimeSeriesChart";
import VerdictCard from "@/features/results/VerdictCard";
import { useAppStore } from "@/store/useAppStore";

export default function ExplorerPage() {
  const response = useAppStore((s) => s.response);
  const error = useAppStore((s) => s.error);

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[1fr_420px]">
      <section className="relative min-h-[400px]">
        <Globe />
      </section>
      <aside className="flex flex-col gap-4 overflow-y-auto border-l border-neutral-800 p-4">
        <Wizard />
        {error && <p className="rounded bg-red-950 p-3 text-sm text-red-200">{error}</p>}
        {response && (
          <>
            <VerdictCard result={response.result} meta={response.meta} />
            <TimeSeriesChart response={response} />
          </>
        )}
      </aside>
    </div>
  );
}

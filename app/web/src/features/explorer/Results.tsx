// result area: placeholder, loading, verdict and chart

import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { WAKING_MESSAGE, useServerStatus } from "@/api/status";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import SeriesChart from "./SeriesChart";
import Verdict from "./Verdict";

export default function Results() {
  const { response, loading, error } = useAppStore(
    useShallow((s) => ({ response: s.response, loading: s.loading, error: s.error })),
  );
  const waking = useServerStatus((st) => st.waking);
  const top = useRef<HTMLDivElement>(null);
  const fetchedAt = response?.meta.fetched_at;

  // on a phone the result lands below the globe and the inputs, so bring it into view
  useEffect(() => {
    if ((fetchedAt || error) && window.matchMedia("(max-width: 1023px)").matches) {
      top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [fetchedAt, error]);

  if (error) {
    return (
      <div ref={top} className="scroll-mt-2 px-5 py-4">
        <Alert>{error}</Alert>
      </div>
    );
  }

  if (response) {
    return (
      <div ref={top} className={cn("scroll-mt-2 transition-opacity", loading && "pointer-events-none opacity-40")}>
        <Verdict key={response.meta.fetched_at} response={response} />
        <SeriesChart key={`chart-${response.meta.fetched_at}`} response={response} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-3 px-5 py-5">
        {waking && <p className="text-xs text-muted-foreground">{WAKING_MESSAGE}.</p>}
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  return (
    <p className="px-5 py-6 text-sm leading-relaxed text-muted-foreground max-sm:hidden">
      No result yet. Pick a place, a variable and a question, then press Investigate.
    </p>
  );
}

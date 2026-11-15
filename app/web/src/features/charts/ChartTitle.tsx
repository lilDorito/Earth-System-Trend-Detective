// the heading over a chart: what it shows in a few words, and how to read it in one line

import type { ReactNode } from "react";
import { InfoTip } from "@/components/ui/info-tip";

export default function ChartTitle({ title, tip, children }: { title: string; tip?: string; children?: ReactNode }) {
  return (
    <div className="mb-2">
      <h3 className="flex items-center gap-1.5 text-lg font-semibold leading-tight">
        {title}
        {tip && <InfoTip>{tip}</InfoTip>}
      </h3>
      {children && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{children}</p>}
    </div>
  );
}

// the big answer at the top of a panel, read as a reply to the site's name

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Verdict } from "./verdict";

export default function VerdictHeadline({ v, children }: { v: Verdict; children?: ReactNode }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 leading-tight">
      <span className={cn("text-2xl font-semibold tracking-tight", v.tone === "bad" ? "text-destructive" : v.tone === "fine" ? "text-success" : "text-foreground")}>
        {v.words}:
      </span>
      <span className="font-mono text-lg tabular-nums">{v.amount}</span>
      {children}
    </p>
  );
}

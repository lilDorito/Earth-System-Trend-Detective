// text input, select and labeled field

import type { ComponentProps, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const control =
  "h-8 w-full min-w-0 rounded-md border border-input bg-background text-sm transition-colors hover:border-foreground/25 focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "px-2.5 font-mono text-[13px] tabular-nums", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <div className={cn("relative", className)}>
      <select className={cn(control, "cursor-pointer appearance-none pl-2.5 pr-8")} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

export function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={cn("grid gap-1", className)}>
      <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

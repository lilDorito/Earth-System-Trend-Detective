// text input and labeled field

import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

const control =
  "h-8 pointer-coarse:h-10 w-full min-w-0 rounded-md border border-input bg-background text-sm transition-colors hover:border-foreground/25 focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "px-2.5 font-mono text-[13px] tabular-nums", className)} {...props} />;
}

export function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={cn("grid gap-1", className)}>
      <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

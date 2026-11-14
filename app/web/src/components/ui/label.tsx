// small uppercase section label

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn("font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground", className)}
      {...props}
    />
  );
}

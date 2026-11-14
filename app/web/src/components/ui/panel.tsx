// flat panel with hairline sections

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Panel({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-lg border bg-card/95 text-card-foreground backdrop-blur", className)} {...props} />;
}

export function PanelSection({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("border-t px-4 py-3 first:border-t-0", className)} {...props} />;
}

// small uppercase status label

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const tones = {
  success: "text-success",
  warning: "text-warning",
  muted: "text-muted-foreground",
};

type StatusProps = ComponentProps<"span"> & { tone?: keyof typeof tones };

export function Status({ tone = "muted", className, children, ...props }: StatusProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.06em]",
        tones[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

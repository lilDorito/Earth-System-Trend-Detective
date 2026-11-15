// segmented control

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Option<T extends string> = { value: T; label: ReactNode };

type SegmentedProps<T extends string> = {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  className?: string;
  size?: "sm" | "default";
};

export function Segmented<T extends string>({ value, options, onChange, className, size = "default" }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" className={cn("inline-flex rounded-md border border-input p-0.5", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex flex-1 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            size === "sm" ? "h-6 px-2 font-mono text-[11px] pointer-coarse:h-9" : "h-7 px-3 text-sm pointer-coarse:h-10",
            option.value === value && "bg-accent text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

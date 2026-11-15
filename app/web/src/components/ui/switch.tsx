// on/off switch

import type { ComponentProps } from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-4 w-7 pointer-coarse:h-6 pointer-coarse:w-10 shrink-0 cursor-pointer items-center rounded-[3px] border border-input p-px transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:border-primary data-[state=checked]:bg-primary/20",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-2.5 rounded-[2px] bg-muted-foreground transition-transform data-[state=checked]:translate-x-3 pointer-coarse:size-[18px] pointer-coarse:data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-primary" />
    </SwitchPrimitive.Root>
  );
}

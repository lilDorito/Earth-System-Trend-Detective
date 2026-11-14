// error message line

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Alert({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div
      role="alert"
      className={cn("border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive", className)}
      {...props}
    >
      {children}
    </div>
  );
}

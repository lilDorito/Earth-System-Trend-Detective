// scrollable page layout and header

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Page({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <div className={cn("mx-auto max-w-4xl px-5 py-10 sm:px-8 sm:py-14", className)}>{children}</div>
    </div>
  );
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="mb-10 max-w-2xl space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      {children && <p className="leading-relaxed text-muted-foreground">{children}</p>}
    </header>
  );
}

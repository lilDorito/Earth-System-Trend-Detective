// numbered sidebar section

import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

type SectionProps = { index: number; title: string; aside?: ReactNode; children: ReactNode };

export default function Section({ index, title, aside, children }: SectionProps) {
  return (
    <section className="border-b px-5 py-4">
      <header className="mb-3 flex min-h-5 items-center justify-between gap-3">
        <Label>
          <span className="text-foreground/40">{String(index).padStart(2, "0")}</span> {title}
        </Label>
        {aside}
      </header>
      {children}
    </section>
  );
}

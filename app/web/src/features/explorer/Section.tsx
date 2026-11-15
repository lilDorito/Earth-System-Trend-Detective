// sidebar section

import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

type SectionProps = { title: string; aside?: ReactNode; children: ReactNode };

export default function Section({ title, aside, children }: SectionProps) {
  return (
    <section className="border-b px-5 py-4">
      <header className="mb-3 flex min-h-5 items-center justify-between gap-3">
        <Label>{title}</Label>
        {aside}
      </header>
      {children}
    </section>
  );
}

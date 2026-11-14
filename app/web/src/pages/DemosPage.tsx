// Guided demo cases from /api/demos (owner: frontend + content)
// TODO: clicking a demo should fill the store and navigate to "/" (or play a step-by-step walkthrough)

import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { Demo } from "@/api/types";

export default function DemosPage() {
  const [demos, setDemos] = useState<Demo[]>([]);

  useEffect(() => {
    api.demos().then(setDemos).catch(() => setDemos([]));
  }, []);

  return (
    <div className="mx-auto grid max-w-4xl gap-4 p-6">
      {demos.map((d) => (
        <article key={d.id} className="rounded-lg border border-neutral-800 p-4">
          <h2 className="font-semibold">{d.title}</h2>
          <p className="text-sm text-neutral-400">{d.story}</p>
        </article>
      ))}
    </div>
  );
}

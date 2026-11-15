// ready-made questions, each opening the trend map on a place and a variable

import { useNavigate } from "react-router";
import { Globe2 } from "lucide-react";
import { usingMockData } from "@/api";
import { MAP_CASES, openCase, type MapCase } from "@/features/trendmap/cases";
import { Page, PageHeader } from "@/components/Page";
import { Button } from "@/components/ui/button";

function CaseRow({ c, onOpen }: { c: MapCase; onOpen: () => void }) {
  return (
    <li className="grid gap-3 py-5 md:grid-cols-[1fr_200px] md:items-center md:gap-8">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{c.title}</h2>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">{c.story}</p>
        <p className="mt-1.5 max-w-xl text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">Look for: </span>
          {c.look}
        </p>
      </div>
      <Button variant="outline" className="h-auto min-h-9 justify-between py-2" onClick={onOpen}>
        Open on the map
        <Globe2 />
      </Button>
    </li>
  );
}

export default function DemosPage() {
  const navigate = useNavigate();
  return (
    <Page>
      <PageHeader title="Demo questions">Real questions about our planet. Each opens the map ready to answer it.</PageHeader>
      {usingMockData ? (
        <p className="text-sm text-muted-foreground">The demos need the real dataset; this build runs on synthetic data.</p>
      ) : (
        <ul className="divide-y border-y">
          {MAP_CASES.map((c) => (
            <CaseRow
              key={c.id}
              c={c}
              onOpen={() => {
                void openCase(c);
                navigate("/");
              }}
            />
          ))}
        </ul>
      )}
    </Page>
  );
}

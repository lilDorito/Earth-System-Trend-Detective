// demo cases page

import { useNavigate } from "react-router";
import { ArrowRight } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import type { Demo } from "@/api/types";
import { Page, PageHeader } from "@/components/Page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { useAppStore } from "@/store/useAppStore";
import { useCatalogStore } from "@/store/useCatalogStore";

function DemoRow({ demo, onOpen }: { demo: Demo; onOpen: (regionKey: string) => void }) {
  const { regions, variables } = useCatalogStore(useShallow((s) => ({ regions: s.regions, variables: s.variables })));
  const variable = variables.find((v) => v.key === demo.variable);
  const places = [demo.region, demo.compare_region].filter((key): key is string => !!key && key in regions);
  const period = `${demo.start.slice(0, 4)} to ${demo.end.slice(0, 4)}`;
  const event = demo.event_date ? `, event on ${formatDate(demo.event_date)}` : "";

  return (
    <li className="grid gap-4 py-6 md:grid-cols-[1fr_220px] md:items-center md:gap-8">
      <div>
        <p className="text-xs text-muted-foreground">
          {variable?.name ?? demo.variable}, {period}
          {event}
        </p>
        <h2 className="mt-1.5 text-lg font-semibold tracking-tight">{demo.title}</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">{demo.story}</p>
      </div>
      <div className="flex flex-col gap-2">
        {places.map((key) => (
          <Button
            key={key}
            variant="outline"
            className="h-auto min-h-9 justify-between py-2 text-left whitespace-normal"
            onClick={() => onOpen(key)}
          >
            {places.length > 1 ? regions[key].name : "Open in explorer"}
            <ArrowRight />
          </Button>
        ))}
      </div>
    </li>
  );
}

export default function DemosPage() {
  const { demos, regions, status } = useCatalogStore(
    useShallow((s) => ({ demos: s.demos, regions: s.regions, status: s.status })),
  );
  const loadDemo = useAppStore((s) => s.loadDemo);
  const navigate = useNavigate();

  const open = (demo: Demo, regionKey: string) => {
    void loadDemo(demo, regions[regionKey]);
    navigate("/");
  };

  return (
    <Page>
      <PageHeader title="Demo cases">
        Ready-made investigations. Opening one fills in the place, variable and question in the explorer and runs it.
      </PageHeader>
      <ul className="divide-y border-y">
        {status !== "ready"
          ? Array.from({ length: 3 }, (_, i) => (
              <li key={i} className="py-6">
                <Skeleton className="h-16 w-full" />
              </li>
            ))
          : demos.map((demo) => <DemoRow key={demo.id} demo={demo} onOpen={(key) => open(demo, key)} />)}
      </ul>
    </Page>
  );
}

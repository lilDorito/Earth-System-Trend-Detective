// explorer inputs, collapsed to a summary once there is a result

import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { formatLatLon } from "@/lib/format";
import { useAppStore } from "@/store/useAppStore";
import { useCatalogStore } from "@/store/useCatalogStore";
import PlaceStep from "./PlaceStep";
import QuestionStep from "./QuestionStep";
import VariableStep from "./VariableStep";

function Summary({ onEdit }: { onEdit: () => void }) {
  const variables = useCatalogStore((s) => s.variables);
  const s = useAppStore(
    useShallow((s) => ({
      location: s.location,
      regionName: s.regionName,
      variableKey: s.variableKey,
      start: s.start,
      end: s.end,
      mode: s.mode,
    })),
  );
  const place =
    s.regionName ?? (s.location?.type === "point" ? formatLatLon(s.location.lat, s.location.lon) : "Custom area");
  const rows: [string, string][] = [
    ["Place", place],
    ["Variable", variables.find((v) => v.key === s.variableKey)?.name ?? "–"],
    ["Period", `${s.start.slice(0, 4)} to ${s.end.slice(0, 4)}`],
    ["Question", s.mode === "trend" ? "Gradual trend" : "Before / after"],
  ];

  return (
    <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
      <dl className="grid min-w-0 grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="font-mono text-[11px] uppercase leading-5 tracking-[0.06em] text-muted-foreground">{label}</dt>
            <dd className="truncate">{value}</dd>
          </div>
        ))}
      </dl>
      <Button variant="outline" size="sm" onClick={onEdit}>
        Edit
      </Button>
    </div>
  );
}

export default function Wizard() {
  const s = useAppStore(
    useShallow((s) => ({
      location: s.location,
      variableKey: s.variableKey,
      start: s.start,
      end: s.end,
      mode: s.mode,
      eventDate: s.eventDate,
      loading: s.loading,
      response: s.response,
      run: s.run,
    })),
  );
  const [editing, setEditing] = useState(!s.response);
  const firstRender = useRef(true);

  useEffect(() => {
    if (s.response) setEditing(false);
  }, [s.response]);

  useEffect(() => {
    if (firstRender.current) firstRender.current = false;
    else setEditing(true);
  }, [s.location]);

  if (!editing && s.response) return <Summary onEdit={() => setEditing(true)} />;

  let problem: string | null = null;
  if (!s.location) problem = "Pick a place first.";
  else if (!s.variableKey) problem = "Choose a variable.";
  else if (!s.start || !s.end || s.start >= s.end) problem = "Start date must be before the end date.";
  else if (s.mode === "event" && !(s.start < s.eventDate && s.eventDate < s.end))
    problem = "Event date must fall inside the period.";

  return (
    <div>
      <PlaceStep />
      <VariableStep />
      <QuestionStep />
      <div className="sticky bottom-0 z-10 flex items-center gap-3 border-b bg-card px-5 py-3">
        <p className="flex-1 text-xs text-muted-foreground">{problem ?? "Ready."}</p>
        <Button disabled={!!problem || s.loading} onClick={() => void s.run()} className="min-w-32">
          {s.loading && <LoaderCircle className="animate-spin" />}
          {s.loading ? "Running" : "Investigate"}
        </Button>
      </div>
    </div>
  );
}

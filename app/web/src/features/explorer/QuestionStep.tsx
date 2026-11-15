// mode, period and seasons

import { useShallow } from "zustand/react/shallow";
import type { Mode } from "@/api/types";
import { Field, Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { useAppStore } from "@/store/useAppStore";
import Section from "./Section";

const modes: { value: Mode; label: string }[] = [
  { value: "trend", label: "Gradual trend" },
  { value: "event", label: "Before / after" },
];

export default function QuestionStep() {
  const s = useAppStore(
    useShallow((s) => ({
      start: s.start,
      end: s.end,
      mode: s.mode,
      eventDate: s.eventDate,
      deseasonalize: s.deseasonalize,
      setPeriod: s.setPeriod,
      setMode: s.setMode,
      setEventDate: s.setEventDate,
      setDeseasonalize: s.setDeseasonalize,
    })),
  );

  return (
    <Section title="Question">
      <div className="space-y-3">
        <Segmented value={s.mode} options={modes} onChange={s.setMode} className="flex w-full" />

        <div className="grid grid-cols-2 gap-2">
          <Field label="From">
            <Input type="date" value={s.start} max={s.end} onChange={(e) => s.setPeriod(e.target.value, s.end)} />
          </Field>
          <Field label="To">
            <Input type="date" value={s.end} min={s.start} onChange={(e) => s.setPeriod(s.start, e.target.value)} />
          </Field>
          {s.mode === "event" && (
            <Field label="Event date" className="col-span-2">
              <Input
                type="date"
                value={s.eventDate}
                min={s.start}
                max={s.end}
                onChange={(e) => s.setEventDate(e.target.value)}
              />
            </Field>
          )}
        </div>

        <label className="flex cursor-pointer items-center justify-between gap-4 text-sm">
          <span>
            Remove seasonal cycle
            <span className="block text-xs text-muted-foreground">compare each month with its usual value</span>
          </span>
          <Switch checked={s.deseasonalize} onCheckedChange={s.setDeseasonalize} />
        </label>
      </div>
    </Section>
  );
}

// mode, period and seasons

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import type { Mode } from "@/api/types";
import { Field, Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { PHONE, useMedia } from "@/lib/useMedia";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import Section from "./Section";

// what each question asks, in a line, for the phone
const modeHints: Record<Mode, string> = {
  trend: "Is it slowly rising or falling over the years?",
  event: "Did it change after a certain date, like a fire or a new law?",
};

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
  // on the phone the dates and the seasonal switch fold under one "Period" row; the defaults suit most questions
  const phone = useMedia(PHONE);
  const [open, setOpen] = useState(false);
  const folded = phone && !open;

  return (
    <Section title="Question">
      <div className="space-y-3">
        <Segmented
          value={s.mode}
          options={modes}
          onChange={s.setMode}
          className="flex w-full"
        />
        {phone && (
          <p className="text-xs text-muted-foreground">{modeHints[s.mode]}</p>
        )}

        {phone && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex w-full cursor-pointer items-center justify-between rounded-md border px-3 py-2.5 text-sm"
          >
            <span className="text-muted-foreground">Period</span>
            <span className="flex items-center gap-1.5">
              {s.start.slice(0, 4)} – {s.end.slice(0, 4)}
              <ChevronDown
                className={cn(
                  "size-4 text-muted-foreground transition-transform",
                  open && "rotate-180",
                )}
              />
            </span>
          </button>
        )}

        <div className="grid grid-cols-2 gap-2">
          {!folded && (
            <>
              <Field label="From">
                <Input
                  type="date"
                  value={s.start}
                  max={s.end}
                  onChange={(e) => s.setPeriod(e.target.value, s.end)}
                />
              </Field>
              <Field label="To">
                <Input
                  type="date"
                  value={s.end}
                  min={s.start}
                  onChange={(e) => s.setPeriod(s.start, e.target.value)}
                />
              </Field>
            </>
          )}
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

        {!folded && (
          <label className="flex cursor-pointer items-center justify-between gap-4 text-sm">
            <span>
              Remove seasonal cycle
              <span className="block text-xs text-muted-foreground">
                compare each month with its usual value
              </span>
            </span>
            <Switch
              checked={s.deseasonalize}
              onCheckedChange={s.setDeseasonalize}
            />
          </label>
        )}
      </div>
    </Section>
  );
}

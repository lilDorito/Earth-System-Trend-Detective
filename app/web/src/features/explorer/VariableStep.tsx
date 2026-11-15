// variable picker, grouped into atmosphere, land and ocean

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import type { VariableInfo } from "@/api/types";
import { Dropdown } from "@/components/ui/dropdown";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import { useCatalogStore } from "@/store/useCatalogStore";
import Section from "./Section";

const GROUPS: [VariableInfo["group"], string][] = [
  ["atmosphere", "Atmosphere"],
  ["land", "Land"],
  ["ocean", "Ocean"],
];

export default function VariableStep() {
  const { variables, regionTypes } = useCatalogStore(
    useShallow((s) => ({ variables: s.variables, regionTypes: s.regionTypes })),
  );
  const { variableKey, regionType, setVariable, setRegionType } = useAppStore(
    useShallow((s) => ({
      variableKey: s.variableKey,
      regionType: s.regionType,
      setVariable: s.setVariable,
      setRegionType: s.setRegionType,
    })),
  );

  const suggested = (regionType && regionTypes[regionType]?.suggest) || [];
  const selected = variables.find((v) => v.key === variableKey);
  // groups the reader opened or closed; the rest open when they hold the pick the page opened with or a
  // suggestion. Picking a variable never collapses a group, so the list does not jump under the finger
  const [toggled, setToggled] = useState<Partial<Record<VariableInfo["group"], boolean>>>({});
  const [initialKey] = useState(variableKey);
  const startsWithPick = variables.some((v) => v.key === initialKey);
  const isOpen = (group: VariableInfo["group"], items: VariableInfo[]) =>
    toggled[group] ??
    (items.some((v) => v.key === initialKey || suggested.includes(v.key)) ||
      (!startsWithPick && !suggested.length && group === "atmosphere"));

  const typePicker = (
    <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
      suggest for
      <Dropdown
        variant="inline"
        align="right"
        value={regionType ?? ""}
        onChange={(value) => setRegionType(value || null)}
        items={[
          { value: "", label: "any place" },
          ...Object.entries(regionTypes).map(([key, type]) => ({ value: key, label: type.label.toLowerCase() })),
        ]}
        aria-label="Suggest variables for"
      />
    </label>
  );

  return (
    <Section title="Variable" aside={typePicker}>
      <div role="radiogroup" aria-label="Variable" className="divide-y rounded-md border">
        {variables.length === 0
          ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="m-2 h-5" />)
          : GROUPS.map(([group, label]) => {
              const items = variables.filter((v) => (v.group ?? "atmosphere") === group);
              if (!items.length) return null;
              const open = isOpen(group, items);
              const fits = items.filter((v) => suggested.includes(v.key)).length;
              return (
                <div key={group} className="divide-y">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setToggled((t) => ({ ...t, [group]: !open }))}
                    className="flex w-full cursor-pointer items-center gap-2 bg-muted/40 px-3 py-1.5 text-left font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:py-2.5"
                  >
                    <span className="flex-1">
                      {label} <span className="text-foreground/40">{items.length}</span>
                    </span>
                    {!open && fits > 0 && <span className="text-[10px] text-primary">{fits} fit</span>}
                    {!open && items.some((v) => v.key === variableKey) && (
                      <span className="max-w-40 truncate normal-case tracking-normal text-foreground">{selected?.name}</span>
                    )}
                    <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-180")} />
                  </button>
                  {open && items.map((v) => {
              const active = v.key === variableKey;
              return (
                <button
                  key={v.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setVariable(v.key)}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none",
                    active && "bg-accent/60",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-3 shrink-0 place-items-center rounded-full border border-input",
                      active && "border-primary",
                    )}
                  >
                    {active && <span className="size-1.5 rounded-full bg-primary" />}
                  </span>
                  <span className="flex-1 truncate">{v.name}</span>
                  {suggested.includes(v.key) && <span className="font-mono text-[10px] uppercase text-primary">fits</span>}
                  <span className="font-mono text-[11px] text-muted-foreground">{v.units}</span>
                </button>
              );
            })}
                </div>
              );
            })}
      </div>
      {selected && (
        <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
          {selected.short_definition}{" "}
          <span className="font-mono text-[11px] text-foreground/50">
            since {selected.coverage_start.slice(0, 4)}
            {selected.coverage_end && ` to ${selected.coverage_end.slice(0, 4)}`}
            {selected.land_only && ", land only"}
            {selected.group === "ocean" && ", ocean only"}
          </span>
        </p>
      )}
    </Section>
  );
}

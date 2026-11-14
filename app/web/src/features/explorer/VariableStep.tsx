// step 2: variable picker

import { useShallow } from "zustand/react/shallow";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import { useCatalogStore } from "@/store/useCatalogStore";
import Section from "./Section";

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

  const typePicker = (
    <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
      suggest for
      <select
        value={regionType ?? ""}
        onChange={(e) => setRegionType(e.target.value || null)}
        className="field-sizing-content cursor-pointer appearance-none border-b border-dashed border-foreground/30 bg-transparent text-foreground hover:border-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <option value="">any place</option>
        {Object.entries(regionTypes).map(([key, type]) => (
          <option key={key} value={key}>
            {type.label.toLowerCase()}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Section index={2} title="Variable" aside={typePicker}>
      <div role="radiogroup" aria-label="Variable" className="divide-y rounded-md border">
        {variables.length === 0
          ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="m-2 h-5" />)
          : variables.map((v) => {
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
      {selected && (
        <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
          {selected.short_definition}{" "}
          <span className="font-mono text-[11px] text-foreground/50">
            since {selected.coverage_start.slice(0, 4)}
            {selected.land_only && ", land only"}
          </span>
        </p>
      )}
    </Section>
  );
}

// Guided flow (owner: frontend + content)
// TODO: steps "what kind of place?" (/api/region-types) -> suggested variables -> period -> trend or event
// TODO: replace native inputs with shadcn/ui (npx shadcn@latest add select button card ...)

import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { VariableInfo } from "@/api/types";
import { useAppStore } from "@/store/useAppStore";

export default function Wizard() {
  const [variables, setVariables] = useState<VariableInfo[]>([]);
  const { variableKey, location, loading, setVariable, run } = useAppStore();

  useEffect(() => {
    api.variables().then(setVariables).catch(() => setVariables([]));
  }, []);

  const selected = variables.find((v) => v.key === variableKey);

  return (
    <div className="space-y-3">
      <select
        className="w-full rounded border border-neutral-700 bg-neutral-900 p-2"
        value={variableKey ?? ""}
        onChange={(e) => setVariable(e.target.value)}
      >
        <option value="" disabled>Pick a variable</option>
        {variables.map((v) => (
          <option key={v.key} value={v.key}>{v.name}</option>
        ))}
      </select>
      {selected && <p className="text-sm text-neutral-400">{selected.short_definition}</p>}
      <p className="text-sm text-neutral-400">
        {location?.type === "point"
          ? `Location: ${location.lat}, ${location.lon}`
          : "Click the globe to pick a place"}
      </p>
      <button
        className="w-full rounded bg-orange-600 p-2 font-medium disabled:opacity-40"
        disabled={!variableKey || !location || loading}
        onClick={run}
      >
        {loading ? "Investigating..." : "Investigate"}
      </button>
    </div>
  );
}

// search box for Natural Earth countries and admin-1 regions

import { useEffect, useId, useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { Boundary } from "@/api/types";
import { Input } from "@/components/ui/input";
import { loadBoundaries, searchBoundaries } from "@/features/globe/boundaries";
import { cn } from "@/lib/utils";

const detail = (b: Boundary) => (b.kind === "country" ? "Country" : `${b.type || "Region"} · ${b.countryName}`);

export default function RegionSearch({ onPick, placeholder = "Search a country or region", className }: {
  onPick: (boundary: Boundary) => void;
  placeholder?: string;
  className?: string;
}) {
  const [all, setAll] = useState<Boundary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();

  const load = () => {
    if (all || error) return;
    loadBoundaries().then(setAll, (e: Error) => setError(e.message));
  };
  const results = useMemo(() => (all ? searchBoundaries(all, query) : []), [all, query]);
  useEffect(() => setActive(0), [query]);

  const pick = (b: Boundary) => {
    onPick(b);
    setQuery("");
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (results.length ? (i + step + results.length) % results.length : 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      pick(results[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const showList = open && query.trim() !== "";
  let status: string | null = null;
  if (error) status = error;
  else if (!all) status = "Loading regions";
  else if (!results.length) status = "No match";

  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          load();
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={placeholder}
        className="pl-8 font-sans text-sm"
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-md border bg-popover py-1 text-popover-foreground shadow-lg shadow-black/40"
        >
          {status ? (
            <li className="px-2.5 py-1.5 text-xs text-muted-foreground">{status}</li>
          ) : (
            results.map((b, i) => (
              <li
                key={b.id}
                role="option"
                aria-selected={i === active}
                // mousedown, so the pick lands before the input blurs and closes the list
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(b);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn("flex cursor-pointer items-baseline justify-between gap-3 px-2.5 py-1.5", i === active && "bg-accent")}
              >
                <span className="truncate text-sm">{b.name}</span>
                <span className="shrink-0 truncate font-mono text-[10px] text-muted-foreground">{detail(b)}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

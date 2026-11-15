// step 1: place picker

import { X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import RegionSearch from "@/components/RegionSearch";
import { Dropdown } from "@/components/ui/dropdown";
import { formatLatLon, formatLocation } from "@/lib/format";
import { useAppStore } from "@/store/useAppStore";
import { useCatalogStore } from "@/store/useCatalogStore";
import Section from "./Section";

export default function PlaceStep() {
  const regions = useCatalogStore((s) => s.regions);
  const { location, regionName, boundaries, pickRegion, pickBoundary, removeBoundary } = useAppStore(
    useShallow((s) => ({
      location: s.location,
      regionName: s.regionName,
      boundaries: s.boundaries,
      pickRegion: s.pickRegion,
      pickBoundary: s.pickBoundary,
      removeBoundary: s.removeBoundary,
    })),
  );

  const selectedKey = Object.keys(regions).find((key) => regions[key].name === regionName);
  const value = selectedKey ?? (location ? "custom" : "");
  const coords =
    location?.type === "point"
      ? formatLatLon(location.lat, location.lon)
      : location?.type === "regions"
        ? `${location.ids.length} regions, one average`
        : location
          ? "area average"
          : null;
  const custom = location?.type === "bbox" && !selectedKey ? formatLocation(location) : null;

  return (
    <Section
      index={1}
      title="Place"
      aside={coords && <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{coords}</span>}
    >
      <RegionSearch onPick={pickBoundary} className="mb-2" />
      <Dropdown
        value={value}
        onChange={(key) => pickRegion(regions[key])}
        placeholder="Click the globe or choose a place"
        label={value === "custom" ? (regionName ?? custom ?? "Point on the globe") : undefined}
        items={Object.entries(regions).map(([key, region]) => ({ value: key, label: region.name, group: "Places" }))}
        aria-label="Place"
      />
      {boundaries.length > 1 && (
        // regions picked in "Several" mode on the globe; each can be taken out again
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {boundaries.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => removeBoundary(b.id)}
                title={`Remove ${b.name}`}
                className="inline-flex cursor-pointer items-center gap-1 rounded-sm border bg-accent/40 py-1 pl-2 pr-1.5 text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {b.name}
                <X className="size-3 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

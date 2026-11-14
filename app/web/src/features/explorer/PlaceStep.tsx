// step 1: place picker

import { useShallow } from "zustand/react/shallow";
import { Select } from "@/components/ui/input";
import { formatLatLon } from "@/lib/format";
import { useAppStore } from "@/store/useAppStore";
import { useCatalogStore } from "@/store/useCatalogStore";
import Section from "./Section";

export default function PlaceStep() {
  const regions = useCatalogStore((s) => s.regions);
  const { location, regionName, pickRegion } = useAppStore(
    useShallow((s) => ({ location: s.location, regionName: s.regionName, pickRegion: s.pickRegion })),
  );

  const selectedKey = Object.keys(regions).find((key) => regions[key].name === regionName);
  const value = selectedKey ?? (location ? "custom" : "");
  const coords =
    location?.type === "point" ? formatLatLon(location.lat, location.lon) : location ? "area average" : null;

  return (
    <Section
      index={1}
      title="Place"
      aside={coords && <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{coords}</span>}
    >
      <Select value={value} onChange={(e) => pickRegion(regions[e.target.value])} aria-label="Place">
        <option value="" disabled>
          Click the globe or choose a place
        </option>
        {value === "custom" && (
          <option value="custom" disabled>
            {regionName ?? "Point on the globe"}
          </option>
        )}
        {Object.entries(regions).map(([key, region]) => (
          <option key={key} value={key}>
            {region.name}
          </option>
        ))}
      </Select>
    </Section>
  );
}

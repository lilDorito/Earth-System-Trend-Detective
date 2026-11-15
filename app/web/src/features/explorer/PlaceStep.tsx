// step 1: place picker

import { useShallow } from "zustand/react/shallow";
import RegionSearch from "@/components/RegionSearch";
import { Dropdown } from "@/components/ui/dropdown";
import { formatLatLon, formatLocation } from "@/lib/format";
import { useAppStore } from "@/store/useAppStore";
import { useCatalogStore } from "@/store/useCatalogStore";
import Section from "./Section";

export default function PlaceStep() {
  const regions = useCatalogStore((s) => s.regions);
  const { location, regionName, pickRegion, pickBoundary } = useAppStore(
    useShallow((s) => ({ location: s.location, regionName: s.regionName, pickRegion: s.pickRegion, pickBoundary: s.pickBoundary })),
  );

  const selectedKey = Object.keys(regions).find((key) => regions[key].name === regionName);
  const value = selectedKey ?? (location ? "custom" : "");
  const coords =
    location?.type === "point" ? formatLatLon(location.lat, location.lon) : location ? "area average" : null;
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
    </Section>
  );
}

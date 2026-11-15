// a weather station against the grid cell it sits in

import { useEffect } from "react";
import { motion } from "framer-motion";
import { LoaderCircle, X } from "lucide-react";
import type { StationCompare } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Panel, PanelSection } from "@/components/ui/panel";
import { Status } from "@/components/ui/status";
import { palette } from "@/features/charts/Chart";
import StationChart from "@/features/stations/StationChart";
import ChartTitle from "@/features/charts/ChartTitle";
import { InfoTip } from "@/components/ui/info-tip";
import { formatLatLon, formatP, formatSigned } from "@/lib/format";
import { useTrendMapStore } from "@/store/useTrendMapStore";

const GRID_COLOR = "#d9b45a";

function Stat({ label, value, units, tip }: { label: string; value: string; units?: string; tip: string }) {
  return (
    <div>
      <Label className="flex items-center gap-1">
        {label} <InfoTip>{tip}</InfoTip>
      </Label>
      <p className="font-mono text-[13px] tabular-nums">
        {value} {units && <span className="text-muted-foreground">{units}</span>}
      </p>
    </div>
  );
}

export default function StationPanel({ station, loading }: { station: StationCompare; loading: boolean }) {
  const clearStation = useTrendMapStore((s) => s.clearStation);
  const st = station.station_trend;
  const grid = station.grid;
  const units = station.units;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && clearStation();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearStation]);

  return (
    <motion.aside
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="w-full"
    >
      <Panel>
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <div className="min-w-0">
            <Label>Weather station · {station.element_name.toLowerCase()}</Label>
            <p className="truncate text-sm font-semibold">{station.name}</p>
            <p className="font-mono text-xs tabular-nums text-muted-foreground">
              {formatLatLon(station.lat, station.lon)}
              {station.elevation !== null && ` · ${station.elevation} m`}
            </p>
          </div>
          <div className="-mr-1.5 flex items-center gap-1">
            {loading && <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />}
            <Button variant="ghost" size="icon" onClick={clearStation} aria-label="Close">
              <X />
            </Button>
          </div>
        </div>

        <PanelSection className="space-y-2">
          {st ? (
            <>
              <p className="flex items-baseline gap-2">
                <span className="font-mono text-2xl font-medium tabular-nums">{formatSigned(st.slope_decade)}</span>
                <span className="text-sm text-muted-foreground">{units} / decade at the station</span>
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {st.significant && (
                  <span title={`Mann-Kendall p ${st.p < 0.001 ? "" : "= "}${formatP(st.p)}`}>
                    <Status tone="success">statistically significant</Status>
                  </span>
                )}
                <Status tone="muted">{st.n_years} years of data</Status>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Fewer than {station.min_years} years with data: no trend is computed for this station.
            </p>
          )}
        </PanelSection>

        {grid && (
          <PanelSection className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Stat label="Satellite data" tip="The trend of the grid cell around the station, over the same years. The data come as a map of squares about 110 km across, one degree of latitude by one of longitude. Each square is a grid cell, with one value per year." value={grid.trend ? formatSigned(grid.trend.slope_decade) : "–"} units={`${units}/dec`} />
            <Stat
              label="Difference"
              tip="Station trend minus satellite trend. Near zero: they agree."
              value={grid.difference_decade !== undefined ? formatSigned(grid.difference_decade) : "–"}
              units={`${units}/dec`}
            />
            <Stat label="Match" tip="How closely the two go up and down together, from 0 (not at all) to 1 (perfectly)." value={grid.r !== null ? grid.r.toFixed(2) : "–"} units={`${grid.common_years} yrs`} />
            <Stat label="Distance" tip="From the station to the centre of its grid cell, the 110 km square it sits in." value={`${grid.distance_km} km`} units="away" />
            <p className="col-span-2 text-[11px] leading-snug text-muted-foreground">
              {grid.name}, cell {formatLatLon(grid.lat, grid.lon)}.
            </p>
          </PanelSection>
        )}

        <PanelSection>
          <ChartTitle title="Station against satellite data" tip="The data come as a map of squares about 110 km across, one degree of latitude by one of longitude. Each square is a grid cell, with one value per year. Both lines show the difference from their own average, so they can be compared.">
            How much each year was above or below normal ({units}), on the ground and in the 110 km square around the station.
          </ChartTitle>
          <StationChart
            years={station.years}
            units={units}
            height={window.matchMedia("(max-width: 639px)").matches ? 160 : 200}
            lines={[
              { name: "Station", values: station.station, fitted: st?.fitted, color: palette.series },
              ...(grid ? [{ name: "Satellite (grid cell)", values: grid.values, fitted: grid.trend?.fitted, color: GRID_COLOR }] : []),
            ]}
          />
        </PanelSection>
      </Panel>
    </motion.aside>
  );
}

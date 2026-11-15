// station measurements and the grid variables each one is compared with

import type { StationElementKey } from "@/api/types";

export const STATION_ELEMENTS: Record<StationElementKey, { name: string; short: string; units: string; grid: string[] }> = {
  TAVG: { name: "Mean air temperature", short: "Temp", units: "°C", grid: ["merra2_t2m", "gldas_tair"] },
  PRCP: { name: "Precipitation", short: "Rain", units: "mm/month", grid: ["imerg_precip", "gldas_precip"] },
  AWND: { name: "Mean wind speed", short: "Wind", units: "m/s", grid: ["merra2_wind10m", "gldas_wind"] },
};

export const ELEMENT_KEYS = Object.keys(STATION_ELEMENTS) as StationElementKey[];

export function elementFor(variable: string): StationElementKey | null {
  return ELEMENT_KEYS.find((key) => STATION_ELEMENTS[key].grid.includes(variable)) ?? null;
}

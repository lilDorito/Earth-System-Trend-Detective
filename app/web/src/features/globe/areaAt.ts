// the area a click picks, by zoom: far out a country or a sea/ocean, close in the region (oblast, state,
// province) of the country under the click. Falls back to the country where it has no regions.

import type { Boundary } from "@/api/types";
import { adminAt, countryAt } from "./countryAt";
import { seaAt } from "./seas";

/** camera distance below which regions of a country are picked (and their borders drawn) */
export const ADMIN_ZOOM = 1.7;

type Options = {
  zoomed: boolean;
  ocean?: boolean; // ocean variables look at the water first
  seas?: boolean; // false: land only (default true)
};

export async function areaAt(lat: number, lon: number, { zoomed, ocean = false, seas = true }: Options): Promise<Boundary | null> {
  const land = async () => {
    const country = await countryAt(lat, lon);
    if (!country) return null;
    return zoomed ? ((await adminAt(country, lat, lon)) ?? country) : country;
  };
  const water = () => (seas ? seaAt(lat, lon).catch(() => null) : Promise.resolve(null));
  return ocean ? ((await water()) ?? (await land())) : ((await land()) ?? (await water()));
}

// preset regions for the trend map analytics (south, north, west, east)

export const REGIONS = {
  ukraine: { label: "Ukraine", bbox: [44, 53, 22, 41] },
  europe: { label: "Europe", bbox: [35, 72, -10, 40] },
  arctic: { label: "Arctic (north of 66.5°N)", bbox: [66.5, 90, -180, 180] },
  tropics: { label: "Tropics (23.5°S to 23.5°N)", bbox: [-23.5, 23.5, -180, 180] },
  usa: { label: "Contiguous USA", bbox: [25, 49.5, -125, -66.5] },
} as const;

export type RegionName = keyof typeof REGIONS;

export const REGION_NAMES = Object.keys(REGIONS) as RegionName[];
export const shortRegionLabel = (name: RegionName) => REGIONS[name].label.split(" (")[0];

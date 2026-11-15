// number, date and coordinate formatting

import type { Location } from "@/api/types";

export function formatNumber(value: number, digits = 2): string {
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e5 || abs < 1e-3)) return value.toExponential(1).replace("e+", "e");
  return value.toFixed(digits);
}

export function formatAxis(value: number): string {
  if (value === 0) return "0";
  if (Math.abs(value) >= 1e5) return value.toExponential(1).replace("e+", "e");
  return String(Number(value.toFixed(2)));
}

export function formatSigned(value: number, digits = 2): string {
  const text = formatNumber(value, digits);
  return value > 0 ? `+${text}` : text.replace("-", "−");
}

// fewest decimals that show `value` exactly (up to 4), e.g. 1.25 -> 2, 0.5 -> 1, 10 -> 0
export function digitsFor(value: number): number {
  for (let digits = 0; digits < 4; digits++) {
    if (Math.abs(Math.round(value * 10 ** digits) - value * 10 ** digits) < 1e-6) return digits;
  }
  return 4;
}

export function formatP(p: number): string {
  return p < 0.001 ? "< 0.001" : p.toFixed(3);
}

export function formatCoord(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(1)}° ${value >= 0 ? positive : negative}`;
}

export function formatLatLon(lat: number, lon: number): string {
  return `${formatCoord(lat, "N", "S")}, ${formatCoord(lon, "E", "W")}`;
}

export function formatLocation(location: Location): string {
  if (location.type === "point") return formatLatLon(location.lat, location.lon);
  if (location.type === "region") return location.id;
  if (location.type === "regions") return `${location.ids.length} regions`;
  return `${formatLatLon(location.south, location.west)} to ${formatLatLon(location.north, location.east)}`;
}

// null for regions: their centre lives in the boundary index, not in the location
export function locationCenter(location: Location): { lat: number; lon: number } | null {
  if (location.type === "point") return { lat: location.lat, lon: location.lon };
  if (location.type === "region" || location.type === "regions") return null;
  // west > east is a box across 180 degrees
  const width = (location.east - location.west + 360) % 360;
  return { lat: (location.south + location.north) / 2, lon: ((location.west + width / 2 + 540) % 360) - 180 };
}

export function formatMonth(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

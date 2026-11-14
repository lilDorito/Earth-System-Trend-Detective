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
  return `${formatLatLon(location.south, location.west)} to ${formatLatLon(location.north, location.east)}`;
}

export function locationCenter(location: Location): { lat: number; lon: number } {
  if (location.type === "point") return { lat: location.lat, lon: location.lon };
  return { lat: (location.south + location.north) / 2, lon: (location.west + location.east) / 2 };
}

export function formatMonth(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

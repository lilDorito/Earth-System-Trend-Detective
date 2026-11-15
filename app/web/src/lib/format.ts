// number, date and coordinate formatting

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


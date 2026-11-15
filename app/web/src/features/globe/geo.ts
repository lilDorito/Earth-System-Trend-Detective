// lat/lon <-> sphere point

import { Vector3 } from "three";

const DEG = Math.PI / 180;

export function vectorToLatLon(v: Vector3): { lat: number; lon: number } {
  const n = v.clone().normalize();
  const lat = 90 - Math.acos(n.y) / DEG;
  const lon = Math.atan2(n.z, -n.x) / DEG - 180;
  return { lat, lon: ((lon + 540) % 360) - 180 };
}

export function latLonToVector(lat: number, lon: number, radius = 1): Vector3 {
  const phi = (90 - lat) * DEG;
  const theta = (lon + 180) * DEG;
  return new Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

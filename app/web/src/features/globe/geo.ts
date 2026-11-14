// Sphere point <-> lat/lon. Same convention both ways so markers land where the user clicked.

import { Vector3 } from "three";

export function vectorToLatLon(v: Vector3): { lat: number; lon: number } {
  const n = v.clone().normalize();
  const lat = 90 - (Math.acos(n.y) * 180) / Math.PI;
  const lon = ((Math.atan2(n.z, -n.x) * 180) / Math.PI) - 180;
  return { lat, lon: ((lon + 540) % 360) - 180 };
}

export function latLonToVector(lat: number, lon: number, radius = 1): Vector3 {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return new Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

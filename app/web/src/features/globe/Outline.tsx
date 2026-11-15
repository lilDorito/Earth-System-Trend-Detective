// outline of the selected area: an amber line over a dark halo, readable on any overlay

import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { Ring } from "./boundaries";
import { latLonToVector } from "./geo";

const RADIUS = 1.0009;
const MAX_STEP_DEG = 0.5;
const AMBER = 0xfbbf24;

export function toSegments(rings: Ring[]): Float32Array {
  const out: number[] = [];
  const push = (lon: number, lat: number) => {
    const v = latLonToVector(lat, lon, RADIUS);
    out.push(v.x, v.y, v.z);
  };
  for (const ring of rings) {
    for (let i = 2; i < ring.length; i += 2) {
      const [lon0, lat0, lon1, lat1] = [ring[i - 2], ring[i - 1], ring[i], ring[i + 1]];
      // polygons are cut at 180 degrees; that cut is not a border
      if (Math.abs(lon0) > 179.99 && Math.abs(lon1) > 179.99 && lon0 * lon1 > 0) continue;
      // fat lines draw a zero-length segment as a spike in a random direction
      if (lon0 === lon1 && lat0 === lat1) continue;
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(lon1 - lon0), Math.abs(lat1 - lat0)) / MAX_STEP_DEG));
      for (let k = 0; k < steps; k++) {
        push(lon0 + ((lon1 - lon0) * k) / steps, lat0 + ((lat1 - lat0) * k) / steps);
        push(lon0 + ((lon1 - lon0) * (k + 1)) / steps, lat0 + ((lat1 - lat0) * (k + 1)) / steps);
      }
    }
  }
  return new Float32Array(out);
}

export default function Outline({ rings, dashed = false, color = AMBER, width = 2, halo = true, opacity = 1 }: {
  rings: Ring[];
  dashed?: boolean;
  color?: number;
  width?: number;
  halo?: boolean;
  opacity?: number; // 0 to 1, for fading the line in and out
}) {
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const geometry = useMemo(() => new LineSegmentsGeometry().setPositions(toSegments(rings)), [rings]);
  const [under, line] = useMemo(() => {
    const haloMaterial = new LineMaterial({ color: 0x000000, linewidth: width + 2, transparent: true, opacity: halo ? 0.55 : 0, depthWrite: false });
    const lineMaterial = new LineMaterial({
      color,
      linewidth: width,
      transparent: true,
      depthWrite: false,
      dashed,
      dashSize: 0.01,
      gapSize: 0.008,
    });
    const make = (material: LineMaterial, order: number) => {
      const object = new LineSegments2(geometry, material);
      if (dashed) object.computeLineDistances();
      object.renderOrder = order;
      return object;
    };
    return [make(haloMaterial, 2), make(lineMaterial, 3)];
  }, [geometry, dashed, color, width, halo]);

  useEffect(() => {
    for (const object of [under, line]) object.material.resolution.set(size.width, size.height);
    invalidate();
  }, [under, line, size, invalidate]);

  useEffect(() => {
    under.material.opacity = halo ? 0.55 * opacity : 0;
    line.material.opacity = opacity;
    invalidate();
  }, [under, line, opacity, halo, invalidate]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(
    () => () => {
      under.material.dispose();
      line.material.dispose();
    },
    [under, line],
  );

  return (
    <>
      <primitive object={under} />
      <primitive object={line} />
    </>
  );
}

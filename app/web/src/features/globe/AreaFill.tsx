// translucent fill over an area, painted into a canvas laid on the globe as a patch of sphere

import { useEffect, useMemo } from "react";
import { CanvasTexture, SphereGeometry } from "three";
import type { Ring } from "./boundaries";

const DEG = Math.PI / 180;
const PX_PER_DEG = 10;
const MAX_SIDE = 2048;
const MIN_SIDE = 64;

type Patch = { geometry: SphereGeometry; texture: CanvasTexture };

function buildPatch(rings: Ring[]): Patch | null {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 2) {
      west = Math.min(west, ring[i]);
      east = Math.max(east, ring[i]);
      south = Math.min(south, ring[i + 1]);
      north = Math.max(north, ring[i + 1]);
    }
  }
  const span = east - west;
  const height = north - south;
  if (!(span > 0) || !(height > 0)) return null;

  const width = Math.min(MAX_SIDE, Math.max(MIN_SIDE, Math.round(span * PX_PER_DEG)));
  const tall = Math.min(MAX_SIDE, Math.max(MIN_SIDE, Math.round(height * PX_PER_DEG)));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = tall;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  for (const ring of rings) {
    if (ring.length < 6) continue; // a line, not an area
    for (let i = 0; i < ring.length; i += 2) {
      const x = ((ring[i] - west) / span) * width;
      const y = ((north - ring[i + 1]) / height) * tall;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  // even-odd, so holes (lakes, enclaves) stay clear
  ctx.fill("evenodd");

  // half a degree per facet: a flat facet sags below the sphere in its middle, and a coarser one dips
  // under the detail tiles (radius 1.0003), which then cover the fill in a diamond pattern
  const segments = (deg: number, max: number) => Math.min(max, Math.max(4, Math.ceil(deg * 2)));
  const geometry = new SphereGeometry(
    1,
    segments(span, 360),
    segments(height, 180),
    (west + 180) * DEG,
    span * DEG,
    (90 - north) * DEG,
    height * DEG,
  );
  return { geometry, texture: new CanvasTexture(canvas) };
}

export default function AreaFill({ rings, color, opacity, radius = 1.0004 }: {
  rings: Ring[];
  color: number | string;
  opacity: number;
  radius?: number;
}) {
  const patch = useMemo(() => buildPatch(rings), [rings]);
  useEffect(
    () => () => {
      patch?.geometry.dispose();
      patch?.texture.dispose();
    },
    [patch],
  );
  if (!patch) return null;
  return (
    <mesh geometry={patch.geometry} scale={radius} raycast={() => null} renderOrder={1}>
      <meshBasicMaterial map={patch.texture} color={color} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

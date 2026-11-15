// high-resolution land mask (Natural Earth 1:50m), 1 on land and 0 at sea, in the same
// longitude/latitude layout as the Earth texture; cuts ocean-only fields at the real coastline
// instead of at the edge of their coarse grid cells

import { geoEquirectangular, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { CanvasTexture, LinearFilter, RepeatWrapping, ClampToEdgeWrapping, type Texture } from "three";

const WIDTH = 8192;

let cached: Promise<Texture> | null = null;

export function loadLandMask(): Promise<Texture> {
  cached ??= import("world-atlas/land-50m.json").then(({ default: source }) => {
    const topology = source as unknown as Topology<{ land: GeometryCollection }>;
    const land = feature(topology, topology.objects.land);
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = WIDTH / 2;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const projection = geoEquirectangular()
      .scale(WIDTH / (2 * Math.PI))
      .translate([WIDTH / 2, WIDTH / 4])
      .precision(0.1);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    geoPath(projection, ctx)(land);
    ctx.fill();
    const texture = new CanvasTexture(canvas);
    texture.generateMipmaps = false;
    texture.minFilter = texture.magFilter = LinearFilter;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return texture;
  });
  return cached;
}

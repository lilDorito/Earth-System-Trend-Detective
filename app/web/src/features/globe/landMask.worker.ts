// rasterises the Natural Earth 1:50m land polygons off the main thread: one byte per pixel, 255 on land

import { geoEquirectangular, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";

self.onmessage = async (e: MessageEvent<{ width: number }>) => {
  const { width } = e.data;
  const height = width / 2;
  const { default: source } = await import("world-atlas/land-50m.json");
  const topology = source as unknown as Topology<{ land: GeometryCollection }>;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  // rows top to bottom are north to south here; the texture wants south first, so flip while drawing
  ctx.translate(0, height);
  ctx.scale(1, -1);
  const projection = geoEquirectangular()
    .scale(width / (2 * Math.PI))
    .translate([width / 2, height / 2])
    .precision(0.2);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  geoPath(projection, ctx as unknown as CanvasRenderingContext2D)(feature(topology, topology.objects.land));
  ctx.fill();
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const mask = new Uint8Array(width * height);
  for (let k = 0; k < mask.length; k++) mask[k] = rgba[4 * k];
  (self as unknown as Worker).postMessage(mask, [mask.buffer]);
};

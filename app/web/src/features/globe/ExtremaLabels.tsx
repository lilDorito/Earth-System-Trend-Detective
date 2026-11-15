// H and L at the highs and lows of a field, as on a weather chart

import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { CanvasTexture, SRGBColorSpace } from "three";
import type { Extremum } from "./contours";
import { latLonToVector } from "./geo";

function letter(text: string, color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "600 44px 'IBM Plex Sans', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.strokeText(text, 32, 34);
  ctx.fillStyle = color;
  ctx.fillText(text, 32, 34);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export default function ExtremaLabels({ points, visible = true }: { points: Extremum[]; visible?: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const textures = useMemo(() => ({ high: letter("H", "#fdb863"), low: letter("L", "#b2abd2") }), []);
  useEffect(() => () => Object.values(textures).forEach((t) => t.dispose()), [textures]);
  useEffect(() => invalidate(), [points, visible, invalidate]);
  if (!visible) return null;
  return (
    <>
      {points.map((p) => (
        <sprite key={`${p.lat}:${p.lon}`} position={latLonToVector(p.lat, p.lon, 1.012)} scale={[0.04, 0.04, 1]} renderOrder={4}>
          <spriteMaterial map={p.high ? textures.high : textures.low} sizeAttenuation={false} transparent depthWrite={false} />
        </sprite>
      ))}
    </>
  );
}

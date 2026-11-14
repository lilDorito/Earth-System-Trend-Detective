import { useEffect, useMemo, useState } from "react";
import type { Texture } from "three";
import { useTrendMapStore } from "@/store/useTrendMapStore";
import { buildTrendCanvas, composeTexture } from "./trendGeo";

/** Earth map and, when enabled, the trend layer on top of it */
export function useGlobeTexture(): Texture | null {
  const grid = useTrendMapStore((s) => s.grid);
  const showTrend = useTrendMapStore((s) => s.showTrend);
  const onlySignificant = useTrendMapStore((s) => s.onlySignificant);
  const [base, setBase] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const image = new Image();
    image.onload = () => setBase(image);
    image.src = "/textures/earth.jpg";
  }, []);

  const trendCanvas = useMemo(() => (grid ? buildTrendCanvas(grid, onlySignificant) : null), [grid, onlySignificant]);
  const texture = useMemo(
    () => (base ? composeTexture(base, showTrend ? trendCanvas : null) : null),
    [base, trendCanvas, showTrend],
  );

  useEffect(() => () => texture?.dispose(), [texture]);
  return texture;
}

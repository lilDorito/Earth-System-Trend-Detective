// earth texture, 8k on large screens

import { useEffect, useState } from "react";
import { SRGBColorSpace, Texture } from "three";

let earthTexture: Promise<Texture> | null = null;

// decoded off the main thread; flipped here because WebGL ignores flipY for bitmaps
async function decode() {
  const url = window.matchMedia("(min-width: 1024px)").matches ? "/textures/earth-8k.jpg" : "/textures/earth.jpg";
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob(), { imageOrientation: "flipY" });
  const texture = new Texture(bitmap);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 16;
  texture.needsUpdate = true;
  return texture;
}

function loadEarthTexture() {
  earthTexture ??= decode();
  return earthTexture;
}

export function useEarthTexture(): Texture | null {
  const [texture, setTexture] = useState<Texture | null>(null);

  useEffect(() => {
    let active = true;
    loadEarthTexture()
      .then((t) => active && setTexture(t))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return texture;
}

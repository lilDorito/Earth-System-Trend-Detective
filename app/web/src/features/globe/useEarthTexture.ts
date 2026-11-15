// earth texture: 4k (32 MB on the GPU), 8k (170 MB with mipmaps) only on wide high-DPI screens, where it is
// actually resolved at the default zoom; closer in, the detail tiles take over anyway

import { useEffect, useState } from "react";
import { SRGBColorSpace, Texture } from "three";

let earthTexture: Promise<Texture> | null = null;

// decoded off the main thread; flipped here because WebGL ignores flipY for bitmaps
async function decode() {
  const sharp = window.devicePixelRatio >= 2 && window.matchMedia("(min-width: 1280px)").matches;
  const url = sharp ? "/textures/earth-8k.jpg" : "/textures/earth.jpg";
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob(), { imageOrientation: "flipY" });
  const texture = new Texture(bitmap);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8; // 16 taps cost integrated GPUs a lot for a difference only near the rim
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

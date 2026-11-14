// earth texture, optionally with an overlay

import { useEffect, useMemo, useState } from "react";
import { CanvasTexture, SRGBColorSpace, Texture } from "three";

const OVERLAY_WIDTH = 4096;
let earthImage: Promise<HTMLImageElement> | null = null;

function loadEarthImage() {
  earthImage ??= new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = window.matchMedia("(min-width: 1024px)").matches ? "/textures/earth-8k.jpg" : "/textures/earth.jpg";
  });
  return earthImage;
}

function createTexture(base: HTMLImageElement, overlay: HTMLCanvasElement | null): Texture {
  let texture: Texture;
  if (overlay) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(base.width, OVERLAY_WIDTH);
    canvas.height = canvas.width / 2;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(base, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 0.6;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(overlay, 0, 0, canvas.width, canvas.height);
    texture = new CanvasTexture(canvas);
  } else {
    texture = new Texture(base);
    texture.needsUpdate = true;
  }
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 16;
  return texture;
}

export function useEarthTexture(overlay: HTMLCanvasElement | null = null): Texture | null {
  const [base, setBase] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    let active = true;
    loadEarthImage()
      .then((image) => active && setBase(image))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const texture = useMemo(() => (base ? createTexture(base, overlay) : null), [base, overlay]);
  useEffect(() => () => texture?.dispose(), [texture]);
  return texture;
}

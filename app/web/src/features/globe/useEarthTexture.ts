// earth texture, optionally with an overlay

import { useEffect, useMemo, useState } from "react";
import { CanvasTexture, SRGBColorSpace, Texture } from "three";

const OVERLAY_WIDTH = 6144;
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

// one canvas + texture reused for every overlay, so scrubbing the timeline only redraws and re-uploads
let shared: { canvas: HTMLCanvasElement; texture: CanvasTexture } | null = null;
let backdrop: { base: HTMLImageElement; canvas: HTMLCanvasElement } | null = null;

/** dimmed, desaturated Earth so the layers read clearly; relief stays visible. Built once. */
function backdropOf(base: HTMLImageElement, width: number): HTMLCanvasElement {
  if (backdrop?.base === base) return backdrop.canvas;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = width / 2;
  const ctx = canvas.getContext("2d")!;
  ctx.filter = "grayscale(1) brightness(0.9) contrast(1.2)";
  ctx.drawImage(base, 0, 0, canvas.width, canvas.height);
  backdrop = { base, canvas };
  return canvas;
}

function createTexture(base: HTMLImageElement, overlay: HTMLCanvasElement | null): Texture {
  if (!overlay) {
    const texture = new Texture(base);
    texture.needsUpdate = true;
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 16;
    return texture;
  }
  const width = Math.max(base.width, OVERLAY_WIDTH);
  if (!shared) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = width / 2;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 16;
    shared = { canvas, texture };
  }
  const ctx = shared.canvas.getContext("2d")!;
  ctx.clearRect(0, 0, shared.canvas.width, shared.canvas.height);
  ctx.drawImage(backdropOf(base, shared.canvas.width), 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(overlay, 0, 0, shared.canvas.width, shared.canvas.height);
  shared.texture.needsUpdate = true;
  return shared.texture;
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
  useEffect(() => () => { if (texture && texture !== shared?.texture) texture.dispose(); }, [texture]);
  return texture;
}

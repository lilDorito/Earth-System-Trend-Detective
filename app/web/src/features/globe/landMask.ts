// land mask (Natural Earth 1:50m) that cuts ocean and land fields at the real coastline

import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RedFormat,
  RepeatWrapping,
  UnsignedByteType,
  type Texture,
} from "three";

// about 10 km per pixel, finer than the coastline at any zoom the overlay is used at; one byte per pixel
// with mipmaps is 11 MB on the GPU, against 170 MB for an 8k RGBA canvas
const WIDTH = 4096;

let cached: Promise<Texture> | null = null;

function rasterise(): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./landMask.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<Uint8Array>) => {
      resolve(e.data);
      worker.terminate();
    };
    worker.onerror = (e) => {
      reject(e);
      worker.terminate();
    };
    worker.postMessage({ width: WIDTH });
  });
}

export function loadLandMask(): Promise<Texture> {
  cached ??= rasterise().then((mask) => {
    const texture = new DataTexture(mask, WIDTH, WIDTH / 2, RedFormat, UnsignedByteType);
    texture.generateMipmaps = true;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return texture;
  });
  return cached;
}

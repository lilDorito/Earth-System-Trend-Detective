// full-resolution 22.5° tiles loaded over the base texture when zoomed in

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { ImageBitmapLoader, SphereGeometry, SRGBColorSpace, Texture, Vector3, type PerspectiveCamera } from "three";
import { vectorToLatLon } from "./geo";

const SPAN = 22.5;
const ROWS = 180 / SPAN;
const COLS = 360 / SPAN;
const START_DISTANCE = 1.4;
const MAX_CACHED = 24;
const CHECK_INTERVAL = 0.15;
const DEG = Math.PI / 180;

type Tile = { key: string; west: number; north: number };

const tiles: Tile[] = Array.from({ length: ROWS * COLS }, (_, i) => {
  const row = Math.floor(i / COLS);
  const col = i % COLS;
  return { key: `${row}-${col}`, west: -180 + col * SPAN, north: 90 - row * SPAN };
});

// one patch geometry per tile, reused whenever the tile comes back into view
const geometries = new Map<string, SphereGeometry>();

function geometryFor(tile: Tile) {
  let geometry = geometries.get(tile.key);
  if (!geometry) {
    geometry = new SphereGeometry(1.0003, 16, 16, (tile.west + 180) * DEG, SPAN * DEG, (90 - tile.north) * DEG, SPAN * DEG);
    geometries.set(tile.key, geometry);
  }
  return geometry;
}

function greatCircle(lat1: number, lon1: number, lat2: number, lon2: number) {
  const a =
    Math.sin(((lat2 - lat1) * DEG) / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(((lon2 - lon1) * DEG) / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

// angle from a point to the closest spot of a tile
function distanceToTile(tile: Tile, lat: number, lon: number) {
  const clampedLat = Math.min(tile.north, Math.max(tile.north - SPAN, lat));
  const offset = (((lon - tile.west) % 360) + 360) % 360;
  const clampedLon = offset <= SPAN ? lon : offset - SPAN < 360 - offset ? tile.west + SPAN : tile.west;
  return greatCircle(lat, lon, clampedLat, clampedLon);
}

// angle at the globe's centre covered by the view, from the centre of the screen to its corner
function visibleRadius(distance: number, fov: number, aspect: number) {
  const corner = Math.atan(Math.tan((fov * DEG) / 2) * Math.sqrt(1 + aspect * aspect));
  const reach = distance * Math.sin(corner);
  return reach >= 1 ? Math.acos(1 / distance) : Math.asin(reach) - corner;
}

// decodes off the main thread; flipped here because WebGL ignores flipY for bitmaps
const loader = new ImageBitmapLoader().setOptions({ imageOrientation: "flipY" });

function release(texture: Texture) {
  (texture.image as ImageBitmap).close();
  texture.dispose();
}

export default function DetailTiles() {
  const [visible, setVisible] = useState<string[]>([]);
  const cache = useRef(new Map<string, Texture>());
  const pending = useRef<[string, Texture][]>([]);
  const requested = useRef(new Set<string>());
  const candidate = useRef("");
  const lastCheck = useRef(0);
  const checkedFrom = useMemo(() => new Vector3(), []);
  const invalidate = useThree((s) => s.invalidate);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useFrame(({ camera, clock, gl, size }) => {
    // at most one GPU upload per frame so loading never stalls a frame
    const next = pending.current.shift();
    if (next) {
      const [key, texture] = next;
      gl.initTexture(texture);
      cache.current.set(key, texture);
      rerender();
    }
    // keep frames coming until uploads finish and the view has been checked where the camera stopped
    if (pending.current.length || !checkedFrom.equals(camera.position) || candidate.current !== visible.join()) invalidate();

    if (clock.elapsedTime - lastCheck.current < CHECK_INTERVAL) return;
    lastCheck.current = clock.elapsedTime;
    checkedFrom.copy(camera.position);

    const distance = camera.position.length();
    let keys: string[] = [];
    if (distance < START_DISTANCE) {
      const { lat, lon } = vectorToLatLon(camera.position);
      const fov = (camera as PerspectiveCamera).fov;
      const radius = visibleRadius(distance, fov, size.width / size.height) + 2 * DEG;
      keys = tiles.filter((t) => distanceToTile(t, lat, lon) < radius).map((t) => t.key);
    }
    // only switch once the view has held still for two checks
    const signature = keys.join();
    if (signature !== candidate.current) {
      candidate.current = signature;
      return;
    }
    if (signature !== visible.join()) setVisible(keys);
  });

  useEffect(() => {
    const textures = cache.current;
    for (const key of visible) {
      if (textures.has(key)) {
        const texture = textures.get(key)!;
        textures.delete(key);
        textures.set(key, texture);
      } else if (!requested.current.has(key)) {
        requested.current.add(key);
        loader.load(`/textures/tiles/${key}.jpg`, (bitmap) => {
          const texture = new Texture(bitmap);
          texture.colorSpace = SRGBColorSpace;
          texture.anisotropy = 16;
          texture.needsUpdate = true;
          pending.current.push([key, texture]);
          invalidate();
        });
      }
    }
    for (const [key, texture] of textures) {
      if (textures.size <= MAX_CACHED) break;
      if (visible.includes(key)) continue;
      release(texture);
      textures.delete(key);
      requested.current.delete(key);
    }
  }, [visible, invalidate]);

  useEffect(() => {
    const textures = cache.current;
    const queue = pending.current;
    return () => {
      textures.forEach(release);
      queue.forEach(([, t]) => release(t));
      textures.clear();
    };
  }, []);

  return (
    <>
      {tiles
        .filter((t) => visible.includes(t.key) && cache.current.has(t.key))
        .map((t) => (
          <mesh key={t.key} geometry={geometryFor(t)} raycast={() => null}>
            <meshBasicMaterial map={cache.current.get(t.key)} toneMapped={false} />
          </mesh>
        ))}
    </>
  );
}

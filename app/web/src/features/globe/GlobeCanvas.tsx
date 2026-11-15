// 3D globe shared by the explorer and the trend map

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import { AnimatePresence, motion } from "framer-motion";
import { Crosshair, Flag, Layers, Square, SquareDashed, X } from "lucide-react";
import type { BBox, Boundary } from "@/api/types";
import { AdditiveBlending, BackSide, BufferGeometry, CanvasTexture, Color, IcosahedronGeometry, Quaternion, Ray, Sphere, SRGBColorSpace, TextureLoader, Vector3, type EventDispatcher, type Intersection, type Mesh, type PerspectiveCamera, type Raycaster, type Texture } from "three";
import { formatLatLon } from "@/lib/format";
import { cssVar, usePhoneTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import AdminBorders from "./AdminBorders";
import AreaFill from "./AreaFill";
import { ADMIN_ZOOM } from "./areaAt";
import MapOverlay, { type CitySnap, type PickHandler } from "./MapOverlay";
import type { Ring } from "./boundaries";
import BoxDraw from "./BoxDraw";
import Outline from "./Outline";
import DetailTiles from "./DetailTiles";
import { useOutline } from "./useOutline";
import { loadLandMask } from "./landMask";
import { latLonToVector, vectorToLatLon } from "./geo";

type LatLon = { lat: number; lon: number };

const UNIT_SPHERE = new Sphere(new Vector3(), 1);

// exact ray/sphere hit instead of testing every triangle of the mesh
function raycastSphere(this: Mesh, raycaster: Raycaster, intersects: Intersection[]) {
  const point = raycaster.ray.intersectSphere(UNIT_SPHERE, new Vector3());
  if (point) intersects.push({ distance: raycaster.ray.origin.distanceTo(point), point, object: this });
}

type GlobeCanvasProps = {
  texture: Texture | null;
  marker?: LatLon | null;
  focus?: (LatLon & { id: number; distance?: number }) | null;
  autoRotate?: boolean;
  onPick?: PickHandler;
  onClear?: () => void;
  onBox?: (box: BBox) => void;
  // region mode: a click picks the area under it; zoomed picks the next level down, multi adds or removes
  onCountry?: (lat: number, lon: number, zoomed: boolean, multi: boolean) => void;
  multiSelect?: boolean; // offer the One / Several switch in region mode
  hoverArea?: (lat: number, lon: number, zoomed: boolean) => Promise<Boundary | null>;
  rightInset?: number; // px covered by a side panel on the right (wide screens); the mode switch centres in the rest
  leftInset?: number; // px covered by a panel on the left (from tablet width up)
  viewShift?: { x: number; y: number }; // px the globe's picture moves left / up to centre in the free space
  outline?: Ring[] | null;
  hint?: string;
  touchHint?: string; // shown instead of hint on touch screens
  detail?: boolean;
  loading?: string | null;
  children?: ReactNode;
};

const DRAG_THRESHOLD_PX = 4;
const NO_SHIFT = { x: 0, y: 0 };
const FOV = 45;

const atmosphereShader = {
  vertexShader: `
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vNormal = normalize(normalMatrix * normal);
      vView = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      float glow = pow(clamp(-dot(vNormal, vView) * 2.2, 0.0, 1.0), 2.0) * 0.4;
      gl_FragColor = vec4(0.45, 0.65, 0.9, 1.0) * glow;
    }`,
};

function Atmosphere() {
  return (
    <mesh scale={1.12}>
      <sphereGeometry args={[1, 64, 32]} />
      <shaderMaterial args={[atmosphereShader]} side={BackSide} blending={AdditiveBlending} transparent depthWrite={false} />
    </mesh>
  );
}

// easter egg: a small comet whose nucleus carries the team picture
const SECRET_COMET_AT: [number, number, number] = [16.2, -50.6, -78.8];
const SECRET_COMET_RADIUS = 0.5; // nucleus, world units, some 95 away
const COMET_TAIL = new Vector3(0.82, 0.5, -0.28).normalize(); // away from the Sun
const COMET_TAIL_LENGTH = 7;
const COMET_TAIL_PUFFS = 36; // close together and soft, so they blend into one streak

const SECRET_COMET_HIT_PX = 24;

function glowTexture(core: boolean): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (core) g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(core ? 0.25 : 0, core ? "rgba(200,230,255,0.55)" : "rgba(200,230,255,0.5)");
  g.addColorStop(1, "rgba(150,200,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

const COMET_PUFFS = Array.from({ length: COMET_TAIL_PUFFS }, (_, i) => {
  const t = (i + 1) / COMET_TAIL_PUFFS;
  const along = COMET_TAIL.clone().multiplyScalar(t * COMET_TAIL_LENGTH);
  return { position: along.toArray() as [number, number, number], size: 1.1 + t * 2.4, opacity: 0.32 * (1 - t) ** 1.5 };
});

function asteroidGeometry(): BufferGeometry {
  const geometry = new IcosahedronGeometry(1, 2);
  const pos = geometry.attributes.position;
  const p = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).normalize();
    const bumps = Math.sin(p.x * 5.1 + 1.3) * Math.sin(p.y * 4.3 + 0.7) * Math.sin(p.z * 3.7 + 2.1);
    const dents = Math.sin(p.x * 11.3 + p.y * 7.9 + p.z * 9.1);
    p.multiplyScalar(1 + 0.22 * bumps + 0.07 * dents);
    pos.setXYZ(i, p.x, p.y * 0.78, p.z * 0.88); // a little flattened, as small asteroids are
  }
  geometry.computeVertexNormals();
  return geometry;
}

function SecretComet({ onOpen }: { onOpen: () => void }) {
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;

  useEffect(() => {
    const el = gl.domElement;
    const star = new Vector3(...SECRET_COMET_AT);
    const onScreen = new Vector3();
    const sightLine = new Ray();
    let down: { x: number; y: number } | null = null;
    const press = (e: PointerEvent) => void (down = { x: e.clientX, y: e.clientY });
    // on the click, not the pointer-up: the click that follows a tap would land on the picture just opened and close it
    const release = (e: MouseEvent) => {
      const start = down;
      down = null;
      if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_THRESHOLD_PX) return; // a drag
      onScreen.copy(star).project(camera);
      if (onScreen.z > 1) return; // behind the camera
      const rect = el.getBoundingClientRect();
      const x = rect.left + ((onScreen.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - onScreen.y) / 2) * rect.height;
      if (Math.hypot(e.clientX - x, e.clientY - y) > SECRET_COMET_HIT_PX) return;
      sightLine.set(camera.position, star.clone().sub(camera.position).normalize());
      if (sightLine.intersectsSphere(UNIT_SPHERE)) return; // hidden behind the Earth
      openRef.current();
    };
    el.addEventListener("pointerdown", press);
    el.addEventListener("click", release);
    return () => {
      el.removeEventListener("pointerdown", press);
      el.removeEventListener("click", release);
    };
  }, [gl, camera]);
  const rock = useRef<Mesh>(null);
  const geometry = useMemo(asteroidGeometry, []);
  const glow = useMemo(() => glowTexture(true), []);
  const haze = useMemo(() => glowTexture(false), []);
  useEffect(
    () => () => {
      geometry.dispose();
      glow.dispose();
      haze.dispose();
    },
    [geometry, glow, haze],
  );
  // tumbles only while frames are drawn anyway (the globe spinning or being dragged), so it never keeps the GPU busy
  useFrame((_, delta) => {
    if (!rock.current) return;
    rock.current.rotation.x += delta * 0.21;
    rock.current.rotation.y += delta * 0.34;
  });
  const [texture, setTexture] = useState<Texture | null>(null);
  useEffect(() => {
    let active = true;
    new TextureLoader().load("/textures/goyz-rock.jpg?v=ai", (loaded) => {
      if (!active) return loaded.dispose();
      loaded.colorSpace = SRGBColorSpace;
      setTexture(loaded);
      invalidate();
    });
    return () => {
      active = false;
    };
  }, [invalidate]);
  if (!texture) return null;
  return (
    <group position={SECRET_COMET_AT}>
      <ambientLight intensity={0.7} />
      <directionalLight position={COMET_TAIL.clone().multiplyScalar(-100).toArray()} intensity={2.4} />
      <mesh ref={rock} geometry={geometry} scale={SECRET_COMET_RADIUS} rotation={[0.4, 1.1, 0.2]} raycast={() => null}>
        <meshStandardMaterial map={texture} flatShading roughness={1} metalness={0} />
      </mesh>
      <sprite scale={2.4} raycast={() => null}>
        <spriteMaterial map={glow} color="#cfe6ff" transparent opacity={0.7} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
      </sprite>
      {COMET_PUFFS.map((puff, i) => (
        <sprite key={i} position={puff.position} scale={puff.size} raycast={() => null}>
          <spriteMaterial map={haze} color="#bcdcff" transparent opacity={puff.opacity} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
        </sprite>
      ))}
    </group>
  );
}

// marshmallow theme: the Earth in candy colours, pink seas and buttery land along the real coastline, with a
// little relief from the satellite imagery (mountains, deserts and ice lighter, forests darker). Drawn opaque just
// over the imagery; the trend layer draws its own muted ground, so this is only used without it
const MARSHMALLOW_SEA = [0.965, 0.753, 0.776]; // #f6c0c6, the warm pink of the Investigate button, sRGB
const MARSHMALLOW_LAND = [0.976, 0.871, 0.588]; // #f9de96, sRGB

const marshmallowShader = {
  vertexShader: `
    varying vec3 vDir;
    void main() {
      vDir = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D earth;
    uniform sampler2D landMask;
    uniform vec3 sea;
    uniform vec3 land;
    varying vec3 vDir;

    vec3 toSrgb(vec3 c) {
      return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
    }

    void main() {
      // longitude and latitude from the surface position, as the trend layer does (uv breaks down at the poles)
      vec3 dir = normalize(vDir);
      vec2 lonLat = vec2(degrees(atan(dir.z, -dir.x)) - 180.0, degrees(asin(clamp(dir.y, -1.0, 1.0))));
      lonLat.x += lonLat.x < -180.0 ? 360.0 : 0.0;
      vec2 uv = vec2((lonLat.x + 180.0) / 360.0, (lonLat.y + 90.0) / 180.0);
      // derivatives across the 180 degree seam without the jump, so no seam line
      vec2 dx = dFdx(uv);
      vec2 dy = dFdy(uv);
      dx.x -= floor(dx.x + 0.5);
      dy.x -= floor(dy.x + 0.5);
      float isLand = textureGrad(landMask, uv, dx, dy).r;
      float lum = dot(toSrgb(textureGrad(earth, uv, dx, dy).rgb), vec3(0.2126, 0.7152, 0.0722));
      // relief: the imagery's brightness nudges the flat candy colour a little, never into dusky tones
      vec3 base = mix(sea, land, isLand);
      vec3 color = clamp(base * (0.94 + 0.16 * sqrt(lum)), 0.0, 1.0);
      gl_FragColor = vec4(color, 1.0);
    }`,
};

// marshmallow sky: white stars vanish on pink, so little sparkles in candy colours instead, drawn opaque-ish
// (no additive glow) on a shell around the globe like the dark theme's stars
const CANDY_STAR_COLORS = ["#e2689f", "#d9a400", "#9b4f7d", "#f08cb4", "#e8b830"];

function sparkleTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.beginPath(); // four-pointed twinkle
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4 - Math.PI / 2;
    const r = i % 2 ? 7 : 31;
    ctx.lineTo(32 + r * Math.cos(angle), 32 + r * Math.sin(angle));
  }
  ctx.closePath();
  ctx.fill();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function CandyStars({ count = 450 }: { count?: number }) {
  const [positions, colors] = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const v = new Vector3();
    const c = new Color();
    for (let i = 0; i < count; i++) {
      v.randomDirection().multiplyScalar(70 + Math.random() * 40);
      v.toArray(pos, i * 3);
      c.set(CANDY_STAR_COLORS[i % CANDY_STAR_COLORS.length]).toArray(col, i * 3);
    }
    return [pos, col];
  }, [count]);
  const sparkle = useMemo(sparkleTexture, []);
  useEffect(() => () => sparkle.dispose(), [sparkle]);
  return (
    <points raycast={() => null}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial map={sparkle} vertexColors size={3.6} sizeAttenuation transparent alphaTest={0.3} opacity={0.85} depthWrite={false} toneMapped={false} />
    </points>
  );
}

function MarshmallowEarth({ earth }: { earth: Texture }) {
  const invalidate = useThree((s) => s.invalidate);
  const [landMask, setLandMask] = useState<Texture | null>(null);
  useEffect(() => {
    let active = true;
    void loadLandMask().then((mask) => {
      if (!active) return;
      setLandMask(mask);
      invalidate();
    });
    return () => {
      active = false;
    };
  }, [invalidate]);
  const material = useMemo(
    () => ({
      ...marshmallowShader,
      uniforms: {
        earth: { value: earth },
        landMask: { value: null as Texture | null },
        sea: { value: new Vector3(...MARSHMALLOW_SEA) },
        land: { value: new Vector3(...MARSHMALLOW_LAND) },
      },
    }),
    [earth],
  );
  material.uniforms.landMask.value = landMask;
  // until the coastline mask is ready the real imagery shows, then the candy globe takes over
  if (!landMask) return null;
  return (
    <mesh raycast={() => null}>
      {/* fine enough that its flat facets stay above the imagery everywhere; coarser ones dip under it and flicker */}
      <sphereGeometry args={[1.0005, 256, 128]} />
      <shaderMaterial args={[material]} toneMapped={false} />
    </mesh>
  );
}

// orbit controls turn 2π·rotateSpeed per screen height dragged; this rate keeps the surface under the finger
const TRACK_FINGER = (2 * Math.tan(((FOV / 2) * Math.PI) / 180)) / (2 * Math.PI);

function ZoomFeel({ touch }: { touch: boolean }) {
  const controls = useThree((s) => s.controls) as { rotateSpeed: number; zoomSpeed: number } | null;
  useFrame(({ camera }) => {
    if (!controls) return;
    const altitude = camera.position.length() - 1;
    controls.rotateSpeed = touch ? TRACK_FINGER * altitude : Math.min(0.5, 0.06 + altitude * 0.25);
    controls.zoomSpeed = Math.min(1, 0.35 + altitude * 0.35);
  });
  return null;
}

// moves the rendered picture left by x and up by y px, so the globe centres in the space side panels and sheets leave;
// picking, labels and box drawing all go through the same camera, so they stay aligned
function ViewShift({ x, y }: { x: number; y: number }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const current = useRef({ x: 0, y: 0 });

  useEffect(() => invalidate(), [x, y, size, invalidate]);

  useFrame((_, delta) => {
    const c = current.current;
    const k = Math.min(1, delta * 8);
    c.x += (x - c.x) * k;
    c.y += (y - c.y) * k;
    if (Math.abs(x - c.x) < 0.5 && Math.abs(y - c.y) < 0.5) [c.x, c.y] = [x, y];
    else invalidate();
    if (c.x || c.y) camera.setViewOffset(size.width, size.height, c.x, c.y, size.width, size.height);
    else if (camera.view?.enabled) camera.clearViewOffset();
  });
  return null;
}

function FitCamera() {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const aspect = useThree((s) => s.size.width / s.size.height);

  useEffect(() => {
    const fit = 1.3 / (Math.tan(((FOV / 2) * Math.PI) / 180) * aspect);
    const distance = Math.max(2.9, fit);
    if (Math.abs(camera.position.length() - distance) > 0.05) camera.position.setLength(distance);
    invalidate();
  }, [aspect, camera, invalidate]);

  return null;
}

type EarthProps = Pick<GlobeCanvasProps, "texture" | "onPick" | "onClear"> & {
  onHover: (point: LatLon | null, dragging?: boolean) => void;
  snap: CitySnap;
};

function Earth({ texture, onPick, onClear, onHover, snap }: EarthProps) {
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!onPick || e.delta > DRAG_THRESHOLD_PX) return;
    e.stopPropagation();
    const city = snap.current?.(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    if (city) return onPick(city.lat, city.lon, city.name);
    const { lat, lon } = vectorToLatLon(e.point);
    onPick(lat, lon);
  };

  const handleContextMenu = (e: ThreeEvent<MouseEvent>) => {
    if (!onClear || e.delta > DRAG_THRESHOLD_PX) return;
    e.stopPropagation();
    onClear();
  };

  return (
    <mesh
      raycast={raycastSphere}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onPointerOver={() => onPick && (document.body.style.cursor = "crosshair")}
      onPointerMove={(e) => onHover(vectorToLatLon(e.point), e.nativeEvent.buttons !== 0)}
      onPointerOut={() => {
        document.body.style.cursor = "";
        onHover(null);
      }}
    >
      <sphereGeometry args={[1, 192, 96]} />
      {/* remount so the shader picks up the map */}
      <meshBasicMaterial
        key={texture?.uuid ?? "none"}
        map={texture ?? undefined}
        color={texture ? "#ffffff" : "#1a2a44"}
        toneMapped={false}
      />
    </mesh>
  );
}

function CameraDistance({ target }: { target: { current: number } }) {
  useFrame(({ camera }) => {
    target.current = camera.position.length();
  });
  return null;
}

function HoverArea({ boundary }: { boundary: Boundary }) {
  const area = useMemo(() => ({ kind: "region" as const, boundary }), [boundary]);
  const rings = useOutline(area);
  if (!rings || rings.length === 0) return null;
  return (
    <>
      <AreaFill rings={rings} color={0xffffff} opacity={0.14} radius={1.0005} />
      <Outline rings={rings} color={0xffffff} width={1.6} halo={false} />
    </>
  );
}

const SPIN_SPEED = 0.4;
const IDLE_SECONDS = 30;
const SPIN_FULL_AT = 2.6; // camera distance with full spin speed
const SPIN_STOP_AT = 1.6; // and with none

type SpinControls = EventDispatcher<{ start: object; end: object }> & { autoRotate: boolean; autoRotateSpeed: number };

function IdleSpin({ enabled }: { enabled: boolean }) {
  const controls = useThree((s) => s.controls) as SpinControls | null;
  const invalidate = useThree((s) => s.invalidate);
  const lastInteraction = useRef(-Infinity);
  const speed = useRef(0);
  const nextFrame = useRef(0);
  useEffect(() => () => clearTimeout(nextFrame.current), []);

  useEffect(() => {
    if (!controls) return;
    let timer = 0;
    const interact = () => {
      lastInteraction.current = performance.now();
      speed.current = 0;
      controls.autoRotate = false;
      clearTimeout(timer);
      // nothing renders while idle, so wake the loop when the spin may resume
      timer = window.setTimeout(invalidate, IDLE_SECONDS * 1000 + 50);
    };
    controls.addEventListener("start", interact);
    controls.addEventListener("end", interact);
    return () => {
      clearTimeout(timer);
      controls.removeEventListener("start", interact);
      controls.removeEventListener("end", interact);
    };
  }, [controls, invalidate]);

  useEffect(() => invalidate(), [enabled, invalidate]);

  useFrame(({ camera }, delta) => {
    if (!controls) return;
    const idle = performance.now() - lastInteraction.current > IDLE_SECONDS * 1000;
    const zoom = Math.min(1, Math.max(0, (camera.position.length() - SPIN_STOP_AT) / (SPIN_FULL_AT - SPIN_STOP_AT)));
    const target = enabled && idle ? zoom : 0;
    speed.current += (target - speed.current) * Math.min(1, delta * 1.5);
    if (target === 0 && speed.current < 0.01) speed.current = 0;
    controls.autoRotate = speed.current > 0;
    controls.autoRotateSpeed = SPIN_SPEED * speed.current;
    // the first spin steps fall below the controls' change threshold, so keep frames coming here; a spin
    // this slow looks the same at 30 fps and costs the GPU half as much
    if (speed.current > 0 || target > 0) {
      clearTimeout(nextFrame.current);
      nextFrame.current = window.setTimeout(invalidate, 33);
    }
  });

  return null;
}

// render resolution: at most 1.5x, stepping down to 0.75x while back-to-back frames stay slower than 40 fps
function AdaptiveResolution() {
  const setDpr = useThree((s) => s.setDpr);
  const levels = useMemo(() => [0.75, 1, 1.25, 1.5].filter((d) => d <= Math.max(1, window.devicePixelRatio)), []);
  const level = useRef(levels.length - 1);
  const sample = useRef({ sum: 0, count: 0 });

  useEffect(() => setDpr(levels[level.current]), [levels, setDpr]);

  useFrame((_, delta) => {
    // on-demand rendering leaves gaps between frames; only a run of consecutive frames says anything
    if (delta > 0.1 || level.current === 0) return;
    const s = sample.current;
    s.sum += delta;
    if (++s.count < 40) return;
    if (s.sum / s.count > 1 / 40) {
      setDpr(levels[--level.current]);
    }
    s.sum = s.count = 0;
  });

  return null;
}

function FlyTo({ target }: { target: GlobeCanvasProps["focus"] }) {
  const camera = useThree((s) => s.camera);
  const flight = useRef<{ from: Vector3; rotation: Quaternion; distance: number; to: number; t: number; started: boolean } | null>(
    null,
  );

  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    if (!target) return;
    const from = camera.position.clone().normalize();
    const to = latLonToVector(target.lat, target.lon).normalize();
    flight.current = {
      from,
      rotation: new Quaternion().setFromUnitVectors(from, to),
      distance: camera.position.length(),
      to: target.distance ?? camera.position.length(),
      t: 0,
      started: false,
    };
    invalidate();
  }, [target, camera, invalidate]);

  useFrame((state, delta) => {
    const f = flight.current;
    if (!f) return;
    // the first on-demand frame can carry a long idle gap, so the flight starts counting from the next one
    if (f.started) f.t = Math.min(1, f.t + delta / 1.1);
    f.started = true;
    const ease = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
    const step = new Quaternion().slerp(f.rotation, ease);
    camera.position.copy(f.from).applyQuaternion(step).multiplyScalar(f.distance + (f.to - f.distance) * ease);
    camera.lookAt(0, 0, 0);
    if (f.t === 1) flight.current = null;
    else state.invalidate();
  });

  return null;
}

function Loading({ label, shift }: { label: string; shift: { x: number; y: number } }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
    >
      <div
        style={{ transform: `translate(${-shift.x}px, ${-shift.y}px)` }}
        className="min-w-48 transition-transform duration-200 max-w-[min(20rem,calc(100%-2rem))] rounded-md border bg-card/90 px-4 py-3 font-mono text-[11px] uppercase leading-relaxed tracking-[0.06em] text-muted-foreground shadow-lg shadow-black/40 backdrop-blur">
        {label}
        <div className="mt-2 h-px overflow-hidden bg-border">
          <div className="h-full w-2/5 animate-scan bg-primary" />
        </div>
      </div>
    </motion.div>
  );
}

export default function GlobeCanvas({
  texture,
  marker,
  focus,
  autoRotate = false,
  onPick,
  onClear,
  onBox,
  onCountry,
  multiSelect = false,
  hoverArea,
  rightInset = 0,
  leftInset = 0,
  viewShift = NO_SHIFT,
  outline = null,
  hint: mouseHint = "",
  touchHint,
  detail = true,
  loading = null,
  children,
}: GlobeCanvasProps) {
  const readout = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const snap = useRef(null) as CitySnap;
  const [mapReady, setMapReady] = useState(false);
  const [secretOpen, setSecretOpen] = useState(false);
  const [tool, setTool] = useState<"point" | "box" | "country">("point");
  const [multi, setMulti] = useState(false);
  const distance = useRef(Infinity);
  const pick: PickHandler | undefined =
    tool === "country" && onCountry ? (lat, lon) => onCountry(lat, lon, distance.current < ADMIN_ZOOM, multiSelect && multi) : onPick;
  const [touch] = useState(() => window.matchMedia("(pointer: coarse)").matches);
  const hint = (touch && touchHint) || mouseHint;
  const hasSelection = !!marker || !!outline?.length;
  const phoneTheme = usePhoneTheme();
  const sky = useMemo(() => cssVar("--globe-sky") || "#0a0b0d", [phoneTheme]);
  const ready = !!texture && mapReady;
  const status = ready ? loading : "Loading globe";
  const insets = { "--left": `${leftInset}px`, "--right": `${rightInset}px` } as CSSProperties;
  const paneled = leftInset > 0;
  useEffect(() => () => void (document.body.style.cursor = ""), []);

  const [hovered, setHovered] = useState<Boundary | null>(null);
  const hover = useRef({ timer: 0, run: 0 });
  const regionMode = tool === "country" && !!hoverArea;
  useEffect(() => {
    if (!regionMode) setHovered(null);
  }, [regionMode]);
  useEffect(() => () => clearTimeout(hover.current.timer), []);

  // written straight to the DOM so hovering does not re-render the scene
  const onHover = (point: LatLon | null, dragging = false) => {
    if (readout.current) readout.current.textContent = point ? formatLatLon(point.lat, point.lon) : hint;
    if (!regionMode || !hoverArea) return;
    const h = hover.current;
    clearTimeout(h.timer);
    if (!point || dragging) {
      h.run++;
      setHovered(null);
      return;
    }
    // the lookup walks outlines, so it waits for the pointer to settle a moment
    h.timer = window.setTimeout(() => {
      const id = ++h.run;
      void hoverArea(point.lat, point.lon, distance.current < ADMIN_ZOOM)
        .catch(() => null)
        .then((area) => id === h.run && setHovered((prev) => (prev?.id === area?.id ? prev : area)));
    }, 50);
  };

  return (
    <>
      <Canvas
        camera={{ position: [0, 0.6, 2.9], fov: FOV }}
        frameloop="demand"
        className={cn("absolute inset-0 touch-none transition-opacity duration-500", !ready && "opacity-0")}
      >
        <AdaptiveResolution />
        <CameraDistance target={distance} />
        <IdleSpin enabled={autoRotate} />
        {/* the theme's sky: deep space, or marshmallow pink on phones, where stars would only look like dust */}
        <color key={sky} attach="background" args={[sky]} />
        {phoneTheme ? <CandyStars /> : <Stars radius={100} depth={50} count={1800} factor={3} fade speed={0.3} />}
        <SecretComet onOpen={() => setSecretOpen(true)} />
        <Earth texture={texture} onPick={pick} onClear={onClear} onHover={onHover} snap={snap} />
        {/* the candy globe replaces the imagery, so the sharper satellite tiles are not fetched under it */}
        {detail && texture && !phoneTheme && <DetailTiles />}
        {phoneTheme && detail && texture && <MarshmallowEarth earth={texture} />}
        {children}
        {onCountry && <AdminBorders enabled={tool === "country"} />}
        {outline && outline.length > 0 && <AreaFill rings={outline} color={0xfbbf24} opacity={0.16} />}
        {outline && outline.length > 0 && <Outline rings={outline} />}
        {hovered && regionMode && <HoverArea key={hovered.id} boundary={hovered} />}
        {onBox && (
          <BoxDraw
            active={tool === "box"}
            onBox={onBox}
          />
        )}
        <Atmosphere />
        <FitCamera />
        <ViewShift x={viewShift.x} y={viewShift.y} />
        <FlyTo target={focus} />
        <ZoomFeel touch={touch} />
        <OrbitControls
          makeDefault
          enablePan={false}
          // no glide on touch: the globe stays under the finger and stops where it lets go
          enableDamping={!touch}
          rotateSpeed={0.5}
          minDistance={1.12}
          maxDistance={7}
        />
        <MapOverlay labels={labels} onPick={pick} onClear={onClear} marker={marker} snap={snap} onReady={() => setMapReady(true)} />
      </Canvas>
      <div
        ref={labels}
        className={cn(
          "pointer-events-none absolute inset-0 overflow-hidden transition-opacity duration-500 [contain:strict]",
          !ready && "opacity-0",
        )}
      />
      <AnimatePresence>{status && <Loading key={status} label={status} shift={viewShift} />}</AnimatePresence>
      {/* an invisible square over the globe's middle, for the tutorial to point at */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div data-tour="globe" className="size-[min(260px,40vmin)]" style={{ transform: `translate(${-viewShift.x}px, ${-viewShift.y}px)` }} />
      </div>
      {onBox && ready && (
        <div
          style={insets}
          className={cn(
            "absolute inset-x-3 flex flex-row items-center justify-center gap-2 sm:inset-x-auto sm:right-3 sm:top-4 sm:flex-col lg:left-[calc((var(--left)+100%-var(--right))/2)] lg:right-auto lg:-translate-x-1/2 lg:flex-row lg:transition-[left] lg:duration-200",
            paneled ? "top-24" : "top-3 justify-end",
          )}
        >
        <div
          role="radiogroup"
          aria-label="Selection mode"
          className="flex flex-row items-center gap-0.5 rounded-md border bg-card/85 p-0.5 shadow-lg shadow-black/30 backdrop-blur sm:flex-col lg:flex-row"
        >
          {([
            ["point", Crosshair, "Point", "Click to pick a point"],
            ["box", SquareDashed, "Box", "Drag on the globe to draw a box (shift-drag works in point mode too)"],
            ...(onCountry
              ? ([["country", Flag, "Region", "Click a country, sea or ocean; zoom in to pick its states and regions"]] as const)
              : []),
          ] as const).map(([mode, Icon, label, title]) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={tool === mode}
              onClick={() => setTool(mode)}
              aria-label={label}
              title={title}
              className={cn(
                "flex size-11 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-sm font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:h-7 lg:w-auto lg:flex-row lg:gap-1.5 lg:px-2.5 lg:text-[11px]",
                tool === mode && "bg-accent text-foreground",
              )}
            >
              <Icon className="size-4 lg:size-3.5" />
              {label}
            </button>
          ))}
        </div>
        {multiSelect && tool === "country" && (
          <div
            role="radiogroup"
            aria-label="Regions to select"
            className="flex flex-row items-center gap-0.5 rounded-md border bg-card/85 p-0.5 shadow-lg shadow-black/30 backdrop-blur sm:flex-col lg:flex-row"
          >
            {([
              [false, Square, "One", "A click picks one region and replaces the previous one"],
              [true, Layers, "Several", "A click adds a region to the selection, or takes it out; the panel averages them all"],
            ] as const).map(([several, Icon, label, title]) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={multi === several}
                onClick={() => setMulti(several)}
                aria-label={label}
                title={title}
                className={cn(
                  "flex size-11 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-sm font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:h-7 lg:w-auto lg:flex-row lg:gap-1.5 lg:px-2.5 lg:text-[11px]",
                  multi === several && "bg-accent text-foreground",
                )}
              >
                <Icon className="size-4 lg:size-3.5" />
                {label}
              </button>
            ))}
          </div>
        )}
        {onClear && hasSelection && (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear selection"
            title="Clear selection (right-click on the globe)"
            className="flex size-11 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md border bg-card/85 font-mono text-[10px] text-muted-foreground shadow-lg shadow-black/30 backdrop-blur transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
          >
            <X className="size-4" />
            Clear
          </button>
        )}
        </div>
      )}
      <div
        ref={readout}
        style={insets}
        className={cn(
          "globe-hint pointer-events-none absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] font-mono text-[11px] tabular-nums text-muted-foreground [text-shadow:0_0_3px_rgb(0_0_0),0_0_6px_rgb(0_0_0)] sm:bottom-4 sm:left-4",
          paneled &&
            "sm:bottom-auto sm:left-[calc((var(--left)+100%)/2)] sm:top-4 sm:max-w-[40%] sm:-translate-x-1/2 sm:text-center lg:left-[calc((var(--left)+100%-var(--right))/2)] lg:top-14",
        )}
      >
        {hint}
      </div>
      <AnimatePresence>
        {secretOpen && (
          <motion.button
            type="button"
            aria-label="Close picture"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setSecretOpen(false)}
            onKeyDown={(e) => e.key === "Escape" && setSecretOpen(false)}
            autoFocus
            className="fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center gap-4 bg-black/85 p-4 backdrop-blur-sm sm:gap-6"
          >
            {/* the tilt sits on a wrapper, since motion owns the inner transform */}
            <span className="block [perspective:260px]">
              <span className="block origin-bottom [transform:rotateX(38deg)]">
                <motion.span
                  aria-label="Made by"
                  initial={{ opacity: 0, y: 40 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 40 }}
                  transition={{ duration: 0.6, delay: 0.1, ease: "easeOut" }}
                  className="block font-['Star_Jedi',ui-sans-serif,sans-serif] text-6xl leading-none tracking-wide text-[#ffe81f] [text-shadow:0_0_18px_rgb(255_232_31/0.45)] sm:text-8xl"
                >
                  made by
                </motion.span>
              </span>
            </span>
            <motion.img
              src="/textures/goyz.jpg?v=ai"
              alt="The team, as astronauts on the Moon (AI-generated image)"
              initial={{ scale: 0.6 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.6 }}
              transition={{ type: "spring", stiffness: 260, damping: 22 }}
              className="max-h-[70vh] w-auto max-w-full rounded-lg shadow-2xl shadow-black/60"
            />
          </motion.button>
        )}
      </AnimatePresence>
    </>
  );
}

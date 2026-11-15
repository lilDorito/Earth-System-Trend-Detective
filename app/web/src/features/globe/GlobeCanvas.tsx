// 3D globe shared by the explorer and the trend map

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import { AnimatePresence, motion } from "framer-motion";
import { Crosshair, Flag, SquareDashed, Waves, X } from "lucide-react";
import type { BBox } from "@/api/types";
import { AdditiveBlending, BackSide, Quaternion, Sphere, Vector3, type EventDispatcher, type Intersection, type Mesh, type PerspectiveCamera, type Raycaster, type Texture } from "three";
import { formatLatLon } from "@/lib/format";
import { cssVar, usePhoneTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import MapOverlay, { type CitySnap, type PickHandler } from "./MapOverlay";
import type { Ring } from "./boundaries";
import BoxDraw from "./BoxDraw";
import Outline from "./Outline";
import DetailTiles from "./DetailTiles";
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
  onCountry?: (lat: number, lon: number) => void; // country mode: a click picks the country under it
  areaMode?: "country" | "sea"; // what the country button picks: countries, or seas and oceans
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

// orbit controls turn 2π·rotateSpeed per screen height dragged; this rate keeps the surface under the finger
const TRACK_FINGER = (2 * Math.tan(((FOV / 2) * Math.PI) / 180)) / (2 * Math.PI);

// slower rotation and zoom close to the surface; on touch screens the globe follows the finger exactly
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

// fit the whole globe on narrow screens
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
  onHover: (point: LatLon | null) => void;
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
      onPointerMove={(e) => onHover(vectorToLatLon(e.point))}
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

const SPIN_SPEED = 0.4;
const IDLE_SECONDS = 30;
const SPIN_FULL_AT = 2.6; // camera distance with full spin speed
const SPIN_STOP_AT = 1.6; // and with none

type SpinControls = EventDispatcher<{ start: object; end: object }> & { autoRotate: boolean; autoRotateSpeed: number };

// idle spin: stops on any drag or scroll, comes back after a quiet half minute, fades out when zoomed in
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

// steps the resolution down when frames run slow; gaps between on-demand frames are ignored
// render resolution: at most 1.5x (smooth fields and imagery look the same at 2x, for 44% fewer pixels to
// shade), stepping down to 0.75x while frames rendered back to back stay slower than 40 fps
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

function Loading({ label }: { label: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
    >
      <div className="w-48 rounded-md border bg-card/90 px-4 py-3 font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground shadow-lg shadow-black/40 backdrop-blur">
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
  areaMode = "country",
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
  const [tool, setTool] = useState<"point" | "box" | "country">("point");
  // in country mode a click (also on a city label) selects the country there instead of a point
  const pick: PickHandler | undefined = tool === "country" && onCountry ? (lat, lon) => onCountry(lat, lon) : onPick;
  const [touch] = useState(() => window.matchMedia("(pointer: coarse)").matches);
  const hint = (touch && touchHint) || mouseHint;
  const hasSelection = !!marker || !!outline?.length;
  const phoneTheme = usePhoneTheme();
  const sky = useMemo(() => cssVar("--globe-sky") || "#0a0b0d", [phoneTheme]);
  // imagery, borders and labels appear together instead of popping in one by one
  const ready = !!texture && mapReady;
  const status = ready ? loading : "Loading globe";
  const insets = { "--left": `${leftInset}px`, "--right": `${rightInset}px` } as CSSProperties;
  // a page with panels floating over the globe (the trend map) moves the controls clear of them
  const paneled = leftInset > 0;
  useEffect(() => () => void (document.body.style.cursor = ""), []);

  // written straight to the DOM so hovering does not re-render the scene
  const onHover = (point: LatLon | null) => {
    if (readout.current) readout.current.textContent = point ? formatLatLon(point.lat, point.lon) : hint;
  };

  return (
    <>
      <Canvas
        camera={{ position: [0, 0.6, 2.9], fov: FOV }}
        frameloop="demand"
        className={cn("absolute inset-0 touch-none transition-opacity duration-500", !ready && "opacity-0")}
      >
        <AdaptiveResolution />
        <IdleSpin enabled={autoRotate} />
        {/* the theme's sky: deep space on desktop, marshmallow pink on phones, where stars would only look like dust */}
        <color key={sky} attach="background" args={[sky]} />
        {!phoneTheme && <Stars radius={100} depth={50} count={1800} factor={3} fade speed={0.3} />}
        <Earth texture={texture} onPick={pick} onClear={onClear} onHover={onHover} snap={snap} />
        {detail && texture && <DetailTiles />}
        {children}
        {outline && outline.length > 0 && <Outline rings={outline} />}
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
      <AnimatePresence>{status && <Loading key={status} label={status} />}</AnimatePresence>
      {onBox && ready && (
        // what a click or drag on the globe does; shift-drag draws a box in either mode. Wide screens: a bar
        // centred in the space between the side panels; narrower: a thumb-reachable rail on the right edge, below
        // a phone's collapsed control panel, with a clear button in place of right-click
        <div
          style={insets}
          className={cn(
            "absolute inset-x-3 flex flex-row items-center justify-center gap-2 sm:inset-x-auto sm:right-3 sm:top-4 sm:flex-col lg:left-[calc((var(--left)+100%-var(--right))/2)] lg:right-auto lg:-translate-x-1/2 lg:flex-row lg:transition-[left] lg:duration-200",
            // below a page's panel header on phones, at the top otherwise
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
              ? areaMode === "sea"
                ? ([["country", Waves, "Sea", "Click on the water to select that sea or ocean"]] as const)
                : ([["country", Flag, "Country", "Click on the globe to select that country"]] as const)
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
      {/* bottom left; with floating panels, centred under the mode bar from tablet width up, where nothing covers it */}
      <div
        ref={readout}
        style={insets}
        className={cn(
          "pointer-events-none absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] font-mono text-[11px] tabular-nums text-muted-foreground [text-shadow:0_0_3px_rgb(0_0_0),0_0_6px_rgb(0_0_0)] sm:bottom-4 sm:left-4",
          paneled &&
            "sm:bottom-auto sm:left-[calc((var(--left)+100%)/2)] sm:top-4 sm:max-w-[40%] sm:-translate-x-1/2 sm:text-center lg:left-[calc((var(--left)+100%-var(--right))/2)] lg:top-14",
        )}
      >
        {hint}
      </div>
    </>
  );
}

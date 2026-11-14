// 3D globe shared by the explorer and the trend map

import { useEffect, useRef } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import { AdditiveBlending, BackSide, Quaternion, Sphere, Vector3, type BufferGeometry, type Group, type Intersection, type Mesh, type MeshBasicMaterial, type Raycaster, type Texture } from "three";
import { formatLatLon } from "@/lib/format";
import MapOverlay, { type PickHandler } from "./MapOverlay";
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
  focus?: (LatLon & { id: number }) | null;
  autoRotate?: boolean;
  onPick?: PickHandler;
  hint?: string;
  detail?: boolean;
};

const DRAG_THRESHOLD_PX = 4;
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

// slower rotation and zoom close to the surface
function ZoomFeel() {
  const controls = useThree((s) => s.controls) as { rotateSpeed: number; zoomSpeed: number } | null;
  useFrame(({ camera }) => {
    if (!controls) return;
    const altitude = camera.position.length() - 1;
    controls.rotateSpeed = Math.min(0.5, 0.06 + altitude * 0.25);
    controls.zoomSpeed = Math.min(1, 0.35 + altitude * 0.35);
  });
  return null;
}

// fit the whole globe on narrow screens
function FitCamera() {
  const camera = useThree((s) => s.camera);
  const aspect = useThree((s) => s.size.width / s.size.height);

  useEffect(() => {
    const fit = 1.3 / (Math.tan(((FOV / 2) * Math.PI) / 180) * aspect);
    const distance = Math.max(2.9, fit);
    if (Math.abs(camera.position.length() - distance) > 0.05) camera.position.setLength(distance);
  }, [aspect, camera]);

  return null;
}

type EarthProps = Pick<GlobeCanvasProps, "texture" | "onPick"> & { onHover: (point: LatLon | null) => void };

function Earth({ texture, onPick, onHover }: EarthProps) {
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!onPick || e.delta > DRAG_THRESHOLD_PX) return;
    e.stopPropagation();
    const { lat, lon } = vectorToLatLon(e.point);
    onPick(lat, lon);
  };

  return (
    <mesh
      raycast={raycastSphere}
      onClick={handleClick}
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

function Marker({ lat, lon }: LatLon) {
  const group = useRef<Group>(null);
  const pulse = useRef<Mesh<BufferGeometry, MeshBasicMaterial>>(null);

  useFrame(({ clock, camera }) => {
    // keep the same size on screen at any zoom
    group.current?.scale.setScalar((camera.position.length() - 1) / 1.9);
    if (!pulse.current) return;
    const t = (clock.elapsedTime % 1.6) / 1.6;
    pulse.current.scale.setScalar(1 + t * 2.5);
    pulse.current.material.opacity = 0.5 * (1 - t);
  });

  const position = latLonToVector(lat, lon, 1.005);
  return (
    <group ref={group} position={position}>
      <mesh>
        <sphereGeometry args={[0.009, 16, 16]} />
        <meshBasicMaterial color="#fbbf24" toneMapped={false} />
      </mesh>
      <mesh ref={pulse}>
        <sphereGeometry args={[0.009, 16, 16]} />
        <meshBasicMaterial color="#fbbf24" transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

function FlyTo({ target }: { target: GlobeCanvasProps["focus"] }) {
  const camera = useThree((s) => s.camera);
  const flight = useRef<{ from: Vector3; rotation: Quaternion; distance: number; t: number } | null>(null);

  useEffect(() => {
    if (!target) return;
    const from = camera.position.clone().normalize();
    const to = latLonToVector(target.lat, target.lon).normalize();
    flight.current = {
      from,
      rotation: new Quaternion().setFromUnitVectors(from, to),
      distance: camera.position.length(),
      t: 0,
    };
  }, [target, camera]);

  useFrame((_, delta) => {
    const f = flight.current;
    if (!f) return;
    f.t = Math.min(1, f.t + delta / 1.1);
    const ease = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
    const step = new Quaternion().slerp(f.rotation, ease);
    camera.position.copy(f.from).applyQuaternion(step).multiplyScalar(f.distance);
    camera.lookAt(0, 0, 0);
    if (f.t === 1) flight.current = null;
  });

  return null;
}

export default function GlobeCanvas({
  texture,
  marker,
  focus,
  autoRotate = false,
  onPick,
  hint = "",
  detail = true,
}: GlobeCanvasProps) {
  const readout = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  useEffect(() => () => void (document.body.style.cursor = ""), []);

  // written straight to the DOM so hovering does not re-render the scene
  const onHover = (point: LatLon | null) => {
    if (readout.current) readout.current.textContent = point ? formatLatLon(point.lat, point.lon) : hint;
  };

  return (
    <>
      <Canvas camera={{ position: [0, 0.6, 2.9], fov: FOV }} dpr={[1, 2]} className="absolute inset-0 touch-none">
        <color attach="background" args={["#0a0b0d"]} />
        <Stars radius={100} depth={50} count={1800} factor={3} fade speed={0.3} />
        <Earth texture={texture} onPick={onPick} onHover={onHover} />
        {detail && texture && <DetailTiles />}
        <Atmosphere />
        {marker && <Marker lat={marker.lat} lon={marker.lon} />}
        <FitCamera />
        <FlyTo target={focus} />
        <ZoomFeel />
        <OrbitControls
          makeDefault
          enablePan={false}
          enableDamping
          rotateSpeed={0.5}
          minDistance={1.12}
          maxDistance={7}
          autoRotate={autoRotate}
          autoRotateSpeed={0.4}
        />
        <MapOverlay labels={labels} onPick={onPick} />
      </Canvas>
      <div ref={labels} className="pointer-events-none absolute inset-0 overflow-hidden [contain:strict]" />
      <div
        ref={readout}
        className="pointer-events-none absolute bottom-3 left-3 font-mono text-[11px] tabular-nums text-muted-foreground sm:bottom-4 sm:left-4"
      >
        {hint}
      </div>
    </>
  );
}

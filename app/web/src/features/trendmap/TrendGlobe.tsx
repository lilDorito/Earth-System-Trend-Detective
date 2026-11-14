// Spinning textured Earth with the trend layer; click a point to open its series

import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import * as THREE from "three";
import { latLonToVector, vectorToLatLon } from "@/features/globe/geo";
import { useTrendMapStore } from "@/store/useTrendMapStore";
import { useGlobeTexture } from "./useGlobeTexture";

function Earth() {
  const texture = useGlobeTexture();
  const selectPoint = useTrendMapStore((s) => s.selectPoint);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return; // a drag (rotation), not a click
    e.stopPropagation();
    const { lat, lon } = vectorToLatLon(e.point);
    void selectPoint(lat, lon);
  };

  return (
    <mesh onClick={onClick}>
      <sphereGeometry args={[1, 128, 64]} />
      {/* key: recreate the material once the map exists, otherwise the shader stays without `map` */}
      <meshBasicMaterial
        key={texture ? "with-map" : "no-map"}
        map={texture ?? undefined}
        color={texture ? "#ffffff" : "#1a2a44"}
        toneMapped={false}
      />
    </mesh>
  );
}

function Marker() {
  const selected = useTrendMapStore((s) => s.selected);
  if (!selected) return null;
  return (
    <mesh position={latLonToVector(selected.lat, selected.lon, 1.01)}>
      <sphereGeometry args={[0.015, 16, 16]} />
      <meshBasicMaterial color="#ffd34d" />
    </mesh>
  );
}

export default function TrendGlobe() {
  const hasSelection = useTrendMapStore((s) => s.selected !== null);
  return (
    <Canvas camera={{ position: [0, 0, 3], fov: 45 }} dpr={[1, 2]} className="absolute inset-0">
      <color attach="background" args={["#05070d"]} />
      <Stars radius={100} depth={50} count={3000} factor={4} fade />
      <Earth />
      <mesh scale={1.05}>
        <sphereGeometry args={[1, 64, 32]} />
        <meshBasicMaterial color="#4f8cff" transparent opacity={0.16} side={THREE.BackSide} />
      </mesh>
      <Marker />
      <OrbitControls
        enablePan={false}
        enableDamping
        minDistance={1.4}
        maxDistance={5}
        autoRotate={!hasSelection}
        autoRotateSpeed={0.5}
      />
    </Canvas>
  );
}

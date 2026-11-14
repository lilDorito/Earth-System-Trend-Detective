// Globe: click to pick a point (owner: frontend)
// TODO: country borders, region boxes. The temperature trend layer lives in features/trendmap (/map)

import { useEffect, useState } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import { SRGBColorSpace, TextureLoader, type Texture } from "three";
import { useAppStore } from "@/store/useAppStore";
import { latLonToVector, vectorToLatLon } from "./geo";

function useEarthTexture() {
  const [texture, setTexture] = useState<Texture | null>(null);
  useEffect(() => {
    const tex = new TextureLoader().load("/textures/earth.jpg", (t) => {
      t.colorSpace = SRGBColorSpace;
      t.anisotropy = 8;
      setTexture(t);
    });
    return () => tex.dispose();
  }, []);
  return texture;
}

function Earth() {
  const texture = useEarthTexture();
  const location = useAppStore((s) => s.location);
  const setLocation = useAppStore((s) => s.setLocation);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const { lat, lon } = vectorToLatLon(e.point);
    setLocation({ type: "point", lat: +lat.toFixed(3), lon: +lon.toFixed(3) });
  };

  const marker = location?.type === "point" ? latLonToVector(location.lat, location.lon, 1.01) : null;

  return (
    <>
      <mesh onClick={onClick}>
        <sphereGeometry args={[1, 64, 64]} />
        {/* key: recreate the material once the map is loaded */}
        <meshBasicMaterial key={texture ? "map" : "none"} map={texture ?? undefined} color={texture ? "#ffffff" : "#1e3a5f"} toneMapped={false} />
      </mesh>
      {marker && (
        <mesh position={marker}>
          <sphereGeometry args={[0.015, 16, 16]} />
          <meshBasicMaterial color="#f97316" />
        </mesh>
      )}
    </>
  );
}

export default function Globe() {
  return (
    <Canvas camera={{ position: [0, 0, 3], fov: 45 }} className="absolute inset-0">
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 3, 5]} intensity={1} />
      <Stars radius={50} depth={20} count={2000} factor={2} fade />
      <Earth />
      <OrbitControls enablePan={false} minDistance={1.5} maxDistance={6} />
    </Canvas>
  );
}

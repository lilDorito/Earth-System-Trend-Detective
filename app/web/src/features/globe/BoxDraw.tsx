// shift-drag, or any drag while the box tool is on, draws a latitude/longitude box

import { useEffect, useMemo, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import { Raycaster, Sphere, Vector2, Vector3, type EventDispatcher } from "three";
import type { BBox } from "@/api/types";
import { boxRings } from "./boundaries";
import { vectorToLatLon } from "./geo";
import Outline from "./Outline";

const UNIT_SPHERE = new Sphere(new Vector3(), 1);
const MIN_SIZE_DEG = 0.5;

type LatLon = { lat: number; lon: number };
type Controls = EventDispatcher<{ start: object; end: object }> & { enabled: boolean };

const round = (v: number) => Math.round(v * 100) / 100;

// the shorter way round between the two longitudes
function toBox(a: LatLon, b: LatLon): BBox {
  const eastward = ((b.lon - a.lon + 540) % 360) - 180 >= 0;
  return {
    type: "bbox",
    south: round(Math.min(a.lat, b.lat)),
    north: round(Math.max(a.lat, b.lat)),
    west: round(eastward ? a.lon : b.lon),
    east: round(eastward ? b.lon : a.lon),
  };
}

export default function BoxDraw({ active, onBox }: { active: boolean; onBox: (box: BBox) => void }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as Controls | null;
  const [preview, setPreview] = useState<BBox | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const onBoxRef = useRef(onBox);
  onBoxRef.current = onBox;

  useEffect(() => {
    if (!controls) return;
    const el = gl.domElement;
    const raycaster = new Raycaster();
    const ndc = new Vector2();
    let start: LatLon | null = null;
    let box: BBox | null = null;
    let pointer = -1;

    const hit = (e: PointerEvent): LatLon | null => {
      const rect = el.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const point = raycaster.ray.intersectSphere(UNIT_SPHERE, new Vector3());
      return point && vectorToLatLon(point);
    };
    // runs in the capture phase, before the orbit controls see the press
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !(e.shiftKey || activeRef.current)) return;
      const point = hit(e);
      if (!point) return;
      start = point;
      pointer = e.pointerId;
      controls.enabled = false;
      controls.dispatchEvent({ type: "start" }); // stops the idle spin
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!start || e.pointerId !== pointer) return;
      const point = hit(e);
      if (!point) return;
      box = toBox(start, point);
      setPreview(box);
    };
    const up = (e: PointerEvent) => {
      if (!start || e.pointerId !== pointer) return;
      controls.enabled = true;
      controls.dispatchEvent({ type: "end" });
      const width = box ? (box.east - box.west + 360) % 360 : 0;
      if (box && box.north - box.south >= MIN_SIZE_DEG && width >= MIN_SIZE_DEG) onBoxRef.current(box);
      start = box = null;
      setPreview(null);
    };

    el.addEventListener("pointerdown", down, { capture: true });
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down, { capture: true });
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      controls.enabled = true;
    };
  }, [gl, camera, controls]);

  const rings = useMemo(() => (preview ? boxRings(preview) : null), [preview]);
  return rings ? <Outline rings={rings} dashed /> : null;
}

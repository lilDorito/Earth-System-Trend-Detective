// weather stations as one point cloud: a single draw call, picked on screen, a hover tooltip in the DOM

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, PerspectiveCamera, Points, ShaderMaterial, Vector3, type Intersection, type Raycaster } from "three";
import { latLonToVector } from "./geo";

export const STATION_HIDDEN = 0;
export const STATION_FAINT = 1;
export const STATION_PLAIN = 2;
export const STATION_STRONG = 3;

type StationLayerProps = {
  lat: number[];
  lon: number[];
  colors: Float32Array;
  kinds: Float32Array;
  selected?: number | null;
  visible?: boolean;
  label: (index: number) => [string, string];
  onPick?: (index: number) => void;
};

const RADIUS = 1.003;
const PICK_PX = 9;
const DRAG_THRESHOLD_PX = 4;

const shader = {
  vertexShader: `
    attribute vec3 aColor;
    attribute float aKind;
    attribute float aIndex;
    uniform float uScale;
    uniform float uSelected;
    varying vec3 vColor;
    varying float vKind;
    varying float vSelected;
    varying float vFade;
    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      float dist = length(cameraPosition);
      float facing = dot(normalize(world.xyz), normalize(cameraPosition)) - 1.0 / dist;
      vSelected = abs(aIndex - uSelected) < 0.5 ? 1.0 : 0.0;
      vColor = aColor;
      vKind = aKind;
      vFade = smoothstep(0.0, 0.06, facing);
      float size = aKind < 0.5 ? 0.0 : aKind < 1.5 ? 4.5 : aKind < 2.5 ? 6.0 : 7.5;
      size = max(size, vSelected * 11.0);
      float zoom = mix(1.0, 1.8, smoothstep(2.6, 1.25, dist));
      gl_PointSize = facing > 0.0 ? size * zoom * uScale : 0.0;
      gl_Position = projectionMatrix * viewMatrix * world;
    }`,
  fragmentShader: `
    varying vec3 vColor;
    varying float vKind;
    varying float vSelected;
    varying float vFade;
    void main() {
      float r = length(gl_PointCoord * 2.0 - 1.0);
      if (r > 1.0) discard;
      float ring = vSelected > 0.5 || vKind > 2.5 ? 0.62 : 0.72;
      vec3 edge = vSelected > 0.5 ? vec3(0.984, 0.749, 0.141) : vKind > 2.5 ? vec3(0.95) : vec3(0.03);
      vec3 color = mix(vColor, edge, smoothstep(ring - 0.08, ring, r));
      float alpha = (1.0 - smoothstep(0.86, 1.0, r)) * vFade * (vKind < 1.5 ? 0.7 : 1.0);
      gl_FragColor = vec4(color, alpha);
    }`,
};

const TOOLTIP_CLASS =
  "pointer-events-none absolute left-0 top-0 z-20 max-w-64 rounded-md border bg-card/95 px-2 py-1 shadow-lg shadow-black/40 backdrop-blur invisible";

export default function StationLayer({ lat, lon, colors, kinds, selected = null, visible = true, label, onPick }: StationLayerProps) {
  const get = useThree((s) => s.get);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const hovered = useRef(-1);
  const kindsRef = useRef(kinds);
  kindsRef.current = kinds;
  const labelRef = useRef(label);
  labelRef.current = label;

  const positions = useMemo(() => {
    const out = new Float32Array(lat.length * 3);
    const v = new Vector3();
    for (let k = 0; k < lat.length; k++) v.copy(latLonToVector(lat[k], lon[k], RADIUS)).toArray(out, k * 3);
    return out;
  }, [lat, lon]);

  const points = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("aIndex", new BufferAttribute(Float32Array.from({ length: positions.length / 3 }, (_, k) => k), 1));
    const material = new ShaderMaterial({
      uniforms: { uScale: { value: 1 }, uSelected: { value: -1 } },
      vertexShader: shader.vertexShader,
      fragmentShader: shader.fragmentShader,
      transparent: true,
      depthWrite: false,
    });
    const object = new Points(geometry, material);
    object.renderOrder = 3;
    object.frustumCulled = false;
    const point = new Vector3();
    object.raycast = (raycaster: Raycaster, intersects: Intersection[]) => {
      const { camera, size } = get();
      if (!object.visible || !(camera instanceof PerspectiveCamera)) return;
      const toCamera = camera.position.clone().normalize();
      const horizon = 1 / camera.position.length();
      const perPx = (2 * Math.tan((camera.fov * Math.PI) / 360)) / size.height;
      const current = kindsRef.current;
      let best = -1;
      let bestScore = 1;
      let bestDistance = 0;
      for (let k = 0; k < positions.length / 3; k++) {
        if (current[k] === STATION_HIDDEN) continue;
        point.fromArray(positions, k * 3);
        if (point.dot(toCamera) / RADIUS - horizon < 0.02) continue;
        const distance = camera.position.distanceTo(point);
        const limit = PICK_PX * perPx * distance;
        const score = raycaster.ray.distanceSqToPoint(point) / (limit * limit);
        if (score < bestScore) {
          best = k;
          bestScore = score;
          bestDistance = distance;
        }
      }
      if (best >= 0) intersects.push({ distance: bestDistance - 0.01, point: point.fromArray(positions, best * 3).clone(), index: best, object });
    };
    return object;
  }, [positions, get]);

  useEffect(() => {
    const geometry = points.geometry;
    if (colors.length === positions.length) geometry.setAttribute("aColor", new BufferAttribute(colors, 3));
    if (kinds.length === positions.length / 3) geometry.setAttribute("aKind", new BufferAttribute(kinds, 1));
    invalidate();
  }, [points, colors, kinds, positions, invalidate]);

  useEffect(() => {
    (points.material as ShaderMaterial).uniforms.uSelected.value = selected ?? -1;
    invalidate();
  }, [points, selected, invalidate]);

  useEffect(() => {
    points.visible = visible;
    invalidate();
  }, [points, visible, invalidate]);

  useEffect(
    () => () => {
      points.geometry.dispose();
      (points.material as ShaderMaterial).dispose();
    },
    [points],
  );

  const tooltip = useMemo(() => {
    const el = document.createElement("div");
    el.className = TOOLTIP_CLASS;
    const title = document.createElement("p");
    title.className = "truncate text-xs font-medium text-foreground";
    const detail = document.createElement("p");
    detail.className = "font-mono text-[10px] tabular-nums text-muted-foreground";
    el.append(title, detail);
    return { el, title, detail };
  }, []);

  useEffect(() => {
    const parent = gl.domElement.parentElement;
    parent?.append(tooltip.el);
    return () => tooltip.el.remove();
  }, [gl, tooltip]);

  useFrame(() => {
    (points.material as ShaderMaterial).uniforms.uScale.value = gl.getPixelRatio();
  });

  const hide = () => {
    hovered.current = -1;
    tooltip.el.style.visibility = "hidden";
  };

  useEffect(() => {
    if (!visible) hide();
  });

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (e.index === undefined || !visible) return;
    if (hovered.current !== e.index) {
      hovered.current = e.index;
      const [title, detail] = labelRef.current(e.index);
      tooltip.title.textContent = title;
      tooltip.detail.textContent = detail;
      tooltip.el.style.visibility = "visible";
      document.body.style.cursor = "pointer";
    }
    const box = gl.domElement.getBoundingClientRect();
    tooltip.el.style.transform = `translate(${e.nativeEvent.clientX - box.left + 14}px, ${e.nativeEvent.clientY - box.top + 14}px)`;
  };

  const onOut = () => {
    hide();
    document.body.style.cursor = "crosshair";
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (!onPick || e.index === undefined || e.delta > DRAG_THRESHOLD_PX) return;
    e.stopPropagation();
    onPick(e.index);
  };

  return <primitive object={points} onPointerMove={onMove} onPointerOut={onOut} onClick={onClick} />;
}

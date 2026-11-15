// particles drifting along a wind or ocean current field, each trailing a short fading streak

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { AdditiveBlending, type InterleavedBufferAttribute } from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { FlowField, GridGeometry } from "@/api/types";

const COUNT = 6000;
const TRAIL = 10; // points per streak
const KEPT = TRAIL + 1; // stored per particle: TRAIL steps of history, then the live head
const STEP_S = 1 / 15; // a new trail point this often
// drift in degrees per second for one unit of speed (wind in m/s, currents in cm/s), the speed drawn at full
// brightness, the faintest a moving streak gets, line width in px and colour; currents are some twenty times
// slower and mostly weak, so they move faster, start brighter and draw thicker to read alike
const LOOK: Record<FlowField, { drift: number; full: number; floor: number; width: number; color: [number, number, number] }> = {
  wind: { drift: 0.6, full: 6, floor: 0.4, width: 1.2, color: [0.92, 0.95, 1] },
  current: { drift: 0.13, full: 20, floor: 0.6, width: 1.2, color: [0.7, 1, 0.96] },
};
const RADIUS = 1.0014;
const DEG = Math.PI / 180;

type FlowLayerProps = {
  field: FlowField;
  u: ArrayLike<number | null>;
  v: ArrayLike<number | null>;
  nlat: number;
  nlon: number;
  grid: GridGeometry;
  visible?: boolean;
  transition?: number;
};

function sampler(u: ArrayLike<number | null>, v: ArrayLike<number | null>, nlat: number, nlon: number, grid: GridGeometry) {
  const U = Float32Array.from(u as ArrayLike<number | null>, (x) => x ?? NaN);
  const V = Float32Array.from(v as ArrayLike<number | null>, (x) => x ?? NaN);
  const out = [0, 0];
  return (lon: number, lat: number) => {
    const y = Math.min(nlat - 1.001, Math.max(0, (lat - grid.lat0) / grid.dlat));
    const x = (((lon - grid.lon0) / grid.dlon) % nlon + nlon) % nlon;
    const i = Math.floor(y), j = Math.floor(x);
    const fy = y - i, fx = x - j;
    const j2 = (j + 1) % nlon;
    const k00 = i * nlon + j, k01 = i * nlon + j2, k10 = (i + 1) * nlon + j, k11 = (i + 1) * nlon + j2;
    const mix = (A: Float32Array) =>
      (A[k00] * (1 - fx) + A[k01] * fx) * (1 - fy) + (A[k10] * (1 - fx) + A[k11] * fx) * fy;
    out[0] = mix(U);
    out[1] = mix(V);
    return out;
  };
}

export default function FlowLayer({ field, u, v, nlat, nlon, grid, visible = true, transition = 1 }: FlowLayerProps) {
  const look = LOOK[field];
  const invalidate = useThree((s) => s.invalidate);
  const sample = useMemo(() => sampler(u, v, nlat, nlon, grid), [u, v, nlat, nlon, grid]);
  const presence = useRef(0);
  const state = useMemo(
    () => ({
      lon: new Float32Array(COUNT),
      lat: new Float32Array(COUNT),
      age: new Float32Array(COUNT),
      life: new Float32Array(COUNT),
      speed: new Float32Array(COUNT),
      trail: new Float32Array(COUNT * KEPT * 3), // oldest point first
      clock: 0,
    }),
    [],
  );
  const size = useThree((s) => s.size);
  // thick lines; added onto the globe, so the fade is carried by the colour (black adds nothing)
  const { object, positions, colors } = useMemo(() => {
    const segments = COUNT * (TRAIL - 1);
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(new Float32Array(segments * 6));
    geometry.setColors(new Float32Array(segments * 6));
    const positions = (geometry.attributes.instanceStart as InterleavedBufferAttribute).data;
    const colors = (geometry.attributes.instanceColorStart as InterleavedBufferAttribute).data;
    const material = new LineMaterial({ vertexColors: true, linewidth: look.width, transparent: true, blending: AdditiveBlending, depthWrite: false });
    const object = new LineSegments2(geometry, material);
    object.frustumCulled = false;
    object.renderOrder = 1;
    return { object, positions, colors };
  }, [look]);
  useEffect(() => void object.material.resolution.set(size.width, size.height), [object, size]);

  useEffect(
    () => () => {
      object.geometry.dispose();
      object.material.dispose();
    },
    [object],
  );

  const drawn = useMemo(() => new Float32Array(TRAIL * 3), []);

  const setPoint = (p: number, t: number, lon: number, lat: number) => {
    const c = Math.cos(lat * DEG);
    const o = (p * KEPT + t) * 3;
    state.trail[o] = -RADIUS * c * Math.cos((lon + 180) * DEG);
    state.trail[o + 1] = RADIUS * Math.sin(lat * DEG);
    state.trail[o + 2] = RADIUS * c * Math.sin((lon + 180) * DEG);
  };

  const spawn = (p: number) => {
    state.lat[p] = Math.asin(2 * Math.random() - 1) / DEG;
    state.lon[p] = Math.random() * 360 - 180;
    state.age[p] = 0;
    state.life[p] = 2 + Math.random() * 4;
    for (let t = 0; t < KEPT; t++) setPoint(p, t, state.lon[p], state.lat[p]);
  };

  // start with streaks at every age, so the first frame does not pulse
  useEffect(() => {
    for (let p = 0; p < COUNT; p++) {
      spawn(p);
      state.age[p] = Math.random() * state.life[p];
    }
  }, [state]);

  useEffect(() => invalidate(), [visible, sample, invalidate]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const target = visible ? 1 : 0;
    if (presence.current !== target) {
      const change = transition > 0 ? dt / transition : 1;
      presence.current = target > presence.current ? Math.min(1, presence.current + change) : Math.max(0, presence.current - change);
    }
    object.visible = presence.current > 0;
    if (!object.visible) return;

    state.clock += dt;
    const shift = state.clock >= STEP_S;
    if (shift) state.clock %= STEP_S;
    for (let p = 0; p < COUNT; p++) {
      state.age[p] += dt;
      const [wu, wv] = sample(state.lon[p], state.lat[p]);
      const speed = Math.hypot(wu, wv);
      if (state.age[p] > state.life[p] || !Number.isFinite(speed) || Math.abs(state.lat[p]) > 84) {
        spawn(p);
        continue;
      }
      state.speed[p] = speed;
      state.lon[p] += (wu * look.drift * dt) / Math.max(Math.cos(state.lat[p] * DEG), 0.15);
      state.lat[p] += wv * look.drift * dt;
      if (state.lon[p] > 180) state.lon[p] -= 360;
      else if (state.lon[p] < -180) state.lon[p] += 360;
      if (shift) state.trail.copyWithin(p * KEPT * 3, p * KEPT * 3 + 3, (p + 1) * KEPT * 3);
      setPoint(p, TRAIL, state.lon[p], state.lat[p]);
    }

    // history is stored at fixed steps, but each drawn point slides between two stored ones by how far the
    // current step has run, so the whole streak glides every frame instead of jumping at each step
    const f = state.clock / STEP_S;
    const fade = presence.current;
    for (let p = 0; p < COUNT; p++) {
      const base = p * KEPT * 3;
      for (let t = 0; t < TRAIL - 1; t++) {
        for (let k = 0; k < 3; k++) {
          const a = state.trail[base + t * 3 + k];
          drawn[t * 3 + k] = a + f * (state.trail[base + (t + 1) * 3 + k] - a);
        }
      }
      for (let k = 0; k < 3; k++) drawn[(TRAIL - 1) * 3 + k] = state.trail[base + TRAIL * 3 + k];
      const life = state.life[p], age = state.age[p];
      const alive = Math.min(1, age / 0.5, (life - age) / 0.5) * Math.min(1, look.floor + state.speed[p] / look.full) * fade;
      for (let t = 0; t < TRAIL - 1; t++) {
        const o = (p * (TRAIL - 1) + t) * 6;
        for (let k = 0; k < 6; k++) positions.array[o + k] = drawn[t * 3 + k];
        const from = alive * (t / (TRAIL - 1));
        const to = alive * ((t + 1) / (TRAIL - 1));
        for (let k = 0; k < 3; k++) {
          colors.array[o + k] = look.color[k] * from;
          colors.array[o + 3 + k] = look.color[k] * to;
        }
      }
    }
    positions.needsUpdate = true;
    colors.needsUpdate = true;
    invalidate();
  });

  return <primitive object={object} />;
}

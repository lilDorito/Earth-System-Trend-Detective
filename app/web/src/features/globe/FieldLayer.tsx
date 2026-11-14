// gridded field drawn over a muted Earth: color bands and anti-aliased contour lines

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector2, Vector3, type DataTexture, type Mesh, type Texture } from "three";
import { createFieldTexture, fieldGrid, smoothField, updateFieldTexture, type FieldGrid } from "./field";

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragmentShader = (bands: number) => `
  uniform sampler2D earth;
  uniform sampler2D fieldFrom;
  uniform sampler2D fieldTo;
  uniform float blend;
  uniform bool crossfade;
  uniform vec2 fieldSize;
  uniform float maxFrom;
  uniform float maxTo;
  uniform float opacity;
  uniform float presence;
  uniform vec3 palette[${bands}];
  varying vec2 vUv;

  // exact sRGB encoding, the same the Earth material outputs, so a hidden layer matches it pixel for pixel
  vec3 toSrgb(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }

  vec3 shade(vec2 cell, float maxValue, vec3 ground) {
    float band = (clamp(cell.r / maxValue, -1.0, 1.0) + 1.0) * 0.5 * ${bands}.0;
    vec3 fill = palette[clamp(int(band), 0, ${bands - 1})];
    float edge = round(band);
    float gap = abs(band - edge) / max(fwidth(band), 1e-5);
    float line = edge >= 1.0 && edge <= ${bands - 1}.0 ? 1.0 - smoothstep(0.4, 1.2, gap) : 0.0;
    vec3 color = mix(ground, mix(fill, fill * 0.55, line), mix(opacity, min(1.0, opacity + 0.15), line));

    float aa = max(fwidth(cell.g), 1e-4);
    float muted = 1.0 - smoothstep(0.5 - aa, 0.5 + aa, cell.g);
    return mix(color, mix(ground, vec3(0.376, 0.4, 0.455), 0.3), muted);
  }

  void main() {
    vec3 rgb = toSrgb(texture2D(earth, vUv).rgb);
    float grey = clamp((dot(rgb, vec3(0.2126, 0.7152, 0.0722)) * 0.9 - 0.5) * 1.2 + 0.5, 0.0, 1.0);
    vec3 ground = vec3(grey);

    // grid rows run pole to pole, columns start at -180° and wrap
    vec2 node = vUv * vec2(fieldSize.x, fieldSize.y - 1.0);
    vec2 at = (node + 0.5) / fieldSize;
    vec2 from = texture2D(fieldFrom, at).rg;
    vec2 to = texture2D(fieldTo, at).rg;

    // same scale: the values morph, so contours move; a different scale: the two pictures fade
    vec3 color = crossfade
      ? mix(shade(from, maxFrom, ground), shade(to, maxTo, ground), blend)
      : shade(mix(from, to, blend), maxTo, ground);
    // fades from the plain imagery, so the hand-over to the Earth underneath is seamless
    gl_FragColor = vec4(mix(rgb, color, presence), 1.0);
  }`;

type FieldLayerProps = {
  earth: Texture;
  values: ArrayLike<number | null>;
  mask?: ArrayLike<number> | null;
  nlat: number;
  nlon: number;
  max: number;
  colors: [number, number, number][];
  opacity?: number;
  transition?: number; // seconds to move into a new field, and to fade in or out; 0 switches at once
  visible?: boolean;
};

type Frames = {
  from: DataTexture;
  to: DataTexture;
  fromData: Float32Array;
  toData: Float32Array;
  fromMax: number;
  toMax: number;
  crossfade: boolean;
  t: number;
  started: boolean;
};

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export default function FieldLayer({
  earth,
  values,
  mask = null,
  nlat,
  nlon,
  max,
  colors,
  opacity = 0.6,
  transition = 0,
  visible = true,
}: FieldLayerProps) {
  const invalidate = useThree((s) => s.invalidate);
  const mesh = useRef<Mesh>(null);
  const warmedUp = useRef(false);
  const presence = useRef({ value: 0, started: false });
  const frames = useRef<Frames | null>(null);
  const grid = useMemo(() => fieldGrid(smoothField(values, nlat, nlon), mask, nlat, nlon), [values, mask, nlat, nlon]);
  const size = useRef<FieldGrid | null>(null);

  useEffect(() => {
    const f = frames.current;
    if (f && size.current === grid && f.toMax === max) return;
    const sameShape = f && size.current?.width === grid.width && size.current.height === grid.height;
    size.current = grid;
    if (!f || !sameShape) {
      f?.from.dispose();
      f?.to.dispose();
      frames.current = {
        from: createFieldTexture(grid),
        to: createFieldTexture(grid),
        fromData: grid.data,
        toData: grid.data,
        fromMax: max,
        toMax: max,
        crossfade: false,
        t: 1,
        started: true,
      };
    } else if (transition <= 0) {
      updateFieldTexture(f.to, grid.data);
      Object.assign(f, { toData: grid.data, fromMax: max, toMax: max, t: 1 });
    } else {
      // start from whatever is on screen, even when a transition is still running;
      // a fade cut short restarts from whichever picture was already more visible
      const running = f.t < 1;
      if (running && !f.crossfade) {
        const k = ease(f.t);
        const shown = f.fromData.map((v, i) => v + (f.toData[i] - v) * k);
        updateFieldTexture(f.from, shown);
        Object.assign(f, { fromData: shown, fromMax: f.toMax });
      } else if (!running || f.t > 0.5) {
        [f.from, f.to] = [f.to, f.from];
        Object.assign(f, { fromData: f.toData, fromMax: f.toMax });
      }
      updateFieldTexture(f.to, grid.data);
      Object.assign(f, { toData: grid.data, toMax: max, crossfade: f.fromMax !== max, t: 0, started: false });
    }
    invalidate();
  }, [grid, max, transition, invalidate]);

  useEffect(() => {
    presence.current.started = false;
    invalidate();
  }, [visible, invalidate]);

  useEffect(
    () => () => {
      frames.current?.from.dispose();
      frames.current?.to.dispose();
    },
    [],
  );

  const material = useMemo(
    () => ({
      vertexShader,
      fragmentShader: fragmentShader(colors.length),
      uniforms: {
        earth: { value: null as Texture | null },
        fieldFrom: { value: null as Texture | null },
        fieldTo: { value: null as Texture | null },
        blend: { value: 1 },
        crossfade: { value: false },
        fieldSize: { value: new Vector2() },
        maxFrom: { value: 1 },
        maxTo: { value: 1 },
        opacity: { value: 0.6 },
        presence: { value: 0 },
        palette: { value: colors.map(([r, g, b]) => new Vector3(r / 255, g / 255, b / 255)) },
      },
    }),
    [colors],
  );

  useFrame((_, delta) => {
    const f = frames.current;
    if (!f || !size.current) return;
    // a hitch (shader compile, tab switch) should not swallow a transition
    const step = Math.min(delta, 0.1);
    if (f.t < 1) {
      // the first frame can carry an idle gap, so the clock starts on the next one
      if (f.started) f.t = Math.min(1, f.t + step / transition);
      f.started = true;
      invalidate();
    }
    const p = presence.current;
    const target = visible ? 1 : 0;
    if (p.value !== target) {
      const change = transition > 0 ? (p.started ? step / transition : 0) : 1;
      p.value = target > p.value ? Math.min(1, p.value + change) : Math.max(0, p.value - change);
      p.started = true;
      invalidate();
    }
    // drawn once while invisible (presence 0 looks exactly like the Earth), so the shader and textures
    // are ready before the first fade-in instead of stalling its first frame
    if (mesh.current) mesh.current.visible = p.value > 0 || !warmedUp.current;
    warmedUp.current = true;
    const u = material.uniforms;
    u.earth.value = earth;
    u.fieldFrom.value = f.from;
    u.fieldTo.value = f.to;
    u.blend.value = ease(f.t);
    u.fieldSize.value.set(size.current.width, size.current.height);
    u.crossfade.value = f.crossfade;
    u.maxFrom.value = f.fromMax;
    u.maxTo.value = f.toMax;
    u.opacity.value = opacity;
    u.presence.value = ease(p.value);
  });

  // drawn before the Earth, so the depth test skips shading the globe underneath
  return (
    <mesh ref={mesh} renderOrder={-1} raycast={() => null} visible={false}>
      <sphereGeometry args={[1.0002, 192, 96]} />
      <shaderMaterial args={[material]} toneMapped={false} />
    </mesh>
  );
}

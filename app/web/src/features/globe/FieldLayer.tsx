// gridded field drawn over a muted Earth: color bands and anti-aliased contour lines

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector2, Vector3, Vector4, type DataTexture, type Mesh, type Texture } from "three";
import type { GridGeometry } from "@/api/types";
import { BANDS, type Rgb } from "@/features/trendmap/styles";
import { loadLandMask } from "./landMask";
import { createFieldTexture, prepareField, updateFieldTexture, type FieldGrid } from "./field";

const vertexShader = `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragmentShader = (bands: number) => `
  uniform sampler2D earth;
  uniform sampler2D landMask;
  uniform float domain; // 0 global, 1 ocean only, 2 land only
  uniform sampler2D fieldFrom;
  uniform sampler2D fieldTo;
  uniform vec2 sizeFrom;
  uniform vec2 sizeTo;
  uniform vec4 placeFrom;
  uniform vec4 placeTo;
  uniform vec4 rangeFrom; // low, high, fade, isobars
  uniform vec4 rangeTo;
  uniform float stippleFrom;
  uniform float stippleTo;
  uniform float blend;
  uniform bool crossfade;
  uniform float opacity;
  uniform float presence;
  uniform float degPerPx; // degrees of arc per pixel where the globe faces the camera; changes only with zoom
  uniform vec3 palette[${bands * 2}]; // the "from" palette, then the "to" palette
  varying vec3 vDir;

  // exact sRGB encoding, the same the Earth material outputs, so a hidden layer matches it pixel for pixel
  vec3 toSrgb(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }

  // place: first texel's lon/lat and the texel spacing in degrees; longitude wraps through the texture
  vec4 sampleField(sampler2D field, vec2 size, vec4 place, vec2 lonLat) {
    vec2 node = (lonLat - place.xy) / place.zw;
    return texture2D(field, (node + 0.5) / size);
  }

  // one dot of a lat/lon lattice with this spacing, painted on the surface (about 1.3 px across at the centre)
  float dotAt(vec2 lonLat, float spacing) {
    float c = max(cos(radians(lonLat.y)), 0.05);
    float sx = spacing * exp2(floor(log2(1.0 / c) + 0.5));
    vec2 g = (fract(lonLat / vec2(sx, spacing) + 0.5) - 0.5) * vec2(sx * c, spacing);
    return 1.0 - smoothstep(0.8, 1.5, length(g) / degPerPx);
  }

  // dots about 7 px apart that depend on zoom only, not on where a pixel sits on the globe; between two
  // power-of-two spacings the extra dots fade, and the coarse lattice is a subset of the fine one
  float stippleDots(vec2 lonLat) {
    float level = log2(degPerPx * 7.0);
    float fine = exp2(floor(level));
    return max(dotAt(lonLat, fine * 2.0), dotAt(lonLat, fine) * (1.0 - fract(level)));
  }

  // cell: value, mask (1 shown, 0 muted), coverage (1 data, 0 none), significance
  vec3 shade(vec4 cell, vec4 range, float stipple, int offset, float dots, float polar, vec3 ground) {
    float t = clamp((cell.r - range.x) / max(range.y - range.x, 1e-6) * 2.0 - 1.0, -1.0, 1.0);
    float band = (t + 1.0) * 0.5 * ${bands}.0;
    vec3 fill = palette[offset + clamp(int(band), 0, ${bands - 1})];
    bool isobars = range.w > 0.5;
    float edge = floor(band + 0.5);
    float gap = abs(band - edge) / max(fwidth(band), 1e-5);
    // isobars on every other band edge, a little heavier than the band lines
    bool onEdge = edge >= 1.0 && edge <= ${bands - 1}.0 && (!isobars || mod(edge, 2.0) < 0.5);
    float line = onEdge ? (1.0 - smoothstep(isobars ? 0.7 : 0.4, isobars ? 1.7 : 1.2, gap)) * polar : 0.0;
    // change palettes fade out near zero
    float strength = range.z > 0.0 ? smoothstep(0.0, range.z, abs(t)) : 1.0;
    // values have no zero to fade around and read better with a fuller fill
    float fillAlpha = isobars ? 0.18 : (range.z > 0.0 ? opacity * strength : min(1.0, opacity + 0.2));
    vec3 lineColor = isobars ? mix(fill, vec3(1.0), 0.2) : fill * 0.55;
    float lineAlpha = line * (isobars ? 0.95 : min(1.0, opacity + 0.15)) * max(strength, isobars ? 0.35 : 0.0);
    vec3 color = mix(mix(ground, fill, fillAlpha), lineColor, lineAlpha);

    float aa = max(fwidth(cell.g), 1e-4);
    float muted = 1.0 - smoothstep(0.5 - aa, 0.5 + aa, cell.g);
    color = mix(color, mix(ground, vec3(0.376, 0.4, 0.455), 0.3), muted);

    float sigAa = max(fwidth(cell.a), 1e-4);
    float significant = smoothstep(0.5 - sigAa, 0.5 + sigAa, cell.a) * stipple;
    color = mix(color, vec3(0.04), dots * significant * 0.8);

    float edgeAa = max(fwidth(cell.b), 1e-4);
    return mix(ground, color, smoothstep(0.5 - edgeAa, 0.5 + edgeAa, cell.b));
  }

  void main() {
    // from the surface position, not the uv: uv longitude breaks down in the triangles at the poles
    vec3 dir = normalize(vDir);
    vec2 lonLat = vec2(degrees(atan(dir.z, -dir.x)) - 180.0, degrees(asin(clamp(dir.y, -1.0, 1.0))));
    lonLat.x += lonLat.x < -180.0 ? 360.0 : 0.0;
    // the imagery too; derivatives taken across the 180 degree seam without the jump, so no seam line
    vec2 uv = vec2((lonLat.x + 180.0) / 360.0, (lonLat.y + 90.0) / 180.0);
    vec2 dx = dFdx(uv);
    vec2 dy = dFdy(uv);
    // longitude texels crowd together toward the poles; without this the pole samples a blurred mip
    float squeeze = cos(radians(lonLat.y));
    dx.x = (dx.x - floor(dx.x + 0.5)) * squeeze;
    dy.x = (dy.x - floor(dy.x + 0.5)) * squeeze;
    vec3 rgb = toSrgb(textureGrad(earth, uv, dx, dy).rgb);
    float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    // lifted darks: forests and deep sea no longer crush to black, so land without data still reads as land
    float grey = clamp(pow(lum, 0.6) * 0.85 + 0.08, 0.0, 1.0);
    vec3 ground = vec3(grey);
    // the dot lattice costs a few transcendental calls per pixel, so only when something is stippled
    float dots = stippleFrom + stippleTo > 0.0 ? stippleDots(lonLat) : 0.0;
    // all meridians meet at a pole, so any band line crossing a nearly flat polar field becomes a spoke
    float polar = smoothstep(88.5, 85.5, abs(lonLat.y));
    // ocean or land variables follow the real coastline: the data's coverage (grown past the coast on the
    // CPU) is cut by the mask, so real gaps in the data stay empty
    float cover = 1.0;
    if (domain > 0.5) {
      float land = textureGrad(landMask, uv, dx, dy).r;
      cover = domain < 1.5 ? 1.0 - land : land;
    }

    vec4 to = sampleField(fieldTo, sizeTo, placeTo, lonLat);
    to.b = min(to.b, cover);
    vec3 color;
    // settled (no transition running): one field, one shade, which is nearly every frame
    if (blend >= 1.0) {
      color = shade(to, rangeTo, stippleTo, ${bands}, dots, polar, ground);
    } else {
      vec4 from = sampleField(fieldFrom, sizeFrom, placeFrom, lonLat);
      from.b = min(from.b, cover);
      // same quantity and scale: the values morph, so contours move; otherwise the two pictures fade
      color = crossfade
        ? mix(shade(from, rangeFrom, stippleFrom, 0, dots, polar, ground), shade(to, rangeTo, stippleTo, ${bands}, dots, polar, ground), blend)
        : shade(mix(from, to, blend), rangeTo, stippleTo, ${bands}, dots, polar, ground);
    }
    // fades from the plain imagery, so the hand-over to the Earth underneath is seamless
    gl_FragColor = vec4(mix(rgb, color, presence), 1.0);
  }`;

// how a field is coloured: BANDS colours spread from lo to hi
export type FieldLook = {
  palette: Rgb[];
  lo: number;
  hi: number;
  fade: number; // share of the scale around zero that fades out (0: none)
  isobars: boolean;
  stipple: boolean; // dots where sig is set
};

type FieldLayerProps = {
  earth: Texture;
  values: ArrayLike<number | null>; // null where a cell has no data
  domain?: "global" | "land" | "ocean";
  mask?: ArrayLike<number> | null;
  sig?: ArrayLike<number> | null;
  nlat: number;
  nlon: number;
  grid: GridGeometry;
  look: FieldLook;
  quantity?: string; // what the values are; a change crossfades instead of morphing
  opacity?: number;
  transition?: number; // seconds to move into a new field, and to fade in or out; 0 switches at once
  visible?: boolean;
};

type Slot = { texture: DataTexture; field: FieldGrid; look: FieldLook };

type Frames = { from: Slot; to: Slot; quantity: string; crossfade: boolean; t: number; started: boolean };

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

const sameShape = (a: FieldGrid, b: FieldGrid) =>
  a.width === b.width && a.height === b.height && a.origin.every((v, i) => v === b.origin[i]);

// same colours for the same numbers, so a change of data can morph
const sameScale = (a: FieldLook, b: FieldLook) =>
  a.palette === b.palette && a.lo === b.lo && a.hi === b.hi && a.fade === b.fade && a.isobars === b.isobars;

function makeSlot(field: FieldGrid, look: FieldLook): Slot {
  return { texture: createFieldTexture(field), field, look };
}

function refill(slot: Slot, field: FieldGrid, look: FieldLook) {
  if (sameShape(slot.field, field)) updateFieldTexture(slot.texture, field);
  else {
    slot.texture.dispose();
    slot.texture = createFieldTexture(field);
  }
  slot.field = field;
  slot.look = look;
}

const setRange = (target: Vector4, look: FieldLook) => target.set(look.lo, look.hi, look.fade, look.isobars ? 1 : 0);

const place = (target: Vector4, field: FieldGrid) => target.set(field.origin[0], field.origin[1], field.step[0], field.step[1]);

export default function FieldLayer({
  earth,
  values,
  domain = "global",
  mask = null,
  sig = null,
  nlat,
  nlon,
  grid,
  look,
  quantity = "",
  opacity = 0.6,
  transition = 0,
  visible = true,
}: FieldLayerProps) {
  const invalidate = useThree((s) => s.invalidate);
  const mesh = useRef<Mesh>(null);
  const warmedUp = useRef(false);
  const presence = useRef({ value: 0, started: false });
  const frames = useRef<Frames | null>(null);
  const [landMask, setLandMask] = useState<Texture | null>(null);
  // built the first time an ocean or land variable needs it, not for every visit to the map
  useEffect(() => {
    if (domain === "global" || landMask) return;
    let active = true;
    void loadLandMask().then((mask) => active && setLandMask(mask));
    return () => {
      active = false;
    };
  }, [domain, landMask]);
  const field = useMemo(
    () => prepareField(values, mask, sig, nlat, nlon, grid, domain !== "global"),
    [values, mask, sig, nlat, nlon, grid, domain],
  );

  useEffect(() => {
    const f = frames.current;
    if (f && f.to.field === field && f.to.look === look && f.quantity === quantity) return;
    if (!f) {
      frames.current = { from: makeSlot(field, look), to: makeSlot(field, look), quantity, crossfade: false, t: 1, started: true };
    } else if (f.to.field === field && f.quantity === quantity && sameScale(f.to.look, look)) {
      // only stippling changed: no transition needed
      f.to.look = look;
    } else if (transition <= 0) {
      refill(f.to, field, look);
      Object.assign(f, { quantity, t: 1 });
    } else {
      const morph = f.quantity === quantity && sameScale(f.to.look, look) && sameShape(f.to.field, field);
      // start from whatever is on screen, even when a transition is still running;
      // a fade cut short restarts from whichever picture was already more visible
      const running = f.t < 1;
      if (running && !f.crossfade) {
        const k = ease(f.t);
        const shown = f.from.field.data.map((v, i) => v + (f.to.field.data[i] - v) * k);
        refill(f.from, { ...f.to.field, data: shown, half: undefined }, f.to.look);
      } else if (!running || f.t > 0.5) {
        [f.from, f.to] = [f.to, f.from];
      }
      refill(f.to, field, look);
      Object.assign(f, { quantity, crossfade: !morph, t: 0, started: false });
    }
    invalidate();
  }, [field, look, quantity, transition, invalidate]);

  useEffect(() => {
    presence.current.started = false;
    invalidate();
  }, [visible, invalidate]);

  useEffect(() => invalidate(), [opacity, invalidate]);

  useEffect(
    () => () => {
      frames.current?.from.texture.dispose();
      frames.current?.to.texture.dispose();
    },
    [],
  );

  const material = useMemo(
    () => ({
      vertexShader,
      fragmentShader: fragmentShader(BANDS),
      uniforms: {
        earth: { value: null as Texture | null },
        landMask: { value: null as Texture | null },
        domain: { value: 0 },
        fieldFrom: { value: null as Texture | null },
        fieldTo: { value: null as Texture | null },
        sizeFrom: { value: new Vector2() },
        sizeTo: { value: new Vector2() },
        placeFrom: { value: new Vector4() },
        placeTo: { value: new Vector4() },
        rangeFrom: { value: new Vector4(-1, 1, 0, 0) },
        rangeTo: { value: new Vector4(-1, 1, 0, 0) },
        stippleFrom: { value: 0 },
        stippleTo: { value: 0 },
        blend: { value: 1 },
        crossfade: { value: false },
        opacity: { value: 0.6 },
        presence: { value: 0 },
        degPerPx: { value: 0.1 },
        palette: { value: Array.from({ length: BANDS * 2 }, () => new Vector3()) },
      },
    }),
    [],
  );

  useFrame(({ camera, size }, delta) => {
    const f = frames.current;
    if (!f) return;
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
    u.landMask.value = landMask;
    // until the mask has loaded, fall back to the data coverage
    u.domain.value = landMask ? (domain === "ocean" ? 1 : domain === "land" ? 2 : 0) : 0;
    u.fieldFrom.value = f.from.texture;
    u.fieldTo.value = f.to.texture;
    u.sizeFrom.value.set(f.from.field.width, f.from.field.height);
    u.sizeTo.value.set(f.to.field.width, f.to.field.height);
    place(u.placeFrom.value, f.from.field);
    place(u.placeTo.value, f.to.field);
    setRange(u.rangeFrom.value, f.from.look);
    setRange(u.rangeTo.value, f.to.look);
    u.stippleFrom.value = f.from.look.stipple ? 1 : 0;
    u.stippleTo.value = f.to.look.stipple ? 1 : 0;
    const palette = u.palette.value;
    f.from.look.palette.forEach(([r, g, b], k) => palette[k].set(r / 255, g / 255, b / 255));
    f.to.look.palette.forEach(([r, g, b], k) => palette[BANDS + k].set(r / 255, g / 255, b / 255));
    u.blend.value = ease(f.t);
    u.crossfade.value = f.crossfade;
    u.opacity.value = opacity;
    u.presence.value = ease(p.value);
    // the surface point nearest the camera is distance - 1 away
    const fov = "fov" in camera ? ((camera.fov as number) * Math.PI) / 180 : 0.8;
    const unitsPerPx = (2 * Math.max(camera.position.length() - 1, 0.01) * Math.tan(fov / 2)) / size.height;
    u.degPerPx.value = (unitsPerPx * 180) / Math.PI;
  });

  // drawn before the Earth, so the depth test skips shading the globe underneath
  return (
    <mesh ref={mesh} renderOrder={-1} raycast={() => null} visible={false}>
      <sphereGeometry args={[1.0002, 192, 96]} />
      <shaderMaterial args={[material]} toneMapped={false} />
    </mesh>
  );
}

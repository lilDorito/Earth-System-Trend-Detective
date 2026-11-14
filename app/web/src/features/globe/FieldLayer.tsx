// gridded field drawn over a muted Earth: color bands and anti-aliased contour lines

import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Vector2, Vector3, type DataTexture, type Texture } from "three";
import { createFieldTexture, fieldTextureData, smoothField } from "./field";

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragmentShader = (bands: number) => `
  uniform sampler2D earth;
  uniform sampler2D field;
  uniform vec2 fieldSize;
  uniform float maxValue;
  uniform vec3 palette[${bands}];
  varying vec2 vUv;

  void main() {
    vec3 rgb = pow(texture2D(earth, vUv).rgb, vec3(1.0 / 2.2));
    float grey = clamp((dot(rgb, vec3(0.2126, 0.7152, 0.0722)) * 0.9 - 0.5) * 1.2 + 0.5, 0.0, 1.0);
    vec3 ground = vec3(grey);

    // grid rows run pole to pole, columns start at -180° and wrap
    vec2 node = vUv * vec2(fieldSize.x, fieldSize.y - 1.0);
    vec2 cell = texture2D(field, (node + 0.5) / fieldSize).rg;

    float band = (clamp(cell.r / maxValue, -1.0, 1.0) + 1.0) * 0.5 * ${bands}.0;
    vec3 fill = palette[clamp(int(band), 0, ${bands - 1})];
    float edge = round(band);
    float gap = abs(band - edge) / max(fwidth(band), 1e-5);
    float line = edge >= 1.0 && edge <= ${bands - 1}.0 ? 1.0 - smoothstep(0.4, 1.2, gap) : 0.0;
    vec3 color = mix(ground, mix(fill, fill * 0.55, line), mix(0.88, 0.95, line));

    float aa = max(fwidth(cell.g), 1e-4);
    float muted = 1.0 - smoothstep(0.5 - aa, 0.5 + aa, cell.g);
    color = mix(color, mix(ground, vec3(0.376, 0.4, 0.455), 0.3), muted);
    gl_FragColor = vec4(color, 1.0);
  }`;

type FieldLayerProps = {
  earth: Texture;
  values: ArrayLike<number | null>;
  mask?: ArrayLike<number> | null;
  nlat: number;
  nlon: number;
  max: number;
  colors: [number, number, number][];
};

export default function FieldLayer({ earth, values, mask = null, nlat, nlon, max, colors }: FieldLayerProps) {
  const invalidate = useThree((s) => s.invalidate);
  const texture = useRef<DataTexture | null>(null);
  const data = useMemo(() => fieldTextureData(smoothField(values, nlat, nlon), mask, nlat, nlon), [values, mask, nlat, nlon]);

  // one texture, refilled in place, so stepping through years never reallocates GPU memory
  const current = texture.current;
  if (current && current.image.width === data.width && current.image.height === data.height) {
    if (current.image.data !== data.data) {
      current.image.data = data.data;
      current.needsUpdate = true;
    }
  } else {
    current?.dispose();
    texture.current = createFieldTexture(data);
  }

  const material = useMemo(
    () => ({
      vertexShader,
      fragmentShader: fragmentShader(colors.length),
      uniforms: {
        earth: { value: null as Texture | null },
        field: { value: null as Texture | null },
        fieldSize: { value: new Vector2() },
        maxValue: { value: 1 },
        palette: { value: colors.map(([r, g, b]) => new Vector3(r / 255, g / 255, b / 255)) },
      },
    }),
    [colors],
  );
  material.uniforms.earth.value = earth;
  material.uniforms.field.value = texture.current;
  material.uniforms.fieldSize.value.set(data.width, data.height);
  material.uniforms.maxValue.value = max;

  useEffect(() => invalidate());
  useEffect(() => () => texture.current?.dispose(), []);

  // drawn before the Earth, so the depth test skips shading the globe underneath
  return (
    <mesh renderOrder={-1} raycast={() => null}>
      <sphereGeometry args={[1.0002, 192, 96]} />
      <shaderMaterial args={[material]} toneMapped={false} />
    </mesh>
  );
}

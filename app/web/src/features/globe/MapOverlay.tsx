// borders, coastlines, and zoom-dependent country and city labels

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { latLonToVector } from "./geo";
import { loadCities, loadCountries, type City, type Countries } from "./geodata";

const COUNTRY_CLASS =
  "absolute left-0 top-0 whitespace-nowrap text-[10px] font-medium uppercase tracking-[0.14em] text-white/75 invisible select-none [text-shadow:0_0_3px_rgb(0_0_0),0_0_6px_rgb(0_0_0)]";
const CITY_CLASS =
  "absolute left-0 top-0 flex items-center gap-1.5 whitespace-nowrap text-[12px] text-white invisible select-none pointer-events-auto cursor-pointer transition-colors hover:text-primary [text-shadow:0_0_3px_rgb(0_0_0),0_0_6px_rgb(0_0_0)]";
const DOT_CLASS = "size-[5px] shrink-0 rounded-full bg-white ring-1 ring-black/60";
const CAPITAL_DOT_CLASS = "size-[7px] shrink-0 rounded-full border-[1.5px] border-white bg-black/40 ring-1 ring-black/60";

const MARKER_CLASS = "pointer-events-none absolute left-0 top-0 z-10 size-[11px] invisible";
const MARKER_PULSE_CLASS = "absolute inset-0 rounded-full bg-[#fbbf24] animate-marker-pulse";
const MARKER_DOT_CLASS = "absolute inset-0 rounded-full border-2 border-black bg-[#fbbf24]";

const MIN_FACING = 0.3;

// 1 while zoomed out, 0 once cities have taken over
const countryFade = (distance: number) => Math.min(1, Math.max(0, (distance - 1.5) / 0.45));
// smallest population shown at a given zoom
const cityThreshold = (distance: number) => (distance > 2.4 ? Infinity : 8e6 * Math.min(1, (distance - 1) / 1.3) ** 3);
// smallest country area (steradians) labelled at a given zoom
const areaThreshold = (distance: number) => 0.004 * Math.max((distance - 1) / 1.9, 0) ** 2.5;

type Chunk = { line: LineSegments2; center: Vector3; reach: number };

const CHUNK_DEG = 30;

// segments grouped by area, so lines behind the horizon or off screen are not processed at all
function buildChunks(positions: Float32Array, material: LineMaterial): Chunk[] {
  const cols = 360 / CHUNK_DEG;
  const bins = new Map<number, number[]>();
  for (let k = 0; k < positions.length; k += 6) {
    const x = positions[k] + positions[k + 3];
    const y = positions[k + 1] + positions[k + 4];
    const z = positions[k + 2] + positions[k + 5];
    const lat = (Math.asin(y / Math.hypot(x, y, z)) * 180) / Math.PI + 90;
    const lon = (Math.atan2(z, x) * 180) / Math.PI + 180;
    const bin = Math.min(180 / CHUNK_DEG - 1, Math.floor(lat / CHUNK_DEG)) * cols + Math.min(cols - 1, Math.floor(lon / CHUNK_DEG));
    let list = bins.get(bin);
    if (!list) bins.set(bin, (list = []));
    for (let i = 0; i < 6; i++) list.push(positions[k + i]);
  }
  const point = new Vector3();
  return [...bins.values()].map((list) => {
    const center = new Vector3();
    for (let k = 0; k < list.length; k += 3) center.add(point.fromArray(list, k).normalize());
    center.normalize();
    let reach = 0;
    for (let k = 0; k < list.length; k += 3) reach = Math.max(reach, point.fromArray(list, k).normalize().angleTo(center));
    const line = new LineSegments2(new LineSegmentsGeometry().setPositions(list), material);
    return { line, center, reach };
  });
}

function Borders({ positions, width, opacity }: { positions: Float32Array; width: number; opacity: number }) {
  const size = useThree((s) => s.size);
  const material = useMemo(
    () => new LineMaterial({ color: 0xffffff, linewidth: width, transparent: true, opacity, depthWrite: false }),
    [width, opacity],
  );
  const chunks = useMemo(() => buildChunks(positions, material), [positions, material]);
  const view = useMemo(() => new Vector3(), []);

  useEffect(() => {
    material.resolution.set(size.width, size.height);
  }, [material, size]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => chunks.forEach((c) => c.line.geometry.dispose()), [chunks]);

  useFrame(({ camera }) => {
    const distance = camera.position.length();
    const horizon = Math.acos(Math.min(1, 1 / distance));
    view.copy(camera.position).normalize();
    for (const { line, center, reach } of chunks) line.visible = center.angleTo(view) < reach + horizon;
  });

  return (
    <>
      {chunks.map(({ line }) => (
        <primitive key={line.id} object={line} />
      ))}
    </>
  );
}

type Label = {
  el: HTMLElement;
  width: number;
  position: Vector3;
  normal: Vector3;
  dot: number;
  shown?: boolean;
  opacity?: string;
  transform?: string;
};

// touch the DOM only when something actually changed
function hide(label: Label) {
  if (label.shown === false) return;
  label.shown = false;
  label.el.style.visibility = "hidden";
}

function show(label: Label, opacity: string, transform: string) {
  if (!label.shown) {
    label.shown = true;
    label.el.style.visibility = "visible";
  }
  if (label.opacity !== opacity) label.el.style.opacity = label.opacity = opacity;
  if (label.transform !== transform) label.el.style.transform = label.transform = transform;
}

function createLabel(text: string, className: string, dotClass?: string) {
  const el = document.createElement("span");
  el.className = className;
  if (dotClass) {
    const dot = document.createElement("i");
    dot.className = dotClass;
    el.append(dot);
  }
  el.append(text);
  return el;
}

export type PickHandler = (lat: number, lon: number, name?: string) => void;

type LatLon = { lat: number; lon: number };

function Labels({ countries, cities, container, onPick, onClear, marker }: {
  countries: Countries;
  cities: City[];
  container: RefObject<HTMLDivElement | null>;
  onPick: RefObject<PickHandler | undefined>;
  onClear: RefObject<(() => void) | undefined>;
  marker?: LatLon | null;
}) {
  const canvas = useThree((s) => s.gl.domElement);
  const countryLabels = useRef<Label[]>([]);
  const cityLabels = useRef<(Label & { city: City })[]>([]);
  const projected = useMemo(() => new Vector3(), []);
  const view = useMemo(() => new Vector3(), []);
  const invalidate = useThree((s) => s.invalidate);
  // camera matrix and screen size of the last layout; cleared whenever labels need a fresh pass
  const laidOut = useRef<number[] | null>(null);
  // the selected point lives in this layer too, so city dots can never cover it
  const markerEl = useMemo(() => {
    const el = document.createElement("div");
    el.className = MARKER_CLASS;
    for (const className of [MARKER_PULSE_CLASS, MARKER_DOT_CLASS]) {
      const part = document.createElement("span");
      part.className = className;
      el.append(part);
    }
    return el;
  }, []);
  const markerAt = useMemo(() => (marker ? latLonToVector(marker.lat, marker.lon, 1) : null), [marker]);
  const pickedCity = useRef<(Label & { city: City }) | null>(null);

  useEffect(() => {
    const root = container.current;
    if (!root) return;
    countryLabels.current = countries.labels.map((c) => ({
      el: createLabel(c.name, COUNTRY_CLASS),
      width: 0,
      position: c.position,
      normal: c.normal,
      dot: 0,
    }));
    cityLabels.current = cities.map((city) => ({
      el: createLabel(city.name, CITY_CLASS, city.capital ? CAPITAL_DOT_CLASS : DOT_CLASS),
      width: 0,
      position: city.position,
      normal: city.normal,
      dot: city.capital ? 3.5 : 2.5,
      city,
    }));
    for (const label of cityLabels.current) {
      const { city, el } = label;
      el.addEventListener("click", () => onPick.current?.(city.lat, city.lon, city.name));
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        onClear.current?.();
      });
      // keep scroll-zoom working when the cursor is over a label
      el.addEventListener(
        "wheel",
        (e) => {
          e.preventDefault();
          canvas.dispatchEvent(new WheelEvent("wheel", e));
        },
        { passive: false },
      );
    }
    const all = [...countryLabels.current, ...cityLabels.current];
    root.replaceChildren(...all.map((l) => l.el), markerEl);
    const measure = () => {
      all.forEach((l) => (l.width = l.el.offsetWidth));
      laidOut.current = null;
      invalidate();
    };
    measure();
    void document.fonts.ready.then(measure);
    return () => root.replaceChildren();
  }, [countries, cities, container, canvas, onPick, onClear, invalidate, markerEl]);

  // a picked city keeps its label on screen, and the marker takes the place of its dot
  useEffect(() => {
    const previous = pickedCity.current;
    if (previous) (previous.el.firstElementChild as HTMLElement).style.visibility = "";
    pickedCity.current =
      (marker &&
        cityLabels.current.find(
          ({ city }) => Math.abs(city.lat - marker.lat) < 1e-4 && Math.abs(city.lon - marker.lon) < 1e-4,
        )) ||
      null;
    if (pickedCity.current) (pickedCity.current.el.firstElementChild as HTMLElement).style.visibility = "hidden";
    // restart the pulse for the new point
    const pulse = markerEl.firstElementChild!;
    pulse.replaceWith(pulse.cloneNode());
    laidOut.current = null;
    invalidate();
  }, [marker, cities, countries, markerEl, invalidate]);

  useFrame(({ camera, size }) => {
    // matrices are normally refreshed during render, i.e. after this runs; without this labels trail a frame
    camera.updateMatrixWorld();
    const key = [...camera.matrixWorld.elements, size.width, size.height];
    if (laidOut.current?.every((v, i) => v === key[i])) return;
    laidOut.current = key;
    const distance = camera.position.length();
    const fade = countryFade(distance);
    const minPopulation = cityThreshold(distance);
    const minArea = areaThreshold(distance);
    view.copy(camera.position).normalize();
    const placed: number[][] = [];

    const place = (label: Label, visible: boolean, opacity: number) => {
      const facing = label.normal.dot(view);
      if (!visible || facing < MIN_FACING) return hide(label);
      projected.copy(label.position).project(camera);
      const x = ((projected.x + 1) / 2) * size.width;
      const y = ((1 - projected.y) / 2) * size.height;
      // cities are anchored on their dot, countries on their centre
      const left = label.dot ? x - label.dot : x - label.width / 2;
      const box = [left - 3, y - 8, left + label.width + 3, y + 8];
      if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) return hide(label);
      placed.push(box);
      const alpha = Math.round(opacity * Math.min(1, (facing - MIN_FACING) / 0.25) * 20) / 20;
      show(label, String(alpha), `translate3d(${left.toFixed(1)}px, ${(y - 8).toFixed(1)}px, 0)`);
    };

    if (markerAt) {
      const facing = markerAt.dot(view);
      projected.copy(markerAt).project(camera);
      const x = ((projected.x + 1) / 2) * size.width - 5.5;
      const y = ((1 - projected.y) / 2) * size.height - 5.5;
      markerEl.style.visibility = facing > 0 ? "visible" : "hidden";
      markerEl.style.opacity = String(Math.min(1, facing / 0.1));
      markerEl.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    } else {
      markerEl.style.visibility = "hidden";
    }

    const picked = pickedCity.current;
    if (picked) place(picked, true, 1);

    // labels already on screen keep their spot, so nothing flickers while the globe moves
    const placeStable = <T extends Label>(labels: T[], visible: (label: T, i: number) => boolean, opacity: number) => {
      const later: T[] = [];
      labels.forEach((label, i) => {
        if ((label as Label) === picked) return;
        if (!visible(label, i)) return hide(label);
        if (label.shown) place(label, true, opacity);
        else later.push(label);
      });
      later.forEach((label) => place(label, true, opacity));
    };
    const placeCountries = () =>
      placeStable(countryLabels.current, (_, i) => fade > 0.05 && countries.labels[i].area >= minArea, fade);
    const placeCities = () =>
      placeStable(
        cityLabels.current,
        ({ city }) => (city.capital ? city.population * 2 : city.population) >= minPopulation,
        1,
      );

    if (fade >= 0.5) {
      placeCountries();
      placeCities();
    } else {
      placeCities();
      placeCountries();
    }
  });

  return null;
}

type MapOverlayProps = {
  labels: RefObject<HTMLDivElement | null>;
  onPick?: PickHandler;
  onClear?: () => void;
  marker?: LatLon | null;
  onReady?: () => void;
};

export default function MapOverlay({ labels, onPick, onClear, marker, onReady }: MapOverlayProps) {
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const clearRef = useRef(onClear);
  clearRef.current = onClear;
  const [countries, setCountries] = useState<Countries | null>(null);
  const [cities, setCities] = useState<City[] | null>(null);

  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    let active = true;
    void Promise.all([loadCountries(), loadCities()]).then(([countries, cities]) => {
      if (!active) return;
      setCountries(countries);
      setCities(cities);
      readyRef.current?.();
    });
    return () => {
      active = false;
    };
  }, []);

  if (!countries) return null;
  return (
    <>
      <Borders positions={countries.coasts} width={1} opacity={0.5} />
      <Borders positions={countries.borders} width={1.3} opacity={0.8} />
      {cities && <Labels countries={countries} cities={cities} container={labels} onPick={pickRef} onClear={clearRef} marker={marker} />}
    </>
  );
}

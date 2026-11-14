// borders, coastlines, and zoom-dependent country and city labels

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { loadCities, loadCountries, type City, type Countries } from "./geodata";

const COUNTRY_CLASS =
  "absolute left-0 top-0 whitespace-nowrap text-[10px] font-medium uppercase tracking-[0.14em] text-white/75 invisible select-none [text-shadow:0_0_3px_rgb(0_0_0),0_0_6px_rgb(0_0_0)]";
const CITY_CLASS =
  "absolute left-0 top-0 flex items-center gap-1.5 whitespace-nowrap text-[12px] text-white invisible select-none pointer-events-auto cursor-pointer transition-colors hover:text-primary [text-shadow:0_0_3px_rgb(0_0_0),0_0_6px_rgb(0_0_0)]";
const DOT_CLASS = "size-[5px] shrink-0 rounded-full bg-white ring-1 ring-black/60";
const CAPITAL_DOT_CLASS = "size-[7px] shrink-0 rounded-full border-[1.5px] border-white bg-black/40 ring-1 ring-black/60";

const MIN_FACING = 0.3;

// 1 while zoomed out, 0 once cities have taken over
const countryFade = (distance: number) => Math.min(1, Math.max(0, (distance - 1.5) / 0.45));
// smallest population shown at a given zoom
const cityThreshold = (distance: number) => (distance > 2.4 ? Infinity : 8e6 * Math.min(1, (distance - 1) / 1.3) ** 3);
// smallest country area (steradians) labelled at a given zoom
const areaThreshold = (distance: number) => 0.004 * Math.max((distance - 1) / 1.9, 0) ** 2.5;

function Borders({ positions, width, opacity, color = 0xffffff }: { positions: Float32Array; width: number; opacity: number; color?: number }) {
  const size = useThree((s) => s.size);
  const line = useMemo(() => {
    const geometry = new LineSegmentsGeometry().setPositions(positions);
    const material = new LineMaterial({ color, linewidth: width, transparent: true, opacity, depthWrite: false });
    return new LineSegments2(geometry, material);
  }, [positions, width, opacity, color]);

  useEffect(() => {
    line.material.resolution.set(size.width, size.height);
  }, [line, size]);
  useEffect(
    () => () => {
      line.geometry.dispose();
      line.material.dispose();
    },
    [line],
  );

  return <primitive object={line} />;
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

function Labels({ countries, cities, container, onPick, marker }: {
  marker?: { lat: number; lon: number } | null;
  countries: Countries;
  cities: City[];
  container: RefObject<HTMLDivElement | null>;
  onPick: RefObject<PickHandler | undefined>;
}) {
  const canvas = useThree((s) => s.gl.domElement);
  const countryLabels = useRef<Label[]>([]);
  const cityLabels = useRef<(Label & { city: City })[]>([]);
  const projected = useMemo(() => new Vector3(), []);
  const view = useMemo(() => new Vector3(), []);

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
    root.replaceChildren(...all.map((l) => l.el));
    const measure = () => all.forEach((l) => (l.width = l.el.offsetWidth));
    measure();
    void document.fonts.ready.then(measure);
    return () => root.replaceChildren();
  }, [countries, cities, container, canvas, onPick]);

  // the picked city's dot turns into the yellow marker, drawn above the label layer
  useEffect(() => {
    for (const { city, el } of cityLabels.current) {
      const dot = el.firstElementChild as HTMLElement | null;
      if (!dot) continue;
      const on = !!marker && Math.abs(city.lat - marker.lat) < 1e-4 && Math.abs(city.lon - marker.lon) < 1e-4;
      dot.style.background = on ? "#fbbf24" : "";
      dot.style.borderColor = on ? "#fbbf24" : "";
      dot.style.transform = on ? "scale(1.6)" : "";
      dot.style.boxShadow = on ? "0 0 0 3px rgba(251,191,36,0.35)" : "";
      el.style.zIndex = on ? "10" : "";
    }
  }, [marker, cities, countries]);

  useFrame(({ camera, size }) => {
    // matrices are normally refreshed during render, i.e. after this runs; without this labels trail a frame
    camera.updateMatrixWorld();
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

    // labels already on screen keep their spot, so nothing flickers while the globe moves
    const placeStable = <T extends Label>(labels: T[], visible: (label: T, i: number) => boolean, opacity: number) => {
      const later: T[] = [];
      labels.forEach((label, i) => {
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

type MapOverlayProps = { labels: RefObject<HTMLDivElement | null>; onPick?: PickHandler; marker?: { lat: number; lon: number } | null };

export default function MapOverlay({ labels, onPick, marker }: MapOverlayProps) {
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const [countries, setCountries] = useState<Countries | null>(null);
  const [cities, setCities] = useState<City[] | null>(null);

  useEffect(() => {
    let active = true;
    void loadCountries().then((d) => active && setCountries(d));
    void loadCities().then((d) => active && setCities(d));
    return () => {
      active = false;
    };
  }, []);

  if (!countries) return null;
  return (
    <>
      <Borders positions={countries.coasts} width={1} opacity={0.5} />
      <Borders positions={countries.borders} width={1.3} opacity={0.8} />
      {cities && <Labels countries={countries} cities={cities} container={labels} onPick={pickRef} marker={marker} />}
    </>
  );
}

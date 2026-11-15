// borders of states, oblasts and provinces near the middle of the screen, fading in with the zoom

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { loadCountryOutlines, loadRegionLevel, type Ring } from "./boundaries";
import { latLonToVector, vectorToLatLon } from "./geo";
import { toSegments } from "./Outline";

const FADE_START = 1.9; // borders begin to show here and are at full strength by FADE_FULL
const FADE_FULL = 1.55;
const MAX_OPACITY = 0.45; // region borders stay quieter than the country borders
const MAX_REGIONS = 120; // the nearest to the middle; more makes the globe stutter
const CENTRAL = 0.6; // a region counts when part of it is within this share of the screen's width and height
const FADE_SPEED = 7; // per second; about a third of a second to fade
const GRID = 5; // sample points per side of a region's bounding box
const SLATE = 0xcbd5e1;
const DEG = Math.PI / 180;
const VIEW_HALF_ANGLE = 30 * DEG; // from the view axis to a corner of the screen, roughly

const smooth = (t: number) => t * t * (3 - 2 * t);
const wrap = (lon: number) => ((lon + 540) % 360) - 180;

function viewRadius(distance: number) {
  const a = Math.min(VIEW_HALF_ANGLE, Math.asin(1 / distance));
  return Math.asin(Math.min(1, distance * Math.sin(a))) - a;
}

const angle = (lat0: number, lon0: number, lat1: number, lon1: number) => {
  const cos =
    Math.sin(lat0 * DEG) * Math.sin(lat1 * DEG) + Math.cos(lat0 * DEG) * Math.cos(lat1 * DEG) * Math.cos((lon1 - lon0) * DEG);
  return Math.acos(Math.min(1, Math.max(-1, cos)));
};

type Box = { south: number; north: number; west: number; east: number };

function distanceToBox(lat: number, lon: number, b: Box) {
  const inside = b.west <= b.east ? lon >= b.west && lon <= b.east : lon >= b.west || lon <= b.east;
  const nearLon = inside ? lon : Math.abs(wrap(lon - b.west)) < Math.abs(wrap(lon - b.east)) ? b.west : b.east;
  return angle(lat, lon, Math.min(b.north, Math.max(b.south, lat)), nearLon);
}

type Candidate = Box & { id: string; country: string; points: Vector3[] };

let candidatesCached: Promise<Candidate[]> | null = null;

function loadCandidates(): Promise<Candidate[]> {
  candidatesCached ??= loadRegionLevel()
    .then((all) =>
      all
        .map((b) => {
          const width = (b.east - b.west + 360) % 360 || 360;
          const points: Vector3[] = [];
          for (let i = 0; i < GRID; i++) {
            for (let j = 0; j < GRID; j++) {
              const lat = b.south + ((b.north - b.south) * i) / (GRID - 1);
              const lon = wrap(b.west + (width * j) / (GRID - 1));
              points.push(latLonToVector(lat, lon, 1));
            }
          }
          return { id: b.id, country: b.country, south: b.south, north: b.north, west: b.west, east: b.east, points };
        }),
    )
    .catch((e) => {
      candidatesCached = null;
      throw e;
    });
  return candidatesCached;
}

type FadingProps = { id: string; rings: Ring[]; visible: boolean; zoom: { current: number }; onGone: (id: string) => void };

const FadingRegion = memo(function FadingRegion({ id, rings, visible, zoom, onGone }: FadingProps) {
  const size = useThree((s) => s.size);
  const geometry = useMemo(() => new LineSegmentsGeometry().setPositions(toSegments(rings)), [rings]);
  const line = useMemo(() => {
    const material = new LineMaterial({ color: SLATE, linewidth: 1, transparent: true, depthWrite: false, opacity: 0 });
    const object = new LineSegments2(geometry, material);
    object.renderOrder = 3;
    return object;
  }, [geometry]);
  const opacity = useRef(0);
  const gone = useRef(false);

  useEffect(() => {
    line.material.resolution.set(size.width, size.height);
  }, [line, size]);
  useEffect(
    () => () => {
      geometry.dispose();
      line.material.dispose();
    },
    [geometry, line],
  );

  useFrame((state, delta) => {
    const target = visible ? zoom.current : 0;
    const diff = target - opacity.current;
    if (Math.abs(diff) > 0.004) {
      opacity.current += diff * Math.min(1, delta * FADE_SPEED);
      state.invalidate(); // keeps frames coming until the fade is done
    } else {
      opacity.current = target;
    }
    line.material.opacity = opacity.current;
    line.visible = opacity.current > 0.002;
    if (!visible && opacity.current === 0 && !gone.current) {
      gone.current = true;
      onGone(id);
    } else if (visible) {
      gone.current = false;
    }
  });

  return <primitive object={line} />;
});

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

export default function AdminBorders({ enabled }: { enabled: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const [rings, setRings] = useState<ReadonlyMap<string, Ring[]>>(new Map());
  const [visible, setVisible] = useState<ReadonlySet<string>>(new Set());
  const visibleRef = useRef<Set<string>>(new Set());
  const pending = useRef(new Set<string>());
  const have = useRef(new Set<string>()); // ids whose border was already fetched
  const zoom = useRef(0);
  const candidates = useRef<Candidate[] | null>(null);
  const last = useRef<{ lat: number; lon: number; distance: number; aspect: number } | null>(null);
  const point = useMemo(() => new Vector3(), []);

  // switching the tool off needs a frame to start the fade
  useEffect(() => invalidate(), [enabled, invalidate]);

  const show = (ids: Set<string>) => {
    visibleRef.current = ids;
    setVisible(ids);
  };

  const onGone = (id: string) => {
    if (visibleRef.current.has(id)) return;
    have.current.delete(id);
    setRings((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  useFrame(({ camera, size }) => {
    const distance = camera.position.length();
    const active = enabled && distance < FADE_START;
    zoom.current = active ? MAX_OPACITY * smooth(Math.min(1, (FADE_START - distance) / (FADE_START - FADE_FULL))) : 0;

    if (!active) {
      last.current = null;
      if (visibleRef.current.size) show(new Set());
      return;
    }
    if (!candidates.current) {
      void loadCandidates().then((list) => {
        candidates.current = list;
        invalidate();
      });
      return;
    }

    const { lat, lon } = vectorToLatLon(camera.position);
    const radius = viewRadius(distance);
    const prev = last.current;
    const aspect = size.width / size.height;
    if (
      prev &&
      prev.aspect === aspect &&
      angle(prev.lat, prev.lon, lat, lon) < 0.03 * radius &&
      Math.abs(Math.log(distance / prev.distance)) < 0.03
    )
      return;
    last.current = { lat, lon, distance, aspect };

    const inMiddle: [number, string][] = [];
    for (const region of candidates.current) {
      const near = distanceToBox(lat, lon, region);
      if (near > radius) continue;
      for (const p of region.points) {
        if (p.dot(camera.position) <= 1) continue;
        point.copy(p).project(camera);
        if (Math.abs(point.x) <= CENTRAL && Math.abs(point.y) <= CENTRAL) {
          inMiddle.push([near, region.id]);
          break;
        }
      }
    }
    // a screenful of small regions is slow to draw: keep the ones closest to the middle
    const next = new Set(inMiddle.sort(([a], [b]) => a - b).slice(0, MAX_REGIONS).map(([, id]) => id));
    if (!sameSet(next, visibleRef.current)) show(next);

    const missing = [...next].filter((id) => !pending.current.has(id) && !have.current.has(id));
    if (missing.length === 0) return;
    const byCountry = new Map<string, string[]>();
    for (const region of candidates.current) {
      if (missing.includes(region.id)) byCountry.set(region.country, [...(byCountry.get(region.country) ?? []), region.id]);
    }
    for (const id of missing) pending.current.add(id);
    for (const [country, ids] of byCountry) {
      void loadCountryOutlines(country)
        .then((outlines) => {
          for (const id of ids) have.current.add(id);
          setRings((prevRings) => {
            const merged = new Map(prevRings);
            for (const id of ids) if (outlines[id]?.length) merged.set(id, outlines[id]);
            return merged;
          });
          invalidate();
        })
        .catch(() => undefined)
        .finally(() => ids.forEach((id) => pending.current.delete(id)));
    }
  });

  return (
    <>
      {[...rings].map(([id, shape]) => (
        <FadingRegion key={id} id={id} rings={shape} visible={visible.has(id)} zoom={zoom} onGone={onGone} />
      ))}
    </>
  );
}

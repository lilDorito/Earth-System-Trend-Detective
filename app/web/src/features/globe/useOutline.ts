// rings to outline for a box, a region or several regions; points have none

import { useEffect, useMemo, useState } from "react";
import type { BBox, Boundary } from "@/api/types";
import { boxRings, loadOutline, type Ring } from "./boundaries";

type Bounds = Pick<BBox, "south" | "north" | "west" | "east">;
type Picked = Pick<Boundary, "id" | "country"> & Bounds;

export type Area = { kind: "box"; box: Bounds } | { kind: "region"; boundary: Picked } | { kind: "regions"; boundaries: Picked[] };

export function useOutline(area: Area | null): Ring[] | null {
  const [loaded, setLoaded] = useState<{ key: string; rings: Ring[] } | null>(null);
  const list = area?.kind === "region" ? [area.boundary] : area?.kind === "regions" ? area.boundaries : null;
  const key = list ? list.map((b) => b.id).join("|") : "";

  useEffect(() => {
    if (!list || !key) return;
    let active = true;
    // a region without an outline file still shows where it is, by its bounds
    Promise.all(list.map((b) => loadOutline(b).catch(() => boxRings(b)))).then((parts) => active && setLoaded({ key, rings: parts.flat() }));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the ids in `key` say when the list changed
  }, [key]);

  const box = area?.kind === "box" ? area.box : null;
  const boxOutline = useMemo(() => (box ? boxRings(box) : null), [box]);
  if (boxOutline) return boxOutline;
  if (!key) return null;
  // while a changed selection of several regions loads, the previous outline stays, so adding one does not flicker
  if (loaded?.key === key) return loaded.rings;
  return area?.kind === "regions" ? (loaded?.rings ?? null) : null;
}

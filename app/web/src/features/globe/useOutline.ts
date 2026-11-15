// rings to outline for a box or a region; points have none

import { useEffect, useMemo, useState } from "react";
import type { BBox, Boundary } from "@/api/types";
import { boxRings, loadOutline, type Ring } from "./boundaries";

type Bounds = Pick<BBox, "south" | "north" | "west" | "east">;

export type Area = { kind: "box"; box: Bounds } | { kind: "region"; boundary: Pick<Boundary, "id" | "country"> & Bounds };

// the outlines of several regions together, for a selection averaged as one area; the previous outline stays
// until the new one has loaded
export function useOutlines(boundaries: readonly Pick<Boundary, "id" | "country">[]): Ring[] | null {
  const [loaded, setLoaded] = useState<Ring[] | null>(null);
  const key = boundaries.map((b) => b.id).join("|");

  useEffect(() => {
    if (!key) return;
    let active = true;
    Promise.all(boundaries.map((b) => loadOutline(b).catch(() => [] as Ring[]))).then((parts) => active && setLoaded(parts.flat()));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the ids in `key` say when the list changed
  }, [key]);

  return key ? loaded : null;
}

export function useOutline(area: Area | null): Ring[] | null {
  const [loaded, setLoaded] = useState<{ id: string; rings: Ring[] } | null>(null);
  const boundary = area?.kind === "region" ? area.boundary : null;

  useEffect(() => {
    if (!boundary) return;
    let active = true;
    loadOutline(boundary).then(
      (rings) => active && setLoaded({ id: boundary.id, rings }),
      // no outline file: the bounds still show where the region is
      () => active && setLoaded({ id: boundary.id, rings: boxRings(boundary) }),
    );
    return () => {
      active = false;
    };
  }, [boundary]);

  const box = area?.kind === "box" ? area.box : null;
  const boxOutline = useMemo(() => (box ? boxRings(box) : null), [box]);
  if (boxOutline) return boxOutline;
  return boundary && loaded?.id === boundary.id ? loaded.rings : null;
}

// series and trend for the clicked point

import { useEffect } from "react";
import { motion } from "framer-motion";
import { LoaderCircle, X } from "lucide-react";
import type { TrendPoint } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Panel, PanelSection } from "@/components/ui/panel";
import { Label } from "@/components/ui/label";
import { Status } from "@/components/ui/status";
import { formatLatLon, formatP, formatSigned } from "@/lib/format";
import { useTrendMapStore } from "@/store/useTrendMapStore";
import TrendChart from "./TrendChart";

export default function PointPanel({ point, loading }: { point: TrendPoint; loading: boolean }) {
  const clearSelection = useTrendMapStore((s) => s.clearSelection);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && clearSelection();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearSelection]);

  return (
    <motion.aside
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="absolute inset-x-3 bottom-3 sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:w-[380px]"
    >
      <Panel>
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <div>
            <Label>Grid cell</Label>
            <p className="font-mono text-sm tabular-nums">{formatLatLon(point.lat, point.lon)}</p>
          </div>
          <div className="-mr-1.5 flex items-center gap-1">
            {loading && <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />}
            <Button variant="ghost" size="icon" onClick={clearSelection} aria-label="Close">
              <X />
            </Button>
          </div>
        </div>

        <PanelSection className="space-y-2">
          <p className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-medium tabular-nums">{formatSigned(point.slope_decade)}</span>
            <span className="text-sm text-muted-foreground">°C / decade</span>
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Status tone={point.significant_hr ? "success" : "muted"}>
              MK p {point.p < 0.001 ? "" : "= "}
              {formatP(point.p)}
            </Status>
            <Status tone={point.significant_fdr ? "success" : "muted"}>
              {point.significant_fdr ? "significant" : "not significant"} at FDR 5%
            </Status>
          </div>
        </PanelSection>

        <PanelSection>
          <TrendChart years={point.years} values={point.values} fitted={point.fitted} rolling={point.rolling} height={200} />
        </PanelSection>
      </Panel>
    </motion.aside>
  );
}

import { motion } from "framer-motion";
import { X } from "lucide-react";
import type { TrendPoint } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTrendMapStore } from "@/store/useTrendMapStore";
import TrendChart from "./TrendChart";

const formatP = (p: number) => (p < 0.001 ? "< 0.001" : p.toFixed(3));
const coord = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(1)}° ${v >= 0 ? pos : neg}`;

export default function PointPanel({ point }: { point: TrendPoint }) {
  const clearSelection = useTrendMapStore((s) => s.clearSelection);

  return (
    <motion.aside
      initial={{ x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 40, opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="absolute right-4 top-4 w-[400px] max-w-[calc(100vw-2rem)]"
    >
      <Card className="bg-card/90 backdrop-blur">
        <CardHeader className="flex-row items-start justify-between">
          <CardTitle>
            {coord(point.lat, "N", "S")}, {coord(point.lon, "E", "W")}
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={clearSelection} aria-label="Close">
            <X />
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-2xl font-semibold">
              {point.slope_decade > 0 ? "+" : ""}
              {point.slope_decade.toFixed(2)} °C
            </span>
            <span className="text-sm text-muted-foreground">per decade (Sen's slope)</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={point.significant_hr ? "success" : "secondary"}>
              Hamed-Rao: {point.significant_hr ? "significant" : "not significant"}, p = {formatP(point.p)}
            </Badge>
            <Badge variant={point.significant_fdr ? "success" : "secondary"}>
              FDR 5%: {point.significant_fdr ? "significant" : "not significant"}
            </Badge>
          </div>
          <TrendChart years={point.years} values={point.values} fitted={point.fitted} rolling={point.rolling} />
        </CardContent>
      </Card>
    </motion.aside>
  );
}

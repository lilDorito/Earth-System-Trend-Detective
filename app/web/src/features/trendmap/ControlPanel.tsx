import { Layers, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useTrendMapStore } from "@/store/useTrendMapStore";
import TrendChart from "./TrendChart";
import { MAX_TREND } from "./trendGeo";

export default function ControlPanel() {
  const { meta, globalMean, loading, error, showTrend, onlySignificant, setShowTrend, setOnlySignificant } =
    useTrendMapStore();

  return (
    <Card className="absolute left-4 top-4 w-[320px] max-w-[calc(100vw-2rem)] bg-card/85 backdrop-blur">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="size-4" />
          Temperature trend
        </CardTitle>
        <CardDescription>
          T2M, MERRA-2, °C per decade.{meta ? ` Period ${meta.years[0]}-${meta.years[1]}.` : ""}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {loading && <div className="text-sm text-muted-foreground">Loading data...</div>}
        {error && (
          <div className="flex items-start gap-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>Could not load data: {error}. Is the API running?</span>
          </div>
        )}
        {meta?.demo && (
          <Badge variant="warning" className="w-fit">
            demo data, not real
          </Badge>
        )}

        <label className="flex items-center justify-between gap-3 text-sm">
          Show trend layer
          <Switch checked={showTrend} onCheckedChange={setShowTrend} />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          Significant only (FDR 5%)
          <Switch checked={onlySignificant} onCheckedChange={setOnlySignificant} disabled={!showTrend} />
        </label>

        {showTrend && (
          <div>
            <div className="h-3 rounded-full" style={{ background: "linear-gradient(90deg, #2166ac, #f7f7f7, #b2182b)" }} />
            <div className="mt-1 flex justify-between text-xs text-muted-foreground">
              <span>-{MAX_TREND}</span>
              <span>0</span>
              <span>+{MAX_TREND}</span>
            </div>
          </div>
        )}

        {globalMean && (
          <div>
            <div className="mb-1 text-sm">
              Global mean: <b>{globalMean.slope_decade.toFixed(2)} °C / decade</b> ({globalMean.trend})
            </div>
            <TrendChart years={globalMean.years} values={globalMean.values} fitted={globalMean.fitted} height={130} compact />
          </div>
        )}

        <div className="text-xs text-muted-foreground">Click the globe to see the series and trend test at that point.</div>
      </CardContent>
    </Card>
  );
}

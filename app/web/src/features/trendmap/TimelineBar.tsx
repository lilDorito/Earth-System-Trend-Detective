// timeline under the globe: drag the slider or press play to see the map year by year

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Panel } from "@/components/ui/panel";
import { formatSigned } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useTrendMapStore } from "@/store/useTrendMapStore";

const STEP_MS = 1600;

// rightInset: px taken by the selection column on wide screens, so the bar centres in what is left
export default function TimelineBar({ rightInset = 0 }: { rightInset?: number }) {
  const s = useTrendMapStore(
    useShallow((s) => ({
      frames: s.frames,
      units: s.meta?.units ?? "",
      view: s.view,
      frameYear: s.frameYear,
      setFrameYear: s.setFrameYear,
      setView: s.setView,
    })),
  );
  const [playing, setPlaying] = useState(false);
  const { frames } = s;
  const first = frames?.years[0] ?? 0;
  const last = frames?.years[frames.years.length - 1] ?? 0;

  useEffect(() => {
    if (!playing || !frames) return;
    const timer = setInterval(() => {
      const year = useTrendMapStore.getState().frameYear;
      s.setFrameYear(year >= last || year < first ? first : year + 1);
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [playing, frames, first, last, s.setFrameYear]);

  if (!frames) return null;

  const active = s.view === "years";
  const index = frames.years.indexOf(s.frameYear);
  const mean = active && index >= 0 ? frames.global_mean[index] : null;
  const peak = Math.max(0.1, ...frames.global_mean.map((v) => Math.abs(v ?? 0)));

  return (
    <Panel
      style={{ "--right": `${rightInset + 16}px` } as CSSProperties}
      className="absolute inset-x-3 bottom-3 z-10 mx-auto max-w-[640px] px-4 py-3 sm:left-[332px] sm:right-4 lg:right-[var(--right)]"
    >
      <div className="flex items-start gap-3">
        <Button
          variant="outline"
          size="icon"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => {
            if (!playing && !active) s.setFrameYear(first);
            setPlaying(!playing);
          }}
        >
          {playing ? <Pause /> : <Play />}
        </Button>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="font-mono text-lg font-medium tabular-nums">{active ? s.frameYear : "Whole period"}</p>
              <Label>{active ? `change vs ${frames.baseline[0]}-${frames.baseline[1]} mean` : "drag to see year by year"}</Label>
            </div>
            {mean != null && (
              <p className="font-mono text-sm tabular-nums">
                <span className="text-muted-foreground">world </span>
                {formatSigned(mean)} {s.units}
              </p>
            )}
          </div>

          {/* world mean anomaly per year, aligned with the slider */}
          <div className="mt-2 flex h-7 items-center gap-px">
            {frames.global_mean.map((v, i) => {
              const year = frames.years[i];
              return (
                <button
                  key={year}
                  type="button"
                  title={`${year}: ${formatSigned(v ?? 0)} ${s.units}`}
                  className="flex h-full flex-1 cursor-pointer items-center"
                  onClick={() => {
                    setPlaying(false);
                    s.setFrameYear(year);
                  }}
                >
                  <span
                    className={cn(
                      "block w-full rounded-[1px]",
                      (v ?? 0) >= 0 ? "bg-warning" : "bg-primary",
                      active && year === s.frameYear ? "opacity-100" : "opacity-35",
                    )}
                    style={{ height: Math.max(2, (Math.abs(v ?? 0) / peak) * 24) }}
                  />
                </button>
              );
            })}
          </div>

          <input
            type="range"
            min={first}
            max={last}
            step={1}
            value={active ? s.frameYear : first}
            onChange={(e) => {
              setPlaying(false);
              s.setFrameYear(+e.target.value);
            }}
            aria-label="Year"
            className="mt-1 h-1.5 w-full cursor-pointer accent-primary pointer-coarse:h-6"
          />
          <div className="mt-0.5 flex justify-between font-mono text-[10px] text-muted-foreground">
            <span>{first}</span>
            <span>{last}</span>
          </div>
        </div>

        {active && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setPlaying(false);
              s.setView("trend");
            }}
          >
            Trend map
          </Button>
        )}
      </div>
    </Panel>
  );
}

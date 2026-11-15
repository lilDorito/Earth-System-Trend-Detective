// step-by-step tour of the trend map: dims the page, lights up one control at a time and says what it does;
// some steps wait until the reader has tried the thing themselves

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { create } from "zustand";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTrendMapStore } from "@/store/useTrendMapStore";

const DONE = "etd-tour-done";

type Step = {
  target?: string; // CSS selector of what to light up; none: a card in the middle
  title: string;
  text: string;
  hint?: string; // what to do now, for steps that wait
  until?: () => boolean; // moves on by itself once this is true
  enter?: () => void; // gets the page ready for the step
};

const map = () => useTrendMapStore.getState();

const STEPS: Step[] = [
  {
    title: "Is Earth okay?",
    text: "Let's find out. Twenty-five years of NASA and NOAA data on temperature, rain, ice, the oceans and more. Pick any place, and the map answers: okay, or not really.",
    enter: () => map().setShowTrend(true),
  },
  {
    target: "[data-tour=variable]",
    title: "Pick what to look at",
    text: "Choose one of 38 measurements: air temperature, rainfall, sea ice, ocean currents and more.",
  },
  {
    target: "[data-tour=legend]",
    title: "Read the colours",
    text: "Each place is coloured by how fast it changed since 2000. Strong colour: fast change. Grey: almost none.",
  },
  {
    target: "[data-tour=dots]",
    title: "Dots mean it is real",
    text: "A dot marks a change too steady to be chance. No dot: the ups and downs could explain it.",
  },
  {
    target: "[data-tour=globe]",
    title: "Your turn: click the globe",
    text: "Click any spot on land or sea to see what happened there.",
    hint: "Click anywhere on the globe",
    until: () => !!map().selected || !!map().region,
  },
  {
    target: "[data-tour=panel]",
    title: "The answer, in plain words",
    text: "How fast it changes, a chart of every year, and a quick analysis of how to interpret it. Scroll down for more.",
    // a reader who skipped the click still gets a panel to look at
    enter: () => {
      const s = map();
      if (!s.selected && !s.region) void s.selectPoint(50.45, 30.52, "Kyiv");
    },
  },
  {
    target: "[aria-label='Selection mode']",
    title: "Countries, seas and your own areas",
    text: "Region: click a country or a sea. Box: drag to draw your own area.",
  },
  {
    target: "[data-tour=timeline]",
    title: "Travel through time",
    text: "Press play or drag the slider to see each year since 2000.",
  },
  {
    target: "[data-tour=tutorial]",
    title: "That is it",
    text: "Demos has ready-made questions to try. This button plays the tour again any time.",
  },
];

export const useTutorial = create<{ open: boolean; step: number; start: () => void; close: () => void; go: (step: number) => void }>((set) => ({
  open: false,
  step: 0,
  start: () => set({ open: true, step: 0 }),
  close: () => {
    try {
      localStorage.setItem(DONE, "1");
    } catch {
      // private mode: the tour simply offers itself again next time
    }
    set({ open: false });
  },
  go: (step) => set({ step }),
}));

export function tourSeen(): boolean {
  try {
    return !!localStorage.getItem(DONE);
  } catch {
    return true;
  }
}

type Box = { left: number; top: number; width: number; height: number };

function locate(target: string | undefined): Box | null {
  if (!target) return null;
  const el = document.querySelector(target);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

const PAD = 6;
const CARD = 320;

export default function Tutorial() {
  const { open, step, close, go } = useTutorial();
  const navigate = useNavigate();
  const location = useLocation();
  const [box, setBox] = useState<Box | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const [cardAt, setCardAt] = useState<{ left: number; top: number } | null>(null);
  const current = STEPS[step];

  // the tour runs on the map
  useEffect(() => {
    if (open && location.pathname !== "/") navigate("/");
  }, [open, location.pathname, navigate]);

  useEffect(() => {
    if (open) current.enter?.();
  }, [open, step, current]);

  // targets move (panels open, the globe shifts), so follow them; waiting steps move on once done
  useEffect(() => {
    if (!open) return;
    let advanced = false;
    const tick = () => {
      setBox(locate(current.target));
      if (current.until && !advanced && current.until()) {
        advanced = true;
        setTimeout(() => go(Math.min(step + 1, STEPS.length - 1)), 700);
      }
    };
    tick();
    const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
  }, [open, step, current, go]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight" && !current.until) go(Math.min(step + 1, STEPS.length - 1));
      if (e.key === "ArrowLeft") go(Math.max(step - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, step, current, close, go]);

  // the card sits beside the lit area: below it, else above, else to its side; centred when there is none
  useLayoutEffect(() => {
    if (!open || !card.current) return;
    const h = card.current.offsetHeight;
    const w = Math.min(CARD, window.innerWidth - 24);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!box) {
      setCardAt({ left: (vw - w) / 2, top: (vh - h) / 2 });
      return;
    }
    const clampX = (x: number) => Math.min(Math.max(12, x), vw - w - 12);
    const clampY = (y: number) => Math.min(Math.max(12, y), vh - h - 12);
    const below = box.top + box.height + PAD + 12;
    const above = box.top - PAD - 12 - h;
    if (below + h <= vh - 12) setCardAt({ left: clampX(box.left + box.width / 2 - w / 2), top: below });
    else if (above >= 12) setCardAt({ left: clampX(box.left + box.width / 2 - w / 2), top: above });
    else {
      const right = box.left + box.width + PAD + 12;
      const left = right + w <= vw - 12 ? right : box.left - PAD - 12 - w;
      setCardAt({ left: clampX(left), top: clampY(box.top) });
    }
  }, [open, box, step]);

  if (!open) return null;
  const last = step === STEPS.length - 1;
  const lit = box && { left: box.left - PAD, top: box.top - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 };

  return (
    <div className="pointer-events-none fixed inset-0 z-50" aria-live="polite">
      {lit ? (
        // the light: a ring round the target, everything else darkened by its shadow; clicks pass through
        <div
          className={`absolute ring-2 ring-primary transition-all duration-300 ease-out ${current.target?.includes("globe") ? "rounded-full" : "rounded-lg"}`}
          style={{ ...lit, boxShadow: "0 0 0 9999px rgba(0,0,0,0.62)" }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/62" />
      )}
      <div
        ref={card}
        role="dialog"
        aria-label={current.title}
        className="pointer-events-auto absolute rounded-lg border bg-card p-4 shadow-2xl shadow-black/50 transition-[left,top] duration-300 ease-out"
        style={{ width: Math.min(CARD, window.innerWidth - 24), left: cardAt?.left ?? -9999, top: cardAt?.top ?? -9999 }}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-primary">
            Step {step + 1} of {STEPS.length}
          </p>
          <button type="button" onClick={close} aria-label="Skip the tour" className="-mr-1 -mt-1 cursor-pointer p-1 text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <h2 className="mt-1 text-lg font-semibold tracking-tight">{current.title}</h2>
        <p className="mt-1 text-sm leading-snug text-muted-foreground">{current.text}</p>
        {current.hint && (
          <p className="mt-2 flex items-center gap-2 text-sm font-medium text-primary">
            <span className="size-2 animate-pulse rounded-full bg-primary" />
            {current.hint}
          </p>
        )}
        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="flex gap-1">
            {STEPS.map((_, i) => (
              <span key={i} className={i === step ? "h-1.5 w-4 rounded-full bg-primary" : "size-1.5 rounded-full bg-muted-foreground/40"} />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 && (
              <Button size="sm" variant="ghost" onClick={() => go(step - 1)}>
                Back
              </Button>
            )}
            <Button size="sm" variant={current.until ? "outline" : "default"} onClick={() => (last ? close() : go(step + 1))}>
              {last ? "Start exploring" : current.until ? "Skip" : step === 0 ? "Show me" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

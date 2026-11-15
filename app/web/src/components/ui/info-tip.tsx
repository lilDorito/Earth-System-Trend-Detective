// a small "i" that explains the thing next to it: hover or focus on a computer, tap on a phone

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

const WIDTH = 240;

export function InfoTip({ children, className, label = "What is this?" }: { children: ReactNode; className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number; below: boolean } | null>(null);

  // placed on the page, not inside the panel, so a scrolling panel never cuts it off
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const height = bubble.current?.offsetHeight ?? 60;
    const below = r.top < height + 12;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - WIDTH / 2), window.innerWidth - WIDTH - 8);
    setAt({ left, top: below ? r.bottom + 6 : r.top - height - 6, below });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (!button.current?.contains(e.target as Node)) setOpen(false);
    };
    const hide = () => setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("scroll", hide, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("scroll", hide, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={cn(
          "inline-grid size-4 shrink-0 cursor-help place-items-center rounded-full align-middle text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-6",
          className,
        )}
      >
        <Info className="size-3.5" />
      </button>
      {open &&
        createPortal(
          <div
            ref={bubble}
            role="tooltip"
            style={{ width: WIDTH, left: at?.left ?? -9999, top: at?.top ?? -9999 }}
            className="pointer-events-none fixed z-[60] rounded-md border bg-popover px-3 py-2 text-xs leading-snug text-popover-foreground shadow-lg shadow-black/40"
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

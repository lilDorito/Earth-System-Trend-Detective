// dropdown that matches the panels; the native select popup ignores the theme

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type DropdownItem = { value: string; label: string; group?: string; disabled?: boolean };

type DropdownProps = {
  value: string;
  items: DropdownItem[];
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string; // shown instead of the selected item's label
  variant?: "field" | "inline"; // full-width control | dashed-underline text, as in "suggest for ..."
  align?: "left" | "right";
  className?: string;
  "aria-label"?: string;
};

export function Dropdown({
  value,
  items,
  onChange,
  placeholder = "Choose",
  label,
  variant = "field",
  align = "left",
  className,
  "aria-label": ariaLabel,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();
  const selected = items.find((item) => item.value === value);
  const enabled = items.map((item, i) => (item.disabled ? -1 : i)).filter((i) => i >= 0);

  // closes on a click anywhere else
  useEffect(() => {
    if (!open) return;
    // pointerdown covers touch too, without waiting for the emulated mouse events
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // opening highlights the current item and scrolls it into view
  useEffect(() => {
    if (!open) return;
    const index = items.findIndex((item) => item.value === value);
    setActive(index >= 0 ? index : enabled[0] ?? -1);
  }, [open]);

  useEffect(() => {
    if (open && active >= 0) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const pick = (item: DropdownItem) => {
    if (item.disabled) return;
    onChange(item.value);
    setOpen(false);
  };

  const step = (direction: 1 | -1) => {
    if (!enabled.length) return;
    const at = enabled.indexOf(active);
    setActive(enabled[(at + direction + enabled.length) % enabled.length] ?? enabled[0]);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      else step(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (open && items[active]) pick(items[active]);
      else setOpen(true);
    } else if (e.key === "Escape" || e.key === "Tab") {
      setOpen(false);
    } else if (open && e.key.length === 1) {
      // type a letter to jump to the next item starting with it
      const key = e.key.toLowerCase();
      const next = enabled.find((i) => i > active && items[i].label.toLowerCase().startsWith(key)) ??
        enabled.find((i) => items[i].label.toLowerCase().startsWith(key));
      if (next != null) setActive(next);
    }
  };

  const text = label ?? selected?.label;

  return (
    <div ref={root} className={cn("relative", variant === "field" ? "w-full" : "inline-block", className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        className={cn(
          "flex cursor-pointer items-center text-left transition-colors focus-visible:outline-none",
          variant === "field"
            ? "h-8 pointer-coarse:h-10 w-full min-w-0 gap-2 rounded-md border border-input bg-background pl-2.5 pr-2 text-sm hover:border-foreground/25 focus-visible:border-primary/60 focus-visible:ring-1 focus-visible:ring-ring"
            : "gap-1 border-b border-dashed border-foreground/30 font-mono text-[11px] text-foreground hover:border-foreground/60 focus-visible:ring-1 focus-visible:ring-ring",
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate", !text && "text-muted-foreground")}>{text ?? placeholder}</span>
        <ChevronDown className={cn("shrink-0 text-muted-foreground transition-transform", variant === "field" ? "size-3.5" : "size-3", open && "rotate-180")} />
      </button>
      {open && (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className={cn(
            "scrollbar-thin absolute top-full z-30 mt-1 max-h-72 min-w-full max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain rounded-md border bg-popover py-1 text-popover-foreground shadow-lg shadow-black/40",
            align === "right" ? "right-0" : "left-0",
            variant === "inline" && "w-max min-w-40",
          )}
        >
          {items.map((item, i) => (
            <li key={item.value} role="presentation">
              {item.group && item.group !== items[i - 1]?.group && (
                <p className="px-2.5 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground first:pt-1">
                  {item.group}
                </p>
              )}
              <div
                role="option"
                data-index={i}
                aria-selected={item.value === value}
                aria-disabled={item.disabled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(item)}
                onMouseEnter={() => !item.disabled && setActive(i)}
                className={cn(
                  "flex items-center gap-2 px-2.5 py-1.5 text-sm pointer-coarse:py-2.5",
                  item.disabled ? "cursor-default text-muted-foreground" : "cursor-pointer",
                  i === active && !item.disabled && "bg-accent",
                  variant === "inline" && "font-mono text-[12px]",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.value === value && <Check className="size-3.5 shrink-0 text-primary" />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

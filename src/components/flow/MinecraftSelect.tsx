"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export interface MinecraftSelectOption {
  key: string;
  label: string;
}

/**
 * Styled replacement for native <select> inside flow nodes. The native option
 * popup cannot be styled (OS font, tiny text) and its wheel events fight the
 * React Flow canvas, so the list is rendered as a Minecraft-styled panel.
 */
export function MinecraftSelect({
  value,
  options,
  onSelect,
  disabled = false,
  ariaLabel,
  title,
  className = "",
}: {
  value: string;
  options: MinecraftSelectOption[];
  onSelect: (key: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  title?: string;
  className?: string;
}) {
  const [isOpen, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      selectedRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [isOpen]);

  const current = options.find((option) => option.key === value);

  return (
    <div ref={rootRef} className={["relative min-w-0", className].join(" ")}>
      <button
        type="button"
        disabled={disabled}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((open) => !open);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setOpen(false);
          }
        }}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className="flex h-6 w-full min-w-0 items-center gap-1 border border-[var(--mc-33)] bg-[var(--mc-85)] px-1.5 text-[12px] font-bold leading-4 text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-100),inset_-1px_-1px_0_var(--mc-54)] outline-none focus:border-cyan-700 disabled:cursor-not-allowed disabled:text-[var(--mc-33)]"
      >
        <span className="min-w-0 flex-1 truncate text-left">{current?.label ?? value}</span>
        {disabled ? null : <ChevronDown className="h-3 w-3 shrink-0" />}
      </button>
      {isOpen ? (
        <div
          role="listbox"
          aria-label={ariaLabel}
          // "nowheel" keeps React Flow from zooming the canvas while the
          // option list scrolls; its native wheel handler runs before React's.
          className="nodrag nowheel absolute left-0 top-full z-[140] mt-0.5 max-h-[240px] w-full min-w-[110px] overflow-y-auto border-2 border-[var(--mc-15)] bg-[var(--mc-78)] p-0.5 shadow-[inset_1px_1px_0_var(--mc-100),inset_-1px_-1px_0_var(--mc-33),3px_3px_0_rgba(0,0,0,0.35)]"
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          {options.map((option) => {
            const isSelected = option.key === value;
            return (
              <button
                key={option.key}
                type="button"
                role="option"
                aria-selected={isSelected}
                ref={isSelected ? selectedRef : undefined}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(option.key);
                  setOpen(false);
                }}
                className={[
                  "block w-full truncate border border-transparent px-1.5 py-1 text-left text-[12px] font-bold leading-4 text-[var(--mc-ink)] hover:border-[var(--mc-47)] hover:bg-[var(--mc-100)]",
                  isSelected ? "border-[var(--mc-47)] bg-[var(--mc-100)]" : "",
                ].join(" ")}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

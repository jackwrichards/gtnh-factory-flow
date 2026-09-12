"use client";

import { useDropdownDismiss } from "@/lib/hooks/use-dropdown-dismiss";
import { focusDropdownFilter } from "@/lib/dropdown-focus";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Search } from "lucide-react";
import { MinecraftTooltip } from "@/components/nei/MinecraftTooltip";

export interface MinecraftSelectOption {
  key: string;
  label: string;
  /** Drawn left of the label, closed and open: the block this option means. */
  icon?: ReactNode;
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
  onPreview,
  searchable = false,
  wideMenu = false,
  tooltipContent,
}: {
  value: string;
  options: MinecraftSelectOption[];
  onSelect: (key: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  title?: string;
  className?: string;
  /** Hovering an option previews it as if picked; undefined clears. */
  onPreview?: (key: string | undefined) => void;
  /** Long catalogs (rotors, plasmas) get a filter box at the top of the list. */
  searchable?: boolean;
  /** Let the open list outgrow the control for long option labels. */
  wideMenu?: boolean;
  tooltipContent?: ReactNode | (() => ReactNode);
}) {
  const [isOpen, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setFilter("");
    }
  }, [isOpen]);
  useDropdownDismiss(isOpen, { refs: [rootRef], onClose: () => setOpen(false), fade: true });

  useEffect(() => {
    if (isOpen) {
      selectedRef.current?.scrollIntoView({ block: "nearest" });
      if (searchable) {
        focusDropdownFilter(filterRef.current);
      }
    }
  }, [isOpen, searchable]);

  const current = options.find((option) => option.key === value);
  const trimmed = filter.trim().toLowerCase();
  const shownOptions =
    trimmed === ""
      ? options
      : options.filter((option) => option.label.toLowerCase().includes(trimmed));

  return (
    <div ref={rootRef} className={["relative min-w-0", className].join(" ")}>
      <MinecraftTooltip content={tooltipContent}>
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
        title={tooltipContent ? undefined : title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className="flex h-6 w-full min-w-0 items-center gap-1 border border-[var(--mc-33)] bg-[var(--mc-85)] px-1.5 text-[12px] font-bold leading-4 text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-100),inset_-1px_-1px_0_var(--mc-54)] outline-none focus:border-cyan-700 disabled:cursor-not-allowed disabled:text-[var(--mc-33)]"
      >
        {/* No icon on the closed control: the chip beside it already shows the
            current block, and two copies of it read as two things. */}
        <span className="min-w-0 flex-1 truncate text-left">{current?.label ?? value}</span>
        {disabled ? null : <ChevronDown className="h-3 w-3 shrink-0" />}
      </button>
      </MinecraftTooltip>
      {isOpen ? (
        <div
          role="listbox"
          aria-label={ariaLabel}
          // "nowheel" keeps React Flow from zooming the canvas while the
          // option list scrolls; its native wheel handler runs before React's.
          className={[
            "nodrag nowheel absolute left-0 top-full z-[140] mt-0.5 flex max-h-[280px] w-full flex-col border-2 border-[var(--mc-15)] bg-[var(--mc-78)] p-0.5 shadow-[inset_1px_1px_0_var(--mc-100),inset_-1px_-1px_0_var(--mc-33),3px_3px_0_rgba(0,0,0,0.35)]",
            wideMenu ? "min-w-[260px] max-w-[340px]" : "min-w-[150px]",
          ].join(" ")}
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
          onMouseLeave={() => onPreview?.(undefined)}
        >
          {searchable ? (
            <label className="relative mb-0.5 flex shrink-0 items-center">
              <Search className="pointer-events-none absolute left-1.5 h-3 w-3 opacity-60" aria-hidden />
              <input
                ref={filterRef}
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    setOpen(false);
                  }
                  // Enter takes the single remaining match; typing plus Enter
                  // is the whole gesture on a 166-entry list.
                  if (event.key === "Enter" && shownOptions.length === 1) {
                    event.stopPropagation();
                    onPreview?.(undefined);
                    onSelect(shownOptions[0].key);
                    setOpen(false);
                  }
                }}
                placeholder="Filter..."
                aria-label={ariaLabel ? `Filter ${ariaLabel}` : "Filter options"}
                className="h-6 w-full border border-[var(--mc-33)] bg-[var(--mc-93)] pl-6 pr-1.5 text-[12px] text-[var(--mc-ink)] placeholder:text-[var(--mc-ink)]/50 outline-none focus:border-cyan-700"
              />
            </label>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {shownOptions.length === 0 ? (
              <p className="px-1.5 py-1 text-[12px] text-[var(--mc-ink)]/60">No matches.</p>
            ) : (
              shownOptions.map((option) => {
                const isSelected = option.key === value;
                return (
                  <button
                    key={option.key}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    ref={isSelected ? selectedRef : undefined}
                    onMouseEnter={() => onPreview?.(option.key)}
                    onClick={(event) => {
                      event.stopPropagation();
                      onPreview?.(undefined);
                      onSelect(option.key);
                      setOpen(false);
                    }}
                    className={[
                      "flex w-full items-center gap-2 border border-transparent px-1.5 py-1 text-left text-[13px] font-bold leading-5 text-[var(--mc-ink)] hover:border-[var(--mc-47)] hover:bg-[var(--mc-100)]",
                      isSelected ? "border-[var(--mc-47)] bg-[var(--mc-100)]" : "",
                    ].join(" ")}
                  >
                    {option.icon ? (
                      <span className="flex shrink-0 items-center">{option.icon}</span>
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

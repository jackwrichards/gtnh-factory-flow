"use client";

import { useDropdownDismiss } from "@/lib/hooks/use-dropdown-dismiss";
import { focusDropdownFilter } from "@/lib/dropdown-focus";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getUiScale } from "@/lib/ui-scale";
import { Zap } from "lucide-react";
import {
  ENERGY_HATCH_TYPES,
  getEnergyHatchType,
  STANDARD_ENERGY_HATCH_ID,
} from "@/lib/machines/energy-hatches";
import { GT_OVERCLOCK_TIERS, getVoltageTierIndex } from "@/lib/model/tiers";
import type { MachineTier } from "@/lib/model/types";
import { hatchEuT, hatchRowLabel } from "@/lib/solver/power-working";

import { formatCompact } from "@/lib/model";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { GT_TIER_COLORS } from "./tier-colors";
import {
  energyHatchCatalogKey,
  type EnergyHatchCatalog,
  type EnergyHatchCatalogEntry,
} from "./use-energy-hatch-catalog";

type VoltageTier = Exclude<MachineTier, "DEMO">;

/**
 * The hatch's art at a hard size, zoomed INTO the sprite. The rendered
 * machine sprites are 256px canvases whose block fills only the middle ~45%,
 * so the image is drawn at 220% of the window and the margin cropped away -
 * the block itself fills the box. Sized with a class on the window and
 * percentages on the img. The oversized image must not flex-shrink: Firefox
 * otherwise narrows it to the window, unlike Chromium's image minimum size.
 */
export function EnergyHatchArt({
  entry,
  boxClass,
}: {
  entry?: EnergyHatchCatalogEntry;
  boxClass: string;
}) {
  return (
    <span
      className={`relative flex shrink-0 items-center justify-center overflow-hidden ${boxClass}`}
    >
      {entry?.iconPath ? (
        <img
          src={entry.iconPath}
          alt={entry.displayName}
          draggable={false}
          className="minecraft-pixel-art h-[220%] w-[220%] shrink-0 max-w-none object-contain"
        />
      ) : entry?.iconAtlas ? (
        <ResourceIcon
          resource={{ kind: "item", amount: 1, ...entry }}
          bare
          tooltip={false}
          showAmount={false}
          showConsumedState={false}
        />
      ) : (
        <Zap className="h-[55%] w-[55%] opacity-60" />
      )}
    </span>
  );
}

/**
 * The floating shell both dropdowns share: a fixed body portal at tooltip
 * depth (the only layer above the marching-dash canvas and neighbouring
 * cards), anchored under its chip, closed by Escape, any press outside, or
 * any scroll outside - a fixed panel over a moving board must never be left
 * stranded where the chip used to be.
 */
export function MenuShell({
  anchor,
  align = "right",
  width,
  maxHeight,
  onClose,
  children,
}: {
  /** The chip's right edge and its top and bottom, in screen coordinates. */
  anchor: { x: number; top: number; bottom: number };
  align?: "left" | "right";
  width: number;
  maxHeight: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // The one dropdown rule (use-dropdown-dismiss.ts). The anchor button is
  // "inside": it runs its own toggle, and closing here first would make that
  // toggle reopen the menu instead.
  useDropdownDismiss(true, {
    refs: [panelRef],
    onClose,
    insideSelector: "[data-hatch-menu-anchor]",
    fade: true,
  });

  // Prefer opening UPWARD (the card stays visible for the hover-preview),
  // but flip downward when the chip is too close to the top of the screen -
  // a menu must never run off the viewport. Height caps to the chosen side.
  // The anchor rect and the window are real px; width and maxHeight are
  // shell px, and so are the fixed offsets of this zoomed box. Everything is
  // brought to shell px here.
  const scale = getUiScale();
  const shell = (px: number) => px / scale;
  const spaceAbove = shell(anchor.top) - 16;
  const spaceBelow = shell(window.innerHeight - anchor.bottom) - 16;
  const opensUp = spaceAbove >= Math.min(maxHeight, 260) || spaceAbove >= spaceBelow;

  return createPortal(
    <div
      ref={panelRef}
      // "nowheel" stops React Flow from zooming the canvas when scrolling the
      // list: its native wheel handler runs before React's synthetic one.
      className="ui-zoom nodrag nowheel fixed z-[9999] flex flex-col overflow-hidden border-2 border-[var(--mc-15)] bg-[var(--mc-78)] p-1.5 shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33),4px_4px_0_rgba(0,0,0,0.35)]"
      style={{
        width: Math.min(width, shell(window.innerWidth) - 16),
        left: Math.max(8, Math.min(shell(anchor.x) - (align === "right" ? width : 0), shell(window.innerWidth) - width - 8)),
        ...(opensUp
          ? {
              bottom: shell(window.innerHeight - anchor.top) + 4,
              maxHeight: Math.min(maxHeight, spaceAbove),
            }
          : {
              top: shell(anchor.bottom) + 4,
              maxHeight: Math.min(maxHeight, spaceBelow),
            }),
      }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

/** One concrete way to power the machine: a family plus a hatch count. */
export interface EnergySupplyOption {
  familyId: string;
  hatches: number;
  label: string;
  amps: number;
  entry?: EnergyHatchCatalogEntry;
}

/** Every whole hatch count the wheel walks; the chip's editor types any. */
const REGULAR_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

export function energySupplyOptionsForTier(
  tier: string,
  catalog: EnergyHatchCatalog,
): EnergySupplyOption[] {
  const ordinal = getVoltageTierIndex(tier as VoltageTier);
  const options: EnergySupplyOption[] = REGULAR_COUNTS.map((count) => ({
    familyId: STANDARD_ENERGY_HATCH_ID,
    hatches: count,
    label: `${count}× Energy Hatch`,
    // setProcessingLogicPower: a lone regular hatch works at 1 amp; two or
    // more work at 2 amps each.
    amps: count <= 1 ? 1 : 2 * count,
    entry: catalog.get(energyHatchCatalogKey(tier, STANDARD_ENERGY_HATCH_ID)),
  }));
  for (const type of ENERGY_HATCH_TYPES) {
    if (!type.exotic) {
      continue;
    }
    const entry = catalog.get(energyHatchCatalogKey(tier, type.id));
    const exists =
      catalog.size > 0
        ? entry !== undefined
        : getVoltageTierIndex(type.minTier as VoltageTier) <= ordinal;
    if (exists) {
      options.push({ familyId: type.id, hatches: 1, label: type.label, amps: type.amps, entry });
    }
  }
  return options;
}

/**
 * The second dropdown: every concrete supply at the chip's tier, amps beside
 * each. "4 A" alone names two different builds (a pair of regular hatches, or
 * one 4A multi-amp hatch) and the two differ in the parallel maths - summed
 * regular hatches raise the voltage ordinal, one exotic hatch does not - so
 * the rows carry the build's NAME and the amps ride as the figure.
 */
export function EnergySupplyMenu({
  anchor,
  tier,
  currentFamilyId,
  currentHatches,
  catalog,
  onPick,
  onPreview,
  onClose,
}: {
  anchor: { x: number; top: number; bottom: number };
  tier: string;
  currentFamilyId: string;
  currentHatches: number;
  catalog: EnergyHatchCatalog;
  onPick: (familyId: string, hatches: number) => void;
  /** Hovering a row shows the card as if it were picked. */
  onPreview?: (option?: { familyId: string; hatches: number }) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const allOptions = useMemo(() => energySupplyOptionsForTier(tier, catalog), [tier, catalog]);
  // Type what you want: "64" or "64a" lands on the 64A hatch, "2" on the
  // pair, "laser" on the lasers - Dagger's direct-input ask.
  const options = useMemo(() => {
    const needle = query.trim().toLowerCase().replace(/\s+/g, "");
    if (!needle) {
      return allOptions;
    }
    return allOptions.filter((option) => {
      const label = option.label.toLowerCase().replace(/\s+/g, "");
      const amps = String(option.amps);
      return (
        label.includes(needle) || amps.startsWith(needle.replace(/a$/, "")) || `${amps}a` === needle
      );
    });
  }, [allOptions, query]);
  const voltage = GT_OVERCLOCK_TIERS.find((entry) => entry.tier === tier)?.maxEuT ?? 0;
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "center" });
  }, []);

  return (
    <MenuShell anchor={anchor} width={360} maxHeight={500} onClose={onClose}>
      <input
        ref={focusDropdownFilter}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && options[0]) {
            onPick(options[0].familyId, options[0].hatches);
          }
        }}
        placeholder="Type amps or a hatch..."
        aria-label="Filter supplies"
        className="mb-1 h-7 w-full border border-[var(--mc-33)] bg-[var(--mc-85)] px-2 text-[12px] font-bold text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-100),inset_-1px_-1px_0_var(--mc-54)] outline-none focus:border-cyan-700 focus:bg-[var(--mc-100)]"
      />
      <div className="mb-0.5 grid grid-cols-[minmax(0,1fr)_44px_64px] gap-x-1.5 border-b-2 border-[var(--mc-47)] px-1 pb-1 pr-[18px] text-[10px] font-bold uppercase tracking-[0.1em] leading-none text-[var(--mc-ink-muted)]">
        <span>Supply</span>
        <span className="text-right">Amps</span>
        <span className="text-right">EU/t</span>
      </div>
      <div className="recipe-search-scroll min-h-0 max-h-[320px] flex-1 overflow-y-scroll pr-1">
        {options.map((option, index) => {
          const selected =
            option.familyId === currentFamilyId &&
            (option.familyId !== STANDARD_ENERGY_HATCH_ID || option.hatches === currentHatches);
          const firstExotic =
            index > 0 &&
            option.familyId !== STANDARD_ENERGY_HATCH_ID &&
            options[index - 1].familyId === STANDARD_ENERGY_HATCH_ID;
          return (
            <button
              key={`${option.familyId}|${option.hatches}`}
              ref={selected ? selectedRef : undefined}
              type="button"
              onClick={() => onPick(option.familyId, option.hatches)}
              onMouseEnter={() =>
                onPreview?.({ familyId: option.familyId, hatches: option.hatches })
              }
              onMouseLeave={() => onPreview?.(undefined)}
              className={`grid w-full grid-cols-[minmax(0,1fr)_44px_64px] items-center gap-x-1.5 border py-0.5 pl-0.5 pr-1 text-left text-[13px] font-bold leading-5 ${
                firstExotic ? "mt-1 border-t-2 border-t-[var(--mc-47)]" : ""
              } ${
                selected
                  ? "border-[var(--selection)] bg-[var(--mc-85)] text-[var(--mc-ink)]"
                  : "border-transparent text-[var(--mc-ink)] hover:border-[var(--mc-33)] hover:bg-[var(--mc-85)]"
              }`}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <EnergyHatchArt entry={option.entry} boxClass="-my-2.5 h-14 w-14" />
                <span className="truncate">{option.label}</span>
              </span>
              <span
                className="whitespace-nowrap text-right tabular-nums"
                title={`${option.amps.toLocaleString("en-US")} A`}
              >
                {formatCompact(option.amps)}
              </span>
              <span
                className="whitespace-nowrap text-right tabular-nums text-[var(--mc-ink-muted)]"
                title={`${(voltage * option.amps).toLocaleString("en-US")} EU/t`}
              >
                {formatCompact(voltage * option.amps)}
              </span>
            </button>
          );
        })}
      </div>
    </MenuShell>
  );
}

/**
 * The first dropdown: the tier, each row wearing its colour and the voltage
 * it means. Rows below the recipe's floor still show, dimmed - an
 * under-tiered hatch is a real build the power report judges.
 */
export function EnergyTierMenu({
  anchor,
  currentTier,
  minimumTier,
  onPick,
  onPreview,
  onClose,
}: {
  anchor: { x: number; top: number; bottom: number };
  currentTier: string;
  minimumTier?: string;
  onPick: (tier: VoltageTier) => void;
  /** Hovering a row shows the card as if it were picked. */
  onPreview?: (tier?: VoltageTier) => void;
  onClose: () => void;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "center" });
  }, []);
  const minimumOrdinal =
    minimumTier !== undefined ? getVoltageTierIndex(minimumTier as VoltageTier) : undefined;

  return (
    <MenuShell anchor={anchor} width={190} maxHeight={480} onClose={onClose}>
      <div className="recipe-search-scroll min-h-0 flex-1 overflow-y-auto">
        {GT_OVERCLOCK_TIERS.map(({ tier, maxEuT }) => {
          const color = GT_TIER_COLORS[tier];
          const selected = tier === currentTier;
          const belowMinimum =
            minimumOrdinal !== undefined && getVoltageTierIndex(tier) < minimumOrdinal;
          return (
            <button
              key={tier}
              ref={selected ? selectedRef : undefined}
              type="button"
              onClick={() => onPick(tier)}
              onMouseEnter={() => onPreview?.(tier)}
              onMouseLeave={() => onPreview?.(undefined)}
              className={`flex w-full items-center justify-between gap-1.5 border px-1 py-0.5 text-left text-[12px] font-bold leading-5 ${
                selected
                  ? "border-[var(--selection)] bg-[var(--mc-85)]"
                  : "border-transparent hover:border-[var(--mc-33)] hover:bg-[var(--mc-85)]"
              } ${belowMinimum ? "opacity-50" : ""}`}
            >
              <span
                className="w-11 shrink-0 border px-1 text-center text-[11px] leading-[16px]"
                style={{
                  backgroundColor: color.background,
                  borderColor: color.border,
                  color: color.text,
                  textShadow: `1px 1px 0 ${color.shadow}`,
                  textDecoration: color.underline ? "underline" : undefined,
                }}
              >
                {tier}
              </span>
              <span
                className="whitespace-nowrap text-right tabular-nums text-[var(--mc-ink-muted)]"
                title={`${maxEuT.toLocaleString("en-US")} EU/t`}
              >
                {formatCompact(maxEuT)} EU/t
              </span>
            </button>
          );
        })}
      </div>
    </MenuShell>
  );
}

/** The supply chip's short reading: "2×" for regular hatches, the amp badge otherwise. */
export function energySupplyChipText(familyId: string | undefined, hatches: number): string {
  const type = getEnergyHatchType(familyId);
  return type.exotic ? type.chip : `${hatches}×`;
}

/** How many of a hatch: whole numbers plain, fractions to two places, thousands compact. */
function formatCount(value: number): string {
  return value.toLocaleString("en-US", { maximumSignificantDigits: 16 });
}

/**
 * A number that types: shows the value at rest (compact), the plain digits
 * while focused, commits on blur or Enter, forgets on Escape. Shared by the
 * EU/t well and every row's "how many of this hatch" well.
 */
export function NumberWell({
  value,
  ariaLabel,
  onCommit,
  onStep,
  className,
  compact,
}: {
  value: number;
  ariaLabel: string;
  onCommit: (value: number) => void;
  /** The wheel, when the well has somewhere to step. */
  onStep?: (direction: 1 | -1) => void;
  /** Sizing only: height, width, text size. */
  className: string;
  /** At rest, the app's k/M/G form; counts show whole and two-place figures. */
  compact?: boolean;
}) {
  const [draft, setDraft] = useState<string>();
  const cancelled = useRef(false);
  const shown = draft ?? (compact ? formatCompact(value) : formatCount(value));
  return (
    <input
      value={shown}
      onFocus={(event) => {
        cancelled.current = false;
        setDraft(event.currentTarget.value);
        event.currentTarget.select();
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const parsed = Number.parseFloat((draft ?? "").trim().replace(/,/g, ""));
        setDraft(undefined);
        if (!cancelled.current && Number.isFinite(parsed) && parsed >= 0) {
          onCommit(parsed);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          cancelled.current = true;
          setDraft(undefined);
          event.currentTarget.blur();
        }
        event.stopPropagation();
      }}
      onWheel={
        onStep
          ? (event) => {
              event.stopPropagation();
              onStep(event.deltaY < 0 ? 1 : -1);
            }
          : undefined
      }
      inputMode="decimal"
      aria-label={ariaLabel}
      className={`min-w-0 border border-[var(--mc-47)] bg-[var(--mc-85)] px-1.5 font-bold tabular-nums text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-100),inset_-1px_-1px_0_var(--mc-54)] outline-none focus:border-cyan-700 focus:bg-[var(--mc-93)] ${className}`}
    />
  );
}

interface HatchRow {
  key: string;
  tier: VoltageTier;
  familyId: string;
  /** The row's short name: the tier, or the rating for an exotic hatch. */
  label: string;
  /** The item's full name, for the search and the button labels. */
  fullName: string;
  euT: number;
  entry?: EnergyHatchCatalogEntry;
}

/**
 * Every energy hatch in the game, once: the catalog's items when it has
 * loaded (the dataset knows which ratings exist at which tier), else the
 * families' own floors. Regular hatches first, then each exotic family,
 * each family walking up the tiers.
 */
export function listHatchRows(catalog: EnergyHatchCatalog): HatchRow[] {
  const rows: HatchRow[] = [];
  for (const type of ENERGY_HATCH_TYPES) {
    for (const { tier } of GT_OVERCLOCK_TIERS) {
      const entry = catalog.get(energyHatchCatalogKey(tier, type.id));
      const exists =
        catalog.size > 0
          ? entry !== undefined
          : getVoltageTierIndex(type.minTier as VoltageTier) <= getVoltageTierIndex(tier);
      if (!exists) {
        continue;
      }
      rows.push({
        key: energyHatchCatalogKey(tier, type.id),
        tier,
        familyId: type.id,
        label: hatchRowLabel(tier, type.id),
        fullName: entry?.displayName ?? `${tier} ${type.label}`,
        euT: hatchEuT(tier, type.id),
        entry,
      });
    }
  }
  return rows;
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDropdownDismiss } from "@/lib/hooks/use-dropdown-dismiss";
import { getUiScale } from "@/lib/ui-scale";
import type { FactoryNode, MachineHandler, Recipe } from "@/lib/model/types";
import { getNodeSteamReport } from "@/lib/solver/power-report";
import { getFusionMachine, getFusionStats } from "@/lib/machines/fusion";
import { getOverclockedRecipeStats } from "@/lib/solver/overclock";
import { applyMachineHandlerToRecipe, formatRate, isSteamMachineHandler } from "@/lib/model";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import type { MachineHandlerIcon } from "./machine-icons";
import type { RecipeTwin } from "@/lib/datasets/recipe-twins";

/**
 * The machine switcher: one list under the card's name bar, opened by the
 * chevron at the bar's left. Each row is the machine's icon, its name and
 * two figures at the recipe's own tier (time, EU/t). Click switches; hover
 * previews the machine on the card exactly as the old tab strip did.
 * Order is fixed - manual, steam, electric, multiblock, by tier inside each -
 * because that is the only order anyone reads a machine list in.
 */

// Rendered machine PNGs are 256px squares whose opaque block art spans
// exactly 114x126px (identical bounds on every machine render). Drawing the
// image at art * 256/126 crops the transparent padding exactly; the art is
// then sized a hair under its box for a small breathing margin.
const MACHINE_ART_SCALE = 256 / 126;

export function machineArtPixels(box: number): number {
  const margin = Math.max(2, Math.round(box * 0.055));
  return Math.round((box - margin * 2) * MACHINE_ART_SCALE);
}

export interface HandlerRecipeStats {
  seconds: number;
  eut: number;
  totalEu: number;
  minimumTier: string;
  /** Steam-line machine: burns steam, never EU. */
  steam: boolean;
  perfectOverclock: boolean;
  fixedParallels?: number;
  scalingParallels: { label: string; max: number }[];
  controlSummaries: { label: string; detail: string }[];
  exactOverclocks: boolean;
}

export function getHandlerRecipeStats(recipe: Recipe, handler: MachineHandler): HandlerRecipeStats {
  const applied = applyMachineHandlerToRecipe(recipe, { machineHandlerId: handler.id });
  const fusion = getFusionStats(applied);
  const fusionStats = fusion ? getOverclockedRecipeStats(recipe, { machineHandlerId: handler.id, overclockTier: fusion.tier }) : undefined;
  const scalingParallels: { label: string; max: number }[] = [];
  let fixedParallels: number | undefined;
  const controlSummaries: { label: string; detail: string }[] = [];
  for (const control of applied.machineConfigControls ?? []) {
    const parallelMax = Math.max(
      0,
      ...control.tiers
        .map((tier) => tier.parallelMultiplier ?? 0)
        .filter((value) => Number.isFinite(value)),
    );
    if (parallelMax > 1) {
      if (control.id === "machineParallel") {
        fixedParallels = parallelMax;
      } else {
        scalingParallels.push({ label: control.label, max: parallelMax });
      }
    }
    const first = control.tiers[0]?.label;
    const last = control.tiers[control.tiers.length - 1]?.label;
    const effects: string[] = [];
    if (parallelMax > 1 && control.id !== "machineParallel") {
      effects.push(`up to ×${formatRate(parallelMax, 0)} parallels`);
    }
    if (
      control.tiers.some(
        (tier) => Number.isFinite(tier.durationMultiplier) && tier.durationMultiplier !== 1,
      )
    ) {
      effects.push("changes speed");
    }
    if (
      control.tiers.some((tier) => Number.isFinite(tier.eutMultiplier) && tier.eutMultiplier !== 1)
    ) {
      effects.push("changes power");
    }
    if (control.tiers.some((tier) => Number.isFinite(tier.heat))) {
      effects.push("sets heat");
    }
    controlSummaries.push({
      label: control.label,
      detail: [
        first && last && first !== last ? `${first} → ${last}` : (first ?? ""),
        effects.join(", "),
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }
  return {
    seconds: (fusionStats?.durationTicks ?? applied.durationTicks) / 20,
    eut: fusionStats ? fusionStats.eut * fusion!.parallels : applied.eut,
    totalEu: fusionStats ? fusionStats.eut * fusionStats.durationTicks : applied.eut * applied.durationTicks,
    minimumTier: applied.minimumTier,
    steam: isSteamMachineHandler(handler),
    perfectOverclock: applied.machineProfile?.perfectOverclock === true,
    fixedParallels,
    scalingParallels,
    controlSummaries,
    exactOverclocks: !!fusion ||
      handler.id === recipe.machineHandlers?.[0]?.id &&
      recipe.runtimeCalculation?.status === "computed" &&
      (recipe.runtimeCalculation?.variants.length ?? 0) > 0,
  };
}

export type MachineGroup = "Manual" | "Steam" | "Electric" | "Multiblock";
const GROUP_ORDER: MachineGroup[] = ["Manual", "Steam", "Electric", "Multiblock"];

export function getMachineGroup(handler: MachineHandler): MachineGroup {
  if (handler.kind === "multiblock") {
    return "Multiblock";
  }
  if (isSteamMachineHandler(handler)) {
    return "Steam";
  }
  const tier = handler.minimumTier;
  if ((tier && tier !== "NONE") || (handler.eut ?? 0) > 0) {
    return "Electric";
  }
  return "Manual";
}

function formatSeconds(seconds: number): string {
  return seconds >= 100
    ? Math.round(seconds).toLocaleString("en-US")
    : seconds.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/** Big numbers shrink to k/M so they always fit their fixed cells. */
function formatCompact(value: number): string {
  if (value >= 1_000_000) {
    return `${formatRate(value / 1_000_000, value >= 10_000_000 ? 0 : 1)}M`;
  }
  if (value >= 10_000) {
    return `${formatRate(value / 1000, value >= 100_000 ? 0 : 1)}k`;
  }
  return formatRate(value, 0);
}


/* ------------------------------------------------------------------ */
/* Machine menu                                                        */
/* ------------------------------------------------------------------ */

/** The panel's scroll cap, and one row's height, for placing it before it exists. */
// Sized a third up from the card's own 13px (Jack, 2026-09-07): the menu is
// screen-fixed while the card is zoomed, and at 13px it read too small.
const MENU_MAX_HEIGHT = 520;
const MENU_ROW_HEIGHT = 40;

const TIER_ORDER = ["NONE", "ULV", "LV", "MV", "HV", "EV", "IV", "LuV", "ZPM", "UV", "UHV", "UEV", "UIV", "UMV", "UXV", "MAX"];
const tierRank = (tier: string | undefined) => {
  const index = TIER_ORDER.indexOf(tier ?? "NONE");
  return index < 0 ? TIER_ORDER.length : index;
};

/** Handlers in reading order: group, then tier, then name. */
export function orderMachineHandlers(handlers: MachineHandler[]): MachineHandler[] {
  return [...handlers].sort((a, b) => {
    const group = GROUP_ORDER.indexOf(getMachineGroup(a)) - GROUP_ORDER.indexOf(getMachineGroup(b));
    if (group !== 0) return group;
    const tier = tierRank(a.minimumTier) - tierRank(b.minimumTier);
    if (tier !== 0) return tier;
    return a.label.localeCompare(b.label);
  });
}

export function MachineMenu({
  recipe,
  node,
  handlers,
  selectedId,
  iconsById,
  onHover,
  onUse,
  onClose,
  twins,
  mapIcons,
  onUseTwin,
  onAddRecipe,
  figures = true,
  title,
}: {
  recipe: Recipe;
  /** The card's node: a steam machine's litres are read at its settings. */
  node: FactoryNode;
  handlers: MachineHandler[];
  selectedId: string;
  iconsById: ReadonlyMap<string, MachineHandlerIcon>;
  onHover: (handlerId: string | undefined) => void;
  onUse: (handlerId: string) => void;
  onClose: () => void;
  /**
   * The card's TWINS: other recipes taking and making exactly what this one
   * does, one row per machine, under the recipe's own machines. The section
   * exists only when there are some (Jack, 2026-09-07): none, still loading
   * or failed all read as the plain machine list.
   */
  twins?: RecipeTwin[];
  /** Recipe map -> the map's machine, the face for a twin whose handler has no family icon. */
  mapIcons?: ReadonlyMap<string, MachineHandlerIcon>;
  onUseTwin?: (twin: RecipeTwin) => void;
  /** SHARED MACHINES: opens the search pinned to this machine, so another recipe can join the card. */
  onAddRecipe?: () => void;
  /** Off on a shared card: a time and power figure would be one recipe's, and the card runs several. */
  figures?: boolean;
  /** The heading over the machine rows; a shared card says "every recipe on this card". */
  title?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  // The menu PORTALS to the body, like the crop and hatch menus: inside the
  // card it would sit in the node layer, under the marching-dash canvas and
  // every higher card. Fixed and in screen pixels, so it reads the same at
  // every zoom. It is exactly as wide as the card's window, so its edges
  // line up with the card's, and it opens ABOVE the card when there is room
  // - over the canvas, not over the card's own ports - and below it
  // otherwise. Measured once on open; a board pan closes it through the
  // click-away.
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [anchorAt, setAnchorAt] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number }>();
  useEffect(() => {
    const bar = anchorRef.current?.parentElement;
    // The worksheet reuses this chooser without a canvas card. Its cell is
    // the window to align to; other standalone controls can use their bar.
    const card = anchorRef.current?.closest("[data-node-glance-root], [data-machine-editor-anchor]") ?? bar;
    if (bar && card) {
      // Real px throughout (rects, innerWidth); the menu box wears ui-zoom,
      // so the numbers are divided by the scale where the style reads them.
      const scale = getUiScale();
      const barRect = bar.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const width = Math.max(480 * scale, Math.round(cardRect.width));
      const left = Math.max(8, Math.min(Math.round(cardRect.left), window.innerWidth - width - 8));
      // The list's height before it exists: one row per machine, capped
      // where the panel starts scrolling.
      // The twins section is counted as a header and a few rows before it
      // has loaded, so a menu that opens below the card has room to grow.
      const twinRows = twins && twins.length > 0 ? 1 + Math.min(3, twins.length) : 0;
      const estimated = Math.min(MENU_MAX_HEIGHT, (handlers.length + twinRows) * MENU_ROW_HEIGHT + 16) * scale;
      const roomAbove = Math.round(cardRect.top) - 4 - 8;
      const above = roomAbove >= estimated;
      const top = Math.min(Math.round(barRect.bottom) + 4, window.innerHeight - 120);
      // The list may grow after it opens (the twins land later), so its
      // height is capped to the room on the side it chose: it scrolls
      // rather than running off the window.
      const maxHeight = Math.max(160 * scale, Math.min(MENU_MAX_HEIGHT * scale, above ? roomAbove : window.innerHeight - top - 8));
      // Real px -> shell px: the box is zoomed, so its fixed offsets are too.
      const shell = (px: number) => px / scale;
      setAnchorAt(
        above
          ? { left: shell(left), width: shell(width), maxHeight: shell(maxHeight), bottom: shell(window.innerHeight - Math.round(cardRect.top) + 4) }
          : { left: shell(left), width: shell(width), maxHeight: shell(maxHeight), top: shell(top) },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- measured once on open; the twins' arrival must not re-anchor an open menu
  }, [handlers.length]);
  const twinRows = useMemo(
    () =>
      twins
        ? twins.map((twin) => {
            const twinRecipe = twin.recipe as unknown as Recipe;
            const stats = getHandlerRecipeStats(twinRecipe, twin.handler);
            const steam = stats.steam
              ? getNodeSteamReport(twinRecipe, { ...node, machineHandlerId: twin.handler.id })
              : undefined;
            const power: { value: string; unit: string } = steam
              ? { value: formatCompact(steam.drawSteamPerTick * 20).replace(/\.0$/, ""), unit: "L/s" }
              : stats.eut > 0
                ? { value: formatCompact(stats.eut), unit: "EU/t" }
                : { value: "none", unit: "" };
            return { twin, stats, power };
          })
        : [],
    [node, twins],
  );
  const rows = useMemo(
    () =>
      orderMachineHandlers(handlers).map((handler) => {
        const stats = getHandlerRecipeStats(recipe, handler);
        // A steam machine's cost is litres, read the way the card bills it.
        const steam = stats.steam
          ? getNodeSteamReport(recipe, { ...node, machineHandlerId: handler.id })
          : undefined;
        // Figure and unit apart, so the unit can be set the card's way:
        // small, muted, no space.
        const power: { value: string; unit: string } = steam
          ? { value: formatCompact(steam.drawSteamPerTick * 20).replace(/\.0$/, ""), unit: "L/s" }
          : stats.eut > 0
            ? { value: formatCompact(stats.eut), unit: "EU/t" }
            : { value: "none", unit: "" };
        return { handler, stats, power };
      }),
    [handlers, node, recipe],
  );

  // Closes the way every dropdown does (use-dropdown-dismiss.ts): a press
  // outside, Escape, a wheel or scroll elsewhere, the camera moving, and a
  // mouse drifting away fades it out. The name bar is the anchor: a click
  // there is its own toggle, and a wheel there walks the machines.
  const barRef = useRef<Element | null>(null);
  useEffect(() => {
    barRef.current = anchorRef.current?.parentElement ?? null;
  }, []);
  useDropdownDismiss(true, {
    refs: [rootRef, barRef],
    onClose,
    insideSelector: "[data-machine-menu-toggle]",
    fade: true,
  });

  const menu = anchorAt ? (
    <div
      ref={rootRef}
      role="listbox"
      aria-label="Machine"
      className="ui-zoom nodrag nowheel z-[300] overflow-y-auto overflow-x-hidden border-2 border-[var(--mc-15)] bg-[var(--mc-49)] py-1.5 shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25),2px_3px_6px_rgba(0,0,0,0.2)]"
      style={{ position: "fixed", left: anchorAt.left, top: anchorAt.top, bottom: anchorAt.bottom, width: anchorAt.width, maxHeight: anchorAt.maxHeight }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onMouseLeave={() => onHover(undefined)}
    >
      {/* The list's title, in the same voice as the twins section below it:
          what these rows ARE, so the two sections read as two questions. */}
      <div className="mx-3 mb-1 mt-0.5 text-[13px] uppercase tracking-wide text-[var(--mc-ink-muted)]">
        {title ?? "Machines that run this recipe"}
      </div>
      {rows.map(({ handler, stats, power }) => {
        const active = handler.id === selectedId;
        const icon = iconsById.get(handler.id);
        return (
          <button
            key={handler.id}
            type="button"
            role="option"
            aria-selected={active}
            onMouseEnter={() => onHover(handler.id)}
            onClick={(event) => {
              event.stopPropagation();
              onUse(handler.id);
            }}
            className={[
              "grid w-full items-center gap-x-4 px-3 py-2 text-left text-[17px] leading-[24px]",
              active ? "bg-[var(--mc-71)] text-white" : "text-[var(--mc-ink)] hover:bg-[var(--mc-61)] hover:text-white",
            ].join(" ")}
            style={{ gridTemplateColumns: "36px minmax(0,1fr) 72px 112px" }}
          >
            {/* Bare art, no slot chrome: the list is a menu, not a crafting grid. */}
            <span className="flex h-9 w-9 items-center justify-center">
              {icon ? (
                <ResourceIcon
                  resource={{ ...icon, amount: 1 }}
                  size="sm"
                  bare
                  showAmount={false}
                  tooltip={false}
                  className="!h-9 !w-9"
                  iconPixelSize={machineArtPixels(36)}
                />
              ) : null}
            </span>
            <span title={handler.label} className={getFusionMachine(handler.machineType) ? "min-w-0 whitespace-normal" : "min-w-0 truncate"}>{handler.label}</span>
            {figures ? <DurationFigure seconds={stats.seconds} /> : <span />}
            {figures ? <Figure value={power.value} unit={power.unit} dim={power.unit === ""} /> : <span />}
          </button>
        );
      })}
      {twinRows.length > 0 ? (
        <>
          {/* The twins section: other recipes with exactly these inputs and
              outputs, one row per machine. Same grid as the machines above,
              so the figures line up; a muted map name after the machine when
              the two differ (Auto Workbench running a Shaped Crafting
              recipe). Everything here is a swap of the whole recipe. */}
          <div className="mx-3 mt-1.5 border-t-2 border-[var(--mc-33)] pt-2 text-[13px] uppercase tracking-wide text-[var(--mc-ink-muted)]">
            Other recipes that take and make the same items
          </div>
          {twinRows.map(({ twin, stats, power }) => {
              const icon = iconsById.get(twin.handler.id) ?? mapIcons?.get(twin.recipe.recipeMap);
              const showMap = twin.recipe.recipeMap !== twin.handler.label;
              return (
                <button
                  key={`${twin.recipe.id}:${twin.handler.id}`}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onMouseEnter={() => onHover(undefined)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onUseTwin?.(twin);
                  }}
                  className="grid w-full items-center gap-x-4 px-3 py-2 text-left text-[17px] leading-[24px] text-[var(--mc-ink)] hover:bg-[var(--mc-61)] hover:text-white"
                  style={{ gridTemplateColumns: "36px minmax(0,1fr) 72px 112px" }}
                >
                  <span className="flex h-9 w-9 items-center justify-center">
                    {icon ? (
                      <ResourceIcon
                        resource={{ ...icon, amount: 1 }}
                        size="sm"
                        bare
                        showAmount={false}
                        tooltip={false}
                        className="!h-9 !w-9"
                        iconPixelSize={machineArtPixels(36)}
                      />
                    ) : null}
                  </span>
                  <span className="min-w-0 truncate">
                    {twin.handler.label}
                    {showMap ? (
                      <span className="ml-2 text-[13px] text-[var(--mc-ink-muted)]">{twin.recipe.recipeMap}</span>
                    ) : null}
                  </span>
                  <DurationFigure seconds={stats.seconds} />
                  <Figure value={power.value} unit={power.unit} dim={power.unit === ""} />
                </button>
              );
            })}
        </>
      ) : null}
      {onAddRecipe ? (
        /* SHARED MACHINES: one machine, several recipes. The row opens the
           search pinned to this machine; the pick joins this card. */
        <button
          type="button"
          role="option"
          aria-selected={false}
          onMouseEnter={() => onHover(undefined)}
          onClick={(event) => {
            event.stopPropagation();
            onAddRecipe();
          }}
          className="mx-3 mt-1.5 flex w-[calc(100%-24px)] items-center gap-4 border-t-2 border-[var(--mc-33)] px-0 py-2 pt-3 text-left text-[17px] leading-[24px] text-[var(--mc-ink)] hover:bg-[var(--mc-61)] hover:text-white"
        >
          <span className="flex h-9 w-9 items-center justify-center text-[24px] font-black leading-none">+</span>
          <span className="min-w-0 truncate">Add another recipe to this machine</span>
        </button>
      ) : null}
    </div>
  ) : null;

  return (
    <>
      <span ref={anchorRef} hidden />
      {menu ? createPortal(menu, document.body) : null}
    </>
  );
}

/** A figure with its unit the way the card writes them: small, muted, no space. */
function DurationFigure({ seconds }: { seconds: number }) {
  return seconds > 0 && seconds < 0.1
    ? <Figure value={(seconds * 1000).toLocaleString("en-US", { maximumSignificantDigits: 3 })} unit="ms" />
    : <Figure value={formatSeconds(seconds)} unit="s" />;
}

function Figure({ value, unit, dim }: { value: string; unit: string; dim?: boolean }) {
  return (
    <span className={["whitespace-nowrap text-right tabular-nums", dim ? "text-[var(--mc-ink-muted)]" : ""].join(" ")}>
      {value}
      {unit ? <span className="ml-0.5 text-[12px] text-[var(--mc-ink-muted)]">{unit}</span> : null}
    </span>
  );
}

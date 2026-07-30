"use client";

import { useEffect, useRef, useState } from "react";
import type { MachineHandler, MachineTier, Recipe } from "@/lib/model/types";
import { applyMachineHandlerToRecipe, formatRate } from "@/lib/model";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { GT_TIER_COLORS } from "./tier-colors";
import type { MachineIconResource } from "./machine-icons";

/**
 * The machine picker, three layers deep:
 *  - MachineTabStrip: NEI-catalyst-style icon tabs above the node. One click
 *    switches machines; hovering previews without committing.
 *  - MachineGlanceBar: replaces the title bar; always shows the machine you
 *    are on (or hovering) with its this-recipe numbers.
 *  - MachineComparePanel: the pro view behind the "⋯" tab. Grouped list of
 *    every machine on the left, full inspector for the highlighted one on
 *    the right — stats, min tier, parallels, overclock behavior, and the
 *    structure controls it brings — with an explicit "Use" button.
 */

export interface HandlerRecipeStats {
  seconds: number;
  eut: number;
  totalEu: number;
  minimumTier: string;
  isDefault: boolean;
  perfectOverclock: boolean;
  fixedParallels?: number;
  scalingParallels: { label: string; max: number }[];
  tuningControls: string[];
  exactOverclocks: boolean;
}

export function getHandlerRecipeStats(recipe: Recipe, handler: MachineHandler): HandlerRecipeStats {
  const applied = applyMachineHandlerToRecipe(recipe, { machineHandlerId: handler.id });
  const seconds = applied.durationTicks / 20;
  const scalingParallels: { label: string; max: number }[] = [];
  let fixedParallels: number | undefined;
  const tuningControls: string[] = [];
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
    const changesSpeedOrPower = control.tiers.some(
      (tier) =>
        (Number.isFinite(tier.durationMultiplier) && tier.durationMultiplier !== 1) ||
        (Number.isFinite(tier.eutMultiplier) && tier.eutMultiplier !== 1),
    );
    if (changesSpeedOrPower && !tuningControls.includes(control.label)) {
      tuningControls.push(control.label);
    }
  }
  return {
    seconds,
    eut: applied.eut,
    totalEu: applied.eut * applied.durationTicks,
    minimumTier: applied.minimumTier,
    isDefault: handler.id === recipe.machineHandlers?.[0]?.id,
    perfectOverclock: applied.machineProfile?.perfectOverclock === true,
    fixedParallels,
    scalingParallels,
    tuningControls,
    exactOverclocks:
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
  if (/\bsteam\b/i.test(handler.label)) {
    return "Steam";
  }
  const tier = handler.minimumTier;
  if ((tier && tier !== "NONE") || (handler.eut ?? 0) > 0) {
    return "Electric";
  }
  return "Manual";
}

export function formatHandlerStatLine(stats: HandlerRecipeStats): string {
  const parts = [`${formatSeconds(stats.seconds)}s`];
  if (stats.eut > 0) {
    parts.push(`${formatRate(stats.eut, 0)} EU/t`);
  } else {
    parts.push("no power");
  }
  if (stats.fixedParallels !== undefined) {
    parts.push(`×${formatRate(stats.fixedParallels, 0)} parallel`);
  } else if (stats.scalingParallels.length > 0) {
    parts.push(`parallels·${stats.scalingParallels[0].label.toLowerCase()}`);
  }
  return parts.join(" · ");
}

function formatSeconds(seconds: number): string {
  return seconds >= 100
    ? Math.round(seconds).toLocaleString()
    : seconds.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function TierChip({ tier, plus }: { tier: string; plus?: boolean }) {
  const color = GT_TIER_COLORS[tier as Exclude<MachineTier, "DEMO">];
  if (!color) {
    return (
      <span className="shrink-0 border border-[var(--mc-47)] bg-[var(--mc-71)] px-1 text-[9px] font-bold leading-[14px] text-[var(--mc-ink)]">
        ANY
      </span>
    );
  }
  return (
    <span
      className="shrink-0 border px-1 text-[9px] font-bold leading-[14px]"
      style={{
        backgroundColor: color.background,
        borderColor: color.border,
        color: color.text,
        textShadow: `1px 1px 0 ${color.shadow}`,
      }}
    >
      {tier}
      {plus ? "+" : ""}
    </span>
  );
}

function MachineIconBox({
  icon,
  label,
  size,
  boxClassName,
}: {
  icon?: MachineIconResource;
  label: string;
  size: number;
  boxClassName?: string;
}) {
  return (
    <span
      className={[
        "flex shrink-0 items-center justify-center bg-[var(--mc-55)] shadow-[inset_1px_1px_0_var(--mc-25),inset_-1px_-1px_0_var(--mc-93)]",
        boxClassName ?? "",
      ].join(" ")}
      style={{ width: size, height: size }}
    >
      {icon ? (
        <ResourceIcon
          resource={{ ...icon, amount: 1 }}
          size="sm"
          bare
          showAmount={false}
          tooltip={false}
          className="!h-full !w-full"
          iconPixelSize={size - 4}
        />
      ) : (
        <span className="text-[10px] font-bold text-[var(--mc-100)]">
          {label.slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
}

export function MachineTabStrip({
  handlers,
  selectedId,
  iconsByLabel,
  onHover,
  onSelect,
  onOpenCompare,
  isCompareOpen,
}: {
  handlers: MachineHandler[];
  selectedId: string;
  iconsByLabel: Record<string, MachineIconResource | undefined>;
  onHover: (handlerId: string | undefined) => void;
  onSelect: (handlerId: string) => void;
  onOpenCompare: () => void;
  isCompareOpen: boolean;
}) {
  return (
    <div className="nodrag -mb-[2px] flex items-end gap-[2px] px-1" onMouseLeave={() => onHover(undefined)}>
      {handlers.map((handler) => {
        const active = handler.id === selectedId;
        return (
          <button
            key={handler.id}
            type="button"
            onMouseEnter={() => onHover(handler.id)}
            onFocus={() => onHover(handler.id)}
            onBlur={() => onHover(undefined)}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(handler.id);
            }}
            onPointerDown={(event) => event.stopPropagation()}
            title={handler.label}
            aria-label={`Use ${handler.label}`}
            aria-pressed={active}
            className={[
              "flex w-[34px] items-center justify-center border-2 border-b-0",
              active
                ? "h-[34px] border-[var(--mc-15)] bg-[var(--mc-85)] shadow-[inset_2px_2px_0_var(--mc-100)]"
                : "h-[28px] border-[var(--mc-33)] bg-[var(--mc-61)] opacity-80 shadow-[inset_2px_2px_0_var(--mc-85)] hover:opacity-100 hover:brightness-110",
            ].join(" ")}
          >
            <MachineIconBox
              icon={iconsByLabel[handler.label]}
              label={handler.label}
              size={24}
              boxClassName="bg-transparent shadow-none"
            />
          </button>
        );
      })}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onOpenCompare();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        title="Compare all machines"
        aria-label="Compare all machines"
        className={[
          "flex h-[28px] w-[26px] items-center justify-center border-2 border-b-0 text-[13px] font-bold leading-none",
          isCompareOpen
            ? "h-[34px] border-[var(--mc-15)] bg-[var(--mc-85)] text-[var(--mc-ink)] shadow-[inset_2px_2px_0_var(--mc-100)]"
            : "border-[var(--mc-33)] bg-[var(--mc-61)] text-[var(--mc-100)] opacity-80 shadow-[inset_2px_2px_0_var(--mc-85)] hover:opacity-100 hover:brightness-110",
        ].join(" ")}
      >
        ⋯
      </button>
    </div>
  );
}

export function MachineGlanceContent({
  recipe,
  handler,
  icon,
  isPreview,
}: {
  recipe: Recipe;
  handler: MachineHandler;
  icon?: MachineIconResource;
  isPreview: boolean;
}) {
  const stats = getHandlerRecipeStats(recipe, handler);
  return (
    <span
      className={[
        "flex min-w-0 flex-1 items-center gap-1.5 px-1",
        isPreview ? "outline-dashed outline-2 -outline-offset-2 outline-cyan-300" : "",
      ].join(" ")}
    >
      <MachineIconBox icon={icon} label={handler.label} size={20} />
      <span className="min-w-0 truncate text-left">{handler.label}</span>
      <span className="ml-auto shrink-0 pl-1 text-[10px] font-normal normal-case tracking-normal text-[var(--mc-93)] [text-shadow:1px_1px_0_var(--mc-33)]">
        {formatHandlerStatLine(stats)}
      </span>
    </span>
  );
}

const DETAIL_GRID_ROW = "flex items-baseline justify-between gap-3 py-[3px] text-[12px] leading-4";

export function MachineComparePanel({
  recipe,
  handlers,
  selectedId,
  iconsByLabel,
  onUse,
  onClose,
}: {
  recipe: Recipe;
  handlers: MachineHandler[];
  selectedId: string;
  iconsByLabel: Record<string, MachineIconResource | undefined>;
  onUse: (handlerId: string) => void;
  onClose: () => void;
}) {
  const [inspectedId, setInspectedId] = useState(selectedId);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const inspected = handlers.find((handler) => handler.id === inspectedId) ?? handlers[0];
  const inspectedStats = getHandlerRecipeStats(recipe, inspected);
  const groups = GROUP_ORDER.map((group) => ({
    group,
    entries: handlers.filter((handler) => getMachineGroup(handler) === group),
  })).filter((entry) => entry.entries.length > 0);

  return (
    <div
      ref={rootRef}
      className="nodrag nowheel absolute left-0 top-full z-[140] mt-1 flex w-[560px] border-2 border-[var(--mc-15)] bg-[var(--mc-78)] shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33),5px_5px_0_rgba(0,0,0,0.35)]"
      onClick={(event) => event.stopPropagation()}
      role="dialog"
      aria-label="Compare machines"
    >
      {/* Left: every machine, grouped by how it is powered. */}
      <div className="max-h-[380px] w-[300px] shrink-0 overflow-y-auto border-r-2 border-[var(--mc-47)] p-1">
        {groups.map(({ group, entries }) => (
          <div key={group}>
            <div className="px-1 pb-0.5 pt-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--mc-ink-muted)]">
              {group}
            </div>
            {entries.map((handler) => {
              const stats = getHandlerRecipeStats(recipe, handler);
              const isInspected = handler.id === inspected.id;
              const isActive = handler.id === selectedId;
              return (
                <button
                  key={handler.id}
                  type="button"
                  onClick={() => setInspectedId(handler.id)}
                  onDoubleClick={() => onUse(handler.id)}
                  onMouseEnter={() => setInspectedId(handler.id)}
                  className={[
                    "mb-[3px] flex w-full items-center gap-1.5 border-2 px-1.5 py-1 text-left",
                    isInspected
                      ? "border-[#6b4fd1] bg-[#8b70dd] text-white"
                      : "border-[var(--mc-47)] bg-[var(--mc-85)] text-[var(--mc-ink)] hover:bg-[var(--mc-100)]",
                  ].join(" ")}
                >
                  <MachineIconBox icon={iconsByLabel[handler.label]} label={handler.label} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1">
                      <span className="min-w-0 truncate text-[12px] font-bold leading-4">
                        {handler.label}
                      </span>
                      {isActive ? (
                        <span className="shrink-0 border border-[#2f7a2f] bg-[#57c257] px-1 text-[8px] font-bold leading-3 text-[#0c3a0c]">
                          ACTIVE
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={[
                        "block truncate text-[10px] leading-[14px]",
                        isInspected ? "text-[#e8e2ff]" : "text-[var(--mc-ink-muted)]",
                      ].join(" ")}
                    >
                      {formatHandlerStatLine(stats)}
                    </span>
                  </span>
                  <TierChip
                    tier={stats.minimumTier}
                    plus={stats.minimumTier !== "NONE" && stats.eut > 0}
                  />
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Right: full inspector for the highlighted machine. */}
      <div className="flex min-w-0 flex-1 flex-col p-2">
        <div className="flex items-center gap-2 border-b-2 border-[var(--mc-71)] pb-1.5">
          <MachineIconBox icon={iconsByLabel[inspected.label]} label={inspected.label} size={30} />
          <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-[var(--mc-ink)]">
            {inspected.label}
          </span>
          <span className="shrink-0 border border-[var(--mc-47)] bg-[var(--mc-71)] px-1 text-[8px] font-bold uppercase tracking-[0.08em] leading-[14px] text-[var(--mc-ink)]">
            {inspected.kind === "multiblock" ? "Multiblock" : "Single block"}
          </span>
        </div>

        <div className="flex-1 pt-1.5 text-[var(--mc-ink)]">
          <div className={DETAIL_GRID_ROW}>
            <span className="text-[var(--mc-ink-muted)]">Time</span>
            <span className="font-bold">{formatSeconds(inspectedStats.seconds)} s</span>
          </div>
          <div className={DETAIL_GRID_ROW}>
            <span className="text-[var(--mc-ink-muted)]">Power</span>
            <span className="font-bold">
              {inspectedStats.eut > 0 ? `${formatRate(inspectedStats.eut, 0)} EU/t` : "none"}
            </span>
          </div>
          {inspectedStats.totalEu > 0 ? (
            <div className={DETAIL_GRID_ROW}>
              <span className="text-[var(--mc-ink-muted)]">Per craft</span>
              <span className="font-bold">{formatRate(inspectedStats.totalEu, 0)} EU</span>
            </div>
          ) : null}
          <div className={DETAIL_GRID_ROW}>
            <span className="text-[var(--mc-ink-muted)]">Min tier</span>
            <TierChip tier={inspectedStats.minimumTier} />
          </div>
          {inspectedStats.fixedParallels !== undefined ? (
            <div className={DETAIL_GRID_ROW}>
              <span className="text-[var(--mc-ink-muted)]">Parallels</span>
              <span className="font-bold">×{formatRate(inspectedStats.fixedParallels, 0)}</span>
            </div>
          ) : null}
          {inspectedStats.scalingParallels.map((entry) => (
            <div key={entry.label} className={DETAIL_GRID_ROW}>
              <span className="text-[var(--mc-ink-muted)]">Parallels</span>
              <span className="font-bold">
                up to ×{formatRate(entry.max, 0)}
                <span className="font-normal text-[var(--mc-ink-muted)]"> · {entry.label}</span>
              </span>
            </div>
          ))}
          <div className={DETAIL_GRID_ROW}>
            <span className="text-[var(--mc-ink-muted)]">Overclocks</span>
            <span className="font-bold">
              {inspectedStats.exactOverclocks
                ? "Exact (in-game data)"
                : inspectedStats.perfectOverclock
                  ? "Perfect (4× speed / 4× power)"
                  : "Standard (2× speed / 4× power)"}
            </span>
          </div>
          {inspectedStats.tuningControls.length > 0 ? (
            <div className="flex flex-wrap gap-1 pt-1.5">
              {inspectedStats.tuningControls.map((label) => (
                <span
                  key={label}
                  className="border border-[var(--mc-47)] bg-[var(--mc-85)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--mc-ink)]"
                >
                  ⚙ {label}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => onUse(inspected.id)}
          disabled={inspected.id === selectedId}
          className={[
            "mt-2 h-[28px] w-full border-2 text-[12px] font-bold",
            inspected.id === selectedId
              ? "border-[var(--mc-47)] bg-[var(--mc-71)] text-[var(--mc-ink-muted)]"
              : "border-[#2f7a2f] bg-[#57c257] text-[#0c3a0c] shadow-[inset_2px_2px_0_rgba(255,255,255,0.55),inset_-2px_-2px_0_rgba(0,0,0,0.45)] hover:brightness-110",
          ].join(" ")}
        >
          {inspected.id === selectedId ? "Currently in use" : `Use ${inspected.label}`}
        </button>
      </div>
    </div>
  );
}

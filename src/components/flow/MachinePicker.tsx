"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { MachineHandler, MachineTier, Recipe } from "@/lib/model/types";
import { applyMachineHandlerToRecipe, formatRate } from "@/lib/model";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { GT_TIER_COLORS } from "./tier-colors";
import type { MachineHandlerIcon } from "./machine-icons";

/**
 * The machine switcher, playground-geometry edition. Three pieces share one
 * fixed Minecraft-gray palette (identical in both app themes, like real MC
 * GUIs): dark ink only ever sits on the light grays, white text only on the
 * dark header gray, always with a pixel shadow.
 *
 *  - MachineTabStrip: big icon tabs above the node; click switches, hover
 *    previews. The trailing "⋯" tab opens the compare table.
 *  - MachineGlanceBar: fixed-grid header row (icon | category eyebrow + name
 *    | TIME | POWER | PARALLEL). Nothing moves when the machine changes.
 *  - MachineInspectorPanel: floating full inspector fed by hover from any
 *    surface — stats, min tier, parallels math, control ranges, overclock
 *    notes, Use button.
 *  - MachineCompareTable: sortable per-recipe comparison of every machine.
 */

// Fixed classic-MC palette (deliberately NOT theme variables).
const MC = {
  m100: "#ffffff",
  m85: "#d8d8d8",
  m78: "#c6c6c6",
  m71: "#b5b5b5",
  m61: "#9c9c9c",
  m55: "#8b8b8b",
  m47: "#787878",
  m33: "#555555",
  m15: "#262626",
  ink: "#1a1a1a",
  inkSoft: "#4c4c4c",
};

export interface HandlerRecipeStats {
  seconds: number;
  eut: number;
  totalEu: number;
  minimumTier: string;
  perfectOverclock: boolean;
  fixedParallels?: number;
  scalingParallels: { label: string; max: number }[];
  controlSummaries: { label: string; detail: string }[];
  exactOverclocks: boolean;
}

export function getHandlerRecipeStats(recipe: Recipe, handler: MachineHandler): HandlerRecipeStats {
  const applied = applyMachineHandlerToRecipe(recipe, { machineHandlerId: handler.id });
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
    seconds: applied.durationTicks / 20,
    eut: applied.eut,
    totalEu: applied.eut * applied.durationTicks,
    minimumTier: applied.minimumTier,
    perfectOverclock: applied.machineProfile?.perfectOverclock === true,
    fixedParallels,
    scalingParallels,
    controlSummaries,
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

function formatSeconds(seconds: number): string {
  return seconds >= 100
    ? Math.round(seconds).toLocaleString("en-US")
    : seconds.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function powerText(stats: HandlerRecipeStats): string {
  return stats.eut > 0 ? `${formatRate(stats.eut, 0)} EU/t` : "none";
}

function TierChip({ tier, className }: { tier: string; className?: string }) {
  const color = GT_TIER_COLORS[tier as Exclude<MachineTier, "DEMO">];
  const base =
    "inline-block shrink-0 border-2 text-center font-bold shadow-[inset_1px_1px_0_rgba(255,255,255,0.45)]";
  if (!color) {
    return (
      <span
        className={[base, "min-w-[38px] px-1 text-[10px] leading-[14px]", className ?? ""].join(" ")}
        style={{ backgroundColor: MC.m71, borderColor: MC.m47, color: MC.ink }}
      >
        ANY
      </span>
    );
  }
  return (
    <span
      className={[base, "min-w-[38px] px-1 text-[10px] leading-[14px]", className ?? ""].join(" ")}
      style={{
        backgroundColor: color.background,
        borderColor: color.border,
        color: color.text,
        textShadow: `1px 1px 0 ${color.shadow}`,
      }}
    >
      {tier}
    </span>
  );
}

function MachineIconBox({
  icon,
  label,
  box,
  iconPixels,
}: {
  icon?: MachineHandlerIcon;
  label: string;
  box: number;
  iconPixels: number;
}) {
  return (
    <span
      className="flex shrink-0 items-center justify-center"
      style={{
        width: box,
        height: box,
        backgroundColor: MC.m55,
        boxShadow: "inset 2px 2px 0 #373737, inset -2px -2px 0 #ffffff",
      }}
    >
      {icon ? (
        <ResourceIcon
          resource={{ ...icon, amount: 1 }}
          size="sm"
          bare
          showAmount={false}
          tooltip={false}
          className="!h-full !w-full"
          iconPixelSize={iconPixels}
        />
      ) : (
        <span className="text-[12px] font-bold" style={{ color: MC.m100 }}>
          {label.slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Tab strip                                                           */
/* ------------------------------------------------------------------ */

export function MachineTabStrip({
  handlers,
  selectedId,
  previewId,
  iconsById,
  onHover,
  onSelect,
  onToggleCompare,
  isCompareOpen,
}: {
  handlers: MachineHandler[];
  selectedId: string;
  previewId?: string;
  iconsById: ReadonlyMap<string, MachineHandlerIcon>;
  onHover: (handlerId: string | undefined) => void;
  onSelect: (handlerId: string) => void;
  onToggleCompare: () => void;
  isCompareOpen: boolean;
}) {
  return (
    <div
      className="nodrag -mb-[2px] flex items-end gap-[3px] px-1"
      onMouseLeave={() => onHover(undefined)}
    >
      {handlers.map((handler) => {
        const active = handler.id === selectedId;
        const peeked = handler.id === previewId && !active;
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
              "flex w-[46px] items-center justify-center border-2 border-b-0 hover:brightness-110",
              active ? "h-[44px]" : "h-[38px]",
            ].join(" ")}
            style={{
              backgroundColor: active ? MC.m85 : MC.m61,
              borderColor: peeked ? "#0e7490" : active ? MC.m15 : MC.m33,
              boxShadow: active
                ? `inset 2px 2px 0 ${MC.m100}`
                : peeked
                  ? `inset 2px 2px 0 ${MC.m85}, 0 0 0 2px #22d3ee`
                  : `inset 2px 2px 0 ${MC.m85}`,
              opacity: active || peeked ? 1 : 0.85,
            }}
          >
            <MachineIconBox
              icon={iconsById.get(handler.id)}
              label={handler.label}
              box={34}
              iconPixels={30}
            />
          </button>
        );
      })}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggleCompare();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        title="Compare all machines"
        aria-label="Compare all machines"
        className={[
          "flex w-[30px] items-center justify-center border-2 border-b-0 text-[15px] font-bold leading-none hover:brightness-110",
          isCompareOpen ? "h-[44px]" : "h-[38px]",
        ].join(" ")}
        style={{
          backgroundColor: isCompareOpen ? MC.m85 : MC.m61,
          borderColor: isCompareOpen ? MC.m15 : MC.m33,
          boxShadow: isCompareOpen ? `inset 2px 2px 0 ${MC.m100}` : `inset 2px 2px 0 ${MC.m85}`,
          color: isCompareOpen ? MC.ink : MC.m100,
          textShadow: isCompareOpen ? undefined : "1px 1px 0 #3f3f3f",
        }}
      >
        ⋯
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Glance bar                                                          */
/* ------------------------------------------------------------------ */

export function MachineGlanceBar({
  recipe,
  category,
  handler,
  icon,
  isPreview,
}: {
  recipe: Recipe;
  category: string;
  handler: MachineHandler;
  icon?: MachineHandlerIcon;
  isPreview: boolean;
}) {
  const stats = getHandlerRecipeStats(recipe, handler);
  const parallels = stats.fixedParallels;
  return (
    <div
      className="grid h-[34px] min-w-0 items-center gap-[6px] border-2 pl-[3px] pr-[6px]"
      style={{
        gridTemplateColumns: "28px minmax(0,1fr) 46px 70px 50px",
        backgroundColor: MC.m61,
        borderColor: MC.m15,
        boxShadow: isPreview
          ? `inset 2px 2px 0 ${MC.m85}, inset -2px -2px 0 #5d5d5d, 0 0 0 2px #22d3ee`
          : `inset 2px 2px 0 ${MC.m85}, inset -2px -2px 0 #5d5d5d`,
      }}
    >
      <MachineIconBox icon={icon} label={handler.label} box={26} iconPixels={22} />
      <span className="min-w-0 leading-[1.05]">
        <span
          className="block truncate text-[8px] font-bold uppercase tracking-[0.13em]"
          style={{ color: "#ececec", textShadow: "1px 1px 0 #4a4a4a" }}
        >
          {category}
        </span>
        <span
          className="minecraft-title block truncate text-[13px] font-bold leading-[14px]"
          style={{ color: MC.m100, textShadow: "1px 1px 0 #3d3d3d" }}
        >
          {handler.label}
          {isPreview ? " ?" : ""}
        </span>
      </span>
      <GlanceCell label="TIME" value={`${formatSeconds(stats.seconds)}s`} />
      <GlanceCell label="POWER" value={powerText(stats)} dim={stats.eut <= 0} />
      <GlanceCell
        label="PARALLEL"
        value={parallels !== undefined ? `×${formatRate(parallels, 0)}` : "—"}
        dim={parallels === undefined}
      />
    </div>
  );
}

function GlanceCell({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <span className="text-right leading-[1.1]">
      <span
        className="block text-[7px] font-bold tracking-[0.1em]"
        style={{ color: "#ececec", textShadow: "1px 1px 0 #4a4a4a" }}
      >
        {label}
      </span>
      <span
        className="block whitespace-nowrap text-[11px] font-bold tabular-nums"
        style={{ color: dim ? "#d9d9d9" : MC.m100, textShadow: "1px 1px 0 #3d3d3d" }}
      >
        {value}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Inspector panel                                                     */
/* ------------------------------------------------------------------ */

export function MachineInspectorPanel({
  recipe,
  handler,
  icon,
  isPreview,
  selectedId,
  onUse,
  floating = true,
}: {
  recipe: Recipe;
  handler: MachineHandler;
  icon?: MachineHandlerIcon;
  isPreview: boolean;
  selectedId: string;
  onUse: (handlerId: string) => void;
  /** Floating: anchored right of the node. Otherwise a static pane (compare view). */
  floating?: boolean;
}) {
  const stats = getHandlerRecipeStats(recipe, handler);
  const group = getMachineGroup(handler);
  const kind = handler.kind === "multiblock" ? "Multiblock" : "Single block";
  const isActive = handler.id === selectedId;
  return (
    <div
      className={
        floating
          ? "nodrag nowheel absolute left-full top-0 z-[150] ml-2 w-[300px] border-[3px] p-[10px]"
          : "w-[300px] shrink-0 self-start p-[10px]"
      }
      style={
        floating
          ? {
              backgroundColor: MC.m78,
              borderColor: MC.m15,
              boxShadow: `inset 2px 2px 0 ${MC.m100}, inset -2px -2px 0 ${MC.m33}, 5px 5px 0 rgba(0,0,0,0.3)`,
            }
          : { borderLeft: `3px solid ${MC.m47}` }
      }
      onClick={(event) => event.stopPropagation()}
      role="region"
      aria-label={`Machine inspector: ${handler.label}`}
    >
      <div
        className="mb-2 flex items-center justify-between text-[8px] font-bold uppercase tracking-[0.12em]"
        style={{ color: MC.inkSoft }}
      >
        <span>Inspector</span>
        <span style={{ color: isPreview ? "#0e7490" : MC.inkSoft }}>
          {isPreview ? "previewing — hover" : "selected machine"}
        </span>
      </div>
      <div className="flex items-center gap-2 border-b-[3px] pb-2" style={{ borderColor: MC.m61 }}>
        <MachineIconBox icon={icon} label={handler.label} box={48} iconPixels={40} />
        <span className="min-w-0">
          <span
            className="block text-[14px] font-bold leading-[1.15]"
            style={{ color: MC.ink }}
          >
            {handler.label}
          </span>
          <span
            className="block text-[9px] font-bold uppercase tracking-[0.1em]"
            style={{ color: MC.inkSoft }}
          >
            {group === "Multiblock" ? kind : `${group} · ${kind}`}
          </span>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-[5px] py-2">
        <InspectorStat label="Time" value={`${formatSeconds(stats.seconds)} s`} />
        <InspectorStat label="Power" value={powerText(stats)} good={stats.eut <= 0} />
        <InspectorStat
          label="Per craft"
          value={stats.totalEu > 0 ? `${formatRate(stats.totalEu, 0)} EU` : "—"}
        />
        <InspectorStat label="Min tier" value={<TierChip tier={stats.minimumTier} />} />
        <InspectorStat
          label="Parallels"
          value={stats.fixedParallels !== undefined ? `×${formatRate(stats.fixedParallels, 0)}` : "1"}
          good={stats.fixedParallels !== undefined}
        />
        <InspectorStat
          label="Scaling"
          value={
            stats.scalingParallels.length > 0
              ? `×${formatRate(stats.scalingParallels[0].max, 0)} · ${stats.scalingParallels[0].label}`
              : "—"
          }
          small
        />
      </div>

      {stats.controlSummaries.length > 0 ? (
        <>
          <div
            className="mb-1 text-[8px] font-bold uppercase tracking-[0.12em]"
            style={{ color: MC.inkSoft }}
          >
            Structure controls
          </div>
          {stats.controlSummaries.map((control) => (
            <div
              key={control.label}
              className="mb-[5px] border-2 px-2 py-[5px]"
              style={{
                backgroundColor: MC.m85,
                borderColor: MC.m47,
                boxShadow: `inset 2px 2px 0 ${MC.m100}`,
              }}
            >
              <div className="text-[11px] font-bold" style={{ color: MC.ink }}>
                ⚙ {control.label}
              </div>
              {control.detail ? (
                <div className="text-[10px] leading-[1.35]" style={{ color: "#3d3d3d" }}>
                  {control.detail}
                </div>
              ) : null}
            </div>
          ))}
        </>
      ) : null}

      <div
        className="mb-1 mt-1 text-[8px] font-bold uppercase tracking-[0.12em]"
        style={{ color: MC.inkSoft }}
      >
        Overclocking
      </div>
      <div className="text-[10.5px] leading-[1.4]" style={{ color: "#3d3d3d" }}>
        {stats.exactOverclocks
          ? "Exact — per-tier numbers came from GregTech's own calculator in game."
          : stats.perfectOverclock
            ? "Perfect — 4× speed for 4× power per tier; energy per craft never grows."
            : "Standard — 2× speed for 4× power per tier above minimum."}
      </div>

      <button
        type="button"
        disabled={isActive}
        onClick={() => onUse(handler.id)}
        className="mt-2 h-[30px] w-full border-2 text-[12px] font-bold"
        style={
          isActive
            ? { backgroundColor: MC.m71, borderColor: MC.m47, color: MC.inkSoft }
            : {
                backgroundColor: "#57c257",
                borderColor: "#2f7a2f",
                color: "#0c3a0c",
                boxShadow:
                  "inset 2px 2px 0 rgba(255,255,255,0.55), inset -2px -2px 0 rgba(0,0,0,0.4)",
              }
        }
      >
        {isActive ? "Currently in use" : `Use ${handler.label}`}
      </button>
    </div>
  );
}

function InspectorStat({
  label,
  value,
  good,
  small,
}: {
  label: string;
  value: ReactNode;
  good?: boolean;
  small?: boolean;
}) {
  return (
    <div
      className="border-2 px-2 py-[4px]"
      style={{
        backgroundColor: MC.m85,
        borderColor: MC.m47,
        boxShadow: `inset 2px 2px 0 ${MC.m100}`,
      }}
    >
      <div
        className="text-[8px] font-bold uppercase tracking-[0.08em]"
        style={{ color: MC.inkSoft }}
      >
        {label}
      </div>
      <div
        className={[small ? "text-[10px]" : "text-[12px]", "font-bold tabular-nums"].join(" ")}
        style={{ color: good ? "#1d6b1d" : MC.ink }}
      >
        {value}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Compare table                                                       */
/* ------------------------------------------------------------------ */

type SortKey = "name" | "tier" | "time" | "eut" | "craft" | "parallels";

const COMPARE_COLUMNS: { key: SortKey | "controls"; label: string; numeric?: boolean }[] = [
  { key: "name", label: "Machine" },
  { key: "tier", label: "Min tier" },
  { key: "time", label: "Time", numeric: true },
  { key: "eut", label: "EU/t", numeric: true },
  { key: "craft", label: "EU/craft", numeric: true },
  { key: "parallels", label: "Parallels", numeric: true },
  { key: "controls", label: "Controls" },
];

export function MachineCompareTable({
  recipe,
  handlers,
  selectedId,
  iconsById,
  onHover,
  onUse,
  inspector,
}: {
  recipe: Recipe;
  handlers: MachineHandler[];
  selectedId: string;
  iconsById: ReadonlyMap<string, MachineHandlerIcon>;
  onHover: (handlerId: string | undefined) => void;
  onUse: (handlerId: string) => void;
  /** Docked inspector pane for the hovered/selected row. */
  inspector?: ReactNode;
}) {
  const [sortKey, setSortKey] = useState<SortKey | undefined>();
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const rows = useMemo(
    () => handlers.map((handler) => ({ handler, stats: getHandlerRecipeStats(recipe, handler) })),
    [handlers, recipe],
  );

  const groups = useMemo(() => {
    if (sortKey) {
      const sorted = [...rows].sort((left, right) => {
        const value = (row: (typeof rows)[number]) => {
          switch (sortKey) {
            case "time":
              return row.stats.seconds;
            case "eut":
              return row.stats.eut;
            case "craft":
              return row.stats.totalEu;
            case "parallels":
              return row.stats.fixedParallels ?? 1;
            case "tier":
              return row.stats.minimumTier;
            default:
              return row.handler.label;
          }
        };
        const leftValue = value(left);
        const rightValue = value(right);
        return (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0) * sortDir;
      });
      return [{ group: undefined as MachineGroup | undefined, rows: sorted }];
    }
    return GROUP_ORDER.map((group) => ({
      group: group as MachineGroup | undefined,
      rows: rows.filter((row) => getMachineGroup(row.handler) === group),
    })).filter((entry) => entry.rows.length > 0);
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      if (sortDir === 1) {
        setSortDir(-1);
      } else {
        setSortKey(undefined);
        setSortDir(1);
      }
    } else {
      setSortKey(key);
      setSortDir(1);
    }
  };

  return (
    <div
      className="nodrag nowheel absolute left-0 top-full z-[140] mt-1 flex border-[3px]"
      style={{
        backgroundColor: MC.m78,
        borderColor: MC.m15,
        boxShadow: `inset 2px 2px 0 ${MC.m100}, inset -2px -2px 0 ${MC.m33}, 5px 5px 0 rgba(0,0,0,0.3)`,
      }}
      onClick={(event) => event.stopPropagation()}
      role="dialog"
      aria-label="Compare machines"
      onMouseLeave={() => onHover(undefined)}
    >
      <div className="max-h-[440px] w-[620px] overflow-auto p-2">
      <div className="px-1 pb-1 text-[13px] font-bold" style={{ color: MC.ink }}>
        Compare machines
        <span className="pl-2 text-[10px] font-normal" style={{ color: MC.inkSoft }}>
          numbers are for this recipe · click headers to sort · hover to inspect
        </span>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {COMPARE_COLUMNS.map((column) => (
              <th
                key={column.key}
                onClick={
                  column.key === "controls" ? undefined : () => toggleSort(column.key as SortKey)
                }
                className={[
                  "select-none whitespace-nowrap px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em]",
                  column.numeric ? "text-right" : "text-left",
                  column.key === "controls" ? "" : "cursor-pointer",
                ].join(" ")}
                style={{ color: "#3d3d3d", borderBottom: `3px solid ${MC.m47}` }}
              >
                {column.label}
                {sortKey === column.key ? (
                  <span style={{ color: "#0e7490" }}> {sortDir > 0 ? "▲" : "▼"}</span>
                ) : null}
              </th>
            ))}
            <th style={{ borderBottom: `3px solid ${MC.m47}` }} />
          </tr>
        </thead>
        <tbody>
          {groups.map(({ group, rows: groupRows }) => (
            <GroupRows
              key={group ?? "sorted"}
              group={group}
              rows={groupRows}
              selectedId={selectedId}
              iconsById={iconsById}
              onHover={onHover}
              onUse={onUse}
            />
          ))}
        </tbody>
      </table>
      </div>
      {inspector}
    </div>
  );
}

function GroupRows({
  group,
  rows,
  selectedId,
  iconsById,
  onHover,
  onUse,
}: {
  group?: MachineGroup;
  rows: { handler: MachineHandler; stats: HandlerRecipeStats }[];
  selectedId: string;
  iconsById: ReadonlyMap<string, MachineHandlerIcon>;
  onHover: (handlerId: string | undefined) => void;
  onUse: (handlerId: string) => void;
}) {
  return (
    <>
      {group ? (
        <tr>
          <td
            colSpan={8}
            className="px-2 pb-[2px] pt-2 text-[8px] font-bold uppercase tracking-[0.14em]"
            style={{ color: MC.inkSoft }}
          >
            {group}
          </td>
        </tr>
      ) : null}
      {rows.map(({ handler, stats }) => {
        const active = handler.id === selectedId;
        return (
          <tr
            key={handler.id}
            onMouseEnter={() => onHover(handler.id)}
            onDoubleClick={() => onUse(handler.id)}
            className="cursor-pointer"
            style={{ backgroundColor: active ? "#8b70dd" : undefined }}
          >
            <td className="px-2 py-[5px]" style={{ borderBottom: `2px solid ${MC.m71}` }}>
              <span className="flex items-center gap-2">
                <MachineIconBox
                  icon={iconsById.get(handler.id)}
                  label={handler.label}
                  box={30}
                  iconPixels={26}
                />
                <span
                  className="whitespace-nowrap text-[12px] font-bold"
                  style={{
                    color: active ? "#ffffff" : MC.ink,
                    textShadow: active ? "1px 1px 0 #4a3a8a" : undefined,
                  }}
                >
                  {handler.label}
                </span>
                {active ? (
                  <span
                    className="border px-1 text-[8px] font-bold leading-[12px]"
                    style={{ backgroundColor: "#57c257", borderColor: "#2f7a2f", color: "#0c3a0c" }}
                  >
                    ACTIVE
                  </span>
                ) : null}
              </span>
            </td>
            <CompareCell active={active}>
              <TierChip tier={stats.minimumTier} />
            </CompareCell>
            <CompareCell active={active} numeric>
              {formatSeconds(stats.seconds)} s
            </CompareCell>
            <CompareCell active={active} numeric>
              {stats.eut > 0 ? formatRate(stats.eut, 0) : "—"}
            </CompareCell>
            <CompareCell active={active} numeric>
              {stats.totalEu > 0 ? formatRate(stats.totalEu, 0) : "—"}
            </CompareCell>
            <CompareCell active={active} numeric>
              {stats.fixedParallels !== undefined
                ? `×${formatRate(stats.fixedParallels, 0)}`
                : stats.scalingParallels.length > 0
                  ? `×${formatRate(stats.scalingParallels[0].max, 0)} max`
                  : "—"}
            </CompareCell>
            <CompareCell active={active}>
              {stats.controlSummaries.length > 0
                ? stats.controlSummaries.map((control) => `⚙ ${control.label}`).join(" · ")
                : "—"}
            </CompareCell>
            <td
              className="px-2 py-[5px] text-right"
              style={{ borderBottom: `2px solid ${MC.m71}` }}
            >
              <button
                type="button"
                disabled={active}
                onClick={(event) => {
                  event.stopPropagation();
                  onUse(handler.id);
                }}
                className="border-2 px-2 py-[3px] text-[10px] font-bold"
                style={
                  active
                    ? { backgroundColor: MC.m71, borderColor: MC.m47, color: MC.inkSoft }
                    : {
                        backgroundColor: "#57c257",
                        borderColor: "#2f7a2f",
                        color: "#0c3a0c",
                        boxShadow: "inset 2px 2px 0 rgba(255,255,255,0.5)",
                      }
                }
              >
                {active ? "In use" : "Use"}
              </button>
            </td>
          </tr>
        );
      })}
    </>
  );
}

function CompareCell({
  children,
  active,
  numeric,
}: {
  children: ReactNode;
  active: boolean;
  numeric?: boolean;
}) {
  return (
    <td
      className={[
        "whitespace-nowrap px-2 py-[5px] text-[11.5px] tabular-nums",
        numeric ? "text-right" : "text-left",
      ].join(" ")}
      style={{
        color: active ? "#ffffff" : MC.ink,
        textShadow: active ? "1px 1px 0 #4a3a8a" : undefined,
        borderBottom: `2px solid ${MC.m71}`,
      }}
    >
      {children}
    </td>
  );
}

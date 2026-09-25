"use client";

import { checklistCursorStyle } from "./flow/ChecklistMode";

import { useMemo, useRef, useState, type CSSProperties } from "react";
import { Cloud, Zap } from "lucide-react";
import { MotionNumberText } from "./flow/board-motion";
import { powerDisplayFromEuT, powerDisplaySuffix } from "@/lib/model/rate-unit";
import { GT_TIER_COLORS } from "./flow/tier-colors";
import { useMachineHandlerIcons, type MachineHandlerIcon } from "./flow/machine-icons";
import { machineArtPixels } from "./flow/MachinePicker";
import { ResourceIcon } from "./nei/ResourceIcon";
import { formatCompact, formatCompactStable, formatPowerValue } from "@/lib/model/resources";
import { getVoltageTierMaxEuT } from "@/lib/model/tiers";
import {
  buildMachineList,
  formatMachineListCount,
  type MachineListEntry,
} from "@/lib/model/machine-list";
import type { NodePowerState } from "@/lib/solver/power-report";
import { getPowerMachineIcon } from "@/lib/power/planner-data";
import { useFactoryStore, useRateDisplayUnits } from "@/store/factory-store";
import { getEnergyHatchType } from "@/lib/machines/energy-hatches";
import { getHatchAmps } from "@/lib/solver/power";
import { MinecraftTooltip } from "@/components/nei/MinecraftTooltip";

/** A generator group's face in the list: the machine item the picker shows. */
const powerIconCache = new Map<string, MachineHandlerIcon | undefined>();
function powerMachineListIcon(sourceId: string): MachineHandlerIcon | undefined {
  if (!powerIconCache.has(sourceId)) {
    const icon = getPowerMachineIcon(sourceId);
    powerIconCache.set(
      sourceId,
      icon
        ? ({
            kind: "item",
            id: icon.id,
            displayName: icon.displayName,
            iconPath: icon.iconPath,
            dominantColor: icon.dominantColor,
          } as unknown as MachineHandlerIcon)
        : undefined,
    );
  }
  return powerIconCache.get(sourceId);
}

const NEUTRAL_CHIP = {
  background: "var(--mc-85)",
  border: "var(--mc-33)",
  text: "var(--mc-ink)",
  shadow: "transparent",
};

/** One row per board card, using its solved count in Solve and Pool. */
export function MachineShoppingList() {
  const [powerColumn, setPowerColumn] = useState<"peak" | "average">("peak");
  const project = useFactoryStore((state) => state.project);
  const checklistMode = useFactoryStore((state) => state.checklistMode);
  const lastResult = useFactoryStore((state) => state.lastResult);
  // The power column follows the power dial (EU/t or amps of a tier).
  useRateDisplayUnits();
  const focusBoardNode = useFactoryStore((state) => state.focusBoardNode);
  const machineIcons = useMachineHandlerIcons();
  const entries = useMemo(() => buildMachineList(project, lastResult), [project, lastResult]);

  // Preserve the machine-name tree; each child remains one individual card.
  const groups = useMemo(() => {
    const byName = new Map<string, MachineListEntry[]>();
    for (const entry of entries) {
      const group = byName.get(entry.label) ?? [];
      group.push(entry);
      byName.set(entry.label, group);
    }
    return [...byName.entries()];
  }, [entries]);
  const cycleRef = useRef(new Map<string, number>());
  const focusGroup = (label: string, cards: MachineListEntry[]) => {
    const next = ((cycleRef.current.get(label) ?? -1) + 1) % cards.length;
    cycleRef.current.set(label, next);
    focusBoardNode(cards[next]!.nodeId);
  };

  const totalMachines = entries.reduce((sum, group) => sum + group.count, 0);
  // Presence gates what shows, never the value: a figure whose machines
  // exist stays up and reads 0 rather than vanishing when everything idles.
  const hasEu = entries.some((group) => group.euT !== undefined);
  const hasSteam = entries.some((group) => group.steamLs !== undefined);
  const sum = (pick: (group: MachineListEntry) => number | undefined) =>
    entries.reduce((total, group) => total + (pick(group) ?? 0), 0);
  const totals = {
    euT: sum((group) => group.euT),
    avgEuT: sum((group) => group.avgEuT),
    steamLs: sum((group) => group.steamLs),
    avgSteamLs: sum((group) => group.avgSteamLs),
    madeEuT: sum((group) => group.madeEuT),
    avgMadeEuT: sum((group) => group.avgMadeEuT),
  };
  const hasMade = entries.some((group) => group.madeEuT !== undefined);
  if (entries.length === 0) {
    return null;
  }

  return (
    <div
      data-help-anchor="machines"
      data-power-column={powerColumn}
      className="inspector-machines flex min-h-0 flex-1 flex-col border-t border-neutral-700"
    >
      <div className="inspector-machine-summary border-b border-neutral-700 px-3 pb-2">
        {/* The sheet's head: the title on the left, the two column labels
            over their columns on the right. */}
        <div className="inspector-section-heading -mx-3">
          <h2>Machines</h2>
          <span className="inspector-count">{formatMachineListCount(totalMachines)}</span>
          <span
            className="inspector-rate-selector ml-auto flex justify-end gap-0.5"
            role="group"
            aria-label="Machine power display"
          >
            {(["peak", "average"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={powerColumn === value}
                onClick={() => setPowerColumn(value)}
                aria-label={value === "peak" ? "Show peak power" : "Show average power"}
                className="px-1 py-0.5"
              >
                {value === "peak" ? "Peak" : "Average"}
              </button>
            ))}
          </span>
        </div>
        {/* The totals, on top like a sheet: one row when the board only
            draws, three (used, made, net) once a generator sits on it, and
            a steam row whenever a steam machine does. */}
        {hasSteam ? (
          <TotalLine
            label="Steam"
            peak={{ steamLs: totals.steamLs }}
            average={{ steamLs: totals.avgSteamLs }}
          />
        ) : null}
        {hasEu || hasMade ? (
          <TotalLine
            label={hasMade ? "Used" : "Total"}
            peak={{ euT: totals.euT }}
            average={{ euT: totals.avgEuT }}
          />
        ) : null}
        {hasMade ? (
          <>
            <TotalLine
              label="Made"
              peak={{ madeEuT: totals.madeEuT }}
              average={{ madeEuT: totals.avgMadeEuT }}
            />
            <TotalLine
              label="Net"
              peak={{ netEuT: totals.madeEuT - totals.euT }}
              average={{ netEuT: totals.avgMadeEuT - totals.avgEuT }}
            />
          </>
        ) : null}
      </div>
      {/* overflow-x hidden outright: Windows overlay scrollbars float over
          content, so a row even a pixel wide of the column summons a
          horizontal bar across the list. Nothing here is allowed to scroll
          sideways; the name column truncates instead. */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-1">
        {groups.map(([label, cards]) => (
          <div key={label} className="py-0">
            <ListLine
              icon={
                cards[0]!.powerSourceId
                  ? powerMachineListIcon(cards[0]!.powerSourceId)
                  : machineIcons.get(cards[0]!.handlerId)
              }
              label={label}
              state="ok"
              checklist={
                checklistMode
                  ? cards.every((card) => project.checklist?.cards.includes(card.nodeId))
                  : undefined
              }
              onClick={() =>
                checklistMode
                  ? useFactoryStore.getState().toggleChecklist(
                      "cards",
                      cards.map((card) => card.nodeId),
                    )
                  : focusGroup(label, cards)
              }
            />
            {cards.map((entry, index) => (
              <ListLine
                key={entry.nodeId}
                nodeId={entry.nodeId}
                rowName={entry.label}
                indent
                isLast={index === cards.length - 1}
                label={
                  entry.pressure === "high-pressure"
                    ? "High pressure"
                    : entry.pressure === "bronze"
                      ? "Bronze"
                      : undefined
                }
                count={entry.count}
                chip={entry}
                peak={{ euT: entry.euT, madeEuT: entry.madeEuT, steamLs: entry.steamLs }}
                average={{
                  euT: entry.avgEuT,
                  madeEuT: entry.avgMadeEuT,
                  steamLs: entry.avgSteamLs,
                }}
                state={entry.state}
                checklist={
                  checklistMode
                    ? project.checklist?.cards.includes(entry.nodeId) === true
                    : undefined
                }
                onClick={() =>
                  checklistMode
                    ? useFactoryStore.getState().toggleChecklist("cards", [entry.nodeId])
                    : focusBoardNode(entry.nodeId)
                }
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** One figure of a line: what it draws, makes, or burns. */
interface Figure {
  euT?: number;
  madeEuT?: number;
  steamLs?: number;
  /** A totals row's difference: signed, green up, red down. */
  netEuT?: number;
}

/** The two right-hand columns share one width so every row lines up. */
const COLUMN_CLASS = "w-[80px] shrink-0 whitespace-nowrap text-right tabular-nums";

/**
 * A figure in its column: the energy's mark, the number, its unit. A
 * generator's make is green, a net is signed. Empty when the line has no
 * such figure, so the columns still line up.
 */
function FigureCell({ figure, className }: { figure?: Figure; className?: string }) {
  const value = figure?.netEuT ?? figure?.madeEuT ?? figure?.euT ?? figure?.steamLs;
  if (value === undefined) {
    return <span className={[COLUMN_CLASS, className ?? ""].join(" ")} />;
  }
  const steam =
    figure?.steamLs !== undefined &&
    figure.euT === undefined &&
    figure.madeEuT === undefined &&
    figure.netEuT === undefined;
  const made = figure?.madeEuT !== undefined;
  const net = figure?.netEuT !== undefined;
  const tone = net
    ? value >= 0
      ? "text-emerald-300"
      : "text-red-300"
    : made
      ? "text-emerald-300"
      : "";
  const text = (shown: number, settled: boolean) => {
    const shownValue = steam ? shown : powerDisplayFromEuT(shown);
    const number = steam
      ? settled ? formatCompact(shownValue) : formatCompactStable(shown)
      : formatPowerValue(shownValue, !settled);
    return net ? `${value >= 0 ? "+" : "-"}${number}` : made ? `+${number}` : number;
  };
  return (
    <span className={[COLUMN_CLASS, tone, className ?? ""].join(" ")}>
      {steam ? <SteamMark /> : <EuMark />}
      <MotionNumberText
        values={[Math.abs(value)]}
        render={(shown) => text(shown[0] ?? Math.abs(value), shown[0] === Math.abs(value))}
      />
      <span className="ml-0.5 text-[8px] font-normal text-[var(--mc-ink-muted)]">
        {steam ? "L/s" : powerDisplaySuffix()}
      </span>
    </span>
  );
}

/** A totals row of the sheet's head: a label, then both columns. */
function TotalLine({ label, peak, average }: { label: string; peak: Figure; average: Figure }) {
  return (
    <div className="flex w-full items-center gap-1.5 text-[13px] font-bold leading-5">
      <span className="min-w-0 flex-1 truncate text-[11px] uppercase tracking-wider text-[var(--mc-ink-muted)]">
        {label}
      </span>
      <FigureCell figure={peak} />
      <FigureCell figure={average} />
    </div>
  );
}

/**
 * EU/t and L/s sit a few pixels apart in this list and read alike at a
 * glance, so each figure wears its energy's mark: a bolt for EU, steam for
 * litres. The units themselves stay as they are - power is a per-tick fact,
 * steam a per-second one.
 */
function EuMark() {
  return <Zap aria-hidden className="mr-0.5 inline h-2.5 w-2.5 -translate-y-px text-amber-400" />;
}

function SteamMark() {
  // A little grey cloud, filled: steam is a gas, and at ten pixels a solid
  // silhouette reads where an outline or a droplet does not.
  return (
    <Cloud
      aria-hidden
      className="mr-0.5 inline h-2.5 w-2.5 -translate-y-px fill-current text-slate-300"
    />
  );
}

function ListLine({
  icon,
  nodeId,
  rowName,
  indent = false,
  isLast = false,
  count,
  label,
  chip,
  peak,
  average,
  state,
  onClick,
  checklist,
}: {
  icon?: MachineHandlerIcon;
  nodeId?: string;
  rowName?: string;
  /** A build sub-line: the icon column carries the tree branch instead. */
  indent?: boolean;
  /** The last sub-line closes its branch with an L instead of a T. */
  isLast?: boolean;
  /** Absent on a mixed machine's name line; "1×" is otherwise said out loud. */
  count?: number;
  label?: string;
  /** The fused hatch-and-tier chip, when this line is one build. */
  chip?: Pick<
    MachineListEntry,
    "tier" | "hatches" | "hatchChip" | "hatchTypeId" | "amps" | "isMultiblock" | "typedEuT"
  >;
  /** The line's two columns: full draw, and the solve-weighted draw. */
  peak?: Figure;
  average?: Figure;
  state: NodePowerState;
  onClick: () => void;
  checklist?: boolean;
}) {
  const stalled = state !== "ok";
  // A multiblock's supply is a number, not a tier, so its chip wears the
  // neutral plate; a singleblock's chip is its tier's colour.
  const chipColor = chip?.tier
    ? chip.isMultiblock
      ? NEUTRAL_CHIP
      : GT_TIER_COLORS[chip.tier]
    : undefined;
  // What the line's build means, in one breath: what supplies the power, its
  // amps, the EU/t they buy, and both draw figures. Singleblocks get the same
  // story with the machine itself in the hatch's place.
  const hatchType = chip?.isMultiblock ? getEnergyHatchType(chip.hatchTypeId) : undefined;
  const hatchAmps =
    chip?.amps ??
    (hatchType
      ? hatchType.exotic
        ? hatchType.amps
        : getHatchAmps(chip?.hatches ?? 1)
      : undefined);
  // A multiblock's supply is one number: the typed EU/t, or what its stored
  // hatches add up to.
  const supplyEuT =
    chip?.typedEuT ??
    (chip?.tier && hatchAmps !== undefined ? getVoltageTierMaxEuT(chip.tier) * hatchAmps : 0);
  const peakEuT = peak?.euT;
  const averageEuT = average?.euT;
  const tierBadge =
    chip?.tier && chipColor ? (
      <span
        className="border px-1 text-[10px] font-bold leading-[15px]"
        style={{
          backgroundColor: chipColor.background,
          borderColor: chipColor.border,
          color: chipColor.text,
          textShadow: `1px 1px 0 ${chipColor.shadow}`,
        }}
      >
        {chip.tier}
      </span>
    ) : null;
  const hatchStory =
    chip?.tier && hatchAmps !== undefined ? (
      <div className="w-max max-w-[280px]">
        {count !== undefined ? (
          <div className="text-[13px] font-semibold text-white">
            {count}× {count === 1 ? "machine" : "machines"}
          </div>
        ) : null}
        <div className="mt-0.5 flex items-center gap-1.5 text-[13px] font-semibold text-white">
          {chip.isMultiblock ? (
            <span>Supplied {formatCompact(supplyEuT)} EU/t per machine</span>
          ) : (
            <>
              {tierBadge}
              <span>Per machine</span>
            </>
          )}
        </div>
        {!chip.isMultiblock ? (
          <div className="mt-0.5 text-[11px] leading-4 text-slate-300">
            {formatCompact(hatchAmps)} A:{" "}
            <span className="font-bold text-white">{formatCompact(supplyEuT)} EU/t</span>
          </div>
        ) : null}
        {peakEuT !== undefined ? (
          <>
            <div className="text-[11px] leading-4 text-slate-300">
              PEAK <span className="font-bold text-white">{formatPowerValue(powerDisplayFromEuT(peakEuT))} {powerDisplaySuffix()}</span>
            </div>
            <div className="text-[11px] leading-4 text-slate-300">
              AVG{" "}
              <span className="font-bold text-white">{formatPowerValue(powerDisplayFromEuT(averageEuT ?? 0))} {powerDisplaySuffix()}</span>
            </div>
          </>
        ) : null}
      </div>
    ) : undefined;

  // The whole LINE answers the hover, not just the chip: the build's power
  // story is about the row, and a target the width of a chip made the panel
  // feel like a secret.
  return (
    <MinecraftTooltip
      content={
        checklist === undefined
          ? hatchStory
          : checklist
            ? "Completed — click to restore"
            : "Click to mark these machines complete"
      }
    >
      <button
        type="button"
        data-machine-node-id={nodeId}
        aria-label={nodeId ? `${formatMachineListCount(count ?? 0)}× ${rowName}` : undefined}
        onClick={onClick}
        aria-pressed={checklist}
        data-checklist-done={checklist}
        data-checklist-row={checklist !== undefined ? "true" : undefined}
        style={checklistCursorStyle as CSSProperties}
        className={`${chip || indent ? "inspector-machine-build" : "inspector-machine-title"} inspector-machine-row relative flex w-full items-center gap-1 px-2 py-0.5 text-left hover:bg-white/5`}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1">
          {indent ? (
            /* The branch: a vertical line dropping from under the parent's
             icon, elbowing out to this build's count. Anchored to the
             BUTTON's box (inset-y-0), not the flex row - the row's box
             stops at the padding, and the 4px of it between rows is
             exactly the gap that used to chop the stem into dashes. The
             last build stops at its elbow, closing the stem in an L. */
            <>
              <span aria-hidden className="absolute bottom-0 left-2 top-0 w-[24px] opacity-60">
                <span
                  className={[
                    "absolute left-[11px] top-0 w-[2px] bg-[var(--mc-ink-muted)]",
                    isLast ? "h-[calc(50%+1px)]" : "bottom-0",
                  ].join(" ")}
                />
                <span className="absolute left-[11px] right-0 top-1/2 h-[2px] -translate-y-[1px] bg-[var(--mc-ink-muted)]" />
              </span>
              <span className="w-[24px] shrink-0" />
            </>
          ) : (
            <span className="flex h-[24px] w-[24px] shrink-0 items-center justify-center overflow-hidden">
              {icon ? (
                <ResourceIcon
                  resource={{ ...icon, amount: 1, consumed: true }}
                  size="sm"
                  showAmount={false}
                  bare
                  tooltip={false}
                  // Machine renders are 256px squares whose art fills barely
                  // half the frame; asked for raw, the row showed a 12px
                  // machine swimming in margin. machineArtPixels crops the
                  // transparent frame exactly, so the art fills the box.
                  iconPixelSize={machineArtPixels(24)}
                  className="!h-full !w-full"
                />
              ) : null}
            </span>
          )}
          {count !== undefined ? (
            <span className="shrink-0 text-[14px] font-bold tabular-nums">
              {formatMachineListCount(count)}×
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate whitespace-nowrap text-[14px] leading-6">
            {label ?? ""}
          </span>
          {chip?.tier && (
            <span
              className="inspector-build-config flex shrink-0 items-center gap-1 rounded-sm px-1 font-bold leading-4"
              style={{
                color: (GT_TIER_COLORS[chip.tier] ?? NEUTRAL_CHIP).text,
                backgroundColor: (GT_TIER_COLORS[chip.tier] ?? NEUTRAL_CHIP).background,
              }}
            >
              {chip.isMultiblock && (
                <span className="text-[10px] tabular-nums">
                  {chip.typedEuT !== undefined
                    ? formatCompact(chip.typedEuT / getVoltageTierMaxEuT(chip.tier)) + "A"
                    : hatchAmps !== undefined
                      ? formatCompact(hatchAmps) + "A"
                      : "—"}
                </span>
              )}
              <span className="text-[10px] font-bold leading-4">{chip.tier}</span>
            </span>
          )}
        </span>
        {(peak || average || stalled) && (
          <span className="inspector-machine-figures flex shrink-0 items-center gap-1.5">
            <span className="flex items-baseline gap-1">
              {stalled ? (
                <span className={[COLUMN_CLASS, "font-bold text-red-400"].join(" ")}>
                  {state === "under-powered" ? "LOW!" : "TIER!"}
                </span>
              ) : (
                <FigureCell figure={peak} className="text-[13px]" />
              )}
            </span>
            <span className="flex items-baseline gap-1">
              <FigureCell figure={stalled ? undefined : average} className="text-[13px]" />
            </span>
          </span>
        )}
      </button>
    </MinecraftTooltip>
  );
}

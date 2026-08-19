"use client";

import { useMemo, useRef } from "react";
import { Cloud, Zap } from "lucide-react";
import { MotionNumberText } from "./flow/board-motion";
import { GT_TIER_COLORS } from "./flow/tier-colors";
import { useMachineHandlerIcons, type MachineHandlerIcon } from "./flow/machine-icons";
import { machineArtPixels } from "./flow/MachinePicker";
import { ResourceIcon } from "./nei/ResourceIcon";
import { getSelectedMachineHandler } from "@/lib/model/recipe-rules";
import { isCustomRateRecipe } from "@/lib/model/custom-rate";
import { formatCompact, formatCompactStable } from "@/lib/model/resources";
import { getVoltageTierIndex } from "@/lib/model/tiers";
import type { MachineTier } from "@/lib/model/types";
import {
  getNodePowerReport,
  getNodeSteamReport,
  hasPowerReport,
  type NodePowerState,
} from "@/lib/solver/power-report";
import { useWorkspaceView, writeWorkspaceView } from "@/lib/workspace-view";
import { useFactoryStore } from "@/store/factory-store";

type VoltageTier = Exclude<MachineTier, "DEMO">;

/**
 * One BUILD: a machine at one power configuration, summed across every card
 * that runs it. A singleblock build is its tier; a multiblock build is its
 * tier AND its hatch count, because a two-hatch reactor and a one-hatch
 * reactor are different things to construct even at the same voltage.
 */
interface BuildLine {
  key: string;
  count: number;
  hatches: number;
  isMultiblock: boolean;
  tier?: VoltageTier;
  tierIndex: number;
  euT?: number;
  steamLs?: number;
  /** The same figures weighted by each card's solved usage, for AVG mode. */
  avgEuT?: number;
  avgSteamLs?: number;
  /** Set on steam machines: bronze and high pressure are different builds. */
  pressure?: "bronze" | "high-pressure";
  state: NodePowerState;
  nodeIds: string[];
}

interface MachineGroup {
  label: string;
  icon?: MachineHandlerIcon;
  count: number;
  euT?: number;
  steamLs?: number;
  avgEuT?: number;
  avgSteamLs?: number;
  builds: BuildLine[];
  nodeIds: string[];
  minTierIndex: number;
}

/**
 * The build list, a permanent fixture on the panel's floor — and one list
 * that reads two ways at once. Machines group by WHAT they are: every
 * electrolyzer on the board lands on one line with the total to build, the
 * fused hatch-and-tier chip and the summed draw, whichever cards they came
 * from. Only when one machine exists in more than one BUILD (an HV reactor
 * and an MV one, a one-hatch and a two-hatch) does the machine become a bare
 * name line with one sub-line per build underneath, each washed in its own
 * tier colour and carrying its own count, chip and draw. The name line adds
 * no numbers of its own: a summed figure over different builds answers no
 * question anyone shops with.
 *
 * Clicking a line jumps to its card; clicking again walks to the NEXT card
 * of that kind, so an aggregated line still leads to every board location
 * behind it.
 */
export function MachineShoppingList() {
  const project = useFactoryStore((state) => state.project);
  const lastResult = useFactoryStore((state) => state.lastResult);
  const focusBoardNode = useFactoryStore((state) => state.focusBoardNode);
  const machineIcons = useMachineHandlerIcons();
  // PEAK against AVG, panel arithmetic only: PEAK is every machine at full
  // draw at once (what the cables must carry), AVG weights each card by how
  // hard the solve says it actually runs (what the setup burns over time).
  const average = useWorkspaceView().averageMachineDraw;

  const groups = useMemo<MachineGroup[]>(() => {
    const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));
    const byMachine = new Map<
      string,
      MachineGroup & { buildsByKey: Map<string, BuildLine> }
    >();

    for (const node of project.nodes) {
      if (node.enabled === false) {
        continue;
      }
      const recipe = recipesById.get(node.recipeId);
      if (!recipe || isCustomRateRecipe(recipe)) {
        continue;
      }
      const handler = getSelectedMachineHandler(recipe, node);
      // A steam machine's row bills litres, never EU: its power report would
      // only carry a phantom tier chip and a zero draw.
      const steam = getNodeSteamReport(recipe, node);
      const report =
        !steam && hasPowerReport(recipe) ? getNodePowerReport(recipe, node) : undefined;
      const count = node.machineCount * Math.max(1, node.parallel);
      // A machine at 30% runs at full draw 30% of the time, so its
      // time-averaged burn is the nameplate figure times its solved usage.
      // At exactly 0% it never starts, so even PEAK bills it nothing; any
      // usage above zero still spikes to the full draw when it runs.
      const usage = Math.min(
        1,
        Math.max(0, lastResult.nodes[node.id]?.utilization ?? 1),
      );
      const runningCount = usage > 0 ? count : 0;
      const euT = report ? report.drawEuT * runningCount : undefined;
      const steamLs = steam ? steam.drawSteamPerTick * 20 * runningCount : undefined;

      const group =
        byMachine.get(handler.label) ??
        (() => {
          const created = {
            label: handler.label,
            icon: undefined as MachineHandlerIcon | undefined,
            count: 0,
            euT: undefined as number | undefined,
            steamLs: undefined as number | undefined,
            avgEuT: undefined as number | undefined,
            avgSteamLs: undefined as number | undefined,
            builds: [],
            nodeIds: [],
            minTierIndex: Number.POSITIVE_INFINITY,
            buildsByKey: new Map<string, BuildLine>(),
          };
          byMachine.set(handler.label, created);
          return created;
        })();
      group.icon ??= machineIcons.get(handler.id);
      group.count += count;
      group.nodeIds.push(node.id);
      if (euT !== undefined) {
        group.euT = (group.euT ?? 0) + euT;
        group.avgEuT = (group.avgEuT ?? 0) + euT * usage;
      }
      if (steamLs !== undefined) {
        group.steamLs = (group.steamLs ?? 0) + steamLs;
        group.avgSteamLs = (group.avgSteamLs ?? 0) + steamLs * usage;
      }

      // The stacking rule: singleblocks of one tier are one build; a
      // multiblock's hatch count splits it further. A steam multiblock splits
      // on its pressure: a bronze build and a steel one are different things
      // to construct.
      const buildKey = report
        ? `${report.tier}|${report.isMultiblock ? report.hatches : "single"}`
        : steam
          ? `steam|${steam.highPressure ? "high" : "bronze"}`
          : "plain";
      // Steam machines sort with ULV: they are the start of the game, not the
      // end of the list a missing tier would banish them to.
      const tierIndex = report ? getVoltageTierIndex(report.tier) : steam ? 0 : Number.POSITIVE_INFINITY;
      group.minTierIndex = Math.min(group.minTierIndex, tierIndex);
      const build =
        group.buildsByKey.get(buildKey) ??
        (() => {
          const created: BuildLine = {
            key: `${handler.label}|${buildKey}`,
            count: 0,
            hatches: report?.hatches ?? 1,
            isMultiblock: report?.isMultiblock ?? steam?.isMultiblock ?? false,
            tier: report?.tier,
            tierIndex,
            euT: undefined,
            steamLs: undefined,
            avgEuT: undefined,
            avgSteamLs: undefined,
            pressure: steam ? (steam.highPressure ? "high-pressure" : "bronze") : undefined,
            state: "ok",
            nodeIds: [],
          };
          group.buildsByKey.set(buildKey, created);
          group.builds.push(created);
          return created;
        })();
      build.count += count;
      build.nodeIds.push(node.id);
      if (euT !== undefined) {
        build.euT = (build.euT ?? 0) + euT;
        build.avgEuT = (build.avgEuT ?? 0) + euT * usage;
      }
      if (steamLs !== undefined) {
        build.steamLs = (build.steamLs ?? 0) + steamLs;
        build.avgSteamLs = (build.avgSteamLs ?? 0) + steamLs * usage;
      }
      if (report && report.state !== "ok" && build.state === "ok") {
        build.state = report.state;
      }
    }

    const list = [...byMachine.values()];
    // Ordered by PEAK in both modes, so flipping the switch changes numbers
    // without reshuffling the list under the pointer.
    for (const group of list) {
      group.builds.sort(
        (a, b) => a.tierIndex - b.tierIndex || (b.euT ?? 0) - (a.euT ?? 0),
      );
    }
    list.sort(
      (a, b) =>
        a.minTierIndex - b.minTierIndex ||
        (b.euT ?? 0) - (a.euT ?? 0) ||
        a.label.localeCompare(b.label),
    );
    return list;
  }, [lastResult, machineIcons, project]);

  // Click-to-cycle state: which card of a line the last click landed on.
  // A ref, not state — advancing it must not re-render the list.
  const cycleRef = useRef(new Map<string, number>());
  const focusNext = (key: string, nodeIds: string[]) => {
    const next = ((cycleRef.current.get(key) ?? -1) + 1) % nodeIds.length;
    cycleRef.current.set(key, next);
    const nodeId = nodeIds[next];
    if (nodeId) {
      focusBoardNode(nodeId);
    }
  };

  const totalMachines = groups.reduce((sum, group) => sum + group.count, 0);
  // Presence gates what shows, never the value: a figure whose machines
  // exist stays up and reads 0 rather than vanishing when everything idles.
  const hasEu = groups.some((group) => group.euT !== undefined);
  const hasSteam = groups.some((group) => group.steamLs !== undefined);
  const totalEuT = groups.reduce(
    (sum, group) => sum + ((average ? group.avgEuT : group.euT) ?? 0),
    0,
  );
  const totalSteamLs = groups.reduce(
    (sum, group) => sum + ((average ? group.avgSteamLs : group.steamLs) ?? 0),
    0,
  );
  if (totalMachines === 0) {
    return null;
  }

  const steamFigure = hasSteam ? (
    <span className="whitespace-nowrap">
      <SteamMark />
      <MotionNumberText
        values={[totalSteamLs]}
        render={(shown) =>
          shown[0] === totalSteamLs
            ? formatCompact(totalSteamLs)
            : formatCompactStable(shown[0] ?? totalSteamLs)
        }
      />
      <span className="ml-0.5 text-[8px] font-normal text-[var(--mc-ink-muted)]">L/s</span>
    </span>
  ) : null;
  const euFigure = hasEu ? (
    <span className="whitespace-nowrap">
      <EuMark />
      <MotionNumberText
        values={[totalEuT]}
        render={(shown) =>
          shown[0] === totalEuT
            ? formatCompact(totalEuT)
            : formatCompactStable(shown[0] ?? totalEuT)
        }
      />
      <span className="ml-0.5 text-[8px] font-normal text-[var(--mc-ink-muted)]">EU/t</span>
    </span>
  ) : null;

  return (
    <div className="flex min-h-0 shrink-0 basis-[40%] flex-col border-t-2 border-[var(--mc-47)]">
      <div className="border-b border-[var(--mc-47)] bg-[var(--mc-71)] px-2 py-1">
        <div className="flex w-full items-center gap-2">
          <span className="text-sm font-bold uppercase tracking-wider">Power</span>
          {hasEu || hasSteam ? <DrawModePill average={average} /> : null}
          {/* ONE energy rides the title line. Two do not fit the column
              beside the title and the pill, so the pair moves to a line of
              its own below — decided by what the board HAS, never by
              measured width, so a figure animating near the edge cannot
              bounce the header between one line and two. */}
          {hasEu !== hasSteam ? (
            <span className="ml-auto shrink-0 text-[13px] font-bold tabular-nums">
              {steamFigure ?? euFigure}
            </span>
          ) : null}
        </div>
        {hasEu && hasSteam ? (
          <span className="flex items-baseline justify-end gap-2 text-[13px] font-bold tabular-nums">
            {steamFigure}
            {euFigure}
          </span>
        ) : null}
      </div>
      {/* overflow-x hidden outright: Windows overlay scrollbars float over
          content, so a row even a pixel wide of the column summons a
          horizontal bar across the list. Nothing here is allowed to scroll
          sideways; the name column truncates instead. */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-1">
        {groups.map((group) => {
          const uniform = group.builds.length === 1;
          const build = group.builds[0];
          return (
            <div key={group.label} className="py-0.5">
              <ListLine
                icon={group.icon}
                // A uniform group is one whole line: count, chip, draw,
                // warning. A mixed one is a bare NAME — its counts and
                // numbers all live on the build sub-lines below.
                count={uniform ? group.count : undefined}
                label={group.label}
                chip={uniform ? build : undefined}
                euT={uniform ? (average ? build?.avgEuT : build?.euT) : undefined}
                steamLs={uniform ? (average ? build?.avgSteamLs : build?.steamLs) : undefined}
                state={uniform ? (build?.state ?? "ok") : "ok"}
                wash={uniform ? build?.tier : undefined}
                onClick={() => focusNext(group.label, group.nodeIds)}
              />
              {uniform
                ? null
                : group.builds.map((buildLine, index) => (
                    <ListLine
                      key={buildLine.key}
                      indent
                      isLast={index === group.builds.length - 1}
                      count={buildLine.count}
                      // A steam build has no tier chip; the pressure is the
                      // build, so the sub-line says it in words.
                      label={
                        buildLine.pressure === "high-pressure"
                          ? "High pressure"
                          : buildLine.pressure === "bronze"
                            ? "Bronze"
                            : undefined
                      }
                      chip={buildLine}
                      euT={average ? buildLine.avgEuT : buildLine.euT}
                      steamLs={average ? buildLine.avgSteamLs : buildLine.steamLs}
                      state={buildLine.state}
                      wash={buildLine.tier}
                      onClick={() => focusNext(buildLine.key, buildLine.nodeIds)}
                    />
                  ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * PEAK against AVG, both words always up, the same rule the RAW/NET switch
 * follows: a reader who has never met the distinction can see there is one
 * and read both answers before clicking anything. Panel arithmetic only; no
 * machine changes speed because of this switch. Anchored beside the title so
 * the right-hand figures can grow digits without moving it.
 */
function DrawModePill({ average }: { average: boolean }) {
  return (
    <div
      role="group"
      aria-label="Power figures"
      className="flex h-5 shrink-0 overflow-hidden rounded border border-[var(--mc-47)]"
    >
      <button
        type="button"
        onClick={() => writeWorkspaceView({ averageMachineDraw: false })}
        aria-label="Show peak draw"
        aria-pressed={!average}
        className={[
          "px-1.5 text-[9px] font-black leading-none tracking-tight",
          average
            ? "text-[var(--mc-ink-muted)] hover:text-[var(--mc-ink)]"
            : "bg-[var(--mc-56)] text-[var(--mc-ink)]",
        ].join(" ")}
      >
        PEAK
      </button>
      <button
        type="button"
        onClick={() => writeWorkspaceView({ averageMachineDraw: true })}
        aria-label="Show average draw"
        aria-pressed={average}
        className={[
          "border-l border-[var(--mc-47)] px-1.5 text-[9px] font-black leading-none tracking-tight",
          average
            ? "bg-[var(--mc-56)] text-[var(--mc-ink)]"
            : "text-[var(--mc-ink-muted)] hover:text-[var(--mc-ink)]",
        ].join(" ")}
      >
        AVG
      </button>
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
  indent = false,
  isLast = false,
  count,
  label,
  chip,
  euT,
  steamLs,
  state,
  wash,
  onClick,
}: {
  icon?: MachineHandlerIcon;
  /** A build sub-line: the icon column carries the tree branch instead. */
  indent?: boolean;
  /** The last sub-line closes its branch with an L instead of a T. */
  isLast?: boolean;
  /** Absent on a mixed machine's name line; "1×" is otherwise said out loud. */
  count?: number;
  label?: string;
  /** The fused hatch-and-tier chip, when this line is one build. */
  chip?: Pick<BuildLine, "tier" | "hatches" | "isMultiblock">;
  euT?: number;
  /** A steam machine's figure: what it burns, in L/s, instead of EU/t. */
  steamLs?: number;
  state: NodePowerState;
  /** Tier whose colour faintly washes the whole line. */
  wash?: VoltageTier;
  onClick: () => void;
}) {
  const stalled = state !== "ok";
  const chipColor = chip?.tier ? GT_TIER_COLORS[chip.tier] : undefined;

  // No hover panel on these lines: the row already says everything it knows,
  // and a tooltip repeating it was noise in the way of the scrollbar.
  return (
      <button
        type="button"
        onClick={onClick}
        // The wash sits at ~12% - present enough to read as the tier's
        // colour without competing with the chips that name it.
        style={wash ? { backgroundColor: `${GT_TIER_COLORS[wash].background}1f` } : undefined}
        className="relative flex w-full items-center gap-1.5 py-0.5 pl-2 pr-2 text-left hover:bg-[var(--mc-71)]"
      >
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
          <span className="shrink-0 text-[14px] font-bold tabular-nums">{count}×</span>
        ) : null}
        <span className="min-w-0 flex-1 truncate whitespace-nowrap text-[14px] leading-6">
          {label ?? ""}
        </span>
        {chipColor && chip ? (
          /* The card's own chip, verbatim: hatch count fused left of the
             tier, one paint job, so the panel and the board read as one.
             Always in the right-hand column, so every chip on the list sits
             on one line however the rows around it are shaped. */
          <span className="flex shrink-0">
            {chip.isMultiblock ? (
              <span
                className="h-5 border-2 border-r-0 px-1 text-[11px] font-bold leading-4"
                style={{
                  backgroundColor: chipColor.background,
                  borderColor: chipColor.border,
                  color: chipColor.text,
                  textShadow: `1px 1px 0 ${chipColor.shadow}`,
                }}
              >
                {chip.hatches}×
              </span>
            ) : null}
            <span
              className="h-5 border-2 px-1.5 text-[11px] font-bold leading-4"
              style={{
                backgroundColor: chipColor.background,
                borderColor: chipColor.border,
                color: chipColor.text,
                textShadow: `1px 1px 0 ${chipColor.shadow}`,
              }}
            >
              {chip.tier}
            </span>
          </span>
        ) : null}
      <span
        className={[
          // A FLOOR, not a fixed width: 70px keeps the tier chips on one
          // column for ordinary figures, and a wider one ("999.9k" plus its
          // mark) grows the cell while the name column yields. Fixed, the
          // overflow had nowhere honest to go and figures left the row.
          "min-w-[70px] shrink-0 whitespace-nowrap text-right text-[13px] tabular-nums",
          stalled ? "font-bold text-red-400" : "",
        ].join(" ")}
      >
        {stalled ? (
          state === "under-powered" ? (
            "LOW!"
          ) : (
            "TIER!"
          )
        ) : euT !== undefined ? (
          <>
            <EuMark />
            <MotionNumberText
              values={[euT]}
              render={(shown) =>
                shown[0] === euT
                  ? formatCompact(euT)
                  : formatCompactStable(shown[0] ?? euT)
              }
            />
            {/* Same suffix treatment as the card's power cell: small, grey,
                hugging the number. */}
            <span className="ml-0.5 text-[8px] text-[var(--mc-ink-muted)]">EU/t</span>
          </>
        ) : steamLs !== undefined ? (
          <>
            <SteamMark />
            <MotionNumberText
              values={[steamLs]}
              render={(shown) =>
                shown[0] === steamLs
                  ? formatCompact(steamLs)
                  : formatCompactStable(shown[0] ?? steamLs)
              }
            />
            <span className="ml-0.5 text-[8px] text-[var(--mc-ink-muted)]">L/s</span>
          </>
        ) : (
          ""
        )}
        </span>
      </button>
  );
}

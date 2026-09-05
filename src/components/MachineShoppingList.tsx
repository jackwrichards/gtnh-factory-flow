"use client";

import { useMemo, useRef, type ReactNode } from "react";
import { Cloud, Zap } from "lucide-react";
import { MotionNumberText } from "./flow/board-motion";
import { powerDisplayFromEuT, powerDisplaySuffix } from "@/lib/model/rate-unit";
import { GT_TIER_COLORS } from "./flow/tier-colors";
import { useMachineHandlerIcons, type MachineHandlerIcon } from "./flow/machine-icons";
import { machineArtPixels } from "./flow/MachinePicker";
import { ResourceIcon } from "./nei/ResourceIcon";
import { getSelectedMachineHandler } from "@/lib/model/recipe-rules";
import { isCustomRateRecipe } from "@/lib/model/custom-rate";
import {
  CROP_HARVESTER_INDUSTRIAL_FARM_ID,
  cropsNhEnvironmentFromTiers,
  cropsNhFarmEut,
  cropsNhHarvestTicks,
  cropsNhHarvesterFromTiers,
  cropsNhHarvesterMachineCount,
  cropsNhHarvesterTierName,
  cropsNhIsHandPicked,
  cropsNhManagerEuPerHarvest,
  getCropsNhStats,
  isCropProductionRecipe,
} from "@/lib/model/passive-production";
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
import { getPowerMachineIcon } from "@/lib/power/planner-data";
import { useFactoryStore, useRateDisplayUnits } from "@/store/factory-store";
import { getEnergyHatchType } from "@/lib/machines/energy-hatches";
import { getHatchAmps } from "@/lib/solver/power";
import { getVoltageTierMaxEuT } from "@/lib/model/tiers";
import { MinecraftTooltip } from "@/components/nei/MinecraftTooltip";
import { EnergyHatchArt } from "@/components/flow/EnergyHatchMenu";
import {
  energyHatchCatalogKey,
  useEnergyHatchCatalog,
} from "@/components/flow/use-energy-hatch-catalog";

type VoltageTier = Exclude<MachineTier, "DEMO">;

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
  /** An exotic hatch family's amp badge, worn instead of the count. */
  hatchChip?: string;
  /** The family itself, so the row can wear the hatch item's art. */
  hatchTypeId?: string;
  /** Working amps of the build, singleblocks included (arc furnaces run 3). */
  amps?: number;
  isMultiblock: boolean;
  tier?: VoltageTier;
  tierIndex: number;
  euT?: number;
  steamLs?: number;
  /** A generator build: the EU/t it MAKES, shown green where draw shows. */
  madeEuT?: number;
  /** The same figures weighted by each card's solved usage, for AVG mode. */
  avgEuT?: number;
  avgSteamLs?: number;
  avgMadeEuT?: number;
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
  madeEuT?: number;
  avgEuT?: number;
  avgSteamLs?: number;
  avgMadeEuT?: number;
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
  // The power column follows the power dial (EU/t or amps of a tier).
  useRateDisplayUnits();
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
      // A crop card's machineCount is planted crops, not machines. What it
      // builds is the manager or farm those crops fill; a hand-picked or
      // legacy passive crop builds nothing and stays off the list.
      const cropStats = getCropsNhStats(recipe);
      const crop = cropStats
        ? cropsNhHarvesterFromTiers(
            node.machineConfigTiers,
            node.machineHandlerId,
            cropStats.minSeedBedTier,
            cropStats.subSoil !== undefined,
          )
        : undefined;
      if (crop ? cropsNhIsHandPicked(crop) : isCropProductionRecipe(recipe)) {
        continue;
      }
      // A steam machine's row bills litres, never EU: its power report would
      // only carry a phantom tier chip and a zero draw.
      const steam = getNodeSteamReport(recipe, node);
      const report =
        !steam && hasPowerReport(recipe) ? getNodePowerReport(recipe, node) : undefined;
      const count = crop
        ? cropsNhHarvesterMachineCount(crop, node.machineCount)
        : node.machineCount * Math.max(1, node.parallel);
      if (crop && count <= 0) {
        continue;
      }
      // A machine at 30% runs at full draw 30% of the time, so its
      // time-averaged burn is the nameplate figure times its solved usage.
      // At exactly 0% it never starts, so even PEAK bills it nothing; any
      // usage above zero still spikes to the full draw when it runs.
      const usage = Math.min(
        1,
        Math.max(0, lastResult.nodes[node.id]?.utilization ?? 1),
      );
      const runningCount = usage > 0 ? count : 0;
      // A generator's contribution: positive EU/t is GENERATION (the green
      // column); the parasitic machines (DEHP, fusion, the pebble reactors)
      // run a NEGATIVE figure, which is honestly just consumption and bills
      // into the draw column like any machine's.
      const powerEuT = recipe.power ? recipe.power.euPerTick : undefined;
      const madeEuT =
        powerEuT !== undefined && powerEuT >= 0 ? powerEuT * runningCount : undefined;
      // A crop harvester's draw, from the mod's own math: an Industrial Farm
      // burns `getPowerUsage` continuously spread over its seeds; a Crop
      // Manager spends `maxEUInput() / 8` on each crop it picks, so its
      // per-tick figure is that spread over the harvest period.
      const cropEuT = (() => {
        if (!crop || cropsNhIsHandPicked(crop)) {
          return undefined;
        }
        const crops = Math.max(0, Math.round(node.machineCount));
        if (crop.id === CROP_HARVESTER_INDUSTRIAL_FARM_ID) {
          // WHOLE farms bill: a farm draws its full power however many
          // seeds it holds, so the last, partially filled farm costs the
          // same as a full one.
          return cropsNhFarmEut(crop) * cropsNhHarvesterMachineCount(crop, crops);
        }
        const stats = getCropsNhStats(recipe);
        if (!stats) {
          return undefined;
        }
        const ticks = cropsNhHarvestTicks(
          stats,
          cropsNhEnvironmentFromTiers(node.machineConfigTiers),
        );
        return Number.isFinite(ticks) && ticks > 0
          ? (cropsNhManagerEuPerHarvest(crop) * crops) / ticks
          : 0;
      })();
      const euT = report
        ? report.drawEuT * runningCount
        : cropEuT !== undefined
          ? usage > 0
            ? cropEuT
            : 0
          : powerEuT !== undefined && powerEuT < 0
            ? -powerEuT * runningCount
            : undefined;
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
            madeEuT: undefined as number | undefined,
            avgEuT: undefined as number | undefined,
            avgSteamLs: undefined as number | undefined,
            avgMadeEuT: undefined as number | undefined,
            builds: [],
            nodeIds: [],
            minTierIndex: Number.POSITIVE_INFINITY,
            buildsByKey: new Map<string, BuildLine>(),
          };
          byMachine.set(handler.label, created);
          return created;
        })();
      group.icon ??= recipe.power
        ? powerMachineListIcon(recipe.power.sourceId)
        : machineIcons.get(handler.id);
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
      if (madeEuT !== undefined) {
        group.madeEuT = (group.madeEuT ?? 0) + madeEuT;
        group.avgMadeEuT = (group.avgMadeEuT ?? 0) + madeEuT * usage;
      }

      // The stacking rule: singleblocks of one tier are one build; a
      // multiblock's hatch count splits it further. A steam multiblock splits
      // on its pressure: a bronze build and a steel one are different things
      // to construct.
      // A crop harvester's build is its tier: an LV manager and an HV manager
      // are different things to construct, exactly like powered machines.
      const cropTier = crop
        ? (cropsNhHarvesterTierName(crop.tierIndex) as VoltageTier)
        : undefined;
      // A generator's build is its tier setting where it has one (an LV and
      // an HV gas turbine are different things to construct); multiblock
      // generators are one build each.
      const powerTierSetting = recipe.power ? node.machineConfigTiers?.tier : undefined;
      const powerTier =
        powerTierSetting && getVoltageTierIndex(powerTierSetting as VoltageTier) >= 0
          ? (powerTierSetting as VoltageTier)
          : undefined;
      const buildKey = report
        ? `${report.tier}|${report.isMultiblock ? (report.hatchChip ?? report.hatches) : "single"}`
        : steam
          ? `steam|${steam.highPressure ? "high" : "bronze"}`
          : cropTier
            ? `crop|${cropTier}`
            : recipe.power
              ? `power|${powerTier ?? "block"}`
              : "plain";
      // Steam machines sort with ULV: they are the start of the game, not the
      // end of the list a missing tier would banish them to.
      const tierIndex = report
        ? getVoltageTierIndex(report.tier)
        : steam
          ? 0
          : (cropTier ?? powerTier)
            ? getVoltageTierIndex((cropTier ?? powerTier)!)
            : Number.POSITIVE_INFINITY;
      group.minTierIndex = Math.min(group.minTierIndex, tierIndex);
      const build =
        group.buildsByKey.get(buildKey) ??
        (() => {
          const created: BuildLine = {
            key: `${handler.label}|${buildKey}`,
            count: 0,
            hatches: report?.hatches ?? 1,
            hatchChip: report?.hatchChip,
            hatchTypeId: report?.isMultiblock
              ? getEnergyHatchType(node.energyHatchType).id
              : undefined,
            amps: report?.amps,
            isMultiblock:
              report?.isMultiblock ??
              steam?.isMultiblock ??
              crop?.id === CROP_HARVESTER_INDUSTRIAL_FARM_ID,
            tier: report?.tier ?? cropTier ?? powerTier,
            tierIndex,
            euT: undefined,
            steamLs: undefined,
            madeEuT: undefined,
            avgEuT: undefined,
            avgSteamLs: undefined,
            avgMadeEuT: undefined,
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
      if (madeEuT !== undefined) {
        build.madeEuT = (build.madeEuT ?? 0) + madeEuT;
        build.avgMadeEuT = (build.avgMadeEuT ?? 0) + madeEuT * usage;
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
  const hasMade = groups.some((group) => group.madeEuT !== undefined);
  const totalMadeEuT = groups.reduce(
    (sum, group) => sum + ((average ? group.avgMadeEuT : group.madeEuT) ?? 0),
    0,
  );
  const netEuT = totalMadeEuT - totalEuT;
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
            ? formatCompact(powerDisplayFromEuT(totalEuT))
            : formatCompactStable(powerDisplayFromEuT(shown[0] ?? totalEuT))
        }
      />
      <span className="ml-0.5 text-[8px] font-normal text-[var(--mc-ink-muted)]">{powerDisplaySuffix()}</span>
    </span>
  ) : null;

  return (
    <div className="flex min-h-0 shrink-0 basis-[40%] flex-col border-t-2 border-[var(--mc-47)]">
      <div className="border-b border-[var(--mc-47)] bg-[var(--mc-71)] px-2 py-1">
        <div className="flex w-full items-center gap-2">
          <span className="text-sm font-bold uppercase tracking-wider">Machines</span>
          {/* ONE energy rides the title line. Two or more move to a line of
              their own below — decided by what the board HAS, never by
              measured width, so a figure animating near the edge cannot
              bounce the header between one line and two. */}
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {hasEu || hasSteam || hasMade ? <DrawModePill average={average} /> : null}
            {!hasMade && hasEu !== hasSteam ? (
              <span className="shrink-0 text-[13px] font-bold tabular-nums">
                {steamFigure ?? euFigure}
              </span>
            ) : null}
          </span>
        </div>
        {hasMade ? (
          // Generators on the board turn the header into the ledger: what the
          // machines drink, what the generators make, and the difference -
          // three proper cells with room to breathe, not a cramped line.
          <div
            className={[
              "mt-2 grid pb-1",
              hasSteam ? "grid-cols-4" : "grid-cols-3",
            ].join(" ")}
          >
            {hasSteam ? (
              <LedgerCell label="STEAM">
                <SteamMark />
                <MotionNumberText
                  values={[totalSteamLs]}
                  render={(shown) =>
                    shown[0] === totalSteamLs
                      ? formatCompact(totalSteamLs)
                      : formatCompactStable(shown[0] ?? totalSteamLs)
                  }
                />
                <span className="ml-0.5 text-[9px] font-normal text-[var(--mc-ink-muted)]">
                  L/s
                </span>
              </LedgerCell>
            ) : null}
            <LedgerCell label="USED" flushLeft={hasSteam}>
              <EuMark />
              <MotionNumberText
                values={[totalEuT]}
                render={(shown) =>
                  shown[0] === totalEuT
                    ? formatCompact(powerDisplayFromEuT(totalEuT))
                    : formatCompactStable(powerDisplayFromEuT(shown[0] ?? totalEuT))
                }
              />
              <span className="ml-0.5 text-[9px] font-normal text-[var(--mc-ink-muted)]">{powerDisplaySuffix()}</span>
            </LedgerCell>
            <LedgerCell label="MADE" flushLeft className="text-emerald-300">
              <EuMark />
              <MotionNumberText
                values={[totalMadeEuT]}
                render={(shown) =>
                  shown[0] === totalMadeEuT
                    ? formatCompact(powerDisplayFromEuT(totalMadeEuT))
                    : formatCompactStable(powerDisplayFromEuT(shown[0] ?? totalMadeEuT))
                }
              />
              <span className="ml-0.5 text-[9px] font-normal text-[var(--mc-ink-muted)]">{powerDisplaySuffix()}</span>
            </LedgerCell>
            <LedgerCell
              label="NET"
              flushLeft
              className={netEuT >= 0 ? "text-emerald-300" : "text-red-300"}
            >
              <MotionNumberText
                values={[netEuT]}
                render={(shown) => {
                  const value = shown[0] === netEuT ? netEuT : (shown[0] ?? netEuT);
                  const text =
                    shown[0] === netEuT
                      ? formatCompact(powerDisplayFromEuT(Math.abs(netEuT)))
                      : formatCompactStable(powerDisplayFromEuT(Math.abs(value)));
                  return `${value >= 0 ? "+" : "-"}${text}`;
                }}
              />
              <span className="ml-0.5 text-[9px] font-normal text-[var(--mc-ink-muted)]">{powerDisplaySuffix()}</span>
            </LedgerCell>
          </div>
        ) : hasEu && hasSteam ? (
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
                peakEuT={uniform ? build?.euT : undefined}
                averageEuT={uniform ? build?.avgEuT : undefined}
                madeEuT={uniform ? (average ? build?.avgMadeEuT : build?.madeEuT) : undefined}
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
                      peakEuT={buildLine.euT}
                      averageEuT={buildLine.avgEuT}
                      madeEuT={average ? buildLine.avgMadeEuT : buildLine.madeEuT}
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
          "flex items-center justify-center px-1.5 text-[9px] font-black leading-none tracking-tight",
          average
            ? "text-[var(--mc-ink-muted)] hover:text-[var(--mc-ink)]"
            : "bg-[var(--mc-56)] text-[var(--mc-ink)]",
        ].join(" ")}
      >
        <span className="block -translate-y-px">PEAK</span>
      </button>
      <button
        type="button"
        onClick={() => writeWorkspaceView({ averageMachineDraw: true })}
        aria-label="Show average draw"
        aria-pressed={average}
        className={[
          "flex items-center justify-center border-l border-[var(--mc-47)] px-1.5 text-[9px] font-black leading-none tracking-tight",
          average
            ? "bg-[var(--mc-56)] text-[var(--mc-ink)]"
            : "text-[var(--mc-ink-muted)] hover:text-[var(--mc-ink)]",
        ].join(" ")}
      >
        <span className="block -translate-y-px">AVG</span>
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

/**
 * One column of the power ledger: a muted label over a full-size figure, on
 * its own quiet tile. The tiles split the row into equal touching segments
 * (border-l dropped past the first so the seams stay one pixel); content
 * reads left-aligned inside each.
 */
function LedgerCell({
  label,
  className,
  flushLeft = false,
  children,
}: {
  label: string;
  className?: string;
  /** Every tile after the first: its left border is the neighbour's right. */
  flushLeft?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={[
        "flex min-w-0 flex-col gap-0.5 border border-[var(--mc-47)] bg-[var(--mc-56)]/60 px-1.5 py-1 shadow-[inset_1px_1px_0_rgba(255,255,255,0.05)]",
        flushLeft ? "border-l-0" : "",
      ].join(" ")}
    >
      <span className="text-[11px] font-normal uppercase tracking-wider text-[var(--mc-ink-muted)]">
        {label}
      </span>
      <span
        className={["whitespace-nowrap text-[15px] font-bold tabular-nums", className ?? ""].join(
          " ",
        )}
      >
        {children}
      </span>
    </span>
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
  peakEuT,
  averageEuT,
  madeEuT,
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
  chip?: Pick<BuildLine, "tier" | "hatches" | "hatchChip" | "hatchTypeId" | "amps" | "isMultiblock">;
  euT?: number;
  /** Both modes' figures at once, for the chip's tooltip. */
  peakEuT?: number;
  averageEuT?: number;
  /** A generator's figure: the EU/t it makes, green, instead of a draw. */
  madeEuT?: number;
  /** A steam machine's figure: what it burns, in L/s, instead of EU/t. */
  steamLs?: number;
  state: NodePowerState;
  /** Tier whose colour faintly washes the whole line. */
  wash?: VoltageTier;
  onClick: () => void;
}) {
  const stalled = state !== "ok";
  const chipColor = chip?.tier ? GT_TIER_COLORS[chip.tier] : undefined;
  // The hatch item the build drinks through, for the chip's middle seat -
  // the same art the card's own chip wears.
  const datasetVersionId = useFactoryStore((store) => store.dataset?.datasetVersionId);
  const hatchCatalog = useEnergyHatchCatalog(chip?.isMultiblock ? datasetVersionId : undefined);
  const hatchEntry =
    chip?.isMultiblock && chip.tier
      ? hatchCatalog.get(energyHatchCatalogKey(chip.tier, chip.hatchTypeId ?? "standard"))
      : undefined;
  // What the line's build means, in one breath: what supplies the power, its
  // amps, the EU/t they buy, and both draw figures. Singleblocks get the same
  // story with the machine itself in the hatch's place.
  const hatchType = chip?.isMultiblock ? getEnergyHatchType(chip.hatchTypeId) : undefined;
  const hatchAmps =
    chip?.amps ??
    (hatchType ? (hatchType.exotic ? hatchType.amps : getHatchAmps(chip?.hatches ?? 1)) : undefined);
  const hatchPoolEuT =
    chip?.tier && hatchAmps !== undefined ? getVoltageTierMaxEuT(chip.tier) * hatchAmps : 0;
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
          {hatchType ? (
            hatchType.exotic ? (
              <>
                {tierBadge}
                <span>{hatchType.label}</span>
              </>
            ) : (
              <>
                <span>{chip.hatches}×</span>
                {tierBadge}
                <span>Energy Hatch</span>
              </>
            )
          ) : (
            <>
              {tierBadge}
              <span>Machine</span>
            </>
          )}
        </div>
        <div className="mt-0.5 text-[11px] leading-4 text-slate-300">
          {formatCompact(hatchAmps)} A:{" "}
          <span className="font-bold text-white">{formatCompact(hatchPoolEuT)} EU/t</span>
        </div>
        {peakEuT !== undefined ? (
          <>
            <div className="text-[11px] leading-4 text-slate-300">
              PEAK <span className="font-bold text-white">{formatCompact(peakEuT)} EU/t</span>
            </div>
            <div className="text-[11px] leading-4 text-slate-300">
              AVG{" "}
              <span className="font-bold text-white">{formatCompact(averageEuT ?? 0)} EU/t</span>
            </div>
          </>
        ) : null}
      </div>
    ) : undefined;

  // The whole LINE answers the hover, not just the chip: the build's power
  // story is about the row, and a target the width of a chip made the panel
  // feel like a secret.
  return (
    <MinecraftTooltip content={hatchStory}>
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
          <span className="flex shrink-0 items-center">
            {chip.isMultiblock ? (
              <>
                <span
                  className="flex h-5 items-center border-2 border-r-0 px-1 pb-[2px] text-[11px] font-bold leading-none"
                  style={{
                    backgroundColor: chipColor.background,
                    borderColor: chipColor.border,
                    color: chipColor.text,
                    textShadow: `1px 1px 0 ${chipColor.shadow}`,
                  }}
                >
                  {chip.hatchChip ?? `${chip.hatches}×`}
                </span>
                {hatchEntry ? (
                  <span
                    className="flex h-5 w-5 items-center justify-center border-2 border-r-0"
                    style={{
                      backgroundColor: chipColor.background,
                      borderColor: chipColor.border,
                    }}
                  >
                    <EnergyHatchArt entry={hatchEntry} boxClass="h-6 w-6" />
                  </span>
                ) : null}
              </>
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
        ) : madeEuT !== undefined ? (
          // A generator's line: what it MAKES, in the ledger's green.
          <span className="text-emerald-300">
            <EuMark />
            <MotionNumberText
              values={[madeEuT]}
              render={(shown) =>
                shown[0] === madeEuT
                  ? `+${formatCompact(powerDisplayFromEuT(madeEuT))}`
                  : `+${formatCompactStable(powerDisplayFromEuT(shown[0] ?? madeEuT))}`
              }
            />
            <span className="ml-0.5 text-[8px] text-[var(--mc-ink-muted)]">{powerDisplaySuffix()}</span>
          </span>
        ) : euT !== undefined ? (
          <>
            <EuMark />
            <MotionNumberText
              values={[euT]}
              render={(shown) =>
                shown[0] === euT
                  ? formatCompact(powerDisplayFromEuT(euT))
                  : formatCompactStable(powerDisplayFromEuT(shown[0] ?? euT))
              }
            />
            {/* Same suffix treatment as the card's power cell: small, grey,
                hugging the number. */}
            <span className="ml-0.5 text-[8px] text-[var(--mc-ink-muted)]">{powerDisplaySuffix()}</span>
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
    </MinecraftTooltip>
  );
}

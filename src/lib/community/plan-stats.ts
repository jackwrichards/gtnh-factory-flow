import type { FactoryProject, MachineTier, ThroughputResult } from "@/lib/model/types";
import { GT_VOLTAGE_TIERS, getVoltageTierIndex } from "@/lib/model/tiers";
import {
  COMMUNITY_RESOURCE_STAT_LIMIT,
  type CommunityPlanStats,
  type PlanResourceStat,
} from "./types";

const VOLTAGE_TIER_SET = new Set<string>(GT_VOLTAGE_TIERS.map((entry) => entry.tier));

function isVoltageTier(value: unknown): value is Exclude<MachineTier, "DEMO"> {
  return typeof value === "string" && VOLTAGE_TIER_SET.has(value);
}

/**
 * Derives the community stat card for a plan. Pure in (project, result), so
 * the server can recompute it from the uploaded JSON instead of trusting
 * client-supplied numbers.
 */
export function computeCommunityPlanStats(
  project: FactoryProject,
  result: ThroughputResult,
): CommunityPlanStats {
  let highestTierIndex = -1;
  let highestTier: Exclude<MachineTier, "DEMO"> | undefined;
  let machineCount = 0;

  for (const node of project.nodes) {
    if (!node.enabled) {
      continue;
    }

    machineCount += Math.max(0, Math.round(node.machineCount));
    if (isVoltageTier(node.overclockTier)) {
      const index = getVoltageTierIndex(node.overclockTier);
      if (index > highestTierIndex) {
        highestTierIndex = index;
        highestTier = node.overclockTier;
      }
    }
  }

  const icons = buildResourceIconIndex(project);
  return {
    nodeCount: project.nodes.length,
    storageCount: (project.storages ?? []).length,
    edgeCount: project.edges.length,
    machineCount,
    totalEuT: Number.isFinite(result.totalEuT) ? result.totalEuT : 0,
    highestTier,
    highestTierIndex,
    needs: toResourceStats(result.externalInputs, "consumed", icons),
    outputs: toResourceStats(result.unconsumedOutputs, "produced", icons),
  };
}

type ResourceIconInfo = Pick<
  PlanResourceStat,
  "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
>;

/**
 * Icon refs live on the recipe/storage resources inside the plan JSON, not on
 * the solver's balances, so index them once by kind:id for the stat lines.
 */
function buildResourceIconIndex(project: FactoryProject): Map<string, ResourceIconInfo> {
  const index = new Map<string, ResourceIconInfo>();
  const add = (resource: {
    kind: string;
    id: string;
    displayName?: string;
    iconPath?: string;
    iconAtlas?: PlanResourceStat["iconAtlas"];
    dominantColor?: string;
  }) => {
    const key = `${resource.kind}:${resource.id}`;
    if (!index.has(key) && (resource.iconPath || resource.iconAtlas)) {
      index.set(key, {
        displayName: resource.displayName,
        iconPath: resource.iconPath,
        iconAtlas: resource.iconAtlas,
        dominantColor: resource.dominantColor,
      });
    }
  };

  for (const recipe of project.recipes) {
    recipe.inputs.forEach(add);
    recipe.outputs.forEach(add);
  }
  for (const storage of project.storages ?? []) {
    add({
      kind: storage.kind,
      id: storage.resourceId,
      displayName: storage.displayName,
      iconPath: storage.iconPath,
      iconAtlas: storage.iconAtlas,
      dominantColor: storage.dominantColor,
    });
  }

  return index;
}

function toResourceStats(
  balances: ThroughputResult["externalInputs"],
  direction: "consumed" | "produced",
  icons: Map<string, ResourceIconInfo>,
): PlanResourceStat[] {
  return balances
    .map((balance) => {
      const icon = icons.get(`${balance.kind}:${balance.resourceId}`);
      return {
        kind: balance.kind,
        resourceId: balance.resourceId,
        displayName: balance.displayName ?? icon?.displayName,
        iconPath: icon?.iconPath,
        iconAtlas: icon?.iconAtlas,
        dominantColor: icon?.dominantColor,
        ratePerSecond:
          direction === "consumed"
            ? Math.abs(balance.consumedPerSecond)
            : Math.abs(balance.surplusPerSecond || balance.producedPerSecond),
      };
    })
    .filter((stat) => stat.ratePerSecond > 0)
    .sort((a, b) => b.ratePerSecond - a.ratePerSecond)
    .slice(0, COMMUNITY_RESOURCE_STAT_LIMIT);
}

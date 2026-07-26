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

  return {
    nodeCount: project.nodes.length,
    storageCount: (project.storages ?? []).length,
    edgeCount: project.edges.length,
    machineCount,
    totalEuT: Number.isFinite(result.totalEuT) ? result.totalEuT : 0,
    highestTier,
    highestTierIndex,
    needs: toResourceStats(result.externalInputs, "consumed"),
    outputs: toResourceStats(result.unconsumedOutputs, "produced"),
  };
}

function toResourceStats(
  balances: ThroughputResult["externalInputs"],
  direction: "consumed" | "produced",
): PlanResourceStat[] {
  return balances
    .map((balance) => ({
      kind: balance.kind,
      resourceId: balance.resourceId,
      displayName: balance.displayName,
      ratePerSecond:
        direction === "consumed"
          ? Math.abs(balance.consumedPerSecond)
          : Math.abs(balance.surplusPerSecond || balance.producedPerSecond),
    }))
    .filter((stat) => stat.ratePerSecond > 0)
    .sort((a, b) => b.ratePerSecond - a.ratePerSecond)
    .slice(0, COMMUNITY_RESOURCE_STAT_LIMIT);
}

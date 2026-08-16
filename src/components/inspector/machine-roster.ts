import { isCustomRateRecipe } from "@/lib/model/custom-rate";
import { expandPocketSelection } from "@/lib/model/pocket-connections";
import {
  getSelectedMachineHandler,
  isSteamMachineHandler,
} from "@/lib/model/recipe-rules";
import { GT_VOLTAGE_TIERS } from "@/lib/model/tiers";
import { isTrashRecipe } from "@/lib/model/trash";
import type { FactoryProject, ResourceAmount } from "@/lib/model/types";

const VOLTAGE_TIER_SET = new Set<string>(GT_VOLTAGE_TIERS.map((entry) => entry.tier));

/** Icon fields ResourceIcon needs; handler-family icons and recipe outputs both fit. */
export type MachineRosterIcon = Pick<
  ResourceAmount,
  "kind" | "id" | "amount" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
>;

/**
 * One shopping-list row: every enabled card that is the same placed machine
 * at the same voltage, stacked. Two Chemical Reactors doing different recipes
 * still merge if they are the same handler and tier — you place one machine
 * type. Large Chemical Reactor stays its own row.
 */
export interface MachineRosterRow {
  key: string;
  /** What the list prints, e.g. "HV Chemical Reactor". */
  label: string;
  machineName: string;
  /** Voltage tier when the machine actually uses one. Steam and crafting omit it. */
  tier?: string;
  handlerId: string;
  machineCount: number;
  /** Board cards in this stack, in project order, for hover and double-click. */
  nodeIds: string[];
  icon?: MachineRosterIcon;
}

/**
 * Which cards the Machines tab should count.
 *
 * Empty selection, or a selection of nothing but drawers, means the whole
 * plan — the same rule the resource lists already use. Selecting a pocket
 * counts everything inside it.
 */
export function resolveMachineRosterNodeIds(
  project: FactoryProject,
  selectedIds: readonly string[],
): ReadonlySet<string> | undefined {
  if (selectedIds.length === 0) {
    return undefined;
  }

  const { itemIds } = expandPocketSelection(project, selectedIds);
  const hasMachine = project.nodes.some((node) => itemIds.has(node.id));
  return hasMachine ? itemIds : undefined;
}

/**
 * Totals every placeable machine on the board (or in `nodeIds`).
 *
 * Disabled cards, trash cans and custom-rate sources are not machines you
 * craft, so they stay out. Crop farms stay in. Counts are the node's own
 * `machineCount`, floored at zero.
 */
export function buildMachineRoster(
  project: Pick<FactoryProject, "nodes" | "recipes">,
  options?: {
    nodeIds?: ReadonlySet<string>;
    icons?: ReadonlyMap<string, MachineRosterIcon>;
  },
): MachineRosterRow[] {
  const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));
  const groups = new Map<string, MachineRosterRow>();

  for (const node of project.nodes) {
    if (options?.nodeIds && !options.nodeIds.has(node.id)) {
      continue;
    }
    if (!node.enabled) {
      continue;
    }

    const recipe = recipesById.get(node.recipeId);
    if (!recipe || isTrashRecipe(recipe) || isCustomRateRecipe(recipe)) {
      continue;
    }

    const handler = getSelectedMachineHandler(recipe, node);
    const machineName = handler.label || recipe.machineType || recipe.name;
    const tier = rosterVoltageTier(node.overclockTier, handler, handler.eut ?? recipe.eut);
    const key = `${handler.id}:${tier ?? ""}`;
    const count = Math.max(0, node.machineCount);
    const existing = groups.get(key);
    if (existing) {
      existing.machineCount += count;
      existing.nodeIds.push(node.id);
      if (!existing.icon) {
        existing.icon = rosterIcon(handler.id, recipe, options?.icons);
      }
      continue;
    }

    groups.set(key, {
      key,
      label: tier ? `${tier} ${machineName}` : machineName,
      machineName,
      tier,
      handlerId: handler.id,
      machineCount: count,
      nodeIds: [node.id],
      icon: rosterIcon(handler.id, recipe, options?.icons),
    });
  }

  return [...groups.values()].sort((left, right) => {
    if (right.machineCount !== left.machineCount) {
      return right.machineCount - left.machineCount;
    }
    return left.label.localeCompare(right.label);
  });
}

export function filterMachineRoster(rows: MachineRosterRow[], filter: string): MachineRosterRow[] {
  const normalized = filter.trim().toLowerCase();
  if (!normalized) {
    return rows;
  }

  return rows.filter((row) => {
    if (row.label.toLowerCase().includes(normalized)) {
      return true;
    }
    if (row.machineName.toLowerCase().includes(normalized)) {
      return true;
    }
    if (row.tier && row.tier.toLowerCase().includes(normalized)) {
      return true;
    }
    return row.handlerId.toLowerCase().includes(normalized);
  });
}

export function totalMachineCount(rows: Iterable<MachineRosterRow>): number {
  let total = 0;
  for (const row of rows) {
    total += row.machineCount;
  }
  return total;
}

function rosterVoltageTier(
  overclockTier: string,
  handler: { label: string },
  eut: number,
): string | undefined {
  if (isSteamMachineHandler(handler) || !(eut > 0)) {
    return undefined;
  }
  return VOLTAGE_TIER_SET.has(overclockTier) ? overclockTier : undefined;
}

function rosterIcon(
  handlerId: string,
  recipe: { outputs: ResourceAmount[] },
  icons?: ReadonlyMap<string, MachineRosterIcon>,
): MachineRosterIcon | undefined {
  const family = icons?.get(handlerId);
  if (family) {
    return { ...family, amount: family.amount ?? 1 };
  }
  const output = recipe.outputs[0];
  return output
    ? {
        kind: output.kind,
        id: output.id,
        amount: 1,
        displayName: output.displayName,
        iconPath: output.iconPath,
        iconAtlas: output.iconAtlas,
        dominantColor: output.dominantColor,
      }
    : undefined;
}

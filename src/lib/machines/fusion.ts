import { getVoltageTierForEuT, getVoltageTierIndex, getVoltageTierMaxEuT } from "@/lib/model/tiers";
import type { MachineHandler, Recipe } from "@/lib/model/types";
import startupSnapshot from "./data/fusion-startups.json";

/** GT5U FusionOverclockDescriber, AdvancedFusionOverclockDescriber and
 * GoodGenerator MTELargeFusionComputer1..5. Fusion mark is NOT hatch voltage.
 * Startup charging is omitted from steady-state power, but its exact threshold
 * still gates recipes and controls compact extraPara (strict < boundaries).
 */
export const FUSION_MACHINES = [
  ...[
    "Fusion Control Computer Mark I",
    "Fusion Control Computer Mark II",
    "Fusion Control Computer Mark III",
    "FusionTech MK IV",
    "FusionTech MK V",
  ].map((name, i) => ({ name, mark: i + 1, compact: false })),
  ...[
    "Compact Fusion Computer MK-I Prototype",
    "Compact Fusion Computer MK-II",
    "Compact Fusion Computer MK-III",
    "Compact Fusion Computer MK-IV Prototype",
    "Compact Fusion Computer MK-V",
  ].map((name, i) => ({ name, mark: i + 1, compact: true })),
];
const TIERS = ["LuV", "ZPM", "UV", "UHV", "UEV"] as const;
const STARTUP_LIMITS = [160_000_000, 320_000_000, 640_000_000, 5_120_000_000, 20_480_000_000];
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const MACHINES_BY_NAME = new Map(
  FUSION_MACHINES.flatMap((machine) => {
    const entry = {
      ...machine,
      tier: TIERS[machine.mark - 1],
      startupLimit: STARTUP_LIMITS[machine.mark - 1],
    };
    return [
      [machine.name.toLowerCase(), entry],
      [slug(machine.name), entry],
    ] as const;
  }),
);

export function getFusionMachine(name: string | undefined) {
  return name ? MACHINES_BY_NAME.get(name.toLowerCase()) : undefined;
}

type FusionRecipe = Partial<
  Pick<
    Recipe,
    "machineType" | "metadata" | "inputs" | "outputs" | "eut" | "durationTicks" | "source" | "power"
  >
>;
export function isFusionRecipe(recipe: FusionRecipe): boolean {
  return (
    !recipe.power &&
    (recipe.source?.recipeMap === "Fusion Reactor" ||
      recipe.machineType === "Fusion Reactor" ||
      !!getFusionMachine(recipe.machineType))
  );
}

/** Exact runtime recipe fingerprints repair old exports/plans without matching
 * by display name (helium and several endgame products have distinct recipes).
 * A fresh exported threshold always wins. Snapshot provenance lives with data.
 */
export function fusionRecipeKey(recipe: FusionRecipe): string {
  const slots = (entries: Recipe["inputs"] = []) =>
    entries
      .map((r) => `${r.kind}:${r.id}@${r.amount}`)
      .sort()
      .join(";");
  return `${slots(recipe.inputs)}|${slots(recipe.outputs)}|${recipe.durationTicks}|${recipe.eut}`;
}
export function getFusionStartupEu(recipe: FusionRecipe): number | undefined {
  const exported = recipe.metadata?.fusionStartupEu;
  if (typeof exported === "number" && Number.isFinite(exported) && exported >= 0) return exported;
  return (startupSnapshot.recipes as Record<string, number>)[fusionRecipeKey(recipe)];
}

export function getFusionRecipeMark(recipe: FusionRecipe): number | undefined {
  const startup = getFusionStartupEu(recipe);
  if (startup === undefined) return undefined;
  const energyMark = STARTUP_LIMITS.findIndex((limit) => startup <= limit);
  return Math.max(
    energyMark < 0 ? 6 : energyMark + 1,
    getVoltageTierIndex(getVoltageTierForEuT(recipe.eut ?? 0)) - 5,
    1,
  );
}

export function fusionParallels(mark: number, compact: boolean, startup: number): number {
  if (!compact) return 1;
  // extraPara uses <, whereas recipe tiering uses <=. Do not merge them.
  const band = [160_000_000, 320_000_000, 640_000_000, 5_120_000_000].filter(
    (limit) => startup >= limit,
  ).length;
  return 64 * Math.max(1, mark - band);
}

export function getFusionStats(recipe: FusionRecipe) {
  const machine = getFusionMachine(recipe.machineType);
  if (!machine || recipe.power) return undefined;
  const startup = getFusionStartupEu(recipe);
  const recipeMark = getFusionRecipeMark(recipe);
  const eligible =
    recipeMark !== undefined &&
    recipeMark <= machine.mark &&
    (startup ?? Infinity) <= machine.startupLimit;
  const factor = machine.mark < 4 ? 2 : 4;
  const parallels =
    startup === undefined ? 1 : fusionParallels(machine.mark, machine.compact, startup);
  const poolEuT = getVoltageTierMaxEuT(machine.tier) * (machine.compact ? 64 * machine.mark : 1);
  let steps = 0;
  let duration = recipe.durationTicks ?? 1;
  let eut = recipe.eut ?? 0;
  // ParallelHelper reserves structural parallels before OC. Its voltage is
  // fixed to the reactor's tier, with compact's fixed amperage for parallels.
  const budget = Math.min(getVoltageTierMaxEuT(machine.tier), poolEuT / parallels);
  while (eligible && steps < machine.mark - recipeMark! && eut * factor <= budget) {
    steps++;
    duration /= factor;
    eut *= factor;
  }
  return {
    ...machine,
    recipeMark,
    startup,
    eligible,
    factor,
    steps,
    parallels,
    poolEuT,
    durationTicks: duration,
    eut,
  };
}

export function normalizeFusionHandler(
  handler: MachineHandler,
  recipe: FusionRecipe,
): MachineHandler {
  const machine = getFusionMachine(handler.machineType);
  if (!machine || !isFusionRecipe(recipe)) return handler;
  const startup = getFusionStartupEu(recipe);
  const parallels =
    startup === undefined ? 1 : fusionParallels(machine.mark, machine.compact, startup);
  return {
    ...handler,
    kind: "multiblock",
    minimumTier: machine.tier,
    maximumTier: undefined,
    availableTiers: undefined,
    durationTicks: undefined,
    eut: undefined,
    maxParallel: parallels,
    perfectOverclock: true,
    machineConfigControls:
      parallels > 1
        ? [
            {
              id: "machineParallel",
              label: "Parallels",
              minimumKey: String(parallels),
              defaultKey: String(parallels),
              tiers: [
                {
                  key: String(parallels),
                  label: `${parallels} Parallels`,
                  parallelMultiplier: parallels,
                  resource: {
                    kind: "item",
                    id: "factoryflow:machine_config/parallel",
                    amount: 1,
                    displayName: `${parallels} Parallels`,
                  },
                },
              ],
            },
          ]
        : [],
  };
}

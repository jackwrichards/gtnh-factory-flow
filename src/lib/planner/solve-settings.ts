import { GT_VOLTAGE_TIERS } from "@/lib/model/tiers";
import type { MachineTier } from "@/lib/model/types";

export type SolveTierSetting = "global" | Exclude<MachineTier, "DEMO">;

/**
 * How the gap solver is allowed to search. Read once when a solve starts —
 * changing settings never affects a solve already running.
 */
export interface GapSolveSettings {
  maxTier: SolveTierSetting;
  maxDepth: number;
  blockedRecipeMaps: string[];
}

const SETTINGS_STORAGE_KEY = "gtnh-factory-flow.gap-solve-settings.v1";

export const DEFAULT_SOLVE_SETTINGS: GapSolveSettings = {
  maxTier: "global",
  maxDepth: 8,
  blockedRecipeMaps: [],
};

export function loadSolveSettings(): GapSolveSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SOLVE_SETTINGS;
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_SOLVE_SETTINGS;
    }

    const parsed = JSON.parse(raw) as Partial<GapSolveSettings>;
    return {
      maxTier:
        parsed.maxTier === "global" ||
        GT_VOLTAGE_TIERS.some((entry) => entry.tier === parsed.maxTier)
          ? (parsed.maxTier as SolveTierSetting)
          : DEFAULT_SOLVE_SETTINGS.maxTier,
      maxDepth:
        typeof parsed.maxDepth === "number" && parsed.maxDepth >= 1 && parsed.maxDepth <= 16
          ? Math.round(parsed.maxDepth)
          : DEFAULT_SOLVE_SETTINGS.maxDepth,
      blockedRecipeMaps: Array.isArray(parsed.blockedRecipeMaps)
        ? parsed.blockedRecipeMaps.filter((entry): entry is string => typeof entry === "string")
        : [],
    };
  } catch {
    return DEFAULT_SOLVE_SETTINGS;
  }
}

export function saveSolveSettings(settings: GapSolveSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Best effort; solving still works without persistence.
  }
}

/**
 * Rough machine-family buckets by name, purely to make a few hundred recipe
 * maps navigable. Anything unmatched counts as an ordinary machine.
 */
export const RECIPE_MAP_CATEGORIES = [
  { id: "machines", label: "Machines" },
  { id: "crafting", label: "Crafting" },
  { id: "smelting", label: "Smelting & ovens" },
  { id: "thaumcraft", label: "Thaumcraft" },
  { id: "bees", label: "Bees & crops" },
] as const;

export type RecipeMapCategoryId = (typeof RECIPE_MAP_CATEGORIES)[number]["id"];

const CATEGORY_PATTERNS: Array<{ id: RecipeMapCategoryId; pattern: RegExp }> = [
  { id: "crafting", pattern: /craft|workbench|anvil|scribe/i },
  { id: "smelting", pattern: /furnace|smelt|blast|oven|kiln|pyrolyse|coke/i },
  { id: "thaumcraft", pattern: /thaum|arcane|crucible|infus|essentia|alchem|wand|aspect/i },
  { id: "bees", pattern: /bee|apiar|hive|crop|sapling|squeez|composter|forestry/i },
];

export function categorizeRecipeMap(recipeMap: string): RecipeMapCategoryId {
  return CATEGORY_PATTERNS.find((entry) => entry.pattern.test(recipeMap))?.id ?? "machines";
}

import type { Recipe } from "./types";

/**
 * Mining sources: recipes that summon material out of the world rather than
 * out of other machines - ore veins, small ores, underground fluids. Unlike
 * bees and crops (automated once built), a mining source stands for work a
 * PLAYER does, so its production is a demand on the player and lands on the
 * inputs side of the books as "go gather this".
 *
 * Recognition mirrors the bee/crop precedent: `recipe.kind` when present,
 * recipe-map label as the fallback for datasets and plans that predate the
 * kinds.
 */
export const MINING_SOURCE_RECIPE_MAPS = new Set(["Ore Vein", "Small Ore", "Underground Fluid"]);

const MINING_SOURCE_KINDS = new Set(["ore_vein", "small_ore", "underground_fluid"]);

export function isMiningSourceRecipe(
  recipe: Pick<Recipe, "kind" | "machineType" | "source"> | undefined,
): boolean {
  if (!recipe) {
    return false;
  }
  if (recipe.kind && MINING_SOURCE_KINDS.has(recipe.kind)) {
    return true;
  }
  return (
    MINING_SOURCE_RECIPE_MAPS.has(recipe.machineType ?? "") ||
    MINING_SOURCE_RECIPE_MAPS.has(recipe.source?.recipeMap ?? "")
  );
}

/** Where a vein or deposit is found, straight from the dataset's metadata. */
export interface MiningDimension {
  name: string;
  abbr?: string;
  /** Rocket tier needed to stand on the planet; 0 is the Overworld. */
  tier?: number;
  tierLabel?: string;
  /** This dimension's share of vein rolls, 0..1, when the dataset knows it. */
  chance?: number;
  heightRange?: string;
}

export interface MiningSourceInfo {
  veinName?: string;
  heightRange?: string;
  weight?: number;
  density?: number;
  size?: number;
  amountPerChunk?: number;
  dimensions: MiningDimension[];
  oreLayers: Array<{ role?: string; resourceId?: string; material?: string }>;
  deposits: Array<{
    dimension: string;
    abbr?: string;
    tier?: number;
    chance?: number;
    minAmount?: number;
    maxAmount?: number;
  }>;
}

export function getMiningSourceInfo(
  recipe: Pick<Recipe, "kind" | "machineType" | "source" | "metadata"> | undefined,
): MiningSourceInfo | undefined {
  if (!recipe || !isMiningSourceRecipe(recipe)) {
    return undefined;
  }
  const metadata = (recipe.metadata ?? {}) as Record<string, unknown>;
  const dimensions: MiningDimension[] = [];
  for (const entry of asArray(metadata.dimensions)) {
    const name = asString(entry.name);
    if (!name) {
      continue;
    }
    dimensions.push({
      name,
      abbr: asString(entry.abbr),
      tier: asNumber(entry.tier),
      tierLabel: asString(entry.tierLabel),
      chance: asNumber(entry.chance),
      heightRange: asString(entry.heightRange),
    });
  }
  const deposits: MiningSourceInfo["deposits"] = [];
  for (const entry of asArray(metadata.deposits)) {
    const dimension = asString(entry.dimension);
    if (!dimension) {
      continue;
    }
    deposits.push({
      dimension,
      abbr: asString(entry.abbr),
      tier: asNumber(entry.tier),
      chance: asNumber(entry.chance),
      minAmount: asNumber(entry.minAmount),
      maxAmount: asNumber(entry.maxAmount),
    });
    if (dimensions.every((existing) => existing.name !== dimension)) {
      dimensions.push({
        name: dimension,
        abbr: asString(entry.abbr),
        tier: asNumber(entry.tier),
        chance: asNumber(entry.chance),
      });
    }
  }
  return {
    veinName: asString(metadata.veinName) ?? asString(metadata.material),
    heightRange: asString(metadata.heightRange),
    weight: asNumber(metadata.veinWeight),
    density: asNumber(metadata.veinDensity),
    size: asNumber(metadata.veinSize),
    amountPerChunk: asNumber(metadata.amountPerChunk),
    dimensions,
    oreLayers: asArray(metadata.oreLayers).map((entry) => ({
      role: asString(entry.role),
      resourceId: asString(entry.resourceId),
      material: asString(entry.material),
    })),
    deposits,
  };
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
  );
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

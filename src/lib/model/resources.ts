import type {
  Recipe,
  RecipeOutput,
  ResourceAmount,
  ResourceFlow,
  ResourceKey,
  ResourceKind,
} from "./types";
import { rateUnitMultiplier, rateUnitSuffix } from "./rate-unit";
import { getCropsNhStats } from "./passive-production";

export function makeResourceKey(kind: ResourceKind, resourceId: string): ResourceKey {
  return `${kind}:${resourceId}` as ResourceKey;
}

export function getResourceKey(resource: Pick<ResourceAmount, "kind" | "id">): ResourceKey {
  return makeResourceKey(resource.kind, resource.id);
}

export function isOreDictionaryResource(resource: Pick<ResourceAmount, "id">): boolean {
  return resource.id.startsWith("oredict:");
}

export function isVirtualChoiceResource(
  resource: Pick<ResourceAmount, "id" | "displayName">,
): boolean {
  return (
    isOreDictionaryResource(resource) ||
    Boolean(resource.displayName?.match(/^Ore Dictionary:\s*/i)) ||
    isWildcardChoiceResource(resource)
  );
}

function isWildcardChoiceResource(resource: Pick<ResourceAmount, "id" | "displayName">): boolean {
  const id = resource.id.trim();
  const displayName = resource.displayName?.trim() ?? "";

  return (
    // "@32767" is the any-damage wildcard pseudo-item, not a real item; it
    // shares its display name with the damage-0 item and would list twice.
    id.endsWith("@32767") ||
    /^any(?:$|[:@._-])/i.test(id) ||
    /^any(?:$|\s|[:@._-])/i.test(displayName)
  );
}

export function parseResourceKey(key: ResourceKey): {
  kind: ResourceKind;
  resourceId: string;
} {
  const separatorIndex = key.indexOf(":");
  return {
    kind: key.slice(0, separatorIndex) as ResourceKind,
    resourceId: key.slice(separatorIndex + 1),
  };
}

export function resourceLabel(resource: Pick<ResourceAmount, "id" | "displayName">): string {
  const displayName = stripOreDictionaryPrefix(resource.displayName);
  if (displayName) {
    return displayName;
  }

  if (isOreDictionaryResource(resource)) {
    return resource.id.slice("oredict:".length);
  }

  return resource.id;
}

export function formatRate(value: number, digits = 2): string {
  if (!Number.isFinite(value)) {
    return "unbounded";
  }

  if (Math.abs(value) >= 100) {
    return formatNumberWithThousands(value.toFixed(0));
  }

  if (Math.abs(value) >= 10) {
    return formatNumberWithThousands(value.toFixed(1));
  }

  return formatNumberWithThousands(value.toFixed(digits));
}

/**
 * The SI ladder GregTech itself uses for EU. Past exa nothing in the game
 * reaches, and a number that long has stopped being readable anyway.
 */
const COMPACT_SUFFIXES = ["", "k", "M", "G", "T", "P", "E"] as const;

/**
 * Late-game numbers, at a width a node cell can hold: 2,147,483,648 becomes
 * "2.15G" and a mega multiblock's 1,440,000 L/s becomes "1.44M".
 *
 * Two rules that are about honesty rather than width:
 * - exact zero prints "0", never "0.00" — decimals on nothing are noise;
 * - a rate that is small but REAL never prints as zero. A chanced output at
 *   0.004/s is a line that runs, and rounding it to 0.00 said it was dead.
 *
 * Three significant digits everywhere else, trailing zeros dropped, so a
 * column of these still lines up without carrying dead characters.
 */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) {
    return "unbounded";
  }
  if (value === 0) {
    return "0";
  }

  const sign = value < 0 ? "-" : "";
  let abs = Math.abs(value);

  if (abs < 1) {
    // Two significant digits, however far down the value sits.
    const leadingZeros = Math.max(0, Math.ceil(-Math.log10(abs)) - 1);
    const digits = Math.min(12, leadingZeros + 2);
    return `${sign}${trimTrailingDecimalZeros(abs.toFixed(digits))}`;
  }

  let tier = 0;
  while (abs >= 1000 && tier < COMPACT_SUFFIXES.length - 1) {
    abs /= 1000;
    tier += 1;
  }
  let decimals = abs >= 100 ? 1 : 2;
  // 999.96 rounds to "1000.0" — carry it to the next suffix instead.
  if (Number(abs.toFixed(decimals)) >= 1000 && tier < COMPACT_SUFFIXES.length - 1) {
    abs /= 1000;
    tier += 1;
    decimals = 2;
  }
  const text = trimTrailingDecimalZeros(abs.toFixed(decimals));
  return `${sign}${text}${COMPACT_SUFFIXES[tier]}`;
}

/**
 * `formatCompact` for a number in MOTION: fixed decimals per magnitude,
 * trailing zeros kept, whole numbers below a thousand. The honest formatter
 * trims zeros and varies its decimals, which makes an easing value flicker
 * between widths frame to frame ("20.1", "20", "19.93"); a tween wants every
 * frame the same shape, and the landing frame goes back through
 * `formatCompact` for the clean resting form.
 */
export function formatCompactStable(value: number): string {
  if (!Number.isFinite(value)) {
    return "unbounded";
  }
  const sign = value < 0 ? "-" : "";
  let abs = Math.abs(value);
  if (abs < 1000) {
    return `${sign}${Math.round(abs)}`;
  }
  let tier = 0;
  while (abs >= 1000 && tier < COMPACT_SUFFIXES.length - 1) {
    abs /= 1000;
    tier += 1;
  }
  return `${sign}${abs.toFixed(abs >= 100 ? 1 : 2)}${COMPACT_SUFFIXES[tier]}`;
}

export function formatNumberWithThousands(value: number | string): string {
  // American separators: comma thousands, dot decimal ("1,234.56").
  const text = String(value);
  const sign = text.startsWith("-") ? "-" : "";
  const unsigned = sign ? text.slice(1) : text;
  const [integer, fraction] = unsigned.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return `${sign}${grouped}${fraction !== undefined ? `.${fraction}` : ""}`;
}

export function trimTrailingDecimalZeros(value: string): string {
  return value.replace(/(\.\d*[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

export function formatResourceRate(flow: ResourceFlow | undefined): string {
  if (!flow) {
    return "none";
  }

  return `${resourceLabel({ id: flow.resourceId, displayName: flow.displayName })} ${formatRate(
    flow.amountPerSecond * rateUnitMultiplier(),
  )}${rateUnitSuffix(flow.kind).trimStart()}`;
}

export function primaryOutput(recipe: Recipe): RecipeOutput | undefined {
  return recipe.outputs.find((output) => !output.byproduct) ?? recipe.outputs[0];
}

export function getChanceMultiplier(
  recipe: Pick<Recipe, "metadata">,
  output: RecipeOutput,
): number {
  // A CropsNH card bakes EXPECTED amounts: the drop-table weight is already
  // inside `amount`, and `chance` is that same weight kept for the display
  // badge. Multiplying it in again counts the probability twice - Blazereed's
  // blaze rods came out at a quarter of their real rate.
  if (getCropsNhStats(recipe)) {
    return 1;
  }
  return output.chance ?? 1;
}

export function isRecipeInputConsumed(
  input: Pick<ResourceAmount, "id"> & { consumed?: boolean },
): boolean {
  return input.consumed !== false;
}

const ANY_DAMAGE_SUFFIX = "@32767";

/**
 * "@32767" is Minecraft's any-damage wildcard. `minecraft:log@32767` is not an
 * item you can hold: it stands for "an oak, spruce, birch or jungle log,
 * whichever damage value". A concrete variant satisfies it and it satisfies a
 * concrete slot, so the two must match wherever an item id is compared.
 *
 * The dataset leans on it hard. `oredict:logWood` lists its vanilla members as
 * the two wildcards rather than the six real logs, and ~2,800 recipes take a
 * wildcard input directly. Matching on the literal string meant a Crop Farm's
 * Oak Log could not feed the logWood slot it is listed under, and a
 * Centrifuge's `minecraft:dirt@32767` could not feed a dirt slot.
 *
 * The server already knows the rule (`resourceIdsAreCompatible` in
 * `dataset-query.ts`), which is why the recipe book finds logWood recipes from
 * a Spruce Log. This is the board side agreeing with it.
 */
function itemIdsMatch(left: string, right: string): boolean {
  return left === right || matchesAnyDamage(left, right) || matchesAnyDamage(right, left);
}

function matchesAnyDamage(wildcardId: string, concreteId: string): boolean {
  if (!wildcardId.endsWith(ANY_DAMAGE_SUFFIX)) {
    return false;
  }

  const baseId = wildcardId.slice(0, -ANY_DAMAGE_SUFFIX.length);
  // A bare id is the damage-0 item ("minecraft:log" is Oak Log). Anchoring the
  // prefix on "@" keeps "minecraft:log@32767" off "minecraft:log2@1".
  return concreteId === baseId || concreteId.startsWith(`${baseId}@`);
}

/**
 * An item is an item and a fluid is a fluid. A filled cell is an ordinary item
 * that happens to be named after a fluid, and it does NOT satisfy that fluid's
 * slot — in game you would run the cell through a Canner first, and the planner
 * says so by leaving the two unconnected until you place one.
 *
 * This used to be true only within a kind: a fluid could quietly satisfy a cell
 * slot and vice versa, converting the amount at a guessed 1000 L per cell. It
 * made a chain look complete while omitting a real machine, a stack of empty
 * cells and the power to run them, and it reported item production in litres.
 *
 * Cross-form equivalence still exists for SEARCH, where it only helps you find
 * that the other form exists — see `isFluidEquivalentToFilledCell`.
 */
export function resourceMatchesInput(
  resource: Pick<ResourceAmount, "kind" | "id" | "displayName">,
  input: Pick<ResourceAmount, "kind" | "id" | "displayName" | "alternatives">,
): boolean {
  if (resource.kind !== input.kind) {
    return false;
  }

  // Damage values only exist on items; a fluid id is compared literally.
  const idsMatch = resource.kind === "item" ? itemIdsMatch : (left: string, right: string) =>
    left === right;

  return (
    idsMatch(resource.id, input.id) ||
    Boolean(
      input.alternatives?.some(
        (alternative) =>
          alternative.kind === resource.kind && idsMatch(alternative.id, resource.id),
      ),
    )
  );
}

/**
 * The fluid a filled cell is named after, for SEARCH ONLY.
 *
 * Deliberately carries no amount. Nothing converts between the two forms any
 * more, so there is no litres-per-cell ratio to get wrong; this only answers
 * "does a fluid form of this item exist, so the recipe book can offer it too".
 */
export function getFilledCellFluidEquivalent(
  resource: Pick<ResourceAmount, "kind" | "id" | "displayName"> & {
    alternatives?: ResourceAmount["alternatives"];
  },
): Pick<ResourceAmount, "kind" | "id" | "displayName"> | undefined {
  if (resource.kind === "fluid") {
    return { kind: "fluid", id: resource.id, displayName: resource.displayName };
  }

  const alternative = resource.alternatives?.find((entry) => entry.kind === "fluid");
  if (alternative) {
    return { kind: "fluid", id: alternative.id, displayName: alternative.displayName };
  }

  const fluidName = getFilledCellFluidName(resource);
  if (!fluidName) {
    return undefined;
  }

  return { kind: "fluid", id: normalizeFluidId(fluidName), displayName: fluidName };
}

/** Search-only, like `getFilledCellFluidEquivalent`. Never a connection rule. */
export function isFluidEquivalentToFilledCell(
  fluid: Pick<ResourceAmount, "kind" | "id" | "displayName">,
  cell: Pick<ResourceAmount, "kind" | "id" | "displayName" | "alternatives">,
): boolean {
  if (
    cell.alternatives?.some(
      (alternative) => alternative.kind === "fluid" && alternative.id === fluid.id,
    )
  ) {
    return true;
  }

  const fluidName = getFilledCellFluidName(cell);
  if (!fluidName) {
    return false;
  }

  const normalizedFluidName = normalizeResourceName(fluidName);
  const normalizedFluidDisplayName = normalizeResourceName(resourceLabel(fluid));

  return (
    normalizeFluidId(fluidName) === fluid.id ||
    normalizedFluidName === normalizedFluidDisplayName ||
    normalizedFluidName === normalizeResourceName(fluid.id)
  );
}

function getFilledCellFluidName(
  resource: Pick<ResourceAmount, "displayName" | "id">,
): string | undefined {
  const label = resourceLabel(resource).trim();
  const match = label.match(/^(.+?)\s+Cell$/i);
  if (!match) {
    return undefined;
  }

  const fluidName = match[1]?.trim();
  return fluidName && !/^empty$/i.test(fluidName) ? fluidName : undefined;
}

function normalizeFluidId(fluidName: string): string {
  return normalizeResourceName(fluidName).replace(/\s+/g, ".");
}

function normalizeResourceName(value: string): string {
  return value
    .toLowerCase()
    .replace(/^fluid:/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function stripOreDictionaryPrefix(value: string | undefined): string | undefined {
  const stripped = value?.replace(/^Ore Dictionary:\s*/i, "").trim();
  return stripped || undefined;
}

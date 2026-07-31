import type {
  Recipe,
  RecipeOutput,
  ResourceAmount,
  ResourceFlow,
  ResourceKey,
  ResourceKind,
} from "./types";

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

export function formatNumberWithThousands(value: number | string): string {
  const text = String(value);
  const sign = text.startsWith("-") ? "-" : "";
  const unsigned = sign ? text.slice(1) : text;
  const [integer, fraction] = unsigned.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  return `${sign}${grouped}${fraction !== undefined ? `,${fraction}` : ""}`;
}

export function trimTrailingDecimalZeros(value: string): string {
  return value.replace(/(\.\d*[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

export function formatResourceRate(flow: ResourceFlow | undefined): string {
  if (!flow) {
    return "none";
  }

  const unit = flow.kind === "fluid" ? "L/s" : "/s";
  return `${resourceLabel({ id: flow.resourceId, displayName: flow.displayName })} ${formatRate(flow.amountPerSecond)}${unit}`;
}

export function primaryOutput(recipe: Recipe): RecipeOutput | undefined {
  return recipe.outputs.find((output) => !output.byproduct) ?? recipe.outputs[0];
}

export function getChanceMultiplier(output: RecipeOutput): number {
  return output.chance ?? 1;
}

export function isRecipeInputConsumed(input: Pick<ResourceAmount, "id"> & { consumed?: boolean }): boolean {
  return input.consumed !== false;
}

export function resourceMatchesInput(
  resource: Pick<ResourceAmount, "kind" | "id" | "displayName">,
  input: Pick<ResourceAmount, "kind" | "id" | "displayName" | "alternatives">,
): boolean {
  if (resource.kind === input.kind) {
    return (
      resource.id === input.id ||
      Boolean(
        input.alternatives?.some(
          (alternative) => alternative.kind === resource.kind && alternative.id === resource.id,
        ),
      )
    );
  }

  if (resource.kind === "fluid" && input.kind === "item") {
    return isFluidEquivalentToFilledCell(resource, input);
  }

  if (resource.kind === "item" && input.kind === "fluid") {
    return isFluidEquivalentToFilledCell(input, resource);
  }

  return false;
}

export function getFilledCellFluidEquivalent<
  T extends Pick<
    ResourceAmount,
    "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor" | "tooltip"
  > & {
    amount?: number;
    alternatives?: ResourceAmount["alternatives"];
  },
>(resource: T): (Pick<T, "amount"> &
  Pick<ResourceAmount, "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor" | "tooltip">) | undefined {
  if (resource.kind === "fluid") {
    return resource as Pick<T, "amount"> &
      Pick<ResourceAmount, "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor" | "tooltip">;
  }

  const alternative = resource.alternatives?.find((entry) => entry.kind === "fluid");
  if (alternative) {
    return {
      ...alternative,
      kind: "fluid",
      amount:
        resource.amount === undefined
          ? undefined
          : getFilledCellFluidAmount({
              amount: resource.amount,
              cellFluidAmount: alternative.amount,
            }),
    };
  }

  const fluidName = getFilledCellFluidName(resource);
  if (!fluidName) {
    return undefined;
  }

  return {
    kind: "fluid",
    id: normalizeFluidId(fluidName),
    displayName: fluidName,
    amount:
      resource.amount === undefined
        ? undefined
        : getFilledCellFluidAmount({ amount: resource.amount }),
  };
}

export function getFilledCellFluidAmount(
  resource: Pick<ResourceAmount, "amount"> & { cellFluidAmount?: number },
): number {
  return resource.amount * (resource.cellFluidAmount ?? 1000);
}

function isFluidEquivalentToFilledCell(
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

function getFilledCellFluidName(resource: Pick<ResourceAmount, "displayName" | "id">): string | undefined {
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

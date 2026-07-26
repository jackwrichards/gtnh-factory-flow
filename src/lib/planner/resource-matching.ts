import { resourceMatchesInput } from "@/lib/model/resources";
import type { ResourceAmount } from "@/lib/model/types";

type MatchableResource = Pick<ResourceAmount, "kind" | "id" | "displayName">;
type MatchableInput = Pick<ResourceAmount, "kind" | "id" | "displayName" | "alternatives">;

const WILDCARD_SUFFIX = "@32767";

/**
 * The model's matcher plus GT's wildcard-meta convention: an input asking for
 * `minecraft:log@32767` accepts any `minecraft:log@*`. The dataset's server
 * scope machinery understands this; plan building has to agree with it or a
 * stocked Oak Log reads as "missing" against an any-log recipe.
 */
export function plannerResourceSatisfiesInput(
  resource: MatchableResource,
  input: MatchableInput,
): boolean {
  if (resourceMatchesInput(resource, input)) {
    return true;
  }

  if (resource.kind !== input.kind) {
    return false;
  }

  if (wildcardIdMatches(input.id, resource.id)) {
    return true;
  }

  return (input.alternatives ?? []).some(
    (alternative) =>
      alternative.kind === resource.kind && wildcardIdMatches(alternative.id, resource.id),
  );
}

function wildcardIdMatches(wildcardId: string, concreteId: string): boolean {
  if (!wildcardId.endsWith(WILDCARD_SUFFIX)) {
    return false;
  }

  const baseId = wildcardId.slice(0, -WILDCARD_SUFFIX.length);
  return concreteId === baseId || concreteId.startsWith(`${baseId}@`);
}

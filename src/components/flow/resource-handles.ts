import type { ResourceAmount, ResourceKind } from "@/lib/model/types";

export type ResourceHandleSide = "input" | "output";

export interface ResourceHandlePayload {
  side: ResourceHandleSide;
  kind: ResourceKind;
  resourceId: string;
}

export function makeResourceHandleId(
  side: ResourceHandleSide,
  resource: Pick<ResourceAmount, "kind" | "id">,
  slotIndex?: number,
): string {
  return `${side}:${resource.kind}:${encodeURIComponent(resource.id)}${slotIndex === undefined ? "" : `:${slotIndex}`}`;
}

/**
 * Collapses any handle id (with or without a trailing slot index) onto the
 * index-less port id the node actually renders. Rails expose one handle per
 * unique resource, while historical edges stored per-slot ids - both must
 * resolve to the same rendered handle or React Flow refuses to draw the edge.
 * Ids that don't parse (storage schemes, malformed) pass through untouched.
 */
export function canonicalizeResourceHandleId(handleId?: string | null): string | undefined {
  const parsed = parseResourceHandleId(handleId);
  if (!parsed) {
    return handleId ?? undefined;
  }

  return makeResourceHandleId(parsed.side, { kind: parsed.kind, id: parsed.resourceId });
}

export function parseResourceHandleId(handleId?: string | null): ResourceHandlePayload | undefined {
  if (!handleId) {
    return undefined;
  }

  const [side, kind, encodedResourceId] = handleId.split(":");
  if (
    (side !== "input" && side !== "output") ||
    (kind !== "item" && kind !== "fluid") ||
    !encodedResourceId
  ) {
    return undefined;
  }

  return {
    side,
    kind,
    resourceId: decodeURIComponent(encodedResourceId),
  };
}

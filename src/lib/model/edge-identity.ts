import type { FactoryEdge } from "./types";

/**
 * Collapses any handle id onto the index-less port id the node actually
 * renders. A card exposes ONE port row per resource per side, but handle ids
 * have been minted both ways: hand-drawn wires carry `output:item:cobble`,
 * while auto-connect, plan imports and older saves carry a trailing slot index
 * (`output:item:cobble:0`). Both name the same row, so both must reduce to the
 * same string or the two spellings read as two different ports.
 *
 * Ids that don't parse (storage schemes, malformed) pass through untouched.
 */
export function canonicalizeResourceHandleId(handleId?: string | null): string | undefined {
  if (!handleId) {
    return undefined;
  }

  const [side, kind, encodedResourceId] = handleId.split(":");
  if (
    (side !== "input" && side !== "output") ||
    (kind !== "item" && kind !== "fluid" && kind !== "energy") ||
    !encodedResourceId
  ) {
    return handleId;
  }

  return `${side}:${kind}:${encodedResourceId}`;
}

/**
 * Whether two edges are the same wire: the same resource, running between the
 * same two cards, landing on the same port ROW at each end.
 *
 * The row is the unit on purpose. A recipe with cobblestone in three output
 * slots still draws one output row, so three edges differing only in their slot
 * index are three copies of one line — they split the rate between them and
 * stack on the same pixels. Comparing raw handle strings called them distinct,
 * which is how a board ended up with a wire drawn twice and how dragging the
 * same pair of rows kept adding another.
 */
export function isSameEdgeWire(left: FactoryEdge, right: FactoryEdge): boolean {
  return (
    left.source === right.source &&
    left.target === right.target &&
    left.resourceKind === right.resourceKind &&
    left.resourceId === right.resourceId &&
    canonicalizeResourceHandleId(left.sourceHandle) ===
      canonicalizeResourceHandleId(right.sourceHandle) &&
    canonicalizeResourceHandleId(left.targetHandle) ===
      canonicalizeResourceHandleId(right.targetHandle)
  );
}

/**
 * The wire in `edges` that `edge` would duplicate. Callers pass a candidate
 * that is not yet in the list, so this never matches an edge against itself.
 */
export function findDuplicateEdge(
  edges: readonly FactoryEdge[],
  edge: FactoryEdge,
): FactoryEdge | undefined {
  return edges.find((existing) => isSameEdgeWire(existing, edge));
}

/**
 * Drops every wire that another wire already draws, keeping the first of each.
 * Returns the input array itself when there is nothing to drop, so callers can
 * skip work on the overwhelmingly common clean case.
 */
export function dedupeEdgeWires(edges: FactoryEdge[]): FactoryEdge[] {
  const kept: FactoryEdge[] = [];
  for (const edge of edges) {
    if (!findDuplicateEdge(kept, edge)) {
      kept.push(edge);
    }
  }

  return kept.length === edges.length ? edges : kept;
}

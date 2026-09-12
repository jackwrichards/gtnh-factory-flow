import type { FactoryEdge, FactoryProject } from "./types";
import { getStorageRoles } from "./storage-role";
import { sectionOwnerId } from "./shared-machine";

export function edgeRatioWeight(edge: Pick<FactoryEdge, "ratioWeight">): number {
  const value = edge.ratioWeight ?? 1;
  return Number.isFinite(value) && value >= 0 ? value : 1;
}

export interface StorageRatioBranch {
  targetId: string;
  edges: FactoryEdge[];
  weight: number;
  share: number;
}

/** One branch per drawn channel, matching the board's same-resource grouping.
 * Internal slot wires to a shared machine remain free to divide its share. */
export function getStorageRatioBranches(edges: readonly FactoryEdge[]): StorageRatioBranch[] {
  const groups = new Map<string, StorageRatioBranch>();
  // Scale before summing: valid finite weights must not overflow at 1e308.
  let max = 0;
  for (const edge of edges) max = Math.max(max, edgeRatioWeight(edge));
  let total = 0;
  for (const edge of edges) {
    const targetId = sectionOwnerId(edge.target);
    const key = JSON.stringify([targetId, edge.resourceKind, edge.resourceId]);
    let group = groups.get(key);
    if (!group) {
      group = { targetId, edges: [], weight: 0, share: 0 };
      groups.set(key, group);
    }
    group.edges.push(edge);
    group.weight = Math.min(Number.MAX_VALUE, group.weight + edgeRatioWeight(edge));
    const scaled = max > 0 ? edgeRatioWeight(edge) / max : 0;
    group.share += scaled;
    total += scaled;
  }
  for (const group of groups.values()) group.share = total > 0 ? group.share / total : 0;
  return [...groups.values()];
}

/** O(storages + edges), shared by the two solvers and board presentation. */
export function getProjectRatioBranches(
  project: FactoryProject,
): Map<string, StorageRatioBranch[]> {
  const result = new Map<string, StorageRatioBranch[]>();
  if (project.poolMode) return result;
  const ratioIds = new Set(
    (project.storages ?? []).filter((s) => s.bufferMode === "ratio").map((s) => s.id),
  );
  if (!ratioIds.size) return result;
  const roles = getStorageRoles(project);
  const outgoing = new Map<string, FactoryEdge[]>();
  for (const edge of project.edges) {
    if (!ratioIds.has(edge.source) || roles.get(edge.source) !== "buffer") continue;
    const list = outgoing.get(edge.source) ?? [];
    list.push(edge);
    outgoing.set(edge.source, list);
  }
  for (const [id, edges] of outgoing) result.set(id, getStorageRatioBranches(edges));
  return result;
}

export function formatRatioShare(share: number): string {
  if (share > 0 && share < 0.0001) return "<0.01%";
  if (share < 1 && share > 0.9999) return ">99.99%";
  return `${Number((share * 100).toFixed(2))}%`;
}

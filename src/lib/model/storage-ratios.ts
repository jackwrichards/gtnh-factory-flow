import type { FactoryEdge, FactoryProject, FactoryStorage } from "./types";
import { getStorageRoles } from "./storage-role";
import { sectionOwnerId } from "./shared-machine";

export function edgeRatioWeight(edge: Pick<FactoryEdge, "ratioWeight">): number {
  const value = edge.ratioWeight ?? 1;
  return Number.isFinite(value) && value >= 0 ? value : 1;
}

export interface StorageRatioBranch {
  /** The connected card: source for inputs, target for outputs. */
  targetId: string;
  edges: FactoryEdge[];
  weight: number;
  share: number;
}

/** One branch per drawn channel, matching the board's same-resource grouping.
 * Internal slot wires to a shared machine remain free to divide its share. */
export function getStorageRatioBranches(
  edges: readonly FactoryEdge[],
  side: "input" | "output" = "output",
): StorageRatioBranch[] {
  const weightOf = (edge: FactoryEdge) =>
    edgeRatioWeight({ ratioWeight: side === "input" ? edge.ratioInputWeight : edge.ratioWeight });
  const groups = new Map<string, StorageRatioBranch>();
  // Scale before summing: valid finite weights must not overflow at 1e308.
  let max = 0;
  for (const edge of edges) max = Math.max(max, weightOf(edge));
  let total = 0;
  for (const edge of edges) {
    const targetId = sectionOwnerId(side === "input" ? edge.source : edge.target);
    const key = JSON.stringify([targetId, edge.resourceKind, edge.resourceId]);
    let group = groups.get(key);
    if (!group) {
      group = { targetId, edges: [], weight: 0, share: 0 };
      groups.set(key, group);
    }
    group.edges.push(edge);
    group.weight = Math.min(Number.MAX_VALUE, group.weight + weightOf(edge));
    const scaled = max > 0 ? weightOf(edge) / max : 0;
    group.share += scaled;
    total += scaled;
  }
  for (const group of groups.values()) group.share = total > 0 ? group.share / total : 0;
  return [...groups.values()];
}

/** O(storages + edges), shared by the two solvers and board presentation. */
export function getProjectRatioBranches(
  project: FactoryProject,
  side: "input" | "output" = "output",
): Map<string, StorageRatioBranch[]> {
  const result = new Map<string, StorageRatioBranch[]>();
  if (project.poolMode) return result;
  const ratioIds = new Set(
    (project.storages ?? []).filter((s) => s.bufferMode === "ratio").map((s) => s.id),
  );
  if (!ratioIds.size) return result;
  const roles = getStorageRoles(project);
  const storages = new Map(project.storages?.map((storage) => [storage.id, storage]));
  const outgoing = new Map<string, FactoryEdge[]>();
  for (const edge of project.edges) {
    const storageId = side === "input" ? edge.target : edge.source;
    if (!ratioIds.has(storageId) || roles.get(storageId) !== "buffer") continue;
    const list = outgoing.get(storageId) ?? [];
    list.push(edge);
    outgoing.set(storageId, list);
  }
  for (const [id, edges] of outgoing) {
    const branches = getStorageRatioBranches(edges, side);
    if (side === "output")
      for (const branch of branches) branch.share *= 1 - ratioExportShare(storages.get(id));
    result.set(id, branches);
  }
  return result;
}

export function ratioExportShare(
  storage: Pick<FactoryStorage, "ratioExportPercent"> | undefined,
): number {
  const value = storage?.ratioExportPercent ?? 0;
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) / 100 : 0;
}

export function formatRatioShare(share: number): string {
  if (share > 0 && share < 0.0001) return "<0.01%";
  if (share < 1 && share > 0.9999) return ">99.99%";
  return `${Number((share * 100).toFixed(2))}%`;
}

/** Inputs total 100%; outputs plus the unwired Export share total another 100%.
 * Editing one share preserves the proportions of all remaining shares. */
export function setStorageRatioPercentage(
  project: FactoryProject,
  storageId: string,
  edgeId: string | undefined,
  percentage: number,
  side: "input" | "output" = "output",
): FactoryProject {
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) return project;
  const storage = project.storages?.find((storage) => storage.id === storageId);
  if (!storage || storage.bufferMode !== "ratio" || project.poolMode) return project;
  const branches = getStorageRatioBranches(
    project.edges.filter((edge) => (side === "input" ? edge.target : edge.source) === storageId),
    side,
  );
  if (side === "output") {
    const exported = ratioExportShare(storage);
    for (const branch of branches) branch.share *= 1 - exported;
    branches.push({ targetId: "", edges: [], weight: exported * 100, share: exported });
  }
  const selected = branches.find((branch) =>
    edgeId === undefined
      ? branch.edges.length === 0
      : branch.edges.some((edge) => edge.id === edgeId),
  );
  if (!selected) return project;
  const share = branches.length === 1 ? 1 : percentage / 100;
  if (Math.abs(selected.share - share) < 1e-12) return project;
  const others = branches.filter((branch) => branch !== selected);
  const remaining = others.reduce((sum, branch) => sum + branch.share, 0);
  const wiredOthers = others.filter((branch) => branch.edges.length);
  const emptyRecipients = wiredOthers.length ? wiredOthers : others;
  const weights = new Map<string, number>();
  let exportPercent = storage.ratioExportPercent ?? 0;
  for (const branch of branches) {
    const portion =
      branch === selected
        ? share
        : (1 - share) *
          (remaining > 0
            ? branch.share / remaining
            : emptyRecipients.includes(branch)
              ? 1 / emptyRecipients.length
              : 0);
    if (!branch.edges.length) exportPercent = portion * 100;
    for (const edge of branch.edges) weights.set(edge.id, (portion * 100) / branch.edges.length);
  }
  return {
    ...project,
    storages:
      side === "output"
        ? project.storages?.map((entry) =>
            entry.id === storageId ? { ...entry, ratioExportPercent: exportPercent } : entry,
          )
        : project.storages,
    edges: project.edges.map((edge) =>
      weights.has(edge.id)
        ? {
            ...edge,
            [side === "input" ? "ratioInputWeight" : "ratioWeight"]: weights.get(edge.id)!,
          }
        : edge,
    ),
  };
}

/** Equalize connected branches; the separate Setup output allocation stays put. */
export function equalizeStorageRatioPercentages(
  project: FactoryProject,
  storageId: string,
  side: "input" | "output",
): FactoryProject {
  if (
    project.poolMode ||
    !project.storages?.some((storage) => storage.id === storageId && storage.bufferMode === "ratio")
  )
    return project;
  const branches = getStorageRatioBranches(
    project.edges.filter((edge) => (side === "input" ? edge.target : edge.source) === storageId),
    side,
  );
  if (
    !branches.length ||
    branches.every((branch) => Math.abs(branch.share - 1 / branches.length) < 1e-12)
  )
    return project;
  const weights = new Map(
    branches.flatMap((branch) =>
      branch.edges.map((edge) => [edge.id, 1 / branch.edges.length] as const),
    ),
  );
  return {
    ...project,
    edges: project.edges.map((edge) =>
      weights.has(edge.id)
        ? {
            ...edge,
            [side === "input" ? "ratioInputWeight" : "ratioWeight"]: weights.get(edge.id)!,
          }
        : edge,
    ),
  };
}

import type { FactoryProject, ProductionGroup } from "./types";

/** Repair imports deterministically; never discard machines in a broken group. */
export function normalizeProductionGroups(project: FactoryProject): FactoryProject {
  const ids = new Set<string>();
  const groups = (project.productionGroups ?? []).filter((group) => {
    if (!group.id || ids.has(group.id)) return false;
    ids.add(group.id);
    return true;
  });
  const byId = new Map(groups.map((group) => [group.id, group]));
  const repaired = groups.map((group) => {
    let parentId = group.parentId;
    const seen = new Set([group.id]);
    while (parentId) {
      if (seen.has(parentId) || !byId.has(parentId)) return { ...group, parentId: undefined };
      seen.add(parentId);
      parentId = byId.get(parentId)!.parentId;
    }
    return group;
  });
  const repairMember = <T extends { productionGroupId?: string }>(member: T): T =>
    member.productionGroupId && !ids.has(member.productionGroupId)
      ? { ...member, productionGroupId: undefined }
      : member;
  if (
    repaired.length === (project.productionGroups?.length ?? 0) &&
    repaired.every((group, index) => group === project.productionGroups![index]) &&
    project.nodes.every((node) => repairMember(node) === node) &&
    (project.storages ?? []).every((storage) => repairMember(storage) === storage)
  )
    return project;
  return {
    ...project,
    productionGroups: repaired,
    nodes: project.nodes.map(repairMember),
    storages: project.storages?.map(repairMember),
  };
}

export function productionGroupDescendants(
  groups: readonly ProductionGroup[],
  id: string,
): Set<string> {
  const result = new Set([id]);
  const children = new Map<string, string[]>();
  for (const group of groups)
    if (group.parentId) {
      children.set(group.parentId, [...(children.get(group.parentId) ?? []), group.id]);
    }
  const pending = [id];
  while (pending.length)
    for (const child of children.get(pending.pop()!) ?? []) {
      if (!result.has(child)) {
        result.add(child);
        pending.push(child);
      }
    }
  return result;
}

/** Parent-before-child order, shared by the UI and reversed by pool expansion. */
export function productionGroupTree(
  groups: readonly ProductionGroup[],
): Array<{ group: ProductionGroup; depth: number }> {
  const result: Array<{ group: ProductionGroup; depth: number }> = [];
  const seen = new Set<string>();
  const pending = groups
    .filter((group) => !group.parentId)
    .reverse()
    .map((group) => ({ group, depth: 0 }));
  while (pending.length) {
    const entry = pending.pop()!;
    if (seen.has(entry.group.id)) continue;
    seen.add(entry.group.id);
    result.push(entry);
    pending.push(
      ...groups
        .filter((group) => group.parentId === entry.group.id)
        .reverse()
        .map((group) => ({ group, depth: entry.depth + 1 })),
    );
  }
  return result;
}

/** Dissolve only the container: members and children move to its parent. */
export function dissolveProductionGroup(project: FactoryProject, id: string): FactoryProject {
  const group = project.productionGroups?.find((entry) => entry.id === id);
  if (!group) return project;
  const move = <T extends { productionGroupId?: string }>(member: T): T =>
    member.productionGroupId === id ? { ...member, productionGroupId: group.parentId } : member;
  return {
    ...project,
    productionGroups: project
      .productionGroups!.filter((entry) => entry.id !== id)
      .map((entry) => (entry.parentId === id ? { ...entry, parentId: group.parentId } : entry)),
    nodes: project.nodes.map(move),
    storages: project.storages?.map(move),
  };
}

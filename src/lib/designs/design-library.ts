import type { FactoryProject } from "@/lib/model/types";

/** Tab-strip metadata: everything needed to draw the tabs without loading plans. */
export interface DesignSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** A saved design: its metadata plus the plan itself. */
export interface DesignRecord extends DesignSummary {
  project: FactoryProject;
}

export const UNTITLED_DESIGN_NAME = "Untitled design";

export function createDesignId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `design-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Trims a user-typed name, falling back rather than allowing a blank tab.
 *
 * A tab with an empty label is unclickable in practice — there is nothing to aim
 * at — so an empty rename resolves to the placeholder instead of being rejected
 * with an error the user then has to dismiss.
 */
export function normalizeDesignName(name: string): string {
  return name.trim() || UNTITLED_DESIGN_NAME;
}

/**
 * First free name in the `base`, `base (2)`, `base (3)`… sequence.
 *
 * Duplicating twice has to produce two distinct tabs, and names are the only
 * thing distinguishing them on screen.
 */
export function makeUniqueDesignName(base: string, taken: Iterable<string>): string {
  const normalizedBase = normalizeDesignName(base);
  const takenNames = new Set([...taken].map((name) => name.toLowerCase()));
  if (!takenNames.has(normalizedBase.toLowerCase())) {
    return normalizedBase;
  }

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${normalizedBase} (${suffix})`;
    if (!takenNames.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
}

export function createDesign(
  project: FactoryProject,
  name: string,
  now: string = new Date().toISOString(),
): DesignRecord {
  const designName = normalizeDesignName(name);

  return {
    id: createDesignId(),
    name: designName,
    createdAt: now,
    updatedAt: now,
    // The plan carries the name too: it is what the JSON export names its file,
    // so letting the two drift would export "Untitled" from a renamed tab.
    project: { ...project, name: designName },
  };
}

export function duplicateDesign(
  record: DesignRecord,
  takenNames: Iterable<string>,
  now: string = new Date().toISOString(),
): DesignRecord {
  return createDesign(record.project, makeUniqueDesignName(`${record.name} copy`, takenNames), now);
}

export function renameDesign(
  record: DesignRecord,
  name: string,
  now: string = new Date().toISOString(),
): DesignRecord {
  const designName = normalizeDesignName(name);

  return {
    ...record,
    name: designName,
    updatedAt: now,
    project: { ...record.project, name: designName },
  };
}

/** Stores the plan against a design without disturbing its place in the strip. */
export function updateDesignProject(
  record: DesignRecord,
  project: FactoryProject,
  now: string = new Date().toISOString(),
): DesignRecord {
  return {
    ...record,
    updatedAt: now,
    // The tab name wins over whatever the plan carries, so an imported plan
    // cannot silently relabel the tab it was dropped into.
    project: { ...project, name: record.name },
  };
}

/**
 * Tab order is creation order, oldest first.
 *
 * Ordering by recency would reshuffle the strip under the pointer every time a
 * plan is edited, so tabs would never be where they were a moment ago.
 */
export function sortDesigns<T extends DesignSummary>(records: T[]): T[] {
  return [...records].sort((left, right) => {
    const byCreated = left.createdAt.localeCompare(right.createdAt);
    return byCreated !== 0 ? byCreated : left.id.localeCompare(right.id);
  });
}

export function toDesignSummary(record: DesignRecord): DesignSummary {
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Which design to show after `removedId` goes away.
 *
 * Falls to the neighbour on the left, matching how tab strips everywhere behave,
 * and returns undefined only when the last design was closed.
 */
export function pickDesignAfterDelete(
  ordered: DesignSummary[],
  removedId: string,
): string | undefined {
  const index = ordered.findIndex((design) => design.id === removedId);
  if (index === -1) {
    return ordered[0]?.id;
  }

  const remaining = ordered.filter((design) => design.id !== removedId);
  if (remaining.length === 0) {
    return undefined;
  }

  return remaining[Math.max(0, index - 1)]?.id ?? remaining[0]?.id;
}

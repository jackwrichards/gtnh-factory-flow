import type { EntryIcon, FactoryProject } from "@/lib/model/types";
import type { DesignStats } from "./design-stats";

/** Tab-strip metadata: everything needed to draw the tabs without loading plans. */
export interface DesignSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Hand-picked place in the strip, stamped by drag-reordering. Absent until
   * the first reorder; designs without one sort after those with one, so a
   * fresh tab lands at the end either way.
   */
  order?: number;
  /**
   * The plan's own one-item face, copied out so the strip can draw it without
   * loading plans. Kept in step wherever the record is written.
   */
  icon?: EntryIcon;
  /**
   * Off the tab strip, on the shelf only. A closed design is not deleted:
   * closing a tab puts the design back on the shelf, opening it from the
   * shelf clears the flag. Absent means open, which is what every design was
   * before the shelf existed.
   */
  closed?: boolean;
  /** The shelf folder this design is filed in; absent means unfiled. */
  folderId?: string;
  /**
   * The community post this design IS, when it is posted: copied out of the
   * plan's metadata so the library can mark it without loading the plan. The
   * post follows the design (post-follow.ts); a copy of someone else's post
   * carries no link.
   */
  communityPlanId?: string;
  /**
   * SYNC BOOKKEEPING. `updatedAt` above moves when the PLAN is saved;
   * `metaUpdatedAt` moves on any change at all (rename, close, folder,
   * order, plan). `remoteUpdatedAt` is the account copy's `updatedAt` as of
   * the last agreement; absent means never synced. Dirty is
   * `metaUpdatedAt > remoteUpdatedAt`, and the plan needs sending only when
   * `updatedAt > remoteUpdatedAt`. See library-sync.ts.
   */
  metaUpdatedAt?: string;
  remoteUpdatedAt?: string;
  /** Starred: in the built-in Favorites collection. Synced like any metadata. */
  favorite?: boolean;
  /** The tile's stat row, stamped at save. Local only; never synced. */
  stats?: DesignStats;
}

/** A library folder. Flat: folders hold designs, never other folders. */
export interface DesignFolder {
  id: string;
  name: string;
  createdAt: string;
  /** Moves on rename. Sync compares it the way it compares designs. */
  updatedAt?: string;
  remoteUpdatedAt?: string;
}

/** A saved design: its metadata plus the plan itself. */
export interface DesignRecord extends DesignSummary {
  project: FactoryProject;
}

export const UNTITLED_DESIGN_NAME = "Untitled design";
export const UNTITLED_FOLDER_NAME = "New folder";

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

/** The longest design name the account accepts (library sync refuses more). */
const DESIGN_NAME_MAX_LENGTH = 80;
const CONFLICT_COPY_SUFFIX = " (conflict copy)";

/**
 * The name for a tab's edits kept aside because another tab saved first.
 *
 * A copy of a conflict copy counts on ("(2)") rather than stacking the words,
 * and the name is clipped to fit the account: a player hit a chain of these
 * (2026-09-25) and every one past 80 characters was refused by sync.
 */
export function conflictCopyName(name: string, taken: Iterable<string>): string {
  const base = name.replace(/(\s*\(conflict copy\)(\s*\(\d+\))?)+$/i, "").trim() || name.trim();
  // Room for the suffix and for makeUniqueDesignName's " (NN)".
  const room = DESIGN_NAME_MAX_LENGTH - CONFLICT_COPY_SUFFIX.length - 5;
  const clipped = base.length > room ? base.slice(0, room).trimEnd() : base;
  return makeUniqueDesignName(`${clipped}${CONFLICT_COPY_SUFFIX}`, taken);
}

/**
 * A metadata-only write (rename, star, folder, sync's stamp) as it should
 * land over the summary already `stored`.
 *
 * `updatedAt` is the PLAN's stamp, and a write that does not carry the plan
 * must never move it: every such writer read the summary first, and if a
 * save landed in between, writing that copy back put the stamp behind the
 * plan, so the tab that saved read its own next save as another tab's and
 * split its work into a conflict copy (2026-09-25). The marks read off the
 * plan (icon, stat row, post link) are the stored plan's for the same reason.
 */
export function keepStoredPlanMarks(
  summary: DesignSummary,
  stored: DesignSummary | undefined,
): DesignSummary {
  if (!stored || stored.updatedAt === summary.updatedAt) {
    return summary;
  }
  const kept: DesignSummary = { ...summary, updatedAt: stored.updatedAt };
  delete kept.icon;
  delete kept.stats;
  delete kept.communityPlanId;
  if (stored.icon) {
    kept.icon = stored.icon;
  }
  if (stored.stats) {
    kept.stats = stored.stats;
  }
  if (stored.communityPlanId) {
    kept.communityPlanId = stored.communityPlanId;
  }
  return kept;
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
  // A copy is a new design: it must not carry the original's post along, or
  // two designs would be feeding one post.
  const { communityPlanId, ...metadata } = record.project.metadata ?? {};
  void communityPlanId;
  return createDesign(
    { ...record.project, metadata },
    makeUniqueDesignName(`${record.name} copy`, takenNames),
    now,
  );
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
    metaUpdatedAt: now,
    // The tab name wins over whatever the plan carries, so an imported plan
    // cannot silently relabel the tab it was dropped into.
    project: { ...project, name: record.name },
  };
}

/** Stamps a metadata-only change (rename, close, folder, order) for sync. */
export function touchDesignMeta<T extends DesignSummary>(
  summary: T,
  now: string = new Date().toISOString(),
): T {
  return { ...summary, metaUpdatedAt: now };
}

/**
 * Tab order is the hand-picked `order` where one has been stamped, and
 * creation order (oldest first) everywhere else.
 *
 * Ordering by recency would reshuffle the strip under the pointer every time a
 * plan is edited, so tabs would never be where they were a moment ago. A tab
 * without an `order` sorts after every tab with one, which puts new designs at
 * the end of a strip that has been rearranged.
 */
export function sortDesigns<T extends DesignSummary>(records: T[]): T[] {
  return [...records].sort((left, right) => {
    const byOrder =
      (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER);
    if (byOrder !== 0) {
      return byOrder;
    }
    const byCreated = left.createdAt.localeCompare(right.createdAt);
    return byCreated !== 0 ? byCreated : left.id.localeCompare(right.id);
  });
}

/**
 * Restamps every summary's `order` to match `orderedIds`.
 *
 * Ids the strip does not know are ignored; summaries the id list misses keep
 * their relative place after the ordered ones, so a design created mid-drag by
 * another tab of the app is appended rather than lost.
 */
export function stampDesignOrder<T extends DesignSummary>(
  summaries: T[],
  orderedIds: string[],
): T[] {
  const byId = new Map(summaries.map((summary) => [summary.id, summary]));
  const ordered: T[] = [];
  for (const id of orderedIds) {
    const summary = byId.get(id);
    if (summary) {
      ordered.push(summary);
      byId.delete(id);
    }
  }
  for (const summary of summaries) {
    if (byId.has(summary.id)) {
      ordered.push(summary);
    }
  }
  return ordered.map((summary, index) => ({ ...summary, order: index }));
}

export function toDesignSummary(record: DesignRecord): DesignSummary {
  const communityPlanId = record.project.metadata?.communityPlanId;
  const summary: DesignSummary = {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    order: record.order,
    icon: record.project.icon,
  };
  if (record.closed) {
    summary.closed = true;
  }
  if (record.folderId) {
    summary.folderId = record.folderId;
  }
  if (record.metaUpdatedAt) {
    summary.metaUpdatedAt = record.metaUpdatedAt;
  }
  if (record.remoteUpdatedAt) {
    summary.remoteUpdatedAt = record.remoteUpdatedAt;
  }
  if (record.stats) {
    summary.stats = record.stats;
  }
  if (record.favorite) {
    summary.favorite = true;
  }
  if (communityPlanId) {
    summary.communityPlanId = communityPlanId;
  }
  return summary;
}

/** The designs on the tab strip, in strip order. */
export function openDesigns<T extends DesignSummary>(designs: T[]): T[] {
  return designs.filter((design) => !design.closed);
}

export function createFolder(name: string, now: string = new Date().toISOString()): DesignFolder {
  return { id: createDesignId(), name: normalizeFolderName(name), createdAt: now, updatedAt: now };
}

export function normalizeFolderName(name: string): string {
  return name.trim() || UNTITLED_FOLDER_NAME;
}

/** Folders are listed by name; there is no hand order to keep. */
export function sortFolders<T extends DesignFolder>(folders: T[]): T[] {
  return [...folders].sort(
    (left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
      left.createdAt.localeCompare(right.createdAt),
  );
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

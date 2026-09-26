"use client";

import { patchCommunityPlan } from "@/lib/community/client";
import { readDesign, writeDesignIfUnchanged } from "@/lib/designs/design-storage";
import { serializeFactoryProject } from "@/lib/import-export/factory-json";
import { notifySetupsChanged } from "@/lib/setups-tab";
import { useCommunityAuthStore } from "@/store/community-auth-store";

/**
 * THE POST FOLLOWS THE DESIGN. A design linked to a post you own has one
 * version: the one in your library. Every save of such a design is pushed to
 * the post a few seconds later (plan, name, description, icon; tags are the
 * post's own and are edited on the focus page). The photograph stays the
 * one taken when sharing: autosave must never invoke the live-board image
 * exporter, which temporarily changes detail, presentation and motion.
 * A timed recapture made the board flash into glance view and stall while
 * the image rendered (longer still in a hidden tab waiting for paint).
 *
 * There is no "update post" anywhere else any more, and no second version
 * to compare against. Google Docs, not WordPress.
 *
 * A link the server refuses (403: not your post; 404: the post is gone) is
 * dropped from the design on the spot, so copies made before copies were
 * unlinked, and designs whose post was deleted elsewhere, quietly become
 * plain designs. A 401 (signed out) drops nothing: the push is remembered
 * and retried at the next sign-in, so edits made offline still reach the
 * post.
 */

const PUSH_DELAY_MS = 6_000;
const PENDING_KEY = "gtnh-factory-flow.post-follow-pending.v1";

const pushTimers = new Map<string, number>();
const inFlight = new Set<string>();
/** A push that landed while one was already running: run once more after. */
const again = new Set<string>();

/** Called after every write of a design record. Cheap when it has no link. */
export function schedulePostFollow(designId: string, linked: boolean): void {
  if (!linked || typeof window === "undefined") {
    return;
  }
  const existing = pushTimers.get(designId);
  if (existing !== undefined) {
    window.clearTimeout(existing);
  }
  pushTimers.set(
    designId,
    window.setTimeout(() => {
      pushTimers.delete(designId);
      void pushDesign(designId);
    }, PUSH_DELAY_MS),
  );
}

/**
 * Pushes right away, no debounce: for the moment a design leaves the canvas
 * (a tab switch or close), when the next autosave will not come.
 */
export function flushPostFollow(designId: string): void {
  const existing = pushTimers.get(designId);
  if (existing !== undefined) {
    window.clearTimeout(existing);
    pushTimers.delete(designId);
    void pushDesign(designId);
  }
}

/** Every push that waited on a sign-in goes out now. */
export function retryPendingPostFollows(): void {
  for (const id of readPending()) {
    schedulePostFollow(id, true);
  }
}

async function pushDesign(designId: string): Promise<void> {
  if (inFlight.has(designId)) {
    again.add(designId);
    return;
  }
  inFlight.add(designId);
  try {
    const record = await readDesign(designId);
    const planId = record?.project.metadata?.communityPlanId;
    if (!record || !planId) {
      forgetPending(designId);
      return;
    }
    if (!useCommunityAuthStore.getState().user) {
      // Signed out: the post keeps its last version until the next sign-in.
      rememberPending(designId);
      return;
    }
    try {
      await patchCommunityPlan(planId, {
        name: record.name,
        description: record.project.description ?? "",
        icon: record.project.icon ?? null,
        plan: JSON.parse(serializeFactoryProject(record.project)) as unknown,
      });
      forgetPending(designId);
      notifySetupsChanged();
    } catch (error) {
      const status = statusOf(error);
      if (status === 403 || status === 404) {
        await unlinkDesign(record.id);
        forgetPending(designId);
      } else if (status === 401) {
        rememberPending(designId);
      }
      // Anything else (offline, a server hiccup) waits for the next save.
    }
  } finally {
    inFlight.delete(designId);
    if (again.delete(designId)) {
      schedulePostFollow(designId, true);
    }
  }
}

async function unlinkDesign(designId: string): Promise<void> {
  // Guarded like a save: a save landing between the read and the write would
  // otherwise be written over with the older plan, and its stamp with it.
  for (let attempt = 0; ; attempt += 1) {
    const record = await readDesign(designId);
    if (!record?.project.metadata?.communityPlanId) {
      return;
    }
    const { communityPlanId, ...metadata } = record.project.metadata;
    void communityPlanId;
    const outcome = await writeDesignIfUnchanged(
      { ...record, project: { ...record.project, metadata } },
      record.updatedAt,
    );
    if (outcome === "written" || attempt >= 2) {
      break;
    }
  }
  const { useDesignStore } = await import("@/store/design-store");
  const { useFactoryStore } = await import("@/store/factory-store");
  if (useDesignStore.getState().activeDesignId === designId) {
    useFactoryStore.getState().clearProjectCommunityLink();
  }
  await useDesignStore.getState().refreshLibrary();
}

function statusOf(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status) || undefined
    : undefined;
}

function readPending(): string[] {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writePending(ids: string[]): void {
  try {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify(ids));
  } catch {
    // Storage full or blocked: the push simply waits for the next save.
  }
}

function rememberPending(designId: string): void {
  const ids = readPending();
  if (!ids.includes(designId)) {
    writePending([...ids, designId]);
  }
}

function forgetPending(designId: string): void {
  const ids = readPending();
  if (ids.includes(designId)) {
    writePending(ids.filter((id) => id !== designId));
  }
}

"use client";

import { create } from "zustand";
import { forgetDesignCameras } from "@/lib/designs/design-camera";
import type { DesignFolder, DesignSummary } from "@/lib/designs/design-library";
import {
  deleteDesign,
  deleteDesignFolder,
  listDesignFolders,
  listDesignSummaries,
  readDesign,
  writeDesign,
  writeDesignFolder,
  writeDesignSummary,
} from "@/lib/designs/design-storage";
import { parseFactoryProjectJson } from "@/lib/import-export";
import { useCommunityAuthStore } from "@/store/community-auth-store";
import { useDesignStore } from "@/store/design-store";
import {
  deleteRemoteDesign,
  deleteRemoteFolder,
  fetchRemoteDesignPlan,
  fetchRemoteLibrary,
  pushRemoteDesign,
  pushRemoteFolder,
} from "./client";
import {
  forgetLibraryDeletion,
  readPendingDeletes,
  subscribeToLibraryDeletions,
} from "./library-deletes";
import {
  LIBRARY_DESIGN_NAME_MAX_LENGTH,
  type RemoteDesignMeta,
  type RemoteFolder,
} from "./sync-types";

/**
 * Keeps the browser's library and the account's copy the same.
 *
 * THE RULES, all in `reconcileDesigns` / `reconcileFolders` (pure, tested):
 * - Every record carries `remoteUpdatedAt`: the account's `updatedAt` as of
 *   the last time both sides agreed. Absent means never synced.
 * - A local record is DIRTY when it changed since that agreement; a remote
 *   record has MOVED when its `updatedAt` is past it.
 * - Neither moved: nothing. Only one moved: that side wins. Both moved: the
 *   later write wins, by the writers' own clocks. No merging of plans.
 * - A tombstone deletes the local copy unless the local copy was edited
 *   after the delete, in which case the edit brings the design back.
 * - A local record the account has never seen is pushed, so signing in on a
 *   new browser ADDS its designs to the account rather than losing either.
 * - Plans are fetched only when `planUpdatedAt` moved; a rename or a close
 *   costs one small row.
 *
 * WHEN: on sign-in, on load, when the tab comes back to the front, every
 * half minute while the tab is in view, and a few seconds after changes to
 * the library stop (which is how autosave reaches the account) - at most
 * half a minute behind during nonstop editing, and at once when the tab
 * goes into the background. One run at a time; a request during a run
 * queues one more.
 *
 * WHEN NOT: signed out. Database and network failures stay visible and retry
 * on the next poll, focus or connection recovery. A design the account
 * REFUSED (too large, not valid, library full) is not sent again until it
 * changes.
 *
 * WHY SO CAREFUL (2026-09-24): every push carries the WHOLE plan. Pushing
 * half a second after every autosave, and resending refused plans on every
 * poll, put ~500 MB an hour of plan writes and ~500 MB an hour of refused
 * uploads on the Supabase instance, which then stopped answering for hours.
 */

export interface LibrarySyncStatus {
  state: "off" | "pending" | "idle" | "syncing" | "error";
  /** Why it is off, or what failed. */
  message?: string;
  /** The error is a design the account refused: it waits for an edit, not a retry. */
  refused?: boolean;
  lastSyncedAt?: string;
  /** Set after a pull replaced the plan that was on the canvas. */
  reloadedActiveAt?: string;
}

export const useLibrarySyncStore = create<LibrarySyncStatus>(() => ({ state: "off" }));

const PUSH_DEBOUNCE_MS = 5000;
const PUSH_MAX_WAIT_MS = 30000;
const POLL_MS = 30000;

/* ------------------------------------------------------------------ */
/* The pure part. */

export type DesignAction =
  | { kind: "pull-plan"; id: string; remote: RemoteDesignMeta }
  | { kind: "pull-meta"; id: string; remote: RemoteDesignMeta }
  | { kind: "delete-local"; id: string }
  | { kind: "push"; id: string; withPlan: boolean };

export type FolderAction =
  | { kind: "pull"; id: string; remote: RemoteFolder }
  | { kind: "delete-local"; id: string }
  | { kind: "push"; id: string };

type LocalDesign = Pick<DesignSummary, "id" | "updatedAt" | "metaUpdatedAt" | "remoteUpdatedAt">;

const ts = (value: string | undefined): number => (value ? Date.parse(value) : 0);

export function reconcileDesigns(local: LocalDesign[], remote: RemoteDesignMeta[]): DesignAction[] {
  const actions: DesignAction[] = [];
  const localById = new Map(local.map((design) => [design.id, design]));
  const seen = new Set<string>();

  for (const r of remote) {
    seen.add(r.id);
    const l = localById.get(r.id);
    const remoteAt = ts(r.updatedAt);

    if (!l) {
      if (!r.deletedAt) {
        actions.push({ kind: "pull-plan", id: r.id, remote: r });
      }
      continue;
    }

    const synced = ts(l.remoteUpdatedAt);
    const localAt = Math.max(ts(l.metaUpdatedAt), ts(l.updatedAt));
    const dirty = !l.remoteUpdatedAt || localAt > synced;
    const planDirty = !l.remoteUpdatedAt || ts(l.updatedAt) > synced;

    if (r.deletedAt) {
      // An edit made after the delete brings it back; otherwise it goes.
      if (dirty && localAt > remoteAt) {
        actions.push({ kind: "push", id: l.id, withPlan: true });
      } else {
        actions.push({ kind: "delete-local", id: l.id });
      }
      continue;
    }

    const remoteMoved = remoteAt > synced;
    if (remoteMoved && (!dirty || remoteAt >= localAt)) {
      const planMoved = !l.remoteUpdatedAt || ts(r.planUpdatedAt) > synced;
      actions.push({ kind: planMoved ? "pull-plan" : "pull-meta", id: r.id, remote: r });
    } else if (dirty) {
      actions.push({ kind: "push", id: l.id, withPlan: planDirty || remoteMoved });
    }
  }

  for (const l of local) {
    if (!seen.has(l.id)) {
      actions.push({ kind: "push", id: l.id, withPlan: true });
    }
  }
  return actions;
}

type LocalFolder = Pick<DesignFolder, "id" | "createdAt" | "updatedAt" | "remoteUpdatedAt">;

export function reconcileFolders(local: LocalFolder[], remote: RemoteFolder[]): FolderAction[] {
  const actions: FolderAction[] = [];
  const localById = new Map(local.map((folder) => [folder.id, folder]));
  const seen = new Set<string>();

  for (const r of remote) {
    seen.add(r.id);
    const l = localById.get(r.id);
    const remoteAt = ts(r.updatedAt);
    if (!l) {
      if (!r.deletedAt) {
        actions.push({ kind: "pull", id: r.id, remote: r });
      }
      continue;
    }
    const synced = ts(l.remoteUpdatedAt);
    const localAt = ts(l.updatedAt ?? l.createdAt);
    const dirty = !l.remoteUpdatedAt || localAt > synced;
    if (r.deletedAt) {
      if (dirty && localAt > remoteAt) {
        actions.push({ kind: "push", id: l.id });
      } else {
        actions.push({ kind: "delete-local", id: l.id });
      }
      continue;
    }
    const remoteMoved = remoteAt > synced;
    if (remoteMoved && (!dirty || remoteAt >= localAt)) {
      actions.push({ kind: "pull", id: r.id, remote: r });
    } else if (dirty) {
      actions.push({ kind: "push", id: l.id });
    }
  }
  for (const l of local) {
    if (!seen.has(l.id)) {
      actions.push({ kind: "push", id: l.id });
    }
  }
  return actions;
}

/**
 * What counts as a change HERE, worth a push: a design or folder added,
 * removed or restamped. Sync's own bookkeeping (the `remoteUpdatedAt` it
 * stamps) is not in it, and neither is a relist that changed nothing, so a
 * sync run cannot schedule the next one by itself. A refused design used to
 * do exactly that: every run relisted the library, the relist looked like an
 * edit, and the next run came five seconds later, forever (2026-09-25: one
 * player's browser listed their library every 6 s for hours).
 */
export function libraryChangeSignature(
  designs: Pick<DesignSummary, "id" | "updatedAt" | "metaUpdatedAt">[],
  folders: Pick<DesignFolder, "id" | "createdAt" | "updatedAt">[],
): string {
  const rows = [
    ...designs.map((design) => `d:${design.id}:${design.updatedAt}:${design.metaUpdatedAt ?? ""}`),
    ...folders.map((folder) => `f:${folder.id}:${folder.updatedAt ?? folder.createdAt}`),
  ];
  return rows.sort().join("|");
}

/* ------------------------------------------------------------------ */
/* Running it. */

let running: Promise<void> | undefined;
let runAgain = false;
let pushTimer: number | undefined;
/** The latest moment a queued push may still wait until. */
let pushDeadline: number | undefined;

/**
 * Designs the account refused, with the change stamp it refused. The same
 * design unchanged is refused the same way, so it is held back until its
 * stamp moves. In memory only: a reload tries once more.
 */
const refusedPushes = new Map<string, { stamp: string; message: string }>();

function isRefusal(error: unknown): error is Error {
  return error instanceof Error && (error as { refused?: unknown }).refused === true;
}

/** The later of two ISO stamps. */
function latestStamp(a: string | undefined, b: string): string {
  return a && ts(a) > ts(b) ? a : b;
}

function setStatus(patch: Partial<LibrarySyncStatus>) {
  useLibrarySyncStore.setState(patch);
}

function isSignedIn(): boolean {
  return Boolean(useCommunityAuthStore.getState().user);
}

/** Sync now, or queue one more run if one is under way. */
export function syncLibraryNow(): Promise<void> {
  if (!isSignedIn()) {
    return Promise.resolve();
  }
  if (running) {
    runAgain = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        runAgain = false;
        await runOnce();
      } while (runAgain && isSignedIn());
    } finally {
      running = undefined;
    }
  })();
  return running;
}

/**
 * Sync once changes have stopped for `delayMs`, but never later than
 * PUSH_MAX_WAIT_MS after the first change, so nonstop editing still reaches
 * the account without sending the whole plan after every autosave.
 */
function scheduleSync(delayMs = PUSH_DEBOUNCE_MS) {
  if (!isSignedIn()) {
    return;
  }
  const now = Date.now();
  pushDeadline ??= now + PUSH_MAX_WAIT_MS;
  const fireAt = Math.min(now + delayMs, pushDeadline);
  if (pushTimer !== undefined) {
    window.clearTimeout(pushTimer);
  }
  if (useLibrarySyncStore.getState().state !== "error") setStatus({ state: "pending" });
  pushTimer = window.setTimeout(flushScheduledSync, Math.max(0, fireAt - now));
}

function flushScheduledSync() {
  if (pushTimer !== undefined) {
    window.clearTimeout(pushTimer);
  }
  pushTimer = undefined;
  pushDeadline = undefined;
  void syncLibraryNow();
}

async function runOnce(): Promise<void> {
  setStatus({ state: "syncing" });
  try {
    await drainDeletions();
    const remote = await fetchRemoteLibrary();
    const [designs, folders] = await Promise.all([listDesignSummaries(), listDesignFolders()]);
    // Folders first, so a pulled design's folder exists when it lands.
    const folderActions = reconcileFolders(folders, remote.folders);
    for (const action of folderActions) {
      await applyFolderAction(action, folders);
    }
    const designActions = reconcileDesigns(designs, remote.designs);
    let touched = folderActions.length > 0;
    for (const action of designActions) {
      // A push held back or refused changed nothing here.
      if (await applyDesignAction(action)) {
        touched = true;
      }
    }
    if (touched) {
      await useDesignStore.getState().refreshLibrary();
    }
    // A refused design is still unsaved: say so rather than "saved".
    const refusal = designActions
      .map((action) => (action.kind === "push" ? refusedPushes.get(action.id) : undefined))
      .find(Boolean);
    if (refusal) {
      setStatus({ state: "error", refused: true, message: refusal.message });
      return;
    }
    setStatus({
      state: "idle",
      message: undefined,
      refused: undefined,
      lastSyncedAt: new Date().toISOString(),
    });
  } catch (error) {
    // A repaired schema, restored connection or renewed session must recover
    // without requiring the player to reload a page holding unsaved work.
    setStatus({
      state: "error",
      refused: undefined,
      message: error instanceof Error ? error.message : "Sync failed.",
    });
  }
}

async function drainDeletions(): Promise<void> {
  const pending = readPendingDeletes();
  for (const id of pending.designs) {
    await deleteRemoteDesign(id);
    forgetLibraryDeletion("design", id);
  }
  for (const id of pending.folders) {
    await deleteRemoteFolder(id);
    forgetLibraryDeletion("folder", id);
  }
}

async function applyFolderAction(action: FolderAction, local: DesignFolder[]): Promise<void> {
  switch (action.kind) {
    case "pull": {
      const existing = local.find((folder) => folder.id === action.id);
      await writeDesignFolder({
        ...existing,
        id: action.remote.id,
        name: action.remote.name,
        createdAt: action.remote.createdAt,
        updatedAt: action.remote.updatedAt,
        remoteUpdatedAt: action.remote.updatedAt,
      });
      return;
    }
    case "delete-local":
      await deleteDesignFolder(action.id);
      return;
    case "push": {
      const folder = local.find((entry) => entry.id === action.id);
      if (!folder) {
        return;
      }
      const updatedAt = folder.updatedAt ?? folder.createdAt;
      const result = await pushRemoteFolder(folder.id, {
        name: folder.name,
        createdAt: folder.createdAt,
        updatedAt,
      });
      if (result.behind) {
        // The account has a newer row; the next run pulls it.
        runAgain = true;
        return;
      }
      await writeDesignFolder({ ...folder, updatedAt, remoteUpdatedAt: result.folder.updatedAt });
    }
  }
}

/** Resolves to whether the local library changed. */
async function applyDesignAction(action: DesignAction): Promise<boolean> {
  const store = useDesignStore.getState();
  switch (action.kind) {
    case "pull-plan": {
      const { design, plan } = await fetchRemoteDesignPlan(action.id);
      const project = parseFactoryProjectJson(JSON.stringify(plan));
      const existing = await readDesign(action.id);
      await writeDesign({
        ...existing,
        ...remoteMetaToSummary(design),
        project: { ...project, name: design.name },
      });
      if (action.id === store.activeDesignId) {
        await store.reloadActiveDesign();
        setStatus({ reloadedActiveAt: new Date().toISOString() });
      }
      if (design.closed && action.id === store.activeDesignId) {
        await store.closeDesign(action.id);
      }
      return true;
    }
    case "pull-meta": {
      const existing = await readDesign(action.id);
      if (!existing) {
        return false;
      }
      const wasClosed = Boolean(existing.closed);
      await writeDesignSummary({
        ...existing,
        ...remoteMetaToSummary(action.remote),
        // The plan did not move: keep the local plan's own stamp and the
        // marks derived from it.
        updatedAt: existing.updatedAt,
        icon: existing.icon,
        communityPlanId: existing.communityPlanId,
      });
      if (action.id === store.activeDesignId) {
        if (action.remote.name !== existing.name) {
          await store.refreshLibrary();
          store.syncActiveName();
        }
        if (action.remote.closed && !wasClosed) {
          await store.refreshLibrary();
          await store.closeDesign(action.id);
        }
      }
      return true;
    }
    case "delete-local": {
      if (action.id === store.activeDesignId) {
        await store.removeDesign(action.id, { fromSync: true });
      } else {
        await deleteDesign(action.id);
        forgetDesignCameras([action.id]);
      }
      return true;
    }
    case "push": {
      const record = await readDesign(action.id);
      if (!record) {
        return false;
      }
      // The LATER of the two stamps, the same one `reconcileDesigns` calls
      // the local change time. Sending the metadata stamp alone when the
      // plan's was newer stored an older `updatedAt` than the edit, and the
      // design read as unsaved again on every poll: pushed forever.
      const updatedAt = latestStamp(record.metaUpdatedAt, record.updatedAt);
      if (refusedPushes.get(record.id)?.stamp === updatedAt) {
        return false;
      }
      let result: Awaited<ReturnType<typeof pushRemoteDesign>>;
      try {
        result = await pushRemoteDesign(record.id, {
          // The account takes 80 characters; a longer local name (old
          // stacked conflict copies) used to be refused on every edit.
          name: record.name.trim().slice(0, LIBRARY_DESIGN_NAME_MAX_LENGTH),
          icon: record.icon ?? null,
          folderId: record.folderId ?? null,
          closed: Boolean(record.closed),
          favorite: Boolean(record.favorite),
          order: record.order ?? null,
          communityPlanId: record.communityPlanId ?? null,
          createdAt: record.createdAt,
          updatedAt,
          planUpdatedAt: record.updatedAt,
          ...(action.withPlan ? { plan: record.project } : {}),
        });
      } catch (error) {
        if (!isRefusal(error)) {
          throw error;
        }
        refusedPushes.set(record.id, {
          stamp: updatedAt,
          message: `"${record.name}" is not saved to your account: ${error.message}`,
        });
        return false;
      }
      refusedPushes.delete(record.id);
      if (result.behind) {
        runAgain = true;
        return false;
      }
      // Re-read before stamping: autosave may have written since.
      const fresh = await readDesign(record.id);
      if (fresh) {
        await writeDesignSummary({
          ...toSummaryOf(fresh),
          remoteUpdatedAt: result.design.updatedAt,
        });
      }
      return true;
    }
  }
}

function toSummaryOf(record: DesignSummary & { project?: unknown }): DesignSummary {
  const summary: DesignSummary = { ...record };
  delete (summary as { project?: unknown }).project;
  return summary;
}

function remoteMetaToSummary(remote: RemoteDesignMeta): DesignSummary {
  const summary: DesignSummary = {
    id: remote.id,
    name: remote.name,
    createdAt: remote.createdAt,
    updatedAt: remote.planUpdatedAt,
    metaUpdatedAt: remote.updatedAt,
    remoteUpdatedAt: remote.updatedAt,
  };
  if (remote.icon) {
    summary.icon = remote.icon;
  }
  if (remote.folderId) {
    summary.folderId = remote.folderId;
  }
  if (remote.closed) {
    summary.closed = true;
  }
  if (remote.favorite) {
    summary.favorite = true;
  }
  if (remote.order !== null) {
    summary.order = remote.order;
  }
  if (remote.communityPlanId) {
    summary.communityPlanId = remote.communityPlanId;
  }
  return summary;
}

/* ------------------------------------------------------------------ */

/**
 * Wires the engine to the app: sign-in starts it, sign-out stops it, the
 * library's own changes push, and the tab coming back pulls. Returns the
 * teardown. Mounted once by the app shell.
 */
export function startLibrarySync(): () => void {
  let pollTimer: number | undefined;
  let lastUser: string | undefined;

  const onUser = () => {
    const user = useCommunityAuthStore.getState().user?.username;
    if (user === lastUser) {
      return;
    }
    lastUser = user;
    if (pollTimer !== undefined) {
      window.clearInterval(pollTimer);
      pollTimer = undefined;
    }
    if (!user) {
      setStatus({ state: "off", message: undefined, lastSyncedAt: undefined });
      return;
    }
    setStatus({ state: "pending", message: undefined, lastSyncedAt: undefined });
    void syncLibraryNow();
    // A tab in the background has nothing to show; coming back into view
    // syncs at once (below), so it skips the poll meanwhile.
    pollTimer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") {
        void syncLibraryNow();
      }
    }, POLL_MS);
  };
  onUser();
  const unsubscribeAuth = useCommunityAuthStore.subscribe(onUser);

  // The library changed here: push a few seconds after the last change.
  // A relist that changed nothing is not a change (libraryChangeSignature).
  let lastDesigns = useDesignStore.getState().designs;
  let lastFolders = useDesignStore.getState().folders;
  let lastSignature = libraryChangeSignature(lastDesigns, lastFolders);
  const unsubscribeDesigns = useDesignStore.subscribe((state) => {
    if (state.designs === lastDesigns && state.folders === lastFolders) {
      return;
    }
    lastDesigns = state.designs;
    lastFolders = state.folders;
    const signature = libraryChangeSignature(state.designs, state.folders);
    if (signature !== lastSignature) {
      lastSignature = signature;
      scheduleSync();
    }
  });
  const unsubscribeDeletes = subscribeToLibraryDeletions(() => scheduleSync(500));

  const onVisible = () => {
    if (document.visibilityState === "visible") {
      void syncLibraryNow();
    } else if (pushTimer !== undefined) {
      // Leaving the tab: send what is waiting rather than hold it back.
      flushScheduledSync();
    }
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  const onOnline = () => {
    void syncLibraryNow();
  };
  window.addEventListener("online", onOnline);

  return () => {
    unsubscribeAuth();
    unsubscribeDesigns();
    unsubscribeDeletes();
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
    window.removeEventListener("online", onOnline);
    if (pollTimer !== undefined) {
      window.clearInterval(pollTimer);
    }
    if (pushTimer !== undefined) {
      window.clearTimeout(pushTimer);
      pushTimer = undefined;
    }
    pushDeadline = undefined;
  };
}

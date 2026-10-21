"use client";

import { create } from "zustand";
import { createNewProject } from "@/examples";
import {
  UNTITLED_DESIGN_NAME,
  conflictCopyName,
  createDesign as createDesignRecord,
  createFolder as createFolderRecord,
  duplicateDesign as duplicateDesignRecord,
  makeUniqueDesignName,
  normalizeDesignName,
  normalizeFolderName,
  openDesigns,
  pickDesignAfterDelete,
  sortDesigns,
  sortFolders,
  stampDesignOrder,
  toDesignSummary,
  touchDesignMeta,
  updateDesignProject,
  type DesignFolder,
  type DesignRecord,
  type DesignSummary,
} from "@/lib/designs/design-library";
import {
  deleteDesign,
  deleteDesignFolder,
  listDesignFolders,
  listDesignSummaries,
  readActiveDesignId,
  readDesign,
  readDesignSummary,
  writeActiveDesignId,
  writeDesign as storeDesignRecord,
  writeDesignFolder,
  writeDesignIfUnchanged,
  replaceDesignIfUnchanged,
  writeDesignSummary,
} from "@/lib/designs/design-storage";
import {
  announceDesignSaved,
  isEditingInThisTab,
  subscribeDesignSaved,
} from "@/lib/designs/design-tab-sync";
import { subscribeBoardView } from "@/components/flow/board-view";
import { subscribeWorkspaceView } from "@/lib/workspace-view";

/**
 * Every write of a plan goes through here. A posted design's post is a copy:
 * nothing is pushed to it. Share's Update in library brings it up to date.
 */
async function writeDesign(record: DesignRecord): Promise<void> {
  await storeDesignRecord(record);
}
import {
  beginDesignCameraHandover,
  forgetDesignCameras,
  keepDesignCameras,
  readDesignCamera,
} from "@/lib/designs/design-camera";
import { computeDesignStats } from "@/lib/designs/design-stats";
import { normalizeLoadedProject } from "@/lib/model/project-normalize";
import { solveFreshBooks } from "./solve-books";
import { parseFactoryProjectJson } from "@/lib/import-export";
import { applyPlanView, capturePlanView } from "@/lib/plan-view";
import { noteLibraryDeletion } from "@/lib/library/library-deletes";
import { leaveLibrary, openLibrary } from "@/lib/library/library-tab";
import { leaveWelcomeTab } from "@/lib/welcome/welcome-tab";
import type { EntryIcon, FactoryProject } from "@/lib/model/types";
import { isLiveConfigured } from "@/lib/live/live-config";
import { LOCAL_STORAGE_KEY, useFactoryStore } from "./factory-store";
import { liveDesignIdInThisTab, isDesignOpenLive } from "./live-edit-gate";
import type { SharedPlanRef } from "@/lib/designs/design-library";

export type DesignSaveState = "idle" | "saving" | "saved" | "error";

const TASK_BOARD_NAME = "Task board";

type PublicView = { id: string; name: string; authorName?: string; project: FactoryProject };

interface DesignStore {
  publicView?: PublicView;
  publicViews: PublicView[];
  switchToPublicView: (id: string) => Promise<void>;
  viewPublicProject: (post: { id: string; name: string; authorName?: string }, project: FactoryProject) => Promise<void>;
  closePublicView: (id?: string) => Promise<void>;
  /** Every design on this device, open or closed, in strip order. */
  designs: DesignSummary[];
  /** The shelf's folders, by name. */
  folders: DesignFolder[];
  activeDesignId?: string;
  isHydrated: boolean;
  saveState: DesignSaveState;
  error?: string;
  hydrate: () => Promise<void>;
  /** Puts `id` on the canvas, and back on the strip if it was closed. */
  switchToDesign: (id: string, expectedFull?: string) => Promise<boolean>;
  addDesign: () => Promise<void>;
  /** A new design that opens on its task board (`primaryView: "tasks"`). */
  addTaskBoard: () => Promise<void>;
  /** Adds `project` as a new design tab and switches to it (community imports). */
  importProjectAsDesign: (project: FactoryProject, name: string) => Promise<void>;
  /** Explicitly replaces an imported version, retaining a recoverable backup. */
  replaceDesignFromImport: (
    id: string,
    project: FactoryProject,
    expectedFull: string,
    assertUnchangedCanvas?: () => void,
  ) => Promise<void>;
  flushActiveDesign: () => Promise<void>;
  /** Removes an unchanged incoming copy only while nobody is returning to it. */
  cleanupImportedDesign: (
    id: string,
    full: string,
    targetId: string,
    expected?: Pick<DesignSummary, "updatedAt" | "metaUpdatedAt">,
  ) => Promise<boolean>;
  /**
   * Opens a plan someone shared with this account: its local copy when this
   * device has one (`cloud`), else a new local copy of `project`. It then
   * opens live (live-session.ts) and the live plan replaces what the copy held.
   */
  openSharedDesign: (ref: SharedPlanRef, name: string, project?: FactoryProject) => Promise<boolean>;
  copyDesign: (id: string) => Promise<void>;
  renameDesign: (id: string, name: string) => Promise<void>;
  /**
   * Takes a design off the strip and leaves it on the shelf. Nothing is
   * deleted. Closing the last open tab lands on the shelf, since there is
   * no design left to show.
   */
  closeDesign: (id: string) => Promise<void>;
  /**
   * Close a run of tabs in one go (the menu's "close tabs to the right").
   * `keepActiveId` is the tab the menu was opened from, which always
   * survives, so the canvas lands there when the active design is among the
   * closed.
   */
  closeDesigns: (ids: string[], keepActiveId?: string) => Promise<void>;
  /**
   * Deletes the design for good. Its post on the network, if any, stays up.
   * `fromSync` means the account already knows: no tombstone is queued.
   */
  removeDesign: (id: string, options?: { fromSync?: boolean }) => Promise<void>;
  /** Relists designs and folders from storage (after sync wrote there). */
  refreshLibrary: () => Promise<void>;
  /** Puts the stored plan of the active design back on the canvas (sync pulled it). */
  reloadActiveDesign: () => Promise<void>;
  /** Realigns the canvas plan's name with the active design's (sync renamed it). */
  syncActiveName: () => void;
  /**
   * The library's edit form: name, description and icon, for any design,
   * open or not. The plan is rewritten (description and icon live on it),
   * and the canvas follows when it is the active one.
   */
  updateDesignIdentity: (
    id: string,
    patch: { name?: string; description?: string; icon?: EntryIcon | null },
  ) => Promise<void>;
  /**
   * Rearranges the strip to `orderedIds`, stamping each summary's `order`.
   * State updates first so the drop lands instantly; the writes follow.
   */
  reorderDesigns: (orderedIds: string[]) => Promise<void>;
  /** Stars or unstars a design (the Favorites collection). */
  toggleFavorite: (id: string) => Promise<void>;
  /** Files a design in a folder; `undefined` unfiles it. */
  moveDesignToFolder: (id: string, folderId: string | undefined) => Promise<void>;
  createFolder: (name: string) => Promise<DesignFolder>;
  renameFolder: (id: string, name: string) => Promise<void>;
  /** Removes the folder; the designs in it become unfiled, none are lost. */
  deleteFolder: (id: string) => Promise<void>;
  /**
   * Saves `project` into `designId`.
   *
   * The design is named rather than read from state at call time: autosave is
   * debounced, so a save scheduled just before a tab switch would otherwise
   * resolve against the newly-active design and write the previous tab's plan
   * over it. Naming the pair lets a stale save be dropped instead.
   */
  saveActiveProject: (designId: string | undefined, project: FactoryProject) => Promise<void>;
  /**
   * Set when this browser tab held edits to a design another tab had saved a
   * newer version of: the newer version stayed, and these edits went to a
   * copy (`copyName`). Shown until dismissed.
   */
  tabConflict?: { name: string; copyName: string };
  dismissTabConflict: () => void;
}

/**
 * Loads a plan onto the canvas without marking it edited, dressed the way that
 * plan was last left and pointed at whatever you were looking at on it.
 *
 * How a factory is DRAWN is part of the plan (it travels with a shared setup
 * too); see PlanViewScope for the line between the board's look (per plan)
 * and the workspace around it (per user). Where the CAMERA lands is
 * `design-camera.ts`: a tab visited before comes back where it was left, one
 * never visited is framed.
 */
function showProject(project: FactoryProject, designId?: string) {
  landingCanvas = true;
  try {
    useFactoryStore.getState().markHydratedProject(project);
    applyPlanView(project.view, "board", designId ? readDesignCamera(designId) : undefined);
  } finally {
    landingCanvas = false;
  }
  canvasPlanEdited = false;
  canvasViewEdited = false;
}

/*
 * WHICH VERSION THIS TAB IS HOLDING. Every browser tab keeps its open design
 * in memory and they all share one library, so a tab left open on an old copy
 * must never write it back over newer work saved from another tab.
 *
 * Each tab remembers the stored version its canvas was loaded from (the
 * record's `updatedAt`), and a save only lands if the stored plan is still
 * that version (`writeDesignIfUnchanged`: check and write in one
 * transaction). A tab only writes what it was EDITED into: a change counts
 * only while this tab has focus, because a background tab changes its plan
 * by itself (the recipe refresh after loading another tab's save) and must
 * never echo that back. A stale tab holding its own edits keeps them as a
 * conflict copy. Other tabs hear about every save (design-tab-sync.ts) and
 * reload when they have nothing of their own to keep.
 */

/** The stored version of the active design this tab's canvas started from. */
let canvasBase: { designId: string; updatedAt: string } | undefined;
/** The plan was edited in this tab since it last matched storage. */
let canvasPlanEdited = false;
/** Only the dressing (paper, ruling, worksheet layout) was changed here. */
let canvasViewEdited = false;
/** A plan is being put up: the changes that makes are not edits. */
let landingCanvas = false;
/** Detect edits and handovers across awaits, even when autosave clears dirty flags. */
let canvasRevision = 0;
let designNavigationRevision = 0;
let pendingDesignSwitches = 0;

/** Keep one guard from the player's update click through verification and handover. */
export function captureDesignUpdateGuard(): () => void {
  const revision = canvasRevision;
  const navigation = designNavigationRevision;
  const active = useDesignStore.getState().activeDesignId;
  return () => {
    if (
      canvasRevision !== revision ||
      designNavigationRevision !== navigation ||
      useDesignStore.getState().activeDesignId !== active ||
      pendingDesignSwitches > 0
    ) {
      throw new Error("The plan changed while updating. Try again.");
    }
  };
}

useFactoryStore.subscribe((state, previous) => {
  if (state.project !== previous.project) canvasRevision++;
  if (state.project !== previous.project && !landingCanvas && isEditingInThisTab()) {
    canvasPlanEdited = true;
  }
});
function noteViewEdit() {
  if (!landingCanvas && isEditingInThisTab()) {
    canvasRevision++;
    canvasViewEdited = true;
  }
}
subscribeBoardView(noteViewEdit);
subscribeWorkspaceView(noteViewEdit);

/**
 * Hand the canvas to another design: the store points at it, and its plan goes
 * up dressed and framed, or back where its camera was left.
 *
 * The handover is opened BEFORE the active id changes, because the board reports
 * camera moves it makes itself and the outgoing tab's last one can land after
 * the switch. See `design-camera.ts`.
 */
function landOnDesign(
  set: (partial: Partial<DesignStore>) => void,
  record: Pick<DesignRecord, "id" | "project" | "updatedAt">,
  rest?: Partial<DesignStore>,
) {
  designNavigationRevision++;
  beginDesignCameraHandover();
  useFactoryStore.getState().dismissPlanNotice();
  writeActiveDesignId(record.id);
  set({ ...rest, activeDesignId: record.id, publicView: undefined });
  showProject(record.project, record.id);
  canvasBase = { designId: record.id, updatedAt: record.updatedAt };
}

/**
 * No design on the canvas at all: every tab is closed. The plan that was up
 * stays where it is, covered by the shelf, and autosave has nothing to file
 * it under so it cannot be written anywhere.
 */
function landOnNothing(set: (partial: Partial<DesignStore>) => void, rest?: Partial<DesignStore>) {
  designNavigationRevision++;
  useFactoryStore.getState().dismissPlanNotice();
  writeActiveDesignId(undefined);
  set({ ...rest, activeDesignId: undefined });
  openLibrary();
}

function currentProject(): FactoryProject {
  return useFactoryStore.getState().project;
}

/**
 * The plan as it should be SAVED: what is on the canvas, plus how the canvas is
 * dressed right now.
 *
 * Stamped at the moment of writing rather than tracked as the settings change:
 * every path that persists a design comes through here, and the view is cheap
 * to read.
 */
function withCurrentView(project: FactoryProject): FactoryProject {
  return { ...project, view: capturePlanView() };
}

type PersistOutcome =
  | { outcome: "clean" | "written" | "stale" | "gone" }
  | { outcome: "copied"; copy: DesignRecord };

/**
 * ONE SAVE AT A TIME in this tab. A save checks the stored version against
 * `canvasBase` and moves `canvasBase` once its write lands, so two saves in
 * flight together would both check the same version and the second would
 * read the first as ANOTHER tab's save, minting a conflict copy. A big plan's
 * write can outlast the autosave debounce.
 */
let persistQueue: Promise<unknown> = Promise.resolve();

/**
 * Save the canvas into `summary`'s record, if this tab has anything of its
 * own to save and the stored plan is still the version it started from.
 * Queued behind any save already under way.
 *
 * - "clean": nothing was edited here; nothing is written.
 * - "written": saved, and the other tabs told.
 * - "copied": another tab saved a newer version first. That version stays,
 *   and this tab's edits are written as a new design, `copy`.
 * - "stale": another tab saved a newer version and this tab had only changed
 *   the dressing; nothing is written.
 * - "gone": by its turn the canvas had moved to another design (a save ahead
 *   of it kept a conflict copy, say); nothing is written.
 */
function persistCanvas(summary: DesignSummary, canvas: FactoryProject): Promise<PersistOutcome> {
  const turn = persistQueue.then(() => persistCanvasNow(summary, canvas));
  persistQueue = turn.catch(() => undefined);
  return turn;
}

/** The canvas last written as a live design's local copy. */
let lastLiveCopy: { designId: string; canvas: FactoryProject } | undefined;

async function persistCanvasNow(summary: DesignSummary, canvas: FactoryProject): Promise<PersistOutcome> {
  if (liveDesignIdInThisTab() === summary.id && canvasBase?.designId === summary.id) {
    return persistLiveCopy(summary, canvas);
  }
  if (!canvasPlanEdited && !canvasViewEdited) {
    return { outcome: "clean" };
  }
  // Never written without the version check: a save for a design the canvas
  // has left would otherwise go through unguarded.
  if (canvasBase?.designId !== summary.id) {
    return { outcome: "gone" };
  }
  // The strip's copy of the summary is fresher than the one captured when
  // this save was queued (a rename may have landed meanwhile).
  const current = useDesignStore.getState().designs.find((design) => design.id === summary.id) ?? summary;
  const project = withCurrentView(canvas);
  const record = withStats(updateDesignProject({ ...current, project }, project));
  const outcome = await writeDesignIfUnchanged(record, canvasBase.updatedAt);
  if (outcome === "written") {
    canvasBase = { designId: summary.id, updatedAt: record.updatedAt };
    if (currentProject() === canvas) {
      canvasPlanEdited = false;
      canvasViewEdited = false;
    }
    announceDesignSaved(summary.id, record.updatedAt);
    return { outcome: "written" };
  }
  if (!canvasPlanEdited) {
    canvasViewEdited = false;
    return { outcome: "stale" };
  }
  const { designs } = useDesignStore.getState();
  const copy: DesignRecord = {
    ...createDesignRecord(
      duplicateDesignRecord(record, []).project,
      conflictCopyName(
        current.name,
        designs.map((design) => design.name),
      ),
    ),
    folderId: current.folderId,
  };
  await writeDesign(copy);
  useDesignStore.setState({ tabConflict: { name: current.name, copyName: copy.name } });
  return { outcome: "copied", copy };
}

/**
 * A design open live is the live service's plan; the record here is this
 * device's copy of it, for opening offline and for the library's tile. Every
 * tab holding it converges through the service, so there is no version to
 * guard and no conflict copy: the canvas is written as it is, everyone's
 * edits in it. The sync stamps stay as they were, so the account sync never
 * sends this plan (live-session.ts writes it).
 */
async function persistLiveCopy(summary: DesignSummary, canvas: FactoryProject): Promise<PersistOutcome> {
  if (lastLiveCopy?.designId === summary.id && lastLiveCopy.canvas === canvas && !canvasViewEdited) {
    return { outcome: "clean" };
  }
  const current = useDesignStore.getState().designs.find((design) => design.id === summary.id) ?? summary;
  const project = withCurrentView(canvas);
  const record = withStats({ ...current, project: { ...project, name: current.name } });
  await writeDesign(record);
  lastLiveCopy = { designId: summary.id, canvas };
  if (currentProject() === canvas) {
    canvasPlanEdited = false;
    canvasViewEdited = false;
  }
  return { outcome: "written" };
}

/**
 * Writes whatever is on the canvas into `summary`'s record.
 *
 * Runs before every switch, copy and close: autosave is debounced, and
 * skipping this would drop the last edits of the design being left. Guarded
 * like every save (persistCanvas): a tab holding an old copy never writes it
 * back.
 */
async function flushCanvasInto(summary: DesignSummary | undefined): Promise<void> {
  const viewing = useDesignStore.getState().publicView;
  if (viewing) {
    const snapshot = { ...viewing, project: withCurrentView(currentProject()) };
    useDesignStore.setState((state) => ({ publicViews: state.publicViews.map((view) => view.id === viewing.id ? snapshot : view) }));
  }
  if (!summary || useFactoryStore.getState().isReadOnly) {
    return;
  }

  await persistCanvas(summary, currentProject());
}

/**
 * The tile's stat row, from the plan being written and the canvas's books
 * when the plan IS the canvas (EU/t needs a solve; the rest does not).
 */
function withStats(record: DesignRecord): DesignRecord {
  // Both callers write the ACTIVE design, whose books are the canvas's.
  const { lastResult } = useFactoryStore.getState();
  return { ...record, stats: computeDesignStats(record.project, lastResult ?? undefined) };
}

/** Still called Untitled, and nothing has been put on its board. */
function isBlankDesign(record: DesignRecord): boolean {
  const { project } = record;
  return (
    record.name === UNTITLED_DESIGN_NAME &&
    project.nodes.length === 0 &&
    (project.storages?.length ?? 0) === 0 &&
    (project.annotations?.length ?? 0) === 0 &&
    (project.pockets?.length ?? 0) === 0 &&
    (project.tasks?.length ?? 0) === 0
  );
}

async function listLibrary(): Promise<Pick<DesignStore, "designs" | "folders">> {
  const [designs, folders] = await Promise.all([listDesignSummaries(), listDesignFolders()]);
  return { designs: sortDesigns(designs), folders: sortFolders(folders) };
}

export const useDesignStore = create<DesignStore>((set, get) => ({
  publicViews: [],
  switchToPublicView: async (id) => {
    if (get().publicView?.id === id) { leaveWelcomeTab(); leaveLibrary(); return; }
    const view = get().publicViews.find((entry) => entry.id === id);
    if (view) await get().viewPublicProject(view, view.project);
  },
  closePublicView: async (id) => {
    const closingId = id ?? get().publicView?.id;
    if (!closingId) return;
    const remaining = get().publicViews.filter((view) => view.id !== closingId);
    const isActive = get().publicView?.id === closingId;
    set({ publicViews: remaining });
    if (!isActive) return;
    if (remaining.length) { await get().switchToPublicView(remaining[remaining.length - 1].id); return; }
    const remembered = readActiveDesignId();
    const target = get().designs.find((design) => design.id === remembered && !design.closed)
      ?? openDesigns(get().designs)[0];
    if (target) { await get().switchToDesign(target.id); return; }
    set({ publicView: undefined });
    showProject(createNewProject());
    landOnNothing(set);
  },
  viewPublicProject: async (post, project) => {
    const { activeDesignId, designs } = get();
    await flushCanvasInto(designs.find((design) => design.id === activeDesignId));
    beginDesignCameraHandover();
    // No design record is created, and autosave has no design to write into.
    const view = { id: post.id, name: post.name, authorName: post.authorName, project };
    set({ activeDesignId: undefined, publicView: view, publicViews: get().publicViews.some((entry) => entry.id === post.id) ? get().publicViews.map((entry) => entry.id === post.id ? view : entry) : [...get().publicViews, view] });
    useFactoryStore.getState().dismissPlanNotice();
    useFactoryStore.getState().loadViewedProject(project);
    applyPlanView(project.view, "board");
    leaveWelcomeTab();
    leaveLibrary();
  },
  designs: [],
  folders: [],
  activeDesignId: undefined,
  isHydrated: false,
  saveState: "idle",
  error: undefined,

  hydrate: async () => {
    if (typeof window !== "undefined" && "indexedDB" in window) {
      setTimeout(() => {
        void import("@/lib/designs/fingerprint-migration")
          .then((module) => module.ensurePlanFingerprintMigration())
          .then(() => get().refreshLibrary())
          .catch((error) => console.error("Plan fingerprint migration could not finish.", error));
      }, 0);
    }
    let summaries: DesignSummary[];
    let folders: DesignFolder[] = [];
    try {
      summaries = sortDesigns(await listDesignSummaries());

      if (summaries.length === 0) {
        summaries = [await seedFirstDesign()];
      } else {
        // NOT awaited: the pass reads every plan (many seconds on a big
        // library), and the strip must be usable meanwhile; the backfill
        // relists afterwards so designs added in that window are kept.
        scheduleSummaryBackfill();
      }
      folders = sortFolders(await listDesignFolders());
    } catch (error) {
      // A browser with IndexedDB blocked still gets a working canvas: it just
      // cannot keep anything beyond the session.
      set({
        isHydrated: true,
        error: error instanceof Error ? error.message : "Designs could not be loaded.",
      });
      return;
    }

    // Designs can also go away without this tab hearing about it, and a camera
    // for a plan nothing can open is dead weight.
    keepDesignCameras(summaries.map((design) => design.id));

    const remembered = readActiveDesignId();
    const rememberedDesign = summaries.find((design) => design.id === remembered);
    // A remembered design that is somehow closed is reopened rather than
    // second-guessed: it is what was on the canvas.
    if (rememberedDesign?.closed) {
      const reopened = touchDesignMeta({ ...rememberedDesign });
      delete reopened.closed;
      await writeDesignSummary(reopened);
      summaries = summaries.map((design) => (design.id === reopened.id ? reopened : design));
    }
    const activeId = rememberedDesign?.id ?? openDesigns(summaries)[0]?.id;

    if (!activeId) {
      // Every design is closed: the shelf is the only place to be.
      landOnNothing(set, { designs: summaries, folders, isHydrated: true });
      return;
    }

    // The strip is listed BEFORE the remembered design is opened, and that
    // opening is guarded on its own, so one plan tripping a load-time
    // migration cannot take every other tab down with it. A design whose plan
    // cannot be read lands NOWHERE: made active over an empty canvas, the
    // next autosave would write that emptiness over its record.
    try {
      const active = await readDesign(activeId);
      if (active) {
        landOnDesign(set, active, {
          designs: summaries,
          folders,
          isHydrated: true,
        });
      } else {
        set({
          designs: summaries,
          folders,
          isHydrated: true,
          error: "The last design you had open could not be read. Its record was left alone.",
        });
      }
    } catch (error) {
      console.error("The remembered design could not be opened; its record was left alone.", error);
      set({
        designs: summaries,
        folders,
        isHydrated: true,
        error: error instanceof Error ? error.message : "Design could not be opened.",
      });
    }
  },

  switchToDesign: async (id, expectedFull) => {
    const { activeDesignId, designs } = get();
    if (id === activeDesignId && expectedFull === undefined) {
      // Already on the canvas; the only thing left to do is show it.
      leaveLibrary();
      return true;
    }

    // Record intent before the first read, so cleanup cannot delete a tab a
    // player is opening while its canvas still belongs to another design.
    designNavigationRevision++;
    pendingDesignSwitches++;
    try {
      const revision = canvasRevision;
      const navigation = designNavigationRevision;
      const unchanged = () =>
        canvasRevision === revision &&
        designNavigationRevision === navigation &&
        get().activeDesignId === activeDesignId &&
        pendingDesignSwitches === 1;
      // An already-active exact match can have new, unsaved edits. Save those
      // before asking storage whether the arriving version still matches.
      if (expectedFull !== undefined) {
        await flushCanvasInto(designs.find((design) => design.id === activeDesignId));
        if (!unchanged()) return false;
      }
      const target = await readDesign(id, expectedFull);
      if (!target) {
        return false;
      }
      if (expectedFull !== undefined) {
        if (!unchanged()) return false;
      } else await flushCanvasInto(designs.find((design) => design.id === activeDesignId));
      if (
        id === activeDesignId &&
        canvasBase?.designId === id &&
        canvasBase.updatedAt === target.updatedAt
      ) {
        // Keep undo and view only for the stored version this canvas came from.
        // A newer record must land with its base or the next save can erase it.
        leaveLibrary();
        set(await listLibrary());
        return true;
      }
      if (target.closed) {
        // Opening from the shelf puts the design back on the strip, at the end.
        const reopened = touchDesignMeta(toDesignSummary(target));
        delete reopened.closed;
        await writeDesignSummary(reopened);
      }
      // Point the store at the new design *before* its plan reaches the canvas.
      // Autosave keys off the two together, so a canvas holding the new plan while
      // the store still names the old design is exactly the pairing that would
      // save one design's work into another.
      landOnDesign(set, target);
      leaveLibrary();
      set(await listLibrary());
      return true;
    } finally {
      pendingDesignSwitches--;
    }
  },

  addDesign: async () => {
    const { activeDesignId, designs } = get();
    await flushCanvasInto(designs.find((design) => design.id === activeDesignId));

    const record = createDesignRecord(createNewProject(), UNTITLED_DESIGN_NAME);
    await writeDesign(record);
    landOnDesign(set, record);
    leaveLibrary();
    set(await listLibrary());
  },

  addTaskBoard: async () => {
    const { activeDesignId, designs } = get();
    await flushCanvasInto(designs.find((design) => design.id === activeDesignId));

    const record = createDesignRecord(
      { ...createNewProject(), primaryView: "tasks" },
      makeUniqueDesignName(
        TASK_BOARD_NAME,
        designs.map((design) => design.name),
      ),
    );
    await writeDesign(record);
    landOnDesign(set, record);
    leaveWelcomeTab();
    leaveLibrary();
    set(await listLibrary());
  },

  flushActiveDesign: async () => {
    await flushCanvasInto(get().designs.find((design) => design.id === get().activeDesignId));
  },

  cleanupImportedDesign: async (id, full, targetId, expected) => {
    const revision = canvasRevision;
    const navigation = designNavigationRevision;
    const active = get().activeDesignId;
    const sourceMetaAt = get().designs.find((design) => design.id === id)?.metaUpdatedAt;
    const canCleanup = () =>
      get().activeDesignId !== id &&
      get().activeDesignId === active &&
      pendingDesignSwitches === 0 &&
      designNavigationRevision === navigation &&
      canvasRevision === revision &&
      get().designs.find((design) => design.id === id)?.metaUpdatedAt === sourceMetaAt &&
      !isDesignOpenLive(id) &&
      !isDesignOpenLive(targetId);
    if (!canCleanup()) return false;
    const record = await readDesign(id);
    if (!record || !canCleanup()) return false;
    if (
      expected &&
      (record.updatedAt !== expected.updatedAt || record.metaUpdatedAt !== expected.metaUpdatedAt)
    )
      return false;
    const { planFingerprints } = await import("@/lib/import-export/import-fingerprint");
    if ((await planFingerprints(record.project)).full !== full || !canCleanup()) return false;
    // Check navigation and edits inside the deletion transaction too: checking
    // before awaiting IndexedDB leaves a gap for unsaved work to appear.
    if (
      !(await deleteDesign(
        id,
        record.updatedAt,
        (stored) =>
          canCleanup() && stored?.metaUpdatedAt === record.metaUpdatedAt && !stored?.cloud,
      ))
    )
      return false;
    forgetDesignCameras([id]);
    noteLibraryDeletion("design", id);
    set(await listLibrary());
    return true;
  },

  replaceDesignFromImport: async (
    id,
    project,
    expectedFull,
    assertUnchangedCanvas = captureDesignUpdateGuard(),
  ) => {
    assertUnchangedCanvas();
    await get().flushActiveDesign();
    assertUnchangedCanvas();
    const target = await readDesign(id);
    assertUnchangedCanvas();
    if (!target) throw new Error("That saved plan was deleted. Keep the imported plan separately.");
    if (target.cloud || isDesignOpenLive(id)) {
      throw new Error(
        "A live or shared plan cannot be replaced here. Keep the imported plan separately.",
      );
    }
    const { planFingerprints } = await import("@/lib/import-export/import-fingerprint");
    if ((await planFingerprints(target.project)).full !== expectedFull) {
      throw new Error("That saved plan changed. Open the link again before updating it.");
    }
    assertUnchangedCanvas();
    const replacementProject = {
      ...project,
      name: target.name,
      metadata: { ...project.metadata, communityPlanId: target.project.metadata?.communityPlanId },
    };
    const statsProject = normalizeLoadedProject(replacementProject);
    // The canvas API may return another plan's stale books while its worker
    // runs. Persist only a completed solve of this exact replacement snapshot.
    const result = await solveFreshBooks(statsProject);
    assertUnchangedCanvas();
    if (isDesignOpenLive(id)) {
      throw new Error(
        "A live or shared plan cannot be replaced here. Keep the imported plan separately.",
      );
    }
    const liveReplacement =
      target.remoteUpdatedAt && isLiveConfigured()
        ? await (
            await import("./live-session")
          ).prepareImportedReplacement(id, normalizeLoadedProject(target.project), statsProject)
        : undefined;
    assertUnchangedCanvas();
    const backup = duplicateDesignRecord(
      target,
      get().designs.map((design) => design.name),
    );
    backup.name = makeUniqueDesignName(
      `${target.name} (before update)`,
      get().designs.map((design) => design.name),
    );
    backup.project = { ...backup.project, name: backup.name };
    backup.closed = true;
    backup.folderId = target.folderId;
    await writeDesign(backup);
    assertUnchangedCanvas();
    if (isDesignOpenLive(id)) {
      throw new Error(
        "A live or shared plan cannot be replaced here. Keep the imported plan separately.",
      );
    }
    const replacement = updateDesignProject(target, replacementProject);
    delete replacement.closed;
    replacement.stats = computeDesignStats(statsProject, result);
    // The outbox and replacement commit together. A crash or a failed write
    // to the live pending database cannot leave an undeliverable replacement.
    const outcome = await replaceDesignIfUnchanged(replacement, target, liveReplacement);
    if (outcome === "live") {
      throw new Error(
        "A live or shared plan cannot be replaced here. Keep the imported plan separately.",
      );
    }
    if (outcome === "missing") {
      throw new Error("That saved plan was deleted. Keep the imported plan separately.");
    }
    if (outcome !== "written") {
      throw new Error(
        "Another tab changed that saved plan. Your imported plan was kept separately.",
      );
    }
    announceDesignSaved(id, replacement.updatedAt);
    // A write may finish after a new edit. Keep that canvas and the incoming
    // design; a later save can preserve target edits through the conflict guard.
    assertUnchangedCanvas();
    if (isDesignOpenLive(id)) {
      throw new Error(
        "A live or shared plan cannot be replaced here. Keep the imported plan separately.",
      );
    }
    landOnDesign(set, replacement);
    leaveWelcomeTab();
    leaveLibrary();
    set(await listLibrary());
  },

  importProjectAsDesign: async (project, name) => {
    const { activeDesignId, designs } = get();
    await flushCanvasInto(designs.find((design) => design.id === activeDesignId));

    const record = createDesignRecord(project, name || UNTITLED_DESIGN_NAME);
    await writeDesign(record);
    landOnDesign(set, record);
    // A plan that arrives is a plan meant to be LOOKED at, whichever door it
    // came through: a shared link, the setup shelf beside the board, a lesson.
    // Leaving the greeting up would put it over the board it just landed on,
    // with the strip still naming Welcome as the tab you are on.
    leaveWelcomeTab();
    leaveLibrary();
    set(await listLibrary());
  },

  openSharedDesign: async (ref, name, project) => {
    const local = get().designs.find(
      (design) => design.cloud?.ownerId === ref.ownerId && design.cloud.designId === ref.designId,
    );
    if (local) {
      await get().switchToDesign(local.id);
      leaveWelcomeTab();
      return true;
    }
    if (!project) {
      return false;
    }
    const { activeDesignId, designs } = get();
    await flushCanvasInto(designs.find((design) => design.id === activeDesignId));
    const record: DesignRecord = {
      ...createDesignRecord(project, name || UNTITLED_DESIGN_NAME),
      id: sharedDesignLocalId(ref),
      cloud: ref,
    };
    await writeDesign(record);
    landOnDesign(set, record);
    leaveWelcomeTab();
    leaveLibrary();
    set(await listLibrary());
    return true;
  },

  copyDesign: async (id) => {
    const { activeDesignId, designs } = get();
    // Copying the tab you are editing has to copy what is on screen, not the
    // last debounced write, so the canvas is flushed first either way.
    await flushCanvasInto(designs.find((design) => design.id === activeDesignId));

    const source = await readDesign(id);
    if (!source) {
      return;
    }

    const copy: DesignRecord = {
      ...duplicateDesignRecord(
        source,
        designs.map((design) => design.name),
      ),
      // The copy is filed beside its original, and it opens: a copy you
      // asked for is a copy you want to look at.
      folderId: source.folderId,
    };
    await writeDesign(copy);
    landOnDesign(set, copy);
    leaveLibrary();
    set(await listLibrary());
  },

  renameDesign: async (id, name) => {
    const summary = get().designs.find((design) => design.id === id);
    if (!summary) {
      return;
    }

    // A rename is metadata: `metaUpdatedAt` moves and `updatedAt` (the plan's
    // own stamp) does not, so sync sends the name without the plan.
    const renamed: DesignSummary = touchDesignMeta({
      ...summary,
      name: normalizeDesignName(name),
    });

    // Only the metadata is rewritten: the stored plan can be megabytes, and a
    // rename does not touch it. The plan's own `name` field, which the JSON
    // export uses for its filename, is realigned through the canvas below and
    // saved by the autosave that follows.
    await writeDesignSummary(renamed);

    if (id === get().activeDesignId) {
      useFactoryStore.getState().renameProject(renamed.name);
    }

    set(await listLibrary());
  },

  closeDesign: async (id) => {
    await get().closeDesigns([id]);
  },

  closeDesigns: async (ids, keepActiveId) => {
    const doomed = new Set(ids);
    doomed.delete(keepActiveId ?? "");
    const { designs, activeDesignId } = get();
    const closing = designs.filter((design) => doomed.has(design.id) && !design.closed);
    if (closing.length === 0) {
      return;
    }

    // The tab being closed may be the one on the canvas, with edits autosave
    // has not written yet. Those go into its record before it leaves.
    await flushCanvasInto(closing.find((design) => design.id === activeDesignId));
    const nextActiveId =
      activeDesignId && doomed.has(activeDesignId)
        ? (keepActiveId ?? pickDesignAfterDelete(openDesigns(designs), activeDesignId))
        : undefined;

    for (const design of closing) {
      // A tab nobody touched (still Untitled, nothing on the board) is not
      // work, and a library full of blank "Untitled design" tiles is noise.
      // Closing one throws it away instead of keeping it.
      const record = await readDesign(design.id);
      if (record && isBlankDesign(record)) {
        await deleteDesign(design.id);
        forgetDesignCameras([design.id]);
        if (record.remoteUpdatedAt && !record.cloud) {
          noteLibraryDeletion("design", design.id);
        }
        continue;
      }
      await writeDesignSummary(touchDesignMeta({ ...design, closed: true }));
    }
    const library = await listLibrary();

    if (!activeDesignId || !doomed.has(activeDesignId)) {
      // The canvas is showing a design that survived, so it stays put.
      set(library);
      return;
    }

    const nextOpen = nextActiveId
      ? library.designs.find((design) => design.id === nextActiveId && !design.closed)
      : undefined;
    if (!nextOpen) {
      landOnNothing(set, library);
      return;
    }

    const next = await readDesign(nextOpen.id);
    if (next) {
      landOnDesign(set, next, library);
    } else {
      // Unreadable: listed, never made active over an empty canvas.
      set({ ...library, activeDesignId: undefined });
    }
  },

  removeDesign: async (id, options) => {
    const { designs, activeDesignId } = get();
    const nextActiveId = pickDesignAfterDelete(openDesigns(designs), id);
    // A shared plan's copy is this device's alone: the account has nothing to delete.
    const sharedCopy = Boolean(designs.find((design) => design.id === id)?.cloud);

    await deleteDesign(id);
    forgetDesignCameras([id]);
    if (!options?.fromSync && !sharedCopy) {
      // The account hears about it as a tombstone on the next push.
      noteLibraryDeletion("design", id);
    }
    let library = await listLibrary();

    if (library.designs.length === 0) {
      // A library with nothing in it is seeded rather than shown empty: the
      // canvas has to belong to some record for autosave to have a home.
      const seeded = createDesignRecord(createNewProject(), UNTITLED_DESIGN_NAME);
      await writeDesign(seeded);
      library = { ...library, designs: [seeded] };
      landOnDesign(set, seeded, library);
      return;
    }

    if (id !== activeDesignId) {
      set(library);
      return;
    }

    if (!nextActiveId) {
      landOnNothing(set, library);
      return;
    }

    const next = await readDesign(nextActiveId);
    if (next) {
      landOnDesign(set, next, library);
    } else {
      // Unreadable: listed, never made active over an empty canvas.
      set({ ...library, activeDesignId: undefined });
    }
  },

  reorderDesigns: async (orderedIds) => {
    const before = new Map(get().designs.map((design) => [design.id, design.order]));
    const stamped = stampDesignOrder(get().designs, orderedIds).map((summary) =>
      // Only the designs whose place actually changed are marked for sync:
      // a drag of one tab must not push every plan's metadata.
      before.get(summary.id) === summary.order ? summary : touchDesignMeta(summary),
    );
    set({ designs: stamped });
    for (const summary of stamped) {
      await writeDesignSummary(summary);
    }
  },

  toggleFavorite: async (id) => {
    const summary = get().designs.find((design) => design.id === id);
    if (!summary) {
      return;
    }
    const starred: DesignSummary = touchDesignMeta({ ...summary });
    if (summary.favorite) {
      delete starred.favorite;
    } else {
      starred.favorite = true;
    }
    set({ designs: get().designs.map((design) => (design.id === id ? starred : design)) });
    await writeDesignSummary(starred);
  },

  moveDesignToFolder: async (id, folderId) => {
    const summary = get().designs.find((design) => design.id === id);
    if (!summary || summary.folderId === folderId) {
      return;
    }
    const moved: DesignSummary = touchDesignMeta({ ...summary });
    if (folderId) {
      moved.folderId = folderId;
    } else {
      delete moved.folderId;
    }
    // State first so the tile lands in its new section on the same click.
    set({ designs: get().designs.map((design) => (design.id === id ? moved : design)) });
    await writeDesignSummary(moved);
  },

  createFolder: async (name) => {
    const folder = createFolderRecord(name);
    await writeDesignFolder(folder);
    set({ folders: sortFolders([...get().folders, folder]) });
    return folder;
  },

  renameFolder: async (id, name) => {
    const folder = get().folders.find((entry) => entry.id === id);
    if (!folder) {
      return;
    }
    const renamed: DesignFolder = {
      ...folder,
      name: normalizeFolderName(name),
      updatedAt: new Date().toISOString(),
    };
    await writeDesignFolder(renamed);
    set({
      folders: sortFolders(get().folders.map((entry) => (entry.id === id ? renamed : entry))),
    });
  },

  deleteFolder: async (id) => {
    const { designs, folders } = get();
    const unfiled: DesignSummary[] = [];
    const next = designs.map((design) => {
      if (design.folderId !== id) {
        return design;
      }
      const moved = touchDesignMeta({ ...design });
      delete moved.folderId;
      unfiled.push(moved);
      return moved;
    });
    set({ designs: next, folders: folders.filter((folder) => folder.id !== id) });
    for (const design of unfiled) {
      await writeDesignSummary(design);
    }
    await deleteDesignFolder(id);
    noteLibraryDeletion("folder", id);
  },

  refreshLibrary: async () => {
    set(await listLibrary());
  },

  reloadActiveDesign: async () => {
    const { activeDesignId } = get();
    if (!activeDesignId) {
      return;
    }
    const record = await readDesign(activeDesignId);
    if (record) {
      // Same landing as a switch, so the camera and the dressing come back
      // as they were; the plan underneath is the account's newer one.
      landOnDesign(set, record);
    }
  },

  syncActiveName: () => {
    const { activeDesignId, designs } = get();
    const active = designs.find((design) => design.id === activeDesignId);
    if (active) {
      useFactoryStore.getState().renameProject(active.name);
    }
  },

  updateDesignIdentity: async (id, patch) => {
    if (patch.name !== undefined) {
      await get().renameDesign(id, patch.name);
    }
    if (patch.description === undefined && patch.icon === undefined) {
      return;
    }
    if (id === get().activeDesignId) {
      // The canvas is the source of truth for the active design; autosave
      // writes it through.
      useFactoryStore.getState().setProjectIdentity({
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
      });
      return;
    }
    const record = await readDesign(id);
    if (!record) {
      return;
    }
    const project = { ...record.project };
    if (patch.description !== undefined) {
      project.description = patch.description;
    }
    if (patch.icon !== undefined) {
      if (patch.icon) {
        project.icon = patch.icon;
      } else {
        delete project.icon;
      }
    }
    await writeDesign(withStats(updateDesignProject({ ...record, project }, project)));
    set(await listLibrary());
  },

  saveActiveProject: async (designId, project) => {
    const { activeDesignId, designs } = get();
    if (!designId || designId !== activeDesignId || useFactoryStore.getState().isReadOnly) {
      return;
    }

    const summary = designs.find((design) => design.id === designId);
    if (!summary) {
      return;
    }

    set({ saveState: "saving" });
    try {
      const result = await persistCanvas(summary, project);
      if (result.outcome === "copied" && get().activeDesignId === designId) {
        // This tab's work carries on, under the copy's name: the canvas is
        // already the copy, so it stays exactly as it is, camera and all.
        writeActiveDesignId(result.copy.id);
        canvasBase = { designId: result.copy.id, updatedAt: result.copy.updatedAt };
        canvasPlanEdited = currentProject() !== project;
        set({ activeDesignId: result.copy.id });
        useFactoryStore.getState().renameProject(result.copy.name);
      }
      set({ saveState: "saved", designs: sortDesigns(await listDesignSummaries()) });
    } catch (error) {
      set({
        saveState: "error",
        error: error instanceof Error ? error.message : "Design could not be saved.",
      });
    }
  },

  dismissTabConflict: () => set({ tabConflict: undefined }),
}));

/**
 * Keeps this browser tab's open design current with the other tabs (see the
 * note on canvasBase). When the stored plan has moved past the version on
 * this canvas and this tab has no edits of its own, the stored one is loaded.
 *
 * Checked when another tab announces a save, but only while this tab is
 * VISIBLE (two windows side by side): a hidden tab would otherwise reload and
 * re-solve the whole plan on every autosave the other tab makes. A hidden tab
 * checks the moment it comes back into view instead, which also covers a
 * save it never heard (the account sync, a frozen tab). Returns the teardown.
 */
export function startDesignTabSync(): () => void {
  let checking = false;
  const checkActive = async () => {
    const { activeDesignId, publicView, isHydrated } = useDesignStore.getState();
    if (checking || !activeDesignId || publicView || !isHydrated) {
      return;
    }
    if (liveDesignIdInThisTab() === activeDesignId) {
      // Live: other tabs' edits arrive through the live service, not storage.
      useDesignStore.setState({ designs: sortDesigns(await listDesignSummaries()) });
      return;
    }
    checking = true;
    try {
      const stored = await readDesignSummary(activeDesignId);
      const store = useDesignStore.getState();
      if (
        stored &&
        store.activeDesignId === activeDesignId &&
        canvasBase?.designId === activeDesignId &&
        stored.updatedAt !== canvasBase.updatedAt &&
        !canvasPlanEdited
      ) {
        await store.reloadActiveDesign();
      }
      // Names, order and closed tabs may have moved too.
      useDesignStore.setState({ designs: sortDesigns(await listDesignSummaries()) });
    } finally {
      checking = false;
    }
  };
  const isVisible = () => document.visibilityState === "visible";
  const unsubscribe = subscribeDesignSaved(() => {
    if (isVisible()) {
      void checkActive();
    }
  });
  const onVisible = () => {
    if (isVisible()) {
      void checkActive();
    }
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  return () => {
    unsubscribe();
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
  };
}

/**
 * Summaries written before they carried an icon get none until their plan is
 * saved again. Once per browser, every plan is read and its summary
 * restamped; new writes keep it fresh from then on. The same pass, under a
 * second key, stamps the post link and the stat row for the library's tiles.
 */
const ICON_BACKFILL_KEY = "gtnh-factory-flow.design-summary-icons.v1";
// v2: the stat row joined the pass.
const POST_BACKFILL_KEY = "gtnh-factory-flow.design-summary-posts.v2";

/**
 * Runs the backfill once the library is hydrated, in the background, and
 * relists the strip when it is done. Anything added meanwhile is in the
 * relist too, so nothing the player did during the pass is lost.
 */
function scheduleSummaryBackfill(): void {
  const run = () => {
    void backfillSummaryIcons(useDesignStore.getState().designs).then((relisted) => {
      if (relisted) {
        useDesignStore.setState({ designs: relisted });
      }
    });
  };
  if (useDesignStore.getState().isHydrated) {
    run();
    return;
  }
  const unsubscribe = useDesignStore.subscribe((state) => {
    if (state.isHydrated) {
      unsubscribe();
      run();
    }
  });
}

/** Resolves to the relisted strip, or undefined when there was nothing to do. */
async function backfillSummaryIcons(
  summaries: DesignSummary[],
): Promise<DesignSummary[] | undefined> {
  try {
    if (
      window.localStorage.getItem(ICON_BACKFILL_KEY) &&
      window.localStorage.getItem(POST_BACKFILL_KEY)
    ) {
      return undefined;
    }
  } catch {
    // No localStorage means no way to remember the pass ran; skip it rather
    // than reread every plan on every load.
    return undefined;
  }

  for (const summary of summaries) {
    const record = await readDesign(summary.id);
    if (!record) {
      continue;
    }
    // Every design gets its stat row (no EU/t without a solve); the icon
    // and post fields come along for the ones that have them.
    await writeDesignSummary(
      toDesignSummary({ ...record, stats: record.stats ?? computeDesignStats(record.project) }),
    );
  }

  try {
    window.localStorage.setItem(ICON_BACKFILL_KEY, "done");
    window.localStorage.setItem(POST_BACKFILL_KEY, "done");
  } catch {
    // A failed flag just means the pass runs again next load.
  }
  return sortDesigns(await listDesignSummaries());
}

/**
 * First run: adopt the legacy single-plan localStorage key (`LOCAL_STORAGE_KEY`)
 * as the first tab. The key is read, never cleared, so the original survives
 * if anything here goes wrong.
 */
async function seedFirstDesign(): Promise<DesignSummary> {
  const legacy = readLegacyProject();
  const record = createDesignRecord(
    legacy ?? createNewProject(),
    legacy?.name ?? UNTITLED_DESIGN_NAME,
  );
  await writeDesign(record);
  return record;
}

function readLegacyProject(): FactoryProject | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    return stored ? parseFactoryProjectJson(stored) : undefined;
  } catch {
    return undefined;
  }
}

/** The local id of a shared plan's copy: never one of our own design ids. */
export function sharedDesignLocalId(ref: Pick<SharedPlanRef, "ownerId" | "designId">): string {
  return `shared-${ref.ownerId}-${ref.designId}`;
}

export type { DesignFolder, DesignRecord, DesignSummary };

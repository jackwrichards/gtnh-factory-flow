"use client";

import { create } from "zustand";
import { createEmptyProject } from "@/examples";
import {
  UNTITLED_DESIGN_NAME,
  createDesign as createDesignRecord,
  createFolder as createFolderRecord,
  duplicateDesign as duplicateDesignRecord,
  normalizeDesignName,
  normalizeFolderName,
  openDesigns,
  pickDesignAfterDelete,
  sortDesigns,
  sortFolders,
  stampDesignOrder,
  toDesignSummary,
  makeUniqueDesignName,
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
  writeDesignSummary,
} from "@/lib/designs/design-storage";
import {
  announceDesignSaved,
  isEditingInThisTab,
  subscribeDesignSaved,
} from "@/lib/designs/design-tab-sync";
import { subscribeBoardView } from "@/components/flow/board-view";
import { subscribeWorkspaceView } from "@/lib/workspace-view";
import { flushPostFollow, schedulePostFollow } from "@/lib/community/post-follow";

/**
 * Every write of a plan goes through here so a posted design's post can
 * follow it: the push is debounced in post-follow.ts and costs nothing for
 * a design with no link. Summary-only writes (rename, star, folder) do not
 * come this way; a rename reaches the post with the next plan save.
 */
async function writeDesign(record: DesignRecord): Promise<void> {
  await storeDesignRecord(record);
  schedulePostFollow(record.id, Boolean(record.project.metadata?.communityPlanId));
}
import {
  beginDesignCameraHandover,
  forgetDesignCameras,
  keepDesignCameras,
  readDesignCamera,
} from "@/lib/designs/design-camera";
import { computeDesignStats } from "@/lib/designs/design-stats";
import { parseFactoryProjectJson } from "@/lib/import-export";
import { applyPlanView, capturePlanView } from "@/lib/plan-view";
import { noteLibraryDeletion } from "@/lib/library/library-deletes";
import { leaveLibrary, openLibrary } from "@/lib/library/library-tab";
import { leaveWelcomeTab } from "@/lib/welcome/welcome-tab";
import type { EntryIcon, FactoryProject } from "@/lib/model/types";
import { LOCAL_STORAGE_KEY, useFactoryStore } from "./factory-store";

export type DesignSaveState = "idle" | "saving" | "saved" | "error";

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
  switchToDesign: (id: string) => Promise<void>;
  addDesign: () => Promise<void>;
  /** Adds `project` as a new design tab and switches to it (community imports). */
  importProjectAsDesign: (project: FactoryProject, name: string) => Promise<void>;
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
 * A tab is a whole factory, and how a factory is DRAWN is part of it: one build
 * wants rate labels and fat lines, the next wants a clean board. Sharing a
 * setup has always carried those settings along with it, so a tab not carrying
 * them between switches was the odd one out. See PlanViewScope for the line
 * between the board's look (per plan) and the workspace around it (yours).
 *
 * Where the CAMERA lands is `design-camera.ts`: a tab you have been on before
 * comes back up exactly where you left it, and one you have not is framed, which
 * is what every tab used to get. Framing a tab you know your way around means
 * scrolling back to the corner you were working in every single time.
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
 * WHICH VERSION THIS TAB IS HOLDING (Jack, 2026-09-23: a player lost hours to
 * a second browser tab). Every browser tab keeps its open design in memory,
 * and they all share one library. A tab left open on this morning's copy used
 * to write that copy back over a whole afternoon's work saved from another
 * tab, the next time it saved anything at all.
 *
 * So each tab remembers the stored version its canvas was loaded from (the
 * record's `updatedAt`), and a save only lands if the stored plan is still
 * that version (`writeDesignIfUnchanged`: the check and the write are one
 * transaction). A tab also only writes what it was EDITED into: a change
 * counts only if it happened while this tab had focus, because a tab in the
 * background changes its plan by itself (the recipe refresh after loading
 * another tab's save) and must never echo that back. When a stale tab truly
 * holds edits of its own, they are kept as a copy rather than lost either
 * way. The other tabs hear about every save (design-tab-sync.ts) and reload
 * when they have nothing of their own to keep, and a tab coming back into
 * view checks too.
 */

/** The stored version of the active design this tab's canvas started from. */
let canvasBase: { designId: string; updatedAt: string } | undefined;
/** The plan was edited in this tab since it last matched storage. */
let canvasPlanEdited = false;
/** Only the dressing (paper, ruling, worksheet layout) was changed here. */
let canvasViewEdited = false;
/** A plan is being put up: the changes that makes are not edits. */
let landingCanvas = false;

useFactoryStore.subscribe((state, previous) => {
  if (state.project !== previous.project && !landingCanvas && isEditingInThisTab()) {
    canvasPlanEdited = true;
  }
});
function noteViewEdit() {
  if (!landingCanvas && isEditingInThisTab()) {
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
  beginDesignCameraHandover();
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
  | { outcome: "clean" | "written" | "stale" }
  | { outcome: "copied"; copy: DesignRecord };

/**
 * Save the canvas into `summary`'s record, if this tab has anything of its
 * own to save and the stored plan is still the version it started from.
 *
 * - "clean": nothing was edited here; nothing is written.
 * - "written": saved, and the other tabs told.
 * - "copied": another tab saved a newer version first. That version stays,
 *   and this tab's edits are written as a new design, `copy`.
 * - "stale": another tab saved a newer version and this tab had only changed
 *   the dressing; nothing is written.
 */
async function persistCanvas(summary: DesignSummary, canvas: FactoryProject): Promise<PersistOutcome> {
  if (!canvasPlanEdited && !canvasViewEdited) {
    return { outcome: "clean" };
  }
  const project = withCurrentView(canvas);
  const record = withStats(updateDesignProject({ ...summary, project }, project));
  const expected = canvasBase?.designId === summary.id ? canvasBase.updatedAt : undefined;
  const outcome = await writeDesignIfUnchanged(record, expected);
  if (outcome === "written") {
    schedulePostFollow(record.id, Boolean(record.project.metadata?.communityPlanId));
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
      makeUniqueDesignName(
        `${summary.name} (conflict copy)`,
        designs.map((design) => design.name),
      ),
    ),
    folderId: summary.folderId,
  };
  await writeDesign(copy);
  useDesignStore.setState({ tabConflict: { name: summary.name, copyName: copy.name } });
  return { outcome: "copied", copy };
}

/**
 * Writes whatever is on the canvas into `summary`'s record.
 *
 * Runs before every switch, copy and close: autosave is debounced, and those
 * actions land inside that window often enough that skipping this would quietly
 * drop the last few edits of the design being left behind. Guarded like every
 * save (persistCanvas): a tab holding an old copy never writes it back.
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

  const { outcome } = await persistCanvas(summary, currentProject());
  if (outcome === "written") {
    // The design is leaving the canvas: no autosave will follow, so the post
    // takes this version now rather than after the debounce.
    flushPostFollow(summary.id);
  }
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
    (project.pockets?.length ?? 0) === 0
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
    showProject(createEmptyProject());
    landOnNothing(set);
  },
  viewPublicProject: async (post, project) => {
    const { activeDesignId, designs } = get();
    await flushCanvasInto(designs.find((design) => design.id === activeDesignId));
    beginDesignCameraHandover();
    // No design record is created, and autosave has no design to write into.
    const view = { id: post.id, name: post.name, authorName: post.authorName, project };
    set({ activeDesignId: undefined, publicView: view, publicViews: get().publicViews.some((entry) => entry.id === post.id) ? get().publicViews.map((entry) => entry.id === post.id ? view : entry) : [...get().publicViews, view] });
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
    let summaries: DesignSummary[];
    let folders: DesignFolder[] = [];
    try {
      summaries = sortDesigns(await listDesignSummaries());

      if (summaries.length === 0) {
        summaries = [await seedFirstDesign()];
      } else {
        // NOT awaited: the pass reads every plan, which on a big library is
        // many seconds, and the strip must not sit as a placeholder for it.
        // A New design pressed in that window used to open a canvas the
        // strip could not list, and then be stamped over when this landed.
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

    // The strip is listed BEFORE the remembered design is opened, and its
    // opening is guarded on its own: a plan saved by an older version that
    // trips a load-time migration used to take every other tab down with it
    // (issue #45, "all my plans disappeared"), when nothing but that one plan
    // was ever at fault. And a design whose plan cannot be read lands NOWHERE:
    // making it active over an empty canvas let the next autosave write that
    // emptiness over the record, which is the one way to really lose a plan.
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

  switchToDesign: async (id) => {
    const { activeDesignId, designs } = get();
    if (id === activeDesignId) {
      // Already on the canvas; the only thing left to do is show it.
      leaveLibrary();
      return;
    }

    const target = await readDesign(id);
    if (!target) {
      return;
    }

    await flushCanvasInto(designs.find((design) => design.id === activeDesignId));
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
  },

  addDesign: async () => {
    const { activeDesignId, designs } = get();
    await flushCanvasInto(designs.find((design) => design.id === activeDesignId));

    const record = createDesignRecord(createEmptyProject(), UNTITLED_DESIGN_NAME);
    await writeDesign(record);
    landOnDesign(set, record);
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
        if (record.remoteUpdatedAt) {
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

    await deleteDesign(id);
    forgetDesignCameras([id]);
    if (!options?.fromSync) {
      // The account hears about it as a tombstone on the next push.
      noteLibraryDeletion("design", id);
    }
    let library = await listLibrary();

    if (library.designs.length === 0) {
      // A library with nothing in it is seeded rather than shown empty: the
      // canvas has to belong to some record for autosave to have a home.
      const seeded = createDesignRecord(createEmptyProject(), UNTITLED_DESIGN_NAME);
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
 * Summaries written before they carried an icon never get one until their plan
 * happens to be saved again, so tabs would sit blank for exactly the designs
 * that have been around longest. Once per browser, every plan is read and its
 * summary restamped; new writes keep the copy fresh from then on.
 *
 * The same pass, under a second key, stamps the post link and the stat row
 * onto every summary for the library's tiles.
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
 * First run: adopt the plan the app used to keep under a single localStorage
 * key, so existing work becomes the first tab instead of being stranded behind a
 * storage change. The old key is read, never cleared: if anything here goes
 * wrong the original is still sitting where it was.
 */
async function seedFirstDesign(): Promise<DesignSummary> {
  const legacy = readLegacyProject();
  const record = createDesignRecord(
    legacy ?? createEmptyProject(),
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

export type { DesignFolder, DesignRecord, DesignSummary };

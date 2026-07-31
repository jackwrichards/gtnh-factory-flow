"use client";

import { create } from "zustand";
import { createEmptyProject } from "@/examples";
import {
  UNTITLED_DESIGN_NAME,
  createDesign as createDesignRecord,
  duplicateDesign as duplicateDesignRecord,
  normalizeDesignName,
  pickDesignAfterDelete,
  sortDesigns,
  updateDesignProject,
  type DesignRecord,
  type DesignSummary,
} from "@/lib/designs/design-library";
import {
  deleteDesign,
  listDesignSummaries,
  readActiveDesignId,
  readDesign,
  writeActiveDesignId,
  writeDesign,
  writeDesignSummary,
} from "@/lib/designs/design-storage";
import { parseFactoryProjectJson } from "@/lib/import-export";
import type { FactoryProject } from "@/lib/model/types";
import { LOCAL_STORAGE_KEY, useFactoryStore } from "./factory-store";

export type DesignSaveState = "idle" | "saving" | "saved" | "error";

interface DesignStore {
  designs: DesignSummary[];
  activeDesignId?: string;
  isHydrated: boolean;
  saveState: DesignSaveState;
  error?: string;
  hydrate: () => Promise<void>;
  switchToDesign: (id: string) => Promise<void>;
  addDesign: () => Promise<void>;
  /** Adds `project` as a new design tab and switches to it (community imports). */
  importProjectAsDesign: (project: FactoryProject, name: string) => Promise<void>;
  copyDesign: (id: string) => Promise<void>;
  renameDesign: (id: string, name: string) => Promise<void>;
  removeDesign: (id: string) => Promise<void>;
  /**
   * Saves `project` into `designId`.
   *
   * The design is named rather than read from state at call time: autosave is
   * debounced, so a save scheduled just before a tab switch would otherwise
   * resolve against the newly-active design and write the previous tab's plan
   * over it. Naming the pair lets a stale save be dropped instead.
   */
  saveActiveProject: (designId: string | undefined, project: FactoryProject) => Promise<void>;
}

/** Loads a plan onto the canvas without marking it edited. */
function showProject(project: FactoryProject) {
  useFactoryStore.getState().markHydratedProject(project);
}

function currentProject(): FactoryProject {
  return useFactoryStore.getState().project;
}

/**
 * Writes whatever is on the canvas into `summary`'s record.
 *
 * Runs before every switch, copy and delete: autosave is debounced, and those
 * actions land inside that window often enough that skipping this would quietly
 * drop the last few edits of the design being left behind.
 */
async function flushCanvasInto(summary: DesignSummary | undefined): Promise<void> {
  if (!summary) {
    return;
  }

  const project = currentProject();
  await writeDesign(updateDesignProject({ ...summary, project }, project));
}

export const useDesignStore = create<DesignStore>((set, get) => ({
  designs: [],
  activeDesignId: undefined,
  isHydrated: false,
  saveState: "idle",
  error: undefined,

  hydrate: async () => {
    try {
      let summaries = sortDesigns(await listDesignSummaries());

      if (summaries.length === 0) {
        summaries = [await seedFirstDesign()];
      }

      const remembered = readActiveDesignId();
      const activeId = summaries.some((design) => design.id === remembered)
        ? remembered
        : summaries[0].id;

      const active = activeId ? await readDesign(activeId) : undefined;

      writeActiveDesignId(activeId);
      set({ designs: summaries, activeDesignId: activeId, isHydrated: true });
      if (active) {
        showProject(active.project);
      }
    } catch (error) {
      // A browser with IndexedDB blocked still gets a working canvas — it just
      // cannot keep anything beyond the session.
      set({
        isHydrated: true,
        error: error instanceof Error ? error.message : "Designs could not be loaded.",
      });
    }
  },

  switchToDesign: async (id) => {
    const { activeDesignId, designs } = get();
    if (id === activeDesignId) {
      return;
    }

    const target = await readDesign(id);
    if (!target) {
      return;
    }

    await flushCanvasInto(designs.find((design) => design.id === activeDesignId));
    // Point the store at the new design *before* its plan reaches the canvas.
    // Autosave keys off the two together, so a canvas holding the new plan while
    // the store still names the old design is exactly the pairing that would
    // save one design's work into another.
    writeActiveDesignId(id);
    set({ activeDesignId: id });
    showProject(target.project);
    set({ designs: sortDesigns(await listDesignSummaries()) });
  },

  addDesign: async () => {
    const { activeDesignId, designs } = get();
    await flushCanvasInto(designs.find((design) => design.id === activeDesignId));

    const record = createDesignRecord(createEmptyProject(), UNTITLED_DESIGN_NAME);
    await writeDesign(record);
    writeActiveDesignId(record.id);
    set({ activeDesignId: record.id });
    showProject(record.project);
    set({ designs: sortDesigns(await listDesignSummaries()) });
  },

  importProjectAsDesign: async (project, name) => {
    const { activeDesignId, designs } = get();
    await flushCanvasInto(designs.find((design) => design.id === activeDesignId));

    const record = createDesignRecord(project, name || UNTITLED_DESIGN_NAME);
    await writeDesign(record);
    writeActiveDesignId(record.id);
    set({ activeDesignId: record.id });
    showProject(record.project);
    set({ designs: sortDesigns(await listDesignSummaries()) });
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

    const copy = duplicateDesignRecord(
      source,
      designs.map((design) => design.name),
    );
    await writeDesign(copy);
    writeActiveDesignId(copy.id);
    set({ activeDesignId: copy.id });
    showProject(copy.project);
    set({ designs: sortDesigns(await listDesignSummaries()) });
  },

  renameDesign: async (id, name) => {
    const summary = get().designs.find((design) => design.id === id);
    if (!summary) {
      return;
    }

    const renamed: DesignSummary = {
      ...summary,
      name: normalizeDesignName(name),
      updatedAt: new Date().toISOString(),
    };

    // Only the metadata is rewritten — the stored plan can be megabytes, and a
    // rename does not touch it. The plan's own `name` field, which the JSON
    // export uses for its filename, is realigned through the canvas below and
    // saved by the autosave that follows.
    await writeDesignSummary(renamed);

    if (id === get().activeDesignId) {
      useFactoryStore.getState().renameProject(renamed.name);
    }

    set({ designs: sortDesigns(await listDesignSummaries()) });
  },

  removeDesign: async (id) => {
    const { designs, activeDesignId } = get();
    const nextActiveId = pickDesignAfterDelete(designs, id);

    await deleteDesign(id);
    let summaries = sortDesigns(await listDesignSummaries());

    if (summaries.length === 0) {
      // The strip is never empty: closing the last design leaves a fresh one
      // rather than a canvas backed by nothing.
      const seeded = createDesignRecord(createEmptyProject(), UNTITLED_DESIGN_NAME);
      await writeDesign(seeded);
      summaries = [seeded];
      writeActiveDesignId(seeded.id);
      set({ designs: summaries, activeDesignId: seeded.id });
      showProject(seeded.project);
      return;
    }

    if (id === activeDesignId && nextActiveId) {
      const next = await readDesign(nextActiveId);
      writeActiveDesignId(nextActiveId);
      set({ designs: summaries, activeDesignId: nextActiveId });
      if (next) {
        showProject(next.project);
      }
      return;
    }

    set({ designs: summaries });
  },

  saveActiveProject: async (designId, project) => {
    const { activeDesignId, designs } = get();
    if (!designId || designId !== activeDesignId) {
      return;
    }

    const summary = designs.find((design) => design.id === designId);
    if (!summary) {
      return;
    }

    set({ saveState: "saving" });
    try {
      await writeDesign(updateDesignProject({ ...summary, project }, project));
      set({ saveState: "saved", designs: sortDesigns(await listDesignSummaries()) });
    } catch (error) {
      set({
        saveState: "error",
        error: error instanceof Error ? error.message : "Design could not be saved.",
      });
    }
  },
}));

/**
 * First run: adopt the plan the app used to keep under a single localStorage
 * key, so existing work becomes the first tab instead of being stranded behind a
 * storage change. The old key is read, never cleared — if anything here goes
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

export type { DesignRecord, DesignSummary };

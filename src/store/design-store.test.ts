import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DesignFolder,
  DesignRecord,
  DesignSummary,
} from "@/lib/designs/design-library";

const storage = vi.hoisted(() => ({
  listDesignSummaries: vi.fn<() => Promise<DesignSummary[]>>(),
  listDesignFolders: vi.fn<() => Promise<DesignFolder[]>>(async () => []),
  readDesign: vi.fn<(id: string, expectedFull?: string) => Promise<DesignRecord | undefined>>(),
  readDesignSummary: vi.fn<(id: string) => Promise<DesignSummary | undefined>>(),
  replaceDesignIfUnchanged: vi.fn<
    (record: DesignRecord, expected: Pick<DesignSummary, "updatedAt" | "metaUpdatedAt" | "remoteUpdatedAt">) => Promise<"written" | "conflict" | "missing" | "live">
  >(),
  writeDesignIfUnchanged: vi.fn<
    (record: DesignRecord, expectedUpdatedAt: string | undefined) => Promise<"written" | "conflict">
  >(),
  writeDesign: vi.fn<(record: DesignRecord) => Promise<void>>(async () => undefined),
  writeDesignSummary: vi.fn<(summary: DesignSummary) => Promise<void>>(async () => undefined),
  writeDesignFolder: vi.fn<(folder: DesignFolder) => Promise<void>>(async () => undefined),
  deleteDesign: vi.fn<
    (
      id: string,
      expectedUpdatedAt?: string,
      canDelete?: (stored: DesignSummary | undefined) => boolean,
    ) => Promise<boolean>
  >(async () => true),
  deleteDesignFolder: vi.fn<(id: string) => Promise<void>>(async () => undefined),
  readActiveDesignId: vi.fn<() => string | undefined>(),
  writeActiveDesignId: vi.fn<(id: string | undefined) => void>(),
}));

vi.mock("@/lib/designs/design-storage", () => storage);

/** Another browser tab, as far as this one can tell: the focus it has, and the saves it hears. */
const tabs = vi.hoisted(() => ({
  editing: true,
  announced: [] as Array<{ designId: string; updatedAt: string }>,
  heard: undefined as ((message: { designId: string; updatedAt: string }) => void) | undefined,
}));
vi.mock("@/lib/designs/design-tab-sync", () => ({
  THIS_TAB_ID: "this-tab",
  isEditingInThisTab: () => tabs.editing,
  announceDesignSaved: (designId: string, updatedAt: string) => {
    tabs.announced.push({ designId, updatedAt });
  },
  subscribeDesignSaved: (handler: (message: { designId: string; updatedAt: string }) => void) => {
    tabs.heard = handler;
    return () => {
      tabs.heard = undefined;
    };
  },
}));
vi.mock("@/lib/designs/design-camera", () => ({
  keepDesignCameras: vi.fn(),
  forgetDesignCameras: vi.fn(),
  rememberDesignCamera: vi.fn(),
  readDesignCamera: vi.fn(),
  beginDesignCameraHandover: vi.fn(),
  beginDesignHandover: vi.fn(),
  endDesignHandover: vi.fn(),
}));

import { readLibraryTabState } from "@/lib/library/library-tab";
import { createEmptyProject } from "@/examples";
import { captureDesignUpdateGuard, useDesignStore } from "./design-store";
import { useFactoryStore } from "./factory-store";
import { copyViewedPost } from "@/lib/community/open-post";
import { planFingerprints } from "@/lib/import-export/import-fingerprint";
import { solveBooks } from "./solve-books";
import { setLiveDesignId } from "./live-edit-gate";

function deferredSolveWorker(totalEuT?: number) {
  const result = {
    ...solveBooks(createEmptyProject()),
    stale: false,
    ...(totalEuT === undefined ? {} : { totalEuT }),
  };
  let pending: { key: string; respond: (data: unknown) => void } | undefined;
  const terminate = vi.fn();
  class PendingWorker {
    onmessage?: (event: { data: unknown }) => void;
    terminate = terminate;
    postMessage(request: { key: string }) {
      pending = { key: request.key, respond: (data) => this.onmessage?.({ data }) };
    }
  }
  vi.stubGlobal("Worker", PendingWorker);
  return {
    ready: () => vi.waitFor(() => expect(pending).toBeDefined()),
    complete: () => {
      if (!pending) throw new Error("No persistence solve is pending.");
      // Landing later uses the normal canvas solver, outside this test worker.
      vi.stubGlobal("Worker", undefined);
      pending.respond({ key: pending.key, result });
    },
    terminate,
  };
}

describe("explicitly updating an imported plan version", () => {
  it("rejects a changed exact candidate without switching or reopening it", async () => {
    const full = (await planFingerprints(createEmptyProject())).full;
    const changed = await planFingerprints({ ...createEmptyProject(), notes: "New content" });
    const records = library(
      summary("target", { closed: true, fingerprints: changed }),
      summary("incoming"),
    );
    storage.readActiveDesignId.mockReturnValue("incoming");
    await useDesignStore.getState().hydrate();
    expect(await useDesignStore.getState().switchToDesign("target", full)).toBe(false);
    expect(useDesignStore.getState().activeDesignId).toBe("incoming");
    expect(records.get("target")!.closed).toBe(true);
  });

  it("opens the validated closed exact match and retains an active match's canvas", async () => {
    const fingerprints = await planFingerprints(createEmptyProject());
    const records = library(summary("target", { closed: true, fingerprints }), summary("incoming"));
    storage.readActiveDesignId.mockReturnValue("incoming");
    await useDesignStore.getState().hydrate();
    expect(await useDesignStore.getState().switchToDesign("target", fingerprints.full)).toBe(true);
    expect(records.get("target")!.closed).toBeUndefined();
    const canvas = useFactoryStore.getState().project;
    expect(await useDesignStore.getState().switchToDesign("target", fingerprints.full)).toBe(true);
    expect(useFactoryStore.getState().project).toBe(canvas);
  });

  it("flushes newer active edits before deciding whether an exact candidate matches", async () => {
    const fingerprints = await planFingerprints(createEmptyProject());
    const records = library(summary("incoming", { fingerprints }));
    storage.readActiveDesignId.mockReturnValue("incoming");
    await useDesignStore.getState().hydrate();
    useFactoryStore.setState((state) => ({
      project: { ...state.project, notes: "Unsaved new content" },
    }));
    storage.writeDesignIfUnchanged.mockImplementationOnce(async (record) => {
      await storage.writeDesign({
        ...record,
        fingerprints: await planFingerprints(record.project),
      });
      return "written";
    });
    expect(await useDesignStore.getState().switchToDesign("incoming", fingerprints.full)).toBe(
      false,
    );
    expect(records.get("incoming")!.fingerprints!.full).not.toBe(fingerprints.full);
    expect(useFactoryStore.getState().project.notes).toBe("Unsaved new content");
  });

  it.each([false, true])(
    "loads a newer active exact match before saving edits (another save: %s)",
    async (anotherSave) => {
      const records = library(summary("target", { updatedAt: "version-a" }));
      storage.readActiveDesignId.mockReturnValue("target");
      useDesignStore.setState({ tabConflict: undefined });
      await useDesignStore.getState().hydrate();
      const staleCanvas = useFactoryStore.getState().project;
      const remoteProject = {
        ...staleCanvas,
        annotations: [
          {
            id: "remote-note",
            kind: "text" as const,
            text: "Work from another tab",
            position: { x: 0, y: 0 },
            size: { width: 200, height: 40 },
          },
        ],
      };
      const fingerprints = await planFingerprints(remoteProject);
      records.set("target", { ...records.get("target")!, updatedAt: "version-b", fingerprints });
      storage.readDesign.mockImplementation(async (id, expectedFull) => {
        const record = records.get(id);
        if (!record || (expectedFull !== undefined && record.fingerprints?.full !== expectedFull))
          return undefined;
        return { ...record, project: remoteProject };
      });

      expect(await useDesignStore.getState().switchToDesign("target", fingerprints.full)).toBe(
        true,
      );
      expect(useFactoryStore.getState().project).not.toBe(staleCanvas);
      expect(useFactoryStore.getState().project.annotations).toEqual(remoteProject.annotations);
      storage.writeDesign.mockClear();
      storage.writeDesignIfUnchanged.mockClear();
      if (anotherSave) records.set("target", { ...records.get("target")!, updatedAt: "version-c" });
      useFactoryStore.setState((state) => ({
        project: { ...state.project, notes: "Local notes edit" },
      }));
      await useDesignStore.getState().flushActiveDesign();

      expect(storage.writeDesignIfUnchanged.mock.calls[0][1]).toBe("version-b");
      const saved = storage.writeDesign.mock.calls.at(-1)![0];
      expect(saved.project.notes).toBe("Local notes edit");
      expect(saved.project.annotations).toEqual(remoteProject.annotations);
      if (anotherSave) {
        expect(saved.id).not.toBe("target");
        expect(records.get("target")!.updatedAt).toBe("version-c");
        expect(useDesignStore.getState().tabConflict).toBeDefined();
      } else {
        expect(saved.id).toBe("target");
        expect(useDesignStore.getState().tabConflict).toBeUndefined();
      }
    },
  );

  it.each(["switch back", "saved edit"])(
    "retains a guard captured before replacement starts: %s",
    async (change) => {
      library(summary("target"), summary("incoming"), summary("other"));
      storage.readActiveDesignId.mockReturnValue("incoming");
      await useDesignStore.getState().hydrate();
      const assertUnchangedCanvas = captureDesignUpdateGuard();
      if (change === "switch back") {
        await useDesignStore.getState().switchToDesign("other");
        await useDesignStore.getState().switchToDesign("incoming");
      } else {
        useFactoryStore.setState((state) => ({ project: { ...state.project, notes: "New work" } }));
        await useDesignStore.getState().flushActiveDesign();
      }
      storage.writeDesign.mockClear();
      await expect(
        useDesignStore
          .getState()
          .replaceDesignFromImport(
            "target",
            createEmptyProject(),
            (await planFingerprints(createEmptyProject())).full,
            assertUnchangedCanvas,
          ),
      ).rejects.toThrow("plan changed while updating");
      expect(storage.writeDesign).not.toHaveBeenCalled();
      expect(storage.replaceDesignIfUnchanged).not.toHaveBeenCalled();
      expect(useDesignStore.getState().activeDesignId).toBe("incoming");
    },
  );

  it.each(["already pending", "starts during solve", "finishes without opening"])(
    "refuses replacement after navigation intent: %s",
    async (timing) => {
      library(summary("target"), summary("incoming"), summary("other"));
      storage.readActiveDesignId.mockReturnValue("incoming");
      await useDesignStore.getState().hydrate();
      const other = (await storage.readDesign("other"))!;
      const read = storage.readDesign.getMockImplementation()!;
      let release: ((record: DesignRecord | undefined) => void) | undefined;
      storage.readDesign.mockImplementation((id) =>
        id === "other"
          ? new Promise((resolve) => {
              release = resolve;
            })
          : read(id),
      );
      const full = (await planFingerprints(createEmptyProject())).full;
      const worker = deferredSolveWorker();
      let switching: Promise<boolean> | undefined;
      try {
        if (timing === "already pending")
          switching = useDesignStore.getState().switchToDesign("other");
        const update = useDesignStore
          .getState()
          .replaceDesignFromImport("target", createEmptyProject(), full);
        const rejection = expect(update).rejects.toThrow("plan changed while updating");
        if (timing !== "already pending") {
          await worker.ready();
          switching = useDesignStore.getState().switchToDesign("other");
          if (timing === "finishes without opening") {
            release!(undefined);
            await switching;
          }
          worker.complete();
        }
        await rejection;
        expect(useDesignStore.getState().activeDesignId).toBe("incoming");
        expect(storage.replaceDesignIfUnchanged).not.toHaveBeenCalled();
        expect(storage.writeDesign).not.toHaveBeenCalled();
      } finally {
        vi.stubGlobal("Worker", undefined);
        release?.(other);
        await switching;
        vi.unstubAllGlobals();
      }
    },
  );

  it("refuses a target that becomes live while the worker runs", async () => {
    library(summary("target"));
    useDesignStore.setState({ activeDesignId: undefined, designs: [summary("target")] });
    const worker = deferredSolveWorker();
    try {
      const update = useDesignStore
        .getState()
        .replaceDesignFromImport(
          "target",
          createEmptyProject(),
          (await planFingerprints(createEmptyProject())).full,
        );
      const rejection = expect(update).rejects.toThrow("live or shared plan");
      await worker.ready();
      setLiveDesignId("target");
      worker.complete();
      await rejection;
      expect(storage.replaceDesignIfUnchanged).not.toHaveBeenCalled();
      expect(storage.writeDesign).not.toHaveBeenCalled();
    } finally {
      setLiveDesignId(undefined);
      vi.unstubAllGlobals();
    }
  });

  it("retains the incoming canvas when the transaction reports the target is live", async () => {
    library(summary("target"), summary("incoming"));
    storage.readActiveDesignId.mockReturnValue("incoming");
    await useDesignStore.getState().hydrate();
    storage.replaceDesignIfUnchanged.mockResolvedValueOnce("live");
    await expect(
      useDesignStore
        .getState()
        .replaceDesignFromImport(
          "target",
          createEmptyProject(),
          (await planFingerprints(createEmptyProject())).full,
        ),
    ).rejects.toThrow("live or shared plan");
    expect(useDesignStore.getState().activeDesignId).toBe("incoming");
    expect(storage.deleteDesign).not.toHaveBeenCalled();
  });

  it.each(["rename", "favorite", "move", "delete", "account sync"])(
    "retains the incoming plan when the target changes during the worker: %s",
    async (change) => {
      const records = library(summary("target"), summary("incoming"));
      storage.readActiveDesignId.mockReturnValue("incoming");
      await useDesignStore.getState().hydrate();
      const worker = deferredSolveWorker();
      try {
        const update = useDesignStore
          .getState()
          .replaceDesignFromImport(
            "target",
            createEmptyProject(),
            (await planFingerprints(createEmptyProject())).full,
          );
        const rejection = expect(update).rejects.toThrow(
          change === "delete" ? "saved plan was deleted" : "Another tab changed",
        );
        await worker.ready();
        if (change === "delete") records.delete("target");
        else if (change === "account sync")
          records.set("target", { ...records.get("target")!, remoteUpdatedAt: "newer" });
        else
          records.set("target", {
            ...records.get("target")!,
            metaUpdatedAt: "newer",
            ...(change === "rename"
              ? { name: "Renamed elsewhere" }
              : change === "favorite"
                ? { favorite: true }
                : { folderId: "new-folder" }),
          });
        const latest = records.get("target");
        worker.complete();
        await rejection;
        expect(records.get("target")).toBe(latest);
        expect(records.has("incoming")).toBe(true);
        expect(useDesignStore.getState().activeDesignId).toBe("incoming");
        expect(storage.deleteDesign).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it.each(["incoming", "target", "switch", "saved edit", "backup write", "replacement write"])(
    "preserves newer work during an update: %s",
    async (change) => {
      library(summary("target"), summary("incoming"), summary("other"));
      storage.readActiveDesignId.mockReturnValue(change === "target" ? "target" : "incoming");
      await useDesignStore.getState().hydrate();
      const worker = deferredSolveWorker();
      try {
        const update = useDesignStore
          .getState()
          .replaceDesignFromImport(
            "target",
            createEmptyProject(),
            (await planFingerprints(createEmptyProject())).full,
          );
        const rejection = expect(update).rejects.toThrow("plan changed while updating");
        await worker.ready();
        const edit = () =>
          useFactoryStore.setState((state) => ({
            project: { ...state.project, notes: "Work done while waiting" },
          }));
        if (change === "backup write")
          storage.writeDesign.mockImplementationOnce(async () => {
            edit();
          });
        else if (change === "replacement write")
          storage.replaceDesignIfUnchanged.mockImplementationOnce(async () => {
            edit();
            return "written";
          });
        else if (change === "switch") {
          vi.stubGlobal("Worker", undefined);
          await useDesignStore.getState().switchToDesign("other");
        } else {
          edit();
          if (change === "saved edit") await useDesignStore.getState().flushActiveDesign();
        }
        worker.complete();
        await rejection;
        if (change === "switch") expect(useDesignStore.getState().activeDesignId).toBe("other");
        else expect(useFactoryStore.getState().project.notes).toBe("Work done while waiting");
        if (change !== "replacement write") {
          expect(
            storage.replaceDesignIfUnchanged.mock.calls.filter(
              ([record]) => record.id === "target",
            ),
          ).toHaveLength(0);
        }
        expect(storage.deleteDesign).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it("writes neither replacement nor backup until the browser worker finishes", async () => {
    library(summary("target"));
    useDesignStore.setState({ activeDesignId: undefined, designs: [summary("target")] });
    const project = { ...createEmptyProject(), planMode: true, solveMode: true };
    const worker = deferredSolveWorker(42);
    try {
      const update = useDesignStore
        .getState()
        .replaceDesignFromImport(
          "target",
          project,
          (await planFingerprints(createEmptyProject())).full,
        );
      await worker.ready();
      expect(storage.writeDesign).not.toHaveBeenCalled();
      expect(storage.replaceDesignIfUnchanged).not.toHaveBeenCalled();
      worker.complete();
      await update;
      const replacement = storage.replaceDesignIfUnchanged.mock.calls[0][0];
      expect(replacement.stats!.euT).toBe(42);
      expect(worker.terminate).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reopens a closed target and recalculates its statistics using the replacement's own solve", async () => {
    library(
      summary("target", {
        closed: true,
        stats: {
          cards: 99,
          machines: 99,
          tier: "UV",
          tierIndex: 8,
          euT: 999_999,
          takes: ["old-input"],
          makes: ["old-output"],
        },
      }),
    );
    useDesignStore.setState({
      activeDesignId: undefined,
      designs: [summary("target", { closed: true })],
    });
    const old = (await storage.readDesign("target"))!;
    useFactoryStore.setState({ lastResult: { ...solveBooks(old.project), totalEuT: 999_999 } });
    const incoming = {
      ...createEmptyProject(),
      planMode: true,
      solveMode: true,
      recipes: [
        {
          id: "iron",
          name: "Iron",
          machineType: "Assembler",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 30,
          inputs: [],
          outputs: [{ kind: "item" as const, id: "minecraft:iron_ingot", amount: 1 }],
        },
      ],
      nodes: [
        {
          id: "machine",
          recipeId: "iron",
          machineCount: 4,
          solvePin: 4,
          overclockTier: "HV" as const,
          parallel: 1,
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
    };
    await useDesignStore
      .getState()
      .replaceDesignFromImport("target", incoming, (await planFingerprints(old.project)).full);
    const replacement = storage.writeDesign.mock.calls
      .map((call) => call[0])
      .find((record) => record.id === "target")!;
    expect(replacement.closed).toBeUndefined();
    expect(
      useDesignStore.getState().designs.find((design) => design.id === "target")?.closed,
    ).toBeUndefined();
    expect(useDesignStore.getState().activeDesignId).toBe("target");
    expect(replacement.stats).toMatchObject({ cards: 1, drawers: 0, machines: 4, tier: "HV" });
    expect(replacement.stats!.euT).toBeGreaterThan(0);
    expect(replacement.stats!.euT).not.toBe(999_999);
    expect(replacement.stats!.takes).not.toContain("old-input");
    expect(replacement.stats!.makes).not.toContain("old-output");
    expect(
      storage.writeDesign.mock.calls
        .map((call) => call[0])
        .find((record) => record.id !== "target")!.closed,
    ).toBe(true);
  });
  it("keeps the saved design identity and creates a closed backup of the old contents", async () => {
    library(summary("target", { folderId: "folder", favorite: true }));
    useDesignStore.setState({ activeDesignId: undefined, designs: [summary("target")] });
    const old = (await storage.readDesign("target"))!;
    const full = (await planFingerprints(old.project)).full;
    await useDesignStore
      .getState()
      .replaceDesignFromImport("target", { ...old.project, notes: "New version" }, full);
    const writes = storage.writeDesign.mock.calls.map((call) => call[0]);
    const backup = writes.find((record) => record.id !== "target")!;
    expect(backup.closed).toBe(true);
    expect(backup.name).toContain("before update");
    expect(backup.project.notes).toBe(old.project.notes);
    const replacement = writes.find((record) => record.id === "target")!;
    expect(replacement.folderId).toBe("folder");
    expect(replacement.favorite).toBe(true);
    expect(replacement.project.notes).toBe("New version");
    expect(useDesignStore.getState().activeDesignId).toBe("target");
  });

  it("refuses a stale update choice without writing a backup or replacing a plan", async () => {
    library(summary("target"));
    useDesignStore.setState({ activeDesignId: undefined, designs: [summary("target")] });
    await expect(
      useDesignStore.getState().replaceDesignFromImport("target", createEmptyProject(), "stale"),
    ).rejects.toThrow("saved plan changed");
    expect(storage.writeDesign).not.toHaveBeenCalled();
  });

  it("preserves the incoming plan if another tab wins the atomic replacement check", async () => {
    library(summary("target"));
    useDesignStore.setState({ activeDesignId: undefined, designs: [summary("target")] });
    const full = (await planFingerprints(createEmptyProject())).full;
    storage.replaceDesignIfUnchanged.mockResolvedValueOnce("conflict");
    await expect(
      useDesignStore.getState().replaceDesignFromImport("target", createEmptyProject(), full),
    ).rejects.toThrow("Another tab changed");
    expect(storage.writeDesign.mock.calls.every((call) => call[0].id !== "target")).toBe(true);
  });
});

function summary(id: string, extra: Partial<DesignSummary> = {}): DesignSummary {
  return {
    id,
    name: `Design ${id}`,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    order: 0,
    ...extra,
  };
}

describe("guarded import cleanup", () => {
  it("keeps unsaved work when the player returns to the incoming tab during cleanup", async () => {
    const { updatePlanFromNotice } = await import("@/lib/open-plan-code");
    const records = library(summary("target"), summary("incoming"));
    storage.readActiveDesignId.mockReturnValue("incoming");
    await useDesignStore.getState().hydrate();
    const project = createEmptyProject();
    const full = (await planFingerprints(project)).full;
    const read = storage.readDesign.getMockImplementation()!;
    let edited = false;
    storage.readDesign.mockImplementation(async (id) => {
      const saved = await read(id);
      if (id === "incoming" && useDesignStore.getState().activeDesignId === "target" && !edited) {
        edited = true;
        await useDesignStore.getState().switchToDesign("incoming");
        useFactoryStore.setState((state) => ({
          project: { ...state.project, notes: "New unsaved work" },
        }));
      }
      return saved;
    });
    await updatePlanFromNotice(
      {
        kind: "related",
        designId: "incoming",
        name: "Incoming",
        project,
        full,
        related: [{ id: "target", name: "Target", full }],
      },
      "target",
    );
    expect(edited).toBe(true);
    expect(records.has("incoming")).toBe(true);
    expect(useDesignStore.getState().activeDesignId).toBe("incoming");
    expect(useFactoryStore.getState().project.notes).toBe("New unsaved work");
    expect(storage.deleteDesign).not.toHaveBeenCalled();
  });

  it("rechecks navigation inside the deletion transaction", async () => {
    const records = library(summary("target"), summary("incoming"));
    storage.readActiveDesignId.mockReturnValue("target");
    await useDesignStore.getState().hydrate();
    storage.deleteDesign.mockImplementationOnce(async (id, stamp, canDelete) => {
      await useDesignStore.getState().switchToDesign("incoming");
      useFactoryStore.setState((state) => ({
        project: { ...state.project, notes: "Edited before delete" },
      }));
      if (!canDelete?.(records.get(id))) return false;
      return records.delete(id);
    });
    expect(
      await useDesignStore
        .getState()
        .cleanupImportedDesign(
          "incoming",
          (await planFingerprints(createEmptyProject())).full,
          "target",
        ),
    ).toBe(false);
    expect(records.has("incoming")).toBe(true);
    expect(useFactoryStore.getState().project.notes).toBe("Edited before delete");
  });

  it("keeps an incoming tab whose switch is still awaiting its read", async () => {
    library(summary("target"), summary("incoming"));
    storage.readActiveDesignId.mockReturnValue("target");
    await useDesignStore.getState().hydrate();
    const record = (await storage.readDesign("incoming"))!;
    let release!: (record: DesignRecord) => void;
    storage.readDesign.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const switching = useDesignStore.getState().switchToDesign("incoming");
    expect(
      await useDesignStore
        .getState()
        .cleanupImportedDesign(
          "incoming",
          (await planFingerprints(createEmptyProject())).full,
          "target",
        ),
    ).toBe(false);
    expect(storage.deleteDesign).not.toHaveBeenCalled();
    release(record);
    await switching;
    expect(useDesignStore.getState().activeDesignId).toBe("incoming");
  });

  it("keeps the incoming version when the target joins live after replacement", async () => {
    const records = library(summary("target"), summary("incoming"));
    storage.readActiveDesignId.mockReturnValue("target");
    await useDesignStore.getState().hydrate();
    setLiveDesignId("target");
    try {
      expect(
        await useDesignStore
          .getState()
          .cleanupImportedDesign(
            "incoming",
            (await planFingerprints(createEmptyProject())).full,
            "target",
          ),
      ).toBe(false);
      expect(records.has("incoming")).toBe(true);
    } finally {
      setLiveDesignId(undefined);
    }
  });

  it("deletes an unchanged inactive incoming version without navigating the canvas", async () => {
    const records = library(summary("target"), summary("incoming"));
    storage.readActiveDesignId.mockReturnValue("target");
    await useDesignStore.getState().hydrate();
    expect(
      await useDesignStore
        .getState()
        .cleanupImportedDesign(
          "incoming",
          (await planFingerprints(createEmptyProject())).full,
          "target",
        ),
    ).toBe(true);
    expect(records.has("incoming")).toBe(false);
    expect(useDesignStore.getState().activeDesignId).toBe("target");
  });
});

/** The mock library: summaries answer the list, records answer reads. */
function library(...designs: DesignSummary[]) {
  const current = new Map(designs.map((design) => [design.id, design]));
  storage.listDesignSummaries.mockImplementation(async () => [...current.values()]);
  storage.readDesign.mockImplementation(async (id: string, expectedFull?: string) => {
    let design = current.get(id);
    if (
      expectedFull !== undefined &&
      (design?.fingerprints?.full !== expectedFull || design?.cloud)
    )
      return undefined;
    if (design?.closed && expectedFull !== undefined) {
      design = { ...design };
      delete design.closed;
      current.set(id, design);
    }
    return design ? { ...design, project: createEmptyProject() } : undefined;
  });
  storage.writeDesignSummary.mockImplementation(async (design: DesignSummary) => {
    current.set(design.id, design);
  });
  storage.writeDesign.mockImplementation(async (record: DesignRecord) => {
    const rest: Partial<DesignRecord> = { ...record };
    delete rest.project;
    current.set(record.id, rest as DesignSummary);
  });
  storage.deleteDesign.mockImplementation(async (id, stamp, canDelete) => {
    const stored = current.get(id);
    if ((stamp !== undefined && stored?.updatedAt !== stamp) || (canDelete && !canDelete(stored)))
      return false;
    return current.delete(id);
  });
  storage.readDesignSummary.mockImplementation(async (id: string) => current.get(id));
  storage.writeDesignIfUnchanged.mockImplementation(async (record, expectedUpdatedAt) => {
    const stored = current.get(record.id);
    if (stored && expectedUpdatedAt !== undefined && stored.updatedAt !== expectedUpdatedAt) {
      return "conflict";
    }
    await storage.writeDesign(record);
    return "written";
  });
  storage.replaceDesignIfUnchanged.mockImplementation(async (record, expected) => {
    const stored = current.get(record.id);
    if (!stored) return "missing";
    if (
      stored.updatedAt !== expected.updatedAt ||
      stored.metaUpdatedAt !== expected.metaUpdatedAt ||
      stored.remoteUpdatedAt !== expected.remoteUpdatedAt
    )
      return "conflict";
    await storage.writeDesign(record);
    return "written";
  });
  return current;
}

beforeEach(() => {
  useDesignStore.setState({
    designs: [],
    folders: [],
    activeDesignId: undefined,
    isHydrated: false,
    error: undefined,
  });
  vi.clearAllMocks();
  storage.listDesignFolders.mockResolvedValue([]);
  tabs.editing = true;
  tabs.announced = [];
  storage.readDesignSummary.mockResolvedValue(undefined);
  storage.writeDesignIfUnchanged.mockImplementation(async (record) => {
    await storage.writeDesign(record);
    return "written";
  });
});

describe("opening the design library", () => {
  beforeEach(() => {
    storage.listDesignSummaries.mockResolvedValue([summary("a"), summary("b")]);
    storage.readActiveDesignId.mockReturnValue("a");
  });

  it("still lists every tab when the remembered design cannot be opened", async () => {
    // Issue #45: a plan saved by an older version that trips a load-time
    // migration used to take the whole strip down with it - the player saw
    // every design gone, though nothing but that one plan was at fault.
    storage.readDesign.mockRejectedValue(new TypeError("Cannot read properties of undefined"));

    await useDesignStore.getState().hydrate();

    const state = useDesignStore.getState();
    expect(state.isHydrated).toBe(true);
    expect(state.designs.map((design) => design.id)).toEqual(["a", "b"]);
    expect(state.activeDesignId).toBeUndefined();
    expect(state.error).toContain("Cannot read");
  });

  it("never makes an unreadable design active over an empty canvas", async () => {
    // With the record active and nothing on the canvas, the next autosave
    // wrote the empty canvas over the plan. Listed, yes; active, never.
    storage.readDesign.mockResolvedValue(undefined);

    await useDesignStore.getState().hydrate();

    const state = useDesignStore.getState();
    expect(state.designs).toHaveLength(2);
    expect(state.activeDesignId).toBeUndefined();
    expect(storage.writeActiveDesignId).not.toHaveBeenCalledWith("a");
    expect(storage.writeDesign).not.toHaveBeenCalled();
  });

  it("lands on the shelf when every design is closed", async () => {
    library(summary("a", { closed: true }), summary("b", { closed: true }));
    storage.readActiveDesignId.mockReturnValue(undefined);

    await useDesignStore.getState().hydrate();

    const state = useDesignStore.getState();
    expect(state.activeDesignId).toBeUndefined();
    expect(state.designs).toHaveLength(2);
    expect(readLibraryTabState().active).toBe(true);
  });

  it("opens the first open design when the remembered one is gone", async () => {
    library(summary("a", { closed: true }), summary("b"));
    storage.readActiveDesignId.mockReturnValue("gone");

    await useDesignStore.getState().hydrate();

    expect(useDesignStore.getState().activeDesignId).toBe("b");
  });
});

describe("closing tabs", () => {
  it("keeps the design and moves to the neighbour on the left", async () => {
    const records = library(summary("a"), summary("b"), summary("c"));
    storage.readActiveDesignId.mockReturnValue("b");
    await useDesignStore.getState().hydrate();

    await useDesignStore.getState().closeDesign("b");

    const state = useDesignStore.getState();
    expect(state.activeDesignId).toBe("a");
    expect(records.get("b")?.closed).toBe(true);
    expect(storage.deleteDesign).not.toHaveBeenCalled();
    expect(state.designs.map((design) => design.id)).toEqual(["a", "b", "c"]);
  });

  it("lands on the shelf when the last open tab closes", async () => {
    library(summary("a"), summary("b", { closed: true }));
    storage.readActiveDesignId.mockReturnValue("a");
    await useDesignStore.getState().hydrate();

    await useDesignStore.getState().closeDesign("a");

    expect(useDesignStore.getState().activeDesignId).toBeUndefined();
    expect(readLibraryTabState().active).toBe(true);
    expect(storage.deleteDesign).not.toHaveBeenCalled();
  });

  it("reopens a closed design when it is switched to", async () => {
    const records = library(summary("a"), summary("b", { closed: true }));
    storage.readActiveDesignId.mockReturnValue("a");
    await useDesignStore.getState().hydrate();

    await useDesignStore.getState().switchToDesign("b");

    expect(useDesignStore.getState().activeDesignId).toBe("b");
    expect(records.get("b")?.closed).toBeUndefined();
    expect(readLibraryTabState().active).toBe(false);
  });

  it("closes a run of tabs and keeps the one the menu came from", async () => {
    const records = library(summary("a"), summary("b"), summary("c"));
    storage.readActiveDesignId.mockReturnValue("c");
    await useDesignStore.getState().hydrate();

    await useDesignStore.getState().closeDesigns(["a", "b", "c"], "a");

    expect(useDesignStore.getState().activeDesignId).toBe("a");
    expect(records.get("a")?.closed).toBeUndefined();
    expect(records.get("b")?.closed).toBe(true);
    expect(records.get("c")?.closed).toBe(true);
  });
});

describe("folders", () => {
  it("files and unfiles a design", async () => {
    const records = library(summary("a"));
    storage.readActiveDesignId.mockReturnValue("a");
    await useDesignStore.getState().hydrate();

    await useDesignStore.getState().moveDesignToFolder("a", "f1");
    expect(records.get("a")?.folderId).toBe("f1");
    expect(useDesignStore.getState().designs[0].folderId).toBe("f1");

    await useDesignStore.getState().moveDesignToFolder("a", undefined);
    expect(records.get("a")?.folderId).toBeUndefined();
  });

  it("deleting a folder unfiles its designs and loses none", async () => {
    const records = library(summary("a", { folderId: "f1" }), summary("b", { folderId: "f2" }));
    storage.readActiveDesignId.mockReturnValue("a");
    storage.listDesignFolders.mockResolvedValue([
      { id: "f1", name: "Oil", createdAt: "2026-08-01" },
      { id: "f2", name: "Bees", createdAt: "2026-08-01" },
    ]);
    await useDesignStore.getState().hydrate();

    await useDesignStore.getState().deleteFolder("f1");

    const state = useDesignStore.getState();
    expect(state.folders.map((folder) => folder.id)).toEqual(["f2"]);
    expect(records.get("a")?.folderId).toBeUndefined();
    expect(records.get("b")?.folderId).toBe("f2");
    expect(state.designs).toHaveLength(2);
    expect(storage.deleteDesignFolder).toHaveBeenCalledWith("f1");
  });
});

describe("closing a blank tab", () => {
  it("throws away an untouched Untitled design instead of keeping it", async () => {
    const records = library(
      summary("a"),
      summary("blank", { name: "Untitled design" }),
    );
    storage.readActiveDesignId.mockReturnValue("blank");
    await useDesignStore.getState().hydrate();

    await useDesignStore.getState().closeDesign("blank");

    expect(storage.deleteDesign).toHaveBeenCalledWith("blank");
    expect(records.has("blank")).toBe(false);
    expect(useDesignStore.getState().activeDesignId).toBe("a");
  });

  it("keeps a renamed design even when its board is empty", async () => {
    const records = library(summary("a"), summary("named", { name: "Platline" }));
    storage.readActiveDesignId.mockReturnValue("named");
    await useDesignStore.getState().hydrate();

    await useDesignStore.getState().closeDesign("named");

    expect(storage.deleteDesign).not.toHaveBeenCalled();
    expect(records.get("named")?.closed).toBe(true);
  });
});


describe("public viewing sessions", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    useFactoryStore.getState().markHydratedProject(createEmptyProject());
    useDesignStore.setState({ activeDesignId: undefined, publicView: undefined, publicViews: [] });
    library(summary("a"));
    storage.readActiveDesignId.mockReturnValue("a");
    await useDesignStore.getState().hydrate();
  });

  it("flushes your outgoing design but never saves the viewed post into it", async () => {
    useFactoryStore.getState().renameProject("My last edit");
    const post = { ...createEmptyProject(), name: "Someone else's setup" };
    await useDesignStore.getState().viewPublicProject({ id: "post", name: post.name }, post);
    expect(storage.writeDesign).toHaveBeenCalledTimes(1);
    expect(storage.writeDesign.mock.calls[0][0].project.nodes).toEqual([]);
    expect(storage.writeDesign.mock.calls[0][0].project.name).not.toBe(post.name);
    expect(useDesignStore.getState().designs).toHaveLength(1);
    expect(useDesignStore.getState().activeDesignId).toBeUndefined();
    storage.writeDesign.mockClear();
    await useDesignStore.getState().saveActiveProject("a", post);
    await useDesignStore.getState().saveActiveProject(undefined, post);
    await useDesignStore.getState().reloadActiveDesign();
    expect(storage.writeDesign).not.toHaveBeenCalled();
    expect(useFactoryStore.getState().project.name).toBe(post.name);
    await useDesignStore.getState().switchToDesign("a");
    expect(storage.writeDesign).not.toHaveBeenCalled();
    expect(useFactoryStore.getState().isReadOnly).toBe(false);
    expect(useDesignStore.getState().publicView).toBeUndefined();
  });

  it("keeps multiple public tabs while switching to personal designs and closes only the chosen view", async () => {
    const store = useDesignStore.getState();
    await store.viewPublicProject({ id: "one", name: "One" }, { ...createEmptyProject(), name: "One" });
    await store.viewPublicProject({ id: "two", name: "Two" }, { ...createEmptyProject(), name: "Two" });
    await store.switchToDesign("a");
    expect(useDesignStore.getState().publicViews.map((view) => view.id)).toEqual(["one", "two"]);
    storage.writeDesign.mockClear();
    await store.switchToPublicView("one");
    expect(useFactoryStore.getState().isReadOnly).toBe(true);
    expect(useFactoryStore.getState().project.name).toBe("One");
    expect(useDesignStore.getState().publicViews.map((view) => view.id)).toEqual(["one", "two"]);
    storage.writeDesign.mockClear();
    await store.switchToPublicView("two");
    expect(storage.writeDesign).not.toHaveBeenCalled();
    await store.closePublicView("one");
    expect(useDesignStore.getState().publicView?.id).toBe("two");
    expect(useDesignStore.getState().publicViews.map((view) => view.id)).toEqual(["two"]);
    await store.closePublicView("two");
    expect(useDesignStore.getState().publicViews).toEqual([]);
    expect(useFactoryStore.getState().isReadOnly).toBe(false);
  });

  it("only Open a copy creates a design, and the copy is editable and unlinked", async () => {
    const post = { ...createEmptyProject(), name: "Public setup", metadata: { communityPlanId: "post" } };
    await useDesignStore.getState().viewPublicProject({ id: "post", name: post.name }, post);
    storage.writeDesign.mockClear();
    await copyViewedPost();
    expect(storage.writeDesign).toHaveBeenCalledTimes(1);
    const copy = storage.writeDesign.mock.calls[0][0];
    expect(copy.id).not.toBe("a");
    expect(copy.project.metadata?.communityPlanId).toBeUndefined();
    expect(useDesignStore.getState().activeDesignId).toBe(copy.id);
    expect(useDesignStore.getState().designs).toHaveLength(2);
    expect(useDesignStore.getState().publicView).toBeUndefined();
    expect(useFactoryStore.getState().isReadOnly).toBe(false);
  });
});


describe("one mode for every design", () => {
  const modeOf = () => {
    const project = useFactoryStore.getState().project;
    return { plan: project.planMode === true, solve: project.solveMode === true, pool: project.poolMode === true };
  };

  it("opens Build, Solve and Pool designs as plan boards and leaves what is stored alone", async () => {
    useFactoryStore.getState().markHydratedProject(createEmptyProject());
    useDesignStore.setState({ publicView: undefined, publicViews: [] });
    library(summary("a"), summary("b"), summary("c"));
    const records = new Map<string, DesignRecord>([
      ["a", { ...summary("a"), project: createEmptyProject() }],
      ["b", { ...summary("b"), project: { ...createEmptyProject(), solveMode: true } }],
      ["c", { ...summary("c"), project: { ...createEmptyProject(), solveMode: true, poolMode: true } }],
    ]);
    storage.readDesign.mockImplementation(async (id) => records.get(id));
    storage.writeDesign.mockImplementation(async (record) => { records.set(record.id, record); });
    storage.readActiveDesignId.mockReturnValue("a");
    await useDesignStore.getState().hydrate();
    for (const id of ["a", "b", "c", "a"]) {
      await useDesignStore.getState().switchToDesign(id);
      expect(modeOf()).toEqual({ plan: true, solve: true, pool: false });
    }
    await useDesignStore.getState().reloadActiveDesign();
    expect(modeOf()).toEqual({ plan: true, solve: true, pool: false });
    // Opening is a view: nothing was converted in storage.
    expect(records.get("a")?.project.planMode).toBeUndefined();
    expect(records.get("b")?.project.planMode).toBeUndefined();
    expect(records.get("c")?.project.poolMode).toBe(true);
    expect(storage.writeDesign).not.toHaveBeenCalled();
  });

  it("opens public posts in the one mode without writing personal designs", async () => {
    useDesignStore.setState({ activeDesignId: undefined, publicView: undefined, publicViews: [], designs: [] });
    const store = useDesignStore.getState();
    const original = { ...createEmptyProject(), solveMode: true, poolMode: true };
    await store.viewPublicProject({ id: "pool-post", name: "Pool" }, original);
    expect(modeOf()).toEqual({ plan: true, solve: true, pool: false });
    expect(useFactoryStore.getState().planNotice?.origin).toBe("pool");
    await store.viewPublicProject({ id: "build-post", name: "Build" }, createEmptyProject());
    expect(modeOf()).toEqual({ plan: true, solve: true, pool: false });
    expect(useFactoryStore.getState().planNotice).toBeNull();
    await store.switchToPublicView("pool-post");
    expect(modeOf()).toEqual({ plan: true, solve: true, pool: false });
    expect(original.poolMode).toBe(true);
    expect(storage.writeDesign).not.toHaveBeenCalled();
  });
});

describe("two browser tabs on one library (Jack, 2026-09-23: hours lost to a second tab)", () => {
  const T0 = "2026-09-23T10:00:00.000Z";
  const T1 = "2026-09-23T15:00:00.000Z";

  beforeEach(async () => {
    useDesignStore.setState({ publicView: undefined, publicViews: [], tabConflict: undefined });
    storage.readActiveDesignId.mockReturnValue("a");
  });

  /** This tab opens design "a" as stored at T0; returns the library map. */
  async function openAt(...more: DesignSummary[]) {
    const current = library(summary("a", { updatedAt: T0 }), ...more);
    await useDesignStore.getState().hydrate();
    storage.writeDesign.mockClear();
    return current;
  }

  /** Another tab saves a newer "a". */
  function otherTabSaves(current: Map<string, DesignSummary>) {
    current.set("a", { ...current.get("a")!, updatedAt: T1 });
  }

  const writesOf = (id: string) =>
    storage.writeDesign.mock.calls.filter(([record]) => record.id === id).length;

  it("never saves an old copy over a newer version: this tab's edits become a copy", async () => {
    const current = await openAt();
    otherTabSaves(current);
    useFactoryStore.getState().renameProject("An edit made on the old copy");
    await useDesignStore.getState().saveActiveProject("a", useFactoryStore.getState().project);

    expect(writesOf("a")).toBe(0);
    expect(current.get("a")?.updatedAt).toBe(T1);
    const copy = storage.writeDesign.mock.calls.at(-1)?.[0];
    expect(copy?.name).toBe("Design a (conflict copy)");
    expect(useDesignStore.getState().activeDesignId).toBe(copy?.id);
    expect(useDesignStore.getState().tabConflict).toEqual({
      name: "Design a",
      copyName: "Design a (conflict copy)",
    });
  });

  it("an untouched old copy is never written, not even on the way out", async () => {
    const current = await openAt(summary("b"));
    otherTabSaves(current);
    await useDesignStore.getState().switchToDesign("b");
    expect(writesOf("a")).toBe(0);
    expect(current.get("a")?.updatedAt).toBe(T1);
  });

  it("writes nothing a background tab changed by itself", async () => {
    await openAt();
    tabs.editing = false;
    useFactoryStore.getState().renameProject("A recipe refresh, say");
    await useDesignStore.getState().saveActiveProject("a", useFactoryStore.getState().project);
    expect(storage.writeDesign).not.toHaveBeenCalled();
  });

  it("two saves in flight at once never make a conflict copy of this tab's own work", async () => {
    // A player on one browser tab got "(conflict copy) (conflict copy) ..."
    // over and over (2026-09-25): a big plan's write was still landing when
    // the next autosave started, both checked against the same stored version,
    // and the second one read the first as another tab's save.
    const current = await openAt();
    useFactoryStore.getState().renameProject("First edit");
    const first = useDesignStore.getState().saveActiveProject("a", useFactoryStore.getState().project);
    useFactoryStore.getState().renameProject("Second edit");
    const second = useDesignStore.getState().saveActiveProject("a", useFactoryStore.getState().project);
    await Promise.all([first, second]);

    expect(useDesignStore.getState().tabConflict).toBeUndefined();
    expect(useDesignStore.getState().activeDesignId).toBe("a");
    expect([...current.keys()]).toEqual(["a"]);
    expect(storage.writeDesign.mock.calls.at(-1)?.[0].project.name).toBe("Design a");
    expect(writesOf("a")).toBe(2);
  });

  it("a conflict copy of a conflict copy does not stack the words", async () => {
    const current = library(summary("a", { updatedAt: T0, name: "Oil (conflict copy)" }));
    await useDesignStore.getState().hydrate();
    otherTabSaves(current);
    useFactoryStore.getState().renameProject("An edit");
    await useDesignStore.getState().saveActiveProject("a", useFactoryStore.getState().project);
    expect(useDesignStore.getState().tabConflict?.copyName).toBe("Oil (conflict copy) (2)");
  });

  it("a conflict copy's name fits the account's 80 characters", async () => {
    const long = "a".repeat(78);
    const current = library(summary("a", { updatedAt: T0, name: long }));
    await useDesignStore.getState().hydrate();
    otherTabSaves(current);
    useFactoryStore.getState().renameProject("An edit");
    await useDesignStore.getState().saveActiveProject("a", useFactoryStore.getState().project);
    const copyName = useDesignStore.getState().tabConflict?.copyName ?? "";
    expect(copyName.length).toBeLessThanOrEqual(80);
    expect(copyName.endsWith("(conflict copy)")).toBe(true);
  });

  it("saves its own edits and tells the other tabs", async () => {
    const current = await openAt();
    useFactoryStore.getState().renameProject("Real work");
    await useDesignStore.getState().saveActiveProject("a", useFactoryStore.getState().project);
    expect(writesOf("a")).toBe(1);
    expect(tabs.announced.map((message) => message.designId)).toEqual(["a"]);
    expect(tabs.announced[0]?.updatedAt).toBe(current.get("a")?.updatedAt);
  });

  it("loads another tab's save when it has nothing of its own, and keeps its edits when it has", async () => {
    const current = await openAt();
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const { startDesignTabSync } = await import("./design-store");
    const stop = startDesignTabSync();
    try {
      otherTabSaves(current);
      const newer = { ...createEmptyProject(), notes: "Three hours of tetranitromethane" };
      storage.readDesign.mockImplementation(async (id) =>
        id === "a" ? { ...current.get("a")!, project: newer } : undefined,
      );
      tabs.heard?.({ designId: "a", updatedAt: T1 });
      await vi.waitFor(() =>
        expect(useFactoryStore.getState().project.notes).toBe("Three hours of tetranitromethane"),
      );

      // Now this tab edits, and another save arrives: its edits stay put.
      useFactoryStore.getState().renameProject("Mine");
      current.set("a", { ...current.get("a")!, updatedAt: "2026-09-23T16:00:00.000Z" });
      tabs.heard?.({ designId: "a", updatedAt: "2026-09-23T16:00:00.000Z" });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(useFactoryStore.getState().project.name).toBe("Mine");
    } finally {
      stop();
      vi.unstubAllGlobals();
    }
  });
});

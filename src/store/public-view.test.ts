import { afterEach, describe, expect, it } from "vitest";
import { createEmptyProject } from "@/examples";
import { useFactoryStore } from "./factory-store";

afterEach(() => useFactoryStore.getState().markHydratedProject(createEmptyProject()));

describe("public viewing edit boundary", () => {
  it("rejects edits, import, paste, and undo without changing the plan or its books", () => {
    const store = useFactoryStore.getState();
    store.markHydratedProject(createEmptyProject());
    store.addCustomRateNode();
    store.loadViewedProject({ ...useFactoryStore.getState().project, name: "Public original" });
    const before = useFactoryStore.getState();
    store.updateNode(before.project.nodes[0].id, { machineCount: 99 });
    store.deleteNode(before.project.nodes[0].id);
    store.renameProject("Changed");
    store.setProjectIdentity({ description: "Changed" });
    store.setProject(createEmptyProject());
    store.addCustomRateNode();
    store.setBoardMode("pool");
    store.cleanBoard();
    store.pasteBoardItems(
      { nodes: [], edges: [], recipes: [], storages: [], annotations: [], pockets: [] },
      { x: 20, y: 20 },
    );
    store.undo();
    store.redo();
    const after = useFactoryStore.getState();
    expect(after.project).toBe(before.project);
    expect(after.lastResult).toBe(before.lastResult);
    expect(after.undoHistory).toEqual([]);
    expect(after.redoHistory).toEqual([]);
  });

  it("allows display units and temporary checklist marks without edits or history", () => {
    const store = useFactoryStore.getState();
    store.markHydratedProject(createEmptyProject());
    store.addCustomRateNode();
    const original = useFactoryStore.getState().project;
    store.loadViewedProject(original);
    const before = useFactoryStore.getState();
    store.setRateUnit("hour");
    expect(useFactoryStore.getState().rateUnit).toBe("hour");
    expect(useFactoryStore.getState().project).toBe(before.project);
    store.setPowerDisplayUnit("HV");
    expect(useFactoryStore.getState().powerDisplayUnit).toBe("HV");
    expect(useFactoryStore.getState().project).toBe(before.project);
    expect(useFactoryStore.getState().lastResult).toBe(before.lastResult);
    store.setChecklistMode(true);
    store.toggleChecklist("cards", [before.project.nodes[0].id]);
    const checked = useFactoryStore.getState();
    expect(checked.project.checklist?.cards).toEqual([before.project.nodes[0].id]);
    expect(original.checklist).toBeUndefined();
    expect(checked.project.nodes).toBe(before.project.nodes);
    expect(checked.lastResult).toBe(before.lastResult);
    expect(checked.undoHistory).toEqual([]);
    store.updateNode(before.project.nodes[0].id, { machineCount: 99 });
    expect(useFactoryStore.getState().project).toBe(checked.project);
    store.clearChecklist();
    expect(useFactoryStore.getState().project.checklist).toBeUndefined();
    expect(useFactoryStore.getState().undoHistory).toEqual([]);
    store.loadViewedProject(original);
    expect(useFactoryStore.getState().checklistMode).toBe(false);
    expect(useFactoryStore.getState().project.checklist).toBeUndefined();
    store.setRateUnit("second");
    store.setPowerDisplayUnit("eu");
  });

  it("blocks resource browsing until a personal design opens", () => {
    const store = useFactoryStore.getState();
    store.loadViewedProject(createEmptyProject());
    const resource = { kind: "item" as const, id: "test", displayName: "Test" };
    for (const mode of ["recipes", "uses"] as const) {
      store.browseResource(resource, mode);
      expect(useFactoryStore.getState().recipeBrowserResource).toBeUndefined();
    }
    store.markHydratedProject(createEmptyProject());
    for (const mode of ["recipes", "uses"] as const) {
      store.browseResource(resource, mode);
      expect(useFactoryStore.getState().recipeBrowserResource?.id).toBe("test");
      expect(useFactoryStore.getState().recipeBrowserMode).toBe(mode);
    }
    store.renameProject("My editable copy");
    expect(useFactoryStore.getState().isReadOnly).toBe(false);
    expect(useFactoryStore.getState().project.name).toBe("My editable copy");
  });

  it("still resolves dataset resources when a shared link arrives before the dataset", () => {
    const store = useFactoryStore.getState();
    store.loadViewedProject(createEmptyProject());
    store.setDataset({
      schemaVersion: 1,
      recipes: [],
      resources: [],
      datasetVersionId: "viewer-test",
      gtnhVersion: "2.9",
      sourceInfo: { sourceId: "unknown", generatedAt: "2026-09-10" },
      oreDictionary: {},
      recipeMaps: [],
      generatedAt: "2026-09-10",
    });
    expect(useFactoryStore.getState().dataset?.datasetVersionId).toBe("viewer-test");
    expect(useFactoryStore.getState().isDatasetLoading).toBe(false);
    expect(useFactoryStore.getState().isReadOnly).toBe(true);
    expect(useFactoryStore.getState().undoHistory).toEqual([]);
  });
});


it("allows screenshot mode previews without changing the author's plan or unlocking edits", () => {
  const store = useFactoryStore.getState();
  const original = createEmptyProject();
  store.loadViewedProject(original);
  const before = useFactoryStore.getState();
  for (const mode of ["pool", "solve", "build"] as const) {
    store.setScreenshotMode(mode);
    const next = useFactoryStore.getState();
    expect(Boolean(next.project.poolMode)).toBe(mode === "pool");
    expect(Boolean(next.project.solveMode)).toBe(mode !== "build");
    expect(next.isReadOnly).toBe(true);
    expect(next.project.nodes).toBe(before.project.nodes);
    expect(next.undoHistory).toEqual([]);
    store.renameProject("Not allowed");
    expect(useFactoryStore.getState().project).toBe(next.project);
  }
  expect(original.solveMode).toBeUndefined();
  expect(original.poolMode).toBeUndefined();
});

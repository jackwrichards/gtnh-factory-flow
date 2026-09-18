import { beforeEach, describe, expect, it } from "vitest";
import { captureBoardSelection, useFactoryStore } from "./factory-store";
import { PROJECT_SCHEMA_VERSION, type FactoryProject } from "../lib/model/types";
import { boardSelectionPayloadSchema } from "../lib/model/schemas";
const empty = (): FactoryProject => ({
  schemaVersion: PROJECT_SCHEMA_VERSION,
  id: "group-store",
  name: "Groups",
  poolMode: true,
  solveMode: true,
  recipes: [
    {
      id: "r",
      name: "Recipe",
      machineType: "Machine",
      durationTicks: 20,
      eut: 30,
      minimumTier: "LV",
      inputs: [],
      outputs: [{ kind: "item", id: "x", amount: 1 }],
    },
  ],
  nodes: [
    {
      id: "node",
      recipeId: "r",
      machineCount: 1,
      parallel: 1,
      overclockTier: "LV",
      enabled: true,
      position: { x: 0, y: 0 },
    },
  ],
  storages: [],
  edges: [],
  fuelProfiles: [],
});
beforeEach(() => {
  useFactoryStore.setState({ isReadOnly: false });
  useFactoryStore.getState().setProject(empty());
});
describe("production group mutations", () => {
  it("rejects cyclic parents and dissolves a group into its parent in one undo step", () => {
    const store = useFactoryStore.getState();
    const parent = store.createProductionGroup("Parent")!;
    const child = store.createProductionGroup("Child", parent)!;
    store.moveToProductionGroup(["node"], child);
    store.updateProductionGroup(parent, { parentId: child });
    expect(useFactoryStore.getState().project.productionGroups![0].parentId).toBeUndefined();
    store.dissolveProductionGroup(child);
    expect(useFactoryStore.getState().project.nodes[0].productionGroupId).toBe(parent);
    store.undo();
    expect(useFactoryStore.getState().project.nodes[0].productionGroupId).toBe(child);
  });
  it("round-trips ancestor scopes and remaps them when pasting into another plan", () => {
    const store = useFactoryStore.getState();
    const parent = store.createProductionGroup("Parent")!;
    const child = store.createProductionGroup("Child", parent)!;
    store.setPoolResourceRule(child, "item:x", "share");
    store.moveToProductionGroup(["node"], child);
    const captured = captureBoardSelection(useFactoryStore.getState().project, ["node"])!;
    const payload = boardSelectionPayloadSchema.parse(captured);
    expect(payload.productionGroups).toHaveLength(2);
    store.setProject({ ...empty(), nodes: [] });
    store.pasteBoardItems(payload, { x: 100, y: 100 });
    const p = useFactoryStore.getState().project;
    const copyChild = p.productionGroups!.find((g) => g.name === "Child")!;
    expect(copyChild.id).not.toBe(child);
    expect(p.nodes[0].productionGroupId).toBe(copyChild.id);
    expect(copyChild.parentId).toBe(p.productionGroups!.find((g) => g.name === "Parent")!.id);
    expect(copyChild.resourceRules).toEqual({ "item:x": "share" });
  });
  it("keeps identical product targets independent in different groups", () => {
    const store = useFactoryStore.getState();
    const group = store.createProductionGroup("Line")!;
    store.addPoolStorage({ kind: "item", id: "x" }, "drain");
    store.addPoolStorage({ kind: "item", id: "x" }, "drain", undefined, group);
    const [root, local] = useFactoryStore.getState().project.storages!;
    expect(root.id).not.toBe(local.id);
    store.setStorageTarget(root.id, 2);
    store.setStorageTarget(local.id, 3);
    expect(useFactoryStore.getState().project.storages!.map((s) => s.targetPerSecond)).toEqual([
      2, 3,
    ]);
  });
  it("keeps a product dragged from a machine in that machine's production group", () => {
    const store = useFactoryStore.getState();
    const group = store.createProductionGroup("Line")!;
    store.addPoolStorage({ kind: "item", id: "x" }, "drain");
    store.moveToProductionGroup(["node"], group);
    store.addStorageForConnection(
      { kind: "item", id: "x", amount: 1 },
      "node",
      "output",
      { x: 500, y: 200 },
      "output:item:x",
    );
    expect(useFactoryStore.getState().project.storages!.map((s) => s.productionGroupId)).toEqual([
      undefined,
      group,
    ]);
    store.addStorageForConnection(
      { kind: "item", id: "x", amount: 1 },
      "node",
      "output",
      { x: 900, y: 200 },
      "output:item:x",
    );
    expect(useFactoryStore.getState().project.storages).toHaveLength(2);
  });
  it("does not permit mutations in a read-only plan", () => {
    const store = useFactoryStore.getState();
    const group = store.createProductionGroup("Line")!;
    const original = useFactoryStore.getState().project;
    useFactoryStore.setState({ isReadOnly: true });
    store.createProductionGroup("Blocked");
    store.updateProductionGroup(group, { name: "Blocked" });
    store.moveToProductionGroup(["node"], group);
    store.setPoolResourceRule(group, "item:x", "import");
    store.dissolveProductionGroup(group);
    expect(useFactoryStore.getState().project).toBe(original);
  });
});

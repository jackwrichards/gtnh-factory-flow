import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject, type ResourceAmount } from "@/lib/model/types";
import { getStorageRole } from "@/lib/model/storage-role";
import { makeResourceHandleId, sectionHandleId } from "@/components/flow/resource-handles";
import { useFactoryStore } from "./factory-store";

const fluid: ResourceAmount = { kind: "fluid", id: "hydrochloricacid_gt5u", amount: 1000 };
const cell: ResourceAmount = { kind: "item", id: "gregtech:gt.metaitem.01@30683", amount: 1 };
function project(fluidToCell: boolean, storageSource = true): FactoryProject {
  const from = fluidToCell ? fluid : cell;
  const to = fluidToCell ? cell : fluid;
  const node = (id: string, recipeId = id) => ({ id, recipeId, machineCount: 1, parallel: 1, overclockTier: "MV", enabled: true, position: { x: 0, y: 0 } });
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION, id: "acid-buffer", name: "Acid buffer", fuelProfiles: [],
    recipes: [
      { id: "furnace", name: "Electric Blast Furnace", machineType: "Electric Blast Furnace", durationTicks: 20, eut: 120, minimumTier: "MV", inputs: [], outputs: [] },
      { id: "maker", name: "Acid maker", machineType: "Bender", durationTicks: 20, eut: 30, minimumTier: "LV", inputs: [], outputs: [from] },
      { id: "taker", name: "Acid taker", machineType: "Bender", durationTicks: 20, eut: 30, minimumTier: "LV", inputs: [to], outputs: [] },
    ],
    nodes: [node("furnace"), node("maker"), node("taker"), ...(storageSource ? [node("taker2", "taker")] : [])],
    storages: [{ id: "buffer", kind: storageSource ? from.kind : to.kind, resourceId: storageSource ? from.id : to.id, position: { x: -700, y: -140 } }],
    edges: storageSource ? [
      { id: "feed", source: "maker", target: "buffer", resourceKind: from.kind, resourceId: from.id },
      ...["taker", "taker2"].map(target => ({ id: `wire-${target}`, source: "buffer", target, resourceKind: from.kind, resourceId: from.id,
        sourceHandle: makeResourceHandleId("output", from), targetHandle: makeResourceHandleId("input", to), crossForm: { litresPerCell: 1000 } })),
    ] : [
      { id: "wire", source: "maker", target: "buffer", resourceKind: from.kind, resourceId: from.id,
        sourceHandle: makeResourceHandleId("output", from), targetHandle: makeResourceHandleId("input", to), crossForm: { litresPerCell: 1000 } },
      { id: "drain", source: "buffer", target: "taker", resourceKind: to.kind, resourceId: to.id },
    ],
  } as FactoryProject;
}

describe.each([true, false])("storage conversion wire survival (fluid to cell: %s)", fluidToCell => {
  it.each([true, false])("keeps the buffer and all wires after an unrelated tier edit (storage source: %s)", storageSource => {
    useFactoryStore.getState().setProject(project(fluidToCell, storageSource));
    const before = useFactoryStore.getState().project;
    expect(getStorageRole(before, "buffer")).toBe("buffer");
    useFactoryStore.getState().updateNode("furnace", { overclockTier: "HV" });
    const after = useFactoryStore.getState().project;
    expect(after.edges).toEqual(before.edges);
    expect(after.storages).toEqual(before.storages);
    expect(getStorageRole(after, "buffer")).toBe("buffer");
    useFactoryStore.getState().undo();
    expect(useFactoryStore.getState().project.edges).toEqual(before.edges);
    useFactoryStore.getState().redo();
    expect(useFactoryStore.getState().project.edges).toEqual(before.edges);
    useFactoryStore.getState().setProject(JSON.parse(JSON.stringify(after)));
    useFactoryStore.getState().updateNode("taker", { machineCount: 2 });
    expect(useFactoryStore.getState().project.edges).toEqual(before.edges);
  });

  it("keeps a conversion landing on an extra recipe section", () => {
    const p = project(fluidToCell);
    const taker = p.nodes.find(n => n.id === "taker")!;
    taker.extraRecipes = [{ recipeId: "taker" }];
    taker.recipeId = "furnace";
    const wire = p.edges.find(e => e.target === "taker")!;
    wire.targetHandle = sectionHandleId(1, wire.targetHandle!);
    useFactoryStore.getState().setProject(p);
    useFactoryStore.getState().updateNode("furnace", { overclockTier: "HV" });
    expect(useFactoryStore.getState().project.edges).toEqual(p.edges);
  });

  it("still removes a wire whose receiving recipe no longer accepts its cell or fluid", () => {
    useFactoryStore.getState().setProject(project(fluidToCell));
    useFactoryStore.getState().updateNode("taker", { recipeId: "furnace" });
    expect(useFactoryStore.getState().project.edges.map(e => e.id)).toEqual(["feed", "wire-taker2"]);
    expect(getStorageRole(useFactoryStore.getState().project, "buffer")).toBe("buffer");
  });
});

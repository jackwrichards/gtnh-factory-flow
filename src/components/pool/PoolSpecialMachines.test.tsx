// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PoolWorksheet } from "./PoolWorksheet";
import { useFactoryStore } from "@/store/factory-store";
import { DEFAULT_WORKSPACE_VIEW, writeWorkspaceView } from "@/lib/workspace-view";
import { createCropFarmPlaceholderRecipe, enrichPassiveProductionRecipe } from "@/lib/model/passive-production";
import { PROJECT_SCHEMA_VERSION, type Recipe, type FactoryProject } from "@/lib/model/types";
import { buildPowerRecipe } from "@/lib/power/power-recipe";
import { buildWorksheetGroups } from "./worksheet-model";

const crop = () => enrichPassiveProductionRecipe({
  id: "crop", name: "Crop Farm: Argentia", machineType: "Crop Farm", minimumTier: "NONE", durationTicks: 3328, eut: 0,
  inputs: [{ kind: "item", id: "factoryflow:cropsnh_seed:argentia", amount: 1, consumed: false, displayName: "Argentia Seeds" }],
  outputs: [{ kind: "item", id: "leaf", amount: 2.29, displayName: "Argentia Leaf" }],
  metadata: { cropsNh: { tier: 7, growthPoints: 1400, dropChance: .6983373, growthCycleTicks: 256, growthMultiplier: 1,
    drops: [{ id: "leaf", stackSize: 1, weight: 10000 }] } }, source: { recipeMap: "Crop Farm" },
});
const bee = () => enrichPassiveProductionRecipe({
  id: "bee", name: "Bee Produce: Explosive Bee", machineType: "Bee Produce", minimumTier: "NONE", durationTicks: 550, eut: 0,
  inputs: [{ kind: "item", id: "factoryflow:bee_species:explosive", amount: 1, displayName: "Explosive Bee", consumed: false },
    { kind: "item", id: "factoryflow:bee_frame_slot_1", amount: 1, consumed: false, displayName: "Frame placeholder" }],
  outputs: [{ kind: "item", id: "tnt", amount: .02, displayName: "Industrial TNT" }], source: { recipeMap: "Bee Produce" },
});
function plan(recipe: Recipe): FactoryProject {
  return { schemaVersion: PROJECT_SCHEMA_VERSION, id: "special", name: "Special machines", solveMode: true, poolMode: true,
    recipes: [recipe], nodes: [{ id: "machine", recipeId: recipe.id, machineCount: 1, solvePin: 1, parallel: 1, overclockTier: recipe.minimumTier,
      enabled: true, settingsCollapsed: true, position: { x: 0, y: 0 } }], edges: [], storages: [], fuelProfiles: [] };
}
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  writeWorkspaceView({ ...DEFAULT_WORKSPACE_VIEW });
  useFactoryStore.setState({ isReadOnly: false, checklistMode: false, dataset: {
    schemaVersion: 1, datasetVersionId: "special", gtnhVersion: "2.9", generatedAt: "fixed",
    sourceInfo: { sourceId: "unknown", generatedAt: "fixed" }, resources: [], recipes: [], oreDictionary: {}, recipeMaps: [],
    recipeMapIcons: [{ recipeMap: "Crop Farm", resource: { kind: "item", id: "oak", displayName: "Oak Bonsai Seeds" } },
      { recipeMap: "Bee Produce", resource: { kind: "item", id: "bee", displayName: "Bee specimen" } }],
  } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useFactoryStore.setState({ dataset: undefined }); });

describe("Pool specialized machines", () => {
  it("applies Tree Growth Simulator tool choices to its output", () => {
    const recipe: Recipe = { id: "tgs", name: "Oak", machineType: "Tree Growth Simulator", minimumTier: "LV", durationTicks: 100, eut: 8,
      inputs: [{ kind: "item", id: "sapling", amount: 1, consumed: false }],
      outputs: [{ kind: "item", id: "log", amount: 5, neiSlot: { x: 108, y: 36 } }],
      machineConfigControls: [{ id: "tgsToolSlot1", label: "Tool Slot 1", minimumKey: "none", defaultKey: "none", tiers: [
        { key: "none", label: "Empty", resource: { kind: "item", id: "empty", amount: 1 } },
        { key: "log:saw", label: "Saw", outputMultiplier: 1, resource: { kind: "item", id: "saw", amount: 1 } },
      ] }], source: { recipeMap: "Tree Growth Simulator" } };
    useFactoryStore.getState().setProject(plan(recipe));
    render(<PoolWorksheet />);
    expect(useFactoryStore.getState().lastResult!.nodes.machine.outputs["item:log"].amountPerSecond).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Settings for Tree Growth Simulator" }));
    fireEvent.click(screen.getByRole("button", { name: "Next Tool Slot 1" }));
    expect(useFactoryStore.getState().project.nodes[0].machineConfigTiers?.tgsToolSlot1).toBe("log:saw");
    expect(useFactoryStore.getState().lastResult!.nodes.machine.outputs["item:log"].amountPerSecond).toBeGreaterThan(0);
  });
  it("keeps generator-specific controls available in the compact settings panel", () => {
    const recipe = buildPowerRecipe("large-gas-turbine", { rotor: "Carbon", size: "Normal", fitting: "tight", flowMode: "optimal", fuel: "Benzene" }, "power")!;
    const project = plan(recipe);
    project.nodes[0].machineConfigTiers = { rotor: "Carbon", size: "Normal", fitting: "tight", flowMode: "optimal", fuel: "Benzene" };
    useFactoryStore.getState().setProject(project);
    const { container } = render(<PoolWorksheet />);
    fireEvent.click(screen.getByRole("button", { name: /^Settings for / }));
    expect(container.querySelector(".pool-machine-settings")?.textContent).toMatch(/Rotor/i);
    expect(useFactoryStore.getState().project.recipes[0].power!.euPerTick).toBeGreaterThan(0);
  });
  it("lets a legacy empty farm choose its harvester before picking a crop, and keeps that choice", () => {
    const empty = createCropFarmPlaceholderRecipe();
    empty.machineHandlers = []; // Previously saved empty card.
    useFactoryStore.getState().setProject(plan(empty));
    const { container } = render(<PoolWorksheet />);
    expect(container.querySelector('.pool-machine-title')?.textContent).toBe("Crop Manager");
    expect(screen.getByRole("button", { name: "Pick a crop" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change machine: Crop Manager" }));
    fireEvent.click(screen.getByRole("option", { name: "Industrial Farm" }));
    expect(useFactoryStore.getState().project.nodes[0].machineHandlerId).toBe("crop-industrial-farm");
    act(() => useFactoryStore.getState().setNodeRecipe("machine", crop()));
    expect(useFactoryStore.getState().project.nodes[0].machineHandlerId).toBe("crop-industrial-farm");
    expect(screen.getByRole("button", { name: "Change crop: Argentia" })).toBeTruthy();
    expect(container.querySelector('.pool-editor-power [data-crop-picker-toggle]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Settings for Industrial Farm" }));
    expect(screen.queryByText("Machine settings")).toBeNull();
    expect(screen.getByRole("button", { name: "More Growth" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change machine: Industrial Farm" }));
    fireEvent.click(screen.getByRole("option", { name: /Crop Manager/ }));
    const settings = screen.getByRole("region", { name: "Machine settings for Crop Manager" });
    expect(within(settings).getByText("Water")).toBeTruthy();
    const before = useFactoryStore.getState().lastResult!.nodes.machine.outputs["item:leaf"].amountPerSecond;
    fireEvent.click(within(settings).getByRole("button", { name: "Fewer Gain" }));
    const after = useFactoryStore.getState().lastResult!.nodes.machine.outputs["item:leaf"].amountPerSecond;
    expect(after).toBeLessThan(before);
  });
  it("switches bee housing and exposes controls even when the board panel was folded", () => {
    useFactoryStore.getState().setProject(plan(bee()));
    const { container } = render(<PoolWorksheet />);
    expect(container.querySelector('.pool-machine-title')?.textContent).toBe("Magic Apiary");
    fireEvent.click(screen.getByRole("button", { name: "Settings for Magic Apiary" }));
    const settings = screen.getByRole("region", { name: "Machine settings for Magic Apiary" });
    expect(within(settings).getByText("Speed Gene")).toBeTruthy();
    expect(within(settings).getAllByText("Frame 1")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Change machine: Magic Apiary" }));
    for (const label of ["Magic Apiary", "Alveary", "Industrial Apiary", "Mega Apiary"]) {
      expect(screen.getByRole("option", { name: new RegExp(label) })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("option", { name: /Industrial Apiary/ }));
    expect(useFactoryStore.getState().project.nodes[0].machineHandlerId).toBe("industrial-apiary");
    expect(screen.getByRole("region", { name: "Machine settings for Industrial Apiary" })).toBeTruthy();
    const state = useFactoryStore.getState();
    const groups = buildWorksheetGroups(state.project, state.lastResult!);
    expect(groups[0].sections[0].nonConsumed.map(input => input.id)).not.toContain("factoryflow:bee_frame_slot_1");
    expect(groups[0].sections[0].nonConsumed.map(input => input.id)).toContain("factoryflow:bee_species:explosive");
  });
});

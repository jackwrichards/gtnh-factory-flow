import { describe, expect, it } from "vitest";
import {
  buildMachineHandlerTemplates,
  instantiateRecipeMachineHandlers,
  machineConfigControlsForOracleRecipe,
  primaryMachineHandlerControls,
} from "./machine-configs.mjs";

function catalyst(displayName, { tooltip = [], sourceClass = "", priority = 0 } = {}) {
  return {
    resource: { kind: "item", id: `gregtech:${displayName}`, displayName, tooltip },
    priority,
    sourceClass,
  };
}

const MULTI_CLASS = "gregtech.common.tileentities.machines.multi.GT_MetaTileEntity_Example";
const GTPP_MULTI_CLASS =
  "gtPlusPlus.xmod.gregtech.common.tileentities.machines.multi.production.GregtechMetaTileEntity_Example";
const SINGLE_CLASS = "gregtech.common.tileentities.machines.basic.GT_MetaTileEntity_Example";

describe("buildMachineHandlerTemplates", () => {
  it("keeps the map's own machine first and marks it primary", () => {
    const templates = buildMachineHandlerTemplates("Distillation Tower", [
      catalyst("Dangote Distillus", {
        sourceClass: GTPP_MULTI_CLASS,
        tooltip: ["Controller Block for the Dangote Distillus", "Parallel: 12"],
        priority: 10,
      }),
      catalyst("Distillation Tower", { sourceClass: MULTI_CLASS }),
    ]);

    expect(templates.map((template) => template.label)).toEqual([
      "Distillation Tower",
      "Dangote Distillus",
    ]);
    expect(templates[0].isPrimary).toBe(true);
    expect(templates[0].machineConfigControls).toBeUndefined();
  });

  it("keeps one machine's fixed parallels off the primary machine", () => {
    const templates = buildMachineHandlerTemplates("Distillation Tower", [
      catalyst("Distillation Tower", { sourceClass: MULTI_CLASS }),
      catalyst("Dangote Distillus", {
        sourceClass: GTPP_MULTI_CLASS,
        tooltip: ["Parallel: 12"],
      }),
    ]);

    expect(primaryMachineHandlerControls(templates)).toEqual([]);
    const dangote = templates.find((template) => template.label === "Dangote Distillus");
    expect(dangote.machineConfigControls).toHaveLength(1);
    expect(dangote.machineConfigControls[0].id).toBe("machineParallel");
    expect(dangote.machineConfigControls[0].tiers[0].parallelMultiplier).toBe(12);
  });

  it("folds tiered singleblock variants into one family with the lowest tier", () => {
    const templates = buildMachineHandlerTemplates("Fluid Extractor", [
      catalyst("Basic Fluid Extractor (LV)", { sourceClass: SINGLE_CLASS }),
      catalyst("Advanced Fluid Extractor (MV)", { sourceClass: SINGLE_CLASS }),
      catalyst("Advanced Fluid Extractor II (HV)", { sourceClass: SINGLE_CLASS }),
      catalyst("Large Fluid Extractor", {
        sourceClass: GTPP_MULTI_CLASS,
        tooltip: ["Speed: +50%", "EU Usage: 90%", "Max Parallels: 4"],
      }),
    ]);

    expect(templates.map((template) => template.label)).toEqual([
      "Fluid Extractor",
      "Large Fluid Extractor",
    ]);
    expect(templates[0].minimumTier).toBe("LV");
    expect(templates[0].kind).toBe("single");
    expect(templates[1].kind).toBe("multiblock");
  });

  it("reads GT++ style speed, EU usage, and parallel stats from the tooltip", () => {
    const templates = buildMachineHandlerTemplates("Blast Furnace", [
      catalyst("Electric Blast Furnace", { sourceClass: MULTI_CLASS }),
      catalyst("Volcanus", {
        sourceClass: GTPP_MULTI_CLASS,
        tooltip: ["Speed: +120%", "EU Usage: 90%", "Parallel: 8"],
      }),
    ]);

    const volcanus = templates.find((template) => template.label === "Volcanus");
    expect(volcanus.durationMultiplier).toBeCloseTo(1 / 2.2);
    expect(volcanus.eutMultiplier).toBeCloseTo(0.9);
    expect(volcanus.machineConfigControls[0].tiers[0].parallelMultiplier).toBe(8);
  });

  it("does not misread tier-scaled bonuses as static bonuses", () => {
    const templates = buildMachineHandlerTemplates("Chemical Plant", [
      catalyst("ExxonMobil Chemical Plant", {
        sourceClass: GTPP_MULTI_CLASS,
        tooltip: ["2 Parallels per Pipe Casing Tier", "+50% Speed per Coil Tier"],
      }),
    ]);

    expect(templates[0].durationMultiplier).toBeUndefined();
    const controls = templates[0].machineConfigControls;
    expect(controls.map((control) => control.id).sort()).toEqual(["heatingCoil", "pipeCasing"]);
    const pipeCasing = controls.find((control) => control.id === "pipeCasing");
    expect(pipeCasing.tiers[0].parallelMultiplier).toBe(2);
    expect(pipeCasing.tiers[1].parallelMultiplier).toBe(4);
  });

  it("strips formatting codes from labels and tooltips", () => {
    const templates = buildMachineHandlerTemplates("Distillation Tower", [
      catalyst("§bDangote Distillus§r", {
        sourceClass: GTPP_MULTI_CLASS,
        tooltip: ["§7Parallel: 12§r"],
      }),
      catalyst("Distillation Tower", { sourceClass: MULTI_CLASS }),
    ]);

    const dangote = templates.find((template) => template.label === "Dangote Distillus");
    expect(dangote).toBeDefined();
    expect(dangote.machineConfigControls[0].tiers[0].parallelMultiplier).toBe(12);
  });
});

describe("instantiateRecipeMachineHandlers", () => {
  const recipe = {
    minimumTier: "EV",
    durationTicks: 220,
    eut: 480,
    machineConfigControls: undefined,
  };

  it("returns nothing when there is no machine choice", () => {
    const templates = buildMachineHandlerTemplates("Chemical Plant", [
      catalyst("ExxonMobil Chemical Plant", { sourceClass: GTPP_MULTI_CLASS }),
    ]);
    expect(instantiateRecipeMachineHandlers(templates, recipe)).toBeUndefined();
  });

  it("computes absolute duration and EU per recipe from the template multipliers", () => {
    const templates = buildMachineHandlerTemplates("Blast Furnace", [
      catalyst("Electric Blast Furnace", { sourceClass: MULTI_CLASS }),
      catalyst("Volcanus", {
        sourceClass: GTPP_MULTI_CLASS,
        tooltip: ["Speed: +120%", "EU Usage: 90%", "Parallel: 8"],
      }),
    ]);

    const handlers = instantiateRecipeMachineHandlers(templates, recipe);
    const volcanus = handlers.find((handler) => handler.label === "Volcanus");
    expect(volcanus.durationTicks).toBe(100);
    expect(volcanus.eut).toBeCloseTo(432);
    const ebf = handlers.find((handler) => handler.label === "Electric Blast Furnace");
    expect(ebf.durationTicks).toBeUndefined();
    expect(ebf.eut).toBeUndefined();
  });

  it("raises the handler minimum tier to the recipe's minimum tier", () => {
    const templates = buildMachineHandlerTemplates("Fluid Extractor", [
      catalyst("Basic Fluid Extractor (LV)", { sourceClass: SINGLE_CLASS }),
      catalyst("Large Fluid Extractor", { sourceClass: GTPP_MULTI_CLASS }),
    ]);

    const handlers = instantiateRecipeMachineHandlers(templates, recipe);
    for (const handler of handlers) {
      expect(handler.minimumTier).toBe("EV");
    }
  });

  it("merges recipe-level controls into handlers that add their own", () => {
    const templates = buildMachineHandlerTemplates("Blast Furnace", [
      catalyst("Electric Blast Furnace", { sourceClass: MULTI_CLASS }),
      catalyst("Volcanus", {
        sourceClass: GTPP_MULTI_CLASS,
        tooltip: ["Parallel: 8"],
      }),
    ]);
    const recipeControls = machineConfigControlsForOracleRecipe("Blast Furnace", 1800, []);

    const handlers = instantiateRecipeMachineHandlers(templates, {
      ...recipe,
      machineConfigControls: recipeControls,
    });
    const volcanus = handlers.find((handler) => handler.label === "Volcanus");
    const ids = volcanus.machineConfigControls.map((control) => control.id).sort();
    expect(ids).toEqual(["heatingCoil", "machineParallel"]);

    const ebf = handlers.find((handler) => handler.label === "Electric Blast Furnace");
    expect(ebf.machineConfigControls).toBeUndefined();
  });
});

describe("machineConfigControlsForOracleRecipe", () => {
  it("gives the Chemical Plant a heating coil speed control defaulting to Kanthal", () => {
    const controls = machineConfigControlsForOracleRecipe("Chemical Plant", 5, []);
    const coil = controls.find((control) => control.id === "heatingCoil");
    expect(coil).toBeDefined();
    expect(coil.minimumKey).toBe("cupronickel");
    expect(coil.defaultKey).toBe("kanthal");

    const byKey = new Map(coil.tiers.map((tier) => [tier.key, tier]));
    expect(byKey.get("cupronickel").durationMultiplier).toBeCloseTo(2);
    expect(byKey.get("kanthal").durationMultiplier).toBeCloseTo(1);
    expect(byKey.get("nichrome").durationMultiplier).toBeCloseTo(2 / 3);
    expect(byKey.get("kanthal").eutMultiplier).toBeUndefined();
  });

  it("keeps the catalyst-derived controls of the primary machine", () => {
    const templates = buildMachineHandlerTemplates("Chemical Plant", [
      catalyst("ExxonMobil Chemical Plant", {
        sourceClass: GTPP_MULTI_CLASS,
        tooltip: ["2 Parallels per Pipe Casing Tier"],
      }),
    ]);
    const controls = machineConfigControlsForOracleRecipe(
      "Chemical Plant",
      5,
      primaryMachineHandlerControls(templates),
    );
    expect(controls.map((control) => control.id).sort()).toEqual(["heatingCoil", "pipeCasing"]);
  });
});

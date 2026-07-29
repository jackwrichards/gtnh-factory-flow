import { describe, expect, it } from "vitest";
import {
  applyMachineHandlerToRecipe,
  getRecipeCoilTierControl,
  getRecipeMachineConfigTierControls,
  getRecipeMachineHandlers,
  getSelectedMachineHandler,
} from "./recipe-rules";
import type { Recipe } from "./types";

describe("recipe machine handlers", () => {
  it("uses machine handlers exported in the dataset", () => {
    const recipe = {
      ...testRecipe("Fluid Extractor"),
      machineHandlers: [
        {
          id: "fluid-extractor",
          label: "Fluid Extractor",
          machineType: "Fluid Extractor",
          minimumTier: "LV",
          kind: "single" as const,
        },
        {
          id: "nei-catalyst-multiblock-fluid-extractor",
          label: "Multiblock Fluid Extractor",
          machineType: "Multiblock Fluid Extractor",
          minimumTier: "LV",
          kind: "multiblock" as const,
        },
      ],
    };

    expect(getRecipeMachineHandlers(recipe).map((handler) => handler.label)).toEqual([
      "Fluid Extractor",
      "Multiblock Fluid Extractor",
    ]);
  });

  it("does not invent a category entry next to dataset handlers", () => {
    const recipe = {
      ...testRecipe("Blast Furnace"),
      machineHandlers: [
        {
          id: "electric-blast-furnace",
          label: "Electric Blast Furnace",
          machineType: "Electric Blast Furnace",
          minimumTier: "MV",
          kind: "multiblock" as const,
        },
        {
          id: "volcanus",
          label: "Volcanus",
          machineType: "Volcanus",
          minimumTier: "MV",
          kind: "multiblock" as const,
        },
      ],
    };

    expect(getRecipeMachineHandlers(recipe).map((handler) => handler.label)).toEqual([
      "Electric Blast Furnace",
      "Volcanus",
    ]);
  });

  it("folds renamed tier variants into their recipe map machine family", () => {
    const recipe: Recipe = {
      ...testRecipe("Fluid Extractor"),
      machineHandlers: [
        {
          id: "nei-catalyst-ultimate-liquefying-sucker",
          label: "Ultimate Liquefying Sucker",
          machineType: "Ultimate Liquefying Sucker",
          minimumTier: "UV",
          kind: "single",
        },
        {
          id: "nei-catalyst-large-fluid-extractor",
          label: "Large Fluid Extractor",
          machineType: "Large Fluid Extractor",
          minimumTier: "EV",
          kind: "multiblock",
        },
      ],
    };

    expect(getRecipeMachineHandlers(recipe).map((handler) => handler.label)).toEqual([
      "Fluid Extractor",
      "Large Fluid Extractor",
    ]);
  });

  it("folds GT voltage-tier display names into the canonical machine family", () => {
    const recipe: Recipe = {
      ...testRecipe("Centrifuge"),
      machineHandlers: [
        {
          id: "turbo-centrifuge",
          label: "Turbo Centrifuge",
          machineType: "Turbo Centrifuge",
          minimumTier: "HV",
          kind: "single",
        },
        {
          id: "molecular-separator",
          label: "Molecular Separator",
          machineType: "Molecular Separator",
          minimumTier: "EV",
          kind: "single",
        },
        {
          id: "molecular-cyclone",
          label: "Molecular Cyclone",
          machineType: "Molecular Cyclone",
          minimumTier: "IV",
          kind: "single",
        },
        {
          id: "molecular-tornado",
          label: "Epic Molecular Tornado IV",
          machineType: "Epic Molecular Tornado IV",
          minimumTier: "UMV",
          kind: "single",
        },
        {
          id: "steam-separator",
          label: "Steam Separator",
          machineType: "Steam Separator",
          minimumTier: "LV",
          kind: "single",
        },
      ],
    };

    expect(getRecipeMachineHandlers(recipe).map((handler) => handler.label)).toEqual([
      "Centrifuge",
      "Steam Separator",
    ]);
  });

  it("folds renamed late-tier machines across GT machine families", () => {
    const cases: Array<[string, string]> = [
      ["Alloy Smelter", "Epic Alloy Integrator IV"],
      ["Assembler", "Ultimate Assembly Constructor"],
      ["Chemical Reactor", "Epic Chemical Performer II"],
      ["Electrolyzer", "Molecular Disintegrator E-4908"],
      ["Ore Washer", "Repurposed Laundry-Washer I-360"],
      ["Thermal Centrifuge", "Blaze Sweatshop T-6350"],
      ["Macerator", "Ultimate Shape Eliminator"],
    ];

    for (const [machineType, handlerLabel] of cases) {
      const recipe: Recipe = {
        ...testRecipe(machineType),
        machineHandlers: [
          {
            id: handlerLabel,
            label: handlerLabel,
            machineType: handlerLabel,
            minimumTier: "UV",
            kind: "single",
          },
        ],
      };

      expect(getRecipeMachineHandlers(recipe).map((handler) => handler.label)).toEqual([
        machineType,
      ]);
    }
  });

  it("applies the selected handler to the effective recipe", () => {
    const recipe = {
      ...testRecipe("Shaped Crafting", "NONE"),
      machineHandlers: [
        {
          id: "autoworkbench",
          label: "Autoworkbench",
          machineType: "Autoworkbench",
          minimumTier: "LV",
          durationTicks: 40,
          eut: 16,
          kind: "automation" as const,
        },
      ],
    };
    const effective = applyMachineHandlerToRecipe(recipe, {
      machineHandlerId: "autoworkbench",
    });

    expect(getSelectedMachineHandler(recipe, { machineHandlerId: "autoworkbench" })).toMatchObject({
      label: "Autoworkbench",
      minimumTier: "LV",
    });
    expect(effective).toMatchObject({
      machineType: "Autoworkbench",
      minimumTier: "LV",
      durationTicks: 40,
      eut: 16,
      machineProfile: {
        machineType: "Autoworkbench",
        minimumTier: "LV",
        durationTicks: 40,
        eut: 16,
      },
    });
  });

  it("applies controls from the selected machine handler", () => {
    const recipe: Recipe = {
      ...testRecipe("Fluid Extractor"),
      machineHandlers: [
        {
          id: "large-fluid-extractor",
          label: "Large Fluid Extractor",
          machineType: "Large Fluid Extractor",
          minimumTier: "EV",
          kind: "multiblock",
          machineConfigControls: [
            {
              id: "solenoidCoil",
              label: "Solenoid",
              minimumKey: "mv",
              tiers: [
                {
                  key: "mv",
                  label: "MV",
                  parallelMultiplier: 16,
                  resource: {
                    kind: "item",
                    id: "gregtech:gt.blockcasings.cyclotron_coils",
                    amount: 1,
                    displayName: "MV Solenoid Superconductor Coil",
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const effective = applyMachineHandlerToRecipe(recipe, {
      machineHandlerId: "large-fluid-extractor",
    });

    expect(effective.machineConfigControls?.map((control) => control.id)).toEqual(["solenoidCoil"]);
  });
});

describe("multiblock machine config controls", () => {
  it("keeps imported coil and pipe casing controls independent", () => {
    const recipe: Recipe = {
      ...testRecipe("Chemical Plant"),
      machineConfigControls: [
        {
          id: "heatingCoil",
          label: "Heating Coil",
          minimumKey: "cupronickel",
          defaultKey: "cupronickel",
          tiers: [
            {
              key: "cupronickel",
              label: "Cupronickel",
              heat: 1801,
              resource: {
                kind: "item",
                id: "gregtech:gt.blockcasings5",
                amount: 1,
                displayName: "Cupronickel Coil Block",
              },
            },
            {
              key: "kanthal",
              label: "Kanthal",
              heat: 2701,
              resource: {
                kind: "item",
                id: "gregtech:gt.blockcasings5@1",
                amount: 1,
                displayName: "Kanthal Coil Block",
              },
            },
          ],
        },
        {
          id: "pipeCasing",
          label: "Pipe Casing",
          minimumKey: "bronze",
          defaultKey: "bronze",
          tiers: [
            {
              key: "bronze",
              label: "Bronze",
              resource: {
                kind: "item",
                id: "gregtech:gt.blockcasings2@12",
                amount: 1,
                displayName: "Bronze Pipe Casing",
              },
            },
            {
              key: "tungstensteel",
              label: "Tungstensteel",
              resource: {
                kind: "item",
                id: "gregtech:gt.blockcasings2@15",
                amount: 1,
                displayName: "Tungstensteel Pipe Casing",
              },
            },
          ],
        },
      ],
    };
    const coilControl = getRecipeCoilTierControl(recipe, {
      coilTier: "kanthal",
    });
    const [pipeControl] = getRecipeMachineConfigTierControls(recipe, {
      machineConfigTiers: { pipeCasing: "tungstensteel" },
    });

    expect(coilControl?.current.key).toBe("kanthal");
    expect(pipeControl).toMatchObject({
      id: "pipeCasing",
      current: { key: "tungstensteel" },
      resource: {
        kind: "item",
        id: "gregtech:gt.blockcasings2@15",
        displayName: "Tungstensteel Pipe Casing",
      },
    });
  });

  it("uses machine config controls imported from the dataset", () => {
    const recipe: Recipe = {
      ...testRecipe("Imported Machine"),
      machineConfigControls: [
        {
          id: "pipeCasing",
          label: "Pipe Casing",
          minimumKey: "steel",
          defaultKey: "steel",
          tiers: [
            {
              key: "steel",
              label: "Steel",
              resource: {
                kind: "item",
                id: "gregtech:gt.blockcasings2@13",
                amount: 1,
                displayName: "Steel Pipe Casing",
              },
            },
            {
              key: "tungstensteel",
              label: "Tungstensteel",
              resource: {
                kind: "item",
                id: "gregtech:gt.blockcasings2@15",
                amount: 1,
                displayName: "Tungstensteel Pipe Casing",
              },
            },
          ],
        },
      ],
    };

    const [control] = getRecipeMachineConfigTierControls(recipe, {
      machineConfigTiers: { pipeCasing: "tungstensteel" },
    });

    expect(control).toMatchObject({
      id: "pipeCasing",
      current: { key: "tungstensteel" },
      resource: { id: "gregtech:gt.blockcasings2@15" },
    });
  });

  it("does not add pipe casing controls to unrelated machines", () => {
    expect(getRecipeMachineConfigTierControls(testRecipe("Macerator"), {})).toEqual([]);
  });

  it("does not synthesize coil controls without imported machine config controls", () => {
    expect(
      getRecipeCoilTierControl(testRecipe("Chemical Plant"), { coilTier: "kanthal" }),
    ).toBeUndefined();
  });
});

describe("machine handlers and runtime calculations", () => {
  const runtimeCalculation = {
    sourceKind: "gregtech-processing-logic" as const,
    status: "computed" as const,
    oracleEligible: true,
    variants: [{ id: "tier-lv", durationTicks: 20, eut: 8 }],
  };

  const recipe: Recipe = {
    ...testRecipe("Distillation Tower"),
    runtimeCalculation,
    machineHandlers: [
      {
        id: "distillation-tower",
        label: "Distillation Tower",
        machineType: "Distillation Tower",
        minimumTier: "MV",
        kind: "multiblock",
      },
      {
        id: "dangote-distillus",
        label: "Dangote Distillus",
        machineType: "Dangote Distillus",
        minimumTier: "EV",
        kind: "multiblock",
        durationTicks: 8,
        eut: 480,
      },
    ],
  };

  it("keeps runtime variants for the default machine", () => {
    expect(applyMachineHandlerToRecipe(recipe, {}).runtimeCalculation).toEqual(runtimeCalculation);
    expect(
      applyMachineHandlerToRecipe(recipe, { machineHandlerId: "distillation-tower" })
        .runtimeCalculation,
    ).toEqual(runtimeCalculation);
  });

  it("drops runtime variants when a different machine is selected", () => {
    const applied = applyMachineHandlerToRecipe(recipe, {
      machineHandlerId: "dangote-distillus",
    });
    expect(applied.runtimeCalculation).toBeUndefined();
    expect(applied.durationTicks).toBe(8);
    expect(applied.eut).toBe(480);
    expect(applied.machineType).toBe("Dangote Distillus");
  });
});

function testRecipe(machineType: string, minimumTier = "LV"): Recipe {
  return {
    id: machineType,
    name: machineType,
    machineType,
    minimumTier,
    durationTicks: 20,
    eut: 8,
    inputs: [{ kind: "item", id: "input", amount: 1 }],
    outputs: [{ kind: "item", id: "output", amount: 1 }],
    source: { recipeMap: machineType },
  };
}

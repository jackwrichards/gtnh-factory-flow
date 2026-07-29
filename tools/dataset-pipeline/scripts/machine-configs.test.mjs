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

  it("reads real GT++ total-percent stats (Volcanus)", () => {
    const templates = buildMachineHandlerTemplates("Blast Furnace", [
      catalyst("Electric Blast Furnace", { sourceClass: MULTI_CLASS }),
      catalyst("Volcanus", {
        sourceClass: GTPP_MULTI_CLASS,
        tooltip: [
          "Volcanus",
          "Machine Type: Blast Furnace",
          "Factory Grade Advanced Blast Furnace",
          "8 Parallels",
          "220% Speed",
          "90% EU Usage",
          "500 Pollution per second",
        ],
      }),
    ]);

    const volcanus = templates.find((template) => template.label === "Volcanus");
    expect(volcanus.durationMultiplier).toBeCloseTo(1 / 2.2);
    expect(volcanus.eutMultiplier).toBeCloseTo(0.9);
    expect(volcanus.machineConfigControls[0].tiers[0].parallelMultiplier).toBe(8);
  });

  const DANGOTE_TOOLTIP = [
    "Dangote Distillus",
    "Machine Type: Distillery, DT",
    "Stats dictated by tower mode",
    "-----------------------------------------",
    "Distillery Mode",
    "(2 * floor(Height / 3)) * Voltage Tier Parallels",
    "200% Speed",
    "15% EU Usage",
    "-----------------------------------------",
    "Distillation Tower Mode",
    "12 Parallels",
    "350% Speed",
    "100% EU Usage",
  ];

  it("uses the mode matching the recipe map (Dangote on the DT map)", () => {
    const templates = buildMachineHandlerTemplates("Distillation Tower", [
      catalyst("Distillation Tower", { sourceClass: MULTI_CLASS }),
      catalyst("Dangote Distillus", { sourceClass: GTPP_MULTI_CLASS, tooltip: DANGOTE_TOOLTIP }),
    ]);

    const dangote = templates.find((template) => template.label === "Dangote Distillus");
    expect(dangote.durationMultiplier).toBeCloseTo(1 / 3.5);
    expect(dangote.eutMultiplier).toBeUndefined();
    expect(dangote.machineConfigControls[0].tiers[0].parallelMultiplier).toBe(12);
  });

  it("uses the mode matching the recipe map (Dangote on the Distillery map)", () => {
    const templates = buildMachineHandlerTemplates("Distillery", [
      catalyst("Distillery", { sourceClass: SINGLE_CLASS }),
      catalyst("Dangote Distillus", { sourceClass: GTPP_MULTI_CLASS, tooltip: DANGOTE_TOOLTIP }),
    ]);

    const dangote = templates.find((template) => template.label === "Dangote Distillus");
    expect(dangote.durationMultiplier).toBeCloseTo(1 / 2);
    expect(dangote.eutMultiplier).toBeCloseTo(0.15);
    // The height/voltage parallel formula is unquantifiable, so no
    // parallel control is invented for distillery mode.
    expect(dangote.machineConfigControls).toBeUndefined();
  });

  it("skips deprecated machines entirely", () => {
    const templates = buildMachineHandlerTemplates("Distillation Tower", [
      catalyst("Distillation Tower", { sourceClass: MULTI_CLASS }),
      catalyst("Mega Distillation Tower", {
        sourceClass: MULTI_CLASS,
        tooltip: ["DEPRECATED - Controller will be removed in next major update!", "256 Parallels"],
      }),
    ]);

    expect(templates.map((template) => template.label)).toEqual(["Distillation Tower"]);
  });

  it("reads structure-height parallel formulas with a stated slice cap", () => {
    const templates = buildMachineHandlerTemplates("Distillery", [
      catalyst("Distillery", { sourceClass: SINGLE_CLASS }),
      catalyst("Mega Distillation Tower", {
        sourceClass: MULTI_CLASS,
        tooltip: [
          "Has up to 5 middle slices and 1 top slice, the amount of middle slices is the 'Tower Height'",
          "-----------------------------------------",
          "Distillery Mode",
          "256 x (1 + Tower Height/2) Parallels",
          "150% Speed",
          "50% EU Usage",
          "-----------------------------------------",
          "Distillation Tower Mode",
          "256 Parallels",
          "120% Speed",
          "90% EU Usage",
        ],
      }),
    ]);

    const mega = templates.find((template) => template.label === "Mega Distillation Tower");
    expect(mega.durationMultiplier).toBeCloseTo(1 / 1.5);
    expect(mega.eutMultiplier).toBeCloseTo(0.5);
    const fixed = mega.machineConfigControls.find((control) => control.id === "machineParallel");
    const height = mega.machineConfigControls.find((control) =>
      control.id.startsWith("structure-"),
    );
    expect(fixed.tiers[0].parallelMultiplier).toBe(256);
    expect(height.tiers).toHaveLength(5);
    expect(height.tiers[0].parallelMultiplier).toBeCloseTo(1.5);
    expect(height.tiers[4].parallelMultiplier).toBeCloseTo(3.5);
  });

  it("reads flat voltage-scaled parallels (Elemental Duplicator)", () => {
    const templates = buildMachineHandlerTemplates("Replicator", [
      catalyst("Replicator", { sourceClass: SINGLE_CLASS }),
      catalyst("Elemental Duplicator", {
        sourceClass: GTPP_MULTI_CLASS,
        tooltip: [
          "8 Parallels per Voltage Tier",
          "200% Speed",
          "100% EU Usage",
          "Machine does not lose efficiency when overclocked",
        ],
      }),
    ]);

    const duplicator = templates.find((template) => template.label === "Elemental Duplicator");
    expect(duplicator.durationMultiplier).toBeCloseTo(0.5);
    expect(duplicator.eutMultiplier).toBeUndefined();
    expect(duplicator.perfectOverclock).toBe(true);
    const control = duplicator.machineConfigControls.find((c) => c.id === "voltageParallel");
    expect(control.tiers[0].parallelPerVoltageTier).toBe(8);
  });

  it("takes the steady-state maximum of ranged stats (Industrial Centrifuge)", () => {
    const templates = buildMachineHandlerTemplates("Multiblock Centrifuge", [
      catalyst("Industrial Centrifuge", {
        sourceClass: GTPP_MULTI_CLASS,
        tooltip: ["4 - 8 Parallels per Voltage Tier", "200% - 300% Speed", "90% EU Usage"],
      }),
    ]);

    expect(templates[0].durationMultiplier).toBeCloseTo(1 / 3);
    expect(templates[0].eutMultiplier).toBeCloseTo(0.9);
    const control = templates[0].machineConfigControls.find((c) => c.id === "voltageParallel");
    expect(control.tiers[0].parallelPerVoltageTier).toBe(8);
  });

  it("reads enumerated parallel tables (Solar Factory and EIC styles)", () => {
    const solar = buildMachineHandlerTemplates("Solar Factory", [
      catalyst("Solar Factory", {
        sourceClass: MULTI_CLASS,
        tooltip: [
          "Precise Casing Tier determines Parallels",
          "Mk-I/MK-II/MK-III/MK-IV->8/16/32/64 Parallels",
        ],
      }),
    ])[0];
    const solarControl = solar.machineConfigControls[0];
    expect(solarControl.tiers.map((tier) => tier.parallelMultiplier)).toEqual([8, 16, 32, 64]);
    expect(solarControl.defaultKey).toBe(solarControl.tiers[0].key);

    const eic = buildMachineHandlerTemplates("Implosion Compressor", [
      catalyst("New Implosion Compressor", {
        sourceClass: MULTI_CLASS,
        tooltip: [
          "Parallels are determined by Containment Block Tier",
          "Neutronium : 1 Parallel",
          "Infinity : 4 Parallels",
          "Spacetime : 64 Parallels",
        ],
      }),
    ])[0];
    const eicControl = eic.machineConfigControls[0];
    expect(eicControl.tiers.map((tier) => tier.parallelMultiplier)).toEqual([1, 4, 64]);
  });

  it("adds the high-pressure choice on steam multiblocks", () => {
    const templates = buildMachineHandlerTemplates("Macerator", [
      catalyst("Macerator", { sourceClass: SINGLE_CLASS }),
      catalyst("Steam Grinder", {
        sourceClass: GTPP_MULTI_CLASS,
        tooltip: [
          "8 Parallels",
          "125% Speed",
          "62.5% Steam Usage",
          "High-Pressure Doubles Speed and Steam Usage",
        ],
      }),
    ]);

    const grinder = templates.find((template) => template.label === "Steam Grinder");
    const pressure = grinder.machineConfigControls.find((c) => c.id === "steamPressure");
    expect(pressure.defaultKey).toBe("normal");
    expect(pressure.tiers.find((tier) => tier.key === "high").durationMultiplier).toBe(0.5);
  });

  it("reads Runs-at lines from Space Elevator modules", () => {
    const templates = buildMachineHandlerTemplates("Space Assembler", [
      catalyst("Space Assembler Module MK-II", {
        sourceClass: MULTI_CLASS,
        tooltip: ["Runs at UIV at 150% speed with up to 16 parallels"],
      }),
    ]);

    expect(templates[0].minimumTier).toBe("UIV");
    expect(templates[0].durationMultiplier).toBeCloseTo(1 / 1.5);
    const control = templates[0].machineConfigControls.find((c) => c.id === "machineParallel");
    expect(control.tiers[0].parallelMultiplier).toBe(16);
  });

  it("lets a handler's own control replace a same-id recipe-level control", () => {
    const templates = buildMachineHandlerTemplates("Space Assembler", [
      catalyst("Space Assembler Module MK-I", {
        sourceClass: MULTI_CLASS,
        tooltip: ["Runs at UHV with up to 4 parallels"],
      }),
      catalyst("Space Assembler Module MK-II", {
        sourceClass: MULTI_CLASS,
        tooltip: ["Runs at UIV at 150% speed with up to 16 parallels"],
      }),
    ]);
    const recipeControls = primaryMachineHandlerControls(templates);
    expect(recipeControls[0].tiers[0].parallelMultiplier).toBe(4);

    const handlers = instantiateRecipeMachineHandlers(templates, {
      minimumTier: "UHV",
      durationTicks: 1000,
      eut: 122880,
      machineConfigControls: recipeControls,
    });
    const mk2 = handlers.find((handler) => handler.label === "Space Assembler Module MK-II");
    const parallel = mk2.machineConfigControls.filter((c) => c.id === "machineParallel");
    expect(parallel).toHaveLength(1);
    expect(parallel[0].tiers.map((tier) => tier.parallelMultiplier)).toEqual([16]);
    expect(mk2.durationTicks).toBe(667);
  });

  it("reads perfect overclock statements", () => {
    const templates = buildMachineHandlerTemplates("Fusion Reactor", [
      catalyst("Fusion Control Computer Mark I", { sourceClass: MULTI_CLASS }),
      catalyst("FusionTech MK IV", {
        sourceClass: GTPP_MULTI_CLASS,
        tooltip: ["Performs 4/4 overclocks"],
      }),
    ]);

    const fusion = templates.find((template) => template.label === "FusionTech MK IV");
    expect(fusion.perfectOverclock).toBe(true);
  });

  it("reads voltage-scaled parallels with upgrade options (Maceration Stack)", () => {
    const templates = buildMachineHandlerTemplates("Macerator", [
      catalyst("Macerator", { sourceClass: SINGLE_CLASS }),
      catalyst("Industrial Maceration Stack", {
        sourceClass: GTPP_MULTI_CLASS,
        tooltip: [
          "Voltage Tier * n Parallels",
          "n=2 initially. n=8 after inserting Maceration Upgrade Chip",
          "Tier 1: 160% speed",
          "Tier 2: 640% speed",
        ],
      }),
    ]);

    const stack = templates.find((template) => template.label === "Industrial Maceration Stack");
    const control = stack.machineConfigControls.find((entry) => entry.id === "voltageParallel");
    expect(control.tiers.map((tier) => tier.parallelPerVoltageTier)).toEqual([2, 8]);
    expect(control.defaultKey).toBe("per-tier-2");
    expect(control.tiers[0].durationMultiplier).toBeCloseTo(1 / 1.6);
    expect(control.tiers[1].durationMultiplier).toBeCloseTo(1 / 6.4);
  });

  it("reads coil formula tooltips generically (chem plant and LFE)", () => {
    const templates = buildMachineHandlerTemplates("Chemical Plant", [
      catalyst("ExxonMobil Chemical Plant", {
        sourceClass: GTPP_MULTI_CLASS,
        tooltip: [
          "2 Parallels per Pipe Casing Tier",
          "Speed is 50% times Heating Coil Tier",
        ],
      }),
    ]);
    const coil = templates[0].machineConfigControls.find(
      (control) => control.id === "heatingCoil",
    );
    expect(coil.defaultKey).toBe("kanthal");
    expect(coil.tiers[0].durationMultiplier).toBeCloseTo(2);
    expect(coil.tiers[2].durationMultiplier).toBeCloseTo(2 / 3);

    const lfe = buildMachineHandlerTemplates("Fluid Extractor", [
      catalyst("Fluid Extractor (LV)", { sourceClass: SINGLE_CLASS }),
      catalyst("Large Fluid Extractor", {
        sourceClass: GTPP_MULTI_CLASS,
        tooltip: [
          "150% Speed",
          "80% EU Usage",
          "Every coil tier gives a +10% speed bonus and a 10% EU/t discount (multiplicative)",
        ],
      }),
    ]).find((template) => template.label === "Large Fluid Extractor");
    const lfeCoil = lfe.machineConfigControls.find((control) => control.id === "heatingCoil");
    expect(lfe.durationMultiplier).toBeCloseTo(1 / 1.5);
    expect(lfe.eutMultiplier).toBeCloseTo(0.8);
    expect(lfeCoil.tiers[0].eutMultiplier).toBeCloseTo(0.9);
    expect(lfeCoil.tiers[1].eutMultiplier).toBeCloseTo(0.81);
    expect(lfeCoil.tiers[0].durationMultiplier).toBeCloseTo(1 / 1.1);
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
    const templates = buildMachineHandlerTemplates("Chemical Plant", [
      catalyst("ExxonMobil Chemical Plant", {
        sourceClass: GTPP_MULTI_CLASS,
        tooltip: ["Speed is 50% times Heating Coil Tier"],
      }),
    ]);
    const controls = machineConfigControlsForOracleRecipe(
      "Chemical Plant",
      5,
      primaryMachineHandlerControls(templates),
    );
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

  it("gives the Industrial Coke Oven a slices control matching the in-game parallels", () => {
    const controls = machineConfigControlsForOracleRecipe("Industrial Coke Oven", 0, []);
    const slices = controls.find((control) => control.id === "cokeOvenSlices");
    const casing = controls.find((control) => control.id === "cokeOvenCasing");
    expect(slices.tiers).toHaveLength(16);
    expect(slices.defaultKey).toBe("slice-1");

    const heatResistant = casing.tiers.find((tier) => tier.key === "heat_resistant");
    const heatProof = casing.tiers.find((tier) => tier.key === "heat_proof");
    const oneSlice = slices.tiers.find((tier) => tier.key === "slice-1");
    const sixteenSlices = slices.tiers.find((tier) => tier.key === "slice-16");
    expect(heatResistant.parallelMultiplier * oneSlice.parallelMultiplier).toBe(16);
    expect(heatResistant.parallelMultiplier * sixteenSlices.parallelMultiplier).toBe(16 + 8 * 15);
    expect(heatProof.parallelMultiplier * oneSlice.parallelMultiplier).toBe(32);
    expect(heatProof.parallelMultiplier * sixteenSlices.parallelMultiplier).toBe(32 + 16 * 15);
  });

  it("keeps the catalyst-derived controls of the primary machine", () => {
    const templates = buildMachineHandlerTemplates("Chemical Plant", [
      catalyst("ExxonMobil Chemical Plant", {
        sourceClass: GTPP_MULTI_CLASS,
        tooltip: ["2 Parallels per Pipe Casing Tier", "Speed is 50% times Heating Coil Tier"],
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

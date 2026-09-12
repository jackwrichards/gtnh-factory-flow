import { describe, expect, it } from "vitest";
import catalysts from "./__fixtures__/singleblock-catalysts.json";
import { buildMachineHandlerTemplates, instantiateRecipeMachineHandlers, VOLTAGE_TIER_NAMES } from "./machine-configs.mjs";
import { GT_VOLTAGE_TIERS } from "../../../src/lib/model/tiers.ts";
import { getOverclockedRecipeStats } from "../../../src/lib/solver/overclock.ts";

// Real item IDs, classes and tooltips from the 2.9.0-beta-2 oracle export.
// In particular, @11156 is Epic Chemical Performer IV, Voltage IN: UMV.
const chemicalMap = catalysts.find(map => map.id === "gt.recipe.chemicalreactor");
const templates = buildMachineHandlerTemplates(chemicalMap.name, chemicalMap.catalysts);
const recipe = {
  id: "chemical-tier-test", name: "Chemical tier test", machineType: "Chemical Reactor",
  minimumTier: "LV", durationTicks: 100000, eut: 30, inputs: [], outputs: [],
  machineHandlers: instantiateRecipeMachineHandlers(templates, { minimumTier: "LV", durationTicks: 100000, eut: 30 }),
};

describe("actual exported singleblock tier families", () => {
  it("uses GTNH's voltage ordinals including UMV, UXV and literal MAX", () => {
    expect(VOLTAGE_TIER_NAMES).toEqual(GT_VOLTAGE_TIERS.map(entry => entry.tier));
  });

  it("keeps Chemical Performer in the Reactor family through its real UMV item", () => {
    expect(templates).toHaveLength(1);
    const family = templates[0];
    expect(family.id).toBe("chemical-reactor");
    expect(family.minimumTier).toBe("LV");
    expect(family.maximumTier).toBe("UMV");
    expect(family.tierIcons.map(entry => entry.tier)).toEqual(VOLTAGE_TIER_NAMES.slice(1, 13));
    expect(family.tierIcons.find(entry => entry.tier === "UV").resource.displayName).toBe("Ultimate Chemical Performer");
    expect(family.tierIcons.at(-1).resource).toMatchObject({ id: "gregtech:gt.blockmachines@11156", displayName: "Epic Chemical Performer IV" });
    expect(recipe.machineHandlers).toHaveLength(1);
    expect(recipe.machineHandlers[0].maximumTier).toBe("UMV");
  });

  it("is independent of catalyst registration order", () => {
    const reverse = buildMachineHandlerTemplates(chemicalMap.name, [...chemicalMap.catalysts].reverse());
    expect(reverse[0].id).toBe("chemical-reactor");
    expect(reverse[0].tierIcons).toEqual(templates[0].tierIcons);
  });

  it("joins Can Operator and Macerator high tiers without merging steam or multiblocks", () => {
    for (const map of catalysts.filter(map => map !== chemicalMap)) {
      const families = buildMachineHandlerTemplates(map.name, map.catalysts);
      const electric = families.find(entry => entry.id === (map.name === "Canner" ? "canning-machine" : "macerator"));
      expect(electric.maximumTier).toBe("UMV");
      expect(electric.tierIcons).toHaveLength(12);
      expect(families.some(entry => entry.kind === "multiblock")).toBe(true);
      if (map.name === "Macerator") {
        expect(families.find(entry => entry.id === "steam-macerator").maximumTier).toBeUndefined();
      }
    }
  });

  it("caps both calculated and runtime-exported overclocks for saved MAX cards", () => {
    const at = (input, tier) => getOverclockedRecipeStats(input, { overclockTier: tier, machineHandlerId: "chemical-reactor" });
    expect(at(recipe, "MAX")).toEqual(at(recipe, "UMV"));
    const runtime = { ...recipe, runtimeCalculation: { status: "computed", variants: [
      { id: "umv", overclockTier: "UMV", durationTicks: 48, eut: 125829120 },
      { id: "max", overclockTier: "MAX", durationTicks: 12, eut: 2013265920 },
    ] } };
    expect(at(runtime, "MAX")).toEqual(at(runtime, "UMV"));
    expect(at(runtime, "MAX").tier).toBe("UMV");
  });
});

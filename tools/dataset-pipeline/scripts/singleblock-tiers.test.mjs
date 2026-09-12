import { describe, expect, it } from "vitest";
import catalysts from "./__fixtures__/singleblock-catalysts.json";
import { buildMachineHandlerTemplates, instantiateRecipeMachineHandlers, VOLTAGE_TIER_NAMES } from "./machine-configs.mjs";
import { GT_VOLTAGE_TIERS } from "../../../src/lib/model/tiers.ts";
import { getOverclockedRecipeStats } from "../../../src/lib/solver/overclock.ts";
import { applyMachineHandlerToRecipe, getRecipeMachineHandlers } from "../../../src/lib/model/recipe-rules.ts";

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
    for (const map of catalysts.filter(map => ["Canner", "Macerator"].includes(map.name))) {
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

  it.each(catalysts)("preserves the registered voltage-input machines in $name", (map) => {
    const families = buildMachineHandlerTemplates(map.name, map.catalysts);
    expect(new Set(families.map(family => family.id)).size).toBe(families.length);
    for (const catalyst of map.catalysts) {
      const tooltip = catalyst.resource.tooltip ?? [];
      if (catalyst.multiblock || /multi|fusion/i.test(catalyst.sourceClass ?? "") ||
          tooltip.some(line => /deprecated|controller block|multiblock/i.test(line))) continue;
      const tier = tooltip.find(line => /^Voltage IN:/.test(line))?.match(/\((\w+)\)/)?.[1];
      if (!tier) continue;
      const variants = families.filter(family => family.kind === "single").flatMap(family =>
        (family.tierIcons ?? [{ tier: family.minimumTier, resource: family.catalystResource }])
          .map(variant => ({ ...variant, family })));
      const found = variants.find(variant => variant.resource.id === catalyst.resource.id);
      // Electric Oven is explicitly a different design of Electric Furnace:
      // both have the same runtime class/type/tier. One face per tier suffices.
      const type = tooltip.find(line => line.startsWith("Machine Type:"));
      const equivalent = type && variants.find(variant => variant.tier === tier &&
        map.catalysts.some(other => other.resource.id === variant.resource.id &&
          other.sourceClass === catalyst.sourceClass && other.resource.tooltip?.includes(type)));
      const owner = found ?? equivalent;
      expect(owner, `${catalyst.resource.displayName} (${catalyst.resource.id})`).toBeTruthy();
      expect(owner.tier).toBe(tier);
      expect(owner.family.availableTiers).toContain(tier);
      expect(owner.family.maximumTier).toBe(owner.family.availableTiers.at(-1));
    }
  });

  it("keeps the Ore Washing Plant controller distinct from the singleblock family across maps", () => {
    const singles = new Set(catalysts.flatMap(map => buildMachineHandlerTemplates(map.name, map.catalysts)
      .filter(family => family.kind === "single").map(family => family.id)));
    for (const map of catalysts.filter(map => ["Ore Washer", "Simple Dust Washer"].includes(map.name))) {
      const families = buildMachineHandlerTemplates(map.name, map.catalysts, singles);
      const multi = families.find(family => family.catalystResource?.id === "gregtech:gt.blockmachines@15550");
      expect(multi.id).toBe("ore-washing-plant-multiblock");
      const input = {...recipe, machineType: map.name, machineHandlers: instantiateRecipeMachineHandlers(families, recipe)};
      const handlers = getRecipeMachineHandlers(input);
      expect(handlers.find(handler => handler.id === multi.id)?.kind).toBe("multiblock");
      expect(applyMachineHandlerToRecipe(input, {machineHandlerId: multi.id})).toMatchObject({
        machineType: "Ore Washing Plant", maximumTier: undefined, availableTiers: undefined,
      });
      if (map.name === "Ore Washer") {
        expect(handlers.find(handler => handler.id === "ore-washing-plant")?.availableTiers).toHaveLength(12);
      }
    }
  });

  it.each([
    ["Circuit Assembler", "circuit-assembler", "MAX", 14],
    ["Packager", "packager", "UV", 8],
    ["Printer", "printer", "UV", 8],
    ["Fluid Extractor", "fluid-extractor", "UMV", 12],
    ["Centrifuge", "centrifuge", "UMV", 12],
    ["Cold Trap", "cold-trap", "ZPM", 2],
    ["Reactor Processing Unit", "reactor-processing-unit", "ZPM", 2],
    ["Dehydrator", "dehydrator", "ZPM", 6],
  ])("keeps %s's own endpoint and registered ladder", (name, id, maximum, count) => {
    const map = catalysts.find(map => map.name === name);
    const family = buildMachineHandlerTemplates(map.name, map.catalysts).find(family => family.id === id);
    expect(family.maximumTier).toBe(maximum);
    expect(family.availableTiers).toHaveLength(count);
  });

  it("joins Basic and Chemical Dehydrator using their exported recipe-map membership", () => {
    // GregtechDehydrator.registerMTEs registers all six with identical
    // chemicalDehydratorRecipes, 2/9 item slots and fluid input/output slots.
    // This GT++ chain omits the otherwise useful Machine Type tooltip.
    const map = catalysts.find(map => map.name === "Dehydrator");
    const families = buildMachineHandlerTemplates(map.name, [...map.catalysts].reverse());
    const single = families.filter(family => family.kind === "single");
    expect(single).toHaveLength(1);
    expect(single[0].id).toBe("dehydrator");
    expect(single[0].availableTiers).toEqual(["MV", "HV", "EV", "IV", "LuV", "ZPM"]);
    expect(single[0].tierIcons.map(variant => variant.resource.displayName)).toEqual([
      "Basic Dehydrator I", "Basic Dehydrator II", "Chemical Dehydrator I",
      "Chemical Dehydrator II", "Chemical Dehydrator III", "Chemical Dehydrator IV",
    ]);
  });

  it.each(["Cold Trap", "Reactor Processing Unit"])("skips nonexistent LuV %s machines in both solvers", name => {
    const map = catalysts.find(map => map.name === name);
    const templates = buildMachineHandlerTemplates(map.name, map.catalysts);
    expect(templates[0].availableTiers).toEqual(["IV", "ZPM"]);
    const base = { ...recipe, machineType: name, minimumTier: "IV", eut: 7680,
      machineHandlers: instantiateRecipeMachineHandlers(templates, {minimumTier: "IV", durationTicks: 100000, eut: 7680}) };
    const at = (input, tier) => getOverclockedRecipeStats(input, {overclockTier: tier, machineHandlerId: templates[0].id});
    expect(at(base, "LuV")).toEqual(at(base, "IV"));
    const runtime = { ...base, runtimeCalculation: {status: "computed", variants: [
      {id: "iv", overclockTier: "IV", durationTicks: 100000, eut: 7680},
      {id: "luv", overclockTier: "LuV", durationTicks: 50000, eut: 30720},
      {id: "zpm", overclockTier: "ZPM", durationTicks: 25000, eut: 122880},
    ]} };
    expect(at(runtime, "LuV")).toEqual(at(runtime, "IV"));
    expect(at(runtime, "ZPM").tier).toBe("ZPM");
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

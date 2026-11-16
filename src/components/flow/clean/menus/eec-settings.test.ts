import { expect, it } from "vitest";
import { EEC_MACHINE_TYPE, EEC_SHARPNESS, EEC_WEAPON_DAMAGE, type EecMetadata } from "@/lib/machines/extreme-entity-crusher";
import { formulaText } from "@/lib/machines/formula-lines";
import type { FactoryNode, Recipe } from "@/lib/model/types";
import { machineNumberSettings, settingControls } from "./settings-model";
import { workingLines } from "./working-lines";

const golem = (): Recipe => {
  const eec: EecMetadata = {
    mob: "Iron Golem",
    maxHealth: 100,
    baseEut: 1920,
    spawnInterval: 55,
    spikesDamage: 9,
    maxLooting: 4,
    outputs: [{ drops: [{ amount: 1, c0: 10000 }] }, { xp: true }],
  };
  return {
    id: "eec:golem",
    name: "Extreme Entity Crusher: Iron Golem",
    kind: "gregtech_machine",
    machineType: EEC_MACHINE_TYPE,
    minimumTier: "EV",
    durationTicks: 111,
    eut: 1920,
    inputs: [{ kind: "item", id: "factoryflow:eec_mob:golem", amount: 1, consumed: false }],
    outputs: [
      { kind: "item", id: "minecraft:iron_ingot", amount: 1 },
      { kind: "fluid", id: "xpjuice", amount: 120 },
    ],
    metadata: { eec },
  } as Recipe;
};

const card = (settings: Record<string, string> = {}) =>
  ({
    id: "n1",
    recipeId: "eec:golem",
    overclockTier: "EV",
    hatchVoltageTier: "EV",
    hatchAmps: 1,
    machineConfigTiers: { eecInfernal: "off", ...settings },
  }) as unknown as FactoryNode;

it("types the crusher's weapon damage and Sharpness on the settings sheet", () => {
  const patches: Array<Partial<FactoryNode>> = [];
  const numbers = machineNumberSettings(golem(), card({ [EEC_WEAPON_DAMAGE]: "7" }), (patch) => patches.push(patch));
  expect(numbers.map((entry) => [entry.id, entry.value])).toEqual([
    [EEC_WEAPON_DAMAGE, "7"],
    [EEC_SHARPNESS, "0"],
  ]);
  // The lists stay lists; the numbers are not offered twice.
  expect(settingControls(golem(), card()).map((control) => control.id)).not.toContain(EEC_WEAPON_DAMAGE);
  numbers[1].commit("5");
  numbers[0].step(1);
  numbers[1].commit("-3");
  expect(patches.map((patch) => patch.machineConfigTiers)).toEqual([
    expect.objectContaining({ [EEC_SHARPNESS]: "5" }),
    expect.objectContaining({ [EEC_WEAPON_DAMAGE]: "7.25" }),
  ]);
});

it("works the kill time out from the damage on the sheet", () => {
  const text = (settings: Record<string, string>) =>
    workingLines(golem(), card(settings)).map((entry) => `${entry.label}: ${formulaText(entry.math)} = ${entry.result}`);
  expect(text({})).toEqual(
    expect.arrayContaining(["damage: 9 + 0 = 9", "kill: max(55, ⌊100 HP / 9 · 10⌋) = 111 t"]),
  );
  expect(text({ [EEC_WEAPON_DAMAGE]: "7", [EEC_SHARPNESS]: "5" })).toEqual(
    expect.arrayContaining(["damage: 9 + 7 + 1.25·5 = 22.25", "kill: max(55, ⌊100 HP / 22.25 · 10⌋) = 55 t (minimum)"]),
  );
});

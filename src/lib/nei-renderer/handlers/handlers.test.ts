import { describe, expect, it } from "vitest";
import type { Recipe } from "@/lib/model/types";
import type { NeiSlotCommand } from "../core/commands";
import { recipeToRenderModel } from "../adapters/recipe-to-render-model";
import { selectNeiRecipeHandler } from "../adapters/handler-selection";
import { renderNeiRecipe } from "../core/render-pipeline";
import { NEI_TEXTURES } from "../theme/textures";

describe("NEI recipe handlers", () => {
  it("generates GregTech slot, progress, and stack commands", () => {
    const result = render(recipe({ machineType: "Ore Washer" }));

    expect(result.handlerId).toBe("gregtech-machine");
    expect(
      result.commands.some(
        (command) =>
          command.type === "texture" &&
          command.imagePath === "/nei/gregtech/gui/background/nei_single_recipe.png",
      ),
    ).toBe(true);
    expect(result.commands.some((command) => command.type === "slot")).toBe(true);
    expect(
      result.commands.some(
        (command) => command.type === "slot" && command.texturePath?.endsWith("/slot/item.png"),
      ),
    ).toBe(true);
    expect(
      result.commands.some(
        (command) => command.type === "progress" && command.texture === "bath",
      ),
    ).toBe(true);
    expect(result.positionedStacks.map((stack) => [stack.side, stack.kind])).toEqual([
      ["input", "item"],
      ["output", "item"],
    ]);
  });

  it("uses layout-derived GregTech slot and progress positions", () => {
    const result = render(
      recipe({
        inputs: [{ kind: "item", id: "input", amount: 1, neiSlot: { x: 34, y: 17 } }],
        outputs: [
          { kind: "item", id: "output", amount: 1, neiSlot: { x: 88, y: 17 } },
          { kind: "fluid", id: "steam", amount: 1000, neiSlot: { x: 88, y: 53 } },
        ],
        nei: {
          slots: [
            { side: "input", kind: "item", slotIndex: 0, x: 34, y: 17 },
            { side: "output", kind: "item", slotIndex: 0, x: 88, y: 17 },
            { side: "output", kind: "fluid", slotIndex: 0, x: 88, y: 53 },
          ],
          progressBars: [
            { x: 84, y: 44, width: 20, height: 18, direction: "right", texture: "macerate" },
          ],
        },
      }),
    );

    expect(
      result.commands.find(
        (command) => command.type === "slot" && command.side === "input" && command.kind === "item",
      ),
    ).toMatchObject({ x: 34, y: 17 });
    expect(
      result.commands.find(
        (command) =>
          command.type === "slot" && command.side === "output" && command.kind === "fluid",
      ),
    ).toMatchObject({ x: 88, y: 53 });
    expect(result.commands.find((command) => command.type === "progress")).toMatchObject({
      x: 84,
      y: 44,
      texture: "macerate",
    });
    expect(result.positionedStacks.find((stack) => stack.kind === "fluid")).toMatchObject({
      side: "output",
      x: 88,
      y: 53,
      resourceIndex: 1,
    });
  });

  it("generates bee produce commands without using a machine fallback", () => {
    const result = render(
      recipe({
        kind: "bee_produce",
        machineType: "Bee Produce",
        inputs: [{ kind: "item", id: "factoryflow:bee_species:test", amount: 1 }],
        outputs: [{ kind: "item", id: "comb", amount: 1, chance: 0.2 }],
      }),
    );

    expect(result.handlerId).toBe("bee-produce");
    expect(result.commands.filter((command) => command.type === "slot")).toHaveLength(8);
    expect(result.positionedStacks[1]?.chance).toBe(0.2);
  });

  it("generates crop produce commands", () => {
    const result = render(
      recipe({
        kind: "crop_produce",
        machineType: "IC2 Crop",
        inputs: [{ kind: "item", id: "seed", amount: 1 }],
        outputs: [{ kind: "item", id: "drop", amount: 2 }],
      }),
    );

    expect(result.handlerId).toBe("crop-produce");
    expect(result.positionedStacks.map((stack) => stack.side)).toEqual(["input", "output"]);
  });

  it("renders essentia outputs as aspect stacks and readable text", () => {
    const result = render(
      recipe({
        kind: "essentia_smelting",
        machineType: "Thaumcraft Essentia Smelting",
        inputs: [{ kind: "item", id: "minecraft:rotten_flesh", amount: 1 }],
        outputs: [
          { kind: "aspect", id: "thaumcraft:aspect:corpus", amount: 4, displayName: "Corpus" },
        ],
      }),
      { preset: "readable", aspectDisplay: "text" },
    );

    expect(result.handlerId).toBe("essentia-smelting");
    expect(result.commands.some((command) => command.type === "aspect")).toBe(true);
    expect(
      result.commands.some((command) => command.type === "text" && command.text.includes("Corpus")),
    ).toBe(true);
  });

  it("renders native essentia output aspects with framed aspect slots and an arrow", () => {
    const result = render(
      recipe({
        kind: "essentia_smelting",
        machineType: "Thaumcraft Essentia Smelting",
        inputs: [{ kind: "item", id: "minecraft:rotten_flesh", amount: 1 }],
        outputs: aspectOutputs(["Aer", "Terra", "Ignis", "Aqua", "Ordo", "Perditio", "Venenum"]),
      }),
    );

    const aspectSlots = result.commands.filter(
      (command): command is NeiSlotCommand =>
        command.type === "slot" && command.kind === "aspect",
    );
    expect(aspectSlots).toHaveLength(6);
    expect(aspectSlots.every((command) => command.texturePath === NEI_TEXTURES.aspectSlot)).toBe(
      true,
    );
    expect(aspectSlots.every((command) => command.framed !== false)).toBe(true);
    expect(
      result.commands.some(
        (command) => command.type === "progress" && command.texture === "arrow",
      ),
    ).toBe(true);
    expect(result.commands.some((command) => command.type === "rect")).toBe(false);
    expect(result.commands.filter((command) => command.type === "aspect")).toHaveLength(6);
    expect(result.commands.find((command) => command.type === "aspect")).toMatchObject({
      stack: {
        resource: {
          aspectId: "aer",
          name: "Aer",
          amount: 1,
          iconPath: "/nei/thaumcraft/aspects/aer.png",
        },
      },
    });
    expect(
      result.commands.some((command) => command.type === "text" && command.text === "+1"),
    ).toBe(true);
  });

  it("renders all aspect names and amounts in readable essentia mode", () => {
    const result = render(
      recipe({
        kind: "essentia_smelting",
        machineType: "Thaumcraft Essentia Smelting",
        inputs: [{ kind: "item", id: "minecraft:rotten_flesh", amount: 1 }],
        outputs: aspectOutputs(["Aer", "Terra", "Ignis", "Aqua", "Ordo", "Perditio", "Venenum"]),
      }),
      { preset: "readable" },
    );

    expect(result.commands.filter((command) => command.type === "aspect")).toHaveLength(7);
    expect(
      result.commands.some((command) => command.type === "text" && command.text === "Venenum x7"),
    ).toBe(true);
    expect(result.commands.some((command) => command.type === "text" && command.text === "+3")).toBe(
      false,
    );
  });

  it("limits compact essentia aspects and emits an overflow marker", () => {
    const result = render(
      recipe({
        kind: "essentia_smelting",
        machineType: "Thaumcraft Essentia Smelting",
        inputs: [{ kind: "item", id: "minecraft:rotten_flesh", amount: 1 }],
        outputs: aspectOutputs(["Aer", "Terra", "Ignis", "Aqua", "Ordo", "Perditio", "Venenum"]),
      }),
      { preset: "compact" },
    );

    expect(result.commands.filter((command) => command.type === "aspect")).toHaveLength(4);
    expect(
      result.commands.some((command) => command.type === "text" && command.text === "+3"),
    ).toBe(true);
  });

  it("filters empty slots when requested", () => {
    const result = render(
      recipe({
        kind: "bee_produce",
        machineType: "Bee Produce",
        outputs: [{ kind: "item", id: "comb", amount: 1 }],
      }),
      { showEmptySlots: false },
    );

    expect(result.commands.some((command) => command.semanticTags?.includes("empty-slot"))).toBe(
      false,
    );
  });

  it("renders unknown kinds through the fallback handler", () => {
    const result = render(
      recipe({
        kind: "unknown",
        machineType: "Unknown",
        inputs: [{ kind: "item", id: "mystery_input", amount: 1 }],
        outputs: [{ kind: "item", id: "mystery_output", amount: 1 }],
      }),
    );

    expect(result.handlerId).toBe("fallback");
    expect(result.commands.some((command) => command.type === "slot")).toBe(true);
    expect(result.commands.some((command) => command.type === "text")).toBe(true);
  });
});

function render(recipeValue: Recipe, options = {}) {
  const model = recipeToRenderModel(recipeValue);
  return renderNeiRecipe(model, selectNeiRecipeHandler(model), options);
}

function aspectOutputs(names: string[]) {
  return names.map((name, index) => ({
    kind: "aspect" as const,
    id: `thaumcraft:aspect:${name.toLowerCase()}`,
    amount: index + 1,
    displayName: name,
  }));
}

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: "recipe",
    name: "Recipe",
    kind: "gregtech_machine",
    machineType: "Assembler",
    minimumTier: "LV",
    durationTicks: 20,
    eut: 8,
    inputs: [{ kind: "item", id: "input", amount: 1 }],
    outputs: [{ kind: "item", id: "output", amount: 1 }],
    ...overrides,
  };
}

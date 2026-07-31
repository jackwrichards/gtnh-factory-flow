import { describe, expect, it } from "vitest";
import type { Recipe } from "@/lib/model/types";
import { NEI_TEXTURES } from "../theme/textures";
import { recipeToRenderModel } from "./recipe-to-render-model";

describe("recipeToRenderModel", () => {
  it("preserves machine metadata and splits item, fluid, and aspect resources", () => {
    const sourceRecipe = recipe({
      machineType: "Thaumcraft Essentia Smelting",
      kind: "essentia_smelting",
      source: { recipeMap: "Alchemy Furnace", rawRecipeId: "alchemy:rotten_flesh" },
      inputs: [
        { kind: "item", id: "minecraft:rotten_flesh", amount: 1 },
        { kind: "fluid", id: "water", amount: 250 },
      ],
      outputs: [
        {
          kind: "aspect",
          id: "thaumcraft:aspect:corpus",
          amount: 4,
          displayName: "Corpus",
          dominantColor: "#ffcc7f",
          tooltip: ["Body"],
        },
        { kind: "fluid", id: "steam", amount: 1000 },
      ],
    });
    const model = recipeToRenderModel(sourceRecipe);

    expect(model.kind).toBe("essentia_smelting");
    expect(model.sourceRecipe).toBe(sourceRecipe);
    expect(model.recipeMapName).toBe("Alchemy Furnace");
    expect(model.recipeMapId).toBe("alchemy");
    expect(model.inputs).toHaveLength(1);
    expect(model.fluidInputs?.[0]?.id).toBe("water");
    expect(model.fluidOutputs?.[0]?.id).toBe("steam");
    expect(model.aspectOutputs?.[0]).toMatchObject({
      aspectId: "corpus",
      name: "Corpus",
      amount: 4,
      iconPath: "/nei/thaumcraft/aspects/corpus.png",
      color: "#ffcc7f",
      tooltip: ["Body"],
      sourceResource: sourceRecipe.outputs[0],
    });
  });

  it("preserves explicit aspect icon paths", () => {
    const model = recipeToRenderModel(
      recipe({
        outputs: [
          {
            kind: "aspect",
            id: "thaumcraft:aspect:ordo",
            amount: 2,
            iconPath: "/custom/ordo.png",
          },
        ],
      }),
    );

    expect(model.aspectOutputs?.[0]?.iconPath).toBe("/custom/ordo.png");
  });

  it("uses the unknown fallback for unmapped aspect ids", () => {
    const model = recipeToRenderModel(
      recipe({
        outputs: [{ kind: "aspect", id: "thaumcraft:aspect:electrum", amount: 1 }],
      }),
    );

    expect(model.aspectOutputs?.[0]).toMatchObject({
      aspectId: "electrum",
      iconPath: NEI_TEXTURES.thaumcraftUnknownAspect,
    });
  });

  it("infers bee and crop kinds for older datasets", () => {
    expect(recipeToRenderModel(recipe({ machineType: "Bee Produce" })).kind).toBe("bee_produce");
    expect(recipeToRenderModel(recipe({ machineType: "IC2 Crop" })).kind).toBe("crop_produce");
  });
});

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: "recipe",
    name: "Recipe",
    machineType: "Assembler",
    minimumTier: "LV",
    durationTicks: 20,
    eut: 8,
    inputs: [{ kind: "item", id: "input", amount: 1 }],
    outputs: [{ kind: "item", id: "output", amount: 1 }],
    ...overrides,
  };
}

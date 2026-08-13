import { getMiningSourceInfo, type MiningSourceInfo } from "@/lib/model/mining-source";
import type { NeiDrawCommand } from "../core/commands";
import type { NeiPositionedStack } from "../core/positioned-stack";
import type { NeiRecipeHandler } from "../core/recipe-handler";
import type { NeiRecipeRenderModel, NeiSize } from "../core/render-model";
import { NEI_DEFAULT_HANDLER_HEIGHT, NEI_DEFAULT_HANDLER_WIDTH } from "../theme/constants";
import { gridPositions, slotCommand, panelBackground, resourceToPositionedStack } from "./command-helpers";

/**
 * Worldgen as a recipe page: an ore vein, a small ore, or an underground
 * fluid. Nothing goes in - the page is the world offering something up - so
 * the panel is a row of what comes out over the facts a prospector wants:
 * which planets, what height, how rich.
 */

const SLOT_COLUMNS = 6;
const OUTPUT_POSITIONS = gridPositions(SLOT_COLUMNS, 8, 8, SLOT_COLUMNS, 2);
const TEXT_COLOR = "#3b3b3b";
const FAINT_TEXT_COLOR = "#6b6257";
const STRATA_COLOR = "#b08d57";

function visibleOutputs(recipe: NeiRecipeRenderModel) {
  return [...recipe.outputs, ...(recipe.fluidOutputs ?? [])].slice(0, OUTPUT_POSITIONS.length);
}

/**
 * A vein always shows four layer slots even when materials repeat - an empty
 * NEI slot is information (see AGENTS.md), and four is the shape of a vein.
 */
function slotCount(recipe: NeiRecipeRenderModel) {
  const outputs = visibleOutputs(recipe).length;
  return recipe.kind === "ore_vein" ? Math.max(outputs, 4) : Math.max(outputs, 1);
}

function planetLine(info: MiningSourceInfo): string | undefined {
  const labels = info.dimensions.map((dimension) => {
    const label = dimension.abbr ?? dimension.name;
    return dimension.tier !== undefined && dimension.tier > 0 ? `${label}·T${dimension.tier}` : label;
  });
  if (labels.length === 0) {
    return undefined;
  }
  const shown = labels.slice(0, 8);
  const more = labels.length - shown.length;
  return `On ${shown.join(" ")}${more > 0 ? ` +${more}` : ""}`;
}

function headline(recipe: NeiRecipeRenderModel, info: MiningSourceInfo): string | undefined {
  if (recipe.kind === "ore_vein") {
    const name = info.veinName;
    return name ? `${name} vein` : undefined;
  }
  if (recipe.kind === "small_ore") {
    const perChunk = info.amountPerChunk !== undefined ? `${info.amountPerChunk}/chunk` : undefined;
    return [info.veinName, perChunk].filter(Boolean).join(" · ") || undefined;
  }
  const deposits = info.deposits.length;
  return deposits > 0 ? `Deposits in ${deposits} ${deposits === 1 ? "world" : "worlds"}` : undefined;
}

function detailLine(recipe: NeiRecipeRenderModel, info: MiningSourceInfo): string | undefined {
  const height = info.heightRange ? `Y ${info.heightRange}` : undefined;
  if (recipe.kind === "ore_vein") {
    const richness =
      info.weight !== undefined && info.density !== undefined && info.size !== undefined
        ? `W${info.weight} D${info.density} S${info.size}`
        : undefined;
    return [height, richness].filter(Boolean).join(" · ") || undefined;
  }
  if (recipe.kind === "small_ore") {
    return height;
  }
  const first = info.deposits[0];
  if (!first) {
    return undefined;
  }
  const range =
    first.minAmount !== undefined && first.maxAmount !== undefined
      ? `${first.minAmount}-${first.maxAmount} L/chunk`
      : undefined;
  const chance = first.chance !== undefined ? `${first.chance}%` : undefined;
  return [range, chance].filter(Boolean).join(" · ") || undefined;
}

export const MiningSourceHandler: NeiRecipeHandler = {
  id: "mining-source",
  label: "Mining",

  canHandle(recipe) {
    return (
      recipe.kind === "ore_vein" ||
      recipe.kind === "small_ore" ||
      recipe.kind === "underground_fluid"
    );
  },

  getDimensions(): NeiSize {
    return { width: NEI_DEFAULT_HANDLER_WIDTH, height: NEI_DEFAULT_HANDLER_HEIGHT };
  },

  drawBackground(recipe): NeiDrawCommand[] {
    const outputs = visibleOutputs(recipe);
    const slots = slotCount(recipe);
    return [
      ...panelBackground(NEI_DEFAULT_HANDLER_WIDTH, NEI_DEFAULT_HANDLER_HEIGHT),
      // A thin band of "ground" under the slot row: the ores sit in strata.
      {
        type: "rect",
        layer: "decoration",
        x: 8,
        y: 27,
        width: slots * 20 - 2,
        height: 2,
        color: STRATA_COLOR,
      },
      ...OUTPUT_POSITIONS.slice(0, slots).map((position, index) =>
        slotCommand({
          ...position,
          side: "output",
          kind: outputs[index]?.kind ?? "item",
          slotIndex: index,
          empty: index >= outputs.length,
        }),
      ),
    ];
  },

  getInputs(): NeiPositionedStack[] {
    return [];
  },

  getOutputs(recipe): NeiPositionedStack[] {
    return visibleOutputs(recipe).map((resource, index) =>
      resourceToPositionedStack({
        resource,
        side: "output",
        x: OUTPUT_POSITIONS[index].x,
        y: OUTPUT_POSITIONS[index].y,
        slotIndex: index,
        resourceIndex: index,
      }),
    );
  },

  drawForeground(recipe): NeiDrawCommand[] {
    const info = recipe.sourceRecipe ? getMiningSourceInfo(recipe.sourceRecipe) : undefined;
    if (!info) {
      return [];
    }
    const lines: Array<{ text: string; color: string }> = [];
    const title = headline(recipe, info);
    if (title) {
      lines.push({ text: title, color: TEXT_COLOR });
    }
    const detail = detailLine(recipe, info);
    if (detail) {
      lines.push({ text: detail, color: FAINT_TEXT_COLOR });
    }
    const planets = planetLine(info);
    if (planets) {
      lines.push({ text: planets, color: FAINT_TEXT_COLOR });
    }
    return lines.map((line, index) => ({
      type: "text",
      layer: "text",
      x: 8,
      y: 36 + index * 12,
      text: line.text,
      fontSize: 8,
      color: line.color,
    }));
  },
};

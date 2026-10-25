import type { FactoryNode, Recipe, ResourceAmount } from "@/lib/model/types";
import { isCustomRateRecipe } from "@/lib/model/custom-rate";
import { isFluidTankRecipe } from "@/lib/model/fluid-tank";
import { isSharedMachineNode } from "@/lib/model/shared-machine";
import { isCropFarmRecipe, isCropProductionRecipe } from "@/lib/model";
import type { RecipeProgrammedCircuit } from "@/lib/model/programmed-circuit";
import type { CleanChipView, CleanPortView, CleanPowerView, CleanCardView } from "../clean-model";

/**
 * The cards the plain clean card cannot be: one card with several recipes, a generator, and the two holders
 * (custom rate, fluid tank). Everything else, crop farms, bees and the Extreme Entity Crusher included, is the
 * plain card with the small differences `adapt.ts` writes into its view.
 */
export type SpecialKind = "shared" | "power" | "custom-rate" | "tank" | "crop";

export function specialKindOf(recipe: Recipe, node: FactoryNode): SpecialKind | undefined {
  if (isFluidTankRecipe(recipe)) return "tank";
  if (isCustomRateRecipe(recipe)) return "custom-rate";
  if (recipe.power) return "power";
  if (isSharedMachineNode(node)) return "shared";
  if (isCropFarmRecipe(recipe) || isCropProductionRecipe(recipe)) return "crop";
  return undefined;
}

/** A holder is a card that takes whatever is wired to it. */
export function isHolderKind(kind: SpecialKind): boolean {
  return kind === "custom-rate" || kind === "tank";
}

/** What a shared machine's recipe says over its rails: its share of the machine's time and its keys. */
export interface SpecialRule {
  section: number;
  /** `NN%`. */
  pct: string;
  /** `x1.5`, or `UNUSED`. */
  word: string;
  unused: boolean;
  circuit?: RecipeProgrammedCircuit;
  canUp: boolean;
  canDown: boolean;
}

export interface SpecialSection {
  section: number;
  inputs: CleanPortView[];
  outputs: CleanPortView[];
  rule?: SpecialRule;
}

/** A strip chip that can also be typed into (a number setting). */
export interface SpecialChip extends CleanChipView {
  edit?: { text: string; commit: (text: string) => void; notes?: string[] };
}

export type NameTone = "ink" | "power" | "holder";

export interface SpecialSockets {
  /** The words in the two dashed boxes. */
  take: string;
  give: string;
  takeHandle: string;
  giveHandle: string;
}

export interface SpecialView {
  kind: SpecialKind;
  nodeId: string;
  name: string;
  nameSize: number;
  nameTone: NameTone;
  hasPicker: boolean;
  tier?: CleanCardView["tier"];
  amps?: CleanCardView["amps"];
  sections: SpecialSection[];
  /** The card's one power row, after every recipe (a shared machine). */
  power?: CleanPowerView;
  /** An empty holder: two dashed sockets in place of the rails. */
  sockets?: SpecialSockets;
  art?: string;
  glanceArt?: string;
  /** The machine item the picture draws when there is no render. */
  icon?: {
    id: string;
    displayName: string;
    iconPath?: string;
    iconAtlas?: ResourceAmount["iconAtlas"];
    dominantColor?: string;
  };
  glyph?: "gauge";
  /** A fluid tank has no count. */
  count?: CleanCardView["count"];
  /** The bar along the foot: an Up to card's reason, or an Exactly card's forced input. */
  foot?: CleanCardView["foot"];
  /** The card is in a dead loop or a clog lock: its outline pulses in the ring's tone. */
  loop?: CleanCardView["loop"];
  /** The Up to bar its zoomed-out face draws along its foot. */
  glance?: CleanCardView["glance"];
  /** A crop farm with no crop yet: a dashed key to pick one in place of the rails. */
  pick?: boolean;
  /** A crop farm with a crop: the head key that picks another. */
  cropKey?: boolean;
  chips: SpecialChip[];
  stripHeight: number;
  warnings: string[];
  selected: boolean;
  cannotRun: boolean;
  unset: boolean;
  /** Every port's handle id, for React Flow's handle bookkeeping. */
  handleIds: string[];
}

/** The share a recipe takes of a shared machine's time: whole percent of the machines it asks for. */
export function sectionShare(machines: number, total: number): { pct: string; unused: boolean } {
  const unused = !(machines > 0.0000005);
  return { pct: total > 0 ? `${Math.round((100 * machines) / total)}%` : "0%", unused };
}

/** Rows a section's rails need: the longer side, at least one. */
export function sectionRows(
  section: Pick<SpecialSection, "inputs" | "outputs">,
  extraRowsOf: (p: CleanPortView) => number,
): number {
  const rows = (ports: CleanPortView[]) => ports.reduce((sum, p) => sum + 1 + extraRowsOf(p), 0);
  return Math.max(1, rows(section.inputs), rows(section.outputs));
}

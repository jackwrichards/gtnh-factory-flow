"use client";

import { useMemo } from "react";
import type { FactoryNode, MachineConfigTierOption, Recipe } from "@/lib/model/types";
import {
  GT_OVERCLOCK_TIERS,
  applyMachineHandlerToRecipe,
  applyRecipeInputOverrides,
  formatCompact,
  formatPowerValue,
  getRecipeAvailableVoltageTiers,
  getRecipeCoilTierControl,
  getRecipeMachineConfigTierControls,
  getRecipeMachineHandlers,
  getRecipeMaximumVoltageTier,
  getRunVoltageTier,
  getSelectedMachineHandler,
  getVoltageTierIndex,
  isSteamMachineHandler,
  makeResourceKey,
  type MachineConfigTierControl,
} from "@/lib/model";
import { powerDisplayFromEuT, powerDisplaySuffix, rateSuffixForKind } from "@/lib/model/rate-unit";
import { isCustomRateRecipe } from "@/lib/model/custom-rate";
import {
  getRecipeProgrammedCircuit,
  type RecipeProgrammedCircuit,
} from "@/lib/model/programmed-circuit";
import { stripBeeFrameSlotInputs } from "@/lib/model/bee-display";
import { getOverclockedRecipeStats } from "@/lib/solver/overclock";
import {
  applyMachineOutputMultipliers,
  getMachineParallelMultiplier,
} from "@/lib/solver/machine-effects";
import { getNodePowerReport, getNodeSteamReport, hasPowerReport } from "@/lib/solver/power-report";
import { isMultiblockRecipe } from "@/lib/solver/power";
import { prefersCuratedMachineMath } from "@/lib/solver/runtime-calculation";
import { getFusionMachine } from "@/lib/machines/fusion";
import { energyHatchTypeExistsAtTier } from "@/lib/machines/energy-hatches";
import { carryMachineVoltage } from "@/lib/solver/hatch-input";
import { getVoltageTierMaxEuT } from "@/lib/model/tiers";
import { makePortKey, parsePortKey } from "@/lib/solver/plan/port-key";
import { parseSectionNodeId, sectionHandleId } from "@/lib/model/shared-machine";
import type { PlanUpTo, UpToReason } from "@/lib/solver/plan/types";
import { PIN_RULE_LABEL, pinRuleOf, withPinRule, type PinRule } from "@/lib/model/pin-rule";
import { getMachineStructureArt } from "@/lib/power/structure-art";
import { useFactoryStore, useRateDisplayUnits } from "@/store/factory-store";
import { useWorkspaceView } from "@/lib/workspace-view";
import { formatEnergyPerUnitParts, formatSlotRateBare, portReadsEnergy } from "../flow-explainers";
import { buildRailPorts, deriveNodeVerdict, type RailPort } from "../node-verdict";
import {
  machineIconAtTier,
  useMachineHandlerIconEntries,
  useRecipeMapIcons,
  type MachineHandlerIcon,
} from "../machine-icons";
import { orderMachineHandlers } from "../MachinePicker";
import type { RecipeNodeData } from "../RecipeNode";
import { CC, CC_GEOMETRY } from "./tokens";
import { mixHex } from "./colors";
import { UP_TO_COLOR } from "./up-to-reason";
import { cardLoop, LOOP_WORD, type LoopTone } from "./loops";
import { glanceBar, type GlanceBar } from "./glance";
import { isPinned, pinMachineKey, settingControls } from "./menus/settings-model";
import { mcTextWidth, measureClean, measureRowFigure, measureRowName, useFontEpoch } from "./text-measure";

type VoltageTier = Parameters<typeof getVoltageTierIndex>[0];

/** What one port row prints. All strings are final; the row does no formatting. */
export interface CleanPortView {
  key: string;
  nodeId: string;
  handleId: string;
  side: "input" | "output";
  port: RailPort;
  number: string;
  unit: string;
  name: string;
  /** The tooltip: the name, plus the chance an output comes with. */
  title: string;
  zero: boolean;
  /** The rate on this port is one the player set. */
  gold: boolean;
  /** That rate, per second (`FactoryNode.portRates`), when set. */
  rate?: number;
  /** Number and unit do not fit the words column at figure size. */
  numberSmall: boolean;
  /** The name does not fit one line at its normal size. */
  nameSmall: boolean;
  /** The name does not fit one line even at its small size. */
  nameClipped: boolean;
  wired: boolean;
  choice: boolean;
  resourceKey: string;
  /** What the solve sends out of / brings into the plan at this port with no drawer. */
  forced?: { number: string; unit: string };
  /** The buffer this port's forced row spills into (a maker making more than the buffer's users take). */
  spillTo?: string;
  /** The row an Up to card's reason names (STARVED, CLOGGED, UNUSED): lit in the reason's colour. */
  why?: FootTone;
}

export interface CleanChipView {
  id: string;
  label: string;
  value: string;
  /** The setting's own block or item, drawn as the chip's background. */
  icon?: string;
  /** A reading is words only, no box. */
  reading?: boolean;
  warn?: boolean;
  title: string;
  /** Computed layout, card-local px. */
  x: number;
  y: number;
  width: number;
}

export interface CleanPowerView {
  number: string;
  unit: string;
  name: string;
  stalled: boolean;
  title: string;
}

/**
 * The count under the machine (docs/up-to.md): what runs, big, and under it what is set, small: the rule's word and
 * the set box, as the overview's machine lines have them ("Up to [24]", "Exactly [24]", "Any [Set]" with no count).
 * The box asks for a count while nothing sets this part of the plan.
 */
export interface CleanCountView {
  /** What runs, as printed: "×18.2" (a crop's has no times sign). */
  text: string;
  /** What runs: an Up to card's reached count, else the solved count (the pin when one is set). */
  value: number;
  /** A count is set: Up to or Exactly. */
  pinned: boolean;
  rule: PinRule;
  /** The rule's word on the card: "Any", "Up to", "Exactly". */
  ruleWord: string;
  /** The rule cannot change here: a custom rate card is always Exactly. */
  ruleFixed: boolean;
  /** The count you set; absent when none is. */
  set?: number;
  /** The count you set as printed ("24"); empty when none is. */
  setText: string;
  /** What the set box shows: the count you set, or "Set". */
  box: string;
  /** The box asks for a count (it blinks with every prompt on the board). */
  prompt: boolean;
  /** Nothing runs. */
  zero: boolean;
  title: string;
}

/** The foot bar's colour: an Up to card's reason, FORCED IN, or plain (Up to with no reason). */
export type FootTone =
  | "full"
  | "bottleneck"
  | "starved"
  | "clogged"
  | "unused"
  | "limited"
  | "forced"
  | "plain";

/**
 * The bar along an Up to card's foot (docs/up-to.md, mockups/up-to-card pass 3): its fill is reached over the count,
 * one word in the reason's colour, one plain line, and the fraction the bar shows. A bottleneck's bar runs on striped
 * to what the line wants. An Exactly card fed by a forced input says FORCED IN. Every string final.
 */
export interface CleanFootView {
  tone: FootTone;
  /** "BOTTLENECK"; empty when the reason was not worked out. */
  word: string;
  /** One plain line, shortened (never cut) to fit beside the word and the fraction. */
  say: string;
  /** "18.2 / 24"; empty for FORCED IN. */
  frac: string;
  /** The fill's width in px inside the bar's track. */
  fill: number;
  /** A bottleneck's striped run-on, px inside the track. */
  ghost?: { left: number; width: number };
  /** For the tip. */
  facts: {
    reason: UpToReason | null | "FORCED";
    /** The ring the card is in, when it is in one. */
    loop?: LoopTone;
    rule: PinRule;
    running: number;
    capacity: number;
    wants?: number;
    /** The row it is about (STARVED, CLOGGED, UNUSED). */
    resource?: string;
    /** Other rows that hold it back just as alone. */
    tied: string[];
    /** STARVED: the full cards upstream, by name. */
    upstream: string[];
    /** FORCED IN: each forced input, "720 L/s Oxygen". */
    forced: string[];
  };
}

export interface CleanCardView {
  nodeId: string;
  name: string;
  nameSize: number;
  hasPicker: boolean;
  tier?: { label: string; fixed: boolean; title: string };
  amps?: { label: string; value: number; editable: boolean };
  inputs: CleanPortView[];
  outputs: CleanPortView[];
  power?: CleanPowerView;
  art?: string;
  /** What the zoomed-out view draws: the structure render, or the machine item. */
  glanceArt?: string;
  count: CleanCountView;
  /** The bar along the foot; absent when there is nothing to say (Any, or Exactly with nothing forced). */
  foot?: CleanFootView;
  /** The card is in a dead loop or a clog lock (`PlanSolveExtras.loops`): its outline pulses in the ring's tone. */
  loop?: LoopTone;
  /** The Up to bar its zoomed-out face draws along its foot (glance.ts). */
  glance?: GlanceBar;
  /** The programmed circuit: a badge in the well's top-left corner, its icon with its number on it. */
  circuit?: RecipeProgrammedCircuit;
  chips: CleanChipView[];
  stripHeight: number;
  selected: boolean;
  cannotRun: boolean;
  unset: boolean;
}

export interface CleanCardActions {
  stepTier: (direction: -1 | 1) => void;
  setAmps: (amps: number) => void;
  cycleMachine: (direction: -1 | 1) => void;
  switchMachine: (handlerId: string) => void;
  /** Sets the count, keeping the rule (Any becomes Up to); nothing clears it (Any). */
  setCount: (count: number | undefined) => void;
  /** The wheel on the count: one up or down (with none set, Up to at what runs rounded up; below one, none set). */
  stepCount: (direction: -1 | 1) => void;
  /** Any, Up to or Exactly (with none set, at what runs rounded up). */
  setRule: (rule: PinRule) => void;
  stepSetting: (id: string, direction: -1 | 1) => void;
}

/** What the component needs besides the view: the menus' inputs. */
export interface CleanCardContext {
  machineHandlers: ReturnType<typeof getRecipeMachineHandlers>;
  selectedMachineHandler: ReturnType<typeof getSelectedMachineHandler>;
  machineIcon?: MachineHandlerIcon;
  /** The settings behind the strip and the gear menu. */
  settings: Array<{ id: string; label: string; value: string; steps: boolean }>;
  /** Port keys of every rail port, in render order, for React Flow's handle bookkeeping. */
  handleIds: string[];
}

/** The card's tier ladder, with the classic card's rules. */
function getNodeTierControl(recipe: Recipe, node: FactoryNode) {
  const fusion = getFusionMachine(recipe.machineType);
  if (fusion) {
    return {
      minimum: fusion.tier as VoltageTier,
      maximum: fusion.tier as VoltageTier | undefined,
      current: fusion.tier as VoltageTier,
      available: undefined as VoltageTier[] | undefined,
      allowBelowMinimum: false,
      fixed: true,
    };
  }
  const hasVoltageTier = GT_OVERCLOCK_TIERS.some((entry) => entry.tier === recipe.minimumTier);
  const recipeMap = (recipe.source?.recipeMap ?? recipe.machineType).toLowerCase().trim();
  if (
    recipe.durationTicks <= 0 ||
    (recipe.eut === 0 && !hasVoltageTier && recipeMap !== "tree growth simulator")
  ) {
    return undefined;
  }
  const minimum = getOverclockedRecipeStats(recipe, node).minimumTier as VoltageTier;
  const allowBelowMinimum = isMultiblockRecipe(recipe);
  const maximum = allowBelowMinimum
    ? undefined
    : (getRecipeMaximumVoltageTier(recipe) as VoltageTier | undefined);
  const available = allowBelowMinimum
    ? undefined
    : (getRecipeAvailableVoltageTiers(recipe) as VoltageTier[] | undefined);
  const current = (
    allowBelowMinimum
      ? (GT_OVERCLOCK_TIERS.find((entry) => entry.tier === node.overclockTier)?.tier ?? minimum)
      : getRunVoltageTier(recipe, node.overclockTier)
  ) as VoltageTier;
  return { minimum, maximum, current, available, allowBelowMinimum, fixed: false };
}

function adjacentTier(
  current: VoltageTier,
  floor: VoltageTier | undefined,
  direction: -1 | 1,
  ceiling?: VoltageTier,
  available?: VoltageTier[],
): VoltageTier {
  const currentIndex = getVoltageTierIndex(current);
  const floorIndex = floor ? getVoltageTierIndex(floor) : 0;
  const ceilingIndex = ceiling ? getVoltageTierIndex(ceiling) : GT_OVERCLOCK_TIERS.length - 1;
  if (available) {
    const choices = available.filter((tier) => {
      const index = getVoltageTierIndex(tier);
      return index >= floorIndex && index <= ceilingIndex;
    });
    return (
      (direction > 0
        ? choices.find((tier) => getVoltageTierIndex(tier) > currentIndex)
        : choices.findLast((tier) => getVoltageTierIndex(tier) < currentIndex)) ?? current
    );
  }
  const next = Math.min(ceilingIndex, Math.max(floorIndex, currentIndex + direction));
  return (GT_OVERCLOCK_TIERS[next]?.tier ?? current) as VoltageTier;
}

/** `x1.2` form: three decimals under 1, two under 10, one under 100, whole from 100. */
export function formatSolvedMachines(value: number): string {
  if (value <= 0.0000005) return "0";
  if (value < 0.0005) return "<0.001";
  if (value >= 100) return String(Math.ceil(value - 0.000001));
  const decimals = value < 1 ? 3 : value < 10 ? 2 : 1;
  return value.toFixed(decimals).replace(/\.?0+$/, "");
}

function isLocked(): boolean {
  const s = useFactoryStore.getState();
  return s.isReadOnly || s.checklistMode;
}

const WORDS = CC_GEOMETRY.wordsWidth;

/** The number a circuit is dialled to: the recipe's setting, else the item's own (`...integrated_circuit@24`). */
export function circuitNumber(circuit: RecipeProgrammedCircuit): string | undefined {
  return circuit.setting ?? circuit.resource?.id.match(/@(\d{1,2})$/)?.[1];
}

/**
 * The number on a port's row: what its wires carry. What the solve forces out of the plan at an output is the forced
 * row under it, not part of the row (the mod's `PortView.wiredPerSecond`); an input's reading is its wires' already.
 */
export function portRowPerSecond(
  port: Pick<RailPort, "side" | "currentPerSecond">,
  forcedPerSecond: number | undefined,
): number {
  return port.side === "output" && forcedPerSecond !== undefined && forcedPerSecond > 0
    ? Math.max(0, port.currentPerSecond - forcedPerSecond)
    : port.currentPerSecond;
}

export function buildPortView(
  nodeId: string,
  port: RailPort,
  node: Pick<FactoryNode, "portRates">,
  forcedAt: ReadonlyMap<string, number> | undefined,
  spillAt?: ReadonlyMap<string, string>,
): CleanPortView {
  const portKey = makePortKey(nodeId, port.side === "input" ? "i" : "o", port.handleId);
  const forcedRate = forcedAt?.get(portKey);
  const spillTo = spillAt?.get(portKey);
  const shown = portRowPerSecond(port, forcedRate);
  let number: string;
  let unit: string;
  if (portReadsEnergy(port)) {
    const parts = formatEnergyPerUnitParts(port.energyPerUnit!, port.kind);
    number = parts.value;
    unit = parts.unit;
  } else {
    number = formatSlotRateBare(shown, port.kind);
    unit = rateSuffixForKind(port.kind).trim();
  }
  const chance = (port.resource as { chance?: number } | undefined)?.chance;
  const chanceText =
    chance !== undefined && chance < 1 ? `${Math.round(chance * 10000) / 100}%` : undefined;
  return {
    key: port.key,
    nodeId,
    handleId: port.handleId,
    side: port.side,
    port,
    number,
    unit,
    name: port.displayName,
    title: chanceText ? `${port.displayName} (${chanceText} chance)` : port.displayName,
    zero: !(shown > 0),
    gold: node.portRates?.[port.handleId] !== undefined,
    rate: node.portRates?.[port.handleId],
    numberSmall: measureRowFigure(number, unit) > WORDS,
    // The mod's rule (CardPaint.words): full size when it fits in the game font (its 71 px), else 0.75; what still runs
    // past the row in the app's face is cut and faded.
    nameSmall: mcTextWidth(port.displayName) > 71,
    nameClipped: measureRowName(port.displayName, mcTextWidth(port.displayName) > 71) > WORDS,
    wired: port.connected,
    choice: (port.resource?.alternatives?.length ?? 0) > 1,
    resourceKey: makeResourceKey(port.kind, port.resourceId),
    forced:
      forcedRate !== undefined && forcedRate > 0
        ? {
            number: formatSlotRateBare(forcedRate, port.kind),
            unit: rateSuffixForKind(port.kind).trim(),
          }
        : undefined,
    ...(spillTo !== undefined && forcedRate !== undefined && forcedRate > 0 ? { spillTo } : {}),
  };
}

/**
 * Lay the strip's chips out in rows of the card's inner width, one cell
 * apart. Positions are computed (not flowed) so the card's height is a pure
 * function of the data: nothing is measured from the DOM.
 */
export function layoutStrip(chips: Array<Omit<CleanChipView, "x" | "y" | "width">>): {
  chips: CleanChipView[];
  height: number;
} {
  if (chips.length === 0) return { chips: [], height: 0 };
  const G = CC_GEOMETRY;
  const inner = G.cardWidth - 2 * G.stripInset;
  let x = 0;
  let row = 0;
  const placed = chips.map((chip) => {
    const text = measureClean(chip.label, 8) + (chip.value ? 4 + measureClean(chip.value, 8) : 0);
    const width = Math.min(inner, Math.ceil(text + (chip.reading ? 0 : 12) + (chip.icon ? 17 : 0)));
    if (x > 0 && x + width > inner) {
      x = 0;
      row += 1;
    }
    const out: CleanChipView = {
      ...chip,
      x: G.stripInset + x,
      y: G.stripGap + G.stripPad + row * G.stripPitch,
      width,
    };
    x += width + G.stripChipGap;
    return out;
  });
  return { chips: placed, height: (row + 1) * G.stripPitch + G.cell };
}

/**
 * What a card needs to be drawn as a shell (virtual/): which machine it is, its tier ladder and whether it can run
 * (the red ring). The first steps of the card's derived state, so the card and its shell cannot disagree.
 */
export function deriveCardFace(recipe: Recipe, projectNode: FactoryNode) {
  const selectedMachineHandler = getSelectedMachineHandler(recipe, projectNode);
  const nodeRecipe = applyRecipeInputOverrides(recipe, projectNode);
  const effectiveRecipe = applyMachineHandlerToRecipe(nodeRecipe, projectNode);
  const machineDrawsEu = effectiveRecipe.eut > 0 && !isSteamMachineHandler(selectedMachineHandler);
  const tierControl = machineDrawsEu ? getNodeTierControl(effectiveRecipe, projectNode) : undefined;
  const powerReport =
    machineDrawsEu && tierControl && hasPowerReport(nodeRecipe)
      ? getNodePowerReport(nodeRecipe, projectNode)
      : undefined;
  return {
    selectedMachineHandler,
    nodeRecipe,
    effectiveRecipe,
    machineDrawsEu,
    tierControl,
    powerReport,
  };
}

/** The picture a card shows in its glance face and its picture column: the structure render, else the machine's item. */
export function cardPicture(
  recipe: Recipe,
  projectNode: FactoryNode,
  face: Pick<ReturnType<typeof deriveCardFace>, "selectedMachineHandler" | "tierControl">,
  machineIcons: ReturnType<typeof useMachineHandlerIconEntries>,
  mapIcons: ReturnType<typeof useRecipeMapIcons>,
) {
  const pictureTier = (face.tierControl?.current ?? projectNode.overclockTier) as string;
  const recipeMapIcon = mapIcons.get(recipe.source?.recipeMap ?? recipe.machineType) as
    | MachineHandlerIcon
    | undefined;
  const machineIcon =
    machineIconAtTier(machineIcons.get(face.selectedMachineHandler.id), pictureTier) ??
    recipeMapIcon;
  const art = getMachineStructureArt(face.selectedMachineHandler.id);
  return { machineIcon, art };
}

/** The count a card prints, as the card's count box and its glance face do. */
type PlanExtras = NonNullable<ReturnType<typeof useFactoryStore.getState>["lastResult"]>["plan"];
const planSets = new WeakMap<object, { unanchored: Set<string>; unneeded: Set<string> }>();
function planSetsOf(plan: NonNullable<PlanExtras>) {
  let sets = planSets.get(plan);
  if (!sets) {
    sets = { unanchored: new Set(plan.unanchored), unneeded: new Set(plan.unneeded) };
    planSets.set(plan, sets);
  }
  return sets;
}

/**
 * A card's count: its rule as the board shows it, what it needs, and what runs (an Up to card's reached count from the
 * solve, else the pin when one is set, else the solved count). With no count set the rule is Any: the plan picks it.
 */
export function cardCountState(
  result: RecipeNodeData["result"],
  projectNode: Pick<FactoryNode, "id" | "solvePin" | "solvePinExact">,
  plan: PlanExtras,
  recipe?: Pick<Recipe, "machineType">,
  needed: number = result?.theoreticalMachinesRequired ?? 0,
) {
  const rule = pinRuleOf(projectNode, recipe);
  const pin = projectNode.solvePin;
  const pinned = rule !== "any";
  // An Up to card's read-out; one left over from before the rule changed is not this card's.
  const upTo = rule === "upTo" ? plan?.upTo?.[projectNode.id] : undefined;
  // Sets, kept per plan: a board of a thousand cards asks this of each of them on every solve.
  const sets = plan !== undefined ? planSetsOf(plan) : undefined;
  const unset =
    sets !== undefined &&
    !pinned &&
    (sets.unanchored.has(projectNode.id) || sets.unneeded.has(projectNode.id));
  const value = upTo ? upTo.reached : pinned ? (pin as number) : needed;
  return { needed, pin, pinned, unset, value, rule, upTo };
}

/** The set count as the card prints it: up to three decimals, no trailing zeros. */
export function formatSetCount(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/** The count view (the plain card's and every special card's), from `cardCountState`. */
export function buildCountView(
  state: ReturnType<typeof cardCountState>,
  opts: {
    /** A crop's count has no times sign. */
    noTimes?: boolean;
    /** A custom rate card: always Exactly, no rule menu. */
    ruleFixed?: boolean;
    title?: string;
  } = {},
): CleanCountView {
  const { rule, pinned, value, unset, needed } = state;
  const set = pinned ? (state.pin as number) : undefined;
  const setText = set !== undefined ? formatSetCount(set) : "";
  return {
    text: `${opts.noTimes ? "" : "×"}${formatSolvedMachines(value)}`,
    value,
    pinned,
    rule,
    ruleWord: PIN_RULE_LABEL[rule],
    ruleFixed: opts.ruleFixed === true,
    set,
    setText,
    box: pinned ? setText : "Set",
    prompt: !pinned && unset,
    zero: state.upTo ? state.upTo.reached <= 0.0000005 : !pinned && needed <= 0.0000005,
    title:
      opts.title ??
      (rule === "upTo"
        ? "Runs as many as the plan lets it. Never more than you set."
        : rule === "exact"
          ? "Runs exactly this many. A gap shows as a forced flow."
          : "How many of this machine the plan needs."),
  };
}

/**
 * The count after one wheel step: with none set, what runs rounded up (at least one); else the set count rounded,
 * plus or minus one; below one, none (undefined).
 */
export function wheelCount(
  count: Pick<CleanCountView, "rule" | "set" | "value">,
  direction: -1 | 1,
): number | undefined {
  if (count.rule === "any" || count.set === undefined)
    return Math.max(1, Math.ceil(count.value - 0.000001));
  const next = Math.round(count.set) + direction;
  return next >= 1 ? next : undefined;
}

/** A count typed into an open box is set once the typing rests this long, so "12" is one edit, not "1" then "12". */
export const LIVE_TYPE_MS = 300;

/**
 * A count typed into the box: a number, a leading times sign allowed. Zero and an empty box clear it (0); text that
 * is not a count, or a negative one, is undefined (nothing is set).
 */
export function parseCountText(text: string): number | undefined {
  const trimmed = text.trim().replace(/^[×x]\s*/, "");
  if (trimmed === "") return 0;
  const value = Number.parseFloat(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * The box's text after one wheel step while it is being typed in: the number in it rounded, plus or minus one (below
 * one, empty); with nothing in it, what the wheel gives a card with no count. The box sets it at once.
 */
export function wheelDraft(
  draft: string,
  count: Pick<CleanCountView, "value">,
  direction: -1 | 1,
): string {
  const typed = parseCountText(draft);
  const next =
    typed !== undefined && typed > 0
      ? wheelCount({ rule: "upTo", set: typed, value: count.value }, direction)
      : wheelCount({ rule: "any", set: undefined, value: count.value }, direction);
  return next === undefined ? "" : formatSetCount(next);
}

type PinFields = Pick<FactoryNode, "solvePin" | "solvePinExact">;

/** The patch that gives a card `rule` and `count` (every write of a count goes through `withPinRule`). */
export function pinPatch(node: PinFields, rule: PinRule, count: number | undefined): PinFields {
  const next = withPinRule({ solvePin: node.solvePin, solvePinExact: node.solvePinExact }, rule, count);
  return { solvePin: next.solvePin, solvePinExact: next.solvePinExact };
}

/**
 * The count's actions for a card, over `updateNode`: what a click, the wheel, a middle click and the rule menu write.
 * `count` is the card's own count view (a shared machine's is its recipes' together).
 */
export function pinActions(
  node: Pick<FactoryNode, "id"> & PinFields,
  count: Pick<CleanCountView, "rule" | "set" | "value" | "ruleFixed">,
  update: (id: string, patch: PinFields) => void,
  locked: () => boolean,
): Pick<CleanCardActions, "setCount" | "stepCount" | "setRule"> {
  const write = (rule: PinRule, value: number | undefined) => {
    if (!locked()) update(node.id, pinPatch(node, rule, value));
  };
  // A typed or stepped count keeps the rule; from Any it is Up to (a custom rate card's is Exactly). A count cleared
  // (typed 0, stepped below one, the middle button) is Any, and the next count set is Up to again.
  const ruleForCount: PinRule = count.ruleFixed
    ? "exact"
    : count.rule === "any"
      ? "upTo"
      : count.rule;
  return {
    setCount: (value) => write(ruleForCount, value),
    stepCount: (direction) => write(ruleForCount, wheelCount(count, direction)),
    setRule: (rule) => {
      if (count.ruleFixed && rule !== "any") return;
      // The rule it already reads, with no count set: nothing to change.
      if (rule === count.rule && count.set === undefined) return;
      write(rule, count.set ?? Math.max(1, Math.ceil(count.value - 0.000001)));
    },
  };
}

/** The bar's width (the card's inner width), its track (2 px in from each side) and the room its words have. */
const FOOT_WIDTH = CC_GEOMETRY.cardWidth - 2 * CC_GEOMETRY.railInset;
export const FOOT_TRACK = FOOT_WIDTH - 4;
const FOOT_TEXT = FOOT_WIDTH - 14;
const FOOT_GAP = 6;
const FOOT_SIZE = 8;

const FOOT_TONE: Record<UpToReason, FootTone> = {
  FULL: "full",
  BOTTLENECK: "bottleneck",
  STARVED: "starved",
  CLOGGED: "clogged",
  UNUSED: "unused",
  LIMITED: "limited",
};

/** A ring's bar takes the ring's tone: a dead loop STARVED's amber, a clog lock CLOGGED's purple (never UNUSED's grey). */
export const LOOP_FOOT_TONE: Record<LoopTone, FootTone> = { dead: "starved", clog: "clogged" };

/** The first of `lines` that fits `room` px at the bar's size; none fits, nothing (the word and fraction still say it). */
function fitLine(lines: string[], room: number): string {
  return lines.find((line) => measureClean(line, FOOT_SIZE) <= room) ?? "";
}

/** The resource a row key names, by its port's name when the card has it. */
function resourceName(
  resourceKey: string | undefined,
  ports: readonly CleanPortView[],
): string | undefined {
  if (!resourceKey) return undefined;
  return (
    ports.find((port) => port.resourceKey === resourceKey)?.name ??
    resourceKey.slice(resourceKey.indexOf(":") + 1)
  );
}

/**
 * The foot bar of a card, or nothing: an Up to card with its read-out, or an Exactly card with a forced input on one
 * of its rows. `ports` are the card's rows (every recipe's on a shared machine), `cardName` names a card by id. A card
 * in a ring (`loop`) says DEAD LOOP or CLOG LOCK in the ring's tone in place of its reason.
 */
export function buildFootView(
  count: Pick<CleanCountView, "rule" | "set">,
  upTo: PlanUpTo | undefined,
  ports: { inputs: readonly CleanPortView[]; outputs: readonly CleanPortView[] },
  cardName: (id: string) => string | undefined = () => undefined,
  loop?: LoopTone,
): CleanFootView | undefined {
  const fmt = formatSolvedMachines;
  if (count.rule === "upTo" && upTo) {
    const capacity = upTo.capacity > 0 ? upTo.capacity : (count.set ?? 0);
    const reached = Math.max(0, upTo.reached);
    const wants =
      upTo.reason === "BOTTLENECK" && upTo.wants !== undefined && upTo.wants > capacity
        ? upTo.wants
        : undefined;
    // The bar's end is the count, or what the line wants when that is more.
    const end = wants ?? capacity;
    const share = (value: number) => (end > 0 ? Math.min(1, Math.max(0, value / end)) : 0);
    const fill = Math.round(FOOT_TRACK * share(reached));
    const ghostLeft = Math.round(FOOT_TRACK * share(capacity));
    const ghost =
      wants !== undefined ? { left: ghostLeft, width: FOOT_TRACK - ghostLeft } : undefined;
    const frac = `${fmt(reached)} / ${fmt(end)}`;
    const reason = upTo.reason;
    const resource =
      reason === "STARVED"
        ? resourceName(upTo.resourceKey, ports.inputs)
        : reason === "CLOGGED" || reason === "UNUSED"
          ? resourceName(upTo.resourceKey, ports.outputs)
          : undefined;
    const tied = (upTo.tied ?? [])
      .map((key) => {
        const at = parsePortKey(key);
        const rows = at?.side === "i" ? ports.inputs : ports.outputs;
        return at
          ? rows.find((port) => port.handleId.replace(/^r\d+:/, "") === at.handle)?.name
          : undefined;
      })
      .filter((name): name is string => name !== undefined);
    const upstream = (upTo.upstream ?? []).map((id) => cardName(id) ?? "a card");
    const word = loop ? LOOP_WORD[loop] : (reason ?? "");
    const room =
      FOOT_TEXT -
      (word ? measureClean(word, FOOT_SIZE) + FOOT_GAP : 0) -
      measureClean(frac, FOOT_SIZE) -
      FOOT_GAP;
    const lines: string[] =
      reason === "FULL"
        ? ["nothing wants more"]
        : reason === "BOTTLENECK"
          ? wants !== undefined
            ? [`the line wants ${fmt(wants)}`, `wants ${fmt(wants)}`]
            : ["the line wants more"]
          : reason === "STARVED"
            ? resource
              ? [`short of ${resource}`, "short of an input"]
              : ["short of an input"]
            : reason === "CLOGGED" || loop === "clog"
              ? resource
                ? [`${resource} has nowhere to go`, `nowhere for ${resource}`, "an output backs up"]
                : ["an output backs up"]
              : reason === "UNUSED"
                ? resource
                  ? [`nothing takes ${resource}`, "nothing takes it"]
                  : ["nothing takes it"]
                : reason === "LIMITED"
                  ? ["the plan holds it back", "held back"]
                  : [];
    return {
      tone: loop ? LOOP_FOOT_TONE[loop] : reason ? FOOT_TONE[reason] : "plain",
      word,
      say: fitLine(lines, room),
      frac,
      fill,
      ghost,
      facts: {
        reason,
        loop,
        rule: "upTo",
        running: reached,
        capacity,
        wants,
        resource,
        tied,
        upstream,
        forced: [],
      },
    };
  }
  if (count.rule === "exact") {
    const forced = ports.inputs.filter((port) => port.forced);
    if (forced.length === 0) return undefined;
    const first = forced[0]!;
    const rate = `${first.forced!.number}${first.forced!.unit ? ` ${first.forced!.unit}` : ""}`;
    const set = count.set ?? 0;
    const keep = set === 1 ? "to keep it running" : `to keep all ${fmt(set)} running`;
    const word = "FORCED IN";
    const room = FOOT_TEXT - measureClean(word, FOOT_SIZE) - FOOT_GAP;
    const lines =
      forced.length === 1
        ? [`${rate} of ${first.name} ${keep}`, `${rate} of ${first.name}`, rate]
        : [
            `${rate} of ${first.name} and ${forced.length - 1} more`,
            `${first.name} and ${forced.length - 1} more`,
            `${forced.length} inputs`,
          ];
    return {
      tone: "forced",
      word,
      say: fitLine(lines, room),
      frac: "",
      fill: 0,
      facts: {
        reason: "FORCED",
        rule: "exact",
        running: set,
        capacity: set,
        tied: [],
        upstream: [],
        forced: forced.map(
          (port) =>
            `${port.forced!.number}${port.forced!.unit ? ` ${port.forced!.unit}` : ""} ${port.name}`,
        ),
      },
    };
  }
  return undefined;
}

/**
 * The tone a card's frame takes (`data-tone` on `.cc-card`): a problem's, the bar's own colour. FULL, an Up to card
 * with no reason, Any and no read-out keep the normal edge.
 */
export function frameTone(foot: Pick<CleanFootView, "tone"> | undefined): FootTone | undefined {
  return foot && foot.tone !== "full" && foot.tone !== "plain" ? foot.tone : undefined;
}

/**
 * The same frame tone without the card's rows (a shell, virtual/use-card-face.ts): an Up to card's reason, or an
 * Exactly card with a forced input on any of its recipes' rows.
 */
export function stateFrameTone(
  state: Pick<ReturnType<typeof cardCountState>, "rule" | "upTo">,
  plan: { forced: ReadonlyArray<{ nodeId: string; side: string }> } | undefined,
  nodeId: string,
): FootTone | undefined {
  if (state.rule === "upTo") {
    const reason = state.upTo?.reason;
    return reason ? frameTone({ tone: FOOT_TONE[reason] }) : undefined;
  }
  if (state.rule === "exact") {
    const fed = plan?.forced.some(
      (entry) => entry.side === "in" && entry.nodeId.split("#r")[0] === nodeId,
    );
    return fed ? "forced" : undefined;
  }
  return undefined;
}

/**
 * The rows an Up to card's reason names (docs/up-to.md): STARVED's short input, CLOGGED's or UNUSED's output, and the
 * rows tied with it, each lit in the reason's colour (the bar's tone). FULL, BOTTLENECK, LIMITED and no reason light
 * nothing. A row is matched by its port key, a shared machine's recipe by its handle's section prefix; a read-out
 * with no port key falls back to the row of its resource on the reason's side.
 */
export function withReasonPorts(
  ports: readonly CleanPortView[],
  upTo: PlanUpTo | undefined,
): CleanPortView[] {
  const reason = upTo?.reason;
  if (!upTo || (reason !== "STARVED" && reason !== "CLOGGED" && reason !== "UNUSED")) {
    return [...ports];
  }
  const tone = FOOT_TONE[reason];
  const side = reason === "STARVED" ? "input" : "output";
  const named = new Set<string>();
  for (const key of [upTo.portKey, ...(upTo.tied ?? [])]) {
    const at = key ? parsePortKey(key) : undefined;
    if (!at) continue;
    const section = parseSectionNodeId(at.nodeId).section;
    named.add(`${at.side === "i" ? "input" : "output"}|${sectionHandleId(section, at.handle)}`);
  }
  return ports.map((port) => {
    const lit =
      named.has(`${port.side}|${port.handleId}`) ||
      (upTo.portKey === undefined && port.side === side && port.resourceKey === upTo.resourceKey);
    return lit && !port.port.free ? { ...port, why: tone } : port;
  });
}

/**
 * A lit row's stripes: its reason's colour (the overview's and the bar's, `UP_TO_COLOR`) mixed into the card's surface
 * as the free ends mix theirs (`drawerMixes`: body 7%, stripe 13%), so each reason has its own.
 */
export function reasonStripes(tone: FootTone): { body: string; stripe: string } | undefined {
  const hex = (UP_TO_COLOR as Record<string, string | undefined>)[tone.toUpperCase()];
  if (!hex) return undefined;
  return { body: mixHex(hex, CC.surface, 0.07), stripe: mixHex(hex, CC.surface, 0.13) };
}

/** A card's name by id, for the bar's tip (the full cards upstream of a starved one). */
export function cardNameIn(
  project: { nodes: readonly FactoryNode[]; recipes: readonly Recipe[] },
  id: string,
): string | undefined {
  const node = project.nodes.find((entry) => entry.id === id);
  if (!node) return undefined;
  const recipe = project.recipes.find((entry) => entry.id === node.recipeId);
  if (!recipe) return undefined;
  if (recipe.power) return recipe.machineType;
  try {
    return getSelectedMachineHandler(recipe, node).label;
  } catch {
    return recipe.machineType;
  }
}

/** Everything the clean card draws and does, from the same inputs as the classic card. */
export function useCleanCardModel(
  data: RecipeNodeData,
  selected: boolean,
): { view: CleanCardView; actions: CleanCardActions; context: CleanCardContext } {
  const { projectNode, recipe, result } = data;
  useFontEpoch();
  const updateNode = useFactoryStore((state) => state.updateNode);
  const averageDraw = useWorkspaceView().averageMachineDraw;
  useRateDisplayUnits();
  // Pins live on the project, not the node: re-render when they move.
  useFactoryStore((state) => state.project.settingPins);
  const machineIcons = useMachineHandlerIconEntries();
  const mapIcons = useRecipeMapIcons();
  // The solve is read lazily like the classic card does: this component
  // re-renders on every solver tick, which is when any of it can change.
  const { project: liveProject, lastResult } = useFactoryStore.getState();

  const derived = useMemo(() => {
    const machineHandlers = getRecipeMachineHandlers(recipe);
    const {
      selectedMachineHandler,
      nodeRecipe,
      effectiveRecipe,
      machineDrawsEu,
      tierControl,
      powerReport,
    } = deriveCardFace(recipe, projectNode);
    const steamReport = !machineDrawsEu ? getNodeSteamReport(nodeRecipe, projectNode) : undefined;
    const showHatchControl = Boolean(
      powerReport?.isMultiblock &&
      prefersCuratedMachineMath(effectiveRecipe) &&
      !getFusionMachine(effectiveRecipe.machineType),
    );
    const coilControl = getRecipeCoilTierControl(effectiveRecipe, projectNode);
    const controls = getRecipeMachineConfigTierControls(effectiveRecipe, projectNode);
    const overclockedStats = getOverclockedRecipeStats(nodeRecipe, projectNode);
    const displayRecipe = stripBeeFrameSlotInputs(effectiveRecipe);
    const adjusted = applyMachineOutputMultipliers(
      displayRecipe,
      projectNode,
      overclockedStats.tier,
    );
    const overclockedRecipe = { ...displayRecipe, ...adjusted, ...overclockedStats };
    return {
      machineHandlers,
      selectedMachineHandler,
      nodeRecipe,
      tierControl,
      powerReport,
      steamReport,
      showHatchControl,
      coilControl,
      controls,
      overclockedRecipe,
      parallel: getMachineParallelMultiplier(effectiveRecipe, projectNode),
      circuit: getRecipeProgrammedCircuit(effectiveRecipe) as RecipeProgrammedCircuit | undefined,
    };
  }, [recipe, projectNode]);

  const pinControls = useMemo(() => settingControls(recipe, projectNode), [recipe, projectNode]);
  const verdict = deriveNodeVerdict(liveProject, lastResult, projectNode.id);
  const rails = buildRailPorts(
    liveProject,
    lastResult,
    projectNode.id,
    derived.overclockedRecipe,
    verdict,
  );
  const plan = lastResult?.plan;

  // Only this card's forced entries, and its spills into buffers, which it forces out the same way; the plan lists are
  // short, so no memo.
  const forcedAt = new Map<string, number>();
  const spillAt = new Map<string, string>();
  for (const entry of [...(plan?.forced ?? []), ...(plan?.spills ?? [])]) {
    if (entry.nodeId !== projectNode.id) continue;
    forcedAt.set(entry.portKey, (forcedAt.get(entry.portKey) ?? 0) + entry.perSecond);
    if ("drawerId" in entry) spillAt.set(entry.portKey, entry.drawerId);
  }

  const { selectedMachineHandler, machineHandlers, tierControl, powerReport, steamReport } =
    derived;
  const { machineIcon, art } = cardPicture(recipe, projectNode, derived, machineIcons, mapIcons);
  const name = machineIcon?.displayName ?? selectedMachineHandler.label;

  const hasPicker = machineHandlers.length > 1;
  const tierLabel = powerReport?.isMultiblock ? powerReport.tier : tierControl?.current;
  const ampsLabel =
    powerReport?.isMultiblock && derived.showHatchControl
      ? (powerReport.hatchChip ?? `${formatCompact(powerReport.amps)}A`)
      : undefined;

  const G = CC_GEOMETRY;
  const chipsLeft =
    G.cardWidth - 8 - (tierLabel ? G.chipWidth : 0) - (ampsLabel ? 2 + G.chipWidth : 0);
  const nameRoom = Math.max(40, chipsLeft - 8 - 8 - 2 * (G.keySize + 2) - 8 - (hasPicker ? 15 : 0));
  // The mod's name is x1.25 of its 8 px text (10); Monocraft runs wider than the mod's face, so it steps down to 8 before it clips with an ellipsis.
  const nameSize = [10, 9].find((size) => measureClean(name, size) <= nameRoom) ?? 8;

  // Count: what runs, big; what you set, small, under it (docs/up-to.md).
  const countState = cardCountState(result, projectNode, plan, recipe);
  const { unset } = countState;
  const count = buildCountView(countState, { ruleFixed: isCustomRateRecipe(recipe) });

  // Power row: a machine's draw, or a steam machine's litres.
  // An Up to card bills its count averaged by how full it got of it (its read-out's reached over capacity).
  const upTo = countState.upTo;
  const usage = upTo
    ? upTo.capacity > 0
      ? Math.min(1, upTo.reached / upTo.capacity)
      : 0
    : Math.min(1, Math.max(0, result?.utilization ?? 1));
  const drawScale = averageDraw ? usage : usage > 0 ? 1 : 0;
  // The card's demand is the machines it has (the count set, fractions and all; else the solved count) times one
  // machine's draw, as the mod prints it; averaged by its use (an Up to card's reached over its count).
  const solvedNeeded = result?.theoreticalMachinesRequired ?? 0;
  const machines = (count.set ?? solvedNeeded) * Math.max(1, projectNode.parallel);
  let power: CleanPowerView | undefined;
  if (powerReport) {
    const stalled = powerReport.state !== "ok";
    power = {
      number: stalled
        ? "TIER!"
        : formatPowerValue(
            powerDisplayFromEuT(powerReport.drawEuT * machines * drawScale, powerReport.tier),
          ),
      unit: stalled ? "" : powerDisplaySuffix(powerReport.tier),
      name: "Power",
      stalled,
      title: stalled
        ? (powerReport.recipeGateReason ?? "This machine's tier is too low to run the recipe.")
        : `${powerReport.tier} machine, ${formatCompact(powerReport.amps)}A`,
    };
  } else if (steamReport) {
    power = {
      number: formatCompact(steamReport.drawSteamPerTick * 20 * machines * drawScale),
      unit: "L/s",
      name: steamReport.highPressure ? "HP steam" : "Steam",
      stalled: false,
      title: "Steam this machine burns",
    };
  }

  // Settings strip (the mod's pins): the settings pinned to this machine's cards, the coil by default on a heat recipe.
  const settings: CleanCardContext["settings"] = [];
  const rawChips: Array<Omit<CleanChipView, "x" | "y" | "width">> = [];
  const pinKey = pinMachineKey(recipe, projectNode);
  for (const control of pinControls) {
    settings.push({
      id: control.id,
      label: control.label,
      value: control.value,
      steps: control.options.length > 1,
    });
    if (!isPinned(liveProject, pinKey, control)) continue;
    rawChips.push({
      id: control.id,
      label: control.label,
      value: control.value,
      icon: control.icon,
      warn: control.warn || undefined,
      title: `${control.label}: ${control.value}`,
    });
  }
  const parallels = powerReport?.parallels ?? steamReport?.parallels ?? derived.parallel;
  if (parallels > 1) {
    rawChips.push({
      id: "parallel",
      label: "Parallel",
      value: `×${formatCompact(parallels)}`,
      reading: true,
      title: "Operations at once. Set by the machine and its configuration.",
    });
  }
  const strip = layoutStrip(rawChips);

  // The rows an Up to card's reason names are lit in its colour (only while the card is Up to: `upTo` is its own).
  const inputs = withReasonPorts(
    rails.inputs.map((port) => buildPortView(projectNode.id, port, projectNode, forcedAt, spillAt)),
    countState.upTo,
  );
  const outputs = withReasonPorts(
    rails.outputs.map((port) => buildPortView(projectNode.id, port, projectNode, forcedAt, spillAt)),
    countState.upTo,
  );
  const loop = cardLoop(plan?.loops, projectNode.id);
  const foot = buildFootView(
    count,
    countState.upTo,
    { inputs, outputs },
    (id) => cardNameIn(liveProject, id),
    loop,
  );

  const view: CleanCardView = {
    nodeId: projectNode.id,
    name,
    nameSize,
    hasPicker,
    tier: tierLabel
      ? {
          label: tierLabel,
          fixed: tierControl?.fixed === true,
          title: tierControl?.fixed
            ? "Fixed by the reactor mark"
            : `Tier ${tierLabel}. Click up, right click down.`,
        }
      : undefined,
    amps:
      ampsLabel && powerReport
        ? { label: ampsLabel, value: powerReport.amps, editable: true }
        : undefined,
    inputs,
    outputs,
    power,
    art,
    glanceArt: art ?? machineIcon?.iconPath,
    count,
    foot,
    loop,
    glance: glanceBar(countState.upTo, loop),
    circuit: derived.circuit,
    chips: strip.chips,
    stripHeight: strip.height,
    selected,
    cannotRun: powerReport !== undefined && powerReport.state !== "ok",
    unset,
  };

  const actions: CleanCardActions = {
    stepTier: (direction) => {
      if (isLocked() || !tierControl || tierControl.fixed) return;
      if (derived.showHatchControl && powerReport) {
        const next = adjacentTier(powerReport.tier as VoltageTier, undefined, direction);
        if (next !== powerReport.tier) {
          updateNode(projectNode.id, {
            hatchVoltageTier: next as NonNullable<FactoryNode["hatchVoltageTier"]>,
            hatchAmps: powerReport.amps,
            powerInputMode: projectNode.powerInputMode ?? "amps",
            powerEuT: powerReport.amps * getVoltageTierMaxEuT(next),
          });
        }
        return;
      }
      const next = adjacentTier(
        tierControl.current,
        tierControl.allowBelowMinimum ? undefined : tierControl.minimum,
        direction,
        tierControl.maximum,
        tierControl.available,
      );
      if (next !== tierControl.current) updateNode(projectNode.id, { overclockTier: next });
    },
    setAmps: (amps) => {
      if (isLocked() || !powerReport) return;
      const value = Math.min(16_777_216, Math.max(1, Math.round(amps)));
      updateNode(projectNode.id, {
        hatchVoltageTier: powerReport.tier as NonNullable<FactoryNode["hatchVoltageTier"]>,
        hatchAmps: value,
        powerInputMode: projectNode.powerInputMode ?? "amps",
        powerEuT: value * getVoltageTierMaxEuT(powerReport.tier),
      });
    },
    switchMachine: (handlerId) => {
      if (isLocked() || machineHandlers.length <= 1) return;
      const next = machineHandlers.find((handler) => handler.id === handlerId);
      if (!next || next.id === selectedMachineHandler.id) return;
      updateNode(projectNode.id, {
        machineHandlerId: next.id,
        overclockTier: next.minimumTier,
        ...(energyHatchTypeExistsAtTier(projectNode.energyHatchType, next.minimumTier)
          ? undefined
          : { energyHatchType: undefined }),
        ...carryMachineVoltage(
          { recipe: derived.nodeRecipe, node: projectNode },
          { recipe: derived.nodeRecipe, machineHandlerId: next.id },
        ),
      });
    },
    cycleMachine: (direction) => {
      if (isLocked() || machineHandlers.length <= 1) return;
      const ordered = orderMachineHandlers(machineHandlers);
      const index = Math.max(
        0,
        ordered.findIndex((handler) => handler.id === selectedMachineHandler.id),
      );
      const next = ordered[(index + direction + ordered.length) % ordered.length];
      if (next) actions.switchMachine(next.id);
    },
    ...pinActions(projectNode, count, updateNode, isLocked),
    stepSetting: (id, direction) => {
      if (isLocked()) return;
      const control: MachineConfigTierControl | undefined =
        id === "heatingCoil"
          ? derived.coilControl
          : derived.controls.find((entry) => entry.id === id);
      if (!control || control.tiers.length <= 1) return;
      const index = control.tiers.findIndex(
        (tier: MachineConfigTierOption) => tier.key === control.current.key,
      );
      const next = control.tiers[(index + direction + control.tiers.length) % control.tiers.length];
      if (!next) return;
      if (id === "heatingCoil") {
        updateNode(projectNode.id, { coilTier: next.key });
      } else {
        updateNode(projectNode.id, {
          machineConfigTiers: { ...(projectNode.machineConfigTiers ?? {}), [id]: next.key },
        });
      }
    },
  };

  const context: CleanCardContext = {
    machineHandlers,
    selectedMachineHandler,
    machineIcon,
    settings,
    handleIds: [
      ...inputs.filter((p) => !p.port.free).map((p) => p.handleId),
      ...outputs.map((p) => p.handleId),
    ],
  };

  return { view, actions, context };
}

export type { RailPort };

"use client";

import { useMemo } from "react";
import type { FactoryNode, Recipe } from "@/lib/model/types";
import {
  applyMachineHandlerToRecipe,
  applyRecipeInputOverrides,
  formatCompact,
  formatPowerValue,
  getSelectedMachineHandler,
  isSteamMachineHandler,
} from "@/lib/model";
import {
  powerDisplayFromEuT,
  powerDisplaySuffix,
  rateMultiplierForKind,
  rateSuffixForKind,
} from "@/lib/model/rate-unit";
import { getRecipeProgrammedCircuit } from "@/lib/model/programmed-circuit";
import {
  getCustomRateDial,
  getCustomRateSlot,
  isCustomRateRecipe,
  CUSTOM_RATE_ANY_RESOURCE_ID,
} from "@/lib/model/custom-rate";
import { getFluidTankSlot, FLUID_TANK_NAME } from "@/lib/model/fluid-tank";
import {
  CROP_FARM_PLACEHOLDER_RECIPE_ID,
  CROP_HARVESTER_INDUSTRIAL_FARM_ID,
  CROP_MANAGER_TIER_CONTROL_ID,
  CROP_SEED_BED_TIER_CONTROL_ID,
  cropsNhEnvironmentFromTiers,
  cropsNhFarmEut,
  cropsNhHarvestTicks,
  cropsNhHarvesterFromTiers,
  cropsNhCropsPerMachine,
  cropsNhHarvesterMachineCount,
  cropsNhIsHandPicked,
  cropsNhManagerLayers,
  cropsNhSquarePerTier,
  cropsNhManagerEuPerHarvest,
  getCropsNhStats,
  getRecipeMachineConfigTierControls,
  isCropFarmRecipe,
  isCropProductionRecipe,
} from "@/lib/model";
import {
  getSharedMachineHandlers,
  listNodeSections,
  sectionNodeId,
  sectionHandleId,
} from "@/lib/model/shared-machine";
import { applyMachineOutputMultipliers } from "@/lib/solver/machine-effects";
import { getOverclockedRecipeStats } from "@/lib/solver/overclock";
import { getNodePowerReport, getNodeSteamReport, hasPowerReport } from "@/lib/solver/power-report";
import { parsePortKey } from "@/lib/solver/plan/port-key";
import { getPowerSource } from "@/lib/power/registry";
import { getPowerStructureArt } from "@/lib/power/structure-art";
import { getPowerMachineIcon } from "@/lib/power/planner-data";
import { useFactoryStore } from "@/store/factory-store";
import { useWorkspaceView } from "@/lib/workspace-view";
import { buildRailPorts, deriveNodeVerdict } from "../../node-verdict";
import { makeResourceHandleId } from "../../resource-handles";
import { useRecipeMapIcons, type MachineHandlerIcon } from "../../machine-icons";
import type { RecipeNodeData } from "../../RecipeNode";
import {
  buildCountView,
  buildFootView,
  buildPortView,
  cardCountState,
  cardNameIn,
  formatSolvedMachines,
  layoutStrip,
  pinActions,
  useCleanCardModel,
  withReasonPorts,
  type CleanCardContext,
  type CleanCardActions,
  type CleanCardView,
  type CleanCountView,
} from "../clean-model";
import type { PlanUpTo } from "@/lib/solver/plan/types";
import { glanceBar } from "../glance";
import { CC_GEOMETRY } from "../tokens";
import { measureText } from "../text-measure";
import {
  isTierSelect,
  powerSettingRows,
  powerStripRows,
  powerTierChip,
  steppedPowerValue,
  type PowerSettingRow,
} from "./power-settings";
import {
  sectionShare,
  type SpecialChip,
  type SpecialSection,
  type SpecialView,
} from "./special-model";
import type { SheetRow } from "./SpecialSheets";
import { CROP_MACHINES_ID, pinMachineKey, type NumberSetting } from "../menus/settings-model";

/** What a special card does beyond the plain card's actions. */
export interface SpecialActions extends CleanCardActions {
  stepChip: (id: string, direction: -1 | 1) => void;
  moveSection: (section: number, direction: -1 | 1) => void;
  removeSection: (section: number) => void;
}

/** The menus' inputs: the gear's rows, and the readings a generator keeps in it. */
export interface SpecialContext extends CleanCardContext {
  readings: Array<{ label: string; value: string }>;
  /** The gear's sheet: the machine's own settings (shared machines, crops), or rows of the card's own. */
  sheet: { kind: "machine"; numbers?: NumberSetting[] } | { kind: "rows"; rows: SheetRow[]; foot?: string };
}

export interface SpecialModel {
  view: SpecialView;
  actions: SpecialActions;
  context: SpecialContext;
}

function isLocked(): boolean {
  const s = useFactoryStore.getState();
  return s.isReadOnly || s.checklistMode;
}

/** The name's size: 14, 13, 12, then 9, to fit what the head leaves it. */
export function fitNameSize(name: string, opts: { chips: number; picker: boolean }): number {
  const G = CC_GEOMETRY;
  const chipsLeft = G.cardWidth - 8 - opts.chips * G.chipWidth - Math.max(0, opts.chips - 1) * 2;
  const room = Math.max(40, chipsLeft - 8 - 68 - (opts.picker ? 15 : 0));
  return [14, 13, 12].find((size) => measureText(name, size, 500) <= room) ?? 9;
}

/**
 * A special card's count (docs/up-to.md): what runs (an Up to card's reached count, from the card's id) and what is
 * set, with whether nothing in the plan ties it to a number (the plan's `unanchored` and `unneeded`) and the card's
 * Up to read-out. A custom rate card's rule is always Exactly.
 */
export function countView(
  node: Pick<FactoryNode, "id" | "solvePin" | "solvePinExact">,
  needed: number,
  plan: Parameters<typeof cardCountState>[2],
  opts?: {
    noTimes?: boolean;
    title?: string;
    unit?: string;
    recipe?: Pick<Recipe, "machineType">;
  },
): { count: CleanCountView; unset: boolean; upTo?: PlanUpTo } {
  const state = cardCountState(undefined, node, plan, opts?.recipe, needed);
  const count = buildCountView(state, {
    noTimes: opts?.noTimes,
    title: opts?.title,
    unit: opts?.unit,
    ruleFixed: isCustomRateRecipe(opts?.recipe),
  });
  return { count, unset: state.unset, upTo: state.upTo };
}

/** The machine item the plain card draws when its machine has no render of its own. */
function iconOf(context: CleanCardContext): SpecialView["icon"] {
  const icon = context.machineIcon;
  if (!icon || !(icon.iconPath || icon.iconAtlas)) return undefined;
  return {
    id: icon.id,
    displayName: icon.displayName ?? icon.id,
    iconPath: icon.iconPath,
    iconAtlas: icon.iconAtlas,
    dominantColor: icon.dominantColor,
  };
}

function section0(base: { view: CleanCardView }): SpecialSection {
  return { section: 0, inputs: base.view.inputs, outputs: base.view.outputs };
}

// ---------------------------------------------------------------- shared machine

/**
 * A card running several recipes on one machine. Section 0 is the plain card's own view; every other section reads
 * its own solve node (`card#rN`), its ports wearing the section's prefix, and the wires that land on them follow.
 */
export function useSharedCardModel(data: RecipeNodeData, selected: boolean): SpecialModel {
  const base = useCleanCardModel(data, selected);
  const { projectNode, recipe, result } = data;
  const averageDraw = useWorkspaceView().averageMachineDraw;
  const liveRecipes = useFactoryStore((state) => state.project.recipes);
  const updateNode = useFactoryStore((state) => state.updateNode);
  const removeRecipeSection = useFactoryStore((state) => state.removeRecipeSection);
  const moveRecipeSection = useFactoryStore((state) => state.moveRecipeSection);
  const { project: liveProject, lastResult } = useFactoryStore.getState();
  const plan = lastResult?.plan;

  const extras = useMemo(
    () =>
      listNodeSections(projectNode)
        .slice(1)
        .map(({ section, node }) => {
          const sectionRecipe = liveRecipes.find((entry) => entry.id === node.recipeId);
          if (!sectionRecipe) return undefined;
          const nodeRecipe = applyRecipeInputOverrides(sectionRecipe, node);
          const effective = applyMachineHandlerToRecipe(nodeRecipe, node);
          const stats = getOverclockedRecipeStats(nodeRecipe, node);
          const adjusted = applyMachineOutputMultipliers(effective, node, stats.tier);
          return {
            section,
            node,
            display: { ...effective, ...adjusted, ...stats } as Recipe,
            ...sectionPower(sectionRecipe, node),
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined),
    [liveRecipes, projectNode],
  );

  // The forced entries of every section (spills into buffers among them), filed under the card and the section's
  // prefixed handle.
  const forcedAt = new Map<string, number>();
  const spillAt = new Map<string, string>();
  for (const entry of [...(plan?.forced ?? []), ...(plan?.spills ?? [])]) {
    const parsed = parsePortKey(entry.portKey);
    if (!parsed) continue;
    const owner = entry.nodeId.split("#r")[0]!;
    if (owner !== projectNode.id) continue;
    const at = entry.nodeId.indexOf("#r");
    const section = at < 0 ? 0 : Number(entry.nodeId.slice(at + 2));
    const key = `${projectNode.id}|${parsed.side}|${sectionHandleId(section, parsed.handle)}`;
    forcedAt.set(key, (forcedAt.get(key) ?? 0) + entry.perSecond);
    if ("drawerId" in entry) spillAt.set(key, entry.drawerId);
  }

  const sections: SpecialSection[] = [section0(base)];
  const machinesBySection: number[] = [result?.theoreticalMachinesRequired ?? 0];
  const usageBySection: number[] = [Math.min(1, result?.utilization ?? 0)];
  const circuits = [
    base.view.circuit,
    ...extras.map((entry) => getRecipeProgrammedCircuit(entry.display)),
  ];
  for (const entry of extras) {
    const id = sectionNodeId(projectNode.id, entry.section);
    const verdict = deriveNodeVerdict(liveProject, lastResult, id);
    const rails = buildRailPorts(liveProject, lastResult, id, entry.display, verdict, {
      handleSection: entry.section,
    });
    const sectionResult = lastResult?.nodes[id];
    machinesBySection.push(sectionResult?.theoreticalMachinesRequired ?? 0);
    usageBySection.push(Math.min(1, sectionResult?.utilization ?? 0));
    sections.push({
      section: entry.section,
      inputs: rails.inputs.map((port) =>
        buildPortView(projectNode.id, port, projectNode, forcedAt, spillAt),
      ),
      outputs: rails.outputs.map((port) =>
        buildPortView(projectNode.id, port, projectNode, forcedAt, spillAt),
      ),
    });
  }
  // Section 0's forced rows were keyed for the plain card; re-key the ones filed under the section prefix.
  const total = machinesBySection.reduce((sum, n) => sum + n, 0);
  const last = sections.length - 1;
  for (const entry of sections) {
    const share = sectionShare(machinesBySection[entry.section] ?? 0, total);
    entry.rule = {
      section: entry.section,
      pct: share.pct,
      word: share.unused
        ? "UNUSED"
        : `×${formatSolvedMachines(machinesBySection[entry.section] ?? 0)}`,
      unused: share.unused,
      circuit: circuits[entry.section],
      canUp: entry.section > 0,
      canDown: entry.section < last,
    };
  }

  // The card's one power row.
  const own = sectionPower(recipe, projectNode);
  const parts = [own, ...extras];
  // As the plain card bills it: each recipe's draw at the machines the solve gives it, by its use (all of it in peak
  // mode while it runs at all).
  const scaleOf = (i: number) =>
    averageDraw ? (usageBySection[i] ?? 0) : (usageBySection[i] ?? 0) > 0 ? 1 : 0;
  const drawOf = (i: number) => parts[i]?.powerReport?.drawEuT ?? 0;
  const euT = machinesBySection.reduce((sum, n, i) => sum + drawOf(i) * n * scaleOf(i), 0);
  const stalled = parts.some(
    (part) => part.powerReport !== undefined && part.powerReport.state !== "ok",
  );
  const litresOf = (i: number) =>
    parts[i]?.steamReport ? parts[i]!.steamReport!.drawSteamPerTick * 20 : 0;
  const litres = machinesBySection.reduce((sum, n, i) => sum + litresOf(i) * n * scaleOf(i), 0);
  const anyEu = parts.some((part) => part.powerReport);
  const anySteam = !anyEu && parts.some((part) => part.steamReport);
  // Amps count in the sections' tier when they all run at one.
  const sectionTiers = new Set(
    parts.filter((part) => part.powerReport).map((part) => part.powerReport!.tier),
  );
  const ownTier = sectionTiers.size === 1 ? [...sectionTiers][0] : undefined;
  const power: SpecialView["power"] = anyEu
    ? {
        number: stalled ? "TIER!" : formatPowerValue(powerDisplayFromEuT(euT, ownTier)),
        unit: stalled ? "" : powerDisplaySuffix(ownTier),
        name: "Power",
        stalled,
        title: stalled
          ? "A recipe on this machine is above its tier."
          : "What the card's machines draw, every recipe at the machines it needs.",
      }
    : anySteam
      ? {
          number: formatCompact(litres),
          unit: "L/s",
          name: "Steam",
          stalled: false,
          title: "Steam this machine burns",
        }
      : undefined;

  // The card's count and bar are its whole pool's, under the card's id; the bar reads every recipe's rows.
  const needed = machinesBySection.reduce((sum, n) => sum + n, 0);
  const { count, unset, upTo } = countView(projectNode, needed, plan);
  // The rows its reason names, on every recipe (section 0's are the plain card's, lit already).
  for (const entry of sections) {
    entry.inputs = withReasonPorts(entry.inputs, upTo);
    entry.outputs = withReasonPorts(entry.outputs, upTo);
  }
  const foot = buildFootView(
    count,
    upTo,
    {
      inputs: sections.flatMap((entry) => entry.inputs),
      outputs: sections.flatMap((entry) => entry.outputs),
    },
    (id) => cardNameIn(liveProject, id),
    base.view.loop,
  );
  const handlers = useMemo(
    () =>
      getSharedMachineHandlers(projectNode, (id) =>
        id === recipe.id ? recipe : liveRecipes.find((entry) => entry.id === id),
      ),
    [liveRecipes, projectNode, recipe],
  );
  const hasPicker = handlers.length > 1;
  const name = base.view.name;
  const nameSize = fitNameSize(name, {
    chips: (base.view.tier ? 1 : 0) + (base.view.amps ? 1 : 0),
    picker: hasPicker,
  });

  const view: SpecialView = {
    kind: "shared",
    nodeId: projectNode.id,
    name,
    nameSize,
    nameTone: "ink",
    hasPicker,
    tier: base.view.tier,
    amps: base.view.amps,
    sections,
    power,
    art: base.view.art,
    glanceArt: base.view.glanceArt,
    icon: iconOf(base.context),
    count,
    foot,
    loop: base.view.loop,
    glance: glanceBar(upTo, base.view.loop),
    chips: base.view.chips,
    stripHeight: base.view.stripHeight,
    warnings: [],
    selected,
    cannotRun: base.view.cannotRun,
    unset,
    handleIds: sections.flatMap((entry) => [
      ...entry.inputs.filter((p) => !p.port.free).map((p) => p.handleId),
      ...entry.outputs.map((p) => p.handleId),
    ]),
  };

  const actions: SpecialActions = {
    ...base.actions,
    stepChip: base.actions.stepSetting,
    moveSection: (section, direction) => {
      if (!isLocked()) moveRecipeSection(projectNode.id, section, direction);
    },
    removeSection: (section) => {
      if (!isLocked()) removeRecipeSection(projectNode.id, section);
    },
    // From Any, the wheel and the rule menu start at what all its recipes run together.
    ...pinActions(projectNode, count, updateNode, isLocked),
  };
  const context: SpecialContext = {
    ...base.context,
    machineHandlers: handlers,
    handleIds: view.handleIds,
    readings: [],
    sheet: { kind: "machine" },
  };
  return { view, actions, context };
}

/** One recipe's power or steam report at its node's settings. */
function sectionPower(recipe: Recipe, node: FactoryNode) {
  const nodeRecipe = applyRecipeInputOverrides(recipe, node);
  const effective = applyMachineHandlerToRecipe(nodeRecipe, node);
  const drawsEu =
    effective.eut > 0 && !isSteamMachineHandler(getSelectedMachineHandler(recipe, node));
  return {
    powerReport:
      drawsEu && hasPowerReport(nodeRecipe) ? getNodePowerReport(nodeRecipe, node) : undefined,
    steamReport: !drawsEu ? getNodeSteamReport(nodeRecipe, node) : undefined,
  };
}

// ---------------------------------------------------------------- generator

export function usePowerCardModel(data: RecipeNodeData, selected: boolean): SpecialModel {
  const base = useCleanCardModel(data, selected);
  const { projectNode, recipe } = data;
  const info = recipe.power!;
  const source = getPowerSource(info.sourceId);
  const setPowerSetting = useFactoryStore((state) => state.setPowerSetting);
  const setSettingPins = useFactoryStore((state) => state.setSettingPins);
  // The pins are the plan's, kept per source as a machine's are: a generator shows none until one is pinned.
  const pinKey = `power:${info.sourceId}`;
  const pins = useFactoryStore((state) => state.project.settingPins?.[pinKey]);
  const values = projectNode.machineConfigTiers;

  const rows: PowerSettingRow[] = source ? powerSettingRows(source, values) : [];
  const tier = source ? powerTierChip(source, values) : undefined;
  const stripRows = powerStripRows(rows, pins ?? []);
  const strip = layoutStrip(
    stripRows.map((row) => ({
      id: row.id,
      label: row.label,
      value: row.value,
      title: `${row.label}: ${row.value}`,
    })),
  );
  const chips: SpecialChip[] = strip.chips.map((chip) => {
    const row = stripRows.find((entry) => entry.id === chip.id)!;
    return row.setting.type === "number"
      ? {
          ...chip,
          edit: { text: row.value.split(" ")[0]!, commit: (text) => commitNumber(row, text) },
        }
      : chip;
  });
  const commitNumber = (row: PowerSettingRow, text: string) => {
    if (isLocked() || row.setting.type !== "number") return;
    const parsed = Number(text.replace(/,/g, "").trim());
    if (!Number.isFinite(parsed)) return;
    const value = Math.min(row.setting.max, Math.max(row.setting.min, parsed));
    setPowerSetting(projectNode.id, row.id, String(value));
  };

  const name = recipe.machineType || base.view.name;
  const icon = getPowerMachineIcon(info.sourceId);
  const art = getPowerStructureArt(info.sourceId);
  const needed = data.result?.theoreticalMachinesRequired ?? 0;
  const plan = useFactoryStore.getState().lastResult?.plan;
  const { count, unset } = countView(projectNode, needed, plan);
  const draws = info.euPerTick < 0;
  void draws;

  const view: SpecialView = {
    kind: "power",
    nodeId: projectNode.id,
    name,
    nameSize: fitNameSize(name, { chips: tier ? 1 : 0, picker: false }),
    nameTone: "power",
    hasPicker: false,
    tier: tier
      ? {
          label: tier.label,
          fixed: tier.fixed,
          title: tier.fixed
            ? `Unlocks at ${tier.label}`
            : `Tier ${tier.label}. Click up, right click down.`,
        }
      : undefined,
    sections: [section0(base)],
    art,
    glanceArt: art ?? icon?.iconPath,
    icon: icon
      ? {
          id: icon.id,
          displayName: icon.displayName ?? icon.id,
          iconPath: icon.iconPath,
          dominantColor: icon.dominantColor,
        }
      : undefined,
    count,
    // The generator's rows and count are the plain card's: so is its bar.
    foot: base.view.foot,
    loop: base.view.loop,
    glance: base.view.glance,
    chips,
    stripHeight: strip.height,
    warnings: info.warnings ?? [],
    selected,
    cannotRun: false,
    unset,
    handleIds: base.context.handleIds,
  };

  const actions: SpecialActions = {
    ...base.actions,
    stepTier: (direction) => {
      if (isLocked() || !source || !tier || tier.fixed) return;
      const row = rows.find((entry) => isTierSelect(entry.setting));
      const next = row ? steppedPowerValue(row, direction) : undefined;
      if (next !== undefined) setPowerSetting(projectNode.id, "tier", next);
    },
    stepChip: (id, direction) => {
      const row = rows.find((entry) => entry.id === id);
      if (isLocked() || !row || !row.enabled) return;
      const next = steppedPowerValue(row, direction);
      if (next !== undefined) setPowerSetting(projectNode.id, id, next);
    },
    stepSetting: (id, direction) => actions.stepChip(id, direction),
    moveSection: () => undefined,
    removeSection: () => undefined,
  };
  const context: SpecialContext = {
    ...base.context,
    machineHandlers: [],
    settings: [],
    readings: info.stats,
    sheet: {
      kind: "rows",
      foot: "Pinned settings show on the card. Click, right-click or scroll to change.",
      rows: rows.map(
        (row): SheetRow => ({
          id: row.id,
          label: row.label,
          value: row.value,
          options: row.setting.type === "select" ? row.setting.options : undefined,
          currentKey: row.key,
          number:
            row.setting.type === "number"
              ? { text: row.value.split(" ")[0]!, commit: (text) => commitNumber(row, text) }
              : undefined,
          flip: row.setting.type === "toggle" ? () => actions.stepChip(row.id, 1) : undefined,
          enabled: row.enabled,
          pinned: (pins ?? []).includes(row.id),
          onPin: isTierSelect(row.setting)
            ? undefined
            : () => {
                const now = pins ?? [];
                setSettingPins(
                  pinKey,
                  now.includes(row.id) ? now.filter((id) => id !== row.id) : [...now, row.id],
                );
              },
          onPick: (key) => setPowerSetting(projectNode.id, row.id, key),
          onStep: (direction) => actions.stepChip(row.id, direction),
        }),
      ),
    },
  };
  return { view, actions, context };
}

// ---------------------------------------------------------------- crops

/**
 * A crop card: the plain card with a crop's own parts. Its count is crops planted (no times sign, a line saying
 * so), its harvester's voltage is the tier chip, its draw is a power row, and a farm picks its crop from a key in
 * the head (a dashed box in place of the rails until it has one).
 */
export function useCropCardModel(data: RecipeNodeData, selected: boolean): SpecialModel {
  const base = useCleanCardModel(data, selected);
  const { projectNode, recipe, result } = data;
  const averageDraw = useWorkspaceView().averageMachineDraw;
  const updateNode = useFactoryStore((state) => state.updateNode);
  const plan = useFactoryStore.getState().lastResult?.plan;

  const farm = isCropFarmRecipe(recipe);
  const placeholder =
    recipe.id === CROP_FARM_PLACEHOLDER_RECIPE_ID || (farm && recipe.outputs.length === 0);
  const effective = useMemo(
    () => applyMachineHandlerToRecipe(applyRecipeInputOverrides(recipe, projectNode), projectNode),
    [recipe, projectNode],
  );
  const controls = useMemo(
    () => getRecipeMachineConfigTierControls(effective, projectNode),
    [effective, projectNode],
  );
  const tierControl = controls.find(
    (control) =>
      control.id === CROP_MANAGER_TIER_CONTROL_ID || control.id === CROP_SEED_BED_TIER_CONTROL_ID,
  );

  const needed = result?.theoreticalMachinesRequired ?? 0;
  const crops = Math.max(0, Math.round(needed));
  // The count is seeds planted, never machines: no times sign, the word on the number's line, and a tip that says so.
  const { count, unset: countUnset } = countView(projectNode, needed, plan, {
    noTimes: true,
    unit: crops === 1 ? "seed" : "seeds",
  });
  if (!count.pinned) count.title = "How many seeds the plan plants. Machines follow from the seeds.";

  const stats = getCropsNhStats(effective);
  const setup =
    isCropProductionRecipe(effective) && !placeholder
      ? cropsNhHarvesterFromTiers(
          projectNode.machineConfigTiers,
          projectNode.machineHandlerId,
          stats?.minSeedBedTier,
          stats?.subSoil !== undefined,
        )
      : undefined;

  // The machines the seeds fill, from what one machine of this tier holds: a seed bed's square, or a Crop Manager's
  // reach planted full. A setting pinned until unpinned: typed or stepped, it plants that many full machines of seeds.
  const capacity = setup && !cropsNhIsHandPicked(setup) ? cropsNhCropsPerMachine(setup) : 0;
  const pinKey = pinMachineKey(recipe, projectNode);
  const pins = useFactoryStore((state) => state.project.settingPins?.[pinKey]);
  const machines: NumberSetting | undefined = (() => {
    if (!setup || capacity <= 0) return undefined;
    const farmSetup = setup.id === CROP_HARVESTER_INDUSTRIAL_FARM_ID;
    const value = cropsNhHarvesterMachineCount(setup, crops);
    const setMachines = (count: number) => {
      if (isLocked() || !(count >= 1)) return;
      base.actions.setCount(Math.round(count) * capacity);
    };
    return {
      id: CROP_MACHINES_ID,
      label: farmSetup ? "Industrial Farms" : "Crop Managers",
      value: value.toLocaleString(),
      text: String(value),
      pinDefault: true,
      commit: (text) => setMachines(Number(text.replace(/,/g, "").trim())),
      step: (direction) => setMachines(value + direction),
    };
  })();
  const machinesTip = (() => {
    if (!setup || !machines) return [];
    const tier = tierControl?.current.label ?? "";
    const side = Math.round(Math.sqrt(cropsNhSquarePerTier(setup.tierIndex)));
    return [
      setup.id === CROP_HARVESTER_INDUSTRIAL_FARM_ID
        ? `One ${tier} seed bed holds ${capacity.toLocaleString()} seeds.`
        : `One ${tier} Crop Manager reaches ${side} x ${side}, ${cropsNhManagerLayers(setup.subSoil)} layers deep: ` +
          `${capacity.toLocaleString()} crop sticks with every block planted.`,
      "Set a number to plant that many full machines.",
    ];
  })();
  const machinesPinned = machines !== undefined && (pins === undefined ? machines.pinDefault : pins.includes(machines.id));
  const strip = machinesPinned
    ? layoutStrip([
        { id: machines!.id, label: machines!.label, value: machines!.value, title: machines!.label },
        ...base.view.chips,
      ])
    : { chips: base.view.chips, height: base.view.stripHeight };
  const chips: SpecialChip[] = strip.chips.map((chip) =>
    chip.id === CROP_MACHINES_ID && machines
      ? { ...chip, edit: { text: machines.text, commit: machines.commit, notes: machinesTip } }
      : chip,
  );

  // The harvester's draw: the Industrial Farm burns whole farms, the Crop Manager spends per harvest. Zero by hand.
  const drawEuT = (() => {
    if (!setup) return 0;
    if (cropsNhIsHandPicked(setup)) return 0;
    if (setup.id === CROP_HARVESTER_INDUSTRIAL_FARM_ID) {
      return cropsNhFarmEut(setup) * cropsNhHarvesterMachineCount(setup, crops);
    }
    if (!stats) return 0;
    const ticks = cropsNhHarvestTicks(
      stats,
      cropsNhEnvironmentFromTiers(projectNode.machineConfigTiers),
    );
    return Number.isFinite(ticks) && ticks > 0
      ? (cropsNhManagerEuPerHarvest(setup) * crops) / ticks
      : 0;
  })();
  const usage = Math.min(1, Math.max(0, result?.utilization ?? 1));
  const drawScale = averageDraw ? usage : usage > 0 ? 1 : 0;
  const power: SpecialView["power"] =
    drawEuT > 0
      ? {
          number: formatPowerValue(powerDisplayFromEuT(drawEuT * drawScale)),
          unit: powerDisplaySuffix(),
          name: "Power",
          stalled: false,
          title: "What the harvester draws.",
        }
      : undefined;

  const tierIndex = tierControl
    ? Math.max(
        0,
        tierControl.tiers.findIndex((tier) => tier.key === tierControl.current.key),
      )
    : 0;
  const stepTier = (direction: -1 | 1) => {
    if (isLocked() || !tierControl) return;
    const next =
      tierControl.tiers[Math.max(0, Math.min(tierControl.tiers.length - 1, tierIndex + direction))];
    if (next && next.key !== tierControl.current.key) {
      updateNode(projectNode.id, {
        machineConfigTiers: {
          ...(projectNode.machineConfigTiers ?? {}),
          [tierControl.id]: next.key,
        },
      });
    }
  };

  const name = placeholder ? "Pick a crop..." : base.view.name;
  const hasPicker = base.view.hasPicker && !placeholder;
  const view: SpecialView = {
    kind: "crop",
    nodeId: projectNode.id,
    name,
    nameSize: fitNameSize(name, { chips: tierControl ? 1 : 0, picker: hasPicker }),
    nameTone: "ink",
    hasPicker,
    tier: tierControl
      ? {
          label: tierControl.current.label,
          fixed: false,
          title:
            tierControl.label + ": " + tierControl.current.label + ". Click up, right click down.",
        }
      : undefined,
    sections: placeholder ? [{ section: 0, inputs: [], outputs: [] }] : [section0(base)],
    power,
    pick: placeholder,
    cropKey: farm && !placeholder,
    art: base.view.art,
    glanceArt: base.view.glanceArt,
    icon: iconOf(base.context),
    count: placeholder ? undefined : count,
    foot: placeholder ? undefined : base.view.foot,
    loop: base.view.loop,
    glance: base.view.glance,
    chips: placeholder ? [] : chips,
    stripHeight: placeholder ? 0 : strip.height,
    warnings: [],
    selected,
    cannotRun: false,
    unset: placeholder ? false : countUnset,
    handleIds: placeholder ? [] : base.context.handleIds,
  };
  const context: SpecialContext = {
    ...base.context,
    readings: [],
    sheet: { kind: "machine", numbers: machines ? [machines] : undefined },
  };
  const actions: SpecialActions = {
    ...base.actions,
    stepTier,
    stepChip: (id, direction) =>
      id === CROP_MACHINES_ID ? machines?.step(direction) : base.actions.stepSetting(id, direction),
    moveSection: () => undefined,
    removeSection: () => undefined,
  };
  return { view, actions, context };
}

// ---------------------------------------------------------------- holders

export function useHolderCardModel(
  data: RecipeNodeData,
  selected: boolean,
  kind: "custom-rate" | "tank",
): SpecialModel {
  const base = useCleanCardModel(data, selected);
  const { projectNode, recipe } = data;
  const setCustomRateConfig = useFactoryStore((state) => state.setCustomRateConfig);
  useFactoryStore((state) => state.rateUnit);
  const mapIcons = useRecipeMapIcons();

  const slot = kind === "custom-rate" ? getCustomRateSlot(recipe) : getFluidTankSlot(recipe);
  const empty = !slot;
  const plan = useFactoryStore.getState().lastResult?.plan;
  const needed = data.result?.theoreticalMachinesRequired ?? 0;
  // A fluid tank has no count rule at all; a custom rate card's is always Exactly (its dial).
  const counted = kind === "tank" ? undefined : countView(projectNode, needed, plan, { recipe });
  const count = counted?.count;

  const name = kind === "tank" ? FLUID_TANK_NAME : "Custom Rate";
  const sockets: SpecialView["sockets"] = empty
    ? {
        take: kind === "tank" ? "TAKE CELL/FLUID" : "DRAIN ANY",
        give: kind === "tank" ? "GIVE CELL/FLUID" : "SUPPLY ANY",
        takeHandle: makeResourceHandleId("input", {
          kind: "item",
          id: CUSTOM_RATE_ANY_RESOURCE_ID,
        }),
        giveHandle: makeResourceHandleId("output", {
          kind: "item",
          id: CUSTOM_RATE_ANY_RESOURCE_ID,
        }),
      }
    : undefined;

  // The custom rate's dial: mode and rate, on chips like every other setting.
  const chips: SpecialChip[] = [];
  let stripHeight = 0;
  if (kind === "custom-rate") {
    const dial = getCustomRateDial(projectNode, recipe);
    const factKind = (getCustomRateSlot(recipe)?.resource.kind ?? "item") as string;
    const multiplier = rateMultiplierForKind(factKind);
    const step = 1000 / Math.min(multiplier, 1);
    const shown = String(Math.round(dial.perSecond * multiplier * step) / step);
    const laid = layoutStrip([
      {
        id: "mode",
        label: "Mode",
        value: dial.mode === "supply" ? "Supply" : "Request",
        title: "Which way the card faces.",
      },
      {
        id: "rate",
        label: `Rate (${rateSuffixForKind(factKind).trim() || "/s"})`,
        value: shown,
        title: "The rate it holds.",
      },
    ]);
    stripHeight = laid.height;
    for (const chip of laid.chips) {
      chips.push(
        chip.id === "rate"
          ? {
              ...chip,
              edit: {
                text: shown,
                commit: (text) => {
                  if (isLocked()) return;
                  const parsed = Number.parseFloat(text.replace(/,/g, "").trim());
                  if (Number.isFinite(parsed) && parsed >= 0)
                    setCustomRateConfig(projectNode.id, { perSecond: parsed / multiplier });
                },
              },
            }
          : chip,
      );
    }
  }

  const iconKey = kind === "tank" ? "Tank" : undefined;
  const mapIcon = iconKey ? (mapIcons.get(iconKey) as MachineHandlerIcon | undefined) : undefined;
  const sections: SpecialSection[] = empty
    ? [{ section: 0, inputs: [], outputs: [] }]
    : [section0(base)];

  const view: SpecialView = {
    kind,
    nodeId: projectNode.id,
    name,
    nameSize: fitNameSize(name, { chips: 0, picker: false }),
    nameTone: "holder",
    hasPicker: false,
    sections,
    sockets,
    glyph: kind === "custom-rate" ? "gauge" : undefined,
    icon: mapIcon
      ? {
          id: mapIcon.id,
          displayName: mapIcon.displayName ?? FLUID_TANK_NAME,
          iconPath: mapIcon.iconPath,
          dominantColor: mapIcon.dominantColor,
        }
      : undefined,
    glanceArt: mapIcon?.iconPath,
    count,
    // An Exactly custom rate card fed by a forced input says so, as any Exactly card does.
    foot: count && !empty ? base.view.foot : undefined,
    loop: base.view.loop,
    glance: base.view.glance,
    chips,
    stripHeight,
    warnings: [],
    selected,
    cannotRun: false,
    unset: counted?.unset ?? false,
    handleIds: empty ? [sockets!.takeHandle, sockets!.giveHandle] : base.context.handleIds,
  };

  const actions: SpecialActions = {
    ...base.actions,
    stepChip: (id, direction) => {
      if (isLocked()) return;
      if (id === "mode" && kind === "custom-rate") {
        const dial = getCustomRateDial(projectNode, recipe);
        setCustomRateConfig(projectNode.id, {
          mode: dial.mode === "supply" ? "request" : "supply",
        });
        void direction;
      }
    },
    moveSection: () => undefined,
    removeSection: () => undefined,
  };
  const dial = kind === "custom-rate" ? getCustomRateDial(projectNode, recipe) : undefined;
  const dialRate = chips.find((chip) => chip.id === "rate")?.edit;
  const context: SpecialContext = {
    ...base.context,
    machineHandlers: [],
    settings: [],
    readings: [],
    sheet: {
      kind: "rows",
      rows: dial
        ? [
            {
              id: "mode",
              label: "Mode",
              value: dial.mode === "supply" ? "Supply" : "Request",
              options: [
                { key: "supply", label: "Supply" },
                { key: "request", label: "Request" },
              ],
              currentKey: dial.mode,
              flip: () => actions.stepChip("mode", 1),
              enabled: true,
              onPick: (key) => {
                if (key !== dial.mode && !isLocked())
                  setCustomRateConfig(projectNode.id, { mode: key as "supply" | "request" });
              },
              onStep: () => actions.stepChip("mode", 1),
            },
            {
              id: "rate",
              label: "Rate",
              value: dialRate?.text ?? "1",
              number: dialRate,
              enabled: true,
              onStep: () => undefined,
            },
          ]
        : [],
    },
  };
  return { view, actions, context };
}

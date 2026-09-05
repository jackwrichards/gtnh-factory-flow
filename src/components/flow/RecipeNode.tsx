"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  Copy,
  Cpu,
  Image as ImageIcon,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  Sprout,
  Zap,
} from "lucide-react";
import type {
  FactoryNode,
  MachineConfigTierOption,
  MachineTier,
  NodeThroughputResult,
  Recipe,
  ResourceAmount,
} from "@/lib/model/types";
import { getOverclockedRecipeStats } from "@/lib/solver/overclock";
import {
  describePowerStall,
  getNodePowerReport,
  getNodeSteamReport,
  hasPowerReport,
  type NodePowerReport,
  type NodeSteamReport,
} from "@/lib/solver/power-report";
import { isMultiblockRecipe } from "@/lib/solver/power";
import {
  energyHatchTypeExistsAtTier,
  getEnergyHatchType,
  STANDARD_ENERGY_HATCH_ID,
} from "@/lib/machines/energy-hatches";
import { energyHatchCatalogKey, useEnergyHatchCatalog } from "./use-energy-hatch-catalog";
import { EnergyHatchArt, energySupplyOptionsForTier } from "./EnergyHatchMenu";
import { prefersCuratedMachineMath } from "@/lib/solver/runtime-calculation";
import {
  applyMachineOutputMultipliers,
  getMachineParallelMultiplier,
} from "@/lib/solver/machine-effects";
import {
  formatCompact,
  formatCompactStable,
  formatRate,
  applyMachineHandlerToRecipe,
  GT_OVERCLOCK_TIERS,
  getRecipeMachineHandlers,
  getRecipeMachineConfigTierControls,
  getRecipeCoilTierControl,
  applyRecipeInputOverrides,
  getRecipePowerTier,
  getSelectedMachineHandler,
  getCropsNhStats,
  getVoltageTierIndex,
  BEE_INDUSTRIAL_PRODUCTION_CONTROL_ID,
  BEE_INDUSTRIAL_SPEED_CONTROL_ID,
  CROP_GAIN_STAT_CONTROL_ID,
  CROP_GROWTH_STAT_CONTROL_ID,
  CROP_HARVESTER_INDUSTRIAL_FARM_ID,
  CROP_IF_ENVIRONMENT_UNIT_CONTROL_ID,
  CROP_IF_FERTILIZER_UNIT_CONTROL_ID,
  CROP_IF_GROWTH_UNIT_CONTROL_ID,
  CROP_IF_HARVEST_UNIT_CONTROL_ID,
  CROP_IF_OVERCLOCK_CONTROL_ID,
  CROP_MANAGER_TIER_CONTROL_ID,
  CROP_SEED_BED_TIER_CONTROL_ID,
  cropsNhCropsPerMachine,
  cropsNhEnvironmentFromTiers,
  cropsNhExpectedDrop,
  cropsNhFarmEut,
  cropsNhGrowthRate,
  cropsNhGrowthSpeedMultiplier,
  cropsNhHarvestRoundMultiplier,
  cropsNhHarvestTicks,
  cropsNhHarvesterMachineCount,
  cropsNhNutrientScore,
  type CropsNhStats,
  cropsNhHarvesterEnvironment,
  cropsNhHarvesterFromTiers,
  cropsNhIsHandPicked,
  cropsNhManagerEuPerHarvest,
  cropsNhUnitSlotsUsed,
  cropsNhUpgradeSlots,
  isSteamMachineHandler,
  isBeeFrameSlotControlId,
  isBeeProductionConfigControl,
  isBeeProductionRecipe,
  isCropFarmRecipe,
  isCropProductionConfigControl,
  isCropProductionRecipe,
  isIndustrialApiaryMachineType,
  makeResourceKey,
  resourceMatchesInput,
  resourceLabel,
  type MachineConfigTierControl,
} from "@/lib/model";
import {
  CUSTOM_RATE_ANY_RESOURCE_ID,
  getCustomRateDial,
  getCustomRateSlot,
  isCustomRateRecipe,
  type CustomRateMode,
} from "@/lib/model/custom-rate";
import {
  powerDisplayFromEuT,
  powerDisplaySuffix,
  rateMultiplierForKind,
  rateSuffixForKind,
  rateUnitMultiplier,
  rateUnitPrecisionScale,
  rateUnitSuffix,
} from "@/lib/model/rate-unit";
import {
  getRecipeProgrammedCircuit,
  type RecipeProgrammedCircuit,
} from "@/lib/model/programmed-circuit";
import { BOARD_GRID, CONFIG_PANEL_ROW_HEIGHT, RECIPE_NODE_WIDTH } from "@/lib/board-grid";
import { CropPickerMenu } from "./CropPickerMenu";
import {
  MachineCompareTable,
  MachineIconTab,
  MachineTabStrip,
  machineArtPixels,
} from "./MachinePicker";
import { NodeGlanceText, glanceTileStyle } from "./NodeGlance";
import { isWiringConnection, wasRecentWireDrop } from "./connection-drag";
import { clearHoveredPortBrowse, setHoveredPortBrowse } from "./port-browse";
import {
  isFromBrowseMenu,
  useBrowseMenu,
  type BrowseMode as PortBrowseMode,
} from "@/components/browse-menu";
import { isEchoOfTouch } from "@/lib/pointer-kind";
import { useMachineHandlerIcons, type MachineHandlerIcon } from "./machine-icons";
import { publishDockTopInset } from "./dock-insets";
import { useRenderedHandles } from "./use-rendered-handles";
import { MinecraftSelect } from "./MinecraftSelect";
import { PowerConfigPanel } from "./PowerConfigPanel";
import { getPowerSource } from "@/lib/power/registry";
import { getPowerStructureArt } from "@/lib/power/structure-art";
import { getPowerMachineIcon, type PowerMachineIcon } from "@/lib/power/planner-data";
import type { PowerSelectSetting } from "@/lib/power/types";
import { MinecraftTooltip } from "@/components/nei/MinecraftTooltip";
import { useWorkspaceView } from "@/lib/workspace-view";
import { MachineStatsContent } from "./MachineStatsContent";
import {
  fluidArtPixels,
  isSwatchFluid,
  ResourceIcon,
  spriteArtPixels,
} from "@/components/nei/ResourceIcon";
import {
  canonicalizeResourceHandleId,
  makeResourceHandleId,
} from "./resource-handles";
import {
  buildRailPorts,
  deriveNodeVerdict,
  isSupplyShort,
  type NodeVerdict,
  type RailPort,
} from "./node-verdict";
import { describeDeathSpiral } from "./death-spiral";
import { describeClogLockForNode } from "./clog-lock";
import {
  edgeTouchesResource,
  explainPlug,
  explainPort,
  formatPct,
  formatPortRate,
  formatSlotRate,
  formatSlotRateBare,
  formatSlotRateOrNull,
  portReadsEnergy,
  ENERGY_READING_TEXT,
  formatEnergyPerUnitParts,
  ENERGY_UNIT_TEXT,
  formatTimes,
  type PortStory,
} from "./flow-explainers";
import { useFactoryStore, useRateDisplayUnits } from "@/store/factory-store";
import {
  GLANCE_NEUTRAL_SURFACE,
  GT_NODE_COLORS,
  glanceAccentFor,
  glanceCardVars,
  glanceSurfaceFor,
  heatmapColorFor,
  rampFor,
  type NodeSurfaceColor,
} from "./node-colors";
import { useBoardView } from "./board-view";
import { MotionNumberText, useBoardMotion, useMotionValues } from "./board-motion";
import { getPaintBrushCursor } from "./paint-cursor";
import { GT_TIER_COLORS } from "./tier-colors";
import { playBoardSound, suppressBoardSound } from "@/lib/board-sounds";

// Full width so the crop config panel and stat grid line up with the recipe
// canvas edge instead of forcing their own wider box.
const CROP_CONFIG_PANEL_WIDTH_CLASS = "w-full";

/**
 * Floor for one row of two passive-production knobs, in grid cells. A label
 * and its select measure a shade over two cells, and GridBlock rounds the
 * REAL content up past this, so two is a floor rather than a promise. The
 * shared CONFIG_PANEL_ROW_HEIGHT is three, which on these panels reserved an
 * empty cell per row and left the box padded top and bottom.
 */
const PASSIVE_PANEL_ROW_CELLS = 2;

// Module constants, not fresh arrays per render: these feed the handle-set
// key, and a new array every render would be extra work on the hottest card.
const EMPTY_HANDLE_IDS: readonly string[] = [];
const CUSTOM_RATE_UNIVERSAL_HANDLE_IDS: readonly string[] = [
  makeResourceHandleId("input", { kind: "item", id: CUSTOM_RATE_ANY_RESOURCE_ID }),
  makeResourceHandleId("output", { kind: "item", id: CUSTOM_RATE_ANY_RESOURCE_ID }),
];

/**
 * The power sector's card face: the window ground warmed toward amber - a
 * different material, with every element on it keeping its ordinary colours.
 * The face is the WHOLE mark (a chamfered-corner variant was tried and
 * dropped: the frame's flash and the selection ring could not be made to
 * traverse the cuts convincingly).
 */
const POWER_CARD_FACE = "color-mix(in srgb, var(--mc-78) 85%, #d99a2b 15%)";

/**
 * The crop sector's card face: the same trick in green - the crop card is a
 * different material the way a power card is, and every element on it keeps
 * its ordinary colours.
 */
const CROP_CARD_FACE = "color-mix(in srgb, var(--mc-78) 74%, #4f8c33 26%)";

export interface RecipeNodeData extends Record<string, unknown> {
  projectNode: FactoryNode;
  recipe: Recipe;
  result?: NodeThroughputResult;
}

export type RecipeFlowNode = Node<RecipeNodeData, "recipeNode">;

function RecipeNodeComponent({ data, selected }: NodeProps<RecipeFlowNode>) {
  const { projectNode, recipe, result } = data;
  const [isCompareOpen, setCompareOpen] = useState(false);
  const [previewHandlerId, setPreviewHandlerId] = useState<string>();
  // Hovering a config option shows the node as if it were picked. Same shape
  // as the machine-tab preview: display-only, never written to the project.
  const [previewConfigTier, setPreviewConfigTier] = useState<{
    controlId: string;
    key: string;
  }>();
  const [isCropMenuOpen, setCropMenuOpen] = useState(false);
  // A power card's picture window, hidden or shown from the header button.
  // The choice is this browser's, per card, never the plan's.
  const [powerArtHidden, setPowerArtHidden] = useState(() =>
    readPowerArtCollapsed(projectNode.id),
  );
  // The hatch-count chip mid-edit: the typed digits, or undefined at rest.
  // The dropdowns the chips used to open are GONE (Jack, 2026-08-31): the
  // supply chip types and wheels, the tier chip clicks and wheels, and
  // there is no menu to manage.
  const [hatchCountDraft, setHatchCountDraft] = useState<string>();
  const isHatchMenuOpen = hatchCountDraft !== undefined;
  const recipeSearch = useFactoryStore((state) => state.highlightSearch);
  // The right panel's PEAK/AVG switch drives the card's power figures too,
  // so the board and the power list always tell one story.
  const averageDraw = useWorkspaceView().averageMachineDraw;
  const hoveredFlowResourceKey = useFactoryStore((state) => state.hoveredFlowResourceKey);
  const selectedFlowResourceKey = useFactoryStore((state) => state.selectedFlowResourceKey);
  const hoveredNodeBottlenecks = useFactoryStore((state) => state.hoveredNodeBottlenecks);
  const selectedNodeBottlenecks = useFactoryStore((state) => state.selectedNodeBottlenecks);
  const deleteNode = useFactoryStore((state) => state.deleteNode);
  const duplicateNode = useFactoryStore((state) => state.duplicateNode);
  const beginRecipeRefactor = useFactoryStore((state) => state.beginRecipeRefactor);
  const updateNode = useFactoryStore((state) => state.updateNode);
  const nodeColorPaintMode = useFactoryStore((state) => state.nodeColorPaintMode);
  const pendingResourceConnection = useFactoryStore((state) => state.pendingResourceConnection);
  const dataset = useFactoryStore((state) => state.dataset);
  const energyHatchCatalog = useEnergyHatchCatalog(dataset?.datasetVersionId);
  const isSearchHighlighted = recipeContainsSearchResource(recipe, recipeSearch);
  const isFlowResourceHighlighted = recipeContainsResourceKey(
    recipe,
    hoveredFlowResourceKey ?? selectedFlowResourceKey,
  );
  const isNodeBottleneckHighlighted =
    (hoveredNodeBottlenecks || selectedNodeBottlenecks) && result?.status === "bottleneck";
  const isUsageHighlighted = useFactoryStore(
    (state) => state.hoveredUsageNodeId === projectNode.id,
  );
  const isInspectorHighlighted =
    isFlowResourceHighlighted || isNodeBottleneckHighlighted || isUsageHighlighted;
  const { calmMode, glanceMode } = useBoardView();
  // Card colour is IDENTITY, not decoration (2026-08-30): player paint no
  // longer applies to recipe cards - a stored colorTag is ignored, not
  // stripped, so plans stay untouched. The tints that remain say what a card
  // IS: custom rate blue, and the sector FACES below (power amber, crop
  // green) - a face washes only the card's ground, so every element on it
  // keeps its exact ordinary colours. The crop cards' green RAMP was
  // deliberately retired for the face (Jack, 2026-09-01): a ramp greens
  // every button and dropdown, and the ask was a green card, not green
  // chrome. Drawers and boards still take paint.
  const paintTag = isCustomRateRecipe(recipe) ? "blue" : undefined;
  // A generator wears the power sector's face: the card BACKGROUND warms
  // toward amber. Everything ON the card keeps its exact ordinary colours -
  // this is not the paint ramp, just the window's own ground.
  const isPowerCard = Boolean(recipe.power);
  const paintColor = paintTag ? GT_NODE_COLORS[paintTag] : undefined;
  const nodeColor = paintColor;
  // The card's own --mc-* ramp, which is the WHOLE of how a card takes a
  // colour: every surface inside already reads these tokens, so redefining
  // them here paints the dropdowns, the block beside them, the machine tabs,
  // the head buttons, the plugs and everything else without one of them
  // having to know. See GT_NODE_RAMPS.
  // The ink is never touched: a ramp keeps an unpainted card's lightnesses,
  // so the same light text sits at the same contrast on every colour.
  const nodeRamp = rampFor(paintTag);
  // Cards no longer take paint, so the brush must not offer itself here -
  // the armed paint mode still shows its cursor over drawers and boards.
  const paintCursor = undefined;
  // Recipe derivation is pure in (recipe, projectNode, dataset) but ran on every
  // render, including renders caused by unrelated store writes such as hover or
  // search. It also rebuilt `overclockedRecipe` each time, whose fresh identity
  // defeated NeiRecipeWindow's memo and re-ran the whole NEI pipeline downstream.
  const previewedNode = useMemo(() => {
    if (!previewConfigTier) {
      return projectNode;
    }
    return {
      ...projectNode,
      machineConfigTiers: {
        ...(projectNode.machineConfigTiers ?? {}),
        [previewConfigTier.controlId]: previewConfigTier.key,
      },
      // The coil knob still has its own legacy field; a preview that
      // only wrote the generic map would show nothing on a heating coil.
      ...(previewConfigTier.controlId === "heatingCoil"
        ? { coilTier: previewConfigTier.key }
        : undefined),
    };
  }, [previewConfigTier, projectNode]);
  const derived = useMemo(() => {
    const projectNode = previewedNode;
    const machineHandlers = getRecipeMachineHandlers(recipe);
    const selectedMachineHandler = getSelectedMachineHandler(recipe, projectNode);
    const nodeRecipe = applyRecipeInputOverrides(recipe, projectNode);
    const effectiveRecipe = applyMachineHandlerToRecipe(nodeRecipe, projectNode);
    const recipePowerTier = getRecipePowerTier(effectiveRecipe);
    // A vanilla furnace or steam machine draws no EU, so offering ULV/LV/...
    // voltage tiers on it is meaningless - the chip disappears instead.
    const machineDrawsEu =
      effectiveRecipe.eut > 0 && !isSteamMachineHandler(selectedMachineHandler);
    const tierControl = machineDrawsEu
      ? getNodeTierControl(effectiveRecipe, projectNode)
      : undefined;
    // The card's power facts: pool, draw, and whether the build can start at
    // all. Only where power means something - crops, bees, steam and zero-EU
    // recipes have no power section.
    const powerReport =
      machineDrawsEu && tierControl && hasPowerReport(nodeRecipe)
        ? getNodePowerReport(nodeRecipe, projectNode)
        : undefined;
    // Steam machines get a steam cell where electric ones get the power cell:
    // the litres per second a boiler bank has to cover.
    const steamReport = !machineDrawsEu
      ? getNodeSteamReport(nodeRecipe, projectNode)
      : undefined;
    // The hatch chip rides only on multiblocks whose maths our own engine
    // runs; runtime-ladder machines would show a knob that changes nothing.
    const showHatchControl = Boolean(
      powerReport?.isMultiblock && prefersCuratedMachineMath(effectiveRecipe),
    );
    // Which hatch family feeds the build: the plain 2 A pair, or one exotic
    // hatch (multi-amp, laser) carrying its whole rating. Picked in the
    // chip's own menu, top right, where the count and tier already live.
    const energyHatchType = getEnergyHatchType(projectNode.energyHatchType);
    const coilControl = getRecipeCoilTierControl(effectiveRecipe, projectNode);
    const coilResource = coilControl
      ? resolveDatasetMachineConfigResource(coilControl.resource, dataset)
      : undefined;
    const machineConfigControls = getRecipeMachineConfigTierControls(
      effectiveRecipe,
      projectNode,
    ).map((control) => ({
      ...control,
      resource: resolveDatasetMachineConfigResource(control.resource, dataset),
      // Table-declared controls carry bare resource ids (field restriction
      // coils); look every option's face up too, or only the current slot
      // gets an icon while the dropdown falls back to lettered squares.
      current: {
        ...control.current,
        resource: resolveDatasetMachineConfigResource(control.current.resource, dataset),
      },
      tiers: control.tiers.map((tier) => ({
        ...tier,
        resource: resolveDatasetMachineConfigResource(tier.resource, dataset),
      })),
    }));
    const cropProductionControls = isCropProductionRecipe(effectiveRecipe)
      ? machineConfigControls.filter((control) => isCropProductionConfigControl(control.id))
      : [];
    const beeProductionControls = isBeeProductionRecipe(effectiveRecipe)
      ? machineConfigControls.filter((control) => isBeeProductionConfigControl(control.id))
      : [];
    const isBeeProductionNode = beeProductionControls.length > 0;
    const beeFrameControls = beeProductionControls.filter((control) =>
      isBeeFrameSlotControlId(control.id),
    );
    const tgsToolControls = machineConfigControls.filter(isTreeGrowthSimulatorToolControl);
    const overclockedStats = getOverclockedRecipeStats(nodeRecipe, projectNode);
    const toolAdjustedRecipe = applyTreeGrowthSimulatorToolInputs(effectiveRecipe, tgsToolControls);
    const displayRecipe = isBeeProductionNode
      ? stripBeeFrameSlotInputs(toolAdjustedRecipe)
      : toolAdjustedRecipe;
    const adjustedRecipe = applyMachineOutputMultipliers(
      displayRecipe,
      projectNode,
      overclockedStats.tier,
    );
    const overclockedRecipe = {
      ...displayRecipe,
      ...adjustedRecipe,
      ...overclockedStats,
    };

    const cropSeedResource =
      cropProductionControls.length > 0
        ? effectiveRecipe.inputs.find(
            (input) =>
              input.id.startsWith("factoryflow:cropsnh_seed:") ||
              input.id.startsWith("factoryflow:ic2_crop_seed:"),
          )
        : undefined;
    const cropTitle =
      cropSeedResource && recipe.name.includes(": ")
        ? recipe.name.slice(recipe.name.indexOf(": ") + 2)
        : undefined;
    const isCropFarmNode = isCropFarmRecipe(effectiveRecipe);
    const isCropFarmPlaceholder = isCropFarmNode && effectiveRecipe.outputs.length === 0;
    // Custom rate nodes: the dialed rate lives on the raw recipe (the panel
    // writes it there), so the slot is read from `recipe`, not the effective
    // pipeline output.
    const isCustomRateNode = isCustomRateRecipe(recipe);
    const customRateSlot = isCustomRateNode ? getCustomRateSlot(recipe) : undefined;
    const isCustomRatePlaceholder = isCustomRateNode && !customRateSlot;
    // What the dial shows. An empty card has no slot to read, so the numbers
    // come off the card itself, which is also what keeps them across a card
    // letting go of a resource and being wired to another.
    const customRateDial = isCustomRateNode
      ? getCustomRateDial(projectNode, recipe)
      : undefined;

    // The harvester's own voltage chip (Crop Manager tier or Seed Bed tier)
    // wears the card's top-right tier slot, matching every other card: a crop
    // card draws no EU so the ordinary chip never shows there.
    const cropTierControl = cropProductionControls.find(
      (control) =>
        control.id === CROP_MANAGER_TIER_CONTROL_ID ||
        control.id === CROP_SEED_BED_TIER_CONTROL_ID,
    );
    return {
      machineHandlers,
      selectedMachineHandler,
      effectiveRecipe,
      recipePowerTier,
      tierControl,
      coilControl,
      coilResource,
      cropProductionControls,
      cropTierControl,
      cropTitle,
      isCropFarmNode,
      isCropFarmPlaceholder,
      isCustomRateNode,
      customRateSlot,
      customRateDial,
      isCustomRatePlaceholder,
      isCropProductionNode: cropProductionControls.length > 0,
      beeFrameControls,
      beePanelControls: getBeePanelControls(beeProductionControls),
      tgsToolControls,
      statsMachineConfigControls: machineConfigControls.filter(
        (control) =>
          !isTreeGrowthSimulatorToolControl(control) &&
          !isDisplayOnlyParallelControl(control) &&
          !isCropProductionConfigControl(control.id) &&
          !isBeeProductionConfigControl(control.id),
      ),
      machineParallelMultiplier: getMachineParallelMultiplier(effectiveRecipe, projectNode),
      // The circuit slot, read off the recipe the card actually runs: swapping
      // machine handler swaps the recipe, and a different handler can want a
      // different setting.
      programmedCircuit: getRecipeProgrammedCircuit(effectiveRecipe),
      overclockedRecipe,
      tierColor: tierControl ? GT_TIER_COLORS[tierControl.current] : undefined,
      powerReport,
      steamReport,
      showHatchControl,
      energyHatchType,
      // A power card (src/lib/power): its knobs and PRODUCES figure come off
      // the raw recipe - the panel writes settings there, custom-rate style.
      powerInfo: recipe.power,
    };
  }, [dataset, previewedNode, recipe]);

  const {
    machineHandlers,
    selectedMachineHandler,
    effectiveRecipe,
    tierControl,
    coilControl,
    coilResource,
    cropProductionControls,
    cropTierControl,
    cropTitle,
    isCropFarmNode,
    isCropFarmPlaceholder,
    isCustomRateNode,
    customRateSlot,
    customRateDial,
    isCustomRatePlaceholder,
    isCropProductionNode,
    beeFrameControls,
    beePanelControls,
    tgsToolControls,
    statsMachineConfigControls,
    machineParallelMultiplier,
    programmedCircuit,
    overclockedRecipe,
    tierColor,
    powerReport,
    steamReport,
    showHatchControl,
    energyHatchType,
    powerInfo,
  } = derived;
  // The chip's own art: the concrete hatch item this tier-and-family pair
  // names, from the once-per-dataset catalog.
  const hatchChipEntry = tierControl
    ? energyHatchCatalog.get(energyHatchCatalogKey(tierControl.current, energyHatchType.id))
    : undefined;
  // The full footer — usage, power, parallel, machines, circuit — does not
  // fit the fixed card width on one line. When power and the parallel chip
  // would share the row, the parallel chip steps UP: into the config panel's
  // own grid when the card has one, sharing a row with the coil and solenoid
  // knobs, or onto a slim right-aligned row of its own when it does not.
  const parallelChipLifts =
    !isCustomRateNode &&
    (powerReport !== undefined || steamReport !== undefined) &&
    machineParallelMultiplier > 1;
  // Verdict + rail ports read the board lazily (no extra subscription): the
  // node re-renders on every solver tick, which is exactly when any of these
  // numbers can change.
  const { project: liveProject, lastResult } = useFactoryStore.getState();
  const verdict = deriveNodeVerdict(liveProject, lastResult, projectNode.id);
  // The rate and power dials are the one thing that changes what the card
  // prints without changing the books, so the card subscribes to them.
  useRateDisplayUnits();
  // Solve mode: the card answers "how many machines" instead of "how hard is
  // this build running", so the usage cell and the count stepper both yield.
  const solveMode = useFactoryStore((state) => state.project.solveMode === true);
  const rails = buildRailPorts(
    liveProject,
    lastResult,
    projectNode.id,
    overclockedRecipe,
    verdict,
  );
  const powerStalled = powerReport !== undefined && powerReport.state !== "ok";
  // The picture window's material: the workbook render for a multiblock,
  // the machine item for a singleblock. Both are map lookups. The Industrial
  // Farm is the one non-generator multiblock with a render of its own, so a
  // crop card on that handler wears the same window (and the same hide
  // button) as any large turbine.
  const cropStructureArt =
    selectedMachineHandler.id === CROP_HARVESTER_INDUSTRIAL_FARM_ID
      ? "/power-art/industrial-farm.png"
      : undefined;
  const powerArt =
    (powerInfo ? getPowerStructureArt(powerInfo.sourceId) : undefined) ?? cropStructureArt;
  const powerMachineIcon = powerInfo ? getPowerMachineIcon(powerInfo.sourceId) : undefined;
  const hasPowerPicture = Boolean(powerArt || powerMachineIcon?.iconPath);
  // A generator's EU rides the output rail as its first row (a real port,
  // kind "power"); machines that only DRAW keep the figure in the footer.
  const hasOutputSide = rails.outputs.length > 0;
  // A power card or a crop card with a bare side says so instead of standing
  // lopsided: a solar panel's (or an Industrial Farm's) left half reads
  // "No input", not a hole. Inert rows - nothing to wire is the point.
  const saysNoFlow = powerInfo !== undefined || isCropProductionNode;
  const showNoInputRow = saysNoFlow && rails.inputs.length === 0 && hasOutputSide;
  const showNoOutputRow = saysNoFlow && !hasOutputSide && rails.inputs.length > 0;
  const hasInputSideView = rails.inputs.length > 0 || showNoInputRow;
  const hasOutputSideView = hasOutputSide || showNoOutputRow;
  // The card's draw figures follow the PEAK/AVG switch. PEAK is the full
  // draw the machine spikes to when it runs, 0 only at exactly 0% (a machine
  // that never starts draws nothing); AVG weights it by the solve's usage.
  const drawScale = drawScaleFor(averageDraw, result?.utilization);
  // The crop harvester's draw for the footer's POWER cell: the Industrial
  // Farm burns `getPowerUsage` continuously spread over its seeds, the Crop
  // Manager spends `maxEUInput() / 8` per harvest - the same arithmetic the
  // MACHINES ledger bills. Zero when picked by hand.
  // In solve mode a crop card's planted count is the ANSWER, not the input:
  // every seed-scaled figure on the card follows the solved requirement.
  const cropSolvedSeeds =
    solveMode && isCropProductionNode
      ? Math.ceil((result?.theoreticalMachinesRequired ?? 0) - 0.000001)
      : undefined;
  const cropSeedCount = cropSolvedSeeds ?? projectNode.machineCount;
  const cropDrawEuT = (() => {
    if (!isCropProductionNode) {
      return 0;
    }
    const stats = getCropsNhStats(effectiveRecipe);
    const setup = cropsNhHarvesterFromTiers(
      projectNode.machineConfigTiers,
      projectNode.machineHandlerId,
      stats?.minSeedBedTier,
      stats?.subSoil !== undefined,
    );
    if (cropsNhIsHandPicked(setup)) {
      return 0;
    }
    const crops = Math.max(0, Math.round(cropSeedCount));
    if (setup.id === CROP_HARVESTER_INDUSTRIAL_FARM_ID) {
      // WHOLE farms bill: the last, partially filled farm draws its full
      // power like the rest.
      return cropsNhFarmEut(setup) * cropsNhHarvesterMachineCount(setup, crops);
    }
    if (!stats) {
      return 0;
    }
    const ticks = cropsNhHarvestTicks(
      stats,
      cropsNhEnvironmentFromTiers(projectNode.machineConfigTiers),
    );
    return Number.isFinite(ticks) && ticks > 0
      ? (cropsNhManagerEuPerHarvest(setup) * crops) / ticks
      : 0;
  })();
  const glanceDrawEuT = powerReport
    ? powerDrawEuT(powerReport, projectNode) * drawScale
    : 0;
  const glanceSteamLs = steamReport
    ? steamDrawLitresPerSecond(steamReport, projectNode) * drawScale
    : 0;
  // A generator's power view answers with what it MAKES, signed and green
  // like its row in the MACHINES ledger; a parasitic one shows its draw the
  // way any machine does. Both ride the PEAK/AVG switch through drawScale.
  const powerCardMachines = projectNode.machineCount * Math.max(1, projectNode.parallel);
  const glancePowerCardEuT = powerInfo
    ? Math.abs(powerInfo.euPerTick) * powerCardMachines * drawScale
    : 0;
  const powerCardMakes = (powerInfo?.euPerTick ?? 0) > 0;
  const powerCardGlanceWord = powerInfo
    ? (projectNode.machineConfigTiers?.tier ?? getPowerSource(powerInfo.sourceId)?.unlock)
    : undefined;
  // What the LOD step paints this card, per smart view. Every non-identity
  // view returns a surface for EVERY card — a card with nothing to say gets
  // the neutral one rather than keeping its paint, because a red paint tag
  // under the usage view would read as a bottleneck that isn't there.
  const glanceSurface: NodeSurfaceColor | undefined =
    glanceMode === "status"
      ? heatmapColorFor(result?.utilization, projectNode.enabled !== false)
      : glanceMode === "usage"
        ? glanceToneSurface(verdictWord(verdict, isCustomRateNode, powerStalled).tone)
        : glanceMode === "power"
          ? powerReport
            ? glanceSurfaceFor(GT_TIER_COLORS[powerReport.tier].background)
            : GLANCE_NEUTRAL_SURFACE
          : undefined;
  const glanceAccent = glanceSurface ? glanceAccentFor(glanceSurface) : undefined;
  // The ports this card actually renders below, in render order. A placeholder
  // shows no rails at all: a crop farm waiting on a crop has nothing to wire,
  // and a custom rate node shows its two universal sockets instead. Handing
  // the list to React Flow keeps its handle bounds honest when the set changes
  // without the card changing size — see use-rendered-handles.ts.
  useRenderedHandles(
    projectNode.id,
    isCropFarmPlaceholder
      ? EMPTY_HANDLE_IDS
      : isCustomRatePlaceholder
        ? CUSTOM_RATE_UNIVERSAL_HANDLE_IDS
        : [
            ...rails.inputs.map((port) => port.handleId),
            ...rails.outputs.map((port) => port.handleId),
          ],
  );
  const updateTier = (direction: -1 | 1) => {
    if (!tierControl) {
      return;
    }

    const nextTier = getAdjacentTier(
      tierControl.current,
      tierControl.allowBelowMinimum ? undefined : tierControl.minimum,
      direction,
    );
    if (nextTier !== tierControl.current) {
      // The board's ONE sound for a voltage tier: the power unit dial's
      // ladder, so LV clicks and UV crackles identically wherever a tier
      // is chosen. Rung 1..15 matches the dial's (0 is its EU/t floor).
      playBoardSound("dialPower", { step: getVoltageTierIndex(nextTier) + 1 });
      // The write below also crosses the diff watcher; 150ms of quiet keeps
      // its generic adjust tap from doubling this voice.
      suppressBoardSound("adjust", 150);
      updateNode(projectNode.id, {
        overclockTier: nextTier,
        // A hatch family that does not exist at the new tier (a laser below
        // IV) goes back to the plain pair rather than modelling a build the
        // game cannot make.
        ...(energyHatchTypeExistsAtTier(projectNode.energyHatchType, nextTier)
          ? undefined
          : { energyHatchType: undefined }),
      });
    }
  };
  // Shift-click on the supply chip walks the supply ladder without the menu:
  // regular counts first, then the exotic hatches, in the menu's own order.
  const stepSupply = (direction: -1 | 1) => {
    if (!tierControl) {
      return;
    }
    const options = energySupplyOptionsForTier(tierControl.current, energyHatchCatalog);
    const currentIndex = options.findIndex(
      (option) =>
        option.familyId === energyHatchType.id &&
        (option.familyId !== STANDARD_ENERGY_HATCH_ID ||
          option.hatches === (powerReport?.hatches ?? 1)),
    );
    const next =
      options[
        Math.min(options.length - 1, Math.max(0, (currentIndex < 0 ? 0 : currentIndex) + direction))
      ];
    if (next && (currentIndex < 0 || options[currentIndex] !== next)) {
      // The supply ladder speaks the same electric language, quieter, and
      // CLIMBS with the amps: each supply option is a quarter-rung above
      // the last inside its tier, so more hatches audibly means more.
      playBoardSound("dialPower", {
        step: getVoltageTierIndex(tierControl.current) + 1 + options.indexOf(next) * 0.25,
        gain: 0.6,
      });
      suppressBoardSound("adjust", 150);
      updateNode(projectNode.id, {
        energyHatchType: next.familyId === STANDARD_ENERGY_HATCH_ID ? undefined : next.familyId,
        energyHatches: next.hatches,
      });
    }
  };
  const updateCoilTier = (nextTier: string) => {
    updateNode(projectNode.id, { coilTier: nextTier });
  };
  const updateMachineConfigTier = (controlId: string, nextTier: string) => {
    const nextMachineConfigTiers = {
      ...(projectNode.machineConfigTiers ?? {}),
      [controlId]: nextTier,
    };
    if (controlId === BEE_INDUSTRIAL_SPEED_CONTROL_ID && nextTier === "speed-8-upgraded") {
      nextMachineConfigTiers[BEE_INDUSTRIAL_PRODUCTION_CONTROL_ID] = "8";
    }

    updateNode(projectNode.id, {
      machineConfigTiers: nextMachineConfigTiers,
    });
  };
  // TGS tool slots and bee frame slots used to be icon menus painted over
  // recipe-canvas slots; with the canvas gone they join the regular config
  // panel as icon + dropdown rows (tiers filtered to each slot's category).
  const visibleMachineConfigControls = [
    ...(coilControl && coilResource ? [{ ...coilControl, resource: coilResource }] : []),
    ...tgsToolControls.map((control) => ({
      ...control,
      resource: getTreeGrowthSimulatorSlotResource(control),
      tiers: getTreeGrowthSimulatorSlotTiers(control),
    })),
    ...beeFrameControls,
    ...statsMachineConfigControls,
  ];
  const parallelPanelTile =
    parallelChipLifts && visibleMachineConfigControls.length > 0 ? (
      <ConfigParallelTile value={formatMachineParallelMultiplier(machineParallelMultiplier)} />
    ) : undefined;
  const machineConfigPanel =
    visibleMachineConfigControls.length > 0 ? (
      <MachineConfigControlPanel
        controls={visibleMachineConfigControls}
        trailing={parallelPanelTile}
        onPreview={(controlId, key) =>
          setPreviewConfigTier(key === undefined ? undefined : { controlId, key })
        }
        onSelect={(controlId, nextTier) => {
          setPreviewConfigTier(undefined);
          if (controlId === "heatingCoil") {
            updateCoilTier(nextTier);
            return;
          }
          updateMachineConfigTier(controlId, nextTier);
        }}
      />
    ) : undefined;
  const passiveProductionPanel =
    cropProductionControls.length > 0 ? (
      <CropConfigPanel
        className={CROP_CONFIG_PANEL_WIDTH_CLASS}
        controls={cropProductionControls}
        handlerId={selectedMachineHandler.id}
        machineConfigTiers={projectNode.machineConfigTiers}
        machineCount={cropSeedCount}
        minSeedBedTier={getCropsNhStats(effectiveRecipe)?.minSeedBedTier}
        cropStats={getCropsNhStats(effectiveRecipe)}
        onSelect={updateMachineConfigTier}
        onSelectMany={(patch) =>
          updateNode(projectNode.id, {
            machineConfigTiers: { ...(projectNode.machineConfigTiers ?? {}), ...patch },
          })
        }
        getControlHelp={(controlId) => cropControlHelp(effectiveRecipe, controlId)}
      />
    ) : beePanelControls.length > 0 ? (
      <PassiveProductionConfigPanel
        controls={beePanelControls}
        onSelect={updateMachineConfigTier}
        title={selectedMachineHandler.label}
        collapsed={projectNode.settingsCollapsed === true}
        onToggleCollapsed={() =>
          updateNode(projectNode.id, {
            settingsCollapsed: !(projectNode.settingsCollapsed === true),
          })
        }
      />
    ) : undefined;
  const updateMachineHandler = (machineHandlerId: string) => {
    if (machineHandlers.length <= 1) {
      return;
    }

    const nextHandler =
      machineHandlers.find((handler) => handler.id === machineHandlerId) ?? selectedMachineHandler;
    updateNode(projectNode.id, {
      machineHandlerId: nextHandler.id,
      overclockTier: nextHandler.minimumTier,
      ...(energyHatchTypeExistsAtTier(projectNode.energyHatchType, nextHandler.minimumTier)
        ? undefined
        : { energyHatchType: undefined }),
    });
    setCompareOpen(false);
    setPreviewHandlerId(undefined);
  };

  // A crop card's NAME BAR is its crop picker, so the harvester picker takes
  // the tab strip above the card like every other machine choice. The old
  // `!isCropFarmNode` guard was redundant when crops had a single handler;
  // now that they offer by hand, Crop Manager and Industrial Farm it is the
  // only thing standing between the card and its machines.
  const hasMachinePicker = machineHandlers.length > 1;
  const machineIcons = useMachineHandlerIcons();
  // The machine's own art, when the dataset ships it. Crop farms and custom
  // rate nodes have no machine to show.
  const machineGlanceIcon = powerInfo
    ? powerMachineIcon?.iconPath
      ? ({
          kind: "item",
          id: powerMachineIcon.id,
          displayName: powerMachineIcon.displayName,
          iconPath: powerMachineIcon.iconPath,
          dominantColor: powerMachineIcon.dominantColor,
        } as unknown as MachineHandlerIcon)
      : undefined
    : !isCropFarmNode && !isCustomRateNode
      ? machineIcons.get(selectedMachineHandler.id)
      : undefined;
  // Presentation mode's tab zone: the selected machine's icon, big, and
  // nothing else.
  const machineTabIcon = calmMode ? machineGlanceIcon : undefined;
  // The tab zone's height IS the dock inset: wires must not dock on the
  // zone's phantom top edge (dock-insets.ts). Observed rather than derived,
  // because the picker strip wraps and its row count is a layout fact.
  const tabZoneRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = tabZoneRef.current;
    const publish = () => {
      const zoneHeight = element?.offsetHeight ?? 0;
      if (!element || zoneHeight === 0) {
        publishDockTopInset(projectNode.id, 0);
        return;
      }
      // How far right the tab ART reaches: the widest in-flow child across
      // every row (the baseline strip is absolute and spans the whole zone,
      // so it is skipped). Top docks refuse to land left of this line — a
      // stub there would draw straight across a tab.
      let tabsRight = 0;
      const zone = element.firstElementChild;
      for (const child of zone?.children ?? []) {
        const box = child as HTMLElement;
        if (getComputedStyle(box).position === "absolute") {
          continue;
        }
        tabsRight = Math.max(tabsRight, box.offsetLeft + box.offsetWidth);
      }
      publishDockTopInset(projectNode.id, zoneHeight, tabsRight);
    };
    publish();
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => observer.disconnect();
  }, [projectNode.id]);
  const previewHandler = hasMachinePicker
    ? (machineHandlers.find((handler) => handler.id === previewHandlerId) ?? selectedMachineHandler)
    : selectedMachineHandler;
  const isPreviewing = hasMachinePicker && previewHandler.id !== selectedMachineHandler.id;
  // The outlines the card is wearing, innermost first. They STACK rather than
  // override: each ring starts where the one inside it stopped. Selection is
  // innermost, which is also the ring painted on top — clicking a card has to
  // show that it landed, and a 2px line inside a breathing red dead-loop glow was
  // being lost in it.
  //
  // The recipe book's tier dropdown used to put a red ring and a "TIER REQUIRED"
  // badge on every card above it. That dropdown narrows a SEARCH; it says nothing
  // about what the plan is allowed to contain, and reading it as a verdict meant
  // filtering the book to LV accused a third of the board of being wrong.
  const cardOutlineRings = [
    ...(selected ? [{ width: 2, color: "var(--selection)" }] : []),
    ...(isSearchHighlighted ? [{ width: 4, color: "#7dd3fc" }] : []),
  ];

  // Outputs end in coupling chips at the node's right edge — inside the
  // card, like inputs — so the node's box is the machine's box again and
  // wires reach the chips the same way they reach input chips.
  return (
    <div
      // The verdict gates WHICH rows the usage hover lights (globals.css):
      // a starved node blames its binding input, an over-asked one blames its
      // couplings, and lighting both at once answers the wrong question.
      data-verdict={verdict.kind}
      className={[
        // recipe-node-shell scopes the strip↔row hover link (globals.css):
        // hovering the verdict lights the input it blames, in pure CSS, so a
        // hover never re-renders a node.
        // The shell is the node's whole BOX — tab zone plus window — and is
        // deliberately unpainted: the frame and background live on the window
        // div below, so the tabs protrude over bare canvas. The router still
        // measures the shell, which is what keeps wires out of the tab zone.
        // Nothing that OUTLINES the card belongs on this element: the shell's
        // box includes the tab zone, so a ring here draws around the machine
        // tabs and the bare canvas behind them. Every outline lives on the
        // window instead — see cardOutlineRings and the dead-loop ring.
        "recipe-node-shell group relative font-mono text-[var(--mc-ink)]",
        // Marker for the globals.css layer lift: with a picker popup open the
        // node (and the whole nodes layer) must paint above edges.
        isCompareOpen ? "recipe-node-popup-open" : "",
      ].join(" ")}
      // The LOD colour, armed but not applied: the --glance-* variables mean
      // nothing until the board crosses into the glance step, where the
      // stylesheet reads them onto the window. That is what makes every smart
      // view LOD-only with no subscription to the zoom.
      data-glance-paint={glanceSurface ? "" : undefined}
      style={{
        // Every recipe card is the same 18 cells wide. Width used to be
        // content-driven (`w-max`), which put the card's right edge — and so
        // every output coupling — at an arbitrary sub-cell offset.
        width: RECIPE_NODE_WIDTH,
        // The colour, all of it. The ramp goes on the SHELL rather than the
        // window so the machine tabs above the card take it too — they are
        // the card's tabs, and a grey tab on a green card was the tell that
        // the paint was a list of elements rather than a palette.
        ...(nodeRamp as CSSProperties | undefined),
        ...(glanceSurface ? (glanceCardVars(glanceSurface) as CSSProperties) : undefined),
        ...(paintCursor ? { cursor: paintCursor } : undefined),
      }}
    >
      {/* The tab zone: rows of whole cells ABOVE the window, over bare
          canvas — tabs, not a toolbar band inside the card. It is part of
          the shell's box, so the router keeps wires out of the space the
          tabs claim; its measured height is published as the dock inset so
          wires never DOCK on its phantom edge (see dock-insets.ts). Normal
          mode gets the picker strip; presentation mode gets the selected
          machine's icon, big, and nothing to click. */}
      <div ref={tabZoneRef}>
        {!calmMode && hasMachinePicker ? (
          <MachineTabStrip
            handlers={machineHandlers}
            selectedId={selectedMachineHandler.id}
            previewId={previewHandlerId}
            iconsById={machineIcons}
            onHover={setPreviewHandlerId}
            onSelect={updateMachineHandler}
            onToggleCompare={() => setCompareOpen((open) => !open)}
            isCompareOpen={isCompareOpen}
          />
        ) : machineTabIcon ? (
          <MachineIconTab icon={machineTabIcon} label={selectedMachineHandler.label} />
        ) : null}
      </div>
      {/* The window: the painted card. The 2px frame is an INSET shadow, not
          a border — a real border sits outside the content box and would push
          every row 2px off the grid; painted inside, the window's box and its
          content box are the same rectangle, so a head of 40 and rows of 40
          land exactly on cell lines. The bevel is drawn at 4px and the frame
          covers its outer half, which reproduces the old 2px-inside-2px look
          exactly. */}
      <div
        // Glance root is the WINDOW, not the shell: zoomed out the frame and
        // paint stay and only what is written on them goes — a card still
        // reads as a card. The tab zone hides via its own rule in globals.css
        // (it is the shell's child, outside this root).
        data-node-glance-root=""
        // recipe-node-window: the painted rectangle, as opposed to the shell's
        // box (which includes the unpainted tab zone). Anything that outlines
        // "the card" belongs here — see the dead-loop ring in globals.css.
        // The resource glow is an `outline`, not a box-shadow, so it rides the
        // window directly without touching the frame this element draws.
        className={[
          "recipe-node-window relative bg-[var(--mc-78)] shadow-[inset_0_0_0_2px_var(--mc-96),inset_4px_4px_0_var(--mc-100),inset_-4px_-4px_0_var(--mc-33)]",
          isInspectorHighlighted ? "resource-glow" : "",
        ].join(" ")}
        // The card's face, frame and bevels are already the ramp's tokens, so
        // a painted card needs nothing here but the RING: the dye at full
        // strength around the outside, which is what makes a tag legible from
        // across the board and at any zoom, however quiet the body is.
        style={{
          ...(nodeColor
            ? {
                boxShadow: `inset 0 0 0 2px ${nodeColor.border}, inset 4px 4px 0 var(--mc-100), inset -4px -4px 0 var(--mc-33), 0 0 0 2px ${nodeColor.shadow}`,
              }
            : undefined),
          ...(isPowerCard ? { backgroundColor: POWER_CARD_FACE } : undefined),
          ...(isCropProductionNode || isCropFarmNode
            ? { backgroundColor: CROP_CARD_FACE }
            : undefined),
        }}
      >
      {/* The ring's mark, and the reason it is an ELEMENT rather than the
          window's ::after: a pseudo-element's box is only as trustworthy as
          the selector that made it, and this one kept coming out around the
          SHELL — the whole box, tab zone included — so the ring enclosed the
          machine tabs and the bare canvas behind them, and the card read as
          floating inside a rectangle that was not its own. A child of the
          window has the window's box by construction; there is no selector
          left to get wrong. It draws nothing but its own glow, takes no
          pointer events, and carries no text, so it is invisible to
          everything except the eye. */}
      {verdict.kind === "dead-loop" ? (
        <div aria-hidden className="dead-loop-ring" />
      ) : null}
      {/* The clog lock's ring, in the clog family's blue - and only on the
          VENT sites, the cards whose surplus needs the drawer. A jam can
          hold half a board; every member keeps the verdict and its story,
          but a ring on all of them painted whole plans blue and pointed
          nowhere. */}
      {verdict.kind === "clog-lock" &&
      verdict.clogLock?.vents.some((vent) => vent.nodeId === projectNode.id) ? (
        <div aria-hidden className="clog-lock-ring" />
      ) : null}
      {/* The same trick for an unfinished card, and quiet on purpose: the
          slots are what you have to go and fix, so THEY carry the loud pulse
          and the card only breathes enough to be findable on a busy board. */}
      {verdict.kind === "unwired" ? (
        <div aria-hidden className="unwired-ring" />
      ) : null}
      {/* Selection, the over-tier warning and a search hit, on the card's own
          box for the same reason the ring above is. One element and one
          box-shadow list: shadows paint first-on-top and each spread is
          cumulative, so the list reads outwards from the card edge and the
          innermost ring is also the one nothing can cover. Above the dead-loop
          ring in z, so a selected card in a ring still shows it is selected —
          the red keeps its breathing halo outside the purple. */}
      {cardOutlineRings.length > 0 ? (
        <div
          aria-hidden
          className="card-outline"
          style={{
            boxShadow: cardOutlineRings
              .map((ring, index) => {
                const spread = cardOutlineRings
                  .slice(0, index + 1)
                  .reduce((total, entry) => total + entry.width, 0);
                return `0 0 0 ${spread}px ${ring.color}`;
              })
              .join(", "),
          }}
        />
      ) : null}
      {/* The smart view: what this card leads with zoomed out, and ONLY
          zoomed out. Identity mode (the default) is WHAT it is — machine
          icon, count and name, with the I/O rates revealed on hover by pure
          CSS. Status is the speed view: the percentage over the heat wash,
          inked in the wash's own accent so the figure reads as part of the
          card, not as a verdict. Usage answers WHY with the reason word under
          the number, on the reason's colour. Power shows the draw and the
          hatch-and-tier chip on the tier's colour. */}
      {glanceMode === "identity" ? (
        <GlanceIdentityLayer
          machineIcon={machineGlanceIcon}
          artSrc={powerArt}
          fallbackResource={rails.outputs[0]?.resource ?? rails.inputs[0]?.resource}
          paintTint={nodeColor?.swatch}
          label={
            isCustomRateNode
              ? (effectiveRecipe.name ?? "Custom rate")
              : `${projectNode.machineCount}× ${selectedMachineHandler.label ?? effectiveRecipe.machineType ?? effectiveRecipe.name}`
          }
          inputs={rails.inputs}
          outputs={rails.outputs}
        />
      ) : glanceMode === "power" && powerInfo ? (
        <NodeGlanceText
          icon={
            <GlanceMachineArt
              machineIcon={machineGlanceIcon}
              artSrc={powerArt}
              fallbackResource={rails.outputs[0]?.resource ?? rails.inputs[0]?.resource}
              small
            />
          }
          className={powerCardMakes ? "text-emerald-300" : undefined}
          valueSize={powerGlanceValueSize(
            `${powerCardMakes ? "+" : ""}${formatCompact(glancePowerCardEuT)}`,
          )}
          text={
            <>
              <MotionNumberText
                values={[glancePowerCardEuT]}
                render={(shown) => {
                  const value = shown[0] ?? glancePowerCardEuT;
                  const figure =
                    value === glancePowerCardEuT
                      ? formatCompact(powerDisplayFromEuT(glancePowerCardEuT))
                      : formatCompactStable(powerDisplayFromEuT(value));
                  return powerCardMakes ? `+${figure}` : figure;
                }}
              />
              <span className="ml-1.5 text-[18px] font-semibold opacity-70">
                {powerDisplaySuffix()}
              </span>
            </>
          }
          word={powerCardGlanceWord}
        />
      ) : glanceMode === "power" ? (
        <NodeGlanceText
          icon={
            <GlanceMachineArt
              machineIcon={machineGlanceIcon}
              artSrc={powerArt}
              fallbackResource={rails.outputs[0]?.resource ?? rails.inputs[0]?.resource}
              small
            />
          }
          accent={powerReport || steamReport ? glanceAccent : undefined}
          className={powerReport || steamReport ? undefined : "text-[var(--mc-ink-muted)]"}
          // Sized by how many glyphs the settled figure needs, so a draw in
          // the millions shrinks to fit rather than grazing the card frame.
          valueSize={
            powerReport
              ? powerGlanceValueSize(formatCompact(glanceDrawEuT))
              : steamReport
                ? powerGlanceValueSize(formatCompact(glanceSteamLs))
                : undefined
          }
          text={
            powerReport ? (
              <>
                <MotionNumberText
                  values={[glanceDrawEuT]}
                  render={(shown) => {
                    const value = shown[0] ?? glanceDrawEuT;
                    // Same pact as the footer's POWER cell: stable widths
                    // mid-tween, the clean compact form at rest.
                    return value === glanceDrawEuT
                      ? formatCompact(powerDisplayFromEuT(glanceDrawEuT))
                      : formatCompactStable(powerDisplayFromEuT(value));
                  }}
                />
                <span className="ml-1.5 text-[18px] font-semibold opacity-70">
                  {powerDisplaySuffix()}
                </span>
              </>
            ) : steamReport ? (
              // A steam machine's draw is litres, not EU: same cell, its own
              // unit, so the power view still answers on a steam line.
              <>
                <MotionNumberText
                  values={[glanceSteamLs]}
                  render={(shown) => {
                    const value = shown[0] ?? glanceSteamLs;
                    return value === glanceSteamLs
                      ? formatCompact(glanceSteamLs)
                      : formatCompactStable(value);
                  }}
                />
                <span className="ml-1.5 text-[18px] font-semibold opacity-70">L/s</span>
              </>
            ) : (
              "—"
            )
          }
          word={
            powerReport
              ? powerReport.isMultiblock
                ? energyHatchType.exotic
                  ? `${energyHatchType.chip} ${powerReport.tier}`
                  : `${powerReport.hatches}× ${powerReport.tier}`
                : powerReport.tier
              : steamReport
                ? steamReport.highPressure
                  ? "HP steam"
                  : "Steam"
                : undefined
          }
        />
      ) : (
        <NodeGlanceText
          icon={
            <GlanceMachineArt
              machineIcon={machineGlanceIcon}
              artSrc={powerArt}
              fallbackResource={rails.outputs[0]?.resource ?? rails.inputs[0]?.resource}
              small
            />
          }
          accent={glanceAccent}
          text={
            verdict.kind === "off" || verdict.kind === "no-recipe" ? (
              "—"
            ) : (
              <MotionNumberText
                values={[verdict.pct]}
                render={(shown) => {
                  const pct = shown[0] ?? verdict.pct;
                  return `${pct > 0 && pct < 0.5 ? formatRate(pct, 1) : formatPct(pct)}%`;
                }}
              />
            )
          }
          word={
            glanceMode === "usage"
              ? verdictWord(verdict, isCustomRateNode, powerStalled).word
              : undefined
          }
        />
      )}
      {/* No vertical padding: the head, the rails, the panels and the footer
          each own a whole number of cells, and any padding here would push
          all of them off the grid. Horizontal padding is 8, which is what
          makes the rails add up to RECIPE_RAIL_AREA_WIDTH. */}
      <div className="px-2">
        {/* width:0 + min-width:100% — the picker header adapts to whatever
            width the recipe card sets and can never widen the node itself,
            no matter how long a machine name or tab strip gets. */}
        <div className="w-0 min-w-full">
        <div
          // One head row, exactly two cells tall. The title bar inside it
          // stays 24px and centres in the row — the extra space is the
          // margin that puts the first port centre on a grid line.
          className="grid h-[40px] min-w-0 items-center gap-1"
          // The columns are an inline style, not a class: with the delete/clone
          // pair and the tier chip each free to be absent, the class form is
          // one hand-written arbitrary-value string per combination, and
          // Tailwind can only emit the ones spelled out in full.
          style={{
            gridTemplateColumns: [
              // Calm mode drops the delete/clone/refactor chrome; the title
              // takes the row. Placeholder cards (crop pick, dial-a-rate)
              // have nothing to refactor, so they keep two buttons.
              ...(calmMode
                ? []
                : isCropFarmPlaceholder || isCustomRateNode
                  ? ["24px", "24px"]
                  : hasPowerPicture
                    ? ["24px", "24px", "24px", "24px"]
                    : ["24px", "24px", "24px"]),
              "minmax(0,1fr)",
              // The tier chip, with its hatch sister fused on the left when
              // the machine is a multiblock that takes energy hatches. The
              // pair sizes to content: a laser hatch's amp rating is wider
              // than a plain hatch count.
              ...(tierControl ? [showHatchControl ? "max-content" : "50px"] : []),
              // A power card's tier chip (or its multiblock unlock chip).
              ...(powerInfo && !tierControl ? ["50px"] : []),
              // A crop card's harvester tier (manager or seed bed) wears the
              // same top-right slot as every other card's voltage chip.
              ...(cropTierControl && !tierControl && !powerInfo && !calmMode ? ["50px"] : []),
            ].join(" "),
          }}
        >
          {!calmMode ? (
            <>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  deleteNode(projectNode.id);
                }}
                className="nodrag h-6 w-6 border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-base leading-[16px] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)] hover:bg-red-700"
                title="Delete node"
                aria-label="Delete node"
              >
                -
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  duplicateNode(projectNode.id);
                }}
                className="nodrag flex h-6 w-6 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)] hover:bg-[var(--mc-61)]"
                title="Clone node"
                aria-label="Clone node"
              >
                <Copy aria-hidden className="h-3.5 w-3.5" />
              </button>
              {!isCropFarmPlaceholder && !isCustomRateNode ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    beginRecipeRefactor(projectNode.id);
                  }}
                  className="nodrag flex h-6 w-6 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)] hover:bg-[var(--mc-61)]"
                  title="Refactor: search for a replacement recipe"
                  aria-label="Refactor node"
                >
                  <RefreshCw aria-hidden className="h-3.5 w-3.5" />
                </button>
              ) : null}
              {hasPowerPicture ? (
                // The picture window's switch lives with the card chrome:
                // hidden, the window renders nothing at all.
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setPowerArtHidden((hidden) => {
                      writePowerArtCollapsed(projectNode.id, !hidden);
                      return !hidden;
                    });
                  }}
                  className="nodrag flex h-6 w-6 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)] hover:bg-[var(--mc-61)]"
                  title={powerArtHidden ? "Show the machine picture" : "Hide the machine picture"}
                  aria-label={powerArtHidden ? "Show the machine picture" : "Hide the machine picture"}
                  aria-pressed={!powerArtHidden}
                >
                  <ImageIcon
                    aria-hidden
                    className={powerArtHidden ? "h-3.5 w-3.5 opacity-40" : "h-3.5 w-3.5"}
                  />
                </button>
              ) : null}
            </>
          ) : null}
          <div className="relative min-w-0">
            <MinecraftTooltip
              content={
                isCropFarmPlaceholder ? (
                  "Click to pick a crop"
                ) : isCustomRateNode ? (
                  customRateSlot ? (
                    customRateSlot.mode === "supply"
                      ? `Makes ${resourceLabel(customRateSlot.resource)} at the dialed rate for anything that asks.`
                      : `Constantly drains ${resourceLabel(customRateSlot.resource)} at the dialed rate.`
                  ) : (
                    "Wire any port to this and it adopts that resource."
                  )
                ) : isPowerCard ? (
                  // A generator's stats live on the card (settings, stat
                  // lines); the machine tooltip's overclock story does not
                  // apply to it and would just be wrong here.
                  (recipe.notes ?? recipe.name)
                ) : (
                  <MachineStatsContent
                    recipe={recipe}
                    handler={selectedMachineHandler}
                    node={projectNode}
                  />
                )
              }
            >
              {/* One plain name bar for every node. Picker nodes already show
                  the selected machine in the tab strip above, so the old
                  icon-box + TIME/POWER/PARALLEL glance cells only overflowed
                  the narrow card; those numbers live in the hover and the
                  footer. */}
              <div
                role={isCropFarmNode ? "button" : undefined}
                tabIndex={isCropFarmNode ? 0 : undefined}
                onClick={
                  isCropFarmNode
                    ? (event) => {
                        event.stopPropagation();
                        setCropMenuOpen((open) => !open);
                      }
                    : undefined
                }
                className={[
                  // 13px: long GT machine names must read fully instead of
                  // getting chopped by the narrow card.
                  "minecraft-title flex h-6 min-w-0 items-center border-2 border-[var(--mc-33)] bg-[var(--mc-61)] text-[13px] leading-[18px] shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-29)]",
                  // Symmetric padding keeps the crop name in the true middle;
                  // the picker chevron floats on the right without shifting it.
                  isCropFarmNode
                    ? "nodrag relative cursor-pointer px-5 hover:brightness-110"
                    : "px-2",
                ].join(" ")}
                style={nodeColor ? { backgroundColor: nodeColor.header } : undefined}
                title={isCropFarmNode ? "Pick a crop" : undefined}
              >
                <span className="mx-auto min-w-0 truncate">
                  {isCropFarmPlaceholder
                    ? "Pick a crop..."
                    : isCustomRateNode
                      ? // The resource is already on the port right below,
                        // with its icon. Repeating its name in the title only
                        // ever made the card wider.
                        "Custom Rate"
                      : (cropTitle ?? previewHandler.label)}
                  {isPreviewing ? " ?" : ""}
                </span>
                {isCropFarmNode ? (
                  <ChevronDown className="absolute right-1 top-1/2 h-3 w-3 shrink-0 -translate-y-1/2" />
                ) : null}
              </div>
            </MinecraftTooltip>
            {isCropMenuOpen ? (
              <CropPickerMenu
                nodeId={projectNode.id}
                onClose={() => setCropMenuOpen(false)}
              />
            ) : null}
            {hasMachinePicker && isCompareOpen && !calmMode ? (
              <MachineCompareTable
                recipe={recipe}
                handlers={machineHandlers}
                selectedId={selectedMachineHandler.id}
                iconsById={machineIcons}
                onHover={setPreviewHandlerId}
                onUse={updateMachineHandler}
                onClose={() => setCompareOpen(false)}
              />
            ) : null}
          </div>
          {/* A power card's tier lives where every machine's does: the header
              chip, click up, right click down, wheel to scroll. Multiblock
              generators have no tier knob (the workbook fixes their output),
              so they wear their unlock tier as a static chip instead. */}
          {powerInfo ? (
            <PowerTierChip
              nodeId={projectNode.id}
              sourceId={powerInfo.sourceId}
              values={projectNode.machineConfigTiers}
            />
          ) : null}
          {cropTierControl && !tierControl && !powerInfo && !calmMode ? (
            // The harvester's voltage (Crop Manager tier, or the farm's Seed
            // Bed) in the card's usual tier slot: click up, right click down,
            // wheel to scroll - the classic cycle, everywhere.
            <CropTierChip
              control={cropTierControl}
              onPick={(key) => {
                playBoardSound("dialPower", { step: Number.parseInt(key, 10) + 1 });
                suppressBoardSound("adjust", 150);
                updateMachineConfigTier(cropTierControl.id, key);
              }}
            />
          ) : null}
          {tierControl && tierColor ? (
            // The fused chip trio is ONE hover surface telling the whole
            // power story - the same panel the footer's POWER cell shows -
            // so count, hatch and tier all speak one language. The native
            // titles survive only where there is no report to tell it.
            <div className="relative">
            <MinecraftTooltip
              content={
                powerReport && !isHatchMenuOpen ? (
                  <PowerStoryContent
                    report={powerReport}
                    utilization={result?.utilization}
                    machines={projectNode.machineCount * projectNode.parallel}
                  />
                ) : undefined
              }
            >
            <div className="flex">
              {showHatchControl && hatchCountDraft !== undefined ? (
                // The count chip MID-EDIT: type any hatch count. No menu -
                // the wheel walks the ladder, the keyboard names a number.
                <input
                  autoFocus
                  value={hatchCountDraft}
                  onChange={(event) => setHatchCountDraft(event.target.value)}
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={() => {
                    const count = Number.parseInt(hatchCountDraft.trim(), 10);
                    setHatchCountDraft(undefined);
                    if (Number.isFinite(count) && count >= 1 && count <= 64) {
                      playBoardSound("dialPower", {
                        step: getVoltageTierIndex(tierControl.current) + 1,
                        gain: 0.6,
                      });
                      suppressBoardSound("adjust", 150);
                      updateNode(projectNode.id, {
                        energyHatchType: undefined,
                        energyHatches: count,
                      });
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                    if (event.key === "Escape") {
                      setHatchCountDraft(undefined);
                    }
                    event.stopPropagation();
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                  inputMode="numeric"
                  aria-label="Energy hatch count"
                  className="nodrag h-6 w-[44px] border-2 border-r-0 bg-[var(--mc-93)] px-1 text-center text-[11px] font-bold leading-none text-[var(--mc-ink)] outline-none focus:border-cyan-700"
                  style={{ borderColor: tierColor.border }}
                />
              ) : showHatchControl ? (
                // The SUPPLY chip: what powers the build (count and item, or
                // an exotic's amp badge), fused left of the tier. CLICK to
                // type any count; wheel or right-click walks the ladder
                // (counts, then the exotic families).
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setHatchCountDraft(String(powerReport?.hatches ?? 1));
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    stepSupply(-1);
                  }}
                  onWheel={(event) => {
                    event.stopPropagation();
                    stepSupply(event.deltaY < 0 ? 1 : -1);
                  }}
                  className="nodrag nowheel flex h-6 items-center justify-center gap-0.5 whitespace-nowrap border-2 border-r-0 px-0.5 text-[11px] font-bold leading-none shadow-[inset_2px_2px_0_rgba(255,255,255,0.55),inset_-2px_-2px_0_rgba(0,0,0,0.45)] hover:brightness-110"
                  style={{
                    backgroundColor: tierColor.background,
                    borderColor: tierColor.border,
                    color: tierColor.text,
                    textShadow: `1px 1px 0 ${tierColor.shadow}`,
                  }}
                  aria-label="Energy hatch count"
                >
                  <span className="pb-[3px]">
                    {energyHatchType.exotic
                      ? energyHatchType.chip
                      : `${powerReport?.hatches ?? 1}×`}
                  </span>
                  {hatchChipEntry ? (
                    <EnergyHatchArt entry={hatchChipEntry} boxClass="h-7 w-7" />
                  ) : (
                    <Zap className="h-3.5 w-3.5" style={{ color: tierColor.text }} />
                  )}
                </button>
              ) : null}
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  // No dropdown any more: click steps up, right-click steps
                  // down, wheel walks - the classic cycle, everywhere.
                  updateTier(1);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  // Right click steps the tier down, with or without shift:
                  // requiring shift left plain right click doing nothing,
                  // which read as broken (and Firefox forces its own menu on
                  // shift-right-click, so plain is the one that always works).
                  updateTier(-1);
                }}
                data-hatch-menu-anchor
                onWheel={(event) => {
                  event.stopPropagation();
                  updateTier(event.deltaY < 0 ? 1 : -1);
                }}
                className="nodrag nowheel flex h-6 w-[50px] items-center justify-center border-2 px-1 pb-[3px] text-[11px] font-bold leading-none shadow-[inset_2px_2px_0_rgba(255,255,255,0.55),inset_-2px_-2px_0_rgba(0,0,0,0.45)] hover:brightness-110"
                style={{
                  backgroundColor: tierColor.background,
                  borderColor: tierColor.border,
                  color: tierColor.text,
                  textShadow: `1px 1px 0 ${tierColor.shadow}`,
                }}
                title={powerReport ? undefined : `Tier ${tierControl.current}`}
                aria-label={`Tier ${tierControl.current}`}
              >
                {tierControl.current}
              </button>
            </div>
            </MinecraftTooltip>
            </div>
          ) : null}
        </div>
        </div>
        {/* The picture window sits under the title bar, over the ports:
            the multiblock render (or the machine item), full card width. */}
        {!calmMode && hasPowerPicture && !powerArtHidden ? (
          <PowerStructureWindow
            art={powerArt}
            icon={powerMachineIcon}
            tint={cropStructureArt ? "#4f8c33" : undefined}
          />
        ) : null}
        {/* The card body. No paint of its own: the window behind it is
            already the ramp's face, painted or not. */}
        <div>
          {isCropFarmPlaceholder ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setCropMenuOpen(true);
              }}
              className="nodrag mx-auto my-0 flex h-[80px] w-[240px] items-center justify-center gap-2 border-2 border-dashed border-[var(--mc-33)] bg-[var(--mc-71)] text-[14px] font-bold text-[var(--mc-ink)] hover:bg-[var(--mc-85)]"
            >
              <Sprout className="h-5 w-5" /> Pick a crop
            </button>
          ) : isCustomRatePlaceholder ? (
            <CustomRateUniversalPorts nodeId={projectNode.id} />
          ) : (
          // The rails ARE the node now: ports carry the icons, rates, and
          // health that the recipe canvas used to duplicate. Recipe identity
          // lives in the header (name hover = full machine stats) and in the
          // port icons (click = recipes, right-click = uses).
          <div
            className={[
              "flex items-start gap-1",
              hasInputSideView && hasOutputSideView
                ? "justify-between"
                : hasOutputSideView
                  ? "justify-end"
                  : "justify-start",
            ].join(" ")}
          >
            {showNoInputRow ? (
              <NoFlowRow label="No input" side="input" />
            ) : (
              <PortRail
                nodeId={projectNode.id}
                side="input"
                ports={rails.inputs}
                pending={pendingResourceConnection}
              />
            )}
            {hasInputSideView && hasOutputSideView ? (
              <div className="flex w-4 shrink-0 items-center justify-center self-stretch text-[15px] font-black text-[var(--mc-ink-muted)]">
                →
              </div>
            ) : null}
            {/* A generator's EU is an ordinary output row now (kind "power",
                first on the rail): it wires, it solves, it reads EU/t. */}
            {showNoOutputRow ? (
              <NoFlowRow label="No output" side="output" />
            ) : (
              <PortRail
                nodeId={projectNode.id}
                side="output"
                ports={rails.outputs}
                pending={pendingResourceConnection}
              />
            )}
          </div>
          )}
          {/* The dial is on the card whether it holds a resource or not: an
              empty card still has a number and a direction, and they are what
              the next thing you wire to it starts on. */}
          {customRateDial ? (
            <CustomRatePanel
              nodeId={projectNode.id}
              mode={customRateDial.mode}
              kind={customRateSlot?.resource.kind ?? "item"}
              perSecond={customRateDial.perSecond}
            />
          ) : null}
          {/* The bottom cluster: the config dials (coil tiers, TGS tools,
              crop knobs) and the stat footer, anchored together to the card's
              BOTTOM edge with a 6px inset clearing the frame's bevel. One
              rounded-up block for all of it, so the grid-rounding slack opens
              between the ports and the controls — never below the controls,
              where it read as the card trailing off. Calm mode drops the
              dials and the diagnostics; a custom rate node has no machine
              count, so calm mode drops its footer entirely. */}
          {!isCropFarmPlaceholder &&
          !isCustomRatePlaceholder &&
          (!calmMode || !isCustomRateNode) ? (
            <GridBlock minCells={3} align="end" className="min-w-0">
              {/* A power card's knobs: fuel, tier, rotor, boost - written
                  through setPowerSetting so the owned recipe follows. */}
              {!calmMode && powerInfo ? (
                <PowerConfigPanel
                  nodeId={projectNode.id}
                  sourceId={powerInfo.sourceId}
                  values={projectNode.machineConfigTiers}
                  stats={powerInfo.stats}
                  warnings={powerInfo.warnings}
                />
              ) : null}
              {calmMode ? null : machineConfigPanel}
              {calmMode ? null : passiveProductionPanel}
              <div
                // A hairline over the stats: the knobs are one thing, the
                // verdict below them is another. No background of its own —
                // this strip is card face, and the face is the window behind
                // it. It used to paint itself with the raw tag colour, which
                // left the bottom of a painted card a different shade from
                // the rest of it.
                className="min-w-0 border-t border-[var(--mc-56)] pb-[6px] pt-[6px] text-[14px] leading-5 text-[var(--mc-ink)]"
              >
                {calmMode ? (
                  /* Pure presentation: the count as one large line, centred,
                     on the same bordered tile every other element sits on —
                     bare text floated alone on the card face. The circuit
                     rides beside it, because a presented card is the one
                     somebody builds from and the setting is part of the
                     build. The pair centres together. */
                  <div className="flex min-w-0 items-stretch justify-center gap-1.5">
                    <span className="truncate border border-[var(--mc-47)] bg-[var(--mc-71)] px-3 py-0.5 text-[20px] font-bold leading-6 tabular-nums text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
                      {solveMode
                        ? formatSolvedMachines(result?.theoreticalMachinesRequired ?? 0)
                        : projectNode.machineCount}
                      ×{" "}
                      {isCropProductionNode
                        ? projectNode.machineCount === 1 && !solveMode
                          ? "Seed"
                          : "Seeds"
                        : projectNode.machineCount === 1 && !solveMode
                          ? "Machine"
                          : "Machines"}
                    </span>
                    {programmedCircuit ? <CircuitChip circuit={programmedCircuit} /> : null}
                  </div>
                ) : (
                  <>
                    {parallelChipLifts && !parallelPanelTile ? (
                      // No config panel to ride in: the lifted parallel chip
                      // gets its own slim line, packed right, not a full row
                      // of tiles. See parallelChipLifts.
                      <div className="mb-1 flex min-w-0 justify-end">
                        <Stat
                          label="Parallel"
                          value={`×${formatMachineParallelMultiplier(machineParallelMultiplier)}`}
                        />
                      </div>
                    ) : null}
                    <div
                      className={[
                        "grid min-w-0 items-center gap-1",
                        isCropProductionNode ? CROP_CONFIG_PANEL_WIDTH_CLASS : "",
                      ].join(" ")}
                      // Every cell sizes to its content except MACHINES, which
                      // takes the slack: a four-digit machine count is the one
                      // number here that legitimately gets wide. Parallel
                      // stretched to fill and then truncated its own label
                      // ("Parall…"). Inline, like the head row's: with parallel
                      // and the circuit each free to be absent, the class form is
                      // one spelled-out arbitrary value per combination.
                      style={{
                        gridTemplateColumns: isCustomRateNode
                          ? "auto"
                          : [
                              // Solve mode retires the usage cell: the solved
                              // machine count is the whole reading.
                              ...(solveMode ? [] : ["auto"]),
                              ...(powerInfo && powerInfo.euPerTick < 0 ? ["auto"] : []),
                              ...(powerReport ? ["auto"] : []),
                              ...(steamReport ? ["auto"] : []),
                              ...(cropDrawEuT > 0 ? ["auto"] : []),
                              ...(machineParallelMultiplier > 1 && !parallelChipLifts
                                ? ["auto"]
                                : []),
                              "minmax(84px,1fr)",
                              // The circuit ends the row, square, in the corner
                              // the machine count leaves free.
                              ...(programmedCircuit ? ["auto"] : []),
                            ].join(" "),
                      }}
                    >
                      {!solveMode ? (
                        <UsageStat
                          nodeId={projectNode.id}
                          verdict={verdict}
                          isCustomRate={isCustomRateNode}
                          powerStall={powerReport}
                        />
                      ) : null}
                      {!isCustomRateNode ? (
                        <>
                          {powerInfo && powerInfo.euPerTick < 0 ? (
                            // A parasitic generator's draw speaks the same
                            // language as every machine's: the POWER cell,
                            // plain ink. Red implied a problem where there
                            // is only a bill.
                            <Stat
                              label="Power"
                              value={`${formatCompact(
                                powerDisplayFromEuT(
                                  Math.abs(powerInfo.euPerTick) *
                                    projectNode.machineCount *
                                    Math.max(1, projectNode.parallel) *
                                    drawScale,
                                ),
                              )} ${powerDisplaySuffix()}`}
                            />
                          ) : null}
                          {powerReport ? (
                            <PowerStat
                              report={powerReport}
                              machineCount={projectNode.machineCount}
                              nodeParallel={projectNode.parallel}
                              utilization={result?.utilization}
                              average={averageDraw}
                            />
                          ) : null}
                          {steamReport ? (
                            <SteamStat
                              report={steamReport}
                              machineCount={projectNode.machineCount}
                              nodeParallel={projectNode.parallel}
                              utilization={result?.utilization}
                              average={averageDraw}
                            />
                          ) : null}
                          {cropDrawEuT > 0 ? (
                            // The harvester's draw in the machine's own
                            // language: the POWER cell, riding the PEAK/AVG
                            // switch like every draw figure on the board.
                            <Stat
                              label="Power"
                              value={`${formatCompact(
                                powerDisplayFromEuT(cropDrawEuT * drawScale),
                              )} ${powerDisplaySuffix()}`}
                            />
                          ) : null}
                          {machineParallelMultiplier > 1 && !parallelChipLifts ? (
                            <Stat
                              label="Parallel"
                              value={`×${formatMachineParallelMultiplier(machineParallelMultiplier)}`}
                            />
                          ) : null}
                          {solveMode ? (
                            <SolvedMachinesStat
                              label={isCropProductionNode ? "Seeds" : "Machines"}
                              needed={result?.theoreticalMachinesRequired ?? 0}
                              pinned={projectNode.solvePin}
                              onPin={(solvePin) => updateNode(projectNode.id, { solvePin })}
                            />
                          ) : (
                            <MachineCountStat
                              label={isCropProductionNode ? "Seeds" : "Machines"}
                              machineCount={projectNode.machineCount}
                              onChange={(machineCount) => updateNode(projectNode.id, { machineCount })}
                            />
                          )}
                          {programmedCircuit ? (
                            <CircuitChip circuit={programmedCircuit} />
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            </GridBlock>
          ) : null}
        </div>

        {isCropFarmPlaceholder || isCustomRatePlaceholder || (calmMode && isCustomRateNode) ? (
          /* No bottom cluster: a one-cell chin keeps the last row off the
             frame's inset bevel. Cards WITH the cluster get their clearance
             from its bottom inset instead. */
          <div aria-hidden className="h-[20px]" />
        ) : null}
      </div>
      </div>
    </div>
  );
}

// React Flow hands node components their live position (and dragging state) as
// props, so the default prop comparison fails on every drag frame — which
// re-rendered this entire NEI window per frame while its box moved. The
// component only reads `data` and `selected`; comparing exactly those keeps the
// heavy content inert while the wrapper is translated around it.
export const RecipeNode = memo(
  RecipeNodeComponent,
  (previous, next) => previous.data === next.data && previous.selected === next.selected,
);

/**
 * The machine's circuit slot, in the footer beside the machine count.
 *
 * A dialed circuit is part of the recipe and nothing else on the board said
 * so: it is a non-consumed input, so it never earns a port row, and two cards
 * for the same machine differing only in their setting looked identical. The
 * slot is drawn whether or not it holds anything, because "runs on circuit 11"
 * and "runs on whatever the circuit is set to" are different builds and an
 * absent slot cannot tell them apart.
 */
function CircuitChip({ circuit }: { circuit: RecipeProgrammedCircuit }) {
  const { setting, resource } = circuit;
  return (
    <MinecraftTooltip
      label={setting ? `Circuit set to ${setting}` : "No circuit setting for this recipe"}
    >
      <div
        aria-label={setting ? `Programmed circuit ${setting}` : "No circuit setting"}
        // Square, and as tall as the stat tiles beside it — self-stretch takes
        // the row's height and w-9 answers it, so the slot stays a slot however
        // the footer's type is measured.
        className={[
          "relative flex w-9 shrink-0 self-stretch items-center justify-center overflow-hidden border",
          resource
            ? "border-[var(--mc-47)] bg-[var(--mc-71)] shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]"
            : // Empty reads as a hole in the card, the way an unfilled slot
              // does in the machine's own GUI.
              "border-[var(--mc-47)] bg-[var(--mc-47)] shadow-[inset_1px_1px_0_var(--mc-33),inset_-1px_-1px_0_var(--mc-56)]",
        ].join(" ")}
      >
        {/* The item alone, zoomed past the box and clipped by it — the same
            trick the port rows use. Item sprites ship with transparent padding
            baked in, so drawn at its true size the chip floats in the middle of
            a square instead of filling it. The number is one hover away;
            printed here it only fought the art for the same pixels. */}
        {resource ? (
          <ResourceIcon
            resource={{ ...resource, amount: 1, chance: undefined }}
            bare
            tooltip={false}
            showAmount={false}
            showConsumedState={false}
            className="!h-9 !w-9 origin-center scale-150"
          />
        ) : (
          // Not an item, a silhouette: the same drawn circuit the recipe book
          // card wears, at a fraction of the ink. An empty slot with nothing
          // in it at all reads as art that failed to load rather than as a
          // machine that does not care what its circuit says.
          <Cpu aria-hidden className="h-5 w-5 text-[var(--mc-ink-muted)] opacity-50" />
        )}
      </div>
    </MinecraftTooltip>
  );
}

/**
 * The identity glance: zoomed out the card is ONE BIG ICON on its own
 * background — no name, no figures; at that size text is unreadable anyway.
 * Hovering the card opens the big reveal: name, count and the I/O rates, in
 * a panel that renders at SCREEN size — globals.css scales it by
 * 1/var(--board-zoom), because a viewer parked way out still has to read it.
 *
 * The panel is in the DOM from the start and pure CSS reveals it
 * (globals.css, `.glance-io`): hover must never rebuild the board, and a
 * hover feature is exactly where that rule bites. Everything here is
 * `absolute inset-0` like the other glance layers, so it has no say in the
 * card's size and the router never sees it.
 */
function GlanceIdentityLayer({
  machineIcon,
  artSrc,
  fallbackResource,
  paintTint,
  label,
  inputs,
  outputs,
}: {
  machineIcon?: MachineHandlerIcon;
  /** A full structure render (a power card's picture) beats the item. */
  artSrc?: string;
  fallbackResource?: ResourceAmount;
  /** The card's paint, when painted — it beats the icon's own colour. */
  paintTint?: string;
  label: string;
  inputs: RailPort[];
  outputs: RailPort[];
}) {
  // The LED tile behind the big icon: paint first, then the icon's dominant
  // sprite colour, then neutral steel — deep-dimmed by glanceTileStyle so
  // the icon stays the bright thing.
  const tileTint =
    paintTint ??
    machineIcon?.dominantColor ??
    machineIcon?.iconAtlas?.dominantColor ??
    fallbackResource?.dominantColor ??
    fallbackResource?.iconAtlas?.dominantColor ??
    "#8a93a6";
  return (
    <div
      data-node-detail="glance"
      aria-hidden
      // glance-identity-tile: globals.css holds the rim at constant SCREEN
      // thickness in LED mode, same rule as the drawer and trash borders.
      className="glance-identity-tile pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
      style={{
        ...glanceTileStyle(tileTint),
        // The same rim the storage cards show in LED mode: their real
        // border, the tile's colour a step brighter. A recipe card has
        // no real border - its frame is an inset shadow the tile covers -
        // so the tile draws the rim itself, same formula as the drawers'.
        border: `2px solid color-mix(in srgb, ${tileTint} 55%, #262b34)`,
      }}
    >
      <GlanceMachineArt machineIcon={machineIcon} artSrc={artSrc} fallbackResource={fallbackResource} />
      {/* The reveal. Fixed 560px wide and scaled to screen size by the CSS;
          left-1/2 + origin-top keep its top edge pinned to the card's centre
          at every zoom. Inputs left, arrow, outputs right — the same reading
          order as the card itself zoomed in. */}
      <span className="glance-io absolute left-1/2 top-full z-30 w-[560px] origin-top flex-col gap-2 border-2 border-[var(--mc-15)] bg-[var(--mc-82)] p-3 shadow-[8px_8px_0_rgba(0,0,0,0.55)]">
        {/* The same name bar the card wears zoomed in, at popup scale. */}
        <span className="minecraft-title flex h-8 min-w-0 items-center border-2 border-[var(--mc-33)] bg-[var(--mc-61)] px-2 text-[16px] leading-[22px] shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-29)]">
          <span className="mx-auto min-w-0 truncate">{label}</span>
        </span>
        {inputs.length > 0 || outputs.length > 0 ? (
          /* Two fixed halves with the arrow between, exactly like the rails:
             an outputs-only card keeps its chips on the RIGHT over an empty
             left half rather than stretching across the whole panel. */
          <span className="grid grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] items-start gap-x-1">
            <span className="flex min-w-0 flex-col gap-1">
              {inputs.map((port) => (
                <GlanceIoRow key={port.key} port={port} />
              ))}
            </span>
            <span className="flex items-start justify-center pt-2 text-[20px] font-black leading-6 text-[var(--mc-ink-muted)]">
              →
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              {outputs.map((port) => (
                <GlanceIoRow key={port.key} port={port} />
              ))}
            </span>
          </span>
        ) : null}
      </span>
    </div>
  );
}

/**
 * The zoomed-out machine art, shared by every glance view: the identity tile
 * carries it full-size, and the stat views (speed, usage, power) sit it to
 * the LEFT of their figure so a coloured card still says which machine it is
 * talking about. Two literal sizes rather than a number, because Tailwind
 * only emits arbitrary-value classes it can see written out.
 */
function GlanceMachineArt({
  machineIcon,
  fallbackResource,
  artSrc,
  small = false,
}: {
  machineIcon?: MachineHandlerIcon;
  fallbackResource?: ResourceAmount;
  /** A full structure render (the power picker's banners) beats the item. */
  artSrc?: string;
  small?: boolean;
}) {
  // A quiet drop shadow lifts the art off the card. In board pixels, so it
  // has to be generous enough to survive the LOD zoom-out — at 0.4 zoom
  // these six pixels read as two.
  const shadow = "drop-shadow-[4px_6px_5px_rgba(0,0,0,0.45)]";
  const box = small ? "!h-[112px] !w-[112px]" : "!h-[192px] !w-[192px]";
  const pixels = small ? 112 : 192;
  if (artSrc) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={artSrc}
        alt=""
        draggable={false}
        className={["object-contain [image-rendering:pixelated]", box, shadow].join(" ")}
      />
    );
  }
  if (machineIcon) {
    return (
      <ResourceIcon
        resource={{ ...machineIcon, amount: 1 }}
        size="sm"
        bare
        showAmount={false}
        tooltip={false}
        className={[box, shadow].join(" ")}
        iconPixelSize={machineArtPixels(pixels)}
      />
    );
  }
  if (!fallbackResource) {
    return null;
  }
  return (
    <span className={["flex items-center justify-center overflow-hidden", box, shadow].join(" ")}>
      <ResourceIcon
        resource={{ ...fallbackResource, amount: 1, chance: undefined }}
        size="sm"
        bare
        showAmount={false}
        tooltip={false}
        // The glance face is measured, not zoom-cropped: the 1.5x trick
        // the rows use overflows the box and reads as art spilling off the
        // card at LOD.
        iconPixelSize={
          isSwatchFluid(fallbackResource)
            ? pixels
            : fallbackResource.kind === "fluid"
              ? fluidArtPixels(pixels)
              : spriteArtPixels(pixels)
        }
        className={box}
      />
    </span>
  );
}

/**
 * An energy reading as a number with a small grey tail: "200" and then
 * "EU/Item" a size down in the same amber. The number carries the eye and
 * the eye; the unit only has to be there.
 */
function EnergyReading({
  euPerUnit,
  kind,
  unitSize,
}: {
  euPerUnit: number;
  kind: string;
  /** The tail's font size in px, two down from the number's. */
  unitSize: number;
}) {
  const parts = formatEnergyPerUnitParts(euPerUnit, kind);
  return (
    <>
      {parts.value}
      <span className={ENERGY_UNIT_TEXT} style={{ fontSize: unitSize }}>
        {parts.unit}
      </span>
    </>
  );
}

/** One chip of the hover reveal, in the card's own chip clothes. */
function GlanceIoRow({ port }: { port: RailPort }) {
  return (
    <span className="flex items-center gap-1.5 border-2 border-[var(--mc-47)] bg-[var(--mc-71)] px-1 py-0.5 shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
      {/* Same crop treatment as a port chip: items ship transparent padding
          in the sprite, so they zoom 1.5× inside an overflow-hidden box;
          fluids are a solid square with nothing to crop. */}
      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden">
        {port.resource ? (
          <ResourceIcon
            resource={{ ...port.resource, amount: 1, chance: undefined }}
            size="sm"
            bare
            showAmount={false}
            tooltip={false}
            iconPixelSize={
              port.kind === "fluid"
                ? isSwatchFluid(port.resource)
                  ? 50
                  : fluidArtPixels(36)
                : undefined
            }
            className={port.kind === "fluid" ? "!h-9 !w-9" : "!h-9 !w-9 origin-center scale-150"}
          />
        ) : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] font-bold leading-[17px] text-[var(--mc-ink)]">
          {port.displayName}
        </span>
        <span
          className={[
            "truncate text-[13px] leading-4 tabular-nums",
            portReadsEnergy(port) ? ENERGY_READING_TEXT : "text-[var(--mc-ink-muted)]",
          ].join(" ")}
        >
          {portReadsEnergy(port) ? (
            <EnergyReading euPerUnit={port.energyPerUnit!} kind={port.kind} unitSize={10} />
          ) : (
            formatPortRate(port, port.currentPerSecond)
          )}
        </span>
      </span>
    </span>
  );
}

/**
 * One word for the node's state, and how loudly it is worth saying.
 *
 * The ladder is the point: plain ink for a card with nothing to answer for,
 * then muted gold, amber and red as the answer gets more urgent. A machine at
 * 40% that hands every asker what it asked for has done nothing wrong and
 * reads as quietly as one at 100% — the percent is a speed, not a grade.
 */
interface VerdictWord {
  word: string;
  /** fine = nothing to do. Then: nobody waiting, waiting on upstream, ACT. */
  tone: "fine" | "starved" | "blocked" | "bottleneck" | "clogged" | "unwired";
}

function verdictWord(
  verdict: NodeVerdict,
  isCustomRate: boolean,
  powerStalled = false,
): VerdictWord {
  // A build the game would refuse outranks every flow story: whatever the
  // wires say, the reason nothing moves is the power setup.
  if (powerStalled) {
    return { word: "no power", tone: "unwired" };
  }
  switch (verdict.kind) {
    case "starved":
      return { word: "starved", tone: "starved" };
    // Its own colour, and deliberately not a red one: nothing here is broken.
    // The machine is doing the only thing it can with a surplus nobody wants.
    case "clogged":
      return { word: "clogged", tone: "clogged" };
    case "blocked":
      return { word: "blocked", tone: "blocked" };
    case "bottleneck":
      return { word: "bottleneck", tone: "bottleneck" };
    // Red, like a bottleneck, and for the same reason: this is a place the
    // chain of blame STOPS. Any machine in the ring is a valid place to act.
    case "dead-loop":
      return { word: "dead loop", tone: "bottleneck" };
    // Blue, the clog family's colour: nothing is broken or starving, the
    // line is FULL. Its own word, because the fix is a drawer, not a feeder.
    case "clog-lock":
      return { word: "clog lock", tone: "clogged" };
    case "demand-set":
      return verdict.pct <= 0.05
        ? { word: "unused", tone: "fine" }
        : { word: isCustomRate ? "under the dial" : "on demand", tone: "fine" };
    // Calm on purpose: inputs covered, nothing jammed, the machines around
    // it set the speed. Nothing here needs fixing.
    case "paced":
      return { word: "paced", tone: "fine" };
    case "balanced":
      return { word: isCustomRate ? "at the dial" : "full", tone: "fine" };
    case "unwired":
      return { word: "no wires", tone: isCustomRate ? "fine" : "unwired" };
    case "off":
      return { word: "off", tone: "fine" };
    case "no-recipe":
      return { word: "no recipe", tone: "fine" };
  }
}

const VERDICT_WORD_CLASS: Record<VerdictWord["tone"], string> = {
  fine: "text-[var(--mc-ink-muted)]",
  starved: "font-bold text-[var(--verdict-starved-ink)]",
  blocked: "font-bold text-[var(--verdict-blocked-ink)]",
  bottleneck: "font-bold text-[var(--verdict-bottleneck-ink)]",
  clogged: "font-bold text-[var(--verdict-clogged-ink)]",
  unwired: "font-bold text-[var(--verdict-unwired-ink)]",
};

/**
 * The usage view's card colour per tone — the same hues the
 * --verdict-*-ink variables carry in globals.css, restated here because the
 * card wash is mixed in JS. `fine` stays neutral: a card with nothing to
 * answer for should read calm, not painted.
 */
const GLANCE_TONE_BASE: Record<VerdictWord["tone"], string | undefined> = {
  fine: undefined,
  starved: "#b3ae76",
  blocked: "#e0a63a",
  bottleneck: "#e05252",
  clogged: "#6fb2d6",
  unwired: "#eef2f8",
};

function glanceToneSurface(tone: VerdictWord["tone"]): NodeSurfaceColor {
  const base = GLANCE_TONE_BASE[tone];
  return base ? glanceSurfaceFor(base) : GLANCE_NEUTRAL_SURFACE;
}

/** The card's whole draw — every machine on it, every parallel — same
 * arithmetic as the footer's POWER cell and the shopping list row. */
function powerDrawEuT(report: NodePowerReport, node: FactoryNode): number {
  return report.drawEuT * node.machineCount * node.parallel;
}

/**
 * What a draw figure is multiplied by under the PEAK/AVG switch. PEAK shows
 * the full draw for anything that runs at all and 0 for a machine at exactly
 * 0%, which never starts; AVG weights the draw by the solve's usage. An
 * unknown usage counts as running flat out.
 */
function drawScaleFor(average: boolean, utilization: number | undefined): number {
  const usage = Math.min(1, Math.max(0, utilization ?? 1));
  return average ? usage : usage > 0 ? 1 : 0;
}

/** A steam card's whole burn in L/s, the unit boilers are sized against. */
function steamDrawLitresPerSecond(
  report: NodeSteamReport,
  node: Pick<FactoryNode, "machineCount" | "parallel">,
): number {
  return report.drawSteamPerTick * 20 * node.machineCount * node.parallel;
}

/**
 * The power glance figure's font size in pixels. The mono face at weight 900
 * runs wide, and beside the machine art the line has roughly 220px of card
 * to live in — so every glyph past three buys the whole line a step down,
 * keeping "9.99M EU/t" inside the frame.
 */
function powerGlanceValueSize(compact: string): number {
  if (compact.length <= 3) {
    return 52;
  }
  return compact.length === 4 ? 46 : 40;
}

/**
 * USAGE: the widest cell in the footer, carrying the number and one word for
 * why it reads that way. It replaced a four-line colored strip, and the two
 * rules that came out of that are worth keeping:
 *
 * - never a third line. The footer repeats on every node, so a line spent
 *   here is a line spent on the whole board; the fix note rides beside the
 *   USAGE label instead of below the number.
 * - the number is never colored. A node at 100% that still can't cover its
 *   asks proves the speed and the problem are different facts — color lives
 *   on the state word, which is the thing that says where to act.
 *
 * Everything longer (the honest rates, the culprit's own machine count, the
 * ladder of what caps this next) lives in the hover.
 */
function UsageStat({
  nodeId,
  verdict,
  isCustomRate = false,
  powerStall,
}: {
  nodeId: string;
  verdict: NodeVerdict;
  isCustomRate?: boolean;
  /** Set when the power setup cannot start the build; owns the word AND the hover. */
  powerStall?: NodePowerReport;
}) {
  const stalled = powerStall !== undefined && powerStall.state !== "ok";
  const state = verdictWord(verdict, isCustomRate, stalled);
  const showPct = verdict.kind !== "off" && verdict.kind !== "no-recipe";

  return (
    <MinecraftTooltip
      content={
        stalled && powerStall ? (
          // The power story replaces the flow story outright: whatever the
          // wires would say, nothing moves until the power fits.
          <div className="w-60">
            <div className="text-[13px] font-semibold text-white">
              {powerStall.state === "under-powered"
                ? "The hatches can't carry it"
                : "The recipe is above this tier"}
            </div>
            <div className="mt-0.5 text-[11px] leading-4 text-slate-300">
              {describePowerStall(powerStall)}
            </div>
          </div>
        ) : (
          <VerdictHoverContent verdict={verdict} isCustomRate={isCustomRate} />
        )
      }
    >
      {/* One card, one divider: the number and the word are the same
          sentence — how hard it runs, and why. Two boxes read as two facts. */}
      <div className="flow-usage-stat flex min-w-0 border border-[var(--mc-47)] bg-[var(--mc-71)] shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
        <div className="min-w-0 px-1.5">
          <div className="text-[11px] uppercase leading-[13px] text-[var(--mc-ink-muted)]">
            Usage
          </div>
          <div className="text-[17px] font-bold leading-5 tabular-nums">
            {showPct ? (
              <>
                {/* Whole numbers — a decimal on a duty cycle is width, not
                    information. The exception is a node that runs so slowly it
                    would round to a flat 0% and read as dead. Eased on the
                    value-motion clock, so the machine visibly winds up. */}
                <MotionNumberText
                  values={[verdict.pct]}
                  render={(shown) => {
                    const pct = shown[0] ?? verdict.pct;
                    return pct > 0 && pct < 0.5 ? formatRate(pct, 1) : formatPct(pct);
                  }}
                />
                <span className="text-[13px]">%</span>
              </>
            ) : (
              <span className="text-[13px] text-[var(--mc-ink-muted)]">—</span>
            )}
          </div>
        </div>
        <div className="my-0.5 w-px shrink-0 bg-[var(--mc-47)]" />
        {/* verdict-reason-cell: on an unwired card the WHOLE cell breathes,
            label and all, not just the word inside it. */}
        <div className="verdict-reason-cell min-w-0 px-1.5">
          <div className="text-[11px] uppercase leading-[13px] text-[var(--mc-ink-muted)]">
            Reason
          </div>
          <div
            className={[
              // verdict-word: the pulse on an unwired card hangs off this
              // (globals.css), so the word and the bare slots it refers to
              // breathe on one clock.
              "verdict-word truncate text-[13px] font-bold uppercase leading-5 tracking-[0.4px]",
              VERDICT_WORD_CLASS[state.tone],
            ].join(" ")}
          >
            {state.word}
          </div>
        </div>
      </div>
    </MinecraftTooltip>
  );
}

/**
 * The strip's hover: the sentence you'd say out loud, then where to act with
 * the culprit's OWN machine count, then the ladder — what caps this next and
 * where it lands once today's wall is gone.
 */
function VerdictHoverContent({
  verdict,
  isCustomRate,
}: {
  verdict: NodeVerdict;
  isCustomRate: boolean;
}) {
  const title = verdictHoverTitle(verdict, isCustomRate);
  const detail = verdictHoverDetail(verdict, isCustomRate);

  // Two lines: what this card is doing, and why it reads that way. Nothing
  // else. This used to carry a fix note and a four-rung ladder of what caps
  // the card next, which is a briefing rather than a hover - by the time you
  // have read it you have forgotten what you pointed at. The marks on the card
  // already say where to act; the hover only has to name the state.
  return (
    <div className="w-60">
      <div className="text-[13px] font-semibold text-white">{title}</div>
      {detail ? <div className="mt-0.5 text-[11px] leading-4 text-slate-300">{detail}</div> : null}
    </div>
  );
}

/**
 * The unwired card names the slots, because that IS the whole story: every
 * one of them is a wire you have not drawn yet, and the card has already
 * marked them. Counts rather than a list once there are more than a couple,
 * so a twelve-slot multiblock does not write a paragraph.
 */
function unwiredTitle(verdict: NodeVerdict): string {
  const inputs = verdict.bare?.inputs ?? [];
  const outputs = verdict.bare?.outputs ?? [];
  const total = inputs.length + outputs.length;
  if (total === 0) {
    return "Nothing is wired to it";
  }
  if (total === 1) {
    const only = inputs[0] ?? outputs[0]!;
    return inputs.length === 1
      ? `Nothing supplies the ${only.displayName}`
      : `Nothing takes the ${only.displayName}`;
  }
  return `${total} slots have no wire`;
}

function unwiredDetail(verdict: NodeVerdict): string {
  const inputs = verdict.bare?.inputs ?? [];
  const outputs = verdict.bare?.outputs ?? [];
  const name = (list: typeof inputs) =>
    list.length <= 2 ? list.map((entry) => entry.displayName).join(" and ") : `${list.length} of them`;

  const parts: string[] = [];
  if (inputs.length > 0) {
    parts.push(`nothing supplies ${name(inputs)}`);
  }
  if (outputs.length > 0) {
    parts.push(`nothing takes ${name(outputs)}`);
  }
  const marked = parts.join(", and ");
  return `A machine runs on what arrives and stops when what it makes has nowhere to go, so ${marked}. Wire each marked slot to a machine, or to a SOURCE or DRAIN drawer to say you handle that end yourself.`;
}

function verdictHoverTitle(verdict: NodeVerdict, isCustomRate: boolean): string {
  switch (verdict.kind) {
    case "starved":
      return `Short on ${verdict.binding?.displayName ?? "an input"}`;
    case "blocked":
      return `Waiting on ${verdict.binding?.displayName ?? "an input"}`;
    case "bottleneck":
      return isCustomRate ? "Asked for more than the dialed rate" : "Asked for more than it makes";
    case "clogged":
      return `Nowhere to put the ${verdict.clog?.displayName ?? "spare output"}`;
    case "dead-loop":
      return verdict.spiral ? describeDeathSpiral(verdict.spiral).title : "Stuck in a loop";
    case "clog-lock":
      return verdict.clogLock && verdict.clogLockNodeId
        ? describeClogLockForNode(verdict.clogLock, verdict.clogLockNodeId).title
        : "Choking on a surplus";
    case "demand-set":
      return verdict.pct <= 0.05 ? "Nothing draws from this yet" : "Makes only what gets taken";
    case "paced":
      return "Runs at the speed of the machines around it";
    case "balanced":
      return isCustomRate ? "Dialed rate met exactly" : "Full speed, all asks met";
    case "unwired":
      return isCustomRate ? "No wires on this dial" : unwiredTitle(verdict);
    case "off":
      return "Disabled";
    case "no-recipe":
      return "No recipe";
  }
}

function verdictHoverDetail(verdict: NodeVerdict, isCustomRate: boolean): string | undefined {
  switch (verdict.kind) {
    case "starved":
    case "blocked": {
      const binding = verdict.binding;
      if (!binding) {
        return undefined;
      }
      // One sentence of numbers, one of consequence. The guard in
      // deriveNodeVerdict promises supplied < needed here, so the numbers
      // can never argue with the word above them.
      const supplied = formatSlotRate(binding.suppliedPerSecond, binding.kind);
      const needed = formatSlotRate(binding.neededPerSecond, binding.kind);
      const tied = binding.tiedWithNames?.length
        ? ` Tied with ${binding.tiedWithNames.join(", ")}.`
        : "";
      const cost =
        verdict.kind === "starved"
          ? " Nothing it feeds goes short."
          : " The machines it feeds go short because of it.";
      return `Gets ${supplied} of the ${needed} it could eat.${cost}${tied}`;
    }
    case "bottleneck": {
      const deficit = verdict.deficit;
      if (!deficit) {
        return undefined;
      }
      const missing = formatSlotRate(deficit.missingPerSecond, deficit.kind);
      return `${missing} short on ${deficit.displayName}. More machines here would cover it.`;
    }
    case "clogged": {
      const clog = verdict.clog;
      if (!clog) {
        return undefined;
      }
      const spare = formatSlotRate(clog.surplusPerSecond, clog.kind);
      if (clog.stoppedTakerName) {
        return `Nothing takes the ${clog.displayName}: ${clog.stoppedTakerName} has stopped. Its own card says why.`;
      }
      if (clog.takenPerSecond <= 0.0005) {
        return `Nothing takes the ${clog.displayName}. A machine cannot run with a full output.`;
      }
      return `The spare ${spare} of ${clog.displayName} has nowhere to go. That holds it at ${formatPct(verdict.pct)}%.`;
    }
    case "dead-loop": {
      if (!verdict.spiral) {
        return undefined;
      }
      const story = describeDeathSpiral(verdict.spiral);
      return `${story.short} ${story.fix}`;
    }
    case "clog-lock": {
      if (!verdict.clogLock || !verdict.clogLockNodeId) {
        return undefined;
      }
      return describeClogLockForNode(verdict.clogLock, verdict.clogLockNodeId).detail;
    }
    case "demand-set":
      return "The machines it feeds are not taking more, so it does not make more. Nothing here needs fixing.";
    case "paced":
      return "Its ingredients arrive and its outputs move. Nothing here needs fixing.";
    case "balanced":
      return isCustomRate ? undefined : "Fed, full, and everything it makes gets taken.";
    case "unwired":
      return isCustomRate
        ? "This dial does nothing until something is wired to it."
        : unwiredDetail(verdict);
    default:
      return undefined;
  }
}


/**
 * A block that is always a whole number of grid cells tall, and always tall
 * enough for what is inside it.
 *
 * The rails and the head are deterministic — a port row is 40px because we say
 * so — but the footer and the config panels hold text and controls whose height
 * depends on the recipe, the machine and the browser's font metrics. Pinning
 * those to a fixed height is what made stats hang out of the bottom of the
 * card. So they measure instead, and round UP: never compress to fit the grid,
 * take another cell.
 *
 * The observer fires when the content's own height changes — a different
 * recipe, a wider number — not on drags, hovers or frames, so it costs nothing
 * in the cases the board's performance is judged on.
 */
function GridBlock({
  children,
  className,
  minCells = 2,
  style,
  align = "center",
  clearancePx = 0,
}: {
  children: ReactNode;
  className?: string;
  /** Floor, in cells. Two is the standard block. */
  minCells?: number;
  style?: CSSProperties;
  /** Where content sits in the rounded-up block. The footer bottom-aligns. */
  align?: "start" | "center" | "end";
  /**
   * Extra height the measurement must reserve beyond the content itself —
   * the caller's own padding and border, which scrollHeight cannot see.
   * Without it a content height near a cell boundary would round to a block
   * the padding no longer fits in.
   */
  clearancePx?: number;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [cellCount, setCellCount] = useState(minCells);

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) {
      return;
    }
    const measure = () => {
      const needed = Math.ceil((element.scrollHeight + clearancePx) / BOARD_GRID - 0.001);
      const next = Math.max(minCells, needed);
      setCellCount((current) => (current === next ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [clearancePx, minCells]);

  return (
    <div className={className} style={{ ...style, height: cellCount * BOARD_GRID }}>
      {/* The measured div must be free to size to its content, or its own
          scrollHeight would just report the height we gave it and the block
          could never shrink again. The aligning wrapper takes the fixed
          height; the child stays auto. */}
      <div
        className={
          align === "end"
            ? "flex h-full flex-col justify-end"
            : align === "start"
              ? "flex h-full flex-col justify-start"
              : "flex h-full flex-col justify-center"
        }
      >
        <div ref={contentRef}>{children}</div>
      </div>
    </div>
  );
}

/** Input chip width, shared by the input rail and the output rail's chip. */
export const PORT_CHIP_WIDTH_CLASS = "w-[140px]";

/**
 * One side of the port rails. Every port always renders - a hidden port is a
 * port somebody can't wire, so tall nodes are the accepted trade for big
 * recipes. Rows on both rails share one height so input, output, and plug
 * line up straight across the node.
 */
function PortRail({
  nodeId,
  side,
  ports,
  pending,
}: {
  nodeId: string;
  side: "input" | "output";
  ports: RailPort[];
  pending: ReturnType<typeof useFactoryStore.getState>["pendingResourceConnection"];
}) {
  if (ports.length === 0) {
    return null;
  }

  const isInput = side === "input";
  return (
    <div
      className={[
        // No gap between rows: the row IS the grid unit (40px = two cells),
        // and a gap would put every row after the first off the grid.
        "flex shrink-0 flex-col justify-start gap-0 py-0",
        // Half the old rails. The rate text under each name was the thing that
        // demanded 210px of chip; with it gone the name is the only wide thing
        // left, and a truncated name plus a hover beats a board you can't fit.
        // The output rail is chip (140) + 2px gap + the coupling (34, in
        // globals.css) — anything wider and the couplings hang off the card.
        isInput ? PORT_CHIP_WIDTH_CLASS : "w-[176px]",
      ].join(" ")}
    >
      {ports.map((port) =>
        isInput ? (
          <PortChip key={port.key} nodeId={nodeId} port={port} pending={pending} />
        ) : (
          <OutputSocketRow key={port.key} nodeId={nodeId} port={port} pending={pending} />
        ),
      )}
    </div>
  );
}

/**
 * A power card's bare side: the same footprint as a port row, dashed and
 * muted, saying plainly that there is nothing to wire here. Inert on
 * purpose - it is the absence of a port, not a port.
 */
function NoFlowRow({ label, side }: { label: string; side: "input" | "output" }) {
  // Input chips are 140px and output rows 176 (chip + coupling): the stand-in
  // must match its side's width or it shoves the other rail off the card.
  return (
    <div
      aria-hidden
      className={[
        "flex h-[40px] shrink-0 items-center justify-center border-2 border-dashed border-[var(--mc-47)] text-[12px] font-bold text-[var(--mc-ink-muted)]/70",
        side === "input" ? PORT_CHIP_WIDTH_CLASS : "w-[176px]",
      ].join(" ")}
    >
      {label}
    </div>
  );
}

const POWER_ART_COLLAPSED_KEY = "gtnh-factory-flow.power-art-collapsed.v1";

function readPowerArtCollapsed(nodeId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(POWER_ART_COLLAPSED_KEY);
    return raw ? (JSON.parse(raw) as string[]).includes(nodeId) : false;
  } catch {
    return false;
  }
}

function writePowerArtCollapsed(nodeId: string, collapsed: boolean) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(POWER_ART_COLLAPSED_KEY);
    const ids = new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
    if (collapsed) {
      ids.add(nodeId);
    } else {
      ids.delete(nodeId);
    }
    // The list only ever grows by cards someone deliberately folded; cap it
    // so a long-lived browser profile never accumulates unbounded ids.
    window.localStorage.setItem(POWER_ART_COLLAPSED_KEY, JSON.stringify([...ids].slice(-200)));
  } catch {
    // Storage unavailable: the toggle still holds for this session.
  }
}

/**
 * The picture window: the workbook's own multiblock render (a singleblock
 * shows its machine item), spanning the card between the title bar and the
 * ports, on a recessed ground from the card's own palette with a whisper
 * of the power amber - there to help you see the thing you are planning.
 * The header's picture button hides it entirely; hidden, nothing renders.
 * Height plus the breathing room below stays a whole number of grid cells.
 */
function PowerStructureWindow({
  art,
  icon,
  tint = "#d99a2b",
}: {
  art?: string;
  icon?: PowerMachineIcon;
  /** The sector's colour behind the render: power amber, crop green. */
  tint?: string;
}) {
  if (!art && !icon?.iconPath) {
    return null;
  }
  return (
    <div
      className="box-border mb-2 flex h-[112px] w-full items-center justify-center overflow-hidden border-2 border-[var(--mc-47)] p-1 shadow-[inset_2px_2px_0_rgba(0,0,0,0.3),inset_-2px_-2px_0_rgba(255,255,255,0.04)]"
      style={{ backgroundColor: `color-mix(in srgb, var(--mc-33) 92%, ${tint} 8%)` }}
    >
      {art ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={art}
          alt=""
          draggable={false}
          className="max-h-full max-w-full object-contain [image-rendering:pixelated]"
        />
      ) : (
        <ResourceIcon
          resource={{
            kind: "item",
            id: icon!.id,
            amount: 1,
            displayName: icon!.displayName,
            iconPath: icon!.iconPath,
            dominantColor: icon!.dominantColor,
          }}
          bare
          tooltip={false}
          showAmount={false}
          showConsumedState={false}
          // Same zoom-and-crop ratio the picker's banner uses, scaled to
          // this window's height: the render's padding goes, its face stays.
          iconPixelSize={170}
          className="!h-[100px] !w-[100px]"
        />
      )}
    </div>
  );
}

/**
 * A power card's header tier chip, with the classic gestures: click steps
 * up, right click steps down, wheel scrolls, wrapping at the ends of the
 * family's own ladder (an LV-HV steam turbine cycles those three). Writes
 * through setPowerSetting so the card's recipe follows. Sources without a
 * tier knob wear their unlock tier as a static chip.
 */
function PowerTierChip({
  nodeId,
  sourceId,
  values,
}: {
  nodeId: string;
  sourceId: string;
  values: Record<string, string> | undefined;
}) {
  const setPowerSetting = useFactoryStore((state) => state.setPowerSetting);
  const source = getPowerSource(sourceId);
  if (!source) {
    return null;
  }
  const setting = source.settings.find(
    (entry): entry is PowerSelectSetting => entry.type === "select" && entry.id === "tier",
  );
  const shownTier = setting
    ? values?.tier && setting.options.some((option) => option.key === values.tier)
      ? values.tier
      : setting.defaultKey
    : source.unlock;
  const color = shownTier && shownTier in GT_TIER_COLORS
    ? GT_TIER_COLORS[shownTier as keyof typeof GT_TIER_COLORS]
    : undefined;
  if (!shownTier || !color) {
    return null;
  }
  const chipStyle = {
    backgroundColor: color.background,
    borderColor: color.border,
    color: color.text,
    textShadow: `1px 1px 0 ${color.shadow}`,
    textDecoration: color.underline ? "underline" : undefined,
  };
  if (!setting) {
    return (
      // No text-size utility on purpose: the interactive chips are BUTTONS,
      // and the unlayered `button { font: inherit }` in globals.css beats
      // their text-[11px], so they render at the card's base size. A span
      // must simply inherit to match them.
      <span
        className="flex h-6 w-[50px] items-center justify-center border-2 px-1 pb-[3px] font-bold leading-none shadow-[inset_2px_2px_0_rgba(255,255,255,0.55),inset_-2px_-2px_0_rgba(0,0,0,0.45)]"
        style={chipStyle}
        title={`Unlocks at ${shownTier}`}
      >
        {shownTier}
      </span>
    );
  }
  const index = Math.max(0, setting.options.findIndex((option) => option.key === shownTier));
  const step = (delta: number) => {
    // Clamped, never wrapped: every tier ladder on the board stops at its
    // ends (the machine chips, the power unit dial), and this one looping
    // from MAX back to the floor read as broken.
    const next = setting.options[Math.min(setting.options.length - 1, Math.max(0, index + delta))];
    if (next && next.key !== shownTier) {
      setPowerSetting(nodeId, "tier", next.key);
    }
  };
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        step(1);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        step(-1);
      }}
      onWheel={(event) => {
        event.stopPropagation();
        step(event.deltaY < 0 ? 1 : -1);
      }}
      className="nodrag nowheel flex h-6 w-[50px] items-center justify-center border-2 px-1 pb-[3px] text-[11px] font-bold leading-none shadow-[inset_2px_2px_0_rgba(255,255,255,0.55),inset_-2px_-2px_0_rgba(0,0,0,0.45)] hover:brightness-110"
      style={chipStyle}
      title={`Tier ${shownTier}`}
      aria-label={`Tier ${shownTier}`}
    >
      {shownTier}
    </button>
  );
}

/**
 * A power card's EU, worn as the FIRST output row: the product of a
 * generator is power, so it sits where the products sit, lightning bolt for
 * a face. The coupling slot is deliberately inert - nothing wires to power
 * yet - but the row already holds the place wires will land.
 */
function PowerEuSocketRow({
  euPerTick,
  machines,
  drawScale,
  average,
}: {
  euPerTick: number;
  machines: number;
  /** The PEAK/AVG switch, applied like every other EU figure's; a stalled
   * generator makes 0 EU/t under both readings. */
  drawScale: number;
  /** Which reading the switch has picked, named beside the EU title so the
   * figure says what it is. */
  average: boolean;
}) {
  const totalEuT = euPerTick * machines * drawScale;
  return (
    <div className="relative flex items-stretch">
      <MinecraftTooltip label="Power this card makes. Power does not wire to machines yet; it counts in POWER MADE, bottom right.">
        <div
          className={`flow-port relative flex h-[40px] ${PORT_CHIP_WIDTH_CLASS} flex-none items-center gap-1 px-0.5 py-0`}
        >
          <span className="pointer-events-none relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden">
            <span className="flex h-7 w-7 items-center justify-center border border-[var(--mc-47)] bg-[var(--mc-55)]">
              <Zap className="h-4 w-4 text-amber-300" aria-hidden />
            </span>
          </span>
          <span className="flex min-w-0 flex-1 flex-col justify-center pr-0.5">
            <span className="block truncate text-[11px] font-bold leading-[13px] text-[var(--mc-ink)]">
              EU{" "}
              <span className="text-[9px] font-normal text-[var(--mc-ink-muted)] opacity-75">
                ({average ? "avg" : "peak"})
              </span>
            </span>
            <span className="block truncate text-[10px] leading-[12px] tabular-nums text-amber-200/90">
              <MotionNumberText
                values={[totalEuT]}
                render={(shown) =>
                  `${formatCompact(powerDisplayFromEuT(shown[0] ?? totalEuT))} ${powerDisplaySuffix()}`
                }
              />
            </span>
          </span>
        </div>
      </MinecraftTooltip>
      <span className="flow-socket-empty">
        <Zap className="h-3 w-3 text-amber-300/60" aria-hidden />
      </span>
    </div>
  );
}

/**
 * An output row: the maker chip plus the coupling chip at the node's right
 * edge — inside the card, like inputs. The row is the edge anchor, so wires
 * reach the coupling the same way they reach an input chip.
 */
export function OutputSocketRow({
  nodeId,
  port,
  pending,
}: {
  nodeId: string;
  port: RailPort;
  pending: ReturnType<typeof useFactoryStore.getState>["pendingResourceConnection"];
}) {
  const setHoveredFlowScope = useFactoryStore((state) => state.setHoveredFlowScope);
  return (
    <div
      className="relative flex items-stretch"
      data-resource-edge-anchor="true"
      data-resource-node-id={nodeId}
      data-resource-handle-id={port.handleId}
      // Wiring is a mode: a held wire must not also be lighting up slots.
      onPointerEnter={() =>
        isWiringConnection() ? undefined : setHoveredFlowScope(buildPortFlowScope(nodeId, port))
      }
      onPointerLeave={() => setHoveredFlowScope(undefined)}
    >
      <PortChip nodeId={nodeId} port={port} pending={pending} plugRow />
      {port.plug ? (
        <PlugBlock nodeId={nodeId} port={port} />
      ) : (
        <MinecraftTooltip
          label={
            port.nameplatePerSecond <= 0
              ? "Empty socket: nothing plugged in."
              : port.boundaryFree
                ? "Free outputs is on, so this leaves the setup."
                : "Nothing takes this, so it backs up and the machine stops. Wire it to a machine that wants it, a DRAIN drawer, or a trash can."
          }
        >
          {/* The mirror of an input's NO SUPPLY. It used to read "—" beside a
              tooltip saying the output vanished, which is exactly the thing
              that stopped being true when the plan became a closed system.
              With FREE OUTPUTS on it is true again, so the mark comes off. */}
          <span className="flow-socket-empty nodrag">
            <PlugDragHandle nodeId={nodeId} port={port} />
            {port.nameplatePerSecond > 0 && !port.boundaryFree ? (
              <span className="text-[7px] font-black leading-3 tracking-[0.5px] text-[var(--verdict-unwired-ink)]">
                NO TAKER
              </span>
            ) : (
              "—"
            )}
          </span>
        </MinecraftTooltip>
      )}
    </div>
  );
}

/**
 * A second source handle over the coupling chip, sharing the port's handle
 * id — a connection dropped on either reads the same port. Geometry is
 * unaffected: edges anchor off the row's `data-resource-edge-anchor`, not
 * React Flow's handle bounds.
 */
function PlugDragHandle({ nodeId, port }: { nodeId: string; port: RailPort }) {
  return (
    <Handle
      id={port.handleId}
      type="source"
      position={Position.Right}
      data-resource-handle="true"
      data-resource-node-id={nodeId}
      data-resource-handle-id={port.handleId}
      title={`Drag to wire ${port.displayName}`}
      className={[
        "resource-slot-handle nodrag !absolute !left-0 !right-auto !top-0 !z-10 !h-full !w-full !min-w-0 !translate-x-0 !translate-y-0",
        "!rounded-none !border-0 !bg-transparent !opacity-0 cursor-crosshair",
      ].join(" ")}
    />
  );
}

/** Where a dead-end output actually ends. Trash destroys; the rest keeps. */
// A dead-end drawer is a DRAIN now — the same word its own card wears, so the
// plug and the thing it points at cannot be read as two different ideas.
const PLUG_DUMP_WORD: Record<"trash" | "tank" | "store", string> = {
  trash: "TRASH",
  tank: "DRAIN",
  store: "DRAIN",
};

// No brightness lift here, and none on the port row below. A CSS filter applies
// to the element's SHADOWS as well as its content, and brightness(1.22) on
// #ffd257 clips red and green to 255 while lifting blue: the ring came out
// near #ffff6a, a flat yellow. Wires carry no filter, so they kept the true
// gold, and the two ends of the same highlight looked like two colours.
const PLUG_GLOW_STYLE: CSSProperties = {
  boxShadow: "0 0 0 2px var(--glow-line), 0 0 10px 2px var(--glow-halo)",
  zIndex: 15,
};

/**
 * The coupling chip: how covered the askers are, as one percent over one
 * bar, colored by the coupling's state. Everything else — who asks, the
 * gets/asks rates, the ×N short multiplier, the fix — lives in the hover.
 */
function PlugBlock({ nodeId, port }: { nodeId: string; port: RailPort }) {
  const plug = port.plug!;
  const isFlowScopeLit = useFactoryStore((state) =>
    Boolean(state.hoveredFlowScope?.ports[`${nodeId}|${port.handleId}`]),
  );
  const coveredPct = Math.round(Math.min(Math.max(plug.coveredFraction, 0), 1) * 100);
  return (
    <MinecraftTooltip
      label={`${port.displayName}: who takes it`}
      content={() => renderPlugHoverContent(port, nodeId)}
    >
      <span
        className={["flow-plug nodrag", `flow-plug--${plug.state}`].join(" ")}
        style={isFlowScopeLit ? PLUG_GLOW_STYLE : undefined}
      >
        {/* The coupling looks like the end of the wire, so it has to BE one:
            dragging from here pulls a new line. It sits inside the tooltip
            wrapper, so hovering the handle still opens the asker's story. */}
        <PlugDragHandle nodeId={nodeId} port={port} />
        {plug.state === "dump" ? (
          // No ask exists to be a percent of — flow just ends here. Name the
          // end it reaches: "DUMP" read as destruction even when the flow was
          // going somewhere perfectly safe.
          <span className="flow-plug-top">
            <b>{PLUG_DUMP_WORD[plug.dumpKind ?? "store"]}</b>
          </span>
        ) : (
          <>
            <span className="flow-plug-top">
              <b>{coveredPct}%</b>
            </span>
            <span className="flow-plug-bar">
              <span className="flow-plug-track">
                <i style={{ width: `${coveredPct}%` }} />
              </span>
            </span>
          </>
        )}
      </span>
    </MinecraftTooltip>
  );
}

/**
 * A rail port: the wire, the live rate, and the health bar share one surface.
 * The chip doubles as the React Flow handle (drag to wire) and as the edge
 * anchor element the router measures.
 */
/**
 * The flow neighbourhood a port hover lights up: every line on this port,
 * the far-end port of each line, and the nodes involved (so storages can
 * glow too). Built lazily on pointer-enter from live store state.
 */
function buildPortFlowScope(nodeId: string, port: RailPort) {
  const { project } = useFactoryStore.getState();
  const edges: Record<string, true> = {};
  const ports: Record<string, true> = { [`${nodeId}|${port.handleId}`]: true };
  const nodes: Record<string, true> = { [nodeId]: true };
  const isInput = port.side === "input";
  for (const edge of project.edges) {
    if ((isInput ? edge.target : edge.source) !== nodeId) {
      continue;
    }
    if (!edgeTouchesResource(edge, port.side, port.kind, port.resourceId)) {
      continue;
    }
    edges[edge.id] = true;
    const otherId = isInput ? edge.source : edge.target;
    nodes[otherId] = true;
    const rawOtherHandle = isInput ? edge.sourceHandle : edge.targetHandle;
    const otherHandle =
      canonicalizeResourceHandleId(rawOtherHandle) ??
      makeResourceHandleId(isInput ? "output" : "input", {
        kind: edge.resourceKind,
        id: edge.resourceId,
      });
    ports[`${otherId}|${otherHandle}`] = true;
  }
  return { edges, ports, nodes };
}

/**
 * What a port row does when you point at it.
 *
 * It used to be the little item icon and nothing else: a 28px square inside a
 * 40px row, carrying click-for-recipes and right-click-for-uses, while the rest
 * of the row — the name, the rate, the bar — was only a wire drag. Aiming at the
 * icon to ask "what makes this?" is a game of darts, and on a touchscreen the
 * icon has no right button to press and no hover to reveal itself.
 *
 * So the whole row answers now, and every input device gets a way in:
 *   click       recipes that make it
 *   right click recipes that use it
 *   drag        a wire, exactly as before
 *   R / U       the same two, for the row under the pointer
 *   tap         a menu offering both, for a finger
 *   press       the same menu, early enough to slide onto one and let go
 */
function usePortRowBrowse({
  nodeId,
  port,
  browse,
}: {
  nodeId: string;
  port: RailPort;
  browse: (mode: PortBrowseMode) => void;
}) {
  // The press gesture, the menu it opens and the one-answer-per-gesture rule are
  // shared with the items column — see browse-menu.tsx. What stays here is what is
  // particular to a port: the mouse's two buttons, the keyboard's two keys, and
  // the fact that a drag from here is a wire.
  const { pressHandlers, isPressing, menu, wasDragged, wasTouch, openFromTap } = useBrowseMenu({
    name: port.displayName,
    onPick: browse,
    onPressBecomesMenu: ({ x, y }) => {
      // React Flow began pulling a wire the instant the finger landed — it has no
      // way to know a press was coming — and the finger is now going to travel
      // down onto a menu item. Left alone it would drop that wire wherever the
      // finger let go. `mouseup` on the document is what its connection listens
      // for, so this is the wire being put down where it started, which wires
      // nothing.
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: x, clientY: y }));
    },
  });

  const handlers = {
    onPointerEnter: () => {
      setHoveredPortBrowse({ nodeId, handleId: port.handleId, open: browse });
    },
    onPointerLeave: () => {
      clearHoveredPortBrowse(nodeId, port.handleId);
      pressHandlers.onPointerCancel();
    },
    onPointerDown: pressHandlers.onPointerDown,
    onPointerMove: pressHandlers.onPointerMove,
    onPointerUp: pressHandlers.onPointerUp,
    onPointerCancel: pressHandlers.onPointerCancel,
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      if (isFromBrowseMenu(event)) {
        return;
      }
      // A finger gets the menu — a tap and a press open the same two answers, the
      // press just gets there early enough to slide onto one. Opening the book
      // straight off a tap would be guessing which of the two was meant.
      //
      // `isEchoOfTouch`, not the pointerdown this row saw: the click a tap
      // synthesises claims to be a mouse, and on some engines so does the
      // pointerdown before it, so only the timing gives them away.
      if (wasTouch() || isEchoOfTouch()) {
        if (openFromTap({ x: event.clientX, y: event.clientY })) {
          event.stopPropagation();
        }
        return;
      }
      // Dropping a wire back on the row it came from is a pointerdown and a
      // pointerup on one element, which is also the definition of a click.
      if (wasDragged() || wasRecentWireDrop()) {
        return;
      }
      event.stopPropagation();
      browse("recipes");
    },
    onContextMenu: (event: React.MouseEvent<HTMLElement>) => {
      if (isFromBrowseMenu(event)) {
        return;
      }
      // Android raises this on a long press too, where the menu is the answer.
      event.preventDefault();
      event.stopPropagation();
      if (wasTouch() || isEchoOfTouch()) {
        return;
      }
      browse("uses");
    },
  };

  return { handlers, menu, isPressing };
}

export function PortChip({
  nodeId,
  port,
  pending,
  plugRow = false,
}: {
  nodeId: string;
  port: RailPort;
  pending: ReturnType<typeof useFactoryStore.getState>["pendingResourceConnection"];
  /** Inside an OutputSocketRow: the row owns the edge anchor and hover scope. */
  plugRow?: boolean;
}) {
  const isInput = port.side === "input";
  const { calmMode } = useBoardView();
  const browseResource = useFactoryStore((state) => state.browseResource);
  const setHoveredFlowScope = useFactoryStore((state) => state.setHoveredFlowScope);
  const isFlowScopeLit = useFactoryStore((state) =>
    Boolean(state.hoveredFlowScope?.ports[`${nodeId}|${port.handleId}`]),
  );
  const slotState = getConnectionSlotState(
    pending,
    nodeId,
    port.side,
    port.kind,
    port.resourceId,
    port.resource?.alternatives,
    port.handleId,
  );
  const browse = (mode: PortBrowseMode) => {
    // POWER has no recipe book: EU is made by generator cards (the power
    // picker's job) and consumed by nothing, so browsing it would query the
    // dataset for a resource that is not in any dataset.
    if (port.kind === "power") {
      return;
    }
    browseResource(
      {
        kind: port.kind,
        id: port.resourceId,
        displayName: port.resource?.displayName ?? port.displayName,
        iconPath: port.resource?.iconPath,
        iconAtlas: port.resource?.iconAtlas,
        dominantColor: port.resource?.dominantColor ?? port.resource?.iconAtlas?.dominantColor,
        anchorNodeId: nodeId,
      },
      mode,
    );
  };
  // Everything the row answers with, in one place: the pointer, the keyboard and
  // the long-press menu all end up here.
  const rowBrowse = usePortRowBrowse({ nodeId, port, browse });
  const toneClass =
    port.tone === "bind"
      ? "flow-port--bind"
      : port.tone === "hot"
        ? "flow-port--hot"
        : port.tone === "calm"
          ? "flow-port--calm"
          : port.tone === "slowed"
            ? "flow-port--slowed"
            : port.tone === "idle"
              ? "flow-port--idle"
              : "";
  // The rate reads under the name in a lighter grey — the number is worth a
  // line, it just isn't worth competing with the name for attention. The
  // binding input still shows both halves (what it gets over what it asks);
  // every other port shows the one number that matters. Calm mode always
  // shows the bare actual rate: no fraction, nothing to diagnose.
  // The numbers ease to a new solve (value motion, board-motion.tsx): the
  // leaf re-renders itself per frame while they move, never the row.
  // The EU unit swaps an output's line for the energy each unit cost. It is
  // gold, and gold only here: the one reading on the board that is not a
  // rate, dressed so it can never be mistaken for one.
  const readsEnergy = portReadsEnergy(port);
  const rateText = readsEnergy ? (
    <EnergyReading euPerUnit={port.energyPerUnit!} kind={port.kind} unitSize={calmMode ? 10 : 8} />
  ) : (
    <MotionNumberText
      values={[port.currentPerSecond, port.nameplatePerSecond]}
      render={(shown) => {
        const current = shown[0] ?? port.currentPerSecond;
        const nameplate = shown[1] ?? port.nameplatePerSecond;
        return port.showNameplate && !calmMode
          ? `${formatSlotRateBare(current)} / ${formatSlotRate(nameplate, port.kind)}`
          : formatSlotRate(current, port.kind);
      }}
    />
  );
  const rateInk = readsEnergy ? ENERGY_READING_TEXT : "text-[var(--mc-ink-muted)]";

  // One bar, one ruler: 100% = full blast. Solid = now, hatch = would unlock
  // if fed. The caret/burst (the want) is an INPUT-side signal — on outputs
  // that story belongs to the asker and lives on the plug block instead.
  const nameplate = port.nameplatePerSecond;
  const fillPct = nameplate > 1e-9 ? Math.min(port.currentPerSecond / nameplate, 1) * 100 : 0;
  const couldPct = nameplate > 1e-9 ? Math.min(port.couldPerSecond / nameplate, 1) * 100 : 0;
  const ghostPct = Math.max(0, couldPct - fillPct);
  const wantRatio = nameplate > 1e-9 ? port.wantedPerSecond / nameplate : 0;
  const caretPct =
    isInput && port.wantedPerSecond > 1e-9 ? Math.min(Math.max(wantRatio, 0), 1) * 100 : undefined;
  const hasBurst = isInput && wantRatio > 1.005;

  return (
    <div
      className={[
        // 40px — two grid cells, fixed. The row is the board's vertical unit:
        // rails have no gaps and the head above them is a whole number of
        // 40s, so every port centre lands exactly on a grid line. Name, rate
        // and bar total 32px and centre inside it.
        "flow-port relative flex h-[40px] items-center gap-1 px-0.5 py-0",
        // flex-none both ways. An input chip used to be `flex-1`, and in a
        // column flex container that resolves the row's main size from its
        // content — quietly beating the 40px height and leaving the rail 4px
        // short per row, which is exactly how ports drift off the grid.
        plugRow ? `${PORT_CHIP_WIDTH_CLASS} flex-none` : "w-full flex-none",
        toneClass,
        isFlowScopeLit ? "flow-port--flow-lit" : "",
      ].join(" ")}
      // Inline so the highlight can never be lost to a stale stylesheet
      // chunk: this is the "you are looking at this port's flow" signal.
      style={
        isFlowScopeLit
          ? {
              boxShadow: "0 0 0 2px var(--glow-line), 0 0 10px 2px var(--glow-halo)",
              zIndex: 15,
            }
          : undefined
      }
      // Inside a socket row the ROW is the anchor (wires dock at the plug's
      // right edge) and owns the flow-scope hover; a second anchor here would
      // win the DOM lookup and pull edges back to the chip.
      {...(plugRow
        ? {}
        : {
            "data-resource-edge-anchor": "true",
            "data-resource-node-id": nodeId,
            "data-resource-handle-id": port.handleId,
          })}
      // The row is what you point at, so the row is what answers: recipes on a
      // click, uses on a right click, a menu on a long press, and the R/U keys
      // for whichever row the pointer is over. Merged by hand rather than spread
      // twice, because the flow-scope highlight shares these two events.
      onPointerEnter={(event) => {
        rowBrowse.handlers.onPointerEnter();
        if (!plugRow && !isWiringConnection()) {
          setHoveredFlowScope(buildPortFlowScope(nodeId, port));
        }
        void event;
      }}
      onPointerLeave={() => {
        rowBrowse.handlers.onPointerLeave();
        if (!plugRow) {
          setHoveredFlowScope(undefined);
        }
      }}
      onPointerDown={rowBrowse.handlers.onPointerDown}
      onPointerMove={rowBrowse.handlers.onPointerMove}
      onPointerUp={rowBrowse.handlers.onPointerUp}
      onPointerCancel={rowBrowse.handlers.onPointerCancel}
      onClick={rowBrowse.handlers.onClick}
      onContextMenu={rowBrowse.handlers.onContextMenu}
    >
      {slotState !== "idle" || rowBrowse.isPressing ? (
        <span
          className={[
            "pointer-events-none absolute inset-0 z-20",
            slotState === "selected" ? "ring-2 ring-amber-300" : "",
            slotState === "compatible" ? "ring-2 ring-cyan-300" : "",
            // A finger is holding this row: say so, and keep saying it while its
            // menu is open, so it is obvious which row the menu belongs to.
            slotState === "idle" && rowBrowse.isPressing
              ? "bg-white/10 ring-2 ring-cyan-300"
              : "",
          ].join(" ")}
        />
      ) : null}
      {/* Art, not a button. It used to be the only part of the row that opened
          the book, which made a 28px square the target for a question the whole
          row can now answer. Nothing here claims the pointer, so the handle
          above it gets the drag and the row gets the click. */}
      <span className="pointer-events-none relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden">
        {port.resource ? (
          <ResourceIcon
            resource={{ ...port.resource, amount: 1, chance: undefined }}
            bare
            tooltip={false}
            showAmount={false}
            showConsumedState={false}
            // Item art ships with transparent padding baked into the sprite,
            // and that padding is a FRACTION of the cell — growing the box
            // grows the empty border with it. ResourceIcon's default already
            // zooms to 200%-8px inside an overflow-hidden box; items take
            // another 1.5x on top and get clipped by the box above, which is
            // what finally puts the art edge to edge. A fluid sprite's art is
            // exactly the middle half of its canvas, so it takes the precise
            // spriteArtPixels size instead; only the artless swatch keeps its
            // exact requested size.
            iconPixelSize={
              port.kind === "fluid"
                ? isSwatchFluid(port.resource)
                  ? 50
                  : fluidArtPixels(28)
                : undefined
            }
            className={port.kind === "fluid" ? "" : "!h-7 !w-7 origin-center scale-150"}
          />
        ) : (
          <span className="block h-7 w-7 border border-[var(--mc-47)] bg-[var(--mc-55)]" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center pr-0.5">
        {/* The name is what you look for on a rail of five ports; the rate is
            what you compare once you have found it. Name in full ink, rate a
            step down and a step lighter, so the pair reads in that order. */}
        <span className="block truncate text-[11px] font-bold leading-[13px] text-[var(--mc-ink)]">
          {port.displayName}
        </span>
        {calmMode ? (
          /* Presentation: no bar, no want marks — the room they used goes to
             the number, which is the thing a viewer actually reads. Muted ink
             a step below the name, so the pair still reads name-first. */
          <span
            className={`block truncate text-[13px] font-bold leading-[15px] tabular-nums ${rateInk}`}
          >
            {rateText}
          </span>
        ) : (
          <>
            {/* Neutral, quieter ink: the chip's BAR carries the machine
                story's color. Green text over a red bar told two stories at
                once. */}
            <span
              className={`block truncate text-[10px] leading-[12px] tabular-nums ${rateInk} ${readsEnergy ? "font-bold" : "opacity-80"}`}
            >
              {rateText}
            </span>
            {port.unsupplied ? (
              <span className="block text-[7px] font-black leading-3 tracking-[0.5px] text-[var(--verdict-blocked-ink)]">
                NO SUPPLY
              </span>
            ) : (
              <span className="mt-0.5 flex items-center gap-0.5">
                <span
                  className={["flow-port-bar block flex-1", hasBurst ? "flow-port-bar--burst" : ""]
                    .join(" ")
                    .trim()}
                >
                  <i style={{ width: `${fillPct}%` }} />
                  {ghostPct > 1 ? (
                    <s
                      className="flow-port-ghost"
                      style={{ left: `${fillPct}%`, width: `${ghostPct}%` }}
                    />
                  ) : null}
                  {caretPct !== undefined ? (
                    <u className="flow-port-caret" style={{ left: `${caretPct}%` }} />
                  ) : null}
                </span>
                {hasBurst ? (
                  <em className="flow-port-burst not-italic">{formatTimes(wantRatio)}</em>
                ) : null}
              </span>
            )}
          </>
        )}
      </span>
      <MinecraftTooltip
        label={port.resource?.tooltip ?? port.displayName}
        content={() => renderPortHoverContent(port, nodeId)}
      >
        <Handle
          id={port.handleId}
          type={isInput ? "target" : "source"}
          position={isInput ? Position.Left : Position.Right}
          data-resource-handle="true"
          data-resource-node-id={nodeId}
          data-resource-handle-id={port.handleId}
          title={`${isInput ? "Input" : "Output"}: ${port.displayName}. Click for what makes it, right click for what uses it (R and U do the same), drag to wire`}
          className={[
            "resource-slot-handle nodrag !absolute !left-0 !right-auto !top-0 !z-30 !h-full !w-full !min-w-0 !translate-x-0 !translate-y-0",
            "!rounded-none !border-0 !bg-transparent !opacity-0",
            "cursor-crosshair",
          ].join(" ")}
        />
      </MinecraftTooltip>
      {rowBrowse.menu}
    </div>
  );
}

// The custom rate placeholder's two wire-here ports. Both are universal: the
// connect handlers in FactoryFlow spot the `custom-any` resource id and adopt
// whatever resource the far end carries (the machine side decides direction).
function CustomRateUniversalPorts({ nodeId }: { nodeId: string }) {
  return (
    // Four cells: one row of sockets over one line of explanation. The dial
    // sits under this block and takes two more, so an empty card is the same
    // height as a card with one port on it.
    <div className="flex h-[80px] flex-col gap-0">
      <div className="flex h-[40px] items-center justify-between gap-3">
        <UniversalPortChip nodeId={nodeId} side="input" label="Drain any" />
        <UniversalPortChip nodeId={nodeId} side="output" label="Supply any" />
      </div>
      <p className="mx-auto flex max-w-[320px] flex-1 items-center text-center text-[11px] leading-tight text-[var(--mc-ink-muted)]">
        Wire either socket to a machine and this card becomes that resource.
      </p>
    </div>
  );
}

function UniversalPortChip({
  nodeId,
  side,
  label,
}: {
  nodeId: string;
  side: "input" | "output";
  label: string;
}) {
  const isInput = side === "input";
  const handleId = makeResourceHandleId(side, { kind: "item", id: CUSTOM_RATE_ANY_RESOURCE_ID });
  return (
    <div
      className="relative flex h-[40px] w-[160px] items-center justify-center border-2 border-dashed border-[var(--mc-33)] bg-[var(--mc-71)] text-[11px] font-bold uppercase tracking-wide text-[var(--mc-ink-muted)]"
      data-resource-edge-anchor="true"
      data-resource-node-id={nodeId}
      data-resource-handle-id={handleId}
    >
      {label}
      <Handle
        id={handleId}
        type={isInput ? "target" : "source"}
        position={isInput ? Position.Left : Position.Right}
        data-resource-handle="true"
        data-resource-node-id={nodeId}
        data-resource-handle-id={handleId}
        title={
          isInput
            ? "Request side: wire a machine output (or tank) here"
            : "Supply side: wire a machine input (or tank) here"
        }
        className={[
          "resource-slot-handle nodrag !absolute !left-0 !right-auto !top-0 !z-30 !h-full !w-full !min-w-0 !translate-x-0 !translate-y-0",
          "!rounded-none !border-0 !bg-transparent !opacity-0",
          "cursor-crosshair",
        ].join(" ")}
      />
    </div>
  );
}

// Rate dial + Supply/Request flip for an adopted custom rate node. The store
// keeps the rate per second; the input shows it in the active board unit.
function CustomRatePanel({
  nodeId,
  mode,
  kind,
  perSecond,
}: {
  nodeId: string;
  mode: CustomRateMode;
  kind: ResourceAmount["kind"];
  perSecond: number;
}) {
  const setCustomRateConfig = useFactoryStore((state) => state.setCustomRateConfig);
  // Subscribe so the shown value re-derives when the board unit flips.
  useFactoryStore((state) => state.rateUnit);
  const multiplier = rateUnitMultiplier();
  // Three decimals of the RATE, not of the printed number: rounding what is
  // shown would quantise a per-tick dial to steps of 0.02/s.
  const step = 1000 / rateUnitPrecisionScale();
  const shownRate = String(Math.round(perSecond * multiplier * step) / step);
  const [draftState, setDraftState] = useState({ shownRate, draft: shownRate });
  const draft = draftState.shownRate === shownRate ? draftState.draft : shownRate;

  const commitDraft = (value: string) => {
    const parsed = Number.parseFloat(value.replace(/,/g, "").trim());
    if (Number.isFinite(parsed) && parsed >= 0) {
      setCustomRateConfig(nodeId, { perSecond: parsed / multiplier });
    }
  };
  const flipMode = (nextMode: CustomRateMode) => {
    if (nextMode !== mode) {
      setCustomRateConfig(nodeId, { mode: nextMode });
    }
  };
  const modeButtonClassName = (active: boolean) =>
    [
      "nodrag h-6 px-2 text-[11px] font-bold uppercase",
      // The chosen side is the app's blue and keeps it on any paint: it is the
      // one thing on this row that says which way the card faces.
      active
        ? "bg-[var(--mc-49)] text-white shadow-[inset_2px_2px_0_var(--mc-25),inset_-2px_-2px_0_var(--mc-85)]"
        : "bg-[var(--mc-82)] text-[var(--mc-ink-muted)] shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-47)] hover:bg-[var(--mc-100)]",
    ].join(" ");

  return (
    // Two cells tall, or more if the dial needs them.
    <GridBlock className="nodrag border border-[var(--mc-47)] bg-[var(--mc-71)] px-1 shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
    <div className="flex items-center gap-1">
      <div className="flex border-2 border-[var(--mc-33)]">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            flipMode("supply");
          }}
          onPointerDown={(event) => event.stopPropagation()}
          className={modeButtonClassName(mode === "supply")}
          title="Supply"
        >
          Supply
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            flipMode("request");
          }}
          onPointerDown={(event) => event.stopPropagation()}
          className={modeButtonClassName(mode === "request")}
          title="Request"
        >
          Request
        </button>
      </div>
      <input
        value={draft}
        onChange={(event) => {
          const nextDraft = event.target.value;
          setDraftState({ shownRate, draft: nextDraft });
          commitDraft(nextDraft);
        }}
        onBlur={() => {
          const parsed = Number.parseFloat(draft.replace(/,/g, "").trim());
          if (!Number.isFinite(parsed) || parsed < 0) {
            setDraftState({ shownRate, draft: shownRate });
          }
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        inputMode="decimal"
        aria-label="Rate"
        title="Rate"
        // Sized to the number, not to the row: `flex-1` made the field claim
        // every spare pixel and the card was permanently as wide as its
        // widest possible contents. In `ch` on a mono font this is exactly
        // the typed digits, so a "5" node is small and a "1000000000" node
        // grows only when it has to.
        style={{ width: `${Math.min(Math.max(draft.length + 2, 5), 16)}ch` }}
        className="nodrag h-6 shrink-0 border border-[var(--mc-33)] bg-[var(--mc-93)] px-1 text-right text-[13px] text-[var(--mc-ink)]"
      />
      <span className="shrink-0 pr-1 text-[11px] font-bold text-[var(--mc-ink-muted)]">
        {rateSuffixForKind(kind).trim() || "/s"}
      </span>
    </div>
    </GridBlock>
  );
}

const STORY_TONE_TEXT: Record<PortStory["tone"], string> = {
  red: "text-red-300",
  amber: "text-amber-300",
  gold: "text-yellow-200/80",
  green: "text-emerald-300",
  steel: "text-slate-300",
  dim: "text-slate-400",
};

const STORY_TONE_FILL: Record<PortStory["tone"], string> = {
  red: "#e05252",
  amber: "#e0a63a",
  gold: "#b0aa66",
  green: "#3fbf6f",
  steel: "#8aa0b8",
  dim: "#5a6a80",
};

const STORY_ACTION_TEXT: Record<"fix" | "fine" | "note", string> = {
  fix: "text-amber-300",
  fine: "text-emerald-300",
  note: "text-slate-300",
};

/**
 * The port hover panel — the big explainer: a thicker copy of the port's bar
 * with the same landmarks, the honest numbers, the per-line list, then the
 * plain answer to "why is it like this" and what to do. All copy comes from
 * explainPort; styles ride inline so no stale stylesheet chunk can mute the
 * teaching surface.
 */
function renderPortHoverContent(port: RailPort, nodeId: string) {
  if (port.nameplatePerSecond <= 1e-9 && port.currentPerSecond <= 1e-9) {
    return undefined;
  }

  const { project, lastResult } = useFactoryStore.getState();
  const verdict = deriveNodeVerdict(project, lastResult, nodeId);
  const story = explainPort(project, lastResult, nodeId, port, verdict);

  const nameplate = port.nameplatePerSecond;
  const fillPct = nameplate > 1e-9 ? Math.min(port.currentPerSecond / nameplate, 1) * 100 : 0;
  const couldPct = nameplate > 1e-9 ? Math.min(port.couldPerSecond / nameplate, 1) * 100 : 0;
  const ghostPct = Math.max(0, couldPct - fillPct);
  const wantRatio = nameplate > 1e-9 ? port.wantedPerSecond / nameplate : 0;
  const caretPct =
    port.wantedPerSecond > 1e-9 ? Math.min(Math.max(wantRatio, 0), 1) * 100 : undefined;
  const hasBurst = wantRatio > 1.005;
  const fillColor = STORY_TONE_FILL[story.tone];

  return (
    <div className="w-64">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 truncate text-[13px] font-semibold text-white">
          {port.displayName}
        </span>
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-slate-400">
          {port.side === "input" ? "Input" : "Output"}
        </span>
        <span
          className={[
            "ml-auto shrink-0 text-[10px] font-black tracking-wide",
            STORY_TONE_TEXT[story.tone],
          ].join(" ")}
        >
          {story.stateWord}
        </span>
      </div>

      {!port.unsupplied ? (
        <div className={["mt-2 flex items-center gap-1", caretPct !== undefined ? "mb-2" : "mb-1"].join(" ")}>
          <div
            className="relative h-[9px] flex-1"
            style={{
              background: "#101826",
              border: "1px solid #2c3a52",
              borderRightWidth: hasBurst ? 2 : 1,
              borderRightColor: hasBurst ? "rgba(255,255,255,0.9)" : "#2c3a52",
            }}
          >
            <i
              className="absolute bottom-0 left-0 top-0 block"
              style={{ width: `${fillPct}%`, background: fillColor }}
            />
            {ghostPct > 1 ? (
              <s
                className="absolute bottom-0 top-0 block"
                style={{
                  left: `${fillPct}%`,
                  width: `${ghostPct}%`,
                  background:
                    "repeating-linear-gradient(45deg, rgba(220,228,245,0.35) 0 1.5px, transparent 1.5px 3px)",
                }}
              />
            ) : null}
            {caretPct !== undefined ? (
              <u
                className="absolute block"
                style={{
                  left: `${caretPct}%`,
                  top: "100%",
                  marginTop: 1,
                  width: 0,
                  height: 0,
                  borderLeft: "4px solid transparent",
                  borderRight: "4px solid transparent",
                  borderBottom: "5px solid #f5c542",
                  transform: "translateX(-4px)",
                }}
              />
            ) : null}
          </div>
          {hasBurst ? (
            <em className="shrink-0 border border-dashed border-amber-400/70 bg-amber-400/20 px-1 text-[9px] font-black not-italic leading-[13px] text-amber-300">
              {formatTimes(wantRatio)}
            </em>
          ) : null}
        </div>
      ) : null}

      <StoryBody story={story} />
    </div>
  );
}

/**
 * The whole body of a port or plug hover: one sentence.
 *
 * It used to be a table of rates, then a list of every line plugged in with
 * the far machine's own speed beside it, then an arrowed instruction. The
 * numbers are already on the port, the lines are already on the board, and the
 * marks already say where to act.
 */
function StoryBody({ story }: { story: PortStory }) {
  return (
    <div className="mt-1.5 border-t border-white/15 pt-1.5 text-[12px] leading-snug text-slate-200">
      {story.lines.map((line, index) => (
        <p key={index} className="mb-1 last:mb-0">
          {line}
        </p>
      ))}
    </div>
  );
}

/**
 * The plug hover — the asker's story at full length: who is plugged in, what
 * they ask, what they get, and the fix. The covered bar rides the asker's
 * own frame: full = the ask is covered.
 */
function renderPlugHoverContent(port: RailPort, nodeId: string) {
  const { project, lastResult } = useFactoryStore.getState();
  const story = explainPlug(project, lastResult, nodeId, port);
  if (!story) {
    return undefined;
  }
  const plug = port.plug!;

  return (
    <div className="w-64">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 truncate text-[13px] font-semibold text-white">
          {port.displayName}
        </span>
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-slate-400">
          Plug
        </span>
        <span
          className={[
            "ml-auto shrink-0 text-[10px] font-black tracking-wide",
            STORY_TONE_TEXT[story.tone],
          ].join(" ")}
        >
          {story.stateWord}
          {plug.timesShort !== undefined ? ` ${formatTimes(plug.timesShort)}` : ""}
        </span>
      </div>

      <StoryBody story={story} />
    </div>
  );
}

function recipeContainsSearchResource(recipe: Recipe, query: string) {
  const normalizedQuery = normalizeSearch(query);
  if (normalizedQuery.length < 2) {
    return false;
  }

  return [...recipe.inputs, ...recipe.outputs].some((resource) =>
    normalizeSearch(`${resourceLabel(resource)} ${resource.id}`).includes(normalizedQuery),
  );
}

function recipeContainsResourceKey(recipe: Recipe, resourceKey: string | undefined) {
  if (!resourceKey) {
    return false;
  }

  return [...recipe.inputs, ...recipe.outputs].some(
    (resource) =>
      makeResourceKey(resource.kind, resource.id) === resourceKey ||
      resource.alternatives?.some(
        (alternative) => makeResourceKey(alternative.kind, alternative.id) === resourceKey,
      ),
  );
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

type VoltageTier = Exclude<MachineTier, "DEMO">;

function getNodeTierControl(recipe: Recipe, node: FactoryNode) {
  if (isIndustrialApiaryMachineType(recipe.machineType)) {
    return undefined;
  }

  const hasVoltageTier = GT_OVERCLOCK_TIERS.some((entry) => entry.tier === recipe.minimumTier);
  if (
    recipe.durationTicks <= 0 ||
    (recipe.eut === 0 && !hasVoltageTier && !isTierDrivenOutputRecipe(recipe))
  ) {
    return undefined;
  }

  const minimum = getOverclockedRecipeStats(recipe, node).minimumTier;
  // A multiblock's pick is honoured even below the minimum - the power cell
  // is what says an underpowered build won't start, not a silent clamp. A
  // singleblock is floored: a lower machine does not exist to be built.
  const allowBelowMinimum = isMultiblockRecipe(recipe);
  const resolved = resolveVoltageTier(node.overclockTier, minimum);
  const current =
    !allowBelowMinimum && getVoltageTierIndex(resolved) < getVoltageTierIndex(minimum)
      ? minimum
      : resolved;
  return { minimum, current, allowBelowMinimum };
}

function isTierDrivenOutputRecipe(recipe: Recipe) {
  const recipeMap = recipe.source?.recipeMap ?? recipe.machineType;
  return normalizeSearch(recipeMap) === "tree growth simulator";
}

function getAdjacentTier(current: VoltageTier, floor: VoltageTier | undefined, direction: -1 | 1) {
  const currentIndex = getVoltageTierIndex(current);
  const floorIndex = floor ? getVoltageTierIndex(floor) : 0;
  const nextIndex = Math.min(
    GT_OVERCLOCK_TIERS.length - 1,
    Math.max(floorIndex, currentIndex + direction),
  );
  return GT_OVERCLOCK_TIERS[nextIndex]?.tier ?? current;
}

function resolveVoltageTier(value: string, defaultTier: VoltageTier): VoltageTier {
  return GT_OVERCLOCK_TIERS.find((entry) => entry.tier === value)?.tier ?? defaultTier;
}

function resolveDatasetMachineConfigResource(
  configuredResource: ResourceAmount,
  dataset: ReturnType<typeof useFactoryStore.getState>["dataset"],
): ResourceAmount {
  const normalizedLabel = normalizeSearch(configuredResource.displayName ?? configuredResource.id);
  const indexed = [...(dataset?.resources ?? []), ...(dataset?.resourceIndex ?? [])].find(
    (resource) =>
      resource.kind === configuredResource.kind &&
      (resource.id === configuredResource.id ||
        normalizeSearch(resource.displayName ?? resource.id) === normalizedLabel),
  );

  if (!indexed) {
    return configuredResource;
  }

  return {
    ...configuredResource,
    id: indexed.id,
    displayName: indexed.displayName ?? configuredResource.displayName,
    iconPath: indexed.iconPath ?? configuredResource.iconPath,
    iconAtlas: indexed.iconAtlas ?? configuredResource.iconAtlas,
    dominantColor: indexed.dominantColor ?? configuredResource.dominantColor,
  };
}

function isTreeGrowthSimulatorToolControl(control: MachineConfigTierControl) {
  return (
    /^tgsToolSlot\d+$/.test(control.id) ||
    (control.id.startsWith("tgs") && control.id.endsWith("Tool"))
  );
}

function isDisplayOnlyParallelControl(control: MachineConfigTierControl) {
  return /^machineParallel/.test(control.id) && control.tiers.length <= 1;
}

const TREE_GROWTH_SIMULATOR_TOOL_SLOTS: Record<string, { x: number; y: number }> = {
  tgsToolSlot1: { x: 36, y: 36 },
  tgsToolSlot2: { x: 54, y: 36 },
  tgsToolSlot3: { x: 36, y: 54 },
  tgsToolSlot4: { x: 54, y: 54 },
  tgsLogTool: { x: 36, y: 36 },
  tgsSaplingTool: { x: 54, y: 36 },
  tgsLeavesTool: { x: 36, y: 54 },
  tgsFruitTool: { x: 54, y: 54 },
};

const BEE_FRAME_SLOTS: Record<string, { x: number; y: number }> = {
  beeFrameSlot1: { x: 66, y: 23 },
  beeFrameSlot2: { x: 66, y: 52 },
  beeFrameSlot3: { x: 66, y: 81 },
};

function getBeePanelControls(controls: MachineConfigTierControl[]): MachineConfigTierControl[] {
  const speedControl = controls.find((control) => control.id === BEE_INDUSTRIAL_SPEED_CONTROL_ID);
  if (speedControl?.current.key !== "speed-8-upgraded") {
    return controls;
  }

  return controls.map((control) => {
    if (control.id !== BEE_INDUSTRIAL_PRODUCTION_CONTROL_ID) {
      return control;
    }

    const production8 = control.tiers.find((tier) => tier.key === "8");
    if (!production8) {
      return control;
    }

    return {
      ...control,
      current: production8,
      resource: production8.resource,
      tiers: [production8],
    };
  });
}

function applyTreeGrowthSimulatorToolInputs(
  recipe: Recipe,
  controls: MachineConfigTierControl[],
): Recipe {
  if (controls.length === 0) {
    return recipe;
  }

  const inputs = recipe.inputs.map((input) => {
    const matchingControl = controls.find((control) => {
      const position = TREE_GROWTH_SIMULATOR_TOOL_SLOTS[control.id];
      return position?.x === input.neiSlot?.x && position.y === input.neiSlot?.y;
    });

    if (!matchingControl) {
      return input;
    }
    const resource = getTreeGrowthSimulatorSlotResource(matchingControl);

    return {
      ...input,
      ...resource,
      amount: 1,
      optional: true,
      consumed: false,
      neiSlot: input.neiSlot,
    };
  });

  return { ...recipe, inputs };
}

function stripBeeFrameSlotInputs(recipe: Recipe): Recipe {
  const inputs = recipe.inputs.filter((input) => !isBeeFrameSlotInput(input));
  const neiSlots = recipe.nei?.slots?.filter((slot) => !isBeeFrameSlotPosition(slot));
  const recipeChanged = inputs.length !== recipe.inputs.length;
  const neiChanged = neiSlots?.length !== recipe.nei?.slots?.length;

  if (!recipeChanged && !neiChanged) {
    return recipe;
  }

  return {
    ...recipe,
    inputs,
    nei: recipe.nei
      ? {
          ...recipe.nei,
          slots: neiSlots,
        }
      : recipe.nei,
  };
}

function isBeeFrameSlotInput(input: Recipe["inputs"][number]) {
  return /^factoryflow:bee_frame_slot_\d+$/.test(input.id);
}

function isBeeFrameSlotPosition(slot: NonNullable<NonNullable<Recipe["nei"]>["slots"]>[number]) {
  return Object.values(BEE_FRAME_SLOTS).some(
    (position) => position.x === slot.x && position.y === slot.y,
  );
}

function isTreeGrowthSimulatorEmptyTool(control: MachineConfigTierControl) {
  return (
    control.current.key === "none" ||
    getTreeGrowthSimulatorToolCategory(control.current.key) !==
      getTreeGrowthSimulatorSlotCategory(control.id)
  );
}

function getTreeGrowthSimulatorSlotResource(control: MachineConfigTierControl) {
  if (!isTreeGrowthSimulatorEmptyTool(control)) {
    return control.resource;
  }

  return control.tiers.find((tier) => tier.key === "none")?.resource ?? control.resource;
}

function getTreeGrowthSimulatorToolCategory(key: string): string | undefined {
  const [category] = key.split(":");
  return category && category !== "none" ? category : undefined;
}

function getTreeGrowthSimulatorSlotCategory(controlId: string): string | undefined {
  switch (controlId) {
    case "tgsToolSlot1":
    case "tgsLogTool":
      return "log";
    case "tgsToolSlot2":
    case "tgsSaplingTool":
      return "sapling";
    case "tgsToolSlot3":
    case "tgsLeavesTool":
      return "leaves";
    case "tgsToolSlot4":
    case "tgsFruitTool":
      return "fruit";
    default:
      return undefined;
  }
}

function getTreeGrowthSimulatorSlotTiers(control: MachineConfigTierControl) {
  const category = getTreeGrowthSimulatorSlotCategory(control.id);
  if (!category) {
    return control.tiers;
  }

  return control.tiers.filter(
    (tier) => tier.key === "none" || getTreeGrowthSimulatorToolCategory(tier.key) === category,
  );
}

/**
 * The block a config option means. `sizeClass` must be a literal Tailwind
 * pair — the class list is scanned at build time, so a computed size string
 * would silently produce no CSS at all.
 */
function ConfigTierIcon({
  resource,
  sizeClass,
}: {
  resource: ResourceAmount;
  sizeClass: string;
}) {
  if (!resource.iconPath && !resource.iconAtlas) {
    return (
      <span className="flex items-center justify-center whitespace-nowrap px-1 text-center text-[11px] font-black leading-none text-white [text-shadow:1px_1px_0_#000]">
        {shortConfigLabel(resource)}
      </span>
    );
  }
  return (
    <ResourceIcon
      resource={{ ...resource, amount: 1, chance: undefined }}
      bare
      tooltip={false}
      showAmount={false}
      showConsumedState={false}
      // No pixel size: ResourceIcon's zoom-and-clip crops the sprite's own
      // transparent padding, so the block fills its square instead of
      // floating in the middle of one.
      className={`shrink-0 ${sizeClass}`}
    />
  );
}

/**
 * What picking this option would change, against the one selected now. The
 * card's rates come from the solver, so they cannot move on hover without a
 * solve per mouse move; this says the same thing honestly and instantly.
 */
function configTierHint(
  option: MachineConfigTierOption,
  current: MachineConfigTierOption,
): string | undefined {
  const parts: string[] = [];
  const ratio = (next: number | undefined, now: number | undefined) => {
    const a = next ?? 1;
    const b = now ?? 1;
    return b === 0 ? undefined : a / b;
  };
  // A smaller duration multiplier is a faster machine, so speed inverts.
  const speed = ratio(current.durationMultiplier, option.durationMultiplier);
  if (speed !== undefined && Math.abs(speed - 1) > 0.005) {
    parts.push(`${formatTimes(speed)} speed`);
  }
  const parallel = ratio(option.parallelMultiplier, current.parallelMultiplier);
  if (parallel !== undefined && Math.abs(parallel - 1) > 0.005) {
    parts.push(`${formatTimes(parallel)} parallel`);
  }
  const output = ratio(option.outputMultiplier, current.outputMultiplier);
  if (output !== undefined && Math.abs(output - 1) > 0.005) {
    parts.push(`${formatTimes(output)} output`);
  }
  const eut = ratio(option.eutMultiplier, current.eutMultiplier);
  if (eut !== undefined && Math.abs(eut - 1) > 0.005) {
    parts.push(`${formatTimes(eut)} EU/t`);
  }
  return parts.slice(0, 2).join(" · ") || undefined;
}

function MachineConfigControlPanel({
  controls,
  onSelect,
  onPreview,
  trailing,
}: {
  controls: MachineConfigTierControl[];
  onSelect: (controlId: string, nextTier: string) => void;
  /** Hovering an option shows the node as if it were picked. */
  onPreview?: (controlId: string, tierKey: string | undefined) => void;
  /** An extra read-only tile sharing the grid — the ×N parallel count. */
  trailing?: ReactNode;
}) {
  if (controls.length === 0) {
    return null;
  }

  // Two controls per row. The panel's border-2 and px-1 leave 328px of
  // content width, so the column minimum must clear 2 × 160 + 4 gap = 324:
  // at the old 168 the auto-fit grid only ever found room for ONE column and
  // every knob quietly took a full row of its own.
  const rows = Math.ceil((controls.length + (trailing ? 1 : 0)) / 2);
  return (
    <GridBlock
      className="nodrag border-2 border-[var(--mc-47)] bg-[var(--mc-71)] px-1 shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]"
      minCells={(rows * CONFIG_PANEL_ROW_HEIGHT) / BOARD_GRID}
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] items-center gap-x-1 gap-y-1">
        {controls.map((control) => (
          <label key={control.id} className="min-w-0">
            <span className="mb-0.5 block text-[12px] font-bold uppercase leading-[14px] text-[var(--mc-ink-muted)]">
              {control.label}
            </span>
            <span className="flex min-w-0 items-center gap-1">
              {/* A square the block fills, not a wide box with a small block
                  adrift in it. */}
              <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden border border-[var(--mc-33)] bg-[var(--mc-55)] shadow-[inset_1px_1px_0_var(--mc-85),inset_-1px_-1px_0_var(--mc-25)]">
                <ConfigTierIcon
                  resource={control.current.resource ?? control.resource}
                  sizeClass="!h-[26px] !w-[26px]"
                />
              </span>
              <MinecraftSelect
                value={control.current.key}
                // Every option carries its own block, so the list is a row of
                // casings rather than a list of names to translate.
                options={control.tiers.map((tier) => ({
                  key: tier.key,
                  label: tier.label,
                  hint: configTierHint(tier, control.current),
                  icon: (
                    <ConfigTierIcon
                      resource={tier.resource ?? control.resource}
                      sizeClass="!h-[28px] !w-[28px]"
                    />
                  ),
                }))}
                onSelect={(key) => onSelect(control.id, key)}
                onPreview={
                  onPreview ? (key) => onPreview(control.id, key) : undefined
                }
                disabled={control.tiers.length <= 1}
                title={`${control.label}: ${control.current.label}`}
                ariaLabel={control.label}
                className="flex-1"
              />
            </span>
          </label>
        ))}
        {trailing}
      </div>
    </GridBlock>
  );
}

/**
 * The machine's ×N parallel count as a config-panel tile, shaped like the
 * knobs beside it (label over a row-high box) so it shares their grid row
 * instead of spending a line of its own under the footer.
 */
function ConfigParallelTile({ value }: { value: string }) {
  return (
    <div className="min-w-0">
      <span className="mb-0.5 block text-[12px] font-bold uppercase leading-[14px] text-[var(--mc-ink-muted)]">
        Parallel
      </span>
      <span className="flex h-7 min-w-0 items-center border border-[var(--mc-47)] bg-[var(--mc-85)] px-1.5 font-medium tabular-nums shadow-[inset_1px_1px_0_var(--mc-100),inset_-1px_-1px_0_var(--mc-54)]">
        ×{value}
      </span>
    </div>
  );
}


function PassiveProductionConfigPanel({
  className = "",
  controls,
  onSelect,
  getControlHelp,
  title,
  collapsed = false,
  onToggleCollapsed,
}: {
  className?: string;
  controls: MachineConfigTierControl[];
  onSelect: (controlId: string, nextTier: string) => void;
  /** Hover explanation per control (what the knob does and why it matters). */
  getControlHelp?: (controlId: string) => ReactNode;
  /**
   * What is being configured, written across the panel's head. The tab strip
   * can only afford one letter per machine, so on a card whose name bar is
   * spoken for - a crop farm names its CROP there - this is the only place
   * the machine's own name appears.
   */
  title?: string;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  if (controls.length === 0) {
    return null;
  }

  const foldable = Boolean(title && onToggleCollapsed);
  const isFolded = foldable && collapsed;
  // A head is one cell; each row of two controls is two. The floor only has
  // to be a floor - GridBlock measures the real content and rounds UP past
  // this - so it is deliberately tight. At three cells a row it reserved a
  // whole empty cell per row and the panel wore the slack top and bottom.
  const rows = isFolded ? 0 : Math.ceil(controls.length / 2);
  const headCells = foldable ? 1 : 0;
  return (
    <GridBlock
      className={[
        "nodrag border-2 border-[var(--mc-47)] bg-[var(--mc-71)] px-1 shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]",
        className,
      ].join(" ")}
      minCells={Math.max(isFolded ? 1 : 2, headCells + rows * PASSIVE_PANEL_ROW_CELLS)}
      // The 2px frame top and bottom, which scrollHeight cannot see.
      clearancePx={4}
    >
      {foldable ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleCollapsed?.();
          }}
          className={[
            "flex h-4 w-full min-w-0 items-center gap-1 text-left text-[10px] font-bold uppercase leading-4 text-[var(--mc-ink-muted)] hover:text-[var(--mc-ink)]",
            // Open, the head is a caption over the knobs and needs air under
            // it. Folded, it is the whole panel and centres on its own.
            isFolded ? "" : "mb-1",
          ].join(" ")}
          title={isFolded ? `Show ${title} settings` : `Hide ${title} settings`}
          aria-expanded={!isFolded}
        >
          <ChevronDown
            aria-hidden
            className={["h-3 w-3 shrink-0", isFolded ? "-rotate-90" : ""].join(" ")}
          />
          <span className="min-w-0 truncate">{title} Settings</span>
        </button>
      ) : null}
      {isFolded ? null : (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-1 gap-y-1">
          {controls.map((control) => (
            <MinecraftTooltip key={control.id} content={getControlHelp?.(control.id)}>
            <label className="min-w-0">
              <span className="mb-0.5 block truncate text-[10px] font-bold uppercase leading-4 text-[var(--mc-ink-muted)]">
                {control.label}
              </span>
              <MinecraftSelect
                value={control.current.key}
                options={control.tiers}
                onSelect={(key) => onSelect(control.id, key)}
                disabled={control.tiers.length <= 1}
                title={`${control.label}: ${control.current.label}`}
                ariaLabel={control.label}
              />
            </label>
            </MinecraftTooltip>
          ))}
        </div>
      )}
    </GridBlock>
  );
}

/** Caption line plus an h-6 control row, the power config panel's shape. */
const CROP_PANEL_ROW_PX = 40;

/** The unit types' pip colours, one per block, echoed by the slot pips. */
const CROP_UNIT_PIP_COLORS: Record<string, string> = {
  [CROP_IF_GROWTH_UNIT_CONTROL_ID]: "#6fbf50",
  [CROP_IF_FERTILIZER_UNIT_CONTROL_ID]: "#c9a24a",
  [CROP_IF_HARVEST_UNIT_CONTROL_ID]: "#5aa7d9",
  [CROP_IF_ENVIRONMENT_UNIT_CONTROL_ID]: "#b06fd9",
  [CROP_IF_OVERCLOCK_CONTROL_ID]: "#e06060",
};

// The SEEDS cell's exact chrome, shared by every crop knob so the settings
// speak the same beveled tile language as the footer under them.
const CROP_TILE_CLASS =
  "nodrag nowheel min-w-0 border border-[var(--mc-47)] bg-[var(--mc-71)] px-1 pb-0.5 shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]";
const CROP_TILE_CAPTION_CLASS =
  "flex items-center gap-1 truncate text-[11px] uppercase leading-[13px] text-[var(--mc-ink-muted)]";
// Narrow buttons, so the word well between them keeps the width: "60% Wet"
// has to fit a four-across tile.
const CROP_TILE_BUTTON_CLASS =
  "nodrag flex h-5 w-3.5 shrink-0 items-center justify-center border border-[var(--mc-33)] bg-[var(--mc-82)] text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-100),inset_-1px_-1px_0_var(--mc-47)] enabled:hover:bg-[var(--mc-100)] enabled:active:shadow-[inset_1px_1px_0_var(--mc-47),inset_-1px_-1px_0_var(--mc-100)] disabled:opacity-35";

/** One browser-wide fold for every crop card's worked-formula strip. */
const CROP_FORMULAS_OPEN_KEY = "gtnh-factory-flow.crop-formulas-open.v1";
function readCropFormulasOpen(): boolean {
  try {
    return window.localStorage.getItem(CROP_FORMULAS_OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}
function writeCropFormulasOpen(open: boolean) {
  try {
    window.localStorage.setItem(CROP_FORMULAS_OPEN_KEY, open ? "1" : "0");
  } catch {
    // A blocked storage just forgets the fold.
  }
}

/** The unit's tiny colour mark before its caption, echoing its slot pip. */
function CropPipSwatch({ color }: { color?: string }) {
  return color ? (
    <span
      aria-hidden
      className="h-[6px] w-[6px] shrink-0 border border-black/40"
      style={{ backgroundColor: color }}
    />
  ) : null;
}

/**
 * One knob of the crop settings as a SEEDS-style tile: the caption inside
 * the bevel, h-5 stepper buttons around a recessed count well.
 */
function CropStepperRow({
  label,
  effect,
  value,
  min,
  max,
  lockedHint,
  pipColor,
  onStep,
  help,
}: {
  label: string;
  /** What the current count does; lives in the hover, never on the row. */
  effect?: string;
  value: number;
  min: number;
  max: number;
  /** Why the row cannot go up right now ("No free slot"). */
  lockedHint?: string;
  /** The unit's slot-pip colour, worn as a small swatch by the caption. */
  pipColor?: string;
  onStep: (next: number) => void;
  help?: ReactNode;
}) {
  const step = (direction: -1 | 1) => {
    const next = Math.max(min, Math.min(max, value + direction));
    if (next !== value) {
      onStep(next);
    }
  };
  const row = (
    <div
      className={CROP_TILE_CLASS}
      title={[effect, value >= max && lockedHint ? lockedHint : undefined]
        .filter(Boolean)
        .join(" · ")}
      onWheel={(event) => {
        event.stopPropagation();
        step(event.deltaY < 0 ? 1 : -1);
      }}
    >
      <div className={CROP_TILE_CAPTION_CLASS}>
        <CropPipSwatch color={pipColor} />
        <span className="min-w-0 truncate">{label}</span>
      </div>
      <div className="flex min-w-0 items-center gap-0.5">
        <button
          type="button"
          className={CROP_TILE_BUTTON_CLASS}
          disabled={value <= min}
          onClick={(event) => {
            event.stopPropagation();
            step(-1);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          aria-label={`Fewer ${label}`}
        >
          <Minus className="h-3 w-3" />
        </button>
        <span className="h-5 w-0 min-w-0 flex-1 border border-[var(--mc-47)] bg-[var(--mc-85)] px-1 text-center text-[13px] font-medium leading-[18px] tabular-nums text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-100),inset_-1px_-1px_0_var(--mc-54)]">
          {value}
        </span>
        <button
          type="button"
          className={CROP_TILE_BUTTON_CLASS}
          disabled={value >= max}
          title={value >= max ? lockedHint : undefined}
          onClick={(event) => {
            event.stopPropagation();
            step(1);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          aria-label={`More ${label}`}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
  return help ? <MinecraftTooltip content={help}>{row}</MinecraftTooltip> : row;
}

/**
 * An option cell as the same +/- stepper the counts use: the well shows the
 * option's word instead of a number, minus walks back, plus walks forward.
 */
function CropCycleRow({
  label,
  options,
  currentKey,
  onPick,
  help,
}: {
  label: string;
  options: MachineConfigTierOption[];
  currentKey: string;
  onPick: (option: MachineConfigTierOption, index: number) => void;
  help?: ReactNode;
}) {
  const index = Math.max(
    0,
    options.findIndex((option) => option.key === currentKey),
  );
  const current = options[index]!;
  const step = (direction: -1 | 1) => {
    const next = options[Math.max(0, Math.min(options.length - 1, index + direction))];
    if (next && next.key !== current.key) {
      onPick(next, options.indexOf(next));
    }
  };
  const row = (
    <div
      className={CROP_TILE_CLASS}
      title={`${label}: ${current.label}`}
      onWheel={(event) => {
        event.stopPropagation();
        step(event.deltaY < 0 ? 1 : -1);
      }}
    >
      <div className={CROP_TILE_CAPTION_CLASS}>
        <span className="min-w-0 truncate">{label}</span>
      </div>
      <div className="flex min-w-0 items-center gap-0.5">
        <button
          type="button"
          className={CROP_TILE_BUTTON_CLASS}
          disabled={index <= 0}
          onClick={(event) => {
            event.stopPropagation();
            step(-1);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          aria-label={`Previous ${label}`}
        >
          <Minus className="h-3 w-3" />
        </button>
        <span className="h-5 w-0 min-w-0 flex-1 overflow-hidden whitespace-nowrap border border-[var(--mc-47)] bg-[var(--mc-85)] px-0.5 text-center text-[10px] font-medium leading-[18px] text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-100),inset_-1px_-1px_0_var(--mc-54)]">
          {current.label}
        </span>
        <button
          type="button"
          className={CROP_TILE_BUTTON_CLASS}
          disabled={index >= options.length - 1}
          onClick={(event) => {
            event.stopPropagation();
            step(1);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          aria-label={`Next ${label}`}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
  return help ? <MinecraftTooltip content={help}>{row}</MinecraftTooltip> : row;
}

/**
 * The harvester's voltage chip in the card header's tier slot, in the game's
 * tier colours; "By Hand" wears plain chrome.
 */
function CropTierChip({
  control,
  onPick,
}: {
  control: MachineConfigTierControl;
  onPick: (key: string) => void;
}) {
  const index = Math.max(
    0,
    control.tiers.findIndex((tier) => tier.key === control.current.key),
  );
  const step = (direction: -1 | 1) => {
    const next = control.tiers[Math.max(0, Math.min(control.tiers.length - 1, index + direction))];
    if (next && next.key !== control.current.key) {
      onPick(next.key);
    }
  };
  const tierColor = (
    GT_TIER_COLORS as Record<string, (typeof GT_TIER_COLORS)["LV"] | undefined>
  )[control.current.label];
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        step(1);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        step(-1);
      }}
      onWheel={(event) => {
        event.stopPropagation();
        step(event.deltaY < 0 ? 1 : -1);
      }}
      className="nodrag nowheel flex h-6 w-[50px] items-center justify-center border-2 px-1 pb-[3px] text-[11px] font-bold leading-none shadow-[inset_2px_2px_0_rgba(255,255,255,0.55),inset_-2px_-2px_0_rgba(0,0,0,0.45)] hover:brightness-110"
      style={
        tierColor
          ? {
              backgroundColor: tierColor.background,
              borderColor: tierColor.border,
              color: tierColor.text,
              textShadow: `1px 1px 0 ${tierColor.shadow}`,
              textDecoration: tierColor.underline ? "underline" : undefined,
            }
          : {
              backgroundColor: "var(--mc-49)",
              borderColor: "var(--mc-15)",
              color: "#fff",
            }
      }
      title={`${control.label}: ${control.current.label}. Click for the next tier, right-click for the previous, wheel for both.`}
      aria-label={`${control.label} tier`}
    >
      {control.current.label}
    </button>
  );
}

/**
 * The crop card's settings, redrawn as a bespoke panel: tier chips in the
 * game's voltage colours, one +/- stepper per farm unit with the real block
 * art, and the farm's shared upgrade-slot budget made physical as a row of
 * pips - a setup the game cannot build cannot be dialed in here either.
 */
function CropConfigPanel({
  className = "",
  controls,
  handlerId,
  machineConfigTiers,
  machineCount,
  minSeedBedTier,
  cropStats,
  onSelect,
  onSelectMany,
  getControlHelp,
}: {
  className?: string;
  controls: MachineConfigTierControl[];
  handlerId: string | undefined;
  machineConfigTiers: Record<string, string | undefined> | undefined;
  machineCount: number;
  /** The crop's seed bed floor: math clamps to it exactly as the chip does. */
  minSeedBedTier?: number;
  /** The crop's own stats, for the plugged-in formula strip. */
  cropStats?: CropsNhStats;
  onSelect: (controlId: string, nextTier: string) => void;
  /**
   * Writes several knobs in one undo step. Every unit step commits the WHOLE
   * normalized unit set, so what is stored always equals what is shown and a
   * later change can never silently reshuffle slots between units.
   */
  onSelectMany: (patch: Record<string, string>) => void;
  getControlHelp?: (controlId: string) => ReactNode;
}) {
  const [formulasOpen, setFormulasOpen] = useState(readCropFormulasOpen);
  const onToggleFormulas = () => {
    setFormulasOpen((open) => {
      writeCropFormulasOpen(!open);
      return !open;
    });
  };
  if (controls.length === 0) {
    return null;
  }

  const subSoil = cropStats?.subSoil !== undefined;
  const setup = cropsNhHarvesterFromTiers(machineConfigTiers, handlerId, minSeedBedTier, subSoil);
  const isFarm = setup.id === CROP_HARVESTER_INDUSTRIAL_FARM_ID;
  const handPicked = cropsNhIsHandPicked(setup);
  const slots = cropsNhUpgradeSlots(setup.tierIndex);
  const used = cropsNhUnitSlotsUsed(setup);
  const remaining = Math.max(0, slots - used);
  const capacity = cropsNhCropsPerMachine(setup);
  const crops = Math.max(1, Math.round(machineCount));
  const machines = handPicked ? 0 : Math.max(1, Math.ceil(crops / capacity));

  const pickWithSound = (controlId: string, key: string, soundStep: number) => {
    playBoardSound("dialRate", { step: Math.max(0, Math.min(10, soundStep)) });
    suppressBoardSound("adjust", 150);
    onSelect(controlId, key);
  };
  // A unit step writes the WHOLE normalized set back, so stored values always
  // equal the shown ones and later steps can never reshuffle slots.
  const commitUnitStep = (controlId: string, next: number) => {
    const nextSetup = cropsNhHarvesterFromTiers(
      { ...(machineConfigTiers ?? {}), [controlId]: String(next) },
      handlerId,
      minSeedBedTier,
      subSoil,
    );
    playBoardSound("dialRate", { step: Math.max(0, Math.min(10, next)) });
    suppressBoardSound("adjust", 150);
    onSelectMany({
      [CROP_IF_GROWTH_UNIT_CONTROL_ID]: String(nextSetup.growthUnits),
      [CROP_IF_FERTILIZER_UNIT_CONTROL_ID]: String(nextSetup.fertilizerUnits),
      [CROP_IF_HARVEST_UNIT_CONTROL_ID]: String(nextSetup.harvestUnits),
      [CROP_IF_ENVIRONMENT_UNIT_CONTROL_ID]: String(nextSetup.environmentUnits),
      [CROP_IF_OVERCLOCK_CONTROL_ID]: String(nextSetup.overclocks),
    });
  };
  const isUnitControl = (controlId: string) => controlId in CROP_UNIT_PIP_COLORS;
  const stepperRow = (
    control: MachineConfigTierControl,
    value: number,
    min: number,
    max: number,
    effect?: string,
    lockedHint?: string,
  ) => (
    <CropStepperRow
      key={control.id}
      label={control.label}
      effect={effect}
      value={value}
      min={min}
      max={max}
      lockedHint={lockedHint}
      pipColor={CROP_UNIT_PIP_COLORS[control.id]}
      onStep={(next) =>
        isUnitControl(control.id)
          ? commitUnitStep(control.id, next)
          : // A 31-rung stat ladder squeezes onto the tap's 10 rungs so the
            // top of the stat is the top of the climb, not a plateau.
            pickWithSound(control.id, String(next), max > 10 ? (next / max) * 10 : next)
      }
      help={getControlHelp?.(control.id)}
    />
  );

  const rows = controls.map((control) => {
    switch (control.id) {
      case CROP_MANAGER_TIER_CONTROL_ID:
      case CROP_SEED_BED_TIER_CONTROL_ID:
        // The harvester's voltage lives in the card header's tier slot.
        return null;
      case CROP_GROWTH_STAT_CONTROL_ID:
      case CROP_GAIN_STAT_CONTROL_ID: {
        const value = Number.parseInt(control.current.key, 10) || 1;
        return stepperRow(
          control,
          value,
          1,
          31,
          control.id === CROP_GROWTH_STAT_CONTROL_ID
            ? "Higher ripens sooner"
            : "Higher drops more per harvest",
        );
      }
      case CROP_IF_GROWTH_UNIT_CONTROL_ID:
        return stepperRow(
          control,
          setup.growthUnits,
          0,
          setup.overclocks > 0 ? 0 : setup.growthUnits + remaining,
          setup.overclocks > 0
            ? "The Overclocked unit replaces these"
            : `+${setup.growthUnits * 100}% growth speed`,
          setup.overclocks > 0 ? "The Overclocked unit replaces these" : "No free upgrade slot",
        );
      case CROP_IF_FERTILIZER_UNIT_CONTROL_ID:
        return stepperRow(
          control,
          setup.fertilizerUnits,
          0,
          Math.min(1, setup.fertilizerUnits + remaining),
          setup.fertilizerUnits > 0 ? "×1.5 speed · +0.5 harvest rounds" : "Feeds enriched fertilizer",
          remaining === 0 && setup.fertilizerUnits === 0 ? "No free upgrade slot" : "The farm fits one",
        );
      case CROP_IF_HARVEST_UNIT_CONTROL_ID:
        return stepperRow(
          control,
          setup.harvestUnits,
          0,
          Math.min(2, setup.harvestUnits + remaining),
          `×${(1 + setup.harvestUnits * 0.2).toFixed(1)} harvest rounds`,
          remaining === 0 && setup.harvestUnits < 2 ? "No free upgrade slot" : "The farm fits two",
        );
      case CROP_IF_ENVIRONMENT_UNIT_CONTROL_ID: {
        // A card adds a liked biome TAG, which stacks with the biome's own
        // tags up to the two-tag cap - so the honest number is the delta the
        // cards actually buy in this biome, not units x 14.
        const baseEnv = cropsNhEnvironmentFromTiers(machineConfigTiers);
        const withCards = cropsNhHarvesterEnvironment(setup, baseEnv);
        const withoutCards = cropsNhHarvesterEnvironment(
          { ...setup, environmentUnits: 0 },
          baseEnv,
        );
        return stepperRow(
          control,
          setup.environmentUnits,
          0,
          Math.min(2, setup.environmentUnits + remaining),
          `+${withCards.biomeBonus - withoutCards.biomeBonus} biome score in this biome`,
          remaining === 0 && setup.environmentUnits < 2 ? "No free upgrade slot" : "The farm fits two",
        );
      }
      case CROP_IF_OVERCLOCK_CONTROL_ID: {
        const belowZpm = setup.tierIndex < 7;
        const noSlot = setup.overclocks === 0 && remaining === 0;
        return stepperRow(
          control,
          setup.overclocks,
          0,
          belowZpm || noSlot ? setup.overclocks : 6,
          setup.overclocks > 0
            ? `×${2 ** setup.overclocks} output · ×${4 ** setup.overclocks} EU`
            : "Doubles output, quadruples EU, per step",
          belowZpm ? "Needs a ZPM seed bed or better" : "No free upgrade slot",
        );
      }
      default:
        return (
          <CropCycleRow
            key={control.id}
            label={control.label}
            options={control.tiers}
            currentKey={control.current.key}
            onPick={(next, index) => pickWithSound(control.id, next.key, index)}
            help={getControlHelp?.(control.id)}
          />
        );
    }
  });
  // The knobs split into the card's two stories: what the CROP is, and what
  // hardware the farm carries. The pips ride the UPGRADES section head, in a
  // stable per-unit colour order, so the budget lives with what spends it.
  const cellEntries = controls
    .map((control, index) => ({ id: control.id, cell: rows[index] }))
    .filter((entry) => Boolean(entry.cell));
  const cropCells = cellEntries
    .filter((entry) => !(entry.id in CROP_UNIT_PIP_COLORS))
    .map((entry) => entry.cell);
  const unitCells = cellEntries
    .filter((entry) => entry.id in CROP_UNIT_PIP_COLORS)
    .map((entry) => entry.cell);
  const pipFills = [
    ...Array.from({ length: setup.growthUnits }, () => CROP_UNIT_PIP_COLORS[CROP_IF_GROWTH_UNIT_CONTROL_ID]!),
    ...Array.from({ length: setup.fertilizerUnits }, () => CROP_UNIT_PIP_COLORS[CROP_IF_FERTILIZER_UNIT_CONTROL_ID]!),
    ...Array.from({ length: setup.harvestUnits }, () => CROP_UNIT_PIP_COLORS[CROP_IF_HARVEST_UNIT_CONTROL_ID]!),
    ...Array.from({ length: setup.environmentUnits }, () => CROP_UNIT_PIP_COLORS[CROP_IF_ENVIRONMENT_UNIT_CONTROL_ID]!),
    ...(setup.overclocks > 0 ? [CROP_UNIT_PIP_COLORS[CROP_IF_OVERCLOCK_CONTROL_ID]!] : []),
  ];
  const footer = handPicked ? null : (
    <div
      key="crop-machine-footer"
      className="mt-0.5 flex h-[14px] items-center text-[10px] leading-[12px] text-[var(--mc-ink-muted)]"
    >
      <span className="truncate">
        {crops.toLocaleString()} planted / {capacity.toLocaleString()} per machine
      </span>
      <span className="ml-auto shrink-0 text-[var(--mc-ink)]">
        ×{machines.toLocaleString()} {isFarm ? "Industrial Farm" : "Crop Manager"}
        {machines === 1 ? "" : "s"}
      </span>
    </div>
  );

  // THE WORKED FORMULAS: every number on this card, derived in front of the
  // player with their own settings plugged in. Muted fine print under the
  // footer, one equation per line, each unit's count in its own pip colour.
  // Folds on its FORMULAS head; the choice is a browser preference shared by
  // every crop card.
  const workedFormulas = (() => {
    if (!cropStats) {
      return null;
    }
    const head = (
      <button
        type="button"
        className="nodrag flex h-[12px] w-full items-center gap-1 text-left text-[9px] uppercase tracking-wide text-[var(--mc-ink-muted)] hover:text-[var(--mc-ink)]"
        onClick={(event) => {
          event.stopPropagation();
          onToggleFormulas();
        }}
        aria-expanded={formulasOpen}
        title={formulasOpen ? "Hide the worked formulas" : "Show the worked formulas"}
      >
        <ChevronDown
          aria-hidden
          className={[
            // Rotates in place; the box never moves between states.
            "h-2.5 w-2.5 shrink-0 transition-transform duration-100",
            formulasOpen ? "" : "-rotate-90",
          ].join(" ")}
        />
        <span className="text-[9px] leading-[11px]">Formulas</span>
      </button>
    );
    if (!formulasOpen) {
      // The SAME wrapper the open state uses, minus the lines: the head must
      // be pixel-identical folded and unfolded.
      return (
        <div className="mt-1 border-t border-[var(--mc-56)] pt-0.5 text-[9px] leading-[11px] text-[var(--mc-ink-muted)]">
          {head}
        </div>
      );
    }
    const env = cropsNhHarvesterEnvironment(setup, cropsNhEnvironmentFromTiers(machineConfigTiers));
    const waterBonus = Math.floor((Math.min(100, Math.max(0, env.water)) + 9) / 10);
    const fertBonus = Math.floor((Math.min(100, Math.max(0, env.fertilizer)) + 9) / 10);
    const skyBonus = env.sky ? 2 : 0;
    const supply = cropsNhNutrientScore(env) * 5;
    const demand = cropStats.tier * 10;
    const speedMult = cropsNhGrowthSpeedMultiplier(setup);
    const roundMult = cropsNhHarvestRoundMultiplier(setup);
    // Each unit's count wears its slot-pip colour, so the equation reads
    // back to the knobs above without a legend.
    const tint = (value: ReactNode, controlId: string) => (
      <span style={{ color: CROP_UNIT_PIP_COLORS[controlId] }}>{value}</span>
    );
    const growthN = tint(setup.growthUnits, CROP_IF_GROWTH_UNIT_CONTROL_ID);
    const fertN = tint(setup.fertilizerUnits, CROP_IF_FERTILIZER_UNIT_CONTROL_ID);
    const harvestN = tint(setup.harvestUnits, CROP_IF_HARVEST_UNIT_CONTROL_ID);
    const biomeN = tint(setup.environmentUnits, CROP_IF_ENVIRONMENT_UNIT_CONTROL_ID);
    const ocN = tint(setup.overclocks, CROP_IF_OVERCLOCK_CONTROL_ID);
    // The classic aligned-equations look: every derivation right-aligns into
    // one shared "=" column and the answers stand in a bright left-aligned
    // column of their own - the eye can read just the results, or the whole
    // working, without a box in sight.
    const line = (label: string, math: ReactNode, result: ReactNode) => (
      <div
        key={label}
        className="grid min-w-0 grid-cols-[44px_minmax(0,1fr)_auto] items-baseline gap-x-1 whitespace-nowrap"
      >
        <span className="uppercase tracking-wide">{label}</span>
        <span className="min-w-0 overflow-hidden text-ellipsis text-right tabular-nums">
          {math}
        </span>
        <span className="min-w-0 overflow-hidden text-ellipsis text-[10px] font-semibold tabular-nums text-[var(--mc-ink)]">
          {" "}= {result}
        </span>
      </div>
    );
    // THE STORY, each line feeding the next until the card's own per-second
    // figure falls out: food sets the growth rate, the rate sets the seconds
    // per harvest, the gain sets the items per harvest, and the last line is
    // the output the wires carry.
    const surplusPct =
      supply >= demand ? 100 + (supply - demand) : Math.max(0, 100 - (demand - supply) * 4);
    const rate = cropsNhGrowthRate(cropStats, env);
    const cycleSec = cropStats.growthCycleTicks / 20;
    const cycles = rate > 0 ? Math.ceil(cropStats.growthPoints / rate) : 0;
    const harvestSec = rate > 0 ? (cycles * cycleSec) / speedMult : 0;
    const itemsPerHarvest =
      cropStats.drops.reduce(
        (sum, drop) => sum + cropsNhExpectedDrop(cropStats, env.gain, drop),
        0,
      ) * roundMult;
    const outPerSec = rate > 0 ? (itemsPerHarvest / harvestSec) * crops : 0;
    const lines: ReactNode[] = [
      line(
        "food",
        <>(5+{waterBonus}+{fertBonus}+{skyBonus}+{env.biomeBonus})·5 vs {cropStats.tier}·10</>,
        <>
          {supply} vs {demand}{" "}
          <span style={{ color: supply >= demand ? "#7fd94a" : "#e06060" }}>
            → {surplusPct}%
          </span>
        </>,
      ),
      line(
        "grows",
        <>(6+{env.growth})·{surplusPct}%</>,
        <>
          {rate} pts per {formatCompact(cycleSec)}s
        </>,
      ),
      line(
        "harvest",
        rate > 0 ? (
          // Every term stays put whatever the knobs say, and every unit
          // count stands IN the equation wearing its own colour - so when a
          // green knob moves, a green number moves here.
          isFarm ? (
            <>
              ⌈{cropStats.growthPoints}/{rate}⌉·{formatCompact(cycleSec)}s ÷ (1+{growthN}
              )·(1+0.5·{fertN})·2<sup>{ocN}</sup>
            </>
          ) : (
            <>
              ⌈{cropStats.growthPoints}/{rate}⌉·{formatCompact(cycleSec)}s
            </>
          )
        ) : (
          <>too hungry to grow</>
        ),
        rate > 0 ? <>{formatCompact(harvestSec)}s</> : <span style={{ color: "#e06060" }}>never</span>,
      ),
      line(
        "drops",
        isFarm ? (
          <>
            {formatCompact(cropStats.dropChance)}·1.03<sup>{env.gain}</sup>·(1+0.2·
            {setup.tierIndex}+0.5·{fertN})·(1+0.2·{harvestN})
          </>
        ) : (
          <>
            {formatCompact(cropStats.dropChance)}·1.03<sup>{env.gain}</sup>·(1+0.05·
            {setup.tierIndex})
          </>
        ),
        <>{formatCompact(itemsPerHarvest)}</>,
      ),
      line(
        "output",
        <>
          {formatCompact(itemsPerHarvest)} ÷ {formatCompact(harvestSec)}s · {crops.toLocaleString()} seeds
        </>,
        <>{formatCompact(outPerSec)}/s</>,
      ),
    ];
    if (isFarm) {
      const unitPowerFactor =
        1 +
        1.25 * setup.growthUnits +
        0.5 * (setup.fertilizerUnits + setup.harvestUnits + setup.environmentUnits);
      const farmEu = cropsNhFarmEut(setup);
      const baseEu = Math.round(farmEu / (unitPowerFactor * 4 ** setup.overclocks));
      lines.push(
        line(
          "power",
          <>
            {baseEu}·(1+1.25·{growthN}+0.5·({fertN}+{harvestN}+{biomeN}))·4
            <sup>{ocN}</sup>·{machines}
          </>,
          <>{Math.round(farmEu * machines).toLocaleString()} EU/t</>,
        ),
      );
    } else {
      const euPerHarvest = cropsNhManagerEuPerHarvest(setup);
      lines.push(
        line(
          "power",
          <>{(euPerHarvest * 8).toLocaleString()}/8 per crop picked</>,
          <>{euPerHarvest.toLocaleString()} EU</>,
        ),
      );
    }
    return (
      <div className="mt-1 border-t border-[var(--mc-56)] pt-0.5 text-[9px] leading-[11px] text-[var(--mc-ink-muted)]">
        {head}
        <div className="mt-0.5 space-y-0.5">{lines}</div>
      </div>
    );
  })();

  const sectionHead = (title: string, trailing?: ReactNode) => (
    <div className="mb-0.5 flex h-[14px] items-center gap-1.5 text-[10px] uppercase tracking-wide leading-[12px] text-[var(--mc-ink-muted)]">
      <span>{title}</span>
      {trailing}
    </div>
  );
  // An ACCURATE floor, neither inflated nor tiny: an inflated estimate
  // bought dead space between the ports and the hairline, and a bare floor
  // painted the panel one frame short before GridBlock's measurement caught
  // up, which flashed the whole card's layout.
  const bodyPx =
    8 +
    (cropCells.length > 0 ? Math.ceil(cropCells.length / 4) * 44 : 0) +
    (unitCells.length > 0 ? 16 + Math.ceil(unitCells.length / 3) * 44 : 0) +
    (footer ? 16 : 0) +
    (cropStats ? (formulasOpen ? 12 + 6 * 11 + 8 : 18) : 0);
  // The crop's own tiles sit right under the hairline with no section head
  // of their own - what they are is obvious - and the farm's hardware
  // follows under the UPGRADES head with its slot budget.
  return (
    <GridBlock
      className={["nodrag min-w-0", className].join(" ")}
      minCells={Math.max(1, Math.ceil(bodyPx / BOARD_GRID))}
      clearancePx={4}
      // The block's own rounding slack goes ABOVE the knobs (where the
      // cluster already breathes), never under the formulas fold, where a
      // collapsed strip read as a big empty shelf.
      align="end"
    >
      <div className="min-w-0 border-t border-[var(--mc-56)] pb-1 pt-0.5">
        {cropCells.length > 0 ? (
          // Four across: the crop's own knobs are narrow (a two-digit stat,
          // a one-word option), so the row need not wrap.
          <div className="grid min-w-0 grid-cols-[repeat(4,minmax(0,1fr))] gap-x-1 gap-y-1">
            {cropCells}
          </div>
        ) : null}
        {unitCells.length > 0 ? (
          <div className={cropCells.length > 0 ? "mt-1" : ""}>
            {sectionHead(
              "Upgrades",
              <>
                <span className="flex items-center gap-[3px]">
                  {Array.from({ length: slots }, (_unused, index) => (
                    <span
                      key={index}
                      className="h-2.5 w-2.5 border border-[var(--mc-33)]"
                      style={{ backgroundColor: pipFills[index] ?? "var(--mc-47)" }}
                    />
                  ))}
                </span>
                <span className="ml-auto tabular-nums">
                  {used}/{slots} slots
                </span>
              </>,
            )}
            <div className="grid min-w-0 grid-cols-[repeat(3,minmax(0,1fr))] gap-x-1 gap-y-1">
              {unitCells}
            </div>
          </div>
        ) : null}
        {footer}
        {workedFormulas}
      </div>
    </GridBlock>
  );
}

const CROP_HELP_GOOD = "#4ade80";
const CROP_HELP_BAD = "#f87171";

function CropHelpPanel({
  title,
  children,
  finePrint,
  feeding,
}: {
  title: string;
  children: ReactNode;
  /** The exact formula, tucked away for the curious. */
  finePrint?: ReactNode;
  /** Shared "how feeding works" footer for the environment knobs. */
  feeding?: { tier: number };
}) {
  return (
    <div className="w-[400px]">
      <p className="text-[18px] font-semibold leading-snug text-amber-300">{title}</p>
      <div className="mt-1.5 space-y-2 text-[16px] leading-relaxed text-slate-100">{children}</div>
      {feeding ? (
        <p className="mt-2.5 border-t border-white/10 pt-2 text-[16px] leading-relaxed text-slate-100">
          Feeding basics: this crop is Tier {feeding.tier}, so it wants{" "}
          <span className="text-white">{feeding.tier * 10}</span> food out of a possible 275. Every
          point of extra food makes it grow{" "}
          <span style={{ color: CROP_HELP_GOOD }}>a little faster</span>; every missing point slows
          it <span style={{ color: CROP_HELP_BAD }}>four times as hard</span>. If it is 25 or more
          short, it <span style={{ color: CROP_HELP_BAD }}>stops growing completely</span>.
        </p>
      ) : null}
      {finePrint ? (
        <p className="mt-2 border-t border-white/10 pt-1.5 text-[13px] leading-relaxed text-slate-400">
          Formula: {finePrint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Friendly hover explainers for the crop source dropdowns, with this crop's
 * own numbers. Plain words first, the exact formula as fine print.
 */
function cropControlHelp(recipe: Recipe, controlId: string): ReactNode {
  const stats = getCropsNhStats(recipe);
  if (!stats) {
    return undefined;
  }
  const meta = (recipe.metadata as { cropsNh?: { biomeTags?: string[] } } | undefined)?.cropsNh;
  const biomeTags = Array.isArray(meta?.biomeTags) ? meta.biomeTags : [];
  const good = (text: string) => <span style={{ color: CROP_HELP_GOOD }}>{text}</span>;
  const bad = (text: string) => <span style={{ color: CROP_HELP_BAD }}>{text}</span>;

  switch (controlId) {
    case "cropGrowthStat":
      return (
        <CropHelpPanel
          title="Growth"
          finePrint={
            <>
              every 12.8 s the plant gains (6 + Growth) points, scaled by feeding. This crop is
              ripe at {stats.growthPoints.toLocaleString()} points and restarts from 0 after each
              harvest.
            </>
          }
        >
          <p>
            The higher the Growth stat, the sooner each harvest comes around. A 31-Growth plant
            regrows {good("about five times faster")} than a 1-Growth one.
          </p>
          <p className="text-slate-300">
            In the game you raise Growth by cross-breeding crops between double crop sticks.
          </p>
        </CropHelpPanel>
      );
    case "cropGainStat":
      return (
        <CropHelpPanel
          title="Gain"
          finePrint={
            <>
              drop rounds = {stats.dropChance.toFixed(3)} × 1.03^Gain, and every successful drop
              has a (Gain + 1)% chance of one bonus item.
            </>
          }
        >
          <p>
            The higher the Gain stat, the more items each harvest gives. At 31 you collect{" "}
            {good("roughly 2.5× as much")} as at 1.
          </p>
          <p className="text-slate-300">
            Like Growth, it&apos;s raised by cross-breeding. It never changes how fast the plant
            grows, only how much it drops.
          </p>
        </CropHelpPanel>
      );
    case "cropWater":
      return (
        <CropHelpPanel
          title="Water"
          feeding={{ tier: stats.tier }}
          finePrint={<>water bonus = floor((water + 9) ÷ 10): 0 → +1, 50 → +5, 100 → +10.</>}
        >
          <p>
            Full water is {good("+10 food")}, one of the two biggest boosts you control.
          </p>
          <p className="text-slate-300">
            A Crop Manager keeps water at full automatically, so &quot;Full&quot; matches an
            automated farm.
          </p>
        </CropHelpPanel>
      );
    case "cropFertilizer":
      return (
        <CropHelpPanel
          title="Fertilizer"
          feeding={{ tier: stats.tier }}
          finePrint={<>fertilizer bonus = floor((fertilizer + 9) ÷ 10): 0 → +1, 50 → +5, 100 → +10.</>}
        >
          <p>
            Fertilizer works like water: keeping it full is {good("+10 food")}. Without it a
            high-tier crop {bad("slows down or stops")}.
          </p>
          <p className="text-slate-300">
            Crop Managers and Industrial Farms can supply it for you.
          </p>
        </CropHelpPanel>
      );
    case "cropSky":
      return (
        <CropHelpPanel
          title="Sky"
          feeding={{ tier: stats.tier }}
          finePrint={<>sky bonus = +2 when the block above the crop can see the sky.</>}
        >
          <p>
            Plants under open sky get a small {good("+2 food")} bonus. Roofed or underground farms
            lose it. That only matters when the crop is close to being underfed.
          </p>
        </CropHelpPanel>
      );
    case "cropBiome":
      return (
        <CropHelpPanel
          title="Biome"
          feeding={{ tier: stats.tier }}
          finePrint={
            <>
              biome bonus = max(humidity, likes): each matching tag +14, capped at 2 tags; humidity
              scales 0–14 between 50% and 80% biome humidity.
            </>
          }
        >
          <p>
            {biomeTags.length > 0 ? (
              <>
                This crop likes{" "}
                <span className="text-white">{biomeTags.join(" and ").toLowerCase()}</span> places.
              </>
            ) : (
              <>This crop has no favourite biome.</>
            )}{" "}
            Each matching like is {good("+14 food")}, so matching both is {good("+28")}, the
            biggest feeding boost there is.
          </p>
          <p className="text-slate-300">
            Without a matching biome, humidity stands in for one like: the percent options are the
            biome&apos;s humidity, worth +4 at 60%, +9 at 70% and the full +14 at 80% or wetter
            (a swamp or jungle). It never stacks with real likes.
          </p>
        </CropHelpPanel>
      );
    default:
      return undefined;
  }
}

function shortConfigLabel(resource: ResourceAmount) {
  const label = resource.displayName ?? resource.id;
  if (/^\d+(\/\d+)*$/.test(label)) {
    // A number is already short, and initialling it ate digits: a slice count
    // of "55" came out as "5".
    return label;
  }
  if (label.length <= 4) {
    return label.toUpperCase();
  }
  return label
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 4)
    .toUpperCase();
}

function formatMachineParallelMultiplier(multiplier: number) {
  return Number.isInteger(multiplier)
    ? String(multiplier)
    : multiplier.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

type ConnectionSlotState = "idle" | "selected" | "compatible";

function getConnectionSlotState(
  pending: ReturnType<typeof useFactoryStore.getState>["pendingResourceConnection"],
  nodeId: string,
  side: "input" | "output",
  kind: string,
  resourceId: string,
  alternatives: Recipe["inputs"][number]["alternatives"],
  handleId: string,
): ConnectionSlotState {
  if (!pending) {
    return "idle";
  }

  // Ports carry canonical (index-less) ids while a pending selection can hold
  // a legacy per-slot id; compare on the canonical form.
  if (
    pending.nodeId === nodeId &&
    canonicalizeResourceHandleId(pending.handleId) === canonicalizeResourceHandleId(handleId)
  ) {
    return "selected";
  }

  if (pending.nodeId !== nodeId && pending.side !== side && pending.kind === kind) {
    const pendingResource = {
      kind: pending.kind,
      id: pending.resourceId,
      alternatives: pending.alternatives,
    };
    const slotResource = { kind, id: resourceId, alternatives };
    const input = side === "input" ? slotResource : pendingResource;
    const output = side === "output" ? slotResource : pendingResource;

    if (resourceMatchesInput(output, input)) {
      return "compatible";
    }
  }

  return "idle";
}

/** Solve mode's machine figure: the smaller the count, the more decimals it
 * earns - a x0.0417 sliver is a real answer and rounding it to x0.04 hides
 * a fifth of it. Big counts stay whole. */
function formatSolvedMachines(value: number): string {
  if (value <= 0.0000005) {
    return "0";
  }
  // Below the finest step the cell can print, say so rather than rounding a
  // real sliver to nothing.
  if (value < 0.0005) {
    return "<0.001";
  }
  if (value >= 100) {
    return String(Math.ceil(value - 0.000001));
  }
  const decimals = value < 1 ? 3 : value < 10 ? 2 : 1;
  return value.toFixed(decimals).replace(/\.?0+$/, "");
}

/**
 * The solve-mode replacement for the count stepper: how many of this machine
 * the typed product amounts require. The count is normally the ANSWER - but
 * clicking it PINS it ("run exactly 20 of these; solve the rest of the
 * line"), the same dotted-underline-and-pencil invitation the product
 * drawer's amount wears. A pinned count shows gold; emptying the field
 * unpins and hands the count back to the solver.
 */
function SolvedMachinesStat({
  label,
  needed,
  pinned,
  onPin,
}: {
  label: string;
  needed: number;
  pinned: number | undefined;
  onPin: (machines: number | undefined) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const isPinned = pinned !== undefined && pinned > 0;
  const whole = Math.ceil(needed - 0.000001);
  const pct = whole > 0 ? Math.round((needed / whole) * 100) : 0;
  const title = isPinned
    ? `Pinned: exactly ${formatSolvedMachines(pinned)} run and the line solves around them. Click to change; empty unpins.`
    : needed <= 0.0000005
      ? "No product amount needs this machine. Click to pin a count and solve the line around it."
      : `Build ${whole} and run at ${pct}%. Click to pin a count instead.`;
  const commit = () => {
    setEditing(false);
    if (draft.trim() === "") {
      onPin(undefined);
      return;
    }
    const value = Number.parseFloat(draft.trim());
    if (Number.isFinite(value) && value > 0) {
      onPin(value);
    }
  };
  return (
    <div
      title={title}
      className="min-w-0 border border-[var(--mc-47)] bg-[var(--mc-71)] px-1 shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]"
    >
      {/* The label stays MACHINES either way - it never stops being one.
          The gold value is what says the count is pinned. */}
      <div className="truncate text-[11px] uppercase leading-[13px] text-[var(--mc-ink-muted)]">
        {label}
      </div>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              setEditing(false);
            }
            event.stopPropagation();
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          inputMode="decimal"
          aria-label="Pinned machine count"
          className="nodrag h-5 w-full min-w-0 border border-[var(--mc-47)] bg-[var(--mc-85)] px-1 text-center text-[13px] font-medium leading-4 text-[var(--mc-ink)] outline-none focus:border-cyan-700 focus:ring-1 focus:ring-cyan-400"
        />
      ) : (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setDraft(isPinned ? formatSolvedMachines(pinned) : "");
            setEditing(true);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          aria-label={isPinned ? "Change the pinned machine count" : "Pin a machine count"}
          className="nodrag group/pin flex w-full min-w-0 items-center gap-[3px] text-left"
        >
          <span
            className={[
              "truncate font-medium tabular-nums underline decoration-dotted decoration-[1.5px] underline-offset-[3px]",
              isPinned
                ? "text-[#ffd257]"
                : needed <= 0.0000005
                  ? "text-[var(--mc-ink-muted)]"
                  : "",
            ].join(" ")}
          >
            {!isPinned && needed > 0.0000005 && needed < 0.0005 ? (
              // A sliver below the finest printable step: a quiet small
              // grey < in place of the × so it reads "less than 0.001".
              <>
                <span className="text-[9px] font-normal text-[var(--mc-ink-muted)]">{"<"}</span>
                0.001
              </>
            ) : (
              <>×{formatSolvedMachines(isPinned ? pinned : needed)}</>
            )}
          </span>
          <Pencil
            aria-hidden
            className="h-[9px] w-[9px] shrink-0 translate-y-[1.5px] fill-current text-[var(--mc-ink-muted)] group-hover/pin:text-[var(--mc-ink)]"
          />
        </button>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="min-w-0 border border-[var(--mc-47)] bg-[var(--mc-71)] px-1 shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
      <div className="truncate text-[11px] uppercase leading-[13px] text-[var(--mc-ink-muted)]">{label}</div>
      <div className={["truncate font-medium", valueClassName ?? ""].join(" ")}>{value}</div>
    </div>
  );
}

/**
 * The card's power cell: what the build drinks, in the board's rate unit —
 * or, when the game would refuse to start this configuration, the stall
 * instead, pulsing. The hover is the whole story: pool, parallels,
 * overclocks, and the fix. GT has no slow mode, so there is no third thing
 * to say.
 */
function PowerStat({
  report,
  machineCount,
  nodeParallel,
  utilization,
  average,
}: {
  report: NodePowerReport;
  machineCount: number;
  nodeParallel: number;
  utilization?: number;
  /** The right panel's PEAK/AVG switch; see drawScaleFor. */
  average: boolean;
}) {
  const stalled = report.state !== "ok";
  // Always EU/t, whatever the board's rate unit: power is a per-tick fact in
  // GT and reads as noise in any other clock. The unit itself is rendered as
  // a small suffix below, not part of this string. The figure follows the
  // PEAK/AVG switch; the hover still tells the build's whole story.
  const drawEuT =
    report.drawEuT * machineCount * nodeParallel * drawScaleFor(average, utilization);

  return (
    <MinecraftTooltip
      content={
        <PowerStoryContent
          report={report}
          utilization={utilization}
          machines={machineCount * nodeParallel}
        />
      }
    >
      <div
        className={[
          "min-w-0 border px-1",
          stalled
            ? "animate-pulse border-red-700 bg-red-950/60 text-red-300"
            : "border-[var(--mc-47)] bg-[var(--mc-71)] shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]",
        ].join(" ")}
      >
        <div
          className={[
            "truncate text-[11px] uppercase leading-[13px]",
            stalled ? "text-red-400" : "text-[var(--mc-ink-muted)]",
          ].join(" ")}
        >
          Power
        </div>
        <div className="truncate font-medium tabular-nums">
          {stalled ? (
            report.state === "under-powered" ? (
              "LOW!"
            ) : (
              "TIER!"
            )
          ) : (
            <>
              {/* The number glides on the board's value clock like every
                  other figure; mid-flight frames use the stable-width form so
                  the text does not vibrate, and the landing frame rests on
                  the clean compact one. */}
              <MotionNumberText
                values={[drawEuT]}
                render={(shown) =>
                  shown[0] === drawEuT
                    ? formatCompact(powerDisplayFromEuT(drawEuT))
                    : formatCompactStable(powerDisplayFromEuT(shown[0] ?? drawEuT))
                }
              />
              {/* The unit rides small and grey against the number: the row
                  is fighting for width; the unit is the board's power dial. */}
              <span className="ml-0.5 text-[8px] text-[var(--mc-ink-muted)]">
                {powerDisplaySuffix()}
              </span>
            </>
          )}
        </div>
      </div>
    </MinecraftTooltip>
  );
}

/**
 * The steam machines' power cell: litres per second, the figure a boiler bank
 * is sized against. Per second because that is how the game's own WAILA quotes
 * it. The hover carries the arithmetic; nothing here can stall, because a
 * steam machine either has steam or sits still and the planner assumes supply.
 */
function SteamStat({
  report,
  machineCount,
  nodeParallel,
  utilization,
  average,
}: {
  report: NodeSteamReport;
  machineCount: number;
  nodeParallel: number;
  utilization?: number;
  /** The right panel's PEAK/AVG switch; see drawScaleFor. */
  average: boolean;
}) {
  // Same rule as the POWER cell: the figure follows the PEAK/AVG switch;
  // the hover still quotes the per-machine burn.
  const drawLitresPerSecond =
    steamDrawLitresPerSecond(report, { machineCount, parallel: nodeParallel }) *
    drawScaleFor(average, utilization);
  const perMachine = report.drawSteamPerTick * 20;

  return (
    <MinecraftTooltip
      content={
        <div className="w-60 space-y-1">
          <div className="text-[13px] font-semibold text-white">Burns steam, not EU</div>
          <div className="text-[11px] leading-4 text-slate-300">
            {report.isMultiblock ? (
              <>
                One machine burns {formatCompact(perMachine)} L/s at full speed:{" "}
                {formatCompact(report.singleDrawSteamPerTick)} L/t per recipe across{" "}
                {report.parallels} parallels.
              </>
            ) : (
              <>One machine burns {formatCompact(perMachine)} L/s while running.</>
            )}
          </div>
          <div className="text-[11px] leading-4 text-slate-300">
            {report.highPressure
              ? "High pressure builds run twice as fast and burn twice the steam."
              : "A high pressure build runs twice as fast and burns twice the steam."}
          </div>
        </div>
      }
    >
      <div className="min-w-0 border border-[var(--mc-47)] bg-[var(--mc-71)] px-1 shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
        <div className="truncate text-[11px] uppercase leading-[13px] text-[var(--mc-ink-muted)]">
          Steam
        </div>
        <div className="truncate font-medium tabular-nums">
          <MotionNumberText
            values={[drawLitresPerSecond]}
            render={(shown) =>
              shown[0] === drawLitresPerSecond
                ? formatCompact(drawLitresPerSecond)
                : formatCompactStable(shown[0] ?? drawLitresPerSecond)
            }
          />
          <span className="ml-0.5 text-[8px] text-[var(--mc-ink-muted)]">L/s</span>
        </div>
      </div>
    </MinecraftTooltip>
  );
}

/** A tier's name in its own paint, for the power story's diagram rows. */
function StoryTierChip({ tier }: { tier: NodePowerReport["tier"] }) {
  const color = GT_TIER_COLORS[tier];
  return (
    <span
      className="inline-block border px-1 text-[10px] font-bold leading-[14px]"
      style={{
        backgroundColor: color.background,
        borderColor: color.border,
        color: color.text,
        textShadow: `1px 1px 0 ${color.shadow}`,
      }}
    >
      {tier}
    </span>
  );
}

/**
 * One beat of the power story, boxed but never titled: the grouping alone
 * says "new thought", so the fact lines inside stay bare.
 */
function StoryCard({ children }: { children: ReactNode }) {
  return <div className="space-y-1 border border-white/10 bg-white/[0.04] px-2 py-1.5">{children}</div>;
}

/** Slots the spend bar can lerp between; comfortably past GT's tier count. */
const SPEND_BAR_SLOTS = 17;
/** The bar's content width in px, for judging whether a label fits. */
const SPEND_BAR_WIDTH_PX = 364;

/**
 * The budget as a bar, spent left to right, TO SCALE: the track's full width
 * is the supply from the line above, the first slice is the recipe's own
 * draw, and each overclock is the slice of budget it cost — so every later
 * overclock is visibly ~3× wider than everything before it, which is the
 * whole exponential mechanic drawn as widths. Whatever the slices leave
 * unspent is the hatched SPARE tail (labeled when it has the room): budget
 * held but too little for the next step, whose price the line hanging under
 * the bar's right end names.
 *
 * Slices are inscribed where room allows — "recipe" on the first, the speed
 * reached (×2, ×4 …) on each overclock — cyan for perfect steps, amber for
 * regular ones.
 *
 * The drawing lerps on the board's value-motion clock, like any other
 * number: a fresh hover mounts it settled, and a tier or hatch click made
 * while the panel is held up eases every boundary to its new fraction of
 * the new budget. The lerped vector is the cumulative spend at each slot,
 * padded to a fixed length so gained and lost slices grow and shrink
 * smoothly; labels snap to the target shape and are revealed by their
 * growing slices.
 */
function StoryOverclockBar({
  perfectSteps,
  normalSteps,
  perfectSpeedFactor,
  perfectEuFactor,
  batchEuT,
  poolEuT,
}: {
  perfectSteps: number;
  normalSteps: number;
  perfectSpeedFactor: number;
  perfectEuFactor: number;
  /** One batch's un-overclocked draw: the bar's first slice. */
  batchEuT: number;
  /** The supply: the track's full width. */
  poolEuT: number;
}) {
  const { valueMotion } = useBoardMotion();
  const taken = perfectSteps + normalSteps;
  // Draw and speed once `steps` overclocks are bought: perfect steps first.
  const cumulativeEuT = (steps: number) =>
    batchEuT *
    perfectEuFactor ** Math.min(steps, perfectSteps) *
    4 ** Math.max(0, steps - perfectSteps);
  const speedAfter = (steps: number) =>
    perfectSpeedFactor ** Math.min(steps, perfectSteps) * 2 ** Math.max(0, steps - perfectSteps);
  const fractions = useMotionValues(
    Array.from({ length: SPEND_BAR_SLOTS }, (_, slot) =>
      Math.min(1, cumulativeEuT(Math.min(slot, taken)) / poolEuT),
    ),
    valueMotion,
  );
  if (!(Number.isFinite(poolEuT) && poolEuT > 0)) {
    return null;
  }
  const spareEuT = Math.max(0, poolEuT - cumulativeEuT(taken));
  const sparePx = (1 - fractions[SPEND_BAR_SLOTS - 1]) * SPEND_BAR_WIDTH_PX;

  return (
    <div aria-hidden>
      <div className="relative h-4 border border-slate-600">
      {Array.from({ length: SPEND_BAR_SLOTS }, (_, slot) => {
        const startPct = (slot === 0 ? 0 : fractions[slot - 1]) * 100;
        const widthPct = fractions[slot] * 100 - startPct;
        if (widthPct <= 0.15) {
          return null;
        }
        const widthPx = (widthPct / 100) * SPEND_BAR_WIDTH_PX;
        const kind = slot === 0 ? "recipe" : slot <= perfectSteps ? "perfect" : "normal";
        const label =
          slot === 0
            ? widthPx >= 48
              ? "recipe"
              : undefined
            : slot <= taken && widthPx >= 26
              ? `×${trimFactor(speedAfter(slot))}`
              : undefined;
        return (
          <div
            key={slot}
            className={[
              "absolute inset-y-0 overflow-hidden",
              kind === "recipe"
                ? "bg-slate-400/50"
                : kind === "perfect"
                  ? "bg-cyan-400/60"
                  : "bg-amber-300/60",
            ].join(" ")}
            style={{ left: `${startPct}%`, width: `calc(${widthPct}% - 1px)` }}
          >
            {label ? (
              <span className="absolute inset-0 flex items-center justify-center whitespace-nowrap text-[10px] leading-none text-white [text-shadow:1px_1px_0_rgba(0,0,0,0.8)]">
                {label}
              </span>
            ) : null}
          </div>
        );
      })}
      {/* The unspent tail, hatched so it reads as budget deliberately held —
          too little for the next step, whose price hangs right under it. */}
      <span
        className="absolute inset-y-0 right-0"
        style={{
          left: `${fractions[SPEND_BAR_SLOTS - 1] * 100}%`,
          backgroundImage:
            "repeating-linear-gradient(135deg, rgba(148,163,184,0.3) 0 2px, transparent 2px 6px)",
        }}
      />
        {sparePx >= 64 ? (
          <span
            className="absolute inset-y-0 right-0 flex items-center justify-center whitespace-nowrap text-[10px] leading-none text-slate-400"
            style={{ left: `${fractions[SPEND_BAR_SLOTS - 1] * 100}%` }}
          >
            spare {formatCompact(spareEuT)}
          </span>
        ) : null}
      </div>
      {/* The axis, named: the whole track is exactly the budget from the
          balance card, zero at the left. Without these two figures the
          range read as arbitrary. */}
      <div className="flex justify-between text-[9px] leading-3 text-slate-500">
        <span>0</span>
        <span>{formatCompact(poolEuT)} EU/t</span>
      </div>
    </div>
  );
}

function trimFactor(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/** Usage as the card's own percent: one decimal only while a whole number
 * would round a running machine down to a flat 0%. */
function usagePctText(usage: number): string {
  const pct = usage * 100;
  return pct > 0 && pct < 0.5 ? formatRate(pct, 1) : formatPct(pct);
}

/**
 * THE power tooltip, one panel shared by every power surface on the card:
 * the hatch chip, the tier chip, and the footer's POWER cell all say this,
 * so wherever the hover lands the language is the same.
 *
 * One title — "Overclocking", what the whole panel is about — then three
 * little CARDS, unlabeled, in the order the game spends
 * the supply: the balance (what the build gets you to spend), the recipe and
 * where you're at (its cost, the parallels paid first, and the spend drawn
 * as a bar to scale — StoryOverclockBar), and the outcome (what it runs at,
 * with the next overclock's price as the last word). Everything here is
 * EU/t — never seconds, which no other surface on the card speaks — and the
 * whole-node total stays off it: the footer cells under the cursor already
 * say it. Usage closes the outcome, once: the peak figure is what the
 * machine draws while running, and a machine running part of the time
 * averages peak times usage. The bar is drawn only when the arithmetic
 * reproduces the real draw — runtime-ladder machines, whose step kinds the
 * game never exported, get the honest count alone.
 */
function PowerStoryContent({
  report,
  utilization,
  machines = 1,
}: {
  report: NodePowerReport;
  /** The solve's usage for this card, when one is known: 0..1+. */
  utilization?: number;
  /** Machine count times node parallel: what the POWER cell multiplies by.
   * The story is told per machine, so the outcome names both figures or the
   * conclusion contradicts the cell under the cursor. */
  machines?: number;
}) {
  const stall = describePowerStall(report);
  const usage =
    utilization === undefined ? undefined : Math.min(1, Math.max(0, utilization));
  const cardPeakEuT = report.drawEuT * machines;
  const perRunEuT = report.parallels > 0 ? report.drawEuT / report.parallels : report.drawEuT;
  const normalSteps = Math.max(0, report.overclockSteps - report.perfectOverclockSteps);
  const expectedEuT =
    report.singleDrawEuT *
    report.perfectEuFactor ** report.perfectOverclockSteps *
    4 ** normalSteps;
  const ladderHonest =
    report.overclockSteps === 0 ||
    Math.abs(expectedEuT - perRunEuT) <= Math.max(2, perRunEuT * 0.02);
  // "perfect" is the standard ×4/×4 deal; a machine with its own factors
  // (arc electrodes and kin) is called by the honest generic word instead.
  const perfectWord =
    report.perfectSpeedFactor === 4 && report.perfectEuFactor === 4 ? "perfect" : "machine";

  const batchEuT = report.singleDrawEuT * report.parallels;
  // How many times over the budget covers one batch, said the way a player
  // would: whole numbers once it's big, one decimal while it's close.
  const powerRatio = report.poolEuT / Math.max(1, batchEuT);
  const ratioText =
    powerRatio >= 9.95 ? String(Math.round(powerRatio)) : trimFactor(Math.round(powerRatio * 10) / 10);
  // What the untaken step would bill, the way the game bills it: whole
  // powers of four over the batch draw, floored at 32 ("treat ULV as LV").
  const nextStepEuT = Math.max(batchEuT, 32) * 4 ** (report.overclockSteps + 1);
  const nextSpeedLabel = trimFactor(
    report.perfectSpeedFactor ** report.perfectOverclockSteps * 2 ** (normalSteps + 1),
  );

  return (
    <div className="w-96 space-y-1.5 text-[12px] leading-4 text-slate-200">
      {/* The one title the panel keeps: what ALL of this is about. */}
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-300">
        Overclocking
      </div>
      {/* The balance. The nowrap keeps a line break from stranding the
          figure's unit on its own line. */}
      <StoryCard>
        <div>
          {report.isMultiblock ? (
            <>
              {report.hatchTypeLabel ? (
                <>
                  A <StoryTierChip tier={report.tier} /> {report.hatchTypeLabel} gets you
                </>
              ) : (
                <>
                  {report.hatches}× <StoryTierChip tier={report.tier} /> energy{" "}
                  {report.hatches === 1 ? "hatch gets" : "hatches get"} you
                </>
              )}{" "}
              <span className="whitespace-nowrap">
                <span className="font-bold">{formatCompact(report.poolEuT)} EU/t</span>
              </span>{" "}
              to spend
              {report.amps > 1 ? ` (${formatCompact(report.amps)} A)` : ""}
            </>
          ) : (
            <>
              <StoryTierChip tier={report.tier} /> machine gets you{" "}
              <span className="whitespace-nowrap">
                <span className="font-bold">{formatCompact(report.poolEuT)} EU/t</span>
              </span>{" "}
              to spend{report.amps > 1 ? ` (${report.amps} A)` : ""}
            </>
          )}
        </div>
      </StoryCard>

      {/* The recipe, and where you're at. */}
      <StoryCard>
        {report.parallels > 1 ? (
          <div>
            ×{report.parallels} recipes at once,{" "}
            <span className="whitespace-nowrap">
              {formatCompact(report.singleDrawEuT)} EU/t each
            </span>
            :{" "}
            <span className="whitespace-nowrap">
              <span className="font-bold">{formatCompact(batchEuT)} EU/t</span>
            </span>
          </div>
        ) : (
          <div>
            <StoryTierChip tier={report.minimumTier} /> recipe:{" "}
            <span className="whitespace-nowrap">
              <span className="font-bold">{formatCompact(report.singleDrawEuT)} EU/t</span>
            </span>
          </div>
        )}
        {ladderHonest ? (
          <StoryOverclockBar
            perfectSteps={report.perfectOverclockSteps}
            normalSteps={normalSteps}
            perfectSpeedFactor={report.perfectSpeedFactor}
            perfectEuFactor={report.perfectEuFactor}
            batchEuT={batchEuT}
            poolEuT={report.poolEuT}
          />
        ) : null}
        {/* The deal, spelled out: the ratio, the count it buys, and what
            this machine's KIND of overclock trades — regular pays ×4 power
            for only ×2 speed, perfect gets the full ×4 back. The kind is the
            machine's own nature (only the heat machines ever mix the two,
            when spare coil heat upgrades the first steps), so the sentence
            states it as a fact about the machine, in its slices' colour. */}
        {ladderHonest && Number.isFinite(report.poolEuT) && report.poolEuT > 0 ? (
          <div className="text-[11px] leading-4 text-slate-400">
            You have <span className="text-slate-200">{ratioText}×</span> the power this recipe
            needs.{" "}
            {report.overclockSteps > 0 ? (
              <>
                Each whole ×4 of that buys an overclock, so {report.overclockSteps} fire
                {report.overclockSteps === 1 ? "s" : ""}.{" "}
                {report.perfectOverclockSteps > 0 && normalSteps > 0 ? (
                  <>
                    The first {report.perfectOverclockSteps === 1 ? "is" : `${report.perfectOverclockSteps} are`}{" "}
                    <span className="text-cyan-300">
                      {perfectWord}: ×{trimFactor(report.perfectEuFactor)} power buys the full ×
                      {trimFactor(report.perfectSpeedFactor)} speed
                    </span>
                    ; the rest {normalSteps === 1 ? "is" : "are"}{" "}
                    <span className="text-amber-300">regular: ×4 power buys only ×2 speed</span>.
                  </>
                ) : report.perfectOverclockSteps > 0 ? (
                  <span className="text-cyan-300">
                    {perfectWord === "perfect"
                      ? "This machine overclocks perfectly: every ×4 power buys the full ×4 speed, no energy wasted."
                      : `This machine overclocks its own way: ×${trimFactor(report.perfectEuFactor)} power buys ×${trimFactor(report.perfectSpeedFactor)} speed.`}
                  </span>
                ) : (
                  <span className="text-amber-300">
                    This machine&apos;s overclocks are regular: ×4 power buys only ×2 speed.
                  </span>
                )}
              </>
            ) : (
              <>An overclock takes a whole ×4, so none fire yet.</>
            )}
          </div>
        ) : null}
      </StoryCard>

      {/* The outcome, plainly: what it all lands at, then the next rung's
          price. No tier chip opening the card — the conclusion is a number,
          not a tier. */}
      <StoryCard>
        <div>
          {machines > 1 ? (
            <>
              So at peak each machine runs at{" "}
              <span className="whitespace-nowrap">{formatCompact(report.drawEuT)} EU/t</span>:{" "}
              <span className="whitespace-nowrap">
                <span className="font-bold">{formatCompact(cardPeakEuT)} EU/t</span>
              </span>{" "}
              across {machines}
            </>
          ) : (
            <>
              So at peak it runs at{" "}
              <span className="whitespace-nowrap">
                <span className="font-bold">{formatCompact(report.drawEuT)} EU/t</span>
              </span>
            </>
          )}
          {!ladderHonest
            ? ` (${report.overclockSteps} overclock${report.overclockSteps === 1 ? "" : "s"})`
            : ""}
          .
        </div>
        {ladderHonest ? (
          <div className="text-[11px] text-slate-400">
            {nextStepEuT > report.poolEuT ? (
              <>
                The next overclock (×{nextSpeedLabel} speed) would take{" "}
                <span className="whitespace-nowrap">{formatCompact(nextStepEuT)} EU/t</span>.
              </>
            ) : (
              <>More power won&apos;t buy another overclock here.</>
            )}
          </div>
        ) : null}
        {usage !== undefined && usage < 0.995 ? (
          <div className="text-[11px] text-slate-400">
            Because {machines > 1 ? "the machines run" : "the machine runs"} at{" "}
            {usagePctText(usage)}%, the average draw is{" "}
            <span className="whitespace-nowrap">
              {formatCompact(cardPeakEuT * usage)} EU/t
            </span>
            .
          </div>
        ) : null}
      </StoryCard>

      {stall ? <div className="font-bold text-red-400">{stall}</div> : null}
    </div>
  );
}

function MachineCountStat({
  label,
  machineCount,
  onChange,
}: {
  label: string;
  machineCount: number;
  onChange: (machineCount: number) => void;
}) {
  const machineCountText = String(machineCount);
  const [draftState, setDraftState] = useState({
    machineCount,
    draft: machineCountText,
  });
  const draft = draftState.machineCount === machineCount ? draftState.draft : machineCountText;

  const commitDraft = (value: string) => {
    const normalized = value.trim();
    if (!/^\d+$/.test(normalized)) {
      return;
    }

    const next = Math.max(1, Number.parseInt(normalized, 10));
    if (Number.isFinite(next) && next !== machineCount) {
      setDraftState({ machineCount: next, draft: String(next) });
      onChange(next);
    }
  };

  const stepBy = (
    direction: 1 | -1,
    modifiers: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
  ) => {
    // Shift steps by 100, Ctrl (or Cmd on mac) by 10 - clicks and wheel alike.
    const step = modifiers.shiftKey ? 100 : modifiers.ctrlKey || modifiers.metaKey ? 10 : 1;
    const next = Math.max(1, machineCount + direction * step);
    if (next !== machineCount) {
      // The tap CLIMBS with the count, two rungs per decade capped at rung
      // six (~1kHz): a crop card legitimately holds tens of thousands of
      // seeds, and the full ladder up there was a dog whistle.
      playBoardSound("dialRate", { step: Math.min(6, Math.log10(Math.max(1, next)) * 2) });
      suppressBoardSound("adjust", 150);
      setDraftState({ machineCount: next, draft: String(next) });
      onChange(next);
    }
  };

  const stepButtonClassName =
    "nodrag flex h-5 w-5 shrink-0 items-center justify-center border border-[var(--mc-33)] bg-[var(--mc-82)] text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-100),inset_-1px_-1px_0_var(--mc-47)] hover:bg-[var(--mc-100)] active:shadow-[inset_1px_1px_0_var(--mc-47),inset_-1px_-1px_0_var(--mc-100)]";

  return (
    <div
      className="nodrag nowheel min-w-0 border border-[var(--mc-47)] bg-[var(--mc-71)] px-1 shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]"
      // The wheel walks the count too, with the same shift/ctrl multipliers
      // the buttons take. "nowheel" keeps React Flow from zooming under it.
      onWheel={(event) => {
        event.stopPropagation();
        stepBy(event.deltaY < 0 ? 1 : -1, event);
      }}
    >
      <div className="truncate text-[11px] uppercase leading-[13px] text-[var(--mc-ink-muted)]">{label}</div>
      <div className="flex min-w-0 items-center gap-0.5">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            stepBy(-1, event);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          className={stepButtonClassName}
          title="Remove 1"
          aria-label={`Decrease ${label.toLowerCase()} count`}
        >
          <Minus className="h-3 w-3" />
        </button>
        <input
          value={draft}
          onChange={(event) => {
            const nextDraft = event.target.value;
            setDraftState({ machineCount, draft: nextDraft });
            commitDraft(nextDraft);
          }}
          onBlur={() => {
            if (!/^\d+$/.test(draft.trim())) {
              setDraftState({ machineCount, draft: machineCountText });
            }
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          inputMode="numeric"
          aria-label={`${label} count`}
          title={`Edit ${label.toLowerCase()} count`}
          className="nodrag h-[21px] w-0 min-w-0 flex-1 border border-[var(--mc-47)] bg-[var(--mc-85)] px-1 text-center text-[14px] font-medium leading-4 text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-100),inset_-1px_-1px_0_var(--mc-54)] outline-none focus:border-cyan-700 focus:bg-[var(--mc-100)] focus:ring-1 focus:ring-cyan-400"
        />
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            stepBy(1, event);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          className={stepButtonClassName}
          title="Add 1"
          aria-label={`Increase ${label.toLowerCase()} count`}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

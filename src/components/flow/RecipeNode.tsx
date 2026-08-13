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
import { ChevronDown, Copy, Minus, Pickaxe, Plus, Sprout } from "lucide-react";
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
  applyMachineOutputMultipliers,
  getMachineParallelMultiplier,
} from "@/lib/solver/machine-effects";
import {
  formatCompact,
  formatRate,
  applyMachineHandlerToRecipe,
  GT_OVERCLOCK_TIERS,
  getHighestFiniteVoltageTier,
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
  getMiningSourceInfo,
  type MiningDimension,
  type MiningSourceInfo,
} from "@/lib/model/mining-source";
import { rateUnitMultiplier, rateUnitPrecisionScale, rateUnitSuffix } from "@/lib/model/rate-unit";
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
import { MinecraftTooltip } from "@/components/nei/MinecraftTooltip";
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
import {
  edgeTouchesResource,
  explainPlug,
  explainPort,
  formatPct,
  formatSlotRate,
  formatSlotRateBare,
  formatSlotRateOrNull,
  formatTimes,
  type PortStory,
} from "./flow-explainers";
import { useFactoryStore } from "@/store/factory-store";
import { GT_NODE_COLORS, heatmapColorFor, heatmapRamp, rampFor } from "./node-colors";
import { useBoardView } from "./board-view";
import { MotionNumberText } from "./board-motion";
import { getPaintBrushCursor } from "./paint-cursor";
import { GT_TIER_COLORS } from "./tier-colors";

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
  const recipeSearch = useFactoryStore((state) => state.highlightSearch);
  const hoveredFlowResourceKey = useFactoryStore((state) => state.hoveredFlowResourceKey);
  const selectedFlowResourceKey = useFactoryStore((state) => state.selectedFlowResourceKey);
  const hoveredNodeBottlenecks = useFactoryStore((state) => state.hoveredNodeBottlenecks);
  const selectedNodeBottlenecks = useFactoryStore((state) => state.selectedNodeBottlenecks);
  const deleteNode = useFactoryStore((state) => state.deleteNode);
  const duplicateNode = useFactoryStore((state) => state.duplicateNode);
  const updateNode = useFactoryStore((state) => state.updateNode);
  const nodeColorPaintMode = useFactoryStore((state) => state.nodeColorPaintMode);
  const pendingResourceConnection = useFactoryStore((state) => state.pendingResourceConnection);
  const dataset = useFactoryStore((state) => state.dataset);
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
  // Heatmap wins over the paint tag while it is on, and gives it straight back
  // when it goes off — the tag is never written to or lost.
  const { heatmapMode, calmMode, glanceMode } = useBoardView();
  // A custom rate card nobody has painted wears the app's own blue. Painting
  // one still works and still wins.
  const paintTag = projectNode.colorTag ?? (isCustomRateRecipe(recipe) ? "blue" : undefined);
  const paintColor = paintTag ? GT_NODE_COLORS[paintTag] : undefined;
  const heatColor = heatmapMode
    ? heatmapColorFor(result?.utilization, projectNode.enabled !== false)
    : undefined;
  const nodeColor = heatColor ?? paintColor;
  // The card's own --mc-* ramp, which is the WHOLE of how a card takes a
  // colour: every surface inside already reads these tokens, so redefining
  // them here paints the dropdowns, the block beside them, the machine tabs,
  // the head buttons, the plugs and everything else without one of them
  // having to know. See GT_NODE_RAMPS.
  // The ink is never touched: a ramp keeps an unpainted card's lightnesses,
  // so the same light text sits at the same contrast on every colour.
  const nodeRamp = heatColor ? heatmapRamp(heatColor.panel) : rampFor(paintTag);
  const paintCursor =
    nodeColorPaintMode !== undefined
      ? getPaintBrushCursor(
          nodeColorPaintMode ? GT_NODE_COLORS[nodeColorPaintMode].swatch : undefined,
        )
      : undefined;
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
      // The coil knob still has its own legacy field; a preview that only
      // wrote the generic map would show nothing on a heating coil.
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
    // Mining source cards (ore veins, small ores, underground fluids): the
    // raw recipe carries the worldgen facts in its metadata, and the title
    // borrows the crop pattern - the vein's own name, not the machine type.
    const miningSource = getMiningSourceInfo(recipe);
    const miningTitle =
      miningSource && recipe.name.includes(": ")
        ? recipe.name.slice(recipe.name.indexOf(": ") + 2)
        : undefined;
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

    return {
      machineHandlers,
      selectedMachineHandler,
      effectiveRecipe,
      recipePowerTier,
      tierControl,
      coilControl,
      coilResource,
      cropProductionControls,
      cropTitle,
      isCropFarmNode,
      isCropFarmPlaceholder,
      miningSource,
      miningTitle,
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
      overclockedRecipe,
      tierColor: tierControl ? GT_TIER_COLORS[tierControl.current] : undefined,
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
    cropTitle,
    isCropFarmNode,
    isCropFarmPlaceholder,
    miningSource,
    miningTitle,
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
    overclockedRecipe,
    tierColor,
  } = derived;
  // Verdict + rail ports read the board lazily (no extra subscription): the
  // node re-renders on every solver tick, which is exactly when any of these
  // numbers can change.
  const { project: liveProject, lastResult } = useFactoryStore.getState();
  const verdict = deriveNodeVerdict(liveProject, lastResult, projectNode.id);
  const rails = buildRailPorts(
    liveProject,
    lastResult,
    projectNode.id,
    overclockedRecipe,
    verdict,
  );
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

    const nextTier = getAdjacentTier(tierControl.current, tierControl.minimum, direction);
    if (nextTier !== tierControl.current) {
      updateNode(projectNode.id, { overclockTier: nextTier });
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
  const machineConfigPanel =
    visibleMachineConfigControls.length > 0 ? (
      <MachineConfigControlPanel
        controls={visibleMachineConfigControls}
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
      <PassiveProductionConfigPanel
        className={CROP_CONFIG_PANEL_WIDTH_CLASS}
        controls={cropProductionControls}
        onSelect={updateMachineConfigTier}
        getControlHelp={(controlId) => cropControlHelp(effectiveRecipe, controlId)}
        title={selectedMachineHandler.label}
        collapsed={projectNode.settingsCollapsed === true}
        onToggleCollapsed={() =>
          updateNode(projectNode.id, {
            settingsCollapsed: !(projectNode.settingsCollapsed === true),
          })
        }
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
  const machineGlanceIcon =
    !isCropFarmNode && !isCustomRateNode
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
    ...(selected ? [{ width: 2, color: "#a855f7" }] : []),
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
        style={
          nodeColor
            ? {
                boxShadow: `inset 0 0 0 2px ${nodeColor.border}, inset 4px 4px 0 var(--mc-100), inset -4px -4px 0 var(--mc-33), 0 0 0 2px ${nodeColor.shadow}`,
              }
            : undefined
        }
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
      {/* The smart view: what this card leads with zoomed out. Identity mode
          (the default) is WHAT it is — machine icon, count and name, with the
          I/O rates revealed on hover by pure CSS. Status mode is the old
          reading: how hard it runs, with the hop map on hover. */}
      {glanceMode === "identity" ? (
        <GlanceIdentityLayer
          machineIcon={machineGlanceIcon}
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
      ) : (
        <NodeGlanceText
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
          className={VERDICT_WORD_CLASS[verdictWord(verdict, isCustomRateNode).tone]}
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
          className={[
            // One head row, exactly two cells tall. The title bar inside it
            // stays 24px and centres in the row — the extra space is the
            // margin that puts the first port centre on a grid line.
            "grid h-[40px] min-w-0 items-center gap-1",
            // Calm mode drops the delete/clone chrome; the title takes the row.
            calmMode
              ? tierControl
                ? "grid-cols-[minmax(0,1fr)_50px]"
                : "grid-cols-[minmax(0,1fr)]"
              : tierControl
                ? "grid-cols-[24px_24px_minmax(0,1fr)_50px]"
                : "grid-cols-[24px_24px_minmax(0,1fr)]",
          ].join(" ")}
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
                title="Clone node (same machine and settings, no wires)"
                aria-label="Clone node"
              >
                <Copy aria-hidden className="h-3.5 w-3.5" />
              </button>
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
                {miningSource ? (
                  /* The card announces itself as dug, not run: absolute like
                     the crop chevron, so the glyph costs no height. */
                  <Pickaxe className="absolute left-1.5 top-1/2 h-3.5 w-3.5 shrink-0 -translate-y-1/2 opacity-70" />
                ) : null}
                <span className="mx-auto min-w-0 truncate">
                  {isCropFarmPlaceholder
                    ? "Pick a crop..."
                    : isCustomRateNode
                      ? // The resource is already on the port right below,
                        // with its icon. Repeating its name in the title only
                        // ever made the card wider.
                        "Custom Rate"
                      : (miningTitle ?? cropTitle ?? previewHandler.label)}
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
          {tierControl && tierColor ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                updateTier(1);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                updateTier(-1);
              }}
              className="nodrag h-6 w-[50px] border-2 px-1 text-[11px] font-bold leading-[18px] shadow-[inset_2px_2px_0_rgba(255,255,255,0.55),inset_-2px_-2px_0_rgba(0,0,0,0.45)] hover:brightness-110"
              style={{
                backgroundColor: tierColor.background,
                borderColor: tierColor.border,
                color: tierColor.text,
                textShadow: `1px 1px 0 ${tierColor.shadow}`,
              }}
              title={`Tier ${tierControl.current}. Left click up, right click down.`}
              aria-label={`Tier ${tierControl.current}`}
            >
              {tierControl.current}
            </button>
          ) : null}
        </div>
        </div>
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
              rails.inputs.length > 0 && rails.outputs.length > 0
                ? "justify-between"
                : rails.outputs.length > 0
                  ? "justify-end"
                  : "justify-start",
            ].join(" ")}
          >
            <PortRail
              nodeId={projectNode.id}
              side="input"
              ports={rails.inputs}
              pending={pendingResourceConnection}
            />
            {rails.inputs.length > 0 && rails.outputs.length > 0 ? (
              <div className="flex w-4 shrink-0 items-center justify-center self-stretch text-[15px] font-black text-[var(--mc-ink-muted)]">
                →
              </div>
            ) : null}
            <PortRail
              nodeId={projectNode.id}
              side="output"
              ports={rails.outputs}
              pending={pendingResourceConnection}
            />
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
              {miningSource ? <MiningSourcePanel info={miningSource} /> : null}
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
                     bare text floated alone on the card face. */
                  <div className="flex min-w-0 items-center justify-center">
                    <span className="truncate border border-[var(--mc-47)] bg-[var(--mc-71)] px-3 py-0.5 text-[20px] font-bold leading-6 tabular-nums text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
                      {projectNode.machineCount}×{" "}
                      {isCropProductionNode
                        ? projectNode.machineCount === 1
                          ? "Seed"
                          : "Seeds"
                        : miningSource
                          ? projectNode.machineCount === 1
                            ? "Miner"
                            : "Miners"
                          : projectNode.machineCount === 1
                            ? "Machine"
                            : "Machines"}
                    </span>
                  </div>
                ) : (
                  <div
                    className={[
                      "grid min-w-0 items-center gap-1",
                      // Every cell sizes to its content except MACHINES, which
                      // takes the slack: a four-digit machine count is the one
                      // number here that legitimately gets wide. Parallel
                      // stretched to fill and then truncated its own label
                      // ("Parall…").
                      isCustomRateNode
                        ? "grid-cols-[auto]"
                        : machineParallelMultiplier > 1
                          ? "grid-cols-[auto_auto_minmax(84px,1fr)]"
                          : "grid-cols-[auto_minmax(84px,1fr)]",
                      isCropProductionNode ? CROP_CONFIG_PANEL_WIDTH_CLASS : "",
                    ].join(" ")}
                  >
                    <UsageStat
                      nodeId={projectNode.id}
                      verdict={verdict}
                      isCustomRate={isCustomRateNode}
                    />
                    {!isCustomRateNode ? (
                      <>
                        {machineParallelMultiplier > 1 ? (
                          <Stat
                            label="Parallel"
                            value={`×${formatMachineParallelMultiplier(machineParallelMultiplier)}`}
                          />
                        ) : null}
                        <MachineCountStat
                          label={
                            isCropProductionNode ? "Seeds" : miningSource ? "Miners" : "Machines"
                          }
                          machineCount={projectNode.machineCount}
                          onChange={(machineCount) => updateNode(projectNode.id, { machineCount })}
                        />
                      </>
                    ) : null}
                  </div>
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
  fallbackResource,
  paintTint,
  label,
  inputs,
  outputs,
}: {
  machineIcon?: MachineHandlerIcon;
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
      className="glance-identity-tile pointer-events-none absolute inset-0 z-10 hidden items-center justify-center"
      style={{
        ...glanceTileStyle(tileTint),
        // The same rim the storage cards show in LED mode: their real
        // border, the tile's colour a step brighter. A recipe card has
        // no real border - its frame is an inset shadow the tile covers -
        // so the tile draws the rim itself, same formula as the drawers'.
        border: `2px solid color-mix(in srgb, ${tileTint} 55%, #262b34)`,
      }}
    >
      {machineIcon ? (
        <ResourceIcon
          resource={{ ...machineIcon, amount: 1 }}
          size="sm"
          bare
          showAmount={false}
          tooltip={false}
          className="!h-[192px] !w-[192px]"
          iconPixelSize={machineArtPixels(192)}
        />
      ) : fallbackResource ? (
        <span className="flex h-[192px] w-[192px] items-center justify-center overflow-hidden">
          <ResourceIcon
            resource={{ ...fallbackResource, amount: 1, chance: undefined }}
            size="sm"
            bare
            showAmount={false}
            tooltip={false}
            // The glance face is measured, not zoom-cropped: the 1.5x trick
            // the rows use overflows a 192px box and read as art spilling
            // off the card at LOD.
            iconPixelSize={
              isSwatchFluid(fallbackResource)
                ? 192
                : fallbackResource.kind === "fluid"
                  ? fluidArtPixels(192)
                  : spriteArtPixels(192)
            }
            className="!h-[192px] !w-[192px]"
          />
        </span>
      ) : null}
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
        <span className="truncate text-[13px] leading-4 tabular-nums text-[var(--mc-ink-muted)]">
          {formatSlotRate(port.currentPerSecond, port.kind)}
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

function verdictWord(verdict: NodeVerdict, isCustomRate: boolean): VerdictWord {
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
    case "demand-set":
      return verdict.pct <= 0.05
        ? { word: "unused", tone: "fine" }
        : { word: isCustomRate ? "under the dial" : "on demand", tone: "fine" };
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
}: {
  nodeId: string;
  verdict: NodeVerdict;
  isCustomRate?: boolean;
}) {
  const state = verdictWord(verdict, isCustomRate);
  const showPct = verdict.kind !== "off" && verdict.kind !== "no-recipe";

  return (
    <MinecraftTooltip
      content={<VerdictHoverContent verdict={verdict} isCustomRate={isCustomRate} />}
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
    case "demand-set":
      return verdict.pct <= 0.05 ? "Nothing draws from this yet" : "Downstream sets the speed";
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
      const supplied = formatSlotRate(binding.suppliedPerSecond, binding.kind);
      const needed = formatSlotRate(binding.neededPerSecond, binding.kind);
      const tied = binding.tiedWithNames?.length
        ? ` Tied with ${binding.tiedWithNames.join(", ")}. Raise either.`
        : "";
      // The two states differ in one thing only: whether the shortage costs
      // anybody anything. Say which, because that is the whole reason one is
      // worth a click and the other is not.
      const cost =
        verdict.kind === "starved"
          ? " Nothing is waiting on it, so nothing here is broken."
          : ` ${
              verdict.deficit
                ? `${formatSlotRate(verdict.deficit.missingPerSecond, verdict.deficit.kind)} of ${verdict.deficit.displayName} goes unmade because of it.`
                : "Downstream goes short because of it."
            }`;
      return `Gets ${supplied}, wants ${needed} at full speed.${cost}${tied}`;
    }
    case "bottleneck": {
      const deficit = verdict.deficit;
      if (!deficit) {
        return undefined;
      }
      const missing = formatSlotRate(deficit.missingPerSecond, deficit.kind);
      return deficit.pluggedOutputs > 1
        ? `${deficit.hungryOutputs} of ${deficit.pluggedOutputs} wired outputs go unfilled, ${missing} short on ${deficit.displayName}.`
        : `${missing} short on ${deficit.displayName}.`;
    }
    case "clogged": {
      const clog = verdict.clog;
      if (!clog) {
        return undefined;
      }
      const spare = formatSlotRate(clog.surplusPerSecond, clog.kind);
      // Nothing takes it at all is a different sentence from some of it is
      // taken, and the first is what a port with no wire on it means.
      if (clog.takenPerSecond <= 0.0005) {
        return `Nothing takes the ${clog.displayName}, so all ${spare} of it would pile up. A machine cannot run with an output it never empties.`;
      }
      const taken = formatSlotRate(clog.takenPerSecond, clog.kind);
      return `Only ${taken} of ${clog.displayName} is taken, so ${spare} would pile up with nowhere to go. That holds the whole machine at ${formatPct(verdict.pct)}%.`;
    }
    case "dead-loop": {
      if (!verdict.spiral) {
        return undefined;
      }
      const story = describeDeathSpiral(verdict.spiral);
      return `${story.what} ${story.why}`;
    }
    case "demand-set":
      return verdict.headroomPct && verdict.headroomPct > 0
        ? `Nothing downstream wants the other ${formatPct(verdict.headroomPct)}%.`
        : undefined;
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
  align?: "center" | "end";
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
          align === "end" ? "flex h-full flex-col justify-end" : "flex h-full flex-col justify-center"
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
      // What a guided tour rings when it explains a card: the whole column of
      // asks, or the whole column of makes. Static attributes, so they cost the
      // board nothing.
      data-tour-part={isInput ? "inputs" : "outputs"}
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
            port.nameplatePerSecond > 0
              ? "Nothing takes this, so it backs up and the machine stops. Wire it to a machine that wants it, a DRAIN drawer, or a trash can."
              : "Empty socket: nothing plugged in."
          }
        >
          {/* The mirror of an input's NO SUPPLY. It used to read "—" beside a
              tooltip saying the output vanished, which is exactly the thing
              that stopped being true when the plan became a closed system. */}
          <span className="flow-socket-empty nodrag">
            <PlugDragHandle nodeId={nodeId} port={port} />
            {port.nameplatePerSecond > 0 ? (
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
      content={renderPlugHoverContent(port, nodeId)}
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
  const browse = (mode: PortBrowseMode) =>
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
  const rateText = (
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
          <span className="block truncate text-[13px] font-bold leading-[15px] tabular-nums text-[var(--mc-ink-muted)]">
            {rateText}
          </span>
        ) : (
          <>
            {/* Neutral, quieter ink: the chip's BAR carries the machine
                story's color. Green text over a red bar told two stories at
                once. */}
            <span className="block truncate text-[10px] leading-[12px] tabular-nums text-[var(--mc-ink-muted)] opacity-80">
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
        content={renderPortHoverContent(port, nodeId)}
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
/**
 * The prospector's line on a mining card: where the vein lives. One fact line
 * (height, richness) and a row of planet chips, each chip carrying the full
 * story in its hover. Static content: chips subscribe to nothing, and a
 * wrapping chip row changes height only when the recipe itself changes, which
 * the surrounding GridBlock absorbs.
 */
function miningDimensionChipLabel(dimension: MiningDimension): string[] {
  return [
    dimension.name,
    dimension.tier !== undefined ? `Rocket tier ${dimension.tier}` : undefined,
    dimension.chance !== undefined ? `${Math.round(dimension.chance * 1000) / 10}% of vein rolls` : undefined,
    dimension.heightRange ? `Y ${dimension.heightRange}` : undefined,
  ].filter((line): line is string => Boolean(line));
}

function MiningSourcePanel({ info }: { info: MiningSourceInfo }) {
  const facts = [
    info.heightRange ? `Y ${info.heightRange}` : undefined,
    info.weight !== undefined ? `Weight ${info.weight}` : undefined,
    info.density !== undefined ? `Density ${info.density}` : undefined,
    info.size !== undefined ? `Size ${info.size}` : undefined,
    info.amountPerChunk !== undefined ? `${info.amountPerChunk}/chunk` : undefined,
  ].filter((fact): fact is string => Boolean(fact));

  return (
    <div className="min-w-0 pb-[6px] pt-[4px] text-[var(--mc-ink)]">
      {facts.length > 0 ? (
        <div className="truncate text-center text-[11px] leading-4 opacity-80">
          {facts.join(" · ")}
        </div>
      ) : null}
      {info.dimensions.length > 0 ? (
        <div className="mt-1 flex min-w-0 flex-wrap items-center justify-center gap-1">
          {info.dimensions.map((dimension) => (
            <MinecraftTooltip key={dimension.name} label={miningDimensionChipLabel(dimension)}>
              <span
                data-tooltip-stop
                className="border border-[var(--mc-47)] bg-[var(--mc-71)] px-1 text-[10px] font-bold leading-[14px] shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]"
              >
                {dimension.abbr ?? dimension.name}
                {dimension.tier !== undefined && dimension.tier > 0 ? ` T${dimension.tier}` : ""}
              </span>
            </MinecraftTooltip>
          ))}
        </div>
      ) : null}
    </div>
  );
}

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
          title="Supply: this card makes the resource at this rate. Flipping turns the card round, so its wires drop and it lets go of the resource. The rate stays."
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
          title="Request: this card drains the resource at this rate, constantly. Flipping turns the card round, so its wires drop and it lets go of the resource. The rate stays."
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
        title="Rate in the board's active unit"
        // Sized to the number, not to the row: `flex-1` made the field claim
        // every spare pixel and the card was permanently as wide as its
        // widest possible contents. In `ch` on a mono font this is exactly
        // the typed digits, so a "5" node is small and a "1000000000" node
        // grows only when it has to.
        style={{ width: `${Math.min(Math.max(draft.length + 2, 5), 16)}ch` }}
        className="nodrag h-6 shrink-0 border border-[var(--mc-33)] bg-[var(--mc-93)] px-1 text-right text-[13px] text-[var(--mc-ink)]"
      />
      <span className="shrink-0 pr-1 text-[11px] font-bold text-[var(--mc-ink-muted)]">
        {rateUnitSuffix(kind === "fluid").trim() || "/s"}
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
  const current = clampTier(resolveVoltageTier(node.overclockTier, minimum), minimum);
  return { minimum, current };
}

function isTierDrivenOutputRecipe(recipe: Recipe) {
  const recipeMap = recipe.source?.recipeMap ?? recipe.machineType;
  return normalizeSearch(recipeMap) === "tree growth simulator";
}

function getAdjacentTier(current: VoltageTier, minimum: VoltageTier, direction: -1 | 1) {
  const currentIndex = getVoltageTierIndex(current);
  const minimumIndex = getVoltageTierIndex(minimum);
  const nextIndex = Math.min(
    GT_OVERCLOCK_TIERS.length - 1,
    Math.max(minimumIndex, currentIndex + direction),
  );
  return GT_OVERCLOCK_TIERS[nextIndex]?.tier ?? current;
}

function clampTier(tier: VoltageTier, minimum: VoltageTier) {
  return getVoltageTierIndex(tier) < getVoltageTierIndex(minimum) ? minimum : tier;
}

function resolveVoltageTier(value: string, defaultTier: VoltageTier): VoltageTier {
  const tier = GT_OVERCLOCK_TIERS.find((entry) => entry.tier === value)?.tier;
  if (tier) {
    return tier;
  }

  if (value === "MAX") {
    return getHighestFiniteVoltageTier();
  }

  return tier ?? defaultTier;
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
}: {
  controls: MachineConfigTierControl[];
  onSelect: (controlId: string, nextTier: string) => void;
  /** Hovering an option shows the node as if it were picked. */
  onPreview?: (controlId: string, tierKey: string | undefined) => void;
}) {
  if (controls.length === 0) {
    return null;
  }

  // Two controls per row (2 × 168 + 4 gap = the card's 340px inner width),
  // three cells per row — and GridBlock adds a cell if a label wraps rather
  // than letting the controls spill out of the panel.
  const rows = Math.ceil(controls.length / 2);
  return (
    <GridBlock
      className="nodrag border-2 border-[var(--mc-47)] bg-[var(--mc-71)] px-1 shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]"
      minCells={(rows * CONFIG_PANEL_ROW_HEIGHT) / BOARD_GRID}
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(168px,1fr))] items-center gap-x-1 gap-y-1">
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
      </div>
    </GridBlock>
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
          title="Growth: how fast it regrows"
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
          title="Gain: how much loot per harvest"
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
          title="Water: keep it topped up"
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
          title="Fertilizer: extra food"
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
          title="Sky: open air above the crop"
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
          title="Biome: where it grows best"
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
            Without a matching biome, a wet one (80%+ humidity, like a swamp or jungle) still gives
            up to +14.
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

  const stepBy = (direction: 1 | -1, event: React.MouseEvent) => {
    // Shift-click steps by 100, Ctrl-click (or Cmd on mac) by 10.
    const step = event.shiftKey ? 100 : event.ctrlKey || event.metaKey ? 10 : 1;
    const next = Math.max(1, machineCount + direction * step);
    if (next !== machineCount) {
      setDraftState({ machineCount: next, draft: String(next) });
      onChange(next);
    }
  };

  const stepButtonClassName =
    "nodrag flex h-5 w-5 shrink-0 items-center justify-center border border-[var(--mc-33)] bg-[var(--mc-82)] text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-100),inset_-1px_-1px_0_var(--mc-47)] hover:bg-[var(--mc-100)] active:shadow-[inset_1px_1px_0_var(--mc-47),inset_-1px_-1px_0_var(--mc-100)]";

  return (
    <div className="min-w-0 border border-[var(--mc-47)] bg-[var(--mc-71)] px-1 shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
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
          title="Remove 1 (Shift: 100, Ctrl: 10)"
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
          title="Add 1 (Shift: 100, Ctrl: 10)"
          aria-label={`Increase ${label.toLowerCase()} count`}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

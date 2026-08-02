"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, Minus, Plus, Sprout } from "lucide-react";
import type {
  FactoryNode,
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
  formatRate,
  applyMachineHandlerToRecipe,
  GT_OVERCLOCK_TIERS,
  getHighestFiniteVoltageTier,
  getRecipeMachineHandlers,
  getRecipeMachineConfigTierControls,
  getRecipeCoilTierControl,
  applyRecipeInputOverrides,
  restoreCrossKindInputOverrideVisuals,
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
  isVoltageTierAbove,
  makeResourceKey,
  resourceMatchesInput,
  resourceLabel,
  type MachineConfigTierControl,
} from "@/lib/model";
import { CropPickerMenu } from "./CropPickerMenu";
import { MachineCompareTable, MachineTabStrip } from "./MachinePicker";
import { useMachineHandlerIcons } from "./machine-icons";
import { MinecraftSelect } from "./MinecraftSelect";
import { MinecraftTooltip } from "@/components/nei/MinecraftTooltip";
import { MachineStatsContent } from "./MachineStatsContent";
import { UsageLimitContent } from "@/components/inspector/UsageLimitContent";
import { buildUsageLimitChain } from "@/components/inspector/usage-limits";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import {
  canonicalizeResourceHandleId,
  makeResourceHandleId,
  parseResourceHandleId,
} from "./resource-handles";
import {
  buildRailPorts,
  deriveNodeVerdict,
  type NodeVerdict,
  type RailPort,
} from "./node-verdict";
import { useFactoryStore } from "@/store/factory-store";
import { GT_NODE_COLORS } from "./node-colors";
import { getPaintBrushCursor } from "./paint-cursor";
import { GT_TIER_COLORS } from "./tier-colors";

// Full width so the crop config panel and stat grid line up with the recipe
// canvas edge instead of forcing their own wider box.
const CROP_CONFIG_PANEL_WIDTH_CLASS = "w-full";

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
  const [isCropMenuOpen, setCropMenuOpen] = useState(false);
  const recipeSearch = useFactoryStore((state) => state.highlightSearch);
  const hoveredFlowResourceKey = useFactoryStore((state) => state.hoveredFlowResourceKey);
  const selectedFlowResourceKey = useFactoryStore((state) => state.selectedFlowResourceKey);
  const hoveredNodeBottlenecks = useFactoryStore((state) => state.hoveredNodeBottlenecks);
  const selectedNodeBottlenecks = useFactoryStore((state) => state.selectedNodeBottlenecks);
  const deleteNode = useFactoryStore((state) => state.deleteNode);
  const updateNode = useFactoryStore((state) => state.updateNode);
  const nodeColorPaintMode = useFactoryStore((state) => state.nodeColorPaintMode);
  const maxTierFilter = useFactoryStore((state) => state.maxTierFilter);
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
  const nodeColor = projectNode.colorTag ? GT_NODE_COLORS[projectNode.colorTag] : undefined;
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
  const derived = useMemo(() => {
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
    const visualToolAdjustedRecipe = restoreCrossKindInputOverrideVisuals(
      toolAdjustedRecipe,
      recipe,
      projectNode,
    );
    const displayRecipe = isBeeProductionNode
      ? stripBeeFrameSlotInputs(visualToolAdjustedRecipe)
      : visualToolAdjustedRecipe;
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
  }, [dataset, projectNode, recipe]);

  const {
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
  const exceedsMaxTier =
    tierControl !== undefined &&
    maxTierFilter !== "all" &&
    isVoltageTierAbove(recipePowerTier, maxTierFilter);
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
        onSelect={(controlId, nextTier) => {
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
      />
    ) : beePanelControls.length > 0 ? (
      <PassiveProductionConfigPanel
        controls={beePanelControls}
        onSelect={updateMachineConfigTier}
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

  const hasMachinePicker = machineHandlers.length > 1 && !isCropFarmNode;
  const machineIcons = useMachineHandlerIcons();
  const previewHandler = hasMachinePicker
    ? (machineHandlers.find((handler) => handler.id === previewHandlerId) ?? selectedMachineHandler)
    : selectedMachineHandler;
  const isPreviewing = hasMachinePicker && previewHandler.id !== selectedMachineHandler.id;

  return (
    <div
      className={[
        "group relative min-w-[300px] w-max border-2 border-[var(--mc-96)] bg-[var(--mc-78)] font-mono text-[var(--mc-ink)] shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33)]",
        // Marker for the globals.css layer lift: with a picker popup open the
        // node (and the whole nodes layer) must paint above edges.
        isCompareOpen ? "recipe-node-popup-open" : "",
        selected ? "ring-2 ring-cyan-300" : "",
        isSearchHighlighted ? "ring-4 ring-sky-300" : "",
        isInspectorHighlighted
          ? "outline outline-4 outline-offset-4 outline-yellow-300 ring-8 ring-cyan-300 [filter:drop-shadow(0_0_16px_rgba(34,211,238,0.95))]"
          : "",
        exceedsMaxTier ? "ring-4 ring-red-500" : "",
      ].join(" ")}
      style={{
        ...(nodeColor
          ? {
              backgroundColor: nodeColor.panel,
              borderColor: nodeColor.border,
              boxShadow: `inset 2px 2px 0 var(--mc-100), inset -2px -2px 0 var(--mc-33), 0 0 0 2px ${nodeColor.shadow}`,
            }
          : undefined),
        ...(paintCursor ? { cursor: paintCursor } : undefined),
      }}
    >
      {exceedsMaxTier ? (
        <div className="pointer-events-none absolute -right-3 -top-3 z-40 flex max-w-[210px] items-center gap-2 border-4 border-red-700 bg-[#facc15] px-2 py-1 font-mono text-[13px] font-black uppercase leading-tight text-red-950 shadow-[4px_4px_0_rgba(0,0,0,0.45)] [text-shadow:1px_1px_0_rgba(255,255,255,0.45)]">
          <AlertTriangle className="h-7 w-7 shrink-0 fill-red-700 text-red-950" />
          <span>{recipePowerTier} Required</span>
        </div>
      ) : null}
      <div className="px-2 pb-2 pt-1">
        {/* width:0 + min-width:100% — the picker header adapts to whatever
            width the recipe card sets and can never widen the node itself,
            no matter how long a machine name or tab strip gets. */}
        <div className="w-0 min-w-full">
        {hasMachinePicker ? (
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
        ) : null}
        <div
          className={[
            "mb-1 grid min-w-0 items-center gap-1",
            tierControl
              ? "grid-cols-[24px_minmax(0,1fr)_50px]"
              : "grid-cols-[24px_minmax(0,1fr)]",
          ].join(" ")}
        >
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
          <div className="relative min-w-0">
            <MinecraftTooltip
              content={
                isCropFarmPlaceholder ? (
                  "Click to pick a crop"
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
            {hasMachinePicker && isCompareOpen ? (
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
        <div
          className={nodeColor ? "recipe-node-tinted-area" : undefined}
          style={
            nodeColor
              ? ({
                  "--recipe-node-tint": nodeColor.panel,
                  "--recipe-node-tint-header": nodeColor.header,
                  "--recipe-node-tint-border": nodeColor.border,
                } as CSSProperties)
              : undefined
          }
        >
          {isCropFarmPlaceholder ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setCropMenuOpen(true);
              }}
              className="nodrag mx-auto my-2 flex h-[72px] w-[240px] items-center justify-center gap-2 border-2 border-dashed border-[var(--mc-33)] bg-[var(--mc-71)] text-[14px] font-bold text-[var(--mc-ink)] hover:bg-[var(--mc-85)]"
            >
              <Sprout className="h-5 w-5" /> Pick a crop
            </button>
          ) : (
          // The rails ARE the node now: ports carry the icons, rates, and
          // health that the recipe canvas used to duplicate. Recipe identity
          // lives in the header (name hover = full machine stats) and in the
          // port icons (click = recipes, right-click = uses).
          <div
            className={[
              "flex items-stretch gap-1",
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
              <div className="flex w-5 shrink-0 items-center justify-center text-[15px] font-black text-[var(--mc-ink-muted)]">
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
          {machineConfigPanel}
          {passiveProductionPanel}
        </div>

        {!isCropFarmPlaceholder ? (
          <div className="w-0 min-w-full">
            <VerdictStrip
              nodeId={projectNode.id}
              title={recipe.machineType || recipe.name}
              verdict={verdict}
            />
          </div>
        ) : null}
        {!isCropFarmPlaceholder ? (
          <div
            className={[
              "mt-1 grid min-w-0 gap-1 text-[12px] leading-4 text-[var(--mc-ink)]",
              machineParallelMultiplier > 1
                ? "grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.7fr)]"
                : "grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]",
              isCropProductionNode ? CROP_CONFIG_PANEL_WIDTH_CLASS : "",
              nodeColor ? "recipe-node-stat-grid" : "",
            ].join(" ")}
            style={nodeColor ? { backgroundColor: nodeColor.panel } : undefined}
          >
            <MachineCountStat
              label={isCropProductionNode ? "Seeds" : "Machines"}
              machineCount={projectNode.machineCount}
              onChange={(machineCount) => updateNode(projectNode.id, { machineCount })}
            />
            <Stat
              label={isCropProductionNode ? "Power" : "Power draw"}
              value={
                isCropProductionNode
                  ? "Passive"
                  : `${formatRate(result?.euT ?? 0, 0)} EU/t`
              }
            />
            {machineParallelMultiplier > 1 ? (
              <Stat
                label="Parallel"
                value={`×${formatMachineParallelMultiplier(machineParallelMultiplier)}`}
              />
            ) : null}
          </div>
        ) : null}
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

function formatSlotRate(value: number, kind: string): string {
  const unit = kind === "fluid" ? " L/s" : "/s";
  // Three decimals below 0.01 so slow drips (crop drops, chanced outputs)
  // don't render as a flat 0.00/s.
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : value >= 0.01 ? 2 : 3;
  return `${formatRate(value, digits)}${unit}`;
}

function formatSlotRateBare(value: number): string {
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : value >= 0.01 ? 2 : 3;
  return formatRate(value, digits);
}

const VERDICT_STRIP_CLASS: Record<NodeVerdict["kind"], string> = {
  starved: "flow-verdict-strip--starved",
  choke: "flow-verdict-strip--choke",
  "demand-set": "flow-verdict-strip--demand",
  balanced: "flow-verdict-strip--balanced",
  unwired: "flow-verdict-strip--off",
  off: "flow-verdict-strip--off",
  "no-recipe": "flow-verdict-strip--off",
};

/**
 * The verdict strip replaces "Usage %": one always-visible line saying what
 * state the node is in, why, and what to do next. The % is demoted to a
 * detail on the right; hovering keeps the full "what limits this machine"
 * chain (computed only while hovered, so idle boards pay nothing).
 */
function VerdictStrip({
  nodeId,
  title,
  verdict,
}: {
  nodeId: string;
  title: string;
  verdict: NodeVerdict;
}) {
  const [isHovered, setHovered] = useState(false);
  const project = useFactoryStore((state) => state.project);
  const lastResult = useFactoryStore((state) => state.lastResult);
  const chain = useMemo(
    () => (isHovered ? buildUsageLimitChain(project, lastResult, nodeId) : []),
    [isHovered, lastResult, nodeId, project],
  );
  const nodeResult = lastResult?.nodes[nodeId];

  let word: string;
  let cause: string | undefined;
  let action: string | undefined;
  switch (verdict.kind) {
    case "starved": {
      word = "▼ STARVED";
      cause = verdict.binding
        ? `${verdict.binding.displayName} is short −${formatSlotRate(
            verdict.binding.shortfallPerSecond,
            verdict.binding.kind,
          )}, pinning this machine at ${formatRate(verdict.pct, 0)}% of what downstream asks.`
        : "The inputs can't keep up with what downstream asks.";
      action = verdict.binding?.upstreamName
        ? `→ Fix upstream: ${verdict.binding.upstreamName} can't deliver more.`
        : "→ Fix the supply lines feeding this machine.";
      break;
    }
    case "choke": {
      word = "▲ CHOKE POINT";
      cause = verdict.deficit
        ? `Running flat out, but downstream still wants ${formatSlotRate(
            verdict.deficit.missingPerSecond,
            verdict.deficit.kind,
          )} more ${verdict.deficit.displayName}.`
        : "Running flat out and downstream still wants more.";
      action = verdict.deficit?.machinesToAdd
        ? `→ Fix on this node: add +${verdict.deficit.machinesToAdd} machine${
            verdict.deficit.machinesToAdd > 1 ? "s" : ""
          } (or raise the tier).`
        : "→ Fix on this node: add machines or raise the tier.";
      break;
    }
    case "demand-set":
      word = "● SET BY DEMAND";
      cause =
        verdict.pct <= 0.05
          ? "Nothing downstream is taking this output yet."
          : "Downstream only asks for this much — part load here is healthy.";
      action =
        verdict.headroomPct !== undefined && verdict.headroomPct > 0
          ? `→ Nothing to fix · headroom +${formatRate(verdict.headroomPct, 0)}% if demand grows.`
          : "→ Nothing to fix.";
      break;
    case "balanced":
      word = "✔ BALANCED";
      cause = "Running at full speed and every downstream ask is met.";
      break;
    case "unwired":
      word = "● HAND-FED";
      cause = "No lines connected yet — the planner assumes you feed and empty it by hand.";
      break;
    case "off":
      word = "■ OFF";
      cause = "Node is disabled.";
      break;
    case "no-recipe":
      word = "■ NO RECIPE";
      break;
  }

  const showPct = verdict.kind !== "off" && verdict.kind !== "no-recipe";
  return (
    <span
      className="contents"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <MinecraftTooltip
        content={
          chain.length > 0 ? (
            <UsageLimitContent
              title={title}
              utilization={nodeResult?.utilization ?? 0}
              status={nodeResult?.status}
              entries={chain}
            />
          ) : undefined
        }
      >
        <div
          className={["flow-verdict-strip mt-1 px-2 py-1", VERDICT_STRIP_CLASS[verdict.kind]].join(
            " ",
          )}
        >
          <div className="flex items-baseline gap-2">
            <span className="whitespace-nowrap text-[11px] font-black leading-4 tracking-[1px]">
              {word}
            </span>
            <span className="min-w-0 flex-1" />
            {showPct ? (
              <span className="shrink-0 text-[14px] font-bold leading-4 tabular-nums">
                {formatRate(verdict.pct, verdict.pct >= 100 ? 0 : 1)}%
              </span>
            ) : null}
          </div>
          {/* Full sentences that wrap - an ellipsis here would hide exactly
              what the user came to read. */}
          {cause ? <div className="mt-0.5 text-[9px] leading-[13px] opacity-95">{cause}</div> : null}
          {action ? <div className="text-[9px] leading-[13px] opacity-95">{action}</div> : null}
        </div>
      </MinecraftTooltip>
    </span>
  );
}

/**
 * One side of the port rails. Every port always renders - a hidden port is a
 * port somebody can't wire, so tall nodes are the accepted trade for big
 * recipes.
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

  return (
    <div className="flex w-[118px] shrink-0 flex-col justify-center gap-1 py-0.5">
      {ports.map((port) => (
        <PortChip key={port.key} nodeId={nodeId} port={port} pending={pending} />
      ))}
    </div>
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
    if (!edgeTouchesPortResource(edge, port)) {
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

function PortChip({
  nodeId,
  port,
  pending,
}: {
  nodeId: string;
  port: RailPort;
  pending: ReturnType<typeof useFactoryStore.getState>["pendingResourceConnection"];
}) {
  const isInput = port.side === "input";
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
  const browse = (mode: "recipes" | "uses") =>
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
  const toneClass =
    port.tone === "bind"
      ? "flow-port--bind"
      : port.tone === "hot"
        ? "flow-port--hot"
        : port.tone === "calm"
          ? "flow-port--calm"
          : port.tone === "idle"
            ? "flow-port--idle"
            : "";
  const rateText = port.showNameplate
    ? `${formatSlotRateBare(port.currentPerSecond)} / ${formatSlotRate(
        port.nameplatePerSecond,
        port.kind,
      )}`
    : formatSlotRate(port.currentPerSecond, port.kind);
  const badgeText = port.badge
    ? port.badge.kind === "short"
      ? `−${formatSlotRate(port.badge.perSecond, port.kind)}`
      : `asked ${formatSlotRateBare(port.badge.perSecond)}`
    : undefined;

  return (
    <div
      className={[
        "flow-port relative flex items-center gap-1 px-1 py-0.5",
        toneClass,
        isFlowScopeLit ? "z-10 ring-2 ring-cyan-300 brightness-110" : "",
      ].join(" ")}
      data-resource-edge-anchor="true"
      data-resource-node-id={nodeId}
      data-resource-handle-id={port.handleId}
      onPointerEnter={() => setHoveredFlowScope(buildPortFlowScope(nodeId, port))}
      onPointerLeave={() => setHoveredFlowScope(undefined)}
    >
      {slotState !== "idle" ? (
        <span
          className={[
            "pointer-events-none absolute inset-0 z-20",
            slotState === "selected" ? "ring-2 ring-amber-300" : "",
            slotState === "compatible" ? "ring-2 ring-cyan-300" : "",
          ].join(" ")}
        />
      ) : null}
      <span
        role="button"
        tabIndex={-1}
        className="nodrag relative z-40 shrink-0 cursor-pointer hover:brightness-125"
        title={`${port.displayName} — click: recipes, right-click: uses`}
        onClick={(event) => {
          event.stopPropagation();
          browse("recipes");
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          browse("uses");
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {port.resource ? (
          <ResourceIcon
            resource={{ ...port.resource, amount: 1, chance: undefined }}
            bare
            tooltip={false}
            showAmount={false}
            showConsumedState={false}
            iconPixelSize={26}
            className="!h-5 !w-5"
          />
        ) : (
          <span className="block h-5 w-5 border border-[var(--mc-47)] bg-[var(--mc-55)]" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={[
            "block truncate text-[10px] font-bold leading-3.5 tabular-nums",
            !isInput && port.tone !== "bind" ? "text-[var(--mc-good)]" : "text-[var(--mc-ink)]",
          ].join(" ")}
        >
          {rateText}
        </span>
        {port.handFed ? (
          <span className="block text-[7px] font-black leading-3 tracking-[0.5px] text-[var(--mc-ink-muted)]">
            HAND-FED
          </span>
        ) : (
          <span className="flow-port-bar mt-0.5 block">
            <i style={{ width: `${Math.round(Math.min(Math.max(port.fillFraction, 0), 1) * 100)}%` }} />
          </span>
        )}
      </span>
      {badgeText ? <em className="flow-port-badge not-italic">{badgeText}</em> : null}
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
          title={`${isInput ? "Input" : "Output"}: ${port.displayName}`}
          className={[
            "resource-slot-handle nodrag !absolute !left-0 !right-auto !top-0 !z-30 !h-full !w-full !min-w-0 !translate-x-0 !translate-y-0",
            "!rounded-none !border-0 !bg-transparent !opacity-0",
            "cursor-crosshair",
          ].join(" ")}
        />
      </MinecraftTooltip>
    </div>
  );
}

/**
 * The port hover panel: what this resource flows at right now, what it would
 * flow at with the machine running 100%, and the per-line breakdown of who
 * ships what, whose source is maxed, and how much is still missing or
 * unrouted.
 */
function renderPortHoverContent(port: RailPort, nodeId: string) {
  const maxRate = port.nameplatePerSecond;
  if (maxRate <= 1e-9) {
    return undefined;
  }

  const isInput = port.side === "input";
  const nowRate = port.currentPerSecond;
  const breakdown = buildPortEdgeBreakdown(nodeId, port);

  return (
    <div className="w-52">
      <div className="flex items-baseline gap-2">
        <span className="truncate text-[13px] font-semibold text-white">
          {port.displayName}
        </span>
        <span className="ml-auto shrink-0 text-[10px] font-bold uppercase tracking-wide text-slate-400">
          {isInput ? "Input" : "Output"}
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-3 text-[12px]">
        <span className="text-slate-400">Now</span>
        <span className="font-bold tabular-nums text-cyan-300">
          {formatSlotRate(nowRate, port.kind)}
        </span>
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-3 text-[12px]">
        <span className="text-slate-400">At 100%</span>
        <span className="font-semibold tabular-nums text-slate-300">
          {formatSlotRate(maxRate, port.kind)}
        </span>
      </div>
      {breakdown && breakdown.rows.length > 0 ? (
        <div className="mt-2 border-t border-white/15 pt-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            {isInput
              ? `Supplied by ${breakdown.rows.length} line${breakdown.rows.length > 1 ? "s" : ""}`
              : `Feeding ${breakdown.rows.length} line${breakdown.rows.length > 1 ? "s" : ""}`}
          </div>
          {breakdown.rows.map((row, index) => (
            <div
              key={index}
              className="mt-0.5 flex items-baseline justify-between gap-3 text-[12px]"
            >
              <span className="truncate text-slate-300">{row.name}</span>
              <span className="shrink-0 tabular-nums text-slate-200">
                {formatSlotRate(row.rate, port.kind)}
                {row.tag ? (
                  <span className="ml-1 text-[9px] font-bold uppercase text-amber-300">
                    {row.tag}
                  </span>
                ) : null}
              </span>
            </div>
          ))}
          {isInput && breakdown.shortAtFull > 1e-6 ? (
            <div className="mt-1 text-[11px] font-semibold text-amber-300">
              Short {formatSlotRate(breakdown.shortAtFull, port.kind)} for full speed
            </div>
          ) : null}
          {isInput && breakdown.shortAtFull <= 1e-6 && breakdown.rows.length > 1 ? (
            <div className="mt-1 text-[11px] text-emerald-300">
              Need fully covered by these lines together
            </div>
          ) : null}
          {!isInput && breakdown.unrouted > 1e-6 ? (
            <div className="mt-1 text-[11px] text-slate-400">
              {formatSlotRate(breakdown.unrouted, port.kind)} not routed anywhere
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Per-line detail for a port's tooltip, read lazily from the store (no
 * subscription: the node re-renders on every solver tick anyway, which is
 * exactly when these numbers change). Lines match by resource - directly or
 * through the edge's stored handle - so legacy per-slot handles and oredict
 * concretions all land on the pooled port.
 */
function buildPortEdgeBreakdown(
  nodeId: string,
  port: RailPort,
):
  | {
      rows: Array<{ name: string; rate: number; tag?: string }>;
      shortAtFull: number;
      unrouted: number;
    }
  | undefined {
  const { project, lastResult } = useFactoryStore.getState();
  if (!lastResult) {
    return undefined;
  }

  const isInput = port.side === "input";
  const storagesById = new Map((project.storages ?? []).map((storage) => [storage.id, storage]));
  const nodesById = new Map(project.nodes.map((entry) => [entry.id, entry]));
  const recipesById = new Map(project.recipes.map((entry) => [entry.id, entry]));

  const rows: Array<{ name: string; rate: number; tag?: string }> = [];
  let routed = 0;
  for (const edge of project.edges) {
    if ((isInput ? edge.target : edge.source) !== nodeId) {
      continue;
    }
    if (!edgeTouchesPortResource(edge, port)) {
      continue;
    }

    const otherId = isInput ? edge.source : edge.target;
    const storage = storagesById.get(otherId);
    const otherNode = nodesById.get(otherId);
    const otherRecipe = otherNode ? recipesById.get(otherNode.recipeId) : undefined;
    const name = storage
      ? `${storage.displayName ?? storage.resourceId} (buffer)`
      : (otherRecipe?.machineType ?? otherRecipe?.name ?? "Machine");
    const edgeResult = lastResult.edges[edge.id];
    const rate = edgeResult?.transferredPerSecond ?? 0;
    routed += rate;
    rows.push({
      name,
      rate,
      // "maxed" only when the line is short AND its source has nothing left -
      // that is the line that needs more machines, not this consumer.
      tag: isInput && edgeResult?.constraint === "supply" ? "maxed" : undefined,
    });
  }

  if (rows.length === 0) {
    return undefined;
  }
  rows.sort((left, right) => right.rate - left.rate);

  const nodeResult = lastResult.nodes[nodeId];
  const speed = Number.isFinite(nodeResult?.utilization)
    ? Math.min(Math.max(nodeResult!.utilization, 0), 1)
    : 0;
  const nameplate = port.nameplatePerSecond;

  return {
    rows,
    shortAtFull: isInput ? Math.max(0, nameplate - routed) : 0,
    unrouted: isInput ? 0 : Math.max(0, nameplate * speed - routed),
  };
}

function edgeTouchesPortResource(
  edge: ReturnType<typeof useFactoryStore.getState>["project"]["edges"][number],
  port: RailPort,
): boolean {
  const handle = port.side === "input" ? edge.targetHandle : edge.sourceHandle;
  const parsed = parseResourceHandleId(handle);
  if (parsed && parsed.kind === port.kind && parsed.resourceId === port.resourceId) {
    return true;
  }
  return edge.resourceKind === port.kind && edge.resourceId === port.resourceId;
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

function MachineConfigControlPanel({
  controls,
  onSelect,
}: {
  controls: MachineConfigTierControl[];
  onSelect: (controlId: string, nextTier: string) => void;
}) {
  if (controls.length === 0) {
    return null;
  }

  return (
    <div className="nodrag mt-1 border-2 border-[var(--mc-47)] bg-[var(--mc-71)] p-1 shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(128px,1fr))] gap-1">
        {controls.map((control) => (
          <label key={control.id} className="min-w-0">
            <span className="mb-0.5 block truncate text-[10px] font-bold uppercase leading-4 text-[var(--mc-ink-muted)]">
              {control.label}
            </span>
            <span className="flex min-w-0 items-center gap-1">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center border border-[var(--mc-33)] bg-[var(--mc-55)] shadow-[inset_1px_1px_0_var(--mc-85),inset_-1px_-1px_0_var(--mc-25)]">
                {control.resource.iconPath ? (
                  <ResourceIcon
                    resource={control.resource}
                    bare
                    tooltip={false}
                    showAmount={false}
                    showConsumedState={false}
                    iconPixelSize={30}
                    className="h-6 w-6 !overflow-visible"
                  />
                ) : (
                  <span className="max-w-full truncate px-0.5 text-center text-[8px] font-black leading-3 text-white [text-shadow:1px_1px_0_#000]">
                    {shortConfigLabel(control.resource)}
                  </span>
                )}
              </span>
              <MinecraftSelect
                value={control.current.key}
                options={control.tiers}
                onSelect={(key) => onSelect(control.id, key)}
                disabled={control.tiers.length <= 1}
                title={`${control.label}: ${control.current.label}`}
                ariaLabel={control.label}
                className="flex-1"
              />
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function PassiveProductionConfigPanel({
  className = "",
  controls,
  onSelect,
  getControlHelp,
}: {
  className?: string;
  controls: MachineConfigTierControl[];
  onSelect: (controlId: string, nextTier: string) => void;
  /** Hover explanation per control (what the knob does and why it matters). */
  getControlHelp?: (controlId: string) => ReactNode;
}) {
  if (controls.length === 0) {
    return null;
  }

  return (
    <div
      className={[
        "nodrag mt-1 border-2 border-[var(--mc-47)] bg-[var(--mc-71)] p-1 shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]",
        className,
      ].join(" ")}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1">
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
    </div>
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
          it <span style={{ color: CROP_HELP_BAD }}>four times as hard</span> — and if it&apos;s 25
          or more short, it <span style={{ color: CROP_HELP_BAD }}>stops growing completely</span>.
        </p>
      ) : null}
      {finePrint ? (
        <p className="mt-2 border-t border-white/10 pt-1.5 text-[13px] leading-relaxed text-slate-400">
          For the curious: {finePrint}
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
          title="Growth — how fast it regrows"
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
          title="Gain — how much loot per harvest"
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
            grows — only how much falls out.
          </p>
        </CropHelpPanel>
      );
    case "cropWater":
      return (
        <CropHelpPanel
          title="Water — keep it topped up"
          feeding={{ tier: stats.tier }}
          finePrint={<>water bonus = floor((water + 9) ÷ 10): 0 → +1, 50 → +5, 100 → +10.</>}
        >
          <p>
            A well-watered crop is a well-fed crop: full water is {good("+10 food")}, one of the
            two biggest boosts you control.
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
          title="Fertilizer — food from a bag"
          feeding={{ tier: stats.tier }}
          finePrint={<>fertilizer bonus = floor((fertilizer + 9) ÷ 10): 0 → +1, 50 → +5, 100 → +10.</>}
        >
          <p>
            Fertilizer works exactly like water: keeping it full is {good("+10 food")}. Skip it and
            a hungry high-tier crop will {bad("crawl or stall")}.
          </p>
          <p className="text-slate-300">
            Crop Managers and Industrial Farms can supply it for you (Fertilia crops literally grow
            the stuff).
          </p>
        </CropHelpPanel>
      );
    case "cropSky":
      return (
        <CropHelpPanel
          title="Sky — a little sunshine"
          feeding={{ tier: stats.tier }}
          finePrint={<>sky bonus = +2 when the block above the crop can see the sky.</>}
        >
          <p>
            Plants under open sky get a small {good("+2 food")} bonus. Roofed or underground farms
            lose it — usually fine, unless the crop is right on the edge of being underfed.
          </p>
        </CropHelpPanel>
      );
    case "cropBiome":
      return (
        <CropHelpPanel
          title="Biome — plant it where it's happy"
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
            Each matching like is {good("+14 food")}, so hitting both is {good("+28")} — the
            biggest feeding boost there is.
          </p>
          <p className="text-slate-300">
            No matching biome nearby? A wet one (80%+ humidity, like a swamp or jungle) still gives
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
  if (/^\d+\/\d+\/\d+$/.test(label)) {
    return label;
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
      <div className="truncate text-[9px] uppercase text-[var(--mc-ink-muted)]">{label}</div>
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
    "nodrag flex h-4 w-4 shrink-0 items-center justify-center border border-[var(--mc-33)] bg-[var(--mc-82)] text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-100),inset_-1px_-1px_0_var(--mc-47)] hover:bg-[var(--mc-100)] active:shadow-[inset_1px_1px_0_var(--mc-47),inset_-1px_-1px_0_var(--mc-100)]";

  return (
    <div className="min-w-0 border border-[var(--mc-47)] bg-[var(--mc-71)] px-1 shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
      <div className="truncate text-[9px] uppercase text-[var(--mc-ink-muted)]">{label}</div>
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
          className="nodrag h-[18px] w-0 min-w-0 flex-1 border border-[var(--mc-47)] bg-[var(--mc-85)] px-1 text-center text-[12px] font-medium leading-4 text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-100),inset_-1px_-1px_0_var(--mc-54)] outline-none focus:border-cyan-700 focus:bg-[var(--mc-100)] focus:ring-1 focus:ring-cyan-400"
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

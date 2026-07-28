"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo, useMemo, useState, type CSSProperties } from "react";
import { AlertTriangle, ChevronDown, WandSparkles } from "lucide-react";
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
  getVoltageTierIndex,
  BEE_INDUSTRIAL_PRODUCTION_CONTROL_ID,
  BEE_INDUSTRIAL_SPEED_CONTROL_ID,
  isRecipeInputConsumed,
  isBeeFrameSlotControlId,
  isBeeProductionConfigControl,
  isBeeProductionRecipe,
  isCropProductionConfigControl,
  isCropProductionRecipe,
  isIndustrialApiaryMachineType,
  isVoltageTierAbove,
  makeResourceKey,
  resourceMatchesInput,
  resourceLabel,
  type MachineConfigTierControl,
} from "@/lib/model";
import { NeiRecipeWindow } from "@/components/nei/NeiRecipeWindow";
import { MinecraftTooltip } from "@/components/nei/MinecraftTooltip";
import { UsageLimitContent } from "@/components/inspector/UsageLimitContent";
import { buildUsageLimitChain } from "@/components/inspector/usage-limits";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { usesNativeNeiChrome } from "@/lib/nei/layout";
import type { NeiPositionedSlot } from "@/lib/nei/layout";
import { makeResourceHandleId } from "./resource-handles";
import { useFactoryStore } from "@/store/factory-store";
import { GT_NODE_COLORS } from "./node-colors";
import { getPaintBrushCursor } from "./paint-cursor";
import { GT_TIER_COLORS } from "./tier-colors";

const CROP_CONFIG_PANEL_WIDTH_CLASS = "w-[398px]";

export interface RecipeNodeData extends Record<string, unknown> {
  projectNode: FactoryNode;
  recipe: Recipe;
  result?: NodeThroughputResult;
}

export type RecipeFlowNode = Node<RecipeNodeData, "recipeNode">;

function RecipeNodeComponent({ data, selected }: NodeProps<RecipeFlowNode>) {
  const { projectNode, recipe, result } = data;
  const [isMachineMenuOpen, setIsMachineMenuOpen] = useState(false);
  const [openMachineConfigMenuId, setOpenMachineConfigMenuId] = useState<string>();
  const browseResource = useFactoryStore((state) => state.browseResource);
  const recipeSearch = useFactoryStore((state) => state.highlightSearch);
  const hoveredFlowResourceKey = useFactoryStore((state) => state.hoveredFlowResourceKey);
  const selectedFlowResourceKey = useFactoryStore((state) => state.selectedFlowResourceKey);
  const hoveredNodeBottlenecks = useFactoryStore((state) => state.hoveredNodeBottlenecks);
  const selectedNodeBottlenecks = useFactoryStore((state) => state.selectedNodeBottlenecks);
  const deleteNode = useFactoryStore((state) => state.deleteNode);
  const updateNode = useFactoryStore((state) => state.updateNode);
  const optimizeMachineCount = useFactoryStore((state) => state.optimizeMachineCount);
  const nodeColorPaintMode = useFactoryStore((state) => state.nodeColorPaintMode);
  const maxTierFilter = useFactoryStore((state) => state.maxTierFilter);
  const pendingResourceConnection = useFactoryStore((state) => state.pendingResourceConnection);
  const dataset = useFactoryStore((state) => state.dataset);
  const utilization = result?.utilization ?? 0;
  const utilizationPercent = Number.isFinite(utilization) ? utilization * 100 : 999;
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
    const tierControl = getNodeTierControl(effectiveRecipe, projectNode);
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

    return {
      machineHandlers,
      selectedMachineHandler,
      effectiveRecipe,
      recipePowerTier,
      tierControl,
      coilControl,
      coilResource,
      cropProductionControls,
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
      usesNativeNeiRecipe: usesNativeNeiChrome(overclockedRecipe),
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
    isCropProductionNode,
    beeFrameControls,
    beePanelControls,
    tgsToolControls,
    statsMachineConfigControls,
    machineParallelMultiplier,
    overclockedRecipe,
    tierColor,
    usesNativeNeiRecipe,
  } = derived;
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
  const visibleMachineConfigControls = [
    ...(coilControl && coilResource ? [{ ...coilControl, resource: coilResource }] : []),
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
    setIsMachineMenuOpen(false);
  };

  return (
    <div
      className={[
        "group relative min-w-[368px] w-max border-2 border-[var(--mc-96)] bg-[var(--mc-78)] font-mono text-[var(--mc-ink)] shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33)]",
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
        <div
          className={[
            "mb-1 grid min-w-0 items-center",
            machineHandlers.length > 1 && tierControl
              ? "grid-cols-[24px_minmax(0,1fr)_50px_24px]"
              : machineHandlers.length > 1
                ? "grid-cols-[24px_minmax(0,1fr)_24px]"
                : tierControl
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
          <div
            className="minecraft-title h-6 truncate border-2 border-[var(--mc-33)] bg-[var(--mc-61)] px-2 text-center text-[17px] leading-[20px] shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-29)]"
            style={nodeColor ? { backgroundColor: nodeColor.header } : undefined}
          >
            {selectedMachineHandler.label}
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
          {machineHandlers.length > 1 ? (
            <div className="relative">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setIsMachineMenuOpen((current) => !current);
                }}
                className="nodrag flex h-6 w-6 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-55)] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)] hover:brightness-110"
                title={`Machine: ${selectedMachineHandler.label}`}
                aria-label={`Select machine handler. Current: ${selectedMachineHandler.label}`}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {isMachineMenuOpen ? (
                <div
                  className="nodrag absolute right-0 top-7 z-50 min-w-[180px] border-2 border-[var(--mc-15)] bg-[var(--mc-78)] p-1 text-[11px] shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33),4px_4px_0_rgba(0,0,0,0.35)]"
                  onClick={(event) => event.stopPropagation()}
                >
                  {machineHandlers.map((handler) => (
                    <button
                      key={handler.id}
                      type="button"
                      onClick={() => updateMachineHandler(handler.id)}
                      className={[
                        "block w-full truncate border-2 px-2 py-1 text-left font-bold",
                        handler.id === selectedMachineHandler.id
                          ? "border-[#6b4fd1] bg-[#8b70dd] text-white"
                          : "border-[var(--mc-47)] bg-[var(--mc-85)] text-[var(--mc-ink)] hover:bg-[var(--mc-100)]",
                      ].join(" ")}
                      title={handler.label}
                    >
                      {handler.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
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
          <NeiRecipeWindow
            recipe={overclockedRecipe}
            scale={2}
            compact
            className={["mx-auto", nodeColor ? "recipe-node-nei-tint" : undefined]
              .filter(Boolean)
              .join(" ")}
            canvasClassName={nodeColor ? "recipe-node-canvas-tint" : undefined}
            statsAction={
              machineParallelMultiplier > 1 ? (
                <div className="flex gap-1">
                  <MachineParallelIndicator multiplier={machineParallelMultiplier} />
                </div>
              ) : undefined
            }
            getSlotConnectionAttributes={(slot) => {
              if (slot.side === "input" && !isRecipeInputConsumed(slot.resource)) {
                return undefined;
              }

              const handleId = makeResourceHandleId(slot.side, slot.resource, slot.resourceIndex);
              return {
                "data-resource-handle": "true",
                "data-resource-node-id": projectNode.id,
                "data-resource-handle-id": handleId,
              };
            }}
            onSlotClick={(slot, mode) => {
              browseResource(
                {
                  kind: slot.resource.kind,
                  id: slot.resource.id,
                  displayName: slot.resource.displayName,
                  iconPath: slot.resource.iconPath,
                  iconAtlas: slot.resource.iconAtlas,
                  dominantColor:
                    slot.resource.dominantColor ?? slot.resource.iconAtlas?.dominantColor,
                  anchorNodeId: projectNode.id,
                },
                mode,
              );
            }}
            suppressSlotHover={(slot) =>
              Boolean(
                getTreeGrowthSimulatorToolControlForSlot(slot, tgsToolControls) ??
                getBeeFrameControlForSlot(slot, beeFrameControls),
              )
            }
            suppressConsumedState={(slot) =>
              Boolean(getTreeGrowthSimulatorToolControlForSlot(slot, tgsToolControls)) ||
              Boolean(getBeeFrameControlForSlot(slot, beeFrameControls)) ||
              isCropSeedSlot(slot, effectiveRecipe, cropProductionControls)
            }
            getSlotZIndex={(slot) => {
              const control =
                getTreeGrowthSimulatorToolControlForSlot(slot, tgsToolControls) ??
                getBeeFrameControlForSlot(slot, beeFrameControls);
              if (!control) {
                return undefined;
              }
              return openMachineConfigMenuId === control.id ? 130 : 70;
            }}
            renderHandle={(slot) => {
              const tgsToolControl = getTreeGrowthSimulatorToolControlForSlot(
                slot,
                tgsToolControls,
              );
              if (tgsToolControl) {
                return (
                  <TreeGrowthSimulatorToolSlotMenu
                    control={tgsToolControl}
                    dataset={dataset}
                    isOpen={openMachineConfigMenuId === tgsToolControl.id}
                    onOpenChange={(isOpen) =>
                      setOpenMachineConfigMenuId(isOpen ? tgsToolControl.id : undefined)
                    }
                    onSelect={(nextTier) => updateMachineConfigTier(tgsToolControl.id, nextTier)}
                  />
                );
              }

              const beeFrameControl = getBeeFrameControlForSlot(slot, beeFrameControls);
              if (beeFrameControl) {
                return (
                  <MachineConfigSlotMenu
                    control={beeFrameControl}
                    dataset={dataset}
                    isOpen={openMachineConfigMenuId === beeFrameControl.id}
                    onOpenChange={(isOpen) =>
                      setOpenMachineConfigMenuId(isOpen ? beeFrameControl.id : undefined)
                    }
                    onSelect={(nextTier) => updateMachineConfigTier(beeFrameControl.id, nextTier)}
                  />
                );
              }

              const isInput = slot.side === "input";
              if (isInput && !isRecipeInputConsumed(slot.resource)) {
                return null;
              }
              const handleId = makeResourceHandleId(slot.side, slot.resource, slot.resourceIndex);
              const slotState = getConnectionSlotState(
                pendingResourceConnection,
                projectNode.id,
                slot.side,
                slot.resource.kind,
                slot.resource.id,
                slot.resource.alternatives,
                handleId,
              );

              return (
                <>
                  {slotState !== "idle" ? (
                    <span
                      className={[
                        "pointer-events-none absolute inset-0 z-20",
                        slotState === "selected" ? "ring-2 ring-amber-300" : "",
                        slotState === "compatible" ? "ring-2 ring-cyan-300" : "",
                      ].join(" ")}
                    />
                  ) : null}
                  <MinecraftTooltip
                    label={slot.resource.tooltip ?? slot.resource.displayName ?? slot.resource.id}
                    content={renderSlotRateContent(slot, result)}
                  >
                    <Handle
                      id={handleId}
                      type={isInput ? "target" : "source"}
                      position={isInput ? Position.Left : Position.Right}
                      data-resource-handle="true"
                      data-resource-node-id={projectNode.id}
                      data-resource-handle-id={handleId}
                      title={`${isInput ? "Input" : "Output"}: ${
                        slot.resource.displayName ?? slot.resource.id
                      }`}
                      className={[
                        "resource-slot-handle nodrag !absolute !left-0 !right-auto !top-0 !z-30 !h-full !w-full !min-w-0 !translate-x-0 !translate-y-0",
                        "!rounded-none !border-0 !bg-transparent !opacity-0",
                        "cursor-crosshair",
                      ].join(" ")}
                    />
                  </MinecraftTooltip>
                </>
              );
            }}
          />
          {!usesNativeNeiRecipe ? machineConfigPanel : null}
          {!usesNativeNeiRecipe ? passiveProductionPanel : null}
        </div>

        {!usesNativeNeiRecipe ? (
          <div
            className={[
              "mt-1 grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-1 text-[12px] leading-4 text-[var(--mc-ink)]",
              isCropProductionNode ? CROP_CONFIG_PANEL_WIDTH_CLASS : "",
              nodeColor ? "recipe-node-stat-grid" : "",
            ].join(" ")}
            style={nodeColor ? { backgroundColor: nodeColor.panel } : undefined}
          >
            <MachineCountStat
              label={isCropProductionNode ? "Seeds" : "Machines"}
              machineCount={projectNode.machineCount}
              suggestedMachineCount={getSuggestedMachineCount(result, projectNode.machineCount)}
              onChange={(machineCount) => updateNode(projectNode.id, { machineCount })}
              onOptimize={() => optimizeMachineCount(projectNode.id)}
            />
            <UsageStat
              nodeId={projectNode.id}
              title={recipe.machineType || recipe.name}
              utilizationPercent={utilizationPercent}
              result={result}
            />
            <Stat
              label={isCropProductionNode ? "Power" : "EU/t"}
              value={isCropProductionNode ? "Passive" : formatRate(result?.euT ?? 0, 0)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const RecipeNode = memo(RecipeNodeComponent);

function formatSlotRate(value: number, kind: string): string {
  const unit = kind === "fluid" ? " L/s" : "/s";
  return `${formatRate(value, value >= 100 ? 0 : value >= 10 ? 1 : 2)}${unit}`;
}

/**
 * The slot hover panel: what this item flows at right now, and what it would
 * flow at with the machine running 100%. Falls back to the plain name label
 * when the solver has no flow for the slot (unconnected boards, NC slots).
 */
function renderSlotRateContent(
  slot: NeiPositionedSlot,
  result: NodeThroughputResult | undefined,
) {
  if (!result) {
    return undefined;
  }

  const isInput = slot.side === "input";
  const flows = isInput ? result.inputs : result.outputs;
  const key = makeResourceKey(slot.resource.kind, slot.resource.id);
  const flow =
    flows[key] ??
    Object.values(flows).find(
      (candidate) => candidate.resourceId === slot.resource.id,
    );
  if (!flow || flow.amountPerSecond <= 1e-9) {
    return undefined;
  }

  const maxRate = flow.amountPerSecond;
  const speed = Number.isFinite(result.utilization)
    ? Math.min(Math.max(result.utilization, 0), 1)
    : 0;
  const nowRate = maxRate * speed;

  return (
    <div className="w-48">
      <div className="flex items-baseline gap-2">
        <span className="truncate text-[13px] font-semibold text-white">
          {slot.resource.displayName ?? slot.resource.id}
        </span>
        <span className="ml-auto shrink-0 text-[10px] font-bold uppercase tracking-wide text-slate-400">
          {isInput ? "Input" : "Output"}
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-3 text-[12px]">
        <span className="text-slate-400">Now</span>
        <span className="font-bold tabular-nums text-cyan-300">
          {formatSlotRate(nowRate, flow.kind)}
        </span>
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-3 text-[12px]">
        <span className="text-slate-400">At 100%</span>
        <span className="font-semibold tabular-nums text-slate-300">
          {formatSlotRate(maxRate, flow.kind)}
        </span>
      </div>
    </div>
  );
}

/**
 * The Usage stat, coloured by the solver's status bands, with the "what limits
 * this machine" chain on hover. The chain is only computed while hovered so a
 * board full of nodes pays nothing for it.
 */
function UsageStat({
  nodeId,
  title,
  utilizationPercent,
  result,
}: {
  nodeId: string;
  title: string;
  utilizationPercent: number;
  result?: NodeThroughputResult;
}) {
  const [isHovered, setHovered] = useState(false);
  const project = useFactoryStore((state) => state.project);
  const lastResult = useFactoryStore((state) => state.lastResult);
  const chain = useMemo(
    () => (isHovered ? buildUsageLimitChain(project, lastResult, nodeId) : []),
    [isHovered, lastResult, nodeId, project],
  );
  const valueClassName =
    result?.status === "bottleneck"
      ? "text-red-700"
      : result?.status === "balanced"
        ? "text-emerald-700"
        : undefined;

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
              utilization={result?.utilization ?? 0}
              status={result?.status}
              entries={chain}
            />
          ) : undefined
        }
      >
        <Stat
          label="Usage"
          value={`${formatRate(utilizationPercent, 1)}%`}
          valueClassName={valueClassName}
        />
      </MinecraftTooltip>
    </span>
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

function getTreeGrowthSimulatorToolControlForSlot(
  slot: NeiPositionedSlot,
  controls: MachineConfigTierControl[],
) {
  if (slot.side !== "input" || slot.kind !== "item") {
    return undefined;
  }

  return controls.find((control) => {
    const position = TREE_GROWTH_SIMULATOR_TOOL_SLOTS[control.id];
    return position?.x === slot.x && position.y === slot.y;
  });
}

function getBeeFrameControlForSlot(slot: NeiPositionedSlot, controls: MachineConfigTierControl[]) {
  if (slot.side !== "input" || slot.kind !== "item") {
    return undefined;
  }

  return controls.find((control) => {
    const position = BEE_FRAME_SLOTS[control.id];
    return position?.x === slot.x && position.y === slot.y;
  });
}

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

function TreeGrowthSimulatorToolSlotMenu({
  control,
  dataset,
  isOpen,
  onOpenChange,
  onSelect,
}: {
  control: MachineConfigTierControl;
  dataset: ReturnType<typeof useFactoryStore.getState>["dataset"];
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onSelect: (nextTier: string) => void;
}) {
  const selectedEmpty = isTreeGrowthSimulatorEmptyTool(control);
  const tiers = getTreeGrowthSimulatorSlotTiers(control);
  const currentTitle = selectedEmpty
    ? `${control.label}: empty`
    : `${control.label}: ${control.resource.displayName ?? control.current.label}`;

  return (
    <span className="absolute inset-0 z-[70] block">
      <span
        role="button"
        tabIndex={0}
        className={[
          "block h-full w-full cursor-pointer",
          isOpen ? "" : "hover:ring-2 hover:ring-cyan-300",
        ].join(" ")}
        title={currentTitle}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(!isOpen);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(!isOpen);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(!isOpen);
        }}
      >
        {selectedEmpty ? (
          <span className="grid h-full w-full place-items-center text-[17px] font-bold leading-none text-white [text-shadow:1px_1px_0_#000]">
            +
          </span>
        ) : null}
      </span>
      {isOpen ? (
        <span
          className="absolute left-0 top-[calc(100%+6px)] z-[120] grid w-[208px] grid-cols-[repeat(3,52px)] gap-3 border-2 border-[var(--mc-15)] bg-[var(--mc-78)] p-3 shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33),4px_4px_0_rgba(0,0,0,0.35)]"
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {tiers.map((tier) => {
            const isEmpty = tier.key === "none";
            const resource = resolveDatasetMachineConfigResource(tier.resource, dataset);
            return (
              <span
                key={tier.key}
                role="button"
                tabIndex={0}
                className={[
                  "grid h-[52px] w-[52px] place-items-center overflow-hidden border-2 text-[18px] font-bold leading-none",
                  !selectedEmpty && tier.key === control.current.key
                    ? "border-[#6b4fd1] bg-[#8b70dd] text-white"
                    : "border-[var(--mc-47)] bg-[var(--mc-85)] text-[var(--mc-ink)] hover:bg-[var(--mc-100)]",
                ].join(" ")}
                title={isEmpty ? "-" : (resource.displayName ?? tier.label)}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelect(tier.key);
                  onOpenChange(false);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  onSelect(tier.key);
                  onOpenChange(false);
                }}
              >
                {isEmpty ? <span>-</span> : <TreeGrowthSimulatorMenuIcon resource={resource} />}
              </span>
            );
          })}
        </span>
      ) : null}
    </span>
  );
}

function MachineConfigSlotMenu(props: {
  control: MachineConfigTierControl;
  dataset: ReturnType<typeof useFactoryStore.getState>["dataset"];
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onSelect: (nextTier: string) => void;
}) {
  return <TreeGrowthSimulatorToolSlotMenu {...props} />;
}

function TreeGrowthSimulatorMenuIcon({ resource }: { resource: ResourceAmount }) {
  return (
    <ResourceIcon
      resource={resource}
      bare
      tooltip={false}
      showAmount={false}
      showConsumedState={false}
      iconPixelSize={64}
      className="h-full w-full"
    />
  );
}

function isCropSeedSlot(
  slot: NeiPositionedSlot,
  recipe: Recipe,
  controls: MachineConfigTierControl[],
) {
  if (controls.length === 0 || slot.side !== "input" || slot.kind !== "item") {
    return false;
  }

  const firstItemInputIndex = recipe.inputs.findIndex((input) => input.kind === "item");
  return slot.resourceIndex === firstItemInputIndex;
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
            <span className="mb-0.5 block truncate text-[8px] font-bold uppercase leading-3 text-[var(--mc-ink-muted)]">
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
              <select
                value={control.current.key}
                onChange={(event) => onSelect(control.id, event.target.value)}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                disabled={control.tiers.length <= 1}
                className="h-6 min-w-0 flex-1 border border-[var(--mc-33)] bg-[var(--mc-85)] px-1 text-[10px] font-bold leading-4 text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-100),inset_-1px_-1px_0_var(--mc-54)] outline-none focus:border-cyan-700 focus:bg-white disabled:cursor-not-allowed disabled:text-[var(--mc-33)]"
                title={`${control.label}: ${control.current.label}`}
                aria-label={control.label}
              >
                {control.tiers.map((tier) => (
                  <option key={tier.key} value={tier.key}>
                    {tier.label}
                  </option>
                ))}
              </select>
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
}: {
  className?: string;
  controls: MachineConfigTierControl[];
  onSelect: (controlId: string, nextTier: string) => void;
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
          <label key={control.id} className="min-w-0">
            <span className="mb-0.5 block truncate text-[8px] font-bold uppercase leading-3 text-[var(--mc-ink-muted)]">
              {control.label}
            </span>
            <select
              value={control.current.key}
              onChange={(event) => onSelect(control.id, event.target.value)}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              disabled={control.tiers.length <= 1}
              className="h-6 w-full min-w-0 border border-[var(--mc-33)] bg-[var(--mc-85)] px-1 text-[10px] font-bold leading-4 text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-100),inset_-1px_-1px_0_var(--mc-54)] outline-none focus:border-cyan-700 focus:bg-white disabled:cursor-not-allowed disabled:text-[var(--mc-33)]"
              title={`${control.label}: ${control.current.label}`}
              aria-label={control.label}
            >
              {control.tiers.map((tier) => (
                <option key={tier.key} value={tier.key}>
                  {tier.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  );
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

function MachineParallelIndicator({ multiplier }: { multiplier: number }) {
  if (!Number.isFinite(multiplier) || multiplier <= 1) {
    return null;
  }

  return (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-71)] text-[13px] font-black leading-none text-[var(--mc-ink)] shadow-[inset_2px_2px_0_var(--mc-93),inset_-2px_-2px_0_var(--mc-47)]"
      title={`${formatMachineParallelMultiplier(multiplier)} parallels`}
      aria-label={`${formatMachineParallelMultiplier(multiplier)} parallels`}
    >
      {formatMachineParallelMultiplier(multiplier)}
    </div>
  );
}

function formatMachineParallelMultiplier(multiplier: number) {
  return Number.isInteger(multiplier)
    ? String(multiplier)
    : multiplier.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function getSuggestedMachineCount(result: NodeThroughputResult | undefined, current: number) {
  const exact = result?.theoreticalMachinesRequired;
  if (!Number.isFinite(exact) || exact === undefined || exact <= 0) {
    return Math.max(1, Math.round(current));
  }

  return Math.max(1, Math.ceil(exact));
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

  if (pending.nodeId === nodeId && pending.handleId === handleId) {
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
  suggestedMachineCount,
  onChange,
  onOptimize,
}: {
  label: string;
  machineCount: number;
  suggestedMachineCount: number;
  onChange: (machineCount: number) => void;
  onOptimize: () => void;
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

  return (
    <div className="min-w-0 border border-[var(--mc-47)] bg-[var(--mc-71)] px-1 shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
      <div className="truncate text-[9px] uppercase text-[var(--mc-ink-muted)]">{label}</div>
      <div className="flex min-w-0 items-center gap-1">
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
          className="nodrag h-[18px] w-0 min-w-0 flex-1 border border-[var(--mc-47)] bg-[var(--mc-85)] px-1 text-[12px] font-medium leading-4 text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-100),inset_-1px_-1px_0_var(--mc-54)] outline-none focus:border-cyan-700 focus:bg-white focus:ring-1 focus:ring-cyan-400"
        />
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOptimize();
          }}
          onPointerDown={(event) => event.stopPropagation()}
          className="nodrag flex h-4 w-4 shrink-0 items-center justify-center border border-[var(--mc-33)] bg-[var(--mc-82)] text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-100),inset_-1px_-1px_0_var(--mc-47)] hover:bg-[var(--mc-100)]"
          title={`Set ${label.toLowerCase()} to ${suggestedMachineCount}x`}
          aria-label={`Set ${label.toLowerCase()} to ${suggestedMachineCount}`}
        >
          <WandSparkles className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

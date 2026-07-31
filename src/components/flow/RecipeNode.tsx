"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, Minus, Plus, Sprout, WandSparkles } from "lucide-react";
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
  isRecipeInputConsumed,
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
import { NeiRecipeWindow } from "@/components/nei/NeiRecipeWindow";
import { CropPickerMenu } from "./CropPickerMenu";
import { MachineCompareTable, MachineGlanceBar, MachineTabStrip } from "./MachinePicker";
import { useMachineHandlerIcons } from "./machine-icons";
import { MinecraftSelect } from "./MinecraftSelect";
import { MinecraftTooltip } from "@/components/nei/MinecraftTooltip";
import { MachineStatsContent } from "./MachineStatsContent";
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
  const machineCategory = recipe.source?.recipeMap ?? recipe.machineType;
  // While hovering a machine tab, the card's own Total/Usage/Time lines show
  // that machine's base numbers instead of opening any popup.
  const neiDisplayRecipe = isPreviewing
    ? {
        ...overclockedRecipe,
        ...(() => {
          const previewApplied = applyMachineHandlerToRecipe(recipe, {
            machineHandlerId: previewHandler.id,
          });
          return {
            machineType: previewApplied.machineType,
            minimumTier: previewApplied.minimumTier,
            durationTicks: previewApplied.durationTicks,
            eut: previewApplied.eut,
          };
        })(),
      }
    : overclockedRecipe;

  return (
    <div
      className={[
        "group relative min-w-[368px] w-max border-2 border-[var(--mc-96)] bg-[var(--mc-78)] font-mono text-[var(--mc-ink)] shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33)]",
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
              {hasMachinePicker ? (
                <MachineGlanceBar
                  recipe={recipe}
                  category={machineCategory}
                  handler={previewHandler}
                  icon={machineIcons.get(previewHandler.id)}
                  isPreview={isPreviewing}
                />
              ) : (
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
                    "minecraft-title flex h-6 min-w-0 items-center border-2 border-[var(--mc-33)] bg-[var(--mc-61)] text-[17px] leading-[20px] shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-29)]",
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
                      : (cropTitle ?? selectedMachineHandler.label)}
                  </span>
                  {isCropFarmNode ? (
                    <ChevronDown className="absolute right-1 top-1/2 h-3 w-3 shrink-0 -translate-y-1/2" />
                  ) : null}
                </div>
              )}
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
          <NeiRecipeWindow
            recipe={neiDisplayRecipe}
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
          )}
          {!usesNativeNeiRecipe && !isCropFarmPlaceholder ? (
            <RateLedger recipe={neiDisplayRecipe} result={result} />
          ) : null}
          {!usesNativeNeiRecipe ? machineConfigPanel : null}
          {!usesNativeNeiRecipe ? passiveProductionPanel : null}
        </div>

        {!usesNativeNeiRecipe && !isCropFarmPlaceholder ? (
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

/**
 * Always-visible throughput strip under the recipe window: an icon + rate chip
 * per resource, inputs then outputs. Shows the current (utilization-scaled)
 * flow so a plan can be read without hovering; the per-slot tooltip keeps the
 * Now / At-100% breakdown.
 */
function RateLedger({
  recipe,
  result,
}: {
  recipe: Pick<Recipe, "inputs" | "outputs">;
  result: NodeThroughputResult | undefined;
}) {
  if (!result) {
    return null;
  }

  const speed = Number.isFinite(result.utilization)
    ? Math.min(Math.max(result.utilization, 0), 1)
    : 0;
  const collect = (flows: NodeThroughputResult["inputs"], resources: ResourceAmount[]) =>
    Object.values(flows)
      .filter((flow) => flow.amountPerSecond > 1e-9)
      .map((flow) => ({
        flow,
        resource: resources.find(
          (entry) => entry.kind === flow.kind && entry.id === flow.resourceId,
        ),
      }));
  const inputs = collect(result.inputs, recipe.inputs);
  const outputs = collect(result.outputs, recipe.outputs);
  if (inputs.length === 0 && outputs.length === 0) {
    return null;
  }

  // Some recipes carry hundreds of chanced outputs; past this the strip stops
  // being a summary. The overflow marker's tooltip lists what was cut.
  const MAX_CHIPS_PER_SIDE = 8;
  const chips = (allEntries: typeof inputs, side: "input" | "output") => {
    const entries = allEntries.slice(0, MAX_CHIPS_PER_SIDE);
    const hidden = allEntries.slice(MAX_CHIPS_PER_SIDE);
    return [
      ...entries.map(({ flow, resource }) => (
      <span
        key={`${side}:${flow.key}`}
        className="flex items-center gap-1"
        title={flow.displayName ?? flow.resourceId}
      >
        {resource ? (
          <ResourceIcon
            // Chance and NC badges are unreadable at 16px and the rate text is
            // the point here.
            resource={{ ...resource, amount: 1, chance: undefined }}
            bare
            tooltip={false}
            showAmount={false}
            showConsumedState={false}
            iconPixelSize={26}
            className="!h-4 !w-4 shrink-0"
          />
        ) : null}
        <span
          className={[
            "text-[10px] font-bold leading-4 tabular-nums",
            side === "output" ? "text-emerald-700" : "text-[var(--mc-ink)]",
          ].join(" ")}
        >
          {formatSlotRate(flow.amountPerSecond * speed, flow.kind)}
        </span>
      </span>
      )),
      ...(hidden.length > 0
        ? [
            <span
              key={`${side}:overflow`}
              className="text-[10px] font-bold leading-4 text-[var(--mc-ink-muted)]"
              title={hidden
                .map(({ flow }) => flow.displayName ?? flow.resourceId)
                .join(", ")}
            >
              +{hidden.length}
            </span>,
          ]
        : []),
    ];
  };

  return (
    // w-0 min-w-full keeps the strip from widening the w-max node shell: it
    // adopts the node's width (the canvas decides it) and wraps chips to fit.
    <div className="mt-1 flex w-0 min-w-full flex-wrap items-center gap-x-2 gap-y-0.5 border-2 border-[var(--mc-47)] bg-[var(--mc-71)] px-1.5 py-0.5 shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
      <span className="text-[8px] font-black uppercase leading-4 tracking-[1.5px] text-[var(--mc-ink-muted)]">
        Rates
      </span>
      {chips(inputs, "input")}
      {inputs.length > 0 && outputs.length > 0 ? (
        <span className="text-[10px] font-black leading-4 text-[var(--mc-ink-muted)]">→</span>
      ) : null}
      {chips(outputs, "output")}
    </div>
  );
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

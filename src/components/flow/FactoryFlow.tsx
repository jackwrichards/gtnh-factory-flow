"use client";

import {
  Background,
  BaseEdge,
  Controls,
  ConnectionMode,
  EdgeLabelRenderer,
  Position,
  ReactFlow,
  applyNodeChanges,
  getNodesBounds,
  getSmoothStepPath,
  getViewportForBounds,
  type Connection,
  type ConnectionLineComponentProps,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeTypes,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
  useStore,
  useStoreApi,
} from "@xyflow/react";
import { toBlob, toSvg } from "html-to-image";
import { Archive, LoaderCircle, Paintbrush, Target, X } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  FLOW_IMAGE_EXPORT_COMPLETE_EVENT,
  FLOW_IMAGE_EXPORT_EVENT,
  dataUrlToText,
  embedProjectJsonInPng,
  embedProjectJsonInSvg,
} from "@/lib/import-export/plan-image";
import type { Theme } from "@/lib/theme";
import { useThemeStore } from "@/store/theme-store";
import {
  applyRecipeInputOverrides,
  restoreCrossKindInputOverrideVisuals,
  applyMachineHandlerToRecipe,
  isRecipeInputConsumed,
  makeResourceKey,
  formatNumberWithThousands,
  resourceMatchesInput,
  trimTrailingDecimalZeros,
} from "@/lib/model";
import { applyMachineOutputMultipliers } from "@/lib/solver/machine-effects";
import { getOverclockedRecipeStats } from "@/lib/solver/overclock";
import type {
  EdgeThroughput,
  FactoryEdge,
  FactoryNodeColorTag,
  FactoryProject,
  Recipe,
  ResourceAmount,
  ResourceKind,
} from "@/lib/model/types";
import { useFactoryStore } from "@/store/factory-store";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { RecipeNode, type RecipeFlowNode } from "./RecipeNode";
import { GT_NODE_COLORS, GT_NODE_COLOR_PALETTE } from "./node-colors";
import { makeResourceHandleId, parseResourceHandleId } from "./resource-handles";
import { formatEdgeRateLabel, formatEdgeValue, isEdgeStarved } from "./edge-labels";
import {
  EDGE_DETAIL_ARROWS,
  EDGE_DETAIL_GLOBAL,
  EDGE_DETAIL_LABELS,
  getEdgeDetailLevel,
  hasEdgeDetail,
  reuseObjectIdentity,
} from "./edge-detail";
import { StorageNode, type StorageFlowNode } from "./StorageNode";
import { StockpileNode, type StockpileFlowNode } from "./StockpileNode";
import { GAP_FILL_REQUEST_EVENT, RequestNode, type RequestFlowNode } from "./RequestNode";
import { AddRequestDialog } from "@/components/planner/AddRequestDialog";
import { GapFillDialog } from "@/components/planner/GapFillDialog";
import { StockpileEditorDialog } from "@/components/planner/StockpileEditorDialog";

const nodeTypes = {
  recipeNode: RecipeNode,
  storageNode: StorageNode,
  stockpileNode: StockpileNode,
  requestNode: RequestNode,
} satisfies NodeTypes;

const ResourceEdge = memo(ResourceEdgeComponent);

const edgeTypes = {
  resourceEdge: ResourceEdge,
} satisfies EdgeTypes;

function selectEdgeDetailLevel(store: { transform: [number, number, number] }) {
  return getEdgeDetailLevel(store.transform[2]);
}

const connectionLineStyle = {
  stroke: "#00d9ff",
  strokeWidth: 5,
  strokeOpacity: 0.95,
  filter: "drop-shadow(0 0 5px rgba(0,217,255,0.9))",
};

const DEFAULT_ITEM_EDGE_COLOR = "#8b8f98";
const DEFAULT_FLUID_EDGE_COLOR = "#2f89c5";

// React Flow's Background and the html-to-image exporter both need a concrete
// colour rather than a CSS variable, so these mirror --canvas / --canvas-dot.
const CANVAS_COLOR: Record<Theme, string> = {
  light: "#f5f5f5",
  dark: "#1b1d21",
};
const CANVAS_DOT_COLOR: Record<Theme, string> = {
  light: "#d4d4d4",
  dark: "#34363c",
};

const RECIPE_SLOT_EDGE_OFFSET = 20;
const STORAGE_SLOT_EDGE_OFFSET = 55;
const EDGE_BUNDLE_CLEARANCE = 30;
const DIRECT_EDGE_NODE_CLEARANCE = 18;
const EDGE_LANE_SPACING = 8;
const EDGE_LANE_BUCKETS = 4;
const EDGE_LINK_CLEARANCE = 8;
const EDGE_ENDPOINT_SPACING = 5;
const EDGE_ROUTE_RELAXATION_PASSES = 2;
const EDGE_ROUTE_SNAP_GRID = 4;
const EXPORT_IMAGE_PADDING = 80;
const EXPORT_PNG_PIXEL_RATIO = 2;
const EXPORT_PNG_MAX_PIXEL_SIDE = 8192;
const FLOW_EDGE_LABEL_SELECT_EVENT = "gtnh-flow.edge-label-select";
type ResourceEdgeData = {
  resource: Pick<
    ResourceAmount,
    "kind" | "id" | "amount" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
  >;
  color: string;
  demand: number;
  transferred?: number;
  /** What the consumer wants at 100%, so a shortfall can be shown as a ratio. */
  nameplateDemand?: number;
  unit: string;
  isLimited: boolean;
  /** Producer is maxed out and the consumer is going hungry. */
  isSupplyCapped: boolean;
  isStorageEdge: boolean;
  showLabel: boolean;
  labelOffset?: { x: number; y: number };
  sourceHandleId?: string | null;
  targetHandleId?: string | null;
  sourceSlotEndpoint: boolean;
  targetSlotEndpoint: boolean;
  sourceStorageEndpoint: boolean;
  targetStorageEndpoint: boolean;
  sourceEndpointOffset?: number;
  targetEndpointOffset?: number;
  routeIndex: number;
  bundle?: {
    role: "primary" | "member";
    mode: "single-target" | "multi-target";
    size: number;
    sourceHandleIds: string[];
    primarySourceHandleId: string;
    edgeIds: string[];
    demand?: number;
    transferred?: number;
    nameplateDemand?: number;
    isLimited: boolean;
    isSupplyCapped: boolean;
  };
  isFlowHighlighted?: boolean;
};

type ResourceFlowEdge = Edge<ResourceEdgeData, "resourceEdge">;

type BoardFlowNode = RecipeFlowNode | StorageFlowNode | StockpileFlowNode | RequestFlowNode;

type SlotEdgeEndpoint = { x: number; y: number; side: Position };
type RoutedEdgePath = {
  path: string;
  labelX: number;
  labelY: number;
  points: Array<{ x: number; y: number }>;
};

const directRouteCache = new Map<
  string,
  {
    signature: string;
    routeIndex: number;
    route: RoutedEdgePath;
    segments: ReturnType<typeof getPolylineSegments>;
  }
>();
// Measured geometry is stored in FLOW coordinates, which are invariant under pan
// and zoom: translating the viewport cannot move a node relative to the graph
// origin. Keying these caches on the viewport transform (as they once were) threw
// every entry away on every pan frame and forced a full re-measure of the whole
// board, which is what made panning and zooming crawl.
//
// Instead they are keyed on a layout epoch that the board bumps when node
// positions or sizes actually change. Only `viewportTransformCache` is
// frame-scoped, because the screen->flow conversion genuinely does depend on the
// live transform.
type MeasuredBounds = { left: number; right: number; top: number; bottom: number };

const missingRecipePlaceholders = new Map<string, RecipeFlowNode["data"]["recipe"]>();

/**
 * Stable stand-in for a recipe the dataset no longer contains. Built once per id
 * so the node's `data` keeps a constant identity across rebuilds.
 */
function getMissingRecipePlaceholder(recipeId: string) {
  const existing = missingRecipePlaceholders.get(recipeId);
  if (existing) {
    return existing;
  }

  const placeholder = {
    id: recipeId,
    name: "Missing recipe",
    machineType: "Unknown",
    minimumTier: "DEMO",
    durationTicks: 20,
    eut: 0,
    inputs: [],
    outputs: [],
  } satisfies RecipeFlowNode["data"]["recipe"];
  missingRecipePlaceholders.set(recipeId, placeholder);
  return placeholder;
}

// Identity caches for node `data`. These are memoisation caches in the same
// spirit as useMemo â€” the value returned is always derived purely from the
// inputs, so a render that is discarded or replayed cannot produce a wrong
// result, only a different (equivalent) object identity. They live at module
// scope rather than in a ref because reading a ref during render is not allowed.
const recipeNodeDataCache = new Map<string, RecipeFlowNode["data"]>();
const storageNodeDataCache = new Map<string, StorageFlowNode["data"]>();
const stockpileNodeDataCache = new Map<string, StockpileFlowNode["data"]>();
const requestNodeDataCache = new Map<string, RequestFlowNode["data"]>();

function pruneNodeDataCaches(
  recipeNodeIds: Set<string>,
  storageIds: Set<string>,
  stockpileIds: Set<string>,
  requestIds: Set<string>,
) {
  for (const id of recipeNodeDataCache.keys()) {
    if (!recipeNodeIds.has(id)) {
      recipeNodeDataCache.delete(id);
    }
  }

  for (const id of storageNodeDataCache.keys()) {
    if (!storageIds.has(id)) {
      storageNodeDataCache.delete(id);
    }
  }

  for (const id of stockpileNodeDataCache.keys()) {
    if (!stockpileIds.has(id)) {
      stockpileNodeDataCache.delete(id);
    }
  }

  for (const id of requestNodeDataCache.keys()) {
    if (!requestIds.has(id)) {
      requestNodeDataCache.delete(id);
    }
  }
}

const measuredSlotEndpointCache = new Map<string, { x: number; y: number } | undefined>();
const measuredSlotCenterCache = new Map<string, { x: number; y: number } | undefined>();
const measuredNodeBoundsCache = new Map<string, MeasuredBounds | undefined>();
let measuredAvoidanceSweep:
  | { epoch: number; bounds: Array<{ id: string; bounds: MeasuredBounds }>; hash: string }
  | undefined;
let measuredLayoutEpoch = 0;

let viewportTransformCache:
  | {
      rendererLeft: number;
      rendererTop: number;
      translateX: number;
      translateY: number;
      scaleX: number;
      scaleY: number;
    }
  | undefined;
let viewportTransformClearScheduled = false;

/**
 * Drops every flow-space measurement. Call this when node positions or node
 * inner layout change â€” never on pan or zoom, which cannot affect flow-space
 * geometry.
 */
function invalidateMeasuredLayout() {
  measuredLayoutEpoch += 1;
  measuredSlotEndpointCache.clear();
  measuredSlotCenterCache.clear();
  measuredNodeBoundsCache.clear();
  measuredAvoidanceSweep = undefined;
}

type DraggedResourceConnection = Pick<
  ResourceAmount,
  | "kind"
  | "id"
  | "displayName"
  | "iconPath"
  | "iconAtlas"
  | "dominantColor"
  | "tooltip"
  | "alternatives"
> & {
  nodeId: string;
  side: "input" | "output";
  handleId: string;
};

interface ResolvedResourceHandle {
  nodeId: string;
  handleId: string;
  side: "input" | "output";
  kind: ResourceKind;
  resourceId: string;
}

export function FactoryFlow() {
  const theme = useThemeStore((state) => state.theme);
  const project = useFactoryStore((state) => state.project);
  const result = useFactoryStore((state) => state.lastResult);
  const selectNode = useFactoryStore((state) => state.selectNode);
  const setNodePosition = useFactoryStore((state) => state.setNodePosition);
  const updateNode = useFactoryStore((state) => state.updateNode);
  const updateStorage = useFactoryStore((state) => state.updateStorage);
  const setStoragePosition = useFactoryStore((state) => state.setStoragePosition);
  const setStockpilePosition = useFactoryStore((state) => state.setStockpilePosition);
  const setRequestPosition = useFactoryStore((state) => state.setRequestPosition);
  const addStockpile = useFactoryStore((state) => state.addStockpile);
  const connectNodes = useFactoryStore((state) => state.connectNodes);
  const addStorageForConnection = useFactoryStore((state) => state.addStorageForConnection);
  const selectedNodeId = useFactoryStore((state) => state.selectedNodeId);
  const deleteNode = useFactoryStore((state) => state.deleteNode);
  const deleteStorage = useFactoryStore((state) => state.deleteStorage);
  const deleteStockpile = useFactoryStore((state) => state.deleteStockpile);
  const deleteRequest = useFactoryStore((state) => state.deleteRequest);
  const deleteEdge = useFactoryStore((state) => state.deleteEdge);
  const cancelResourceConnection = useFactoryStore((state) => state.cancelResourceConnection);
  const nodeColorPaintMode = useFactoryStore((state) => state.nodeColorPaintMode);
  const setNodeColorPaintMode = useFactoryStore((state) => state.setNodeColorPaintMode);
  const setFlowViewportCenter = useFactoryStore((state) => state.setFlowViewportCenter);
  const hoveredStorageResourceKey = useFactoryStore((state) => state.hoveredStorageResourceKey);
  const hoveredFlowResourceKey = useFactoryStore((state) => state.hoveredFlowResourceKey);
  const selectedFlowResourceKey = useFactoryStore((state) => state.selectedFlowResourceKey);
  const hoveredNodeBottlenecks = useFactoryStore((state) => state.hoveredNodeBottlenecks);
  const selectedNodeBottlenecks = useFactoryStore((state) => state.selectedNodeBottlenecks);
  const recipeSearch = useFactoryStore((state) => state.highlightSearch);
  const isProjectImporting = useFactoryStore((state) => state.isProjectImporting);
  const activeFlowResourceKey = hoveredFlowResourceKey ?? selectedFlowResourceKey;
  const activeNodeBottlenecks = hoveredNodeBottlenecks || selectedNodeBottlenecks;
  const recipesById = useMemo(
    () => new Map(project.recipes.map((recipe) => [recipe.id, recipe])),
    [project.recipes],
  );
  const storagesById = useMemo(
    () => new Map((project.storages ?? []).map((storage) => [storage.id, storage])),
    [project.storages],
  );

  const nodesFromProject = useMemo<BoardFlowNode[]>(
    () => [
      ...project.nodes.map((node) => {
        const recipe = recipesById.get(node.recipeId) ?? getMissingRecipePlaceholder(node.recipeId);
        return {
          id: node.id,
          type: "recipeNode",
          position: node.position,
          zIndex:
            activeNodeBottlenecks && result.nodes[node.id]?.status === "bottleneck"
              ? 1500
              : activeFlowResourceKey && recipeContainsResourceKey(recipe, activeFlowResourceKey)
                ? 1500
                : undefined,
          // Reusing the previous `data` object when nothing in it moved is what
          // lets RecipeNode's memo actually hold. Rebuilding it â€” which this memo
          // does whenever a resource is hovered or the solver re-runs â€” otherwise
          // re-renders every node on the board for a change affecting one.
          data: reuseObjectIdentity(recipeNodeDataCache, node.id, {
            projectNode: node,
            recipe,
            result: result.nodes[node.id],
          }),
        } satisfies RecipeFlowNode;
      }),
      ...(project.storages ?? []).map(
        (storage) =>
          ({
            id: storage.id,
            type: "storageNode",
            position: storage.position,
            zIndex:
              activeFlowResourceKey === makeResourceKey(storage.kind, storage.resourceId)
                ? 1500
                : undefined,
            data: reuseObjectIdentity(storageNodeDataCache, storage.id, {
              storage,
              result: result.storages[storage.id],
            }),
          }) satisfies StorageFlowNode,
      ),
      ...(project.stockpiles ?? []).map(
        (stockpile) =>
          ({
            id: stockpile.id,
            type: "stockpileNode",
            position: stockpile.position,
            data: reuseObjectIdentity(stockpileNodeDataCache, stockpile.id, {
              stockpile,
              tappedCount: new Set(
                project.edges
                  .filter((edge) => edge.source === stockpile.id)
                  .map((edge) => makeResourceKey(edge.resourceKind, edge.resourceId)),
              ).size,
            }),
          }) satisfies StockpileFlowNode,
      ),
      ...(project.requests ?? []).map(
        (request) =>
          ({
            id: request.id,
            type: "requestNode",
            position: request.position,
            zIndex:
              activeFlowResourceKey === makeResourceKey(request.kind, request.resourceId)
                ? 1500
                : undefined,
            data: reuseObjectIdentity(requestNodeDataCache, request.id, {
              request,
              fulfilledPerSecond: project.edges
                .filter((edge) => edge.target === request.id)
                .reduce(
                  (total, edge) => total + (result.edges[edge.id]?.transferredPerSecond ?? 0),
                  0,
                ),
              hasStockpile: (project.stockpiles ?? []).length > 0,
            }),
          }) satisfies RequestFlowNode,
      ),
    ],
    [
      activeFlowResourceKey,
      activeNodeBottlenecks,
      project.edges,
      project.nodes,
      project.requests,
      project.stockpiles,
      project.storages,
      recipesById,
      result.edges,
      result.nodes,
      result.storages,
    ],
  );
  const [flowNodes, setFlowNodes] = useState<BoardFlowNode[]>(() => nodesFromProject);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [isNodeDragging, setNodeDragging] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [gapFill, setGapFill] = useState<{ stockpileId: string; requestId: string } | undefined>(
    undefined,
  );
  const [isAddRequestOpen, setAddRequestOpen] = useState(false);
  const draggingNodeRef = useRef(false);
  const draggedResourceRef = useRef<DraggedResourceConnection | undefined>(undefined);
  const lastConnectionPointerRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const connectCompletedRef = useRef(false);
  const exportInProgressRef = useRef(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const flowInstanceRef = useRef<ReactFlowInstance<BoardFlowNode, ResourceFlowEdge> | null>(null);

  useEffect(() => {
    if (draggingNodeRef.current) {
      return;
    }

    setFlowNodes(nodesFromProject);
  }, [nodesFromProject]);

  useEffect(() => {
    pruneNodeDataCaches(
      new Set(project.nodes.map((node) => node.id)),
      new Set((project.storages ?? []).map((storage) => storage.id)),
      new Set((project.stockpiles ?? []).map((stockpile) => stockpile.id)),
      new Set((project.requests ?? []).map((request) => request.id)),
    );
  }, [project.nodes, project.requests, project.stockpiles, project.storages]);

  // Flow-space measurements are cached across frames, so anything that can move a
  // node or change its size has to drop them explicitly. Positions are covered by
  // `flowNodes` (drags included, since React Flow rewrites it per frame); sizes
  // are not, because a node can grow on its own when icons or NEI layout resolve.
  useLayoutEffect(() => {
    invalidateMeasuredLayout();

    const board = boardRef.current;
    if (!board || typeof ResizeObserver === "undefined") {
      return;
    }

    let pending = false;
    const observer = new ResizeObserver(() => {
      if (pending) {
        return;
      }

      pending = true;
      // Coalesce the burst ResizeObserver emits when it first observes each node,
      // and re-route only once the browser has settled on the new sizes.
      window.requestAnimationFrame(() => {
        pending = false;
        invalidateMeasuredLayout();
        setLayoutVersion((version) => version + 1);
      });
    });

    for (const nodeElement of board.querySelectorAll<HTMLElement>(".react-flow__node")) {
      observer.observe(nodeElement);
    }

    return () => observer.disconnect();
  }, [flowNodes]);

  const handleNodesChange = useCallback((changes: NodeChange<BoardFlowNode>[]) => {
    setFlowNodes((currentNodes) => applyNodeChanges(changes, currentNodes) as BoardFlowNode[]);
  }, []);

  const edges = useMemo<ResourceFlowEdge[]>(() => {
    const edgeBundles = getEdgeBundles(project, project.edges, result.edges);
    const endpointOffsets = getEdgeEndpointOffsets(project);

    return project.edges.map((edge, edgeIndex) => {
      const edgeResult = result.edges[edge.id];
      const unit = edge.resourceKind === "fluid" ? "L/s" : "/s";
      const demand = edgeResult?.demandPerSecond ?? edge.ratePerSecond ?? 0;
      const transferred = edgeResult?.transferredPerSecond ?? demand;
      // isLimited almost never survives the solver's utilisation convergence,
      // since demand gets scaled down to whatever supply exists. The nameplate
      // comparison is what actually catches a starved machine.
      const isSupplyCapped = edgeResult?.constraint === "supply";
      const isStarvedEdge = isSupplyCapped || edgeResult?.isLimited === true;
      const sourceStorage = storagesById.get(edge.source);
      const targetStorage = storagesById.get(edge.target);
      const isStorageEdge = Boolean(sourceStorage || targetStorage);
      const storageResourceKey = sourceStorage
        ? `${sourceStorage.kind}:${sourceStorage.resourceId}`
        : targetStorage
          ? `${targetStorage.kind}:${targetStorage.resourceId}`
          : undefined;
      const resource = getEdgeResource(project, edge);
      const edgeColor = getInitialResourceColor(resource);
      const sourceHandle = parseResourceHandleId(edge.sourceHandle);
      const targetHandle = parseResourceHandleId(edge.targetHandle);
      const isStorageEdgeActive =
        !isStorageEdge || hoveredStorageResourceKey === storageResourceKey;
      const isSearchEdgeActive = edgeMatchesSearch(edge, resource, recipeSearch);
      const isStorageEdgeEmphasized = Boolean(
        isStorageEdge && (isStorageEdgeActive || isSearchEdgeActive),
      );
      const isFlowHighlighted =
        activeFlowResourceKey === makeResourceKey(edge.resourceKind, edge.resourceId);

      return {
        id: edge.id,
        zIndex: isNodeDragging ? 2000 : isFlowHighlighted ? 1200 : 20,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        type: "resourceEdge",
        data: {
          resource,
          color: edgeColor,
          demand,
          transferred: isStarvedEdge ? transferred : undefined,
          nameplateDemand: edgeResult?.nameplateDemandPerSecond,
          unit,
          isLimited: edgeResult?.isLimited === true,
          isSupplyCapped,
          isStorageEdge,
          showLabel: true,
          labelOffset: edge.labelOffset,
          sourceHandleId: edge.sourceHandle,
          targetHandleId: edge.targetHandle,
          sourceSlotEndpoint: Boolean(sourceHandle && !sourceStorage),
          targetSlotEndpoint: Boolean(targetHandle && !targetStorage),
          sourceStorageEndpoint: Boolean(sourceHandle && sourceStorage),
          targetStorageEndpoint: Boolean(targetHandle && targetStorage),
          sourceEndpointOffset: endpointOffsets.get(`${edge.id}:source`),
          targetEndpointOffset: endpointOffsets.get(`${edge.id}:target`),
          routeIndex: edgeIndex,
          bundle: edgeBundles.get(edge.id),
          isFlowHighlighted,
        },
        style: {
          stroke: edgeColor,
          strokeDasharray: isStarvedEdge ? "4 6" : undefined,
          strokeOpacity: isFlowHighlighted
            ? 1
            : isStarvedEdge
              ? 0.58
              : isStorageEdge
                ? 0.86
                : 0.92,
          strokeWidth: isFlowHighlighted
            ? 5
            : isStorageEdge
              ? isStorageEdgeEmphasized
                ? 3.5
                : 2.6
              : isStarvedEdge
                ? 2.2
                : edge.resourceKind === "fluid"
                  ? 2.8
                  : 2.35,
        },
      };
    });
    // `layoutVersion` is a deliberate cache-bust token rather than a value this
    // memo reads: when a node changes size the routes it produces are stale, and
    // re-issuing the edge objects is what forces them to re-measure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeFlowResourceKey,
    hoveredStorageResourceKey,
    isNodeDragging,
    layoutVersion,
    project,
    recipeSearch,
    result.edges,
    storagesById,
  ]);

  const connectResourceEdges = useCallback(
    (
      sourceNodeId: string,
      targetNodeId: string,
      resource?: Pick<
        ResourceAmount,
        "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor" | "tooltip"
      > & {
        sourceHandle?: string;
        targetHandle?: string;
      },
    ) => {
      const sourceHandleIds =
        resource?.sourceHandle && resource.kind && resource.id
          ? getRepeatedOutputHandleIds(project, sourceNodeId, resource)
          : [];
      const shouldBatchRepeatedOutputs =
        resource?.sourceHandle &&
        sourceHandleIds.length > 1 &&
        sourceHandleIds.includes(resource.sourceHandle);

      if (!resource || !shouldBatchRepeatedOutputs) {
        connectNodes(sourceNodeId, targetNodeId, resource);
        return;
      }

      const allRepeatedEdgesExist = sourceHandleIds.every((sourceHandle) =>
        project.edges.some(
          (edge) =>
            edge.source === sourceNodeId &&
            edge.target === targetNodeId &&
            edge.resourceKind === resource.kind &&
            edge.resourceId === resource.id &&
            edge.sourceHandle === sourceHandle &&
            edge.targetHandle === resource.targetHandle,
        ),
      );

      for (const sourceHandle of sourceHandleIds) {
        const alreadyExists = project.edges.some(
          (edge) =>
            edge.source === sourceNodeId &&
            edge.target === targetNodeId &&
            edge.resourceKind === resource.kind &&
            edge.resourceId === resource.id &&
            edge.sourceHandle === sourceHandle &&
            edge.targetHandle === resource.targetHandle,
        );

        if (!allRepeatedEdgesExist && alreadyExists) {
          continue;
        }

        connectNodes(sourceNodeId, targetNodeId, {
          ...resource,
          sourceHandle,
        });
      }
    },
    [connectNodes, project],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      connectCompletedRef.current = true;
      if (connection.source && connection.target) {
        // The smart arrow: stockpile → request never becomes a plain edge. It
        // opens the gap-fill planner, which builds the whole chain between them.
        const stockpiles = project.stockpiles ?? [];
        const requests = project.requests ?? [];
        const sourceStockpile = stockpiles.find((entry) => entry.id === connection.source);
        const targetStockpile = stockpiles.find((entry) => entry.id === connection.target);
        const sourceRequest = requests.find((entry) => entry.id === connection.source);
        const targetRequest = requests.find((entry) => entry.id === connection.target);

        if ((sourceStockpile && targetRequest) || (sourceRequest && targetStockpile)) {
          setGapFill({
            stockpileId: (sourceStockpile ?? targetStockpile)!.id,
            requestId: (targetRequest ?? sourceRequest)!.id,
          });
          return;
        }

        if (sourceStockpile || targetStockpile) {
          const stockpile = (sourceStockpile ?? targetStockpile)!;
          const nodeId = sourceStockpile ? connection.target : connection.source;
          const nodeHandle = sourceStockpile ? connection.targetHandle : connection.sourceHandle;
          const inputResource = nodeHandle
            ? getResourceForHandle(project, nodeId, nodeHandle)
            : undefined;
          const stockedEntry = inputResource
            ? stockpile.resources.find((resource) => resourceMatchesInput(resource, inputResource))
            : undefined;
          connectNodes(
            stockpile.id,
            nodeId,
            stockedEntry
              ? {
                  kind: stockedEntry.kind,
                  id: stockedEntry.id,
                  displayName: stockedEntry.displayName,
                  iconPath: stockedEntry.iconPath,
                  iconAtlas: stockedEntry.iconAtlas,
                  dominantColor: stockedEntry.dominantColor,
                  targetHandle: nodeHandle ?? undefined,
                }
              : undefined,
          );
          return;
        }

        if (sourceRequest || targetRequest) {
          const request = (sourceRequest ?? targetRequest)!;
          const nodeId = targetRequest ? connection.source : connection.target;
          const nodeHandle = targetRequest ? connection.sourceHandle : connection.targetHandle;
          connectNodes(nodeId, request.id, {
            kind: request.kind,
            id: request.resourceId,
            displayName: request.displayName,
            sourceHandle: nodeHandle ?? undefined,
          });
          return;
        }

        const sourceHandle = parseResourceHandleId(connection.sourceHandle);
        const targetHandle = parseResourceHandleId(connection.targetHandle);

        if (sourceHandle && targetHandle && sourceHandle.side !== targetHandle.side) {
          const outputHandle =
            sourceHandle.side === "output"
              ? { nodeId: connection.source, handleId: connection.sourceHandle ?? undefined }
              : { nodeId: connection.target, handleId: connection.targetHandle ?? undefined };
          const inputHandle =
            sourceHandle.side === "input"
              ? { nodeId: connection.source, handleId: connection.sourceHandle ?? undefined }
              : { nodeId: connection.target, handleId: connection.targetHandle ?? undefined };
          const outputResource = outputHandle.handleId
            ? getResourceForHandle(project, outputHandle.nodeId, outputHandle.handleId)
            : undefined;
          const inputResource = inputHandle.handleId
            ? getResourceForHandle(project, inputHandle.nodeId, inputHandle.handleId)
            : undefined;

          if (
            !outputResource ||
            !inputResource ||
            !resourceMatchesInput(outputResource, inputResource)
          ) {
            return;
          }

          connectResourceEdges(outputHandle.nodeId, inputHandle.nodeId, {
            kind: outputResource.kind,
            id: outputResource.id,
            displayName: outputResource.displayName,
            iconPath: outputResource.iconPath,
            iconAtlas: outputResource.iconAtlas,
            dominantColor: outputResource.dominantColor ?? outputResource.iconAtlas?.dominantColor,
            tooltip: outputResource.tooltip,
            sourceHandle: outputHandle.handleId,
            targetHandle: inputHandle.handleId,
          });
          return;
        }

        if (connection.sourceHandle || connection.targetHandle) {
          return;
        }

        connectResourceEdges(connection.source, connection.target);
      }
    },
    [connectNodes, connectResourceEdges, project],
  );

  const isValidResourceConnection = useCallback(
    (connection: Connection | Edge) => isCompatibleResourceConnection(project, connection),
    [project],
  );

  const handleConnectStart = useCallback(
    (
      event: MouseEvent | TouchEvent,
      params: { nodeId: string | null; handleId: string | null },
    ) => {
      const eventHandle =
        event.target instanceof Element
          ? readResourceHandleElement(
              event.target.closest<HTMLElement>("[data-resource-handle='true']"),
            )
          : undefined;
      const nodeId = params.nodeId ?? eventHandle?.nodeId;
      const handleId = params.handleId ?? eventHandle?.handleId;

      connectCompletedRef.current = false;
      lastConnectionPointerRef.current = getClientPosition(event);
      draggedResourceRef.current =
        nodeId && handleId ? getDraggedResourceForHandle(project, nodeId, handleId) : undefined;
    },
    [project],
  );

  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const draggedResource = draggedResourceRef.current;
      draggedResourceRef.current = undefined;
      const clientPosition = getClientPosition(event) ?? lastConnectionPointerRef.current;
      lastConnectionPointerRef.current = undefined;
      const targetHandle =
        getResourceHandleAtPosition(clientPosition) ??
        getResourceHandleAtPointer(event) ??
        getStorageHandleAtPosition(clientPosition, draggedResource) ??
        getStorageHandleAtPointer(event, draggedResource);

      if (connectCompletedRef.current) {
        return;
      }

      if (draggedResource && targetHandle) {
        if (isCompatibleDraggedResourceTarget(project, draggedResource, targetHandle)) {
          const source =
            draggedResource.side === "output"
              ? {
                  nodeId: draggedResource.nodeId,
                  handleId: draggedResource.handleId,
                }
              : {
                  nodeId: targetHandle.nodeId,
                  handleId: targetHandle.handleId,
                };
          const target =
            draggedResource.side === "input"
              ? {
                  nodeId: draggedResource.nodeId,
                  handleId: draggedResource.handleId,
                }
              : {
                  nodeId: targetHandle.nodeId,
                  handleId: targetHandle.handleId,
                };
          const outputResource =
            draggedResource.side === "output"
              ? draggedResource
              : getResourceForHandle(project, targetHandle.nodeId, targetHandle.handleId);

          if (!outputResource) {
            return;
          }

          connectCompletedRef.current = true;
          connectResourceEdges(source.nodeId, target.nodeId, {
            kind: outputResource.kind,
            id: outputResource.id,
            displayName: outputResource.displayName,
            iconPath: outputResource.iconPath,
            iconAtlas: outputResource.iconAtlas,
            dominantColor: outputResource.dominantColor ?? outputResource.iconAtlas?.dominantColor,
            tooltip: outputResource.tooltip,
            sourceHandle: source.handleId,
            targetHandle: target.handleId,
          });
        }
        return;
      }

      const flowInstance = flowInstanceRef.current;
      if (
        !draggedResource ||
        connectCompletedRef.current ||
        isPointerOverIncompatibleFlowHandle(project, event, draggedResource) ||
        !flowInstance
      ) {
        return;
      }

      if (!clientPosition) {
        return;
      }

      if ((project.storages ?? []).some((storage) => storage.id === draggedResource.nodeId)) {
        return;
      }

      const position = flowInstance.screenToFlowPosition(clientPosition);
      addStorageForConnection(
        draggedResource,
        draggedResource.nodeId,
        draggedResource.side,
        { x: position.x - 78, y: position.y - 62 },
        draggedResource.handleId,
      );
    },
    [addStorageForConnection, connectResourceEdges, project],
  );

  useEffect(() => {
    const updatePointerPosition = (event: PointerEvent | MouseEvent | TouchEvent) => {
      if (!draggedResourceRef.current) {
        return;
      }

      lastConnectionPointerRef.current = getClientPosition(event);
    };

    window.addEventListener("pointermove", updatePointerPosition, { passive: true });
    window.addEventListener("mousemove", updatePointerPosition, { passive: true });
    window.addEventListener("touchmove", updatePointerPosition, { passive: true });
    return () => {
      window.removeEventListener("pointermove", updatePointerPosition);
      window.removeEventListener("mousemove", updatePointerPosition);
      window.removeEventListener("touchmove", updatePointerPosition);
    };
  }, []);

  const updateFlowViewportCenter = useCallback(() => {
    const instance = flowInstanceRef.current;
    const board = boardRef.current;
    if (!instance || !board) {
      return;
    }

    const rect = board.getBoundingClientRect();
    setFlowViewportCenter(
      instance.screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      }),
    );
  }, [setFlowViewportCenter]);

  const handleMoveStart = useCallback(() => {
    boardRef.current?.classList.add("factory-flow-board--moving");
  }, []);

  const handleMoveEnd = useCallback(() => {
    boardRef.current?.classList.remove("factory-flow-board--moving");
    updateFlowViewportCenter();
  }, [updateFlowViewportCenter]);

  const handleInit = useCallback(
    (instance: ReactFlowInstance<BoardFlowNode, ResourceFlowEdge>) => {
      flowInstanceRef.current = instance;
      window.requestAnimationFrame(updateFlowViewportCenter);
      window.setTimeout(updateFlowViewportCenter, 120);
    },
    [updateFlowViewportCenter],
  );

  const exportFlowImage = useCallback(
    async (format: "svg" | "png", requestId: string, fileName: string, projectJson: string) => {
      if (exportInProgressRef.current) {
        dispatchImageExportComplete(requestId);
        return;
      }

      const viewportElement = boardRef.current?.querySelector<HTMLElement>(".react-flow__viewport");

      if (!viewportElement) {
        dispatchImageExportComplete(requestId);
        return;
      }

      exportInProgressRef.current = true;
      await nextAnimationFrame();

      const nodesBounds = getNodesBounds(flowNodes);
      const imageWidth = getExportImageSize(nodesBounds.width);
      const imageHeight = getExportImageSize(nodesBounds.height);
      const viewport = getViewportForBounds(
        nodesBounds,
        imageWidth,
        imageHeight,
        0.15,
        1.8,
        EXPORT_IMAGE_PADDING / Math.max(imageWidth, imageHeight),
      );
      const options = {
        // Read lazily so switching theme does not rebuild this callback.
        backgroundColor: CANVAS_COLOR[useThemeStore.getState().theme],
        width: imageWidth,
        height: imageHeight,
        style: {
          width: `${imageWidth}px`,
          height: `${imageHeight}px`,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        },
      };

      try {
        if (format === "svg") {
          const svgText = embedProjectJsonInSvg(
            dataUrlToText(
              await toSvg(viewportElement, {
                ...options,
                filter: exportNodeFilter,
                skipFonts: true,
              }),
            ),
            projectJson,
          );
          downloadBlob(new Blob([svgText], { type: "image/svg+xml" }), `${fileName}.svg`);
          return;
        }

        const imageBlob = await toBlob(viewportElement, {
          ...options,
          filter: exportNodeFilter,
          pixelRatio: getExportPngPixelRatio(imageWidth, imageHeight),
          skipFonts: true,
        });
        if (!imageBlob) {
          return;
        }

        const pngBlob = await embedProjectJsonInPng(imageBlob, projectJson);
        downloadBlob(pngBlob, `${fileName}.png`);
      } catch (error) {
        console.error(error instanceof Error ? error.message : "Plan image export failed.");
      } finally {
        exportInProgressRef.current = false;
        dispatchImageExportComplete(requestId);
      }
    },
    [flowNodes],
  );

  useEffect(() => {
    const handleExportImage = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { format?: unknown; requestId?: unknown; fileName?: unknown; projectJson?: unknown }
        | undefined;

      if (
        (detail?.format !== "svg" && detail?.format !== "png") ||
        typeof detail.requestId !== "string" ||
        typeof detail.fileName !== "string" ||
        typeof detail.projectJson !== "string"
      ) {
        return;
      }

      void exportFlowImage(detail.format, detail.requestId, detail.fileName, detail.projectJson);
    };

    window.addEventListener(FLOW_IMAGE_EXPORT_EVENT, handleExportImage);
    return () => window.removeEventListener(FLOW_IMAGE_EXPORT_EVENT, handleExportImage);
  }, [exportFlowImage]);

  useEffect(() => {
    const handleEdgeLabelSelect = (event: Event) => {
      const detail = (event as CustomEvent).detail as { edgeIds?: unknown } | undefined;
      if (
        !Array.isArray(detail?.edgeIds) ||
        !detail.edgeIds.every((edgeId) => typeof edgeId === "string")
      ) {
        return;
      }

      setSelectedEdgeIds(detail.edgeIds);
      setSelectedNodeIds([]);
      selectNode(undefined);
    };

    window.addEventListener(FLOW_EDGE_LABEL_SELECT_EVENT, handleEdgeLabelSelect);
    return () => window.removeEventListener(FLOW_EDGE_LABEL_SELECT_EVENT, handleEdgeLabelSelect);
  }, [selectNode]);

  useEffect(() => {
    // The request node's wand: same planner as the smart arrow, using the
    // first stockpile on the board as the supply anchor.
    const handleGapFillRequest = (event: Event) => {
      const detail = (event as CustomEvent).detail as { requestId?: unknown } | undefined;
      if (typeof detail?.requestId !== "string") {
        return;
      }

      const firstStockpile = (useFactoryStore.getState().project.stockpiles ?? [])[0];
      if (!firstStockpile) {
        return;
      }

      setGapFill({ stockpileId: firstStockpile.id, requestId: detail.requestId });
    };

    window.addEventListener(GAP_FILL_REQUEST_EVENT, handleGapFillRequest);
    return () => window.removeEventListener(GAP_FILL_REQUEST_EVENT, handleGapFillRequest);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Delete") {
        if (isEditableKeyboardTarget(event.target)) {
          return;
        }

        if (selectedEdgeIds.length > 0 || selectedNodeIds.length > 0) {
          selectedEdgeIds.forEach((edgeId) => deleteEdge(edgeId));
          selectedNodeIds.forEach((nodeId) => {
            if (project.nodes.some((node) => node.id === nodeId)) {
              deleteNode(nodeId);
              return;
            }

            if ((project.storages ?? []).some((storage) => storage.id === nodeId)) {
              deleteStorage(nodeId);
              return;
            }

            if ((project.stockpiles ?? []).some((stockpile) => stockpile.id === nodeId)) {
              deleteStockpile(nodeId);
              return;
            }

            if ((project.requests ?? []).some((request) => request.id === nodeId)) {
              deleteRequest(nodeId);
            }
          });
          setSelectedEdgeIds([]);
          setSelectedNodeIds([]);
          selectNode(undefined);
          return;
        }

        if (selectedNodeId) {
          if (project.nodes.some((node) => node.id === selectedNodeId)) {
            deleteNode(selectedNodeId);
            return;
          }

          if ((project.storages ?? []).some((storage) => storage.id === selectedNodeId)) {
            deleteStorage(selectedNodeId);
            selectNode(undefined);
            return;
          }

          if ((project.stockpiles ?? []).some((stockpile) => stockpile.id === selectedNodeId)) {
            deleteStockpile(selectedNodeId);
            selectNode(undefined);
            return;
          }

          if ((project.requests ?? []).some((request) => request.id === selectedNodeId)) {
            deleteRequest(selectedNodeId);
            selectNode(undefined);
            return;
          }
        }

        cancelResourceConnection();
        setNodeColorPaintMode(undefined);
        return;
      }

      if (event.key === "Escape") {
        if (isEditableKeyboardTarget(event.target)) {
          return;
        }

        cancelResourceConnection();
        setNodeColorPaintMode(undefined);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    cancelResourceConnection,
    deleteEdge,
    deleteNode,
    deleteRequest,
    deleteStockpile,
    deleteStorage,
    project.nodes,
    project.requests,
    project.stockpiles,
    project.storages,
    selectNode,
    selectedEdgeIds,
    selectedNodeIds,
    selectedNodeId,
    setNodeColorPaintMode,
  ]);

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }: OnSelectionChangeParams) => {
      setSelectedNodeIds(selectedNodes.map((node) => node.id));
      setSelectedEdgeIds(selectedEdges.map((edge) => edge.id));

      const selectedRecipeNode = [...selectedNodes]
        .reverse()
        .find((node) => node.type === "recipeNode");
      selectNode(selectedRecipeNode?.id);
    },
    [selectNode],
  );

  const handleNodeClick = useCallback(
    (_: unknown, node: Node) => {
      if (nodeColorPaintMode !== undefined) {
        if (node.type === "recipeNode") {
          updateNode(node.id, { colorTag: nodeColorPaintMode ?? undefined });
          return;
        }

        if (node.type === "storageNode") {
          updateStorage(node.id, { colorTag: nodeColorPaintMode ?? undefined });
          return;
        }

        return;
      }

      if (node.type === "stockpileNode" || node.type === "requestNode") {
        return;
      }

      selectNode(node.id);
    },
    [nodeColorPaintMode, selectNode, updateNode, updateStorage],
  );

  const handlePaneClick = useCallback(() => {
    selectNode(undefined);
    cancelResourceConnection();
  }, [cancelResourceConnection, selectNode]);

  const handleNodeDragStart = useCallback(() => {
    draggingNodeRef.current = true;
    setNodeDragging(true);
  }, []);

  const handleNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      if (node.type === "storageNode") {
        setStoragePosition(node.id, node.position);
      } else if (node.type === "stockpileNode") {
        setStockpilePosition(node.id, node.position);
      } else if (node.type === "requestNode") {
        setRequestPosition(node.id, node.position);
      } else {
        setNodePosition(node.id, node.position);
      }

      draggingNodeRef.current = false;
      setNodeDragging(false);
      setFlowNodes((currentNodes) =>
        currentNodes.map((entry) =>
          entry.id === node.id ? ({ ...entry, position: node.position } as typeof entry) : entry,
        ),
      );
    },
    [setNodePosition, setRequestPosition, setStockpilePosition, setStoragePosition],
  );

  const handleEdgesDelete = useCallback(
    (deletedEdges: Edge[]) => {
      deletedEdges.forEach((edge) => deleteEdge(edge.id));
    },
    [deleteEdge],
  );

  const fitViewOptions = useMemo(() => ({ padding: 0.18 }), []);

  return (
    <div
      ref={boardRef}
      className={[
        "factory-flow-board relative h-full min-h-[520px] overflow-hidden border-x border-line bg-canvas",
        isNodeDragging ? "factory-flow-board--dragging" : "",
      ].join(" ")}
    >
      <ReactFlow
        nodes={flowNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onConnect={handleConnect}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        onInit={handleInit}
        onMoveStart={handleMoveStart}
        onMoveEnd={handleMoveEnd}
        isValidConnection={isValidResourceConnection}
        connectionLineComponent={ResourceConnectionLine}
        connectionLineStyle={connectionLineStyle}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={18}
        elevateNodesOnSelect={false}
        edgesReconnectable={false}
        onNodeClick={handleNodeClick}
        onNodesChange={handleNodesChange}
        onSelectionChange={handleSelectionChange}
        onPaneClick={handlePaneClick}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onEdgesDelete={handleEdgesDelete}
        fitView
        fitViewOptions={fitViewOptions}
        onlyRenderVisibleElements
        minZoom={0.15}
        maxZoom={1.8}
        colorMode={theme}
      >
        <Background gap={24} color={CANVAS_DOT_COLOR[theme]} />
        <Controls position="bottom-left" />
      </ReactFlow>
      <PaintToolbar paintMode={nodeColorPaintMode} onPaintModeChange={setNodeColorPaintMode} />
      <PlannerToolbar
        onAddStockpile={addStockpile}
        onAddRequest={() => setAddRequestOpen(true)}
      />
      <StockpileEditorDialog />
      {isAddRequestOpen ? <AddRequestDialog onClose={() => setAddRequestOpen(false)} /> : null}
      {gapFill ? (
        <GapFillDialog
          stockpileId={gapFill.stockpileId}
          requestId={gapFill.requestId}
          onClose={() => setGapFill(undefined)}
        />
      ) : null}
      {isProjectImporting ? <FlowLoadingOverlay /> : null}
    </div>
  );
}

function PlannerToolbar({
  onAddStockpile,
  onAddRequest,
}: {
  onAddStockpile: () => void;
  onAddRequest: () => void;
}) {
  return (
    <div className="absolute left-3 top-3 z-20 flex gap-1.5">
      <button
        type="button"
        onClick={onAddStockpile}
        className="flex h-8 items-center gap-1.5 border-2 border-[var(--mc-15)] bg-[var(--mc-78)] px-2 text-xs font-semibold text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-100),inset_-1px_-1px_0_var(--mc-33)] hover:brightness-110"
        title="Place a stockpile: everything you have in abundance"
      >
        <Archive className="h-3.5 w-3.5" />
        Stockpile
      </button>
      <button
        type="button"
        onClick={onAddRequest}
        className="flex h-8 items-center gap-1.5 border-2 border-[var(--mc-15)] bg-[var(--mc-78)] px-2 text-xs font-semibold text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-100),inset_-1px_-1px_0_var(--mc-33)] hover:brightness-110"
        title="Place a request: something you want made"
      >
        <Target className="h-3.5 w-3.5" />
        Request
      </button>
    </div>
  );
}

function FlowLoadingOverlay() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto absolute inset-0 z-50 grid place-items-center bg-neutral-950/18 backdrop-blur-[1px]"
    >
      <div className="flex items-center gap-3 border-2 border-[var(--mc-15)] bg-[var(--mc-78)] px-4 py-3 text-sm font-semibold text-[var(--mc-ink)] shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33),4px_4px_0_rgba(0,0,0,0.18)]">
        <LoaderCircle className="h-5 w-5 animate-spin" />
        <span>Loading flowchart...</span>
      </div>
    </div>
  );
}

function PaintToolbar({
  paintMode,
  onPaintModeChange,
}: {
  paintMode?: FactoryNodeColorTag | null;
  onPaintModeChange: (tag: FactoryNodeColorTag | null | undefined) => void;
}) {
  const activeColor = paintMode ? GT_NODE_COLORS[paintMode] : undefined;
  const [isPaletteOpen, setPaletteOpen] = useState(false);

  return (
    <div
      className="nodrag pointer-events-none absolute bottom-12 right-3 z-20 flex items-end"
      onMouseEnter={() => setPaletteOpen(true)}
      onMouseLeave={() => setPaletteOpen(false)}
    >
      <div
        className={[
          "mr-0 grid w-[156px] grid-cols-5 gap-1 border-2 border-[var(--mc-15)] bg-[var(--mc-78)] p-1 shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33)] transition-[opacity,transform] duration-100",
          isPaletteOpen
            ? "pointer-events-auto translate-x-0 opacity-100"
            : "pointer-events-none translate-x-2 opacity-0",
        ].join(" ")}
      >
        <button
          type="button"
          onClick={() => onPaintModeChange(paintMode === null ? undefined : null)}
          className={[
            "flex h-7 w-7 items-center justify-center border-2 bg-[var(--mc-49)] text-white shadow-[inset_1px_1px_0_var(--mc-85),inset_-1px_-1px_0_var(--mc-25)]",
            paintMode === null ? "border-white ring-2 ring-cyan-300" : "border-[var(--mc-15)]",
          ].join(" ")}
          title="Erase colors"
          aria-label="Erase colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        {GT_NODE_COLOR_PALETTE.map((entry) => (
          <button
            key={entry.tag}
            type="button"
            onClick={() => onPaintModeChange(paintMode === entry.tag ? undefined : entry.tag)}
            className={[
              "h-7 w-7 border-2 shadow-[inset_1px_1px_0_rgba(255,255,255,0.45),inset_-1px_-1px_0_rgba(0,0,0,0.45)]",
              paintMode === entry.tag ? "border-white ring-2 ring-cyan-300" : "border-[var(--mc-15)]",
            ].join(" ")}
            style={{ backgroundColor: entry.color.swatch }}
            title={entry.tag}
            aria-label={`Paint ${entry.tag}`}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => {
          if (paintMode !== undefined) {
            onPaintModeChange(undefined);
          }
        }}
        className={[
          "pointer-events-auto relative z-10 flex h-9 w-9 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)]",
          paintMode !== undefined ? "ring-2 ring-cyan-300" : "",
        ].join(" ")}
        title={paintMode !== undefined ? "Stop painting" : "Paint nodes"}
        aria-label={paintMode !== undefined ? "Stop painting" : "Paint nodes"}
      >
        {paintMode === undefined ? (
          <Paintbrush className="h-4 w-4" />
        ) : paintMode === null ? (
          <X className="h-4 w-4" />
        ) : (
          <span
            className="h-5 w-5 border-2 border-[var(--mc-15)] shadow-[inset_1px_1px_0_rgba(255,255,255,0.45),inset_-1px_-1px_0_rgba(0,0,0,0.45)]"
            style={{ backgroundColor: activeColor?.swatch }}
          />
        )}
      </button>
    </div>
  );
}

function ResourceEdgeComponent({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  source,
  sourceHandleId,
  targetX,
  targetY,
  targetPosition,
  target,
  targetHandleId,
  style,
  selected,
  data,
}: EdgeProps<ResourceFlowEdge>) {
  const updateEdge = useFactoryStore((state) => state.updateEdge);
  const detailLevel = useStore(selectEdgeDetailLevel);
  // Label dragging needs the exact zoom to convert a pointer delta into flow
  // units, but reading it through a subscription would re-render every edge on
  // every zoom frame. The store API gives the live value on demand instead.
  const flowStore = useStoreApi();
  const storedLabelOffsetX = data?.labelOffset?.x ?? 0;
  const storedLabelOffsetY = data?.labelOffset?.y ?? 0;
  const storedLabelOffset = { x: storedLabelOffsetX, y: storedLabelOffsetY };
  const [draftLabelOffset, setDraftLabelOffset] = useState(storedLabelOffset);
  const [isLabelDragging, setLabelDragging] = useState(false);
  const labelDragRef = useRef<
    | {
        pointerId: number;
        clientX: number;
        clientY: number;
        offset: { x: number; y: number };
      }
    | undefined
  >(undefined);
  const resourceColor = data?.resource
    ? getInitialResourceColor(data.resource)
    : (data?.color ?? DEFAULT_ITEM_EDGE_COLOR);
  const edgeColor = resourceColor;
  const isGlobalView = hasEdgeDetail(detailLevel, EDGE_DETAIL_GLOBAL);
  const isHighlighted = selected || data?.isFlowHighlighted === true;
  // AGENTS.md requires routing to be deterministic and independent of zoom
  // level. Precise routing used to be switched off below 0.45 because measuring
  // was expensive; now that measurements are cached across frames it always runs,
  // so a route no longer changes shape when the user zooms out.
  const shouldUsePreciseRouting = true;
  const visualSourceCandidates = getSlotEdgeEndpointCandidates({
    nodeId: source,
    handleId: data?.sourceHandleId ?? sourceHandleId,
    position: sourcePosition,
    estimatedX: sourceX,
    estimatedY: sourceY,
    endpointOffset: data?.sourceEndpointOffset,
    isRecipeSlotEndpoint: data?.sourceSlotEndpoint,
    isStorageSlotEndpoint: data?.sourceStorageEndpoint,
    counterpartX: targetX,
    counterpartY: targetY,
    measureEndpoints: shouldUsePreciseRouting,
  });
  const visualTargetCandidates = getSlotEdgeEndpointCandidates({
    nodeId: target,
    handleId: data?.targetHandleId ?? targetHandleId,
    position: targetPosition,
    estimatedX: targetX,
    estimatedY: targetY,
    endpointOffset: data?.targetEndpointOffset,
    isRecipeSlotEndpoint: data?.targetSlotEndpoint,
    isStorageSlotEndpoint: data?.targetStorageEndpoint,
    counterpartX: sourceX,
    counterpartY: sourceY,
    measureEndpoints: shouldUsePreciseRouting,
  });
  const visualSource = visualSourceCandidates[0];
  const visualTarget = visualTargetCandidates[0];
  const rate = formatEdgeRateLabel(data);
  const isHiddenBundleMember =
    data?.bundle?.role === "member" && data.bundle.mode === "single-target";
  const showLabel = Boolean(
    data?.showLabel &&
    !isHiddenBundleMember &&
      (selected || data.isFlowHighlighted || hasEdgeDetail(detailLevel, EDGE_DETAIL_LABELS)),
  );
  const showArrowHead = isHighlighted || hasEdgeDetail(detailLevel, EDGE_DETAIL_ARROWS);
  const labelOffset = isLabelDragging ? draftLabelOffset : storedLabelOffset;
  const routedEdge =
    data?.bundle?.role === "primary"
      ? getBundledEdgePath({
          edgeId: id,
          sourceNodeId: source,
          sourceHandleIds: data.bundle.sourceHandleIds,
          sourcePosition: visualSource.side,
          estimatedSource: visualSource,
          targetNodeId: target,
          targetX: visualTarget.x,
          targetY: visualTarget.y,
          targetPosition: visualTarget.side,
          usePreciseRouting: shouldUsePreciseRouting,
        })
      : data?.bundle?.mode === "multi-target"
        ? getBundledMemberEdgePath({
            edgeId: id,
            sourceNodeId: source,
            sourceHandleId: data.sourceHandleId ?? sourceHandleId ?? undefined,
            sourcePosition: visualSource.side,
            estimatedSource: visualSource,
            targetNodeId: target,
            targetX: visualTarget.x,
            targetY: visualTarget.y,
            targetPosition: visualTarget.side,
            bundleSourceHandleIds: data.bundle.sourceHandleIds,
            usePreciseRouting: shouldUsePreciseRouting,
          })
        : getDirectEdgePath({
            edgeId: id,
            routeIndex: data?.routeIndex ?? 0,
            sourceNodeId: source,
            sourceCandidates: visualSourceCandidates,
            sourceX: visualSource.x,
            sourceY: visualSource.y,
            sourcePosition: visualSource.side,
            targetNodeId: target,
            targetCandidates: visualTargetCandidates,
            targetX: visualTarget.x,
            targetY: visualTarget.y,
            targetPosition: visualTarget.side,
            laneOffset: getEdgeLaneOffset(id),
            useSmartRouting: shouldUsePreciseRouting,
          });
  const labelX = routedEdge.labelX + labelOffset.x;
  const labelY = routedEdge.labelY + labelOffset.y;

  const stopLabelDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!labelDragRef.current) {
        return;
      }

      event.currentTarget.releasePointerCapture(labelDragRef.current.pointerId);
      labelDragRef.current = undefined;
      setLabelDragging(false);
      const nextOffset =
        Math.abs(draftLabelOffset.x) < 1 && Math.abs(draftLabelOffset.y) < 1
          ? undefined
          : draftLabelOffset;
      updateEdge(id, { labelOffset: nextOffset });
    },
    [draftLabelOffset, id, updateEdge],
  );

  return (
    <>
      {!isHiddenBundleMember ? (
        <>
          <path
            data-resource-edge-route={id}
            d={routedEdge.path}
            fill="none"
            stroke="transparent"
            strokeWidth="0"
            pointerEvents="none"
          />
          <BaseEdge
            path={routedEdge.path}
            interactionWidth={0}
            style={{
              stroke: "#111827",
              strokeDasharray: isGlobalView && isEdgeStarved(data) ? "2 8" : style?.strokeDasharray,
              strokeLinecap: "round",
              strokeLinejoin: "round",
              strokeOpacity: isHighlighted ? 0.95 : isGlobalView ? 0.36 : 0.72,
              strokeWidth:
                (isHighlighted
                  ? 6
                  : data?.bundle?.role === "primary"
                    ? Math.max(Number(style?.strokeWidth ?? 2.6) + 0.6, 3.2)
                    : Number(style?.strokeWidth ?? 2.6)) + 2,
              pointerEvents: "none",
            }}
          />
          <BaseEdge
            path={routedEdge.path}
            interactionWidth={0}
            style={{
              ...style,
              stroke: edgeColor,
              strokeDasharray: isGlobalView && isEdgeStarved(data) ? "2 8" : style?.strokeDasharray,
              strokeLinecap: "round",
              strokeLinejoin: "round",
              strokeOpacity: isHighlighted
                ? 1
                : isGlobalView
                  ? isEdgeStarved(data)
                    ? 0.28
                    : 0.52
                  : style?.strokeOpacity,
              strokeWidth: isHighlighted
                ? 6
                : data?.bundle?.role === "primary"
                  ? Math.max(Number(style?.strokeWidth ?? 2.6) + 0.6, 3.2)
                  : style?.strokeWidth,
              filter: isHighlighted ? "drop-shadow(0 0 4px rgba(34,211,238,0.9))" : undefined,
            }}
          />
        </>
      ) : null}
      {!isHiddenBundleMember && showArrowHead ? (
        <polyline
          points={getArrowHeadPointsForRoute({
            points: routedEdge.points,
            estimatedTargetX: visualTarget.x,
            estimatedTargetY: visualTarget.y,
            estimatedTargetPosition: visualTarget.side,
          })}
          stroke="var(--mc-15)"
          strokeWidth={isHighlighted ? 4 : 3.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          style={{
            opacity: isEdgeStarved(data) ? 0.72 : 0.95,
            filter: isHighlighted ? "drop-shadow(0 0 4px rgba(34,211,238,0.9))" : undefined,
            pointerEvents: "none",
          }}
        />
      ) : null}
      {!isHiddenBundleMember && showArrowHead ? (
        <polyline
          points={getArrowHeadPointsForRoute({
            points: routedEdge.points,
            estimatedTargetX: visualTarget.x,
            estimatedTargetY: visualTarget.y,
            estimatedTargetPosition: visualTarget.side,
          })}
          stroke={edgeColor}
          strokeWidth={isHighlighted ? 2.2 : 1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          style={{
            opacity: isEdgeStarved(data) ? 0.78 : 1,
            filter: isHighlighted ? "drop-shadow(0 0 4px rgba(34,211,238,0.9))" : undefined,
            pointerEvents: "none",
          }}
        />
      ) : null}
      {showLabel && data ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute flex cursor-grab items-center gap-1 border border-[var(--mc-15)] bg-[#2b2d32] px-1 py-0.5 text-[10px] font-medium text-white shadow-[inset_1px_1px_0_rgba(255,255,255,0.18),inset_-1px_-1px_0_rgba(0,0,0,0.55)] active:cursor-grabbing"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
              color: isEdgeStarved(data) ? "#fecaca" : "#f8fafc",
              borderColor: edgeColor,
              opacity: isHighlighted ? 1 : isGlobalView ? 0.78 : 0.94,
              boxShadow: isHighlighted ? "0 0 0 2px rgba(34,211,238,0.9)" : undefined,
            }}
            title={`${data.resource.displayName ?? data.resource.id}: ${rate}. Drag along cable. Double click to reset label.`}
            onPointerDown={(event) => {
              event.stopPropagation();
              window.dispatchEvent(
                new CustomEvent(FLOW_EDGE_LABEL_SELECT_EVENT, {
                  detail: { edgeIds: data.bundle?.edgeIds ?? [id] },
                }),
              );
              event.currentTarget.setPointerCapture(event.pointerId);
              labelDragRef.current = {
                pointerId: event.pointerId,
                clientX: event.clientX,
                clientY: event.clientY,
                offset: labelOffset,
              };
              setLabelDragging(true);
              setDraftLabelOffset(labelOffset);
            }}
            onPointerMove={(event) => {
              const drag = labelDragRef.current;
              if (!drag) {
                return;
              }

              event.stopPropagation();
              const flowPoint = screenToFlowPoint(
                { x: event.clientX, y: event.clientY },
                event.currentTarget,
              );
              const cablePoint = flowPoint
                ? getClosestPointOnPolyline(flowPoint, routedEdge.points)
                : undefined;

              if (cablePoint) {
                setDraftLabelOffset({
                  x: cablePoint.x - routedEdge.labelX,
                  y: cablePoint.y - routedEdge.labelY,
                });
              } else {
                const liveZoom = flowStore.getState().transform[2];
                const scale = liveZoom > 0 ? liveZoom : 1;
                setDraftLabelOffset({
                  x: drag.offset.x + (event.clientX - drag.clientX) / scale,
                  y: drag.offset.y + (event.clientY - drag.clientY) / scale,
                });
              }
            }}
            onPointerUp={stopLabelDrag}
            onPointerCancel={stopLabelDrag}
            onDoubleClick={(event) => {
              event.stopPropagation();
              setDraftLabelOffset({ x: 0, y: 0 });
              updateEdge(id, { labelOffset: undefined });
            }}
          >
            <ResourceIcon
              resource={data.resource}
              size="sm"
              showAmount={false}
              bare
              className="!h-4 !w-4"
            />
            <span className="leading-none">{rate}</span>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

function ResourceConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
  connectionStatus,
}: ConnectionLineComponentProps<BoardFlowNode>) {
  const [edgePath] = getSmoothStepPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
  });
  const color = connectionStatus === "invalid" ? "#ef4444" : "#00d9ff";

  return (
    <g className="react-flow__connection">
      <path
        d={edgePath}
        fill="none"
        stroke="#052e36"
        strokeWidth={9}
        strokeLinecap="round"
        opacity={0.75}
      />
      <path
        d={edgePath}
        fill="none"
        stroke={color}
        strokeWidth={5}
        strokeLinecap="round"
        opacity={0.98}
        style={{ filter: `drop-shadow(0 0 5px ${color})` }}
      />
      <circle cx={toX} cy={toY} r={6} fill={color} stroke="#052e36" strokeWidth={2} />
    </g>
  );
}

function getEdgeBundles(
  project: FactoryProject,
  edges: FactoryEdge[],
  edgeResults: Record<
    string,
    {
      demandPerSecond?: number;
      transferredPerSecond?: number;
      isLimited?: boolean;
      nameplateDemandPerSecond?: number;
      constraint?: EdgeThroughput["constraint"];
    }
  >,
) {
  const groups = new Map<string, FactoryEdge[]>();

  for (const edge of edges) {
    const sourceHandle = parseResourceHandleId(edge.sourceHandle);
    if (edge.sourceHandle && (!sourceHandle || sourceHandle.side !== "output")) {
      continue;
    }

    const key = [edge.source, edge.resourceKind, edge.resourceId].join("|");
    const group = groups.get(key);
    if (group) {
      group.push(edge);
    } else {
      groups.set(key, [edge]);
    }
  }

  const bundles = new Map<string, NonNullable<ResourceEdgeData["bundle"]>>();
  for (const group of groups.values()) {
    const explicitSourceHandleIds = [
      ...new Set(
        group
          .map((edge) => edge.sourceHandle)
          .filter((handleId): handleId is string => Boolean(handleId)),
      ),
    ];
    const inferredSourceHandleIds = group.some((edge) => edge.sourceHandle)
      ? []
      : inferRepeatedOutputHandleIds(project, group[0]);
    const sourceHandleIds =
      explicitSourceHandleIds.length > 1 ? explicitSourceHandleIds : inferredSourceHandleIds;
    if (sourceHandleIds.length < 2) {
      continue;
    }

    const primaryEdge = group[Math.floor(group.length / 2)];
    const targetKeys = new Set(
      group.map((edge) => `${edge.target}|${edge.targetHandle ?? ""}|${edge.resourceKind}`),
    );
    const mode = targetKeys.size === 1 ? "single-target" : "multi-target";
    const demand = group.reduce(
      (sum, edge) => sum + (edgeResults[edge.id]?.demandPerSecond ?? edge.ratePerSecond ?? 0),
      0,
    );
    const transferred = group.reduce(
      (sum, edge) =>
        sum +
        (edgeResults[edge.id]?.isLimited
          ? (edgeResults[edge.id]?.transferredPerSecond ?? 0)
          : (edgeResults[edge.id]?.demandPerSecond ?? edge.ratePerSecond ?? 0)),
      0,
    );
    const isLimited = group.some((edge) => edgeResults[edge.id]?.isLimited === true);
    const isSupplyCapped = group.some((edge) => edgeResults[edge.id]?.constraint === "supply");
    const nameplateDemand = group.reduce(
      (sum, edge) => sum + (edgeResults[edge.id]?.nameplateDemandPerSecond ?? 0),
      0,
    );
    const primarySourceHandleId = primaryEdge.sourceHandle ?? sourceHandleIds[0];
    const edgeIds = group.map((edge) => edge.id);
    if (!primarySourceHandleId) {
      continue;
    }

    for (const edge of group) {
      bundles.set(edge.id, {
        role: edge.id === primaryEdge.id ? "primary" : "member",
        mode,
        size: group.length,
        sourceHandleIds,
        primarySourceHandleId,
        edgeIds,
        demand: mode === "single-target" ? demand : undefined,
        transferred: mode === "single-target" && isLimited ? transferred : undefined,
        nameplateDemand: mode === "single-target" ? nameplateDemand : undefined,
        isLimited,
        isSupplyCapped,
      });
    }
  }

  return bundles;
}

function getEdgeEndpointOffsets(project: FactoryProject) {
  const storagesById = new Set((project.storages ?? []).map((storage) => storage.id));
  const nodesById = new Map(project.nodes.map((node) => [node.id, node] as const));
  const groups = new Map<
    string,
    Array<{
      edgeId: string;
      endpoint: "source" | "target";
      counterpartY: number;
    }>
  >();

  for (const edge of project.edges) {
    const sourceHandle = parseResourceHandleId(edge.sourceHandle);
    if (sourceHandle && !storagesById.has(edge.source)) {
      addEndpointOffsetGroupEntry(groups, {
        key: `${edge.source}|${sourceHandle.side}|${getResourceHandleSlotRow(edge.sourceHandle)}`,
        edgeId: edge.id,
        endpoint: "source",
        counterpartY: nodesById.get(edge.target)?.position.y ?? 0,
      });
    }

    const targetHandle = parseResourceHandleId(edge.targetHandle);
    if (targetHandle && !storagesById.has(edge.target)) {
      addEndpointOffsetGroupEntry(groups, {
        key: `${edge.target}|${targetHandle.side}|${getResourceHandleSlotRow(edge.targetHandle)}`,
        edgeId: edge.id,
        endpoint: "target",
        counterpartY: nodesById.get(edge.source)?.position.y ?? 0,
      });
    }
  }

  const offsets = new Map<string, number>();
  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }

    const sortedGroup = [...group].sort(
      (left, right) =>
        left.counterpartY - right.counterpartY ||
        left.edgeId.localeCompare(right.edgeId) ||
        left.endpoint.localeCompare(right.endpoint),
    );
    sortedGroup.forEach((entry, index) => {
      offsets.set(`${entry.edgeId}:${entry.endpoint}`, getStackedEndpointOffset(index));
    });
  }

  return offsets;
}

function getStackedEndpointOffset(index: number) {
  if (index === 0) {
    return 0;
  }

  const step = Math.ceil(index / 2) * EDGE_ENDPOINT_SPACING;
  return index % 2 === 1 ? step : -step;
}

function getResourceHandleSlotRow(handleId?: string | null) {
  const rawIndex = handleId?.split(":")[3];
  const index = rawIndex === undefined ? Number.NaN : Number(rawIndex);
  return Number.isInteger(index) && index >= 0 ? Math.floor(index / 3) : "unknown";
}

function addEndpointOffsetGroupEntry(
  groups: Map<
    string,
    Array<{
      edgeId: string;
      endpoint: "source" | "target";
      counterpartY: number;
    }>
  >,
  entry: {
    key: string;
    edgeId: string;
    endpoint: "source" | "target";
    counterpartY: number;
  },
) {
  const group = groups.get(entry.key);
  if (group) {
    group.push(entry);
    return;
  }

  groups.set(entry.key, [entry]);
}

function inferRepeatedOutputHandleIds(project: FactoryProject, edge: FactoryEdge | undefined) {
  if (!edge) {
    return [];
  }

  return getRepeatedOutputHandleIds(project, edge.source, {
    kind: edge.resourceKind,
    id: edge.resourceId,
  });
}

function getRepeatedOutputHandleIds(
  project: FactoryProject,
  sourceNodeId: string,
  resource: Pick<ResourceAmount, "kind" | "id">,
) {
  const sourceStorage = (project.storages ?? []).find((storage) => storage.id === sourceNodeId);
  if (sourceStorage) {
    return [];
  }

  const sourceNode = project.nodes.find((node) => node.id === sourceNodeId);
  const sourceRecipe = project.recipes.find((recipe) => recipe.id === sourceNode?.recipeId);
  if (!sourceRecipe) {
    return [];
  }

  return sourceRecipe.outputs
    .map((output, outputIndex) =>
      output.kind === resource.kind && output.id === resource.id
        ? makeResourceHandleId("output", output, outputIndex)
        : undefined,
    )
    .filter((handleId): handleId is string => Boolean(handleId));
}

function getDirectEdgePath({
  edgeId,
  laneOffset = 0,
  routeIndex,
  sourceNodeId,
  sourceCandidates,
  sourceX,
  sourceY,
  sourcePosition,
  targetNodeId,
  targetCandidates,
  targetX,
  targetY,
  targetPosition,
  useSmartRouting = true,
}: {
  edgeId?: string;
  laneOffset?: number;
  routeIndex?: number;
  sourceNodeId?: string;
  sourceIsRecipeNode?: boolean;
  sourceCandidates?: SlotEdgeEndpoint[];
  sourceX: number;
  sourceY: number;
  sourcePosition: Position;
  targetNodeId?: string;
  targetIsRecipeNode?: boolean;
  targetCandidates?: SlotEdgeEndpoint[];
  targetX: number;
  targetY: number;
  targetPosition: Position;
  useSmartRouting?: boolean;
}) {
  const points =
    (useSmartRouting
      ? getBestDirectEdgePoints({
          edgeId,
          laneOffset,
          routeIndex,
          sourceNodeId,
          sourceCandidates,
          sourceX,
          sourceY,
          sourcePosition,
          targetNodeId,
          targetCandidates,
          targetX,
          targetY,
          targetPosition,
        })
      : undefined) ??
    getSimpleOrthogonalEdgePoints({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
  const labelPoint = getPointAtPolylineRatio(points, 0.5) ?? {
    x: (sourceX + targetX) / 2,
    y: (sourceY + targetY) / 2,
  };

  return {
    path: pointsToSvgPath(points),
    labelX: labelPoint.x,
    labelY: labelPoint.y,
    points,
  };
}

function getSimpleOrthogonalEdgePoints({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
}: {
  sourceX: number;
  sourceY: number;
  sourcePosition: Position;
  targetX: number;
  targetY: number;
  targetPosition: Position;
}) {
  const source = { x: sourceX, y: sourceY };
  const target = { x: targetX, y: targetY };
  const sourceExit = offsetPointFromSide(source, sourcePosition, DIRECT_EDGE_NODE_CLEARANCE);
  const targetExit = offsetPointFromSide(target, targetPosition, DIRECT_EDGE_NODE_CLEARANCE);
  const sourceVertical = isVerticalSide(String(sourcePosition));
  const targetVertical = isVerticalSide(String(targetPosition));

  if (sourceVertical && targetVertical) {
    const routeY = (sourceExit.y + targetExit.y) / 2;
    return compactPolylinePoints([
      source,
      sourceExit,
      { x: sourceExit.x, y: routeY },
      { x: targetExit.x, y: routeY },
      targetExit,
      target,
    ]);
  }

  if (!sourceVertical && !targetVertical) {
    const routeX = (sourceExit.x + targetExit.x) / 2;
    return compactPolylinePoints([
      source,
      sourceExit,
      { x: routeX, y: sourceExit.y },
      { x: routeX, y: targetExit.y },
      targetExit,
      target,
    ]);
  }

  return compactPolylinePoints([
    source,
    sourceExit,
    sourceVertical ? { x: sourceExit.x, y: targetExit.y } : { x: targetExit.x, y: sourceExit.y },
    targetExit,
    target,
  ]);
}

function getBestDirectEdgePoints({
  edgeId,
  laneOffset,
  routeIndex,
  sourceNodeId,
  sourceCandidates,
  sourceX,
  sourceY,
  sourcePosition,
  targetNodeId,
  targetCandidates,
  targetX,
  targetY,
  targetPosition,
}: {
  edgeId?: string;
  laneOffset: number;
  routeIndex?: number;
  sourceNodeId?: string;
  sourceCandidates?: SlotEdgeEndpoint[];
  sourceX: number;
  sourceY: number;
  sourcePosition: Position;
  targetNodeId?: string;
  targetCandidates?: SlotEdgeEndpoint[];
  targetX: number;
  targetY: number;
  targetPosition: Position;
}) {
  const sourceEndpoints =
    sourceCandidates && sourceCandidates.length > 0
      ? normalizeRouteEndpoints(sourceCandidates)
      : normalizeRouteEndpoints([{ x: sourceX, y: sourceY, side: sourcePosition }]);
  const targetEndpoints =
    targetCandidates && targetCandidates.length > 0
      ? normalizeRouteEndpoints(targetCandidates)
      : normalizeRouteEndpoints([{ x: targetX, y: targetY, side: targetPosition }]);

  // The signature reuses the shared board hash instead of serialising every
  // node's bounds per edge, so an unchanged board is an O(1) string compare and
  // a cache hit never touches the obstacle list at all.
  const routeSignature = getDirectRouteSignature({
    laneOffset,
    sourceEndpoints,
    targetEndpoints,
    boundsHash: getMeasuredAvoidanceSweep().hash,
  });
  const cachedRoute = edgeId ? directRouteCache.get(edgeId) : undefined;
  if (cachedRoute?.signature === routeSignature) {
    return cachedRoute.route.points;
  }

  const normalizedNodeBounds = getMeasuredAvoidanceNodeBounds([sourceNodeId, targetNodeId]);
  const obstacleSegments = getIndexedRouteObstacleSegments(edgeId, routeIndex, routeSignature);
  const candidates = sourceEndpoints.flatMap((sourceEndpoint) =>
    targetEndpoints.flatMap((targetEndpoint) =>
      getDirectEdgePointCandidates({
        laneOffset,
        sourceX: sourceEndpoint.x,
        sourceY: sourceEndpoint.y,
        sourcePosition: sourceEndpoint.side,
        targetX: targetEndpoint.x,
        targetY: targetEndpoint.y,
        targetPosition: targetEndpoint.side,
      }).map((points) => ({
        points,
        endpointPenalty: getEndpointDirectionPenalty(sourceEndpoint, targetEndpoint),
      })),
    ),
  );

  const bestRoute = candidates
    .map((candidate) => ({
      points: candidate.points,
      score:
        scoreEdgeRoute(candidate.points, normalizedNodeBounds, obstacleSegments) +
        candidate.endpointPenalty,
    }))
    .sort((left, right) => left.score - right.score)[0]?.points;
  if (!bestRoute) {
    return undefined;
  }

  let optimizedRoute = bestRoute;
  let optimizedScore = scoreEdgeRoute(bestRoute, normalizedNodeBounds, obstacleSegments);
  for (let pass = 0; pass < EDGE_ROUTE_RELAXATION_PASSES; pass += 1) {
    const relaxedObstacleSegments = getIndexedRouteObstacleSegments(
      edgeId,
      routeIndex,
      routeSignature,
    );
    const relaxedRoute = candidates
      .map((candidate) => ({
        points: candidate.points,
        score:
          scoreEdgeRoute(candidate.points, normalizedNodeBounds, relaxedObstacleSegments) +
          candidate.endpointPenalty,
      }))
      .sort((left, right) => left.score - right.score)[0];
    const currentScore = scoreEdgeRoute(
      optimizedRoute,
      normalizedNodeBounds,
      relaxedObstacleSegments,
    );
    if (
      !relaxedRoute ||
      relaxedRoute.score >= currentScore ||
      relaxedRoute.score >= optimizedScore
    ) {
      break;
    }
    optimizedRoute = relaxedRoute.points;
    optimizedScore = relaxedRoute.score;
  }

  if (edgeId && routeIndex !== undefined) {
    const route = buildRoutedEdgePath(optimizedRoute);
    directRouteCache.set(edgeId, {
      signature: routeSignature,
      routeIndex,
      route,
      segments: getPolylineSegments(optimizedRoute),
    });
  }

  return optimizedRoute;
}

function getDirectEdgePointCandidates({
  laneOffset,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
}: {
  laneOffset: number;
  sourceX: number;
  sourceY: number;
  sourcePosition: Position;
  targetX: number;
  targetY: number;
  targetPosition: Position;
}) {
  const source = { x: sourceX, y: sourceY };
  const target = { x: targetX, y: targetY };
  const sourceExit = offsetPointFromSide(source, sourcePosition, DIRECT_EDGE_NODE_CLEARANCE);
  const targetExit = offsetPointFromSide(target, targetPosition, DIRECT_EDGE_NODE_CLEARANCE);
  const lane = Math.max(EDGE_LINK_CLEARANCE, laneOffset);
  const minX = Math.min(sourceExit.x, targetExit.x);
  const maxX = Math.max(sourceExit.x, targetExit.x);
  const minY = Math.min(sourceExit.y, targetExit.y);
  const maxY = Math.max(sourceExit.y, targetExit.y);
  const routeXs = [
    (sourceExit.x + targetExit.x) / 2,
    minX - 56 - lane,
    maxX + 56 + lane,
    sourceExit.x + (targetExit.x >= sourceExit.x ? 72 + lane : -72 - lane),
    targetExit.x + (targetExit.x >= sourceExit.x ? -72 - lane : 72 + lane),
  ];
  const routeYs = [
    (sourceExit.y + targetExit.y) / 2,
    minY - 56 - lane,
    maxY + 56 + lane,
    sourceExit.y + (targetExit.y >= sourceExit.y ? 72 + lane : -72 - lane),
    targetExit.y + (targetExit.y >= sourceExit.y ? -72 - lane : 72 + lane),
  ];
  const candidates = [
    getSimpleOrthogonalEdgePoints({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    }),
  ];

  for (const routeX of routeXs) {
    candidates.push(
      compactPolylinePoints([
        source,
        sourceExit,
        { x: routeX, y: sourceExit.y },
        { x: routeX, y: targetExit.y },
        targetExit,
        target,
      ]),
    );
  }

  for (const routeY of routeYs) {
    candidates.push(
      compactPolylinePoints([
        source,
        sourceExit,
        { x: sourceExit.x, y: routeY },
        { x: targetExit.x, y: routeY },
        targetExit,
        target,
      ]),
    );
  }

  return dedupePolylineCandidates(candidates);
}

function getDirectRouteSignature({
  laneOffset,
  sourceEndpoints,
  targetEndpoints,
  boundsHash,
}: {
  laneOffset: number;
  sourceEndpoints: SlotEdgeEndpoint[];
  targetEndpoints: SlotEdgeEndpoint[];
  boundsHash: string;
}) {
  return `${laneOffset}|${sourceEndpoints.map(serializeSlotEdgeEndpoint).join(",")}|${targetEndpoints
    .map(serializeSlotEdgeEndpoint)
    .join(",")}|${boundsHash}`;
}

function normalizeRouteEndpoints(endpoints: SlotEdgeEndpoint[]) {
  return [...endpoints]
    .map((endpoint) => ({
      x: snapRouteCoord(endpoint.x),
      y: snapRouteCoord(endpoint.y),
      side: endpoint.side,
    }))
    .sort(
      (left, right) =>
        getRouteSideOrder(left.side) - getRouteSideOrder(right.side) ||
        left.x - right.x ||
        left.y - right.y,
    );
}

function serializeSlotEdgeEndpoint(endpoint: SlotEdgeEndpoint) {
  return `${endpoint.x}:${endpoint.y}:${String(endpoint.side)}`;
}

function snapRouteCoord(value: number) {
  return Math.round(value / EDGE_ROUTE_SNAP_GRID) * EDGE_ROUTE_SNAP_GRID;
}

function getRouteSideOrder(side: Position) {
  switch (side) {
    case Position.Left:
      return 0;
    case Position.Right:
      return 1;
    case Position.Top:
      return 2;
    case Position.Bottom:
      return 3;
    default:
      return 4;
  }
}

function getIndexedRouteObstacleSegments(
  edgeId: string | undefined,
  routeIndex: number | undefined,
  routeSignature: string,
) {
  if (routeIndex === undefined) {
    return [];
  }

  const segments: Array<{
    edgeId: string;
    start: { x: number; y: number };
    end: { x: number; y: number };
    length: number;
  }> = [];

  for (const [cachedEdgeId, cachedRoute] of directRouteCache) {
    if (cachedEdgeId === edgeId || cachedRoute.routeIndex >= routeIndex) {
      continue;
    }

    segments.push(
      ...cachedRoute.segments.map((segment) => ({
        ...segment,
        edgeId: cachedEdgeId,
      })),
    );
  }

  pruneStaleDirectRoutes(edgeId, routeSignature, routeIndex);
  return segments;
}

function pruneStaleDirectRoutes(
  edgeId: string | undefined,
  routeSignature: string,
  routeIndex: number,
) {
  if (!edgeId) {
    return;
  }

  const cachedRoute = directRouteCache.get(edgeId);
  if (cachedRoute && cachedRoute.signature !== routeSignature) {
    directRouteCache.delete(edgeId);
  }

  for (const [cachedEdgeId, cachedRouteEntry] of directRouteCache) {
    if (cachedRouteEntry.routeIndex >= routeIndex + 128) {
      directRouteCache.delete(cachedEdgeId);
    }
  }
}

function buildRoutedEdgePath(points: Array<{ x: number; y: number }>): RoutedEdgePath {
  const labelPoint = getPointAtPolylineRatio(points, 0.5) ??
    points[Math.floor(points.length / 2)] ?? {
      x: 0,
      y: 0,
    };
  return {
    path: pointsToSvgPath(points),
    labelX: labelPoint.x,
    labelY: labelPoint.y,
    points,
  };
}

function scoreEdgeRoute(
  points: Array<{ x: number; y: number }>,
  nodeBounds: Array<{ left: number; right: number; top: number; bottom: number }>,
  existingEdgeSegments: Array<{
    edgeId: string;
    start: { x: number; y: number };
    end: { x: number; y: number };
    length: number;
  }> = [],
) {
  const segments = getPolylineSegments(points);
  const length = segments.reduce((sum, segment) => sum + segment.length, 0);
  let nodeHits = 0;
  let nodeOverlapLength = 0;
  let edgeIntersections = 0;
  let edgeNearness = 0;
  let edgeOverlap = 0;
  let selfIntersections = 0;
  let selfOverlap = 0;
  let foldBacks = 0;

  for (const segment of segments) {
    for (const bounds of nodeBounds) {
      const overlapLength = getSegmentRectOverlapLength(
        segment.start,
        segment.end,
        expandBounds(bounds, EDGE_LINK_CLEARANCE),
      );
      if (overlapLength > 0) {
        nodeHits += 1;
        nodeOverlapLength += overlapLength;
      }
    }

    for (const existing of existingEdgeSegments) {
      if (segment.length < 0.5 || existing.length < 0.5) {
        continue;
      }

      if (segmentsIntersect(segment.start, segment.end, existing.start, existing.end)) {
        edgeIntersections += 1;
      }

      edgeOverlap += getCollinearOverlapLength(segment, existing);

      const distance = getSegmentDistance(segment.start, segment.end, existing.start, existing.end);
      if (distance < EDGE_LINK_CLEARANCE) {
        edgeNearness += ((EDGE_LINK_CLEARANCE - distance) / EDGE_LINK_CLEARANCE) * segment.length;
      }
    }
  }

  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    const current = segments[index];
    const previousDirection = getSegmentUnitVector(previous);
    const currentDirection = getSegmentUnitVector(current);
    const dot = previousDirection.x * currentDirection.x + previousDirection.y * currentDirection.y;

    if (dot < -0.85) {
      foldBacks += 1;
    }
  }

  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 2; rightIndex < segments.length; rightIndex += 1) {
      if (leftIndex === 0 && rightIndex === segments.length - 1) {
        continue;
      }

      const left = segments[leftIndex];
      const right = segments[rightIndex];
      if (segmentsIntersect(left.start, left.end, right.start, right.end)) {
        selfIntersections += 1;
      }
      selfOverlap += getCollinearOverlapLength(left, right);
    }
  }

  const turns = countPolylineTurns(points);
  return (
    nodeOverlapLength * 25_000 +
    nodeHits * 5_000 +
    selfIntersections * 1_000_000 +
    foldBacks * 750_000 +
    selfOverlap * 40_000 +
    edgeOverlap * 9_000 +
    edgeIntersections * 80_000 +
    edgeNearness * 2_500 +
    turns * 700 +
    length
  );
}

function getEndpointDirectionPenalty(source: SlotEdgeEndpoint, target: SlotEdgeEndpoint) {
  const sourceToTarget = { x: target.x - source.x, y: target.y - source.y };
  const targetToSource = { x: source.x - target.x, y: source.y - target.y };
  return (
    getSideDirectionPenalty(source.side, sourceToTarget) +
    getSideDirectionPenalty(target.side, targetToSource)
  );
}

function getSideDirectionPenalty(side: Position, direction: { x: number; y: number }) {
  const sideDirection = getSideUnitVector(side);
  const length = Math.hypot(direction.x, direction.y);
  if (length < 1) {
    return 0;
  }

  const dot = (sideDirection.x * direction.x + sideDirection.y * direction.y) / length;
  if (dot >= 0.15) {
    return 0;
  }

  if (dot >= -0.15) {
    return 80_000;
  }

  return 900_000 + Math.abs(dot) * 250_000;
}

function getSideUnitVector(side: Position) {
  switch (side) {
    case Position.Left:
      return { x: -1, y: 0 };
    case Position.Top:
      return { x: 0, y: -1 };
    case Position.Bottom:
      return { x: 0, y: 1 };
    case Position.Right:
    default:
      return { x: 1, y: 0 };
  }
}

function getSegmentUnitVector(segment: {
  start: { x: number; y: number };
  end: { x: number; y: number };
  length: number;
}) {
  return {
    x: (segment.end.x - segment.start.x) / segment.length,
    y: (segment.end.y - segment.start.y) / segment.length,
  };
}

function offsetPointFromSide(point: { x: number; y: number }, side: Position, distance: number) {
  switch (String(side)) {
    case "left":
      return { x: point.x - distance, y: point.y };
    case "top":
      return { x: point.x, y: point.y - distance };
    case "bottom":
      return { x: point.x, y: point.y + distance };
    case "right":
    default:
      return { x: point.x + distance, y: point.y };
  }
}

function getCleanDirectEdgePoints({
  laneOffset = 0,
  sourceNodeId,
  sourceX,
  sourceY,
  sourcePosition,
  targetNodeId,
  targetX,
  targetY,
  targetPosition,
}: {
  laneOffset?: number;
  sourceNodeId?: string;
  sourceX: number;
  sourceY: number;
  sourcePosition: Position;
  targetNodeId?: string;
  targetX: number;
  targetY: number;
  targetPosition: Position;
}) {
  const sourceBounds = sourceNodeId ? getMeasuredNodeBounds(sourceNodeId) : undefined;
  const targetBounds = targetNodeId ? getMeasuredNodeBounds(targetNodeId) : undefined;

  if (!sourceBounds && !targetBounds) {
    return undefined;
  }

  const sourceExit = getNodeClearancePoint({
    point: { x: sourceX, y: sourceY },
    bounds: sourceBounds,
    position: sourcePosition,
    role: "source",
  });
  const targetExit = getNodeClearancePoint({
    point: { x: targetX, y: targetY },
    bounds: targetBounds,
    position: targetPosition,
    role: "target",
  });

  if (!sourceExit && !targetExit) {
    return undefined;
  }

  const start = sourceExit ?? { x: sourceX, y: sourceY };
  const end = targetExit ?? { x: targetX, y: targetY };
  const sourceSide = String(sourcePosition);
  const targetSide = String(targetPosition);
  if (sourceNodeId && sourceNodeId === targetNodeId && sourceBounds) {
    return compactPolylinePoints([
      { x: sourceX, y: sourceY },
      start,
      ...getSelfNodeEdgePoints(start, end, sourceSide, targetSide, sourceBounds, laneOffset),
      end,
      { x: targetX, y: targetY },
    ]);
  }

  const points =
    isHorizontalSide(sourceSide) || isHorizontalSide(targetSide)
      ? getHorizontalLaneDirectPoints(
          start,
          end,
          sourceSide,
          targetSide,
          sourceBounds,
          targetBounds,
          laneOffset,
        )
      : getVerticalLaneDirectPoints(
          start,
          end,
          sourceSide,
          targetSide,
          sourceBounds,
          targetBounds,
          laneOffset,
        );

  return compactPolylinePoints([
    { x: sourceX, y: sourceY },
    start,
    ...points,
    end,
    { x: targetX, y: targetY },
  ]);
}

function getNodeClearancePoint({
  point,
  bounds,
  position,
  role,
}: {
  point: { x: number; y: number };
  bounds?: { left: number; right: number; top: number; bottom: number };
  position: Position;
  role: "source" | "target";
}) {
  if (!bounds) {
    return undefined;
  }

  const side = String(position);
  switch (side) {
    case "right":
      return {
        x: Math.max(point.x, bounds.right) + DIRECT_EDGE_NODE_CLEARANCE,
        y: point.y,
      };
    case "left":
      return {
        x: Math.min(point.x, bounds.left) - DIRECT_EDGE_NODE_CLEARANCE,
        y: point.y,
      };
    case "bottom":
      return {
        x: point.x,
        y: Math.max(point.y, bounds.bottom) + DIRECT_EDGE_NODE_CLEARANCE,
      };
    case "top":
      return {
        x: point.x,
        y: Math.min(point.y, bounds.top) - DIRECT_EDGE_NODE_CLEARANCE,
      };
    default:
      return role === "source"
        ? {
            x: point.x + DIRECT_EDGE_NODE_CLEARANCE,
            y: point.y,
          }
        : {
            x: point.x - DIRECT_EDGE_NODE_CLEARANCE,
            y: point.y,
          };
  }
}

function getHorizontalLaneDirectPoints(
  start: { x: number; y: number },
  end: { x: number; y: number },
  sourceSide: string,
  targetSide: string,
  sourceBounds?: { left: number; right: number; top: number; bottom: number },
  targetBounds?: { left: number; right: number; top: number; bottom: number },
  laneOffset = 0,
) {
  const goesRight = end.x >= start.x;
  const sourceWantsRight = sourceSide === "right";
  const targetWantsLeft = targetSide === "left";
  const targetWantsRight = targetSide === "right";
  const hasVerticalGap =
    sourceBounds && targetBounds ? !boundsOverlapVertically(sourceBounds, targetBounds) : false;

  if (hasVerticalGap && sourceBounds && targetBounds && (targetWantsLeft || targetWantsRight)) {
    const sourceLaneY =
      end.y >= start.y
        ? sourceBounds.bottom + DIRECT_EDGE_NODE_CLEARANCE + laneOffset
        : sourceBounds.top - DIRECT_EDGE_NODE_CLEARANCE - laneOffset;
    const targetLaneX = targetWantsLeft
      ? Math.min(end.x, targetBounds.left - DIRECT_EDGE_NODE_CLEARANCE - laneOffset)
      : Math.max(end.x, targetBounds.right + DIRECT_EDGE_NODE_CLEARANCE + laneOffset);
    return [
      { x: start.x, y: sourceLaneY },
      { x: targetLaneX, y: sourceLaneY },
      { x: targetLaneX, y: end.y },
    ];
  }

  const routeOutsideRight =
    (sourceWantsRight && !targetWantsLeft) || (!sourceSide && goesRight) || sourceSide === "right";
  const routeX = routeOutsideRight
    ? Math.max(start.x, end.x, sourceBounds?.right ?? -Infinity, targetBounds?.right ?? -Infinity) +
      DIRECT_EDGE_NODE_CLEARANCE +
      laneOffset
    : Math.min(start.x, end.x, sourceBounds?.left ?? Infinity, targetBounds?.left ?? Infinity) -
      DIRECT_EDGE_NODE_CLEARANCE -
      laneOffset;

  if (
    sourceWantsRight &&
    targetWantsLeft &&
    Math.abs(end.x - start.x) > DIRECT_EDGE_NODE_CLEARANCE * 3
  ) {
    const midX = (start.x + end.x) / 2;
    return [
      { x: midX, y: start.y },
      { x: midX, y: end.y },
    ];
  }

  return [
    { x: routeX, y: start.y },
    { x: routeX, y: end.y },
  ];
}

function getVerticalLaneDirectPoints(
  start: { x: number; y: number },
  end: { x: number; y: number },
  sourceSide: string,
  targetSide: string,
  sourceBounds?: { left: number; right: number; top: number; bottom: number },
  targetBounds?: { left: number; right: number; top: number; bottom: number },
  laneOffset = 0,
) {
  const routeBelow = sourceSide === "bottom" || (targetSide !== "bottom" && end.y >= start.y);
  const routeY = routeBelow
    ? Math.max(
        start.y,
        end.y,
        sourceBounds?.bottom ?? -Infinity,
        targetBounds?.bottom ?? -Infinity,
      ) +
      DIRECT_EDGE_NODE_CLEARANCE +
      laneOffset
    : Math.min(start.y, end.y, sourceBounds?.top ?? Infinity, targetBounds?.top ?? Infinity) -
      DIRECT_EDGE_NODE_CLEARANCE -
      laneOffset;

  return [
    { x: start.x, y: routeY },
    { x: end.x, y: routeY },
  ];
}

function getSelfNodeEdgePoints(
  start: { x: number; y: number },
  end: { x: number; y: number },
  sourceSide: string,
  targetSide: string,
  bounds: { left: number; right: number; top: number; bottom: number },
  laneOffset = 0,
) {
  if (isHorizontalSide(sourceSide) || isHorizontalSide(targetSide)) {
    const useLeftLane =
      targetSide === "left" ||
      (sourceSide !== "right" && Math.abs(end.x - bounds.left) < Math.abs(end.x - bounds.right));
    const routeX = useLeftLane
      ? bounds.left - DIRECT_EDGE_NODE_CLEARANCE - laneOffset
      : bounds.right + DIRECT_EDGE_NODE_CLEARANCE + laneOffset;
    const routeAbove = end.y < start.y;
    const routeY = routeAbove
      ? bounds.top - DIRECT_EDGE_NODE_CLEARANCE - laneOffset
      : bounds.bottom + DIRECT_EDGE_NODE_CLEARANCE + laneOffset;

    return [
      { x: start.x, y: routeY },
      { x: routeX, y: routeY },
      { x: routeX, y: end.y },
    ];
  }

  const routeBelow = targetSide === "bottom" || end.y >= start.y;
  const routeY = routeBelow
    ? bounds.bottom + DIRECT_EDGE_NODE_CLEARANCE + laneOffset
    : bounds.top - DIRECT_EDGE_NODE_CLEARANCE - laneOffset;

  return [
    { x: start.x, y: routeY },
    { x: end.x, y: routeY },
  ];
}

function isHorizontalSide(side: string) {
  return side === "left" || side === "right";
}

function isVerticalSide(side: string) {
  return side === "top" || side === "bottom";
}

function getEdgeLaneOffset(edgeId: string) {
  return getEdgeHash(edgeId, EDGE_LANE_BUCKETS) * EDGE_LANE_SPACING;
}

function getEdgeHash(edgeId: string, buckets: number) {
  let hash = 0;
  for (let index = 0; index < edgeId.length; index += 1) {
    hash = (hash * 31 + edgeId.charCodeAt(index)) | 0;
  }

  return Math.abs(hash % buckets);
}

function boundsOverlapVertically(
  left: { top: number; bottom: number },
  right: { top: number; bottom: number },
) {
  return left.bottom >= right.top && right.bottom >= left.top;
}

function getBundledEdgePath({
  edgeId,
  sourceNodeId,
  sourceHandleIds,
  sourcePosition,
  estimatedSource,
  targetNodeId,
  targetX,
  targetY,
  targetPosition,
  usePreciseRouting = true,
}: {
  edgeId: string;
  sourceNodeId: string;
  sourceHandleIds: string[];
  sourcePosition: Position;
  estimatedSource: { x: number; y: number };
  targetNodeId?: string;
  targetX: number;
  targetY: number;
  targetPosition: Position;
  usePreciseRouting?: boolean;
}) {
  if (!usePreciseRouting) {
    return getDirectEdgePath({
      sourceNodeId,
      sourceX: estimatedSource.x,
      sourceY: estimatedSource.y,
      sourcePosition,
      targetNodeId,
      targetX,
      targetY,
      targetPosition,
      laneOffset: getEdgeLaneOffset(edgeId),
      useSmartRouting: false,
    });
  }

  const sourcePoints = sourceHandleIds
    .map((handleId) =>
      getMeasuredSlotEndpoint({
        nodeId: sourceNodeId,
        handleId,
        edgeSide: String(sourcePosition),
      }),
    )
    .filter((point): point is { x: number; y: number } => Boolean(point))
    .sort((left, right) => left.y - right.y || left.x - right.x);

  if (sourcePoints.length < 2) {
    return getDirectEdgePath({
      sourceNodeId,
      sourceX: estimatedSource.x,
      sourceY: estimatedSource.y,
      sourcePosition,
      targetNodeId,
      targetX,
      targetY,
      targetPosition,
      laneOffset: getEdgeLaneOffset(edgeId),
    });
  }

  const isLeft = String(sourcePosition) === "left";
  const sourceBounds = getMeasuredNodeBounds(sourceNodeId);
  const busX = isLeft
    ? (sourceBounds?.left ?? Math.min(...sourcePoints.map((point) => point.x))) -
      EDGE_BUNDLE_CLEARANCE
    : (sourceBounds?.right ?? Math.max(...sourcePoints.map((point) => point.x))) +
      EDGE_BUNDLE_CLEARANCE;
  const minY = Math.min(...sourcePoints.map((point) => point.y));
  const maxY = Math.max(...sourcePoints.map((point) => point.y));
  const trunkY = sourcePoints[Math.floor(sourcePoints.length / 2)].y;
  const trunkPoints = getSimpleOrthogonalEdgePoints({
    sourceX: busX,
    sourceY: trunkY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const path = [
    ...sourcePoints.map((point) => `M ${point.x},${point.y} L ${busX},${point.y}`),
    `M ${busX},${minY} L ${busX},${maxY}`,
    pointsToSvgPath(trunkPoints),
  ].join(" ");
  const labelPoint = getPointAtPolylineRatio(trunkPoints, 0.55) ?? {
    x: (busX + targetX) / 2,
    y: (trunkY + targetY) / 2,
  };

  return {
    path,
    labelX: labelPoint.x,
    labelY: labelPoint.y,
    points: trunkPoints,
  };
}

function getBundledMemberEdgePath({
  edgeId,
  sourceNodeId,
  sourceHandleId,
  sourcePosition,
  estimatedSource,
  targetNodeId,
  targetX,
  targetY,
  targetPosition,
  bundleSourceHandleIds,
  usePreciseRouting = true,
}: {
  edgeId: string;
  sourceNodeId: string;
  sourceHandleId?: string;
  sourcePosition: Position;
  estimatedSource: { x: number; y: number };
  targetNodeId?: string;
  targetX: number;
  targetY: number;
  targetPosition: Position;
  bundleSourceHandleIds: string[];
  usePreciseRouting?: boolean;
}) {
  if (!usePreciseRouting) {
    return getDirectEdgePath({
      sourceNodeId,
      sourceX: estimatedSource.x,
      sourceY: estimatedSource.y,
      sourcePosition,
      targetNodeId,
      targetX,
      targetY,
      targetPosition,
      laneOffset: getEdgeLaneOffset(edgeId),
      useSmartRouting: false,
    });
  }

  const allSourcePoints = bundleSourceHandleIds
    .map((handleId) =>
      getMeasuredSlotEndpoint({
        nodeId: sourceNodeId,
        handleId,
        edgeSide: String(sourcePosition),
      }),
    )
    .filter((point): point is { x: number; y: number } => Boolean(point));
  const ownSourcePoint = sourceHandleId
    ? getMeasuredSlotEndpoint({
        nodeId: sourceNodeId,
        handleId: sourceHandleId,
        edgeSide: String(sourcePosition),
      })
    : undefined;

  if (allSourcePoints.length < 2 || !ownSourcePoint) {
    return getDirectEdgePath({
      sourceNodeId,
      sourceX: estimatedSource.x,
      sourceY: estimatedSource.y,
      sourcePosition,
      targetNodeId,
      targetX,
      targetY,
      targetPosition,
      laneOffset: getEdgeLaneOffset(edgeId),
    });
  }

  const isLeft = String(sourcePosition) === "left";
  const sourceBounds = getMeasuredNodeBounds(sourceNodeId);
  const busX = isLeft
    ? (sourceBounds?.left ?? Math.min(...allSourcePoints.map((point) => point.x))) -
      EDGE_BUNDLE_CLEARANCE
    : (sourceBounds?.right ?? Math.max(...allSourcePoints.map((point) => point.x))) +
      EDGE_BUNDLE_CLEARANCE;
  const points = getSimpleOrthogonalEdgePoints({
    sourceX: busX,
    sourceY: ownSourcePoint.y,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const labelPoint = getPointAtPolylineRatio(points, 0.55) ?? {
    x: (busX + targetX) / 2,
    y: (ownSourcePoint.y + targetY) / 2,
  };
  const path = pointsToSvgPath(points);
  const [estimatedPath, estimatedLabelX, estimatedLabelY] = getSmoothStepPath({
    sourceX: busX,
    sourceY: ownSourcePoint.y,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return {
    path: path || estimatedPath,
    labelX: path ? labelPoint.x : estimatedLabelX,
    labelY: path ? labelPoint.y : estimatedLabelY,
    points,
  };
}

function getTopLaneEdgePoints({
  sourceNodeId,
  sourceX,
  sourceY,
  targetNodeId,
  targetX,
  targetY,
}: {
  sourceNodeId?: string;
  sourceX: number;
  sourceY: number;
  targetNodeId?: string;
  targetX: number;
  targetY: number;
}) {
  if (!sourceNodeId || !targetNodeId) {
    return undefined;
  }

  const sourceBounds = getMeasuredNodeBounds(sourceNodeId);
  const targetBounds = getMeasuredNodeBounds(targetNodeId);
  if (!sourceBounds || !targetBounds) {
    return undefined;
  }

  const goesRight = targetX >= sourceX;
  const horizontalGap = goesRight
    ? targetBounds.left - sourceBounds.right
    : sourceBounds.left - targetBounds.right;
  const sourcePointInsideNode = sourceY >= sourceBounds.top && sourceY <= sourceBounds.bottom;
  const targetPointInsideNode = targetY >= targetBounds.top && targetY <= targetBounds.bottom;
  const roughlySameRow = Math.abs(targetY - sourceY) <= 90;

  if (
    horizontalGap < 24 ||
    horizontalGap > 900 ||
    !sourcePointInsideNode ||
    !targetPointInsideNode
  ) {
    return undefined;
  }

  if (!roughlySameRow) {
    return undefined;
  }

  const laneY = Math.min(sourceBounds.top, targetBounds.top) - 10;
  const sourceExitX = sourceX + (goesRight ? 20 : -20);
  const targetApproachX = targetX + (goesRight ? -20 : 20);

  return compactPolylinePoints([
    { x: sourceX, y: sourceY },
    { x: sourceExitX, y: sourceY },
    { x: sourceExitX, y: laneY },
    { x: targetApproachX, y: laneY },
    { x: targetApproachX, y: targetY },
    { x: targetX, y: targetY },
  ]);
}

function compactPolylinePoints(points: Array<{ x: number; y: number } | undefined>) {
  const compacted: Array<{ x: number; y: number }> = [];
  for (const point of points) {
    if (!point) {
      continue;
    }

    const previous = compacted[compacted.length - 1];
    if (previous && Math.abs(previous.x - point.x) < 0.5 && Math.abs(previous.y - point.y) < 0.5) {
      continue;
    }

    compacted.push(point);
  }

  return compacted;
}

function pointsToSvgPath(points: Array<{ x: number; y: number }>) {
  const [first, ...rest] = points;
  if (!first) {
    return "";
  }

  return [`M ${first.x},${first.y}`, ...rest.map((point) => `L ${point.x},${point.y}`)].join(" ");
}

function getPointAtPolylineRatio(points: Array<{ x: number; y: number }>, ratio: number) {
  const segments = getPolylineSegments(points);
  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (totalLength <= 0) {
    return points[0];
  }

  let remaining = totalLength * clamp(ratio, 0, 1);
  for (const segment of segments) {
    if (remaining <= segment.length) {
      const t = segment.length <= 0 ? 0 : remaining / segment.length;
      return {
        x: segment.start.x + (segment.end.x - segment.start.x) * t,
        y: segment.start.y + (segment.end.y - segment.start.y) * t,
      };
    }

    remaining -= segment.length;
  }

  return points[points.length - 1];
}

function getClosestPointOnPolyline(
  point: { x: number; y: number },
  points: Array<{ x: number; y: number }>,
) {
  return getPolylineSegments(points)
    .map((segment) => getClosestPointOnSegment(point, segment.start, segment.end))
    .sort((left, right) => left.distanceSquared - right.distanceSquared)[0]?.point;
}

function getPolylineSegments(points: Array<{ x: number; y: number }>) {
  const segments: Array<{
    start: { x: number; y: number };
    end: { x: number; y: number };
    length: number;
  }> = [];

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length > 0.5) {
      segments.push({ start, end, length });
    }
  }

  return segments;
}

function dedupePolylineCandidates(candidates: Array<Array<{ x: number; y: number }>>) {
  const seen = new Set<string>();
  return candidates.filter((points) => {
    const key = points.map((point) => `${Math.round(point.x)}:${Math.round(point.y)}`).join("|");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return points.length >= 2;
  });
}

function countPolylineTurns(points: Array<{ x: number; y: number }>) {
  let turns = 0;
  for (let index = 2; index < points.length; index += 1) {
    const previous = points[index - 2];
    const current = points[index - 1];
    const next = points[index];
    const previousHorizontal = Math.abs(previous.y - current.y) < 0.5;
    const nextHorizontal = Math.abs(current.y - next.y) < 0.5;
    if (previousHorizontal !== nextHorizontal) {
      turns += 1;
    }
  }
  return turns;
}

/**
 * Measures every node on the board once per layout epoch.
 *
 * Each edge needs the same obstacle set minus its own two endpoints, so this
 * used to walk and measure the entire board once per edge â€” O(edges x nodes)
 * forced layouts every frame. The sweep is now shared and each edge only filters
 * it.
 *
 * Nodes are ordered by id rather than by DOM order so the obstacle list (and
 * therefore route scoring) does not depend on React's mount order.
 */
function getMeasuredAvoidanceSweep() {
  if (measuredAvoidanceSweep?.epoch === measuredLayoutEpoch) {
    return measuredAvoidanceSweep;
  }

  const bounds: Array<{ id: string; bounds: MeasuredBounds }> = [];
  if (typeof document !== "undefined") {
    for (const element of document.querySelectorAll<HTMLElement>(".react-flow__node")) {
      const id = element.dataset.id;
      if (!id) {
        continue;
      }

      const cacheKey = `${measuredLayoutEpoch}|${id}`;
      let measured = measuredNodeBoundsCache.get(cacheKey);
      if (!measuredNodeBoundsCache.has(cacheKey)) {
        measured = measureNodeElementBounds(element);
        measuredNodeBoundsCache.set(cacheKey, measured);
      }

      if (measured) {
        bounds.push({ id, bounds: measured });
      }
    }
  }

  bounds.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  // Snap and geometry-sort once, in the order `normalizeRouteBounds` would have
  // produced. Filtering an already-sorted list preserves that order, so each edge
  // no longer has to re-sort the whole board.
  const normalized = bounds
    .map((entry) => ({
      id: entry.id,
      bounds: {
        left: snapRouteCoord(entry.bounds.left),
        right: snapRouteCoord(entry.bounds.right),
        top: snapRouteCoord(entry.bounds.top),
        bottom: snapRouteCoord(entry.bounds.bottom),
      },
    }))
    .sort(
      (left, right) =>
        left.bounds.left - right.bounds.left ||
        left.bounds.top - right.bounds.top ||
        left.bounds.right - right.bounds.right,
    );

  measuredAvoidanceSweep = {
    epoch: measuredLayoutEpoch,
    bounds: normalized,
    hash: bounds
      .map(
        (entry) =>
          `${entry.id}:${snapRouteCoord(entry.bounds.left)},${snapRouteCoord(entry.bounds.top)},${snapRouteCoord(entry.bounds.right)},${snapRouteCoord(entry.bounds.bottom)}`,
      )
      .join(";"),
  };
  return measuredAvoidanceSweep;
}

function getMeasuredAvoidanceNodeBounds(excludedNodeIds: Array<string | undefined>) {
  const excluded = new Set(excludedNodeIds.filter((id): id is string => Boolean(id)));
  return getMeasuredAvoidanceSweep()
    .bounds.filter((entry) => !excluded.has(entry.id))
    .map((entry) => entry.bounds);
}

function expandBounds(
  bounds: { left: number; right: number; top: number; bottom: number },
  amount: number,
) {
  return {
    left: bounds.left - amount,
    right: bounds.right + amount,
    top: bounds.top - amount,
    bottom: bounds.bottom + amount,
  };
}

function getSegmentRectOverlapLength(
  start: { x: number; y: number },
  end: { x: number; y: number },
  bounds: { left: number; right: number; top: number; bottom: number },
) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  let entry = 0;
  let exit = 1;

  const clips = [
    { p: -deltaX, q: start.x - bounds.left },
    { p: deltaX, q: bounds.right - start.x },
    { p: -deltaY, q: start.y - bounds.top },
    { p: deltaY, q: bounds.bottom - start.y },
  ];

  for (const { p, q } of clips) {
    if (Math.abs(p) < 0.0001) {
      if (q < 0) {
        return 0;
      }
      continue;
    }

    const ratio = q / p;
    if (p < 0) {
      entry = Math.max(entry, ratio);
    } else {
      exit = Math.min(exit, ratio);
    }

    if (entry > exit) {
      return 0;
    }
  }

  return Math.hypot(deltaX, deltaY) * Math.max(0, exit - entry);
}

function pointInBounds(
  point: { x: number; y: number },
  bounds: { left: number; right: number; top: number; bottom: number },
) {
  return (
    point.x >= bounds.left &&
    point.x <= bounds.right &&
    point.y >= bounds.top &&
    point.y <= bounds.bottom
  );
}

function segmentsIntersect(
  firstStart: { x: number; y: number },
  firstEnd: { x: number; y: number },
  secondStart: { x: number; y: number },
  secondEnd: { x: number; y: number },
) {
  const d1 = direction(secondStart, secondEnd, firstStart);
  const d2 = direction(secondStart, secondEnd, firstEnd);
  const d3 = direction(firstStart, firstEnd, secondStart);
  const d4 = direction(firstStart, firstEnd, secondEnd);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  return (
    (Math.abs(d1) < 0.001 && pointOnSegment(firstStart, secondStart, secondEnd)) ||
    (Math.abs(d2) < 0.001 && pointOnSegment(firstEnd, secondStart, secondEnd)) ||
    (Math.abs(d3) < 0.001 && pointOnSegment(secondStart, firstStart, firstEnd)) ||
    (Math.abs(d4) < 0.001 && pointOnSegment(secondEnd, firstStart, firstEnd))
  );
}

function direction(
  start: { x: number; y: number },
  end: { x: number; y: number },
  point: { x: number; y: number },
) {
  return (point.x - start.x) * (end.y - start.y) - (point.y - start.y) * (end.x - start.x);
}

function pointOnSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  return (
    point.x >= Math.min(start.x, end.x) - 0.001 &&
    point.x <= Math.max(start.x, end.x) + 0.001 &&
    point.y >= Math.min(start.y, end.y) - 0.001 &&
    point.y <= Math.max(start.y, end.y) + 0.001
  );
}

function getClosestPointOnSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared <= 0
      ? 0
      : clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  const closest = {
    x: start.x + dx * t,
    y: start.y + dy * t,
  };
  const distanceX = point.x - closest.x;
  const distanceY = point.y - closest.y;

  return {
    point: closest,
    distanceSquared: distanceX * distanceX + distanceY * distanceY,
  };
}

function getSegmentDistance(
  firstStart: { x: number; y: number },
  firstEnd: { x: number; y: number },
  secondStart: { x: number; y: number },
  secondEnd: { x: number; y: number },
) {
  if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) {
    return 0;
  }

  return Math.sqrt(
    Math.min(
      getClosestPointOnSegment(firstStart, secondStart, secondEnd).distanceSquared,
      getClosestPointOnSegment(firstEnd, secondStart, secondEnd).distanceSquared,
      getClosestPointOnSegment(secondStart, firstStart, firstEnd).distanceSquared,
      getClosestPointOnSegment(secondEnd, firstStart, firstEnd).distanceSquared,
    ),
  );
}

function getCollinearOverlapLength(
  first: {
    start: { x: number; y: number };
    end: { x: number; y: number };
  },
  second: {
    start: { x: number; y: number };
    end: { x: number; y: number };
  },
) {
  const firstHorizontal = Math.abs(first.start.y - first.end.y) < 0.5;
  const secondHorizontal = Math.abs(second.start.y - second.end.y) < 0.5;
  const firstVertical = Math.abs(first.start.x - first.end.x) < 0.5;
  const secondVertical = Math.abs(second.start.x - second.end.x) < 0.5;

  if (firstHorizontal && secondHorizontal && Math.abs(first.start.y - second.start.y) < 0.5) {
    return getRangeOverlapLength(first.start.x, first.end.x, second.start.x, second.end.x);
  }

  if (firstVertical && secondVertical && Math.abs(first.start.x - second.start.x) < 0.5) {
    return getRangeOverlapLength(first.start.y, first.end.y, second.start.y, second.end.y);
  }

  return 0;
}

function getRangeOverlapLength(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
) {
  const firstMin = Math.min(firstStart, firstEnd);
  const firstMax = Math.max(firstStart, firstEnd);
  const secondMin = Math.min(secondStart, secondEnd);
  const secondMax = Math.max(secondStart, secondEnd);
  return Math.max(0, Math.min(firstMax, secondMax) - Math.max(firstMin, secondMin));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getSlotEdgeEndpointCandidates({
  nodeId,
  handleId,
  position,
  estimatedX,
  estimatedY,
  endpointOffset,
  isRecipeSlotEndpoint,
  isStorageSlotEndpoint,
  counterpartX,
  counterpartY,
  measureEndpoints = true,
}: {
  nodeId: string;
  handleId?: string | null;
  position: unknown;
  estimatedX: number;
  estimatedY: number;
  endpointOffset?: number;
  isRecipeSlotEndpoint?: boolean;
  isStorageSlotEndpoint?: boolean;
  counterpartX?: number;
  counterpartY?: number;
  measureEndpoints?: boolean;
}) {
  const estimatedSide = positionToEdgeSide(position);
  if (!isRecipeSlotEndpoint && !isStorageSlotEndpoint) {
    return [{ x: estimatedX, y: estimatedY, side: estimatedSide }];
  }

  const handle = parseResourceHandleId(handleId);
  const logicalRecipeSide = handle?.side === "input" ? Position.Left : Position.Right;
  const preferredSide =
    measureEndpoints &&
    isRecipeSlotEndpoint &&
    counterpartX !== undefined &&
    counterpartY !== undefined
      ? getRecipeSlotEdgeSideTowardPoint({
          nodeId,
          handleId,
          estimatedX,
          estimatedY,
          counterpartX,
          counterpartY,
          logicalSide: logicalRecipeSide,
        })
      : measureEndpoints &&
          isStorageSlotEndpoint &&
          counterpartX !== undefined &&
          counterpartY !== undefined
        ? getSlotEdgeSideTowardPoint({
            nodeId,
            handleId,
            estimatedX,
            estimatedY,
            counterpartX,
            counterpartY,
            estimatedSide,
          })
        : estimatedSide;
  const sides = dedupeEdgeSides([
    preferredSide,
    isRecipeSlotEndpoint ? logicalRecipeSide : estimatedSide,
    estimatedSide,
    Position.Bottom,
    Position.Top,
    Position.Left,
    Position.Right,
  ]);

  return sides.map((edgeSide) =>
    getSlotEdgeEndpointForSide({
      nodeId,
      handleId,
      edgeSide,
      estimatedX,
      estimatedY,
      endpointOffset,
      isStorageSlotEndpoint,
      measureEndpoint: measureEndpoints,
    }),
  );
}

function getSlotEdgeEndpointForSide({
  nodeId,
  handleId,
  edgeSide,
  estimatedX,
  estimatedY,
  endpointOffset,
  isStorageSlotEndpoint,
  measureEndpoint = true,
}: {
  nodeId: string;
  handleId?: string | null;
  edgeSide: Position;
  estimatedX: number;
  estimatedY: number;
  endpointOffset?: number;
  isStorageSlotEndpoint?: boolean;
  measureEndpoint?: boolean;
}): SlotEdgeEndpoint {
  const measuredEndpoint = measureEndpoint
    ? getMeasuredSlotEndpoint({
        nodeId,
        handleId,
        edgeSide,
        endpointOffset,
      })
    : undefined;
  if (measuredEndpoint) {
    return { ...measuredEndpoint, side: edgeSide };
  }

  const offset = isStorageSlotEndpoint ? STORAGE_SLOT_EDGE_OFFSET : RECIPE_SLOT_EDGE_OFFSET;
  const endpointLaneOffset = endpointOffset ?? 0;

  switch (edgeSide) {
    case Position.Right:
      return {
        x: estimatedX + (isStorageSlotEndpoint ? -offset : offset),
        y: estimatedY + endpointLaneOffset,
        side: edgeSide,
      };
    case Position.Left:
      return {
        x: estimatedX + (isStorageSlotEndpoint ? offset : -offset),
        y: estimatedY + endpointLaneOffset,
        side: edgeSide,
      };
    case Position.Top:
      return { x: estimatedX + endpointLaneOffset, y: estimatedY - offset, side: edgeSide };
    case Position.Bottom:
      return { x: estimatedX + endpointLaneOffset, y: estimatedY + offset, side: edgeSide };
    default:
      return { x: estimatedX, y: estimatedY, side: edgeSide };
  }
}

function dedupeEdgeSides(sides: Position[]) {
  const seen = new Set<string>();
  return sides.filter((side) => {
    const key = String(side);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function positionToEdgeSide(position: unknown): Position {
  switch (String(position)) {
    case "right":
      return Position.Right;
    case "left":
      return Position.Left;
    case "top":
      return Position.Top;
    case "bottom":
      return Position.Bottom;
    default:
      return Position.Right;
  }
}

function getSlotEdgeSideTowardPoint({
  nodeId,
  handleId,
  estimatedX,
  estimatedY,
  counterpartX,
  counterpartY,
  estimatedSide,
}: {
  nodeId: string;
  handleId?: string | null;
  estimatedX: number;
  estimatedY: number;
  counterpartX: number;
  counterpartY: number;
  estimatedSide: Position;
}) {
  const center = getMeasuredSlotCenter({ nodeId, handleId }) ?? { x: estimatedX, y: estimatedY };
  const distanceX = counterpartX - center.x;
  const distanceY = counterpartY - center.y;
  const horizontalSide = distanceX >= 0 ? Position.Right : Position.Left;
  const verticalSide = distanceY >= 0 ? Position.Bottom : Position.Top;

  if (Math.abs(distanceX) >= 36 && Math.abs(distanceX) > Math.abs(distanceY) * 1.15) {
    return horizontalSide;
  }

  if (Math.abs(distanceY) >= 24) {
    return verticalSide;
  }

  if (Math.abs(distanceY) > Math.abs(distanceX) * 0.45) {
    return verticalSide;
  }

  if (Math.abs(distanceX) > 1) {
    return horizontalSide;
  }

  return estimatedSide;
}

function getRecipeSlotEdgeSideTowardPoint({
  nodeId,
  handleId,
  estimatedX,
  estimatedY,
  counterpartX,
  counterpartY,
  logicalSide,
}: {
  nodeId: string;
  handleId?: string | null;
  estimatedX: number;
  estimatedY: number;
  counterpartX: number;
  counterpartY: number;
  logicalSide: Position;
}) {
  const center = getMeasuredSlotCenter({ nodeId, handleId }) ?? { x: estimatedX, y: estimatedY };
  const distanceX = counterpartX - center.x;
  const distanceY = counterpartY - center.y;
  const horizontalSide = distanceX >= 0 ? Position.Right : Position.Left;
  const verticalSide = distanceY >= 0 ? Position.Bottom : Position.Top;
  const isNaturallyHorizontal = horizontalSide === logicalSide && Math.abs(distanceX) >= 48;

  if (Math.abs(distanceY) >= 64 && Math.abs(distanceY) > Math.abs(distanceX) * 0.35) {
    return verticalSide;
  }

  if (Math.abs(distanceY) >= 24 && (!isNaturallyHorizontal || verticalSide === Position.Bottom)) {
    return verticalSide;
  }

  if (
    Math.abs(distanceY) > Math.abs(distanceX) * 0.45 &&
    (!isNaturallyHorizontal || verticalSide === Position.Bottom)
  ) {
    return verticalSide;
  }

  if (horizontalSide === logicalSide) {
    return logicalSide;
  }

  return verticalSide;
}

function getMeasuredSlotEndpoint({
  nodeId,
  handleId,
  edgeSide,
  endpointOffset = 0,
}: {
  nodeId: string;
  handleId?: string | null;
  edgeSide: string;
  endpointOffset?: number;
}) {
  if (!handleId || typeof document === "undefined") {
    return undefined;
  }
  const cacheKey = [measuredLayoutEpoch, "endpoint", nodeId, handleId, edgeSide, endpointOffset].join(
    "|",
  );
  if (measuredSlotEndpointCache.has(cacheKey)) {
    return measuredSlotEndpointCache.get(cacheKey);
  }

  const slotElement =
    findResourceEndpointElement("[data-resource-edge-anchor='true']", nodeId, handleId) ??
    findResourceEndpointElement("[data-resource-handle='true']", nodeId, handleId);
  const nodeElement =
    slotElement?.closest<HTMLElement>(".react-flow__node") ??
    document.querySelector<HTMLElement>(`.react-flow__node[data-id="${cssEscape(nodeId)}"]`);

  if (!nodeElement || !slotElement) {
    measuredSlotEndpointCache.set(cacheKey, undefined);
    return undefined;
  }

  const slotRect = slotElement.getBoundingClientRect();
  const screenPoint = getSlotRectEdgePoint(slotRect, edgeSide);
  const flowPoint = screenToFlowPoint(screenPoint, nodeElement);

  if (!flowPoint) {
    measuredSlotEndpointCache.set(cacheKey, undefined);
    return undefined;
  }

  const measuredEndpoint = offsetFlowPointForEdgeSide(flowPoint, edgeSide, endpointOffset);
  measuredSlotEndpointCache.set(cacheKey, measuredEndpoint);
  return measuredEndpoint;
}

function getMeasuredSlotCenter({ nodeId, handleId }: { nodeId: string; handleId?: string | null }) {
  if (!handleId || typeof document === "undefined") {
    return undefined;
  }
  const cacheKey = [measuredLayoutEpoch, "center", nodeId, handleId].join("|");
  if (measuredSlotCenterCache.has(cacheKey)) {
    return measuredSlotCenterCache.get(cacheKey);
  }

  const slotElement =
    findResourceEndpointElement("[data-resource-edge-anchor='true']", nodeId, handleId) ??
    findResourceEndpointElement("[data-resource-handle='true']", nodeId, handleId);
  const nodeElement =
    slotElement?.closest<HTMLElement>(".react-flow__node") ??
    document.querySelector<HTMLElement>(`.react-flow__node[data-id="${cssEscape(nodeId)}"]`);

  if (!nodeElement || !slotElement) {
    measuredSlotCenterCache.set(cacheKey, undefined);
    return undefined;
  }

  const slotRect = slotElement.getBoundingClientRect();
  const measuredCenter = screenToFlowPoint(
    { x: slotRect.left + slotRect.width / 2, y: slotRect.top + slotRect.height / 2 },
    nodeElement,
  );
  measuredSlotCenterCache.set(cacheKey, measuredCenter);
  return measuredCenter;
}

function getSlotRectEdgePoint(rect: DOMRect, edgeSide: string) {
  switch (edgeSide) {
    case "right":
      return { x: rect.right, y: rect.top + rect.height / 2 };
    case "top":
      return { x: rect.left + rect.width / 2, y: rect.top };
    case "bottom":
      return { x: rect.left + rect.width / 2, y: rect.bottom };
    case "left":
    default:
      return { x: rect.left, y: rect.top + rect.height / 2 };
  }
}

function offsetFlowPointForEdgeSide(
  point: { x: number; y: number },
  edgeSide: string,
  endpointOffset = 0,
) {
  switch (edgeSide) {
    case "top":
    case "bottom":
      return { x: point.x + endpointOffset, y: point.y };
    case "right":
    case "left":
    default:
      return { x: point.x, y: point.y + endpointOffset };
  }
}

function getMeasuredNodeBounds(nodeId: string) {
  if (typeof document === "undefined") {
    return undefined;
  }

  const cacheKey = `${measuredLayoutEpoch}|${nodeId}`;
  if (measuredNodeBoundsCache.has(cacheKey)) {
    return measuredNodeBoundsCache.get(cacheKey);
  }

  const nodeElement = document.querySelector<HTMLElement>(
    `.react-flow__node[data-id="${cssEscape(nodeId)}"]`,
  );
  if (!nodeElement) {
    measuredNodeBoundsCache.set(cacheKey, undefined);
    return undefined;
  }

  const bounds = measureNodeElementBounds(nodeElement);
  measuredNodeBoundsCache.set(cacheKey, bounds);
  return bounds;
}

function measureNodeElementBounds(nodeElement: HTMLElement) {
  const rect = nodeElement.getBoundingClientRect();
  const topLeft = screenToFlowPoint({ x: rect.left, y: rect.top }, nodeElement);
  const bottomRight = screenToFlowPoint({ x: rect.right, y: rect.bottom }, nodeElement);
  if (!topLeft || !bottomRight) {
    return undefined;
  }

  return {
    left: Math.min(topLeft.x, bottomRight.x),
    right: Math.max(topLeft.x, bottomRight.x),
    top: Math.min(topLeft.y, bottomRight.y),
    bottom: Math.max(topLeft.y, bottomRight.y),
  };
}

function screenToFlowPoint(point: { x: number; y: number }, element: HTMLElement) {
  const transform = getViewportTransform(element);
  if (!transform) {
    return undefined;
  }

  return {
    x: (point.x - transform.rendererLeft - transform.translateX) / transform.scaleX,
    y: (point.y - transform.rendererTop - transform.translateY) / transform.scaleY,
  };
}

/**
 * Reads the live viewport transform at most once per frame.
 *
 * `getComputedStyle(...).transform` forces a style recalculation, and this used
 * to run twice per node per edge â€” so a board with 40 nodes and 80 edges paid
 * over six thousand forced recalcs in a single frame.
 */
function getViewportTransform(element: HTMLElement) {
  if (viewportTransformCache) {
    return viewportTransformCache;
  }

  const root = element.closest<HTMLElement>(".react-flow");
  const viewport =
    element.closest<HTMLElement>(".react-flow__viewport") ??
    root?.querySelector<HTMLElement>(".react-flow__viewport");
  const renderer =
    element.closest<HTMLElement>(".react-flow__renderer") ??
    root?.querySelector<HTMLElement>(".react-flow__renderer");
  if (!viewport || !renderer) {
    return undefined;
  }

  const rendererRect = renderer.getBoundingClientRect();
  const matrix = parseCssMatrix(getComputedStyle(viewport).transform);
  viewportTransformCache = {
    rendererLeft: rendererRect.left,
    rendererTop: rendererRect.top,
    translateX: matrix.translateX,
    translateY: matrix.translateY,
    scaleX: matrix.scaleX,
    scaleY: matrix.scaleY,
  };
  scheduleViewportTransformClear();
  return viewportTransformCache;
}

function parseCssMatrix(transform: string) {
  if (!transform || transform === "none") {
    return { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 };
  }

  const values = transform
    .match(/matrix(?:3d)?\(([^)]+)\)/)?.[1]
    ?.split(",")
    .map((value) => Number.parseFloat(value.trim()));

  if (!values || values.some((value) => !Number.isFinite(value))) {
    return { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 };
  }

  if (values.length === 16) {
    return {
      scaleX: values[0] || 1,
      scaleY: values[5] || values[0] || 1,
      translateX: values[12] ?? 0,
      translateY: values[13] ?? 0,
    };
  }

  return {
    scaleX: values[0] || 1,
    scaleY: values[3] || values[0] || 1,
    translateX: values[4] ?? 0,
    translateY: values[5] ?? 0,
  };
}

function findResourceEndpointElement(selector: string, nodeId: string, handleId: string) {
  return document.querySelector<HTMLElement>(
    `${selector}[data-resource-node-id="${cssEscape(nodeId)}"][data-resource-handle-id="${cssEscape(
      handleId,
    )}"]`,
  );
}

function scheduleViewportTransformClear() {
  if (viewportTransformClearScheduled || typeof window === "undefined") {
    viewportTransformCache = undefined;
    return;
  }

  viewportTransformClearScheduled = true;
  window.requestAnimationFrame(() => {
    viewportTransformCache = undefined;
    viewportTransformClearScheduled = false;
  });
}

function cssEscape(value: string) {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
}

function trimEdgeNumber(value: number) {
  return formatEdgeValue(value);
}

function isPointerOverIncompatibleFlowHandle(
  project: FactoryProject,
  event: MouseEvent | TouchEvent,
  draggedResource: DraggedResourceConnection,
) {
  const position = getClientPosition(event);
  if (!position || typeof document === "undefined") {
    return false;
  }

  return document.elementsFromPoint(position.x, position.y).some((element) => {
    const handleElement = element.closest<HTMLElement>(".react-flow__handle");
    if (!handleElement) {
      return false;
    }

    const resourceHandle = readResourceHandleElement(handleElement);
    if (!resourceHandle) {
      return true;
    }

    return !isCompatibleDraggedResourceTarget(project, draggedResource, resourceHandle);
  });
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function getResourceHandleAtPointer(event: MouseEvent | TouchEvent) {
  const position = getClientPosition(event);
  return getResourceHandleAtPosition(position, event);
}

function getResourceHandleAtPosition(
  position: { x: number; y: number } | undefined,
  estimatedEvent?: MouseEvent | TouchEvent,
) {
  if (!position || typeof document === "undefined") {
    return undefined;
  }

  const geometricMatch = findResourceHandleByGeometry(position);
  if (geometricMatch) {
    return geometricMatch;
  }

  if (estimatedEvent) {
    for (const element of document.elementsFromPoint(position.x, position.y)) {
      const match = readResourceHandleElement(
        element.closest<HTMLElement>("[data-resource-handle='true']"),
      );
      if (match) {
        return match;
      }
    }
  }

  return undefined;
}

function findResourceHandleByGeometry(position: { x: number; y: number }) {
  if (typeof document === "undefined") {
    return undefined;
  }

  const matches = [...document.querySelectorAll<HTMLElement>("[data-resource-handle='true']")]
    .map((element) => {
      const rect = element.getBoundingClientRect();
      if (
        position.x < rect.left ||
        position.x > rect.right ||
        position.y < rect.top ||
        position.y > rect.bottom
      ) {
        return undefined;
      }

      const handle = readResourceHandleElement(element);
      if (!handle) {
        return undefined;
      }

      return {
        handle,
        area: rect.width * rect.height,
      };
    })
    .filter(
      (
        match,
      ): match is { handle: ReturnType<typeof readResourceHandleElement> & {}; area: number } =>
        Boolean(match),
    )
    .sort((left, right) => left.area - right.area);

  return matches[0]?.handle;
}

function readResourceHandleElement(element: HTMLElement | null) {
  const nodeId = element?.dataset.resourceNodeId;
  const handleId = element?.dataset.resourceHandleId;
  const handle = parseResourceHandleId(handleId);

  if (nodeId && handleId && handle) {
    return {
      nodeId,
      handleId,
      side: handle.side,
      kind: handle.kind,
      resourceId: handle.resourceId,
    } satisfies ResolvedResourceHandle;
  }

  return undefined;
}

function isCompatibleDraggedResourceTarget(
  project: FactoryProject,
  draggedResource: DraggedResourceConnection,
  targetHandle: ResolvedResourceHandle,
) {
  const targetResource = getResourceForHandle(project, targetHandle.nodeId, targetHandle.handleId);

  if (!targetResource) {
    return false;
  }

  return (
    draggedResource.nodeId !== targetHandle.nodeId &&
    draggedResource.side !== targetHandle.side &&
    (targetHandle.side === "input"
      ? resourceMatchesInput(draggedResource, targetResource)
      : resourceMatchesInput(targetResource, draggedResource))
  );
}

function getStorageHandleAtPointer(
  event: MouseEvent | TouchEvent,
  draggedResource: DraggedResourceConnection | undefined,
) {
  const position = getClientPosition(event);
  return getStorageHandleAtPosition(position, draggedResource, event);
}

function getStorageHandleAtPosition(
  position: { x: number; y: number } | undefined,
  draggedResource: DraggedResourceConnection | undefined,
  estimatedEvent?: MouseEvent | TouchEvent,
) {
  if (!position || !draggedResource || typeof document === "undefined") {
    return undefined;
  }

  const storageElements = [
    ...document.querySelectorAll<HTMLElement>("[data-storage-node-id]"),
    ...(estimatedEvent
      ? document
          .elementsFromPoint(position.x, position.y)
          .map((element) => element.closest<HTMLElement>("[data-storage-node-id]"))
          .filter((element): element is HTMLElement => Boolean(element))
      : []),
  ];

  for (const storageElement of storageElements) {
    const rect = storageElement.getBoundingClientRect();
    if (
      position.x < rect.left ||
      position.x > rect.right ||
      position.y < rect.top ||
      position.y > rect.bottom
    ) {
      continue;
    }

    const nodeId = storageElement?.dataset.storageNodeId;
    const kind = storageElement?.dataset.storageKind;
    const resourceId = storageElement?.dataset.storageResourceId;

    if (
      nodeId &&
      resourceId &&
      nodeId !== draggedResource.nodeId &&
      (kind === "item" || kind === "fluid") &&
      (draggedResource.side === "input"
        ? resourceMatchesInput({ kind, id: resourceId }, draggedResource)
        : resourceMatchesInput(draggedResource, { kind, id: resourceId }))
    ) {
      const side = draggedResource.side === "output" ? "input" : "output";
      return {
        nodeId,
        handleId: `${side}:${kind}:${encodeURIComponent(resourceId)}`,
        side,
        kind,
        resourceId,
      } satisfies ResolvedResourceHandle;
    }
  }

  return undefined;
}

function getInitialResourceColor(resource: ResourceEdgeData["resource"]) {
  return (
    resource.dominantColor ??
    resource.iconAtlas?.dominantColor ??
    (resource.kind === "fluid" ? DEFAULT_FLUID_EDGE_COLOR : DEFAULT_ITEM_EDGE_COLOR)
  );
}

function getArrowHeadPoints(targetX: number, targetY: number, targetPosition: unknown) {
  const length = 8;
  const width = 5;

  switch (String(targetPosition)) {
    case "right":
      return `${targetX + length},${targetY - width} ${targetX},${targetY} ${targetX + length},${targetY + width}`;
    case "top":
      return `${targetX - width},${targetY - length} ${targetX},${targetY} ${targetX + width},${targetY - length}`;
    case "bottom":
      return `${targetX - width},${targetY + length} ${targetX},${targetY} ${targetX + width},${targetY + length}`;
    case "left":
    default:
      return `${targetX - length},${targetY - width} ${targetX},${targetY} ${targetX - length},${targetY + width}`;
  }
}

function getArrowHeadPointsForRoute({
  points,
  estimatedTargetX,
  estimatedTargetY,
  estimatedTargetPosition,
}: {
  points: Array<{ x: number; y: number }>;
  estimatedTargetX: number;
  estimatedTargetY: number;
  estimatedTargetPosition: unknown;
}) {
  const routeTarget = points[points.length - 1];
  const routePrevious = points[points.length - 2];
  if (!routeTarget || !routePrevious) {
    return getArrowHeadPoints(estimatedTargetX, estimatedTargetY, estimatedTargetPosition);
  }

  const distanceX = routeTarget.x - routePrevious.x;
  const distanceY = routeTarget.y - routePrevious.y;
  const isVertical = Math.abs(distanceY) > Math.abs(distanceX);
  const targetPosition = isVertical
    ? distanceY >= 0
      ? Position.Top
      : Position.Bottom
    : distanceX >= 0
      ? Position.Left
      : Position.Right;

  return getArrowHeadPoints(routeTarget.x, routeTarget.y, targetPosition);
}

function isCompatibleResourceConnection(
  project: FactoryProject,
  connection: Connection | Edge,
): boolean {
  const stockpiles = project.stockpiles ?? [];
  const requests = project.requests ?? [];
  const sourceStockpile = stockpiles.find((entry) => entry.id === connection.source);
  const targetStockpile = stockpiles.find((entry) => entry.id === connection.target);
  const sourceRequest = requests.find((entry) => entry.id === connection.source);
  const targetRequest = requests.find((entry) => entry.id === connection.target);

  if (sourceStockpile || targetStockpile || sourceRequest || targetRequest) {
    // The smart arrow: any stockpile can reach any request; the planner decides
    // what actually flows.
    if ((sourceStockpile && targetRequest) || (sourceRequest && targetStockpile)) {
      return true;
    }

    if (sourceStockpile || targetStockpile) {
      const stockpile = (sourceStockpile ?? targetStockpile)!;
      const nodeId = sourceStockpile ? connection.target : connection.source;
      const handleId = sourceStockpile ? connection.targetHandle : connection.sourceHandle;
      const handle = parseResourceHandleId(handleId);
      if (!nodeId || !handleId || handle?.side !== "input") {
        return false;
      }

      const inputResource = getResourceForHandle(project, nodeId, handleId);
      return Boolean(
        inputResource &&
          isRecipeInputConsumed(inputResource) &&
          stockpile.resources.some((resource) => resourceMatchesInput(resource, inputResource)),
      );
    }

    const request = (sourceRequest ?? targetRequest)!;
    const nodeId = targetRequest ? connection.source : connection.target;
    const handleId = targetRequest ? connection.sourceHandle : connection.targetHandle;
    const handle = parseResourceHandleId(handleId);
    if (!nodeId || !handleId || handle?.side !== "output") {
      return false;
    }

    const outputResource = getResourceForHandle(project, nodeId, handleId);
    return Boolean(
      outputResource &&
        resourceMatchesInput(outputResource, { kind: request.kind, id: request.resourceId }),
    );
  }

  const sourceHandle = parseResourceHandleId(connection.sourceHandle);
  const targetHandle = parseResourceHandleId(connection.targetHandle);
  if (!sourceHandle || !targetHandle) {
    return false;
  }

  const sourceResource =
    connection.source && connection.sourceHandle
      ? getResourceForHandle(project, connection.source, connection.sourceHandle)
      : undefined;
  const targetResource =
    connection.target && connection.targetHandle
      ? getResourceForHandle(project, connection.target, connection.targetHandle)
      : undefined;

  if (!sourceResource || !targetResource) {
    return false;
  }

  const output = sourceHandle.side === "output" ? sourceResource : targetResource;
  const input = sourceHandle.side === "input" ? sourceResource : targetResource;

  return sourceHandle.side !== targetHandle.side && resourceMatchesInput(output, input);
}

function getDraggedResourceForHandle(
  project: FactoryProject,
  nodeId: string,
  handleId: string,
): DraggedResourceConnection | undefined {
  const handle = parseResourceHandleId(handleId);
  if (!handle) {
    return undefined;
  }

  const storage = (project.storages ?? []).find((entry) => entry.id === nodeId);
  if (storage) {
    return {
      nodeId,
      side: handle.side,
      handleId,
      kind: storage.kind,
      id: storage.resourceId,
      displayName: storage.displayName,
      iconPath: storage.iconPath,
      iconAtlas: storage.iconAtlas,
      dominantColor: storage.dominantColor ?? storage.iconAtlas?.dominantColor,
    };
  }

  const node = project.nodes.find((entry) => entry.id === nodeId);
  const recipe = project.recipes.find((entry) => entry.id === node?.recipeId);
  if (!node || !recipe) {
    return undefined;
  }

  const contextualRecipe = getNodeRecipeForHandles(recipe, node);
  const resources = handle.side === "input" ? contextualRecipe.inputs : contextualRecipe.outputs;
  const resource = resources.find(
    (entry) => entry.kind === handle.kind && entry.id === handle.resourceId,
  );
  if (!resource || (handle.side === "input" && !isRecipeInputConsumed(resource))) {
    return undefined;
  }

  return {
    nodeId,
    side: handle.side,
    handleId,
    kind: resource.kind,
    id: resource.id,
    displayName: resource.displayName,
    iconPath: resource.iconPath,
    iconAtlas: resource.iconAtlas,
    dominantColor: resource.dominantColor ?? resource.iconAtlas?.dominantColor,
    tooltip: resource.tooltip,
    alternatives: resource.alternatives,
  };
}

function getResourceForHandle(
  project: FactoryProject,
  nodeId: string,
  handleId: string,
): ResourceAmount | undefined {
  const handle = parseResourceHandleId(handleId);
  if (!handle) {
    return undefined;
  }

  const storage = (project.storages ?? []).find((entry) => entry.id === nodeId);
  if (storage) {
    return {
      kind: storage.kind,
      id: storage.resourceId,
      amount: 1,
      displayName: storage.displayName,
      iconPath: storage.iconPath,
      iconAtlas: storage.iconAtlas,
      dominantColor: storage.dominantColor ?? storage.iconAtlas?.dominantColor,
    };
  }

  const node = project.nodes.find((entry) => entry.id === nodeId);
  const recipe = project.recipes.find((entry) => entry.id === node?.recipeId);
  if (!node || !recipe) {
    return undefined;
  }

  const contextualRecipe = getNodeRecipeForHandles(recipe, node);
  const resources = handle.side === "input" ? contextualRecipe.inputs : contextualRecipe.outputs;

  return resources?.find((entry) => entry.kind === handle.kind && entry.id === handle.resourceId);
}

function getNodeRecipeForHandles(recipe: Recipe, node: FactoryProject["nodes"][number]): Recipe {
  const nodeRecipe = applyRecipeInputOverrides(recipe, node);
  const effectiveRecipe = applyMachineHandlerToRecipe(nodeRecipe, node);
  const overclockedStats = getOverclockedRecipeStats(nodeRecipe, node);
  const adjustedRecipe = applyMachineOutputMultipliers(
    effectiveRecipe,
    node,
    overclockedStats.tier,
  );
  return restoreCrossKindInputOverrideVisuals(
    {
      ...effectiveRecipe,
      ...adjustedRecipe,
    },
    recipe,
    node,
  );
}

function getClientPosition(event: MouseEvent | TouchEvent) {
  if ("changedTouches" in event && event.changedTouches.length > 0) {
    return {
      x: event.changedTouches[0].clientX,
      y: event.changedTouches[0].clientY,
    };
  }

  if ("clientX" in event) {
    return {
      x: event.clientX,
      y: event.clientY,
    };
  }

  return undefined;
}

function getExportImageSize(graphSize: number) {
  if (!Number.isFinite(graphSize) || graphSize <= 0) {
    return EXPORT_IMAGE_PADDING * 2;
  }

  return Math.ceil(graphSize + EXPORT_IMAGE_PADDING * 2);
}

function getExportPngPixelRatio(imageWidth: number, imageHeight: number) {
  const maxSide = Math.max(imageWidth, imageHeight);
  if (!Number.isFinite(maxSide) || maxSide <= 0) {
    return EXPORT_PNG_PIXEL_RATIO;
  }

  return Math.min(EXPORT_PNG_PIXEL_RATIO, EXPORT_PNG_MAX_PIXEL_SIDE / maxSide);
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function dispatchImageExportComplete(requestId: string) {
  window.dispatchEvent(
    new CustomEvent(FLOW_IMAGE_EXPORT_COMPLETE_EVENT, {
      detail: { requestId },
    }),
  );
}

function getEdgeResource(
  project: FactoryProject,
  edge: FactoryEdge,
): Pick<
  ResourceAmount,
  "kind" | "id" | "amount" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
> {
  const sourceNode = project.nodes.find((node) => node.id === edge.source);
  const sourceRecipe = project.recipes.find((recipe) => recipe.id === sourceNode?.recipeId);
  const sourceStorage = (project.storages ?? []).find((storage) => storage.id === edge.source);
  const targetStorage = (project.storages ?? []).find((storage) => storage.id === edge.target);
  const stockpileEntry = (project.stockpiles ?? [])
    .find((stockpile) => stockpile.id === edge.source)
    ?.resources.find(
      (resource) => resource.kind === edge.resourceKind && resource.id === edge.resourceId,
    );
  const targetRequest = (project.requests ?? []).find((request) => request.id === edge.target);
  const output = sourceRecipe?.outputs.find(
    (resource) => resource.kind === edge.resourceKind && resource.id === edge.resourceId,
  );
  const storage = sourceStorage ?? targetStorage;

  return {
    kind: edge.resourceKind,
    id: edge.resourceId,
    amount: 1,
    displayName:
      output?.displayName ??
      storage?.displayName ??
      stockpileEntry?.displayName ??
      targetRequest?.displayName ??
      edge.label,
    iconPath:
      output?.iconPath ?? storage?.iconPath ?? stockpileEntry?.iconPath ?? targetRequest?.iconPath,
    iconAtlas:
      output?.iconAtlas ??
      storage?.iconAtlas ??
      stockpileEntry?.iconAtlas ??
      targetRequest?.iconAtlas,
    dominantColor:
      output?.dominantColor ??
      storage?.dominantColor ??
      stockpileEntry?.dominantColor ??
      targetRequest?.dominantColor ??
      output?.iconAtlas?.dominantColor ??
      storage?.iconAtlas?.dominantColor,
  };
}

function edgeMatchesSearch(
  edge: FactoryEdge,
  resource: Pick<ResourceAmount, "id" | "displayName">,
  query: string,
) {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length < 2) {
    return false;
  }

  return `${resource.displayName ?? ""} ${resource.id} ${edge.resourceId}`
    .toLowerCase()
    .includes(normalizedQuery);
}

function recipeContainsResourceKey(recipe: Recipe | undefined, resourceKey: string) {
  if (!recipe) {
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

function exportNodeFilter(domNode: HTMLElement) {
  const element = domNode instanceof Element ? domNode : undefined;

  return !(
    element?.classList.contains("react-flow__edgeupdater") ||
    element?.classList.contains("react-flow__selection") ||
    element?.classList.contains("react-flow__nodesselection") ||
    element?.classList.contains("react-flow__handle")
  );
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

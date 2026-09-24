"use client";

import { useDropdownDismiss } from "@/lib/hooks/use-dropdown-dismiss";

import {
  Check,
  ChevronDown,
  ClipboardList,
  ClipboardPaste,
  Download,
  ImageDown,
  LoaderCircle,
  Redo2,
  Share2,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  cloneImportedProject,
  parseFactoryProjectJson,
  serializeFactoryProject,
} from "@/lib/import-export";
import { DEFAULT_DATASET_MANIFEST_URL } from "@/lib/datasets";
import { randomUUID } from "@/lib/random-id";
import {
  getRecipeDatasetRecipe,
  getRecipeDatasetRecipeIds,
  queryRecipeDatasetRecipes,
  resolveRecipeDatasetRecipes,
} from "@/lib/datasets/browser-loader";
import type { DatasetVersion } from "@/lib/datasets";
import type {
  FactoryEdge,
  FactoryProject,
  Recipe,
  ResourceKind,
} from "@/lib/model/types";
import { formatBoardDump } from "./flow/board-dump";
import {
  makeResourceHandleId,
  parseResourceHandleId,
  sectionHandleId,
  splitSectionHandleId,
} from "./flow/resource-handles";
import { sectionNodeView } from "@/lib/model/shared-machine";
import { isEditableKeyboardTarget } from "./flow/keyboard";
import {
  extractProjectJsonFromPng,
  extractProjectJsonFromSvg,
} from "@/lib/import-export/plan-image";
import { useWelcomeTab } from "@/lib/welcome/welcome-tab";
import { isPowerRecipe } from "@/lib/power/power-recipe";
import { pickRecipeRefMatch, recipeContentRef } from "@/lib/import-export/recipe-ref-match";
import { useFactoryStore } from "@/store/factory-store";
import { copyToClipboard } from "@/lib/clipboard";
import { PastePlanDialog } from "./export/PastePlanDialog";

interface BoardActionsProps {
  /**
   * `bar` is the top bar's row of icons. `list` is the compact menu: the same
   * actions as labelled rows, with the export dropdown flattened into its three
   * formats — a menu inside a menu is a trap on a touchscreen — and undo/redo
   * left out, because on a phone they are two always-visible buttons on the
   * board itself.
   */
  variant?: "bar" | "list";
  /** Lets the compact menu close itself once one of its rows has fired. */
  onAction?: () => void;
  /**
   * Opens the share dialog. The dialog itself is owned by the header, not
   * rendered here: on compact this component lives inside the menu sheet,
   * which closes (and unmounts) the moment a row fires.
   */
  onShare?: () => void;
  /** Opens the export-image dialog; owned by the header for the same reason. */
  onExportImage?: () => void;
}

/**
 * Board actions - undo/redo, clean, import/export, theme.
 *
 * Lives on the right of the design tab strip: everything here acts on the plan
 * that strip is switching between, so the two belong on the same bar.
 */
export function BoardActions({
  variant = "bar",
  onAction,
  onShare,
  onExportImage,
}: BoardActionsProps = {}) {
  const isReadOnly = useFactoryStore((state) => state.isReadOnly);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [isExportMenuOpen, setExportMenuOpen] = useState(false);
  const [pendingExport, setPendingExport] = useState<
    { format: "json"; requestId: string } | undefined
  >();
  const project = useFactoryStore((state) => state.project);
  const manifest = useFactoryStore((state) => state.datasetManifest);
  const selectedDatasetVersionId = useFactoryStore((state) => state.selectedDatasetVersionId);
  const isProjectImporting = useFactoryStore((state) => state.isProjectImporting);
  const canUndo = useFactoryStore((state) => state.undoHistory.length > 0);
  const canRedo = useFactoryStore((state) => state.redoHistory.length > 0);
  const setProject = useFactoryStore((state) => state.setProject);
  const frameBoardNodes = useFactoryStore((state) => state.frameBoardNodes);
  const setProjectImporting = useFactoryStore((state) => state.setProjectImporting);
  const cleanBoard = useFactoryStore((state) => state.cleanBoard);
  const undo = useFactoryStore((state) => state.undo);
  const redo = useFactoryStore((state) => state.redo);
  const lastResult = useFactoryStore((state) => state.lastResult);
  const selectedBoardIds = useFactoryStore((state) => state.selectedBoardIds);
  const [diagnosticsState, setDiagnosticsState] = useState<"idle" | "copied" | "failed">("idle");
  const [isPastingPlan, setPastingPlan] = useState(false);
  // Welcome COVERS the board, so the design underneath still has content and
  // Share would happily post it. But sharing a board you cannot see is a
  // trap, so the button waits until you are looking at the thing it posts.
  const isWelcomeCoveringBoard = useWelcomeTab().active;
  const canShare = !isWelcomeCoveringBoard && project.nodes.length > 0;
  const shareTitle = isWelcomeCoveringBoard
    ? "Share: open a design tab first"
    : project.nodes.length === 0
      ? "Share: build something first"
      : "Share";

  const selectedCardCount = selectedBoardIds.length;
  const diagnosticsLabel =
    diagnosticsState === "copied"
      ? "Copied to clipboard"
      : diagnosticsState === "failed"
        ? "Could not reach the clipboard"
        : selectedCardCount > 0
          ? `Copy diagnostics (${selectedCardCount} selected)`
          : "Copy diagnostics (whole plan)";

  /**
   * The pasteable version of what the board is showing: every selected card's
   * machine, tier, config, overclock, rates and verdict, in JSON. Select
   * nothing and it dumps the plan.
   *
   * The menu deliberately stays open - the row itself is the receipt, and
   * closing it would take the only confirmation away with it.
   */
  const copyDiagnostics = async () => {
    const text = formatBoardDump({
      project,
      result: lastResult,
      selectedIds: selectedBoardIds,
    });
    setDiagnosticsState((await copyToClipboard(text)) ? "copied" : "failed");
    window.setTimeout(() => setDiagnosticsState("idle"), 2000);
  };

  const exportJson = async () => {
    const requestId = randomUUID();
    setExportMenuOpen(false);
    setPendingExport({ format: "json", requestId });
    await nextAnimationFrame();

    const json = serializeFactoryProject(project);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "factory"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    window.setTimeout(() => {
      setPendingExport((current) => (current?.requestId === requestId ? undefined : current));
    }, 450);
  };

  const importProjectJson = async (file: File) => {
    setProjectImporting(true);

    try {
      const text = await readProjectFile(file);
      const selectedDatasetVersion = manifest?.versions.find(
        (version) => version.id === selectedDatasetVersionId,
      );
      const importedProject = refreshImportedProjectEdges(
        cloneImportedProject(parseFactoryProjectJson(text)),
      );

      // An imported plan was built on someone else's board, so its cards can
      // sit anywhere at all: the camera goes to them rather than leaving the
      // viewer on blank canvas.
      if (!selectedDatasetVersion) {
        setProject(importedProject);
        frameBoardNodes();
        console.warn(
          "Plan imported without an active GTNH dataset; embedded recipe data was kept.",
        );
        return;
      }

      const hydration = await hydrateImportedProjectRecipes(
        importedProject,
        selectedDatasetVersion,
      );
      setProject(refreshImportedProjectEdges(hydration.project));
      frameBoardNodes();

      if (hydration.missingRecipes.length) {
        console.warn(
          "Imported plan contains recipe IDs that are not present in the selected dataset.",
          hydration.missingRecipes,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Plan import failed.";
      console.error(message);
    } finally {
      setProjectImporting(false);
      if (projectInputRef.current) {
        projectInputRef.current.value = "";
      }
    }
  };

  useDropdownDismiss(isExportMenuOpen, {
    refs: [exportMenuRef],
    onClose: () => setExportMenuOpen(false),
    fade: true,
  });

  useEffect(() => {
    const handleProjectHistoryShortcut = (event: KeyboardEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey) {
        return;
      }

      // Typing owns its own history: Ctrl+Z in a rename field or note must
      // undo the typing, not the board.
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }

      if (key === "y" && !event.shiftKey) {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handleProjectHistoryShortcut);
    return () => window.removeEventListener("keydown", handleProjectHistoryShortcut);
  }, [redo, undo]);

  const requestCleanBoard = () => {
    if (project.nodes.length === 0 && project.edges.length === 0) {
      return;
    }

    if (!window.confirm("Clean the board and remove all nodes and links?")) {
      return;
    }

    cleanBoard();
  };

  const planFileInput = (
    <input
      ref={projectInputRef}
      type="file"
      accept="application/json,image/svg+xml,image/png,.json,.svg,.png"
      className="hidden"
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) {
          void importProjectJson(file);
        }
      }}
    />
  );

  if (isReadOnly) return null;

  if (variant === "list") {
    return (
      <div data-help-anchor="plan-actions" className="flex flex-col">
        {onShare ? (
          <MenuAction
            icon={Share2}
            label="Share this setup"
            disabled={!canShare}
            onClick={() => {
              onShare();
              onAction?.();
            }}
          />
        ) : null}
        <MenuAction
          icon={Trash2}
          label="Clean the board"
          onClick={() => {
            requestCleanBoard();
            onAction?.();
          }}
        />
        <MenuAction
          icon={Upload}
          label="Import a plan"
          disabled={isProjectImporting}
          onClick={() => {
            projectInputRef.current?.click();
            onAction?.();
          }}
        />
        <MenuAction
          icon={ClipboardPaste}
          label="Paste a copied plan"
          onClick={() => setPastingPlan(true)}
        />
        <MenuAction
          icon={diagnosticsState === "copied" ? Check : ClipboardList}
          label={diagnosticsLabel}
          onClick={() => {
            void copyDiagnostics();
          }}
        />
        <MenuAction
          icon={Download}
          label="Export as JSON"
          disabled={Boolean(pendingExport)}
          onClick={() => {
            void exportJson();
            onAction?.();
          }}
        />
        {onExportImage ? (
          <MenuAction
            icon={ImageDown}
            label="Export an image"
            onClick={() => {
              onExportImage();
              onAction?.();
            }}
          />
        ) : null}
        {planFileInput}
        {isPastingPlan ? (
          <PastePlanDialog
            onClose={() => {
              setPastingPlan(false);
              onAction?.();
            }}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div data-help-anchor="plan-actions" className="flex shrink-0 items-center gap-1">
      <div className="flex items-center gap-1">
        {/* No undo, redo or clean-board up here. Undo and redo already sit on
            the board's own build toolbar, an inch from the thing being undone,
            and having them in two places at once only made the header look
            like the authoritative pair. Clean board is a whole-plan action that
            was one slip away from the import button; it lives in the menu. */}
        {/* ONE plan menu since 2026-09-06: share, import and the exports
            all live behind the one key. Share and import used to be their
            own buttons on the bar; the bar was too wide and this is the
            corner where a menu is expected. Share is also on the plan's own
            identity drawer, so it is never more than a click away. */}
        <div ref={exportMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setExportMenuOpen((isOpen) => !isOpen)}
            title="Plan: share, import, export"
            aria-label="Plan menu: share, import, export"
            aria-expanded={isExportMenuOpen}
            aria-busy={pendingExport ? true : undefined}
            disabled={Boolean(pendingExport)}
            className="inline-flex h-5 items-center justify-center gap-0.5 rounded border border-line-strong bg-surface px-1.5 text-fg-subtle hover:bg-surface-raised disabled:cursor-wait disabled:bg-surface-sunken disabled:text-fg-muted"
          >
            {pendingExport ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            <ChevronDown className="h-3 w-3" />
          </button>
          {isExportMenuOpen ? (
            <div className="absolute right-0 top-full mt-1 z-50 min-w-44 rounded border border-line-strong bg-surface py-1 text-sm shadow-lg">
              {onShare ? (
                <ExportMenuItem
                  icon={Share2}
                  label="Share this setup"
                  title={shareTitle}
                  disabled={!canShare}
                  onClick={() => {
                    setExportMenuOpen(false);
                    onShare();
                  }}
                />
              ) : null}
              <ExportMenuItem
                icon={Upload}
                label="Import a plan..."
                disabled={isProjectImporting}
                onClick={() => {
                  setExportMenuOpen(false);
                  projectInputRef.current?.click();
                }}
              />
              <ExportMenuItem
                icon={ClipboardPaste}
                label="Paste a copied plan..."
                onClick={() => {
                  setExportMenuOpen(false);
                  setPastingPlan(true);
                }}
              />
              <div className="my-1 border-t border-line-strong" />
              <ExportMenuItem
                icon={diagnosticsState === "copied" ? Check : ClipboardList}
                label={diagnosticsLabel}
                onClick={() => {
                  void copyDiagnostics();
                }}
              />
              <div className="my-1 border-t border-line-strong" />
              <ExportMenuItem
                icon={Download}
                label="Export plan JSON"
                onClick={() => {
                  void exportJson();
                }}
              />
              {onExportImage ? (
                <ExportMenuItem
                  icon={ImageDown}
                  label="Export an image..."
                  onClick={() => {
                    setExportMenuOpen(false);
                    onExportImage();
                  }}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {planFileInput}
      {isPastingPlan ? <PastePlanDialog onClose={() => setPastingPlan(false)} /> : null}
    </div>
  );
}

/**
 * One row of the compact menu: a 40px tap target with the icon the top bar
 * would have shown on its own, and the words that icon was relying on a
 * tooltip for.
 */
function MenuAction({
  icon: Icon,
  label,
  disabled = false,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-10 w-full items-center gap-2.5 rounded px-2 text-left text-sm text-fg-subtle hover:bg-surface-sunken disabled:cursor-not-allowed disabled:text-fg-muted"
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

async function readProjectFile(file: File): Promise<string> {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "svg" || file.type === "image/svg+xml") {
    const projectJson = extractProjectJsonFromSvg(await file.text());
    if (!projectJson) {
      throw new Error("This SVG does not contain a GTNH Planner plan.");
    }
    return projectJson;
  }

  if (extension === "png" || file.type === "image/png") {
    const projectJson = await extractProjectJsonFromPng(file);
    if (!projectJson) {
      throw new Error("This PNG does not contain a GTNH Planner plan.");
    }
    return projectJson;
  }

  return file.text();
}

async function hydrateImportedProjectRecipes(
  project: FactoryProject,
  version: DatasetVersion,
): Promise<{
  project: FactoryProject;
  missingRecipes: Array<Pick<FactoryProject["recipes"][number], "id" | "name">>;
  migratedRecipes: Array<{
    fromId: string;
    toId: string;
    name: string;
    exact: boolean;
  }>;
}> {
  const availableRecipeIds = new Set(
    await getRecipeDatasetRecipeIds(DEFAULT_DATASET_MANIFEST_URL, version),
  );
  const importRecipesToResolve = project.recipes.filter(
    // Power cards own locally synthesized recipes (src/lib/power) that the
    // dataset can never answer for - and must never replace by name-match.
    (recipe) => !availableRecipeIds.has(recipe.id) && !isPowerRecipe(recipe),
  );
  const resolvedRecipeIds = new Map(
    importRecipesToResolve.length
      ? (
          await resolveRecipeDatasetRecipes(
            DEFAULT_DATASET_MANIFEST_URL,
            version,
            importRecipesToResolve.map(recipeContentRef),
          )
        ).matches.map((match) => [match.importedId, match] as const)
      : [],
  );
  const missingRecipes: Array<Pick<FactoryProject["recipes"][number], "id" | "name">> = [];
  const migratedRecipes: Array<{ fromId: string; toId: string; name: string; exact: boolean }> =
    [];
  const recipeIdMigration = new Map<string, string>();

  const hydratedRecipes = await Promise.all(
    project.recipes.map(async (recipe) => {
      if (isPowerRecipe(recipe)) {
        // Survives verbatim; normalizeLoadedProject resynthesizes it from
        // the node's settings on the way in.
        return recipe;
      }
      if (!availableRecipeIds.has(recipe.id)) {
        const contentMatch = resolvedRecipeIds.get(recipe.id);
        const migratedRecipe = contentMatch
          ? await getRecipeDatasetRecipe(DEFAULT_DATASET_MANIFEST_URL, version, contentMatch.recipeId)
          : await resolveImportedRecipe(version, recipe);
        if (migratedRecipe) {
          migratedRecipes.push({
            fromId: recipe.id,
            toId: migratedRecipe.id,
            name: recipe.name,
            exact: contentMatch?.exact ?? false,
          });
          recipeIdMigration.set(recipe.id, migratedRecipe.id);
          return migratedRecipe;
        }

        // Nothing in the dataset is close enough to stand in for it: the
        // plan's own embedded body keeps working, so it stays.
        missingRecipes.push({ id: recipe.id, name: recipe.name });
        return recipe;
      }

      return getRecipeDatasetRecipe(DEFAULT_DATASET_MANIFEST_URL, version, recipe.id);
    }),
  );
  const hydratedProject = {
    ...project,
    recipes: hydratedRecipes,
  };

  return {
    project: remapMigratedRecipeReferences(hydratedProject, recipeIdMigration),
    missingRecipes,
    migratedRecipes,
  };
}

function remapMigratedRecipeReferences(
  project: FactoryProject,
  recipeIdMigration: Map<string, string>,
): FactoryProject {
  if (recipeIdMigration.size === 0) {
    return project;
  }

  const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe] as const));
  const nodes = project.nodes.map((node) => {
    const migratedId = recipeIdMigration.get(node.recipeId);
    const carried = migratedId
      ? carryNodeOntoMigratedRecipe(node, recipesById.get(migratedId))
      : node;
    // A shared machine's extra recipes migrate by id like the first.
    const extras = carried.extraRecipes?.map((extra) => {
      const extraId = recipeIdMigration.get(extra.recipeId);
      return extraId ? { ...extra, recipeId: extraId } : extra;
    });
    return extras ? { ...carried, extraRecipes: extras } : carried;
  });
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const originalNodesById = new Map(project.nodes.map((node) => [node.id, node] as const));

  return {
    ...project,
    nodes,
    edges: project.edges.map((edge) =>
      remapMigratedRecipeEdgeHandles(
        project,
        nodesById,
        originalNodesById,
        recipeIdMigration,
        edge,
      ),
    ),
  };
}

function refreshImportedProjectEdges(project: FactoryProject): FactoryProject {
  if (project.edges.length === 0) {
    return project;
  }

  const nodesById = new Map(project.nodes.map((node) => [node.id, node] as const));
  const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe] as const));
  const storagesById = new Map(
    (project.storages ?? []).map((storage) => [storage.id, storage] as const),
  );
  const edges = project.edges.map((edge) =>
    refreshImportedProjectEdgeHandles(edge, nodesById, recipesById, storagesById),
  );

  return { ...project, edges };
}

function refreshImportedProjectEdgeHandles(
  edge: FactoryEdge,
  nodesById: Map<string, FactoryProject["nodes"][number]>,
  recipesById: Map<string, Recipe>,
  storagesById: Map<string, NonNullable<FactoryProject["storages"]>[number]>,
): FactoryEdge {
  const sourceNode = nodesById.get(edge.source);
  const targetNode = nodesById.get(edge.target);
  const sourceRecipe = sectionRecipeAt(sourceNode, edge.sourceHandle, recipesById);
  const targetRecipe = sectionRecipeAt(targetNode, edge.targetHandle, recipesById);
  const sourceStorage = storagesById.get(edge.source);
  const targetStorage = storagesById.get(edge.target);

  return {
    ...edge,
    sourceHandle: sourceRecipe
      ? remapRecipeHandle(
          sourceRecipe,
          edge.sourceHandle,
          "output",
          edge.resourceKind,
          edge.resourceId,
        )
      : sourceStorage
        ? makeResourceHandleId("output", {
            kind: sourceStorage.kind,
            id: sourceStorage.resourceId,
          })
        : edge.sourceHandle,
    targetHandle: targetRecipe
      ? remapRecipeHandle(
          targetRecipe,
          edge.targetHandle,
          "input",
          edge.resourceKind,
          edge.resourceId,
        )
      : targetStorage
        ? makeResourceHandleId("input", {
            kind: targetStorage.kind,
            id: targetStorage.resourceId,
          })
        : edge.targetHandle,
  };
}

function remapMigratedRecipeEdgeHandles(
  project: FactoryProject,
  nodesById: Map<string, FactoryProject["nodes"][number]>,
  originalNodesById: Map<string, FactoryProject["nodes"][number]>,
  recipeIdMigration: Map<string, string>,
  edge: FactoryEdge,
): FactoryEdge {
  const sourceNode = nodesById.get(edge.source);
  const targetNode = nodesById.get(edge.target);
  const originalSourceNode = originalNodesById.get(edge.source);
  const originalTargetNode = originalNodesById.get(edge.target);
  const sourceRecipeMigrated = Boolean(
    originalSourceNode && recipeIdMigration.has(originalSourceNode.recipeId),
  );
  const targetRecipeMigrated = Boolean(
    originalTargetNode && recipeIdMigration.has(originalTargetNode.recipeId),
  );

  if (!sourceRecipeMigrated && !targetRecipeMigrated) {
    return edge;
  }

  const migratedRecipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe] as const));
  const sourceRecipe = sectionRecipeAt(sourceNode, edge.sourceHandle, migratedRecipesById);
  const targetRecipe = sectionRecipeAt(targetNode, edge.targetHandle, migratedRecipesById);

  return {
    ...edge,
    sourceHandle:
      sourceRecipeMigrated && sourceRecipe
        ? remapRecipeHandle(
            sourceRecipe,
            edge.sourceHandle,
            "output",
            edge.resourceKind,
            edge.resourceId,
          )
        : edge.sourceHandle,
    targetHandle:
      targetRecipeMigrated && targetRecipe
        ? remapRecipeHandle(
            targetRecipe,
            edge.targetHandle,
            "input",
            edge.resourceKind,
            edge.resourceId,
          )
        : edge.targetHandle,
  };
}

/**
 * A shared machine's section prefix (`r2:`) rides through the remap untouched:
 * the handle behind it is repaired against that section's recipe and the
 * prefix put back.
 */
function remapRecipeHandle(
  recipe: Recipe,
  prefixedHandleId: string | undefined,
  expectedSide: "input" | "output",
  resourceKind: ResourceKind,
  resourceId: string,
): string | undefined {
  const { section, handleId } = splitSectionHandleId(prefixedHandleId);
  const bare = remapBareRecipeHandle(recipe, handleId, expectedSide, resourceKind, resourceId);
  return bare === undefined ? undefined : sectionHandleId(section, bare);
}

/** The recipe a wire's end reads at a card: the section its handle names. */
function sectionRecipeAt(
  node: FactoryProject["nodes"][number] | undefined,
  handleId: string | undefined,
  recipesById: Map<string, Recipe>,
): Recipe | undefined {
  if (!node) {
    return undefined;
  }
  const view = sectionNodeView(node, splitSectionHandleId(handleId).section);
  return recipesById.get(view.recipeId);
}

function remapBareRecipeHandle(
  recipe: Recipe,
  handleId: string | undefined,
  expectedSide: "input" | "output",
  resourceKind: ResourceKind,
  resourceId: string,
): string | undefined {
  const handle = parseResourceHandleId(handleId);
  const resources = expectedSide === "input" ? recipe.inputs : recipe.outputs;
  const handleResourceKind = handle?.kind ?? resourceKind;
  const handleResourceId = handle?.resourceId ?? resourceId;
  const slotIndex = parseResourceHandleSlotIndex(handleId);

  if (
    handle?.side === expectedSide &&
    resources.some(
      (resource, index) =>
        resource.kind === handleResourceKind &&
        resource.id === handleResourceId &&
        makeResourceHandleId(expectedSide, resource, index) === handleId,
    )
  ) {
    return handleId;
  }

  if (slotIndex !== undefined) {
    const indexedResource = resources[slotIndex];
    if (indexedResource?.kind === handleResourceKind && indexedResource.id === handleResourceId) {
      return makeResourceHandleId(expectedSide, indexedResource, slotIndex);
    }
  }

  const nextIndex = resources.findIndex(
    (resource) => resource.kind === resourceKind && resource.id === resourceId,
  );
  if (nextIndex !== -1) {
    return makeResourceHandleId(expectedSide, resources[nextIndex], nextIndex);
  }

  const matchingHandleIndex = resources.findIndex(
    (resource) => resource.kind === handleResourceKind && resource.id === handleResourceId,
  );
  return matchingHandleIndex === -1
    ? handleId
    : makeResourceHandleId(expectedSide, resources[matchingHandleIndex], matchingHandleIndex);
}

function parseResourceHandleSlotIndex(handleId: string | undefined): number | undefined {
  const rawIndex = handleId?.split(":")[3];
  if (rawIndex === undefined) {
    return undefined;
  }

  const index = Number(rawIndex);
  return Number.isInteger(index) && index >= 0 ? index : undefined;
}

async function resolveImportedRecipe(
  version: DatasetVersion,
  importedRecipe: Recipe,
): Promise<Recipe | undefined> {
  const candidates = await queryRecipeDatasetRecipes(DEFAULT_DATASET_MANIFEST_URL, version, {
    query: importedRecipe.name,
    mode: "recipes",
    maxTier: "all",
    offset: 0,
    limit: 40,
  });
  // A name search is the last resort, and it only ever hands back a recipe
  // that takes and makes the same things: a same-named recipe with other
  // inputs (the second Steel Ingot blast furnace recipe) is not this one.
  const match = pickRecipeRefMatch(
    recipeContentRef(importedRecipe),
    candidates.recipes.map((candidate) => ({
      ...candidate,
      source: candidate.source ?? { recipeMap: candidate.recipeMap },
    })),
  );

  return match && match.score >= RECIPE_MIGRATION_SCORE
    ? getRecipeDatasetRecipe(DEFAULT_DATASET_MANIFEST_URL, version, match.candidate.id)
    : undefined;
}

/** Below this the likeness is too loose to swap a plan's recipe for. */
const RECIPE_MIGRATION_SCORE = 300;

/**
 * A node whose recipe was migrated keeps only the choices the new recipe
 * can honour: a handler id the new recipe does not list is dropped (the
 * card falls back to its first handler, as a dataset load would leave it),
 * and slot overrides move from the old recipe's slot numbers to the slot
 * holding the same resource on the new one, since the exporter's slot
 * order is not part of what makes two recipes the same.
 */
function carryNodeOntoMigratedRecipe(
  node: FactoryProject["nodes"][number],
  recipe: Recipe | undefined,
): FactoryProject["nodes"][number] {
  if (!recipe) {
    return node;
  }
  const carried: FactoryProject["nodes"][number] = { ...node, recipeId: recipe.id };
  if (
    node.machineHandlerId &&
    !(recipe.machineHandlers ?? []).some((handler) => handler.id === node.machineHandlerId)
  ) {
    delete carried.machineHandlerId;
  }
  const overrides = node.recipeInputOverrides;
  if (overrides) {
    const claimed = new Set<number>();
    const rekeyed: NonNullable<typeof overrides> = {};
    for (const override of Object.values(overrides)) {
      if (!override) {
        continue;
      }
      const index = recipe.inputs.findIndex(
        (input, inputIndex) =>
          !claimed.has(inputIndex) &&
          input.kind === override.kind &&
          (input.id === override.id ||
            input.alternatives?.some((alternative) => alternative.id === override.id)),
      );
      if (index === -1) {
        continue;
      }
      claimed.add(index);
      rekeyed[String(index)] = override;
    }
    if (Object.keys(rekeyed).length > 0) {
      carried.recipeInputOverrides = rekeyed;
    } else {
      delete carried.recipeInputOverrides;
    }
  }
  return carried;
}

function ExportMenuItem({
  icon: Icon,
  label,
  title,
  disabled = false,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  title?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-left text-fg-subtle hover:bg-surface-sunken disabled:cursor-not-allowed disabled:text-fg-muted"
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </button>
  );
}

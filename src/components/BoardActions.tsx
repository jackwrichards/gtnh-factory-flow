"use client";

import {
  Check,
  ChevronDown,
  Download,
  FileImage,
  ImageDown,
  Link2,
  LoaderCircle,
  Moon,
  Pencil,
  Redo2,
  Share2,
  Sun,
  Trash2,
  Undo2,
  Upload,
  WandSparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  cloneImportedProject,
  parseFactoryProjectJson,
  serializeFactoryProject,
} from "@/lib/import-export";
import { DEFAULT_DATASET_MANIFEST_URL } from "@/lib/datasets";
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
  RecipeOutput,
  ResourceKind,
} from "@/lib/model/types";
import { makeResourceHandleId, parseResourceHandleId } from "./flow/resource-handles";
import {
  FLOW_IMAGE_EXPORT_COMPLETE_EVENT,
  FLOW_IMAGE_EXPORT_EVENT,
  extractProjectJsonFromPng,
  extractProjectJsonFromSvg,
} from "@/lib/import-export/plan-image";
import { useFactoryStore } from "@/store/factory-store";
import { useThemeStore } from "@/store/theme-store";
import { SharePlanDialog } from "./community/SharePlanDialog";

/**
 * Board actions — undo/redo, optimise, clean, import/export, theme.
 *
 * Lives on the right of the design tab strip: everything here acts on the plan
 * that strip is switching between, so the two belong on the same bar.
 */
export function BoardActions() {
  const projectInputRef = useRef<HTMLInputElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [isExportMenuOpen, setExportMenuOpen] = useState(false);
  const [pendingExport, setPendingExport] = useState<
    { format: "json" | "svg" | "png"; requestId: string } | undefined
  >();
  const [isShareOpen, setShareOpen] = useState(false);
  const linkMenuRef = useRef<HTMLDivElement>(null);
  const [isLinkMenuOpen, setLinkMenuOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState<string>();
  const project = useFactoryStore((state) => state.project);
  const manifest = useFactoryStore((state) => state.datasetManifest);
  const selectedDatasetVersionId = useFactoryStore((state) => state.selectedDatasetVersionId);
  const isProjectImporting = useFactoryStore((state) => state.isProjectImporting);
  const canUndo = useFactoryStore((state) => state.undoHistory.length > 0);
  const canRedo = useFactoryStore((state) => state.redoHistory.length > 0);
  const setProject = useFactoryStore((state) => state.setProject);
  const setProjectImporting = useFactoryStore((state) => state.setProjectImporting);
  const cleanBoard = useFactoryStore((state) => state.cleanBoard);
  const optimizeMachineCounts = useFactoryStore((state) => state.optimizeMachineCounts);
  const undo = useFactoryStore((state) => state.undo);
  const redo = useFactoryStore((state) => state.redo);
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);

  const exportJson = async () => {
    const requestId = crypto.randomUUID();
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

  const exportImage = async (format: "svg" | "png") => {
    const requestId = crypto.randomUUID();
    setExportMenuOpen(false);
    setPendingExport({ format, requestId });
    await nextPaint();

    window.dispatchEvent(
      new CustomEvent(FLOW_IMAGE_EXPORT_EVENT, {
        detail: {
          format,
          requestId,
          fileName: project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "factory",
          projectJson: serializeFactoryProject(project),
        },
      }),
    );
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

      if (!selectedDatasetVersion) {
        setProject(importedProject);
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

  useEffect(() => {
    const closeMenus = (event: MouseEvent) => {
      if (!exportMenuRef.current?.contains(event.target as Node)) {
        setExportMenuOpen(false);
      }
      if (!linkMenuRef.current?.contains(event.target as Node)) {
        setLinkMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", closeMenus);
    return () => window.removeEventListener("mousedown", closeMenus);
  }, []);

  // The design remembers which community post it belongs to (set by Share and
  // by opening a post from the hub); the link button targets exactly that.
  const linkedPlanId = project.metadata?.communityPlanId;

  const copyPostLink = async (kind: "view" | "edit") => {
    if (!linkedPlanId) {
      return;
    }

    const url =
      kind === "edit"
        ? `${window.location.origin}/?plan=${linkedPlanId}`
        : `${window.location.origin}/community?plan=${linkedPlanId}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this link:", url);
      return;
    }

    setCopiedLink(kind);
    window.setTimeout(
      () => setCopiedLink((current) => (current === kind ? undefined : current)),
      1500,
    );
  };

  useEffect(() => {
    const handleImageExportComplete = (event: Event) => {
      const detail = (event as CustomEvent).detail as { requestId?: unknown } | undefined;
      if (typeof detail?.requestId !== "string") {
        return;
      }

      setPendingExport((current) =>
        current?.requestId === detail.requestId ? undefined : current,
      );
    };

    window.addEventListener(FLOW_IMAGE_EXPORT_COMPLETE_EVENT, handleImageExportComplete);
    return () =>
      window.removeEventListener(FLOW_IMAGE_EXPORT_COMPLETE_EVENT, handleImageExportComplete);
  }, []);

  useEffect(() => {
    const handleProjectHistoryShortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        undo();
        return;
      }

      if (key === "y") {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handleProjectHistoryShortcut);
    return () => window.removeEventListener("keydown", handleProjectHistoryShortcut);
  }, [redo, undo]);

  return (
    <div className="flex shrink-0 items-center gap-1">
      <div className="flex items-center gap-1">
        <ToolbarButton icon={Undo2} label="Undo" disabled={!canUndo} onClick={undo} />
        <ToolbarButton icon={Redo2} label="Redo" disabled={!canRedo} onClick={redo} />
        <button
          type="button"
          onClick={optimizeMachineCounts}
          disabled={project.nodes.length === 0}
          title="Set every machine count to its suggested best ratio"
          aria-label="Set every machine count to its suggested best ratio"
          className="inline-flex h-7 w-7 items-center justify-center rounded border border-cyan-700 bg-cyan-600 text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:border-line-strong disabled:bg-surface-sunken disabled:text-fg-muted"
        >
          <WandSparkles className="h-3.5 w-3.5" />
        </button>
        <ToolbarButton
          icon={Trash2}
          label="Clean board"
          onClick={() => {
            if (project.nodes.length === 0 && project.edges.length === 0) {
              return;
            }

            if (!window.confirm("Clean the board and remove all nodes and links?")) {
              return;
            }

            cleanBoard();
          }}
        />
        <ToolbarButton
          icon={Upload}
          label="Import plan"
          disabled={isProjectImporting}
          onClick={() => projectInputRef.current?.click()}
        />
        <div ref={exportMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setExportMenuOpen((isOpen) => !isOpen)}
            title="Export plan"
            aria-label="Export plan"
            aria-expanded={isExportMenuOpen}
            aria-busy={pendingExport ? true : undefined}
            disabled={Boolean(pendingExport)}
            className="inline-flex h-7 items-center justify-center gap-0.5 rounded border border-line-strong bg-surface px-1.5 text-fg-subtle hover:bg-surface-raised disabled:cursor-wait disabled:bg-surface-sunken disabled:text-fg-muted"
          >
            {pendingExport ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            <ChevronDown className="h-3 w-3" />
          </button>
          {isExportMenuOpen ? (
            <div className="absolute right-0 top-8 z-50 min-w-44 rounded border border-line-strong bg-surface py-1 text-sm shadow-lg">
              <ExportMenuItem
                icon={Download}
                label="Export plan JSON"
                onClick={() => {
                  void exportJson();
                }}
              />
              <ExportMenuItem
                icon={FileImage}
                label="Export plan SVG"
                onClick={() => {
                  void exportImage("svg");
                }}
              />
              <ExportMenuItem
                icon={ImageDown}
                label="Export plan PNG"
                onClick={() => {
                  void exportImage("png");
                }}
              />
            </div>
          ) : null}
        </div>
        <ToolbarButton
          icon={Share2}
          label="Share to community"
          disabled={project.nodes.length === 0}
          onClick={() => setShareOpen(true)}
        />
        <div ref={linkMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setLinkMenuOpen((isOpen) => !isOpen)}
            disabled={!linkedPlanId}
            title={
              linkedPlanId
                ? "Copy a link to this plan's community post"
                : "Share this plan first to get a link"
            }
            aria-label="Copy a link to this plan's community post"
            aria-expanded={isLinkMenuOpen}
            className="inline-flex h-7 w-7 items-center justify-center rounded border border-line-strong bg-surface text-fg-subtle hover:bg-surface-raised disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-fg-muted"
          >
            <Link2 className="h-3.5 w-3.5" />
          </button>
          {isLinkMenuOpen && linkedPlanId ? (
            <div className="absolute right-0 top-8 z-50 min-w-44 rounded border border-line-strong bg-surface py-1 text-sm shadow-lg">
              <button
                type="button"
                onClick={() => void copyPostLink("view")}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-raised"
              >
                {copiedLink === "view" ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Link2 className="h-3.5 w-3.5 text-fg-muted" />
                )}
                Copy link
              </button>
              <button
                type="button"
                onClick={() => void copyPostLink("edit")}
                title="Opens this post directly in a friend's editor"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-raised"
              >
                {copiedLink === "edit" ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Pencil className="h-3.5 w-3.5 text-fg-muted" />
                )}
                Copy edit link
              </button>
            </div>
          ) : null}
        </div>
        <ToolbarButton
          icon={theme === "dark" ? Sun : Moon}
          label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          onClick={toggleTheme}
        />
      </div>
      {isShareOpen ? <SharePlanDialog onClose={() => setShareOpen(false)} /> : null}

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
    </div>
  );
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
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
  }>;
}> {
  const availableRecipeIds = new Set(
    await getRecipeDatasetRecipeIds(DEFAULT_DATASET_MANIFEST_URL, version),
  );
  const importRecipesToResolve = project.recipes.filter(
    (recipe) => !availableRecipeIds.has(recipe.id),
  );
  const resolvedRecipeIds = new Map(
    importRecipesToResolve.length
      ? (
          await resolveRecipeDatasetRecipes(
            DEFAULT_DATASET_MANIFEST_URL,
            version,
            importRecipesToResolve.map((recipe) => ({
              id: recipe.id,
              name: recipe.name,
              machineType: recipe.machineType,
              recipeMap: recipe.source?.recipeMap,
              rawRecipeId: recipe.source?.rawRecipeId,
              outputs: recipe.outputs.map((output) => ({
                kind: output.kind,
                id: output.id,
              })),
            })),
          )
        ).matches.map((match) => [match.importedId, match.recipeId] as const)
      : [],
  );
  const missingRecipes: Array<Pick<FactoryProject["recipes"][number], "id" | "name">> = [];
  const migratedRecipes: Array<{ fromId: string; toId: string; name: string }> = [];
  const recipeIdMigration = new Map<string, string>();

  const hydratedRecipes = await Promise.all(
    project.recipes.map(async (recipe) => {
      if (!availableRecipeIds.has(recipe.id)) {
        const rawRecipeIdMatch = resolvedRecipeIds.get(recipe.id);
        const migratedRecipe = rawRecipeIdMatch
          ? await getRecipeDatasetRecipe(DEFAULT_DATASET_MANIFEST_URL, version, rawRecipeIdMatch)
          : await resolveImportedRecipe(version, recipe);
        if (migratedRecipe) {
          migratedRecipes.push({
            fromId: recipe.id,
            toId: migratedRecipe.id,
            name: recipe.name,
          });
          recipeIdMigration.set(recipe.id, migratedRecipe.id);
          return migratedRecipe;
        }

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

  const nodes = project.nodes.map((node) => ({
    ...node,
    recipeId: recipeIdMigration.get(node.recipeId) ?? node.recipeId,
  }));
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
  const sourceRecipe = sourceNode ? recipesById.get(sourceNode.recipeId) : undefined;
  const targetRecipe = targetNode ? recipesById.get(targetNode.recipeId) : undefined;
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

  const sourceRecipe = project.recipes.find((recipe) => recipe.id === sourceNode?.recipeId);
  const targetRecipe = project.recipes.find((recipe) => recipe.id === targetNode?.recipeId);

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

function remapRecipeHandle(
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
  const sourceRecipeMap = importedRecipe.source?.recipeMap;
  const match = candidates.recipes.find(
    (candidate) =>
      candidate.id !== importedRecipe.id &&
      candidate.name === importedRecipe.name &&
      candidate.machineType === importedRecipe.machineType &&
      (!sourceRecipeMap ||
        candidate.recipeMap === sourceRecipeMap ||
        candidate.source?.recipeMap === sourceRecipeMap) &&
      outputsAreCompatible(importedRecipe.outputs, candidate.outputs),
  );

  return match
    ? getRecipeDatasetRecipe(DEFAULT_DATASET_MANIFEST_URL, version, match.id)
    : undefined;
}

function outputsAreCompatible(
  importedOutputs: RecipeOutput[],
  candidateOutputs: RecipeOutput[],
): boolean {
  if (importedOutputs.length === 0) {
    return true;
  }

  const candidateResources = new Set(
    candidateOutputs.map((output) => `${output.kind}:${output.id}`),
  );
  return importedOutputs.every((output) => candidateResources.has(`${output.kind}:${output.id}`));
}

function ExportMenuItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-fg-subtle hover:bg-surface-sunken"
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </button>
  );
}

function ToolbarButton({
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
      title={label}
      aria-label={label}
      className="inline-flex h-7 w-7 items-center justify-center rounded border border-line-strong bg-surface text-fg-subtle hover:bg-surface-raised disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-fg-muted"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

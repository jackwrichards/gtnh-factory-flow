"use client";

import {
  noteRecipesRefreshed,
  noteRecipesRequested,
  recipesToRefresh,
  resolveProjectRecipes,
} from "@/lib/datasets/refresh-project-recipes";
import type { Recipe } from "@/lib/model/types";
import { useDeviceSettings, writeDeviceSettings } from "@/lib/device-settings";
import { memo, useCallback, useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import {
  DEFAULT_DATASET_MANIFEST_URL,
  fetchDatasetManifest,
  pickDefaultDatasetVersion,
} from "@/lib/datasets";
import {
  initRecipeDatasetVersion,
} from "@/lib/datasets/browser-loader";
import { loadResourceHistory, useFactoryStore } from "@/store/factory-store";
import { useDesignStore } from "@/store/design-store";
import { useNetworkStore } from "@/store/network-store";
import { startNetworkSession } from "@/lib/networks/sync";
import { NetworkPage } from "./networks/NetworkPage";
import { useCommunityAuthStore } from "@/store/community-auth-store";
import { recordResourceTrend, resetResourceTrends } from "@/lib/resource-trends";
import { useWorkspaceView, writeWorkspaceView } from "@/lib/workspace-view";
import { openCommunityPost } from "@/lib/community/open-post";
import { openPlanCodeFromAddress } from "@/lib/open-plan-code";
import { forgetSharedPlanId, readSharedPlanId, syncSharedPlanAddress } from "@/lib/community/shared-link";
import { useIsCompactViewport } from "@/lib/compact-view";
import { startLibrarySync } from "@/lib/library/library-sync";
import { startDesignTabSync } from "@/store/design-store";
import { startLiveSessions } from "@/store/live-session";
import { useLibraryTab } from "@/lib/library/library-tab";
import { useWelcomeTab } from "@/lib/welcome/welcome-tab";
import { AppHeader } from "./AppHeader";
import { LibraryPage } from "./library/LibraryPage";
import { ModLibrary } from "./chrome/ModLibrary";
import { ModPowerPicker } from "./chrome/ModPowerPicker";
import { WelcomePage } from "./welcome/WelcomePage";
import { SharedAddressSync } from "./SharedAddressSync";
import { PublicViewBar } from "./community/PublicViewBar";
import { ViewOnlyNotice } from "./community/ViewOnlyNotice";
import { TabConflictNotice } from "./TabConflictNotice";
import { LiveNotice } from "./live/LiveNotice";
import { TaskBoard, TaskLinkIndexController } from "./tasks/TaskBoard";
import { AddToTaskMenu } from "./tasks/AddToTask";
import { BoardToolbar } from "./chrome/BoardToolbar";
import { isLiveConfigured } from "@/lib/live/live-config";
import { BlueprintSaveDialog } from "./BlueprintSaveDialog";
import { PowerSourceOverlay } from "./PowerSourceOverlay";
import { FactoryFlow } from "./flow/FactoryFlow";
import { useBoardSoundEffects } from "./flow/use-board-sound-effects";
import { InspectorPanel } from "./InspectorPanel";
import { PanelDrawer } from "./PanelDrawer";
import { usePlanLayout } from "./use-plan-layout";
import { PlanOverview } from "./PlanOverviewMount";
import { ColumnStrip } from "./flow/clean/rail/OverviewRail";
import { useRailView } from "./flow/clean/rail/rail-view";
import { PanelHandle } from "./PanelHandle";
import { usePanelFit, type PanelFitState } from "./use-panel-fit";
import { requestPanelOpen, type SidePanel } from "@/lib/panel-force";
import {
  INSPECTOR_WIDTH,
  ITEMS_DEFAULT_WIDTH,
  ITEMS_WIDTH,
  OVERVIEW_DEFAULT_WIDTH,
  PANEL_RAIL_WIDTH,
  workspaceColumns,
} from "@/lib/workspace-columns";
import { RecipeBrowser } from "./RecipeBrowser";
import { FoldGlyph } from "./flow/clean/fold/FoldKey";

export function FactoryPlannerApp() {
  const project = useFactoryStore((state) => state.project);
  const lastResult = useFactoryStore((state) => state.lastResult);
  const workspace = useWorkspaceView();
  const isCompact = useIsCompactViewport();
  const barInGrid = usePlanLayout() && !isCompact;
  const hydrateResourceHistory = useFactoryStore((state) => state.hydrateResourceHistory);
  const hydrateDesigns = useDesignStore((state) => state.hydrate);
  const saveActiveProject = useDesignStore((state) => state.saveActiveProject);
  const activeDesignId = useDesignStore((state) => state.activeDesignId);
  const setDatasetManifest = useFactoryStore((state) => state.setDatasetManifest);
  const setDataset = useFactoryStore((state) => state.setDataset);
  const refreshProjectRecipes = useFactoryStore((state) => state.refreshProjectRecipes);
  const setDatasetLoading = useFactoryStore((state) => state.setDatasetLoading);
  const setDatasetError = useFactoryStore((state) => state.setDatasetError);
  const hydratedRef = useRef(false);
  // Which stored recipes have been checked against which dataset version, so
  // a design opened after the dataset landed (tab switch, hydrated plan) gets
  // the boot load's refresh once, and again when a synced or copied plan
  // brings a recipe back without its runtime table (recipesToRefresh).
  const checkedRecipesRef = useRef<Map<string, boolean>>(new Map());
  const requestedRecipesRef = useRef<WeakSet<Recipe>>(new WeakSet());
  const datasetVersionId = useFactoryStore((state) => state.dataset?.datasetVersionId);
  const datasetManifest = useFactoryStore((state) => state.datasetManifest);
  const datasetManifestUrl = useFactoryStore((state) => state.datasetManifestUrl);
  useEffect(() => {
    if (!datasetVersionId) {
      return;
    }
    const version = datasetManifest?.versions.find((entry) => entry.id === datasetVersionId);
    if (!version) {
      return;
    }
    const pending = recipesToRefresh(
      project.recipes,
      version.id,
      checkedRecipesRef.current,
      requestedRecipesRef.current,
    );
    if (pending.length === 0) {
      return;
    }
    noteRecipesRequested(pending, version.id, checkedRecipesRef.current, requestedRecipesRef.current);
    let cancelled = false;
    void resolveProjectRecipes(
      datasetManifestUrl ?? DEFAULT_DATASET_MANIFEST_URL,
      version,
      pending,
    ).then(({ refreshed, migration }) => {
      noteRecipesRefreshed(refreshed, version.id, checkedRecipesRef.current);
      if (!cancelled && refreshed.length > 0) {
        refreshProjectRecipes(refreshed, migration);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [datasetManifest, datasetManifestUrl, datasetVersionId, project.recipes, refreshProjectRecipes]);
  useBoardSoundEffects();
  const skipInitialSaveRef = useRef(true);
  const saveTimeoutRef = useRef<number | undefined>(undefined);

  const loadDatasetVersion = useCallback(
    async (versionId: string) => {
      const state = useFactoryStore.getState();
      const manifest = state.datasetManifest;
      const manifestUrl = state.datasetManifestUrl ?? DEFAULT_DATASET_MANIFEST_URL;
      const version = manifest?.versions.find((entry) => entry.id === versionId);

      if (!manifest || !version) {
        setDatasetError(`Dataset version "${versionId}" is not available in the manifest.`);
        return;
      }

      try {
        setDatasetLoading(true);
        const dataset = await initRecipeDatasetVersion(manifestUrl, version);
        setDataset(dataset);
        const projectRecipes = useFactoryStore.getState().project.recipes;
        if (projectRecipes.length > 0) {
          const { refreshed, migration } = await resolveProjectRecipes(manifestUrl, version, projectRecipes);
          const checked = new Map<string, boolean>();
          noteRecipesRequested(projectRecipes, version.id, checked, requestedRecipesRef.current);
          noteRecipesRefreshed(refreshed, version.id, checked);
          checkedRecipesRef.current = checked;
          refreshProjectRecipes(refreshed, migration);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Dataset load failed.";
        setDatasetError(message);
      }
    },
    [refreshProjectRecipes, setDataset, setDatasetError, setDatasetLoading],
  );

  useEffect(() => {
    const cancelHydration = scheduleIdleWork(() => {
      hydrateResourceHistory(loadResourceHistory());

      void hydrateDesigns()
        .then(async () => {
          try {
            // Own posts open as your design; everyone else's opens as a copy.
            const sharedPlanId = readSharedPlanId();
            if (sharedPlanId) {
              try {
                await openCommunityPost({ id: sharedPlanId });
              } finally {
                // Release the arrival guard, then set the address explicitly:
                // React may already have run the viewer's address effect.
                forgetSharedPlanId();
                syncSharedPlanAddress(useDesignStore.getState().publicView?.id
                  ?? useFactoryStore.getState().project.metadata?.communityPlanId);
              }
            }
          } catch (error) {
            console.error(
              error instanceof Error ? error.message : "Importing the shared setup failed.",
            );
          }
          // A copied plan's link (#p=...) opens as a new tab of its own.
          await openPlanCodeFromAddress();
        })
        .finally(() => {
          // Autosave stays parked until the stored design is on the canvas.
          // Releasing it earlier would let the empty starting plan be written
          // over the design that is still loading.
          hydratedRef.current = true;
        });
    }, 800);

    return cancelHydration;
  }, [hydrateDesigns, hydrateResourceHistory]);

  // A copied plan's link pasted into the address bar of an open tab fires
  // no load, only a hash change.
  useEffect(() => {
    const onHashChange = () => {
      if (hydratedRef.current) {
        void openPlanCodeFromAddress();
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // The library follows the account: sign-in starts the sync, sign-out stops
  // it, and every change here reaches the other devices a few seconds later.
  useEffect(() => startLibrarySync(), []);
  useEffect(() => startNetworkSession(), []);

  // Who is signed in is asked once as the app opens. The mod's bar has no
  // account key (the Library has it), so nothing else asks before the Library
  // opens, and the account sync and live plans wait for the answer.
  useEffect(() => {
    void useCommunityAuthStore.getState().hydrate();
  }, []);

  // Other browser tabs of the planner share this library: keep the open
  // design current with their saves (design-store.ts, canvasBase).
  useEffect(() => startDesignTabSync(), []);

  // A cloud plan on the canvas is edited live with everyone in it. Nothing at
  // all without NEXT_PUBLIC_LIVE_URL (live-session.ts).
  useEffect(() => startLiveSessions(), []);

  // Recorded here rather than in the resource panel: the charts must not lose
  // their history because the right column happened to be closed, and every
  // path that re-solves lands in `lastResult` whether it came from the board,
  // an undo, or a dataset reload.
  useEffect(() => {
    recordResourceTrend(lastResult);
  }, [lastResult]);

  // A different design is a different story, so the chart starts over.
  useEffect(() => {
    resetResourceTrends();
  }, [activeDesignId]);

  useEffect(() => {
    let cancelled = false;

    async function loadManifest() {
      try {
        setDatasetLoading(true);
        const manifest = await fetchDatasetManifest(DEFAULT_DATASET_MANIFEST_URL);
        if (cancelled) {
          return;
        }

        setDatasetManifest(manifest, DEFAULT_DATASET_MANIFEST_URL);
        if (!pickDefaultDatasetVersion(manifest)) {
          setDatasetLoading(false);
          return;
        }

        void loadDatasetVersion(pickDefaultDatasetVersion(manifest)!.id);
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : "Dataset manifest load failed.";
        setDatasetError(message);
      }
    }

    void loadManifest();

    return () => {
      cancelled = true;
    };
  }, [loadDatasetVersion, setDatasetError, setDatasetLoading, setDatasetManifest]);

  useEffect(() => {
    if (!hydratedRef.current) {
      return;
    }

    if (skipInitialSaveRef.current) {
      skipInitialSaveRef.current = false;
      return;
    }

    if (saveTimeoutRef.current !== undefined) {
      window.clearTimeout(saveTimeoutRef.current);
    }

    // The design id is captured here, alongside the plan it belongs to. The
    // save can land up to ~1.5s later, by which point the active design may
    // have changed; the store drops the write rather than misfiling it.
    const savingDesignId = activeDesignId;
    saveTimeoutRef.current = window.setTimeout(() => {
      scheduleIdleWork(() => {
        void saveActiveProject(savingDesignId, project);
      }, 1200);
    }, 350);

    return () => {
      if (saveTimeoutRef.current !== undefined) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [activeDesignId, project, saveActiveProject]);


  return (
    // Height in --ui-dvh (see ui-scale.ts: the shell is CSS-zoomed and viewport
    // units are not divided by zoom). dvh, not vh, so a phone's collapsing
    // address bar never hides the board's bottom row.
    //
    // No minimum height: a shell taller than the window scrolls the page and
    // adds a scrollbar that skews `window.innerWidth` measurements. The board
    // and panels carry their own floors.
    <div className="ui-scale-shell flex h-[calc(100*var(--ui-dvh))] flex-col bg-canvas text-fg">
      <RecipeBookOpener />
      <PlacementRevealer />
      <SharedAddressSync />
      {/* On a desktop plan board the mod's bar is the workspace grid's first row, across the overview, the board and
          the items list. */}
      {barInGrid ? null : <AppHeader onLoadDatasetVersion={loadDatasetVersion} />}
      {isCompact ? (
        <CompactWorkspace workspace={workspace} onLoadDatasetVersion={loadDatasetVersion} />
      ) : (
        <ColumnWorkspace
          workspace={workspace}
          onLoadDatasetVersion={loadDatasetVersion}
          header={barInGrid ? <AppHeader onLoadDatasetVersion={loadDatasetVersion} /> : undefined}
        />
      )}
      {/* The power source picker portals to the body, so it works from either
          layout and outranks the drawers on compact. */}
      {isCompact ? <PowerSourceOverlay /> : <ModPowerPicker />}
      {/* Every pocket-to-shelf path (card save, share-a-pocket,
          overwrite) confirms through this one dialog. */}
      <BlueprintSaveDialog />
    </div>
  );
}

interface WorkspaceProps {
  workspace: ReturnType<typeof useWorkspaceView>;
  onLoadDatasetVersion: (versionId: string) => void;
  /** Desktop plan boards: the top bar, as the grid's first row over the overview and the board. */
  header?: ReactNode;
}

/**
 * Opens the left column whenever a resource is browsed: the recipe book
 * renders there, so with the column folded (a desktop rail or a closed phone
 * drawer) the answer would render into nothing. The resource is a fresh
 * object on every ask, so asking the same one twice opens the column twice.
 */
function RecipeBookOpener() {
  const browsedResource = useFactoryStore((state) => state.recipeBrowserResource);
  const isCompact = useIsCompactViewport();

  useEffect(() => {
    if (!browsedResource) {
      return;
    }
    // On a phone the two columns are drawers over the board, one at a time.
    writeWorkspaceView(
      isCompact ? { leftPanelOpen: true, rightPanelOpen: false } : { leftPanelOpen: true },
    );
    // A window narrow enough to have folded the column opens it for this.
    if (!isCompact) requestPanelOpen("items");
  }, [browsedResource, isCompact]);

  return null;
}

/**
 * On a phone, closes the drawer once something has been placed, since the
 * drawer covers the board the card landed on. The board flashes the new card
 * at the same moment (see FactoryFlow).
 */
function PlacementRevealer() {
  const placedBoardToken = useFactoryStore((state) => state.placedBoardToken);
  const isCompact = useIsCompactViewport();

  useEffect(() => {
    if (placedBoardToken === 0 || !isCompact) {
      return;
    }
    writeWorkspaceView({ leftPanelOpen: false, rightPanelOpen: false });
  }, [placedBoardToken, isCompact]);

  return null;
}

/** The board and its plan details, below the shared application bar. Memoised: the workspace around it re-renders when a column folds, never the board. */
const BoardColumn = memo(function BoardColumn() {
  const covering = useCoveringPage();
  const publicView = useDesignStore((state) => state.publicView);
  // The mod's bar renames in the tab menu and describes in the share box: no identity strip on a desktop board.
  const isCompact = useIsCompactViewport();
  // A task board is a plan of its own kind: its tasks cover the board like the Library does, and a plan that is not
  // one never shows tasks. Only with live plans configured (tasks come with them).
  const isTaskBoard = useFactoryStore((state) => state.project.primaryView === "tasks");
  const showTasks = TASKS_ENABLED && isTaskBoard && !covering;

  return (
    <div className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)]">
      <div className="min-w-0">
        {covering ? null : publicView ? <PublicViewBar key={publicView.id} /> : null}
        {covering ? null : <TabConflictNotice />}
        <LiveNotice />
      </div>
      {/*
        Welcome COVERS the board rather than replacing it: unmounting the board
        would throw away the camera, routed wires and solve.
      */}
      <div className="relative min-h-0">
        <FactoryFlow covered={Boolean(covering) || showTasks} />
        {TASKS_ENABLED ? <TaskLinkIndexController /> : null}
        {TASKS_ENABLED ? <AddToTaskMenu /> : null}
        {showTasks ? (
          <div className="absolute inset-0 z-30">
            <TaskBoard />
          </div>
        ) : covering === "network" ? (
          <div className="absolute inset-0 z-40"><NetworkPage /></div>
        ) : null}
        {/* The board's keys float over its top edge: no band, no space reserved. */}
        {covering ? null : <BoardToolbar />}
        {covering === "welcome" ? (
          <div className="absolute inset-0 z-40">
            <WelcomePage />
          </div>
        ) : covering === "shelf" ? (
          <div className="absolute inset-0 z-40">
            {isCompact ? <LibraryPage /> : <ModLibrary />}
          </div>
        ) : null}
      </div>
    </div>
  );
});

/**
 * Which page, if any, is covering the board. Welcome and the shelf never show
 * together. With NO design open the shelf is shown regardless of its flag,
 * because a board with no design behind it could not save an edit.
 */
function useCoveringPage(): "welcome" | "shelf" | "network" | undefined {
  const welcome = useWelcomeTab();
  const shelf = useLibraryTab();
  const networkId = useNetworkStore((state) => state.activeId);
  const isHydrated = useDesignStore((state) => state.isHydrated);
  const hasActiveDesign = useDesignStore((state) => state.activeDesignId !== undefined || state.publicView !== undefined);
  if (welcome.active) {
    return "welcome";
  }
  if (shelf.active) {
    return "shelf";
  }
  if (networkId) return "network";
  if (isHydrated && !hasActiveDesign) return "shelf";
  return undefined;
}

export function ColumnWorkspace({ workspace, onLoadDatasetVersion, header }: WorkspaceProps) {
  // While Welcome covers the board, the resource column (which reads the
  // hidden board's solve) folds to a blank strip WITHOUT writing the workspace
  // view, so it returns as it was.
  const covering = useCoveringPage();
  const poolMode = useFactoryStore((state) => state.project.poolMode === true);
  const planLayout = usePlanLayout();
  const worksheet = poolMode;
  // A task board has no overview (the game's): its columns take the overview's room too.
  const taskBoard = useFactoryStore((state) => TASKS_ENABLED && state.project.primaryView === "tasks");
  const settings = useDeviceSettings();
  const itemsLeft = settings.itemsLeft;
  const railOpen = useRailView().open;
  const hideBoardPanels = Boolean(covering) || worksheet || (taskBoard && planLayout);
  // Plan boards: the two side columns have the widths the player dragged them to and give way to the board as the
  // window narrows (src/lib/workspace-columns.ts, fitPanels); the grid is written onto `main` as the window resizes.
  const mainRef = useRef<HTMLElement>(null);
  const fit = usePanelFit(
    mainRef,
    {
      itemsOpen: workspace.leftPanelOpen,
      overviewOpen: railOpen,
      itemsWidth: settings.itemsWidth,
      overviewWidth: settings.overviewWidth,
      covering: hideBoardPanels,
      itemsLeft,
    },
    planLayout && covering !== "network",
  );
  const columns = planLayout
    ? covering === "network" ? { ...fit.initial, template: "0px minmax(0,1fr) 0px", leftPx: 0, rightPx: 0 } : fit.initial
    : workspaceColumns({
        itemsOpen: workspace.leftPanelOpen,
        inspectorOpen: workspace.rightPanelOpen,
        hideBoardPanels,
      });
  // Plan boards: which grid column the overview and the items take (the board is always the middle one).
  const overviewColumn = columns.itemsSide === "left" ? 3 : 1;
  const itemsColumn = columns.itemsSide === "left" ? 1 : 3;
  const itemsOpen = planLayout ? fit.itemsOpen : workspace.leftPanelOpen;
  // The handle sits on each column's board-side edge.
  const itemsEdge = columns.itemsSide === "left" ? "right" : "left";
  const overviewEdge = itemsEdge === "left" ? "right" : "left";

  const items = covering === "network" ? <div /> : itemsOpen ? (
    <ViewerAwareBrowser onLoadDatasetVersion={onLoadDatasetVersion} />
  ) : (
    <PanelRail side={columns.itemsSide} label="Items" />
  );
  const overview =
    covering || taskBoard ? (
      <div />
    ) : (
      <PlanOverview
        side={columns.itemsSide === "left" ? "right" : "left"}
        open={fit.overviewOpen}
        onOpen={() => requestPanelOpen("overview")}
      />
    );

  return (
    <>
      {/* The four-column item browser is 256px wide; the resource column
          keeps 234px for names, rates and controls. A closed column drops to a
          rail wide enough for one button, so the way back is always on screen
          and the board never has to give the width back to a hover target. */}
      <main
        ref={mainRef}
        data-items-side={columns.itemsSide}
        data-plan-layout={planLayout ? "" : undefined}
        data-left-px={columns.leftPx}
        data-right-px={columns.rightPx}
        className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden"
        style={{
          // Keep the toolbar's fit budget stable when Pool hides this column.
          "--toolbar-hidden-panel-width": worksheet && !covering
            ? `${workspace.rightPanelOpen ? INSPECTOR_WIDTH : PANEL_RAIL_WIDTH}px`
            : "0px",
          gridTemplateColumns: columns.template,
          ...(header ? { gridTemplateRows: "auto minmax(0,1fr)" } : {}),
        } as CSSProperties}
      >
        {/* The bar across the whole width, over the overview, the board and the items list alike, so it has all of
            it. Which side the overview and the items take is the settings' "Item browser". */}
        {header ? (
          <div className="min-w-0" style={{ gridColumn: "1 / 4", gridRow: 1 }}>
            {header}
          </div>
        ) : null}
        {/* Each column carries its own same-height header row. The browser
            owns its header, so it stays a direct grid item with no wrapper. */}
        {header ? (
          <>
            <div className="relative grid min-h-0 min-w-0" style={{ gridColumn: overviewColumn, gridRow: 2 }}>
              {overview}
              {fit.overviewOpen && !taskBoard ? (
                <SidePanelHandle panel="overview" edge={overviewEdge} fit={fit} />
              ) : null}
            </div>
            <div className="grid min-h-0 min-w-0" style={{ gridColumn: 2, gridRow: 2 }}>
              <BoardColumn />
            </div>
            <div className="relative grid min-h-0 min-w-0" style={{ gridColumn: itemsColumn, gridRow: 2 }}>
              {items}
              {itemsOpen ? <SidePanelHandle panel="items" edge={itemsEdge} fit={fit} /> : null}
            </div>
          </>
        ) : null}
        {header ? null : planLayout ? (columns.itemsSide === "left" ? items : overview) : items}
        {header ? null : <BoardColumn />}
        {header ? null : planLayout ? (
          columns.itemsSide === "left" ? overview : items
        ) : columns.inspectorShown ? (
          <InspectorPanel />
        ) : covering || worksheet ? null : (
          <PanelRail side="right" label="Resources" />
        )}
      </main>
    </>
  );
}

/** The handle on a side column's board-side edge: drag to set its width, double-click for the default. */
function SidePanelHandle({ panel, edge, fit }: { panel: SidePanel; edge: "left" | "right"; fit: PanelFitState }) {
  const items = panel === "items";
  return (
    <PanelHandle
      label={items ? "Resize the items list" : "Resize the overview"}
      edge={edge}
      getWidth={() => fit.widthOf(panel)}
      getLimits={() => fit.limitsOf(panel)}
      onStart={() => fit.setResizing(true)}
      onDrag={(width) => fit.preview(panel, width)}
      onCommit={(width) => writeDeviceSettings(items ? { itemsWidth: width } : { overviewWidth: width })}
      onReset={() =>
        writeDeviceSettings(items ? { itemsWidth: ITEMS_DEFAULT_WIDTH } : { overviewWidth: OVERVIEW_DEFAULT_WIDTH })
      }
      onEnd={() => fit.setResizing(false)}
    />
  );
}

/**
 * One column: the board, with the other two as drawers over it. Only one
 * drawer at a time, so opening either closes the other.
 */
export function CompactWorkspace({ workspace, onLoadDatasetVersion }: WorkspaceProps) {
  // The resource drawer reads the board's books; under a covering page it
  // is not there at all, handle included.
  const covering = useCoveringPage();
  const poolMode = useFactoryStore((state) => state.project.poolMode === true);
  const planLayout = usePlanLayout();
  const worksheet = poolMode;
  // Both flags can be set from a desktop session: a phone shows neither then (the board), never both at once.
  const bothOpen = workspace.leftPanelOpen && workspace.rightPanelOpen;
  const itemsOpen = workspace.leftPanelOpen && !bothOpen;
  const sideOpen = workspace.rightPanelOpen && !bothOpen;
  const openLeft = () => writeWorkspaceView({ leftPanelOpen: true, rightPanelOpen: false });
  const openRight = () => writeWorkspaceView({ leftPanelOpen: false, rightPanelOpen: true });

  // Each drawer keeps its flag (leftPanelOpen = items, rightPanelOpen =
  // resources or overview); plan boards swap the side each slides in from.
  return (
    <main
      data-items-side={planLayout ? "right" : "left"}
      data-plan-layout={planLayout ? "" : undefined}
      data-left-px={0}
      data-right-px={0}
      data-compact="true"
      className="relative min-h-0 flex-1 overflow-hidden"
    >
      <BoardColumn />
      <PanelDrawer
        side={planLayout ? "right" : "left"}
        label="items"
        width={ITEMS_WIDTH}
        open={itemsOpen}
        onOpen={openLeft}
        onClose={() => writeWorkspaceView({ leftPanelOpen: false })}
      >
        <ViewerAwareBrowser onLoadDatasetVersion={onLoadDatasetVersion} />
      </PanelDrawer>
      {covering || worksheet ? null : (
        <PanelDrawer
          side={planLayout ? "left" : "right"}
          label={planLayout ? "overview" : "resources"}
          width={INSPECTOR_WIDTH}
          open={sideOpen}
          onOpen={openRight}
          onClose={() => writeWorkspaceView({ rightPanelOpen: false })}
        >
          {planLayout ? <PlanOverview inDrawer /> : <InspectorPanel />}
        </PanelDrawer>
      )}
    </main>
  );
}

/** The task board comes with live plans; without them the app is exactly as before. */
const TASKS_ENABLED = isLiveConfigured();

/**
 * What a closed side column leaves behind: a 26px rail with the button that
 * reopens it and the column's name set sideways. A rail, not a hover-to-peek
 * edge, which fires by accident whenever the mouse crosses it.
 */
function PanelRail({ side, label }: { side: "left" | "right"; label: "Items" | "Resources" }) {
  // The flag follows what the column holds, not which side it sits on.
  const open = () => {
    writeWorkspaceView(label === "Items" ? { leftPanelOpen: true } : { rightPanelOpen: true });
    // A window narrow enough to have folded it keeps it open now.
    if (label === "Items") requestPanelOpen("items");
  };
  // The items column folds to the overview's own strip (the owner: both folded columns look and work the same).
  if (label === "Items") return <ColumnStrip label="ITEMS" open="Open the items" side={side} onOpen={open} />;

  // One button, the whole rail: a bare chevron at the top and the name
  // running down it. No box, no tooltip; the rail is the thing you click.
  return (
    <button
      type="button"
      onClick={open}
      aria-label={`Show ${label}`}
      className={[
        "flex h-full w-full flex-col items-center gap-2 bg-surface pt-1.5 text-fg-muted transition-colors hover:bg-[#2a2d33]",
        side === "left" ? "border-r border-line" : "border-l border-line",
      ].join(" ")}
    >
      {/* The one fold arrow (the overview's), pointing the way the column opens. */}
      <span className="flex h-6 w-6 shrink-0 items-center justify-center">
        <FoldGlyph direction={side === "left" ? "right" : "left"} />
      </span>
      <span
        aria-hidden
        className="min-h-0 flex-1 text-[12px] font-semibold uppercase tracking-widest"
        style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
      >
        <span className={side === "right" ? "rotate-180" : undefined}>{label}</span>
      </span>
    </button>
  );
}

function scheduleIdleWork(callback: () => void, timeout: number) {
  const browserWindow = window as Window &
    typeof globalThis & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

  if (browserWindow.requestIdleCallback && browserWindow.cancelIdleCallback) {
    const idleId = browserWindow.requestIdleCallback(callback, { timeout });
    return () => browserWindow.cancelIdleCallback?.(idleId);
  }

  const timeoutId = globalThis.setTimeout(callback, 0);
  return () => globalThis.clearTimeout(timeoutId);
}

function ViewerAwareBrowser({ onLoadDatasetVersion }: Pick<WorkspaceProps, "onLoadDatasetVersion">) {
  const readOnly = useFactoryStore(state => state.isReadOnly);
  if (!readOnly) return <RecipeBrowser onLoadDatasetVersion={onLoadDatasetVersion} />;
  return <div className="relative h-full min-h-0 overflow-hidden">
    <div inert className="h-full opacity-30 grayscale"><RecipeBrowser onLoadDatasetVersion={onLoadDatasetVersion} /></div>
    <ViewOnlyNotice />
  </div>;
}

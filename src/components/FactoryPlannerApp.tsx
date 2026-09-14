"use client";

import { resolveProjectRecipes } from "@/lib/datasets/refresh-project-recipes";
import { useCallback, useEffect, useRef, type CSSProperties } from "react";
import {
  DEFAULT_DATASET_MANIFEST_URL,
  fetchDatasetManifest,
  pickDefaultDatasetVersion,
} from "@/lib/datasets";
import {
  initRecipeDatasetVersion,
} from "@/lib/datasets/browser-loader";
import { loadResourceHistory, useFactoryStore } from "@/store/factory-store";
import { useCommunityAuthStore } from "@/store/community-auth-store";
import { useDesignStore } from "@/store/design-store";
import { recordResourceTrend, resetResourceTrends } from "@/lib/resource-trends";
import { useWorkspaceView, writeWorkspaceView } from "@/lib/workspace-view";
import { openCommunityPost } from "@/lib/community/open-post";
import { retryPendingPostFollows } from "@/lib/community/post-follow";
import { forgetSharedPlanId, readSharedPlanId, syncSharedPlanAddress } from "@/lib/community/shared-link";
import { useIsCompactViewport } from "@/lib/compact-view";
import { startLibrarySync } from "@/lib/library/library-sync";
import { useLibraryTab } from "@/lib/library/library-tab";
import { useWelcomeTab } from "@/lib/welcome/welcome-tab";
import { AppHeader } from "./AppHeader";
import { LibraryPage } from "./library/LibraryPage";
import { WelcomePage } from "./welcome/WelcomePage";
import { PlanIdentityDrawer } from "./PlanIdentityDrawer";
import { SharedAddressSync } from "./SharedAddressSync";
import { PublicViewBar } from "./community/PublicViewBar";
import { BlueprintSaveDialog } from "./BlueprintSaveDialog";
import { PowerSourceOverlay } from "./PowerSourceOverlay";
import { FactoryFlow } from "./flow/FactoryFlow";
import { useBoardSoundEffects } from "./flow/use-board-sound-effects";
import { InspectorPanel } from "./InspectorPanel";
import { PanelDrawer } from "./PanelDrawer";
import { RecipeBrowser } from "./RecipeBrowser";

export function FactoryPlannerApp() {
  const project = useFactoryStore((state) => state.project);
  const lastResult = useFactoryStore((state) => state.lastResult);
  const workspace = useWorkspaceView();
  const isCompact = useIsCompactViewport();
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
  // Which stored recipes have been checked against which dataset version,
  // so a design opened AFTER the dataset landed (a tab switch, a hydrated
  // plan) gets the same refresh the boot load gives, exactly once each.
  const checkedRecipesRef = useRef<Set<string>>(new Set());
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
    const pending = project.recipes.filter(
      (recipe) => !checkedRecipesRef.current.has(`${version.id}|${recipe.id}`),
    );
    if (pending.length === 0) {
      return;
    }
    for (const recipe of pending) {
      checkedRecipesRef.current.add(`${version.id}|${recipe.id}`);
    }
    let cancelled = false;
    void resolveProjectRecipes(
      datasetManifestUrl ?? DEFAULT_DATASET_MANIFEST_URL,
      version,
      pending,
    ).then(({ refreshed, migration }) => {
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
          checkedRecipesRef.current = new Set(
            projectRecipes.map((recipe) => `${version.id}|${recipe.id}`),
          );
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
            // Own posts open for editing; everyone else's opens for viewing.
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

  // The library follows the account: sign-in starts the sync, sign-out stops
  // it, and every change here reaches the other devices a few seconds later.
  useEffect(() => startLibrarySync(), []);

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

  // Posts edited while signed out catch up the moment an account is back.
  const communityUser = useCommunityAuthStore((state) => state.user);
  useEffect(() => {
    if (communityUser) {
      retryPendingPostFollows();
    }
  }, [communityUser]);

  return (
    // Height in --ui-dvh (dvh over the interface size, see ui-scale.ts: the
    // shell is CSS-zoomed and viewport units are not divided by zoom), and
    // dvh, not vh: a phone browser's address bar comes and goes, and
    // `vh` measures the window as if it never did, so the bottom row of the
    // board spent its life under the chrome.
    //
    // And no minimum height. It used to guarantee 720px for the three columns,
    // which on a laptop window ~660px tall meant the app was taller than the
    // window: the page itself scrolled, the board's bottom toolbars sat below the
    // fold, and a classic scrollbar appeared and threw off every measurement made
    // against `window.innerWidth`. The board and the panels carry their own
    // floors, which is where the guarantee belongs.
    <div className="ui-scale-shell flex h-[calc(100*var(--ui-dvh))] flex-col bg-canvas text-fg">
      <RecipeBookOpener />
      <PlacementRevealer />
      <SharedAddressSync />
      <AppHeader onLoadDatasetVersion={loadDatasetVersion} />
      {isCompact ? (
        <CompactWorkspace workspace={workspace} onLoadDatasetVersion={loadDatasetVersion} />
      ) : (
        <ColumnWorkspace workspace={workspace} onLoadDatasetVersion={loadDatasetVersion} />
      )}
      {/* The power source picker portals to the body, so it works from either
          layout and outranks the drawers on compact. */}
      <PowerSourceOverlay />
      {/* Every pocket-to-shelf path (card save, share-a-pocket,
          overwrite) confirms through this one dialog. */}
      <BlueprintSaveDialog />
    </div>
  );
}

interface WorkspaceProps {
  workspace: ReturnType<typeof useWorkspaceView>;
  onLoadDatasetVersion: (versionId: string) => void;
}

/**
 * Asking what makes a resource has to bring its own window with it.
 *
 * The recipe book lives in the left column, and every way of asking — a click or
 * R on a port row, a storage drawer, a slot in the book itself — only wrote the
 * question into the store. With that column folded away (a rail on the desktop, a
 * closed drawer on a phone) the answer was rendering into nothing, so clicking a
 * slot appeared to do nothing at all. The column is the answer's window; opening
 * it is part of answering.
 *
 * The resource is a fresh object on every ask, so asking the same one twice opens
 * the column twice.
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
  }, [browsedResource, isCompact]);

  return null;
}

/**
 * The other half of that bargain: once something has actually been placed, the
 * drawer that placed it gets out of the way.
 *
 * Only on a phone, where a drawer covers the board it just added a card to — the
 * card lands, and you are looking at the panel you added it from. On a desktop the
 * columns sit beside the board and there is nothing to move out of.
 *
 * The board flashes the new card at the same moment (see FactoryFlow), which is
 * what makes the two read as one event rather than the panel simply vanishing.
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

/** The board and its plan details, below the shared application bar. */
function BoardColumn() {
  const covering = useCoveringPage();
  const publicView = useDesignStore((state) => state.publicView);

  return (
    <div className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)]">
      <div className="min-w-0">
        {covering ? null : publicView ? <PublicViewBar key={publicView.id} /> : <PlanIdentityDrawer />}
      </div>
      {/*
        Welcome COVERS the board rather than replacing it. Unmounting the board
        would throw away the camera, the routed wires and the solve, and put
        them all back a moment later for a page that is only ever a click from
        being stepped off.
      */}
      <div className="relative min-h-0">
        <FactoryFlow />
        {covering === "welcome" ? (
          <div className="absolute inset-0 z-40">
            <WelcomePage />
          </div>
        ) : covering === "shelf" ? (
          <div className="absolute inset-0 z-40">
            <LibraryPage />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Which page, if any, is covering the board. Welcome and the shelf never
 * show together (opening one steps the other down), and with NO design open
 * at all the shelf is shown whatever its own flag says: an empty strip has
 * nothing else to stand on, and a board with no design behind it could not
 * save an edit anywhere.
 */
function useCoveringPage(): "welcome" | "shelf" | undefined {
  const welcome = useWelcomeTab();
  const shelf = useLibraryTab();
  const isHydrated = useDesignStore((state) => state.isHydrated);
  const hasActiveDesign = useDesignStore((state) => state.activeDesignId !== undefined || state.publicView !== undefined);
  if (welcome.active) {
    return "welcome";
  }
  if (shelf.active || (isHydrated && !hasActiveDesign)) {
    return "shelf";
  }
  return undefined;
}

function ColumnWorkspace({ workspace, onLoadDatasetVersion }: WorkspaceProps) {
  // The resource column reads the board's solve, and while Welcome covers the
  // board those figures belong to whichever tab is hidden underneath — numbers
  // about a plan you are not looking at. It folds to a blank strip for the
  // duration, WITHOUT writing the workspace view, so stepping off Welcome
  // brings it back exactly as it was left.
  const covering = useCoveringPage();
  const poolMode = useFactoryStore((state) => state.project.poolMode === true);
  const worksheet = poolMode;
  const rightPanelShown = workspace.rightPanelOpen && !covering && !worksheet;

  return (
    <>
      {/* The four-column item browser is 256px wide; the resource column
          keeps 234px for names, rates and controls. A closed column drops to a
          rail wide enough for one button, so the way back is always on screen
          and the board never has to give the width back to a hover target. */}
      <main
        className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden"
        style={{
          // Keep the toolbar's fit budget stable when Pool hides this column.
          "--toolbar-hidden-panel-width": worksheet && !covering
            ? `${workspace.rightPanelOpen ? 234 : RAIL_WIDTH}px`
            : "0px",
          gridTemplateColumns: [
            workspace.leftPanelOpen ? "256px" : `${RAIL_WIDTH}px`,
            "minmax(0,1fr)",
            // With a page over the board the resource column is not folded, it is
            // GONE: nothing to open, no rail to hint that there is.
            rightPanelShown ? "234px" : covering || worksheet ? "0px" : `${RAIL_WIDTH}px`,
          ].join(" "),
        } as CSSProperties}
      >
        {/* Each column carries its own header row, all the same height, so the
            three line up where the full-width bar used to be. */}
        {/* The browser owns its own header row, so no wrapper here — it stays a
            direct grid item at exactly the column width, as it was before. */}
        {workspace.leftPanelOpen ? (
          <ViewerAwareBrowser onLoadDatasetVersion={onLoadDatasetVersion} />
        ) : (
          <PanelRail side="left" label="Items" />
        )}
        <BoardColumn />
        {rightPanelShown ? (
          <InspectorPanel />
        ) : covering || worksheet ? null : (
          <PanelRail side="right" label="Resources" />
        )}
      </main>
    </>
  );
}

/**
 * One column: the board, with the other two as drawers over it.
 *
 * Only one drawer at a time — two of them on a 390px screen is a stack of
 * panels with no board left to point at — so opening either closes the other.
 */
function CompactWorkspace({ workspace, onLoadDatasetVersion }: WorkspaceProps) {
  // The resource drawer reads the board's books; under a covering page it
  // is not there at all, handle included.
  const covering = useCoveringPage();
  const poolMode = useFactoryStore((state) => state.project.poolMode === true);
  const worksheet = poolMode;
  const openLeft = () => writeWorkspaceView({ leftPanelOpen: true, rightPanelOpen: false });
  const openRight = () => writeWorkspaceView({ leftPanelOpen: false, rightPanelOpen: true });

  return (
    <main className="relative min-h-0 flex-1 overflow-hidden">
      <BoardColumn />
      <PanelDrawer
        side="left"
        label="items"
        open={workspace.leftPanelOpen}
        onOpen={openLeft}
        onClose={() => writeWorkspaceView({ leftPanelOpen: false })}
      >
        <ViewerAwareBrowser onLoadDatasetVersion={onLoadDatasetVersion} />
      </PanelDrawer>
      {covering || worksheet ? null : (
        <PanelDrawer
          side="right"
          label="resources"
          open={workspace.rightPanelOpen}
          onOpen={openRight}
          onClose={() => writeWorkspaceView({ rightPanelOpen: false })}
        >
          <InspectorPanel />
        </PanelDrawer>
      )}
    </main>
  );
}

/** Wide enough for one 24px button plus its border. */
const RAIL_WIDTH = 26;

/**
 * What a closed side column leaves behind: a rail carrying the button that
 * opens it again, plus the column's name set sideways.
 *
 * A rail rather than a hover-to-peek edge. Peeking hands the column back for
 * as long as the pointer stays put, which makes it useless for anything you
 * want to read while working on the board, and it fires by accident every time
 * the mouse crosses the edge. A rail costs 26px and is never ambiguous.
 */
function PanelRail({ side, label }: { side: "left" | "right"; label: string }) {
  const open = () =>
    writeWorkspaceView(side === "left" ? { leftPanelOpen: true } : { rightPanelOpen: true });

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
      {/* One drawing for both sides, mirrored, so they cannot differ. */}
      <span className="flex h-6 w-6 shrink-0 items-center justify-center">
        <svg
          viewBox="0 0 16 16"
          className={["h-4 w-4", side === "left" ? "" : "rotate-180"].join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6 3l5 5-5 5" />
        </svg>
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
    <div className="absolute inset-x-2 top-2 border border-line bg-surface p-3 text-sm shadow-lg">
      <div className="flex items-center justify-between gap-2"><strong>View only</strong>
        <button type="button" aria-label="Hide the items column" onClick={() => writeWorkspaceView({ leftPanelOpen: false })} className="px-2">‹</button>
      </div>
      <p className="mt-1 text-xs text-fg-muted">Open a copy to add items and edit this setup.</p>
    </div>
  </div>;
}

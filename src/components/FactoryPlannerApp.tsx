"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  DEFAULT_DATASET_MANIFEST_URL,
  fetchDatasetManifest,
  pickDefaultDatasetVersion,
} from "@/lib/datasets";
import {
  getRecipeDatasetRecipe,
  initRecipeDatasetVersion,
} from "@/lib/datasets/browser-loader";
import { loadResourceHistory, useFactoryStore } from "@/store/factory-store";
import { useDesignStore } from "@/store/design-store";
import { recordResourceTrend, resetResourceTrends } from "@/lib/resource-trends";
import { applyPlanView } from "@/lib/plan-view";
import { useWorkspaceView, writeWorkspaceView } from "@/lib/workspace-view";
import { downloadCommunityPlan, tagPlanWithCommunityId } from "@/lib/community/client";
import { forgetSharedPlanId, readSharedPlanId } from "@/lib/community/shared-link";
import { parseFactoryProjectJson } from "@/lib/import-export";
import { useIsCompactViewport } from "@/lib/compact-view";
import { useWelcomeTab } from "@/lib/tour/welcome-tab";
import { AppHeader } from "./AppHeader";
import { TourOverlay } from "./tour/TourOverlay";
import { WelcomePage } from "./tour/WelcomePage";
import { PlanIdentityDrawer } from "./PlanIdentityDrawer";
import { SharedAddressSync } from "./SharedAddressSync";
import { planContentFingerprint } from "@/lib/community/plan-fingerprint";
import { BlueprintSaveDialog } from "./BlueprintSaveDialog";
import { DesignTabs } from "./DesignTabs";
import { FactoryFlow } from "./flow/FactoryFlow";
import { InspectorPanel } from "./InspectorPanel";
import { ChevronIcon, PanelDrawer } from "./PanelDrawer";
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
          const refreshedRecipes = (
            await Promise.allSettled(
              projectRecipes.map((recipe) =>
                getRecipeDatasetRecipe(manifestUrl, version, recipe.id),
              ),
            )
          )
            .filter((result): result is PromiseFulfilledResult<(typeof projectRecipes)[number]> => {
              return result.status === "fulfilled";
            })
            .map((result) => result.value);
          refreshProjectRecipes(refreshedRecipes);
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
          // A setup opened from a shared link becomes its own design tab, so
          // it never overwrites whatever the user was working on.
          const importAsDesign = async (raw: unknown, postName: string) => {
            const project = parseFactoryProjectJson(JSON.stringify(raw));
            // Named after the POST, which is the only name the person who
            // followed the link has ever seen. A plan carries whatever its
            // author happened to have that tab called, and "Untitled design"
            // is common enough that a setup sent to you would land looking
            // like a blank one.
            await useDesignStore
              .getState()
              .importProjectAsDesign(project, postName || project.name || "Shared setup");
            // A shared link opens the setup the way its author arranged it,
            // same as opening one from the shelf.
            applyPlanView(project.view);
          };

          try {
            // Shared "open to edit" links: /?plan=<community id>.
            const sharedPlanId = readSharedPlanId();
            // The address carries the id while an open board still matches
            // its post (see SharedAddressSync), so a reload arrives with the
            // id of the very setup it is standing on. That is a reload, not
            // an arrival: importing would open one duplicate tab per F5. A
            // drifted or unproven copy still imports fresh - a pasted link
            // means "show me the posted version".
            const restingProject = useFactoryStore.getState().project;
            const alreadyStandingOnIt =
              sharedPlanId !== undefined &&
              restingProject.metadata?.communityPlanId === sharedPlanId &&
              Boolean(restingProject.metadata.communityFingerprint) &&
              planContentFingerprint(restingProject) ===
                restingProject.metadata.communityFingerprint;
            if (sharedPlanId && !alreadyStandingOnIt) {
              try {
                const { plan, name } = await downloadCommunityPlan(sharedPlanId);
                await importAsDesign(tagPlanWithCommunityId(plan, sharedPlanId), name);
              } finally {
                // The sync re-advertises the imported copy on its own; this
                // is for the failure path, so a dead link is not retried on
                // every reload.
                forgetSharedPlanId();
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
    // h-dvh, not h-screen: a phone browser's address bar comes and goes, and
    // `vh` measures the window as if it never did, so the bottom row of the
    // board spent its life under the chrome.
    //
    // And no minimum height. It used to guarantee 720px for the three columns,
    // which on a laptop window ~660px tall meant the app was taller than the
    // window: the page itself scrolled, the board's bottom toolbars sat below the
    // fold, and a classic scrollbar appeared and threw off every measurement made
    // against `window.innerWidth`. The board and the panels carry their own
    // floors, which is where the guarantee belongs.
    <div className="flex h-dvh flex-col bg-canvas text-fg">
      <RecipeBookOpener />
      <PlacementRevealer />
      <SharedAddressSync />
      <AppHeader onLoadDatasetVersion={loadDatasetVersion} />
      {isCompact ? (
        <CompactWorkspace workspace={workspace} onLoadDatasetVersion={loadDatasetVersion} />
      ) : (
        <ColumnWorkspace workspace={workspace} onLoadDatasetVersion={loadDatasetVersion} />
      )}
      {/* Every pocket-to-shelf path (card save, share-a-pocket,
          overwrite) confirms through this one dialog. */}
      <BlueprintSaveDialog />
      {/* A running tour points at the toolbars and columns above, so it hangs
          off the app root and portals to the body from there. */}
      <TourOverlay />
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

/** The board with the tab strip over it: the same on any window. */
function BoardColumn() {
  const welcome = useWelcomeTab();

  return (
    /*
      The tab strip belongs to the canvas, not the window: designs switch
      what is on the board, while the browser and inspector are fixed
      furniture. Rows rather than flex so the board keeps its `h-full`.
    */
    <div className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto]">
      <DesignTabs />
      {/*
        Welcome COVERS the board rather than replacing it. Unmounting the board
        would throw away the camera, the routed wires and the solve, and put
        them all back a moment later for a page that is only ever a click from
        being stepped off - and a tour started from that page has to point at
        the board underneath it.
      */}
      <div className="relative min-h-0">
        <FactoryFlow />
        {welcome.active ? (
          <div className="absolute inset-0 z-40">
            <WelcomePage />
          </div>
        ) : null}
      </div>
      {/* The plan card describes the board it sits under; while Welcome
          covers that board, the card goes with it. */}
      {welcome.active ? null : <PlanIdentityDrawer />}
    </div>
  );
}

function ColumnWorkspace({ workspace, onLoadDatasetVersion }: WorkspaceProps) {
  return (
    <>
      {/* 344/332: the browser column carries three iconed tabs and the setup
          shelf, so it gets a touch more than the old 312; the resource column
          went from 277 to fit a rate, a name and the mark buttons on one line
          without the name truncating to nothing. A closed column drops to a
          rail wide enough for one button, so the way back is always on screen
          and the board never has to give the width back to a hover target. */}
      <main
        className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden"
        style={{
          gridTemplateColumns: [
            workspace.leftPanelOpen ? "344px" : `${RAIL_WIDTH}px`,
            "minmax(0,1fr)",
            workspace.rightPanelOpen ? "332px" : `${RAIL_WIDTH}px`,
          ].join(" "),
        }}
      >
        {/* Each column carries its own header row, all the same height, so the
            three line up where the full-width bar used to be. */}
        {/* The browser owns its own header row, so no wrapper here — it stays a
            direct grid item at exactly the column width, as it was before. */}
        {workspace.leftPanelOpen ? (
          <RecipeBrowser onLoadDatasetVersion={onLoadDatasetVersion} />
        ) : (
          <PanelRail side="left" label="Items, pockets and setups" />
        )}
        <BoardColumn />
        {workspace.rightPanelOpen ? (
          <InspectorPanel />
        ) : (
          <PanelRail side="right" label="Resources and machines" />
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
  const openLeft = () => writeWorkspaceView({ leftPanelOpen: true, rightPanelOpen: false });
  const openRight = () => writeWorkspaceView({ leftPanelOpen: false, rightPanelOpen: true });

  return (
    <main className="relative min-h-0 flex-1 overflow-hidden">
      <BoardColumn />
      <PanelDrawer
        side="left"
        label="items, pockets and setups"
        open={workspace.leftPanelOpen}
        onOpen={openLeft}
        onClose={() => writeWorkspaceView({ leftPanelOpen: false })}
      >
        <RecipeBrowser onLoadDatasetVersion={onLoadDatasetVersion} />
      </PanelDrawer>
      <PanelDrawer
        side="right"
        label="resources and machines"
        open={workspace.rightPanelOpen}
        onOpen={openRight}
        onClose={() => writeWorkspaceView({ rightPanelOpen: false })}
      >
        <InspectorPanel />
      </PanelDrawer>
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

  return (
    <div
      className={[
        "flex h-full flex-col items-center gap-2 bg-surface py-2",
        side === "left" ? "border-r border-line" : "border-l border-line",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={open}
        title={`Show ${label}`}
        aria-label={`Show ${label}`}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-line-strong text-fg-muted hover:border-cyan-600 hover:text-cyan-400"
      >
        <ChevronIcon direction={side === "left" ? "right" : "left"} />
      </button>
      <button
        type="button"
        onClick={open}
        tabIndex={-1}
        aria-hidden
        className="min-h-0 flex-1 cursor-pointer text-[10px] font-semibold uppercase tracking-widest text-fg-muted hover:text-fg"
        style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
      >
        <span className={side === "right" ? "rotate-180" : undefined}>{label}</span>
      </button>
    </div>
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

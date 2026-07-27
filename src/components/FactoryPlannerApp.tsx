"use client";

import { Users } from "lucide-react";
import Link from "next/link";
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
import { downloadCommunityPlan, takePendingEditorImport } from "@/lib/community/client";
import { parseFactoryProjectJson } from "@/lib/import-export";
import { useThemeStore } from "@/store/theme-store";
import { BoardActions } from "./BoardActions";
import { AccountMenu } from "./community/AccountMenu";
import { DesignTabs } from "./DesignTabs";
import { FactoryFlow } from "./flow/FactoryFlow";
import { InspectorPanel } from "./InspectorPanel";
import { RecipeBrowser } from "./RecipeBrowser";

export function FactoryPlannerApp() {
  const project = useFactoryStore((state) => state.project);
  const hydrateResourceHistory = useFactoryStore((state) => state.hydrateResourceHistory);
  const hydrateDesigns = useDesignStore((state) => state.hydrate);
  const saveActiveProject = useDesignStore((state) => state.saveActiveProject);
  const activeDesignId = useDesignStore((state) => state.activeDesignId);
  const setDatasetManifest = useFactoryStore((state) => state.setDatasetManifest);
  const setDataset = useFactoryStore((state) => state.setDataset);
  const refreshProjectRecipes = useFactoryStore((state) => state.refreshProjectRecipes);
  const setDatasetLoading = useFactoryStore((state) => state.setDatasetLoading);
  const setDatasetError = useFactoryStore((state) => state.setDatasetError);
  const syncThemeFromDocument = useThemeStore((state) => state.syncThemeFromDocument);
  const hydratedRef = useRef(false);
  const skipInitialSaveRef = useRef(true);
  const saveTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    syncThemeFromDocument();
  }, [syncThemeFromDocument]);

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
          // A plan handed off from the community hub becomes its own design
          // tab, so it never overwrites whatever the user was working on.
          const importAsDesign = async (raw: unknown) => {
            const project = parseFactoryProjectJson(JSON.stringify(raw));
            await useDesignStore
              .getState()
              .importProjectAsDesign(project, project.name || "Community plan");
          };

          try {
            const pending = takePendingEditorImport();
            if (pending) {
              await importAsDesign(pending);
              return;
            }

            // Shared "open to edit" links: /?plan=<community id>.
            const params = new URLSearchParams(window.location.search);
            const sharedPlanId = params.get("plan");
            if (sharedPlanId) {
              try {
                const { plan } = await downloadCommunityPlan(sharedPlanId);
                await importAsDesign(plan);
              } finally {
                params.delete("plan");
                const query = params.toString();
                window.history.replaceState(
                  null,
                  "",
                  `${window.location.pathname}${query ? `?${query}` : ""}`,
                );
              }
            }
          } catch (error) {
            console.error(
              error instanceof Error ? error.message : "Importing the community plan failed.",
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
    <div className="flex h-screen min-h-[720px] flex-col bg-canvas text-fg">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-3 py-1.5">
        <h1 className="text-sm font-bold tracking-tight">
          GTNH <span className="text-cyan-500">Planner</span>
        </h1>
        <div className="flex items-center gap-2">
          <BoardActions />
          <Link
            href="/community"
            className="inline-flex h-7 items-center gap-1.5 rounded border border-cyan-700 bg-cyan-600 px-3 text-sm font-semibold text-white hover:bg-cyan-500"
          >
            <Users className="h-3.5 w-3.5" /> Community
          </Link>
          <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
          <AccountMenu />
        </div>
      </header>
      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[360px_minmax(0,1fr)_440px]">
        {/* Each column carries its own header row, all the same height, so the
            three line up where the full-width bar used to be. */}
        {/* The browser owns its own header row, so no wrapper here — it stays a
            direct grid item at exactly the column width, as it was before. */}
        <RecipeBrowser onLoadDatasetVersion={loadDatasetVersion} />
        {/*
          The tab strip belongs to the canvas, not the window: designs switch
          what is on the board, while the browser and inspector are fixed
          furniture. Rows rather than flex so the board keeps its `h-full`.
        */}
        <div className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)]">
          <DesignTabs />
          <FactoryFlow />
        </div>
        <InspectorPanel />
      </main>
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

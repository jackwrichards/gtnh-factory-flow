"use client";

import { useEffect, useState } from "react";
import type { FactoryProject } from "@/lib/model/types";
import { normalizeLoadedProject } from "@/lib/model/project-normalize";
import { recipeSchema } from "@/lib/model/schemas";
import { CELL_WIRE_TANK_RECIPE_PREFIX } from "@/lib/model/cell-wires";
import { readDesign } from "@/lib/designs/design-storage";
import { DEFAULT_DATASET_MANIFEST_URL } from "@/lib/datasets";
import { parseFactoryProjectJson } from "@/lib/import-export";
import { useCloudLibraryStore } from "@/lib/library/cloud-library";
import { isDatasetRecipe, resolveProjectRecipes } from "@/lib/datasets/refresh-project-recipes";
import { withRefreshedRecipes } from "@/lib/datasets/apply-refreshed-recipes";
import { useFactoryStore } from "@/store/factory-store";
import { useDesignStore } from "@/store/design-store";
import { useNetworkStore } from "@/store/network-store";
import { memberKey, type NetworkMember, type PlanFlows } from "./model";
import { planFlows } from "./plan-flows";

let worker: Worker | undefined;
let queue = Promise.resolve();
const cache = new Map<string, PlanFlows>();

function runWorker(project: FactoryProject): Promise<PlanFlows> {
  return new Promise((resolve, reject) => {
    const finish = (result?: PlanFlows, error?: string) => {
      clearTimeout(timer);
      if (error) {
        worker?.terminate();
        worker = undefined;
        reject(new Error(error));
      } else resolve(result!);
    };
    const timer = setTimeout(
      () => finish(undefined, "Calculation timed out. Retry this plan."),
      180_000,
    );
    try {
      worker ??= new Worker(new URL("./calculate.worker.ts", import.meta.url));
      worker.onmessage = ({ data }: MessageEvent<{ result?: PlanFlows; error?: string }>) =>
        finish(data.result, data.error);
      worker.onerror = () => finish(undefined, "Calculation unavailable. Retry this plan.");
      worker.postMessage(project);
    } catch (error) {
      finish(undefined, String(error));
    }
  });
}

function calculate(project: FactoryProject): Promise<PlanFlows> {
  const task = queue.then(() => runWorker(project));
  // A failed member must not prevent the remaining members from being calculated.
  queue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

export function localDesignId(member: NetworkMember): string {
  return member.ownerId ? `shared-${member.ownerId}-${member.designId}` : member.designId;
}

export function useNetworkCalculations(retry: number): ReadonlyMap<string, PlanFlows> {
  const networks = useNetworkStore((state) => state.catalogue?.networks);
  const designs = useDesignStore((state) => state.designs);
  const activeId = useDesignStore((state) => state.activeDesignId);
  const canvas = useFactoryStore((state) => state.project);
  const result = useFactoryStore((state) => state.lastResult);
  const manifest = useFactoryStore((state) => state.datasetManifest);
  const manifestUrl = useFactoryStore((state) => state.datasetManifestUrl);
  const versionId = useFactoryStore((state) => state.dataset?.datasetVersionId);
  const shared = useCloudLibraryStore((state) => state.shared);
  const [flows, setFlows] = useState<Map<string, PlanFlows>>(() => new Map());
  // Port choices and hierarchy edits only aggregate existing solves.
  const calculationMembers = JSON.stringify(
    (networks ?? []).flatMap((network) =>
      network.members
        .filter((member) => member.included)
        .map(({ designId, ownerId, name }) => ({ designId, ownerId, name })),
    ),
  );
  useEffect(() => {
    let cancelled = false;
    const members = JSON.parse(calculationMembers) as NetworkMember[];
    const publish = (key: string, flow: PlanFlows) => {
      if (!cancelled) setFlows((previous) => new Map(previous).set(key, flow));
    };
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setFlows(
        (previous) => new Map([...previous].map(([key, flow]) => [key, { ...flow, stale: true }])),
      );
      for (const member of members) {
        if (cancelled) return;
        const key = memberKey(member);
        const id = localDesignId(member);
        const summary = designs.find((entry) => entry.id === id);
        const remote = member.ownerId
          ? shared?.find(
              (entry) => entry.ownerId === member.ownerId && entry.id === member.designId,
            )
          : undefined;
        if ((!summary && !remote) || summary?.taskBoard) {
          publish(key, { materials: [], power: { used: 0, made: 0 }, error: "Plan unavailable" });
          continue;
        }
        if (id === activeId && result && !result.stale) {
          publish(key, planFlows(canvas, result));
          continue;
        }
        try {
          let record: { project: FactoryProject; updatedAt: string } | undefined =
            await readDesign(id);
          if (remote) {
            const response = await fetch(
              `/api/library/designs/${encodeURIComponent(member.designId)}?owner=${encodeURIComponent(member.ownerId!)}`,
              { cache: "no-store" },
            );
            const body = await response.json();
            if (!response.ok) throw new Error(body.error ?? "Plan unavailable");
            record = {
              project: parseFactoryProjectJson(JSON.stringify(body.plan)),
              updatedAt: remote.updatedAt,
            };
          }
          if (!record) throw new Error("Plan unavailable");
          const version = manifest?.versions.find(
            (entry) =>
              entry.id ===
              (record.project.recipes.find((recipe) => recipe.source?.datasetVersionId)?.source
                ?.datasetVersionId ?? versionId),
          );
          const cacheKey = JSON.stringify([
            id,
            record.updatedAt,
            record.project,
            version,
            manifestUrl,
            retry,
          ]);
          const cached = cache.get(cacheKey);
          if (cached) {
            publish(key, cached);
            continue;
          }
          let project = normalizeLoadedProject(record.project);
          const asked = project.recipes.filter(isDatasetRecipe);
          if (asked.length) {
            // Game recipes carry their own bodies and need not exist in the website dataset.
            // Dataset recipes still require restoration so slim exports never silently use fallback math.
            const hasStandaloneBody = (recipe: (typeof asked)[number]) =>
              (recipe.id.startsWith("gtnhplanner:") ||
                recipe.id.startsWith(CELL_WIRE_TANK_RECIPE_PREFIX)) &&
              recipeSchema.safeParse(recipe).success;
            if (!version && asked.some((recipe) => !hasStandaloneBody(recipe)))
              throw new Error("Recipe dataset unavailable");
            const { refreshed, migration } = version
              ? await resolveProjectRecipes(
                  manifestUrl ?? DEFAULT_DATASET_MANIFEST_URL,
                  version,
                  asked,
                )
              : { refreshed: [], migration: {} as Record<string, string> };
            const found = new Set(refreshed.map((recipe) => recipe.id));
            if (
              asked.some(
                (recipe) =>
                  !found.has(migration[recipe.id] ?? recipe.id) && !hasStandaloneBody(recipe),
              )
            )
              throw new Error(
                "Recipes could not be restored. Retry when the dataset is available.",
              );
            project = withRefreshedRecipes(project, refreshed, migration);
          }
          if (cancelled) return;
          const answer = await calculate(project);
          if (!answer.error) {
            cache.set(cacheKey, answer);
            if (cache.size > 100) cache.delete(cache.keys().next().value!);
          }
          publish(key, answer);
        } catch (error) {
          publish(key, {
            materials: [],
            power: { used: 0, made: 0 },
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    calculationMembers,
    designs,
    activeId,
    canvas,
    result,
    manifest,
    manifestUrl,
    versionId,
    shared,
    retry,
  ]);
  return flows;
}

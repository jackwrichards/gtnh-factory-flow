"use client";

import { create } from "zustand";
import { decodePlanCode, readPlanCodeFromHash } from "@/lib/import-export/plan-code";
import { planFingerprints, FINGERPRINT_VERSION } from "@/lib/import-export/import-fingerprint";
import { listDesignSummaries, readDesign } from "@/lib/designs/design-storage";
import { ensurePlanFingerprintMigration } from "@/lib/designs/fingerprint-migration";
import { leaveWelcomeTab } from "@/lib/welcome/welcome-tab";
import type { FactoryProject } from "@/lib/model/types";
import { applyPlanView } from "@/lib/plan-view";
import { looksLikePlanJson, openPlanJsonText } from "@/lib/import-export/open-plan-file";
import { captureDesignUpdateGuard, useDesignStore } from "@/store/design-store";

export interface RelatedPlan {
  id: string;
  name: string;
  full: string;
}
export interface PlanImportNotice {
  kind: "existing" | "related";
  designId: string;
  name: string;
  project: FactoryProject;
  full: string;
  related: RelatedPlan[];
}
export const usePlanImportNotice = create<{ notice?: PlanImportNotice }>(() => ({}));
export function dismissPlanImportNotice(): void {
  usePlanImportNotice.setState({ notice: undefined });
}

/** Compare current saved content, never overwrite a plan on arrival. */
export async function openPlanCode(text: string): Promise<void> {
  if (looksLikePlanJson(text)) {
    await openPlanJsonText(text);
    return;
  }
  const project = await decodePlanCode(text);
  const fingerprints = await planFingerprints(project);
  await serializePlanImport(async () => {
    await useDesignStore.getState().flushActiveDesign();
    await ensurePlanFingerprintMigration();
    let designs = (await listDesignSummaries()).filter(
      (design) => !design.cloud && design.fingerprints?.version === FINGERPRINT_VERSION,
    );
    const activeId = useDesignStore.getState().activeDesignId;
    designs.sort(
      (a, b) =>
        Number(b.id === activeId) - Number(a.id === activeId) ||
        Number(Boolean(a.closed)) - Number(Boolean(b.closed)),
    );
    // Summaries carry both hashes: no scan of old plan bodies on each import.
    const exactCandidates = designs.filter(
      (design) => design.fingerprints!.full === fingerprints.full,
    );
    for (const exact of exactCandidates) {
      if (!(await useDesignStore.getState().switchToDesign(exact.id, fingerprints.full))) continue;
      leaveWelcomeTab();
      usePlanImportNotice.setState({
        notice: {
          kind: "existing",
          designId: exact.id,
          name:
            useDesignStore.getState().designs.find((design) => design.id === exact.id)?.name ??
            exact.name,
          project,
          full: fingerprints.full,
          related: [],
        },
      });
      return;
    }
    // A candidate may have changed while opening. Build update choices from
    // its current hashes, so a related version is not offered with stale data.
    if (exactCandidates.length)
      designs = (await listDesignSummaries()).filter(
        (design) => !design.cloud && design.fingerprints?.version === FINGERPRINT_VERSION,
      );
    const related = designs
      .filter((design) => design.fingerprints!.simple === fingerprints.simple)
      .map((design) => ({ id: design.id, name: design.name, full: design.fingerprints!.full }));
    await useDesignStore.getState().importProjectAsDesign(project, project.name);
    applyPlanView(project.view);
    usePlanImportNotice.setState({
      notice: related.length
        ? {
            kind: "related",
            designId: useDesignStore.getState().activeDesignId!,
            name: project.name,
            project,
            full: fingerprints.full,
            related,
          }
        : undefined,
    });
  });
}

export async function importPlanNoticeAsNew(notice: PlanImportNotice): Promise<void> {
  await serializePlanImport(async () => {
    await useDesignStore.getState().importProjectAsDesign(notice.project, notice.project.name);
    applyPlanView(notice.project.view);
    if (usePlanImportNotice.getState().notice === notice) dismissPlanImportNotice();
  });
}

export async function updatePlanFromNotice(
  notice: PlanImportNotice,
  targetId: string,
): Promise<void> {
  const assertUnchangedCanvas = captureDesignUpdateGuard();
  assertUnchangedCanvas();
  await serializePlanImport(async () => {
    assertUnchangedCanvas();
    const target = notice.related.find((plan) => plan.id === targetId);
    if (!target) throw new Error("Choose a saved plan to update.");
    await useDesignStore.getState().flushActiveDesign();
    assertUnchangedCanvas();
    const imported = await readDesign(notice.designId);
    assertUnchangedCanvas();
    const full = imported && (await planFingerprints(imported.project)).full;
    assertUnchangedCanvas();
    if (!imported || full !== notice.full) {
      throw new Error(
        "The imported plan changed. Open the link again before updating a saved plan.",
      );
    }
    await useDesignStore
      .getState()
      .replaceDesignFromImport(target.id, notice.project, target.full, assertUnchangedCanvas);
    // The imported snapshot is now saved in the target. Keep the incoming copy
    // if the player returned to it or changed it while storage was pending.
    await useDesignStore
      .getState()
      .cleanupImportedDesign(notice.designId, notice.full, target.id, imported);
    if (usePlanImportNotice.getState().notice === notice) dismissPlanImportNotice();
  });
}

let importQueue: Promise<unknown> = Promise.resolve();
function serializePlanImport(run: () => Promise<void>): Promise<void> {
  const turn = importQueue.then(async () => {
    if (typeof navigator !== "undefined" && navigator.locks) {
      await navigator.locks.request("gtnh-plan-code-import", run);
      return;
    }
    return run();
  });
  importQueue = turn.catch(() => undefined);
  return turn;
}

// Capture the arriving code before address sync rewrites the URL.
let arrivalPlanCode: string | undefined = (() => {
  try {
    return readPlanCodeFromHash(window.location.hash);
  } catch {
    return undefined;
  }
})();
export async function openPlanCodeFromAddress(): Promise<void> {
  const code = arrivalPlanCode ?? readPlanCodeFromHash(window.location.hash);
  arrivalPlanCode = undefined;
  if (!code) return;
  if (readPlanCodeFromHash(window.location.hash)) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  try {
    await openPlanCode(code);
  } catch (error) {
    window.alert(error instanceof Error ? error.message : "That plan link could not be opened.");
  }
}

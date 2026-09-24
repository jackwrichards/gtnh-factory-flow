"use client";

import { decodePlanCode, readPlanCodeFromHash } from "@/lib/import-export/plan-code";
import { applyPlanView } from "@/lib/plan-view";
import { useDesignStore } from "@/store/design-store";

/**
 * Open a plan code (or a link carrying one) as a NEW design tab. Never over
 * the plan already on the board: a code is somebody else's plan arriving,
 * and it must not cost you yours. Throws the decoder's plain-words error for
 * the caller to show.
 */
export async function openPlanCode(text: string): Promise<void> {
  const project = await decodePlanCode(text);
  await useDesignStore.getState().importProjectAsDesign(project, project.name);
  applyPlanView(project.view);
}

/**
 * The code this page load arrived with, captured at load like the community
 * link's id (shared-link.ts): the address is rewritten while the app runs -
 * SharedAddressSync writes a posted design's id there and drops the
 * fragment - so arrival must not depend on reading it after that.
 */
let arrivalPlanCode: string | undefined = (() => {
  try {
    return readPlanCodeFromHash(window.location.hash);
  } catch {
    return undefined;
  }
})();

/**
 * Open the code in the address, the one this load arrived with or one a
 * hash change just brought, then take it out of the address: a reload must
 * not open a second copy, and the bar should not carry tens of thousands of
 * characters.
 */
export async function openPlanCodeFromAddress(): Promise<void> {
  const code = arrivalPlanCode ?? readPlanCodeFromHash(window.location.hash);
  arrivalPlanCode = undefined;
  if (!code) {
    return;
  }
  if (readPlanCodeFromHash(window.location.hash)) {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }
  try {
    await openPlanCode(code);
  } catch (error) {
    window.alert(error instanceof Error ? error.message : "That plan link could not be opened.");
  }
}

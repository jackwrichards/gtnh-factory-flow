"use client";

import { useEffect, useState } from "react";
import { readDesign } from "@/lib/designs/design-storage";
import { leaveLibrary } from "@/lib/library/library-tab";
import { openSharedPlan } from "@/lib/library/open-shared";
import { parseDocKey } from "@/lib/live/protocol";
import type { FactoryProject, PlanTaskLink } from "@/lib/model/types";
import { leaveWelcomeTab } from "@/lib/welcome/welcome-tab";
import { useDesignStore } from "@/store/design-store";
import { useFactoryStore } from "@/store/factory-store";
import { myAccountId } from "@/store/live-session";
import { getSelectedMachineHandler } from "@/lib/model/recipe-rules";
import { boardCardLabel } from "./task-board";
import { designForPlan, linkKey } from "./task-links";

/** What a link leads to, as far as this device can tell. */
export interface LinkState {
  /** The card's name, when its plan is here and has the card. */
  label?: string;
  /**
   * "ok": the plan is on this device and has the card. "card": the plan is here without it. "away": a plan of
   * someone else's that is not on this device (opening it asks the account). "plan": no such plan.
   */
  state: "ok" | "card" | "away" | "plan";
  /** The name of the plan the card is on, when it is on this device. */
  planName?: string;
  /** The card's machine, for its picture: its handler, or its power source. */
  handlerId?: string;
  powerSourceId?: string;
}

/** The machine a card of `project` runs, for its picture. */
function machineOf(project: FactoryProject, node: string): { handlerId?: string; powerSourceId?: string } {
  const card = project.nodes.find((entry) => entry.id === node);
  const recipe = card ? project.recipes.find((entry) => entry.id === card.recipeId) : undefined;
  if (!card || !recipe) return {};
  if (recipe.power?.sourceId) return { powerSourceId: recipe.power.sourceId };
  return { handlerId: getSelectedMachineHandler(recipe, card).id };
}

function hasCard(project: FactoryProject | undefined, node: string): boolean {
  return Boolean(project && boardCardLabel(project, node) !== undefined);
}

/** Puts a design of this device on the board (a copy of a shared plan opens live, as from Shared with me). */
export async function activateDesign(design: {
  id: string;
  name: string;
  cloud?: { ownerId: string; ownerName: string; designId: string };
}): Promise<void> {
  const store = useDesignStore.getState();
  if (design.cloud) {
    await store.openSharedDesign(design.cloud, design.name);
  } else {
    await store.switchToDesign(design.id);
  }
  leaveWelcomeTab();
  leaveLibrary();
}

/** Opens the source plan itself, including a shared plan not yet held on this device. */
export async function openTaskPlan(plan: string): Promise<boolean> {
  const design = designForPlan(useDesignStore.getState().designs, plan, myAccountId());
  if (design) {
    await activateDesign(design);
    return true;
  }
  const key = parseDocKey(plan);
  if (!key || key.ownerId === myAccountId()) return false;
  try {
    await openSharedPlan({ ownerId: key.ownerId, ownerName: "", designId: key.designId }, "");
    return true;
  } catch {
    return false;
  }
}

/** Opens the plan a link names and centres its card. Resolves to what went wrong, if anything. */
export async function openTaskLink(link: PlanTaskLink): Promise<"plan-gone" | "card-gone" | undefined> {
  const store = useDesignStore.getState();
  const me = myAccountId();
  let design = designForPlan(store.designs, link.plan, me);
  if (!design) {
    const key = parseDocKey(link.plan);
    if (!key || key.ownerId === me) {
      return "plan-gone";
    }
    try {
      await openSharedPlan({ ownerId: key.ownerId, ownerName: "", designId: key.designId }, "");
    } catch {
      return "plan-gone";
    }
    design = designForPlan(useDesignStore.getState().designs, link.plan, me);
    if (!design) {
      return "plan-gone";
    }
  } else {
    await activateDesign(design);
  }
  // The plan lands on the canvas a moment after the design is named; wait for its card.
  for (let waited = 0; waited < 3000; waited += 100) {
    const factory = useFactoryStore.getState();
    if (
      useDesignStore.getState().activeDesignId === design.id &&
      hasCard(factory.project, link.node)
    ) {
      factory.setSelectedBoardIds([link.node]);
      factory.focusBoardNode(link.node);
      return undefined;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return "card-gone";
}

/** Names the cards some links lead to, reading the plans on this device (the open plan's from the canvas). */
export function useLinkStates(links: readonly PlanTaskLink[]): Record<string, LinkState> {
  const [states, setStates] = useState<Record<string, LinkState>>({});
  const designs = useDesignStore((state) => state.designs);
  const signature = links.map(linkKey).join("|");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const me = myAccountId();
      const active = useDesignStore.getState().activeDesignId;
      const projects = new Map<string, FactoryProject | undefined>();
      const next: Record<string, LinkState> = {};
      for (const link of links) {
        const design = designForPlan(designs, link.plan, me);
        if (!design) {
          const key = parseDocKey(link.plan);
          next[linkKey(link)] = { state: key && key.ownerId !== me ? "away" : "plan" };
          continue;
        }
        if (!projects.has(design.id)) {
          projects.set(
            design.id,
            design.id === active
              ? useFactoryStore.getState().project
              : (await readDesign(design.id).catch(() => undefined))?.project,
          );
        }
        const project = projects.get(design.id);
        const label = project ? boardCardLabel(project, link.node) : undefined;
        next[linkKey(link)] =
          label && project
            ? { state: "ok", label, planName: design.name, ...machineOf(project, link.node) }
            : { state: "card", planName: design.name };
      }
      if (!cancelled) {
        setStates(next);
      }
    })();
    return () => {
      cancelled = true;
    };
    // links are read through their signature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, designs]);
  return states;
}

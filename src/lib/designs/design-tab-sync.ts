"use client";

import { randomUUID } from "@/lib/random-id";

/**
 * Two browser tabs of the planner share one library (IndexedDB), and each
 * holds its open design in memory. Until 2026-09-23 neither knew the other
 * existed, and a player lost hours: they built a chart in one tab, and the
 * other tab, still holding the plan as it was that morning, wrote that old
 * copy back over it the next time it saved anything.
 *
 * This is the wire between tabs: a tab that saves a design says so, and the
 * others showing that design load the new version (design-store.ts). The
 * store's write guard is what actually makes loss impossible; this only keeps
 * the other tabs current so the guard rarely has to act.
 */

const CHANNEL_NAME = "gtnh-factory-flow.designs";

/** This browser tab, so it can ignore its own announcements. */
export const THIS_TAB_ID = randomUUID();

export interface DesignSavedMessage {
  type: "design-saved";
  designId: string;
  updatedAt: string;
  tabId: string;
}

let channel: BroadcastChannel | undefined;
let channelTried = false;

function getChannel(): BroadcastChannel | undefined {
  if (!channelTried) {
    channelTried = true;
    try {
      channel = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel(CHANNEL_NAME);
    } catch {
      channel = undefined;
    }
  }
  return channel;
}

/** Tell the other tabs this design now has a newer saved version. */
export function announceDesignSaved(designId: string, updatedAt: string): void {
  try {
    getChannel()?.postMessage({
      type: "design-saved",
      designId,
      updatedAt,
      tabId: THIS_TAB_ID,
    } satisfies DesignSavedMessage);
  } catch {
    // A closed channel is no reason to fail a save.
  }
}

/** Hear the other tabs' saves (never this tab's own). */
export function subscribeDesignSaved(handler: (message: DesignSavedMessage) => void): () => void {
  const target = getChannel();
  if (!target) {
    return () => undefined;
  }
  const onMessage = (event: MessageEvent) => {
    const message = event.data as Partial<DesignSavedMessage> | undefined;
    if (
      message?.type === "design-saved" &&
      message.tabId !== THIS_TAB_ID &&
      typeof message.designId === "string" &&
      typeof message.updatedAt === "string"
    ) {
      handler(message as DesignSavedMessage);
    }
  };
  target.addEventListener("message", onMessage);
  return () => target.removeEventListener("message", onMessage);
}

/**
 * Whether a change happening right now is the player working in THIS tab.
 * Edits need the page focused; a tab in the background only changes its plan
 * by itself (a recipe refresh after loading someone else's save), and those
 * changes must never be written back over the version they came from.
 */
export function isEditingInThisTab(): boolean {
  if (typeof document === "undefined" || typeof document.hasFocus !== "function") {
    return true;
  }
  return document.hasFocus();
}

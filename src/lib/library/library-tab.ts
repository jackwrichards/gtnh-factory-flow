"use client";

import { useSyncExternalStore } from "react";
import { leaveWelcomeTab } from "@/lib/welcome/welcome-tab";
import { playSfx } from "@/lib/sound/sfx";

/**
 * The Library: everything you have, and everything the network has.
 *
 * Not a tab and not a design: a "Library" pill at the head of the tab strip
 * that, like Welcome, COVERS the board so nothing underneath unmounts.
 *
 * ALL is every design you have, one grid; a FOLDER is the same grid held to
 * one folder; PUBLIC is the network's setups.
 *
 * `active` and `view` live in sessionStorage, as Welcome's do: a reload
 * returns to the same view, and a new visit starts on the open design.
 */
export type LibraryView =
  | { kind: "networks" }
  | { kind: "all" }
  | { kind: "favorites" }
  | { kind: "folder"; folderId: string }
  | { kind: "public"; search?: string }
  | { kind: "saved" }
  /** Plans other accounts shared with this one (live plans only). */
  | { kind: "shared" };

export interface LibraryTabState {
  /** It is the thing being shown, covering the board. */
  active: boolean;
  view: LibraryView;
}

const SHELF_SESSION_KEY = "gtnh-factory-flow-library";

const CLOSED: LibraryTabState = { active: false, view: { kind: "all" } };

let state: LibraryTabState = CLOSED;
let loaded = false;
const listeners = new Set<() => void>();

function isLibraryView(value: unknown): value is LibraryView {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "folder") {
    return typeof (value as { folderId?: unknown }).folderId === "string";
  }
  return (
    kind === "all" || kind === "networks" ||
    kind === "favorites" ||
    kind === "public" ||
    kind === "saved" ||
    kind === "shared"
  );
}

function readStored(): LibraryTabState {
  try {
    const raw = window.sessionStorage.getItem(SHELF_SESSION_KEY);
    if (!raw) {
      return CLOSED;
    }
    const parsed = JSON.parse(raw) as Partial<LibraryTabState>;
    return {
      active: parsed.active === true,
      view: isLibraryView(parsed.view) ? parsed.view : { kind: "all" },
    };
  } catch {
    return CLOSED;
  }
}

function getSnapshot(): LibraryTabState {
  if (!loaded) {
    loaded = true;
    state = readStored();
  }
  return state;
}

function getServerSnapshot(): LibraryTabState {
  return CLOSED;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function write(patch: Partial<LibraryTabState>) {
  state = { ...getSnapshot(), ...patch };
  try {
    window.sessionStorage.setItem(SHELF_SESSION_KEY, JSON.stringify(state));
  } catch {
    // Blocked storage costs the reload its place, nothing more.
  }
  for (const listener of listeners) {
    listener();
  }
}

export function useLibraryTab(): LibraryTabState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** The current state without subscribing. For tests and one-shot reads. */
export function readLibraryTabState(): LibraryTabState {
  return getSnapshot();
}

/**
 * Show the library, on `view` if given and otherwise wherever it was last.
 * Exactly one of Welcome and the library can be up, so Welcome steps down.
 */
export function openLibrary(view?: LibraryView) {
  // The library swapping in for the board turns a page, as the mod's.
  if (!getSnapshot().active) playSfx("ui.page");
  leaveWelcomeTab();
  write({ active: true, ...(view ? { view } : {}) });
}

/** Change what the open library is looking at. */
export function setLibraryView(view: LibraryView) {
  write({ view });
}

/** Step off the library onto whatever design is active. */
export function leaveLibrary() {
  if (!getSnapshot().active) {
    return;
  }
  playSfx("ui.page");
  write({ active: false });
}

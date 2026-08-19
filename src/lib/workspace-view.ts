"use client";

import { useSyncExternalStore } from "react";
import { isCompactViewport } from "./compact-view";

/**
 * Workspace preferences: which of the three columns are open, and how the
 * resource panel is filtered.
 *
 * Same reasoning as `board-view.ts`, and the same mechanism: personal taste
 * rather than part of a plan, kept in localStorage outside any store and read
 * through useSyncExternalStore so the server can render defaults without a
 * hydration mismatch. Sharing a setup is the same one exception - see
 * `plan-view.ts`.
 *
 * Hidden and favourite resources are keyed by `ResourceKey` (`item:iron_ingot`)
 * and kept across designs on purpose: someone who never wants to see Water
 * never wants to see it on any board.
 */
export interface WorkspaceView {
  /** The recipe browser / pockets / setups column on the left. */
  leftPanelOpen: boolean;
  /** The resource flow panel on the right. */
  rightPanelOpen: boolean;
  /** Hidden resources stay listed, greyed out, instead of dropping away. */
  showHiddenResources: boolean;
  /** Only favourites are listed. */
  favouritesOnly: boolean;
  /**
   * Net the resource panel's boundary: an item in Need and Outputs at once
   * shows as one signed figure instead of both. Display arithmetic only.
   */
  netFlowRates: boolean;
  /**
   * The build list's power figures, weighted by how hard each machine
   * actually runs instead of every machine at full draw at once. Display
   * arithmetic only.
   */
  averageMachineDraw: boolean;
  /** The trend graphs at the foot of the resource panel. */
  trendsOpen: boolean;
  /** Resources the user has hidden, by ResourceKey. */
  hiddenResourceKeys: string[];
  /** Resources the user has starred, by ResourceKey. */
  favouriteResourceKeys: string[];
}

const WORKSPACE_VIEW_STORAGE_KEY = "gtnh-factory-flow-workspace-view";

export const DEFAULT_WORKSPACE_VIEW: WorkspaceView = {
  leftPanelOpen: true,
  rightPanelOpen: true,
  showHiddenResources: false,
  favouritesOnly: false,
  netFlowRates: false,
  averageMachineDraw: false,
  trendsOpen: true,
  hiddenResourceKeys: [],
  favouriteResourceKeys: [],
};

/**
 * Whether the side columns start open.
 *
 * On a phone the two of them leave the board almost nothing, so they start
 * closed and the board gets the screen. Each edge keeps a handle, so opening one
 * is a tap or a swipe away and the choice is then remembered like any other.
 *
 * A media query rather than `window.innerWidth`: a mobile browser widens the
 * layout viewport when a page overflows it, so `innerWidth` on a 390px phone can
 * report 935 — which is exactly how this used to open both columns on the one
 * device that has room for neither.
 */
function defaultPanelsOpen(): boolean {
  return typeof window === "undefined" || !isCompactViewport();
}

function defaultWorkspaceView(): WorkspaceView {
  const open = defaultPanelsOpen();
  return { ...DEFAULT_WORKSPACE_VIEW, leftPanelOpen: open, rightPanelOpen: open };
}

let workspaceViewState: WorkspaceView = DEFAULT_WORKSPACE_VIEW;
let workspaceViewLoaded = false;
const listeners = new Set<() => void>();

function readWorkspaceView(): WorkspaceView {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_VIEW_STORAGE_KEY);
    if (!raw) {
      return defaultWorkspaceView();
    }
    const parsed = JSON.parse(raw) as Partial<Record<keyof WorkspaceView, unknown>>;
    // An ABSENT key takes the default; only an explicit `false` means off, so
    // a blob saved before a setting existed cannot silently opt out of it.
    const flag = (value: unknown, fallback: boolean) =>
      typeof value === "boolean" ? value : fallback;
    const keys = (value: unknown) =>
      Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

    // A starred resource is never hidden (see toggleResourceFavourite), so a
    // key in both lists is a blob from a build that allowed it. Settle it here
    // rather than in every reader: the star wins, once, on the way in.
    const favouriteResourceKeys = keys(parsed.favouriteResourceKeys);
    const starred = new Set(favouriteResourceKeys);

    return {
      favouriteResourceKeys,
      hiddenResourceKeys: keys(parsed.hiddenResourceKeys).filter((key) => !starred.has(key)),
      leftPanelOpen: flag(parsed.leftPanelOpen, defaultPanelsOpen()),
      rightPanelOpen: flag(parsed.rightPanelOpen, defaultPanelsOpen()),
      showHiddenResources: flag(
        parsed.showHiddenResources,
        DEFAULT_WORKSPACE_VIEW.showHiddenResources,
      ),
      favouritesOnly: flag(parsed.favouritesOnly, DEFAULT_WORKSPACE_VIEW.favouritesOnly),
      netFlowRates: flag(parsed.netFlowRates, DEFAULT_WORKSPACE_VIEW.netFlowRates),
      averageMachineDraw: flag(
        parsed.averageMachineDraw,
        DEFAULT_WORKSPACE_VIEW.averageMachineDraw,
      ),
      trendsOpen: flag(parsed.trendsOpen, DEFAULT_WORKSPACE_VIEW.trendsOpen),
    };
  } catch {
    return defaultWorkspaceView();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Identity stays stable between writes, which is what useSyncExternalStore
// needs to avoid an infinite render loop.
function getSnapshot(): WorkspaceView {
  if (!workspaceViewLoaded) {
    workspaceViewLoaded = true;
    workspaceViewState = readWorkspaceView();
  }
  return workspaceViewState;
}

function getServerSnapshot(): WorkspaceView {
  return DEFAULT_WORKSPACE_VIEW;
}

export function writeWorkspaceView(patch: Partial<WorkspaceView>) {
  workspaceViewState = { ...getSnapshot(), ...patch };
  try {
    window.localStorage.setItem(
      WORKSPACE_VIEW_STORAGE_KEY,
      JSON.stringify(workspaceViewState),
    );
  } catch {
    // A full or blocked storage quota must never break the workspace.
  }
  for (const listener of listeners) {
    listener();
  }
}

export function useWorkspaceView(): WorkspaceView {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** The same value the hook returns, for callers outside React. */
export function readWorkspaceViewSnapshot(): WorkspaceView {
  return getSnapshot();
}

/** Flip one resource in or out of a saved key list. */
function toggleKey(list: string[], resourceKey: string): string[] {
  return list.includes(resourceKey)
    ? list.filter((entry) => entry !== resourceKey)
    : [...list, resourceKey];
}

export function toggleResourceHidden(resourceKey: string) {
  const current = getSnapshot();
  writeWorkspaceView({
    hiddenResourceKeys: toggleKey(current.hiddenResourceKeys, resourceKey),
  });
}

/**
 * Star or unstar a resource. Starring one that was hidden UNHIDES it.
 *
 * A starred resource is unhideable: its row offers no hide button, and this is
 * the one path that could put a resource in both lists at once. Rather than
 * teach every reader to break the tie, the two states are kept mutually
 * exclusive at the point they are written - so "hidden" always means hidden,
 * with no exceptions to remember.
 */
export function toggleResourceFavourite(resourceKey: string) {
  const current = getSnapshot();
  const favouriteResourceKeys = toggleKey(current.favouriteResourceKeys, resourceKey);
  writeWorkspaceView({
    favouriteResourceKeys,
    hiddenResourceKeys: favouriteResourceKeys.includes(resourceKey)
      ? current.hiddenResourceKeys.filter((key) => key !== resourceKey)
      : current.hiddenResourceKeys,
  });
}

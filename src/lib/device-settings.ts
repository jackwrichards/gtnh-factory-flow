"use client";

import { useSyncExternalStore } from "react";
import {
  clampItemsWidth,
  clampOverviewWidth,
  ITEMS_DEFAULT_WIDTH,
  OVERVIEW_DEFAULT_WIDTH,
} from "./workspace-columns";

/**
 * The planner's device settings: the mod's settings box, kept in this browser
 * (never in a plan, never synced). Read through `useDeviceSettings`, written
 * through `writeDeviceSettings`; storage that is blocked costs the reload its
 * values, nothing more.
 *
 */
export interface DeviceSettings {
  /** "Names when zoomed out": the glance cards carry their names. */
  zoomedOutNames: boolean;
  /**
   * "Zoomed-out view": the board zoom (of a 1:1 interface) below which cards turn to their glance faces
   * (`node-detail.ts`), from `ZOOMED_OUT_AT_MIN` to `ZOOMED_OUT_AT_MAX`.
   */
  zoomedOutAt: number;
  /** "Problem outlines": a card with a problem draws its edge in its bar's colour. */
  problemOutlines: boolean;
  /**
   * "Scroll changes values": the wheel over a number, chip or key steps it. Off, the wheel never changes a value:
   * over the board it zooms, elsewhere it scrolls. Handlers ask `wheelChangesValues()`.
   */
  scrollChangesValues: boolean;
  /** "Item browser": on plan boards the items list on the left and the overview on the right (the other way round). */
  itemsLeft: boolean;
  /** The overview column's width the player set by dragging its edge (shell px; the window may show it narrower). */
  overviewWidth: number;
  /** The items list's width, set the same way. */
  itemsWidth: number;
  /** Network plan list width, set by its visible resize handle (shell px). */
  networkSidebarWidth: number;
  /** The settings box's open section, kept so it opens where it was left. */
  settingsSection: string;
}

/** Where the glance view starts unless the player moves it: well before a card's names get hard to read. */
export const DEFAULT_ZOOMED_OUT_AT = 0.65;
/** Lower, the full card's lettering is unreadable before the glance face arrives. */
export const ZOOMED_OUT_AT_MIN = 0.35;
export const ZOOMED_OUT_AT_MAX = 1;

export const DEFAULT_DEVICE_SETTINGS: DeviceSettings = {
  zoomedOutNames: true,
  zoomedOutAt: DEFAULT_ZOOMED_OUT_AT,
  problemOutlines: true,
  scrollChangesValues: true,
  itemsLeft: false,
  overviewWidth: OVERVIEW_DEFAULT_WIDTH,
  itemsWidth: ITEMS_DEFAULT_WIDTH,
  networkSidebarWidth: 300,
  settingsSection: "Board",
};

const STORAGE_KEY = "gtnh-factory-flow.device-settings.v1";

let state: DeviceSettings = DEFAULT_DEVICE_SETTINGS;
let loaded = false;
const listeners = new Set<() => void>();

/** An absent key falls back to its default; only an explicit false means off. */
export function parseDeviceSettings(raw: string | null): DeviceSettings {
  if (!raw) return DEFAULT_DEVICE_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof DeviceSettings, unknown>>;
    return {
      zoomedOutNames:
        typeof parsed.zoomedOutNames === "boolean"
          ? parsed.zoomedOutNames
          : DEFAULT_DEVICE_SETTINGS.zoomedOutNames,
      zoomedOutAt:
        typeof parsed.zoomedOutAt === "number" &&
        parsed.zoomedOutAt >= ZOOMED_OUT_AT_MIN &&
        parsed.zoomedOutAt <= ZOOMED_OUT_AT_MAX
          ? parsed.zoomedOutAt
          : DEFAULT_DEVICE_SETTINGS.zoomedOutAt,
      problemOutlines:
        typeof parsed.problemOutlines === "boolean"
          ? parsed.problemOutlines
          : DEFAULT_DEVICE_SETTINGS.problemOutlines,
      scrollChangesValues:
        typeof parsed.scrollChangesValues === "boolean"
          ? parsed.scrollChangesValues
          : DEFAULT_DEVICE_SETTINGS.scrollChangesValues,
      itemsLeft:
        typeof parsed.itemsLeft === "boolean"
          ? parsed.itemsLeft
          : DEFAULT_DEVICE_SETTINGS.itemsLeft,
      overviewWidth:
        typeof parsed.overviewWidth === "number"
          ? clampOverviewWidth(parsed.overviewWidth)
          : DEFAULT_DEVICE_SETTINGS.overviewWidth,
      itemsWidth:
        typeof parsed.itemsWidth === "number"
          ? clampItemsWidth(parsed.itemsWidth)
          : DEFAULT_DEVICE_SETTINGS.itemsWidth,
      settingsSection:
        typeof parsed.settingsSection === "string"
          ? parsed.settingsSection
          : DEFAULT_DEVICE_SETTINGS.settingsSection,
      networkSidebarWidth:
        typeof parsed.networkSidebarWidth === "number" &&
        Number.isFinite(parsed.networkSidebarWidth)
          ? Math.max(240, Math.min(640, parsed.networkSidebarWidth))
          : DEFAULT_DEVICE_SETTINGS.networkSidebarWidth,
    };
  } catch {
    return DEFAULT_DEVICE_SETTINGS;
  }
}

function getSnapshot(): DeviceSettings {
  if (!loaded && typeof window !== "undefined") {
    loaded = true;
    try {
      state = parseDeviceSettings(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      state = DEFAULT_DEVICE_SETTINGS;
    }
  }
  return state;
}

function getServerSnapshot(): DeviceSettings {
  return DEFAULT_DEVICE_SETTINGS;
}

/** Called after every change; for code outside React that follows a setting (the board's detail level). */
export function subscribeDeviceSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDeviceSettings(): DeviceSettings {
  return useSyncExternalStore(subscribeDeviceSettings, getSnapshot, getServerSnapshot);
}

export function readDeviceSettings(): DeviceSettings {
  return getSnapshot();
}

/**
 * Whether the wheel may change a value right now, read when the wheel turns. A handler that steps something returns
 * early when this is false, before `preventDefault` or `stopPropagation`, so the event goes on to whoever scrolls or
 * zooms underneath.
 */
export function wheelChangesValues(): boolean {
  return getSnapshot().scrollChangesValues;
}

export function writeDeviceSettings(patch: Partial<DeviceSettings>): void {
  const next = { ...getSnapshot(), ...patch };
  if (JSON.stringify(next) === JSON.stringify(state)) return;
  state = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Blocked storage: the setting holds until the page closes.
  }
  for (const listener of listeners) listener();
}

/** Test seam: forget what was read so the next read starts from storage. */
export function resetDeviceSettingsForTests(): void {
  state = DEFAULT_DEVICE_SETTINGS;
  loaded = false;
  for (const listener of listeners) listener();
}

/**
 * Landing the right column on Resources or Machines from anywhere else in the
 * app.
 *
 * Same bargain as `sidebar-tab.ts`: the panel may not be mounted when the
 * request is made (on a phone it is a closed drawer), so the wanted tab waits
 * in module state until either the mounted panel's listener or the next mount
 * collects it.
 */
export const OPEN_INSPECTOR_TAB_EVENT = "gtnh:open-inspector-tab";

export type InspectorTab = "resources" | "machines";

let pendingTab: InspectorTab | undefined;

export function openInspectorTab(tab: InspectorTab): void {
  pendingTab = tab;
  window.dispatchEvent(new Event(OPEN_INSPECTOR_TAB_EVENT));
}

/** One-shot read of the tab the last request asked for, if any. */
export function takePendingInspectorTab(): InspectorTab | undefined {
  const tab = pendingTab;
  pendingTab = undefined;
  return tab;
}

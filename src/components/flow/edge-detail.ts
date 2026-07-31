/**
 * Zoom-derived edge detail, encoded as a bitmask.
 *
 * Zoom only ever feeds a few boolean thresholds, but edges used to subscribe to
 * the raw `transform[2]` scalar — which meant every visible edge re-rendered on
 * every frame of a zoom gesture, and each of those re-renders re-ran the route
 * solver. Selecting this mask instead means edges re-render only when a threshold
 * is actually crossed.
 */

// Labels and arrows used to fade out below ~0.7 zoom, but the rate legends are
// the primary way to read a plan, so they now stay visible at every zoom level.
export const EDGE_LABEL_ZOOM = 0;
export const EDGE_ARROW_ZOOM = 0;
export const EDGE_GLOBAL_ZOOM = 0.45;

export const EDGE_DETAIL_GLOBAL = 1;
export const EDGE_DETAIL_ARROWS = 2;
export const EDGE_DETAIL_LABELS = 4;

export function getEdgeDetailLevel(zoom: number) {
  return (
    (zoom < EDGE_GLOBAL_ZOOM ? EDGE_DETAIL_GLOBAL : 0) |
    (zoom >= EDGE_ARROW_ZOOM ? EDGE_DETAIL_ARROWS : 0) |
    (zoom >= EDGE_LABEL_ZOOM ? EDGE_DETAIL_LABELS : 0)
  );
}

export function hasEdgeDetail(detailLevel: number, flag: number) {
  return (detailLevel & flag) !== 0;
}

/**
 * Returns the cached object when every field still points at the same value.
 *
 * React Flow node `data` is rebuilt whenever anything on the board changes —
 * a hover, a solver run — and a fresh object identity defeats the `memo` on the
 * node components, re-rendering every node for a change affecting one. Handing
 * back the previous object when nothing in it moved keeps those memos effective.
 *
 * The result is always derived purely from `next`, so returning either identity
 * is equally correct; only the reference differs.
 */
export function reuseObjectIdentity<T extends Record<string, unknown>>(
  cache: Map<string, T>,
  id: string,
  next: T,
): T {
  const previous = cache.get(id);
  if (previous) {
    const keys = Object.keys(next);
    if (
      keys.length === Object.keys(previous).length &&
      keys.every((key) => previous[key] === next[key])
    ) {
      return previous;
    }
  }

  cache.set(id, next);
  return next;
}

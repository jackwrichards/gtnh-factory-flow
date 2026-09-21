import type { FactoryProject, FactoryStorage, StorageBufferMode } from "./types";

/**
 * What a drawer IS. Four jobs that happen to share one card, and they mean
 * such different things that the board draws each as a different shape.
 *
 * Three are read off the WIRING and cannot be chosen:
 *
 * - `source`  nothing feeds it, so it invents its resource. The plan's
 *             declared import, and one of the two cards still allowed to
 *             break conservation.
 * - `buffer`  fed and drawn from, so it is neither end of anything. The only
 *             one of the four that lives INSIDE the system: it passes on what
 *             its takers pull and not one item more, so a producer cannot use
 *             it as a quiet dump.
 * - `idle`    unwired. Barely exists in practice - `pruneOrphanStorages`
 *             sweeps a drawer the moment its last wire goes - but a drawer
 *             mid-drag has to be called something.
 *
 * The fourth is a CHOICE, and it only exists once nothing draws from the
 * drawer (see StorageDrainMode):
 *
 * - `product`    pulls its feeder flat out. The thing the factory is for.
 * - `byproduct`  asks for nothing and catches what is left over.
 * - `trash`      asks for nothing and VOIDS what arrives. The drawer as a
 *                bin: it un-clogs its feeder exactly like the old trash can
 *                node, and what it eats never appears in the books.
 *
 * Product vs byproduct is the difference between "make as much of this as
 * you can" and "the extra has to go somewhere"; trash is "the extra stops
 * existing", which is what every overflow-into-a-void setup really is.
 */
export type StorageRole = "source" | "buffer" | "product" | "byproduct" | "trash" | "idle";

/** The ones that sit ON the boundary rather than inside it. */
export function isBoundaryRole(role: StorageRole): boolean {
  return role === "source" || role === "product" || role === "byproduct" || role === "trash";
}

/** The ends of a drain: all accept freely, only the product asks. */
export function isDrainRole(role: StorageRole): boolean {
  return role === "product" || role === "byproduct" || role === "trash";
}

/**
 * Every drawer's role in one pass over the edges.
 *
 * Built whole rather than per-drawer because both callers (the solver's edge
 * preparation and the board's cards) need most of the map at once, and the
 * per-drawer version would have been O(storages x edges) on the hot path.
 */
export function getStorageRoles(project: FactoryProject): Map<string, StorageRole> {
  const roles = new Map<string, StorageRole>();
  const storages = project.storages ?? [];
  if (storages.length === 0) {
    return roles;
  }

  const hasIn = new Set<string>();
  const hasOut = new Set<string>();
  const ids = new Set(storages.map((storage) => storage.id));
  for (const edge of project.edges) {
    if (ids.has(edge.target)) {
      hasIn.add(edge.target);
    }
    if (ids.has(edge.source)) {
      hasOut.add(edge.source);
    }
  }

  for (const storage of storages) {
    roles.set(storage.id, storageRoleFor(storage, hasIn.has(storage.id), hasOut.has(storage.id), project.poolMode === true));
  }
  return roles;
}

/**
 * One drawer's role from what is wired to it. In POOL MODE a drawer with no
 * wires still has a job if it says which side of the pool it sits on: the
 * pool expansion wires it in, and the card should wear that role before
 * the solve has run. Shared with the card, which reads its own wires.
 */
export function storageRoleFor(
  storage: Pick<FactoryStorage, "drainMode" | "poolSide" | "targetPerSecond">,
  fed: boolean,
  drawn: boolean,
  poolMode: boolean,
): StorageRole {
  const drainRole = (): StorageRole =>
    storage.drainMode === "byproduct" ? "byproduct" : storage.drainMode === "trash" ? "trash" : "product";
  if (poolMode) {
    const side = poolSideOf(storage, fed, drawn);
    return side === "source" ? "source" : side === "drain" ? drainRole() : "idle";
  }
  if (fed) {
    return drawn ? "buffer" : drainRole();
  }
  if (drawn) {
    return "source";
  }
  // Unwired, but declared in pool mode: it stays the product (or source) it
  // was made as, a lingering drawer rather than a blank one, until a wire
  // says otherwise.
  if ((storage.targetPerSecond ?? 0) < 0) return "source";
  if (storage.poolSide === "drain") {
    return drainRole();
  }
  if (storage.poolSide === "source") {
    return "source";
  }
  return "idle";
}

/**
 * Which side of the POOL a drawer sits on. Wires do not exist in pool mode,
 * but the ones the player drew before switching still say what the drawer
 * was FOR: fed only, it was a drain (a product); drawn only, a source. A
 * declared `poolSide` wins. A buffer (both) or a drawer with neither has no
 * side - the pool is the buffer now - and stays idle.
 */
export function poolSideOf(
  storage: Pick<FactoryStorage, "poolSide" | "targetPerSecond">,
  fed: boolean,
  drawn: boolean,
): "source" | "drain" | undefined {
  if ((storage.targetPerSecond ?? 0) < 0) return "source";
  if (storage.poolSide) {
    return storage.poolSide;
  }
  if (fed && !drawn) {
    return "drain";
  }
  if (drawn && !fed) {
    return "source";
  }
  return undefined;
}

/**
 * A drawer's name as the rest of the UI should say it: the item, then which
 * of the four jobs it is doing.
 *
 * Everything used to append a flat "(buffer)", which is now wrong three times
 * out of four - a SOURCE is the opposite of a buffer, and calling it one in a
 * tooltip teaches the reader the wrong word for the thing they are about to
 * go and look at.
 */
export function describeStorage(
  storage: { displayName?: string; resourceId: string },
  role: StorageRole | undefined,
): string {
  const name = storage.displayName ?? storage.resourceId;
  return role && role !== "idle" ? `${name} (${role})` : name;
}

/** One drawer's role. Prefer `getStorageRoles` when asking about several. */
export function getStorageRole(project: FactoryProject, storageId: string): StorageRole {
  return getStorageRoles(project).get(storageId) ?? "idle";
}

/** Solve balances intermediate drawers unless storage/ratio behavior was explicitly chosen. */
export function effectiveBufferMode(storage: Pick<FactoryStorage, "bufferMode">, solveMode: boolean): StorageBufferMode {
  return storage.bufferMode ?? (solveMode ? "strict" : "overflow");
}

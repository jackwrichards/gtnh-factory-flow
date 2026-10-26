import type { RouterSnapshot } from "./incremental-router";

/**
 * Each plan's last routes, kept in this browser's IndexedDB by the route
 * worker, so a plan opened again (a reload, a tab switched back to after the
 * worker forgot it) starts from the wires it had and routes again only what
 * changed, instead of solving every wire from nothing.
 *
 * Never part of the plan: routes are worked out from the cards, and every
 * device and the mod route for themselves. Losing an entry costs one full
 * solve. Worker-safe: no DOM, only IndexedDB.
 */

const DB_NAME = "gtnh-factory-flow-routes";
const DB_VERSION = 1;
const STORE = "boards";
/**
 * Bumped when routes or snapshots change shape: an entry written by another
 * version is ignored, and that plan solves afresh once.
 */
const SNAPSHOT_VERSION = 1;
/** How many plans' routes to keep; the least recently written go first. */
const MAX_BOARDS = 40;

interface StoredRoutes {
  key: string;
  version: number;
  at: number;
  snapshot: RouterSnapshot;
}

let opening: Promise<IDBDatabase | undefined> | undefined;

function open(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === "undefined") return Promise.resolve(undefined);
  opening ??= new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" }).createIndex("at", "at");
      }
    };
    request.onsuccess = () => resolve(request.result);
    // No storage (private window, blocked site data): routing works the same, only from nothing.
    request.onerror = () => resolve(undefined);
  });
  return opening;
}

function done<T>(request: IDBRequest<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
  });
}

export async function loadRoutes(key: string): Promise<RouterSnapshot | undefined> {
  try {
    const db = await open();
    if (!db) return undefined;
    const stored = (await done(db.transaction(STORE).objectStore(STORE).get(key))) as StoredRoutes | undefined;
    return stored?.version === SNAPSHOT_VERSION ? stored.snapshot : undefined;
  } catch {
    return undefined;
  }
}

export async function saveRoutes(key: string, snapshot: RouterSnapshot): Promise<void> {
  try {
    const db = await open();
    if (!db) return;
    const entry: StoredRoutes = { key, version: SNAPSHOT_VERSION, at: Date.now(), snapshot };
    await done(db.transaction(STORE, "readwrite").objectStore(STORE).put(entry));
    // The index lists entries oldest first.
    const keys = (await done(db.transaction(STORE).objectStore(STORE).index("at").getAllKeys())) as
      | IDBValidKey[]
      | undefined;
    if (keys && keys.length > MAX_BOARDS) {
      const prune = db.transaction(STORE, "readwrite").objectStore(STORE);
      for (const old of keys.slice(0, keys.length - MAX_BOARDS)) prune.delete(old);
    }
  } catch {
    // A full disk or a closed database loses one plan's memory, nothing more.
  }
}

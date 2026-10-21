"use client";

import type { PendingBatch } from "./client-state";

/**
 * Live edits not yet confirmed by the live service, kept in IndexedDB so a
 * closed tab, a crash or a dropped connection loses nothing: the next time
 * the plan is open live they are sent again (the service acknowledges a
 * batch it already applied without applying it twice).
 *
 * One entry per plan per browser tab (`<doc>|<tabId>`): every tab edits a
 * live plan through its own connection. A tab adopts the entries of tabs
 * that are gone (`isTabAlive`), so edits a closed tab left behind still go.
 *
 * Its own database, so live plans never bump the design library's version.
 */

const DB_NAME = "gtnh-factory-flow-live";
const DB_VERSION = 1;
const STORE = "pending";

export interface StoredPending {
  key: string;
  doc: string;
  tabId: string;
  pending: PendingBatch[];
  updatedAt: string;
}

function available(): boolean {
  return typeof indexedDB !== "undefined";
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("doc", "doc");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Live storage could not open."));
  });
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Live storage failed."));
  });
}

export function pendingKey(doc: string, tabId: string): string {
  return `${doc}|${tabId}`;
}

/** Writes this tab's unconfirmed batches for a plan; none removes the entry. */
export async function writePending(
  doc: string,
  tabId: string,
  pending: PendingBatch[],
  options?: { preserveStored?: boolean },
): Promise<void> {
  if (!available()) {
    return;
  }
  const db = await open();
  try {
    const transaction = db.transaction(STORE, "readwrite");
    const committed = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Live edits could not be saved."));
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Live edits could not be saved."));
    });
    const store = transaction.objectStore(STORE);
    const key = pendingKey(doc, tabId);
    if (options?.preserveStored) {
      // The room may still be loading old pending edits. New edits can be
      // appended, but must never erase the entry they have not adopted yet.
      const current = store.get(key);
      current.onsuccess = () => {
        const saved = (current.result as StoredPending | undefined)?.pending ?? [];
        const seen = new Set(saved.map((batch) => batch.cid));
        store.put({
          key,
          doc,
          tabId,
          pending: [...saved, ...pending.filter((batch) => !seen.has(batch.cid))],
          updatedAt: new Date().toISOString(),
        });
      };
    } else if (pending.length === 0) {
      store.delete(key);
    } else {
      const entry: StoredPending = {
        key,
        doc,
        tabId,
        pending,
        updatedAt: new Date().toISOString(),
      };
      store.put(entry);
    }
    await committed;
  } finally {
    db.close();
  }
}

/** Every stored entry for a plan (all tabs), or for every plan when `doc` is omitted. */
export async function readPending(doc?: string): Promise<StoredPending[]> {
  if (!available()) {
    return [];
  }
  const db = await open();
  try {
    const store = db.transaction(STORE, "readonly").objectStore(STORE);
    const entries = await done(
      doc === undefined ? store.getAll() : store.index("doc").getAll(IDBKeyRange.only(doc)),
    );
    return (entries as StoredPending[]).filter((entry) => Array.isArray(entry.pending));
  } finally {
    db.close();
  }
}

export async function deletePending(key: string): Promise<void> {
  if (!available()) {
    return;
  }
  const db = await open();
  try {
    await done(db.transaction(STORE, "readwrite").objectStore(STORE).delete(key));
  } finally {
    db.close();
  }
}

/*
 * Which tabs are alive: each tab holds a Web Lock named for it for as long as
 * it lives, and a lock nobody holds is a tab that is gone. Without the Locks
 * API a tab adopts only its own entries (a reload keeps its tab id).
 */

const LOCK_PREFIX = "gtnh-live-tab:";
let heldTabId: string | undefined;

type LockManagerLike = {
  request(name: string, callback: () => Promise<void>): Promise<void>;
  query(): Promise<{ held?: Array<{ name?: string }> }>;
};

function locks(): LockManagerLike | undefined {
  return typeof navigator === "undefined"
    ? undefined
    : ((navigator as unknown as { locks?: LockManagerLike }).locks ?? undefined);
}

/** Holds this tab's lock until the tab goes. */
export function holdTabLock(tabId: string): void {
  const manager = locks();
  if (!manager || heldTabId === tabId) {
    return;
  }
  heldTabId = tabId;
  void manager
    .request(`${LOCK_PREFIX}${tabId}`, () => new Promise<void>(() => undefined))
    .catch(() => undefined);
}

/** The tabs (ids) alive now, or undefined when this browser cannot tell. */
export async function aliveTabs(): Promise<Set<string> | undefined> {
  const manager = locks();
  if (!manager) {
    return undefined;
  }
  try {
    const state = await manager.query();
    return new Set(
      (state.held ?? [])
        .map((lock) => lock.name ?? "")
        .filter((name) => name.startsWith(LOCK_PREFIX))
        .map((name) => name.slice(LOCK_PREFIX.length)),
    );
  } catch {
    return undefined;
  }
}

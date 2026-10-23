"use client";

import type { PendingBatch } from "./client-state";
import type { LivePlan } from "./ops";

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
): Promise<void> {
  if (!available()) {
    return;
  }
  const db = await open();
  try {
    const store = db.transaction(STORE, "readwrite").objectStore(STORE);
    const key = pendingKey(doc, tabId);
    if (pending.length === 0) {
      await done(store.delete(key));
    } else {
      const entry: StoredPending = {
        key,
        doc,
        tabId,
        pending,
        updatedAt: new Date().toISOString(),
      };
      await done(store.put(entry));
    }
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
 * Edits made to a plan in the account while no room is open for it in this tab (the session does not know who is
 * signed in yet, or the service would not open the plan) are not batches: there is no live plan to diff against. The
 * plan as it stood before the first of them is kept instead, per design, so when the room opens the difference from
 * it to the canvas goes on top of the live plan rather than the snapshot wiping it. Same store, keys of their own
 * (no `pending`, so `readPending` never lists them).
 *
 * The first base wins until it is used or the account takes the plan: a later edit never moves it forward, or the
 * edits before it would be lost. Kept in memory as well, so a room opening moments after an edit reads the base that
 * edit is still writing.
 */

interface StoredBase {
  key: string;
  doc: string;
  tabId: string;
  base: LivePlan;
  updatedAt: string;
}

function baseKey(designId: string): string {
  return `detached|${designId}`;
}

const bases = new Map<string, Promise<LivePlan | undefined>>();

async function storedBase(designId: string): Promise<LivePlan | undefined> {
  if (!available()) {
    return undefined;
  }
  const db = await open();
  try {
    const entry = (await done(db.transaction(STORE, "readonly").objectStore(STORE).get(baseKey(designId)))) as
      | StoredBase
      | undefined;
    return entry?.base;
  } finally {
    db.close();
  }
}

async function writeBase(designId: string, base: LivePlan, onlyIfAbsent: boolean): Promise<LivePlan> {
  if (!available()) {
    return base;
  }
  const db = await open();
  try {
    const store = db.transaction(STORE, "readwrite").objectStore(STORE);
    const key = baseKey(designId);
    if (onlyIfAbsent) {
      const existing = (await done(store.get(key))) as StoredBase | undefined;
      if (existing?.base) {
        return existing.base;
      }
    }
    const entry: StoredBase = { key, doc: key, tabId: "", base, updatedAt: new Date().toISOString() };
    await done(store.put(entry));
    return base;
  } finally {
    db.close();
  }
}

/** The plan before the first edit made away from its room, unless one is kept already. */
export function keepDetachedBase(designId: string, base: LivePlan): Promise<void> {
  if (!bases.has(designId)) {
    bases.set(
      designId,
      writeBase(designId, base, true).catch(() => base),
    );
  }
  return bases.get(designId)!.then(() => undefined);
}

export async function readDetachedBase(designId: string): Promise<LivePlan | undefined> {
  const kept = bases.get(designId);
  return kept ? kept : storedBase(designId);
}

/** The account now holds the plan as `base` (a push of it went through): later edits count from there. */
export async function moveDetachedBase(designId: string, base: LivePlan): Promise<void> {
  if (!bases.has(designId) && (await storedBase(designId)) === undefined) {
    return;
  }
  bases.set(designId, Promise.resolve(base));
  await writeBase(designId, base, false);
}

/** The base was used (its edits are batches now) or the plan was replaced: nothing is waiting. */
export async function forgetDetachedBase(designId: string): Promise<void> {
  bases.delete(designId);
  if (!available()) {
    return;
  }
  const db = await open();
  try {
    await done(db.transaction(STORE, "readwrite").objectStore(STORE).delete(baseKey(designId)));
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

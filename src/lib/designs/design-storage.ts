"use client";

import type { FactoryProject } from "@/lib/model/types";
import {
  keepStoredPlanMarks,
  toDesignSummary,
  type DesignFolder,
  type DesignRecord,
  type DesignSummary,
} from "./design-library";

/*
 * Deliberately a different database from the dataset cache in
 * `lib/datasets/browser-cache.ts`. Adding a store to that one means bumping its
 * version, and a version change blocks while any other connection is open — so
 * the two would race on startup, when both are opened at once.
 */
const DB_NAME = "gtnh-factory-flow-designs";
// 2: the library's folders store. 3: the same store again, because a browser
// that hot-reloaded through the change reached 2 before the store was in the
// code, and an upgrade never re-runs at the same number; the create below is
// guarded, so a database that already has it is untouched.
const DB_VERSION = 3;

/*
 * Metadata and plans live in separate stores so the tab strip costs almost
 * nothing to draw: names and timestamps are a few hundred bytes each, while the
 * plans they belong to are hundreds of kilobytes with recipe data embedded.
 * Reading one to render the other would load every plan at startup.
 */
const META_STORE = "design-meta";
const PLAN_STORE = "design-plans";
/** The shelf's folders: a handful of named ids, read once at startup. */
const FOLDER_STORE = "design-folders";

/** Small enough, and read early enough, to be worth keeping synchronous. */
export const ACTIVE_DESIGN_STORAGE_KEY = "gtnh-factory-flow.active-design.v1";

interface StoredPlan {
  id: string;
  project: FactoryProject;
}

export function isDesignStorageAvailable(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

export async function listDesignSummaries(): Promise<DesignSummary[]> {
  if (!isDesignStorageAvailable()) {
    return [];
  }

  const db = await openDesignDb();
  try {
    return await requestToPromise<DesignSummary[]>(
      db.transaction(META_STORE, "readonly").objectStore(META_STORE).getAll(),
    );
  } finally {
    db.close();
  }
}

export async function readDesign(id: string): Promise<DesignRecord | undefined> {
  if (!isDesignStorageAvailable()) {
    return undefined;
  }

  const db = await openDesignDb();
  try {
    const transaction = db.transaction([META_STORE, PLAN_STORE], "readonly");
    const [summary, plan] = await Promise.all([
      requestToPromise<DesignSummary | undefined>(
        transaction.objectStore(META_STORE).get(id),
      ),
      requestToPromise<StoredPlan | undefined>(transaction.objectStore(PLAN_STORE).get(id)),
    ]);

    if (!summary || !plan) {
      return undefined;
    }

    return { ...summary, project: plan.project };
  } finally {
    db.close();
  }
}

export async function writeDesign(record: DesignRecord): Promise<void> {
  if (!isDesignStorageAvailable()) {
    return;
  }

  const db = await openDesignDb();
  try {
    const transaction = db.transaction([META_STORE, PLAN_STORE], "readwrite");
    transaction.objectStore(META_STORE).put(toDesignSummary(record));
    transaction.objectStore(PLAN_STORE).put({ id: record.id, project: record.project });
    await transactionToPromise(transaction);
  } finally {
    db.close();
  }
}

/** One design's metadata alone: cheap, for asking "has it moved?". */
export async function readDesignSummary(id: string): Promise<DesignSummary | undefined> {
  if (!isDesignStorageAvailable()) {
    return undefined;
  }

  const db = await openDesignDb();
  try {
    return await requestToPromise<DesignSummary | undefined>(
      db.transaction(META_STORE, "readonly").objectStore(META_STORE).get(id),
    );
  } finally {
    db.close();
  }
}

/**
 * Writes the design only if its stored plan is still the version the writer
 * started from (`expectedUpdatedAt`, the stored `updatedAt` it loaded or last
 * wrote). The check and the write are one transaction, so two browser tabs
 * saving at once cannot both pass it. `expectedUpdatedAt` undefined writes
 * unconditionally, and so does a design not stored yet.
 *
 * This is what stops a tab left open on an old copy of a plan from writing
 * that copy over hours of work saved from another tab (design-tab-sync.ts).
 */
export async function writeDesignIfUnchanged(
  record: DesignRecord,
  expectedUpdatedAt: string | undefined,
): Promise<"written" | "conflict"> {
  if (!isDesignStorageAvailable()) {
    return "written";
  }

  const db = await openDesignDb();
  try {
    const transaction = db.transaction([META_STORE, PLAN_STORE], "readwrite");
    const meta = transaction.objectStore(META_STORE);
    const outcome = await new Promise<"written" | "conflict">((resolve, reject) => {
      const current = meta.get(record.id);
      current.onerror = () => reject(current.error);
      current.onsuccess = () => {
        const stored = current.result as DesignSummary | undefined;
        if (stored && expectedUpdatedAt !== undefined && stored.updatedAt !== expectedUpdatedAt) {
          resolve("conflict");
          return;
        }
        meta.put(toDesignSummary(record));
        transaction.objectStore(PLAN_STORE).put({ id: record.id, project: record.project });
        resolve("written");
      };
    });
    await transactionToPromise(transaction);
    return outcome;
  } finally {
    db.close();
  }
}

/**
 * Writes only the metadata.
 *
 * Renaming shouldn't rewrite a megabyte of plan, and autosave shouldn't be
 * forced to wait behind it.
 *
 * The plan's own stamp and marks stay as stored (`keepStoredPlanMarks`), read
 * and written in one transaction, so a summary read before a save cannot put
 * the stamp back behind the plan.
 */
export async function writeDesignSummary(summary: DesignSummary): Promise<void> {
  if (!isDesignStorageAvailable()) {
    return;
  }

  const db = await openDesignDb();
  try {
    const transaction = db.transaction(META_STORE, "readwrite");
    const meta = transaction.objectStore(META_STORE);
    const current = meta.get(summary.id);
    current.onsuccess = () => {
      meta.put(keepStoredPlanMarks(summary, current.result as DesignSummary | undefined));
    };
    await transactionToPromise(transaction);
  } finally {
    db.close();
  }
}

export async function deleteDesign(id: string): Promise<void> {
  if (!isDesignStorageAvailable()) {
    return;
  }

  const db = await openDesignDb();
  try {
    const transaction = db.transaction([META_STORE, PLAN_STORE], "readwrite");
    transaction.objectStore(META_STORE).delete(id);
    transaction.objectStore(PLAN_STORE).delete(id);
    await transactionToPromise(transaction);
  } finally {
    db.close();
  }
}

export async function listDesignFolders(): Promise<DesignFolder[]> {
  if (!isDesignStorageAvailable()) {
    return [];
  }

  const db = await openDesignDb();
  try {
    return await requestToPromise<DesignFolder[]>(
      db.transaction(FOLDER_STORE, "readonly").objectStore(FOLDER_STORE).getAll(),
    );
  } finally {
    db.close();
  }
}

export async function writeDesignFolder(folder: DesignFolder): Promise<void> {
  if (!isDesignStorageAvailable()) {
    return;
  }

  const db = await openDesignDb();
  try {
    const transaction = db.transaction(FOLDER_STORE, "readwrite");
    transaction.objectStore(FOLDER_STORE).put(folder);
    await transactionToPromise(transaction);
  } finally {
    db.close();
  }
}

export async function deleteDesignFolder(id: string): Promise<void> {
  if (!isDesignStorageAvailable()) {
    return;
  }

  const db = await openDesignDb();
  try {
    const transaction = db.transaction(FOLDER_STORE, "readwrite");
    transaction.objectStore(FOLDER_STORE).delete(id);
    await transactionToPromise(transaction);
  } finally {
    db.close();
  }
}

export function readActiveDesignId(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    return window.localStorage.getItem(ACTIVE_DESIGN_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeActiveDesignId(id: string | undefined): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (id) {
      window.localStorage.setItem(ACTIVE_DESIGN_STORAGE_KEY, id);
    } else {
      window.localStorage.removeItem(ACTIVE_DESIGN_STORAGE_KEY);
    }
  } catch {
    // A full or blocked localStorage costs the remembered tab, nothing more.
  }
}

function openDesignDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isDesignStorageAvailable()) {
      reject(new Error("IndexedDB is not available."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(PLAN_STORE)) {
        db.createObjectStore(PLAN_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(FOLDER_STORE)) {
        db.createObjectStore(FOLDER_STORE, { keyPath: "id" });
      }
    };
    let gaveUp = false;
    request.onsuccess = () => {
      const db = request.result;
      if (gaveUp) {
        // The blocked open settled after all; nobody is waiting for it.
        db.close();
        return;
      }
      // Another tab of the app wanting a NEWER schema asks this connection
      // to step aside. Every operation here closes its own connection
      // anyway, but a long transaction should not be the thing that blocks
      // the other tab's upgrade forever.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    // The mirror case: THIS open wants a newer schema than a connection some
    // other tab is holding. Without this the open just never settles, the
    // library never hydrates, and the strip sits empty with a dead plus. A
    // clear failure is better than a silent hang; a reload once the other
    // tab has let go clears it.
    request.onblocked = () => {
      gaveUp = true;
      reject(
        new Error(
          "The design library is open in another tab. Close or reload that tab, then reload this one.",
        ),
      );
    };
    request.onerror = () => reject(request.error ?? new Error("Could not open IndexedDB."));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

/**
 * Resolves on `complete` rather than on the last request's `success`, so a
 * two-store write is only reported saved once both stores have committed.
 */
function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB write aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB write failed."));
  });
}

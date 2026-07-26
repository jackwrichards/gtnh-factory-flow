"use client";

import type { FactoryProject } from "@/lib/model/types";
import { toDesignSummary, type DesignRecord, type DesignSummary } from "./design-library";

/*
 * Deliberately a different database from the dataset cache in
 * `lib/datasets/browser-cache.ts`. Adding a store to that one means bumping its
 * version, and a version change blocks while any other connection is open — so
 * the two would race on startup, when both are opened at once.
 */
const DB_NAME = "gtnh-factory-flow-designs";
const DB_VERSION = 1;

/*
 * Metadata and plans live in separate stores so the tab strip costs almost
 * nothing to draw: names and timestamps are a few hundred bytes each, while the
 * plans they belong to are hundreds of kilobytes with recipe data embedded.
 * Reading one to render the other would load every plan at startup.
 */
const META_STORE = "design-meta";
const PLAN_STORE = "design-plans";

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

/**
 * Writes only the metadata.
 *
 * Renaming shouldn't rewrite a megabyte of plan, and autosave shouldn't be
 * forced to wait behind it.
 */
export async function writeDesignSummary(summary: DesignSummary): Promise<void> {
  if (!isDesignStorageAvailable()) {
    return;
  }

  const db = await openDesignDb();
  try {
    const transaction = db.transaction(META_STORE, "readwrite");
    transaction.objectStore(META_STORE).put(summary);
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
    };
    request.onsuccess = () => resolve(request.result);
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

"use client";

import type { FactoryProject } from "@/lib/model/types";
import type { PendingBatch } from "@/lib/live/client-state";
import { isDesignOpenLive } from "@/store/live-edit-gate";
import {
  FINGERPRINT_VERSION,
  planFingerprints,
  type PlanFingerprints,
} from "../import-export/import-fingerprint";
import {
  keepStoredPlanMarks,
  toDesignSummary,
  touchDesignMeta,
  type DesignFolder,
  type DesignRecord,
  type DesignSummary,
} from "./design-library";

/*
 * Designs keep their own database: adding a store to a shared one means a
 * version bump, which blocks while another connection is open.
 */
const DB_NAME = "gtnh-factory-flow-designs";
// 3 adds the folders store (2 also did, but some browsers reached 2 without
// it). The create below is guarded, so an existing store is untouched.
const DB_VERSION = 3;

/*
 * Metadata and plans live in separate stores so the tab strip can be drawn
 * without loading every plan (hundreds of kilobytes each) at startup.
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
  liveReplacement?: LiveReplacementOutbox;
}

/** Local delivery intent, stored with the plan body and never exported or synced. */
export interface LiveReplacementOutbox {
  doc: string;
  pending: PendingBatch[];
}

export async function readDesignLiveReplacement(
  id: string,
): Promise<LiveReplacementOutbox | undefined> {
  if (!isDesignStorageAvailable()) return undefined;
  const db = await openDesignDb();
  try {
    const plan = await requestToPromise<StoredPlan | undefined>(
      db.transaction(PLAN_STORE).objectStore(PLAN_STORE).get(id),
    );
    return plan?.liveReplacement;
  } finally {
    db.close();
  }
}

/** Only the server's acknowledgement or explicit refusal settles an outbox batch. */
export async function settleDesignLiveReplacement(
  id: string,
  doc: string,
  cid: string,
): Promise<void> {
  if (!isDesignStorageAvailable()) return;
  const db = await openDesignDb();
  try {
    const transaction = db.transaction(PLAN_STORE, "readwrite");
    const completed = transactionToPromise(transaction);
    const store = transaction.objectStore(PLAN_STORE);
    const request = store.get(id);
    request.onsuccess = () => {
      const plan = request.result as StoredPlan | undefined;
      if (!plan?.liveReplacement || plan.liveReplacement.doc !== doc) return;
      const pending = plan.liveReplacement.pending.filter((batch) => batch.cid !== cid);
      if (pending.length === plan.liveReplacement.pending.length) return;
      if (pending.length) plan.liveReplacement = { doc, pending };
      else delete plan.liveReplacement;
      store.put(plan);
    };
    await completed;
  } finally {
    db.close();
  }
}

/** Ordinary saves retain delivery intent until the live service settles it. */
function putPlanPreservingOutbox(store: IDBObjectStore, record: DesignRecord): void {
  const request = store.get(record.id);
  request.onsuccess = () => {
    const stored = request.result as StoredPlan | undefined;
    store.put({
      id: record.id,
      project: record.project,
      ...(stored?.liveReplacement ? { liveReplacement: stored.liveReplacement } : {}),
    });
  };
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

export async function readDesign(
  id: string,
  expectedFull?: string,
): Promise<DesignRecord | undefined> {
  if (!isDesignStorageAvailable()) {
    return undefined;
  }

  const db = await openDesignDb();
  try {
    if (expectedFull !== undefined) {
      // Validate the same body that will land, and reopen its fresh metadata
      // atomically. A later unchecked read could open a different plan.
      const transaction = db.transaction([META_STORE, PLAN_STORE], "readwrite");
      const completed = transactionToPromise(transaction);
      const meta = transaction.objectStore(META_STORE);
      const summaryRequest = meta.get(id);
      const planRequest = transaction.objectStore(PLAN_STORE).get(id);
      let summary: DesignSummary | undefined, plan: StoredPlan | undefined;
      let summaryReady = false,
        planReady = false;
      let result: DesignRecord | undefined;
      const finish = () => {
        if (
          !summaryReady ||
          !planReady ||
          !summary ||
          !plan ||
          summary.cloud ||
          summary.fingerprints?.version !== FINGERPRINT_VERSION ||
          summary.fingerprints.full !== expectedFull
        )
          return;
        if (summary.closed) {
          summary = touchDesignMeta(summary);
          delete summary.closed;
          meta.put(summary);
        }
        result = { ...summary, project: plan.project };
      };
      summaryRequest.onsuccess = () => {
        summary = summaryRequest.result;
        summaryReady = true;
        finish();
      };
      planRequest.onsuccess = () => {
        plan = planRequest.result;
        planReady = true;
        finish();
      };
      await completed;
      return result;
    }
    const transaction = db.transaction([META_STORE, PLAN_STORE], "readonly");
    const [summary, plan] = await Promise.all([
      requestToPromise<DesignSummary | undefined>(transaction.objectStore(META_STORE).get(id)),
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

  const fingerprints = await planFingerprints(record.project);
  const db = await openDesignDb();
  try {
    const transaction = db.transaction([META_STORE, PLAN_STORE], "readwrite");
    transaction.objectStore(META_STORE).put(toDesignSummary({ ...record, fingerprints }));
    putPlanPreservingOutbox(transaction.objectStore(PLAN_STORE), record);
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
 * This stops a tab left open on an old copy from overwriting work saved from
 * another tab (design-tab-sync.ts).
 */
export async function writeDesignIfUnchanged(
  record: DesignRecord,
  expectedUpdatedAt: string | undefined,
): Promise<"written" | "conflict"> {
  if (!isDesignStorageAvailable()) {
    return "written";
  }

  const fingerprints = await planFingerprints(record.project);
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
        const summary = toDesignSummary({ ...record, fingerprints });
        meta.put(summary);
        putPlanPreservingOutbox(transaction.objectStore(PLAN_STORE), record);
        resolve("written");
      };
    });
    await transactionToPromise(transaction);
    return outcome;
  } finally {
    db.close();
  }
}

/** Replacement must not resurrect a deletion or roll back a metadata-only edit. */
export async function replaceDesignIfUnchanged(
  record: DesignRecord,
  expected: Pick<DesignSummary, "updatedAt" | "metaUpdatedAt" | "remoteUpdatedAt">,
  liveReplacement?: LiveReplacementOutbox,
): Promise<"written" | "conflict" | "missing" | "live"> {
  if (!isDesignStorageAvailable()) return "missing";
  const fingerprints = await planFingerprints(record.project);
  const db = await openDesignDb();
  try {
    const transaction = db.transaction([META_STORE, PLAN_STORE], "readwrite");
    const meta = transaction.objectStore(META_STORE);
    const plans = transaction.objectStore(PLAN_STORE);
    const outcome = new Promise<"written" | "conflict" | "missing" | "live">((resolve, reject) => {
      const current = meta.get(record.id);
      current.onerror = () => reject(current.error);
      current.onsuccess = () => {
        const stored = current.result as DesignSummary | undefined;
        if (!stored) {
          resolve("missing");
          return;
        }
        if (
          stored.updatedAt !== expected.updatedAt ||
          stored.metaUpdatedAt !== expected.metaUpdatedAt ||
          stored.remoteUpdatedAt !== expected.remoteUpdatedAt ||
          stored.cloud
        ) {
          resolve("conflict");
          return;
        }
        const plan = plans.get(record.id);
        plan.onerror = () => reject(plan.error);
        plan.onsuccess = () => {
          if (plan.result === undefined) {
            resolve("missing");
            return;
          }
          // Fingerprinting and opening this transaction both yield. The live
          // mark can change without either IndexedDB timestamp changing.
          if (isDesignOpenLive(record.id) || (plan.result as StoredPlan).liveReplacement) {
            resolve("live");
            return;
          }
          meta.put(toDesignSummary({ ...record, fingerprints }));
          plans.put({
            id: record.id,
            project: record.project,
            ...(liveReplacement?.pending.length ? { liveReplacement } : {}),
          });
          resolve("written");
        };
      };
    });
    const [result] = await Promise.all([outcome, transactionToPromise(transaction)]);
    return result;
  } finally {
    db.close();
  }
}

/**
 * Writes only the metadata, so a rename never rewrites the whole plan.
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

/** Migration writes only derived metadata and never stamps or rewrites a plan. */
export async function backfillDesignFingerprints(
  id: string,
  updatedAt: string,
  fingerprints: PlanFingerprints,
  expectedFingerprints?: PlanFingerprints,
): Promise<boolean> {
  const db = await openDesignDb();
  try {
    const tx = db.transaction(META_STORE, "readwrite");
    const completed = transactionToPromise(tx);
    const store = tx.objectStore(META_STORE);
    let written = false;
    const request = store.get(id);
    request.onsuccess = () => {
      const stored = request.result as DesignSummary | undefined;
      // Live copies keep their edit stamp. Their freshly written fingerprints
      // must win over a migration computed from an older body with that stamp.
      if (
        stored?.updatedAt === updatedAt &&
        !(stored.fingerprints && stored.fingerprints.version >= fingerprints.version) &&
        stored.fingerprints?.version === expectedFingerprints?.version &&
        stored.fingerprints?.simple === expectedFingerprints?.simple &&
        stored.fingerprints?.full === expectedFingerprints?.full
      ) {
        store.put({ ...stored, fingerprints });
        written = true;
      }
    };
    await completed;
    return written;
  } finally {
    db.close();
  }
}

export async function deleteDesign(
  id: string,
  expectedUpdatedAt?: string,
  canDelete?: (stored: DesignSummary | undefined) => boolean,
): Promise<boolean> {
  if (!isDesignStorageAvailable()) {
    return false;
  }

  const db = await openDesignDb();
  try {
    const transaction = db.transaction([META_STORE, PLAN_STORE], "readwrite");
    const meta = transaction.objectStore(META_STORE);
    let deleted = false;
    const remove = () => {
      meta.delete(id);
      transaction.objectStore(PLAN_STORE).delete(id);
      deleted = true;
    };
    if (expectedUpdatedAt === undefined && !canDelete) remove();
    else {
      const current = meta.get(id);
      current.onsuccess = () => {
        const stored = current.result as DesignSummary | undefined;
        if (
          (expectedUpdatedAt === undefined || stored?.updatedAt === expectedUpdatedAt) &&
          (!canDelete || canDelete(stored))
        )
          remove();
      };
    }
    await transactionToPromise(transaction);
    return deleted;
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
      // Another tab wanting a NEWER schema asks this connection to step
      // aside, so a long transaction here never blocks its upgrade.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    // The mirror case: THIS open wants a newer schema than a connection
    // another tab holds. Otherwise the open never settles and the library
    // never hydrates; a clear failure beats a silent hang.
    request.onblocked = () => {
      gaveUp = true;
      reject(
        new Error(
          "Your plans are open in another tab. Close or reload that tab, then reload this one.",
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

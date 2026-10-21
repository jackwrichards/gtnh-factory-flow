import { FINGERPRINT_VERSION, planFingerprints } from "../import-export/import-fingerprint";
import {
  backfillDesignFingerprints,
  isDesignStorageAvailable,
  listDesignSummaries,
  readDesign,
} from "./design-storage";

export const FINGERPRINT_MIGRATION_KEY = `gtnh-factory-flow.plan-fingerprints.v${FINGERPRINT_VERSION}`;
let running: Promise<void> | undefined;

/** Resumable once per browser library. Imports await this same background job. */
export function ensurePlanFingerprintMigration(): Promise<void> {
  if (!isDesignStorageAvailable()) return Promise.resolve();
  if (!running) {
    const run = () => migrate();
    running = (
      typeof navigator !== "undefined" && navigator.locks
        ? navigator.locks.request(FINGERPRINT_MIGRATION_KEY, run).then(() => undefined)
        : run()
    ).finally(() => {
      running = undefined;
    });
  }
  return running;
}

async function migrate(): Promise<void> {
  let skipped: Record<string, string> = {};
  try {
    const state = JSON.parse(localStorage.getItem(FINGERPRINT_MIGRATION_KEY) ?? "null");
    if (state?.complete) return;
    skipped = state?.skipped ?? {};
  } catch {
    /* Per-record fingerprints still make interrupted work resumable. */
  }
  const summaries = await listDesignSummaries();
  for (const summary of summaries) {
    if (
      (summary.fingerprints && summary.fingerprints.version >= FINGERPRINT_VERSION) ||
      skipped[summary.id] === summary.updatedAt
    )
      continue;
    const record = await readDesign(summary.id);
    if (!record || (record.fingerprints && record.fingerprints.version >= FINGERPRINT_VERSION))
      continue;
    let fingerprints;
    try {
      fingerprints = await planFingerprints(record.project);
    } catch {
      // Leave unreadable plans intact. A later successful plan write repairs
      // its fingerprints without needing this migration to revisit the body.
      skipped[summary.id] = record.updatedAt;
      remember(false, skipped);
      continue;
    }
    await backfillDesignFingerprints(
      record.id,
      record.updatedAt,
      fingerprints,
      record.fingerprints,
    );
    // Yield between plans so a large library does not block editing.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const remaining = await listDesignSummaries();
  const complete = remaining.every(
    (summary) =>
      (summary.fingerprints && summary.fingerprints.version >= FINGERPRINT_VERSION) ||
      skipped[summary.id] === summary.updatedAt,
  );
  remember(complete, skipped);
}

function remember(complete: boolean, skipped: Record<string, string>): void {
  try {
    localStorage.setItem(FINGERPRINT_MIGRATION_KEY, JSON.stringify({ complete, skipped }));
  } catch {
    /* Valid record stamps avoid repeating completed work without a marker. */
  }
}

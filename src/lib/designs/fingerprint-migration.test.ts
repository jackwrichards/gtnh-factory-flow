import { beforeEach, expect, it, vi } from "vitest";
import type { DesignRecord } from "./design-library";
const storage = vi.hoisted(() => ({
  records: new Map<string, DesignRecord>(),
  available: true,
  read: vi.fn(),
  write: vi.fn(),
}));
vi.mock("./design-storage", () => ({
  isDesignStorageAvailable: () => storage.available,
  listDesignSummaries: async () => [...storage.records.values()],
  readDesign: storage.read,
  backfillDesignFingerprints: storage.write,
}));
import { createEmptyProject } from "@/examples";
import { ensurePlanFingerprintMigration, FINGERPRINT_MIGRATION_KEY } from "./fingerprint-migration";
import { FINGERPRINT_VERSION, type PlanFingerprints } from "../import-export/import-fingerprint";
const marker = new Map<string, string>();
beforeEach(() => {
  vi.clearAllMocks();
  storage.records.clear();
  marker.clear();
  storage.available = true;
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => marker.get(key) ?? null,
    setItem: (key: string, value: string) => marker.set(key, value),
  });
  for (const id of ["first", "second"])
    storage.records.set(id, {
      id,
      name: id,
      createdAt: "created",
      updatedAt: "saved",
      project: createEmptyProject(),
    });
  storage.read.mockImplementation(async (id: string) => storage.records.get(id));
  storage.write.mockImplementation(
    async (
      id: string,
      stamp: string,
      fingerprints: PlanFingerprints,
      expected?: PlanFingerprints,
    ) => {
      const record = storage.records.get(id)!;
      if (record.updatedAt !== stamp) return false;
      if (record.fingerprints && record.fingerprints.version >= fingerprints.version) return false;
      if (JSON.stringify(record.fingerprints) !== JSON.stringify(expected)) return false;
      record.fingerprints = fingerprints;
      return true;
    },
  );
});
it("keeps current fingerprints written by a live save with the same edit stamp", async () => {
  const { planFingerprints } = await import("../import-export/import-fingerprint");
  const fresh = await planFingerprints({ ...createEmptyProject(), notes: "New live content" });
  const write = storage.write.getMockImplementation()!;
  storage.write.mockImplementationOnce(async (...args) => {
    const record = storage.records.get("first")!;
    record.project = { ...record.project, notes: "New live content" };
    record.fingerprints = fresh;
    return write(...args);
  });
  await ensurePlanFingerprintMigration();
  expect(storage.records.get("first")!.fingerprints).toEqual(fresh);
  expect(storage.records.get("first")!.updatedAt).toBe("saved");
  expect(JSON.parse(marker.get(FINGERPRINT_MIGRATION_KEY)!).complete).toBe(true);
});

it("passes the originally read older fingerprints into the atomic backfill guard", async () => {
  const original = { version: 2, simple: "old", full: "old" } as unknown as PlanFingerprints;
  storage.records.get("first")!.fingerprints = original;
  await ensurePlanFingerprintMigration();
  expect(storage.write.mock.calls[0][3]).toEqual(original);
  expect(storage.records.get("first")!.fingerprints?.version).toBe(FINGERPRINT_VERSION);
});
it("backfills once, preserving plan stamps and skipping the completed library thereafter", async () => {
  await ensurePlanFingerprintMigration();
  expect(storage.write).toHaveBeenCalledTimes(2);
  expect(storage.records.get("first")!.updatedAt).toBe("saved");
  expect(JSON.parse(marker.get(FINGERPRINT_MIGRATION_KEY)!).complete).toBe(true);
  await ensurePlanFingerprintMigration();
  expect(storage.read).toHaveBeenCalledTimes(2);
});
it("rebuilds older fingerprint versions even when their previous migration completed", async () => {
  marker.set("gtnh-factory-flow.plan-fingerprints.v2", JSON.stringify({ complete: true }));
  for (const record of storage.records.values()) {
    record.fingerprints = {
      version: 2,
      simple: "old-simple",
      full: "old-full",
    } as unknown as PlanFingerprints;
  }
  await ensurePlanFingerprintMigration();
  expect(storage.write).toHaveBeenCalledTimes(2);
  expect(storage.records.get("first")!.fingerprints?.version).toBe(FINGERPRINT_VERSION);
  expect(JSON.parse(marker.get(FINGERPRINT_MIGRATION_KEY)!).complete).toBe(true);
});
it("resumes interrupted work without rereading completed bodies", async () => {
  storage.read
    .mockImplementationOnce(async () => storage.records.get("first"))
    .mockRejectedValueOnce(new Error("Database temporarily unavailable"));
  await expect(ensurePlanFingerprintMigration()).rejects.toThrow("temporarily unavailable");
  expect(storage.records.get("first")!.fingerprints?.version).toBe(FINGERPRINT_VERSION);
  await ensurePlanFingerprintMigration();
  expect(storage.write.mock.calls.map((call) => call[0])).toEqual(["first", "second"]);
});
it("records unreadable saves as skipped without rewriting them", async () => {
  storage.records.get("first")!.project.nodes = null as never;
  await ensurePlanFingerprintMigration();
  expect(storage.records.get("first")!.fingerprints).toBeUndefined();
  expect(storage.records.get("second")!.fingerprints?.version).toBe(FINGERPRINT_VERSION);
  expect(JSON.parse(marker.get(FINGERPRINT_MIGRATION_KEY)!).skipped.first).toBe("saved");
});
it("does not mark incomplete work complete when a save wins the version check", async () => {
  storage.write.mockResolvedValueOnce(false);
  await ensurePlanFingerprintMigration();
  expect(JSON.parse(marker.get(FINGERPRINT_MIGRATION_KEY)!).complete).toBe(false);
  await ensurePlanFingerprintMigration();
  expect(storage.records.get("first")!.fingerprints?.version).toBe(FINGERPRINT_VERSION);
});

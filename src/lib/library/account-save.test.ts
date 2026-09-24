import { beforeEach, expect, it, vi } from "vitest";
import type { DesignRecord } from "@/lib/designs/design-library";
import { createEmptyProject } from "@/examples/empty-project";
import { accountSaveStatus } from "./save-status";

const storage = vi.hoisted(() => ({ records: new Map<string, DesignRecord>() }));
const api = vi.hoisted(() => ({
  fetchRemoteLibrary: vi.fn(),
  fetchRemoteDesignPlan: vi.fn(),
  pushRemoteDesign: vi.fn(),
}));
vi.mock("./client", () => api);
vi.mock("./library-deletes", () => ({ readPendingDeletes: () => ({ designs: [], folders: [] }) }));
vi.mock("@/lib/designs/design-storage", () => ({
  listDesignSummaries: async () => [...storage.records.values()],
  listDesignFolders: async () => [],
  readDesign: async (id: string) => storage.records.get(id),
  writeDesign: async (record: DesignRecord) => {
    storage.records.set(record.id, record);
  },
  writeDesignSummary: async (record: DesignRecord) => {
    storage.records.set(record.id, { ...storage.records.get(record.id)!, ...record });
  },
}));
vi.mock("@/store/design-store", async () => {
  const { create } = await import("zustand");
  return {
    useDesignStore: create(() => ({ refreshLibrary: async () => {}, activeDesignId: undefined })),
  };
});
import { useCommunityAuthStore } from "@/store/community-auth-store";
import { syncLibraryNow, useLibrarySyncStore } from "./library-sync";

const stamp = "2026-09-11T00:00:00.000Z";
const meta = {
  id: "private-design",
  name: "Unpublished work",
  createdAt: stamp,
  updatedAt: stamp,
  planUpdatedAt: stamp,
  icon: null,
  folderId: null,
  closed: false,
  favorite: false,
  order: null,
  communityPlanId: null,
  deletedAt: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  storage.records.clear();
  useCommunityAuthStore.setState({ user: { username: "test", isAdmin: false } });
  useLibrarySyncStore.setState({ state: "off", message: undefined, lastSyncedAt: undefined });
});

it("automatically uploads unpublished work and restores it into an empty device library", async () => {
  const project = {
    ...createEmptyProject(),
    name: meta.name,
    description: "Keep my private draft",
  };
  storage.records.set(meta.id, {
    id: meta.id,
    name: meta.name,
    createdAt: stamp,
    updatedAt: stamp,
    project,
  });
  api.fetchRemoteLibrary.mockResolvedValue({ designs: [], folders: [] });
  api.pushRemoteDesign.mockResolvedValue({ design: meta, behind: false });
  await syncLibraryNow();
  expect(api.pushRemoteDesign).toHaveBeenCalledWith(
    meta.id,
    expect.objectContaining({
      communityPlanId: null,
      plan: project,
    }),
  );
  expect(accountSaveStatus(true, useLibrarySyncStore.getState()).text).toBe("Saved to account");

  storage.records.clear();
  api.fetchRemoteLibrary.mockResolvedValue({ designs: [meta], folders: [] });
  api.fetchRemoteDesignPlan.mockResolvedValue({ design: meta, plan: project });
  await syncLibraryNow();
  expect(storage.records.get(meta.id)?.project.description).toBe("Keep my private draft");
  expect(storage.records.get(meta.id)?.communityPlanId).toBeUndefined();
});

it("keeps the local draft and retries after a database outage without a reload", async () => {
  const record = {
    id: meta.id,
    name: meta.name,
    createdAt: stamp,
    updatedAt: stamp,
    project: createEmptyProject(),
  };
  storage.records.set(meta.id, record);
  api.fetchRemoteLibrary.mockRejectedValueOnce(
    new Error("Library sync is out of date: schema.sql"),
  );
  await syncLibraryNow();
  expect(storage.records.get(meta.id)).toEqual(record);
  expect(accountSaveStatus(true, useLibrarySyncStore.getState())).toEqual({
    text: "Not saved to account — retrying",
    error: true,
  });
  api.fetchRemoteLibrary.mockResolvedValue({ designs: [], folders: [] });
  api.pushRemoteDesign.mockResolvedValue({ design: meta, behind: false });
  await syncLibraryNow();
  expect(api.pushRemoteDesign).toHaveBeenCalledTimes(1);
  expect(useLibrarySyncStore.getState().state).toBe("idle");
});

it("does not resend a design the account refused until it changes", async () => {
  // 2026-09-24: a 3.2 MB plan the server refuses as too large went up every
  // 30 s for hours.
  const id = "too-large-design";
  const record = { id, name: "Huge", createdAt: stamp, updatedAt: stamp, project: createEmptyProject() };
  storage.records.set(id, record);
  api.fetchRemoteLibrary.mockResolvedValue({ designs: [], folders: [] });
  api.pushRemoteDesign.mockRejectedValue(
    Object.assign(new Error("This design is too large to sync."), { refused: true, status: 413 }),
  );
  await syncLibraryNow();
  await syncLibraryNow();
  await syncLibraryNow();
  expect(api.pushRemoteDesign).toHaveBeenCalledTimes(1);
  expect(accountSaveStatus(true, useLibrarySyncStore.getState())).toEqual({
    text: "Not saved to account",
    error: true,
  });
  expect(useLibrarySyncStore.getState().message).toContain("too large");

  // An edit is a new design as far as the account is concerned: try again.
  const edited = "2026-09-11T00:05:00.000Z";
  storage.records.set(id, { ...record, updatedAt: edited, metaUpdatedAt: edited });
  api.pushRemoteDesign.mockResolvedValue({
    design: { ...meta, id, updatedAt: edited, planUpdatedAt: edited },
    behind: false,
  });
  await syncLibraryNow();
  expect(api.pushRemoteDesign).toHaveBeenCalledTimes(2);
  expect(useLibrarySyncStore.getState().state).toBe("idle");
});

it("stamps a push with the later of the plan and metadata times", async () => {
  // A metadata stamp older than the plan's must not be sent as the change
  // time, or the design reads as unsaved on every poll and is pushed forever.
  const id = "meta-behind-plan";
  const planAt = "2026-09-11T00:10:00.000Z";
  storage.records.set(id, {
    id,
    name: "Edited after a rename",
    createdAt: stamp,
    updatedAt: planAt,
    metaUpdatedAt: stamp,
    project: createEmptyProject(),
  });
  api.fetchRemoteLibrary.mockResolvedValue({ designs: [], folders: [] });
  api.pushRemoteDesign.mockImplementation(async (_id: string, body: { updatedAt: string }) => ({
    design: { ...meta, id, updatedAt: body.updatedAt, planUpdatedAt: planAt },
    behind: false,
  }));
  await syncLibraryNow();
  expect(api.pushRemoteDesign).toHaveBeenCalledWith(
    id,
    expect.objectContaining({ updatedAt: planAt, planUpdatedAt: planAt }),
  );
  expect(storage.records.get(id)?.remoteUpdatedAt).toBe(planAt);
});

it("never labels an unconfirmed account save as saved", () => {
  for (const state of ["off", "pending", "syncing", "idle"] as const) {
    expect(accountSaveStatus(true, { state }).text).toBe("Saving to account…");
  }
  expect(accountSaveStatus(false, { state: "off" }).text).toBe("Saved on this device");
});

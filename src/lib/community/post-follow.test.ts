// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const patchCommunityPlan = vi.fn();
const uploadPlanPreview = vi.fn();
const capturePlanPreviewPng = vi.fn(async () => new Blob(["png"]));
const readDesign = vi.fn();
const writeDesign = vi.fn();
const refreshLibrary = vi.fn(async () => undefined);
const clearProjectCommunityLink = vi.fn();
let user: { username: string } | undefined = { username: "jack" };
let activeDesignId: string | undefined = "d1";

vi.mock("./client", () => ({
  patchCommunityPlan: (...args: unknown[]) => patchCommunityPlan(...args),
  uploadPlanPreview: (...args: unknown[]) => uploadPlanPreview(...args),
}));
vi.mock("./plan-preview-capture", () => ({
  capturePlanPreviewPng: () => capturePlanPreviewPng(),
}));
vi.mock("@/lib/designs/design-storage", () => ({
  readDesign: (id: string) => readDesign(id),
  writeDesignIfUnchanged: async (record: unknown) => {
    await writeDesign(record);
    return "written";
  },
}));
vi.mock("@/lib/setups-tab", () => ({ notifySetupsChanged: () => undefined }));
vi.mock("@/store/community-auth-store", () => ({
  useCommunityAuthStore: { getState: () => ({ user }) },
}));
vi.mock("@/store/design-store", () => ({
  useDesignStore: { getState: () => ({ activeDesignId, refreshLibrary }) },
}));
vi.mock("@/store/factory-store", () => ({
  useFactoryStore: { getState: () => ({ clearProjectCommunityLink }) },
}));

import { createEmptyProject } from "@/examples/empty-project";
import { flushPostFollow, retryPendingPostFollows, schedulePostFollow } from "./post-follow";

const design = (linked: boolean) => ({
  id: "d1",
  name: "Cobble",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  project: {
    ...createEmptyProject(),
    name: "Cobble",
    description: "Rocks",
    metadata: linked ? { communityPlanId: "post-1" } : {},
  },
});

const settle = async () => {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
};

describe("post-follow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    patchCommunityPlan.mockReset().mockResolvedValue({ id: "post-1" });
    uploadPlanPreview.mockReset().mockResolvedValue(undefined);
    capturePlanPreviewPng.mockClear();
    readDesign.mockReset().mockResolvedValue(design(true));
    writeDesign.mockReset().mockResolvedValue(undefined);
    refreshLibrary.mockClear();
    clearProjectCommunityLink.mockClear();
    user = { username: "jack" };
    activeDesignId = "d1";
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pushes the design to its post once, a few seconds after the last save", async () => {
    schedulePostFollow("d1", true);
    schedulePostFollow("d1", true);
    schedulePostFollow("d1", true);
    expect(patchCommunityPlan).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(6_000);
    await settle();
    expect(patchCommunityPlan).toHaveBeenCalledTimes(1);
    const [planId, fields] = patchCommunityPlan.mock.calls[0] as [string, Record<string, unknown>];
    expect(planId).toBe("post-1");
    expect(fields.name).toBe("Cobble");
    expect(fields.description).toBe("Rocks");
    expect(fields.plan).toMatchObject({ name: "Cobble" });
  });

  it.each(["build", "solve", "pool"] as const)("publishes the saved %s mode", async (mode) => {
    const record = design(true);
    Object.assign(record.project, { solveMode: mode !== "build" || undefined, poolMode: mode === "pool" || undefined });
    readDesign.mockResolvedValue(record);
    schedulePostFollow("d1", true);
    await vi.advanceTimersByTimeAsync(10_000);
    const plan = patchCommunityPlan.mock.calls[0][1].plan;
    expect(Boolean(plan.solveMode)).toBe(mode !== "build");
    expect(Boolean(plan.poolMode)).toBe(mode === "pool");
  });

  it("does nothing for a design with no post", async () => {
    schedulePostFollow("d1", false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(readDesign).not.toHaveBeenCalled();
    expect(patchCommunityPlan).not.toHaveBeenCalled();
  });

  it("syncs repeated saves without taking over the live board to capture previews", async () => {
    // The old preview timer fired 30s after each push. Reproduce several
    // minute-spaced saves of the active shared design, with time to idle.
    for (let minute = 0; minute < 3; minute += 1) {
      schedulePostFollow("d1", true);
      await vi.advanceTimersByTimeAsync(60_000);
      await settle();
      expect(patchCommunityPlan).toHaveBeenCalledTimes(minute + 1);
      expect(capturePlanPreviewPng).not.toHaveBeenCalled();
      expect(uploadPlanPreview).not.toHaveBeenCalled();
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("drops the link when the server says the post is not yours or is gone", async () => {
    patchCommunityPlan.mockRejectedValue(Object.assign(new Error("You don't own this post."), { status: 403 }));
    flushPostFollow("d1");
    schedulePostFollow("d1", true);
    await vi.advanceTimersByTimeAsync(6_000);
    await settle();

    expect(writeDesign).toHaveBeenCalledTimes(1);
    const written = writeDesign.mock.calls[0][0] as { project: { metadata: Record<string, unknown> } };
    expect(written.project.metadata.communityPlanId).toBeUndefined();
    expect(clearProjectCommunityLink).toHaveBeenCalled();
    expect(refreshLibrary).toHaveBeenCalled();
  });

  it("keeps the link on a hiccup and waits for the next save", async () => {
    patchCommunityPlan.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    schedulePostFollow("d1", true);
    await vi.advanceTimersByTimeAsync(6_000);
    await settle();
    expect(writeDesign).not.toHaveBeenCalled();
  });

  it("remembers a push made while signed out and sends it at the next sign-in", async () => {
    user = undefined;
    schedulePostFollow("d1", true);
    await vi.advanceTimersByTimeAsync(6_000);
    await settle();
    expect(patchCommunityPlan).not.toHaveBeenCalled();

    user = { username: "jack" };
    retryPendingPostFollows();
    await vi.advanceTimersByTimeAsync(6_000);
    await settle();
    expect(patchCommunityPlan).toHaveBeenCalledTimes(1);

    // Sent: nothing left to retry.
    retryPendingPostFollows();
    await vi.advanceTimersByTimeAsync(6_000);
    await settle();
    expect(patchCommunityPlan).toHaveBeenCalledTimes(1);
  });

  it("flushes at once when the design leaves the canvas", async () => {
    schedulePostFollow("d1", true);
    flushPostFollow("d1");
    await settle();
    expect(patchCommunityPlan).toHaveBeenCalledTimes(1);
  });
});

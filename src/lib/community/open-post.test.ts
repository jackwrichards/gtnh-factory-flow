import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "@/examples";

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  summary: vi.fn(),
  viewPublicProject: vi.fn(),
  importProjectAsDesign: vi.fn(),
  switchToDesign: vi.fn(),
}));
vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  downloadCommunityPlan: mocks.download,
  getCommunityPlan: mocks.summary,
}));
vi.mock("@/store/design-store", () => ({
  useDesignStore: {
    getState: () => ({
      designs: [{ id: "personal", communityPlanId: "post" }],
      ...mocks,
    }),
  },
}));
vi.mock("@/lib/plan-view", () => ({ applyPlanView: vi.fn() }));
import { copyCommunityPost, openCommunityPost } from "./open-post";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.download.mockResolvedValue({ plan: createEmptyProject(), name: "Public setup" });
  mocks.summary.mockResolvedValue({ isMine: false, name: "Public setup", authorName: "Author" });
});

describe("opening public posts", () => {
  it("copies directly into a private design without opening the viewer or resuming a linked design", async () => {
    mocks.download.mockResolvedValue({
      plan: { ...createEmptyProject(), metadata: { communityPlanId: "post" } },
      name: "Public setup",
    });
    await copyCommunityPost({ id: "post", name: "Selected setup" });
    expect(mocks.importProjectAsDesign).toHaveBeenCalledTimes(1);
    const [project, name] = mocks.importProjectAsDesign.mock.calls[0];
    expect(project.metadata?.communityPlanId).toBeUndefined();
    expect(name).toBe("Selected setup");
    expect(mocks.viewPublicProject).not.toHaveBeenCalled();
    expect(mocks.switchToDesign).not.toHaveBeenCalled();
  });
  it("opens another author's setup for viewing, even with an old linked local copy", async () => {
    expect(await openCommunityPost({ id: "post" })).toBe("viewed");
    expect(mocks.viewPublicProject).toHaveBeenCalledWith(
      { id: "post", name: "Public setup", authorName: "Author" },
      expect.anything(),
    );
    expect(mocks.importProjectAsDesign).not.toHaveBeenCalled();
    expect(mocks.switchToDesign).not.toHaveBeenCalled();
  });

  it("opens the owner's existing linked design without downloading a copy", async () => {
    expect(await openCommunityPost({ id: "post", isMine: true })).toBe("opened");
    expect(mocks.switchToDesign).toHaveBeenCalledWith("personal");
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.viewPublicProject).not.toHaveBeenCalled();
  });

  it("restores an owner's missing design with its publishing connection", async () => {
    await openCommunityPost({ id: "other-post", isMine: true });
    expect(mocks.importProjectAsDesign).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ communityPlanId: "other-post" }),
      }),
      "Public setup",
    );
  });
});


it.each(["build", "solve", "pool"] as const)("opens a posted %s setup in its saved mode", async (mode) => {
  mocks.download.mockResolvedValue({
    name: "Saved mode",
    plan: { ...createEmptyProject(), solveMode: mode !== "build" || undefined, poolMode: mode === "pool" || undefined },
  });
  await openCommunityPost({ id: "mode-post", isMine: false, authorName: "Author" });
  const project = mocks.viewPublicProject.mock.calls[0][1];
  expect(Boolean(project.solveMode)).toBe(mode !== "build");
  expect(Boolean(project.poolMode)).toBe(mode === "pool");
});

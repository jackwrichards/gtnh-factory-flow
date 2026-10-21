import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesignRecord } from "./designs/design-library";
import type { FactoryProject } from "./model/types";
const mocks = vi.hoisted(() => ({
  records: new Map<string, DesignRecord>(),
  get designs(): DesignRecord[] {
    return [...mocks.records.values()];
  },
  activeDesignId: undefined as string | undefined,
  canvas: undefined as FactoryProject | undefined,
  counter: 0,
  navigationRevision: 0,
  readDesign: vi.fn(),
  importProjectAsDesign: vi.fn(),
  switchToDesign: vi.fn(),
  flushActiveDesign: vi.fn(async () => {}),
  replaceDesignFromImport: vi.fn(),
  cleanupImportedDesign: vi.fn(),
  removeDesign: vi.fn(),
  applyPlanView: vi.fn(),
  leaveWelcomeTab: vi.fn(),
  openPlanJsonText: vi.fn(),
  migration: vi.fn(async () => {}),
}));
vi.mock("@/store/design-store", () => ({
  useDesignStore: { getState: () => mocks },
  captureDesignUpdateGuard: () => {
    const active = mocks.activeDesignId,
      canvas = mocks.canvas,
      navigation = mocks.navigationRevision;
    return () => {
      if (
        mocks.activeDesignId !== active ||
        mocks.canvas !== canvas ||
        mocks.navigationRevision !== navigation
      )
        throw new Error("The plan changed while updating. Try again.");
    };
  },
}));
vi.mock("@/lib/designs/design-storage", () => ({
  listDesignSummaries: async () => [...mocks.records.values()],
  readDesign: mocks.readDesign,
}));
vi.mock("@/lib/designs/fingerprint-migration", () => ({
  ensurePlanFingerprintMigration: mocks.migration,
}));
vi.mock("@/lib/plan-view", () => ({ applyPlanView: mocks.applyPlanView }));
vi.mock("@/lib/welcome/welcome-tab", () => ({ leaveWelcomeTab: mocks.leaveWelcomeTab }));
vi.mock("@/lib/import-export/open-plan-file", () => ({
  looksLikePlanJson: (text: string) => text.trim().startsWith("{"),
  openPlanJsonText: mocks.openPlanJsonText,
}));
import { createEmptyProject } from "@/examples";
import { planFingerprints } from "./import-export/import-fingerprint";
import { encodePlanCode, planCodeLink } from "./import-export/plan-code";
import {
  dismissPlanImportNotice,
  importPlanNoticeAsNew,
  openPlanCode,
  updatePlanFromNotice,
  usePlanImportNotice,
} from "./open-plan-code";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.records.clear();
  mocks.counter = 0;
  mocks.navigationRevision = 0;
  mocks.readDesign.mockImplementation(async (id: string) => mocks.records.get(id));
  mocks.activeDesignId = undefined;
  mocks.canvas = undefined;
  dismissPlanImportNotice();
  mocks.importProjectAsDesign.mockImplementation(async (project: FactoryProject, name: string) => {
    const id = "design-" + mocks.counter++;
    mocks.records.set(id, {
      id,
      name,
      project: structuredClone(project),
      createdAt: "now",
      updatedAt: "now",
      fingerprints: await planFingerprints(project),
    });
    mocks.activeDesignId = id;
    mocks.canvas = project;
  });
  mocks.switchToDesign.mockImplementation(async (id: string, expectedFull?: string) => {
    const record = await mocks.readDesign(id);
    if (
      !record ||
      (expectedFull !== undefined && (record.cloud || record.fingerprints?.full !== expectedFull))
    )
      return false;
    mocks.navigationRevision++;
    mocks.activeDesignId = id;
    mocks.canvas = record.project;
    return true;
  });
  mocks.removeDesign.mockImplementation(async (id: string) => mocks.records.delete(id));
  mocks.cleanupImportedDesign.mockImplementation(async (id: string) => mocks.records.delete(id));
  mocks.replaceDesignFromImport.mockImplementation(async (id: string, project: FactoryProject) => {
    mocks.records.get(id)!.project = project;
    mocks.activeDesignId = id;
  });
});
describe("opening copied plan versions", () => {
  it("tries another exact candidate when the first one changed", async () => {
    const plan = createEmptyProject(),
      code = await encodePlanCode(plan);
    await mocks.importProjectAsDesign(plan, "First");
    await mocks.importProjectAsDesign(plan, "Second");
    mocks.activeDesignId = "design-0";
    const original = mocks.switchToDesign.getMockImplementation()!;
    mocks.switchToDesign.mockImplementationOnce(async (id, expectedFull) => {
      const target = mocks.records.get(id)!;
      target.project = { ...plan, notes: "Changed" };
      target.fingerprints = await planFingerprints(target.project);
      return original(id, expectedFull);
    });
    await openPlanCode(code);
    expect(mocks.records.size).toBe(2);
    expect(mocks.activeDesignId).toBe("design-1");
    expect(usePlanImportNotice.getState().notice?.kind).toBe("existing");
  });

  it.each(["related", "different", "deleted", "shared"])(
    "rechecks an exact candidate that becomes %s before opening",
    async (change) => {
      const plan = createEmptyProject();
      const code = await encodePlanCode(plan);
      await openPlanCode(code);
      const original = mocks.switchToDesign.getMockImplementation()!;
      mocks.switchToDesign.mockImplementationOnce(async (id, expectedFull) => {
        const target = mocks.records.get(id)!;
        if (change === "deleted") mocks.records.delete(id);
        else if (change === "shared")
          target.cloud = { ownerId: "owner", ownerName: "Owner", designId: id };
        else {
          target.project = {
            ...plan,
            notes: "New saved contents",
            ...(change === "different" ? { primaryView: "tasks" as const } : {}),
          };
          target.fingerprints = await planFingerprints(target.project);
        }
        return original(id, expectedFull);
      });
      await openPlanCode(code);
      expect(mocks.canvas?.notes).toBe(plan.notes);
      expect(mocks.activeDesignId).not.toBe("design-0");
      expect(usePlanImportNotice.getState().notice?.kind).toBe(
        change === "related" ? "related" : undefined,
      );
      if (change === "related") {
        expect(usePlanImportNotice.getState().notice!.related[0].full).toBe(
          mocks.records.get("design-0")!.fingerprints!.full,
        );
        expect(mocks.records.get("design-0")!.project.notes).toBe("New saved contents");
      }
    },
  );

  it("opens an exact existing plan from a link or bare code, including closed plans", async () => {
    const plan = createEmptyProject(),
      code = await encodePlanCode(plan);
    await openPlanCode(code);
    mocks.records.get("design-0")!.closed = true;
    mocks.records.get("design-0")!.name = "Renamed";
    mocks.applyPlanView.mockClear();
    await openPlanCode(planCodeLink(code, "https://gtnhplanner.com"));
    expect(mocks.records.size).toBe(1);
    expect(mocks.activeDesignId).toBe("design-0");
    expect(usePlanImportNotice.getState().notice?.kind).toBe("existing");
    expect(mocks.applyPlanView).not.toHaveBeenCalled();
    expect(mocks.migration).toHaveBeenCalled();
  });
  it("opens a different full fingerprint separately with update choices", async () => {
    const plan = createEmptyProject();
    await openPlanCode(await encodePlanCode(plan));
    await openPlanCode(await encodePlanCode({ ...plan, notes: "Updated version" }));
    const notice = usePlanImportNotice.getState().notice!;
    expect(notice.kind).toBe("related");
    expect(notice.related.map((candidate) => candidate.id)).toEqual(["design-0"]);
    await updatePlanFromNotice(notice, "design-0");
    expect(mocks.replaceDesignFromImport).toHaveBeenCalledWith(
      "design-0",
      notice.project,
      notice.related[0].full,
      expect.any(Function),
    );
    expect(mocks.records.size).toBe(1);
    expect(mocks.records.get("design-0")!.project.notes).toBe("Updated version");
  });
  it("does not overwrite edits made to the incoming version after its notice", async () => {
    const plan = createEmptyProject();
    await openPlanCode(await encodePlanCode(plan));
    await openPlanCode(await encodePlanCode({ ...plan, notes: "Updated" }));
    const notice = usePlanImportNotice.getState().notice!;
    mocks.records.get(notice.designId)!.project.notes = "Further edits";
    await expect(updatePlanFromNotice(notice, "design-0")).rejects.toThrow("imported plan changed");
    expect(mocks.replaceDesignFromImport).not.toHaveBeenCalled();
    expect(mocks.records.size).toBe(2);
  });
  it.each(["queued", "flush", "read", "hash"])(
    "cancels navigation during incoming verification: %s",
    async (stage) => {
      const plan = createEmptyProject();
      await openPlanCode(await encodePlanCode(plan));
      await openPlanCode(await encodePlanCode({ ...plan, notes: "Updated" }));
      const notice = usePlanImportNotice.getState().notice!;
      let release!: () => void;
      let ready!: () => void;
      const blocked = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let restoreDigest: (() => void) | undefined;
      if (stage === "flush")
        mocks.flushActiveDesign.mockImplementationOnce(async () => {
          ready();
          await gate;
        });
      if (stage === "read")
        mocks.readDesign.mockImplementationOnce(async (id: string) => {
          ready();
          await gate;
          return mocks.records.get(id);
        });
      if (stage === "hash") {
        const digest = crypto.subtle.digest.bind(crypto.subtle);
        const spy = vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(async (...args) => {
          ready();
          await gate;
          return digest(...args);
        });
        restoreDigest = () => spy.mockRestore();
      }
      const update = updatePlanFromNotice(notice, "design-0");
      const rejection = expect(update).rejects.toThrow("plan changed while updating");
      try {
        if (stage !== "queued") await blocked;
        mocks.navigationRevision++;
        mocks.activeDesignId = "other";
        release();
        await rejection;
        expect(mocks.replaceDesignFromImport).not.toHaveBeenCalled();
        expect(mocks.cleanupImportedDesign).not.toHaveBeenCalled();
        expect(mocks.records.size).toBe(2);
        expect(mocks.activeDesignId).toBe("other");
        expect(usePlanImportNotice.getState().notice).toBe(notice);
      } finally {
        restoreDigest?.();
      }
    },
  );
  it("retains the incoming version and notice when an update is interrupted by editing", async () => {
    const plan = createEmptyProject();
    await openPlanCode(await encodePlanCode(plan));
    await openPlanCode(await encodePlanCode({ ...plan, notes: "Updated" }));
    const notice = usePlanImportNotice.getState().notice!;
    mocks.replaceDesignFromImport.mockRejectedValueOnce(
      new Error("The plan changed while updating. Try again."),
    );
    await expect(updatePlanFromNotice(notice, "design-0")).rejects.toThrow(
      "plan changed while updating",
    );
    expect(mocks.removeDesign).not.toHaveBeenCalled();
    expect(mocks.records.size).toBe(2);
    expect(usePlanImportNotice.getState().notice).toBe(notice);
  });
  it("offers several related saved plans instead of choosing one to overwrite", async () => {
    const plan = createEmptyProject();
    await mocks.importProjectAsDesign(plan, "First");
    await mocks.importProjectAsDesign({ ...plan, notes: "Second" }, "Second");
    await openPlanCode(await encodePlanCode({ ...plan, notes: "Third" }));
    expect(usePlanImportNotice.getState().notice?.related).toHaveLength(2);
    expect(mocks.replaceDesignFromImport).not.toHaveBeenCalled();
  });
  it("imports different simple fingerprints normally", async () => {
    await openPlanCode(await encodePlanCode(createEmptyProject()));
    await openPlanCode(await encodePlanCode({ ...createEmptyProject(), primaryView: "tasks" }));
    expect(mocks.records.size).toBe(2);
    expect(usePlanImportNotice.getState().notice).toBeUndefined();
  });
  it("allows an explicit copy of an exact match", async () => {
    const code = await encodePlanCode(createEmptyProject());
    await openPlanCode(code);
    await openPlanCode(code);
    await importPlanNoticeAsNew(usePlanImportNotice.getState().notice!);
    expect(mocks.records.size).toBe(2);
  });
  it("serializes simultaneous imports and recovers from failures", async () => {
    const code = await encodePlanCode(createEmptyProject());
    mocks.importProjectAsDesign.mockRejectedValueOnce(new Error("Storage full"));
    await expect(openPlanCode(code)).rejects.toThrow("Storage full");
    await Promise.all([openPlanCode(code), openPlanCode(code)]);
    expect(mocks.records.size).toBe(1);
  });
  it("keeps JSON file paste separate and refuses invalid codes", async () => {
    await openPlanCode('{"name":"file"}');
    expect(mocks.openPlanJsonText).toHaveBeenCalled();
    await expect(openPlanCode("gtnh1.broken")).rejects.toThrow();
  });
});

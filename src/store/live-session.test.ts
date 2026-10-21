import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesignRecord, DesignSummary } from "@/lib/designs/design-library";
import type { PendingBatch } from "@/lib/live/client-state";
import type { LiveReplacementOutbox } from "@/lib/designs/design-storage";

/**
 * Live editing wired into the stores, against a fake live service speaking
 * the real protocol and applying ops with the real engine: what a local edit
 * sends, what a remote batch does to the canvas, undo of own edits only,
 * offline edits kept and resent, refusals, being removed, and that nothing at
 * all happens without NEXT_PUBLIC_LIVE_URL.
 */

const storage = vi.hoisted(() => ({
  records: new Map<string, DesignRecord>(),
  replacements: new Map<string, LiveReplacementOutbox>(),
}));

vi.mock("@/lib/designs/design-storage", () => ({
  listDesignSummaries: vi.fn(async () =>
    [...storage.records.values()].map((record) => {
      const summary: Partial<DesignRecord> = { ...record };
      delete summary.project;
      return summary as DesignSummary;
    }),
  ),
  listDesignFolders: vi.fn(async () => []),
  readDesign: vi.fn(async (id: string) => storage.records.get(id)),
  readDesignSummary: vi.fn(async (id: string) => storage.records.get(id)),
  readDesignLiveReplacement: vi.fn(async (id: string) => storage.replacements.get(id)),
  settleDesignLiveReplacement: vi.fn(async (id: string, doc: string, cid: string) => {
    const outbox = storage.replacements.get(id);
    if (outbox?.doc !== doc) return;
    const pending = outbox.pending.filter((batch) => batch.cid !== cid);
    if (pending.length) storage.replacements.set(id, { doc, pending });
    else storage.replacements.delete(id);
  }),
  writeDesign: vi.fn(async (record: DesignRecord) => {
    storage.records.set(record.id, record);
  }),
  writeDesignIfUnchanged: vi.fn(async (record: DesignRecord) => {
    storage.records.set(record.id, record);
    return "written";
  }),
  replaceDesignIfUnchanged: vi.fn(
    async (record: DesignRecord, expected: DesignSummary, outbox?: LiveReplacementOutbox) => {
      const stored = storage.records.get(record.id);
      if (!stored) return "missing";
      if (
        stored.updatedAt !== expected.updatedAt ||
        stored.metaUpdatedAt !== expected.metaUpdatedAt ||
        stored.remoteUpdatedAt !== expected.remoteUpdatedAt
      )
        return "conflict";
      storage.records.set(record.id, record);
      if (outbox) storage.replacements.set(record.id, structuredClone(outbox));
      return "written";
    },
  ),
  writeDesignSummary: vi.fn(async () => undefined),
  writeDesignFolder: vi.fn(async () => undefined),
  deleteDesign: vi.fn(async (id: string) => {
    storage.records.delete(id);
  }),
  deleteDesignFolder: vi.fn(async () => undefined),
  readActiveDesignId: vi.fn(() => undefined),
  writeActiveDesignId: vi.fn(),
}));
vi.mock("@/lib/designs/design-tab-sync", () => ({
  THIS_TAB_ID: "tab-a",
  isEditingInThisTab: () => true,
  announceDesignSaved: vi.fn(),
  subscribeDesignSaved: () => () => undefined,
}));
vi.mock("@/lib/designs/design-camera", () => ({
  keepDesignCameras: vi.fn(),
  forgetDesignCameras: vi.fn(),
  rememberDesignCamera: vi.fn(),
  readDesignCamera: vi.fn(),
  beginDesignCameraHandover: vi.fn(),
}));

const pendingStore = vi.hoisted(() => ({
  entries: new Map<string, { key: string; doc: string; tabId: string; pending: PendingBatch[] }>(),
  alive: new Set<string>(["tab-a"]),
}));
vi.mock("@/lib/live/live-pending-store", () => ({
  pendingKey: (doc: string, tabId: string) => `${doc}|${tabId}`,
  writePending: vi.fn(async (doc: string, tabId: string, pending: PendingBatch[], options?: { preserveStored?: boolean }) => {
    const key = `${doc}|${tabId}`;
    if (options?.preserveStored) {
      const saved = pendingStore.entries.get(key)?.pending ?? [];
      const seen = new Set(saved.map(batch => batch.cid));
      pending = [...saved, ...pending.filter(batch => !seen.has(batch.cid))];
    }
    if (pending.length === 0) {
      pendingStore.entries.delete(key);
    } else {
      pendingStore.entries.set(key, { key, doc, tabId, pending: structuredClone(pending) });
    }
  }),
  readPending: vi.fn(async (doc?: string) =>
    [...pendingStore.entries.values()].filter((entry) => !doc || entry.doc === doc),
  ),
  deletePending: vi.fn(async (key: string) => {
    pendingStore.entries.delete(key);
  }),
  holdTabLock: vi.fn(),
  aliveTabs: vi.fn(async () => pendingStore.alive),
}));

import { createEmptyProject, createNewProject } from "@/examples";
import { applyOps, type LiveOp, type LivePlan, type LiveThing } from "@/lib/live/ops";
import { LIVE_LIMITS, type ServerFrame } from "@/lib/live/protocol";
import type { FactoryAnnotation, FactoryProject } from "@/lib/model/types";
import { useCommunityAuthStore } from "./community-auth-store";
import { useDesignStore } from "./design-store";
import { useFactoryStore } from "./factory-store";
import { liveUndoHandler, markDesignFresh } from "./live-edit-gate";
import {
  chunkOps,
  noteLeavingPlan,
  startLiveSessions,
  useLiveSession,
  utf8Length,
  type LiveSocketLike,
} from "./live-session";

const ANN = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const DESIGN = "aaaaaaaa-0000-4000-8000-000000000001";
const DOC = `${ANN}:${DESIGN}`;

/** The live service as one client sees it: the real ops engine, one room. */
class FakeService {
  plan: LivePlan = {};
  seq = 0;
  socket?: FakeSocket;
  readonly received: Array<Record<string, unknown>> = [];
  /** cids the service refuses (an `error` with the cid). */
  readonly refuse = new Set<string>();
  /** Set: the service takes frames but answers nothing (a dead link). */
  silent = false;
  readonly applied = new Map<string, number>();

  connect(url: string): FakeSocket {
    void url;
    this.socket = new FakeSocket(this);
    return this.socket;
  }

  reply(frame: ServerFrame): void {
    const socket = this.socket;
    queueMicrotask(() => socket?.deliver(frame));
  }

  handle(frame: Record<string, unknown>): void {
    this.received.push(frame);
    if (this.silent) {
      return;
    }
    switch (frame.t) {
      case "hello":
        this.reply({ t: "welcome", v: 1, you: { id: ANN, username: "ann", color: "#e5484d" } });
        return;
      case "join":
        this.reply({
          t: "snapshot",
          doc: frame.doc as string,
          seq: this.seq,
          plan: this.plan,
          role: "owner",
          members: [{ id: BOB, username: "bob" }],
          present: [
            { id: ANN, username: "ann", color: "#e5484d", client: "web", conn: "c-ann" },
            { id: BOB, username: "bob", color: "#46a758", client: "game", conn: "c-bob" },
          ],
          owner: { id: ANN, username: "ann" },
        });
        return;
      case "ops": {
        const cid = frame.cid as string;
        if (this.refuse.has(cid)) {
          this.reply({ t: "error", doc: DOC, cid, code: "bad_op", msg: "No." });
          return;
        }
        const seen = this.applied.get(cid);
        if (seen !== undefined) {
          this.reply({ t: "ops", doc: DOC, seq: seen, by: ANN, cid, ops: [] });
          return;
        }
        this.plan = applyOps(this.plan, frame.ops as LiveOp[]);
        this.seq += 1;
        this.applied.set(cid, this.seq);
        this.reply({ t: "ops", doc: DOC, seq: this.seq, by: ANN, cid, ops: frame.ops as LiveOp[] });
        return;
      }
    }
  }

  /** Someone else's batch. */
  remote(ops: LiveOp[], cid = `bob-${this.seq + 1}`): void {
    this.plan = applyOps(this.plan, ops);
    this.seq += 1;
    this.reply({ t: "ops", doc: DOC, seq: this.seq, by: BOB, cid, ops });
  }

  sent(t: string): Array<Record<string, unknown>> {
    return this.received.filter((frame) => frame.t === t);
  }
}

class FakeSocket implements LiveSocketLike {
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(private readonly service: FakeService) {
    queueMicrotask(() => {
      if (this.readyState === 0) {
        this.readyState = 1;
        this.onopen?.({});
      }
    });
  }

  send(data: string): void {
    if (this.readyState !== 1) {
      throw new Error("not open");
    }
    this.service.handle(JSON.parse(data) as Record<string, unknown>);
  }

  deliver(frame: ServerFrame): void {
    if (this.readyState === 1) {
      this.onmessage?.({ data: JSON.stringify(frame) });
    }
  }

  close(): void {
    this.readyState = 3;
  }

  /** The connection drops. */
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

const settle = async (rounds = 6) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

function annotation(id: string, text: string, x = 0): FactoryAnnotation {
  return {
    id,
    kind: "text",
    text,
    position: { x, y: 0 },
    size: { width: 200, height: 40 },
  } as FactoryAnnotation;
}

/** A plan as this build makes one: in plan mode, the one board mode. */
function planWith(...annotations: FactoryAnnotation[]): FactoryProject {
  return { ...createNewProject(), id: "plan-live", name: "Live", annotations };
}

function annotations(): FactoryAnnotation[] {
  return useFactoryStore.getState().project.annotations ?? [];
}

let service: FakeService;
let stop: (() => void) | undefined;

async function openLiveDesign(local: FactoryProject, server: FactoryProject = local) {
  service.plan = JSON.parse(JSON.stringify(server)) as LivePlan;
  const record: DesignRecord = {
    id: DESIGN,
    name: "Live",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    remoteUpdatedAt: "2026-10-01T00:00:00.000Z",
    project: local,
  };
  storage.records.set(DESIGN, record);
  useFactoryStore.getState().markHydratedProject(local);
  const summary: Partial<DesignRecord> = { ...record };
  delete summary.project;
  useDesignStore.setState({
    designs: [summary as DesignSummary],
    activeDesignId: DESIGN,
    isHydrated: true,
  });
  useCommunityAuthStore.setState({ user: { username: "ann" }, hasHydrated: true });
  stop = startLiveSessions({
    url: () => "ws://live.test/live",
    createSocket: (url) => service.connect(url),
  });
  await settle();
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_LIVE_URL", "ws://live.test/live");
  service = new FakeService();
  storage.records.clear();
  storage.replacements.clear();
  pendingStore.entries.clear();
  useLiveSession.setState({
    status: "off",
    members: [],
    present: [],
    pending: 0,
    notice: undefined,
  });
});

afterEach(async () => {
  stop?.();
  stop = undefined;
  useCommunityAuthStore.setState({ user: undefined });
  useDesignStore.setState({ designs: [], activeDesignId: undefined });
  vi.unstubAllEnvs();
  await settle();
});

describe("live editing in the store", () => {
  it("sends an imported replacement as pending edits before accepting the account snapshot", async () => {
    const { planFingerprints } = await import("@/lib/import-export/import-fingerprint");
    const old = planWith(annotation("n1", "old"));
    const incoming = planWith(annotation("n1", "replacement"));
    const target: DesignRecord = {
      id: DESIGN,
      name: "Target",
      createdAt: "2026-10-01",
      updatedAt: "2026-10-01",
      remoteUpdatedAt: "2026-10-01",
      project: old,
    };
    const source: DesignRecord = {
      id: "incoming",
      name: "Incoming",
      createdAt: "2026-10-01",
      updatedAt: "2026-10-01",
      project: incoming,
    };
    storage.records.set(DESIGN, target);
    storage.records.set(source.id, source);
    // A remote addition since this device last opened the target must survive too.
    service.plan = JSON.parse(
      JSON.stringify(planWith(annotation("n1", "old"), annotation("remote", "Bob"))),
    );
    useFactoryStore.getState().markHydratedProject(incoming);
    useDesignStore.setState({
      designs: [target, source],
      activeDesignId: source.id,
      isHydrated: true,
    });
    useCommunityAuthStore.setState({ user: { username: "ann" }, hasHydrated: true });
    stop = startLiveSessions({
      url: () => "ws://live.test/live",
      createSocket: (url) => service.connect(url),
    });
    await settle();
    expect(service.sent("join")).toHaveLength(0);
    await useDesignStore
      .getState()
      .replaceDesignFromImport(DESIGN, incoming, (await planFingerprints(old)).full);
    await settle();
    expect(annotations().map((note) => note.text)).toEqual(["replacement", "Bob"]);
    expect((service.plan.annotations as FactoryAnnotation[]).map((note) => note.text)).toEqual([
      "replacement",
      "Bob",
    ]);
    expect(service.sent("ops")).toHaveLength(1);
    expect(useLiveSession.getState().pending).toBe(0);
    service.socket!.drop();
    await settle(30);
    expect(annotations().find((note) => note.id === "n1")!.text).toBe("replacement");
  });

  it("waits for saved pending edits before joining and never clears them on an early departure", async () => {
    const { readPending } = await import("@/lib/live/live-pending-store");
    let release!: (entries: Awaited<ReturnType<typeof readPending>>) => void;
    vi.mocked(readPending).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    pendingStore.entries.set(`${DOC}|tab-a`, {
      key: `${DOC}|tab-a`,
      doc: DOC,
      tabId: "tab-a",
      pending: [
        {
          cid: "saved",
          ops: [{ o: "patch", c: "annotations", id: "n1", f: { text: "saved" } }],
          inverse: [],
        },
      ],
    });
    await openLiveDesign(planWith(annotation("n1", "local")));
    expect(service.sent("join")).toHaveLength(0);
    useFactoryStore.getState().updateAnnotation("n1", { text: "new edit while loading" });
    useDesignStore.setState({ activeDesignId: undefined });
    release([]);
    await settle();
    expect(service.sent("join")).toHaveLength(0);
    expect(pendingStore.entries.get(`${DOC}|tab-a`)?.pending[0].cid).toBe("saved");
    expect(pendingStore.entries.get(`${DOC}|tab-a`)?.pending).toHaveLength(2);
  });

  it("requires existing unsent target edits to be resolved before preparing a replacement", async () => {
    const { prepareImportedReplacement } = await import("./live-session");
    // Establish the account identity, then leave the target room.
    await openLiveDesign(planWith(annotation("n1", "old")));
    useDesignStore.setState({ activeDesignId: undefined });
    pendingStore.entries.set(`${DOC}|tab-gone`, {
      key: `${DOC}|tab-gone`,
      doc: DOC,
      tabId: "tab-gone",
      pending: [
        {
          cid: "saved",
          ops: [{ o: "patch", c: "annotations", id: "n1", f: { text: "unsent" } }],
          inverse: [],
        },
      ],
    });
    await expect(
      prepareImportedReplacement(
        DESIGN,
        planWith(annotation("n1", "old")),
        planWith(annotation("n1", "replacement")),
      ),
    ).rejects.toThrow("unsent edits");
    expect(pendingStore.entries.get(`${DOC}|tab-gone`)?.pending[0].cid).toBe("saved");
  });

  it("keeps edits made during pending adoption newer than the saved edits", async () => {
    const { readPending } = await import("@/lib/live/live-pending-store");
    pendingStore.entries.set(`${DOC}|tab-a`, {
      key: `${DOC}|tab-a`,
      doc: DOC,
      tabId: "tab-a",
      pending: [
        {
          cid: "saved",
          ops: [{ o: "patch", c: "annotations", id: "n1", f: { text: "saved" } }],
          inverse: [],
        },
      ],
    });
    const entries = await readPending(DOC);
    let release!: (entries: Awaited<ReturnType<typeof readPending>>) => void;
    vi.mocked(readPending).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await openLiveDesign(planWith(annotation("n1", "local")));
    useFactoryStore.getState().updateAnnotation("n1", { text: "newest" });
    release(entries);
    await settle(200);
    expect(annotations()[0].text).toBe("newest");
    expect((service.plan.annotations as FactoryAnnotation[])[0].text).toBe("newest");
  });

  it("recovers a committed replacement after pending persistence fails and the session restarts", async () => {
    const { planFingerprints } = await import("@/lib/import-export/import-fingerprint");
    const { writePending } = await import("@/lib/live/live-pending-store");
    const old = planWith(annotation("n1", "old"));
    const incoming = planWith(annotation("n1", "replacement"));
    await openLiveDesign(old);
    const target = storage.records.get(DESIGN)!;
    const source: DesignRecord = {
      id: "incoming",
      name: "Incoming",
      createdAt: target.createdAt,
      updatedAt: target.updatedAt,
      project: incoming,
    };
    storage.records.set(source.id, source);
    useDesignStore.setState({ activeDesignId: source.id, designs: [target, source] });
    useFactoryStore.getState().markHydratedProject(incoming);
    const originalWrite = vi.mocked(writePending).getMockImplementation()!;
    vi.mocked(writePending).mockRejectedValue(new Error("Storage full"));
    try {
      service.silent = true;
      await useDesignStore
        .getState()
        .replaceDesignFromImport(DESIGN, incoming, (await planFingerprints(old)).full);
      await settle();
      expect(storage.records.get(DESIGN)!.project.annotations![0].text).toBe("replacement");
      expect(storage.replacements.get(DESIGN)?.pending).toHaveLength(1);
      expect(pendingStore.entries.size).toBe(0);
      stop!();
      service.silent = false;
      stop = startLiveSessions({
        url: () => "ws://live.test/live",
        createSocket: (url) => service.connect(url),
      });
      await settle();
      expect(annotations()[0].text).toBe("replacement");
      expect((service.plan.annotations as FactoryAnnotation[])[0].text).toBe("replacement");
      expect(storage.replacements.has(DESIGN)).toBe(false);
    } finally {
      vi.mocked(writePending).mockImplementation(originalWrite);
    }
  });

  it("does not queue a rejected replacement for later live delivery", async () => {
    const { replaceDesignIfUnchanged } = await import("@/lib/designs/design-storage");
    const { planFingerprints } = await import("@/lib/import-export/import-fingerprint");
    const old = planWith(annotation("n1", "old"));
    await openLiveDesign(old);
    useDesignStore.setState({ activeDesignId: undefined });
    vi.mocked(replaceDesignIfUnchanged).mockResolvedValueOnce("conflict");
    await expect(
      useDesignStore
        .getState()
        .replaceDesignFromImport(
          DESIGN,
          planWith(annotation("n1", "replacement")),
          (await planFingerprints(old)).full,
        ),
    ).rejects.toThrow("Another tab changed");
    expect(storage.replacements.size).toBe(0);
    expect(pendingStore.entries.size).toBe(0);
    expect(storage.records.get(DESIGN)!.project.annotations![0].text).toBe("old");
  });

  it("resends the same batch id if acknowledgement cleanup fails, without applying it twice", async () => {
    const { prepareImportedReplacement } = await import("./live-session");
    const { settleDesignLiveReplacement } = await import("@/lib/designs/design-storage");
    const old = planWith(annotation("n1", "old"));
    const incoming = planWith(annotation("n1", "replacement"));
    await openLiveDesign(old);
    useDesignStore.setState({ activeDesignId: undefined });
    const outbox = await prepareImportedReplacement(DESIGN, old, incoming);
    storage.replacements.set(DESIGN, outbox);
    storage.records.set(DESIGN, { ...storage.records.get(DESIGN)!, project: incoming });
    vi.mocked(settleDesignLiveReplacement).mockRejectedValueOnce(new Error("Storage unavailable"));
    await useDesignStore.getState().switchToDesign(DESIGN);
    await settle();
    expect(storage.replacements.get(DESIGN)?.pending[0].cid).toBe(outbox.pending[0].cid);
    expect(service.seq).toBe(1);
    stop!();
    stop = startLiveSessions({
      url: () => "ws://live.test/live",
      createSocket: (url) => service.connect(url),
    });
    await settle();
    expect(service.sent("ops").map((frame) => frame.cid)).toEqual([
      outbox.pending[0].cid,
      outbox.pending[0].cid,
    ]);
    expect(service.seq).toBe(1);
    expect(annotations()[0].text).toBe("replacement");
    expect(storage.replacements.has(DESIGN)).toBe(false);
  });

  it("keeps the local canvas and does not join when pending edits cannot be read", async () => {
    const { readPending } = await import("@/lib/live/live-pending-store");
    vi.mocked(readPending).mockRejectedValueOnce(new Error("Storage unavailable"));
    await openLiveDesign(planWith(annotation("n1", "local")), planWith(annotation("n1", "old")));
    expect(service.sent("join")).toHaveLength(0);
    expect(annotations()[0].text).toBe("local");
    expect(useLiveSession.getState().notice?.text).toContain("Saved edits could not be loaded");
  });

  it("joins the open cloud design and lands its live plan on the canvas, as the same design", async () => {
    await openLiveDesign(planWith(annotation("n1", "old")), planWith(annotation("n1", "new")));

    expect(service.sent("join")).toEqual([{ t: "join", doc: DOC }]);
    expect(useLiveSession.getState()).toMatchObject({ status: "live", doc: DOC, role: "owner" });
    expect(annotations()[0]!.text).toBe("new");
    // Same design, no new tab, no snapshot history: undo is the live one.
    expect(useDesignStore.getState().designs.map((design) => design.id)).toEqual([DESIGN]);
    expect(useDesignStore.getState().activeDesignId).toBe(DESIGN);
    expect(useFactoryStore.getState().undoHistory).toEqual([]);
    expect(liveUndoHandler()).toBeDefined();
    // Bob is here (the game); ann's own connection is not a face.
    expect(useLiveSession.getState().present.map((person) => person.username)).toEqual(["bob"]);
  });

  it("keeps what a plan made moments ago held on the canvas beyond the account's first copy, and sends it first", async () => {
    // The row was created from the saved record; the canvas already had a second note.
    markDesignFresh(DESIGN);
    await openLiveDesign(planWith(annotation("n1", "one"), annotation("n2", "two", 300)), planWith(annotation("n1", "one")));
    expect(annotations().map((note) => note.id)).toEqual(["n1", "n2"]);
    expect((service.plan.annotations as Array<{ id: string }> | undefined)?.map((note) => note.id)).toEqual(["n1", "n2"]);
    expect(useLiveSession.getState().pending).toBe(0);

    // A design not made moments ago takes the account's plan: the canvas never overrules it.
    stop?.();
    stop = undefined;
    useDesignStore.setState({ designs: [], activeDesignId: undefined });
    await settle();
    service = new FakeService();
    await openLiveDesign(planWith(annotation("n1", "one"), annotation("n2", "two", 300)), planWith(annotation("n1", "one")));
    expect(annotations().map((note) => note.id)).toEqual(["n1"]);
  });

  it("says who shared a plan with the player, with a key to open it, once however often it is sent", async () => {
    await openLiveDesign(planWith(annotation("n1", "one")));
    const other = `${BOB}:bbbbbbbb-0000-4000-8000-000000000002`;
    const shared: ServerFrame = {
      t: "shared",
      doc: other,
      owner: { id: BOB, username: "bob" },
      name: "Big mall",
    };
    service.reply(shared);
    await settle();
    const notice = useLiveSession.getState().notice;
    expect(notice?.text).toBe("bob shared Big mall with you");
    expect(notice?.action?.label).toBe("Open");

    useLiveSession.setState({ notice: undefined });
    service.reply(shared);
    await settle();
    expect(useLiveSession.getState().notice).toBeUndefined();

    // Taken off the plan, it can be announced afresh.
    service.reply({ t: "unshared", doc: other });
    service.reply(shared);
    await settle();
    expect(useLiveSession.getState().notice?.text).toBe("bob shared Big mall with you");
  });

  it("converts a live plan in an old mode to the one board mode once, as an edit undo never takes back", async () => {
    // The game writes Solve plans; an older build wrote Build plans. Both land through the live room.
    const old: FactoryProject = { ...createEmptyProject(), id: "plan-live", name: "Live", solveMode: true, annotations: [annotation("n1", "one")] };
    await openLiveDesign(planWith(annotation("n1", "one")), old);

    expect(useFactoryStore.getState().project.planMode).toBe(true);
    const batches = service.sent("ops");
    expect(batches).toHaveLength(1);
    expect(batches[0]!.ops).toContainEqual(expect.objectContaining({ o: "meta", f: expect.objectContaining({ planMode: true }) }));
    expect(service.plan.planMode).toBe(true);
    // Nothing of this person's to undo: the conversion is not theirs to take back.
    expect(useFactoryStore.getState().liveUndo?.canUndo).toBe(false);

    // A plan already in the one mode sends nothing more.
    service.remote([{ o: "patch", c: "annotations", id: "n1", f: { text: "from bob" } }]);
    await settle();
    expect(service.sent("ops")).toHaveLength(1);
    expect(annotations()[0]!.text).toBe("from bob");
  });

  it("turns a live plan's loose cell wire into a fluid tank once, for everyone, as an edit undo never takes back", async () => {
    // An older build saved a cell wired straight into a fluid slot; the plan is already in the one mode.
    const recipes = [
      { id: "fill", name: "fill", machineType: "Bender", minimumTier: "LV", durationTicks: 20, eut: 30, inputs: [],
        outputs: [{ kind: "item" as const, id: "water_cell", amount: 2, displayName: "Water Cell" }] },
      { id: "drink", name: "drink", machineType: "Bender", minimumTier: "LV", durationTicks: 20, eut: 30,
        inputs: [{ kind: "fluid" as const, id: "water", amount: 1000, displayName: "Water" }], outputs: [] },
    ];
    const at = (x: number) => ({ machineCount: 1, parallel: 1, overclockTier: "LV", enabled: true, position: { x, y: 0 } });
    const wired: FactoryProject = {
      ...planWith(),
      recipes,
      nodes: [{ id: "maker", recipeId: "fill", ...at(0) }, { id: "taker", recipeId: "drink", ...at(400) }],
      edges: [{ id: "w", source: "maker", target: "taker", sourceHandle: "output:item:water_cell",
        targetHandle: "input:fluid:water", resourceKind: "item", resourceId: "water_cell", crossForm: { litresPerCell: 1000 } }],
    };
    await openLiveDesign(wired);

    const batches = service.sent("ops");
    expect(batches).toHaveLength(1);
    expect(batches[0]!.ops).toContainEqual(expect.objectContaining({ o: "put", c: "nodes", id: "cell-tank:w" }));
    const edges = service.plan.edges as Array<{ id: string; crossForm?: unknown }>;
    expect(edges.map((edge) => edge.id).sort()).toEqual(["w", "w:tank"]);
    expect(edges.some((edge) => edge.crossForm)).toBe(false);
    expect(useFactoryStore.getState().project.nodes.some((node) => node.id === "cell-tank:w")).toBe(true);
    expect(useFactoryStore.getState().liveUndo?.canUndo).toBe(false);

    // Someone else's edit lands as it is: nothing more to convert or send.
    service.remote([{ o: "patch", c: "nodes", id: "maker", f: { machineCount: 2 } }]);
    await settle();
    expect(service.sent("ops")).toHaveLength(1);
  });

  it("sends each edit as the batch of what changed, nothing derived, confirmed by its echo", async () => {
    await openLiveDesign(planWith(annotation("n1", "one"), annotation("n2", "two")));

    useFactoryStore.getState().updateAnnotation("n2", { text: "TWO" });
    await settle();

    const batches = service.sent("ops");
    expect(batches).toHaveLength(1);
    expect(batches[0]!.ops).toEqual([
      { o: "patch", c: "annotations", id: "n2", f: { text: "TWO" } },
    ]);
    expect(useLiveSession.getState().pending).toBe(0);
    expect((service.plan.annotations as FactoryAnnotation[])[1]!.text).toBe("TWO");
    // The store kept no snapshot of the plan for undo.
    expect(useFactoryStore.getState().undoHistory).toEqual([]);
    expect(useFactoryStore.getState().liveUndo).toEqual({ canUndo: true, canRedo: false });
  });

  it("lands someone else's batch on the canvas, leaving untouched things the same objects", async () => {
    await openLiveDesign(planWith(annotation("n1", "one"), annotation("n2", "two")));
    const untouched = annotations()[0];

    service.remote([{ o: "patch", c: "annotations", id: "n2", f: { text: "from bob" } }]);
    await settle();

    expect(annotations()[1]!.text).toBe("from bob");
    expect(annotations()[0]).toBe(untouched);
    // Not an edit of ours: nothing went back, nothing to undo.
    expect(service.sent("ops")).toHaveLength(0);
    expect(useFactoryStore.getState().liveUndo?.canUndo).toBe(false);
  });

  it("undoes only this person's own edit, with its recorded inverse, never a snapshot", async () => {
    await openLiveDesign(planWith(annotation("n1", "one"), annotation("n2", "two")));

    useFactoryStore.getState().updateAnnotation("n1", { text: "mine" });
    await settle();
    service.remote([{ o: "patch", c: "annotations", id: "n2", f: { text: "bob's" } }]);
    await settle();

    useFactoryStore.getState().undo();
    await settle();

    expect(annotations().map((note) => note.text)).toEqual(["one", "bob's"]);
    const batches = service.sent("ops");
    expect(batches.at(-1)!.ops).toEqual([
      { o: "patch", c: "annotations", id: "n1", f: { text: "one" } },
    ]);
    expect((service.plan.annotations as FactoryAnnotation[]).map((note) => note.text)).toEqual([
      "one",
      "bob's",
    ]);

    useFactoryStore.getState().redo();
    await settle();
    expect(annotations().map((note) => note.text)).toEqual(["mine", "bob's"]);
  });

  it("keeps edits made offline, stored, and sends them when the connection is back", async () => {
    await openLiveDesign(planWith(annotation("n1", "one")));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    try {
      service.socket!.drop();
      expect(useLiveSession.getState().status).toBe("offline");

      useFactoryStore.getState().updateAnnotation("n1", { text: "offline" });
      expect(useLiveSession.getState().pending).toBe(1);
      expect(annotations()[0]!.text).toBe("offline");
      await vi.advanceTimersByTimeAsync(250);
      expect(pendingStore.entries.get(`${DOC}|tab-a`)?.pending).toHaveLength(1);

      // Someone edited meanwhile; the backoff runs out and the session joins again.
      service.remote([
        {
          o: "put",
          c: "annotations",
          id: "n9",
          v: annotation("n9", "bob") as unknown as LiveThing,
        },
      ]);
      await vi.advanceTimersByTimeAsync(2000);

      expect(useLiveSession.getState().status).toBe("live");
      expect(useLiveSession.getState().pending).toBe(0);
      expect(annotations().map((note) => note.text)).toEqual(["offline", "bob"]);
      expect((service.plan.annotations as FactoryAnnotation[])[0]!.text).toBe("offline");
      await vi.advanceTimersByTimeAsync(250);
      expect(pendingStore.entries.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends a closed tab's leftover edits with its own", async () => {
    pendingStore.entries.set(`${DOC}|tab-gone`, {
      key: `${DOC}|tab-gone`,
      doc: DOC,
      tabId: "tab-gone",
      pending: [
        {
          cid: "left-1",
          ops: [{ o: "patch", c: "annotations", id: "n1", f: { text: "left behind" } }],
          inverse: [{ o: "patch", c: "annotations", id: "n1", f: { text: "one" } }],
        },
      ],
    });
    await openLiveDesign(planWith(annotation("n1", "one")));
    await settle();

    expect(service.sent("ops").map((frame) => frame.cid)).toEqual(["left-1"]);
    expect(annotations()[0]!.text).toBe("left behind");
    expect(pendingStore.entries.has(`${DOC}|tab-gone`)).toBe(false);
  });

  it("takes a refused edit back off the canvas and says so", async () => {
    await openLiveDesign(planWith(annotation("n1", "one")));
    service.refuse.add("__all__");
    const send = service.handle.bind(service);
    service.handle = (frame) => {
      if (frame.t === "ops") {
        service.refuse.add(frame.cid as string);
      }
      send(frame);
    };

    useFactoryStore.getState().updateAnnotation("n1", { text: "too much" });
    await settle();

    expect(annotations()[0]!.text).toBe("one");
    expect(useLiveSession.getState().pending).toBe(0);
    expect(useLiveSession.getState().notice?.text).toBe("An edit was not saved: No.");
  });

  it("asks to join again shortly when the service is too busy to open the plan", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const send = service.handle.bind(service);
      let refused = false;
      service.handle = (frame) => {
        if (frame.t === "join" && !refused) {
          refused = true;
          service.received.push(frame);
          service.reply({ t: "error", doc: DOC, code: "rate", msg: "Busy." });
          return;
        }
        send(frame);
      };
      await openLiveDesign(planWith(annotation("n1", "one")));
      expect(service.sent("join")).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(4500);
      await settle();
      expect(service.sent("join")).toHaveLength(2);
      useFactoryStore.getState().updateAnnotation("n1", { text: "two" });
      await settle();
      expect(service.sent("ops")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an edit too big to send off the wire, and sizes batches in bytes", async () => {
    await openLiveDesign(planWith(annotation("n1", "one")));
    // Over the service's batch limit in UTF-8 bytes, though not in characters.
    const huge = "é".repeat(Math.ceil(LIVE_LIMITS.batchBytes / 2) + 10);
    expect(huge.length).toBeLessThan(LIVE_LIMITS.batchBytes);

    useFactoryStore.getState().updateAnnotation("n1", { text: huge });
    await settle();

    expect(service.sent("ops")).toHaveLength(0);
    expect(annotations()[0]!.text).toBe("one");
    expect(useLiveSession.getState().notice?.text).toBe(
      "An edit was not saved: it is too big to send.",
    );
    const op = (text: string): LiveOp => ({ o: "meta", f: { notes: text } });
    expect(utf8Length("aé€😀")).toBe(1 + 2 + 3 + 4);
    expect(chunkOps([op("€".repeat(40)), op("€".repeat(40))], 200)).toHaveLength(2);
    expect(chunkOps([op("e".repeat(40)), op("e".repeat(40))], 200)).toHaveLength(1);
  });

  it("closes a shared plan's copy when its owner stops sharing it", async () => {
    await openLiveDesign(planWith(annotation("n1", "one")));
    // Make the open design a copy of bob's plan, shared with ann.
    const bobDoc = `${BOB}:${DESIGN}`;
    service.plan = { ...service.plan };
    useDesignStore.setState({
      designs: useDesignStore
        .getState()
        .designs.map((design) => ({
          ...design,
          cloud: { ownerId: BOB, ownerName: "bob", designId: DESIGN },
        })),
    });
    await settle();
    expect(useLiveSession.getState().doc).toBe(bobDoc);

    service.reply({ t: "kicked", doc: bobDoc, reason: "unshared" });
    await settle();

    expect(useLiveSession.getState().status).toBe("off");
    expect(useLiveSession.getState().notice?.text).toBe("You were removed from Live.");
    expect(storage.records.has(DESIGN)).toBe(false);
    expect(liveUndoHandler()).toBeUndefined();

    // Shared again and opened from Shared with me in the same tab: it joins.
    await settle();
    const joinsBefore = service.sent("join").length;
    await useDesignStore
      .getState()
      .openSharedDesign({ ownerId: BOB, ownerName: "bob", designId: DESIGN }, "Live", planWith());
    await settle();
    expect(service.sent("join").length).toBe(joinsBefore + 1);
    expect(useLiveSession.getState()).toMatchObject({ status: "live", doc: bobDoc });
  });

  it("says nothing when this person leaves a shared plan on purpose", async () => {
    await openLiveDesign(planWith(annotation("n1", "one")));
    const bobDoc = `${BOB}:${DESIGN}`;
    useDesignStore.setState({
      designs: useDesignStore
        .getState()
        .designs.map((design) => ({
          ...design,
          cloud: { ownerId: BOB, ownerName: "bob", designId: DESIGN },
        })),
    });
    await settle();
    expect(useLiveSession.getState().doc).toBe(bobDoc);

    noteLeavingPlan(BOB, DESIGN);
    service.reply({ t: "kicked", doc: bobDoc, reason: "unshared" });
    await settle();

    expect(useLiveSession.getState().status).toBe("off");
    expect(useLiveSession.getState().notice).toBeUndefined();
  });

  it("does nothing at all without a live service configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_LIVE_URL", "");
    const createSocket = vi.fn((url: string) => service.connect(url));
    useCommunityAuthStore.setState({ user: { username: "ann" }, hasHydrated: true });
    stop = startLiveSessions({ url: () => "ws://live.test/live", createSocket });
    await settle();

    expect(createSocket).not.toHaveBeenCalled();
    useFactoryStore.getState().markHydratedProject(planWith(annotation("n1", "one")));
    useFactoryStore.getState().updateAnnotation("n1", { text: "local" });
    expect(useFactoryStore.getState().undoHistory).toHaveLength(1);
    expect(useFactoryStore.getState().liveUndo).toBeUndefined();
  });
});

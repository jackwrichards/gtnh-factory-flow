import { describe, expect, it, vi } from "vitest";

// The engine imports the stores, which touch nothing at import time, but
// the client module and the auth store are not needed for the pure rules.
vi.mock("./client", () => ({}));

import { libraryChangeSignature, reconcileDesigns, reconcileFolders } from "./library-sync";
import type { RemoteDesignMeta, RemoteFolder } from "./sync-types";

const T0 = "2026-09-01T00:00:00.000Z";
const T1 = "2026-09-01T01:00:00.000Z";
const T2 = "2026-09-01T02:00:00.000Z";
const T3 = "2026-09-01T03:00:00.000Z";

function remote(id: string, extra: Partial<RemoteDesignMeta> = {}): RemoteDesignMeta {
  return {
    id,
    name: id,
    icon: null,
    folderId: null,
    closed: false,
    favorite: false,
    order: null,
    communityPlanId: null,
    createdAt: T0,
    updatedAt: T1,
    planUpdatedAt: T1,
    deletedAt: null,
    ...extra,
  };
}

describe("reconcileDesigns", () => {
  it("pulls a design this browser has never seen", () => {
    expect(reconcileDesigns([], [remote("a")])).toEqual([
      { kind: "pull-plan", id: "a", remote: remote("a") },
    ]);
  });

  it("pushes a design the account has never seen, plan and all", () => {
    expect(reconcileDesigns([{ id: "a", updatedAt: T1 }], [])).toEqual([
      { kind: "push", id: "a", withPlan: true },
    ]);
  });

  it("does nothing when both sides still agree", () => {
    const local = { id: "a", updatedAt: T1, metaUpdatedAt: T1, remoteUpdatedAt: T1 };
    expect(reconcileDesigns([local], [remote("a")])).toEqual([]);
  });

  it("pushes only the metadata for a rename", () => {
    // The plan stamp stayed at T1; the meta stamp moved to T2.
    const local = { id: "a", updatedAt: T1, metaUpdatedAt: T2, remoteUpdatedAt: T1 };
    expect(reconcileDesigns([local], [remote("a")])).toEqual([
      { kind: "push", id: "a", withPlan: false },
    ]);
  });

  it("pushes the plan after an edit", () => {
    const local = { id: "a", updatedAt: T2, metaUpdatedAt: T2, remoteUpdatedAt: T1 };
    expect(reconcileDesigns([local], [remote("a")])).toEqual([
      { kind: "push", id: "a", withPlan: true },
    ]);
  });

  it("pulls only the metadata when the account renamed it", () => {
    const local = { id: "a", updatedAt: T1, metaUpdatedAt: T1, remoteUpdatedAt: T1 };
    const r = remote("a", { updatedAt: T2, planUpdatedAt: T1 });
    expect(reconcileDesigns([local], [r])).toEqual([{ kind: "pull-meta", id: "a", remote: r }]);
  });

  it("pulls the plan when the account edited it", () => {
    const local = { id: "a", updatedAt: T1, metaUpdatedAt: T1, remoteUpdatedAt: T1 };
    const r = remote("a", { updatedAt: T2, planUpdatedAt: T2 });
    expect(reconcileDesigns([local], [r])).toEqual([{ kind: "pull-plan", id: "a", remote: r }]);
  });

  it("lets the later writer win when both sides moved", () => {
    const localOlder = { id: "a", updatedAt: T2, metaUpdatedAt: T2, remoteUpdatedAt: T1 };
    const remoteNewer = remote("a", { updatedAt: T3, planUpdatedAt: T3 });
    expect(reconcileDesigns([localOlder], [remoteNewer])).toEqual([
      { kind: "pull-plan", id: "a", remote: remoteNewer },
    ]);

    const localNewer = { id: "a", updatedAt: T3, metaUpdatedAt: T3, remoteUpdatedAt: T1 };
    const remoteOlder = remote("a", { updatedAt: T2, planUpdatedAt: T2 });
    expect(reconcileDesigns([localNewer], [remoteOlder])).toEqual([
      { kind: "push", id: "a", withPlan: true },
    ]);
  });

  it("deletes the local copy for a tombstone it had synced", () => {
    const local = { id: "a", updatedAt: T1, metaUpdatedAt: T1, remoteUpdatedAt: T1 };
    const gone = remote("a", { updatedAt: T2, deletedAt: T2 });
    expect(reconcileDesigns([local], [gone])).toEqual([{ kind: "delete-local", id: "a" }]);
  });

  it("brings a design back when it was edited after the delete", () => {
    const local = { id: "a", updatedAt: T3, metaUpdatedAt: T3, remoteUpdatedAt: T1 };
    const gone = remote("a", { updatedAt: T2, deletedAt: T2 });
    expect(reconcileDesigns([local], [gone])).toEqual([
      { kind: "push", id: "a", withPlan: true },
    ]);
  });

  it("ignores a tombstone for a design it never had", () => {
    expect(reconcileDesigns([], [remote("a", { deletedAt: T2 })])).toEqual([]);
  });
});

describe("reconcileFolders", () => {
  const folder = (id: string, extra: Partial<RemoteFolder> = {}): RemoteFolder => ({
    id,
    name: id,
    createdAt: T0,
    updatedAt: T1,
    deletedAt: null,
    ...extra,
  });

  it("pulls, pushes and deletes by the same rules", () => {
    expect(reconcileFolders([], [folder("f")])).toEqual([
      { kind: "pull", id: "f", remote: folder("f") },
    ]);
    expect(reconcileFolders([{ id: "g", createdAt: T1, updatedAt: T1 }], [])).toEqual([
      { kind: "push", id: "g" },
    ]);
    const synced = { id: "f", createdAt: T0, updatedAt: T1, remoteUpdatedAt: T1 };
    expect(reconcileFolders([synced], [folder("f")])).toEqual([]);
    expect(reconcileFolders([synced], [folder("f", { updatedAt: T2, deletedAt: T2 })])).toEqual([
      { kind: "delete-local", id: "f" },
    ]);
    const renamedHere = { ...synced, updatedAt: T2 };
    expect(reconcileFolders([renamedHere], [folder("f")])).toEqual([{ kind: "push", id: "f" }]);
  });
});

describe("libraryChangeSignature", () => {
  const design = { id: "a", name: "A", createdAt: T0, updatedAt: T1, metaUpdatedAt: T1 };
  const folder = { id: "f", name: "F", createdAt: T0, updatedAt: T1 };
  const base = libraryChangeSignature([design], [folder]);

  it("does not move for a relist that changed nothing, or for sync's own stamp", () => {
    // A refused design kept sync relisting the library every run, and the
    // relist read as an edit: one player's browser synced every 6 s for hours.
    expect(libraryChangeSignature([{ ...design }], [{ ...folder }])).toBe(base);
    expect(libraryChangeSignature([{ ...design, remoteUpdatedAt: T2 } as typeof design], [folder])).toBe(base);
  });

  it("moves for an edit, a rename, a new design or a folder change", () => {
    expect(libraryChangeSignature([{ ...design, updatedAt: T2 }], [folder])).not.toBe(base);
    expect(libraryChangeSignature([{ ...design, metaUpdatedAt: T2 }], [folder])).not.toBe(base);
    expect(libraryChangeSignature([design, { ...design, id: "b" }], [folder])).not.toBe(base);
    expect(libraryChangeSignature([design], [{ ...folder, updatedAt: T2 }])).not.toBe(base);
    expect(libraryChangeSignature([design], [])).not.toBe(base);
  });
});

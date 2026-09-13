import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FactoryProject } from "@/lib/model/types";

vi.mock("@/lib/board-sounds", () => ({
  playBoardSound: vi.fn(),
  primeBoardSounds: vi.fn(),
}));

import { playBoardSound } from "@/lib/board-sounds";
import { playProjectDiff, snapshotProject } from "./use-board-sound-effects";

/**
 * The board's sounds come from diffing project snapshots, so the whole
 * question of WHAT plays for WHICH change is testable without a browser.
 */

const played = playBoardSound as ReturnType<typeof vi.fn>;

function project(overrides: Partial<FactoryProject>): FactoryProject {
  return {
    schemaVersion: 1,
    id: "p",
    name: "Test",
    recipes: [],
    nodes: [],
    edges: [],
    fuelProfiles: [],
    ...overrides,
  } as FactoryProject;
}

const node = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    recipeId: "r",
    machineCount: 1,
    position: { x: 0, y: 0 },
    ...extra,
  }) as FactoryProject["nodes"][number];

const edge = (id: string) =>
  ({
    id,
    source: "a",
    target: "b",
    resourceKind: "item",
    resourceId: "x",
  }) as FactoryProject["edges"][number];

function diff(before: FactoryProject, after: FactoryProject): string[] {
  played.mockClear();
  playProjectDiff(snapshotProject(before), snapshotProject(after));
  return played.mock.calls.map((call) => call[0] as string);
}

describe("playProjectDiff", () => {
  beforeEach(() => played.mockClear());

  it("thumps when a card lands, even with its wire", () => {
    const before = project({ nodes: [node("a")] });
    const after = project({ nodes: [node("a"), node("b")], edges: [edge("e1")] });
    expect(diff(before, after)).toEqual(["place"]);
  });

  it("plays connect for a wire alone, unwire for a cut", () => {
    const before = project({ nodes: [node("a"), node("b")] });
    const after = project({ nodes: [node("a"), node("b")], edges: [edge("e1")] });
    expect(diff(before, after)).toEqual(["connect"]);
    expect(diff(after, before)).toEqual(["unwire"]);
  });

  it("plays delete once when a card leaves with its wires", () => {
    const before = project({ nodes: [node("a"), node("b")], edges: [edge("e1")] });
    const after = project({ nodes: [node("b")] });
    expect(diff(before, after)).toEqual(["delete"]);
  });

  it("taps adjust for a settings change: machine count, drain pill, config", () => {
    const before = project({ nodes: [node("a", { machineCount: 1 })] });
    const after = project({ nodes: [node("a", { machineCount: 2 })] });
    expect(diff(before, after)).toEqual(["adjust"]);

    const drawerBefore = project({
      storages: [{ id: "s", kind: "item", resourceId: "x", position: { x: 0, y: 0 } }],
    } as Partial<FactoryProject>);
    const drawerAfter = project({
      storages: [
        { id: "s", kind: "item", resourceId: "x", drainMode: "trash", position: { x: 0, y: 0 } },
      ],
    } as Partial<FactoryProject>);
    expect(diff(drawerBefore, drawerAfter)).toEqual(["adjust"]);
  });

  it("gives each drawer mode one distinct sound, including undo and redo", () => {
    const drawer = { id: "s", kind: "item" as const, resourceId: "x", position: { x: 0, y: 0 } };
    const overflow = project({ storages: [drawer] });
    const strict = project({ storages: [{ ...drawer, bufferMode: "strict" }] });
    const ratio = project({ storages: [{ ...drawer, bufferMode: "ratio" }] });
    expect(diff(overflow, strict)).toEqual(["drawerStrict"]);
    expect(diff(strict, ratio)).toEqual(["drawerRatio"]);
    expect(diff(ratio, overflow)).toEqual(["drawerOverflow"]);
    expect(diff(ratio, strict)).toEqual(["drawerStrict"]);
    expect(diff(strict, ratio)).toEqual(["drawerRatio"]);
    expect(diff(ratio, structuredClone(ratio))).toEqual([]);
  });

  it("keeps bulk drawer mode changes to one sound", () => {
    const drawers = ["a", "b"].map((id) => ({
      id,
      kind: "fluid" as const,
      resourceId: "water",
      position: { x: 0, y: 0 },
    }));
    expect(
      diff(
        project({ storages: drawers }),
        project({ storages: drawers.map((s) => ({ ...s, bufferMode: "ratio" })) }),
      ),
    ).toEqual(["sweep"]);
  });

  it("zaps for a power wire, even when the gesture spawned a drawer too", () => {
    const powerEdge = { ...edge("pz"), resourceKind: "power" as const, resourceId: "eu" };
    const before = project({ nodes: [node("a"), node("b")] });
    const wired = project({ nodes: [node("a"), node("b")], edges: [powerEdge] });
    expect(diff(before, wired)).toEqual(["zap"]);

    const machine = project({ nodes: [node("g")] });
    const withEuDrawer = project({
      nodes: [node("g")],
      storages: [{ id: "s", kind: "power", resourceId: "eu", position: { x: 0, y: 0 } }],
      edges: [{ ...powerEdge, source: "g", target: "s" }],
    } as Partial<FactoryProject>);
    expect(diff(machine, withEuDrawer)).toEqual(["zap"]);
    // The complements: cutting the wire, or deleting the drawer with its
    // wire, discharges instead of the ordinary delete or unwire.
    expect(diff(withEuDrawer, machine)).toEqual(["zapOff"]);
    expect(diff(wired, before)).toEqual(["zapOff"]);
  });

  it("tells a supply drawer from a catch drawer by the wire direction", () => {
    const machine = project({ nodes: [node("m")] });
    const withSupply = project({
      nodes: [node("m")],
      storages: [{ id: "s", kind: "item", resourceId: "x", position: { x: 0, y: 0 } }],
      edges: [{ ...edge("e1"), source: "s", target: "m" }],
    } as Partial<FactoryProject>);
    expect(diff(machine, withSupply)).toEqual(["placeSource"]);

    const withCatch = project({
      nodes: [node("m")],
      storages: [{ id: "s", kind: "item", resourceId: "x", position: { x: 0, y: 0 } }],
      edges: [{ ...edge("e1"), source: "m", target: "s" }],
    } as Partial<FactoryProject>);
    expect(diff(machine, withCatch)).toEqual(["placeProduct"]);
  });

  it("plays open and close when a board unfolds and folds", () => {
    const folded = project({
      pockets: [{ id: "p", name: "Zone" }],
    } as Partial<FactoryProject>);
    const unfolded = project({
      pockets: [{ id: "p", name: "Zone", expanded: true, size: { width: 400, height: 300 } }],
    } as Partial<FactoryProject>);
    expect(diff(folded, unfolded)).toEqual(["open"]);
    expect(diff(unfolded, folded)).toEqual(["close"]);
  });

  it("stays silent for a pure move", () => {
    const before = project({ nodes: [node("a")] });
    const after = project({ nodes: [{ ...node("a"), position: { x: 100, y: 100 } }] });
    expect(diff(before, after)).toEqual([]);
  });

  it("plays one sweep for a bulk change", () => {
    const before = project({});
    const after = project({
      nodes: [node("a"), node("b"), node("c"), node("d"), node("e")],
      edges: [edge("e1"), edge("e2"), edge("e3"), edge("e4")],
    });
    expect(diff(before, after)).toEqual(["sweep"]);
  });
});

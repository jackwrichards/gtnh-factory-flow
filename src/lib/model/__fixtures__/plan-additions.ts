import { loadBiodieselDemoProject } from "@/examples";
import type { FactoryProject } from "../types";

/** A plan carrying every cloud and live addition: the game's data on each kind of thing, the view it opens on, tasks. */
export const game = (kind: string) => ({
  v: 1,
  game: { kind, settings: { pins: [1, 2.5], nested: { deep: true } } },
  sum: "abc123",
});

export function planWithAdditions(): FactoryProject {
  const demo = loadBiodieselDemoProject();
  const [first, ...rest] = demo.nodes;
  return {
    ...demo,
    gtnhplanner: { v: 1, balance: "auto", groups: [{ id: "g1", nodes: [first!.id] }] },
    primaryView: "tasks",
    nodes: [{ ...first!, gtnhplanner: game("node") }, ...rest],
    storages: [
      {
        id: "drawer-1",
        kind: "item",
        resourceId: "minecraft:iron_ingot",
        position: { x: 40, y: 40 },
        gtnhplanner: game("storage"),
      },
    ],
    edges: demo.edges.map((edge, at) => (at === 0 ? { ...edge, gtnhplanner: game("edge") } : edge)),
    annotations: [
      {
        id: "note-1",
        kind: "text",
        text: "Hello",
        position: { x: 0, y: 0 },
        size: { width: 100, height: 40 },
        gtnhplanner: game("note"),
      },
    ],
    pockets: [
      {
        id: "pocket-1",
        name: "Group 1",
        position: { x: 0, y: 0 },
        expanded: true,
        size: { width: 400, height: 200 },
        gtnhplanner: game("pocket"),
      },
    ],
    tasks: [
      {
        id: "t1",
        title: "Build the biodiesel line",
          sourcePlans: [{ plan: "biodiesel-plan", name: "Biodiesel line" }],
        text: "Two LV mixers first.",
        status: "doing",
        order: "a0",
        assignees: ["11111111-1111-4111-8111-111111111111"],
        nodeIds: [first!.id],
        createdBy: "11111111-1111-4111-8111-111111111111",
        createdAt: "2026-10-14T10:00:00.000Z",
        priority: "high",
        movedAt: "2026-10-14T12:00:00.000Z",
        blockedBy: ["t2"],
      },
      {
        id: "t2",
        title: "Done thing",
        status: "done",
        order: "a1",
        doneAt: "2026-10-14T11:00:00.000Z",
        priority: "low",
        links: [{ plan: "11111111-1111-4111-8111-111111111111:design-other-1", node: "card-9" }],
      },
    ],
    taskItems: [
      { id: "i1", taskId: "t1", text: "Place mixers", done: true, order: "a0", nodeId: first!.id },
      {
        id: "i2",
        taskId: "t1",
        text: "4x Wire them",
        done: false,
        order: "a1",
        link: { plan: "local-plan-1", node: "card-3" },
      },
      {
        id: "i3",
        taskId: "t1",
        kind: "machine",
        text: "4× Electric Blast Furnace (HV)",
        done: false,
        order: "a2",
        link: { plan: "local-plan-1", node: "card-4" },
      },
      {
        id: "i4",
        taskId: "t1",
        kind: "location",
        text: "Ore field at 120 64 -30 in Overworld",
        done: false,
        order: "a3",
        place: {
          x: 120,
          y: 64,
          z: -30,
          dim: 0,
          dimName: "Overworld",
          world: "server:0123456789abcdef",
          label: "Ore field",
        },
      },
      {
        id: "i5",
        taskId: "t1",
        kind: "picture",
        text: "Screenshot",
        done: true,
        order: "a4",
        picture: {
          thumb: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==",
          w: 1920,
          h: 1080,
          takenAt: "2026-10-14T10:30:00.000Z",
          file: "2026-10-14_10.30.00.png",
        },
      },
      {
        // A quest in the game's quest book: the game's only, kept as it came.
        id: "i6",
        taskId: "t1",
        kind: "quest",
        text: "Steam Age",
        done: false,
        order: "a5",
        quest: {
          id: "0f2a43a5-6c1e-4d7a-9b3b-6a8f3b0e2c11",
          name: "Steam Age",
          icon: "item:IC2:itemToolBronzePickaxe:0",
          line: "Tier 1 - Steam",
        },
      },
    ],
    taskComments: [
      {
        id: "c1",
        taskId: "t1",
        by: "11111111-1111-4111-8111-111111111111",
        byName: "ann",
        at: "2026-10-14T10:05:00.000Z",
        text: "On it",
      },
    ],
  };
}

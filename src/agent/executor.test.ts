import { describe, expect, it } from "vitest";
import { StubExecutor } from "./executor";
import type { Action } from "./types";

const ACTIONS: Action[] = [
  { type: "goto", at: { x: 1, y: 64, z: 2 } },
  { type: "place", item: { kind: "item", id: "machine:furnace" }, at: { x: 2, y: 64, z: 2 } },
  { type: "insert", machine: { x: 2, y: 64, z: 2 }, item: { kind: "item", id: "ore:iron" }, amount: 4 },
  { type: "say", text: "furnace placed" },
];

describe("StubExecutor", () => {
  it("records every action in order and reports success", async () => {
    const exec = new StubExecutor();
    for (const action of ACTIONS) {
      const result = await exec.act(action);
      expect(result.ok).toBe(true);
    }
    expect(exec.types).toEqual(["goto", "place", "insert", "say"]);
    expect(exec.actions).toHaveLength(ACTIONS.length);
  });

  it("echoes the text of a say action", async () => {
    const exec = new StubExecutor();
    const result = await exec.act({ type: "say", text: "hello" });
    expect(result.message).toBe("said: hello");
  });

  it("reports the configured world state", async () => {
    const exec = new StubExecutor({
      worldState: {
        playerId: "bob",
        playerAt: { x: 9, y: 64, z: 9 },
        inventory: [{ id: "ingot:iron", kind: "item", amount: 3, name: "Iron Ingot" }],
        machines: [],
      },
    });
    const world = await exec.getState();
    expect(world.playerId).toBe("bob");
    expect(world.playerAt).toEqual({ x: 9, y: 64, z: 9 });
    expect(world.inventory).toHaveLength(1);
  });
});

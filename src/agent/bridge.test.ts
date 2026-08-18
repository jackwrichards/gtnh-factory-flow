import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgentHandle, createBridgeServer, serverPort, type AgentHandle } from "./bridge";
import { createStubLlm } from "./llm";
import { InMemoryMemoryStore, makeFakeDatasetQuery } from "./fakes";
import { StubExecutor } from "./executor";

// A handle whose LLM immediately commits a one-action plan. Each handle owns
// its own stub, so tests don't share a consumed queue.
function makeHandle(): AgentHandle {
  return createAgentHandle({
    llm: createStubLlm([
      {
        toolCalls: [
          { id: "1", name: "finish_plan", args: { reply: "On it!", actions: [{ type: "say", text: "building" }] } },
        ],
      },
    ]),
    dataset: makeFakeDatasetQuery(),
    executor: new StubExecutor(),
    memory: new InMemoryMemoryStore(),
    system: "sys",
  });
}

describe("createAgentHandle", () => {
  it("plans a task, drives its actions, and returns the resulting world state", async () => {
    const handle = makeHandle();
    const response = await handle.handleTask({ task: "build a furnace", worldName: "test" });

    expect(response.plan.reply).toBe("On it!");
    // The one planned action was driven through the executor.
    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.ok).toBe(true);
    expect(response.worldState.playerId).toBe("player");
    expect(response.steps).toBe(1);
  });

  it("uses the world state the mod supplies when present", async () => {
    const handle = makeHandle();
    const response = await handle.handleTask({
      task: "build a furnace",
      worldName: "test",
      worldState: {
        playerId: "alice",
        playerAt: { x: 5, y: 70, z: 9 },
        inventory: [],
        machines: [],
      },
    });
    expect(response.plan.reply).toBe("On it!");
  });
});

describe("createBridgeServer", () => {
  let base: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const server = await createBridgeServer(makeHandle(), 0, "127.0.0.1");
    base = `http://127.0.0.1:${serverPort(server)}`;
    close = () => new Promise((resolve) => server.close(() => resolve()));
  });

  afterAll(async () => {
    await close();
  });

  it("serves GET /health", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("answers POST /task with a TaskResponse", async () => {
    const res = await fetch(`${base}/task`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: "build a furnace", worldName: "test" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plan: { reply: string }; results: unknown[] };
    expect(body.plan.reply).toBe("On it!");
    expect(body.results).toHaveLength(1);
  });

  it("rejects a task missing required fields with 400", async () => {
    const res = await fetch(`${base}/task`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: "build a furnace" }), // no worldName
    });
    expect(res.status).toBe(400);
  });

  it("404s unknown routes", async () => {
    const res = await fetch(`${base}/nope`, { method: "POST" });
    expect(res.status).toBe(404);
  });
});

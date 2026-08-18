import { describe, expect, it } from "vitest";
import { runAgent } from "./agent-loop";
import { createStubLlm } from "./llm";
import type { Brain, LlmTool, WorldState } from "./types";

const WORLD: WorldState = {
  playerId: "player",
  playerAt: { x: 0, y: 64, z: 0 },
  inventory: [{ id: "ore:iron", kind: "item", amount: 4, name: "Raw Iron Ore" }],
  machines: [],
};

// A minimal brain that records which tool the model asked for, and ends via
// finish_plan exactly like the real one (returns the args as a Plan).
function makeRecordingBrain(onTool?: (name: string, args: Record<string, unknown>) => void): Brain {
  const tools: LlmTool[] = [
    {
      name: "search_resources",
      description: "",
      parameters: {},
      execute: async (args) => {
        onTool?.("search_resources", args);
        return { found: [] };
      },
    },
    {
      name: "finish_plan",
      description: "",
      parameters: {},
      execute: async (args) => {
        onTool?.("finish_plan", args);
        const a = args as { reply?: string; actions?: unknown[]; needs?: unknown[]; notes?: string };
        return { reply: a.reply ?? "", actions: a.actions ?? [], needs: a.needs, notes: a.notes };
      },
    },
  ];
  return { tools: () => tools };
}

describe("runAgent", () => {
  it("drives tool calls and ends on finish_plan", async () => {
    const calls: Array<{ name: string; query?: string }> = [];
    const brain = makeRecordingBrain((name, args) => {
      calls.push({ name, query: (args as { query?: string }).query });
    });
    const llm = createStubLlm([
      { toolCalls: [{ id: "c1", name: "search_resources", args: { query: "iron" } }] },
      {
        toolCalls: [
          { id: "c2", name: "finish_plan", args: { reply: "On it!", actions: [{ type: "say", text: "hi" }] } },
        ],
      },
    ]);

    const result = await runAgent(llm, brain, "make iron", WORLD, { system: "sys" });

    expect(result.plan.reply).toBe("On it!");
    expect(result.plan.actions).toEqual([{ type: "say", text: "hi" }]);
    expect(result.steps).toBe(2);
    expect(calls).toEqual([
      { name: "search_resources", query: "iron" },
      { name: "finish_plan" },
    ]);
  });

  it("treats a prose answer as a finished, answer-only plan", async () => {
    const brain = makeRecordingBrain();
    const llm = createStubLlm([{ content: "You'll want a low-voltage furnace for that." }]);
    const result = await runAgent(llm, brain, "how do I make steel?", WORLD, { system: "sys" });
    expect(result.plan.reply).toBe("You'll want a low-voltage furnace for that.");
    expect(result.plan.actions).toEqual([]);
    expect(result.steps).toBe(1);
  });

  it("feeds an unknown tool back as an error and keeps going", async () => {
    const brain = makeRecordingBrain();
    const llm = createStubLlm([
      { toolCalls: [{ id: "c1", name: "nope", args: {} }] },
      { toolCalls: [{ id: "c2", name: "finish_plan", args: { reply: "recovered", actions: [] } }] },
    ]);
    const result = await runAgent(llm, brain, "task", WORLD, { system: "sys" });
    expect(result.plan.reply).toBe("recovered");
    expect(result.steps).toBe(2);
  });

  it("stops at maxSteps with a fallback reply when the model never ends", async () => {
    const brain = makeRecordingBrain();
    // The model keeps calling a non-terminal tool.
    const llm = createStubLlm([
      { toolCalls: [{ id: "c1", name: "search_resources", args: { query: "x" } }] },
    ]);
    const result = await runAgent(llm, brain, "task", WORLD, { system: "sys", maxSteps: 1 });
    expect(result.plan.actions).toEqual([]);
    expect(result.plan.reply).toContain("ran out of planning steps");
    expect(result.steps).toBe(1);
  });

  it("accumulates token usage across calls", async () => {
    const brain = makeRecordingBrain();
    const llm = createStubLlm([
      { toolCalls: [{ id: "c1", name: "search_resources", args: { query: "x" } }], usage: { promptTokens: 10, completionTokens: 5 } },
      { toolCalls: [{ id: "c2", name: "finish_plan", args: { reply: "done", actions: [] } }], usage: { promptTokens: 20, completionTokens: 7 } },
    ]);
    const result = await runAgent(llm, brain, "task", WORLD, { system: "sys" });
    expect(result.usage).toEqual({ promptTokens: 30, completionTokens: 12 });
  });
});

import { describe, expect, it } from "vitest";
import { createBrain } from "./brain";
import { InMemoryMemoryStore, makeFakeDatasetQuery } from "./fakes";
import { StubExecutor } from "./executor";
import type { Plan, WorldState } from "./types";

const WORLD: WorldState = {
  playerId: "player",
  playerAt: { x: 0, y: 64, z: 0 },
  inventory: [{ id: "ore:iron", kind: "item", amount: 4, name: "Raw Iron Ore" }],
  machines: [],
};

function makeDeps() {
  const dataset = makeFakeDatasetQuery();
  const executor = new StubExecutor({ worldState: WORLD });
  const memory = new InMemoryMemoryStore();
  const brain = createBrain({ dataset, executor, memory, worldName: "test" });
  return { dataset, executor, memory, brain };
}

function tool(brain: ReturnType<typeof createBrain>, name: string) {
  const found = brain.tools().find((t) => t.name === name);
  if (!found) throw new Error(`no tool named ${name}`);
  return found;
}

describe("brain tools", () => {
  it("exposes the expected tool set", () => {
    const { brain } = makeDeps();
    const names = brain.tools().map((t) => t.name).sort();
    expect(names).toEqual(
      ["analyze_factory", "find_recipes", "finish_plan", "get_recipe", "recall", "remember", "search_resources", "world_state"].sort(),
    );
  });

  it("search_resources matches by name and id, and notes a miss", async () => {
    const { brain } = makeDeps();
    const found = (await tool(brain, "search_resources").execute({ query: "iron" })) as {
      found: { id: string }[];
    };
    expect(found.found.map((r) => r.id)).toEqual(["ingot:iron", "ore:iron"]);

    const miss = (await tool(brain, "search_resources").execute({ query: "zzz" })) as {
      found: unknown[];
      note: string;
    };
    expect(miss.found).toEqual([]);
    expect(miss.note).toContain("zzz");
  });

  it("find_recipes returns hits and rejects a bad resource or mode", async () => {
    const { brain } = makeDeps();
    const makes = (await tool(brain, "find_recipes").execute({
      resource: { kind: "item", id: "ingot:iron" },
      mode: "recipes",
    })) as { found: { id: string }[] };
    expect(makes.found[0]?.id).toBe("recipe:smelter:iron");

    const badResource = (await tool(brain, "find_recipes").execute({ resource: { id: "x" }, mode: "recipes" })) as {
      error: string;
    };
    expect(badResource.error).toBeTruthy();

    const badMode = (await tool(brain, "find_recipes").execute({
      resource: { kind: "item", id: "ingot:iron" },
      mode: "nope",
    })) as { error: string };
    expect(badMode.error).toBeTruthy();
  });

  it("get_recipe returns the full, readable detail", async () => {
    const { brain } = makeDeps();
    const detail = (await tool(brain, "get_recipe").execute({ recipeId: "recipe:smelter:iron" })) as {
      machineType: string;
      inputs: { id: string; amount: number }[];
      outputs: { id: string; amount: number }[];
    };
    expect(detail.machineType).toBe("Furnace");
    expect(detail.inputs).toEqual([{ kind: "item", id: "ore:iron", name: "Raw Iron Ore", amount: 1 }]);
    expect(detail.outputs).toEqual([{ kind: "item", id: "ingot:iron", name: "Iron Ingot", amount: 1 }]);

    const missing = (await tool(brain, "get_recipe").execute({ recipeId: "nope" })) as { error: string };
    expect(missing.error).toContain("nope");
  });

  it("analyze_factory checks a single-machine layout against the solver", async () => {
    const { brain } = makeDeps();
    const result = (await tool(brain, "analyze_factory").execute({
      nodes: [{ id: "furnace", recipeId: "recipe:smelter:iron" }],
    })) as {
      ok: boolean;
      totalEuPerSecond: number;
      missingRecipes: { recipeId: string }[];
      mustSupply: { id: string }[];
      byproducts: { id: string }[];
    };
    expect(result.ok).toBe(true);
    expect(result.totalEuPerSecond).toBeGreaterThan(0);
    expect(result.missingRecipes).toEqual([]);
    // The ore is a bare input (no feeder) -> a deficit the player must supply.
    expect(result.mustSupply.map((r) => r.id)).toContain("ore:iron");
    // The ingot goes nowhere (no drain) -> an unconsumed byproduct.
    expect(result.byproducts.map((r) => r.id)).toContain("ingot:iron");
  });

  it("analyze_factory reports a target and flags missing recipes", async () => {
    const { brain } = makeDeps();
    const withTarget = (await tool(brain, "analyze_factory").execute({
      target: { kind: "item", id: "ingot:iron", name: "Iron Ingot", amountPerSecond: 0.2 },
      nodes: [{ id: "furnace", recipeId: "recipe:smelter:iron" }],
    })) as { ok: boolean; target: { id: string } | undefined };
    expect(withTarget.ok).toBe(true);
    expect(withTarget.target?.id).toBe("ingot:iron");

    const missing = (await tool(brain, "analyze_factory").execute({
      nodes: [{ id: "ghost", recipeId: "recipe:does-not-exist" }],
    })) as { ok: boolean; missingRecipes: { recipeId: string }[] };
    expect(missing.missingRecipes.map((n) => n.recipeId)).toEqual(["recipe:does-not-exist"]);
  });

  it("analyze_factory requires at least one node", async () => {
    const { brain } = makeDeps();
    const result = (await tool(brain, "analyze_factory").execute({ nodes: [] })) as { error: string };
    expect(result.error).toBeTruthy();
  });

  it("recall reads and remember writes the per-world memory", async () => {
    const { brain } = makeDeps();
    const blank = (await tool(brain, "recall").execute({})) as { notes: string[] };
    expect(blank.notes).toEqual([]);

    const saved = (await tool(brain, "remember").execute({
      note: "player prefers HVA coils",
      builtMachine: "Furnace",
    })) as { ok: boolean; saved: string };
    expect(saved.ok).toBe(true);
    expect(saved.saved).toBe("player prefers HVA coils");

    const recalled = (await tool(brain, "recall").execute({})) as { notes: string[]; builtMachines: Record<string, number> };
    expect(recalled.notes).toEqual(["player prefers HVA coils"]);
    expect(recalled.builtMachines["Furnace"]).toBe(1);
  });

  it("world_state returns the executor's world", async () => {
    const { brain } = makeDeps();
    const state = (await tool(brain, "world_state").execute({})) as { playerId: string };
    expect(state.playerId).toBe("player");
  });

  it("finish_plan normalizes args into a Plan and drops invalid actions", async () => {
    const { brain } = makeDeps();
    const plan = (await tool(brain, "finish_plan").execute({
      reply: "Building it now.",
      actions: [
        { type: "goto", at: { x: 1, y: 2, z: 3 } },
        { type: "nonsense", at: { x: 0, y: 0, z: 0 } },
        { type: "say" }, // missing text
      ],
      needs: [{ kind: "item", id: "ingot:iron" }, { id: "bad" }],
      notes: "use the smelter",
    })) as Plan;
    expect(plan.reply).toBe("Building it now.");
    // Only the well-formed goto survives.
    expect(plan.actions).toEqual([{ type: "goto", at: { x: 1, y: 2, z: 3 } }]);
    // Only the well-formed resource survives.
    expect(plan.needs).toEqual([{ kind: "item", id: "ingot:iron" }]);
    expect(plan.notes).toBe("use the smelter");
  });
});

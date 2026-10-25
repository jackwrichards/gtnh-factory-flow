import { afterEach, describe, expect, it } from "vitest";
import type { MachineTier, Recipe } from "../../../model/types";
import { calculateThroughput } from "../../throughput";
import type { SolveInput } from "../types";
import { getSolveCore, setSolveCore } from "./engine";
import { drawer, node, project, wire } from "./test-kit";

afterEach(() => setSolveCore(undefined));

/** What the engine is told one craft of the card's machine takes and makes, by port name. */
function perCraft(recipe: Recipe, item: string, tier: MachineTier, machineCount = 0) {
  const real = getSolveCore();
  let input!: SolveInput;
  setSolveCore((solveInput) => {
    input = solveInput;
    return real(solveInput);
  });
  const result = calculateThroughput(
    project({
      recipes: [recipe],
      nodes: [node("n", recipe.id, { machineCount, overclockTier: tier })],
      storages: [drawer("d", item, { targetPerSecond: 45, targetMode: "at-least" })],
      edges: [wire("e", "n", "d", item, {}, { toDrawer: true })],
    }),
    { generatedAt: "t" },
  );
  const machine = input.machines[0]!;
  const amounts = (ports: typeof machine.outputs) => Object.fromEntries(ports.map((port) => [port.name, port.amount]));
  return { inputs: amounts(machine.inputs), outputs: amounts(machine.outputs), machines: result.nodes.n!.theoreticalMachinesRequired };
}

describe("a card with no count", () => {
  // MTETreeFarm: NEI amount x (2t^2 - 2t + 5) x the tool, a 100-tick run.
  const bamboo: Recipe = {
    id: "tgs-bamboo",
    name: "Tree Growth Simulator: Bamboo",
    machineType: "Tree Growth Simulator",
    minimumTier: "LV",
    durationTicks: 100,
    eut: 0,
    inputs: [],
    outputs: [
      { kind: "item", id: "biomesoplenty:bamboo", amount: 5, displayName: "Bamboo" },
      { kind: "item", id: "biomesoplenty:saplings@2", amount: 5, displayName: "Bamboo Sapling" },
      { kind: "item", id: "biomesoplenty:leaves1@9", amount: 2, displayName: "Bamboo Leaves" },
    ],
    source: { recipeMap: "Tree Growth Simulator" },
  };

  it("makes what its tier makes: a Tree Growth Simulator at IV makes 9 times LV's", () => {
    const lv = perCraft(bamboo, "biomesoplenty:bamboo", "LV");
    expect(lv.outputs).toEqual({ Bamboo: 25, "Bamboo Sapling": 25, "Bamboo Leaves": 10 });
    expect(lv.machines).toBeCloseTo(9);
    const iv = perCraft(bamboo, "biomesoplenty:bamboo", "IV");
    expect(iv.outputs).toEqual({ Bamboo: 225, "Bamboo Sapling": 225, "Bamboo Leaves": 90 });
    expect(iv.machines).toBeCloseTo(1);
  });

  it("reads the same per craft as a counted card", () => {
    expect(perCraft(bamboo, "biomesoplenty:bamboo", "IV").outputs).toEqual(
      perCraft(bamboo, "biomesoplenty:bamboo", "IV", 1).outputs,
    );
  });
});

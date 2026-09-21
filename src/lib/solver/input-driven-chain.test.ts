import { describe, expect, it } from "vitest";
import { calculateThroughput } from "./throughput";
import { getPoolGroupResources, getPoolProject } from "./pool-mode";
import { solveSolveMode } from "./solve-mode";
import { solveLp, type LinearProgram } from "./simplex";
import {
  PROJECT_SCHEMA_VERSION,
  type FactoryProject,
  type FactoryStorage,
  type ResourceKind,
} from "../model/types";

function chain(poolMode: boolean, buffer = false): FactoryProject {
  const drawer = (id: string, kind: ResourceKind = "item"): FactoryStorage => ({
    id,
    kind,
    resourceId: id,
    position: { x: 0, y: 0 },
  });
  const wire = (
    source: string,
    target: string,
    resourceId: string,
    resourceKind: ResourceKind = "item",
  ) => ({ id: source + ":" + target, source, target, resourceId, resourceKind });
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "input-chain",
    name: "Input chain",
    poolMode,
    solveMode: true,
    fuelProfiles: [],
    recipes: [
      {
        id: "crush",
        name: "Crush",
        machineType: "Test",
        durationTicks: 20,
        eut: 0,
        minimumTier: "NONE",
        inputs: [{ kind: "item", id: "ore", amount: 1 }],
        outputs: [{ kind: "item", id: "crushed", amount: 2 }],
      },
      {
        id: "wash",
        name: "Wash",
        machineType: "Test",
        durationTicks: 20,
        eut: 0,
        minimumTier: "NONE",
        inputs: [
          { kind: "item", id: "crushed", amount: 2 },
          { kind: "item", id: "leaf", amount: 3 },
          { kind: "fluid", id: "water", amount: 100 },
        ],
        outputs: [{ kind: "item", id: "clean", amount: 4 }],
      },
      {
        id: "finish",
        name: "Finish",
        machineType: "Test",
        durationTicks: 20,
        eut: 0,
        minimumTier: "NONE",
        inputs: [{ kind: "item", id: "clean", amount: 2 }],
        outputs: [{ kind: "item", id: "product", amount: 1 }],
      },
    ],
    nodes: ["crush", "wash", "finish"].map((id) => ({
      id,
      recipeId: id,
      machineCount: 1,
      parallel: 1,
      overclockTier: "NONE",
      enabled: true,
      position: { x: 0, y: 0 },
    })),
    storages: [
      { ...drawer("ore"), targetPerSecond: -1, targetMode: "exact", poolSide: "source" },
      drawer("leaf"),
      drawer("water", "fluid"),
      drawer("product"),
      ...(buffer ? [drawer("crushed")] : []),
    ],
    edges: [
      wire("ore", "crush", "ore"),
      wire("leaf", "wash", "leaf"),
      wire("water", "wash", "water", "fluid"),
      ...(buffer
        ? [wire("crush", "crushed", "crushed"), wire("crushed", "wash", "crushed")]
        : [wire("crush", "wash", "crushed")]),
      wire("wash", "finish", "clean"),
      wire("finish", "product", "product"),
    ],
  };
}

for (const [name, pool, buffer] of [
  ["Pool", true, false],
  ["wired Solve", false, false],
  ["Solve with an intermediate drawer", false, true],
] as const) {
  describe(name, () => {
    it("processes a fixed input through the full chain without an output target", () => {
      const p = chain(pool, buffer);
      const saved = JSON.stringify(p);
      const r = calculateThroughput(p);
      expect(r.nodes.crush.theoreticalMachinesRequired).toBeCloseTo(1);
      expect(r.nodes.wash.theoreticalMachinesRequired).toBeCloseTo(1);
      expect(r.nodes.finish.theoreticalMachinesRequired).toBeCloseTo(2);
      expect(r.storages.ore.consumedPerSecond).toBeCloseTo(1);
      expect(r.storages.product.producedPerSecond).toBeCloseTo(2);
      expect(r.storages.leaf.consumedPerSecond).toBeCloseTo(3);
      expect(r.storages.water.consumedPerSecond).toBeCloseTo(100);
      expect(JSON.stringify(p)).toBe(saved);
    });
    it("reports an incompatible final output cap instead of parking intermediates", () => {
      const p = chain(pool, buffer);
      Object.assign(p.storages!.find((s) => s.id === "product")!, {
        targetMode: "at-most",
        targetPerSecond: 1,
      });
      const r = calculateThroughput(p);
      expect(r.storages.ore.targetUnreachable).toBe(true);
      expect(r.storages.product.producedPerSecond).toBeLessThanOrEqual(1);
    });
  });
}

it("Pool imports supplementary materials without source drawers and lists them under inputs", () => {
  const p = chain(true);
  p.storages = p.storages!.filter((s) => s.id === "ore");
  p.edges = [];
  const r = calculateThroughput(p);
  const rows = getPoolGroupResources(p, r);
  expect(rows.find((row) => row.key === "item:leaf")).toMatchObject({ made: 0, used: 3 });
  expect(rows.find((row) => row.key === "fluid:water")).toMatchObject({ made: 0, used: 100 });
  expect(rows.find((row) => row.key === "item:product")).toMatchObject({ made: 2, used: 0 });
});
it("Pool balances intermediates inside nested production groups", () => {
  const p = chain(true);
  p.productionGroups = [
    { id: "parent", name: "Parent" },
    { id: "child", name: "Child", parentId: "parent" },
  ];
  for (const n of p.nodes) n.productionGroupId = "child";
  const r = calculateThroughput(p);
  expect(r.storages.product.producedPerSecond).toBeCloseTo(2);
  expect(r.storages["pool:group:child:item:crushed"].netPerSecond).toBeCloseTo(0);
});
it("Pool retains Import anyway as an explicit break in intermediate balancing", () => {
  const p = chain(true);
  p.poolResourceRules = { "item:crushed": "import" };
  const r = calculateThroughput(p);
  expect(r.nodes.crush.theoreticalMachinesRequired).toBeCloseTo(1);
  expect(r.nodes.wash.theoreticalMachinesRequired).toBeCloseTo(0);
  expect(r.storages["pool:item:crushed"].netPerSecond).toBeCloseTo(2);
});
it("Solve preserves explicitly chosen overflow storage", () => {
  const p = chain(false, true);
  p.storages!.find((s) => s.id === "crushed")!.bufferMode = "overflow";
  const r = calculateThroughput(p);
  expect(r.nodes.wash.theoreticalMachinesRequired).toBeCloseTo(0);
  expect(r.storages.crushed.netPerSecond).toBeCloseTo(2);
});
it("Solve requires wired sources for supplementary ingredients", () => {
  const p = chain(false, true);
  p.edges = p.edges.filter((e) => e.source !== "water");
  const r = calculateThroughput(p);
  expect(r.storages.ore.targetUnreachable).toBe(true);
  expect(r.nodes.wash.theoreticalMachinesRequired).toBeCloseTo(0);
});
it("Build retains default buffer storage with fixed machine counts", () => {
  const p = chain(false, true);
  p.solveMode = false;
  p.nodes[0].machineCount = 2;
  p.nodes[2].machineCount = 2;
  const r = calculateThroughput(p);
  expect(r.storages.crushed.netPerSecond).toBeCloseTo(2);
});

it("Pool balances recycled input against fresh supply", () => {
  const p = chain(true);
  p.recipes[1].outputs.push({ kind: "item", id: "ore", amount: 0.5 });
  const r = calculateThroughput(p);
  expect(r.storages.ore.consumedPerSecond).toBeCloseTo(1);
  expect(r.nodes.crush.theoreticalMachinesRequired).toBeCloseTo(2);
  expect(r.nodes.wash.theoreticalMachinesRequired).toBeCloseTo(2);
  expect(r.storages.product.producedPerSecond).toBeCloseTo(4);
});
it("Pool exports terminal byproducts without forcing a consumer", () => {
  const p = chain(true);
  p.recipes[0].outputs.push({ kind: "item", id: "byproduct", amount: 0.05 });
  const r = calculateThroughput(p);
  expect(r.storages.product.producedPerSecond).toBeCloseTo(2);
  const row = getPoolGroupResources(p, r).find((row) => row.key === "item:byproduct");
  expect(row?.made).toBeCloseTo(0.05);
  expect(row?.used).toBe(0);
});

// Hold conservation/targets fixed and change ONLY the objective. Shadow's
// variables are recipe runs per minute; ours are multiples of built count.
function objectiveComparison(p: FactoryProject) {
  const expanded = getPoolProject(p);
  const nameplates = calculateThroughput({ ...p, solveMode: false }).nodes;
  let firstProgram: LinearProgram | undefined;
  solveSolveMode(
    expanded,
    nameplates,
    [{ storageId: "ore", input: true, amountPerSecond: -1, exact: true }],
    [],
    undefined,
    (lp) => {
      firstProgram ??= { ...lp, upperBounds: [...lp.upperBounds] };
      return solveLp(lp);
    },
  );
  const lp = firstProgram!;
  const recipesObjective = lp.maximize.map((weight, index) =>
    weight === 0 ? 0 : -nameplates[p.nodes[index].id].operationRatePerSecond,
  );
  return { machines: solveLp(lp), recipeRuns: solveLp({ ...lp, maximize: recipesObjective }) };
}
it("both objectives drive a balanced serial chain, and both stop at an overflow buffer", () => {
  for (const overflow of [false, true]) {
    const p = chain(false, true);
    if (overflow) p.storages!.find((s) => s.id === "crushed")!.bufferMode = "overflow";
    const compared = objectiveComparison(p);
    for (const solution of Object.values(compared)) {
      expect(solution.status).toBe("optimal");
      expect(solution.x[0]).toBeCloseTo(1);
      expect(solution.x[1]).toBeCloseTo(overflow ? 0 : 1);
      expect(solution.x[2]).toBeCloseTo(overflow ? 0 : 2);
    }
  }
});
it("machine-count and recipe-run objectives legitimately choose different competing routes", () => {
  const p = chain(true);
  p.recipes = [
    {
      ...p.recipes[0],
      id: "direct",
      durationTicks: 20,
      outputs: [{ kind: "item", id: "product", amount: 1 }],
    },
    {
      ...p.recipes[0],
      id: "fast-a",
      durationTicks: 1,
      outputs: [{ kind: "item", id: "middle", amount: 1 }],
    },
    {
      ...p.recipes[0],
      id: "fast-b",
      durationTicks: 1,
      inputs: [{ kind: "item", id: "middle", amount: 1 }],
      outputs: [{ kind: "item", id: "product", amount: 1 }],
    },
  ];
  p.nodes = p.recipes.map((recipe) => ({ ...p.nodes[0], id: recipe.id, recipeId: recipe.id }));
  p.storages = [p.storages![0]];
  p.edges = [];
  const { machines, recipeRuns } = objectiveComparison(p);
  expect(machines.status).toBe("optimal");
  expect(recipeRuns.status).toBe("optimal");
  expect(machines.x.slice(0, 3)).toEqual([0, 0.05, 0.05]);
  expect(recipeRuns.x.slice(0, 3)).toEqual([1, 0, 0]);
});

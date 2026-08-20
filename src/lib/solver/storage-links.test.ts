import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject, type FactoryStorage } from "@/lib/model/types";
import { calculateThroughput } from "./throughput";

/**
 * Drawer-to-drawer wires (community request, NyrZ chlorine board, 2026-08).
 *
 * The gesture used to validate on the board and then die silently in the
 * store, and the solver skipped any edge with drawers on both ends. Now a
 * SOURCE wires into a buffer and covers exactly what the buffer's takers pull
 * beyond what real deliveries brought - so a recycling loop keeps a top-up
 * line at its shortfall, and at 0/s the day the loop turns net-positive,
 * instead of forcing the player to delete the source and watch the board die.
 *
 * Every recipe runs one operation per second (20 ticks at 20 t/s, one LV
 * machine), so amounts read directly as rates.
 */

function recipe(id: string, inputs: [string, number][], outputs: [string, number][]) {
  return {
    id,
    name: id,
    machineType: "Bender",
    minimumTier: "LV",
    durationTicks: 20,
    eut: 30,
    inputs: inputs.map(([itemId, amount]) => ({ kind: "item" as const, id: itemId, amount })),
    outputs: outputs.map(([itemId, amount]) => ({ kind: "item" as const, id: itemId, amount })),
  };
}

function node(id: string, recipeId: string) {
  return {
    id,
    recipeId,
    machineCount: 1,
    parallel: 1,
    overclockTier: "LV",
    enabled: true,
    position: { x: 0, y: 0 },
  };
}

function drawer(
  id: string,
  resourceId: string,
  extra?: Partial<FactoryStorage>,
): FactoryStorage {
  return { id, kind: "item", resourceId, position: { x: 0, y: 0 }, ...extra };
}

function wire(id: string, source: string, target: string, resourceId: string) {
  return { id, source, target, resourceKind: "item" as const, resourceId };
}

function project(over: Partial<FactoryProject>): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "storage-links",
    name: "storage-links",
    recipes: [],
    nodes: [],
    edges: [],
    ...over,
  } as FactoryProject;
}

/**
 * The recycle machine: eats 10 x, returns some of it, ships a product. The
 * return rides a buffer back into the machine's own input; the buffer is the
 * loop's one x node, exactly the "single node for chlorine" the community
 * asked to wire.
 */
function loopBoard(returnedX: number) {
  return {
    recipes: [recipe("recycle", [["x", 10]], [["prod", 10], ["x", returnedX]])],
    nodes: [node("c", "recycle")],
    storages: [drawer("d-prod", "prod"), drawer("buf", "x"), drawer("s-x", "x")],
    edges: [
      wire("e-prod", "c", "d-prod", "prod"),
      wire("e-ret", "c", "buf", "x"),
      wire("e-back", "buf", "c", "x"),
      wire("e-feed", "s-x", "buf", "x"),
    ],
  };
}

describe("a source drawer wired into a buffer", () => {
  it("tops up a deficit loop with exactly the shortfall", () => {
    // 7 of the 10 come back round the loop; the source owes the other 3.
    const result = calculateThroughput(project(loopBoard(7)), { generatedAt: "fixed" });

    expect(result.nodes["c"].utilization).toBeCloseTo(1);
    expect(result.nodes["c"].capableUtilization).toBeCloseTo(1);
    expect(result.nodes["c"].clogOutputKey).toBeUndefined();
    // The buffer passes the full input: 7 recycled plus 3 topped up.
    expect(result.edges["e-back"].transferredPerSecond).toBeCloseTo(10);
    expect(result.edges["e-ret"].transferredPerSecond).toBeCloseTo(7);
    expect(result.edges["e-feed"].transferredPerSecond).toBeCloseTo(3);
    expect(result.storages["buf"].netPerSecond).toBeCloseTo(0);
    // The plan's books call the top-up an import, at its real rate.
    expect(result.resources["item:x"]?.importedPerSecond).toBeCloseTo(3);
  });

  it("idles at 0/s on a net-positive loop instead of forcing its own deletion", () => {
    // 12 come back for every 10 eaten: the loop sustains itself, the spare 2
    // piles up in the buffer, and the source sits wired and unused - the
    // board no one could build before without a dead-loop verdict.
    const result = calculateThroughput(project(loopBoard(12)), { generatedAt: "fixed" });

    expect(result.nodes["c"].utilization).toBeCloseTo(1);
    expect(result.nodes["c"].clogOutputKey).toBeUndefined();
    expect(result.edges["e-back"].transferredPerSecond).toBeCloseTo(10);
    expect(result.edges["e-feed"].transferredPerSecond).toBeCloseTo(0);
    expect(result.storages["buf"].netPerSecond).toBeCloseTo(2);
    expect(result.resources["item:x"]?.importedPerSecond ?? 0).toBeCloseTo(0);
  });

  it("feeds a plain chain: source into tank into machine", () => {
    const result = calculateThroughput(
      project({
        recipes: [recipe("eat", [["z", 4]], [["out", 1]])],
        nodes: [node("eater", "eat")],
        storages: [drawer("s-z", "z"), drawer("tank", "z"), drawer("d-out", "out")],
        edges: [
          wire("e-feed", "s-z", "tank", "z"),
          wire("e-out", "tank", "eater", "z"),
          wire("e-final", "eater", "d-out", "out"),
        ],
      }),
      { generatedAt: "fixed" },
    );

    expect(result.nodes["eater"].utilization).toBeCloseTo(1);
    expect(result.nodes["eater"].capableUtilization).toBeCloseTo(1);
    expect(result.edges["e-feed"].transferredPerSecond).toBeCloseTo(4);
    expect(result.edges["e-out"].transferredPerSecond).toBeCloseTo(4);
    expect(result.storages["tank"].netPerSecond).toBeCloseTo(0);
  });

  it("yields to real supply: machine deliveries move first, the source covers the rest", () => {
    // The tank's taker wants 10; a machine able to make 6 feeds the tank and
    // a source backs it. The machine ships its 6, the source only the 4.
    const result = calculateThroughput(
      project({
        recipes: [recipe("make", [], [["z", 6]]), recipe("eat", [["z", 10]], [["out", 1]])],
        nodes: [node("m", "make"), node("eater", "eat")],
        storages: [drawer("s-z", "z"), drawer("tank", "z"), drawer("d-out", "out")],
        edges: [
          wire("e-make", "m", "tank", "z"),
          wire("e-feed", "s-z", "tank", "z"),
          wire("e-out", "tank", "eater", "z"),
          wire("e-final", "eater", "d-out", "out"),
        ],
      }),
      { generatedAt: "fixed" },
    );

    expect(result.nodes["eater"].utilization).toBeCloseTo(1);
    expect(result.nodes["m"].utilization).toBeCloseTo(1);
    expect(result.edges["e-make"].transferredPerSecond).toBeCloseTo(6);
    expect(result.edges["e-feed"].transferredPerSecond).toBeCloseTo(4);
    expect(result.storages["tank"].netPerSecond).toBeCloseTo(0);
  });
});

describe("a drawer wired into a drain drawer", () => {
  it("exports the stock the buffer's takers leave", () => {
    // The w product drawer pins the machine flat out, so 10 z arrive at the
    // tank whether or not anyone wants them. The eater drinks 4; the product
    // drawer on the tank catches the other 6 as the plan's declared export.
    const result = calculateThroughput(
      project({
        recipes: [
          recipe("dual", [], [["z", 10], ["w", 10]]),
          recipe("eat", [["z", 4]], [["out", 1]]),
        ],
        nodes: [node("m", "dual"), node("eater", "eat")],
        storages: [
          drawer("d-w", "w"),
          drawer("tank", "z"),
          drawer("d-z", "z"),
          drawer("d-out", "out"),
        ],
        edges: [
          wire("e-w", "m", "d-w", "w"),
          wire("e-tank", "m", "tank", "z"),
          wire("e-out", "tank", "eater", "z"),
          wire("e-export", "tank", "d-z", "z"),
          wire("e-final", "eater", "d-out", "out"),
        ],
      }),
      { generatedAt: "fixed" },
    );

    expect(result.nodes["m"].utilization).toBeCloseTo(1);
    expect(result.nodes["m"].clogOutputKey).toBeUndefined();
    expect(result.nodes["eater"].utilization).toBeCloseTo(1);
    expect(result.edges["e-out"].transferredPerSecond).toBeCloseTo(4);
    expect(result.edges["e-export"].transferredPerSecond).toBeCloseTo(6);
    expect(result.storages["tank"].netPerSecond).toBeCloseTo(0);
    expect(result.storages["d-z"].netPerSecond).toBeCloseTo(6);
    // The catch shows on the boundary books as a product of the plan.
    expect(result.resources["item:z"]?.productPerSecond).toBeCloseTo(6);
  });

  it("catches nothing when the feeder is free to pace down", () => {
    // No pin anywhere: the machine only makes what the eater pulls, so there
    // is no stock for the drain to catch. A drain catches; it does not ask.
    const result = calculateThroughput(
      project({
        recipes: [recipe("mono", [], [["z", 10]]), recipe("eat", [["z", 4]], [["out", 1]])],
        nodes: [node("m", "mono"), node("eater", "eat")],
        storages: [drawer("tank", "z"), drawer("d-z", "z"), drawer("d-out", "out")],
        edges: [
          wire("e-tank", "m", "tank", "z"),
          wire("e-out", "tank", "eater", "z"),
          wire("e-export", "tank", "d-z", "z"),
          wire("e-final", "eater", "d-out", "out"),
        ],
      }),
      { generatedAt: "fixed" },
    );

    expect(result.nodes["m"].utilization).toBeCloseTo(0.4);
    expect(result.nodes["eater"].utilization).toBeCloseTo(1);
    expect(result.edges["e-export"].transferredPerSecond).toBeCloseTo(0);
    expect(result.storages["tank"].netPerSecond).toBeCloseTo(0);
  });
});

describe("what a drawer wire must not change", () => {
  it("a loop with no makeup still reads dead", () => {
    // The same deficit loop with the source deleted: capability zero is the
    // genuine dead-loop signature and it must survive the new machinery.
    const base = loopBoard(7);
    const result = calculateThroughput(
      project({
        ...base,
        storages: base.storages.filter((storage) => storage.id !== "s-x"),
        edges: base.edges.filter((edge) => edge.id !== "e-feed"),
      }),
      { generatedAt: "fixed" },
    );

    expect(result.nodes["c"].utilization).toBeCloseTo(0);
    expect(result.nodes["c"].capableUtilization).toBeCloseTo(0);
  });

  it("a source feeding a buffer never drives production", () => {
    // The tank's feeder machine has no other pin and its taker wants 4 of
    // its 10: the source behind the tank must not push it past 40%.
    const result = calculateThroughput(
      project({
        recipes: [recipe("mono", [], [["z", 10]]), recipe("eat", [["z", 4]], [["out", 1]])],
        nodes: [node("m", "mono"), node("eater", "eat")],
        storages: [drawer("s-z", "z"), drawer("tank", "z"), drawer("d-out", "out")],
        edges: [
          wire("e-tank", "m", "tank", "z"),
          wire("e-feed", "s-z", "tank", "z"),
          wire("e-out", "tank", "eater", "z"),
          wire("e-final", "eater", "d-out", "out"),
        ],
      }),
      { generatedAt: "fixed" },
    );

    expect(result.nodes["m"].utilization).toBeCloseTo(0.4);
    expect(result.nodes["eater"].utilization).toBeCloseTo(1);
    expect(result.edges["e-feed"].transferredPerSecond).toBeCloseTo(0);
  });
});

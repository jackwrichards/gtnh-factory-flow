import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject, type FactoryStorage } from "@/lib/model/types";
import { calculateThroughput } from "./throughput";

/**
 * Drain priority and overflow buffers, together the fix for the community
 * "dead loop" collapse (NyrZ and bobmarlinjr reports, 2026-08).
 *
 * The defect was never the loop detector or the geometric extrapolation: the
 * fills split every ask equally per wire and served machine wires first, so a
 * byproduct return-feed could not ship what its machine was going to make
 * anyway. The unshipped surplus read as a clog, the clog killed the machine's
 * demand, and the zero cascaded backwards through nodes that were never on
 * the cycle. `runFill` now drains what EXISTS first (must-ship co-products,
 * then tanks), asks idle-capable supply next, and touches source drawers
 * last; buffers catch overflow instead of relaying a clog.
 *
 * Every recipe here runs one operation per second (20 ticks at 20 t/s, one
 * LV machine), so amounts read directly as rates.
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
    id: "loop-priority",
    name: "loop-priority",
    recipes: [],
    nodes: [],
    edges: [],
    ...over,
  } as FactoryProject;
}

/**
 * The NyrZ board: A and B supply a fluid, C consumes 12/s of it, D (further
 * down the line) returns 8/s of the same fluid as a byproduct. 8/s is more
 * than a third of C's ask, so under equal splitting D could never ship it.
 */
function nyrzBoard() {
  return {
    recipes: [
      recipe("make-a", [], [["nrs", 10]]),
      recipe("make-b", [], [["nrs", 10]]),
      recipe("react", [["nrs", 12]], [["mid", 10]]),
      recipe("refine", [["mid", 10]], [["prod", 10], ["nrs", 8]]),
    ],
    nodes: [node("a", "make-a"), node("b", "make-b"), node("c", "react"), node("d", "refine")],
    storages: [drawer("d-prod", "prod")],
    edges: [
      wire("e-a", "a", "c", "nrs"),
      wire("e-b", "b", "c", "nrs"),
      wire("e-mid", "c", "d", "mid"),
      wire("e-prod", "d", "d-prod", "prod"),
    ],
  };
}

describe("drain priority: loops with makeup run instead of collapsing", () => {
  it("drains a direct byproduct return-feed first; the supply line paces down", () => {
    const base = nyrzBoard();
    const result = calculateThroughput(
      project({ ...base, edges: [...base.edges, wire("e-loop", "d", "c", "nrs")] }),
      { generatedAt: "fixed" },
    );

    expect(result.nodes["c"].utilization).toBeCloseTo(1);
    expect(result.nodes["d"].utilization).toBeCloseTo(1);
    expect(result.nodes["d"].clogOutputKey).toBeUndefined();
    // All 8/s of the return is drunk; A and B cover the missing 4 between them.
    expect(result.edges["e-loop"].transferredPerSecond).toBeCloseTo(8);
    expect(result.nodes["a"].utilization).toBeCloseTo(0.2);
    expect(result.nodes["b"].utilization).toBeCloseTo(0.2);
  });

  it("drains the same return-feed through a buffer; nothing on the board reads 0%", () => {
    const base = nyrzBoard();
    const result = calculateThroughput(
      project({
        ...base,
        storages: [...base.storages, drawer("pocket", "nrs")],
        edges: [
          ...base.edges,
          wire("e-loop-in", "d", "pocket", "nrs"),
          wire("e-loop-out", "pocket", "c", "nrs"),
        ],
      }),
      { generatedAt: "fixed" },
    );

    expect(result.nodes["c"].utilization).toBeCloseTo(1);
    expect(result.nodes["d"].utilization).toBeCloseTo(1);
    expect(result.nodes["a"].utilization).toBeCloseTo(0.2);
    expect(result.nodes["b"].utilization).toBeCloseTo(0.2);
    // The tank is a pass-through here: 8/s in, 8/s out, holding steady.
    expect(result.edges["e-loop-in"].transferredPerSecond).toBeCloseTo(8);
    expect(result.edges["e-loop-out"].transferredPerSecond).toBeCloseTo(8);
    expect(result.storages["pocket"].netPerSecond).toBeCloseTo(0);
  });

  it("supplements a deficit loop from a source drawer (buffer and source share one input)", () => {
    // Catalyst-style: the machine returns 7 of the 10 x it eats, the return
    // rides a tank back into its own input, a source drawer makes up the 3.
    const result = calculateThroughput(
      project({
        recipes: [recipe("recycle", [["x", 10]], [["prod", 10], ["x", 7]])],
        nodes: [node("c", "recycle")],
        storages: [drawer("d-prod", "prod"), drawer("buf", "x"), drawer("s-x", "x")],
        edges: [
          wire("e-prod", "c", "d-prod", "prod"),
          wire("e-ret", "c", "buf", "x"),
          wire("e-back", "buf", "c", "x"),
          wire("e-src", "s-x", "c", "x"),
        ],
      }),
      { generatedAt: "fixed" },
    );

    expect(result.nodes["c"].utilization).toBeCloseTo(1);
    expect(result.nodes["c"].clogOutputKey).toBeUndefined();
    expect(result.edges["e-back"].transferredPerSecond).toBeCloseTo(7);
    expect(result.edges["e-src"].transferredPerSecond).toBeCloseTo(3);
  });

  it("still reads a loop with no makeup as dead: capability starves to zero", () => {
    const result = calculateThroughput(
      project({
        recipes: [recipe("recycle", [["x", 10]], [["prod", 10], ["x", 7]])],
        nodes: [node("c", "recycle")],
        storages: [drawer("d-prod", "prod"), drawer("buf", "x")],
        edges: [
          wire("e-prod", "c", "d-prod", "prod"),
          wire("e-ret", "c", "buf", "x"),
          wire("e-back", "buf", "c", "x"),
        ],
      }),
      { generatedAt: "fixed" },
    );

    // A lossy loop with nothing topping it up is the REAL dead loop, and its
    // signature is capability zero - which is what the badge keys on.
    expect(result.nodes["c"].utilization).toBeCloseTo(0);
    expect(result.nodes["c"].capableUtilization).toBeCloseTo(0);
  });

  it("does not unclog a genuine surplus with no home (the cobblestone rule)", () => {
    // 10 redstone + 5 gold, takers want 5 of each, nothing catches the spare
    // redstone. The gold coupling wants 100%; the spare 5 redstone has nowhere
    // to go, so disposal still pins the machine at 50%.
    const result = calculateThroughput(
      project({
        recipes: [
          recipe("dual", [], [["redstone", 10], ["gold", 5]]),
          recipe("eat-redstone", [["redstone", 5]], [["rsblock", 1]]),
          recipe("eat-gold", [["gold", 5]], [["goldblock", 1]]),
        ],
        nodes: [node("dual", "dual"), node("rs", "eat-redstone"), node("au", "eat-gold")],
        storages: [drawer("d-rs", "rsblock"), drawer("d-au", "goldblock")],
        edges: [
          wire("r1", "dual", "rs", "redstone"),
          wire("g1", "dual", "au", "gold"),
          wire("d1", "rs", "d-rs", "rsblock"),
          wire("d2", "au", "d-au", "goldblock"),
        ],
      }),
      { generatedAt: "fixed" },
    );

    expect(result.nodes["dual"].utilization).toBeCloseTo(0.5);
    expect(result.nodes["dual"].clogOutputKey).toBe("item:redstone");
  });
});

describe("overflow buffers: a tank catches surplus and never invents supply", () => {
  const OVERFLOW_BOARD = {
    recipes: [
      recipe("dual", [], [["z", 10], ["w", 10]]),
      recipe("eat", [["z", 4]], [["out", 1]]),
    ],
    nodes: [node("m", "dual"), node("eater", "eat")],
    edges: [
      wire("e-w", "m", "d-w", "w"),
      wire("e-tank", "m", "tank", "z"),
      wire("e-out", "tank", "eater", "z"),
      wire("e-final", "eater", "d-out", "out"),
    ],
  };

  it("fills at a visible rate when the feeder runs anyway", () => {
    // The product drawer on w pins the machine at 100%; the eater only wants
    // 4 of the 10 z. The tank catches the spare 6 and shows it filling.
    const result = calculateThroughput(
      project({
        ...OVERFLOW_BOARD,
        storages: [drawer("d-w", "w"), drawer("tank", "z"), drawer("d-out", "out")],
      }),
      { generatedAt: "fixed" },
    );

    expect(result.nodes["m"].utilization).toBeCloseTo(1);
    expect(result.nodes["m"].clogOutputKey).toBeUndefined();
    expect(result.nodes["eater"].utilization).toBeCloseTo(1);
    expect(result.storages["tank"].netPerSecond).toBeCloseTo(6);
  });

  it("never drives production: with nothing else pinning it, the feeder paces to its takers", () => {
    // Same board minus the w drawer wire: m's only outlet that asks is the
    // tank's taker, so m slows to 40% and the tank holds level. A buffer is
    // not a product drawer.
    const result = calculateThroughput(
      project({
        recipes: [recipe("mono", [], [["z", 10]]), recipe("eat", [["z", 4]], [["out", 1]])],
        nodes: [node("m", "mono"), node("eater", "eat")],
        storages: [drawer("tank", "z"), drawer("d-out", "out")],
        edges: [
          wire("e-tank", "m", "tank", "z"),
          wire("e-out", "tank", "eater", "z"),
          wire("e-final", "eater", "d-out", "out"),
        ],
      }),
      { generatedAt: "fixed" },
    );

    expect(result.nodes["m"].utilization).toBeCloseTo(0.4);
    expect(result.nodes["eater"].utilization).toBeCloseTo(1);
    expect(result.storages["tank"].netPerSecond).toBeCloseTo(0);
  });

  it("strict mode opts back into the clog: the surplus is handed back, not stored", () => {
    const result = calculateThroughput(
      project({
        ...OVERFLOW_BOARD,
        storages: [
          drawer("d-w", "w"),
          drawer("tank", "z", { bufferMode: "strict" }),
          drawer("d-out", "out"),
        ],
      }),
      { generatedAt: "fixed" },
    );

    expect(result.nodes["m"].utilization).toBeCloseTo(0.4);
    expect(result.nodes["m"].clogOutputKey).toBe("item:z");
    expect(result.storages["tank"].netPerSecond).toBeCloseTo(0);
  });
});

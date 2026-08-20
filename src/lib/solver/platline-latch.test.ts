import { describe, expect, it } from "vitest";
import {
  PROJECT_SCHEMA_VERSION,
  type FactoryProject,
  type FactoryStorage,
} from "@/lib/model/types";
import { calculateThroughput } from "./throughput";

/**
 * The self-justifying clog (platline report, 2026-08-11): a board whose
 * recycle loops all conserve mass (loop gain exactly 1.0) has a continuum of
 * self-consistent answers, and the solver is supposed to land on the highest
 * one - the level its one real constraint (here an ammonia reactor fed from
 * source drawers) allows.
 *
 * It landed at exactly 90% of it instead. During the descent, the chemical
 * reactor's chlorine ask was split evenly between the electrolyzer and a
 * blast furnace whose own starvation signal was still two rounds away, so
 * for one round the electrolyzer was asked for only 90% of its true share -
 * and a source drawer on the same input soaked up the remainder of the ask,
 * so the shortfall never came back as demand. The disposal ceiling latched
 * the dip, the dip circulated the electrolyzer's calcium loop, and the whole
 * plan settled 10% low. Wiring a product drawer to the electrolyzer's
 * chlorine (which then carries 0/s forever) removed that output from clog
 * bookkeeping and "fixed" the plan, which is how the bug was noticed.
 *
 * The cure is the shadow fill in equilibrium.ts: disposal is justified by
 * what takers would take if nothing were clogged, so a clog can never hold
 * itself in place. These tests pin both wirings to the true ceiling.
 *
 * Every recipe here runs one op per second (20 ticks, LV, no overclock), and
 * amounts are the exact nameplate per-second rates from the player's board,
 * so utilizations land on the same numbers the live plan showed.
 */

function recipe(id: string, inputs: [string, number][], outputs: [string, number][]) {
  return {
    id,
    name: id,
    machineType: "LCR",
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

function drawer(id: string, resourceId: string, extra?: Partial<FactoryStorage>): FactoryStorage {
  return { id, kind: "item", resourceId, position: { x: 0, y: 0 }, ...extra };
}

function wire(id: string, source: string, target: string, resourceId: string) {
  return { id, source, target, resourceKind: "item" as const, resourceId };
}

function project(over: Partial<FactoryProject>): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "platline-latch",
    name: "platline-latch",
    recipes: [],
    nodes: [],
    edges: [],
    ...over,
  } as FactoryProject;
}

function platline() {
  const recipes = [
    // m1 nitric acid
    recipe("r1", [["no2", 2000], ["o2", 1000], ["water", 1000]], [["nitric", 2000]]),
    // m2 aqua regia mixer (cells ride the loop)
    recipe(
      "r2",
      [["hclcell", 60 / 7], ["nitric", 20000 / 7]],
      [["cell", 60 / 7], ["aqua", 80000 / 7]],
    ),
    // m3 canner
    recipe("r3", [["cell", 5], ["hcl", 5000]], [["hclcell", 5]]),
    // m4 platinum residue / concentrate
    recipe(
      "r4",
      [["powder", 9 / 7], ["aqua", 18000 / 7]],
      [["residue", 1 / 7], ["conc", 18000 / 7]],
    ),
    // m5 platinum dust (the plan's product)
    recipe("r5", [["reprec", 80], ["ca", 20]], [["pt", 40], ["cacl2", 60]]),
    // m6 platinum salt, five outputs, heart of every loop
    recipe(
      "r6",
      [["conc", 7200 / 7], ["amcl", 720 / 7]],
      [
        ["salt", 16 / 35],
        ["reprec", 4 / 35],
        ["pdnh3", 720 / 7],
        ["no2", 1800 / 7],
        ["hcl", 5400 / 7],
      ],
    ),
    // m7 sifter
    recipe("r7", [["salt", 10]], [["refined", 9.5]]),
    // m8 electrolyzer: the latch site (chlorine + calcium loop with m5)
    recipe("r8", [["cacl2", 60 / 27]], [["ca", 20 / 27], ["cl", 40000 / 27]]),
    // m9 ammonium chloride
    recipe("r9", [["hcl", 64000 / 3], ["nh3", 64000 / 3]], [["amcl", 64000 / 3]]),
    // m10 ammonia: the plan's ONE real bottleneck (sources both sides)
    recipe("r10", [["n2", 62.5], ["h2", 187.5]], [["nh3", 62.5]]),
    // m11 blast furnace: the competing chlorine supplier whose starvation
    // signal arrives two rounds late - the trigger of the transient dip
    recipe("r11", [["refined", 0.4]], [["powder", 0.4], ["cl", 34.8]]),
    // m12 hydrochloric acid: the shared chlorine consumer
    recipe("r12", [["h2", 64000 / 3], ["cl", 64000 / 3]], [["hcl", 64000 / 3]]),
  ];
  const nodes = [
    node("m1", "r1"),
    node("m2", "r2"),
    node("m3", "r3"),
    node("m4", "r4"),
    node("m5", "r5"),
    node("m6", "r6"),
    node("m7", "r7"),
    node("m8", "r8"),
    node("m9", "r9"),
    node("m10", "r10"),
    node("m11", "r11"),
    node("m12", "r12"),
  ];
  const storages = [
    drawer("dO2", "o2"),
    drawer("dH2O", "water"),
    drawer("dRes", "residue", { drainMode: "byproduct" }),
    drawer("dPt", "pt"),
    drawer("dPd", "pdnh3", { drainMode: "byproduct" }),
    drawer("dPow", "powder"),
    drawer("dN2", "n2"),
    drawer("dH2", "h2"),
    drawer("dCl", "cl"),
  ];
  const edges = [
    wire("e01", "dH2O", "m1", "water"),
    wire("e02", "dO2", "m1", "o2"),
    wire("e03", "m6", "dPd", "pdnh3"),
    wire("e04", "m5", "m8", "cacl2"),
    wire("e05", "m5", "dPt", "pt"),
    wire("e06", "m6", "m5", "reprec"),
    wire("e07", "m6", "m7", "salt"),
    wire("e08", "m7", "m11", "refined"),
    wire("e09", "m2", "m3", "cell"),
    wire("e10", "m3", "m2", "hclcell"),
    wire("e11", "m1", "m2", "nitric"),
    wire("e12", "m4", "m6", "conc"),
    wire("e13", "m4", "dRes", "residue"),
    wire("e14", "m9", "m6", "amcl"),
    wire("e15", "m12", "m9", "hcl"),
    wire("e16", "dN2", "m10", "n2"),
    wire("e17", "dH2", "m10", "h2"),
    wire("e18", "dH2", "m12", "h2"),
    wire("e19", "m6", "m1", "no2"),
    wire("e20", "m6", "m3", "hcl"),
    wire("e21", "m10", "m9", "nh3"),
    wire("e22", "m2", "m4", "aqua"),
    wire("e23", "m8", "m5", "ca"),
    wire("e24", "m11", "m12", "cl"),
    wire("e25", "m8", "m12", "cl"),
    wire("e26", "dCl", "m12", "cl"),
    wire("e27", "m11", "m4", "powder"),
    wire("e28", "dPow", "m4", "powder"),
  ];
  return { recipes, nodes, storages, edges };
}

/** The ammonia ceiling: 62.5/s of ammonia through m9 covers 60.76% of m6. */
const CEILING_M6 = 0.607639;

describe("the platline latch: a transient allocation dip must not become the answer", () => {
  it("lands on the ammonia ceiling, not 90% of it", () => {
    const result = calculateThroughput(project(platline()), { generatedAt: "fixed" });

    // The one true bottleneck runs flat out; the heart of the loops runs at
    // exactly what the ammonia allows. Before the shadow fill these read
    // 90.00% and 54.69% - and every card on the board scaled down with them.
    expect(result.nodes["m10"].utilization).toBeCloseTo(1, 5);
    expect(result.nodes["m6"].utilization).toBeCloseTo(CEILING_M6, 5);
    // Nothing here is clogged: every output is fully drunk at these rates.
    expect(result.nodes["m6"].clogOutputKey).toBeUndefined();
    // The product: m6 at the ceiling sheds (4/35) * 0.6076 = 0.06944/s of
    // reprecipitated dust, m5 turns 80/s-in into 40/s-out, so platinum flows
    // at 0.03472/s - not the stranded 0.03125/s.
    const reprecPerSecond = (4 / 35) * CEILING_M6;
    expect(result.edges["e05"].transferredPerSecond).toBeCloseTo((reprecPerSecond / 80) * 40, 4);
  });

  it("an idle product drawer on the electrolyzer's chlorine changes nothing", () => {
    // The player's accidental workaround: wiring a drawer to m8's chlorine
    // lifted the whole plan by 10%, which is how the latch was found. Now
    // both wirings must agree card for card.
    const base = platline();
    const bare = calculateThroughput(project(base), { generatedAt: "fixed" });
    const drawered = calculateThroughput(
      project({
        ...base,
        storages: [...base.storages, drawer("dClOut", "cl")],
        edges: [...base.edges, wire("e29", "m8", "dClOut", "cl")],
      }),
      { generatedAt: "fixed" },
    );

    for (const id of Object.keys(bare.nodes)) {
      expect(drawered.nodes[id].utilization).toBeCloseTo(bare.nodes[id].utilization, 5);
    }
    // And the drawer itself sits empty: the reactor drinks all the chlorine.
    expect(drawered.edges["e29"].transferredPerSecond).toBeCloseTo(0, 6);
  });
});

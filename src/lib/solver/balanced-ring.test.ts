import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PROJECT_SCHEMA_VERSION,
  type FactoryProject,
  type FactoryStorage,
  type Recipe,
} from "@/lib/model/types";
import { calculateThroughput } from "./throughput";

/**
 * The balanced-ring rescue (player report, 2026-08-12): a ring that conserves
 * its circulating goods EXACTLY has a continuum of self-consistent levels,
 * and the descent's transients used to ratchet it down that continuum to an
 * all-zero dead-loop verdict - even though the same ring, primed once in
 * game, runs forever.
 *
 * The board is the GT phosphoric-acid cell loop, real recipes from the
 * published local-2.9.0-beta-2 dataset: the electrolyzer eats 1 acid cell +
 * 6 empty cells and hands all 7 back through three canners (3 hydrogen, 4
 * oxygen, 1 refilled with acid), water is the only true input, hydrogen and
 * surplus oxygen drain out. Wiring an empty-cell SOURCE into the cell buffer
 * was the player's accidental workaround (case A) - it held the board up
 * while carrying 0/s forever, which is exactly the fixed point the rescue
 * now finds on its own. All four wirings must settle on the SAME numbers:
 * electrolyzer 100%, canners at 17.78% / 23.70% / 5.93%, reactors at 3.70% /
 * 1.85%.
 */

const recipes = JSON.parse(
  readFileSync(new URL("./__fixtures__/pa-cell-loop-recipes.json", import.meta.url), "utf8"),
) as Recipe[];

const byHash = new Map(recipes.map((r) => [r.id.split(":").pop()!, r]));
const rid = (hash: string) => byHash.get(hash)!.id;

function node(id: string, hash: string, tier: string, count = 1) {
  return {
    id,
    recipeId: rid(hash),
    machineCount: count,
    parallel: 1,
    overclockTier: tier,
    enabled: true,
    position: { x: 0, y: 0 },
  };
}

function drawer(
  id: string,
  kind: "item" | "fluid",
  resourceId: string,
  extra?: Partial<FactoryStorage>,
): FactoryStorage {
  return { id, kind, resourceId, position: { x: 0, y: 0 }, ...extra };
}

let edgeSeq = 0;
function wire(source: string, target: string, kind: "item" | "fluid", resourceId: string) {
  edgeSeq += 1;
  return { id: `e${edgeSeq}`, source, target, resourceKind: kind, resourceId };
}

const EMPTY = "ic2:itemcellempty";
const H_CELL = "gregtech:gt.metaitem.01@30001";
const O_CELL = "gregtech:gt.metaitem.01@30013";
const PA_CELL = "gregtech:gt.metaitem.01@30689";
const P2O5 = "gregtech:gt.metaitem.01@2665";
const P_DUST = "gregtech:gt.metaitem.01@2021";

function buildProject(withCellSource: boolean): FactoryProject {
  const nodes = [
    node("m1", "e09953ecba003d8b", "ULV"), // Canner: PA cell
    node("m2", "35b410e28a37e4d0", "LV"), // CR: phosphoric acid
    node("m3", "372d15dcd0a6cae3", "HV"), // Electrolyzer
    node("m4", "a8e66697a5cc1d7e", "ULV"), // Canner: empty (hydrogen)
    node("m5", "ec65e3fc64e6c1e8", "MV"), // CR: P2O5
    node("m6", "03ddcf43b6c6e15c", "ULV"), // Canner: empty (oxygen)
  ];
  const storages = [
    drawer("d_water", "fluid", "water"),
    drawer("d_cells", "item", EMPTY),
    drawer("d_h2", "fluid", "hydrogen"),
    drawer("d_o2", "fluid", "oxygen", { drainMode: "product" }),
    ...(withCellSource ? [drawer("d_cells_src", "item", EMPTY)] : []),
  ];
  const edges = [
    wire("m2", "m1", "fluid", "phosphoricacid_gt5u"),
    wire("d_water", "m2", "fluid", "water"),
    wire("m1", "m3", "item", PA_CELL),
    wire("m3", "m4", "item", H_CELL),
    wire("m4", "d_h2", "fluid", "hydrogen"),
    wire("m3", "m5", "item", P_DUST),
    wire("m3", "m6", "item", O_CELL),
    wire("m6", "m5", "fluid", "oxygen"),
    wire("m6", "d_cells", "item", EMPTY),
    wire("m4", "d_cells", "item", EMPTY),
    wire("m5", "m2", "item", P2O5),
    wire("m6", "d_o2", "fluid", "oxygen"),
    wire("d_cells", "m3", "item", EMPTY),
    wire("d_cells", "m1", "item", EMPTY),
    ...(withCellSource ? [wire("d_cells_src", "d_cells", "item", EMPTY)] : []),
  ];
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "deadloop-repro",
    name: "deadloop-repro",
    recipes,
    nodes,
    storages,
    edges,
  } as FactoryProject;
}

/** The one true answer, whatever the wiring: see the header note. */
function expectLoopRunning(result: ReturnType<typeof calculateThroughput>) {
  expect(result.nodes.m3.utilization).toBeCloseTo(1, 3);
  expect(result.nodes.m1.utilization).toBeCloseTo(0.0593, 3);
  expect(result.nodes.m2.utilization).toBeCloseTo(0.037, 3);
  expect(result.nodes.m4.utilization).toBeCloseTo(0.1778, 3);
  expect(result.nodes.m5.utilization).toBeCloseTo(0.0185, 3);
  expect(result.nodes.m6.utilization).toBeCloseTo(0.237, 3);
  // Capabilities stay HONEST: the rescue's anchor must not inflate them (a
  // canner paced by cell arrival really is paced by cell arrival).
  expect(result.nodes.m4.capableUtilization).toBeCloseTo(0.1778, 3);
  expect(result.nodes.m6.capableUtilization).toBeCloseTo(0.237, 3);
}

function simpleRecipe(
  id: string,
  inputs: Array<{ kind: "item" | "fluid"; id: string; amount: number }>,
  outputs: Array<{ kind: "item" | "fluid"; id: string; amount: number }>,
): Recipe {
  return {
    id,
    name: id,
    machineType: "Bender",
    minimumTier: "LV",
    durationTicks: 20,
    eut: 30,
    inputs,
    outputs,
  } as Recipe;
}

describe("minimal balanced ring", () => {
  it("two machines passing one cell round, only external input is fluid", () => {
    const projectB: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "min-ring",
      name: "min-ring",
      recipes: [
        simpleRecipe(
          "r_fill",
          [
            { kind: "item", id: "cell", amount: 1 },
            { kind: "fluid", id: "juice", amount: 1000 },
          ],
          [{ kind: "item", id: "fullcell", amount: 1 }],
        ),
        simpleRecipe(
          "r_empty",
          [{ kind: "item", id: "fullcell", amount: 1 }],
          [
            { kind: "item", id: "cell", amount: 1 },
            { kind: "item", id: "product", amount: 1 },
          ],
        ),
      ],
      nodes: [
        {
          id: "fill",
          recipeId: "r_fill",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 0, y: 0 },
        },
        {
          id: "empty",
          recipeId: "r_empty",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      storages: [
        drawer("d_juice", "fluid", "juice"),
        drawer("d_prod", "item", "product"),
      ],
      edges: [
        wire("d_juice", "fill", "fluid", "juice"),
        wire("fill", "empty", "item", "fullcell"),
        wire("empty", "fill", "item", "cell"),
        wire("empty", "d_prod", "item", "product"),
      ],
    } as FactoryProject;
    const result = calculateThroughput(projectB);
    expect(result.nodes.fill.utilization).toBeCloseTo(1, 3);
    expect(result.nodes.empty.utilization).toBeCloseTo(1, 3);
  });
});

describe("phosphoric acid cell loop", () => {
  it("runs with the player's workaround: a 0/s cell source wired into the buffer", () => {
    expectLoopRunning(calculateThroughput(buildProject(true)));
  });

  it("runs without the source: the rescue holds the ring at the same numbers", () => {
    expectLoopRunning(calculateThroughput(buildProject(false)));
  });

  it("runs with the cells wired machine to machine, no buffer at all", () => {
    const base = buildProject(false);
    const project: FactoryProject = {
      ...base,
      storages: (base.storages ?? []).filter((s) => s.id !== "d_cells"),
      edges: [
        ...base.edges.filter((e) => e.source !== "d_cells" && e.target !== "d_cells"),
        wire("m4", "m3", "item", EMPTY),
        wire("m4", "m1", "item", EMPTY),
        wire("m6", "m3", "item", EMPTY),
        wire("m6", "m1", "item", EMPTY),
      ],
    };
    expectLoopRunning(calculateThroughput(project));
  });

  it("with three electrolyzers the ring climbs to their ceiling and conserves cells", () => {
    // The 2026-08-12 follow-up board: same loop, electrolyzer count raised to
    // 3, oxygen surplus caught by a BYPRODUCT drawer. Two bugs met here: the
    // rescue's settled anchor slipped a standing 0.25/s of hydrogen cells
    // past a ring-total validation gate (fluids at hundreds of L/s drowned
    // the item-scale leak), so the plan invented cells - a buffer filling
    // forever on a loop that conserves them exactly - and the ring sat at
    // 62.5% behind a clog latch relayed through the cell buffer (M3 clogged
    // on oxygen cells because M5 idled, M5 idling because the buffer's pull
    // was depressed by M3's clog).
    const plan = JSON.parse(
      readFileSync(new URL("./__fixtures__/pa-cell-loop-plan-3x.json", import.meta.url), "utf8"),
    ) as FactoryProject;
    const result = calculateThroughput(plan);
    const byRecipe = new Map(
      plan.nodes.map((node) => {
        const recipe = plan.recipes.find((entry) => entry.id === node.recipeId);
        return [recipe!.id.split(":").pop()!, node.id] as const;
      }),
    );
    const util = (hash: string) => result.nodes[byRecipe.get(hash)!]!.utilization;
    expect(util("372d15dcd0a6cae3")).toBeCloseTo(1, 3); // electrolyzers flat out
    expect(util("a8e66697a5cc1d7e")).toBeCloseTo(0.5333, 3); // H canner 0.6667/1.25
    expect(util("03ddcf43b6c6e15c")).toBeCloseTo(0.7111, 3); // O canner 0.8889/1.25
    expect(util("e09953ecba003d8b")).toBeCloseTo(0.1778, 3); // acid canner
    expect(util("35b410e28a37e4d0")).toBeCloseTo(0.1111, 3); // acid reactor
    expect(util("ec65e3fc64e6c1e8")).toBeCloseTo(0.0556, 3); // P2O5 reactor

    // Cells are conserved: the loop cannot make empty cells from nothing, so
    // the buffer holds level instead of filling forever.
    const buffer = plan.storages!.find((s) => s.resourceId === "ic2:itemcellempty")!;
    expect(result.storages[buffer.id]!.netPerSecond).toBeCloseTo(0, 3);
  });

  it("a STRICT buffer changes nothing when the loop is exactly balanced", () => {
    // Same three-electrolyzer board with the cell buffer set strict. The
    // loop's cells pass through at net zero, so strict-vs-overflow must not
    // matter: strict only bites when there is a genuine surplus to decline.
    // (It used to read DEAD LOOP: the strict absorb rule split the pull
    // evenly per feeder, the bigger canner's declined share read as a clog,
    // and the ring collapsed.)
    const plan = JSON.parse(
      readFileSync(
        new URL("./__fixtures__/pa-cell-loop-plan-3x-strict.json", import.meta.url),
        "utf8",
      ),
    ) as FactoryProject;
    const result = calculateThroughput(plan);
    const byRecipe = new Map(
      plan.nodes.map((node) => {
        const recipe = plan.recipes.find((entry) => entry.id === node.recipeId);
        return [recipe!.id.split(":").pop()!, node.id] as const;
      }),
    );
    const util = (hash: string) => result.nodes[byRecipe.get(hash)!]!.utilization;
    expect(util("372d15dcd0a6cae3")).toBeCloseTo(1, 3); // electrolyzers flat out
    expect(util("a8e66697a5cc1d7e")).toBeCloseTo(0.5333, 3); // H canner
    expect(util("03ddcf43b6c6e15c")).toBeCloseTo(0.7111, 3); // O canner
    const buffer = plan.storages!.find((s) => s.resourceId === "ic2:itemcellempty")!;
    expect(result.storages[buffer.id]!.netPerSecond).toBeCloseTo(0, 3);
  });

  it("one electrolyzer and a strict buffer: the rescue fires on dust, not only on zero", () => {
    // The board that survived every earlier fix: with ONE electrolyzer the
    // descent converges at a microscopic dust level (~2e-5 of full speed)
    // instead of ratcheting to the snap threshold, and the rescue's
    // detection - gated on ZERO_SNAP - never fired while the badge - gated
    // on 1e-4 - called the ring dead. Detection now shares the badge's
    // threshold (DEAD_RING_EPSILON), so a ring the badge condemns always
    // gets its appeal.
    const plan = JSON.parse(
      readFileSync(
        new URL("./__fixtures__/pa-cell-loop-plan-1x-strict.json", import.meta.url),
        "utf8",
      ),
    ) as FactoryProject;
    const result = calculateThroughput(plan);
    const byRecipe = new Map(
      plan.nodes.map((node) => {
        const recipe = plan.recipes.find((entry) => entry.id === node.recipeId);
        return [recipe!.id.split(":").pop()!, node.id] as const;
      }),
    );
    const util = (hash: string) => result.nodes[byRecipe.get(hash)!]!.utilization;
    expect(util("372d15dcd0a6cae3")).toBeCloseTo(1, 3); // the one electrolyzer
    expect(util("a8e66697a5cc1d7e")).toBeCloseTo(0.1778, 3); // H canner
    expect(util("03ddcf43b6c6e15c")).toBeCloseTo(0.237, 3); // O canner
    expect(util("e09953ecba003d8b")).toBeCloseTo(0.0593, 3); // acid canner
    const buffer = plan.storages!.find((s) => s.resourceId === "ic2:itemcellempty")!;
    expect(result.storages[buffer.id]!.netPerSecond).toBeCloseTo(0, 3);
  });

  it("runs when the player's exported plan is loaded verbatim", () => {
    const plan = JSON.parse(
      readFileSync(new URL("./__fixtures__/pa-cell-loop-plan.json", import.meta.url), "utf8"),
    ) as FactoryProject;
    const result = calculateThroughput(plan);
    const byRecipe = new Map(
      plan.nodes.map((node) => {
        const recipe = plan.recipes.find((entry) => entry.id === node.recipeId);
        return [recipe!.id.split(":").pop()!, result.nodes[node.id]!.utilization] as const;
      }),
    );
    expect(byRecipe.get("372d15dcd0a6cae3")).toBeCloseTo(1, 3); // electrolyzer
    expect(byRecipe.get("a8e66697a5cc1d7e")).toBeCloseTo(0.1778, 3); // H canner
    expect(byRecipe.get("03ddcf43b6c6e15c")).toBeCloseTo(0.237, 3); // O canner
    expect(byRecipe.get("e09953ecba003d8b")).toBeCloseTo(0.0593, 3); // acid canner
  });
});

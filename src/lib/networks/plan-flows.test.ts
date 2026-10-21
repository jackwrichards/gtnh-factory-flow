import { describe, expect, it } from "vitest";
import { calculateThroughput } from "@/lib/solver";
import { drawer, node, project, recipe, wire } from "@/lib/solver/plan/adapter/test-kit";
import { planFlows } from "./plan-flows";
import { selectedMaterials } from "./model";
import { normalizeLoadedProject } from "@/lib/model/project-normalize";

describe("solved plan boundaries", () => {
  it("keeps cell and fluid transfers internal after upstream converts an old wire to a tank", () => {
    const cell = "gregtech:gt.metaitem.01@30001";
    const make = recipe("fill", [], [[cell, 2]], "Bender");
    const use = recipe("drink", [], [["sponge", 1]], "Bender");
    use.inputs = [{ kind: "fluid", id: "water", amount: 1000 }];
    const stored = project({
      recipes: [make, use],
      nodes: [node("maker", "fill", { solvePin: 1 }), node("taker", "drink")],
      storages: [drawer("out", "sponge")],
      edges: [
        {
          id: "old-cell-wire",
          source: "maker",
          target: "taker",
          sourceHandle: `output:item:${encodeURIComponent(cell)}`,
          targetHandle: "input:fluid:water",
          resourceKind: "item",
          resourceId: cell,
          crossForm: { litresPerCell: 1000 },
        },
        wire("out", "taker", "out", "sponge", {}, { toDrawer: true }),
      ],
    });
    const migrated = normalizeLoadedProject(stored);
    expect(migrated.nodes).toHaveLength(3);
    expect(stored.nodes).toHaveLength(2);
    expect(migrated.edges.some((edge) => edge.crossForm)).toBe(false);
    const flows = planFlows(migrated, calculateThroughput(migrated));
    expect(flows.error).toBeUndefined();
    expect(flows.materials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceId: "sponge", supply: 2, demand: 0 }),
        expect.objectContaining({ resourceId: "ic2:itemcellempty", supply: 2, demand: 0 }),
      ]),
    );
    expect(
      flows.materials.some((row) => row.resourceId === cell || row.resourceId === "water"),
    ).toBe(false);
    expect(
      selectedMaterials(
        flows,
        flows.ports!.map((port) => port.portKey),
      ),
    ).toEqual(expect.arrayContaining(flows.materials.map((row) => expect.objectContaining(row))));
    const reopened = normalizeLoadedProject(migrated);
    expect(planFlows(reopened, calculateThroughput(reopened)).materials).toEqual(flows.materials);
  });
  it("keeps recipe artwork with closed-plan flows and machine ports", () => {
    const make = recipe("make", [], [["product", 1]]);
    make.outputs[0].iconPath = "/icons/product.png";
    const input = project({
      recipes: [make],
      nodes: [node("a", "make", { solvePin: 1, solvePinExact: true })],
    });
    const result = planFlows(input, calculateThroughput(input));
    expect(result.materials[0].iconPath).toBe("/icons/product.png");
    expect(result.ports![0].iconPath).toBe("/icons/product.png");
  });
  it("keeps the same imports and exports when boundary drawers are removed", () => {
    const withDrawers = project({
      recipes: [recipe("make", [["ore", 2]], [["product", 1]])],
      nodes: [node("a", "make", { solvePin: 1, solvePinExact: true })],
      storages: [
        drawer("in", "ore"),
        drawer("out", "product", { targetPerSecond: 1, targetMode: "exact" }),
      ],
      edges: [
        wire("in", "in", "a", "ore", {}, { fromDrawer: true }),
        wire("out", "a", "out", "product", {}, { toDrawer: true }),
      ],
    });
    const withoutDrawers = { ...withDrawers, storages: [], edges: [] };
    const expected = planFlows(withDrawers, calculateThroughput(withDrawers));
    const actual = planFlows(withoutDrawers, calculateThroughput(withoutDrawers));
    expect(actual.error).toBeUndefined();
    expect(actual.materials).toEqual(expected.materials);
    const selected = expected
      .ports!.filter((port) => port.side === "out")
      .map((port) => port.portKey);
    expect(selectedMaterials(actual, selected)).toEqual(selectedMaterials(expected, selected));
    expect(selectedMaterials(actual, selected)).toEqual([
      expect.objectContaining({ resourceId: "product", supply: 1, demand: 0 }),
    ]);
    expect(selectedMaterials(actual, [])).toEqual([]);
    expect(actual.materials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceId: "ore", demand: 2, supply: 0 }),
        expect.objectContaining({ resourceId: "product", demand: 0, supply: 1 }),
      ]),
    );
  });

  it("preserves separate open-port imports and exports of the same resource", () => {
    const input = project({
      recipes: [
        recipe("make", [], [["oxygen", 3]]),
        recipe("use", [["oxygen", 2]], [["water", 1]]),
      ],
      nodes: [
        node("maker", "make", { solvePin: 1, solvePinExact: true }),
        node("user", "use", { solvePin: 1, solvePinExact: true }),
      ],
    });
    const result = planFlows(input, calculateThroughput(input));
    expect(result.error).toBeUndefined();
    expect(result.materials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceId: "oxygen", supply: 3, demand: 2 }),
      ]),
    );
  });

  it("counts collected production and external demand without counting internal machine flow", () => {
    const input = project({
      recipes: [
        recipe("make", [["ore", 2]], [["intermediate", 1]]),
        recipe("finish", [["intermediate", 1]], [["product", 1]]),
      ],
      nodes: [node("a", "make", { solvePin: 1, solvePinExact: true }), node("b", "finish")],
      storages: [
        drawer("in", "ore"),
        drawer("out", "product", { targetPerSecond: 1, targetMode: "exact" }),
      ],
      edges: [
        wire("in", "in", "a", "ore", {}, { fromDrawer: true }),
        wire("middle", "a", "b", "intermediate"),
        wire("out", "b", "out", "product", {}, { toDrawer: true }),
      ],
    });
    const result = planFlows(input, calculateThroughput(input));
    expect(result.error).toBeUndefined();
    expect(result.materials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "item:ore", supply: 0, demand: 2 }),
        expect.objectContaining({ key: "item:product", supply: 1, demand: 0 }),
      ]),
    );
    expect(result.materials.find((entry) => entry.resourceId === "intermediate")).toBeUndefined();
    expect(result.power.used).toBe(60);
    expect(
      selectedMaterials(
        result,
        result.ports!.map((port) => port.portKey),
      ),
    ).toEqual(expect.arrayContaining(result.materials.map((row) => expect.objectContaining(row))));
    expect(
      selectedMaterials(
        result,
        result
          .ports!.filter((port) => port.resourceId === "intermediate")
          .map((port) => port.portKey),
      ),
    ).toEqual([]);
  });

  it("addresses extra recipe sections separately", () => {
    const input = project({
      recipes: [recipe("first", [], [["one", 1]]), recipe("second", [], [["two", 2]])],
      nodes: [
        node("shared", "first", {
          solvePin: 1,
          solvePinExact: true,
          extraRecipes: [{ recipeId: "second" }],
        }),
      ],
    });
    const result = planFlows(input, calculateThroughput(input));
    expect(result.ports!.find((port) => port.resourceId === "two")?.portKey).toContain("shared#r1");
    expect(new Set(result.ports!.map((port) => port.portKey)).size).toBe(result.ports!.length);
  });

  it("counts buffer surplus once without exposing its internal pass-through", () => {
    const input = project({
      recipes: [
        recipe("make", [], [["oxygen", 3]]),
        recipe("use", [["oxygen", 2]], [["water", 1]]),
      ],
      nodes: [
        node("maker", "make", { solvePin: 1, solvePinExact: true }),
        node("user", "use", { solvePin: 1, solvePinExact: true }),
      ],
      storages: [drawer("buffer", "oxygen")],
      edges: [
        wire("in", "maker", "buffer", "oxygen", {}, { toDrawer: true }),
        wire("out", "buffer", "user", "oxygen", {}, { fromDrawer: true }),
      ],
    });
    const result = planFlows(input, calculateThroughput(input));
    expect(result.materials.find((row) => row.resourceId === "oxygen")).toMatchObject({
      supply: 1,
      demand: 0,
    });
    const selected = selectedMaterials(
      result,
      result.ports!.map((port) => port.portKey),
    );
    expect(selected.find((row) => row.resourceId === "oxygen")).toMatchObject({
      supply: 1,
      demand: 0,
    });
  });

  it("does not offer trashed byproducts as network supply", () => {
    const input = project({
      recipes: [
        recipe(
          "make",
          [],
          [
            ["product", 1],
            ["waste", 3],
          ],
        ),
      ],
      nodes: [node("a", "make", { solvePin: 1, solvePinExact: true })],
      storages: [
        drawer("out", "product", { targetPerSecond: 1, targetMode: "exact" }),
        drawer("trash", "waste", { drainMode: "trash" }),
      ],
      edges: [
        wire("out", "a", "out", "product", {}, { toDrawer: true }),
        wire("trash", "a", "trash", "waste", {}, { toDrawer: true }),
      ],
    });
    const result = planFlows(input, calculateThroughput(input));
    expect(result.materials).toEqual([
      expect.objectContaining({ resourceId: "product", supply: 1 }),
    ]);
  });
});

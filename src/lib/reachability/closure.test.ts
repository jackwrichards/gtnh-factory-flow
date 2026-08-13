import { describe, expect, it } from "vitest";
import { computeClosure, witnessChain, type ReachabilityGraph } from "./closure";

/**
 * A miniature world: an iron vein sources iron ore, ore macerates to dust,
 * dust smelts to ingot, ingots craft plates. A second chain needs EITHER
 * copper or iron (an oredict-style slot). A luxury needs unobtainium.
 */
const graph: ReachabilityGraph = {
  recipes: [
    { id: "vein-iron", inputSlots: [], outputs: ["ore-iron"] },
    { id: "macerate", inputSlots: [["ore-iron"]], outputs: ["dust-iron"] },
    { id: "smelt", inputSlots: [["dust-iron"]], outputs: ["ingot-iron"] },
    { id: "plate", inputSlots: [["ingot-iron"]], outputs: ["plate-iron"] },
    {
      id: "wire",
      inputSlots: [[("ingot-copper"), "ingot-iron"]],
      outputs: ["wire-any"],
    },
    { id: "luxury", inputSlots: [["unobtainium"]], outputs: ["crown"] },
    { id: "two-slot", inputSlots: [["plate-iron"], ["wire-any"]], outputs: ["machine"] },
  ],
};

describe("computeClosure", () => {
  it("closes over the chain from a root recipe", () => {
    const closure = computeClosure(graph, { rootRecipeIds: ["vein-iron"] });

    expect(closure.reachableSet.has("plate-iron")).toBe(true);
    expect(closure.reachableSet.has("machine")).toBe(true);
    expect(closure.reachableSet.has("crown")).toBe(false);
  });

  // A zero-input recipe (an ore vein) fires unless explicitly disabled; the
  // caller turns sources off via disabledRecipeIds, not by omission.
  it("satisfies a multi-accept slot through any member", () => {
    const closure = computeClosure(graph, {
      rootResources: ["ingot-copper"],
      disabledRecipeIds: ["vein-iron"],
    });

    expect(closure.reachableSet.has("wire-any")).toBe(true);
    expect(closure.reachableSet.has("plate-iron")).toBe(false);
  });

  it("waits for every slot before firing", () => {
    const onlyWire = computeClosure(graph, {
      rootResources: ["ingot-copper"],
      disabledRecipeIds: ["vein-iron"],
    });
    expect(onlyWire.reachableSet.has("machine")).toBe(false);

    const both = computeClosure(graph, {
      rootResources: ["ingot-copper", "plate-iron"],
      disabledRecipeIds: ["vein-iron"],
    });
    expect(both.reachableSet.has("machine")).toBe(true);
  });

  it("records the first producer as witness", () => {
    const closure = computeClosure(graph, { rootRecipeIds: ["vein-iron"] });

    expect(closure.witnessByResource.get("dust-iron")).toBe("macerate");
    expect(closure.witnessByResource.get("ore-iron")).toBe("vein-iron");
  });

  it("honours disabled recipes and resources", () => {
    const noVein = computeClosure(graph, {
      rootRecipeIds: ["vein-iron"],
      disabledRecipeIds: ["vein-iron"],
    });
    expect(noVein.reachable).toEqual([]);

    const noDust = computeClosure(graph, {
      rootRecipeIds: ["vein-iron"],
      disabledResourceIds: ["dust-iron"],
    });
    expect(noDust.reachableSet.has("ore-iron")).toBe(true);
    expect(noDust.reachableSet.has("ingot-iron")).toBe(false);
  });

  it("never satisfies an empty slot", () => {
    const closure = computeClosure(
      { recipes: [{ id: "broken", inputSlots: [[]], outputs: ["thing"] }] },
      { rootResources: ["anything"] },
    );

    expect(closure.reachableSet.has("thing")).toBe(false);
  });

  it("fires each recipe once even when several accepted ids arrive", () => {
    const closure = computeClosure(graph, {
      rootResources: ["ingot-copper", "ingot-iron"],
    });

    expect(closure.firedRecipeIds.has("wire")).toBe(true);
    expect(closure.reachable.filter((id) => id === "wire-any")).toEqual(["wire-any"]);
  });
});

describe("witnessChain", () => {
  it("walks back from a target to the roots, deepest first", () => {
    const closure = computeClosure(graph, { rootRecipeIds: ["vein-iron"] });
    const chain = witnessChain(graph, closure, "machine");
    if (!chain) {
      throw new Error("machine should be reachable");
    }

    const order = chain.steps.map((step) => step.recipeId);
    expect(order[order.length - 1]).toBe("two-slot");
    expect(order.indexOf("vein-iron")).toBeLessThan(order.indexOf("macerate"));
    expect(order.indexOf("macerate")).toBeLessThan(order.indexOf("smelt"));
    expect(order.indexOf("plate")).toBeLessThan(order.indexOf("two-slot"));
  });

  it("reports a root resource instead of inventing a step", () => {
    const closure = computeClosure(graph, {
      rootResources: ["ingot-copper"],
      disabledRecipeIds: ["vein-iron"],
    });
    const chain = witnessChain(graph, closure, "wire-any");
    if (!chain) {
      throw new Error("wire-any should be reachable");
    }

    expect(chain.steps.map((step) => step.recipeId)).toEqual(["wire"]);
    expect(chain.rootResourceIds).toEqual(["ingot-copper"]);
  });

  it("returns undefined for the unreachable", () => {
    const closure = computeClosure(graph, { rootRecipeIds: ["vein-iron"] });

    expect(witnessChain(graph, closure, "crown")).toBeUndefined();
  });

  it("shares one producer for a shared intermediate", () => {
    const closure = computeClosure(graph, { rootRecipeIds: ["vein-iron"] });
    const chain = witnessChain(graph, closure, "machine");
    if (!chain) {
      throw new Error("machine should be reachable");
    }

    expect(chain.steps.filter((step) => step.recipeId === "smelt")).toHaveLength(1);
  });
});

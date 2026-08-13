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

  it("honours a preferred producer and rebuilds beneath it", () => {
    const world: ReachabilityGraph = {
      recipes: [
        { id: "vein", inputSlots: [], outputs: ["ore"] },
        { id: "smelt-direct", inputSlots: [["ore"]], outputs: ["ingot"] },
        { id: "macerate", inputSlots: [["ore"]], outputs: ["dust"] },
        { id: "smelt-dust", inputSlots: [["dust"]], outputs: ["ingot"] },
      ],
    };
    const closure = computeClosure(world, { rootRecipeIds: ["vein"] });

    const tidy = witnessChain(world, closure, "ingot");
    expect(tidy?.steps.map((step) => step.recipeId)).toEqual(["vein", "smelt-direct"]);

    const viaDust = witnessChain(world, closure, "ingot", {
      preferredProducers: new Map([["ingot", "smelt-dust"]]),
    });
    expect(viaDust?.steps.map((step) => step.recipeId)).toEqual([
      "vein",
      "macerate",
      "smelt-dust",
    ]);
  });

  it("lists every fired producer of a walked resource, best first", () => {
    const world: ReachabilityGraph = {
      recipes: [
        { id: "vein", inputSlots: [], outputs: ["ore"] },
        { id: "smelt-direct", inputSlots: [["ore"]], outputs: ["ingot"] },
        { id: "lucky-dip", inputSlots: [["ore"]], outputs: ["ingot", "junk-a", "junk-b"] },
      ],
    };
    const closure = computeClosure(world, { rootRecipeIds: ["vein"] });
    const chain = witnessChain(world, closure, "ingot");

    expect(chain?.candidatesByResource.get("ingot")).toEqual(["smelt-direct", "lucky-dip"]);
  });

  it("ignores a preference for a recipe that never fired or does not produce it", () => {
    const closure = computeClosure(graph, { rootRecipeIds: ["vein-iron"] });
    const chain = witnessChain(graph, closure, "dust-iron", {
      preferredProducers: new Map([["dust-iron", "luxury"]]),
    });

    expect(chain?.steps.map((step) => step.recipeId)).toEqual(["vein-iron", "macerate"]);
  });

  it("refuses a chain that manufactures a resource out of itself", () => {
    // Steel's tidiest producer is demagnetizing a magnetic steel ingot - one
    // output, very tidy - but every road to a magnetic ingot starts from
    // steel. The walk must reject that whole branch and fall through to the
    // blast furnace, not place a loop seeded by an unwired slot.
    const world: ReachabilityGraph = {
      recipes: [
        { id: "iron-vein", inputSlots: [], outputs: ["iron-ore"] },
        { id: "demagnetize", inputSlots: [["magnetic-steel"]], outputs: ["steel"] },
        { id: "polarize", inputSlots: [["steel-rod"]], outputs: ["magnetic-steel"] },
        { id: "lathe", inputSlots: [["steel"]], outputs: ["steel-rod"] },
        { id: "blast-furnace", inputSlots: [["iron-ore"]], outputs: ["steel", "slag"] },
      ],
    };
    const closure = computeClosure(world, { rootRecipeIds: ["iron-vein"] });
    const chain = witnessChain(world, closure, "steel");

    expect(chain?.steps.map((step) => step.recipeId)).toEqual(["iron-vein", "blast-furnace"]);
    expect(chain?.rootResourceIds).toEqual([]);
  });

  it("still walks THROUGH a loop-shaped world when a real feed exists", () => {
    // Magnetic steel itself: the only producer eats steel, and steel has an
    // honest source. The chain must thread polarize -> blast furnace rather
    // than declaring magnetic steel a root.
    const world: ReachabilityGraph = {
      recipes: [
        { id: "iron-vein", inputSlots: [], outputs: ["iron-ore"] },
        { id: "blast-furnace", inputSlots: [["iron-ore"]], outputs: ["steel"] },
        { id: "demagnetize", inputSlots: [["magnetic-steel"]], outputs: ["steel"] },
        { id: "polarize", inputSlots: [["steel"]], outputs: ["magnetic-steel"] },
      ],
    };
    const closure = computeClosure(world, { rootRecipeIds: ["iron-vein"] });
    const chain = witnessChain(world, closure, "magnetic-steel");

    expect(chain?.steps.map((step) => step.recipeId)).toEqual([
      "iron-vein",
      "blast-furnace",
      "polarize",
    ]);
  });

  it("bans a resource's oredict family with it, closing the cousin loophole", () => {
    // Two interchangeable steels. Banning only GT's would leave Railcraft's
    // alive, and the polarize/demagnetize pair would "prove" steel makeable
    // from steel via the cousin. With the family banned together, the only
    // qualifying producer is the honest furnace from iron.
    const world: ReachabilityGraph = {
      recipes: [
        { id: "iron-vein", inputSlots: [], outputs: ["iron-ore"] },
        { id: "smelt-iron", inputSlots: [["iron-ore"]], outputs: ["gt-steel"] },
        { id: "rc-blast", inputSlots: [["iron-ore"]], outputs: ["rc-steel"] },
        // The oredict crafting recipe: accepts either steel.
        { id: "polarize", inputSlots: [["gt-steel", "rc-steel"]], outputs: ["magnetic-steel"] },
        { id: "demagnetize", inputSlots: [["magnetic-steel"]], outputs: ["gt-steel"] },
      ],
    };
    const closure = computeClosure(world, { rootRecipeIds: ["iron-vein"] });
    const family = new Map([
      ["gt-steel", ["rc-steel"]],
      ["rc-steel", ["gt-steel"]],
    ]);

    const withoutFamilies = witnessChain(world, closure, "gt-steel");
    // The cousin loophole, demonstrated: demagnetize qualifies because
    // rc-steel feeds the polarizer in a world where only gt-steel is banned.
    expect(withoutFamilies?.candidatesByResource.get("gt-steel")).toContain("demagnetize");

    const withFamilies = witnessChain(world, closure, "gt-steel", {
      familyOf: (id) => family.get(id) ?? [],
    });
    expect(withFamilies?.candidatesByResource.get("gt-steel")).toEqual(["smelt-iron"]);
    expect(withFamilies?.steps.map((step) => step.recipeId)).toEqual(["iron-vein", "smelt-iron"]);
  });

  it("never defaults to a deprioritized recipe, but honours picking one", () => {
    // The essentia smelter has the fewest outputs and would win on tidiness;
    // deprioritized, the honest machine takes the default and the smelter
    // stays one explicit preference away.
    const world: ReachabilityGraph = {
      recipes: [
        { id: "vein", inputSlots: [], outputs: ["ore"] },
        { id: "melt-down", inputSlots: [["ore"]], outputs: ["essence"] },
        { id: "machine-way", inputSlots: [["ore"]], outputs: ["essence", "slag"] },
      ],
    };
    const closure = computeClosure(world, { rootRecipeIds: ["vein"] });
    const options = { deprioritizedRecipeIds: new Set(["melt-down"]) };

    const byDefault = witnessChain(world, closure, "essence", options);
    expect(byDefault?.steps.map((step) => step.recipeId)).toEqual(["vein", "machine-way"]);
    // Still listed - last, not gone.
    expect(byDefault?.candidatesByResource.get("essence")).toEqual(["machine-way", "melt-down"]);

    const chosen = witnessChain(world, closure, "essence", {
      ...options,
      preferredProducers: new Map([["essence", "melt-down"]]),
    });
    expect(chosen?.steps.map((step) => step.recipeId)).toEqual(["vein", "melt-down"]);
  });

  it("prefers a tidy producer over a lucky-dip one that fired first", () => {
    // The scrap box fires first and technically drops an ingot among forty
    // other things; the smelter is the recipe a plan should actually use.
    const world: ReachabilityGraph = {
      recipes: [
        { id: "vein", inputSlots: [], outputs: ["ore"] },
        {
          id: "scrap-box",
          inputSlots: [["ore"]],
          outputs: Array.from({ length: 40 }, (_, index) => `junk-${index}`).concat(["ingot"]),
        },
        { id: "smelt", inputSlots: [["ore"]], outputs: ["ingot"] },
      ],
    };
    const closure = computeClosure(world, { rootRecipeIds: ["vein"] });
    const chain = witnessChain(world, closure, "ingot");

    expect(chain?.steps.map((step) => step.recipeId)).toEqual(["vein", "smelt"]);
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

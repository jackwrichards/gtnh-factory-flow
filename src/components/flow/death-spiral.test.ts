import { describe, expect, it } from "vitest";
import type { FactoryProject, Recipe } from "@/lib/model/types";
import { calculateThroughput } from "@/lib/solver/throughput";
import { describeDeathSpiral, findDeathSpirals } from "./death-spiral";
import { deriveNodeVerdict } from "./node-verdict";

// Driven through the REAL solver rather than hand-written result fixtures:
// the whole claim is "the numbers were always right, we just never said why",
// so the test has to read the numbers the board actually shows.

function recipe(id: string, inputs: Recipe["inputs"], outputs: Recipe["outputs"]): Recipe {
  return {
    id,
    name: id,
    machineType: `Machine ${id}`,
    minimumTier: "ULV",
    durationTicks: 20, // one operation per second
    eut: 1,
    inputs,
    outputs,
  };
}

function project(partial: Partial<FactoryProject>): FactoryProject {
  return {
    schemaVersion: 1,
    id: "spiral-test",
    name: "spiral-test",
    storages: [],
    recipes: [],
    nodes: [],
    edges: [],
    ...partial,
  } as FactoryProject;
}

const node = (id: string, recipeId: string, extra: Record<string, unknown> = {}) => ({
  id,
  recipeId,
  machineCount: 1,
  parallel: 1,
  overclockTier: "ULV",
  enabled: true,
  position: { x: 0, y: 0 },
  ...extra,
});

const edge = (id: string, source: string, target: string, resourceId: string) => ({
  id,
  source,
  target,
  resourceKind: "item" as const,
  resourceId,
});

/**
 * A four-machine ring: a -> b -> c -> d -> a. `keep` is how much of the good
 * each machine passes on for the 10 it eats, so keep < 10 loses on every lap
 * and keep >= 10 sustains. This is the user's shape: four conversions of one
 * good, round in a circle.
 */
function ring(keep: number, extra?: { source?: boolean; outlet?: boolean }) {
  const letters = ["a", "b", "c", "d"];
  const recipes: Recipe[] = letters.map((letter, index) =>
    recipe(
      `r-${letter}`,
      [{ kind: "item", id: `item:${letter}`, amount: 10 }],
      [{ kind: "item", id: `item:${letters[(index + 1) % letters.length]}`, amount: keep }],
    ),
  );
  const nodes = letters.map((letter) => node(letter.toUpperCase(), `r-${letter}`));
  const edges = letters.map((letter, index) =>
    edge(
      `e${index}`,
      letter.toUpperCase(),
      letters[(index + 1) % letters.length]!.toUpperCase(),
      `item:${letters[(index + 1) % letters.length]}`,
    ),
  );

  if (extra?.source) {
    recipes.push(recipe("r-src", [], [{ kind: "item", id: "item:a", amount: 10 }]));
    nodes.push(node("SRC", "r-src"));
    edges.push(edge("eSrc", "SRC", "A", "item:a"));
  }
  // Something outside taking product from the ring. Without one a ring has
  // nothing pulling on it, which is its own (very different) reason to idle.
  if (extra?.outlet) {
    recipes.push(recipe("r-out", [{ kind: "item", id: "item:c", amount: 2 }], []));
    nodes.push(node("OUT", "r-out"));
    edges.push(edge("eOut", "B", "OUT", "item:c"));
  }

  return project({ recipes, nodes, edges });
}

describe("findDeathSpirals", () => {
  it("catches a four-machine ring that loses on every lap", () => {
    const proj = ring(9);
    const result = calculateThroughput(proj);

    // The solver's answer first: this is the behaviour we are explaining, not
    // changing. Every machine in the ring has wound down to a standstill.
    for (const id of ["A", "B", "C", "D"]) {
      expect(result.nodes[id]!.utilization).toBeLessThan(1e-4);
    }

    const { spirals, byNode } = findDeathSpirals(proj, result);
    expect(spirals).toHaveLength(1);
    expect(spirals[0]!.machineIds).toEqual(["A", "B", "C", "D"]);
    expect(spirals[0]!.hasExternalSource).toBe(false);
    // Every member points at the SAME ring, which is what stops the advice
    // chasing itself round the circle.
    expect(byNode.get("A")).toBe(byNode.get("C"));
  });

  it("says nothing about a ring that sustains itself", () => {
    // Same four machines, same wiring, but each passes on everything it ate.
    // A surplus ring is a good build and must stay silent.
    const proj = ring(10);
    const result = calculateThroughput(proj);

    expect(result.nodes.A!.utilization).toBeCloseTo(1, 4);
    expect(findDeathSpirals(proj, result).spirals).toHaveLength(0);
  });

  it("says nothing once a source covers the losses", () => {
    const proj = ring(9, { source: true, outlet: true });
    const result = calculateThroughput(proj);

    expect(result.nodes.A!.utilization).toBeGreaterThan(0.5);
    expect(findDeathSpirals(proj, result).spirals).toHaveLength(0);
  });

  it("catches a break-even ring that something taps for its own use", () => {
    // Each machine passes on exactly what it ate, so the ring alone would
    // hold. Siphoning 2/s off it is enough to bleed it dry: the losses do not
    // have to be in the recipes.
    const proj = ring(10, { outlet: true });
    const result = calculateThroughput(proj);

    expect(result.nodes.A!.utilization).toBeLessThan(1e-4);
    expect(findDeathSpirals(proj, result).spirals).toHaveLength(1);
  });

  it("does not call a ring dead when it is merely idle for lack of takers", () => {
    // The trap: fed, perfectly capable, and still 0% across the board because
    // nothing outside wants the product. Usage alone cannot tell this from a
    // spiral, so the detector tests capability. Calling this one a death
    // spiral would send the player priming a ring that needs a customer.
    const proj = ring(9, { source: true });
    const result = calculateThroughput(proj);

    expect(result.nodes.A!.utilization).toBeLessThan(1e-4);
    expect(result.nodes.A!.capableUtilization).toBeCloseTo(1, 3);
    expect(findDeathSpirals(proj, result).spirals).toHaveLength(0);
  });

  it("catches a machine wired back into itself", () => {
    const proj = project({
      recipes: [
        recipe(
          "eater",
          [{ kind: "item", id: "item:sand", amount: 10 }],
          [{ kind: "item", id: "item:sand", amount: 5 }],
        ),
      ],
      nodes: [node("M", "eater")],
      edges: [edge("self", "M", "M", "item:sand")],
    });
    const result = calculateThroughput(proj);

    const { spirals } = findDeathSpirals(proj, result);
    expect(spirals).toHaveLength(1);
    expect(spirals[0]!.machineIds).toEqual(["M"]);
    expect(describeDeathSpiral(spirals[0]!).title).toBe("This loop cannot start itself");
  });

  it("leaves a ring alone when you switched one of them off", () => {
    // Stopped because you stopped it. That already has an explanation, and
    // "dead loop" would be a worse one.
    const proj = ring(9);
    proj.nodes = proj.nodes.map((entry) =>
      entry.id === "B" ? { ...entry, enabled: false } : entry,
    );
    const result = calculateThroughput(proj);

    expect(findDeathSpirals(proj, result).spirals).toHaveLength(0);
  });

  it("blames a stopped supplier instead of the ring it starves", () => {
    // The titanium-line shape: a healthy ring fed from outside by a machine
    // that is itself stopped (an unwired second output, here `waste`). The
    // ring reads 0% across the board, but it is not dying of its own losses -
    // it is waiting on the feeder, and the story must send the player THERE.
    const proj = ring(10, { outlet: true });
    proj.recipes.push(
      recipe(
        "r-feed",
        [],
        [
          { kind: "item", id: "item:a", amount: 10 },
          { kind: "item", id: "item:waste", amount: 5 },
        ],
      ),
    );
    proj.nodes.push(node("FEED", "r-feed"));
    proj.edges.push(edge("eFeed", "FEED", "A", "item:a"));
    const result = calculateThroughput(proj);

    expect(result.nodes.FEED!.utilization).toBeLessThan(1e-4);
    const { spirals } = findDeathSpirals(proj, result);
    expect(spirals).toHaveLength(1);
    expect(spirals[0]!.deadFeeders).toHaveLength(1);
    expect(spirals[0]!.deadFeeders[0]!.name).toBe("Machine r-feed");

    const story = describeDeathSpiral(spirals[0]!);
    expect(story.title).toBe("This loop is waiting on its supplier");
    expect(story.fix).toContain("Machine r-feed");
    expect(story.fix).toContain("its own card says why");
  });

  it("stands down entirely once the supplier runs", () => {
    // Same board, waste output wired to a drawer: the feeder starts, the
    // ring fills, and there is nothing to report.
    const proj = ring(10, { outlet: true });
    proj.recipes.push(
      recipe(
        "r-feed",
        [],
        [
          { kind: "item", id: "item:a", amount: 10 },
          { kind: "item", id: "item:waste", amount: 5 },
        ],
      ),
    );
    proj.nodes.push(node("FEED", "r-feed"));
    proj.edges.push(edge("eFeed", "FEED", "A", "item:a"));
    proj.storages = [
      { id: "wasteDrawer", kind: "item", resourceId: "item:waste", position: { x: 0, y: 0 } },
    ];
    proj.edges.push(edge("eWaste", "FEED", "wasteDrawer", "item:waste"));
    const result = calculateThroughput(proj);

    // The outlet's 2/s tap is the only pull on the ring, so 20% of nameplate
    // is the honest pace - what matters is that it turns at all.
    expect(result.nodes.A!.utilization).toBeGreaterThan(0.1);
    expect(findDeathSpirals(proj, result).spirals).toHaveLength(0);
  });

  it("names the ring on every card instead of pointing round it", () => {
    const proj = ring(9);
    const result = calculateThroughput(proj);

    // Before this existed each card read "blocked" and blamed its neighbour,
    // so following the advice walked the circle forever.
    for (const id of ["A", "B", "C", "D"]) {
      const verdict = deriveNodeVerdict(proj, result, id);
      expect(verdict.kind).toBe("dead-loop");
      expect(verdict.spiral?.machineIds).toEqual(["A", "B", "C", "D"]);
    }

    const story = describeDeathSpiral(deriveNodeVerdict(proj, result, "A").spiral!);
    expect(story.what).toContain("4 machines feed each other");
    expect(story.fix).toContain("Wire a source into any machine in the ring");
  });
});

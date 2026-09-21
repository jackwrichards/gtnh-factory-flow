import { describe, expect, it } from "vitest";
import resistor from "./__fixtures__/issue49-resistor.json";
import { PROJECT_SCHEMA_VERSION, type FactoryProject, type Recipe } from "./types";
import { applyRecipeInputOverrides } from "./recipe-input-overrides";
import { applyEdgeInputOverride, repairWiredInputOverrides } from "./edge-input-overrides";
import { normalizeLoadedProject } from "./project-normalize";
import { useFactoryStore } from "@/store/factory-store";
import { buildRailPorts, deriveNodeVerdict } from "@/components/flow/node-verdict";
import { calculateThroughput } from "@/lib/solver/throughput";
import { closeBoundaries } from "@/lib/solver/close-boundaries";

const FINE = "gregtech:gt.metaitem.02@19035";
const recipe = resistor as Recipe;
function project(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "issue49",
    name: "Resistor regression",
    fuelProfiles: [],
    recipes: [
      recipe,
      {
        id: "wiremill",
        name: "Fine Copper Wire",
        machineType: "Wiremill",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 4,
        inputs: [],
        outputs: [{ kind: "item", id: FINE, amount: 4, displayName: "Fine Copper Wire" }],
      },
    ],
    nodes: [recipe.id, "wiremill"].map((recipeId, index) => ({
      id: index ? "wiremill" : "bench",
      recipeId,
      machineCount: 1,
      parallel: 1,
      overclockTier: "LV",
      enabled: true,
      position: { x: index * 400, y: 0 },
    })),
    edges: [],
  };
}
const wire = {
  id: "fine-wire",
  source: "wiremill",
  target: "bench",
  resourceKind: "item" as const,
  resourceId: FINE,
  label: "Fine Copper Wire",
  sourceHandle: `output:item:${encodeURIComponent(FINE)}`,
  targetHandle: "input:item:oredict%3AwireFineCopper",
};
function rails(p: FactoryProject) {
  const node = p.nodes[0]!;
  const effective = applyRecipeInputOverrides(p.recipes[0]!, node);
  const result = calculateThroughput(p);
  return buildRailPorts(p, result, node.id, effective, deriveNodeVerdict(p, result, node.id))
    .inputs;
}

describe("issue #49: repeated Auto Workbench ingredients", () => {
  it("shows stable category names and representative icons before wiring", () => {
    const inputs = rails(project());
    expect(inputs.map((port) => port.displayName)).toEqual([
      "Sticky Resin",
      "Any Fine Copper Wire",
      "Any 1x Copper Wire",
      "Any Charcoal Dust",
    ]);
    expect(inputs.every((port) => port.resource?.iconPath)).toBe(true);
    expect(inputs[1]?.resourceId).toBe("oredict:wireFineCopper");
    expect(inputs[1]?.resource?.tooltip?.join(" ") ?? "").not.toContain("Ore dictionary:");
  });

  it.each(["", ":1"])(
    "connects the whole row with handle suffix '%s', without doubling quantities",
    (suffix) => {
      useFactoryStore.getState().setProject(project());
      useFactoryStore.getState().connectNodes("wiremill", "bench", {
        kind: "item",
        id: FINE,
        displayName: "Fine Copper Wire",
        sourceHandle: wire.sourceHandle,
        targetHandle: wire.targetHandle + suffix,
      });
      const p = useFactoryStore.getState().project;
      expect(p.edges).toHaveLength(1);
      expect(Object.keys(p.nodes[0]!.recipeInputOverrides!)).toEqual(["1", "6"]);
      expect(rails(p)).toHaveLength(4);
      const wired = rails(p).find((port) => port.resourceId === FINE)!;
      expect(wired.connected).toBe(true);
      expect(wired.unsupplied).toBe(false);
      expect(p.edges[0]!.targetHandle).toBe(wired.handleId);

      // Close only the OTHER boundaries; a second dictionary demand must not
      // get a free source drawer and hide the defect from this solver check.
      const closed = closeBoundaries(p);
      expect(closed.storages?.some((s) => s.resourceId === "oredict:wireFineCopper")).toBe(false);
      const result = calculateThroughput(closed);
      const bench = result.nodes.bench!;
      expect(bench.utilization).toBeGreaterThan(0);
      expect(bench.inputs[`item:${FINE}`]!.amountPerSecond).toBeCloseTo(
        2 * bench.outputs["item:gregtech:gt.metaitem.01@32716"]!.amountPerSecond,
      );
      expect(result.edges[p.edges[0]!.id]!.transferredPerSecond).toBeGreaterThan(0);
      expect(p.recipes[0]).toEqual(recipe);
    },
  );

  it("repairs the reporter's saved one-slot choice on load and stays stable on reload", () => {
    const p = project();
    p.edges = [wire];
    p.nodes[0]!.recipeInputOverrides = {
      "1": { kind: "item", id: FINE, amount: 1, displayName: "Fine Copper Wire" },
    };
    const loaded = normalizeLoadedProject(p);
    expect(Object.keys(loaded.nodes[0]!.recipeInputOverrides!)).toEqual(["1", "6"]);
    expect(rails(loaded)).toHaveLength(4);
    expect(normalizeLoadedProject(JSON.parse(JSON.stringify(loaded)))).toEqual(loaded);
    expect(repairWiredInputOverrides(loaded)).toBe(loaded);
    expect(loaded.edges).toEqual([
      { ...wire, targetHandle: `input:item:${encodeURIComponent(FINE)}` },
    ]);
  });

  it("keeps separately selected variants and non-consumed slots intact", () => {
    const p = structuredClone(project());
    p.recipes[0]!.inputs[6]!.alternatives!.push({ kind: "item", id: "other-wire" });
    p.recipes[0]!.inputs.push({ ...p.recipes[0]!.inputs[1]!, consumed: false });
    p.nodes[0]!.recipeInputOverrides = { "6": { kind: "item", id: "other-wire", amount: 1 } };
    const wired = applyEdgeInputOverride(p, wire);
    expect(wired.nodes[0]!.recipeInputOverrides!["6"]!.id).toBe("other-wire");
    expect(wired.nodes[0]!.recipeInputOverrides!["7"]).toBeUndefined();
    expect(wired.nodes[0]!.recipeInputOverrides!["1"]!.id).toBe(FINE);
  });

  it("limits the choice to the addressed shared-machine section and keeps per-slot amounts", () => {
    const p = structuredClone(project());
    p.recipes[0]!.inputs[6]!.amount = 3;
    p.nodes[0]!.extraRecipes = [{ recipeId: recipe.id }];
    const wired = applyEdgeInputOverride(p, { ...wire, targetHandle: `r1:${wire.targetHandle}` });
    expect(wired.nodes[0]!.recipeInputOverrides).toBeUndefined();
    const picks = wired.nodes[0]!.extraRecipes![0]!.recipeInputOverrides!;
    expect(picks["1"]!.amount).toBe(1);
    expect(picks["6"]!.amount).toBe(3);
    expect(picks["1"]!.neiSlot).toEqual(recipe.inputs[1]!.neiSlot);
    expect(picks["6"]!.neiSlot).toEqual(recipe.inputs[6]!.neiSlot);
  });
});

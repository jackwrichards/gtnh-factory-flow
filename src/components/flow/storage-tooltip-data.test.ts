import { describe, expect, it } from "vitest";
import {
  PROJECT_SCHEMA_VERSION,
  type FactoryNode,
  type FactoryProject,
  type FactoryStorage,
  type Recipe,
} from "@/lib/model/types";
import { calculateThroughput } from "@/lib/solver/throughput";
import { getStorageRole } from "@/lib/model/storage-role";
import {
  buildBufferKeyTooltip,
  buildDrainKeyTooltip,
  buildStorageTooltip,
  buildTargetTooltip,
} from "./storage-tooltip-data";

const chlorine = { kind: "fluid" as const, id: "chlorine", displayName: "Chlorine", amount: 100 };
const product = { kind: "fluid" as const, id: "hcl", displayName: "Hydrochloric Acid", amount: 100 };
const slag = { kind: "item" as const, id: "slag", displayName: "Slag", amount: 1 };
// 20 ticks: one machine turns 100 L of chlorine into 100 L of acid per second.
const recipe: Recipe = { id: "r", name: "Acid", machineType: "Chemical Reactor", minimumTier: "LV", durationTicks: 20, eut: 30, inputs: [chlorine], outputs: [product, slag] };
const machine: FactoryNode = { id: "n", recipeId: "r", machineCount: 2, parallel: 1, overclockTier: "LV", enabled: true, position: { x: 0, y: 0 } };
const drawer = (id: string, res: { kind: "fluid" | "item"; id: string; displayName: string }, extra: Partial<FactoryStorage> = {}): FactoryStorage =>
  ({ id, kind: res.kind, resourceId: res.id, displayName: res.displayName, position: { x: 0, y: 0 }, ...extra });

function plan(extra: Partial<FactoryProject> = {}): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION, id: "p", name: "Drawers", recipes: [recipe], nodes: [machine], fuelProfiles: [],
    storages: [drawer("src", chlorine), drawer("out", product), drawer("by", slag, { drainMode: "byproduct" })],
    edges: [
      { id: "e1", source: "src", target: "n", resourceKind: "fluid", resourceId: "chlorine" },
      { id: "e2", source: "n", target: "out", resourceKind: "fluid", resourceId: "hcl" },
      { id: "e3", source: "n", target: "by", resourceKind: "item", resourceId: "slag" },
    ],
    ...extra,
  } as FactoryProject;
}
const tip = (p: FactoryProject, id: string) => {
  const result = calculateThroughput(p, { generatedAt: "fixed" });
  return buildStorageTooltip(p, result, p.storages!.find((s) => s.id === id)!, getStorageRole(p, id));
};
const labels = (view: { rows: Array<{ label: string }> }) => view.rows.map((r) => r.label);

describe("drawer tooltips are words and figures", () => {
  it("names each role and shows its one figure", () => {
    const p = plan();
    expect(tip(p, "src")).toMatchObject({ subtitle: "Source", rows: [{ label: "Supplied", value: "200 L/s" }] });
    expect(tip(p, "out")).toMatchObject({ subtitle: "Product", rows: [{ label: "Produced", value: "200 L/s" }] });
    expect(tip(p, "by")).toMatchObject({ subtitle: "Byproduct", rows: [{ label: "Produced" }] });
    const trashed = plan({ storages: [...plan().storages!.filter((s) => s.id !== "by"), drawer("by", slag, { drainMode: "trash" })] });
    expect(tip(trashed, "by")).toMatchObject({ subtitle: "Trash", rows: [{ label: "Discarded" }] });
  });
  it("shows a product's requirement and shortfall in solve mode, with the cause", () => {
    const met = plan({ solveMode: true, storages: [drawer("src", chlorine), drawer("out", product, { targetPerSecond: 150 }), drawer("by", slag, { drainMode: "byproduct" })] });
    expect(labels(tip(met, "out"))).toEqual(["Required", "Produced"]);
    // A pinned single machine cannot reach 150 L/s.
    const short = { ...met, nodes: [{ ...machine, solvePin: 1 }] };
    const view = tip(short, "out");
    expect(labels(view)).toEqual(["Required", "Produced", "Shortfall"]);
    expect(view.rows[2]?.value).toBe("50 L/s");
    expect(view.reason).toBeDefined();
  });
  it("reads a buffer as in, out and the stored difference", () => {
    const p = plan({
      recipes: [recipe, { ...recipe, id: "r2", name: "Burner", inputs: [product], outputs: [slag] }],
      nodes: [machine, { ...machine, id: "n2", recipeId: "r2", machineCount: 1 }],
      edges: [...plan().edges,
        { id: "e4", source: "out", target: "n2", resourceKind: "fluid", resourceId: "hcl" },
        { id: "e5", source: "n2", target: "by", resourceKind: "item", resourceId: "slag" },
      ],
    });
    const view = tip(p, "out");
    expect(view.subtitle).toBe("Buffer");
    expect(view.rows).toEqual([
      { label: "In", value: "200 L/s" },
      { label: "Out", value: "100 L/s" },
      { label: "Stored", value: "+100 L/s" },
    ]);
    const strict = { ...p, storages: p.storages!.map((s) => (s.id === "out" ? { ...s, bufferMode: "strict" as const } : s)) };
    expect(tip(strict, "out").subtitle).toBe("Buffer · Strict");
  });
  it("requires a wire on an idle drawer and marks inert drawers in pool mode", () => {
    const idle = plan({ edges: [] });
    expect(tip(idle, "out")).toMatchObject({ subtitle: "Drawer", requirement: "You must connect it." });
    const pool = plan({ solveMode: true, poolMode: true, nodes: [{ ...machine, solvePin: 1 }] });
    expect(tip(pool, "src")).toMatchObject({ subtitle: "Source · Not pooled", rows: [], actions: [] });
    expect(tip(pool, "out").subtitle).toBe("Product");
    expect(tip(pool, "out").actions).toEqual([]);
    expect(tip(plan(), "out").actions).toEqual([{ gesture: "drag", label: "Drag to connect" }]);
  });
  it("keeps every drawer panel free of explanatory sentences", () => {
    const p = plan();
    for (const id of ["src", "out", "by"]) {
      expect(JSON.stringify(tip(p, id))).not.toMatch(/piles|flat out|asks for|left over|never runs out/i);
    }
  });
  it("describes the keys by state and next state", () => {
    expect(buildDrainKeyTooltip("product", "byproduct")).toMatchObject({ title: "Product", actions: [{ label: "Switch to byproduct" }] });
    expect(buildBufferKeyTooltip("strict")).toMatchObject({ title: "Strict", actions: [{ label: "Switch to ratio" }] });
    expect(buildBufferKeyTooltip("overflow")).toMatchObject({ title: "Non-strict", actions: [{ label: "Switch to strict" }] });
    expect(buildBufferKeyTooltip("ratio")).toMatchObject({ title: "Ratio", actions: [{ label: "Switch to overflow" }] });
    const field = buildTargetTooltip(drawer("out", product, { targetPerSecond: 150 }), { producedPerSecond: 100, targetUnreachable: true } as never);
    expect(labels(field)).toEqual(["Required", "Reachable"]);
    expect(field.actions?.[0]?.label).toBe("Edit amount");
  });
});

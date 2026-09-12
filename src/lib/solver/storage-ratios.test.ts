import { describe, expect, it } from "vitest";
import {
  PROJECT_SCHEMA_VERSION,
  type FactoryProject,
  type Recipe,
  type ResourceKind,
} from "@/lib/model/types";
import { factoryProjectSchema, factoryEdgeSchema } from "@/lib/model/schemas";
import { normalizeLoadedProject } from "@/lib/model/project-normalize";
import { formatRatioShare, getProjectRatioBranches } from "@/lib/model/storage-ratios";
import { calculateThroughput } from "./throughput";
import { useFactoryStore } from "@/store/factory-store";

function board(weights = [1, 1], kind: ResourceKind = "item"): FactoryProject {
  const recipe = (id: string, input: string, output: string, amount: number): Recipe => ({
    id,
    name: id,
    machineType: "Lab Machine",
    minimumTier: "LV",
    durationTicks: 20,
    eut: 30,
    inputs: [{ kind, id: input, amount }],
    outputs: [{ kind, id: output, amount }],
  });
  const wire = (
    id: string,
    source: string,
    target: string,
    resourceId: string,
    ratioWeight?: number,
  ) => ({ id, source, target, resourceKind: kind, resourceId, ratioWeight });
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "ratio-test",
    name: "Ratio test",
    fuelProfiles: [],
    recipes: [
      recipe("maker", "ore", "iron", 100),
      ...weights.map((_, i) => recipe(`line${i}`, "iron", `product${i}`, 100)),
    ],
    nodes: ["maker", ...weights.map((_, i) => `line${i}`)].map((id, i) => ({
      id,
      recipeId: id,
      machineCount: 1,
      parallel: 1,
      overclockTier: "LV",
      enabled: true,
      position: { x: i * 400, y: 0 },
    })),
    storages: [
      { id: "src", kind, resourceId: "ore", position: { x: -200, y: 0 } },
      { id: "split", kind, resourceId: "iron", bufferMode: "ratio", position: { x: 200, y: 0 } },
      ...weights.map((_, i) => ({
        id: `out${i}`,
        kind,
        resourceId: `product${i}`,
        position: { x: i * 400, y: 200 },
      })),
    ],
    edges: [
      wire("feed", "src", "maker", "ore"),
      wire("in", "maker", "split", "iron"),
      ...weights.flatMap((weight, i) => [
        wire(`branch${i}`, "split", `line${i}`, "iron", weight),
        wire(`end${i}`, `line${i}`, `out${i}`, `product${i}`),
      ]),
    ],
  };
}

const run = (project: FactoryProject) => calculateThroughput(project, { generatedAt: "fixed" });

describe("ratio drawers", () => {
  it.each(["item", "fluid"] as const)(
    "splits pooled %s supply 50/25/25 without banking",
    (kind) => {
      const result = run(board([2, 1, 1], kind));
      [50, 25, 25].forEach((rate, i) =>
        expect(result.edges[`branch${i}`].transferredPerSecond).toBeCloseTo(rate, 3),
      );
      expect(result.storages.split.netPerSecond).toBeCloseTo(0, 3);
    },
  );
  it("accepts arbitrary parts such as 1000:20", () => {
    const result = run(board([1000, 20]));
    expect(result.edges.branch0.transferredPerSecond).toBeCloseTo((100 * 1000) / 1020, 3);
    expect(result.edges.branch1.transferredPerSecond).toBeCloseTo((100 * 20) / 1020, 3);
  });
  it("holds the split when one branch saturates", () => {
    const project = board([1, 1]);
    project.nodes[2].machineCount = 0.1;
    const result = run(project);
    expect(result.edges.branch0.transferredPerSecond).toBeCloseTo(10, 3);
    expect(result.edges.branch1.transferredPerSecond).toBeCloseTo(10, 3);
    expect(result.nodes.maker.utilization).toBeCloseTo(0.2, 3);
    expect(result.storages.split.netPerSecond).toBeCloseTo(0, 3);
  });
  it.each(["disabled", "unwired"])("a %s branch holds all positive shares", (blocked) => {
    const project = board();
    if (blocked === "disabled") project.nodes[2].enabled = false;
    else project.edges = project.edges.filter((e) => e.id !== "end1");
    const result = run(project);
    expect(result.edges.branch0.transferredPerSecond).toBeCloseTo(0, 3);
    expect(result.nodes.maker.utilization).toBeCloseTo(0, 3);
  });
  it("zero closes only its branch; all-zero closes the drawer", () => {
    const project = board([1, 0]);
    project.nodes[2].enabled = false;
    expect(run(project).edges.branch0.transferredPerSecond).toBeCloseTo(100, 3);
    const stopped = run(board([0, 0]));
    expect(stopped.edges.in.transferredPerSecond).toBeCloseTo(0, 3);
  });
  it("removing a branch renormalizes the surviving parts", () => {
    const project = board([2, 1, 1]);
    project.edges = project.edges.filter((e) => e.id !== "branch2");
    const result = run(project);
    expect(result.edges.branch0.transferredPerSecond).toBeCloseTo(200 / 3, 3);
    expect(result.edges.branch1.transferredPerSecond).toBeCloseTo(100 / 3, 3);
  });
  it("combines multiple incoming wires before dividing the total", () => {
    const project = board([3, 1]);
    project.nodes[0].machineCount = 0.5;
    project.nodes.push({ ...project.nodes[0], id: "maker2" });
    project.edges.push(
      { ...project.edges[0], id: "feed2", target: "maker2" },
      { ...project.edges[1], id: "in2", source: "maker2" },
    );
    const result = run(project);
    expect(result.edges.in.transferredPerSecond).toBeCloseTo(50, 3);
    expect(result.edges.in2.transferredPerSecond).toBeCloseTo(50, 3);
    expect(result.edges.branch0.transferredPerSecond).toBeCloseTo(75, 3);
  });
  it("splits into another drawer as well as machines", () => {
    const project = board([1, 1]);
    project.edges = project.edges
      .filter((e) => e.id !== "end1")
      .map((e) => (e.id === "branch1" ? { ...e, target: "spare" } : e));
    project.storages!.push({
      id: "spare",
      kind: "item",
      resourceId: "iron",
      position: { x: 0, y: 300 },
    });
    const result = run(project);
    expect(result.edges.branch0.transferredPerSecond).toBeCloseTo(50, 3);
    expect(result.edges.branch1.transferredPerSecond).toBeCloseTo(50, 3);
  });
  it("solve mode sizes machines around the same proportions", () => {
    const project = board([3, 1]);
    project.solveMode = true;
    project.storages!.find((s) => s.id === "out1")!.targetPerSecond = 10;
    const result = run(project);
    expect(result.edges.branch0.transferredPerSecond).toBeCloseTo(30, 3);
    expect(result.edges.branch1.transferredPerSecond).toBeCloseTo(10, 3);
    expect(result.nodes.maker.theoreticalMachinesRequired).toBeCloseTo(0.4, 3);
  });
  it("treats a shared machine's channel as one branch, without pinning its recipe mix", () => {
    const project = board([1, 3, 4]);
    project.nodes.find((n) => n.id === "line0")!.extraRecipes = [{ recipeId: "line1" }];
    project.nodes = project.nodes.filter((n) => n.id !== "line1");
    project.edges = project.edges
      .filter((e) => e.id !== "end1")
      .map((e) =>
        e.id === "branch1" ? { ...e, target: "line0", targetHandle: "r1:input:item:iron" } : e,
      );
    const result = run(project);
    expect(result.edges.branch0.transferredPerSecond).toBeCloseTo(50, 3);
    expect(result.edges.branch1.transferredPerSecond).toBeCloseTo(0, 3);
    expect(result.edges.branch2.transferredPerSecond).toBeCloseTo(50, 3);
  });
  it("changes a whole channel in one undo step and respects read-only plans", () => {
    useFactoryStore.getState().setProject(board());
    const history = useFactoryStore.getState().undoHistory.length;
    useFactoryStore.getState().setRatioBranchWeight("split", ["branch0"], 1000);
    expect(useFactoryStore.getState().undoHistory.length).toBe(history + 1);
    expect(
      useFactoryStore.getState().project.edges.find((e) => e.id === "branch0")!.ratioWeight,
    ).toBe(1000);
    useFactoryStore.getState().undo();
    expect(
      useFactoryStore.getState().project.edges.find((e) => e.id === "branch0")!.ratioWeight,
    ).toBe(1);
    useFactoryStore.getState().redo();
    expect(
      useFactoryStore.getState().project.edges.find((e) => e.id === "branch0")!.ratioWeight,
    ).toBe(1000);
    const current = useFactoryStore.getState().project;
    useFactoryStore.setState({ isReadOnly: true });
    try {
      useFactoryStore.getState().setRatioBranchWeight("split", ["branch0"], 20);
      expect(useFactoryStore.getState().project).toBe(current);
    } finally {
      useFactoryStore.setState({ isReadOnly: false });
    }
  });
  it("leaving ratio mode restores ordinary throughput and keeps the weights", () => {
    const project = board([1, 1]);
    project.nodes[2].machineCount = 0.1;
    project.storages![1].bufferMode = "strict";
    const result = run(project);
    expect(result.nodes.maker.utilization).toBeCloseTo(1, 3);
    expect(result.edges.branch0.transferredPerSecond).toBeCloseTo(90, 3);
    expect(project.edges.find((e) => e.id === "branch1")!.ratioWeight).toBe(1);
  });
  it("inserting a drawer into a ratio branch preserves its upstream parts", () => {
    useFactoryStore.getState().setProject(board([1000, 20]));
    useFactoryStore
      .getState()
      .insertStorageOnEdge(["branch0"], { x: 200, y: 200 }, { kind: "item", id: "iron" });
    const project = useFactoryStore.getState().project;
    const replaced = project.edges.find((e) => e.source === "split" && e.id !== "branch1")!;
    expect(replaced.ratioWeight).toBe(1000);
    expect(run(project).edges.branch1.transferredPerSecond).toBeCloseTo((100 * 20) / 1020, 3);
  });
  it("survives schema validation and saved-plan normalization", () => {
    const saved = JSON.parse(JSON.stringify(board([1000, 20])));
    const restored = normalizeLoadedProject(factoryProjectSchema.parse(saved));
    expect(restored.storages!.find((s) => s.id === "split")!.bufferMode).toBe("ratio");
    expect(restored.edges.find((e) => e.id === "branch0")!.ratioWeight).toBe(1000);
    expect(run(restored).edges.branch1.transferredPerSecond).toBeCloseTo((100 * 20) / 1020, 3);
  });
  it("rejects invalid saved weights and formats extreme finite parts", () => {
    const edge = board().edges[2];
    for (const ratioWeight of [-1, Infinity, NaN])
      expect(factoryEdgeSchema.safeParse({ ...edge, ratioWeight }).success).toBe(false);
    const branches = getProjectRatioBranches(board([1e308, 1e308])).get("split")!;
    expect(branches.map((b) => b.share)).toEqual([0.5, 0.5]);
    expect(formatRatioShare(0.0000001)).toBe("<0.01%");
    expect(formatRatioShare(0)).toBe("0%");
  });
  it("pool mode leaves the dormant manual split alone", () => {
    const project = board();
    project.poolMode = true;
    expect(getProjectRatioBranches(project).size).toBe(0);
  });
});

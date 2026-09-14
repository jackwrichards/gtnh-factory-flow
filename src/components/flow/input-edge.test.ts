import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject, type Recipe } from "@/lib/model/types";
import { calculateThroughput } from "@/lib/solver/throughput";
import { buildLimitLadder, buildRailPorts, deriveNodeVerdict, findUnwiredNodeIds } from "./node-verdict";
import { buildPortBreakdown, explainPort } from "./flow-explainers";
import { makeResourceHandleId } from "./resource-handles";

function board(fluidToCell: boolean, ratio: number, supply: number): FactoryProject {
  // The encoded item id is the Nitric Acid Cell in the reported shared plan.
  const fluid = { kind: "fluid" as const, id: "nitricacid" };
  const cell = { kind: "item" as const, id: "gregtech:gt.metaitem.01@30653" };
  const from = fluidToCell ? fluid : cell;
  const to = fluidToCell ? cell : fluid;
  const recipes: Recipe[] = [
    { id: "source", name: "Source", machineType: "Bender", minimumTier: "LV", durationTicks: 20, eut: 30,
      inputs: [], outputs: [{ ...from, amount: supply * (fluidToCell ? ratio : 1) }] },
    { id: "sink", name: "Sink", machineType: "Bender", minimumTier: "LV", durationTicks: 20, eut: 30,
      inputs: [{ ...to, amount: fluidToCell ? 1 : ratio }], outputs: [{ kind: "item", id: "product", amount: 1 }] },
  ];
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION, id: "cross-form-rails", name: "Cross-form rails", fuelProfiles: [], recipes,
    nodes: recipes.map(r => ({ id: r.id, recipeId: r.id, machineCount: 1, parallel: 1, overclockTier: "LV", enabled: true, position: { x: 0, y: 0 } })),
    storages: [{ id: "product", kind: "item", resourceId: "product", position: { x: 0, y: 0 } }],
    edges: [
      { id: "wire", source: "source", target: "sink", resourceKind: from.kind, resourceId: from.id,
        sourceHandle: makeResourceHandleId("output", from), targetHandle: makeResourceHandleId("input", to), crossForm: { litresPerCell: ratio } },
      { id: "out", source: "sink", target: "product", resourceKind: "item", resourceId: "product" },
    ],
  };
}

function inspect(p: FactoryProject) {
  const result = calculateThroughput(p);
  const verdict = deriveNodeVerdict(p, result, "sink");
  const port = buildRailPorts(p, result, "sink", p.recipes[1]!, verdict).inputs[0]!;
  return { result, verdict, port };
}

describe.each([true, false])("cross-form input diagnostics (fluid to cell: %s)", fluidToCell => {
  it.each([1000, 250])("counts a wired input and reports its own units at %s L/cell", ratio => {
    const p = board(fluidToCell, ratio, 2);
    const { result, verdict, port } = inspect(p);
    const inputRate = fluidToCell ? 1 : ratio;
    expect(port.connected).toBe(true);
    expect(port.unsupplied).toBe(false);
    expect(port.currentPerSecond).toBeCloseTo(inputRate);
    expect(port.couldPerSecond).toBeCloseTo(2 * inputRate);
    expect(findUnwiredNodeIds(p, result).includes("sink")).toBe(false);
    expect(buildLimitLadder(p, result, "sink").some(r => r.label.includes("no supply"))).toBe(false);
    expect(explainPort(p, result, "sink", port, verdict).stateWord).not.toBe("NO SUPPLY");
    const breakdown = buildPortBreakdown(p, result, "sink", port)!;
    expect(breakdown.rows).toHaveLength(1);
    expect(breakdown.routedPerSecond).toBeCloseTo(inputRate);
    expect(breakdown.rows[0]!.ratePerSecond).toBeCloseTo(inputRate);
    // The visible wire and source port retain the source's units.
    expect(result.edges.wire!.transferredPerSecond).toBeCloseTo(fluidToCell ? ratio : 1);
    const sourcePort = buildRailPorts(p, result, "source", p.recipes[0]!, deriveNodeVerdict(p, result, "source")).outputs[0]!;
    expect(sourcePort.currentPerSecond).toBeCloseTo(fluidToCell ? ratio : 1);
  });

  it("names a connected shortage in input units and suggests the right source count", () => {
    const p = board(fluidToCell, 1000, 0.5);
    const { result, verdict, port } = inspect(p);
    const inputRate = fluidToCell ? 1 : 1000;
    expect(port.unsupplied).toBe(false);
    expect(port.currentPerSecond).toBeCloseTo(inputRate / 2);
    expect(verdict.binding?.suppliedPerSecond).toBeCloseTo(inputRate / 2);
    expect(verdict.binding?.shortfallPerSecond).toBeCloseTo(inputRate / 2);
    expect(verdict.binding?.upstream?.machinesToAdd).toBe(1);
    expect(buildLimitLadder(p, result, "sink").some(r => Math.abs(r.pct - 50) < 0.01)).toBe(true);
  });

  it("does not credit the source form to a second input on the same machine", () => {
    const p = board(fluidToCell, 1000, 2);
    const source = p.recipes[0]!.outputs[0]!;
    p.recipes[1]!.inputs.push({ ...source, amount: 1 });
    const { result, verdict } = inspect(p);
    const ports = buildRailPorts(p, result, "sink", p.recipes[1]!, verdict).inputs;
    const unwired = ports.find(port => port.kind === source.kind && port.resourceId === source.id)!;
    expect(unwired.unsupplied).toBe(true);
    expect(buildPortBreakdown(p, result, "sink", unwired)).toBeUndefined();
  });

  it("does not invent a conversion for a wire without its saved ratio", () => {
    const p = board(fluidToCell, 1000, 2);
    delete p.edges[0]!.crossForm;
    expect(inspect(p).port.unsupplied).toBe(true);
  });
});

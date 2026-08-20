// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NodeThroughputResult, ResourceFlow, ThroughputResult } from "@/lib/model/types";
import { useFactoryStore } from "@/store/factory-store";
import { PowerBalanceBlock } from "./PowerBalanceBlock";

function energyFlow(tierId: string, amountPerSecond: number): ResourceFlow {
  return {
    key: `energy:${tierId}`,
    kind: "energy",
    resourceId: tierId,
    displayName: `Energy (${tierId.toUpperCase()})`,
    amountPerSecond,
  } as unknown as ResourceFlow;
}

function machineResult(
  id: string,
  utilization: number,
  inputs: Record<string, number> = {},
  outputs: Record<string, number> = {},
): NodeThroughputResult {
  const flow = (amounts: Record<string, number>): Record<string, ResourceFlow> =>
    Object.fromEntries(
      Object.entries(amounts).map(([key, amount]) => [key, energyFlow(key.slice("energy:".length), amount)]),
    );
  return {
    nodeId: id,
    recipeId: "r",
    recipeName: "Machine",
    enabled: true,
    operationRatePerSecond: 1,
    inputs: flow(inputs),
    outputs: flow(outputs),
    euT: 0,
    powerStalled: false,
    requiredRatePerSecond: 0,
    maxRatePerSecond: 0,
    utilization,
    theoreticalMachinesRequired: 0,
    status: "underutilized",
    warnings: [],
  };
}

function seed(nodes: NodeThroughputResult[]) {
  useFactoryStore.setState({
    lastResult: {
      ...useFactoryStore.getState().lastResult,
      nodes: Object.fromEntries(nodes.map((node) => [node.nodeId, node])),
    } as ThroughputResult,
  });
}

describe("PowerBalanceBlock", () => {
  afterEach(cleanup);

  beforeEach(() => {
    useFactoryStore.setState({ selectedBoardIds: [] });
  });

  it("sums the whole grid: one demand row reads a deficit", () => {
    seed([machineResult("M", 1, { "energy:lv": 200 })]);
    render(<PowerBalanceBlock />);

    expect(screen.getByText("Grids")).toBeDefined();
    // 200 in, 0 out: the collapsed line says the number short, not the net.
    expect(screen.getByText(/−200/)).toBeDefined();
  });

  it("shows a per-grid row when opened, and calls a covered grid supplied", () => {
    seed([
      machineResult("G", 1, {}, { "energy:lv": 12800 }),
      machineResult("M", 1, { "energy:lv": 200 }),
    ]);
    render(<PowerBalanceBlock />);

    expect(screen.getByText("Grids")).toBeDefined();
    fireEvent.click(screen.getByText("Grids"));

    expect(screen.getByText("LV")).toBeDefined();
    expect(screen.getByText(/12\.8k in \/ 200 out/)).toBeDefined();
    expect(screen.getByText("supplied")).toBeDefined();
  });

  it("stays out of the list when nothing trades energy", () => {
    seed([machineResult("M", 1)]);
    render(<PowerBalanceBlock />);

    expect(screen.queryByText("Grids")).toBeNull();
  });
});

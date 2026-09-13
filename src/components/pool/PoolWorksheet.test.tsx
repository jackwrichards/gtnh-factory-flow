// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PoolWorksheet } from "./PoolWorksheet";
import { useFactoryStore } from "@/store/factory-store";
import { DEFAULT_WORKSPACE_VIEW, writeWorkspaceView } from "@/lib/workspace-view";
import { PROJECT_SCHEMA_VERSION, type FactoryProject } from "@/lib/model/types";

function fixture(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "worksheet-ui",
    name: "Worksheet UI",
    solveMode: true,
    poolMode: true,
    fuelProfiles: [],
    edges: [],
    recipes: [
      {
        id: "plate",
        name: "Copper Plate",
        machineType: "Bender",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 8,
        inputs: [{ kind: "item", id: "copper", displayName: "Copper Ingot", amount: 1 }],
        outputs: [{ kind: "item", id: "plate", displayName: "Copper Plate", amount: 1 }],
      },
    ],
    nodes: [
      {
        id: "machine",
        recipeId: "plate",
        machineCount: 1,
        overclockTier: "LV",
        parallel: 1,
        enabled: true,
        position: { x: 200, y: 100 },
      },
    ],
    storages: [
      {
        id: "product",
        kind: "item",
        resourceId: "plate",
        displayName: "Copper Plate",
        poolSide: "drain",
        drainMode: "product",
        targetPerSecond: 0.5,
        position: { x: 800, y: 100 },
      },
    ],
  };
}

beforeEach(() => {
  writeWorkspaceView({ ...DEFAULT_WORKSPACE_VIEW, poolWorksheet: true });
  useFactoryStore.setState({ isReadOnly: false, checklistMode: false });
  useFactoryStore.getState().setProject(fixture());
});
afterEach(() => {
  cleanup();
  useFactoryStore.setState({ isReadOnly: false });
});

describe("Pool worksheet", () => {
  it("places product targets and resources together above recipe rows", () => {
    const { container } = render(<PoolWorksheet />);
    const summary = container.querySelector(".pool-sheet-summary")!;
    expect(summary.querySelector(".pool-sheet-products")).not.toBeNull();
    expect(summary.contains(screen.getByRole("table", { name: "Pool resource balance" }))).toBe(
      true,
    );
    const recipes = screen.getByRole("table", { name: "Recipes running in the pool" });
    expect(
      summary.compareDocumentPosition(recipes) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container.querySelector(".pool-editor-row")).toBeNull();
  });
  it("filters and switches views without changing the plan, books or undo history", () => {
    const { project, lastResult, undoHistory } = useFactoryStore.getState();
    render(<PoolWorksheet />);
    expect(screen.getByRole("table", { name: "Recipes running in the pool" })).toBeDefined();
    fireEvent.change(screen.getByRole("textbox", { name: "Filter worksheet" }), {
      target: { value: "not present" },
    });
    expect(screen.getByText("No recipes match this filter.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Canvas" }));
    const after = useFactoryStore.getState();
    expect(after.project).toBe(project);
    expect(after.lastResult).toBe(lastResult);
    expect(after.undoHistory).toBe(undoHistory);
    expect(
      JSON.parse(localStorage.getItem("gtnh-factory-flow-workspace-view")!).poolWorksheet,
    ).toBe(false);
  });

  it("edits the real product target and supports undo", () => {
    render(<PoolWorksheet />);
    fireEvent.click(screen.getByRole("button", { name: "Required amount" }));
    const input = screen.getByRole("textbox", { name: "Required amount" });
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.blur(input);
    expect(useFactoryStore.getState().project.storages?.[0].targetPerSecond).toBe(2);
    expect(
      useFactoryStore.getState().lastResult.nodes.machine.theoreticalMachinesRequired,
    ).toBeCloseTo(2);
    act(() => useFactoryStore.getState().undo());
    expect(useFactoryStore.getState().project.storages?.[0].targetPerSecond).toBe(0.5);
  });

  it("uses the real machine editor without mounting React Flow handles", () => {
    const { container } = render(<PoolWorksheet />);

    expect(container.querySelector(".react-flow__handle")).toBeNull();

    const pin = screen.getByRole("textbox", { name: "Pinned machine count" });
    fireEvent.change(pin, { target: { value: "1.25" } });
    fireEvent.blur(pin);
    expect(useFactoryStore.getState().project.nodes[0].solvePin).toBe(1.25);
    fireEvent.click(screen.getByRole("button", { name: "Increase machine tier" }));
    expect(useFactoryStore.getState().project.nodes[0].overclockTier).toBe("MV");
    expect(container.querySelector(".react-flow__handle")).toBeNull();
  });

  it("browses from a concrete row with its owner context", () => {
    const { container } = render(<PoolWorksheet />);
    const row = container.querySelector('[data-worksheet-node="machine"]')!;
    fireEvent.contextMenu(within(row as HTMLElement).getByRole("button", { name: "Copper Ingot" }));
    expect(useFactoryStore.getState().recipeBrowserResource).toMatchObject({
      id: "copper",
      anchorNodeId: "machine",
    });
    expect(useFactoryStore.getState().recipeBrowserMode).toBe("uses");
  });

  it("keeps public views read-only while allowing inspection and view changes", () => {
    useFactoryStore.setState({ isReadOnly: true });
    const { project } = useFactoryStore.getState();
    const { container } = render(<PoolWorksheet />);
    expect(screen.queryByRole("button", { name: "Required amount" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove machine" })).toBeNull();

    expect((container.querySelector("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    expect(useFactoryStore.getState().project).toBe(project);
    fireEvent.click(screen.getByRole("button", { name: "Canvas" }));
    expect(useFactoryStore.getState().project).toBe(project);
  });
});

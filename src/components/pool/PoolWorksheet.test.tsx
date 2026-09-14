// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PoolWorksheet } from "./PoolWorksheet";
import { useFactoryStore } from "@/store/factory-store";
import { DEFAULT_WORKSPACE_VIEW, writeWorkspaceView } from "@/lib/workspace-view";
import { PROJECT_SCHEMA_VERSION, type FactoryProject } from "@/lib/model/types";

vi.mock("../ItemPickerPopover", () => ({
  ItemPickerPopover: ({
    onPick,
  }: {
    onPick: (entry: { kind: "item"; id: string; displayName: string }) => void;
  }) => (
    <button onClick={() => onPick({ kind: "item", id: "copper", displayName: "Copper Ingot" })}>
      Pick Copper Ingot
    </button>
  ),
}));

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
  it("opens the machine chooser outside the canvas and applies the selected machine", async () => {
    const project = fixture();
    project.recipes[0].machineHandlers = [
      {
        id: "basic",
        label: "Basic Bender",
        machineType: "Bender",
        kind: "single",
        minimumTier: "LV",
      },
      {
        id: "industrial",
        label: "Industrial Bender",
        machineType: "Industrial Bender",
        kind: "multiblock",
        minimumTier: "LV",
      },
    ];
    useFactoryStore.getState().setProject(project);
    const { container } = render(<PoolWorksheet />);
    fireEvent.click(container.querySelector("[data-machine-menu-toggle]")!);
    const menu = await screen.findByRole("listbox", { name: "Machine" });
    fireEvent.click(within(menu).getByRole("option", { name: /Industrial Bender/ }));
    expect(useFactoryStore.getState().project.nodes[0].machineHandlerId).toBe("industrial");
    expect(screen.queryByRole("listbox", { name: "Machine" })).toBeNull();
  });

  it("keeps summary sections fixed, uses signed inspector rates, and separates power", () => {
    const { container } = render(<PoolWorksheet />);
    expect(screen.queryByRole("button", { name: /Reorder .* panel/ })).toBeNull();
    const table = screen.getByRole("table", { name: "Pool resource balance" });
    expect(within(table).getByRole("columnheader", { name: "Name" })).toBeTruthy();
    const input = container.querySelector(
      '[data-worksheet-resource="item:copper"] .pool-flow-input',
    )!;
    expect(input.textContent).toBe("−0.5/s");
    const output = container.querySelector(
      '[data-worksheet-resource="item:plate"] .pool-flow-output',
    )!;
    expect(output.textContent).toBe("+0.5/s");
    const power = screen.getByRole("table", { name: "Pool power totals" });
    const totals = power.textContent;
    fireEvent.change(screen.getByRole("textbox", { name: "Filter worksheet" }), {
      target: { value: "not present" },
    });
    expect(power.textContent).toBe(totals);
  });

  it("drags a recipe item into Products using the normal drawer action and undo", () => {
    const { container } = render(<PoolWorksheet />);
    const values = new Map<string, string>();
    const transfer = {
      get types() {
        return [...values.keys()];
      },
      setData: (kind: string, value: string) => values.set(kind, value),
      getData: (kind: string) => values.get(kind) ?? "",
    };
    const row = container.querySelector('[data-worksheet-node="machine"]') as HTMLElement;
    fireEvent.dragStart(within(row).getByRole("button", { name: "Copper Ingot" }), {
      dataTransfer: transfer,
    });
    const products = screen.getByLabelText("Products drop zone");
    fireEvent.dragOver(products, { dataTransfer: transfer });
    fireEvent.drop(products, { dataTransfer: transfer });
    expect(useFactoryStore.getState().project.storages).toHaveLength(2);
    expect(useFactoryStore.getState().project.storages?.[1]).toMatchObject({
      resourceId: "copper",
      poolSide: "drain",
    });
    fireEvent.drop(products, { dataTransfer: transfer });
    expect(useFactoryStore.getState().project.storages).toHaveLength(2);
    act(() => useFactoryStore.getState().undo());
    expect(useFactoryStore.getState().project.storages).toHaveLength(1);
  });

  it("reorders machine rows without changing the plan, solve or canvas positions", () => {
    const project = fixture();
    project.nodes.push({ ...project.nodes[0], id: "second", position: { x: 800, y: 400 } });
    useFactoryStore.getState().setProject(project);
    const before = useFactoryStore.getState();
    const { container } = render(<PoolWorksheet />);
    const values = new Map<string, string>();
    const transfer = {
      get types() {
        return [...values.keys()];
      },
      setData: (kind: string, value: string) => values.set(kind, value),
      getData: (kind: string) => values.get(kind) ?? "",
    };
    fireEvent.dragStart(screen.getAllByRole("button", { name: /Reorder machine/ })[1], {
      dataTransfer: transfer,
    });
    const target = container.querySelector('[data-worksheet-node="machine"]')!;
    fireEvent.dragOver(target, { dataTransfer: transfer, clientY: 10 });
    fireEvent.drop(target, { dataTransfer: transfer });
    expect(
      [...container.querySelectorAll("[data-worksheet-node]")].map((row) =>
        row.getAttribute("data-worksheet-node"),
      ),
    ).toEqual(["second", "machine"]);
    expect(useFactoryStore.getState().project).toBe(before.project);
    expect(useFactoryStore.getState().lastResult).toBe(before.lastResult);
    expect(useFactoryStore.getState().undoHistory).toBe(before.undoHistory);
    expect(
      JSON.parse(localStorage.getItem("gtnh-factory-flow-workspace-view")!).poolWorksheetOrder[
        "worksheet-ui:machines"
      ],
    ).toEqual(["second", "machine"]);
  });

  it("adds a product directly from the Products plus button", () => {
    render(<PoolWorksheet />);
    fireEvent.click(screen.getByRole("button", { name: "Add product" }));
    fireEvent.click(screen.getByRole("button", { name: "Pick Copper Ingot" }));
    expect(useFactoryStore.getState().project.storages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceId: "copper", poolSide: "drain" }),
      ]),
    );
    expect(screen.queryByRole("button", { name: "Pick Copper Ingot" })).toBeNull();
    act(() => useFactoryStore.getState().undo());
    expect(useFactoryStore.getState().project.storages).toHaveLength(1);
  });

  it("shows resources independently of the canvas's hidden and favourite preferences", () => {
    writeWorkspaceView({
      favouritesOnly: true,
      favouriteResourceKeys: [],
      hiddenResourceKeys: ["item:copper"],
    });
    render(<PoolWorksheet />);
    const resources = screen.getByRole("table", { name: "Pool resource balance" });
    expect(within(resources).getByRole("button", { name: "Copper Ingot" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Show only favourite resources" })).toBeNull();
  });
  it("uses the canvas circuit slot and keeps the programmed circuit out of Takes", () => {
    const project = fixture();
    project.recipes[0].kind = "gregtech_machine";
    project.recipes[0].programmedCircuit = "11";
    project.recipes[0].inputs.push({
      kind: "item",
      id: "gregtech:gt.integrated_circuit@11",
      displayName: "Programmed Circuit",
      amount: 1,
      consumed: false,
    });
    useFactoryStore.getState().setProject(project);
    const { container } = render(<PoolWorksheet />);
    expect(
      container.querySelector('.pool-circuit-cell [aria-label="Programmed circuit 11"]'),
    ).not.toBeNull();
    expect(container.querySelector('.pool-port-list [title="Programmed Circuit"]')).toBeNull();
    act(() => useFactoryStore.getState().setProject(fixture()));
    expect(
      container.querySelector('.pool-circuit-cell [aria-label="No circuit setting"]'),
    ).not.toBeNull();
  });

  it("renders the full multiblock picture without enable/disable controls", () => {
    const project = fixture();
    project.recipes[0].machineHandlers = [
      {
        id: "electric-blast-furnace",
        label: "Electric Blast Furnace",
        machineType: "Electric Blast Furnace",
        kind: "multiblock",
        minimumTier: "LV",
      },
    ];
    useFactoryStore.getState().setProject(project);
    const { container } = render(<PoolWorksheet />);
    expect(
      container.querySelector(
        '.pool-picture-cell img[src="/power-art/electric-blast-furnace.png"]',
      ),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Disable machine" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Enable machine" })).toBeNull();
  });
  it("edits machine-specific settings below the machine and omits empty settings sections", () => {
    const project = fixture();
    project.recipes[0].machineConfigControls = [
      {
        id: "solenoidCoil",
        label: "Solenoid",
        defaultKey: "lv",
        minimumKey: "lv",
        tiers: [
          { key: "lv", label: "LV", resource: { kind: "item", id: "lv-solenoid", amount: 1 } },
          { key: "mv", label: "MV", resource: { kind: "item", id: "mv-solenoid", amount: 1 } },
        ],
      },
    ];
    useFactoryStore.getState().setProject(project);
    const { container } = render(<PoolWorksheet />);
    const settings = container.querySelector(".pool-settings-section") as HTMLElement;
    fireEvent.click(within(settings).getByRole("button", { name: "Next Solenoid" }));
    expect(useFactoryStore.getState().project.nodes[0].machineConfigTiers?.solenoidCoil).toBe("mv");
    expect(container.querySelector(".pool-machine-cell")?.contains(settings)).toBe(true);
    expect(screen.queryByRole("columnheader", { name: "Settings" })).toBeNull();
    act(() => useFactoryStore.getState().undo());
    expect(
      useFactoryStore.getState().project.nodes[0].machineConfigTiers?.solenoidCoil,
    ).toBeUndefined();
    expect(
      fireEvent.wheel(within(settings).getByRole("button", { name: "Next Solenoid" }), {
        deltaY: -100,
        cancelable: true,
      }),
    ).toBe(false);
    expect(useFactoryStore.getState().project.nodes[0].machineConfigTiers?.solenoidCoil).toBe("mv");
    expect(
      fireEvent.wheel(container.querySelector(".pool-sheet-scroll")!, {
        deltaY: 100,
        cancelable: true,
      }),
    ).toBe(true);
    act(() => useFactoryStore.getState().setProject(fixture()));
    expect(container.querySelector(".pool-settings-section")).toBeNull();
  });
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
  it("filters without changing the plan, books or undo history", () => {
    const { project, lastResult, undoHistory } = useFactoryStore.getState();
    render(<PoolWorksheet />);
    expect(screen.getByRole("table", { name: "Recipes running in the pool" })).toBeDefined();
    fireEvent.change(screen.getByRole("textbox", { name: "Filter worksheet" }), {
      target: { value: "not present" },
    });
    expect(screen.getByText("No recipes match this filter.")).toBeDefined();

    const after = useFactoryStore.getState();
    expect(after.project).toBe(project);
    expect(after.lastResult).toBe(lastResult);
    expect(after.undoHistory).toBe(undoHistory);
    expect(
      JSON.parse(localStorage.getItem("gtnh-factory-flow-workspace-view")!).poolWorksheet,
    ).toBe(true);
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

    fireEvent.click(screen.getByRole("button", { name: "Pin a machine count" }));
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

  it("keeps public views read-only while allowing inspection", () => {
    useFactoryStore.setState({ isReadOnly: true });
    const { project } = useFactoryStore.getState();
    const { container } = render(<PoolWorksheet />);
    expect(screen.queryByRole("button", { name: "Required amount" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove machine" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add product" })).toBeNull();

    expect((container.querySelector("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    expect(useFactoryStore.getState().project).toBe(project);

    expect(useFactoryStore.getState().project).toBe(project);
  });
});

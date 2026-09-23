// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductionScopeHeader } from "./ProductionGroups";
import { PoolWorksheet } from "./PoolWorksheet";
import { playBoardSound } from "@/lib/board-sounds";
vi.mock("@/lib/board-sounds", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/board-sounds")>(),
  playBoardSound: vi.fn(),
}));
const dragSounds = () => vi.mocked(playBoardSound).mock.calls.map(([kind]) => kind);
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

function pointerDrop(source: HTMLElement, target: Element, cancel = false) {
  const root = source.closest(".pool-worksheet");
  const original = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => target });
  const box = vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ top: 0, height: 100 } as DOMRect);
  const pointer = (type: string, receiver: HTMLElement | Window, x: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
    Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: "mouse" } });
    fireEvent(receiver, event);
  };
  try {
    pointer("pointerdown", source, 1, 1);
    pointer("pointermove", window, 30, 20);
    pointer("pointermove", window, 32, 22);
    pointer("pointermove", window, 34, 24);
    expect(document.querySelector(".pool-drag-preview")).not.toBeNull();
    expect(root?.hasAttribute("data-resource-dragging")).toBe(source.matches(".pool-resource-link, .pool-material-rate, .pool-scope-material"));
    if (cancel) fireEvent.keyDown(window, { key: "Escape" });
    pointer("pointerup", window, 30, 20);
    expect(document.querySelector(".pool-drag-preview")).toBeNull();
    expect(root?.hasAttribute("data-resource-dragging")).toBe(false);
    fireEvent.click(source);
  } finally {
    box.mockRestore();
    if (original) Object.defineProperty(document, "elementFromPoint", original);
    else Reflect.deleteProperty(document, "elementFromPoint");
  }
}
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
  writeWorkspaceView({ ...DEFAULT_WORKSPACE_VIEW });
  useFactoryStore.setState({ isReadOnly: false, checklistMode: false });
  useFactoryStore.getState().setProject(fixture());
  useFactoryStore.getState().clearResourceBrowser();
  vi.mocked(playBoardSound).mockClear();
});
afterEach(() => {
  cleanup();
  useFactoryStore.setState({ isReadOnly: false });
});

describe("Pool worksheet", () => {
  it("folds all shared recipes without changing the plan and remembers the view", () => {
    const project = fixture();
    project.recipes.push({ ...project.recipes[0], id: "foil", name: "Copper Foil",
      outputs: [{ kind: "item", id: "foil", displayName: "Copper Foil", amount: 1 }] });
    project.nodes[0].extraRecipes = [{ recipeId: "foil" }];
    project.nodes[0].solvePin = 2;
    useFactoryStore.getState().setProject(project);
    useFactoryStore.setState({ isReadOnly: true });
    const before = useFactoryStore.getState().project;
    const view = render(<PoolWorksheet />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse Bender" }));
    const row = view.container.querySelector('[data-worksheet-node="machine"]')!;
    expect(row.querySelectorAll("tr")).toHaveLength(1);
    expect(row.querySelector(".pool-machine-count")?.textContent).toContain("×2");
    expect(row.querySelector(".pool-status-cell")).not.toBeNull();
    expect(row.querySelector(".pool-port-rate")).toBeNull();
    expect(row.querySelectorAll(".pool-port-list .pool-resource-link").length).toBeGreaterThan(0);
    expect(within(row as HTMLElement).getByRole("button", { name: "Copper Foil" })).toBeTruthy();
    expect(useFactoryStore.getState().project).toBe(before);
    view.unmount();
    const restored = render(<PoolWorksheet />);
    fireEvent.click(screen.getByRole("button", { name: "Expand Bender" }));
    expect(restored.container.querySelectorAll('[data-worksheet-node="machine"] tr')).toHaveLength(2);
    expect(useFactoryStore.getState().project).toBe(before);
  });

  it("keeps each shared recipe's status beside its circuit and removal on the right", () => {
    const project = fixture();
    project.recipes.push({ ...project.recipes[0], id: "foil", name: "Copper Foil" });
    project.nodes[0].extraRecipes = [{ recipeId: "foil" }];
    useFactoryStore.getState().setProject(project);
    const { container } = render(<PoolWorksheet />);
    const machine = container.querySelector(".pool-machine-cell")!;
    expect(machine.getAttribute("rowspan")).toBe("2");
    expect(screen.getByRole("columnheader", { name: "Tier" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Count" })).toBeTruthy();
    for (const column of [".pool-tier-cell", ".pool-count-cell"]) {
      expect(container.querySelector(column)?.getAttribute("rowspan")).toBe("2");
    }
    expect(machine.querySelector(".pool-status")).toBeNull();
    const statuses = container.querySelectorAll(".pool-status-cell");
    expect(statuses).toHaveLength(2);
    for (const cell of statuses) {
      expect(cell.querySelectorAll(".pool-status")).toHaveLength(1);
      expect(cell.nextElementSibling?.classList.contains("pool-circuit-cell")).toBe(true);
    }
    fireEvent.click(within(statuses[1].parentElement!).getByRole("button", {
      name: "Remove recipe 2 from shared machine",
    }));
    expect(useFactoryStore.getState().project.nodes[0].recipeId).toBe("plate");
    expect(useFactoryStore.getState().project.nodes[0].extraRecipes ?? []).toHaveLength(0);
    expect(container.querySelectorAll(".pool-status-cell")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Remove recipe .* from shared machine/ })).toBeNull();
  });

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
    render(<PoolWorksheet />);
    expect(screen.queryByRole("button", { name: /Reorder .* panel/ })).toBeNull();
    const inputs = screen.getByRole("region", { name: "Materials for All production" });
    const outputs = screen.getByRole("region", { name: "Materials for All production" });
    expect(within(inputs).getByRole("button", { name: "Copper Ingot" })).toBeTruthy();
    expect(within(inputs).getByLabelText("Copper Ingot: net input 0.5/s").textContent).toBe("−0.5/s");
    expect(within(outputs).getByRole("button", { name: "Copper Plate" })).toBeTruthy();
    expect(within(outputs).getByLabelText("Copper Plate: net output 0.5/s").textContent).toBe("+0.5/s");
    const inputTable = within(inputs).getByRole("table", { name: "Inputs for All production" });
    const outputTable = within(outputs).getByRole("table", { name: "Outputs for All production" });
    expect(within(inputTable).getByRole("button", { name: "Copper Ingot" })).toBeTruthy();
    expect(within(inputTable).queryByRole("button", { name: "Copper Plate" })).toBeNull();
    expect(within(outputTable).getByRole("button", { name: "Copper Plate" })).toBeTruthy();
    expect(within(inputTable).getByRole("button", { name: "Balance Copper Ingot in All production" })).toBeTruthy();
    expect(screen.queryByText(/Net:/)).toBeNull();
    expect(screen.queryByRole("table", { name: "Pool resource balance" })).toBeNull();
    const power = screen.getByRole("region", { name: "Pool power summary" });
    const totals = power.textContent;
    fireEvent.keyDown(document, { key: "f", ctrlKey: true });
    fireEvent.change(screen.getByRole("textbox", { name: "Filter worksheet" }), {
      target: { value: "not present" },
    });
    expect(power.textContent).toBe(totals);
  });

  it("bounds tiny target text but preserves the exact amount when editing", () => {
    const project = fixture();
    project.storages![0].targetPerSecond = 0.000000084;
    useFactoryStore.getState().setProject(project);
    render(<PoolWorksheet />);
    const target = screen.getByRole("button", { name: "Required amount" });
    expect(target.textContent).toContain("<.001");
    fireEvent.click(target);
    const field = screen.getByRole("textbox", { name: "Required amount" }) as HTMLInputElement;
    expect(Number(field.value)).toBe(0.000000084);
    fireEvent.blur(field);
    expect(useFactoryStore.getState().project.storages![0].targetPerSecond).toBe(0.000000084);
  });
  it("drags a recipe item into Products using the normal drawer action and undo", () => {
    const { container } = render(<PoolWorksheet />);
    const row = container.querySelector('[data-worksheet-node="machine"]') as HTMLElement;
    const item = within(row).getByRole("button", { name: "Copper Ingot" });
    const products = screen.getByLabelText("Desired rates drop zone");
    pointerDrop(item, products, true);
    expect(dragSounds()).toEqual(["pageOpen", "snap", "pageClose"]);
    vi.mocked(playBoardSound).mockClear();
    expect(useFactoryStore.getState().project.storages).toHaveLength(1);
    pointerDrop(item, products);
    expect(dragSounds()).toEqual(["pageOpen", "snap", "shuffle"]);
    vi.mocked(playBoardSound).mockClear();
    expect(useFactoryStore.getState().project.storages).toHaveLength(2);
    expect(useFactoryStore.getState().project.storages?.[1]).toMatchObject({
      resourceId: "copper",
      poolSide: "drain",
    });
    pointerDrop(item, products);
    expect(dragSounds()).toEqual(["pageOpen", "snap", "error"]);
    vi.mocked(playBoardSound).mockClear();
    pointerDrop(item, row);
    expect(dragSounds()).toEqual(["pageOpen", "error"]);
    expect(useFactoryStore.getState().project.storages).toHaveLength(2);
    act(() => useFactoryStore.getState().undo());
    expect(useFactoryStore.getState().project.storages).toHaveLength(1);
  });

  it.each(["rate", "space"])("drags a material by its %s without browsing or changing Balance", (pickup) => {
    const { container } = render(<PoolWorksheet />);
    const material = container.querySelector<HTMLElement>('.pool-scope-material[data-material-key="item:copper"]')!;
    const source = pickup === "rate" ? material.querySelector<HTMLElement>(".pool-material-rate")! : material;
    const zone = screen.getByLabelText("Desired rates drop zone");
    pointerDrop(source, zone, true);
    expect(useFactoryStore.getState().project.storages).toHaveLength(1);
    pointerDrop(source, zone);
    expect(useFactoryStore.getState().project.storages).toHaveLength(2);
    expect(useFactoryStore.getState().project.storages?.[1].resourceId).toBe("copper");
    expect(useFactoryStore.getState().project.poolResourceRules).toBeUndefined();
    expect(useFactoryStore.getState().recipeBrowserResource).toBeFalsy();
    act(() => useFactoryStore.getState().undo());
    expect(useFactoryStore.getState().project.storages).toHaveLength(1);
  });

  it("advertises Desired rates during native resource dragging and clears after cancellation", () => {
    render(<PoolWorksheet />);
    const zone = screen.getByLabelText("Desired rates drop zone");
    expect(screen.getByText("(Drag items here)")).toBeTruthy();
    fireEvent.dragStart(document.body, { dataTransfer: { types: ["application/x-gtnh-resource"] } });
    expect(zone.hasAttribute("data-resource-ready")).toBe(true);
    fireEvent.dragOver(zone, { dataTransfer: { types: ["application/x-gtnh-resource"] } });
    expect(zone.hasAttribute("data-resource-drop")).toBe(true);
    fireEvent.dragEnd(document.body);
    expect(zone.hasAttribute("data-resource-ready")).toBe(false);
    expect(zone.hasAttribute("data-resource-drop")).toBe(false);
    fireEvent.dragStart(document.body, { dataTransfer: { types: ["text/plain"] } });
    expect(zone.hasAttribute("data-resource-ready")).toBe(false);
  });

  it("reorders machine rows without changing the plan, solve or canvas positions", () => {
    const project = fixture();
    project.nodes.push({ ...project.nodes[0], id: "second", position: { x: 800, y: 400 } });
    useFactoryStore.getState().setProject(project);
    const before = useFactoryStore.getState();
    const { container } = render(<PoolWorksheet />);
    const target = container.querySelector('[data-worksheet-node="machine"]')!;
    pointerDrop(screen.getAllByRole("button", { name: /Reorder machine/ })[1], target);
    expect(dragSounds()).toEqual(["pageOpen", "snap", "shuffle"]);
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

  it.each([".pool-machine-title", ".pool-status-cell", ".pool-power-cell", ".pool-takes-cell", '[aria-label="Duplicate machine"]', '.pool-machine-count button'])(
    "drags the machine from %s without triggering its click action", (selector) => {
      const project = fixture();
      project.nodes.push({ ...project.nodes[0], id: "second" });
      useFactoryStore.getState().setProject(project);
      const { container } = render(<PoolWorksheet />);
      const before = useFactoryStore.getState().project;
      const source = container.querySelector<HTMLElement>('[data-worksheet-node="second"] ' + selector)!;
      const target = container.querySelector('[data-worksheet-node="machine"]')!;
      pointerDrop(source, target);
      expect([...container.querySelectorAll('[data-worksheet-node]')].map(row => row.getAttribute('data-worksheet-node'))).toEqual(['second', 'machine']);
      expect(useFactoryStore.getState().project).toBe(before);
      expect(container.querySelector('.pool-machine-count input')).toBeNull();
      // A subsequent ordinary click must still work.
      fireEvent.click(container.querySelector('[data-worksheet-node="second"] [aria-label="Duplicate machine"]')!);
      expect(useFactoryStore.getState().project.nodes).toHaveLength(3);
    },
  );

  it("replaces the empty rates hint when an item is added and restores it on undo", () => {
    const project = fixture();
    project.storages = [];
    useFactoryStore.getState().setProject(project);
    const { container } = render(<PoolWorksheet />);
    expect(screen.getByText("Drag items here or press +")).toBeTruthy();
    const material = container.querySelector<HTMLElement>('.pool-scope-material[data-material-key="item:copper"] .pool-material-rate')!;
    pointerDrop(material, screen.getByLabelText("Desired rates drop zone"));
    expect(screen.queryByText("Drag items here or press +")).toBeNull();
    expect(useFactoryStore.getState().project.storages).toHaveLength(1);
    act(() => useFactoryStore.getState().undo());
    expect(screen.getByText("Drag items here or press +")).toBeTruthy();
  });

  it("adds a product directly from the Products plus button", () => {
    render(<PoolWorksheet />);
    fireEvent.click(screen.getByRole("button", { name: "Add rate" }));
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
    const resources = screen.getByRole("region", { name: "Materials for All production" });
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
  it("edits machine settings in a clearly labeled inline dropdown", () => {
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
    expect(container.querySelector(".pool-settings-section")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Settings for Bender" }));
    const settings = screen.getByRole("region", { name: "Machine settings for Bender" });
    fireEvent.click(within(settings).getByRole("button", { name: "Next Solenoid" }));
    expect(useFactoryStore.getState().project.nodes[0].machineConfigTiers?.solenoidCoil).toBe("mv");
    expect(container.querySelector(".pool-settings-row")?.contains(settings)).toBe(true);
    expect(within(settings).queryByText("Machine settings")).toBeNull();
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
    fireEvent.keyDown(settings, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Machine settings for Bender" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Settings for Bender" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings for Bender" }));
    fireEvent.pointerDown(document.body);
    expect(screen.getByRole("region", { name: "Machine settings for Bender" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close machine settings" }));
    expect(screen.queryByRole("region", { name: "Machine settings for Bender" })).toBeNull();
  });
  it("keeps each machine settings dropdown independently expandable", () => {
    const project = fixture();
    project.productionGroups = [{ id: "line", name: "Line" }];
    project.recipes[0].machineConfigControls = [{
      id: "solenoidCoil", label: "Solenoid", defaultKey: "lv", minimumKey: "lv",
      tiers: [{ key: "lv", label: "LV", resource: { kind: "item", id: "lv-solenoid", amount: 1 } }, { key: "mv", label: "MV", resource: { kind: "item", id: "mv-solenoid", amount: 1 } }],
    }];
    project.nodes.push({ ...project.nodes[0], id: "second" });
    useFactoryStore.getState().setProject(project);
    render(<PoolWorksheet />);
    const buttons = screen.getAllByRole("button", { name: "Settings for Bender" });
    fireEvent.click(buttons[0]);
    expect(buttons[0].getAttribute("aria-expanded")).toBe("true");
    fireEvent.pointerDown(buttons[1]);
    fireEvent.click(buttons[1]);
    expect(buttons[0].getAttribute("aria-expanded")).toBe("true");
    expect(buttons[1].getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("region", { name: "Machine settings for Bender" })).toHaveLength(2);
  });

  it("shows desired products beside total power and an all-production summary", () => {
    const { container } = render(<PoolWorksheet />);
    const scroller = container.querySelector(".pool-sheet-scroll")!;
    expect(scroller.querySelector(".pool-desired-products")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Desired rates" }).closest("th")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Add rate" }).closest("th")).not.toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Item" })).toBeNull();
    expect(screen.getByRole("region", { name: "Materials for All production" })).toBeDefined();
    expect(screen.getByRole("region", { name: "Materials for All production" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Material rules for All production pool" })).toBeNull();
    expect(container.querySelector(".pool-summary-toggles")).toBeNull();
  });

  it("opens search on demand and clears it without changing the plan, books or undo history", () => {
    const { project, lastResult, undoHistory } = useFactoryStore.getState();
    render(<PoolWorksheet />);
    expect(screen.getByRole("table", { name: "Recipes running in the pool" })).toBeDefined();
    expect(screen.queryByRole("textbox", { name: "Filter worksheet" })).toBeNull();
    expect(screen.getByText("(Drag items here)")).toBeTruthy();
    expect(screen.queryByText("Change machine: click its icon")).toBeNull();
    fireEvent.keyDown(document, { key: "f", ctrlKey: true });
    fireEvent.change(screen.getByRole("textbox", { name: "Filter worksheet" }), {
      target: { value: "not present" },
    });
    expect(screen.getByText("No recipes match this filter.")).toBeDefined();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Filter worksheet" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Filter worksheet" })).toBeNull();
    expect(screen.queryByText("No recipes match this filter.")).toBeNull();
    fireEvent.keyDown(document, { key: "f", metaKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Close worksheet search" }));
    expect(screen.queryByRole("textbox", { name: "Filter worksheet" })).toBeNull();

    const after = useFactoryStore.getState();
    expect(after.project).toBe(project);
    expect(after.lastResult).toBe(lastResult);
    expect(after.undoHistory).toBe(undoHistory);
    expect(JSON.parse(localStorage.getItem("gtnh-factory-flow-workspace-view")!)).toEqual(DEFAULT_WORKSPACE_VIEW);
  });

  it("edits a negative input goal, keeps its sign on reopening, and supports undo", () => {
    const project = fixture();
    project.storages![0] = { ...project.storages![0], resourceId: "copper", displayName: "Copper Ingot", targetPerSecond: undefined };
    useFactoryStore.getState().setProject(project);
    const { container } = render(<PoolWorksheet />);
    fireEvent.click(screen.getByRole("button", { name: "Required amount" }));
    const input = screen.getByRole("textbox", { name: "Required amount" });
    fireEvent.change(input, { target: { value: "-2k" } });
    fireEvent.blur(input);
    expect(useFactoryStore.getState().project.storages?.[0].targetPerSecond).toBe(-2000);
    expect(useFactoryStore.getState().lastResult.nodes.machine.theoreticalMachinesRequired).toBeCloseTo(2000);
    expect(container.querySelector(".pool-product .pool-balance-rate")?.textContent).toContain("−2k");
    fireEvent.click(screen.getByRole("button", { name: "Required amount" }));
    expect((screen.getByRole("textbox", { name: "Required amount" }) as HTMLInputElement).value).toBe("-2k");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Required amount" }), { key: "Escape" });
    act(() => useFactoryStore.getState().undo());
    expect(useFactoryStore.getState().project.storages?.[0].targetPerSecond).toBeUndefined();
  });

  it("switches target rules without losing the saved rate and supports undo", () => {
    render(<PoolWorksheet />);
    const rule = () => screen.getByRole("button", { name: /^Rule for Copper Plate:/ });
    expect(rule().textContent).toBe("≥At least");
    fireEvent.click(rule());
    // The drawer's marks and words; Any is the old Ignore.
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["~Any", "≥At least", "=Exactly", "≤At most"]);
    fireEvent.click(screen.getByRole("option", { name: /Any/ }));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(useFactoryStore.getState().project.storages?.[0]).toMatchObject({ targetPerSecond: 0.5, targetMode: "ignore" });
    expect(useFactoryStore.getState().lastResult.nodes.machine.theoreticalMachinesRequired).toBe(0);
    fireEvent.click(rule());
    fireEvent.click(screen.getByRole("option", { name: /Exactly/ }));
    expect(useFactoryStore.getState().lastResult.nodes.machine.theoreticalMachinesRequired).toBeCloseTo(0.5);
    act(() => useFactoryStore.getState().undo());
    expect(rule().getAttribute("aria-label")).toBe("Rule for Copper Plate: Any. Click to choose.");
  });

  it("accepts zero only as an exact output target", () => {
    render(<PoolWorksheet />);
    fireEvent.click(screen.getByRole("button", { name: /^Rule for Copper Plate:/ }));
    fireEvent.click(screen.getByRole("option", { name: /Exactly/ }));
    fireEvent.click(screen.getByRole("button", { name: "Required amount" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Required amount" }), { target: { value: "0" } });
    fireEvent.blur(screen.getByRole("textbox", { name: "Required amount" }));
    expect(useFactoryStore.getState().project.storages?.[0].targetPerSecond).toBe(0);
    expect(screen.getByRole("button", { name: "Required amount" }).textContent).toContain("0/s");
    expect(useFactoryStore.getState().lastResult.nodes.machine.theoreticalMachinesRequired).toBe(0);
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
    fireEvent.click(screen.getByRole("button", { name: "Tier LV" }));
    expect(useFactoryStore.getState().project.nodes[0].overclockTier).toBe("MV");
    fireEvent.contextMenu(screen.getByRole("button", { name: "Tier MV" }));
    expect(useFactoryStore.getState().project.nodes[0].overclockTier).toBe("LV");
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100 });
    fireEvent(screen.getByRole("button", { name: "Tier LV" }), wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(useFactoryStore.getState().project.nodes[0].overclockTier).toBe("MV");
    fireEvent.wheel(screen.getByRole("button", { name: "Tier MV" }), { deltaY: 100 });
    expect(useFactoryStore.getState().project.nodes[0].overclockTier).toBe("LV");
    fireEvent.contextMenu(screen.getByRole("button", { name: "Tier LV" }));
    expect(useFactoryStore.getState().project.nodes[0].overclockTier).toBe("LV");
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
    expect((screen.getByRole("button", { name: /^Rule for Copper Plate:/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Remove machine" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add rate" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Balance all materials/ })).toBeNull();

    expect((container.querySelector("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    expect(useFactoryStore.getState().project).toBe(project);

    expect(useFactoryStore.getState().project).toBe(project);
  });
});


describe("production group controls", () => {
  it("creates, names and nests groups, moves a machine, and undoes the move", () => {
    const { container } = render(<PoolWorksheet />);
    fireEvent.click(screen.getByRole("button", { name: "Add production group" }));
    expect(screen.queryByRole("button", { name: "Collapse Group 1" })).toBeNull();
    expect(screen.getByRole("button", { name: "Move group Group 1" }).getAttribute("title")).toBeNull();
    const name = screen.getByRole("textbox", { name: "Production group name" });
    fireEvent.change(name, { target: { value: "Copper line" } }); fireEvent.blur(name);
    const id = useFactoryStore.getState().project.productionGroups![0].id;
    const settingsButton = screen.getByRole("button", { name: "Settings for Bender" }) as HTMLButtonElement;
    expect(settingsButton.disabled).toBe(true);
    fireEvent.click(settingsButton);
    expect(screen.queryByRole("region", { name: "Machine settings for Bender" })).toBeNull();
    expect(screen.queryByLabelText("Production group for Bender")).toBeNull();
    pointerDrop(screen.getByRole("button", { name: "Reorder machine Bender" }), container.querySelector(`[data-production-group="${id}"]`)!);
    expect(useFactoryStore.getState().project.nodes[0].productionGroupId).toBe(id);
    act(() => useFactoryStore.getState().undo());
    expect(useFactoryStore.getState().project.nodes[0].productionGroupId).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Add subgroup to Copper line" }));
    expect(useFactoryStore.getState().project.productionGroups![1].parentId).toBe(id);
  });
  it("labels material controls by their effect and toggles rules at the current scope", () => {
    const p = fixture(); p.productionGroups = [{ id: "line", name: "Copper line" }]; p.nodes[0].productionGroupId = "line";
    p.recipes.push({ ...p.recipes[0], id: "producer", inputs: [], outputs: [{ kind: "item", id: "copper", displayName: "Copper Ingot", amount: 1 }] });
    p.nodes.push({ ...p.nodes[0], id: "producer", recipeId: "producer" });
    useFactoryStore.getState().setProject(p);
    const before = useFactoryStore.getState().project.recipes;
    render(<PoolWorksheet />);
    expect(screen.queryByRole("button", { name: "Material rules for Copper line" })).toBeNull();
    const link = screen.getByRole("button", { name: "Balance Copper Ingot in Copper line" });
    expect(screen.getByRole("button", { name: "Balance Copper Ingot in Copper line" }).getAttribute("aria-pressed")).toBe("true");
    expect(link.title).toBe("Balance on. Turn off to share with the parent group.");
    fireEvent.click(link);
    expect(useFactoryStore.getState().project.productionGroups![0].resourceRules).toEqual({ "item:copper": "share" });
    expect(link.getAttribute("aria-pressed")).toBe("false");
    expect(link.title).toBe("Balance off: the parent group handles supply and surplus.");
    const rootRule = screen.getByRole("button", { name: "Balance Copper Ingot in All production" });
    expect(rootRule.getAttribute("aria-pressed")).toBe("true");
    expect(rootRule.title).toBe("Balance on. Turn off to allow outside supply and surplus.");
    fireEvent.click(rootRule);
    expect(screen.getByRole("button", { name: "Balance Copper Ingot in All production" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Balance Copper Ingot in All production" }).title).toBe("Balance off: outside supply and surplus are allowed.");
    expect(useFactoryStore.getState().project.poolResourceRules).toEqual({ "item:copper": "import" });
    expect(useFactoryStore.getState().project.recipes).toBe(before);
    fireEvent.click(screen.getByRole("button", { name: "Balance Copper Ingot in Copper line" }));
    expect(useFactoryStore.getState().project.productionGroups![0].resourceRules?.["item:copper"]).toBeUndefined();
    expect(screen.getByRole("button", { name: "Balance Copper Ingot in Copper line" }).getAttribute("aria-pressed")).toBe("true");
  });
  it.each([false, true])("toggles every material in one undo step, limited to its scope (group: %s)", (nested) => {
    const project = fixture();
    project.recipes[0].inputs.push({ kind: "item", id: "recycled", amount: 1 });
    project.recipes[0].outputs.push({ kind: "item", id: "recycled", amount: 1 });
    project.productionGroups = [{ id: "other", name: "Other", resourceRules: { "item:copper": "import" } }];
    if (nested) {
      project.productionGroups.push({ id: "line", name: "Copper line" });
      project.nodes[0].productionGroupId = "line";
      project.storages![0].productionGroupId = "line";
    }
    useFactoryStore.getState().setProject(project);
    render(<PoolWorksheet />);
    const name = nested ? "Copper line" : "All production";
    const button = () => screen.getByRole("button", { name: "Balance all materials in " + name });
    const rules = () => nested ? useFactoryStore.getState().project.productionGroups!.find(g => g.id === "line")!.resourceRules : useFactoryStore.getState().project.poolResourceRules;
    expect(button().getAttribute("aria-pressed")).toBe("true");
    const before = useFactoryStore.getState();
    fireEvent.click(button());
    expect(rules()).toEqual(Object.fromEntries(["copper", "plate", "recycled"].map(id => ["item:" + id, nested ? "share" : "import"])));
    expect(button().getAttribute("aria-pressed")).toBe("false");
    expect(useFactoryStore.getState().undoHistory.length).toBe(before.undoHistory.length + 1);
    expect(useFactoryStore.getState().project.productionGroups!.find(g => g.id === "other")!.resourceRules).toEqual({ "item:copper": "import" });
    act(() => useFactoryStore.getState().undo());
    expect(rules()).toBeUndefined();
    expect(button().getAttribute("aria-pressed")).toBe("true");
    act(() => useFactoryStore.getState().setPoolResourceRule(nested ? "line" : undefined, "item:copper", "import"));
    expect(button().getAttribute("aria-pressed")).toBe("mixed");
    fireEvent.click(button());
    expect(rules()).toEqual({});
    expect(button().getAttribute("aria-pressed")).toBe("true");
  });

  it("combines both boundary directions without offering a parent override for child-local totals", () => {
    const resource = { kind: "item" as const, id: "copper", displayName: "Copper Ingot", amount: 1 };
    render(<table><ProductionScopeHeader resources={[]} readOnly={false} power={null}
      inputs={[{ resource, rate: 2 }]} outputs={[{ resource, rate: 3 }]}
      renderResource={(item) => <button>{item.displayName}</button>} /></table>);
    const materials = screen.getByRole("region", { name: "Materials for All production" });
    expect(within(materials).getAllByRole("button", { name: "Copper Ingot" })).toHaveLength(1);
    const net = within(materials).getByLabelText("Copper Ingot: net output 1/s");
    expect(net.textContent).toBe("+1/s");
    expect(net.getAttribute("title")).toBe("Input: 2/s; output: 3/s");
    expect(within(materials).queryByRole("button", { name: /^Balance/ })).toBeNull();
    expect(within(materials).getByText("Within groups")).toBeTruthy();
  });
  it("shows every material without paging or filtering, including large saved rule lists", () => {
    const project = fixture();
    project.poolResourceRules = Object.fromEntries(Array.from({ length: 1000 }, (_, index) => ["item:material-" + index, "import"]));
    useFactoryStore.getState().setProject(project);
    render(<PoolWorksheet />);
    const rules = screen.getByRole("region", { name: "Materials for All production" });
    expect(within(rules).getAllByRole("button", { name: /^Balance/ })).toHaveLength(1002);
    expect(screen.queryByRole("button", { name: /Next materials|Previous materials/ })).toBeNull();
    expect(screen.queryByRole("searchbox", { name: /Find material/ })).toBeNull();
    fireEvent.click(within(rules).getByRole("button", { name: "Balance material-999 in All production" }));
    expect(useFactoryStore.getState().project.poolResourceRules?.["item:material-999"]).toBeUndefined();
    expect(within(rules).getAllByRole("button", { name: /^Balance/ })).toHaveLength(1001);
  // Rendering and querying 1,000 accessible controls needs extra time on CI.
  }, 15_000);
  it.each([undefined, { id: "line", name: "Copper line" }])("keeps stopped ingredients and products distinct from intermediates in scope %s", (group) => {
    const resource = (id: string, made: boolean, used: boolean, drawer?: "source" | "product") => ({
      groupId: group?.id, key: ("item:" + id) as `item:${string}`, resource: { kind: "item" as const, id, amount: 1 },
      route: "local" as const, made: 0, used: 0, product: 0,
      feeders: [...(made ? [{ id: "producer", storage: false }] : []), ...(drawer === "source" ? [{ id: "source", storage: true }] : [])],
      takers: [...(used ? [{ id: "consumer", storage: false }] : []), ...(drawer === "product" ? [{ id: "product", storage: true }] : [])],
    });
    const rows = [resource("ore", false, true, "source"), resource("dust", true, true), resource("plate", true, false, "product")];
    const { rerender } = render(<table><ProductionScopeHeader group={group} resources={rows} readOnly={false} power={null}
      inputs={[]} outputs={[]} renderResource={(item) => <span>{item.id}</span>} /></table>);
    const scope = group?.name ?? "All production";
    expect(within(screen.getByRole("table", { name: "Inputs for " + scope })).getByText("ore")).toBeTruthy();
    expect(within(screen.getByRole("table", { name: "Outputs for " + scope })).getByText("plate")).toBeTruthy();
    expect(within(screen.getByRole("table", { name: "Internal for " + scope })).getByText("dust")).toBeTruthy();
    expect(screen.getAllByLabelText(/no net flow 0/)).toHaveLength(3);
    // Actual outside supply takes precedence once a paired material is imported.
    rerender(<table><ProductionScopeHeader group={group} resources={rows} readOnly={false} power={null}
      inputs={[{ resource: rows[1].resource, rate: 2 }]} outputs={[]} renderResource={(item) => <span>{item.id}</span>} /></table>);
    expect(within(screen.getByRole("table", { name: "Inputs for " + scope })).getByText("dust")).toBeTruthy();
    expect(screen.getByLabelText("dust: net input 2/s")).toBeTruthy();
  });
  it("collapses a production line and restores it when searching", () => {
    const p = fixture(); p.productionGroups = [{ id: "line", name: "Copper line" }]; p.nodes[0].productionGroupId = "line";
    useFactoryStore.getState().setProject(p);
    const view = render(<PoolWorksheet />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse Copper line" }));
    expect(view.container.querySelector('[data-worksheet-node="machine"]')).toBeNull();
    fireEvent.keyDown(document, { key: "f", ctrlKey: true });
    fireEvent.change(screen.getByLabelText("Filter worksheet"), { target: { value: "Copper" } });
    expect(view.container.querySelector('[data-worksheet-node="machine"]')).not.toBeNull();
  });
  it("keeps new products global and ungroups without deleting machines or existing scoped targets", () => {
    const p = fixture(); p.productionGroups = [{ id: "line", name: "Copper line" }]; p.nodes[0].productionGroupId = "line"; p.storages![0].productionGroupId = "line";
    useFactoryStore.getState().setProject(p);
    render(<PoolWorksheet />);
    expect(screen.queryByRole("button", { name: "Add rate to this group" })).toBeNull();
    expect(screen.getByText("Target in Copper line")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Add rate" }));
    fireEvent.click(screen.getByRole("button", { name: "Pick Copper Ingot" }));
    expect(useFactoryStore.getState().project.storages!.find((s) => s.resourceId === "copper")?.productionGroupId).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Delete group Copper line" }));
    expect(useFactoryStore.getState().project.nodes).toHaveLength(1);
    expect(useFactoryStore.getState().project.storages).toHaveLength(2);
    expect(useFactoryStore.getState().project.nodes[0].productionGroupId).toBeUndefined();
  });
  it("drags machines into empty and collapsed groups and back to Factory with undo", () => {
    const p = fixture(); p.productionGroups = [{ id: "line", name: "Copper line" }];
    useFactoryStore.getState().setProject(p);
    const { container } = render(<PoolWorksheet />);
    expect(screen.queryByLabelText("Parent of Copper line")).toBeNull();
    expect(screen.queryByRole("button", { name: "Collapse Copper line" })).toBeNull();
    pointerDrop(screen.getByRole("button", { name: "Reorder machine Bender" }), container.querySelector('[data-production-group="line"]')!);
    expect(useFactoryStore.getState().project.nodes[0].productionGroupId).toBe("line");
    fireEvent.click(screen.getByRole("button", { name: "Collapse Copper line" }));
    expect(container.querySelector('[data-worksheet-node="machine"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand Copper line" }));
    pointerDrop(container.querySelector<HTMLElement>('[data-worksheet-node="machine"] .pool-power-cell')!, container.querySelector('[data-production-group="factory"]')!);
    expect(useFactoryStore.getState().project.nodes[0].productionGroupId).toBeUndefined();
    act(() => useFactoryStore.getState().undo());
    expect(useFactoryStore.getState().project.nodes[0].productionGroupId).toBe("line");
  });
  it("drags whole groups into another group and prevents moving parents into their children", () => {
    const p = fixture(); p.productionGroups = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
    useFactoryStore.getState().setProject(p);
    const { container } = render(<PoolWorksheet />);
    pointerDrop(screen.getByRole("button", { name: "Move group A" }), container.querySelector('[data-production-group="b"]')!);
    expect(useFactoryStore.getState().project.productionGroups![0].parentId).toBe("b");
    pointerDrop(screen.getByRole("button", { name: "Move group B" }), container.querySelector('[data-production-group="a"]')!);
    expect(useFactoryStore.getState().project.productionGroups![1].parentId).toBeUndefined();
  });
  it("allows viewers to inspect rules and collapse groups without editing", () => {
    const p = fixture(); p.productionGroups = [{ id: "line", name: "Copper line" }]; p.nodes[0].productionGroupId = "line";
    useFactoryStore.getState().setProject(p); useFactoryStore.setState({ isReadOnly: true });
    render(<PoolWorksheet />);
    expect(screen.queryByRole("button", { name: "Add production group" })).toBeNull();
    expect(screen.getByRole("region", { name: "Materials for Copper line" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Move group Copper line" })).toBeNull();
    expect((screen.getByRole("button", { name: "Balance Copper Ingot in Copper line" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Collapse Copper line" }));
    expect(useFactoryStore.getState().project.productionGroups).toEqual(p.productionGroups);
  });
});

describe("rate status without a setup dashboard", () => {
  it("keeps outcomes on each desired rate, with no repeated setup status or examples", () => {
    const { container } = render(<PoolWorksheet />);
    expect(screen.queryByRole("region", { name: "Production status" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rules example" })).toBeNull();
    expect(container.querySelector(".pool-product-status")?.textContent).toContain("Requested rate met");
    act(() => useFactoryStore.getState().setStorageTargetMode("product", "ignore"));
    expect(container.querySelector(".pool-product-status")?.textContent).toContain("Rate not enforced");
    expect(screen.queryByRole("region", { name: "Target explanation" })).toBeNull();
  });
  it("keeps a missing-recipe error visible without a dashboard", () => {
    const result = useFactoryStore.getState().lastResult;
    useFactoryStore.setState({ lastResult: { ...result, bottlenecks: [{ id: "missing", kind: "missing-recipe", severity: "critical", message: "A machine is missing its recipe." }] } });
    render(<PoolWorksheet />);
    expect(screen.getByRole("alert").textContent).toBe("A machine is missing its recipe.");
  });
});

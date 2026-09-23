// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { PoolWorksheet } from "../pool/PoolWorksheet";
import { TargetLine } from "./StorageNode";
import { StorageTargetRule } from "./StorageTargetRule";
import { useFactoryStore } from "@/store/factory-store";
import { PROJECT_SCHEMA_VERSION, type FactoryProject } from "@/lib/model/types";
import { DEFAULT_WORKSPACE_VIEW, writeWorkspaceView } from "@/lib/workspace-view";

function project(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "rate-ui",
    name: "Rate UI",
    solveMode: true,
    poolMode: false,
    fuelProfiles: [],
    recipes: [
      {
        id: "r",
        name: "Ingot",
        machineType: "Test",
        minimumTier: "NONE",
        durationTicks: 20,
        eut: 0,
        inputs: [{ kind: "item", id: "ore", amount: 2 }],
        outputs: [{ kind: "item", id: "ingot", amount: 1 }],
      },
    ],
    nodes: [
      {
        id: "n",
        recipeId: "r",
        enabled: true,
        machineCount: 1,
        parallel: 1,
        overclockTier: "NONE",
        position: { x: 160, y: 0 },
      },
    ],
    storages: [
      {
        id: "input",
        kind: "item",
        resourceId: "ore",
        displayName: "Ore",
        position: { x: 0, y: 0 },
      },
      {
        id: "output",
        kind: "item",
        resourceId: "ingot",
        displayName: "Ingot",
        position: { x: 320, y: 0 },
        targetPerSecond: 3,
      },
    ],
    edges: [
      { id: "in", source: "input", target: "n", resourceKind: "item", resourceId: "ore" },
      { id: "out", source: "n", target: "output", resourceKind: "item", resourceId: "ingot" },
    ],
  };
}
function BoardSource() {
  const storage = useFactoryStore((state) => state.project.storages![0]);
  const result = useFactoryStore((state) => state.lastResult.storages.input);
  return (
    <>
      <StorageTargetRule storage={storage} input />
      <TargetLine storage={storage} result={result} input />
    </>
  );
}
beforeEach(() => {
  writeWorkspaceView({ ...DEFAULT_WORKSPACE_VIEW });
  useFactoryStore.setState({ isReadOnly: false, checklistMode: false });
  useFactoryStore.getState().setProject(project());
});
afterEach(() => {
  cleanup();
  useFactoryStore.setState({ isReadOnly: false, checklistMode: false });
});
it("edits a positive source amount on the board and carries its signed rate and rule into Pool and back", () => {
  const board = render(<BoardSource />);
  fireEvent.click(screen.getByRole("button", { name: "Required amount" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Required amount" }), {
    target: { value: "10" },
  });
  fireEvent.blur(screen.getByRole("textbox", { name: "Required amount" }));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "at-most" } });
  expect(useFactoryStore.getState().project.storages![0]).toMatchObject({
    targetPerSecond: -10,
    targetMode: "at-most",
  });
  expect(useFactoryStore.getState().lastResult.storages.input.consumedPerSecond).toBeCloseTo(6);
  board.unmount();
  act(() => useFactoryStore.getState().setPoolMode(true));
  const pool = render(<PoolWorksheet />);
  expect(screen.getByRole("heading", { name: "Desired rates" })).toBeTruthy();
  const row = pool.container.querySelector('[data-worksheet-product="input"]')! as HTMLElement;
  expect(within(row).getByRole("button", { name: /^Rule for Ore:/ }).getAttribute("aria-label")).toBe("Rule for Ore: At most. Click to choose.");
  fireEvent.click(within(row).getByRole("button", { name: "Required amount" }));
  const field = within(row).getByRole("textbox", { name: "Required amount" }) as HTMLInputElement;
  expect(field.value).toBe("-10");
  fireEvent.change(field, { target: { value: "-8" } });
  fireEvent.blur(field);
  pool.unmount();
  act(() => useFactoryStore.getState().setPoolMode(false));
  render(<BoardSource />);
  fireEvent.click(screen.getByRole("button", { name: "Required amount" }));
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("8");
  expect(useFactoryStore.getState().project.edges).toEqual(project().edges);
});
it("shows existing sources with no rate in Pool and keeps zero-input limits through undo", () => {
  act(() => useFactoryStore.getState().setPoolMode(true));
  const pool = render(<PoolWorksheet />);
  const row = pool.container.querySelector('[data-worksheet-product="input"]')! as HTMLElement;
  expect(within(row).getByText("rate?")).toBeTruthy();
  // A source with no rate still shows its rule, as Pool always did.
  expect(within(row).getByRole("button", { name: /^Rule for Ore:/ }).textContent).toBe("=Exactly");
  fireEvent.click(within(row).getByRole("button", { name: /^Rule for Ore:/ }));
  fireEvent.click(within(row).getByRole("option", { name: /At most/ }));
  expect(useFactoryStore.getState().project.storages![0].targetPerSecond).toBeUndefined();
  fireEvent.click(within(row).getByRole("button", { name: "Required amount" }));
  const field = within(row).getByRole("textbox");
  fireEvent.change(field, { target: { value: "0" } });
  fireEvent.blur(field);
  expect(useFactoryStore.getState().project.storages![0]).toMatchObject({
    targetPerSecond: 0,
    poolSide: "source",
  });
  expect(useFactoryStore.getState().lastResult.storages.output.targetUnreachable).toBe(true);
  act(() => useFactoryStore.getState().undo());
  expect(useFactoryStore.getState().project.storages![0].targetPerSecond).toBeUndefined();
  expect(useFactoryStore.getState().lastResult.storages.output.targetUnreachable).not.toBe(true);
});
it("keeps separate source drawers independent", () => {
  const p = project();
  p.storages!.push({ ...p.storages![0], id: "input2" });
  p.edges.push({ ...p.edges[0], id: "in2", source: "input2" });
  p.poolMode = true;
  useFactoryStore.getState().setProject(p);
  useFactoryStore.getState().setStorageTarget("input", -10);
  useFactoryStore.getState().setStorageTargetMode("input", "at-most");
  expect(useFactoryStore.getState().project.storages![2].targetPerSecond).toBeUndefined();
  expect(useFactoryStore.getState().project.storages![2].targetMode).toBeUndefined();
});
it("makes both the source rate and rule read-only for viewers", () => {
  useFactoryStore.setState({ isReadOnly: true });
  render(<BoardSource />);
  expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Required amount" }));
  expect(screen.queryByRole("textbox")).toBeNull();
  useFactoryStore.getState().setStorageTargetMode("input", "ignore");
  expect(useFactoryStore.getState().project.storages![0].targetMode).toBeUndefined();
});

it("offers the same rules for both rate directions", () => {
  const p = project();
  render(
    <>
      <StorageTargetRule storage={p.storages![0]} input />
      <StorageTargetRule storage={p.storages![1]} input={false} />
    </>,
  );
  const menus = screen.getAllByRole("combobox") as HTMLSelectElement[];
  expect([...menus[0].options].map((o) => o.value)).toEqual([
    "at-least",
    "exact",
    "at-most",
    "ignore",
  ]);
  expect([...menus[1].options].map((o) => o.value)).toEqual(
    [...menus[0].options].map((o) => o.value),
  );
});

it("keeps the chosen rule when the signed rate changes direction", () => {
  act(() => useFactoryStore.getState().setPoolMode(true));
  const store = useFactoryStore.getState();
  store.setStorageTargetMode("input", "at-most");
  store.setStorageTarget("input", 4);
  expect(useFactoryStore.getState().project.storages![0]).toMatchObject({ targetPerSecond: 4, targetMode: "at-most", poolSide: "drain" });
  store.setStorageTarget("input", -4);
  expect(useFactoryStore.getState().project.storages![0]).toMatchObject({ targetPerSecond: -4, targetMode: "at-most", poolSide: "source" });
});

it("middle-click clears a rate without changing the rule or wires, and supports undo", () => {
  useFactoryStore.getState().setStorageTarget("input", 10);
  useFactoryStore.getState().setStorageTargetMode("input", "exact");
  render(<BoardSource />);
  fireEvent(screen.getByRole("button", { name: "Required amount" }), new MouseEvent("auxclick", { button: 1, bubbles: true }));
  expect(useFactoryStore.getState().project.storages![0].targetPerSecond).toBeUndefined();
  expect(useFactoryStore.getState().project.storages![0].targetMode).toBe("exact");
  expect(screen.getByText("rate?")).toBeTruthy();
  expect(useFactoryStore.getState().project.edges).toEqual(project().edges);
  act(() => useFactoryStore.getState().undo());
  expect(useFactoryStore.getState().project.storages![0].targetPerSecond).toBe(-10);
});
it("middle-click cannot clear rates in read-only mode", () => {
  useFactoryStore.getState().setStorageTarget("input", 10);
  useFactoryStore.setState({ isReadOnly: true });render(<BoardSource />);
  fireEvent(screen.getByRole("button", { name: "Required amount" }), new MouseEvent("auxclick", { button: 1, bubbles: true }));
  expect(useFactoryStore.getState().project.storages![0].targetPerSecond).toBe(-10);
});
it("keeps the actual rate visible alongside a compact unreachable warning", () => {
  const p = project();p.poolMode = true;p.nodes = [];p.edges = [];p.storages![1].poolSide = "drain";
  useFactoryStore.getState().setProject(p);render(<PoolWorksheet />);
  expect(screen.queryByText("Unreachable")).toBeNull();
  const warning=screen.getByLabelText(/explain target for/);
  expect(warning.closest("tr")!.children[3].textContent).toContain("0/s");
  expect(screen.queryByRole("region", { name: "Target explanation" })).toBeNull();
  fireEvent.click(warning);
  const help = screen.getByRole("region", { name: "Target explanation" });
  expect(document.activeElement).toBe(help);
  expect(within(help).getByText("Ingot")).toBeTruthy();
  expect(within(help).getByText(/Make at least/)).toBeTruthy();
  expect(within(help).getByText(/Currently making/)).toBeTruthy();
  expect(within(help).getByText(/Add or enable recipes/)).toBeTruthy();
  expect(useFactoryStore.getState().project.poolResourceRules).toBeUndefined();
  act(() => useFactoryStore.getState().setStorageTarget("output", undefined));
  expect(screen.queryByRole("region", { name: "Target explanation" })).toBeNull();
});

it("explains the clicked target and updates its requested rate", () => {
  const p = project();p.poolMode = true;p.nodes = [];p.edges = [];
  p.storages = [
    { ...p.storages![1], id: "first", poolSide: "drain" },
    { ...p.storages![1], id: "second", resourceId: "plate", displayName: "Plate", targetPerSecond: 7, poolSide: "drain" },
  ];
  useFactoryStore.getState().setProject(p);render(<PoolWorksheet />);
  fireEvent.click(screen.getAllByLabelText(/explain target for/)[1]);
  const help = screen.getByRole("region", { name: "Target explanation" });
  expect(within(help).getByText("Plate")).toBeTruthy();
  expect(within(help).queryByText("Ingot")).toBeNull();
  expect(within(help).getByText("7/s")).toBeTruthy();
  act(() => useFactoryStore.getState().setStorageTarget("second", 9));
  expect(within(help).getByText("9/s")).toBeTruthy();
  fireEvent.click(screen.getAllByLabelText(/explain target for/)[0]);
  expect(within(help).getByText("Ingot")).toBeTruthy();
  fireEvent.keyDown(help, { key: "Escape" });
  expect(screen.queryByRole("region", { name: "Target explanation" })).toBeNull();
});

it("scrolls Pool rate rules without scrolling the page", () => {
  act(() => useFactoryStore.getState().setPoolMode(true));
  render(<PoolWorksheet />);
  const rule = () => screen.getByRole("button", { name: /^Rule for Ore:/ });
  const initial = useFactoryStore.getState().project;
  const wheel = (deltaY: number) => fireEvent(rule(), new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true }));
  const shown = () => rule().getAttribute("aria-label");
  expect(shown()).toBe("Rule for Ore: Exactly. Click to choose.");
  expect(wheel(100)).toBe(false);
  expect(shown()).toBe("Rule for Ore: At most. Click to choose.");
  wheel(100);
  expect(shown()).toBe("Rule for Ore: At most. Click to choose.");
  wheel(-100);
  wheel(-100);
  wheel(-100);
  expect(shown()).toBe("Rule for Ore: Any. Click to choose.");
  wheel(-100);
  expect(shown()).toBe("Rule for Ore: Any. Click to choose.");
  expect(useFactoryStore.getState().project.edges).toEqual(initial.edges);
  expect(useFactoryStore.getState().project.storages![0].targetPerSecond).toBe(initial.storages![0].targetPerSecond);
  act(() => useFactoryStore.getState().undo());
  expect(shown()).toBe("Rule for Ore: At least. Click to choose.");
});
it("scrolls board rate rules without scrolling the page", () => {
  render(<BoardSource />);
  const select = screen.getByRole("combobox", { name: "Target rule for Ore" });
  const initial = useFactoryStore.getState().project;
  const wheel = () => fireEvent(select, new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true }));
  expect(wheel()).toBe(false);
  expect((select as HTMLSelectElement).value).toBe("at-most");
  wheel();expect((select as HTMLSelectElement).value).toBe("ignore");
  wheel();expect((select as HTMLSelectElement).value).toBe("ignore");
  fireEvent.wheel(select, { deltaY: -100 });expect((select as HTMLSelectElement).value).toBe("at-most");
  expect(useFactoryStore.getState().project.edges).toEqual(initial.edges);
  expect(useFactoryStore.getState().project.storages![0].targetPerSecond).toBe(initial.storages![0].targetPerSecond);
  act(() => useFactoryStore.getState().undo());
  expect((select as HTMLSelectElement).value).toBe("ignore");
});
it.each(["isReadOnly", "checklistMode"] as const)("does not wheel-edit rate rules in %s", (lock) => {
  useFactoryStore.setState({ [lock]: true });render(<BoardSource />);
  fireEvent.wheel(screen.getByRole("combobox"), { deltaY: 100 });
  expect(useFactoryStore.getState().project.storages![0].targetMode).toBeUndefined();
});
it("shows stopped target residue as zero without changing the solved value", () => {
  const p = project();p.poolMode = true;p.nodes = [];p.edges = [];p.storages![1].poolSide = "drain";
  useFactoryStore.getState().setProject(p);
  const lastResult = useFactoryStore.getState().lastResult;
  useFactoryStore.setState({ lastResult: { ...lastResult, storages: {
    ...lastResult.storages, output: { ...lastResult.storages.output, producedPerSecond: 5.169878828456423e-26 },
  } } });
  render(<PoolWorksheet />);
  const warning = screen.getByLabelText(/explain target for/);
  expect(warning.closest("tr")!.children[3].textContent).toBe("0/s");
  fireEvent.click(warning);
  expect(screen.getByText(/This target is stopped/)).toBeTruthy();
  expect(useFactoryStore.getState().lastResult.storages.output.producedPerSecond).toBe(5.169878828456423e-26);
});

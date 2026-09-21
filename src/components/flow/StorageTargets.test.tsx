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
  expect((within(row).getByRole("combobox") as HTMLSelectElement).value).toBe("at-most");
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
  fireEvent.change(within(row).getByRole("combobox"), { target: { value: "at-most" } });
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

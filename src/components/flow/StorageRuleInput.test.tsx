// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { RuleInput } from "./StorageNode";
import { useFactoryStore } from "@/store/factory-store";
import { PROJECT_SCHEMA_VERSION, type FactoryProject } from "@/lib/model/types";

/** Ore -> Ingot at 1/s of ingot from 2/s of ore, wired, in Solve. */
function project(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "rule-input",
    name: "Rule input",
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
    nodes: [{ id: "n", recipeId: "r", enabled: true, machineCount: 1, parallel: 1, overclockTier: "NONE", position: { x: 160, y: 0 } }],
    storages: [
      { id: "input", kind: "item", resourceId: "ore", displayName: "Ore", position: { x: 0, y: 0 } },
      { id: "output", kind: "item", resourceId: "ingot", displayName: "Ingot", position: { x: 320, y: 0 }, targetPerSecond: 3 },
    ],
    edges: [
      { id: "in", source: "input", target: "n", resourceKind: "item", resourceId: "ore" },
      { id: "out", source: "n", target: "output", resourceKind: "item", resourceId: "ingot" },
    ],
  };
}

function Row({ id, role }: { id: "input" | "output"; role: "source" | "product" }) {
  const storage = useFactoryStore((state) => state.project.storages!.find((s) => s.id === id)!);
  const result = useFactoryStore((state) => state.lastResult.storages[id]);
  return <RuleInput storage={storage} role={role} result={result} net={result?.netPerSecond ?? 0} />;
}

const stored = (id: string) => useFactoryStore.getState().project.storages!.find((s) => s.id === id)!;

beforeEach(() => {
  useFactoryStore.setState({ isReadOnly: false, checklistMode: false });
  useFactoryStore.getState().setProject(project());
});
afterEach(() => {
  cleanup();
  useFactoryStore.setState({ isReadOnly: false, checklistMode: false });
});

it("shows an empty source as Any with a box asking for a rate", () => {
  render(<Row id="input" role="source" />);
  expect(screen.getByRole("button", { name: /Rule: Any/ }).textContent).toContain("~");
  expect(screen.getByRole("button", { name: /Your rate: none/ }).textContent).toContain("rate?");
});

it("typing into an Any box sets the role's default rule in one undo step", () => {
  render(<Row id="input" role="source" />);
  fireEvent.click(screen.getByRole("button", { name: /Your rate: none/ }));
  const box = screen.getByRole("textbox", { name: "Your rate" });
  fireEvent.change(box, { target: { value: "4" } });
  fireEvent.blur(box);
  expect(stored("input")).toMatchObject({ targetPerSecond: -4, targetMode: "exact" });
  act(() => useFactoryStore.getState().undo());
  expect(stored("input").targetPerSecond).toBeUndefined();
});

it("picking a rule from the list on an Any drawer pins what flows now, in one undo step", () => {
  render(<Row id="input" role="source" />);
  const flowing = Math.abs(useFactoryStore.getState().lastResult.storages.input.netPerSecond);
  expect(flowing).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: /Rule: Any/ }));
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["~Any", "≥At least", "=Exactly", "≤At most"]);
  fireEvent.click(screen.getByRole("option", { name: /At most/ }));
  expect(stored("input").targetMode).toBe("at-most");
  expect(Math.abs(stored("input").targetPerSecond!)).toBeCloseTo(flowing, 3);
  expect(screen.queryByRole("listbox")).toBeNull();
  act(() => useFactoryStore.getState().undo());
  expect(stored("input").targetPerSecond).toBeUndefined();
});

it("choosing Any keeps the number waiting, and a rule brings it back", () => {
  render(<Row id="output" role="product" />);
  fireEvent.click(screen.getByRole("button", { name: /Rule: At least/ }));
  fireEvent.click(screen.getByRole("option", { name: /Any/ }));
  expect(stored("output")).toMatchObject({ targetPerSecond: 3, targetMode: "ignore" });
  expect(screen.getByRole("button", { name: /Your rate: none/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Rule: Any/ }));
  fireEvent.click(screen.getByRole("option", { name: /Exactly/ }));
  expect(stored("output")).toMatchObject({ targetPerSecond: 3, targetMode: "exact" });
});

it("a middle-click on the box clears the rate", () => {
  render(<Row id="output" role="product" />);
  fireEvent(screen.getByRole("button", { name: /Your rate: 3/ }), new MouseEvent("auxclick", { button: 1, bubbles: true }));
  expect(stored("output").targetPerSecond).toBeUndefined();
  expect(screen.getByRole("button", { name: /Your rate: none/ })).toBeTruthy();
});

it("is read-only for viewers", () => {
  useFactoryStore.setState({ isReadOnly: true });
  render(<Row id="output" role="product" />);
  expect((screen.getByRole("button", { name: /Rule:/ }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: /Your rate:/ }) as HTMLButtonElement).disabled).toBe(true);
});

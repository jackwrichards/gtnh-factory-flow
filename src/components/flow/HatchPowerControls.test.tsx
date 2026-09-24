// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import type { FactoryNode, Recipe } from "@/lib/model/types";
import { HatchPowerControls } from "./HatchPowerControls";

vi.mock("@/lib/compact-view", () => ({ isCompactViewport: () => true }));
const recipe: Recipe = { id: "lcr", name: "Reaction", machineType: "Large Chemical Reactor",
  minimumTier: "HV", durationTicks: 400, eut: 480, inputs: [], outputs: [],
  machineHandlers: [{ id: "lcr", label: "Large Chemical Reactor", machineType: "Large Chemical Reactor", minimumTier: "LV", kind: "multiblock" }] };
const initial: FactoryNode = { id: "a", recipeId: "lcr", overclockTier: "HV", hatchVoltageTier: "HV",
  hatchAmps: 2, machineCount: 1, parallel: 1, enabled: true, position: { x: 0, y: 0 } };
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(cleanup);

it("opens without changing power and supports repeated steps, typing, lower tiers and raw EU/t", () => {
  const changed = vi.fn();
  function Harness() {
    const [node, setNode] = useState(initial);
    return <HatchPowerControls recipe={recipe} node={node} mode="build" locked={() => false}
      onChange={(tier, amps, mode) => { changed(tier, amps, mode); setNode({ ...node, hatchVoltageTier: tier, hatchAmps: amps, powerInputMode: mode }); }} />;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Power input unit" }));
  expect(changed).not.toHaveBeenCalled();
  const panel = within(screen.getByRole("dialog"));
  fireEvent.click(panel.getByRole("button", { name: "Increase amps by 1" }));
  fireEvent.click(panel.getByRole("button", { name: "Increase amps by 1" }));
  expect(changed).toHaveBeenLastCalledWith("HV", 4, "amps");
  fireEvent.change(panel.getByRole("textbox"), { target: { value: "12.5" } });
  fireEvent.blur(panel.getByRole("textbox"));
  expect(changed).toHaveBeenLastCalledWith("HV", 12.5, "amps");
  fireEvent.change(panel.getByRole("combobox"), { target: { value: "LV" } });
  expect(changed).toHaveBeenLastCalledWith("LV", 12.5, "amps");
  fireEvent.change(panel.getByRole("combobox"), { target: { value: "eut" } });
  expect(changed).toHaveBeenLastCalledWith("LV", 12.5, "eut");
  fireEvent.click(panel.getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("lifts a supply under one amp to 1A when the tier changes", () => {
  const changed = vi.fn();
  const cheap = { ...recipe, minimumTier: "LV" as const, eut: 30 };
  render(<HatchPowerControls recipe={cheap} node={{ ...initial, hatchVoltageTier: "LV", hatchAmps: 0.9375 }}
    mode="build" locked={() => false} onChange={changed} />);
  fireEvent.click(screen.getByRole("button", { name: "Power input unit" }));
  fireEvent.change(within(screen.getByRole("dialog")).getByRole("combobox"), { target: { value: "HV" } });
  expect(changed).toHaveBeenLastCalledWith("HV", 1, "amps");
});

it("does not open or edit a locked machine", () => {
  const changed = vi.fn();
  render(<HatchPowerControls recipe={recipe} node={initial} mode="build" locked={() => true} onChange={changed} />);
  fireEvent.click(screen.getByRole("button", { name: "Hatch amps" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(changed).not.toHaveBeenCalled();
});

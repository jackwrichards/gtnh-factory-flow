// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { MachineListEntry } from "@/lib/model/machine-list";
import { WorksheetPower } from "./WorksheetPower";

afterEach(cleanup);

it("keeps generator production separate from machine draw and reports both net totals", () => {
  const machine: MachineListEntry = {
    nodeId: "machine",
    label: "Machine",
    handlerId: "machine",
    count: 2,
    hatches: 1,
    isMultiblock: false,
    tierIndex: 1,
    state: "ok",
    euT: 80,
    avgEuT: 40,
  };
  render(
    <WorksheetPower
      entries={[
        machine,
        {
          ...machine,
          nodeId: "generator",
          euT: undefined,
          avgEuT: undefined,
          madeEuT: 100,
          avgMadeEuT: 20,
        },
      ]}
    />,
  );
  const table = screen.getByRole("table", { name: "Pool power totals" });
  expect(within(table).getByRole("row", { name: /Used/ }).textContent).toBe("Used40EU/t80EU/t");
  expect(within(table).getByRole("row", { name: /Made/ }).textContent).toBe("Made20EU/t100EU/t");
  expect(within(table).getByRole("row", { name: /Net/ }).textContent).toBe("Net−20EU/t+20EU/t");
});

// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NeiRecipeWindow } from "./NeiRecipeWindow";

describe("NeiRecipeWindow", () => {
  it("renders Thaumcraft native layouts without GT stats and with aspect icons", () => {
    render(
      <NeiRecipeWindow
        recipe={{
          id: "thaumcraft-infusion",
          name: "Thaumcraft Infusion",
          machineType: "Thaumcraft Infusion",
          minimumTier: "NONE",
          durationTicks: 90,
          eut: 0,
          inputs: [
            { kind: "item", id: "central", amount: 1, neiSlot: { x: 75, y: 58 } },
            {
              kind: "aspect",
              id: "thaumcraft:aspect:ordo",
              amount: 8,
              displayName: "Ordo",
              neiSlot: { x: 75, y: 114 },
            },
          ],
          outputs: [{ kind: "item", id: "result", amount: 1, neiSlot: { x: 75, y: 1 } }],
          source: { recipeMap: "Thaumcraft Infusion" },
          nei: {
            slots: [
              { side: "input", kind: "item", slotIndex: 0, x: 75, y: 58 },
              { side: "input", kind: "aspect", slotIndex: 0, x: 75, y: 114 },
              { side: "output", kind: "item", slotIndex: 0, x: 75, y: 1 },
            ],
            progressBars: [],
          },
        }}
        compact
      />,
    );

    expect(screen.queryByText(/Total:/)).toBeNull();
    expect(screen.queryByText("Arcane Infusion")).toBeNull();
    expect(screen.queryByText("Page 1/1")).toBeNull();
    expect(screen.queryByText("Research")).toBeNull();
    expect(screen.queryByText("See All")).toBeNull();
    const aspectIcon = screen.getByRole("img", { name: "Ordo" });
    const colorLayer = aspectIcon.querySelector("span:last-child") as HTMLElement;
    expect(colorLayer.style.maskImage).toContain("/nei/thaumcraft/aspects/ordo.png");
    expect(colorLayer.style.backgroundColor).toBe("rgb(213, 212, 236)");
    expect(screen.getByText("8")).toBeTruthy();
  });

  it("keeps resource slot recipe/use clicks wired through renderer commands", () => {
    const onSlotClick = vi.fn();
    const { container } = render(
      <NeiRecipeWindow
        recipe={{
          id: "assembler",
          name: "Assembler",
          machineType: "Assembler",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 8,
          inputs: [{ kind: "item", id: "input", amount: 1 }],
          outputs: [{ kind: "item", id: "output", amount: 1 }],
        }}
        compact
        onSlotClick={onSlotClick}
      />,
    );

    const stackButtons = container.querySelectorAll("button.nodrag");
    expect(stackButtons).toHaveLength(2);

    fireEvent.click(stackButtons[0]);
    fireEvent.contextMenu(stackButtons[1]);

    expect(onSlotClick).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ side: "input", kind: "item", slotIndex: 0 }),
      "recipes",
    );
    expect(onSlotClick).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ side: "output", kind: "item", slotIndex: 0 }),
      "uses",
    );
  });
});

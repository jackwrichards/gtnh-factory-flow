// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResourceIcon } from "./ResourceIcon";

describe("ResourceIcon", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  describe("fluids", () => {
    // The dataset carries no art for fluids — not one fluid reference has an
    // iconPath or an atlas entry — so without a fallback they render as an empty
    // slot everywhere in the app.
    function renderFluid(id: string, displayName: string, dominantColor?: string) {
      return render(
        <ResourceIcon
          resource={{ kind: "fluid", id, amount: 1, displayName, dominantColor }}
          tooltip={false}
        />,
      );
    }

    it("draws something for a fluid with no icon at all", () => {
      renderFluid("ic2distilledwater", "Distilled Water");
      expect(screen.getByRole("img", { name: "Distilled Water" })).toBeDefined();
    });

    it("prefers the dataset colour when one exists", () => {
      const { container } = renderFluid("some_fluid", "Some Fluid", "#123456");
      const fill = container.querySelector<HTMLElement>('[role="img"] > span');
      expect(fill?.style.backgroundColor).toBe("rgb(18, 52, 86)");
    });

    it("gives the same fluid the same colour every time", () => {
      // A fluid that changed colour between renders — or between the canvas and
      // this panel — would read as a different resource.
      const first = renderFluid("gt_unknown_fluid", "Unknown");
      const firstColor = first.container.querySelector<HTMLElement>('[role="img"] > span')?.style
        .backgroundColor;
      cleanup();

      const second = renderFluid("gt_unknown_fluid", "Unknown");
      const secondColor = second.container.querySelector<HTMLElement>('[role="img"] > span')?.style
        .backgroundColor;

      expect(firstColor).toBeTruthy();
      expect(secondColor).toBe(firstColor);
    });

    it("gives different fluids different colours", () => {
      const first = renderFluid("fluid_alpha", "Alpha");
      const firstColor = first.container.querySelector<HTMLElement>('[role="img"] > span')?.style
        .backgroundColor;
      cleanup();

      const second = renderFluid("fluid_beta", "Beta");
      const secondColor = second.container.querySelector<HTMLElement>('[role="img"] > span')?.style
        .backgroundColor;

      expect(secondColor).not.toBe(firstColor);
    });

    it("uses the recognisable colour for well-known fluids", () => {
      const { container } = renderFluid("water", "Water");
      const fill = container.querySelector<HTMLElement>('[role="img"] > span');
      expect(fill?.style.backgroundColor).toBe("rgb(63, 118, 228)");
    });

    it("still renders real art when a fluid does have an icon", () => {
      render(
        <ResourceIcon
          resource={{
            kind: "fluid",
            id: "with_art",
            amount: 1,
            displayName: "With Art",
            iconPath: "/textures/rendered/with_art.png",
          }}
          tooltip={false}
        />,
      );
      expect(screen.getByAltText("With Art")).toBeDefined();
    });
  });

  it("hides generated bee species internals from tooltips", async () => {
    render(
      <ResourceIcon
        resource={{
          kind: "item",
          id: "factoryflow:bee_species:gregtech-explosive",
          amount: 1,
          displayName: "Explosive Bee",
          iconPath: "/textures/rendered/explosive_bee.png",
          tooltip: [
            "Bee species",
            "gregtech.bee.speciesExplosive",
            "gregtech.common.bees.GTAlleleBeeSpecies",
          ],
          consumed: false,
        }}
      />,
    );

    fireEvent.mouseMove(screen.getByAltText("Explosive Bee").parentElement as HTMLElement, {
      clientX: 120,
      clientY: 80,
      buttons: 0,
    });

    expect(await screen.findByText("Explosive Bee")).toBeTruthy();
    expect(screen.queryByText("Bee species")).toBeNull();
    expect(screen.queryByText("gregtech.bee.speciesExplosive")).toBeNull();
    expect(screen.queryByText("gregtech.common.bees.GTAlleleBeeSpecies")).toBeNull();
    expect(screen.queryByText("Not consumed")).toBeNull();
  });

  it("colorizes fallback Thaumcraft aspect icons", () => {
    render(
      <ResourceIcon
        resource={{
          kind: "aspect",
          id: "thaumcraft:aspect:ignis",
          amount: 8,
          displayName: "Ignis",
        }}
        showAmount={false}
      />,
    );

    const icon = screen.getByRole("img", { name: "Ignis" });
    expect((icon.querySelector("span:last-child") as HTMLElement).style.backgroundColor).toBe(
      "rgb(255, 90, 1)",
    );
  });

  it("uses the bundled unknown aspect mask for GTNH aspects without static icons", () => {
    render(
      <ResourceIcon
        resource={{
          kind: "aspect",
          id: "thaumcraft:aspect:electrum",
          amount: 8,
          displayName: "Electrum",
          dominantColor: "#d9c35c",
        }}
        showAmount={false}
      />,
    );

    const icon = screen.getByRole("img", { name: "Electrum" });
    expect((icon.querySelector("span:last-child") as HTMLElement).style.maskImage).toContain(
      "/nei/thaumcraft/aspects/_unknown.png",
    );
  });
});

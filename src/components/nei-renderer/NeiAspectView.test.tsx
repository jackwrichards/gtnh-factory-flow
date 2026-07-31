// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NeiAspectCommand } from "@/lib/nei-renderer/core/commands";
import { NeiAspectView } from "./NeiAspectView";

afterEach(cleanup);

describe("NeiAspectView", () => {
  it("renders aspect commands directly with icon and amount", () => {
    const { container } = render(<NeiAspectView command={aspectCommand()} scale={2} />);

    const aspectButton = container.querySelector<HTMLElement>('[data-nei-command="aspect"]');
    expect(aspectButton).toBeTruthy();
    expect(screen.getByRole("img", { name: "Ignis" })).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(container.querySelector('[data-nei-command="item"]')).toBeNull();
  });

  it("uses the unknown aspect fallback for unmapped aspect ids", () => {
    const { container } = render(
      <NeiAspectView
        command={aspectCommand({
          aspectId: "electrum",
          name: "Electrum",
          iconPath: undefined,
        })}
        scale={2}
      />,
    );

    const colorLayer = container.querySelector<HTMLElement>('[role="img"] span:last-child');
    expect(colorLayer?.style.maskImage).toContain("/nei/thaumcraft/aspects/_unknown.png");
  });

  it("keeps aspect slot recipe/use click behavior", () => {
    const onSlotClick = vi.fn();
    const command = aspectCommand();
    render(<NeiAspectView command={command} scale={2} onSlotClick={onSlotClick} />);

    const button = screen.getByRole("button");
    fireEvent.click(button);
    fireEvent.contextMenu(button);

    expect(onSlotClick).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ side: "output", kind: "aspect", slotIndex: 0, x: 10, y: 20 }),
      "recipes",
    );
    expect(onSlotClick).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ side: "output", kind: "aspect", slotIndex: 0, x: 10, y: 20 }),
      "uses",
    );
  });
});

function aspectCommand(
  overrides: Partial<NeiAspectCommand["stack"]["resource"] & { aspectId: string }> = {},
): NeiAspectCommand {
  const resource = {
    aspectId: "ignis",
    name: "Ignis",
    amount: 3,
    iconPath: "/nei/thaumcraft/aspects/ignis.png",
    color: "#ff5a01",
    ...overrides,
  };

  return {
    type: "aspect",
    layer: "aspect",
    x: 10,
    y: 20,
    width: 18,
    height: 18,
    stack: {
      resource,
      side: "output",
      kind: "aspect",
      x: 10,
      y: 20,
      width: 18,
      height: 18,
      slotIndex: 0,
    },
  };
}

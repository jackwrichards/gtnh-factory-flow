// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { NeiDrawCommand } from "@/lib/nei-renderer/core/commands";
import { NeiCommandLayer } from "./NeiCommandLayer";

describe("NeiCommandLayer", () => {
  it("renders texture, progress, and rect commands through real command views", () => {
    const commands: NeiDrawCommand[] = [
      {
        type: "texture",
        layer: "background",
        x: 0,
        y: 0,
        width: 170,
        height: 82,
        imagePath: "/nei/gregtech/gui/background/nei_single_recipe.png",
      },
      {
        type: "progress",
        layer: "progress",
        x: 78,
        y: 24,
        width: 20,
        height: 18,
        direction: "right",
        texture: "arrow",
      },
      {
        type: "rect",
        layer: "decoration",
        x: 4,
        y: 4,
        width: 16,
        height: 8,
        color: "#ff00ff",
      },
    ];

    const { container } = render(
      <NeiCommandLayer layer="background" commands={commands} scale={2} />,
    );

    const texture = container.querySelector<HTMLElement>('[data-nei-command="texture"]');
    const progress = container.querySelector<HTMLElement>('[data-nei-command="progress"]');
    const rect = container.querySelector<HTMLElement>('[data-nei-command="rect"]');

    expect(texture?.style.backgroundImage).toContain("nei_single_recipe.png");
    expect(progress?.style.backgroundImage).toContain("/nei/gregtech/gui/progressbar/arrow.png");
    expect(rect?.style.backgroundColor).toBe("rgb(255, 0, 255)");
  });

  it("keeps debug-bound rect commands on the debug overlay path", () => {
    const { container } = render(
      <NeiCommandLayer
        layer="debug"
        scale={2}
        commands={[
          {
            type: "rect",
            layer: "debug",
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            color: "transparent",
            borderColor: "#00ffff",
            semanticTags: ["debug-bound"],
          },
        ]}
      />,
    );

    expect(container.querySelector('[data-nei-command="rect"]')).toBeNull();
  });
});

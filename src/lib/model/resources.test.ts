import { describe, expect, it } from "vitest";
import {
  formatRate,
  getFilledCellFluidEquivalent,
  isVirtualChoiceResource,
  resourceLabel,
  resourceMatchesInput,
  trimTrailingDecimalZeros,
} from "./resources";

describe("resource helpers", () => {
  it("identifies virtual choice resources that should stay out of resource pickers", () => {
    expect(isVirtualChoiceResource({ id: "oredict:stickWood", displayName: "Stick Wood" })).toBe(
      true,
    );
    expect(
      isVirtualChoiceResource({
        id: "minecraft:stick",
        displayName: "Ore Dictionary: stickWood",
      }),
    ).toBe(true);
    expect(isVirtualChoiceResource({ id: "any:item", displayName: "Any Item" })).toBe(true);
    expect(isVirtualChoiceResource({ id: "minecraft:log@32767", displayName: "Oak Log" })).toBe(
      true,
    );
    expect(isVirtualChoiceResource({ id: "minecraft:log", displayName: "Oak Log" })).toBe(false);
    expect(isVirtualChoiceResource({ id: "minecraft:log@1", displayName: "Spruce Log" })).toBe(
      false,
    );
    expect(isVirtualChoiceResource({ id: "gregtech:gt.metaitem.01:32700", displayName: "Tin Plate" })).toBe(
      false,
    );
  });

  it("removes ore dictionary noise from labels used in recipes", () => {
    expect(resourceLabel({ id: "oredict:stickWood", displayName: "Ore Dictionary: stickWood" })).toBe(
      "stickWood",
    );
  });

  it("trims only decimal zeros from formatted numbers", () => {
    expect(trimTrailingDecimalZeros("90.0")).toBe("90");
    expect(trimTrailingDecimalZeros("500")).toBe("500");
    expect(trimTrailingDecimalZeros("11.50")).toBe("11.5");
    expect(trimTrailingDecimalZeros("1.25")).toBe("1.25");
  });

  it("formats large rates with compact thousands separators", () => {
    expect(formatRate(125829120, 0)).toBe("125.829.120");
    expect(formatRate(3040.5, 1)).toBe("3.041");
    expect(formatRate(77.123, 1)).toBe("77,1");
  });

  it("matches GT filled cells against their fluid equivalent", () => {
    expect(
      resourceMatchesInput(
        { kind: "fluid", id: "molten.magmatter", displayName: "Molten Magmatter" },
        { kind: "item", id: "gregtech:gt.metaitem.99@143", displayName: "Molten Magmatter Cell" },
      ),
    ).toBe(true);
    expect(
      getFilledCellFluidEquivalent({
        kind: "item",
        id: "gregtech:gt.metaitem.99@143",
        amount: 2,
        displayName: "Molten Magmatter Cell",
        alternatives: [
          {
            kind: "fluid",
            id: "molten.magmatter",
            displayName: "Molten Magmatter",
            amount: 144,
          },
        ],
      }),
    ).toEqual({
      kind: "fluid",
      id: "molten.magmatter",
      displayName: "Molten Magmatter",
      amount: 288,
    });
    expect(
      getFilledCellFluidEquivalent({
        kind: "item",
        id: "gregtech:gt.metaitem.01@1",
        amount: 2,
        displayName: "Water Cell",
      }),
    ).toEqual({
      kind: "fluid",
      id: "water",
      displayName: "Water",
      amount: 2000,
    });
  });
});

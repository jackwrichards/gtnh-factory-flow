import { describe, expect, it } from "vitest";
import {
  formatRate,
  getCrossFormCellMatch,
  getFilledCellFluidEquivalent,
  isVirtualChoiceResource,
  resourceLabel,
  resourceMatchesInput,
  trimTrailingDecimalZeros,
} from "./resources";

describe("resource helpers", () => {
  it("matches a cell to its fluid both ways round, tolerant of id spelling", () => {
    const cell = {
      kind: "item" as const,
      id: "gregtech:gt.metaitem.99@304",
      displayName: "Molten Cast Iron Cell",
    };
    // The fluid id does not spell the display name ("molten.castiron", one
    // word): the name-tolerant equivalence must still pair them.
    const fluid = { kind: "fluid" as const, id: "molten.castiron", displayName: "Molten Cast Iron" };
    const expected = { cellId: cell.id, fluidId: fluid.id };
    expect(getCrossFormCellMatch(cell, fluid)).toEqual(expected);
    expect(getCrossFormCellMatch(fluid, cell)).toEqual(expected);
    // An unrelated fluid stays unmatched, and same-kind pairs never answer.
    expect(
      getCrossFormCellMatch(cell, { kind: "fluid", id: "water", displayName: "Water" }),
    ).toBeUndefined();
    expect(getCrossFormCellMatch(cell, cell)).toBeUndefined();
    expect(getCrossFormCellMatch(fluid, fluid)).toBeUndefined();
  });

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
      "Any wooden sticks",
    );
  });

  it("trims only decimal zeros from formatted numbers", () => {
    expect(trimTrailingDecimalZeros("90.0")).toBe("90");
    expect(trimTrailingDecimalZeros("500")).toBe("500");
    expect(trimTrailingDecimalZeros("11.50")).toBe("11.5");
    expect(trimTrailingDecimalZeros("1.25")).toBe("1.25");
  });

  it("formats large rates with compact thousands separators", () => {
    expect(formatRate(125829120, 0)).toBe("125,829,120");
    expect(formatRate(3040.5, 1)).toBe("3,041");
    expect(formatRate(77.123, 1)).toBe("77.1");
  });

  // A filled cell is an item. It does not satisfy the fluid's slot, and the
  // fluid does not satisfy the cell's: crossing the two takes a Canner on the
  // board, exactly as it does in game.
  it("refuses to match a filled cell against its fluid", () => {
    expect(
      resourceMatchesInput(
        { kind: "fluid", id: "molten.magmatter", displayName: "Molten Magmatter" },
        { kind: "item", id: "gregtech:gt.metaitem.99@143", displayName: "Molten Magmatter Cell" },
      ),
    ).toBe(false);
    expect(
      resourceMatchesInput(
        { kind: "item", id: "gregtech:gt.metaitem.01@1", displayName: "Water Cell" },
        { kind: "fluid", id: "water", displayName: "Water" },
      ),
    ).toBe(false);
  });

  // "@32767" is "any damage of this item", not an item. The dataset lists
  // logWood's vanilla members as the two wildcards, and the only producers of a
  // real Oak Log are the Crop Farm bonsai crops and the Tree Growth Simulator,
  // so before this the plant sources could not feed anything that wants a log.
  it("matches the any-damage wildcard against concrete item variants", () => {
    const logWood = {
      kind: "item" as const,
      id: "oredict:logWood",
      displayName: "Ore Dictionary: logWood",
      alternatives: [
        { kind: "item" as const, id: "minecraft:log@32767", displayName: "Oak Log", amount: 1 },
        { kind: "item" as const, id: "minecraft:log2@32767", displayName: "Acacia Log", amount: 1 },
      ],
    };

    for (const id of ["minecraft:log", "minecraft:log@1", "minecraft:log2", "minecraft:log2@1"]) {
      expect(resourceMatchesInput({ kind: "item", id }, logWood)).toBe(true);
    }

    // A recipe that takes the wildcard directly, and the reverse direction: a
    // Centrifuge outputs "minecraft:dirt@32767" into a plain dirt slot.
    expect(
      resourceMatchesInput(
        { kind: "item", id: "minecraft:log@2" },
        { kind: "item", id: "minecraft:log@32767" },
      ),
    ).toBe(true);
    expect(
      resourceMatchesInput(
        { kind: "item", id: "minecraft:dirt@32767" },
        { kind: "item", id: "minecraft:dirt" },
      ),
    ).toBe(true);
  });

  it("keeps the wildcard off items that merely share a name prefix", () => {
    expect(
      resourceMatchesInput(
        { kind: "item", id: "minecraft:log2" },
        { kind: "item", id: "minecraft:log@32767" },
      ),
    ).toBe(false);
    expect(
      resourceMatchesInput(
        { kind: "item", id: "minecraft:log2@1" },
        { kind: "item", id: "minecraft:log@32767" },
      ),
    ).toBe(false);
    // Still an item against a fluid: the cell rule is untouched.
    expect(
      resourceMatchesInput(
        { kind: "fluid", id: "molten.tin@32767" },
        { kind: "item", id: "molten.tin" },
      ),
    ).toBe(false);
  });

  // Search still knows the two forms name the same substance, so looking up a
  // cell can offer the fluid's recipes too. It carries no amount, because
  // nothing converts between them any more.
  it("still names the fluid a cell is a cell of, for search", () => {
    expect(
      getFilledCellFluidEquivalent({
        kind: "item",
        id: "gregtech:gt.metaitem.99@143",
        displayName: "Molten Magmatter Cell",
        alternatives: [
          { kind: "fluid", id: "molten.magmatter", displayName: "Molten Magmatter", amount: 144 },
        ],
      }),
    ).toEqual({ kind: "fluid", id: "molten.magmatter", displayName: "Molten Magmatter" });

    expect(
      getFilledCellFluidEquivalent({
        kind: "item",
        id: "gregtech:gt.metaitem.01@1",
        displayName: "Water Cell",
      }),
    ).toEqual({ kind: "fluid", id: "water", displayName: "Water" });

    expect(
      getFilledCellFluidEquivalent({
        kind: "item",
        id: "gregtech:gt.metaitem.01@0",
        displayName: "Empty Cell",
      }),
    ).toBeUndefined();
  });
});

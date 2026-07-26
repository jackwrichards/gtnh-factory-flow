import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@/examples";
import {
  UNTITLED_DESIGN_NAME,
  createDesign,
  duplicateDesign,
  makeUniqueDesignName,
  normalizeDesignName,
  pickDesignAfterDelete,
  renameDesign,
  sortDesigns,
  updateDesignProject,
  type DesignSummary,
} from "./design-library";

function makeSummary(id: string, name: string, createdAt: string): DesignSummary {
  return { id, name, createdAt, updatedAt: createdAt };
}

describe("normalizeDesignName", () => {
  it("falls back rather than allowing a blank tab", () => {
    expect(normalizeDesignName("   ")).toBe(UNTITLED_DESIGN_NAME);
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeDesignName("  Platline  ")).toBe("Platline");
  });
});

describe("makeUniqueDesignName", () => {
  it("keeps the base name when it is free", () => {
    expect(makeUniqueDesignName("Platline", ["Biodiesel"])).toBe("Platline");
  });

  it("suffixes past a collision", () => {
    expect(makeUniqueDesignName("Platline", ["Platline"])).toBe("Platline (2)");
    expect(makeUniqueDesignName("Platline", ["Platline", "Platline (2)"])).toBe("Platline (3)");
  });

  it("treats names case-insensitively, since tabs read as the same label", () => {
    expect(makeUniqueDesignName("Platline", ["platline"])).toBe("Platline (2)");
  });
});

describe("createDesign", () => {
  it("puts the design name on the plan so the JSON export filename matches", () => {
    const design = createDesign(createEmptyProject(), "Platline");
    expect(design.name).toBe("Platline");
    expect(design.project.name).toBe("Platline");
  });

  it("gives every design a distinct id", () => {
    const first = createDesign(createEmptyProject(), "A");
    const second = createDesign(createEmptyProject(), "B");
    expect(first.id).not.toBe(second.id);
  });
});

describe("duplicateDesign", () => {
  it("names the copy without colliding, and copies the plan", () => {
    const source = createDesign(createEmptyProject(), "Platline");
    const copy = duplicateDesign(source, ["Platline"]);

    expect(copy.name).toBe("Platline copy");
    expect(copy.project.name).toBe("Platline copy");
    expect(copy.id).not.toBe(source.id);
  });

  it("suffixes a second copy", () => {
    const source = createDesign(createEmptyProject(), "Platline");
    const copy = duplicateDesign(source, ["Platline", "Platline copy"]);
    expect(copy.name).toBe("Platline copy (2)");
  });
});

describe("renameDesign", () => {
  it("renames the design and the plan together", () => {
    const design = createDesign(createEmptyProject(), "Old");
    const renamed = renameDesign(design, "New");

    expect(renamed.name).toBe("New");
    expect(renamed.project.name).toBe("New");
    expect(renamed.id).toBe(design.id);
    expect(renamed.createdAt).toBe(design.createdAt);
  });
});

describe("updateDesignProject", () => {
  it("keeps the tab's name when an imported plan carries a different one", () => {
    const design = createDesign(createEmptyProject(), "Platline");
    const imported = { ...createEmptyProject(), name: "Some Other Plan" };

    expect(updateDesignProject(design, imported).project.name).toBe("Platline");
  });
});

describe("sortDesigns", () => {
  it("orders by creation so tabs never move under the pointer", () => {
    const designs = [
      makeSummary("c", "C", "2026-03-01T00:00:00.000Z"),
      makeSummary("a", "A", "2026-01-01T00:00:00.000Z"),
      makeSummary("b", "B", "2026-02-01T00:00:00.000Z"),
    ];

    expect(sortDesigns(designs).map((design) => design.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate its input", () => {
    const designs = [
      makeSummary("b", "B", "2026-02-01T00:00:00.000Z"),
      makeSummary("a", "A", "2026-01-01T00:00:00.000Z"),
    ];
    sortDesigns(designs);
    expect(designs.map((design) => design.id)).toEqual(["b", "a"]);
  });
});

describe("pickDesignAfterDelete", () => {
  const ordered = [
    makeSummary("a", "A", "2026-01-01T00:00:00.000Z"),
    makeSummary("b", "B", "2026-02-01T00:00:00.000Z"),
    makeSummary("c", "C", "2026-03-01T00:00:00.000Z"),
  ];

  it("falls to the neighbour on the left", () => {
    expect(pickDesignAfterDelete(ordered, "b")).toBe("a");
    expect(pickDesignAfterDelete(ordered, "c")).toBe("b");
  });

  it("falls right when the first design goes", () => {
    expect(pickDesignAfterDelete(ordered, "a")).toBe("b");
  });

  it("reports nothing left when the last design goes", () => {
    expect(pickDesignAfterDelete([ordered[0]], "a")).toBeUndefined();
  });
});

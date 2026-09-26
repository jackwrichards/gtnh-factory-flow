import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@/examples";
import {
  UNTITLED_DESIGN_NAME,
  UNTITLED_FOLDER_NAME,
  conflictCopyName,
  createDesign,
  keepStoredPlanMarks,
  createFolder,
  duplicateDesign,
  makeUniqueDesignName,
  normalizeDesignName,
  normalizeFolderName,
  openDesigns,
  pickDesignAfterDelete,
  renameDesign,
  sortDesigns,
  sortFolders,
  stampDesignOrder,
  toDesignSummary,
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

describe("conflictCopyName", () => {
  it("adds the words once, and counts on for a copy of a copy", () => {
    expect(conflictCopyName("Oil", ["Oil"])).toBe("Oil (conflict copy)");
    expect(conflictCopyName("Oil (conflict copy)", ["Oil", "Oil (conflict copy)"])).toBe(
      "Oil (conflict copy) (2)",
    );
    expect(
      conflictCopyName("Oil (conflict copy) (conflict copy) (2)", ["Oil (conflict copy)"]),
    ).toBe("Oil (conflict copy) (2)");
  });

  it("fits the account's 80 characters", () => {
    const name = conflictCopyName("h".repeat(79), []);
    expect(name.length).toBeLessThanOrEqual(80);
    expect(name.endsWith(" (conflict copy)")).toBe(true);
  });
});

describe("keepStoredPlanMarks", () => {
  const stored: DesignSummary = {
    ...makeSummary("a", "Oil", "2026-09-25T10:00:00.000Z"),
    updatedAt: "2026-09-25T12:00:00.000Z",
    icon: { kind: "item", resourceId: "new" },
    communityPlanId: "post",
  };

  it("never moves the plan's stamp back behind a save it did not see", () => {
    const stale: DesignSummary = {
      ...makeSummary("a", "Oil renamed", "2026-09-25T10:00:00.000Z"),
      updatedAt: "2026-09-25T11:00:00.000Z",
      icon: { kind: "item", resourceId: "old" },
      remoteUpdatedAt: "2026-09-25T11:00:00.000Z",
    };
    expect(keepStoredPlanMarks(stale, stored)).toEqual({
      ...stale,
      updatedAt: stored.updatedAt,
      icon: stored.icon,
      communityPlanId: "post",
    });
  });

  it("writes a summary that saw the stored plan as it is", () => {
    const fresh = { ...stored, name: "Renamed", icon: undefined };
    expect(keepStoredPlanMarks(fresh, stored)).toBe(fresh);
    expect(keepStoredPlanMarks(fresh, undefined)).toBe(fresh);
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

  it("puts a hand-picked order ahead of creation order", () => {
    const designs = [
      { ...makeSummary("a", "A", "2026-01-01T00:00:00.000Z"), order: 1 },
      { ...makeSummary("b", "B", "2026-02-01T00:00:00.000Z"), order: 0 },
    ];

    expect(sortDesigns(designs).map((design) => design.id)).toEqual(["b", "a"]);
  });

  it("sends a design without an order to the end of a rearranged strip", () => {
    const designs = [
      makeSummary("new", "New", "2026-01-01T00:00:00.000Z"),
      { ...makeSummary("a", "A", "2026-02-01T00:00:00.000Z"), order: 0 },
      { ...makeSummary("b", "B", "2026-03-01T00:00:00.000Z"), order: 1 },
    ];

    expect(sortDesigns(designs).map((design) => design.id)).toEqual(["a", "b", "new"]);
  });
});

describe("stampDesignOrder", () => {
  const summaries = [
    makeSummary("a", "A", "2026-01-01T00:00:00.000Z"),
    makeSummary("b", "B", "2026-02-01T00:00:00.000Z"),
    makeSummary("c", "C", "2026-03-01T00:00:00.000Z"),
  ];

  it("stamps every summary with its place in the given order", () => {
    const stamped = stampDesignOrder(summaries, ["c", "a", "b"]);
    expect(stamped.map((design) => design.id)).toEqual(["c", "a", "b"]);
    expect(stamped.map((design) => design.order)).toEqual([0, 1, 2]);
  });

  it("appends a summary the order list missed instead of losing it", () => {
    const stamped = stampDesignOrder(summaries, ["c", "a"]);
    expect(stamped.map((design) => design.id)).toEqual(["c", "a", "b"]);
    expect(stamped.map((design) => design.order)).toEqual([0, 1, 2]);
  });

  it("ignores ids the strip does not know", () => {
    const stamped = stampDesignOrder(summaries, ["ghost", "b", "a", "c"]);
    expect(stamped.map((design) => design.id)).toEqual(["b", "a", "c"]);
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

describe("toDesignSummary", () => {
  it("carries the shelf fields and reads the post mark off the plan", () => {
    const record = {
      ...createDesign(createEmptyProject(), "Oil"),
      closed: true,
      folderId: "f1",
    };
    record.project = {
      ...record.project,
      metadata: { communityPlanId: "post-1" },
    };
    const summary = toDesignSummary(record);
    expect(summary.closed).toBe(true);
    expect(summary.folderId).toBe("f1");
    expect(summary.communityPlanId).toBe("post-1");
  });

  it("leaves open, unposted designs unflagged", () => {
    const record = createDesign(createEmptyProject(), "Oil");
    const summary = toDesignSummary(record);
    expect(summary.closed).toBeUndefined();
    expect(summary.communityPlanId).toBeUndefined();
  });
});

describe("openDesigns", () => {
  it("is the strip: everything not closed, in order", () => {
    const a = makeSummary("a", "A", "2026-01-01");
    const b = { ...makeSummary("b", "B", "2026-01-02"), closed: true };
    const c = makeSummary("c", "C", "2026-01-03");
    expect(openDesigns([a, b, c]).map((design) => design.id)).toEqual(["a", "c"]);
  });
});

describe("folders", () => {
  it("names a blank folder rather than allowing one with no label", () => {
    expect(normalizeFolderName("  ")).toBe(UNTITLED_FOLDER_NAME);
    expect(createFolder(" Oil ").name).toBe("Oil");
  });

  it("lists folders by name, case aside", () => {
    const folders = [
      { id: "1", name: "steel", createdAt: "2026-01-01" },
      { id: "2", name: "Bees", createdAt: "2026-01-02" },
      { id: "3", name: "oil", createdAt: "2026-01-03" },
    ];
    expect(sortFolders(folders).map((folder) => folder.name)).toEqual(["Bees", "oil", "steel"]);
  });
});

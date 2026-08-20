import { describe, expect, it } from "vitest";
import { planContentFingerprint } from "./plan-fingerprint";

const plan = {
  schemaVersion: 1,
  id: "p1",
  name: "Platline",
  description: "A platinum line.",
  icon: { kind: "item", resourceId: "platinum_dust" },
  view: { rightPanelOpen: true },
  metadata: { communityPlanId: "abc", updatedAt: "2026-01-01" },
  recipes: [{ id: "r1", name: "Macerate" }],
  nodes: [{ id: "n1", recipeId: "r1", position: { x: 0, y: 20 } }],
  edges: [{ id: "e1", source: "n1", target: "n1" }],
};

describe("planContentFingerprint", () => {
  it("ignores key order", () => {
    const shuffled = {
      edges: [{ target: "n1", source: "n1", id: "e1" }],
      nodes: [{ position: { y: 20, x: 0 }, recipeId: "r1", id: "n1" }],
      recipes: [{ name: "Macerate", id: "r1" }],
      schemaVersion: 1,
      id: "p1",
      name: "Platline",
      description: "A platinum line.",
      icon: { kind: "item", resourceId: "platinum_dust" },
      view: { rightPanelOpen: true },
      metadata: { updatedAt: "2026-01-01", communityPlanId: "abc" },
    };
    expect(planContentFingerprint(shuffled)).toBe(planContentFingerprint(plan));
  });

  it("ignores identity, view and metadata: renaming a copy is not a board change", () => {
    const dressed = {
      ...plan,
      id: "other",
      name: "My remix",
      description: "Now with notes of my own.",
      icon: { kind: "fluid", resourceId: "lubricant" },
      view: { rightPanelOpen: false },
      metadata: { communityPlanId: "xyz", communityFingerprint: "stale" },
    };
    expect(planContentFingerprint(dressed)).toBe(planContentFingerprint(plan));
  });

  it("treats an absent key and an undefined key the same", () => {
    const sparse = { ...plan, targetRate: undefined, storages: undefined };
    expect(planContentFingerprint(sparse)).toBe(planContentFingerprint(plan));
  });

  it("changes when the board changes", () => {
    const moved = {
      ...plan,
      nodes: [{ id: "n1", recipeId: "r1", position: { x: 20, y: 20 } }],
    };
    const rewired = { ...plan, edges: [] };
    expect(planContentFingerprint(moved)).not.toBe(planContentFingerprint(plan));
    expect(planContentFingerprint(rewired)).not.toBe(planContentFingerprint(plan));
  });

  it("returns empty for non-objects rather than throwing", () => {
    expect(planContentFingerprint(undefined)).toBe("");
    expect(planContentFingerprint("json")).toBe("");
  });
});

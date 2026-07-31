import { describe, expect, it } from "vitest";
import {
  buildTextSearchIndex,
  getWildcardResource,
  queryTextSearchIndex,
  searchTokensMatch,
} from "./dataset-query";

describe("dataset query text search", () => {
  it("matches substrings inside tokens without matching across token boundaries", () => {
    const index = buildTextSearchIndex(["Hydrogen Sulfide"], [0]);

    const sulfideCandidates = queryTextSearchIndex(index, ["ulfide"]) ?? [0];
    expect(sulfideCandidates).toContain(0);
    expect(searchTokensMatch(index.tokensByEntry[0] ?? [], ["ulfide"])).toBe(true);

    const crossBoundaryCandidates = queryTextSearchIndex(index, ["nsu"]) ?? [0];
    expect(crossBoundaryCandidates).not.toContain(0);
    expect(searchTokensMatch(index.tokensByEntry[0] ?? [], ["nsu"])).toBe(false);
  });
});

describe("wildcard uses matching", () => {
  it("bridges damaged item ids to their any-damage wildcard", () => {
    expect(getWildcardResource({ kind: "item", id: "minecraft:log@1" })).toEqual({
      kind: "item",
      id: "minecraft:log@32767",
    });
  });

  it("bridges bare damage-0 item ids the same way", () => {
    // Regression: Oak Log ("minecraft:log", no "@") used to skip the wildcard
    // bridge entirely and lost every any-damage recipe (Coke Oven, Pyrolyse
    // Oven, Macerator, ...) from its uses listing.
    expect(getWildcardResource({ kind: "item", id: "minecraft:log" })).toEqual({
      kind: "item",
      id: "minecraft:log@32767",
    });
  });

  it("does not bridge wildcards or fluids", () => {
    expect(getWildcardResource({ kind: "item", id: "minecraft:log@32767" })).toBeUndefined();
    expect(getWildcardResource({ kind: "fluid", id: "water" })).toBeUndefined();
  });
});

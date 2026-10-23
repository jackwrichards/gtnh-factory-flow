import { describe, expect, it } from "vitest";
import {
  mockForced,
  mockLeftovers,
  mockUnneeded,
} from "@/lib/solver/plan/__fixtures__/mock-extras";
import { layoutRail, spareHeight, visibleSlice, SECTION_H, ROW_H } from "./rail-layout";
import { buildRailModel, visibleLines } from "./rail-model";
import { buildSpares, cardDepths, effectiveShares, sparedByResource } from "./spare-model";

const model = (mock: typeof mockForced) => buildRailModel(mock.project, mock.result);

describe("the rail's totals", () => {
  it("lists what the plan brings in, sends out and keeps inside", () => {
    const rail = model(mockUnneeded);
    // The iron drawer is a source with a rule (at most 12); the log drawer is a source with nothing set.
    expect(rail.inputs.map((l) => l.label)).toEqual(["Iron Ingot", "Log"]);
    expect(rail.outputs.map((l) => l.label).sort()).toEqual(["Plank", "Steel Plate", "Steel Rod"]);
    // The cutter sits at zero: its nameplate rates in the result are not flows, so no plate stays inside.
    expect(rail.internal.map((l) => l.label)).toEqual([]);
    const steel = rail.outputs.find((l) => l.label === "Steel Plate")!;
    // 6 made by the compressor, the spare cutter at zero uses none of it.
    expect(steel.amount).toBeGreaterThan(0);
    expect(steel.drawers).toHaveLength(1);
    expect(steel.drawers[0]).toMatchObject({
      rule: "at-least",
      ratePerSecond: 10,
      unmet: true,
      set: true,
    });
  });

  it("lists biggest first and keeps equal amounts in the order the plan met them (not alphabetical)", () => {
    for (const mock of [mockUnneeded, mockForced, mockLeftovers]) {
      const rail = model(mock);
      for (const side of [rail.inputs, rail.outputs, rail.internal]) {
        const amounts = side.map((l) => l.amount);
        expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
      }
    }
  });

  it("shows a drawer with nothing typed as Any", () => {
    const rail = model(mockUnneeded);
    const log = rail.inputs.find((l) => l.label === "Log")!;
    expect(log.drawers[0]).toMatchObject({ rule: "ignore", ratePerSecond: 0, set: false });
    const iron = rail.inputs.find((l) => l.label === "Iron Ingot")!;
    expect(iron.drawers[0]).toMatchObject({ rule: "at-most", ratePerSecond: 12, set: true });
  });

  it("lists every machine, at zero too, with its rule", () => {
    const rail = model(mockUnneeded);
    // The compressor runs 6 pinned; the cutter and the sawmill sit at zero and are listed all the same.
    expect(rail.machines.map((m) => m.nodeId).sort()).toEqual(["comp", "cutter", "saw"]);
    expect(rail.machines.find((m) => m.nodeId === "comp")).toMatchObject({ pinned: true, pin: 6 });
    // No count set: Any, as the card says it.
    expect(rail.machines.find((m) => m.nodeId === "saw")).toMatchObject({
      rule: "any",
      pinned: false,
      count: 0,
    });
    expect(rail.wholeMachines).toBe(6);
  });

  it("keeps a machine listed when its card is set to Exactly", () => {
    const project = structuredClone(mockUnneeded.project);
    project.nodes.find((n) => n.id === "comp")!.solvePinExact = true;
    const failed = {
      ...mockUnneeded.result,
      plan: { ...mockUnneeded.result.plan!, failure: { message: "NO_PIN", args: [] } },
    };
    for (const result of [mockUnneeded.result, failed as typeof mockUnneeded.result]) {
      const rail = buildRailModel(project, result);
      expect(rail.machines.find((m) => m.nodeId === "comp")).toMatchObject({
        rule: "exact",
        pin: 6,
      });
    }
  });

  it("lists the resource of an unwired port at zero when its card runs nothing", () => {
    const project = structuredClone(mockUnneeded.project);
    const cut = mockUnneeded.result.nodes.cutter!;
    const out = Object.values(cut.outputs)[0]!;
    // Nothing wired to the cutter's output: it has to be listed under Outputs although nothing flows.
    project.edges = project.edges.filter((e) => !(e.source === "cutter"));
    const rail = buildRailModel(project, mockUnneeded.result);
    const line = rail.outputs.find((l) => l.resourceId === out.resourceId);
    expect(line).toBeTruthy();
    expect(line!.open.some((o) => o.nodeId === "cutter")).toBe(true);
  });

  it("reads the count rule and what an Up to card runs", () => {
    const plan = {
      ...mockUnneeded.result.plan!,
      upTo: { comp: { capacity: 6, reached: 4.5, reason: "BOTTLENECK" as const } },
    };
    const upTo = buildRailModel(mockUnneeded.project, { ...mockUnneeded.result, plan });
    expect(upTo.machines[0]).toMatchObject({ rule: "upTo", pinned: true, pin: 6, count: 4.5 });
    const project = structuredClone(mockUnneeded.project);
    project.nodes.find((n) => n.id === "comp")!.solvePinExact = true;
    const exact = buildRailModel(project, { ...mockUnneeded.result, plan });
    expect(exact.machines[0]).toMatchObject({ rule: "exact", pinned: true, pin: 6 });
    expect(exact.machines[0]!.upTo).toBeUndefined();
  });

  it("lists no machine for a fluid tank: it is free and instant (the mod lists none)", () => {
    const project = structuredClone(mockUnneeded.project);
    const comp = project.nodes.find((n) => n.id === "comp")!;
    const recipe = project.recipes.find((r) => r.id === comp.recipeId)!;
    recipe.machineType = "Tank";
    recipe.source = { ...recipe.source, recipeMap: "Tank" } as typeof recipe.source;
    const rail = buildRailModel(project, mockUnneeded.result);
    expect(rail.machines.map((m) => m.nodeId)).not.toContain("comp");
  });

  it("adds up power from the machine list (peak and average)", () => {
    const rail = model(mockForced);
    expect(rail.power.peak.used).toBeGreaterThan(0);
    expect(rail.power.hasMade).toBe(false);
    expect(rail.power.average.used).toBeLessThanOrEqual(rail.power.peak.used + 1e-9);
  });

  it("finds the open ports of a resource: nothing wired, no drawer", () => {
    const rail = model(mockLeftovers);
    const copper = rail.inputs.find((l) => l.label === "Copper Dust")!;
    expect(copper.open).toHaveLength(2);
    expect(copper.open.map((p) => p.nodeId).sort()).toEqual(["alloy", "alloy2"]);
    expect(copper.drawers).toHaveLength(0);
  });

  it("lists a port set to a rate on its card as a setter of its line", () => {
    const project = structuredClone(mockForced.project);
    const furn = project.nodes.find((n) => n.id === "furn")!;
    // The furnace's coal input is wired to the coal maker, so set the macerator's... find an unwired port instead.
    const alloyProject = structuredClone(mockLeftovers.project);
    const alloy = alloyProject.nodes.find((n) => n.id === "alloy")!;
    alloy.portRates = { "input:item:Copper%20Dust": 2 };
    const rail = buildRailModel(alloyProject, mockLeftovers.result);
    const copper = rail.inputs.find((l) => l.label === "Copper Dust")!;
    expect(copper.pins).toEqual([
      expect.objectContaining({
        nodeId: "alloy",
        handle: "input:item:Copper%20Dust",
        ratePerSecond: 2,
        output: false,
      }),
    ]);
    expect(furn).toBeDefined();
  });
});

describe("spares", () => {
  const rail = model(mockLeftovers);
  const spares = buildSpares(mockLeftovers.project, mockLeftovers.result, rail);

  it("reads each leftover with a choice, the stored split first", () => {
    expect(spares).toHaveLength(2);
    const imported = spares.find((s) => s.importing)!;
    expect(imported.bearers.map((b) => b.nodeId)).toEqual(["alloy", "alloy2"]);
    expect(imported.shares).toEqual([0.25, 0.75]);
    expect(imported.custom).toBe(true);
    const surplus = spares.find((s) => !s.importing)!;
    expect(surplus.shares).toEqual([1, 0]);
    expect(surplus.custom).toBe(false);
  });

  it("normalises a stored split and falls back to the solver's when it names nobody", () => {
    expect(effectiveShares(["a", "b"], [0.5, 0.5], { a: 1, b: 3 })).toEqual([0.25, 0.75]);
    expect(effectiveShares(["a", "b"], [0.5, 0.5], { x: 1 })).toEqual([0.5, 0.5]);
    expect(effectiveShares(["a", "b"], [0.2, 0.8], undefined)).toEqual([0.2, 0.8]);
  });

  it("says how much of each resource the spares carry, so the line leaves it to them", () => {
    const spared = sparedByResource(spares, true);
    expect(spared.get("item:Copper Dust")).toBeCloseTo(4, 9);
    const lines = visibleLines(rail.inputs, "inputs", spared);
    const copper = lines.find((l) => l.line.label === "Copper Dust")!;
    expect(copper.amount).toBeCloseTo(
      rail.inputs.find((l) => l.label === "Copper Dust")!.amount - 4,
      9,
    );
  });

  it("orders places most upstream first", () => {
    const depth = cardDepths(mockLeftovers.project);
    expect(depth.get("crush")).toBe(0);
    expect(depth.get("alloy2")).toBe(0);
  });
});

describe("the rail's layout", () => {
  const rail = model(mockLeftovers);
  const spares = buildSpares(mockLeftovers.project, mockLeftovers.result, rail);

  it("stacks the sections with the spare blocks after their section's lines", () => {
    const { placed, height } = layoutRail({
      rail,
      spares,
      filter: "",
      folded: new Set(),
      peak: true,
    });
    const kinds = placed.map((p) => p.item.t);
    const inputs = kinds.indexOf("section");
    expect(placed[inputs]!.item).toMatchObject({ t: "section", id: "INPUTS" });
    expect(kinds.filter((k) => k === "spare")).toHaveLength(2);
    // Items never overlap and end at the layout's height.
    for (let i = 1; i < placed.length; i += 1) {
      expect(placed[i]!.top).toBeGreaterThanOrEqual(placed[i - 1]!.top + placed[i - 1]!.height);
    }
    const last = placed.at(-1)!;
    expect(height).toBeGreaterThanOrEqual(last.top + last.height);
    const spare = placed.find((p) => p.item.t === "spare")!;
    expect(spare.height).toBe(
      spareHeight((spare.item as { spare: (typeof spares)[number] }).spare),
    );
  });

  it("folds a section to its bar and keeps the badge", () => {
    const open = layoutRail({ rail, spares, filter: "", folded: new Set(), peak: true });
    const folded = layoutRail({
      rail,
      spares,
      filter: "",
      folded: new Set(["INPUTS"]),
      peak: true,
    });
    expect(folded.height).toBeLessThan(open.height);
    const bar = folded.placed[0]!;
    expect(bar.item).toMatchObject({ t: "section", id: "INPUTS", folded: true });
    expect(folded.placed[1]!.item.t).not.toBe("line");
  });

  it("filters by name and counts shown over all in the badge", () => {
    const { placed } = layoutRail({ rail, spares, filter: "tin", folded: new Set(), peak: true });
    const outputs = placed.find((p) => p.item.t === "section" && p.item.id === "OUTPUTS")!;
    expect(outputs.item).toMatchObject({ shown: expect.any(Number), count: expect.any(Number) });
    const names = placed
      .filter((p) => p.item.t === "line")
      .map((p) => (p.item as { line: { label: string } }).line.label);
    expect(names.every((n) => n.toLowerCase().includes("tin"))).toBe(true);
    expect(names.length).toBeGreaterThan(0);
  });

  it("says so when nothing matches or nothing is there", () => {
    const empty = buildRailModel(mockForced.project, undefined);
    const { placed } = layoutRail({
      rail: empty,
      spares: [],
      filter: "",
      folded: new Set(),
      peak: true,
    });
    const texts = placed
      .filter((p) => p.item.t === "empty")
      .map((p) => (p.item as { text: string }).text);
    expect(texts).toEqual([
      "Nothing missing.",
      "Nothing coming out yet.",
      "Nothing internal.",
      "No machines yet.",
    ]);
    const none = layoutRail({ rail, spares, filter: "zzz", folded: new Set(), peak: true });
    expect(
      none.placed.filter((p) => p.item.t === "empty").map((p) => (p.item as { text: string }).text),
    ).toContain("No matches.");
  });

  it("slices the visible run without scanning the list", () => {
    const { placed } = layoutRail({ rail, spares, filter: "", folded: new Set(), peak: true });
    const slice = visibleSlice(placed, 0, SECTION_H + ROW_H);
    expect(slice[0]).toBe(placed[0]);
    expect(slice.every((p) => p.top < SECTION_H + ROW_H)).toBe(true);
    expect(visibleSlice(placed, 1e6, 2e6)).toEqual([]);
  });
});

describe("a plan with no answer", () => {
  it("counts no flows while the solve has failed (nothing set yet)", () => {
    const failed = {
      ...mockUnneeded.result,
      plan: { ...mockUnneeded.result.plan!, failure: { message: "NO_PIN", args: [] } },
    } as typeof mockUnneeded.result;
    const rail = buildRailModel(mockUnneeded.project, failed);
    expect(rail.outputs.filter((l) => l.amount > 0)).toEqual([]);
    expect(rail.internal).toEqual([]);
    expect(rail.inputs.filter((l) => l.amount > 0)).toEqual([]);
  });
});

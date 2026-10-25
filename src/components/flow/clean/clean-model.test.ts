// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { FactoryNode } from "@/lib/model/types";
import type { RailPort } from "../node-verdict";
import type { PlanSolveExtras, PlanUpTo } from "@/lib/solver/plan/types";
import { makePortKey } from "@/lib/solver/plan/port-key";
import { mockUpTo } from "@/lib/solver/plan/__fixtures__/mock-extras";
import { UP_TO_COLOR } from "./up-to-reason";
import { mixHex } from "./colors";
import { CC } from "./tokens";
import {
  FOOT_TRACK,
  buildCountView,
  buildFootView,
  cardPicture,
  cardCountState,
  circuitNumber,
  frameTone,
  parseCountText,
  pinActions,
  pinPatch,
  reasonStripes,
  stateFrameTone,
  wheelCount,
  wheelDraft,
  withReasonPorts,
  type CleanPortView,
} from "./clean-model";

const node = (
  pin?: number,
  exact?: boolean,
): Pick<FactoryNode, "id" | "solvePin" | "solvePinExact"> => ({
  id: "n",
  ...(pin !== undefined ? { solvePin: pin } : {}),
  ...(exact ? { solvePinExact: true } : {}),
});

const plan = (upTo?: Record<string, PlanUpTo>, extra: Partial<PlanSolveExtras> = {}) =>
  ({
    forced: [],
    leftovers: [],
    unneeded: [],
    unanchored: [],
    terminals: [],
    notes: [],
    openGates: 0,
    ...(upTo ? { upTo } : {}),
    ...extra,
  }) as PlanSolveExtras;

const result = (needed: number) => ({ theoreticalMachinesRequired: needed }) as never;

function port(
  side: "input" | "output",
  name: string,
  forced?: { number: string; unit: string },
): CleanPortView {
  const id = name;
  return {
    key: `${side}:${id}`,
    nodeId: "n",
    handleId: `${side}:item:${encodeURIComponent(id)}`,
    side,
    port: { side, kind: "item", resourceId: id, displayName: name } as unknown as RailPort,
    number: "1",
    unit: "/s",
    name,
    title: name,
    zero: false,
    gold: false,
    numberSmall: false,
    nameSmall: false,
    nameClipped: false,
    wired: true,
    choice: false,
    resourceKey: `item:${id}`,
    forced,
  };
}

const ports = {
  inputs: [port("input", "Oxygen"), port("input", "Sulfur Dust")],
  outputs: [port("output", "Sulfuric Acid")],
};

describe("the count", () => {
  it("reads Any, Up to and Exactly through the pin rule", () => {
    // No count: Any, nothing pinned.
    const fresh = cardCountState(result(3), node(), plan());
    expect([fresh.rule, fresh.pinned]).toEqual(["any", false]);
    expect(cardCountState(result(3), node(4), plan()).rule).toBe("upTo");
    expect(cardCountState(result(3), node(4, true), plan()).rule).toBe("exact");
    // A custom rate card's set count is always Exactly.
    expect(cardCountState(result(1), node(1), plan(), { machineType: "Custom Rate" }).rule).toBe(
      "exact",
    );
  });

  it("runs an Up to card's reached count, from the plan's read-out under the card's id", () => {
    const upTo = { n: { capacity: 24, reached: 18.2, reason: "STARVED" as const } };
    const state = cardCountState(result(18.2), node(24), plan(upTo));
    expect(state.value).toBe(18.2);
    const view = buildCountView(state);
    expect(view.text).toBe("×18.2");
    expect(view.ruleWord).toBe("Up to");
    expect(view.setText).toBe("24");
    expect(view.box).toBe("24");
    // A read-out left over from before the card went Exactly is not this card's.
    expect(cardCountState(result(24), node(24, true), plan(upTo)).value).toBe(24);
  });

  it("always says the rule and fills the set box: the count, or Set with none, asking while nothing sets it", () => {
    const exact = buildCountView(cardCountState(result(24), node(24, true), plan()));
    expect([exact.text, exact.ruleWord, exact.setText, exact.box]).toEqual([
      "×24",
      "Exactly",
      "24",
      "24",
    ]);
    // A new card: Any with the Set box asking while nothing sets this part of the plan.
    const fresh = buildCountView(
      cardCountState(result(0), node(), plan(undefined, { unanchored: ["n"] })),
    );
    expect([fresh.ruleWord, fresh.box, fresh.prompt]).toEqual(["Any", "Set", true]);
    expect(fresh.title).toBe("How many of this machine the plan needs.");
    const any = buildCountView(cardCountState(result(1.2), node(), plan()));
    expect([any.text, any.ruleWord, any.setText, any.box, any.prompt]).toEqual([
      "×1.2",
      "Any",
      "",
      "Set",
      false,
    ]);
    const crop = buildCountView(cardCountState(result(12), node(), plan()), { noTimes: true });
    expect([crop.text, crop.ruleWord, crop.box]).toEqual(["12", "Any", "Set"]);
    // A custom rate card has no Up to: with no count it is Any.
    const rate = buildCountView(
      cardCountState(result(1), node(), plan(), { machineType: "Custom Rate" }),
      { ruleFixed: true },
    );
    expect(rate.ruleWord).toBe("Any");
    // An idle Up to card is not asked for a count: it says UNUSED in its bar.
    const idle = buildCountView(
      cardCountState(
        result(0),
        node(3),
        plan({ n: { capacity: 3, reached: 0, reason: "UNUSED" } }, { unneeded: ["n"] }),
      ),
    );
    expect([idle.prompt, idle.zero, idle.text]).toEqual([false, true, "×0"]);
  });

  it("steps on the wheel: from Any at what runs rounded up, then by one, below one back to Any", () => {
    expect(wheelCount({ rule: "any", value: 18.2 }, 1)).toBe(19);
    expect(wheelCount({ rule: "any", value: 18.2 }, -1)).toBe(19);
    expect(wheelCount({ rule: "any", value: 0 }, 1)).toBe(1);
    expect(wheelCount({ rule: "upTo", set: 24, value: 18.2 }, 1)).toBe(25);
    expect(wheelCount({ rule: "exact", set: 2.5, value: 2.5 }, -1)).toBe(2);
    expect(wheelCount({ rule: "upTo", set: 1, value: 1 }, -1)).toBeUndefined();
  });

  it("reads a typed count: a number, zero or nothing for Any, anything else sets nothing", () => {
    expect(parseCountText("24")).toBe(24);
    expect(parseCountText(" ×2.5 ")).toBe(2.5);
    expect(parseCountText("x3")).toBe(3);
    expect(parseCountText("")).toBe(0);
    expect(parseCountText("0")).toBe(0);
    expect(parseCountText("-2")).toBeUndefined();
    expect(parseCountText("lots")).toBeUndefined();
  });

  it("steps the number in an open box on the wheel, from what is typed", () => {
    // What is typed, rounded, then by one: the box shows the step, nothing is set yet.
    expect(wheelDraft("24", { value: 18.2 }, 1)).toBe("25");
    expect(wheelDraft("3", { value: 18.2 }, -1)).toBe("2");
    expect(wheelDraft("2.6", { value: 1 }, 1)).toBe("4");
    // Below one is an empty box: Any once set.
    expect(wheelDraft("1", { value: 1 }, -1)).toBe("");
    // An empty box starts where the wheel starts an Any card: what runs, rounded up.
    expect(wheelDraft("", { value: 18.2 }, 1)).toBe("19");
    expect(wheelDraft("", { value: 18.2 }, -1)).toBe("19");
    expect(wheelDraft("", { value: 0 }, 1)).toBe("1");
  });
});

describe("writing a count", () => {
  it("goes through withPinRule: Any clears the count, Up to clears the flag, Exactly sets it", () => {
    const none = { solvePin: undefined, solvePinExact: undefined };
    expect(pinPatch(node(4, true), "any", 4)).toEqual(none);
    expect(pinPatch(node(4, true), "upTo", 6)).toEqual({ ...none, solvePin: 6 });
    expect(pinPatch(node(), "exact", 3)).toEqual({ ...none, solvePin: 3, solvePinExact: true });
    // A cleared count is Any.
    expect(pinPatch(node(4), "upTo", 0)).toEqual(none);
    expect(pinPatch(node(4, true), "exact", undefined)).toEqual(none);
  });

  it("keeps the rule on a typed or stepped count, starts Up to from Any, and takes the rule menu's pick", () => {
    const writes: Array<Pick<FactoryNode, "solvePin" | "solvePinExact">> = [];
    const update = (_id: string, patch: Pick<FactoryNode, "solvePin" | "solvePinExact">) =>
      void writes.push(patch);
    const locked = () => false;
    const any = buildCountView(cardCountState(result(18.2), node(), plan()));
    const fromAny = pinActions(node(), any, update, locked);
    fromAny.setCount(7);
    fromAny.stepCount(1);
    fromAny.setRule("exact");
    expect(writes).toEqual([
      { solvePin: 7, solvePinExact: undefined },
      { solvePin: 19, solvePinExact: undefined },
      { solvePin: 19, solvePinExact: true },
    ]);
    writes.length = 0;
    const exact = buildCountView(cardCountState(result(4), node(4, true), plan()));
    const onExact = pinActions(node(4, true), exact, update, locked);
    onExact.setCount(5);
    onExact.stepCount(-1);
    onExact.setRule("upTo");
    onExact.setCount(undefined);
    expect(writes).toEqual([
      { solvePin: 5, solvePinExact: true },
      { solvePin: 3, solvePinExact: true },
      { solvePin: 4, solvePinExact: undefined },
      { solvePin: undefined, solvePinExact: undefined },
    ]);
  });

  it("starts a new card on Any, clears a count back to Any, and types Up to again after Exactly", () => {
    const writes: Array<Pick<FactoryNode, "solvePin" | "solvePinExact">> = [];
    const update = (_id: string, patch: (typeof writes)[number]) => void writes.push(patch);
    const locked = () => false;
    const fresh = buildCountView(cardCountState(result(18.2), node(), plan()));
    const onFresh = pinActions(node(), fresh, update, locked);
    // Any is what it already reads: nothing to write.
    onFresh.setRule("any");
    expect(writes).toEqual([]);
    onFresh.setCount(7);
    expect(writes).toStrictEqual([{ solvePin: 7, solvePinExact: undefined }]);
    writes.length = 0;
    const exact = buildCountView(cardCountState(result(4), node(4, true), plan()));
    const onExact = pinActions(node(4, true), exact, update, locked);
    // Picking Any or clearing the count (the middle button, an empty box) is Any.
    onExact.setRule("any");
    onExact.setCount(0);
    expect(writes).toStrictEqual([
      { solvePin: undefined, solvePinExact: undefined },
      { solvePin: undefined, solvePinExact: undefined },
    ]);
    writes.length = 0;
    // Back on Any, the next count typed is Up to, not Exactly.
    const cleared = buildCountView(cardCountState(result(4), node(), plan()));
    pinActions(node(), cleared, update, locked).setCount(5);
    expect(writes).toStrictEqual([{ solvePin: 5, solvePinExact: undefined }]);
  });

  it("keeps a custom rate card Exactly and writes nothing while locked", () => {
    const update = vi.fn();
    const rate = buildCountView(
      cardCountState(result(1), node(1), plan(), { machineType: "Custom Rate" }),
      {
        ruleFixed: true,
      },
    );
    const actions = pinActions(node(1), rate, update, () => false);
    actions.setCount(2);
    actions.setRule("upTo");
    expect(update.mock.calls).toEqual([["n", { solvePin: 2, solvePinExact: true }]]);
    const lockedUpdate = vi.fn();
    pinActions(node(1), rate, lockedUpdate, () => true).setCount(3);
    expect(lockedUpdate).not.toHaveBeenCalled();
  });
});

describe("the bar along the foot", () => {
  const upToCount = { rule: "upTo" as const, set: 24 };

  it("fills to reached over the count, with the reason's word, line and fraction", () => {
    const starved = buildFootView(
      upToCount,
      { capacity: 24, reached: 18.2, reason: "STARVED", resourceKey: "item:Oxygen" },
      ports,
    )!;
    expect([starved.tone, starved.word, starved.say, starved.frac]).toEqual([
      "starved",
      "STARVED",
      "short of Oxygen",
      "18.2 / 24",
    ]);
    expect(starved.fill).toBe(Math.round((FOOT_TRACK * 18.2) / 24));
    expect(starved.ghost).toBeUndefined();

    const full = buildFootView(upToCount, { capacity: 24, reached: 24, reason: "FULL" }, ports)!;
    expect([full.tone, full.word, full.say, full.frac, full.fill]).toEqual([
      "full",
      "FULL",
      "nothing wants more",
      "24 / 24",
      FOOT_TRACK,
    ]);

    const clogged = buildFootView(
      upToCount,
      { capacity: 24, reached: 12, reason: "CLOGGED", resourceKey: "item:Sulfuric Acid" },
      ports,
    )!;
    expect([clogged.word, clogged.say, clogged.frac]).toEqual([
      "CLOGGED",
      "Sulfuric Acid has nowhere to go",
      "12 / 24",
    ]);

    const unused = buildFootView(
      upToCount,
      { capacity: 24, reached: 0, reason: "UNUSED", resourceKey: "item:Sulfuric Acid" },
      ports,
    )!;
    expect([unused.tone, unused.say, unused.frac, unused.fill]).toEqual([
      "unused",
      "nothing takes Sulfuric Acid",
      "0 / 24",
      0,
    ]);

    const limited = buildFootView(
      upToCount,
      { capacity: 24, reached: 20, reason: "LIMITED" },
      ports,
    )!;
    expect([limited.tone, limited.word, limited.say]).toEqual([
      "limited",
      "LIMITED",
      "the plan holds it back",
    ]);
  });

  it("says DEAD LOOP or CLOG LOCK in the ring's tone on a card in a ring", () => {
    const dead = buildFootView(
      upToCount,
      { capacity: 24, reached: 0, reason: "STARVED", resourceKey: "item:Oxygen" },
      ports,
      undefined,
      "dead",
    )!;
    expect([dead.tone, dead.word, dead.say, dead.facts.loop]).toEqual([
      "starved",
      "DEAD LOOP",
      "short of Oxygen",
      "dead",
    ]);
    // A clog lock's cards stand still (UNUSED), but the bar says what backs up, in CLOGGED's purple, not UNUSED's grey.
    const clog = buildFootView(
      upToCount,
      { capacity: 24, reached: 0, reason: "UNUSED", resourceKey: "item:Sulfuric Acid" },
      ports,
      undefined,
      "clog",
    )!;
    expect([clog.tone, clog.word, clog.facts.loop]).toEqual(["clogged", "CLOG LOCK", "clog"]);
    expect(clog.say).toMatch(/Sulfuric Acid|an output backs up/);
  });

  it("runs a bottleneck's bar on, striped, to what the line wants", () => {
    const neck = buildFootView(
      upToCount,
      { capacity: 24, reached: 24, reason: "BOTTLENECK", wants: 31 },
      ports,
    )!;
    expect([neck.tone, neck.word, neck.say, neck.frac]).toEqual([
      "bottleneck",
      "BOTTLENECK",
      "the line wants 31",
      "24 / 31",
    ]);
    const end = Math.round((FOOT_TRACK * 24) / 31);
    expect(neck.fill).toBe(end);
    expect(neck.ghost).toEqual({ left: end, width: FOOT_TRACK - end });
    expect(neck.facts.wants).toBe(31);
  });

  it("names the short row's ties and the full cards upstream for the tip", () => {
    const tied = buildFootView(
      upToCount,
      {
        capacity: 24,
        reached: 12,
        reason: "STARVED",
        resourceKey: "item:Oxygen",
        tied: [makePortKey("n", "i", "input:item:Sulfur%20Dust")],
        upstream: ["e1", "gone"],
      },
      ports,
      (id) => (id === "e1" ? "Electrolyzer" : undefined),
    )!;
    expect(tied.facts.resource).toBe("Oxygen");
    expect(tied.facts.tied).toEqual(["Sulfur Dust"]);
    expect(tied.facts.upstream).toEqual(["Electrolyzer", "a card"]);
  });

  it("shortens the line rather than cutting a word", () => {
    const long = "Sodium Hydroxide Solution With A Very Long Name Indeed";
    const clogged = buildFootView(
      upToCount,
      { capacity: 24, reached: 12, reason: "CLOGGED", resourceKey: `item:${long}` },
      { inputs: [], outputs: [port("output", long)] },
    )!;
    expect([`nowhere for ${long}`, "an output backs up"]).toContain(clogged.say);
  });

  it("shows the fill and fraction with no word when the reason was not worked out", () => {
    const none = buildFootView(upToCount, { capacity: 6, reached: 4.5, reason: null }, ports)!;
    expect([none.tone, none.word, none.say, none.frac]).toEqual(["plain", "", "", "4.5 / 6"]);
  });

  it("says FORCED IN on an Exactly card fed by a forced input, and nothing for Any or Exactly with nothing forced", () => {
    const fed = {
      inputs: [
        port("input", "Oxygen", { number: "720", unit: "L/s" }),
        port("input", "Sulfur Dust"),
      ],
      outputs: ports.outputs,
    };
    const forced = buildFootView({ rule: "exact", set: 24 }, undefined, fed)!;
    expect([forced.tone, forced.word, forced.say, forced.frac, forced.fill]).toEqual([
      "forced",
      "FORCED IN",
      "720 L/s of Oxygen to keep all 24 running",
      "",
      0,
    ]);
    expect(forced.facts.forced).toEqual(["720 L/s Oxygen"]);
    expect(buildFootView({ rule: "exact", set: 24 }, undefined, ports)).toBeUndefined();
    expect(buildFootView({ rule: "any" }, undefined, fed)).toBeUndefined();
    // An Up to card's bar comes from its read-out alone; with none yet there is no bar.
    expect(buildFootView(upToCount, undefined, fed)).toBeUndefined();
  });
});

describe("the frame", () => {
  it("takes a problem's tone; full, plain and no bar keep the edge", () => {
    expect(frameTone({ tone: "bottleneck" })).toBe("bottleneck");
    expect(frameTone({ tone: "forced" })).toBe("forced");
    expect(frameTone({ tone: "full" })).toBeUndefined();
    expect(frameTone({ tone: "plain" })).toBeUndefined();
    expect(frameTone(undefined)).toBeUndefined();
  });

  it("is the same on a shell, from the count and the plan alone", () => {
    const starved = plan({ n: { capacity: 3, reached: 1, reason: "STARVED" } });
    expect(stateFrameTone(cardCountState(result(1), node(3), starved), starved, "n")).toBe(
      "starved",
    );
    const full = plan({ n: { capacity: 3, reached: 3, reason: "FULL" } });
    expect(stateFrameTone(cardCountState(result(3), node(3), full), full, "n")).toBeUndefined();
    const forced = plan(undefined, {
      forced: [
        { nodeId: "n#r1", portKey: "n#r1|i|x", side: "in", resourceKey: "item:x", perSecond: 1 },
      ],
    });
    expect(stateFrameTone(cardCountState(result(2), node(2, true), forced), forced, "n")).toBe(
      "forced",
    );
    expect(stateFrameTone(cardCountState(result(2), node(), forced), forced, "n")).toBeUndefined();
  });
});

describe("the rows a reason names", () => {
  const lit = (ports: CleanPortView[]) =>
    ports.filter((port) => port.why).map((port) => `${port.name}=${port.why}`);

  it("lights STARVED's short input and its ties in the reason's colour", () => {
    const starved = withReasonPorts(ports.inputs, {
      capacity: 24,
      reached: 12,
      reason: "STARVED",
      portKey: makePortKey("n", "i", "input:item:Oxygen"),
      resourceKey: "item:Oxygen",
      tied: [makePortKey("n", "i", "input:item:Sulfur%20Dust")],
    });
    expect(lit(starved)).toEqual(["Oxygen=starved", "Sulfur Dust=starved"]);
  });

  it("lights CLOGGED's and UNUSED's output, and nothing for FULL, BOTTLENECK or no reason", () => {
    const key = makePortKey("n", "o", "output:item:Sulfuric%20Acid");
    const clogged = { capacity: 24, reached: 12, reason: "CLOGGED" as const, portKey: key };
    expect(lit(withReasonPorts(ports.outputs, clogged))).toEqual(["Sulfuric Acid=clogged"]);
    expect(
      lit(withReasonPorts(ports.outputs, { ...clogged, reason: "UNUSED", reached: 0 })),
    ).toEqual(["Sulfuric Acid=unused"]);
    for (const reason of ["FULL", "BOTTLENECK", "LIMITED", null] as const) {
      expect(
        lit(withReasonPorts([...ports.inputs, ...ports.outputs], { ...clogged, reason })),
      ).toEqual([]);
    }
    expect(lit(withReasonPorts(ports.outputs, undefined))).toEqual([]);
  });

  it("finds a shared machine's row by its recipe's prefix, and only the card's own rows", () => {
    const section = { ...port("input", "Mix"), handleId: "r1:input:item:Mix" };
    const plain = port("input", "Mix");
    const starved = withReasonPorts([plain, section], {
      capacity: 3,
      reached: 1,
      reason: "STARVED",
      portKey: makePortKey("n#r1", "i", "input:item:Mix"),
    });
    expect(starved.map((p) => p.why)).toEqual([undefined, "starved"]);
  });

  it("falls back to the row of its resource when the read-out names no port", () => {
    const starved = withReasonPorts(ports.inputs, {
      capacity: 3,
      reached: 1,
      reason: "STARVED",
      resourceKey: "item:Sulfur Dust",
    });
    expect(lit(starved)).toEqual(["Sulfur Dust=starved"]);
  });
});

describe("the reason colours", () => {
  it("are the overview's: CLOGGED purple, LIMITED pink", () => {
    expect(UP_TO_COLOR.CLOGGED).toBe("#b49cf0");
    expect(UP_TO_COLOR.LIMITED).toBe("#f472b6");
  });

  it("stripe a lit row as the free ends mix theirs: 7% body, 13% stripe into the surface", () => {
    for (const tone of ["starved", "clogged", "unused"] as const) {
      const hex = UP_TO_COLOR[tone.toUpperCase() as "STARVED" | "CLOGGED" | "UNUSED"];
      expect(reasonStripes(tone)).toEqual({
        body: mixHex(hex, CC.surface, 0.07),
        stripe: mixHex(hex, CC.surface, 0.13),
      });
    }
    // The free ends' own mixes, for comparison: the source's blue gives the input tile's stripe.
    expect(mixHex(CC.source, CC.surface, 0.13)).toBe("#2E3844");
    expect(reasonStripes("forced")).toBeUndefined();
  });
});

describe("the circuit", () => {
  it("is numbered by the recipe's setting, else by the item's own", () => {
    expect(circuitNumber({ setting: "24" })).toBe("24");
    expect(
      circuitNumber({
        resource: { kind: "item", id: "gregtech:gt.integrated_circuit@7", amount: 0 } as never,
      }),
    ).toBe("7");
    expect(circuitNumber({})).toBeUndefined();
  });
});

describe("the Up to mock", () => {
  it("has a read-out for every Up to card and every reason", () => {
    const extras = mockUpTo.result.plan!;
    const upToCards = mockUpTo.project.nodes.filter(
      (n) => (n.solvePin ?? 0) > 0 && !n.solvePinExact,
    );
    expect(Object.keys(extras.upTo!).sort()).toEqual(upToCards.map((n) => n.id).sort());
    const reasons = new Set(Object.values(extras.upTo!).map((entry) => entry.reason));
    expect(reasons).toEqual(
      new Set(["FULL", "BOTTLENECK", "STARVED", "CLOGGED", "UNUSED", "LIMITED", null]),
    );
    expect(extras.forced.map((entry) => entry.nodeId)).toEqual(["exact"]);
  });
});

describe("the card's picture", () => {
  const uranium = { kind: "item", id: "factoryflow:bee_species:uranium", displayName: "Uranium Princess", amount: 1 };
  const alveary = { kind: "item", id: "forestry:alveary", displayName: "Alveary", amount: 1 };
  const mapIcons = new Map([["Bee Produce", uranium]]) as unknown as Parameters<typeof cardPicture>[4];
  const beeRecipe = {
    id: "salt",
    name: "Salt Bee",
    kind: "bee_produce",
    category: "forestry-bee",
    machineType: "Apiary",
    source: { recipeMap: "Bee Produce" },
  } as unknown as Parameters<typeof cardPicture>[0];
  const beeNode = { id: "bee", overclockTier: "NONE" } as unknown as FactoryNode;
  const face = (id: string) =>
    ({ selectedMachineHandler: { id, label: id }, tierControl: undefined }) as unknown as Parameters<typeof cardPicture>[2];

  it("never takes a bee map's specimen for the machine", () => {
    const none = new Map() as Parameters<typeof cardPicture>[3];
    expect(cardPicture(beeRecipe, beeNode, face("magic-apiary"), none, mapIcons).machineIcon).toBeUndefined();
  });

  it("wears the housing's own face", () => {
    const entries = new Map([["alveary", { familyId: "alveary", resource: alveary }]]) as unknown as Parameters<
      typeof cardPicture
    >[3];
    expect(cardPicture(beeRecipe, beeNode, face("alveary"), entries, mapIcons).machineIcon?.displayName).toBe("Alveary");
  });

  it("still falls back to the map's machine for other recipes", () => {
    const mixer = { kind: "item", id: "gregtech:mixer", displayName: "Basic Mixer", amount: 1 };
    const recipe = { id: "m", name: "Mixer", machineType: "Mixer", source: { recipeMap: "Mixer" } } as unknown as Parameters<
      typeof cardPicture
    >[0];
    const icons = new Map([["Mixer", mixer]]) as unknown as Parameters<typeof cardPicture>[4];
    const none = new Map() as Parameters<typeof cardPicture>[3];
    expect(cardPicture(recipe, beeNode, face("mixer"), none, icons).machineIcon?.displayName).toBe("Basic Mixer");
  });
});

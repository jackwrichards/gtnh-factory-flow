import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject, type FactoryStorage } from "@/lib/model/types";
import { calculateThroughput } from "./throughput";

/**
 * The plan is a CLOSED system.
 *
 * Nothing appears from nowhere and nothing vanishes. The only places that
 * rule is suspended are the ones a player declares by hand: a SOURCE drawer
 * (nothing feeds it), a DRAIN drawer (nothing draws from it), and the trash
 * can, which is a drain you can watch destroying things. A BUFFER is neither
 * and passes on exactly what its takers pull.
 *
 * So every fixture here wires its own boundary, deliberately and visibly -
 * these are the tests that are ABOUT the boundary, so they must never go
 * through `closeBoundaries`.
 *
 * Every recipe runs exactly one operation per second: 20 ticks at 20 ticks/s,
 * one machine, no parallel, and LV on an LV recipe is not an overclock. So an
 * output of `n` is a rate of `n` per second and the percentages below can be
 * read straight off the amounts.
 */

function recipe(id: string, inputs: [string, number][], outputs: [string, number][]) {
  return {
    id,
    name: id,
    machineType: "Bender",
    minimumTier: "LV",
    durationTicks: 20,
    eut: 30,
    inputs: inputs.map(([itemId, amount]) => ({ kind: "item" as const, id: itemId, amount })),
    outputs: outputs.map(([itemId, amount]) => ({ kind: "item" as const, id: itemId, amount })),
  };
}

function node(id: string, recipeId: string) {
  return {
    id,
    recipeId,
    machineCount: 1,
    parallel: 1,
    overclockTier: "LV",
    enabled: true,
    position: { x: 0, y: 0 },
  };
}

function drawer(id: string, resourceId: string): FactoryStorage {
  return { id, kind: "item", resourceId, position: { x: 0, y: 0 } };
}

function wire(id: string, source: string, target: string, resourceId: string) {
  return { id, source, target, resourceKind: "item" as const, resourceId };
}

function project(over: Partial<FactoryProject>): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "conservation",
    name: "conservation",
    recipes: [],
    nodes: [],
    edges: [],
    fuelProfiles: [],
    ...over,
  } as FactoryProject;
}

const DUAL = [
  recipe("dual", [], [["redstone", 10], ["gold", 5]]),
  recipe("eat-redstone", [["redstone", 5]], [["rsblock", 1]]),
  recipe("eat-gold", [["gold", 5]], [["goldblock", 1]]),
];

/** The two takers' own products, drained, so only the case under test binds. */
const TAKER_DRAINS = {
  storages: [drawer("d-rs", "rsblock"), drawer("d-au", "goldblock")],
  edges: [wire("d1", "rs", "d-rs", "rsblock"), wire("d2", "au", "d-au", "goldblock")],
};

describe("conservation: a wired surplus has to go somewhere", () => {
  it("clogs a machine whose wired output makes more than its takers pull", () => {
    // 10 redstone + 5 gold. Redstone taker wants 5, gold taker wants 5. The
    // gold coupling wants the machine at 100%; the spare 5 redstone has
    // nowhere to go, so disposal pins it at 50% and the gold taker goes short.
    const result = calculateThroughput(
      project({
        recipes: DUAL,
        nodes: [node("dual", "dual"), node("rs", "eat-redstone"), node("au", "eat-gold")],
        storages: TAKER_DRAINS.storages,
        edges: [
          wire("r1", "dual", "rs", "redstone"),
          wire("g1", "dual", "au", "gold"),
          ...TAKER_DRAINS.edges,
        ],
      }),
      { generatedAt: "fixed" },
    );

    const dual = result.nodes["dual"];
    expect(dual.utilization).toBeCloseTo(0.5);
    expect(dual.disposalUtilization).toBeCloseTo(0.5);
    expect(dual.clogOutputKey).toBe("item:redstone");
    // The gold taker is genuinely starved by the clog, and the books say so.
    expect(result.edges["g1"].transferredPerSecond).toBeCloseTo(2.5);
    // Nothing is invented and nothing vanishes: 5 redstone made, 5 taken.
    expect(result.unconsumedOutputs.find((b) => b.resourceId === "redstone")).toBeUndefined();
  });

  it("a DRAIN drawer on the spare output unclogs it", () => {
    const result = calculateThroughput(
      project({
        recipes: DUAL,
        nodes: [node("dual", "dual"), node("rs", "eat-redstone"), node("au", "eat-gold")],
        storages: [...TAKER_DRAINS.storages, drawer("spare", "redstone")],
        edges: [
          wire("r1", "dual", "rs", "redstone"),
          wire("g1", "dual", "au", "gold"),
          wire("r2", "dual", "spare", "redstone"),
          ...TAKER_DRAINS.edges,
        ],
      }),
      { generatedAt: "fixed" },
    );

    const dual = result.nodes["dual"];
    expect(dual.utilization).toBeCloseTo(1);
    expect(dual.clogOutputKey).toBeUndefined();
    expect(result.edges["g1"].transferredPerSecond).toBeCloseTo(5);
    // The drain takes exactly the 5 that had nowhere to go.
    expect(result.storages["spare"].producedPerSecond).toBeCloseTo(5);
  });

  it("a BUFFER catches the overflow, visibly, and the machine keeps running", () => {
    // Same drawer, but something draws from it, so it is a BUFFER now - and a
    // buffer behaves like the chest it is in game: it relays the 1/s its taker
    // wants and CATCHES the rest, filling at a rate the books show. Nothing is
    // hidden (the fill rate is the surplus, in the open) and nothing is
    // invented (its takers can never draw more than really arrived).
    const result = calculateThroughput(
      project({
        recipes: [...DUAL, recipe("sip-redstone", [["redstone", 1]], [["rsdust", 1]])],
        nodes: [
          node("dual", "dual"),
          node("rs", "eat-redstone"),
          node("au", "eat-gold"),
          node("sip", "sip-redstone"),
        ],
        storages: [...TAKER_DRAINS.storages, drawer("mid", "redstone"), drawer("d-sip", "rsdust")],
        edges: [
          wire("r1", "dual", "rs", "redstone"),
          wire("g1", "dual", "au", "gold"),
          wire("r2", "dual", "mid", "redstone"),
          wire("r3", "mid", "sip", "redstone"),
          wire("d3", "sip", "d-sip", "rsdust"),
          ...TAKER_DRAINS.edges,
        ],
      }),
      { generatedAt: "fixed" },
    );

    const dual = result.nodes["dual"];
    expect(dual.utilization).toBeCloseTo(1);
    expect(dual.clogOutputKey).toBeUndefined();
    expect(result.edges["g1"].transferredPerSecond).toBeCloseTo(5);
    // The taker's 5 go to the taker; the buffer catches the other 5, hands
    // its sipper the 1 it wants, and banks the 4 nobody asked for.
    expect(result.storages["mid"].producedPerSecond).toBeCloseTo(5);
    expect(result.storages["mid"].netPerSecond).toBeCloseTo(4);
  });

  it("a STRICT buffer only takes what its own takers pull", () => {
    // The opt-out. Set the buffer strict and it is a pure pass-through again:
    // it relays the 1/s its taker wants, declines the rest, and the machine
    // clogs at the level that adds up - for players who want the imbalance
    // surfaced on the machine rather than stored in a tank.
    const result = calculateThroughput(
      project({
        recipes: [...DUAL, recipe("sip-redstone", [["redstone", 1]], [["rsdust", 1]])],
        nodes: [
          node("dual", "dual"),
          node("rs", "eat-redstone"),
          node("au", "eat-gold"),
          node("sip", "sip-redstone"),
        ],
        storages: [
          ...TAKER_DRAINS.storages,
          { ...drawer("mid", "redstone"), bufferMode: "strict" as const },
          drawer("d-sip", "rsdust"),
        ],
        edges: [
          wire("r1", "dual", "rs", "redstone"),
          wire("g1", "dual", "au", "gold"),
          wire("r2", "dual", "mid", "redstone"),
          wire("r3", "mid", "sip", "redstone"),
          wire("d3", "sip", "d-sip", "rsdust"),
          ...TAKER_DRAINS.edges,
        ],
      }),
      { generatedAt: "fixed" },
    );

    const dual = result.nodes["dual"];
    // 5 to the taker + 1 through the buffer = 6 of 10 redstone can move.
    expect(dual.utilization).toBeCloseTo(0.6);
    expect(dual.clogOutputKey).toBe("item:redstone");
    expect(result.storages["mid"].producedPerSecond).toBeCloseTo(1);
  });

  it("a trash can absorbs without limit, exactly as before", () => {
    const result = calculateThroughput(
      project({
        recipes: [
          ...DUAL,
          { ...recipe("void", [], []), machineType: "Trash Can", name: "Trash Can" },
        ],
        nodes: [
          node("dual", "dual"),
          node("rs", "eat-redstone"),
          node("au", "eat-gold"),
          node("can", "void"),
        ],
        storages: TAKER_DRAINS.storages,
        edges: [
          wire("r1", "dual", "rs", "redstone"),
          wire("g1", "dual", "au", "gold"),
          wire("r2", "dual", "can", "redstone"),
          ...TAKER_DRAINS.edges,
        ],
      }),
      { generatedAt: "fixed" },
    );

    expect(result.nodes["dual"].utilization).toBeCloseTo(1);
    expect(result.nodes["dual"].clogOutputKey).toBeUndefined();
    expect(result.edges["g1"].transferredPerSecond).toBeCloseTo(5);
  });
});

describe("conservation: both ends, or the machine does not run", () => {
  it("stops a machine whose output has no wire at all", () => {
    // The gold is wired and wanted; the redstone has nothing on it. Under the
    // closed rule that is a full output bus, so the whole machine stops -
    // including the gold its taker is waiting for.
    const result = calculateThroughput(
      project({
        recipes: DUAL,
        nodes: [node("dual", "dual"), node("au", "eat-gold")],
        storages: [drawer("d-au", "goldblock")],
        edges: [wire("g1", "dual", "au", "gold"), wire("d2", "au", "d-au", "goldblock")],
      }),
      { generatedAt: "fixed" },
    );

    expect(result.nodes["dual"].utilization).toBeCloseTo(0);
    expect(result.nodes["dual"].disposalUtilization).toBeCloseTo(0);
    expect(result.edges["g1"].transferredPerSecond).toBeCloseTo(0);
    // Nothing was made, so nothing is spare. The old model booked 10/s of
    // redstone here as an output the plan produced out of a bare port.
    expect(result.unconsumedOutputs.find((b) => b.resourceId === "redstone")).toBeUndefined();
  });

  it("a machine stopped by a bare slot advertises nothing downstream", () => {
    // Reported from a real board: a Blast Furnace sat at 0% with one output
    // unwired, and the Chemical Reactor it fed still read 12.5% - computed
    // from material that never arrived. Capability is deliberately blind to a
    // CLOG (one wire away, and blinding it is what stops an idle ring reading
    // as a dead loop), but a machine with a bare slot is not throttled, it is
    // stopped, and it must not advertise a rate nobody can collect.
    const result = calculateThroughput(
      project({
        recipes: [
          // wired output "gold", plus a "redstone" nobody takes
          recipe("dual", [], [["redstone", 10], ["gold", 5]]),
          recipe("eat-gold", [["gold", 5]], [["goldblock", 1]]),
        ],
        nodes: [node("dual", "dual"), node("au", "eat-gold")],
        storages: [drawer("d-au", "goldblock")],
        edges: [wire("g1", "dual", "au", "gold"), wire("d2", "au", "d-au", "goldblock")],
      }),
      { generatedAt: "fixed" },
    );

    expect(result.nodes["dual"].utilization).toBeCloseTo(0);
    // The consumer must agree with the wire, not with a phantom.
    expect(result.edges["g1"].transferredPerSecond).toBeCloseTo(0);
    expect(result.edges["g1"].availablePerSecond).toBeCloseTo(0);
    expect(result.nodes["au"].utilization).toBeCloseTo(0);
    expect(result.nodes["au"].capableUtilization).toBeCloseTo(0);
  });

  it("stops a machine whose input has no wire at all", () => {
    // The mirror. `eat-gold` has a drain on its product but nothing feeding
    // it, and an empty input bus is as final as a full output one.
    const result = calculateThroughput(
      project({
        recipes: DUAL,
        nodes: [node("au", "eat-gold")],
        storages: [drawer("d-au", "goldblock")],
        edges: [wire("d2", "au", "d-au", "goldblock")],
      }),
      { generatedAt: "fixed" },
    );

    expect(result.nodes["au"].utilization).toBeCloseTo(0);
    expect(result.nodes["au"].capableUtilization).toBeCloseTo(0);
    // A machine that never runs eats nothing, so it asks the plan for nothing.
    expect(result.externalInputs.find((b) => b.resourceId === "gold")).toBeUndefined();
  });

  it("a SOURCE drawer is how a plan says it imports something", () => {
    const result = calculateThroughput(
      project({
        recipes: DUAL,
        nodes: [node("au", "eat-gold")],
        storages: [drawer("src", "gold"), drawer("d-au", "goldblock")],
        edges: [wire("s1", "src", "au", "gold"), wire("d2", "au", "d-au", "goldblock")],
      }),
      { generatedAt: "fixed" },
    );

    expect(result.nodes["au"].utilization).toBeCloseTo(1);
    expect(result.edges["s1"].transferredPerSecond).toBeCloseTo(5);
    // Declared, and still honestly booked as something you have to bring in:
    // drawers add nothing to the resource books.
    expect(result.externalInputs[0]?.resourceId).toBe("gold");
  });
});

describe("conservation: a product pulls, a byproduct catches", () => {
  const TARGETED = {
    recipes: [recipe("make", [], [["plate", 10]])],
    nodes: [node("m", "make")],
    targetRate: { kind: "item" as const, resourceId: "plate", amountPerSecond: 2 },
  };

  it("a PRODUCT drawer asks its feeder for everything the machine can make", () => {
    const result = calculateThroughput(
      project({
        ...TARGETED,
        storages: [drawer("d", "plate")],
        edges: [wire("o", "m", "d", "plate")],
      }),
      { generatedAt: "fixed" },
    );

    // Nobody dialled it down as far as the drawer is concerned: it wants the
    // lot, so the machine runs flat out and banks 10/s against a 2/s target.
    expect(result.nodes["m"].utilization).toBeCloseTo(1);
    expect(result.edges["o"].demandPerSecond).toBeCloseTo(10);
    expect(result.edges["o"].transferredPerSecond).toBeCloseTo(10);
  });

  it("a BYPRODUCT drawer asks for nothing, so the target sets the pace", () => {
    const result = calculateThroughput(
      project({
        ...TARGETED,
        storages: [{ ...drawer("d", "plate"), drainMode: "byproduct" as const }],
        edges: [wire("o", "m", "d", "plate")],
      }),
      { generatedAt: "fixed" },
    );

    // The same board, one pill flipped: the only thing still asking is the
    // 2/s target, so the machine runs at a fifth and the drawer just catches
    // what that produces.
    expect(result.nodes["m"].utilization).toBeCloseTo(0.2);
    expect(result.edges["o"].demandPerSecond).toBeCloseTo(0);
    expect(result.edges["o"].transferredPerSecond).toBeCloseTo(2);
  });

  it("a byproduct drawer still counts as somewhere to go, so nothing clogs", () => {
    // The redstone/gold case with the spare redstone caught rather than
    // pulled: the gold taker still gets its full 5/s, which is the whole
    // point of giving the leftover a home.
    const result = calculateThroughput(
      project({
        recipes: DUAL,
        nodes: [node("dual", "dual"), node("rs", "eat-redstone"), node("au", "eat-gold")],
        storages: [
          ...TAKER_DRAINS.storages,
          { ...drawer("spare", "redstone"), drainMode: "byproduct" as const },
        ],
        edges: [
          wire("r1", "dual", "rs", "redstone"),
          wire("g1", "dual", "au", "gold"),
          wire("r2", "dual", "spare", "redstone"),
          ...TAKER_DRAINS.edges,
        ],
      }),
      { generatedAt: "fixed" },
    );

    expect(result.nodes["dual"].utilization).toBeCloseTo(1);
    expect(result.nodes["dual"].clogOutputKey).toBeUndefined();
    expect(result.edges["g1"].transferredPerSecond).toBeCloseTo(5);
    expect(result.storages["spare"].producedPerSecond).toBeCloseTo(5);
  });
});

describe("conservation: drawers", () => {
  it("a fed drawer still hands out only what it received", () => {
    const result = calculateThroughput(
      project({
        recipes: [
          recipe("make-cobble", [], [["cobble", 10]]),
          recipe("eat-cobble", [["cobble", 20]], [["gravel", 1]]),
        ],
        nodes: [node("producer", "make-cobble"), node("taker", "eat-cobble")],
        storages: [drawer("mid", "cobble"), drawer("d-gravel", "gravel")],
        edges: [
          wire("e1", "producer", "mid", "cobble"),
          wire("e2", "mid", "taker", "cobble"),
          wire("e3", "taker", "d-gravel", "gravel"),
        ],
      }),
      { generatedAt: "fixed" },
    );

    expect(result.edges["e2"].transferredPerSecond).toBeCloseTo(10);
    expect(result.nodes["taker"].utilization).toBeCloseTo(0.5);
    // The buffer's taker wants 20, so the producer is asked for 20 and reads
    // as under-built rather than clogged: its output moves everything it makes.
    expect(result.nodes["producer"].clogOutputKey).toBeUndefined();
    expect(result.externalInputs).toHaveLength(0);
  });

  it("an unfed drawer is still the declared import", () => {
    const result = calculateThroughput(
      project({
        recipes: [recipe("eat-cobble", [["cobble", 20]], [["gravel", 1]])],
        nodes: [node("taker", "eat-cobble")],
        storages: [drawer("src", "cobble"), drawer("d-gravel", "gravel")],
        edges: [
          wire("e2", "src", "taker", "cobble"),
          wire("e3", "taker", "d-gravel", "gravel"),
        ],
      }),
      { generatedAt: "fixed" },
    );

    expect(result.edges["e2"].transferredPerSecond).toBeCloseTo(20);
    expect(result.nodes["taker"].utilization).toBeCloseTo(1);
    expect(result.externalInputs[0]?.resourceId).toBe("cobble");
  });

  it("a drawer of the same item on an unwired chain changes nothing", () => {
    // The bug this pins: pools were keyed by ITEM, so every drawer holding
    // cobble was one tank. A second chain that merely PRODUCED cobble gave the
    // first chain's source drawer a sink, dropped its offer from infinite to
    // that chain's output, and starved a line it shares no wire with.
    const chain = {
      recipes: [
        recipe("eat-cobble", [["cobble", 20]], [["gravel", 1]]),
        recipe("make-cobble", [], [["cobble", 3]]),
      ],
      nodes: [node("taker", "eat-cobble"), node("faraway", "make-cobble")],
      storages: [
        drawer("src", "cobble"),
        drawer("d-gravel", "gravel"),
        // Same item, opposite role, no wire to any of the above.
        drawer("other-cobble", "cobble"),
      ],
      edges: [
        wire("e2", "src", "taker", "cobble"),
        wire("e3", "taker", "d-gravel", "gravel"),
        wire("e4", "faraway", "other-cobble", "cobble"),
      ],
    };

    const result = calculateThroughput(project(chain), { generatedAt: "fixed" });

    // The untouched chain runs exactly as it did without the neighbour.
    expect(result.edges["e2"].transferredPerSecond).toBeCloseTo(20);
    expect(result.nodes["taker"].utilization).toBeCloseTo(1);
    // And the neighbour runs on its own merits, not on the source's imports.
    expect(result.nodes["faraway"].utilization).toBeCloseTo(1);
    expect(result.edges["e4"].transferredPerSecond).toBeCloseTo(3);
  });

  it("one resource can be a need and a byproduct at the same time", () => {
    // Carbon is imported at a source drawer for the main line, and a second
    // line makes spare carbon that lands in a byproduct drawer. Netting used
    // to report a single figure - "you need 7" - which quietly claimed the
    // spare 3 feeds the need across a gap with no wire in it. Both are true
    // and both are listed: bring 10 in over here, haul 3 away over there.
    const result = calculateThroughput(
      project({
        recipes: [
          recipe("eat-carbon", [["carbon", 10]], [["steel", 1]]),
          // The side line is here for its ash; the carbon is what it cannot
          // help making. A byproduct drawer asks for nothing, so something
          // else has to be the reason this machine runs.
          recipe("make-ash", [], [["ash", 1], ["carbon", 3]]),
        ],
        nodes: [node("main", "eat-carbon"), node("side", "make-ash")],
        storages: [
          drawer("src-carbon", "carbon"),
          drawer("d-steel", "steel"),
          drawer("d-ash", "ash"),
          { ...drawer("spare-carbon", "carbon"), drainMode: "byproduct" },
        ],
        edges: [
          wire("e1", "src-carbon", "main", "carbon"),
          wire("e2", "main", "d-steel", "steel"),
          wire("e3", "side", "d-ash", "ash"),
          wire("e4", "side", "spare-carbon", "carbon"),
        ],
      }),
      { generatedAt: "fixed" },
    );

    const need = result.externalInputs.find((b) => b.resourceId === "carbon");
    const spare = result.unconsumedOutputs.find((b) => b.resourceId === "carbon");
    expect(need?.deficitPerSecond).toBeCloseTo(10);
    expect(spare?.byproductPerSecond).toBeCloseTo(3);
    // Same record, both lists: it is one resource doing two jobs.
    expect(spare?.productPerSecond).toBeCloseTo(0);
  });

  it("splits a resource caught by both a product and a byproduct drawer", () => {
    const result = calculateThroughput(
      project({
        recipes: [recipe("split", [], [["carbon", 10]])],
        nodes: [node("maker", "split")],
        storages: [
          drawer("want", "carbon"),
          { ...drawer("spare", "carbon"), drainMode: "byproduct" },
        ],
        edges: [wire("e1", "maker", "want", "carbon"), wire("e2", "maker", "spare", "carbon")],
      }),
      { generatedAt: "fixed" },
    );

    const carbon = result.unconsumedOutputs.find((b) => b.resourceId === "carbon");
    // The product drawer asks for everything the machine can make - including
    // the share the silent byproduct drawer would otherwise have left
    // unclaimed - so the maker runs flat out and all 10 land somewhere.
    expect(result.nodes["maker"].utilization).toBeCloseTo(1);
    expect(carbon?.productPerSecond).toBeGreaterThan(0);
    expect((carbon?.productPerSecond ?? 0) + (carbon?.byproductPerSecond ?? 0)).toBeCloseTo(10);
    expect(carbon?.surplusPerSecond).toBeCloseTo(10);
  });

  it("a product drawer beside a byproduct drawer still runs its machine", () => {
    // The death spiral this pins: the leftover splits evenly across both
    // drains, but a byproduct asks for nothing, so the product drawer used to
    // ask for only half the output. The machine dropped to half, which halved
    // the leftover, which halved the ask, round after round, until a machine
    // wired to a drawer that wants everything it makes sat at 0%.
    const result = calculateThroughput(
      project({
        recipes: [recipe("split", [], [["carbon", 10]])],
        nodes: [node("maker", "split")],
        storages: [
          drawer("want", "carbon"),
          { ...drawer("spare", "carbon"), drainMode: "byproduct" as const },
        ],
        edges: [wire("e1", "maker", "want", "carbon"), wire("e2", "maker", "spare", "carbon")],
      }),
      { generatedAt: "fixed" },
    );

    expect(result.nodes["maker"].utilization).toBeCloseTo(1);
    // Conservation still holds: what the machine made is what the two caught.
    expect(
      result.edges["e1"].transferredPerSecond + result.edges["e2"].transferredPerSecond,
    ).toBeCloseTo(10);
  });

  it("a buffer in the middle does not change the diagnosis", () => {
    // A consumer throttled by its OWN clogged output pulls less than it could.
    // Through a buffer, that reduced pull used to be all that ever entered the
    // tank, so the tank offered only that much back, and the consumer read as
    // STARVED of a resource its feeder had plenty of. Wiring the same producer
    // straight in read correctly, so a tank in the middle changed the answer.
    //
    // Solved both ways here, and the two must agree.
    const parts = {
      recipes: [
        recipe("make-n", [], [["nitrogen", 1000]]),
        recipe("use-n", [["nitrogen", 10]], [["widget", 10], ["ash", 10]]),
        // Takes only half the ash, so `use-n` is held at 50% by its own clog.
        recipe("eat-ash", [["ash", 5]], [["slag", 1]]),
      ],
      nodes: [node("prod", "make-n"), node("cons", "use-n"), node("ash", "eat-ash")],
      tail: [
        wire("t1", "cons", "d-widget", "widget"),
        wire("t2", "cons", "ash", "ash"),
        wire("t3", "ash", "d-slag", "slag"),
      ],
      drains: [drawer("d-widget", "widget"), drawer("d-slag", "slag")],
    };

    const direct = calculateThroughput(
      project({
        recipes: parts.recipes,
        nodes: parts.nodes,
        storages: parts.drains,
        edges: [wire("n", "prod", "cons", "nitrogen"), ...parts.tail],
      }),
      { generatedAt: "fixed" },
    );

    const buffered = calculateThroughput(
      project({
        recipes: parts.recipes,
        nodes: parts.nodes,
        storages: [...parts.drains, drawer("buf", "nitrogen")],
        edges: [
          wire("n1", "prod", "buf", "nitrogen"),
          wire("n2", "buf", "cons", "nitrogen"),
          ...parts.tail,
        ],
      }),
      { generatedAt: "fixed" },
    );

    // Held at half by the ash clog, not by nitrogen - in both wirings.
    expect(direct.nodes["cons"].capableUtilization).toBeCloseTo(1);
    expect(buffered.nodes["cons"].capableUtilization).toBeCloseTo(1);
    expect(buffered.nodes["cons"].utilization).toBeCloseTo(direct.nodes["cons"].utilization);
    expect(buffered.nodes["cons"].clogOutputKey).toBe(direct.nodes["cons"].clogOutputKey);
    expect(buffered.nodes["prod"].utilization).toBeCloseTo(direct.nodes["prod"].utilization);
  });

  it("each drawer reports its own wires, not every drawer of that item", () => {
    // Two source drawers of one item used to show the SUM: both read 30/s when
    // one shipped 20 and the other 10.
    const result = calculateThroughput(
      project({
        recipes: [
          recipe("eat-a", [["cobble", 20]], [["gravel", 1]]),
          recipe("eat-b", [["cobble", 10]], [["sand", 1]]),
        ],
        nodes: [node("a", "eat-a"), node("b", "eat-b")],
        storages: [
          drawer("src-a", "cobble"),
          drawer("src-b", "cobble"),
          drawer("d-gravel", "gravel"),
          drawer("d-sand", "sand"),
        ],
        edges: [
          wire("e1", "src-a", "a", "cobble"),
          wire("e2", "src-b", "b", "cobble"),
          wire("e3", "a", "d-gravel", "gravel"),
          wire("e4", "b", "d-sand", "sand"),
        ],
      }),
      { generatedAt: "fixed" },
    );

    expect(result.storages["src-a"].consumedPerSecond).toBeCloseTo(20);
    expect(result.storages["src-b"].consumedPerSecond).toBeCloseTo(10);
  });
});

describe("conservation: the settled flows never outrun the wires", () => {
  // THE SETTLEMENT (see equilibrium.ts). Capability is clog-blind on purpose,
  // so a consumer downstream of a merely-CLOGGED supplier used to converge at
  // "100%", eating material its wire never carried and minting output from
  // it. The settlement bounds every node's actual level by what really
  // arrived, without touching the verdict layer's diagnosis.

  it("a consumer downstream of a clog runs at what actually arrives", () => {
    // Same board as the first clog test above, but asserting the TAKER's
    // books: dual is pinned at 50% by its redstone surplus, so the gold taker
    // receives 2.5/s of the 5/s it wants. It used to read 100% anyway and
    // bank a full goldblock per second off half the gold.
    const result = calculateThroughput(
      project({
        recipes: DUAL,
        nodes: [node("dual", "dual"), node("rs", "eat-redstone"), node("au", "eat-gold")],
        storages: TAKER_DRAINS.storages,
        edges: [
          wire("r1", "dual", "rs", "redstone"),
          wire("g1", "dual", "au", "gold"),
          ...TAKER_DRAINS.edges,
        ],
      }),
      { generatedAt: "fixed" },
    );

    const au = result.nodes["au"];
    expect(au.utilization).toBeCloseTo(0.5);
    // The diagnosis is untouched: its inputs COULD cover full blast if the
    // clog upstream were cleared, and its product drawer wants everything.
    expect(au.capableUtilization).toBeCloseTo(1);
    expect(au.demandUtilization).toBeCloseTo(1);
    // The drawer banks what was really made, not the nameplate.
    expect(result.storages["d-au"].producedPerSecond).toBeCloseTo(0.5);
    expect(result.edges["d2"].transferredPerSecond).toBeCloseTo(0.5);
  });

  it("a starved machine releases its OTHER ingredients' unclaimed shares", () => {
    // The taker needs gold AND a catalyst from a source drawer. Starved to
    // 50% on gold, it must draw 50% of the catalyst too - a machine at half
    // speed eats half of every ingredient - instead of draining the source at
    // the full rate it can never use.
    const result = calculateThroughput(
      project({
        recipes: [
          ...DUAL.slice(0, 2),
          recipe("eat-gold-cat", [["gold", 5], ["catalyst", 2]], [["goldblock", 1]]),
        ],
        nodes: [node("dual", "dual"), node("rs", "eat-redstone"), node("au", "eat-gold-cat")],
        storages: [...TAKER_DRAINS.storages, drawer("src-cat", "catalyst")],
        edges: [
          wire("r1", "dual", "rs", "redstone"),
          wire("g1", "dual", "au", "gold"),
          wire("c1", "src-cat", "au", "catalyst"),
          ...TAKER_DRAINS.edges,
        ],
      }),
      { generatedAt: "fixed" },
    );

    expect(result.nodes["au"].utilization).toBeCloseTo(0.5);
    expect(result.edges["c1"].transferredPerSecond).toBeCloseTo(1);
    expect(result.storages["src-cat"].consumedPerSecond).toBeCloseTo(1);
    // The starved input is named even though capability says "fine".
    expect(result.nodes["au"].limitingInputKey).toBe("item:gold");
  });

  it("settles the silicone rubber board without minting anything", () => {
    // The bug-report board (2026-08-18), distilled to per-second rates: an
    // LCR whose HCl only one small electrolyzer can drink, so the LCR is held
    // at 6.25% - and the chem reactor downstream must settle at the PDMS that
    // actually arrives (0.031/s of the 0.3/s it wants), not claim the full
    // 43.2 L/s of product. Every recipe here is one op per second, amounts
    // are the live board's per-second rates.
    const boardEdges = [
      wire("e-si", "src-si", "lcr", "si"),
      wire("e-methane", "src-methane", "lcr", "methane"),
      wire("e-cl-src", "src-cl", "lcr", "cl"),
      wire("e-water-src", "src-water", "lcr", "water"),
      wire("e-hcl", "lcr", "elec", "hcl"),
      wire("e-dhcl", "lcr", "dt", "dhcl"),
      wire("e-dt-hcl", "dt", "elec", "hcl"),
      wire("e-dt-water", "dt", "lcr", "water"),
      wire("e-cl", "elec", "lcr", "cl"),
      wire("e-pdms", "lcr", "chem", "pdms"),
      wire("e-sulfur", "src-sulfur", "chem", "sulfur"),
      wire("e-cell", "src-cell", "elec", "cell"),
      wire("e-silicone", "chem", "d-silicone", "silicone"),
      wire("e-hcell", "elec", "d-hcell", "hcell"),
    ];
    const result = calculateThroughput(
      project({
        recipes: [
          recipe(
            "lcr",
            [["si", 1 / 6], ["methane", 1000 / 3], ["cl", 2000 / 3], ["water", 500 / 3]],
            [["pdms", 0.5], ["hcl", 1000 / 3], ["dhcl", 1000 / 3]],
          ),
          recipe("chem", [["pdms", 0.3], ["sulfur", 1 / 30]], [["silicone", 43.2]]),
          recipe("dt", [["dhcl", 200 / 3]], [["water", 100 / 3], ["hcl", 100 / 3]]),
          recipe("elec", [["cell", 1 / 36], ["hcl", 250 / 9]], [["hcell", 1 / 36], ["cl", 250 / 9]]),
        ],
        nodes: [node("lcr", "lcr"), node("chem", "chem"), node("dt", "dt"), node("elec", "elec")],
        storages: [
          drawer("src-si", "si"),
          drawer("src-methane", "methane"),
          drawer("src-cl", "cl"),
          drawer("src-water", "water"),
          drawer("src-sulfur", "sulfur"),
          drawer("src-cell", "cell"),
          drawer("d-silicone", "silicone"),
          { ...drawer("d-hcell", "hcell"), drainMode: "byproduct" as const },
        ],
        edges: boardEdges,
      }),
      { generatedAt: "fixed" },
    );

    // The LCR is clogged by HCl at 6.25% - and BOTH its sides say so at once.
    // Before the convergence fix the loop stopped while the priority tranches
    // were still moving, and one report mixed 4.17% inputs with 6.25% outputs.
    const lcr = result.nodes["lcr"];
    expect(lcr.utilization).toBeCloseTo(0.0625, 3);
    expect(lcr.clogOutputKey).toBe("item:hcl");
    expect(result.edges["e-methane"].transferredPerSecond).toBeCloseTo((1000 / 3) * 0.0625, 3);
    expect(result.edges["e-hcl"].transferredPerSecond).toBeCloseTo((1000 / 3) * 0.0625, 3);

    // The chem reactor runs at the PDMS that arrives: 0.03125/s of a 0.3/s
    // appetite is 10.4%, and the product drawer banks 4.5 L/s - not 43.2.
    const chem = result.nodes["chem"];
    expect(chem.utilization).toBeCloseTo(0.104, 2);
    expect(chem.limitingInputKey).toBe("item:pdms");
    expect(result.storages["d-silicone"].producedPerSecond).toBeCloseTo(4.5, 2);
    // The want survives for the striped bar: the wire still says 0.3/s asked.
    expect(result.edges["e-pdms"].nameplateDemandPerSecond).toBeCloseTo(0.3, 3);
    expect(result.edges["e-pdms"].transferredPerSecond).toBeCloseTo(0.03125, 3);
    // And its sulfur drawer drains at the settled level, not the nameplate.
    expect(result.edges["e-sulfur"].transferredPerSecond).toBeCloseTo((1 / 30) * 0.104, 3);

    // Nothing anywhere eats more than its wires deliver, and (everything here
    // being fully wired with no banked stock) nothing arrives uneaten either.
    for (const [nodeId, nodeResult] of Object.entries(result.nodes)) {
      const actual = Math.min(1, nodeResult.utilization);
      for (const [key, flow] of Object.entries(nodeResult.inputs)) {
        const consumed = flow.amountPerSecond * actual;
        let delivered = 0;
        for (const boardEdge of boardEdges) {
          if (boardEdge.target === nodeId && `item:${boardEdge.resourceId}` === key) {
            delivered += result.edges[boardEdge.id]?.transferredPerSecond ?? 0;
          }
        }
        expect(Math.abs(consumed - delivered)).toBeLessThan(0.001);
      }
    }
  });
});

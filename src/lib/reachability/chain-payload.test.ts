import { describe, expect, it } from "vitest";
import { BOARD_GRID } from "@/lib/board-grid";
import type { Recipe } from "@/lib/model/types";
import { buildChainPlacementPayload } from "./chain-payload";

function recipe(id: string, inputs: Recipe["inputs"], outputs: Recipe["outputs"]): Recipe {
  return {
    id,
    name: id,
    machineType: "Assembler",
    minimumTier: "LV",
    durationTicks: 20,
    eut: 8,
    inputs,
    outputs,
  };
}

const macerate = recipe(
  "macerate",
  [{ kind: "item", id: "iron_ore", amount: 1 }],
  [{ kind: "item", id: "iron_dust", amount: 2 }],
);
const smelt = recipe(
  "smelt",
  [{ kind: "item", id: "iron_dust", amount: 1 }],
  [
    { kind: "item", id: "iron_ingot", amount: 1 },
    { kind: "item", id: "slag", amount: 1 },
  ],
);

describe("buildChainPlacementPayload", () => {
  it("places producers left of consumers on grid positions", () => {
    const payload = buildChainPlacementPayload(
      [
        { recipe: macerate, depth: 1 },
        { recipe: smelt, depth: 0 },
      ],
      ["item:iron_ore"],
    );

    const [macerateNode, smeltNode] = payload.nodes;
    expect(macerateNode.position.x).toBeLessThan(smeltNode.position.x);
    for (const node of payload.nodes) {
      expect(node.position.x % BOARD_GRID).toBe(0);
      expect(node.position.y % BOARD_GRID).toBe(0);
    }
  });

  it("wires the chain and drains what nothing consumes", () => {
    const payload = buildChainPlacementPayload(
      [
        { recipe: macerate, depth: 1 },
        { recipe: smelt, depth: 0 },
      ],
      ["item:iron_ore"],
    );

    const dustEdge = payload.edges.find((edge) => edge.resourceId === "iron_dust");
    expect(dustEdge).toMatchObject({ source: "chain-node-0", target: "chain-node-1" });

    // Granted root: a source drawer feeds the macerator.
    const oreSource = payload.storages.find((storage) => storage.resourceId === "iron_ore");
    expect(oreSource).toBeDefined();
    expect(
      payload.edges.some(
        (edge) => edge.source === oreSource?.id && edge.target === "chain-node-0",
      ),
    ).toBe(true);

    // The ingot is the product, the slag a byproduct - both drained so no
    // bare output row stops its machine.
    const drains = payload.storages.filter((storage) => storage.id.startsWith("chain-drain"));
    expect(drains.map((storage) => [storage.resourceId, storage.drainMode ?? "product"])).toEqual([
      ["iron_ingot", "product"],
      ["slag", "byproduct"],
    ]);
  });

  it("pins a family slot to what the chain delivers", () => {
    const planks = recipe(
      "planks",
      [{ kind: "item", id: "oredict:logWood", amount: 1, oreDictionary: ["logWood"] } as never],
      [{ kind: "item", id: "planks", amount: 4 }],
    );
    const chop = recipe(
      "chop",
      [],
      [{ kind: "item", id: "oak_log", amount: 1, oreDictionary: ["logWood"] } as never],
    );

    const payload = buildChainPlacementPayload(
      [
        { recipe: chop, depth: 1 },
        { recipe: planks, depth: 0 },
      ],
      [],
    );

    const planksNode = payload.nodes[1];
    expect(planksNode.recipeInputOverrides?.["0"]).toMatchObject({ kind: "item", id: "oak_log" });
    const logEdge = payload.edges.find((edge) => edge.resourceId === "oak_log");
    expect(logEdge).toMatchObject({ source: "chain-node-0", target: "chain-node-1" });
  });

  it("leaves an ungranted, unproduced input honestly unwired", () => {
    const payload = buildChainPlacementPayload([{ recipe: macerate, depth: 0 }], []);

    expect(payload.storages.filter((storage) => storage.id.startsWith("chain-source"))).toEqual([]);
    expect(payload.edges.filter((edge) => edge.resourceId === "iron_ore")).toEqual([]);
  });
});

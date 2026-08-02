import { describe, expect, it } from "vitest";
import { gtnhFuelProfiles } from "@/lib/model/fuels";
import { PROJECT_SCHEMA_VERSION, type FactoryProject } from "@/lib/model/types";
import { calculateThroughput } from "./throughput";

describe("calculateThroughput", () => {
  it("uses the Minecraft 20 ticks/s throughput formulas", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "test-project",
      name: "Solver test",
      targetRate: {
        kind: "item",
        resourceId: "plate",
        amountPerSecond: 0.8,
      },
      recipes: [
        {
          id: "plate-recipe",
          name: "Plate recipe",
          machineType: "Bender",
          minimumTier: "LV",
          durationTicks: 600,
          eut: 30,
          inputs: [{ kind: "item", id: "ore", amount: 1 }],
          outputs: [{ kind: "item", id: "plate", amount: 2 }],
        },
      ],
      nodes: [
        {
          id: "node-plate",
          recipeId: "plate-recipe",
          machineCount: 3,
          parallel: 2,
          overclockTier: "LV",
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      fuelProfiles: gtnhFuelProfiles,
      selectedFuelProfileId: "biodiesel",
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });
    const node = result.nodes["node-plate"];

    expect(node.operationRatePerSecond).toBeCloseTo(0.2);
    expect(node.outputs["item:plate"].amountPerSecond).toBeCloseTo(0.4);
    expect(node.inputs["item:ore"].amountPerSecond).toBeCloseTo(0.2);
    expect(node.euT).toBe(180);
    expect(result.totalEuT).toBe(180);
    expect(result.totalEuPerSecond).toBe(3600);
    expect(node.utilization).toBeCloseTo(2);
    expect(node.theoreticalMachinesRequired).toBeCloseTo(6);
    expect(result.externalInputs[0]?.resourceId).toBe("ore");
    expect(result.fuelEstimate?.fuelPerSecond).toBeCloseTo(0.28125);
  });

  it("prefers GTNH runtime calculation variants over local overclock formulas", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "runtime-oracle-project",
      name: "Runtime oracle test",
      recipes: [
        {
          id: "runtime-recipe",
          name: "Runtime recipe",
          machineType: "Assembler",
          minimumTier: "LV",
          durationTicks: 400,
          eut: 30,
          inputs: [{ kind: "item", id: "dust", amount: 1 }],
          outputs: [{ kind: "item", id: "plate", amount: 1 }],
          runtimeCalculation: {
            sourceKind: "gregtech-overclock-calculator",
            sourceClass: "gregtech.api.util.OverclockCalculator",
            recipeMap: "Assembler",
            status: "computed",
            oracleEligible: true,
            strict: true,
            variants: [
              {
                id: "tier-mv",
                overclockTier: "MV",
                durationTicks: 7,
                eut: 123,
                outputs: [{ kind: "item", id: "plate", amount: 3, chance: 0.5 }],
              },
            ],
          },
        },
      ],
      nodes: [
        {
          id: "runtime-node",
          recipeId: "runtime-recipe",
          machineCount: 2,
          parallel: 1,
          overclockTier: "MV",
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });
    const node = result.nodes["runtime-node"];

    expect(node.operationRatePerSecond).toBeCloseTo((2 * 20) / 7);
    expect(node.outputs["item:plate"].amountPerSecond).toBeCloseTo((3 * 0.5 * 2 * 20) / 7);
    expect(node.euT).toBe(246);
    expect(node.warnings).toEqual([]);
  });

  it("derives edge demand from the target node consumption", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "edge-project",
      name: "Edge test",
      recipes: [
        {
          id: "water-source",
          name: "Water source",
          machineType: "Source Hatch",
          minimumTier: "DEMO",
          durationTicks: 200,
          eut: 0,
          inputs: [],
          outputs: [{ kind: "fluid", id: "water", amount: 100 }],
        },
        {
          id: "water-consumer",
          name: "Water consumer",
          machineType: "Chemical Reactor",
          minimumTier: "LV",
          durationTicks: 100,
          eut: 30,
          inputs: [{ kind: "fluid", id: "water", amount: 50 }],
          outputs: [{ kind: "item", id: "dust", amount: 1 }],
        },
      ],
      nodes: [
        {
          id: "source",
          recipeId: "water-source",
          machineCount: 1,
          parallel: 1,
          overclockTier: "DEMO",
          enabled: true,
          position: { x: 0, y: 0 },
        },
        {
          id: "consumer",
          recipeId: "water-consumer",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 200, y: 0 },
        },
      ],
      edges: [
        {
          id: "water-edge",
          source: "source",
          target: "consumer",
          resourceKind: "fluid",
          resourceId: "water",
          label: "Water",
        },
      ],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.edges["water-edge"].demandPerSecond).toBeCloseTo(10);
    expect(result.edges["water-edge"].transferredPerSecond).toBeCloseTo(10);
    expect(result.nodes.source.utilization).toBeCloseTo(1);
    expect(result.resources["fluid:water"].netPerSecond).toBeCloseTo(0);
  });

  it("scales edge labels from final target utilization", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "edge-utilization-project",
      name: "Edge utilization label test",
      targetRate: {
        kind: "item",
        resourceId: "dust",
        amountPerSecond: 0.25,
      },
      recipes: [
        {
          id: "source-recipe",
          name: "Powder source",
          machineType: "Source Hatch",
          minimumTier: "DEMO",
          durationTicks: 20,
          eut: 0,
          inputs: [],
          outputs: [{ kind: "item", id: "powder", amount: 10 }],
        },
        {
          id: "consumer-recipe",
          name: "Dust consumer",
          machineType: "Mixer",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 30,
          inputs: [{ kind: "item", id: "powder", amount: 10 }],
          outputs: [{ kind: "item", id: "dust", amount: 1 }],
        },
      ],
      nodes: [
        {
          id: "source",
          recipeId: "source-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "DEMO",
          enabled: true,
          position: { x: 0, y: 0 },
        },
        {
          id: "consumer",
          recipeId: "consumer-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 200, y: 0 },
        },
      ],
      edges: [
        {
          id: "powder-edge",
          source: "source",
          target: "consumer",
          resourceKind: "item",
          resourceId: "powder",
          label: "Powder",
        },
      ],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.nodes.consumer.utilization).toBeCloseTo(0.25);
    expect(result.edges["powder-edge"].demandPerSecond).toBeCloseTo(2.5);
    expect(result.edges["powder-edge"].transferredPerSecond).toBeCloseTo(2.5);
    expect(result.resources["item:powder"].producedPerSecond).toBeCloseTo(2.5);
    expect(result.resources["item:powder"].consumedPerSecond).toBeCloseTo(2.5);
    expect(result.resources["item:powder"].netPerSecond).toBeCloseTo(0);
  });

  it("uses concrete item edges to satisfy ore dictionary input demand", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "ore-dictionary-edge-project",
      name: "Ore dictionary edge test",
      recipes: [
        {
          id: "stick-source",
          name: "Stick source",
          machineType: "Source",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 0,
          inputs: [],
          outputs: [{ kind: "item", id: "minecraft:stick@0", amount: 1 }],
        },
        {
          id: "crafting",
          name: "Crafting",
          machineType: "Shaped Crafting",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 0,
          inputs: [
            {
              kind: "item",
              id: "oredict:stickWood",
              amount: 1,
              alternatives: [{ kind: "item", id: "minecraft:stick@0", displayName: "Stick" }],
            },
          ],
          outputs: [{ kind: "item", id: "crafted", amount: 1 }],
        },
      ],
      nodes: [
        {
          id: "source",
          recipeId: "stick-source",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 0, y: 0 },
        },
        {
          id: "target",
          recipeId: "crafting",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 200, y: 0 },
        },
      ],
      edges: [
        {
          id: "stick-edge",
          source: "source",
          target: "target",
          resourceKind: "item",
          resourceId: "minecraft:stick@0",
          label: "Stick",
        },
      ],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.edges["stick-edge"].demandPerSecond).toBeCloseTo(1);
    expect(result.edges["stick-edge"].transferredPerSecond).toBeCloseTo(1);
    expect(result.nodes.source.utilization).toBeCloseTo(1);
  });

  it("lets a drawer or tank absorb producer output even without consumers", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "storage-sink-project",
      name: "Storage sink test",
      recipes: [
        {
          id: "source-recipe",
          name: "Dust source",
          machineType: "Source Hatch",
          minimumTier: "DEMO",
          durationTicks: 20,
          eut: 0,
          inputs: [],
          outputs: [{ kind: "item", id: "dust", amount: 2 }],
        },
      ],
      nodes: [
        {
          id: "source",
          recipeId: "source-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "DEMO",
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      storages: [
        {
          id: "dust-drawer",
          kind: "item",
          resourceId: "dust",
          displayName: "Dust",
          position: { x: 200, y: 0 },
        },
      ],
      edges: [
        {
          id: "drawer-edge",
          source: "source",
          target: "dust-drawer",
          resourceKind: "item",
          resourceId: "dust",
          label: "Dust",
        },
      ],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.edges["drawer-edge"].transferredPerSecond).toBeCloseTo(2);
    expect(result.nodes.source.utilization).toBeCloseTo(1);
    expect(result.nodes.source.theoreticalMachinesRequired).toBeCloseTo(1);
    expect(result.storages["dust-drawer"].producedPerSecond).toBeCloseTo(2);
    expect(result.storages["dust-drawer"].consumedPerSecond).toBeCloseTo(0);
    expect(result.storages["dust-drawer"].netPerSecond).toBeCloseTo(2);
    expect(result.storages["dust-drawer"].status).toBe("filling");
  });

  it("lets terminal storage absorb output from recipes with consumed inputs", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "consumed-input-terminal-storage-project",
      name: "Consumed input terminal storage test",
      recipes: [
        {
          id: "chemical-plant-recipe",
          name: "Chemical Plant",
          machineType: "Chemical Plant",
          minimumTier: "EV",
          durationTicks: 20,
          eut: 480,
          inputs: [
            { kind: "fluid", id: "benzene", amount: 1_000 },
            { kind: "fluid", id: "nitric_acid", amount: 1_000 },
          ],
          outputs: [{ kind: "fluid", id: "nitrobenzene", amount: 1_000 }],
        },
      ],
      nodes: [
        {
          id: "chemical-plant",
          recipeId: "chemical-plant-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "EV",
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      storages: [
        {
          id: "nitrobenzene-tank",
          kind: "fluid",
          resourceId: "nitrobenzene",
          position: { x: 200, y: 0 },
        },
      ],
      edges: [
        {
          id: "chemical-plant-to-tank",
          source: "chemical-plant",
          target: "nitrobenzene-tank",
          resourceKind: "fluid",
          resourceId: "nitrobenzene",
        },
      ],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.nodes["chemical-plant"].utilization).toBeCloseTo(1);
    expect(result.edges["chemical-plant-to-tank"].transferredPerSecond).toBeCloseTo(1_000);
    expect(result.storages["nitrobenzene-tank"].producedPerSecond).toBeCloseTo(1_000);
    expect(result.storages["nitrobenzene-tank"].consumedPerSecond).toBeCloseTo(0);
    expect(result.storages["nitrobenzene-tank"].netPerSecond).toBeCloseTo(1_000);
  });

  it("updates storage link throughput from current machine capacity instead of stale edge rates", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "storage-sink-rate-project",
      name: "Storage sink rate test",
      recipes: [
        {
          id: "source-recipe",
          name: "Dust source",
          machineType: "Source Hatch",
          minimumTier: "DEMO",
          durationTicks: 20,
          eut: 0,
          inputs: [],
          outputs: [{ kind: "item", id: "dust", amount: 2 }],
        },
      ],
      nodes: [
        {
          id: "source",
          recipeId: "source-recipe",
          machineCount: 3,
          parallel: 1,
          overclockTier: "DEMO",
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      storages: [
        {
          id: "dust-drawer",
          kind: "item",
          resourceId: "dust",
          displayName: "Dust",
          position: { x: 200, y: 0 },
        },
      ],
      edges: [
        {
          id: "drawer-edge",
          source: "source",
          target: "dust-drawer",
          resourceKind: "item",
          resourceId: "dust",
          label: "Dust",
          ratePerSecond: 0.03,
        },
      ],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.edges["drawer-edge"].demandPerSecond).toBeCloseTo(6);
    expect(result.edges["drawer-edge"].transferredPerSecond).toBeCloseTo(6);
    expect(result.storages["dust-drawer"].netPerSecond).toBeCloseTo(6);
  });

  it("shows free producer surplus through storage sinks without forcing upstream usage", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "storage-effective-rate-project",
      name: "Storage effective rate test",
      targetRate: {
        kind: "item",
        resourceId: "plate",
        amountPerSecond: 1,
      },
      recipes: [
        {
          id: "source-recipe",
          name: "Dust source",
          machineType: "Source Hatch",
          minimumTier: "DEMO",
          durationTicks: 20,
          eut: 0,
          inputs: [],
          outputs: [{ kind: "item", id: "dust", amount: 10 }],
        },
        {
          id: "consumer-recipe",
          name: "Plate target",
          machineType: "Assembler",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 30,
          inputs: [{ kind: "item", id: "dust", amount: 10 }],
          outputs: [{ kind: "item", id: "plate", amount: 10 }],
        },
      ],
      nodes: [
        {
          id: "source",
          recipeId: "source-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "DEMO",
          enabled: true,
          position: { x: 0, y: 0 },
        },
        {
          id: "consumer",
          recipeId: "consumer-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 300, y: 0 },
        },
      ],
      storages: [
        {
          id: "dust-drawer-out",
          kind: "item",
          resourceId: "dust",
          position: { x: 120, y: 0 },
        },
        {
          id: "dust-drawer-in",
          kind: "item",
          resourceId: "dust",
          position: { x: 180, y: 0 },
        },
      ],
      edges: [
        {
          id: "source-to-drawer",
          source: "source",
          target: "dust-drawer-out",
          resourceKind: "item",
          resourceId: "dust",
        },
        {
          id: "drawer-to-consumer",
          source: "dust-drawer-in",
          target: "consumer",
          resourceKind: "item",
          resourceId: "dust",
        },
      ],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.nodes.consumer.utilization).toBeCloseTo(0.1);
    expect(result.nodes.source.utilization).toBeCloseTo(0.1);
    expect(result.edges["source-to-drawer"].demandPerSecond).toBeCloseTo(10);
    expect(result.edges["source-to-drawer"].transferredPerSecond).toBeCloseTo(10);
    expect(result.storages["dust-drawer-out"].producedPerSecond).toBeCloseTo(10);
    expect(result.storages["dust-drawer-out"].consumedPerSecond).toBeCloseTo(1);
    expect(result.storages["dust-drawer-out"].netPerSecond).toBeCloseTo(9);
    expect(result.resources["item:dust"].netPerSecond).toBeCloseTo(0);
  });

  it("labels storage output by consumer input demand instead of available supply", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "storage-feed-available-supply-project",
      name: "Storage feed available supply test",
      recipes: [
        {
          id: "small-source-recipe",
          name: "Small source",
          machineType: "Source Hatch",
          minimumTier: "DEMO",
          durationTicks: 20,
          eut: 0,
          inputs: [],
          outputs: [{ kind: "fluid", id: "woodtar", amount: 500 }],
        },
        {
          id: "large-source-recipe",
          name: "Large source",
          machineType: "Source Hatch",
          minimumTier: "DEMO",
          durationTicks: 20,
          eut: 0,
          inputs: [],
          outputs: [{ kind: "fluid", id: "woodtar", amount: 25_600 }],
        },
        {
          id: "consumer-recipe",
          name: "Distillation Tower",
          machineType: "Distillation Tower",
          minimumTier: "EV",
          durationTicks: 20,
          eut: 512,
          inputs: [{ kind: "fluid", id: "woodtar", amount: 1_000 }],
          outputs: [{ kind: "fluid", id: "benzene", amount: 400 }],
        },
      ],
      nodes: [
        {
          id: "small-source",
          recipeId: "small-source-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "DEMO",
          enabled: true,
          position: { x: 0, y: 0 },
        },
        {
          id: "large-source",
          recipeId: "large-source-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "DEMO",
          enabled: true,
          position: { x: 0, y: 120 },
        },
        {
          id: "consumer",
          recipeId: "consumer-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "EV",
          enabled: true,
          position: { x: 320, y: 0 },
        },
      ],
      storages: [
        {
          id: "woodtar-tank",
          kind: "fluid",
          resourceId: "woodtar",
          position: { x: 160, y: 0 },
        },
      ],
      edges: [
        {
          id: "small-to-tank",
          source: "small-source",
          target: "woodtar-tank",
          resourceKind: "fluid",
          resourceId: "woodtar",
        },
        {
          id: "large-to-tank",
          source: "large-source",
          target: "woodtar-tank",
          resourceKind: "fluid",
          resourceId: "woodtar",
        },
        {
          id: "tank-to-consumer",
          source: "woodtar-tank",
          target: "consumer",
          resourceKind: "fluid",
          resourceId: "woodtar",
        },
      ],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.edges["small-to-tank"].demandPerSecond).toBeCloseTo(500);
    expect(result.edges["large-to-tank"].demandPerSecond).toBeCloseTo(25_600);
    expect(result.edges["tank-to-consumer"].demandPerSecond).toBeCloseTo(1_000);
    expect(result.edges["tank-to-consumer"].transferredPerSecond).toBeCloseTo(1_000);
    expect(result.storages["woodtar-tank"].producedPerSecond).toBeCloseTo(26_100);
    expect(result.storages["woodtar-tank"].consumedPerSecond).toBeCloseTo(1_000);
    expect(result.nodes["small-source"].utilization).toBeCloseTo(1);
    expect(result.nodes.consumer.utilization).toBeCloseTo(1);
  });

  it("lets storage sinks absorb surplus from consuming recipes", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "storage-direct-surplus-project",
      name: "Storage direct surplus test",
      recipes: [
        {
          id: "source-recipe",
          name: "Dust source",
          machineType: "Source Hatch",
          minimumTier: "DEMO",
          durationTicks: 20,
          eut: 0,
          inputs: [{ kind: "item", id: "ore", amount: 1 }],
          outputs: [{ kind: "item", id: "dust", amount: 10 }],
        },
        {
          id: "consumer-recipe",
          name: "Dust consumer",
          machineType: "Assembler",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 30,
          inputs: [{ kind: "item", id: "dust", amount: 2 }],
          outputs: [{ kind: "item", id: "plate", amount: 1 }],
        },
      ],
      nodes: [
        {
          id: "source",
          recipeId: "source-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "DEMO",
          enabled: true,
          position: { x: 0, y: 0 },
        },
        {
          id: "consumer",
          recipeId: "consumer-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 300, y: 0 },
        },
      ],
      storages: [
        {
          id: "dust-drawer",
          kind: "item",
          resourceId: "dust",
          position: { x: 160, y: 0 },
        },
      ],
      edges: [
        {
          id: "source-to-consumer",
          source: "source",
          target: "consumer",
          resourceKind: "item",
          resourceId: "dust",
        },
        {
          id: "source-to-drawer",
          source: "source",
          target: "dust-drawer",
          resourceKind: "item",
          resourceId: "dust",
        },
      ],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.nodes.source.utilization).toBeCloseTo(1);
    expect(result.edges["source-to-consumer"].transferredPerSecond).toBeCloseTo(2);
    expect(result.edges["source-to-drawer"].transferredPerSecond).toBeCloseTo(8);
    expect(result.storages["dust-drawer"].netPerSecond).toBeCloseTo(8);
  });

  it("fills storage with unused capacity from consumed-input producers", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "consumed-input-storage-output-limited-project",
      name: "Consumed input storage output limited test",
      recipes: [
        {
          id: "extractor-recipe",
          name: "Large Fluid Extractor",
          machineType: "Large Fluid Extractor",
          minimumTier: "EV",
          durationTicks: 20,
          eut: 739,
          inputs: [{ kind: "item", id: "charcoal", amount: 1 }],
          outputs: [{ kind: "fluid", id: "woodtar", amount: 4_000 }],
        },
        {
          id: "distillation-recipe",
          name: "Distillation Tower",
          machineType: "Distillation Tower",
          minimumTier: "EV",
          durationTicks: 20,
          eut: 1024,
          inputs: [{ kind: "fluid", id: "woodtar", amount: 1_000 }],
          outputs: [{ kind: "fluid", id: "benzene", amount: 1 }],
        },
      ],
      nodes: [
        {
          id: "extractor",
          recipeId: "extractor-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "EV",
          enabled: true,
          position: { x: 0, y: 0 },
        },
        {
          id: "distillation",
          recipeId: "distillation-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "EV",
          enabled: true,
          position: { x: 300, y: 0 },
        },
      ],
      storages: [
        {
          id: "woodtar-tank",
          kind: "fluid",
          resourceId: "woodtar",
          position: { x: 160, y: 0 },
        },
      ],
      edges: [
        {
          id: "extractor-to-tank",
          source: "extractor",
          target: "woodtar-tank",
          resourceKind: "fluid",
          resourceId: "woodtar",
        },
        {
          id: "tank-to-distillation",
          source: "woodtar-tank",
          target: "distillation",
          resourceKind: "fluid",
          resourceId: "woodtar",
        },
      ],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.nodes.extractor.utilization).toBeCloseTo(1);
    expect(result.edges["extractor-to-tank"].demandPerSecond).toBeCloseTo(4_000);
    expect(result.edges["extractor-to-tank"].transferredPerSecond).toBeCloseTo(4_000);
    expect(result.storages["woodtar-tank"].netPerSecond).toBeCloseTo(3_000);
    expect(result.edges["extractor-to-tank"].isLimited).toBe(false);
  });

  it("limits parallel storage consumers to available incoming storage supply", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "parallel-storage-consumer-project",
      name: "Parallel storage consumer test",
      recipes: [
        {
          id: "woodtar-source-recipe",
          name: "Wood Tar Source",
          machineType: "Large Fluid Extractor",
          minimumTier: "EV",
          durationTicks: 20,
          eut: 739,
          inputs: [{ kind: "item", id: "charcoal", amount: 1 }],
          outputs: [{ kind: "fluid", id: "woodtar", amount: 15_000 }],
        },
        {
          id: "mega-distillation-recipe",
          name: "Mega Distillation Tower",
          machineType: "Mega Distillation Tower",
          minimumTier: "EV",
          durationTicks: 20,
          eut: 1024,
          inputs: [{ kind: "fluid", id: "woodtar", amount: 1_000 }],
          outputs: [{ kind: "fluid", id: "benzene", amount: 400 }],
        },
      ],
      nodes: [
        {
          id: "woodtar-source",
          recipeId: "woodtar-source-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "EV",
          enabled: true,
          position: { x: 0, y: 0 },
        },
        {
          id: "mega-distillation",
          recipeId: "mega-distillation-recipe",
          machineCount: 1,
          parallel: 256,
          overclockTier: "EV",
          enabled: true,
          position: { x: 320, y: 0 },
        },
      ],
      storages: [
        {
          id: "woodtar-tank",
          kind: "fluid",
          resourceId: "woodtar",
          position: { x: 160, y: 0 },
        },
      ],
      edges: [
        {
          id: "source-to-tank",
          source: "woodtar-source",
          target: "woodtar-tank",
          resourceKind: "fluid",
          resourceId: "woodtar",
        },
        {
          id: "tank-to-mega-distillation",
          source: "woodtar-tank",
          target: "mega-distillation",
          resourceKind: "fluid",
          resourceId: "woodtar",
        },
      ],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.nodes["mega-distillation"].utilization).toBeCloseTo(15_000 / 256_000);
    // Demand is the machine's honest ask (its full-speed appetite; nothing
    // else limits it), no longer an echo of its own starved throttle.
    expect(result.edges["tank-to-mega-distillation"].demandPerSecond).toBeCloseTo(256_000);
    expect(result.edges["tank-to-mega-distillation"].transferredPerSecond).toBeCloseTo(15_000);
    expect(result.storages["woodtar-tank"].producedPerSecond).toBeCloseTo(15_000);
    expect(result.storages["woodtar-tank"].consumedPerSecond).toBeCloseTo(15_000);
    expect(result.storages["woodtar-tank"].netPerSecond).toBeCloseTo(0);
  });

  it("fills storage from surplus when producer inputs are not consumed", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "non-consumed-input-storage-surplus-project",
      name: "Non consumed input storage surplus test",
      recipes: [
        {
          id: "tree-growth-recipe",
          name: "Tree Growth",
          machineType: "Tree Growth Simulator",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 0,
          inputs: [{ kind: "item", id: "sapling", amount: 1, consumed: false }],
          outputs: [{ kind: "item", id: "log", amount: 10 }],
        },
        {
          id: "consumer-recipe",
          name: "Log consumer",
          machineType: "Coke Oven",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 30,
          inputs: [{ kind: "item", id: "log", amount: 2 }],
          outputs: [{ kind: "item", id: "charcoal", amount: 1 }],
        },
      ],
      nodes: [
        {
          id: "tree-growth",
          recipeId: "tree-growth-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 0, y: 0 },
        },
        {
          id: "consumer",
          recipeId: "consumer-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 300, y: 0 },
        },
      ],
      storages: [
        {
          id: "log-drawer",
          kind: "item",
          resourceId: "log",
          position: { x: 160, y: 0 },
        },
      ],
      edges: [
        {
          id: "tree-to-consumer",
          source: "tree-growth",
          target: "consumer",
          resourceKind: "item",
          resourceId: "log",
        },
        {
          id: "tree-to-drawer",
          source: "tree-growth",
          target: "log-drawer",
          resourceKind: "item",
          resourceId: "log",
        },
      ],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.nodes["tree-growth"].utilization).toBeCloseTo(2 / 18);
    expect(result.edges["tree-to-consumer"].transferredPerSecond).toBeCloseTo(2);
    expect(result.edges["tree-to-drawer"].transferredPerSecond).toBeCloseTo(16);
    expect(result.storages["log-drawer"].netPerSecond).toBeCloseTo(16);
  });

  it("does not add global target demand on top of output fully routed to storage", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "storage-target-project",
      name: "Storage target test",
      targetRate: {
        kind: "item",
        resourceId: "dust",
        amountPerSecond: 10,
      },
      recipes: [
        {
          id: "source-recipe",
          name: "Dust source",
          machineType: "Source Hatch",
          minimumTier: "DEMO",
          durationTicks: 20,
          eut: 0,
          inputs: [],
          outputs: [{ kind: "item", id: "dust", amount: 2 }],
        },
      ],
      nodes: [
        {
          id: "source",
          recipeId: "source-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "DEMO",
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      storages: [
        {
          id: "dust-drawer",
          kind: "item",
          resourceId: "dust",
          displayName: "Dust",
          position: { x: 200, y: 0 },
        },
      ],
      edges: [
        {
          id: "drawer-edge",
          source: "source",
          target: "dust-drawer",
          resourceKind: "item",
          resourceId: "dust",
          label: "Dust",
        },
      ],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.nodes.source.utilization).toBeCloseTo(1);
    expect(result.nodes.source.theoreticalMachinesRequired).toBeCloseTo(1);
    expect(result.nodes.source.requiredRatePerSecond).toBeCloseTo(2);
    expect(result.nodes.source.maxRatePerSecond).toBeCloseTo(2);
  });

  it("lets a drawer or tank feed consumers and show negative net when undersupplied", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "storage-source-project",
      name: "Storage source test",
      recipes: [
        {
          id: "consumer-recipe",
          name: "Dust consumer",
          machineType: "Assembler",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 30,
          inputs: [{ kind: "item", id: "dust", amount: 3 }],
          outputs: [{ kind: "item", id: "plate", amount: 1 }],
        },
      ],
      nodes: [
        {
          id: "consumer",
          recipeId: "consumer-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 200, y: 0 },
        },
      ],
      storages: [
        {
          id: "dust-drawer",
          kind: "item",
          resourceId: "dust",
          displayName: "Dust",
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        {
          id: "drawer-edge",
          source: "dust-drawer",
          target: "consumer",
          resourceKind: "item",
          resourceId: "dust",
          label: "Dust",
        },
      ],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.edges["drawer-edge"].demandPerSecond).toBeCloseTo(3);
    expect(result.edges["drawer-edge"].transferredPerSecond).toBeCloseTo(3);
    expect(result.storages["dust-drawer"].producedPerSecond).toBeCloseTo(0);
    expect(result.storages["dust-drawer"].consumedPerSecond).toBeCloseTo(3);
    expect(result.storages["dust-drawer"].netPerSecond).toBeCloseTo(-3);
    expect(result.storages["dust-drawer"].status).toBe("draining");
  });

  it("aggregates drawer and tank throughput by referenced resource", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "storage-reference-project",
      name: "Storage reference aggregation test",
      recipes: [
        {
          id: "source-recipe",
          name: "Dust source",
          machineType: "Macerator",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 30,
          inputs: [],
          outputs: [{ kind: "item", id: "dust", amount: 5 }],
        },
        {
          id: "consumer-recipe",
          name: "Dust consumer",
          machineType: "Assembler",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 30,
          inputs: [{ kind: "item", id: "dust", amount: 2 }],
          outputs: [{ kind: "item", id: "plate", amount: 1 }],
        },
      ],
      nodes: [
        {
          id: "source",
          recipeId: "source-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 0, y: 0 },
        },
        {
          id: "consumer",
          recipeId: "consumer-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 400, y: 0 },
        },
      ],
      storages: [
        {
          id: "dust-drawer-a",
          kind: "item",
          resourceId: "dust",
          displayName: "Dust",
          position: { x: 160, y: 0 },
        },
        {
          id: "dust-drawer-b",
          kind: "item",
          resourceId: "dust",
          displayName: "Dust",
          position: { x: 260, y: 0 },
        },
      ],
      edges: [
        {
          id: "source-to-drawer",
          source: "source",
          target: "dust-drawer-a",
          resourceKind: "item",
          resourceId: "dust",
          label: "Dust",
        },
        {
          id: "drawer-to-consumer",
          source: "dust-drawer-b",
          target: "consumer",
          resourceKind: "item",
          resourceId: "dust",
          label: "Dust",
        },
      ],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    for (const storageId of ["dust-drawer-a", "dust-drawer-b"]) {
      expect(result.storages[storageId].producedPerSecond).toBeCloseTo(5);
      expect(result.storages[storageId].consumedPerSecond).toBeCloseTo(2);
      expect(result.storages[storageId].netPerSecond).toBeCloseTo(3);
      expect(result.storages[storageId].status).toBe("filling");
    }
    expect(result.nodes.consumer.utilization).toBeCloseTo(1);
  });

  it("does not consume non-consumed recipe inputs", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "non-consumed-project",
      name: "Non-consumed input test",
      recipes: [
        {
          id: "catalyst-recipe",
          name: "Catalyst recipe",
          machineType: "Chemical Reactor",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 30,
          inputs: [
            { kind: "item", id: "catalyst", amount: 1, consumed: false },
            { kind: "item", id: "dust", amount: 2 },
          ],
          outputs: [{ kind: "item", id: "product", amount: 1 }],
        },
      ],
      nodes: [
        {
          id: "node",
          recipeId: "catalyst-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.nodes.node.inputs["item:catalyst"]).toBeUndefined();
    expect(result.resources["item:catalyst"]).toBeUndefined();
    expect(result.resources["item:dust"].consumedPerSecond).toBeCloseTo(2);
  });

  it("applies output chance to production and capacity", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "chance-output-project",
      name: "Chance output test",
      targetRate: {
        kind: "item",
        resourceId: "tiny_dust",
        amountPerSecond: 0.25,
      },
      recipes: [
        {
          id: "chance-recipe",
          name: "Chance recipe",
          machineType: "Ore Washer",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 30,
          inputs: [{ kind: "item", id: "ore", amount: 1 }],
          outputs: [{ kind: "item", id: "tiny_dust", amount: 1, chance: 0.25 }],
        },
      ],
      nodes: [
        {
          id: "node",
          recipeId: "chance-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.nodes.node.outputs["item:tiny_dust"].amountPerSecond).toBeCloseTo(0.25);
    expect(result.resources["item:tiny_dust"].producedPerSecond).toBeCloseTo(0.25);
    expect(result.nodes.node.maxRatePerSecond).toBeCloseTo(0.25);
    expect(result.nodes.node.utilization).toBeCloseTo(1);
  });

  it("applies voltage tier overclocks to speed and EU/t", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "overclock-project",
      name: "Overclock test",
      recipes: [
        {
          id: "dust-recipe",
          name: "Dust recipe",
          machineType: "Macerator",
          minimumTier: "LV",
          durationTicks: 80,
          eut: 30,
          inputs: [{ kind: "item", id: "ore", amount: 1 }],
          outputs: [{ kind: "item", id: "dust", amount: 2 }],
        },
      ],
      nodes: [
        {
          id: "node",
          recipeId: "dust-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "MV",
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.nodes.node.operationRatePerSecond).toBeCloseTo(0.5);
    expect(result.nodes.node.outputs["item:dust"].amountPerSecond).toBeCloseTo(1);
    expect(result.nodes.node.inputs["item:ore"].amountPerSecond).toBeCloseTo(0.5);
    expect(result.nodes.node.euT).toBe(120);
    expect(result.totalEuT).toBe(120);
  });

  it("applies Tree Growth Simulator tier and tool output formulas without changing work time", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "tgs-project",
      name: "TGS formula test",
      recipes: [
        {
          id: "tgs-oak",
          name: "Tree Growth Simulator: Oak Log",
          machineType: "Tree Growth Simulator",
          minimumTier: "UNKNOWN",
          durationTicks: 100,
          eut: 0,
          inputs: [{ kind: "item", id: "minecraft:sapling", amount: 1, consumed: false }],
          outputs: [
            {
              kind: "item",
              id: "minecraft:log",
              amount: 5,
              neiSlot: { x: 108, y: 36 },
            },
            {
              kind: "item",
              id: "minecraft:sapling",
              amount: 5,
              neiSlot: { x: 126, y: 36 },
            },
          ],
          machineConfigControls: [
            {
              id: "tgsToolSlot1",
              label: "Tool Slot 1",
              minimumKey: "none",
              defaultKey: "none",
              tiers: [
                {
                  key: "none",
                  label: "-",
                  resource: { kind: "item", id: "empty", amount: 1 },
                },
                {
                  key: "log:saw",
                  label: "Saw",
                  outputMultiplier: 1,
                  resource: { kind: "item", id: "saw", amount: 1 },
                },
                {
                  key: "log:chainsaw",
                  label: "Chainsaw",
                  outputMultiplier: 4,
                  resource: { kind: "item", id: "chainsaw", amount: 1 },
                },
              ],
            },
            {
              id: "tgsToolSlot2",
              label: "Tool Slot 2",
              minimumKey: "none",
              defaultKey: "none",
              tiers: [
                {
                  key: "none",
                  label: "-",
                  resource: { kind: "item", id: "empty", amount: 1 },
                },
                {
                  key: "sapling:branch_cutter",
                  label: "Branch Cutter",
                  outputMultiplier: 1,
                  resource: { kind: "item", id: "branch_cutter", amount: 1 },
                },
              ],
            },
          ],
          source: { recipeMap: "Tree Growth Simulator" },
        },
      ],
      nodes: [
        {
          id: "node",
          recipeId: "tgs-oak",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          machineConfigTiers: { tgsToolSlot1: "log:chainsaw" },
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.nodes.node.operationRatePerSecond).toBeCloseTo(0.2);
    expect(result.nodes.node.outputs["item:minecraft:log"].amountPerSecond).toBeCloseTo(7.2);
    expect(result.nodes.node.outputs["item:minecraft:sapling"].amountPerSecond).toBe(0);
    expect(result.nodes.node.euT).toBe(0);
  });

  it("uses the first matching Tree Growth Simulator tool per output mode", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "tgs-tool-order-project",
      name: "TGS tool order test",
      recipes: [
        {
          id: "tgs-oak",
          name: "Tree Growth Simulator: Oak Log",
          machineType: "Tree Growth Simulator",
          minimumTier: "UNKNOWN",
          durationTicks: 100,
          eut: 0,
          inputs: [{ kind: "item", id: "minecraft:sapling", amount: 1, consumed: false }],
          outputs: [
            {
              kind: "item",
              id: "minecraft:log",
              amount: 5,
              neiSlot: { x: 108, y: 36 },
            },
          ],
          machineConfigControls: [
            {
              id: "tgsToolSlot1",
              label: "Tool Slot 1",
              minimumKey: "none",
              defaultKey: "none",
              tiers: [
                {
                  key: "none",
                  label: "-",
                  resource: { kind: "item", id: "empty", amount: 1 },
                },
                {
                  key: "log:saw",
                  label: "Saw",
                  outputMultiplier: 1,
                  resource: { kind: "item", id: "saw", amount: 1 },
                },
              ],
            },
            {
              id: "tgsToolSlot2",
              label: "Tool Slot 2",
              minimumKey: "none",
              defaultKey: "none",
              tiers: [
                {
                  key: "none",
                  label: "-",
                  resource: { kind: "item", id: "empty", amount: 1 },
                },
                {
                  key: "log:chainsaw",
                  label: "Chainsaw",
                  outputMultiplier: 4,
                  resource: { kind: "item", id: "chainsaw", amount: 1 },
                },
              ],
            },
          ],
          source: { recipeMap: "Tree Growth Simulator" },
        },
      ],
      nodes: [
        {
          id: "node",
          recipeId: "tgs-oak",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          machineConfigTiers: { tgsToolSlot1: "log:saw", tgsToolSlot2: "log:chainsaw" },
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.nodes.node.outputs["item:minecraft:log"].amountPerSecond).toBeCloseTo(1.8);
  });

  it("does not produce Tree Growth Simulator outputs when the required tool slot is empty", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "tgs-no-tool-project",
      name: "TGS no tool test",
      recipes: [
        {
          id: "tgs-oak",
          name: "Tree Growth Simulator: Oak Log",
          machineType: "Tree Growth Simulator",
          minimumTier: "UNKNOWN",
          durationTicks: 100,
          eut: 0,
          inputs: [{ kind: "item", id: "minecraft:sapling", amount: 1, consumed: false }],
          outputs: [
            {
              kind: "item",
              id: "minecraft:log",
              amount: 5,
              neiSlot: { x: 108, y: 36 },
            },
          ],
          machineConfigControls: [
            {
              id: "tgsToolSlot1",
              label: "Tool Slot 1",
              minimumKey: "none",
              defaultKey: "none",
              tiers: [
                {
                  key: "none",
                  label: "-",
                  resource: { kind: "item", id: "empty", amount: 1 },
                },
                {
                  key: "log:saw",
                  label: "Saw",
                  outputMultiplier: 1,
                  resource: { kind: "item", id: "saw", amount: 1 },
                },
              ],
            },
          ],
          source: { recipeMap: "Tree Growth Simulator" },
        },
      ],
      nodes: [
        {
          id: "node",
          recipeId: "tgs-oak",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          machineConfigTiers: { tgsToolSlot1: "none" },
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.nodes.node.outputs["item:minecraft:log"].amountPerSecond).toBe(0);
  });

  it("uses filled-cell outputs as fluid capacity for tank links", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "filled-cell-fluid-storage-flow",
      name: "Filled cell fluid storage flow",
      recipes: [
        {
          id: "oxygen-cell-source",
          name: "Oxygen Cell Source",
          machineType: "Dehydrator",
          minimumTier: "LV",
          durationTicks: 196,
          eut: 16,
          inputs: [{ kind: "item", id: "empty_cell", amount: 14, displayName: "Empty Cell" }],
          outputs: [
            {
              kind: "item",
              id: "oxygen_cell",
              amount: 14,
              displayName: "Oxygen Cell",
            },
          ],
        },
        {
          id: "oxygen-consumer",
          name: "Oxygen Consumer",
          machineType: "Chemical Reactor",
          minimumTier: "LV",
          durationTicks: 160,
          eut: 30,
          inputs: [
            { kind: "fluid", id: "oxygen", amount: 1000, displayName: "Oxygen" },
            { kind: "fluid", id: "ethylene", amount: 1000, displayName: "Ethylene" },
          ],
          outputs: [
            { kind: "item", id: "water_cell", amount: 1, displayName: "Water Cell" },
            { kind: "item", id: "empty_cell", amount: 1, displayName: "Empty Cell" },
          ],
        },
      ],
      nodes: [
        {
          id: "oxygen-cell-source-node",
          recipeId: "oxygen-cell-source",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 0, y: 0 },
        },
        {
          id: "oxygen-consumer-node",
          recipeId: "oxygen-consumer",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 200, y: 0 },
          recipeInputOverrides: {
            "0": {
              kind: "fluid",
              id: "oxygen",
              amount: 1000,
              displayName: "Oxygen",
            },
          },
        },
      ],
      storages: [
        {
          id: "oxygen-tank",
          kind: "fluid",
          resourceId: "oxygen",
          displayName: "Oxygen",
          position: { x: 100, y: 0 },
        },
        {
          id: "ethylene-tank",
          kind: "fluid",
          resourceId: "ethylene",
          displayName: "Ethylene",
          position: { x: 100, y: 100 },
        },
        {
          id: "water-tank",
          kind: "fluid",
          resourceId: "water",
          displayName: "Water",
          position: { x: 400, y: 0 },
        },
        {
          id: "empty-cell-drawer",
          kind: "item",
          resourceId: "empty_cell",
          displayName: "Empty Cell",
          position: { x: 400, y: 100 },
        },
      ],
      edges: [
        {
          id: "oxygen-cell-to-tank",
          source: "oxygen-cell-source-node",
          target: "oxygen-tank",
          resourceKind: "fluid",
          resourceId: "oxygen",
          label: "Oxygen Cell",
        },
        {
          id: "oxygen-tank-to-consumer",
          source: "oxygen-tank",
          target: "oxygen-consumer-node",
          resourceKind: "fluid",
          resourceId: "oxygen",
          label: "Oxygen",
        },
        {
          id: "ethylene-tank-to-consumer",
          source: "ethylene-tank",
          target: "oxygen-consumer-node",
          resourceKind: "fluid",
          resourceId: "ethylene",
          label: "Ethylene",
        },
        {
          id: "water-cell-to-tank",
          source: "oxygen-consumer-node",
          target: "water-tank",
          resourceKind: "fluid",
          resourceId: "water",
          label: "Water Cell",
        },
        {
          id: "empty-cell-to-drawer",
          source: "oxygen-consumer-node",
          target: "empty-cell-drawer",
          resourceKind: "item",
          resourceId: "empty_cell",
          label: "Empty Cell",
        },
      ],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.edges["oxygen-cell-to-tank"].transferredPerSecond).toBeCloseTo(
      1428.5714285714287,
    );
    expect(result.edges["oxygen-tank-to-consumer"].transferredPerSecond).toBeCloseTo(125);
    expect(result.edges["water-cell-to-tank"].transferredPerSecond).toBeCloseTo(125);
    expect(result.edges["empty-cell-to-drawer"].transferredPerSecond).toBeCloseTo(0.125);
    expect(result.storages["oxygen-tank"].producedPerSecond).toBeCloseTo(1428.5714285714287);
    expect(result.storages["oxygen-tank"].consumedPerSecond).toBeCloseTo(125);
    expect(result.storages["oxygen-tank"].netPerSecond).toBeCloseTo(1303.5714285714287);
    expect(result.externalInputs).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "fluid", resourceId: "oxygen" })]),
    );
  });

  it("uses filled-cell output alternatives for non-name-matching molten fluids", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "molten-cell-fluid-storage-flow",
      name: "Molten cell fluid storage flow",
      recipes: [
        {
          id: "silicone-cell-source",
          name: "Fluid Canner: Molten Silicone Rubber Cell",
          machineType: "Fluid Canner",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 16,
          inputs: [
            {
              kind: "fluid",
              id: "molten.silicone",
              amount: 144,
              displayName: "Molten Silicone Rubber",
            },
          ],
          outputs: [
            {
              kind: "item",
              id: "gregtech:gt.metaitem.99@471",
              amount: 1,
              displayName: "Molten Silicone Rubber Cell",
              alternatives: [
                {
                  kind: "fluid",
                  id: "molten.silicone",
                  displayName: "Molten Silicone Rubber",
                  amount: 144,
                },
              ],
            },
          ],
        },
      ],
      nodes: [
        {
          id: "silicone-cell-source-node",
          recipeId: "silicone-cell-source",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      storages: [
        {
          id: "silicone-tank",
          kind: "fluid",
          resourceId: "molten.silicone",
          displayName: "Molten Silicone Rubber",
          position: { x: 100, y: 0 },
        },
      ],
      edges: [
        {
          id: "silicone-cell-to-tank",
          source: "silicone-cell-source-node",
          target: "silicone-tank",
          sourceHandle: "output:item:gregtech%3Agt.metaitem.99%40471:0",
          targetHandle: "input:fluid:molten.silicone",
          resourceKind: "fluid",
          resourceId: "molten.silicone",
          label: "Molten Silicone Rubber Cell",
        },
      ],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.edges["silicone-cell-to-tank"].transferredPerSecond).toBeCloseTo(144);
    expect(result.storages["silicone-tank"].producedPerSecond).toBeCloseTo(144);
  });

  it("reports a starved consumer as supply-capped against its nameplate demand", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "starved-project",
      name: "Starved chain",
      targetRate: { kind: "item", resourceId: "widget", amountPerSecond: 1 },
      recipes: [
        {
          id: "slow-producer",
          name: "Slow producer",
          machineType: "Macerator",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 30,
          inputs: [],
          outputs: [{ kind: "item", id: "cog", amount: 1 }],
        },
        {
          id: "hungry-consumer",
          name: "Hungry consumer",
          machineType: "Assembler",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 30,
          inputs: [{ kind: "item", id: "cog", amount: 100 }],
          outputs: [{ kind: "item", id: "widget", amount: 1 }],
        },
      ],
      nodes: [
        {
          id: "producer",
          recipeId: "slow-producer",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 0, y: 0 },
        },
        {
          id: "consumer",
          recipeId: "hungry-consumer",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 300, y: 0 },
        },
      ],
      storages: [],
      edges: [
        {
          id: "producer-to-consumer",
          source: "producer",
          target: "consumer",
          resourceKind: "item",
          resourceId: "cog",
        },
      ],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });
    const edge = result.edges["producer-to-consumer"];

    // The consumer wants 100/s but the producer only makes 1/s. Asks no
    // longer track the consumer's own starved throttle, so the edge reports
    // the honest shortfall directly instead of hiding it behind convergence.
    expect(edge.transferredPerSecond).toBeCloseTo(1);
    expect(edge.demandPerSecond).toBeCloseTo(100);
    expect(edge.isLimited).toBe(true);

    // The nameplate comparison agrees.
    expect(edge.nameplateDemandPerSecond).toBeCloseTo(100);
    expect(edge.sourceCapacityPerSecond).toBeCloseTo(1);
    expect(edge.constraint).toBe("supply");
  });

  it("treats a consumer with spare supply on both ends as demand-capped", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "slack-project",
      name: "Slack chain",
      targetRate: { kind: "item", resourceId: "widget", amountPerSecond: 1 },
      recipes: [
        {
          id: "fast-producer",
          name: "Fast producer",
          machineType: "Macerator",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 30,
          inputs: [],
          outputs: [{ kind: "item", id: "cog", amount: 1_000 }],
        },
        {
          id: "small-consumer",
          name: "Small consumer",
          machineType: "Assembler",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 30,
          inputs: [{ kind: "item", id: "cog", amount: 1 }],
          outputs: [{ kind: "item", id: "widget", amount: 1 }],
        },
      ],
      nodes: [
        {
          id: "producer",
          recipeId: "fast-producer",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 0, y: 0 },
        },
        {
          id: "consumer",
          recipeId: "small-consumer",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 300, y: 0 },
        },
      ],
      storages: [],
      edges: [
        {
          id: "producer-to-consumer",
          source: "producer",
          target: "consumer",
          resourceKind: "item",
          resourceId: "cog",
        },
      ],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });
    const edge = result.edges["producer-to-consumer"];

    // Fed to its nameplate, so nothing is holding it back.
    expect(edge.transferredPerSecond).toBeCloseTo(1);
    expect(edge.nameplateDemandPerSecond).toBeCloseTo(1);
    expect(edge.constraint).toBe("full");
  });
});

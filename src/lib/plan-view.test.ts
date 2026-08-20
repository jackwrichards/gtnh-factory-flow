import { describe, expect, it } from "vitest";
import { factoryProjectSchema } from "@/lib/model/schemas";
import { PROJECT_SCHEMA_VERSION, type FactoryProject, type PlanViewState } from "@/lib/model/types";
import { parseFactoryProjectJson, serializeFactoryProject } from "@/lib/import-export";

/**
 * The view has to survive three separate validations on its way to another
 * player: `serializeFactoryProject` on the way out, the server's own
 * `factoryProjectSchema.safeParse`, and `parseFactoryProjectJson` on the way
 * in. All three strip what the schema does not declare, so a field missing
 * from the schema would vanish silently with nothing failing.
 */
const VIEW: PlanViewState = {
  canvasPattern: "lines",
  lineHeatMode: true,
  lineThicknessMode: false,
  freeDockMode: false,
  lineLabelsMode: true,
  linePulseMode: false,
  calmMode: true,
  glanceMode: "status",
  rateUnit: "hour",
  leftPanelOpen: false,
  rightPanelOpen: true,
  showHiddenResources: true,
  favouritesOnly: false,
  trendsOpen: false,
  hiddenResourceKeys: ["item:cobblestone"],
  favouriteResourceKeys: ["item:iron_ingot", "fluid:water"],
};

function project(view?: PlanViewState): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "view-round-trip",
    name: "View round trip",
    view,
    recipes: [
      {
        id: "r1",
        name: "Smelt",
        machineType: "Furnace",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 30,
        inputs: [{ kind: "item", id: "ore", amount: 1 }],
        outputs: [{ kind: "item", id: "ingot", amount: 1 }],
      },
    ],
    nodes: [
      {
        id: "n1",
        recipeId: "r1",
        machineCount: 1,
        parallel: 1,
        overclockTier: "LV",
        enabled: true,
        position: { x: 0, y: 0 },
      },
    ],
    edges: [],
  };
}

describe("a shared plan's view state", () => {
  it("survives serialize and parse intact", () => {
    const restored = parseFactoryProjectJson(serializeFactoryProject(project(VIEW)));
    expect(restored.view).toEqual(VIEW);
  });

  it("survives the server's own validation of the uploaded plan", () => {
    // Exactly what the upload route does with `body.plan`.
    const parsed = factoryProjectSchema.safeParse(
      JSON.parse(serializeFactoryProject(project(VIEW))),
    );

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.view).toEqual(VIEW);
  });

  it("stays absent on a plan that never carried one", () => {
    // Every field is optional, so an older plan round-trips with nothing to
    // say and the viewer keeps their own settings.
    const restored = parseFactoryProjectJson(serializeFactoryProject(project()));
    expect(restored.view).toBeUndefined();
  });

  it("keeps a partial view rather than rejecting the plan", () => {
    const partial: PlanViewState = { rateUnit: "minute", favouriteResourceKeys: ["item:tin"] };
    const restored = parseFactoryProjectJson(serializeFactoryProject(project(partial)));

    expect(restored.view).toEqual(partial);
  });

  it("accepts a view naming settings this build does not know", () => {
    // A plan saved by a newer build must not be rejected wholesale. Unknown
    // values are dropped where the view is APPLIED, not here.
    const parsed = factoryProjectSchema.safeParse({
      ...project(),
      view: { canvasPattern: "hexagons", glanceMode: "x-ray" },
    });

    expect(parsed.success).toBe(true);
  });
});

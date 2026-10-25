import { describe, expect, it } from "vitest";
import { withSynthesizedHandlerIcons } from "./dataset-query";

type Catalog = Parameters<typeof withSynthesizedHandlerIcons>[0];

const resource = (id: string, displayName: string) => ({ kind: "item", id, displayName, recipeCount: 1 });

describe("faces for the machines the app adds", () => {
  const catalog = {
    machineHandlerIcons: [],
    resources: [
      resource("magicbees:magicapiary", "Magic Apiary"),
      resource("forestry:alveary", "Alveary"),
      resource("gregtech:gt.blockmachines@9399", "Industrial Apiary"),
      // Gendustry's block shares the name; listed later, a name lookup would take it.
      resource("gendustry:industrialapiary", "Industrial Apiary"),
      resource("gregtech:gt.blockmachines@14202", "Industrial Apicultural Acclimatiser and Drone Domestication Station"),
    ],
  } as unknown as Catalog;
  const faces = new Map(withSynthesizedHandlerIcons(catalog).map((entry) => [entry.familyId, entry.resource]));

  it("give each bee housing its own block", () => {
    expect(faces.get("magic-apiary")?.id).toBe("magicbees:magicapiary");
    expect(faces.get("alveary")?.id).toBe("forestry:alveary");
    expect(faces.get("industrial-apiary")?.id).toBe("gregtech:gt.blockmachines@9399");
    expect(faces.get("mega-apiary")?.id).toBe("gregtech:gt.blockmachines@14202");
  });

  it("name the Mega Apiary as players do", () => {
    expect(faces.get("mega-apiary")?.displayName).toBe("Mega Apiary");
    expect(faces.get("alveary")?.displayName).toBe("Alveary");
  });
});

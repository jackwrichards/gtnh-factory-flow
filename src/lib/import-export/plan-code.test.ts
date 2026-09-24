import { describe, expect, it } from "vitest";
import { loadBiodieselDemoProject } from "@/examples";
import type { FactoryProject } from "../model/types";
import { parseFactoryProjectJson, serializeFactoryProject } from "./factory-json";
import {
  decodePlanCode,
  encodePlanCode,
  planCodeLink,
  readPlanCodeFromHash,
} from "./plan-code";

/** The demo, with a GregTech overclock table and a crop table on its recipes. */
function demoWithTables(): FactoryProject {
  const project = loadBiodieselDemoProject();
  const variant = { id: "lv", durationTicks: 100, eut: 30 };
  return {
    ...project,
    metadata: { ...project.metadata, communityPlanId: "post-123" },
    recipes: project.recipes.map((recipe, index) => ({
      ...recipe,
      runtimeCalculation: {
        sourceKind: index === 0 ? "passive-crop" : "gregtech-overclock-calculator",
        status: "computed",
        oracleEligible: true,
        variants: [variant],
      },
    })),
  };
}

describe("copied plans (plan codes)", () => {
  it("round-trips a plan through its code", async () => {
    const project = loadBiodieselDemoProject();
    const decoded = await decodePlanCode(await encodePlanCode(project));
    expect(decoded).toEqual(parseFactoryProjectJson(serializeFactoryProject(project)));
  });

  it("opens from the link, and from a link a chat window broke over lines", async () => {
    const project = loadBiodieselDemoProject();
    const link = planCodeLink(await encodePlanCode(project), "https://gtnhplanner.com");
    expect(link.startsWith("https://gtnhplanner.com/#p=gtnh1.")).toBe(true);
    expect((await decodePlanCode(link)).name).toBe(project.name);
    const wrapped = `  ${link.slice(0, 40)}\n${link.slice(40, 90)}\r\n${link.slice(90)}  `;
    expect((await decodePlanCode(wrapped)).nodes).toHaveLength(project.nodes.length);
  });

  it("leaves out GregTech overclock tables and the community post, nothing else", async () => {
    const decoded = await decodePlanCode(await encodePlanCode(demoWithTables()));
    expect(decoded.metadata?.communityPlanId).toBeUndefined();
    expect(decoded.recipes[0]?.runtimeCalculation?.sourceKind).toBe("passive-crop");
    expect(decoded.recipes.slice(1).every((recipe) => recipe.runtimeCalculation === undefined)).toBe(
      true,
    );
  });

  it("is far shorter than the JSON download", async () => {
    const project = demoWithTables();
    const code = await encodePlanCode(project);
    expect(code.length * 5).toBeLessThan(serializeFactoryProject(project).length);
  });

  it("refuses anything that is not a whole copied plan, in plain words", async () => {
    await expect(decodePlanCode("hello")).rejects.toThrow(/not a copied plan/);
    const code = await encodePlanCode(loadBiodieselDemoProject());
    await expect(decodePlanCode(code.slice(0, code.length / 2))).rejects.toThrow(/cut short or damaged/);
    await expect(decodePlanCode("gtnh1.!!!")).rejects.toThrow(/cut short or damaged/);
  });

  it("reads the code out of an address fragment", () => {
    expect(readPlanCodeFromHash("#p=gtnh1.abc")).toBe("gtnh1.abc");
    expect(readPlanCodeFromHash("p=gtnh1.abc")).toBe("gtnh1.abc");
    expect(readPlanCodeFromHash("#somewhere")).toBeUndefined();
    expect(readPlanCodeFromHash("")).toBeUndefined();
  });
});

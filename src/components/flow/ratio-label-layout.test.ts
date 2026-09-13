import { expect, it } from "vitest";
import { layoutRatioLabels } from "./ratio-label-layout";

it("places incoming and outgoing shares close to the corresponding drawer", () => {
  const labels = layoutRatioLabels([
    {
      id: "wire",
      points: [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
      ],
      output: "50%",
      input: "25%",
    },
  ]).get("wire");
  expect(labels).toEqual([
    { key: "output", text: "Out 50%", ratio: 0.15 },
    { key: "input", text: "In 25%", ratio: 0.85 },
  ]);
});

it("separates crowded labels along their wires without changing the route", () => {
  const wires = [0, 1].map((i) => ({
    id: String(i),
    points: [
      { x: 0, y: i },
      { x: 400, y: i },
    ],
    output: "50%",
  }));
  const original = structuredClone(wires);
  const labels = layoutRatioLabels(wires);
  const a = labels.get("0")![0].ratio * 400;
  const b = labels.get("1")![0].ratio * 400;
  expect(Math.abs(a - b)).toBeGreaterThanOrEqual(44);
  expect(wires).toEqual(original);
});

it("combines both shares on short wires and ignores zero-length routes", () => {
  const labels = layoutRatioLabels([
    {
      id: "short",
      points: [
        { x: 0, y: 0 },
        { x: 80, y: 0 },
      ],
      output: "50%",
      input: "25%",
    },
    { id: "empty", points: [{ x: 0, y: 0 }], output: "100%" },
  ]);
  expect(labels.get("short")).toEqual([{ key: "both", text: "Out 50%\nIn 25%", ratio: 0.5 }]);
  expect(labels.has("empty")).toBe(false);
});

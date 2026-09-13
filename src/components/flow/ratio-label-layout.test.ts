import { expect, it } from "vitest";
import { arrowOverlapsRatioLabel, layoutRatioLabels, ratioLabelBounds } from "./ratio-label-layout";

it("clears horizontal, vertical and diagonal arrowheads from the entire badge", () => {
  const labels = [ratioLabelBounds("50%", { x: 60, y: 60 })];
  for (const arrow of ["80,60 64,68 64,52", "60,80 52,64 68,64", "80,80 60,65 65,60"])
    expect(arrowOverlapsRatioLabel(arrow, labels)).toBe(true);
  expect(arrowOverlapsRatioLabel("150,60 134,68 134,52", labels)).toBe(false);
  expect(arrowOverlapsRatioLabel("60,60 44,68 44,52", [])).toBe(false);
  expect(ratioLabelBounds("Out 50%\nIn 25%", { x: 0, y: 0 }).height).toBe(36);
});

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

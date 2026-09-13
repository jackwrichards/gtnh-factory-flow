import { expect, it } from "vitest";
import { fitRatioArrow, labelRatioArrows, layoutRatioLabels } from "./ratio-label-layout";

it("labels the nearest arrows while preserving the original arrow data", () => {
  const arrows = ["90,0 60,15 60,-15", "210,0 180,15 180,-15"];
  const original = [...arrows];
  const labels = labelRatioArrows(arrows, [
    { key: "output", text: "Out 50%", ratio: 0.2, point: { x: 60, y: 0 } },
    { key: "input", text: "In 25%", ratio: 0.8, point: { x: 210, y: 0 } },
  ]);
  expect(labels.map((label) => label.arrowIndex)).toEqual([0, 1]);
  expect(arrows).toEqual(original);
  expect(labelRatioArrows(arrows.slice(0, 1), labels)[0].text).toBe("Out 50%\nIn 25%");
});

it("contains percentages within triangles in all eight directions, including 100% and paired shares", () => {
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    const rotate = ([x, y]: number[]) =>
      `${x * Math.cos(angle) - y * Math.sin(angle)},${x * Math.sin(angle) + y * Math.cos(angle)}`;
    const arrow = [
      [16, 0],
      [0, 8],
      [0, -8],
    ]
      .map(rotate)
      .join(" ");
    for (const text of ["0%", "80%", "100%", "99.99%", "Out 50%\nIn 25%"]) {
      const fitted = fitRatioArrow(arrow, text);
      const points = fitted.polygon.split(" ").map((point) => point.split(",").map(Number));
      const width = Math.max(...text.split("\n").map((line) => line.length)) * 7;
      const height = text.split("\n").length * 10;
      for (const x of [-width / 2, width / 2])
        for (const y of [-height / 2, height / 2]) {
          const rotation = (fitted.rotation * Math.PI) / 180;
          const rx = x * Math.cos(rotation) - y * Math.sin(rotation);
          const ry = x * Math.sin(rotation) + y * Math.cos(rotation);
          const signs = points.map(([ax, ay], index) => {
            const [bx, by] = points[(index + 1) % 3];
            return (bx - ax) * (fitted.point.y + ry - ay) - (by - ay) * (fitted.point.x + rx - ax);
          });
          expect(signs.every((sign) => sign > 0) || signs.every((sign) => sign < 0)).toBe(true);
        }
    }
  }
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

import { expect, it } from "vitest";
import { ratioExitLabel } from "./ratio-exit-label";

it.each([
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
])("keeps a percentage outside its source for direction %s, %s", (dx, dy) => {
  const start = { x: 400, y: 200 };
  const label = ratioExitLabel([start, start, { x: start.x + dx * 20, y: start.y + dy * 20 }], 0)!;
  if (dx) expect((label.x - start.x) * dx).toBeGreaterThan(0);
  if (dy) expect((label.y - start.y) * dy).toBeGreaterThan(0);
  if (dx < 0) expect(label.transform).toContain("-100%");
  expect(Math.hypot(label.x - start.x, label.y - start.y)).toBeLessThan(30);
});

it("anchors at the exit regardless of downstream wire length", () => {
  const start = [
    { x: 100, y: 0 },
    { x: 120, y: 0 },
  ];
  expect(ratioExitLabel([...start, { x: 10000, y: 500 }], 0)).toEqual(ratioExitLabel(start, 0));
  expect(ratioExitLabel([], 0)).toBeUndefined();
  expect(ratioExitLabel([start[0], start[0]], 0)).toBeUndefined();
});

import { expect, it } from "vitest";
import { arrowInkFor } from "./node-colors";

it.each([
  ["#000000", "#ffffff"],
  ["#ffffff", "#000000"],
  ["#0000ff", "#ffffff"],
  ["#00ff00", "#000000"],
  ["#ffff00", "#000000"],
  ["#ff0000", "#000000"],
  ["#747474", "#ffffff"],
  ["#777777", "#000000"],
  ["#d4d6df", "#000000"],
])("chooses the more readable ink for arrow fill %s", (fill, ink) => {
  expect(arrowInkFor(fill)).toBe(ink);
});

// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { BoardHelp } from "./BoardHelp";

afterEach(cleanup);

it.each([false, true])("survives viewport layout changes starting with compact=%s", (compact) => {
  const view = render(<BoardHelp compact={compact} />);
  view.rerender(<BoardHelp compact={!compact} />);
  expect(view.getByRole("button", { name: "Show board help" })).toBeDefined();
  view.rerender(<BoardHelp compact={compact} />);
  expect(view.getByRole("button", { name: "Show board help" })).toBeDefined();
});

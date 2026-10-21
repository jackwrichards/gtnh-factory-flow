// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { listenForBoardInput } from "./keyboard";

describe("covered canvas input", () => {
  it("preserves hidden selections through page keys and paste, then restores board input", () => {
    let covered = false;
    const edit = vi.fn((event: Event) => event.preventDefault());
    const stopKeys = listenForBoardInput("keydown", edit, () => covered);
    const stopPaste = listenForBoardInput("paste", edit, () => covered);
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    try {
      covered = true;
      for (const init of [
        { key: "Delete" },
        { key: "Backspace" },
        { key: "x", ctrlKey: true },
        { key: "v", ctrlKey: true },
        { key: "g", ctrlKey: true },
      ]) {
        const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
        button.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
      }
      const paste = new Event("paste", { bubbles: true, cancelable: true });
      button.dispatchEvent(paste);
      expect(paste.defaultPrevented).toBe(false);
      expect(edit).not.toHaveBeenCalled();

      covered = false;
      button.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
      button.dispatchEvent(new Event("paste", { bubbles: true }));
      expect(edit).toHaveBeenCalledTimes(2);
      stopKeys();
      stopPaste();
      button.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
      expect(edit).toHaveBeenCalledTimes(2);
    } finally {
      stopKeys();
      stopPaste();
      button.remove();
    }
  });
});

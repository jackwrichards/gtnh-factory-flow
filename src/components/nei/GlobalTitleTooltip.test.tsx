// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalTitleTooltip } from "./GlobalTitleTooltip";
import { isTouchPointer } from "@/lib/pointer-kind";
vi.mock("@/lib/pointer-kind", () => ({ isTouchPointer: vi.fn(() => false) }));

function pointer(target: Element | Window, type: string, x = 120, buttons = type === "pointerdown" ? 1 : 0) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: 80, buttons });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  fireEvent(target, event);
}
function Toggle() {
  const [on, setOn] = useState(true);
  return <><GlobalTitleTooltip /><button title={on ? "Balance on" : "Balance off"} onClick={() => setOn(!on)}>Balance</button><button>Other</button></>;
}
const hover = (target: Element) => fireEvent.mouseMove(target, { clientX: 120, clientY: 80, buttons: 0 });

beforeEach(() => {
  vi.mocked(isTouchPointer).mockReturnValue(false);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => window.setTimeout(() => callback(0), 0));
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => window.clearTimeout(id));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("GlobalTitleTooltip", () => {
  it("keeps a control's tooltip on press and updates each click without re-hovering", async () => {
    render(<Toggle />);
    const button = screen.getByRole("button", { name: "Balance" });
    hover(button);
    expect(await screen.findByText("Balance on")).toBeTruthy();
    expect(button.hasAttribute("title")).toBe(false);
    pointer(button, "pointerdown");
    expect(screen.getByText("Balance on")).toBeTruthy();
    fireEvent.mouseMove(button, { clientX: 121, clientY: 80, buttons: 1 });
    expect(screen.getByText("Balance on")).toBeTruthy();
    pointer(button, "pointerup");
    fireEvent.click(button);
    expect(await screen.findByText("Balance off")).toBeTruthy();
    expect(screen.queryByText("Balance on")).toBeNull();
    expect(button.hasAttribute("title")).toBe(false);
    pointer(button, "pointerdown");
    pointer(button, "pointerup");
    fireEvent.click(button);
    expect(await screen.findByText("Balance on")).toBeTruthy();
  });

  it("refreshes a hovered title changed asynchronously and clears an empty title", async () => {
    const { rerender } = render(<><GlobalTitleTooltip /><button title="First">Control</button></>);
    hover(screen.getByRole("button"));
    expect(await screen.findByText("First")).toBeTruthy();
    rerender(<><GlobalTitleTooltip /><button title="Second">Control</button></>);
    expect(await screen.findByText("Second")).toBeTruthy();
    rerender(<><GlobalTitleTooltip /><button title="">Control</button></>);
    await waitFor(() => expect(screen.queryByText("Second")).toBeNull());
  });

  it("survives element focus changes but closes when the window loses focus", async () => {
    render(<Toggle />);
    const button = screen.getByRole("button", { name: "Balance" });
    hover(button);
    await screen.findByText("Balance on");
    fireEvent.blur(screen.getByRole("button", { name: "Other" }));
    expect(screen.getByText("Balance on")).toBeTruthy();
    fireEvent.blur(window);
    await waitFor(() => expect(screen.queryByText("Balance on")).toBeNull());
  });

  it("closes for a drag, pointer cancellation, or press outside the hovered control", async () => {
    render(<Toggle />);
    const button = screen.getByRole("button", { name: "Balance" });
    hover(button); await screen.findByText("Balance on");
    pointer(button, "pointerdown");
    fireEvent.mouseMove(button, { clientX: 140, clientY: 80, buttons: 1 });
    await waitFor(() => expect(screen.queryByText("Balance on")).toBeNull());
    hover(button); await screen.findByText("Balance on");
    fireEvent.pointerCancel(window);
    await waitFor(() => expect(screen.queryByText("Balance on")).toBeNull());
    hover(button); await screen.findByText("Balance on");
    pointer(screen.getByRole("button", { name: "Other" }), "pointerdown");
    await waitFor(() => expect(screen.queryByText("Balance on")).toBeNull());
  });

  it("rechecks the actual element under the pointer after a control replaces itself", async () => {
    function Replaced() {
      const [replaced, setReplaced] = useState(false);
      return <><GlobalTitleTooltip />{replaced ? <button key="new" title="Replacement help">New control</button> : <button key="old" title="Original help" onClick={() => setReplaced(true)}>Old control</button>}</>;
    }
    render(<Replaced />);
    const old = screen.getByRole("button");
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => screen.queryByRole("button") });
    try {
      hover(old); await screen.findByText("Original help");
      pointer(old, "pointerdown"); pointer(old, "pointerup"); fireEvent.click(old);
      expect(await screen.findByText("Replacement help")).toBeTruthy();
      expect(screen.queryByText("Original help")).toBeNull();
    } finally { Reflect.deleteProperty(document, "elementFromPoint"); }
  });

  it("does not replace rich tooltip roots with duplicate title help", async () => {
    render(<><GlobalTitleTooltip /><button data-tooltip-root title="Duplicate">Rich control</button></>);
    const button = screen.getByRole("button");
    hover(button);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(screen.queryByText("Duplicate")).toBeNull();
    expect(button.hasAttribute("title")).toBe(false);
  });

  it("never opens title tooltips for touch", async () => {
    vi.mocked(isTouchPointer).mockReturnValue(true);
    render(<Toggle />);
    const button = screen.getByRole("button", { name: "Balance" });
    hover(button); pointer(button, "pointerdown"); pointer(button, "pointerup"); fireEvent.click(button);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(document.querySelector('[data-minecraft-tooltip]')).toBeNull();
  });
});

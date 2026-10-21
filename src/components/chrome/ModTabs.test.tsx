// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesignSummary } from "@/lib/designs/design-library";
import { readLibraryTabState, openLibrary } from "@/lib/library/library-tab";
import { onSfx } from "@/lib/sound/sfx";
import { useDesignStore } from "@/store/design-store";
import { ModTabs } from "./ModTabs";
import { openAddPlanToTask, openUpdateTask } from "@/components/tasks/AddToTask";
import { relatedPlanTasks } from "@/lib/tasks/make-task";

vi.mock("@/components/tasks/AddToTask", () => ({ openAddPlanToTask: vi.fn(), openUpdateTask: vi.fn() }));
vi.mock("@/lib/tasks/make-task", async (original) => ({
  ...await original<typeof import("@/lib/tasks/make-task")>(), relatedPlanTasks: vi.fn(async () => []),
}));

vi.mock("@/lib/compact-view", () => ({ isCompactViewport: () => false }));

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

function design(id: string, name: string, extra: Partial<DesignSummary> = {}): DesignSummary {
  return { id, name, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", ...extra };
}

const actions = {
  switchToDesign: vi.fn(async () => undefined),
  addDesign: vi.fn(async () => undefined),
  closeDesigns: vi.fn(async () => undefined),
  removeDesign: vi.fn(async () => undefined),
  renameDesign: vi.fn(async () => undefined),
  reorderDesigns: vi.fn(async () => undefined),
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  for (const fn of Object.values(actions)) fn.mockClear();
  vi.mocked(relatedPlanTasks).mockReset().mockResolvedValue([]);
  useDesignStore.setState({
    designs: [design("a", "Benzene"), design("b", "ref-chain"), design("c", "Parked", { closed: true })],
    publicViews: [],
    publicView: undefined,
    activeDesignId: "b",
    ...actions,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const props = { onPaste: vi.fn(), onShare: vi.fn() };
const rows = () => [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((element) => element.textContent);

describe("the plan tabs", () => {
  it("offers Update a task only when this plan has a linked whole-plan task", async () => {
    vi.stubEnv("NEXT_PUBLIC_LIVE_URL", "ws://localhost:3001");
    const targets = [{ id: "task", title: "Build copper", status: "todo" as const, done: 1, all: 2, boardId: "board", boardName: "Build list" }];
    vi.mocked(relatedPlanTasks).mockResolvedValue(targets);
    render(<ModTabs {...props} />);
    fireEvent.contextMenu(screen.getByText("ref-chain"));
    fireEvent.click(await screen.findByText("Update a task"));
    expect(relatedPlanTasks).toHaveBeenCalledWith("b");
    expect(openUpdateTask).toHaveBeenCalledWith(expect.any(Object), targets);
  });

  it("adds the whole active plan from its tab menu when task boards are available", () => {
    vi.stubEnv("NEXT_PUBLIC_LIVE_URL", "ws://localhost:3001");
    render(<ModTabs {...props} />);
    fireEvent.contextMenu(screen.getByText("ref-chain"));
    fireEvent.click(screen.getByText("Add plan as a task"));
    expect(openAddPlanToTask).toHaveBeenCalled();
  });

  it("never offers to turn a task board into a machine task", () => {
    vi.stubEnv("NEXT_PUBLIC_LIVE_URL", "ws://localhost:3001");
    useDesignStore.setState({ designs: [design("b", "Build list", { taskBoard: true })] });
    render(<ModTabs {...props} />);
    fireEvent.contextMenu(screen.getByText("Build list"));
    expect(screen.queryByText("Add plan as a task")).toBeNull();
  });

  it("shows one tab per open plan, the active one marked, and leaves the parked plan on the shelf", () => {
    render(<ModTabs {...props} />);
    const tabs = [...document.querySelectorAll(".mt-tab")];
    expect(tabs.map((tab) => tab.querySelector(".mt-name")?.textContent)).toEqual(["Benzene", "ref-chain"]);
    expect(tabs[1].hasAttribute("data-active")).toBe(true);
    expect(tabs[0].hasAttribute("data-active")).toBe(false);
  });

  it("a click switches to the plan, and leaves the library", () => {
    openLibrary();
    render(<ModTabs {...props} />);
    fireEvent.click(screen.getByText("Benzene"));
    expect(actions.switchToDesign).toHaveBeenCalledWith("a");
    expect(readLibraryTabState().active).toBe(false);
  });

  it("the x and a middle click close it, keeping the plan, and the next tab takes over", () => {
    render(<ModTabs {...props} />);
    fireEvent.click(screen.getByLabelText("Close Benzene"));
    expect(actions.closeDesigns).toHaveBeenCalledWith(["a"], "b");
    fireEvent(screen.getByText("ref-chain").closest(".mt-tab")!, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(actions.closeDesigns).toHaveBeenLastCalledWith(["b"], "a");
  });

  it("the last tab has no close key", () => {
    useDesignStore.setState({ designs: [design("a", "Benzene")], activeDesignId: "a" });
    render(<ModTabs {...props} />);
    expect(screen.queryByLabelText("Close Benzene")).toBeNull();
  });

  it("right-click opens the menu the mod's tab has, Delete plan last, in red", () => {
    render(<ModTabs {...props} />);
    fireEvent.contextMenu(screen.getByText("ref-chain"));
    expect(rows()).toEqual([
      "Rename",
      "Copy plan codeto paste or share",
      "Post a copy to Community...for other players",
      "Close tabkept in My plans",
      "Close other tabskept in My plans",
      "Delete plan",
    ]);
    const last = document.querySelectorAll('[role="menuitem"]');
    expect(last[last.length - 1].getAttribute("data-tone")).toBe("red");
  });

  it("Delete plan asks first and only Delete it deletes", () => {
    render(<ModTabs {...props} />);
    fireEvent.contextMenu(screen.getByText("ref-chain"));
    fireEvent.click(screen.getByText("Delete plan"));
    expect(actions.removeDesign).not.toHaveBeenCalled();
    expect(document.querySelector(".mm-title")?.textContent).toBe("Delete 'ref-chain' for good?");
    expect(rows()).toEqual(["Delete it", "Keep it"]);
    fireEvent.click(screen.getByText("Keep it"));
    expect(actions.removeDesign).not.toHaveBeenCalled();
    fireEvent.contextMenu(screen.getByText("ref-chain"));
    fireEvent.click(screen.getByText("Delete plan"));
    fireEvent.click(screen.getByText("Delete it"));
    expect(actions.removeDesign).toHaveBeenCalledWith("b");
  });

  it("the + menu: New plan, Open a plan, Paste plan, Browse Community", () => {
    render(<ModTabs {...props} />);
    fireEvent.click(screen.getByLabelText("New plan"));
    expect(rows()).toEqual(["New plan", "Open a plan...My plans", "Open plan file....json", "Paste plana plan link, code or file", "Browse Communitypublic plans"]);
    fireEvent.click(screen.getByText("Paste plan"));
    expect(props.onPaste).toHaveBeenCalled();
  });

  it("Rename edits the tab in place and Enter commits it", () => {
    render(<ModTabs {...props} />);
    fireEvent.contextMenu(screen.getByText("Benzene"));
    fireEvent.click(screen.getByText("Rename"));
    const field = screen.getByLabelText("Plan name") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Aniline" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(actions.renameDesign).toHaveBeenCalledWith("a", "Aniline");
  });

  it("every tab and the + carry a tip for the tip host", () => {
    render(<ModTabs {...props} />);
    const tab = screen.getByText("Benzene").closest(".mt-tab")!;
    expect(JSON.parse(tab.getAttribute("data-tip")!)).toMatchObject({ title: "Benzene", sub: "Middle-click to close, right-click for more" });
    expect(JSON.parse(screen.getByLabelText("New plan").getAttribute("data-tip")!).title).toBe("New plan, or open an existing one");
  });

  it("scrolls the open plan's tab back into view when the strip narrows, and leaves the scroll alone when it fits", () => {
    const resized: Array<() => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        private readonly callback: () => void;
        constructor(callback: () => void) {
          this.callback = callback;
        }
        observe() {
          resized.push(this.callback);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    let stripWidth = 400;
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("mt-strip") ? stripWidth : 0;
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("mt-tab") ? 120 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) {
      const tabs = [...(this.parentElement?.children ?? [])];
      return tabs.indexOf(this) * 122;
    });
    try {
      useDesignStore.setState({ designs: [design("a", "Benzene"), design("b", "ref-chain"), design("c", "Toluene")], activeDesignId: "c" });
      render(<ModTabs {...props} />);
      const strip = document.querySelector<HTMLElement>(".mt-strip")!;
      // The open tab is the third: it spans 244 to 364, and fits a strip of 400 at the start.
      expect(strip.scrollLeft).toBe(0);
      stripWidth = 300;
      act(() => resized.forEach((callback) => callback()));
      expect(strip.scrollLeft).toBe(364 - 300);
      stripWidth = 500;
      act(() => resized.forEach((callback) => callback()));
      expect(strip.scrollLeft).toBe(364 - 300);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});

describe("dragging the plan tabs", () => {
  const sfx: string[] = [];
  let offsetLeft: PropertyDescriptor | undefined;
  let offsetWidth: PropertyDescriptor | undefined;
  const place = (element: HTMLElement) => {
    const tabs = [...document.querySelectorAll(".mt-tab")];
    return tabs.indexOf(element);
  };
  beforeEach(() => {
    vi.useFakeTimers();
    offsetLeft = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetLeft");
    offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
    Object.defineProperty(HTMLElement.prototype, "offsetLeft", { configurable: true, get() { return Math.max(0, place(this)) * 52; } });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get() { return 50; } });
    useDesignStore.setState({
      designs: [design("a", "Benzene"), design("b", "ref-chain"), design("c", "Parked", { closed: true }), design("d", "Toluene")],
      activeDesignId: "b",
    });
    sfx.length = 0;
    return onSfx((play) => sfx.push(play.name));
  });
  afterEach(() => {
    vi.useRealTimers();
    if (offsetLeft) Object.defineProperty(HTMLElement.prototype, "offsetLeft", offsetLeft);
    if (offsetWidth) Object.defineProperty(HTMLElement.prototype, "offsetWidth", offsetWidth);
  });
  const pointer = (type: string, clientX: number, target: EventTarget = window) =>
    act(() => {
      target.dispatchEvent(new MouseEvent(type, { clientX, bubbles: true, button: 0 }));
    });
  const tabOf = (name: string) => screen.getByText(name).closest(".mt-tab") as HTMLElement;

  it("carries a tab past the slop, slides the others aside and saves the order on drop", () => {
    render(<ModTabs {...props} />);
    const first = tabOf("Benzene");
    pointer("pointerdown", 10, first);
    pointer("pointermove", 12);
    expect(first.hasAttribute("data-dragging")).toBe(false);
    pointer("pointermove", 130);
    expect(first.hasAttribute("data-dragging")).toBe(true);
    expect(first.style.transform).toBe("translateX(104px)");
    expect(tabOf("ref-chain").style.transform).toBe("translateX(-52px)");
    expect(tabOf("Toluene").style.transform).toBe("translateX(-52px)");
    pointer("pointerup", 130);
    expect(actions.reorderDesigns).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(actions.reorderDesigns).toHaveBeenCalledWith(["b", "d", "c", "a"]);
    expect(sfx).toEqual(expect.arrayContaining(["board.lift", "ui.tick", "board.drop"]));
    expect(actions.switchToDesign).not.toHaveBeenCalled();
  });

  it("a drag moves nothing and clicks nothing under the slop; the click switches", () => {
    render(<ModTabs {...props} />);
    const first = tabOf("Benzene");
    pointer("pointerdown", 10, first);
    pointer("pointermove", 13);
    pointer("pointerup", 13);
    fireEvent.click(first);
    expect(actions.switchToDesign).toHaveBeenCalledWith("a");
    expect(actions.reorderDesigns).not.toHaveBeenCalled();
  });

  it("Escape puts it back and saves nothing", () => {
    render(<ModTabs {...props} />);
    const first = tabOf("Benzene");
    pointer("pointerdown", 10, first);
    pointer("pointermove", 130);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(actions.reorderDesigns).not.toHaveBeenCalled();
    expect(first.style.transform).toBe("");
  });

  it("Ctrl+Shift+Right moves the focused tab one place", () => {
    render(<ModTabs {...props} />);
    const first = tabOf("Benzene");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight", ctrlKey: true, shiftKey: true });
    expect(actions.reorderDesigns).toHaveBeenCalledWith(["b", "a", "c", "d"]);
    actions.reorderDesigns.mockClear();
    const last = tabOf("Toluene");
    last.focus();
    fireEvent.keyDown(last, { key: "ArrowRight", ctrlKey: true, shiftKey: true });
    expect(actions.reorderDesigns).not.toHaveBeenCalled();
  });
});

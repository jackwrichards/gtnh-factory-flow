// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesignSummary } from "@/lib/designs/design-library";
import { stampOpened, resetLastOpenForTests } from "@/lib/library/last-open";
import { openLibrary, readLibraryTabState } from "@/lib/library/library-tab";
import { useDesignStore } from "@/store/design-store";

vi.mock("@/lib/compact-view", () => ({ isCompactViewport: () => false }));
const auth = vi.hoisted(() => ({ user: undefined as undefined | { username: string } }));
vi.mock("@/components/community/auth", () => ({
  useCommunityUser: () => ({ user: auth.user, isLoading: false, setUser: vi.fn(), signOut: vi.fn() }),
}));
vi.mock("@/components/library/SetupsGrid", () => ({
  SETUP_SORTS: [
    { value: "top", label: "Top voted" },
    { value: "active", label: "Recently active" },
  ],
  SetupsGrid: ({ onTotal }: { onTotal?: (n: number) => void }) => {
    onTotal?.(7);
    return <div data-testid="public-grid">grid</div>;
  },
}));

import { ModLibrary } from "./ModLibrary";

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
  switchToDesign: vi.fn(async () => true),
  addDesign: vi.fn(async () => undefined),
  removeDesign: vi.fn(async () => undefined),
  renameDesign: vi.fn(async () => undefined),
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetLastOpenForTests();
  auth.user = undefined;
  for (const fn of Object.values(actions)) fn.mockClear();
  useDesignStore.setState({
    designs: [
      design("a", "Benzene", { stats: { cards: 4, drawers: 3, machines: 1, tierIndex: 3 } }),
      design("b", "ref-chain", { stats: { cards: 10, drawers: 6, machines: 4, tierIndex: 4 } }),
      design("c", "Parked", { closed: true }),
    ],
    activeDesignId: "b",
    ...actions,
  });
  stampOpened("a", Date.parse("2026-10-14T10:00:00.000Z"));
  stampOpened("b", Date.parse("2026-10-14T10:30:00.000Z"));
  stampOpened("c", Date.parse("2026-10-14T09:00:00.000Z"));
  openLibrary({ kind: "all" });
});
afterEach(() => cleanup());

const tileNames = () => [...document.querySelectorAll(".ml-tile:not(.ml-new) .ml-name")].map((element) => element.textContent);

describe("the library", () => {
  it("has the mod's header: MY PLANS with its count, COMMUNITY, a Find a plan box and a close key, and no sign-in key (that is the top bar's account key)", () => {
    render(<ModLibrary />);
    const tabs = [...document.querySelectorAll(".ml-tab")].map((tab) => tab.textContent);
    expect(tabs).toEqual(["MY PLANS3", "COMMUNITY..."]);
    expect(document.querySelector(".ml-tab[data-on]")?.textContent).toContain("MY PLANS");
    expect(screen.getByPlaceholderText("Find a plan")).toBeTruthy();
    expect(document.querySelector(".ml-signin")).toBeNull();
    expect(screen.queryByText("Sign in")).toBeNull();
    expect(screen.getByLabelText("Close the panel")).toBeTruthy();
  });

  it("My plans lists every plan, the most recently open first, after the new-plan tile", () => {
    render(<ModLibrary />);
    expect(document.querySelector(".ml-grid")?.firstElementChild?.textContent).toBe("+ New plan");
    expect(tileNames()).toEqual(["ref-chain", "Benzene", "Parked"]);
  });

  it("a tile says its size, when it was last open, and whether it is showing, open or parked", () => {
    render(<ModLibrary />);
    const tiles = [...document.querySelectorAll(".ml-tile:not(.ml-new)")];
    expect(tiles[0].querySelector(".ml-size")?.textContent).toBe("4 cards · 6 drawers");
    expect(tiles[0].querySelector(".ml-chip")?.textContent).toBe("SHOWING");
    expect(tiles[0].hasAttribute("data-showing")).toBe(true);
    expect(tiles[0].querySelector(".ml-when")?.textContent).toMatch(/^last open /);
    expect(tiles[1].querySelector(".ml-chip")?.textContent).toBe("OPEN");
    expect(tiles[1].querySelector(".ml-size")?.textContent).toBe("1 card · 3 drawers");
    expect(tiles[2].querySelector(".ml-chip")).toBeNull();
  });

  it("the search narrows My plans by name", () => {
    render(<ModLibrary />);
    fireEvent.change(screen.getByPlaceholderText("Find a plan"), { target: { value: "benz" } });
    expect(tileNames()).toEqual(["Benzene"]);
  });

  it("a click opens the plan, + New plan starts one, and the close key goes back to the board", () => {
    render(<ModLibrary />);
    fireEvent.click(screen.getByText("Benzene"));
    expect(actions.switchToDesign).toHaveBeenCalledWith("a");
    fireEvent.click(screen.getByText("+ New plan"));
    expect(actions.addDesign).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Close the panel"));
    expect(readLibraryTabState().active).toBe(false);
  });

  it("right-click opens the tile's menu: Open, Rename, Copy plan code, Save to library, Delete plan", () => {
    render(<ModLibrary />);
    fireEvent.contextMenu(screen.getByText("Benzene"));
    const rows = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((element) => element.textContent);
    expect(rows).toEqual([
      "Open",
      "Rename",
      "Copy plan codeto paste or share",
      "Post a copy to Community...for other players",
      "Delete plan",
    ]);
    fireEvent.click(screen.getByText("Delete plan"));
    expect(document.querySelector(".mm-title")?.textContent).toBe("Delete 'Benzene' for good?");
    fireEvent.click(screen.getByText("Delete it"));
    expect(actions.removeDesign).toHaveBeenCalledWith("a");
  });

  it("COMMUNITY shows the public shelf with its sort and tier, and counts what it found", () => {
    render(<ModLibrary />);
    fireEvent.click(screen.getByText("COMMUNITY"));
    expect(screen.getByTestId("public-grid")).toBeTruthy();
    expect(screen.getByPlaceholderText("Search setups (#tag, @name)")).toBeTruthy();
    expect(document.querySelector(".ml-drop")?.textContent).toBe("Top voted");
    expect([...document.querySelectorAll(".ml-drop")].map((key) => key.textContent)).toEqual(["Top voted", "Any tier"]);
    expect([...document.querySelectorAll(".ml-tab")].at(-1)?.textContent).toBe("COMMUNITY7");
  });

  it("a signed-in player sees a line saying who they are, and nothing to press", () => {
    auth.user = { username: "arodoid" };
    render(<ModLibrary />);
    expect(document.querySelector("[data-signed-in-as]")?.textContent).toBe("Signed in as arodoid");
    expect(document.querySelector(".ml-account")).toBeNull();
  });
});

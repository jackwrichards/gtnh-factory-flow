// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createNewProject } from "@/examples";
import { useDesignStore } from "@/store/design-store";
import { useFactoryStore } from "@/store/factory-store";
import {
  enterSandbox,
  leaveSandbox,
  returnToDesign,
  tourDesignId,
  tourTaskBoardIds,
} from "./sandbox";

const initialDesigns = useDesignStore.getState();
const initialFactory = useFactoryStore.getState();
const summary = (id: string, taskBoard = false) => ({
  id,
  name: "Tour plan",
  createdAt: "now",
  updatedAt: "now",
  taskBoard,
});

afterEach(async () => {
  await leaveSandbox();
  useDesignStore.setState(initialDesigns, true);
  useFactoryStore.setState(initialFactory, true);
});

it("keeps checkpoint task boards during replay, removes later boards, and never removes the player's boards", async () => {
  const removed: string[] = [];
  useFactoryStore.setState({ project: createNewProject() });
  useDesignStore.setState({
    activeDesignId: "mine",
    designs: [summary("mine"), summary("my-board", true)],
    saveActiveProject: vi.fn(async () => undefined),
    importProjectAsDesign: vi.fn(async (project) => {
      useDesignStore.setState((state) => ({
        activeDesignId: "tour",
        designs: [...state.designs, summary("tour")],
      }));
      useFactoryStore.setState({ project });
    }),
    switchToDesign: vi.fn(async (id) => {
      useDesignStore.setState({ activeDesignId: id });
    }),
    removeDesign: vi.fn(async (id) => {
      removed.push(id);
      useDesignStore.setState((state) => ({
        designs: state.designs.filter((design) => design.id !== id),
      }));
    }),
  });
  await enterSandbox();
  expect(tourDesignId()).toBe("tour");
  useDesignStore.setState((state) => ({
    designs: [...state.designs, summary("earlier-board", true)],
  }));
  const checkpoint = useDesignStore.getState().designs.map((design) => design.id);
  useDesignStore.setState((state) => ({
    designs: [...state.designs, summary("later-board", true)],
  }));
  await returnToDesign("tour", checkpoint);
  expect(removed).toEqual(["later-board"]);
  expect(tourTaskBoardIds()).toEqual(["earlier-board"]);
  useDesignStore.setState((state) => ({
    designs: [...state.designs, summary("replayed-board", true)],
  }));
  await returnToDesign("earlier-board", checkpoint);
  expect(removed).toEqual(["later-board", "replayed-board"]);
  expect(tourTaskBoardIds()).toEqual(["earlier-board"]);
  await leaveSandbox();
  expect(tourDesignId()).toBeUndefined();
  expect(useDesignStore.getState().designs.map((design) => design.id)).toEqual([
    "mine",
    "my-board",
  ]);
});

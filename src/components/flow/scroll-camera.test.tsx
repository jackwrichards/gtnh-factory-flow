// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useRef } from "react";
import { ScrollCamera } from "./scroll-camera";

type CameraState = { transform: [number, number, number] };
const camera = vi.hoisted(() => {
  let state: CameraState = { transform: [0, 0, 1] };
  const listeners = new Set<(next: CameraState, previous: CameraState) => void>();
  return {
    getState: () => state,
    subscribe: (listener: (next: CameraState, previous: CameraState) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    move: (transform: CameraState["transform"]) => {
      const previous = state;
      state = { transform };
      listeners.forEach((listener) => listener(state, previous));
    },
  };
});
vi.mock("@xyflow/react", () => ({ useStoreApi: () => camera }));

function Board() {
  const boardRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={boardRef}>
      <div className="react-flow">
        <div className="react-flow__renderer">
          <div className="react-flow__pane" />
          <div className="react-flow__viewport" />
        </div>
      </div>
      <ScrollCamera boardRef={boardRef} />
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  camera.move([0, 0, 1]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("releases the scaled raster after zoom settles, even if the camera keeps panning", () => {
  const { container } = render(<Board />);
  const viewport = container.querySelector<HTMLElement>(".react-flow__viewport")!;
  expect(viewport.style.willChange).toBe("");
  act(() => camera.move([20, 30, 1.2]));
  expect(viewport.style.willChange).toBe("transform");
  act(() => vi.advanceTimersByTime(150));
  act(() => camera.move([40, 50, 1.4]));
  act(() => vi.advanceTimersByTime(150));
  expect(viewport.style.willChange).toBe("transform");
  act(() => camera.move([60, 70, 1.4]));
  act(() => vi.advanceTimersByTime(100));
  expect(viewport.style.willChange).toBe("");
  expect(viewport.style.getPropertyValue("--camera-zoom")).toBe("1.4");
  act(() => camera.move([80, 90, 1.4]));
  expect(viewport.style.willChange).toBe("");
});

it("cleans up a pending raster release when the board unmounts", () => {
  const { container, unmount } = render(<Board />);
  const viewport = container.querySelector<HTMLElement>(".react-flow__viewport")!;
  act(() => camera.move([0, 0, 2]));
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
  expect(viewport.style.willChange).toBe("");
});

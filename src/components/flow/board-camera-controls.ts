"use client";

import { useEffect } from "react";
import type { ReactFlowInstance } from "@xyflow/react";
import { isEditableKeyboardTarget } from "./keyboard";
import { readBoardMotionSnapshot } from "./board-motion";
import { BOARD_MAX_ZOOM, BOARD_MIN_ZOOM } from "./board-camera";

/**
 * The camera under the hand: eased wheel zoom, a slight glide after a pan,
 * and keys for moving without the mouse.
 *
 * WHEEL. The wheel no longer drives d3 directly (zoomOnScroll is off on the
 * board). Each notch moves a TARGET zoom and the camera eases toward it on a
 * short clock, anchored on the cursor, so a burst of notches reads as one
 * accelerating dive instead of a run of cuts. Wheels that belong to someone
 * else — a `nowheel` popup scrolling its own list, a slot stepping through
 * its alternatives — pass by untouched, exactly the set d3 used to skip.
 *
 * MOMENTUM. Velocity is measured from the VIEWPORT, not the pointer: while a
 * pane drag is down the camera's own movement is sampled, and on release it
 * carries on and dies over about a tenth of a second. Reading the viewport is
 * what keeps every non-pan drag honest for free — a band select, an
 * annotation stroke, a claimed edge swipe never move the camera, so they
 * measure zero and nothing glides.
 *
 * KEYS. WASD and the arrows pan (physical positions, the game convention);
 * PageUp/PageDown and +/- zoom on the board's centre. Held keys ease up to
 * cruise and released ones bleed off through the same glide the mouse gets,
 * so the keyboard and the hand speak one dialect. Keys never fire while
 * typing, never while an overlay (the welcome page, a dialog) is over the
 * board, and the arrows yield to a focused card — React Flow moves the card.
 *
 * All of it runs through instance.setViewport, the same door the touch
 * gestures use, so move reporting (design cameras, the viewport centre) sees
 * these moves like any other. With move motion off every easing collapses to
 * its target: the wheel snaps, keys stop dead, nothing glides — the board
 * holds still for whoever asked it to, image export included.
 */

/** Only the viewport half of the instance is used, so the node types are free. */
type ViewportInstance = Pick<ReactFlowInstance<never, never>, "getViewport" | "setViewport">;

interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** How long the zoom takes to close most of the gap to its target. */
const ZOOM_EASE_TAU_MS = 80;
/** How long a held pan key takes to reach cruise. */
const KEY_ACCEL_TAU_MS = 70;
/** How long released motion takes to bleed off — the "ever so slight" glide. */
const GLIDE_TAU_MS = 100;
/** Cruise speed of a held pan key, in screen px per ms. */
const KEY_CRUISE_PX_MS = 1.05;
/** Held zoom keys scale the target by e^(rate·seconds): a doubling in ~0.6s. */
const KEY_ZOOM_RATE_PER_MS = 0.0011;
/** A wheel notch in pixel mode scales the target by 2^(-deltaY·this). */
const WHEEL_ZOOM_SENSITIVITY = 0.002;
/** Trackpad pinches arrive as ctrl+wheel with small deltas; they need more. */
const PINCH_ZOOM_SENSITIVITY = 0.008;
/** Below this speed a glide is finished (px/ms). */
const GLIDE_STOP_PX_MS = 0.01;
/** A release slower than this starts no glide at all (px/ms). */
const GLIDE_START_PX_MS = 0.04;
/** A pointer that has not moved for this long was parked, not flung. */
const GLIDE_STALE_MS = 90;
/** Velocity needs at least this much history to mean anything. */
const GLIDE_MIN_SPAN_MS = 30;

const PAN_KEY_VECTORS: Record<string, readonly [number, number]> = {
  KeyW: [0, -1],
  KeyA: [-1, 0],
  KeyS: [0, 1],
  KeyD: [1, 0],
  ArrowUp: [0, -1],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowRight: [1, 0],
};

const ZOOM_IN_CODES = new Set(["PageUp", "Equal", "NumpadAdd"]);
const ZOOM_OUT_CODES = new Set(["PageDown", "Minus", "NumpadSubtract"]);

const clampZoom = (zoom: number) => Math.min(BOARD_MAX_ZOOM, Math.max(BOARD_MIN_ZOOM, zoom));

export function useBoardCameraControls({
  boardRef,
  instanceRef,
}: {
  boardRef: React.RefObject<HTMLDivElement | null>;
  instanceRef: React.RefObject<ViewportInstance | null>;
}) {
  useEffect(() => {
    const board = boardRef.current;
    if (!board) {
      return undefined;
    }

    /** Camera velocity in screen px/ms; +x is the camera moving right. */
    let velX = 0;
    let velY = 0;
    /** Where the zoom is headed, and the point it turns around. */
    let zoomTarget: number | undefined;
    let anchorX = 0;
    let anchorY = 0;
    /** Log-zoom velocity from held zoom keys, with its own glide tail. */
    let zoomVel = 0;
    const heldPan = new Set<string>();
    const heldZoom = new Set<string>();
    /** What the loop last wrote; a mismatch means someone else moved the camera. */
    let lastWritten: Viewport | undefined;
    let frame = 0;
    let lastFrameAt = 0;

    /** Viewport samples from the drag in flight, newest last. */
    let dragSamples: Array<{ t: number; x: number; y: number }> | undefined;

    const viewportNow = (): Viewport | undefined => instanceRef.current?.getViewport();

    const zoomKeyDir = () => {
      let dir = 0;
      for (const code of heldZoom) {
        dir += ZOOM_IN_CODES.has(code) ? 1 : -1;
      }
      return Math.sign(dir);
    };

    const anyMotionLeft = () =>
      heldPan.size > 0 ||
      heldZoom.size > 0 ||
      Math.hypot(velX, velY) > GLIDE_STOP_PX_MS ||
      Math.abs(zoomVel) > 0.00001 ||
      zoomTarget !== undefined;

    const stop = () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
      lastWritten = undefined;
    };

    const step = (now: number) => {
      frame = 0;
      const instance = instanceRef.current;
      const current = viewportNow();
      if (!instance || !current) {
        stop();
        return;
      }

      const dt = lastFrameAt === 0 ? 16 : Math.min(48, Math.max(1, now - lastFrameAt));
      lastFrameAt = now;

      // Someone else moved the camera between frames — a d3 drag underway, a
      // framing move, a tab switch. Their move wins; every velocity dies so
      // the loop cannot drag the board back toward where it used to be going.
      if (
        lastWritten &&
        (Math.abs(current.x - lastWritten.x) > 0.5 ||
          Math.abs(current.y - lastWritten.y) > 0.5 ||
          Math.abs(current.zoom - lastWritten.zoom) > 0.002)
      ) {
        velX = 0;
        velY = 0;
        zoomVel = 0;
        zoomTarget = undefined;
      }

      const motion = readBoardMotionSnapshot().moveMotion;

      // Held pan keys steer the velocity; nothing held lets it bleed off.
      let keyX = 0;
      let keyY = 0;
      for (const code of heldPan) {
        const vector = PAN_KEY_VECTORS[code];
        keyX += vector[0];
        keyY += vector[1];
      }
      const keyLength = Math.hypot(keyX, keyY);
      const targetVelX = keyLength > 0 ? (keyX / keyLength) * KEY_CRUISE_PX_MS : 0;
      const targetVelY = keyLength > 0 ? (keyY / keyLength) * KEY_CRUISE_PX_MS : 0;
      if (!motion) {
        velX = targetVelX;
        velY = targetVelY;
      } else if (heldPan.size > 0) {
        const approach = 1 - Math.exp(-dt / KEY_ACCEL_TAU_MS);
        velX += (targetVelX - velX) * approach;
        velY += (targetVelY - velY) * approach;
      } else {
        const decay = Math.exp(-dt / GLIDE_TAU_MS);
        velX *= decay;
        velY *= decay;
      }

      // Held zoom keys steer the target through the same accelerate-and-glide
      // shape the pan has, anchored on the board's centre.
      const zoomDir = zoomKeyDir();
      const targetZoomVel = zoomDir * KEY_ZOOM_RATE_PER_MS;
      if (!motion) {
        zoomVel = targetZoomVel;
      } else if (zoomDir !== 0) {
        zoomVel += (targetZoomVel - zoomVel) * (1 - Math.exp(-dt / KEY_ACCEL_TAU_MS));
      } else {
        zoomVel *= Math.exp(-dt / GLIDE_TAU_MS);
      }
      if (Math.abs(zoomVel) > 0.00001) {
        const rect = board.getBoundingClientRect();
        anchorX = rect.width / 2;
        anchorY = rect.height / 2;
        zoomTarget = clampZoom((zoomTarget ?? current.zoom) * Math.exp(zoomVel * dt));
      }

      // The camera itself: pan by velocity, then close on the zoom target
      // around the anchor.
      let nextX = current.x - velX * dt;
      let nextY = current.y - velY * dt;
      let nextZoom = current.zoom;
      if (zoomTarget !== undefined) {
        nextZoom = motion
          ? current.zoom + (zoomTarget - current.zoom) * (1 - Math.exp(-dt / ZOOM_EASE_TAU_MS))
          : zoomTarget;
        if (Math.abs(nextZoom - zoomTarget) < Math.max(0.0004, zoomTarget * 0.001)) {
          nextZoom = zoomTarget;
          if (zoomDir === 0 && Math.abs(zoomVel) <= 0.00001) {
            zoomTarget = undefined;
          }
        }
        const ratio = nextZoom / current.zoom;
        nextX = anchorX - (anchorX - nextX) * ratio;
        nextY = anchorY - (anchorY - nextY) * ratio;
      }

      if (nextX !== current.x || nextY !== current.y || nextZoom !== current.zoom) {
        lastWritten = { x: nextX, y: nextY, zoom: nextZoom };
        void instance.setViewport(lastWritten);
      }

      if (anyMotionLeft()) {
        frame = window.requestAnimationFrame(step);
      } else {
        stop();
      }
    };

    const run = () => {
      if (frame === 0) {
        lastFrameAt = 0;
        frame = window.requestAnimationFrame(step);
      }
    };

    /**
     * Whether the keys belong to this board right now: it has size and its
     * centre pixel is its own — not the welcome page's, not a dialog's.
     */
    const boardOwnsKeys = () => {
      const rect = board.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return false;
      }
      const centre = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      return centre !== null && board.contains(centre);
    };

    const handleWheel = (event: WheelEvent) => {
      const target = event.target as Element | null;
      // Only the canvas: the toolbars live beside the flow element, a
      // `nowheel` popup is scrolling its own list, and a marked slot is
      // stepping through its alternatives. Same skip set d3 honoured.
      if (!target?.closest?.(".react-flow")) {
        return;
      }
      if (target.closest(".nowheel, [data-tooltip-wheel-steps]")) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();

      const current = viewportNow();
      if (!current) {
        return;
      }
      const rect = board.getBoundingClientRect();
      anchorX = event.clientX - rect.left;
      anchorY = event.clientY - rect.top;
      const unit = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? 400 : 1;
      const sensitivity = event.ctrlKey ? PINCH_ZOOM_SENSITIVITY : WHEEL_ZOOM_SENSITIVITY;
      const factor = Math.pow(2, -event.deltaY * unit * sensitivity);
      zoomTarget = clampZoom((zoomTarget ?? current.zoom) * factor);
      run();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const pan = PAN_KEY_VECTORS[event.code];
      const zoom = ZOOM_IN_CODES.has(event.code) || ZOOM_OUT_CODES.has(event.code);
      if (!pan && !zoom) {
        return;
      }
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }
      // A focused card owns its arrows — React Flow nudges the card with them.
      if (
        pan &&
        event.code.startsWith("Arrow") &&
        (event.target as Element | null)?.closest?.(".react-flow__node")
      ) {
        return;
      }
      if (!boardOwnsKeys()) {
        return;
      }
      event.preventDefault();
      if (pan) {
        heldPan.add(event.code);
      } else {
        heldZoom.add(event.code);
      }
      run();
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      heldPan.delete(event.code);
      heldZoom.delete(event.code);
    };

    const releaseAllKeys = () => {
      heldPan.clear();
      heldZoom.clear();
    };

    const dropDragTracking = () => {
      dragSamples = undefined;
      window.removeEventListener("pointermove", handleDragMove);
      window.removeEventListener("pointerup", handleDragEnd);
      window.removeEventListener("pointercancel", handleDragCancel);
    };

    const handleDragMove = (event: PointerEvent) => {
      const current = viewportNow();
      if (!dragSamples || !current) {
        return;
      }
      dragSamples.push({ t: event.timeStamp, x: current.x, y: current.y });
      const horizon = event.timeStamp - 120;
      while (dragSamples.length > 8 || (dragSamples.length > 2 && dragSamples[0].t < horizon)) {
        dragSamples.shift();
      }
    };

    const handleDragEnd = (event: PointerEvent) => {
      const samples = dragSamples;
      dropDragTracking();
      if (!samples || samples.length < 2 || !readBoardMotionSnapshot().moveMotion) {
        return;
      }
      const newest = samples[samples.length - 1];
      const oldest = samples[0];
      const span = newest.t - oldest.t;
      // A parked pointer, or too little history to trust: no glide.
      if (span < GLIDE_MIN_SPAN_MS || event.timeStamp - newest.t > GLIDE_STALE_MS) {
        return;
      }
      // The camera's velocity is minus the viewport's — and a drag that never
      // moved the viewport (a band select, a claimed swipe) measures zero
      // here, which is exactly why the viewport is what gets sampled.
      const releaseVelX = -(newest.x - oldest.x) / span;
      const releaseVelY = -(newest.y - oldest.y) / span;
      if (Math.hypot(releaseVelX, releaseVelY) < GLIDE_START_PX_MS) {
        return;
      }
      velX = releaseVelX;
      velY = releaseVelY;
      run();
    };

    const handleDragCancel = () => {
      dropDragTracking();
    };

    const handlePointerDown = (event: PointerEvent) => {
      // A hand on the board stops any glide dead — and a second finger means
      // a pinch, whose release must not be read as a fling.
      if (heldPan.size === 0) {
        velX = 0;
        velY = 0;
      }
      if (dragSamples) {
        dropDragTracking();
        return;
      }
      if (event.button !== 0 && event.button !== 1) {
        return;
      }
      // Only drags that start on the pane pan the camera; node drags move
      // their card and get no glide.
      if (!(event.target as Element | null)?.closest?.(".react-flow__pane")) {
        return;
      }
      dragSamples = [];
      window.addEventListener("pointermove", handleDragMove);
      window.addEventListener("pointerup", handleDragEnd);
      window.addEventListener("pointercancel", handleDragCancel);
    };

    board.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    board.addEventListener("pointerdown", handlePointerDown, { capture: true });
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", releaseAllKeys);
    return () => {
      board.removeEventListener("wheel", handleWheel, { capture: true });
      board.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", releaseAllKeys);
      dropDragTracking();
      stop();
    };
  }, [boardRef, instanceRef]);
}

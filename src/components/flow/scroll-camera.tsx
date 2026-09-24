"use client";

import { NodeToolbar, useStore, useStoreApi, type NodeToolbarProps } from "@xyflow/react";
import { useEffect, type RefObject } from "react";

/**
 * THE CAMERA PANS BY SCROLLING, NOT BY TRANSFORM.
 *
 * React Flow moves the board by writing `translate(x, y) scale(z)` onto
 * `.react-flow__viewport` every frame. Chrome keeps the board's raster in GPU
 * tiles and just moves them, but Firefox re-rasterizes everything under a
 * changing transform - cards, text, shadows, wires - on every frame, at
 * screen resolution. Measured 2026-09-07 on a 42-card plan at 4K: 71 fps
 * panning by transform, 165 fps (the display cap, 7 ms worst frame) when
 * the SAME motion is carried by a scroll offset, because scrolled content is
 * what every engine caches best. Chrome is at the cap either way.
 *
 * So the viewport is PINNED: CSS (scroll-camera.css, `!important` so it wins
 * over the inline transform React Flow keeps writing) fixes it at
 * `translate(OFFSET, OFFSET) scale(var(--camera-zoom))`, the `.react-flow`
 * wrapper is the scroll container (the pane inside it is sized to
 * `2 * OFFSET` square; not the renderer, whose offset size React Flow reads
 * as the board's width and height), and this component mirrors the store's camera into
 * the wrapper's `scrollLeft/Top = OFFSET - x/y` and `--camera-zoom = z` on
 * every transform change. The store, every gesture, `screenToFlowPosition`,
 * fit, drag and hit testing are untouched: they read the store and the
 * wrapper's rect, and the screen result is identical.
 *
 * The wrapper is overflow: hidden (React Flow's own style), so the user can
 * never scroll it: no wheel, no keyboard, no middle-click autoscroll, no bar.
 * React Flow guards that box against accidental scrolls (a `focus()` or a
 * `scrollIntoView()` inside it) with an onScroll handler that calls
 * `scrollTo(0, 0)` on it; that handler is neutralised here by shadowing
 * `scrollTo` on the element with a no-op for as long as the camera runs, and
 * the same accidents are put back by this component's own scroll listener.
 *
 * Two things read the viewport's DOM transform and are corrected for the
 * scroll: `getViewportTransform` in FactoryFlow.tsx and the PerfHud's centre
 * line. React Flow's NodeToolbar is a third: use CameraNodeToolbar below.
 * Image export is unaffected: html-to-image clones the viewport and is
 * handed its own transform. The board patterns (board-pattern.tsx) live in
 * flow space inside the viewport, so they ride the scroll for free.
 */

/** Where the viewport is pinned inside the scroll area. Half the area. */
export const SCROLL_CAMERA_OFFSET = 500_000;

/**
 * The board ATTRIBUTE the CSS hangs off. An attribute, not a class: React
 * owns the board's className and rebuilds the whole string on every render,
 * so a class added here was wiped the first time the board re-rendered (a
 * mode switch did it), the pin CSS fell away and the camera came apart.
 * React never touches an attribute it was not given.
 */
export const SCROLL_CAMERA_ATTRIBUTE = "data-scroll-camera";

export const CAMERA_ZOOM_VAR = "--camera-zoom";

/** Whether a scroll camera is running (the board mounts one, always). */
let scrollCameraActive = false;

export function ScrollCamera({ boardRef }: { boardRef: RefObject<HTMLElement | null> }) {
  const store = useStoreApi();

  useEffect(() => {
    const board = boardRef.current;
    const wrapper = board?.querySelector<HTMLElement>(".react-flow");
    const renderer = wrapper?.querySelector<HTMLElement>(".react-flow__renderer");
    const viewport = wrapper?.querySelector<HTMLElement>(".react-flow__viewport");
    const pane = wrapper?.querySelector<HTMLElement>(".react-flow__pane");
    if (!board || !wrapper || !renderer || !viewport || !pane) {
      return;
    }

    // THE RENDERER REPORTS THE WRAPPER'S RECT. d3-zoom measures the pointer
    // against the element its listeners sit on, the renderer, and React Flow
    // assumes that box IS the wrapper's (the renderer normally fills it at
    // 0,0: every other conversion uses the wrapper's rect and the store).
    // Scrolled by the wrapper, the renderer's real box moves with every
    // camera step, so a drag pan read its own motion back as pointer travel
    // and oscillated between the two positions. Handing d3 the wrapper's
    // rect restores the assumption; nothing else reads the renderer's box
    // (getViewportTransform in FactoryFlow.tsx reads it through this too).
    const rendererRect = () => wrapper.getBoundingClientRect();
    Object.defineProperty(renderer, "getBoundingClientRect", {
      configurable: true,
      writable: true,
      value: rendererRect,
    });

    // A middle-button press on a scrollable box starts the browser's own
    // autoscroll, which would fight the camera for the offset. The press
    // itself still reaches React Flow (pan) and the app; only the default
    // action is dropped.
    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 1) {
        event.preventDefault();
      }
    };
    wrapper.addEventListener("mousedown", onMouseDown, { capture: true });

    // NO CUSTOM PROPERTY IS WRITTEN PER FRAME. One written on the board, or on
    // the pane (which WRAPS the viewport in React Flow's tree), made Chrome
    // recalculate style for every element under it on every frame - 4,245
    // elements, 700 ms of recalc a second, a 165 fps pan cut to 42 (traced
    // 2026-09-07). The zoom is written on the viewport itself and only when
    // it changes; the marquee's shift is written on the marquee element
    // directly, and only while one exists.
    let expectedLeft = 0;
    let expectedTop = 0;
    let writtenZoom: number | undefined;
    const apply = (transform: readonly [number, number, number]) => {
      expectedLeft = SCROLL_CAMERA_OFFSET - transform[0];
      expectedTop = SCROLL_CAMERA_OFFSET - transform[1];
      // Zoom first: a wheel zoom changes x, y and z together, and the scroll
      // offsets below are only right against the new scale.
      if (transform[2] !== writtenZoom) {
        writtenZoom = transform[2];
        viewport.style.setProperty(CAMERA_ZOOM_VAR, String(transform[2]));
      }
      wrapper.scrollLeft = expectedLeft;
      wrapper.scrollTop = expectedTop;
      placeMarquee();
    };

    // The marquee rectangle is drawn inside the scrolled pane at container
    // coordinates; shifting it by the scroll offset puts it back under the
    // pointer. It exists only during a shift-drag, so the lookup is usually
    // null; the observer below stamps it the moment it appears, since a
    // marquee drawn while the camera stands still sees no transform change.
    const placeMarquee = () => {
      const marquee = pane.querySelector<HTMLElement>(":scope > .react-flow__selection");
      if (marquee) {
        marquee.style.translate = `${expectedLeft}px ${expectedTop}px`;
      }
    };
    const marqueeObserver = new MutationObserver(placeMarquee);
    marqueeObserver.observe(pane, { childList: true });

    // Something else scrolled the wrapper (a focus, a scrollIntoView): the
    // camera did not move, so the offset goes straight back.
    const onScroll = () => {
      if (wrapper.scrollLeft !== expectedLeft || wrapper.scrollTop !== expectedTop) {
        wrapper.scrollLeft = expectedLeft;
        wrapper.scrollTop = expectedTop;
      }
    };
    wrapper.addEventListener("scroll", onScroll, { passive: true });

    // React Flow's wrapperOnScroll calls scrollTo(0, 0) on every scroll event
    // to undo accidental scrolls of its hidden-overflow box. Here every scroll
    // is deliberate, so the call is swallowed for the camera's lifetime.
    const scrollToShadow = () => {};
    Object.defineProperty(wrapper, "scrollTo", {
      configurable: true,
      writable: true,
      value: scrollToShadow,
    });

    board.setAttribute(SCROLL_CAMERA_ATTRIBUTE, "");
    scrollCameraActive = true;
    apply(store.getState().transform);
    const unsubscribe = store.subscribe((state, previous) => {
      if (state.transform !== previous.transform) {
        apply(state.transform);
      }
    });

    return () => {
      unsubscribe();
      marqueeObserver.disconnect();
      wrapper.removeEventListener("scroll", onScroll);
      wrapper.removeEventListener("mousedown", onMouseDown, { capture: true });
      if ((renderer as { getBoundingClientRect?: unknown }).getBoundingClientRect === rendererRect) {
        delete (renderer as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      }
      if ((wrapper as { scrollTo?: unknown }).scrollTo === scrollToShadow) {
        delete (wrapper as { scrollTo?: unknown }).scrollTo;
      }
      board.removeAttribute(SCROLL_CAMERA_ATTRIBUTE);
      scrollCameraActive = false;
      viewport.style.removeProperty(CAMERA_ZOOM_VAR);
      wrapper.scrollLeft = 0;
      wrapper.scrollTop = 0;
    };
  }, [boardRef, store]);

  return null;
}

/**
 * React Flow's NodeToolbar, put back where it belongs under the scroll camera.
 *
 * The library portals a toolbar into the RENDERER and places it at the
 * node's screen position from the store's pan. The renderer sits inside the
 * scrolled wrapper, so the scroll moved it by the pan a second time: every
 * toolbar stood about 500,000px off screen, and a board's paper button and
 * an annotation's style panel opened nothing you could see (Jack,
 * 2026-09-23: "the paper button doesn't work at all"). Shifted back by the
 * scroll offset, the correction the marquee gets; `translate` composes with
 * the transform the library writes, so its own placement stands.
 *
 * Mounted only while visible, so a hidden toolbar costs nothing per camera
 * frame.
 */
export function CameraNodeToolbar({
  isVisible,
  ...props
}: NodeToolbarProps & { isVisible: boolean }) {
  return isVisible ? <ShiftedNodeToolbar {...props} /> : null;
}

function ShiftedNodeToolbar({ style, ...props }: NodeToolbarProps) {
  const x = useStore((state) => state.transform[0]);
  const y = useStore((state) => state.transform[1]);
  const translate = scrollCameraActive
    ? `${SCROLL_CAMERA_OFFSET - x}px ${SCROLL_CAMERA_OFFSET - y}px`
    : undefined;
  return <NodeToolbar {...props} isVisible style={{ ...style, translate }} />;
}

"use client";

import { useStore } from "@xyflow/react";
import { useId } from "react";
import { BOARD_GRID } from "@/lib/board-grid";
import type { CanvasGrainLayer } from "./canvas-themes";

/**
 * The two paper rulings the stock React Flow Background cannot draw: ruled
 * lines (horizontal only, like a notepad) and a graph grid (a fine grid with
 * a heavier line every five cells). Built exactly the way the stock
 * Background is - an SVG pattern offset and scaled by the viewport transform -
 * so the ruling is inked ON the board: it pans and zooms with the factory,
 * and line widths stay one screen pixel at every zoom, the same trick the
 * stock line variant uses.
 */
export function RuledBackground({
  mode,
  color,
}: {
  mode: "ruled" | "graph";
  color: string;
}) {
  const [translateX, translateY, zoom] = useStore((state) => state.transform);
  const patternId = useId();

  // A notepad rules every 2 cells; graph paper repeats its heavy line every
  // 5, with a fine line on each cell inside.
  const gap = (mode === "ruled" ? 2 : 5) * BOARD_GRID * zoom;
  const cell = BOARD_GRID * zoom;

  return (
    // NOT the stock react-flow__background class: that class carries the
    // library's own dark background-color, the very layer the themed board
    // has to show through. Bare absolute positioning is all it needed.
    // board-ruling is the glance fade's handle: zoomed out the ruling sinks
    // away with the rest of the near view (globals.css, the LOD rules).
    <svg
      className="board-ruling"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      aria-hidden
    >
      <pattern
        id={patternId}
        x={translateX % gap}
        y={translateY % gap}
        width={gap}
        height={gap}
        patternUnits="userSpaceOnUse"
      >
        {mode === "graph" ? (
          <>
            {[1, 2, 3, 4].map((step) => (
              <g key={step}>
                <line
                  x1={step * cell}
                  y1={0}
                  x2={step * cell}
                  y2={gap}
                  stroke={color}
                  strokeOpacity={0.4}
                  strokeWidth={1}
                />
                <line
                  x1={0}
                  y1={step * cell}
                  x2={gap}
                  y2={step * cell}
                  stroke={color}
                  strokeOpacity={0.4}
                  strokeWidth={1}
                />
              </g>
            ))}
            <line x1={0.5} y1={0} x2={0.5} y2={gap} stroke={color} strokeWidth={1.5} />
            <line x1={0} y1={0.5} x2={gap} y2={0.5} stroke={color} strokeWidth={1.5} />
          </>
        ) : (
          <line x1={0} y1={0.5} x2={gap} y2={0.5} stroke={color} strokeWidth={1} />
        )}
      </pattern>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
}

/**
 * The paper's tooth, inked ON the board: each grain layer is a tileable
 * noise image drawn as an SVG pattern that the viewport transform offsets
 * and scales, exactly the way the rulings above (and the stock dots) are
 * drawn. Pan and the grain slides with the factory; zoom and it grows like
 * paper under a loupe. The old version was a static CSS layer on the board
 * div, which sat still while everything else moved — a dirty monitor, not
 * a textured paper.
 *
 * Zoomed far out the tile shrinks toward per-pixel fizz, so the whole layer
 * fades below 0.5 zoom and is gone by 0.2 — tooth is a close-up reading.
 */
export function GrainBackground({ layers }: { layers: CanvasGrainLayer[] }) {
  const [translateX, translateY, zoom] = useStore((state) => state.transform);
  const baseId = useId();
  const fade = Math.max(0, Math.min(1, (zoom - 0.2) / 0.3));
  if (fade <= 0) {
    return null;
  }

  return (
    // Same bare positioning as RuledBackground, and mounted BEFORE the
    // pattern component so the dots stay inked over the paper, not under it.
    <svg
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      aria-hidden
    >
      <defs>
        {layers.map((layer, index) => {
          const tile = layer.size * zoom;
          return (
            <pattern
              key={index}
              id={`${baseId}-${index}`}
              x={translateX % tile}
              y={translateY % tile}
              width={tile}
              height={tile}
              patternUnits="userSpaceOnUse"
            >
              <image href={layer.uri} width={tile} height={tile} preserveAspectRatio="none" />
            </pattern>
          );
        })}
      </defs>
      {layers.map((layer, index) => (
        <rect
          key={index}
          width="100%"
          height="100%"
          fill={`url(#${baseId}-${index})`}
          opacity={fade * (layer.opacity ?? 1)}
        />
      ))}
    </svg>
  );
}

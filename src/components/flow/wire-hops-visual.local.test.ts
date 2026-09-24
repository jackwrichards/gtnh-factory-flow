// Local visual probe for wire hops: writes an HTML sheet of crossings, the old
// run-by-run hop beside the new whole-wire hop. OUT=<file.html>.
import { writeFileSync } from "node:fs";
import { test } from "vitest";

import { edgeCasingWidth } from "./edge-geometry";
import { buildHoppedPath, hopRadiusFor, type HopCrossedSegment } from "./wire-hops";

type P = { x: number; y: number };

function oldHoppedPath(points: P[], otherSegments: HopCrossedSegment[], ownWidth: number) {
  const first = points[0]!;
  let path = `M ${first.x},${first.y}`;
  const OVERSHOOT = 4;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length < 2) {
      path += ` L ${to.x},${to.y}`;
      continue;
    }
    const ux = (to.x - from.x) / length;
    const uy = (to.y - from.y) / length;
    const crossings: Array<{ at: number; radius: number }> = [];
    for (const segment of otherSegments) {
      const vx = segment.end.x - segment.start.x;
      const vy = segment.end.y - segment.start.y;
      const otherLength = Math.hypot(vx, vy);
      if (otherLength < 1) continue;
      const denominator = ux * vy - uy * vx;
      if (Math.abs(denominator) < 1e-6) continue;
      const wx = segment.start.x - from.x;
      const wy = segment.start.y - from.y;
      const t = (wx * vy - wy * vx) / denominator;
      const s = ((wx * uy - wy * ux) / denominator) * otherLength;
      if (t > 1 && t < length - 1 && s > OVERSHOOT && s < otherLength - OVERSHOOT) {
        crossings.push({ at: t, radius: hopRadiusFor(ownWidth, segment.width) });
      }
    }
    if (crossings.length === 0) {
      path += ` L ${to.x},${to.y}`;
      continue;
    }
    crossings.sort((left, right) => left.at - right.at);
    const merged: Array<{ at: number; radius: number }> = [];
    for (const crossing of crossings) {
      const previous = merged[merged.length - 1];
      if (!previous || crossing.at - previous.at > previous.radius + crossing.radius + 2) {
        merged.push(crossing);
      }
    }
    let nx = -uy;
    let ny = ux;
    if (ny > 1e-6 || (Math.abs(ny) <= 1e-6 && nx < 0)) {
      nx = -nx;
      ny = -ny;
    }
    const sweep = ux * ny - uy * nx < 0 ? 1 : 0;
    for (const crossing of merged) {
      const bumpLow = Math.max(0.5, crossing.at - crossing.radius);
      const bumpHigh = Math.min(length - 0.5, crossing.at + crossing.radius);
      const chord = bumpHigh - bumpLow;
      if (chord < 4) continue;
      const radius = Math.max(crossing.radius, chord / 2 + 0.1);
      const ax = from.x + ux * bumpLow;
      const ay = from.y + uy * bumpLow;
      const bx = from.x + ux * bumpHigh;
      const by = from.y + uy * bumpHigh;
      path += ` L ${ax},${ay} A ${radius} ${radius} 0 0 ${sweep} ${bx},${by}`;
    }
    path += ` L ${to.x},${to.y}`;
  }
  return path;
}

type Wire = { points: P[]; width: number; color: string };
type Scene = { name: string; behind: Wire[]; front: Wire; cx?: number };

const TEAL = "#5fd0bd";
const BLUE = "#4458e6";
const teal = (y: number, width = 16): Wire => ({
  points: [{ x: 0, y }, { x: 300, y }],
  width,
  color: TEAL,
});

const scenes: Scene[] = [
  {
    name: "Jack's: bend 8px below, diagonal crosses",
    behind: [teal(100)],
    front: { points: [{ x: 100, y: 200 }, { x: 100, y: 108 }, { x: 192, y: 16 }], width: 5, color: BLUE },
  },
  {
    name: "bend exactly on the line",
    behind: [teal(100)],
    front: { points: [{ x: 100, y: 200 }, { x: 100, y: 100 }, { x: 200, y: 0 }], width: 5, color: BLUE },
  },
  {
    name: "bend 8px above, vertical crosses",
    behind: [teal(100)],
    front: { points: [{ x: 100, y: 200 }, { x: 100, y: 92 }, { x: 192, y: 0 }], width: 5, color: BLUE },
  },
  {
    name: "mirrored, diagonal up-left",
    behind: [teal(100)],
    front: { points: [{ x: 200, y: 200 }, { x: 200, y: 108 }, { x: 108, y: 16 }], width: 5, color: BLUE },
  },
  {
    name: "heading down, turning down-right",
    behind: [teal(100)],
    front: { points: [{ x: 100, y: 0 }, { x: 100, y: 92 }, { x: 200, y: 192 }], width: 5, color: BLUE },
  },
  {
    name: "straight square crossing",
    behind: [teal(100)],
    front: { points: [{ x: 150, y: 200 }, { x: 150, y: 0 }], width: 5, color: BLUE },
  },
  {
    name: "straight diagonal crossing",
    behind: [teal(100)],
    front: { points: [{ x: 50, y: 200 }, { x: 250, y: 0 }], width: 5, color: BLUE },
  },
  {
    name: "ribbon of two",
    behind: [teal(94, 8), teal(106, 8)],
    front: { points: [{ x: 150, y: 200 }, { x: 150, y: 0 }], width: 5, color: BLUE },
  },
  {
    name: "thin wires, bend near",
    behind: [teal(100, 4)],
    front: { points: [{ x: 100, y: 200 }, { x: 100, y: 104 }, { x: 196, y: 8 }], width: 4, color: BLUE },
  },
  {
    name: "oil berry: bend on one, diagonal over the next",
    behind: [teal(110, 6), teal(90, 7), { points: [{ x: 0, y: 50 }, { x: 100, y: 50 }, { x: 100, y: 30 }], width: 5, color: TEAL }],
    front: { points: [{ x: 100, y: 310 }, { x: 100, y: 110 }, { x: 180, y: 30 }], width: 5, color: BLUE },
    cx: 110,
  },
  {
    name: "fat over fat, 90 bend diag-diag",
    behind: [teal(100, 12)],
    front: { points: [{ x: 60, y: 200 }, { x: 160, y: 100 }, { x: 60, y: 0 }], width: 8, color: BLUE },
  },
];

function crossingX(scene: Scene) {
  const pts = scene.front.points;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if ((a.y - 100) * (b.y - 100) <= 0 && a.y !== b.y) return a.x + ((100 - a.y) / (b.y - a.y)) * (b.x - a.x);
  }
  return 150;
}

function plain(points: P[]) {
  return points.map((p, i) => `${i ? "L" : "M"} ${p.x},${p.y}`).join(" ");
}

function stroke(d: string, width: number, color: string) {
  return (
    `<path d="${d}" fill="none" stroke="#111827" stroke-opacity="0.72" stroke-width="${edgeCasingWidth(width)}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

function svg(scene: Scene, mode: "old" | "new") {
  const crossed: HopCrossedSegment[] = scene.behind.flatMap((wire) =>
    wire.points.slice(1).map((end, i) => ({ start: wire.points[i]!, end, width: wire.width })),
  );
  const front =
    mode === "old"
      ? oldHoppedPath(scene.front.points, crossed, scene.front.width)
      : buildHoppedPath(scene.front.points, crossed, scene.front.width).path;
  const body =
    scene.behind.map((wire) => stroke(plain(wire.points), wire.width, wire.color)).join("") +
    stroke(front, scene.front.width, scene.front.color);
  const cx = scene.cx ?? crossingX(scene);
  return `<svg width="360" height="270" viewBox="${cx - 60} 55 120 90" style="background:#1b1b1b">${body}</svg>`;
}

test("visual sheet", () => {
  const rows = scenes
    .map(
      (scene) =>
        `<div class="row"><div class="name">${scene.name}</div>${svg(scene, "old")}${svg(scene, "new")}</div>`,
    )
    .join("");
  const html = `<html><body style="background:#111;color:#ddd;font:13px sans-serif;margin:8px">
<style>.row{display:flex;gap:12px;align-items:center;margin-bottom:8px}.name{width:120px}</style>
<div class="row"><div class="name"></div><div style="width:360px">OLD</div><div style="width:360px">NEW</div></div>
${rows}</body></html>`;
  writeFileSync(process.env.OUT ?? "wire-hops-visual.local.html", html);
});

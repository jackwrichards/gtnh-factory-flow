import { describe, expect, it } from "vitest";

import { buildHoppedPath, hopRadiusFor, type HopCrossedSegment, type HopPoint } from "./wire-hops";

/** A horizontal wire at `y`, drawn behind, 16px thick unless said. */
function across(y: number, width = 16): HopCrossedSegment {
  return { start: { x: 0, y }, end: { x: 300, y }, width };
}

/** Every bump in a path: its feet, radii, and the top of the bump. */
function bumps(path: string) {
  const found: Array<{ foot: HopPoint; landing: HopPoint; rx: number; ry: number; apex: HopPoint }> =
    [];
  const pattern = /L ([-\d.e]+),([-\d.e]+) A ([-\d.e]+) ([-\d.e]+) [-\d.e]+ 0 ([01]) ([-\d.e]+),([-\d.e]+)/g;
  for (const match of path.matchAll(pattern)) {
    const [foot, landing] = [
      { x: Number(match[1]), y: Number(match[2]) },
      { x: Number(match[6]), y: Number(match[7]) },
    ];
    const rx = Number(match[3]);
    const ry = Number(match[4]);
    const chord = Math.hypot(landing.x - foot.x, landing.y - foot.y);
    const ux = (landing.x - foot.x) / chord;
    const uy = (landing.y - foot.y) / chord;
    // Sweep 1 runs clockwise on screen, which puts the top of a half-ellipse
    // on the (uy, -ux) side of the chord; sweep 0 on the other.
    const side = match[5] === "1" ? 1 : -1;
    const centre = { x: (foot.x + landing.x) / 2, y: (foot.y + landing.y) / 2 };
    found.push({
      foot,
      landing,
      rx,
      ry,
      apex: { x: centre.x + side * uy * ry, y: centre.y - side * ux * ry },
    });
  }
  return found;
}

describe("wire hops", () => {
  it("draws a wire that crosses nothing as it is", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 40 },
    ];
    const { path, spans } = buildHoppedPath(points, [across(200)], 5);
    expect(path).toBe("M 0,0 L 50,0 L 50,40");
    expect(spans).toEqual([]);
  });

  it("lifts a square crossing in a half-circle centred on it", () => {
    const radius = hopRadiusFor(5, 16);
    const { path, spans } = buildHoppedPath(
      [
        { x: 150, y: 200 },
        { x: 150, y: 0 },
      ],
      [across(100)],
      5,
    );
    const [bump] = bumps(path);
    expect(bump).toBeDefined();
    expect(bump!.foot.y).toBeCloseTo(100 + radius);
    expect(bump!.landing.y).toBeCloseTo(100 - radius);
    expect(bump!.rx).toBeCloseTo(radius);
    expect(bump!.ry).toBeCloseTo(radius);
    // A vertical run bumps to its right.
    expect(bump!.apex.x).toBeCloseTo(150 + radius);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.from).toBeCloseTo(100 - radius);
    expect(spans[0]!.to).toBeCloseTo(100 + radius);
  });

  it("carries a hop round a bend next to the crossing (Jack's broken hop, 2026-09-23)", () => {
    // Up, then bending up-right 8px short of the crossed wire: the crossing
    // is on the diagonal, within a bump's reach of the corner.
    const radius = hopRadiusFor(5, 16);
    const { path, spans } = buildHoppedPath(
      [
        { x: 100, y: 200 },
        { x: 100, y: 108 },
        { x: 192, y: 16 },
      ],
      [across(100)],
      5,
    );
    const found = bumps(path);
    expect(found).toHaveLength(1);
    const [bump] = found;
    // One foot on each run, both clear of the crossed wire.
    expect(bump!.foot.x).toBeCloseTo(100);
    expect(bump!.foot.y).toBeCloseTo(100 + radius);
    expect(bump!.landing.y).toBeCloseTo(100 - radius);
    // The landing is on the diagonal.
    expect(bump!.landing.x - 100).toBeCloseTo(108 - bump!.landing.y);
    // The bend is inside the bump, not left behind as a kink after it.
    expect(spans[0]!.from).toBeLessThan(92);
    expect(spans[0]!.to).toBeGreaterThan(92);
    // It bulges round the outside of the corner: the top of the bump is on
    // the bend's side of the chord, and clear of the crossed wire.
    const sideOf = (point: HopPoint) =>
      (bump!.landing.x - bump!.foot.x) * (point.y - bump!.foot.y) -
      (bump!.landing.y - bump!.foot.y) * (point.x - bump!.foot.x);
    expect(Math.sign(sideOf(bump!.apex))).toBe(Math.sign(sideOf({ x: 100, y: 108 })));
    expect(bump!.apex.y).toBeLessThan(100);
  });

  it("hops a bend that sits exactly on the crossed wire", () => {
    const { path } = buildHoppedPath(
      [
        { x: 100, y: 200 },
        { x: 100, y: 100 },
        { x: 200, y: 0 },
      ],
      [across(100)],
      5,
    );
    expect(bumps(path)).toHaveLength(1);
  });

  it("keeps a 45° hop's feet as far off the crossed wire as a square one's", () => {
    const radius = hopRadiusFor(5, 16);
    const [bump] = bumps(
      buildHoppedPath(
        [
          { x: 50, y: 200 },
          { x: 250, y: 0 },
        ],
        [across(100)],
        5,
      ).path,
    );
    expect(bump!.foot.y).toBeCloseTo(100 + radius);
    expect(bump!.landing.y).toBeCloseTo(100 - radius);
    expect(bump!.ry).toBeCloseTo(radius);
  });

  it("clears a ribbon of wires in one bump", () => {
    const { path, spans } = buildHoppedPath(
      [
        { x: 150, y: 200 },
        { x: 150, y: 0 },
      ],
      [across(94, 8), across(106, 8)],
      5,
    );
    expect(bumps(path)).toHaveLength(1);
    const radius = hopRadiusFor(5, 8);
    expect(spans[0]!.from).toBeCloseTo(94 - radius);
    expect(spans[0]!.to).toBeCloseTo(106 + radius);
  });

  it("runs bumps a few pixels apart into one (oil berry board, 2026-09-23)", () => {
    // Bends on one wire, crosses the next one a cell up on its diagonal: two
    // bumps 3.5px apart read as a wiggle.
    const { path } = buildHoppedPath(
      [
        { x: 780, y: -2000 },
        { x: 780, y: -2400 },
        { x: 860, y: -2480 },
      ],
      [
        { start: { x: 880, y: -2400 }, end: { x: 680, y: -2400 }, width: 6 },
        { start: { x: 680, y: -2420 }, end: { x: 880, y: -2420 }, width: 7 },
      ],
      5,
    );
    expect(bumps(path)).toHaveLength(1);
  });

  it("does not hop a wire that only touches the line", () => {
    // Ends on the line (a dock), and turns back off it on the side it came.
    const ending = buildHoppedPath(
      [
        { x: 100, y: 200 },
        { x: 100, y: 100 },
      ],
      [across(100)],
      5,
    );
    const touching = buildHoppedPath(
      [
        { x: 60, y: 200 },
        { x: 100, y: 100 },
        { x: 140, y: 200 },
      ],
      [across(100)],
      5,
    );
    expect(ending.spans).toEqual([]);
    expect(touching.spans).toEqual([]);
  });

  it("does not hop a line that stops short of overshooting the wire", () => {
    const { spans } = buildHoppedPath(
      [
        { x: 150, y: 200 },
        { x: 150, y: 0 },
      ],
      [{ start: { x: 0, y: 100 }, end: { x: 152, y: 100 }, width: 16 }],
      5,
    );
    expect(spans).toEqual([]);
  });
});

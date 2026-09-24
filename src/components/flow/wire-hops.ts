/**
 * Hops: where a wire crosses one drawn behind it, it lifts over in a bump -
 * the schematic jumper that makes a crossing read as "these do not meet"
 * instead of a flat X.
 *
 * Pure geometry, split out of FactoryFlow so it can be tested without a
 * board. Which wires a line hops over (the ones behind it, see
 * compareEdgeDepth) is decided there; this only draws the bumps.
 *
 * A hop is measured ALONG THE WHOLE WIRE, not along one straight run. It
 * used to be built run by run, so a crossing within a bump's reach of a
 * bend - common, since the router bends wherever it likes - was squeezed
 * onto the run it happened to fall on: the bump started at the corner and
 * met the next run at a right-angle kink, and a bend sitting exactly on the
 * other wire got no hop at all (Jack, 2026-09-23: "this is looking broken").
 * Now a hop starts where the wire first comes within clearance of the line it
 * crosses and ends where it is clear again, whichever runs those points are
 * on, and the bump is drawn across the chord between them.
 */

export interface HopPoint {
  x: number;
  y: number;
}

/** A stretch of a wire drawn behind this one, and how thick it is drawn. */
export interface HopCrossedSegment {
  start: HopPoint;
  end: HopPoint;
  width: number;
}

/** Where a bump replaces the wire, as arc lengths along the given points. */
export interface HopSpan {
  from: number;
  to: number;
}

/** Air between the two strokes at the top of a hop. Snug, not floating. */
export const EDGE_HOP_GAP = 3;
/** Nothing sensible needs a bump taller than this, whatever the widths say. */
export const EDGE_HOP_MAX_RADIUS = 44;

/**
 * How far a line must lift to clear the one it crosses: half of each stroke,
 * plus a little air. Two 3px wires give ~6px; two 16px pipes give 19px.
 * It is both the bump's height and the clearance a hop's two feet keep from
 * the crossed line.
 */
export function hopRadiusFor(ownWidth: number, otherWidth: number): number {
  return Math.min(ownWidth / 2 + otherWidth / 2 + EDGE_HOP_GAP, EDGE_HOP_MAX_RADIUS);
}

/**
 * The crossed line must properly OVERSHOOT the wire on both sides: a segment
 * that merely ends a pixel or two past it (T-junctions at docks, lane-adjacent
 * turns) reads as a touch, not a crossing, and a hump there sits over nothing.
 */
const OVERSHOOT = 4;
/** A vertex this close to the crossed line is on it. */
const ON_LINE = 0.01;
/** A bump over a shorter chord than this is not worth drawing. */
const MIN_CHORD = 4;

interface Window {
  from: number;
  to: number;
  height: number;
}

/**
 * The wire as an SVG path with a bump over every crossing, and the spans the
 * bumps took (so arrows can keep off them).
 *
 * A bump on one straight run is a half-circle when the wire crosses square on
 * and a flatter half-ellipse when it crosses at 45°, always rising the hop
 * radius off the wire, toward the upper side of the run (the right-hand side
 * of a vertical one) so the same crossing always reads the same way. A bump
 * that spans a bend bulges round the OUTSIDE of the corner it replaces:
 * bulging inward folded the wire back on itself into a knot.
 */
export function buildHoppedPath(
  points: ReadonlyArray<HopPoint>,
  crossed: ReadonlyArray<HopCrossedSegment>,
  ownWidth: number,
): { path: string; spans: HopSpan[] } {
  if (points.length < 2 || crossed.length === 0) {
    return { path: plainPath(points), spans: [] };
  }

  const count = points.length;
  const arcs = new Array<number>(count);
  arcs[0] = 0;
  for (let index = 1; index < count; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    arcs[index] = arcs[index - 1]! + Math.hypot(to.x - from.x, to.y - from.y);
  }
  const total = arcs[count - 1]!;
  if (total < MIN_CHORD) {
    return { path: plainPath(points), spans: [] };
  }

  const windows: Window[] = [];
  const distances = new Array<number>(count);
  for (const segment of crossed) {
    const vx = segment.end.x - segment.start.x;
    const vy = segment.end.y - segment.start.y;
    const length = Math.hypot(vx, vy);
    if (length < 1) {
      continue;
    }
    const ux = vx / length;
    const uy = vy / length;
    // Signed distance of each vertex from the crossed line.
    for (let index = 0; index < count; index += 1) {
      const point = points[index]!;
      distances[index] =
        ux * (point.y - segment.start.y) - uy * (point.x - segment.start.x);
    }
    const radius = hopRadiusFor(ownWidth, segment.width);
    const within = (at: number) => {
      const point = pointAt(points, arcs, at);
      const along = ux * (point.x - segment.start.x) + uy * (point.y - segment.start.y);
      return along > OVERSHOOT && along < length - OVERSHOOT;
    };

    for (let index = 0; index + 1 < count; index += 1) {
      const here = distances[index]!;
      const next = distances[index + 1]!;
      // Straight through the middle of a run.
      if ((here > ON_LINE && next < -ON_LINE) || (here < -ON_LINE && next > ON_LINE)) {
        const at = arcs[index]! + (here / (here - next)) * (arcs[index + 1]! - arcs[index]!);
        if (within(at)) {
          windows.push(
            clearanceWindow(points, arcs, distances, at, index + 1, index, radius),
          );
        }
        continue;
      }
      // Through a bend that sits on the line: the wire arrives from one side
      // and leaves on the other. Riding along the line for a stretch is lane
      // company, not a crossing.
      const bend = index + 1;
      if (
        Math.abs(here) > ON_LINE &&
        Math.abs(next) <= ON_LINE &&
        bend + 1 < count &&
        Math.abs(distances[bend + 1]!) > ON_LINE &&
        Math.sign(distances[bend + 1]!) !== Math.sign(here) &&
        within(arcs[bend]!)
      ) {
        windows.push(
          clearanceWindow(points, arcs, distances, arcs[bend]!, bend + 1, bend - 1, radius),
        );
      }
    }
  }

  if (windows.length === 0) {
    return { path: plainPath(points), spans: [] };
  }

  windows.sort((left, right) => left.from - right.from);
  // Bumps closer together than a bump is tall run into one: two humps with a
  // few pixels of straight between them read as a wiggle, not two hops.
  const merged: Window[] = [];
  for (const window of windows) {
    const clamped = {
      from: Math.max(0.5, window.from),
      to: Math.min(total - 0.5, window.to),
      height: window.height,
    };
    const previous = merged[merged.length - 1];
    if (previous && clamped.from <= previous.to + Math.min(previous.height, clamped.height)) {
      previous.to = Math.max(previous.to, clamped.to);
      previous.height = Math.max(previous.height, clamped.height);
    } else {
      merged.push(clamped);
    }
  }

  const first = points[0]!;
  let path = `M ${first.x},${first.y}`;
  const spans: HopSpan[] = [];
  let vertex = 1;
  for (const window of merged) {
    while (vertex < count && arcs[vertex]! <= window.from) {
      path += ` L ${points[vertex]!.x},${points[vertex]!.y}`;
      vertex += 1;
    }
    const inside: HopPoint[] = [];
    while (vertex < count && arcs[vertex]! < window.to) {
      inside.push(points[vertex]!);
      vertex += 1;
    }
    const foot = pointAt(points, arcs, window.from);
    const landing = pointAt(points, arcs, window.to);
    const bump = bumpCommand(foot, landing, window.height, inside);
    if (bump === undefined) {
      // Too short to bump: draw the wire as it is.
      for (const point of inside) {
        path += ` L ${point.x},${point.y}`;
      }
      continue;
    }
    path += ` L ${foot.x},${foot.y} ${bump}`;
    spans.push({ from: window.from, to: window.to });
  }
  while (vertex < count) {
    path += ` L ${points[vertex]!.x},${points[vertex]!.y}`;
    vertex += 1;
  }

  return { path, spans };
}

/** The polyline as a plain SVG path. */
function plainPath(points: ReadonlyArray<HopPoint>): string {
  const [first, ...rest] = points;
  if (!first) {
    return "";
  }
  return [`M ${first.x},${first.y}`, ...rest.map((point) => `L ${point.x},${point.y}`)].join(" ");
}

function pointAt(
  points: ReadonlyArray<HopPoint>,
  arcs: ReadonlyArray<number>,
  at: number,
): HopPoint {
  for (let index = 1; index < points.length; index += 1) {
    const end = arcs[index]!;
    if (at <= end || index === points.length - 1) {
      const start = arcs[index - 1]!;
      const from = points[index - 1]!;
      const to = points[index]!;
      const t = end > start ? Math.min(Math.max((at - start) / (end - start), 0), 1) : 0;
      return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    }
  }
  return points[points.length - 1]!;
}

/**
 * The stretch around a crossing at arc length `at` where the wire is within
 * `radius` of the crossed line: walk back from it and forward from it until
 * the wire is that far off the line. A square crossing reaches `radius` each
 * way, a 45° one about 1.4 times that, and a crossing near a bend follows the
 * wire round it. Never more than twice the radius either way, so a wire that
 * turns to run beside the line does not stretch a bump down its length.
 *
 * `nextVertex` is the first vertex ahead of the crossing, `previousVertex`
 * the first one behind it.
 */
function clearanceWindow(
  points: ReadonlyArray<HopPoint>,
  arcs: ReadonlyArray<number>,
  distances: ReadonlyArray<number>,
  at: number,
  nextVertex: number,
  previousVertex: number,
  radius: number,
): Window {
  const reach = radius * 2;
  const total = arcs[arcs.length - 1]!;

  let to = Math.min(total, at + reach);
  let fromArc = at;
  let fromDistance = 0;
  for (let index = nextVertex; index < points.length; index += 1) {
    const arc = arcs[index]!;
    const distance = distances[index]!;
    if (Math.abs(distance) >= radius && arc > fromArc) {
      const clear =
        fromArc +
        ((Math.sign(distance) * radius - fromDistance) / (distance - fromDistance)) *
          (arc - fromArc);
      to = Math.min(to, clear);
      break;
    }
    if (arc - at >= reach) {
      break;
    }
    fromArc = arc;
    fromDistance = distance;
  }

  let from = Math.max(0, at - reach);
  fromArc = at;
  fromDistance = 0;
  for (let index = previousVertex; index >= 0; index -= 1) {
    const arc = arcs[index]!;
    const distance = distances[index]!;
    if (Math.abs(distance) >= radius && arc < fromArc) {
      const clear =
        fromArc -
        ((Math.sign(distance) * radius - fromDistance) / (distance - fromDistance)) *
          (fromArc - arc);
      from = Math.max(from, clear);
      break;
    }
    if (at - arc >= reach) {
      break;
    }
    fromArc = arc;
    fromDistance = distance;
  }

  return { from, to, height: radius };
}

/**
 * The SVG arc from `foot` to `landing`: half an ellipse whose axis is the
 * chord between them, rising `height` off it. `inside` holds the wire's bends
 * the bump replaces; when there are any, it bulges to their side of the chord
 * (the outside of the corner) and clears the corner itself by half a radius.
 */
function bumpCommand(
  foot: HopPoint,
  landing: HopPoint,
  height: number,
  inside: ReadonlyArray<HopPoint>,
): string | undefined {
  const dx = landing.x - foot.x;
  const dy = landing.y - foot.y;
  const chord = Math.hypot(dx, dy);
  if (chord < MIN_CHORD) {
    return undefined;
  }
  const ux = dx / chord;
  const uy = dy / chord;

  // The upper normal of the chord, or the right-hand one when it is vertical.
  let nx = -uy;
  let ny = ux;
  if (ny > 1e-6 || (Math.abs(ny) <= 1e-6 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  let rise = height;
  if (inside.length > 0) {
    let side = 0;
    let deepest = 0;
    for (const point of inside) {
      const offset = ux * (point.y - foot.y) - uy * (point.x - foot.x);
      side += offset;
      deepest = Math.max(deepest, Math.abs(offset));
    }
    if (Math.abs(side) > 0.5) {
      // (-uy, ux) is the side a positive offset lies on.
      nx = side > 0 ? -uy : uy;
      ny = side > 0 ? ux : -ux;
      rise = Math.max(height, deepest + height / 2);
    }
  }
  // SVG sweep=1 is clockwise on screen; the arc bulges toward the normal
  // when the chord's cross product with it is negative.
  const sweep = ux * ny - uy * nx < 0 ? 1 : 0;
  const rotation = (Math.atan2(uy, ux) * 180) / Math.PI;
  return `A ${chord / 2} ${rise} ${rotation} 0 ${sweep} ${landing.x},${landing.y}`;
}

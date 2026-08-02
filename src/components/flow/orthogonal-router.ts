/**
 * Orthogonal A* edge router.
 *
 * The candidate-menu router could only jog once, so on dense boards the
 * least-bad candidate still crossed nodes. This router searches the
 * orthogonal visibility grid spanned by the obstacle boundaries instead:
 * moves only exist through free space, so a returned path NEVER passes
 * through an obstacle - it bends exactly as many times as the board demands.
 *
 * Invariants (see ARCHITECTURE.md):
 * - Pure flow-coordinate geometry: no DOM, no viewport, fully deterministic
 *   for a given input (coordinate pools are sorted, the heap tie-breaks on
 *   stable state ids).
 * - Obstacles arrive pre-expanded by the caller's clearance margin; corridors
 *   may run exactly on an expanded boundary (comparisons are strict).
 */

export interface RouteRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface RoutePoint {
  x: number;
  y: number;
}

export interface RoutePortal extends RoutePoint {
  /** Axis the wire travels along when passing through this portal. */
  axis: "h" | "v";
}

export interface OrthogonalRouteOptions {
  source: RoutePortal;
  target: RoutePortal;
  /** Pre-expanded no-go rectangles. */
  obstacles: RouteRect[];
  /** Search window; coordinates outside it are not considered. */
  window: RouteRect;
  /** Existing edge segments to discourage crossing/hugging (rat's-nest control). */
  congestion?: Array<{ start: RoutePoint; end: RoutePoint }>;
  turnCost?: number;
  crossingCost?: number;
  nearness?: { distance: number; costPerPixel: number };
  /** Hard search budget (heap pops). Exhausted searches return undefined so
   * the caller can fall back instead of freezing the board on dense plans. */
  maxPops?: number;
}

const COORD_EPSILON = 0.01;

export function findOrthogonalRoute(options: OrthogonalRouteOptions): RoutePoint[] | undefined {
  const { source, target, window } = options;
  const turnCost = options.turnCost ?? 40;
  const crossingCost = options.crossingCost ?? 220;
  const nearness = options.nearness;
  const congestion = options.congestion ?? [];

  if (
    !isInside(window, source) ||
    !isInside(window, target) ||
    !Number.isFinite(source.x + source.y + target.x + target.y)
  ) {
    return undefined;
  }

  const obstacles = options.obstacles.filter(
    (rect) =>
      rect.right > window.left &&
      rect.left < window.right &&
      rect.bottom > window.top &&
      rect.top < window.bottom,
  );

  const xs = buildCoordPool(
    [window.left, window.right, source.x, target.x],
    obstacles.flatMap((rect) => [rect.left, rect.right]),
    window.left,
    window.right,
  );
  const ys = buildCoordPool(
    [window.top, window.bottom, source.y, target.y],
    obstacles.flatMap((rect) => [rect.top, rect.bottom]),
    window.top,
    window.bottom,
  );

  const sourceXi = indexOfCoord(xs, source.x);
  const sourceYi = indexOfCoord(ys, source.y);
  const targetXi = indexOfCoord(xs, target.x);
  const targetYi = indexOfCoord(ys, target.y);
  if (sourceXi < 0 || sourceYi < 0 || targetXi < 0 || targetYi < 0) {
    return undefined;
  }

  // Row/column blocker lists: an obstacle blocks a horizontal corridor at y
  // only when y is strictly inside it, so corridors on the expanded boundary
  // stay legal.
  const rowRects: RouteRect[][] = ys.map((y) =>
    obstacles.filter((rect) => rect.top < y - COORD_EPSILON && rect.bottom > y + COORD_EPSILON),
  );
  const columnRects: RouteRect[][] = xs.map((x) =>
    obstacles.filter((rect) => rect.left < x - COORD_EPSILON && rect.right > x + COORD_EPSILON),
  );

  const horizontalFree = (yi: number, xiFrom: number, xiTo: number) => {
    const low = Math.min(xs[xiFrom]!, xs[xiTo]!);
    const high = Math.max(xs[xiFrom]!, xs[xiTo]!);
    for (const rect of rowRects[yi]!) {
      if (rect.left < high - COORD_EPSILON && rect.right > low + COORD_EPSILON) {
        return false;
      }
    }
    return true;
  };
  const verticalFree = (xi: number, yiFrom: number, yiTo: number) => {
    const low = Math.min(ys[yiFrom]!, ys[yiTo]!);
    const high = Math.max(ys[yiFrom]!, ys[yiTo]!);
    for (const rect of columnRects[xi]!) {
      if (rect.top < high - COORD_EPSILON && rect.bottom > low + COORD_EPSILON) {
        return false;
      }
    }
    return true;
  };

  const congestionCost = (x1: number, y1: number, x2: number, y2: number) => {
    if (congestion.length === 0) {
      return 0;
    }
    let cost = 0;
    const horizontal = y1 === y2;
    const low = horizontal ? Math.min(x1, x2) : Math.min(y1, y2);
    const high = horizontal ? Math.max(x1, x2) : Math.max(y1, y2);
    for (const segment of congestion) {
      const segHorizontal = Math.abs(segment.start.y - segment.end.y) < COORD_EPSILON;
      const segVertical = Math.abs(segment.start.x - segment.end.x) < COORD_EPSILON;
      if (horizontal && segVertical) {
        const segLow = Math.min(segment.start.y, segment.end.y);
        const segHigh = Math.max(segment.start.y, segment.end.y);
        if (segment.start.x > low && segment.start.x < high && y1 > segLow && y1 < segHigh) {
          cost += crossingCost;
        }
      } else if (!horizontal && segHorizontal) {
        const segLow = Math.min(segment.start.x, segment.end.x);
        const segHigh = Math.max(segment.start.x, segment.end.x);
        if (segment.start.y > low && segment.start.y < high && x1 > segLow && x1 < segHigh) {
          cost += crossingCost;
        }
      } else if (nearness && horizontal === segHorizontal && (segHorizontal || segVertical)) {
        const distance = horizontal
          ? Math.abs(segment.start.y - y1)
          : Math.abs(segment.start.x - x1);
        if (distance < nearness.distance) {
          const segLow = horizontal
            ? Math.min(segment.start.x, segment.end.x)
            : Math.min(segment.start.y, segment.end.y);
          const segHigh = horizontal
            ? Math.max(segment.start.x, segment.end.x)
            : Math.max(segment.start.y, segment.end.y);
          const overlap = Math.min(high, segHigh) - Math.max(low, segLow);
          if (overlap > 0) {
            cost += overlap * nearness.costPerPixel * (1 - distance / nearness.distance);
          }
        }
      }
    }
    return cost;
  };

  // State = grid vertex + travel axis (turn costs need the axis).
  const width = xs.length;
  const stateId = (xi: number, yi: number, axis: 0 | 1) => (yi * width + xi) * 2 + axis;
  const bestG = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  const heap = new MinHeap();

  const heuristic = (xi: number, yi: number, axis: 0 | 1) => {
    const dx = Math.abs(xs[xi]! - xs[targetXi]!);
    const dy = Math.abs(ys[yi]! - ys[targetYi]!);
    let turns = 0;
    if (dx > COORD_EPSILON && dy > COORD_EPSILON) {
      turns = 1;
    } else if (dx > COORD_EPSILON && axis === 1) {
      turns = 1;
    } else if (dy > COORD_EPSILON && axis === 0) {
      turns = 1;
    }
    return dx + dy + turns * turnCost;
  };

  const seedAxis: 0 | 1 = source.axis === "h" ? 0 : 1;
  const start = stateId(sourceXi, sourceYi, seedAxis);
  bestG.set(start, 0);
  heap.push(heuristic(sourceXi, sourceYi, seedAxis), start);
  const startTurned = stateId(sourceXi, sourceYi, seedAxis === 0 ? 1 : 0);
  bestG.set(startTurned, turnCost);
  heap.push(turnCost + heuristic(sourceXi, sourceYi, seedAxis === 0 ? 1 : 0), startTurned);

  const targetAxis: 0 | 1 = target.axis === "h" ? 0 : 1;
  const maxIterations = Math.min(xs.length * ys.length * 4 + 64, options.maxPops ?? 6000);
  let iterations = 0;
  let goalState = -1;

  while (heap.size > 0 && iterations < maxIterations) {
    iterations += 1;
    const current = heap.pop()!;
    const currentG = bestG.get(current);
    if (currentG === undefined) {
      continue;
    }
    const axis = (current % 2) as 0 | 1;
    const vertex = (current - axis) / 2;
    const xi = vertex % width;
    const yi = (vertex - xi) / width;

    if (xi === targetXi && yi === targetYi) {
      goalState = current;
      break;
    }

    const tryMove = (nextXi: number, nextYi: number, moveAxis: 0 | 1) => {
      const distance =
        moveAxis === 0 ? Math.abs(xs[nextXi]! - xs[xi]!) : Math.abs(ys[nextYi]! - ys[yi]!);
      const turn = axis === moveAxis ? 0 : turnCost;
      const arrival =
        nextXi === targetXi && nextYi === targetYi && moveAxis !== targetAxis ? turnCost : 0;
      const extra = congestionCost(xs[xi]!, ys[yi]!, xs[nextXi]!, ys[nextYi]!);
      const g = currentG + distance + turn + arrival + extra;
      const id = stateId(nextXi, nextYi, moveAxis);
      const known = bestG.get(id);
      if (known !== undefined && known <= g) {
        return;
      }
      bestG.set(id, g);
      cameFrom.set(id, current);
      heap.push(g + heuristic(nextXi, nextYi, moveAxis), id);
    };

    if (xi + 1 < width && horizontalFree(yi, xi, xi + 1)) {
      tryMove(xi + 1, yi, 0);
    }
    if (xi - 1 >= 0 && horizontalFree(yi, xi - 1, xi)) {
      tryMove(xi - 1, yi, 0);
    }
    if (yi + 1 < ys.length && verticalFree(xi, yi, yi + 1)) {
      tryMove(xi, yi + 1, 1);
    }
    if (yi - 1 >= 0 && verticalFree(xi, yi - 1, yi)) {
      tryMove(xi, yi - 1, 1);
    }
  }

  if (goalState < 0) {
    return undefined;
  }

  const reversed: RoutePoint[] = [];
  let cursor: number | undefined = goalState;
  while (cursor !== undefined) {
    const axis = cursor % 2;
    const vertex = (cursor - axis) / 2;
    const xi = vertex % width;
    const yi = (vertex - xi) / width;
    reversed.push({ x: xs[xi]!, y: ys[yi]! });
    cursor = cameFrom.get(cursor);
  }
  reversed.reverse();
  return compactCollinear(reversed);
}

/** Length + per-turn cost of a returned path, for comparing portal pairs. */
export function scoreOrthogonalPath(points: RoutePoint[], turnCost = 40): number {
  let length = 0;
  let turns = 0;
  for (let index = 1; index < points.length; index += 1) {
    length +=
      Math.abs(points[index]!.x - points[index - 1]!.x) +
      Math.abs(points[index]!.y - points[index - 1]!.y);
    if (index >= 2) {
      const previousHorizontal = points[index - 1]!.y === points[index - 2]!.y;
      const currentHorizontal = points[index]!.y === points[index - 1]!.y;
      if (previousHorizontal !== currentHorizontal) {
        turns += 1;
      }
    }
  }
  return length + turns * turnCost;
}

/** True when any polyline segment passes strictly through the rect. */
export function polylineCrossesRect(points: RoutePoint[], rect: RouteRect): boolean {
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    if (a.y === b.y) {
      const low = Math.min(a.x, b.x);
      const high = Math.max(a.x, b.x);
      if (
        a.y > rect.top + COORD_EPSILON &&
        a.y < rect.bottom - COORD_EPSILON &&
        low < rect.right - COORD_EPSILON &&
        high > rect.left + COORD_EPSILON
      ) {
        return true;
      }
    } else {
      const low = Math.min(a.y, b.y);
      const high = Math.max(a.y, b.y);
      if (
        a.x > rect.left + COORD_EPSILON &&
        a.x < rect.right - COORD_EPSILON &&
        low < rect.bottom - COORD_EPSILON &&
        high > rect.top + COORD_EPSILON
      ) {
        return true;
      }
    }
  }
  return false;
}

function buildCoordPool(
  required: number[],
  boundary: number[],
  low: number,
  high: number,
): number[] {
  const merged = [...required, ...boundary.filter((value) => value >= low && value <= high)];
  merged.sort((left, right) => left - right);
  const pool: number[] = [];
  for (const value of merged) {
    if (pool.length === 0 || value - pool[pool.length - 1]! > COORD_EPSILON) {
      pool.push(value);
    }
  }
  return pool;
}

function indexOfCoord(pool: number[], value: number): number {
  for (let index = 0; index < pool.length; index += 1) {
    if (Math.abs(pool[index]! - value) <= COORD_EPSILON) {
      return index;
    }
  }
  return -1;
}

function isInside(rect: RouteRect, point: RoutePoint): boolean {
  return (
    point.x >= rect.left - COORD_EPSILON &&
    point.x <= rect.right + COORD_EPSILON &&
    point.y >= rect.top - COORD_EPSILON &&
    point.y <= rect.bottom + COORD_EPSILON
  );
}

function compactCollinear(points: RoutePoint[]): RoutePoint[] {
  const compact: RoutePoint[] = [];
  for (const point of points) {
    const last = compact[compact.length - 1];
    if (last && Math.abs(last.x - point.x) <= COORD_EPSILON && Math.abs(last.y - point.y) <= COORD_EPSILON) {
      continue;
    }
    const previous = compact[compact.length - 2];
    if (
      last &&
      previous &&
      ((Math.abs(previous.x - last.x) <= COORD_EPSILON && Math.abs(last.x - point.x) <= COORD_EPSILON) ||
        (Math.abs(previous.y - last.y) <= COORD_EPSILON && Math.abs(last.y - point.y) <= COORD_EPSILON))
    ) {
      compact[compact.length - 1] = point;
      continue;
    }
    compact.push(point);
  }
  return compact;
}

/** Tiny binary min-heap over (priority, id); ties break on the smaller id so
 * search order (and therefore the chosen route) is fully deterministic. */
class MinHeap {
  private priorities: number[] = [];
  private ids: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(priority: number, id: number): void {
    this.priorities.push(priority);
    this.ids.push(id);
    let index = this.ids.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.isBefore(index, parent)) {
        break;
      }
      this.swap(index, parent);
      index = parent;
    }
  }

  pop(): number | undefined {
    if (this.ids.length === 0) {
      return undefined;
    }
    const top = this.ids[0]!;
    const lastPriority = this.priorities.pop()!;
    const lastId = this.ids.pop()!;
    if (this.ids.length > 0) {
      this.priorities[0] = lastPriority;
      this.ids[0] = lastId;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < this.ids.length && this.isBefore(left, smallest)) {
          smallest = left;
        }
        if (right < this.ids.length && this.isBefore(right, smallest)) {
          smallest = right;
        }
        if (smallest === index) {
          break;
        }
        this.swap(index, smallest);
        index = smallest;
      }
    }
    return top;
  }

  private isBefore(a: number, b: number): boolean {
    return (
      this.priorities[a]! < this.priorities[b]! ||
      (this.priorities[a] === this.priorities[b] && this.ids[a]! < this.ids[b]!)
    );
  }

  private swap(a: number, b: number): void {
    [this.priorities[a], this.priorities[b]] = [this.priorities[b]!, this.priorities[a]!];
    [this.ids[a], this.ids[b]] = [this.ids[b]!, this.ids[a]!];
  }
}

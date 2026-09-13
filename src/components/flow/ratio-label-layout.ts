type Point = { x: number; y: number };
export type RatioLabelWire = {
  id: string;
  points: readonly Point[];
  input?: string;
  output?: string;
};
export type RatioWireLabel = { key: string; text: string; ratio: number };

export function ratioLabelBounds(text: string, point: Point) {
  const lines = text.split("\n");
  return {
    ...point,
    width: Math.max(...lines.map((line) => line.length)) * 8 + 16,
    height: lines.length * 12 + 12,
  };
}

/** Suppress the whole arrowhead when it would touch a badge, in flow coordinates. */
export function arrowOverlapsRatioLabel(
  polygon: string,
  labels: readonly ReturnType<typeof ratioLabelBounds>[],
) {
  if (!labels.length) return false;
  const vertices = polygon
    .trim()
    .split(/\s+/)
    .map((point) => point.split(",").map(Number));
  const xs = vertices.map(([x]) => x),
    ys = vertices.map(([, y]) => y);
  const left = Math.min(...xs),
    right = Math.max(...xs),
    top = Math.min(...ys),
    bottom = Math.max(...ys);
  return labels.some(
    (label) =>
      right >= label.x - label.width / 2 - 4 &&
      left <= label.x + label.width / 2 + 4 &&
      bottom >= label.y - label.height / 2 - 4 &&
      top <= label.y + label.height / 2 + 4,
  );
}

/** One layout per published route/configuration change. No DOM or viewport inputs.
 * Move only colliding labels along their own wires; never alter the routes. */
export function layoutRatioLabels(wires: readonly RatioLabelWire[]): Map<string, RatioWireLabel[]> {
  const result = new Map<string, RatioWireLabel[]>();
  const occupied: { x: number; y: number; width: number; height: number }[] = [];
  for (const wire of wires) {
    const segments = wire.points.slice(1).map((end, i) => ({
      start: wire.points[i],
      end,
      length: Math.hypot(end.x - wire.points[i].x, end.y - wire.points[i].y),
    }));
    const length = segments.reduce((sum, segment) => sum + segment.length, 0);
    if (!length) continue;
    const pointAt = (ratio: number) => {
      let remaining = ratio * length;
      for (const segment of segments) {
        if (remaining <= segment.length && segment.length) {
          const t = remaining / segment.length;
          return {
            x: segment.start.x + (segment.end.x - segment.start.x) * t,
            y: segment.start.y + (segment.end.y - segment.start.y) * t,
          };
        }
        remaining -= segment.length;
      }
      return wire.points[wire.points.length - 1];
    };
    const both = wire.input !== undefined && wire.output !== undefined;
    const candidates =
      both && length < 160
        ? [{ key: "both", text: `Out ${wire.output}\nIn ${wire.input}` }]
        : (["output", "input"] as const).flatMap((key) =>
            wire[key] === undefined
              ? []
              : [{ key, text: `${both ? (key === "output" ? "Out " : "In ") : ""}${wire[key]}` }],
          );
    const placed: RatioWireLabel[] = [];
    for (const label of candidates) {
      const { width, height } = ratioLabelBounds(label.text, { x: 0, y: 0 });
      let chosen = { ratio: 0.5, overlap: Infinity };
      for (const distance of label.key === "both"
        ? [length / 2]
        : [60, 36, 84, 108, 132, 156, 180]) {
        const near = Math.min(distance / length, 0.5);
        const ratio = label.key === "input" ? 1 - near : near;
        const point = pointAt(ratio);
        const overlap = occupied.reduce((sum, rect) => {
          const dx = Math.max(0, (width + rect.width) / 2 + 4 - Math.abs(point.x - rect.x));
          const dy = Math.max(0, (height + rect.height) / 2 + 4 - Math.abs(point.y - rect.y));
          return sum + dx * dy;
        }, 0);
        if (overlap < chosen.overlap) chosen = { ratio, overlap };
        if (!overlap) break;
      }
      occupied.push({ ...pointAt(chosen.ratio), width, height });
      placed.push({ ...label, ratio: chosen.ratio });
    }
    result.set(wire.id, placed);
  }
  return result;
}

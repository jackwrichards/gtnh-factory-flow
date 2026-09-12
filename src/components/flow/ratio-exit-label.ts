/** Flow-space only: labels stay beside the source dock through zoom and pan.
 * Vertical exits stagger their horizontal text so adjacent grid docks remain readable. */
export function ratioExitLabel(points: readonly { x: number; y: number }[], index: number) {
  const start = points[0];
  const next = points.find(
    (point) => start && Math.hypot(point.x - start.x, point.y - start.y) > 0.1,
  );
  if (!start || !next) return undefined;
  const dx = next.x - start.x;
  const dy = next.y - start.y;
  if (Math.abs(dx) > Math.abs(dy) * 2) {
    return {
      x: start.x + Math.sign(dx) * 12,
      y: start.y - 6,
      transform: dx > 0 ? "translate(0, -100%)" : "translate(-100%, -100%)",
    };
  }
  if (Math.abs(dy) <= Math.abs(dx) * 2) {
    return {
      x: start.x + Math.sign(dx) * 16,
      y: start.y + Math.sign(dy) * 16,
      transform: `translate(${dx > 0 ? "0" : "-100%"}, ${dy > 0 ? "0" : "-100%"})`,
    };
  }
  return {
    x: start.x + 6,
    y: start.y + Math.sign(dy) * (18 + (index % 3) * 16),
    transform: dy > 0 ? "translate(0, 0)" : "translate(0, -100%)",
  };
}

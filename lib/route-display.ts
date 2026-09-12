type Point = { x: number; y: number };

/** Give every traversal of an undirected grid edge its own display lane. */
export function spacedRoute(points: Point[], gap: number): Point[] {
  const key = (p: Point) => `${p.x},${p.y}`;
  const edges = points.slice(1).map((end, i) => {
    const start = points[i];
    const forward = key(start) < key(end);
    return { start, end, forward, key: forward ? `${key(start)}:${key(end)}` : `${key(end)}:${key(start)}` };
  });
  const counts = new Map<string, number>(), used = new Map<string, number>();
  for (const edge of edges) counts.set(edge.key, (counts.get(edge.key) ?? 0) + 1);
  const display: Point[] = points.length ? [points[0]] : [];
  for (const edge of edges) {
    const lane = used.get(edge.key) ?? 0;
    used.set(edge.key, lane + 1);
    const offset = (lane - ((counts.get(edge.key) ?? 1) - 1) / 2) * gap;
    const dx = edge.end.x - edge.start.x, dy = edge.end.y - edge.start.y;
    const length = Math.hypot(dx, dy);
    if (!length) continue;
    const direction = edge.forward ? 1 : -1;
    const shift = { x: -dy / length * offset * direction, y: dx / length * offset * direction };
    display.push({ x: edge.start.x + shift.x, y: edge.start.y + shift.y },
      { x: edge.end.x + shift.x, y: edge.end.y + shift.y });
  }
  if (points.length) display.push(points[points.length - 1]);
  return display;
}

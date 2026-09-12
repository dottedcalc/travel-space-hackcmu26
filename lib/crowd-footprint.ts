import type { Point } from "./simulation.ts";

export type CrowdFootprint = { along: number; across: number; direction: Point; pressure: number };
/** Illustrative occupied area in metres; queues stretch along their front-to-tail axis. */
export function crowdFootprint(people: number, queued: boolean, heading: Point,
  freeFraction = 1): CrowdFootprint {
  const count = Math.max(0, people);
  const aspect = queued ? 2.5 : 1.5;
  const area = Math.max(Math.PI * 0.55 ** 2, count * (queued ? 0.7 : 0.9));
  const space = Math.max(0.15, Math.min(1, freeFraction));
  const expansion = 1 + 0.15 * (1 - space);
  const across = Math.sqrt(area / (Math.PI * aspect)) * expansion;
  const magnitude = Math.hypot(heading.x, heading.y);
  return { along: across * aspect, across, pressure: 1 / space,
    direction: queued ? { x: 0, y: 1 } : magnitude > 1e-8 ?
      { x: heading.x / magnitude, y: heading.y / magnitude } : { x: 0, y: 1 } };
}
export function footprintCoordinates(offset: Point, shape: CrowdFootprint, padding = 0) {
  return { x: (offset.x * shape.direction.x + offset.y * shape.direction.y) / (shape.along + padding),
    y: (offset.x * -shape.direction.y + offset.y * shape.direction.x) / (shape.across + padding) };
}
/** Sample reachable floor within the footprint, counting walls and obstacles as lost space. */
export function footprintFreeFraction(position: Point, shape: CrowdFootprint,
  reachable: (point: Point) => boolean) {
  let free = 1;
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    const along = Math.cos(angle) * shape.along * 0.75;
    const across = Math.sin(angle) * shape.across * 0.75;
    if (reachable({ x: position.x + along * shape.direction.x - across * shape.direction.y,
      y: position.y + along * shape.direction.y + across * shape.direction.x })) free++;
  }
  return free / 9;
}

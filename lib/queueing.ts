import { footprintCoordinates, type CrowdFootprint } from "./crowd-footprint.ts";
import type { Point } from "./simulation.ts";

export type QueueBody = { id: number; position: Point; queueId?: string; footprint?: CrowdFootprint };
export const QUEUE_BODY_CLEARANCE = 0.55;

/** Local speed loss when a queue occupies the pedestrian's forward corridor. */
export function queueSpeedFactor(position: Point, direction: Point, neighbors: QueueBody[], id: number) {
  let pressure = 0;
  for (const other of neighbors) {
    if (other.id === id) continue;
    if (other.footprint) {
      const offset = { x: position.x - other.position.x, y: position.y - other.position.y };
      const ahead = -offset.x * direction.x - offset.y * direction.y;
      const local = footprintCoordinates(offset, other.footprint, 1);
      const distance = Math.hypot(local.x, local.y);
      if (distance < 1 && ahead > -other.footprint.along)
        pressure += (1 - distance) * other.footprint.pressure * (other.queueId ? 1 : 0.35);
      continue;
    }
    if (!other.queueId) continue;
    const dx = other.position.x - position.x, dy = other.position.y - position.y;
    const ahead = dx * direction.x + dy * direction.y;
    const lateral = Math.abs(dx * direction.y - dy * direction.x);
    if (ahead < -0.2 || ahead > 2 || lateral >= 1) continue;
    pressure += (1 - Math.max(0, ahead) / 2) * (1 - lateral);
  }
  return Math.max(0.12, 1 / (1 + pressure * 3));
}

/** Stop before a queued body; steering recovery must obey the same clearance. */
export function queueSafeDistance(position: Point, direction: Point, distance: number,
  neighbors: QueueBody[], id: number, joiningQueueId?: string) {
  let allowed = distance;
  for (const other of neighbors) {
    if (other.id === id || !other.queueId || other.queueId === joiningQueueId) continue;
    if (other.footprint) {
      const start = footprintCoordinates({ x: position.x - other.position.x, y: position.y - other.position.y }, other.footprint);
      const ray = footprintCoordinates(direction, other.footprint);
      const a = ray.x ** 2 + ray.y ** 2, b = start.x * ray.x + start.y * ray.y;
      const c = start.x ** 2 + start.y ** 2 - 1;
      if (c < 0) { if (b < 0) allowed = 0; continue; }
      const discriminant = b * b - a * c;
      if (a > 0 && b < 0 && discriminant > 0)
        allowed = Math.min(allowed, Math.max(0, (-b - Math.sqrt(discriminant)) / a - 0.01));
      continue;
    }
    const dx = position.x - other.position.x, dy = position.y - other.position.y;
    const projection = dx * direction.x + dy * direction.y;
    const c = dx * dx + dy * dy - QUEUE_BODY_CLEARANCE ** 2;
    // If already too close, permit retreat only.
    if (c < 0) {
      if (projection < 0) allowed = 0;
      continue;
    }
    const discriminant = projection * projection - c;
    if (projection >= 0 || discriminant <= 0) continue;
    allowed = Math.min(allowed, Math.max(0, -projection - Math.sqrt(discriminant) - 0.01));
  }
  return allowed;
}

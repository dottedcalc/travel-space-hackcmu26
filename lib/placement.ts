import { objectPresets, onRoomBoundary, pointInRoom, rectInsideRoom, roomRectangles, type FairEvent, type Item } from "./event.ts";
import type { Point } from "./simulation";

const snap = (value: number) => Math.round(value * 2) / 2;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, max));

export function emergencyExitAt(
  item: Item,
  event: FairEvent,
  point: Point,
): Item | null {
  if (
    point.x < 0 || point.y < 0 ||
    point.x > event.width || point.y > event.height
  ) return null;
  const candidates: { item: Item; distance: number }[] = [];
  for (const r of roomRectangles(event)) {
    for (const side of ["left", "right", "top", "bottom"] as const) {
      const horizontal = side === "top" || side === "bottom";
      const { w: width, h: depth } = objectPresets.emergency_exit;
      const w = horizontal ? width : depth, h = horizontal ? depth : width;
      if (r.w < w || r.h < h) continue;
      const x = side === "left" ? r.x : side === "right" ? r.x + r.w - w :
        clamp(snap(point.x - w / 2), r.x, r.x + r.w - w);
      const y = side === "top" ? r.y : side === "bottom" ? r.y + r.h - h :
        clamp(snap(point.y - h / 2), r.y, r.y + r.h - h);
      const next = { ...item, x, y, w, h };
      const outside = side === "left" ? !pointInRoom(event, r.x - 0.001, y + h / 2) :
        side === "right" ? !pointInRoom(event, r.x + r.w + 0.001, y + h / 2) :
        side === "top" ? !pointInRoom(event, x + w / 2, r.y - 0.001) :
        !pointInRoom(event, x + w / 2, r.y + r.h + 0.001);
      if (!outside || !rectInsideRoom(event, next) || !onRoomBoundary(event, next)) continue;
      const distance = horizontal
        ? Math.hypot(point.y - (side === "top" ? r.y : r.y + r.h),
          point.x - clamp(point.x, x, x + w))
        : Math.hypot(point.x - (side === "left" ? r.x : r.x + r.w),
          point.y - clamp(point.y, y, y + h));
      candidates.push({ item: next, distance });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0]?.distance <= 1.5 ? candidates[0].item : null;
}

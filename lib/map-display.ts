import { roomBoundarySegments, type RoomGeometry } from "./event.ts";

/** Only perimeter access points represent physical doorways. */
export function doorwayFor(event: RoomGeometry, point: { x: number; y: number }) {
  const candidates = roomBoundarySegments(event).flatMap((border) => {
    const vertical = border.side === "east" || border.side === "west";
    const along = vertical ? point.y : point.x;
    const distance = Math.abs((vertical ? point.x : point.y) - border.coordinate);
    const width = Math.min(2.4, border.end - border.start);
    if (distance > 1.1 || along < border.start || along > border.end || width < 1) return [];
    const center = Math.max(border.start + width / 2, Math.min(border.end - width / 2, along));
    return [{ x: vertical ? border.coordinate : center, y: vertical ? center : border.coordinate,
      width, distance, rotation: { north: 0, east: 90, south: 180, west: 270 }[border.side] }];
  });
  return candidates.sort((a, b) => a.distance - b.distance)[0] ?? null;
}

/** Choose a readable grid interval as the physical floor plan changes size. */
export function gridMetersFor(width: number, height: number): number {
  const target = Math.max(width / 20, height / 14, 0.5);
  const power = 10 ** Math.floor(Math.log10(target));
  return [1, 2, 5, 10].map((step) => step * power)
    .find((step) => step >= target) ?? 10 * power;
}

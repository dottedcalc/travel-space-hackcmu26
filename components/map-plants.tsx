import { allAccessPoints, rectInsideRoom, roomBoundarySegments, roomRectangles, type FairEvent, type Item } from "@/lib/event";

/** Stable decorative planting; these symbols do not add simulation obstacles. */
export default function MapPlants({ event, items }: { event: FairEvent; items: Item[] }) {
  const area = roomRectangles(event).reduce((total, room) => total + room.w * room.h, 0);
  // Seeded rounding gives smaller rooms fewer plants without flickering on redraw.
  const seed = Math.sin(area * .017 + event.width * 127.1 + event.height * 311.7) * 43758.5453;
  const random = seed - Math.floor(seed);
  const targetCount = 3 + Math.min(2, Math.floor(Math.max(0, (area - 300) / 600) + random));
  const radius = Math.max(.55, Math.min(1.8, Math.min(event.width, event.height) * .03));
  const doors = allAccessPoints(event);
  const candidates = roomBoundarySegments(event).flatMap((border, wall) => {
    const vertical = border.side === "east" || border.side === "west";
    const inset = radius + .35;
    return Array.from({ length: 8 }, (_, index) => {
      const seed = Math.sin((wall + 1) * 127.1 + (index + 1) * 311.7) * 43758.5453;
      const random = seed - Math.floor(seed);
      const along = border.start + (border.end - border.start) * ((index + .25 + random * .5) / 8);
      const cross = border.coordinate + (border.side === "north" || border.side === "west" ? inset : -inset);
      return { x: vertical ? cross : along, y: vertical ? along : cross, rotation: random * 360, rank: random };
    });
  }).sort((a, b) => a.rank - b.rank);
  const plants: typeof candidates = [];
  for (const point of candidates) {
    if (plants.length >= targetCount) break;
    const clearance = radius + .65;
    if (!rectInsideRoom(event, { x: point.x - radius, y: point.y - radius, w: radius * 2, h: radius * 2 }) ||
      items.some((item) => point.x + clearance > item.x && point.x - clearance < item.x + item.w &&
        point.y + clearance > item.y && point.y - clearance < item.y + item.h) ||
      doors.some((door) => Math.hypot(point.x - door.x, point.y - door.y) < radius + 3) ||
      plants.some((plant) => Math.hypot(point.x - plant.x, point.y - plant.y) < radius * 5)) continue;
    plants.push(point);
  }
  return <g className="map-plants" pointerEvents="none" aria-hidden="true">
    {plants.map((plant, index) => <g key={index} data-testid="map-plant"
      transform={`translate(${plant.x * 20} ${plant.y * 20}) rotate(${plant.rotation}) scale(${radius * 20 / 16})`}>
      <circle r="11" fill="#f1f6ef" stroke="#93ab8d" strokeWidth="1" />
      {Array.from({ length: 7 }, (_, leaf) => <g key={leaf} transform={`rotate(${leaf * 360 / 7})`}>
        <ellipse cx="0" cy="-7" rx="4.5" ry="8" fill={leaf % 2 ? "#c7dabb" : "#dce8d3"}
          stroke="#7d9a73" strokeWidth=".75" />
        <path d="M0 -2V-12" stroke="#9ab18e" strokeWidth=".65" />
      </g>)}
      <circle r="3" fill="#86a379" stroke="#718e66" strokeWidth=".6" />
    </g>)}
  </g>;
}

import type { ExhibitorProfile, RSVPState, SeatPolicy } from "./rsvp-types.ts";
export const boothCategories = ["Technology", "Art & Design", "Games", "Education", "Business", "Sports"] as const;
export const isBoothCategory = (value: string): boolean =>
  boothCategories.some((category) => category === value);
export const itemKinds = [
  "booth", "food", "obstacle", "reception", "stairs",
  "emergency_exit", "stage", "seating", "restroom",
] as const;
export type ItemKind = (typeof itemKinds)[number];
export const objectPresets: Record<ItemKind, {
  label: string;
  prefix: string;
  w: number;
  h: number;
  popularity: number;
  dwell: number;
}> = {
  booth: { label: "Booth", prefix: "B", w: 5, h: 3, popularity: 2, dwell: 60 },
  food: { label: "Food station", prefix: "F", w: 4, h: 3, popularity: 3, dwell: 60 },
  obstacle: { label: "Obstacle", prefix: "O", w: 4, h: 3, popularity: 1, dwell: 30 },
  reception: { label: "Reception desk", prefix: "R", w: 5, h: 3, popularity: 1, dwell: 30 },
  stairs: { label: "Stairs", prefix: "T", w: 3, h: 4, popularity: 1, dwell: 30 },
  emergency_exit: { label: "Emergency exit", prefix: "E", w: 2.5, h: 1.5, popularity: 1, dwell: 30 },
  stage: { label: "Stage", prefix: "G", w: 7, h: 5, popularity: 1, dwell: 30 },
  seating: { label: "Seating", prefix: "S", w: 5, h: 4, popularity: 1, dwell: 30 },
  restroom: { label: "Restroom", prefix: "WC", w: 4, h: 4, popularity: 1, dwell: 30 },
};
export type FoodAvailability = { start: string; end: string };
export const MAX_FOOD_WINDOWS = 12;
export function foodAvailabilityError(windows: FoodAvailability[]): string | null {
  if (windows.length > MAX_FOOD_WINDOWS) return `Use up to ${MAX_FOOD_WINDOWS} food availability windows.`;
  const sorted = [...windows].sort((a, b) => a.start.localeCompare(b.start));
  for (const [index, window] of sorted.entries()) {
    if (![window.start, window.end].every((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time)) || window.end <= window.start)
      return "Each food window needs an end time after its start time.";
    if (index && window.start < sorted[index - 1].end)
      return "Food availability windows must not overlap.";
  }
  return null;
}
/** Preserve older stations' opening time until their schedule is edited. */
export const foodAvailabilityFor = (item: Item, event: Pick<FairEvent, "startTime" | "endTime">): FoodAvailability[] =>
  item.foodAvailability ?? [{ start: item.foodAvailableAt ?? event.startTime, end: event.endTime }]
    .filter((window) => window.start < window.end);
export function defaultFoodAvailability(event: Pick<FairEvent, "startTime" | "endTime">): FoodAvailability[] {
  const windows = [{ start: "08:00", end: "10:00" }, { start: "12:00", end: "14:00" },
    { start: "18:00", end: "20:00" }].map((window) => ({
      start: window.start < event.startTime ? event.startTime : window.start,
      end: window.end > event.endTime ? event.endTime : window.end,
    })).filter((window) => window.start < window.end);
  return windows.length ? windows : [{ start: event.startTime, end: event.endTime }];
}
export type Item = {
  id: string;
  kind: ItemKind;
  label: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  company: string;
  category: string;
  popularity: number;
  dwell: number;
  /** Visitors processed per minute, independently of browsing time. */
  processingRate?: number;
  /** Average audience stay in seconds; separate from queue processing. */
  stageLingering?: number;
  /** Percentage of visitors drawn to the stage, from 0 (off) to 100. */
  stageSpotlight?: number;
  foodAvailableAt?: string;
  foodAvailability?: FoodAvailability[];
  reservationPolicy?: SeatPolicy;
};
export const processingRateFor = (item: Item) => item.processingRate ?? (item.kind === "reception" ? 20 : 6);
export const stageLingeringFor = (item: Item) => item.stageLingering ?? 900;
export const stageSpotlightFor = (item: Item) => item.stageSpotlight ?? 80;
export type ExhibitorCompany = { name: string; category: string; id?: string; profile?: ExhibitorProfile };
export type Rect = { x: number; y: number; w: number; h: number };
export type RoomGeometry = { width: number; height: number; roomRectangles?: Rect[] };
export const MAX_MAP_SIZE = 1000;
export const DEFAULT_VISITORS = 10_000;
export const MAX_VISITORS = 100_000;
export const rectanglesOverlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export const roomRectangles = (event: RoomGeometry): Rect[] =>
  event.roomRectangles?.length ? event.roomRectangles :
  [{ x: 0, y: 0, w: event.width, h: event.height }];
export const pointInRoom = (event: RoomGeometry, x: number, y: number) =>
  roomRectangles(event).some((r) =>
    x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
export type RoomBorder = {
  side: "north" | "east" | "south" | "west";
  coordinate: number;
  start: number;
  end: number;
};
/** Only the exposed portions of the joined rectangles, excluding internal seams. */
export function roomBoundarySegments(event: RoomGeometry): RoomBorder[] {
  const rects = roomRectangles(event);
  const borders: RoomBorder[] = [];
  for (const r of rects) {
    const ys = [...new Set([r.y, r.y + r.h, ...rects.flatMap((s) => [s.y, s.y + s.h])
      .filter((y) => y > r.y && y < r.y + r.h)])].sort((a, b) => a - b);
    const xs = [...new Set([r.x, r.x + r.w, ...rects.flatMap((s) => [s.x, s.x + s.w])
      .filter((x) => x > r.x && x < r.x + r.w)])].sort((a, b) => a - b);
    for (let i = 0; i < ys.length - 1; i++) {
      const middle = (ys[i] + ys[i + 1]) / 2;
      if (!pointInRoom(event, r.x - 0.001, middle))
        borders.push({ side: "west", coordinate: r.x, start: ys[i], end: ys[i + 1] });
      if (!pointInRoom(event, r.x + r.w + 0.001, middle))
        borders.push({ side: "east", coordinate: r.x + r.w, start: ys[i], end: ys[i + 1] });
    }
    for (let i = 0; i < xs.length - 1; i++) {
      const middle = (xs[i] + xs[i + 1]) / 2;
      if (!pointInRoom(event, middle, r.y - 0.001))
        borders.push({ side: "north", coordinate: r.y, start: xs[i], end: xs[i + 1] });
      if (!pointInRoom(event, middle, r.y + r.h + 0.001))
        borders.push({ side: "south", coordinate: r.y + r.h, start: xs[i], end: xs[i + 1] });
    }
  }
  // A wall may span several rectangles. Treat touching, collinear pieces as
  // one exposed wall so a new section can join the entire room outline.
  borders.sort((a, b) =>
    a.side.localeCompare(b.side) || a.coordinate - b.coordinate || a.start - b.start);
  const joined: RoomBorder[] = [];
  for (const border of borders) {
    const previous = joined[joined.length - 1];
    if (previous?.side === border.side && previous.coordinate === border.coordinate &&
      border.start <= previous.end) {
      previous.end = Math.max(previous.end, border.end);
    } else joined.push({ ...border });
  }
  return joined;
}
export function roomRectangleFromDrag(border: RoomBorder, anchor: { x: number; y: number },
  pointer: { x: number; y: number }, canvas: { minX?: number; minY?: number; width: number; height: number }): Rect | null {
  const snap = (n: number) => Math.round(n * 2) / 2;
  const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(n, high));
  const vertical = border.side === "east" || border.side === "west";
  const alongAnchor = clamp(snap(vertical ? anchor.y : anchor.x), border.start, border.end);
  const alongPointer = clamp(snap(vertical ? pointer.y : pointer.x), border.start, border.end);
  let start = Math.min(alongAnchor, alongPointer);
  let end = Math.max(alongAnchor, alongPointer);
  if (end - start < 0.5) {
    start = clamp(snap(alongAnchor - 1.5), border.start, border.end - 0.5);
    end = Math.min(border.end, start + 3);
  }
  const outward = border.side === "east" ? pointer.x - border.coordinate :
    border.side === "west" ? border.coordinate - pointer.x :
    border.side === "south" ? pointer.y - border.coordinate :
    border.coordinate - pointer.y;
  if (outward < 0.25) return null;
  const reach = snap(outward);
  const rect: Rect = vertical ? {
    x: border.side === "east" ? border.coordinate : border.coordinate - reach,
    y: start, w: reach, h: end - start,
  } : {
    x: start, y: border.side === "south" ? border.coordinate : border.coordinate - reach,
    w: end - start, h: reach,
  };
  if (rect.x < (canvas.minX ?? 0) || rect.y < (canvas.minY ?? 0) || rect.x + rect.w > canvas.width ||
    rect.y + rect.h > canvas.height || rect.w < 0.5 || rect.h < 0.5) return null;
  return rect;
}
/** Adds a section and moves the existing plan when it expands north or west. */
export function withRoomRectangle(event: FairEvent, rectangle: Rect): FairEvent {
  const dx = Math.max(0, -rectangle.x);
  const dy = Math.max(0, -rectangle.y);
  return {
    ...event,
    width: Math.max(event.width, rectangle.x + rectangle.w) + dx,
    height: Math.max(event.height, rectangle.y + rectangle.h) + dy,
    roomRectangles: [...roomRectangles(event), rectangle].map((r) =>
      ({ ...r, x: r.x + dx, y: r.y + dy })),
    entrance: { x: event.entrance.x + dx, y: event.entrance.y + dy },
    exit: { x: event.exit.x + dx, y: event.exit.y + dy },
    entrances: event.entrances?.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy })),
    exits: event.exits?.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy })),
    items: event.items.map((item) => ({ ...item, x: item.x + dx, y: item.y + dy })),
  };
}
/** Removes an added section and keeps the remaining plan at the origin. */
export function withoutRoomRectangle(event: FairEvent, index: number): FairEvent | null {
  const rects = roomRectangles(event);
  if (index <= 0 || index >= rects.length) return null;
  const remaining = rects.filter((_, i) => i !== index);
  const dx = Math.min(...remaining.map((r) => r.x));
  const dy = Math.min(...remaining.map((r) => r.y));
  return {
    ...event,
    width: Math.max(...remaining.map((r) => r.x + r.w)) - dx,
    height: Math.max(...remaining.map((r) => r.y + r.h)) - dy,
    roomRectangles: remaining.map((r) => ({ ...r, x: r.x - dx, y: r.y - dy })),
    entrance: { x: event.entrance.x - dx, y: event.entrance.y - dy },
    exit: { x: event.exit.x - dx, y: event.exit.y - dy },
    entrances: event.entrances?.map((point) => ({ ...point, x: point.x - dx, y: point.y - dy })),
    exits: event.exits?.map((point) => ({ ...point, x: point.x - dx, y: point.y - dy })),
    items: event.items.map((item) => ({ ...item, x: item.x - dx, y: item.y - dy })),
  };
}
/** Scale every section and object from the origin, preserving the map's proportions. */
export function resizeRoom(event: FairEvent, width: number, height: number): FairEvent | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) ||
    width < 10 || height < 8 || width > MAX_MAP_SIZE || height > MAX_MAP_SIZE ||
    width * 2 !== Math.round(width * 2) || height * 2 !== Math.round(height * 2) ||
    Math.abs(width * event.height - height * event.width) >
      Math.max(event.width, event.height) * 0.25 + 0.000001) return null;
  const scaleX = width / event.width;
  const scaleY = height / event.height;
  const snap = (n: number) => Math.round(n * 2) / 2;
  const scaleRect = (r: Rect): Rect => {
    const x = snap(r.x * scaleX), y = snap(r.y * scaleY);
    return { x, y, w: snap((r.x + r.w) * scaleX) - x,
      h: snap((r.y + r.h) * scaleY) - y };
  };
  const next: FairEvent = {
    ...event, width, height,
    roomRectangles: roomRectangles(event).map(scaleRect),
    entrance: { x: snap(event.entrance.x * scaleX), y: snap(event.entrance.y * scaleY) },
    exit: { x: snap(event.exit.x * scaleX), y: snap(event.exit.y * scaleY) },
    entrances: event.entrances?.map((point) => ({ ...point,
      x: snap(point.x * scaleX), y: snap(point.y * scaleY) })),
    exits: event.exits?.map((point) => ({ ...point,
      x: snap(point.x * scaleX), y: snap(point.y * scaleY) })),
    items: event.items.map((item) => ({ ...item, ...scaleRect(item) })),
  };
  if (!validRoomShape(next) ||
    !allAccessPoints(next).every((p) => pointInRoom(next, p.x, p.y)) ||
    next.items.some((item) => !rectInsideRoom(next, item) ||
      (item.kind === "emergency_exit" && !onRoomBoundary(next, item))) ||
    next.items.some((item, i) => next.items.some((other, j) => i < j && rectanglesOverlap(item, other))) ||
    allAccessPoints(next).some((p) => next.items.some((item) =>
      p.x >= item.x && p.x < item.x + item.w && p.y >= item.y && p.y < item.y + item.h))) return null;
  return next;
}
export function rectInsideRoom(event: FairEvent, rect: Rect) {
  if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) ||
      rect.w <= 0 || rect.h <= 0 || rect.x < 0 || rect.y < 0 ||
      rect.x + rect.w > event.width || rect.y + rect.h > event.height) return false;
  const rs = roomRectangles(event);
  const xs = [...new Set([rect.x, rect.x + rect.w,
    ...rs.flatMap((r) => [r.x, r.x + r.w]).filter((x) => x > rect.x && x < rect.x + rect.w)])].sort((a, b) => a - b);
  const ys = [...new Set([rect.y, rect.y + rect.h,
    ...rs.flatMap((r) => [r.y, r.y + r.h]).filter((y) => y > rect.y && y < rect.y + rect.h)])].sort((a, b) => a - b);
  for (let ix = 0; ix < xs.length - 1; ix++)
    for (let iy = 0; iy < ys.length - 1; iy++)
      if (!pointInRoom(event, (xs[ix] + xs[ix + 1]) / 2, (ys[iy] + ys[iy + 1]) / 2))
        return false;
  return true;
}
export function validRoomShape(event: FairEvent) {
  const rects = roomRectangles(event);
  if (!Number.isFinite(event.width) || !Number.isFinite(event.height) ||
    event.width < 10 || event.height < 8 ||
    event.width > MAX_MAP_SIZE || event.height > MAX_MAP_SIZE ||
    !rects.length || rects.length > 12 ||
    rects.some((r) => ![r.x, r.y, r.w, r.h].every(Number.isFinite) ||
      r.x < 0 || r.y < 0 || r.w < 0.5 || r.h < 0.5 ||
      r.x + r.w > MAX_MAP_SIZE || r.y + r.h > MAX_MAP_SIZE ||
      [r.x, r.y, r.w, r.h].some((n) => n * 2 !== Math.round(n * 2))) ||
    Math.min(...rects.map((r) => r.x)) !== 0 ||
    Math.min(...rects.map((r) => r.y)) !== 0 ||
    Math.max(...rects.map((r) => r.x + r.w)) !== event.width ||
    Math.max(...rects.map((r) => r.y + r.h)) !== event.height)
    return false;
  const connected = new Set([0]);
  let progressed = true;
  while (progressed) {
    progressed = false;
    rects.forEach((a, i) => {
      if (connected.has(i)) return;
      const joins = [...connected].some((j) => {
        const b = rects[j];
        return ((a.x + a.w === b.x || b.x + b.w === a.x) &&
          Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y)) ||
          ((a.y + a.h === b.y || b.y + b.h === a.y) &&
          Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x));
      });
      if (joins) { connected.add(i); progressed = true; }
    });
  }
  return connected.size === rects.length &&
    rects.every((a, i) => rects.every((b, j) => i === j || !rectanglesOverlap(a, b)));
}
export function onRoomBoundary(event: FairEvent, rect: Rect) {
  if (!rectInsideRoom(event, rect)) return false;
  const epsilon = 0.001;
  return !pointInRoom(event, rect.x - epsilon, rect.y + rect.h / 2) ||
    !pointInRoom(event, rect.x + rect.w + epsilon, rect.y + rect.h / 2) ||
    !pointInRoom(event, rect.x + rect.w / 2, rect.y - epsilon) ||
    !pointInRoom(event, rect.x + rect.w / 2, rect.y + rect.h + epsilon);
}
export type FairEvent = {
  name: string;
  venue?: string;
  width: number;
  height: number;
  /** Joined, non-overlapping rectangles defining the room; absent means one rectangle. */
  roomRectangles?: Rect[];
  visitors: number;
  startTime: string;
  endTime: string;
  clearance: number;
  entrance: { x: number; y: number };
  exit: { x: number; y: number };
  entrances?: FlowPoint[];
  exits?: FlowPoint[];
  items: Item[];
  /** Registered exhibitors remain available even when they have no booth. */
  companies?: ExhibitorCompany[];
  rsvp?: RSVPState;
};
export type FlowPoint = { id: string; x: number; y: number; flow: number };
export const eventEntrances = (event: FairEvent): FlowPoint[] =>
  event.entrances?.length ? event.entrances : [{ id: "entrance-1", ...event.entrance, flow: 100 }];
export const eventExits = (event: FairEvent): FlowPoint[] =>
  event.exits?.length ? event.exits : [{ id: "exit-1", ...event.exit, flow: 100 }];
export const allAccessPoints = (event: FairEvent) => [...eventEntrances(event), ...eventExits(event)];
export function canPlaceAccessPoint(event: FairEvent, point: { x: number; y: number }, excludeId?: string) {
  return Number.isFinite(point.x) && Number.isFinite(point.y) &&
    pointInRoom(event, point.x, point.y) &&
    !event.items.some((item) => point.x >= item.x && point.x < item.x + item.w &&
      point.y >= item.y && point.y < item.y + item.h) &&
    !allAccessPoints(event).some((other) => other.id !== excludeId &&
      other.x === point.x && other.y === point.y);
}
export function withAccessPoints(event: FairEvent, kind: "entrance" | "exit", points: FlowPoint[]): FairEvent {
  if (!points.length) return event;
  return kind === "entrance"
    ? { ...event, entrance: { x: points[0].x, y: points[0].y }, entrances: points }
    : { ...event, exit: { x: points[0].x, y: points[0].y }, exits: points };
}
export function withAccessPercentage(points: FlowPoint[], id: string, percentage: number): FlowPoint[] {
  if (points.length === 1) return points.map((point) => ({ ...point, flow: 100 }));
  const others = points.filter((point) => point.id !== id);
  const otherTotal = others.reduce((sum, point) => sum + point.flow, 0);
  return points.map((point) => ({ ...point, flow: point.id === id ? percentage :
    (100 - percentage) * point.flow / otherTotal }));
}
export function eventCompanies(event: FairEvent): ExhibitorCompany[] {
  const companies = new Map<string, ExhibitorCompany>();
  for (const company of [...(event.companies || []),
    ...event.items.filter((item) => item.kind === "booth" && item.company)
      .map((item) => ({ name: item.company, category: item.category }))]) {
    const key = company.name.trim().toLocaleLowerCase();
    if (key && !companies.has(key)) companies.set(key, company);
  }
  return [...companies.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export function seedEvent(): FairEvent {
  const reservedBooths = new Set([0, 1, 2, 3, 6, 7, 10, 11]);
  return {
    name: "Sample Exhibition",
    venue: "Main Hall",
    width: 30,
    height: 20,
    visitors: DEFAULT_VISITORS,
    startTime: "08:00",
    endTime: "20:00",
    clearance: 1.5,
    entrance: { x: 4, y: 19 },
    exit: { x: 26, y: 0 },
    items: [
      ...Array.from({ length: 12 }, (_, i) => ({
        id: `b${i + 1}`,
        kind: "booth" as const,
        label: `B${String(i + 1).padStart(2, "0")}`,
        name: "Booth",
        x: 2 + (i % 4) * 7,
        y: 2 + Math.floor(i / 4) * 6,
        w: 5,
        h: 3,
        company: reservedBooths.has(i) ? `Exhibit ${String(i + 1).padStart(2, "0")}` : "",
        category: reservedBooths.has(i) ? boothCategories[[...reservedBooths].indexOf(i) % boothCategories.length] : "",
        popularity: 2,
        dwell: 60,
      })),
      {
        id: "o1",
        kind: "reception",
        label: "R01",
        name: "Reception desk",
        x: 11,
        y: 18,
        w: 8,
        h: 2,
        company: "",
        category: "",
        popularity: 1,
        dwell: 30,
      },
    ],
  };
}

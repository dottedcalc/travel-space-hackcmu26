import { crowdFootprint, footprintCoordinates, footprintFreeFraction } from "./crowd-footprint.ts";
import { orderNearbyBooths } from "./booth-routing.ts";
import { createFoodProfile, foodChoiceCost, mealReadyAt, type FoodProfile } from "./food-behavior.ts";
import { queuePeopleRemaining } from "./queue-display.ts";
import { queueWaitPersonSteps } from "./queue-wait.ts";
import { queueSafeDistance, queueSpeedFactor, type QueueBody } from "./queueing.ts";
import { allAccessPoints, foodAvailabilityFor, eventEntrances, eventExits, onRoomBoundary, pointInRoom, processingRateFor, stageLingeringFor, stageSpotlightFor, rectInsideRoom, rectanglesOverlap, roomRectangles, type FairEvent, type FlowPoint, type Item } from "./event.ts";
export type Point = { x: number; y: number };
export type Finding = {
  level: "warning" | "info";
  title: string;
  detail: string;
  itemId?: string;
  suggestion?: string;
};
export const visitorProfiles = {
  focused: { label: "Focused", speedFactor: 1.15, wanderFactor: 0.35, waitFactor: 0.65, color: "#eb5c5c" },
  viewer: { label: "Viewer", speedFactor: 0.85, wanderFactor: 0.70, waitFactor: 1.40, color: "#5291e1" },
  explorer: { label: "Explorer", speedFactor: 0.90, wanderFactor: 1.50, waitFactor: 1.00, color: "#4cd28c" },
  social: { label: "Social", speedFactor: 0.75, wanderFactor: 1.00, waitFactor: 1.25, color: "#f5ae4c" },
} as const;
export type VisitorType = keyof typeof visitorProfiles;
export type AgentState = "moving" | "queueing" | "waiting" | "pausing" | "exiting" | "finished" | "stranded";
export type QueueVisit = { itemId: string; joined: number; serviceStart: number | null; serviceEnd?: number | null; departed: number | null };
export type BoothQueue = { itemId: string; points: Point[] };
export type Agent = {
  id: number; start: number; path: Point[]; weight: number;
  type: VisitorType; route: string[]; state: AgentState;
  entranceId: string; exitId: string;
  pathSteps: number[]; endStep: number; queueVisits: QueueVisit[];
  pauses: { itemId: string; start: number; end: number | null; activity?: "eating" }[];
};
export type Simulation = {
  agents: Agent[];
  totalVisitors: number;
  queues: BoothQueue[];
  queueWait: number;
  heat: number[];
  peakLocalDensity: number[];
  cell: number;
  stepSeconds: number;
  duration: number;
  peak: number;
  walk: number;
  visits: number;
  missed: number;
  stranded: number;
  finished: number;
  hotspot: Point;
  findings: Finding[];
};
export function agentsAtStep(simulation: Simulation, step: number) {
  return simulation.agents.flatMap((agent) => {
    if (step < agent.start || step >= agent.endStep || !agent.path.length) return [];
    const offset = step - agent.start;
    let low = 0, high = agent.pathSteps.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (agent.pathSteps[middle] <= offset) low = middle;
      else high = middle;
    }
    const point = agent.path[low], next = agent.path[low + 1];
    const fraction = next ? (offset - agent.pathSteps[low]) /
      (agent.pathSteps[low + 1] - agent.pathSteps[low]) : 0;
    const queueVisit = agent.queueVisits.find((visit) => visit.joined <= step &&
      (visit.departed === null || visit.departed > step));
    return [{ agent, pathIndex: low, queueVisit,
      point: next && fraction > 0 ? {
        x: point.x + (next.x - point.x) * fraction,
        y: point.y + (next.y - point.y) * fraction,
      } : point }];
  });
}
function recordPosition(agent: Agent, position: Point, tick: number) {
  const previous = agent.path[agent.path.length - 1];
  const offset = tick - agent.start;
  if (previous && previous.x === position.x && previous.y === position.y) return;
  if (previous && offset - agent.pathSteps[agent.pathSteps.length - 1] > 1) {
    // Keep a hold until the last stationary tick, then interpolate the movement.
    agent.path.push(previous);
    agent.pathSteps.push(offset - 1);
  }
  agent.path.push(position);
  agent.pathSteps.push(offset);
}
export function crowdClustersAtStep(simulation: Simulation, step: number) {
  const clusters = new Map<string, { point: Point; count: number }>();
  for (const { agent, point } of agentsAtStep(simulation, step)) {
    const key = `${Math.floor(point.x / 2)}:${Math.floor(point.y / 2)}`;
    const cluster = clusters.get(key);
    if (cluster) cluster.count += agent.weight;
    else clusters.set(key, { point, count: agent.weight });
  }
  return [...clusters.values()];
}
export const CELL = 0.5;
export const STEP = 0.5;
export const MAX_SIMULATED_AGENTS = 1000;
export const RESTROOM_INTERVAL_SECONDS = 60 * 60;
/** Bound the routing grid on very large venues while retaining half-metre detail nearby. */
export const cellSize = (event: FairEvent) =>
  Math.max(CELL, Math.ceil(Math.max(event.width, event.height) / 500 * 2) / 2);
function eventDurationSeconds(event: FairEvent) {
  const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
  return (minutes(event.endTime) - minutes(event.startTime)) * 60;
}
/** Long, busy events use one-second decisions while retaining the fine routing grid. */
export const simulationStepSeconds = (event: FairEvent) => Math.max(cellSize(event),
  event.visitors >= 500 && eventDurationSeconds(event) >= 4 * 60 * 60 ? 1 : STEP);
export const eventDurationSteps = (event: FairEvent) =>
  Math.round(eventDurationSeconds(event) / simulationStepSeconds(event));
const blocksMovement = (item: Item) =>
  item.kind !== "stairs" && item.kind !== "emergency_exit";
const cellId = (p: Point, w: number, cell: number) =>
  Math.floor(p.y / cell) * w + Math.floor(p.x / cell);
const gridCache = new WeakMap<FairEvent, {
  key: string; grid: { w: number; h: number; cell: number; width: number; height: number; blocked: Uint8Array };
}>();
export function gridFor(event: FairEvent) {
  const key = JSON.stringify([event.width, event.height, event.roomRectangles,
    event.items.map(({ x, y, w, h, kind }) => [x, y, w, h, kind])]);
  const cached = gridCache.get(event);
  if (cached?.key === key) return cached.grid;
  const cell = cellSize(event);
  const w = Math.ceil(event.width / cell),
    h = Math.ceil(event.height / cell),
    blocked = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (!pointInRoom(event, Math.min((x + 0.5) * cell, event.width - 0.25),
        Math.min((y + 0.5) * cell, event.height - 0.25))) blocked[y * w + x] = 1;
  for (const rect of event.items.filter(blocksMovement))
    for (
      let y = Math.floor(rect.y / cell);
      y < Math.ceil((rect.y + rect.h) / cell);
      y++
    )
      for (
        let x = Math.floor(rect.x / cell);
        x < Math.ceil((rect.x + rect.w) / cell);
        x++
      )
        if (x >= 0 && x < w && y >= 0 && y < h &&
          (x + 0.5) * cell >= rect.x && (x + 0.5) * cell < rect.x + rect.w &&
          (y + 0.5) * cell >= rect.y && (y + 0.5) * cell < rect.y + rect.h)
          blocked[y * w + x] = 1;
  const grid = { w, h, cell, width: event.width, height: event.height, blocked };
  gridCache.set(event, { key, grid });
  return grid;
}
export function accessPoints(event: FairEvent, item: Item): Point[] {
  const { w, h, cell, blocked } = gridFor(event);
  const pts: Point[] = [];
  for (
    let y = Math.floor(item.y / cell) - 1;
    y <= Math.ceil((item.y + item.h) / cell);
    y++
  )
    for (
      let x = Math.floor(item.x / cell) - 1;
      x <= Math.ceil((item.x + item.w) / cell);
      x++
    ) {
      if (x < 0 || y < 0 || x >= w || y >= h || blocked[y * w + x]) continue;
      if (
        x === Math.floor(item.x / cell) - 1 ||
        x === Math.ceil((item.x + item.w) / cell) ||
        y === Math.floor(item.y / cell) - 1 ||
        y === Math.ceil((item.y + item.h) / cell)
      )
        pts.push({ x: Math.min((x + 0.5) * cell, event.width - 0.25),
          y: Math.min((y + 0.5) * cell, event.height - 0.25) });
    }
  return pts;
}
export function findPath(
  event: FairEvent,
  start: Point,
  targets: Point[],
  crowdCosts?: Float32Array,
): Point[] {
  const { w, h, cell, blocked } = gridFor(event);
  const source = cellId(start, w, cell);
  const goals = new Set(
    targets
      .filter(
        (p) => p.x >= 0 && p.x < event.width && p.y >= 0 && p.y < event.height,
      )
      .map((p) => cellId(p, w, cell)),
  );
  if (
    start.x < 0 ||
    start.y < 0 ||
    start.x >= event.width ||
    start.y >= event.height ||
    blocked[source] ||
    !goals.size
  )
    return [];
  const prev = new Int32Array(w * h).fill(-2);
  prev[source] = -1;
  const queue = new Int32Array(w * h);
  let head = 0,
    tail = 1;
  queue[0] = source;
  // Dijkstra for crowd-weighted routes; retain the fast BFS for simulation calls.
  const distance = new Float64Array(crowdCosts ? w * h : 0).fill(Infinity);
  if (crowdCosts) distance[source] = 0;
  const heap: { id: number; cost: number }[] = [];
  const push = (entry: { id: number; cost: number }) => {
    let i = heap.length;
    heap.push(entry);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].cost <= entry.cost) break;
      heap[i] = heap[parent]; i = parent;
    }
    heap[i] = entry;
  };
  const pop = () => {
    const first = heap[0], last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1].cost < heap[child].cost) child++;
        if (last.cost <= heap[child].cost) break;
        heap[i] = heap[child]; i = child;
      }
      heap[i] = last;
    }
    return first;
  };
  if (crowdCosts) push({ id: source, cost: 0 });
  let goal = -1;
  while (crowdCosts ? heap.length > 0 : head < tail) {
    const entry = crowdCosts ? pop() : { id: queue[head++], cost: 0 };
    const n = entry.id;
    if (crowdCosts && entry.cost > distance[n]) continue;
    if (goals.has(n)) {
      goal = n;
      break;
    }
    const x = n % w,
      y = Math.floor(n / w);
    for (const next of [
      x < w - 1 ? n + 1 : -1,
      y > 0 ? n - w : -1,
      x > 0 ? n - 1 : -1,
      y < h - 1 ? n + w : -1,
    ])
      if (next >= 0 && !blocked[next]) {
        if (crowdCosts) {
          const cost = distance[n] + cell * (1 + 2 * crowdCosts[next]);
          if (cost >= distance[next]) continue;
          distance[next] = cost;
          prev[next] = n;
          push({ id: next, cost });
        } else if (prev[next] === -2) {
          prev[next] = n;
          queue[tail++] = next;
        }
      }
  }
  if (goal < 0) return [];
  const result: Point[] = [];
  for (let n = goal; n !== -1; n = prev[n])
    result.push({
      x: Math.min(((n % w) + 0.5) * cell, event.width - 0.25),
      y: Math.min((Math.floor(n / w) + 0.5) * cell, event.height - 0.25),
    });
  return result.reverse();
}
export function overlaps(a: Item, b: Item) {
  return rectanglesOverlap(a, b);
}
export function validPosition(event: FairEvent, item: Item) {
  return (
    [item.x, item.y, item.w, item.h].every(Number.isFinite) &&
    item.w >= 0.5 && item.h >= 0.5 &&
    rectInsideRoom(event, item) &&
    (item.kind !== "emergency_exit" || onRoomBoundary(event, item)) &&
    !event.items.some((b) => b.id !== item.id && overlaps(item, b)) &&
    !allAccessPoints(event).some(
      (p) => p.x >= item.x && p.x < item.x + item.w &&
        p.y >= item.y && p.y < item.y + item.h,
    )
  );
}
export function inspectLayout(event: FairEvent): Finding[] {
  const result: Finding[] = [];
  const receptions = event.items.filter((item) => item.kind === "reception");
  if (!receptions.length) result.push({ level: "warning", title: "Reception desk required",
    detail: "No reception desk is placed. Every visitor must check in before exploring.",
    suggestion: "Add a reception desk with a clear approach from each entrance." });
  else for (const [index, entrance] of eventEntrances(event).entries()) {
    if (!receptions.some((item) => findPath(event, entrance, boothQueuePoints(event, item).slice(0, 1)).length))
      result.push({ level: "warning", title: `Entrance ${index + 1} cannot reach reception`,
        detail: `Visitors at entrance ${index + 1} have no walkable route to a reception service point.`,
        suggestion: "Leave a clear route to at least one reception desk so arriving visitors can check in." });
  }
  const entrances = eventEntrances(event), exits = eventExits(event);
  for (const [index, entrance] of entrances.entries())
    if (!findPath(event, entrance, exits).length)
      result.push({ level: "warning", title: entrances.length === 1 ? "No route from entrance to exit" : `Entrance ${index + 1} cannot reach an exit`,
        detail: `Entrance ${index + 1} is disconnected from every routine exit.`,
        suggestion: "Open a continuous walkway across the hall before comparing layouts." });
  for (const [index, exit] of exits.entries())
    if (!findPath(event, exit, entrances).length)
      result.push({ level: "warning", title: `Exit ${index + 1} cannot be reached`,
        detail: `No entrance has a continuous route to exit ${index + 1}.`,
        suggestion: "Connect this exit to an entrance so assigned visitors can leave." });
  for (const item of event.items.filter((i) => ["booth", "food", "reception", "restroom", "seating", "stage"].includes(i.kind))) {
    const service = ["booth", "food", "reception", "restroom"].includes(item.kind);
    const targets = service ? boothQueuePoints(event, item).slice(0, 1) : accessPoints(event, item);
    if (!entrances.some((entrance) => findPath(event, entrance, targets).length))
      result.push({
        level: "warning",
        title: `${item.label} is unreachable`,
        detail: `No entrance has a continuous route to ${item.label}${service ? "’s service front" : "’s surrounding floor"}.`,
        suggestion: "Move nearby objects to open a route, then check access again.",
        itemId: item.id,
      });
  }
  for (let i = 0; i < event.items.length; i++)
    for (let j = i + 1; j < event.items.length; j++) {
      const a = event.items[i],
        b = event.items[j];
      if (overlaps(a, b)) {
        result.push({
          level: "warning",
          title: `${a.label} overlaps ${b.label}`,
          detail: `${a.label} and ${b.label} occupy overlapping floor space.`,
          suggestion: "Separate these objects before running the simulation.",
          itemId: a.id,
        });
        continue;
      }
      const gap = Math.hypot(
        Math.max(a.x - b.x - b.w, b.x - a.x - a.w, 0),
        Math.max(a.y - b.y - b.h, b.y - a.y - a.h, 0),
      );
      if (blocksMovement(a) && blocksMovement(b) && gap > 0 && gap < event.clearance)
        result.push({
          level: "warning",
          title: `${a.label} / ${b.label}: ${gap.toFixed(1)} m gap`,
          detail: `The gap is ${gap.toFixed(1)} m, below your ${event.clearance} m planning target. This target is not a code-compliance check.`,
          itemId: a.id,
          suggestion: `Try increasing this gap by ${(event.clearance - gap).toFixed(1)} m, then rerun the simulation.`,
        });
    }
  return result;
}
function random(seed: number) {
  let n = seed;
  return () => {
    n |= 0;
    n = (n + 0x6d2b79f5) | 0;
    let t = Math.imul(n ^ (n >>> 15), 1 | n);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function chooseFlowPoint(points: FlowPoint[], value: number): FlowPoint {
  const total = points.reduce((sum, point) => sum + point.flow, 0);
  let choice = value * total;
  for (const point of points) {
    choice -= point.flow;
    if (choice < 0) return point;
  }
  return points[points.length - 1];
}
/** Pick an audience first, then one competing booth per category. */
export function createRoute(rng: () => number, type: VisitorType, targets: Item[]) {
  const categories = new Map<string, Item[]>();
  for (const item of targets) {
    const key = item.category.trim().toLowerCase() || item.id;
    categories.set(key, [...(categories.get(key) ?? []), item]);
  }
  const remaining = [...categories.values()];
  const fraction = type === "focused" ? 0.45 : type === "explorer" ? 0.75 : 0.50;
  const minimum = Math.ceil(remaining.length * fraction);
  const count = type === "focused" ? minimum : minimum + Math.floor(rng() * (remaining.length - minimum + 1));
  const route: Item[] = [];
  while (route.length < count) {
    const group = remaining.splice(Math.min(remaining.length - 1, Math.floor(rng() * remaining.length)), 1)[0];
    let pick = rng() * group.reduce((sum, item) => sum + item.popularity, 0);
    let index = 0;
    for (; index < group.length - 1; index++) {
      pick -= group[index].popularity;
      if (pick < 0) break;
    }
    route.push(group[index]);
  }
  return route;
}

type Neighbor = QueueBody;
export function calculateSeparation(id: number, position: Point, neighbors: Neighbor[], radius = 2): Point {
  const separation = { x: 0, y: 0 };
  for (const other of neighbors) {
    if (other.id === id) continue;
    let dx = position.x - other.position.x, dy = position.y - other.position.y;
    let distance = Math.hypot(dx, dy);
    const influence = other.footprint ? Math.max(radius, other.footprint.along + 1) : radius;
    if (distance >= influence) continue;
    if (distance < 0.0001) {
      // Opposite deterministic directions also separate coincident visitors.
      const angle = Math.min(id, other.id) * 1.618 + Math.max(id, other.id) * 0.731;
      const sign = id < other.id ? 1 : -1;
      dx = Math.cos(angle) * sign;
      dy = Math.sin(angle) * sign;
      distance = 1;
    }
    const local = other.footprint ? footprintCoordinates({ x: dx, y: dy }, other.footprint, 1) : null;
    const strength = local ? Math.max(0, 1 - Math.hypot(local.x, local.y)) :
      (radius - Math.hypot(position.x - other.position.x, position.y - other.position.y)) / radius;
    separation.x += dx / distance * strength;
    separation.y += dy / distance * strength;
  }
  return separation;
}

type MovementGrid = ReturnType<typeof gridFor>;
const centerOf = (grid: MovementGrid, index: number): Point => ({
  x: Math.min(((index % grid.w) + 0.5) * grid.cell, grid.width - 0.25),
  y: Math.min((Math.floor(index / grid.w) + 0.5) * grid.cell, grid.height - 0.25),
});
const isFree = (grid: MovementGrid, x: number, y: number) =>
  x >= 0 && y >= 0 && x < grid.w && y < grid.h && !grid.blocked[y * grid.w + x];

/** Traverse every crossed cell, including both sides of a diagonal corner. */
function walkableSegment(grid: MovementGrid, from: Point, to: Point) {
  if (from.x < 0 || from.y < 0 || from.x >= grid.width || from.y >= grid.height ||
    to.x < 0 || to.y < 0 || to.x >= grid.width || to.y >= grid.height) return false;
  let x = Math.floor(from.x / grid.cell), y = Math.floor(from.y / grid.cell);
  const endX = Math.floor(to.x / grid.cell), endY = Math.floor(to.y / grid.cell);
  if (x === endX && y === endY) return isFree(grid, x, y);
  if (!isFree(grid, x, y) || !isFree(grid, endX, endY)) return false;
  const dx = to.x - from.x, dy = to.y - from.y;
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const deltaX = dx ? grid.cell / Math.abs(dx) : Infinity;
  const deltaY = dy ? grid.cell / Math.abs(dy) : Infinity;
  let tx = dx ? ((x + (sx > 0 ? 1 : 0)) * grid.cell - from.x) / dx : Infinity;
  let ty = dy ? ((y + (sy > 0 ? 1 : 0)) * grid.cell - from.y) / dy : Infinity;
  while (x !== endX || y !== endY) {
    if (Math.abs(tx - ty) < 1e-9) {
      if (!isFree(grid, x + sx, y) || !isFree(grid, x, y + sy)) return false;
      x += sx; y += sy; tx += deltaX; ty += deltaY;
    } else if (tx < ty) {
      x += sx; tx += deltaX;
    } else {
      y += sy; ty += deltaY;
    }
    if (!isFree(grid, x, y)) return false;
  }
  return true;
}
export const segmentIsWalkable = (event: FairEvent, from: Point, to: Point) =>
  walkableSegment(gridFor(event), from, to);

// Shared distance fields keep routing affordable for large halls and crowds.
export function distanceField(grid: MovementGrid, targets: Point[]) {
  const distances = new Int32Array(grid.w * grid.h).fill(-1);
  const queue = new Int32Array(distances.length);
  let head = 0, tail = 0;
  for (const p of targets) {
    const x = Math.floor(p.x / grid.cell), y = Math.floor(p.y / grid.cell);
    const index = y * grid.w + x;
    if (isFree(grid, x, y) && distances[index] < 0) {
      distances[index] = 0;
      queue[tail++] = index;
    }
  }
  while (head < tail) {
    const n = queue[head++], x = n % grid.w, y = Math.floor(n / grid.w);
    for (const next of [x < grid.w - 1 ? n + 1 : -1, y > 0 ? n - grid.w : -1,
      x > 0 ? n - 1 : -1, y < grid.h - 1 ? n + grid.w : -1]) {
      if (next >= 0 && !grid.blocked[next] && distances[next] < 0) {
        distances[next] = distances[n] + 1;
        queue[tail++] = next;
      }
    }
  }
  return distances;
}
function navigationTarget(grid: MovementGrid, distances: Int32Array, position: Point) {
  let index = cellId(position, grid.w, grid.cell);
  let target = centerOf(grid, index);
  // Look ahead through open aisles, but keep turns around walls walkable.
  for (let i = 0; i < Math.max(2, Math.ceil(2 / grid.cell)) && distances[index] > 0; i++) {
    const x = index % grid.w, y = Math.floor(index / grid.w);
    const next = [x < grid.w - 1 ? index + 1 : -1, y > 0 ? index - grid.w : -1,
      x > 0 ? index - 1 : -1, y < grid.h - 1 ? index + grid.w : -1]
      .find((n) => n >= 0 && distances[n] === distances[index] - 1);
    if (next === undefined) break;
    const candidate = centerOf(grid, next);
    if (!walkableSegment(grid, position, candidate)) break;
    target = candidate;
    index = next;
  }
  return target;
}
const unit = (p: Point): Point => {
  const length = Math.hypot(p.x, p.y);
  return length ? { x: p.x / length, y: p.y / length } : { x: 0, y: 0 };
};
type PauseActivity = { itemId: string; point: Point; field: Int32Array; remaining: number; activity?: "eating" };
type LiveAgent = {
  agent: Agent; position: Point; velocity: Point; rng: () => number;
  routeStep: number; waitingTimes: number[]; waitRemaining: number;
  wanderAngle: number; bestDistance: number; stalledSeconds: number;
  queue?: LiveQueue;
  checkedIn: boolean;
  nextRestroom: number; nextSeat: number; foodInterest: boolean; foodProfile: FoodProfile;
  foodTarget?: { itemId: string; end: number };
  stageInterest: number; stageConsidered: boolean;
  pause?: PauseActivity;
  resumePause?: PauseActivity;

};

type LiveQueue = BoothQueue & { members: LiveAgent[]; fields: Map<number, Int32Array> };

/** The south/bottom edge is the booth front; its service point stays centered. */
export function boothQueuePoints(event: FairEvent, item: Item): Point[] {
  const grid = gridFor(event);
  const offset = Math.max(0.5, grid.cell / 2);
  const fronts = [
    { head: { x: item.x + item.w / 2, y: item.y + item.h + offset }, dx: 0, dy: 1 },
    { head: { x: item.x + item.w / 2, y: item.y - offset }, dx: 0, dy: -1 },
    { head: { x: item.x - offset, y: item.y + item.h / 2 }, dx: -1, dy: 0 },
    { head: { x: item.x + item.w + offset, y: item.y + item.h / 2 }, dx: 1, dy: 0 },
  ];
  // Reception and facilities can serve from another side when placed against a wall.
  const candidates = (item.kind === "booth" ? fronts.slice(0, 1) : fronts)
    .filter(({ head }) => walkableSegment(grid, head, head));
  const front = item.kind === "booth" ? candidates[0] : candidates.find(({ head }) =>
    eventEntrances(event).some((entrance) => findPath(event, entrance, [head]).length)) ?? candidates[0];
  if (!front) return [];
  const { head, dx, dy } = front;
  const points = [head], spacing = Math.max(0.8, grid.cell);
  for (let i = 1; i <= Math.floor(12 / spacing); i++) {
    const next = { x: head.x + dx * i * spacing, y: head.y + dy * i * spacing };
    if (!walkableSegment(grid, points[points.length - 1], next)) break;
    points.push(next);
  }
  return points;
}

/** A spread of walkable viewing positions within four meters of a stage. */
export function stageAudiencePoints(event: FairEvent, item: Item): Point[] {
  const grid = gridFor(event), { w, h, cell, blocked } = grid;
  const edges = accessPoints(event, item);
  const candidates: Point[] = [];
  for (let y = Math.max(0, Math.floor((item.y - 4) / cell)); y < Math.min(h, Math.ceil((item.y + item.h + 4) / cell)); y++) {
    for (let x = Math.max(0, Math.floor((item.x - 4) / cell)); x < Math.min(w, Math.ceil((item.x + item.w + 4) / cell)); x++) {
      if (blocked[y * w + x]) continue;
      const point = centerOf(grid, y * w + x);
      const dx = Math.max(item.x - point.x, point.x - item.x - item.w, 0);
      const dy = Math.max(item.y - point.y, point.y - item.y - item.h, 0);
      if (Math.hypot(dx, dy) > 4 || (!dx && !dy)) continue;
      const nearest = edges.reduce<Point | undefined>((best, edge) => !best ||
        Math.hypot(edge.x - point.x, edge.y - point.y) < Math.hypot(best.x - point.x, best.y - point.y) ? edge : best, undefined);
      if (nearest && walkableSegment(grid, point, nearest)) candidates.push(point);
    }
  }
  // Cap distance-field memory while distributing the audience across the viewing area.
  return candidates.filter((_, index) => index % Math.max(1, Math.ceil(candidates.length / 12)) === 0);
}

export function simulate(event: FairEvent, onProgress?: (percent: number) => void,
  fastSampling = false): Simulation {
  onProgress?.(0);
  const active = event.items.filter(
    (x) => ["food", "reception", "restroom"].includes(x.kind) || (x.kind === "booth" && x.company),
  );
  const grid = gridFor(event), { w, h, cell } = grid;
  const stepSeconds = simulationStepSeconds(event);
  const duration = eventDurationSteps(event);
  const arrivalWindow = duration - Math.min(Math.round(1800 / stepSeconds), Math.floor(duration / 4));
  const nominalSamples = Math.min(event.visitors, MAX_SIMULATED_AGENTS,
    Math.max(100, Math.floor(120000 / (w + h))));
  // Organizer previews use fewer weighted representatives in busy runs while
  // retaining the full attendance, event clock, and the same movement rules.
  const sampleCount = fastSampling && nominalSamples >= 400
    ? Math.max(100, Math.ceil(nominalSamples * 0.7)) : nominalSamples;
  const profiles = Object.keys(visitorProfiles) as VisitorType[];
  const queues = new Map<string, LiveQueue>(active.map((item) => {
    const points = boothQueuePoints(event, item);
    return [item.id, { itemId: item.id, points, members: [],
      fields: new Map([[0, distanceField(grid, points.slice(0, 1))]]) }];
  }));
  function queueField(queue: LiveQueue, slot: number) {
    if (!queue.fields.has(slot)) queue.fields.set(slot, distanceField(grid, [queue.points[slot]]));
    return queue.fields.get(slot)!;
  }
  const entrances = eventEntrances(event), exits = eventExits(event);
  const exitFields = new Map(exits.map((point) => [point.id, distanceField(grid, [point])]));
  const arrivalRadius = Math.min(0.3, cell * 0.45), separationRadius = 2;
  let walk = 0, visits = 0, missed = 0, stranded = 0, finished = 0;

  const items = new Map(event.items.map((item) => [item.id, item]));
  const booths = active.filter((item) => item.kind === "booth");
  const receptions = active.filter((item) => item.kind === "reception");
  const restrooms = active.filter((item) => item.kind === "restroom");
  const seating = event.items.filter((item) => item.kind === "seating");
  const foods = active.filter((item) => item.kind === "food");
  const stages = event.items.filter((item) => item.kind === "stage");
  const stagePoints = new Map(stages.map((item) => [item.id, stageAudiencePoints(event, item)]));
  const stageFields = new Map(stages.map((item) => [item.id, distanceField(grid, stagePoints.get(item.id)!)]));
  const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
  const foodWindows = new Map(foods.map((item) => [item.id, foodAvailabilityFor(item, event).map((window) => ({
    start: (minutes(window.start) - minutes(event.startTime)) * 60,
    end: (minutes(window.end) - minutes(event.startTime)) * 60,
  }))]));
  const pauseFields = new Map<string, Int32Array>();
  const pausePoints = new Map<string, Point[]>();
  const receptionLoad = new Map<string, number>();
  const visitLength = (visitor: LiveAgent, item: Item) => Math.max(1,
    Math.round((item.kind === "stage" ? stageLingeringFor(item) : item.dwell) * (0.7 + visitor.rng() * 0.6) * visitorProfiles[visitor.agent.type].waitFactor / stepSeconds));

  function createAgents(): LiveAgent[] {
    return Array.from({ length: sampleCount }, (_, id) => {
      const rng = random(1000 + id * 97);
      const start = Math.floor(rng() * arrivalWindow);
      const source = chooseFlowPoint(entrances, rng());
      const destination = chooseFlowPoint(exits, rng());
      const entrance = centerOf(grid, cellId(source, w, cell));
      const type = profiles[Math.floor(rng() * profiles.length)];
      let route = createRoute(rng, type, booths);
      const weight = Math.floor(event.visitors / sampleCount) + (id < event.visitors % sampleCount ? 1 : 0);
      const reception = receptions.map((item) => ({ item, distance: queueField(queues.get(item.id)!, 0)[cellId(source, w, cell)] }))
        .filter(({ distance }) => distance >= 0)
        .sort((a, b) => (a.distance * cell + (receptionLoad.get(a.item.id) ?? 0) * 60 / processingRateFor(a.item)) -
          (b.distance * cell + (receptionLoad.get(b.item.id) ?? 0) * 60 / processingRateFor(b.item)))[0]?.item;
      if (reception) {
        route.unshift(reception);
        receptionLoad.set(reception.id, (receptionLoad.get(reception.id) ?? 0) + weight);
      }
      // Draw all preferences before geometry checks, keeping comparisons fair.
      let waitingTimes = route.map((item) => Math.max(1,
        Math.round(item.dwell * (0.7 + rng() * 0.6) * visitorProfiles[type].waitFactor / stepSeconds)));
      if (reception && route.length > 2) {
        const dwellById = new Map(route.map((item, index) => [item.id, waitingTimes[index]]));
        const ordered = orderNearbyBooths(route.slice(1), queues.get(reception.id)!.points[0],
          random(15485863 + id * 193),
          (from, target) => {
            const distance = queueField(queues.get(target.id)!, 0)[cellId(from, w, cell)];
            return distance >= 0 ? distance * cell : Infinity;
          },
          (target) => queues.get(target.id)!.points[0]);
        route = [reception, ...ordered];
        waitingTimes = route.map((item) => dwellById.get(item.id)!);
      }
      const spawnAngle = rng() * Math.PI * 2;
      const spawnDistance = Math.sqrt(rng()) * Math.min(1, cell);
      const candidate = { x: entrance.x + Math.cos(spawnAngle) * spawnDistance,
        y: entrance.y + Math.sin(spawnAngle) * spawnDistance };
      const position = walkableSegment(grid, entrance, candidate) ? candidate : entrance;
      const wanderAngle = rng() * Math.PI * 2;
      const agent: Agent = { id, start, path: [], pathSteps: [], endStep: duration, queueVisits: [], pauses: [], type,
        entranceId: source.id, exitId: destination.id,
        route: route.map((item) => item.id), weight, state: reception ? "moving" : "stranded" };
      if (!reception || exitFields.get(destination.id)![cellId(source, w, cell)] < 0) stranded += agent.weight;
      // Preserve the existing seating and food preference draws when fixing restroom timing.
      rng();
      return { agent, position, velocity: { x: Math.cos(wanderAngle), y: Math.sin(wanderAngle) },
        rng, routeStep: 0, waitingTimes, waitRemaining: 0, wanderAngle,
        bestDistance: Infinity, stalledSeconds: 0, checkedIn: false,
        nextRestroom: start + RESTROOM_INTERVAL_SECONDS / stepSeconds,
        nextSeat: start + (3 + rng() * 4) * 60 / stepSeconds,
        foodInterest: rng() < 0.8, foodProfile: createFoodProfile(id, start * stepSeconds),
        stageInterest: random(7919 + id * 101)(), stageConsidered: false };
    });
  }
  const visitors = createAgents();
  const agents = visitors.map((v) => v.agent);
  const arrivals = [...visitors].sort((a, b) => a.agent.start - b.agent.start || a.agent.id - b.agent.id);
  let present: LiveAgent[] = [], nextArrival = 0;
  const stationaryBodies: Neighbor[] = [];
  let spatialCellSize = separationRadius;
  let bucketColumns = 0;
  const buckets: Neighbor[][] = [];
  const occupiedBuckets: number[] = [];
  const bodyCache = new Map<number, { position: Point; velocity: Point; people: number; body: Neighbor }>();
  function bodyFor(visitor: LiveAgent, tick: number): Neighbor {
    const visit = visitor.queue ? visitor.agent.queueVisits.at(-1) : undefined;
    const people = visit ? queuePeopleRemaining(visitor.agent.weight, visit, tick) : visitor.agent.weight;
    const cached = bodyCache.get(visitor.agent.id);
    if (cached && cached.position === visitor.position && cached.velocity === visitor.velocity &&
      cached.people === people && cached.body.queueId === visitor.queue?.itemId) return cached.body;
    const initial = crowdFootprint(people, !!visit, visitor.velocity);
    const free = footprintFreeFraction(visitor.position, initial,
      (point) => walkableSegment(grid, visitor.position, point));
    const body = { id: visitor.agent.id, position: visitor.position, queueId: visitor.queue?.itemId,
      footprint: crowdFootprint(people, !!visit, visitor.velocity, free) };
    bodyCache.set(visitor.agent.id, { position: visitor.position, velocity: visitor.velocity, people, body });
    return body;
  }
  function indexBody(body: Neighbor) {
    const reach = Math.max(separationRadius, (body.footprint?.along ?? 0) + 1);
    const minX = Math.max(0, Math.floor((body.position.x - reach) / spatialCellSize));
    const maxX = Math.min(Math.floor(event.width / spatialCellSize), Math.floor((body.position.x + reach) / spatialCellSize));
    const minY = Math.max(0, Math.floor((body.position.y - reach) / spatialCellSize));
    const maxY = Math.min(Math.floor(event.height / spatialCellSize), Math.floor((body.position.y + reach) / spatialCellSize));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const key = y * bucketColumns + x;
      const entries = buckets[key] ?? (buckets[key] = []);
      if (!entries.length) occupiedBuckets.push(key);
      entries.push(body);
    }
  }

  function advanceRoute(visitor: LiveAgent) {
    visitor.routeStep++;
    visitor.bestDistance = Infinity;
    visitor.stalledSeconds = 0;
    visitor.agent.state = visitor.routeStep < visitor.agent.route.length ? "moving" : "exiting";
  }
  function beginPause(visitor: LiveAgent, item: Item, remaining: number, activity?: "eating") {
    const key = `${item.id}:${activity ?? "rest"}`;
    let points = pausePoints.get(key);
    if (!points) {
      // The available floor is fixed for a run; only each visitor's reachability varies.
      const head = queues.get(item.id)?.points[0];
      const perimeter = (item.kind === "stage" ? stagePoints.get(item.id)! :
        activity === "eating" && item.kind === "food" ? stageAudiencePoints(event, item)
          .filter((point) => !queues.get(item.id)!.points.some((slot) => Math.hypot(point.x - slot.x, point.y - slot.y) < 1)) :
          accessPoints(event, item)).filter((point) => !head || Math.hypot(point.x - head.x, point.y - head.y) > 1);
      // Bound field memory even for very large objects.
      points = perimeter.filter((_, index) => index % Math.max(1, Math.ceil(perimeter.length / (item.kind === "stage" ? 12 : 8))) === 0);
      pausePoints.set(key, points);
    }
    const reachable = points.filter((point) => {
      const key = `${point.x}:${point.y}`;
      if (!pauseFields.has(key)) pauseFields.set(key, distanceField(grid, [point]));
      return pauseFields.get(key)![cellId(visitor.position, w, cell)] >= 0;
    });
    if (!reachable.length) return false;
    const point = reachable[Math.floor(visitor.rng() * reachable.length)];
    visitor.pause = { itemId: item.id, point, field: pauseFields.get(`${point.x}:${point.y}`)!, remaining, activity };
    visitor.agent.state = "moving";
    visitor.bestDistance = Infinity;
    return true;
  }
  function insertStop(visitor: LiveAgent, item: Item) {
    visitor.agent.route.splice(visitor.routeStep, 0, item.id);
    visitor.waitingTimes.splice(visitor.routeStep, 0, visitLength(visitor, item));
    visitor.agent.state = "moving";
    visitor.bestDistance = Infinity;
  }
  function nearestReachable(visitor: LiveAgent, choices: Item[]) {
    const index = cellId(visitor.position, w, cell);
    return choices.map((item) => ({ item, distance: queues.has(item.id)
      ? queueField(queues.get(item.id)!, 0)[index]
      : stageFields.has(item.id) ? stageFields.get(item.id)![index]
      : findPath(event, visitor.position, accessPoints(event, item)).length - 1 }))
      .filter(({ distance }) => distance >= 0).sort((a, b) => a.distance - b.distance)[0]?.item;
  }
  function chooseFood(visitor: LiveAgent, tick: number) {
    const now = tick * stepSeconds;
    if (!visitor.foodInterest || visitor.foodTarget || visitor.pause?.activity === "eating" ||
      now < visitor.foodProfile.nextMeal) return undefined;
    const index = cellId(visitor.position, w, cell);
    const choices = foods.flatMap((item) => {
      const window = foodWindows.get(item.id)!.find((window) =>
        now >= mealReadyAt(visitor.foodProfile, window) && now < window.end);
      if (!window) return [];
      const queue = queues.get(item.id)!;
      const distance = queueField(queue, 0)[index];
      if (distance < 0) return [];
      const walking = distance * cell / visitorProfiles[visitor.agent.type].speedFactor;
      if (now + walking >= window.end) return [];
      const service = 60 / processingRateFor(item);
      const waiting = queue.members.reduce((total, member) => total +
        (member.agent.state === "waiting" ? member.waitRemaining * stepSeconds : member.agent.weight * service), 0);
      return [{ item, window, cost: foodChoiceCost(visitor.foodProfile, item.id, walking, waiting, service) }];
    }).sort((a, b) => a.cost - b.cost || a.item.id.localeCompare(b.item.id));
    const choice = choices[0];
    if (choice) {
      visitor.foodTarget = { itemId: choice.item.id, end: choice.window.end / stepSeconds };
    }
    return choice?.item;
  }
  function beginEating(visitor: LiveAgent, food: Item) {
    const remaining = Math.ceil(visitor.foodProfile.eatingSeconds / stepSeconds);
    const seat = nearestReachable(visitor, seating);
    if (seat && beginPause(visitor, seat, remaining, "eating")) return;
    if (beginPause(visitor, food, remaining, "eating")) return;
    // In a fully constrained layout retain eating time at the current reachable position.
    visitor.pause = { itemId: food.id, point: visitor.position,
      field: distanceField(grid, [visitor.position]), remaining, activity: "eating" };
    visitor.agent.state = "moving";
  }
  function resumeActivity(visitor: LiveAgent) {
    if (visitor.resumePause) {
      visitor.pause = visitor.resumePause;
      visitor.resumePause = undefined;
      visitor.agent.state = "moving";
    }
  }
  function updateAgent(visitor: LiveAgent, getNeighbors: () => Neighbor[], tick: number,
    queueSnapshot: Map<string, LiveAgent[]>, joinedThisTick: Set<string>) {
    const { agent } = visitor;
    // Stop heading to a closed station. Visitors already in line finish service.
    if (visitor.foodTarget && !visitor.queue && tick >= visitor.foodTarget.end) {
      visitor.foodTarget = undefined;
      advanceRoute(visitor);
      resumeActivity(visitor);
    }
    // Each meal draws people who are browsing or resting, as well as walkers.
    if (visitor.checkedIn && visitor.pause) {
      const food = chooseFood(visitor, tick);
      if (food) {
        if (agent.state === "pausing") agent.pauses.at(-1)!.end = tick;
        visitor.resumePause = visitor.pause;
        visitor.pause = undefined;
        insertStop(visitor, food);
      }
    }
    if (visitor.checkedIn && visitor.pause && visitor.pause.activity !== "eating" && restrooms.length && tick >= visitor.nextRestroom) {
      const restroom = nearestReachable(visitor, restrooms);
      visitor.nextRestroom = restroom ? Infinity : tick + RESTROOM_INTERVAL_SECONDS / stepSeconds;
      if (restroom) {
        if (agent.state === "pausing") agent.pauses.at(-1)!.end = tick;
        visitor.resumePause = visitor.pause;
        visitor.pause = undefined;
        insertStop(visitor, restroom);
      }
    }
    if (agent.state === "pausing") {
      visitor.pause!.remaining--;
      if (visitor.pause!.remaining <= 0) {
        const eating = visitor.pause!.activity === "eating";
        agent.pauses.at(-1)!.end = tick;
        if (items.get(visitor.pause!.itemId)?.kind === "seating")
          visitor.nextSeat = tick + (8 + visitor.rng() * 7) * 60 / stepSeconds;
        if (!eating && items.get(visitor.pause!.itemId)?.kind === "booth") visits += agent.weight;
        visitor.pause = undefined;
        advanceRoute(visitor);
        if (eating) {
          visitor.foodProfile.nextMeal = tick * stepSeconds + visitor.foodProfile.mealInterval;
          resumeActivity(visitor);
        }
      }
      return;
    }
    if (agent.state === "waiting") {
      visitor.waitRemaining--;
      if (visitor.waitRemaining <= 0) {
        const item = items.get(visitor.queue!.itemId)!;
        agent.queueVisits.at(-1)!.departed = tick;
        visitor.queue!.members.shift();
        visitor.queue = undefined;
        if (item.kind === "reception") visitor.checkedIn = true;
        if (item.kind === "restroom") visitor.nextRestroom = tick + RESTROOM_INTERVAL_SECONDS / stepSeconds;
        const browsing = visitor.waitingTimes[visitor.routeStep] - 60 / processingRateFor(item) / stepSeconds;
        if (item.kind === "booth" && browsing > 0 && beginPause(visitor, item, Math.ceil(browsing))) return;
        if (item.kind === "booth" || item.kind === "food") visits += agent.weight;
        if (item.kind === "food") {
          visitor.foodTarget = undefined;
          beginEating(visitor, item);
          return;
        }
        advanceRoute(visitor);
        if (item.kind === "restroom") resumeActivity(visitor);
      }
      return;
    }
    if (visitor.checkedIn && !visitor.queue && !visitor.pause) {
      const food = chooseFood(visitor, tick);
      if (food) {
        insertStop(visitor, food);
      } else if (!visitor.foodTarget && !visitor.stageConsidered && stages.length && !visitor.resumePause) {
        visitor.stageConsidered = true;
        const stage = nearestReachable(visitor, stages.filter((item) =>
          visitor.stageInterest < stageSpotlightFor(item) / 100));
        if (stage) insertStop(visitor, stage);
      } else if (!visitor.foodTarget && restrooms.length && tick >= visitor.nextRestroom && visitor.routeStep < agent.route.length) {
        const restroom = nearestReachable(visitor, restrooms);
        visitor.nextRestroom = restroom ? Infinity : tick + RESTROOM_INTERVAL_SECONDS / stepSeconds;
        if (restroom) insertStop(visitor, restroom);
      } else if (!visitor.foodTarget && seating.length && tick >= visitor.nextSeat && visitor.routeStep < agent.route.length) {
        visitor.nextSeat = tick + (8 + visitor.rng() * 7) * 60 / stepSeconds;
        const seat = nearestReachable(visitor, seating);
        if (seat) insertStop(visitor, seat);
      }
    }
    const index = cellId(visitor.position, w, cell);
    const item = items.get(agent.route[visitor.routeStep]);
    if (!visitor.pause && (item?.kind === "seating" || item?.kind === "stage") && !beginPause(visitor, item, visitor.waitingTimes[visitor.routeStep])) {
      missed += agent.weight;
      advanceRoute(visitor);
    }
    let queue = !visitor.pause && visitor.routeStep < agent.route.length ? queues.get(agent.route[visitor.routeStep]) : undefined;
    // Mandatory check-in cannot be skipped when the desk is inaccessible.
    while (queue && queueField(queue, 0)[index] < 0) {
      if (items.get(queue.itemId)?.kind === "reception") {
        agent.state = "stranded";
        stranded += agent.weight;
        return;
      }
      missed += agent.weight;
      advanceRoute(visitor);
      queue = visitor.routeStep < agent.route.length ? queues.get(agent.route[visitor.routeStep]) : undefined;
    }
    const members = queue ? queueSnapshot.get(queue.itemId)! : [];
    const memberIndex = visitor.queue ? members.indexOf(visitor) : members.length;
    // Larger representative groups reserve more of the line's length.
    const reservedSlot = members.slice(0, memberIndex).reduce((slots, member) => {
      const visit = member.agent.queueVisits.at(-1)!;
      const count = queuePeopleRemaining(member.agent.weight, visit, tick);
      return slots + Math.max(1, Math.ceil(Math.sqrt(count)));
    }, 0);
    const slot = queue ? Math.min(reservedSlot, queue.points.length - 1) : 0;
    const field = visitor.pause?.field ?? (queue ? queueField(queue, slot) : exitFields.get(agent.exitId)!);
    if (field[index] < 0) {
      agent.state = "stranded";
      return;
    }
    const destination = visitor.pause?.point ?? queue?.points[slot];
    const target = destination && walkableSegment(grid, visitor.position, destination) ? destination :
      navigationTarget(grid, field, visitor.position);
    const offset = { x: target.x - visitor.position.x, y: target.y - visitor.position.y };
    const distance = Math.hypot(offset.x, offset.y);
    const atDestination = destination ? Math.hypot(destination.x - visitor.position.x,
      destination.y - visitor.position.y) <= 0.06 : field[index] === 0 && distance <= arrivalRadius;
    if (atDestination) {
      if (visitor.pause) {
        agent.pauses.push({ itemId: visitor.pause.itemId, start: tick, end: null, activity: visitor.pause.activity });
        agent.state = "pausing";
      } else if (!queue) {
        walk += distance * agent.weight;
        visitor.position = target;
        agent.state = "finished";
        finished += agent.weight;
      } else if (!visitor.queue) {
        // Admit in arrival order at the tail; one reservation per booth per tick.
        if (reservedSlot < queue.points.length && !joinedThisTick.has(queue.itemId)) {
          joinedThisTick.add(queue.itemId);
          queue.members.push(visitor);
          visitor.queue = queue;
          agent.state = "queueing";
          agent.queueVisits.push({ itemId: queue.itemId, joined: tick, serviceStart: null, serviceEnd: null, departed: null });
        }
      } else if (slot === 0) {
        agent.state = "waiting";
        const serving = items.get(queue.itemId)!;
        const seconds = serving.kind === "restroom" ? 90 : 60 / processingRateFor(serving);
        visitor.waitRemaining = Math.max(1, Math.ceil(seconds * agent.weight / stepSeconds));
        agent.queueVisits[agent.queueVisits.length - 1].serviceStart = tick;
        agent.queueVisits[agent.queueVisits.length - 1].serviceEnd = tick + visitor.waitRemaining;
      }
      return;
    }
    const remaining = field[index] * cell + distance;
    if (remaining < visitor.bestDistance - 0.02) {
      visitor.bestDistance = remaining;
      visitor.stalledSeconds = 0;
    } else visitor.stalledSeconds += stepSeconds;
    const profile = visitorProfiles[agent.type];
    const attraction = unit(offset);
    // Waiting, resting, and already-arrived visitors do not need collision checks.
    const neighbors = getNeighbors();
    const separation = calculateSeparation(agent.id, visitor.position, neighbors, separationRadius);
    visitor.wanderAngle += (visitor.rng() * 0.7 - 0.35) * Math.sqrt(stepSeconds / STEP);
    const wander = 0.30 * profile.wanderFactor;
    const arrivalEase = destination ? Math.min(1, distance / 1.5) :
      field[index] === 0 ? Math.min(1, distance / cell) : 1;
    const desired = unit({
      x: attraction.x + (separation.x * 1.8 + Math.cos(visitor.wanderAngle) * wander) * arrivalEase,
      y: attraction.y + (separation.y * 1.8 + Math.sin(visitor.wanderAngle) * wander) * arrivalEase,
    });
    const inertia = Math.pow(0.65, stepSeconds / STEP);
    let direction = unit({ x: visitor.velocity.x * inertia + desired.x * (1 - inertia),
      y: visitor.velocity.y * inertia + desired.y * (1 - inertia) });
    // People in line advance straight toward their slot without wandering or overtaking.
    if (visitor.queue || distance < 0.6 || visitor.stalledSeconds >= 8) direction = attraction;
    const baseDistance = Math.min(profile.speedFactor * stepSeconds, distance);
    const slowdown = visitor.queue ? 1 : queueSpeedFactor(visitor.position, attraction, neighbors, agent.id);
    const allowedDistance = baseDistance * slowdown;
    function attempt(candidateDirection: Point) {
      if (Math.hypot(candidateDirection.x, candidateDirection.y) < 0.99) return null;
      const length = queueSafeDistance(visitor.position, candidateDirection, allowedDistance, neighbors, agent.id, queue?.itemId);
      const point = { x: visitor.position.x + candidateDirection.x * length,
        y: visitor.position.y + candidateDirection.y * length };
      return walkableSegment(grid, visitor.position, point) ? { point, direction: candidateDirection, length } : null;
    }
    let move = attempt(direction);
    if (!move || move.length < allowedDistance * 0.8) {
      // Try walking around a queue. All alternatives retain its slowdown and body clearance.
      const angles = visitor.queue ? [0] : [0, Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2];
      for (const angle of angles) {
        const candidate = attempt({ x: attraction.x * Math.cos(angle) - attraction.y * Math.sin(angle),
          y: attraction.x * Math.sin(angle) + attraction.y * Math.cos(angle) });
        if (candidate && (!move || candidate.length > move.length + 0.01)) move = candidate;
      }
    }
    if (move && move.length > 0.00001) {
      walk += move.length * agent.weight;
      visitor.position = move.point;
      visitor.velocity = move.direction;
    }
  }

  let lastProgress = performance.now();
  for (let tick = 0; tick < duration; tick++) {
    if (onProgress && tick % 128 === 0 && performance.now() - lastProgress >= 200) {
      onProgress(Math.floor(tick / duration * 85));
      lastProgress = performance.now();
    }
    // Skip empty periods without changing arrivals or the event clock.
    if (!present.length && nextArrival < arrivals.length) tick = Math.max(tick, arrivals[nextArrival].agent.start);
    if (tick >= duration) break;
    while (nextArrival < arrivals.length && arrivals[nextArrival].agent.start <= tick)
      present.push(arrivals[nextArrival++]);
    if (!present.length) break;
    // One immutable position snapshot for this tick, indexed by nearby 2 m patches.
    const queueSnapshot = new Map([...queues].map(([id, queue]) => [id, [...queue.members]]));
    const joinedThisTick = new Set<string>();
    // Reuse bucket storage, clearing every previous entry even if the cell size changes.
    for (const key of occupiedBuckets) buckets[key].length = 0;
    occupiedBuckets.length = 0;
    const bodies = [...present.map((visitor) => bodyFor(visitor, tick)), ...stationaryBodies];
    // Large representative groups need large lookup cells, not thousands of copies per body.
    spatialCellSize = bodies.reduce((size, body) => Math.max(size, (body.footprint?.along ?? 0) + 1), separationRadius);
    bucketColumns = Math.floor(event.width / spatialCellSize) + 1;
    for (const body of bodies) indexBody(body);
    for (const visitor of present) {
      if (tick > visitor.agent.start) {
        const x = Math.floor(visitor.position.x / spatialCellSize), y = Math.floor(visitor.position.y / spatialCellSize);
        const key = y * bucketColumns + x;
        const patchX = Math.floor(visitor.position.x / separationRadius), patchY = Math.floor(visitor.position.y / separationRadius);
        const getNeighbors = () => (buckets[key] ?? []).filter((other) => {
          if (other.id === visitor.agent.id) return false;
          const reach = Math.max(separationRadius, (other.footprint?.along ?? 0) + 1);
          return patchX >= Math.floor((other.position.x - reach) / separationRadius) &&
            patchX <= Math.floor((other.position.x + reach) / separationRadius) &&
            patchY >= Math.floor((other.position.y - reach) / separationRadius) &&
            patchY <= Math.floor((other.position.y + reach) / separationRadius) &&
            walkableSegment(grid, visitor.position, other.position);
        });
        if (visitor.agent.state !== "stranded") updateAgent(visitor, getNeighbors, tick, queueSnapshot, joinedThisTick);
      }
      recordPosition(visitor.agent, visitor.position, tick);
      if (visitor.agent.state === "finished") visitor.agent.endStep = tick + 1;
    }
    for (const visitor of present.filter((v) => v.agent.state === "stranded")) {
      stationaryBodies.push(bodyFor(visitor, tick));
    }
    present = present.filter((v) => v.agent.state !== "finished" && v.agent.state !== "stranded");
  }
  onProgress?.(85);
  const heat = new Array(w * h).fill(0);
  let peak = 0,
    hotspot = { x: 0, y: 0 };
  const binsW = Math.ceil(event.width / 2);
  // Occupancy intervals avoid allocating a map for every tick in a long event.
  const binChanges = new Map<number, Map<number, number>>();
  const localChanges = new Map<number, { point: Point; weight: number }[]>();
  function changeLocal(time: number, point: Point, weight: number) {
    const changes = localChanges.get(time) ?? [];
    changes.push({ point, weight });
    localChanges.set(time, changes);
  }
  function occupy(bin: number, start: number, end: number, weight: number) {
    const changes = binChanges.get(bin) ?? new Map<number, number>();
    changes.set(start, (changes.get(start) ?? 0) + weight);
    changes.set(end, (changes.get(end) ?? 0) - weight);
    binChanges.set(bin, changes);
  }
  for (const a of agents) {
    for (let index = 0; index < a.path.length; index++) {
      const p = a.path[index], start = a.start + a.pathSteps[index];
      const end = index + 1 < a.path.length ? a.start + a.pathSteps[index + 1] : a.endStep;
      heat[cellId(p, w, cell)] += (end - start) * stepSeconds * a.weight;
      const bin = Math.floor(p.y / 2) * binsW + Math.floor(p.x / 2);
      occupy(bin, start, end, a.weight);
      changeLocal(start, p, a.weight);
      changeLocal(end, p, -a.weight);
    }
  }
  for (const [bin, changes] of binChanges) {
    let amount = 0;
    for (const [, change] of [...changes].sort((a, b) => a[0] - b[0])) {
      amount += change;
      if (amount > peak) {
        peak = amount;
        hotspot = { x: (bin % binsW) * 2, y: Math.floor(bin / binsW) * 2 };
      }
    }
  }
  onProgress?.(90);
  const localCounts = new Float64Array(w * h);
  const peakLocalDensity = new Array(w * h).fill(0);
  for (const [, changes] of [...localChanges].sort((a, b) => a[0] - b[0])) {
    const touched = new Set<number>();
    for (const { point, weight } of changes) {
      const minX = Math.max(0, Math.floor((point.x - 1) / cell) - 1);
      const maxX = Math.min(w - 1, Math.ceil((point.x + 1) / cell));
      const minY = Math.max(0, Math.floor((point.y - 1) / cell) - 1);
      const maxY = Math.min(h - 1, Math.ceil((point.y + 1) / cell));
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const centerX = (x + 0.5) * cell, centerY = (y + 0.5) * cell;
        if (Math.abs(point.x - centerX) >= 1 || Math.abs(point.y - centerY) >= 1) continue;
        const index = y * w + x;
        localCounts[index] += weight;
        touched.add(index);
      }
    }
    for (const index of touched)
      peakLocalDensity[index] = Math.max(peakLocalDensity[index], localCounts[index] / 4);
  }
  for (let i = 0; i < heat.length; i++)
    heat[i] /= duration * stepSeconds * cell * cell;
  onProgress?.(95);
  const findings = inspectLayout(event);
  for (const item of active) {
    const field = queueField(queues.get(item.id)!, 0);
    if (!entrances.some((point) => field[cellId(point, w, cell)] >= 0))
      findings.push({ level: "warning", title: `${item.label}: front queue is blocked`,
        detail: "Open a walkway to the object’s service side so visitors can join its queue.",
        itemId: item.id });
  }
  for (const stage of stages) {
    if (stageSpotlightFor(stage) > 0 && !entrances.some((point) => stageFields.get(stage.id)![cellId(point, w, cell)] >= 0))
      findings.push({ level: "warning", title: `${stage.label}: audience area is blocked`,
        detail: "Open a walkway around the stage so visitors can gather nearby.", itemId: stage.id });
  }
  if (booths.length === 0 && foods.length === 0 && stages.every((stage) => stageSpotlightFor(stage) === 0))
    findings.push({
      level: "info",
      title: "No exhibitors yet",
      detail:
        "Book a booth, add a food station, or turn on a stage spotlight to give visitors a destination.",
    });
  if (peak > 0) {
    const nearest = [...active, ...stages].reduce<Item | undefined>(
      (best, i) =>
        !best ||
        Math.hypot(i.x + i.w / 2 - hotspot.x, i.y + i.h / 2 - hotspot.y) <
          Math.hypot(
            best.x + best.w / 2 - hotspot.x,
            best.y + best.h / 2 - hotspot.y,
          )
          ? i
          : best,
      undefined,
    );
    findings.push({
      level: "info",
      title: `Estimated busiest patch: ${peak.toLocaleString()} visitors`,
      detail: `Estimated simultaneous count in one 2 × 2 m patch${nearest ? ` near ${nearest.company || nearest.name}` : ""}. Try distributing popular booths and compare again.`,
      itemId: nearest?.id,
    });
  }
  return {
    agents,
    totalVisitors: event.visitors,
    queues: [...queues.values()].map(({ itemId, points }) => ({ itemId, points })),
    queueWait: (() => {
      let seconds = 0, people = 0;
      for (const agent of agents) for (const visit of agent.queueVisits) {
        seconds += queueWaitPersonSteps(agent.weight, visit, duration) * stepSeconds;
        people += agent.weight;
      }
      return people ? Math.round(seconds / people) : 0;
    })(),
    heat,
    peakLocalDensity,
    cell,
    stepSeconds,
    duration,
    peak,
    walk: event.visitors ? Math.round(walk / event.visitors) : 0,
    visits,
    missed,
    stranded,
    finished,
    hotspot,
    findings,
  };
}
export type VisitorStop = { item: Item; point: Point; crowd: number };

// A planning estimate, not live occupancy. Wider/longer visits and slower
// service create more pressure around an attraction's accessible perimeter.
export function visitorCrowdCosts(event: FairEvent, simulation?: Simulation | null) {
  const { w, h, cell } = gridFor(event);
  const costs = new Float32Array(w * h);
  if (simulation && simulation.cell === cell && simulation.peakLocalDensity.length === costs.length) {
    costs.set(simulation.peakLocalDensity.map((value) => Math.min(4, Math.max(0, value))));
    return costs;
  }
  const attractions = event.items.filter((item) =>
    (item.kind === "booth" && item.company) || ["food", "stage", "reception"].includes(item.kind));
  const minutes = Math.max(1, eventDurationSeconds(event) / 60);
  const demand = Math.min(2, event.visitors / minutes / Math.max(1, attractions.length) / 2);
  for (const item of attractions) {
    const pressure = Math.min(4, Math.max(0, item.popularity) / 3 *
      Math.max(10, item.dwell) / 60 * 6 / Math.max(1, processingRateFor(item)) * demand);
    const radius = 4;
    for (let y = Math.max(0, Math.floor((item.y - radius) / cell)); y < Math.min(h, Math.ceil((item.y + item.h + radius) / cell)); y++) {
      for (let x = Math.max(0, Math.floor((item.x - radius) / cell)); x < Math.min(w, Math.ceil((item.x + item.w + radius) / cell)); x++) {
        const dx = Math.max(item.x - (x + .5) * cell, 0, (x + .5) * cell - item.x - item.w);
        const dy = Math.max(item.y - (y + .5) * cell, 0, (y + .5) * cell - item.y - item.h);
        costs[y * w + x] = Math.min(4, costs[y * w + x] + pressure * Math.max(0, 1 - Math.hypot(dx, dy) / radius));
      }
    }
  }
  return costs;
}

export function visitorRoute(event: FairEvent, ids: string[], simulation?: Simulation | null) {
  const points: Point[] = [], order: Item[] = [], stops: VisitorStop[] = [], unreachable: string[] = [];
  const { w, cell } = gridFor(event);
  const costs = visitorCrowdCosts(event, simulation);
  const pressureAt = (point: Point) => costs[cellId(point, w, cell)] ?? 0;
  const pathCost = (path: Point[]) => path.slice(1).reduce((sum, point) => sum + cell * (1 + 2 * pressureAt(point)), 0);
  const source = simulation ? "simulation" : "estimate";
  let remaining = event.items.filter((i) => ids.includes(i.id) && i.kind === "booth" && i.company);
  const entrances = eventEntrances(event), exits = eventExits(event);
  const checkIns = entrances.flatMap((entrance) => event.items.filter((item) => item.kind === "reception")
    .map((item) => ({ item, path: findPath(event, entrance, boothQueuePoints(event, item).slice(0, 1), costs) })))
    .filter(({ path }) => path.length).sort((a, b) => pathCost(a.path) - pathCost(b.path));
  const checkIn = checkIns[0];
  if (!checkIn) return { points, order, stops, source, unreachable: ["Reception desk", ...remaining.map((item) => item.label)],
    exitReachable: false, distance: 0, congestion: null };
  points.push(...checkIn.path);
  order.push(checkIn.item);
  let current: Point = checkIn.path[checkIn.path.length - 1];
  stops.push({ item: checkIn.item, point: current, crowd: pressureAt(current) });
  while (remaining.length) {
    const candidates = remaining.map((item) => {
      const path = findPath(event, current, accessPoints(event, item), costs);
      const crowd = path.length ? pressureAt(path[path.length - 1]) : 0;
      // Treat destination crowding as an extra walking cost so nearby busy
      // exhibits can be deferred without sending visitors on huge detours.
      return { item, path, crowd, score: pathCost(path) + 30 * crowd };
    }).filter((entry) => entry.path.length).sort((a, b) => a.score - b.score);
    if (!candidates.length) {
      unreachable.push(...remaining.map((i) => i.label));
      break;
    }
    const next = candidates[0];
    order.push(next.item);
    points.push(...next.path.slice(1));
    current = next.path[next.path.length - 1];
    stops.push({ item: next.item, point: current, crowd: next.crowd });
    remaining = remaining.filter((i) => i.id !== next.item.id);
  }
  const out = findPath(event, current, exits, costs);
  points.push(...out.slice(1));
  return { points, order, stops, source, unreachable, exitReachable: out.length > 0,
    distance: Math.round(Math.max(0, points.length - 1) * cell),
    congestion: points.length ? points.reduce((sum, point) => sum + pressureAt(point), 0) / points.length : null };
}
export function assumptions(event: FairEvent) {
  return JSON.stringify({
    visitors: event.visitors,
    startTime: event.startTime,
    endTime: event.endTime,
    width: event.width,
    height: event.height,
    roomRectangles: roomRectangles(event),
    entrances: eventEntrances(event),
    exits: eventExits(event),
    items: event.items
      .map((i) => [i.id, !!i.company, i.kind, i.category.trim().toLowerCase(), i.popularity, i.dwell, processingRateFor(i), i.kind === "food" ? foodAvailabilityFor(i, event) : null,
        i.kind === "stage" ? [stageLingeringFor(i), stageSpotlightFor(i)] : null]),
  });
}

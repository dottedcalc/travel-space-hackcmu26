import test from "node:test";
import assert from "node:assert/strict";
import { seedEvent } from "../lib/event.ts";
import { findPath, gridFor, visitorRoute } from "../lib/simulation.ts";

const item = (id, x, y, extra = {}) => ({ id, label: id, name: id, kind: "booth", company: id,
  x, y, w: 2, h: 2, popularity: 1, dwell: 30, processingRate: 12, category: "", ...extra });
const fixture = () => ({ ...seedEvent(), width: 30, height: 20, roomRectangles: undefined,
  entrance: { x: 1, y: 10 }, exit: { x: 28, y: 10 }, entrances: undefined, exits: undefined,
  items: [item("reception", 2, 8, { kind: "reception", company: "" }), item("busy", 7, 8), item("quiet", 15, 8)] });

test("crowd-aware itinerary defers the nearer crowded exhibit and preserves all stops", () => {
  const event = fixture(), grid = gridFor(event);
  const peakLocalDensity = Array(grid.w * grid.h).fill(0);
  for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) {
    if (x * grid.cell >= 5 && x * grid.cell <= 11 && y * grid.cell >= 6 && y * grid.cell <= 12)
      peakLocalDensity[y * grid.w + x] = 4;
  }
  const guide = visitorRoute(event, ["busy", "quiet", "quiet"], { cell: grid.cell, peakLocalDensity });
  assert.deepEqual(guide.order.map((stop) => stop.id), ["reception", "quiet", "busy"]);
  assert.equal(guide.exitReachable, true);
  assert.equal(guide.stops.length, 3);
  for (const point of guide.points) assert.equal(grid.blocked[Math.floor(point.y / grid.cell) * grid.w + Math.floor(point.x / grid.cell)], 0);
});

test("weighted aisle routing avoids a congested corridor when a clear detour exists", () => {
  const event = { ...fixture(), items: [] }, grid = gridFor(event);
  const costs = new Float32Array(grid.w * grid.h);
  for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) {
    if (x * grid.cell >= 8 && x * grid.cell <= 20 && y * grid.cell >= 8 && y * grid.cell <= 12) costs[y * grid.w + x] = 4;
  }
  const start = { x: 2, y: 10 }, targets = [{ x: 27, y: 10 }];
  const shortest = findPath(event, start, targets), quieter = findPath(event, start, targets, costs);
  const exposure = (path) => path.reduce((sum, p) => sum + costs[Math.floor(p.y / grid.cell) * grid.w + Math.floor(p.x / grid.cell)], 0);
  assert.ok(quieter.length > shortest.length);
  assert.ok(exposure(quieter) < exposure(shortest));
});

test("attendance estimates favor a quieter exhibit; missing reception gives no invented route", () => {
  const event = fixture();
  event.visitors = 10000;
  event.items[1].popularity = 5;
  event.items[1].dwell = 180;
  event.items[1].processingRate = 2;
  const route = visitorRoute(event, ["busy", "quiet"]);
  assert.equal(route.source, "estimate");
  assert.equal(route.order[1].id, "quiet");
  const missing = visitorRoute({ ...event, items: event.items.slice(1) }, ["busy"]);
  assert.equal(missing.points.length, 0);
  assert.equal(missing.exitReachable, false);
  assert.ok(missing.unreachable.includes("Reception desk"));
});

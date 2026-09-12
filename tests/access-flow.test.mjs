import { simulateWithReception as simulate, withReception } from "./simulation-fixture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { allAccessPoints, canPlaceAccessPoint, eventEntrances, eventExits, resizeRoom, seedEvent, withAccessPercentage, withAccessPoints,
  withRoomRectangle, withoutRoomRectangle } from "../lib/event.ts";
import { assumptions, gridFor, segmentIsWalkable, validPosition } from "../lib/simulation.ts";

function multiAccessEvent() {
  let event = { ...seedEvent(), items: [], visitors: 300,
    startTime: "09:00", endTime: "09:30" };
  event = withAccessPoints(event, "entrance", [
    { id: "west-in", x: 2, y: 18, flow: 80 },
    { id: "east-in", x: 28, y: 18, flow: 20 },
  ]);
  return withAccessPoints(event, "exit", [
    { id: "west-out", x: 2, y: 1, flow: 25 },
    { id: "east-out", x: 28, y: 1, flow: 75 },
  ]);
}

test("legacy layouts retain one entrance and exit; multi-point weights distribute visitors", () => {
  assert.equal(eventEntrances(seedEvent()).length, 1);
  assert.equal(eventExits(seedEvent()).length, 1);
  const event = withReception(multiAccessEvent());
  const result = simulate(event);
  assert.equal(result.finished, 300);
  assert.equal(result.stranded, 0);
  const count = (id) => result.agents.filter((agent) =>
    agent.entranceId === id || agent.exitId === id).reduce((sum, agent) => sum + agent.weight, 0);
  assert.ok(Math.abs(count("west-in") - 240) <= 20);
  assert.ok(Math.abs(count("east-in") - 60) <= 20);
  assert.ok(Math.abs(count("west-out") - 75) <= 20);
  assert.ok(Math.abs(count("east-out") - 225) <= 20);
  for (const agent of result.agents) {
    const source = eventEntrances(event).find((point) => point.id === agent.entranceId);
    const destination = eventExits(event).find((point) => point.id === agent.exitId);
    assert.ok(Math.hypot(agent.path[0].x - source.x, agent.path[0].y - source.y) < 1);
    assert.ok(Math.hypot(agent.path.at(-1).x - destination.x,
      agent.path.at(-1).y - destination.y) < 1);
  }
  assert.ok(assumptions(event).includes("east-in"));
  assert.equal(validPosition(event, { ...seedEvent().items[0], x: 28, y: 18, w: 0.5, h: 0.5 }), false);
  assert.equal(canPlaceAccessPoint(event, { x: 27.5, y: 17.5 }, "east-in"), true);
  assert.equal(canPlaceAccessPoint(event, { x: 2, y: 18 }, "east-in"), false);
  assert.equal(canPlaceAccessPoint(event, { x: -0.5, y: 18 }, "east-in"), false);
});

test("room geometry changes retain every access point", () => {
  const original = multiAccessEvent();
  const scaled = resizeRoom(original, 60, 40);
  assert.ok(scaled);
  assert.deepEqual(allAccessPoints(scaled).map((p) => [p.x, p.y]),
    [[4, 36], [56, 36], [4, 2], [56, 2]]);
  const extended = withRoomRectangle(original, { x: -4, y: -4, w: 4, h: 8 });
  assert.deepEqual(allAccessPoints(extended).map((p) => [p.x, p.y]),
    [[6, 22], [32, 22], [6, 5], [32, 5]]);
  assert.deepEqual(allAccessPoints(withoutRoomRectangle(extended, 1)), allAccessPoints(original));
});

test("entrance and exit locations stay walkable, and percentages rebalance without changing positions", () => {
  const event = multiAccessEvent();
  const grid = gridFor(event);
  for (const point of allAccessPoints(event)) {
    assert.equal(grid.blocked[Math.floor(point.y / grid.cell) * grid.w + Math.floor(point.x / grid.cell)], 0);
    assert.equal(segmentIsWalkable(event, { x: point.x - 0.5, y: point.y + 0.25 },
      { x: point.x + 1, y: point.y + 0.25 }), true);
  }
  const updated = withAccessPercentage(eventEntrances(event), "east-in", 60);
  assert.deepEqual(updated.map((point) => [point.id, point.x, point.y, point.flow]),
    [["west-in", 2, 18, 40], ["east-in", 28, 18, 60]]);
});

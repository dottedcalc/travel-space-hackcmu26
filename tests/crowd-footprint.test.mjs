import test from "node:test";
import assert from "node:assert/strict";
import { crowdFootprint, footprintFreeFraction } from "../lib/crowd-footprint.ts";
import { queueSafeDistance, queueSpeedFactor } from "../lib/queueing.ts";
import { queuePeopleRemaining } from "../lib/queue-display.ts";
import { calculateSeparation } from "../lib/simulation.ts";

const origin = { x: 0, y: 0 }, east = { x: 1, y: 0 };
const body = (count, free = 1) => ({ id: 1, queueId: "booth", position: origin,
  footprint: crowdFootprint(count, true, east, free) });

test("population expands occupied area and the queue is elongated along its axis", () => {
  const small = body(10).footprint, large = body(100).footprint;
  assert.ok(Math.abs(large.along * large.across / (small.along * small.across) - 10) < 1e-8);
  assert.ok(large.along > large.across * 2);
  assert.deepEqual(large.direction, { x: 0, y: 1 });
  assert.deepEqual(crowdFootprint(10, false, east).direction, east);
});

test("larger queues slow and block lateral traffic beyond the old fixed range", () => {
  const position = { x: -3, y: 0 };
  const small = [body(1)], large = [body(100)];
  assert.equal(queueSafeDistance(position, east, 2, small, 99), 2);
  assert.ok(queueSafeDistance(position, east, 2, large, 99) < 0.1);
  assert.ok(queueSpeedFactor(position, east, large, 99) < queueSpeedFactor(position, east, small, 99));
  assert.ok(calculateSeparation(99, position, large).x < 0);
  // Queue members can enter their own line, without bypassing other queues.
  assert.equal(queueSafeDistance(position, east, 2, large, 99, "booth"), 2);
  assert.ok(queueSafeDistance(position, east, 2, large, 99, "elsewhere") < 0.1);
});

test("less reachable floor and overlapping groups increase pressure", () => {
  const open = body(30), narrow = body(30, 0.4);
  const position = { x: -1.5, y: 0 };
  assert.ok(narrow.footprint.across > open.footprint.across);
  assert.ok(queueSpeedFactor(position, east, [narrow], 99) < queueSpeedFactor(position, east, [open], 99));
  assert.ok(queueSpeedFactor(position, east, [open, { ...open, id: 2 }], 99) <
    queueSpeedFactor(position, east, [open], 99));
  assert.equal(footprintFreeFraction(origin, open.footprint, () => true), 1);
  assert.ok(footprintFreeFraction(origin, open.footprint, (p) => Math.abs(p.x) < 0.5) < 1);
});

test("service shrinks the same physical footprint gradually and seeking reproduces it", () => {
  const visit = { itemId: "booth", joined: 0, serviceStart: 10, serviceEnd: 110, departed: 110 };
  const radius = (time) => body(queuePeopleRemaining(100, visit, time)).footprint.across;
  assert.ok(radius(10) > radius(30) && radius(30) > radius(60));
  assert.equal(radius(30), radius(30));
  assert.ok(Number.isFinite(radius(110)));
});

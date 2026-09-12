import { simulateWithReception as simulate } from "./simulation-fixture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { queueCountsAtStep, queuePeopleRemaining } from "../lib/queue-display.ts";
import { bookedEvent } from "./simulation-fixture.mjs";

const service = { itemId: "booth-1", joined: 5, serviceStart: 10, serviceEnd: 30, departed: 30 };
const waiting = { itemId: "booth-1", joined: 6, serviceStart: 40, serviceEnd: 60, departed: 60 };
const occupants = [{ agent: { weight: 10 }, queueVisit: service }, { agent: { weight: 10 }, queueVisit: waiting }];

test("the queue total counts down during group service, not just at group departure", () => {
  assert.equal(queuePeopleRemaining(10, service, 4), 0);
  assert.equal(queuePeopleRemaining(10, service, 9), 10);
  assert.equal(queueCountsAtStep(occupants, 10).get("booth-1").count, 20);
  assert.equal(queueCountsAtStep(occupants, 12).get("booth-1").count, 19);
  assert.equal(queueCountsAtStep(occupants, 20).get("booth-1").count, 15);
  assert.equal(queueCountsAtStep(occupants, 28).get("booth-1").count, 11);
  assert.equal(queueCountsAtStep(occupants, 30).get("booth-1").count, 10);
  assert.equal(queueCountsAtStep(occupants, 20).get("booth-1").groups, 2);
  assert.equal(queueCountsAtStep(occupants, 30).get("booth-1").groups, 1);
});

test("fractional playback, pause, and rewind use simulation time without accumulated animation state", () => {
  const first = queueCountsAtStep(occupants, 20.5);
  assert.equal(first.get("booth-1").remaining, 14.75);
  queueCountsAtStep(occupants, 50);
  assert.deepEqual(queueCountsAtStep(occupants, 20.5), first);
  assert.deepEqual(queueCountsAtStep(occupants, 20.5), first);
  assert.equal(queueCountsAtStep(occupants, 0).size, 0);
  assert.equal(queueCountsAtStep(occupants, 60).size, 0);
});

test("a service unfinished at closing still has a gradual count", () => {
  const unfinished = { ...service, departed: null };
  assert.equal(queuePeopleRemaining(1000, unfinished, 20), 500);
  assert.ok(Math.abs(queuePeopleRemaining(1000, unfinished, 20.02) - 499) < 1e-9);
  assert.equal(queuePeopleRemaining(1, service, 20), 0.5);
  assert.equal(queueCountsAtStep([{ agent: { weight: 1 }, queueVisit: service }], 20).get("booth-1").count, 1);
});

test("separate booths and visitors outside queues do not mix their displayed totals", () => {
  const data = [...occupants, { agent: { weight: 100 } },
    { agent: { weight: 7 }, queueVisit: { ...waiting, itemId: "booth-2" } }];
  const queues = queueCountsAtStep(data, 20);
  assert.equal(queues.size, 2);
  assert.equal(queues.get("booth-1").count, 15);
  assert.equal(queues.get("booth-2").count, 7);
});

test("simulation records planned service completion even when the event ends first", () => {
  const event = { ...bookedEvent(), visitors: 1, startTime: "09:00", endTime: "09:02",
    items: [{ ...bookedEvent().items[0], processingRate: 0.1 }], entrance: { x: 4.5, y: 6 },
  };
  const result = simulate(event), visit = result.agents[0].queueVisits.find((visit) => visit.itemId === event.items[0].id);
  assert.ok(visit.serviceStart !== null);
  assert.ok(visit.serviceEnd > result.duration);
  assert.equal(visit.departed, null);
  assert.ok(queuePeopleRemaining(10, visit, result.duration - 1) < 10);
});

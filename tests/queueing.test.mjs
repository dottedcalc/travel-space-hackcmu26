import { simulateWithReception as simulate } from "./simulation-fixture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { bookedEvent } from "./simulation-fixture.mjs";
import { agentsAtStep, boothQueuePoints, segmentIsWalkable } from "../lib/simulation.ts";
import { queueSafeDistance, queueSpeedFactor } from "../lib/queueing.ts";

function queueEvent(dwell = 30) {
  return { ...bookedEvent(), width: 14, height: 12, visitors: 20,
    startTime: "09:00", endTime: "09:10", entrance: { x: 2, y: 10 }, exit: { x: 12, y: 10 },
    items: [{ ...bookedEvent().items[0], x: 5, y: 2, w: 4, h: 2, dwell: 10, processingRate: 60 / dwell }],
  };
}

test("queues start at the front center and stop at physical boundaries", () => {
  const event = queueEvent(), booth = event.items[0];
  const points = boothQueuePoints(event, booth);
  assert.ok(points.length > 1);
  for (const point of points) {
    assert.equal(point.x, booth.x + booth.w / 2);
    assert.ok(point.y > booth.y + booth.h && point.y < event.height);
  }
  for (let i = 1; i < points.length; i++) {
    assert.ok(points[i].y > points[i - 1].y);
    assert.ok(segmentIsWalkable(event, points[i - 1], points[i]));
  }
  event.items.push({ ...booth, id: "wall", kind: "obstacle", x: 5, y: 7, w: 4, h: 1 });
  assert.ok(boothQueuePoints(event, booth).every((point) => point.y < 7));
  event.items[1].y = 4;
  assert.deepEqual(boothQueuePoints(event, booth), []);
  const blocked = simulate(event);
  assert.equal(blocked.visits, 0);
  assert.equal(blocked.missed, event.visitors);
  assert.ok(blocked.findings.some((finding) => finding.title.includes("front queue is blocked")));
});

test("booth service is first-in-first-out and occurs at the front center", () => {
  const event = queueEvent(), result = simulate(event);
  const visits = result.agents.flatMap((agent) => agent.queueVisits.filter((visit) => visit.itemId === event.items[0].id).map((visit) => ({ agent, ...visit })))
    .sort((a, b) => a.joined - b.joined);
  assert.ok(visits.length >= 5);
  const served = visits.filter((visit) => visit.serviceStart !== null);
  assert.ok(served.length >= 3);
  for (let i = 0; i < served.length; i++) {
    assert.equal(served[i], visits[i], "A visitor overtook an earlier queue arrival");
    if (i) assert.ok(served[i].serviceStart >= served[i - 1].departed);
    const { point } = agentsAtStep(result, served[i].serviceStart).find(({ agent }) => agent.id === served[i].agent.id);
    assert.ok(Math.hypot(point.x - 7, point.y - 4.5) <= 0.061);
  }
  for (const visit of visits) {
    const { point } = agentsAtStep(result, visit.joined).find(({ agent }) => agent.id === visit.agent.id);
    assert.ok(Math.abs(point.x - 7) < 0.061);
  }
  assert.ok(result.queueWait > 0);
});

test("longer service produces more queue delay and fewer completed visits", () => {
  const quick = simulate(queueEvent(5)), slow = simulate(queueEvent(90));
  assert.ok(slow.queueWait > quick.queueWait);
  assert.ok(slow.visits < quick.visits);
  assert.ok(slow.finished < quick.finished);
  assert.notDeepEqual(slow.heat, quick.heat);
});

test("a queue across a lateral walkway reduces speed and prevents walking through people", () => {
  const position = { x: -1, y: 0 }, direction = { x: 1, y: 0 };
  const queue = [-0.8, 0, 0.8].map((y, id) => ({ id, position: { x: 0, y }, queueId: "booth" }));
  assert.equal(queueSpeedFactor(position, direction, [], 99), 1);
  assert.ok(queueSpeedFactor(position, direction, queue, 99) < 0.5);
  assert.ok(queueSafeDistance(position, direction, 2, queue, 99) < 0.46);
  assert.equal(queueSpeedFactor({ x: -1, y: 4 }, direction, queue, 99), 1);
  assert.equal(queueSafeDistance({ x: -1, y: 4 }, direction, 2, queue, 99), 2);
});

test("compressed stationary queue waits preserve seeking and occupancy", () => {
  const result = simulate(queueEvent(90));
  const agent = result.agents.find((a) => a.pathSteps.some((offset, i) => i && offset - a.pathSteps[i - 1] > 10));
  assert.ok(agent);
  const index = agent.pathSteps.findIndex((offset, i) => i && offset - agent.pathSteps[i - 1] > 10);
  const start = agent.start + agent.pathSteps[index - 1];
  const end = agent.start + agent.pathSteps[index];
  for (const step of [start, (start + end) / 2, end - 0.1]) {
    const { point } = agentsAtStep(result, step).find((entry) => entry.agent.id === agent.id);
    assert.deepEqual(point, agent.path[index - 1]);
  }
  assert.deepEqual(agentsAtStep(result, result.duration), []);
  const occupancy = result.heat.reduce((sum, heat) => sum + heat, 0) * result.cell ** 2 * result.duration;
  const visitorTicks = result.agents.reduce((sum, a) => sum + (a.endStep - a.start) * a.weight, 0);
  assert.ok(Math.abs(occupancy - visitorTicks) < 1e-6);
});

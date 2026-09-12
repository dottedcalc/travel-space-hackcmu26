import test from "node:test";
import assert from "node:assert/strict";
import { bookedEvent } from "./simulation-fixture.mjs";
import { processingRateFor } from "../lib/event.ts";
import { simulate, simulationStepSeconds, eventDurationSteps, cellSize,
  segmentIsWalkable, visitorProfiles } from "../lib/simulation.ts";

test("time resolution adapts to long busy events independently of map resolution", () => {
  const event = { ...bookedEvent(), visitors: 2000, startTime: "09:00", endTime: "13:00" };
  assert.equal(simulationStepSeconds(event), 1);
  assert.equal(cellSize(event), 0.5);
  assert.equal(eventDurationSteps(event), 4 * 60 * 60);
  assert.equal(simulationStepSeconds({ ...event, visitors: 200 }), 0.5);
  assert.equal(simulationStepSeconds({ ...event, endTime: "09:30" }), 0.5);
  assert.equal(simulationStepSeconds({ ...event, width: 1000, height: 1000 }), 2);
});

test("faster organizer sampling still represents every visitor and the full event", () => {
  const event = { ...bookedEvent(), visitors: 500, startTime: "09:00", endTime: "10:00" };
  const result = simulate(event, undefined, true);
  assert.equal(result.agents.length, 350);
  assert.equal(result.agents.reduce((total, agent) => total + agent.weight, 0), event.visitors);
  assert.equal(result.duration * result.stepSeconds, 60 * 60);
});

test("one-second runs preserve attendance, event hours, walkable paths, and sequential service", () => {
  const event = { ...bookedEvent(), visitors: 2000, width: 200, height: 100,
    startTime: "09:00", endTime: "13:00" };
  const result = simulate(event);
  assert.equal(result.stepSeconds, 1);
  assert.equal(result.cell, 0.5);
  assert.equal(result.duration * result.stepSeconds, 4 * 60 * 60);
  assert.equal(result.agents.reduce((total, agent) => total + agent.weight, 0), event.visitors);
  assert.ok(result.visits > 0);
  assert.equal(result.stranded, 0);
  const queues = new Map();
  for (const agent of result.agents) {
    assert.ok(agent.start >= 0 && agent.endStep <= result.duration);
    for (let i = 1; i < agent.path.length; i++) {
      const from = agent.path[i - 1], to = agent.path[i];
      assert.ok(segmentIsWalkable(event, from, to), `Visitor ${agent.id} crossed an obstacle`);
      assert.ok(Math.hypot(to.x - from.x, to.y - from.y) <=
        visitorProfiles[agent.type].speedFactor * result.stepSeconds + 1e-8);
    }
    for (const visit of agent.queueVisits) {
      const entries = queues.get(visit.itemId) ?? [];
      entries.push(visit);
      queues.set(visit.itemId, entries);
      if (visit.serviceStart === null) continue;
      const item = event.items.find((item) => item.id === visit.itemId);
      const seconds = item.kind === "restroom" ? 90 : 60 / processingRateFor(item);
      const actual = (visit.serviceEnd - visit.serviceStart) * result.stepSeconds;
      assert.ok(actual >= seconds * agent.weight && actual < seconds * agent.weight + result.stepSeconds);
    }
  }
  for (const entries of queues.values()) {
    const served = entries.sort((a, b) => a.joined - b.joined).filter((visit) => visit.serviceStart !== null);
    for (let i = 1; i < served.length; i++) assert.ok(served[i].serviceStart >= served[i - 1].departed);
  }
  assert.ok(result.heat.every(Number.isFinite));
  assert.ok(result.peakLocalDensity.every(Number.isFinite));
});

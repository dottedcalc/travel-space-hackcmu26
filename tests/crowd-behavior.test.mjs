import { simulateWithReception as simulate } from "./simulation-fixture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { bookedEvent as seedEvent } from "./simulation-fixture.mjs";
import {
  agentsAtStep, calculateSeparation, createRoute, segmentIsWalkable,
  visitorProfiles,
} from "../lib/simulation.ts";

const compactEvent = () => ({
  ...seedEvent(), visitors: 30, startTime: "09:00", endTime: "09:10",
  items: seedEvent().items.map((item) => ({ ...item, dwell: 10 })),
});

test("profile routes select distinct destinations in the supplied model's ranges", () => {
  const targets = Array.from({ length: 10 }, (_, i) => ({ ...seedEvent().items[0], id: String(i), category: String(i) }));
  for (const [type, minimum, maximum] of [
    ["focused", 5, 5], ["viewer", 5, 10], ["explorer", 8, 10], ["social", 5, 10],
  ]) {
    for (const draw of [0, 0.5, 0.999]) {
      const route = createRoute(() => draw, type, targets);
      assert.ok(route.length >= minimum && route.length <= maximum);
      assert.equal(new Set(route.map((item) => item.id)).size, route.length);
    }
    assert.deepEqual(createRoute(() => 0.5, type, []), []);
  }
});

test("separation grows at close range, is local, and resolves exact overlaps symmetrically", () => {
  const position = { x: 0, y: 0 };
  const force = (x) => calculateSeparation(0, position, [{ id: 1, position: { x, y: 0 } }]);
  assert.ok(force(0.25).x < force(1.5).x);
  assert.deepEqual(force(3), { x: 0, y: 0 });
  const snapshot = [{ id: 0, position }, { id: 1, position }];
  const before = structuredClone(snapshot);
  const a = calculateSeparation(0, position, snapshot);
  const b = calculateSeparation(1, position, snapshot);
  assert.ok(Math.hypot(a.x, a.y) > 0);
  assert.ok(Math.abs(a.x + b.x) + Math.abs(a.y + b.y) < 1e-10);
  assert.deepEqual(snapshot, before);
});

test("visitors react to their neighbors while keeping their seeded preferences", () => {
  const event = compactEvent();
  const alone = simulate({ ...event, visitors: 1 }).agents[0];
  const crowd = simulate({ ...event, visitors: 100 });
  const together = crowd.agents[0];
  assert.equal(alone.start, together.start);
  assert.equal(alone.type, together.type);
  assert.deepEqual(alone.route, together.route);
  assert.notDeepEqual(alone.path, together.path);
  assert.deepEqual(new Set(crowd.agents.map((agent) => agent.type)), new Set(Object.keys(visitorProfiles)));
});

test("steering segments avoid obstacles and respect each profile's walking speed", () => {
  const event = { ...compactEvent(), endTime: "10:00" };
  const result = simulate(event);
  assert.equal(result.finished, event.visitors);
  for (const agent of result.agents) {
    assert.equal(agent.state, "finished");
    for (let i = 1; i < agent.path.length; i++) {
      const a = agent.path[i - 1], b = agent.path[i];
      assert.ok(segmentIsWalkable(event, a, b), `Agent ${agent.id} crossed an obstacle`);
      assert.ok(Math.hypot(b.x - a.x, b.y - a.y) <=
        visitorProfiles[agent.type].speedFactor * result.stepSeconds + 1e-8);
    }
  }
  // Check the whole segment, even when both endpoints are on free cells.
  assert.equal(segmentIsWalkable(event, { x: 1, y: 3 }, { x: 8, y: 3 }), false);
});

test("visitors wait at a booth for the configured profile-adjusted dwell time", () => {
  const event = { ...compactEvent(), visitors: 1, items: [{ ...seedEvent().items[0], dwell: 20 }] };
  const result = simulate(event), agent = result.agents[0];
  const visit = agent.queueVisits.find((visit) => visit.itemId === event.items[0].id);
  assert.ok(visit.serviceStart !== null && visit.departed !== null);
  const wait = 20 * visitorProfiles[agent.type].waitFactor / result.stepSeconds;
  const pause = agent.pauses.find((pause) => pause.itemId === event.items[0].id);
  const stayed = visit.departed - visit.serviceStart + (pause ? pause.end - pause.start : 0);
  assert.ok(stayed >= Math.floor(wait * 0.7));
  assert.ok(stayed <= Math.ceil(wait * 1.3));
  assert.equal(result.visits, 1);
  assert.equal(result.finished, 1);
});

test("fractional playback interpolates the same walkable movement segments", () => {
  const result = simulate({ ...compactEvent(), visitors: 1 });
  const agent = result.agents[0];
  const index = agent.path.findIndex((point, i) => i < agent.path.length - 1 &&
    Math.hypot(point.x - agent.path[i + 1].x, point.y - agent.path[i + 1].y) > 0.01);
  assert.ok(index >= 0);
  const [{ point }] = agentsAtStep(result, agent.start + agent.pathSteps[index] + 0.5);
  assert.equal(point.x, agent.path[index].x + (agent.path[index + 1].x - agent.path[index].x) * 0.5);
  assert.equal(point.y, agent.path[index].y + (agent.path[index + 1].y - agent.path[index].y) * 0.5);
  assert.deepEqual(agentsAtStep(result, agent.start - 0.1), []);
  assert.deepEqual(agentsAtStep(result, result.duration), []);
});

test("unreachable exits keep stranded visitors visible without storing hours of duplicate points", () => {
  const event = { ...compactEvent(), visitors: 5, items: [{
    ...seedEvent().items[0], id: "wall", kind: "obstacle", company: "",
    x: 0, y: 10, w: 30, h: 1,
  }] };
  const result = simulate(event);
  assert.equal(result.stranded, 5);
  assert.equal(result.finished, 0);
  assert.equal(agentsAtStep(result, result.duration - 1).length, 5);
  assert.deepEqual(agentsAtStep(result, result.duration), []);
  assert.ok(result.agents.every((agent) => agent.path.length < 1000));
  assert.ok(result.heat.some((value) => value > 0));
});

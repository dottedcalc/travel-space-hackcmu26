import { simulateWithReception as simulate } from "./simulation-fixture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { bookedEvent as seedEvent } from "./simulation-fixture.mjs";
import { objectPresets, pointInRoom, rectInsideRoom, roomBoundarySegments, roomRectangleFromDrag,
  resizeRoom, validRoomShape, withRoomRectangle, withoutRoomRectangle } from "../lib/event.ts";
import { emergencyExitAt } from "../lib/placement.ts";
import {
  simulate as simulateWithProgress,
  agentsAtStep,
  crowdClustersAtStep,
  eventDurationSteps,
  STEP,
  MAX_SIMULATED_AGENTS,
  gridFor,
  findPath,
  inspectLayout,
  validPosition,
  visitorRoute,
  assumptions,
} from "../lib/simulation.ts";

test("repeatable visitor routes stay on walkable cells and finish at the exit", () => {
  const e = { ...seedEvent(), visitors: 200 },
    a = simulate(e),
    b = simulate(e);
  assert.deepEqual(a, b);
  assert.equal(a.agents.length, e.visitors);
  assert.equal(a.totalVisitors, e.visitors);
  assert.equal(a.agents.reduce((total, agent) => total + agent.weight, 0), e.visitors);
  assert.equal(a.missed, 0);
  assert.equal(a.stranded, 0);
  assert.ok(a.visits >= 300);
  const { w, blocked } = gridFor(e);
  for (const agent of a.agents) {
    assert.ok(agent.path.length);
    for (const p of agent.path)
      assert.equal(blocked[Math.floor(p.y * 2) * w + Math.floor(p.x * 2)], 0);
    if (agent.state === "finished") {
      const last = agent.path.at(-1);
      assert.equal(Math.floor(last.x * 2), e.exit.x * 2);
      assert.equal(Math.floor(last.y * 2), e.exit.y * 2);
    } else assert.equal(agent.endStep, a.duration);
  }
});
test("resizing scales the entire floor plan proportionally within 1000 m bounds", () => {
  const original = seedEvent();
  const larger = resizeRoom(original, 1000, 666.5);
  assert.ok(larger);
  assert.equal(larger.width, 1000);
  assert.equal(larger.height, 666.5);
  assert.ok(validRoomShape(larger));
  assert.equal(larger.items[0].x, 66.5);
  assert.equal(larger.items[0].w, 167);
  assert.equal(larger.entrance.x, 133.5);
  assert.equal(gridFor(larger).w, 500);
  assert.equal(gridFor(larger).h, 334);
  assert.equal(resizeRoom(original, 1000.5, 20), null);
  assert.equal(resizeRoom(original, 1000, 1000), null);
  const smaller = resizeRoom(original, 12, 8);
  assert.ok(smaller);
  assert.equal(smaller.items[0].w, 2);
  assert.deepEqual(resizeRoom(larger, 30, 20)?.items, original.items);
  const run = simulate({ ...larger, visitors: 100, startTime: "09:00", endTime: "10:00" });
  assert.equal(run.cell, 2);
  assert.equal(run.stepSeconds, 2);
  assert.equal(run.heat.length, 500 * 334);
  assert.ok(run.visits > 0);
  assert.equal(run.stranded, 0);
  const farRun = simulate({ ...larger, exit: { x: 999, y: 665 }, visitors: 100000 });
  assert.equal(farRun.agents.length, Math.floor(120000 / (500 + 334)));
  assert.equal(farRun.stranded, 0);
  const joined = { ...original, width: 20, height: 15, items: [],
    entrance: { x: 2, y: 14 }, exit: { x: 18, y: 0 },
    roomRectangles: [{ x: 0, y: 0, w: 20, h: 5 }, { x: 0, y: 5, w: 8, h: 10 }] };
  assert.deepEqual(resizeRoom(joined, 40, 30)?.roomRectangles,
    [{ x: 0, y: 0, w: 40, h: 10 }, { x: 0, y: 10, w: 16, h: 20 }]);
});
test("each displayed step contains exactly the visitors at that simulation time", () => {
  const event = { ...seedEvent(), visitors: 200 };
  const result = simulate(event);
  assert.equal(result.duration * STEP, 12 * 60 * 60);
  assert.equal(result.agents.length, event.visitors);
  assert.ok(result.agents.some((agent) => agent.start * STEP > 6 * 60 * 60));
  for (const step of [0, 1, 120, result.duration - 1]) {
    const visible = agentsAtStep(result, step);
    assert.equal(visible.length, result.agents.filter((agent) =>
      step >= agent.start && step < agent.endStep
    ).length);
    for (const { agent, point } of visible) {
      const index = agent.pathSteps.findLastIndex((offset) => offset <= step - agent.start);
      assert.deepEqual(point, agent.path[index]);
    }
  }
  assert.equal(agentsAtStep(result, result.duration).length, 0);
});
test("event hours set the simulation span and keep every visitor inside it", () => {
  const event = { ...seedEvent(), visitors: 100, startTime: "09:30", endTime: "11:00" };
  const result = simulate(event);
  assert.equal(eventDurationSteps(event), 90 * 60 / STEP);
  assert.equal(result.duration, eventDurationSteps(event));
  assert.ok(result.agents.every((agent) =>
    agent.start >= 0 && agent.endStep <= result.duration
  ));
});
test("progress reporting preserves simulation results and advances through final analysis", () => {
  const event = { ...seedEvent(), visitors: 20, startTime: "09:00", endTime: "09:10" };
  const progress = [];
  // Call the production simulator directly to exercise its optional progress callback.
  const expected = simulate(event);
  const actual = simulateWithProgress(event, (value) => progress.push(value));
  assert.deepEqual(actual, expected);
  assert.equal(progress[0], 0);
  assert.equal(progress.at(-1), 95);
  assert.ok(progress.every((value, index) => value >= (progress[index - 1] ?? 0)));
});
test("a million-visitor run uses a bounded weighted sample", () => {
  const event = { ...seedEvent(), items: [], visitors: 1_000_000 };
  const result = simulate(event);
  assert.equal(result.totalVisitors, 1_000_000);
  assert.equal(result.agents.length, MAX_SIMULATED_AGENTS);
  assert.equal(result.agents.reduce((total, agent) => total + agent.weight, 0), 1_000_000);
  assert.ok(result.agents.every((agent) => agent.weight === 1000));
  const step = result.agents[0].start;
  assert.equal(
    agentsAtStep(result, step).reduce((total, { agent }) => total + agent.weight, 0),
    result.agents.filter((agent) => step >= agent.start && step < agent.endStep)
      .reduce((total, agent) => total + agent.weight, 0),
  );
});
test("crowd markers represent every active visitor at small and large run sizes", () => {
  for (const visitors of [100, 1_000_000]) {
    const result = simulate({ ...seedEvent(), visitors, items: [] });
    assert.equal(result.agents.length, Math.min(visitors, MAX_SIMULATED_AGENTS));
    for (const step of [0, result.agents[0].start, Math.floor(result.duration / 2), result.duration]) {
      const visible = agentsAtStep(result, step);
      const clusters = crowdClustersAtStep(result, step);
      assert.equal(
        clusters.reduce((total, cluster) => total + cluster.count, 0),
        visible.reduce((total, { agent }) => total + agent.weight, 0),
      );
      assert.equal(new Set(clusters.map(({ point }) =>
        `${Math.floor(point.x / 2)}:${Math.floor(point.y / 2)}`)).size, clusters.length);
    }
  }
});
test("fine heatmap cells carry peak local density independently of event averages", () => {
  const event = { ...seedEvent(), visitors: 80, startTime: "09:00", endTime: "09:10" };
  const result = simulate(event);
  assert.equal(result.peakLocalDensity.length, result.heat.length);
  assert.ok(result.heat.some((average, i) =>
    average > 0 && result.peakLocalDensity[i] > average));
  const one = simulate({ ...event, visitors: 1, items: [] });
  assert.equal(Math.max(...one.peakLocalDensity), 0.25);
});
test("moving a booth changes visit order while retaining arrivals and chosen exhibits", () => {
  const e = { ...seedEvent(), visitors: 200 },
    next = structuredClone(e);
  next.items[2].y = 3;
  assert.ok(validPosition(next, next.items[2]));
  assert.equal(assumptions(e), assumptions(next));
  const a = simulate(e),
    b = simulate(next);
  assert.deepEqual(
    a.agents.map((a) => a.start),
    b.agents.map((a) => a.start),
  );
  assert.deepEqual(a.agents.map((agent) => [...agent.route].sort()), b.agents.map((agent) => [...agent.route].sort()));
  assert.notDeepEqual(a.agents.map((agent) => agent.route), b.agents.map((agent) => agent.route));
  assert.notDeepEqual(a.heat, b.heat);
  assert.notDeepEqual(a.agents[0].path, b.agents[0].path);
});
test("a wall cannot be crossed; inaccessible booths and exit are reported", () => {
  const e = { ...seedEvent(), visitors: 100 };
  e.items = e.items.filter((i) => i.y < 8 || i.y > 10);
  e.items.push({
    id: "wall",
    kind: "obstacle",
    label: "Wall",
    name: "Wall",
    x: 0,
    y: 10,
    w: 30,
    h: 1,
    company: "",
    category: "",
    popularity: 1,
    dwell: 30,
  });
  assert.equal(findPath(e, e.entrance, [e.exit]).length, 0);
  const result = simulate(e);
  assert.equal(result.stranded, e.visitors);
  assert.ok(result.missed > 0);
  assert.ok(
    inspectLayout(e).some((f) => f.title === "No route from entrance to exit"),
  );
});
test("placement rejects overlaps, doors, and out-of-bounds objects", () => {
  const e = seedEvent(),
    item = e.items[0];
  assert.equal(validPosition(e, { ...item, x: 9, y: 2 }), false);
  assert.equal(validPosition(e, { ...item, x: -1 }), false);
  assert.equal(validPosition(e, { ...item, x: 3, y: 18, h: 2 }), false);
  assert.equal(validPosition(e, { ...item, y: 3 }), true);
});
test("joined room rectangles create an irregular walkable floor while stages stay rectangular", () => {
  const e = {
    ...seedEvent(), width: 20, height: 15, items: [],
    entrance: { x: 2, y: 14 }, exit: { x: 18, y: 0 },
    roomRectangles: [
      { x: 0, y: 0, w: 20, h: 5 },
      { x: 0, y: 5, w: 8, h: 10 },
    ],
  };
  assert.equal(validRoomShape(e), true);
  assert.equal(pointInRoom(e, 15, 10), false);
  assert.equal(pointInRoom(e, 4, 10), true);
  const stage = { ...seedEvent().items[0], id: "stage", kind: "stage", x: 2, y: 8, w: 5, h: 3 };
  assert.equal(validPosition(e, stage), true);
  assert.equal(validPosition(e, { ...stage, x: 10 }), false);
  assert.equal(rectInsideRoom(e, { x: 6, y: 4, w: 5, h: 3 }), false);
  assert.ok(findPath(e, e.entrance, [e.exit]).length);
  e.items.push(stage);
  const { blocked, w } = gridFor(e);
  assert.equal(blocked[21 * w + 29], 1); // outside the L-shaped room
  assert.equal(blocked[21 * w + 9], 1); // stage
  assert.equal(blocked[21 * w + 15], 0); // open room
  assert.equal(validRoomShape({ ...e, roomRectangles: [
    e.roomRectangles[0], { x: 10, y: 8, w: 8, h: 7 },
  ] }), false);
  assert.equal(validRoomShape({ ...e, roomRectangles: [
    e.roomRectangles[0], { x: 5, y: 2, w: 8, h: 13 },
  ] }), false);
  const exit = emergencyExitAt({ ...stage, kind: "emergency_exit" }, e, { x: 7.8, y: 9 });
  assert.ok(exit);
  assert.equal(exit.x + exit.w, 8);
});
test("dragging an exposed wall adds a snapped adjoining room section", () => {
  const e = { ...seedEvent(), items: [], roomRectangles: [{ x: 0, y: 0, w: 30, h: 20 }] };
  const east = roomBoundarySegments(e).find((b) => b.side === "east");
  assert.ok(east);
  const added = roomRectangleFromDrag(east, { x: 30, y: 6 }, { x: 34.2, y: 10.1 },
    { width: 40, height: 28 });
  assert.deepEqual(added, { x: 30, y: 6, w: 4, h: 4 });
  const next = withRoomRectangle(e, added);
  assert.equal(validRoomShape(next), true);
  assert.equal(next.width, 34);
  assert.equal(pointInRoom(next, 32, 8), true);
  assert.equal(pointInRoom(next, 32, 12), false);
  assert.equal(roomBoundarySegments(next).some((b) => b.side === "east" && b.coordinate === 30 && b.start === 6), false);
  assert.equal(roomRectangleFromDrag(east, { x: 30, y: 6 }, { x: 42, y: 10 },
    { width: 40, height: 28 }), null);
});
test("touching outer walls form one edge for drawing across room sections", () => {
  const e = {
    ...seedEvent(), width: 34, height: 20, items: [],
    roomRectangles: [{ x: 0, y: 0, w: 30, h: 20 }, { x: 30, y: 0, w: 4, h: 6 }],
  };
  const north = roomBoundarySegments(e).filter((b) => b.side === "north" && b.coordinate === 0);
  assert.deepEqual(north, [{ side: "north", coordinate: 0, start: 0, end: 34 }]);
  const acrossBoth = roomRectangleFromDrag(north[0], { x: 28, y: 0 }, { x: 32, y: -2 },
    { minY: -6, width: 40, height: 28 });
  assert.deepEqual(acrossBoth, { x: 28, y: -2, w: 4, h: 2 });
  assert.equal(validRoomShape(withRoomRectangle(e, acrossBoth)), true);
});
test("removing an added room restores bounds and moves the plan with it", () => {
  const original = seedEvent();
  const west = roomBoundarySegments(original).find((b) => b.side === "west");
  const added = roomRectangleFromDrag(west, { x: 0, y: 3 }, { x: -3, y: 7 },
    { minX: -6, minY: -6, width: 40, height: 28 });
  const expanded = withRoomRectangle(original, added);
  const restored = withoutRoomRectangle(expanded, 1);
  assert.equal(validRoomShape(restored), true);
  assert.deepEqual(restored.roomRectangles, [{ x: 0, y: 0, w: original.width, h: original.height }]);
  assert.deepEqual(restored.entrance, original.entrance);
  assert.deepEqual(restored.items, original.items);
  assert.equal(withoutRoomRectangle(expanded, 0), null);
});
test("north and west additions shift the existing room and its contents together", () => {
  const e = seedEvent();
  const west = roomBoundarySegments(e).find((b) => b.side === "west");
  assert.ok(west);
  const added = roomRectangleFromDrag(west, { x: 0, y: 3 }, { x: -2.8, y: 7 },
    { minX: -6, minY: -6, width: 40, height: 28 });
  assert.deepEqual(added, { x: -3, y: 3, w: 3, h: 4 });
  const next = withRoomRectangle(e, added);
  assert.equal(validRoomShape(next), true);
  assert.equal(next.width, e.width + 3);
  assert.equal(next.entrance.x, e.entrance.x + 3);
  assert.equal(next.items[0].x, e.items[0].x + 3);
  assert.equal(pointInRoom(next, 1, 4), true);
  const north = roomBoundarySegments(e).find((b) => b.side === "north");
  const upper = roomRectangleFromDrag(north, { x: 4, y: 0 }, { x: 8, y: -2 },
    { minX: -6, minY: -6, width: 40, height: 28 });
  const taller = withRoomRectangle(e, upper);
  assert.equal(validRoomShape(taller), true);
  assert.equal(taller.height, e.height + 2);
  assert.equal(taller.exit.y, e.exit.y + 2);
});
test("interior stairs stay walkable and emergency exits must touch a boundary", () => {
  const e = seedEvent();
  e.items = [];
  const stairs = {
    ...seedEvent().items[0], id: "stairs", kind: "stairs", label: "T01",
    x: 3, y: 3, w: 2, h: 3, company: "",
  };
  const emergency = {
    ...stairs, id: "emergency", kind: "emergency_exit", label: "E01",
    x: 8, y: 0, w: 2, h: 1,
  };
  const stage = {
    ...stairs, id: "stage", kind: "stage", label: "G01",
    x: 10, y: 10, w: 6, h: 4,
  };
  assert.equal(validPosition(e, stairs), true);
  assert.equal(validPosition(e, { ...emergency, x: 8, y: 8 }), false);
  assert.equal(validPosition(e, emergency), true);
  e.items = [stairs, emergency, stage];
  const { w, blocked } = gridFor(e);
  assert.equal(blocked[4 * w + 8], 0);
  assert.equal(blocked[0 * w + 16], 0);
  assert.equal(blocked[22 * w + 22], 1);
});
test("emergency exit placement stays on the nearest wall", () => {
  const e = seedEvent();
  const marker = { ...e.items[0], kind: "emergency_exit",
    w: objectPresets.emergency_exit.w, h: objectPresets.emergency_exit.h };
  assert.equal(emergencyExitAt(marker, e, { x: 15, y: 10 }), null);
  assert.equal(emergencyExitAt(marker, e, { x: -0.1, y: 8 }), null);
  assert.deepEqual(
    (({ x, y, w, h }) => ({ x, y, w, h }))(
      emergencyExitAt(marker, e, { x: 8, y: 0.5 }),
    ),
    { x: 7, y: 0, w: 2.5, h: 1.5 },
  );
  assert.deepEqual(
    (({ x, y, w, h }) => ({ x, y, w, h }))(
      emergencyExitAt(marker, e, { x: 0.5, y: 8 }),
    ),
    { x: 0, y: 7, w: 1.5, h: 2.5 },
  );
});
test("visitor guide includes each requested booth once and uses walkable paths", () => {
  const e = seedEvent(),
    guide = visitorRoute(e, ["b1", "b3", "b7"]);
  assert.equal(guide.order.length, 4);
  assert.equal(guide.order[0].kind, "reception");
  assert.deepEqual(
    new Set(guide.order.map((i) => i.id)),
    new Set(["o1", "b1", "b3", "b7"]),
  );
  assert.equal(guide.exitReachable, true);
  assert.equal(guide.unreachable.length, 0);
  const { w, blocked } = gridFor(e);
  for (const p of guide.points)
    assert.equal(blocked[Math.floor(p.y * 2) * w + Math.floor(p.x * 2)], 0);
});
test("empty event requires reception and has no invented booth visits", () => {
  const e = seedEvent();
  e.items = [];
  const result = simulate(e);
  assert.equal(result.visits, 0);
  assert.equal(result.missed, 0);
  assert.equal(result.stranded, e.visitors);
  assert.ok(result.findings.some((f) => f.title === "No exhibitors yet"));
});

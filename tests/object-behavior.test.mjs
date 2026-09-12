import test from "node:test";
import assert from "node:assert/strict";
import { seedEvent, foodAvailabilityFor, foodAvailabilityError, defaultFoodAvailability } from "../lib/event.ts";
import { assumptions, createRoute, simulate } from "../lib/simulation.ts";

const item = (id, kind, x, y, extra = {}) => ({
  id, kind, label: id, name: id, x, y, w: 2, h: 2,
  company: kind === "booth" ? id : "", category: id,
  popularity: 2, dwell: 60, processingRate: 60, ...extra,
});
const reception = () => item("reception", "reception", 2, 2, { processingRate: 120 });
const event = (items, extra = {}) => ({ ...seedEvent(), width: 24, height: 20,
  entrance: { x: 1, y: 18 }, exit: { x: 22, y: 18 }, visitors: 12,
  startTime: "09:00", endTime: "09:20", items: [reception(), ...items], ...extra,
});

test("same-category booths share one audience and popularity shifts their share", () => {
  const booths = [item("a", "booth", 6, 2, { category: "Tech", popularity: 1 }),
    item("b", "booth", 10, 2, { category: " tech ", popularity: 3 })];
  let seed = 17, popular = 0;
  const rng = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < 3000; i++) {
    const route = createRoute(rng, "explorer", booths);
    assert.equal(route.length, 1);
    if (route[0].id === "b") popular++;
  }
  assert.ok(popular > 2100 && popular < 2400);
  assert.equal(createRoute(rng, "explorer", [...booths,
    item("c", "booth", 14, 2, { category: "TECH" })]).length, 1);
  assert.equal(createRoute(rng, "explorer", [...booths,
    item("d", "booth", 18, 2, { category: "Art" })]).length, 2);
});

test("every entrant completes one reception before visiting any booth", () => {
  const input = event([item("b", "booth", 10, 4),
    item("r2", "reception", 16, 2, { processingRate: 120 })], { visitors: 40 });
  const result = simulate(input);
  assert.equal(result.stranded, 0);
  assert.ok(result.finished > 30);
  const desks = new Set(["reception", "r2"]);
  assert.equal(new Set(result.agents.map((agent) => agent.route[0])).size, 2);
  for (const agent of result.agents) {
    assert.ok(desks.has(agent.route[0]));
    const checks = agent.queueVisits.filter((visit) => desks.has(visit.itemId));
    assert.equal(checks.length, 1);
    for (const visit of agent.queueVisits.filter((visit) => !desks.has(visit.itemId)))
      assert.ok(checks[0].departed !== null && visit.joined >= checks[0].departed);
  }
});

test("slow reception holds arrivals until processing completes", () => {
  const input = event([item("b", "booth", 10, 4)], { endTime: "09:05" });
  const fast = simulate(input);
  const slow = simulate({ ...input, items: input.items.map((item) => item.kind === "reception"
    ? { ...item, processingRate: 0.1 } : item) });
  assert.ok(fast.visits > 0);
  assert.equal(slow.visits, 0);
  assert.ok(slow.agents.every((agent) => agent.queueVisits.every((visit) => visit.itemId === "reception")));
  assert.ok(slow.agents.some((agent) => agent.queueVisits.some((visit) => visit.serviceStart !== null && visit.departed === null)));
});

test("missing or inaccessible reception prevents visitors from exploring", () => {
  const booth = item("b", "booth", 10, 4);
  for (const items of [[booth], [booth, reception(), item("wall", "obstacle", 0, 5, { w: 24, h: 1 })]]) {
    const result = simulate(event([], { items }));
    assert.equal(result.stranded, 12);
    assert.equal(result.visits, 0);
    assert.ok(result.agents.every((agent) => agent.queueVisits.length === 0));
    assert.ok(result.findings.some((finding) => /reception/i.test(finding.title)));
  }
});

test("processing speed sets service duration while browsing continues off the queue", () => {
  const input = event([item("b", "booth", 10, 4, { dwell: 180, processingRate: 12 })],
    { visitors: 20, endTime: "09:10" });
  const result = simulate(input);
  const visits = result.agents.flatMap((agent) => agent.queueVisits
    .filter((visit) => visit.itemId === "b" && visit.serviceStart !== null)
    .map((visit) => ({ agent, visit }))).sort((a, b) => a.visit.serviceStart - b.visit.serviceStart);
  assert.ok(visits.length > 5);
  for (const { agent, visit } of visits)
    assert.equal((visit.serviceEnd - visit.serviceStart) * result.stepSeconds, 5 * agent.weight);
  assert.ok(visits.some(({ agent, visit }, i) => {
    const pause = agent.pauses.find((pause) => pause.itemId === "b");
    return pause?.end && visits[i + 1]?.visit.serviceStart < pause.end && pause.start >= visit.departed;
  }));
  const slower = simulate({ ...input, items: input.items.map((item) => item.id === "b" ? { ...item, processingRate: 1 } : item) });
  assert.ok(slower.queueWait > result.queueWait);
  assert.ok(slower.visits < result.visits);
});

test("seating causes pauses and restroom visits recur only after elapsed time", () => {
  const input = event([
    item("a", "booth", 7, 2, { dwell: 1800 }), item("b", "booth", 13, 2, { dwell: 1800 }),
    item("c", "booth", 19, 2, { dwell: 1800 }), item("seat", "seating", 7, 10, { dwell: 120 }),
    item("wc", "restroom", 17, 10),
  ], { visitors: 6, endTime: "13:00" });
  const result = simulate(input);
  assert.ok(result.agents.some((agent) => agent.pauses.some((pause) => pause.itemId === "seat" && pause.end !== null)));
  assert.ok(result.agents.some((agent) => agent.queueVisits.filter((visit) => visit.itemId === "wc").length >= 2));
  for (const agent of result.agents) {
    assert.ok(!agent.queueVisits.some((visit) => visit.itemId === "seat"));
    const visits = agent.queueVisits.filter((visit) => visit.itemId === "wc");
    if (visits.length) assert.ok((visits[0].joined - agent.start) * result.stepSeconds >= 3600);
    for (let i = 1; i < visits.length; i++) {
      assert.notEqual(visits[i - 1].departed, null);
      assert.ok((visits[i].joined - visits[i - 1].departed) * result.stepSeconds >= 3600);
    }
  }
});

test("visitors do not need a restroom in their first hour", () => {
  const result = simulate(event([
    item("stage", "stage", 10, 2, { stageSpotlight: 100, stageLingering: 7200 }),
    item("wc", "restroom", 17, 10),
  ], { visitors: 6, endTime: "10:00" }));
  assert.ok(result.agents.some((agent) => agent.pauses.some((pause) => pause.itemId === "stage")));
  assert.ok(result.agents.every((agent) => agent.queueVisits.every((visit) => visit.itemId !== "wc")));
});

test("food demand is staggered after opening and includes interrupted browsing", () => {
  const input = event([item("b", "booth", 10, 2, { dwell: 1800, processingRate: 120 }),
    item("food", "food", 10, 10, { processingRate: 30, foodAvailableAt: "09:20" })],
    { visitors: 60, endTime: "10:30" });
  const result = simulate(input), release = 1200 / result.stepSeconds;
  const visits = result.agents.flatMap((agent) => agent.queueVisits.filter((visit) => visit.itemId === "food"));
  assert.ok(visits.length >= 5);
  assert.ok(visits.every((visit) => visit.joined > release));
  assert.ok(new Set(visits.map((visit) => Math.floor(visit.joined * result.stepSeconds / 300))).size >= 3);
  assert.ok(result.agents.some((agent) => agent.pauses.filter((pause) => pause.itemId === "b").length >= 2));
  assert.ok(result.agents.every((agent) => agent.pauses.every((pause) => pause.end !== release)));
  const late = simulate({ ...input, items: input.items.map((item) => item.kind === "food" ? { ...item, foodAvailableAt: "11:00" } : item) });
  assert.ok(late.agents.every((agent) => !agent.queueVisits.some((visit) => visit.itemId === "food")));
});

test("all edited behavioral attributes invalidate comparison assumptions", () => {
  const input = event([item("b", "booth", 10, 4), item("food", "food", 10, 10)]);
  for (const change of [{ processingRate: 2 }, { dwell: 120 }, { popularity: 2.5 }, { category: "Games" }])
    assert.notEqual(assumptions(input), assumptions({ ...input, items: input.items.map((item) => item.id === "b" ? { ...item, ...change } : item) }));
  assert.notEqual(assumptions(input), assumptions({ ...input, items: input.items.map((item) => item.kind === "food" ? { ...item, foodAvailableAt: "09:15" } : item) }));
});


test("eating and satiety prevent repeated meals across adjacent serving windows", () => {
  const windows = [{ start: "09:10", end: "09:40" }, { start: "09:40", end: "10:10" },
    { start: "10:10", end: "10:40" }];
  const input = event([item("stage", "stage", 10, 2, { stageSpotlight: 100, stageLingering: 7200 }),
    item("food", "food", 10, 10, { processingRate: 30, foodAvailability: windows })],
    { visitors: 40, endTime: "11:00" });
  const result = simulate(input);
  const bounds = [[600, 2400], [2400, 4200], [4200, 6000]];
  const visits = result.agents.flatMap((agent) => agent.queueVisits.filter((visit) => visit.itemId === "food"));
  assert.ok(visits.length >= 5);
  assert.ok(visits.every((visit) => bounds.some(([start, end]) =>
    visit.joined * result.stepSeconds >= start && visit.joined * result.stepSeconds < end)));
  for (const agent of result.agents)
    assert.ok(agent.queueVisits.filter((visit) => visit.itemId === "food").length <= 1);
});

test("closed food windows admit nobody new but finish their existing queue", () => {
  const input = event([item("b", "booth", 10, 2, { dwell: 1800, processingRate: 120 }),
    item("food", "food", 10, 10, { processingRate: 1,
      foodAvailability: [{ start: "09:30", end: "09:40" }] })], { visitors: 60, endTime: "10:00" });
  const result = simulate(input);
  const visits = result.agents.flatMap((agent) => agent.queueVisits.filter((visit) => visit.itemId === "food"));
  assert.ok(visits.length >= 3);
  assert.ok(visits.every((visit) => visit.joined * result.stepSeconds >= 1800 && visit.joined * result.stepSeconds < 2400));
  assert.ok(visits.some((visit) => visit.departed !== null && visit.departed * result.stepSeconds > 2400));
  const closed = simulate({ ...input, items: input.items.map((i) => i.kind === "food" ? { ...i, foodAvailability: [] } : i) });
  assert.ok(closed.agents.every((agent) => agent.queueVisits.every((visit) => visit.itemId !== "food")));
});

test("meal schedules preserve older stations and validate multiple ranges", () => {
  const input = event([]);
  assert.deepEqual(foodAvailabilityFor(item("food", "food", 10, 10, { foodAvailableAt: "09:05" }), input),
    [{ start: "09:05", end: "09:20" }]);
  assert.equal(defaultFoodAvailability({ startTime: "08:00", endTime: "20:00" }).length, 3);
  assert.deepEqual(defaultFoodAvailability({ startTime: "15:00", endTime: "16:00" }), [{ start: "15:00", end: "16:00" }]);
  assert.equal(foodAvailabilityError([{ start: "12:00", end: "13:00" }, { start: "08:00", end: "10:00" }]), null);
  for (const windows of [[{ start: "10:00", end: "09:00" }], [{ start: "09:00", end: "09:00" }],
    [{ start: "25:00", end: "26:00" }], [{ start: "08:00", end: "10:00" }, { start: "09:00", end: "11:00" }]])
    assert.ok(foodAvailabilityError(windows));
  const food = item("food", "food", 10, 10, { foodAvailability: [{ start: "09:00", end: "09:05" }] });
  assert.notEqual(assumptions(event([food])), assumptions(event([{ ...food,
    foodAvailability: [{ start: "09:00", end: "09:10" }] }])));
});

test("stage spotlight draws a sustained audience without a service queue", () => {
  const stage = item("stage", "stage", 10, 6, { w: 5, h: 3, stageSpotlight: 100, stageLingering: 900 });
  const input = event([stage], { visitors: 24, endTime: "10:00" });
  const result = simulate(input);
  const watchers = result.agents.filter((agent) => agent.pauses.some((pause) => pause.itemId === "stage"));
  assert.equal(watchers.length, 24);
  assert.ok(result.agents.every((agent) => agent.queueVisits.every((visit) => visit.itemId === "reception")));
  const durations = watchers.flatMap((agent) => agent.pauses.filter((pause) => pause.itemId === "stage" && pause.end !== null)
    .map((pause) => (pause.end - pause.start) * result.stepSeconds));
  assert.ok(durations.length >= 12);
  assert.ok(durations.every((duration) => duration >= 400));
  assert.ok(durations.reduce((a, b) => a + b, 0) / durations.length > 600);
  assert.ok(!result.findings.some((finding) => finding.title === "No exhibitors yet"));
  for (const agent of watchers) {
    assert.equal(agent.route.filter((id) => id === "stage").length, 1);
    assert.ok(agent.pauses[0].start >= agent.queueVisits[0].departed);
  }
  const short = simulate({ ...input, items: [reception(), { ...stage, stageLingering: 60 }] });
  const shortDurations = short.agents.flatMap((agent) => agent.pauses.filter((pause) => pause.itemId === "stage" && pause.end !== null)
    .map((pause) => (pause.end - pause.start) * short.stepSeconds));
  assert.ok(Math.max(...shortDurations) < Math.min(...durations));
});

test("spotlight strength increases the audience and zero switches attraction off", () => {
  const counts = [0, 40, 100].map((stageSpotlight) => {
    const result = simulate(event([item("stage", "stage", 10, 6, { stageSpotlight, stageLingering: 120 })],
      { visitors: 30, endTime: "10:00" }));
    return result.agents.filter((agent) => agent.pauses.some((pause) => pause.itemId === "stage")).length;
  });
  assert.equal(counts[0], 0);
  assert.ok(counts[1] > 0 && counts[1] < counts[2]);
  assert.equal(counts[2], 30);
});

test("stage audiences return after a food break and inaccessible stages cannot attract them", () => {
  const stage = item("stage", "stage", 10, 2, { stageSpotlight: 100, stageLingering: 3600 });
  const result = simulate(event([stage, item("food", "food", 10, 10, { processingRate: 120,
    foodAvailability: [{ start: "09:20", end: "10:20" }] })], { visitors: 40, endTime: "11:00" }));
  assert.ok(result.agents.some((agent) => agent.queueVisits.some((visit) => visit.itemId === "food") &&
    agent.pauses.filter((pause) => pause.itemId === "stage").length >= 2));
  const blocked = simulate(event([stage, item("wall", "obstacle", 0, 7, { w: 24, h: 1 })], { endTime: "10:00" }));
  assert.ok(blocked.agents.every((agent) => !agent.route.includes("stage")));
  assert.ok(blocked.findings.some((finding) => finding.title.includes("audience area is blocked")));
});

test("editing either stage characteristic invalidates simulation comparisons", () => {
  const stage = item("stage", "stage", 10, 6);
  for (const change of [{ stageSpotlight: 20 }, { stageLingering: 1200 }])
    assert.notEqual(assumptions(event([stage])), assumptions(event([{ ...stage, ...change }])));
});

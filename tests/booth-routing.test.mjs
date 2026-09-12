import test from "node:test";
import assert from "node:assert/strict";
import { orderNearbyBooths } from "../lib/booth-routing.ts";
import { seedEvent } from "../lib/event.ts";
import { simulate } from "../lib/simulation.ts";

const booth = (id, x) => ({ id, kind: "booth", name: id, label: id, x, y: 8,
  w: 2, h: 2, company: id, category: id, popularity: 2, dwell: 20, processingRate: 120 });
const rngFor = (seed) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);

test("closer booths are favored without eliminating more distant choices", () => {
  const targets = [booth("near", 5), booth("far", 25)], rng = rngFor(17);
  let near = 0;
  for (let i = 0; i < 3000; i++) {
    const route = orderNearbyBooths(targets, { x: 0, y: 8 }, rng,
      (from, item) => Math.abs(from.x - item.x), (item) => item);
    if (route[0].id === "near") near++;
    assert.equal(new Set(route.map((item) => item.id)).size, 2);
  }
  assert.ok(near > 2500 && near < 2850, `near first: ${near}/3000`);
  assert.deepEqual(targets.map((item) => item.id), ["near", "far"]);
});

test("walking distance takes precedence over visual proximity; unreachable stops stay last", () => {
  const targets = [booth("behind-wall", 1), booth("open-aisle", 12), booth("unreachable", 2)];
  const distances = { "behind-wall": 60, "open-aisle": 12, unreachable: Infinity };
  const route = orderNearbyBooths(targets, { x: 0, y: 8 }, () => .5,
    (_from, item) => distances[item.id], (item) => item);
  assert.deepEqual(route.map((item) => item.id), ["open-aisle", "behind-wall", "unreachable"]);
  assert.deepEqual(orderNearbyBooths([], { x: 0, y: 0 }, () => .5, () => 0, (item) => item), []);
});

test("simulation starts nearer the assigned check-in desk and reverses when that desk moves", () => {
  const event = { ...seedEvent(), visitors: 120, startTime: "09:00", endTime: "10:00",
    entrance: { x: 1, y: 18 }, exit: { x: 28, y: 18 },
    items: [booth("left", 4), booth("right", 24),
      { ...booth("reception", 2), y: 13, kind: "reception", company: "", dwell: 10 }] };
  const left = simulate(event);
  const right = simulate({ ...event, items: event.items.map((item) => item.kind === "reception" ? { ...item, x: 26 } : item) });
  for (const [result, expected] of [[left, "left"], [right, "right"]]) {
    const both = result.agents.filter((agent) => agent.route.includes("left") && agent.route.includes("right"));
    assert.ok(both.length > 40);
    const closeFirst = both.filter((agent) => agent.route[1] === expected).length;
    assert.ok(closeFirst / both.length > .75, `${expected} first: ${closeFirst}/${both.length}`);
    assert.ok(result.agents.every((agent) => agent.route[0] === "reception"));
    assert.equal(result.stranded, 0);
  }
  for (let i = 0; i < left.agents.length; i++) {
    assert.deepEqual([...left.agents[i].route].sort(), [...right.agents[i].route].sort());
    assert.equal(left.agents[i].start, right.agents[i].start);
    assert.equal(left.agents[i].type, right.agents[i].type);
  }
});

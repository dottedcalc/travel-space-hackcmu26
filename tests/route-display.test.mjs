import test from "node:test";
import assert from "node:assert/strict";
import { spacedRoute } from "../lib/route-display.ts";

test("outbound and return passes have a visible gap and preserve endpoints", () => {
  const route = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }];
  const display = spacedRoute(route, .5);
  assert.equal(Math.abs(display[1].y - display[3].y), .5);
  assert.deepEqual(display[0], route[0]);
  assert.deepEqual(display.at(-1), route.at(-1));
});

test("three traversals get three separate lanes", () => {
  const display = spacedRoute([{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 1 }], .5);
  assert.deepEqual([display[1].x, display[3].x, display[5].x].sort(), [-.5, 0, .5]);
});

test("unique segments stay on the original path, and empty routes stay empty", () => {
  assert.deepEqual(spacedRoute([], .5), []);
  const display = spacedRoute([{ x: 1, y: 1 }, { x: 2, y: 1 }], .5);
  assert.ok(display.every(p => p.y === 1));
});

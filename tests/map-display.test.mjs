import test from "node:test";
import assert from "node:assert/strict";
import { gridMetersFor } from "../lib/map-display.ts";

test("grid squares use readable physical intervals as the map grows", () => {
  assert.equal(gridMetersFor(12, 8), 1);
  assert.equal(gridMetersFor(30, 20), 2);
  assert.equal(gridMetersFor(100, 70), 5);
  assert.equal(gridMetersFor(1000, 666.5), 50);
  assert.equal(gridMetersFor(1000, 1000), 100);
});

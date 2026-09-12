import test from "node:test";
import assert from "node:assert/strict";
import { referenceLayout } from "../lib/reference-layout.ts";
import { doorwayFor } from "../lib/map-display.ts";
import { allAccessPoints, canPlaceAccessPoint, validRoomShape } from "../lib/event.ts";
import { validPosition, simulate } from "../lib/simulation.ts";

test("reference floor plan has valid joined geometry, clear doors and editable objects", () => {
  const event = referenceLayout();
  assert.ok(validRoomShape(event));
  for (const item of event.items) assert.ok(validPosition(event, item), item.id);
  for (const point of allAccessPoints(event)) {
    assert.ok(canPlaceAccessPoint(event, point, point.id));
    assert.ok(doorwayFor(event, point));
  }
  assert.equal(event.items.filter((item) => item.kind === "booth").length, 10);
});

test("door symbols follow all four perimeter orientations and exclude interior markers", () => {
  const room = { width: 30, height: 20 };
  for (const [x, y, rotation] of [[10, 0, 0], [29.5, 8, 90], [10, 19.5, 180], [0, 8, 270]])
    assert.equal(doorwayFor(room, { x, y }).rotation, rotation);
  assert.equal(doorwayFor(room, { x: 10, y: 10 }), null);
  const corner = doorwayFor(room, { x: 0, y: 0 });
  assert.ok(corner.x >= corner.width / 2 || corner.y >= corner.width / 2);
  assert.equal(doorwayFor(referenceLayout(), { x: 35, y: 0 }), null);
});

test("reference layout supports check-in, visits and exit routes", () => {
  const event = referenceLayout();
  event.visitors = 24;
  event.items = event.items.map((item) => item.kind === "booth"
    ? { ...item, company: item.id, category: "Technology" } : item);
  const result = simulate(event);
  assert.equal(result.stranded, 0);
  assert.ok(result.finished > 0);
  assert.ok(result.visits > 0);
});

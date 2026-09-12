import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resizeRoom } from "../lib/event.ts";

const origin = process.env.FLOWPLAN_TEST_URL || "http://localhost:5173";
assert.ok(
  ["localhost", "127.0.0.1"].includes(new URL(origin).hostname),
  "Integration tests must use a local preview.",
);
const ids = [randomUUID(), randomUUID()];
let first, second;
async function request(path, options = {}) {
  const response = await fetch(origin + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const body = await response.text();
  let data;
  try { data = JSON.parse(body); }
  catch { data = { error: body }; }
  return { response, data };
}
before(async () => {
  const a = await request("/api/workspaces", {
    method: "POST",
    body: JSON.stringify({
      requestId: ids[0],
      name: "Integration fixture A",
      venue: "Test hall A",
      template: "sample",
    }),
  });
  const b = await request("/api/workspaces", {
    method: "POST",
    body: JSON.stringify({
      requestId: ids[1],
      name: "Integration fixture B",
      venue: "Test hall B",
      template: "blank",
    }),
  });
  assert.equal(a.response.status, 201);
  assert.equal(b.response.status, 201);
  first = (await request(`/api/workspaces/${ids[0]}`)).data;
  second = (await request(`/api/workspaces/${ids[1]}`)).data;
});
after(() => {
  // Remove only these generated local test fixtures; never change user workspaces.
  const query = `DELETE FROM events WHERE id IN (${ids.map((id) => `'${id}'`).join(",")})`;
  const cleanup = spawnSync(
    process.execPath,
    [
      "--import",
      "./scripts/sites-env.mjs",
      "./node_modules/wrangler/bin/wrangler.js",
      "d1",
      "execute",
      "DB",
      "--local",
      "--config",
      "dist/server/wrangler.json",
      "--persist-to",
      ".wrangler/state",
      "--command",
      query,
    ],
    { encoding: "utf8" },
  );
  assert.equal(
    cleanup.status,
    0,
    cleanup.stderr || "Could not remove local test workspaces",
  );
});
test("new workspaces persist independently and retries do not duplicate creation", async () => {
  assert.equal(first.event.name, "Integration fixture A");
  assert.equal(first.event.venue, "Test hall A");
  assert.equal(first.event.items.length, 13);
  assert.equal(second.event.items.length, 0);
  const retry = await request("/api/workspaces", {
    method: "POST",
    body: JSON.stringify({
      requestId: ids[0],
      name: "Integration fixture A",
      venue: "Test hall A",
      template: "sample",
    }),
  });
  assert.equal(retry.response.status, 201);
  const list = (await request("/api/workspaces")).data.workspaces;
  assert.equal(list.filter((w) => w.id === ids[0]).length, 1);
});
test("editing a layout changes only its own workspace", async () => {
  const updated = structuredClone(first);
  updated.event.items.find((i) => i.id === "b3").y = 3;
  const save = await request(`/api/workspaces/${ids[0]}`, {
    method: "PUT",
    body: JSON.stringify(updated),
  });
  assert.equal(save.response.status, 200);
  const stored = (await request(`/api/workspaces/${ids[0]}`)).data;
  assert.equal(stored.event.items.find((i) => i.id === "b3").y, 3);
  assert.deepEqual((await request(`/api/workspaces/${ids[1]}`)).data, second);
});
test("new booth and exhibitor categories must come from the fixed list", async () => {
  const path = `/api/workspaces/${ids[0]}`;
  const current = (await request(path)).data;
  const registration = await request(`${path}/companies`, {
    method: "POST",
    body: JSON.stringify({ revision: current.revision, name: "Invalid category fixture", category: "Robotics" }),
  });
  assert.equal(registration.response.status, 400);
  const invalid = structuredClone(current);
  invalid.event.items.find((item) => item.id === "b1").category = "Custom category";
  assert.equal((await request(path, { method: "PUT", body: JSON.stringify(invalid) })).response.status, 400);
  assert.deepEqual((await request(path)).data, current);
});
test("competing claims have one winner and cannot change venue geometry", async () => {
  const current = (await request(`/api/workspaces/${ids[0]}`)).data;
  const added = await request(`/api/workspaces/${ids[0]}/companies`, {
    method: "POST",
    body: JSON.stringify({ revision: current.revision, name: "Fixture Robotics", category: "Technology" }),
  });
  assert.equal(added.response.status, 200);
  const companyId = added.data.event.companies.find(c => c.name === "Fixture Robotics").id;
  const profiled = await request(`/api/workspaces/${ids[0]}/rsvp`, { method: "PATCH", body: JSON.stringify({
    action: "profile", revision: added.data.revision, companyId,
    profile: { popularity: 3, peakRate: 1, dwell: 30, staff: 1, equipmentArea: 0, storageArea: 0, serviceRate: 6, minimumArea: 0,
      preferredLocation: "any", preferredNeighbors: [], avoidNeighbors: [], source: "estimated" },
  }) });
  assert.equal(profiled.response.status, 200);
  const reservation = { revision: profiled.data.revision, companyId, seatId: "b5", size: { name: "Medium", w: 5, h: 3 },
    requestId: randomUUID(), undersizedAcknowledged: true, scenarios: [{ seatId: "b5", label: "B05", metrics: {
      visitors: 0, intended: 0, missedRate: 0, queueSeconds: 0, exposure: 0, density: 0, coverage: 0, balance: 0,
      neighborVisitChange: 0, companyScore: 0, venueScore: 0, score: 0,
    } }] };
  const claims = await Promise.all([
    request(`/api/workspaces/${ids[0]}/rsvp`, { method: "POST", body: JSON.stringify(reservation) }),
    request(`/api/workspaces/${ids[0]}/rsvp`, { method: "POST", body: JSON.stringify({ ...reservation, requestId: randomUUID() }) }),
  ]);
  assert.deepEqual(claims.map((r) => r.response.status).sort(), [200, 409]);
  const stored = (await request(`/api/workspaces/${ids[0]}`)).data;
  const booth = stored.event.items.find((i) => i.id === "b5");
  assert.equal(booth.company, "Fixture Robotics");
  assert.equal(booth.x, 2);
  assert.equal(booth.y, 8);
  assert.deepEqual((await request(`/api/workspaces/${ids[1]}`)).data, second);
  const invalid = await request(`/api/workspaces/${ids[0]}/claims`, {
    method: "POST",
    body: JSON.stringify({
      revision: stored.revision,
      boothId: "b6",
      company: "Other",
      category: "Tech",
      popularity: 2,
      x: 29,
    }),
  });
  assert.equal(invalid.response.status, 409);
  const released = await request(`/api/workspaces/${ids[0]}/claims`, {
    method: "DELETE",
    body: JSON.stringify({ revision: stored.revision, boothId: "b5", company: "Fixture Robotics" }),
  });
  assert.equal(released.response.status, 200);
  assert.equal(released.data.event.items.find((i) => i.id === "b5").company, "");
  assert.ok(released.data.event.companies.some((entry) => entry.name === "Fixture Robotics"));
  const repeated = await request(`/api/workspaces/${ids[0]}/claims`, {
    method: "DELETE",
    body: JSON.stringify({ revision: released.data.revision, boothId: "b5", company: "Fixture Robotics" }),
  });
  assert.equal(repeated.response.status, 409);
  const requeued = await request(`/api/workspaces/${ids[0]}/rsvp`, { method: "PATCH", body: JSON.stringify({
    action: "requeue", companyId, revision: released.data.revision,
  }) });
  assert.equal(requeued.response.status, 200);
  const reclaimed = await request(`/api/workspaces/${ids[0]}/rsvp`, {
    method: "POST", body: JSON.stringify({ ...reservation, requestId: randomUUID(), revision: requeued.data.revision }),
  });
  assert.equal(reclaimed.response.status, 200);
});
test("renaming an exhibit updates its reserved booths and rejects conflicts", async () => {
  const path = `/api/workspaces/${ids[0]}/companies`;
  const current = (await request(`/api/workspaces/${ids[0]}`)).data;
  const rename = (revision, oldName, name) => request(path, {
    method: "PATCH", body: JSON.stringify({ revision, oldName, name }),
  });
  assert.equal((await rename(current.revision, "Fixture Robotics", "Exhibit 01")).response.status, 409);
  assert.equal((await rename(current.revision, "Fixture Robotics", " ")).response.status, 400);
  assert.equal((await rename(current.revision - 1, "Fixture Robotics", "New Robotics")).response.status, 409);
  const saved = await rename(current.revision, "Fixture Robotics", "New Robotics");
  assert.equal(saved.response.status, 200);
  assert.equal(saved.data.event.items.find((item) => item.id === "b5").company, "New Robotics");
  assert.ok(saved.data.event.companies.some((entry) => entry.name === "New Robotics" && entry.category === "Technology"));
  assert.ok(!saved.data.event.companies.some((entry) => entry.name === "Fixture Robotics"));
  const stored = (await request(`/api/workspaces/${ids[0]}`)).data;
  assert.equal(stored.event.items.find((item) => item.id === "b5").company, "New Robotics");
  assert.equal((await rename(saved.data.revision, "New Robotics", "new robotics")).response.status, 200);
  assert.deepEqual((await request(`/api/workspaces/${ids[1]}`)).data, second);
});
test("missing workspaces and invalid creation are rejected", async () => {
  assert.equal(
    (await request("/api/workspaces/missing-test-workspace")).response.status,
    404,
  );
  const invalid = await request("/api/workspaces", {
    method: "POST",
    body: JSON.stringify({
      requestId: randomUUID(),
      name: "  ",
      venue: "Hall",
      template: "blank",
    }),
  });
  assert.equal(invalid.response.status, 400);
  for (const role of ["organizer", "exhibitioner", "visitor"])
    assert.equal(
      (await fetch(`${origin}/workspaces/${ids[0]}/${role}`)).status,
      200,
    );
  assert.equal(
    (await fetch(`${origin}/workspaces/${ids[0]}/invalid-role`)).status,
    404,
  );
});
test("joined room rectangles persist, invalid room shapes are rejected", async () => {
  const current = (await request(`/api/workspaces/${ids[1]}`)).data;
  const stage = {
    ...first.event.items[0], id: "composite-stage", kind: "stage", label: "G01",
    x: 10, y: 10, w: 6, h: 4, company: "",
  };
  const roomRectangles = [
    { x: 0, y: 0, w: 40, h: 10 }, { x: 0, y: 10, w: 20, h: 15 },
  ];
  const next = {
    ...current,
    event: { ...current.event, venue: "L-shaped room", width: 40, height: 25,
      roomRectangles, items: [stage] },
  };
  const saved = await request(`/api/workspaces/${ids[1]}`, { method: "PUT", body: JSON.stringify(next) });
  assert.equal(saved.response.status, 200);
  const stored = (await request(`/api/workspaces/${ids[1]}`)).data;
  assert.equal(stored.event.width, 40);
  assert.equal(stored.event.venue, "L-shaped room");
  assert.deepEqual(stored.event.roomRectangles, roomRectangles);
  assert.equal(stored.event.items[0].rectangles, undefined);
  const listed = (await request("/api/workspaces")).data.workspaces.find((workspace) => workspace.id === ids[1]);
  assert.equal(listed.width, 40);
  assert.equal(listed.height, 25);
  assert.deepEqual(listed.roomRectangles, roomRectangles);
  const disconnected = structuredClone(stored);
  disconnected.event.roomRectangles[1] = { x: 25, y: 12, w: 15, h: 13 };
  assert.equal((await request(`/api/workspaces/${ids[1]}`, {
    method: "PUT", body: JSON.stringify(disconnected),
  })).response.status, 400);
  const tooSmall = structuredClone(stored);
  tooSmall.event.roomRectangles[1] = { x: 0, y: 10, w: 8, h: 15 };
  assert.equal((await request(`/api/workspaces/${ids[1]}`, {
    method: "PUT", body: JSON.stringify(tooSmall),
  })).response.status, 400);
  const larger = structuredClone(stored);
  larger.event = resizeRoom(stored.event, 1000, 625);
  assert.ok(larger.event);
  assert.equal((await request(`/api/workspaces/${ids[1]}`, {
    method: "PUT", body: JSON.stringify(larger),
  })).response.status, 200);
  const scaled = (await request(`/api/workspaces/${ids[1]}`)).data.event;
  assert.equal(scaled.width, 1000);
  assert.equal(scaled.height, 625);
  assert.equal(scaled.roomRectangles[1].w, 500);
  assert.equal(scaled.items[0].w, 150);
  larger.event.width = 1000.5;
  assert.equal((await request(`/api/workspaces/${ids[1]}`, {
    method: "PUT", body: JSON.stringify(larger),
  })).response.status, 400);
});
test("multiple access points and their percentages persist with validation", async () => {
  const current = (await request(`/api/workspaces/${ids[0]}`)).data;
  const updated = structuredClone(current);
  updated.event.entrances = [
    { id: "entrance-1", ...updated.event.entrance, flow: 70 },
    { id: "entrance-2", x: 28, y: 19, flow: 30 },
  ];
  updated.event.exits = [
    { id: "exit-1", ...updated.event.exit, flow: 40 },
    { id: "exit-2", x: 1, y: 1, flow: 60 },
  ];
  const saved = await request(`/api/workspaces/${ids[0]}`, {
    method: "PUT", body: JSON.stringify(updated),
  });
  assert.equal(saved.response.status, 200);
  const stored = (await request(`/api/workspaces/${ids[0]}`)).data;
  assert.deepEqual(stored.event.entrances, updated.event.entrances);
  assert.deepEqual(stored.event.exits, updated.event.exits);
  const organizerPage = await fetch(`${origin}/workspaces/${ids[0]}/organizer`).then((response) => response.text());
  assert.match(organizerPage, /Entrance 2 location, 30% of arrivals/);
  assert.match(organizerPage, /Exit 2 location, 60% of departures/);
  const invalid = structuredClone(stored);
  invalid.event.entrances[1].flow = 0;
  assert.equal((await request(`/api/workspaces/${ids[0]}`, {
    method: "PUT", body: JSON.stringify(invalid),
  })).response.status, 400);
  invalid.event.entrances[1].flow = 30;
  invalid.event.entrances[1].x = invalid.event.exits[1].x;
  invalid.event.entrances[1].y = invalid.event.exits[1].y;
  assert.equal((await request(`/api/workspaces/${ids[0]}`, {
    method: "PUT", body: JSON.stringify(invalid),
  })).response.status, 400);
});
test("object behavior edits persist and reject invalid processing rates", async () => {
  const path = `/api/workspaces/${ids[0]}`;
  const current = (await request(path)).data;
  const updated = structuredClone(current);
  Object.assign(updated.event.items.find((item) => item.id === "b1"), {
    processingRate: 7.5, dwell: 900, popularity: 2.36, category: "Games",
  });
  const desk = updated.event.items.find((item) => item.kind === "reception");
  desk.processingRate = 30;
  // Exercise the optional availability field on a food object without adding geometry.
  const food = updated.event.items.find((item) => item.id === "b2");
  Object.assign(food, { kind: "food", foodAvailableAt: "12:30", processingRate: 4.5 });
  const saved = await request(path, { method: "PUT", body: JSON.stringify(updated) });
  assert.equal(saved.response.status, 200);
  const stored = (await request(path)).data;
  const booth = stored.event.items.find((item) => item.id === "b1");
  assert.equal(booth.processingRate, 7.5);
  assert.equal(booth.dwell, 900);
  assert.equal(booth.popularity, 2.36);
  assert.equal(booth.category, "Games");
  assert.equal(stored.event.items.find((item) => item.id === desk.id).processingRate, 30);
  assert.equal(stored.event.items.find((item) => item.id === food.id).foodAvailableAt, "12:30");
  for (const value of [0, -1, 121]) {
    const invalid = structuredClone(stored);
    invalid.event.items[0].processingRate = value;
    assert.equal((await request(path, { method: "PUT", body: JSON.stringify(invalid) })).response.status, 400);
  }
  const invalidTime = structuredClone(stored);
  invalidTime.event.items.find((item) => item.id === food.id).foodAvailableAt = "25:99";
  assert.equal((await request(path, { method: "PUT", body: JSON.stringify(invalidTime) })).response.status, 400);
});
test("removing a workspace leaves others intact and protects the sample", async () => {
  const protectedResult = await request("/api/workspaces/main", { method: "DELETE" });
  assert.equal(protectedResult.response.status, 403);
  const crossOrigin = await request(`/api/workspaces/${ids[1]}`, {
    method: "DELETE",
    headers: { Origin: "https://example.com" },
  });
  assert.equal(crossOrigin.response.status, 403);
  const removed = await fetch(`${origin}/api/workspaces/${ids[1]}`, { method: "DELETE" });
  assert.equal(removed.status, 204);
  assert.equal((await request(`/api/workspaces/${ids[1]}`)).response.status, 404);
  assert.equal((await request(`/api/workspaces/${ids[0]}`)).response.status, 200);
  assert.equal((await request(`/api/workspaces/${ids[1]}`, { method: "DELETE" })).response.status, 404);
});

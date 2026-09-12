import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const origin = process.env.FLOWPLAN_TEST_URL || "http://localhost:5173";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname), "Use a local preview for integration tests.");

async function request(path, method = "GET", body, headers = {}) {
  const response = await fetch(origin + path, {
    method, headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; }
  catch { data = { error: text }; }
  return { status: response.status, data };
}

test("workspace renaming persists, isolates changes, validates input, and protects concurrent edits", async () => {
  const ids = [randomUUID(), randomUUID()];
  try {
    for (const id of ids) {
      const created = await request("/api/workspaces", "POST", {
        requestId: id, name: "Rename fixture", venue: "Test venue", template: "sample",
      });
      assert.equal(created.status, 201);
      assert.equal(created.data.workspace.revision, 0);
    }
    const path = `/api/workspaces/${ids[0]}`;
    const before = (await request(path)).data;
    const other = (await request(`/api/workspaces/${ids[1]}`)).data;
    for (const name of ["", "   ", "a".repeat(81), null, 123])
      assert.equal((await request(path, "PATCH", { name, revision: before.revision })).status, 400);
    assert.equal((await request(path, "PATCH", { name: "New name" })).status, 400);
    assert.equal((await request(path, "PATCH", { name: "New name", revision: 0, event: {} })).status, 400);
    assert.equal((await request(path, "PATCH", { name: "New name", revision: 0 }, { Origin: "https://example.com" })).status, 403);
    assert.equal((await request(path, "PATCH", { name: "a".repeat(5000), revision: 0 })).status, 413);
    const malformed = await fetch(origin + path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{" });
    assert.equal(malformed.status, 400);
    assert.deepEqual((await request(path)).data, before);

    const renamed = await request(path, "PATCH", { name: "  Robotics Expo 2026  ", revision: before.revision });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.data.workspace.name, "Robotics Expo 2026");
    assert.equal(renamed.data.workspace.id, ids[0]);
    const stored = (await request(path)).data;
    assert.deepEqual(stored, { ...before, revision: before.revision + 1, event: { ...before.event, name: "Robotics Expo 2026" } });
    const list = (await request("/api/workspaces")).data.workspaces;
    assert.equal(list.find(w => w.id === ids[0]).name, "Robotics Expo 2026");
    assert.equal(list.find(w => w.id === ids[0]).revision, stored.revision);
    // An organizer with an old copy must not silently undo the new name.
    assert.equal((await request(path, "PUT", before)).status, 409);
    assert.equal((await request(path, "PATCH", { name: "Stale rename", revision: before.revision })).status, 409);

    const competing = await Promise.all(["First name", "Second name"].map(name =>
      request(path, "PATCH", { name, revision: stored.revision })));
    assert.deepEqual(competing.map(r => r.status).sort(), [200, 409]);
    const winner = competing.find(r => r.status === 200).data.workspace;
    assert.equal((await request(path)).data.event.name, winner.name);
    assert.deepEqual((await request(`/api/workspaces/${ids[1]}`)).data, other);
    assert.equal((await request(`/api/workspaces/${randomUUID()}`, "PATCH", { name: "Missing", revision: 0 })).status, 404);
  } finally {
    for (const id of ids) await request(`/api/workspaces/${id}`, "DELETE");
  }
});

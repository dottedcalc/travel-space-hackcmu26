import test from "node:test";
import assert from "node:assert/strict";
import { startSimulationJob } from "../lib/simulation-job.ts";

function fixture(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const updates = [], results = [], errors = [];
  const worker = {
    terminated: 0,
    postMessage(event) { this.input = event; },
    terminate() { this.terminated++; },
  };
  const callbacks = {
    onProgress: (value) => updates.push(value),
    onComplete: (value) => results.push(value),
    onError: (value) => errors.push(value),
  };
  const event = { visitors: 2000 };
  const start = (factory = () => worker) => startSimulationJob(factory, event, callbacks, 1000);
  return { worker, event, updates, results, errors, start };
}

test("progress keeps a long simulation alive without completing it", (t) => {
  const { worker, event, updates, results, errors, start } = fixture(t);
  start();
  assert.equal(worker.input, event);
  for (const progress of [0, 25, 50, 85, 95]) {
    t.mock.timers.tick(900);
    worker.onmessage({ data: { progress } });
    assert.equal(worker.terminated, 0);
    assert.equal(results.length, 0);
  }
  const simulation = { agents: [], visits: 5 };
  worker.onmessage({ data: { simulation } });
  t.mock.timers.tick(2000);
  assert.deepEqual(updates, [0, 25, 50, 85, 95]);
  assert.deepEqual(results, [simulation]);
  assert.deepEqual(errors, []);
  assert.equal(worker.terminated, 1);
});

test("a silent or stalled worker fails and releases the loading state", (t) => {
  const { worker, errors, results, start } = fixture(t);
  start();
  worker.onmessage({ data: { progress: 40 } });
  t.mock.timers.tick(1000);
  assert.match(errors[0], /stopped responding/);
  assert.equal(worker.terminated, 1);
  assert.deepEqual(results, []);
});

test("cancel ignores late messages and errors, and a new run can finish", (t) => {
  const { worker, errors, results, start } = fixture(t);
  const job = start();
  const lateMessage = worker.onmessage, lateError = worker.onerror;
  job.cancel();
  job.cancel();
  lateMessage({ data: { simulation: { agents: [] } } });
  lateError({});
  t.mock.timers.tick(2000);
  assert.equal(worker.terminated, 1);
  assert.deepEqual(errors, []);
  assert.deepEqual(results, []);
  start();
  worker.onmessage({ data: { simulation: { agents: [] } } });
  assert.equal(results.length, 1);
});

for (const kind of ["onerror", "onmessageerror", "invalid", "reported"]) {
  test(`${kind} worker failures terminate the run`, (t) => {
    const { worker, errors, start } = fixture(t);
    start();
    if (kind === "invalid") worker.onmessage({ data: null });
    else if (kind === "reported") worker.onmessage({ data: { error: "Calculation failed" } });
    else worker[kind]({});
    t.mock.timers.tick(2000);
    assert.equal(worker.terminated, 1);
    assert.equal(errors.length, 1);
    if (kind === "reported") assert.equal(errors[0], "Calculation failed");
  });
}

test("startup and message-cloning exceptions recover immediately", (t) => {
  const { worker, errors, start } = fixture(t);
  start(() => { throw new Error("Worker unavailable"); });
  worker.postMessage = () => { throw new Error("Cannot clone"); };
  start();
  t.mock.timers.tick(2000);
  assert.equal(errors.length, 2);
  assert.equal(worker.terminated, 1);
});

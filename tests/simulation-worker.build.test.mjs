import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { bookedEvent } from "./simulation-fixture.mjs";

const publicDirectory = new URL("../dist/client/", import.meta.url);
let workerSource;

test("the built simulation worker loads from the website, not a local file URL", async () => {
  const chunkDirectory = new URL("_next/static/chunks/", publicDirectory);
  const chunks = await readdir(chunkDirectory);
  const bundle = await readFile(new URL(chunks.find((name) => name.startsWith("event-workspace-")), chunkDirectory), "utf8");
  const match = bundle.match(/new Worker\([`"']([^`"']*simulation-worker[^`"']*)[`"']/);
  assert.ok(match, "The built worker must use a browser-loadable asset URL");
  const url = new URL(match[1], "https://example.test/workspaces/main/organizer");
  assert.equal(url.origin, "https://example.test");
  assert.ok(url.pathname.startsWith("/_next/static/"));
  workerSource = await readFile(new URL(url.pathname.slice(1), publicDirectory), "utf8");
  assert.ok(workerSource.length > 0);
});

test("the production worker starts and returns a complete queued simulation", { timeout: 30000 }, async () => {
  assert.ok(workerSource);
  // Bridge the browser message API to an actual isolated worker thread.
  const worker = new Worker(`
    const { parentPort, workerData } = require("node:worker_threads");
    const vm = require("node:vm");
    globalThis.self = { postMessage: (data) => parentPort.postMessage(data) };
    vm.runInThisContext(workerData);
    parentPort.on("message", (data) => self.onmessage({ data }));
  `, { eval: true, workerData: workerSource });
  try {
    const event = { ...bookedEvent(), visitors: 40, startTime: "09:00", endTime: "09:10" };
    const progress = [];
    const response = new Promise((resolve, reject) => {
      worker.on("message", (message) => {
        if (typeof message.progress === "number") progress.push(message.progress);
        else resolve(message);
      });
      worker.once("error", reject);
      worker.once("exit", (code) => { if (code) reject(new Error(`Worker exited: ${code}`)); });
    });
    worker.postMessage(event);
    const message = await response;
    assert.equal(message.error, undefined);
    assert.equal(progress[0], 0);
    assert.ok(progress.includes(95));
    assert.equal(message.simulation.agents.length, event.visitors);
    assert.ok(message.simulation.visits > 0);
    assert.ok(message.simulation.queueWait > 0);
    assert.ok(message.simulation.agents.some((agent) => agent.queueVisits.length));
  } finally {
    await worker.terminate();
  }
});

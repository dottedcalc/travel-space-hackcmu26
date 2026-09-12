import test from "node:test";
import assert from "node:assert/strict";
import { queueWaitPersonSteps } from "../lib/queue-wait.ts";
import { simulateWithReception, bookedEvent } from "./simulation-fixture.mjs";

const visit = { itemId: "booth", joined: 0, serviceStart: 20, serviceEnd: 120, departed: 120 };

test("ten sequential visitors include their waits behind others in the group", () => {
  // Starts at 20, 30, ..., 110 seconds: average wait is 65, not 20.
  assert.equal(queueWaitPersonSteps(10, visit, 150) / 10, 65);
  assert.equal(queueWaitPersonSteps(1, visit, 150), 20);
});

test("closing caps each person's wait, including during partial group service", () => {
  const unfinished = { ...visit, departed: null };
  // Three people start at 20, 30, 40; seven are still waiting at 45.
  assert.equal(queueWaitPersonSteps(10, unfinished, 45), 405);
  assert.equal(queueWaitPersonSteps(10, unfinished, 30), 290);
  assert.equal(queueWaitPersonSteps(10, unfinished, 20), 200);
  assert.equal(queueWaitPersonSteps(10, unfinished, 10), 100);
  assert.equal(queueWaitPersonSteps(10, { ...unfinished, serviceStart: null }, 45), 450);
  assert.equal(queueWaitPersonSteps(10, { ...visit, joined: 5 }, 0), 0);
});

test("completed older visits use departure when planned service end is absent", () => {
  const older = { ...visit };
  delete older.serviceEnd;
  assert.equal(queueWaitPersonSteps(10, older, 150), 650);
});

test("simulation average agrees with individually enumerated service starts", () => {
  const base = bookedEvent();
  const event = { ...base, width: 14, height: 12, visitors: 2000,
    startTime: "09:00", endTime: "09:03", entrance: { x: 2, y: 10 }, exit: { x: 12, y: 10 },
    items: [{ ...base.items[0], x: 5, y: 2, w: 4, h: 2, dwell: 10, processingRate: 6 }],
  };
  const result = simulateWithReception(event);
  let total = 0, people = 0, oldTotal = 0;
  assert.ok(result.agents.some(a => a.weight > 1 && a.queueVisits.some(q => q.serviceStart !== null)));
  for (const a of result.agents) for (const q of a.queueVisits) {
    for (let person = 0; person < a.weight; person++) {
      const start = q.serviceStart === null ? result.duration :
        q.serviceStart + person * (q.serviceEnd - q.serviceStart) / a.weight;
      total += (Math.min(start, result.duration) - q.joined) * result.stepSeconds;
      oldTotal += ((q.serviceStart ?? result.duration) - q.joined) * result.stepSeconds;
      people++;
    }
  }
  assert.equal(result.queueWait, Math.round(total / people));
  assert.ok(total > oldTotal);
});

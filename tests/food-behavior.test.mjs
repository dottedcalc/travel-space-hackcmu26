import test from "node:test";
import assert from "node:assert/strict";
import { createFoodProfile, foodChoiceCost, mealReadyAt } from "../lib/food-behavior.ts";
import { seedEvent } from "../lib/event.ts";
import { simulate } from "../lib/simulation.ts";

const object = (id, kind, x, y, extra = {}) => ({
  id, label: id, name: id, kind, x, y, w: 2, h: 2,
  company: kind === "booth" ? id : "", category: id,
  popularity: 2, dwell: 1800, processingRate: 120, ...extra,
});
const fixture = (extra = [], settings = {}) => ({ ...seedEvent(), width: 24, height: 20,
  entrance: { x: 1, y: 18 }, exit: { x: 22, y: 18 }, visitors: 40,
  startTime: "09:00", endTime: "11:00", items: [
    object("reception", "reception", 2, 2),
    object("stage", "stage", 10, 2, { stageSpotlight: 100, stageLingering: 7200 }),
    object("food", "food", 10, 12, { processingRate: 30,
      foodAvailability: [{ start: "09:20", end: "15:00" }] }), ...extra,
  ], ...settings,
});

test("meal times are personal, reproducible, arrival-aware, and spread after opening", () => {
  const window = { start: 3600, end: 7200 };
  const ready = Array.from({ length: 100 }, (_, id) => {
    const profile = createFoodProfile(id, 0);
    assert.deepEqual(profile, createFoodProfile(id, 0));
    assert.equal(createFoodProfile(id, 1800).nextMeal, profile.nextMeal + 1800);
    const time = mealReadyAt(profile, window);
    assert.ok(time >= profile.nextMeal && time > window.start && time < window.end);
    return time;
  });
  assert.ok(new Set(ready.map(time => Math.floor(time / 300))).size >= 5);
  assert.ok(mealReadyAt(createFoodProfile(0, 7200), window) >= window.end);
});

test("station preferences are stable but a long queue can outweigh a shorter walk", () => {
  for (let id = 0; id < 100; id++) {
    const profile = createFoodProfile(id, 0);
    const near = foodChoiceCost(profile, "near", 10, 1200, 60);
    const far = foodChoiceCost(profile, "far", 120, 0, 2);
    assert.ok(far < near);
    assert.equal(foodChoiceCost(profile, "near", 10, 0, 60), near - 1200);
  }
});

test("food service is followed by eating at seating, then the interrupted activity resumes", () => {
  const result = simulate(fixture([object("seat", "seating", 17, 12)]));
  let completedMeals = 0, resumed = 0;
  for (const agent of result.agents) {
    const meal = agent.queueVisits.find(visit => visit.itemId === "food" && visit.departed !== null);
    if (!meal) continue;
    const eating = agent.pauses.find(pause => pause.activity === "eating");
    if (!eating) continue; // May still be walking to a seat at event close.
    assert.equal(eating.itemId, "seat");
    assert.ok(eating.start >= meal.departed);
    assert.ok(!agent.queueVisits.some(visit => visit.itemId === "seat"));
    if (eating.end === null) continue;
    completedMeals++;
    const seconds = (eating.end - eating.start) * result.stepSeconds;
    assert.ok(seconds >= 600 && seconds <= 1500 + result.stepSeconds);
    if (agent.pauses.some(pause => pause.itemId === "stage" && pause.start >= eating.end)) resumed++;
  }
  assert.ok(completedMeals >= 5);
  assert.ok(resumed >= 3);
});

test("visitors eat near food when no seating exists and can return after satiety wears off", () => {
  const booths = Array.from({ length: 6 }, (_, index) =>
    object(`b${index}`, "booth", 3 + index % 3 * 7, 6 + Math.floor(index / 3) * 3));
  const result = simulate(fixture(booths, { visitors: 24, endTime: "15:00" }));
  let repeats = 0;
  for (const agent of result.agents) {
    const meals = agent.queueVisits.filter(visit => visit.itemId === "food");
    const eating = agent.pauses.filter(pause => pause.activity === "eating");
    assert.ok(eating.every(pause => pause.itemId === "food"));
    if (meals.length > 1) repeats++;
    for (let index = 1; index < meals.length; index++) {
      const previous = eating.find(pause => pause.start >= meals[index - 1].departed && pause.end !== null);
      assert.ok(previous);
      assert.ok((meals[index].joined - previous.end) * result.stepSeconds >= 7200);
    }
  }
  assert.ok(repeats > 0);
});

test("a slow food queue shifts demand toward an alternative station", () => {
  const input = fixture([object("other-food", "food", 18, 12, { processingRate: 60,
    foodAvailability: [{ start: "09:20", end: "15:00" }] })], { visitors: 80 });
  const baseline = simulate(input);
  const crowded = simulate({ ...input, items: input.items.map(item =>
    item.id === "food" ? { ...item, processingRate: 0.5 } : item) });
  const count = result => result.agents.filter(agent => agent.queueVisits.some(visit => visit.itemId === "other-food")).length;
  assert.ok(count(crowded) > count(baseline));
});

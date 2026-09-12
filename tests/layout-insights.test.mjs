import test from "node:test";
import assert from "node:assert/strict";
import { seedEvent, objectPresets } from "../lib/event.ts";
import { accessPoints, findPath, inspectLayout } from "../lib/simulation.ts";
import { evaluateLayoutInsights, rateLayout, stationMetrics } from "../lib/layout-insights.ts";

const item = (id, kind, x, y, extras = {}) => ({ ...objectPresets[kind], id, kind, x, y, w: 2, h: 2,
  label: id, name: id, company: kind === "booth" ? id : "", category: id, ...extras });
function event(items = []) {
  return { ...seedEvent(), width: 50, height: 20, roomRectangles: undefined, entrances: undefined, exits: undefined,
    entrance: { x: 0.5, y: 10 }, exit: { x: 49, y: 10 }, clearance: 1,
    items: [item("reception", "reception", 1, 1), ...items] };
}
const sim = (agents = [], extras = {}) => ({ agents, duration: 100, stepSeconds: 1, findings: [], stranded: 0,
  peakLocalDensity: [], ...extras });
const agent = (weight, route, queueVisits) => ({ weight, route, queueVisits });

test("blocked service frontage is caught even when a booth side is reachable", () => {
  const booth = item("booth", "booth", 10, 3);
  const e = event([booth, item("wall", "obstacle", 10, 5, { h: 1 })]);
  assert.ok(findPath(e, e.entrance, accessPoints(e, booth)).length);
  assert.ok(inspectLayout(e).some(f => f.itemId === "booth" && f.title.endsWith("is unreachable")));
  const findings = evaluateLayoutInsights(e);
  assert.ok(findings.some(f => f.category === "access" && f.detail.includes("service front")));
  assert.ok(findings.every(f => f.source === "layout"));
});

test("all narrow object gaps are reported with stable, distinct suggestion identities", () => {
  const e = event([item("a", "obstacle", 5, 5), item("b", "obstacle", 7.5, 5), item("c", "obstacle", 10, 5)]);
  const findings = evaluateLayoutInsights(e).filter(f => f.title.includes("gap"));
  assert.equal(findings.length, 2);
  assert.equal(new Set(findings.map(f => f.id)).size, 2);
  assert.ok(findings.every(f => f.suggestion.includes("0.5 m")));
});

test("weighted queue metrics include waiting at closing and partial group service", () => {
  const result = sim([
    agent(10, ["b"], [{ itemId: "b", joined: 0, serviceStart: 0, serviceEnd: 200, departed: null }]),
    agent(2, ["b"], [{ itemId: "b", joined: 20, serviceStart: null, serviceEnd: null, departed: null }]),
    agent(3, ["b"], []),
  ]);
  const metric = stationMetrics(result).get("b");
  assert.equal(metric.intended, 15);
  assert.equal(metric.admitted, 12);
  assert.equal(metric.served, 5);
  assert.equal(metric.remaining, 7);
  assert.ok(metric.waitSeconds > 0);
});

test("inaccessible booths produce unmet-interest findings, never a positive performance recommendation", () => {
  const e = event([item("b", "booth", 10, 3), item("wall", "obstacle", 10, 5, { h: 1 })]);
  const findings = evaluateLayoutInsights(e, sim([agent(20, ["b"], [])]));
  const completion = findings.find(f => f.id === "completion:b");
  assert.equal(completion.level, "warning");
  assert.match(completion.detail, /0% of 20/);
  assert.match(completion.suggestion, /Open access/);
  assert.ok(!findings.some(f => f.id === "queue:b"));
});

test("amenity evaluation follows walking routes and distinguishes disconnected amenities", () => {
  const e = event([item("b", "booth", 4, 8), item("wc", "restroom", 40, 8)]);
  assert.match(evaluateLayoutInsights(e).find(f => f.id === "amenity:restroom:b").detail, /36 m walk/);
  const divided = { ...e, items: [...e.items, item("divider", "obstacle", 25, 0, { w: 1, h: 20 })] };
  const finding = evaluateLayoutInsights(divided).find(f => f.id === "amenity:restroom:b");
  assert.equal(finding.level, "warning");
  assert.match(finding.detail, /No walkable route/);
});

test("amenity queues stay in comfort and warnings sort ahead of suggestions", () => {
  const e = event([item("b", "booth", 4, 8), item("wc", "restroom", 40, 8)]);
  const result = sim([agent(10, [], [{ itemId: "wc", joined: 0, serviceStart: null, departed: null }])]);
  const findings = evaluateLayoutInsights(e, result);
  assert.equal(findings.find(f => f.id === "queue:wc").category, "amenities");
  const firstInfo = findings.findIndex(f => f.level === "info");
  assert.ok(findings.slice(firstInfo).every(f => f.level === "info"));
  assert.ok(!findings.some(f => f.id === "completion:b"));
  assert.ok(findings.every(f => f.suggestion && f.id && !/NaN|Infinity/.test(f.detail)));
});

test("ratings wait for a simulation with visitors and intended booth visits", () => {
  const e = event([item("b", "booth", 4, 8)]);
  assert.equal(rateLayout(e, null, []).stars, null);
  assert.equal(rateLayout(e, sim([], { totalVisitors: 0 }), []).stars, null);
  assert.equal(rateLayout(event(), sim([], { totalVisitors: 100 }), []).stars, null);
  assert.equal(rateLayout(e, sim([], { totalVisitors: 100 }), []).stars, null);
});

test("meeting all checks earns five stars and weaker outcomes lower the rating", () => {
  const e = event([item("b", "booth", 4, 8), item("wc", "restroom", 8, 8), item("s", "seating", 12, 8)]);
  const healthy = sim([agent(100, ["b"], [{ itemId: "b", joined: 0, serviceStart: 0, serviceEnd: 80, departed: 80 }])],
    { totalVisitors: 100, peakLocalDensity: [0.5] });
  const good = rateLayout(e, healthy, evaluateLayoutInsights(e, healthy));
  assert.equal(good.stars, 5);
  const delayed = sim([agent(100, ["b"], [{ itemId: "b", joined: 0, serviceStart: 0, serviceEnd: 200, departed: null }])],
    { totalVisitors: 100, peakLocalDensity: [8] });
  const poor = rateLayout(e, delayed, evaluateLayoutInsights(e, delayed));
  assert.ok(poor.stars < good.stars);
  assert.equal(poor.stars * 2, Math.round(poor.stars * 2));
  assert.ok(poor.stars >= 1 && poor.stars <= 5);
});

test("quiet but inaccessible or unserved layouts cannot earn a high rating", () => {
  const e = event([item("b", "booth", 4, 8)]);
  const unserved = sim([agent(100, ["b"], [])], { totalVisitors: 100 });
  assert.equal(rateLayout(e, unserved, []).stars, 1);
  const partial = sim([agent(100, ["b"], [{ itemId: "b", joined: 0, serviceStart: 0, serviceEnd: 80, departed: 80 }])],
    { totalVisitors: 101, stranded: 1 });
  assert.ok(rateLayout(e, partial, []).stars <= 2);
  const accessIssue = { id: "blocked", category: "access", level: "warning" };
  assert.ok(rateLayout(e, { ...partial, stranded: 0 }, [accessIssue]).stars <= 3);
  const suggestion = { id: "amenity", category: "amenities", level: "info" };
  assert.ok(rateLayout(e, { ...partial, stranded: 0 }, [suggestion]).stars <= 4.5);
});

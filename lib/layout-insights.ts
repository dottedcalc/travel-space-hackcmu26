import type { FairEvent, Item } from "./event.ts";
import { accessPoints, boothQueuePoints, distanceField, gridFor, inspectLayout, type Finding, type Simulation } from "./simulation.ts";
import { queuePeopleRemaining } from "./queue-display.ts";
import { queueWaitPersonSteps } from "./queue-wait.ts";

export const insightCategories = [
  { id: "access", label: "Access & Movement", description: "Reachable destinations and space to move.", pending: "Run a simulation to check stage viewing access.", limitation: "Walking detours and wall clearance are not yet evaluated." },
  { id: "crowds", label: "Crowds & Queues", description: "Busy areas and service bottlenecks.", pending: "Run a simulation to measure crowding and queue waits.", limitation: "Crowding duration and queue obstruction are not yet evaluated." },
  { id: "exhibitors", label: "Exhibitor Placement & Exposure", description: "Visitor interest and completed booth service.", pending: "Run a simulation to compare intended and completed booth visits.", limitation: "Passing exposure and underused exhibition areas are not yet evaluated." },
  { id: "amenities", label: "Amenities & Visitor Comfort", description: "Convenient food, restrooms, and seating.", pending: "Run a simulation to measure amenity queues.", limitation: "Food-demand balance and crowding at seating approaches are not yet evaluated." },
] as const;
export type InsightCategory = typeof insightCategories[number]["id"];
export type LayoutInsight = Finding & {
  id: string;
  category: InsightCategory;
  source: "layout" | "simulation";
  suggestion: string;
};
export type LayoutRating = { stars: number | null; description: string };

// Transparent prototype planning defaults, not regulatory thresholds.
export const insightTargets = { queueSeconds: 300, completionRate: 0.8, amenityMeters: 30, density: 4 };
const number = (value: number) => Math.round(value).toLocaleString("en-US");
const minutes = (seconds: number) => (seconds / 60).toFixed(1);
const amenity = (item?: Item) => item && ["food", "restroom", "seating"].includes(item.kind);

/** A single weighted pass over queue history; service still in progress counts proportionally. */
export function stationMetrics(sim: Simulation) {
  const metrics = new Map<string, { intended: number; admitted: number; served: number; remaining: number; waitSeconds: number }>();
  const get = (id: string) => {
    let value = metrics.get(id);
    if (!value) { value = { intended: 0, admitted: 0, served: 0, remaining: 0, waitSeconds: 0 }; metrics.set(id, value); }
    return value;
  };
  for (const agent of sim.agents) {
    for (const id of new Set(agent.route)) get(id).intended += agent.weight;
    for (const visit of agent.queueVisits) {
      const value = get(visit.itemId);
      const remaining = queuePeopleRemaining(agent.weight, visit, sim.duration);
      value.admitted += agent.weight;
      value.remaining += remaining;
      value.served += agent.weight - remaining;
      value.waitSeconds += queueWaitPersonSteps(agent.weight, visit, sim.duration) * sim.stepSeconds;
    }
  }
  for (const value of metrics.values()) value.waitSeconds = value.admitted ? value.waitSeconds / value.admitted : 0;
  return metrics;
}

/** An illustrative overall rating against the same targets used by the suggestions. */
export function rateLayout(event: FairEvent, simulation: Simulation | null, findings: LayoutInsight[]): LayoutRating {
  if (!simulation) return { stars: null, description: "Run a simulation for the current layout to get a rating." };
  const booths = event.items.filter(item => item.kind === "booth" && item.company);
  if (!simulation.totalVisitors)
    return { stars: null, description: "Add visitors, then run the simulation again to get a rating." };
  if (!booths.length)
    return { stars: null, description: "This rating requires booked booths. Assign an exhibitor to a booth, then run the simulation again." };

  const metrics = stationMetrics(simulation);
  let intended = 0, served = 0;
  for (const booth of booths) {
    const metric = metrics.get(booth.id);
    intended += metric?.intended ?? 0;
    served += metric?.served ?? 0;
  }
  if (simulation.stranded >= simulation.totalVisitors || (intended > 0 && served === 0))
    return { stars: 1, description: "Visitors cannot complete booth service. Check access and queues." };
  if (!intended) return { stars: null, description: "No intended booth visits to evaluate yet." };

  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const accessWarnings = findings.some(f => f.category === "access" && f.level === "warning");
  const access = Math.min(accessWarnings ? 0.5 : 1, clamp(1 - simulation.stranded / simulation.totalVisitors));
  const peak = simulation.peakLocalDensity.reduce((max, value) => Math.max(max, value), 0);
  // The weakest station matters even if a short overall average hides its queue.
  const queue = [...metrics.values()].filter(m => m.admitted > 0).reduce((score, m) => Math.min(score,
    clamp(insightTargets.queueSeconds / Math.max(insightTargets.queueSeconds, m.waitSeconds)),
    clamp(1 - m.remaining / m.admitted)), 1);
  const crowds = Math.min(queue, clamp(insightTargets.density / Math.max(insightTargets.density, peak)));
  const completion = clamp(served / intended / insightTargets.completionRate);
  // Count each booth/amenity route once, and allow for the two missing-amenity checks.
  const amenityPenalty = findings.filter(f => f.category === "amenities")
    .reduce((sum, f) => sum + (f.level === "warning" ? 1 : 0.5), 0);
  const comfort = clamp(1 - amenityPenalty / (booths.length * 2 + 2));
  const score = access * 0.3 + crowds * 0.3 + completion * 0.25 + comfort * 0.15;
  let stars = Math.round((1 + score * 4) * 2) / 2;
  if (findings.length) stars = Math.min(stars, 4.5);
  if (accessWarnings) stars = Math.min(stars, 3);
  if (simulation.stranded > 0) stars = Math.min(stars, 2);
  const weakest = [
    { value: access, description: "Improve access and connected routes." },
    { value: crowds, description: "Reduce crowding and service queues." },
    { value: completion, description: "Help visitors complete more booth visits." },
    { value: comfort, description: "Bring amenities closer to exhibitors." },
  ].sort((a, b) => a.value - b.value)[0];
  return { stars, description: accessWarnings || simulation.stranded > 0 ? "Resolve access issues before comparing layouts." :
    weakest.value < 1 ? weakest.description : findings.length ? "Review the remaining layout suggestions." : "Current checks meet the planning targets." };
}

export function evaluateLayoutInsights(event: FairEvent, simulation?: Simulation | null): LayoutInsight[] {
  const items = new Map(event.items.map(item => [item.id, item]));
  const staticFindings = inspectLayout(event);
  const findings: LayoutInsight[] = staticFindings.map((finding) => ({
    ...finding, id: `layout:${finding.itemId ?? "hall"}:${finding.title}`,
    category: amenity(items.get(finding.itemId ?? "")) && finding.title.endsWith("is unreachable") ? "amenities" : "access",
    source: "layout", suggestion: finding.suggestion ?? finding.detail,
  }));
  const add = (finding: LayoutInsight) => findings.push(finding);
  const booths = event.items.filter(item => item.kind === "booth" && item.company);

  // Multi-source routing uses real walkable routes, including irregular rooms and obstacles.
  // One field per amenity kind avoids a separate breadth-first search for every booth.
  const grid = gridFor(event);
  for (const kind of ["restroom", "seating"] as const) {
    const destinations = event.items.filter(item => item.kind === kind);
    if (!destinations.length) {
      if (booths.length) add({ id: `missing:${kind}`, category: "amenities", source: "layout", level: "info",
        title: `No ${kind === "restroom" ? "restrooms" : "seating"} on the plan`,
        detail: `The layout has ${booths.length} booked booths and no marked ${kind === "restroom" ? "restroom" : "seating area"}.`,
        suggestion: `Mark any ${kind === "restroom" ? "restrooms" : "seating"} provided inside the hall.` });
      continue;
    }
    const field = distanceField(grid, destinations.flatMap(item => kind === "restroom" ? boothQueuePoints(event, item).slice(0, 1) : accessPoints(event, item)));
    for (const booth of booths) {
      const front = boothQueuePoints(event, booth)[0];
      if (!front) continue;
      const index = Math.floor(front.y / grid.cell) * grid.w + Math.floor(front.x / grid.cell);
      const steps = field[index];
      if (steps === undefined) continue;
      const distance = steps * grid.cell;
      if (steps < 0 || distance > insightTargets.amenityMeters) add({
        id: `amenity:${kind}:${booth.id}`, category: "amenities", source: "layout", level: steps < 0 ? "warning" : "info",
        itemId: booth.id, title: `${booth.label}: ${steps < 0 ? "no route to" : "distant"} ${kind}`,
        detail: steps < 0 ? `No walkable route connects ${booth.label}’s service front to a ${kind === "restroom" ? "restroom" : "seating area"}.` :
          `From ${booth.label}, the nearest ${kind === "restroom" ? "restroom" : "seating area"} is a ${number(distance)} m walk, above the ${insightTargets.amenityMeters} m planning target.`,
        suggestion: steps < 0 ? `Connect ${booth.label} to ${kind === "restroom" ? "a restroom" : "seating"}.` :
          `Bring ${kind === "restroom" ? "a restroom" : "seating"} within ${insightTargets.amenityMeters} m of ${booth.label}; the current walk is ${number(distance)} m.` });
    }
  }

  if (simulation) {
    // Preserve additional engine access checks without repeating the immediate findings.
    for (const finding of simulation.findings) {
      if (staticFindings.some(f => f.title === finding.title && f.itemId === finding.itemId)) continue;
      if (finding.level !== "warning") continue;
      if (staticFindings.some(f => f.itemId === finding.itemId && f.title.endsWith("is unreachable"))) continue;
      add({ ...finding, id: `simulation:${finding.itemId ?? "hall"}:${finding.title}`, source: "simulation",
        category: amenity(items.get(finding.itemId ?? "")) ? "amenities" : "access", suggestion: finding.suggestion ?? finding.detail });
    }
    if (simulation.stranded > 0) add({ id: "stranded", category: "access", source: "simulation", level: "warning",
      title: "Some visitors cannot complete their route", detail: `${number(simulation.stranded)} estimated visitors encounter a blocked check-in or exit route.`,
      suggestion: `Reconnect entrances, reception, and exits to restore routes for ${number(simulation.stranded)} visitors.` });

    const peakDensity = simulation.peakLocalDensity.reduce((max, value) => Math.max(max, value), 0);
    if (peakDensity >= insightTargets.density) {
      const index = simulation.peakLocalDensity.indexOf(peakDensity);
      const point = { x: (index % grid.w + 0.5) * grid.cell, y: (Math.floor(index / grid.w) + 0.5) * grid.cell };
      const nearest = event.items.filter(i => !["obstacle", "stairs", "emergency_exit"].includes(i.kind)).sort((a, b) =>
        Math.hypot(a.x + a.w / 2 - point.x, a.y + a.h / 2 - point.y) - Math.hypot(b.x + b.w / 2 - point.x, b.y + b.h / 2 - point.y))[0];
      add({ id: "peak-density", category: "crowds", source: "simulation", level: "warning", itemId: nearest?.id,
        title: `Crowding${nearest ? ` near ${nearest.label}` : " on the floor"}`,
        detail: `Peak estimated density reaches ${peakDensity.toFixed(1)} people/m² in a 2 × 2 m window, meeting or exceeding the ${insightTargets.density} people/m² planning target.`,
        suggestion: `Separate nearby attractions or widen the walkway; peak density reaches ${peakDensity.toFixed(1)} people/m².` });
    }

    for (const [id, metric] of stationMetrics(simulation)) {
      const item = items.get(id);
      if (!item) continue;
      const bottleneck = metric.admitted > 0 && (metric.waitSeconds > insightTargets.queueSeconds || metric.remaining >= 1);
      if (bottleneck) add({ id: `queue:${id}`, category: amenity(item) ? "amenities" : "crowds", source: "simulation", level: "warning", itemId: id,
        title: `${item.label}: service bottleneck`,
        detail: `Average admitted queue wait is ${minutes(metric.waitSeconds)} min; ${number(metric.remaining)} estimated visitors are still waiting or being served at closing.${metric.waitSeconds > insightTargets.queueSeconds ? " The wait exceeds the 5 min planning target." : ""}`,
        suggestion: `Increase ${item.label}’s processing speed: average wait is ${minutes(metric.waitSeconds)} min, with ${number(metric.remaining)} unserved at closing.` });
      if (item.kind === "booth" && item.company && metric.intended > 0 && metric.served / metric.intended < insightTargets.completionRate) {
        const blocked = staticFindings.some(f => f.itemId === id && f.title.endsWith("is unreachable"));
        add({ id: `completion:${id}`, category: "exhibitors", source: "simulation", level: "warning", itemId: id,
          title: `${item.label}: unmet visitor interest`,
          detail: `${number(100 * Math.min(1, metric.served / metric.intended))}% of ${number(metric.intended)} intended visits finish booth service before closing, below the 80% planning target.${blocked ? " The service front is unreachable." : bottleneck ? " A service bottleneck is also detected." : " The cause needs a closer look at visitor routes."}`,
          suggestion: `${blocked ? "Open access to the booth’s service front" : bottleneck ? "Increase booth processing speed" : "Try a more direct route to the booth"}; only ${number(100 * Math.min(1, metric.served / metric.intended))}% of intended visits finish service (target: 80%).` });
      }
    }
  }
  if (!booths.length) add({ id: "no-exhibitors", category: "exhibitors", source: "layout", level: "info", title: "No booked exhibitors to evaluate",
    detail: "Booth visit insights become available when an exhibitor is assigned to a booth.", suggestion: "Book a booth, then simulate flow." });
  return findings.sort((a, b) => Number(b.level === "warning") - Number(a.level === "warning") || a.id.localeCompare(b.id));
}

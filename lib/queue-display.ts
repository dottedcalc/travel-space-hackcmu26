import type { Agent, QueueVisit } from "./simulation.ts";

/** Interpolate service within a representative group, using simulation time. */
export function queuePeopleRemaining(weight: number, visit: QueueVisit, step: number) {
  if (step < visit.joined || (visit.departed !== null && step >= visit.departed)) return 0;
  if (visit.serviceStart === null || step <= visit.serviceStart) return weight;
  const end = visit.serviceEnd ?? visit.departed;
  if (end === null || end <= visit.serviceStart) return weight;
  const completed = Math.min(1, Math.max(0, (step - visit.serviceStart) / (end - visit.serviceStart)));
  return weight * (1 - completed);
}

export function queueCountsAtStep(
  occupants: { agent: Pick<Agent, "weight">; queueVisit?: QueueVisit }[], step: number,
) {
  const queues = new Map<string, { groups: number; remaining: number; count: number }>();
  for (const { agent, queueVisit } of occupants) {
    if (!queueVisit || step < queueVisit.joined ||
      (queueVisit.departed !== null && step >= queueVisit.departed)) continue;
    const total = queues.get(queueVisit.itemId) ?? { groups: 0, remaining: 0, count: 0 };
    total.groups++;
    total.remaining += queuePeopleRemaining(agent.weight, queueVisit, step);
    total.count = Math.ceil(Math.max(0, total.remaining - 1e-9));
    queues.set(queueVisit.itemId, total);
  }
  return queues;
}

import type { QueueVisit } from "./simulation.ts";

/** Total person-steps waiting, excluding each person's own service time. */
export function queueWaitPersonSteps(weight: number, visit: QueueVisit, closing: number) {
  if (weight <= 0 || closing <= visit.joined) return 0;
  const start = Math.min(visit.serviceStart ?? closing, closing);
  const beforeService = weight * (start - visit.joined);
  const end = visit.serviceEnd ?? visit.departed;
  if (visit.serviceStart === null || start >= closing || weight === 1 ||
    end === null || end <= start) return beforeService;

  // A group of N people is served sequentially at offsets 0, interval, ...,
  // (N - 1) * interval. People not yet served accrue wait only until closing.
  const interval = (end - start) / weight;
  const elapsed = closing - start;
  const started = Math.min(weight, Math.floor(elapsed / interval) + 1);
  return beforeService + interval * started * (started - 1) / 2 +
    (weight - started) * elapsed;
}

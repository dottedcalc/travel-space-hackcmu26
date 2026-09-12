import { simulate } from "../lib/simulation.ts";
import { seedEvent } from "../lib/event.ts";

// Book explicit test exhibitors; production templates may start with empty booths.
export function bookedEvent() {
  const event = seedEvent();
  const booked = new Set(["b1", "b2", "b3", "b4", "b7", "b8", "b11", "b12"]);
  return { ...event, items: event.items.map((item) => ({ ...item,
    category: item.id,
    ...(item.kind === "reception" ? { processingRate: 120 } : {}),
    company: booked.has(item.id) ? `Test exhibitor ${item.id}` : "",
  })) };
}

// Give geometry and queue regression fixtures a fast mandatory check-in desk.
// Reception behavior itself is covered using the unmodified simulator.
export function withReception(event) {
  if (event.items.some((item) => item.kind === "reception")) return event;
  return { ...event, items: [...event.items, {
    id: "test-reception", kind: "reception", label: "R", name: "Reception",
    x: 0.5, y: 0.5, w: 0.5, h: 0.5, company: "", category: "",
    popularity: 1, dwell: 10, processingRate: 120,
  }] };
}
export const simulateWithReception = (event) => simulate(
  event.items.some((item) => item.kind === "booth" || item.kind === "food") ? withReception(event) : event,
);

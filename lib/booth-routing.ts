import type { Item } from "./event.ts";

type Position = { x: number; y: number };

/** Order an already chosen set of exhibits, favoring short, walkable trips. */
export function orderNearbyBooths(
  targets: Item[], start: Position, rng: () => number,
  walkingDistance: (from: Position, target: Item) => number,
  visitPosition: (target: Item) => Position,
): Item[] {
  const remaining = [...targets], ordered: Item[] = [];
  let position = start;
  while (remaining.length) {
    const weights = remaining.map((target) => {
      const distance = walkingDistance(position, target);
      // A five-meter offset avoids funneling every visitor into the closest booth.
      return Number.isFinite(distance) && distance >= 0 ? 1 / (5 + distance) ** 2 : 0;
    });
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (!total) return [...ordered, ...remaining];
    let draw = rng() * total;
    let chosen = weights.findLastIndex((weight) => weight > 0);
    for (let i = 0; i < weights.length; i++) {
      draw -= weights[i];
      if (draw < 0) { chosen = i; break; }
    }
    const next = remaining.splice(chosen, 1)[0];
    ordered.push(next);
    position = visitPosition(next);
  }
  return ordered;
}

/** Illustrative, seeded meal assumptions; times are in seconds, not simulation steps. */
export type MealWindow = { start: number; end: number };
export type FoodProfile = { nextMeal: number; eatingSeconds: number; mealInterval: number; seed: number };

function preference(seed: number, key: string) {
  let hash = seed >>> 0;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  return ((hash ^ (hash >>> 16)) >>> 0) / 2 ** 32;
}

export function createFoodProfile(id: number, arrivalSeconds: number): FoodProfile {
  const seed = 104729 + id * 101;
  return {
    seed,
    nextMeal: arrivalSeconds + (10 + 50 * preference(seed, "hunger")) * 60,
    eatingSeconds: (10 + 15 * preference(seed, "eating")) * 60,
    mealInterval: (120 + 120 * preference(seed, "interval")) * 60,
  };
}

export function mealReadyAt(profile: FoodProfile, window: MealWindow) {
  const earliest = Math.max(profile.nextMeal, window.start);
  // Personal opening-time response prevents all already-hungry visitors diverting at once.
  const spread = Math.min(30 * 60, Math.max(0, window.end - earliest) * 0.6);
  return earliest + preference(profile.seed, `meal:${window.start}:${profile.nextMeal}`) * spread;
}

export function foodChoiceCost(profile: FoodProfile, stationId: string,
  walkingSeconds: number, queueSeconds: number, serviceSeconds: number) {
  const preferenceCost = preference(profile.seed, `station:${stationId}`) * 5 * 60;
  return walkingSeconds + queueSeconds + serviceSeconds + preferenceCost;
}

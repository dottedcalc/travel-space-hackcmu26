import type { Agent, Point } from "./simulation.ts";

type TracePrefix = { index: number; path: string; hasSegments: boolean };
const traceCache = new WeakMap<Agent, TracePrefix>();
const coordinates = (point: Point) => `${(point.x * 20).toFixed(2)},${(point.y * 20).toFixed(2)}`;
const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

/** Send only traveled coordinates to SVG; no future segment exists in the displayed path. */
export function crowdTracePath(agent: Agent, pathIndex: number, point: Point) {
  if (!agent.path.length || pathIndex < 0) return "";
  const end = Math.min(pathIndex, agent.path.length - 1);
  let prefix = traceCache.get(agent);
  // Seeking backward rebuilds the shorter prefix; normal playback appends new past segments.
  if (!prefix || end < prefix.index) {
    prefix = { index: 0, path: `M${coordinates(agent.path[0])}`, hasSegments: false };
    traceCache.set(agent, prefix);
  }
  for (let i = prefix.index + 1; i <= end; i++) {
    if (!samePoint(agent.path[i], agent.path[i - 1])) {
      prefix.path += `L${coordinates(agent.path[i])}`;
      prefix.hasSegments = true;
    }
  }
  prefix.index = end;
  // The final segment stops at the interpolated current position, even between ticks.
  if (!samePoint(point, agent.path[end])) return `${prefix.path}L${coordinates(point)}`;
  return prefix.hasSegments ? prefix.path : "";
}

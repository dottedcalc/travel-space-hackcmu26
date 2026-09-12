"use client";
import { crowdTracePath } from "@/lib/crowd-traces";
import { type Agent, type Point } from "@/lib/simulation";

const traceColors: Record<Agent["type"], string> = {
  focused: "#592626",
  viewer: "#233955",
  explorer: "#215038",
  social: "#5c4321",
};

/** Mounted only for groups currently on the floor, so departure removes the whole trace. */
export default function CrowdTrace({ agent, point, pathIndex, textScale }: {
  agent: Agent; point: Point; pathIndex: number; textScale: number;
}) {
  const path = crowdTracePath(agent, pathIndex, point);
  if (!path) return null;
  return <path d={path} fill="none" stroke={traceColors[agent.type]}
    strokeWidth={2.16 / textScale} strokeOpacity=".7" strokeLinecap="round" strokeLinejoin="round"
    pointerEvents="none" aria-hidden="true" />;
}

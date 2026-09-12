import { roomRectangles, type FairEvent, type Rect } from "./event";
export const workspaceRoles = [
  {
    id: "organizer",
    label: "Event organizer",
    description: "Design the venue, arrange booths, and explore visitor flow.",
    action: "Plan this event",
  },
  {
    id: "exhibitioner",
    label: "Exhibitor",
    description:
      "Explore available spaces and reserve a booth for your exhibit.",
    action: "Find your booth",
  },
  {
    id: "visitor",
    label: "Visitor",
    description: "Discover exhibits and plan a route around your interests.",
    action: "Explore the exhibition",
  },
] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number]["id"];
export type WorkspaceRecord = {
  id: string;
  event: FairEvent;
  revision: number;
};
export type WorkspaceSummary = {
  id: string;
  revision: number;
  name: string;
  venue: string;
  booths: number;
  booked: number;
  visitors: number;
  width: number;
  height: number;
  roomRectangles: Rect[];
  items: FairEvent["items"];
};
export type WorkspaceInput = {
  name: string;
  venue: string;
  template: "blank" | "sample" | "reference";
  requestId: string;
};
export function workspacePath(id: string, role?: WorkspaceRole) {
  return `/workspaces/${encodeURIComponent(id)}${role ? `/${role}` : ""}`;
}
export function workspaceSummary(record: WorkspaceRecord): WorkspaceSummary {
  const booths = record.event.items.filter((i) => i.kind === "booth");
  return {
    id: record.id,
    revision: record.revision,
    name: record.event.name,
    venue: record.event.venue || "Main Hall",
    booths: booths.length,
    booked: booths.filter((i) => i.company).length,
    visitors: record.event.visitors,
    width: record.event.width,
    height: record.event.height,
    roomRectangles: roomRectangles(record.event),
    items: record.event.items,
  };
}

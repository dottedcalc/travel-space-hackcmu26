import { env } from "cloudflare:workers";
import { DEFAULT_VISITORS, MAX_VISITORS, seedEvent, type FairEvent } from "@/lib/event";
import { referenceLayout } from "@/lib/reference-layout";

function storedEvent(data: string, id: string, revision: number): FairEvent {
  const event = JSON.parse(data) as Partial<FairEvent>;
  const visitors = Math.min(MAX_VISITORS,
    event.visitors === 150 ? DEFAULT_VISITORS : event.visitors ?? DEFAULT_VISITORS);
  // The original, untouched main workspace used a career-specific sample.
  // Replace only that pristine fixture; preserve every edited workspace.
  if (id === "main" && revision === 0 && event.name === "Fall Career Fair" &&
      event.venue === "Campus Convention Center" && event.visitors === 150)
    return seedEvent();
  if (id === "main" && event.name === "Fall Career Fair" &&
      event.items?.some((item) => item.company === "Atlas")) {
    return {
      ...event,
      name: "Sample Exhibition",
      companies: [],
      items: event.items.map((item) => item.kind === "booth" && item.company
        ? { ...item, company: `Exhibit ${item.label}`, category: "Display" }
        : item),
      startTime: event.startTime ?? "08:00",
      endTime: event.endTime ?? "20:00",
      visitors,
    } as FairEvent;
  }
  return {
    ...event,
    startTime: event.startTime ?? "08:00",
    endTime: event.endTime ?? "20:00",
    visitors,
  } as FairEvent;
}
import {
  workspaceSummary,
  type WorkspaceInput,
  type WorkspaceRecord,
} from "@/lib/workspaces";
function database() {
  if (!env.DB) throw new Error("Event storage is unavailable");
  return env.DB;
}
async function ensureSample() {
  await database()
    .prepare("INSERT OR IGNORE INTO events (id,data,revision) VALUES (?,?,0)")
    .bind("main", JSON.stringify(seedEvent()))
    .run();
}
export async function loadEvent(id = "main"): Promise<WorkspaceRecord | null> {
  if (id === "main") await ensureSample();
  const row = await database()
    .prepare("SELECT id,data,revision FROM events WHERE id=?")
    .bind(id)
    .first<{ id: string; data: string; revision: number }>();
  return row
    ? {
        id: row.id,
        event: storedEvent(row.data, row.id, row.revision),
        revision: row.revision,
      }
    : null;
}
export async function listWorkspaces() {
  await ensureSample();
  const rows = await database()
    .prepare("SELECT id,data,revision FROM events ORDER BY rowid DESC")
    .all<{ id: string; data: string; revision: number }>();
  return rows.results.map((row) =>
    workspaceSummary({
      id: row.id,
      event: storedEvent(row.data, row.id, row.revision),
      revision: row.revision,
    }),
  );
}
export async function createWorkspace(input: WorkspaceInput) {
  const event = { ...(input.template === "reference" ? referenceLayout() : seedEvent()), name: input.name, venue: input.venue };
  if (input.template === "blank") event.items = [];
  // A client-generated request ID makes a retried creation idempotent.
  await database()
    .prepare("INSERT OR IGNORE INTO events (id,data,revision) VALUES (?,?,0)")
    .bind(input.requestId, JSON.stringify(event))
    .run();
  const record = await loadEvent(input.requestId);
  if (!record) throw new Error("Workspace was not created");
  return workspaceSummary(record);
}
export async function removeWorkspace(id: string) {
  if (id === "main") return "protected" as const;
  const result = await database()
    .prepare("DELETE FROM events WHERE id=?")
    .bind(id)
    .run();
  return (result.meta.changes ?? 0) === 1 ? "removed" as const : "missing" as const;
}
export async function saveEvent(
  event: FairEvent,
  revision: number,
  id = "main",
) {
  const result = await database()
    .prepare(
      "UPDATE events SET data=?, revision=revision+1 WHERE id=? AND revision=?",
    )
    .bind(JSON.stringify(event), id, revision)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

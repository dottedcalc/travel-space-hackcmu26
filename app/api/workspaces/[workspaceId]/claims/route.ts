import { z } from "zod";
import { loadEvent, saveEvent } from "@/db/event-store";
import { rsvpState } from "@/lib/rsvp";
import { eventCompanies } from "@/lib/event";
export const dynamic = "force-dynamic";
export async function POST() {
  return Response.json({ error: "Use the exhibitor recommendation flow to compare and reserve a booth." }, { status: 409 });
}
const releaseSchema = z.object({
  revision: z.number().int().min(0),
  boothId: z.string().min(1).max(60),
  company: z.string().trim().min(1).max(50),
}).strict();
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json({ error: "Request origin is not allowed" }, { status: 403 });
  try {
    const raw = await request.text();
    if (raw.length > 4096)
      return Response.json({ error: "Release details are too long" }, { status: 413 });
    const parsed = releaseSchema.safeParse(JSON.parse(raw));
    if (!parsed.success)
      return Response.json({ error: "Invalid booth release details" }, { status: 400 });
    const id = (await params).workspaceId;
    const record = await loadEvent(id);
    if (!record)
      return Response.json({ error: "Workspace not found" }, { status: 404 });
    if (record.revision !== parsed.data.revision)
      return Response.json({ error: "The event changed. Reload the latest layout." }, { status: 409 });
    const booth = record.event.items.find((item) =>
      item.id === parsed.data.boothId && item.kind === "booth");
    if (!booth)
      return Response.json({ error: "This booth no longer exists" }, { status: 404 });
    if (!booth.company || booth.company !== parsed.data.company)
      return Response.json({ error: "This booth is not reserved for the selected exhibitor or exhibit." }, { status: 409 });
    const state = rsvpState(record.event);
    const saved = [...state.records].reverse().find(r => r.seatId === booth.id && !r.released);
    const event = {
      ...record.event,
      rsvp: { ...state, final: undefined, records: state.records.map(r => r === saved ? { ...r, released: true } : r) },
      companies: eventCompanies(record.event),
      items: record.event.items.map((item) =>
        item.id === booth.id ? { ...item, ...(saved?.originalSeat ?? {}), company: "", category: "", popularity: 2 } : item),
    };
    if (!(await saveEvent(event, record.revision, id)))
      return Response.json({ error: "Another change arrived first. Reload the latest layout." }, { status: 409 });
    return Response.json({ id, event, revision: record.revision + 1 });
  } catch (e) {
    if (e instanceof SyntaxError)
      return Response.json({ error: "Invalid booth release details" }, { status: 400 });
    console.error("Booth release failed", e);
    return Response.json({ error: "The booth could not be released. Please retry." }, { status: 503 });
  }
}

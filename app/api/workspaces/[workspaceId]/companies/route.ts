import { z } from "zod";
import { loadEvent, saveEvent } from "@/db/event-store";
import { companyId, randomizedRsvpOrder, rsvpState } from "@/lib/rsvp";
import { boothCategories, eventCompanies } from "@/lib/event";

export const dynamic = "force-dynamic";
const schema = z.object({
  revision: z.number().int().min(0),
  name: z.string().trim().min(1).max(50),
  category: z.enum(boothCategories),
}).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json({ error: "Request origin is not allowed" }, { status: 403 });
  try {
    const raw = await request.text();
    if (raw.length > 4096)
      return Response.json({ error: "Exhibitor details are too long" }, { status: 413 });
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success)
      return Response.json({ error: "Enter an exhibitor or exhibit name and choose a category from the list." }, { status: 400 });
    const id = (await params).workspaceId;
    const record = await loadEvent(id);
    if (!record)
      return Response.json({ error: "Workspace not found" }, { status: 404 });
    if (record.revision !== parsed.data.revision)
      return Response.json({ error: "The event changed. Reload the latest layout." }, { status: 409 });
    if (eventCompanies(record.event).some((company) =>
      company.name.toLocaleLowerCase() === parsed.data.name.toLocaleLowerCase()))
      return Response.json({ error: "That exhibitor or exhibit is already listed. Choose it above." }, { status: 409 });
    const event = {
      ...record.event,
      companies: [...eventCompanies(record.event), {
        id: crypto.randomUUID(),
        name: parsed.data.name,
        category: parsed.data.category,
      }],
    };
    event.rsvp = { ...rsvpState(event), final: undefined };
    if(event.rsvp.orderMode==="random") event.rsvp.order=randomizedRsvpOrder(event);
    if (!(await saveEvent(event, record.revision, id)))
      return Response.json({ error: "The event changed. Reload the latest layout." }, { status: 409 });
    return Response.json({ id, event, revision: record.revision + 1 });
  } catch (e) {
    if (e instanceof SyntaxError)
      return Response.json({ error: "Invalid exhibitor details" }, { status: 400 });
    console.error("Exhibitor registration failed", e);
    return Response.json({ error: "The exhibitor could not be added. Please retry." }, { status: 503 });
  }
}

const renameSchema = z.object({
  revision: z.number().int().min(0),
  oldName: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(50),
}).strict();

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json({ error: "Request origin is not allowed" }, { status: 403 });
  try {
    const raw = await request.text();
    if (raw.length > 4096)
      return Response.json({ error: "Exhibitor details are too long" }, { status: 413 });
    const parsed = renameSchema.safeParse(JSON.parse(raw));
    if (!parsed.success)
      return Response.json({ error: "Enter a valid exhibit name." }, { status: 400 });
    const id = (await params).workspaceId;
    const record = await loadEvent(id);
    if (!record)
      return Response.json({ error: "Workspace not found" }, { status: 404 });
    if (record.revision !== parsed.data.revision)
      return Response.json({ error: "The event changed. Reload the latest layout." }, { status: 409 });
    const companies = eventCompanies(record.event).map(c => ({ ...c, id: companyId(c) }));
    const original = companies.find((entry) => entry.name === parsed.data.oldName);
    if (!original)
      return Response.json({ error: "That exhibit is no longer listed." }, { status: 404 });
    if (companies.some((entry) => entry.name !== original.name &&
      entry.name.toLocaleLowerCase() === parsed.data.name.toLocaleLowerCase()))
      return Response.json({ error: "That exhibit name is already in use." }, { status: 409 });
    const event = {
      ...record.event,
      companies: companies.map((entry) => entry.name === original.name
        ? { ...entry, name: parsed.data.name } : entry),
      items: record.event.items.map((item) => item.kind === "booth" &&
        item.company.toLocaleLowerCase() === original.name.toLocaleLowerCase()
        ? { ...item, company: parsed.data.name } : item),
    };
    event.rsvp = { ...rsvpState(event), final: undefined };
    if (!(await saveEvent(event, record.revision, id)))
      return Response.json({ error: "The event changed. Reload the latest layout." }, { status: 409 });
    return Response.json({ id, event, revision: record.revision + 1 });
  } catch (e) {
    if (e instanceof SyntaxError)
      return Response.json({ error: "Invalid exhibit details" }, { status: 400 });
    console.error("Exhibit rename failed", e);
    return Response.json({ error: "The exhibit could not be renamed. Please retry." }, { status: 503 });
  }
}

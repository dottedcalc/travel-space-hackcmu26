import { z } from "zod";
import { eventCompanies, isBoothCategory } from "./event";
import { profileSchema, seatPolicySchema } from "./rsvp-schema";
import { companyId, pendingCompanies, rsvpState } from "./rsvp";
import { loadEvent, saveEvent } from "@/db/event-store";
import { MAX_MAP_SIZE, MAX_VISITORS, MAX_FOOD_WINDOWS, foodAvailabilityError, allAccessPoints, eventEntrances, eventExits, itemKinds, onRoomBoundary, pointInRoom, rectInsideRoom, validRoomShape } from "@/lib/event";
const coordinate = z.number().finite().min(0).max(MAX_MAP_SIZE);
const point = z.object({ x: coordinate, y: coordinate });
const flowPoint = point.extend({ id: z.string().min(1).max(60), flow: z.number().positive().max(100) });
const item = z.object({
  id: z.string().min(1).max(60),
  kind: z.enum(itemKinds),
  label: z.string().max(20),
  name: z.string().max(50),
  x: coordinate,
  y: coordinate,
  w: z.number().min(0.5).max(MAX_MAP_SIZE),
  h: z.number().min(0.5).max(MAX_MAP_SIZE),
  company: z.string().max(50),
  category: z.string().max(50),
  popularity: z.number().min(1).max(3),
  dwell: z.number().int().min(10).max(1800),
  processingRate: z.number().finite().min(0.1).max(120).optional(),
  stageLingering: z.number().int().min(60).max(7200).optional(),
  stageSpotlight: z.number().int().min(0).max(100).optional(),
  reservationPolicy: seatPolicySchema.optional(),
  foodAvailability: z.array(z.object({
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  })).max(MAX_FOOD_WINDOWS).superRefine((windows, ctx) => {
    const error = foodAvailabilityError(windows);
    if (error) ctx.addIssue({ code: "custom", message: error });
  }).optional(),
  foodAvailableAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
});
const schema = z
  .object({
    revision: z.number().int().min(0),
    event: z.object({
      name: z.string().trim().min(1).max(80),
      venue: z.string().trim().max(100).optional(),
      width: z.number().min(10).max(MAX_MAP_SIZE).multipleOf(0.5),
      height: z.number().min(8).max(MAX_MAP_SIZE).multipleOf(0.5),
      roomRectangles: z.array(z.object({
        x: coordinate, y: coordinate,
        w: z.number().min(0.5).max(MAX_MAP_SIZE),
        h: z.number().min(0.5).max(MAX_MAP_SIZE),
      })).min(1).max(12).optional(),
      visitors: z.number().int().min(100).max(MAX_VISITORS),
      startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      clearance: z.number().min(0.5).max(4),
      entrance: point,
      exit: point,
      entrances: z.array(flowPoint).min(1).max(12).optional(),
      exits: z.array(flowPoint).min(1).max(12).optional(),
      items: z.array(item).max(50),
      companies: z.array(z.object({
        id: z.string().max(200).optional(),
        profile: profileSchema.optional(),
        name: z.string().trim().min(1).max(50),
        category: z.string().trim().min(1).max(50),
      })).max(100).optional(),
    }),
  })
  .superRefine(({ event }, ctx) => {
    const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    if (minutes(event.endTime) - minutes(event.startTime) < 60)
      ctx.addIssue({ code: "custom", message: "Event hours must be at least one hour, with closing after opening" });
    if (!validRoomShape(event))
      ctx.addIssue({ code: "custom", message: "Room rectangles must join along edges without overlapping" });
    if (new Set(event.items.map((i) => i.id)).size !== event.items.length)
      ctx.addIssue({ code: "custom", message: "Booth IDs must be unique" });
    for (const points of [eventEntrances(event), eventExits(event)])
      if (new Set(points.map((p) => p.id)).size !== points.length)
        ctx.addIssue({ code: "custom", message: "Access point IDs must be unique" });
    if (new Set(allAccessPoints(event).map((p) => `${p.x}:${p.y}`)).size !== allAccessPoints(event).length)
      ctx.addIssue({ code: "custom", message: "Access points must use different locations" });
    if (event.entrances && (event.entrance.x !== event.entrances[0].x || event.entrance.y !== event.entrances[0].y) ||
        event.exits && (event.exit.x !== event.exits[0].x || event.exit.y !== event.exits[0].y))
      ctx.addIssue({ code: "custom", message: "Primary access points must match the first entrance and exit" });
    for (const p of allAccessPoints(event))
      if (!pointInRoom(event, p.x, p.y))
        ctx.addIssue({
          code: "custom",
          message: "Doors must be inside the venue",
        });
    for (const i of event.items)
      if (!rectInsideRoom(event, i))
        ctx.addIssue({
          code: "custom",
          message: "Objects must fit inside the venue",
        });
    for (const p of allAccessPoints(event))
      if (event.items.some((i) =>
        p.x >= i.x && p.x < i.x + i.w && p.y >= i.y && p.y < i.y + i.h))
        ctx.addIssue({ code: "custom", message: "Doors must not be covered by objects" });
    for (const i of event.items)
      if (i.kind === "emergency_exit" && !onRoomBoundary(event, i))
        ctx.addIssue({
          code: "custom",
          message: "Emergency exits must touch a hall boundary",
        });
  });
export async function getWorkspaceResponse(id: string) {
  try {
    const record = await loadEvent(id);
    if (!record)
      return Response.json({ error: "Workspace not found" }, { status: 404 });
    return Response.json(record, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("Load event failed", e);
    return Response.json(
      { error: "Could not load the shared event. Please retry." },
      { status: 503 },
    );
  }
}
export async function updateWorkspaceResponse(request: Request, id: string) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json(
      { error: "Request origin is not allowed" },
      { status: 403 },
    );
  if (Number(request.headers.get("content-length")) > 1000000)
    return Response.json({ error: "Event is too large" }, { status: 413 });
  try {
    const raw = await request.text();
    if (raw.length > 1000000)
      return Response.json({ error: "Event is too large" }, { status: 413 });
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success)
      return Response.json(
        { error: "Check the event settings and try again." },
        { status: 400 },
      );
    const { event, revision } = parsed.data;
    const current = await loadEvent(id);
    if (!current)
      return Response.json({ error: "Workspace not found" }, { status: 404 });
    // Preserve unchanged legacy labels while restricting all new category assignments.
    if (event.items.some((item) => item.kind === "booth" && !isBoothCategory(item.category) &&
      !(item.category === "" && !item.company) &&
      !current.event.items.some((before) => before.id === item.id && before.kind === "booth" &&
        before.company === item.company && before.category === item.category)) ||
      event.companies?.some((company) => !isBoothCategory(company.category) &&
        !eventCompanies(current.event).some((before) => before.name === company.name && before.category === company.category)))
      return Response.json({ error: "Choose a booth category from the list." }, { status: 400 });
    // Layout saves cannot erase or forge reservation history, company IDs, or profiles.
    event.companies = current.event.companies?.map(c => ({ ...c, id: companyId(c) })) ?? event.companies;
    const next = { ...event, rsvp: current.event.rsvp };
    if (next.rsvp) {
      const state = rsvpState(next);
      next.rsvp = { ...state, final: pendingCompanies(next).length ? undefined : { status: "pending", sourceRevision: revision + 1 } };
      for (const record of state.records.filter(r => !r.released)) {
        const before = current.event.items.find(i => i.id === record.seatId);
        const after = next.items.find(i => i.id === record.seatId);
        if (!before || !after || before.company !== after.company) return Response.json({ error: "Release a reserved booth before removing its reservation." }, { status: 409 });
      }
    }
    if (!(await saveEvent(next, revision, id)))
      return Response.json(
        {
          error:
            "Another window updated this event. Reload the latest version before saving.",
        },
        { status: 409 },
      );
    return Response.json({ revision: revision + 1 });
  } catch (e) {
    if (e instanceof SyntaxError)
      return Response.json({ error: "Invalid event data" }, { status: 400 });
    console.error("Save event failed", e);
    return Response.json(
      {
        error: "Your changes are still here, but saving failed. Please retry.",
      },
      { status: 503 },
    );
  }
}

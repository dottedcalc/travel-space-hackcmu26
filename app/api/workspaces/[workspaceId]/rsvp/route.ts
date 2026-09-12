import { z } from "zod";
import { loadEvent, saveEvent } from "@/db/event-store";
import { eventCompanies } from "@/lib/event";
import { companyId, pendingCompanies, randomizedRsvpOrder, rsvpState } from "@/lib/rsvp";
import { confirmReservation, ReservationError } from "@/lib/rsvp-reservation";
import { profileSchema, reservationSchema, seatPolicySchema, sizeSchema } from "@/lib/rsvp-schema";
export const dynamic = "force-dynamic";
const revision = z.number().int().min(0);
const patchSchema = z.discriminatedUnion("action", [
  z.object({ action:z.literal("profile"), revision, companyId:z.string(), profile:profileSchema }),
  z.object({ action:z.literal("order"), revision, order:z.array(z.string()).max(100), skipped:z.array(z.string()).max(100) }),
  z.object({ action:z.literal("simple-settings"), revision,
    orderMode:z.enum(["random","manual","registration","popularity","alphabetical"]),
    sizes:z.array(sizeSchema).length(3), seatId:z.string().min(1).max(60),
    price:z.number().finite().min(0).max(1e9).optional() }).strict(),
  z.object({ action:z.literal("settings"), revision, sizes:z.array(sizeSchema).min(1).max(10),
    seats:z.array(z.object({ id:z.string(), policy:seatPolicySchema })).max(50),
    protectedAreas:z.array(z.object({x:z.number().min(0),y:z.number().min(0),w:z.number().positive(),h:z.number().positive()})).max(50) }),
  z.object({ action:z.literal("requeue"), revision, companyId:z.string() }),
  z.object({ action:z.literal("final"), revision, visits:z.number().finite().min(0), peak:z.number().finite().min(0), queueSeconds:z.number().finite().min(0) }),
]);
async function handle(request: Request, context: {params: Promise<{workspaceId:string}>}) {
  const origin=request.headers.get("origin");
  if(origin && origin!==new URL(request.url).origin) return Response.json({error:"Request origin is not allowed"},{status:403});
  try {
    const raw=await request.text();
    if(raw.length>64000) return Response.json({error:"Reservation details are too large."},{status:413});
    const parsed=request.method==="POST" ? reservationSchema.safeParse(JSON.parse(raw)) : patchSchema.safeParse(JSON.parse(raw));
    if(!parsed.success) return Response.json({error:"Check the reservation fields and try again."},{status:400});
    const id=(await context.params).workspaceId, record=await loadEvent(id);
    if(!record) return Response.json({error:"Workspace not found"},{status:404});
    let event=record.event;
    if(request.method==="POST") {
      event=confirmReservation(event,record.revision,reservationSchema.parse(parsed.data));
      if(event===record.event) return Response.json(record);
    } else {
      const input=patchSchema.parse(parsed.data);
      if(input.revision!==record.revision) throw new ReservationError("The workspace changed. Reload the latest layout.");
      const state=rsvpState(event), companies=eventCompanies(event).map(c=>({...c,id:companyId(c)}));
      event={...event,companies,rsvp:{...state,final:undefined}};
      if(input.action==="profile") {
        if(!companies.some(c=>c.id===input.companyId)) throw new ReservationError("This exhibitor no longer exists.");
        event.companies=companies.map(c=>c.id===input.companyId?{...c,profile:input.profile}:c);
        const company=event.companies.find(c=>c.id===input.companyId)!;
        event.items=event.items.map(i=>i.kind==="booth" && i.company===company.name ? {...i,popularity:input.profile.popularity,dwell:input.profile.dwell,processingRate:input.profile.serviceRate}:i);
      } else if(input.action==="order") {
        if(new Set(input.order).size!==companies.length || input.order.length!==companies.length || companies.some(c=>!input.order.includes(c.id)) || input.skipped.some(id=>!input.order.includes(id))) throw new ReservationError("Include every exhibitor exactly once in the order.");
        event.rsvp={...state,order:input.order,orderMode:"manual",skipped:input.skipped,final:undefined};
      } else if(input.action==="simple-settings") {
        if(input.sizes.map(s=>s.name).join(",")!=="Small,Medium,Large") throw new ReservationError("Choose a Small, Medium, and Large size preset.");
        if(input.seatId!=="__available"&&!event.items.some(i=>i.id===input.seatId&&i.kind==="booth"&&!i.company)) throw new ReservationError("This booth is no longer available. Choose another booth.");
        const drawRandomOrder=input.orderMode==="random"&&event.rsvp?.orderMode!=="random";
        event.rsvp={...state,sizes:input.sizes,orderMode:input.orderMode,final:undefined};
        event.rsvp=rsvpState(event);
        if(drawRandomOrder) event.rsvp.order=randomizedRsvpOrder(event);
        if(input.price!==undefined) event.items=event.items.map(i=>i.kind==="booth"&&!i.company&&(input.seatId==="__available"||i.id===input.seatId)
          ? {...i,reservationPolicy:{...i.reservationPolicy,price:input.price}} : i);
      } else if(input.action==="settings") {
        if(new Set(input.sizes.map(s=>s.name)).size!==input.sizes.length || input.sizes.some(s=>s.name==="Custom")) throw new ReservationError("Use distinct size names; Custom is reserved for exhibitor dimensions.");
        if(input.protectedAreas.some(r=>r.x+r.w>event.width||r.y+r.h>event.height)) throw new ReservationError("Protected areas must fit inside the hall.");
        event.rsvp={...state,sizes:input.sizes,protectedAreas:input.protectedAreas,final:undefined};
        event.items=event.items.map(i=>({...i,reservationPolicy:input.seats.find(s=>s.id===i.id)?.policy??i.reservationPolicy}));
      } else if(input.action==="requeue") {
        const company=companies.find(c=>c.id===input.companyId);
        if(!company || event.items.some(i=>i.company===company.name)) throw new ReservationError("Release this exhibitor’s booth before requeueing.");
        // Keep the audit history, while an explicit organizer requeue starts a fresh turn.
        event.rsvp={...state,orderMode:"manual",order:[...state.order.filter(id=>id!==input.companyId),input.companyId],skipped:state.skipped.filter(id=>id!==input.companyId),
          records:state.records.map(r=>r.companyId===input.companyId?{...r,requeued:true}:r),final:undefined};
      } else {
        if(pendingCompanies(event).length) throw new ReservationError("Finish the reservation order before saving final results.");
        event.rsvp={...state,final:{status:"complete",sourceRevision:record.revision,visits:input.visits,peak:input.peak,queueSeconds:input.queueSeconds}};
      }
      if(input.action!=="final" && !pendingCompanies(event).length) event.rsvp!.final={status:"pending",sourceRevision:record.revision+1};
    }
    if(!await saveEvent(event,record.revision,id)) throw new ReservationError("Another change arrived first. Reload and compare again.");
    return Response.json({id,event,revision:record.revision+1});
  } catch(error) {
    if(error instanceof ReservationError) return Response.json({error:error.message},{status:409});
    if(error instanceof SyntaxError || error instanceof z.ZodError) return Response.json({error:"Invalid reservation details."},{status:400});
    console.error("RSVP save failed",error);
    return Response.json({error:"Could not save your reservation. Your choices are still here; try again."},{status:503});
  }
}
export const POST=handle;
export const PATCH=handle;

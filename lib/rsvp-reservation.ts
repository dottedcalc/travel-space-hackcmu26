import { eventCompanies, type FairEvent } from "./event.ts";
import { companyId, pendingCompanies, placedSeat, profileFor, rsvpState, SCORING_VERSION, seatRejection, sizeAdvice } from "./rsvp.ts";
import type { z } from "zod";
import type { reservationSchema } from "./rsvp-schema.ts";
export class ReservationError extends Error {}
export function confirmReservation(event: FairEvent, revision: number, input: z.infer<typeof reservationSchema>): FairEvent {
  const state = rsvpState(event);
  const previous = state.records.find(r => r.requestId === input.requestId);
  if (previous) {
    if (previous.companyId !== input.companyId || previous.seatId !== input.seatId) throw new ReservationError("This request was already used for another reservation.");
    return event;
  }
  if (revision !== input.revision) throw new ReservationError("The layout changed. Compare the updated recommendations before reserving.");
  const company = eventCompanies(event).find(c=>companyId(c)===input.companyId);
  if (!company || companyId(pendingCompanies(event)[0] ?? { name: "", category: "" }) !== input.companyId) throw new ReservationError("It is another exhibitor’s turn. Reload the current order.");
  if (!company.profile) throw new ReservationError("Save your exhibitor profile first.");
  if (input.size.name !== "Custom" && !state.sizes.some(s=>s.name===input.size.name && s.w===input.size.w && s.h===input.size.h)) throw new ReservationError("This size option changed. Choose a current size.");
  const seat = event.items.find(i=>i.id===input.seatId);
  if (!seat) throw new ReservationError("This booth no longer exists.");
  const rejection = seatRejection(event,seat,company,input.size);
  if (rejection) throw new ReservationError(rejection);
  const advice = sizeAdvice(profileFor(company),state.sizes);
  if (input.size.w*input.size.h < advice.area && !input.undersizedAcknowledged) throw new ReservationError("Acknowledge the space warning or choose a larger booth.");
  if (!input.scenarios.some(s=>s.seatId===seat.id) || new Set(input.scenarios.map(s=>s.seatId)).size !== input.scenarios.length) throw new ReservationError("Compare this booth before reserving it.");
  const next: FairEvent = { ...event, items: event.items.map(i=>i.id===seat.id ? placedSeat(i,company,input.size) : i),
    rsvp: { ...state, final: undefined, records: [...state.records, { requestId: input.requestId, companyId: input.companyId, seatId: seat.id,
      size: input.size, profile: company.profile, sourceRevision: revision, order: state.order.indexOf(input.companyId)+1,
      scenarios: input.scenarios, timestamp: new Date().toISOString(), originalSeat: { x:seat.x,y:seat.y,w:seat.w,h:seat.h },
      undersizedAcknowledged: input.undersizedAcknowledged, scoringVersion: SCORING_VERSION }] } };
  if (!pendingCompanies(next).length) next.rsvp!.final = { status: "pending", sourceRevision: revision+1 };
  return next;
}

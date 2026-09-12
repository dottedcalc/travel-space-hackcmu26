import { eventCompanies, eventEntrances, eventExits, rectanglesOverlap, type ExhibitorCompany, type FairEvent, type Item } from "./event.ts";
import { boothQueuePoints, findPath, gridFor, validPosition, type Simulation } from "./simulation.ts";
import type { BoothSize, ExhibitorProfile, RSVPState, RSVPMetrics } from "./rsvp-types.ts";
import { queueWaitPersonSteps } from "./queue-wait.ts";

export const SCORING_VERSION = "rsvp-1:company70-venue30";
export const DEFAULT_SIZES: BoothSize[] = [{ name: "Small", w: 3, h: 2 }, { name: "Medium", w: 5, h: 3 }, { name: "Large", w: 7, h: 4 }];
export const companyId = (company: ExhibitorCompany) => company.id || `legacy:${encodeURIComponent(company.name.trim().toLocaleLowerCase())}`;
export function profileFor(company: ExhibitorCompany): ExhibitorProfile {
  return company.profile ?? { popularity: 2, peakRate: 4, dwell: 60, staff: 2, equipmentArea: 2, storageArea: 1,
    serviceRate: 6, minimumArea: 0, preferredLocation: "any", preferredNeighbors: [], avoidNeighbors: [], source: "estimated" };
}
export function rsvpState(event: FairEvent): RSVPState {
  const companies = eventCompanies(event), ids = companies.map(companyId);
  const saved = event.rsvp;
  const registrationIds = [...(event.companies ?? []), ...companies].map(companyId);
  const orderMode = saved?.orderMode ?? "random";
  const order = [...new Set([...(orderMode === "registration" ? [] : saved?.order ?? []), ...registrationIds])].filter(id => ids.includes(id));
  if (orderMode === "alphabetical" || orderMode === "popularity") {
    const byId = new Map(companies.map(c => [companyId(c), c]));
    order.sort((a, b) => orderMode === "alphabetical"
      ? byId.get(a)!.name.localeCompare(byId.get(b)!.name)
      : profileFor(byId.get(b)!).popularity - profileFor(byId.get(a)!).popularity);
  }
  return { order, orderMode,
    skipped: saved?.skipped ?? [], records: saved?.records ?? [], sizes: saved?.sizes ?? DEFAULT_SIZES,
    protectedAreas: saved?.protectedAreas ?? [], final: saved?.final };
}
/** Shuffle only when saving a new order; reads must never change whose turn it is. */
export function shuffleReservationOrder(ids: string[], random: () => number = Math.random) {
  const order = [...ids];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
export function randomizedRsvpOrder(event: FairEvent) {
  const order = rsvpState(event).order;
  const pending = new Set(pendingCompanies(event).map(companyId));
  return [...order.filter(id=>!pending.has(id)), ...shuffleReservationOrder(order.filter(id=>pending.has(id)))];
}
export function recommendedStaff(profile: ExhibitorProfile, queueSeconds = 0) {
  const simultaneousInteractions = Math.ceil(profile.peakRate * profile.dwell / 60);
  return Math.min(1000, Math.max(1, simultaneousInteractions + (queueSeconds > profile.dwell ? 1 : 0)));
}
export function pendingCompanies(event: FairEvent) {
  const state = rsvpState(event), companies = eventCompanies(event);
  return state.order.map(id => companies.find(c => companyId(c) === id)!).filter(c => c && !state.skipped.includes(companyId(c)) &&
    !event.items.some(i => i.kind === "booth" && i.company.toLocaleLowerCase() === c.name.toLocaleLowerCase()) &&
    !state.records.some(r => r.companyId === companyId(c) && !r.requeued));
}
export function sizeAdvice(profile: ExhibitorProfile, sizes: BoothSize[]) {
  const occupancy = Math.ceil(profile.peakRate * profile.dwell / 60);
  const area = Math.max(profile.minimumArea, occupancy * 1.2 + profile.staff * 1.5 + profile.equipmentArea + profile.storageArea);
  const recommended = [...sizes].sort((a,b) => a.w*a.h-b.w*b.h).find(s => s.w*s.h >= area);
  return { occupancy, area, recommended };
}
/** Pick the smallest adequate preset, or the largest eligible fit with a space warning. */
export function recommendedSizeForSeat(event: FairEvent, seat: Item, company: ExhibitorCompany): BoothSize | null {
  const profile = profileFor(company), area = sizeAdvice(profile, rsvpState(event).sizes).area;
  const feasible = [...rsvpState(event).sizes].sort((a,b)=>a.w*a.h-b.w*b.h)
    .filter(size=>!seatRejection(event,seat,company,size));
  return feasible.find(size=>size.w*size.h>=area) ?? feasible.at(-1) ?? null;
}
export function placedSeat(seat: Item, company: ExhibitorCompany, size: BoothSize): Item {
  const profile = profileFor(company);
  return { ...seat, x: seat.x + (seat.w - size.w) / 2, y: seat.y + seat.h - size.h, w: size.w, h: size.h,
    company: company.name, category: company.category, popularity: profile.popularity, dwell: profile.dwell, processingRate: profile.serviceRate };
}
export function seatRejection(event: FairEvent, seat: Item, company: ExhibitorCompany, size: BoothSize): string | null {
  const p = profileFor(company);
  if (seat.kind !== "booth" || seat.company) return "Already reserved";
  if (![size.w, size.h].every(n => Number.isFinite(n) && n >= 0.5 && n * 2 === Math.round(n * 2)) || size.w > seat.w || size.h > seat.h) return "Selected dimensions do not fit";
  if (size.w * size.h < p.minimumArea) return "Below minimum required area";
  if (seat.reservationPolicy?.disabled) return "Unavailable for reservations";
  if (seat.reservationPolicy?.requiredCategory && seat.reservationPolicy.requiredCategory !== company.category) return "Restricted exhibitor category";
  if (p.maximumBudget !== undefined && seat.reservationPolicy?.price === undefined) return "Price required to check your budget";
  if (p.maximumBudget !== undefined && (seat.reservationPolicy?.price ?? 0) > p.maximumBudget) return "Exceeds your budget";
  const placed = placedSeat(seat, company, size);
  const layout = { ...event, items: event.items.map(i => i.id === seat.id ? placed : i) };
  if (!validPosition(layout, placed)) return "Invalid booth placement";
  if (rsvpState(event).protectedAreas.some(r => rectanglesOverlap(r, placed))) return "Protected circulation area";
  const entrances = eventEntrances(layout), exits = eventExits(layout);
  if (entrances.some(e => !findPath(layout, e, exits).length) || exits.some(e => !findPath(layout, e, entrances).length)) return "Entrance or exit route is blocked";
  const queue = boothQueuePoints(layout, placed);
  if (!queue.length || !entrances.some(e => findPath(layout, e, queue.slice(0, 1)).length)) return "Booth frontage is inaccessible";
  return null;
}
export function feasibleSeats(event: FairEvent, company: ExhibitorCompany, size: BoothSize) {
  return event.items.filter(i => i.kind === "booth" && !seatRejection(event, i, company, size));
}
const clamp = (n: number) => Math.max(0, Math.min(1, n));
export function preliminaryScore(event: FairEvent, seat: Item, company: ExhibitorCompany, size: BoothSize, baseline: Simulation) {
  const p = profileFor(company), front = boothQueuePoints(event, seat)[0];
  const paths = front ? eventEntrances(event).map(e => findPath(event, e, [front]).length).filter(Boolean) : [];
  const distance = paths.length ? Math.min(...paths) * baseline.cell : Infinity;
  const proximity = 1 / (1 + distance / 10);
  const grid = gridFor(event);
  const index = front ? Math.floor(front.y / grid.cell) * grid.w + Math.floor(front.x / grid.cell) : -1;
  const traffic = clamp((baseline.heat[index] ?? 0) / 1);
  const neighbors = event.items.filter(i => i.kind === "booth" && i.company && Math.hypot(i.x-seat.x, i.y-seat.y) < 10);
  const related = neighbors.some(i => i.category === company.category || p.preferredNeighbors.includes(i.company));
  const avoided = neighbors.some(i => p.avoidNeighbors.includes(i.company));
  const cost = seat.reservationPolicy?.price;
  const terms: [number, number][] = [[0.25, size.w*size.h/(seat.w*seat.h)], [0.2, proximity], [0.3, p.preferredLocation === "quiet" ? 1-traffic : traffic],
    [0.15, avoided ? 0 : related ? 1 : 0.5], [0.1, p.preferredLocation === "entrance" ? proximity : 0.5]];
  if (cost !== undefined && p.maximumBudget !== undefined) terms.push([0.1, 1-clamp(cost/Math.max(1,p.maximumBudget))]);
  return terms.reduce((n,[w,v])=>n+w*v,0)/terms.reduce((n,[w])=>n+w,0);
}
/** Keep active identities/order constant across candidate locations. The engine remains unchanged. */
export function scenarioLayout(event: FairEvent, company: ExhibitorCompany, size: BoothSize, seatId: string) {
  const seat = event.items.find(i => i.id === seatId)!;
  const layout = { ...event, items: event.items.map(i => i.id === seatId ? placedSeat(i, company, size) : { ...i }) };
  const candidateId = `rsvp:${companyId(company)}`;
  layout.items = layout.items.filter(i => i.id !== seatId).sort((a,b)=>a.id.localeCompare(b.id));
  layout.items.push({ ...placedSeat(seat, company, size), id: candidateId });
  return { layout, candidateId };
}
export function remapScenario(layout: FairEvent, simulation: Simulation, candidateId: string, seatId: string) {
  const map = (id: string) => id === candidateId ? seatId : id;
  return { layout: { ...layout, items: layout.items.map(i => ({ ...i, id: map(i.id) })) }, simulation: { ...simulation,
    agents: simulation.agents.map(a => ({ ...a, route: a.route.map(map), ...(a.pauses ? { pauses: a.pauses.map(p => ({ ...p, itemId: map(p.itemId) })) } : {}), queueVisits: a.queueVisits.map(q => ({ ...q, itemId: map(q.itemId) })) })),
    queues: simulation.queues.map(q => ({ ...q, itemId: map(q.itemId) })), findings: simulation.findings.map(f => ({ ...f, itemId: f.itemId ? map(f.itemId) : undefined })) } };
}
function boothMetrics(sim: Simulation, id: string) {
  let visitors=0, intended=0, queuePeople=0, seconds=0;
  for (const a of sim.agents) {
    if (a.route.includes(id)) intended += a.weight;
    for (const q of a.queueVisits.filter(q=>q.itemId===id)) {
      if (q.departed !== null && q.departed < sim.duration) visitors += a.weight;
      seconds += queueWaitPersonSteps(a.weight,q,sim.duration)*sim.stepSeconds;
      queuePeople += a.weight;
    }
  }
  return { visitors, intended, queueSeconds: queuePeople ? seconds/queuePeople : 0 };
}
export function evaluateScenario(event: FairEvent, sim: Simulation, seatId: string, baseline: Simulation): RSVPMetrics {
  const booth = event.items.find(i=>i.id===seatId)!;
  const local = boothMetrics(sim,seatId);
  const missedRate = local.intended ? clamp(1-local.visitors/local.intended) : 0;
  const front = { x: booth.x+booth.w/2, y: booth.y+booth.h+0.5 };
  const exposure = sim.agents.reduce((n,a)=>n+(a.path.some(p=>Math.hypot(p.x-front.x,p.y-front.y)<=3)?a.weight:0),0);
  const grid=gridFor(event), floor=sim.heat.filter((_,i)=>!grid.blocked[i]);
  const sum=floor.reduce((n,v)=>n+v,0), square=floor.reduce((n,v)=>n+v*v,0);
  const balance=sum && square ? clamp(sum*sum/(floor.length*square)) : 0;
  const coverage=floor.length ? floor.filter(v=>v>0.01).length/floor.length : 0;
  const density=sim.peakLocalDensity.reduce((n,v)=>Math.max(n,v),0);
  const neighborIds=event.items.filter(i=>i.kind==="booth" && i.company && i.id!==seatId && Math.hypot(i.x-booth.x,i.y-booth.y)<10).map(i=>i.id);
  const neighborVisitChange=neighborIds.reduce((n,id)=>n+boothMetrics(sim,id).visitors-boothMetrics(baseline,id).visitors,0);
  const companyScore=Math.round(100*(0.45*clamp(local.visitors/Math.max(1,sim.totalVisitors))+0.2*clamp(exposure/Math.max(1,sim.totalVisitors))+0.2*(1-clamp(local.queueSeconds/600))+0.15*(1-missedRate)));
  const venueScore=Math.round(100*(0.25*balance+0.2*coverage+0.35*(1-clamp(density/4))+0.2*(1-clamp(sim.stranded/Math.max(1,sim.totalVisitors)))));
  return { ...local, missedRate, exposure, density, coverage, balance, neighborVisitChange, companyScore, venueScore, score: Math.round(companyScore*0.7+venueScore*0.3) };
}

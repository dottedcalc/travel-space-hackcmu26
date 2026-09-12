import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { seedEvent } from "../lib/event.ts";
import { simulate } from "../lib/simulation.ts";
import { companyId, DEFAULT_SIZES, evaluateScenario, feasibleSeats, pendingCompanies, profileFor, randomizedRsvpOrder, recommendedSizeForSeat, recommendedStaff, remapScenario, rsvpState, scenarioLayout, seatRejection, shuffleReservationOrder, sizeAdvice } from "../lib/rsvp.ts";
import { confirmReservation } from "../lib/rsvp-reservation.ts";
function fixture() {
  const a={id:"a",name:"Alpha",category:"Robotics"},b={id:"b",name:"Beta",category:"Design"};
  a.profile={...profileFor(a),peakRate:1,dwell:10};b.profile=profileFor(b);
  const seed=seedEvent();
  return {...seed,visitors:100,startTime:"08:00",endTime:"09:00",companies:[a,b],items:seed.items.map(i=>({...i,company:"",processingRate:120}))};
}
const emptyMetrics={visitors:10,intended:20,missedRate:.5,queueSeconds:60,exposure:30,density:1,coverage:.5,balance:.5,neighborVisitChange:0,companyScore:50,venueScore:50,score:50};
const input=(event,revision=0)=>({companyId:"a",seatId:"b1",size:DEFAULT_SIZES[1],revision,requestId:randomUUID(),scenarios:[{seatId:"b1",label:"B01",metrics:emptyMetrics}],undersizedAcknowledged:true});
test("sizes use physical dimensions, supplied demand, and hard minimums",()=>{
  const event=fixture(),a=event.companies[0];
  assert.equal(sizeAdvice({...a.profile,peakRate:12,dwell:60},DEFAULT_SIZES).occupancy,12);
  assert.equal(seatRejection(event,event.items[0],a,DEFAULT_SIZES[2]),"Selected dimensions do not fit");
  assert.equal(seatRejection(event,event.items[0],{...a,profile:{...a.profile,minimumArea:20}},DEFAULT_SIZES[1]),"Below minimum required area");
  assert.equal(seatRejection(event,event.items[0],a,{name:"Custom",w:NaN,h:2}),"Selected dimensions do not fit");
});
test("automatic sizing chooses adequate space, then the largest eligible fallback",()=>{
  const event=fixture(),a=event.companies[0],seat=event.items[0];
  a.profile={...a.profile,staff:1,equipmentArea:0,storageArea:0};
  assert.equal(recommendedSizeForSeat(event,seat,a)?.name,"Small");
  a.profile={...a.profile,peakRate:8,dwell:60,staff:8};
  assert.equal(recommendedSizeForSeat(event,seat,a)?.name,"Medium");
  assert.equal(recommendedStaff(a.profile),8);
  assert.equal(recommendedStaff(a.profile,120),9);
  assert.equal(recommendedSizeForSeat(event,{...seat,reservationPolicy:{disabled:true}},a),null);
});
test("random turn order is shuffled only on save and remains stable on reads",()=>{
  assert.deepEqual(shuffleReservationOrder(["a","b","c"],()=>0),["b","c","a"]);
  const event=fixture();event.rsvp={...rsvpState(event),orderMode:"random"};
  const drawn=randomizedRsvpOrder(event);
  event.rsvp.order=drawn;
  assert.deepEqual(rsvpState(event).order,drawn);
  assert.deepEqual(pendingCompanies(event).map(companyId),drawn);
});
test("feasibility handles price, protected rectangles, and unavailable seats",()=>{
  const event=fixture(),a=event.companies[0],seat=event.items[0];
  assert.ok(feasibleSeats(event,a,DEFAULT_SIZES[1]).length>=5);
  const budget={...a,profile:{...a.profile,maximumBudget:100}};
  assert.equal(seatRejection(event,seat,budget,DEFAULT_SIZES[1]),"Price required to check your budget");
  assert.equal(seatRejection(event,{...seat,reservationPolicy:{price:101}},budget,DEFAULT_SIZES[1]),"Exceeds your budget");
  event.rsvp={...rsvpState(event),protectedAreas:[{x:seat.x,y:seat.y,w:seat.w,h:seat.h}]};
  assert.equal(seatRejection(event,seat,a,DEFAULT_SIZES[1]),"Protected circulation area");
  assert.equal(seatRejection(event,{...seat,company:"Taken"},a,DEFAULT_SIZES[1]),"Already reserved");
});
test("confirmation is atomic, advances one turn, and rejects stale or wrong-turn submissions",()=>{
  const event=fixture(),request=input(event),before=JSON.stringify(event);
  assert.throws(()=>confirmReservation(event,0,{...request,companyId:"b"}),/another exhibitor/);
  assert.throws(()=>confirmReservation(event,1,request),/layout changed/);
  const next=confirmReservation(event,0,request);
  assert.equal(JSON.stringify(event),before);
  assert.equal(next.items[0].company,"Alpha");
  assert.equal(pendingCompanies(next)[0].name,"Beta");
  assert.equal(next.rsvp.records.length,1);
  assert.equal(confirmReservation(next,1,request),next);
  assert.throws(()=>confirmReservation(next,1,{...request,seatId:"b2"}),/already used/);
  assert.ok(!feasibleSeats(next,next.companies[1],DEFAULT_SIZES[1]).some(s=>s.id==="b1"));
  const second={...request,companyId:"b",seatId:"b2",requestId:randomUUID(),revision:1,scenarios:[{seatId:"b2",label:"B02",metrics:emptyMetrics}]};
  const final=confirmReservation(next,1,second);
  assert.equal(final.rsvp.final.status,"pending");assert.equal(final.rsvp.final.sourceRevision,2);
});
test("undersized overrides never bypass required area",()=>{
  const event=fixture();event.companies[0].profile.peakRate=120;
  assert.throws(()=>confirmReservation(event,0,{...input(event),undersizedAcknowledged:false}),/space warning/);
  assert.equal(confirmReservation(event,0,input(event)).items[0].company,"Alpha");
  event.companies[0].profile.minimumArea=30;
  assert.throws(()=>confirmReservation(event,0,input(event)),/minimum required area/);
});
test("candidate placement preserves visitor inputs and does not mutate the confirmed map",()=>{
  const event=fixture(),before=JSON.stringify(event),company=event.companies[0];
  const a=scenarioLayout(event,company,DEFAULT_SIZES[1],"b1"),b=scenarioLayout(event,company,DEFAULT_SIZES[1],"b2");
  const sa=simulate(a.layout),sb=simulate(b.layout);
  const inputs=s=>s.agents.map(a=>({start:a.start,type:a.type,route:a.route,weight:a.weight}));
  assert.deepEqual(inputs(sa),inputs(sb));assert.equal(JSON.stringify(event),before);
  const remapped=remapScenario(a.layout,sa,a.candidateId,"b1");
  assert.ok(remapped.simulation.agents.some(a=>a.route.includes("b1")));
  assert.ok(remapped.layout.items.some(i=>i.id==="b1"));
});
test("metrics weight visits and unfinished queue waits by represented population",()=>{
  const event=fixture(),a=event.companies[0],scenario=scenarioLayout(event,a,DEFAULT_SIZES[1],"b1");
  const sim=simulate(scenario.layout),mapped=remapScenario(scenario.layout,sim,scenario.candidateId,"b1");
  const synthetic={...mapped.simulation,duration:100,stepSeconds:2,totalVisitors:30,agents:[
    {id:0,route:["b1"],weight:10,path:[],queueVisits:[{itemId:"b1",joined:0,serviceStart:5,departed:20}]},
    {id:1,route:["b1"],weight:20,path:[],queueVisits:[{itemId:"b1",joined:50,serviceStart:null,departed:null}]},
  ]};
  const metrics=evaluateScenario(mapped.layout,synthetic,"b1",{...synthetic,agents:[]});
  // The served group also waits 0, 3, ..., 27 seconds within its own service block.
  assert.equal(metrics.visitors,10);assert.equal(metrics.intended,30);assert.equal(metrics.queueSeconds,74.5);
  assert.ok(Math.abs(metrics.missedRate-2/3)<1e-9);assert.ok(metrics.score>=0&&metrics.score<=100);
  const partial={...synthetic,agents:synthetic.agents.map((agent,index)=>index ? agent : {...agent,
    queueVisits:[{itemId:"b1",joined:0,serviceStart:5,serviceEnd:205,departed:null}]})};
  // Five start at steps 5, 25, 45, 65, 85; the other five wait until step 100.
  const partialMetrics=evaluateScenario(mapped.layout,partial,"b1",{...partial,agents:[]});
  assert.equal(partialMetrics.queueSeconds,115);
});
test("legacy identity stays stable once saved, and released turns require explicit requeue",()=>{
  const event=fixture(),legacy={name:"Legacy",category:"Art"};
  assert.equal(companyId(legacy),companyId({...legacy,name:"LEGACY"}));
  const next=confirmReservation(event,0,input(event));next.items[0].company="";next.rsvp.records[0].released=true;
  assert.equal(pendingCompanies(next)[0].id,"b");
  next.rsvp.records[0].requeued=true;next.rsvp.order=["b","a"];
  assert.deepEqual(pendingCompanies(next).map(c=>c.id),["b","a"]);
});

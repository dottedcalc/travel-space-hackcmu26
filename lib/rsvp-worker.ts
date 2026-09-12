import { simulate } from "./simulation.ts";
import { evaluateScenario, feasibleSeats, preliminaryScore, recommendedSizeForSeat, remapScenario, scenarioLayout } from "./rsvp.ts";
import type { ExhibitorCompany, FairEvent } from "./event.ts";
import type { BoothSize } from "./rsvp-types.ts";
self.onmessage=(message:MessageEvent<{event:FairEvent;company?:ExhibitorCompany;size?:BoothSize;seatId?:string;final?:boolean}>)=>{
  const {event,company,size,seatId}=message.data;
  try {
    if(message.data.final) { self.postMessage({final:simulate(event)}); return; }
    if(!company) throw new Error("Choose an exhibitor first.");
    if(seatId) {
      const seat=event.items.find(i=>i.id===seatId);
      const chosenSize=size??(seat&&recommendedSizeForSeat(event,seat,company));
      if(!chosenSize) throw new Error("This location no longer fits your exhibit. Compare again.");
      const scenario=scenarioLayout(event,company,chosenSize,seatId);
      self.postMessage({detail:{seatId,...remapScenario(scenario.layout,simulate(scenario.layout),scenario.candidateId,seatId)}});
      return;
    }
    const feasible=size ? feasibleSeats(event,company,size).map(seat=>({seat,size}))
      : event.items.filter(i=>i.kind==="booth"&&!i.company).flatMap(seat=>{const choice=recommendedSizeForSeat(event,seat,company);return choice?[{seat,size:choice}]:[];});
    if(!feasible.length) { self.postMessage({done:true,scenarios:[]}); return; }
    self.postMessage({progress:"Evaluating the current layout…"});
    const baseline=simulate({...event,items:[...event.items].sort((a,b)=>a.id.localeCompare(b.id))});
    if(baseline.totalVisitors>0&&baseline.stranded>=baseline.totalVisitors) throw new Error("Visitors cannot explore this layout. Ask the organizer to connect reception, entrances, and exits before comparing booths.");
    const candidates=feasible.map(({seat,size:choice})=>({seat,size:choice,score:preliminaryScore(event,seat,company,choice,baseline)}))
      .sort((a,b)=>b.score-a.score||a.seat.id.localeCompare(b.seat.id)).slice(0,5);
    const scenarios=[];
    for(const [index,{seat,size:choice}] of candidates.entries()) {
      self.postMessage({progress:`Comparing booth ${index+1} of ${candidates.length}…`});
      try {
        const scenario=scenarioLayout(event,company,choice,seat.id);
        const result=remapScenario(scenario.layout,simulate(scenario.layout),scenario.candidateId,seat.id);
        scenarios.push({seatId:seat.id,label:seat.label,metrics:evaluateScenario(result.layout,result.simulation,seat.id,baseline)});
      } catch { self.postMessage({warning:`${seat.label} could not be evaluated. Retry the comparison to include it.`}); }
    }
    scenarios.sort((a,b)=>b.metrics.score-a.metrics.score||a.seatId.localeCompare(b.seatId));
    self.postMessage({done:true,scenarios});
  } catch(error) { self.postMessage({error:error instanceof Error?error.message:"Comparison could not finish. Please retry."}); }
};

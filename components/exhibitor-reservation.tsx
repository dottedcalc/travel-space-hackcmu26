"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import RSVPWorker from "@/lib/rsvp-worker?worker";
import { Check, LoaderCircle, Play, Pause, Sparkles, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { Area, AreaChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import FloorMap from "@/components/floor-map";
import { eventCompanies, type ExhibitorCompany, type FairEvent } from "@/lib/event";
import { companyId, pendingCompanies, profileFor, recommendedSizeForSeat, recommendedStaff, rsvpState, sizeAdvice } from "@/lib/rsvp";
import type { ExhibitorProfile, ScenarioSummary } from "@/lib/rsvp-types";
import type { Simulation } from "@/lib/simulation";
import type { WorkspaceRecord } from "@/lib/workspaces";

type Props = { event: FairEvent; revision: number; apiUrl: string; company?: ExhibitorCompany; organizer: boolean; disabled: boolean; onSaved: (record: WorkspaceRecord) => void };
type Detail = { seatId: string; layout: FairEvent; simulation: Simulation };
const number = (n: number) => Math.round(n).toLocaleString();
function VisitorTimeline({ simulation, time }: { simulation: Simulation; time: number }) {
  const data = useMemo(() => {
    const changes = simulation.agents.filter(agent => agent.path.length).flatMap(agent => [
      { step: agent.start, delta: agent.weight },
      { step: agent.endStep, delta: -agent.weight },
    ]).sort((a, b) => a.step - b.step);
    const minutes = simulation.duration * simulation.stepSeconds / 60;
    const intervalMinutes = minutes <= 90 ? 5 : 10;
    const intervalSteps = intervalMinutes * 60 / simulation.stepSeconds;
    const samples = Math.max(2, Math.ceil(simulation.duration / intervalSteps) + 1);
    let index = 0, visitors = 0;
    return Array.from({ length: samples }, (_, i) => {
      const step = Math.min(i * intervalSteps, simulation.duration);
      while (index < changes.length && changes[index].step <= step) visitors += changes[index++].delta;
      return { minute: step * simulation.stepSeconds / 60, visitors };
    });
  }, [simulation]);
  const current = simulation.agents.reduce((count, agent) => count +
    (agent.path.length && time >= agent.start && time < agent.endStep ? agent.weight : 0), 0);
  const minutes = simulation.duration * simulation.stepSeconds / 60;
  return <div className="rsvp-visitor-chart" aria-label={`Estimated visitors on the floor over time; ${number(current)} at ${Math.floor(time * simulation.stepSeconds / 60)} minutes`}>
    <div className="rsvp-chart-heading"><span>Visitors on floor</span><strong>{number(current)}</strong></div>
    <ChartContainer config={{ visitors: { label: "Visitors", color: "#3279b8" } }} className="rsvp-chart-canvas">
      <AreaChart data={data} margin={{ top: 12, right: 8, bottom: 2, left: -18 }}>
        <defs><linearGradient id="rsvpVisitorsFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--color-visitors)" stopOpacity={0.26}/><stop offset="100%" stopColor="var(--color-visitors)" stopOpacity={0.02}/></linearGradient></defs>
        <XAxis dataKey="minute" type="number" domain={[0, minutes]} ticks={[0, minutes]} tickFormatter={value => `${Math.round(value)}m`} tickLine={false} axisLine={false} fontSize={11}/>
        <YAxis allowDecimals={false} tickCount={3} tickLine={false} axisLine={false} width={38} fontSize={11}/>
        <ChartTooltip formatter={value => [`${number(Number(value))} visitors`, "On floor"]} labelFormatter={value => `${Math.round(Number(value))} min`}/>
        <Area type="monotone" dataKey="visitors" stroke="var(--color-visitors)" strokeWidth={2} fill="url(#rsvpVisitorsFill)" isAnimationActive={false}/>
        <ReferenceLine x={time * simulation.stepSeconds / 60} stroke="#bd6034" strokeWidth={2} ifOverflow="extendDomain"/>
      </AreaChart>
    </ChartContainer>
  </div>;
}
function Picker({ label, value, options, onChange }: { label:string;value:string;options:{value:string;label:string}[];onChange:(value:string)=>void }) {
  return <label className="rsvp-field"><span>{label}</span><Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label}><SelectValue /></SelectTrigger><SelectContent>{options.map(o=><SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select></label>;
}
function ProfileForm({ company, disabled, save }: { company:ExhibitorCompany;disabled:boolean;save:(profile:ExhibitorProfile)=>Promise<boolean> }) {
  const [profile,setProfile]=useState(()=>profileFor(company));
  return <form onSubmit={async e=>{
    e.preventDefault();
    const previous=profileFor(company);
    const demand={...profile,peakRate:!company.profile || profile.popularity !== previous.popularity ? 2 ** profile.popularity : previous.peakRate};
    const staff=recommendedStaff(demand);
    await save({...demand,staff,serviceRate:Math.min(120,staff*3)});
  }}>
    <div className="rsvp-profile-grid">
      <Picker label="Expected popularity" value={String(profile.popularity)} options={[
        {value:"1",label:"Low"},{value:"2",label:"Medium"},{value:"3",label:"High"},
        ...([1,2,3].includes(profile.popularity)?[]:[{value:String(profile.popularity),label:`Current (${profile.popularity})`}]),
      ]} onChange={v=>setProfile({...profile,popularity:Number(v)})}/>
      <label className="rsvp-field"><span>Average interaction time (minutes)</span><Input type="number" min={1/6} max={30} step="any" required value={profile.dwell/60} onChange={e=>setProfile({...profile,dwell:Math.round(Number(e.target.value)*60)})}/></label>
    </div>
    <Button type="submit" disabled={disabled}><Check size={16}/>Save profile</Button>
  </form>;
}

export default function ExhibitorReservation({event,revision,apiUrl,company,organizer,disabled,onSaved}:Props) {
  const state=rsvpState(event), companies=eventCompanies(event), pending=pendingCompanies(event), current=pending[0];
  const [busy,setBusy]=useState(false), [error,setError]=useState(""), [progress,setProgress]=useState("");
  const [warnings,setWarnings]=useState<string[]>([]), [scenarios,setScenarios]=useState<ScenarioSummary[]|null>(null);
  const [selected,setSelected]=useState(""), [detail,setDetail]=useState<Detail|null>(null);
  const [acknowledged,setAcknowledged]=useState(false), [time,setTime]=useState(0), [playing,setPlaying]=useState(false);
  const [editingProfile,setEditingProfile]=useState(false);
  const worker=useRef<Worker|null>(null), generation=useRef(0), requestId=useRef("");
  const snapshot=useRef({event,revision,company});
  useEffect(()=>{snapshot.current={event,revision,company};},[event,revision,company]);
  const invalidateKey=JSON.stringify([revision,company?.name]);
  useEffect(()=>{
    generation.current++;worker.current?.terminate();worker.current=null;
    // Workspace updates invalidate previews and stop the external simulation worker together.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScenarios(null);setDetail(null);setSelected("");setProgress("");setPlaying(false);setWarnings([]);setAcknowledged(false);
    requestId.current=crypto.randomUUID();
  },[invalidateKey]);
  useEffect(()=>()=>worker.current?.terminate(),[]);
  useEffect(()=>{
    if(!playing||!detail)return;
    const interval=setInterval(()=>setTime(t=>{const next=Math.min(detail.simulation.duration,t+60/detail.simulation.stepSeconds);if(next===detail.simulation.duration)setPlaying(false);return next;}),100);
    return ()=>clearInterval(interval);
  },[playing,detail]);
  async function save(payload:object, method="PATCH") {
    setBusy(true);setError("");
    try {
      const response=await fetch(`${apiUrl}/rsvp`,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify({...payload,revision:snapshot.current.revision})});
      const data=await response.json() as WorkspaceRecord & {error?:string};
      if(!response.ok) {
        if(response.status===409) {
          const fresh=await fetch(apiUrl);if(fresh.ok)onSaved(await fresh.json());
        }
        throw new Error(data.error||"Could not save. Please retry.");
      }
      onSaved(data);return true;
    }catch(e){setError(e instanceof Error?e.message:"Could not save. Please retry.");return false;}
    finally{setBusy(false);}
  }
  function startWorker(seatId?:string,final=false) {
    worker.current?.terminate();const run=++generation.current;
    const next=new RSVPWorker();worker.current=next;
    setError("");setPlaying(false);setProgress(final?"Simulating the final layout…":seatId?"Preparing scenario playback…":"Checking available booths…");
    if(!seatId&&!final){setScenarios(null);setWarnings([]);setDetail(null);}
    next.onerror=()=>{if(run===generation.current){setError("The comparison could not finish. Try again.");setProgress("");next.terminate();}};
    next.onmessage=(message)=>{
      if(run!==generation.current)return;
      const data=message.data;
      if(data.progress)setProgress(data.progress);
      if(data.warning)setWarnings(w=>[...w,data.warning]);
      if(data.error){setError(data.error);setProgress("");next.terminate();}
      if(data.done){setScenarios(data.scenarios);setProgress("");next.terminate();if(data.scenarios?.length){setSelected(data.scenarios[0].seatId);setAcknowledged(false);startWorker(data.scenarios[0].seatId);}}
      if(data.detail){setDetail(data.detail);setTime(0);setProgress("");next.terminate();}
      if(data.final){setDetail({seatId:"",layout:snapshot.current.event,simulation:data.final});setProgress("");next.terminate();void save({action:"final",visits:data.final.visits,peak:data.final.peak,queueSeconds:data.final.queueWait});}
    };
    const current=snapshot.current;
    next.postMessage({event:current.event,company:current.company,seatId,final});
  }
  // Final simulation is triggered after the last confirmation. On reload the pending state remains retryable.
  const finalStarted=useRef<number|null>(null);
  useEffect(()=>{
    if(event.rsvp?.final?.status==="pending"&&!disabled&&!busy&&!progress&&finalStarted.current!==revision){
      finalStarted.current=revision;startWorker(undefined,true);
    }
  // Start only for a new final-layout revision; worker completion updates the persisted status.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[revision,event.rsvp?.final?.status,disabled]);
  const profile=company?profileFor(company):null, advice=profile?sizeAdvice(profile,state.sizes):null;
  const isTurn=!!company&&!!current&&companyId(company)===companyId(current);
  const myBooth=company?event.items.find(i=>i.kind==="booth"&&i.company===company.name):null;
  const selectedScenario=scenarios?.find(s=>s.seatId===selected);
  const selectedSeat=event.items.find(i=>i.id===selected);
  const selectedSize=company&&selectedSeat?recommendedSizeForSeat(event,selectedSeat,company):null;
  const undersized=!!selectedSize&&!!advice&&selectedSize.w*selectedSize.h<advice.area;
  const available=event.items.filter(i=>i.kind==="booth"&&!i.company);
  const finalContent=state.final&&<div className="rsvp-final"><Check size={18}/><div><strong>{state.final.status==="complete"?"Final layout evaluated":"All reservation turns are complete"}</strong><p>{state.final.status==="complete"?`${number(state.final.visits??0)} estimated booth visits · ${((state.final.queueSeconds??0)/60).toFixed(1)} min average queue`:(progress||"The final crowd simulation is ready to run.")}</p></div><Button variant="outline" disabled={!!progress||busy} onClick={()=>startWorker(undefined,true)}>Run final simulation</Button></div>;
  if(organizer)return <section className="rsvp-panel"><details><summary>Exhibitor reservations <span>{pending.length} waiting{current?` · Next: ${current.name}`:""}</span></summary>
    {error&&<p role="alert" className="rsvp-warning">{error}</p>}
    <OrganizerSettings key={JSON.stringify([state.orderMode,state.sizes,event.items.map(i=>i.reservationPolicy)])} event={event} disabled={busy||disabled} save={save}/>
    <details className="rsvp-order-summary"><summary>Reservation queue <span>{pending.length} waiting</span></summary>
      <ol className="rsvp-queue-list">{state.order.map(id=>{
        const c=companies.find(c=>companyId(c)===id);if(!c)return null;
        const booked=event.items.some(i=>i.kind==="booth"&&i.company===c.name);
        const released=state.records.some(r=>r.companyId===id&&r.released&&!r.requeued);
        const skipped=state.skipped.includes(id);
        return <li key={id}><strong>{c.name}</strong><span>{booked?"Reserved":released?"Released":skipped?"Skipped":current&&companyId(current)===id?"Choosing now":"Waiting"}</span>
          {!booked&&(released||skipped)&&<Button size="sm" variant="outline" disabled={busy||disabled} onClick={()=>void save(released?{action:"requeue",companyId:id}:{action:"order",order:state.order,skipped:state.skipped.filter(x=>x!==id)})}>Return to queue</Button>}
        </li>;
      })}</ol>
      {!companies.length&&<p>No exhibitors registered yet.</p>}
    </details>
    {finalContent}
  </details></section>;
  if(!company)return <section className="rsvp-panel"><div className="rsvp-heading"><Sparkles size={20}/><div><h2>Find the right location for your exhibit</h2><p>Choose your exhibit above to see a location and staffing recommendation.</p></div></div></section>;
  return <section className="rsvp-panel" id="exhibitor-reservation">
    <div className="rsvp-heading"><Sparkles size={22}/><div><h2>Your booth recommendation</h2></div></div>
    {error&&<p role="alert" className="rsvp-warning">{error}</p>}
    <div className="rsvp-steps"><span className={!company.profile?"active":""}>1 · Your profile</span><span className={company.profile?"active":""}>2 · Review recommendation & RSVP</span></div>
    <details open={!company.profile||editingProfile} onToggle={e=>setEditingProfile(e.currentTarget.open)}><summary>Exhibitor profile {!company.profile&&<span>Complete before comparing</span>}</summary>
      <ProfileForm key={JSON.stringify(company)} company={company} disabled={busy||disabled} save={async profile=>{const ok=await save({action:"profile",companyId:companyId(company),profile});if(ok)setEditingProfile(false);return ok;}}/>
    </details>
    {company.profile&&!myBooth&&<>
      <div className="rsvp-size-intro"><div><h3>We’ll find your best location</h3><p>Estimated peak interactions: <strong>{advice!.occupancy}</strong> · Space needed: <strong>{advice!.area.toFixed(1)} m²</strong></p></div></div>
      {!isTurn&&<p className="rsvp-note">Your profile is ready. The location recommendation becomes available when it is your turn.</p>}
      <div className="rsvp-actions"><Button disabled={!isTurn||busy||disabled||!!progress} onClick={()=>startWorker()}><Sparkles size={17}/>{scenarios?"Refresh recommendation":"Find my location"}</Button><span>{available.length} available locations</span></div>
      {progress&&<div role="status" className="rsvp-progress"><LoaderCircle className="animate-spin" size={18}/>{progress}<Button size="sm" variant="ghost" onClick={()=>{generation.current++;worker.current?.terminate();setProgress("");}}>Cancel</Button></div>}
      {warnings.map(w=><p className="rsvp-warning" key={w}>{w}</p>)}
      {scenarios?.length===0&&<div className="rsvp-empty"><h3>No suitable location available</h3><p>Ask the organizer to review available space or reservation restrictions.</p>{available.map(seat=><p key={seat.id}><strong>{seat.label}</strong> · {recommendedSizeForSeat(event,seat,company)?"Simulation unavailable — retry recommendation":"No fitting, eligible booth here"}</p>)}</div>}
      {!!scenarios?.length&&<>
        <div className="rsvp-comparison-heading"><h3>Best location: {scenarios[0].label}</h3></div>
        <details className="rsvp-alternatives"><summary>See other locations and comparison</summary>
          <div className="rsvp-table-wrap"><table className="rsvp-table"><thead><tr><th>Location</th><th>Visitor reach &amp; service score</th><th>Hall circulation score</th><th>Visitors served</th><th>Avg. queue</th><th>Peak congestion</th></tr></thead><tbody>{scenarios.map((s,index)=><tr key={s.seatId} className={selected===s.seatId?"selected":""}><td><button onClick={()=>{setSelected(s.seatId);setAcknowledged(false);setDetail(null);startWorker(s.seatId);}}><strong>{String.fromCharCode(65+index)} · {s.label}</strong><span>{index===0?"Recommended":"View location"}</span></button></td><td>{s.metrics.companyScore}</td><td>{s.metrics.venueScore}</td><td>{number(s.metrics.visitors)}</td><td>{(s.metrics.queueSeconds/60).toFixed(1)} min</td><td><span className={`rsvp-density ${s.metrics.density>=4?"high":s.metrics.density>=1?"medium":"low"}`}>{s.metrics.density>=4?"High":s.metrics.density>=1?"Medium":"Low"}</span></td></tr>)}</tbody></table></div>
        </details>
        {selectedScenario&&<div className="rsvp-detail"><div className="rsvp-detail-heading"><h3>{selectedScenario.label} · {selected===scenarios[0].seatId?"Recommended location":"Alternative location"}</h3></div>
          <p>Suggested team: <strong>{recommendedStaff(profile!,selectedScenario.metrics.queueSeconds)} {recommendedStaff(profile!,selectedScenario.metrics.queueSeconds)===1?"staff member":"staff members"}</strong> based on expected demand and simulated queue time. {number(selectedScenario.metrics.exposure)} people pass nearby; {number(selectedScenario.metrics.visitors)} visits are estimated to be served.</p>
          <details className="rsvp-analytics" open><summary>Crowd-flow playback and tradeoffs</summary>
            {detail&&<><div className="rsvp-playback-visuals"><div className="rsvp-map"><FloorMap event={detail.layout} selected={selected} onSelect={()=>{}} onChange={()=>{}} editable={false} simulation={detail.simulation} time={time} heat people/></div><VisitorTimeline simulation={detail.simulation} time={time}/></div><div className="rsvp-playback"><Button variant="outline" size="sm" aria-label={playing?"Pause scenario":"Play scenario"} onClick={()=>setPlaying(!playing)}>{playing?<Pause size={16}/>:<Play size={16}/>}</Button><Button variant="ghost" size="sm" aria-label="Restart scenario" onClick={()=>{setTime(0);setPlaying(false);}}><RotateCcw size={16}/></Button><Slider aria-label="Scenario time" min={0} max={detail.simulation.duration} value={[time]} onValueChange={v=>setTime(Array.isArray(v)?v[0]:v)}/><span>{Math.floor(time*detail.simulation.stepSeconds/60)} min</span></div></>}
            <div className="rsvp-tradeoffs"><div><h4>Visitor reach &amp; service</h4><p>{number(selectedScenario.metrics.visitors)} visitors served; {number(selectedScenario.metrics.exposure)} visitors pass within 3 m of the frontage.</p><p>{(selectedScenario.metrics.missedRate*100).toFixed(0)}% of intended visits do not finish booth service before closing.</p></div><div><h4>Hall circulation &amp; congestion</h4><p>Peak local density: {selectedScenario.metrics.density.toFixed(2)} people/m². Average admitted queue wait: {(selectedScenario.metrics.queueSeconds/60).toFixed(1)} min.</p><p>Nearby booths: {selectedScenario.metrics.neighborVisitChange>=0?"+":""}{number(selectedScenario.metrics.neighborVisitChange)} visitors served compared with the current layout.</p></div></div>
          </details>
          {undersized&&<div className="rsvp-warning"><strong>Available space is below the estimated {advice!.area.toFixed(1)} m² need.</strong><p>This location may feel crowded. Ask the organizer about more space if needed.</p><label className="rsvp-check"><Checkbox checked={acknowledged} onCheckedChange={v=>setAcknowledged(v===true)}/>I understand and want to RSVP here.</label></div>}
          <Button disabled={busy||disabled||!!progress||!detail||!isTurn||!selectedSize||(undersized&&!acknowledged)} onClick={()=>{if(selectedSize)void save({companyId:companyId(company),seatId:selected,size:selectedSize,scenarios,requestId:requestId.current,undersizedAcknowledged:acknowledged},"POST");}}><Check size={17}/>{busy?"Reserving…":`RSVP for ${selectedScenario.label}`}</Button>
        </div>}
      </>}
    </>}
    {myBooth&&<div className="rsvp-confirmed"><Check size={22}/><div><strong>{myBooth.label} is reserved for {company.name}</strong><p>{current?`${current.name} receives the next recommendations using this updated layout.`:"The reservation order is complete."}</p></div></div>}
  </section>;
}

function OrganizerSettings({event,disabled,save}:{event:FairEvent;disabled:boolean;save:(payload:object)=>Promise<boolean>}) {
  const state=rsvpState(event);
  const [orderMode,setOrderMode]=useState(state.orderMode??"random");
  const presets = [
    {name:"Small",options:[{w:2,h:2},{w:3,h:2},{w:3,h:3}]},
    {name:"Medium",options:[{w:4,h:3},{w:5,h:3},{w:6,h:4}]},
    {name:"Large",options:[{w:6,h:4},{w:7,h:4},{w:8,h:5}]},
  ];
  const [sizes,setSizes]=useState(presets.map(p=>state.sizes.find(s=>s.name===p.name)??{name:p.name,...p.options[1]}));
  const seats=event.items.filter(i=>i.kind==="booth"&&!i.company);
  const [seatId,setSeatId]=useState("__available");
  const [price,setPrice]=useState("");
  return <form aria-label="Reservation setup" onSubmit={e=>{
    e.preventDefault();
    void save({action:"simple-settings",orderMode,sizes,seatId, ...(price===""?{}:{price:Number(price)})});
  }}>
    <p className="rsvp-note">RSVP turns are randomly sequenced and held steady after saving. Size presets are assigned automatically to exhibitors; booth positions come from your floor plan.</p>
    <div className="rsvp-profile-grid">
      <Picker label="Reservation order" value={orderMode} onChange={v=>setOrderMode(v as typeof orderMode)} options={[
        {value:"random",label:"Random draw"},
        {value:"registration",label:"Registration order"},{value:"popularity",label:"Most popular first"},
        {value:"alphabetical",label:"Company name (A–Z)"},{value:"manual",label:"Keep current order"},
      ]}/>
      {presets.map((preset,index)=>{
        const size=sizes[index];
        const options=[size,...preset.options].filter((s,i,all)=>all.findIndex(v=>v.w===s.w&&v.h===s.h)===i);
        return <Picker key={preset.name} label={`${preset.name} booth size`} value={`${size.w}x${size.h}`}
          options={options.map(s=>({value:`${s.w}x${s.h}`,label:`${s.w} × ${s.h} m`}))}
          onChange={v=>{const [w,h]=v.split("x").map(Number);setSizes(sizes.map((s,i)=>i===index?{...s,w,h}:s));}}/>;
      })}
      <Picker label="Booth to price" value={seatId} options={[{value:"__available",label:"All available booths"},...seats.map(s=>({value:s.id,label:s.label}))]}
        onChange={id=>{setSeatId(id);const value=seats.find(s=>s.id===id)?.reservationPolicy?.price;setPrice(value===undefined?"":String(value));}}/>
      <label className="rsvp-field"><span>Booth price (optional)</span><Input type="number" min={0} max={1000000000} step="any" value={price} placeholder="Leave unchanged" onChange={e=>setPrice(e.target.value)}/></label>
    </div>
    <p className="rsvp-note">A price applies to the selected available booth, or all available booths. Leave it blank to keep existing prices.</p>
    <Button type="submit" disabled={disabled}>Save reservation setup</Button>
  </form>;
}

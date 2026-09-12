import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { seedEvent } from "../lib/event.ts";
import { profileFor, DEFAULT_SIZES } from "../lib/rsvp.ts";
test("production RSVP worker returns five real comparisons and reproducible scenario playback", {timeout:30000}, async()=>{
  const directory=new URL("../dist/client/_next/static/",import.meta.url);
  const files=await readdir(directory);
  const name=files.find(n=>/^rsvp-worker-.*\.js$/.test(n));assert.ok(name);
  const source=await readFile(new URL(name,directory),"utf8");
  const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');globalThis.self={postMessage:data=>parentPort.postMessage(data)};require('node:vm').runInThisContext(workerData);parentPort.on('message',data=>self.onmessage({data}));`,{eval:true,workerData:source});
  const messages=[];
  function run(input,field){return new Promise((resolve,reject)=>{
    const handle=data=>{messages.push(data);if(data.error){worker.off('message',handle);reject(new Error(data.error));}else if(data[field]){worker.off('message',handle);resolve(data);}};
    worker.on('message',handle);worker.once('error',reject);worker.postMessage(input);
  });}
  try{
    const company={id:'test',name:'Worker test',category:'Art'};company.profile={...profileFor(company),dwell:10,peakRate:1};
    const original=seedEvent(),event={...original,visitors:40,startTime:'08:00',endTime:'08:20',companies:[company],items:original.items.map(i=>({...i,company:'',processingRate:120}))};
    const compared=await run({event,company,size:DEFAULT_SIZES[1]},'done');
    assert.equal(compared.scenarios.length,5);assert.ok(messages.some(m=>m.progress));
    assert.ok(compared.scenarios.every(s=>s.metrics.visitors>0&&s.metrics.score>=0&&s.metrics.score<=100));
    const seatId=compared.scenarios[0].seatId;
    const {detail}=await run({event,company,size:DEFAULT_SIZES[1],seatId},'detail');
    assert.equal(detail.layout.items.find(i=>i.id===seatId).company,company.name);
    assert.ok(detail.simulation.agents.some(a=>a.queueVisits.some(q=>q.itemId===seatId)));
    const automatic=await run({event,company},'done');
    assert.equal(automatic.scenarios.length,5);
    const automaticDetail=await run({event,company,seatId:automatic.scenarios[0].seatId},'detail');
    assert.ok(automaticDetail.detail.layout.items.find(i=>i.id===automatic.scenarios[0].seatId).w>0);
    const none=await run({event,company,size:DEFAULT_SIZES[2]},'done');assert.equal(none.scenarios.length,0);
    const final=await run({event:detail.layout,final:true},'final');assert.ok(final.final.visits>0);
  }finally{await worker.terminate();}
});

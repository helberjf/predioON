import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createFetchEventSource } from '../src/fetch-event-source.ts';

const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
function fixture(){
  let stream!:ReadableStreamDefaultController<Uint8Array>,cancelled=0,opened=0,errors=0;
  const calls:Array<{url:unknown;init?:RequestInit}>=[],received:Array<{kind:string;data:string}>=[];
  const response=new Response(new ReadableStream<Uint8Array>({start(controller){stream=controller;},cancel(){cancelled++;}}),{headers:{'Content-Type':'text/event-stream; charset=utf-8'}});
  const source=createFetchEventSource('https://api.example.test/events/stream','private-access',async(url,init)=>{calls.push({url,init});return response;});
  source.onopen=()=>{opened++;};source.onerror=()=>{errors++;};
  for(const kind of ['message','alert','telemetry'])source.addEventListener(kind,event=>received.push({kind,data:event.data}));
  return {source,calls,received,get opened(){return opened;},get errors(){return errors;},get cancelled(){return cancelled;},
    push(text:string){stream.enqueue(new TextEncoder().encode(text));},bytes(bytes:Uint8Array){stream.enqueue(bytes);},
    end(){stream.close();},break(){stream.error(new Error('stream failure'));}};
}

it('sends credentials only in the bearer header and never retries by itself',async()=>{
  const f=fixture();await flush();
  assert.equal(f.opened,1);assert.equal(f.calls.length,1);
  assert.equal(f.calls[0]!.url,'https://api.example.test/events/stream');
  const init=f.calls[0]!.init!;
  assert.equal(new Headers(init.headers).get('Authorization'),'Bearer private-access');
  assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
  f.end();await flush();assert.equal(f.errors,1);assert.equal(f.calls.length,1);assert.ok(init.signal?.aborted);
});

it('parses BOM, UTF-8 across bytes, multiline data and all newline conventions',async()=>{
  const f=fixture();await flush();
  const bytes=new TextEncoder().encode('\uFEFF: keepalive\r\nevent: alert\r\ndata: Olá 🏢\r\ndata: segunda linha\r\n\r\nretry: 100\nid: ignored\n\nevent: telemetry\rdata: 73\r\rdata\n\n');
  for(const byte of bytes)f.bytes(Uint8Array.of(byte));
  await flush();
  assert.deepEqual(f.received,[{kind:'alert',data:'Olá 🏢\nsegunda linha'},{kind:'telemetry',data:'73'},{kind:'message',data:''}]);
  f.source.close();await flush();assert.equal(f.errors,0);
});

it('discards incomplete events on EOF and reports transport failure once',async()=>{
  const f=fixture();await flush();f.push('event: alert\ndata: unfinished');f.end();await flush();
  assert.deepEqual(f.received,[]);assert.equal(f.errors,1);f.source.close();assert.equal(f.errors,1);
  const broken=fixture();await flush();broken.break();await flush();assert.equal(broken.errors,1);
});

it('closes the fetch and body reader without delivering events after cancellation',async()=>{
  const f=fixture();await flush();f.push('event: alert\ndata: stale\n\n');f.source.close();await flush();
  assert.deepEqual(f.received,[]);assert.equal(f.errors,0);assert.equal(f.cancelled,1);assert.ok(f.calls[0]!.init!.signal?.aborted);
});

it('cancels a late response when the component closed before headers arrived',async()=>{
  let finish!:(value:Response)=>void,cancelled=0,opened=0,errors=0;
  const source=createFetchEventSource('https://api.example.test/events/stream','token',async()=>new Promise(resolve=>{finish=resolve;}));
  source.onopen=()=>{opened++;};source.onerror=()=>{errors++;};source.close();
  finish(new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'Content-Type':'text/event-stream'}}));
  await flush();assert.equal(cancelled,1);assert.equal(opened,0);assert.equal(errors,0);
});

it('rejects error statuses, non-stream responses and a missing body before opening',async()=>{
  for(const response of [new Response('denied',{status:401}),new Response('html',{headers:{'Content-Type':'text/html'}}),new Response(null,{status:204})]){
    let opened=0,errors=0;
    const source=createFetchEventSource('https://api.example.test/events/stream','token',async()=>response);
    source.onopen=()=>{opened++;};source.onerror=()=>{errors++;};
    await flush();assert.equal(opened,0);assert.equal(errors,1);source.close();
  }
});

it('bounds both single lines and accumulated multiline frames',async()=>{
  for(const payload of ['data: '+'x'.repeat(256*1024+1),('data: '+ 'x'.repeat(1024)+'\n').repeat(257)]){
    const f=fixture();await flush();f.push(payload);await flush();
    assert.equal(f.errors,1);assert.deepEqual(f.received,[]);assert.equal(f.cancelled,1);
  }
});

it('stops dispatching buffered frames when a listener closes the stream',async()=>{
  const f=fixture();f.source.addEventListener('alert',()=>f.source.close());await flush();
  f.push('event: alert\ndata: first\n\nevent: alert\ndata: second\n\n');await flush();
  assert.deepEqual(f.received,[{kind:'alert',data:'first'}]);assert.equal(f.errors,0);assert.equal(f.cancelled,1);
});

import type { RealtimeSource } from './realtime-connection.js';

// Realtime events are small UI invalidations, not a file transport.
const MAX_FRAME_CHARACTERS=256*1024;

/** One authenticated stream. Reconnection and renewal belong to
 * startRealtimeConnection; this adapter never replays a request itself. */
export function createFetchEventSource(url:string,accessToken:string,fetcher:typeof globalThis.fetch=globalThis.fetch):RealtimeSource {
  const controller=new AbortController();
  const listeners=new Map<string,Set<(event:{data:string})=>void>>();
  let closed=false,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  const source:RealtimeSource={
    onopen:null,onerror:null,
    close(){
      closed=true;controller.abort();listeners.clear();
      void reader?.cancel().catch(()=>undefined);
    },
    addEventListener(kind,callback){
      if(closed)return;
      const callbacks=listeners.get(kind)??new Set();callbacks.add(callback);listeners.set(kind,callbacks);
    },
  };
  function fail(){
    if(closed)return;
    const callback=source.onerror;source.close();callback?.();
  }
  let line='',eventType='',data:string[]=[],frameLength=0,skipLf=false;
  function endLine(){
    if(!line){
      if(data.length){
        const event={data:data.join('\n')};
        for(const callback of listeners.get(eventType||'message')??[]){if(closed)break;callback(event);}
      }
      eventType='';data=[];frameLength=0;
    }else if(!line.startsWith(':')){
      const colon=line.indexOf(':'),field=colon<0?line:line.slice(0,colon);
      let value=colon<0?'':line.slice(colon+1);if(value.startsWith(' '))value=value.slice(1);
      if(field==='data'){data.push(value);frameLength+=value.length+1;}
      else if(field==='event')eventType=value;
      // id/retry are intentionally unused: this API publishes ephemeral UI
      // updates and the outer connection controls retries with current identity.
    }
    line='';
  }
  function consume(text:string){
    for(const character of text){
      if(closed)return;
      if(skipLf){skipLf=false;if(character==='\n')continue;}
      if(character==='\r'||character==='\n'){endLine();skipLf=character==='\r';}
      else line+=character;
      if(frameLength+line.length>MAX_FRAME_CHARACTERS)throw new Error('Realtime frame exceeds the size limit');
    }
  }
  void(async()=>{
    try{
      const response=await fetcher(url,{headers:{Authorization:`Bearer ${accessToken}`,Accept:'text/event-stream'},
        credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});
      if(closed){await response.body?.cancel();return;}
      if(response.status!==200||response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='text/event-stream'||!response.body){
        await response.body?.cancel();fail();return;
      }
      reader=response.body.getReader();
      source.onopen?.();
      const decoder=new TextDecoder('utf-8');
      while(!closed){
        const chunk=await reader.read();
        if(closed)return;
        if(chunk.done){
          // As in SSE, an unterminated event at EOF is discarded.
          consume(decoder.decode());fail();return;
        }
        consume(decoder.decode(chunk.value,{stream:true}));
      }
    }catch{fail();}
    finally{
      if(reader){try{await reader.cancel();}catch{/* Transport may already be broken. */}reader.releaseLock();}
    }
  })();
  return source;
}

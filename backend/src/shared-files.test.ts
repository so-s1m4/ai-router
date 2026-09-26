import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';

test('a 48-character secret link downloads the selected file without a session',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'ai-router-shares-'));
 process.env.DATA_DIR=directory;
 const [{setConnected},{createFileShare,downloadSharedFile}]=await Promise.all([import('./runners.js'),import('./shared-files.js')]);
 const runnerId='d08c2190-222f-4bcc-b5a5-29d30154b603';
 const content=Buffer.from('finished artifact');
 const modified=123456;
 const handlers=new Map<string,Function>();
 const socket={connected:true,disconnect(){this.connected=false;},on(event:string,handler:Function){handlers.set(event,handler);},timeout(){return this;},async emitWithAck(event:string,input:any){
  if(event==='file:info')return {ok:true,size:content.length,modified};
  if(event==='file:chunk')return {ok:true,data:content.subarray(input.offset,input.offset+256*1024)};
  throw new Error('Unexpected event');
 }};
 setConnected(runnerId,socket as any);
 const share=await createFileShare('user',runnerId,{sessionId:'6655170d-2987-4c61-97a6-c826030849cb'},'result.txt');
 const token=share.url.split('/').at(-1)!;
 assert.match(token,/^[A-Za-z0-9_-]{48}$/);
 const server=createServer((req,res)=>{void downloadSharedFile(req.url!.slice(1),res);});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const address=server.address();assert.ok(address&&typeof address==='object');
  const response=await fetch(`http://127.0.0.1:${address.port}/${token}`);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('content-type'),'application/octet-stream');
  assert.equal(await response.text(),content.toString());
  assert.equal((await fetch(`http://127.0.0.1:${address.port}/invalid`)).status,404);
 }finally{server.close();socket.disconnect();handlers.get('disconnect')?.();await rm(directory,{recursive:true,force:true});}
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('steering stays in the active turn, rejects stale jobs and never interrupts',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'router-steer-'));
 const fake=path.join(root,'codex');
 await writeFile(fake,`#!/usr/bin/env node
let buffer='';
const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
process.stdin.on('data',chunk=>{buffer+=chunk;let index;while((index=buffer.indexOf('\\n'))>=0){const message=JSON.parse(buffer.slice(0,index));buffer=buffer.slice(index+1);
 if(message.method==='initialize')send({id:message.id,result:{}});
 if(message.method==='thread/start')send({id:message.id,result:{thread:{id:'thread'}}});
 if(message.method==='turn/start')send({id:message.id,result:{turn:{id:'active-turn'}}});
 if(message.method==='turn/interrupt')process.exit(42);
 if(message.method==='turn/steer'){
  if(message.params.threadId!=='thread'||message.params.expectedTurnId!=='active-turn')send({id:message.id,error:{message:'Wrong turn'}});
  else if(message.params.input[0].text==='reject')send({id:message.id,error:{message:'No active turn'}});
  else {send({id:message.id,result:{turnId:'active-turn'}});send({method:'item/agentMessage/delta',params:{threadId:'thread',turnId:'active-turn',delta:message.params.input[0].text}});send({method:'turn/completed',params:{threadId:'thread',turn:{id:'active-turn',status:'completed'}}});}
 }
}});
`);
 await chmod(fake,0o700);process.env.CODEX_BIN=fake;process.env.APP_SERVER_REQUEST_TIMEOUT_SECONDS='3';
 const {runCodexAppServer,steerCodexJob,closeCodexAppServers}=await import('../dist/app-server.js');
 try{
  const home=path.join(root,'home'),cwd=path.join(root,'workspace');await mkdir(home);await mkdir(cwd);
  let ready;const available=new Promise(resolve=>ready=resolve);
  const result=runCodexAppServer({jobId:'job',taskId:'task',sessionId:'session',accountId:'account',provider:'codex',mode:'task',model:'default',prompt:'initial'},home,cwd,new AbortController().signal,e=>{if(e.data?.steeringAvailable)ready();});
  await available;
  await assert.rejects(steerCodexJob('other','refine'),/Steering/);
  await assert.rejects(steerCodexJob('job','reject'),/No active turn/);
  await steerCodexJob('job','Focus on tests');
  assert.equal((await result).text,'Focus on tests');
  await assert.rejects(steerCodexJob('job','too late'),/Steering/);
 }finally{closeCodexAppServers();await rm(root,{recursive:true,force:true});}
});

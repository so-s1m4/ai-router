import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {io}=createRequire(path.join(repo,'runner/package.json'))('socket.io-client');
async function freePort(){
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;
}
async function waitFor(fn){
 const deadline=Date.now()+15000;
 while(Date.now()<deadline){try{if(await fn())return;}catch{}await new Promise(resolve=>setTimeout(resolve,80));}
 throw new Error('Timed out waiting for service');
}
async function connect(url,options){
 const socket=io(url,{transports:['websocket'],forceNew:true,...options});
 await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});return socket;
}

test('Auto selects models, resumes failed work on the same runner and counts each attempt', {timeout:30000}, async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'router-auto-'));
 const port=await freePort(),previewPort=await freePort(),base='http://127.0.0.1:'+port;
 const backend=spawn(process.execPath,[path.join(repo,'backend/dist/server.js')],{
  cwd:repo,env:{...process.env,TELEGRAM_BOT_TOKEN:'',AUTO_CHEAP_MODELS:'economy',AUTO_STRONG_MODELS:'premium',DATA_DIR:root,PORT:String(port),PREVIEW_PORT:String(previewPort),ADMIN_PASSWORD:'auto-test-password',SESSION_SECRET:'auto-test-secret-longer-than-thirty-two-characters',COOKIE_SECURE:'false'},stdio:'ignore'
 });
 let runner,browser;
 try{
  await waitFor(async()=>(await fetch(base+'/api/health')).ok);
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'admin',password:'auto-test-password'})});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const api=async(url,method='GET',body)=>{
   const response=await fetch(base+'/api'+url,{method,headers:{cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
   assert.ok(response.ok,method+' '+url+': '+response.status);return response.json();
  };
  const pairing=await api('/runners/pairing','POST',{name:'Auto runner'});
  const device=await(await fetch(base+'/api/runner/enroll',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:pairing.code})})).json();
  runner=await connect(base+'/runner',{auth:{runnerId:device.id,secret:device.secret}});
  browser=await connect(base,{extraHeaders:{cookie}});
  const account=await api('/accounts','POST',{provider:'codex',name:'Auto account',runnerId:device.id});
  runner.emit('account:status',{accountId:account.id,provider:'codex',models:[{id:'economy',label:'Economy'},{id:'premium',label:'Premium'}]});
  await waitFor(async()=>(await api('/accounts'))[0].models.some(m=>m.id==='premium'));
  const jobs=[];runner.on('job:start',(job,ack)=>{ack({ok:true});jobs.push(job);});
  const submit=async(prompt,sessionId)=>browser.timeout(5000).emitWithAck('run',{sessionId,prompt,service:'auto',model:'auto'});
  const chat=await api('/sessions','POST',{});
  const simple=await submit('Translate hello into Russian',chat.id);
  assert.equal(simple.ok,true);await waitFor(()=>jobs.length===1);assert.equal(jobs[0].model,'economy');
  runner.emit('job:event',{jobId:jobs[0].jobId,type:'checkpoint',data:{status:'running'}});
  runner.emit('job:event',{jobId:jobs[0].jobId,type:'tool',message:'Updated a file'});
  runner.emit('job:event',{jobId:jobs[0].jobId,type:'delta',text:'Completed first step'});
  runner.emit('job:event',{jobId:jobs[0].jobId,type:'usage',data:{totalTokens:10}});
  runner.emit('job:event',{jobId:jobs[0].jobId,type:'usage',data:{totalTokens:15}});
  runner.emit('job:result',{jobId:jobs[0].jobId,ok:false,error:'Provider failed',code:'failed'});
  await waitFor(()=>jobs.length===2);
  assert.equal(jobs[1].model,'premium');assert.equal(jobs[1].accountId,account.id);
  assert.equal(jobs[1].continuationOf,simple.runId);assert.equal(jobs[1].taskId,simple.runId);
  assert.match(jobs[1].prompt,/HANDOFF.md/);
  runner.emit('job:event',{jobId:jobs[1].jobId,type:'usage',data:{totalTokens:20}});
  runner.emit('job:result',{jobId:jobs[1].jobId,ok:true,text:'Final result'});
  await waitFor(async()=>(await api('/tasks')).find(t=>t.id===simple.runId).state==='completed');
  const summary=await api('/usage-summary');assert.equal(summary.totalTokens,35);
  assert.deepEqual(summary.byModel,[{id:'premium',tokens:20},{id:'economy',tokens:15}]);
  assert.equal((await api('/sessions/'+chat.id)).messages.at(-1).tokenUsage.totalTokens,35);
  const complexChat=await api('/sessions','POST',{});
  const complex=await submit('Implement a database migration',complexChat.id);
  assert.equal(complex.ok,true);await waitFor(()=>jobs.length===3);assert.equal(jobs[2].model,'premium');
  runner.emit('job:result',{jobId:jobs[2].jobId,ok:true,text:'Migration finished'});
  await waitFor(async()=>(await api('/tasks')).find(t=>t.id===complex.runId).state==='completed');
  await api('/user/model-blacklist','PUT',{blacklist:['economy']});
  const filteredChat=await api('/sessions','POST',{});
  const filtered=await submit('Translate hello',filteredChat.id);
  assert.equal(filtered.ok,true);await waitFor(()=>jobs.length===4);assert.equal(jobs[3].model,'premium');
  runner.emit('job:result',{jobId:jobs[3].jobId,ok:true,text:'Done'});
  await waitFor(async()=>(await api('/tasks')).find(t=>t.id===filtered.runId).state==='completed');
  await api('/user/model-blacklist','PUT',{blacklist:[]});
  runner.emit('account:status',{accountId:account.id,provider:'codex',models:[{id:'economy',label:'Economy',reasoning:[{id:'high',label:'High'},{id:'low',label:'Low'}]},{id:'premium',label:'Premium'}]});
  await waitFor(async()=>(await api('/accounts'))[0].models.find(m=>m.id==='economy')?.reasoning?.length===2);
  const fastChat=await api('/sessions','POST',{});
  const fast=await browser.timeout(5000).emitWithAck('run',{sessionId:fastChat.id,prompt:'Implement a database migration',service:'codex',model:'auto',fast:true});
  assert.equal(fast.ok,true);await waitFor(()=>jobs.length===5);
  assert.equal(jobs[4].model,'economy');assert.equal(jobs[4].reasoning,'default');assert.equal(jobs[4].fast,true);
  runner.emit('job:result',{jobId:jobs[4].jobId,ok:true,text:'Fast done'});
  await waitFor(async()=>(await api('/tasks')).find(t=>t.id===fast.runId).state==='completed');
  for (const reasoning of ['medium', 'default']) {
    const solChat=await api('/sessions','POST',{});
    const sol=await browser.timeout(5000).emitWithAck('run',{sessionId:solChat.id,prompt:'Implement the change',service:'codex',model:'gpt-6.1-sol',reasoning,fast:true});
    assert.equal(sol.ok,true);
    const expected=reasoning==='medium'?6:7;
    await waitFor(()=>jobs.length===expected);
    const job=jobs.at(-1);
    assert.equal(job.model,'gpt-6.1-sol');assert.equal(job.reasoning,'medium');assert.equal(job.fast,true);
    runner.emit('job:result',{jobId:job.jobId,ok:true,text:'Sol done'});
    await waitFor(async()=>(await api('/tasks')).find(t=>t.id===sol.runId).state==='completed');
  }
 }finally{
  browser?.disconnect();runner?.disconnect();
  const exited=new Promise(resolve=>backend.once('exit',resolve));backend.kill('SIGTERM');await exited;
  await rm(root,{recursive:true,force:true});
 }
});

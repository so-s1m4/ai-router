import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function freePort(){const server=createNetServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function waitFor(fn,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){try{const value=await fn();if(value)return value;}catch{}await new Promise(resolve=>setTimeout(resolve,80));}throw new Error('Timed out waiting for preview service');}
function processAt(file,env){const child=spawn(process.execPath,[file],{cwd:repo,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>output=(output+chunk.toString()).slice(-3000));return {child,output:()=>output};}


test('API key connections enforce ownership and never persist or return credentials', {timeout:30000}, async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'router-api-key-'));
 const apiPort=await freePort(),previewPort=await freePort();
 const backend=processAt(path.join(repo,'backend/dist/server.js'),{DATA_DIR:root,PORT:String(apiPort),PREVIEW_PORT:String(previewPort),ADMIN_PASSWORD:'api-test-password',SESSION_SECRET:'api-test-secret-longer-than-thirty-two-characters',COOKIE_SECURE:'false',ALLOW_SIGNUP:'true'});
 let socket,browser;
 try{
  await waitFor(async()=> (await fetch('http://127.0.0.1:'+apiPort+'/api/health')).ok);
  const base='http://127.0.0.1:'+apiPort;
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'admin',password:'api-test-password'})});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const api=async(url,method='GET',body)=>{const r=await fetch(base+'/api'+url,{method,headers:{cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
  const pairing=await api('/runners/pairing','POST',{name:'API test runner'});
  const enrolled=await fetch(base+'/api/runner/enroll',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:pairing.body.code,name:'API test runner'})});
  const device=await enrolled.json();assert.equal(enrolled.status,201);
  const {io}=createRequire(path.join(repo,'runner/package.json'))('socket.io-client');
  socket=io(base+'/runner',{transports:['websocket'],auth:{runnerId:device.id,secret:device.secret}});
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  let received;
  socket.on('account:openai-key',(payload,ack)=>{received=payload;ack({ok:true});});
  const created=await api('/accounts','POST',{provider:'codex',authType:'api_key',name:'API one',runnerId:device.id});assert.equal(created.status,201);assert.equal(created.body.authType,'api_key');
  const id=created.body.id,key='sk-test-not-real-123456789012345';
  assert.equal((await api('/accounts/'+id+'/api-key','PUT',{apiKey:'bad'})).status,400);
  assert.equal((await api('/accounts/'+randomBytes(16).toString('hex')+'/api-key','PUT',{apiKey:key})).status,404);
  assert.equal((await api('/accounts/'+id+'/api-key','PUT',{apiKey:key})).status,200);
  assert.deepEqual(received,{accountId:id,apiKey:key});
  assert.equal((await api('/accounts/'+id+'/priority','PATCH',{priority:2})).status,200);
  const listed=await api('/accounts');assert.equal(listed.body.find(a=>a.id===id).priority,2);assert.ok(!JSON.stringify(listed.body).includes(key));
  const records=await readFile(path.join(root,'users','owner','accounts.json'),'utf8');assert.ok(!records.includes(key));
  const invalid=await api('/accounts','POST',{provider:'chatgpt',authType:'api_key',name:'Invalid',runnerId:device.id});assert.equal(invalid.status,400);
  let routerReceived;
  socket.on('account:openrouter-key',(payload,ack)=>{routerReceived=payload;ack({ok:true});});
  const routerAccount=await api('/accounts','POST',{provider:'openrouter',authType:'api_key',name:'OpenRouter',runnerId:device.id});assert.equal(routerAccount.status,201);
  const routerKey='sk-or-test-12345678901234567890';
  assert.equal((await api('/accounts/'+routerAccount.body.id+'/api-key','PUT',{apiKey:routerKey})).status,200);
  assert.deepEqual(routerReceived,{accountId:routerAccount.body.id,apiKey:routerKey});
  assert.ok(!(await readFile(path.join(root,'users','owner','accounts.json'),'utf8')).includes(routerKey));
  socket.emit('account:status',{accountId:id,provider:'codex',models:[{id:'gpt-6.1-sol',label:'GPT-6.1 Sol'}]});
  socket.emit('account:status',{accountId:routerAccount.body.id,provider:'openrouter',models:[{id:'test/model',label:'Test model'}]});
  await waitFor(async()=> {
    const accounts=(await api('/accounts')).body;
    return accounts.find(a=>a.id===id)?.models.some(m=>m.id==='gpt-6.1-sol')&&accounts.find(a=>a.id===routerAccount.body.id)?.models.some(m=>m.id==='test/model');
  });
  const initialSettings=await api('/ccc-auto/settings');assert.equal(initialSettings.status,200);assert.equal(initialSettings.body.submissionIntervalSeconds,1);
  const settings=initialSettings.body;settings.submissionIntervalSeconds=2;settings.levels[0].candidates[0].provider='openrouter';settings.levels[0].candidates[0].accountId=routerAccount.body.id;settings.levels[0].candidates[0].model='test/model';
  assert.equal((await api('/ccc-auto/settings','PUT',settings)).status,200);
  assert.deepEqual((await api('/ccc-auto/settings')).body,settings);
  const raceSettings=structuredClone(settings);for(const rule of raceSettings.levels)rule.candidates=[{...rule.candidates[0],provider:'openrouter',accountId:routerAccount.body.id,model:'test/model',fast:false}];
  assert.equal((await api('/ccc-auto/settings','PUT',raceSettings)).status,200);
  const session=await api('/sessions','POST',{});
  browser=io(base,{transports:['websocket'],forceNew:true,extraHeaders:{cookie}});
  await new Promise((resolve,reject)=>{browser.once('connect',resolve);browser.once('connect_error',reject);});
  let dispatched;
  socket.on('job:start',(job,ack)=>{dispatched=job;ack({ok:true});socket.emit('job:event',{jobId:job.jobId,type:'usage',data:{totalTokens:15,cccUsage:[{accountId:routerAccount.body.id,provider:'openrouter',model:'test/model',usage:{totalTokens:15}}]}});socket.emit('job:result',{jobId:job.jobId,ok:true,text:'CCC completed'});});
  const finished=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('CCC did not finish')),5000);browser.on('ai:event',event=>{if(event.sessionId===session.body.id&&['completed','error'].includes(event.type)){clearTimeout(timer);event.type==='error'?reject(new Error(event.message)):resolve();}});});
  const queued=await browser.timeout(5000).emitWithAck('run',{sessionId:session.body.id,prompt:'https://codingcontest.org/contests/example/game',workflow:'ccc-auto',model:'default'});assert.equal(queued.ok,true);await finished;
  assert.deepEqual(dispatched.cccAuto,raceSettings);
  await waitFor(async()=> (await api('/usage-summary')).body.byModel?.some(m=>m.id==='test/model'&&m.tokens===15));
  assert.equal((await api('/ccc-auto/settings','PUT',settings)).status,200);
  const invalidSettings=structuredClone(settings);invalidSettings.levels[0].candidates[0].accountId=randomBytes(16).toString('hex');
  assert.equal((await api('/ccc-auto/settings','PUT',invalidSettings)).status,400);
  const validation=structuredClone(settings);validation.submissionIntervalSeconds=3;
  assert.equal((await api('/ccc-auto/settings/validate','POST',validation)).status,200);assert.equal((await api('/ccc-auto/settings')).body.submissionIntervalSeconds,2);
  const registered=await fetch(base+'/api/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'other-user',password:'other-test-password'})});
  assert.equal(registered.status,201);
  const otherCookie=registered.headers.get('set-cookie').split(';')[0];
  const isolated=await fetch(base+'/api/ccc-auto/settings',{headers:{cookie:otherCookie}});assert.equal((await isolated.json()).submissionIntervalSeconds,1);
  const foreignSettings=await fetch(base+'/api/ccc-auto/settings',{method:'PUT',headers:{cookie:otherCookie,'content-type':'application/json'},body:JSON.stringify(settings)});assert.equal(foreignSettings.status,400);
  const forbidden=await fetch(base+'/api/accounts/'+id+'/api-key',{method:'PUT',headers:{cookie:otherCookie,'content-type':'application/json'},body:JSON.stringify({apiKey:key})});assert.equal(forbidden.status,404);
  const unauth=await fetch(base+'/api/accounts/'+id+'/api-key',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({apiKey:key})});assert.equal(unauth.status,401);
 } finally{browser?.disconnect();socket?.disconnect();backend.child.kill('SIGTERM');await new Promise(resolve=>backend.child.once('exit',resolve));await rm(root,{recursive:true,force:true});}
});

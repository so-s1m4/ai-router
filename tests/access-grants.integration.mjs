import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { io } = createRequire(path.join(repo, 'runner/package.json'))('socket.io-client');

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitFor(fn) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if (await fn()) return; } catch { /* service is starting */ }
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error('Timed out waiting for service');
}

async function connect(url, options) {
  const socket = io(url, { transports: ['websocket'], forceNew: true, ...options });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

test('shared access enforces recipient, models, usage, Auto, account privacy and revocation', {timeout:45000}, async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'router-sharing-'));
 const port=await freePort(),previewPort=await freePort(),base=`http://127.0.0.1:${port}`;
 const backend=spawn(process.execPath,[path.join(repo,'backend/dist/server.js')],{cwd:repo,env:{...process.env,DATA_DIR:root,PORT:String(port),PREVIEW_PORT:String(previewPort),ADMIN_PASSWORD:'sharing-test-password',SESSION_SECRET:'sharing-test-secret-longer-than-thirty-two-characters',COOKIE_SECURE:'false'},stdio:['ignore','ignore','pipe']});
 let runner,friend;let log='';backend.stderr.on('data',chunk=>log+=chunk);
 try {
  await waitFor(async()=> (await fetch(base+'/api/health')).ok);
  async function authenticate(username,register=false){const response=await fetch(base+'/api/'+(register?'register':'login'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password:'sharing-test-password'})});assert.ok(response.ok);return response.headers.get('set-cookie').split(';')[0];}
  const ownerCookie=await authenticate('admin'),friendCookie=await authenticate('friend',true),strangerCookie=await authenticate('stranger',true);
  async function request(cookie,url,method='GET',body){const response=await fetch(base+'/api'+url,{method,headers:{cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};}
  const api=async(url,method='GET',body)=>{const r=await request(ownerCookie,url,method,body);assert.ok(r.status<300,JSON.stringify(r));return r.body;};
  const pairing=await api('/runners/pairing','POST',{name:'Owner runner'});
  const device=await (await fetch(base+'/api/runner/enroll',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:pairing.code})})).json();
  runner=await connect(base+'/runner',{auth:{runnerId:device.id,secret:device.secret}});
  const account=await api('/accounts','POST',{provider:'codex',name:'Private account',runnerId:device.id});
  runner.emit('account:status',{accountId:account.id,provider:'codex',models:[{id:'allowed',label:'Allowed'},{id:'forbidden',label:'Forbidden'}]});
  await waitFor(async()=> (await api('/accounts')).some(a=>a.models.some(m=>m.id==='allowed')));
  const backup=await api('/accounts','POST',{provider:'codex',name:'Private backup',runnerId:device.id});
  runner.emit('account:status',{accountId:backup.id,provider:'codex',models:[{id:'other',label:'Other'}]});
  await waitFor(async()=> (await api('/accounts')).some(a=>a.models.some(m=>m.id==='other')));
  const created=await api('/access-grants','POST',{username:'friend',budget:100,period:'once',models:['allowed','other']});
  const grantId=created.id;
  assert.equal((await request(strangerCookie,'/access-grants')).body.length,0);
  assert.equal((await request(friendCookie,'/accounts')).body.length,0);
  assert.equal((await request(strangerCookie,'/access-grants/'+grantId,'PATCH',{state:'active'})).status,404);
  assert.equal((await request(friendCookie,'/access-grants/'+grantId,'PATCH',{budget:99999})).status,403);
  assert.equal((await request(friendCookie,'/access-grants/'+grantId,'PATCH',{state:'active'})).status,200);
  const sharedAccounts=(await request(friendCookie,'/accounts')).body;assert.equal(sharedAccounts.length,1);
  const shared=sharedAccounts[0];
  assert.equal(shared.id,grantId+':codex');assert.deepEqual(shared.models.map(m=>m.id).sort(),['allowed','other']);assert.equal(shared.runnerId,undefined);assert.equal(shared.importKey,undefined);
  assert.equal((await request(friendCookie,'/accounts/'+account.id+'/priority','PATCH',{priority:2})).status,404);
  const ownSession=await api('/sessions','POST',{});
  assert.equal((await request(friendCookie,'/sessions/'+ownSession.id)).status,404);
  const session=(await request(friendCookie,'/sessions','POST',{})).body;
  friend=await connect(base,{extraHeaders:{cookie:friendCookie}});
  let hold=false,lastJob,jobCount=0,gemini;
  runner.on('job:start',(job,ack)=>{ack({ok:true});jobCount++;lastJob=job;if(hold)return;assert.equal(job.accountId,job.provider==='antigravity'?gemini.id:job.model==='other'?backup.id:account.id);assert.ok(['allowed','other'].includes(job.model));runner.emit('job:event',{jobId:job.jobId,type:'usage',data:{totalTokens:70}});runner.emit('job:event',{jobId:job.jobId,type:'usage',data:{totalTokens:120}});runner.emit('job:event',{jobId:job.jobId,type:'usage',data:{totalTokens:120}});runner.emit('job:result',{jobId:job.jobId,ok:true,text:'Shared answer'});});
  function finished(sessionId){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('No terminal event: '+log)),7000);const handler=e=>{if(e.sessionId===sessionId&&['completed','error'].includes(e.type)){clearTimeout(timer);friend.off('ai:event',handler);resolve(e);}};friend.on('ai:event',handler);});}
  const send=(model='default',accountId='auto',sessionId=session.id)=>friend.timeout(5000).emitWithAck('run',{sessionId,prompt:'Hello',accountId,model,mode:'task'});
  assert.equal((await send('forbidden')).ok,false);assert.equal((await send('allowed',account.id)).ok,false);assert.equal(jobCount,0);
  let terminal=finished(session.id);assert.equal((await send()).ok,true);assert.equal((await terminal).type,'completed');
  const spent=(await request(friendCookie,'/access-grants')).body[0];assert.equal(spent.usedTokens,120);assert.equal(Object.values(spent.usageByModel).reduce((sum,n)=>sum+n,0),120);
  assert.equal((await send()).ok,false);assert.equal(jobCount,1);
  await api('/access-grants/'+grantId,'PATCH',{budget:500});
  // The same grant spans accounts and providers, including connections added later.
  terminal=finished(session.id);assert.equal((await send('other',shared.id)).ok,true);assert.equal((await terminal).type,'completed');
  gemini=await api('/accounts','POST',{provider:'antigravity',name:'Private Gemini',runnerId:device.id});
  runner.emit('account:status',{accountId:gemini.id,provider:'antigravity',models:[{id:'allowed',label:'Allowed'}]});
  await waitFor(async()=> (await request(friendCookie,'/accounts')).body.some(a=>a.provider==='antigravity'&&a.models.some(m=>m.id==='allowed')));
  terminal=finished(session.id);assert.equal((await send('allowed','gemini')).ok,true);assert.equal((await terminal).type,'completed');
  assert.equal((await request(friendCookie,'/access-grants')).body[0].usedTokens,360);
  await api('/access-grants/'+grantId,'PATCH',{budget:360});assert.equal((await send('other')).ok,false);assert.equal((await send('allowed','gemini')).ok,false);
  await api('/access-grants/'+grantId,'PATCH',{budget:500});hold=true;
  terminal=finished(session.id);assert.equal((await send('allowed',grantId)).ok,true);await waitFor(()=>jobCount===4);
  const second=(await request(friendCookie,'/sessions','POST',{})).body;
  const concurrent=await send('allowed',grantId,second.id);assert.equal(concurrent.ok,true);assert.equal(concurrent.queued,true);assert.equal((await request(friendCookie,'/tasks/'+concurrent.runId,'DELETE')).status,200);assert.equal(jobCount,4);
  // File access is restricted to recipient-owned sessions, not owner runner workspaces.
  runner.on('file:list',(payload,ack)=>{assert.equal(payload.sessionId,session.id);assert.equal(payload.projectId,undefined);ack({ok:true,files:[{name:'outputs/result.txt',size:5,modified:new Date().toISOString()}]});});
  assert.equal((await request(friendCookie,'/sessions/'+session.id+'/files')).body.files[0].name,'outputs/result.txt');
  assert.equal((await request(friendCookie,'/sessions/'+ownSession.id+'/files')).status,404);
  assert.equal((await request(friendCookie,'/runners/'+device.id+'/management/challenge','POST',{})).status,404);
  await api('/access-grants/'+grantId,'PATCH',{state:'revoked'});assert.equal((await terminal).type,'error');
  assert.equal((await request(friendCookie,'/accounts')).body.length,0);assert.equal((await send('allowed',grantId)).ok,false);
  assert.equal((await api('/access-grants'))[0].usedTokens,360);
  // A full provider catalogue can contain more than 200 models.
  const catalogue=Array.from({length:250},(_,i)=>({id:'catalogue-'+i,label:'Catalogue '+i}));
  runner.emit('account:status',{accountId:backup.id,provider:'codex',models:catalogue});
  await waitFor(async()=> (await api('/accounts')).some(a=>a.models.some(m=>m.id==='catalogue-249')));
  const largeGrant=await api('/access-grants','POST',{username:'friend',budget:1000000,period:'monthly',models:catalogue.map(m=>m.id)});
  assert.equal((await api('/access-grants')).find(g=>g.id===largeGrant.id).models.length,250);
  await api('/access-grants/'+largeGrant.id,'PATCH',{models:catalogue.map(m=>m.id)});
  // CCC Auto resolves shared pool IDs to private accounts and charges every candidate.
  await request(friendCookie,'/access-grants/'+largeGrant.id,'PATCH',{state:'active'});
  const openrouter=await api('/accounts','POST',{provider:'openrouter',name:'Private OpenRouter',runnerId:device.id,authType:'api_key'});
  runner.emit('account:status',{accountId:openrouter.id,provider:'openrouter',models:[{id:'catalogue-1',label:'Catalogue 1'}]});
  await waitFor(async()=> (await request(friendCookie,'/accounts')).body.some(a=>a.provider==='openrouter'));
  const ccc=(await request(friendCookie,'/ccc-auto/settings')).body;
  ccc.levels=[{from:1,to:null,candidates:[
    {...ccc.levels[0].candidates[0],id:'codex',accountId:largeGrant.id+':codex',model:'catalogue-0'},
    {...ccc.levels[0].candidates[0],id:'openrouter',provider:'openrouter',accountId:largeGrant.id+':openrouter',model:'catalogue-1',fast:false},
  ]}];
  assert.equal((await request(friendCookie,'/ccc-auto/settings','PUT',ccc)).status,200);
  const denied=structuredClone(ccc);denied.levels[0].candidates[0].model='forbidden';
  assert.equal((await request(friendCookie,'/ccc-auto/settings','PUT',denied)).status,400);
  const privateId=structuredClone(ccc);privateId.levels[0].candidates[0].accountId=backup.id;
  assert.equal((await request(friendCookie,'/ccc-auto/settings','PUT',privateId)).status,400);
  let cccJob;
  runner.removeAllListeners('job:start');
  runner.on('job:start',(job,ack)=>{ack({ok:true});cccJob=job;});
  const sendCcc=()=>friend.timeout(5000).emitWithAck('run',{sessionId:session.id,prompt:'Solve CCC',workflow:'ccc-auto',model:'default',mode:'task'});
  const report=(codex,router)=>runner.emit('job:event',{jobId:cccJob.jobId,type:'usage',data:{totalTokens:codex+router,cccUsage:[
    {accountId:backup.id,provider:'codex',model:'catalogue-0',usage:{totalTokens:codex}},
    {accountId:openrouter.id,provider:'openrouter',model:'catalogue-1',usage:{totalTokens:router}},
    {accountId:account.id,provider:'codex',model:'forbidden',usage:{totalTokens:999}},
  ]}});
  terminal=finished(session.id);assert.equal((await sendCcc()).ok,true);await waitFor(()=>cccJob);
  assert.equal(cccJob.sharedExecution,true);
  assert.deepEqual(cccJob.cccAuto.levels[0].candidates.map(c=>c.accountId),[backup.id,openrouter.id]);
  const sharedUsage=[];const onUsage=e=>{if(e.type==='usage'&&e.data?.cccUsage)sharedUsage.push(e.data.cccUsage);};friend.on('ai:event',onUsage);
  report(20,30);report(20,30);report(40,30);
  runner.emit('job:result',{jobId:cccJob.jobId,ok:true,text:'CCC solved'});
  assert.equal((await terminal).type,'completed');friend.off('ai:event',onUsage);
  assert.deepEqual(sharedUsage.at(-1).map(row=>row.accountId),[largeGrant.id+':codex',largeGrant.id+':openrouter']);
  let cccSpent=(await request(friendCookie,'/access-grants')).body.find(g=>g.id===largeGrant.id);
  assert.equal(cccSpent.usedTokens,70);assert.equal(cccSpent.usageByModel['catalogue-0'],40);assert.equal(cccSpent.usageByModel['catalogue-1'],30);
  await api('/access-grants/'+largeGrant.id,'PATCH',{budget:90});cccJob=undefined;
  terminal=finished(session.id);assert.equal((await sendCcc()).ok,true);await waitFor(()=>cccJob);
  report(10,20);assert.equal((await terminal).type,'error');
  cccSpent=(await request(friendCookie,'/access-grants')).body.find(g=>g.id===largeGrant.id);
  assert.equal(cccSpent.usedTokens,100);
  // Exhaustion rejects dispatch; increasing the budget releases the previous lease.
  assert.equal((await sendCcc()).ok,false);
  await api('/access-grants/'+largeGrant.id,'PATCH',{budget:1000});cccJob=undefined;
  terminal=finished(session.id);assert.equal((await sendCcc()).ok,true);await waitFor(()=>cccJob);
  await api('/access-grants/'+largeGrant.id,'PATCH',{state:'revoked'});assert.equal((await terminal).type,'error');
  for(const [change,message] of [[{username:'x'},/username/],[{budget:1.5},/whole number/],[{models:[]},/at least one model/]]){
    const invalid=await request(ownerCookie,'/access-grants','POST',{username:'friend',budget:100,period:'once',models:['allowed'],...change});
    assert.equal(invalid.status,400);assert.match(invalid.body.error,message);
  }
 } finally {friend?.disconnect();runner?.disconnect();backend.kill('SIGTERM');await new Promise(resolve=>backend.once('exit',resolve));await rm(root,{recursive:true,force:true});}
});

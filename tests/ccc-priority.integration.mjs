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

test('CCC dispatch respects account priorities and skips missing login and exhausted quota', {timeout:15000}, async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'router-ccc-priority-'));
 const port=await freePort(),previewPort=await freePort(),base=`http://127.0.0.1:${port}`;
 const backend=spawn(process.execPath,[path.join(repo,'backend/dist/server.js')],{cwd:repo,env:{...process.env,DATA_DIR:root,PORT:String(port),PREVIEW_PORT:String(previewPort),ADMIN_PASSWORD:'priority-test-password',SESSION_SECRET:'priority-test-secret-longer-than-thirty-two-characters',COOKIE_SECURE:'false'},stdio:'ignore'});
 let runner,client;
 try {
  await waitFor(async()=> (await fetch(base+'/api/health')).ok);
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'admin',password:'priority-test-password'})});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const api=async(url,method='GET',body)=>{const response=await fetch(base+'/api'+url,{method,headers:{cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;};
  const pairing=await api('/runners/pairing','POST',{name:'Priority runner'});
  const device=await(await fetch(base+'/api/runner/enroll',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:pairing.code})})).json();
  runner=await connect(base+'/runner',{auth:{runnerId:device.id,secret:device.secret}});
  const models=[{id:'gpt-6.1-sol',label:'Sol'}];
  const accounts=[];
  for(const [name,priority] of [['signed-out',2],['limited',2],['low',0],['normal',1],['high',2]]){
   const account=await api('/accounts','POST',{provider:'codex',name,runnerId:device.id});
   await api('/accounts/'+account.id+'/priority','PATCH',{priority});
   accounts.push(account);
   runner.emit('account:status',{accountId:account.id,provider:'codex',models,...(name==='signed-out'?{error:'Codex login required'}:{}),...(name==='limited'?{limits:{primary:{usedPercent:100,resetAt:new Date(Date.now()+600000).toISOString()}}}:{})});
  }
  await waitFor(async()=>{const list=await api('/accounts');return list.find(a=>a.id===accounts[0].id)?.detail.includes('login required')&&list.find(a=>a.id===accounts[4].id)?.models.some(m=>m.id==='gpt-6.1-sol');});
  client=await connect(base,{extraHeaders:{cookie}});
  const jobs=[];
  runner.on('job:start',(job,ack)=>{ack({ok:true});jobs.push(job);runner.emit('job:result',{jobId:job.jobId,ok:true,text:'Done'});});
  const run=async(expected)=>{
   const session=await api('/sessions','POST',{});
   const done=new Promise(resolve=>{const listener=e=>{if(e.sessionId===session.id&&['completed','error'].includes(e.type)){client.off('ai:event',listener);resolve(e);}};client.on('ai:event',listener);});
   const count=jobs.length;
   const ack=await client.timeout(5000).emitWithAck('run',{sessionId:session.id,prompt:'Solve CCC',workflow:'ccc-auto',model:'default',mode:'task'});
   assert.equal(ack.ok,true);assert.equal((await done).type,'completed');
   assert.equal(jobs.length,count+1);
   assert.ok(jobs.at(-1).cccAuto.levels.every(rule=>rule.candidates.every(candidate=>!candidate.enabled||candidate.accountId===expected)));
  };
  await run(accounts[4].id);
  runner.emit('account:status',{accountId:accounts[4].id,provider:'codex',error:'Codex login required'});
  await waitFor(async()=> (await api('/accounts')).find(a=>a.id===accounts[4].id)?.detail.includes('login required'));
  await run(accounts[3].id);
  runner.emit('account:status',{accountId:accounts[1].id,provider:'codex',models,limits:{primary:{usedPercent:0}}});
  await waitFor(async()=> (await api('/accounts')).find(a=>a.id===accounts[1].id)?.mode==='runner');
  await run(accounts[1].id);
 } finally {
  client?.disconnect();runner?.disconnect();
  const exited=new Promise(resolve=>backend.once('exit',resolve));backend.kill();await exited;
  await rm(root,{recursive:true,force:true});
 }
});

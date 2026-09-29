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


test('steering checks ownership, preserves accepted refinements and completion history', {timeout:30000},async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'router-steering-'));
 const port=await freePort(),previewPort=await freePort(),base='http://127.0.0.1:'+port;
 const backend=spawn(process.execPath,[path.join(repo,'backend/dist/server.js')],{cwd:repo,env:{...process.env,DATA_DIR:root,PORT:String(port),PREVIEW_PORT:String(previewPort),ADMIN_PASSWORD:'steering-test-password',SESSION_SECRET:'steering-secret-longer-than-thirty-two-characters',COOKIE_SECURE:'false'},stdio:'ignore'});
 let runner,browser,other;
 try{
  await waitFor(async()=> (await fetch(base+'/api/health')).ok);
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'admin',password:'steering-test-password'})});const cookie=login.headers.get('set-cookie').split(';')[0];
  const api=async(url,method='GET',body)=>{const r=await fetch(base+'/api'+url,{method,headers:{cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});assert.ok(r.ok,url+':'+r.status);return r.json();};
  const pairing=await api('/runners/pairing','POST',{name:'Steering runner'}),device=await (await fetch(base+'/api/runner/enroll',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:pairing.code})})).json();
  runner=await connect(base+'/runner',{auth:{runnerId:device.id,secret:device.secret}});browser=await connect(base,{extraHeaders:{cookie}});
  const registered=await fetch(base+'/api/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'other-steerer',password:'steering-test-password'})});other=await connect(base,{extraHeaders:{cookie:registered.headers.get('set-cookie').split(';')[0]}});
  const account=await api('/accounts','POST',{provider:'codex',name:'Codex',runnerId:device.id}),chat=await api('/sessions','POST',{});
  let job;
  runner.on('job:start',(value,ack)=>{job=value;ack({ok:true});runner.emit('job:event',{jobId:job.jobId,type:'status',data:{steeringAvailable:true}});});
  runner.on('job:steer',(value,ack)=>{assert.equal(value.jobId,job.jobId);if(value.text==='reject')return ack({ok:false,error:'Turn completed'});ack({ok:true});runner.emit('job:result',{jobId:job.jobId,ok:true,text:'Refined answer'});});
  const available=new Promise(resolve=>browser.on('ai:event',e=>{if(e.data?.steeringAvailable)resolve();}));
  const run=await browser.timeout(3000).emitWithAck('run',{sessionId:chat.id,prompt:'Original task',accountId:account.id,model:'default'});assert.equal(run.ok,true);await available;
  const foreign=await other.timeout(3000).emitWithAck('steer',{runId:run.runId,prompt:'foreign'});assert.equal(foreign.ok,false);
  const rejected=await browser.timeout(3000).emitWithAck('steer',{runId:run.runId,prompt:'reject'});assert.equal(rejected.ok,false);assert.deepEqual((await api('/sessions/'+chat.id)).messages.map(m=>m.text),['Original task']);
  const completed=new Promise(resolve=>browser.on('ai:event',e=>{if(e.type==='completed')resolve();}));
  assert.equal((await browser.timeout(3000).emitWithAck('steer',{runId:run.runId,prompt:'Focus on tests'})).ok,true);await completed;
  assert.deepEqual((await api('/sessions/'+chat.id)).messages.map(m=>m.text),['Original task','Focus on tests','Refined answer']);
  assert.equal((await browser.timeout(3000).emitWithAck('steer',{runId:run.runId,prompt:'late'})).ok,false);
 }finally{runner?.disconnect();browser?.disconnect();other?.disconnect();backend.kill('SIGTERM');await new Promise(resolve=>backend.once('exit',resolve));await rm(root,{recursive:true,force:true});}
});

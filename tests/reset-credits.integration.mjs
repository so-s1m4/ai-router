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


test('reset credits reach accounts and summary; redemption is owner scoped and duplicate clicks are blocked',{timeout:30000},async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'router-resets-'));
 const port=await freePort(),previewPort=await freePort(),base='http://127.0.0.1:'+port;
 const backend=spawn(process.execPath,[path.join(repo,'backend/dist/server.js')],{
  cwd:repo,env:{...process.env,TELEGRAM_BOT_TOKEN:'',DATA_DIR:root,PORT:String(port),PREVIEW_PORT:String(previewPort),ADMIN_PASSWORD:'reset-test-password',SESSION_SECRET:'reset-test-secret-longer-than-thirty-two-characters',COOKIE_SECURE:'false'},stdio:'ignore'
 });
 let runner;
 try{
  await waitFor(async()=>(await fetch(base+'/api/health')).ok);
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'admin',password:'reset-test-password'})});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const request=(url,method='GET',body,auth=cookie)=>fetch(base+'/api'+url,{method,headers:{cookie:auth,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  const api=async(url,method='GET',body)=>{const response=await request(url,method,body);assert.ok(response.ok,await response.clone().text());return response.json();};
  const pairing=await api('/runners/pairing','POST',{name:'Reset runner'});
  const device=await(await fetch(base+'/api/runner/enroll',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:pairing.code})})).json();
  runner=await connect(base+'/runner',{auth:{runnerId:device.id,secret:device.secret}});
  const account=await api('/accounts','POST',{provider:'codex',name:'Reset account',runnerId:device.id});
  const credits={availableCount:3,credits:[{id:'referral',expiresAt:'2026-12-01T00:00:00.000Z',title:'Referral reset'}]};
  const status=limits=>runner.emit('account:status',{accountId:account.id,provider:'codex',models:[{id:'default',label:'Default'}],limits});
  status({primary:{usedPercent:100},resetCredits:credits});
  await waitFor(async()=>(await api('/accounts'))[0].limit.resetCredits?.availableCount===3);
  assert.deepEqual((await api('/usage-summary')).accounts[0].limit.resetCredits,credits);
  const attempts=[];let release;
  runner.on('account:reset',(data,ack)=>{attempts.push(data);release=()=>{status({primary:{usedPercent:0},resetCredits:{availableCount:2,credits:null}});ack({ok:true,outcome:'reset'});};});
  const key='11111111-1111-4111-8111-111111111111';
  const first=request('/accounts/'+account.id+'/reset','POST',{idempotencyKey:key});
  await waitFor(()=>attempts.length===1);
  assert.equal((await request('/accounts/'+account.id+'/reset','POST',{idempotencyKey:key})).status,409);
  release();assert.equal((await(await first).json()).outcome,'reset');
  assert.deepEqual(attempts[0],{accountId:account.id,idempotencyKey:key});
  await waitFor(async()=>(await api('/accounts'))[0].limit.resetCredits?.availableCount===2);
  const register=await request('/register','POST',{username:'reset-user',password:'another-test-password'},'');
  assert.ok(register.ok,await register.clone().text());
  const otherCookie=register.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/accounts/'+account.id+'/reset','POST',{idempotencyKey:key},otherCookie)).status,404);
  assert.equal(attempts.length,1);
  assert.equal((await request('/accounts/'+account.id+'/reset','POST',{idempotencyKey:'bad'})).status,400);
  const apiAccount=await api('/accounts','POST',{provider:'codex',name:'API',runnerId:device.id,authType:'api_key'});
  assert.equal((await request('/accounts/'+apiAccount.id+'/reset','POST',{idempotencyKey:key})).status,400);
  status({resetCredits:null});await waitFor(async()=>(await api('/accounts')).find(a=>a.id===account.id).limit.resetCredits===null);
 }finally{runner?.disconnect();backend.kill('SIGTERM');await new Promise(resolve=>backend.once('exit',resolve));await rm(root,{recursive:true,force:true});}
});

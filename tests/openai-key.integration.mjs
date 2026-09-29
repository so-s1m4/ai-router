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
 let socket;
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
  const registered=await fetch(base+'/api/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'other-user',password:'other-test-password'})});
  assert.equal(registered.status,201);
  const otherCookie=registered.headers.get('set-cookie').split(';')[0];
  const forbidden=await fetch(base+'/api/accounts/'+id+'/api-key',{method:'PUT',headers:{cookie:otherCookie,'content-type':'application/json'},body:JSON.stringify({apiKey:key})});assert.equal(forbidden.status,404);
  const unauth=await fetch(base+'/api/accounts/'+id+'/api-key',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({apiKey:key})});assert.equal(unauth.status,401);
 } finally{socket?.disconnect();backend.child.kill('SIGTERM');await new Promise(resolve=>backend.child.once('exit',resolve));await rm(root,{recursive:true,force:true});}
});

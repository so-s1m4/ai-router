import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { attachProjectSync } from '../runner/dist/project-sync.js';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {io}=createRequire(path.join(repo,'runner/package.json'))('socket.io-client');
async function freePort(){const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
async function waitFor(fn){const end=Date.now()+15000;while(Date.now()<end){try{if(await fn())return;}catch{}await new Promise(r=>setTimeout(r,50));}throw new Error('Timed out');}
async function connect(url,options){const socket=io(url,{transports:['websocket'],forceNew:true,...options});await new Promise((r,j)=>{socket.once('connect',r);socket.once('connect_error',j);});return socket;}

test('shared project works across users and runners with file sync, concurrent tasks, offline recovery and revocation',{timeout:45000},async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'router-shared-projects-'));const port=await freePort(),previewPort=await freePort(),base=`http://127.0.0.1:${port}`;
 const backend=spawn(process.execPath,[path.join(repo,'backend/dist/server.js')],{cwd:repo,env:{...process.env,DATA_DIR:path.join(root,'backend'),PORT:String(port),PREVIEW_PORT:String(previewPort),ADMIN_PASSWORD:'projects-test-password',SESSION_SECRET:'projects-test-secret-longer-than-thirty-two-characters',COOKIE_SECURE:'false'},stdio:['ignore','ignore','pipe']});
 let log='';backend.stderr.on('data',data=>log+=data);const sockets=[];
 try{
  await waitFor(async()=> (await fetch(base+'/api/health')).ok);
  async function auth(username,register=false){const response=await fetch(base+'/api/'+(register?'register':'login'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password:'projects-test-password'})});assert.ok(response.ok);return response.headers.get('set-cookie').split(';')[0];}
  const owner=await auth('admin'),friend=await auth('friend',true),stranger=await auth('stranger',true);
  async function api(cookie,url,method='GET',body){const response=await fetch(base+'/api'+url,{method,headers:{cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};}
  async function runner(cookie,label){const pairing=await api(cookie,'/runners/pairing','POST',{name:label});const device=await (await fetch(base+'/api/runner/enroll',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:pairing.body.code})})).json();const socket=await connect(base+'/runner',{auth:{runnerId:device.id,secret:device.secret}});sockets.push(socket);const dir=path.join(root,label);await mkdir(dir,{recursive:true});attachProjectSync(socket,dir,()=>false);const account=await api(cookie,'/accounts','POST',{provider:'codex',name:label,runnerId:device.id});socket.emit('account:status',{accountId:account.body.id,provider:'codex',models:[{id:'shared-model',label:'Shared model'}]});await waitFor(async()=> (await api(cookie,'/accounts')).body.some(a=>a.models.some(m=>m.id==='shared-model')));return {socket,dir,device,account:account.body};}
  const first=await runner(owner,'first'),second=await runner(friend,'second');
  const created=await api(owner,'/projects','POST',{name:'Shared app',runnerId:first.device.id,shared:true,members:['friend']});assert.equal(created.status,201);const project=created.body;
  const privateProject=await api(owner,'/projects','POST',{name:'Private',runnerId:first.device.id});assert.equal(privateProject.status,201);
  assert.deepEqual((await api(friend,'/projects')).body.map(p=>p.id),[project.id]);assert.deepEqual((await api(stranger,'/projects')).body,[]);
  assert.equal((await api(stranger,'/projects/'+project.id+'/members')).status,404);
  assert.equal((await api(friend,'/projects/'+project.id+'/members','PUT',{members:['stranger']})).status,403);
  assert.equal((await api(friend,'/sessions','POST',{projectId:privateProject.body.id})).status,404);
  assert.equal((await api(stranger,'/sessions','POST',{projectId:project.id})).status,404);
  const concurrent=(await api(owner,'/sessions','POST',{projectId:project.id})).body;
  const a=(await api(owner,'/sessions','POST',{projectId:project.id})).body,b=(await api(friend,'/sessions','POST',{projectId:project.id})).body;
  const ownerClient=await connect(base,{extraHeaders:{cookie:owner}}),friendClient=await connect(base,{extraHeaders:{cookie:friend}});sockets.push(ownerClient,friendClient);
  const source=path.join(first.dir,'projects',project.id),destination=path.join(second.dir,'projects',project.id);
  await mkdir(path.join(source,'src'),{recursive:true});await mkdir(path.join(source,'outputs'));await writeFile(path.join(source,'src/app.ts'),'source v1');await writeFile(path.join(source,'.env'),'SECRET');
  let held,hold=true,secondRuns=0;
  first.socket.on('file:write',async(file,ack)=>{await writeFile(path.join(source,file.name),file.data);ack({ok:true,name:file.name,size:file.data.length});});
  first.socket.on('file:delete',async(file,ack)=>{await rm(path.join(source,file.name));ack({ok:true});});
  first.socket.on('job:start',async(job,ack)=>{ack({ok:true});if(job.sessionId===concurrent.id){first.socket.emit('job:result',{jobId:job.jobId,ok:true,text:'Concurrent completed'});return;}await writeFile(path.join(source,'outputs/owner.txt'),'owner result');if(hold){held=job;return;}assert.equal(await readFile(path.join(source,'src/app.ts'),'utf8'),'source v2');first.socket.emit('job:result',{jobId:job.jobId,ok:true,text:'Owner returned'});});
  second.socket.on('job:start',async(job,ack)=>{ack({ok:true});secondRuns++;assert.equal(await readFile(path.join(destination,'src/app.ts'),'utf8'),'source v1');assert.equal(await readFile(path.join(destination,'outputs/owner.txt'),'utf8'),'owner result');await assert.rejects(readFile(path.join(destination,'.env')),{code:'ENOENT'});await writeFile(path.join(destination,'src/app.ts'),'source v2');await writeFile(path.join(destination,'outputs/friend.txt'),'friend result');second.socket.emit('job:result',{jobId:job.jobId,ok:true,text:'Friend completed'});});
  second.socket.on('file:list',(scope,ack)=>{assert.equal(scope.projectId,project.id);ack({ok:true,files:[{name:'outputs/friend.txt',size:13,modified:new Date().toISOString()}]});});
  function terminal(client,sessionId){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('No terminal event: '+log)),10000);const handler=event=>{if(event.sessionId===sessionId&&['completed','error'].includes(event.type)){clearTimeout(timer);client.off('ai:event',handler);resolve(event);}};client.on('ai:event',handler);});}
  const send=(client,sessionId)=>client.timeout(5000).emitWithAck('run',{sessionId,prompt:'Work on shared app',model:'shared-model',service:'codex'});
  let end=terminal(ownerClient,a.id);assert.equal((await send(ownerClient,a.id)).ok,true);await waitFor(()=>held);
  const concurrentEnd=terminal(ownerClient,concurrent.id);assert.equal((await send(ownerClient,concurrent.id)).ok,true);assert.equal((await concurrentEnd).type,'completed');
  const upload=await fetch(base+'/api/projects/'+project.id+'/files',{method:'POST',headers:{cookie:owner,'content-type':'application/octet-stream','X-File-Name':'during-task.txt'},body:'uploaded while running'});assert.equal(upload.status,201);
  assert.equal(await readFile(path.join(source,'during-task.txt'),'utf8'),'uploaded while running');
  assert.equal((await api(owner,'/workspaces/projects/'+project.id+'/files','DELETE',{name:'during-task.txt'})).status,200);
  await assert.rejects(readFile(path.join(source,'during-task.txt')),{code:'ENOENT'});
  assert.equal((await api(owner,'/projects/'+project.id+'/members','PUT',{members:['friend']})).status,200);
  assert.equal((await api(owner,'/projects')).body.find(p=>p.id===project.id).needsSync,true);
  const friendConcurrentEnd=terminal(friendClient,b.id);assert.equal((await send(friendClient,b.id)).ok,true);assert.equal((await friendConcurrentEnd).type,'completed');assert.equal(secondRuns,1);
  first.socket.emit('job:result',{jobId:held.jobId,ok:true,text:'Owner completed'});assert.equal((await end).type,'completed');
  end=terminal(friendClient,b.id);assert.equal((await send(friendClient,b.id)).ok,true);assert.equal((await end).type,'completed');assert.equal(secondRuns,2);
  assert.equal((await api(owner,'/projects')).body.find(p=>p.id===project.id).runnerId,second.device.id);
  assert.equal((await api(owner,'/sessions/'+a.id+'/files')).body.files[0].name,'outputs/friend.txt');
  assert.equal((await api(stranger,'/workspaces/projects/'+project.id+'/files','DELETE',{name:'outputs/friend.txt'})).status,404);
  // Disconnect the most recent runner: the durable snapshot must allow the other runner to continue.
  second.socket.disconnect();hold=false;
  end=terminal(ownerClient,a.id);assert.equal((await send(ownerClient,a.id)).ok,true);assert.equal((await end).type,'completed');assert.equal(await readFile(path.join(source,'outputs/friend.txt'),'utf8'),'friend result');
  // An unsaved workspace must not silently roll back to an older snapshot when its runner goes offline.
  await symlink('/etc/passwd',path.join(source,'unsupported-link'));
  end=terminal(ownerClient,a.id);assert.equal((await send(ownerClient,a.id)).ok,true);assert.equal((await end).type,'error');
  await waitFor(async()=> (await api(owner,'/projects/'+project.id+'/members','PUT',{members:['friend']})).status===200);
  assert.equal((await api(owner,'/projects')).body.find(p=>p.id===project.id).needsSync,true);
  first.socket.disconnect();second.socket.connect();await waitFor(()=>second.socket.connected);
  end=terminal(friendClient,b.id);assert.equal((await send(friendClient,b.id)).ok,true);assert.equal((await end).type,'error');assert.equal(secondRuns,2);
  await waitFor(async()=> (await api(owner,'/projects/'+project.id+'/members','PUT',{members:[]})).status===200);
  assert.deepEqual((await api(friend,'/projects')).body,[]);
  assert.equal((await api(friend,'/sessions/'+b.id+'/files')).status,404);
  assert.equal((await send(friendClient,b.id)).ok,false);
 }finally{for(const socket of sockets)socket.disconnect();backend.kill('SIGTERM');await new Promise(r=>backend.once('exit',r));await rm(root,{recursive:true,force:true});}
});

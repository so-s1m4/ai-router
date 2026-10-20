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

test('shared tokens use recipient files and Mac without exposing owner resources', {timeout:45000}, async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'router-recipient-workspace-'));
 const port=await freePort(),previewPort=await freePort(),base=`http://127.0.0.1:${port}`;
 const backend=spawn(process.execPath,[path.join(repo,'backend/dist/server.js')],{cwd:repo,env:{...process.env,DATA_DIR:path.join(root,'backend'),PORT:String(port),PREVIEW_PORT:String(previewPort),PUBLIC_URL:'https://router.test',ADMIN_PASSWORD:'sharing-test-password',SESSION_SECRET:'sharing-test-secret-longer-than-thirty-two-characters',COOKIE_SECURE:'false'},stdio:['ignore','ignore','pipe']});
 const sockets=[];let log='';backend.stderr.on('data',chunk=>log+=chunk);
 try {
  await waitFor(async()=> (await fetch(base+'/api/health')).ok);
  async function auth(username,register=false){const response=await fetch(base+'/api/'+(register?'register':'login'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password:'sharing-test-password'})});assert.ok(response.ok);return response.headers.get('set-cookie').split(';')[0];}
  const owner=await auth('admin'),friend=await auth('friend',true),stranger=await auth('stranger',true);
  async function api(cookie,url,method='GET',body){const response=await fetch(base+'/api'+url,{method,headers:{cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};}
  async function device(cookie,name){const pair=await api(cookie,'/runners/pairing','POST',{name});return (await fetch(base+'/api/runner/enroll',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:pair.body.code})})).json();}
  async function socket(url,options){const s=await connect(url,options);sockets.push(s);return s;}
  assert.equal((await api(friend,'/projects/attachments','POST',{})).status,409);
  const executor=await device(owner,'Token runner');
  const runner=await socket(base+'/runner',{auth:{runnerId:executor.id,secret:executor.secret}});
  const account=(await api(owner,'/accounts','POST',{name:'Owner Codex',provider:'codex',runnerId:executor.id})).body;
  runner.emit('account:status',{accountId:account.id,provider:'codex',models:[{id:'allowed',label:'Allowed'}]});
  await waitFor(async()=> (await api(owner,'/accounts')).body.some(a=>a.models.some(m=>m.id==='allowed')));
  const grant=(await api(owner,'/access-grants','POST',{username:'friend',models:['allowed'],budget:1000,period:'once'})).body;
  assert.equal((await api(friend,'/projects/attachments','POST',{})).status,409);
  await api(friend,'/access-grants/'+grant.id,'PATCH',{state:'active'});
  const macDevice=await device(friend,'Friend Mac');
  const mac=await socket(base+'/mac',{auth:{runnerId:macDevice.id,secret:macDevice.secret}});
  let friendCommands=0,ownerCommands=0;
  mac.on('mac:command',(request,ack)=>{friendCommands++;ack({ok:true,text:'friend files'});});
  const ownerMacDevice=await device(owner,'Owner Mac');
  const ownerMac=await socket(base+'/mac',{auth:{runnerId:ownerMacDevice.id,secret:ownerMacDevice.secret}});
  ownerMac.on('mac:command',(request,ack)=>{ownerCommands++;ack({ok:true,text:'owner private files'});});
  await waitFor(async()=> (await api(friend,'/runners')).body.some(r=>r.macOnline));
  const workspace=await api(friend,'/projects/attachments','POST',{});assert.equal(workspace.status,201);
  const project=workspace.body;assert.deepEqual(project.memberIds,[]);assert.equal(project.runnerId,executor.id);
  assert.equal((await api(owner,'/projects')).body.some(p=>p.id===project.id),false);
  assert.equal((await api(stranger,'/projects')).body.some(p=>p.id===project.id),false);
  assert.equal((await api(owner,'/sessions','POST',{projectId:project.id})).status,404);
  const {attachProjectSync}=await import('../runner/dist/project-sync.js');
  attachProjectSync(runner,path.join(root,'runner'),()=>false);
  const {mkdir,writeFile,readFile}=await import('node:fs/promises');
  const workspaceDir=path.join(root,'runner','projects',project.id);
  runner.on('file:write',async(file,ack)=>{assert.equal(file.projectId,project.id);await mkdir(workspaceDir,{recursive:true});await writeFile(path.join(workspaceDir,file.name),file.data);ack({ok:true,name:file.name,size:file.data.length});});
  const upload=await fetch(base+'/api/projects/'+project.id+'/files',{method:'POST',headers:{cookie:friend,'content-type':'application/octet-stream','X-File-Name':'friend.txt'},body:'her attachment'});
  assert.equal(upload.status,201);assert.equal(await readFile(path.join(workspaceDir,'friend.txt'),'utf8'),'her attachment');
  assert.equal((await fetch(base+'/api/projects/'+project.id+'/files',{method:'POST',headers:{cookie:owner,'content-type':'application/octet-stream'},body:'intrusion'})).status,404);
  const chat=(await api(friend,'/sessions','POST',{projectId:project.id})).body;
  const client=await socket(base,{extraHeaders:{cookie:friend}});
  const rpc=token=>fetch(base+'/api/mac/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'mac_run_command',arguments:{command:'cat friend.txt'}}})});
  let access;
  runner.on('job:start',async(job,ack)=>{ack({ok:true});try{
   assert.equal(job.accountId,account.id);assert.equal(job.projectId,project.id);assert.equal(job.sharedExecution,true);
   access=job.macAccess;assert.ok(access);assert.equal(job.personalMcp.find(m=>m.name==='ai_router_mac').headers.Authorization,'Bearer '+access.token);
   const response=await rpc(access.token);assert.equal(response.status,200);assert.match(JSON.stringify(await response.json()),/friend files/);
   runner.emit('job:result',{jobId:job.jobId,ok:true,text:'Used friend workspace and Mac'});
  }catch(error){runner.emit('job:result',{jobId:job.jobId,ok:false,error:error.message});}});
  const completed=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('No completion: '+log)),10000);client.on('ai:event',e=>{if(e.sessionId===chat.id&&['completed','error'].includes(e.type)){clearTimeout(timer);resolve(e);}});});
  assert.equal((await client.timeout(5000).emitWithAck('run',{sessionId:chat.id,prompt:'Use my attachment and Mac',service:'codex',model:'allowed',mode:'task'})).ok,true);
  const result=await completed;assert.equal(result.type,'completed',result.message);
  assert.equal(friendCommands,1);assert.equal(ownerCommands,0);assert.equal((await rpc(access.token)).status,401);
  await api(owner,'/access-grants/'+grant.id,'PATCH',{state:'revoked'});
  assert.equal((await api(friend,'/projects/attachments','POST',{})).status,409);
 }finally{for(const s of sockets)s.disconnect();backend.kill('SIGTERM');await new Promise(resolve=>backend.once('exit',resolve));await rm(root,{recursive:true,force:true});}
});

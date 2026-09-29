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



test('files upload, share and delete through a real runner socket with owner isolation', {timeout:30000}, async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'router-files-integration-'));
 process.env.RUNNER_DATA_DIR=path.join(root,'runner');
 const {attachSharedFiles}=await import('../runner/dist/shared-files.js');
 const apiPort=await freePort(),previewPort=await freePort();
 const backend=processAt(path.join(repo,'backend/dist/server.js'),{DATA_DIR:path.join(root,'backend'),PORT:String(apiPort),PREVIEW_PORT:String(previewPort),ADMIN_PASSWORD:'files-test-password',SESSION_SECRET:'files-test-secret-longer-than-thirty-two-characters',COOKIE_SECURE:'false',ALLOW_SIGNUP:'true'});
 let socket;
 try{
  await waitFor(async()=> (await fetch('http://127.0.0.1:'+apiPort+'/api/health')).ok);
  const base='http://127.0.0.1:'+apiPort;
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'admin',password:'files-test-password'})});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const api=async(url,method='GET',body)=>{const r=await fetch(base+'/api'+url,{method,headers:{cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
  const pairing=await api('/runners/pairing','POST',{name:'Files runner'});
  const enrolled=await fetch(base+'/api/runner/enroll',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:pairing.body.code})});
  const device=await enrolled.json();assert.equal(enrolled.status,201);
  const {io}=createRequire(path.join(repo,'runner/package.json'))('socket.io-client');
  socket=io(base+'/runner',{transports:['websocket'],auth:{runnerId:device.id,secret:device.secret}});
  attachSharedFiles(socket);
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  const project=await api('/projects','POST',{name:'Files project',runnerId:device.id});assert.equal(project.status,201);
  const session=await api('/sessions','POST',{projectId:project.body.id});assert.equal(session.status,201);
  const content=Buffer.alloc(2*1024*1024,65),filename="отчёт (1)'s.txt";
  const upload=await fetch(base+'/api/projects/'+project.body.id+'/files',{method:'POST',headers:{cookie,'content-type':'application/octet-stream','X-File-Name':encodeURIComponent(filename)},body:content});
  assert.equal(upload.status,201);assert.equal((await upload.json()).name,filename);
  const catalog=await api('/files');assert.equal(catalog.status,200);assert.equal(catalog.body.groups.length,1);assert.equal(catalog.body.groups[0].files[0].name,filename);
  // Oversized code is rejected before transfer; HTML and SVG are served only as plain text.
  const large=await fetch(base+'/api/workspaces/projects/'+project.body.id+'/preview?name='+encodeURIComponent(filename),{headers:{cookie}});assert.equal(large.status,400);
  for(const [name,text,mime] of [['code.html','<script>alert(1)</script>','text/plain'],['drawing.svg','<svg onload="alert(1)"></svg>','text/plain'],['document.pdf','%PDF-1.4','application/pdf'],['picture.png','PNG test','image/png']]){
   const uploaded=await fetch(base+'/api/projects/'+project.body.id+'/files',{method:'POST',headers:{cookie,'content-type':'application/octet-stream','X-File-Name':encodeURIComponent(name)},body:text});assert.equal(uploaded.status,201);
   const preview=await fetch(base+'/api/workspaces/projects/'+project.body.id+'/preview?name='+encodeURIComponent(name),{headers:{cookie}});assert.equal(preview.status,200);assert.ok(preview.headers.get('content-type').startsWith(mime));assert.equal(await preview.text(),text);
   assert.equal((await fetch(base+'/api/workspaces/projects/'+project.body.id+'/preview?name='+name)).status,401);
   assert.equal((await api('/workspaces/projects/'+project.body.id+'/files','DELETE',{name})).status,200);
  }
  const traversal=await fetch(base+'/api/workspaces/projects/'+project.body.id+'/preview?name=..%2Fsecret.txt',{headers:{cookie}});assert.equal(traversal.status,400);
  const url='/sessions/'+session.body.id+'/files';
  assert.equal((await api(url)).body.files[0].name,filename);
  const share=await api(url+'/share','POST',{name:filename});assert.equal(share.status,201);
  const download=await fetch(base+share.body.url);assert.equal(download.status,200);
  assert.match(download.headers.get('content-disposition'),/%27/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()),content);
  const registered=await fetch(base+'/api/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'files-other-user',password:'files-other-password'})});
  const otherCookie=registered.headers.get('set-cookie').split(';')[0];
  const otherCatalog=await fetch(base+'/api/files',{headers:{cookie:otherCookie}});assert.deepEqual((await otherCatalog.json()).groups,[]);
  const privatePreview=await fetch(base+'/api/workspaces/projects/'+project.body.id+'/preview?name='+encodeURIComponent(filename),{headers:{cookie:otherCookie}});assert.equal(privatePreview.status,404);
  const forbidden=await fetch(base+'/api'+url,{method:'DELETE',headers:{cookie:otherCookie,'content-type':'application/json'},body:JSON.stringify({name:filename})});assert.equal(forbidden.status,404);
  assert.equal((await fetch(base+'/api'+url,{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({name:filename})})).status,401);
  assert.equal((await api(url,'DELETE',{name:'.env'})).status,503);
  assert.equal((await api(url,'DELETE',{name:filename})).status,200);
  assert.deepEqual((await api(url)).body.files,[]);
  assert.equal((await fetch(base+share.body.url)).status,404);
 }finally{socket?.disconnect();backend.child.kill('SIGTERM');await new Promise(resolve=>backend.child.once('exit',resolve));await rm(root,{recursive:true,force:true});}
});

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(repo,'backend','package.json'));
const {WebSocket,WebSocketServer}=require('ws');
async function freePort(){const server=createNetServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function previewFetch(port,subdomain,url='/'){return await new Promise((resolve,reject)=>{httpRequest({hostname:'127.0.0.1',port,path:url,headers:{host:`${subdomain}.s1m4.com`}},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,text:Buffer.concat(chunks).toString()}));}).on('error',reject).end();});}
async function waitFor(fn,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){try{const value=await fn();if(value)return value;}catch{}await new Promise(resolve=>setTimeout(resolve,80));}throw new Error('Timed out waiting for preview service');}
function processAt(file,env){const child=spawn(process.execPath,[file],{cwd:repo,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>output=(output+chunk.toString()).slice(-3000));return {child,output:()=>output};}
async function command(args,env){return await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(repo,'runner/dist/deploy-preview.js'),...args],{cwd:repo,env:{...process.env,...env}});let out='',err='';child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);child.on('close',code=>code===0?resolve(out.trim()):reject(new Error(err||`deploy-preview exited ${code}`)));child.on('error',reject);});}

test('preview streams static, live HTTP and WebSocket traffic; visibility blocks public access', {timeout:90000}, async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'ai-router-preview-'));
  const backendData=path.join(root,'backend'),runnerData=path.join(root,'runner');
  const apiPort=await freePort(),previewPort=await freePort(),devPort=await freePort();
  const names={static:`site${randomBytes(3).toString('hex')}`,dev:`dev${randomBytes(3).toString('hex')}`};
  const backend=processAt(path.join(repo,'backend/dist/server.js'),{DATA_DIR:backendData,PORT:String(apiPort),PREVIEW_PORT:String(previewPort),ADMIN_PASSWORD:'preview-test-password',SESSION_SECRET:'preview-test-secret-longer-than-thirty-two-characters',COOKIE_SECURE:'false',ALLOW_SIGNUP:'false'});
  let runner,dev;
  try{
    await waitFor(async()=>{const response=await fetch(`http://127.0.0.1:${apiPort}/api/health`);return response.ok;});
    const login=await fetch(`http://127.0.0.1:${apiPort}/api/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'admin',password:'preview-test-password'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
    const api=async(url,method='GET',body)=>{const response=await fetch(`http://127.0.0.1:${apiPort}${url}`,{method,headers:{cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};};
    const me=await api('/api/me');assert.equal(me.status,200,`cookie ${cookie.split('=')[0]}: ${JSON.stringify(me.body)}`);
    const pairing=await api('/api/runners/pairing','POST',{name:'preview test runner'});assert.equal(pairing.status,201);
    runner=processAt(path.join(repo,'runner/dist/main.js'),{ROUTER_SERVER_URL:`http://127.0.0.1:${apiPort}`,ROUTER_ALLOW_INSECURE:'true',ROUTER_PAIRING_CODE:pairing.body.code,RUNNER_DATA_DIR:runnerData,MOCK_MODE:'true'});
    const runnerId=await waitFor(async()=>{const response=await api('/api/runners');return response.body.find(row=>row.online)?.id;});
    const dist=path.join(runnerData,'projects','test-project','dist');await mkdir(dist,{recursive:true});await writeFile(path.join(dist,'index.html'),'<h1>Preview tunnel works</h1>');await writeFile(path.join(dist,'style.css'),'body{color:red}');
    const cliEnv={RUNNER_DATA_DIR:runnerData};
    assert.equal(await command([dist,names.static],cliEnv),`https://${names.static}.s1m4.com`);
    const site=await previewFetch(previewPort,names.static);assert.equal(site.status,200,'static site');assert.match(site.text,/Preview tunnel works/);
    const asset=await previewFetch(previewPort,names.static,'/style.css');assert.equal(asset.status,200,'static asset');assert.match(asset.headers['content-type'],/text\/css/);
    const list=await api(`/api/runners/${runnerId}/previews`);assert.equal(list.body[0].subdomain,names.static);
    const hidden=await api(`/api/runners/${runnerId}/previews/${names.static}`,'PATCH',{visible:false});assert.equal(hidden.status,200);
    const blocked=await previewFetch(previewPort,names.static);assert.equal(blocked.status,404);
    await api(`/api/runners/${runnerId}/previews/${names.static}`,'PATCH',{visible:true});
    dev=createServer((req,res)=>{res.setHeader('content-type','text/plain');res.end(`dev:${req.url}`);});const wsServer=new WebSocketServer({server:dev});wsServer.on('connection',ws=>ws.on('message',message=>ws.send(message)));
    await new Promise(resolve=>dev.listen(devPort,'127.0.0.1',resolve));
    assert.equal(await command(['--port',String(devPort),names.dev],cliEnv),`https://${names.dev}.s1m4.com`);
    const live=await previewFetch(previewPort,names.dev,'/hello');assert.equal(live.status,200,'live site');assert.equal(live.text,'dev:/hello');
    const ws=new WebSocket(`ws://127.0.0.1:${previewPort}/hmr`,{headers:{host:`${names.dev}.s1m4.com`}});await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});const echoed=new Promise((resolve,reject)=>{ws.once('message',data=>resolve(data.toString()));ws.once('error',reject);});ws.send('hello websocket');assert.equal(await echoed,'hello websocket');ws.close();
    await command(['--stop',names.static],cliEnv);const stopped=await previewFetch(previewPort,names.static);assert.equal(stopped.status,404);
  }catch(error){throw new Error(`${error.message}\nbackend: ${backend.output()}\nrunner: ${runner?.output()||''}`);}finally{runner?.child.kill('SIGTERM');backend.child.kill('SIGTERM');if(dev)await new Promise(resolve=>dev.close(resolve));await rm(root,{recursive:true,force:true});}
});

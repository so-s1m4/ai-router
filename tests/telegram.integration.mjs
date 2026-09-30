import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
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

test('Telegram starts queued work, delivers agent questions, steers the correct chat and returns results', {timeout:30000}, async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'router-telegram-e2e-'));
 const incoming=path.join(root,'incoming.json'),outgoing=path.join(root,'outgoing.json'),mock=path.join(root,'mock.mjs');
 await writeFile(incoming,'[]');await writeFile(outgoing,'[]');
 // Intercept only Telegram: local control-plane calls still use the real HTTP stack.
 await writeFile(mock,[
  "import {readFile,writeFile} from 'node:fs/promises';",
  "const original=globalThis.fetch;let deliveries=[];",
  "globalThis.fetch=async(input,init)=>{",
  " if(!String(input).startsWith('https://api.telegram.org/'))return original(input,init);",
  " const method=String(input).split('/').pop(),body=JSON.parse(init.body);let result;",
  " if(method==='getMe')result={username:'router_test_bot'};",
  " else if(method==='getUpdates'){await new Promise(r=>setTimeout(r,50));result=JSON.parse(await readFile(process.env.TG_IN,'utf8')).filter(u=>u.update_id>=body.offset);}",
  " else if(method==='sendMessage'){result={message_id:deliveries.length+1};deliveries.push({...body,...result});await writeFile(process.env.TG_OUT,JSON.stringify(deliveries));}",
  " else throw new Error('Unexpected Telegram method: '+method);",
  " return new Response(JSON.stringify({ok:true,result}));",
  "};"
 ].join('\n'));
 const port=await freePort(),previewPort=await freePort(),base='http://127.0.0.1:'+port;
 const backend=spawn(process.execPath,['--import',mock,path.join(repo,'backend/dist/server.js')],{
  cwd:repo,env:{...process.env,TELEGRAM_BOT_TOKEN:'test-token',TG_IN:incoming,TG_OUT:outgoing,PUBLIC_URL:'https://router.example',AUTO_CHEAP_MODELS:'economy',DATA_DIR:root,PORT:String(port),PREVIEW_PORT:String(previewPort),ADMIN_PASSWORD:'telegram-test-password',SESSION_SECRET:'telegram-secret-longer-than-thirty-two-characters',COOKIE_SECURE:'false'},stdio:'ignore'
 });
 let runner;
 try{
  await waitFor(async()=>(await fetch(base+'/api/health')).ok);
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'admin',password:'telegram-test-password'})});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const api=async(url,method='GET',body)=>{
   const response=await fetch(base+'/api'+url,{method,headers:{cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
   assert.ok(response.ok,method+' '+url+': '+response.status);return response.json();
  };
  const pairing=await api('/runners/pairing','POST',{name:'Telegram runner'});
  const device=await(await fetch(base+'/api/runner/enroll',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:pairing.code})})).json();
  runner=await connect(base+'/runner',{auth:{runnerId:device.id,secret:device.secret}});
  const account=await api('/accounts','POST',{provider:'codex',name:'Telegram account',runnerId:device.id});
  runner.emit('account:status',{accountId:account.id,provider:'codex',models:[{id:'economy',label:'Economy'}]});
  await waitFor(async()=>(await api('/accounts'))[0].models.some(m=>m.id==='economy'));
  const jobs=[],steers=[];
  runner.on('job:start',(job,ack)=>{ack({ok:true});jobs.push(job);runner.emit('job:event',{jobId:job.jobId,type:'status',data:{steeringAvailable:true}});});
  runner.on('job:steer',(value,ack)=>{steers.push(value);ack({ok:true});});
  let nextId=1;const updates=[];
  const send=async(text,replyId,duplicate=false)=>{
   const update={update_id:nextId++,message:{text,chat:{id:123,type:'private'},from:{id:123},...(replyId?{reply_to_message:{message_id:replyId}}:{})}};
   updates.push(update);if(duplicate)updates.push(update);await writeFile(incoming,JSON.stringify(updates));
  };
  const messages=async()=>JSON.parse(await readFile(outgoing,'utf8'));
  const link=await api('/notifications/telegram/connect','POST');
  await send('/start '+new URL(link.url).searchParams.get('start'));
  await waitFor(async()=>(await api('/notifications/telegram')).connected);
  await send('Translate hello',undefined,true);
  await waitFor(()=>jobs.length===1);assert.equal(jobs[0].model,'economy');
  runner.emit('job:event',{jobId:jobs[0].jobId,type:'delta',text:'Which language should I use?'});
  await waitFor(async()=>(await messages()).some(m=>m.text.includes('Which language')));
  const question=(await messages()).find(m=>m.text.includes('Which language'));
  await send('/new');
  await waitFor(async()=>(await messages()).some(m=>m.text.includes('Создан новый чат')));
  await send('Use Russian',question.message_id,true);
  await waitFor(()=>steers.length===1);assert.equal(steers[0].jobId,jobs[0].jobId);assert.equal(steers[0].text,'Use Russian');
  runner.emit('job:result',{jobId:jobs[0].jobId,ok:true,text:'Привет'});
  await waitFor(async()=>(await messages()).some(m=>m.text.includes('Привет')));
  assert.equal(jobs.length,1,'duplicated Telegram delivery must not create another task');
  const chat=await api('/sessions/'+jobs[0].sessionId);
  assert.deepEqual(chat.messages.map(m=>m.text),['Translate hello','Use Russian','Привет']);
  await send('/task Work to stop');
  await waitFor(()=>jobs.length===2);
  runner.on('job:cancel',value=>runner.emit('job:result',{jobId:value.jobId,ok:false,error:'Stopped',code:'canceled'}));
  await send('/stop');
  await waitFor(async()=>(await api('/tasks')).find(t=>t.id===jobs[1].taskId).state==='canceled');
  await api('/notifications/telegram','DELETE');
  await send('Disconnected task');
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(jobs.length,2,'unlinked users cannot start work');
 }finally{
  runner?.disconnect();const exited=new Promise(resolve=>backend.once('exit',resolve));backend.kill('SIGTERM');await exited;
  await rm(root,{recursive:true,force:true});
 }
});

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { io } from 'socket.io-client';
import { z } from 'zod';
import { accountStatus, execute, RunnerError, workspaceFor, type Job, type ProviderId } from './cli.js';
import { CheckpointWriter } from './checkpoint.js';
import { prewarmCodexAppServer } from './app-server.js';
import { startPreviews } from './previews.js';
import { attachSharedFiles } from './shared-files.js';
const url=process.env.ROUTER_SERVER_URL?.replace(/\/$/,'');if(!url)throw new Error('ROUTER_SERVER_URL is required');const parsed=new URL(url);if(parsed.protocol!=='https:'&&process.env.ROUTER_ALLOW_INSECURE!=='true')throw new Error('HTTPS required; set ROUTER_ALLOW_INSECURE=true only for local development');
const root=path.resolve(process.env.RUNNER_DATA_DIR||'/runner-data'),file=path.join(root,'device.json');
interface Device {id:string;secret:string;name:string}
async function device():Promise<Device>{try{return JSON.parse(await readFile(file,'utf8')) as Device;}catch{}const code=process.env.ROUTER_PAIRING_CODE;if(!code)throw new Error('Set ROUTER_PAIRING_CODE once to enroll this runner');const response=await fetch(url+'/api/runner/enroll',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});if(!response.ok)throw new Error('Pairing failed: '+response.status);const d=await response.json() as Device;await mkdir(root,{recursive:true,mode:0o700});await writeFile(file,JSON.stringify(d),{mode:0o600});return d;}
const jobSchema=z.object({jobId:z.string().uuid(),taskId:z.string().uuid(),accountId:z.string().uuid(),provider:z.enum(['codex','antigravity']),sessionId:z.string().uuid(),projectId:z.string().uuid().optional(),prompt:z.string().min(1).max(40000),model:z.string().max(100),reasoning:z.string().max(32).optional(),mode:z.enum(['chat','task']).optional().default('task')});
async function start(){const d=await device();const socket=io(url+'/runner',{path:'/socket.io',transports:['websocket'],auth:{runnerId:d.id,secret:d.secret},reconnection:true,reconnectionDelay:1000,reconnectionDelayMax:10000});const active=new Map<string,AbortController>();
 await startPreviews(socket);
 attachSharedFiles(socket);
 socket.on('connect',()=>console.log(`Runner ${d.name} connected`));
 socket.on('connect_error',(err)=>console.error('Connection failed:',err.message));
 socket.on('disconnect',()=>{for(const controller of active.values())controller.abort();active.clear();console.log('Control plane disconnected; active jobs stopped');});
 socket.on('job:start',async(raw:unknown,ack?:(r:unknown)=>void)=>{
  if(!socket.connected)return ack?.({ok:false,error:'Offline'});
  const parsed=jobSchema.safeParse(raw);
  if(!parsed.success)return ack?.({ok:false,error:'Invalid job'});
  const job=parsed.data as Job;
  if(active.has(job.jobId))return ack?.({ok:false,error:'Duplicate job'});
  try{
   const previous=JSON.parse(await readFile(path.join(workspaceFor(job),'.ai-router','tasks',job.taskId,'checkpoint.json'),'utf8')) as {taskId?:string;sessionId?:string;projectId?:string;accountId?:string;threadId?:string;prompt?:string;priorContext?:string;partialText?:string;error?:string};
   if(previous.taskId===job.taskId&&previous.sessionId===job.sessionId&&previous.projectId===job.projectId){
    job.originalPrompt=previous.prompt||job.prompt;
    if(previous.accountId===job.accountId)job.previousThreadId=previous.threadId;
    if(previous.accountId!==job.accountId){
     job.handoffContext=[previous.priorContext||'',`Previous provider output:\n${(previous.partialText||'').slice(-12000)}`,`Previous error:\n${(previous.error||'').slice(-1000)}`].filter(Boolean).join('\n\n').slice(-20000);
     job.prompt=`Original request:\n${(previous.prompt||'').slice(0,16000)}\n\n${job.handoffContext}\n\n${job.prompt}`.slice(0,39000);
    }
   }
  }catch{}
  const controller=new AbortController();
  const checkpoint=new CheckpointWriter(workspaceFor(job),job.taskId,{taskId:job.taskId,jobId:job.jobId,accountId:job.accountId,provider:job.provider,sessionId:job.sessionId,projectId:job.projectId,model:job.model,reasoning:job.reasoning,prompt:job.originalPrompt||job.prompt,priorContext:job.handoffContext});
  let partial='';
  active.set(job.jobId,controller);
  ack?.({ok:true});
  try{
   checkpoint.update({},true);
   if(socket.connected)socket.emit('job:event',{jobId:job.jobId,type:'checkpoint',message:'Checkpoint задачи создан',data:{taskId:job.taskId,status:'running'}});
   const text=await execute(job,controller.signal,e=>{
    if(e.type==='delta'&&e.text){partial=(partial+e.text).slice(-12000);checkpoint.update({partialText:partial,lastEvent:'delta'});}
    else if(e.type==='tool')checkpoint.update({lastEvent:'tool'},true);
    else if(e.type==='checkpoint')checkpoint.update({lastEvent:e.message||'checkpoint',threadId:typeof e.data?.threadId==='string'?e.data.threadId:undefined},true);
    else if(e.type==='status')checkpoint.update({lastEvent:'status'});
    if(socket.connected)socket.emit('job:event',{jobId:job.jobId,...e});
   });
   checkpoint.update({status:'completed',partialText:text,lastEvent:'completed'},true);
   await checkpoint.flush();
   if(socket.connected)socket.emit('job:event',{jobId:job.jobId,type:'checkpoint',message:'Checkpoint задачи обновлён',data:{taskId:job.taskId,status:'completed'}});
   if(socket.connected)socket.emit('job:result',{jobId:job.jobId,ok:true,text});
  }catch(e){
   const code=e instanceof RunnerError?e.code:'failed';
   checkpoint.update({status:code==='rate_limit'?'handoff_pending':'failed',partialText:partial,error:e instanceof Error?e.message:'Ошибка',handoffReason:code==='rate_limit'?'quota':undefined,lastEvent:'error'},true);
   try{await checkpoint.flush();}catch(error){console.error('Checkpoint write failed:',error);}
   if(socket.connected)socket.emit('job:event',{jobId:job.jobId,type:'checkpoint',message:'Checkpoint сохранён для продолжения',data:{taskId:job.taskId,status:code==='rate_limit'?'handoff_pending':'failed'}});
   if(socket.connected)socket.emit('job:result',{jobId:job.jobId,ok:false,error:e instanceof Error?e.message:'Ошибка',code});
  }finally{active.delete(job.jobId);}
 });
 socket.on('file:write',async(raw:unknown,ack?:(r:unknown)=>void)=>{const parsed=z.object({transferId:z.string().uuid(),projectId:z.string().uuid(),name:z.string().min(1).max(180),data:z.any()}).safeParse(raw);if(!parsed.success)return ack?.({ok:false,error:'Неверный файл'});const {projectId,name}=parsed.data;const bytes=Buffer.isBuffer(parsed.data.data)?parsed.data.data:parsed.data.data instanceof Uint8Array?Buffer.from(parsed.data.data):null;if(!bytes)return ack?.({ok:false,error:'Неверное содержимое файла'});if(name==='.'||name==='..'||/[\\/\0]/.test(name))return ack?.({ok:false,error:'Недопустимое имя файла'});const projectRoot=path.resolve(root,'projects',projectId),target=path.resolve(projectRoot,name);if(!target.startsWith(projectRoot+path.sep))return ack?.({ok:false,error:'Недопустимый путь'});try{await mkdir(projectRoot,{recursive:true,mode:0o700});await writeFile(target,bytes,{mode:0o600});ack?.({ok:true,name,size:bytes.length});}catch(error){ack?.({ok:false,error:error instanceof Error?error.message:'Не удалось сохранить файл'});}});
 socket.on('job:cancel',(raw:unknown)=>{const p=z.object({jobId:z.string().uuid()}).safeParse(raw);if(p.success)active.get(p.data.jobId)?.abort();});
 const accounts=new Map<string,{provider:ProviderId}>();
 const refresh=async(accountId:string,provider:ProviderId)=>{const controller=new AbortController();const home=path.join(root,'accounts',accountId,'home');try{const status=await accountStatus(provider,home,controller.signal);if(socket.connected)socket.emit('account:status',{accountId,provider,models:status.models,limits:status.limits});if(provider==='codex'&&process.env.CODEX_APP_SERVER_MODE!=='false')void prewarmCodexAppServer(home).catch(error=>console.error('Codex prewarm failed:',error instanceof Error?error.message:error));}catch(error){if(socket.connected)socket.emit('account:status',{accountId,provider,models:[],error:error instanceof Error?error.message:'Статус не получен'});}};
 const refreshAll=()=>{for(const [accountId,account] of accounts)void refresh(accountId,account.provider);};
 socket.on('accounts:list',(raw:unknown)=>{const list=z.array(z.object({id:z.string().uuid(),provider:z.enum(['codex','antigravity'])})).safeParse(raw);if(!list.success)return;accounts.clear();for(const account of list.data)accounts.set(account.id,{provider:account.provider});refreshAll();});
 const interval=setInterval(refreshAll,Number(process.env.USAGE_REFRESH_SECONDS||60)*1000);interval.unref();
 socket.on('disconnect',()=>accounts.clear());
}
start().catch(err=>{console.error(err);process.exit(1);});

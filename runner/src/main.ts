import { cccAutoSchema } from './ccc-settings.js';
import { CccConnectionError } from './ccc-client.js';
import { saveCerebrasKey } from './cerebras.js';
import { saveOpenRouterKey } from './openrouter.js';
import { personalMcpSchema } from './personal-mcp.js';
import { CliUpdater } from './cli-updater.js';
import { readApiKey, saveApiKey } from './openai-key.js';
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { io } from 'socket.io-client';
import { z } from 'zod';
import { consumeResetCredit, accountStatus, execute, RunnerError, workspaceFor, type Job, type ProviderId } from './cli.js';
import { saveChatGPTSession } from './chatgpt-web.js';
import { CheckpointWriter } from './checkpoint.js';
import { restoreCheckpoint } from './continuation.js';
import { prewarmCodexAppServer, steerCodexJob, retireCodexAppServers } from './app-server.js';
import { startPreviews } from './previews.js';
import { attachSharedFiles } from './shared-files.js';
import { attachProjectSync } from './project-sync.js';
const url=process.env.ROUTER_SERVER_URL?.replace(/\/$/,'');if(!url)throw new Error('ROUTER_SERVER_URL is required');const parsed=new URL(url);if(parsed.protocol!=='https:'&&process.env.ROUTER_ALLOW_INSECURE!=='true')throw new Error('HTTPS required; set ROUTER_ALLOW_INSECURE=true only for local development');
const root=path.resolve(process.env.RUNNER_DATA_DIR||'/runner-data'),file=path.join(root,'device.json');
interface Device {id:string;secret:string;name:string}
async function device():Promise<Device>{try{return JSON.parse(await readFile(file,'utf8')) as Device;}catch{}const code=process.env.ROUTER_PAIRING_CODE;if(!code)throw new Error('Set ROUTER_PAIRING_CODE once to enroll this runner');const response=await fetch(url+'/api/runner/enroll',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});if(!response.ok)throw new Error('Pairing failed: '+response.status);const d=await response.json() as Device;await mkdir(root,{recursive:true,mode:0o700});await writeFile(file,JSON.stringify(d),{mode:0o600});return d;}
const jobSchema=z.object({cccAuto:cccAutoSchema.optional(),personalMcp:z.array(personalMcpSchema).max(20).optional(),sharedExecution:z.boolean().optional(),jobId:z.string().uuid(),taskId:z.string().uuid(),continuationOf:z.string().uuid().optional(),accountId:z.string().uuid(),provider:z.enum(['codex','antigravity','chatgpt','openrouter','cerebras']),sessionId:z.string().uuid(),projectId:z.string().uuid().optional(),prompt:z.string().min(1).max(40000),model:z.string().max(100),reasoning:z.string().max(32).optional(),fast:z.boolean().optional(),workflow:z.enum(['standard','ccc-auto']).default('standard'),mode:z.enum(['chat','task']).optional().default('task')});
async function start(){
 const active=new Map<string,AbortController>();
 const busySessions=new Set<string>();
 const updater=new CliUpdater({root,busy:()=>active.size>0,promoted:provider=>{if(provider==='codex')retireCodexAppServers();}});
 await updater.start();
 const d=await device();const socket=io(url+'/runner',{path:'/socket.io',transports:['websocket'],auth:{runnerId:d.id,secret:d.secret},reconnection:true,reconnectionDelay:1000,reconnectionDelayMax:10000});
 const steeringCheckpoints=new Map<string,{writer:CheckpointWriter;prompt:string}>();
 await startPreviews(socket);
 attachSharedFiles(socket);
 const jobProjects=new Map<string,string>();
 attachProjectSync(socket,root,id=>[...jobProjects.values()].includes(id));
 socket.on('connect',()=>console.log(`Runner ${d.name} connected`));
 socket.on('connect_error',(err)=>console.error('Connection failed:',err.message));
 socket.on('disconnect',()=>{for(const controller of active.values())controller.abort();console.log('Control plane disconnected; active jobs stopped');});
 socket.on('job:start',async(raw:unknown,ack?:(r:unknown)=>void)=>{
  if(!socket.connected)return ack?.({ok:false,error:'Offline'});
  const parsed=jobSchema.safeParse(raw);
  if(!parsed.success)return ack?.({ok:false,error:'Invalid job'});
  const job=parsed.data as Job;
  if(job.cccAuto?.levels.some(r=>r.candidates.some(c=>c.enabled&&(!c.accountId||accounts.get(c.accountId)?.provider!==c.provider))))return ack?.({ok:false,error:'CCC candidate connection is not assigned to this runner'});
  if(active.has(job.jobId))return ack?.({ok:false,error:'Duplicate job'});
  if(busySessions.has(job.sessionId))return ack?.({ok:false,error:'This chat is still running or stopping its previous task'});
  const controller=new AbortController();
  busySessions.add(job.sessionId);
  active.set(job.jobId,controller);
  if(job.projectId)jobProjects.set(job.jobId,job.projectId);
  try{await restoreCheckpoint(job,workspaceFor(job));controller.signal.throwIfAborted();}catch(error){active.delete(job.jobId);busySessions.delete(job.sessionId);jobProjects.delete(job.jobId);return ack?.({ok:false,error:error instanceof Error?error.message:'Unable to restore checkpoint'});}
  const checkpoint=new CheckpointWriter(workspaceFor(job),job.taskId,{taskId:job.taskId,jobId:job.jobId,accountId:job.accountId,provider:job.provider,sessionId:job.sessionId,projectId:job.projectId,model:job.model,reasoning:job.reasoning,prompt:job.originalPrompt||job.prompt,priorContext:job.handoffContext});
  let partial='';
  steeringCheckpoints.set(job.jobId,{writer:checkpoint,prompt:job.originalPrompt||job.prompt});
  ack?.({ok:true});
  try{
   await checkpoint.flush();
   if(socket.connected)socket.emit('job:event',{jobId:job.jobId,type:'checkpoint',message:'Task checkpoint created',data:{taskId:job.taskId,status:'running'}});
   const text=await execute(job,controller.signal,e=>{
    if(e.type==='delta'&&e.text){partial=(partial+e.text).slice(-12000);checkpoint.update({partialText:partial,lastEvent:'delta'});}
    else if(e.type==='tool')checkpoint.update({lastEvent:'tool'},true);
    else if(e.type==='checkpoint')checkpoint.update({lastEvent:e.message||'checkpoint',threadId:typeof e.data?.threadId==='string'?e.data.threadId:undefined},true);
    else if(e.type==='status')checkpoint.update({lastEvent:'status'});
    if(socket.connected)socket.emit('job:event',{jobId:job.jobId,...e});
   });
   checkpoint.update({status:'completed',partialText:text,lastEvent:'completed'},true);
   await checkpoint.flush();
   if(socket.connected)socket.emit('job:event',{jobId:job.jobId,type:'checkpoint',message:'Task checkpoint updated',data:{taskId:job.taskId,status:'completed'}});
   if(socket.connected)socket.emit('job:result',{jobId:job.jobId,ok:true,text});
  }catch(e){
   const code=e instanceof RunnerError||e instanceof CccConnectionError?e.code:'failed';
   checkpoint.update({status:code==='rate_limit'?'handoff_pending':'failed',partialText:partial,error:e instanceof Error?e.message:'Error',handoffReason:code==='rate_limit'?'quota':undefined,lastEvent:'error'},true);
   try{await checkpoint.flush();}catch(error){console.error('Checkpoint write failed:',error);}
   if(socket.connected)socket.emit('job:event',{jobId:job.jobId,type:'checkpoint',message:'Checkpoint saved for continuation',data:{taskId:job.taskId,status:code==='rate_limit'?'handoff_pending':'failed'}});
   if(socket.connected)socket.emit('job:result',{jobId:job.jobId,ok:false,error:e instanceof Error?e.message:'Error',code});
  }finally{jobProjects.delete(job.jobId);active.delete(job.jobId);busySessions.delete(job.sessionId);steeringCheckpoints.delete(job.jobId);void updater.check();}
 });
 socket.on('job:steer',async(raw:unknown,ack?:(r:unknown)=>void)=>{
  const parsed=z.object({jobId:z.string().uuid(),text:z.string().trim().min(1).max(16000)}).strict().safeParse(raw);
  if(!parsed.success)return ack?.({ok:false,error:'Incorrect clarification'});
  if(!active.has(parsed.data.jobId))return ack?.({ok:false,error:'The task has already been completed'});
  try{await steerCodexJob(parsed.data.jobId,parsed.data.text);
   const checkpoint=steeringCheckpoints.get(parsed.data.jobId);
   if(checkpoint){checkpoint.prompt+='\n\nUser steering:\n'+parsed.data.text;checkpoint.writer.update({prompt:checkpoint.prompt},true);}
   ack?.({ok:true});}
  catch(error){ack?.({ok:false,error:error instanceof Error?error.message:'Failed to send clarification'});}
 });
 socket.on('job:cancel',(raw:unknown)=>{const p=z.object({jobId:z.string().uuid()}).safeParse(raw);if(p.success)active.get(p.data.jobId)?.abort();});
 const accounts=new Map<string,{provider:ProviderId;authType?:'api_key'}>();
 const refresh=async(accountId:string,provider:ProviderId)=>{const controller=new AbortController();const home=path.join(root,'accounts',accountId,'home');try{if(provider==='codex'&&accounts.get(accountId)?.authType==='api_key'&&!await readApiKey(home))throw new Error('Connect OpenAI API key');const status=await accountStatus(provider,home,controller.signal);if(socket.connected)socket.emit('account:status',{accountId,provider,models:status.models,limits:status.limits});if(provider==='codex'&&process.env.CODEX_APP_SERVER_MODE!=='false')void prewarmCodexAppServer(home).catch(error=>console.error('Codex prewarm failed:',error instanceof Error?error.message:error));}catch(error){if(socket.connected)socket.emit('account:status',{accountId,provider,models:[],error:error instanceof Error?error.message:'Status not received'});}};
 socket.on('account:reset',async(raw:unknown,ack?:(r:unknown)=>void)=>{
  const parsed=z.object({accountId:z.string().uuid(),idempotencyKey:z.string().uuid()}).strict().safeParse(raw);
  if(!parsed.success)return ack?.({ok:false,error:'Invalid reset request'});
  const account=accounts.get(parsed.data.accountId);
  if(account?.provider!=='codex'||account.authType==='api_key')return ack?.({ok:false,error:'Subscription account is not assigned to this runner'});
  try{
   const outcome=await consumeResetCredit(path.join(root,'accounts',parsed.data.accountId,'home'),parsed.data.idempotencyKey,new AbortController().signal);
   ack?.({ok:true,outcome});void refresh(parsed.data.accountId,'codex');
  }catch(error){ack?.({ok:false,error:error instanceof Error?error.message:'Reset failed'});}
 });
 const refreshAll=()=>{for(const [accountId,account] of accounts)void refresh(accountId,account.provider);};
 socket.on('accounts:list',async(raw:unknown)=>{const list=z.array(z.object({id:z.string().uuid(),provider:z.enum(['codex','antigravity','chatgpt','openrouter','cerebras']),authType:z.literal('api_key').optional()})).safeParse(raw);if(!list.success)return;accounts.clear();for(const account of list.data)accounts.set(account.id,{provider:account.provider,authType:account.authType});const accountsDir=path.join(root,'accounts');try{for(const entry of await readdir(accountsDir,{withFileTypes:true})){if(!/^[a-f0-9-]{36}$/.test(entry.name)||accounts.has(entry.name))continue;await rm(path.join(accountsDir,entry.name),{recursive:true,force:true});}}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')console.error('Account cleanup failed:',error);}refreshAll();});
 socket.on('account:openrouter-key',async(raw:unknown,ack?:(r:unknown)=>void)=>{
  const parsed=z.object({accountId:z.string().uuid(),apiKey:z.string().min(20).max(512)}).strict().safeParse(raw);
  if(!parsed.success)return ack?.({ok:false,error:'Invalid key data'});
  if(accounts.get(parsed.data.accountId)?.provider!=='openrouter')return ack?.({ok:false,error:'OpenRouter connection is not assigned to this runner'});
  try{await saveOpenRouterKey(path.join(root,'accounts',parsed.data.accountId,'home'),parsed.data.apiKey);ack?.({ok:true});void refresh(parsed.data.accountId,'openrouter');}
  catch(error){ack?.({ok:false,error:error instanceof Error?error.message:'Failed to save key'});}
 });
 socket.on('account:cerebras-key',async(raw:unknown,ack?:(r:unknown)=>void)=>{
  const parsed=z.object({accountId:z.string().uuid(),apiKey:z.string().min(20).max(512)}).strict().safeParse(raw);
  if(!parsed.success)return ack?.({ok:false,error:'Invalid key data'});
  if(accounts.get(parsed.data.accountId)?.provider!=='cerebras')return ack?.({ok:false,error:'Cerebras connection is not assigned to this runner'});
  try{await saveCerebrasKey(path.join(root,'accounts',parsed.data.accountId,'home'),parsed.data.apiKey);ack?.({ok:true});void refresh(parsed.data.accountId,'cerebras');}
  catch(error){ack?.({ok:false,error:error instanceof Error?error.message:'Failed to save key'});}
 });
 socket.on('account:openai-key',async(raw:unknown,ack?:(r:unknown)=>void)=>{
  const parsed=z.object({accountId:z.string().uuid(),apiKey:z.string().min(20).max(512)}).strict().safeParse(raw);
  if(!parsed.success)return ack?.({ok:false,error:'Invalid key data'});
  const account=accounts.get(parsed.data.accountId);
  if(account?.provider!=='codex'||account.authType!=='api_key')return ack?.({ok:false,error:'API connection is not assigned to this runner'});
  const home=path.join(root,'accounts',parsed.data.accountId,'home');
  try{await saveApiKey(home,parsed.data.apiKey);ack?.({ok:true});void refresh(parsed.data.accountId,'codex');}
  catch(error){ack?.({ok:false,error:error instanceof Error?error.message:'Failed to save key'});}
 });
 socket.on('account:chatgpt-session',async(raw:unknown,ack?:(r:unknown)=>void)=>{const p=z.object({accountId:z.string().uuid(),sessionToken:z.string().optional(),cookies:z.array(z.any()).optional()}).safeParse(raw);if(!p.success)return ack?.({ok:false,error:'Invalid session data'});const home=path.join(root,'accounts',p.data.accountId,'home');try{await saveChatGPTSession(home,{sessionToken:p.data.sessionToken,cookies:p.data.cookies});void refresh(p.data.accountId,'chatgpt');ack?.({ok:true});}catch(error){ack?.({ok:false,error:error instanceof Error?error.message:'Save error'});}});
 const interval=setInterval(refreshAll,Number(process.env.USAGE_REFRESH_SECONDS||60)*1000);interval.unref();
 socket.on('disconnect',()=>accounts.clear());
}
start().catch(err=>{console.error(err);process.exit(1);});

import { boundedText } from './ccc-context.js';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { RunnerError, type AccountModel, type Event, type Job } from './cli.js';
import { codeOutputSchema } from './ccc-fast.js';
import { cliTimeoutSeconds } from './timeouts.js';

const base = 'https://openrouter.ai/api/v1';
const keyFile = (home:string) => path.join(home, '.openrouter', 'auth.json');
export async function readOpenRouterKey(home:string):Promise<string> {
  try {const data=JSON.parse(await readFile(keyFile(home),'utf8')); if(typeof data.apiKey==='string'&&data.apiKey)return data.apiKey;}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new RunnerError('Unable to read OpenRouter authorization','auth');}
  throw new RunnerError('Connect an OpenRouter API key','auth');
}
function httpError(status:number) {return new RunnerError(`OpenRouter API: HTTP ${status}`, status===401||status===403?'auth':status===429?'rate_limit':status>=500?'unavailable':'failed');}
export function openRouterModels(data:unknown):AccountModel[] {
  if(!Array.isArray(data))throw new RunnerError('OpenRouter returned an invalid model directory','failed');
  return data.filter(row=>typeof row?.id==='string'&&row.id.length<=100&&(!row.architecture?.output_modalities||row.architecture.output_modalities.includes('text'))).map(row=>({id:row.id,label:row.name||row.id,
    ...(row.supported_parameters?.includes('reasoning')?{reasoning:['none','minimal','low','medium','high','xhigh'].map(id=>({id,label:id}))}:{})}));
}
async function modelsWithKey(apiKey:string, signal?:AbortSignal) {
  const response=await fetch(base+'/models',{headers:{Authorization:`Bearer ${apiKey}`},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
  if(!response.ok)throw httpError(response.status);
  return openRouterModels((await response.json() as any).data);
}
export async function fetchOpenRouterModels(home:string,signal?:AbortSignal) {return modelsWithKey(await readOpenRouterKey(home),signal);}
export async function saveOpenRouterKey(home:string,apiKey:string) {
  if(!/^sk-or-[A-Za-z0-9_-]{14,506}$/.test(apiKey))throw new RunnerError('Enter an OpenRouter key (sk-or-…)','auth');
  // The public model directory alone does not verify credentials.
  const response=await fetch(base+'/key',{headers:{Authorization:`Bearer ${apiKey}`},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw httpError(response.status);
  await mkdir(path.dirname(keyFile(home)),{recursive:true,mode:0o700});
  const tmp=keyFile(home)+'.'+randomUUID()+'.tmp';
  await writeFile(tmp,JSON.stringify({apiKey}),{mode:0o600});await rename(tmp,keyFile(home));
}

const tools = [{type:'function',function:{name:'run_command',description:'Run a shell command in the task workspace. Read files, write code and run checks. Never read account secrets. Use relative paths; specify cwd relative to the workspace when needed.',parameters:{type:'object',properties:{command:{type:'string'},cwd:{type:'string'}},required:['command'],additionalProperties:false}}}];
async function runCommand(command:string,cwd:string,signal:AbortSignal):Promise<string> {
  const env:NodeJS.ProcessEnv={PATH:process.env.PATH,LANG:'C.UTF-8',HOME:cwd,TMPDIR:'/tmp'};
  return new Promise((resolve,reject)=>{
    const child=spawn('/bin/bash',['-c',command],{cwd,env,detached:true,stdio:['ignore','pipe','pipe']});
    let head='',tail='',size=0;
    const append=(chunk:string)=>{size+=chunk.length;head=(head+chunk).slice(0,12000);tail=(tail+chunk).slice(-12000);};
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',append);child.stderr.on('data',append);
    const stop=()=>{if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch{}};
    let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;stop();},120000);
    signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();
    const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',stop);};
    child.on('error',error=>{cleanup();reject(error);});
    child.on('close',code=>{cleanup();if(signal.aborted)reject(signal.reason);else {const output=size<=12000?head:size<=24000?head+tail.slice(-(size-12000)):boundedText(head+'\n[command output omitted]\n'+tail,24000);resolve(`Exit code: ${code}${timedOut?' (command timed out after 120s)':''}\n${output}`);}});
  });
}
export function openRouterBody(job:Job,messages:unknown[]) {
  return {model:job.model==='default'?'openrouter/auto':job.model,messages,stream:false,
    ...(job.openRouterRouting?{provider:{...(job.openRouterRouting.only.length?{only:job.openRouterRouting.only}:{}),allow_fallbacks:job.openRouterRouting.allowFallbacks}}:{}),
    ...(job.reasoning&&job.reasoning!=='default'?{reasoning:job.reasoning==='none'?{enabled:false}:{effort:job.reasoning==='max'?'xhigh':job.reasoning}}:{}),
    ...(job.solverCodeOnly?{response_format:{type:'json_schema',json_schema:{name:'ccc_solver',strict:true,schema:codeOutputSchema}}}:job.mode==='task'?{tools,tool_choice:'auto'}:{})};
}
export type ChatApiAdapter={name:string;base:string;readKey:(home:string)=>Promise<string>;body:(job:Job,messages:unknown[])=>Record<string,unknown>;httpError:(status:number)=>RunnerError};
export async function executeOpenRouter(job:Job,home:string,cwd:string,signal:AbortSignal,emit:(e:Event)=>void):Promise<string> {
  return executeChatApi(job,home,cwd,signal,emit,{name:'OpenRouter',base,readKey:readOpenRouterKey,body:openRouterBody,httpError});
}
export async function executeChatApi(job:Job,home:string,cwd:string,signal:AbortSignal,emit:(e:Event)=>void,adapter:ChatApiAdapter):Promise<string> {
  const {name,base,httpError}=adapter;
  const apiKey=await adapter.readKey(home);
  const taskSignal=AbortSignal.any([signal,AbortSignal.timeout(cliTimeoutSeconds(job.mode)*1000)]);
  const messages:any[]=[{role:'system',content:`You are an assistant working in ${cwd}. ${job.solverCodeOnly?'Return only the requested JSON.':'Use run_command for filesystem work when tools are available. Finish with a concise answer. Do not read account credentials or files outside the task workspace.'}`},{role:'user',content:job.prompt}];
  const usage={inputTokens:0,outputTokens:0,totalTokens:0,reasoningOutputTokens:0,cachedInputTokens:0};
  for(let turn=0;turn<100;turn++) {
    taskSignal.throwIfAborted();
    emit({type:'status',message:`${name}: ${job.model}`});
    let response:Response;
    const body=adapter.body(job,messages);
    try{response=await fetch(base+'/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:taskSignal});}
    catch(error){if(signal.aborted)throw signal.reason;if(taskSignal.aborted)throw new RunnerError(`${name} task timed out`,'timeout');throw new RunnerError(`${name} API is unavailable`,'unavailable');}
    if(response.status===400&&job.solverCodeOnly){
      response=await fetch(base+'/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({...body,response_format:undefined}),signal:taskSignal});
    }
    if(!response.ok)throw httpError(response.status);
    const data=await response.json() as any;
    if(data.error)throw httpError(Number(data.error.code)||502);
    const u=data.usage;
    if(u){usage.inputTokens+=u.prompt_tokens||0;usage.outputTokens+=u.completion_tokens||0;usage.totalTokens+=u.total_tokens||0;usage.reasoningOutputTokens+=u.completion_tokens_details?.reasoning_tokens||0;usage.cachedInputTokens+=u.prompt_tokens_details?.cached_tokens||0;emit({type:'usage',data:{...usage}});}
    const message=data.choices?.[0]?.message;
    if(!message)throw new RunnerError(`${name} returned no response`,'failed');
    if(!message.tool_calls?.length){if(typeof message.content!=='string'||!message.content.trim())throw new RunnerError(`${name} returned an empty answer`,'failed');if(data.choices[0].finish_reason==='length')throw new RunnerError(`${name} answer was truncated`,'failed');const text=job.solverCodeOnly?message.content.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''):message.content;emit({type:'delta',text});return text;}
    if(job.solverCodeOnly||job.mode!=='task')throw new RunnerError(`Unexpected ${name} tool call`,'failed');
    messages.push({role:'assistant',content:message.content ?? null,tool_calls:message.tool_calls,
      ...(typeof message.reasoning==='string'?{reasoning:message.reasoning}:{}),
      ...(message.reasoning_details?{reasoning_details:message.reasoning_details}:{})});
    for(const call of message.tool_calls){
      taskSignal.throwIfAborted();let result:string;
      try{
        if(call.function?.name!=='run_command')throw new Error('Unknown tool');
        const args=JSON.parse(call.function.arguments);
        if(typeof args.command!=='string'||args.command.length>40000)throw new Error('Invalid command');
        const workdir=path.resolve(cwd,args.cwd||'.');
        if(workdir!==cwd&&!workdir.startsWith(cwd+path.sep))throw new Error('Working directory must stay in the workspace');
        emit({type:'tool',message:`${name} command`,data:{command:args.command.slice(0,300)}});
        result=await runCommand(args.command,workdir,taskSignal);
      }catch(error){taskSignal.throwIfAborted();result=error instanceof Error?error.message:'Tool failed';}
      messages.push({role:'tool',tool_call_id:call.id,content:result});
    }
  }
  throw new RunnerError(`${name} exceeded 100 tool turns`,'failed');
}

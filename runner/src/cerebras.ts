import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { RunnerError, type AccountModel, type Event, type Job } from './cli.js';
import { executeChatApi, openRouterBody } from './openrouter.js';

const base = 'https://api.cerebras.ai/v1';
const keyFile = (home:string) => path.join(home, '.cerebras', 'auth.json');
function httpError(status:number) {
  return new RunnerError(`Cerebras API: HTTP ${status}`,status===401||status===403?'auth':status===429?'rate_limit':status>=500?'unavailable':'failed');
}
export async function readCerebrasKey(home:string):Promise<string> {
  try {
    const data=JSON.parse(await readFile(keyFile(home),'utf8'));
    if(typeof data.apiKey==='string'&&data.apiKey)return data.apiKey;
  } catch(error) {
    if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new RunnerError('Unable to read Cerebras authorization','auth');
  }
  throw new RunnerError('Connect a Cerebras API key','auth');
}
export function cerebrasModels(data:unknown):AccountModel[] {
  if(!Array.isArray(data))throw new RunnerError('Cerebras returned an invalid model directory','failed');
  return data.filter(row=>typeof row?.id==='string'&&row.id.length>0&&row.id.length<=100).map(row=>{
    const efforts=row.id==='gpt-oss-120b'?['low','medium','high']:['qwen-3.8-27b','gemma-4-31b'].includes(row.id)?['none','low','medium','high']:[];
    return {id:row.id,label:row.id,...(efforts.length?{reasoning:efforts.map(id=>({id,label:id}))}:{})};
  });
}
async function modelsWithKey(apiKey:string,signal?:AbortSignal) {
  let response:Response;
  try {
    response=await fetch(base+'/models',{headers:{Authorization:`Bearer ${apiKey}`},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
  } catch {
    if(signal?.aborted)throw signal.reason;
    throw new RunnerError('Cerebras API is unavailable','unavailable');
  }
  if(!response.ok)throw httpError(response.status);
  return cerebrasModels((await response.json() as any).data);
}
export async function fetchCerebrasModels(home:string,signal?:AbortSignal) {
  return modelsWithKey(await readCerebrasKey(home),signal);
}
export async function saveCerebrasKey(home:string,apiKey:string) {
  if(!/^[A-Za-z0-9_-]{20,512}$/.test(apiKey))throw new RunnerError('Enter a valid Cerebras API key','auth');
  await modelsWithKey(apiKey);
  await mkdir(path.dirname(keyFile(home)),{recursive:true,mode:0o700});
  const tmp=keyFile(home)+'.'+randomUUID()+'.tmp';
  await writeFile(tmp,JSON.stringify({apiKey}),{mode:0o600});
  await rename(tmp,keyFile(home));
}
export function cerebrasBody(job:Job,messages:unknown[]) {
  const {provider,reasoning,...body}=openRouterBody({...job,openRouterRouting:undefined},messages);
  if(job.reasoning&&job.reasoning!=='default'&&!['none','low','medium','high'].includes(job.reasoning))throw new RunnerError('Unsupported Cerebras reasoning effort','failed');
  return {...body,model:job.model,temperature:0.2,top_p:1,
    ...(job.reasoning&&job.reasoning!=='default'?{reasoning_effort:job.reasoning}:{})};
}
export async function executeCerebras(job:Job,home:string,cwd:string,signal:AbortSignal,emit:(e:Event)=>void) {
  if(job.model==='default'||job.model==='auto') {
    const models=await fetchCerebrasModels(home,signal);
    if(!models.length)throw new RunnerError('No Cerebras models available','unavailable');
    job={...job,model:models[0].id};
  }
  return executeChatApi(job,home,cwd,signal,emit,{name:'Cerebras',base,readKey:readCerebrasKey,body:cerebrasBody,httpError,retryEmptyAnswers:true});
}

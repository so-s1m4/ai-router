import { spawn } from 'node:child_process';
import { access, constants, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { runCodexAppServer } from './app-server.js';
import { readAgyUsage } from './agy-usage.js';
import { cliTimeoutSeconds } from './timeouts.js';
export type ProviderId='codex'|'antigravity';
export type Job={jobId:string;taskId:string;accountId:string;provider:ProviderId;sessionId:string;projectId?:string;prompt:string;originalPrompt?:string;handoffContext?:string;previousThreadId?:string;model:string;reasoning?:string;mode:'chat'|'task'};
export type Event={type:'status'|'delta'|'tool'|'usage'|'checkpoint';text?:string;message?:string;data?:Record<string,unknown>};
export type AccountModel={id:string;label:string;reasoning?:{id:string;label:string}[];defaultReasoning?:string};
export type AccountStatus={models:AccountModel[];limits?:{primary?:{usedPercent:number;windowMinutes?:number;resetAt?:string};secondary?:{usedPercent:number;windowMinutes?:number;resetAt?:string}}};
export class RunnerError extends Error {constructor(message:string,public code:string){super(message);}}
const root=path.resolve(process.env.RUNNER_DATA_DIR||'/runner-data');
export const workspaceFor=(job:Pick<Job,'projectId'|'sessionId'>)=>path.join(root,job.projectId?'projects':'workspaces',job.projectId||job.sessionId);
const bin={codex:process.env.CODEX_BIN||'codex',antigravity:process.env.AGY_BIN||'agy'};
async function exists(command:string){const paths=command.includes('/')?[command]:(process.env.PATH||'').split(path.delimiter).map(dir=>path.join(dir,command));for(const p of paths)try{await access(p,constants.X_OK);return true;}catch{}return false;}
// The runner itself is production, but agents need development dependencies
// when they run npm ci in a project workspace.
function envFor(home:string,provider:ProviderId):NodeJS.ProcessEnv{const env:NodeJS.ProcessEnv={...process.env,HOME:home};if(provider==='codex')env.CODEX_HOME=path.join(home,'.codex');delete env.NODE_ENV;for(const key of ['OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN','GOOGLE_API_KEY','GEMINI_API_KEY','ANTHROPIC_API_KEY'])delete env[key];return env;}
function classify(message:string){const s=message.toLowerCase();if(/transport channel closed|http request failed|rmcp/.test(s))return new RunnerError('Codex не смог подключиться к MCP-сервису провайдера; проверьте сеть контейнера и версию CLI','unavailable');return new RunnerError(message.slice(-700)||'CLI завершился с ошибкой',/rate.?limit|quota|too many requests|usage limit/.test(s)?'rate_limit':/auth|login|sign.in|credential/.test(s)?'auth':'failed');}
function rateLimits(value:any){
  const event=value?.type==='event_msg'&&value.payload?value.payload:value;
  const raw=event?.rate_limits||event?.rateLimits;
  if(!raw||typeof raw!=='object')return null;
  const map=(window:any)=>{
    if(!window||typeof window!=='object')return null;
    const used=Number(window.used_percent??window.usedPercent);
    if(!Number.isFinite(used))return null;
    const minutes=Number(window.window_minutes??window.windowMinutes);
    const reset=window.reset_at??window.resetAt;
    let resetAt: string|undefined;
    if(typeof reset==='number'&&Number.isFinite(reset))resetAt=new Date(reset>10_000_000_000?reset:reset*1000).toISOString();
    else if(typeof reset==='string'&&reset.trim())resetAt=reset;
    else {const seconds=Number(window.resets_in_seconds??window.resetsInSeconds);if(Number.isFinite(seconds))resetAt=new Date(Date.now()+seconds*1000).toISOString();}
    return {usedPercent:used,windowMinutes:Number.isFinite(minutes)?minutes:undefined,resetAt};
  };
  const primary=map(raw.primary||raw.primary_window||raw.primaryWindow),secondary=map(raw.secondary||raw.secondary_window||raw.secondaryWindow);
  return primary||secondary?{primary,secondary}:null;
}
function appServerWindow(window:any){
  if(!window||typeof window!=='object'||!Number.isFinite(Number(window.usedPercent)))return undefined;
  const usedPercent=Number(window.usedPercent),minutes=Number(window.windowDurationMins??window.windowMinutes),reset=Number(window.resetsAt);
  return {usedPercent,windowMinutes:Number.isFinite(minutes)?minutes:undefined,resetAt:Number.isFinite(reset)?new Date(reset>10_000_000_000?reset:reset*1000).toISOString():undefined};
}
async function appServerRequest(home:string,requests:{id:number;method:string;params?:Record<string,unknown>}[],signal:AbortSignal){
  const env=envFor(home,'codex');
  return new Promise<Record<number,any> >((resolve,reject)=>{
    const child=spawn(bin.codex,['app-server','--listen','stdio://','--disable','apps','--disable','enable_mcp_apps'],{env,stdio:['pipe','pipe','ignore']});
    const results=new Map<number,any>();let buffer='',settled=false;
    const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',stop);try{child.kill('SIGTERM');}catch{};error?reject(error):resolve(Object.fromEntries(results));};
    const stop=()=>finish(new RunnerError('Статус аккаунта не получен','unavailable'));
    const timer=setTimeout(stop,Number(process.env.USAGE_QUERY_TIMEOUT_SECONDS||15)*1000);
    const send=(message:Record<string,unknown>)=>child.stdin.write(JSON.stringify(message)+'\n');
    const expected=new Map(requests.map(r=>[r.id,r]));
    child.stdout.on('data',(data:Buffer)=>{buffer+=data.toString();let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);let value:any;try{value=JSON.parse(line);}catch{continue;}if(value.id===0){send({method:'initialized',params:{}});for(const request of requests)send(request);}else if(typeof value.id==='number'&&expected.has(value.id)){results.set(value.id,value);if(results.size===expected.size)finish();}}});
    child.on('error',error=>finish(new RunnerError(error.message,'unavailable')));
    child.on('close',code=>{if(!settled)finish(new RunnerError(`app-server завершился (${code??1})`,'unavailable'));});
    signal.addEventListener('abort',stop,{once:true});
    send({method:'initialize',id:0,params:{clientInfo:{name:'ai_router_runner',title:'AI Router Runner',version:'0.1.0'}}});
  });
}
export async function accountStatus(provider:ProviderId,home:string,signal:AbortSignal):Promise<AccountStatus>{
  if(provider!=='codex'){
    const models=[{id:'default',label:'По умолчанию аккаунта'},...(process.env.AGY_MODELS||'').split(',').map(x=>x.trim()).filter(Boolean).map(id=>({id,label:id}))];
    try { const limits=await readAgyUsage(bin.antigravity,home,envFor(home,provider),signal); return {models,...(limits?{limits}:{})}; }
    catch(error) { console.error('Antigravity usage unavailable:',error instanceof Error?error.message:error); return {models}; }
  }
  const responses=await appServerRequest(home,[{id:1,method:'account/read',params:{refreshToken:true}},{id:2,method:'account/rateLimits/read'},{id:3,method:'model/list',params:{limit:100,includeHidden:false}}],signal);
  if(responses[2]?.error)throw new RunnerError(String(responses[2].error.message||'Не удалось получить лимит аккаунта'),'unavailable');
  const rate=responses[2]?.result?.rateLimits||responses[2]?.result?.rate_limits;
  const models=Array.isArray(responses[3]?.result?.data)?responses[3].result.data.filter((m:any)=>typeof (m?.model||m?.id)==='string').map((m:any)=>({id:String(m.model||m.id),label:String(m.displayName||m.model||m.id),reasoning:Array.isArray(m.supportedReasoningEfforts)?m.supportedReasoningEfforts.filter((r:any)=>typeof r?.reasoningEffort==='string').map((r:any)=>({id:String(r.reasoningEffort),label:String(r.reasoningEffort)})):undefined,defaultReasoning:typeof m.defaultReasoningEffort==='string'?m.defaultReasoningEffort:undefined})):[];
  return {models:[{id:'default',label:'По умолчанию аккаунта'},...models.filter((m:AccountModel)=>m.id!=='default')],limits:{primary:appServerWindow(rate?.primary),secondary:appServerWindow(rate?.secondary)}};
}
async function runJson(command:string,args:string[],cwd:string,home:string,provider:ProviderId,signal:AbortSignal,onJson:(v:Record<string,any>)=>void,mode:Job['mode']){
 if(signal.aborted)throw new RunnerError('Остановлено','canceled');
 return new Promise<{code:number;stderr:string;timedOut:boolean}>((resolve,reject)=>{
  const child=spawn(command,args,{cwd,env:envFor(home,provider),stdio:['ignore','pipe','pipe'],detached:true});
  let buffer='',stderr='',settled=false,timedOut=false;
  const stop=()=>{if(child.pid){try{process.kill(-child.pid,'SIGTERM');}catch{child.kill('SIGTERM');}setTimeout(()=>{try{process.kill(-child.pid!,'SIGKILL');}catch{}},5000).unref();}};
  const timer=setTimeout(()=>{timedOut=true;stop();},cliTimeoutSeconds(mode)*1000);
  signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();
  child.stdout.on('data',(data:Buffer)=>{buffer+=data.toString();let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{onJson(JSON.parse(line));}catch{}}});
  child.stderr.on('data',(data:Buffer)=>{stderr=(stderr+data.toString()).slice(-8000);});
  child.on('error',err=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',stop);reject(new RunnerError(err.message,'unavailable'));});
  child.on('close',code=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',stop);if(buffer.trim())try{onJson(JSON.parse(buffer));}catch{}resolve({code:code??1,stderr,timedOut});});
 });
}
async function codexAuth(home:string){return new Promise<boolean>(resolve=>{const p=spawn(bin.codex,['login','status'],{env:envFor(home,'codex'),stdio:'ignore'});const timer=setTimeout(()=>{p.kill();resolve(false);},5000);p.on('error',()=>{clearTimeout(timer);resolve(false);});p.on('close',code=>{clearTimeout(timer);resolve(code===0);});});}
export async function execute(job:Job,signal:AbortSignal,emit:(e:Event)=>void):Promise<string>{if(signal.aborted)throw new RunnerError('Остановлено','canceled');const home=path.join(root,'accounts',job.accountId,'home'),cwd=workspaceFor(job);await mkdir(home,{recursive:true,mode:0o700});await mkdir(cwd,{recursive:true,mode:0o700});if(signal.aborted)throw new RunnerError('Остановлено','canceled');const command=bin[job.provider];if(!await exists(command)){if(process.env.MOCK_MODE==='false')throw new RunnerError('CLI не установлен','unavailable');const text=`Демо-ответ (${job.provider}): «${job.prompt.slice(0,300)}». Установите CLI в контейнере исполнителя и войдите в аккаунт для реального ответа.`;emit({type:'status',message:'Демо-режим: CLI не установлен'});for(const chunk of text.match(/.{1,24}/gu)||[text]){if(signal.aborted)throw new RunnerError('Остановлено','canceled');emit({type:'delta',text:chunk});await new Promise(r=>setTimeout(r,35));}return text;}
 if(job.provider==='codex'){if(!await codexAuth(home))throw new RunnerError('Требуется вход через codex login','auth');if(signal.aborted)throw new RunnerError('Остановлено','canceled');if(process.env.CODEX_APP_SERVER_MODE!=='false'){const result=await runCodexAppServer(job,home,cwd,signal,emit,job.previousThreadId);return result.text;}
 let text='',failure='',providerLimit=false;const args=['exec','--json','--ignore-user-config','--disable','apps','--disable','enable_mcp_apps','--skip-git-repo-check','--sandbox',job.mode==='task'?(process.env.CODEX_TASK_SANDBOX==='workspace-write'?'workspace-write':'danger-full-access'):'read-only'];if(job.model!=='default')args.push('--model',job.model);if(job.reasoning&&job.reasoning!=='default')args.push('-c',`model_reasoning_effort=\"${job.reasoning}\"`);args.push(job.prompt);const result=await runJson(command,args,cwd,home,'codex',signal,j=>{const limits=rateLimits(j);if(limits){emit({type:'usage',data:{limits}});providerLimit=Boolean(limits.primary?.usedPercent!==undefined&&limits.primary.usedPercent>=100||limits.secondary?.usedPercent!==undefined&&limits.secondary.usedPercent>=100);}const candidate=j.error?.message||j.error||j.message||j.payload?.message||j.payload?.error?.message;if(typeof candidate==='string'&&candidate.trim())failure=candidate;if(j.type==='turn.failed'||j.type==='error')failure=failure||String(j.reason||j.status||'Провайдер завершил запрос с ошибкой');if(j.type==='item.completed'&&j.item?.type==='agent_message'&&typeof j.item.text==='string'){text=j.item.text;emit({type:'delta',text});}else if(j.type==='item.started'&&j.item?.type==='command_execution')emit({type:'tool',message:'Команда CLI',data:{command:String(j.item.command||'').slice(0,300)}});else if(j.type==='turn.completed'&&j.usage)emit({type:'usage',data:j.usage});},job.mode);if(signal.aborted)throw new RunnerError('Остановлено','canceled');if(result.timedOut)throw new RunnerError('Время выполнения задачи истекло','timeout');if(result.code!==0||!text.trim())throw classify(providerLimit?'usage limit':result.stderr||failure||'CLI не вернул ответ');return text;}
 let text='',streamed='',status='',failure='';const args=['-p',job.prompt,'--output-format','stream-json','--mode',job.mode==='task'?'accept-edits':'plan'];if(job.mode==='task')args.push('--dangerously-skip-permissions');if(job.model!=='default')args.push('--model',job.model);const result=await runJson(command,args,cwd,home,'antigravity',signal,j=>{if(j.event==='step_update'){const step=j.step_update||{};if(step.step_type==='tool')emit({type:'tool',message:String(step.tool_name||'Инструмент'),data:{state:step.state}});if(step.step_type==='agent_response'&&typeof step.text_delta==='string'){streamed+=step.text_delta;emit({type:'delta',text:step.text_delta});}}else if(j.event==='result'){const r=j.result||j;text=String(r.response||'');status=String(r.status||'');failure=String(r.error||'');if(text&&!streamed)emit({type:'delta',text});if(r.usage)emit({type:'usage',data:r.usage});}},job.mode);if(signal.aborted)throw new RunnerError('Остановлено','canceled');if(result.timedOut)throw new RunnerError('Время выполнения задачи истекло','timeout');if(result.code!==0||status&&status!=='SUCCESS'||!text.trim())throw classify(result.stderr||failure||status||'CLI не вернул ответ');return text;
}

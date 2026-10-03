import type { CccAutoSettings } from './ccc-settings.js';
import type { PersonalMcp } from './personal-mcp.js';
import { randomUUID } from 'node:crypto';
import type { Namespace } from 'socket.io';
import { z } from 'zod';
import { runnerSocket } from './runners.js';
import type { AIEventType, ProviderId } from './types.js';
export interface RunnerEvent {jobId:string;type:AIEventType;text?:string;message?:string;data?:Record<string,unknown>}
export interface RunnerResult {jobId:string;ok:boolean;text?:string;error?:string;code?:string}
export class JobError extends Error {constructor(message:string,public code:string){super(message);}}
const pending=new Map<string,{runnerId:string;taskId:string;resolve:(text:string)=>void;reject:(e:Error)=>void;onEvent:(e:RunnerEvent)=>void;timer:NodeJS.Timeout}>();
function timeoutSeconds(mode:'chat'|'task') { const fallback=mode==='task'?3600:180,key=mode==='task'?'CLI_TASK_TIMEOUT_SECONDS':'CLI_TIMEOUT_SECONDS',configured=Number(process.env[key]);return Number.isFinite(configured)&&configured>0?Math.min(configured,86400):fallback; }
function settle(jobId:string,result:RunnerResult){const job=pending.get(jobId);if(!job)return;pending.delete(jobId);clearTimeout(job.timer);if(result.ok&&typeof result.text==='string')job.resolve(result.text);else job.reject(new JobError(result.error||'runner error',result.code||'failed'));}
export function attachJobHandlers(namespace:Namespace){namespace.on('connection',socket=>{const runnerId=socket.data.runnerId as string;
 socket.on('job:event',(raw:unknown)=>{const p=z.object({jobId:z.string().uuid(),type:z.enum(['status','delta','tool','usage','checkpoint']),text:z.string().max(200000).optional(),message:z.string().max(1000).optional(),data:z.record(z.unknown()).optional()}).safeParse(raw);if(!p.success)return;const job=pending.get(p.data.jobId);if(job?.runnerId===runnerId)job.onEvent(p.data);});
 socket.on('job:result',(raw:unknown)=>{const p=z.object({jobId:z.string().uuid(),ok:z.boolean(),text:z.string().max(500000).optional(),error:z.string().max(2000).optional(),code:z.string().max(40).optional()}).safeParse(raw);if(!p.success)return;const job=pending.get(p.data.jobId);if(job?.runnerId===runnerId)settle(p.data.jobId,p.data);});
 socket.on('disconnect',()=>{for(const [id,job] of pending)if(job.runnerId===runnerId)settle(id,{jobId:id,ok:false,error:'The runner has disconnected',code:'unavailable'});});
 });}
export function dispatch(runnerId:string,payload:{cccAuto?:CccAutoSettings;personalMcp?:PersonalMcp[];sharedExecution?:boolean;continuationOf?:string;taskId:string;accountId:string;provider:ProviderId;sessionId:string;projectId?:string;prompt:string;model:string;reasoning?:string;fast?:boolean;workflow?:'standard'|'ccc-auto';mode:'chat'|'task'},signal:AbortSignal,onEvent:(e:RunnerEvent)=>void):Promise<string>{if(signal.aborted)return Promise.reject(new JobError('Stopped by user','canceled'));const socket=runnerSocket(runnerId);if(!socket)return Promise.reject(new JobError('The runner is offline','unavailable'));const jobId=randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.emit('job:cancel',{jobId});settle(jobId,{jobId,ok:false,error:'Timed out',code:'timeout'});},(timeoutSeconds(payload.mode)+15)*1000);pending.set(jobId,{runnerId,taskId:payload.taskId,resolve,reject,onEvent,timer});signal.addEventListener('abort',()=>{socket.emit('job:cancel',{jobId});settle(jobId,{jobId,ok:false,error:'Stopped by user',code:'canceled'});},{once:true});socket.emit('job:start',{jobId,...payload},(ack:{ok:boolean;error?:string})=>{if(!ack?.ok)settle(jobId,{jobId,ok:false,error:ack?.error||'The runner rejected the task',code:'unavailable'});});});}

export async function steerJob(taskId:string,text:string){
 const entry=[...pending.entries()].find(([,job])=>job.taskId===taskId);
 if(!entry)throw new JobError('The task is not yet ready for clarification or has already been completed','unavailable');
 const [jobId,job]=entry,socket=runnerSocket(job.runnerId);
 if(!socket)throw new JobError('The runner is offline','unavailable');
 const reply=await socket.timeout(35000).emitWithAck('job:steer',{jobId,text});
 if(!reply?.ok)throw new JobError(reply?.error||'Runner does not support steering. Update runner.','unavailable');
}

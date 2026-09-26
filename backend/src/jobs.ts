import { randomUUID } from 'node:crypto';
import type { Namespace } from 'socket.io';
import { z } from 'zod';
import { runnerSocket } from './runners.js';
import type { AIEventType, ProviderId } from './types.js';
export interface RunnerEvent {jobId:string;type:AIEventType;text?:string;message?:string;data?:Record<string,unknown>}
export interface RunnerResult {jobId:string;ok:boolean;text?:string;error?:string;code?:string}
export class JobError extends Error {constructor(message:string,public code:string){super(message);}}
const pending=new Map<string,{runnerId:string;resolve:(text:string)=>void;reject:(e:Error)=>void;onEvent:(e:RunnerEvent)=>void;timer:NodeJS.Timeout}>();
function settle(jobId:string,result:RunnerResult){const job=pending.get(jobId);if(!job)return;pending.delete(jobId);clearTimeout(job.timer);if(result.ok&&typeof result.text==='string')job.resolve(result.text);else job.reject(new JobError(result.error||'Ошибка исполнителя',result.code||'failed'));}
export function attachJobHandlers(namespace:Namespace){namespace.on('connection',socket=>{const runnerId=socket.data.runnerId as string;
 socket.on('job:event',(raw:unknown)=>{const p=z.object({jobId:z.string().uuid(),type:z.enum(['status','delta','tool','usage','checkpoint']),text:z.string().max(200000).optional(),message:z.string().max(1000).optional(),data:z.record(z.unknown()).optional()}).safeParse(raw);if(!p.success)return;const job=pending.get(p.data.jobId);if(job?.runnerId===runnerId)job.onEvent(p.data);});
 socket.on('job:result',(raw:unknown)=>{const p=z.object({jobId:z.string().uuid(),ok:z.boolean(),text:z.string().max(500000).optional(),error:z.string().max(2000).optional(),code:z.string().max(40).optional()}).safeParse(raw);if(!p.success)return;const job=pending.get(p.data.jobId);if(job?.runnerId===runnerId)settle(p.data.jobId,p.data);});
 socket.on('disconnect',()=>{for(const [id,job] of pending)if(job.runnerId===runnerId)settle(id,{jobId:id,ok:false,error:'Исполнитель отключился',code:'unavailable'});});
 });}
export function dispatch(runnerId:string,payload:{taskId:string;accountId:string;provider:ProviderId;sessionId:string;projectId?:string;prompt:string;model:string;reasoning?:string;mode:'chat'|'task'},signal:AbortSignal,onEvent:(e:RunnerEvent)=>void):Promise<string>{const socket=runnerSocket(runnerId);if(!socket)return Promise.reject(new JobError('Исполнитель не в сети','unavailable'));const jobId=randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.emit('job:cancel',{jobId});settle(jobId,{jobId,ok:false,error:'Время ожидания истекло',code:'timeout'});},(Number(process.env.CLI_TIMEOUT_SECONDS||180)+15)*1000);pending.set(jobId,{runnerId,resolve,reject,onEvent,timer});signal.addEventListener('abort',()=>{socket.emit('job:cancel',{jobId});settle(jobId,{jobId,ok:false,error:'Остановлено пользователем',code:'canceled'});},{once:true});socket.emit('job:start',{jobId,...payload},(ack:{ok:boolean;error?:string})=>{if(!ack?.ok)settle(jobId,{jobId,ok:false,error:ack?.error||'Исполнитель отклонил задачу',code:'unavailable'});});});}

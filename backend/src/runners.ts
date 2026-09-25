import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Socket } from 'socket.io';
import { dataRoot } from './store.js';
export interface RunnerRecord {id:string;userId:string;name:string;secretHash:string;createdAt:string;revokedAt?:string;}
interface Pairing {hash:string;userId:string;name:string;expiresAt:number;}
const file=path.join(dataRoot,'runners.json'),pairingFile=path.join(dataRoot,'pairings.json');const connected=new Map<string,Socket>();
let queue=Promise.resolve();
const sha=(x:string)=>createHash('sha256').update(x).digest('hex');
async function read():Promise<RunnerRecord[]>{try{return JSON.parse(await readFile(file,'utf8')) as RunnerRecord[];}catch{return [];}}
async function write(records:RunnerRecord[]){await mkdir(dataRoot,{recursive:true,mode:0o700});await writeFile(file+'.tmp',JSON.stringify(records,null,2),{mode:0o600});await rename(file+'.tmp',file);}
async function readPairings():Promise<Pairing[]>{try{return JSON.parse(await readFile(pairingFile,'utf8')) as Pairing[];}catch{return [];}}
async function writePairings(records:Pairing[]){await mkdir(dataRoot,{recursive:true,mode:0o700});await writeFile(pairingFile+'.tmp',JSON.stringify(records),{mode:0o600});await rename(pairingFile+'.tmp',pairingFile);}
export function createPairing(userId:string,name:string):Promise<{code:string;expiresAt:string}>{const task=queue.then(async()=>{const code=randomBytes(24).toString('base64url'),expiresAt=Date.now()+10*60_000;const records=(await readPairings()).filter(x=>x.expiresAt>Date.now());records.push({hash:sha(code),userId,name,expiresAt});await writePairings(records);return {code,expiresAt:new Date(expiresAt).toISOString()};});queue=task.then(()=>undefined,()=>undefined);return task;}
export function enroll(code:string):Promise<{id:string;secret:string;name:string}>{const task=queue.then(async()=>{const records=await readPairings(),key=sha(code),pairing=records.find(x=>x.hash===key&&x.expiresAt>Date.now());if(!pairing)throw new Error('Код привязки недействителен или истёк');await writePairings(records.filter(x=>x.hash!==key&&x.expiresAt>Date.now()));const secret=randomBytes(32).toString('base64url'),id=randomUUID();const runners=await read();runners.push({id,userId:pairing.userId,name:pairing.name,secretHash:sha(secret),createdAt:new Date().toISOString()});await write(runners);return {id,secret,name:pairing.name};});queue=task.then(()=>undefined,()=>undefined);return task;}
export async function verifyRunner(id:string,secret:string):Promise<RunnerRecord|null>{const record=(await read()).find(r=>r.id===id&&!r.revokedAt);if(!record)return null;const a=Buffer.from(record.secretHash,'hex'),b=Buffer.from(sha(secret),'hex');return timingSafeEqual(a,b)?record:null;}
export async function listRunners(userId:string){return (await read()).filter(r=>r.userId===userId).map(({secretHash,...r})=>({...r,online:!!connected.get(r.id)?.connected}));}
export async function ownsRunner(userId:string,id:string){return (await read()).some(r=>r.id===id&&r.userId===userId&&!r.revokedAt);}
export function setConnected(id:string,socket:Socket){connected.get(id)?.disconnect(true);connected.set(id,socket);socket.on('disconnect',()=>{if(connected.get(id)===socket)connected.delete(id);});}
export function runnerSocket(id:string){const s=connected.get(id);return s?.connected?s:null;}
export function revokeRunner(userId:string,id:string):Promise<boolean>{const task=queue.then(async()=>{const records=await read();const record=records.find(r=>r.id===id&&r.userId===userId&&!r.revokedAt);if(!record)return false;record.revokedAt=new Date().toISOString();await write(records);connected.get(id)?.disconnect(true);return true;});queue=task.then(()=>undefined,()=>undefined);return task;}

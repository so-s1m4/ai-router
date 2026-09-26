import { randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import type { ServerResponse } from 'node:http';
import { runnerSocket } from './runners.js';
import { dataRoot } from './store.js';

type Scope={sessionId:string;projectId?:string};
type FileRow={name:string;size:number;modified:string};
type Share={token:string;runnerId:string;userId:string;scope:Scope;name:string;size:number;modified:number;expiresAt:string};
const directory=path.join(dataRoot,'file-shares');
const tokenPattern=/^[A-Za-z0-9_-]{48}$/;
const MAX_SIZE=100*1024*1024;
const CHUNK=256*1024;
function socketFor(runnerId:string){const socket=runnerSocket(runnerId);if(!socket)throw new Error('Исполнитель не в сети');return socket;}
async function ask(runnerId:string,event:string,input:object):Promise<any>{
 try{const answer=await socketFor(runnerId).timeout(15000).emitWithAck(event,input);if(!answer?.ok)throw new Error(answer?.error||'Исполнитель не ответил');return answer;}
 catch(error){if(error instanceof Error&&/timed out/i.test(error.message))throw new Error('Исполнитель не ответил. Обновите его до версии с файловым обменом.');throw new Error(error instanceof Error?error.message:'Исполнитель не ответил');}
}
export async function listWorkspaceFiles(runnerId:string,scope:Scope):Promise<FileRow[]>{
 const reply=await ask(runnerId,'file:list',scope);
 return Array.isArray(reply.files)?reply.files.filter((row:unknown)=>{
  const file=row as FileRow;return typeof file?.name==='string'&&typeof file.size==='number'&&typeof file.modified==='string';
 }):[];
}
export async function createFileShare(userId:string,runnerId:string,scope:Scope,name:string){
 const info=await ask(runnerId,'file:info',{...scope,name});
 if(!Number.isSafeInteger(info.size)||info.size<0||info.size>MAX_SIZE||!Number.isFinite(info.modified))throw new Error('Файл недоступен');
 const token=randomBytes(36).toString('base64url');
 const share:Share={token,runnerId,userId,scope,name,size:info.size,modified:info.modified,expiresAt:new Date(Date.now()+7*86400000).toISOString()};
 await mkdir(directory,{recursive:true,mode:0o700});
 await writeFile(path.join(directory,token+'.json'),JSON.stringify(share),{mode:0o600,flag:'wx'});
 return {url:`/api/files/${token}`,expiresAt:share.expiresAt};
}
export async function downloadSharedFile(token:string,response:ServerResponse):Promise<void>{
 if(!tokenPattern.test(token)){response.writeHead(404).end();return;}
 let share:Share;
 try{share=JSON.parse(await readFile(path.join(directory,token+'.json'),'utf8')) as Share;}catch{response.writeHead(404).end();return;}
 if(share.token!==token||Date.parse(share.expiresAt)<=Date.now()){
  if(share.token===token)void unlink(path.join(directory,token+'.json')).catch(()=>{});
  response.writeHead(404).end();return;
 }
 try{
  const info=await ask(share.runnerId,'file:info',{...share.scope,name:share.name});
  if(info.size!==share.size||info.modified!==share.modified)throw new Error('Файл изменился после создания ссылки');
 }catch(error){response.writeHead(503,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}).end(error instanceof Error?error.message:'Файл недоступен');return;}
 const filename=path.basename(share.name).replace(/[\r\n"\\]/g,'_');
 response.setHeader('Content-Type','application/octet-stream');
 response.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
 response.setHeader('Cache-Control','no-store');
 response.setHeader('Referrer-Policy','no-referrer');
 response.setHeader('X-Content-Type-Options','nosniff');
 response.setHeader('Content-Length',String(share.size));
 try{
  for(let offset=0;offset<share.size;offset+=CHUNK){
   if(response.destroyed)return;
   const reply=await ask(share.runnerId,'file:chunk',{...share.scope,name:share.name,offset,modified:share.modified});
   const bytes=Buffer.isBuffer(reply.data)?reply.data:reply.data instanceof Uint8Array?Buffer.from(reply.data):null;
   if(!bytes||bytes.length!==Math.min(CHUNK,share.size-offset))throw new Error('Неполный файл');
   if(!response.write(bytes))await once(response,'drain');
  }
  response.end();
 }catch(error){if(response.headersSent)response.destroy();else{response.removeHeader('Content-Length');response.statusCode=503;response.end(error instanceof Error?error.message:'Файл недоступен');}}
}

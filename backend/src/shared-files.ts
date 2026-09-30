import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
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
const sourceDirectories=new Set(['backend','frontend','runner','src','test','tests','scripts','ops','dist','build','coverage','node_modules']);
const artifactDirectories=new Set(['input','inputs','output','outputs','uploads','downloads','attachments','artifacts','results']);
const serviceFile=/^(?:README(?:\.[^/]+)?|LICENSE(?:\.[^/]+)?|Dockerfile(?:\.[^/]+)?|Makefile|compose(?:\.[^/]+)?\.ya?ml|docker-compose(?:\.[^/]+)?\.ya?ml|package(?:-lock)?\.json|tsconfig(?:\.[^/]+)?\.json|yarn\.lock|pnpm-lock\.yaml)$/i;
export function visibleWorkspaceFile(name:string):boolean{
 const parts=name.split('/');
 if(parts.some(part=>!part||part.startsWith('.')||part.includes('\\')||part.includes('\0')))return false;
 if(artifactDirectories.has(parts[0]))return true;
 return !parts.some(part=>sourceDirectories.has(part)||serviceFile.test(part));
}
function requireVisibleFile(name:string){
 if(!visibleWorkspaceFile(name))throw new Error('Исходники и служебные файлы недоступны в разделе «Файлы»');
}

function socketFor(runnerId:string){const socket=runnerSocket(runnerId);if(!socket)throw new Error('Исполнитель не в сети');return socket;}
async function ask(runnerId:string,event:string,input:object):Promise<any>{
 try{const answer=await socketFor(runnerId).timeout(15000).emitWithAck(event,input);if(!answer?.ok)throw new Error(answer?.error||'Исполнитель не ответил');return answer;}
 catch(error){if(error instanceof Error&&/timed out/i.test(error.message))throw new Error('Исполнитель не ответил. Обновите его до версии с файловым обменом.');throw new Error(error instanceof Error?error.message:'Исполнитель не ответил');}
}
export async function listWorkspaceFiles(runnerId:string,scope:Scope):Promise<FileRow[]>{
 const reply=await ask(runnerId,'file:list',scope);
 return Array.isArray(reply.files)?reply.files.filter((row:unknown)=>{
  const file=row as FileRow;return typeof file?.name==='string'&&typeof file.size==='number'&&typeof file.modified==='string'&&visibleWorkspaceFile(file.name);
 }):[];
}
export async function deleteWorkspaceFile(runnerId:string,scope:Scope,name:string){
 requireVisibleFile(name);
 await ask(runnerId,'file:delete',{...scope,name});
 const entries=await readdir(directory).catch(()=>[]);
 await Promise.all(entries.filter(entry=>tokenPattern.test(entry.replace(/\.json$/, ''))).map(async entry=>{
  const file=path.join(directory,entry);
  try{const share=JSON.parse(await readFile(file,'utf8')) as Share;
   if(share.runnerId===runnerId && share.name===name && (scope.projectId?share.scope.projectId===scope.projectId:!share.scope.projectId&&share.scope.sessionId===scope.sessionId))await unlink(file);
  }catch{}
 }));
}
export async function getWorkspaceGitSummary(runnerId:string,scope:Scope):Promise<any>{
 try{
  const reply=await ask(runnerId,'workspace:git-summary',scope);
  return reply?.ok?reply.summary:null;
 }catch{
  return null;
 }
}
export async function createFileShare(userId:string,runnerId:string,scope:Scope,name:string){
 requireVisibleFile(name);
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
  requireVisibleFile(share.name);
  const info=await ask(share.runnerId,'file:info',{...share.scope,name:share.name});
  if(info.size!==share.size||info.modified!==share.modified)throw new Error('Файл изменился после создания ссылки');
 }catch(error){response.writeHead(503,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}).end(error instanceof Error?error.message:'Файл недоступен');return;}
 const filename=path.basename(share.name).replace(/[\r\n"\\]/g,'_');
 response.setHeader('Content-Type','application/octet-stream');
 response.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase())}`);
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

export function previewMime(name:string):string|undefined {
 const ext=path.extname(name).toLowerCase();
 const images:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.avif':'image/avif'};
 if(images[ext])return images[ext];
 if(ext==='.pdf')return 'application/pdf';
 if(['.txt','.md','.json','.js','.mjs','.cjs','.ts','.tsx','.jsx','.py','.css','.scss','.html','.xml','.csv','.yaml','.yml','.toml','.sh','.sql','.go','.rs','.java','.c','.cpp','.h','.log','.svg','.ini'].includes(ext)||['Dockerfile','Makefile','LICENSE'].includes(path.basename(name)))return 'text/plain; charset=utf-8';
 return undefined;
}
export async function readWorkspacePreview(runnerId:string,scope:Scope,name:string){
 const mime=previewMime(name);if(!mime)throw new Error('Для этого формата доступно скачивание');
 requireVisibleFile(name);
 const info=await ask(runnerId,'file:info',{...scope,name});
 const limit=mime.startsWith('text/')?1024*1024:10*1024*1024;
 if(!Number.isSafeInteger(info.size)||info.size<0||info.size>limit||!Number.isFinite(info.modified))throw new Error('Файл слишком большой для просмотра');
 const chunks:Buffer[]=[];
 for(let offset=0;offset<info.size;offset+=CHUNK){
  const reply=await ask(runnerId,'file:chunk',{...scope,name,offset,modified:info.modified});
  const bytes=Buffer.isBuffer(reply.data)?reply.data:reply.data instanceof Uint8Array?Buffer.from(reply.data):null;
  if(!bytes||bytes.length!==Math.min(CHUNK,info.size-offset))throw new Error('Неполный файл');chunks.push(bytes);
 }
 return {mime,bytes:Buffer.concat(chunks)};
}

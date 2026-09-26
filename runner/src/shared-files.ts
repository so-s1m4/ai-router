import { open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Socket } from 'socket.io-client';
import { z } from 'zod';

const root=path.resolve(process.env.RUNNER_DATA_DIR||'/runner-data');
const request=z.object({sessionId:z.string().uuid(),projectId:z.string().uuid().optional()});
const fileRequest=request.extend({name:z.string().min(1).max(500)});
const forbidden=new Set(['node_modules','.git','.ai-router','.env','.next','.angular']);
const MAX_SIZE=100*1024*1024;
const CHUNK=256*1024;
function allowed(name:string){return name!=='.'&&name!=='..'&&!name.startsWith('.')&&!forbidden.has(name)&&!name.includes('\\')&&!name.includes('\0');}
function base(input:z.infer<typeof request>){return path.join(root,input.projectId?'projects':'workspaces',input.projectId||input.sessionId);}
async function checked(input:z.infer<typeof fileRequest>){
 const parts=input.name.split('/');
 if(!parts.length||parts.some(part=>!allowed(part)))throw new Error('Недопустимый путь');
 const directory=base(input),target=path.resolve(directory,...parts);
 if(!target.startsWith(directory+path.sep))throw new Error('Недопустимый путь');
 const actual=await realpath(target),actualRoot=await realpath(directory);
 if(!actual.startsWith(actualRoot+path.sep))throw new Error('Файл вне рабочего каталога');
 if(actual!==path.join(actualRoot,...parts))throw new Error('Ссылки на файлы недоступны');
 const info=await stat(actual);
 if(!info.isFile()||info.size>MAX_SIZE)throw new Error('Файл недоступен или больше 100 МБ');
 return {actual,size:info.size,modified:info.mtimeMs};
}
export function attachSharedFiles(socket:Socket){
 socket.on('file:list',async(raw:unknown,ack?:(value:unknown)=>void)=>{
  const parsed=request.safeParse(raw);if(!parsed.success)return ack?.({ok:false,error:'Неверная задача'});
  const directory=base(parsed.data),files:{name:string;size:number;modified:string}[]=[];
  const walk=async(dir:string,prefix:string,depth:number):Promise<void>=>{
   if(depth>5||files.length>=500)return;
   for(const entry of await readdir(dir,{withFileTypes:true})){
    if(!allowed(entry.name)||entry.isSymbolicLink())continue;
    const name=prefix?prefix+'/'+entry.name:entry.name,full=path.join(dir,entry.name);
    if(entry.isDirectory())await walk(full,name,depth+1);
    else if(entry.isFile()){const info=await stat(full);if(info.size<=MAX_SIZE)files.push({name,size:info.size,modified:info.mtime.toISOString()});}
    if(files.length>=500)break;
   }
  };
  try{await walk(directory,'',0);ack?.({ok:true,files});}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')ack?.({ok:true,files:[]});else ack?.({ok:false,error:error instanceof Error?error.message:'Не удалось получить файлы'});}
 });
 socket.on('file:info',async(raw:unknown,ack?:(value:unknown)=>void)=>{
  const parsed=fileRequest.safeParse(raw);if(!parsed.success)return ack?.({ok:false,error:'Неверный файл'});
  try{const file=await checked(parsed.data);ack?.({ok:true,size:file.size,modified:file.modified});}catch(error){ack?.({ok:false,error:error instanceof Error?error.message:'Файл недоступен'});}
 });
 socket.on('file:chunk',async(raw:unknown,ack?:(value:unknown)=>void)=>{
  const parsed=fileRequest.extend({offset:z.number().int().nonnegative(),modified:z.number()}).safeParse(raw);
  if(!parsed.success)return ack?.({ok:false,error:'Неверный запрос'});
  try{
   const file=await checked(parsed.data);
   if(file.modified!==parsed.data.modified||parsed.data.offset>file.size)throw new Error('Файл изменился после создания ссылки');
   const handle=await open(file.actual,'r');
   try{const buffer=Buffer.allocUnsafe(Math.min(CHUNK,file.size-parsed.data.offset));const {bytesRead}=await handle.read(buffer,0,buffer.length,parsed.data.offset);ack?.({ok:true,data:buffer.subarray(0,bytesRead)});}
   finally{await handle.close();}
  }catch(error){ack?.({ok:false,error:error instanceof Error?error.message:'Не удалось прочитать файл'});}
 });
}

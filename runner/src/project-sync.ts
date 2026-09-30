import { constants } from 'node:fs';
import { mkdir, readdir, open, realpath, lstat, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { Socket } from 'socket.io-client';
import { z } from 'zod';

const MAX_BYTES=64*1024*1024, MAX_ARCHIVE=96*1024*1024, CHUNK=256*1024;
const skipped=new Set(['node_modules','.ai-router','.codex','.ssh','.aws','.config','.cache','.next','.angular']);
const localOnly=(name:string)=>skipped.has(name)||/^\.env(?:\.|$)/.test(name);
function validName(name:string){return name.length<=1000&&name.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!p.includes('\\')&&!p.includes('\0')&&!localOnly(p));}
type Entry={name:string;data:string;mode:number};
export async function exportProject(directory:string,allowMissing=false):Promise<Buffer>{
 if(allowMissing)await mkdir(directory,{recursive:true,mode:0o700});
 const actual=await realpath(directory);if(actual!==directory)throw new Error('Project directory must not be a link');
 const entries:Entry[]=[];let bytes=0;
 async function walk(dir:string,prefix=''){
  for(const row of await readdir(dir,{withFileTypes:true})){
   const name=prefix+row.name;if(!validName(name))continue;
   if(row.isSymbolicLink())throw new Error('Remove symbolic links before syncing a shared project: '+name);
   if(row.isDirectory())await walk(path.join(dir,row.name),name+'/');
   else if(row.isFile()){
    const handle=await open(path.join(dir,row.name),constants.O_RDONLY|constants.O_NOFOLLOW);
    try{const info=await handle.stat();if(!info.isFile()||bytes+info.size>MAX_BYTES||entries.length>=20000)throw new Error('Shared project exceeds the 64 MB or 20,000 file sync limit');
     const data=await handle.readFile();bytes+=data.length;if(bytes>MAX_BYTES)throw new Error('Shared project exceeds 64 MB');
     entries.push({name,data:data.toString('base64'),mode:info.mode&0o777});
    }finally{await handle.close();}
   }
  }
 }
 await walk(directory);const encoded=JSON.stringify(entries);if(Buffer.byteLength(encoded)>MAX_ARCHIVE)throw new Error('Project archive metadata is too large');const archive=gzipSync(encoded);if(archive.length>MAX_ARCHIVE)throw new Error('Project archive is too large');return archive;
}
export async function importProject(directory:string,archive:Buffer){
 if(archive.length>MAX_ARCHIVE)throw new Error('Project archive is too large');
 const entries:unknown=JSON.parse(gunzipSync(archive,{maxOutputLength:MAX_ARCHIVE}).toString());
 if(!Array.isArray(entries)||entries.length>20000)throw new Error('Invalid project archive');
 const names=new Set<string>();let bytes=0;
 const files=entries.map((row:Entry)=>{
  if(!row||typeof row.name!=='string'||!validName(row.name)||names.has(row.name)||typeof row.data!=='string'||!Number.isInteger(row.mode)||row.mode<0||row.mode>0o777||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(row.data))throw new Error('Invalid project archive entry');
  names.add(row.name);const data=Buffer.from(row.data,'base64');bytes+=data.length;if(bytes>MAX_BYTES)throw new Error('Shared project exceeds 64 MB');return {...row,data};
 });
 await mkdir(path.dirname(directory),{recursive:true,mode:0o700});
 if(await realpath(path.dirname(directory))!==path.dirname(directory))throw new Error('Project parent must not be a link');
 const current=await lstat(directory).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return null;throw e;});if(current&&!current.isDirectory())throw new Error('Invalid project directory');
 const staging=directory+'-sync-'+randomUUID(),backup=directory+'-previous';
 await mkdir(staging,{mode:0o700});
 const localMoves:{from:string;to:string}[]=[];let committed=false;
 async function keepLocal(oldDir:string,newDir:string){
  for(const row of await readdir(oldDir,{withFileTypes:true})){
   const from=path.join(oldDir,row.name),to=path.join(newDir,row.name);
   if(localOnly(row.name)){await rename(from,to);localMoves.push({from,to});}
   else if(row.isDirectory()&&(await lstat(to).catch(()=>null))?.isDirectory())await keepLocal(from,to);
  }
 }
 try{
  for(const row of files){const file=path.join(staging,row.name);await mkdir(path.dirname(file),{recursive:true,mode:0o700});await writeFile(file,row.data,{mode:row.mode,flag:'wx'});}
  if(current)await keepLocal(directory,staging);
  // Keep the previous local workspace as a recovery copy, outside the active project.
  await rm(backup,{recursive:true,force:true});
  if(current)await rename(directory,backup);
  try{await rename(staging,directory);committed=true;}catch(e){if(current)await rename(backup,directory);throw e;}
 }finally{if(!committed)for(const move of localMoves.reverse())await rename(move.to,move.from);await rm(staging,{recursive:true,force:true});}
}
export function attachProjectSync(socket:Socket,root:string,isBusy:(projectId:string)=>boolean){
 const scope=z.object({projectId:z.string().uuid()});
 const transfers=new Map<string,{projectId:string;bytes:Buffer;offset:number;direction:'export'|'import';until:number}>();
 const timer=setInterval(()=>{for(const [id,t] of transfers)if(t.until<Date.now())transfers.delete(id);},30000);timer.unref();
 socket.on('disconnect',()=>transfers.clear());
 const handler=(event:string,schema:z.ZodTypeAny,fn:(input:any)=>Promise<object>)=>socket.on(event,async(raw:unknown,ack?:(reply:unknown)=>void)=>{const parsed=schema.safeParse(raw);if(!parsed.success)return ack?.({ok:false,error:'Invalid project sync request'});try{ack?.({ok:true,...await fn(parsed.data)});}catch(e){ack?.({ok:false,error:e instanceof Error?e.message:'Project sync failed'});}});
 const directory=(id:string)=>path.join(root,'projects',id);
 handler('project:export',scope.extend({allowMissing:z.boolean().default(false)}),async({projectId,allowMissing})=>{
  if(isBusy(projectId))throw new Error('Project is running');if(transfers.size>=4)throw new Error('Too many project transfers');
  const bytes=await exportProject(directory(projectId),allowMissing),transferId=randomUUID();transfers.set(transferId,{projectId,bytes,offset:0,direction:'export',until:Date.now()+120000});
  return {transferId,size:bytes.length,hash:createHash('sha256').update(bytes).digest('hex')};
 });
 handler('project:chunk',scope.extend({transferId:z.string().uuid(),offset:z.number().int().min(0)}),async({projectId,transferId,offset})=>{
  const t=transfers.get(transferId);if(!t||t.projectId!==projectId||t.direction!=='export'||offset!==t.offset)throw new Error('Invalid transfer');
  const data=t.bytes.subarray(offset,offset+CHUNK);t.offset+=data.length;t.until=Date.now()+120000;if(t.offset===t.bytes.length)transfers.delete(transferId);return {data};
 });
 handler('project:import',scope.extend({size:z.number().int().min(1).max(MAX_ARCHIVE)}),async({projectId,size})=>{
  if(isBusy(projectId))throw new Error('Project is running');if(transfers.size>=4)throw new Error('Too many project transfers');
  const transferId=randomUUID();transfers.set(transferId,{projectId,bytes:Buffer.alloc(size),offset:0,direction:'import',until:Date.now()+120000});return {transferId};
 });
 handler('project:write-chunk',scope.extend({transferId:z.string().uuid(),offset:z.number().int().min(0),data:z.any()}),async({projectId,transferId,offset,data})=>{
  const t=transfers.get(transferId),bytes=Buffer.isBuffer(data)?data:data instanceof Uint8Array?Buffer.from(data):null;
  if(!t||t.projectId!==projectId||t.direction!=='import'||offset!==t.offset||!bytes||!bytes.length||bytes.length>CHUNK||offset+bytes.length>t.bytes.length)throw new Error('Invalid transfer chunk');
  bytes.copy(t.bytes,offset);t.offset+=bytes.length;t.until=Date.now()+120000;return {};
 });
 handler('project:commit',scope.extend({transferId:z.string().uuid(),hash:z.string().regex(/^[a-f0-9]{64}$/)}),async({projectId,transferId,hash})=>{
  const t=transfers.get(transferId);if(!t||t.projectId!==projectId||t.direction!=='import'||t.offset!==t.bytes.length||createHash('sha256').update(t.bytes).digest('hex')!==hash)throw new Error('Incomplete project transfer');
  transfers.delete(transferId);if(isBusy(projectId))throw new Error('Project is running');await importProject(directory(projectId),t.bytes);return {};
 });
}

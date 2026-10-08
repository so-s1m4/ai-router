import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { runnerSocket, ownsRunner } from './runners.js';
import { dataRoot, getProject, updateSharedProject, type Project } from './store.js';

const operations=new Map<string,Promise<void>>(),activeTasks=new Map<string,number>(),CHUNK=256*1024;
export function trackProjectTask(id:string){
 activeTasks.set(id,(activeTasks.get(id)||0)+1);
 let finished=false;
 return ()=>{if(finished)return;finished=true;const remaining=(activeTasks.get(id)||1)-1;if(remaining)activeTasks.set(id,remaining);else activeTasks.delete(id);};
}
// Serialize workspace transfers and mutations, never the agent's execution.
export async function withProjectOperation<T>(id:string,operation:()=>Promise<T>):Promise<T>{
 const previous=operations.get(id)||Promise.resolve();
 let release!:()=>void;
 const current=new Promise<void>(resolve=>{release=resolve;});
 operations.set(id,current);
 await previous;
 try{return await operation();}finally{release();if(operations.get(id)===current)operations.delete(id);}
}
const snapshotFile=(id:string)=>{if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid project');return path.join(dataRoot,'project-snapshots',id+'.gz');};
async function ask(runnerId:string,event:string,payload:object){const socket=runnerSocket(runnerId);if(!socket)throw new Error('Project runner is offline');const reply=await socket.timeout(30000).emitWithAck(event,payload);if(!reply?.ok)throw new Error(reply?.error||'Project sync failed; update the runner');return reply;}
export async function projectRunnerValid(project:Project){return ownsRunner(project.runnerOwnerId||project.ownerId!,project.runnerId);}
export async function saveProjectSnapshot(userId:string,project:Project){
 if(!project.shared)return;
 return withProjectOperation(project.id,()=>saveSnapshot(userId,project));
}
async function saveSnapshot(userId:string,project:Project){
 if(!project.shared)return;
 if(!await projectRunnerValid(project))throw new Error('Project runner access was revoked');
 const file=snapshotFile(project.id),exists=await readFile(file).then(()=>true).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return false;throw e;});
 const info=await ask(project.runnerId,'project:export',{projectId:project.id,allowMissing:!exists&&!project.needsSync});
 if(!Number.isSafeInteger(info.size)||info.size<1||typeof info.transferId!=='string'||typeof info.hash!=='string')throw new Error('Invalid project snapshot');
 const chunks:Buffer[]=[];
 for(let offset=0;offset<info.size;offset+=CHUNK){const reply=await ask(project.runnerId,'project:chunk',{projectId:project.id,transferId:info.transferId,offset});const bytes=Buffer.isBuffer(reply.data)?reply.data:reply.data instanceof Uint8Array?Buffer.from(reply.data):null;if(!bytes||bytes.length!==Math.min(CHUNK,info.size-offset))throw new Error('Incomplete project snapshot');chunks.push(bytes);}
 const archive=Buffer.concat(chunks);if(createHash('sha256').update(archive).digest('hex')!==info.hash)throw new Error('Project snapshot checksum failed');
 await mkdir(path.dirname(file),{recursive:true,mode:0o700});await writeFile(file+'.tmp',archive,{mode:0o600});await rename(file+'.tmp',file);
 const needsSync=activeTasks.has(project.id);
 await updateSharedProject(userId,project.id,{runnerId:project.runnerId,runnerOwnerId:project.runnerOwnerId||project.ownerId,needsSync});project.needsSync=needsSync;
}
export async function prepareProjectRunner(userId:string,project:Project,runnerId:string,runnerOwnerId:string){
 if(!project.shared)return;
 return withProjectOperation(project.id,()=>prepareRunner(userId,project,runnerId,runnerOwnerId));
}
async function prepareRunner(userId:string,project:Project,runnerId:string,runnerOwnerId:string){
 if(!project.shared)return;
 const fresh=await getProject(userId,project.id);if(!fresh)throw new Error('Project access was removed');Object.assign(project,fresh);
 if(!await projectRunnerValid(project))throw new Error('Project runner access was revoked');
 if(project.runnerId===runnerId)return;
 if(runnerSocket(project.runnerId))await saveSnapshot(userId,project);
 else if(project.needsSync)throw new Error('Latest project changes are on an offline runner. Reconnect it before switching runners.');
 const archive=await readFile(snapshotFile(project.id)).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')throw new Error('Connect the original runner once to sync this project');throw e;});
 const hash=createHash('sha256').update(archive).digest('hex');
 const reply=await ask(runnerId,'project:import',{projectId:project.id,size:archive.length});
 for(let offset=0;offset<archive.length;offset+=CHUNK)await ask(runnerId,'project:write-chunk',{projectId:project.id,transferId:reply.transferId,offset,data:archive.subarray(offset,offset+CHUNK)});
 await ask(runnerId,'project:commit',{projectId:project.id,transferId:reply.transferId,hash});
 await updateSharedProject(userId,project.id,{runnerId,runnerOwnerId,needsSync:false});Object.assign(project,{runnerId,runnerOwnerId,needsSync:false});
}
export async function markProjectDirty(userId:string,project:Project){if(project.shared){await updateSharedProject(userId,project.id,{needsSync:true});project.needsSync=true;}}

export async function mutateProject<T>(userId:string,project:Project,operation:(current:Project)=>Promise<T>):Promise<T>{
 const mutate=async()=>{
  const fresh=await getProject(userId,project.id);
  if(!fresh)throw new Error('Project access was removed');
  if(fresh.shared&&!await projectRunnerValid(fresh))throw new Error('Project runner access was revoked');
  await markProjectDirty(userId,fresh);
  const result=await operation(fresh);
  await saveSnapshot(userId,fresh);
  return result;
 };
 return project.shared?withProjectOperation(project.id,mutate):mutate();
}

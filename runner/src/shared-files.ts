import { mkdir, open, readdir, realpath, stat, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { Socket } from 'socket.io-client';
import { z } from 'zod';

const exec = promisify(execFile);
const root=path.resolve(process.env.RUNNER_DATA_DIR||'/runner-data');
const request=z.object({sessionId:z.string().uuid(),projectId:z.string().uuid().optional()});
const fileRequest=request.extend({name:z.string().min(1).max(500)});
const forbidden=new Set(['node_modules','.git','.ai-router','.env','.next','.angular']);
const MAX_SIZE=100*1024*1024;
const CHUNK=256*1024;
function allowed(name:string){return name!=='.'&&name!=='..'&&!name.startsWith('.')&&!forbidden.has(name)&&!name.includes('\\')&&!name.includes('\0');}
function base(input:z.infer<typeof request>){return path.join(root,input.projectId?'projects':'workspaces',input.projectId||input.sessionId);}
async function checkedBase(input:z.infer<typeof request>){
 const directory=base(input);
 const expected=path.join(await realpath(root),input.projectId?'projects':'workspaces',input.projectId||input.sessionId);
 if(await realpath(directory)!==expected)throw new Error('Рабочий каталог является ссылкой');
 return directory;
}
async function checked(input:z.infer<typeof fileRequest>){
 const parts=input.name.split('/');
 if(!parts.length||parts.some(part=>!allowed(part)))throw new Error('Недопустимый путь');
 const directory=await checkedBase(input),target=path.resolve(directory,...parts);
 if(!target.startsWith(directory+path.sep))throw new Error('Недопустимый путь');
 const actual=await realpath(target),actualRoot=await realpath(directory);
 if(!actual.startsWith(actualRoot+path.sep))throw new Error('Файл вне рабочего каталога');
 if(actual!==path.join(actualRoot,...parts))throw new Error('Ссылки на файлы недоступны');
 const info=await stat(actual);
 if(!info.isFile()||info.size>MAX_SIZE)throw new Error('Файл недоступен или больше 100 МБ');
 return {actual,size:info.size,modified:info.mtimeMs};
}

export interface WorkspaceGitSummary {
  isGitRepo: boolean;
  branch?: string;
  status?: string;
  diffStat?: string;
  cachedStat?: string;
  lastLog?: string;
  diffExcerpt?: string;
  recentFiles?: { name: string; size: number; modified: string }[];
  error?: string;
}

export async function getGitSummary(directory: string): Promise<WorkspaceGitSummary> {
  try {
    const isRepo = await exec('git', ['rev-parse', '--is-inside-work-tree'], { cwd: directory, timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    if (!isRepo) {
      const recent: { name: string; size: number; modified: string }[] = [];
      const scan = async (dir: string, prefix: string, depth: number) => {
        if (depth > 3 || recent.length >= 50) return;
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          if (!allowed(entry.name) || entry.isSymbolicLink()) continue;
          const name = prefix ? prefix + '/' + entry.name : entry.name, full = path.join(dir, entry.name);
          if (entry.isDirectory()) await scan(full, name, depth + 1);
          else if (entry.isFile()) {
            const info = await stat(full).catch(() => null);
            if (info && info.size <= MAX_SIZE) recent.push({ name, size: info.size, modified: info.mtime.toISOString() });
          }
        }
      };
      await scan(directory, '', 0);
      recent.sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified));
      return { isGitRepo: false, recentFiles: recent.slice(0, 8) };
    }

    const [branch, status, diffStat, cachedStat, lastLog] = await Promise.all([
      exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: directory, timeout: 5000 }).then(r => r.stdout.trim()).catch(() => 'unknown'),
      exec('git', ['status', '--short'], { cwd: directory, timeout: 5000 }).then(r => r.stdout.trim()).catch(() => ''),
      exec('git', ['diff', '--stat'], { cwd: directory, timeout: 5000 }).then(r => r.stdout.trim()).catch(() => ''),
      exec('git', ['diff', '--cached', '--stat'], { cwd: directory, timeout: 5000 }).then(r => r.stdout.trim()).catch(() => ''),
      exec('git', ['log', '-1', '--oneline', '--stat'], { cwd: directory, timeout: 5000 }).then(r => r.stdout.trim()).catch(() => '')
    ]);

    let diffExcerpt = '';
    if (diffStat) {
      diffExcerpt = await exec('git', ['diff', '-U2'], { cwd: directory, timeout: 5000 })
        .then(r => r.stdout.slice(0, 2500).trim())
        .catch(() => '');
    } else if (!status && lastLog) {
      diffExcerpt = await exec('git', ['show', '--oneline', '-U2', 'HEAD'], { cwd: directory, timeout: 5000 })
        .then(r => r.stdout.slice(0, 2500).trim())
        .catch(() => '');
    }

    return {
      isGitRepo: true,
      branch,
      status: status.slice(0, 3000),
      diffStat: diffStat.slice(0, 2000),
      cachedStat: cachedStat.slice(0, 2000),
      lastLog: lastLog.slice(0, 2000),
      diffExcerpt
    };
  } catch (err) {
    return {
      isGitRepo: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

export function attachSharedFiles(socket:Socket){
 socket.on('file:write',async(raw:unknown,ack?:(value:unknown)=>void)=>{
  const parsed=z.object({transferId:z.string().uuid(),projectId:z.string().uuid(),name:z.string().min(1).max(180),data:z.any()}).safeParse(raw);
  if(!parsed.success)return ack?.({ok:false,error:'Неверный файл'});
  const {projectId,name,data}=parsed.data;
  const bytes=Buffer.isBuffer(data)?data:data instanceof Uint8Array?Buffer.from(data):null;
  if(!bytes||!bytes.length||bytes.length>20*1024*1024)return ack?.({ok:false,error:'Файл пустой или больше 20 МБ'});
  if(!allowed(name)||name.includes('/'))return ack?.({ok:false,error:'Недопустимое имя файла'});
  try{
   const scope={sessionId:projectId,projectId};
   await mkdir(base(scope),{recursive:true,mode:0o700});
   const directory=await checkedBase(scope);
   const extension=path.extname(name),stem=name.slice(0,name.length-extension.length);
   for(let attempt=0;attempt<1000;attempt++){
    const filename=attempt?stem+'-'+attempt+extension:name;
    let handle;
    try{handle=await open(path.join(directory,filename),'wx',0o600);}
    catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')continue;throw error;}
    try{await handle.writeFile(bytes);}finally{await handle.close();}
    return ack?.({ok:true,name:filename,size:bytes.length});
   }
   throw new Error('Слишком много файлов с таким именем');
  }catch(error){ack?.({ok:false,error:error instanceof Error?error.message:'Не удалось сохранить файл'});}
 });
 socket.on('file:list',async(raw:unknown,ack?:(value:unknown)=>void)=>{
  const parsed=request.safeParse(raw);if(!parsed.success)return ack?.({ok:false,error:'Неверная задача'});
  const files:{name:string;size:number;modified:string}[]=[];
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
  try{await walk(await checkedBase(parsed.data),'',0);ack?.({ok:true,files});}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')ack?.({ok:true,files:[]});else ack?.({ok:false,error:error instanceof Error?error.message:'Не удалось получить файлы'});}
 });
 socket.on('file:delete',async(raw:unknown,ack?:(value:unknown)=>void)=>{
  const parsed=fileRequest.safeParse(raw);if(!parsed.success)return ack?.({ok:false,error:'Неверный файл'});
  try{const file=await checked(parsed.data);await unlink(file.actual);ack?.({ok:true});}
  catch(error){ack?.({ok:false,error:error instanceof Error?error.message:'Не удалось удалить файл'});}
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
 socket.on('workspace:git-summary',async(raw:unknown,ack?:(value:unknown)=>void)=>{
  const parsed=request.safeParse(raw);if(!parsed.success)return ack?.({ok:false,error:'Неверная задача'});
  try{
   const directory=await checkedBase(parsed.data);
   const summary=await getGitSummary(directory);
   ack?.({ok:true,summary});
  }catch(error){
   ack?.({ok:false,error:error instanceof Error?error.message:'Каталог недоступен'});
  }
 });
}

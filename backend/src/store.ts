import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ChatSession, ProviderId } from './types.js';

const root = path.resolve(process.env.DATA_DIR || '/srv/data');
const safe = (id: string) => { if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('Invalid identifier'); return id; };
export const userDir = (userId: string) => path.join(root, 'users', safe(userId));
export const dataRoot = root;
export interface Account { id: string; provider: ProviderId; name: string; runnerId?: string; createdAt: string; importKey?: string; }
export interface Project { id:string; name:string; runnerId:string; createdAt:string; updatedAt:string; }
const sessionFile = (userId: string, sessionId: string) => path.join(userDir(userId), 'sessions', safe(sessionId) + '.json');
export async function prepareUser(userId: string) { await mkdir(path.join(userDir(userId),'sessions'), {recursive:true,mode:0o700}); await mkdir(path.join(userDir(userId),'projects'), {recursive:true,mode:0o700}); }
const accountsFile=(userId:string)=>path.join(userDir(userId),'accounts.json');
const accountQueues=new Map<string,Promise<void>>();
function mutateAccounts<T>(userId:string,operation:()=>Promise<T>):Promise<T>{const previous=accountQueues.get(userId)||Promise.resolve();const task=previous.then(operation);const settled=task.then(()=>undefined,()=>undefined);accountQueues.set(userId,settled);void settled.then(()=>{if(accountQueues.get(userId)===settled)accountQueues.delete(userId);});return task;}
async function saveAccounts(userId:string,accounts:Account[]){const file=accountsFile(userId);await writeFile(file+'.tmp',JSON.stringify(accounts,null,2),{mode:0o600});await rename(file+'.tmp',file);}
export async function listAccounts(userId:string):Promise<Account[]> { await prepareUser(userId); try { return JSON.parse(await readFile(accountsFile(userId),'utf8')) as Account[]; } catch { return []; } }
export function addAccount(userId:string,provider:ProviderId,name:string,runnerId:string):Promise<Account> { return mutateAccounts(userId,async()=>{const accounts=await listAccounts(userId);const account={id:randomUUID(),provider,name:name.trim().slice(0,60),runnerId,createdAt:new Date().toISOString()};accounts.push(account);await saveAccounts(userId,accounts);return account;}); }
export function addImportedCodexAccount(userId:string,name:string,runnerId:string,importKey:string):Promise<Account> { return mutateAccounts(userId,async()=>{const accounts=await listAccounts(userId);const existing=accounts.find(a=>a.provider==='codex'&&a.runnerId===runnerId&&a.importKey===importKey);if(existing)return existing;const account:Account={id:randomUUID(),provider:'codex',name:name.trim().slice(0,60),runnerId,importKey,createdAt:new Date().toISOString()};accounts.push(account);await saveAccounts(userId,accounts);return account;}); }
export function assignAccount(userId:string,accountId:string,runnerId:string):Promise<Account|null>{return mutateAccounts(userId,async()=>{const accounts=await listAccounts(userId);const account=accounts.find(a=>a.id===safe(accountId));if(!account)return null;account.runnerId=runnerId;await saveAccounts(userId,accounts);return account;});}
const projectsFile=(userId:string)=>path.join(userDir(userId),'projects.json');
const projectFile=(userId:string,id:string)=>path.join(userDir(userId),'projects',safe(id)+'.json');
export async function listProjects(userId:string):Promise<Project[]>{await prepareUser(userId);try{return JSON.parse(await readFile(projectsFile(userId),'utf8')) as Project[];}catch{return [];}}
export async function getProject(userId:string,id:string):Promise<Project|null>{try{return JSON.parse(await readFile(projectFile(userId,id),'utf8')) as Project;}catch{return null;}}
export async function createProject(userId:string,name:string,runnerId:string):Promise<Project>{await prepareUser(userId);const now=new Date().toISOString(),project:Project={id:randomUUID(),name:name.trim().slice(0,80),runnerId,createdAt:now,updatedAt:now};const projects=await listProjects(userId);projects.push(project);await writeFile(projectsFile(userId)+'.tmp',JSON.stringify(projects,null,2),{mode:0o600});await rename(projectsFile(userId)+'.tmp',projectsFile(userId));await saveProject(userId,project);return project;}
async function saveProject(userId:string,project:Project){await writeFile(projectFile(userId,project.id)+'.tmp',JSON.stringify(project,null,2),{mode:0o600});await rename(projectFile(userId,project.id)+'.tmp',projectFile(userId,project.id));}
export async function listSessions(userId: string): Promise<ChatSession[]> {
  await prepareUser(userId);
  const files = (await readdir(path.join(userDir(userId),'sessions'))).filter(x => x.endsWith('.json'));
  const sessions = await Promise.all(files.map(async f => { try { return JSON.parse(await readFile(path.join(userDir(userId),'sessions',f),'utf8')) as ChatSession; } catch { return null; } }));
  return sessions.filter((s): s is ChatSession => !!s).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function createSession(userId: string,projectId?:string): Promise<ChatSession> {
  await prepareUser(userId); const now = new Date().toISOString();
  const session: ChatSession = {id:randomUUID(),title:'Новый чат',createdAt:now,updatedAt:now,messages:[],...(projectId?{projectId}: {})};
  await saveSession(userId,session); return session;
}
export async function getSession(userId: string, id: string): Promise<ChatSession | null> { try { return JSON.parse(await readFile(sessionFile(userId,id),'utf8')) as ChatSession; } catch { return null; } }
export async function saveSession(userId: string, session: ChatSession) { const file=sessionFile(userId,session.id); await mkdir(path.dirname(file),{recursive:true,mode:0o700}); await writeFile(file+'.tmp',JSON.stringify(session,null,2),{mode:0o600}); await rename(file+'.tmp',file); }
const blacklistFile = (userId: string) => path.join(userDir(userId), 'model-blacklist.json');
export async function getUserModelBlacklist(userId: string): Promise<string[]> {
  await prepareUser(userId);
  try {
    const raw = await readFile(blacklistFile(userId), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
export async function setUserModelBlacklist(userId: string, blacklist: string[]): Promise<string[]> {
  await prepareUser(userId);
  const clean = Array.from(new Set(blacklist.filter((id): id is string => typeof id === 'string' && id.trim().length > 0 && id.length <= 100)));
  const file = blacklistFile(userId);
  await writeFile(file + '.tmp', JSON.stringify(clean, null, 2), { mode: 0o600 });
  await rename(file + '.tmp', file);
  return clean;
}

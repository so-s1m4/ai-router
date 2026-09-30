import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ChatSession, ProviderId } from './types.js';

const root = path.resolve(process.env.DATA_DIR || '/srv/data');
const safe = (id: string) => { if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('Invalid identifier'); return id; };
export const userDir = (userId: string) => path.join(root, 'users', safe(userId));
export const dataRoot = root;
export interface Account { id: string; provider: ProviderId; name: string; runnerId?: string; priority?: 0 | 1 | 2; authType?: 'api_key'; createdAt: string; importKey?: string; }
export interface Project { id:string; name:string; runnerId:string; createdAt:string; updatedAt:string; shared?:boolean; ownerId?:string; memberIds?:string[]; needsSync?:boolean; runnerOwnerId?:string; }
const sessionFile = (userId: string, sessionId: string) => path.join(userDir(userId), 'sessions', safe(sessionId) + '.json');
export async function prepareUser(userId: string) { await mkdir(path.join(userDir(userId),'sessions'), {recursive:true,mode:0o700}); await mkdir(path.join(userDir(userId),'projects'), {recursive:true,mode:0o700}); }
const accountsFile=(userId:string)=>path.join(userDir(userId),'accounts.json');
const accountQueues=new Map<string,Promise<void>>();
function mutateAccounts<T>(userId:string,operation:()=>Promise<T>):Promise<T>{const previous=accountQueues.get(userId)||Promise.resolve();const task=previous.then(operation);const settled=task.then(()=>undefined,()=>undefined);accountQueues.set(userId,settled);void settled.then(()=>{if(accountQueues.get(userId)===settled)accountQueues.delete(userId);});return task;}
async function saveAccounts(userId:string,accounts:Account[]){const file=accountsFile(userId);await writeFile(file+'.tmp',JSON.stringify(accounts,null,2),{mode:0o600});await rename(file+'.tmp',file);}
export async function listAccounts(userId:string):Promise<Account[]> { await prepareUser(userId); try { return JSON.parse(await readFile(accountsFile(userId),'utf8')) as Account[]; } catch { return []; } }
export function addAccount(userId:string,provider:ProviderId,name:string,runnerId:string,authType?:'api_key'):Promise<Account> { return mutateAccounts(userId,async()=>{const accounts=await listAccounts(userId);const account={id:randomUUID(),provider,name:name.trim().slice(0,60),runnerId,...(authType?{authType}:{}),createdAt:new Date().toISOString()};accounts.push(account);await saveAccounts(userId,accounts);return account;}); }
export function addImportedCodexAccount(userId:string,name:string,runnerId:string,importKey:string):Promise<Account> { return mutateAccounts(userId,async()=>{const accounts=await listAccounts(userId);const existing=accounts.find(a=>a.provider==='codex'&&a.runnerId===runnerId&&a.importKey===importKey);if(existing)return existing;const account:Account={id:randomUUID(),provider:'codex',name:name.trim().slice(0,60),runnerId,importKey,createdAt:new Date().toISOString()};accounts.push(account);await saveAccounts(userId,accounts);return account;}); }
export function assignAccount(userId:string,accountId:string,runnerId:string):Promise<Account|null>{return mutateAccounts(userId,async()=>{const accounts=await listAccounts(userId);const account=accounts.find(a=>a.id===safe(accountId));if(!account)return null;account.runnerId=runnerId;await saveAccounts(userId,accounts);return account;});}
export function setAccountPriority(userId:string,accountId:string,priority:0|1|2):Promise<Account|null>{return mutateAccounts(userId,async()=>{const accounts=await listAccounts(userId);const account=accounts.find(a=>a.id===safe(accountId));if(!account)return null;account.priority=priority;await saveAccounts(userId,accounts);return account;});}
export function deleteAccount(userId:string,accountId:string):Promise<Account|null>{return mutateAccounts(userId,async()=>{const accounts=await listAccounts(userId);const index=accounts.findIndex(a=>a.id===safe(accountId));if(index<0)return null;const [account]=accounts.splice(index,1);await saveAccounts(userId,accounts);return account;});}
const projectsFile=(userId:string)=>path.join(userDir(userId),'projects.json');
const projectFile=(userId:string,id:string)=>path.join(userDir(userId),'projects',safe(id)+'.json');
async function ownProjects(userId:string):Promise<Project[]>{await prepareUser(userId);try{return JSON.parse(await readFile(projectsFile(userId),'utf8')) as Project[];}catch{return [];}}
const sharedProjectsFile=path.join(root,'shared-projects.json');
async function sharedProjects():Promise<Project[]>{try{return JSON.parse(await readFile(sharedProjectsFile,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}}
let projectQueue=Promise.resolve();
function mutateProjects<T>(operation:()=>Promise<T>):Promise<T>{const task=projectQueue.then(operation);projectQueue=task.then(()=>undefined,()=>undefined);return task;}
async function writeSharedProjects(projects:Project[]){await mkdir(root,{recursive:true,mode:0o700});await writeFile(sharedProjectsFile+'.tmp',JSON.stringify(projects,null,2),{mode:0o600});await rename(sharedProjectsFile+'.tmp',sharedProjectsFile);}
const projectVisible=(userId:string,p:Project)=>p.ownerId===userId||p.memberIds?.includes(userId);
export async function listProjects(userId:string):Promise<Project[]>{return [...await ownProjects(userId),...(await sharedProjects()).filter(p=>projectVisible(userId,p))];}
export function updateSharedProject(userId:string,id:string,patch:Partial<Pick<Project,'runnerId'|'runnerOwnerId'|'needsSync'|'memberIds'>>):Promise<Project|null>{return mutateProjects(async()=>{const projects=await sharedProjects(),project=projects.find(p=>p.id===id&&projectVisible(userId,p));if(!project)return null;if(patch.memberIds&&project.ownerId!==userId)throw new Error('Only the project owner can manage members');Object.assign(project,patch,{updatedAt:new Date().toISOString()});await writeSharedProjects(projects);return project;});}
export async function getProject(userId:string,id:string):Promise<Project|null>{const shared=(await sharedProjects()).find(p=>p.id===id&&projectVisible(userId,p));if(shared)return shared;try{return JSON.parse(await readFile(projectFile(userId,id),'utf8')) as Project;}catch{return null;}}
export function createProject(userId:string,name:string,runnerId:string,shared=false,memberIds:string[]=[]):Promise<Project>{return mutateProjects(async()=>{await prepareUser(userId);const now=new Date().toISOString(),project:Project={id:randomUUID(),name:name.trim().slice(0,80),runnerId,createdAt:now,updatedAt:now};if(shared){Object.assign(project,{shared:true,ownerId:userId,memberIds:[...new Set(memberIds.filter(id=>id!==userId))]});const projects=await sharedProjects();projects.push(project);await writeSharedProjects(projects);return project;}const projects=await ownProjects(userId);projects.push(project);await writeFile(projectsFile(userId)+'.tmp',JSON.stringify(projects,null,2),{mode:0o600});await rename(projectsFile(userId)+'.tmp',projectsFile(userId));await saveProject(userId,project);return project;});}
async function saveProject(userId:string,project:Project){await writeFile(projectFile(userId,project.id)+'.tmp',JSON.stringify(project,null,2),{mode:0o600});await rename(projectFile(userId,project.id)+'.tmp',projectFile(userId,project.id));}
export async function listSessions(userId: string): Promise<ChatSession[]> {
  await prepareUser(userId);
  const files = (await readdir(path.join(userDir(userId),'sessions'))).filter(x => x.endsWith('.json'));
  const sessions = await Promise.all(files.map(async f => {
    const full = path.join(userDir(userId),'sessions',f);
    try {
      const s = JSON.parse(await readFile(full,'utf8')) as ChatSession;
      if (!s || !Array.isArray(s.messages) || s.messages.length === 0) {
        return null;
      }
      return normalizeSessionTitle(s);
    } catch {
      return null;
    }
  }));
  return sessions
    .filter((s): s is ChatSession => !!s && Array.isArray(s.messages) && s.messages.length > 0)
    .sort((a,b) => {
      const getMsgTime = (sess: ChatSession) => {
        if (sess.messages && sess.messages.length > 0) {
          for (let i = sess.messages.length - 1; i >= 0; i--) {
            const at = sess.messages[i]?.at;
            if (at) {
              const t = new Date(at).getTime();
              if (!isNaN(t) && t > 0) return t;
            }
          }
        }
        const fallback = new Date(sess.updatedAt || sess.createdAt || 0).getTime();
        return isNaN(fallback) ? 0 : fallback;
      };
      return getMsgTime(b) - getMsgTime(a);
    });
}
// Keep the previous built-in placeholder compatible with the English interface.
function normalizeSessionTitle(session: ChatSession): ChatSession {
  if (session.title === '\u041d\u043e\u0432\u044b\u0439 \u0447\u0430\u0442') session.title = 'New chat';
  return session;
}
export async function createSession(userId: string,projectId?:string): Promise<ChatSession> {
  await prepareUser(userId); const now = new Date().toISOString();
  const session: ChatSession = {id:randomUUID(),title:'New chat',createdAt:now,updatedAt:now,messages:[],...(projectId?{projectId}: {})};
  await saveSession(userId,session); return session;
}
export async function getSession(userId: string, id: string): Promise<ChatSession | null> { try { return normalizeSessionTitle(JSON.parse(await readFile(sessionFile(userId,id),'utf8')) as ChatSession); } catch { return null; } }
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

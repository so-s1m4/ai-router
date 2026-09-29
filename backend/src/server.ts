import express from 'express';
import session from 'express-session';
import sessionFileStore from 'session-file-store';
import helmet from 'helmet';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { z } from 'zod';
import { addAccount, addImportedCodexAccount, assignAccount, createProject, createSession, dataRoot, getProject, getSession, getUserModelBlacklist, listAccounts, listProjects, listSessions, prepareUser, saveSession, setAccountPriority, setUserModelBlacklist } from './store.js';
import { orderAccountsByPriority } from './account-priority.js';
import { changeUserPassword, deleteUser, ensureAdmin, findUserById, findUserByName, listUsers, registerUser, verifyPassword } from './auth.js';
import { createPairing, enroll, listRunners, ownsRunner, revokeRunner, runnerSocket, setConnected, verifyRunner, managerSocket, setManagerConnected, createManagerPairing, enrollManager, verifyManager } from './runners.js';
import { attachJobHandlers, dispatch, JobError } from './jobs.js';
import { uploadProjectFile } from './files.js';
import { createFileShare, downloadSharedFile, getWorkspaceGitSummary, listWorkspaceFiles } from './shared-files.js';
import { AccountUsageManager } from './usage.js';
import { attachPreviewHandlers, listPreviews, loadPreviews, setPreviewVisibility, startPreviewServer } from './previews.js';
import { modelCatalog, resolveAccountModels, type AIEvent, type AIEventType, type Model, type ProviderId } from './types.js';

const secret=process.env.SESSION_SECRET,password=process.env.ADMIN_PASSWORD;
if(!secret||secret.length<32||!password||password.length<12)throw new Error('Set SESSION_SECRET (32+ chars) and ADMIN_PASSWORD (12+ chars)');
await ensureAdmin(process.env.ADMIN_USER||'admin',password);
await loadPreviews();
const app=express();app.set('trust proxy',1);app.use(helmet());app.use(express.json({limit:'32kb'}));
const FileStore=sessionFileStore(session);
const sessionMiddleware=session({name:'router.sid',secret,store:new FileStore({path:dataRoot+'/http-sessions',retries:0}),resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:process.env.COOKIE_SECURE==='true',maxAge:7*86400000}});app.use(sessionMiddleware);
declare module 'express-session' { interface SessionData { userId?:string; } }
const requireAuth:express.RequestHandler=async(req,res,next)=>req.session.userId&&await findUserById(req.session.userId)?next():res.status(401).json({error:'Войдите в приложение'});
const requireOwner:express.RequestHandler=(req,res,next)=>req.session.userId==='owner'?next():res.status(403).json({error:'Доступно только владельцу'});
app.use('/api',(req,res,next)=>{if(['POST','PUT','PATCH','DELETE'].includes(req.method)){const origin=req.headers.origin;if(origin){try{if(new URL(origin).host!==req.get('host'))return res.status(403).json({error:'Invalid origin'});}catch{return res.status(403).json({error:'Invalid origin'});}}}next();});
const attempts=new Map<string,{count:number;until:number}>();
function blocked(ip:string){return (attempts.get(ip)?.until||0)>Date.now();}
function fail(ip:string){const old=attempts.get(ip);const count=(old&&old.until===0?old.count:0)+1;attempts.set(ip,{count:count>=8?0:count,until:count>=8?Date.now()+60000:0});}
const credentials=z.object({username:z.string().trim().regex(/^[a-zA-Z0-9_.-]{3,40}$/),password:z.string().min(12).max(200)});
app.post('/api/register',async(req,res)=>{if(process.env.ALLOW_SIGNUP==='false')return res.status(403).json({error:'Регистрация отключена'});const ip=req.ip||'unknown';if(blocked(ip))return res.status(429).json({error:'Попробуйте позже'});const p=credentials.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Логин 3–40 символов; пароль от 12 символов'});try{const user=await registerUser(p.data.username,p.data.password);await prepareUser(user.id);req.session.regenerate(err=>{if(err)return res.status(500).json({error:'Ошибка сессии'});req.session.userId=user.id;req.session.save(saveError=>saveError?res.status(500).json({error:'Ошибка сохранения сессии'}):res.status(201).json({username:user.username,isOwner:false}));});}catch(e){res.status(409).json({error:e instanceof Error?e.message:'Ошибка регистрации'});}});
app.post('/api/login',async(req,res)=>{const ip=req.ip||'unknown';if(blocked(ip))return res.status(429).json({error:'Попробуйте позже'});const p=credentials.safeParse(req.body);if(!p.success)return res.status(401).json({error:'Неверный логин или пароль'});const user=await findUserByName(p.data.username);if(!await verifyPassword(user,p.data.password)){fail(ip);return res.status(401).json({error:'Неверный логин или пароль'});}attempts.delete(ip);req.session.regenerate(err=>{if(err)return res.status(500).json({error:'Ошибка сессии'});req.session.userId=user!.id;req.session.save(saveError=>saveError?res.status(500).json({error:'Ошибка сохранения сессии'}):res.json({username:user!.username,isOwner:user!.id==='owner'}));});});
app.post('/api/logout',requireAuth,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/me',requireAuth,async(req,res)=>{const user=await findUserById(req.session.userId!);res.status(user?200:401).json(user?{username:user.username,isOwner:user.id==='owner'}:{error:'Пользователь не найден'});});
app.get('/api/users',requireAuth,requireOwner,async(_req,res)=>res.json(await listUsers()));
app.post('/api/users',requireAuth,requireOwner,async(req,res)=>{const p=credentials.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Логин 3–40 символов; пароль от 12 символов'});try{const user=await registerUser(p.data.username,p.data.password);await prepareUser(user.id);res.status(201).json({id:user.id,username:user.username,createdAt:user.createdAt});}catch(e){res.status(409).json({error:e instanceof Error?e.message:'Ошибка создания пользователя'});}});
app.put('/api/users/:id/password',requireAuth,requireOwner,async(req,res)=>{if(req.params.id==='owner')return res.status(400).json({error:'Пароль владельца задаётся в настройках сервера'});const p=z.object({password:z.string().min(12).max(200)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Пароль должен содержать от 12 до 200 символов'});res.status(await changeUserPassword(req.params.id,p.data.password)?200:404).json({ok:true});});
app.delete('/api/users/:id',requireAuth,requireOwner,async(req,res)=>{if(req.params.id==='owner')return res.status(400).json({error:'Владельца удалить нельзя'});if(!await deleteUser(req.params.id))return res.status(404).json({error:'Пользователь не найден'});for(const client of io.sockets.sockets.values())if((client.request as express.Request).session.userId===req.params.id)client.disconnect(true);res.json({ok:true});});
const usage=new AccountUsageManager();
const accountModels=new Map<string,Model[]>();
const accountErrors=new Map<string,string>();
function getModelsForAccount(accountId:string,provider:ProviderId):Model[]{
  return resolveAccountModels(provider, accountModels.get(accountId));
}
async function accountStatuses(userId:string){const accounts=await listAccounts(userId),runners=await listRunners(userId);return accounts.map(a=>{const {importKey:_importKey,...publicAccount}=a;const runner=runners.find(r=>r.id===a.runnerId&&!r.revokedAt),mode=!runner?'unassigned':runner.online?'runner':'offline',statusError=accountErrors.get(a.id);return {...publicAccount,models:getModelsForAccount(a.id,a.provider),mode,auth:runner?.online?'unknown':'missing',detail:statusError?`Ошибка подключения: ${statusError}`:!runner?'Назначьте исполнительный контейнер':runner.online?`Исполнитель ${runner.name} подключён`:`Исполнитель ${runner.name} не в сети`,limit:usage.snapshot(userId,a.id)};});}
async function emitAccountsToUser(userId:string){const accounts=await accountStatuses(userId);for(const client of io.sockets.sockets.values())if((client.request as express.Request).session.userId===userId)client.emit('accounts:changed',accounts);}
async function pushRunnerAccounts(userId:string,runnerId:string){const socket=runnerSocket(runnerId);if(!socket)return;const accounts=await listAccounts(userId);socket.emit('accounts:list',accounts.filter(a=>a.runnerId===runnerId).map(a=>({id:a.id,provider:a.provider,authType:a.authType})));}
app.get('/api/accounts',requireAuth,async(req,res)=>res.json(await accountStatuses(req.session.userId!)));
app.post('/api/accounts',requireAuth,async(req,res)=>{const p=z.object({provider:z.enum(['codex','antigravity','chatgpt']),name:z.string().trim().min(1).max(60),runnerId:z.string().uuid(),authType:z.literal('api_key').optional()}).refine(v=>!v.authType||v.provider==='codex').safeParse(req.body);if(!p.success)return res.status(400).json({error:'Укажите провайдера, название и контейнер'});const userId=req.session.userId!;if(!await ownsRunner(userId,p.data.runnerId))return res.status(403).json({error:'Контейнер не принадлежит вам'});const account=await addAccount(userId,p.data.provider,p.data.name,p.data.runnerId,p.data.authType);await pushRunnerAccounts(userId,p.data.runnerId);res.status(201).json(account);});
app.put('/api/accounts/:id/api-key',requireAuth,async(req,res)=>{
  const parsed=z.object({apiKey:z.string().trim().min(20).max(512).regex(/^sk-[A-Za-z0-9_-]+$/)}).strict().safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'Укажите API-ключ OpenAI (sk-…)'});
  const userId=req.session.userId!;
  const account=(await listAccounts(userId)).find(a=>a.id===req.params.id&&a.provider==='codex'&&a.authType==='api_key');
  if(!account?.runnerId)return res.status(404).json({error:'API-подключение не найдено'});
  const socket=runnerSocket(account.runnerId);
  if(!socket)return res.status(503).json({error:'Исполнитель не в сети'});
  try {
    const result=await socket.timeout(25000).emitWithAck('account:openai-key',{accountId:account.id,apiKey:parsed.data.apiKey}) as {ok?:boolean;error?:string};
    if(!result?.ok)return res.status(400).json({error:result?.error||'Runner не сохранил ключ'});
    await pushRunnerAccounts(userId,account.runnerId);
    res.json({ok:true});
  } catch {res.status(504).json({error:'Runner не ответил. Проверьте его версию и подключение.'});}
});
app.patch('/api/accounts/:id',requireAuth,async(req,res)=>{const p=z.object({runnerId:z.string().uuid()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Неверный контейнер'});const userId=req.session.userId!;if(!await ownsRunner(userId,p.data.runnerId))return res.status(403).json({error:'Контейнер не принадлежит вам'});const account=await assignAccount(userId,req.params.id,p.data.runnerId);if(account)await pushRunnerAccounts(userId,p.data.runnerId);res.status(account?200:404).json(account||{error:'Аккаунт не найден'});});
app.patch('/api/accounts/:id/priority',requireAuth,async(req,res)=>{const p=z.object({priority:z.union([z.literal(0),z.literal(1),z.literal(2)])}).strict().safeParse(req.body);if(!p.success)return res.status(400).json({error:'Приоритет должен быть низким, обычным или высоким'});const userId=req.session.userId!;const account=await setAccountPriority(userId,req.params.id,p.data.priority);if(account)await emitAccountsToUser(userId);res.status(account?200:404).json(account||{error:'Аккаунт не найден'});});
app.post('/api/accounts/:id/chatgpt-session',requireAuth,async(req,res)=>{const userId=req.session.userId!;const accounts=await listAccounts(userId);const account=accounts.find(a=>a.id===req.params.id&&a.provider==='chatgpt');if(!account)return res.status(404).json({error:'Аккаунт ChatGPT не найден'});if(!account.runnerId)return res.status(400).json({error:'Сначала назначьте исполнитель (runner) для аккаунта'});const socket=runnerSocket(account.runnerId);if(!socket)return res.status(503).json({error:'Исполнитель не в сети'});const p=z.object({sessionToken:z.string().trim().optional(),cookies:z.array(z.any()).optional()}).safeParse(req.body);if(!p.success||(!p.data.sessionToken&&!p.data.cookies?.length))return res.status(400).json({error:'Укажите sessionToken или массив cookies'});try{const result=await socket.timeout(10000).emitWithAck('account:chatgpt-session',{accountId:account.id,sessionToken:p.data.sessionToken,cookies:p.data.cookies}) as {ok?:boolean;error?:string};if(!result?.ok)return res.status(500).json({error:result?.error||'Исполнитель отклонил сохранение сессии'});res.json({ok:true});}catch(error){res.status(504).json({error:'Исполнитель не ответил'});}});
app.get('/api/runners',requireAuth,async(req,res)=>res.json(await listRunners(req.session.userId!)));
app.post('/api/runners/pairing',requireAuth,async(req,res)=>{const p=z.object({name:z.string().trim().min(1).max(60)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Укажите название контейнера'});res.status(201).json(await createPairing(req.session.userId!,p.data.name));});
app.post('/api/runner/enroll',async(req,res)=>{const p=z.object({code:z.string().min(20).max(100)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Неверный код'});try{res.status(201).json(await enroll(p.data.code));}catch{res.status(401).json({error:'Код недействителен или истёк'});}});
app.post('/api/runners/:id/management/pairing',requireAuth,async(req,res)=>{try{res.status(201).json(await createManagerPairing(req.session.userId!,req.params.id));}catch{res.status(404).json({error:'Исполнитель не найден'});}});
app.post('/api/runner/manager/enroll',async(req,res)=>{const p=z.object({code:z.string().min(20).max(100)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Неверный код'});try{res.status(201).json(await enrollManager(p.data.code));}catch{res.status(401).json({error:'Код недействителен или истёк'});}});
app.post('/api/runner/accounts/import',async(req,res)=>{const id=req.get('X-Runner-ID'),secret=req.get('X-Runner-Secret');if(!id||!secret)return res.status(401).json({error:'Исполнитель не авторизован'});const runner=await verifyRunner(id,secret);if(!runner)return res.status(401).json({error:'Исполнитель не авторизован'});const p=z.object({name:z.string().trim().min(1).max(60),importKey:z.string().regex(/^[a-f0-9]{64}$/)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Неверные данные профиля'});const account=await addImportedCodexAccount(runner.userId,p.data.name,runner.id,p.data.importKey);await pushRunnerAccounts(runner.userId,runner.id);res.status(201).json({id:account.id,name:account.name});});
app.delete('/api/runners/:id',requireAuth,async(req,res)=>res.status(await revokeRunner(req.session.userId!,req.params.id)?200:404).json({ok:true}));
app.get('/api/runners/:id/previews',requireAuth,async(req,res)=>{if(!await ownsRunner(req.session.userId!,req.params.id))return res.status(404).json({error:'Исполнитель не найден'});res.json(listPreviews(req.session.userId!,req.params.id));});
app.patch('/api/runners/:id/previews/:subdomain',requireAuth,async(req,res)=>{if(!await ownsRunner(req.session.userId!,req.params.id))return res.status(404).json({error:'Исполнитель не найден'});const parsed=z.object({visible:z.boolean()}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Укажите видимость'});const record=await setPreviewVisibility(req.session.userId!,req.params.id,req.params.subdomain,parsed.data.visible);res.status(record?200:404).json(record||{error:'Сайт не найден'});});
const managementOps=z.enum(['overview','keys.create','keys.delete','github.test','containers.inspect','containers.start','containers.stop','containers.restart','containers.recreate','containers.remove','mcp.list','mcp.add','mcp.remove','auth.start','auth.status','auth.cancel']);
app.post('/api/runners/:id/management/challenge',requireAuth,async(req,res)=>{
 if(!await ownsRunner(req.session.userId!,req.params.id))return res.status(404).json({error:'Исполнитель не найден'});
 const socket=managerSocket(req.params.id);if(!socket)return res.status(503).json({error:'Управление этим runner не подключено'});
 try{const result=await socket.timeout(10000).emitWithAck('manage:challenge');res.json(result);}catch{res.status(504).json({error:'Runner не ответил'});}
});
app.post('/api/runners/:id/management/action',requireAuth,async(req,res)=>{
 if(!await ownsRunner(req.session.userId!,req.params.id))return res.status(404).json({error:'Исполнитель не найден'});
 const parsed=z.object({nonce:z.string().min(16).max(100),proof:z.string().min(32).max(100),op:managementOps,payload:z.record(z.unknown()).default({})}).safeParse(req.body);
 if(!parsed.success)return res.status(400).json({error:'Неверный запрос управления'});
 const socket=managerSocket(req.params.id);if(!socket)return res.status(503).json({error:'Управление этим runner не подключено'});
 try{const result=await socket.timeout(120000).emitWithAck('manage:action',parsed.data);res.status(result?.ok?200:400).json(result);}catch{res.status(504).json({error:'Runner не ответил'});}
});
app.get('/api/projects',requireAuth,async(req,res)=>res.json(await listProjects(req.session.userId!)));
app.post('/api/projects',requireAuth,async(req,res)=>{const p=z.object({name:z.string().trim().min(1).max(80),runnerId:z.string().uuid()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Укажите название проекта и исполнитель'});const userId=req.session.userId!;if(!await ownsRunner(userId,p.data.runnerId))return res.status(403).json({error:'Исполнитель не принадлежит вам'});res.status(201).json(await createProject(userId,p.data.name,p.data.runnerId));});
app.post('/api/projects/:id/files',requireAuth,express.raw({type:'application/octet-stream',limit:'20mb'}),async(req,res)=>{const userId=req.session.userId!,project=await getProject(userId,req.params.id);if(!project)return res.status(404).json({error:'Проект не найден'});if(!Buffer.isBuffer(req.body)||!req.body.length)return res.status(400).json({error:'Файл пустой'});let name=req.get('X-File-Name')||'file';try{name=decodeURIComponent(name);}catch{}if(!name||name.length>180||name==='.'||name==='..'||/[\\/\0]/.test(name))return res.status(400).json({error:'Недопустимое имя файла'});try{res.status(201).json(await uploadProjectFile(project.runnerId,project.id,name,req.body));}catch(error){res.status(502).json({error:error instanceof Error?error.message:'Не удалось загрузить файл'});}});
app.get('/api/sessions',requireAuth,async(req,res)=>res.json(await listSessions(req.session.userId!)));
app.post('/api/sessions',requireAuth,async(req,res)=>{const p=z.object({projectId:z.string().uuid().optional()}).safeParse(req.body||{});if(!p.success)return res.status(400).json({error:'Неверный проект'});if(p.data.projectId&&!await getProject(req.session.userId!,p.data.projectId))return res.status(404).json({error:'Проект не найден'});res.status(201).json(await createSession(req.session.userId!,p.data.projectId));});
app.get('/api/sessions/:id',requireAuth,async(req,res)=>{const s=await getSession(req.session.userId!,req.params.id);res.status(s?200:404).json(s||{error:'Чат не найден'});});
async function sessionFileScope(userId:string,id:string){const chat=await getSession(userId,id);if(!chat)return null;const project=chat.projectId?await getProject(userId,chat.projectId):null;if(chat.projectId&&!project)return null;let runnerId=project?.runnerId||chat.runnerId;if(!runnerId){const runners=(await listRunners(userId)).filter(r=>!r.revokedAt);if(runners.length===1)runnerId=runners[0].id;}if(!runnerId||!await ownsRunner(userId,runnerId))return null;return {runnerId,scope:{sessionId:chat.id,...(chat.projectId?{projectId:chat.projectId}:{})}};}
app.get('/api/sessions/:id/files',requireAuth,async(req,res)=>{const target=await sessionFileScope(req.session.userId!,req.params.id);if(!target)return res.status(404).json({error:'Файлы задачи пока недоступны'});try{res.json({files:await listWorkspaceFiles(target.runnerId,target.scope)});}catch(error){res.status(503).json({error:error instanceof Error?error.message:'Исполнитель недоступен'});}});
app.post('/api/sessions/:id/files/share',requireAuth,async(req,res)=>{const parsed=z.object({name:z.string().min(1).max(500)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Укажите файл'});const target=await sessionFileScope(req.session.userId!,req.params.id);if(!target)return res.status(404).json({error:'Файлы задачи пока недоступны'});try{res.status(201).json(await createFileShare(req.session.userId!,target.runnerId,target.scope,parsed.data.name));}catch(error){res.status(503).json({error:error instanceof Error?error.message:'Не удалось создать ссылку'});}});
app.get('/api/files/:token',async(req,res)=>{await downloadSharedFile(req.params.token,res);});
app.patch('/api/sessions/:id',requireAuth,async(req,res)=>{const p=z.object({projectId:z.string().uuid().nullable().optional(),title:z.string().min(1).max(100).optional()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Неверные параметры'});const session=await getSession(req.session.userId!,req.params.id);if(!session)return res.status(404).json({error:'Чат не найден'});if(p.data.projectId!==undefined){if(p.data.projectId&&!await getProject(req.session.userId!,p.data.projectId))return res.status(404).json({error:'Проект не найден'});if(p.data.projectId===null)delete session.projectId;else session.projectId=p.data.projectId;}if(p.data.title!==undefined)session.title=p.data.title;session.updatedAt=new Date().toISOString();await saveSession(req.session.userId!,session);res.json(session);});

function generateHandoffMarkdown(target:'codex'|'chatgpt',sessionTitle:string,userMsgs:string[],assistantMsgs:string[],git:any,note?:string):string{
 const isCodex=target==='codex';
 const header=isCodex?'### 📋 Передача задачи в Codex (Handoff)':'### 💬 Обсуждение результатов с ChatGPT';
 const initialGoal=userMsgs[0]?userMsgs[0].slice(0,300):(sessionTitle!=='Новый чат'?sessionTitle:'Текущая задача');
 const latestUser=userMsgs.length>1?userMsgs[userMsgs.length-1].slice(0,300):null;
 const latestAssistant=assistantMsgs.length>0?assistantMsgs[assistantMsgs.length-1].slice(0,500):null;
 const points:string[]=[];
 points.push(`- **Основная цель:** ${initialGoal}`);
 if(latestUser&&latestUser!==initialGoal)points.push(`- **Последний запрос:** ${latestUser}`);
 if(latestAssistant){
  const brief=latestAssistant.split('\n').filter(Boolean).slice(0,3).join(' ');
  points.push(`- **Статус работы:** ${brief.length>300?brief.slice(0,300)+'…':brief}`);
 }
 const gitSection:string[]=[];
 if(git?.isGitRepo){
  if(git.branch)gitSection.push(`- **Ветка:** \`${git.branch}\``);
  if(git.lastLog){
   const firstLine=git.lastLog.split('\n')[0]||'';
   gitSection.push(`- **Последний коммит:** \`${firstLine}\``);
  }
  if(git.status)gitSection.push(`\n**Изменённые/новые файлы (git status):**\n\`\`\`\n${git.status}\n\`\`\``);
  if(git.diffStat)gitSection.push(`\n**Сводка изменений (git diff --stat):**\n\`\`\`\n${git.diffStat}\n\`\`\``);
  else if(git.cachedStat)gitSection.push(`\n**Подготовленные изменения (git diff --cached --stat):**\n\`\`\`\n${git.cachedStat}\n\`\`\``);
  else if(!git.status&&git.lastLog){
   const lines=git.lastLog.split('\n').slice(1).join('\n').trim();
   if(lines)gitSection.push(`\n**Изменения последнего коммита:**\n\`\`\`\n${lines}\n\`\`\``);
  }
  if(git.diffExcerpt)gitSection.push(`\n<details><summary>Фрагмент diff</summary>\n\n\`\`\`diff\n${git.diffExcerpt}\n\`\`\`\n</details>`);
 }else if(git?.recentFiles?.length){
  const list=git.recentFiles.map((f:any)=>`- \`${f.name}\` (${Math.round(f.size/1024)} KB)`).join('\n');
  gitSection.push(`**Недавние файлы проекта:**\n${list}`);
 }else{
  gitSection.push(`- *Рабочий каталог чист (нет незакоммиченных изменений).*`);
 }
 const instruction=isCodex
  ?(note||'Продолжи выполнение задачи, опираясь на контекст и состояние файлов выше. Проверь код, внеси нужные правки и протестируй результат.')
  :(note||'Ознакомься с ключевыми пунктами задачи и изменениями в файлах выше. Проанализируй текущее решение, дай оценку и помоги спланировать дальнейшие шаги.');
 return `${header}\n\n`+
  `**Ключевые пункты задачи:**\n${points.join('\n')}\n\n`+
  `**Файлы и состояние Git:**\n${gitSection.join('\n')}\n\n`+
  (isCodex?`**Инструкция для Codex:**\n${instruction}`:`**Вопрос для ChatGPT:**\n${instruction}`);
}

async function handleHandoffRequest(userId:string,sessionId:string|undefined,projectId:string|undefined,target:'codex'|'chatgpt',note:string|undefined){
 const session=sessionId?await getSession(userId,sessionId):null;
 const pId=projectId||session?.projectId;
 const project=pId?await getProject(userId,pId):null;
 let runnerId=project?.runnerId||session?.runnerId;
 if(!runnerId){
  const runners=(await listRunners(userId)).filter(r=>!r.revokedAt);
  if(runners.length===1)runnerId=runners[0].id;
 }
 let gitSummary:any=null;
 if(runnerId&&await ownsRunner(userId,runnerId)){
  const scope={sessionId:session?.id||sessionId||randomUUID(),...(pId?{projectId:pId}:{})};
  gitSummary=await getWorkspaceGitSummary(runnerId,scope);
 }
 const userMsgs=(session?.messages||[]).filter(m=>m.role==='user').map(m=>m.text);
 const assistantMsgs=(session?.messages||[]).filter(m=>m.role==='assistant').map(m=>m.text);
 const summary=generateHandoffMarkdown(target,session?.title||'Новый чат',userMsgs,assistantMsgs,gitSummary,note);
 return {ok:true,summary,target,projectId:pId,git:gitSummary};
}

app.post('/api/sessions/:id/handoff-summary',requireAuth,async(req,res)=>{
 const p=z.object({target:z.enum(['codex','chatgpt']).default('codex'),projectId:z.string().uuid().optional(),note:z.string().max(2000).optional()}).safeParse(req.body||{});
 if(!p.success)return res.status(400).json({error:'Неверные параметры'});
 res.json(await handleHandoffRequest(req.session.userId!,req.params.id,p.data.projectId,p.data.target,p.data.note));
});
app.get('/api/sessions/:id/handoff-summary',requireAuth,async(req,res)=>{
 const target=req.query.target==='chatgpt'?'chatgpt':'codex';
 const projectId=typeof req.query.projectId==='string'&&req.query.projectId?req.query.projectId:undefined;
 const note=typeof req.query.note==='string'?req.query.note:undefined;
 res.json(await handleHandoffRequest(req.session.userId!,req.params.id,projectId,target,note));
});
app.post('/api/handoff-summary',requireAuth,async(req,res)=>{
 const p=z.object({sessionId:z.string().uuid().optional(),projectId:z.string().uuid().optional(),target:z.enum(['codex','chatgpt']).default('codex'),note:z.string().max(2000).optional()}).safeParse(req.body||{});
 if(!p.success)return res.status(400).json({error:'Неверные параметры'});
 res.json(await handleHandoffRequest(req.session.userId!,p.data.sessionId,p.data.projectId,p.data.target,p.data.note));
});
app.get('/api/user/model-blacklist',requireAuth,async(req,res)=>res.json({blacklist:await getUserModelBlacklist(req.session.userId!)}));
app.put('/api/user/model-blacklist',requireAuth,async(req,res)=>{const p=z.object({blacklist:z.array(z.string().min(1).max(100))}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Неверный формат списка моделей'});const updated=await setUserModelBlacklist(req.session.userId!,p.data.blacklist);res.json({ok:true,blacklist:updated});});
app.get('/api/providers',requireAuth,async(req,res)=>{const userId=req.session.userId!;const blacklist=await getUserModelBlacklist(userId);const accounts=await listAccounts(userId);const geminiExtra=accounts.filter(a=>a.provider==='antigravity').flatMap(a=>accountModels.get(a.id)||[]);const codexExtra=accounts.filter(a=>a.provider==='codex').flatMap(a=>accountModels.get(a.id)||[]);const chatgptExtra=accounts.filter(a=>a.provider==='chatgpt').flatMap(a=>accountModels.get(a.id)||[]);const geminiModels=resolveAccountModels('antigravity',geminiExtra).filter(m=>m.id!=='default');const codexModels=resolveAccountModels('codex',codexExtra).filter(m=>m.id!=='default');const chatgptModels=resolveAccountModels('chatgpt',chatgptExtra).filter(m=>m.id!=='default');res.json({providers:[{id:'antigravity',name:'Gemini',description:'Google DeepMind / Antigravity CLI',models:geminiModels},{id:'codex',name:'Codex',description:'OpenAI Codex CLI',models:codexModels},{id:'chatgpt',name:'ChatGPT Web',description:'ChatGPT Web (Browser Session)',models:chatgptModels}],blacklist});});
app.post('/api/providers/refresh',requireAuth,async(req,res)=>{const userId=req.session.userId!;const accounts=await listAccounts(userId);const runnerIds=new Set(accounts.map(a=>a.runnerId).filter((id):id is string=>Boolean(id)));let requested=0;for(const runnerId of runnerIds){if(runnerSocket(runnerId)){await pushRunnerAccounts(userId,runnerId);requested++;}}res.json({requested});});
app.get('/api/health',(_req,res)=>res.json({ok:true,revision:process.env.APP_REVISION||'local'}));

const http=createServer(app),io=new Server(http,{path:'/socket.io',cors:{origin:false}});io.engine.use(sessionMiddleware);
const runnerNs=io.of('/runner');
runnerNs.use(async(socket,next)=>{const {runnerId,secret}=socket.handshake.auth||{};if(typeof runnerId!=='string'||typeof secret!=='string')return next(new Error('unauthorized'));const record=await verifyRunner(runnerId,secret);if(!record)return next(new Error('unauthorized'));socket.data.runnerId=record.id;socket.data.userId=record.userId;next();});
 runnerNs.on('connection',socket=>{const runnerId=socket.data.runnerId as string,userId=socket.data.userId as string;setConnected(runnerId,socket);void pushRunnerAccounts(userId,runnerId);socket.on('account:status',async(raw:unknown)=>{const parsed=z.object({accountId:z.string().uuid(),provider:z.enum(['codex','antigravity','chatgpt']),models:z.array(z.object({id:z.string().min(1).max(100),label:z.string().min(1).max(160),reasoning:z.array(z.object({id:z.string().min(1).max(32),label:z.string().min(1).max(80)})).optional(),defaultReasoning:z.string().max(32).optional()})).optional(),limits:z.object({primary:z.object({usedPercent:z.number(),windowMinutes:z.number().optional(),resetAt:z.string().optional()}).nullable().optional(),secondary:z.object({usedPercent:z.number(),windowMinutes:z.number().optional(),resetAt:z.string().optional()}).nullable().optional()}).optional(),error:z.string().max(500).optional()}).safeParse(raw);if(!parsed.success)return;const account=(await listAccounts(userId)).find(a=>a.id===parsed.data.accountId&&a.runnerId===runnerId&&a.provider===parsed.data.provider);if(!account)return;if(parsed.data.error){accountModels.delete(account.id);accountErrors.set(account.id,parsed.data.error.slice(0,240));}else{accountErrors.delete(account.id);if(parsed.data.models)accountModels.set(account.id,parsed.data.models);if(parsed.data.limits)usage.update(userId,account.id,parsed.data.limits);}await emitAccountsToUser(userId);});});attachJobHandlers(runnerNs);attachPreviewHandlers(runnerNs);
const managerNs=io.of('/manager');
managerNs.use(async(socket,next)=>{const {runnerId,secret}=socket.handshake.auth||{};if(typeof runnerId!=='string'||typeof secret!=='string')return next(new Error('unauthorized'));const record=await verifyManager(runnerId,secret);if(!record)return next(new Error('unauthorized'));socket.data.runnerId=record.id;socket.data.userId=record.userId;next();});
managerNs.on('connection',socket=>{const runnerId=socket.data.runnerId as string,userId=socket.data.userId as string;setManagerConnected(runnerId,socket);socket.on('manage:account-updated',async(raw:unknown)=>{const parsed=z.object({accountId:z.string().uuid()}).safeParse(raw);if(!parsed.success)return;const account=(await listAccounts(userId)).find(a=>a.id===parsed.data.accountId&&a.runnerId===runnerId);if(account)await pushRunnerAccounts(userId,runnerId);});});
io.use(async(socket,next)=>{const req=socket.request as express.Request,origin=req.headers.origin,host=req.headers.host;try{if(!req.session?.userId||origin&&host&&new URL(origin).host!==host||!await findUserById(req.session.userId))return next(new Error('unauthorized'));next();}catch{next(new Error('unauthorized'));}});
type RunActivity={type:AIEventType;message:string;at:string;provider?:ProviderId;accountId?:string};
type ActiveRun={userId:string;sessionId:string;controller:AbortController;startedAt:string;accountId?:string;provider?:ProviderId;message:string;stream:string;activity:RunActivity[]};
const active=new Map<string,ActiveRun>(),busy=new Set<string>(),cursors=new Map<string,number>();
type TerminalRun={runId:string;sessionId:string;type:'completed'|'error';message:string;finishedAt:number};
const recentRuns=new Map<string,TerminalRun>();
const runKey=(userId:string,sessionId:string)=>userId+':'+sessionId;
const sendSchema=z.object({sessionId:z.string().uuid(),prompt:z.string().trim().min(1).max(16000),accountId:z.string().uuid().or(z.enum(['auto','gemini','codex','antigravity','chatgpt'])).optional(),service:z.enum(['auto','gemini','codex','antigravity','chatgpt']).optional(),provider:z.enum(['auto','gemini','codex','antigravity','chatgpt']).optional(),model:z.string().min(1).max(100),reasoning:z.string().min(1).max(32).default('default'),mode:z.enum(['chat','task']).optional().default('task')});
io.on('connection',socket=>{const userId=(socket.request as express.Request).session.userId!;socket.join('user:'+userId);
 socket.on('run:state',(sessionId:unknown,ack?:(state:unknown)=>void)=>{if(typeof ack!=='function')return;if(typeof sessionId!=='string')return ack(null);const entry=[...active.entries()].find(([,run])=>run.userId===userId&&run.sessionId===sessionId);if(!entry){const recent=recentRuns.get(runKey(userId,sessionId));return ack(recent&&Date.now()-recent.finishedAt<600000?recent:null);}const [runId,run]=entry;ack({runId,sessionId:run.sessionId,startedAt:run.startedAt,accountId:run.accountId,provider:run.provider,message:run.message,stream:run.stream,activity:run.activity});});
  socket.on('run',async(raw:unknown,ack?:(r:unknown)=>void)=>{const parsed=sendSchema.safeParse(raw);if(!parsed.success)return ack?.({ok:false,error:'Неверные параметры'});const input=parsed.data,key=userId+':'+input.sessionId;if(busy.has(key))return ack?.({ok:false,error:'Этот чат уже занят'});const chat=await getSession(userId,input.sessionId);if(!chat)return ack?.({ok:false,error:'Чат не найден'});const project=chat.projectId?await getProject(userId,chat.projectId):null;if(chat.projectId&&!project)return ack?.({ok:false,error:'Проект не найден'});const userBlacklist=await getUserModelBlacklist(userId);if(input.model!=='default'&&userBlacklist.includes(input.model))return ack?.({ok:false,error:'Модель отключена в настройках провайдеров'});const rawTarget=input.service||input.provider||input.accountId||'auto';const service=rawTarget==='antigravity'?'gemini':rawTarget;const allAccounts=await listAccounts(userId),projectAccounts=project?allAccounts.filter(a=>a.runnerId===project.runnerId):allAccounts;let eligible=projectAccounts;if(service==='gemini')eligible=projectAccounts.filter(a=>a.provider==='antigravity');else if(service==='codex')eligible=projectAccounts.filter(a=>a.provider==='codex');else if(service==='chatgpt')eligible=projectAccounts.filter(a=>a.provider==='chatgpt');else if(service!=='auto')eligible=projectAccounts.filter(a=>a.id===rawTarget);const cursor=cursors.get(userId)||0;const isAutoOrService=service==='auto'||service==='gemini'||service==='codex'||service==='chatgpt';const ordered=isAutoOrService?orderAccountsByPriority(eligible,cursor):eligible;const supports=(a:typeof allAccounts[number])=>{const models=getModelsForAccount(a.id,a.provider),model=models.find(m=>m.id===input.model);if(input.model!=='default'&&!model)return false;if(input.reasoning!=='default'){if(input.model!=='default'){if(!model?.reasoning||!model.reasoning.some(r=>r.id===input.reasoning))return false;}else{const hasReasoning=models.some(m=>m.reasoning?.some(r=>r.id===input.reasoning));if(!hasReasoning)return false;}}return true;};const choices=ordered.filter(supports);if(isAutoOrService&&eligible.length)cursors.set(userId,(cursor+1)%Number.MAX_SAFE_INTEGER);if(!choices.length){let err=project?'Нет аккаунта на runner с такой моделью и reasoning':'Нет подключения с такой моделью и reasoning';if(service==='gemini')err=project?'Нет аккаунта Gemini на runner для этого проекта':(eligible.length?'Аккаунты Gemini не поддерживают выбранную модель или рассуждение':'Нет доступного подключения Gemini');else if(service==='codex')err=project?'Нет аккаунта Codex на runner для этого проекта':(eligible.length?'Аккаунты Codex не поддерживают выбранную модель или рассуждение':'Нет доступного подключения Codex');else if(service==='chatgpt')err=project?'Нет аккаунта ChatGPT на runner для этого проекта':(eligible.length?'Аккаунты ChatGPT не поддерживают выбранную модель':'Нет доступного подключения ChatGPT');return ack?.({ok:false,error:err});}
  const runId=randomUUID(),controller=new AbortController(),startedAt=new Date().toISOString();recentRuns.delete(key);busy.add(key);const run:ActiveRun={userId,sessionId:chat.id,controller,startedAt,message:'Запрос принят',stream:'',activity:[]};active.set(runId,run);ack?.({ok:true,runId});const emit=(type:AIEventType,accountId?:string,provider?:ProviderId,extra:Partial<AIEvent>={})=>{const event:AIEvent={id:randomUUID(),sessionId:chat.id,runId,at:new Date().toISOString(),type,provider,...extra,data:{accountId,...extra.data}};if(accountId)run.accountId=accountId;if(provider)run.provider=provider;if(type==='delta'&&event.text)run.stream=(run.stream+event.text).slice(-12000);if((type==='started'||type==='status'||type==='tool'||type==='fallback'||type==='checkpoint'||type==='handoff_started'||type==='handoff_ready')&&event.message){run.message=event.message;run.activity.push({type,message:event.message,at:event.at,provider,accountId});run.activity=run.activity.slice(-12);}if((type==='completed'||type==='error')&&event.message){recentRuns.set(key,{runId,sessionId:chat.id,type,message:event.message,finishedAt:Date.now()});if(recentRuns.size>500)recentRuns.delete(recentRuns.keys().next().value!);}io.to('user:'+userId).emit('ai:event',event);};
  const now=new Date().toISOString();chat.messages.push({id:randomUUID(),role:'user',text:input.prompt,at:now});if(chat.title==='Новый чат')chat.title=input.prompt.slice(0,45);chat.updatedAt=now;await saveSession(userId,chat);emit('started',undefined,undefined,{message:'Запрос принят'});let done=false;const errors:string[]=[];let taskPrompt=input.prompt;let handoffRunnerId:string|undefined;let handoffPending=false;
  try{for(const a of choices){if(controller.signal.aborted)break;if(handoffRunnerId&&a.runnerId!==handoffRunnerId)continue;if(!a.runnerId||!await ownsRunner(userId,a.runnerId)||!runnerSocket(a.runnerId)){errors.push(`${a.name}: исполнитель не в сети`);emit('fallback',a.id,a.provider,{message:`${a.name}: исполнитель не в сети`});continue;}if(!usage.available(userId,a.id)){errors.push(`${a.name}: аккаунт временно ограничен провайдером`);emit('fallback',a.id,a.provider,{message:`${a.name}: аккаунт временно ограничен провайдером`});continue;}let produced=false,touched=false,partial='';try{if(!chat.projectId&&chat.runnerId!==a.runnerId){chat.runnerId=a.runnerId;await saveSession(userId,chat);}emit('status',a.id,a.provider,{message:`${a.name}: отправлено исполнителю`});const history=chat.messages.slice(-12,-1).map(m=>`${m.role==='user'?'User':'Assistant'}: ${m.text}`).join('\n');const prompt=history?`Conversation context:\n${history}\n\nCurrent user request:\n${taskPrompt}`:taskPrompt;const text=await dispatch(a.runnerId,{taskId:runId,accountId:a.id,provider:a.provider,sessionId:chat.id,projectId:chat.projectId,prompt,model:input.model,reasoning:input.reasoning,mode:'task'},controller.signal,e=>{if(e.type==='delta'){produced=true;partial+=(e.text||'');}if(e.type==='tool')touched=true;if(e.type==='checkpoint'&&e.data?.status==='running'&&handoffPending){emit('handoff_ready',a.id,a.provider,{message:`${a.name}: продолжает задачу из checkpoint`});handoffPending=false;}if(e.type==='usage'&&e.data?.limits)usage.update(userId,a.id,e.data.limits as {primary?:{usedPercent?:number;windowMinutes?:number;resetAt?:string};secondary?:{usedPercent?:number;windowMinutes?:number;resetAt?:string}});emit(e.type,a.id,a.provider,e);});chat.messages.push({id:randomUUID(),role:'assistant',text,provider:a.provider,at:new Date().toISOString()});chat.updatedAt=new Date().toISOString();await saveSession(userId,chat);emit('completed',a.id,a.provider,{text,message:'Готово'});done=true;break;}catch(e){if(e instanceof JobError&&e.code==='rate_limit')usage.rateLimited(userId,a.id);const reason=e instanceof Error?e.message:'Ошибка';errors.push(`${a.name}: ${reason}`);const rateLimited=e instanceof JobError&&e.code==='rate_limit';if(isAutoOrService&&rateLimited&&!controller.signal.aborted){handoffRunnerId=a.runnerId;handoffPending=true;taskPrompt=`Прочитай файл .ai-router/tasks/${runId}/HANDOFF.md в текущей папке и продолжи ту же задачу с текущего состояния. Не повторяй завершённые команды и сначала проверь изменённые файлы.`;emit('handoff_started',a.id,a.provider,{message:`${a.name}: сохраняем checkpoint и передаём работу следующему аккаунту.`});continue;}if(isAutoOrService&&!produced&&!touched&&!controller.signal.aborted){emit('fallback',a.id,a.provider,{message:`${a.name}: ${reason}. Пробуем следующий аккаунт.`});continue;}break;}}if(!done)emit('error',undefined,undefined,{message:controller.signal.aborted?'Остановлено пользователем':errors.join(' · ')||'Нет доступного подключения'});
  }catch(e){emit('error',undefined,undefined,{message:e instanceof Error?e.message:'Внутренняя ошибка'});}finally{active.delete(runId);busy.delete(key);await emitAccountsToUser(userId);}
 });
 socket.on('cancel',(runId:unknown)=>{if(typeof runId==='string'){const run=active.get(runId);if(run?.userId===userId)run.controller.abort();}});
});
http.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('AI Router control plane ready'));
startPreviewServer(Number(process.env.PREVIEW_PORT||3001));

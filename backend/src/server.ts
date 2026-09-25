import express from 'express';
import session from 'express-session';
import sessionFileStore from 'session-file-store';
import helmet from 'helmet';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { z } from 'zod';
import { addAccount, assignAccount, createSession, dataRoot, getSession, listAccounts, listSessions, prepareUser, saveSession } from './store.js';
import { ensureAdmin, findUserById, findUserByName, registerUser, verifyPassword } from './auth.js';
import { createPairing, enroll, listRunners, ownsRunner, revokeRunner, runnerSocket, setConnected, verifyRunner } from './runners.js';
import { attachJobHandlers, dispatch, JobError } from './jobs.js';
import { LimitManager } from './limits.js';
import { modelCatalog, type AIEvent, type AIEventType, type ProviderId } from './types.js';

const secret=process.env.SESSION_SECRET,password=process.env.ADMIN_PASSWORD;
if(!secret||secret.length<32||!password||password.length<12)throw new Error('Set SESSION_SECRET (32+ chars) and ADMIN_PASSWORD (12+ chars)');
await ensureAdmin(process.env.ADMIN_USER||'admin',password);
const app=express();app.set('trust proxy',1);app.use(helmet());app.use(express.json({limit:'32kb'}));
const FileStore=sessionFileStore(session);
const sessionMiddleware=session({name:'router.sid',secret,store:new FileStore({path:dataRoot+'/http-sessions',retries:0}),resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:process.env.COOKIE_SECURE==='true',maxAge:7*86400000}});app.use(sessionMiddleware);
declare module 'express-session' { interface SessionData { userId?:string; } }
const requireAuth:express.RequestHandler=(req,res,next)=>req.session.userId?next():res.status(401).json({error:'Войдите в приложение'});
app.use('/api',(req,res,next)=>{if(['POST','PUT','PATCH','DELETE'].includes(req.method)){const origin=req.headers.origin;if(origin){try{if(new URL(origin).host!==req.get('host'))return res.status(403).json({error:'Invalid origin'});}catch{return res.status(403).json({error:'Invalid origin'});}}}next();});
const attempts=new Map<string,{count:number;until:number}>();
function blocked(ip:string){return (attempts.get(ip)?.until||0)>Date.now();}
function fail(ip:string){const old=attempts.get(ip);const count=(old&&old.until===0?old.count:0)+1;attempts.set(ip,{count:count>=8?0:count,until:count>=8?Date.now()+60000:0});}
const credentials=z.object({username:z.string().trim().regex(/^[a-zA-Z0-9_.-]{3,40}$/),password:z.string().min(12).max(200)});
app.post('/api/register',async(req,res)=>{if(process.env.ALLOW_SIGNUP==='false')return res.status(403).json({error:'Регистрация отключена'});const ip=req.ip||'unknown';if(blocked(ip))return res.status(429).json({error:'Попробуйте позже'});const p=credentials.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Логин 3–40 символов; пароль от 12 символов'});try{const user=await registerUser(p.data.username,p.data.password);await prepareUser(user.id);req.session.regenerate(err=>{if(err)return res.status(500).json({error:'Ошибка сессии'});req.session.userId=user.id;res.status(201).json({username:user.username});});}catch(e){res.status(409).json({error:e instanceof Error?e.message:'Ошибка регистрации'});}});
app.post('/api/login',async(req,res)=>{const ip=req.ip||'unknown';if(blocked(ip))return res.status(429).json({error:'Попробуйте позже'});const p=credentials.safeParse(req.body);if(!p.success)return res.status(401).json({error:'Неверный логин или пароль'});const user=await findUserByName(p.data.username);if(!await verifyPassword(user,p.data.password)){fail(ip);return res.status(401).json({error:'Неверный логин или пароль'});}attempts.delete(ip);req.session.regenerate(err=>{if(err)return res.status(500).json({error:'Ошибка сессии'});req.session.userId=user!.id;res.json({username:user!.username});});});
app.post('/api/logout',requireAuth,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/me',requireAuth,async(req,res)=>{const user=await findUserById(req.session.userId!);res.status(user?200:401).json(user?{username:user.username}:{error:'Пользователь не найден'});});
const limits=new LimitManager();
async function accountStatuses(userId:string){const accounts=await listAccounts(userId),runners=await listRunners(userId);return accounts.map(a=>{const runner=runners.find(r=>r.id===a.runnerId&&!r.revokedAt),mode=!runner?'unassigned':runner.online?'runner':'offline';return {...a,models:modelCatalog[a.provider],mode,auth:runner?.online?'unknown':'missing',detail:!runner?'Назначьте исполнительный контейнер':runner.online?`Исполнитель ${runner.name} подключён`:`Исполнитель ${runner.name} не в сети`,limit:limits.snapshot(userId,a.id)};});}
app.get('/api/accounts',requireAuth,async(req,res)=>res.json(await accountStatuses(req.session.userId!)));
app.post('/api/accounts',requireAuth,async(req,res)=>{const p=z.object({provider:z.enum(['codex','antigravity']),name:z.string().trim().min(1).max(60),runnerId:z.string().uuid()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Укажите провайдера, название и контейнер'});const userId=req.session.userId!;if(!await ownsRunner(userId,p.data.runnerId))return res.status(403).json({error:'Контейнер не принадлежит вам'});res.status(201).json(await addAccount(userId,p.data.provider,p.data.name,p.data.runnerId));});
app.patch('/api/accounts/:id',requireAuth,async(req,res)=>{const p=z.object({runnerId:z.string().uuid()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Неверный контейнер'});const userId=req.session.userId!;if(!await ownsRunner(userId,p.data.runnerId))return res.status(403).json({error:'Контейнер не принадлежит вам'});const account=await assignAccount(userId,req.params.id,p.data.runnerId);res.status(account?200:404).json(account||{error:'Аккаунт не найден'});});
app.get('/api/runners',requireAuth,async(req,res)=>res.json(await listRunners(req.session.userId!)));
app.post('/api/runners/pairing',requireAuth,async(req,res)=>{const p=z.object({name:z.string().trim().min(1).max(60)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Укажите название контейнера'});res.status(201).json(await createPairing(req.session.userId!,p.data.name));});
app.post('/api/runner/enroll',async(req,res)=>{const p=z.object({code:z.string().min(20).max(100)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Неверный код'});try{res.status(201).json(await enroll(p.data.code));}catch{res.status(401).json({error:'Код недействителен или истёк'});}});
app.delete('/api/runners/:id',requireAuth,async(req,res)=>res.status(await revokeRunner(req.session.userId!,req.params.id)?200:404).json({ok:true}));
app.get('/api/sessions',requireAuth,async(req,res)=>res.json(await listSessions(req.session.userId!)));
app.post('/api/sessions',requireAuth,async(req,res)=>res.status(201).json(await createSession(req.session.userId!)));
app.get('/api/sessions/:id',requireAuth,async(req,res)=>{const s=await getSession(req.session.userId!,req.params.id);res.status(s?200:404).json(s||{error:'Чат не найден'});});
app.get('/api/health',(_req,res)=>res.json({ok:true}));

const http=createServer(app),io=new Server(http,{path:'/socket.io',cors:{origin:false}});io.engine.use(sessionMiddleware);
const runnerNs=io.of('/runner');
runnerNs.use(async(socket,next)=>{const {runnerId,secret}=socket.handshake.auth||{};if(typeof runnerId!=='string'||typeof secret!=='string')return next(new Error('unauthorized'));const record=await verifyRunner(runnerId,secret);if(!record)return next(new Error('unauthorized'));socket.data.runnerId=record.id;socket.data.userId=record.userId;next();});
runnerNs.on('connection',socket=>setConnected(socket.data.runnerId as string,socket));attachJobHandlers(runnerNs);
io.use((socket,next)=>{const req=socket.request as express.Request,origin=req.headers.origin,host=req.headers.host;try{if(!req.session?.userId||origin&&host&&new URL(origin).host!==host)return next(new Error('unauthorized'));next();}catch{next(new Error('unauthorized'));}});
const active=new Map<string,{userId:string;controller:AbortController}>(),busy=new Set<string>(),cursors=new Map<string,number>();
const sendSchema=z.object({sessionId:z.string().uuid(),prompt:z.string().trim().min(1).max(16000),accountId:z.string().uuid().or(z.literal('auto')),model:z.string().min(1).max(100),mode:z.enum(['chat','task'])});
io.on('connection',socket=>{const userId=(socket.request as express.Request).session.userId!;
 socket.on('run',async(raw:unknown,ack?:(r:unknown)=>void)=>{const parsed=sendSchema.safeParse(raw);if(!parsed.success)return ack?.({ok:false,error:'Неверные параметры'});const input=parsed.data,key=userId+':'+input.sessionId;if(busy.has(key))return ack?.({ok:false,error:'Этот чат уже занят'});const chat=await getSession(userId,input.sessionId);if(!chat)return ack?.({ok:false,error:'Чат не найден'});const accounts=await listAccounts(userId),cursor=cursors.get(userId)||0;const choices=input.accountId==='auto'&&accounts.length?accounts.slice(cursor%accounts.length).concat(accounts.slice(0,cursor%accounts.length)):accounts.filter(a=>a.id===input.accountId);if(input.accountId==='auto'&&accounts.length)cursors.set(userId,(cursor+1)%accounts.length);if(!choices.length)return ack?.({ok:false,error:'Добавьте подключение'});
  const runId=randomUUID(),controller=new AbortController();busy.add(key);active.set(runId,{userId,controller});ack?.({ok:true,runId});const emit=(type:AIEventType,accountId?:string,provider?:ProviderId,extra:Partial<AIEvent>={})=>{const event:AIEvent={id:randomUUID(),sessionId:chat.id,runId,at:new Date().toISOString(),type,provider,...extra,data:{accountId,...extra.data}};socket.emit('ai:event',event);};
  const now=new Date().toISOString();chat.messages.push({id:randomUUID(),role:'user',text:input.prompt,at:now});if(chat.title==='Новый чат')chat.title=input.prompt.slice(0,45);chat.updatedAt=now;await saveSession(userId,chat);emit('started',undefined,undefined,{message:'Запрос принят'});let done=false;const errors:string[]=[];
  try{for(const a of choices){if(controller.signal.aborted)break;if(!a.runnerId||!await ownsRunner(userId,a.runnerId)||!runnerSocket(a.runnerId)){errors.push(`${a.name}: исполнитель не в сети`);emit('fallback',a.id,a.provider,{message:`${a.name}: исполнитель не в сети`});continue;}if(!limits.available(userId,a.id)){errors.push(`${a.name}: локальный лимит`);emit('fallback',a.id,a.provider,{message:`${a.name}: локальный лимит`});continue;}let produced=false,touched=false;try{limits.consume(userId,a.id);emit('status',a.id,a.provider,{message:`${a.name}: отправлено исполнителю`});const history=chat.messages.slice(-12,-1).map(m=>`${m.role==='user'?'User':'Assistant'}: ${m.text}`).join('\n');const prompt=history?`Conversation context:\n${history}\n\nCurrent user request:\n${input.prompt}`:input.prompt;const model=modelCatalog[a.provider].some(m=>m.id===input.model)?input.model:'default';const text=await dispatch(a.runnerId,{accountId:a.id,provider:a.provider,sessionId:chat.id,prompt,model,mode:input.mode},controller.signal,e=>{if(e.type==='delta')produced=true;if(e.type==='tool')touched=true;emit(e.type,a.id,a.provider,e);});chat.messages.push({id:randomUUID(),role:'assistant',text,provider:a.provider,at:new Date().toISOString()});chat.updatedAt=new Date().toISOString();await saveSession(userId,chat);emit('completed',a.id,a.provider,{text,message:'Готово'});done=true;break;}catch(e){if(e instanceof JobError&&e.code==='rate_limit')limits.rateLimited(userId,a.id);const reason=e instanceof Error?e.message:'Ошибка';errors.push(`${a.name}: ${reason}`);if(input.accountId==='auto'&&!produced&&!touched&&!controller.signal.aborted){emit('fallback',a.id,a.provider,{message:`${a.name}: ${reason}. Пробуем следующий аккаунт.`});continue;}break;}}if(!done)emit('error',undefined,undefined,{message:controller.signal.aborted?'Остановлено пользователем':errors.join(' · ')||'Нет доступного подключения'});
  }catch(e){emit('error',undefined,undefined,{message:e instanceof Error?e.message:'Внутренняя ошибка'});}finally{active.delete(runId);busy.delete(key);socket.emit('accounts:changed',await accountStatuses(userId));}
 });
 socket.on('cancel',(runId:unknown)=>{if(typeof runId==='string'){const run=active.get(runId);if(run?.userId===userId)run.controller.abort();}});
});
http.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('AI Router control plane ready'));

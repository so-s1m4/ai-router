import { cccCandidateAccount, CccGrantUsage } from './ccc-access.js';
import { cccAutoSchema } from './ccc-settings.js';
import { readCccSettings, saveCccSettings } from './ccc-settings-store.js';
import { personalMcpSchema, readPersonalMcp, publicPersonalMcp, mutatePersonalMcp } from './personal-mcp.js';
import { sendSchema } from './run-input.js';
import { lockProject, markProjectDirty, prepareProjectRunner, projectRunnerValid, saveProjectSnapshot } from './project-sync.js';
import { acquireGrant, onGrantCharged, chargeGrant, createGrant, flushGrantCharges, listGrants, releaseGrant, updateGrant, type AccessGrant } from './access-grants.js';
import { telegramStatus, telegramConnect, telegramDisconnect, telegramEnable, notifyTelegram, startTelegram, setTelegramController } from './telegram.js';
import { automaticModels, modelRank, requestedReasoning, taskComplexity } from './model-routing.js';
import { UsageLedger } from './usage-summary.js';
import { TaskQueue } from './task-queue.js';
import express from 'express';
import session from 'express-session';
import sessionFileStore from 'session-file-store';
import helmet from 'helmet';
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { Server } from 'socket.io';
import { z } from 'zod';
import { addAccount, addImportedCodexAccount, assignAccount, createProject, createSession, dataRoot, deleteAccount, deleteSession, getProject, getSession, getUserModelBlacklist, listAccounts, listProjects, listSessions, prepareUser, saveSession, setAccountPriority, setUserModelBlacklist, updateSharedProject } from './store.js';
import { orderAccountsByPriority } from './account-priority.js';
import { changeUserPassword, deleteUser, ensureAdmin, findUserById, findUserByName, listUsers, registerUser, verifyPassword } from './auth.js';
import { createPairing, enroll, listRunners, ownsRunner, revokeRunner, runnerSocket, setConnected, verifyRunner, managerSocket, setManagerConnected, createManagerPairing, enrollManager, verifyManager } from './runners.js';
import { attachJobHandlers, dispatch, steerJob, JobError } from './jobs.js';
import { uploadProjectFile } from './files.js';
import { createFileShare, deleteWorkspaceFile, downloadSharedFile, getWorkspaceGitSummary, listWorkspaceFiles, readWorkspacePreview } from './shared-files.js';
import { AccountUsageManager } from './usage.js';
import { normalizeTokenUsage, sumTokenUsage } from './token-usage.js';
import { attachPreviewHandlers, listPreviews, loadPreviews, setPreviewVisibility, startPreviewServer } from './previews.js';
import { modelCatalog, resolveAccountModels, type AIEvent, type AIEventType, type Model, type ProviderId, type TokenUsage, type ChatSession } from './types.js';

const secret=process.env.SESSION_SECRET,password=process.env.ADMIN_PASSWORD;
if(!secret||secret.length<32||!password||password.length<12)throw new Error('Set SESSION_SECRET (32+ chars) and ADMIN_PASSWORD (12+ chars)');
await ensureAdmin(process.env.ADMIN_USER||'admin',password);
await loadPreviews();
const app=express();app.set('trust proxy',1);app.use(helmet());app.use(express.json({limit:'128kb'}));
const FileStore=sessionFileStore(session);
const sessionMiddleware=session({name:'router.sid',secret,store:new FileStore({path:dataRoot+'/http-sessions',retries:0}),resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:process.env.COOKIE_SECURE==='true',maxAge:7*86400000}});app.use(sessionMiddleware);
declare module 'express-session' { interface SessionData { userId?:string; } }
const requireAuth:express.RequestHandler=async(req,res,next)=>req.session.userId&&await findUserById(req.session.userId)?next():res.status(401).json({error:'Login to the application'});
const requireOwner:express.RequestHandler=(req,res,next)=>req.session.userId==='owner'?next():res.status(403).json({error:'Only available to the owner'});
app.use('/api',(req,res,next)=>{if(['POST','PUT','PATCH','DELETE'].includes(req.method)){const origin=req.headers.origin;if(origin){try{if(new URL(origin).host!==req.get('host'))return res.status(403).json({error:'Invalid origin'});}catch{return res.status(403).json({error:'Invalid origin'});}}}next();});
const attempts=new Map<string,{count:number;until:number}>();
function blocked(ip:string){return (attempts.get(ip)?.until||0)>Date.now();}
function fail(ip:string){const old=attempts.get(ip);const count=(old&&old.until===0?old.count:0)+1;attempts.set(ip,{count:count>=8?0:count,until:count>=8?Date.now()+60000:0});}
const credentials=z.object({username:z.string().trim().regex(/^[a-zA-Z0-9_.-]{3,40}$/),password:z.string().min(12).max(200)});
app.post('/api/register',async(req,res)=>{if(process.env.ALLOW_SIGNUP==='false')return res.status(403).json({error:'Registration disabled'});const ip=req.ip||'unknown';if(blocked(ip))return res.status(429).json({error:'Try again later'});const p=credentials.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Username: 3–40 characters; password: at least 12 characters'});try{const user=await registerUser(p.data.username,p.data.password);await prepareUser(user.id);req.session.regenerate(err=>{if(err)return res.status(500).json({error:'Session error'});req.session.userId=user.id;req.session.save(saveError=>saveError?res.status(500).json({error:'Error saving session'}):res.status(201).json({username:user.username,isOwner:false}));});}catch(e){res.status(409).json({error:e instanceof Error?e.message:'Registration error'});}});
app.post('/api/login',async(req,res)=>{const ip=req.ip||'unknown';if(blocked(ip))return res.status(429).json({error:'Try again later'});const p=credentials.safeParse(req.body);if(!p.success)return res.status(401).json({error:'Invalid login or password'});const user=await findUserByName(p.data.username);if(!await verifyPassword(user,p.data.password)){fail(ip);return res.status(401).json({error:'Invalid login or password'});}attempts.delete(ip);req.session.regenerate(err=>{if(err)return res.status(500).json({error:'Session error'});req.session.userId=user!.id;req.session.save(saveError=>saveError?res.status(500).json({error:'Error saving session'}):res.json({username:user!.username,isOwner:user!.id==='owner'}));});});
app.post('/api/logout',requireAuth,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/notifications/telegram',requireAuth,async(req,res)=>res.json(await telegramStatus(req.session.userId!)));
app.post('/api/notifications/telegram/connect',requireAuth,async(req,res)=>{try{res.json(await telegramConnect(req.session.userId!));}catch(e){res.status(503).json({error:e instanceof Error?e.message:'Telegram is unavailable'});}});
app.delete('/api/notifications/telegram',requireAuth,async(req,res)=>{await telegramDisconnect(req.session.userId!);res.json({ok:true});});
app.patch('/api/notifications/telegram',requireAuth,async(req,res)=>{const p=z.object({enabled:z.boolean()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Incorrect settings'});try{await telegramEnable(req.session.userId!,p.data.enabled);res.json({ok:true});}catch(e){res.status(400).json({error:e instanceof Error?e.message:'Error'});}});
app.get('/api/me',requireAuth,async(req,res)=>{const user=await findUserById(req.session.userId!);res.status(user?200:401).json(user?{username:user.username,isOwner:user.id==='owner'}:{error:'User not found'});});
app.get('/api/users',requireAuth,requireOwner,async(_req,res)=>res.json(await listUsers()));
app.post('/api/users',requireAuth,requireOwner,async(req,res)=>{const p=credentials.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Username: 3–40 characters; password: at least 12 characters'});try{const user=await registerUser(p.data.username,p.data.password);await prepareUser(user.id);res.status(201).json({id:user.id,username:user.username,createdAt:user.createdAt});}catch(e){res.status(409).json({error:e instanceof Error?e.message:'Error creating user'});}});
app.put('/api/users/:id/password',requireAuth,requireOwner,async(req,res)=>{if(req.params.id==='owner')return res.status(400).json({error:'The owner password is set in the server settings'});const p=z.object({password:z.string().min(12).max(200)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'The password must contain from 12 to 200 characters'});res.status(await changeUserPassword(req.params.id,p.data.password)?200:404).json({ok:true});});
app.delete('/api/users/:id',requireAuth,requireOwner,async(req,res)=>{if(req.params.id==='owner')return res.status(400).json({error:'The owner cannot be deleted'});if(!await deleteUser(req.params.id))return res.status(404).json({error:'User not found'});for(const client of io.sockets.sockets.values())if((client.request as express.Request).session.userId===req.params.id)client.disconnect(true);res.json({ok:true});});
const usage=new AccountUsageManager();
const accountModels=new Map<string,Model[]>();
const accountErrors=new Map<string,string>();
function getModelsForAccount(accountId:string,provider:ProviderId,authType?:'api_key'):Model[]{
  const models=resolveAccountModels(provider, accountModels.get(accountId));
  if(provider==='codex'&&authType!=='api_key'&&!models.some(model=>model.id==='gpt-6.1-sol'))models.push({id:'gpt-6.1-sol',label:'GPT-6.1 Sol',reasoning:['low','medium','high','xhigh','max'].map(id=>({id,label:id})),defaultReasoning:'medium'});
  return models;
}
type AccessibleAccount = Awaited<ReturnType<typeof listAccounts>>[number] & { grant?: AccessGrant; ownerId: string };
async function accessibleAccounts(userId:string):Promise<AccessibleAccount[]> {
 const own:AccessibleAccount[]=(await listAccounts(userId)).map(a=>({...a,ownerId:userId}));
 const incoming=(await listGrants(userId)).filter(g=>g.recipientId===userId&&g.state==='active');
 for(const grant of incoming){
  if(!await findUserById(grant.ownerId))continue;
  for(const account of await listAccounts(grant.ownerId))own.push({...account,name:'Access from '+grant.ownerName,ownerId:grant.ownerId,grant});
 }
 return own;
}
function accessibleModels(a:AccessibleAccount):Model[]{
 const models=getModelsForAccount(a.id,a.provider,a.authType);
 return a.grant?models.filter(m=>a.grant!.models.includes(m.id)):models;
}
async function accountStatuses(userId:string){
 const accounts=await accessibleAccounts(userId);
 const statuses=await Promise.all(accounts.map(async a=>{
  const runners=await listRunners(a.ownerId),runner=runners.find(r=>r.id===a.runnerId&&!r.revokedAt);
  const models=accessibleModels(a),grant=a.grant;
  if(grant)return {id:grant.id+':'+a.provider,provider:a.provider,name:'Access from '+grant.ownerName,models,mode:runner?.online&&grant.usedTokens<grant.budget?'runner':'offline',auth:'unknown',detail:grant.usedTokens>=grant.budget?'The budget is exhausted':'Remaining '+Math.max(0,grant.budget-grant.usedTokens).toLocaleString('en-US')+' tokens',shared:true,limit:usage.snapshot(userId,'')};
  const {importKey:_importKey,ownerId:_ownerId,grant:_grant,...publicAccount}=a;
  const mode=!runner?'unassigned':runner.online?'runner':'offline',statusError=accountErrors.get(a.id);
  return {...publicAccount,models,mode,auth:runner?.online?'unknown':'missing',detail:statusError?'Connection error: '+statusError:!runner?'Assign an execution container':runner.online?'Runner '+runner.name+' connected':'Runner '+runner.name+' offline',limit:usage.snapshot(userId,a.id)};
 }));
 // Present a pool per provider without physical account identifiers.
 const pooled:typeof statuses=[];
 for(const status of statuses){
  const existing=pooled.find(a=>a.id===status.id);
  if(!existing){pooled.push(status);continue;}
  existing.models=[...new Map([...existing.models,...status.models].map(m=>[m.id,m])).values()];
  if(status.mode==='runner')existing.mode='runner';
 }
 return pooled;
}
async function emitAccountsToUser(userId:string){const accounts=await accountStatuses(userId);for(const client of io.sockets.sockets.values())if((client.request as express.Request).session.userId===userId)client.emit('accounts:changed',accounts);const recipients=new Set((await listGrants(userId)).filter(g=>g.ownerId===userId&&g.state==='active').map(g=>g.recipientId));for(const recipientId of recipients){const shared=await accountStatuses(recipientId);io.to('user:'+recipientId).emit('accounts:changed',shared);}}
async function pushRunnerAccounts(userId:string,runnerId:string){const socket=runnerSocket(runnerId);if(!socket)return;const accounts=await listAccounts(userId);socket.emit('accounts:list',accounts.filter(a=>a.runnerId===runnerId).map(a=>({id:a.id,provider:a.provider,authType:a.authType})));}
app.get('/api/accounts',requireAuth,async(req,res)=>res.json(await accountStatuses(req.session.userId!)));
const pendingAccountResets=new Set<string>();
app.post('/api/accounts/:id/reset',requireAuth,async(req,res)=>{
 const userId=req.session.userId!;
 const parsed=z.object({idempotencyKey:z.string().uuid()}).strict().safeParse(req.body);
 if(!parsed.success)return res.status(400).json({error:'Invalid reset request'});
 const account=(await listAccounts(userId)).find(a=>a.id===req.params.id);
 if(!account)return res.status(404).json({error:'Account not found'});
 if(account.provider!=='codex'||account.authType==='api_key')return res.status(400).json({error:'Resets require a ChatGPT subscription account'});
 if(!account.runnerId||!await ownsRunner(userId,account.runnerId))return res.status(403).json({error:'Account runner unavailable'});
 const socket=runnerSocket(account.runnerId);
 if(!socket)return res.status(503).json({error:'The runner is offline'});
 if(pendingAccountResets.has(account.id))return res.status(409).json({error:'A reset is already in progress'});
 pendingAccountResets.add(account.id);
 try{
  const result=await socket.timeout(20000).emitWithAck('account:reset',{accountId:account.id,idempotencyKey:parsed.data.idempotencyKey}) as {ok?:boolean;outcome?:string;error?:string};
  if(!result?.ok)return res.status(502).json({error:result?.error||'Reset failed'});
  if(!['reset','nothingToReset','noCredit','alreadyRedeemed'].includes(result.outcome||''))return res.status(502).json({error:'Unexpected reset response'});
  if(result.outcome==='reset')usage.clearCooldown(userId,account.id);
  res.json({outcome:result.outcome});
 }catch{res.status(504).json({error:'Reset response was lost. Retry uses the same reset attempt.'});}
 finally{pendingAccountResets.delete(account.id);}
});

app.get('/api/personal-mcp', requireAuth, async (req, res) => {
 try { res.json(publicPersonalMcp(await readPersonalMcp(req.session.userId!))); }
 catch { res.status(500).json({error:'Could not read personal MCP settings'}); }
});
app.put('/api/personal-mcp/:name', requireAuth, async (req, res) => {
 const parsed = personalMcpSchema.safeParse({...req.body, name:req.params.name});
 if (!parsed.success) return res.status(400).json({error:'Provide a valid MCP name, HTTPS URL and unique HTTP headers'});
 try { res.json(await mutatePersonalMcp(req.session.userId!, servers => [...servers.filter(server => server.name !== parsed.data.name), parsed.data])); }
 catch (error) { res.status(400).json({error:error instanceof Error ? error.message : 'Could not save MCP'}); }
});
app.delete('/api/personal-mcp/:name', requireAuth, async (req, res) => {
 try { res.json(await mutatePersonalMcp(req.session.userId!, servers => servers.filter(server => server.name !== req.params.name))); }
 catch { res.status(500).json({error:'Could not remove MCP'}); }
});

app.get('/api/ccc-auto/settings',requireAuth,async(req,res)=>{res.json(await readCccSettings(req.session.userId!));});
app.post('/api/ccc-auto/settings/validate',requireAuth,(req,res)=>{const parsed=cccAutoSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:parsed.error.issues.map(i=>i.message).join('; ')});res.json(parsed.data);});
app.put('/api/ccc-auto/settings',requireAuth,async(req,res)=>{
 const parsed=cccAutoSchema.safeParse(req.body);
 if(!parsed.success)return res.status(400).json({error:parsed.error.issues.map(i=>i.message).join('; ')});
 const accounts=await accessibleAccounts(req.session.userId!),blacklist=await getUserModelBlacklist(req.session.userId!);
 if(parsed.data.levels.some(r=>r.candidates.some(c=>c.enabled&&!cccCandidateAccount(c,accounts,accessibleModels,blacklist))))return res.status(400).json({error:'Candidate connection or model is unavailable, disabled, or outside your shared allowance'});
 await saveCccSettings(req.session.userId!,parsed.data);res.json(parsed.data);
});

const grantSettings=z.object({budget:z.number().int('Token budget must be a whole number').positive('Token budget must be positive').max(1_000_000_000_000,'Token budget must not exceed 1,000,000,000,000'),models:z.array(z.string().min(1).max(100)).min(1,'Select at least one model')});
app.get('/api/access-grants',requireAuth,async(req,res)=>{
 const userId=req.session.userId!;
 res.json((await listGrants(userId)).map(({ownerId,recipientId,...g})=>({...g,direction:ownerId===userId?'outgoing':'incoming'})));
});
app.post('/api/access-grants',requireAuth,async(req,res)=>{
 const p=grantSettings.extend({username:z.string().trim().min(3,'Friend username must contain at least 3 characters').max(40,'Friend username must not exceed 40 characters'),period:z.enum(['once','monthly'])}).strict().safeParse(req.body);
 if(!p.success)return res.status(400).json({error:p.error.issues.map(issue=>issue.message).join('; ')});
 const userId=req.session.userId!,recipient=await findUserByName(p.data.username),owner=await findUserById(userId);
 if(!recipient||recipient.id===userId)return res.status(400).json({error:'Enter the login of another registered user'});
 const accounts=await listAccounts(userId);
 if(!accounts.length)return res.status(400).json({error:'Add at least one connection'});
 const models=accounts.flatMap(a=>getModelsForAccount(a.id,a.provider,a.authType));
 if(p.data.models.some(id=>!models.some(m=>m.id===id)))return res.status(400).json({error:'Model not available in your connections'});
 const grant=await createGrant({ownerId:userId,ownerName:owner!.username,recipientId:recipient.id,recipientName:recipient.username,models:p.data.models,budget:p.data.budget,period:p.data.period});
 res.status(201).json({id:grant.id});
});
app.patch('/api/access-grants/:id',requireAuth,async(req,res)=>{
 const p=grantSettings.partial().extend({state:z.enum(['active','revoked']).optional()}).strict().refine(v=>Object.keys(v).length>0).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:'Incorrect access settings'});
 const userId=req.session.userId!,existing=(await listGrants(userId)).find(g=>g.id===req.params.id);
 if(!existing)return res.status(404).json({error:'Access not found'});
 if(p.data.models){const models=(await listAccounts(existing.ownerId)).flatMap(a=>getModelsForAccount(a.id,a.provider,a.authType));if(p.data.models.some(id=>!models.some(m=>m.id===id)))return res.status(400).json({error:'Model not available'});}
 const grant=await updateGrant(userId,req.params.id,p.data);
 if(!grant)return res.status(403).json({error:'This access cannot be changed'});
 for(const run of active.values())if((run.grantId===grant.id||run.cccGrantIds?.includes(grant.id))&&(grant.state==='revoked'||grant.usedTokens>=grant.budget||!!p.data.models)){run.stopReason='Shared access changed, revoked or budget exhausted';run.controller.abort();}
 await emitAccountsToUser(grant.recipientId);res.json({ok:true});
});
app.post('/api/accounts',requireAuth,async(req,res)=>{const p=z.object({provider:z.enum(['codex','antigravity','chatgpt','openrouter']),name:z.string().trim().min(1).max(60),runnerId:z.string().uuid(),authType:z.literal('api_key').optional()}).refine(v=>(!v.authType||v.provider==='codex'||v.provider==='openrouter')&&(v.provider!=='openrouter'||v.authType==='api_key')).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Specify the provider, name and container'});const userId=req.session.userId!;if(!await ownsRunner(userId,p.data.runnerId))return res.status(403).json({error:'The container does not belong to you'});const account=await addAccount(userId,p.data.provider,p.data.name,p.data.runnerId,p.data.authType);await pushRunnerAccounts(userId,p.data.runnerId);res.status(201).json(account);});
app.put('/api/accounts/:id/api-key',requireAuth,async(req,res)=>{
  const parsed=z.object({apiKey:z.string().trim().min(20).max(512).regex(/^sk-[A-Za-z0-9_-]+$/)}).strict().safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'Enter the API key (sk-…)'});
  const userId=req.session.userId!;
  const account=(await listAccounts(userId)).find(a=>a.id===req.params.id&&['codex','openrouter'].includes(a.provider)&&a.authType==='api_key');
  if(!account?.runnerId)return res.status(404).json({error:'API connection not found'});
  const socket=runnerSocket(account.runnerId);
  if(!socket)return res.status(503).json({error:'The runner is offline'});
  try {
    const result=await socket.timeout(25000).emitWithAck(account.provider==='openrouter'?'account:openrouter-key':'account:openai-key',{accountId:account.id,apiKey:parsed.data.apiKey}) as {ok?:boolean;error?:string};
    if(!result?.ok)return res.status(400).json({error:result?.error||'Runner did not save the key'});
    await pushRunnerAccounts(userId,account.runnerId);
    res.json({ok:true});
  } catch {res.status(504).json({error:'Runner didn’t answer. Check its version and connection.'});}
});
app.patch('/api/accounts/:id',requireAuth,async(req,res)=>{const p=z.object({runnerId:z.string().uuid()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid container'});const userId=req.session.userId!;if(!await ownsRunner(userId,p.data.runnerId))return res.status(403).json({error:'The container does not belong to you'});const account=await assignAccount(userId,req.params.id,p.data.runnerId);if(account)await pushRunnerAccounts(userId,p.data.runnerId);res.status(account?200:404).json(account||{error:'Account not found'});});
app.patch('/api/accounts/:id/priority',requireAuth,async(req,res)=>{const p=z.object({priority:z.union([z.literal(0),z.literal(1),z.literal(2)])}).strict().safeParse(req.body);if(!p.success)return res.status(400).json({error:'Priority must be low, normal or high'});const userId=req.session.userId!;const account=await setAccountPriority(userId,req.params.id,p.data.priority);if(account)await emitAccountsToUser(userId);res.status(account?200:404).json(account||{error:'Account not found'});});
app.delete('/api/accounts/:id',requireAuth,async(req,res)=>{const userId=req.session.userId!;if([...active.values()].some(run=>run.userId===userId&&(run.accountId===req.params.id||run.cccAccountIds?.includes(req.params.id))))return res.status(409).json({error:'Wait for the task to complete on this account'});const account=await deleteAccount(userId,req.params.id);if(!account)return res.status(404).json({error:'Account not found'});accountModels.delete(account.id);accountErrors.delete(account.id);usage.remove(userId,account.id);if(account.runnerId)await pushRunnerAccounts(userId,account.runnerId);await emitAccountsToUser(userId);res.json({ok:true});});
app.post('/api/accounts/:id/chatgpt-session',requireAuth,async(req,res)=>{const userId=req.session.userId!;const accounts=await listAccounts(userId);const account=accounts.find(a=>a.id===req.params.id&&a.provider==='chatgpt');if(!account)return res.status(404).json({error:'ChatGPT account not found'});if(!account.runnerId)return res.status(400).json({error:'First, assign a runner to the account'});const socket=runnerSocket(account.runnerId);if(!socket)return res.status(503).json({error:'The runner is offline'});const p=z.object({sessionToken:z.string().trim().optional(),cookies:z.array(z.any()).optional()}).safeParse(req.body);if(!p.success||(!p.data.sessionToken&&!p.data.cookies?.length))return res.status(400).json({error:'Specify a sessionToken or an array of cookies'});try{const result=await socket.timeout(10000).emitWithAck('account:chatgpt-session',{accountId:account.id,sessionToken:p.data.sessionToken,cookies:p.data.cookies}) as {ok?:boolean;error?:string};if(!result?.ok)return res.status(500).json({error:result?.error||'The runner declined to save the session'});res.json({ok:true});}catch(error){res.status(504).json({error:'The runner did not respond'});}});
app.get('/api/runners',requireAuth,async(req,res)=>res.json(await listRunners(req.session.userId!)));
app.post('/api/runners/pairing',requireAuth,async(req,res)=>{const p=z.object({name:z.string().trim().min(1).max(60)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Specify the name of the container'});res.status(201).json(await createPairing(req.session.userId!,p.data.name));});
app.post('/api/runner/enroll',async(req,res)=>{const p=z.object({code:z.string().min(20).max(100)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid code'});try{res.status(201).json(await enroll(p.data.code));}catch{res.status(401).json({error:'The code is invalid or has expired'});}});
app.post('/api/runners/:id/management/pairing',requireAuth,async(req,res)=>{try{res.status(201).json(await createManagerPairing(req.session.userId!,req.params.id));}catch{res.status(404).json({error:'runner not found'});}});
app.post('/api/runner/manager/enroll',async(req,res)=>{const p=z.object({code:z.string().min(20).max(100)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid code'});try{res.status(201).json(await enrollManager(p.data.code));}catch{res.status(401).json({error:'The code is invalid or has expired'});}});
app.post('/api/runner/accounts/import',async(req,res)=>{const id=req.get('X-Runner-ID'),secret=req.get('X-Runner-Secret');if(!id||!secret)return res.status(401).json({error:'The runner is not authorized'});const runner=await verifyRunner(id,secret);if(!runner)return res.status(401).json({error:'The runner is not authorized'});const p=z.object({name:z.string().trim().min(1).max(60),importKey:z.string().regex(/^[a-f0-9]{64}$/)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid profile information'});const account=await addImportedCodexAccount(runner.userId,p.data.name,runner.id,p.data.importKey);await pushRunnerAccounts(runner.userId,runner.id);res.status(201).json({id:account.id,name:account.name});});
app.delete('/api/runners/:id',requireAuth,async(req,res)=>res.status(await revokeRunner(req.session.userId!,req.params.id)?200:404).json({ok:true}));
app.get('/api/runners/:id/previews',requireAuth,async(req,res)=>{if(!await ownsRunner(req.session.userId!,req.params.id))return res.status(404).json({error:'runner not found'});res.json(listPreviews(req.session.userId!,req.params.id));});
app.patch('/api/runners/:id/previews/:subdomain',requireAuth,async(req,res)=>{if(!await ownsRunner(req.session.userId!,req.params.id))return res.status(404).json({error:'runner not found'});const parsed=z.object({visible:z.boolean()}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Specify visibility'});const record=await setPreviewVisibility(req.session.userId!,req.params.id,req.params.subdomain,parsed.data.visible);res.status(record?200:404).json(record||{error:'Site not found'});});
const managementOps=z.enum(['overview','keys.create','keys.delete','github.test','containers.inspect','containers.start','containers.stop','containers.restart','containers.recreate','containers.remove','mcp.list','mcp.add','mcp.headers','mcp.remove','auth.start','auth.status','auth.cancel']);
app.post('/api/runners/:id/management/challenge',requireAuth,async(req,res)=>{
 if(!await ownsRunner(req.session.userId!,req.params.id))return res.status(404).json({error:'runner not found'});
 const socket=managerSocket(req.params.id);if(!socket)return res.status(503).json({error:'Control of this runner is not connected'});
 try{const result=await socket.timeout(10000).emitWithAck('manage:challenge');res.json(result);}catch{res.status(504).json({error:'Runner didn’t answer'});}
});
app.post('/api/runners/:id/management/action',requireAuth,async(req,res)=>{
 if(!await ownsRunner(req.session.userId!,req.params.id))return res.status(404).json({error:'runner not found'});
 const parsed=z.object({nonce:z.string().min(16).max(100),proof:z.string().min(32).max(100),op:managementOps,payload:z.record(z.unknown()).default({})}).safeParse(req.body);
 if(!parsed.success)return res.status(400).json({error:'Invalid control request'});
 const socket=managerSocket(req.params.id);if(!socket)return res.status(503).json({error:'Control of this runner is not connected'});
 try{const result=await socket.timeout(120000).emitWithAck('manage:action',parsed.data);res.status(result?.ok?200:400).json(result);}catch{res.status(504).json({error:'Runner didn’t answer'});}
});
app.get('/api/projects',requireAuth,async(req,res)=>res.json(await listProjects(req.session.userId!)));
app.post('/api/projects',requireAuth,async(req,res)=>{
 const p=z.object({name:z.string().trim().min(1).max(80),runnerId:z.string().uuid(),shared:z.boolean().default(false),members:z.array(z.string().trim().min(3).max(40)).max(30).default([])}).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:'Specify a project name and runner'});
 const userId=req.session.userId!;if(!await ownsRunner(userId,p.data.runnerId))return res.status(403).json({error:'The runner does not belong to you'});
 const members=[];for(const name of p.data.members){const user=await findUserByName(name);if(!user)return res.status(404).json({error:'User not found: '+name});members.push(user.id);}
 if(members.length&&!p.data.shared)return res.status(400).json({error:'Enable shared project to add members'});
 res.status(201).json(await createProject(userId,p.data.name,p.data.runnerId,p.data.shared,members));
});
app.get('/api/projects/:id/members',requireAuth,async(req,res)=>{
 const project=await getProject(req.session.userId!,req.params.id);if(!project?.shared)return res.status(404).json({error:'Shared project not found'});
 const members=await Promise.all([project.ownerId!,...project.memberIds||[]].map(async id=>{const user=await findUserById(id);return {id,username:user?.username||'Deleted user',owner:id===project.ownerId};}));
 res.json({members,canManage:project.ownerId===req.session.userId});
});
app.put('/api/projects/:id/members',requireAuth,async(req,res)=>{
 const userId=req.session.userId!,project=await getProject(userId,req.params.id);if(!project?.shared)return res.status(404).json({error:'Shared project not found'});
 if(project.ownerId!==userId)return res.status(403).json({error:'Only the project owner can manage members'});
 const parsed=z.object({members:z.array(z.string().trim().min(3).max(40)).max(30)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Specify member usernames'});
 const memberIds=[];for(const name of parsed.data.members){const user=await findUserByName(name);if(!user)return res.status(404).json({error:'User not found: '+name});if(user.id!==userId)memberIds.push(user.id);}
 const release=lockProject(project.id);if(!release)return res.status(409).json({error:'Wait for the current project task to finish'});
 try{res.json(await updateSharedProject(userId,project.id,{memberIds:[...new Set(memberIds)]}));}finally{release();}
});
app.post('/api/projects/:id/files',requireAuth,express.raw({type:'application/octet-stream',limit:'20mb'}),async(req,res)=>{const userId=req.session.userId!,project=await getProject(userId,req.params.id);if(!project)return res.status(404).json({error:'Project not found'});if(!Buffer.isBuffer(req.body)||!req.body.length)return res.status(400).json({error:'File is empty'});let name=req.get('X-File-Name')||'file';try{name=decodeURIComponent(name);}catch{}if(!name||name.startsWith('.')||name.length>180||name==='.'||name==='..'||/[\\/\0]/.test(name))return res.status(400).json({error:'Invalid file name'});const release=project.shared?lockProject(project.id):()=>{};if(!release)return res.status(409).json({error:'Wait for the current project task to finish'});try{if(project.shared){const fresh=await getProject(userId,project.id);if(!fresh)throw new Error('Project access was removed');Object.assign(project,fresh);}if(project.shared&&!await projectRunnerValid(project))throw new Error('Project runner access was revoked');await markProjectDirty(userId,project);const file=await uploadProjectFile(project.runnerId,project.id,name,req.body);await saveProjectSnapshot(userId,project);res.status(201).json(file);}catch(error){res.status(502).json({error:error instanceof Error?error.message:'Failed to upload file'});}finally{release();}});
app.get('/api/sessions',requireAuth,async(req,res)=>res.json(await listSessions(req.session.userId!)));
app.post('/api/sessions',requireAuth,async(req,res)=>{const p=z.object({projectId:z.string().uuid().optional()}).safeParse(req.body||{});if(!p.success)return res.status(400).json({error:'Wrong project'});if(p.data.projectId&&!await getProject(req.session.userId!,p.data.projectId))return res.status(404).json({error:'Project not found'});res.status(201).json(await createSession(req.session.userId!,p.data.projectId));});
app.delete('/api/sessions/:id',requireAuth,async(req,res)=>{
 const userId=req.session.userId!,id=req.params.id;
 if(!z.string().uuid().safeParse(id).success)return res.status(400).json({error:'Invalid chat identifier'});
 try{
  if(!await deleteSession(userId,id))return res.status(404).json({error:'Chat not found'});
  for(const run of active.values())if(run.userId===userId&&run.sessionId===id)run.controller.abort();
  for(const task of taskQueue.list(userId).filter(t=>t.input.sessionId===id&&['queued','running'].includes(t.state)))await taskQueue.update(task.id,{state:'canceled',message:'Chat deleted'});
  recentRuns.delete(runKey(userId,id));
  queueChanged(userId);io.to('user:'+userId).emit('session:deleted',id);
  res.json({ok:true});
 }catch(error){res.status(500).json({error:error instanceof Error?error.message:'Unable to delete chat'});}
});
app.get('/api/sessions/:id',requireAuth,async(req,res)=>{const s=await getSession(req.session.userId!,req.params.id);res.status(s?200:404).json(s||{error:'Chat not found'});});
async function sessionFileScope(userId:string,id:string){const chat=await getSession(userId,id);if(!chat)return null;const project=chat.projectId?await getProject(userId,chat.projectId):null;if(chat.projectId&&!project)return null;let runnerId=project?.runnerId||chat.runnerId;if(!runnerId){const runners=(await listRunners(userId)).filter(r=>!r.revokedAt);if(runners.length===1)runnerId=runners[0].id;}if(!runnerId)return null;if(project?.shared){if(!await projectRunnerValid(project))return null;return {runnerId,scope:{sessionId:chat.id,projectId:project.id}};}if(!await ownsRunner(userId,runnerId)){if(chat.projectId||!chat.sharedAccessId)return null;const grant=(await listGrants(userId)).find(g=>g.id===chat.sharedAccessId&&g.recipientId===userId);if(!grant)return null;const account=(await listAccounts(grant.ownerId)).find(a=>a.runnerId===runnerId);if(!account||!await ownsRunner(grant.ownerId,runnerId))return null;}return {runnerId,scope:{sessionId:chat.id,...(chat.projectId?{projectId:chat.projectId}:{})}};}

app.get('/api/files',requireAuth,async(req,res)=>{
 const userId=req.session.userId!,projects=await listProjects(userId),sessions=await listSessions(userId);
 const sources=[...projects.map(p=>({kind:'projects',id:p.id,title:p.name,runnerId:p.runnerId,scope:{sessionId:p.id,projectId:p.id}})),...sessions.filter(s=>!s.projectId&&s.runnerId).map(s=>({kind:'sessions',id:s.id,title:s.title,runnerId:s.runnerId!,scope:{sessionId:s.id}}))];
 const groups=[];
 for(let i=0;i<sources.length;i+=6)groups.push(...await Promise.all(sources.slice(i,i+6).map(async source=>{
  const {scope,...metadata}=source;
  if(!await workspaceScope(userId,source.kind,source.id))return {...metadata,files:[],error:'runner unavailable'};
  try{return {...metadata,files:await listWorkspaceFiles(source.runnerId,scope)};}catch(e){return {...metadata,files:[],error:e instanceof Error?e.message:'Files not available'};}
 })));
 res.json({groups});
});
async function workspaceScope(userId:string,kind:string,id:string){
 if(kind==='sessions')return sessionFileScope(userId,id);
 if(kind!=='projects')return null;
 const project=await getProject(userId,id);
 return project&&(project.shared?await projectRunnerValid(project):await ownsRunner(userId,project.runnerId))?{runnerId:project.runnerId,scope:{sessionId:id,projectId:id}}:null;
}
async function mutateWorkspaceFile(userId:string,target:{runnerId:string;scope:{sessionId:string;projectId?:string}},name:string){
 const project=target.scope.projectId?await getProject(userId,target.scope.projectId):null;
 if(!project?.shared)return deleteWorkspaceFile(target.runnerId,target.scope,name);
 const release=lockProject(project.id);if(!release)throw new Error('Wait for the current project task to finish');
 try{const fresh=await getProject(userId,project.id);if(!fresh||!await projectRunnerValid(fresh))throw new Error('Project access was removed');await markProjectDirty(userId,fresh);await deleteWorkspaceFile(fresh.runnerId,target.scope,name);await saveProjectSnapshot(userId,fresh);}finally{release();}
}
app.get('/api/workspaces/:kind/:id/preview',requireAuth,async(req,res)=>{
 const target=await workspaceScope(req.session.userId!,req.params.kind,req.params.id);
 if(!target)return res.status(404).json({error:'Working folder not found'});
 if(typeof req.query.name!=='string'||req.query.name.length>500)return res.status(400).json({error:'Specify file'});
 try{const file=await readWorkspacePreview(target.runnerId,target.scope,req.query.name);res.set({'Content-Type':file.mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}).send(file.bytes);}catch(e){res.status(400).json({error:e instanceof Error?e.message:'File not available'});}
});
app.post('/api/workspaces/:kind/:id/share',requireAuth,async(req,res)=>{
 const parsed=z.object({name:z.string().min(1).max(500)}).safeParse(req.body),target=await workspaceScope(req.session.userId!,req.params.kind,req.params.id);
 if(!target)return res.status(404).json({error:'Working folder not found'});
 if(!parsed.success)return res.status(400).json({error:'Specify file'});
 try{res.status(201).json(await createFileShare(req.session.userId!,target.runnerId,target.scope,parsed.data.name));}catch(e){res.status(503).json({error:e instanceof Error?e.message:'File not available'});}
});
app.delete('/api/workspaces/:kind/:id/files',requireAuth,async(req,res)=>{
 const parsed=z.object({name:z.string().min(1).max(500)}).safeParse(req.body),target=await workspaceScope(req.session.userId!,req.params.kind,req.params.id);
 if(!target)return res.status(404).json({error:'Working folder not found'});
 if(!parsed.success)return res.status(400).json({error:'Specify file'});
 try{await mutateWorkspaceFile(req.session.userId!,target,parsed.data.name);res.json({ok:true});}catch(e){res.status(503).json({error:e instanceof Error?e.message:'File not available'});}
});
app.get('/api/sessions/:id/files',requireAuth,async(req,res)=>{const target=await sessionFileScope(req.session.userId!,req.params.id);if(!target)return res.status(404).json({error:'Task files are not yet available'});try{res.json({files:await listWorkspaceFiles(target.runnerId,target.scope)});}catch(error){res.status(503).json({error:error instanceof Error?error.message:'runner unavailable'});}});
app.delete('/api/sessions/:id/files',requireAuth,async(req,res)=>{const parsed=z.object({name:z.string().min(1).max(500)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Specify file'});const target=await sessionFileScope(req.session.userId!,req.params.id);if(!target)return res.status(404).json({error:'Task files are not yet available'});try{await deleteWorkspaceFile(target.runnerId,target.scope,parsed.data.name);res.json({ok:true});}catch(error){res.status(503).json({error:error instanceof Error?error.message:'Failed to delete file'});}});
app.post('/api/sessions/:id/files/share',requireAuth,async(req,res)=>{const parsed=z.object({name:z.string().min(1).max(500)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Specify file'});const target=await sessionFileScope(req.session.userId!,req.params.id);if(!target)return res.status(404).json({error:'Task files are not yet available'});try{res.status(201).json(await createFileShare(req.session.userId!,target.runnerId,target.scope,parsed.data.name));}catch(error){res.status(503).json({error:error instanceof Error?error.message:'Failed to create link'});}});
app.get('/api/files/:token',async(req,res)=>{await downloadSharedFile(req.params.token,res);});
app.patch('/api/sessions/:id',requireAuth,async(req,res)=>{const p=z.object({projectId:z.string().uuid().nullable().optional(),title:z.string().min(1).max(100).optional()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid parameters'});const session=await getSession(req.session.userId!,req.params.id);if(!session)return res.status(404).json({error:'Chat not found'});if(p.data.projectId!==undefined){if(p.data.projectId&&!await getProject(req.session.userId!,p.data.projectId))return res.status(404).json({error:'Project not found'});if(p.data.projectId===null)delete session.projectId;else session.projectId=p.data.projectId;}if(p.data.title!==undefined)session.title=p.data.title;session.updatedAt=new Date().toISOString();await saveSession(req.session.userId!,session);res.json(session);});

function generateHandoffMarkdown(target:'codex'|'chatgpt',sessionTitle:string,userMsgs:string[],assistantMsgs:string[],git:any,note?:string):string{
 const isCodex=target==='codex';
 const header=isCodex?'### 📋 Transferring a task to Codex (Handoff)':'### 💬 Discussion of results with ChatGPT';
 const initialGoal=userMsgs[0]?userMsgs[0].slice(0,300):(sessionTitle!=='New chat'?sessionTitle:'Current task');
 const latestUser=userMsgs.length>1?userMsgs[userMsgs.length-1].slice(0,300):null;
 const latestAssistant=assistantMsgs.length>0?assistantMsgs[assistantMsgs.length-1].slice(0,500):null;
 const points:string[]=[];
 points.push(`- **Main Goal:** ${initialGoal}`);
 if(latestUser&&latestUser!==initialGoal)points.push(`- **Last request:** ${latestUser}`);
 if(latestAssistant){
  const brief=latestAssistant.split('\n').filter(Boolean).slice(0,3).join(' ');
  points.push(`- **Job status:** ${brief.length>300?brief.slice(0,300)+'…':brief}`);
 }
 const gitSection:string[]=[];
 if(git?.isGitRepo){
  if(git.branch)gitSection.push(`- **Branch:** \`${git.branch}\``);
  if(git.lastLog){
   const firstLine=git.lastLog.split('\n')[0]||'';
   gitSection.push(`- **Last commit:** \`${firstLine}\``);
  }
  if(git.status)gitSection.push(`\n**Changed/new files (git status):**\n\`\`\`\n${git.status}\n\`\`\``);
  if(git.diffStat)gitSection.push(`\n**Change summary (git diff --stat):**\n\`\`\`\n${git.diffStat}\n\`\`\``);
  else if(git.cachedStat)gitSection.push(`\n**Staged changes (git diff --cached --stat):**\n\`\`\`\n${git.cachedStat}\n\`\`\``);
  else if(!git.status&&git.lastLog){
   const lines=git.lastLog.split('\n').slice(1).join('\n').trim();
   if(lines)gitSection.push(`\n**Changes from last commit:**\n\`\`\`\n${lines}\n\`\`\``);
  }
  if(git.diffExcerpt)gitSection.push(`\n<details><summary>diff fragment</summary>\n\n\`\`\`diff\n${git.diffExcerpt}\n\`\`\`\n</details>`);
 }else if(git?.recentFiles?.length){
  const list=git.recentFiles.map((f:any)=>`- \`${f.name}\` (${Math.round(f.size/1024)} KB)`).join('\n');
  gitSection.push(`**Recent project files:**\n${list}`);
 }else{
  gitSection.push(`- *The working directory is clean (no uncommitted changes).*`);
 }
 const instruction=isCodex
  ?(note||'Continue the task based on the context and state of the files above. Check the code, make the necessary changes and test the result.')
  :(note||'Please review the key points of the task and changes in the files above. Analyze the current solution, give an assessment and help plan further steps.');
 return `${header}\n\n`+
  `**Key points of the task:**\n${points.join('\n')}\n\n`+
  `**Git files and state:**\n${gitSection.join('\n')}\n\n`+
  (isCodex?`**Instructions for Codex:**\n${instruction}`:`**Question for ChatGPT:**\n${instruction}`);
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
 if(runnerId&&(project?.shared?await projectRunnerValid(project):await ownsRunner(userId,runnerId))){
  const scope={sessionId:session?.id||sessionId||randomUUID(),...(pId?{projectId:pId}:{})};
  gitSummary=await getWorkspaceGitSummary(runnerId,scope);
 }
 const userMsgs=(session?.messages||[]).filter(m=>m.role==='user').map(m=>m.text);
 const assistantMsgs=(session?.messages||[]).filter(m=>m.role==='assistant').map(m=>m.text);
 const summary=generateHandoffMarkdown(target,session?.title||'New chat',userMsgs,assistantMsgs,gitSummary,note);
 return {ok:true,summary,target,projectId:pId,git:gitSummary};
}

app.post('/api/sessions/:id/handoff-summary',requireAuth,async(req,res)=>{
 const p=z.object({target:z.enum(['codex','chatgpt']).default('codex'),projectId:z.string().uuid().optional(),note:z.string().max(2000).optional()}).safeParse(req.body||{});
 if(!p.success)return res.status(400).json({error:'Invalid parameters'});
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
 if(!p.success)return res.status(400).json({error:'Invalid parameters'});
 res.json(await handleHandoffRequest(req.session.userId!,p.data.sessionId,p.data.projectId,p.data.target,p.data.note));
});
app.get('/api/user/model-blacklist',requireAuth,async(req,res)=>res.json({blacklist:await getUserModelBlacklist(req.session.userId!)}));
app.put('/api/user/model-blacklist',requireAuth,async(req,res)=>{const p=z.object({blacklist:z.array(z.string().min(1).max(100))}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid model list format'});const updated=await setUserModelBlacklist(req.session.userId!,p.data.blacklist);res.json({ok:true,blacklist:updated});});
app.get('/api/providers',requireAuth,async(req,res)=>{const userId=req.session.userId!;const blacklist=await getUserModelBlacklist(userId);const accounts=await listAccounts(userId);const geminiExtra=accounts.filter(a=>a.provider==='antigravity').flatMap(a=>accountModels.get(a.id)||[]);const codexExtra=accounts.filter(a=>a.provider==='codex').flatMap(a=>getModelsForAccount(a.id,a.provider,a.authType).filter(m=>m.id!=='default'));const chatgptExtra=accounts.filter(a=>a.provider==='chatgpt').flatMap(a=>accountModels.get(a.id)||[]);const geminiModels=resolveAccountModels('antigravity',geminiExtra).filter(m=>m.id!=='default');const codexModels=resolveAccountModels('codex',codexExtra).filter(m=>m.id!=='default');const chatgptModels=resolveAccountModels('chatgpt',chatgptExtra).filter(m=>m.id!=='default');res.json({providers:[{id:'antigravity',name:'Gemini',description:'Google DeepMind / Antigravity CLI',models:geminiModels},{id:'codex',name:'Codex',description:'OpenAI Codex CLI',models:codexModels},{id:'chatgpt',name:'ChatGPT Web',description:'ChatGPT Web (Browser Session)',models:chatgptModels},{id:'openrouter',name:'OpenRouter',description:'OpenRouter API',models:accounts.filter(a=>a.provider==='openrouter').flatMap(a=>accountModels.get(a.id)||[])}],blacklist});});
app.post('/api/providers/refresh',requireAuth,async(req,res)=>{const userId=req.session.userId!;const accounts=await listAccounts(userId);const runnerIds=new Set(accounts.map(a=>a.runnerId).filter((id):id is string=>Boolean(id)));let requested=0;for(const runnerId of runnerIds){if(runnerSocket(runnerId)){await pushRunnerAccounts(userId,runnerId);requested++;}}res.json({requested});});
app.get('/api/health',(_req,res)=>res.json({ok:true,revision:process.env.APP_REVISION||'local'}));

const http=createServer(app),io=new Server(http,{path:'/socket.io',cors:{origin:false}});io.engine.use(sessionMiddleware);
const runnerNs=io.of('/runner');
runnerNs.use(async(socket,next)=>{const {runnerId,secret}=socket.handshake.auth||{};if(typeof runnerId!=='string'||typeof secret!=='string')return next(new Error('unauthorized'));const record=await verifyRunner(runnerId,secret);if(!record)return next(new Error('unauthorized'));socket.data.runnerId=record.id;socket.data.userId=record.userId;next();});
 runnerNs.on('connection',socket=>{const runnerId=socket.data.runnerId as string,userId=socket.data.userId as string;setConnected(runnerId,socket);void pushRunnerAccounts(userId,runnerId);socket.on('account:status',async(raw:unknown)=>{const parsed=z.object({accountId:z.string().uuid(),provider:z.enum(['codex','antigravity','chatgpt','openrouter']),models:z.array(z.object({id:z.string().min(1).max(100),label:z.string().min(1).max(160),reasoning:z.array(z.object({id:z.string().min(1).max(32),label:z.string().min(1).max(80)})).optional(),defaultReasoning:z.string().max(32).optional()})).optional(),limits:z.object({resetCredits:z.object({availableCount:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),credits:z.array(z.object({id:z.string().min(1).max(512),expiresAt:z.string().datetime().nullable(),title:z.string().max(160).nullable()})).nullable()}).nullable().optional(),primary:z.object({usedPercent:z.number(),windowMinutes:z.number().optional(),resetAt:z.string().optional()}).nullable().optional(),secondary:z.object({usedPercent:z.number(),windowMinutes:z.number().optional(),resetAt:z.string().optional()}).nullable().optional()}).optional(),error:z.string().max(500).optional()}).safeParse(raw);if(!parsed.success)return;const account=(await listAccounts(userId)).find(a=>a.id===parsed.data.accountId&&a.runnerId===runnerId&&a.provider===parsed.data.provider);if(!account)return;if(parsed.data.error){accountModels.delete(account.id);accountErrors.set(account.id,parsed.data.error.slice(0,240));}else{accountErrors.delete(account.id);if(parsed.data.models)accountModels.set(account.id,parsed.data.models);if(parsed.data.limits)usage.update(userId,account.id,parsed.data.limits);}await emitAccountsToUser(userId);});});attachJobHandlers(runnerNs);attachPreviewHandlers(runnerNs);
const managerNs=io.of('/manager');
managerNs.use(async(socket,next)=>{const {runnerId,secret}=socket.handshake.auth||{};if(typeof runnerId!=='string'||typeof secret!=='string')return next(new Error('unauthorized'));const record=await verifyManager(runnerId,secret);if(!record)return next(new Error('unauthorized'));socket.data.runnerId=record.id;socket.data.userId=record.userId;next();});
managerNs.on('connection',socket=>{const runnerId=socket.data.runnerId as string,userId=socket.data.userId as string;setManagerConnected(runnerId,socket);socket.on('manage:account-updated',async(raw:unknown)=>{const parsed=z.object({accountId:z.string().uuid()}).safeParse(raw);if(!parsed.success)return;const account=(await listAccounts(userId)).find(a=>a.id===parsed.data.accountId&&a.runnerId===runnerId);if(account)await pushRunnerAccounts(userId,runnerId);});});
io.use(async(socket,next)=>{const req=socket.request as express.Request,origin=req.headers.origin,host=req.headers.host;try{if(!req.session?.userId||origin&&host&&new URL(origin).host!==host||!await findUserById(req.session.userId))return next(new Error('unauthorized'));next();}catch{next(new Error('unauthorized'));}});
type RunActivity={type:AIEventType;message:string;at:string;provider?:ProviderId;accountId?:string};
type ActiveRun={userId:string;sessionId:string;controller:AbortController;startedAt:string;lastActivityAt?:string;accountId?:string;provider?:ProviderId;message:string;stream:string;activity:RunActivity[];chat:ChatSession;grantId?:string;cccAccountIds?:string[];cccGrantIds?:string[];stopReason?:string;steeringAvailable?:boolean;steering?:Promise<void>;telegramTimer?:NodeJS.Timeout;telegramText?:string};
const active=new Map<string,ActiveRun>(),busy=new Set<string>(),cursors=new Map<string,number>();
onGrantCharged(grant=>{if(grant.usedTokens<grant.budget&&grant.state==='active')return;for(const run of active.values())if(run.grantId===grant.id||run.cccGrantIds?.includes(grant.id)){run.stopReason='Shared token budget exhausted or access revoked';run.controller.abort();}});
const taskQueue=new TaskQueue(dataRoot+'/task-queue.json');
await taskQueue.load();
const usageLedger=new UsageLedger(dataRoot+'/usage-ledger.json');
await usageLedger.load();
app.get('/api/usage-summary',requireAuth,async(req,res)=>{const userId=req.session.userId!;const summary=usageLedger.summary(userId,await listSessions(userId));res.json({...summary,accounts:await accountStatuses(userId),grants:(await listGrants(userId)).map(({ownerId,recipientId,...g})=>({...g,direction:ownerId===userId?'outgoing':'incoming',remainingTokens:Math.max(0,g.budget-g.usedTokens)})),projects:(await listProjects(userId)).map(p=>({id:p.id,name:p.name}))});});
const attempting=new Set<string>();
function queueChanged(userId:string){io.to('user:'+userId).emit('queue:changed');}
app.get('/api/tasks',requireAuth,(req,res)=>res.json(taskQueue.list(req.session.userId!).map(({userId,...task})=>{const run=active.get(task.id);return {...task,...(run?{message:run.message,startedAt:run.startedAt,lastActivityAt:run.lastActivityAt||run.startedAt,activity:run.activity}: {})};})));
app.post('/api/tasks/:id/resume',requireAuth,async(req,res)=>{
 const userId=req.session.userId!,task=taskQueue.list(userId).find(t=>t.id===req.params.id);
 if(!task)return res.status(404).json({error:'Task not found'});
 if(active.has(task.id)||attempting.has(task.id))return res.status(409).json({error:'Wait for the interrupted task to stop'});
 if(!await getSession(userId,String(task.input.sessionId)))return res.status(404).json({error:'Chat not found'});
 try{const next=await taskQueue.resume(userId,task.id,randomUUID());queueChanged(userId);res.json({ok:true,runId:next.id});void pumpQueue();}catch(e){res.status(409).json({error:e instanceof Error?e.message:'Unable to continue'});}
});
app.patch('/api/tasks/:id',requireAuth,async(req,res)=>{const task=taskQueue.list(req.session.userId!).find(t=>t.id===req.params.id);if(!task)return res.status(404).json({error:'Task not found'});const p=z.object({priority:z.number().int().min(0).max(2)}).strict().safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid priority'});if(task.state!=='queued')return res.status(409).json({error:'Only waiting tasks can change priority'});await taskQueue.update(task.id,p.data);queueChanged(req.session.userId!);res.json({ok:true});});
app.delete('/api/tasks/:id',requireAuth,async(req,res)=>{const task=taskQueue.list(req.session.userId!).find(t=>t.id===req.params.id);if(!task)return res.status(404).json({error:'Task not found'});if(task.state==='running'){active.get(task.id)?.controller.abort();}else if(task.state==='queued'){await taskQueue.update(task.id,{state:'canceled',message:'Canceled before execution'});}queueChanged(req.session.userId!);res.json({ok:true});});
type TerminalRun={runId:string;sessionId:string;type:'completed'|'error';message:string;finishedAt:number};
const recentRuns=new Map<string,TerminalRun>();
const runKey=(userId:string,sessionId:string)=>userId+':'+sessionId;

async function executeRun(userId:string, taskId:string, raw:unknown, ack:(r:{ok:boolean;runId?:string;error?:string;waiting?:boolean})=>void|Promise<void>,validateOnly=false){if(!await findUserById(userId))return ack({ok:false,error:'User no longer exists'});const parsed=sendSchema.safeParse(raw);if(!parsed.success)return ack?.({ok:false,error:'Invalid parameters'});const input=parsed.data;const cccSettings=input.workflow==='ccc-auto'?await readCccSettings(userId):undefined;const key=userId+':'+input.sessionId;if(!validateOnly&&busy.has(key))return ack?.({ok:false,waiting:true,error:'Waiting for this chat'});const chat=await getSession(userId,input.sessionId);if(!chat)return ack?.({ok:false,error:'Chat not found'});const project=chat.projectId?await getProject(userId,chat.projectId):null;if(chat.projectId&&!project)return ack?.({ok:false,error:'Project not found'});const userBlacklist=await getUserModelBlacklist(userId);if(input.workflow!=='ccc-auto'&&input.model!=='default'&&userBlacklist.includes(input.model))return ack?.({ok:false,error:'The model is disabled in the providers settings'});const rawTarget=input.service||input.provider||input.accountId||'auto';const service=input.workflow==='ccc-auto'?'auto':rawTarget==='antigravity'?'gemini':rawTarget;const allAccounts=await accessibleAccounts(userId),projectAccounts=project&&!project.shared?allAccounts.filter(a=>a.runnerId===project.runnerId):allAccounts;let eligible=projectAccounts;if(service==='gemini')eligible=projectAccounts.filter(a=>a.provider==='antigravity');else if(service==='codex')eligible=projectAccounts.filter(a=>a.provider==='codex');else if(service==='openrouter')eligible=projectAccounts.filter(a=>a.provider==='openrouter');else if(service==='chatgpt')eligible=projectAccounts.filter(a=>a.provider==='chatgpt');else if(service!=='auto')eligible=projectAccounts.filter(a=>!a.grant?a.id===rawTarget:a.grant.id===rawTarget||a.grant.id+':'+a.provider===rawTarget);const cursor=cursors.get(userId)||0;const isAutoOrService=service==='auto'||service==='gemini'||service==='codex'||service==='chatgpt'||service==='openrouter'||eligible.some(a=>!!a.grant);const ordered=isAutoOrService?orderAccountsByPriority(eligible,cursor):eligible;const automatic=input.model==='auto';const complexity=input.fast?'simple':taskComplexity(input.prompt,chat.messages.slice(-4).map(m=>m.text).join('\n'));const plannedModels=new Map<AccessibleAccount,string>();const planned=automatic?ordered.flatMap(a=>automaticModels(accessibleModels(a),userBlacklist,complexity).map(model=>{const copy={...a};plannedModels.set(copy,model);return copy;})).sort((a,b)=>modelRank(plannedModels.get(a)!,complexity)-modelRank(plannedModels.get(b)!,complexity)):ordered;const requestModel=(a:AccessibleAccount)=>plannedModels.get(a)||(a.grant&&input.model==='default'&&!a.grant.models.includes('default')?accessibleModels(a).find(m=>!userBlacklist.includes(m.id))?.id||'':input.model);const supports=(a:typeof allAccounts[number])=>{const requested=requestModel(a);if(input.workflow==='ccc-auto')return ['codex','openrouter','antigravity'].includes(a.provider)&&(!a.grant||a.grant.usedTokens<a.grant.budget&&accessibleModels(a).some(m=>!userBlacklist.includes(m.id)));const models=accessibleModels(a),model=models.find(m=>m.id===requested);if(a.grant&&(a.grant.usedTokens>=a.grant.budget||!a.grant.models.includes(requested)))return false;if(requested!=='default'&&!model)return false;if(input.reasoning!=='default'){if(requested!=='default'){if(model?.reasoning?.length&&!model.reasoning.some(r=>r.id===input.reasoning))return false;if(!model?.reasoning?.length&&a.provider!=='codex')return false;}else{const hasReasoning=models.some(m=>m.reasoning?.some(r=>r.id===input.reasoning));if(!hasReasoning&&a.provider!=='codex')return false;}}return true;};const queuedTask=taskQueue.list(userId).find(t=>t.id===taskId),continuation=queuedTask?.continuationOf?queuedTask:undefined;let choices=planned.filter(a=>(!continuation||(a.runnerId===continuation.recovery?.runnerId&&a.id===continuation.recovery?.accountId))&&supports(a)&&(input.workflow==='ccc-auto'||!input.fast||a.provider==='codex'));if(!choices.length){let err=project&&!project.shared?'There is no account on runner with this model and reasoning':'No connection with this model and reasoning';if(service==='gemini')err=project&&!project.shared?'No Gemini account on runner for this project':(eligible.length?'Gemini accounts do not support the selected model or reasoning':'No Gemini connection available');else if(service==='codex')err=project&&!project.shared?'No Codex account on runner for this project':(eligible.length?'Codex accounts do not support the selected model or reasoning':'No Codex connection available');else if(service==='chatgpt')err=project&&!project.shared?'No ChatGPT account on runner for this project':(eligible.length?'ChatGPT accounts do not support the selected model':'No ChatGPT connection available');return ack?.({ok:false,error:err});}
  if(continuation&&chat.projectId!==continuation.recovery?.projectId)return ack({ok:false,error:'The chat workspace has changed; checkpoint continuation is unavailable'});
  if(validateOnly)return ack({ok:true});
  if(taskQueue.list(userId).find(t=>t.id===taskId)?.state==='canceled')return ack({ok:false,error:'Canceled'});
  if(busy.has(key))return ack({ok:false,waiting:true,error:'Waiting for this chat'});
  const onlineChoices=choices.filter(a=>a.runnerId&&runnerSocket(a.runnerId));
  if(!onlineChoices.length)return ack({ok:false,waiting:true,error:'Waiting for runner connection'});
  const availableChoices=onlineChoices.filter(a=>usage.available(a.ownerId,a.id));
  if(!availableChoices.length)return ack({ok:false,waiting:true,error:'Waiting for provider quota to recover'});
  choices=availableChoices;
  if(!await getSession(userId,chat.id))return ack?.({ok:false,error:'Chat not found'});
  if(busy.has(key))return ack({ok:false,waiting:true,error:'Waiting for this chat'});
  const releaseProject=project?.shared?lockProject(project.id):()=>{};if(!releaseProject)return ack?.({ok:false,waiting:true,error:'Waiting for project synchronization or another task'});
  if(isAutoOrService&&eligible.length)cursors.set(userId,(cursor+1)%Number.MAX_SAFE_INTEGER);
  const runId=taskId,controller=new AbortController(),startedAt=new Date().toISOString();recentRuns.delete(key);busy.add(key);const run:ActiveRun={userId,sessionId:chat.id,controller,startedAt,message:'Request accepted',stream:'',activity:[],chat};active.set(runId,run);const accepted=Promise.resolve(ack?.({ok:true,runId}));const emit=(type:AIEventType,accountId?:string,provider?:ProviderId,extra:Partial<AIEvent>={})=>{const shared=choices.find(a=>a.id===accountId)?.grant;if(shared)accountId=shared.id+':'+provider;const event:AIEvent={id:randomUUID(),sessionId:chat.id,runId,at:new Date().toISOString(),type,provider,...extra,data:{...extra.data,accountId}};run.lastActivityAt=event.at;if(accountId)run.accountId=accountId;if(provider)run.provider=provider;if(type==='fallback'||type==='handoff_started')run.steeringAvailable=false;if(typeof extra.data?.steeringAvailable==='boolean')run.steeringAvailable=extra.data.steeringAvailable;if(type==='delta'&&event.text){run.stream=(run.stream+event.text).slice(-12000);run.telegramText=((run.telegramText||'')+event.text).slice(-12000);clearTimeout(run.telegramTimer);run.telegramTimer=setTimeout(()=>{const text=run.telegramText;run.telegramText='';if(run.steeringAvailable&&text)void notifyTelegram(userId,chat.title,chat.id,text,false,true);},2000);}if(type==='completed'||type==='error'||type==='fallback'||type==='handoff_started'){clearTimeout(run.telegramTimer);run.telegramText='';}if((type==='started'||type==='status'||type==='tool'||type==='fallback'||type==='checkpoint'||type==='handoff_started'||type==='handoff_ready')&&event.message){run.message=event.message;run.activity.push({type,message:event.message,at:event.at,provider,accountId});run.activity=run.activity.slice(-12);}if((type==='completed'||type==='error')&&event.message){void taskQueue.update(taskId,{state:type==='completed'?'completed':controller.signal.aborted?'canceled':'error',message:event.message}).then(()=>queueChanged(userId));if(type==='error')void notifyTelegram(userId,chat.title,chat.id,event.message,true);recentRuns.set(key,{runId,sessionId:chat.id,type,message:event.message,finishedAt:Date.now()});if(recentRuns.size>500)recentRuns.delete(recentRuns.keys().next().value!);}io.to('user:'+userId).emit('ai:event',event);};
  let done=false;const errors:string[]=[];const tokenUsageByAccount=new Map<string,TokenUsage>();let taskPrompt=continuation?`Read .ai-router/tasks/${continuation.recovery?.checkpointTaskId||continuation.continuationOf}/HANDOFF.md and continue the original task from the saved state. Inspect the current files first, verify which steps completed, and avoid repeating completed commands. Original request: ${input.prompt}`:input.prompt;let handoffRunnerId:string|undefined;let handoffPending=false;let retryCheckpoint:string|undefined;
  try{await accepted;const now=new Date().toISOString();chat.messages.push({id:randomUUID(),role:'user',text:continuation?'Continue the interrupted task from checkpoint.':input.prompt,at:now});if(chat.title==='New chat')chat.title=input.prompt.slice(0,45);chat.updatedAt=now;await saveSession(userId,chat);emit('started',undefined,undefined,{message:'Request accepted'});for(const a of choices){if(controller.signal.aborted)break;if(handoffRunnerId&&a.runnerId!==handoffRunnerId)continue;if(!a.runnerId||!await ownsRunner(a.ownerId,a.runnerId)||!runnerSocket(a.runnerId)){errors.push(`${a.name}: runner is offline`);emit('fallback',a.id,a.provider,{message:`${a.name}: runner is offline`});continue;}if(!usage.available(a.ownerId,a.id)){errors.push(`${a.name}: account is temporarily limited by the provider`);emit('fallback',a.id,a.provider,{message:`${a.name}: account is temporarily limited by the provider`});continue;}const requested=requestModel(a);if(automatic)emit('status',a.id,a.provider,{message:`Auto: ${complexity==='simple'?'simple task':'complex task'} → ${requested}`,data:{model:requested,complexity}});const lease=a.grant&&!cccSettings?await acquireGrant(userId,a.grant.id,requested):null;if(a.grant&&!cccSettings&&!lease){errors.push(a.name+': access revoked or budget exhausted');continue;}run.grantId=lease?.id;const attemptId=randomUUID();let chargedTokens=0;let produced=false,touched=false,partial='';const cccGrants=new CccGrantUsage(userId,reason=>{run.stopReason=reason;controller.abort();});try{if(project?.shared){emit('status',a.id,a.provider,{message:'Syncing shared project'});await prepareProjectRunner(userId,project,a.runnerId,a.ownerId);await markProjectDirty(userId,project);}if(!chat.projectId&&(chat.runnerId!==a.runnerId||chat.sharedAccessId!==a.grant?.id)){chat.runnerId=a.runnerId;chat.sharedAccessId=a.grant?.id;await saveSession(userId,chat);}emit('status',a.id,a.provider,{message:`${a.name}: sent to runner`});const history=chat.messages.slice(-12,-1).map(m=>`${m.role==='user'?'User':'Assistant'}: ${m.text}`).join('\n');const prompt=history?`Conversation context:\n${history}\n\nCurrent user request:\n${taskPrompt}`:taskPrompt;if(lease){const current=(await listGrants(userId)).find(g=>g.id===lease.id);if(!current||current.state!=='active'||!current.models.includes(requested))throw new Error('Access revoked or model denied');}taskQueue.recordProgress(taskId,{runnerId:a.runnerId,accountId:a.id,projectId:chat.projectId});const cccAuto=cccSettings?structuredClone(cccSettings):undefined;if(cccAuto){for(const rule of cccAuto.levels)for(const candidate of rule.candidates){if(!candidate.enabled)continue;const target=cccCandidateAccount(candidate,projectAccounts,accessibleModels,userBlacklist,a.runnerId);if(!target)throw new Error(`CCC-Auto: ${candidate.id} — connection/model unavailable on selected runner`);await cccGrants.reserve(target,candidate.model);run.cccGrantIds=[...cccGrants.grants.keys()];candidate.accountId=target.id;}run.cccAccountIds=[...new Set(cccAuto.levels.flatMap(rule=>rule.candidates.filter(c=>c.enabled).map(c=>c.accountId!)))];}const text=await dispatch(a.runnerId,{continuationOf:retryCheckpoint||continuation?.recovery?.checkpointTaskId||continuation?.continuationOf,taskId:runId,accountId:a.id,provider:a.provider,sessionId:chat.id,personalMcp:a.provider==='codex'||cccAuto?await readPersonalMcp(userId):[],sharedExecution:!!a.grant||cccGrants.grants.size>0,projectId:chat.projectId,prompt,model:requested,reasoning:requestedReasoning(accessibleModels(a).find(m=>m.id===requested),input.reasoning,input.fast),fast:input.fast,workflow:input.workflow,cccAuto,mode:input.mode},controller.signal,e=>{if(e.type==='delta'){produced=true;partial+=(e.text||'');taskQueue.recordProgress(taskId,{partialText:partial.slice(-12000),updatedAt:new Date().toISOString()});}if(e.type==='checkpoint'&&e.data?.status==='running')taskQueue.recordProgress(taskId,{checkpoint:true,checkpointTaskId:taskId});if(e.type==='tool'||e.type==='status'||e.type==='checkpoint'){const saved=taskQueue.list(userId).find(t=>t.id===taskId)?.recovery;taskQueue.recordProgress(taskId,{updatedAt:new Date().toISOString(),activity:[...(saved?.activity||[]),{type:e.type,message:e.message||e.type,at:new Date().toISOString()}].slice(-12)});}if(e.type==='tool')touched=true;if(e.type==='checkpoint'&&e.data?.status==='running'&&handoffPending){emit('handoff_ready',a.id,a.provider,{message:`${a.name}: continues task from checkpoint`});handoffPending=false;}if(e.type==='usage'){const tokens=normalizeTokenUsage(e.data);if(tokens){tokenUsageByAccount.set(attemptId,tokens);if(cccAuto&&Array.isArray(e.data?.cccUsage)){for(const row of e.data.cccUsage as {accountId:string;provider:ProviderId;model:string;usage:Record<string,unknown>}[]){const authorized=cccAuto.levels.some(rule=>rule.candidates.some(candidate=>candidate.enabled&&candidate.accountId===row.accountId&&candidate.provider===row.provider&&candidate.model===row.model));const candidateTokens=normalizeTokenUsage(row.usage);if(authorized&&candidateTokens){cccGrants.record(row.accountId,row.provider,row.model,candidateTokens.totalTokens);void usageLedger.record({userId,runId,attemptId:attemptId+':'+row.accountId+':'+row.model,accountId:cccGrants.publicAccountId(row.accountId,row.provider,row.model),projectId:chat.projectId,model:row.model,provider:row.provider,tokens:candidateTokens}).catch(error=>console.error('Usage persistence failed',error));}}}else void usageLedger.record({userId,runId,attemptId,accountId:a.id,projectId:chat.projectId,model:requested,provider:a.provider,tokens}).catch(error=>console.error('Usage persistence failed',error));if(lease&&tokens.totalTokens>chargedTokens){void chargeGrant(lease.id,requested,tokens.totalTokens-chargedTokens).catch(error=>{console.error('Shared usage persistence failed',error);controller.abort();});chargedTokens=tokens.totalTokens;}}}if(e.type==='usage'&&e.data?.limits)usage.update(a.ownerId,a.id,e.data.limits as {primary?:{usedPercent?:number;windowMinutes?:number;resetAt?:string};secondary?:{usedPercent?:number;windowMinutes?:number;resetAt?:string}});if(cccAuto&&e.type==='usage'&&Array.isArray(e.data?.cccUsage))e={...e,data:{...e.data,cccUsage:cccGrants.publicUsage(e.data.cccUsage)}};emit(e.type,a.id,a.provider,e);});touched=true;run.steeringAvailable=false;await run.steering;if(project?.shared)await saveProjectSnapshot(userId,project);const tokenUsage=sumTokenUsage(tokenUsageByAccount.values());chat.messages.push({id:randomUUID(),role:'assistant',text,runId,provider:a.provider,model:requested,accountId:a.grant?a.grant.id+':'+a.provider:a.id,at:new Date().toISOString(),...(tokenUsage?{tokenUsage}: {})});chat.updatedAt=new Date().toISOString();await saveSession(userId,chat);emit('completed',a.id,a.provider,{text,message:'Done'});void notifyTelegram(userId,chat.title,chat.id,text);done=true;break;}catch(e){if(e instanceof JobError&&e.code==='rate_limit')usage.rateLimited(a.ownerId,a.id);const reason=e instanceof Error?e.message:'Error';errors.push(`${a.name}: ${reason}`);const rateLimited=e instanceof JobError&&e.code==='rate_limit';const savedCheckpoint=taskQueue.list(userId).find(t=>t.id===taskId)?.recovery?.checkpoint;const canRetry=automatic||isAutoOrService;if(canRetry&&(rateLimited||automatic&&(produced||touched))&&savedCheckpoint&&!controller.signal.aborted&&!(e instanceof JobError&&['timeout','unavailable','canceled'].includes(e.code))){handoffRunnerId=a.runnerId;retryCheckpoint=runId;handoffPending=true;taskPrompt=`Read the file .ai-router/tasks/${runId}/HANDOFF.md in the current folder and continue the same task from the current state. Do not repeat completed commands and check changed files first.`;emit('handoff_started',a.id,a.provider,{message:`${a.name}: save the checkpoint and transfer the work to the next account.`});continue;}if(canRetry&&!produced&&!touched&&!controller.signal.aborted){emit('fallback',a.id,a.provider,{message:`${a.name}: ${reason}. Let’s try the next account.`});continue;}break;}finally{if(project?.shared&&project.needsSync){try{await saveProjectSnapshot(userId,project);}catch(error){emit('status',a.id,a.provider,{message:'Project changes remain on this runner: '+(error instanceof Error?error.message:'sync failed')});}}await cccGrants.release();run.cccGrantIds=undefined;if(lease){await flushGrantCharges();releaseGrant(lease.id);}run.grantId=undefined;}}if(!done)emit('error',undefined,undefined,{message:controller.signal.aborted?(run.stopReason||'Stopped by user'):errors.join(' · ')||'No connection available'});
  }catch(e){emit('error',undefined,undefined,{message:e instanceof Error?e.message:'Internal error'});}finally{clearTimeout(run.telegramTimer);await run.steering;active.delete(runId);busy.delete(key);releaseProject();await emitAccountsToUser(userId);}
 }

async function enqueueRun(userId:string,raw:unknown,id:string=randomUUID()):Promise<{ok:boolean;runId?:string;error?:string;queued?:boolean}> {
 const existing=taskQueue.list(userId).find(t=>t.id===id);if(existing)return {ok:true,runId:id,queued:true};
 const parsed=sendSchema.safeParse(raw);if(!parsed.success)return {ok:false,error:'Invalid parameters'};
 const validation=await new Promise<{ok:boolean;error?:string}>((resolve,reject)=>{void executeRun(userId,'',parsed.data,resolve,true).catch(reject);});
 if(!validation.ok)return validation;
 const now=new Date().toISOString();await taskQueue.add({id,userId,input:parsed.data,createdAt:now,updatedAt:now,priority:1,state:'queued',message:'Waiting to start'});
 queueChanged(userId);void pumpQueue();return {ok:true,runId:id,queued:true};
}
async function refineRun(userId:string,runId:string,prompt:string) {
 const run=active.get(runId);if(!run||run.userId!==userId)throw new Error('Task not found or completed');
 if(!run.steeringAvailable||run.steering)throw new Error('Wait until the agent is ready for clarifications. Use /task to queue a separate task.');
 const message={id:randomUUID(),role:'user' as const,text:prompt,at:new Date().toISOString()};
 const operation=(async()=>{await steerJob(runId,prompt);run.chat.messages.push(message);run.chat.updatedAt=message.at;await saveSession(userId,run.chat);
 io.to('user:'+userId).emit('ai:event',{id:randomUUID(),sessionId:run.sessionId,runId,at:message.at,type:'status',message:'The refinement is passed to the model',data:{steeringMessage:message}});})();
 run.steering=operation.catch(()=>undefined);try{await operation;}finally{run.steering=undefined;}
}

let pumping=false;
async function pumpQueue(){if(pumping)return;pumping=true;try{for(const task of taskQueue.list().filter(t=>t.state==='queued')){if(attempting.has(task.id))continue;attempting.add(task.id);await new Promise<void>(resolve=>{void executeRun(task.userId,task.id,task.input,result=>{const current=taskQueue.list(task.userId).find(t=>t.id===task.id);if(current?.state==='canceled'){active.get(task.id)?.controller.abort();resolve();return;}return taskQueue.update(task.id,result.ok?{state:'running',message:'Executing'}:result.waiting?{message:result.error||'Waiting'}:{state:'error',message:result.error||'Failed'}).then(()=>queueChanged(task.userId)).finally(resolve);}).catch(async e=>{await taskQueue.update(task.id,{state:'error',message:e instanceof Error?e.message:'Failed'});queueChanged(task.userId);}).finally(()=>{attempting.delete(task.id);resolve();});});}}finally{pumping=false;}}
setInterval(()=>void pumpQueue(),2000).unref();
io.on('connection',socket=>{const userId=(socket.request as express.Request).session.userId!;socket.join('user:'+userId);
 socket.on('run:state',(sessionId:unknown,ack?:(state:unknown)=>void)=>{if(typeof ack!=='function')return;if(typeof sessionId!=='string')return ack(null);const entry=[...active.entries()].find(([,run])=>run.userId===userId&&run.sessionId===sessionId);if(!entry){const recent=recentRuns.get(runKey(userId,sessionId));return ack(recent&&Date.now()-recent.finishedAt<600000?recent:null);}const [runId,run]=entry;ack({runId,sessionId:run.sessionId,startedAt:run.startedAt,lastActivityAt:run.lastActivityAt,accountId:run.accountId,provider:run.provider,message:run.message,stream:run.stream,activity:run.activity,steeringAvailable:run.steeringAvailable===true});});
  socket.on('run',async(raw:unknown,ack?:(r:unknown)=>void)=>{try{ack?.(await enqueueRun(userId,raw));}catch(e){ack?.({ok:false,error:e instanceof Error?e.message:'Queue unavailable'});}});
 socket.on('steer',async(raw:unknown,ack?:(r:unknown)=>void)=>{
  const parsed=z.object({runId:z.string().uuid(),prompt:z.string().trim().min(1).max(16000)}).strict().safeParse(raw);
  if(!parsed.success)return ack?.({ok:false,error:'Incorrect clarification'});
  try{await refineRun(userId,parsed.data.runId,parsed.data.prompt);ack?.({ok:true});}catch(e){ack?.({ok:false,error:e instanceof Error?e.message:'Failed to send clarification'});}
 });
 socket.on('cancel',(runId:unknown)=>{if(typeof runId==='string'){const run=active.get(runId);if(run?.userId===userId)run.controller.abort();}});
});
http.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('AI Router control plane ready'));
startPreviewServer(Number(process.env.PREVIEW_PORT||3001));

setTelegramController({
 projects:listProjects,
 chats:listSessions,
 session:async(userId,id)=>!!await getSession(userId,id),
 create:async(userId,projectId)=>{if(projectId&&!await getProject(userId,projectId))throw new Error('Project not found');return (await createSession(userId,projectId)).id;},
 submit:async(userId,sessionId,prompt,updateId)=>{
  const hex=createHash('sha256').update('telegram:'+userId+':'+updateId).digest('hex');
  const id=updateId===undefined?randomUUID():hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-a'+hex.slice(17,20)+'-'+hex.slice(20,32);
  const result=await enqueueRun(userId,{sessionId,prompt,service:'auto',model:'auto'},id);if(!result.ok)throw new Error(result.error||'Queue unavailable');return result.runId!;
 },
 reply:async(userId,sessionId,prompt)=>{const entry=[...active.entries()].find(([,run])=>run.userId===userId&&run.sessionId===sessionId);if(!entry)return false;await refineRun(userId,entry[0],prompt);return true;},
 status:async(userId,sessionId)=>{
  const rows=taskQueue.list(userId).filter(t=>!sessionId||t.input.sessionId===sessionId).slice(-10);
  return rows.map(t=>{const run=active.get(t.id);return t.id+'\n'+t.state+': '+(run?.message||t.message)+(run?.stream?'\n'+run.stream.slice(-1500):'');}).join('\n\n')||'Нет задач в выбранном чате.';
 },
 stop:async(userId,sessionId)=>{
  let count=0;for(const task of taskQueue.list(userId).filter(t=>t.input.sessionId===sessionId&&['queued','running'].includes(t.state))){const run=active.get(task.id);if(run)run.controller.abort();else await taskQueue.update(task.id,{state:'canceled',message:'Canceled from Telegram'});count++;}
  queueChanged(userId);return count?'Остановлено задач: '+count:'Нет активных задач.';
 }
});
startTelegram();

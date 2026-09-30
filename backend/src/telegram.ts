import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import { dataRoot } from './store.js';
import { findUserById } from './auth.js';

const directory = path.join(dataRoot, 'telegram');
const pending = new Map<string, { userId:string; expires:number }>();
const token = process.env.TELEGRAM_BOT_TOKEN;
let botName = '', offset = 0;
const hash = (value:string) => createHash('sha256').update(value).digest('hex');
const bindingFile = (userId:string) => path.join(directory, hash(userId) + '.json');
type Binding = { userId:string; chatId:number; name:string; enabled:boolean; lastError?:string; sessionId?:string; projectId?:string; lastUpdate?:number; replies?:Record<string,string> };
type Update = { update_id?:number; message?:{ text?:string; chat?:{ id:number; type:string }; from?:{ id:number; username?:string; first_name?:string }; reply_to_message?:{message_id:number} } };
export type TelegramController = {
  projects(userId:string):Promise<{id:string;name:string}[]>;
  chats(userId:string):Promise<{id:string;title:string}[]>;
  session(userId:string,sessionId:string):Promise<boolean>;
  create(userId:string,projectId?:string):Promise<string>;
  submit(userId:string,sessionId:string,prompt:string,updateId?:number):Promise<string>;
  reply(userId:string,sessionId:string,prompt:string):Promise<boolean>;
  status(userId:string,sessionId?:string):Promise<string>;
  stop(userId:string,sessionId?:string):Promise<string>;
};
let controller:TelegramController|undefined;
export function setTelegramController(value:TelegramController) { controller = value; }
async function call(method:string, body:object) {
  if (!token) throw new Error('The server owner must configure TELEGRAM_BOT_TOKEN');
  let response:Response;
  try { response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), signal:AbortSignal.timeout(35000)}); }
  catch { throw new Error('Failed to connect to Telegram'); }
  const data = await response.json() as {ok:boolean;result:any;description?:string};
  if (!data.ok) throw new Error(data.description || 'Telegram is unavailable');
  return data.result;
}
async function binding(userId:string):Promise<Binding|null> { try { return JSON.parse(await readFile(bindingFile(userId),'utf8')); } catch { return null; } }
async function save(value:Binding) {
  await mkdir(directory,{recursive:true,mode:0o700});
  const file=bindingFile(value.userId),temp=file+'.'+randomBytes(6).toString('hex');
  await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,file);
}
// Binding changes and notification metadata must not overwrite one another.
let writes:Promise<unknown>=Promise.resolve();
function mutate<T>(operation:()=>Promise<T>):Promise<T> { const next=writes.then(operation);writes=next.catch(()=>{});return next; }
async function patch(userId:string,chatId:number,changes:Partial<Binding>) {
  await mutate(async()=>{const latest=await binding(userId);if(latest?.chatId===chatId)await save({...latest,...changes});});
}
export async function telegramStatus(userId:string) {
  const value=await binding(userId);
  return {configured:!!token,connected:!!value,name:value?.name||'',enabled:value?.enabled||false,lastError:value?.lastError||''};
}
export async function telegramConnect(userId:string) {
  if (!botName) { const me=await call('getMe',{});if(typeof me.username!=='string'||!/^\w+$/.test(me.username))throw new Error('Telegram did not return the bot name');botName=me.username; }
  for (const [key,value] of pending) if(value.userId===userId||value.expires<Date.now())pending.delete(key);
  const code=randomBytes(24).toString('base64url');pending.set(hash(code),{userId,expires:Date.now()+600000});
  return {url:`https://t.me/${botName}?start=${code}`,expiresAt:new Date(Date.now()+600000).toISOString()};
}
export async function telegramDisconnect(userId:string) {
  for(const [key,value] of pending)if(value.userId===userId)pending.delete(key);
  await mutate(()=>unlink(bindingFile(userId)).catch(()=>undefined));
}
export async function telegramEnable(userId:string,enabled:boolean) {
  await mutate(async()=>{const value=await binding(userId);if(!value)throw new Error('First connect Telegram');await save({...value,enabled});});
}
export function telegramChunks(text:string):string[] {
  const result:string[]=[];let chunk='';
  // Bound UTF-16 length and preserve complete Unicode characters.
  for(const char of text){if(chunk.length+char.length>3500){result.push(chunk);chunk='';}chunk+=char;}
  if(chunk)result.push(chunk);return result;
}
async function send(value:Binding,text:string,sessionId?:string) {
  for(const chunk of telegramChunks(text)) {
    const latest=await binding(value.userId);if(latest?.chatId!==value.chatId)return;
    const result=await call('sendMessage',{chat_id:value.chatId,text:chunk,link_preview_options:{is_disabled:true}});
    if(sessionId&&typeof result?.message_id==='number')await mutate(async()=>{
      const current=await binding(value.userId);if(current?.chatId!==value.chatId)return;
      const replies:Record<string,string>={...current.replies,[result.message_id]:sessionId};
      const keys=Object.keys(replies);for(const key of keys.slice(0,Math.max(0,keys.length-100)))delete replies[key];
      await save({...current,replies});
    });
  }
}
export async function notifyTelegram(userId:string,title:string,sessionId:string,text?:string,error=false,progress=false) {
  if(!token)return;const value=await binding(userId);if(!value?.enabled)return;
  const origin=process.env.PUBLIC_URL;
  const link=origin&&/^https:\/\//.test(origin)?`${origin.replace(/\/$/,'')}/?session=${encodeURIComponent(sessionId)}`:'';
  const content=text?`\n\n${text.slice(0,12000)}${text.length>12000?'\n… Полный ответ в чате.':''}`:'';
  try {
    await send(value,`${progress?'Сообщение агента':error?'Задача остановлена':'The answer is ready'}: ${title.slice(0,120)}${content}${link?'\n'+link:''}`,sessionId);
    await patch(userId,value.chatId,{lastError:undefined});
  } catch { await patch(userId,value.chatId,{lastError:'Failed to deliver notification. Check that the bot is not blocked.'}); }
}
const help='Отправьте задачу обычным сообщением. Ответьте на сообщение бота, чтобы продолжить нужный чат.\n/projects — список проектов\n/project ID — выбрать проект\n/new — новый чат без проекта\n/chats — список чатов\n/chat ID — выбрать чат\n/task текст — отдельная задача в текущем чате\n/reply текст — ответ или уточнение агенту\n/status — состояние задач\n/stop — остановить задачи текущего чата';
let updates:Promise<unknown>=Promise.resolve();
export function processTelegramUpdate(update:Update):Promise<void> {
  const next=updates.then(()=>handleTelegramUpdate(update));updates=next.catch(()=>{});return next;
}
async function handleTelegramUpdate(update:Update) {
  const message=update.message;
  if(message?.chat?.type!=='private'||message.from?.id!==message.chat.id||!message.text)return;
  const match=message.text.match(/^\/start(?:@\w+)? ([A-Za-z0-9_-]{32})$/),key=match?hash(match[1]):'',pair=pending.get(key);
  if(pair&&pair.expires>Date.now()&&await findUserById(pair.userId)) {
    pending.delete(key);
    await mutate(async()=>{
      for(const entry of await readdir(directory).catch(()=>[]))if(/^[a-f0-9]{64}\.json$/.test(entry)) {
        const previous=JSON.parse(await readFile(path.join(directory,entry),'utf8')) as Binding;
        if(previous.chatId===message.chat!.id&&previous.userId!==pair.userId)await unlink(path.join(directory,entry));
      }
      await save({userId:pair.userId,chatId:message.chat!.id,name:message.from!.username?`@${message.from!.username}`:message.from!.first_name||'Telegram',enabled:true});
    });
    if(controller)await send((await binding(pair.userId))!,'Telegram подключён.\n'+help).catch(()=>{});
    return;
  }
  if(match)return; // Expired/replayed pairing codes never become tasks.
  let value:Binding|undefined;
  for(const entry of await readdir(directory).catch(()=>[]))if(/^[a-f0-9]{64}\.json$/.test(entry)) {
    const candidate=JSON.parse(await readFile(path.join(directory,entry),'utf8')) as Binding;
    if(candidate.chatId===message.chat.id){value=candidate;break;}
  }
  if(!value||!controller||!await findUserById(value.userId))return;
  if(update.update_id!==undefined&&update.update_id<=(value.lastUpdate??-1))return;
  const current=value;
  try {
    const command=message.text.match(/^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
    const name=command?.[1].toLowerCase(),arg=command?.[2]?.trim()||'';
    const replySession=message.reply_to_message&&current.replies?.[message.reply_to_message.message_id];
    let sessionId=replySession||current.sessionId;
    if(replySession&&!await controller.session(current.userId,replySession))throw new Error('Чат недоступен. Выберите /chat или /new.');
    let answer:string;
    if(name==='help'||name==='start')answer=help;
    else if(name==='projects')answer=(await controller.projects(current.userId)).map(p=>`${p.name}\n/project ${p.id}`).join('\n\n')||'Нет доступных проектов.';
    else if(name==='chats')answer=(await controller.chats(current.userId)).slice(0,15).map(c=>`${c.title}\n/chat ${c.id}`).join('\n\n')||'Нет чатов. Отправьте первую задачу.';
    else if(name==='project') {
      const project=(await controller.projects(current.userId)).find(p=>p.id===arg);
      if(!project)throw new Error('Проект недоступен. Используйте /projects.');
      sessionId=await controller.create(current.userId,project.id);
      await patch(current.userId,current.chatId,{projectId:project.id,sessionId});answer=`Выбран проект: ${project.name}. Отправьте задачу.`;
    } else if(name==='new') {
      sessionId=await controller.create(current.userId);await patch(current.userId,current.chatId,{projectId:undefined,sessionId});answer='Создан новый чат. Отправьте задачу.';
    } else if(name==='chat') {
      if(!await controller.session(current.userId,arg))throw new Error('Чат недоступен. Используйте /chats.');
      sessionId=arg;await patch(current.userId,current.chatId,{sessionId,projectId:undefined});answer='Чат выбран. Отправьте задачу или ответ агенту.';
    } else if(name==='status')answer=await controller.status(current.userId,sessionId);
    else if(name==='stop') {
      if(!sessionId)throw new Error('Сначала выберите чат.');answer=await controller.stop(current.userId,sessionId);
    } else if(name&&name!=='task'&&name!=='reply')answer=help;
    else {
      const prompt=command?arg:message.text.trim();
      if(!prompt||prompt.length>16000)throw new Error('Укажите текст задачи или ответа (до 16000 символов).');
      if(!sessionId||!await controller.session(current.userId,sessionId)) {
        sessionId=await controller.create(current.userId,current.projectId);await patch(current.userId,current.chatId,{sessionId});
      }
      // Replies to results retain that session even if another project was selected.
      await patch(current.userId,current.chatId,{sessionId});
      const steered=name!=='task'&&await controller.reply(current.userId,sessionId,prompt);
      answer=steered?'Ответ передан агенту.':`Задача в очереди: ${await controller.submit(current.userId,sessionId,prompt,update.update_id)}`;
    }
    // Persist consumption before delivery: a Telegram outage must not execute a task twice.
    if(update.update_id!==undefined)await patch(current.userId,current.chatId,{lastUpdate:update.update_id});
    await send(current,answer,sessionId);
  } catch(error) {
    if(update.update_id!==undefined)await patch(current.userId,current.chatId,{lastUpdate:update.update_id});
    await send(current,error instanceof Error?error.message:'Ошибка обработки команды.').catch(()=>{});
  }
}
export function startTelegram() {
  if(!token)return;
  void(async()=>{
    try{offset=Number(await readFile(path.join(directory,'offset'),'utf8'))||0;}catch{}
    for(;;)try {
      const updates=await call('getUpdates',{offset,timeout:25,allowed_updates:['message']});
      for(const update of updates){await processTelegramUpdate(update);offset=Math.max(offset,update.update_id+1);}
      await mkdir(directory,{recursive:true,mode:0o700});await writeFile(path.join(directory,'offset'),String(offset),{mode:0o600});
    }catch{await new Promise(resolve=>setTimeout(resolve,5000));}
  })();
}

import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import { dataRoot } from './store.js';
import { findUserById } from './auth.js';
const directory=path.join(dataRoot,'telegram');
const pending=new Map<string,{userId:string;expires:number}>();
const token=process.env.TELEGRAM_BOT_TOKEN;
let botName='',offset=0;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const bindingFile=(userId:string)=>path.join(directory,hash(userId)+'.json');
type Binding={userId:string;chatId:number;name:string;enabled:boolean;lastError?:string};
async function call(method:string,body:object){
 if(!token)throw new Error('The server owner must configure TELEGRAM_BOT_TOKEN');
 let response:Response;
 try{response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(35000)});}catch{throw new Error('Failed to connect to Telegram');}
 const data=await response.json() as {ok:boolean;result:any;description?:string};
 if(!data.ok)throw new Error(data.description||'Telegram is unavailable');return data.result;
}
async function binding(userId:string):Promise<Binding|null>{try{return JSON.parse(await readFile(bindingFile(userId),'utf8'));}catch{return null;}}
async function save(value:Binding){await mkdir(directory,{recursive:true,mode:0o700});const file=bindingFile(value.userId),temp=file+'.'+randomBytes(6).toString('hex');await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,file);}
export async function telegramStatus(userId:string){const value=await binding(userId);return {configured:!!token,connected:!!value,name:value?.name||'',enabled:value?.enabled||false,lastError:value?.lastError||''};}
export async function telegramConnect(userId:string){
 if(!botName){const me=await call('getMe',{});if(typeof me.username!=='string'||!/^\w+$/.test(me.username))throw new Error('Telegram did not return the bot name');botName=me.username;}
 for(const [key,value] of pending)if(value.userId===userId||value.expires<Date.now())pending.delete(key);
 const code=randomBytes(24).toString('base64url');pending.set(hash(code),{userId,expires:Date.now()+600000});
 return {url:`https://t.me/${botName}?start=${code}`,expiresAt:new Date(Date.now()+600000).toISOString()};
}
export async function telegramDisconnect(userId:string){for(const [key,value] of pending)if(value.userId===userId)pending.delete(key);await unlink(bindingFile(userId)).catch(()=>undefined);}
export async function telegramEnable(userId:string,enabled:boolean){const value=await binding(userId);if(!value)throw new Error('First connect Telegram');value.enabled=enabled;await save(value);}
export async function notifyTelegram(userId:string,title:string,sessionId:string){
 if(!token)return;const value=await binding(userId);if(!value?.enabled)return;
 const origin=process.env.PUBLIC_URL;
 const link=origin&&/^https:\/\//.test(origin)?`${origin.replace(/\/$/,'')}/?session=${encodeURIComponent(sessionId)}`:'';
 try{await call('sendMessage',{chat_id:value.chatId,text:`The answer is ready: ${title.slice(0,120)}${link?'\n'+link:''}`,link_preview_options:{is_disabled:true}});value.lastError=undefined;}
 catch{value.lastError='Failed to deliver notification. Check that the bot is not blocked.';}
 // Do not restore a disconnected binding or overwrite settings changed during delivery.
 const latest=await binding(userId);if(latest&&latest.chatId===value.chatId){latest.lastError=value.lastError;await save(latest);}
}
export async function processTelegramUpdate(update:{message?:{text?:string;chat?:{id:number;type:string};from?:{id:number;username?:string;first_name?:string}}}){
 const message=update.message,match=message?.text?.match(/^\/start(?:@\w+)? ([A-Za-z0-9_-]{32})$/),key=match?hash(match[1]):'',pair=pending.get(key);
 if(pair&&pair.expires>Date.now()&&message?.chat?.type==='private'&&message.from?.id===message.chat.id&&await findUserById(pair.userId)){
  pending.delete(key);
  // One Telegram account belongs to one application account.
  for(const entry of await readdir(directory).catch(()=>[]))if(/^[a-f0-9]{64}\.json$/.test(entry)){
   const previous=JSON.parse(await readFile(path.join(directory,entry),'utf8')) as Binding;
   if(previous.chatId===message.chat.id&&previous.userId!==pair.userId)await unlink(path.join(directory,entry));
  }
  await save({userId:pair.userId,chatId:message.chat.id,name:message.from.username?`@${message.from.username}`:message.from.first_name||'Telegram',enabled:true});
 }
}
export function startTelegram(){
 if(!token)return;
 void (async()=>{
  try{offset=Number(await readFile(path.join(directory,'offset'),'utf8'))||0;}catch{}
  for(;;){
   try{
    const updates=await call('getUpdates',{offset,timeout:25,allowed_updates:['message']});
    for(const update of updates){
     await processTelegramUpdate(update);
     offset=Math.max(offset,update.update_id+1);
    }
    await mkdir(directory,{recursive:true,mode:0o700});await writeFile(path.join(directory,'offset'),String(offset),{mode:0o600});
   }catch{await new Promise(resolve=>setTimeout(resolve,5000));}
  }
 })();
}

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('Telegram binds only private verified start messages and sends only when enabled',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'router-telegram-'));
 process.env.DATA_DIR=root;process.env.TELEGRAM_BOT_TOKEN='test-token';process.env.PUBLIC_URL='https://example.test';
 const original=globalThis.fetch;let fail=false;const deliveries:Record<string,unknown>[]=[];
 globalThis.fetch=async(input,init)=>{
  const method=String(input).split('/').pop();
  if(method==='getMe')return new Response(JSON.stringify({ok:true,result:{username:'test_bot'}}));
  assert.equal(method,'sendMessage');deliveries.push(JSON.parse(String(init?.body)));
  return new Response(JSON.stringify(fail?{ok:false,description:'blocked'}:{ok:true,result:{message_id:deliveries.length}}));
 };
 try{
  const {registerUser}=await import('./auth.js');const user=await registerUser('telegram-test','test-password-long');
  const tg=await import('./telegram.js');
  assert.equal((await tg.telegramStatus(user.id)).connected,false);
  const link=await tg.telegramConnect(user.id),code=new URL(link.url).searchParams.get('start');
  const start=(type:string='private',sender=123)=>({message:{text:'/start '+code,chat:{id:123,type},from:{id:sender,username:'alice'}}});
  await tg.processTelegramUpdate(start('group'));await tg.processTelegramUpdate(start('private',456));assert.equal((await tg.telegramStatus(user.id)).connected,false);
  await tg.processTelegramUpdate(start());assert.equal((await tg.telegramStatus(user.id)).name,'@alice');
  await tg.notifyTelegram(user.id,'Task','session');assert.equal(deliveries.length,1);assert.equal(deliveries[0].chat_id,123);assert.match(String(deliveries[0].text),/https:\/\/example.test\/\?session=session/);
  await tg.telegramEnable(user.id,false);await tg.notifyTelegram(user.id,'Task','session');assert.equal(deliveries.length,1);
  await tg.telegramEnable(user.id,true);fail=true;await tg.notifyTelegram(user.id,'Task','session');assert.match((await tg.telegramStatus(user.id)).lastError,/deliver/);
  await tg.telegramDisconnect(user.id);await tg.processTelegramUpdate(start());assert.equal((await tg.telegramStatus(user.id)).connected,false);await tg.notifyTelegram(user.id,'Task','session');assert.equal(deliveries.length,2);
  const pending=await tg.telegramConnect(user.id);await tg.telegramDisconnect(user.id);await tg.processTelegramUpdate({message:{text:'/start '+new URL(pending.url).searchParams.get('start'),chat:{id:123,type:'private'},from:{id:123}}});assert.equal((await tg.telegramStatus(user.id)).connected,false);
  fail=false;
  const submissions:{session:string;prompt:string}[]=[],replies:{session:string;prompt:string}[]=[];
  const sessions=new Set<string>();let busy=false,created=0;
  tg.setTelegramController({
   projects:async()=>[{id:'project-a',name:'Project A'}],chats:async()=>[],
   session:async(_,id)=>sessions.has(id),
   create:async()=>{const id='chat-'+(++created);sessions.add(id);return id;},
   submit:async(_,session,prompt)=>{submissions.push({session,prompt});return 'task';},
   reply:async(_,session,prompt)=>{if(!busy)return false;replies.push({session,prompt});return true;},
   status:async()=> 'running',stop:async()=> 'stopped'
  });
  const reconnect=await tg.telegramConnect(user.id);
  await tg.processTelegramUpdate({message:{text:'/start '+new URL(reconnect.url).searchParams.get('start'),chat:{id:123,type:'private'},from:{id:123}}});
  const update=(id:number,text:string,replyId?:number)=>({update_id:id,message:{text,chat:{id:123,type:'private'},from:{id:123},...(replyId?{reply_to_message:{message_id:replyId}}:{})}});
  await tg.processTelegramUpdate(update(1,'/project project-a'));
  await Promise.all([tg.processTelegramUpdate(update(2,'First task')),tg.processTelegramUpdate(update(2,'First task'))]);
  assert.deepEqual(submissions,[{session:'chat-1',prompt:'First task'}],'duplicate delivery creates one task');
  busy=true;
  await tg.processTelegramUpdate(update(3,'Use TypeScript'));
  assert.deepEqual(replies,[{session:'chat-1',prompt:'Use TypeScript'}]);
  await tg.processTelegramUpdate(update(4,'/task Separate task'));
  assert.equal(submissions.length,2,'explicit /task queues even during execution');
  await tg.notifyTelegram(user.id,'Result','chat-1','Full answer');
  const resultMessage=deliveries.length;
  assert.match(String(deliveries.at(-1)?.text),/Full answer/);
  await tg.processTelegramUpdate(update(5,'/new'));
  await tg.processTelegramUpdate(update(6,'Refine old answer',resultMessage));
  assert.deepEqual(replies.at(-1),{session:'chat-1',prompt:'Refine old answer'},'reply targets original chat after selection changes');
  const count=deliveries.length;
  await tg.processTelegramUpdate(update(7,'/chat forbidden'));
  assert.match(String(deliveries.at(-1)?.text),/недоступен/);
  assert.equal(deliveries.length,count+1);
  busy=false;fail=true;
  await tg.processTelegramUpdate(update(8,'Delivery failure task'));
  fail=false;await tg.processTelegramUpdate(update(8,'Delivery failure task'));
  assert.equal(submissions.filter(s=>s.prompt==='Delivery failure task').length,1);
  const unicode='😀'.repeat(5000),chunks=tg.telegramChunks(unicode);
  assert.equal(chunks.join(''),unicode);assert.ok(chunks.every(c=>c.length<=3500&&!/[\uD800-\uDBFF]$/.test(c)));
  await tg.telegramDisconnect(user.id);
  await tg.processTelegramUpdate(update(9,'Must not execute'));
  assert.equal(submissions.length,3,'disconnected accounts cannot submit tasks');
 }finally{globalThis.fetch=original;await rm(root,{recursive:true,force:true});}
});

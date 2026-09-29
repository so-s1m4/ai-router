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
  return new Response(JSON.stringify(fail?{ok:false,description:'blocked'}:{ok:true,result:{}}));
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
  await tg.telegramEnable(user.id,true);fail=true;await tg.notifyTelegram(user.id,'Task','session');assert.match((await tg.telegramStatus(user.id)).lastError,/доставить/);
  await tg.telegramDisconnect(user.id);await tg.processTelegramUpdate(start());assert.equal((await tg.telegramStatus(user.id)).connected,false);await tg.notifyTelegram(user.id,'Task','session');assert.equal(deliveries.length,2);
  const pending=await tg.telegramConnect(user.id);await tg.telegramDisconnect(user.id);await tg.processTelegramUpdate({message:{text:'/start '+new URL(pending.url).searchParams.get('start'),chat:{id:123,type:'private'},from:{id:123}}});assert.equal((await tg.telegramStatus(user.id)).connected,false);
 }finally{globalThis.fetch=original;await rm(root,{recursive:true,force:true});}
});

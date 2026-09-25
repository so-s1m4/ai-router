import { createHash, randomUUID } from 'node:crypto';
import { chmod, readFile, rename, stat, unlink, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

type RecordValue = Record<string, unknown>;
const object = (value:unknown):value is RecordValue => !!value && typeof value==='object' && !Array.isArray(value);
const root=path.resolve(process.env.RUNNER_DATA_DIR||'/runner-data');
const replace=process.argv.includes('--replace');

async function input():Promise<string>{
  const chunks:Buffer[]=[];let length=0;
  for await(const chunk of process.stdin){const part=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);length+=part.length;if(length>8*1024*1024)throw new Error('Архив больше 8 МБ');chunks.push(part);}
  return Buffer.concat(chunks).toString('utf8');
}

function parseJson(raw:string):unknown{try{return JSON.parse(raw);}catch{throw new Error('Неверный JSON');}}
function displayName(profile:RecordValue,index:number):string{
  const raw=[profile.customName,profile.email].find(x=>typeof x==='string'&&x.trim()) as string|undefined;
  const name=(raw||`Codex ${index+1}`).replace(/^\[([^\]]+)\]\(mailto:[^)]+\)$/,'$1').trim().slice(0,60);
  return name||`Codex ${index+1}`;
}
function profiles(raw:string):{name:string;key:string;auth:RecordValue}[]{
  const archive=parseJson(raw);
  if(!object(archive)||archive.format!=='codex-profiles-archive'||archive.version!==1||!Array.isArray(archive.profiles)||!archive.profiles.length)throw new Error('Ожидается codex-profiles-archive версии 1');
  const found=new Set<string>();const result:{name:string;key:string;auth:RecordValue}[]=[];
  for(const [index,entry] of archive.profiles.entries()){
    if(!object(entry)||typeof entry.authJSONString!=='string')throw new Error(`Профиль ${index+1}: отсутствует authJSONString`);
    const auth=parseJson(entry.authJSONString);
    if(!object(auth)||auth.auth_mode!=='chatgpt'||!object(auth.tokens))throw new Error(`Профиль ${index+1}: требуется сессия ChatGPT Codex`);
    const tokens=auth.tokens;
    if(!['id_token','access_token','refresh_token','account_id'].every(key=>typeof tokens[key]==='string'&&!!(tokens[key] as string).trim()))throw new Error(`Профиль ${index+1}: неполные данные входа`);
    const key=createHash('sha256').update('codex-profile:'+tokens.account_id).digest('hex');
    if(found.has(key))continue;
    found.add(key);result.push({name:displayName(entry,index),key,auth});
  }
  return result;
}

async function main(){
  const server=process.env.ROUTER_SERVER_URL?.replace(/\/$/,'');
  if(!server)throw new Error('Укажите ROUTER_SERVER_URL в runner/.env');
  const url=new URL(server);
  if(url.protocol!=='https:'&&process.env.ROUTER_ALLOW_INSECURE!=='true')throw new Error('Для удалённого сервера требуется HTTPS');
  const archive=profiles(await input());
  let device:unknown;
  try{device=parseJson(await readFile(path.join(root,'device.json'),'utf8'));}catch{throw new Error('Сначала привяжите контейнер исполнителя к сайту');}
  if(!object(device)||typeof device.id!=='string'||typeof device.secret!=='string')throw new Error('Неверные данные исполнителя');
  for(const profile of archive){
    const response=await fetch(server+'/api/runner/accounts/import',{method:'POST',headers:{'Content-Type':'application/json','X-Runner-ID':device.id,'X-Runner-Secret':device.secret},body:JSON.stringify({name:profile.name,importKey:profile.key}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error(`Сайт отклонил импорт: HTTP ${response.status}`);
    const account=await response.json() as {id?:unknown};
    if(typeof account.id!=='string'||!/^[0-9a-f-]{36}$/.test(account.id))throw new Error('Сайт вернул неверный ID аккаунта');
    const home=path.join(root,'accounts',account.id,'home');const codexHome=path.join(home,'.codex');const target=path.join(codexHome,'auth.json');
    await mkdir(codexHome,{recursive:true,mode:0o700});
    try{await stat(target);if(!replace){console.log(`${profile.name}: уже импортирован; сохранена текущая сессия`);continue;}}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    const temp=path.join(codexHome,`.auth-${randomUUID()}.tmp`);
    try{await writeFile(temp,JSON.stringify(profile.auth)+'\n',{mode:0o600,flag:'wx'});await rename(temp,target);await chmod(target,0o600);}finally{await unlink(temp).catch(()=>{});}
    console.log(`${profile.name}: импортирован в локальный контейнер`);
  }
  console.log(`Готово: ${archive.length} профиль(ей). Секреты не отправлялись на сайт.`);
}

main().catch(error=>{console.error(error instanceof Error?error.message:'Ошибка импорта');process.exitCode=1;});

import { createHash, randomUUID } from 'node:crypto';
import { chmod, readFile, rename, stat, unlink, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

type RecordValue = Record<string, unknown>;
const object = (value:unknown):value is RecordValue => !!value && typeof value==='object' && !Array.isArray(value);
const root=path.resolve(process.env.RUNNER_DATA_DIR||'/runner-data');
const replace=process.argv.includes('--replace');

async function input():Promise<string>{
  const chunks:Buffer[]=[];let length=0;
  for await(const chunk of process.stdin){const part=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);length+=part.length;if(length>8*1024*1024)throw new Error('Archive larger than 8 MB');chunks.push(part);}
  return Buffer.concat(chunks).toString('utf8');
}

function parseJson(raw:string):unknown{try{return JSON.parse(raw);}catch{throw new Error('Invalid JSON');}}
function displayName(profile:RecordValue,index:number):string{
  const raw=[profile.customName,profile.email].find(x=>typeof x==='string'&&x.trim()) as string|undefined;
  const name=(raw||`Codex ${index+1}`).replace(/^\[([^\]]+)\]\(mailto:[^)]+\)$/,'$1').trim().slice(0,60);
  return name||`Codex ${index+1}`;
}
function profiles(raw:string):{name:string;key:string;auth:RecordValue}[]{
  const archive=parseJson(raw);
  if(!object(archive)||archive.format!=='codex-profiles-archive'||archive.version!==1||!Array.isArray(archive.profiles)||!archive.profiles.length)throw new Error('Codex-profiles-archive version 1 expected');
  const found=new Set<string>();const result:{name:string;key:string;auth:RecordValue}[]=[];
  for(const [index,entry] of archive.profiles.entries()){
    if(!object(entry)||typeof entry.authJSONString!=='string')throw new Error(`Profile ${index+1}: missing authJSONString`);
    const auth=parseJson(entry.authJSONString);
    if(!object(auth)||auth.auth_mode!=='chatgpt'||!object(auth.tokens))throw new Error(`Profile ${index+1}: ChatGPT Codex session required`);
    const tokens=auth.tokens;
    if(!['id_token','access_token','refresh_token','account_id'].every(key=>typeof tokens[key]==='string'&&!!(tokens[key] as string).trim()))throw new Error(`Profile ${index+1}: incomplete login details`);
    const key=createHash('sha256').update('codex-profile:'+tokens.account_id).digest('hex');
    if(found.has(key))continue;
    found.add(key);result.push({name:displayName(entry,index),key,auth});
  }
  return result;
}

async function main(){
  const server=process.env.ROUTER_SERVER_URL?.replace(/\/$/,'');
  if(!server)throw new Error('Specify ROUTER_SERVER_URL in runner/.env');
  const url=new URL(server);
  if(url.protocol!=='https:'&&process.env.ROUTER_ALLOW_INSECURE!=='true')throw new Error('Remote server requires HTTPS');
  const archive=profiles(await input());
  let device:unknown;
  try{device=parseJson(await readFile(path.join(root,'device.json'),'utf8'));}catch{throw new Error('First bind the runner container to the site');}
  if(!object(device)||typeof device.id!=='string'||typeof device.secret!=='string')throw new Error('Invalid runner information');
  for(const profile of archive){
    const response=await fetch(server+'/api/runner/accounts/import',{method:'POST',headers:{'Content-Type':'application/json','X-Runner-ID':device.id,'X-Runner-Secret':device.secret},body:JSON.stringify({name:profile.name,importKey:profile.key}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error(`The site rejected the import: HTTP ${response.status}`);
    const account=await response.json() as {id?:unknown};
    if(typeof account.id!=='string'||!/^[0-9a-f-]{36}$/.test(account.id))throw new Error('The site returned the wrong account ID');
    const home=path.join(root,'accounts',account.id,'home');const codexHome=path.join(home,'.codex');const target=path.join(codexHome,'auth.json');
    await mkdir(codexHome,{recursive:true,mode:0o700});
    try{await stat(target);if(!replace){console.log(`${profile.name}: already imported; current session saved`);continue;}}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    const temp=path.join(codexHome,`.auth-${randomUUID()}.tmp`);
    try{await writeFile(temp,JSON.stringify(profile.auth)+'\n',{mode:0o600,flag:'wx'});await rename(temp,target);await chmod(target,0o600);}finally{await unlink(temp).catch(()=>{});}
    console.log(`${profile.name}: imported into local container`);
  }
  console.log(`Done: ${archive.length} profile(s). Secrets were not sent to the site.`);
}

main().catch(error=>{console.error(error instanceof Error?error.message:'Import error');process.exitCode=1;});

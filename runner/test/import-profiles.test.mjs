import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, stat, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const accountId='123e4567-e89b-42d3-a456-426614174000';
const device={id:'123e4567-e89b-42d3-a456-426614174001',secret:'test-device-secret'};
const auth={auth_mode:'chatgpt',OPENAI_API_KEY:null,tokens:{id_token:'secret-id',access_token:'secret-access',refresh_token:'secret-refresh',account_id:'account-one'},last_refresh:'2026-09-25T00:00:00Z'};
const archive=JSON.stringify({format:'codex-profiles-archive',version:1,profiles:[{email:'user@example.com',authJSONString:JSON.stringify(auth)}]});

function run(input,env,args=[]){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,['dist/import-profiles.js',...args],{cwd:process.cwd(),env:{...process.env,...env},stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);child.on('error',reject);child.on('close',code=>resolve({code,out,err}));child.stdin.end(input);});}

test('imports locally, sends only metadata, and preserves refreshed credentials',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'ai-router-import-'));
  const requests=[];
  const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;requests.push({headers:req.headers,body});res.writeHead(201,{'Content-Type':'application/json'});res.end(JSON.stringify({id:accountId,name:'user@example.com'}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    await mkdir(root,{recursive:true});await writeFile(path.join(root,'device.json'),JSON.stringify(device),{mode:0o600});
    const env={RUNNER_DATA_DIR:root,ROUTER_SERVER_URL:`http://127.0.0.1:${server.address().port}`,ROUTER_ALLOW_INSECURE:'true'};
    const first=await run(archive,env);assert.equal(first.code,0,first.err);
    assert.equal(requests.length,1);assert.equal(requests[0].headers['x-runner-id'],device.id);
    assert.deepEqual(Object.keys(JSON.parse(requests[0].body)).sort(),['importKey','name']);
    assert.ok(!requests[0].body.includes('secret-refresh'));
    const target=path.join(root,'accounts',accountId,'home','.codex','auth.json');
    assert.deepEqual(JSON.parse(await readFile(target,'utf8')),auth);
    assert.equal((await stat(target)).mode&0o777,0o600);
    const refreshed={...auth,tokens:{...auth.tokens,refresh_token:'new-refresh'}};
    await writeFile(target,JSON.stringify(refreshed),{mode:0o600});
    const again=await run(archive,env);assert.equal(again.code,0,again.err);
    assert.deepEqual(JSON.parse(await readFile(target,'utf8')),refreshed);
    const replaced=await run(archive,env,['--replace']);assert.equal(replaced.code,0,replaced.err);
    assert.deepEqual(JSON.parse(await readFile(target,'utf8')),auth);
    const invalid=await run(JSON.stringify({format:'codex-profiles-archive',version:1,profiles:[{email:'bad',authJSONString:JSON.stringify({...auth,tokens:{...auth.tokens,refresh_token:''}})}]}),env);
    assert.equal(invalid.code,1);assert.ok(!invalid.err.includes('secret-access'));
  }finally{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});

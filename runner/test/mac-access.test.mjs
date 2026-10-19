import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeOpenRouter } from '../dist/openrouter.js';

for (const offline of [false,true]) test(`Mac commands use the bridge and never fall back to server shell (${offline?'offline':'online'})`,async()=>{
  const home=await mkdtemp(path.join(os.tmpdir(),'router-mac-tool-'));
  await mkdir(path.join(home,'.openrouter'));await writeFile(path.join(home,'.openrouter/auth.json'),JSON.stringify({apiKey:'test-key'}));
  const original=globalThis.fetch;let turns=0,commands=0;
  globalThis.fetch=async(url,options)=>{
    const body=JSON.parse(options.body);
    if(url==='https://router.test/api/mac/mcp'){
      commands++;assert.equal(options.headers.Authorization,'Bearer test-mac-token');
      assert.equal(body.params.name,'mac_run_command');assert.equal(body.params.arguments.cwd,'/Users/test/Documents');
      return offline?new Response('',{status:401}):Response.json({jsonrpc:'2.0',id:body.id,result:{content:[{type:'text',text:'Exit code: 0\nMac result'}]}});
    }
    if(++turns===1)return Response.json({choices:[{message:{tool_calls:[{id:'mac-tool',type:'function',function:{name:'run_command',arguments:JSON.stringify({command:'touch should-not-exist',cwd:'/Users/test/Documents'})}}]}}]});
    assert.match(body.messages.at(-1).content,offline?/Mac access unavailable/:/Mac result/);
    return Response.json({choices:[{message:{content:'Done'},finish_reason:'stop'}]});
  };
  try{
    const job={model:'test',mode:'task',prompt:'Use my Mac',macAccess:{url:'https://router.test/api/mac/mcp',token:'test-mac-token'}};
    assert.equal(await executeOpenRouter(job,home,home,new AbortController().signal,()=>{}),'Done');
    assert.equal(commands,1);await assert.rejects(readFile(path.join(home,'should-not-exist')));
  }finally{globalThis.fetch=original;await rm(home,{recursive:true,force:true});}
});

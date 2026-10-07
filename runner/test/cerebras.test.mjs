import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cerebrasBody, cerebrasModels, saveCerebrasKey, executeCerebras, readCerebrasKey } from '../dist/cerebras.js';
import { accountStatus } from '../dist/cli.js';

const job={provider:'cerebras',model:'gpt-oss-120b',mode:'chat',reasoning:'medium',prompt:'Hello'};
const key='csk-test-12345678901234567890';
const directory={data:[{id:'gpt-oss-120b'},{id:'qwen-3.8-27b'}]};

test('Cerebras key validation, private storage, discovery, completion and usage',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'cerebras-'));const original=globalThis.fetch;let payload;
  globalThis.fetch=async(url,options)=>{
    assert.equal(options.headers.Authorization,`Bearer ${key}`);
    assert.ok(url.startsWith('https://api.cerebras.ai/v1/'));
    if(url.endsWith('/models'))return Response.json(directory);
    payload=JSON.parse(options.body);
    return Response.json({choices:[{message:{content:'Hello back'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}});
  };
  try {
    await assert.rejects(readCerebrasKey(dir),e=>e.code==='auth');
    await saveCerebrasKey(dir,key);
    assert.equal((await stat(path.join(dir,'.cerebras/auth.json'))).mode & 0o777,0o600);
    assert.equal((await accountStatus('cerebras',dir,new AbortController().signal)).models[0].id,'gpt-oss-120b');
    const events=[];
    assert.equal(await executeCerebras(job,dir,dir,new AbortController().signal,e=>events.push(e)),'Hello back');
    assert.equal(payload.model,job.model);assert.equal(payload.reasoning_effort,'medium');
    assert.equal(payload.stream,false);assert.equal(payload.temperature,0.2);assert.equal(payload.top_p,1);
    assert.equal(payload.reasoning,undefined);assert.equal(payload.provider,undefined);
    assert.equal(events.find(e=>e.type==='usage').data.totalTokens,15);
    assert.ok(!JSON.stringify(events).includes(key));
    for(const [status,code] of [[401,'auth'],[403,'auth'],[429,'rate_limit'],[503,'unavailable']]) {
      globalThis.fetch=async()=>new Response(JSON.stringify({error:key}),{status});
      await assert.rejects(saveCerebrasKey(dir,key+'-changed'),e=>e.code===code&&!e.message.includes(key));
      assert.equal(await readCerebrasKey(dir),key);
    }
  } finally {globalThis.fetch=original;await rm(dir,{recursive:true,force:true});}
});

test('Cerebras task tools preserve reasoning and create workspace files',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'cerebras-tools-'));const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(url,options)=>{
    if(url.endsWith('/models'))return Response.json(directory);
    const body=JSON.parse(options.body);calls++;
    if(calls===1) {
      assert.ok(body.tools.length);
      return Response.json({choices:[{message:{content:null,reasoning:'Create file',tool_calls:[{id:'write',type:'function',function:{name:'run_command',arguments:JSON.stringify({command:'printf hello > result.txt'})}}]}}]});
    }
    assert.match(body.messages.at(-1).content,/Exit code: 0/);
    assert.equal(body.messages.at(-2).reasoning,'Create file');
    return Response.json({choices:[{message:{content:'Done'},finish_reason:'stop'}]});
  };
  try {
    await saveCerebrasKey(dir,key);
    assert.equal(await executeCerebras({...job,mode:'task'},dir,dir,new AbortController().signal,()=>{}),'Done');
    assert.equal(await readFile(path.join(dir,'result.txt'),'utf8'),'hello');
  } finally {globalThis.fetch=original;await rm(dir,{recursive:true,force:true});}
});

test('Cerebras CCC code uses JSON without tools, retries unsupported schemas, resolves default models and rejects truncation',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'cerebras-code-'));const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(url,options)=>{
    if(url.endsWith('/models'))return Response.json(directory);
    const body=JSON.parse(options.body);calls++;
    assert.equal(body.model,'gpt-oss-120b');assert.equal(body.tools,undefined);
    if(calls===1){assert.equal(body.response_format.type,'json_schema');return new Response('{}',{status:400});}
    assert.equal(body.response_format,undefined);
    return Response.json({choices:[{message:{content:'```json\n{"source":"int main(){}","outputMode":"exact"}\n```'},finish_reason:'stop'}]});
  };
  try {
    await saveCerebrasKey(dir,key);
    const text=await executeCerebras({...job,model:'default',mode:'task',solverCodeOnly:true},dir,dir,new AbortController().signal,()=>{});
    assert.equal(JSON.parse(text).source,'int main(){}');assert.equal(calls,2);
    globalThis.fetch=async()=>Response.json({choices:[{message:{content:'partial'},finish_reason:'length'}]});
    await assert.rejects(executeCerebras(job,dir,dir,new AbortController().signal,()=>{}),/Cerebras answer was truncated/);
  } finally {globalThis.fetch=original;await rm(dir,{recursive:true,force:true});}
});

test('Cerebras advertises supported reasoning levels and never sends OpenRouter routing',()=>{
  const models=cerebrasModels([{id:'gpt-oss-120b'},{id:'qwen-3.8-27b'},{id:'unknown'},null]);
  assert.deepEqual(models[0].reasoning.map(r=>r.id),['low','medium','high']);
  assert.deepEqual(models[1].reasoning.map(r=>r.id),['none','low','medium','high']);
  assert.equal(models[2].reasoning,undefined);
  const body=cerebrasBody({...job,reasoning:'default',openRouterRouting:{only:['google'],allowFallbacks:false}},[]);
  assert.equal(body.reasoning_effort,undefined);assert.equal(body.provider,undefined);
  assert.throws(()=>cerebrasBody({...job,reasoning:'xhigh'},[]),/Unsupported Cerebras/);
});

test('Cerebras recovers reasoning-only solver responses without tools and accumulates retry usage',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'cerebras-empty-'));const original=globalThis.fetch;let calls=0;
  const events=[];
  globalThis.fetch=async(url,options)=>{
    if(url.endsWith('/models'))return Response.json(directory);
    const body=JSON.parse(options.body);calls++;
    assert.equal(body.tools,undefined);assert.equal(body.reasoning_effort,'medium');
    assert.equal(body.messages[1].content,job.prompt);
    if(calls===1){
      assert.equal(body.response_format.type,'json_schema');
      return Response.json({choices:[{message:{content:null,reasoning:'Need to implement solver'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}});
    }
    assert.equal(body.response_format,undefined);assert.match(body.messages.at(-1).content,/complete requested solver JSON/);
    return Response.json({choices:[{message:{content:'{"source":"print(42)","outputMode":"exact"}'},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:8,total_tokens:20}});
  };
  try{
    await saveCerebrasKey(dir,key);
    assert.equal(JSON.parse(await executeCerebras({...job,mode:'task',solverCodeOnly:true},dir,dir,new AbortController().signal,e=>events.push(e))).source,'print(42)');
    assert.equal(calls,2);assert.equal(events.filter(e=>e.type==='usage').at(-1).data.totalTokens,35);
    assert.equal(events.filter(e=>e.type==='delta').length,1);
    assert.ok(events.some(e=>e.type==='status'&&e.message.includes('retrying (1/2)')));
  }finally{globalThis.fetch=original;await rm(dir,{recursive:true,force:true});}
});

test('Cerebras empty-answer recovery is bounded and does not retry truncation, filtering, auth or cancellation',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'cerebras-empty-limit-'));const original=globalThis.fetch;
  try{
    globalThis.fetch=async()=>Response.json(directory);await saveCerebrasKey(dir,key);
    for(const [finishReason,expectedCalls,pattern] of [['stop',3,/empty answer after 2 retries/],['length',1,/truncated.*token limit/],['content_filter',1,/empty answer/]]){
      let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({choices:[{message:{content:' ',reasoning:'Thinking'},finish_reason:finishReason}]});};
      await assert.rejects(executeCerebras(job,dir,dir,new AbortController().signal,()=>{}),pattern);
      assert.equal(calls,expectedCalls);
    }
    let calls=0;globalThis.fetch=async()=>{calls++;return new Response('{}',{status:401});};
    await assert.rejects(executeCerebras(job,dir,dir,new AbortController().signal,()=>{}),e=>e.code==='auth');assert.equal(calls,1);
    const controller=new AbortController();calls=0;
    globalThis.fetch=async()=>{calls++;return Response.json({choices:[{message:{content:null},finish_reason:'stop'}]});};
    await assert.rejects(executeCerebras(job,dir,dir,controller.signal,e=>{if(e.type==='status'&&e.message.includes('retrying'))controller.abort(new Error('Cancelled'));}),/Cancelled/);
    assert.equal(calls,1);
  }finally{globalThis.fetch=original;await rm(dir,{recursive:true,force:true});}
});

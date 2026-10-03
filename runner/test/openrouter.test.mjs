import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeOpenRouter, saveOpenRouterKey, openRouterModels, openRouterBody } from '../dist/openrouter.js';

const job={model:'test/model',mode:'chat',reasoning:'high',prompt:'Hello'};
test('OpenRouter validates keys, stores private credentials and sends model/reasoning/usage',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'openrouter-'));const original=globalThis.fetch;const key='sk-or-test-12345678901234567890';let payload;
  globalThis.fetch=async(url,options)=>{
    assert.equal(options.headers.Authorization,`Bearer ${key}`);
    if(url.endsWith('/key'))return Response.json({data:{}});
    payload=JSON.parse(options.body);
    return Response.json({choices:[{message:{content:'Hello back'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}});
  };
  try{
    await saveOpenRouterKey(dir,key);assert.equal((await stat(path.join(dir,'.openrouter/auth.json'))).mode & 0o777,0o600);
    const events=[];const text=await executeOpenRouter(job,dir,dir,new AbortController().signal,e=>events.push(e));
    assert.equal(text,'Hello back');assert.equal(payload.model,'test/model');assert.deepEqual(payload.reasoning,{effort:'high'});
    assert.equal(events.find(e=>e.type==='usage').data.totalTokens,15);assert.ok(!JSON.stringify(events).includes(key));
    globalThis.fetch=async()=>new Response(JSON.stringify({error:key}),{status:401});
    await assert.rejects(saveOpenRouterKey(dir,key+'-changed'),e=>e.code==='auth'&&!e.message.includes(key));
    assert.equal(JSON.parse(await readFile(path.join(dir,'.openrouter/auth.json'),'utf8')).apiKey,key);
  }finally{globalThis.fetch=original;await rm(dir,{recursive:true,force:true});}
});
test('OpenRouter tool loop executes task commands and returns results to model',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'openrouter-tools-'));const original=globalThis.fetch;const events=[];let calls=0;
  globalThis.fetch=async(url,options)=>{
    if(url.endsWith('/key'))return Response.json({data:{}});
    const body=JSON.parse(options.body);calls++;assert.deepEqual(body.provider,{only:['google-ai-studio/flex'],allow_fallbacks:false});
    if(calls===1){assert.ok(body.tools.length);return Response.json({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'tool-1',type:'function',function:{name:'run_command',arguments:JSON.stringify({command:"printf hello > result.txt"})}}]}}],usage:{prompt_tokens:5,completion_tokens:5,total_tokens:10}});}
    assert.match(body.messages.at(-1).content,/Exit code: 0/);assert.equal(body.messages.at(-1).tool_call_id,'tool-1');
    return Response.json({choices:[{message:{content:'Created result.txt'},finish_reason:'stop'}],usage:{prompt_tokens:5,completion_tokens:5,total_tokens:10}});
  };
  try{await saveOpenRouterKey(dir,'sk-or-test-12345678901234567890');assert.equal(await executeOpenRouter({...job,mode:'task',openRouterRouting:{only:['google-ai-studio/flex'],allowFallbacks:false}},dir,dir,new AbortController().signal,e=>events.push(e)),'Created result.txt');assert.equal(await readFile(path.join(dir,'result.txt'),'utf8'),'hello');assert.equal(events.filter(e=>e.type==='usage').at(-1).data.totalTokens,20);}
  finally{globalThis.fetch=original;await rm(dir,{recursive:true,force:true});}
});
test('OpenRouter filters non-text models and exposes reasoning support',()=>{
 const models=openRouterModels([{id:'x/chat',name:'Chat',architecture:{output_modalities:['text']},supported_parameters:['reasoning']},{id:'x/image',architecture:{output_modalities:['image']}}]);assert.equal(models.length,1);assert.equal(models[0].id,'x/chat');assert.ok(models[0].reasoning.length);
});
test('OpenRouter code mode retries unsupported structured output without tools and normalizes fenced JSON',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'openrouter-json-'));const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(url,options)=>{
    if(url.endsWith('/key'))return Response.json({data:{}});
    calls++;const body=JSON.parse(options.body);assert.equal(body.tools,undefined);assert.deepEqual(body.provider,{only:['google-ai-studio/flex'],allow_fallbacks:false});
    if(calls===1){assert.equal(body.response_format.type,'json_schema');return new Response('{}',{status:400});}
    assert.equal(body.response_format,undefined);
    return Response.json({choices:[{message:{content:'```json\n{"source":"int main(){}","outputMode":"exact"}\n```'},finish_reason:'stop'}]});
  };
  try{await saveOpenRouterKey(dir,'sk-or-test-12345678901234567890');const result=await executeOpenRouter({...job,mode:'task',solverCodeOnly:true,openRouterRouting:{only:['google-ai-studio/flex'],allowFallbacks:false}},dir,dir,new AbortController().signal,()=>{});assert.equal(JSON.parse(result).source,'int main(){}');assert.equal(calls,2);}
  finally{globalThis.fetch=original;await rm(dir,{recursive:true,force:true});}
});

test('OpenRouter routing preserves legacy defaults and supports automatic or restricted providers',()=>{
  assert.equal(openRouterBody(job,[]).provider,undefined);
  assert.deepEqual(openRouterBody({...job,openRouterRouting:{only:[],allowFallbacks:false}},[]).provider,{allow_fallbacks:false});
  assert.deepEqual(openRouterBody({...job,openRouterRouting:{only:['google-ai-studio/flex','google-vertex'],allowFallbacks:true}},[]).provider,{only:['google-ai-studio/flex','google-vertex'],allow_fallbacks:true});
});

test('large tool output retains beginning, end and reasoning tool history', async () => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'openrouter-output-'));
  const original=globalThis.fetch;let calls=0;
  const reasoning=[{type:'reasoning.text',text:'Preserve tool reasoning'}];
  globalThis.fetch=async(url,options)=>{
    if(url.endsWith('/key'))return Response.json({data:{}});
    const body=JSON.parse(options.body);
    if(++calls===1)return Response.json({choices:[{message:{role:'assistant',content:null,reasoning_details:reasoning,tool_calls:[{id:'out',type:'function',function:{name:'run_command',arguments:JSON.stringify({command:`node -e "process.stdout.write('START'+'x'.repeat(40000)+'END')"`})}}]}}]});
    const result=body.messages.at(-1).content;
    assert.match(result,/Exit code: 0\nSTART/);
    assert.match(result,/truncated/);
    assert.ok(result.endsWith('END'));
    assert.ok(result.length<24100);
    assert.deepEqual(body.messages.at(-2).reasoning_details,reasoning);
    return Response.json({choices:[{message:{content:'Done'},finish_reason:'stop'}]});
  };
  try{
    await saveOpenRouterKey(dir,'sk-or-test-12345678901234567890');
    assert.equal(await executeOpenRouter({...job,mode:'task'},dir,dir,new AbortController().signal,()=>{}),'Done');
  }finally{globalThis.fetch=original;await rm(dir,{recursive:true,force:true});}
});

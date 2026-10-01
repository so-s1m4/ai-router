import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCccAuto, contestReference, readAnswers } from '../dist/ccc-auto.js';
import { recoveringCcc, toolData } from '../dist/ccc-client.js';

const job = { taskId:'task', jobId:'job', sessionId:'session', accountId:'account', provider:'codex', model:'ignored', mode:'task', workflow:'ccc-auto', prompt:'https://codingcontest.org/contests/training-example/game' };
async function fixture(action, options = {}) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ccc-auto-'));
  const controller = new AbortController();
  const calls = [], events = [], solverJobs = [];
  const passed = {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('1\nexample\n');
  const info = () => ({ contest_slug:'training-example', game:{name:'Example'}, levels:[1,2].map(level=>({level, inputFiles:['0-example','1-small','2-large'],unscoredFiles:['0-example']})), participant:{score:{state:Object.fromEntries([1,2].map(level=>['level'+level,{passedFiles:{...passed[level]}}]))}} });
  const client = {
    async close() {},
    async call(name, args) {
      calls.push({ name, args });
      if (name === 'game_info') return info();
      if (name === 'prepare_level') return {level_info:info().levels[args.level-1],files:{extracted:true,entries:[{artifact_id:'statement',filename:'level.pdf',bytes:10,pdf_preview:{pages:[{text:'Full statement'}]}}]}};
      if (name === 'get_level_input') return {artifact_id:args.file_id,filename:'input.in',bytes:10};
      if (name === 'get_artifact_download_url') return {url:'https://example.com/direct'};
      if (name === 'submit_solution') {
        if (options.uncertain) throw new Error('Connection lost');
        const previous = calls.filter(call=>call.name === 'submit_solution' && call.args.level === args.level && call.args.file_id === args.file_id).length;
        const correct = !options.reject || previous > 1;
        if (correct) (passed[args.level] ||= {})[args.file_id] = 12345;
        if (options.recovered && args.level === 2 && args.file_id === '2-large') throw new Error('Connection lost');
        return {evaluation:{isCorrect:correct},cooldownSec:options.cooldown || 0};
      }
      throw new Error('Unexpected tool: '+name);
    },
  };
  const solve = async (solverJob, signal, emit) => {
    solverJobs.push(solverJob);
    assert.equal(solverJob.model,'gpt-6.1-sol'); assert.equal(solverJob.reasoning,'medium'); assert.equal(solverJob.fast,true);
    assert.equal(solverJob.solverOnly,true); assert.equal(solverJob.workflow,'standard');
    assert.equal(solverJob.previousThreadId,solverJobs.length === 1 ? undefined : 'solver-thread');
    const output = solverJob.prompt.match(/directly write (\S+) with JSON/)[1];
    const ids = JSON.parse(solverJob.prompt.match(/pending ID: (\[[^\n]+\])/)[1]);
    const answers = ids.map(file_id=>({file_id,solution:'42\n'}));
    if (options.invalid) answers[0].file_id='invented-id';
    if (options.recipe) {
      await writeFile(path.join(path.dirname(output),'solver.json'),JSON.stringify({runtime:'node',script:'solution.cjs'}));
      await writeFile(path.join(path.dirname(output),'solution.cjs'),`const fs=require('node:fs');const task=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));fs.writeFileSync(process.argv[3],JSON.stringify({answers:task.inputs.map(input=>({file_id:input.file_id,solution:'42\\n'}))}));`);
    } else await writeFile(output,JSON.stringify({answers}));
    emit({type:'usage',data:{inputTokens:10,outputTokens:5,totalTokens:15}});
    emit({type:'checkpoint',data:{threadId:'solver-thread'}});
    emit({type:'delta',text:'Repeated internal solver summary'});
    return 'Solutions ready';
  };
  try { await action({cwd,controller,client,solve,calls,events,solverJobs,run:()=>runCccAuto(job,cwd,client,solve,controller.signal,event=>events.push(event))}); }
  finally {globalThis.fetch=originalFetch;await rm(cwd,{recursive:true,force:true});}
}

test('CCC script solves levels, submits exact scored IDs and aggregates model usage',async()=>fixture(async f=>{
  const result=await f.run();
  assert.match(result,/Accepted 4 new outputs/);
  assert.equal(f.solverJobs.length,2);
  assert.deepEqual(f.calls.filter(c=>c.name==='submit_solution').map(c=>[c.args.level,c.args.file_id]),[[1,'1-small'],[1,'2-large'],[2,'1-small'],[2,'2-large']]);
  assert.equal(f.events.filter(e=>e.type==='checkpoint').length,0);
  assert.deepEqual(f.events.filter(e=>e.type==='delta').map(e=>e.text),[result]);
  assert.equal(f.events.filter(e=>e.type==='usage').at(-1).data.totalTokens,30);
  await f.run();
  assert.equal(f.calls.filter(c=>c.name==='submit_solution').length,4);
}));
test('only definitive rejected evaluations are solved again',async()=>fixture(async f=>{
  await f.run();
  assert.equal(f.solverJobs.length,4);
  assert.match(f.solverJobs[1].prompt,/isCorrect/);
  assert.equal(f.events.filter(e=>e.type==='usage').at(-1).data.totalTokens,60);
},{reject:true}));
test('levels and corrections continue one solver thread and reuse verified platform progress',async()=>fixture(async f=>{
  await f.run();
  assert.deepEqual(f.solverJobs.map(j=>j.previousThreadId),[undefined,'solver-thread','solver-thread','solver-thread']);
  assert.equal(new Set(f.solverJobs.map(j=>j.taskId)).size,1);
  assert.equal(f.calls.filter(c=>c.name==='game_info').length,3);
  assert.equal(f.events.filter(e=>e.type==='checkpoint').length,0);
},{reject:true}));
test('a slow download does not block later files when another worker becomes free',async()=>fixture(async f=>{
  const call=f.client.call.bind(f.client);
  f.client.call=async(name,args)=>{
    if(name==='get_artifact_download_url')return {url:`https://example.com/${args.artifact_id}`};
    const result=await call(name,args);
    if(name==='prepare_level')result.files.entries.push(...[1,2,3].map(i=>({artifact_id:`extra-${i}`,filename:`extra-${i}.txt`,bytes:10})));
    return result;
  };
  let release, startedLater=false, waiting=true;
  const stalled=new Promise(resolve=>{release=resolve;});
  const timer=setTimeout(()=>{waiting=false;release();},1000);
  globalThis.fetch=async(url)=>{
    if(url.endsWith('/statement'))await stalled;
    if(url.endsWith('/extra-3')){startedLater=waiting;release();}
    return new Response('1\nexample\n');
  };
  try {
    await f.run();
    assert.equal(startedLater,true);
    const key=createHash('sha256').update('session:training-example').digest('hex').slice(0,24);
    const manifest=JSON.parse(await readFile(path.join(f.cwd,'.ai-router/ccc-auto',key,'level-1/task.json'),'utf8'));
    assert.deepEqual(manifest.files.map(file=>file.name),['level.pdf','extra-1.txt','extra-2.txt','extra-3.txt']);
  }finally{clearTimeout(timer);release();}
}));
test('runner executes generated solver recipes on the full inputs before submitting',async()=>fixture(async f=>{
  await f.run();
  assert.equal(f.solverJobs.length,2);
  assert.equal(f.events.filter(e=>e.type==='tool' && e.message.includes('running original')).length,2);
  assert.equal(f.calls.filter(c=>c.name==='submit_solution').length,4);
},{recipe:true}));
test('unknown submission persists before network dispatch and is not repeated after restart',async()=>fixture(async f=>{
  await assert.rejects(f.run(),/Connection lost/);
  await assert.rejects(f.run(),/previous submission is unresolved/);
  assert.equal(f.calls.filter(c=>c.name==='submit_solution').length,1);
},{uncertain:true}));
test('validates the entire answer batch before sending any answer',async()=>fixture(async f=>{
  await assert.rejects(f.run(),/duplicate, unknown or invalid/);
  assert.equal(f.calls.filter(c=>c.name==='submit_solution').length,0);
},{invalid:true}));
test('cancellation during cooldown prevents the next submission',async()=>fixture(async f=>{
  const pending=f.run();
  const timer=setInterval(()=>{if(f.calls.some(c=>c.name==='submit_solution'))f.controller.abort();},5);
  try {await assert.rejects(pending,/abort/i);}finally{clearInterval(timer);}
  assert.equal(f.calls.filter(c=>c.name==='submit_solution').length,1);
},{cooldown:10}));
test('contest link comes from the current request, with explicit errors for challenge and unrelated URLs',()=>{
  assert.equal(contestReference('Conversation context:\nhttps://codingcontest.org/contests/old/game\n\nCurrent user request:\nSolve https://codingcontest.org/contests/new/game'),'new');
  assert.equal(contestReference('training-ccc-2025-example'),'training-ccc-2025-example');
  assert.throws(()=>contestReference('https://evilcodingcontest.org/contests/no/game'),/send the contest/);
  assert.throws(()=>contestReference('https://codingcontest.org/training/challenge'),/send the contest/);
});
test('answer paths reject escaping symlinks and duplicate IDs',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'ccc-answers-'));
  try {
    const dir=path.join(root,'level');await mkdir(dir);
    await writeFile(path.join(root,'outside.txt'),'secret');await symlink(path.join(root,'outside.txt'),path.join(dir,'link.txt'));
    const manifest=path.join(dir,'answers.json');
    await writeFile(manifest,JSON.stringify({answers:[{file_id:'1',path:'link.txt'}]}));
    await assert.rejects(readAnswers(manifest,dir,['1']),/inside its level folder/);
    await writeFile(manifest,JSON.stringify({answers:[{file_id:'1',solution:'a'},{file_id:'1',solution:'b'}]}));
    await assert.rejects(readAnswers(manifest,dir,['1','2']),/duplicate/);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('MCP parses structured and text envelopes and never accepts isError as success',()=>{
  assert.deepEqual(toolData({structuredContent:{ok:true,data:{evaluation:{isCorrect:false}}}}),{evaluation:{isCorrect:false}});
  assert.deepEqual(toolData({content:[{type:'text',text:'{"ok":true,"data":{"value":1}}'}]}),{value:1});
  assert.throws(()=>toolData({isError:true,structuredContent:{ok:true,data:{}}}),/failed/);
});

test('lost submission response continues automatically when platform confirms acceptance',async()=>fixture(async f=>{
  assert.match(await f.run(),/Accepted 4 new outputs/);
  assert.equal(f.calls.filter(c=>c.name==='submit_solution').length,4);
  assert.equal(f.solverJobs.length,2);
  assert.ok(f.events.some(e=>e.message?.includes('checking platform progress before continuing')));
},{recovered:true}));

test('failed progress read reconnects and continues the exact call',async()=>{
  const controller=new AbortController();
  let connects=0, closes=0; const calls=[], retries=[];
  const client=recoveringCcc(async()=>{
    const index=++connects;
    return {close:async()=>{closes++;},call:async(name,args)=>{
      calls.push({name,args});
      if(index===1)throw new Error('Connection lost');
      return {contest_slug:'example'};
    }};
  },controller.signal,attempt=>retries.push(attempt),[0]);
  assert.deepEqual(await client.call('game_info',{contest:'example'}),{contest_slug:'example'});
  assert.equal(connects,2); assert.deepEqual(calls,[calls[0],calls[0]]); assert.deepEqual(retries,[1]);
  await client.close(); assert.equal(closes,2);
});

test('recovery is bounded and never repeats submissions or authentication errors',async()=>{
  for(const [name,error,expected] of [
    ['submit_solution',new Error('Connection lost'),1],
    ['game_info',Object.assign(new Error('Access denied'),{code:401}),1],
    ['game_info',new Error('Connection lost'),3],
  ]) {
    let calls=0;
    const client=recoveringCcc(async()=>({close:async()=>{},call:async()=>{calls++;throw error;}}),new AbortController().signal,undefined,[0,0]);
    await assert.rejects(client.call(name,{})); assert.equal(calls,expected); await client.close();
  }
});

test('user cancellation stops automatic continuation during retry delay',async()=>{
  const controller=new AbortController(); let connects=0;
  const client=recoveringCcc(async()=>{connects++;return {close:async()=>{},call:async()=>{throw new Error('Offline');}};},controller.signal,()=>controller.abort(),[10000]);
  await assert.rejects(client.call('game_info',{}),/abort/i);
  assert.equal(connects,1); await client.close();
});
